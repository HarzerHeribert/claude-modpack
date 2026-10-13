// The status line as data: segments of toned parts, fitted to a width by
// priority. Drawing them (a tree, or a plain tail) is register.tsx's job.
//
// The line's own segments say what matters while working: the model and its
// effort, how full the context is, and how much of the plan's 5-hour and
// 7-day windows is used. Other mods add theirs through `$.statusline.set`
// (smart-compact's "● ready · cold in 44m" at the right edge, where the eye
// lands); a part of theirs may count down or turn, and is resolved here.
//
// One palette, from the person's theme: grey labels, the Claude accent for
// what is live, warning and error only for what needs attention.

import type { Color } from 'claude-code'

import type { StatuslinePart, StatuslineSegment, StatuslineTone, StatuslineWorld } from '../types'

export type Tone = StatuslineTone | 'glint'

export type Part = { text: string; tone: Tone }

/** `short` is what the segment says when the full form does not fit, before it is dropped. */
export type Segment = { id: string; priority: number; parts: Part[]; short?: Part[] }

export type LimitsShown = 'always' | 'half' | 'off'

export const COLORS: Record<Tone, Color> = {
  accent: 'claude',
  good: 'success',
  text: 'text',
  // In Claude Code's themes "inactive" is the readable grey and "subtle" the dim one (dark theme:
  // 246 and 239 of 256): labels read in the first, separators and the empty gauge sit back in the second.
  label: 'inactive',
  faint: 'subtle',
  warn: 'warning',
  alert: 'error',
  glint: 'text',
}

/** Between groups on the drawn line: space, not punctuation. */
export const SEPARATOR = '   '
/** Between groups where the line is one plain string (web, mobile). */
export const PLAIN_SEPARATOR = ' · '
/** With `limits: half`, a plan window shows from this share used. */
export const LIMITS_FROM = 50

const SPIN = ['◐', '◓', '◑', '◒'] as const

export type Moment = { now: number; isWorking: boolean; columns: number; limits: LimitsShown }

function part(text: string, tone: Tone): Part {
  return { text, tone }
}

export function width(text: string): number {
  return [...text].length
}

export function segmentWidth(s: Segment): number {
  return s.parts.reduce((sum, p) => sum + width(p.text), 0)
}

function severity(fraction: number): Tone {
  return fraction >= 0.95 ? 'alert' : fraction >= 0.8 ? 'warn' : 'accent'
}

export function tokens(n: number): string {
  if (n < 1_000) return `${n}`
  if (n < 100_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  if (n < 1_000_000) return `${Math.round(n / 1_000)}k`
  return `${(n / 1_000_000).toFixed(2).replace(/0$/, '')}M`
}

/** `8:00` under ten minutes, then `44m`, then `2h14`. */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 === 0 ? `${h}h` : `${h}h${String(m % 60).padStart(2, '0')}`
}

/** How long until a reset: minutes and hours as `duration` says them, days past two. */
export function span(ms: number): string {
  const days = ms / 86_400_000
  return days >= 2 ? `${Math.round(days)}d` : duration(ms)
}

/**
 * A line gauge with half-cell steps. While the model works a glint sweeps
 * along it, which is what the 20 fps redraw is for.
 */
export function gauge(fraction: number, cells: number, tone: Tone, glintAt?: number): Part[] {
  const halves = Math.round(Math.min(1, Math.max(0, fraction)) * cells * 2)
  const out: Part[] = []

  for (let i = 0; i < cells; i += 1) {
    const filled = Math.min(2, Math.max(0, halves - i * 2))
    const glyph = filled === 2 ? '━' : filled === 1 ? '╸' : '─'
    const isGlint = glintAt !== undefined && Math.abs(i - glintAt) < 1
    const cellTone: Tone = isGlint ? (filled > 0 ? 'glint' : 'label') : filled > 0 ? tone : 'faint'
    const last = out.at(-1)

    if (last && last.tone === cellTone) {
      last.text += glyph
    } else {
      out.push(part(glyph, cellTone))
    }
  }

  return out
}

function contextSegment(world: StatuslineWorld, m: Moment): Segment | undefined {
  if (world.contextTokens === undefined) return undefined
  const limit = world.autoCompactAt ?? world.window
  const fraction = limit > 0 ? world.contextTokens / limit : 0
  const cells = m.columns >= 110 ? 12 : 8
  const tone = severity(fraction)
  const glintAt = m.isWorking ? ((m.now % 1600) / 1600) * (cells + 4) - 2 : undefined

  const size = part(`${tokens(world.contextTokens)} `, tone === 'accent' ? 'label' : tone)
  return {
    id: 'context',
    priority: 1,
    parts: [size, ...gauge(fraction, cells, tone, glintAt)],
    short: [{ ...size, text: size.text.trim() }],
  }
}

