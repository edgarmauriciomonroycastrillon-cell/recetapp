# MediFácil

Compara el precio de tus medicamentos en farmacias de Colombia y encuentra la opción más barata **con la misma sustancia y concentración**.

**Sitio:** https://edgarmauriciomonroycastrillon-cell.github.io/recetapp/

> MediFácil compara precios; no reemplaza la indicación de tu médico o farmacéutico.

## Qué hace

- Compara el **precio por unidad** (por tableta o cápsula), no el precio de la caja, para que una caja de 10 y una de 30 se puedan comparar.
- Agrupa los productos por **principio activo y concentración**: el losartán de 50 mg solo se compara con otros losartán de 50 mg, sea genérico o de marca.
- Muestra en cada precio la **farmacia y la fecha** en que se consultó.
- Resalta el **precio más bajo** y, en cada producto, cuánto más cuesta que el más barato y cómo está frente a la media del grupo.
- Al tocar un producto, sugiere la opción **más barata con la misma sustancia** y calcula el ahorro por la misma cantidad de unidades.
- Permite filtrar por **farmacia** y por **marca**, y elegir el medicamento de una lista o buscarlo por nombre, marca o principio activo (sin importar tildes ni mayúsculas).
- Los precios se **actualizan solos todos los días a las 7:00 a. m.** (hora Colombia).

## Farmacias y medicamentos

**Farmacias:** La Rebaja, Locatel y Olímpica (catálogos públicos en línea).

**20 medicamentos:** losartán, amlodipino, enalapril, ácido acetilsalicílico, atorvastatina, rosuvastatina, metformina, acetaminofén, ibuprofeno, naproxeno, diclofenaco, omeprazol, esomeprazol, loratadina, cetirizina, montelukast, amoxicilina, azitromicina, levotiroxina y sertralina. También se buscan las marcas Dolex y Advil.

## Cómo funciona

```
GitHub Actions (todos los días, 7:00 a. m.)
  └─ scraper.py  → consulta las 3 farmacias  → data/scrapeado-hoy.csv + data/estado-scraping.json
  └─ unir.py     → precios de hoy             → data/precios.csv
                 → acumula y borra > 90 días  → data/historial.csv
  └─ commit del bot → GitHub Pages republica el sitio

Navegador
  └─ index.html + app.js leen data/precios.csv con fetch y hacen la comparación
```

### `scraper.py`

Consulta la API pública de catálogo de cada farmacia (`/api/catalog_system/pub/products/search`) con solo la biblioteca estándar de Python.

- **Respeta el `robots.txt`** de cada farmacia, incluidos los comodines (`*`). Por eso en Olímpica, que prohíbe las URL con `&`, solo se pide la primera página de resultados (10 productos por búsqueda).
- Se identifica con su propio User-Agent y espera 1,5 segundos entre consultas.
- **Descarta, no corrige:** combinaciones de sustancias, formas líquidas y no orales (geles, cremas, inyectables), productos para la gripa, sobres, ofertas de paquete, productos sin concentración o sin unidades, productos no disponibles y productos cuyo nombre menciona una sustancia distinta a la que registra la tienda.
- Guarda la URL de la foto de cada producto (servida por la farmacia; no se copia al repositorio).

### `unir.py`

A partir de lo consultado hoy (`data/scrapeado-hoy.csv`):

- Reescribe `data/precios.csv` con **solo los precios de hoy**. Si una farmacia falló, ese día no aparece en el sitio; sus precios anteriores quedan en el historial. Nunca se inventan ni se rellenan precios.
- Agrega los precios de hoy a `data/historial.csv` y **borra los registros con más de 90 días**.
- Si no llegó ningún precio, no cambia nada: `scraper.py` termina con error, el bot no publica y el sitio sigue con el último `precios.csv` bueno.

### Datos: `data/precios.csv`

| Columna | Ejemplo |
|---|---|
| `fecha` | `2026-10-08` |
| `farmacia` | `La Rebaja` |
| `principio_activo` | `LOSARTAN` |
| `concentracion` | `50 MG` |
| `producto` | `LOSARTAN POTASICO 50 MG (GENFAR)` |
| `marca` | `GENFAR` |
| `presentacion` | `CAJA X 30 TAB` |
| `unidades` | `30` |
| `precio` | `14100` |
| `precio_lista` | `28200` |
| `precio_unidad` | `470.0` |
| `url` | enlace al producto en la tienda |
| `imagen` | foto del producto en el servidor de la farmacia |

