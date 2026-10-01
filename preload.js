const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // datos locales (archivo en el computador)
  loadSync: () => ipcRenderer.sendSync('state:load'),
  migrateSync: (estado) => ipcRenderer.sendSync('state:migrate', estado),
  save: (json) => ipcRenderer.send('state:save', json),
  replace: (json) => ipcRenderer.invoke('state:replace', json),
  onError: (cb) => ipcRenderer.on('state:error', (_e, m) => cb(m)),

  // fotos de facturas (archivos en el computador, no van a la nube)
  setPhoto: (id, dataUrl) => ipcRenderer.invoke('photo:set', id, dataUrl),
  getPhoto: (id) => ipcRenderer.invoke('photo:get', id),
  delPhoto: (id) => ipcRenderer.invoke('photo:del', id),

  // nube (Firestore)
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    connect: (email, clave) => ipcRenderer.invoke('sync:connect', email, clave),
    disconnect: () => ipcRenderer.invoke('sync:disconnect'),
    now: () => ipcRenderer.invoke('sync:now'),
    restore: () => ipcRenderer.invoke('sync:restore'),
    uploadAll: () => ipcRenderer.invoke('sync:uploadAll'),
    onStatus: (cb) => ipcRenderer.on('sync:status', (_e, s) => cb(s))
  }
});
