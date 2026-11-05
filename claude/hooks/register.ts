import type { EngineInterface, Register } from 'claude-code'

const GET = 'mcp__ccd_session_mgmt__get_session'
const RENAME = 'mcp__ccd_session_mgmt__set_session_title'

const WORKING = '⚙️'
const PERMISSION = '🔐'
const QUESTION = '❓'
const NO_LIGHT = '⚪'
const FAILED = '⚠️'
const TICKER = /🟢|🟡|🔴|⏰/gu
const PREFIX = /^(?:(?:⚙️|🔐|❓|⚪|⚠️|🟢|🟡|🔴|⏰)\s*)+/u
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])
// The desktop app's own tools that hold a question for the person: a start_session offer waits for its answer,
// and a wrap_up marked blocked ends the turn waiting on one.
const OFFER = 'mcp__ccd_session__start_session'
const WRAP_UP = 'mcp__ccd_turn__wrap_up'
// A call that puts a question to the person, by its name and arguments.
const asksQuestion = (tool: string, args: unknown) =>
  ASKS_PERSON.has(tool) || (tool === OFFER && (args as { initiation?: unknown } | undefined)?.initiation === 'offer')

let want: string | undefined
let shown: string | undefined
let busy = false
// The main loop's wrap_up said the turn ends waiting on the person's answer.
let blocked = false
// Calls held at a permission check, so 🔐 clears only once every one of them has run.
const waiting = new Set<string>()

const show = ($: EngineInterface, light: string) => {
  want = light
  $.clock.after(0, () => void flush($).catch(() => undefined))
}

const flush = async ($: EngineInterface) => {
  if (busy) return
  busy = true
  try {
    while (want !== shown) {
      const light = want as string
      const got = await $.tool.call({ tool: GET, session_id: 'self' } as never)
      const title = String(JSON.parse(String(got.text)).title ?? '')
      const base = title.replace(PREFIX, '')
      if (!base) return
      if (title !== `${light} ${base}`) {
        await $.tool.call({ tool: RENAME, session_id: 'self', title: `${light} ${base}` } as never)
      }
      shown = light
    }
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  on('turn.start', ($, e, next) => {
    if (!e.agentId) {
      blocked = false
      show($, WORKING)
    }
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const ours = next.origin.plugin === $.plugin.name
    if (ours && (e.tool === GET || e.tool === RENAME)) return { decision: 'allow' }
    const verdict = await next(e)
    // An ask is not yet a person's: a mode or a classifier (auto mode's, the browser's site check) may settle it.
    if (!ours && verdict.decision === 'ask' && e.tool_use_id) waiting.add(e.tool_use_id)
    return verdict
  })

  // Raised only once an ask goes to a person, from the main loop or a helper, in every mode. tool.check runs inside
  // tool.call's next() before any classifier or person is asked, so every id it raises for is already in waiting.
  on('classic.PermissionRequest', ($, e, next) => {
    if (!asksQuestion(e.tool_name, e.tool_input)) show($, PERMISSION)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (next.origin.plugin === $.plugin.name) return next(e)
    const args = e as unknown as Record<string, unknown>
    if (e.tool === WRAP_UP && !e.agentId) blocked = args.blocked === true
    if (asksQuestion(e.tool, args)) {
      waiting.add(e.tool_use_id)
      show($, QUESTION)
    }
    try {
      return await next(e)
    } finally {
      waiting.delete(e.tool_use_id)
      if (waiting.size === 0 && (want === PERMISSION || want === QUESTION)) show($, WORKING)
    }
  })

  // The turn's end. classic.Stop never reaches a module in Claude Code 2.1.317, so the light is read here.
  on('turn.complete', ($, e, next) => {
    if (!e.agentId) {
      waiting.clear()
      const light = e.answer.match(TICKER)?.at(-1) ?? NO_LIGHT
      if (e.reason === 'error' || e.reason === 'refusal') show($, FAILED)
      else show($, blocked && e.reason === 'answer' ? QUESTION : light)
    }
    return next(e)
  })
}