### Historial: `data/historial.csv`

- Una fila por **producto, farmacia y fecha**. El producto se identifica por su `url` y su `presentacion` (Locatel usa la misma url para el blíster y la caja).
- Mismas columnas que `precios.csv`, sin `imagen`.
- Si la actualización corre dos veces el mismo día, las filas de ese día se reemplazan; no se duplican.
- Se guardan **90 días**: cada día `unir.py` borra las filas con fecha anterior a hoy − 90 días (hora Colombia). Son unas 530 filas por día, unos 9,5 MB al llenarse.
- Por ahora el sitio no lo muestra; queda listo para ver cómo cambian los precios.

Los archivos de `data/` los genera el proceso automático: **no se editan a mano**. Si hay un error en los datos, se corrige en `scraper.py`.

## Estructura

| Archivo | Para qué |
|---|---|
| `index.html`, `estilos.css`, `app.js` | El sitio (HTML, CSS y JavaScript sin frameworks ni paso de build) |
| `scraper.py` | Consulta las farmacias |
| `unir.py` | Escribe los precios de hoy y actualiza el historial (90 días) |
| `.github/workflows/actualizar-precios.yml` | Programa la actualización diaria |
| `data/precios.csv` | Los precios de hoy, los que lee el sitio |
| `data/historial.csv` | Precios de los últimos 90 días, una fila por producto, farmacia y fecha |
| `data/base.csv` | Datos iniciales del 8 de octubre de 2026 (ya no los usa el proceso) |
| `CLAUDE.md` | Reglas del proyecto |

## Correrlo en tu computador

Requiere Python 3. Desde la carpeta del proyecto:

```bash
python -m http.server 8000
```

y abre http://localhost:8000. (Abrir `index.html` con doble clic no funciona: el navegador no deja leer el CSV sin un servidor).

Para actualizar los precios a mano:

```bash
python scraper.py
```

```bash
python unir.py
```

También se puede lanzar la actualización en GitHub: pestaña **Actions** → **Actualizar precios** → **Run workflow**.

## Al cambiar el diseño

Si cambias `estilos.css` o `app.js`, sube el número `?v=` de sus enlaces en `index.html`. GitHub Pages deja que el navegador guarde esos archivos 10 minutos, y sin ese cambio algunas personas seguirían viendo la versión anterior.

## ¿Y por región o ciudad?

Se revisó el 8 de octubre de 2026 y **no hay diferencia por región en los precios en línea**:

- **La Rebaja:** su catálogo no separa por región; todas las ciudades probadas (Bogotá, Medellín, Cali, Barranquilla) caen en la misma zona nacional.
- **Locatel:** tiene dos zonas (Bogotá y otra para Medellín, Cali y Barranquilla), pero los medicamentos los vende un solo vendedor nacional con el mismo precio y la misma disponibilidad en ambas (0 diferencias en 30 productos de losartán y atorvastatina).
- **Olímpica:** Medellín tiene tiendas propias en su catálogo, pero el precio consultado fue el mismo del vendedor nacional.

Por eso MediFácil no tiene filtro por región: no cambiaría ningún resultado. Si alguna farmacia empieza a cobrar distinto según la ciudad, `scraper.py` se puede ampliar para consultar cada zona (VTEX usa el parámetro `regionId`, que sale de `/api/checkout/pub/regions`). En Olímpica eso no sería posible mientras su `robots.txt` prohíba las URL con `&`.

## Limitaciones

- Olímpica entrega como máximo 10 productos por búsqueda, así que puede faltar alguno.
- Olímpica no informa el principio activo: solo se incluyen sus productos que lo dicen en el nombre (no las marcas solas, como Cozaar).
- Los precios son los publicados en la tienda en línea el día de la consulta (hoy iguales en todo el país); en la tienda física pueden ser distintos. Confírmalos antes de comprar.
- Algunas marcas aparecen escritas distinto según la farmacia; el sitio unifica las más comunes.

---

MediFácil antes se llamaba RecetApp; por eso el repositorio y la dirección del sitio siguen siendo `recetapp`.
