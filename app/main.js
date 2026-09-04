// Proceso principal: la ventana, los PTY (uno por pestana) y el vigilante del
// estado de Claude.

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const pty = require('node-pty');

// Donde hud.py deja el estado. Es el mismo fichero que usaba el HUD viejo,
// asi que los hooks de Claude Code no cambian.
const STATE_FILE = path.join(os.homedir(), '.claude', 'hud', 'state.json');

let win = null;

// Un PTY por pestana, indexado por el id que reparte la ventana.
const ptys = new Map();

// Firma de esta ejecucion. Cada shell nace con KIRBY_TAB=<firma>:<id> en el
// entorno; los hooks de Claude Code heredan esa variable y hud.py la copia al
// estado, asi que sabemos de que pestana viene cada aviso. La firma evita que
// un Kirby Terminal se crea suyos los avisos de otro que este abierto a la vez.
const FIRMA = String(process.pid);

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Kirby Terminal',
    backgroundColor: '#c2d9e7',
    titleBarStyle: 'hiddenInset',   // sin barra, pero con los botones del Mac
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,               // el preload necesita require()
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Los enlaces se abren en el navegador, no dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; killAllPtys(); });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------------------------------------------------------------------
// Menu
// Hace falta uno propio: el de serie se queda con cmd+W (cerraria la ventana
// entera en vez de la pestana) y con cmd +/- (haria zoom de la pagina en vez de
// cambiar el cuerpo de letra del terminal).
// ---------------------------------------------------------------------------

function buildMenu() {
  const aLaVentana = (que) => () => send('menu', que);

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'Acerca de Kirby Terminal' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar los demas' },
        { role: 'unhide', label: 'Mostrar todo' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir de Kirby Terminal' },
      ],
    },
    {
      label: 'Archivo',
      submenu: [
        { label: 'Pestana nueva',   accelerator: 'Cmd+T', click: aLaVentana('new-tab') },
        { label: 'Cerrar pestana',  accelerator: 'Cmd+W', click: aLaVentana('close-tab') },
        { type: 'separator' },
        { role: 'close', label: 'Cerrar ventana', accelerator: 'Cmd+Shift+W' },
      ],
    },
    {
      label: 'Edicion',
      submenu: [
        { role: 'copy',      label: 'Copiar' },
        { role: 'paste',     label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { label: 'Letra mas grande', accelerator: 'Cmd+Plus',  click: aLaVentana('font+') },
        { label: 'Letra mas pequena', accelerator: 'Cmd+-',    click: aLaVentana('font-') },
        { type: 'separator' },
        { label: 'Modo noche', accelerator: 'Cmd+Shift+N', click: aLaVentana('night') },
        { label: 'Intro automatico', accelerator: 'Cmd+Shift+E', click: aLaVentana('auto') },
        { type: 'separator' },
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    {
      label: 'Ventana',
      submenu: [
        { label: 'Pestana siguiente', accelerator: 'Cmd+Shift+]', click: aLaVentana('next') },
        { label: 'Pestana anterior',  accelerator: 'Cmd+Shift+[', click: aLaVentana('prev') },
        { type: 'separator' },
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
      ],
    },
  ]));
}

// ---------------------------------------------------------------------------
// PTY
// ---------------------------------------------------------------------------

