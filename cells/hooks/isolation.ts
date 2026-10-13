// Where a cell's runner may run, and how it is shut in.
//
// What a cell does to the machine it does through Claude Code's tools, which the person's
// permissions and auto mode judge one call at a time. The runner itself must have no other
// way out, or one run_cell call could do what no tool call shows. Node's permission model
// closes the disk, child processes and workers, and from Node 25 on the network; an OS
// sandbox closes the network and signals on any Node: Seatbelt on macOS, bubblewrap on Linux.
// Where nothing closes the network, cells does not run, and says what would let it.

/** What the `node` on Claude Code's PATH reports about itself. */
export type Probe = { nodePath: string; platform: string; nodeVersion: string; tmpdir: string }

export type Sandbox = 'seatbelt' | 'bwrap' | 'node'

export type Isolation =
  | { sandbox: Sandbox; signalsOpen: boolean }
  | { sandbox: undefined; why: string; fix: string }

/** From Node 25 the permission model also refuses network access unless `--allow-net` opens it. */
export const NODE_NET_MAJOR = 25

/** The major version of "26.1.0" or "v22.22.3"; 0 when it is not a version. */
export function major(version: string): number {
  return Number(/^v?(\d+)\./.exec(version)?.[1] ?? 0)
}

/** The program `node -p` runs to report its path, platform and version as JSON. */
export const PROBE_SCRIPT = 'JSON.stringify([process.execPath, process.platform, process.versions.node, require("os").tmpdir()])'

export function parseProbe(stdout: string): Probe | undefined {
  try {
    const [nodePath, platform, nodeVersion, tmpdir] = JSON.parse(stdout) as unknown[]
    if (typeof nodePath !== 'string' || typeof platform !== 'string' || typeof nodeVersion !== 'string' || typeof tmpdir !== 'string') return undefined
    return { nodePath, platform, nodeVersion, tmpdir }
  } catch {
    return undefined
  }
}

/** bubblewrap's verdict: whether it started a program in the sandbox, and if not, its first word on why. */
export type Bwrap = { works: boolean; why?: string }

export function choose(probe: Probe, bwrap: Bwrap): Isolation {
  if (probe.platform === 'darwin') return { sandbox: 'seatbelt', signalsOpen: false }
  if (probe.platform === 'linux' && bwrap.works) return { sandbox: 'bwrap', signalsOpen: false }
  if (major(probe.nodeVersion) >= NODE_NET_MAJOR) return { sandbox: 'node', signalsOpen: true }
  const node = `Node ${probe.nodeVersion} lets a program reach the network`
  if (probe.platform === 'linux') {
    const sandbox = bwrap.why ? `bubblewrap can't start a sandbox here (${bwrap.why})` : 'bubblewrap (bwrap) is not installed'
    return { sandbox: undefined, why: `${sandbox}, and ${node}`, fix: 'install Node 25 or later, or make bubblewrap work' }
  }
  return { sandbox: undefined, why: `there is no OS sandbox for it here, and ${node}`, fix: 'install Node 25 or later' }
}

/** The runner under Node's permission model: it reads its own folder and the cell's, nothing else. */
export function nodeArgv(nodePath: string, runner: string, dir: string): string[] {
  return [nodePath, '--permission', `--allow-fs-read=${runner}`, `--allow-fs-read=${dir}`, '--no-warnings', `${runner}/runner.mjs`]
}

export function seatbeltArgv(nodePath: string, runner: string, dir: string): string[] {
  return ['/usr/bin/sandbox-exec', '-f', `${runner}/profile.sb`, ...nodeArgv(nodePath, runner, dir)]
}

/**
 * bubblewrap: every namespace its own (network, processes, IPC), so neither the network nor
 * another process is in reach; read-only binds of the system's libraries, Node, the runner
 * and the cell's folder, and nothing else of the host's files. Assumes a merged /usr, as
 * Debian, Ubuntu, Fedora and Arch have it.
 */
export function bwrapArgv(nodePath: string, runner: string, dir: string, program: string[] = nodeArgv(nodePath, runner, dir)): string[] {
  // Node's install prefix: /usr/local/bin/node → /usr/local, ~/.nvm/versions/node/v25.1.0/bin/node → its version folder.
  const prefix = nodePath.replace(/\/bin\/[^/]+$/, '')
  const nodeBind = prefix === '/usr' || prefix.startsWith('/usr/') ? [] : ['--ro-bind', prefix, prefix]
  return [
    'bwrap', '--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--clearenv',
    '--ro-bind', '/usr', '/usr', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--symlink', 'usr/bin', '/bin',
    '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache',
    ...nodeBind,
    '--ro-bind', runner, runner,
    '--ro-bind', dir, dir,
    '--dev', '/dev',
    ...program,
  ]
}

export function runnerArgv(isolation: Isolation, nodePath: string, runner: string, dir: string): string[] | undefined {
  if (isolation.sandbox === 'seatbelt') return seatbeltArgv(nodePath, runner, dir)
  if (isolation.sandbox === 'bwrap') return bwrapArgv(nodePath, runner, dir)
  if (isolation.sandbox === 'node') return nodeArgv(nodePath, runner, dir)
  return undefined
}

/** What a cell's report adds to its first line where the runner is shut in less than elsewhere. */
export function weakness(isolation: Isolation): string | undefined {
  return isolation.sandbox === 'node' && isolation.signalsOpen ? "Node's sandbox only: signals open" : undefined
}

/** The system-prompt section where cells cannot run: Claude offers the fix once, the person decides. */
export function offNote(why: string, fix: string): string {
  return `# cells is off on this machine

The cells mod could not start its run_cell tool: ${why}. Where chaining several edits and their check in one step would have helped the person, tell them once and offer the fix (${fix}); /cells:setup walks them through it. Don't bring it up again after that.`
}

/** The line the person sees where cells cannot run. */
export function offLine(why: string, fix: string): string {
  return `cells is off: ${why}. To turn it on, ${fix}, or run /cells:setup.`
}
