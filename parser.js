// Interpreta frases como "12,50 súper", "ayer 30 gasolina en efectivo" o "cobré 1500 nómina".
// Lo usan la app (navegador) y Apps Script (se pega allí como archivo "Parser"),
// por eso solo hay funciones y variables globales, sin import/export.

var CATEGORIAS_INICIALES = [
  { nombre: 'Supermercado', tipo: 'gasto', presupuesto: 300, emoji: '🛒', palabras: 'super, supermercado, mercadona, lidl, carrefour, aldi, alcampo, eroski, consum, compra' },
  { nombre: 'Restaurantes', tipo: 'gasto', presupuesto: 120, emoji: '🍽️', palabras: 'restaurante, cena, comida, bar, cafe, menu, desayuno, copa, cerveza, glovo' },
  { nombre: 'Transporte', tipo: 'gasto', presupuesto: 100, emoji: '🚗', palabras: 'gasolina, gasoil, diesel, metro, bus, autobus, taxi, uber, cabify, parking, peaje, tren, renfe' },
  { nombre: 'Casa', tipo: 'gasto', presupuesto: 0, emoji: '🏠', palabras: 'alquiler, hipoteca, luz, agua, gas, internet, fibra, comunidad, seguro' },
  { nombre: 'Ocio', tipo: 'gasto', presupuesto: 80, emoji: '🎉', palabras: 'cine, concierto, entrada, viaje, hotel, juego, fiesta' },
  { nombre: 'Compras', tipo: 'gasto', presupuesto: 80, emoji: '🛍️', palabras: 'ropa, amazon, zapatos, zapatillas, zara, regalo, tienda' },
  { nombre: 'Salud', tipo: 'gasto', presupuesto: 50, emoji: '💊', palabras: 'farmacia, medico, dentista, gimnasio, gym, fisio' },
  { nombre: 'Suscripciones', tipo: 'gasto', presupuesto: 30, emoji: '📱', palabras: 'netflix, spotify, hbo, max, disney, icloud, suscripcion, movil' },
  { nombre: 'Otros', tipo: 'gasto', presupuesto: 0, emoji: '📦', palabras: '' },
  { nombre: 'Nómina', tipo: 'ingreso', presupuesto: 0, emoji: '💼', palabras: 'nomina, sueldo, salario' },
  { nombre: 'Otros ingresos', tipo: 'ingreso', presupuesto: 0, emoji: '💰', palabras: 'devolucion, venta, regalo' }
];

// El primero es el que se usa cuando no dices ninguno.
var METODOS_INICIALES = [
  { nombre: 'Tarjeta', palabras: 'tarjeta, visa, mastercard, credito, debito' },
  { nombre: 'Efectivo', palabras: 'efectivo, metalico, cash' },
  { nombre: 'Bizum', palabras: 'bizum' },
  { nombre: 'Transferencia', palabras: 'transferencia' }
];

var PALABRAS_INGRESO = /(^|[^a-z])(cobre|cobro|cobrado|ingreso|ingresado|ingresan|nomina|sueldo|salario|pagaron|recibi|devolucion|devuelto|devolvieron)([^a-z]|$)/;

// "1.250,50", "1.250", "12,5", "12.50", "12"
var PATRON_IMPORTE = /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/;

function normalizarTexto(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

function fechaISO(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatearEuros(n) {
  var partes = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + partes[1] + ' €';
}

function leerImporte(texto) {
  var t = String(texto).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, '');
  return parseFloat(t.replace(',', '.'));
}

// Palabra completa, admitiendo plural: "cafe" encaja con "cafes" pero "gas" no con "gasolina".
function contienePalabra(texto, palabra) {
  var p = palabra.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + p + '(e?s)?($|[^a-z0-9])').test(texto);
}

// El nombre y las palabras clave de una categoría o método, normalizados.
function palabrasDe(item) {
  return [item.nombre].concat(String(item.palabras || '').split(',')).map(normalizarTexto).filter(Boolean);
}

function buscarPorPalabras(limpio, lista) {
  return (lista || []).filter(function (item) {
    return palabrasDe(item).some(function (p) { return contienePalabra(limpio, p); });
  })[0];
}

function interpretarTexto(texto, categorias, metodos, hoy) {
  var limpio = normalizarTexto(texto);
  var m = limpio.match(PATRON_IMPORTE);
  if (!m) return null;
  var importe = leerImporte(m[0]);
  if (!(importe > 0)) return null;

  var tipo = PALABRAS_INGRESO.test(limpio) ? 'ingreso' : 'gasto';
  var candidatas = (categorias || []).filter(function (c) { return c.tipo === tipo; });
  var categoria = buscarPorPalabras(limpio, candidatas)
    || candidatas.filter(function (c) { return normalizarTexto(c.nombre).indexOf('otros') === 0; })[0]
    || candidatas[candidatas.length - 1]
    || { nombre: 'Otros' };

  var metodo = buscarPorPalabras(limpio, metodos) || (metodos || [])[0];

  var fecha = hoy ? new Date(hoy) : new Date();
  if (contienePalabra(limpio, 'anteayer')) fecha.setDate(fecha.getDate() - 2);
  else if (contienePalabra(limpio, 'ayer')) fecha.setDate(fecha.getDate() - 1);

  // La nota es lo que queda: sin importe, fecha ni método ("con tarjeta", "en efectivo").
  var palabrasMetodo = metodo ? palabrasDe(metodo) : [];
  var trozos = String(texto)
    .replace(PATRON_IMPORTE, '')
    .replace(/€|\beur(o|os)?\b/gi, '')
    .replace(/\b(anteayer|ayer|hoy)\b/gi, '')
    .split(/\s+/).filter(Boolean);
  var quedan = [];
  trozos.forEach(function (t) {
    if (palabrasMetodo.indexOf(normalizarTexto(t)) === -1) return quedan.push(t);
    if (/^(con|en|por)$/i.test(quedan[quedan.length - 1] || '')) quedan.pop();
  });
  var nota = quedan.join(' ').replace(/^(en|de|del|por|para|con)\s+/i, '').replace(/\s+(en|de|con|por)$/i, '');
  nota = nota.charAt(0).toUpperCase() + nota.slice(1);

  return {
    tipo: tipo,
    importe: Math.round(importe * 100) / 100,
    categoria: categoria.nombre,
    metodo: metodo ? metodo.nombre : '',
    fecha: fechaISO(fecha),
    nota: nota
  };
}
