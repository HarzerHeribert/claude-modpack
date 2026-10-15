// What kind of work a prompt asks for, from ScaleDown's classifier (https://docs.scaledown.ai/api-reference/classify).
// Measured on 25 prompts (the benchmark's eight and 17 everyday ones), one call each, reasoning off: 25 of 25 right,
// median 0.42 s. These are the labels and rubrics of that measurement, unchanged: a different wording is a different
// classifier, and would need measuring again.
import type { EngineInterface } from 'claude-code'

export const CLASSIFY_URL = 'https://api.scaledown.xyz/classify'

export const LABELS = [
  { name: 'lookup', rubric: 'Does this request ask to find or list where something is in the code (a definition, callers, usages, a value), without changing anything?' },
  { name: 'explain', rubric: 'Does this request ask why or how something works or fails, expecting an explanation rather than a change?' },
  { name: 'small-edit', rubric: 'Does this request ask for one small, local change to code, config or text, such as a value, a typo or a version?' },
  { name: 'rename', rubric: 'Does this request ask to rename or move a symbol, file or parameter and update every place that uses it?' },
  { name: 'feature', rubric: 'Does this request ask to implement new behaviour or a new capability in the code?' },
  { name: 'tests', rubric: 'Does this request ask to write or add tests, or raise test coverage?' },
  { name: 'other', rubric: 'Is this request about version control, running tools, pull requests, or anything that is not reading or writing code?' },
]

export type Verdict = { label: string; score: number }

/** The classifier's top label and its score, from its answer; undefined for anything else (it answers some errors with 200). */
export function verdict(body: string): Verdict | undefined {
  try {
    const d = JSON.parse(body)
    const label = d?.top_label
    const score = d?.scores?.[label]
    return typeof label === 'string' && typeof score === 'number' ? { label, score } : undefined
  } catch {
    return undefined
  }
}

/** The kind of work a prompt asks for, or undefined when the classifier did not answer in time or at all. */
export async function classify($: EngineInterface, key: string, text: string, timeoutMs: number): Promise<Verdict | undefined> {
  const call = $.http
    .fetch(CLASSIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ text, labels: LABELS, reasoning: false }),
    })
    .then(r => (r.ok ? verdict(r.text) : undefined))
    .catch(() => undefined)
  const late = $.clock.sleep(timeoutMs).then(() => undefined, () => undefined)
  return Promise.race([call, late])
}

/** Work a hand-off pays for: a feature or tests, 27–37% cheaper handed off; everything else costs more handed off. */
export const HAND_OFF = new Set(['feature', 'tests'])

/**
 * The order beside the prompt. An order a mod gives in the person's name was followed in 8 of 8 runs (delegate's
 * afterPlan uses the same form); advice was followed in none. It names the person's setting, which is what it is.
 */
export function order(label: string): string {
  const what = label === 'tests' ? 'test work' : 'feature work'
  return `This prompt is ${what}, and the person's setting for ${what} is: implement it through the hand_off tool (kind build). Write the request into the task so it stands alone, with a check command that proves it (the project's tests), wait for the report, check the evidence, then finish yourself.`
}
