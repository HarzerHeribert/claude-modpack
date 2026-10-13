import { describe, expect, test } from 'claude-code/testing'

import { answerNote, looksCold, parseIncoming, parseOutline, parseReferences, qualified } from '../hooks/answer'

const INCOMING = `Found 3 incoming calls:

src/click/exceptions.py:
  show (Function) - Line 57 [calls at: 61:9]

src/click/core.py:
  invoke (Function) - Line 1401 [calls at: 1412:13]
  main (Function) - Line 1484 [calls at: 1564:17, 1594:13]
`

const REFERENCES = `Found 4 references across 2 files:

src/click/utils.py:
  Line 252:5

src/click/core.py:
  Line 47:20
  Line 1412:13
  Line 1564:17
`

const OUTLINE = `Document symbols:
Command (Class) - Line 900
  invoke (Method) - Line 1401
    ctx (Variable) - Line 1402
  main (Method) - Line 1484
helper (Function) - Line 2000
`

describe('reading the server', () => {
  test('incoming calls: each caller with the lines it calls from', () => {
    expect(parseIncoming(INCOMING)).toEqual([
      { file: 'src/click/exceptions.py', name: 'show', kind: 'Function', line: 57, at: [61] },
      { file: 'src/click/core.py', name: 'invoke', kind: 'Function', line: 1401, at: [1412] },
      { file: 'src/click/core.py', name: 'main', kind: 'Function', line: 1484, at: [1564, 1594] },
    ])
  })

  test('references by file, and the single-reference form', () => {
    expect(parseReferences(REFERENCES).map(r => `${r.file}:${r.line}`)).toEqual(['src/click/utils.py:252', 'src/click/core.py:47', 'src/click/core.py:1412', 'src/click/core.py:1564'])
    expect(parseReferences('Found 1 reference:\n  src/click/utils.py:252:5')).toEqual([{ file: 'src/click/utils.py', line: 252 }])
  })

  test('a caller is named as it is nested: Class.method', () => {
    const o = parseOutline(OUTLINE)
    expect(qualified(o, 'invoke', 1401)).toBe('Command.invoke')
    expect(qualified(o, 'helper', 2000)).toBe('helper')
    expect(qualified(o, 'gone', 1)).toBe('gone')
  })
})

describe('the note', () => {
  test('callers by file, qualified, with their call lines', () => {
    const callers = parseIncoming(INCOMING).map(c => ({ ...c, qualified: c.name === 'show' ? 'ClickException.show' : `Command.${c.name}` }))
    const note = answerNote('echo', { callers })
    expect(note.startsWith('`echo` per the language server: called from 3 functions in 2 files')).toBe(true)
    expect(note).toContain('src/click/core.py: Command.invoke (1412), Command.main (1564, 1594)')
    expect(note).toContain('strings, comments, docs and namesakes are in the grep above')
  })

  test('a server that knows only the file it was asked about is still indexing', () => {
    expect(looksCold(['src/click/utils.py'], ['src/click/utils.py', 'src/click/core.py'], 'src/click/utils.py')).toBe(true)
    expect(looksCold(['src/click/utils.py', 'src/click/core.py'], ['src/click/core.py'], 'src/click/utils.py')).toBe(false)
    expect(looksCold(['src/click/utils.py'], ['src/click/utils.py'], 'src/click/utils.py')).toBe(false)
  })
})
