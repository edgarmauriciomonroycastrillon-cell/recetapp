// MediFácil: lee data/precios.csv en el navegador, muestra el catálogo y compara por precio por unidad.

const RUTA_DATOS = 'data/precios.csv';
const MIN_LETRAS = 2;

// Nombre para mostrar, categoría y otros nombres con que la gente busca cada principio activo.
const MEDICAMENTOS = {
  LOSARTAN: { nombre: 'Losartán', categoria: 'Presión y corazón' },
  AMLODIPINO: { nombre: 'Amlodipino', categoria: 'Presión y corazón' },
  ENALAPRIL: { nombre: 'Enalapril', categoria: 'Presión y corazón' },
  'ACIDO ACETILSALICILICO': { nombre: 'Ácido acetilsalicílico', categoria: 'Presión y corazón', alias: 'aspirina asa' },
  ATORVASTATINA: { nombre: 'Atorvastatina', categoria: 'Colesterol' },
  ROSUVASTATINA: { nombre: 'Rosuvastatina', categoria: 'Colesterol' },
  METFORMINA: { nombre: 'Metformina', categoria: 'Diabetes' },
  ACETAMINOFEN: { nombre: 'Acetaminofén', categoria: 'Dolor y fiebre', alias: 'paracetamol' },
  IBUPROFENO: { nombre: 'Ibuprofeno', categoria: 'Dolor y fiebre' },
  NAPROXENO: { nombre: 'Naproxeno', categoria: 'Dolor y fiebre' },
  DICLOFENACO: { nombre: 'Diclofenaco', categoria: 'Dolor y fiebre' },
  OMEPRAZOL: { nombre: 'Omeprazol', categoria: 'Estómago' },
  ESOMEPRAZOL: { nombre: 'Esomeprazol', categoria: 'Estómago' },
  LORATADINA: { nombre: 'Loratadina', categoria: 'Alergias y asma' },
  CETIRIZINA: { nombre: 'Cetirizina', categoria: 'Alergias y asma' },
  MONTELUKAST: { nombre: 'Montelukast', categoria: 'Alergias y asma' },
  AMOXICILINA: { nombre: 'Amoxicilina', categoria: 'Antibióticos' },
  AZITROMICINA: { nombre: 'Azitromicina', categoria: 'Antibióticos' },
  LEVOTIROXINA: { nombre: 'Levotiroxina', categoria: 'Tiroides' },
  SERTRALINA: { nombre: 'Sertralina', categoria: 'Salud mental' },
};
const TODAS = 'Todos';

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
let categoriaActiva = TODAS;
// Filtros por farmacia y marca (vacío = todas). Se guardan en la URL: #farmacia=...&marca=...
let filtroFarmacias = new Set();
let filtroMarca = '';
let nombresMarca = new Map(); // clave -> nombre para mostrar
let modoCatalogo = (() => {
  try {
    return localStorage.getItem('medifacil-vista') === 'lista' ? 'lista' : 'cuadricula';
  } catch (error) {
    return 'cuadricula';
  }
})();

const $busqueda = document.getElementById('busqueda');
const $vista = document.getElementById('vista');
const $lateral = document.getElementById('lateral');
const $franja = document.getElementById('franja');
const $actualizado = document.getElementById('actualizado');
const $filtros = document.getElementById('filtros');

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

function infoMedicamento(principio) {
  const t = (principio || '').toLowerCase();
  return MEDICAMENTOS[principio] || { nombre: t.charAt(0).toUpperCase() + t.slice(1), categoria: 'Otros' };
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
    const info = infoMedicamento(p.principio_activo);
    p.texto_busqueda = normalizar(
      [p.producto, p.marca, p.principio_activo, info.nombre, info.alias || ''].join(' ')
    );
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

// "50 MG" → "50 mg".
function dosis(concentracion) {
  return (concentracion || '').replace(/\b(MCG|MG|G|UI)\b/, (u) => (u === 'UI' ? 'UI' : u.toLowerCase()));
}

// Concentración en miligramos para ordenar (50 mg antes que 100 mg).
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

// ---------- Filtros por farmacia y marca ----------

// Las farmacias escriben algunas marcas distinto: "AG" es American Generics, "Mkgenerico" es MK.
const ALIAS_MARCAS = { ag: 'americangenerics', mkgenerico: 'mk', lasantegenericos: 'lasante' };
const NOMBRE_MARCA_FIJO = { americangenerics: 'American Generics', mk: 'MK', lasante: 'La Santé' };

// "COASPHARMA" → "Coaspharma"; las siglas cortas ("MSD") se dejan en mayúsculas.
function nombrePropio(texto) {
  if (texto.length <= 3) return texto.toUpperCase();
  return texto.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, antes, letra) => antes + letra.toUpperCase());
}

function claveMarca(marca) {
  const clave = normalizar(marca).replace(/[^a-z0-9]/g, '');
  return ALIAS_MARCAS[clave] || clave;
}

