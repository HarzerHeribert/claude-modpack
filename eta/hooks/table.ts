// The band's table of jobs as data: rows of toned parts, in columns sized to the band's width.
// Drawing them is register.tsx's job.
//
// Columns, left to right: state, name, gauge, percent, done/total, ETA clock, "in …", range, note.
// Running jobs come first, soonest ETA first. What has run is done with: a finished job shows its
// full gauge for a beat and leaves; a failed one stays in red below a hairline until the person
// has seen it. Columns keep their widths while the values in them change; when the band narrows,
// columns go in a fixed order.
//
// One palette with smart-compact's line: the Claude accent for what runs, green for done, red for
// failed, the readable grey for labels and the dim one for what sits back.

import type { Job } from '../types'
import { clock, duration, estimate } from './estimate'

export type Tone = 'accent' | 'good' | 'bad' | 'warn' | 'text' | 'label' | 'faint' | 'glint'

export type Part = { text: string; tone: Tone }

/** A job row, the hairline, or the line that folds the ended jobs (a button). */
export type Row = { key: string; kind: 'job' | 'rule' | 'fold'; parts: Part[] }

/** How long a finished job's gauge shows full, with one glint along it, before it becomes a done row. */
export const BEAT_MS = 1200
const SPIN = ['◐', '◓', '◑', '◒'] as const
const GAP = '  '

function part(text: string, tone: Tone): Part {
  return { text, tone }
}

export function width(text: string): number {
  return [...text].length
}

/** Cut to `n` cells with an ellipsis, or padded to `n`. */
export function cell(text: string, n: number): string {
  const chars = [...text]
  if (chars.length <= n) return text + ' '.repeat(n - chars.length)
  return chars.slice(0, Math.max(0, n - 1)).join('') + '…'
}

function right(text: string, n: number): string {
  return ' '.repeat(Math.max(0, n - width(text))) + text
}

/** smart-compact's gauge: half-cell steps (━ full, ╸ half, ─ empty), with an optional glint cell. */
export function gauge(frac: number, cells: number, tone: Tone, glintAt?: number): Part[] {
  const halves = Math.round(Math.min(1, Math.max(0, frac)) * cells * 2)
  const out: Part[] = []
  for (let i = 0; i < cells; i += 1) {
    const filled = Math.min(2, Math.max(0, halves - i * 2))
    const glyph = filled === 2 ? '━' : filled === 1 ? '╸' : '─'
    const isGlint = glintAt !== undefined && Math.abs(i - glintAt) < 1
    const t: Tone = isGlint ? (filled > 0 ? 'glint' : 'label') : filled > 0 ? tone : 'faint'
    const last = out.at(-1)
    if (last && last.tone === t) last.text += glyph
    else out.push(part(glyph, t))
  }
  return out
}

type State = 'running' | 'waiting' | 'beat' | 'completed' | 'failed' | 'killed'

/** What one job's row says, column by column. */
export type Info = {
  job: Job
  state: State
  frac?: number
  pct?: string
  count?: string
  at?: string
  inn?: string
  innTone?: Tone
  range?: string
  note?: string
  noteTone?: Tone
  /** When it will likely finish, for the order. */
  eta?: number
}

