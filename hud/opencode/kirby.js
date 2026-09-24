/*
 * Kirby Terminal, pero para opencode.
 *
 * La pizarra de Kirby cambia de cara segun lo que este haciendo la IA: pensando,
 * trasteando con una herramienta, preguntando algo o esperando. Eso lo movian
 * los hooks de Claude Code, que llaman a ~/.claude/hud/on-event.sh con el estado
 * y el evento por stdin.
 *
 * opencode no tiene hooks de shell, tiene plugins. Asi que este fichero hace de
 * traductor: se engancha a los eventos de opencode y llama al MISMO puente con
 * los MISMOS estados. Nada del HUD cambia -- ni hud.py, ni state.json, ni la app
 * -- porque para la pizarra da igual quien le hable, solo le importa el estado.
 *
 * Los estados son los cinco de siempre:
 *   thinking  esta dandole vueltas
 *   working   esta usando una herramienta (leer, escribir, ejecutar...)
 *   asking    te esta preguntando algo y espera respuesta
 *   done      ha terminado el turno
 *   idle      ahi anda, sin nada entre manos
 *
 * El JSON que se le pasa por stdin imita el de los hooks de Claude Code, que es
 * lo que hud.py sabe leer: «tool_name» para decir con que esta trasteando,
 * «cwd» para el nombre del escritorio, «hook_event_name» para distinguir el
 * turno nuevo (que limpia la pizarra) de un simple respiro entre herramientas.
 */
import { spawn } from "node:child_process"
import { appendFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const PUENTE = join(homedir(), ".claude", "hud", "on-event.sh")

/*
 * Avisar nunca puede estorbar.
 *
 * Si el HUD no esta instalado, si el script no existe o si peta por lo que sea,
 * aqui no se entera nadie: una pizarra que no se pinta es un fastidio, pero una
 * sesion de opencode que se cae porque el muneco no cambia de cara es mucho
 * peor. Por eso todo va envuelto y los errores se tragan a proposito.
 */
function avisar(estado, evento) {
  try {
    /* Con KIRBY_HUD_LOG puesto, cada aviso queda apuntado ahi. Sirve para ver
       que estados manda opencode cuando la pizarra no hace lo que deberia, sin
       tener que mirar state.json -- que lo comparten todas las IAs a la vez. */
    if (process.env.KIRBY_HUD_LOG) {
      try {
        appendFileSync(process.env.KIRBY_HUD_LOG,
          new Date().toISOString().slice(11, 23) + "  " + estado + "  " +
          JSON.stringify(evento || {}).slice(0, 120) + "\n")
      } catch {}
    }
    const hijo = spawn(PUENTE, [estado], {
      stdio: ["pipe", "ignore", "ignore"],
      // Que no se lleve por delante a opencode al cerrarse.
      detached: false,
    })
    hijo.on("error", () => {})
    hijo.stdin.on("error", () => {})
    hijo.stdin.end(JSON.stringify(evento || {}))
  } catch {
    /* sin ruido */
  }
}

export const KirbyHud = async ({ directory }) => {
  const base = { cwd: directory || process.cwd() }

  return {
    // Turno nuevo: el usuario acaba de mandar algo. Se marca como en Claude
    // Code para que hud.py limpie la respuesta anterior de la pizarra.
    "chat.message": async () => {
      avisar("thinking", { ...base, hook_event_name: "UserPromptSubmit" })
    },

    // Va a usar una herramienta. hud.py traduce el nombre a algo legible
    // («Leyendo un fichero», «Ejecutando un comando»...), asi que se le pasan
    // el nombre y los argumentos tal cual.
    "tool.execute.before": async (input, output) => {
      avisar("working", { ...base, tool_name: input?.tool || "", tool_input: output?.args })
    },

    // Ha terminado con la herramienta y vuelve a pensar.
    "tool.execute.after": async () => {
      avisar("thinking", base)
    },

    // Pide permiso para algo: la pizarra lo dice y se queda esperando.
    "permission.ask": async (input) => {
      const texto =
        input?.title || input?.description || input?.pattern ||
        (input?.type ? "Permiso para " + input.type : "") ||
        "Necesita que le respondas"
      avisar("asking", { ...base, message: String(texto) })
    },

    // Y lo que no es un hook con nombre propio llega por aqui.
    event: async ({ event }) => {
      const tipo = event?.type
      if (tipo === "session.idle" || tipo === "session.error") {
        avisar("done", base)
      } else if (tipo === "session.created") {
        avisar("idle", base)
      } else if (tipo === "permission.updated") {
        /* El hook «permission.ask» solo salta cuando de verdad te para a
           preguntar; en «opencode run» se rechaza solo y no llega a llamarse.
           Este evento si se emite siempre que se pide un permiso, asi que la
           pizarra se entera igual en la interfaz interactiva. */
        const p = event?.properties || {}
        const texto = p.title || p.description || p.pattern ||
          (p.type ? "Permiso para " + p.type : "") || "Necesita que le respondas"
        avisar("asking", { ...base, message: String(texto) })
      } else if (tipo === "permission.replied") {
        avisar("thinking", base)
      }
    },

    // Al cerrar opencode, la pizarra se queda tranquila en vez de con la ultima
    // cara que le tocara.
    dispose: async () => {
      avisar("idle", base)
    },
  }
}

export default KirbyHud
