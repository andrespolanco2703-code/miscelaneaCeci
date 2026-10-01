'use strict';
// Sincroniza el estado local con Firestore. El archivo local sigue siendo la fuente principal:
// si no hay internet, la app funciona igual y los cambios se suben cuando vuelva la conexión.
const fs = require('fs');
const path = require('path');
const { dividir, unir, COLECCIONES } = require('./modelo');

const conTiempo = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Sin respuesta del servidor'), { code: 'timeout' })), ms))
]);

function esSinRed(e) {
  const c = String((e && e.code) || '');
  return /unavailable|timeout|network|deadline/i.test(c) || /offline|network/i.test((e && e.message) || '');
}

function mensaje(e) {
  const c = String((e && e.code) || '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Correo o clave incorrectos.';
  if (/invalid-email/.test(c)) return 'El correo no es válido.';
  if (/too-many-requests/.test(c)) return 'Demasiados intentos. Espera unos minutos.';
  if (/operation-not-allowed/.test(c)) return 'En Firebase falta activar el acceso con correo y contraseña.';
  if (/permission-denied/.test(c)) return 'Las reglas de Firestore no dejan guardar. Revisa que sean las de firestore.rules.';
  if (esSinRed(e)) return 'Sin conexión a internet.';
  return (e && e.message) || 'Error desconocido.';
}

// opts: { dir, leerEstado, escribirEstado, respaldar, fotoExiste, avisar, safeStorage, firebase? }
function crear(opts) {
  const { dir, leerEstado, escribirEstado, respaldar, fotoExiste, avisar, safeStorage } = opts;
  const archIdx = path.join(dir, 'sync-index.json');
  const archCred = path.join(dir, 'nube.bin');

  let fb = opts.firebase || null;      // { F, A, auth, db }
  let user = null;
  let idx = { uid: null, hashes: {} }; // qué subimos ya (hash por documento)
  let st = { estado: 'apagado', msg: '', ultima: 0, email: '' };
  let corriendo = false, otraVez = false, pausado = false, tSync = null, tLogin = null;

  function poner(estado, msg) {
    st = { ...st, estado, msg: msg || '' };
    if (estado === 'ok') st.ultima = Date.now();
    avisar('sync:status', st);
  }

  function cargarFb() {
    if (fb) return fb;
    const { initializeApp } = require('firebase/app');
    const A = require('firebase/auth');
    const F = require('firebase/firestore');
    const app = initializeApp(require('./firebase-config'));
    fb = { A, F, auth: A.getAuth(app), db: F.getFirestore(app) };
    return fb;
  }

  const leerIdx = () => { try { idx = JSON.parse(fs.readFileSync(archIdx, 'utf8')); } catch (e) { idx = { uid: null, hashes: {} }; } };
  const guardarIdx = () => { try { fs.writeFileSync(archIdx, JSON.stringify(idx)); } catch (e) { /* no es grave */ } };

  function guardarCred(email, clave) {
    try {
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        fs.writeFileSync(archCred, safeStorage.encryptString(JSON.stringify({ email, clave })));
      }
    } catch (e) { /* si no se puede guardar, tendrá que escribir la clave al abrir */ }
  }
  function leerCred() {
    try {
      if (!(safeStorage && safeStorage.isEncryptionAvailable()) || !fs.existsSync(archCred)) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(archCred)));
    } catch (e) { return null; }
  }

  const refDoc = k => {
    const { F, db } = cargarFb();
    const i = k.indexOf('/');
    return F.doc(db, 'users', user.uid, k.slice(0, i), k.slice(i + 1));
  };

  async function entrar(email, clave, guardar) {
    poner('conectando');
    const f = cargarFb();
    const cred = await conTiempo(f.A.signInWithEmailAndPassword(f.auth, email, clave), 25000);
    user = cred.user;
    st.email = email;
    if (guardar) guardarCred(email, clave);
    pausado = false;
    pedir(300);
  }

  async function conectar(email, clave) {
    try { await entrar(String(email).trim(), clave, true); }
    catch (e) { st.email = ''; poner('apagado', mensaje(e)); throw e; }
  }

  async function desconectar() {
    try { if (fb && fb.auth) await fb.A.signOut(fb.auth); } catch (e) { /* ignorar */ }
    user = null; st.email = '';
    try { fs.unlinkSync(archCred); } catch (e) { /* ignorar */ }
    clearTimeout(tSync); clearTimeout(tLogin);
    poner('apagado');
  }

  function iniciar() {
    leerIdx();
    const c = leerCred();
    if (!c) return;
    st.email = c.email;
    const intentar = () => {
      entrar(c.email, c.clave, false).catch(e => {
        if (esSinRed(e)) { poner('sin-red', mensaje(e)); tLogin = setTimeout(intentar, 60000); }
        else { st.email = ''; poner('apagado', mensaje(e)); }
      });
    };
    intentar();
  }

  function pedir(ms) {
    if (!user) return;
    clearTimeout(tSync);
    tSync = setTimeout(() => { sincronizar(); }, ms == null ? 5000 : ms);
  }

  async function nubeTieneDatos() {
    const { F, db } = cargarFb();
    const s = await conTiempo(F.getDoc(F.doc(db, 'users', user.uid, 'config', 'main')), 25000);
    return s.exists();
  }

  async function sincronizar() {
    if (!user || pausado) return;
    if (corriendo) { otraVez = true; return; }
    corriendo = true;
    try {
      const S = leerEstado();
      if (!S) return;
      poner('sincronizando');

      if (idx.uid !== user.uid) {
        // primera vez con esta cuenta en este computador: no pisar datos que ya existan en la nube
        if (await nubeTieneDatos()) { pausado = true; poner('elegir'); return; }
        idx = { uid: user.uid, hashes: {} };
        guardarIdx();
      }

      const actual = dividir(S);
      const ops = [];
      Object.keys(actual).forEach(k => {
        if (idx.hashes[k] !== actual[k].hash) ops.push({ k, data: actual[k].data, hash: actual[k].hash });
      });
      Object.keys(idx.hashes).forEach(k => { if (!(k in actual)) ops.push({ k, borrar: true }); });

      const { F, db } = cargarFb();
      for (let i = 0; i < ops.length; i += 400) {
        const trozo = ops.slice(i, i + 400);
        const b = F.writeBatch(db);
        trozo.forEach(o => (o.borrar ? b.delete(refDoc(o.k)) : b.set(refDoc(o.k), o.data)));
        await conTiempo(b.commit(), 40000);
        trozo.forEach(o => { if (o.borrar) delete idx.hashes[o.k]; else idx.hashes[o.k] = o.hash; });
        guardarIdx();
      }
      poner('ok');
    } catch (e) {
      poner(esSinRed(e) ? 'sin-red' : 'error', mensaje(e));
      pedir(60000); // reintentar en un minuto
    } finally {
      corriendo = false;
      if (otraVez) { otraVez = false; pedir(2000); }
    }
  }

  async function descargar() {
    const { F, db } = cargarFb();
    const docs = {};
    for (const c of COLECCIONES) {
      const snap = await conTiempo(F.getDocs(F.collection(db, 'users', user.uid, c)), 60000);
      snap.forEach(d => { docs[c + '/' + d.id] = d.data(); });
    }
    const cfg = await conTiempo(F.getDoc(F.doc(db, 'users', user.uid, 'config', 'main')), 25000);
    if (!cfg.exists()) throw new Error('En la nube todavía no hay datos.');
    docs['config/main'] = cfg.data();
    return docs;
  }

  // Reemplaza los datos de este PC por los de la nube
  async function restaurar() {
    if (!user) throw new Error('Primero conecta la cuenta.');
    poner('sincronizando', 'Descargando…');
    try {
      const docs = await descargar();
      const S0 = unir(docs);
      const nuevoIdx = { uid: user.uid, hashes: {} };
      const d = dividir(S0);
      Object.keys(d).forEach(k => { nuevoIdx.hashes[k] = d[k].hash; });

      const S = JSON.parse(JSON.stringify(S0));
      S.fact.forEach(f => { if (f.has && !fotoExiste(f.id)) f.has = false; }); // las fotos no viajan por la nube

      respaldar('antes-de-restaurar');
      escribirEstado(S);
      idx = nuevoIdx; guardarIdx();
      pausado = false;
      poner('ok');
      pedir(3000);
    } catch (e) {
      poner(esSinRed(e) ? 'sin-red' : 'error', mensaje(e));
      throw e;
    }
  }

  // Reemplaza los datos de la nube por los de este PC
  async function subirTodo() {
    if (!user) throw new Error('Primero conecta la cuenta.');
    const { F, db } = cargarFb();
    const hashes = {};
    for (const c of COLECCIONES) {
      const snap = await conTiempo(F.getDocs(F.collection(db, 'users', user.uid, c)), 60000);
      snap.forEach(d => { hashes[c + '/' + d.id] = 'viejo'; });
    }
    hashes['config/main'] = 'viejo';
    idx = { uid: user.uid, hashes };
    guardarIdx();
    pausado = false;
    await sincronizar();
  }

  return {
    iniciar, conectar, desconectar, pedir, sincronizar, restaurar, subirTodo, mensaje,
    obtener: () => st
  };
}

module.exports = { crear, mensaje };
