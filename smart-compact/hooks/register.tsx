import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, PluginOptions, Register } from 'claude-code'

import type { SmartCompactCache, SmartCompactWorld } from '../types'
import { READY_ID, plainText, readySegment } from './line'
import {
  DEFAULT_LEARNED,
  TTL_5M,
  addEvidence,
  costsOf,
  decide,
  duration,
  ema,
  marginMs,
  observeTtl,
  paybackRequests,
  pricingFor,
  resolveTtl,
  tokens,
  usd,
  writeMultiplier,
} from './policy'
import type { Decision, Learned, Policy, Situation, Strategy, TtlEvidence, TtlSetting } from './policy'

type Engine = EngineInterface

type Options = {
  policy: Policy
  cacheTtl: TtlSetting
  instructions: string
  /** Compact after a turn when that pays back within this many later requests; 0 never does. */
  afterTurnPayback: number
}

/** After a turn, wait this long before compacting: a quick follow-up should not wait for a summary. */
const AFTER_TURN_GRACE_MS = 20_000

const INITIAL_CACHE: SmartCompactCache = {
  phase: 'none',
  ttlMs: TTL_5M,
  ttlSource: 'api',
  plan: 'none',
  why: '',
  keptAlive: 0,
  keptAliveUsd: 0,
  savedUsd: 0,
  isPaused: false,
}

const INITIAL_WORLD: SmartCompactWorld = {
  isWorking: false,
  limits: [],
  isAutoCompactOn: true,
}

const CACHE = atom({ plugin: 'smart-compact', key: 'cache' } as const, INITIAL_CACHE)
const WORLD = atom({ plugin: 'smart-compact', key: 'world' } as const, INITIAL_WORLD)

const LEARNED_KEY = 'learned'
const EVIDENCE_KEY = 'ttlEvidence'
const SAVED_KEY = 'savedUsd'

const KEEPALIVE_PROMPT =
  'Automated prompt-cache keep-alive, not a message from the user. Reply with the single word: ok'

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find(a => a === value) ?? fallback
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readOptions(o: PluginOptions): Options {
  const strategies = ['smart', 'compact', 'keepalive', 'off'] as const

  return {
    policy: {
      strategy: pick<Strategy>(o.strategy, strategies, 'smart'),
      minSavingsUsd: num(o.minSavingsUsd, 0.25),
      compactPenaltyUsd: num(o.compactPenaltyUsd, 0.5),
      minCompactTokens: num(o.minCompactTokens, 100_000),
      maxIdleMs: num(o.maxIdleHours, 12) * 60 * 60_000,
    },
    cacheTtl: pick<TtlSetting>(o.cacheTtl, ['auto', '5m', '1h'], 'auto'),
    instructions: typeof o.compactInstructions === 'string' ? o.compactInstructions : '',
    afterTurnPayback: num(o.afterTurnPayback, 0),
  }
}

/** What a request cost at list price, from the counts the API reported. */
function spend(usage: ModelUsage, model: string | undefined, ttlMs: number): number {
  const p = pricingFor(model)
  const w = writeMultiplier(ttlMs)

  return (
    (usage.input_tokens * p.input +
      usage.cache_creation_input_tokens * p.input * w +
      usage.cache_read_input_tokens * p.cacheRead +
      usage.output_tokens * p.output) /
    1e6
  )
}

function promptTokens(usage: ModelUsage): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
}

let options: Options = readOptions({})

let learned: Learned = DEFAULT_LEARNED
let evidence: TtlEvidence | undefined
// The main turns started, so a check scheduled after one turn knows when another has begun.
let turnSeq = 0
let isActing = false
let isTicking = false
let isAfterCompact = false
let lastPublished = ''
/** Without the statusline mod, the segment is the session's status text. */
let isOwnText = false
/** Failed attempts at the current edge, and when to try again. */
let failures = 0
let retryAt: number | undefined

async function getCache($: Engine): Promise<SmartCompactCache> {
  return { ...INITIAL_CACHE, ...(await read($, CACHE)) }
}

