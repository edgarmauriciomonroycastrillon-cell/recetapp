// RecetApp: lee data/precios.csv en el navegador, busca y agrupa por principio activo y concentración.

const RUTA_DATOS = 'data/precios.csv';
const MIN_LETRAS = 2;
const EJEMPLOS = ['losartán', 'Dolex', 'acetaminofén', 'atorvastatina'];

const formatoPesos = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
// es-CO escribe "$ 12.500" (con espacio); en Colombia se usa "$12.500".
const pesos = { format: (valor) => formatoPesos.format(valor).replace(/\s/g, '') };
const porcentajeCO = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0 });

let productos = [];

const $busqueda = document.getElementById('busqueda');
const $estado = document.getElementById('estado');
const $resultados = document.getElementById('resultados');
const $fechaDatos = document.getElementById('fecha-datos');

// Lector CSV (RFC 4180): campos entre comillas con comas o saltos de línea, comillas escapadas ("").
function leerCSV(texto) {
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // BOM
  const filas = [];
  let fila = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === ',') {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  // Quita líneas vacías.
  return filas.filter((f) => !(f.length === 1 && f[0].trim() === ''));
}

function aNumero(valor) {
  if (valor == null || valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

// Minúsculas y sin tildes: "LOSARTÁN" y "losartan" quedan iguales.
function normalizar(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function convertirFilas(filas) {
  const [cabecera, ...resto] = filas;
  return resto.map((valores) => {
    const p = {};
    cabecera.forEach((columna, i) => {
      p[columna.trim()] = (valores[i] ?? '').trim();
    });
    p.precio = aNumero(p.precio);
    p.precio_lista = aNumero(p.precio_lista);
    p.unidades = aNumero(p.unidades);
    p.precio_unidad = aNumero(p.precio_unidad);
    p.texto_busqueda = normalizar([p.producto, p.marca, p.principio_activo].join(' '));
    return p;
  });
}

// "2026-10-08" → Date local (sin desfase por zona horaria).
function aFecha(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d);
}

function fechaLarga(iso) {
  return aFecha(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fechaCorta(iso) {
  return aFecha(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function mostrarFechaDatos() {
  const fechas = [...new Set(productos.map((p) => p.fecha).filter(Boolean))].sort();
  if (fechas.length === 0) {
    $fechaDatos.textContent = '';
  } else if (fechas.length === 1) {
    $fechaDatos.textContent = `Precios consultados el ${fechaLarga(fechas[0])}`;
  } else {
    $fechaDatos.textContent =
      `Precios consultados entre el ${fechaLarga(fechas[0])} y el ${fechaLarga(fechas[fechas.length - 1])}`;
  }
}

// Concentración en miligramos para ordenar (50 MG antes que 100 MG).
function concentracionEnMg(concentracion) {
  const m = /([\d.]+)\s*(MCG|MG|G|UI)?/i.exec(concentracion || '');
  if (!m) return Infinity;
  const valor = Number(m[1]);
  const unidad = (m[2] || '').toUpperCase();
  if (unidad === 'MCG') return valor / 1000;
  if (unidad === 'G') return valor * 1000;
  return valor;
}

function porPrecioUnidad(a, b) {
  if (a.precio_unidad == null && b.precio_unidad == null) return 0;
  if (a.precio_unidad == null) return 1;
  if (b.precio_unidad == null) return -1;
  return a.precio_unidad - b.precio_unidad;
}

function buscar(consulta) {
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  const coincidencias = new Set(
    productos.filter((p) => palabras.every((w) => p.texto_busqueda.includes(w)))
  );

  // Se muestra el grupo completo (misma sustancia y concentración) de cada coincidencia,
  // para ver también las alternativas más baratas.
  const grupos = new Map();
  for (const p of coincidencias) {
    const clave = `${p.principio_activo}|${p.concentracion}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
  }
  for (const p of productos) {
    const clave = `${p.principio_activo}|${p.concentracion}`;
    if (grupos.has(clave)) grupos.get(clave).push(p);
  }

  return {
    coincidencias,
    grupos: [...grupos.values()]
      .map((lista) => lista.sort(porPrecioUnidad))
      .sort(
        (a, b) =>
          a[0].principio_activo.localeCompare(b[0].principio_activo, 'es') ||
          concentracionEnMg(a[0].concentracion) - concentracionEnMg(b[0].concentracion)
      ),
  };
}

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

function crearTarjeta(p, esMasBarata, coincide, grupo) {
  const li = crear('li', 'tarjeta' + (esMasBarata ? ' mas-barata' : ''));

  const etiquetas = crear('div', 'etiquetas');
  if (esMasBarata) etiquetas.append(crear('span', 'etiqueta etiqueta-barata', 'Más barata por unidad'));
  if (coincide) etiquetas.append(crear('span', 'etiqueta etiqueta-coincide', 'Coincide con tu búsqueda'));
  li.append(etiquetas);

  li.append(crear('h3', 'tarjeta-producto', p.producto));

  const datos = crear('dl', 'tarjeta-datos');
  for (const [nombre, valor] of [
    ['Farmacia', p.farmacia],
    ['Marca', p.marca || '—'],
    ['Presentación', p.presentacion || '—'],
  ]) {
    datos.append(crear('dt', null, nombre), crear('dd', null, valor));
  }
  li.append(datos);

  const precios = crear('div', 'precios');
  if (p.precio_unidad != null) {
    const unidad = crear('p', 'precio-unidad', pesos.format(p.precio_unidad));
    unidad.append(' ', crear('small', null, 'por unidad'));
    precios.append(unidad);
  } else {
    precios.append(crear('p', 'precio-unidad sin-dato', 'Sin precio por unidad'));
  }
  if (p.precio != null) {
    const caja = p.unidades ? ` (${p.unidades} unidades)` : '';
    precios.append(crear('p', 'precio-caja', `Precio: ${pesos.format(p.precio)}${caja}`));
  }
  li.append(precios);

  const pie = crear('div', 'pie-tarjeta');
  pie.append(crear('span', null, `${p.farmacia} · precio del ${fechaCorta(p.fecha)}`));
  if (p.url) pie.append(crearEnlace(p.url, 'Ver en la farmacia'));
  li.append(pie);

  // "Misma sustancia, más barato": se abre al tocar la tarjeta.
  const boton = crear('button', 'boton-alternativa', 'Misma sustancia, más barato');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  const panel = crear('div', 'alternativa');
  panel.hidden = true;
  boton.addEventListener('click', () => {
    const abrir = panel.hidden;
    if (abrir && !panel.hasChildNodes()) panel.append(...contenidoAlternativa(p, grupo));
    panel.hidden = !abrir;
    boton.setAttribute('aria-expanded', String(abrir));
    li.classList.toggle('abierta', abrir);
  });
  li.addEventListener('click', (evento) => {
    if (evento.target.closest('a, button, .alternativa')) return;
    boton.click();
  });
  li.append(boton, panel);

  return li;
}

function crearEnlace(url, texto) {
  const enlace = crear('a', null, texto);
  enlace.href = url;
  enlace.target = '_blank';
  enlace.rel = 'noopener noreferrer';
  return enlace;
}

// Compara el producto con el más barato por unidad de su grupo (misma sustancia y concentración).
function contenidoAlternativa(p, grupo) {
  const nombreGrupo = `${p.principio_activo} ${p.concentracion}`;

  if (p.precio_unidad == null || !p.unidades) {
    return [
      crear('p', null,
        'Este producto no informa cuántas unidades trae, así que no se puede comparar ' +
        'su precio por unidad con las demás opciones.'),
    ];
  }

  const masBarato = grupo.find((otro) => otro.precio_unidad != null); // el grupo viene ordenado
  if (p.precio_unidad <= masBarato.precio_unidad) {
    return [
      crear('p', 'alternativa-ya', `Este ya es el más barato por unidad entre las ${grupo.length} opciones de ${nombreGrupo}.`),
    ];
  }

  const ahorroUnidad = p.precio_unidad - masBarato.precio_unidad;
  const porcentaje = ahorroUnidad / p.precio_unidad;
  const costoActual = p.precio_unidad * p.unidades;
  const costoBarato = masBarato.precio_unidad * p.unidades;

  const resumen = crear('p', 'alternativa-ahorro');
  resumen.append(
    crear('strong', null, `Ahorras ${porcentajeCO.format(porcentaje)} por unidad`),
    `: ${pesos.format(masBarato.precio_unidad)} en vez de ${pesos.format(p.precio_unidad)}.`
  );

  const mismasUnidades = crear('p', null,
    `Por las mismas ${p.unidades} unidades pagarías ${pesos.format(costoBarato)} ` +
    `en vez de ${pesos.format(costoActual)}: ahorras ${pesos.format(costoActual - costoBarato)}.`);

  const producto = crear('div', 'alternativa-producto');
  producto.append(
    crear('p', 'alternativa-nombre', masBarato.producto),
    crear('p', null,
      `${masBarato.farmacia} · ${masBarato.marca || 'sin marca'} · ${masBarato.presentacion || 'sin presentación'}`),
    crear('p', null,
      `${pesos.format(masBarato.precio_unidad)} por unidad · Precio: ${pesos.format(masBarato.precio)}` +
      (masBarato.unidades ? ` (${masBarato.unidades} unidades)` : '')),
    crear('p', 'alternativa-fecha', `${masBarato.farmacia} · precio del ${fechaCorta(masBarato.fecha)}`)
  );
  if (masBarato.url) producto.append(crearEnlace(masBarato.url, `Ver en ${masBarato.farmacia}`));

  return [resumen, mismasUnidades, producto];
}

function crearGrupo(lista, coincidencias) {
  const seccion = crear('section', 'grupo');
  const primero = lista[0];
  seccion.append(crear('h2', 'grupo-titulo', `${primero.principio_activo} ${primero.concentracion}`));

  const minimo = primero.precio_unidad;
  const opciones = lista.length === 1 ? '1 opción' : `${lista.length} opciones`;
  const desde = minimo != null ? ` · desde ${pesos.format(minimo)} por unidad` : '';
  seccion.append(crear('p', 'grupo-resumen', opciones + desde));

  const ul = crear('ul', 'tarjetas');
  for (const p of lista) {
    const esMasBarata = minimo != null && p.precio_unidad === minimo;
    ul.append(crearTarjeta(p, esMasBarata, coincidencias.has(p), lista));
  }
  seccion.append(ul);
  return seccion;
}

function mostrarAyuda() {
  $estado.textContent = '';
  const ayuda = crear('div');
  ayuda.append(crear('p', null, 'Escribe el nombre de un medicamento, su marca o su principio activo. Por ejemplo:'));
  const ejemplos = crear('div', 'ejemplos');
  for (const ejemplo of EJEMPLOS) {
    const boton = crear('button', 'ejemplo', ejemplo);
    boton.type = 'button';
    boton.addEventListener('click', () => {
      $busqueda.value = ejemplo;
      actualizar();
      $busqueda.focus();
    });
    ejemplos.append(boton);
  }
  ayuda.append(ejemplos);
  $resultados.replaceChildren(ayuda);
}

function actualizar() {
  const consulta = $busqueda.value;
  if (normalizar(consulta).length < MIN_LETRAS) {
    mostrarAyuda();
    return;
  }

  const { coincidencias, grupos } = buscar(consulta);
  if (grupos.length === 0) {
    $estado.textContent =
      `No encontramos «${consulta.trim()}». Prueba con el principio activo, por ejemplo acetaminofén.`;
    $resultados.replaceChildren();
    return;
  }

  const total = grupos.reduce((suma, g) => suma + g.length, 0);
  const textoGrupos = grupos.length === 1 ? '1 grupo' : `${grupos.length} grupos`;
  const textoOpciones = total === 1 ? '1 opción' : `${total} opciones`;
  $estado.textContent = `${textoOpciones} en ${textoGrupos} de sustancia y concentración`;
  $resultados.replaceChildren(...grupos.map((g) => crearGrupo(g, coincidencias)));
}

async function iniciar() {
  try {
    const respuesta = await fetch(RUTA_DATOS, { cache: 'no-cache' });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    productos = convertirFilas(leerCSV(await respuesta.text()));
  } catch (error) {
    console.error('No se pudo cargar', RUTA_DATOS, error);
    $fechaDatos.textContent = '';
    $estado.textContent = 'No pudimos cargar los precios. Revisa tu conexión e inténtalo de nuevo.';
    return;
  }

  mostrarFechaDatos();
  $busqueda.disabled = false;
  $busqueda.addEventListener('input', actualizar);
  actualizar();
}

iniciar();
