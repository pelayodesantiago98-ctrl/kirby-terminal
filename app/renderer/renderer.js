/* ===========================================================================
   Kirby Terminal — ventana
   Monta xterm dentro de la pizarra (una pestana = un terminal = un PTY) y
   cambia el decorado segun el estado que escriben los hooks de Claude Code.
   =========================================================================== */

const CHIP = {
  idle:     'en reposo',
  thinking: 'pensando',
  working:  'consultando',
  asking:   'te pregunta',
  done:     'listo',
};

// Tema claro: el terminal esta sobre una pizarra blanca, no sobre negro.
const THEME = {
  background:          '#ffffff',
  foreground:          '#24365f',
  cursor:              '#3d74db',
  cursorAccent:        '#ffffff',
  selectionBackground: '#cfe0ff',
  black:   '#2b3555', red:     '#c0392b', green:   '#2f8f4e', yellow:  '#a97a12',
  blue:    '#3d74db', magenta: '#8e44ad', cyan:    '#1f7a8c', white:   '#dfe7f5',
  brightBlack:   '#5d6d8c', brightRed:     '#e05a4a',
  brightGreen:   '#35b45c', brightYellow:  '#e0a11b',
  brightBlue:    '#5b8ee8', brightMagenta: '#a371f7',
  brightCyan:    '#2a9db3', brightWhite:   '#ffffff',
};

// Modo noche: la pizarra deja de ser blanca y pasa a fondo oscuro con letra clara.
const THEME_DARK = {
  background:          '#0f1626',
  foreground:          '#dfe7f5',
  cursor:              '#5b8ee8',
  cursorAccent:        '#0f1626',
  selectionBackground: '#2a3a63',
  black:   '#2b3555', red: '#e05a4a', green: '#35b45c', yellow: '#e0a11b',
  blue:    '#5b8ee8', magenta: '#a371f7', cyan:  '#2a9db3', white:  '#c6d2ea',
  brightBlack:   '#5d6d8c', brightRed:     '#ff7a68',
  brightGreen:   '#4fd07a', brightYellow:  '#f0b840',
  brightBlue:    '#7aa6f0', brightMagenta: '#c08bff',
  brightCyan:    '#49b9cf', brightWhite:   '#ffffff',
};

const FONT = '"SF Mono", "JetBrains Mono", Menlo, ui-monospace, monospace';

// ---------------------------------------------------------------------------
// Modo noche  (Cmd+Shift+N para alternar; por defecto sigue al sistema)
// Se define antes que las pestanas porque cada terminal nace ya con su tema.
// ---------------------------------------------------------------------------

const NIGHT_KEY = 'kirby-night';

function nightStored() {
  try { return localStorage.getItem(NIGHT_KEY); } catch { return null; }
}

function nightPref() {
  const s = nightStored();
  if (s === '1') return true;
  if (s === '0') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;   // sin preferencia: como el sistema
}

let night = nightPref();

function setNight(on) {
  night = on;
  document.body.classList.toggle('night', on);
  for (const t of tabs) t.term.options.theme = on ? THEME_DARK : THEME;
  if (typeof paintMode === 'function') paintMode();
}

function toggleNight() {
  try { localStorage.setItem(NIGHT_KEY, night ? '0' : '1'); } catch {}
  setNight(!night);
}

// Si el usuario no ha elegido a mano, la app sigue los cambios del sistema.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
  if (nightStored() === null) setNight(e.matches);
});

// ---------------------------------------------------------------------------
// Pestanas
// Cada una tiene su terminal, su PTY y su panel; solo el panel activo se ve.
// El cuerpo de letra es de la ventana entera, no de cada pestana.
// ---------------------------------------------------------------------------

const host     = document.getElementById('termHost');
const tabsList = document.getElementById('tabsList');
const tabsBar  = document.getElementById('tabs');

const tabs = [];        // en el orden en que se ven
let active = null;      // la pestana en pantalla
let seq = 0;            // id que no se reutiliza nunca
let fontSize = 12.5;

function byId(id) { return tabs.find((t) => t.id === id) || null; }

