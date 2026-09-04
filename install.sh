#!/bin/sh
# Instalador para macOS. Ejecutar desde la carpeta claude-term-mac:
#     sh install.sh

set -eu

SRC=$(cd "$(dirname "$0")" && pwd)
DST="$HOME/.claude/hud"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Falta python3. Instalalo con:  xcode-select --install"
  exit 1
fi

echo "1/4  Copiando el HUD a $DST"
mkdir -p "$DST"
cp -R "$SRC/hud/." "$DST/"

# Los ficheros vienen de Windows: fuera los retornos de carro.
for f in "$DST"/*.sh "$DST"/hud.py; do
  if [ -f "$f" ]; then
    perl -pi -e 's/\r\n/\n/' "$f"
  fi
done
chmod +x "$DST"/*.sh "$DST"/hud.py

echo "2/3  Hooks en ~/.claude/settings.json"
python3 "$DST/hud.py" install-hooks

# WezTerm solo si lo pides: con la app Kirby Terminal no hace falta para nada.
if [ "${1:-}" = "--wezterm" ]; then
  echo "3/3  Config de WezTerm"
  mkdir -p "$HOME/.config/wezterm"
  if [ -f "$HOME/.config/wezterm/wezterm.lua" ]; then
    cp "$HOME/.config/wezterm/wezterm.lua" "$HOME/.config/wezterm/wezterm.lua.pre-hud.bak"
    echo "     copia de seguridad -> wezterm.lua.pre-hud.bak"
  fi
  cp "$SRC/wezterm.lua" "$HOME/.config/wezterm/wezterm.lua"
else
  echo "3/3  WezTerm omitido (pasa --wezterm si lo quieres)"
fi

echo
echo "Hecho. Ahora la app:"
echo
echo "    cd \"$SRC/app\" && npm install && npm start"
echo
