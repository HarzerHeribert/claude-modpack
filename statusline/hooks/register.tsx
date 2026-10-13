import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import type { StatuslineArtifact, StatuslineSegment, StatuslineWorld } from '../types'
import { isPagePublish, parsePublish, shortUrl, titleOf, upsert } from './artifacts'
import {
  COLORS,
  PLAIN_SEPARATOR,
  SEPARATOR,
  artifactsLabel,
  buildSegments,
  condenseHint,
  fit,
  isMoving,
  plain,
  rowLead,
  width,
} from './line'
import type { LimitsShown, Segment } from './line'

type Engine = EngineInterface
type Placement = 'line' | 'tail' | 'band' | 'off'
type Options = { placement: Placement; limits: LimitsShown; animate: boolean }

const INITIAL_WORLD: StatuslineWorld = { isWorking: false, window: 200_000, limits: [] }

const SEGMENTS = atom({ plugin: 'statusline', key: 'segments' } as const, {} as Record<string, StatuslineSegment>)
const WORLD = atom({ plugin: 'statusline', key: 'world' } as const, INITIAL_WORLD)
const ARTIFACTS = atom({ plugin: 'statusline', key: 'artifacts' } as const, [] as StatuslineArtifact[])
const ARTIFACTS_OPEN = atom({ plugin: 'statusline', key: 'isArtifactsOpen' } as const, false)

/** The glint's frame rate while Claude works; a turning or blinking segment's. */
const GLINT_MS = 50
const MOVE_MS = 125

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function readOptions(o: PluginOptions): Options {
  return {
    placement: pick<Placement>(o.placement, ['line', 'tail', 'band', 'off'], 'line'),
    limits: pick<LimitsShown>(o.limits, ['always', 'half', 'off'], 'always'),
    animate: o.animate !== false,
  }
}

let options: Options = readOptions({})
/** The permission mode, as hooks last reported it: the engine labels the hint's row with it. */
let permissionMode: string | undefined
let frames: Timer | undefined
let framesMs = 0
let mirrored = false
let lastMirror = 0

function setWorld($: Engine, change: (w: StatuslineWorld) => Partial<StatuslineWorld>) {
  return update($, WORLD, w => ({ ...w, ...change(w) }))
}

/** Redraws at the rate something on the line moves at: the glint, a spinner or a blink; else not at all. */
async function animate($: Engine) {
  const now = await $.clock.now()
  const world = await read($, WORLD)
  const given = Object.values(await read($, SEGMENTS))
  const want = options.placement === 'off' ? 0 : world.isWorking && options.animate ? GLINT_MS : given.some(s => isMoving(s, now)) ? MOVE_MS : 0
  if (want === framesMs) return
  frames?.cancel()
  frames = want > 0 ? $.clock.every(want, () => $.ui.invalidate('ui.render')) : undefined
  framesMs = want
}

/** A segment as another mod gave it, checked: an id, a priority, parts of text, countdowns or spinners. */
function isSegment(s: unknown): s is StatuslineSegment {
  if (s === null || typeof s !== 'object') return false
  const seg = s as Record<string, unknown>
  const isPart = (p: unknown) =>
    p !== null &&
    typeof p === 'object' &&
    (typeof (p as { text?: unknown }).text === 'string' || typeof (p as { until?: unknown }).until === 'number' || (p as { spin?: unknown }).spin === true)
  return (
    typeof seg.id === 'string' &&
    seg.id !== '' &&
    typeof seg.priority === 'number' &&
    Array.isArray(seg.parts) &&
    seg.parts.every(isPart) &&
    (seg.short === undefined || (Array.isArray(seg.short) && seg.short.every(isPart)))
  )
}

async function refreshWorld($: Engine, isDeep: boolean) {
  const usage = await $.session.usage(isDeep ? { breakdown: 'summary' } : undefined)
  const model = await $.session.model().catch(() => undefined)
  // Before any turn says which effort it ran at, the configured one; the same for the permission
  // mode until a hook reports it (a reload starts the module over).
  const settings = isDeep ? await $.settings.read().catch(() => ({}) as Record<string, unknown>) : {}
  const configured = settings.effortLevel
  const defaultMode = (settings.permissions as { defaultMode?: unknown } | undefined)?.defaultMode
  if (permissionMode === undefined && typeof defaultMode === 'string') permissionMode = defaultMode
  const breakdown = usage.context.breakdown

  await setWorld($, w => ({
    ...(w.model === undefined && model ? { model } : {}),
    ...(w.effort === undefined && typeof configured === 'string' ? { effort: configured } : {}),
    // After a reload or a resume the gauge has a size before any response.
    ...(w.contextTokens === undefined && usage.context.tokens !== undefined ? { contextTokens: usage.context.tokens } : {}),
    window: usage.context.window,
    limits: usage.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt === undefined ? undefined : Date.parse(l.resetsAt) })),
    ...(breakdown === undefined ? {} : { autoCompactAt: breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined }),
  }))
}

