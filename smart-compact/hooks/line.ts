// smart-compact's segment on the status line: whether the next prompt reads a
// warm cache, so it is cheap, or a cold one. The statusline mod draws it at the
// right edge, where the eye lands; what changes by itself (the countdown, the
// spinner while the mod acts, the blink before it does) is declared so, and the
// line moves it. Without the statusline mod, the same words are the session's
// status text.

import type { SmartCompactCache } from '../types'
import { duration } from './policy'

export type Tone = 'accent' | 'good' | 'text' | 'label' | 'faint' | 'warn' | 'alert'

/** The statusline mod's part shapes: text (that may blink), a countdown, a spinner. */
export type ReadyPart =
  | { text: string; tone: Tone; blink?: { from: number; to: number } }
  | { until: number; tone: Tone; prefix?: string; warnMs?: number }
  | { spin: true; tone: Tone }

export type ReadySegment = { id: string; priority: number; parts: ReadyPart[]; short?: ReadyPart[]; side?: 'start' | 'end' }

export const READY_ID = 'smart-compact:ready'

const text = (t: string, tone: Tone): ReadyPart => ({ text: t, tone })

/**
 * 'ready' while the next prompt reads a warm cache, with what ends that once it will (a lapse, or
 * a compaction within ten minutes); while smart-compact keeps it warm, nothing more. Cold is
 * amber: the next prompt pays to read the whole context again. Undefined before any request.
 */
export function readySegment(cache: SmartCompactCache, m: { now: number; isWorking: boolean }): ReadySegment | undefined {
  const of = (parts: ReadyPart[], short?: ReadyPart[]): ReadySegment => ({ id: READY_ID, priority: 0, side: 'end', parts, ...(short ? { short } : {}) })
  // Past its edge a warm cache is cold, whether or not the tick has said so.
  const isExpired = cache.warmAt !== undefined && cache.warmAt + cache.ttlMs <= m.now

  if (cache.isPaused) return of([text('◌', 'faint'), text(' paused', 'label')])
  if (cache.phase === 'acting') return of([{ spin: true, tone: 'accent' }, text(cache.plan === 'compact' ? ' compacting' : ' keeping warm', 'label')])
  if (cache.phase === 'compacted') return of([text('◌', 'accent'), text(' compacted', 'label')])
  if (cache.phase === 'cold' || (cache.phase === 'warm' && !m.isWorking && isExpired)) return of([text('○', 'warn'), text(' cold', 'warn')])
  if (cache.phase === 'warm' && m.isWorking) return of([text('●', 'good')])
  if (cache.phase !== 'warm' || cache.warmAt === undefined) return undefined

  const edge = cache.warmAt + cache.ttlMs
  // A blink in the last twenty seconds before the mod acts.
  const dot: ReadyPart = cache.actAt === undefined ? text('●', 'good') : { text: '●', tone: 'good', blink: { from: cache.actAt - 20_000, to: cache.actAt } }
  const short = [dot, text(' ready', 'label')]

  if (cache.plan === 'compact' && cache.actAt !== undefined && cache.actAt - m.now < 10 * 60_000) {
    return of([...short, { until: cache.actAt, prefix: ' · compacts in ', tone: 'label' }], short)
  }
  if (cache.plan !== 'keepalive' && cache.plan !== 'compact') {
    return of([...short, { until: edge, prefix: ' · cold in ', tone: 'label', warnMs: 5 * 60_000 }], short)
  }
  return of(short)
}

/** The segment as one plain string at 'now': what the session's status text says without the statusline mod. */
export function plainText(segment: ReadySegment, now: number): string {
  return segment.parts.map(p => ('spin' in p ? '◐' : 'until' in p ? (p.prefix ?? '') + duration(p.until - now) : p.text)).join('')
}
