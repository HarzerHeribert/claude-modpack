// What kind of work a prompt asks for, from one of two classifiers: ScaleDown's Classify
// (https://docs.scaledown.ai/api-reference/classify) or TypeSafe's Jev (https://docs.typesafe.ai/introduction/quickstart).
// Measured on 25 prompts (the benchmark's eight and 17 everyday ones), one call each, the two alternating, two rounds
// (pilot/scaledown/jev.py, 15 Oct): both 50 of 50 right; Jev 0.25 s median and 0.34 s for the slowest tenth, ScaleDown
// 1.15 s and 2.5 s. These are the labels and rubrics of that measurement, unchanged: a different wording is a different
// classifier, and would need measuring again.
import type { EngineInterface } from 'claude-code'

export const CLASSIFY_URL = 'https://api.scaledown.xyz/classify'
export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
/** Only the start of a prompt leaves the machine: the kind of work is in its first lines, and a pasted log is not. */
export const MAX_CHARS = 8000

export type Classifier = 'scaledown' | 'jev'

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

/** Jev's choice and its probability, from its answer; undefined for anything else. */
export function jevVerdict(body: string): Verdict | undefined {
  try {
    const a = JSON.parse(body)?.answers?.kind
    const label = a?.choice
    const score = a?.probabilities?.[label]
    return typeof label === 'string' && typeof score === 'number' ? { label, score } : undefined
  } catch {
    return undefined
  }
}

/** The request each service takes for one prompt. */
export function request(classifier: Classifier, key: string, text: string): { url: string; headers: Record<string, string>; body: string } {
  const sent = text.slice(0, MAX_CHARS)
  if (classifier === 'jev') {
    const criteria = Object.fromEntries(LABELS.map(l => [l.name, l.rubric]))
    return {
      url: JEV_URL,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ state: sent, model: 'jev-latest', questions: { kind: { type: 'choice', instructions: 'Which kind of request to a coding assistant is this?', criteria } } }),
    }
  }
  return { url: CLASSIFY_URL, headers: { 'content-type': 'application/json', 'x-api-key': key }, body: JSON.stringify({ text: sent, labels: LABELS, reasoning: false }) }
}

/** ScaleDown's top label and its score, from its answer; undefined for anything else (it answers some errors with 200). */
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
export async function classify($: EngineInterface, classifier: Classifier, key: string, text: string, timeoutMs: number): Promise<Verdict | undefined> {
  const { url, headers, body } = request(classifier, key, text)
  const read = classifier === 'jev' ? jevVerdict : verdict
  const call = $.http
    .fetch(url, { method: 'POST', headers, body })
    .then(r => (r.ok ? read(r.text) : undefined))
    .catch(() => undefined)
  const late = $.clock.sleep(timeoutMs).then(() => undefined, () => undefined)
  return Promise.race([call, late])
}

/** Work a hand-off pays for: a feature or tests, 23–35% cheaper handed off; everything else costs more handed off. */
export const HAND_OFF = new Set(['feature', 'tests'])

/**
 * The order beside the prompt. An order a mod gives in the person's name was followed in 8 of 8 runs (delegate's
 * afterPlan uses the same form); advice was followed in none. It names the person's setting, which is what it is.
 */
export function order(label: string, direct = true): string {
  const what = label === 'tests' ? 'test work' : 'feature work'
  // direct: the worker reads the code, so the main model skips its own look around (1.6 requests a hand-off, measured).
  const when = direct ? ' Hand it off before you read the code: the worker reads it, so write the task from the request as given.' : ''
  return `This prompt is ${what}, and the person's setting for ${what} is: implement it through the hand_off tool (kind build).${when} Write the request into the task so it stands alone, with the project's whole test suite as the check. The tool checks the worker's work itself; when its result says Verified and the diff is what was asked, report to the person without running anything again.`
}
