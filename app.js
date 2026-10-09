// RecetApp: lee data/precios.csv en el navegador, busca y agrupa por principio activo y concentración.

const RUTA_DATOS = 'data/precios.csv';
const MIN_LETRAS = 2;
const EJEMPLOS = ['losartán', 'Dolex', 'acetaminofén', 'atorvastatina', 'Cozaar'];

const formatoPesos = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
// es-CO escribe "$ 12.500" (con espacio); en Colombia se usa "$12.500".
const pesos = { format: (valor) => formatoPesos.format(valor).replace(/\s/g, '') };
const porcentajeCO = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0 });
const numeroCO = new Intl.NumberFormat('es-CO');

let productos = [];
let farmacias = []; // nombres en orden fijo, para darle a cada una su color

const $busqueda = document.getElementById('busqueda');
const $estado = document.getElementById('estado');
const $resultados = document.getElementById('resultados');
const $fechaTexto = document.getElementById('fecha-texto');
const $cifras = document.getElementById('cifras');
const $indice = document.getElementById('indice');

// ---------- Datos ----------

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

// ---------- Utilidades de interfaz ----------

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

// Íconos propios (SVG fijo, nunca datos del CSV).
const ICONOS = {
  tableta:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M6.5 12h11" stroke-linecap="round"/></svg>',
  capsula:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><g transform="rotate(-45 12 12)"><rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/></g></svg>',
  gel:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 3h10l-1 4H8z"/><path d="M8 7h8l1.5 13a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M10 12h4" stroke-linecap="round"/></svg>',
  caja:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
  flecha:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  buscar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  balanza:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 21h14M4 8h16"/><path d="M7 8l-3 6a3 3 0 0 0 6 0zM17 8l-3 6a3 3 0 0 0 6 0z"/></svg>',
  alcancia:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a7 6 0 0 1 13-3h3v4l-2 1v3h-3v2h-3v-2H9v2H6v-3a6 6 0 0 1-2-4z"/><circle cx="15" cy="11" r=".6" fill="currentColor"/><path d="M10 5.5a2 2 0 1 1 3-1.5"/></svg>',
};

const ILUSTRACION_VACIO =
  '<svg viewBox="0 0 160 120" aria-hidden="true"><circle cx="70" cy="56" r="34" fill="none" stroke="currentColor" stroke-width="8" opacity=".25"/><path d="M95 81l22 22" stroke="currentColor" stroke-width="10" stroke-linecap="round" opacity=".25"/><rect x="48" y="46" width="44" height="20" rx="10" fill="#a5b4fc" transform="rotate(-25 70 56)"/><path d="M70 46h12a10 10 0 0 1 0 20H70z" fill="#34d399" transform="rotate(-25 70 56)"/></svg>';

function icono(nombre) {
  const span = crear('span', 'forma');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONOS[nombre];
  return span;
}

// Adivina la forma (tableta, cápsula, gel) a partir del nombre y la presentación.
function formaDe(p) {
  const texto = normalizar(`${p.presentacion} ${p.producto}`);
  if (/\b(gel|emulgel|crema|tubo|unguento)\b|\d\s*g\b/.test(texto) && !/activgel|capsula/.test(texto)) return 'gel';
  if (/\b(cap|caps|capsula|capsulas|cbg|softgel|activgel|liquidas?)\b/.test(texto)) return 'capsula';
  if (/\b(tab|tabs|tableta|tabletas|comp|comprimido|comprimidos|grageas?|masticables?)\b/.test(texto)) return 'tableta';
  return 'caja';
}

function claseFarmacia(nombre) {
  const i = farmacias.indexOf(nombre);
  return `farmacia farmacia-${(i < 0 ? 0 : i) % 4}`;
}

