"""Consulta el catálogo público de La Rebaja y guarda data/scrapeado-hoy.csv.

Solo usa la biblioteca estándar de Python. Uso:

    python scraper.py
"""

import csv
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import date
from pathlib import Path

FARMACIA = "La Rebaja"
BASE = "https://www.larebajavirtual.com"
BUSQUEDA = BASE + "/api/catalog_system/pub/products/search?ft={termino}&_from=0&_to=49"
USER_AGENT = (
    "RecetApp/0.1 (comparador de precios de medicamentos; "
    "+https://github.com/edgarmauriciomonroycastrillon-cell/recetapp)"
)
PAUSA_SEGUNDOS = 1.5
TERMINOS = [
    "losartan", "acetaminofen", "ibuprofeno", "atorvastatina", "metformina",
    "omeprazol", "loratadina", "amlodipino", "dolex", "advil",
]
SALIDA = Path(__file__).parent / "data" / "scrapeado-hoy.csv"
COLUMNAS = [
    "fecha", "farmacia", "principio_activo", "concentracion", "producto", "marca",
    "presentacion", "unidades", "precio", "precio_lista", "precio_unidad", "url",
]

# Combinaciones de sustancias: "+", "/" o "HCT" en el nombre.
RE_COMBINACION = re.compile(r"[+/]|\bHCT\b")
# Formas líquidas (se compara texto en mayúsculas y sin tildes).
RE_LIQUIDO = re.compile(
    r"\b(JARABE|SUSPENSION|SUSP|SOLUCION|SLN|GOTAS|ELIXIR|EMULSION|"
    r"AMPOLLA|AMPOLLAS|VIAL|INYECTABLE|LIQUIDO)\b|\d\s*ML\b|\bML\b"
)
# Productos para la gripa: suelen combinar sustancias aunque la ficha traiga solo una.
RE_GRIPA = re.compile(r"\bGRIPA\w*|\bGRIPAC\b")
# Sobres para disolver: no son unidades comparables con tabletas o cápsulas.
RE_SOBRE = re.compile(r"\b(SOBRE|SOBRES|SOB)\b")
# Ofertas de paquete ("PAGUE 16 LLEVE 20"): las unidades de la ficha no son confiables.
RE_OFERTA = re.compile(r"\bOFERTA\b|\bPAGUE\b.*\bLLEVE\b")
RE_CONCENTRACION = re.compile(r"(\d+(?:[.,]\d+)?)\s*(MG|MCG|G|UI)\b")
RE_UNIDADES = re.compile(r"\bX\s*(\d+(?:[.,]\d+)?)\s*([A-Z]+)?")


def normalizar(texto):
    """Mayúsculas y sin tildes, para comparar texto."""
    sin_tildes = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in sin_tildes if not unicodedata.combining(c)).upper()


def primero(producto, campo):
    """Devuelve el primer valor de un campo de especificación (vienen como listas)."""
    valor = producto.get(campo)
    if isinstance(valor, list):
        return str(valor[0]).strip() if valor else ""
    return str(valor or "").strip()


def pedir_json(url):
    peticion = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    )
    with urllib.request.urlopen(peticion, timeout=30) as respuesta:
        return json.load(respuesta)


