// Runs one cell: starts the sandboxed runner, serves each tool call it asks
// for through Claude Code's own tools, and writes the result the model reads.

import { cut } from '../runner/fold.mjs'
import type { Place } from '../runner/lsp.mjs'

export type Need = { n: number; tool: string; input: Record<string, unknown> }

/** What the runner reads back for one call. */
export type Reply = {
  ok: boolean
  denied?: string
  text?: string
  out?: string
  err?: string
  code?: number
  content?: string
  /** Read: where the page starts, how many lines it holds, how many the file has. */
  start?: number
  num?: number
  total?: number
  /** LSP: the places the answer lists, and what a plugin above added. */
  places?: Place[]
  context?: string[]
}

export type Done = {
  output: string
  log: string
  previews: string
  handles: string
  dropped: string[]
  error?: string
  /** The program did not parse, so nothing ran. */
  unparsed?: boolean
  /** That program with one level of escaping taken off templates written as if inside another one, where that parses; the lines they began on, and what changed. */
  repaired?: string
  repairedLines?: number[]
  repairPreview?: string
}

export type CallRecord = { tool: string; label: string; ok: boolean; refused: boolean; ms: number; note?: string }

export const MARK = '\u0001cell '
export const MAX_IN_FLIGHT = 4

const VERB: Record<string, string> = { Bash: 'sh', Read: 'read', Edit: 'edit', Write: 'write', LSP: 'lsp' }

export function labelOf(need: Need): string {
  const i = need.input
  if (need.tool === 'Bash') return String(i.command ?? '').replace(/\s+/g, ' ').trim()
  if (need.tool === 'LSP') return `${String(i.operation ?? '')} ${String(i.filePath ?? '')}:${String(i.line ?? '')}:${String(i.character ?? '')}`
  return String(i.file_path ?? '')
}

export function absolute(cwd: string, file: unknown): string {
  const p = String(file ?? '')
  return p.startsWith('/') ? p : `${cwd.replace(/\/$/, '')}/${p.replace(/^\.\//, '')}`
}

/** A path as a cell should see it: relative to `cwd` when inside it, else absolute; `.` and `..` resolved. */
export function tidy(cwd: string, file: string): string {
  const parts: string[] = []
  for (const part of absolute(cwd, file).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  const full = `/${parts.join('/')}`
  const root = cwd.replace(/\/$/, '')
  return full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full
}

/** The exit code Claude Code writes at the head of a failed Bash result. */
export function exitCode(text: string | undefined): number {
  const m = /^Exit code (\d+)/m.exec(text ?? '')
  return m ? Number(m[1]) : 1
}

/** Splits the runner's stdout into its messages, keeping a partial line. */
export function lines(buffer: string): { messages: unknown[]; rest: string } {
  const messages: unknown[] = []
  let rest = buffer
  let at = rest.indexOf('\n')
  while (at >= 0) {
    const line = rest.slice(0, at)
    rest = rest.slice(at + 1)
    if (line.startsWith(MARK)) {
      try {
        messages.push(JSON.parse(line.slice(MARK.length)))
      } catch {
        // A line the runner did not write whole; nothing to act on.
      }
    }
    at = rest.indexOf('\n')
  }
  return { messages, rest }
}

function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`
}

/** The one tool result the model reads for a cell. */
/** Notes from other plugins a report carries at most, each cut to NOTE_ROOM. */
const MAX_NOTES = 6
const NOTE_ROOM = 800

export function report(calls: readonly CallRecord[], done: Done | undefined, ms: number, stderr: string, notes: readonly string[] = []): string {
  const failed = calls.filter(c => !c.ok).length
  const head = `cell · ${calls.length} call${calls.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''} · ${seconds(ms)}`
  const rows = calls.map(c => {
    const mark = c.refused ? '⊘' : c.ok ? '✓' : '✕'
    const verb = (VERB[c.tool] ?? c.tool).padEnd(5)
    const label = c.label.length > 90 ? `${c.label.slice(0, 89)}…` : c.label
    const note = c.note ? `  ${c.note}` : ''
    return `  ${mark} ${verb} ${label}${note}  ${seconds(c.ms)}`
  })
  const parts = [head, ...rows]

  if (!done) {
    parts.push('## Error', `the runner ended without a result${stderr ? `:\n${cut(stderr, 1500)}` : ''}`)
    return parts.join('\n')
  }
  if (done.output) parts.push('## Output', done.output)
  if (done.log) parts.push('## Log', done.log)
  if (done.previews) parts.push('## Handles', done.previews)
  if (done.dropped.length > 0) parts.push(`(not kept, too large: ${done.dropped.map(k => `h.${k}`).join(', ')})`)
  if (notes.length > 0) {
    parts.push('## Notes', ...notes.slice(0, MAX_NOTES).map(n => cut(n, NOTE_ROOM)))
    if (notes.length > MAX_NOTES) parts.push(`(${notes.length - MAX_NOTES} more notes not shown)`)
  }
  if (done.error) parts.push('## Error', done.error)
  if (done.unparsed && done.repaired !== undefined) {
    const lines = done.repairedLines ?? []
    parts.push(
      '## Repair',
      'Line' + (lines.length === 1 ? ' ' : 's ') + lines.join(', ') + ': a template literal escaped as if it sat inside another one (\\` or \\${ outside any template). With one level of escaping taken off, the program parses:',
      done.repairPreview ?? '',
      'Run it so with run_cell({ repair: true }), or fix it with run_cell({ fix: [{ old, new }] }).',
    )
  } else if (done.unparsed || (done.error !== undefined && calls.length === 0)) {
    parts.push('## Fix', 'Send run_cell({ fix: [{ old, new }] }): exact replacements in this program, which then runs. No need to send it again.')
  }
  if (!done.output && !done.log && !done.error && calls.length > 0) parts.push('(the cell returned nothing)')
  return parts.join('\n')
}

