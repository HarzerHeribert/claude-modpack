import { describe, expect, test } from 'claude-code/testing'

import { changedSignatures, signatures } from '../hooks/blast'

describe('what an edit did to a signature', () => {
  test('parameter lists as written, across languages and lines', () => {
    expect(signatures('def resolve_color_default(color: bool | None = None) -> bool | None:')).toEqual(new Map([['resolve_color_default', 'color:bool|None=None']]))
    expect(signatures('func (s *Server) Handle(w http.ResponseWriter,\n\tr *http.Request) {')).toEqual(new Map([['Handle', 'whttp.ResponseWriter,r*http.Request']]))
    expect(signatures('fun <T> List<T>.second(default: T): T')).toEqual(new Map([['second', 'default:T']]))
    expect(signatures('def wrap(text, width=len("x")):')).toEqual(new Map([['wrap', 'text,width=len("x")']]))
  })

  test('changed parameters count; a body edit, a new function or a header cut short does not', () => {
    expect(changedSignatures('def f(color=None):\n    return color', 'def f(*, override=None):\n    return override')).toEqual(['f'])
    expect(changedSignatures('def f(a):\n    return a', 'def f(a):\n    return a + 1')).toEqual([])
    expect(changedSignatures('x = 1', 'def g(a):\n    pass')).toEqual([])
    expect(changedSignatures('def f(a,', 'def f(a, b,')).toEqual([])
  })
})

const BEFORE = 'def resolve_color_default(color: bool | None = None) -> bool | None:'
const AFTER = 'def resolve_color_default(*, override: bool | None = None) -> bool | None:'
const FILE = 'import os\n\n' + AFTER + '\n    return override\n'
const CALLS = 'Found 3 incoming calls:\n\nsrc/click/termui.py:\n  secho (Function) - Line 340 [calls at: 362:13]\n  edit (Function) - Line 570 [calls at: 581:13]\n\nsrc/click/utils.py:\n  echo (Function) - Line 252 [calls at: 342:31]\n'

for (const blast of [true, false]) {
  test(`an edit that changes a function's parameters gets its callers (blast ${blast})`, { options: { blast, drift: false } }, async ($, on) => {
    on('session.cwd', () => ({ value: '/repo' }))
    on('fs.read', () => ({ value: FILE }) as never)
    on('tool.call', { tool: 'Edit' }, () => ({ result: {}, text: 'edited' }) as never)
    const asked: string[] = []
    on('tool.call', { tool: 'LSP' }, (_$, e) => {
      const i = e as unknown as { operation: string; line: number; character: number }
      asked.push(`${i.operation} ${i.line}:${i.character}`)
      return { result: {}, text: CALLS }
    })
    const r = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/click/globals.py', old_string: BEFORE, new_string: AFTER } as never)
    const note = (r.context ?? []).find(n => n.startsWith('`resolve_color_default`'))
    if (!blast) return expect(note).toBeUndefined()
    expect(asked).toEqual(['incomingCalls 3:5'])
    expect(note).toBe("`resolve_color_default`'s parameters changed; per the language server it is called from 3 places in 2 files, which may still pass the old ones:\nsrc/click/termui.py: secho (362), edit (581)\nsrc/click/utils.py: echo (342)")
  })
}