/** Records a page the Artifact tool published, titled by the page itself. */
async function notePublish($: Engine, input: Record<string, unknown>, text: string, at: number | undefined) {
  if (!isPagePublish(input)) return
  const published = parsePublish(text)
  if (published === undefined) return
  const html = typeof input.file_path === 'string' ? await $.fs.read(input.file_path).catch(() => undefined) : undefined
  const title = titleOf(html, input.file_path, input.title)
  await update($, ARTIFACTS, list => {
    const before = list.find(a => a.url === published.url)
    // A reload finds the transcript's publishes oldest first; never let an older one replace a newer.
    if (before !== undefined && before.version > published.version) return list
    return upsert(list, { ...published, title, updatedAt: at ?? before?.updatedAt })
  })
}

/** Pages published before this load (a resume, a reload), read back from the transcript. */
async function recoverArtifacts($: Engine) {
  const messages = await $.session.messages()
  for (const m of messages) {
    for (const use of m.toolUses) {
      if (use.tool === 'Artifact' && !use.isError && use.text) await notePublish($, use.input, use.text, undefined)
    }
  }
}

function ago(ms: number | undefined, now: number): string {
  if (ms === undefined) return 'earlier'
  const m = Math.round((now - ms) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

async function segmentsFor($: Engine, isWorking: boolean, columns: number): Promise<Segment[]> {
  const now = await $.clock.now()
  const world = await read($, WORLD)
  const given = Object.values(await read($, SEGMENTS))
  return buildSegments({ ...world, isWorking }, given, { now, isWorking, columns, limits: options.limits })
}

/** Where no line is drawn (the phone, the IDE), the same line as the session's status text. */
async function mirror($: Engine) {
  const surfaces = await $.session.surfaces().catch(() => [] as string[])
  const isRemote = options.placement !== 'off' && surfaces.some(s => s === 'mobile' || s === 'vscode')
  const world = await read($, WORLD)
  const artifacts = isRemote ? await read($, ARTIFACTS) : []
  const line = isRemote ? plain(fit(await segmentsFor($, world.isWorking, 160), 160)) : ''
  const text = artifacts.length > 0 ? [artifactsLabel(artifacts.length), line].filter(Boolean).join(PLAIN_SEPARATOR) : line
  if (text) {
    $.ui.status(text)
    mirrored = true
  } else if (mirrored) {
    $.ui.status(undefined)
    mirrored = false
  }
}

/** Once a second: countdowns on the line move, and the mirror follows every fifteen. */
async function tick($: Engine) {
  const now = await $.clock.now()
  const given = Object.values(await read($, SEGMENTS))
  if (given.some(s => s.parts.some(p => 'until' in p))) $.ui.invalidate('ui.render')
  await animate($)
  if (now - lastMirror >= 15_000) {
    lastMirror = now
    await mirror($).catch(() => undefined)
  }
}

export const register: Register = (on, rawOptions) => {
  options = readOptions(rawOptions)
  frames = undefined
  framesMs = 0

  // `$.statusline` for the other mods. The bottom answers nothing; the hooks below are what does.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    return {
      ...built,
      statusline: {
        set: async () => ({ isShown: false }),
        remove: async () => ({ isRemoved: false }),
      },
    }
  })

  on('statusline.set', async ($, e) => {
    if (!isSegment(e)) return { value: { isShown: false } }
    await update($, SEGMENTS, s => ({ ...s, [e.id]: e }))
    await animate($)
    return { value: { isShown: options.placement !== 'off' } }
  })

  on('statusline.remove', async ($, e) => {
    const id = typeof e.id === 'string' ? e.id : ''
    const had = id in (await read($, SEGMENTS))
    if (had) {
      await update($, SEGMENTS, s => {
        const { [id]: _, ...rest } = s
        return rest
      })
    }
    return { value: { isRemoved: had } }
  })

  on('session.start', async ($, e, next) => {
    await refreshWorld($, true).catch(() => undefined)
    await recoverArtifacts($).catch(() => undefined)
    $.clock.every(1_000, () => void tick($))
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.permission_mode !== undefined) permissionMode = e.permission_mode
    if (e.context_tokens) await setWorld($, () => ({ contextTokens: e.context_tokens, ...(e.model ? { model: e.model } : {}) }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', { reason: 'clear' }, async ($, e, next) => {
    await setWorld($, () => ({ contextTokens: undefined }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setWorld($, () => ({ isWorking: true }))
    await animate($)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (e.agentId === undefined && result.usage !== null) {
      const u = result.usage
      await setWorld($, () => ({
        model: u.model,
        contextTokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        ...(e.effort !== undefined ? { effort: String(e.effort) } : {}),
      }))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await setWorld($, () => ({ isWorking: false }))
    await animate($)
    await refreshWorld($, false).catch(() => undefined)
    return result
  })

  // The plan's windows move between turns too (other sessions use them): the engine says when.
  on('session.measure', async ($, e, next) => {
    await setWorld($, () => ({
      window: e.context.window,
      limits: e.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt === undefined ? undefined : Date.parse(l.resetsAt) })),
    }))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || result.skip !== undefined) return result
    await setWorld($, () => ({ contextTokens: undefined }))
    // The window was re-read: the threshold may move with it.
    await refreshWorld($, true).catch(() => undefined)
    return result
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && !r.isError && r.text) {
      await notePublish($, e as unknown as Record<string, unknown>, r.text, await $.clock.now()).catch(() => undefined)
    }
    return r
  }).catch(($, e, next) => next(e))

  // The mode labels the hint's row; every classic hook reports it, so the line knows its room.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.permission_mode !== undefined) permissionMode = e.permission_mode
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.Stop', async ($, e, next) => {
    if (e.permission_mode !== undefined) permissionMode = e.permission_mode
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (options.placement !== 'line' && options.placement !== 'tail') return next(e)

    const columns = e.viewport?.columns ?? 100
    const segments = await segmentsFor($, e.props.isWorking, columns)

    if (options.placement === 'tail') {
      const shown = fit(segments, columns - width(e.props.hint) - 4)
      if (shown.length === 0) return next(e)
      return next({ ...e, props: { ...e.props, tail: `  ${plain(shown)}` } })
    }

    const artifacts = await read($, ARTIFACTS)
    const isOpen = await read($, ARTIFACTS_OPEN)
    const hint = condenseHint(e.props.hint, { dropArtifacts: artifacts.length > 0 })
    const pill = artifacts.length > 0 ? `${artifactsLabel(artifacts.length)} ${isOpen ? '▾' : '▸'}` : ''
    // The engine draws its indent, mode label ("⏵⏵ auto mode on") and a " · " before this tree, on the
    // same row. The tree is exactly as wide as what is left: width 100% pushed that dot onto a row of
    // its own, and the engine's row does not hand a growing tree its free width.
    const room = Math.max(10, columns - rowLead(permissionMode) - 1)
    const leftWidth = Math.min(width(hint) + width(pill) + (pill && hint ? 2 : 0), 40)
    const shown = fit(segments, room - leftWidth - 4)
    const { Box, Text, Button } = $.ui.resolve(e)

    // With nothing left of the line, the engine's " · " after its mode label would lead nowhere: the
    // tree starts two cells earlier and covers the dot with blanks.
    const isBare = !pill && !hint && permissionMode !== 'default'
    return (
      <Box flexDirection="row" justifyContent="space-between" width={isBare ? room + 2 : room} marginLeft={isBare ? -2 : 0}>
        {isBare ? <Text>{'  '}</Text> : null}
        <Box flexShrink={1} marginRight={3}>
          {pill ? <Button key="artifacts" plain dimColor label={pill} onPress={() => void update($, ARTIFACTS_OPEN, v => !v)} /> : null}
          {pill && hint ? <Text color={COLORS.faint}>{'  '}</Text> : null}
          <Text color={COLORS.label} wrap="truncate-end">
            {hint}
          </Text>
        </Box>
        <Box flexShrink={0} marginRight={1}>
          {shown.flatMap((s, i) => [
            ...(i > 0 ? [<Text color={COLORS.faint}>{SEPARATOR}</Text>] : []),
            ...s.parts.map(p =>
              p.tone === 'glint' ? (
                <Text color={COLORS.glint} bold>
                  {p.text}
                </Text>
              ) : (
                <Text color={COLORS[p.tone]}>{p.text}</Text>
              ),
            ),
          ])}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const artifacts = (await read($, ARTIFACTS_OPEN)) ? await read($, ARTIFACTS) : []
    const segments = options.placement === 'band' ? fit(await segmentsFor($, e.props.isWorking, e.props.bodyColumns), e.props.bodyColumns) : []
    if (artifacts.length === 0 && segments.length === 0) return next(e)

    const now = await $.clock.now()
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        {artifacts.length > 0 ? (
          <Box key="artifacts" flexDirection="column">
            <Box flexDirection="row" justifyContent="space-between">
              <Text color={COLORS.label}>{artifactsLabel(artifacts.length)} published this session</Text>
              <Button key="close-artifacts" plain dimColor label="close" onPress={() => void update($, ARTIFACTS_OPEN, () => false)} />
            </Box>
            {artifacts.map(a => (
              <Box key={a.url} flexDirection="row">
                <Text>{'  '}</Text>
                <Link href={a.url} label={a.title} />
                <Text color={COLORS.faint}>{`  v${a.version} · ${ago(a.updatedAt, now)}  `}</Text>
                <Text color={COLORS.label} wrap="truncate-end">
                  {shortUrl(a.url)}
                </Text>
              </Box>
            ))}
          </Box>
        ) : null}
        {segments.length > 0 ? (
          <Box key="segments" flexDirection="row" justifyContent="flex-end">
            {segments.flatMap((s, i) => [
              ...(i > 0 ? [<Text color={COLORS.faint}>{SEPARATOR}</Text>] : []),
              ...s.parts.map(p => (
                <Text color={COLORS[p.tone]} bold={p.tone === 'glint'}>
                  {p.text}
                </Text>
              )),
            ])}
          </Box>
        ) : null}
        {below ?? null}
      </Box>
    )
  })
}
