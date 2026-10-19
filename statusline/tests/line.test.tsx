import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { StatuslineSegment, StatuslineWorld } from '../types'
import { SEPARATOR, buildSegments, buildUncalm, condenseHint, fit, modelLabel, plain, resolvePart, rowLead } from '../hooks/line'
import type { Moment } from '../hooks/line'

const NOW = 1_000_000_000

const WORLD: StatuslineWorld = {
  isWorking: false,
  model: 'claude-opus-5-5',
  effort: 'xhigh',
  contextTokens: 412_000,
  window: 1_000_000,
  autoCompactAt: 850_000,
  limits: [
    { kind: 'five_hour', percentUsed: 34, resetsAt: NOW + 134 * 60_000 },
    { kind: 'seven_day', percentUsed: 12, resetsAt: NOW + 3 * 86_400_000 },
  ],
}

const AT: Moment = { now: NOW, isWorking: false, columns: 160, limits: 'always' }

/** smart-compact's segment, as it would hand it over. */
const READY: StatuslineSegment = {
  id: 'smart-compact:ready',
  priority: 0,
  parts: [{ text: '●', tone: 'good' }, { text: ' ready', tone: 'label' }, { until: NOW + 44 * 60_000, prefix: ' · cold in ', tone: 'label', warnMs: 5 * 60_000 }],
  short: [{ text: '●', tone: 'good' }, { text: ' ready', tone: 'label' }],
}

const HINT = {
  component: 'PromptHint' as const,
  props: { isDraft: false, isWorking: false, hint: '⏵⏵ auto mode on (shift+tab to cycle)' },
}

describe('the line', () => {
  test('on the desktop only the segments that are not calm are drawn, and none of the line\'s own', () => {
    const LOUD: StatuslineSegment = { id: 'x:loud', priority: 0, parts: [{ text: 'cold now', tone: 'warn' }] }
    const calm = { ...READY, calm: true }
    expect(buildUncalm([calm], AT)).toEqual([])
    expect(plain(buildUncalm([calm, LOUD], AT))).toBe('cold now')
    // The terminal's line draws everything, calm segments too.
    expect(plain(buildSegments(WORLD, [calm, LOUD], AT), SEPARATOR)).toContain('Opus 5.5 xhigh')
    expect(plain(buildSegments(WORLD, [calm, LOUD], AT), SEPARATOR)).toContain('● ready')
  })

  test('the model and its effort, the context, the plan windows with their resets', () => {
    expect(plain(buildSegments(WORLD, [], AT), SEPARATOR)).toBe('Opus 5.5 xhigh   412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d')
  })

  test('the plan windows show from the first reading, quiet under half, warning from 80%', () => {
    const tone = (pct: number) => buildSegments({ ...WORLD, limits: [{ kind: 'five_hour', percentUsed: pct }] }, [], AT).find(s => s.id === 'limit-five_hour')?.parts[1]?.tone
    expect([tone(3), tone(55), tone(85), tone(97)]).toEqual(['label', 'text', 'warn', 'alert'])
  })

  test('limits: half shows a window once it is half used; off never', () => {
    expect(plain(buildSegments(WORLD, [], { ...AT, limits: 'half' }))).not.toContain('5h')
    const high = { ...WORLD, limits: [{ kind: 'five_hour', percentUsed: 61 }] }
    expect(plain(buildSegments(high, [], { ...AT, limits: 'half' }))).toContain('5h 61%')
    expect(plain(buildSegments(high, [], { ...AT, limits: 'off' }))).not.toContain('5h')
  })

  test("another mod's segment sits at the right edge, its countdown counted", () => {
    expect(plain(buildSegments(WORLD, [READY], AT), SEPARATOR)).toBe('Opus 5.5 xhigh   412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d   ● ready · cold in 44m')
    const late = buildSegments(WORLD, [READY], { ...AT, now: NOW + 40 * 60_000 }).at(-1)
    expect(late?.parts.at(-1)).toEqual({ text: ' · cold in 4:00', tone: 'warn' })
  })

  test('a spinner turns, a blink blinks only in its window', () => {
    expect(resolvePart({ spin: true, tone: 'accent' }, 0).text).toBe('◐')
    expect(resolvePart({ spin: true, tone: 'accent' }, 125).text).toBe('◓')
    const blink = { text: '●', tone: 'good' as const, blink: { from: NOW, to: NOW + 20_000 } }
    expect(resolvePart(blink, NOW).tone).toBe('faint')
    expect(resolvePart(blink, NOW + 500).tone).toBe('good')
    expect(resolvePart(blink, NOW + 30_000).tone).toBe('good')
  })

  test('narrow terminals lose the model, the resets, the windows, the gauge, and the most important last', () => {
    const all = buildSegments(WORLD, [READY], AT)
    const at = (room: number) => plain(fit(all, room), SEPARATOR)
    expect(at(86)).toBe('Opus 5.5 xhigh   412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d   ● ready · cold in 44m')
    expect(at(85)).toBe('412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d   ● ready · cold in 44m')
    expect(at(65)).toBe('412k ━━━━━━──────   5h 34% ↺2h14   7d 12%   ● ready · cold in 44m')
    expect(at(60)).toBe('412k ━━━━━━──────   5h 34% ↺2h14   ● ready · cold in 44m')
    expect(at(50)).toBe('412k ━━━━━━──────   5h 34%   ● ready · cold in 44m')
    expect(at(45)).toBe('412k ━━━━━━──────   ● ready · cold in 44m')
    expect(at(28)).toBe('412k   ● ready · cold in 44m')
    expect(at(10)).toBe('● ready')
  })

  test('the model reads from an id, a /model name or an alias', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('Opus 5.5 (1M context)')).toBe('Opus 5.5')
    expect(modelLabel('opus[1m]')).toBe('Opus')
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelLabel('claude-opus-4-20250514')).toBe('Opus 4')
  })

  test("the engine's hint keeps the mode, not its key help", () => {
    expect(condenseHint('⏵⏵ auto mode on (shift+tab to cycle)')).toBe('⏵⏵ auto')
    expect(condenseHint('? for shortcuts')).toBe('')
    expect(condenseHint('esc to interrupt · ← for agents')).toBe('')
    expect(condenseHint('ctrl+c again to exit')).toBe('ctrl+c again to exit')
    expect(condenseHint('⧉2 · ctrl+c again to exit', { dropArtifacts: true })).toBe('ctrl+c again to exit')
  })

  test('the row before the line: indent, mode label and its dot', () => {
    expect(rowLead('auto')).toBe(20)
    expect(rowLead('default')).toBe(2)
    expect(rowLead(undefined)).toBe(29)
  })
})

