-- ~/.config/wezterm/wezterm.lua
--
-- La mitad "terminal" del montaje. Los muñecos viven en la ventana del HUD;
-- aqui solo dejamos el terminal bonito y tenimos cursor/bordes segun el
-- estado de Claude, que llega desde ~/.claude/hud/on-event.sh.

local wezterm = require 'wezterm'
local config = wezterm.config_builder()

----------------------------------------------------------------------
-- Paleta: los mismos azules de los dibujos de Kirby
----------------------------------------------------------------------

local BG = '#0d1220'

local ACCENT = {
  idle     = '#6e7681', -- gris   · esperando
  thinking = '#a371f7', -- morado · pensando
  working  = '#3d74db', -- azul   · consultando
  asking   = '#e0a11b', -- ambar  · te pregunta
  done     = '#35b45c', -- verde  · listo
}

----------------------------------------------------------------------
-- Aspecto
----------------------------------------------------------------------

config.font = wezterm.font_with_fallback {
  { family = 'JetBrainsMono Nerd Font', weight = 'Medium' },
  'Symbols Nerd Font Mono',
  'Apple Color Emoji',
}
config.font_size   = 14.0
config.line_height = 1.15

config.color_scheme = 'Catppuccin Mocha'
config.colors = {
  background    = BG,
  cursor_bg     = ACCENT.idle,
  cursor_border = ACCENT.idle,
}

config.window_background_opacity    = 0.94
config.macos_window_background_blur = 28
config.window_decorations = 'RESIZE'   -- o 'INTEGRATED_BUTTONS|RESIZE' si quieres los botones
config.window_padding = { left = 22, right = 22, top = 18, bottom = 14 }

config.hide_tab_bar_if_only_one_tab = true
config.use_fancy_tab_bar            = false
config.window_close_confirmation    = 'NeverPrompt'
config.scrollback_lines             = 20000
config.audible_bell                 = 'Disabled'
config.cursor_blink_rate            = 0

----------------------------------------------------------------------
-- Estado de Claude
----------------------------------------------------------------------

local function apply_state(window, state)
  local accent = ACCENT[state] or ACCENT.idle
  local o = window:get_config_overrides() or {}
  o.colors = {
    background    = BG,
    cursor_bg     = accent,
    cursor_border = accent,
    split         = accent,
  }
  window:set_config_overrides(o)
end

wezterm.on('user-var-changed', function(window, _pane, name, value)
  if name == 'claude_state' then
    apply_state(window, value)
  end
end)

-- CMD+Shift+P rota los estados para probar sin arrancar Claude.
local DEMO = { 'idle', 'thinking', 'working', 'asking', 'done' }
local i = 0
config.keys = {
  {
    key = 'p', mods = 'CMD|SHIFT',
    action = wezterm.action_callback(function(window)
      i = (i % #DEMO) + 1
      apply_state(window, DEMO[i])
      window:toast_notification('WezTerm', 'estado: ' .. DEMO[i], nil, 1200)
    end),
  },
}

return config
