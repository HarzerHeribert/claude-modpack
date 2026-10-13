import { describe, expect, test } from 'claude-code/testing'

import type { SmartCompactCache } from '../types'
import { READY_ID, plainText, readySegment } from '../hooks/line'
import { TTL_1H } from '../hooks/policy'

const NOW = 1_000_000_000
const AT = { now: NOW, isWorking: false }

const WARM: SmartCompactCache = {
  phase: 'warm',
  model: 'claude-opus-5-5',
  contextTokens: 412_000,
  warmAt: NOW - 16 * 60_000,
  ttlMs: TTL_1H,
  ttlSource: 'plan',
  plan: 'keepalive',
  why: '',
  actAt: NOW + 41.5 * 60_000,
  keptAlive: 0,
  keptAliveUsd: 0,
  savedUsd: 2.9,
  isPaused: false,
}

const say = (c: SmartCompactCache, at = AT) => {
  const s = readySegment(c, at)
  return s === undefined ? undefined : plainText(s, at.now)
}

describe('the segment smart-compact puts on the line', () => {
  test('ready at the right edge, the most important segment', () => {
    const s = readySegment(WARM, AT)
    expect(s?.id).toBe(READY_ID)
    expect(s?.side).toBe('end')
    expect(s?.priority).toBe(0)
  })

  test('kept warm: ready, and no countdown; left to lapse: when it goes cold, amber in the last five minutes', () => {
    expect(say(WARM)).toBe('● ready')
    const lapsing = { ...WARM, plan: 'lapse' as const }
    expect(say(lapsing)).toBe('● ready · cold in 44m')
    const countdown = readySegment(lapsing, AT)?.parts.at(-1)
    expect(countdown).toEqual({ until: WARM.warmAt! + TTL_1H, prefix: ' · cold in ', tone: 'label', warnMs: 300_000 })
    expect(readySegment(lapsing, AT)?.short).toHaveLength(2)
  })

  test('a compaction under ten minutes away says so', () => {
    const compacting = { ...WARM, plan: 'compact' as const, actAt: NOW + 5.5 * 60_000 }
    expect(say(compacting)).toBe('● ready · compacts in 5:30')
    expect(say({ ...compacting, actAt: NOW + 30 * 60_000 })).toBe('● ready')
  })

  test('the dot blinks in the last twenty seconds before the mod acts', () => {
    const dot = readySegment(WARM, AT)?.parts[0]
    expect(dot).toEqual({ text: '●', tone: 'good', blink: { from: WARM.actAt! - 20_000, to: WARM.actAt } })
  })

  test('acting turns a spinner; cold, compacted, paused and working say so', () => {
    expect(readySegment({ ...WARM, phase: 'acting' }, AT)?.parts[0]).toEqual({ spin: true, tone: 'accent' })
    expect(say({ ...WARM, phase: 'acting', plan: 'compact' })).toBe('◐ compacting')
    expect(say({ ...WARM, phase: 'cold' })).toBe('○ cold')
    expect(say({ ...WARM, warmAt: NOW - 2 * TTL_1H })).toBe('○ cold')
    expect(say({ ...WARM, phase: 'compacted' })).toBe('◌ compacted')
    expect(say({ ...WARM, isPaused: true })).toBe('◌ paused')
    expect(say(WARM, { now: NOW, isWorking: true })).toBe('●')
    expect(readySegment({ ...WARM, phase: 'none', warmAt: undefined }, AT)).toBeUndefined()
  })
})
