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

test('with answer off a symbol grep gets nothing', { options: { answer: false } }, async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: GREP, stderr: '', interrupted: false }, text: GREP }))
  const r = await $.tool.call({ tool: 'Bash', command: 'grep -rn "echo(" src' })
  expect(r.context ?? []).toEqual([])
})
