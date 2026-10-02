'use strict';
// Convierte el estado de la app (un solo objeto) en documentos pequeños para Firestore y viceversa.
// No depende de Electron ni de Firebase, así que se puede probar sola.
const crypto = require('crypto');

function estable(v) {
  if (Array.isArray(v)) return '[' + v.map(estable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + estable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}
const hash = v => crypto.createHash('sha1').update(estable(v)).digest('hex');
const limpio = v => JSON.parse(JSON.stringify(v)); // quita undefined, que Firestore no acepta

// Firestore no admite listas dentro de listas (por ejemplo los servicios: [['Minutos', 300]]).
// Al subir, cada lista interna se envuelve como { _arr: [...] }; al bajar se desenvuelve.
function codificar(v) {
  if (Array.isArray(v)) return v.map(x => (Array.isArray(x) ? { _arr: codificar(x) } : codificar(x)));
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => { o[k] = codificar(v[k]); });
    return o;
  }
  return v;
}
function decodificar(v) {
  if (Array.isArray(v)) return v.map(decodificar);
  if (v && typeof v === 'object') {
    const ks = Object.keys(v);
    if (ks.length === 1 && ks[0] === '_arr' && Array.isArray(v._arr)) return decodificar(v._arr);
    const o = {};
    ks.forEach(k => { o[k] = decodificar(v[k]); });
    return o;
  }
  return v;
}

const COLECCIONES = ['productos', 'ventas', 'proveedores', 'facturas', 'cierres'];

// Devuelve { 'coleccion/id': { data, hash } }
function dividir(S) {
  const docs = {};
  const poner = (col, id, data) => { docs[col + '/' + id] = codificar(limpio(data)); };

  (S.p || []).forEach(x => poner('productos', x.id, x));

  // las ventas no tienen id: se usa la hora; si dos coinciden en el mismo milisegundo se les agrega sufijo
  const vistos = {};
  (S.sales || []).forEach(s => {
    let id = String(s.t);
    if (id in vistos) { vistos[id]++; id += '-' + vistos[id]; } else vistos[id] = 0;
    poner('ventas', id, s);
  });

  (S.prov || []).forEach(x => poner('proveedores', x.id, x));
  (S.fact || []).forEach(x => { const c = { ...x }; delete c.photo; poner('facturas', x.id, c); }); // las fotos NO van a la nube
  (S.hist || []).forEach(x => poner('cierres', x.t0, x));

  const cfg = { ...S };
  ['p', 'sales', 'prov', 'fact', 'hist'].forEach(k => delete cfg[k]);
  poner('config', 'main', cfg);

  const out = {};
  Object.keys(docs).forEach(k => { out[k] = { data: docs[k], hash: hash(docs[k]) }; });
  return out;
}

// Recibe { 'coleccion/id': data } y rearma el estado de la app
function unir(docsCodificados) {
  let docs = docsCodificados;
  const col = c => Object.keys(docs)
    .filter(k => k.startsWith(c + '/'))
    .map(k => [k.slice(c.length + 1), docs[k]]);
  const porId = (a, b) => a.id - b.id;

  docs = decodificar(docs);
  const S = { ...(docs['config/main'] || {}) };
  S.p = col('productos').map(e => e[1]).sort(porId);
  S.sales = col('ventas')
    .sort((a, b) => a[1].t - b[1].t || a[0].localeCompare(b[0], 'en', { numeric: true }))
    .map(e => e[1]);
  S.prov = col('proveedores').map(e => e[1]).sort(porId);
  S.fact = col('facturas').map(e => e[1]).sort(porId);
  S.hist = col('cierres').map(e => e[1]).sort((a, b) => a.t0 - b.t0);
  if (!S.caja) S.caja = { open: false, base: 0, t: 0, moves: [] };
  return S;
}

module.exports = { dividir, unir, hash, estable, codificar, decodificar, COLECCIONES };
