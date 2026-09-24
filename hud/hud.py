#!/usr/bin/env python3
"""
Claude HUD — el cerebro de la ventana de Kirby.

Dos modos:

    hud.py serve [--port 7373]     sirve la ventana en 127.0.0.1
    hud.py hook  <estado>          lo llaman los hooks de Claude Code;
                                   lee el JSON del evento por stdin
    hud.py install-hooks           mete los hooks en ~/.claude/settings.json
    hud.py print-hooks             escupe el JSON por si prefieres pegarlo a mano

Estados: idle | thinking | working | asking | done
"""

import argparse
import fcntl
import json
import os
import re
import sys
import time
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "state.json")
# Lo que cada pestana tiene entre manos: su lista de tareas y sus subagentes.
# Va aparte de state.json (que solo guarda el ultimo aviso de cualquiera) porque
# aqui hace falta recordar varias pestanas a la vez.
TASKS_FILE = os.path.join(HERE, "tasks.json")

DEFAULT = {
    "rev": 0,
    "state": "idle",
    "line": "esperando",
    "title": "POYO",
    "body": "",
    "desk": "",
    "tab": "",
    "since": 0.0,
}

BOARD_MAX = 420          # caracteres que caben comodos en la pizarra
TITLE_MAX = 34


# ---------------------------------------------------------------------------
# Estado en disco
# ---------------------------------------------------------------------------

def read_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            s = json.load(f)
        return {**DEFAULT, **s}
    except (OSError, ValueError):
        return dict(DEFAULT)


def write_state(patch):
    """Mezcla el parche sobre lo que hubiera. Escritura atomica."""
    s = read_state()
    s.update(patch)
    s["rev"] = s.get("rev", 0) + 1
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(s, f, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)
    return s


# ---------------------------------------------------------------------------
# Tareas y subagentes por pestana
#
#   tasks.json = { "<KIRBY_TAB>": { "todos": [...], "agents": [...], "at": t } }
#
# todos:  lo que Claude apunta con TodoWrite  -> {text, status}
# agents: lo que lanza con Task/Agent          -> {id, kind, text, doing, status}
#
# Varios hooks pueden saltar a la vez (agentes en paralelo), asi que leer,
# cambiar y escribir va bajo un candado; si no, unos pisarian a otros.
# ---------------------------------------------------------------------------

AGENTS_MAX = 12          # los que se recuerdan por pestana (los terminados mas viejos se van)
TASK_TOOLS = ("Task", "Agent")


def update_tasks(tab, fn):
    """Aplica fn(entrada_de_la_pestana) y guarda. Sin pestana no hay nada que guardar."""
    if not tab:
        return
    lock = open(TASKS_FILE + ".lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            with open(TASKS_FILE, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        entry = data.get(tab) or {"todos": [], "agents": []}
        fn(entry)
        entry["at"] = time.time()
        if entry.get("todos") or entry.get("agents"):
            data[tab] = entry
        else:
            data.pop(tab, None)          # pestana sin nada: no dejar rastro
        tmp = TASKS_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, TASKS_FILE)
    finally:
        lock.close()


def track(tab, event, ev):
    """Pone al dia la lista de tareas y los subagentes de esta pestana."""
    tool = ev.get("tool_name", "")
    ti = ev.get("tool_input") or {}
    agent_id = ev.get("agent_id") or ""       # solo viene si el hook salta DENTRO de un subagente

    if event == "SessionEnd":
        update_tasks(tab, lambda e: e.update(todos=[], agents=[]))
        return

    if event == "SessionStart":
        # Sesion nueva en esta pestana (tambien tras /clear): la de antes ya no cuenta.
        update_tasks(tab, lambda e: e.update(todos=[], agents=[]))
        return

    if event == "Stop":
        # Termino el turno. Un subagente que siga "en marcha" sin que nadie lo
        # haya cerrado se habra perdido el aviso: no lo dejamos girando para siempre.
        def cerrar(e):
            for a in e["agents"]:
                if a.get("status") == "running":
                    a["status"] = "done"
        update_tasks(tab, cerrar)
        return

    if tool == "TodoWrite" and event == "PreToolUse":
        todos = []
        for t in ti.get("todos") or []:
            if not isinstance(t, dict):
                continue
            status = t.get("status", "pending")
            # en curso se muestra con la forma «gerundio»; el resto, con la de accion
            text = t.get("activeForm") if status == "in_progress" and t.get("activeForm") else t.get("content", "")
            todos.append({"text": shorten(text, 90), "status": status})
        update_tasks(tab, lambda e: e.update(todos=todos))
        return

    if tool in TASK_TOOLS:
        uid = ev.get("tool_use_id") or ""
        if event == "PreToolUse":
            def lanzar(e):
                e["agents"].append({
                    "id": uid,
                    "kind": shorten(ti.get("subagent_type", "") or "agente", 24),
                    "text": shorten(ti.get("description") or ti.get("prompt") or "", 90),
                    "doing": "",
                    "status": "running",
                })
                e["agents"] = e["agents"][-AGENTS_MAX:]
            update_tasks(tab, lanzar)
        elif event == "PostToolUse":
            def cerrar_uno(e):
                for a in e["agents"]:
                    if a.get("id") == uid or (not uid and a.get("status") == "running"):
                        a["status"] = "done"
                        a["doing"] = ""
                        break
            update_tasks(tab, cerrar_uno)
        return

    # Cualquier otra herramienta usada DENTRO de un subagente: es lo que esta
    # haciendo ahora. Al primer aviso con agent_id nuevo lo casamos con el
    # subagente lanzado mas antiguo que aun no tenga dueno.
    if agent_id and event == "PreToolUse":
        frase = describe_tool(tool, ti)

        def haciendo(e):
            mio = next((a for a in e["agents"] if a.get("agent_id") == agent_id), None)
            if mio is None:
                mio = next((a for a in e["agents"]
                            if a.get("status") == "running" and not a.get("agent_id")), None)
                if mio is None:
                    return
                mio["agent_id"] = agent_id
            mio["doing"] = frase
        update_tasks(tab, haciendo)


