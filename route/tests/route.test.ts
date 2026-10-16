import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { MAX_CHARS, jevVerdict, order, verdict } from '../hooks/classify'

describe("the classifier's answer", () => {
  test("its top label and that label's score; anything else is no answer", () => {
    expect(verdict('{"top_label":"feature","scores":{"feature":0.9957,"tests":0.002}}')).toEqual({ label: 'feature', score: 0.9957 })
    expect(verdict('{"detail":"Insufficient credits"}')).toBeUndefined()
    expect(verdict('not json')).toBeUndefined()
  })
  test("Jev's choice and its probability; anything else is no answer", () => {
    expect(jevVerdict('{"model":"jev-1.13.0","answers":{"kind":{"type":"choice","choice":"tests","confidence":0.98,"probabilities":{"tests":0.99,"feature":0.01}}}}')).toEqual({ label: 'tests', score: 0.99 })
    expect(jevVerdict('{"error":"unauthorized"}')).toBeUndefined()
  })
})

const FEATURE = 'Add a new parameter type `click.Duration` to this repository (click), parsing 90s, 5m and 1h30m.'

function host(on: On, answer: string | undefined, tools: string[] = ['mcp__delegate__hand_off'], env: Record<string, string> = { SCALEDOWN_API_KEY: 'sd-key' }) {
  const entered: Array<readonly string[] | undefined> = []
  const sent: string[] = []
  const urls: string[] = []
  const auth: string[] = []
  mock.clock(on, { now: 0 })
  on('env.get', (_$, e) => ({ value: env[(e as unknown as { name: string }).name] }) as never)
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: true })) }) as never)
  on('http.fetch', (_$, e) => {
    const init = e.init as { body?: string; headers?: Record<string, string> } | undefined
    sent.push(String(init?.body ?? ''))
    urls.push(e.url)
    auth.push(init?.headers?.authorization ?? init?.headers?.['x-api-key'] ?? '')
    return { value: answer === undefined ? { status: 402, ok: false, headers: {}, text: '' } : { status: 200, ok: true, headers: {}, text: answer } }
  })
  on('prompt.submit', (_$, e) => {
    entered.push(e.context)
    return { text: e.text, context: e.context }
  })
  return { entered, sent, urls, auth }
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

test("with a TypeSafe key, auto asks Jev, with the prompt's start only", ON, async ($, on) => {
  const jev = '{"answers":{"kind":{"type":"choice","choice":"feature","confidence":1,"probabilities":{"feature":0.99}}}}'
  const h = host(on, jev, undefined, { SCALEDOWN_API_KEY: 'sd-key', TYPESAFE_API_KEY: 'ts-key' })
  const long = FEATURE + ' ' + 'log line\n'.repeat(2000)
  await $.prompt.submit({ text: long, origin: { kind: 'composer' } } as never)
  expect(h.urls).toEqual(['https://api.typesafe.ai/v1/systemone'])
  expect(h.auth).toEqual(['Bearer ts-key'])
  const body = JSON.parse(h.sent[0] as string)
  expect(body.state.length).toBe(MAX_CHARS)
  expect(Object.keys(body.questions.kind.criteria)).toContain('tests')
  expect(h.entered[0]).toEqual([order('feature')])
})

test('direct off: the order lets Claude look around first', { options: { enabled: true, direct: false } }, async ($, on) => {
  const h = host(on, '{"top_label":"feature","scores":{"feature":0.99}}')
  await $.prompt.submit({ text: FEATURE, origin: { kind: 'composer' } } as never)
  expect(h.entered[0]).toEqual([order('feature', false)])
  expect(order('feature')).toContain('before you read the code')
  expect(order('feature', false)).not.toContain('before you read the code')
})

test('classifier: scaledown keeps ScaleDown though a TypeSafe key is set', { options: { enabled: true, classifier: 'scaledown' } }, async ($, on) => {
  const h = host(on, '{"top_label":"tests","scores":{"tests":0.95}}', undefined, { SCALEDOWN_API_KEY: 'sd-key', TYPESAFE_API_KEY: 'ts-key' })
  await $.prompt.submit({ text: FEATURE, origin: { kind: 'composer' } } as never)
  expect(h.urls).toEqual(['https://api.scaledown.xyz/classify'])
  expect(h.entered[0]).toEqual([order('tests')])
})

test('off by default: route sends nothing anywhere', {}, async ($, on) => {
  const h = host(on, '{"top_label":"feature","scores":{"feature":0.99}}')
  await $.prompt.submit({ text: FEATURE, origin: { kind: 'composer' } } as never)
  expect(h.sent).toEqual([])
  expect(h.entered[0]).toBeUndefined()
})
