import type { EngineInterface, Register } from 'claude-code'

import { loadedMods, modRows, modsPane, modsText, type Elements } from './mods'

type Engine = EngineInterface

async function loaded($: Engine) {
  const commands = await $.command.list().catch(() => [])
  const tools = await $.tool.list().catch(() => [])
  return loadedMods(commands, tools)
}

const REPO = 'HarzerHeribert/claude-modpack'
const MARKETPLACE = 'claude-modpack'
const PLUGINS = ['modpack', 'statusline', 'smart-compact', 'delegate', 'lsp-plus', 'cells', 'eta']
const THROTTLE_MS = 20 * 3_600_000

const MODS_PANE = 'mods'

let mode = 'auto'

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

export const register: Register = (on, options) => {
  const u = options.updates
  mode = u === 'notify' || u === 'off' ? u : 'auto'

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'update', description: 'Update claude-modpack and its mods to the newest release' })
    await $.command.register({ name: 'mods', description: "See the pack's mods, and turn each on or off" })
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
  on('command.run', { command: 'mods' }, async $ => {
    const text = modsText(modRows(await $.config.list(), await loaded($)))
    await $.ui.open({ id: MODS_PANE, title: 'Mods' }).catch(() => undefined)
    return { text }
  })

  on('ui.render', { component: 'Pane', requestId: MODS_PANE }, async ($, e) => {
    const flip = (key: string, value: boolean) =>
      void $.config.set({ key, value }).then(() => $.ui.invalidate('ui.render')).catch(() => undefined)
    return modsPane($.ui.resolve(e) as unknown as Elements, modRows(await $.config.list(), await loaded($)), flip)
  })
}