export function info(job: Job, now: number, tz: number | null): Info {
  const count = job.donePattern && job.total ? `${job.done}/${job.total}` : undefined
  if (job.status !== 'running') {
    const end = job.endedAt ?? now
    if (job.status === 'completed' && now - end < BEAT_MS) return { job, state: 'beat', frac: 1, pct: '100%', count }
    const word = job.status === 'completed' ? 'done' : job.status === 'failed' ? 'failed' : 'stopped'
    const took = duration(end - job.startedAt)
    return {
      job,
      state: job.status,
      at: tz === null ? word : `${word} ${clock(end, tz)}`,
      inn: job.status === 'completed' ? `took ${took}` : `after ${took}`,
    }
  }
  const e = estimate(job, now)
  const pct = e.frac === undefined ? undefined : `${Math.floor(e.frac * 100)}%`
  const stalledNote = e.stalledMs === undefined ? {} : { note: `no progress for ${duration(e.stalledMs)}`, noteTone: 'warn' as const }
  if (e.basis === 'measured' && e.at !== undefined) {
    const wide = e.lo !== undefined && e.hi !== undefined && e.hi - e.lo >= 4 * 60_000 && tz !== null
    return {
      job, state: 'running', frac: e.frac, pct, count, eta: e.at,
      at: tz === null ? undefined : clock(e.at, tz),
      inn: `in ${duration(e.at - now)}`,
      range: wide ? `${clock(e.lo as number, tz as number)}–${clock(e.hi as number, tz as number)}` : undefined,
      ...stalledNote,
    }
  }
  if (e.basis === 'guess' && e.at !== undefined) {
    const isOver = e.at <= now
    return {
      job, state: 'running', frac: e.frac, pct, count, eta: e.at,
      at: tz === null || isOver ? undefined : `~${clock(e.at, tz)}`,
      inn: isOver ? `over by ${duration(now - e.at)}` : `in ~${duration(e.at - now)}`,
      innTone: isOver ? 'warn' : undefined,
      note: "Claude's guess",
      noteTone: 'faint',
      ...stalledNote,
    }
  }
  return {
    job, state: e.frac === undefined ? 'waiting' : 'running', frac: e.frac, pct, count,
    inn: `${duration(now - job.startedAt)} so far`,
    note: e.frac === undefined ? 'no progress readable yet' : 'measuring',
    noteTone: 'faint',
    ...stalledNote,
  }
}

/** The columns a table keeps at a width. */
export type Layout = { name: number; cells: number; count: boolean; inn: boolean; range: boolean; note: boolean }

type Widths = { count: number; at: number; inn: number; range: number; note: number }

function rowWidth(l: Layout, w: Widths): number {
  return (
    3 + l.name + 2 + l.cells + 2 + 4 +
    (l.count && w.count ? 2 + w.count : 0) +
    (w.at ? 2 + w.at : 0) +
    (l.inn && w.inn ? 2 + w.inn : 0) +
    (l.range && w.range ? 2 + w.range : 0) +
    (l.note && w.note ? 2 + w.note : 0)
  )
}

/**
 * The widest layout that fits: the note goes first, then the range, the gauge shrinks to 12,
 * done/total goes, then "in …", the gauge shrinks to 6, and last the name narrows.
 */
export function layout(longestName: number, w: Widths, columns: number): Layout {
  let l: Layout = { name: Math.min(28, Math.max(8, longestName)), cells: 20, count: true, inn: true, range: true, note: true }
  const steps: ((l: Layout) => Layout)[] = [
    l => ({ ...l, note: false }),
    l => ({ ...l, range: false }),
    l => ({ ...l, cells: 12 }),
    l => ({ ...l, count: false }),
    l => ({ ...l, inn: false }),
    l => ({ ...l, cells: 6 }),
    l => ({ ...l, name: Math.min(l.name, 16) }),
    l => ({ ...l, name: Math.min(l.name, 10) }),
  ]
  for (const step of steps) {
    if (rowWidth(l, w) <= columns) break
    l = step(l)
  }
  return l
}

/** The failures the person has seen (written again since): those leave the band too. */
export type View = { seen: readonly string[] }

function iconOf(i: Info, now: number): Part {
  if (i.state === 'running' || i.state === 'waiting') return part(SPIN[Math.floor(now / 250) % SPIN.length] ?? '◐', 'accent')
  if (i.state === 'beat' || i.state === 'completed') return part('✓', 'good')
  if (i.state === 'failed') return part('✕', 'bad')
  return part('⊘', 'label')
}

/**
 * The table, row by row: running jobs (soonest first), then a hairline and the failures the person
 * has not seen yet. A job that finished or was stopped is gone after its beat.
 */
