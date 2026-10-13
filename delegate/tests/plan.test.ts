import { describe, expect, test } from 'claude-code/testing'

import {
  anchorOn,
  costUsd,
  describeReach,
  diffStat,
  mainAloneUsd,
  parseFocus,
  parseLocations,
  parseVerdict,
  reviewRoute,
  summarize,
  workerPrompt,
} from '../hooks/plan'
import type { HandOff } from '../hooks/plan'

const CWD = '/repo'

describe('focus', () => {
  test('a place, a name in a file, or a bare name', () => {
    expect(parseFocus('eta/hooks/table.ts:88')).toEqual({ path: 'eta/hooks/table.ts', line: 88 })
    expect(parseFocus('eta/hooks/table.ts#layout')).toEqual({ path: 'eta/hooks/table.ts', name: 'layout' })
    expect(parseFocus('layout')).toEqual({ name: 'layout' })
    expect(parseFocus('Table.layout')).toEqual({ name: 'layout' })
  })

  test('on a line, the defined name is the anchor unless a name is asked for', () => {
    expect(anchorOn('export function layout(name: number, w: Widths) {')).toEqual({ name: 'layout', character: 17 })
    expect(anchorOn('  const rows = table(jobs, now)', 'table')).toEqual({ name: 'table', character: 16 })
    expect(anchorOn('def fold_label(n):')).toEqual({ name: 'fold_label', character: 5 })
  })

  test('an import line anchors on what it imports; keywords are never the anchor', () => {
    expect(anchorOn('from .utils import format_filename as format_filename')).toEqual({ name: 'format_filename', character: 20 })
    expect(anchorOn("import { table } from './table'")).toEqual({ name: 'table', character: 10 })
    expect(anchorOn('    return self.fail(msg)')).toEqual({ name: 'fail', character: 17 })
  })
})

describe('reading the language server', () => {
  test('a path heading over Line rows', () => {
    const text = 'Found 3 references across 2 files:\n\n/repo/eta/hooks/table.ts:\n  Line 88:17\n  Line 120:9\n\n/repo/eta/tests/table.test.ts:\n  Line 46:12'
    expect(parseLocations(text, CWD)).toEqual([
      { path: 'eta/hooks/table.ts', line: 88 },
      { path: 'eta/hooks/table.ts', line: 120 },
      { path: 'eta/tests/table.test.ts', line: 46 },
    ])
  })

  test('path:line:col rows, duplicates once', () => {
    const text = '/repo/a.ts:3:5\n/repo/a.ts:3:9\n  b/c.py:12'
    expect(parseLocations(text, CWD)).toEqual([
      { path: 'a.ts', line: 3 },
      { path: 'b/c.py', line: 12 },
    ])
  })

  test('the reach reads as references, callers and docs', () => {
    const text = describeReach([
      {
        name: 'layout',
        anchor: { name: 'layout', path: 'eta/hooks/table.ts', line: 88, character: 17 },
        refs: [{ path: 'eta/hooks/table.ts', line: 120 }, { path: 'eta/tests/table.test.ts', line: 46 }],
        callers: [{ path: 'eta/hooks/table.ts', line: 200 }],
        docs: ['The docs mention `layout` in 1 place the language server does not index:\n  README.md:42  see `layout()`'],
        via: 'lsp',
      },
    ])
    expect(text).toBe(
      '- `layout` (eta/hooks/table.ts:88): 2 references in 2 files\n  eta/hooks/table.ts:120 · eta/tests/table.test.ts:46\n  called from eta/hooks/table.ts:200\n  The docs mention `layout` in 1 place the language server does not index:\n    README.md:42  see `layout()`',
    )
  })
})

describe('the worker prompt', () => {
  test('explore reads only; edit names the check', () => {
    expect(workerPrompt({ task: 'Find X.', mode: 'explore', reach: '' })).toBe('Find X.\n\nMode: explore. Read only: change no file. Find what the task asks and report it with file:line.')
    expect(workerPrompt({ task: 'Rename X.', mode: 'edit', reach: '- `X`', check: 'npm test' })).toContain('this check will run: `npm test`')
  })
})

describe('cost', () => {
  const worker = { input_tokens: 2_000, output_tokens: 3_000, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 40_000 }

  test('a Haiku worker at list prices', () => {
    // 2k×0.1 + 3k×0.5 + 150k×0.01 + 40k×0.125 = 0.2 + 1.5 + 1.5 + 5 = $8.2 per million → $0.0082
    expect(Math.round(costUsd(worker, 'claude-haiku-5-5') * 1e6)).toBe(8200)
  })

  test('the same ten requests on Opus re-read a 600k context each time', () => {
    // 10×600k×0.2 + 42k×5 + 3k×20 = 1.2M + 0.21M + 0.06M → $1.47
    expect(Math.round(mainAloneUsd({ requests: 10, contextTokens: 600_000, worker, model: 'claude-opus-5-5' }) * 1e6)).toBe(1_470_000)
  })

  test('the fork reviews only evidence worth more than a 60th of the context', () => {
    expect(reviewRoute('auto', 1_500, 30_000)).toBe('inline')
    expect(reviewRoute('auto', 9_000, 600_000)).toBe('inline')
    expect(reviewRoute('auto', 12_000, 600_000)).toBe('fork')
    expect(reviewRoute('inline', 50_000, 600_000)).toBe('inline')
  })
})

describe('evidence', () => {
  test('diff lines counted, headers not', () => {
    expect(diffStat('--- a.ts\n+++ a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n same')).toEqual({ added: 2, removed: 1 })
  })

  test('a verdict is read from the review', () => {
    expect(parseVerdict('VERDICT: fix\n- a.ts:3 off by one')).toBe('fix')
    expect(parseVerdict('looks fine')).toBeUndefined()
  })
})

describe('the log', () => {
  const base: HandOff = {
    at: 0, session: 's', mode: 'edit', model: 'claude-haiku-5-5', reused: false, focus: 1, reachRefs: 4, requests: 8,
    durationMs: 40_000, workerUsd: 0.01, mainAloneUsd: 0.9, contextTokens: 500_000, files: ['a.ts'], added: 10, removed: 2,
    check: { command: 'npm test', exit: 0 }, reworkEdits: 0, outcome: 'answer',
  }

  test('savings, rework and first-time checks', () => {
    const text = summarize([base, { ...base, reworkEdits: 2, check: { command: 'npm test', exit: 1 } }, { ...base, mode: 'explore', reused: true, check: undefined }])
    expect(text).toContain('3 hand-offs (1 explore, 2 edit), 1 on a warm worker.')
    expect(text).toContain('Worker and reviews: $0.03. The same steps on the main model: about $2.70. Saved: about $2.67.')
    expect(text).toContain('Edit work that came back: 1 of 2')
    expect(text).toContain('Checks passed first time: 1 of 2.')
  })
})
