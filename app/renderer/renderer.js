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

  // Teclear en la pestana es haberla visto: el aviso se apaga.
  term.onData((data) => {
    calmar(tab);
    window.kirby.write(id, data);
  });

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

  // Si la ventana esta delante, activarla es haberla mirado.
  if (document.hasFocus()) calmar(tab);

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

// Estados que piden tu atencion: ha terminado, o quiere preguntarte algo.
const AVISAN = new Set(['done', 'asking']);

// A que pestana pertenece este estado. Los shells de la app llevan KIRBY_TAB en
// el entorno, asi que el hook dice de quien es y el proceso principal lo
// traduce a tabId. Si no viene (un Claude lanzado desde fuera, o un hud.py
// viejo) damos por hecho que es el de la pestana a la vista.
function rutaDe(s) {
  if (s.tabId != null) return byId(s.tabId);
  return active;
}

// El acento de la pestana pasa a ser el de SU estado, no el de la ventana.
function pintarEstado(tab, state) {
  tab.state = state;
  tab.chip.dataset.state = state;
}

function avisar(tab) {
  if (!tab || tab.aviso) return;
  tab.aviso = true;
  tab.chip.classList.add('aviso');
}

function calmar(tab) {
  if (!tab || !tab.aviso) return;
  tab.aviso = false;
  tab.chip.classList.remove('aviso');
}

// La primera lectura es el estado que quedo en disco de la vez anterior: pinta,
// pero no parpadea. Y de las siguientes solo avisan las que traen novedad (rev
// sube con cada escritura de hud.py).
let primera = true;
let ultimoRev = null;

function render(s) {
  const state = s.state || 'idle';
  document.body.dataset.state = state;
  chipText.textContent = CHIP[state] || state;
  noteLine.textContent = s.line || 'Pensando';
  since = s.since || Date.now() / 1000;
  tick();

  const nuevo = !primera && s.rev !== ultimoRev;
  primera = false;
  ultimoRev = s.rev;

  const tab = rutaDe(s);
  if (!tab) return;

  pintarEstado(tab, state);

  if (!AVISAN.has(state)) {
    calmar(tab);               // volvio a trabajar: ya no espera nada de ti
  } else if (nuevo && (tab !== active || !document.hasFocus())) {
    avisar(tab);               // si la tienes delante no hace falta parpadeo
  }
}

// Volver a la ventana es mirar la pestana que este puesta.
addEventListener('focus', () => calmar(active));

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

/* ---------------------------------------------------------------------------
   La lluvia de kirbys
   Empieza con la terminal y ya no para: cada dos por tres se suelta uno, que
   baja despacio balanceandose de su sombrilla y se apaga al llegar abajo. El
   tope de cuantos hay a la vez se vuelve a echar a suertes en cada intento
   entre MIN_CAYENDO y MAX_CAYENDO, asi que la cantidad va y viene sola en vez
   de quedarse clavada. cmd+shift+K suelta uno en el momento.
   --------------------------------------------------------------------------- */
const rain = document.getElementById('rain');
const MIN_CAYENDO = 3;
const MAX_CAYENDO = 8;

function soltarKirby(forzar) {
  if (!rain) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const tope = MIN_CAYENDO + Math.floor(Math.random() * (MAX_CAYENDO - MIN_CAYENDO + 1));
  if (!forzar && rain.childElementCount >= tope) return;
  if (rain.childElementCount >= MAX_CAYENDO) return;

  const ancho = rain.clientWidth  || 640;
  const alto  = rain.clientHeight || 420;
  const s = 14 + Math.round(Math.random() * 6);              // el cuerpo
  const centro = s / 2 + Math.random() * Math.max(1, ancho - s);
  const dur = 7 + Math.random() * 3;                         // muy despacio

  const k = document.createElement('div');
  k.className = 'rain-k';
  k.style.setProperty('--alto', (alto + 220) + 'px');        // desde donde cae
  k.style.setProperty('--x', Math.round(centro - s * LIENZO_CENTRO) + 'px');
  k.style.setProperty('--s', s + 'px');
  k.style.setProperty('--dur', dur.toFixed(2) + 's');
  // el balanceo: cada uno con su ritmo, y empezado por un punto distinto para
  // que no vayan todos a la vez como un metronomo
  const vaiven = 2.4 + Math.random() * 1.8;
  k.style.setProperty('--vaiven', vaiven.toFixed(2) + 's');
  k.style.setProperty('--vdelay', (-Math.random() * vaiven).toFixed(2) + 's');
  k.appendChild(document.createElement('i'));                // la capa que oscila
  k.addEventListener('animationend', (e) => {                // llego y se apago
    if (e.target === k) k.remove();
  });
  rain.appendChild(k);
}

