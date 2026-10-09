"""Une data/base.csv y data/scrapeado-hoy.csv en data/precios.csv.

Si un producto de La Rebaja (misma url) está en los dos archivos, se queda el de hoy.
Si data/scrapeado-hoy.csv no existe, se usa solo data/base.csv. Uso:

    python unir.py
"""

import csv
import sys
from pathlib import Path

DATOS = Path(__file__).parent / "data"
BASE = DATOS / "base.csv"
HOY = DATOS / "scrapeado-hoy.csv"
SALIDA = DATOS / "precios.csv"
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


def orden(fila):
    # Sin precio por unidad va al final de su grupo.
    precio_unidad = float(fila["precio_unidad"]) if fila["precio_unidad"] else float("inf")
    return (fila["principio_activo"], fila["concentracion"], precio_unidad, fila["farmacia"])


def main():
    base = leer(BASE)
    hoy = leer(HOY) if HOY.exists() else []
    if not hoy:
        print(f"{HOY.name} no existe o está vacío; se usa solo {BASE.name}")

    urls_hoy = {fila["url"] for fila in hoy if fila["farmacia"] == "La Rebaja"}
    conservadas = [
        fila for fila in base
        if not (fila["farmacia"] == "La Rebaja" and fila["url"] in urls_hoy)
    ]
    reemplazadas = len(base) - len(conservadas)
    filas = sorted(conservadas + hoy, key=orden)

    with SALIDA.open("w", encoding="utf-8", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS)
        escritor.writeheader()
        escritor.writerows(filas)

    print(
        f"{len(base)} filas de {BASE.name} ({reemplazadas} reemplazadas por las de hoy) "
        f"+ {len(hoy)} de {HOY.name} = {len(filas)} filas en {SALIDA}"
    )


if __name__ == "__main__":
    main()
