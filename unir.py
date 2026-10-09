"""Actualiza data/precios.csv con lo scrapeado hoy (data/scrapeado-hoy.csv).

Por cada farmacia:
- si hoy se consultó completa (sin errores y con filas), sus precios se reemplazan por los de hoy;
- si hubo errores o no trajo nada, se conservan sus precios anteriores (cada uno con su fecha)
  y se les suma lo que sí llegó hoy (lo de hoy gana para el mismo producto y presentación).

Si data/precios.csv aún no existe, se parte de data/base.csv. Si data/scrapeado-hoy.csv no existe,
se dejan los precios anteriores tal cual. Uso:

    python unir.py
"""

import csv
import json
import sys
from pathlib import Path

DATOS = Path(__file__).parent / "data"
PRECIOS = DATOS / "precios.csv"
BASE = DATOS / "base.csv"
HOY = DATOS / "scrapeado-hoy.csv"
ESTADO = DATOS / "estado-scraping.json"
COLUMNAS = [
    "fecha", "farmacia", "principio_activo", "concentracion", "producto", "marca",
    "presentacion", "unidades", "precio", "precio_lista", "precio_unidad", "url",
]


def leer(ruta):
    with ruta.open(encoding="utf-8", newline="") as archivo:
        lector = csv.DictReader(archivo)
        if lector.fieldnames != COLUMNAS:
            sys.exit(f"{ruta.name} no tiene las columnas esperadas: {lector.fieldnames}")
        return list(lector)


def clave(fila):
    return (fila["farmacia"], fila["url"], fila["presentacion"])


def orden(fila):
    # Sin precio por unidad va al final de su grupo.
    precio_unidad = float(fila["precio_unidad"]) if fila["precio_unidad"] else float("inf")
    return (fila["principio_activo"], fila["concentracion"], precio_unidad, fila["farmacia"])


def main():
    origen = PRECIOS if PRECIOS.exists() else BASE
    anteriores = leer(origen)
    hoy = leer(HOY) if HOY.exists() else []
    estado = json.loads(ESTADO.read_text(encoding="utf-8")).get("farmacias", {}) if ESTADO.exists() else {}

    farmacias = sorted({f["farmacia"] for f in anteriores} | {f["farmacia"] for f in hoy})
    resultado = []
    for farmacia in farmacias:
        de_hoy = [f for f in hoy if f["farmacia"] == farmacia]
        previas = [f for f in anteriores if f["farmacia"] == farmacia]
        info = estado.get(farmacia)
        completa = bool(de_hoy) and (info is None or info.get("consultas_error", 0) == 0)
        if completa:
            resultado.extend(de_hoy)
            print(f"{farmacia}: {len(de_hoy)} precios de hoy (reemplazan {len(previas)} anteriores)")
        else:
            claves_hoy = {clave(f) for f in de_hoy}
            conservadas = [f for f in previas if clave(f) not in claves_hoy]
            resultado.extend(de_hoy + conservadas)
            print(
                f"{farmacia}: consulta incompleta hoy; {len(de_hoy)} precios de hoy "
                f"+ {len(conservadas)} anteriores conservados con su fecha"
            )

    resultado.sort(key=orden)
    with PRECIOS.open("w", encoding="utf-8", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS)
        escritor.writeheader()
        escritor.writerows(resultado)
    print(f"{len(resultado)} filas en {PRECIOS} (partiendo de {origen.name})")


if __name__ == "__main__":
    main()