function lloverSinParar() {
  if (!rain) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  rain.classList.add('on');
  soltarKirby();
  setTimeout(lloverSinParar, 1200 + Math.random() * 2300);
}

/* ---------------------------------------------------------------------------
   La raya de encima de la caja de texto, y los kirbys que se apoyan en ella

   La raya vive abajo del todo de la pizarra, justo por encima de donde escribes.
   Se dibuja de izquierda a derecha al abrir, y se vuelve a dibujar cada vez que
   hay que cerrar una caida.

   Encima de ella se van asomando kirbys: tres a la vez como mucho, y cada pocos
   segundos a uno le toca irse y volver en otro sitio, asi la fila rota sola y
   nunca aparecen dos veces igual. Hay una segunda percha arriba, en el trozo de
   la tira de pestanas que queda libre: si no cabe, no sale nadie.
   --------------------------------------------------------------------------- */
const perch = document.getElementById('perch');   // en el suelo de la pizarra
const roost = document.getElementById('roost');   // en el hueco sin pestanas
// Todos normalizados al mismo lienzo, con el cuerpo de Kirby del mismo tamano
// en los cinco; lo que se sale del lienzo son los trastos que lleve cada uno.
const KIRBYS_GIF = [
  'assets/kirbys/k1.webp',
  'assets/kirbys/k2.webp',
  'assets/kirbys/k3.webp',
  'assets/kirbys/k4.webp',
];

// Los dos sentados con el mando: solo salen encima del chip de "pensando".
const KIRBYS_SENTADOS = ['assets/kirbys/sentado.webp'];

// Del alto de Kirby a su lienzo: ancho, y cuanto hay de su centro al borde.
const LIENZO_CENTRO = 2.55;

// Lo que aguanta uno antes de irse y dejar sitio a otro. Es a proposito tan
// largo: son parte del decorado, no una animacion que pedir a gritos.
const VIDA_MIN = 20 * 60 * 1000;
const VIDA_MAX = 40 * 60 * 1000;

// El trozo de tira que no ocupan las pestanas: del boton + hasta los laterales.
function huecoSinPestanas() {
  const mas  = document.getElementById('tabNew');
  const lado = document.querySelector('.tab-side');
  if (!mas || !lado || !roost) return null;
  const cero = roost.getBoundingClientRect().left;
  const a = mas.getBoundingClientRect().right - cero + 6;
  const b = lado.getBoundingClientRect().left  - cero - 6;
  // las pestanas se estiran y dejan poco sitio: si no cabe, no sale nadie
  return b - a < 30 ? null : [a, b];
}

/* Monta una percha: unos cuantos kirbys que salen, se quitan y vuelven en otro
   sitio. `donde` devuelve el tramo [desde, hasta] disponible, o null si no cabe
   nadie en ese momento (la tira se llena de pestanas y se quedan fuera). */
