'use strict';

const CLAVES = { config: 'finanzas.config', cache: 'finanzas.cache', demo: 'finanzas.demo' };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const estado = {
  config: leer(CLAVES.config) || {},
  movimientos: [],
  categorias: [],
  metodos: [],
  mes: fechaISO(new Date()).slice(0, 7),
  vista: 'resumen',
  nuevo: null
};

const $ = sel => document.querySelector(sel);

function leer(clave) {
  try { return JSON.parse(localStorage.getItem(clave)); } catch (e) { return null; }
}
function guardar(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento: seguimos en memoria */ }
}
function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function suma(movs) {
  return movs.reduce((t, m) => t + Number(m.importe), 0);
}
function capitalizar(t) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// --- Datos ------------------------------------------------------------------

async function api(action, datos = {}) {
  if (!estado.config.url) return demo(action, datos);
  const r = await fetch(estado.config.url, {
    method: 'POST',
    // text/plain evita la petición previa de CORS, que Apps Script no responde
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: estado.config.token, action, ...datos })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error);
  return j.data;
}

// Sin hoja conectada, la app funciona en modo demo con los datos en este dispositivo.
function demo(action, datos) {
  const db = leer(CLAVES.demo) || { movimientos: [], categorias: CATEGORIAS_INICIALES.map(c => ({ ...c })) };
  if (!db.metodos) db.metodos = METODOS_INICIALES.map(m => ({ ...m }));
  let res;
  if (action === 'all') res = db;
  if (action === 'add') {
    res = { ...datos.mov, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), origen: 'app', creado: new Date().toISOString() };
    db.movimientos.push(res);
  }
  if (action === 'delete') {
    db.movimientos = db.movimientos.filter(m => m.id !== datos.id);
    res = { id: datos.id };
  }
  if (action === 'saveCategories') {
    db.categorias = datos.categorias;
    res = db.categorias;
  }
  if (action === 'saveMetodos') {
    db.metodos = datos.metodos;
    res = db.metodos;
  }
  guardar(CLAVES.demo, db);
  return Promise.resolve(JSON.parse(JSON.stringify(res)));
}

function aplicar(datos) {
  estado.movimientos = datos.movimientos || [];
  estado.categorias = datos.categorias || [];
  estado.metodos = datos.metodos || [];
  render();
}

function guardarCache() {
  guardar(CLAVES.cache, { url: estado.config.url, movimientos: estado.movimientos, categorias: estado.categorias, metodos: estado.metodos });
}

async function cargar() {
  const cache = leer(CLAVES.cache);
  if (cache && cache.url === estado.config.url) aplicar(cache);
  try {
    aplicar(await api('all'));
    guardarCache();
  } catch (e) {
    aviso('Sin conexión: muestro lo último guardado');
  }
}

// --- Pantallas --------------------------------------------------------------

function nombreMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return capitalizar(MESES[m - 1]) + ' ' + a;
}

