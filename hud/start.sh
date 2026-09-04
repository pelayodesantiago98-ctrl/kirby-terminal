#!/bin/sh
# Arranca el HUD: levanta el servidor local y abre la ventana.
# Ctrl+C lo para todo.

set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
PORT=${CLAUDE_HUD_PORT:-7373}
URL="http://127.0.0.1:$PORT"

# Si habia un servidor viejo en este puerto, fuera.
pkill -f "hud.py serve --port $PORT" 2>/dev/null || true

python3 "$DIR/hud.py" serve --port "$PORT" &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' INT TERM EXIT

# Le damos un instante a que abra el socket.
sleep 0.5

CHROME="/Applications/Google Chrome.app"
if [ -d "$CHROME" ]; then
  # Perfil aparte para que Chrome respete --app aunque ya lo tengas abierto.
  open -na "$CHROME" --args \
    --app="$URL" \
    --user-data-dir="$DIR/.chrome-profile" \
    --window-size=680,700 \
    --window-position=1200,80 \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=Translate,MediaRouter
else
  echo "No encuentro Chrome, lo abro en el navegador por defecto."
  open "$URL"
fi

echo "HUD en $URL  ·  Ctrl+C para parar"
wait "$SRV"