// El directorio de trabajo de un shell vivo, para que la pestana nueva se abra
// donde estaba la anterior (como hace cualquier terminal). Si lsof no contesta
// rapido nos quedamos con el de casa: es un adorno, no un requisito.
function cwdOf(pid) {
  if (!pid) return null;
  try {
    const out = execFileSync('/usr/sbin/lsof', ['-a', '-w', '-d', 'cwd', '-p', String(pid), '-Fn'],
                             { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const line = out.split('\n').find((l) => l.startsWith('n/'));
    return line ? line.slice(1) : null;
  } catch {
    return null;
  }
}

function startPty(id, cols, rows, fromId) {
  if (ptys.has(id)) return;

  const userShell = process.env.SHELL || '/bin/zsh';
  const heredado = fromId != null && ptys.has(fromId) ? cwdOf(ptys.get(fromId).pid) : null;
  const cwd = heredado || process.env.KIRBY_CWD || os.homedir();

  const donde = fs.existsSync(cwd) ? cwd : os.homedir();

  const proc = pty.spawn(userShell, ['-l'], {
    name: 'xterm-256color',
    cols: cols || 100,
    rows: rows || 30,
    cwd: donde,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'KirbyTerminal',
      KIRBY_TAB: `${FIRMA}:${id}`,
    },
  });

  // La ventana bautiza la pestana con el nombre de esta carpeta, hasta que el
  // shell mande un titulo de verdad (zsh en macOS no manda ninguno de serie).
  send('pty:cwd', { id, cwd: donde, casa: donde === os.homedir() });

  proc.onData((data) => send('pty:data', { id, data }));

  proc.onExit(() => {
    ptys.delete(id);
    // Si lo hemos matado nosotros la ventana ya lo sabe. Si se ha ido solo
    // (el usuario escribio `exit`), se lo contamos: ella cierra esa pestana y,
    // si era la ultima, se cierra. Aqui ya no se cierra nada por nuestra cuenta.
    if (!proc.__silent) send('pty:exit', { id });
  });

  ptys.set(id, proc);
}

function killPty(id) {
  const proc = ptys.get(id);
  if (!proc) return;
  ptys.delete(id);
  proc.__silent = true;            // muerte pedida: la ventana no necesita aviso
  try { proc.kill(); } catch { /* ya estaba muerto */ }
}

function killAllPtys() {
  for (const id of [...ptys.keys()]) killPty(id);
}

ipcMain.on('pty:start',  (_e, { id, cols, rows, fromId }) => startPty(id, cols, rows, fromId));
ipcMain.on('pty:write',  (_e, { id, data }) => { const p = ptys.get(id); if (p) p.write(data); });
ipcMain.on('pty:kill',   (_e, { id }) => killPty(id));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => {
  const proc = ptys.get(id);
  if (proc && cols > 0 && rows > 0) {
    try { proc.resize(cols, rows); } catch { /* la ventana se estaba cerrando */ }
  }
});

// Abrir un enlace en el navegador. Solo https, y solo lo que pida la ventana
// al pulsar un boton: no hay navegacion dentro de la app.
ipcMain.on('open-url', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// La ventana arranca de cero (primera carga o recarga con cmd+R): los PTY de
// la vida anterior ya no tienen quien los mire.
ipcMain.on('win:reset', () => killAllPtys());

// La ventana avisa cuando se ha cerrado la ultima pestana.
ipcMain.on('win:close', () => { if (win && !win.isDestroyed()) win.close(); });

// ---------------------------------------------------------------------------
// Estado de Claude
// ---------------------------------------------------------------------------

// De KIRBY_TAB al id de pestana, o null si el aviso no es de esta ventana
// (otro Kirby Terminal, un Claude lanzado desde fuera, o un hud.py viejo).
function pestanaDe(marca) {
  if (typeof marca !== 'string') return null;
  const corte = marca.indexOf(':');
  if (corte < 0 || marca.slice(0, corte) !== FIRMA) return null;
  const id = Number(marca.slice(corte + 1));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readState() {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    s = { state: 'idle', line: 'esperando', title: 'POYO', body: '', desk: '', rev: 0 };
  }
  s.tabId = pestanaDe(s.tab);
  return s;
}

function pushState() {
  send('claude:state', readState());
}

function watchState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

  // watchFile (sondeo de stat) y no watch: hud.py reemplaza el fichero de
  // forma atomica, lo que cambia el inodo y deja sordo a fs.watch.
  fs.watchFile(STATE_FILE, { interval: 120 }, pushState);
}

ipcMain.handle('claude:get', () => readState());

// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  watchState();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killAllPtys();
  app.quit();
});
