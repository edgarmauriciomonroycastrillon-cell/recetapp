# MediFácil

Antes se llamaba RecetApp (el repositorio y la URL siguen siendo `recetapp`).

Web que compara precios de medicamentos entre farmacias de Colombia y muestra la opción más barata con la misma sustancia (principio activo).

## Reglas del proyecto

### Tecnología
- Sitio estático: solo HTML, CSS y JavaScript.
- Sin frameworks, sin dependencias de npm y sin paso de build.
- Debe funcionar tal cual en GitHub Pages (rutas relativas, nada que requiera servidor).

### Idioma y moneda
- Todo el texto en español de Colombia.
- Precios en pesos colombianos (COP), con formato colombiano: `$12.500` (punto como separador de miles, sin decimales). Usar `Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })`.

### Diseño
- Mobile first: diseñar primero para celular y luego ampliar con media queries para pantallas más grandes.
- Estilo de tienda real, no genérico: fondo blanco, color de marca plano (#0b5d8c), amarillo solo para "Precio más bajo", fotos reales de producto, tipografía Figtree. Sin degradados llamativos, ilustraciones flotantes ni texto con degradado.

### Datos
- Los datos viven en `data/precios.csv` y se leen en el navegador (con `fetch`).
- Nunca inventes precios ni edites precios a mano en el CSV o en el código. Si faltan datos, dilo; no los rellenes.
- Cada precio que se muestre debe indicar la farmacia y la fecha del precio.
- La columna `imagen` guarda la URL de la foto del producto en el CDN de la farmacia (VTEX, `/arquivos/`, a 300x300). Las fotos no se copian al repositorio; si una no carga, se muestra un ícono.

### Actualización automática
- GitHub Actions (`.github/workflows/actualizar-precios.yml`) corre todos los días a las 7:00 a. m. hora Colombia: `scraper.py` consulta La Rebaja, Locatel y Olímpica, y `unir.py` actualiza `data/precios.csv`. El commit del bot republica el sitio.
- `data/precios.csv`, `data/scrapeado-hoy.csv` y `data/estado-scraping.json` los genera ese proceso: no se editan a mano. Para corregir datos se cambia el código del scraper.
- La lista de los 20 medicamentos está en `SUSTANCIAS` y `TERMINOS` de `scraper.py`.
- Respetar el `robots.txt` de cada farmacia (con comodines), identificarse con el User-Agent de MediFácil y esperar 1,5 s entre consultas.
- Si una farmacia falla, se conservan sus precios anteriores con su fecha; nunca se rellenan.
- Se descarta, no se corrige: combinaciones, formas líquidas o no orales, productos sin concentración o sin unidades, no disponibles, y productos cuyo nombre menciona una sustancia distinta a la de la ficha de la tienda.

### Comparación
- Se compara por precio por unidad (tableta, cápsula, ml, etc.), no por precio de caja.
- Solo se comparan productos con la misma sustancia (y misma concentración).

### Aviso obligatorio
Este texto debe estar siempre visible en todas las páginas:

> MediFácil compara precios; no reemplaza la indicación de tu médico o farmacéutico
