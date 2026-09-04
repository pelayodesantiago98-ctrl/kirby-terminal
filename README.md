# Kirby Terminal

Un terminal para macOS donde **Claude Code corre dentro de la pizarra** que
Kirby está señalando. Cuando se pone a pensar, la escena cambia: Kirby aparece
arriba con el portátil y el terminal queda debajo, sobre la mesa.

No es un fondo de pantalla ni una ventana al lado: es un emulador de terminal
de verdad, con su PTY, construido sobre **xterm.js** — el mismo componente con
el que está hecho el terminal de VS Code.

**Vista previa a tamaño real, con deslizadores para colocar cada pieza:**
https://claude.ai/code/artifact/3c7f6577-1df0-4cbf-8286-d46f204c188c

| Estado                 | Qué ves                                                             |
|------------------------|---------------------------------------------------------------------|
| en reposo / listo      | Kirby a la izquierda señalando la pizarra, respirando despacio       |
| te pregunta            | Kirby da dos botes seguidos y el marco de la pizarra late en ámbar   |
| pensando               | Kirby en el portátil, nube de pensamiento animada, y una nota abajo a la izquierda |
| consultando            | lo mismo, pero Kirby **teclea** y la nota dice lo que está haciendo (`Leyendo nginx.conf`, `$ systemctl status…`) |

---

## Las dos decisiones que mandan sobre todo el diseño

**1. La pizarra no es la imagen — es CSS.** El JPG original mide 236×236 px.
Para que quepan ~100 columnas dentro del tablero habría que ampliarlo 3,5× y
quedaría hecho papilla. Así que el tablero, la pared, la mesa y el suelo se
redibujan con CSS (son un rectángulo redondeado y tres colores planos, todos
muestreados píxel a píxel de tus imágenes). Lo único que sigue siendo mapa de
bits son los **recortes de Kirby**, y a él se le deja casi a tamaño nativo.
Resultado: el terminal se ve afiladísimo a cualquier tamaño de ventana.

**2. El rectángulo del terminal no se mueve entre estados.** Si cambiara de
tamaño, el PTY se redimensionaría en cada herramienta que usa Claude y el TUI
se repintaría entero — insufrible. Así que el rectángulo se queda quieto abajo
a la derecha y lo que se mueve es el decorado alrededor. Ese mismo rectángulo
cumple tus dos lecturas: es la pizarra a la derecha de Kirby, y es lo que queda
debajo de él cuando está en el escritorio.

---

## Los dibujos

Los JPG originales medían 236×236 y 447×447 px. Los de `assets/` son
**reescalados ×4 con Real-ESRGAN**, modelo `x4plus_anime_6B` — el que está
entrenado para arte plano con contornos gruesos, que es exactamente esto. En
vez de interpolar (que es lo que emborrona), reconstruye el borde.

Antes se probó **vectorizar** con vtracer, y se descartó tras tres intentos: a
236 px los ojos de Kirby son cuatro píxeles, y cualquier filtro lo bastante
fuerte como para quitar el ruido JPEG se los lleva por delante. Los intentos
están documentados en la vista previa.

Después del escalado quedaba un **halo claro** rodeando la silla: el JPEG mete
*ringing* junto a los bordes muy contrastados, y ESRGAN no sabe que eso es
basura, así que lo reconstruye nítido. Se quita rellenando la pared por
inundación desde los bordes con su color exacto — se come la orla y se para en
seco en el contorno negro. (Detalle que costó un rato: el `floodfill` de Pillow
**retorna sin hacer nada** si el píxel semilla ya tiene el color de relleno, así
que hay que inundar con un color centinela y sustituirlo después.)

### Animación

Todo va con transformaciones del conjunto, nunca rotaciones: los recortes son
una sola imagen y rotar movería también la silla, que canta muchísimo.

| Estado      | Movimiento                                        |
|-------------|---------------------------------------------------|
| reposo/listo| respiración lenta, 3,6 s                          |
| consultando | tecleo: 2 px arriba y abajo cada 0,38 s           |
| te pregunta | dos botes seguidos y pausa larga, 2,6 s           |
| pensando    | respiración + nube, burbujas y puntos             |

Todo se desactiva con `prefers-reduced-motion`.

---

## Instalar

**Paso 0.** Los ficheros vienen de Windows con saltos de línea CRLF:

```sh
cd claude-term-mac
perl -pi -e 's/\r\n/\n/' install.sh
```

**Paso 1 — los hooks.**

```sh
sh install.sh
```

