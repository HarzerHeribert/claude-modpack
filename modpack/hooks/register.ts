import type { EngineInterface, Register } from 'claude-code'

import { loadedMods, MODS, modRows, modsPane, modsText, type Elements } from './mods'

type Engine = EngineInterface

// Hook guard: another plugin's PermissionRequest or Notification command hook that hangs must not freeze
// Claude Code. Skipping only these two is safe (PermissionRequest skipped: Claude Code asks the person; Notification
// is cosmetic). PreToolUse is never touched.

const FIRST_LIMIT_MS = 10_000
const AFTER_HANG_LIMIT_MS = 2_000

/** Marks that the limit ran out before the chain beneath answered. */
const TIMED_OUT = Symbol('timed out')

type Race<R> = { timedOut: false; result: R } | { timedOut: true }

/**
 * Waits for `run()` (the `next(e)` call) at most `limitMs`, by racing it against a `$.clock.sleep`.
 * The sleep counts against the hook's own budget (a $.clock wait is the one `$` call that does), so
 * the limit is cut to stay under what `budget.remainingMs` leaves; the hook's `.catch` is the net.
 */
async function race<R>($: Engine, run: () => Promise<R>, limitMs: number, remainingMs: number): Promise<Race<R>> {
  const stop = new AbortController()
  const ms = Math.max(0, Math.min(limitMs, remainingMs - 500))
  const timer = $.clock.sleep(ms, { signal: stop.signal }).then(
    () => TIMED_OUT,
    // Aborted because the chain answered first: this side never wins.
    () => new Promise<never>(() => undefined),
  )
  const chain = run()
  // If the timer wins, a later rejection of the abandoned chain must not surface.
  chain.catch(() => undefined)
  try {
    const r = await Promise.race([chain, timer])
    return r === TIMED_OUT ? { timedOut: true } : { timedOut: false, result: r as R }
  } finally {
    stop.abort()
  }
}

type HookEntry = { hooks?: { type?: string; command?: string }[] }

const hasCommand = (v: unknown, event: string): boolean => {
  const list = (v as Record<string, unknown> | undefined)?.[event]
  return (
    Array.isArray(list) &&
    (list as HookEntry[]).some(h => Array.isArray(h?.hooks) && h.hooks.some(c => (c?.type ?? 'command') === 'command'))
  )
}

/** The enabled plugins and settings that define a command hook for `event`: best effort, may be empty. */
async function hookSources($: Engine, event: string): Promise<string[]> {
  const out: string[] = []
  try {
    const settings = (await $.settings.read()) as { enabledPlugins?: Record<string, unknown> }
    const home = (await $.env.get('HOME')) ?? ''
    // The merged settings carry the plugins' hooks too: the person's own are in their files.
    const cwd = await $.session.cwd()
    for (const f of [`${home}/.claude/settings.json`, `${home}/.claude/settings.local.json`, `${cwd}/.claude/settings.json`, `${cwd}/.claude/settings.local.json`]) {
      const own = await $.fs.read(f).then(t => JSON.parse(t) as { hooks?: unknown }).catch(() => undefined)
      if (own !== undefined && hasCommand(own.hooks, event)) {
        out.push('your settings')
        break
      }
    }
    for (const [id, on] of Object.entries(settings.enabledPlugins ?? {})) {
      if (on === false) continue
      const [name, market] = id.split('@')
      const dir = `${home}/.claude/plugins/cache/${market}/${name}`
      const versions = await $.fs.list(dir).catch(() => [])
      for (const v of versions) {
        if (v.kind === 'file') continue
        const path = `${dir}/${v.name}/hooks/hooks.json`
        if (!(await $.fs.exists(path).catch(() => false))) continue
        const json = JSON.parse(await $.fs.read(path)) as { hooks?: unknown }
        if (hasCommand(json.hooks ?? json, event)) {
          out.push(id)
          break
        }
      }
    }
  } catch {
    // unreadable settings: name no source
  }
  return out
}

function notice(event: string, sources: readonly string[], limitMs: number): string {
  const who = sources.length ? ` (${sources.join(', ')})` : ''
  return `a ${event} hook${who} ran over ${limitMs / 1000} s, so Claude Code went on without it. hookGuard: off in the modpack settings turns this off.`
}

async function loaded($: Engine) {
  const commands = await $.command.list().catch(() => [])
  const tools = await $.tool.list().catch(() => [])
  return loadedMods(commands, tools)
}