async function getWorld($: Engine): Promise<SmartCompactWorld> {
  return { ...INITIAL_WORLD, ...(await read($, WORLD)) }
}

function setCache($: Engine, change: (c: SmartCompactCache) => Partial<SmartCompactCache>) {
  return update($, CACHE, value => {
    const c = { ...INITIAL_CACHE, ...value }
    return { ...c, ...change(c) }
  })
}

function setWorld($: Engine, change: (w: SmartCompactWorld) => Partial<SmartCompactWorld>) {
  return update($, WORLD, value => {
    const w = { ...INITIAL_WORLD, ...value }
    return { ...w, ...change(w) }
  })
}

function policyFor(world: SmartCompactWorld): Policy {
  // Auto-compaction switched off reads as "never compact for me".
  const isCompactionOff = !world.isAutoCompactOn && options.policy.strategy === 'smart'
  return isCompactionOff ? { ...options.policy, strategy: 'keepalive' } : options.policy
}

function situation(c: SmartCompactCache, at: number, canCompact: boolean): Situation {
  return {
    contextTokens: c.contextTokens ?? 0,
    ttlMs: c.ttlMs,
    pricing: pricingFor(c.model),
    learned,
    keptAliveUsd: c.keptAliveUsd,
    idleMs: at - (c.idleSince ?? at),
    canCompact,
  }
}

async function addSaved($: Engine, amount: number) {
  if (amount === 0) return

  const lifetime = num(await $.store.get(SAVED_KEY), 0)
  await $.store.set(SAVED_KEY, lifetime + amount)
  await setCache($, c => ({ savedUsd: c.savedUsd + amount }))
}

async function load($: Engine) {
  const stored = await $.store.get(LEARNED_KEY)
  const seen = await $.store.get(EVIDENCE_KEY)

  if (stored !== null && typeof stored === 'object') {
    learned = { ...DEFAULT_LEARNED, ...(stored as Partial<Learned>) }
  }
  if (seen !== null && typeof seen === 'object') {
    evidence = seen as TtlEvidence
  }
}

async function refreshWorld($: Engine, isDeep: boolean) {
  const usage = await $.session.usage(isDeep ? { breakdown: 'summary' } : undefined)
  const breakdown = usage.context.breakdown
  await setWorld($, () => ({
    limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt === undefined ? undefined : Date.parse(l.resetsAt) })),
    ...(breakdown === undefined ? {} : { isAutoCompactOn: breakdown.isAutoCompactEnabled }),
  }))
  // After a reload or a resume the cache has a size before any response.
  const known = usage.context.tokens
  if (known !== undefined) {
    await setCache($, c => (c.contextTokens === undefined && c.phase === 'none' ? { contextTokens: known } : {}))
  }
}

/** Settles the TTL and what will happen at the TTL's edge, for the line. */
async function replan($: Engine) {
  const now = await $.clock.now()
  const world = await getWorld($)
  const ttl = resolveTtl(options.cacheTtl, evidence, world.limits, now)
  const c = await getCache($)

  if (c.phase !== 'warm' || c.warmAt === undefined || c.contextTokens === undefined) {
    await setCache($, () => ({ ttlMs: ttl.ms, ttlSource: ttl.source, actAt: undefined }))
    return
  }

  const edge = c.warmAt + ttl.ms - marginMs(ttl.ms)
  const actAt = retryAt !== undefined && retryAt > edge ? retryAt : edge
  const d = decide(policyFor(world), situation({ ...c, ttlMs: ttl.ms }, actAt, true))

  await setCache($, () => ({ ttlMs: ttl.ms, ttlSource: ttl.source, actAt, plan: d.action, why: d.why }))
}

