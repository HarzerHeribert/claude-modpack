import { expect, test } from 'claude-code/testing'

test('turned off, lsp-plus registers no command and warms no server', { options: { enabled: false } }, async ($, on) => {
  const seen: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    seen.push(e.name)
    return { value: { command: e.name } }
  })
  on('process.run', (_$, e) => {
    seen.push(e.argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(seen).toEqual([])
})
