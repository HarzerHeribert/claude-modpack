import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PERM = { tool_name: 'Bash', tool_input: { command: 'ls' } } as never

function host(on: On) {
  const clock = mock.clock(on, { now: 0 })
  const logs: string[] = []
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: '/home/a' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  return { clock, logs }
}

const hangs = (on: On) => on('classic.PermissionRequest', () => new Promise<never>(() => undefined))

test('a chain that never answers: no decision after 10 s, then 2 s', async ($, on) => {
  const h = host(on)
  hangs(on)
  let done: unknown = 'pending'
  void $.classic.PermissionRequest(PERM).then(r => (done = r))
  await h.clock.advance(9_000)
  expect(done).toBe('pending')
  await h.clock.advance(1_500)
  expect(done).toEqual({})
  done = 'pending'
  void $.classic.PermissionRequest(PERM).then(r => (done = r))
  await h.clock.advance(2_100)
  expect(done).toEqual({})
  expect(h.logs.length).toBe(1)
  expect(h.logs[0]).toContain('PermissionRequest')
  expect(h.logs[0]).toContain('hookGuard: off')
})

test('a fast chain answers unchanged', async ($, on) => {
  const h = host(on)
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }) as never)
  expect(await $.classic.PermissionRequest(PERM)).toEqual({ decision: { behavior: 'allow' } })
  expect(h.logs).toEqual([])
})

test('hookGuard false passes through', { options: { hookGuard: false } }, async ($, on) => {
  const h = host(on)
  on('classic.PermissionRequest', async () => {
    await h.clock.sleep(30_000)
    return { decision: { behavior: 'allow' } } as never
  })
  let done: unknown = 'pending'
  void $.classic.PermissionRequest(PERM).then(r => (done = r))
  await h.clock.advance(31_000)
  expect(done).toEqual({ decision: { behavior: 'allow' } })
  expect(h.logs).toEqual([])
})