const REPO = 'HarzerHeribert/claude-modpack'
const MARKETPLACE = 'claude-modpack'
const PLUGINS = ['modpack', 'statusline', 'smart-compact', 'delegate', 'lsp-plus', 'cells', 'eta', 'seek', 'route']
const THROTTLE_MS = 20 * 3_600_000

const MODS_PANE = 'mods'

let mode = 'auto'
let hung = false
let told = false

const parts = (v: string) => v.replace(/^v/, '').split('.').map(p => Number.parseInt(p, 10) || 0)

/** True when semver `b` is newer than `a` (numeric per part; a leading "v" is allowed). */
export function newer(a: string, b: string): boolean {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? 0) - (x[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** The release's version from the GitHub API's JSON: tag_name "v0.3.0" gives "0.3.0". */
export function releaseVersion(json: unknown): string | undefined {
  let o: unknown = json
  if (typeof json === 'string') {
    try {
      o = JSON.parse(json)
    } catch {
      return undefined
    }
  }
  const tag = (o as { tag_name?: unknown } | null | undefined)?.tag_name
  return typeof tag === 'string' && tag.trim() !== '' ? tag.trim().replace(/^v/, '') : undefined
}

const url = (latest: string) => `https://github.com/${REPO}/releases/tag/v${latest}`

async function claude($: Engine, args: string[]) {
  return $.process.run(['claude', ...args], { timeoutMs: 120_000 }).catch(() => undefined)
}

const firstLine = (s: string | undefined) => (s ?? '').trim().split('\n')[0] || 'no error text'

/** Runs the marketplace update and each plugin's; the outcome as the line the person reads. */
async function install($: Engine, latest: string, current: string): Promise<string> {
  const m = await claude($, ['plugin', 'marketplace', 'update', MARKETPLACE])
  if (m === undefined || m.exitCode !== 0) return failed(latest, m?.stderr)
  let own: Awaited<ReturnType<typeof claude>>
  for (const name of PLUGINS) {
    const r = await claude($, ['plugin', 'update', `${name}@${MARKETPLACE}`])
    // A mod new in this release (route in 0.5.0, seek in 0.6.0) is not installed yet: update cannot reach it, install does.
    if (name !== 'modpack' && (r === undefined || r.exitCode !== 0)) await claude($, ['plugin', 'install', `${name}@${MARKETPLACE}`])
    if (name === 'modpack') own = r
  }
  if (own === undefined || own.exitCode !== 0) return failed(latest, own?.stderr)
  return `claude-modpack ${latest} is installed (you were on ${current}): it loads the next time Claude Code starts; claude --continue keeps this conversation. What's new: ${url(latest)}`
}

const failed = (latest: string, stderr: string | undefined) =>
  `claude-modpack ${latest} is out, but the update failed: ${firstLine(stderr)}. /modpack:update tries again.`

type Outcome = { text?: string; current: string; latest?: string; folder?: boolean; root: string }

/** The check, and the install when `install` is set. `force` ignores the throttle. Undefined text: nothing to say. */
async function check($: Engine, force: boolean, doInstall: boolean): Promise<Outcome> {
  // MODPACK_PLUGIN_ROOT stands in for $.plugin.root: a seam for tests, which cannot move the real one.
  const root = (await $.env.get('MODPACK_PLUGIN_ROOT')) || $.plugin.root
  const home = (await $.env.get('HOME')) ?? ''
  const current = JSON.parse(await $.fs.read(`${root}/.claude-plugin/plugin.json`)).version as string
  if (!root.startsWith(`${home}/.claude/plugins/`)) return { current, folder: true, root }
  const statePath = `${home}/.claude/mods/modpack/update.json`
  const now = await $.clock.now()
  if (!force) {
    const st = await $.fs.exists(statePath).catch(() => false)
    const saved = st ? await $.fs.read(statePath).then(t => JSON.parse(t) as { checkedAt?: number }).catch(() => undefined) : undefined
    if (typeof saved?.checkedAt === 'number' && now - saved.checkedAt < THROTTLE_MS) return { current, root }
  }
  const res = await $.http.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'claude-modpack' },
  }).catch(() => undefined)
  const latest = res?.ok ? releaseVersion(res.text) : undefined
  if (latest === undefined) return { current, root }
  let text: string | undefined
  if (newer(current, latest)) {
    if (doInstall) text = await install($, latest, current)
    else text = `claude-modpack ${latest} is out (you have ${current}): /modpack:update installs it. What's new: ${url(latest)}`
  }
  await $.fs.write(statePath, JSON.stringify({ checkedAt: now, latest })).catch(() => undefined)
  return { text, current, latest, root }
}

