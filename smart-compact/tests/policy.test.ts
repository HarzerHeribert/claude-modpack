import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_LEARNED,
  TTL_1H,
  TTL_5M,
  costsOf,
  decide,
  duration,
  observeTtl,
  paybackRequests,
  pricingFor,
  resolveTtl,
  tokens,
} from '../hooks/policy'
import type { Policy, Situation } from '../hooks/policy'

const SMART: Policy = {
  strategy: 'smart',
  minSavingsUsd: 0.25,
  compactPenaltyUsd: 0.5,
  minCompactTokens: 100_000,
  maxIdleMs: 6 * 60 * 60_000,
}

const OPUS = pricingFor('claude-opus-5-5')

function idle(over: Partial<Situation> = {}): Situation {
  return {
    contextTokens: 400_000,
    ttlMs: TTL_1H,
    pricing: OPUS,
    learned: DEFAULT_LEARNED,
    keptAliveUsd: 0,
    idleMs: 57 * 60_000,
    canCompact: true,
    ...over,
  }
}

describe('prices', () => {
  test('names the model from its API id', () => {
    expect(pricingFor('claude-opus-5-5').label).toBe('Opus 5.5')
    expect(pricingFor('claude-opus-4-7').label).toBe('Opus 4.7')
    expect(pricingFor('claude-fable-5-1').cacheRead).toBe(0.25)
    expect(pricingFor('claude-sonnet-5-5').label).toBe('Sonnet 5.5')
  })

  test('a 400k Opus 5.5 context on the hour TTL', () => {
    const c = costsOf(400_000, TTL_1H, OPUS, DEFAULT_LEARNED)
    // 400k x $4/M x 2 (1h write)
    expect(Math.round(c.lapse * 1000)).toBe(3200)
    // 400k x $0.20/M read + 300 x $20/M out
    expect(Math.round(c.keepAlive * 1000)).toBe(86)
    expect(c.compact).toBeLessThan(1)
  })
})

describe('decide', () => {
  test('keeps a big idle cache warm first', () => {
    expect(decide(SMART, idle()).action).toBe('keepalive')
  })

  test('compacts once keep-alives have cost what compacting would', () => {
    const c = costsOf(400_000, TTL_1H, OPUS, DEFAULT_LEARNED)
    const spent = c.compact + SMART.compactPenaltyUsd - c.keepAlive / 2
    expect(decide(SMART, idle({ keptAliveUsd: spent })).action).toBe('compact')
  })

  test('compacts after the idle limit', () => {
    expect(decide(SMART, idle({ idleMs: 7 * 60 * 60_000 })).action).toBe('compact')
  })

  test('bridges with a keep-alive while compaction is blocked', () => {
    const d = decide(SMART, idle({ idleMs: 7 * 60 * 60_000, canCompact: false }))
    expect(d.action).toBe('keepalive')
  })

  test('lets a small cache lapse', () => {
    expect(decide(SMART, idle({ contextTokens: 25_000 })).action).toBe('lapse')
  })

  test('never compacts below the minimum context', () => {
    const d = decide(SMART, idle({ contextTokens: 90_000, idleMs: 7 * 60 * 60_000 }))
    expect(d.action).toBe('lapse')
  })

  test('the compact strategy compacts at the first edge', () => {
    expect(decide({ ...SMART, strategy: 'compact' }, idle()).action).toBe('compact')
  })

  test('the keepalive strategy never compacts', () => {
    const d = decide({ ...SMART, strategy: 'keepalive' }, idle({ idleMs: 7 * 60 * 60_000 }))
    expect(d.action).toBe('lapse')
  })

  test('off does nothing', () => {
    expect(decide({ ...SMART, strategy: 'off' }, idle()).action).toBe('none')
  })
})

describe('ttl', () => {
  test('a plan caches for an hour, overage and API keys for five minutes', () => {
    const plan = [{ kind: 'five_hour', percentUsed: 40 }]
    expect(resolveTtl('auto', undefined, plan, 0).ms).toBe(TTL_1H)
    expect(resolveTtl('auto', undefined, [{ kind: 'five_hour', percentUsed: 100 }], 0).ms).toBe(TTL_5M)
    expect(resolveTtl('auto', undefined, [], 0).ms).toBe(TTL_5M)
    expect(resolveTtl('5m', undefined, plan, 0).ms).toBe(TTL_5M)
  })

  test('one miss is not enough to believe five minutes', () => {
    const plan = [{ kind: 'five_hour', percentUsed: 40 }]
    expect(resolveTtl('auto', { ttl: '5m', at: 0, count: 1 }, plan, 1).ms).toBe(TTL_1H)
    expect(resolveTtl('auto', { ttl: '5m', at: 0, count: 2 }, plan, 1).ms).toBe(TTL_5M)
  })

  test('reads the TTL off a hit or a miss after a gap', () => {
    const hit = { cache_read_input_tokens: 190_000, cache_creation_input_tokens: 2_000 }
    const miss = { cache_read_input_tokens: 0, cache_creation_input_tokens: 195_000 }
    expect(observeTtl(20 * 60_000, 200_000, hit)).toBe('1h')
    expect(observeTtl(10 * 60_000, 200_000, miss)).toBe('5m')
    expect(observeTtl(2 * 60_000, 200_000, miss)).toBeUndefined()
  })
})

describe('format', () => {
  test('tokens and durations stay short', () => {
    expect(tokens(412_345)).toBe('412k')
    expect(tokens(8_400)).toBe('8.4k')
    expect(tokens(1_250_000)).toBe('1.25M')
    expect(duration(41 * 60_000)).toBe('41m')
    expect(duration(192_000)).toBe('3:12')
    expect(duration(70 * 60_000)).toBe('1h10')
  })
})

describe('paybackRequests', () => {
  const opus = pricingFor('claude-opus-5-5')
  test('the compaction against what each later request saves: sooner the longer the session', () => {
    const at = (ctx: number) => paybackRequests(ctx, TTL_1H, opus, DEFAULT_LEARNED)
    expect(at(150_000)).toBeGreaterThan(20)
    expect(at(412_000)).toBeLessThan(20)
    expect(at(412_000)).toBeGreaterThan(at(800_000))
    // As measured (compact_bench): the summary served from the cache, about 7k tokens of it, 25k left after.
    const measured = { summaryTokens: 7_000, postCompactTokens: 25_000, compactCacheShare: 1 }
    expect(Math.round(paybackRequests(224_000, TTL_1H, opus, measured))).toBe(10)
    expect(paybackRequests(30_000, TTL_1H, opus, DEFAULT_LEARNED)).toBe(Number.POSITIVE_INFINITY)
  })
})