// Nombre para mostrar de cada marca: la forma escrita más común, preferiblemente sin todo en mayúsculas.
function prepararMarcas() {
  const formas = new Map();
  for (const p of productos) {
    const clave = claveMarca(p.marca);
    if (!clave || clave === 'sinmarca') continue;
    if (!formas.has(clave)) formas.set(clave, new Map());
    const conteo = formas.get(clave);
    conteo.set(p.marca, (conteo.get(p.marca) || 0) + 1);
  }
  nombresMarca = new Map();
  for (const [clave, conteo] of formas) {
    const opciones = [...conteo.entries()].sort(
      (a, b) => (a[0] === a[0].toUpperCase()) - (b[0] === b[0].toUpperCase()) || b[1] - a[1]
    );
    const elegida = opciones[0][0];
    nombresMarca.set(
      clave,
      NOMBRE_MARCA_FIJO[clave] ||
        (elegida === elegida.toUpperCase() || elegida === elegida.toLowerCase() ? nombrePropio(elegida) : elegida)
    );
  }
}

function pasaFiltros(p, { ignorarMarca = false } = {}) {
  if (filtroFarmacias.size && !filtroFarmacias.has(p.farmacia)) return false;
  if (!ignorarMarca && filtroMarca && claveMarca(p.marca) !== filtroMarca) return false;
  return true;
}

function hayFiltros() {
  return filtroFarmacias.size > 0 || Boolean(filtroMarca);
}

function productosFiltrados() {
  return productos.filter((p) => pasaFiltros(p));
}

