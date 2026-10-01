const { app, BrowserWindow, shell, session, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const sincro = require('./sync');

let win;
if (!app.requestSingleInstanceLock()) {
  app.quit();                                   // ya hay una ventana abierta
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  /* ---------- datos locales: %APPDATA%\Cecilia\datos ---------- */
  const DIR = path.join(app.getPath('userData'), 'datos');
  const F_ESTADO = path.join(DIR, 'estado.json');
  const F_BAK = path.join(DIR, 'estado.bak.json');
  const D_FOTOS = path.join(DIR, 'fotos');
  const D_COPIAS = path.join(DIR, 'copias');
  let ultimoJson = null;       // último estado conocido (texto)
  let pendiente = false;       // hay cambios sin escribir
  let tEscribir = null;
  let diaCopia = '';

  const avisar = (canal, dato) => { if (win && !win.isDestroyed()) win.webContents.send(canal, dato); };
  const leerJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return undefined; } };

  function cargarDisco() {
    if (fs.existsSync(F_ESTADO)) {
      const s = leerJson(F_ESTADO);
      if (s && s.p) return s;
      try { fs.renameSync(F_ESTADO, path.join(DIR, 'estado-danado-' + Date.now() + '.json')); } catch (e) { /* ignorar */ }
    }
    if (fs.existsSync(F_BAK)) { const s = leerJson(F_BAK); if (s && s.p) return s; }
    return null;
  }

  const rutaFoto = id => path.join(D_FOTOS, String(id).replace(/\D/g, '') + '.jpg');
  const fotoExiste = id => fs.existsSync(rutaFoto(id));
  function guardarFoto(id, dataUrl) {
    fs.mkdirSync(D_FOTOS, { recursive: true });
    if (!dataUrl) { try { fs.unlinkSync(rutaFoto(id)); } catch (e) { /* ya no estaba */ } return; }
    fs.writeFileSync(rutaFoto(id), Buffer.from(String(dataUrl).split(',')[1] || '', 'base64'));
  }
  // pasa las fotos que vengan dentro del estado (datos viejos) a archivos aparte
  function quitarFotos(S) {
    (S.fact || []).forEach(f => {
      if (typeof f.photo === 'string' && f.photo.startsWith('data:')) { guardarFoto(f.id, f.photo); f.has = true; }
      delete f.photo;
    });
    return S;
  }

  function copiaDiaria() {
    const hoy = new Date().toISOString().slice(0, 10);
    if (diaCopia === hoy) return;
    diaCopia = hoy;
    fs.mkdirSync(D_COPIAS, { recursive: true });
    fs.copyFileSync(F_ESTADO, path.join(D_COPIAS, 'estado-' + hoy + '.json'));
    const viejas = fs.readdirSync(D_COPIAS).filter(n => /^estado-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    viejas.slice(0, Math.max(0, viejas.length - 30)).forEach(n => { try { fs.unlinkSync(path.join(D_COPIAS, n)); } catch (e) { /* ignorar */ } });
  }

  function escribirDisco() {
    if (!pendiente || ultimoJson == null) return;
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const tmp = F_ESTADO + '.tmp';
      fs.writeFileSync(tmp, ultimoJson);
      if (fs.existsSync(F_ESTADO)) fs.copyFileSync(F_ESTADO, F_BAK);
      fs.renameSync(tmp, F_ESTADO);
      pendiente = false;
      copiaDiaria();
    } catch (e) {
      avisar('state:error', 'No se pudo guardar en el computador: ' + e.message);
    }
  }
  function programarEscritura() { clearTimeout(tEscribir); tEscribir = setTimeout(escribirDisco, 250); }

  function guardarEstado(S) {       // usado por la nube al restaurar
    ultimoJson = JSON.stringify(S);
    pendiente = true;
    escribirDisco();
  }
  function respaldar(etiqueta) {
    try {
      escribirDisco();
      if (!fs.existsSync(F_ESTADO)) return;
      fs.mkdirSync(D_COPIAS, { recursive: true });
      fs.copyFileSync(F_ESTADO, path.join(D_COPIAS, etiqueta + '-' + Date.now() + '.json'));
    } catch (e) { /* ignorar */ }
  }

  const nube = sincro.crear({
    dir: DIR,
    leerEstado: () => { try { return ultimoJson ? JSON.parse(ultimoJson) : cargarDisco(); } catch (e) { return null; } },
    escribirEstado: guardarEstado,
    respaldar,
    fotoExiste,
    avisar,
    safeStorage
  });

  /* ---------- canales entre la ventana y el programa ---------- */
  ipcMain.on('state:load', e => {
    const s = cargarDisco();
    if (s) ultimoJson = JSON.stringify(s);
    e.returnValue = { state: s };
  });
  ipcMain.on('state:migrate', (e, S) => {        // primera vez: pasa los datos viejos (localStorage) a archivo
    try { quitarFotos(S); guardarEstado(S); e.returnValue = S; } catch (err) { e.returnValue = null; }
  });
  ipcMain.on('state:save', (_e, json) => { ultimoJson = json; pendiente = true; programarEscritura(); nube.pedir(); });
  ipcMain.handle('state:replace', (_e, json) => {
    respaldar('antes-de-importar');
    const S = quitarFotos(JSON.parse(json));
    guardarEstado(S);
    nube.pedir(2000);
    return true;
  });

  ipcMain.handle('photo:set', (_e, id, data) => { guardarFoto(id, data); return true; });
  ipcMain.handle('photo:get', (_e, id) => {
    try { return 'data:image/jpeg;base64,' + fs.readFileSync(rutaFoto(id)).toString('base64'); } catch (e) { return ''; }
  });
  ipcMain.handle('photo:del', (_e, id) => { guardarFoto(id, ''); return true; });

  const envolver = fn => async (_e, ...a) => {
    try { await fn(...a); return { ok: true, estado: nube.obtener() }; }
    catch (err) { return { ok: false, msg: nube.mensaje(err) }; }
  };
  ipcMain.handle('sync:status', () => nube.obtener());
  ipcMain.handle('sync:connect', envolver((email, clave) => nube.conectar(email, clave)));
  ipcMain.handle('sync:disconnect', envolver(() => nube.desconectar()));
  ipcMain.handle('sync:now', envolver(() => nube.sincronizar()));
  ipcMain.handle('sync:restore', envolver(() => nube.restaurar()));
  ipcMain.handle('sync:uploadAll', envolver(() => nube.subirTodo()));

  /* ---------- ventana ---------- */
  function crear() {
    win = new BrowserWindow({
      width: 1280, height: 800, minWidth: 360, minHeight: 600,
      backgroundColor: '#0B1220', title: 'Cecilia',
      icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
    });
    win.removeMenu();
    win.loadFile(path.join(__dirname, 'www', 'index.html'));
    // F11 = pantalla completa (útil en el mostrador)
    win.webContents.on('before-input-event', (e, i) => {
      if (i.type === 'keyDown' && i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    });
    // los enlaces externos (por ejemplo tel:) se abren fuera de la app
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); } });
  }

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((wc, permiso, cb) => cb(permiso === 'media'));   // cámara
    crear();
    nube.iniciar();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) crear(); });
  });
  app.on('before-quit', () => { clearTimeout(tEscribir); escribirDisco(); });   // no perder el último cambio
  app.on('window-all-closed', () => app.quit());
}
