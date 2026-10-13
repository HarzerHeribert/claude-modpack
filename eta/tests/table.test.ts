import { describe, expect, test } from 'claude-code/testing'

import { BEAT_MS, cell, layout, table } from '../hooks/table'
import type { Row } from '../hooks/table'
import type { Job } from '../types'

const MIN = 60_000
const NOW = 100 * MIN
const TZ = 120
const CLOSED = { seen: [] as string[] }

function job(over: Partial<Job> = {}): Job {
  return {
    id: 'j', label: 'job', source: 'claude', startedAt: NOW - 40 * MIN, offset: 0, carry: '', done: 0,
    samples: [[NOW - 40 * MIN, 0], [NOW - 20 * MIN, 0.25], [NOW, 0.5]], frac: 0.5, status: 'running', ...over,
  }
}

const text = (r: Row) => r.parts.map(p => p.text).join('')
const GAUGE = /[━╸─]/

describe('columns', () => {
  test('every running row starts its gauge, percent and ETA in the same column', () => {
    const rows = table(
      [job({ id: 'a', label: 'short' }), job({ id: 'b', label: 'a much longer job name', frac: 0.2, samples: [[NOW - 40 * MIN, 0], [NOW, 0.2]] })],
      NOW, TZ, 140, CLOSED,
    )
    const [a, b] = rows.map(text) as [string, string]
    expect(a.search(GAUGE)).toBe(b.search(GAUGE))
    expect(a.indexOf('%')).toBe(b.indexOf('%'))
    // Times sit in one column; "in …" is right-aligned, so its ends line up.
    expect(a.search(/\d\d:\d\d/)).toBe(b.search(/\d\d:\d\d/))
    const end = (s: string) => { const m = / in \S+/.exec(s); return m ? m.index + m[0].length : -1 }
    expect(end(a)).toBe(end(b))
  })

  test('the soonest ETA comes first', () => {
    const rows = table(
      [job({ id: 'slow', label: 'slow', frac: 0.1, samples: [[NOW - 40 * MIN, 0], [NOW, 0.1]] }), job({ id: 'fast', label: 'fast' })],
      NOW, TZ, 140, CLOSED,
    )
    expect(rows.map(r => r.key)).toEqual(['fast', 'slow'])
  })

  test('narrowing drops the range, shrinks the gauge, drops done/total, then "in …", then cuts the name', () => {
    const w = { count: 5, at: 5, inn: 7, range: 11, note: 0 }
    expect(layout(20, w, 140)).toEqual({ name: 20, cells: 20, count: true, inn: true, range: true, note: true })
    expect(layout(20, w, 80)).toMatchObject({ cells: 20, range: false, count: true })
    expect(layout(20, w, 64)).toMatchObject({ cells: 12, count: false, inn: true })
    expect(layout(20, w, 50)).toMatchObject({ cells: 12, count: false, inn: false })
    expect(layout(20, w, 40)).toMatchObject({ cells: 6, name: 16 })
  })

  test('columns hold still while their values change length', () => {
    const soon = job({ id: 'a', label: 'a', samples: [[NOW - 4 * MIN, 0], [NOW, 0.5]] })
    const late = job({ id: 'b', label: 'a', samples: [[NOW - 90 * MIN, 0], [NOW, 0.5]] })
    const [x] = table([soon], NOW, TZ, 140, CLOSED).map(text) as [string]
    const [y] = table([late], NOW, TZ, 140, CLOSED).map(text) as [string]
    // "in 4:00" and "in 1h30": the clock column starts in the same place, and so does "in".
    expect(x.search(/\d\d:\d\d/)).toBe(y.search(/\d\d:\d\d/))
    expect(x.indexOf(' in ')).toBeGreaterThan(0)
    expect(x.length).toBe(y.length)
  })

  test('a long name is cut with an ellipsis; a short one is padded', () => {
    expect(cell('a very long job name here', 10)).toBe('a very lo…')
    expect(cell('short', 8)).toBe('short   ')
  })

  test('a job without readable progress says how long it has run', () => {
    const [row] = table([job({ frac: undefined, samples: [], label: 'warm-up' })], NOW, TZ, 140, CLOSED)
    expect(text(row as Row)).toMatch(/warm-up\s+─+\s+—\s+40m so far\s+no progress readable yet$/)
  })
})

describe('the finish', () => {
  test('the beat: a full gauge in green with one glint, and a green check', () => {
    const [row] = table([job({ status: 'completed', frac: 1, endedAt: NOW - BEAT_MS / 2 })], NOW, TZ, 140, CLOSED)
    const parts = (row as Row).parts
    expect(parts[0]).toEqual({ text: '✓', tone: 'good' })
    expect(parts.some(p => p.tone === 'glint')).toBe(true)
    expect(parts.filter(p => /━/.test(p.text)).every(p => p.tone === 'good' || p.tone === 'glint')).toBe(true)
  })

  test('then it leaves the band: what has run is done with', () => {
    const rows = table([job({ id: 'run' }), job({ id: 'done', label: 'smoke run', status: 'completed', endedAt: NOW - 3 * MIN })], NOW, TZ, 140, CLOSED)
    expect(rows.map(r => r.key)).toEqual(['run'])
    expect(table([job({ status: 'killed', endedAt: NOW - 2000 })], NOW, TZ, 140, CLOSED)).toEqual([])
  })

  test('a failure keeps its red row until the person has seen it', () => {
    const failed = job({ id: 'f', label: 'eval batch', status: 'failed', endedAt: NOW - 30 * MIN })
    const [row] = table([failed], NOW, TZ, 140, CLOSED)
    expect((row as Row).parts[0]).toEqual({ text: '✕', tone: 'bad' })
    expect(text(row as Row)).toMatch(/^✕  eval batch\s+failed 03:10 · after 10m$/)
    expect(table([failed], NOW, TZ, 140, { seen: ['f'] })).toEqual([])
  })
})

describe('status line', () => {
  const idle = { frac: undefined, samples: [] as [number, number][] }
  test('a job tracked with status_line shows the last line of its file', () => {
    const rows = table([job({ ...idle, statusLine: true, lastLine: '3 req · $0.02 · read hooks/view.tsx' })], NOW, TZ, 140, CLOSED)
    expect(text(rows[0] as Row)).toContain('3 req · $0.02 · read hooks/view.tsx')
    expect(text(rows[0] as Row)).not.toContain('no progress readable yet')
  })
  test('without status_line the row says what it did', () => {
    const rows = table([job({ ...idle, lastLine: '3 req · $0.02 · read hooks/view.tsx' })], NOW, TZ, 140, CLOSED)
    expect(text(rows[0] as Row)).toContain('no progress readable yet')
  })
})