function newTab(fromId) {
  const id = ++seq;

  const pane = document.createElement('div');
  pane.className = 'pane';
  host.appendChild(pane);

  const term = new Terminal({
    fontFamily: FONT,
    fontSize,
    lineHeight: 1.25,
    letterSpacing: 0,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowProposedApi: true,
    scrollback: 20000,
    theme: night ? THEME_DARK : THEME,
  });

  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(pane);

  try {
    const webgl = new WebglAddon.WebglAddon();
    // Chrome solo mantiene un punado de contextos WebGL: con muchas pestanas
    // el navegador tira los viejos. Al perderlo soltamos el addon y xterm
    // sigue pintando por el camino normal.
    webgl.onContextLoss(() => { try { webgl.dispose(); } catch {} });
    term.loadAddon(webgl);
  } catch {
    // Sin WebGL xterm cae al renderizador de canvas. Va bien igual.
  }

  // --- la chapa de la pestana ---
  const chip = document.createElement('div');
  chip.className = 'tab';

  const fav = document.createElement('span');   // el hueco del favicon
  fav.className = 'tab-fav';
  chip.appendChild(fav);

  const label = document.createElement('span');
  label.className = 'tab-name';
  label.textContent = 'terminal ' + (tabs.length + 1);
  chip.appendChild(label);

  const x = document.createElement('button');
  x.className = 'tab-x';
  x.type = 'button';
  x.textContent = '×';
  x.title = 'Cerrar (cmd+W)';
  x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id); });
  chip.appendChild(x);

  chip.addEventListener('mousedown', () => activate(id));
  // Boton central: cerrar, como en el navegador.
  chip.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });

  const tab = { id, term, fit, pane, chip, label, cols: 0, rows: 0 };

  const pos = active ? tabs.indexOf(active) + 1 : tabs.length;
  tabs.splice(pos, 0, tab);
  tabsList.insertBefore(chip, tabsList.children[pos] || null);

  // El titulo lo pone el shell; la chapa lo recorta sola con puntos suspensivos.
  term.onTitleChange((t) => {
    const limpio = (t || '').trim();
    if (!limpio) return;
    tab.bautizada = true;          // manda el shell, no la carpeta
    label.textContent = limpio;
    retitular(tab);
  });

  term.onData((data) => window.kirby.write(id, data));

  // Se activa antes de arrancar el PTY: el panel tiene que estar a la vista
  // para que fit() mida bien las columnas.
  activate(id);
  window.kirby.start(id, tab.cols, tab.rows, fromId);

  renumber();
  return tab;
}