def revisar_robots():
    robots = urllib.robotparser.RobotFileParser(BASE + "/robots.txt")
    peticion = urllib.request.Request(BASE + "/robots.txt", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(peticion, timeout=30) as respuesta:
        robots.parse(respuesta.read().decode("utf-8", errors="replace").splitlines())
    url_prueba = BUSQUEDA.format(termino="losartan")
    if not robots.can_fetch(USER_AGENT, url_prueba):
        sys.exit(f"robots.txt no permite consultar {url_prueba}. No se hace nada.")
    print("robots.txt permite consultar /api/catalog_system/pub/products/search")


def concentracion(nombre):
    coincidencia = RE_CONCENTRACION.search(normalizar(nombre))
    if not coincidencia:
        return ""
    cantidad = coincidencia.group(1).replace(",", ".")
    return f"{cantidad} {coincidencia.group(2)}"


def presentacion_y_unidades(producto):
    """Toma la presentación de la ficha del producto; si falta, la busca en el nombre."""
    presentacion = primero(producto, "Presentacionunidadmedida")
    unidades = None
    cantidad = primero(producto, "Cantidadunidadesmedida")
    if cantidad:
        try:
            unidades = float(cantidad.replace(",", "."))
        except ValueError:
            unidades = None
    if not unidades:
        for texto in (presentacion, producto.get("productName", "")):
            coincidencia = RE_UNIDADES.search(normalizar(texto))
            if coincidencia:
                unidades = float(coincidencia.group(1).replace(",", "."))
                if not presentacion:
                    presentacion = coincidencia.group(0)
                break
    if unidades and unidades.is_integer():
        unidades = int(unidades)
    return presentacion, unidades


def motivo_descarte(producto, principios):
    nombre = normalizar(producto.get("productName", ""))
    if not principios:
        return "sin principio activo"
    if len(principios) > 1 or any(re.search(r"[,+]|\bY\b", normalizar(p)) for p in principios):
        return "combinación"
    if RE_COMBINACION.search(nombre):
        return "combinación"
    textos = " ".join([
        nombre,
        normalizar(primero(producto, "Presentacionunidadmedida")),
        normalizar(primero(producto, "Unidadmedida")),
    ])
    if RE_LIQUIDO.search(textos):
        return "forma líquida"
    if RE_GRIPA.search(nombre):
        return "producto para gripa"
    if RE_SOBRE.search(textos):
        return "sobre"
    if RE_OFERTA.search(nombre):
        return "oferta de paquete"
    # Sin concentración no se puede comparar con la misma sustancia y dosis.
    if not concentracion(producto.get("productName", "")):
        return "sin concentración"
    return None


def filas_de(producto, hoy, descartes):
    principios = [p.strip() for p in producto.get("Principio activo") or [] if p.strip()]
    motivo = motivo_descarte(producto, principios)
    if motivo:
        descartes[motivo] = descartes.get(motivo, 0) + 1
        return []

    presentacion, unidades = presentacion_y_unidades(producto)
    if not unidades:
        descartes["sin unidades"] = descartes.get("sin unidades", 0) + 1
        return []

    filas = []
    for item in producto.get("items") or []:
        vendedores = item.get("sellers") or []
        if not vendedores:
            continue
        oferta = vendedores[0].get("commertialOffer") or {}
        precio = oferta.get("Price")
        if not oferta.get("IsAvailable") or not precio:
            descartes["no disponible"] = descartes.get("no disponible", 0) + 1
            continue
        filas.append({
            "fecha": hoy,
            "farmacia": FARMACIA,
            "principio_activo": normalizar(principios[0]),
            "concentracion": concentracion(producto.get("productName", "")),
            "producto": " ".join(producto.get("productName", "").split()),
            "marca": producto.get("brand", ""),
            "presentacion": presentacion,
            "unidades": unidades,
            "precio": round(precio),
            "precio_lista": round(oferta.get("ListPrice") or precio),
            "precio_unidad": round(precio / unidades, 2),
            "url": producto.get("link", ""),
        })
    return filas


def main():
    hoy = date.today().isoformat()
    revisar_robots()

    filas = []
    vistos = set()
    descartes = {}
    for termino in TERMINOS:
        time.sleep(PAUSA_SEGUNDOS)
        url = BUSQUEDA.format(termino=urllib.parse.quote(termino))
        try:
            productos = pedir_json(url)
        except (urllib.error.URLError, json.JSONDecodeError) as error:
            print(f"  {termino}: error al consultar ({error}); se omite")
            continue
        nuevas = 0
        for producto in productos:
            # Un mismo producto aparece en varias búsquedas (p. ej. acetaminofen y dolex).
            if producto.get("productId") in vistos:
                continue
            vistos.add(producto.get("productId"))
            nuevas_filas = filas_de(producto, hoy, descartes)
            filas.extend(nuevas_filas)
            nuevas += len(nuevas_filas)
        print(f"  {termino}: {len(productos)} productos, {nuevas} filas nuevas")

    filas.sort(key=lambda f: (f["principio_activo"], f["concentracion"], f["precio_unidad"]))
    SALIDA.parent.mkdir(exist_ok=True)
    with SALIDA.open("w", encoding="utf-8", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS)
        escritor.writeheader()
        escritor.writerows(filas)

    print(f"\n{len(filas)} filas guardadas en {SALIDA}")
    if descartes:
        print("Descartados: " + ", ".join(f"{k}: {v}" for k, v in sorted(descartes.items())))


if __name__ == "__main__":
    main()