function buscar(consulta) {
  const base = productosFiltrados();
  const palabras = normalizar(consulta).split(/\s+/).filter(Boolean);
  const coincidencias = new Set(
    base.filter((p) => palabras.every((w) => p.texto_busqueda.includes(w)))
  );

  // Se muestra el grupo completo (misma sustancia y concentración) de cada coincidencia,
  // para ver también las alternativas más baratas.
  const grupos = new Map();
  for (const p of coincidencias) {
    const clave = `${p.principio_activo}|${p.concentracion}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
  }
  for (const p of base) {
    const clave = `${p.principio_activo}|${p.concentracion}`;
    if (grupos.has(clave)) grupos.get(clave).push(p);
  }

  return {
    coincidencias,
    grupos: [...grupos.values()]
      .map((lista) => lista.sort(porPrecioUnidad))
      .sort(
        (a, b) =>
          infoMedicamento(a[0].principio_activo).nombre.localeCompare(infoMedicamento(b[0].principio_activo).nombre, 'es') ||
          concentracionEnMg(a[0].concentracion) - concentracionEnMg(b[0].concentracion)
      ),
  };
}

// Un resumen por principio activo para el catálogo (respeta los filtros de farmacia y marca).
function resumenCatalogo() {
  const porPrincipio = new Map();
  for (const p of productosFiltrados()) {
    if (!porPrincipio.has(p.principio_activo)) porPrincipio.set(p.principio_activo, []);
    porPrincipio.get(p.principio_activo).push(p);
  }
  return [...porPrincipio.entries()]
    .map(([principio, lista]) => {
      const ordenada = [...lista].sort(porPrecioUnidad);
      const masBarato = ordenada.find((p) => p.precio_unidad != null);
      const conFoto = ordenada.find((p) => p.imagen) || null;
      const concentraciones = [...new Set(lista.map((p) => p.concentracion))].sort(
        (a, b) => concentracionEnMg(a) - concentracionEnMg(b)
      );
      return {
        principio,
        ...infoMedicamento(principio),
        precios: lista.length,
        farmacias: new Set(lista.map((p) => p.farmacia)).size,
        concentraciones,
        masBarato,
        imagen: conFoto ? conFoto.imagen : '',
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------- Utilidades de interfaz ----------

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

const ICONO_CAJA =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>';
const ICONO_FLECHA =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

// Foto del producto (del catálogo de la farmacia); si no carga, un ícono de caja.
function foto(url, alt) {
  const marco = crear('div', 'foto');
  const ponerIcono = () => {
    marco.innerHTML = ICONO_CAJA;
    marco.setAttribute('aria-hidden', 'true');
  };
  if (!url) {
    ponerIcono();
    return marco;
  }
  const img = document.createElement('img');
  img.src = url;
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', ponerIcono, { once: true });
  marco.append(img);
  return marco;
}

function claseFarmacia(nombre) {
  const i = farmacias.indexOf(nombre);
  return `farmacia farmacia-${(i < 0 ? 0 : i) % 4}`;
}

function idGrupo(p) {
  return 'g-' + normalizar(`${p.principio_activo}-${p.concentracion}`).replace(/[^a-z0-9]+/g, '-');
}

function enlaceTienda(url, texto, clase = 'boton') {
  const enlace = crear('a', clase, texto);
  enlace.href = url;
  enlace.target = '_blank';
  enlace.rel = 'noopener noreferrer';
  return enlace;
}

function listaFarmacias() {
  if (farmacias.length <= 1) return farmacias.join('');
  return `${farmacias.slice(0, -1).join(', ')} y ${farmacias[farmacias.length - 1]}`;
}

function mostrarDatosGenerales() {
  const fechas = [...new Set(productos.map((p) => p.fecha).filter(Boolean))].sort();
  const ultima = fechas[fechas.length - 1];
  const sustancias = new Set(productos.map((p) => p.principio_activo)).size;

  $franja.replaceChildren(
    'Comparamos ',
    crear('strong', null, `${numeroCO.format(productos.length)} precios`),
    ' de ',
    crear('strong', null, `${sustancias} medicamentos`),
    ` en ${listaFarmacias()}.`,
    fechas.length > 1
      ? ` Precios consultados entre el ${fechaLarga(fechas[0])} y el ${fechaLarga(ultima)}.`
      : ultima ? ` Precios consultados el ${fechaLarga(ultima)}.` : ''
  );
  $actualizado.replaceChildren(
    ultima ? `Precios del ${fechaCorta(ultima)}` : '',
    crear('span', 'solo-escritorio', 'Se actualizan cada día a las 7:00 a. m.')
  );
  document.getElementById('fuentes').textContent = listaFarmacias();
}

// ---------- Catálogo ----------

function mostrarCatalogo() {
  const resumen = resumenCatalogo();
  const categorias = [...new Set(resumen.map((m) => m.categoria))].sort((a, b) => a.localeCompare(b, 'es'));
  if (categoriaActiva !== TODAS && !categorias.includes(categoriaActiva)) categoriaActiva = TODAS;

  // Lateral: categorías
  const ul = crear('ul');
  for (const categoria of [TODAS, ...categorias]) {
    const cuantos = categoria === TODAS ? resumen.length : resumen.filter((m) => m.categoria === categoria).length;
    const boton = crear('button', 'filtro');
    boton.type = 'button';
    boton.setAttribute('aria-pressed', String(categoria === categoriaActiva));
    boton.append(crear('span', null, categoria), crear('small', null, String(cuantos)));
    boton.addEventListener('click', () => {
      categoriaActiva = categoria;
      mostrarCatalogo();
    });
    const li = crear('li');
    li.append(boton);
    ul.append(li);
  }
  $lateral.setAttribute('aria-label', 'Categorías');
  $lateral.replaceChildren(crear('p', 'lateral-titulo', 'Categorías'), ul);

  // Vista: tarjetas de medicamentos
  const visibles = resumen.filter((m) => categoriaActiva === TODAS || m.categoria === categoriaActiva);
  const cabeza = crear('div', 'vista-cabeza');
  cabeza.append(
    crear('h1', 'vista-titulo', categoriaActiva === TODAS ? 'Medicamentos disponibles' : categoriaActiva),
    crear('p', 'vista-sub',
      `${visibles.length} ${visibles.length === 1 ? 'medicamento' : 'medicamentos'} con precios en ` +
      `${filtroFarmacias.size ? listaDe([...filtroFarmacias]) : listaFarmacias()}` +
      (filtroMarca ? ` de la marca ${nombresMarca.get(filtroMarca)}` : '') +
      '. Elige uno para ver y comparar todos sus precios.')
  );

  // Ver como cuadrícula o como lista (se recuerda en este navegador)
  const selector = crear('div', 'ver-como');
  selector.setAttribute('role', 'group');
  selector.setAttribute('aria-label', 'Ver como');
  for (const [valor, texto] of [['cuadricula', 'Cuadrícula'], ['lista', 'Lista']]) {
    const boton = crear('button', 'ver-como-boton', texto);
    boton.type = 'button';
    boton.setAttribute('aria-pressed', String(modoCatalogo === valor));
    boton.addEventListener('click', () => {
      modoCatalogo = valor;
      try {
        localStorage.setItem('medifacil-vista', valor);
      } catch (error) {
        // sin almacenamiento (modo privado): solo no se recuerda
      }
      mostrarCatalogo();
    });
    selector.append(boton);
  }
  cabeza.append(selector);

  const lista = crear('ul', 'catalogo' + (modoCatalogo === 'lista' ? ' en-lista' : ''));
  for (const m of visibles) {
    const boton = crear('button', 'medicamento');
    boton.type = 'button';
    boton.append(foto(m.imagen, `Caja de ${m.nombre}`));
    const info = crear('span', 'medicamento-info');
    info.append(
      crear('span', 'medicamento-categoria', m.categoria),
      crear('span', 'medicamento-nombre', m.nombre),
      crear('span', 'medicamento-dosis', m.concentraciones.map(dosis).join(' · '))
    );
    const precio = crear('span', 'medicamento-precio');
    if (m.masBarato) {
      precio.append('Desde ', crear('strong', null, `${pesos.format(m.masBarato.precio_unidad)} por unidad`));
    }
    precio.append(crear('span', 'medicamento-cuantos',
      `${m.precios} precios en ${m.farmacias} ${m.farmacias === 1 ? 'farmacia' : 'farmacias'}`));
    info.append(precio);
    boton.append(info);
    boton.addEventListener('click', () => irA(m.nombre, true));
    const li = crear('li');
    li.append(boton);
    lista.append(li);
  }
  $vista.replaceChildren(cabeza, lista);
}

// ---------- Resultados ----------

function crearOferta(p, info, indice) {
  const { grupo, minimo, media, coincide } = info;
  const esMasBarata = minimo != null && p.precio_unidad === minimo;

  const li = crear('li', 'oferta' + (esMasBarata ? ' mas-barata' : ''));
  const fila = crear('div', 'oferta-fila');

  fila.append(foto(p.imagen, p.producto));

  const datos = crear('div', 'oferta-info');
  const insignias = crear('div', 'oferta-insignias');
  if (esMasBarata) insignias.append(crear('span', 'insignia insignia-barata', 'Precio más bajo'));
  if (coincide) insignias.append(crear('span', 'insignia insignia-coincide', 'Coincide con tu búsqueda'));
  if (insignias.hasChildNodes()) datos.append(insignias);
  datos.append(crear('h3', 'oferta-producto', p.producto));
  const detalle = crear('p', 'oferta-detalle');
  detalle.append(
    crear('span', claseFarmacia(p.farmacia), p.farmacia),
    ` · ${p.marca || 'Sin marca'} · ${p.presentacion || 'Sin presentación'} · precio del ${fechaCorta(p.fecha)}`
  );
  datos.append(detalle);
  fila.append(datos);

  const precio = crear('div', 'oferta-precio');
  if (p.precio_unidad != null) {
    const unidad = crear('span', 'precio-unidad', pesos.format(p.precio_unidad));
    unidad.append(' ', crear('small', null, 'c/u'));
    precio.append(unidad);
  } else {
    precio.append(crear('span', 'precio-unidad sin-dato', 'Sin precio por unidad'));
  }
  if (p.precio != null) {
    precio.append(crear('span', 'precio-caja',
      `${pesos.format(p.precio)}${p.unidades ? ` por ${p.unidades} unidades` : ''}`));
  }
  if (p.precio_unidad != null && minimo != null) {
    // Frente al más barato: cuánto más cuesta por unidad, en pesos y en %.
    if (!esMasBarata) {
      precio.append(crear('span', 'diferencia',
        `+${pesos.format(p.precio_unidad - minimo)} c/u (+${porcentajeCO.format((p.precio_unidad - minimo) / minimo)}) vs. el más barato`));
    }
    // Frente a la media del grupo (solo si hay con qué comparar).
    if (media != null && grupo.filter((g) => g.precio_unidad != null).length > 1) {
      const diferencia = (p.precio_unidad - media) / media;
      let texto = 'en la media';
      if (Math.abs(diferencia) >= 0.005) {
        texto = `${porcentajeCO.format(Math.abs(diferencia))} ${diferencia < 0 ? 'bajo' : 'sobre'} la media`;
      }
      precio.append(crear('span', `frente-media ${diferencia < 0 ? 'bajo-media' : 'sobre-media'}`, texto));
    }
  }
  fila.append(precio);

  const acciones = crear('div', 'oferta-acciones');
  const boton = crear('button', 'boton boton-alternativa', 'Más barato');
  boton.type = 'button';
  boton.setAttribute('aria-expanded', 'false');
  boton.insertAdjacentHTML('beforeend', ICONO_FLECHA);
  acciones.append(boton);
  if (p.url) acciones.append(enlaceTienda(p.url, 'Ver en tienda', 'boton boton-solido'));
  fila.append(acciones);
  li.append(fila);

  // "Misma sustancia, más barato": se abre al tocar la fila.
  const envoltura = crear('div', 'alternativa-envoltura');
  const panel = crear('div', 'alternativa');
  const interior = crear('div', 'alternativa-interior');
  panel.append(interior);
  envoltura.append(panel);
  li.append(envoltura);

  boton.addEventListener('click', () => {
    const abrir = !li.classList.contains('abierta');
    if (abrir && !interior.hasChildNodes()) interior.append(...contenidoAlternativa(p, grupo));
    li.classList.toggle('abierta', abrir);
    boton.setAttribute('aria-expanded', String(abrir));
  });
  fila.addEventListener('click', (evento) => {
    if (evento.target.closest('a, button')) return;
    boton.click();
  });
  li.style.animationDelay = `${Math.min(indice, 10) * 20}ms`;
  return li;
}

// Compara el producto con el más barato por unidad de su grupo (misma sustancia y concentración).
function contenidoAlternativa(p, grupo) {
  const titulo = crear('p', 'alternativa-titulo', 'Misma sustancia, más barato');
  const nombreGrupo = `${infoMedicamento(p.principio_activo).nombre} ${dosis(p.concentracion)}`;

  if (p.precio_unidad == null || !p.unidades) {
    return [titulo, crear('p', null,
      'Este producto no informa cuántas unidades trae, así que no se puede comparar ' +
      'su precio por unidad con las demás opciones.')];
  }

  const masBarato = grupo.find((otro) => otro.precio_unidad != null); // el grupo viene ordenado
  if (p.precio_unidad <= masBarato.precio_unidad) {
    return [titulo, crear('p', 'ya-barato',
      `Este ya es el más barato por unidad entre las ${grupo.length} opciones de ${nombreGrupo}.`)];
  }

  const porcentaje = (p.precio_unidad - masBarato.precio_unidad) / p.precio_unidad;
  const costoActual = p.precio_unidad * p.unidades;
  const costoBarato = masBarato.precio_unidad * p.unidades;

  const ahorro = crear('div', 'ahorro');
  ahorro.append(
    crear('span', 'ahorro-porcentaje', `${porcentajeCO.format(porcentaje)} menos`),
    crear('span', 'ahorro-texto',
      `Por las mismas ${p.unidades} unidades pagarías ${pesos.format(costoBarato)} en vez de ` +
      `${pesos.format(costoActual)}: ahorras ${pesos.format(costoActual - costoBarato)}.`)
  );

  const sugerido = crear('div', 'sugerido');
  sugerido.append(foto(masBarato.imagen, masBarato.producto));
  const texto = crear('div');
  const detalle = crear('p');
  detalle.append(
    crear('span', claseFarmacia(masBarato.farmacia), masBarato.farmacia),
    ` · ${masBarato.marca || 'Sin marca'} · ${masBarato.presentacion || ''}`
  );
  texto.append(
    crear('p', 'sugerido-nombre', masBarato.producto),
    detalle,
    crear('p', null,
      `${pesos.format(masBarato.precio_unidad)} por unidad · ${pesos.format(masBarato.precio)}` +
      `${masBarato.unidades ? ` por ${masBarato.unidades} unidades` : ''} · precio del ${fechaCorta(masBarato.fecha)}`)
  );
  if (masBarato.url) texto.append(enlaceTienda(masBarato.url, `Ver en ${masBarato.farmacia}`));
  sugerido.append(texto);

  return [titulo, ahorro, sugerido];
}

function crearGrupo(lista, coincidencias) {
  const primero = lista[0];
  const seccion = crear('section', 'grupo');
  seccion.id = idGrupo(primero);

  const conPrecio = lista.filter((p) => p.precio_unidad != null);
  const minimo = conPrecio.length ? conPrecio[0].precio_unidad : null;
  const maximo = conPrecio.length ? conPrecio[conPrecio.length - 1].precio_unidad : null;
  // Media (promedio) del precio por unidad del grupo
  const media = conPrecio.length ? conPrecio.reduce((suma, p) => suma + p.precio_unidad, 0) / conPrecio.length : null;

  const cabeza = crear('header', 'grupo-cabeza');
  cabeza.append(crear('h2', 'grupo-titulo',
    `${infoMedicamento(primero.principio_activo).nombre} ${dosis(primero.concentracion)}`));
  const numFarmacias = new Set(lista.map((p) => p.farmacia)).size;
  const meta = crear('p', 'grupo-meta',
    `${lista.length} ${lista.length === 1 ? 'precio' : 'precios'} en ${numFarmacias} ${numFarmacias === 1 ? 'farmacia' : 'farmacias'}`);
  if (media != null && conPrecio.length > 1) {
    meta.append(` · media ${pesos.format(media)} c/u · el más barato está `,
      crear('strong', null, `${porcentajeCO.format((media - minimo) / media)} por debajo de la media`));
  }
  cabeza.append(meta);
  seccion.append(cabeza);

  // "Coincide" solo aporta si el grupo mezcla productos que coinciden y que no (p. ej. al buscar una marca).
  const marcarCoincidencias = lista.some((p) => !coincidencias.has(p));
  const ul = crear('ul', 'ofertas');
  lista.forEach((p, i) => {
    const coincide = marcarCoincidencias && coincidencias.has(p);
    ul.append(crearOferta(p, { grupo: lista, minimo, media, coincide }, i));
  });
  seccion.append(ul);
  return seccion;
}

function mostrarResultados(consulta) {
  const { coincidencias, grupos } = buscar(consulta);
  const volver = crear('button', 'volver', '← Todos los medicamentos');
  volver.type = 'button';
  volver.addEventListener('click', () => irA('', true));

  if (grupos.length === 0) {
    $lateral.replaceChildren(volver);
    const vacio = crear('div', 'vacio');
    // ¿No hay resultados por la búsqueda o por los filtros?
    const sinFiltros = hayFiltros() && productos.some((p) => normalizar(consulta).split(/\s+/).every((w) => p.texto_busqueda.includes(w)));
    if (sinFiltros) {
      vacio.append(
        crear('h1', 'vista-titulo', `No hay precios de «${consulta.trim()}» con estos filtros`),
        crear('p', null, `Filtro activo: ${textoFiltros()}. Quita o cambia los filtros para ver más opciones.`)
      );
      const quitar = crear('button', 'boton boton-solido', 'Quitar filtros');
      quitar.type = 'button';
      quitar.addEventListener('click', () => {
        filtroFarmacias = new Set();
        filtroMarca = '';
        cambiarFiltros();
      });
      vacio.append(quitar);
    } else {
      vacio.append(
        crear('h1', 'vista-titulo', `No encontramos «${consulta.trim()}»`),
        crear('p', null,
          'Revisa cómo está escrito o busca por principio activo. Por ahora comparamos estos 20 medicamentos:')
      );
      const ver = crear('button', 'boton boton-solido', 'Ver los medicamentos disponibles');
      ver.type = 'button';
      ver.addEventListener('click', () => irA('', true));
      vacio.append(ver);
    }
    $vista.replaceChildren(vacio);
    return;
  }

  // Lateral: índice de grupos
  const ul = crear('ul');
  for (const lista of grupos) {
    const primero = lista[0];
    const enlace = crear('a', 'filtro');
    enlace.href = `#${idGrupo(primero)}`;
    enlace.addEventListener('click', (evento) => {
      evento.preventDefault();
      document.getElementById(idGrupo(primero)).scrollIntoView({ behavior: 'smooth' });
    });
    enlace.append(crear('span', null, `${infoMedicamento(primero.principio_activo).nombre} ${dosis(primero.concentracion)}`));
    const conPrecio = lista.find((p) => p.precio_unidad != null);
    if (conPrecio) enlace.append(crear('small', null, pesos.format(conPrecio.precio_unidad)));
    const li = crear('li');
    li.append(enlace);
    ul.append(li);
  }
  $lateral.setAttribute('aria-label', 'Concentraciones encontradas');
  $lateral.replaceChildren(volver, crear('p', 'lateral-titulo', 'En esta búsqueda'), ul);

  // Título: el nombre del medicamento si todos los grupos son de la misma sustancia.
  const principios = new Set(grupos.map((g) => g[0].principio_activo));
  const total = grupos.reduce((suma, g) => suma + g.length, 0);
  const cabeza = crear('div', 'vista-cabeza');
  const migas = crear('p', 'migas');
  const inicio = crear('a', null, 'Medicamentos');
  inicio.href = '#';
  inicio.addEventListener('click', (evento) => {
    evento.preventDefault();
    irA('', true);
  });
  const unico = principios.size === 1 ? infoMedicamento([...principios][0]) : null;
  migas.append(inicio, unico ? ` › ${unico.categoria}` : ' › Búsqueda');
  cabeza.append(
    migas,
    crear('h1', 'vista-titulo', unico ? unico.nombre : `Resultados para «${consulta.trim()}»`),
    crear('p', 'vista-sub',
      `${total} ${total === 1 ? 'precio' : 'precios'} en ${grupos.length} ${grupos.length === 1 ? 'concentración' : 'concentraciones'}` +
      (hayFiltros() ? ` (filtro: ${textoFiltros()})` : '') +
      ', ordenados por precio por unidad. Toca una fila para ver la opción más barata con la misma sustancia.')
  );
  $vista.replaceChildren(cabeza, ...grupos.map((g) => crearGrupo(g, coincidencias)));
}

