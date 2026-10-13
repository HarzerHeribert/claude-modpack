// What to do with an idle session's prompt cache just before it expires.
//
// Three options, priced in list-price USD:
//   lapse      let it expire; the next prompt re-writes the whole prefix
//   keepalive  re-send the prefix once (a fork); a cache read refreshes the TTL
//   compact    summarize while the cache is still warm; the next prompt then
//              re-writes only the small summary
//
// Keep-alives are cheap but recur every TTL, compaction is a one-off but loses
// detail. So `smart` keeps the cache warm until the keep-alives would have
// cost as much as compacting (plus a price on the lost detail), then compacts:
// the ski-rental rule, never worse than twice the best choice in hindsight.

export const TTL_5M = 5 * 60_000
export const TTL_1H = 60 * 60_000

/** List prices, USD per million tokens (Anthropic API, cached 2026-10-06). */
export type Pricing = {
  label: string
  input: number
  output: number
  cacheRead: number
  /** Haiku 5.5 charges more once a prompt passes 100K tokens. */
  long?: { above: number; input: number; output: number; cacheRead: number }
}

const PRICES: ReadonlyArray<readonly [RegExp, Pricing]> = [
  [/(fable|mythos)-5-1/, { label: 'Fable 5.1', input: 10, output: 50, cacheRead: 0.25 }],
  [/(fable|mythos)-5/, { label: 'Fable 5', input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/, { label: 'Opus 5.5', input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-5/, { label: 'Opus 5', input: 5, output: 25, cacheRead: 0.5 }],
  [/opus-4-(\d)/, { label: 'Opus 4', input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet-5-5/, { label: 'Sonnet 5.5', input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet-5/, { label: 'Sonnet 5', input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet-4/, { label: 'Sonnet 4', input: 3, output: 15, cacheRead: 0.3 }],
  [
    /haiku-5-5/,
    {
      label: 'Haiku 5.5',
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      long: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
    },
  ],
  [/haiku/, { label: 'Haiku 4.5', input: 1, output: 5, cacheRead: 0.1 }],
]

const FALLBACK: Pricing = { label: 'Claude', input: 5, output: 25, cacheRead: 0.5 }

export function pricingFor(model: string | undefined): Pricing {
  const id = (model ?? '').toLowerCase().replace(/\./g, '-')
  const hit = PRICES.find(([pattern]) => pattern.test(id))

  if (hit) {
    // Opus 4.x: name the minor version the id carries.
    const minor = /opus-4-(\d)/.exec(id)?.[1]
    return minor ? { ...hit[1], label: `Opus 4.${minor}` } : hit[1]
  }

  return { ...FALLBACK, label: model ?? FALLBACK.label }
}

/** Cache writes cost 1.25x input on the 5-minute TTL, 2x on the 1-hour one. */
export function writeMultiplier(ttlMs: number): number {
  return ttlMs > TTL_5M ? 2 : 1.25
}

function perToken(p: Pricing, promptTokens: number) {
  const r = p.long && promptTokens > p.long.above ? p.long : p
  return { input: r.input / 1e6, output: r.output / 1e6, cacheRead: r.cacheRead / 1e6 }
}

/** What compaction has been seen to produce, learned across sessions. */
export type Learned = {
  /** Output tokens of a compaction (the summary, with its thinking). */
  summaryTokens: number
  /** Context of the first request after a compaction. */
  postCompactTokens: number
  /** Share of a compaction's prompt the cache served (0..1). */
  compactCacheShare: number
}

export const DEFAULT_LEARNED: Learned = {
  summaryTokens: 8_000,
  postCompactTokens: 40_000,
  compactCacheShare: 0.9,
}

/** A keep-alive asks for one word; adaptive thinking may add a little. */
export const KEEPALIVE_OUTPUT_TOKENS = 300

export type Costs = {
  /** Re-writing the whole prefix when the user comes back to a cold cache. */
  lapse: number
  /** One keep-alive: a cache read of the prefix and a one-word reply. */
  keepAlive: number
  /** Compacting now, and re-writing the summary when the user comes back. */
  compact: number
}

export function costsOf(
  contextTokens: number,
  ttlMs: number,
  pricing: Pricing,
  learned: Learned,
): Costs {
  const w = writeMultiplier(ttlMs)
  const at = perToken(pricing, contextTokens)
  const after = Math.min(learned.postCompactTokens, contextTokens)
  const share = Math.min(1, Math.max(0, learned.compactCacheShare))

  const compactRequest =
    contextTokens * (share * at.cacheRead + (1 - share) * w * at.input) +
    learned.summaryTokens * at.output
  const rewriteSummary = after * w * perToken(pricing, after).input

  return {
    lapse: contextTokens * w * at.input,
    keepAlive: contextTokens * at.cacheRead + KEEPALIVE_OUTPUT_TOKENS * at.output,
    compact: compactRequest + rewriteSummary,
  }
}

export type Strategy = 'smart' | 'compact' | 'keepalive' | 'off'

export type Policy = {
  strategy: Strategy
  /** Below this re-cache cost, let the cache lapse: not worth acting on. */
  minSavingsUsd: number
  /** What losing the conversation's detail to a summary is worth avoiding. */
  compactPenaltyUsd: number
  /** Never compact a context smaller than this. */
  minCompactTokens: number
  /** Stop keeping the cache warm after this long idle. */
  maxIdleMs: number
}

export type Situation = {
  contextTokens: number
  ttlMs: number
  pricing: Pricing
  learned: Learned
  /** Spent on keep-alives since the session went idle. */
  keptAliveUsd: number
  idleMs: number
  /** False while the prompt holds a draft or agents still run. */
  canCompact: boolean
}

export type Action = 'keepalive' | 'compact' | 'lapse' | 'none'

export type Decision = { action: Action; why: string; costs: Costs }

export function decide(policy: Policy, s: Situation): Decision {
  const costs = costsOf(s.contextTokens, s.ttlMs, s.pricing, s.learned)
  const answer = (action: Action, why: string): Decision => ({ action, why, costs })

  if (policy.strategy === 'off') {
    return answer('none', 'off')
  }

  if (costs.lapse < policy.minSavingsUsd) {
    return answer('lapse', `re-caching costs only ${usd(costs.lapse)}`)
  }

  const compactAll = costs.compact + policy.compactPenaltyUsd
  const compactPays =
    policy.strategy !== 'keepalive' &&
    s.contextTokens >= policy.minCompactTokens &&
    compactAll < costs.lapse
  const affords = (budget: number) => s.keptAliveUsd + costs.keepAlive <= budget
  const bridge = 'compaction waits for the draft or the agents'

  if (policy.strategy === 'compact') {
    if (compactPays && s.canCompact) {
      return answer('compact', `saves ~${usd(costs.lapse - costs.compact)}`)
    }
    if (compactPays && affords(costs.lapse - compactAll)) {
      return answer('keepalive', bridge)
    }
    return answer('lapse', compactPays ? 'compaction blocked' : 'compaction would not pay')
  }

  // Rent (keep warm) until renting has cost what buying (compacting) would.
  const budget = compactPays ? compactAll : costs.lapse / 2

  if (s.idleMs < policy.maxIdleMs && affords(budget)) {
    return answer('keepalive', `${usd(costs.keepAlive)} keeps ${usd(costs.lapse)} of cache`)
  }
  if (compactPays && s.canCompact) {
    return answer('compact', `kept warm for ${usd(s.keptAliveUsd)}; compacting saves the rest`)
  }
  if (compactPays && affords(costs.lapse)) {
    return answer('keepalive', bridge)
  }

  return answer('lapse', 'keeping it warm no longer pays')
}

/** When to act: early enough that the request starts before the entry lapses. */
export function marginMs(ttlMs: number): number {
  return ttlMs > TTL_5M ? 150_000 : 45_000
}

export type TtlSetting = 'auto' | '5m' | '1h'

export type TtlEvidence = { ttl: '5m' | '1h'; at: number; count: number }

export type RateLimit = { kind: string; percentUsed: number }

export type Ttl = { ms: number; source: string }

const EVIDENCE_TTL_MS = 14 * 24 * 60 * 60_000

/**
 * The TTL the session's requests use. Claude Code caches subscription traffic
 * for an hour and drops to five minutes in overage; API-key traffic defaults
 * to five minutes. What a cache hit or miss after a gap showed wins over that.
 */
export function resolveTtl(
  setting: TtlSetting,
  evidence: TtlEvidence | undefined,
  limits: readonly RateLimit[],
  now: number,
): Ttl {
  if (setting !== 'auto') {
    return { ms: setting === '1h' ? TTL_1H : TTL_5M, source: 'set' }
  }

  const plan = limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day')

  if (plan.some(l => l.percentUsed >= 100)) {
    return { ms: TTL_5M, source: 'overage' }
  }

  const isFresh = evidence !== undefined && now - evidence.at < EVIDENCE_TTL_MS
  const isTrusted = isFresh && (evidence.ttl === '1h' || evidence.count >= 2)

  if (isTrusted) {
    return { ms: evidence.ttl === '1h' ? TTL_1H : TTL_5M, source: 'observed' }
  }

  return plan.length > 0 ? { ms: TTL_1H, source: 'plan' } : { ms: TTL_5M, source: 'api' }
}

export type CacheUsage = {
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/**
 * What a request after a gap says about the TTL: a hit past five minutes
 * can only be the hour-long one; a full re-write well inside the hour points
 * at five minutes (or an invalidated prefix, hence two sightings are needed).
 */
export function observeTtl(
  gapMs: number,
  previousTokens: number,
  usage: CacheUsage,
): '5m' | '1h' | undefined {
  if (previousTokens < 4_096) {
    return undefined
  }

  const read = usage.cache_read_input_tokens / previousTokens
  const wrote = usage.cache_creation_input_tokens / previousTokens

  if (gapMs > TTL_5M + 60_000 && read >= 0.5) {
    return '1h'
  }
  if (gapMs > TTL_5M + 15_000 && gapMs < TTL_1H - 5 * 60_000 && read < 0.2 && wrote >= 0.5) {
    return '5m'
  }

  return undefined
}

export function addEvidence(
  previous: TtlEvidence | undefined,
  ttl: '5m' | '1h',
  now: number,
): TtlEvidence {
  const count = previous?.ttl === ttl ? previous.count + 1 : 1
  return { ttl, at: now, count }
}

/** Moves a learned average toward a new sighting. */
export function ema(previous: number, sample: number, weight = 0.3): number {
  return Math.round((previous * (1 - weight) + sample * weight) * 1000) / 1000
}

export function usd(value: number): string {
  if (value < 0.01) return '<$0.01'
  return value < 10 ? `$${value.toFixed(2)}` : `$${Math.round(value)}`
}

export function tokens(n: number): string {
  if (n < 1_000) return `${n}`
  if (n < 100_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`
  return `${(n / 1_000_000).toFixed(2).replace(/0$/, '')}M`
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h}h` : `${h}h${String(m % 60).padStart(2, '0')}`
}