/**
 * The plan's windows: how much is used and when each resets. Quiet while under half, plain
 * text past it, warning from 80%. Narrow lines drop the reset first, then the window.
 */
function limitSegments(world: StatuslineWorld, m: Moment): Segment[] {
  const out: Segment[] = []
  const order = (kind: string) => (kind === 'five_hour' ? 0 : kind === 'seven_day' ? 1 : 2)

  for (const limit of [...world.limits].sort((a, b) => order(a.kind) - order(b.kind))) {
    const label = limit.kind === 'five_hour' ? '5h' : limit.kind === 'seven_day' ? '7d' : '$'
    const isPlan = limit.kind === 'five_hour' || limit.kind === 'seven_day'
    // A spend cap matters once it runs warm; the plan's windows as the person asked.
    const hidden = isPlan ? m.limits === 'off' || (m.limits === 'half' && limit.percentUsed < LIMITS_FROM) : limit.percentUsed < 70
    if (hidden) continue

    const fraction = limit.percentUsed / 100
    const tone: Tone = fraction >= 0.8 ? severity(fraction) : fraction >= 0.5 ? 'text' : 'label'
    const short = [part(`${label} `, 'label'), part(`${Math.round(limit.percentUsed)}%`, tone)]
    const parts = [...short]
    if (limit.resetsAt !== undefined && limit.resetsAt > m.now) parts.push(part(` ↺${span(limit.resetsAt - m.now)}`, 'faint'))

    const priority = limit.kind === 'five_hour' ? 2 : limit.kind === 'seven_day' ? 3 : 4
    out.push({ id: `limit-${limit.kind}`, priority, parts, short: parts.length > short.length ? short : undefined })
  }

  return out
}

/** "Opus 5.5" from an id, a `/model` name or an alias; the alias itself, capitalised, when it names no version. */
export function modelLabel(model: string): string {
  const id = model.toLowerCase().replace(/[.\s]/g, '-')
  const m = /(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id)
  const name = (word: string) => word[0]!.toUpperCase() + word.slice(1)
  if (m) return m[3] !== undefined ? `${name(m[1]!)} ${m[2]}.${m[3]}` : `${name(m[1]!)} ${m[2]}`
  const alias = /^(opus|sonnet|haiku|fable)/.exec(id)?.[1]
  return alias ? name(alias) : model
}

const EFFORT_TONES: Record<string, Tone> = { low: 'faint', medium: 'label', high: 'text', xhigh: 'accent', max: 'accent' }

/** The model and its effort, the effort coloured by how hard it works. */
function modelSegment(world: StatuslineWorld): Segment | undefined {
  if (world.model === undefined) return undefined
  const parts = [part(modelLabel(world.model), 'label')]
  if (world.effort !== undefined) parts.push(part(` ${world.effort}`, EFFORT_TONES[world.effort] ?? 'label'))
  return { id: 'model', priority: 5, parts }
}

/** A part another mod gave, as it reads now: a countdown counted, a spinner turned, a blink blinked. */
export function resolvePart(p: StatuslinePart, now: number): Part {
  if ('spin' in p) return part(SPIN[Math.floor(now / 125) % SPIN.length] ?? '◐', p.tone)
  if ('until' in p) {
    const left = p.until - now
    return part(`${p.prefix ?? ''}${duration(left)}`, p.warnMs !== undefined && left < p.warnMs ? 'warn' : p.tone)
  }
  const isOff = p.blink !== undefined && now >= p.blink.from && now < p.blink.to && Math.floor(now / 500) % 2 === 0
  return part(p.text, isOff ? 'faint' : p.tone)
}

function resolveSegment(s: StatuslineSegment, now: number): Segment {
  return {
    id: s.id,
    priority: s.priority,
    parts: s.parts.map(p => resolvePart(p, now)),
    short: s.short?.map(p => resolvePart(p, now)),
  }
}

/** Whether a segment moves by itself: a spinner, or a blink under way. */
export function isMoving(s: StatuslineSegment, now: number): boolean {
  return s.parts.some(p => 'spin' in p || ('blink' in p && p.blink !== undefined && now >= p.blink.from && now < p.blink.to))
}