// ---------- Lista desplegable del buscador ----------

const $cajaSugerencias = document.getElementById('sugerencias-caja');
const $sugerencias = document.getElementById('sugerencias');
const MAX_PRODUCTOS_SUGERIDOS = 8;
let opciones = []; // [{ el, elegir }]
let opcionActiva = -1;

function crearOpcion(id, imagen, titulo, detalle, precio, elegir) {
  const li = crear('li', 'opcion');
  li.id = id;
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', 'false');
  li.append(foto(imagen, ''));
  const textos = crear('span', 'opcion-textos');
  textos.append(crear('span', 'opcion-titulo', titulo), crear('span', 'opcion-detalle', detalle));
  li.append(textos);
  if (precio) li.append(crear('span', 'opcion-precio', precio));
  // mousedown para que el clic llegue antes de que el buscador pierda el foco
  li.addEventListener('mousedown', (evento) => {
    evento.preventDefault();
    elegir();
  });
  opciones.push({ el: li, elegir });
  return li;
}

function mostrarSugerencias() {
  const texto = normalizar($busqueda.value);
  opciones = [];
  opcionActiva = -1;
  $busqueda.removeAttribute('aria-activedescendant');

  const medicamentos = resumenCatalogo().filter(
    (m) => !texto || normalizar(`${m.nombre} ${m.principio} ${m.alias || ''} ${m.categoria}`).includes(texto)
  );
  const elementos = [];

  if (medicamentos.length) {
    elementos.push(crear('li', 'opcion-grupo',
      texto ? 'Medicamentos' : `Todos los medicamentos disponibles (${medicamentos.length})`));
    medicamentos.forEach((m, i) => {
      elementos.push(crearOpcion(
        `opcion-m-${i}`, m.imagen, m.nombre,
        `${m.categoria} · ${m.concentraciones.map(dosis).join(', ')}`,
        m.masBarato ? `desde ${pesos.format(m.masBarato.precio_unidad)} c/u` : '',
        () => elegirSugerencia(m.nombre)
      ));
    });
  }

  // Con texto, también productos concretos (marcas como Dolex o Cozaar).
  if (texto.length >= MIN_LETRAS) {
    const palabras = texto.split(/\s+/);
    const vistos = new Set();
    const encontrados = [];
    for (const p of productosFiltrados().sort(porPrecioUnidad)) {
      const clave = normalizar(p.producto);
      if (vistos.has(clave) || !palabras.every((w) => p.texto_busqueda.includes(w))) continue;
      vistos.add(clave);
      encontrados.push(p);
    }
    if (encontrados.length) {
      elementos.push(crear('li', 'opcion-grupo', `Productos (${encontrados.length})`));
      encontrados.slice(0, MAX_PRODUCTOS_SUGERIDOS).forEach((p, i) => {
        elementos.push(crearOpcion(
          `opcion-p-${i}`, p.imagen, p.producto,
          `${p.farmacia} · ${infoMedicamento(p.principio_activo).nombre} ${dosis(p.concentracion)}`,
          p.precio_unidad != null ? `${pesos.format(p.precio_unidad)} c/u` : '',
          () => elegirSugerencia(p.producto)
        ));
      });
    }
  }

  if (!elementos.length) {
    elementos.push(crear('li', 'opcion-vacia', 'No hay medicamentos con ese nombre. Prueba con el principio activo.'));
  }
  elementos.forEach((el) => {
    if (!el.getAttribute('role')) el.setAttribute('role', 'presentation');
  });
  $sugerencias.replaceChildren(...elementos);
  $cajaSugerencias.hidden = false;
  $busqueda.setAttribute('aria-expanded', 'true');
}

