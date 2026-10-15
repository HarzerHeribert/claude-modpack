import type { Register } from 'claude-code'

import { HAND_OFF, classify, order } from './classify'

/** delegate's tool: without it there is nothing to hand off to, and route stays out of the way. */
const HAND_OFF_TOOL = 'mcp__delegate__hand_off'
/** Shorter than this a prompt is a reply or a command ("yes", "commit this"), not work to classify. */
const MIN_CHARS = 40

export const register: Register = (on, options) => {
  // Off unless the person turned it on: turned on, every prompt's text leaves the machine.
  if (options.enabled !== true) return
  const configured = typeof options.scaledownKey === 'string' ? options.scaledownKey : ''
  const minScore = typeof options.minScore === 'number' ? options.minScore : 0.7
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 3000

  // The person's own prompt (typed, from the phone, or a `claude -p` turn): feature or test work gets the order.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    if (kind !== 'composer' && kind !== 'bridge' && kind !== 'sdk') return next(e)
    const text = e.text.trim()
    if (text.length < MIN_CHARS || text.startsWith('/')) return next(e)
    const key = configured || ((await $.env.get('SCALEDOWN_API_KEY')) ?? '')
    if (key === '') return next(e)
    if (!(await $.tool.list().catch(() => [])).some(t => t.name === HAND_OFF_TOOL)) return next(e)
    const v = await classify($, key, text, timeoutMs)
    if (v === undefined || !HAND_OFF.has(v.label) || v.score < minScore) return next(e)
    return next({ ...e, context: [...(e.context ?? []), order(v.label)] })
  }).catch(($, e, next) => next(e))
}