async function keepAlive($: Engine, c: SmartCompactCache, d: Decision) {
  const startedAt = await $.clock.now()
  const r = await $.model.fork({ prompt: KEEPALIVE_PROMPT })

  if (!r.isAnswered && r.reason === 'nothing-to-fork') {
    await setCache($, () => ({ phase: 'none', plan: 'none', actAt: undefined }))
    return
  }
  if (!r.isAnswered && (r.reason === 'api-error' || r.reason === 'aborted')) {
    throw new Error(r.reason === 'api-error' ? `API error ${r.status}` : 'aborted')
  }

  const n = c.contextTokens ?? 0
  const cost = spend(r.usage, c.model, c.ttlMs)
  const credit = (x: SmartCompactCache) => ({
    lapseUsd: x.credit?.lapseUsd ?? d.costs.lapse,
    spentUsd: (x.credit?.spentUsd ?? 0) + cost,
  })

  if (r.usage.cache_read_input_tokens >= 0.8 * n) {
    await setCache($, x => ({
      phase: 'warm',
      warmAt: startedAt,
      keptAlive: x.keptAlive + 1,
      keptAliveUsd: x.keptAliveUsd + cost,
      credit: credit(x),
    }))
  } else {
    // The entry was gone before its time: the TTL is shorter than assumed.
    if (c.ttlMs > TTL_5M) {
      evidence = addEvidence(evidence, '5m', startedAt)
      await $.store.set(EVIDENCE_KEY, evidence)
    }
    const isRewritten = r.usage.cache_creation_input_tokens >= 0.8 * n
    await setCache($, x => ({
      phase: isRewritten ? 'warm' : 'cold',
      warmAt: isRewritten ? startedAt : x.warmAt,
      keptAliveUsd: x.keptAliveUsd + cost,
      credit: undefined,
    }))
    await addSaved($, -cost - (c.credit?.spentUsd ?? 0))
    $.ui.log(`smart-compact: the cache had already expired; keep-alive cost ${usd(cost)}`)
  }
}

/** Compacts; false when a hook vetoed it, so this edge is left alone. */
async function compactNow($: Engine, c: SmartCompactCache, d: Decision): Promise<boolean> {
  const startedAt = await $.clock.now()
  const r = await $.session.compact(options.instructions ? { instructions: options.instructions } : {})

  if (r.skip !== undefined) {
    await setCache($, () => ({ phase: 'warm', plan: 'lapse', why: `compaction skipped: ${r.skip}`, actAt: undefined }))
    return false
  }

  const cost = r.usage === undefined ? d.costs.compact : spend(r.usage, c.model, c.ttlMs)
  const left = (c.warmAt ?? startedAt) + c.ttlMs - startedAt

  await setCache($, x => ({
    phase: 'compacted',
    credit: { lapseUsd: x.credit?.lapseUsd ?? d.costs.lapse, spentUsd: (x.credit?.spentUsd ?? 0) + cost },
  }))
  $.ui.log(
    `smart-compact: compacted ${tokens(c.contextTokens ?? 0)}` +
      (r.tokensAfter === undefined ? '' : ` → ${tokens(r.tokensAfter)}`) +
      ` while idle, ${duration(left)} before the cache expired` +
      ` (re-caching it would have cost ${usd(d.costs.lapse)})`,
  )
  return true
}

/** After a compaction, from `/compact`, the engine's own or smart-compact's: learn from it and start over. */
async function compacted($: Engine, result: { usage?: ModelUsage; tokensAfter?: number }) {
  if (result.usage !== undefined) {
    const prompt = promptTokens(result.usage)
    learned = {
      summaryTokens: ema(learned.summaryTokens, result.usage.output_tokens),
      postCompactTokens: learned.postCompactTokens,
      compactCacheShare:
        prompt > 0 ? ema(learned.compactCacheShare, result.usage.cache_read_input_tokens / prompt) : learned.compactCacheShare,
    }
    await $.store.set(LEARNED_KEY, learned)
  }

  isAfterCompact = true
  await setCache($, () => ({ phase: 'compacted', contextTokens: undefined, warmAt: undefined, plan: 'none', why: '', actAt: undefined }))
  // The window was re-read: the threshold may move with it.
  await refreshWorld($, true).catch(() => undefined)
}

/** Whether the person has typed something in the prompt box: a compaction would hold their prompt. */
async function hasDraft($: Engine): Promise<boolean> {
  const box = await $.prompt.read().catch(() => undefined)
  return (box?.text ?? '').trim() !== ''
}

