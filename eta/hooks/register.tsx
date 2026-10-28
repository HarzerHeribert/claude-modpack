import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, Timer } from 'claude-code'

import { commandLabel, compile, describe, feed } from './estimate'
import { BEAT_MS, table } from './table'
import type { Tone } from './table'
import type { Job } from '../types'

const jobs = atom({ plugin: 'eta', key: 'jobs' } as const, [] as Job[])
const tzOffset = atom({ plugin: 'eta', key: 'tzOffsetMin' } as const, null as number | null)
const seen = atom({ plugin: 'eta', key: 'seen' } as const, [] as string[])

/** smart-compact's palette: in Claude Code's themes "inactive" is the readable grey, "subtle" the dim one. */
const COLORS: Record<Tone, Color> = {
  accent: 'claude',
  good: 'success',
  bad: 'error',
  warn: 'warning',
  text: 'text',
  label: 'inactive',
  faint: 'subtle',
  glint: 'text',
}

const TOOL = 'track_progress'
const POLL_MS = 4000
/** A failure the person has not seen stays this long at most. */
const KEEP_FAILED_MS = 10 * 60_000
/** A job that writes its state and whose file has not grown this long has stopped. */
const STALE_MS = 20 * 60_000
const CHUNK = 512 * 1024
const CHUNKS_PER_TICK = 32
const REMOTE = new Set(['mobile', 'vscode'])

const TOOL_DESCRIPTION = `Shows the person a job's progress as a percentage and an estimated finish time, read live from the output it writes, so they can see when a long or background job will likely be done. The estimate keeps updating by itself while the job runs; you don't need to check on it.

Call it in the same response as your other tool calls, right after starting a job that runs for minutes and prints countable progress: a background command (pass its task id), or anything else that writes a log (pass a short name and the file). Say how progress shows:
- done_pattern and total: every output line the pattern matches is one unit of total (for example "^  \\S+ (RESOLVED|no) " with total 90).
- or progress_pattern: a line holding the progress, with groups (done)(total) or one group with a percentage.
Common progress output (tqdm, pytest, cargo, git, rsync, wget, curl, pip, Keras, "[3/10]", "step 3 of 10", "123/456 files") is read without a pattern. Add expected_minutes when you can estimate the whole job's length; for a job already running, started_minutes_ago.`

let ticker: Timer | undefined
let busy = false
let statusShown = false
let frames: Timer | undefined
let frameMs = 0

/**
 * Redraws for the band while it moves: the spinner turns four times a second while a job runs,
 * and a finished job's glint runs at 80 ms for its one second. Nothing runs when nothing moves.
 */
function syncFrames($: EngineInterface, list: readonly Job[], now: number) {
  const isBeat = list.some(j => j.status === 'completed' && j.endedAt !== undefined && now - j.endedAt < BEAT_MS)
  const want = isBeat ? 80 : list.some(j => j.status === 'running') ? 250 : 0
  if (want === frameMs) return
  frames?.cancel()
  frames = undefined
  frameMs = want
  if (want > 0) frames = $.clock.every(want, () => void frame($).catch(() => undefined))
}

async function frame($: EngineInterface) {
  $.ui.invalidate('ui.render')
  syncFrames($, await read($, jobs), await $.clock.now())
}

/** What stays: running jobs, a finished or stopped one through its beat, a failure until seen or ten minutes old. */
function remaining(list: readonly Job[], now: number, seenIds: readonly string[]) {
  return list.filter(j => {
    if (j.status === 'running') return true
    const age = now - (j.endedAt ?? now)
    if (j.status === 'failed') return !seenIds.includes(j.id) && age < KEEP_FAILED_MS
    return age < BEAT_MS + 1_000
  })
}

/** Reads what the job's file gained since the last look, in chunks, and feeds it to the estimate. */
async function poll($: EngineInterface, job: Job, now: number): Promise<Job> {
  if (!job.file) return job
  const st = await $.fs.stat(job.file).catch(() => undefined)
  if (!st || st.kind !== 'file') return job
  let j = st.size < job.offset ? { ...job, offset: 0, carry: '' } : job
  for (let n = 0; n < CHUNKS_PER_TICK && j.offset < st.size; n++) {
    const want = Math.min(CHUNK, st.size - j.offset)
    const r = await $.process.run(['/bin/sh', '-c', 'tail -c +"$1" "$2" | head -c "$3"', 'sh', String(j.offset + 1), job.file, String(want)])
    if (r.exitCode !== 0) break
    j = { ...feed(j, r.stdout, now), offset: j.offset + want, grewAt: now }
    if (j.status !== 'running') break
  }
  const measured = j.statusLine || j.frac !== undefined || j.done > 0
  if (j.status === 'running' && measured && now - (j.grewAt ?? j.startedAt) >= STALE_MS) {
    j = { ...j, status: 'failed', lastLine: 'no update for 20 min', endedAt: now }
  }
  return j
}

