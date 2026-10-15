import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { order, verdict } from '../hooks/classify'

describe("the classifier's answer", () => {
  test("its top label and that label's score; anything else is no answer", () => {
    expect(verdict('{"top_label":"feature","scores":{"feature":0.9957,"tests":0.002}}')).toEqual({ label: 'feature', score: 0.9957 })
    expect(verdict('{"detail":"Insufficient credits"}')).toBeUndefined()
    expect(verdict('not json')).toBeUndefined()
  })
})

const FEATURE = 'Add a new parameter type `click.Duration` to this repository (click), parsing 90s, 5m and 1h30m.'

function host(on: On, answer: string | undefined, tools: string[] = ['mcp__delegate__hand_off']) {
  const entered: Array<readonly string[] | undefined> = []
  const sent: string[] = []
  mock.clock(on, { now: 0 })
  on('env.get', () => ({ value: 'test-key' }) as never)
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: true })) }) as never)
  on('http.fetch', (_$, e) => {
    sent.push(String((e.init as { body?: string } | undefined)?.body ?? ''))
    return { value: answer === undefined ? { status: 402, ok: false, headers: {}, text: '' } : { status: 200, ok: true, headers: {}, text: answer } }
  })
  on('prompt.submit', (_$, e) => {
    entered.push(e.context)
    return { text: e.text, context: e.context }
  })
  return { entered, sent }
}

const ON = { options: { enabled: true } }

test('feature work gets the hand-off order', ON, async ($, on) => {
  const h = host(on, '{"top_label":"feature","scores":{"feature":0.99}}')
  await $.prompt.submit({ text: FEATURE, origin: { kind: 'sdk' } } as never)
  expect(h.entered[0]).toEqual([order('feature')])
  expect(JSON.parse(h.sent[0] as string).text).toBe(FEATURE)
})

for (const [name, answer, tools, kind] of [
  ['other work', '{"top_label":"lookup","scores":{"lookup":0.98}}', undefined, 'composer'],
  ['a weak score', '{"top_label":"feature","scores":{"feature":0.55}}', undefined, 'composer'],
  ['a failed call', undefined, undefined, 'composer'],
  ['no delegate', '{"top_label":"tests","scores":{"tests":0.99}}', [], 'composer'],
  ['a notification', '{"top_label":"tests","scores":{"tests":0.99}}', undefined, 'task-notification'],
] as const) {
  test(`${name}: no order`, ON, async ($, on) => {
    const h = host(on, answer, tools as string[] | undefined)
    await $.prompt.submit({ text: FEATURE, origin: { kind } } as never)
    expect(h.entered[0]).toBeUndefined()
  })
}

test('off by default: route sends nothing anywhere', {}, async ($, on) => {
  const h = host(on, '{"top_label":"feature","scores":{"feature":0.99}}')
  await $.prompt.submit({ text: FEATURE, origin: { kind: 'composer' } } as never)
  expect(h.sent).toEqual([])
  expect(h.entered[0]).toBeUndefined()
})