Copia `hud/` a `~/.claude/hud/` y añade los hooks a `~/.claude/settings.json`
(guardando antes una copia `.pre-hud.bak`). Necesita `python3`; si no lo
tienes, `xcode-select --install`.

**Paso 2 — la app.**

```sh
cd app
npm install
npm start
```

El `npm install` lanza `electron-rebuild` para recompilar `node-pty` contra la
versión de Electron. Es el paso que más suele fallar: si se queja, casi siempre
es que faltan las Command Line Tools de Xcode.

Para empaquetarla como `.app` de verdad: `npm run dist`.

---

## Cómo está enganchado

`~/.claude/settings.json` llama a `~/.claude/hud/on-event.sh` en cada evento:

| Evento de Claude Code | Estado     |
|-----------------------|------------|
| `SessionStart`        | `idle`     |
| `UserPromptSubmit`    | `thinking` |
| `PreToolUse`          | `working`  |
| `PostToolUse`         | `thinking` |
| `Notification`        | `asking`   |
| `Stop`                | `done`     |
| `SessionEnd`          | `idle`     |

El script escribe `~/.claude/hud/state.json` y la app lo vigila con
`fs.watchFile`. Uso `watchFile` (sondeo de `stat`) y no `fs.watch` a propósito:
`hud.py` reemplaza el fichero de forma atómica, lo que cambia el inodo y deja
sordo a `fs.watch`.

`on-event.sh` siempre sale con código 0, así que si la app no está abierta o
algo falla, Claude ni se entera.

Ver los hooks instalados: `/hooks` dentro de Claude Code.

---

## Ajustar la composición

Todo está en el bloque `AJUSTES` de `app/renderer/style.css`, en porcentajes
sobre la ventana. Lo cómodo es abrir la vista previa enlazada arriba, mover los
deslizadores hasta que encaje, darle a **Copiar** y pegar el resultado.

```css
--term-left: 34%;   --term-top: 27%;    /* el rectángulo del terminal */
--table-y:   71%;                       /* escena pizarra */
--horizon-y: 20%;                       /* escena pensando */
```

Los recortes de Kirby se hacen sin generar ficheros, con `background-size` y
`background-position`. Para mostrar una región de ancho `w` y alto `h`
(fracciones del original, empezando en `x0,y0`):

```
background-size:      (100/w)%   (100/h)%
background-position:  x0/(1-w)   y0/(1-h)     en %
aspect-ratio:         (w · ancho_original) / (h · alto_original)
```

Está explicado con esas cuentas en el CSS, junto a cada recorte.

---

## Pestañas

La tira de arriba de la pizarra funciona **como la de Chrome**: la pestaña
activa se funde con el terminal (esas dos esquinas cóncavas son dos
`radial-gradient` de 10 px, una a cada lado), las apagadas van planas con su
rayita separadora — que se esconde al pasar el ratón y a los lados de la
activa —, el `+` va pegado a la última y el hueco sobrante arrastra la ventana.
Al fondo de la tira, el enlace a GitHub y el conmutador de día y noche.

Cada pestaña es **un terminal y un PTY de verdad**, no una vista partida:

- La pestaña nueva **hereda la carpeta** de aquella desde la que la abriste. El
  proceso principal se la pregunta a `lsof -d cwd` sobre el PID del shell; si
  no contesta en 1,5 s se abre en casa y ya está, es un adorno.
- El nombre lo pone el shell por la secuencia de título; si no dice nada,
  «terminal N».
- Solo se mide y se redimensiona **la pestaña visible**: las ocultas están en
  `visibility: hidden`, así conservan su tamaño y no hay que repintarlas al
  volver.
- `exit` cierra su pestaña; cerrar la última cierra la ventana.
- El addon de WebGL se pide por pestaña, pero Chromium solo mantiene un puñado
  de contextos: cuando tira uno, ese terminal suelta el addon y sigue pintando
  por el camino normal (`onContextLoss`).

**Hace falta menú propio.** El de serie de Electron se queda con `Cmd W`
(cerraría la ventana entera en vez de la pestaña) y con `Cmd +/-` (haría zoom
de la página en vez de cambiar el cuerpo de letra). Los aceleradores de menú
ganan siempre a la ventana, así que `main.js` monta su propio menú y le manda
esas órdenes al renderer por IPC.

---

## Atajos

