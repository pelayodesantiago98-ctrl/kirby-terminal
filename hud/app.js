/* ==========================================================================
   Claude HUD — logica de la ventana
   Pregunta el estado a hud.py cada POLL_MS y repinta las dos escenas.
   ========================================================================== */

const POLL_MS = 200;

const CHIP = {
  idle:     'en reposo',
  thinking: 'pensando',
  working:  'consultando',
  asking:   'te pregunta',
  done:     'listo',
};

const $ = (id) => document.getElementById(id);
const el = {
  body:      document.body,
  stage:     $('stage'),
  artThink:  $('artThink'),
  artBoard:  $('artBoard'),
  thinkLine: $('thinkLine'),
  elapsed:   $('thinkElapsed'),
  title:     $('boardTitle'),
  bodyText:  $('boardBody'),
  desk:      $('deskLine'),
  chipText:  $('chipText'),
};

/* --------------------------------------------------------------------------
   1. Cargar las imagenes. Si dejas el GIF original en assets/ se usa ese
      (y Kirby se mueve solo); si no, cae al png/webp/jpg.
   -------------------------------------------------------------------------- */
function loadArt(imgEl, name) {
  const exts = ['gif', 'png', 'webp', 'jpg', 'jpeg'];
  (function tryNext(i) {
    if (i >= exts.length) {
      console.warn(`[hud] no encuentro assets/${name}.*`);
      return;
    }
    const src = `assets/${name}.${exts[i]}`;
    const probe = new Image();
    probe.onload  = () => { imgEl.src = src; };
    probe.onerror = () => tryNext(i + 1);
    probe.src = src;
  })(0);
}
loadArt(el.artThink, 'thinking');
loadArt(el.artBoard, 'terminal');

/* --------------------------------------------------------------------------
   2. Encajar el texto dentro de la pizarra, que es pequena.
      Baja el cuerpo de letra hasta que no desborde.
   -------------------------------------------------------------------------- */
function fitBoardText() {
  const box = el.bodyText;
  const unit = el.stage.clientWidth / 100;   // 1cqw en px
  let size = 1.55 * unit;
  const min = 0.85 * unit;

  box.style.fontSize = `${size}px`;
  while (size > min && box.scrollHeight > box.clientHeight + 1) {
    size -= 0.5;
    box.style.fontSize = `${size}px`;
  }
}
window.addEventListener('resize', fitBoardText);

/* --------------------------------------------------------------------------
   3. Pintar un estado
   -------------------------------------------------------------------------- */
let since = Date.now() / 1000;
let lastRev = -1;

function render(s) {
  el.body.dataset.state = s.state || 'idle';
  el.chipText.textContent = CHIP[s.state] || s.state || '';

  el.thinkLine.textContent = s.line || 'pensando';
  el.title.textContent     = s.title || 'POYO';

  if (el.bodyText.textContent !== (s.body || '')) {
    el.bodyText.textContent = s.body || '';
    fitBoardText();
  }

  el.desk.textContent = s.desk || '';
  since = s.since || (Date.now() / 1000);
  tickElapsed();
}

function tickElapsed() {
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - since));
  el.elapsed.textContent = secs < 60
    ? `${secs}s`
    : `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s`;
}
setInterval(tickElapsed, 1000);

/* --------------------------------------------------------------------------
   4. Sondeo
   -------------------------------------------------------------------------- */
let demoMode = false;

async function poll() {
  if (demoMode) return;              // en modo prueba no pisamos lo de pantalla
  try {
    const r = await fetch('state', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const s = await r.json();
    el.body.classList.remove('offline');
    if (s.rev !== lastRev) {
      lastRev = s.rev;
      render(s);
    }
  } catch {
    el.body.classList.add('offline');
  }
}
poll();
setInterval(poll, POLL_MS);

/* --------------------------------------------------------------------------
   5. Modo prueba sin Claude:
        ESPACIO -> rota los estados      ESC -> vuelve al estado real
   -------------------------------------------------------------------------- */
const DEMO = [
  { state: 'idle',     line: 'esperando',                        title: 'POYO',   body: '' },
  { state: 'thinking', line: 'Leyendo lo que le has pedido',     title: 'POYO',   body: '' },
  { state: 'working',  line: '$ npm test -- --watch=false',      title: 'POYO',   body: '' },
  { state: 'asking',   line: 'permiso para Bash',                title: 'Te pregunta',
    body: 'Voy a borrar 3 ficheros de build/.\n\n¿Confirmas?' },
  { state: 'done',     line: 'Listo',                            title: 'Listo',
    body: 'Añadido el hook de PreToolUse y\nprobado con 12 tests en verde.' },
];
let demoI = -1;

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    demoMode = false;
    lastRev = -1;                    // fuerza repintado con el estado real
    poll();
    return;
  }
  if (e.code !== 'Space') return;
  e.preventDefault();
  demoMode = true;
  demoI = (demoI + 1) % DEMO.length;
  render({ ...DEMO[demoI], desk: 'modo prueba · espacio rota · esc sale', since: Date.now() / 1000 });
});
