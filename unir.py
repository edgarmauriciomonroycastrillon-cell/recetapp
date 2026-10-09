"""Actualiza data/precios.csv y data/historial.csv con lo scrapeado hoy (data/scrapeado-hoy.csv).

- data/precios.csv: solo los precios de la consulta de hoy. Si una farmacia falló hoy,
  no aparece hasta que vuelva a responder (sus precios anteriores quedan en el historial).
- data/historial.csv: una fila por producto (url + presentación), farmacia y fecha.
  Si hoy se corre dos veces, las filas de hoy se reemplazan. Se borran las filas con más
  de 90 días.

Si data/scrapeado-hoy.csv no existe o está vacío, no se toca nada. Uso:

    python unir.py
"""

import csv
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

DATOS = Path(__file__).parent / "data"
PRECIOS = DATOS / "precios.csv"
HISTORIAL = DATOS / "historial.csv"
HOY = DATOS / "scrapeado-hoy.csv"
ESTADO = DATOS / "estado-scraping.json"
COLUMNAS = [
    "fecha", "farmacia", "principio_activo", "concentracion", "producto", "marca",
    "presentacion", "unidades", "precio", "precio_lista", "precio_unidad", "url", "imagen",
]
COLUMNAS_HISTORIAL = COLUMNAS[:-1]  # sin "imagen", para que el archivo pese menos
DIAS_HISTORIAL = 90
COLOMBIA = timezone(timedelta(hours=-5))  # Colombia no tiene horario de verano


def fecha_de_hoy():
    return datetime.now(COLOMBIA).date()


def leer(ruta, validas):
    with ruta.open(encoding="utf-8", newline="") as archivo:
        lector = csv.DictReader(archivo)
        if lector.fieldnames not in validas:
            sys.exit(f"{ruta.name} no tiene las columnas esperadas: {lector.fieldnames}")
        return list(lector)


def escribir(ruta, filas, columnas):
    with ruta.open("w", encoding="utf-8", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=columnas, extrasaction="ignore", lineterminator="\n")
        escritor.writeheader()
        escritor.writerows(filas)


def clave_historial(fila):
    # Un producto es su url más su presentación: Locatel usa la misma url para blíster y caja.
    return (fila["fecha"], fila["farmacia"], fila["url"], fila["presentacion"])


def orden_precios(fila):
    # Sin precio por unidad va al final de su grupo.
    precio_unidad = float(fila["precio_unidad"]) if fila["precio_unidad"] else float("inf")
    return (fila["principio_activo"], fila["concentracion"], precio_unidad, fila["farmacia"])


def orden_historial(fila):
    return (fila["fecha"], fila["farmacia"], fila["principio_activo"], fila["concentracion"], fila["producto"])


def main():
    hoy = leer(HOY, (COLUMNAS,)) if HOY.exists() else []
    if not hoy:
        print(f"{HOY.name} no existe o está vacío; no se cambia nada.")
        return

    # Avisar qué farmacias fallaron hoy: no saldrán en precios.csv hasta que respondan.
    if ESTADO.exists():
        estado = json.loads(ESTADO.read_text(encoding="utf-8")).get("farmacias", {})
        for farmacia, info in estado.items():
            if info.get("consultas_error") or not info.get("filas"):
                print(f"Aviso: {farmacia} tuvo {info.get('consultas_error', 0)} consultas con error y "
                      f"{info.get('filas', 0)} precios hoy.")

    # 1. precios.csv: solo lo de hoy
    escribir(PRECIOS, sorted(hoy, key=orden_precios), COLUMNAS)
    print(f"{len(hoy)} precios de hoy en {PRECIOS.name}")

    # 2. historial.csv: lo anterior (sin las filas de hoy, que se reemplazan) + lo de hoy
    anteriores = leer(HISTORIAL, (COLUMNAS_HISTORIAL,)) if HISTORIAL.exists() else []
    limite = fecha_de_hoy() - timedelta(days=DIAS_HISTORIAL)
    nuevas = {clave_historial(f): f for f in hoy}  # si una clave se repite hoy, queda la última
    conservadas, viejas = [], 0
    for fila in anteriores:
        if clave_historial(fila) in nuevas:
            continue
        if date.fromisoformat(fila["fecha"]) < limite:
            viejas += 1
            continue
        conservadas.append(fila)
    historial = sorted(conservadas + list(nuevas.values()), key=orden_historial)
    escribir(HISTORIAL, historial, COLUMNAS_HISTORIAL)

    fechas = sorted({f["fecha"] for f in historial})
    print(
        f"{len(historial)} filas en {HISTORIAL.name} ({len(fechas)} días: {fechas[0]} a {fechas[-1]}); "
        f"{len(nuevas)} de hoy, {viejas} borradas por tener más de {DIAS_HISTORIAL} días"
    )


if __name__ == "__main__":
    main()
