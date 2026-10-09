# RecetApp

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

### Datos
- Los datos viven en `data/precios.csv` y se leen en el navegador (con `fetch`).
- Nunca inventes precios ni edites precios a mano en el CSV o en el código. Si faltan datos, dilo; no los rellenes.
- Cada precio que se muestre debe indicar la farmacia y la fecha del precio.

### Comparación
- Se compara por precio por unidad (tableta, cápsula, ml, etc.), no por precio de caja.
- Solo se comparan productos con la misma sustancia (y misma concentración).

### Aviso obligatorio
Este texto debe estar siempre visible en todas las páginas:

> RecetApp compara precios; no reemplaza la indicación de tu médico o farmacéutico
