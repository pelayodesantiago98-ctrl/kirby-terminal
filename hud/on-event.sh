#!/bin/sh
# Puente entre los hooks de Claude Code y el HUD.
# Recibe el JSON del evento por stdin y lo pasa a hud.py.
# Pase lo que pase sale con 0: un hook que falla no debe estorbar a Claude.

STATE=${1:-idle}
DIR=$(cd "$(dirname "$0")" && pwd)

# 1. La ventana del HUD.
python3 "$DIR/hud.py" hook "$STATE" >/dev/null 2>&1

# 2. De paso, avisa a WezTerm para que tina el cursor y los bordes.
#    Si no usas WezTerm esto no hace nada; la secuencia se ignora.
# Ojo: no vale con comprobar [ -w /dev/tty ]. El fichero existe y tiene
# permisos aunque el proceso no tenga terminal de control, y entonces la
# apertura falla y el mensaje se cuela por stderr. Hay que abrirlo dentro de
# un subshell con su propio stderr tapado.
B64=$(printf '%s' "$STATE" | base64 | tr -d '\n')
if [ -n "${TMUX:-}" ]; then
  ( printf '\033Ptmux;\033\033]1337;SetUserVar=claude_state=%s\007\033\\' "$B64" >/dev/tty ) 2>/dev/null
else
  ( printf '\033]1337;SetUserVar=claude_state=%s\007' "$B64" >/dev/tty ) 2>/dev/null
fi

exit 0
