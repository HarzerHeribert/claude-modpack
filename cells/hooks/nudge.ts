// Notes after the fact: when a model request did no more than a step that
// needed no judgment (a check right after edits, one more single edit, the
// same command again), its tool result says what that request re-read and
// how to save it next time; a script that rewrote files around the Edit tool
// is pointed to run_cell. Notes only, never a block, and few of them.

export type Kind = 'edit' | 'script-edit' | 'check' | 'edit-check' | 'bash' | 'other'

/** A command that tests, type-checks, builds or lints. */
const CHECK =
  /(\btsc\b|pytest|py\.test|\bnpm (run )?(test|build|lint|check|typecheck)\b|\b(pnpm|yarn|bun) (run )?(test|build|lint|typecheck)\b|\bcargo (test|check|build|clippy)\b|\bgo (test|build|vet)\b|claude plugin (test|validate)|\bruff\b|\bmypy\b|\bpyright\b|\beslint\b|\bjest\b|\bvitest\b|(^|[;&|]\s*)make\b|\bswift (build|test)\b|xcodebuild|\bgradle\b|\bmvn\b|dotnet (build|test)|node --test|-m (pytest|unittest)\b|board validate|latexmk|\bshellcheck\b|py_compile|node --check)/

/** A command that writes files: a script, sed or perl in place, a redirect into a file. */
const WRITES = /(\.write\(|open\([^)]*['"][wa]['"]|write_text\(|writeFileSync|\bsed -i|\bperl -[a-z0-9]*i|\bcat >|\btee \S)/

/**
 * A script that rewrites text inside existing files: Python or Node replacing
 * and writing back, or perl in place. Exact and multi-line replacements are
 * what the Edit tool is for; a one-line `sed -i` or a new file is not meant.
 */
const REWRITES = /(\.replace\(|re\.sub\(|\.sub\(|splice|\.slice\()[\s\S]*(open\([^)]*['"]w['"]|write_text\(|writeFileSync)|\bperl -[a-z0-9]*pi/

export function kindOf(tool: string, input: unknown): Kind {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'edit'
  if (tool !== 'Bash') return 'other'
  const command = String((input as { command?: unknown } | undefined)?.command ?? '')
  const writes = WRITES.test(command)
  const checks = CHECK.test(command)
  if (writes && checks) return 'edit-check'
  if (writes) return 'script-edit'
  if (checks) return 'check'
  return 'bash'
}

export function rewritesText(command: string): boolean {
  return REWRITES.test(command)
}

/** One model request of the main loop, as far as the notes need it. */
export type Step = {
  turnId: string
  index: number
  calls: { tool: string; kind: Kind; command?: string }[]
  /** Whether each call has come back without an error, in the order they did. */
  ok: boolean[]
  /** Tokens the request read: from the cache, and uncached. */
  readTokens: number
  uncachedTokens: number
  model: string
  ms: number
}

export type Pattern = 'check-alone' | 'edit-alone' | 'repeat' | 'script-edit'

const normal = (command: string | undefined) => (command ?? '').replace(/\s+/g, ' ').trim()

/**
 * Which avoidable step `current` was, given the request before it in the same
 * turn, as seen from `mine`, one of its calls; undefined when it was none.
 */
export function missed(previous: Step | undefined, current: Step, mine: Step['calls'][number], cells: boolean): Pattern | undefined {
  if (cells && mine.kind === 'script-edit' && rewritesText(mine.command ?? '')) return 'script-edit'
  const before =
    previous !== undefined && previous.turnId === current.turnId && previous.index === current.index - 1 && previous.calls.length > 0
      ? previous
      : undefined
  if (before === undefined || current.calls.length !== 1) return undefined
  const fine = before.ok.length === before.calls.length && before.ok.every(Boolean)
  if (mine.kind === 'check' && fine && before.calls.every(c => c.kind === 'edit' || c.kind === 'script-edit')) return 'check-alone'
  if (mine.kind === 'edit' && fine && before.calls.length === 1 && before.calls[0]?.kind === 'edit') return 'edit-alone'
  const only = before.calls.length === 1 ? before.calls[0] : undefined
  if (only !== undefined && (only.kind === 'bash' || only.kind === 'check') && (mine.kind === 'bash' || mine.kind === 'check')) {
    const a = normal(only.command)
    const b = normal(mine.command)
    if (a !== '' && (a === b || (/\bsleep \d/.test(a) && /\bsleep \d/.test(b)))) return 'repeat'
  }
  return undefined
}

/** How often each note may come: the first in full, later ones short, spaced out and capped. */
const LIMITS: Record<Pattern, { gap: number; max: number }> = {
  'check-alone': { gap: 12, max: 4 },
  'edit-alone': { gap: 12, max: 4 },
  repeat: { gap: 8, max: 4 },
  'script-edit': { gap: 25, max: 3 },
}

export class Budget {
  private fired = new Map<Pattern, { count: number; step: number }>()

  /** 'full' the first time, 'short' when a later note is due, else undefined. Counts what it allows. */
  take(pattern: Pattern, step: number): 'full' | 'short' | undefined {
    const seen = this.fired.get(pattern)
    const limit = LIMITS[pattern]
    if (seen === undefined) {
      this.fired.set(pattern, { count: 1, step })
      return 'full'
    }
    if (seen.count >= limit.max || step - seen.step < limit.gap) return undefined
    this.fired.set(pattern, { count: seen.count + 1, step })
    return 'short'
  }
}

/** $/M tokens, list prices, as Claude Code totals them. */
const PRICES: Record<string, { read: number; input: number }> = {
  haiku: { read: 0.01, input: 0.1 },
  sonnet: { read: 0.2, input: 2 },
  opus: { read: 0.2, input: 4 },
  fable: { read: 0.25, input: 10 },
}

/** What re-reading the context cost the request: "412k tokens, ≈$0.08, 6 s". */
export function costOf(step: Step): string {
  const key = Object.keys(PRICES).find(k => step.model.toLowerCase().includes(k)) ?? 'opus'
  const p = PRICES[key] as { read: number; input: number }
  const usd = (step.readTokens * p.read + step.uncachedTokens * p.input) / 1e6
  const tokens = step.readTokens + step.uncachedTokens
  const k = tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
  const money = usd < 0.01 ? `≈$${usd.toFixed(3)}` : `≈$${usd.toFixed(2)}`
  return `${k} tokens, ${money}, ${Math.max(1, Math.round(step.ms / 1000))} s`
}

export function noteFor(pattern: Pattern, size: 'full' | 'short', cost: string, cells: boolean): string {
  if (pattern === 'check-alone') {
    return size === 'full'
      ? `cells: this check ran in a model request of its own right after the edits, and that request re-read the whole context (${cost}). Next time send the check in the same response as the edits: calls in one response run in order, so it sees them.${cells ? ' Or make the edits and the check one run_cell that returns only what failed.' : ''}`
      : `cells: another check in a request of its own (${cost}); it can go in the response with the edits.`
  }
  if (pattern === 'edit-alone') {
    return size === 'full'
      ? `cells: a second request in a row that made one edit; it re-read the whole context (${cost}). Edits you already know can go together in one response${cells ? ', or into one run_cell with their check' : ''}.`
      : `cells: another one-edit request (${cost}); edits you already know can go together.`
  }
  if (pattern === 'repeat') {
    return size === 'full'
      ? `cells: the same command again in a new request (${cost}). To wait for something, wait in one command (\`until <test>; do sleep 5; done\`) or watch it with Monitor.`
      : `cells: the same command again (${cost}); wait in one command instead.`
  }
  return size === 'full'
    ? 'cells: this script rewrote files around the Edit tool, so the person sees no diff and checkpoints do not track it (/rewind cannot restore it). run_cell does the same in one step through Edit: `await read(p); await edit(p, old, new); return (await sh(check)).out`, and rename(path, name, newName) renames a symbol by its references.'
    : "cells: another script edit around the Edit tool; run_cell's edit() keeps the diff and /rewind."
}