# ---------------------------------------------------------------------------
# Texto
# ---------------------------------------------------------------------------

def shorten(text, n):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def describe_tool(tool, ti):
    """Frase corta y en cristiano de lo que esta haciendo ahora mismo."""
    ti = ti or {}
    name = lambda k: os.path.basename(str(ti.get(k, ""))) or str(ti.get(k, ""))

    if tool == "Read":
        return f"Leyendo {name('file_path')}"
    if tool in ("Edit", "NotebookEdit"):
        return f"Editando {name('file_path')}"
    if tool == "Write":
        return f"Escribiendo {name('file_path')}"
    if tool in ("Bash", "PowerShell"):
        return "$ " + shorten(ti.get("command", ""), 64)
    if tool == "Grep":
        return f"Buscando «{shorten(ti.get('pattern', ''), 32)}»"
    if tool == "Glob":
        return f"Buscando ficheros {shorten(ti.get('pattern', ''), 32)}"
    if tool in ("WebFetch", "WebSearch"):
        return "Consultando la web"
    if tool in ("Task", "Agent"):
        return "Ha lanzado un agente"
    if tool == "TodoWrite":
        return "Actualizando el plan"
    if tool == "Skill":
        return f"Cargando la skill {ti.get('skill', '')}"
    return f"Usando {tool}" if tool else "Trabajando"


def clean_md(text):
    """Markdown -> texto plano legible en una pizarra."""
    text = re.sub(r"```[\s\S]*?```", "[bloque de codigo]", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.M)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", text)
    text = re.sub(r"^\s*[-*+]\s+", "• ", text, flags=re.M)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def split_title_body(text, fallback="Listo"):
    """La primera linea hace de titulo si es corta; el resto, de cuerpo."""
    lines = [l for l in text.split("\n")]
    first = next((l.strip() for l in lines if l.strip()), "")
    if first and len(first) <= TITLE_MAX:
        rest = text.split(first, 1)[-1].strip()
        return first, rest[:BOARD_MAX]
    return fallback, text[:BOARD_MAX]


def last_assistant_text(path, max_chars=1600):
    """Ultimo mensaje de texto de Claude en el transcript .jsonl."""
    if not path or not os.path.exists(path):
        return ""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            lines = f.readlines()[-500:]
    except OSError:
        return ""

    for raw in reversed(lines):
        try:
            rec = json.loads(raw)
        except ValueError:
            continue
        if rec.get("type") != "assistant":
            continue
        content = (rec.get("message") or {}).get("content") or []
        parts = [
            c.get("text", "")
            for c in content
            if isinstance(c, dict) and c.get("type") == "text"
        ]
        txt = "\n".join(p for p in parts if p.strip()).strip()
        if txt:
            return txt[:max_chars]
    return ""


# ---------------------------------------------------------------------------
# Modo hook
# ---------------------------------------------------------------------------

