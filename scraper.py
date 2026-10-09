"""Consulta los catálogos públicos de La Rebaja, Locatel y Olímpica y guarda data/scrapeado-hoy.csv.

También guarda data/estado-scraping.json con el resultado de cada farmacia, que usa unir.py
para decidir si reemplaza los precios anteriores de esa farmacia.

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
from datetime import datetime, timedelta, timezone
from pathlib import Path

USER_AGENT = (
    "MediFacil/0.1 (comparador de precios de medicamentos; "
    "+https://github.com/edgarmauriciomonroycastrillon-cell/recetapp)"
)
PAUSA_SEGUNDOS = 1.5
COLOMBIA = timezone(timedelta(hours=-5))  # Colombia no tiene horario de verano
RUTA_BUSQUEDA = "/api/catalog_system/pub/products/search"

FARMACIAS = [
    {"nombre": "La Rebaja", "base": "https://www.larebajavirtual.com", "consulta": "?ft={termino}&_from=0&_to=49"},
    {"nombre": "Locatel", "base": "https://www.locatelcolombia.com", "consulta": "?ft={termino}&_from=0&_to=49"},
    # El robots.txt de Olímpica prohíbe URLs con "&" o "%": solo se puede pedir la primera página (10 productos).
    {"nombre": "Olímpica", "base": "https://www.olimpica.com", "consulta": "?ft={termino}"},
]

# Los 20 medicamentos: nombre canónico -> sinónimos que pueden aparecer en el nombre o en la ficha.
SUSTANCIAS = {
    "LOSARTAN": ["LOSARTAN"],
    "ACETAMINOFEN": ["ACETAMINOFEN", "PARACETAMOL"],
    "IBUPROFENO": ["IBUPROFENO"],
    "ATORVASTATINA": ["ATORVASTATINA"],
    "METFORMINA": ["METFORMINA"],
    "OMEPRAZOL": ["OMEPRAZOL"],
    "LORATADINA": ["LORATADINA"],
    "AMLODIPINO": ["AMLODIPINO", "AMLODIPINA"],
    "ESOMEPRAZOL": ["ESOMEPRAZOL"],
    "ROSUVASTATINA": ["ROSUVASTATINA"],
    "LEVOTIROXINA": ["LEVOTIROXINA"],
    "ENALAPRIL": ["ENALAPRIL"],
    "AMOXICILINA": ["AMOXICILINA"],
    "AZITROMICINA": ["AZITROMICINA"],
    "NAPROXENO": ["NAPROXENO"],
    "DICLOFENACO": ["DICLOFENACO"],
    "SERTRALINA": ["SERTRALINA"],
    "MONTELUKAST": ["MONTELUKAST"],
    "ACIDO ACETILSALICILICO": ["ACIDO ACETILSALICILICO", "ACETILSALICILICO", "ASA", "ASPIRINA"],
    "CETIRIZINA": ["CETIRIZINA"],
}
# Términos de búsqueda: un término por sustancia (una sola palabra, sin "%") y algunas marcas comunes.
TERMINOS = [
    "losartan", "acetaminofen", "ibuprofeno", "atorvastatina", "metformina", "omeprazol",
    "loratadina", "amlodipino", "esomeprazol", "rosuvastatina", "levotiroxina", "enalapril",
    "amoxicilina", "azitromicina", "naproxeno", "diclofenaco", "sertralina", "montelukast",
    "acetilsalicilico", "cetirizina", "dolex", "advil",
]

DATOS = Path(__file__).parent / "data"
SALIDA = DATOS / "scrapeado-hoy.csv"
ESTADO = DATOS / "estado-scraping.json"
COLUMNAS = [
    "fecha", "farmacia", "principio_activo", "concentracion", "producto", "marca",
    "presentacion", "unidades", "precio", "precio_lista", "precio_unidad", "url", "imagen",
]

# Combinaciones: "+", "/", "HCT" o una segunda sustancia conocida en el nombre.
RE_COMBINACION = re.compile(
    r"[+/]|\b(HCT|HIDROCLOROTIAZIDA|CLAVULANICO|CLAVULANATO|CAFEINA|FENILEFRINA|"
    r"PSEUDOEFEDRINA|CLORFENAMINA|METOCARBAMOL|ORFENADRINA|CODEINA|TRAMADOL|EZETIMIBE|"
    r"SITAGLIPTINA|VILDAGLIPTINA|LINAGLIPTINA|GLIBENCLAMIDA|DAPAGLIFLOZINA|EMPAGLIFLOZINA|"
    r"AMBROXOL|VALSARTAN|BETAMETASONA|SULBACTAM)\b"
)
RE_LIQUIDO = re.compile(
    r"\b(JARABE|SUSPENSION|SUSP|SOLUCION|SLN|GOTAS|ELIXIR|EMULSION|"
    r"AMPOLLA|AMPOLLAS|AMP|VIAL|INYECTABLE|LIQUIDO)\b|\d\s*ML\b|\bML\b"
)
# Formas que no son tabletas o cápsulas: no se comparan por unidad.
RE_NO_ORAL = re.compile(
    r"\b(GEL|EMULGEL|CREMA|UNGUENTO|POMADA|PARCHE|PARCHES|SUPOSITORIO|SUPOSITORIOS|OVULO|OVULOS|"
    r"SPRAY|AEROSOL|INHALADOR|LOCION|POLVO|GRANULADO|TUBO)\b"
)
RE_GRIPA = re.compile(r"\bGRIPA\w*|\bGRIPAC\b")
RE_SOBRE = re.compile(r"\b(SOBRE|SOBRES|SOB)\b")
RE_OFERTA = re.compile(r"\bOFERTA\b|\bPAGUE\b.*\bLLEVE\b")
RE_CONCENTRACION = re.compile(r"(\d+(?:[.,]\d+)?)\s*(MG|MCG|G|UI)\b")
FORMAS_CONTABLES = (
    r"TAB|TABS|TABLETA|TABLETAS|CAP|CAPS|CAPSULA|CAPSULAS|COMP|COMPRIMIDO|COMPRIMIDOS|"
    r"GRAGEA|GRAGEAS|CBG|UND|UNIDAD|UNIDADES|SOFTGEL|SOFTGELS"
)
# "X 30 TAB", "X30 Tabletas", "CAJAX10TABLETAS", "CJ-X-30-TAB"... pero no "TROMIX 500" ni "EUTIROX 137 MCG":
# la X va suelta o pegada a CAJA/CJ/BLISTER, y el número no es una dosis.
RE_UNIDADES = re.compile(
    rf"(?:(?<![A-Z])|(?<=CAJA)|(?<=CJ)|(?<=BLISTER))X[\s-]*(\d+)(?:[.,]0+)?(?![\d.,]|\s*(?:MG|MCG|G|ML|UI)\b)"
    rf"[\s-]*({FORMAS_CONTABLES})?\b"
)
RE_FORMA_EN_NOMBRE = re.compile(rf"\b({FORMAS_CONTABLES})\b")


def normalizar(texto):
    """Mayúsculas y sin tildes, para comparar texto."""
    sin_tildes = unicodedata.normalize("NFKD", texto or "")
    return " ".join("".join(c for c in sin_tildes if not unicodedata.combining(c)).upper().split())


def primero(producto, campo):
    """Primer valor de un campo de especificación (vienen como listas)."""
    valor = producto.get(campo)
    if isinstance(valor, list):
        return str(valor[0]).strip() if valor else ""
    return str(valor or "").strip()


def pedir(url):
    peticion = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(peticion, timeout=30) as respuesta:
        return respuesta.read()


# ---------- robots.txt ----------

def reglas_robots(texto):
    """Reglas (permitir, patrón) de los grupos que aplican a nosotros ("*" o "MediFacil")."""
    reglas, agentes, en_reglas = [], [], False
    for linea in texto.splitlines():
        linea = linea.split("#", 1)[0].strip()
        if ":" not in linea:
            continue
        clave, valor = (parte.strip() for parte in linea.split(":", 1))
        clave = clave.lower()
        if clave == "user-agent":
            if en_reglas:
                agentes, en_reglas = [], False
            agentes.append(valor.lower())
        elif clave in ("allow", "disallow"):
            en_reglas = True
            if valor and any(a == "*" or a in USER_AGENT.lower() for a in agentes):
                reglas.append((clave == "allow", valor))
    return reglas


def patron_a_regex(patron):
    # "*" = cualquier cosa; "$" al final = fin de la URL. Si un patrón no empieza por "/", se trata igual.
    fin = patron.endswith("$")
    cuerpo = re.escape(patron.rstrip("$")).replace(r"\*", ".*")
    if not cuerpo.startswith("/") and not cuerpo.startswith(".*"):
        cuerpo = ".*" + cuerpo
    return re.compile(cuerpo + ("$" if fin else ""))


def permitido(reglas, ruta):
    """Gana la regla más larga que coincide; ante empate, Allow."""
    mejor = None
    for permitir, patron in reglas:
        if patron_a_regex(patron).match(ruta):
            clave = (len(patron), permitir)
            if mejor is None or clave > mejor:
                mejor = clave
    return True if mejor is None else mejor[1]


# ---------- Interpretación de productos ----------

def sustancias_en(texto):
    texto = normalizar(texto)
    return {
        canonica for canonica, sinonimos in SUSTANCIAS.items()
        if any(re.search(rf"\b{re.escape(s)}\b", texto) for s in sinonimos)
    }


def concentracion(*textos):
    for texto in textos:
        coincidencia = RE_CONCENTRACION.search(normalizar(texto))
        if coincidencia:
            return f"{coincidencia.group(1).replace(',', '.')} {coincidencia.group(2)}"
    return ""


def unidades_en_nombre(*textos):
    """Busca "X 30 TABLETAS" en los textos; exige una forma contable en el fragmento o en el nombre."""
    for texto in textos:
        t = normalizar(texto)
        for coincidencia in RE_UNIDADES.finditer(t):
            if coincidencia.group(2) or RE_FORMA_EN_NOMBRE.search(t):
                envase = next((e for e in ("BLISTER", "CAJA", "FRASCO") if e in t), "CAJA")
                if re.search(r"\bCJ\b", t):
                    envase = "CAJA"
                forma = coincidencia.group(2) or ""
                return int(coincidencia.group(1)), f"{envase} X {coincidencia.group(1)} {forma}".strip()
    return None, ""


def imagen_de(item):
    """Foto del producto en el CDN de la farmacia, pedida a 300x300 px (VTEX: /ids/ID-300-300/)."""
    imagenes = item.get("images") or []
    url = (imagenes[0].get("imageUrl") or "") if imagenes else ""
    url = url.split("?", 1)[0]
    return re.sub(r"(/arquivos/ids/\d+)(?:-\d+-(?:\d+|auto))?/", r"\g<1>-300-300/", url)


def principio_activo(producto, campo, nombre):
    """Devuelve (principio, motivo_de_descarte)."""
    en_nombre = sustancias_en(nombre)
    if campo:
        en_campo = sustancias_en(campo)
        if len(en_campo) > 1 or re.search(r"[,+]|\bY\b", normalizar(campo)):
            return None, "combinación"
        if not en_campo:
            return None, "fuera de la lista"
        principio = en_campo.pop()
    else:
        # Sin ficha (Olímpica): la sustancia tiene que estar escrita en el nombre.
        if not en_nombre:
            return None, "sin principio activo en el nombre"
        if len(en_nombre) > 1:
            return None, "combinación"
        principio = next(iter(en_nombre))
    otras = en_nombre - {principio}
    if otras:
        # Ej.: "ASA MK 100 MG" registrado como acetaminofén en la ficha de la tienda.
        return None, "combinación" if principio in en_nombre else "principio activo no coincide con el nombre"
    return principio, None


def motivo_forma(nombre, presentacion=""):
    textos = f"{normalizar(nombre)} {normalizar(presentacion)}"
    if RE_COMBINACION.search(textos):
        return "combinación"
    if RE_LIQUIDO.search(textos):
        return "forma líquida"
    if RE_NO_ORAL.search(textos):
        return "forma no oral sólida"
    if RE_GRIPA.search(textos):
        return "producto para gripa"
    if RE_SOBRE.search(textos):
        return "sobre"
    if RE_OFERTA.search(textos):
        return "oferta de paquete"
    return None


def filas_de(farmacia, producto, hoy, descartes):
    def descartar(motivo):
        descartes[motivo] = descartes.get(motivo, 0) + 1

    nombre_producto = " ".join((producto.get("productName") or "").split())
    campo = ", ".join(p.strip() for p in producto.get("Principio activo") or [] if p.strip())
    filas = []
    for item in producto.get("items") or []:
        nombre_item = " ".join((item.get("name") or "").split())
        nombre = f"{nombre_producto} {nombre_item}"

        principio, motivo = principio_activo(producto, campo, nombre)
        if motivo:
            descartar(motivo)
            continue

        if farmacia == "La Rebaja":
            presentacion = primero(producto, "Presentacionunidadmedida")
            try:
                unidades = float(primero(producto, "Cantidadunidadesmedida").replace(",", ".") or 0)
            except ValueError:
                unidades = 0
            unidades = int(unidades) if unidades and unidades.is_integer() else unidades
            if not unidades:
                unidades, presentacion = unidades_en_nombre(presentacion, nombre_producto)
        else:
            # Locatel y Olímpica: el nombre del SKU es más fiel que sus campos de unidad de medida.
            unidades, presentacion = unidades_en_nombre(nombre_item, nombre_producto)

        motivo = motivo_forma(nombre, presentacion)
        if motivo:
            descartar(motivo)
            continue
        conc = concentracion(nombre_producto, nombre_item)
        if not conc:
            descartar("sin concentración")
            continue
        if not unidades:
            descartar("sin unidades")
            continue

        vendedores = item.get("sellers") or []
        oferta = (vendedores[0].get("commertialOffer") or {}) if vendedores else {}
        precio = oferta.get("Price")
        if not oferta.get("IsAvailable") or not precio:
            descartar("no disponible")
            continue
        filas.append({
            "fecha": hoy,
            "farmacia": farmacia,
            "principio_activo": principio,
            "concentracion": conc,
            "producto": nombre_producto,
            "marca": producto.get("brand", ""),
            "presentacion": presentacion,
            "unidades": unidades,
            "precio": round(precio),
            "precio_lista": round(oferta.get("ListPrice") or precio),
            "precio_unidad": round(precio / unidades, 2),
            "url": producto.get("link", ""),
            "imagen": imagen_de(item),
        })
    return filas


# ---------- Programa ----------

def scrapear_farmacia(farmacia, hoy):
    nombre = farmacia["nombre"]
    estado = {"consultas_ok": 0, "consultas_error": 0, "productos": 0, "filas": 0, "errores": [], "descartes": {}}
    try:
        robots = pedir(farmacia["base"] + "/robots.txt").decode("utf-8", errors="replace")
    except (urllib.error.URLError, TimeoutError) as error:
        estado["errores"].append(f"robots.txt: {error}")
        estado["consultas_error"] = len(TERMINOS)
        return [], estado
    reglas = reglas_robots(robots)

    filas, vistos = [], set()
    for termino in TERMINOS:
        ruta = RUTA_BUSQUEDA + farmacia["consulta"].format(termino=urllib.parse.quote(termino))
        if not permitido(reglas, ruta):
            estado["errores"].append(f"robots.txt no permite {ruta}")
            estado["consultas_error"] += 1
            continue
        time.sleep(PAUSA_SEGUNDOS)
        try:
            productos = json.loads(pedir(farmacia["base"] + ruta))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            estado["errores"].append(f"{termino}: {error}")
            estado["consultas_error"] += 1
            continue
        estado["consultas_ok"] += 1
        for producto in productos:
            # Un mismo producto aparece en varias búsquedas (p. ej. acetaminofen y dolex).
            if producto.get("productId") in vistos:
                continue
            vistos.add(producto.get("productId"))
            estado["productos"] += 1
            filas.extend(filas_de(nombre, producto, hoy, estado["descartes"]))

    # Mismo producto y presentación con el mismo precio: una sola fila.
    unicas = {(f["url"], f["unidades"], f["precio"]): f for f in filas}
    filas = list(unicas.values())
    estado["filas"] = len(filas)
    return filas, estado


def main():
    hoy = datetime.now(COLOMBIA).date().isoformat()
    todas, estados = [], {}
    for farmacia in FARMACIAS:
        print(f"{farmacia['nombre']}…")
        filas, estado = scrapear_farmacia(farmacia, hoy)
        todas.extend(filas)
        estados[farmacia["nombre"]] = estado
        print(
            f"  {estado['consultas_ok']} consultas bien, {estado['consultas_error']} con error, "
            f"{estado['productos']} productos, {estado['filas']} filas"
        )
        for error in estado["errores"][:5]:
            print(f"  ! {error}")
        if estado["descartes"]:
            print("  Descartados: " + ", ".join(f"{k}: {v}" for k, v in sorted(estado["descartes"].items())))

    todas.sort(key=lambda f: (f["principio_activo"], f["concentracion"], f["precio_unidad"], f["farmacia"]))
    DATOS.mkdir(exist_ok=True)
    with SALIDA.open("w", encoding="utf-8", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=COLUMNAS, lineterminator="\n")  # igual en Windows y Linux
        escritor.writeheader()
        escritor.writerows(todas)
    ESTADO.write_text(
        json.dumps({"fecha": hoy, "farmacias": estados}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n{len(todas)} filas guardadas en {SALIDA}")
    if not todas:
        sys.exit("No se obtuvo ningún precio.")


if __name__ == "__main__":
    main()
