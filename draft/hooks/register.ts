import type { EngineInterface, Register } from 'claude-code'

import { PROSE, gaugeText, limitOf, orderText } from './length'

type Engine = EngineInterface

/** The person's own prompts: typed, from the phone, or a `claude -p` turn. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])
const WRITES = ['Write', 'Edit', 'MultiEdit'] as const

// The last word limit the person set in this session: a later prompt with a limit replaces it.
let limit: number | undefined
let ordering = true
let gauging = true

type Result = { deny?: string; isError?: boolean; context?: string[] }

const relative = (cwd: string, path: string) => (path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path)
const absolute = (cwd: string, path: string) => (path.startsWith('/') ? path : `${cwd}/${path}`)

async function gauge($: Engine, path: string): Promise<string | undefined> {
  if (limit === undefined || !PROSE.test(path)) return undefined
  const cwd = await $.session.cwd()
  const text = await $.fs.read(absolute(cwd, path)).catch(() => undefined)
  return typeof text === 'string' ? gaugeText(relative(cwd, path), text, limit) : undefined
}

export const register: Register = (on, options) => {
  if (options.enabled === false) return
  limit = undefined
  ordering = options.order !== false
  gauging = options.gauge !== false

  // A prompt that sets a word limit: the limit is kept for the gauge, and the setting rides beside it.
  on('prompt.submit', async ($, e, next) => {
    if (!PERSON.has(e.origin?.kind as string) || e.text.trim().startsWith('/')) return next(e)
    const found = limitOf(e.text)
    if (found === undefined) return next(e)
    limit = found
    return ordering ? next({ ...e, context: [...(e.context ?? []), orderText(found)] }) : next(e)
  }).catch(($, e, next) => next(e))

  // A write of a prose file, once a limit is set: its words, and by section when over. The tool's result is unchanged.
  for (const tool of WRITES) {
    on('tool.call', { tool }, async ($, e, next) => {
      const r = (await next(e)) as Result
      const path = (e as unknown as { file_path?: unknown }).file_path
      if (!gauging || r.deny !== undefined || r.isError || typeof path !== 'string') return r as never
      const note = await gauge($, path).catch(() => undefined)
      return (note === undefined ? r : { ...r, context: [...(r.context ?? []), note] }) as never
    }).catch(($, e, next) => next(e))
  }
}