export function table(list: readonly Job[], now: number, tz: number | null, columns: number, view: View): Row[] {
  const infos = list.map(j => info(j, now, tz))
  const running = infos
    .filter(i => i.state === 'running' || i.state === 'waiting' || i.state === 'beat')
    .sort((a, b) => (a.state === 'beat' ? -1 : b.state === 'beat' ? 1 : (a.eta ?? Infinity) - (b.eta ?? Infinity)))
  const shown = infos
    .filter(i => i.state === 'failed' && !view.seen.includes(i.job.id))
    .sort((a, b) => (b.job.endedAt ?? 0) - (a.job.endedAt ?? 0))

  const max = (f: (i: Info) => string | undefined) => Math.max(0, ...running.map(i => width(f(i) ?? '')))
  // Widths that hold still while the values change: done/total as wide as its total twice, the
  // clock with room for its "~", "in …" at least ten cells, the range its full length.
  const totals = running.map(i => (i.job.donePattern && i.job.total ? width(String(i.job.total)) * 2 + 1 : 0))
  const w: Widths = {
    count: Math.max(0, ...totals),
    at: running.some(i => i.at) ? Math.max(6, max(i => i.at)) : 0,
    inn: running.some(i => i.inn) ? Math.max(10, max(i => i.inn)) : 0,
    range: running.some(i => i.range) ? 11 : 0,
    note: max(i => i.note),
  }
  const longest = Math.max(0, ...[...running, ...shown].map(i => width(i.job.label)))
  const l = layout(longest, w, columns)
  const rows: Row[] = []

  for (const i of running) {
    const isBeat = i.state === 'beat'
    const glintAt = isBeat ? ((now - (i.job.endedAt ?? now)) / BEAT_MS) * (l.cells + 4) - 2 : undefined
    const parts: Part[] = [iconOf(i, now), part(GAP, 'faint'), part(cell(i.job.label, l.name), 'text'), part(GAP, 'faint')]
    parts.push(...gauge(i.frac ?? 0, l.cells, isBeat ? 'good' : 'accent', glintAt))
    parts.push(part(GAP + right(i.pct ?? '—', 4), i.pct ? 'text' : 'faint'))
    if (l.count && w.count) parts.push(part(GAP + right(i.count ?? '', w.count), 'label'))
    if (w.at) parts.push(part(GAP + right(i.at ?? '', w.at), 'text'))
    if (l.inn && w.inn) parts.push(part(GAP + right(i.inn ?? '', w.inn), i.innTone ?? 'label'))
    if (l.range && w.range) parts.push(part(GAP + cell(i.range ?? '', w.range), 'faint'))
    if (l.note && w.note && i.note) parts.push(part(GAP + i.note, i.noteTone ?? 'faint'))
    rows.push({ key: i.job.id, kind: 'job', parts: trimEnd(parts) })
  }

  if (running.length > 0 && shown.length > 0) {
    rows.push({ key: 'rule', kind: 'rule', parts: [part('─'.repeat(Math.min(columns, rowWidth(l, w))), 'faint')] })
  }

  for (const i of shown) {
    const failed = i.state === 'failed'
    rows.push({
      key: i.job.id,
      kind: 'job',
      parts: [
        iconOf(i, now),
        part(GAP, 'faint'),
        part(cell(i.job.label, l.name), failed ? 'bad' : 'label'),
        part(GAP, 'faint'),
        part(i.at ?? '', failed ? 'bad' : i.state === 'completed' ? 'good' : 'label'),
        part(` · ${i.inn ?? ''}`, 'faint'),
      ],
    })
  }

  return rows
}

/** No trailing blanks: a padded empty column at the end of a row is just room. */
function trimEnd(parts: Part[]): Part[] {
  const out = [...parts]
  while (out.length > 0) {
    const last = out.at(-1) as Part
    const trimmed = last.text.replace(/\s+$/, '')
    if (trimmed) {
      out[out.length - 1] = { ...last, text: trimmed }
      break
    }
    out.pop()
  }
  return out
}