function cerrarSugerencias() {
  $cajaSugerencias.hidden = true;
  $busqueda.setAttribute('aria-expanded', 'false');
  $busqueda.removeAttribute('aria-activedescendant');
  opcionActiva = -1;
}

function marcarOpcion(indice) {
  if (!opciones.length) return;
  opcionActiva = (indice + opciones.length) % opciones.length;
  opciones.forEach(({ el }, i) => el.setAttribute('aria-selected', String(i === opcionActiva)));
  const { el } = opciones[opcionActiva];
  $busqueda.setAttribute('aria-activedescendant', el.id);
  el.scrollIntoView({ block: 'nearest' });
}

function elegirSugerencia(consulta) {
  cerrarSugerencias();
  irA(consulta, true);
  $busqueda.blur();
}

// ---------- Navegación ----------

// Lee búsqueda y filtros de la URL: #q=losartan&farmacia=Locatel,Olímpica&marca=genfar
function leerUrl() {
  const parametros = new URLSearchParams(location.hash.slice(1));
  $busqueda.value = parametros.get('q') || '';
  filtroFarmacias = new Set(
    (parametros.get('farmacia') || '').split(',').filter((f) => farmacias.includes(f))
  );
  const marca = parametros.get('marca') || '';
  filtroMarca = nombresMarca.has(marca) ? marca : '';
}

