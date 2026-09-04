// Puente entre el proceso principal y la ventana. Superficie minima a proposito.
// Todo lo del terminal lleva ahora el id de la pestana.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kirby', {
  // --- terminales (uno por pestana) ---
  start:  (id, cols, rows, fromId) => ipcRenderer.send('pty:start', { id, cols, rows, fromId }),
  write:  (id, data)               => ipcRenderer.send('pty:write', { id, data }),
  resize: (id, cols, rows)         => ipcRenderer.send('pty:resize', { id, cols, rows }),
  kill:   (id)                     => ipcRenderer.send('pty:kill', { id }),
  onData: (cb) => ipcRenderer.on('pty:data', (_e, m) => cb(m.id, m.data)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, m) => cb(m.id)),
  onCwd:  (cb) => ipcRenderer.on('pty:cwd',  (_e, m) => cb(m.id, m.cwd, m.casa)),

  // --- ventana ---
  reset:       () => ipcRenderer.send('win:reset'),
  closeWindow: () => ipcRenderer.send('win:close'),

  openUrl:     (url) => ipcRenderer.send('open-url', url),

  onMenu: (cb) => ipcRenderer.on('menu', (_e, que) => cb(que)),

  // --- estado de Claude ---
  getState: ()   => ipcRenderer.invoke('claude:get'),
  onState:  (cb) => ipcRenderer.on('claude:state', (_e, s) => cb(s)),
});
