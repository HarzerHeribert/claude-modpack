import { expect, test } from 'claude-code/testing'

const GREP = 'src/click/utils.py:252:def echo(\nsrc/click/core.py:1412:            echo(ctx.command.name)\nsrc/click/core.py:1564:                    echo(msg, err=True)\n'
const WHOLE = 'Found 2 incoming calls:\n\nsrc/click/core.py:\n  invoke (Function) - Line 1401 [calls at: 1412:13]\n  main (Function) - Line 1484 [calls at: 1564:17]\n'
const COLD = 'Found 0 incoming calls:\n'
const OUTLINE = 'Document symbols:\nCommand (Class) - Line 900\n  invoke (Method) - Line 1401\n  main (Method) - Line 1484\n'

for (const [label, incoming, expected] of [
  ['whole', WHOLE, true],
  ['still indexing', COLD, false],
] as const) {
  test(`a symbol grep gets the server's callers attached (${label})`, { options: { answer: true } }, async ($, on) => {
    on('session.cwd', () => ({ value: '/repo' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: GREP, stderr: '', interrupted: false }, text: GREP }))
    on('tool.call', { tool: 'LSP' }, (_$, e) => {
      const op = (e as unknown as { operation: string }).operation
      return { result: {}, text: op === 'incomingCalls' ? incoming : op === 'documentSymbol' ? OUTLINE : '' }
    })
    const r = await $.tool.call({ tool: 'Bash', command: 'grep -rn "echo(" src' })
    const notes = r.context ?? []
    expect(notes.some(n => n.includes('src/click/core.py: Command.invoke (1412), Command.main (1564)'))).toBe(expected)
  })
}

test('a server without call hierarchy answers with the references instead', { options: { answer: true } }, async ($, on) => {
  const grep = 'lib/auth/token.rb:12:  def self.issue(user)\napp/controllers/sessions_controller.rb:8:    Token.issue(user)\n'
  const refs = 'Found 2 references across 2 files:\n\nlib/auth/token.rb:\n  Line 12:12\n\napp/controllers/sessions_controller.rb:\n  Line 8:11\n'
  on('session.cwd', () => ({ value: '/repo' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: grep, stderr: '', interrupted: false }, text: grep }))
  const asked: string[] = []
  on('tool.call', { tool: 'LSP' }, (_$, e) => {
    const op = (e as unknown as { operation: string }).operation
    asked.push(op)
    return { result: {}, text: op === 'incomingCalls' ? 'No call hierarchy item found at this position' : op === 'findReferences' ? refs : '' }
  })
  const r = await $.tool.call({ tool: 'Bash', command: 'grep -rn "issue(" lib app' })
  expect(asked).toEqual(['incomingCalls', 'findReferences'])
  expect((r.context ?? []).some(n => n.includes('2 references in code, in 2 files') && n.includes('app/controllers/sessions_controller.rb: 8'))).toBe(true)
})

test('the warm-up asks about the smallest file of each kind, where the server has least to report', { options: { warm: true, answer: false } }, async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const tree = [
    '100644 blob aaa    9000\tdocs/conf.py',
    '100644 blob bbb       0\tsrc/pkg/__init__.py',
    '100644 blob ccc   52000\tsrc/pkg/core.py',
    '100644 blob ddd     800\tweb/app.tsx',
    '100644 blob eee     120\tweb/util.ts',
    '100644 blob fff      40\tREADME.md',
    '100644 blob ggg     300\tcmd/main.go',
    '100644 blob hhh     200\tscripts/release.sh',
    '100644 blob iii     500\tinfra/main.tf',
    '100644 blob jjj      90\tinfra/variables.tf',
  ].join('\0') + '\0'
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('ls-tree') ? tree : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const asked: string[] = []
  on('tool.call', { tool: 'LSP' }, (_$, e) => {
    asked.push((e as unknown as { filePath: string }).filePath)
    return { result: {}, text: 'Document symbols:\n' }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  // The warm-up runs detached from session start.
  for (let i = 0; i < 500 && asked.length < 5; i++) await Promise.resolve()
  expect(asked.sort()).toEqual(['/repo/cmd/main.go', '/repo/infra/variables.tf', '/repo/scripts/release.sh', '/repo/src/pkg/__init__.py', '/repo/web/util.ts'])
})

test('a language the repository has enough of, without a server: the person is told, and Claude, to offer /lsp-plus:setup', { options: { warm: true, answer: false } }, async ($, on) => {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const py = Array.from({ length: 6 }, (_, i) => `100644 blob p${i}    ${100 + i}\tsrc/m${i}.py`)
  const tree = [...py, '100644 blob t1     120\tweb/util.ts', '100644 blob c1      90\ttools/one.c'].join('\0') + '\0'
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('ls-tree') ? tree : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.call', { tool: 'LSP' }, (_$, e) => {
    const file = (e as unknown as { filePath: string }).filePath
    // No Python server; the C file has none either, but one file is not worth a word.
    return { result: {}, text: /\.(py|c)$/.test(file) ? `No LSP server available for file type: ${file.slice(file.lastIndexOf('.'))}` : 'Document symbols:\n' }
  })
  const logged: string[] = []
  on('ui.log', (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  for (let i = 0; i < 500 && logged.length === 0; i++) await Promise.resolve()
  expect(logged).toEqual(['lsp-plus: no language server answers for Python (6 files) in this repository, so symbol searches fall back to grep, and lsp-plus, cells and delegate answer less well. Run /lsp-plus:setup to set one up.'])
  const compose = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: { name: 'default', isKeepingCodingInstructions: true }, traits: [] } as const
  const sections = (await $.prompt.compose(compose)).sections
  expect(sections.map(s => s.id)).toEqual(['lsp-plus-missing'])
  expect(sections[0]?.text).toContain('offer /lsp-plus:setup')
})

test('with answer off a symbol grep gets nothing', { options: { answer: false } }, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: GREP, stderr: '', interrupted: false }, text: GREP }))
  const r = await $.tool.call({ tool: 'Bash', command: 'grep -rn "echo(" src' })
  expect(r.context ?? []).toEqual([])
})
