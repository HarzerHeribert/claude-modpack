import type { Register } from 'claude-code'

import { HAND_OFF, classify, order } from './classify'
import type { Classifier } from './classify'

/** delegate's tool: without it there is nothing to hand off to, and route stays out of the way. */
const HAND_OFF_TOOL = 'mcp__delegate__hand_off'
/** Shorter than this a prompt is a reply or a command ("yes", "commit this"), not work to classify. */
const MIN_CHARS = 40
/**
 * The score from which a prompt gets the order, by classifier, when the person set none. Measured on 877 real Claude
 * Code prompts (18 Oct, pilot/scaledown/real_prompts.py), against Haiku's labels: at 0.7, 17 of Jev's 35 hand-offs on
 * the author's own prompts were wrong; at 0.95, 4 of 18. On all 877, 12 wrong instead of 46, for 231 right instead of
 * 279. Jev scores route's own feature and test prompts 1.0. ScaleDown is surer less often (one of route's feature
 * prompts at 0.787), so it keeps 0.7.
 */
export const MIN_SCORE: Record<Classifier, number> = { jev: 0.95, scaledown: 0.7 }

export const register: Register = (on, options) => {
  // Off unless the person turned it on: turned on, every prompt's text leaves the machine.
  if (options.enabled !== true) return
  const scaledownKey = typeof options.scaledownKey === 'string' ? options.scaledownKey : ''
  const typesafeKey = typeof options.typesafeKey === 'string' ? options.typesafeKey : ''
  const choice = options.classifier === 'jev' || options.classifier === 'scaledown' ? options.classifier : 'auto'
  // 0 (the default) is the classifier's own threshold; a number above it is the person's.
  const minScore = typeof options.minScore === 'number' && options.minScore > 0 ? options.minScore : undefined
  const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 3000
  const direct = options.direct !== false

  // The person's own prompt (typed, from the phone, or a `claude -p` turn): feature or test work gets the order.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    if (kind !== 'composer' && kind !== 'bridge' && kind !== 'sdk') return next(e)
    const text = e.text.trim()
    if (text.length < MIN_CHARS || text.startsWith('/')) return next(e)
    // auto: Jev when its key is there (the faster of the two, measured), else ScaleDown.
    const jevKey = choice === 'scaledown' ? '' : typesafeKey || ((await $.env.get('TYPESAFE_API_KEY')) ?? '')
    const sdKey = choice === 'jev' ? '' : scaledownKey || ((await $.env.get('SCALEDOWN_API_KEY')) ?? '')
    const [classifier, key]: [Classifier, string] = jevKey !== '' ? ['jev', jevKey] : ['scaledown', sdKey]
    if (key === '') return next(e)
    if (!(await $.tool.list().catch(() => [])).some(t => t.name === HAND_OFF_TOOL)) return next(e)
    const v = await classify($, classifier, key, text, timeoutMs)
    if (v === undefined || !HAND_OFF.has(v.label) || v.score < (minScore ?? MIN_SCORE[classifier])) return next(e)
    return next({ ...e, context: [...(e.context ?? []), order(v.label, direct)] })
  }).catch(($, e, next) => next(e))
}