async function guarded(event: string, $: Engine, e: unknown, next: unknown, guard: boolean) {
  const n = next as ((e: unknown) => Promise<unknown>) & { budget: { remainingMs: number } }
  if (!guard) return n(e)
  const limit = hung ? AFTER_HANG_LIMIT_MS : FIRST_LIMIT_MS
  const r = await race($, () => n(e), limit, n.budget.remainingMs)
  if (!r.timedOut) return r.result
  hung = true
  if (!told) {
    told = true
    const sources = await hookSources($, event)
    await $.ui.log(notice(event, sources, limit))
  }
  return {} // no decision: Claude Code goes on to its own dialog
}

async function setMod($: Engine, mod: string, action: string | undefined): Promise<string> {
  const names = MODS.map(m => m[0])
  if (!names.includes(mod as never)) return `No mod called ${mod}. The pack's mods: ${names.join(', ')}.`
  if (action !== undefined && action !== 'on' && action !== 'off') return `Say /mods ${mod} on or /mods ${mod} off.`
  const config = await $.config.list()
  const row = modRows(config, await loaded($)).find(r => r.name === mod)
  if (row === undefined || row.state === 'not installed') return `${mod} is not installed: ${row?.install ?? ''}`
  if (row.folder) return `${mod} is loaded from a folder, so it has no row in /config: its switch is \`enabled\` under pluginConfigs in your settings.`
  const key = `${mod}.enabled`
  const cfg = config.find(r => r.key === key)
  if (cfg === undefined) return `${mod} has no on/off switch.`
  if (cfg.isLocked) return `${mod}'s switch is locked by your settings policy; /mods cannot change it.`
  const value = action === undefined ? cfg.value === false : action === 'on'
  await $.config.set({ key, value })
  await $.ui.invalidate('ui.render')
  return `${mod} is now ${value ? 'on' : 'off'}. /mods ${mod} ${value ? 'off' : 'on'} turns it back ${value ? 'off' : 'on'}.`
}

export const register: Register = (on, options) => {
  const u = options.updates
  mode = u === 'notify' || u === 'off' ? u : 'auto'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'update', description: 'Update claude-modpack and its mods to the newest release' })
    await $.command.register({ name: 'mods', description: "See the pack's mods, and turn each on or off", argumentHint: '[mod] [on|off]' })
    if (mode !== 'off') {
      $.clock.after(0, () => {
        void check($, false, mode === 'auto').then(o => {
          if (o.text) $.ui.log(o.text)
        }).catch(() => undefined)
      })
    }
    return next(e)
  })

  on('command.run', { command: 'update' }, async $ => {
    const o = await check($, true, true)
    if (o.folder) return { text: `claude-modpack is loaded from ${o.root}: update it there (git pull); a folder copy reloads by itself.` }
    if (o.latest === undefined) return { text: 'Could not reach GitHub to look for a new release. Try again later.' }
    return { text: o.text ?? `Already the newest: ${o.current}.` }
  })
  on('command.run', { command: 'mods' }, async ($, e) => {
    const argv = (e.args ?? '').trim().split(/\s+/).filter(Boolean)
    if (argv.length > 0) return { text: await setMod($, argv[0] as string, argv[1]) }
    const text = modsText(modRows(await $.config.list(), await loaded($)))
    await $.ui.open({ id: MODS_PANE, title: 'Mods' }).catch(() => undefined)
    return { text }
  })

  // The hook guard: next(e) raced against a $.clock wait; see guard.ts.
  hung = false
  told = false
  const guard = options.hookGuard !== false
  // The hook's 10 s budget can end before a 10 s wait does: the handler then also answers with no decision.
  on('classic.PermissionRequest', ($, e, next) => guarded('PermissionRequest', $, e, next, guard) as never).catch(() => ({}))
  on('classic.Notification', ($, e, next) => guarded('Notification', $, e, next, guard) as never).catch(() => ({}))

  on('ui.render', { component: 'Pane', requestId: MODS_PANE }, async ($, e) => {
    const flip = (key: string, value: boolean) =>
      void $.config.set({ key, value }).then(() => $.ui.invalidate('ui.render')).catch(() => undefined)
    return modsPane($.ui.resolve(e) as unknown as Elements, modRows(await $.config.list(), await loaded($)), flip)
  })
}