function percha(host, cuantos, donde, tam = [16, 22], gifs = KIRBYS_GIF) {
  if (!host) return;

  const fila = [];
  for (let i = 0; i < cuantos; i++) {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    host.appendChild(img);
    fila.push({ img, hueco: -1 });
  }

  function colocar(k) {
    const tramo = donde();
    // sin sitio (la caja esta oculta, o las pestanas se han comido la tira):
    // se deja el hueco libre y se vuelve a mirar dentro de un rato
    if (!tramo) { k.hueco = -1; setTimeout(() => colocar(k), 30000); return; }

    const [desde, hasta] = tramo;
    const ancho = hasta - desde;
    // el cuerpo de Kirby, que es lo que tiene que caber: sus trastos ya se
    // saldran por los lados, no pasa nada
    const alto = Math.min(Math.round(ancho), tam[0] + Math.round(Math.random() * (tam[1] - tam[0])));
    const huecos = Math.max(cuantos + 1, Math.floor(ancho / 95));
    const paso = ancho / huecos;

    let h = 0;
    for (let intento = 0; intento < 14; intento++) {
      h = Math.floor(Math.random() * huecos);
      if (!fila.some((o) => o !== k && o.hueco === h)) break;
    }
    k.hueco = h;

    // el centro de Kirby cae en el hueco; el lienzo se coloca a partir de ahi
    let centro = desde + h * paso + paso / 2 + (Math.random() - 0.5) * paso * 0.35;
    centro = Math.max(desde + alto / 2, Math.min(hasta - alto / 2, centro));
    k.img.style.setProperty('--x', Math.round(centro - alto * LIENZO_CENTRO) + 'px');
    k.img.style.setProperty('--s', alto + 'px');
    k.img.src = gifs[Math.floor(Math.random() * gifs.length)];
    requestAnimationFrame(() => k.img.classList.add('on'));
  }

  // Cada uno lleva su propio reloj: cuando se le acaba se encoge, cambia de
  // sitio y vuelve a asomarse. Al ir por libre no se relevan todos a la vez.
  function relevo(k) {
    setTimeout(() => {
      k.img.classList.remove('on');
      setTimeout(() => { colocar(k); relevo(k); }, 700);
    }, VIDA_MIN + Math.random() * (VIDA_MAX - VIDA_MIN));
  }

  fila.forEach((k, i) => setTimeout(() => { colocar(k); relevo(k); }, 500 + i * 750));
}

// Cuelga una percha del borde de arriba de una caja de la escena (el chip de
// "pensando", la nota, la barra del intro automatico...). `tramo` acota en que
// trozo de ese borde pueden salir, `gifs` con que dibujos y `tam` como de
// grandes (el alto del cuerpo de Kirby, entre un minimo y un maximo).
function perchaEncimaDe(selector, cuantos, opciones = {}) {
  const caja = document.querySelector(selector);
  if (!caja) return;
  const p = document.createElement('div');
  p.className = 'kperch arriba';
  p.setAttribute('aria-hidden', 'true');
  caja.appendChild(p);
  const tramo = opciones.tramo || ((c) => [0, c.clientWidth]);
  percha(p, cuantos, () => {
    const [a, b] = tramo(p);
    return b - a < 50 ? null : [a, b];
  }, opciones.tam || [14, 19], opciones.gifs);
}

function kirbysApoyados() {
  if (!perch) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  percha(perch, 3, () => [0, perch.clientWidth || 600], [16, 22]);
  percha(roost, 1, huecoSinPestanas, [13, 18]);

  // los bordes de arriba de las otras cajas tambien son buen sitio para sentarse
  perchaEncimaDe('.auto', 1);   // la barra del intro automatico

  // encima de "pensando", solo los dos del mando, sentados en el borde
  perchaEncimaDe('.chip', 1, { gifs: KIRBYS_SENTADOS, tam: [22, 25] });

  // Y en la nota, solo por la derecha: el trozo de su borde que queda debajo
  // del chip de "pensando" se deja libre, que ahi ya hay quien se siente.
  perchaEncimaDe('.note', 2, {
    tramo: (p) => {
      const chip = document.querySelector('.chip');
      if (!chip || getComputedStyle(chip).display === 'none') return [0, p.clientWidth];
      const hueco = chip.getBoundingClientRect().right - p.getBoundingClientRect().left;
      return [Math.max(0, hueco + 12), p.clientWidth];
    },
  });
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
  } else if (e.metaKey && e.shiftKey && k === 'k') {
    // Que caiga uno ya, sin esperar al siguiente.
    e.preventDefault();
    soltarKirby(true);
  } else if (e.metaKey && e.shiftKey && k === 'p') {
    // Rota los estados para ver como queda sin arrancar Claude.
    e.preventDefault();
    const all = Object.keys(CHIP);
    const i = (all.indexOf(document.body.dataset.state) + 1) % all.length;
    render({
      state: all[i],
      line: 'modo prueba · cmd+shift+P rota',
      since: Date.now() / 1000,
      rev: (ultimoRev || 0) + 1,
    });
    // En la prueba tienes la ventana delante, asi que el parpadeo no saltaria
    // solo: aqui se fuerza para poder verlo.
    if (AVISAN.has(all[i])) avisar(active);
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

// Un saludo al abrir: llueve una vez y se retira sola (cmd+shift+K la repite).
kirbysApoyados();
lloverSinParar();
