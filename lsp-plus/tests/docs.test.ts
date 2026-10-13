import { describe, expect, test } from 'claude-code/testing'

import { codeSpanNames, definedNames, editedNames, fencedLines, identifierAt, mentionsAsCode, parseGrep } from '../hooks/docs'

describe('the name an LSP call is about', () => {
  test('the identifier under the cursor, or the next one to its right', () => {
    expect(identifierAt('export function layout(name: number) {', 17)).toBe('layout')
    expect(identifierAt('export function layout(name: number) {', 22)).toBe('layout')
    expect(identifierAt('  return table(jobs)', 1)).toBe('return')
    expect(identifierAt('    ', 2)).toBeUndefined()
    expect(identifierAt('x = 42', 5)).toBeUndefined()
  })
})

describe('what an edit removed', () => {
  test('definitions across languages', () => {
    const names = definedNames('def fold_label(x):\nfn parse_row() {}\nexport const BEAT_MS = 1\nfunc (t *T) Render() {}\nclass Table {}')
    expect([...names].sort()).toEqual(['BEAT_MS', 'Render', 'Table', 'fold_label', 'parse_row'])
  })

  test('a rename is one name gone and one name new; a kept name is neither', () => {
    expect(editedNames('function foldLabel(n) { return n }', 'function foldTitle(n) { return n }')).toEqual({ removed: ['foldLabel'], added: ['foldTitle'] })
    expect(editedNames('const LIMIT = 3', 'const LIMIT = 4')).toEqual({ removed: [], added: [] })
    // Still mentioned after the edit (called, not defined): not removed.
    expect(editedNames('function trimEnd(s) {}', 'trimEnd(s)')).toEqual({ removed: [], added: [] })
  })
})

describe('mentions in the docs', () => {
  test('a code mention counts; the same word in prose does not', () => {
    expect(mentionsAsCode('Call `layout()` to size the columns.', 'layout', false)).toBe(true)
    expect(mentionsAsCode('The table.layout step comes first.', 'layout', false)).toBe(true)
    expect(mentionsAsCode('The layout of the page is simple.', 'layout', false)).toBe(false)
    expect(mentionsAsCode('The layout of the page is simple.', 'layout', true)).toBe(true)
    expect(mentionsAsCode('foldLabel shrinks the label', 'foldLabel', false)).toBe(true)
    expect(mentionsAsCode('foldLabels shrinks the label', 'foldLabel', false)).toBe(false)
  })

  test('fenced blocks are known by line', () => {
    expect([...fencedLines('a\n```ts\nx()\ny()\n```\nb')]).toEqual([3, 4])
  })

  test('git grep rows parse, colons in the text kept', () => {
    expect(parseGrep('README.md:42:see `a:b`\ndocs/x.md:7:ok')).toEqual([
      { path: 'README.md', line: 42, text: 'see `a:b`' },
      { path: 'docs/x.md', line: 7, text: 'ok' },
    ])
  })

  test('code spans that name a symbol, not commands or words', () => {
    const doc = 'Use `foldLabel()` and `table.layout`; run `claude plugin test`; set `effortLevel`; `true`; `layout`.'
    expect(codeSpanNames(doc).map(n => n.name)).toEqual(['foldLabel', 'layout', 'effortLevel'])
  })
})
