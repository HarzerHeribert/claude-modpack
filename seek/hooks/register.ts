import type { EngineInterface, Register } from 'claude-code'

import { OrderClock, budgetTokens, orderText } from './economy'
import { hitMap, outlinable } from './outline'
import type { FileHits } from './outline'
import { MAX_OUTPUT_LINES, candidatePaths, groupHits, isEmpty, normalize, parseBash, parseHits, parseOutput, parseToolInput } from './search'
import type { BashSearch, Group, Search } from './search'
import { SUBAGENT_ORDER, reaches, withSetting } from './subagents'

type Engine = EngineInterface

/** The person's own prompts: typed, from the phone, or a `claude -p` turn. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])
/** Shorter than this a prompt is a reply ("yes", "go on"), not new work to look around for. */
const MIN_PROMPT = 20
/** A search over more files than this is a survey, not a place to look; files read to find the hits at most. */
const MAX_FILES = 30
const MAX_CANDIDATES = 60
/** Below this many tokens no map row fits that says anything. */
const MIN_BUDGET = 30

let minContext = 150_000
let orderFrom = 0
let later = 140
let saveRate = 0.1
let ordering = true
let mapping = false
// Whether a subagent's task carries the order: the person's prompts, which carry it otherwise, never reach a subagent.
let subagents = true

const number = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback)

/** The context the next request re-reads: the last response's input, else the local estimate /context makes. */
async function contextTokens($: Engine): Promise<number> {
  const plain = await $.session.usage().catch(() => undefined)
  const t = plain?.context.tokens
  if (typeof t === 'number' && t > 0) return t
  const est = await $.session.usage({ breakdown: 'summary' }).catch(() => undefined)
  return est?.context.breakdown?.totalTokens ?? 0
}

/** A file's text; undefined where it cannot be read or is binary. */
async function readText($: Engine, cwd: string, path: string): Promise<string | undefined> {
  const text = await $.fs.read(path.startsWith('/') ? path : normalize(path, cwd)).catch(() => undefined)
  return typeof text === 'string' && !text.includes('\0') ? text : undefined
}

/** What a map may cost here, in tokens; 0 where the session is small or nothing pays. */
async function budget($: Engine): Promise<number> {
  const context = await contextTokens($)
  if (context < minContext) return 0
  const b = budgetTokens(context, saveRate, later)
  return b >= MIN_BUDGET ? b : 0
}

function mapOf(groups: readonly Group[], files: Map<string, string>, tokens: number): string | undefined {
  if (groups.length === 0 || groups.length > MAX_FILES) return undefined
  const hits: FileHits[] = []
  for (const g of groups) {
    const text = files.get(g.path)
    if (text !== undefined) hits.push({ path: g.path, lines: g.lines, text })
  }
  return hits.length === 0 ? undefined : hitMap(hits, tokens)
}

/** The map for a Bash command line with searches in it: the hits are read from its output. */
async function mapBash($: Engine, b: BashSearch, text: string): Promise<string | undefined> {
  if (isEmpty(text) || text.split('\n').length > MAX_OUTPUT_LINES) return undefined
  const tokens = await budget($)
  if (tokens === 0) return undefined
  const sessionCwd = await $.session.cwd()
  const cwd = b.cd === undefined ? sessionCwd : normalize(b.cd, sessionCwd)
  const only = b.searches.length === 1 && b.searches[0]?.operands.length === 1 ? (b.searches[0]?.operands[0] as string).replace(/^(\.\/)+/, '') : undefined
  const paths = new Set(candidatePaths(text).filter(outlinable))
  if (only !== undefined && outlinable(only)) paths.add(only)
  if (paths.size === 0 || paths.size > MAX_CANDIDATES) return undefined
  const files = new Map<string, string>()
  await Promise.all([...paths].map(async p => {
    const t = await readText($, cwd, p)
    if (t !== undefined) files.set(p, t)
  }))
  const parsed = parseOutput(text, p => files.has(p), only !== undefined && files.has(only) ? only : undefined)
  if (parsed.cut || parsed.hits.length === 0) return undefined
  return mapOf(groupHits(parsed.hits, []), files, tokens)
}

/** The map for a Grep tool search in content mode. */
async function mapGrep($: Engine, search: Search, text: string): Promise<string | undefined> {
  if (isEmpty(text)) return undefined
  const hits = parseHits(text, search.operands)
  if (hits === undefined || hits.length === 0) return undefined
  const groups = groupHits(hits, search.operands).filter(g => outlinable(g.path))
  if (groups.length === 0 || groups.length > MAX_FILES) return undefined
  const tokens = await budget($)
  if (tokens === 0) return undefined
  const cwd = await $.session.cwd()
  const files = new Map<string, string>()
  await Promise.all(groups.map(async g => {
    const t = await readText($, cwd, g.path)
    if (t !== undefined) files.set(g.path, t)
  }))
  return mapOf(groups, files, tokens)
}

type Result = { deny?: string; text?: string; isError?: boolean; context?: string[] }

async function attach<R>(result: R, run: ((text: string) => Promise<string | undefined>) | undefined): Promise<R> {
  const r = result as unknown as Result
  if (run === undefined || r.deny !== undefined || r.isError) return result
  const note = await run(r.text ?? '').catch(() => undefined)
  return note === undefined ? result : ({ ...r, context: [...(r.context ?? []), note] } as unknown as R)
}

export const register: Register = (on, options) => {
  if (options.enabled === false) return
  ordering = options.order !== false
  mapping = options.map === true
  subagents = options.subagents !== false
  minContext = number(options.minContext, 150_000)
  orderFrom = number(options.orderFrom, 0)
  later = number(options.laterRequests, 140)
  saveRate = Math.min(1, number(options.saveRate, 0.1))
  const clock = new OrderClock()

  // The person's prompt: the order to look around in few, lean steps, once per stretch of context.
  on('prompt.submit', async ($, e, next) => {
    if (!ordering || !PERSON.has(e.origin?.kind as string)) return next(e)
    const text = e.text.trim()
    if (text.length < MIN_PROMPT || text.startsWith('/')) return next(e)
    const context = await contextTokens($).catch(() => 0)
    if (!clock.due(context, orderFrom)) return next(e)
    clock.mark(context)
    return next({ ...e, context: [...(e.context ?? []), orderText(context)] })
  }).catch(($, e, next) => next(e))

  // A subagent's task: the same order, in the person's name. A subagent starts on a fresh context, so it comes where
  // the person's prompts get it from the first one (orderFrom 0).
  on('agent.spawn', async ($, e, next) => {
    if (!subagents || !ordering || orderFrom > 0 || !reaches(e)) return next(e)
    return next({ ...e, prompt: withSetting(e.prompt, SUBAGENT_ORDER) })
  }).catch(($, e, next) => next(e))

  // A search's result in a long session: where its hits sit, within what a saved request is worth.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    const b = mapping && typeof e.command === 'string' ? parseBash(e.command) : undefined
    return attach(r, b === undefined ? undefined : text => mapBash($, b, text))
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: /^Grep$/ }, async ($, e, next) => {
    const r = await next(e)
    const search = mapping ? parseToolInput(e as unknown as Record<string, unknown>) : undefined
    return attach(r, search === undefined ? undefined : text => mapGrep($, search, text))
  }).catch(($, e, next) => next(e))
}
