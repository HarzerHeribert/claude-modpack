import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { newer, releaseVersion } from '../hooks/register'

const NOW = 1_700_000_000_000
const CACHE = '/home/a/.claude/plugins/cache/x/modpack'
const STATE = '/home/a/.claude/mods/modpack/update.json'

describe('newer', () => {
  test('compares each part as a number', () => {
    expect(newer('0.2.0', '0.3.0')).toBe(true)
    expect(newer('0.9.0', '0.10.0')).toBe(true)
    expect(newer('0.2.0', '0.2.0')).toBe(false)
    expect(newer('v0.2.0', '0.1.9')).toBe(false)
  })
})

describe('releaseVersion', () => {
  test('reads tag_name without the v', () => {
    expect(releaseVersion({ tag_name: 'v0.3.0' })).toBe('0.3.0')
    expect(releaseVersion('{"tag_name":"0.4.1"}')).toBe('0.4.1')
    expect(releaseVersion({})).toBe(undefined)
    expect(releaseVersion('not json')).toBe(undefined)
  })
})

function host(on: On, o: { root: string; state?: string; tag?: string; missing?: string }) {
  const clock = mock.clock(on, { now: NOW })
  const seen = { fetched: [] as string[], ran: [] as string[][], logs: [] as string[], written: [] as string[] }
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/a' : e.name === 'MODPACK_PLUGIN_ROOT' ? o.root : undefined }))
  on('fs.read', (_$, e) => {
    if (e.path === STATE && o.state !== undefined) return { value: o.state }
    return { value: JSON.stringify({ name: 'modpack', version: '0.2.0' }) }
  })
  on('fs.exists', (_$, e) => ({ value: e.path === STATE && o.state !== undefined }))
  on('fs.write', (_$, e) => {
    seen.written.push(e.path)
    return { value: undefined }
  })
  on('http.fetch', (_$, e) => {
    seen.fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ tag_name: o.tag ?? 'v0.3.0' }) } }
  })
  on('process.run', (_$, e) => {
    seen.ran.push([...e.argv])
    const fails = o.missing !== undefined && e.argv[2] === 'update' && e.argv[3] === `${o.missing}@claude-modpack`
    return { value: { exitCode: fails ? 1 : 0, stdout: '', stderr: fails ? 'not installed' : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.log', (_$, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  return { clock, seen }
}

const start = async ($: Parameters<TestBody>[0], h: ReturnType<typeof host>) => {
  await $.session.start({ cwd: '/repo' } as never)
  await h.clock.advance(10)
  await h.clock.advance(10)
}

test('auto installs a new release in the background and says so in one line', { options: { updates: 'auto' } }, async ($, on) => {
  const h = host(on, { root: CACHE })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await start($, h)
  expect(h.seen.fetched).toEqual(['https://api.github.com/repos/HarzerHeribert/claude-modpack/releases/latest'])
  const cmds = h.seen.ran.filter(a => a[0] === 'claude').map(a => a.slice(1).join(' '))
  expect(cmds[0]).toBe('plugin marketplace update claude-modpack')
  expect(cmds.length).toBe(9)
  expect(cmds).toContain('plugin update eta@claude-modpack')
  expect(cmds.filter(c => c.startsWith('plugin install'))).toEqual([])
  expect(h.seen.logs.length).toBe(1)
  expect(h.seen.logs[0]).toContain('claude-modpack 0.3.0 is installed (you were on 0.2.0)')
  expect(h.seen.written).toEqual([STATE])
})

test('a mod new in the release, which update cannot reach, is installed', { options: { updates: 'auto' } }, async ($, on) => {
  const h = host(on, { root: CACHE, missing: 'route' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await start($, h)
  const cmds = h.seen.ran.filter(a => a[0] === 'claude').map(a => a.slice(1).join(' '))
  expect(cmds.filter(c => c.startsWith('plugin install'))).toEqual(['plugin install route@claude-modpack'])
  expect(h.seen.logs[0]).toContain('is installed')
})

test('notify only says a release is out', { options: { updates: 'notify' } }, async ($, on) => {
  const h = host(on, { root: CACHE })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await start($, h)
  expect(h.seen.ran.filter(a => a[0] === 'claude')).toEqual([])
  expect(h.seen.logs[0]).toContain('/modpack:update')
  expect(h.seen.logs[0]).toContain('0.3.0')
})

test('a copy loaded from a folder is never checked', { options: { updates: 'auto' } }, async ($, on) => {
  const h = host(on, { root: '/work/claude-mods/modpack' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await start($, h)
  expect(h.seen.fetched).toEqual([])
  expect(h.seen.logs).toEqual([])
})

test('a check made an hour ago is not repeated', { options: { updates: 'auto' } }, async ($, on) => {
  const h = host(on, { root: CACHE, state: JSON.stringify({ checkedAt: NOW - 3_600_000, latest: '0.2.0' }) })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await start($, h)
  expect(h.seen.fetched).toEqual([])
})

test('/modpack:update on a folder copy points at git pull', { options: { updates: 'auto' } }, async ($, on) => {
  const h = host(on, { root: '/work/claude-mods/modpack' })
  const r = await $.command.run({ command: 'update' } as never)
  expect(String((r as { text?: string }).text)).toContain('git pull')
  expect(h.seen.fetched).toEqual([])
})
