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
  $('#fab').hidden = enAjustes || estado.vista === 'evolucion';
  if (estado.vista === 'resumen') renderResumen();
  if (estado.vista === 'movimientos') renderMovimientos();
  if (estado.vista === 'evolucion') renderEvolucion();
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
  const conPresupuesto = new Set(catsGasto.filter(c => Number(c.presupuesto) > 0).map(c => c.nombre));
  const gastadoConPresupuesto = filas.filter(c => conPresupuesto.has(c.nombre)).reduce((t, c) => t + c.gastado, 0);
  const restante = presupuesto ? 1 - gastadoConPresupuesto / presupuesto : null;

  // Días que cuentan para la media y el ritmo: hasta hoy en el mes actual, el mes entero en los pasados.
  const mesHoy = fechaISO(new Date()).slice(0, 7);
  const dias = diasDelMes(estado.mes);
  const transcurridos = estado.mes === mesHoy ? new Date().getDate() : estado.mes < mesHoy ? dias : 0;
  const anterior = mesAnterior(estado.mes);
  // Se compara con el mes anterior hasta el mismo día, para no medir medio mes contra uno entero.
  const gastoAnterior = suma(movsDe(anterior).filter(m => m.tipo === 'gasto' && Number(m.fecha.slice(8, 10)) <= (transcurridos || 31)));
  const cambio = gastoAnterior ? (gastado - gastoAnterior) / gastoAnterior : null;
  const mayor = filas[0] && filas[0].gastado > 0 ? filas[0] : null;

  const porDia = Array(dias).fill(0);
  gastos.filter(m => !presupuesto || conPresupuesto.has(m.categoria))
    .forEach(m => { porDia[Number(m.fecha.slice(8, 10)) - 1] += Number(m.importe); });
  let acumulado = 0;
  const ritmo = porDia.map((v, i) => (i < transcurridos ? (acumulado += v) : null));
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
    ${transcurridos && gastado ? `
    <h2>El mes de un vistazo</h2>
    <section class="vistazo">
      <div class="tarjeta">
        <p class="etiqueta">vs. ${MESES[Number(anterior.slice(5, 7)) - 1]}</p>
        ${cambio === null ? '<p class="valor">–</p><p class="mini">sin datos</p>'
          : `<p class="valor ${cambio <= 0 ? 'positivo' : 'negativo'}">${cambio <= 0 ? '▼' : '▲'} ${Math.abs(Math.round(cambio * 100))}%</p>
             <p class="mini">${cambio <= 0 ? 'menos' : 'más'} gasto${estado.mes === mesHoy ? ' a estas alturas' : ''}</p>`}
      </div>
      <div class="tarjeta">
        <p class="etiqueta">Media diaria</p>
        <p class="valor">${formatearEuros(gastado / transcurridos)}</p>
        <p class="mini">en ${transcurridos} día${transcurridos === 1 ? '' : 's'}</p>
      </div>
      <div class="tarjeta">
        <p class="etiqueta">Donde más</p>
        <p class="valor">${mayor ? esc(mayor.emoji) + ' ' + esc(mayor.nombre) : '–'}</p>
        <p class="mini">${mayor ? formatearEuros(mayor.gastado) : ''}</p>
      </div>
    </section>
    <section class="tarjeta">
      <p class="titulo-grafico">Ritmo de gasto</p>
      <p class="sub">${presupuesto ? 'Acumulado en categorías con presupuesto, frente al ritmo que te permite el presupuesto' : 'Gasto acumulado día a día'}</p>
      <div id="g-ritmo" class="grafico"></div>
    </section>` : ''}
    <h2>Por categoría</h2>
    <section class="tarjeta lista-cats">
      ${filas.length ? filas.map(filaCategoria).join('') : '<p class="vacio">Aún no hay gastos este mes. Pulsa + para apuntar el primero.</p>'}
    </section>`;
  if (transcurridos && gastado) pintarRitmo($('#g-ritmo'), { ritmo, dias, presupuesto });
}

function renderEvolucion() {
  const meses = ultimosMeses(6);
  const datos = meses.map(mes => {
    const movs = movsDe(mes);
    return { mes, gastos: suma(movs.filter(m => m.tipo === 'gasto')), ingresos: suma(movs.filter(m => m.tipo === 'ingreso')) };
  });
  if (!datos.some(d => d.gastos || d.ingresos)) {
    $('#vista-evolucion').innerHTML = '<p class="vacio">Aún no hay movimientos en los últimos 6 meses.</p>';
    return;
  }

  const catsGasto = estado.categorias.filter(c => c.tipo === 'gasto');
  const gastoDe = nombre => meses.map(mes => suma(movsDe(mes).filter(m => m.tipo === 'gasto' && m.categoria === nombre)));
  if (!catsGasto.some(c => c.nombre === estado.catEvolucion)) {
    // Por defecto, la categoría en la que más se ha gastado en el periodo.
    estado.catEvolucion = (catsGasto
      .map(c => ({ nombre: c.nombre, total: gastoDe(c.nombre).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total)[0] || {}).nombre;
  }
  const cat = catsGasto.find(c => c.nombre === estado.catEvolucion);
  const valoresCat = cat ? gastoDe(cat.nombre) : [];
  const conDatos = valoresCat.filter(v => v > 0);
  const mediaCat = conDatos.length ? conDatos.reduce((a, b) => a + b, 0) / conDatos.length : 0;
  const redondo = n => formatearEuros(Math.round(n)).replace(',00', '');

  $('#vista-evolucion').innerHTML = `
    <h2>Gastos e ingresos · últimos 6 meses</h2>
    <section class="tarjeta">
      <div class="leyenda"><span><i class="serie-1"></i>Ingresos</span><span><i class="serie-2"></i>Gastos</span></div>
      <div id="g-meses" class="grafico"></div>
    </section>
    <section class="tarjeta tabla-meses">
      <table class="tabla">
        <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Balance</th></tr></thead>
        <tbody>${datos.slice().reverse().map(d => `
          <tr data-mes="${d.mes}">
            <td>${capitalizar(mesCorto(d.mes))}</td>
            <td>${redondo(d.ingresos)}</td>
            <td>${redondo(d.gastos)}</td>
            <td class="${d.ingresos >= d.gastos ? 'positivo' : 'negativo'}">${d.ingresos >= d.gastos ? '+' : '−'}${redondo(Math.abs(d.ingresos - d.gastos))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="ayuda">Toca un mes para ver su resumen.</p>
    </section>
    ${cat ? `
    <h2>Por categoría</h2>
    <div id="chips-evolucion" class="chips">${catsGasto.map(c => `<button type="button" class="chip ${c.nombre === cat.nombre ? 'activa' : ''}" data-nombre="${esc(c.nombre)}">${esc(c.emoji)} ${esc(c.nombre)}</button>`).join('')}</div>
    <section class="tarjeta">
      <p class="titulo-grafico">${esc(cat.emoji)} ${esc(cat.nombre)}</p>
      <p class="sub">${mediaCat ? `Media de ${formatearEuros(mediaCat)} en los meses con gasto` : 'Sin gastos en estos meses'}${Number(cat.presupuesto) ? ` · presupuesto ${formatearEuros(Number(cat.presupuesto))}` : ''}</p>
      <div id="g-categoria" class="grafico"></div>
    </section>` : ''}`;

  const etiquetas = meses.map(mesCorto);
  pintarColumnas($('#g-meses'), {
    etiquetas,
    series: [{ clase: 'serie-1', valores: datos.map(d => d.ingresos) }, { clase: 'serie-2', valores: datos.map(d => d.gastos) }],
    tooltip: i => `<strong>${nombreMes(meses[i])}</strong><br>Ingresos: ${formatearEuros(datos[i].ingresos)}<br>Gastos: ${formatearEuros(datos[i].gastos)}<br>Balance: ${formatearEuros(datos[i].ingresos - datos[i].gastos)}`
  });
  if (cat) {
    pintarColumnas($('#g-categoria'), {
      etiquetas,
      series: [{ clase: 'serie-1', valores: valoresCat }],
      referencia: Number(cat.presupuesto) || 0,
      tooltip: i => `<strong>${nombreMes(meses[i])}</strong><br>${esc(cat.nombre)}: ${formatearEuros(valoresCat[i])}`
    });
  }
}

// --- Gráficos (SVG a mano, sin librerías, para que funcione sin conexión) ---

function mesAnterior(mes, n = 1) {
  const [a, m] = mes.split('-').map(Number);
  return fechaISO(new Date(a, m - 1 - n, 1)).slice(0, 7);
}

function ultimosMeses(n) {
  return Array.from({ length: n }, (_, i) => mesAnterior(estado.mes, n - 1 - i));
}

function movsDe(mes) {
  return estado.movimientos.filter(m => String(m.fecha).startsWith(mes));
}

function mesCorto(mes) {
  return MESES[Number(mes.slice(5, 7)) - 1].slice(0, 3);
}

function diasDelMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

function eurosEje(n) {
  return n >= 1000 ? (n / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + 'k €' : Math.round(n) + ' €';
}

// Pasos redondos (1, 2 o 5 × 10ⁿ) para unas cuatro líneas de rejilla.
function escala(max) {
  const bruto = Math.max(max, 1) / 4;
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 5, 10].map(f => f * potencia).find(p => p >= bruto);
  return { paso, tope: Math.ceil(Math.max(max, 1) / paso) * paso };
}

// Columna con el extremo de datos redondeado (4px) y la base recta.
function columna(x, y, w, h) {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function rejillaY(m, ancho, y, tope, paso) {
  let svg = '';
  for (let v = 0; v <= tope + 1e-9; v += paso) {
    svg += `<line class="${v === 0 ? 'eje' : 'rejilla'}" x1="${m.l}" x2="${ancho - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${eurosEje(v)}</text>`;
  }
  return svg;
}

function mostrarTip(el, x, html) {
  const tip = el.querySelector('.tip');
  tip.innerHTML = html;
  tip.hidden = false;
  tip.style.left = Math.min(Math.max(0, x - tip.offsetWidth / 2), el.clientWidth - tip.offsetWidth) + 'px';
}

function ocultarTip(el) {
  el.querySelector('.tip').hidden = true;
  el.querySelectorAll('.activa').forEach(z => z.classList.remove('activa'));
}

function pintarColumnas(el, { etiquetas, series, referencia, tooltip }) {
  const ancho = Math.max(260, el.clientWidth), alto = 190;
  const m = { t: 16, r: 8, b: 26, l: 46 };
  const iw = ancho - m.l - m.r, ih = alto - m.t - m.b;
  const { paso, tope } = escala(Math.max(referencia || 0, ...series.flatMap(s => s.valores)));
  const y = v => m.t + ih - (v / tope) * ih;
  const banda = iw / etiquetas.length;
  const grosor = Math.min(24, (banda * 0.6 - (series.length - 1) * 2) / series.length);

  let svg = rejillaY(m, ancho, y, tope, paso);
  etiquetas.forEach((et, i) => {
    const x0 = m.l + banda * i + (banda - (series.length * grosor + (series.length - 1) * 2)) / 2;
    svg += `<rect class="zona" data-i="${i}" x="${m.l + banda * i}" y="${m.t}" width="${banda}" height="${ih}"/>`;
    series.forEach((s, j) => {
      const h = (s.valores[i] / tope) * ih;
      if (h > 0) svg += `<path class="${s.clase}" d="${columna(x0 + j * (grosor + 2), y(0) - Math.max(h, 1), grosor, Math.max(h, 1))}"/>`;
    });
    svg += `<text class="tick${i === etiquetas.length - 1 ? ' actual' : ''}" x="${m.l + banda * (i + 0.5)}" y="${alto - 8}" text-anchor="middle">${et}</text>`;
  });
  if (referencia) {
    // La línea va encima de las columnas y la etiqueta lleva halo para leerse sobre ellas.
    svg += `<line class="referencia" x1="${m.l}" x2="${ancho - m.r}" y1="${y(referencia)}" y2="${y(referencia)}"/>`;
    svg += `<text class="tick halo" x="${ancho - m.r}" y="${y(referencia) - 5}" text-anchor="end">Presupuesto</text>`;
  }
  el.innerHTML = `<svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" aria-hidden="true">${svg}</svg><div class="tip" hidden></div>`;

  const elegir = e => {
    const z = e.target.closest('.zona');
    if (!z) return;
    const i = Number(z.dataset.i);
    el.querySelectorAll('.zona').forEach(o => o.classList.toggle('activa', o === z));
    mostrarTip(el, m.l + banda * (i + 0.5), tooltip(i));
  };
  el.addEventListener('pointermove', elegir);
  el.addEventListener('pointerdown', elegir);
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') ocultarTip(el); });
}

function pintarRitmo(el, { ritmo, dias, presupuesto }) {
  const ancho = Math.max(260, el.clientWidth), alto = 170;
  const m = { t: 16, r: 12, b: 24, l: 46 };
  const iw = ancho - m.l - m.r, ih = alto - m.t - m.b;
  const hechos = ritmo.filter(v => v !== null);
  const { paso, tope } = escala(Math.max(presupuesto, ...hechos));
  const x = d => m.l + ((d - 1) / (dias - 1)) * iw;
  const y = v => m.t + ih - (v / tope) * ih;

  let svg = rejillaY(m, ancho, y, tope, paso);
  [1, 8, 15, 22, dias].forEach(d => {
    svg += `<text class="tick" x="${x(d)}" y="${alto - 6}" text-anchor="middle">${d}</text>`;
  });
  if (presupuesto) {
    svg += `<line class="referencia" x1="${x(1)}" y1="${y(presupuesto / dias)}" x2="${x(dias)}" y2="${y(presupuesto)}"/>`;
    svg += `<text class="tick halo" x="${x(dias)}" y="${y(presupuesto) - 6}" text-anchor="end">Presupuesto</text>`;
  }
  const puntos = hechos.map((v, i) => `${x(i + 1)},${y(v)}`);
  svg += `<path class="area" d="M${x(1)},${y(0)}L${puntos.join('L')}L${x(hechos.length)},${y(0)}Z"/>`;
  svg += `<polyline class="linea" points="${puntos.join(' ')}"/>`;
  svg += `<circle class="punto" cx="${x(hechos.length)}" cy="${y(hechos[hechos.length - 1])}" r="4"/>`;
  svg += `<line class="cruz" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>`;
  svg += `<circle class="punto foco" r="4" visibility="hidden"/>`;
  svg += `<rect class="zona-linea" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}"/>`;
  el.innerHTML = `<svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" aria-hidden="true">${svg}</svg><div class="tip" hidden></div>`;

  const cruz = el.querySelector('.cruz'), foco = el.querySelector('.foco');
  const elegir = e => {
    const caja = el.querySelector('svg').getBoundingClientRect();
    const d = Math.min(hechos.length, Math.max(1, Math.round(((e.clientX - caja.left - m.l) / iw) * (dias - 1)) + 1));
    cruz.setAttribute('x1', x(d)); cruz.setAttribute('x2', x(d)); cruz.setAttribute('visibility', 'visible');
    foco.setAttribute('cx', x(d)); foco.setAttribute('cy', y(hechos[d - 1])); foco.setAttribute('visibility', 'visible');
    mostrarTip(el, x(d), `<strong>Día ${d}</strong><br>Llevas ${formatearEuros(hechos[d - 1])}`
      + (presupuesto ? `<br>Ritmo previsto: ${formatearEuros((presupuesto * d) / dias)}` : ''));
  };
  el.addEventListener('pointermove', elegir);
  el.addEventListener('pointerdown', elegir);
  el.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    ocultarTip(el);
    cruz.setAttribute('visibility', 'hidden');
    foco.setAttribute('visibility', 'hidden');
  });
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
$('#vista-evolucion').addEventListener('click', e => {
  const chip = e.target.closest('#chips-evolucion .chip');
  if (chip) {
    estado.catEvolucion = chip.dataset.nombre;
    renderEvolucion();
    return;
  }
  const fila = e.target.closest('tr[data-mes]');
  if (fila) {
    estado.mes = fila.dataset.mes;
    cambiarVista('resumen');
  }
});
// Los gráficos se dibujan al ancho de la pantalla: al girar el móvil se repintan.
let temporizadorRedibujo;
window.addEventListener('resize', () => {
  clearTimeout(temporizadorRedibujo);
  temporizadorRedibujo = setTimeout(() => {
    if (estado.vista === 'resumen' || estado.vista === 'evolucion') render();
  }, 200);
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