def run_hook(state):
    try:
        raw = sys.stdin.read()
        ev = json.loads(raw) if raw.strip() else {}
    except (ValueError, OSError):
        ev = {}

    patch = {"state": state, "since": time.time()}

    # Sello de la pestana de Kirby Terminal donde corre este Claude. Lo pone la
    # app en el entorno del shell y se hereda hasta aqui; fuera de la app viene
    # vacio y la ventana se apana con la pestana que este a la vista.
    patch["tab"] = os.environ.get("KIRBY_TAB", "")

    cwd = ev.get("cwd") or ""
    if cwd:
        patch["desk"] = os.path.basename(cwd.rstrip("/\\")) or cwd

    event = ev.get("hook_event_name", "")

    try:
        track(patch["tab"], event, ev)
    except Exception:            # las tareas son un adorno: que no estorben al estado
        pass

    if state == "working":
        patch["line"] = describe_tool(ev.get("tool_name", ""), ev.get("tool_input"))

    elif state == "thinking":
        if event == "UserPromptSubmit":
            # Turno nuevo: limpiamos la pizarra para no dejar la respuesta vieja.
            patch.update(line="Leyendo lo que le has pedido", title="POYO", body="")
        else:
            patch["line"] = "Pensando"

    elif state == "asking":
        msg = clean_md(ev.get("message", "") or "Necesita que le respondas")
        title, body = split_title_body(msg, fallback="Te pregunta")
        patch.update(line=shorten(msg, 90), title=title, body=body)

    elif state == "done":
        txt = clean_md(last_assistant_text(ev.get("transcript_path", "")))
        if txt:
            title, body = split_title_body(txt)
        else:
            title, body = "Listo", ""
        patch.update(line="Listo", title=title, body=body)

    elif state == "idle":
        patch["line"] = "Esperando"

    write_state(patch)


# ---------------------------------------------------------------------------
# Modo servidor
# ---------------------------------------------------------------------------

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?")[0].rstrip("/") == "/state":
            payload = json.dumps(read_state(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, *args):
        pass          # sin ruido en el terminal


def run_serve(port):
    httpd = ThreadingHTTPServer(
        ("127.0.0.1", port), partial(Handler, directory=HERE)
    )
    httpd.daemon_threads = True
    print(f"Claude HUD en http://127.0.0.1:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


# ---------------------------------------------------------------------------
# Hooks de Claude Code
# ---------------------------------------------------------------------------

# Que evento de Claude Code enciende que estado.
EVENT_MAP = [
    ("SessionStart",     "idle",     None),
    ("UserPromptSubmit", "thinking", None),
    ("PreToolUse",       "working",  "*"),
    ("PostToolUse",      "thinking", "*"),
    ("Notification",     "asking",   None),
    ("Stop",             "done",     None),
    ("SessionEnd",       "idle",     None),
]


def hooks_config(runner):
    cfg = {}
    for event, state, matcher in EVENT_MAP:
        entry = {"hooks": [{"type": "command", "command": f'"{runner}" {state}'}]}
        if matcher:
            entry["matcher"] = matcher
        cfg[event] = [entry]
    return {"hooks": cfg}


def default_runner():
    return os.path.join(HERE, "on-event.sh")


def install_hooks(settings_path):
    runner = default_runner()
    wanted = hooks_config(runner)["hooks"]

    try:
        with open(settings_path, encoding="utf-8") as f:
            settings = json.load(f)
    except FileNotFoundError:
        settings = {}
    except ValueError as exc:
        raise SystemExit(f"{settings_path} no es JSON valido ({exc}). No toco nada.")

    # La copia solo se hace la primera vez. Si se rehiciera en cada pasada, la
    # segunda guardaria el fichero ya modificado y perderias el original.
    backup = settings_path + ".pre-hud.bak"
    if os.path.exists(settings_path) and not os.path.exists(backup):
        with open(backup, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=2, ensure_ascii=False)
        print(f"copia de seguridad -> {backup}")

    existing = settings.setdefault("hooks", {})
    added = 0
    for event, entries in wanted.items():
        bucket = existing.setdefault(event, [])
        for entry in entries:
            cmds = {
                h.get("command")
                for e in bucket
                for h in (e.get("hooks") or [])
            }
            if entry["hooks"][0]["command"] in cmds:
                continue
            bucket.append(entry)
            added += 1

    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    with open(settings_path, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"{added} hook(s) anadidos en {settings_path}")
    if added == 0:
        print("(ya estaban puestos)")


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="HUD de Kirby para Claude Code")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("serve")
    s.add_argument("--port", type=int, default=7373)

    h = sub.add_parser("hook")
    h.add_argument("state", choices=["idle", "thinking", "working", "asking", "done"])

    i = sub.add_parser("install-hooks")
    i.add_argument(
        "--settings",
        default=os.path.expanduser("~/.claude/settings.json"),
    )

    sub.add_parser("print-hooks")

    args = ap.parse_args()
    if args.cmd == "serve":
        run_serve(args.port)
    elif args.cmd == "hook":
        run_hook(args.state)
    elif args.cmd == "install-hooks":
        install_hooks(args.settings)
    else:
        print(json.dumps(hooks_config(default_runner()), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:                      # un hook nunca debe reventar
        print(f"[hud] {exc}", file=sys.stderr)
        sys.exit(0)