// "LOSARTAN" → "Losartan"; "ACIDO ACETILSALICILICO" → "Acido acetilsalicilico".
function nombreSustancia(texto) {
  const t = (texto || '').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function idGrupo(p) {
  return 'g-' + normalizar(`${p.principio_activo}-${p.concentracion}`).replace(/[^a-z0-9]+/g, '-');
}

function crearEnlace(url, texto) {
  const enlace = crear('a', null, texto);
  enlace.href = url;
  enlace.target = '_blank';
  enlace.rel = 'noopener noreferrer';
  return enlace;
}

// ---------- Encabezado ----------

function mostrarDatosGenerales() {
  const fechas = [...new Set(productos.map((p) => p.fecha).filter(Boolean))].sort();
  if (fechas.length === 0) {
    $fechaTexto.textContent = 'Sin fecha en los datos';
  } else if (fechas.length === 1) {
    $fechaTexto.textContent = `Precios consultados el ${fechaLarga(fechas[0])}`;
  } else {
    $fechaTexto.textContent =
      `Precios consultados entre el ${fechaLarga(fechas[0])} y el ${fechaLarga(fechas[fechas.length - 1])}`;
  }

  const sustancias = new Set(productos.map((p) => p.principio_activo));
  const cifras = [
    [numeroCO.format(productos.length), 'precios'],
    [farmacias.length, farmacias.length === 1 ? 'farmacia' : 'farmacias'],
    [sustancias.size, 'principios activos'],
  ];
  $cifras.replaceChildren(
    ...cifras.map(([valor, texto], i) => {
      const li = crear('li');
      li.style.animationDelay = `${240 + i * 80}ms`;
      li.append(crear('strong', null, String(valor)), crear('span', null, texto));
      return li;
    })
  );
}

// ---------- Tarjetas ----------

function crearTarjeta(p, info, indice) {
  const { grupo, minimo, maximo, coincide } = info;
  const esMasBarata = minimo != null && p.precio_unidad === minimo;

  const li = crear('li', 'tarjeta' + (esMasBarata ? ' mas-barata' : ''));
  li.style.setProperty('--i', indice);

  // Cabeza: ícono de forma, farmacia y etiquetas
  const cabeza = crear('div', 'tarjeta-cabeza');
  cabeza.append(icono(formaDe(p)), crear('span', claseFarmacia(p.farmacia), p.farmacia));
  const etiquetas = crear('div', 'etiquetas');
  if (esMasBarata) etiquetas.append(crear('span', 'etiqueta etiqueta-barata', 'Más barata por unidad'));
  if (coincide) etiquetas.append(crear('span', 'etiqueta etiqueta-coincide', 'Coincide'));
  cabeza.append(etiquetas);
  li.append(cabeza);

  li.append(crear('h3', 'tarjeta-producto', p.producto));

  const meta = crear('p', 'tarjeta-meta');
  meta.append('Marca ', crear('strong', null, p.marca || '—'), ` · ${p.presentacion || 'Sin presentación'}`);
  li.append(meta);

  // Precio por unidad (lo que se compara) y precio de la caja
  const bloque = crear('div', 'precio-bloque');
  if (p.precio_unidad != null) {
    const unidad = crear('p', 'precio-unidad', pesos.format(p.precio_unidad));
    unidad.append(' ', crear('small', null, 'por unidad'));
    bloque.append(unidad);
    if (!esMasBarata && minimo != null) {
      bloque.append(crear('span', 'diferencia', `+${pesos.format(p.precio_unidad - minimo)} por unidad`));
    }
  } else {
    bloque.append(crear('p', 'precio-unidad sin-dato', 'Sin precio por unidad'));
  }
  li.append(bloque);

  if (p.precio != null) {
    const caja = p.unidades ? ` · ${p.unidades} unidades` : '';
    li.append(crear('p', 'precio-caja', `Precio: ${pesos.format(p.precio)}${caja}`));
  }

  // Medidor: qué tan caro es frente a la opción más cara del grupo
  if (p.precio_unidad != null && maximo) {
    const medidor = crear('div', 'medidor');
    medidor.setAttribute('aria-hidden', 'true');
    const barra = crear('span');
    barra.style.setProperty('--relativo', `${Math.max(4, (p.precio_unidad / maximo) * 100)}%`);
    medidor.append(barra);
    li.append(medidor);
  }

  const pie = crear('div', 'pie-tarjeta');
  pie.append(crear('span', null, `${p.farmacia} · precio del ${fechaCorta(p.fecha)}`));
  if (p.url) pie.append(crearEnlace(p.url, 'Ver en la farmacia'));
  li.append(pie);

  // "Misma sustancia, más barato": se abre al tocar la tarjeta.
  const boton = crear('button', 'boton-alternativa');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  boton.append(crear('span', null, 'Misma sustancia, más barato'));
  boton.insertAdjacentHTML('beforeend', ICONOS.flecha);

  const envoltura = crear('div', 'alternativa-envoltura');
  const panel = crear('div', 'alternativa');
  const interior = crear('div', 'alternativa-interior');
  panel.append(interior);
  envoltura.append(panel);

  boton.addEventListener('click', () => {
    const abrir = !li.classList.contains('abierta');
    if (abrir && !interior.hasChildNodes()) interior.append(...contenidoAlternativa(p, grupo));
    li.classList.toggle('abierta', abrir);
    boton.setAttribute('aria-expanded', String(abrir));
  });
  li.addEventListener('click', (evento) => {
    if (evento.target.closest('a, button, .alternativa')) return;
    boton.click();
  });
  li.append(boton, envoltura);

  return li;
}

// Compara el producto con el más barato por unidad de su grupo (misma sustancia y concentración).
function contenidoAlternativa(p, grupo) {
  const nombreGrupo = `${nombreSustancia(p.principio_activo)} ${p.concentracion}`;

  if (p.precio_unidad == null || !p.unidades) {
    return [
      crear('p', 'alternativa-nota',
        'Este producto no informa cuántas unidades trae, así que no se puede comparar ' +
        'su precio por unidad con las demás opciones.'),
    ];
  }

  const masBarato = grupo.find((otro) => otro.precio_unidad != null); // el grupo viene ordenado
  if (p.precio_unidad <= masBarato.precio_unidad) {
    const ya = crear('p', 'alternativa-ya');
    ya.insertAdjacentHTML('afterbegin', ICONOS.check);
    ya.append(`Este ya es el más barato por unidad entre las ${grupo.length} opciones de ${nombreGrupo}.`);
    return [ya];
  }

  const ahorroUnidad = p.precio_unidad - masBarato.precio_unidad;
  const porcentaje = ahorroUnidad / p.precio_unidad;
  const costoActual = p.precio_unidad * p.unidades;
  const costoBarato = masBarato.precio_unidad * p.unidades;

  const ahorro = crear('div', 'alternativa-ahorro');
  const texto = crear('p');
  texto.append(
    crear('strong', null, `Ahorras ${pesos.format(costoActual - costoBarato)}`),
    ` por las mismas ${p.unidades} unidades: ${pesos.format(costoBarato)} en vez de ${pesos.format(costoActual)}.`
  );
  ahorro.append(crear('span', 'porcentaje', `−${porcentajeCO.format(porcentaje)}`), texto);

  const porUnidad = crear('p', null,
    `Por unidad: ${pesos.format(masBarato.precio_unidad)} en vez de ${pesos.format(p.precio_unidad)}.`);

  const producto = crear('div', 'alternativa-producto');
  producto.append(
    crear('p', 'alternativa-nombre', masBarato.producto),
    crear('p', 'alternativa-detalle',
      `${masBarato.farmacia} · ${masBarato.marca || 'sin marca'} · ${masBarato.presentacion || 'sin presentación'}`),
    crear('p', 'alternativa-detalle',
      `${pesos.format(masBarato.precio_unidad)} por unidad · Precio: ${pesos.format(masBarato.precio)}` +
      (masBarato.unidades ? ` (${masBarato.unidades} unidades)` : '')),
    crear('p', 'alternativa-detalle', `${masBarato.farmacia} · precio del ${fechaCorta(masBarato.fecha)}`)
  );
  if (masBarato.url) producto.append(crearEnlace(masBarato.url, `Ver en ${masBarato.farmacia}`));

  return [ahorro, porUnidad, producto];
}

// ---------- Grupos ----------

function crearGrupo(lista, coincidencias) {
  const primero = lista[0];
  const seccion = crear('section', 'grupo');
  seccion.id = idGrupo(primero);

  const conPrecio = lista.filter((p) => p.precio_unidad != null);
  const minimo = conPrecio.length ? conPrecio[0].precio_unidad : null;
  const maximo = conPrecio.length ? conPrecio[conPrecio.length - 1].precio_unidad : null;

  // Cabeza del grupo
  const cabeza = crear('header', 'grupo-cabeza');
  const izquierda = crear('div');
  const titulo = crear('h2', 'grupo-titulo', `${nombreSustancia(primero.principio_activo)} `);
  titulo.append(crear('span', null, primero.concentracion));
  izquierda.append(titulo);

  const chips = crear('ul', 'chips');
  const numFarmacias = new Set(lista.map((p) => p.farmacia)).size;
  chips.append(
    crear('li', 'chip', lista.length === 1 ? '1 opción' : `${lista.length} opciones`),
    crear('li', 'chip', numFarmacias === 1 ? '1 farmacia' : `${numFarmacias} farmacias`)
  );
  if (minimo != null) chips.append(crear('li', 'chip chip-ahorro', `Desde ${pesos.format(minimo)} por unidad`));
  izquierda.append(chips);
  cabeza.append(izquierda);

  if (minimo != null && maximo > minimo) {
    const ahorro = crear('p', 'grupo-ahorro');
    ahorro.insertAdjacentHTML('afterbegin', ICONOS.alcancia.replace('<svg', '<svg width="20" height="20"'));
    ahorro.append('Hasta ', crear('strong', null, porcentajeCO.format((maximo - minimo) / maximo)), ' menos eligiendo la más barata');
    cabeza.append(ahorro);
  }
  seccion.append(cabeza);

  // "Coincide" solo aporta si el grupo mezcla productos que coinciden y que no (p. ej. al buscar una marca).
  const marcarCoincidencias = lista.some((p) => !coincidencias.has(p));
  const ul = crear('ul', 'tarjetas');
  lista.forEach((p, i) => {
    const coincide = marcarCoincidencias && coincidencias.has(p);
    ul.append(crearTarjeta(p, { grupo: lista, minimo, maximo, coincide }, i));
  });
  seccion.append(ul);
  return seccion;
}

function mostrarIndice(grupos) {
  if (grupos.length < 2) {
    $indice.hidden = true;
    $indice.replaceChildren();
    return;
  }
  const ol = crear('ol');
  for (const lista of grupos) {
    const primero = lista[0];
    const conPrecio = lista.find((p) => p.precio_unidad != null);
    const enlace = crear('a', null, `${nombreSustancia(primero.principio_activo)} ${primero.concentracion}`);
    enlace.href = `#${idGrupo(primero)}`;
    if (conPrecio) enlace.append(crear('small', null, pesos.format(conPrecio.precio_unidad)));
    const li = crear('li');
    li.append(enlace);
    ol.append(li);
  }
  $indice.replaceChildren(crear('p', 'indice-titulo', `${grupos.length} grupos`), ol);
  $indice.hidden = false;
}

// ---------- Estados ----------

function mostrarInicio() {
  $estado.textContent = '';
  mostrarIndice([]);

  const inicio = crear('div', 'inicio');
  inicio.append(
    crear('h2', 'inicio-titulo', '¿Qué medicamento buscas?'),
    crear('p', 'inicio-texto', 'Escribe el nombre, la marca o el principio activo. Prueba con:')
  );
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
  inicio.append(ejemplos);

  const pasos = crear('ol', 'pasos');
  const contenidoPasos = [
    ['buscar', 'Busca', 'Por nombre comercial, marca o principio activo, con o sin tildes.'],
    ['balanza', 'Compara por unidad', 'Agrupamos por sustancia y concentración y ordenamos por precio por tableta o cápsula, no por caja.'],
    ['alcancia', 'Ahorra', 'Toca una tarjeta para ver la opción más barata con la misma sustancia y cuánto ahorras.'],
  ];
  contenidoPasos.forEach(([nombreIcono, titulo, texto], i) => {
    const li = crear('li', 'paso');
    li.style.setProperty('--i', i);
    const iconoPaso = crear('span', 'paso-icono');
    iconoPaso.setAttribute('aria-hidden', 'true');
    iconoPaso.innerHTML = ICONOS[nombreIcono];
    const textoPaso = crear('div');
    textoPaso.append(crear('h3', null, titulo), crear('p', null, texto));
    li.append(iconoPaso, textoPaso);
    pasos.append(li);
  });
  inicio.append(pasos);
  $resultados.replaceChildren(inicio);
}

function mostrarVacio(titulo, texto) {
  const vacio = crear('div', 'vacio');
  vacio.insertAdjacentHTML('afterbegin', ILUSTRACION_VACIO);
  vacio.append(crear('h2', null, titulo), crear('p', null, texto));
  $resultados.replaceChildren(vacio);
}

function actualizar() {
  const consulta = $busqueda.value;
  if (normalizar(consulta).length < MIN_LETRAS) {
    mostrarInicio();
    return;
  }

  const { coincidencias, grupos } = buscar(consulta);
  if (grupos.length === 0) {
    $estado.textContent = '';
    mostrarIndice([]);
    mostrarVacio(
      `No encontramos «${consulta.trim()}»`,
      'Revisa cómo está escrito o prueba con el principio activo, por ejemplo acetaminofén.'
    );
    return;
  }

  const total = grupos.reduce((suma, g) => suma + g.length, 0);
  const textoGrupos = grupos.length === 1 ? '1 grupo' : `${grupos.length} grupos`;
  const textoOpciones = total === 1 ? '1 opción' : `${total} opciones`;
  $estado.textContent = `${textoOpciones} en ${textoGrupos} de sustancia y concentración`;
  mostrarIndice(grupos);
  $resultados.replaceChildren(...grupos.map((g) => crearGrupo(g, coincidencias)));
}

// ---------- Inicio ----------

async function iniciar() {
  try {
    const respuesta = await fetch(RUTA_DATOS, { cache: 'no-cache' });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    productos = convertirFilas(leerCSV(await respuesta.text()));
  } catch (error) {
    console.error('No se pudo cargar', RUTA_DATOS, error);
    $fechaTexto.textContent = 'Sin conexión con los datos';
    mostrarVacio('No pudimos cargar los precios', 'Revisa tu conexión e inténtalo de nuevo.');
    return;
  }

  farmacias = [...new Set(productos.map((p) => p.farmacia))].sort((a, b) => a.localeCompare(b, 'es'));
  mostrarDatosGenerales();
  $busqueda.disabled = false;
  $busqueda.addEventListener('input', actualizar);
  actualizar();
}

// Fondo para la barra de búsqueda cuando queda pegada arriba al hacer scroll.
const $barra = document.querySelector('.barra-busqueda');
window.addEventListener(
  'scroll',
  () => $barra.classList.toggle('pegada', $barra.getBoundingClientRect().top <= 0 && window.scrollY > 0),
  { passive: true }
);

// Atajos de teclado en computador: "/" enfoca el buscador, Escape lo limpia.
document.addEventListener('keydown', (evento) => {
  if (evento.key === '/' && document.activeElement !== $busqueda && !$busqueda.disabled) {
    evento.preventDefault();
    $busqueda.focus();
    $busqueda.select();
  } else if (evento.key === 'Escape' && document.activeElement === $busqueda && $busqueda.value) {
    $busqueda.value = '';
    actualizar();
  }
});

iniciar();
