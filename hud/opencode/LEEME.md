# La pizarra de Kirby con opencode

El HUD nació atado a Claude Code, que tiene hooks de shell: se declaran en
`~/.claude/settings.json` y llaman a `hud/on-event.sh <estado>` con el evento
por stdin.

opencode no tiene hooks de shell, tiene **plugins**. `kirby.js` es el traductor:
se engancha a los eventos de opencode y llama **al mismo puente** con **los
mismos cinco estados**, así que ni `hud.py`, ni `state.json`, ni la app se
enteran de quién les habla.

## Instalar

```sh
cp kirby.js ~/.config/opencode/plugin/kirby.js
```

La carpeta es `plugin/`, en singular — la documentación de opencode dice
`plugins/` y **no funciona**; se comprobó a mano el 8 sep 2026 con la 1.18.29.

## Equivalencias

| Claude Code (hook) | opencode (plugin) | estado |
|---|---|---|
| `UserPromptSubmit` | `chat.message` | `thinking` |
| `PreToolUse` | `tool.execute.before` | `working` |
| `PostToolUse` | `tool.execute.after` | `thinking` |
| `Notification` | `permission.ask` y el evento `permission.updated` | `asking` |
| `Stop` | evento `session.idle` | `done` |
| `SessionStart` / `SessionEnd` | evento `session.created` / `dispose` | `idle` |

`permission.ask` solo salta cuando de verdad te para a preguntar; en
`opencode run` los permisos se rechazan solos y ese hook no llega a llamarse.
Por eso se escucha además el evento `permission.updated`, que sí se emite
siempre.

## Comprobar que va

```sh
KIRBY_HUD_LOG=/tmp/kirby.log opencode run "di hola"
cat /tmp/kirby.log
```

Debe salir la escalera de siempre:

```
idle → thinking → working → thinking → done → idle
```

Sin esa variable no escribe ningún registro. Viene bien porque `state.json` lo
comparten todas las IAs a la vez, y mirando solo ahí no se sabe quién escribió
qué.

## Para añadir una tercera IA

Lo único que hay que conseguir es que llame a `~/.claude/hud/on-event.sh` con
uno de los cinco estados. Si la herramienta tiene hooks de shell, se declara y
listo; si tiene plugins, este fichero sirve de plantilla. La app no está atada a
ninguna: abre `$SHELL -l` con `KIRBY_TAB` en el entorno y lee `state.json`.