function activate(id) {
  const tab = byId(id);
  if (!tab) return;

  active = tab;
  for (const t of tabs) {
    const on = t === tab;
    t.pane.classList.toggle('on', on);
    t.chip.classList.toggle('on', on);
  }

  // Estaba oculto, asi que sus medidas estaban congeladas: se recalculan.
  resize();
  tab.term.focus();
  window.__term = tab.term;                  // para las devtools (Cmd+Alt+I)
  tab.chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function closeTab(id) {
  const tab = byId(id);
  if (!tab) return;
  window.kirby.kill(id);
  dropTab(tab);
}

// Quita la pestana de la ventana. El PTY ya esta muerto (o muriendose).
function dropTab(tab) {
  const i = tabs.indexOf(tab);
  if (i < 0) return;

  tabs.splice(i, 1);
  tab.chip.remove();
  try { tab.term.dispose(); } catch {}
  tab.pane.remove();

  if (!tabs.length) {           // era la ultima: la ventana se va con ella
    window.kirby.closeWindow();
    return;
  }

  renumber();
  if (active === tab) activate(tabs[Math.min(i, tabs.length - 1)].id);
}

// El globo de ayuda de cada pestana: su titulo y el atajo que la trae (cmd+1..8,
// cmd+9 salta siempre a la ultima, igual que en Chrome).
function retitular(tab) {
  const i = tabs.indexOf(tab);
  const n = i === tabs.length - 1 ? 9 : (i < 8 ? i + 1 : 0);
  tab.chip.title = tab.label.textContent + (n ? `  ·  cmd+${n}` : '');
}

function renumber() {
  for (const t of tabs) retitular(t);
  tabsBar.classList.toggle('solo', tabs.length === 1);
}

function step(d) {
  if (tabs.length < 2) return;
  const i = (tabs.indexOf(active) + d + tabs.length) % tabs.length;
  activate(tabs[i].id);
}

// --- tamano ---------------------------------------------------------------
// El rectangulo de la pizarra no cambia entre estados, asi que esto solo salta
// cuando el usuario redimensiona la ventana de verdad. Solo se mide la pestana
// visible: las ocultas no tienen alto y darian medidas absurdas.

function resize() {
  if (!active) return;
  active.fit.fit();
  const { cols, rows } = active.term;
  if (cols !== active.cols || rows !== active.rows) {
    active.cols = cols;
    active.rows = rows;
    window.kirby.resize(active.id, cols, rows);
  }
}

new ResizeObserver(resize).observe(host);
addEventListener('resize', resize);

// --- cableado con los PTY -------------------------------------------------

window.kirby.onData((id, data) => { const t = byId(id); if (t) t.term.write(data); });
window.kirby.onExit((id) => { const t = byId(id); if (t) dropTab(t); });

// Nombre de partida: la carpeta donde ha nacido el shell. Si mas tarde el shell
// manda un titulo, ese manda.
window.kirby.onCwd((id, cwd, casa) => {
  const t = byId(id);
  if (!t || t.bautizada) return;
  const hoja = cwd.replace(/\/+$/, '').split('/').pop();
  t.label.textContent = casa ? '~' : (hoja || cwd);
  retitular(t);
});

document.getElementById('tabNew').addEventListener('click', () => {
  newTab(active ? active.id : null);
});

// Mi GitHub: se abre en el navegador, no dentro de la app.
const GITHUB = 'https://github.com/pelayodesantiago98-ctrl';

document.getElementById('tabGh').addEventListener('click', () => {
  window.kirby.openUrl(GITHUB);
  if (active) active.term.focus();
});

const modeBtn = document.getElementById('tabMode');
modeBtn.addEventListener('click', () => { toggleNight(); if (active) active.term.focus(); });

function paintMode() {
  modeBtn.title = night ? 'Modo dia (cmd+shift+N)' : 'Modo noche (cmd+shift+N)';
}

window.kirby.reset();   // por si veniamos de una recarga: fuera los PTY viejos
newTab(null);           // la primera pestana

// Al pinchar en cualquier parte del decorado, el foco vuelve al terminal.
document.addEventListener('mousedown', (e) => {
  if (!host.contains(e.target) && !tabsBar.contains(e.target)) {
    setTimeout(() => { if (active) active.term.focus(); }, 0);
  }
});

// ---------------------------------------------------------------------------
// Estado de Claude
// ---------------------------------------------------------------------------

const noteLine = document.getElementById('noteLine');
const chipText = document.getElementById('chipText');
const elapsed  = document.getElementById('elapsed');

let since = Date.now() / 1000;

function render(s) {
  const state = s.state || 'idle';
  document.body.dataset.state = state;
  chipText.textContent = CHIP[state] || state;
  noteLine.textContent = s.line || 'Pensando';
  since = s.since || Date.now() / 1000;
  tick();
}

function tick() {
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - since));
  elapsed.textContent = secs < 60
    ? `${secs}s`
    : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}
setInterval(tick, 1000);

window.kirby.onState(render);
window.kirby.getState().then(render);

// ---------------------------------------------------------------------------
// Intro automatico
// Manda un enter al PTY de la pestana visible cada X segundos, en bucle, hasta
// que se apaga. Es exactamente lo mismo que teclear intro: no toca el estado ni
// la escena. Arranca siempre apagado — el intervalo si se recuerda — para que
// abrir la app no dispare enters por su cuenta.
// ---------------------------------------------------------------------------

const PASOS    = [3, 5, 10, 15, 30, 60, 120, 300];
const AUTO_KEY = 'kirby-auto-secs';

const autoBox   = document.getElementById('auto');
const autoLabel = document.getElementById('autoLabel');
const autoSecs  = document.getElementById('autoSecs');

function autoGuardado() {
  try { return Number(localStorage.getItem(AUTO_KEY)); } catch { return 0; }
}

let autoIdx  = Math.max(0, PASOS.indexOf(autoGuardado() || 10));
let autoOn   = false;
let autoLeft = PASOS[autoIdx];
let autoTimer = null;

function autoPaint() {
  autoBox.classList.toggle('on', autoOn);
  autoLabel.textContent = autoOn ? 'enter' : 'auto';
  autoSecs.textContent  = `${autoOn ? autoLeft : PASOS[autoIdx]}s`;
}

