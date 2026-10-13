import { describe, expect, test } from 'claude-code/testing'

import { absolute, exitCode, lines, report } from '../hooks/bridge'
import type { CallRecord } from '../hooks/bridge'
import { parseReport, scanner, splitLocation, stateOf, toneOf } from '../hooks/view'
import { cut, fold } from '../runner/fold.mjs'

describe('fold', () => {
  test('leaves short output alone', () => {
    expect(fold('ok\n'.repeat(10))).toBe('ok\n'.repeat(10))
  })

  test('folds passing tests and build chatter, keeps every failure', () => {
    const noise = [
      ...Array.from({ length: 300 }, (_, i) => `test suite::case_${i} ... ok`),
      ...Array.from({ length: 200 }, (_, i) => `   Compiling crate-${i} v0.1.0`),
      'test suite::broken ... FAILED',
      "thread 'suite::broken' panicked at src/lib.rs:9: assertion failed",
      'test result: FAILED. 300 passed; 1 failed',
    ].join('\n')
    const folded = fold(noise)
    expect(folded.startsWith('[folded 300 passing-test lines, 200 build lines')).toBe(true)
    expect(folded.includes('test suite::broken ... FAILED')).toBe(true)
    expect(folded.includes('panicked at src/lib.rs:9')).toBe(true)
    expect(folded.length < noise.length / 10).toBe(true)
  })

  test('folds a run of repeated lines to the first', () => {
    const text = `start\n${'waiting for lock\n'.repeat(900)}done`
    const folded = fold(text)
    expect(folded.includes('899 repeated lines')).toBe(true)
    expect(folded.split('\n').filter(l => l === 'waiting for lock')).toHaveLength(1)
  })

  test('cut keeps head and tail and says what it left out', () => {
    const text = 'a'.repeat(5000) + 'TAIL'
    const short = cut(text, 1000)
    expect(short.length < 1100).toBe(true)
    expect(short.endsWith('TAIL')).toBe(true)
    expect(short.includes('chars cut')).toBe(true)
  })
})

describe('the runner protocol', () => {
  test('splits messages and keeps a partial line for later', () => {
    const first = lines('\u0001cell {"need":{"n":1,"tool":"Bash","input":{"command":"ls"}}}\nnoise\n\u0001cell {"do')
    expect(first.messages).toHaveLength(1)
    expect(first.rest).toBe('\u0001cell {"do')
    const second = lines(first.rest + 'ne":{"output":"x"}}\n')
    expect(second.messages).toEqual([{ done: { output: 'x' } }])
  })

  test('paths and exit codes', () => {
    expect(absolute('/repo', 'src/a.py')).toBe('/repo/src/a.py')
    expect(absolute('/repo/', './a.py')).toBe('/repo/a.py')
    expect(absolute('/repo', '/etc/hosts')).toBe('/etc/hosts')
    expect(exitCode('Exit code 101\nerror[E0425]')).toBe(101)
    expect(exitCode('no code here')).toBe(1)
  })
})

describe('the report', () => {
  const calls: CallRecord[] = [
    { tool: 'Bash', label: 'git status --short', ok: true, refused: false, ms: 120 },
    { tool: 'Bash', label: 'cargo test -q', ok: false, refused: false, ms: 13_900, note: 'exit 101' },
    { tool: 'Edit', label: '/repo/src/lib.rs', ok: false, refused: true, ms: 40, note: 'refused' },
  ]
  const text = report(calls, { output: 'two tests failed', log: '', previews: 'h.t  string len=9  "x"', handles: '{}', dropped: [] }, 14_300, '')

  test('lists every call with its mark, then the sections', () => {
    expect(text.split('\n')[0]).toBe('cell · 3 calls · 2 failed · 14 s')
    expect(text.includes('  ✓ sh    git status --short  0.1 s')).toBe(true)
    expect(text.includes('  ✕ sh    cargo test -q  exit 101  14 s')).toBe(true)
    expect(text.includes('  ⊘ edit  /repo/src/lib.rs  refused  0.0 s')).toBe(true)
    expect(text.includes('## Output\ntwo tests failed')).toBe(true)
    expect(text.includes('## Handles')).toBe(true)
  })

  test('the transcript row rebuilds the same calls from it', () => {
    const parsed = parseReport(text)
    expect(parsed.state).toBe('failed')
    expect(parsed.calls.map(c => [c.tool, c.state, c.note])).toEqual([
      ['Bash', 'ok', undefined],
      ['Bash', 'failed', 'exit 101'],
      ['Edit', 'refused', 'refused'],
    ])
  })

  test("other plugins' notes on the calls come once, in their own section", () => {
    const done = { output: 'x', log: '', previews: '', handles: '{}', dropped: [] }
    expect(report(calls.slice(0, 1), done, 100, '', ['lsp-plus: docs/api.md still uses fmt']).includes('## Output\nx\n## Notes\nlsp-plus: docs/api.md still uses fmt')).toBe(true)
    expect(report(calls.slice(0, 1), done, 100, '').includes('## Notes')).toBe(false)
  })

  test('a runner that died says so', () => {
    expect(report([], undefined, 50, 'node: bad option').includes('the runner ended without a result')).toBe(true)
  })
})

test("a cell's state comes from its own record, running until it has ended", () => {
  const call = { tool: 'Bash', label: 'npm test', startedAt: 1 }
  expect(stateOf({ startedAt: 1, calls: [{ ...call, state: 'running' }] }, false)).toBe('running')
  expect(stateOf({ startedAt: 1, endedAt: 9, calls: [{ ...call, state: 'ok' }] }, false)).toBe('ran')
  expect(stateOf({ startedAt: 1, endedAt: 9, calls: [{ ...call, state: 'failed' }] }, false)).toBe('failed')
  expect(stateOf({ startedAt: 1, endedAt: 9, calls: [], error: 'boom' }, false)).toBe('threw')
})

test("a result's lines are coloured by what they say", () => {
  const lines = [
    "tests/pure.test.ts(103,54): error TS2322: Type '{ state: \"ok\" }' is not assignable",
    "  Types of property 'tool' are incompatible.",
    ' 51 pass',
    ' 0 fail',
    '✔ Validation passed',
    'warning: unused variable',
    'plain text',
  ]
  const tones: (string | undefined)[] = []
  let tone: ReturnType<typeof toneOf>
  for (const l of lines) tones.push((tone = toneOf(l, tone)))
  expect(tones).toEqual(['error', 'error', 'success', 'success', 'success', 'warning', undefined])
  expect(toneOf(' 3 failed, 48 passed', undefined)).toBe('error')
})

test('a line that starts with a place splits off that place', () => {
  expect(splitLocation('tests/a.test.ts(103,54): error TS2322')).toEqual({ indent: '', at: 'tests/a.test.ts(103,54):', rest: ' error TS2322' })
  expect(splitLocation('  src/click/utils.py:442:5: E501 line too long')?.at).toBe('src/click/utils.py:442:5:')
  expect(splitLocation('51 pass')).toBeUndefined()
})

test('the scanner sweeps out and back in a fixed width', () => {
  const frames = Array.from({ length: 17 }, (_, f) => scanner(f))
  for (const s of frames) expect((s.before + s.head + s.after).length).toBe(10)
  expect(frames[0]?.before).toBe('')
  expect(frames[8]?.after).toBe('')
  expect(frames[16]?.before).toBe('')
})