function hashActual() {
  const parametros = new URLSearchParams();
  if ($busqueda.value) parametros.set('q', $busqueda.value);
  if (filtroFarmacias.size) parametros.set('farmacia', [...filtroFarmacias].join(','));
  if (filtroMarca) parametros.set('marca', filtroMarca);
  const texto = parametros.toString();
  return texto ? `#${texto}` : location.pathname + location.search;
}

function mostrar() {
  mostrarFiltros();
  const consulta = $busqueda.value;
  if (normalizar(consulta).length < MIN_LETRAS) mostrarCatalogo();
  else mostrarResultados(consulta);
}

// Cambia la vista y la URL para que funcionen el botón "atrás" y compartir el enlace.
function irA(consulta, nuevaEntrada) {
  $busqueda.value = consulta;
  if (nuevaEntrada) history.pushState(null, '', hashActual());
  else history.replaceState(null, '', hashActual());
  mostrar();
  if (nuevaEntrada) window.scrollTo({ top: 0 });
}

function cambiarFiltros() {
  history.replaceState(null, '', hashActual());
  mostrar();
}

// Barra de filtros: farmacias (se pueden elegir varias) y marca.
function mostrarFiltros() {
  const barra = crear('div', 'filtros-fila');

  const grupoFarmacia = crear('div', 'filtro-grupo');
  grupoFarmacia.setAttribute('role', 'group');
  grupoFarmacia.setAttribute('aria-label', 'Filtrar por farmacia');
  grupoFarmacia.append(crear('span', 'filtro-etiqueta', 'Farmacia'));
  const todas = crear('button', 'chip', 'Todas');
  todas.type = 'button';
  todas.setAttribute('aria-pressed', String(filtroFarmacias.size === 0));
  todas.addEventListener('click', () => {
    filtroFarmacias = new Set();
    cambiarFiltros();
  });
  grupoFarmacia.append(todas);
  for (const farmacia of farmacias) {
    const chip = crear('button', 'chip');
    chip.type = 'button';
    chip.append(crear('span', claseFarmacia(farmacia), farmacia));
    chip.setAttribute('aria-pressed', String(filtroFarmacias.has(farmacia)));
    chip.addEventListener('click', () => {
      if (filtroFarmacias.has(farmacia)) filtroFarmacias.delete(farmacia);
      else filtroFarmacias.add(farmacia);
      if (filtroFarmacias.size === farmacias.length) filtroFarmacias = new Set(); // todas = sin filtro
      cambiarFiltros();
    });
    grupoFarmacia.append(chip);
  }
  barra.append(grupoFarmacia);

  // Marcas disponibles con las farmacias elegidas, de la más común a la menos común.
  const conteo = new Map();
  for (const p of productos) {
    if (!pasaFiltros(p, { ignorarMarca: true })) continue;
    const clave = claveMarca(p.marca);
    if (nombresMarca.has(clave)) conteo.set(clave, (conteo.get(clave) || 0) + 1);
  }
  if (filtroMarca && !conteo.has(filtroMarca)) conteo.set(filtroMarca, 0);
  const grupoMarca = crear('label', 'filtro-grupo');
  grupoMarca.append(crear('span', 'filtro-etiqueta', 'Marca'));
  const selector = crear('select', 'filtro-marca');
  const opcionTodas = crear('option', null, `Todas las marcas (${conteo.size})`);
  opcionTodas.value = '';
  selector.append(opcionTodas);
  [...conteo.entries()]
    .sort((a, b) => b[1] - a[1] || nombresMarca.get(a[0]).localeCompare(nombresMarca.get(b[0]), 'es'))
    .forEach(([clave, cuantos]) => {
      const opcion = crear('option', null, `${nombresMarca.get(clave)} (${cuantos})`);
      opcion.value = clave;
      opcion.selected = clave === filtroMarca;
      selector.append(opcion);
    });
  selector.addEventListener('change', () => {
    filtroMarca = selector.value;
    cambiarFiltros();
  });
  grupoMarca.append(selector);
  barra.append(grupoMarca);

  if (hayFiltros()) {
    const quitar = crear('button', 'quitar-filtros', 'Quitar filtros');
    quitar.type = 'button';
    quitar.addEventListener('click', () => {
      filtroFarmacias = new Set();
      filtroMarca = '';
      cambiarFiltros();
    });
    barra.append(quitar);
  }
  $filtros.replaceChildren(barra);
}