/** A main-thread request that read 400k from the cache, as the API reports it. */
async function respond($: Engine, on: On) {
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model: 'claude-opus-5-5', input_tokens: 2_000, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 10_000, output_tokens: 500 },
    }
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 12 })
  for await (const _ of stream) {
    // drained
  }
  await stream.result
}

/** Every Text of a drawn tree, in order: the line as the eye reads it. */
function lineText(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const kids = (node as { children?: unknown }).children
  return Array.isArray(kids) ? kids.map(lineText).join('') : ''
}

test('a main-thread response draws the model and the gauge: in the hint row in the terminal', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  await respond($, on)
  const ui = await $.ui.mount({ plugin: 'statusline', surface: 'terminal', ...HINT, viewport: { columns: 160, rows: 40 } })
  const line = lineText(await ui.drawn())
  expect(line).toContain('Opus 5.5 xhigh')
  expect(line).toContain('412k ')
  expect(await ui.find({ type: 'Text', text: '⏵⏵ auto' })).toBeDefined()
  await ui.unmount()
})

test('after a compaction the gauge shows its new size at once, also when another mod’s hook answered it', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  // The last response's 412k until the next one; /context's estimate counts what the compaction left.
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 1_000_000, tokens: 412_000, breakdown: { totalTokens: 51_000, rawMaxTokens: 850_000, isAutoCompactEnabled: false } },
      rateLimits: [],
    },
  }) as never)
  on('classic.PostCompact', () => ({}))
  await respond($, on)
  const ui = await $.ui.mount({ plugin: 'statusline', surface: 'terminal', ...HINT, viewport: { columns: 160, rows: 40 } })
  expect(lineText(await ui.drawn())).toContain('412k ')
  await $.classic.PostCompact({ trigger: 'manual', compact_summary: '' } as never)
  const line = lineText(await ui.drawn())
  expect(line).toContain('51k ')
  expect(line).not.toContain('412k')
  await ui.unmount()
})

test('the desktop app, which draws no hint row, gets the line in the band above the prompt', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  await respond($, on)
  const band = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 150, scroll: { offset: 0, bodyRows: 9 }, view: {} }, viewport: { columns: 160, rows: 40 } } as const
  // The desktop app shows model and context itself: with no other mod's segment, the band draws nothing.
  const ui = await $.ui.mount({ plugin: 'statusline', surface: 'desktop', ...band } as never)
  expect(lineText(await ui.drawn())).toBe('')
  await ui.unmount()
  // The terminal keeps its band free.
  const term = await $.ui.mount({ plugin: 'statusline', surface: 'terminal', ...band } as never)
  expect(lineText(await term.drawn()).includes('Opus 5.5')).toBe(false)
  await term.unmount()
})

test('tail mode leaves the engine its own line', { options: { placement: 'tail' } }, async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.hint}${e.props.tail ?? ''}`}</Text>
  })
  await respond($, on)
  const ui = await $.ui.mount({ plugin: 'statusline', surface: 'terminal', ...HINT, viewport: { columns: 160, rows: 40 } })
  const line = await ui.find({ type: 'Text' })
  expect(line?.text.startsWith('⏵⏵ auto mode on (shift+tab to cycle)  ')).toBe(true)
  expect(line?.text.includes('412k')).toBe(true)
  await ui.unmount()
})
