import { describe, expect, test } from 'claude-code/testing'

import { tidy } from '../hooks/bridge'
import { anchorIn, isName, parseLocations, parseMentions, planRename } from '../runner/lsp.mjs'

/** Applies a plan's edits the way the Edit tool does: each old text must occur exactly once. */
function apply(text: string, edits: readonly { old: string; new: string }[]): string {
  let out = text
  for (const e of edits) {
    expect(out.split(e.old).length - 1).toBe(1)
    out = out.replace(e.old, e.new)
  }
  return out
}

describe('the places an LSP answer lists', () => {
  test('references: a path heading over Line rows', () => {
    const text = 'Found 4 references across 2 files:\n\nplan.ts:\n  Line 24:17\n\n../tests/plan.test.ts:\n  Line 9:3\n  Line 22:12\n'
    expect(parseLocations(text)).toEqual([
      { file: 'plan.ts', line: 24, col: 17 },
      { file: '../tests/plan.test.ts', line: 9, col: 3 },
      { file: '../tests/plan.test.ts', line: 22, col: 12 },
    ])
  })

  test('a definition, inline', () => {
    expect(parseLocations('Defined in delegate/hooks/plan.ts:24:17')).toEqual([{ file: 'delegate/hooks/plan.ts', line: 24, col: 17 }])
  })

  test('nothing found', () => {
    expect(parseLocations('No definition found. This may occur if the cursor is not on a symbol.')).toEqual([])
  })

  test('paths come back relative to the session, or absolute outside it', () => {
    expect(tidy('/repo/hooks', '../tests/a.ts')).toBe('/repo/tests/a.ts')
    expect(tidy('/repo', 'hooks/../tests/a.ts')).toBe('tests/a.ts')
    expect(tidy('/repo', './a.ts')).toBe('a.ts')
    expect(tidy('/repo', '/usr/lib/x.py')).toBe('/usr/lib/x.py')
  })
})

describe('where to ask about a name', () => {
  const src = ['import { helper } from "./x"', '', 'export function helper2() {}', 'export function helper(a) {', '  return helper2(a)', '}'].join('\n')

  test('its definition, as a whole word', () => {
    expect(anchorIn(src, 'helper')).toEqual({ line: 4, col: 17 })
    expect(anchorIn(src, 'helper2')).toEqual({ line: 3, col: 17 })
  })

  test('on a given line', () => {
    expect(anchorIn(src, 'helper2', 5)).toEqual({ line: 5, col: 10 })
    expect(anchorIn(src, 'helper', 5)).toBeUndefined()
  })

  test('its first use when the file does not define it', () => {
    expect(anchorIn('x = 1\nprint(format_filename(x))\n', 'format_filename')).toEqual({ line: 2, col: 7 })
    expect(anchorIn('nothing here', 'format_filename')).toBeUndefined()
  })

  test('names', () => {
    expect(isName('format_filename')).toBe(true)
    expect(isName('$state')).toBe(true)
    expect(isName('a b')).toBe(false)
    expect(isName('x; rm -rf /')).toBe(false)
  })
})

describe('a rename planned as exact edits', () => {
  test('every place, several on one line, nothing else', () => {
    const text = 'def fmt(x):\n    return x\n\nfmt(fmt(1))\nformat = fmt_other(2)\n'
    const plan = planRename(text, [{ line: 1, col: 5 }, { line: 4, col: 1 }, { line: 4, col: 5 }], 'fmt', 'show')
    expect(plan.changed).toBe(3)
    expect(apply(text, plan.edits)).toBe('def show(x):\n    return x\n\nshow(show(1))\nformat = fmt_other(2)\n')
  })

  test('a place where the name is not skips, and says so', () => {
    const plan = planRename('a = fmt\nb = 2\n', [{ line: 1, col: 5 }, { line: 2, col: 1 }, { line: 9, col: 1 }], 'fmt', 'show')
    expect(plan.changed).toBe(1)
    expect(plan.skipped.map(s => s.line)).toEqual([2, 9])
  })

  test('a part of a longer name is never a place', () => {
    const plan = planRename('fmt_all = 1\n', [{ line: 1, col: 1 }], 'fmt', 'show')
    expect(plan.edits).toEqual([])
    expect(plan.skipped).toHaveLength(1)
  })

  test('repeated lines grow context until the edit is unique', () => {
    const text = 'def a():\n    return fmt(1)\n\ndef b():\n    return fmt(1)\n'
    const plan = planRename(text, [{ line: 2, col: 12 }, { line: 5, col: 12 }], 'fmt', 'show')
    expect(plan.ambiguous).toEqual([])
    expect(apply(text, plan.edits)).toBe('def a():\n    return show(1)\n\ndef b():\n    return show(1)\n')
  })

  test('neighbouring lines become one edit', () => {
    const text = 'x = fmt\ny = fmt\nz = 1\n'
    const plan = planRename(text, [{ line: 1, col: 5 }, { line: 2, col: 5 }], 'fmt', 'show')
    expect(plan.edits).toHaveLength(1)
    expect(apply(text, plan.edits)).toBe('x = show\ny = show\nz = 1\n')
  })

  test('Windows line ends stay as they were', () => {
    const text = 'x = fmt\r\ny = 2\r\n'
    expect(apply(text, planRename(text, [{ line: 1, col: 5 }], 'fmt', 'show').edits)).toBe('x = show\r\ny = 2\r\n')
  })

  test('a line that repeats grows into its neighbour', () => {
    const text = 'fmt\nfmt\n'
    const plan = planRename(text, [{ line: 1, col: 1 }], 'fmt', 'show')
    expect(apply(text, plan.edits)).toBe('show\nfmt\n')
  })
})

test('mentions left after a rename', () => {
  const m = parseMentions('docs/api.rst:12:.. autofunction:: click.fmt\nCHANGES.rst:40:-   ``fmt`` handles bytes.\n')
  expect(m.count).toBe(2)
  expect(m.places[0]).toEqual({ file: 'docs/api.rst', line: 12, text: '.. autofunction:: click.fmt' })
})