/**
 * Every segment, in the order they read: other mods' `start` segments, the model and its effort,
 * the context, the plan windows, then other mods' `end` segments, the most important rightmost.
 * Narrow terminals lose the model first, then the windows, then the gauge.
 */
export function buildSegments(world: StatuslineWorld, given: readonly StatuslineSegment[], m: Moment): Segment[] {
  const byPriority = (a: StatuslineSegment, b: StatuslineSegment) => b.priority - a.priority
  const start = given.filter(s => s.side === 'start').sort(byPriority)
  const end = given.filter(s => s.side !== 'start').sort(byPriority)
  return [
    ...start.map(s => resolveSegment(s, m.now)),
    modelSegment(world),
    contextSegment(world, m),
    ...limitSegments(world, m),
    ...end.map(s => resolveSegment(s, m.now)),
  ].filter((s): s is Segment => s !== undefined)
}

/** Only what other mods gave and is not calm, in the order they read: what the desktop app's line draws. */
export function buildUncalm(given: readonly StatuslineSegment[], m: Moment): Segment[] {
  return buildSegments({ isWorking: m.isWorking, window: 0, limits: [] }, given.filter(s => s.calm !== true), m)
}

/** The artifacts pill's text. */
export function artifactsLabel(n: number): string {
  return `${n} artifact${n === 1 ? '' : 's'}`
}

/**
 * Makes the segments fit in `room`: the least important first says its short form, if it has
 * one, and is dropped only when that does not fit either.
 */
export function fit(segments: readonly Segment[], room: number): Segment[] {
  const kept = [...segments]
  const total = () => kept.reduce((sum, s) => sum + segmentWidth(s), 0) + Math.max(0, kept.length - 1) * width(SEPARATOR)

  while (kept.length > 0 && total() > room) {
    const worst = kept.reduce((a, b) => (b.priority >= a.priority ? b : a))
    const at = kept.indexOf(worst)
    if (worst.short) {
      kept[at] = { ...worst, parts: worst.short, short: undefined }
    } else {
      kept.splice(at, 1)
    }
  }

  return kept
}

export function plain(segments: readonly Segment[], separator = PLAIN_SEPARATOR): string {
  return segments.map(s => s.parts.map(p => p.text).join('')).join(separator)
}

/** The width of the drawn line's segments, separators included. */
export function drawnWidth(segments: readonly Segment[]): number {
  return segments.reduce((sum, s) => sum + segmentWidth(s), 0) + Math.max(0, segments.length - 1) * width(SEPARATOR)
}

/**
 * The engine's own hint, kept to what matters: the permission mode's name
 * without its key help, and warnings such as `ctrl+c again to exit`. Key help
 * the person knows by heart goes: `? for shortcuts`, `esc to interrupt`,
 * `← for agents`.
 */
export function condenseHint(hint: string, options: { dropArtifacts?: boolean } = {}): string {
  return (
    hint
      // The engine's artifacts pill ("⧉2", or "⧉ <title>"), when the line draws its own.
      .replace(options.dropArtifacts ? /⧉[^·]*/g : /$^/g, '')
      .replace(/\s*\((?:shift\+tab|⇧⇥)[^)]*\)/gi, '')
      .replace(/\s+mode on\b/gi, '')
      .replace(/\?\s*for shortcuts/gi, '')
      .replace(/\besc to interrupt\b/gi, '')
      .replace(/←\s*for agents/gi, '')
      .replace(/(\s*·\s*){2,}/g, ' · ')
      .replace(/^\s*·\s*|\s*·\s*$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      // Nothing but separators left: nothing.
      .replace(/^[\s·•|]*$/, '')
  )
}

/**
 * Cells the engine takes on the hint's row before this tree: its indent, the mode label
 * ("⏵⏵ auto mode on") and the " · " after it. The default mode draws no label; an unknown one is
 * given room for a long label, so the line falls short of the edge rather than past it.
 */
export function rowLead(mode: string | undefined): number {
  const labels: Record<string, string> = {
    auto: '⏵⏵ auto mode on',
    acceptEdits: '⏵⏵ accept edits on',
    plan: '⏸ plan mode on',
    bypassPermissions: '⏵⏵ bypass permissions on',
  }
  if (mode === 'default') return 2
  const label = mode === undefined ? undefined : labels[mode]
  return 2 + (label === undefined ? 24 : width(label)) + 3
}
