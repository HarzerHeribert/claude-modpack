import { describe, expect, test } from 'claude-code/testing'

import { MAP_HEAD, enclosing, hitMap, mapRow, outlinable, outline } from '../hooks/outline'

const PY = [
  'import os',
  '',
  '',
  'class Command:',
  '    """Doc."""',
  '',
  '    def __init__(self, name):',
  '        self.name = name',
  '',
  '    def invoke(self, ctx):',
  '        echo("x")',
  '        return 1',
  '',
  '    @property',
  '    def help(',
  '        self,',
  '        width: int = 80,',
  '    ) -> str:',
  '        def inner():',
  '            echo("y")',
  '        return ""',
  '',
  '',
  'async def echo(message=None):',
  '    print(message)',
  '',
  '',
  'TOP = echo("z")',
  '',
].join('\n')

const TS = [
  "import { x } from './x'",
  '',
  'export function parse(text: string): number {',
  '  if (text) {',
  '    return 1',
  '  }',
  '  return 0',
  '}',
  '',
  'export class Parser {',
  '  private n = 0',
  '',
  '  async run(input: string): Promise<void> {',
  '    for (const c of input) {',
  "      this.n++ // a } in a comment",
  '    }',
  '  }',
  '',
  '  get size(): number {',
  "    return this.n + '}'.length",
  '  }',
  '}',
  '',
  'export const helper = (a: number) => {',
  '  return a + 1',
  '}',
  '',
].join('\n')

const ranges = (path: string, text: string) => outline(path, text)?.map(d => `${d.qualified} ${d.start}-${d.end}`)

describe('outlines', () => {
  test('Python: classes, methods, nested functions, a signature over several lines', () => {
    expect(ranges('src/m.py', PY)).toEqual(['Command 4-21', 'Command.__init__ 7-8', 'Command.invoke 10-12', 'Command.help 15-21', 'Command.help.inner 19-20', 'echo 24-25'])
  })
  test('Python: one-line bodies (overload stubs, class A: pass) end on their line', () => {
    const stubs = ['@t.overload', 'def get(x: int) -> int: ...', '', '', '@t.overload', 'def get(x: str) -> str: ...', '', '', 'def get(x):', '    return x', '', 'class A: pass', ''].join('\n')
    expect(ranges('o.py', stubs)).toEqual(['get 2-2', 'get 6-6', 'get 9-10', 'A 12-12'])
    expect(ranges('o.py', 'def f(key=lambda v: v, d={"a": 1}):\n    return key\n')).toEqual(['f 1-2'])
  })
  test('brace languages: functions, classes and their methods, arrow constants; no if or for', () => {
    expect(ranges('src/p.ts', TS)).toEqual(['parse 3-8', 'Parser 10-22', 'Parser.run 13-17', 'Parser.size 19-21', 'helper 24-26'])
    expect(ranges('a.go', 'func (s *Server) Handle(w int) {\n\tif w > 0 {\n\t\ts.n++\n\t}\n}\n')).toEqual(['Handle 1-5'])
    expect(ranges('a.swift', 'struct A {\n  func b(_ x: Int) -> Int {\n    return x\n  }\n}\n')).toEqual(['A 1-5', 'A.b 2-4'])
    expect(ranges('a.java', 'class A {\n  public static void main(String[] args) {\n    run();\n  }\n}\n')).toEqual(['A 1-5', 'A.main 2-4'])
  })
  test('declarations without a body are no ranges; unknown languages are not read', () => {
    expect(ranges('a.ts', 'export function f(a: number): number;\nconst x = 1\n')).toEqual([])
    expect(outline('a.md', '# x')).toBeUndefined()
    expect(outlinable('src/a.py')).toBe(true)
    expect(outlinable('docs/a.md')).toBe(false)
  })
  test('the innermost definition holds a line; none at the top level', () => {
    const defs = outline('m.py', PY) ?? []
    expect(enclosing(defs, 20)?.qualified).toBe('Command.help.inner')
    expect(enclosing(defs, 11)?.qualified).toBe('Command.invoke')
    expect(enclosing(defs, 28)).toBeUndefined()
  })
})

describe('the map', () => {
  test('a row: the definitions with their lines, hits counted, the top level last', () => {
    expect(mapRow({ path: 'src/m.py', lines: [11, 12, 20, 25, 28], text: PY })?.row).toBe('src/m.py: Command.invoke 10-12 (2), Command.help.inner 19-20, echo 24-25, top level (1)')
    expect(mapRow({ path: 'src/m.py', lines: [1, 28], text: PY })).toBeUndefined()
    expect(mapRow({ path: 'a.md', lines: [1], text: '# x' })).toBeUndefined()
  })
  test('files with the most hits first, within the budget, the rest counted', () => {
    const files = [
      { path: 'a.py', lines: [11], text: PY },
      { path: 'b.py', lines: [11, 20], text: PY },
      { path: 'c.ts', lines: [5, 14], text: TS },
    ]
    const all = hitMap(files, 1000) as string
    expect(all.split('\n')).toEqual([MAP_HEAD, 'b.py: Command.invoke 10-12, Command.help.inner 19-20', 'c.ts: parse 3-8, Parser.run 13-17', 'a.py: Command.invoke 10-12'])
    const two = hitMap(files, 50) as string
    expect(two.split('\n')).toEqual([MAP_HEAD, 'b.py: Command.invoke 10-12, Command.help.inner 19-20', '… 2 more files'])
    expect(hitMap(files, 10)).toBeUndefined()
    expect(hitMap([files[1] as (typeof files)[number]], 34)).toBe(`${MAP_HEAD}\nb.py: Command.invoke 10-12, … 1 more`)
    expect(hitMap([{ path: 'a.py', lines: [28], text: PY }], 1000)).toBeUndefined()
  })
})
