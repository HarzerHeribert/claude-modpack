import { describe, expect, test } from 'claude-code/testing'

import { candidatePaths, groupHits, isEmpty, normalize, parseBash, parseCommand, parseHits, parseOutput, parseToolInput } from '../hooks/search'

describe('the command', () => {
  test('a plain search: pattern, paths, flags', () => {
    expect(parseCommand('grep -rn "def echo" src/click')).toEqual({ tool: 'grep', pattern: 'def echo', operands: ['src/click'], ignoreCase: false, fixed: false, headLimit: undefined })
    expect(parseCommand("rg -n -i 'a|b' src tests")).toMatchObject({ tool: 'rg', pattern: 'a|b', operands: ['src', 'tests'], ignoreCase: true })
    expect(parseCommand('git grep -n -e consume_value -- src')).toMatchObject({ tool: 'git grep', pattern: 'consume_value', operands: ['src'] })
    expect(parseCommand('grep -n echo src/click/utils.py 2>/dev/null')).toMatchObject({ pattern: 'echo', operands: ['src/click/utils.py'] })
    expect(parseCommand('fgrep -rnF "a.b" .')).toMatchObject({ fixed: true })
  })
  test('piped into head, with its limit', () => {
    expect(parseCommand('grep -rn foo src | head -20')).toMatchObject({ headLimit: 20 })
    expect(parseCommand('grep -rn foo src | head -n 5')).toMatchObject({ headLimit: 5 })
    expect(parseCommand('grep -rn foo src | head')).toMatchObject({ headLimit: 10 })
  })
  test('a pipe into anything else, chains, context, counts and list modes are skipped', () => {
    for (const c of [
      'grep -rn foo src | sort',
      'grep -rn foo src | head -5 | wc -l',
      'cd src && grep -n foo a.py',
      'grep -rn foo src; ls',
      'grep -rn -C 3 foo src',
      'grep -rn -A3 foo src',
      'grep -rn --context=2 foo src',
      'grep -rl foo src',
      'grep -c foo a.py',
      'grep -rn --count foo src',
      'rg --files-with-matches foo',
      'rg -l foo',
      'ls src | grep foo',
      'grep foo',
      'grep -rn "$(cat x)" src',
      'python x.py',
    ]) expect(parseCommand(c)).toBeUndefined()
  })
  test('the Grep tool: content mode with line numbers only', () => {
    expect(parseToolInput({ pattern: 'foo', path: 'src', output_mode: 'content', '-i': true })).toMatchObject({ tool: 'Grep', pattern: 'foo', operands: ['src'], ignoreCase: true })
    expect(parseToolInput({ pattern: 'foo' })).toBeUndefined()
    expect(parseToolInput({ pattern: 'foo', output_mode: 'files_with_matches' })).toBeUndefined()
    expect(parseToolInput({ pattern: 'foo', output_mode: 'content', '-n': false })).toBeUndefined()
    expect(parseToolInput({ pattern: 'foo', output_mode: 'content', '-C': 2 })).toBeUndefined()
  })
})

describe('the output', () => {
  test('both shapes of a hit row', () => {
    expect(parseHits('src/a.py:12:def echo(\nsrc/b.py:3:echo()', ['src'])).toEqual([
      { path: 'src/a.py', line: 12, text: 'def echo(' },
      { path: 'src/b.py', line: 3, text: 'echo()' },
    ])
    expect(parseHits('12:def echo(\n40:  echo()\n', ['src/a.py'])).toEqual([
      { line: 12, text: 'def echo(' },
      { line: 40, text: '  echo()' },
    ])
  })
  test('anything else in the output is no hit list', () => {
    expect(parseHits('Binary file a.bin matches', ['src'])).toBeUndefined()
    expect(parseHits('a.py:1:x\n--\na.py:9:y', ['src'])).toBeUndefined()
    expect(parseHits('a.py:1:x\n[Showing results with pagination = limit: 250]', ['src'])).toBeUndefined()
  })
  test('empty output', () => {
    for (const t of ['', '\n', 'Exit code 1', 'No matches found', '(Bash completed with no output)']) expect(isEmpty(t)).toBe(true)
    expect(isEmpty('a.py:1:x')).toBe(false)
  })
})

describe('paths and groups', () => {
  test('paths', () => {
    expect(normalize('./src/../a.py', '/r')).toBe('/r/a.py')
    expect(normalize('/x/y', '/r')).toBe('/x/y')
  })
  test('hits per file, in the order listed, each line once', () => {
    const g = groupHits([{ path: 'b.py', line: 2, text: 'x' }, { path: 'a.py', line: 1, text: 'x' }, { path: 'b.py', line: 2, text: 'x' }, { line: 9, text: 'y' }], ['c.py'])
    expect(g.map(x => [x.path, x.lines])).toEqual([['b.py', [2]], ['a.py', [1]], ['c.py', [9]]])
  })
})

describe('a command line', () => {
  test('cd prefix, chains, pipes and echo are read', () => {
    const b = parseBash('cd /run && grep -rn "X" src/click | head -20; echo ---; grep -n "Y" src/click/core.py | sed -n 1,40p')
    expect(b?.cd).toBe('/run')
    expect(b?.searches.map(s => s.pattern)).toEqual(['X', 'Y'])
    expect(b?.searches[0]?.headLimit).toBe(20)
    expect(b?.searches[1]?.headLimit).toBeUndefined()
    expect(parseBash('grep -rn -C2 x src || true')?.searches).toHaveLength(1)
    expect(parseBash('grep -rn x src 2> /dev/null')?.searches).toHaveLength(1)
  })
  test('no search, writes and unknown cds are rejected', () => {
    for (const c of ['ls src', 'cat a.py | grep x', 'grep -rn x src > o', 'grep -rn x src >> o', 'grep x a.py | tee o', 'sed -i s/a/b/ a.py; grep x a.py', 'rm a; grep x a.py', 'mv a b && grep x b', 'grep -rn x src; cd src; ls', 'cd ~ && grep -rn x', 'echo $(date); grep x a.py', 'grep -f pats src'])
      expect(parseBash(c)).toBeUndefined()
  })
})

describe('the rows of an output', () => {
  const exists = (p: string) => ['src/a.py', 'src/b.py'].includes(p)
  test('hit rows, context rows, separators, junk and missing files', () => {
    const out = 'src/a.py-4-c\nsrc/a.py:5:x\n--\nsrc/b.py:9:x\nnope.py:1:x\n---\nsrc/b.py:20:x'
    const p = parseOutput(out, exists)
    expect(p.hits.map(h => `${h.path}:${h.line}`)).toEqual(['src/a.py:5', 'src/b.py:9', 'src/b.py:20'])
    expect([...p.covered]).toEqual(['src/a.py:5'])
    expect(p.cut).toBe(false)
  })
  test('line:text rows need the single file', () => {
    expect(parseOutput('5:x\n6-y', exists).hits).toEqual([])
    expect(parseOutput('5:x\n6-y\n9:z', exists, 'src/a.py').hits.map(h => h.line)).toEqual([5, 9])
    expect(parseOutput('5:x\n6-y', exists, './src/a.py').covered.size).toBe(1)
  })
  test('a cut is noticed; candidates are the paths rows start with', () => {
    expect(parseOutput('src/a.py:1:x\n... [3 lines truncated] ...', exists).cut).toBe(true)
    expect(candidatePaths('src/a.py:1:x\n./b.py-2-y\njunk').sort()).toEqual(['b.py', 'src/a.py'])
  })
})
