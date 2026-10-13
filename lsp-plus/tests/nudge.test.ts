import { describe, expect, test } from 'claude-code/testing'

import { codeHits, definitionAt, nudge, symbolSearch, usesAsCode } from '../hooks/nudge'

describe('a grep for a code symbol', () => {
  test('the searches Opus ran in the benchmark count', () => {
    expect(symbolSearch('grep -rnw format_filename src tests docs')).toEqual({ name: 'format_filename', kind: 'uses' })
    expect(symbolSearch('grep -rn "echo(" src/click --include=*.py | grep -v def')).toEqual({ name: 'echo', kind: 'uses' })
    expect(symbolSearch("rg -n '\\bterm_len\\b' src")).toEqual({ name: 'term_len', kind: 'uses' })
    expect(symbolSearch('grep -rn "def get_default" src/click')).toEqual({ name: 'get_default', kind: 'definition' })
    expect(symbolSearch('git grep -n -e consume_value -- src')).toEqual({ name: 'consume_value', kind: 'uses' })
  })

  test('anywhere in the line, behind xargs, and sed or awk printing matches', () => {
    expect(symbolSearch('cd src && rg -n resolve_color_default')).toEqual({ name: 'resolve_color_default', kind: 'uses' })
    expect(symbolSearch("git ls-files '*.py' | xargs grep -n term_len")).toEqual({ name: 'term_len', kind: 'uses' })
    expect(symbolSearch("find src -name '*.py' | xargs -n 20 grep -n 'def measure_table'")).toEqual({ name: 'measure_table', kind: 'definition' })
    expect(symbolSearch("sed -n '/term_len(/p' src/click/formatting.py")).toEqual({ name: 'term_len', kind: 'uses' })
    expect(symbolSearch("awk '/wrap_text/ {print FILENAME\":\"FNR}' src/click/*.py")).toEqual({ name: 'wrap_text', kind: 'uses' })
    expect(symbolSearch("egrep -rn '\\bshow_help\\b' src")).toEqual({ name: 'show_help', kind: 'uses' })
  })

  test('reading or editing with sed is not a search', () => {
    expect(symbolSearch("sed -n '40,80p' src/click/core.py")).toBeUndefined()
    expect(symbolSearch("sed -i 's/format_filename/display_filename/g' src/click/utils.py")).toBeUndefined()
    expect(symbolSearch("awk '{print $1}' log.txt")).toBeUndefined()
  })

  test('text, alternations and other commands do not', () => {
    expect(symbolSearch('grep -rn "import|echo\\(" src')).toBeUndefined()
    expect(symbolSearch('grep -rn "could not open file" src')).toBeUndefined()
    expect(symbolSearch('ls src | grep click')).toBeUndefined()
    expect(symbolSearch('python -m pytest -q')).toBeUndefined()
    expect(symbolSearch('grep -c TODO notes.md')).toEqual({ name: 'TODO', kind: 'uses' })
  })
})

describe('the note', () => {
  const out = 'src/click/utils.py:442:def format_filename(\nsrc/click/types.py:20:from .utils import format_filename\ndocs/utils.md:255:the format_filename function'

  test('hits count only in files a language server reads; the definition gives the exact place', () => {
    const hits = codeHits(out)
    expect(hits.map(h => h.path)).toEqual(['src/click/utils.py', 'src/click/types.py'])
    expect(definitionAt(hits, 'format_filename')).toEqual({ path: 'src/click/utils.py', line: 442, character: 5 })
    expect(codeHits('docs/utils.md:3:format_filename')).toEqual([])
  })

  test('a name met only in strings or comments is no symbol', () => {
    expect(usesAsCode('    if v.get("kind") == "lastenheft" and x:', 'lastenheft')).toBe(false)
    expect(usesAsCode("    mod = HERE / 'mod' / 'lastenheft'  # the copy", 'lastenheft')).toBe(false)
    expect(usesAsCode('x = 1  # see lastenheft', 'lastenheft')).toBe(false)
    expect(usesAsCode('def format_filename(', 'format_filename')).toBe(true)
    expect(usesAsCode('    return format_filename(value)  # "format_filename"', 'format_filename')).toBe(true)
  })

  test('the exact call, what grep is still needed for; shorter the next time', () => {
    const at = { path: 'src/click/utils.py', line: 442, character: 5 }
    expect(nudge({ name: 'format_filename', kind: 'uses' }, at, false)).toBe(
      '`format_filename` is a code symbol in files a language server covers: LSP findReferences on src/click/utils.py:442:5 lists exactly its uses in the code, without comments, strings or namesakes, and incomingCalls there lists the functions that call it. The server does not see strings, dynamic uses or most docs, so for a rename or a complete sweep keep the grep for those.',
    )
    expect(nudge({ name: 'echo', kind: 'uses' }, undefined, true)).toBe('`echo`: LSP workspaceSymbol with query "echo" gives its exact code uses; grep stays needed for strings, docs and dynamic uses.')
  })

  test('with run_cell loaded, the one-step call there too', () => {
    const at = { path: 'src/click/utils.py', line: 442, character: 5 }
    const full = nudge({ name: 'format_filename', kind: 'uses' }, at, false, {})
    expect(full.includes("In run_cell, refs('src/click/utils.py', 'format_filename', { line: 442 }) asks the same in one step")).toBe(true)
    expect(full.includes('rename(path, name, newName)')).toBe(true)
    expect(nudge({ name: 'echo', kind: 'uses' }, undefined, true, { file: 'src/click/core.py' })).toBe(
      "`echo`: LSP workspaceSymbol with query \"echo\" (or refs('src/click/core.py', 'echo') in run_cell) gives its exact code uses; grep stays needed for strings, docs and dynamic uses.",
    )
    expect(nudge({ name: 'echo', kind: 'uses' }, undefined, false, {}).includes('run_cell')).toBe(false)
  })
})

const GREP = 'src/click/utils.py:442:def format_filename(\nsrc/click/types.py:1013:                f"{format_filename(value)}"\n'

test('by default a symbol grep gets no nudge: in 45 benchmark notes Claude never acted on one', { options: { answer: false } }, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: GREP, stderr: '', interrupted: false }, text: GREP }))
  const r = await $.tool.call({ tool: 'Bash', command: 'grep -rn format_filename src' })
  expect(r.context ?? []).toEqual([])
})

for (const [loaded, expected] of [
  [true, true],
  [false, false],
] as const) {
  test(`a symbol grep's note names run_cell only where cells is loaded (${loaded})`, { options: { nudge: true } }, async ($, on) => {
    on('tool.list', () => ({ value: loaded ? [{ name: 'mcp__cells__run_cell', description: 'Run a cell', mcp: true }] : [] }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: GREP, stderr: '', interrupted: false }, text: GREP }))
    const r = await $.tool.call({ tool: 'Bash', command: 'grep -rn format_filename src' })
    const notes = r.context ?? []
    expect(notes.some(n => n.includes('LSP findReferences on src/click/utils.py:442:5'))).toBe(true)
    expect(notes.some(n => n.includes("refs('src/click/utils.py', 'format_filename', { line: 442 })"))).toBe(expected)
  })
}
