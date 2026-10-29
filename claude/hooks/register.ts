import type { EngineInterface, Register } from 'claude-code'

const GET = 'mcp__ccd_session_mgmt__get_session'
const RENAME = 'mcp__ccd_session_mgmt__set_session_title'

const WORKING = '⚙️'
const PERMISSION = '🔐'
const QUESTION = '❓'
const NO_LIGHT = '⚪'
const FAILED = '⚠️'
const TICKER = /🟢|🟡|🔴/gu
const PREFIX = /^(?:(?:⚙️|🔐|❓|⚪|⚠️|🟢|🟡|🔴)\s*)+/u
const ASKS_PERSON = new Set(['AskUserQuestion', 'ExitPlanMode'])

let want: string | undefined
let shown: string | undefined
let busy = false
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
    if (!e.agentId) show($, WORKING)
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const ours = next.origin.plugin === $.plugin.name
    if (ours && (e.tool === GET || e.tool === RENAME)) return { decision: 'allow' }
    const verdict = await next(e)
    if (!ours && verdict.decision === 'ask' && e.tool_use_id) waiting.add(e.tool_use_id)
    return verdict
  })

  on('classic.PermissionRequest', ($, e, next) => {
    if (!ASKS_PERSON.has(e.tool_name)) show($, PERMISSION)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (next.origin.plugin === $.plugin.name) return next(e)
    if (ASKS_PERSON.has(e.tool)) {
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

  on('classic.Stop', ($, e, next) => {
    if (!e.agent_id) {
      const running = (e.background_tasks?.length ?? 0) > 0
      show($, running ? WORKING : e.last_assistant_message?.match(TICKER)?.at(-1) ?? NO_LIGHT)
    }
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (!e.agentId) {
      waiting.clear()
      if (e.reason === 'error' || e.reason === 'refusal') show($, FAILED)
      if (e.reason === 'aborted') show($, e.answer.match(TICKER)?.at(-1) ?? NO_LIGHT)
    }
    return next(e)
  })
}
