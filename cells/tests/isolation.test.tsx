import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { bwrapArgv, choose, major, nodeArgv, parseProbe, runnerArgv, seatbeltArgv, weakness } from '../hooks/isolation'

const mac = { nodePath: '/opt/homebrew/bin/node', platform: 'darwin', nodeVersion: '22.22.3', tmpdir: '/var/folders/x/T' }
const linux = (nodeVersion: string) => ({ nodePath: '/home/a/.nvm/versions/node/v25.1.0/bin/node', platform: 'linux', nodeVersion, tmpdir: '/tmp' })
const windows = (nodeVersion: string) => ({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', platform: 'win32', nodeVersion, tmpdir: 'C:\\Temp' })

describe('where cells runs', () => {
  test('macOS: Seatbelt, on any Node', () => {
    expect(choose(mac, { works: false })).toEqual({ sandbox: 'seatbelt', signalsOpen: false })
  })

  test('Linux: bubblewrap where it starts, on any Node', () => {
    expect(choose(linux('22.13.0'), { works: true })).toEqual({ sandbox: 'bwrap', signalsOpen: false })
  })

  test("Linux and Windows without an OS sandbox: Node's own, from Node 25, with signals open", () => {
    expect(choose(linux('25.1.0'), { works: false })).toEqual({ sandbox: 'node', signalsOpen: true })
    expect(choose(windows('26.0.0'), { works: false })).toEqual({ sandbox: 'node', signalsOpen: true })
  })

  test('below Node 25 with no OS sandbox it does not run, and says why and what would let it', () => {
    const missing = choose(linux('22.13.0'), { works: false })
    expect(missing.sandbox).toBe(undefined)
    if (missing.sandbox !== undefined) return
    expect(missing.why).toBe('bubblewrap (bwrap) is not installed, and Node 22.13.0 lets a program reach the network')
    expect(missing.fix).toBe('install Node 25 or later, or make bubblewrap work')
    const blocked = choose(linux('22.13.0'), { works: false, why: 'No permissions to create new namespace' })
    expect(blocked.sandbox === undefined && blocked.why).toBe("bubblewrap can't start a sandbox here (No permissions to create new namespace), and Node 22.13.0 lets a program reach the network")
    const win = choose(windows('22.13.0'), { works: false })
    expect(win.sandbox === undefined && win.fix).toBe('install Node 25 or later')
  })

  test('the version and the probe parse', () => {
    expect(major('v22.22.3')).toBe(22)
    expect(major('26.1.0')).toBe(26)
    expect(major('nightly')).toBe(0)
    expect(parseProbe('["/usr/bin/node","linux","25.1.0","/tmp"]')).toEqual({ nodePath: '/usr/bin/node', platform: 'linux', nodeVersion: '25.1.0', tmpdir: '/tmp' })
    expect(parseProbe('not json')).toBe(undefined)
    expect(parseProbe('["/usr/bin/node","linux"]')).toBe(undefined)
  })

  test('only the Node-only sandbox says so in the report', () => {
    expect(weakness({ sandbox: 'node', signalsOpen: true })).toBe("Node's sandbox only: signals open")
    expect(weakness({ sandbox: 'seatbelt', signalsOpen: false })).toBe(undefined)
    expect(weakness({ sandbox: 'bwrap', signalsOpen: false })).toBe(undefined)
  })
})

describe('how the runner starts', () => {
  const runner = '/mods/cells/runner'
  const dir = '/tmp/claude-cells/s1'

  test("Node's permission model alone: reads of the runner and the cell's folder, nothing opened beyond", () => {
    const argv = nodeArgv('/usr/bin/node', runner, dir)
    expect(argv).toEqual(['/usr/bin/node', '--permission', `--allow-fs-read=${runner}`, `--allow-fs-read=${dir}`, '--no-warnings', `${runner}/runner.mjs`])
    expect(argv.some(a => /allow-(net|child-process|worker|addons|wasi|fs-write)/.test(a))).toBe(false)
  })

  test('Seatbelt wraps the same command in the profile', () => {
    expect(seatbeltArgv('/usr/bin/node', runner, dir).slice(0, 3)).toEqual(['/usr/bin/sandbox-exec', '-f', `${runner}/profile.sb`])
    expect(seatbeltArgv('/usr/bin/node', runner, dir).slice(3)).toEqual(nodeArgv('/usr/bin/node', runner, dir))
  })

  test("bubblewrap: no namespace of the host's, read-only binds of what the runner needs, the same command inside", () => {
    const node = '/home/a/.nvm/versions/node/v25.1.0/bin/node'
    const argv = bwrapArgv(node, runner, dir)
    expect(argv[0]).toBe('bwrap')
    for (const flag of ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv']) expect(argv.includes(flag)).toBe(true)
    const binds = argv.flatMap((a, i) => (a === '--ro-bind' ? [argv[i + 1]] : []))
    expect(binds).toEqual(['/usr', '/home/a/.nvm/versions/node/v25.1.0', runner, dir])
    expect(argv.includes('--bind')).toBe(false)
    expect(argv.slice(-6)).toEqual(nodeArgv(node, runner, dir))
    // A node under /usr needs no bind of its own.
    expect(bwrapArgv('/usr/bin/node', runner, dir).filter(a => a === '--ro-bind').length).toBe(3)
  })

  test('no sandbox, no command', () => {
    expect(runnerArgv({ sandbox: undefined, why: 'x', fix: 'y' }, '/usr/bin/node', runner, dir)).toBe(undefined)
    expect(runnerArgv({ sandbox: 'bwrap', signalsOpen: false }, '/usr/bin/node', runner, dir)?.[0]).toBe('bwrap')
  })
})

const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: { name: 'default', isKeepingCodingInstructions: true }, traits: [] } as const

/** A session start on a machine whose node says `probe`, with bubblewrap answering `bwrap`. */
function machine(on: On, probe: unknown[], bwrap: { exitCode: number; stderr: string } | 'missing') {
  const registered: string[] = []
  const logged: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }) as never)
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'node' && e.argv[1] === '-p') return { value: { exitCode: 0, stdout: JSON.stringify(probe), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'bwrap') {
      if (bwrap === 'missing') throw new Error('spawn bwrap ENOENT')
      return { value: { exitCode: bwrap.exitCode, stdout: '', stderr: bwrap.stderr, isStdoutTruncated: false, isStderrTruncated: false } }
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.register', (_$, e) => {
    registered.push(e.name)
    return { value: { tool: e.name } }
  })
  on('ui.log', (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('prompt.compose', () => ({ sections: [] }))
  return { registered, logged }
}

describe('what the person and Claude hear', () => {
  test('macOS: the tool, no word about it', async ($, on) => {
    const m = machine(on, ['/opt/homebrew/bin/node', 'darwin', '22.22.3', '/var/folders/x/T'], 'missing')
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    expect(m.registered).toEqual(['run_cell'])
    expect(m.logged).toEqual([])
    const sections = (await $.prompt.compose(COMPOSE)).sections.map(s => s.id)
    expect(sections).toEqual(['cells-chaining'])
  })

  test('Linux where bubblewrap cannot start, on Node 22: no tool; the person sees why, Claude is told to offer the fix once', async ($, on) => {
    const m = machine(on, ['/usr/bin/node', 'linux', '22.13.0', '/tmp'], { exitCode: 1, stderr: 'bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces.\n' })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    expect(m.registered).toEqual([])
    expect(m.logged.length).toBe(1)
    expect(m.logged[0]).toContain("cells is off: bubblewrap can't start a sandbox here (No permissions to create new namespace")
    expect(m.logged[0]).toContain('run /cells:setup')
    const sections = (await $.prompt.compose(COMPOSE)).sections
    expect(sections.map(s => s.id)).toEqual(['cells-chaining', 'cells-off'])
    expect(sections[1]?.text).toContain('tell them once and offer the fix')
    // Without the tool, the chaining guidance does not name it.
    expect(sections[0]?.text.includes('run_cell')).toBe(false)
  })

  test('Linux on Node 25 without bubblewrap: the tool, with Node as its sandbox', async ($, on) => {
    const m = machine(on, ['/usr/bin/node', 'linux', '25.1.0', '/tmp'], 'missing')
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    expect(m.registered).toEqual(['run_cell'])
    expect(m.logged).toEqual([])
  })
})