| Tecla                        | Qué hace                                               |
|------------------------------|--------------------------------------------------------|
| `Cmd T`                      | pestaña nueva, en la carpeta de la actual               |
| `Cmd W`                      | cerrar la pestaña (la última cierra la ventana)         |
| `Cmd 1`…`Cmd 8` · `Cmd 9`    | ir a esa pestaña · ir a la última                       |
| `Cmd Shift [` / `]` · `Ctrl Tab` | pestaña anterior / siguiente                       |
| `Cmd Shift W`                | cerrar la ventana                                       |
| `Cmd +` / `Cmd -`            | cuerpo de letra (el PTY se reajusta solo)               |
| `Cmd Shift N`                | modo día / noche (también el sol/luna de la tira)       |
| `Cmd Shift E`                | intro automático                                        |
| `Cmd Shift P`                | rota los estados para verlos sin arrancar Claude        |

---

## Qué está probado y qué no

Esto se montó desde Windows, pero **se probó de verdad en el VPS**
(Debian 13, Python 3.13.5, Node 20.19.2).

**Probado y funcionando:**

- Sintaxis de todo: `hud.py`, los tres `.sh`, y `main.js` / `preload.js` /
  `renderer.js` con `node --check`.
- Los hooks con eventos reales por stdin: `Read` → `Leyendo index.js`,
  `Bash` → `$ systemctl status nginx --no-pager`, y `Stop` leyendo un
  transcript `.jsonl` de mentira y sacando el título y el cuerpo limpios.
- `install-hooks` sobre un `settings.json` que ya tenía cosas: conserva el
  resto, no duplica en la segunda pasada, y guarda la copia `.pre-hud.bak`.
- El servidor: `/`, `/state`, ficheros estáticos, cabecera `no-store`.
- **La ventana entera, renderizada en un Chromium headless**, cargando el
  `index.html` real con un `window.kirby` de mentira. Cero errores de JS. El
  terminal queda en **94 columnas × 37 filas** a 1320×860. Las capturas de los
  cinco estados están en `preview/`.

**Dos bugs que solo aparecieron al ejecutarlo:**

- `on-event.sh` escupía `cannot create /dev/tty` por stderr. Comprobar
  `[ -w /dev/tty ]` no vale: el fichero existe y tiene permisos aunque el
  proceso no tenga terminal de control. Hay que abrirlo dentro de un subshell
  con su propio stderr tapado.
- `install-hooks` machacaba la copia de seguridad en la segunda pasada, así que
  perdías el `settings.json` original. Ahora solo la escribe si no existe.

**Y un tercero que solo se vio al mirar el render:** el recorte de Kirby con el
puntero llegaba hasta el 52 % del original, y el marco negro de la pizarra
*del dibujo* empieza en el 50,5 % — se colaba una raya negra al lado del
puntero. Cortado en el 50 % exacto.

**Lo que NO está probado**, porque no se puede fuera de un Mac: el proceso
principal de Electron, `node-pty` de verdad, y `electron-rebuild`. Ese es el
paso que más suele fallar; si se queja, casi siempre faltan las Command Line
Tools de Xcode. Puedes reintentarlo solo con `npm run rebuild`.

**La resolución ya está resuelta** (ver *Los dibujos*, arriba). Aun así, si
tienes los **GIF originales**, déjalos en `app/renderer/assets/` como
`terminal.gif` y `thinking.gif` y cambia las dos `url()` del CSS: los recortes
son `background-image`, y un GIF animado funciona igual — tendrías la animación
original del autor en vez de la mía.

---

## Ficheros

```
claude-term-mac/
├── install.sh              hooks (+ WezTerm con --wezterm)
├── README.md
├── app/                    ← la app
│   ├── package.json
│   ├── main.js             ventana, menú, un PTY por pestaña, vigilante del estado
│   ├── preload.js          puente contextIsolation
│   └── renderer/
│       ├── index.html      la escena + la tira de pestañas
│       ├── style.css       ← el bloque AJUSTES está aquí
│       ├── renderer.js     xterm dentro de la pizarra, una instancia por pestaña
│       └── assets/         thinking.jpg · terminal.jpg
├── hud/                    los hooks (y el HUD viejo en ventana aparte)
│   ├── hud.py              modo hook + instalador de hooks + servidor
│   ├── on-event.sh         puente hooks → state.json
│   ├── start.sh            solo para el HUD viejo; con la app no hace falta
│   └── index.html · style.css · app.js · assets/
├── wezterm.lua             opcional: tema de WezTerm con acento por estado
└── preview/
    ├── kirby-hud-tuner.html      la vista previa publicada
    ├── tuner.html                su plantilla (sin las imágenes incrustadas)
    └── idle · thinking · working · asking · done .png
                                  capturas reales del render en Chromium
```

`hud/` sigue haciendo falta aunque uses la app: ahí vive el puente de los
hooks. Lo que ya no necesitas es `start.sh` ni el servidor HTTP.