function autoTick() {
  autoLeft -= 1;
  if (autoLeft <= 0) {
    if (active) window.kirby.write(active.id, '\r');
    autoLeft = PASOS[autoIdx];
    autoBox.classList.remove('fire');
    void autoBox.offsetWidth;          // reinicia la animacion del guino
    autoBox.classList.add('fire');
  }
  autoPaint();
}

function autoSet(on) {
  autoOn = on;
  clearInterval(autoTimer);
  autoTimer = null;
  if (autoOn) {
    autoLeft = PASOS[autoIdx];
    autoTimer = setInterval(autoTick, 1000);
  }
  autoPaint();
}

function autoStep(d) {
  autoIdx = Math.min(PASOS.length - 1, Math.max(0, autoIdx + d));
  try { localStorage.setItem(AUTO_KEY, String(PASOS[autoIdx])); } catch {}
  // Si esta en marcha, el cambio entra ya: la cuenta vuelve a empezar.
  if (autoOn) autoLeft = PASOS[autoIdx];
  autoPaint();
}

document.getElementById('autoGo').addEventListener('click', () => autoSet(!autoOn));
document.getElementById('autoMinus').addEventListener('click', () => autoStep(-1));
document.getElementById('autoPlus').addEventListener('click', () => autoStep(+1));

autoPaint();

// ---------------------------------------------------------------------------
// Atajos
// ---------------------------------------------------------------------------

function setFontSize(px) {
  fontSize = Math.min(24, Math.max(8, px));
  for (const t of tabs) t.term.options.fontSize = fontSize;
  resize();
}

addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();

  // --- pestanas ---
  if (e.metaKey && !e.shiftKey && k === 't') {
    e.preventDefault();
    newTab(active ? active.id : null);
  } else if (e.metaKey && !e.shiftKey && k === 'w') {
    e.preventDefault();
    if (active) closeTab(active.id);
  } else if (e.metaKey && !e.shiftKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    const i = Number(e.key) - 1;
    if (e.key === '9') activate(tabs[tabs.length - 1].id);   // cmd+9 = la ultima
    else if (tabs[i]) activate(tabs[i].id);
  } else if (e.metaKey && e.shiftKey && (k === ']' || e.key === '}')) {
    e.preventDefault(); step(+1);
  } else if (e.metaKey && e.shiftKey && (k === '[' || e.key === '{')) {
    e.preventDefault(); step(-1);
  } else if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
    e.preventDefault(); step(e.shiftKey ? -1 : +1);

  // --- cuerpo de letra: el PTY se entera por el ResizeObserver ---
  } else if (e.metaKey && (e.key === '+' || e.key === '=')) {
    e.preventDefault(); setFontSize(fontSize + 1);
  } else if (e.metaKey && e.key === '-') {
    e.preventDefault(); setFontSize(fontSize - 1);

  // --- decorado ---
  } else if (e.metaKey && e.shiftKey && k === 'n') {
    // Alterna el modo noche y recuerda la eleccion.
    e.preventDefault();
    toggleNight();
  } else if (e.metaKey && e.shiftKey && k === 'e') {
    // Enciende o apaga el intro automatico sin soltar el teclado.
    e.preventDefault();
    autoSet(!autoOn);
  } else if (e.metaKey && e.shiftKey && k === 'p') {
    // Rota los estados para ver como queda sin arrancar Claude.
    e.preventDefault();
    const all = Object.keys(CHIP);
    const i = (all.indexOf(document.body.dataset.state) + 1) % all.length;
    render({ state: all[i], line: 'modo prueba · cmd+shift+P rota', since: Date.now() / 1000 });
  }
});

// El menu de la barra de arriba manda por aqui lo que se lleva macOS antes que
// la ventana (cmd+T, cmd+W, cmd +/-...).
window.kirby.onMenu((que) => {
  if (que === 'new-tab')        newTab(active ? active.id : null);
  else if (que === 'close-tab') { if (active) closeTab(active.id); }
  else if (que === 'next')      step(+1);
  else if (que === 'prev')      step(-1);
  else if (que === 'font+')     setFontSize(fontSize + 1);
  else if (que === 'font-')     setFontSize(fontSize - 1);
  else if (que === 'night')     toggleNight();
  else if (que === 'auto')      autoSet(!autoOn);
});

setNight(night);