function textoFiltros() {
  const partes = [];
  if (filtroFarmacias.size) partes.push(listaDe([...filtroFarmacias]));
  if (filtroMarca) partes.push(`marca ${nombresMarca.get(filtroMarca)}`);
  return partes.join(', ');
}

function listaDe(nombres) {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

async function iniciar() {
  try {
    const respuesta = await fetch(RUTA_DATOS, { cache: 'no-cache' });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    productos = convertirFilas(leerCSV(await respuesta.text()));
  } catch (error) {
    console.error('No se pudo cargar', RUTA_DATOS, error);
    $franja.textContent = 'No pudimos cargar los precios. Revisa tu conexión e inténtalo de nuevo.';
    $vista.replaceChildren();
    return;
  }

  farmacias = [...new Set(productos.map((p) => p.farmacia))].sort((a, b) => a.localeCompare(b, 'es'));
  prepararMarcas();
  mostrarDatosGenerales();
  $busqueda.disabled = false;
  leerUrl();
  $busqueda.addEventListener('input', () => {
    irA($busqueda.value, false);
    mostrarSugerencias();
  });
  $busqueda.addEventListener('focus', mostrarSugerencias);
  $busqueda.addEventListener('click', () => {
    if ($cajaSugerencias.hidden) mostrarSugerencias();
  });
  $busqueda.addEventListener('blur', cerrarSugerencias);
  $busqueda.addEventListener('keydown', (evento) => {
    const abierta = !$cajaSugerencias.hidden;
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      if (!abierta) mostrarSugerencias();
      marcarOpcion(opcionActiva + 1);
    } else if (evento.key === 'ArrowUp' && abierta) {
      evento.preventDefault();
      marcarOpcion(opcionActiva - 1);
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      if (abierta && opcionActiva >= 0) opciones[opcionActiva].elegir();
      else cerrarSugerencias();
    } else if (evento.key === 'Escape' && abierta) {
      evento.preventDefault();
      evento.stopPropagation();
      cerrarSugerencias();
    }
  });
  window.addEventListener('popstate', () => {
    leerUrl();
    mostrar();
  });
  document.getElementById('logo').addEventListener('click', (evento) => {
    evento.preventDefault();
    categoriaActiva = TODAS;
    irA('', true);
  });
  mostrar();
}

// Atajos de teclado en computador: "/" enfoca el buscador, Escape lo limpia.
document.addEventListener('keydown', (evento) => {
  if (evento.key === '/' && document.activeElement !== $busqueda && !$busqueda.disabled) {
    evento.preventDefault();
    $busqueda.focus();
    $busqueda.select();
  } else if (evento.key === 'Escape' && document.activeElement === $busqueda && $busqueda.value) {
    irA('', false);
  }
});

iniciar();