function nombreDia(iso) {
  const hoy = new Date();
  if (iso === fechaISO(hoy)) return 'Hoy';
  hoy.setDate(hoy.getDate() - 1);
  if (iso === fechaISO(hoy)) return 'Ayer';
  return capitalizar(new Date(iso + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
}

function delMes() {
  return estado.movimientos.filter(m => String(m.fecha).startsWith(estado.mes));
}

function cambiarMes(delta) {
  const [a, m] = estado.mes.split('-').map(Number);
  estado.mes = fechaISO(new Date(a, m - 1 + delta, 1)).slice(0, 7);
  render();
}

function cambiarVista(vista) {
  estado.vista = vista;
  render();
  if (vista === 'ajustes') renderAjustes();
  window.scrollTo(0, 0);
}

function render() {
  const enAjustes = estado.vista === 'ajustes';
  document.querySelectorAll('.vista').forEach(v => { v.hidden = v.id !== 'vista-' + estado.vista; });
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('activa', b.dataset.vista === estado.vista));
  $('#titulo').textContent = enAjustes ? 'Ajustes' : nombreMes(estado.mes);
  $('#mes-anterior').style.visibility = $('#mes-siguiente').style.visibility = enAjustes ? 'hidden' : '';
  $('#modo-demo').hidden = !!estado.config.url;
  $('#fab').hidden = enAjustes;
  if (estado.vista === 'resumen') renderResumen();
  if (estado.vista === 'movimientos') renderMovimientos();
}

function nivel(restante) {
  if (restante === null) return 'neutro';
  return restante < 0 ? 'mal' : restante < 0.2 ? 'justo' : 'bien';
}

function anillo(restante) {
  const r = 34, largo = 2 * Math.PI * r;
  // Pasado de presupuesto: anillo entero en rojo.
  const f = restante === null ? 0 : restante < 0 ? 1 : Math.min(1, restante);
  return `<div class="anillo ${nivel(restante)}">
      <svg viewBox="0 0 80 80" aria-hidden="true">
        <circle class="pista" cx="40" cy="40" r="${r}"/>
        ${f > 0 ? `<circle class="valor" cx="40" cy="40" r="${r}" stroke-dasharray="${f * largo} ${largo}" transform="rotate(-90 40 40)"/>` : ''}
      </svg>
      <span>${restante === null ? '–' : Math.round(Math.max(0, restante) * 100) + '%'}</span>
    </div>`;
}

function filaCategoria(c) {
  const presupuesto = Number(c.presupuesto) || 0;
  const restante = presupuesto ? 1 - c.gastado / presupuesto : null;
  const detalle = !presupuesto ? 'Sin presupuesto'
    : restante < 0 ? `Te has pasado ${formatearEuros(c.gastado - presupuesto)}`
    : `Te queda un ${Math.round(restante * 100)}%: ${formatearEuros(presupuesto - c.gastado)}`;
  return `<div class="cat ${nivel(restante)}">
      <span class="emoji">${esc(c.emoji)}</span>
      <div class="cat-cuerpo">
        <div class="cat-linea">
          <strong>${esc(c.nombre)}</strong>
          <span>${formatearEuros(c.gastado)}${presupuesto ? ` <small>/ ${formatearEuros(presupuesto)}</small>` : ''}</span>
        </div>
        ${presupuesto ? `<div class="barra"><span style="width:${Math.min(1, c.gastado / presupuesto) * 100}%"></span></div>` : ''}
        <p class="cat-detalle">${detalle}</p>
      </div>
    </div>`;
}

function renderResumen() {
  const movs = delMes();
  const gastos = movs.filter(m => m.tipo === 'gasto');
  const gastado = suma(gastos);
  const ingresado = suma(movs.filter(m => m.tipo === 'ingreso'));
  const catsGasto = estado.categorias.filter(c => c.tipo === 'gasto');
  const presupuesto = catsGasto.reduce((t, c) => t + (Number(c.presupuesto) || 0), 0);

  const porCategoria = new Map(catsGasto.map(c => [c.nombre, { ...c, gastado: 0 }]));
  for (const m of gastos) {
    if (!porCategoria.has(m.categoria)) porCategoria.set(m.categoria, { nombre: m.categoria, emoji: '📦', presupuesto: 0, gastado: 0 });
    porCategoria.get(m.categoria).gastado += Number(m.importe);
  }
  const filas = [...porCategoria.values()]
    .filter(c => c.gastado > 0 || Number(c.presupuesto) > 0)
    .sort((a, b) => b.gastado - a.gastado);

  // El anillo solo mira las categorías con presupuesto: el alquiler sin límite no se lo come.
  const gastadoConPresupuesto = filas.filter(c => Number(c.presupuesto) > 0).reduce((t, c) => t + c.gastado, 0);
  const restante = presupuesto ? 1 - gastadoConPresupuesto / presupuesto : null;
  $('#vista-resumen').innerHTML = `
    <section class="tarjeta hero">
      ${anillo(restante)}
      <div>
        <p class="etiqueta">${!presupuesto ? 'Gastado' : restante < 0 ? 'Te has pasado' : 'Te queda'}</p>
        <p class="cifra">${formatearEuros(presupuesto ? Math.abs(presupuesto - gastadoConPresupuesto) : gastado)}</p>
        <p class="sub">${presupuesto ? `${formatearEuros(gastadoConPresupuesto)} de ${formatearEuros(presupuesto)} presupuestados` : 'Pon presupuestos en Ajustes para ver cuánto te queda'}</p>
      </div>
    </section>
    <section class="cifras">
      <div class="tarjeta"><p class="etiqueta">Ingresos</p><p class="positivo">${formatearEuros(ingresado)}</p></div>
      <div class="tarjeta"><p class="etiqueta">Gastos</p><p>${formatearEuros(gastado)}</p></div>
      <div class="tarjeta"><p class="etiqueta">Balance</p><p class="${ingresado >= gastado ? 'positivo' : 'negativo'}">${formatearEuros(ingresado - gastado)}</p></div>
    </section>
    <h2>Por categoría</h2>
    <section class="tarjeta lista-cats">
      ${filas.length ? filas.map(filaCategoria).join('') : '<p class="vacio">Aún no hay gastos este mes. Pulsa + para apuntar el primero.</p>'}
    </section>`;
}

function renderMovimientos() {
  const movs = delMes().slice().sort((a, b) => (b.fecha + b.creado).localeCompare(a.fecha + a.creado));
  if (!movs.length) {
    $('#vista-movimientos').innerHTML = '<p class="vacio">No hay movimientos este mes.</p>';
    return;
  }
  const emojis = new Map(estado.categorias.map(c => [c.nombre, c.emoji]));
  let html = '';
  let dia = '';
  for (const m of movs) {
    if (m.fecha !== dia) {
      if (dia) html += '</section>';
      dia = m.fecha;
      html += `<h2>${nombreDia(dia)}</h2><section class="tarjeta">`;
    }
    const ingreso = m.tipo === 'ingreso';
    const detalle = [m.nota, m.metodo].filter(Boolean).join(' · ');
    html += `<button class="mov" data-id="${esc(m.id)}">
        <span class="emoji">${esc(emojis.get(m.categoria) || '📦')}</span>
        <span class="mov-texto"><strong>${esc(m.categoria)}</strong>${detalle ? `<small>${esc(detalle)}</small>` : ''}</span>
        <span class="mov-importe ${ingreso ? 'positivo' : ''}">${ingreso ? '+' : '−'}${formatearEuros(Number(m.importe))}</span>
      </button>`;
  }
  $('#vista-movimientos').innerHTML = html + '</section>';
}

async function borrarMovimiento(id) {
  const mov = estado.movimientos.find(m => m.id === id);
  if (!mov || !confirm(`¿Borrar ${mov.categoria} de ${formatearEuros(Number(mov.importe))}?`)) return;
  estado.movimientos = estado.movimientos.filter(m => m !== mov);
  render();
  try {
    await api('delete', { id });
    guardarCache();
  } catch (e) {
    estado.movimientos.push(mov);
    render();
    aviso('No se pudo borrar: ' + e.message);
  }
}

// --- Apuntar un movimiento --------------------------------------------------

function categoriaPorDefecto(tipo) {
  const cats = estado.categorias.filter(c => c.tipo === tipo);
  const otros = cats.find(c => normalizarTexto(c.nombre).startsWith('otros'));
  return (otros || cats[cats.length - 1] || { nombre: 'Otros' }).nombre;
}

function abrirNuevo() {
  estado.nuevo = { tipo: 'gasto', importe: '', categoria: null, metodo: (estado.metodos[0] || {}).nombre || '', fecha: fechaISO(new Date()), nota: '' };
  $('#rapido').value = '';
  $('#rapido-preview').textContent = '';
  pintarNuevo();
  $('#hoja-nuevo').hidden = false;
}

function cerrarNuevo() {
  $('#hoja-nuevo').hidden = true;
  document.activeElement && document.activeElement.blur();
}

function pintarNuevo() {
  const n = estado.nuevo;
  document.querySelectorAll('#segmento button').forEach(b => b.classList.toggle('activa', b.dataset.tipo === n.tipo));
  $('#importe').value = n.importe;
  $('#fecha').value = n.fecha;
  $('#nota').value = n.nota;
  $('#chips').innerHTML = estado.categorias
    .filter(c => c.tipo === n.tipo)
    .map(c => `<button type="button" class="chip ${c.nombre === n.categoria ? 'activa' : ''}" data-nombre="${esc(c.nombre)}">${esc(c.emoji)} ${esc(c.nombre)}</button>`)
    .join('');
  $('#metodos').innerHTML = estado.metodos
    .map(m => `<button type="button" class="chip ${m.nombre === n.metodo ? 'activa' : ''}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</button>`)
    .join('');
}

function interpretarRapido(texto) {
  const r = interpretarTexto(texto, estado.categorias, estado.metodos);
  $('#rapido-preview').textContent = !texto.trim() ? ''
    : r ? [
      r.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
      formatearEuros(r.importe),
      r.categoria,
      r.metodo,
      r.fecha !== fechaISO(new Date()) ? nombreDia(r.fecha).toLowerCase() : ''
    ].filter(Boolean).join(' · ')
    : 'Falta el importe';
  if (!r) return;
  estado.nuevo = { ...r, importe: (Number.isInteger(r.importe) ? String(r.importe) : r.importe.toFixed(2)).replace('.', ',') };
  pintarNuevo();
}

async function guardarNuevo() {
  const n = estado.nuevo;
  const importe = leerImporte(n.importe);
  if (!(importe > 0)) return aviso('Pon un importe');
  const mov = {
    tipo: n.tipo,
    importe: Math.round(importe * 100) / 100,
    categoria: n.categoria || categoriaPorDefecto(n.tipo),
    metodo: n.metodo,
    fecha: n.fecha || fechaISO(new Date()),
    nota: n.nota.trim()
  };
  cerrarNuevo();
  const provisional = { ...mov, id: 'pendiente-' + Date.now(), creado: new Date().toISOString() };
  estado.movimientos.push(provisional);
  estado.mes = mov.fecha.slice(0, 7);
  render();
  try {
    const guardado = await api('add', { mov });
    estado.movimientos = estado.movimientos.map(m => (m === provisional ? guardado : m));
    guardarCache();
    render();
    aviso(`${mov.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} de ${formatearEuros(mov.importe)} guardado`);
  } catch (e) {
    estado.movimientos = estado.movimientos.filter(m => m !== provisional);
    render();
    aviso('No se pudo guardar: ' + e.message);
  }
}

// --- Ajustes ----------------------------------------------------------------

function renderAjustes() {
  $('#cfg-url').value = estado.config.url || '';
  $('#cfg-token').value = estado.config.token || '';
  $('#estado-conexion').textContent = estado.config.url
    ? 'Conectada a tu hoja de Google.'
    : 'Sin conectar: estás en modo demo y los datos solo se guardan en este dispositivo.';
  renderEditorCats(estado.categorias);
  renderEditorMetodos(estado.metodos);
}

function renderEditorMetodos(metodos) {
  $('#editor-metodos').innerHTML = metodos.map(m => `
    <div class="tarjeta editor-metodo">
      <div class="fila">
        <input class="campo em-nombre" value="${esc(m.nombre)}" placeholder="Nombre" aria-label="Nombre">
        <button type="button" class="icono em-borrar" aria-label="Borrar método">✕</button>
      </div>
      <input class="campo em-palabras" value="${esc(m.palabras)}" placeholder="Palabras clave, separadas por comas" aria-label="Palabras clave">
    </div>`).join('');
}

function leerEditorMetodos() {
  return [...document.querySelectorAll('.editor-metodo')].map(el => ({
    nombre: el.querySelector('.em-nombre').value.trim(),
    palabras: el.querySelector('.em-palabras').value.trim()
  }));
}

async function guardarMetodos() {
  const metodos = leerEditorMetodos().filter(m => m.nombre);
  const nombres = metodos.map(m => normalizarTexto(m.nombre));
  if (!metodos.length) return aviso('Deja al menos un método de pago');
  if (new Set(nombres).size !== nombres.length) return aviso('Hay dos métodos con el mismo nombre');
  try {
    estado.metodos = await api('saveMetodos', { metodos });
    guardarCache();
    renderEditorMetodos(estado.metodos);
    aviso('Métodos de pago guardados');
  } catch (e) {
    aviso('No se pudieron guardar: ' + e.message);
  }
}

function renderEditorCats(cats) {
  $('#editor-cats').innerHTML = cats.map(c => `
    <div class="tarjeta editor-cat">
      <div class="fila">
        <input class="campo ec-emoji" value="${esc(c.emoji)}" aria-label="Emoji">
        <input class="campo ec-nombre" value="${esc(c.nombre)}" placeholder="Nombre" aria-label="Nombre">
        <button type="button" class="icono ec-borrar" aria-label="Borrar categoría">✕</button>
      </div>
      <div class="fila">
        <label class="ec-presu">Tipo
          <select class="campo ec-tipo">
            <option value="gasto" ${c.tipo === 'gasto' ? 'selected' : ''}>Gasto</option>
            <option value="ingreso" ${c.tipo === 'ingreso' ? 'selected' : ''}>Ingreso</option>
          </select>
        </label>
        <label class="ec-presu">Presupuesto al mes
          <input class="campo ec-presupuesto" inputmode="decimal" placeholder="Sin límite" value="${Number(c.presupuesto) ? String(c.presupuesto).replace('.', ',') : ''}">
        </label>
      </div>
      <input class="campo ec-palabras" value="${esc(c.palabras)}" placeholder="Palabras clave, separadas por comas" aria-label="Palabras clave">
    </div>`).join('');
}

function leerEditorCats() {
  return [...document.querySelectorAll('.editor-cat')].map(el => ({
    nombre: el.querySelector('.ec-nombre').value.trim(),
    tipo: el.querySelector('.ec-tipo').value,
    presupuesto: leerImporte(el.querySelector('.ec-presupuesto').value) || 0,
    emoji: el.querySelector('.ec-emoji').value.trim() || '📦',
    palabras: el.querySelector('.ec-palabras').value.trim()
  }));
}

async function guardarCategorias() {
  const cats = leerEditorCats().filter(c => c.nombre);
  const nombres = cats.map(c => normalizarTexto(c.nombre));
  if (!cats.length) return aviso('Deja al menos una categoría');
  if (new Set(nombres).size !== nombres.length) return aviso('Hay dos categorías con el mismo nombre');
  try {
    estado.categorias = await api('saveCategories', { categorias: cats });
    guardarCache();
    renderEditorCats(estado.categorias);
    aviso('Categorías guardadas');
  } catch (e) {
    aviso('No se pudieron guardar: ' + e.message);
  }
}

async function conectar() {
  const url = $('#cfg-url').value.trim();
  const nueva = url ? { url, token: $('#cfg-token').value.trim() } : {};
  const anterior = estado.config;
  estado.config = nueva;
  try {
    aplicar(await api('all'));
    guardar(CLAVES.config, nueva);
    guardarCache();
    renderAjustes();
    aviso(url ? 'Conectada a tu hoja' : 'Vuelves al modo demo');
  } catch (e) {
    estado.config = anterior;
    aviso('No conecta: ' + e.message);
  }
}

// --- Avisos -----------------------------------------------------------------

let temporizadorAviso;
function aviso(texto) {
  const el = $('#aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, 2800);
}

// --- Eventos ----------------------------------------------------------------

$('.tabs').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) cambiarVista(b.dataset.vista);
});
$('#mes-anterior').addEventListener('click', () => cambiarMes(-1));
$('#mes-siguiente').addEventListener('click', () => cambiarMes(1));
$('#fab').addEventListener('click', abrirNuevo);
$('#hoja-nuevo').addEventListener('click', e => { if (e.target.id === 'hoja-nuevo') cerrarNuevo(); });
$('#segmento').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  estado.nuevo.tipo = b.dataset.tipo;
  estado.nuevo.categoria = null;
  pintarNuevo();
});
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  estado.nuevo.categoria = b.dataset.nombre;
  pintarNuevo();
});
$('#metodos').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  estado.nuevo.metodo = b.dataset.nombre;
  pintarNuevo();
});
$('#rapido').addEventListener('input', e => interpretarRapido(e.target.value));
$('#importe').addEventListener('input', e => { estado.nuevo.importe = e.target.value; });
$('#fecha').addEventListener('change', e => { estado.nuevo.fecha = e.target.value; });
$('#nota').addEventListener('input', e => { estado.nuevo.nota = e.target.value; });
$('#form-nuevo').addEventListener('submit', e => { e.preventDefault(); guardarNuevo(); });
$('#vista-movimientos').addEventListener('click', e => {
  const b = e.target.closest('.mov');
  if (b) borrarMovimiento(b.dataset.id);
});
$('#form-conexion').addEventListener('submit', e => { e.preventDefault(); conectar(); });
$('#editor-cats').addEventListener('click', e => {
  const b = e.target.closest('.ec-borrar');
  if (!b) return;
  const cats = leerEditorCats();
  cats.splice([...document.querySelectorAll('.ec-borrar')].indexOf(b), 1);
  renderEditorCats(cats);
});
$('#anadir-cat').addEventListener('click', () => {
  renderEditorCats([...leerEditorCats(), { nombre: '', tipo: 'gasto', presupuesto: 0, emoji: '📦', palabras: '' }]);
  const nombres = document.querySelectorAll('.ec-nombre');
  nombres[nombres.length - 1].focus();
});
$('#guardar-cats').addEventListener('click', guardarCategorias);
$('#editor-metodos').addEventListener('click', e => {
  const b = e.target.closest('.em-borrar');
  if (!b) return;
  const metodos = leerEditorMetodos();
  metodos.splice([...document.querySelectorAll('.em-borrar')].indexOf(b), 1);
  renderEditorMetodos(metodos);
});
$('#anadir-metodo').addEventListener('click', () => {
  renderEditorMetodos([...leerEditorMetodos(), { nombre: '', palabras: '' }]);
  const nombres = document.querySelectorAll('.em-nombre');
  nombres[nombres.length - 1].focus();
});
$('#guardar-metodos').addEventListener('click', guardarMetodos);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js');
}

cambiarVista('resumen');
cargar();