async function tick($: EngineInterface) {
  if (busy) return
  busy = true
  try {
    const now = await $.clock.now()
    const polled = new Map<string, Job>()
    for (const j of await read($, jobs)) {
      if (j.status === 'running') polled.set(j.id, await poll($, j, now))
    }
    const seenIds = await read($, seen)
    const list = await update($, jobs, cur => remaining(cur.map(c => (c.status === 'running' && polled.get(c.id)) || c), now, seenIds))
    await showStatus($, list, now)
    syncFrames($, list, now)
    $.ui.invalidate('ui.render')
    if (list.length === 0) {
      ticker?.cancel()
      ticker = undefined
    }
  } finally {
    busy = false
  }
}

function ensureTicking($: EngineInterface) {
  if (ticker === undefined) ticker = $.clock.every(POLL_MS, () => void tick($).catch(() => undefined))
}

/**
 * The band above the prompt is drawn on the terminal and the desktop app only; mobile and VS Code get
 * the same news as this plugin's status line, while one of them is attached. A terminal session seen
 * over Remote Control has neither: there only the tool's reply reaches the viewer.
 */
async function showStatus($: EngineInterface, list: readonly Job[], now: number) {
  const remote = (await $.session.surfaces().catch(() => [] as string[])).some(s => REMOTE.has(s))
  const running = list.filter(j => j.status === 'running')
  if (!remote || running.length === 0) {
    if (statusShown) $.ui.status(undefined)
    statusShown = false
    return
  }
  const tz = await read($, tzOffset)
  const parts = running.slice(0, 2).map(j => {
    const d = describe(j, now, tz)
    return `${d.label} ${d.progress.replace(/^[▰▱]+ /, '')} ${d.eta}`.replace(/\s+/g, ' ').trim()
  })
  const more = running.length > 2 ? ` · +${running.length - 2} more` : ''
  $.ui.status(`⏳ ${parts.join(' · ')}${more}`)
  statusShown = true
}

async function addJob($: EngineInterface, job: Job) {
  await update($, jobs, cur => [...cur.filter(c => c.id !== job.id), job])
  ensureTicking($)
}

async function finish($: EngineInterface, id: string, status: Job['status']) {
  const now = await $.clock.now()
  const list = await read($, jobs)
  const job = list.find(j => j.id === id && j.status === 'running')
  if (!job) return
  const last = await poll($, job, now)
  await update($, jobs, cur => cur.map(c => (c.id === id ? { ...last, status: last.status === 'running' ? status : last.status, endedAt: now } : c)))
  void tick($).catch(() => undefined)
}

