import { expect, test } from 'claude-code/testing'

test('turned off, smart-compact registers no command', { options: { enabled: false } }, async ($, on) => {
  const commands: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(commands).toEqual([])
})