async function isAgentBusy($: Engine): Promise<boolean> {
  const agents = await $.agent.list().catch(() => [])
  return agents.some(a => a.status === 'running' || a.status === 'pending' || a.status === 'waiting')
}

/**
 * After a turn, in a long session: compact when the compaction pays back within afterTurnPayback later requests.
 * Measured (compact_bench, 18 Oct): no quality lost between turns; on Opus at 224k a compaction costs about $0.34 and
 * saves about $0.036 a request; in the person's sessions, after 62% of prompts past 250k twenty or more requests
 * followed. Never mid-turn (the engine refuses), never over a draft or running agents, never twice in a row.
 */
async function afterTurn($: Engine, seq: number) {
  if (seq !== turnSeq || isActing || options.afterTurnPayback <= 0) return
  const c = await getCache($)
  const world = await getWorld($)
  const policy = policyFor(world)
  if (world.isWorking || c.isPaused || c.phase === 'compacted' || c.phase === 'acting') return
  if (policy.strategy === 'off' || policy.strategy === 'keepalive') return
  const context = c.contextTokens ?? 0
  if (context < policy.minCompactTokens) return
  const payback = paybackRequests(context, c.ttlMs, pricingFor(c.model), learned)
  if (payback > options.afterTurnPayback) return
  if ((await hasDraft($)) || (await isAgentBusy($)) || seq !== turnSeq) return

  isActing = true
  await setCache($, () => ({ phase: 'acting', plan: 'compact', why: `pays back after about ${Math.ceil(payback)} requests` }))
  await publish($).catch(() => undefined)
  try {
    const r = await $.session.compact(options.instructions ? { instructions: options.instructions } : {})
    if (r.skip !== undefined) {
      await setCache($, () => ({ phase: 'warm', plan: 'none', why: `compaction skipped: ${r.skip}` }))
      return
    }
    await compacted($, r)
    const after = r.tokensAfter ?? learned.postCompactTokens
    $.ui.log(
      `smart-compact: compacted ${tokens(context)} → ${tokens(after)} after the turn: each later request reads ` +
        `${tokens(Math.max(0, context - after))} less, so it pays back after about ${Math.ceil(payback)} requests`,
    )
  } catch (err) {
    await setCache($, x => ({ phase: x.phase === 'acting' ? 'warm' : x.phase, plan: 'none', why: '' }))
    $.ui.log(`smart-compact: compacting after the turn failed (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    isActing = false
    await publish($).catch(() => undefined)
  }
}

async function act($: Engine, c: SmartCompactCache, world: SmartCompactWorld, now: number) {
  const d = decide(policyFor(world), situation(c, now, !(await hasDraft($)) && !(await isAgentBusy($))))

  if (d.action !== 'keepalive' && d.action !== 'compact') {
    // Nothing worth doing: the cache lapses, and so does what was spent.
    await setCache($, () => ({ plan: d.action, why: d.why, actAt: undefined }))
    return
  }

  isActing = true
  await setCache($, () => ({ phase: 'acting', plan: d.action, why: d.why }))
  await publish($).catch(() => undefined)

  let isDone = false

  try {
    isDone = d.action === 'keepalive' ? (await keepAlive($, c, d), true) : await compactNow($, c, d)
    failures = 0
    retryAt = undefined
  } catch (err) {
    // Back off, and give the edge up after three tries.
    failures += 1
    retryAt = failures < 3 ? now + 20_000 : undefined
    const reason = err instanceof Error ? err.message : String(err)
    await setCache($, x => ({
      phase: x.phase === 'acting' ? 'warm' : x.phase,
      actAt: retryAt,
      ...(retryAt === undefined ? { plan: 'lapse' as const, why: `${d.action} failed: ${reason}` } : {}),
    }))
    $.ui.log(`smart-compact: ${d.action} failed (${reason})${retryAt === undefined ? '; giving up' : '; retrying in 20s'}`)
  } finally {
    isActing = false
    await publish($).catch(() => undefined)
  }

  if (isDone) await replan($)
}

/**
 * Puts the segment on the statusline mod's line when it changed. Without that mod the same words
 * are the session's status text, said again every tick so the countdown moves.
 */
async function publish($: Engine) {
  const now = await $.clock.now()
  const segment = readySegment(await getCache($), { now, isWorking: (await getWorld($)).isWorking })
  const key = JSON.stringify(segment ?? null)
  if (key === lastPublished && !isOwnText) return
  try {
    if (segment === undefined) await $.statusline.remove({ id: READY_ID })
    else await $.statusline.set(segment)
    if (isOwnText) $.ui.status(undefined)
    isOwnText = false
  } catch {
    // No statusline mod in this session: the session's status text says it.
    $.ui.status(segment === undefined ? undefined : plainText(segment, now))
    isOwnText = segment !== undefined
  }
  lastPublished = key
}

async function tick($: Engine) {
  if (isTicking || isActing) return
  isTicking = true

  try {
    const now = await $.clock.now()
    const c = await getCache($)
    const world = await getWorld($)
    if (c.phase === 'warm' && c.warmAt !== undefined && !world.isWorking) {
      const expiry = c.warmAt + c.ttlMs

      if (now >= expiry) {
        // Asleep past the edge, or nothing was worth doing: count what was spent.
        await setCache($, () => ({ phase: 'cold', plan: 'none', why: 'expired', actAt: undefined, credit: undefined }))
        await addSaved($, -(c.credit?.spentUsd ?? 0))
        return
      }

      const isOn = !c.isPaused && options.policy.strategy !== 'off'
      if (isOn && c.actAt !== undefined && now >= c.actAt) {
        await act($, c, world, now)
        return
      }

    }

  } finally {
    isTicking = false
    await publish($).catch(() => undefined)
  }
}

async function onMainResponse($: Engine, startedAt: number, index: number, usage: ModelUsage & { model: string }) {
  const n = promptTokens(usage)
  const c = await getCache($)

  const isSameMain = c.phase !== 'compacted' && c.model === usage.model
  if (index === 0 && isSameMain && c.warmAt !== undefined && c.contextTokens !== undefined) {
    const seen = observeTtl(startedAt - c.warmAt, c.contextTokens, usage)
    if (seen !== undefined) {
      evidence = addEvidence(evidence, seen, startedAt)
      await $.store.set(EVIDENCE_KEY, evidence)
    }
  }

  // The person is back: settle what keeping the cache cost against a lapse.
  if (index === 0 && c.credit !== undefined) {
    const p = pricingFor(usage.model)
    const rewrite = (usage.cache_creation_input_tokens * p.input * writeMultiplier(c.ttlMs)) / 1e6
    const isHit = usage.cache_read_input_tokens >= 0.5 * (c.contextTokens ?? 0)
    const saved =
      c.phase === 'compacted'
        ? c.credit.lapseUsd - c.credit.spentUsd - rewrite
        : isHit
          ? c.credit.lapseUsd - c.credit.spentUsd
          : -c.credit.spentUsd
    await addSaved($, saved)
  }

  if (isAfterCompact) {
    isAfterCompact = false
    learned = { ...learned, postCompactTokens: ema(learned.postCompactTokens, n) }
    await $.store.set(LEARNED_KEY, learned)
  }

  await setCache($, () => ({ phase: 'warm', model: usage.model, contextTokens: n, warmAt: startedAt, credit: undefined }))
}

export const register: Register = (on, rawOptions) => {
  if (rawOptions.enabled === false) return
  options = readOptions(rawOptions)
  learned = DEFAULT_LEARNED
  evidence = undefined
  failures = 0
  retryAt = undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cache',
      description: 'Prompt cache: what idling costs, and what smart-compact will do about it',
      argumentHint: '[pause | resume | keepalive]',
    })

    await load($)
    // A reload mid-action leaves no action running.
    await setCache($, c => (c.phase === 'acting' ? { phase: 'warm' } : {}))
    await refreshWorld($, true).catch(() => undefined)
    await replan($)
    $.clock.every(1_000, () => void tick($))

    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const seconds = e.seconds_since_last_response
    const isResumed = e.source === 'resume' || e.source === 'fork'

    if (isResumed && seconds !== undefined && e.context_tokens) {
      const now = await $.clock.now()
      await setCache($, () => ({
        phase: e.prompt_cache_likely_expired ? 'cold' : 'warm',
        warmAt: now - seconds * 1000,
        contextTokens: e.context_tokens,
        model: e.model,
        idleSince: now - seconds * 1000,
      }))
      await replan($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await setCache($, c => ({ ...INITIAL_CACHE, savedUsd: c.savedUsd, isPaused: c.isPaused }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) turnSeq += 1
    failures = 0
    retryAt = undefined
    await setWorld($, () => ({ isWorking: true }))
    await setCache($, () => ({ actAt: undefined, idleSince: undefined, keptAlive: 0, keptAliveUsd: 0 }))
    await publish($).catch(() => undefined)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now()
    const result = yield* next(e)

    if (e.agentId === undefined && result.usage !== null) {
      await onMainResponse($, startedAt, e.index, result.usage)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const now = await $.clock.now()
    await setWorld($, () => ({ isWorking: false }))
    await setCache($, () => ({ idleSince: now, keptAlive: 0, keptAliveUsd: 0 }))
    await refreshWorld($, false)
    await replan($)
    const seq = turnSeq
    $.clock.after(AFTER_TURN_GRACE_MS, () => void afterTurn($, seq).catch(() => undefined))

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || result.skip !== undefined) return result
    await compacted($, result)
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'cache' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'pause' || arg === 'resume') {
      await setCache($, () => ({ isPaused: arg === 'pause' }))
      return { text: arg === 'pause' ? 'smart-compact paused for this session.' : 'smart-compact resumed.' }
    }

    const now = await $.clock.now()
    const c = await getCache($)
    const world = await getWorld($)

    if (arg === 'keepalive') {
      if (c.phase !== 'warm' || world.isWorking) return { text: 'Nothing to keep warm right now.' }
      const d = decide({ ...options.policy, strategy: 'keepalive', minSavingsUsd: 0 }, situation(c, now, false))
      await keepAlive($, c, d)
      await replan($)
      const after = await getCache($)
      return { text: `Kept warm: ${duration(after.warmAt === undefined ? 0 : after.warmAt + after.ttlMs - now)} left.` }
    }

    const p = pricingFor(c.model)
    const lifetime = num(await $.store.get(SAVED_KEY), 0)
    const lines = [
      `smart-compact · ${options.policy.strategy}${c.isPaused ? ' (paused)' : ''} · ${p.label} · TTL ${duration(c.ttlMs)} (${c.ttlSource})`,
    ]

    if (c.contextTokens !== undefined && c.warmAt !== undefined && c.phase === 'warm') {
      const costs = costsOf(c.contextTokens, c.ttlMs, p, learned)
      lines.push(`cache   warm, ${duration(c.warmAt + c.ttlMs - now)} left · ${tokens(c.contextTokens)} tokens`)
      if (c.actAt !== undefined) lines.push(`next    ${c.plan} in ${duration(c.actAt - now)}: ${c.why}`)
      lines.push(
        `costs   lapse ${usd(costs.lapse)} · keep-alive ${usd(costs.keepAlive)} · ` +
          `compact ${usd(costs.compact)} + ${usd(options.policy.compactPenaltyUsd)} for lost detail`,
      )
    } else {
      lines.push(`cache   ${c.phase}${c.contextTokens === undefined ? '' : ` · ${tokens(c.contextTokens)} tokens`}`)
    }

    if (c.keptAlive > 0) lines.push(`idle    ${c.keptAlive} keep-alive(s), ${usd(c.keptAliveUsd)}`)
    lines.push(`saved   ${usd(Math.max(0, c.savedUsd))} this session · ${usd(Math.max(0, lifetime))} all time (list price)`)
    lines.push(
      `learned summary ~${tokens(learned.summaryTokens)} · after ~${tokens(learned.postCompactTokens)} · ` +
        `compaction cache hit ${Math.round(learned.compactCacheShare * 100)}%`,
    )

    return { text: lines.join('\n') }
  })
}