type TrackInput = {
  task?: unknown
  file?: unknown
  label?: unknown
  done_pattern?: unknown
  progress_pattern?: unknown
  finished_pattern?: unknown
  total?: unknown
  expected_minutes?: unknown
  started_minutes_ago?: unknown
  stop?: unknown
  status_line?: unknown
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

/** The running background task that writes `file`: its own output file, or a file its command names. */
function writerOf(list: readonly Job[], file: string): Job | undefined {
  const name = file.split('/').pop() ?? ''
  const named = name.length > 3 && new RegExp(`(^|[\\s>=/'"])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[\\s'";|&)])`)
  return list.find(j => j.status === 'running' && j.source === 'background'
    && (j.file === file || (j.command !== undefined && (j.command.includes(file) || (named !== false && named.test(j.command))))))
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

async function track($: EngineInterface, i: TrackInput): Promise<string> {
  const id = str(i.task)
  if (!id) return 'track_progress needs `task`: a background task id, or a short name for the job.'
  const now = await $.clock.now()
  const list = await read($, jobs)
  const named = list.find(j => j.id === id)
  if (i.stop === true) {
    await update($, jobs, cur => cur.filter(c => c.id !== id))
    void tick($).catch(() => undefined)
    return `Stopped showing ${id}.`
  }
  for (const key of ['done_pattern', 'progress_pattern', 'finished_pattern'] as const) {
    if (str(i[key]) && !compile(str(i[key]))) return `${key} is not a valid regular expression.`
  }
  const file = str(i.file) ?? named?.file
  if (!file) return `No file to read for ${id}: pass the log or output file the job writes, or the id of a background task Claude Code started.`
  const st = await $.fs.stat(file).catch(() => undefined)
  if (!st || st.kind !== 'file') return `${file} is not a file I can read.`
  // A log a running background command writes, tracked under a name of its own: the same job, so it
  // stays one row, under the task's id (its notification ends it).
  const existing = named ?? writerOf(list, file)
  const ago = num(i.started_minutes_ago)
  const startedAt = existing?.startedAt ?? (ago ? now - ago * 60_000 : now)
  const fromStart = existing?.source === 'background' || ago !== undefined
  let job: Job = {
    id: existing?.id ?? id,
    label: str(i.label) ?? existing?.label ?? id,
    source: existing?.source ?? 'claude',
    file,
    command: existing?.command,
    donePattern: str(i.done_pattern) ?? existing?.donePattern,
    progressPattern: str(i.progress_pattern) ?? existing?.progressPattern,
    finishedPattern: str(i.finished_pattern) ?? existing?.finishedPattern,
    statusLine: typeof i.status_line === 'boolean' ? i.status_line : existing?.statusLine,
    lastLine: existing?.lastLine,
    total: num(i.total) ?? existing?.total,
    expectedMs: num(i.expected_minutes) ? (i.expected_minutes as number) * 60_000 : existing?.expectedMs,
    startedAt,
    offset: 0,
    grewAt: now,
    carry: '',
    done: 0,
    samples: fromStart ? [[startedAt, 0]] : [],
    status: 'running',
  }
  job = await poll($, job, now)
  await addJob($, job)
  const tz = await read($, tzOffset)
  const d = describe(job, now, tz)
  const read_ = d.progress ? `${d.progress.replace(/^[▰▱]+ /, '')}, ${d.eta}` : d.eta
  const as = job.id === id ? '' : ` (as background task ${job.id}, which writes it)`
  return `Showing "${job.label}" to the person${as}: ${read_}. It updates by itself from ${file}.`
}

export const register: Register = (on, options) => {
  if (options.enabled === false) {
    // Off: a tool registered earlier may outlive the reload, so only its call is answered.
    on('tool.call', { tool: 'mcp__eta__track_progress' }, () => ({ result: 'eta is turned off (/mods turns it on).' }))
    return
  }
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The background task id, or a short name for a job started another way.' },
          file: { type: 'string', description: 'The log or output file the job writes; not needed for a background task Claude Code started.' },
          label: { type: 'string', description: 'A few words the person will recognise the job by.' },
          done_pattern: { type: 'string', description: 'Regular expression: each output line it matches is one unit done.' },
          total: { type: 'number', description: 'How many units make the whole job (with done_pattern).' },
          progress_pattern: { type: 'string', description: 'Regular expression for a progress line: groups (done)(total), or one group with a percentage.' },
          finished_pattern: { type: 'string', description: 'Regular expression for a line that means the job finished.' },
          expected_minutes: { type: 'number', description: 'Your estimate of the whole job’s duration, shown until progress is measurable.' },
          started_minutes_ago: { type: 'number', description: 'For a job already running: how long ago it started.' },
          status_line: { type: 'boolean', description: "Show the file's last line beside the job: for jobs that write their state rather than countable progress." },
          stop: { type: 'boolean', description: 'Stop showing this job.' },
        },
        required: ['task'],
      },
    })
    const tz = await $.process.run(['/bin/date', '+%z']).catch(() => undefined)
    const m = tz?.stdout.trim().match(/^([+-])(\d{2})(\d{2})$/)
    if (m) await update($, tzOffset, () => (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])))
    if ((await read($, jobs)).length > 0) ensureTicking($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent's tool call carries its agentId; the main loop's does not.
    const fromSubagent = (e as { agentId?: unknown }).agentId !== undefined
    if (e.tool.endsWith(`__${TOOL}`)) {
      if (fromSubagent) return { result: 'track_progress shows jobs to the person from the main conversation only; nothing is shown for a subagent\'s job.' }
      return { result: await track($, e as TrackInput) }
    }
    const r = await next(e)
    if (r.deny !== undefined) return r
    if (e.tool === 'TaskStop' && !r.isError) {
      const input = e as { task_id?: unknown; shell_id?: unknown }
      const id = str(input.task_id) ?? str(input.shell_id)
      if (id) await finish($, id, 'killed')
      return r
    }
    if (e.tool !== 'Bash' || r.isError) return r
    const id = (r.result as { backgroundTaskId?: unknown } | undefined)?.backgroundTaskId
    if (typeof id !== 'string' || fromSubagent) return r
    const input = e as { command?: unknown; description?: unknown }
    const now = await $.clock.now()
    const file = (r.text ?? '').match(/written to:?\s+(\S+?\.output)\b/)?.[1]
    const label = str(input.description) ?? (str(input.command) ? commandLabel(String(input.command)) : id)
    await addJob($, {
      id, label, source: 'background', file, command: str(input.command), startedAt: now, offset: 0, carry: '', done: 0,
      samples: [[now, 0]], status: 'running',
    })
    const hint = `Background task ${id} now shows the person its elapsed time. If its output will show countable progress, call ${TOOL} for it in your next response, alongside your other calls, so they also see a percentage and an ETA.`
    return { ...r, context: [...(r.context ?? []), hint] }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    // The person writes again: the failures on the band have been seen, and leave it.
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      const failed = (await read($, jobs)).filter(j => j.status === 'failed').map(j => j.id)
      if (failed.length > 0) await update($, seen, s => [...new Set([...s, ...failed])])
    }
    if (e.origin.kind === 'task-notification') {
      for (const j of await read($, jobs)) {
        if (j.status !== 'running' || j.source !== 'background' || !e.text.includes(j.id)) continue
        const word = e.text.match(/<status>\s*(\w+)/)?.[1] ?? 'completed'
        await finish($, j.id, word === 'failed' ? 'failed' : word === 'killed' || word === 'stopped' ? 'killed' : 'completed')
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Its own tool call reads as one line: what is shown, from which file. Where the band carries the
  // progress (terminal, desktop), the tool's reply draws nothing under it; elsewhere it is the only news.
  on('ui.render', { component: 'ToolUse', props: { tool: `mcp__eta__${TOOL}` } }, async ($, e, next) => {
    const i = (e.props.input ?? {}) as TrackInput
    const task = str(i.task)
    // ctrl+o and --verbose draw rows in full: the call as Claude Code draws it there.
    if (!task || e.props.isExpanded) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const file = str(i.file)?.split('/').pop()
    const total = num(i.total)
    const what = i.stop === true ? `stopped showing ${task}` : `showing ${str(i.label) ?? task} above the prompt`
    const detail = i.stop === true ? '' : [total ? `${total} steps` : '', file ? `from ${file}` : ''].filter(Boolean).join(' · ')
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={COLORS.accent}>⏳</Text>
        <Text>{what}</Text>
        {detail ? <Text color={COLORS.faint}>{`· ${detail}`}</Text> : null}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolResult', props: { tool: `mcp__eta__${TOOL}` } }, async ($, e, next) => {
    if (e.props.isErrored || e.props.isExpanded || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    const text = typeof e.props.output === 'string' ? e.props.output : ''
    // A reply that is not the usual "Showing … to the person" (a bad pattern, no file) stays readable.
    if (text !== '' && !/^(Showing|Stopped showing)/.test(text)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, jobs)
    if (e.props.hasSurvey || list.length === 0) return next(e)
    const now = await $.clock.now()
    const view = { seen: await read($, seen) }
    const rows = table(list, now, await read($, tzOffset), e.props.bodyColumns, view)
    if (rows.length === 0) return next(e)
    syncFrames($, list, now)
    const { Box, Text } = $.ui.resolve(e)
    const drawn = rows.map(r => (
      <Box key={r.key} flexDirection="row">
        {r.parts.map(p => (
          <Text color={COLORS[p.tone]} bold={p.tone === 'glint'}>
            {p.text}
          </Text>
        ))}
      </Box>
    ))
    const below = await next(e)
    return (
      <Box flexDirection="column">
        {drawn}
        {below ?? null}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
