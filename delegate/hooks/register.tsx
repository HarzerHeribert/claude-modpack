import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  DEFAULT_REVIEW,
  WORKER_RULES,
  REVIEW_PROMPT,
  anchorOn,
  capLines,
  costUsd,
  TEXT_SEARCH_CAP,
  definitionPattern,
  gitDefinitionPattern,
  describeReach,
  parseWorker,
  diffStat,
  filesOf,
  kTokens,
  mainAloneUsd,
  money,
  parseFocus,
  parseLocations,
  parseVerdict,
  places,
  reviewRoute,
  summarize,
  tokensOf,
  workerPrompt,
} from './plan'
import type { Anchor, HandOff, Kind, Mode, Place, Reach, Usage } from './plan'
import type { DelegateJob } from '../types'
import { FRAME_MS, actionLabel, jobCard, pane, usd, verb } from './view'
import type { Elements } from './view'

type Engine = EngineInterface

const TOOL = 'hand_off'
const AGENT: { [K in Kind]: string } = { read: 'reader', mechanical: 'mechanic', build: 'builder' }
const MODE: { [K in Kind]: Mode } = { read: 'explore', mechanical: 'edit', build: 'edit' }
// The engine's tool-name type lists only tools it knows; implement_spec is registered at run time by `framing`.
const HAND_OFF_TOOLS = ['mcp__delegate__hand_off', 'mcp__delegate__implement_spec'] as unknown as 'mcp__delegate__hand_off'[]
const WORKER_TOOLS: { [K in Kind]: string[] } = {
  read: ['Read', 'Grep', 'Glob', 'LSP', 'Bash'],
  mechanical: ['Read', 'Grep', 'Glob', 'LSP', 'Bash', 'Edit', 'Write'],
  build: ['Read', 'Grep', 'Glob', 'LSP', 'Bash', 'Edit', 'Write'],
}
const MAX_FOCUS = 6
const DIFF_LINES = 300

const RETURNS = {
  tool: 'It returns when the worker is done (usually within a minute or two) with its report and evidence the tool gathered itself',
  message: "It returns at once; the worker's report arrives as a notification when it finishes, with evidence the tool gathered itself",
}
const describe = (wait: Wait) => `Outsources one self-contained task to a cheaper worker model. ${RETURNS[wait]}: for edit work the diff and the result of a check command it runs, where the change reaches (references, callers and doc mentions from the language server), and what the work cost.

Each of your own steps re-reads your whole context; a worker's steps read only its own small one, but the hand-off itself takes you two to five steps (writing the task, reading the evidence, finishing). Measured on real tasks at the same quality: a feature from a precise spec and tests to a coverage target cost 27-37% less handed off, in a fresh session and in one holding 233k tokens; lookups, traces, explanations and small edits cost more handed off, up to 3.6 times as much in a session that already knows the code.

Outsource work that is fully specified and would take you many steps in this session, where only the result matters to you: implementing a feature from a precise spec, writing tests to a target, one change applied across many files.
The "kind" you give decides the worker: read changes no file (find, list, trace, explain); mechanical changes files and the task spells out every change (a rename, one edit applied everywhere, moving code); build changes files and something is left to work out (a feature from a spec, tests to a target).
Keep in house: lookups, tracing, explanations and small edits, design decisions, subtle debugging, and anything that depends on what was decided in this conversation unless the task states it. The worker knows only the task text.

Write the task so it stands alone: the goal, the files or symbols, constraints, and what done means. Name the symbols or file:line places it touches in focus so the tool can find where they are used. For edit work, give a check command (tests, a type check) that proves it. Don't edit the files an edit hand-off works on until its report is in.

Judge what comes back by the diff and the check output, not by the worker's report. A follow-up task reaches the same worker while it is warm, its earlier reading still in its context. With background, the call returns at once and the report arrives as a notification: use it when you have other work to do meanwhile.`

const CAPABILITY = 'implement_spec'
const describeCapability = () => `Implements a precisely specified change and proves it. Give it the spec (what to build, where, the constraints, what done means) and a check command (tests, a type check); it makes the change in the working tree and returns the diff, the check's output, where the change reaches (references, callers and doc mentions from the language server), and what it cost. Use it for work that is fully specified and takes many steps: a feature from a precise spec, tests to a coverage target, one change applied in many places. Keep lookups, tracing, explanations, design decisions and debugging yourself. Judge the result by the diff and the check output. Don't edit the files it works on until it returns.`

type Wait = 'tool' | 'message'
/** The longest a hand-off holds the tool call; past it the report comes as a message. */
const HOLD_MS = 30 * 60_000

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    task: { type: 'string', description: 'The whole task, standing alone: goal, files or symbols, constraints, what done means.' },
    kind: {
      type: 'string',
      enum: ['read', 'mechanical', 'build'],
      description:
        'read: changes no file (find, list, trace, explain). mechanical: changes files, and the task spells out every change (a rename, one edit applied everywhere, moving code). build: changes files, and something is left to work out (a feature from a spec, tests to a target).',
    },
    focus: {
      type: 'array',
      items: { type: 'string' },
      description: 'Symbols or places the task touches: "name", "path#name" or "path:line". The tool asks the language server where they are used.',
    },
    check: { type: 'string', description: 'Edit mode: a shell command that proves the work (tests, a type check). Run by this tool after the worker finishes.' },
    fresh: { type: 'boolean', description: 'Start a new worker instead of continuing the warm one.' },
    background: {
      type: 'boolean',
      description: 'Return at once and let the report arrive as a notification, so you can work on something else meanwhile. Without it the call waits for the report, which costs you fewer requests.',
    },
  },
  required: ['task', 'kind'],
}

const CAPABILITY_SCHEMA = {
  type: 'object',
  properties: {
    spec: { type: 'string', description: 'The whole spec, standing alone: goal, files or symbols, constraints, what done means.' },
    check: { type: 'string', description: 'A shell command that proves the work.' },
    focus: INPUT_SCHEMA.properties.focus,
    background: INPUT_SCHEMA.properties.background,
  },
  required: ['spec', 'check'],
}

const workers: { [K in Kind]: { model: string; effort?: string } } = { read: { model: 'haiku' }, mechanical: { model: 'haiku' }, build: { model: 'sonnet' } }
let framing: 'hand_off' | 'capability' = 'hand_off'
let review = 'inline'
let reuseMs = 50 * 60_000
let capTokens = 60_000
let wait: Wait = 'tool'
let afterPlan: 'hand_off' | 'off' = 'off'
// Set once auto mode (the desktop app) has refused a worker start; reset in session.start.
let autoModeBlocked = false

export function isAutoModeBlock(deny: string): boolean {
  return /auto mode classifier gave no verdict/i.test(deny)
}

/** For tests only. */
export function setAutoModeBlocked(v: boolean): void {
  autoModeBlocked = v
}

/** The tool result for a refused worker start; the first auto-mode refusal also tells the person. */
export async function refusedStart($: Engine, deny: string): Promise<{ text: string }> {
  if (!isAutoModeBlock(deny)) return { text: `The worker did not start: ${deny}` }
  if (!autoModeBlocked) {
    autoModeBlocked = true
    await $.ui.log('delegate: auto mode in the desktop app cannot judge a worker the mod starts, so hand-offs are off here. They run in manual permission mode (no prompt) or in the terminal.')
  }
  return {
    text: 'Not handed off: auto mode in this app cannot judge a worker that the delegate mod starts (the terminal can). Do this task yourself. Tell the person once, in one sentence: hand-offs run in manual permission mode, where they start without a prompt, or from the terminal.',
  }
}

/** The order attached to an approved plan: implement it through a hand-off. */
export function planOrder(framing: 'hand_off' | 'capability'): string {
  const how = framing === 'capability' ? 'implement_spec' : 'the hand_off tool, kind build (kind mechanical when the plan spells out every change)'
  return `The person approved this plan, and their setting for approved plans is: implement it through ${how}. The approved plan is the worker's spec: write it into the task so it stands alone, with a check command that proves it, wait for the report, check the evidence, then finish yourself.`
}

type Input = { task: string; kind: Kind; mode: Mode; focus: string[]; check?: string; fresh: boolean; background: boolean; worker: string; effort?: string }
const label = (model: string, effort?: string) => (effort ? `${model} ${effort}` : model)
type Done = { answer: string; reason: string }

/** One hand-off from the tool call to the notice of its worker's end. */
type Job = {
  n: number
  toolUseId: string
  agentId: string
  input: Input
  started: number
  reused: boolean
  reach: Reach[]
  reachText: string
  /** Its requests so far, what they cost in tokens, and the size of the last one (the worker's context). */
  requests: number
  usage: Usage
  lastContext: number
  workerModel?: string
  /** Each file the worker edited, as it was before its first edit (null: it did not exist). */
  originals: Map<string, string | null>
  /** The work tree when the hand-off began (a commit of it), and the untracked files then; absent outside git. */
  gitBase?: string
  untracked?: string[]
  /** The report reached the main model; the worker's turn may end a moment later. */
  reported: boolean
  /** The tool call is holding the turn for this worker. */
  holding: boolean
  /** The report went back as the tool's result: the worker's own hand-back message is dropped. */
  returned: boolean
  /** The worker's report, from its hand-back message when that came first. */
  handback?: string
  done?: Done
  ended?: number
  /** eta is showing this hand-off: the status file it reads, and what has been written to it. */
  eta?: { file: string; text: string }
}

type Warm = { agentId: string; at: number; requestTokens: number }

/** The worker kept warm between hand-offs, one per kind. */
const warm = new Map<string, Warm>()
const warmKey = (input: Input) => input.kind
/** Hand-offs whose worker is running or whose notice has not arrived yet, by the worker's agent id. */
const jobs = new Map<string, Job>()
/** Hand-offs reported, written to the log when the main turn that received them ends. */
let records: HandOff[] = []
/** Files reported edit hand-offs changed: the main model's later edits to them count as rework. */
let touched = new Map<string, HandOff>()
/** Workers whose end this mod reported itself (no notice came); a host notice for one is dropped. */
const handedOver = new Set<string>()
let count = 0
let dir = ''
/** True while this mod continues a warm worker: resuming an agent needs its type offered. */
let resuming = false

// What the card and the pane draw: each hand-off by its tool_use_id, and the one the pane has open.
const VIEW = atom({ plugin: 'delegate', key: 'jobs' } as const, [] as DelegateJob[])
const WATCHING = atom({ plugin: 'delegate', key: 'watching' } as const, null as string | null)
const PANE = 'delegate'
let frames: Timer | undefined

const LOST = 'lost track: the mod reloaded or Claude Code restarted while it ran'

/** The running entries whose worker this mod no longer knows (it reloaded, or Claude Code restarted). */
export function lostEntries(view: readonly DelegateJob[], liveAgentIds: ReadonlySet<string>): DelegateJob[] {
  return view.filter(j => j.state === 'running' && !liveAgentIds.has(j.agentId))
}

/** Ends the cards of hand-offs whose worker report can no longer be matched, and their eta rows; never throws. */
export async function reconcile($: Engine): Promise<void> {
  try {
    const lost = lostEntries(await read($, VIEW), new Set(jobs.keys()))
    if (lost.length === 0) return
    const now = await $.clock.now()
    const ids = new Set(lost.map(j => j.toolUseId))
    await update($, VIEW, list => list.map(j => (ids.has(j.toolUseId) && j.state === 'running' && !jobs.has(j.agentId) ? { ...j, state: 'failed' as const, endedAt: now, note: LOST } : j)))
    for (const j of lost) {
      try {
        const file = `${dir}/hand-off-${j.n}.status`
        const text = await $.fs.read(file).catch(() => undefined)
        if (text !== undefined) await $.fs.write(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}failed · lost track\n`)
      } catch {
        // eta is optional.
      }
    }
    await animate($)
  } catch {
    // A stale card is better than a failing hook.
  }
}

async function setView($: Engine, toolUseId: string, change: (j: DelegateJob) => Partial<DelegateJob>) {
  await update($, VIEW, list => list.map(j => (j.toolUseId === toolUseId ? { ...j, ...change(j) } : j)))
}

/** Redraws four times a second while a worker runs; at rest nothing moves. */
async function animate($: Engine) {
  const running = (await read($, VIEW)).some(j => j.state === 'running')
  if (running && frames === undefined) frames = $.clock.every(FRAME_MS, () => $.ui.invalidate('ui.render'))
  else if (!running && frames !== undefined) {
    frames.cancel()
    frames = undefined
    $.ui.invalidate('ui.render')
  }
}

async function openPane($: Engine, toolUseId?: string) {
  if (toolUseId !== undefined) await update($, WATCHING, () => toolUseId)
  await $.ui.open({ id: PANE, title: 'Hand-offs' })
}

/** The worker's report out of its hand-back frame, unindented. */
function reportText(text: string): string {
  const body = /The report follows:\n([\s\S]*?)(?:<\/agent-message>|$)/.exec(text)?.[1] ?? text
  return body
    .split('\n')
    .map(l => l.replace(/^  /, ''))
    .join('\n')
    .trim()
}

const join = (cwd: string, path: string) => (path.startsWith('/') ? path : `${cwd}/${path}`)
const rel = (cwd: string, path: string) => (path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path)

async function git($: Engine, cwd: string, args: string[]): Promise<string | undefined> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 8000 }).catch(() => undefined)
  return r !== undefined && (r.exitCode === 0 || r.exitCode === 1) ? r.stdout : undefined
}

/** Calls the LSP tool the way the model would; a plugin above it (lsp-plus) adds what it adds. */
async function lsp($: Engine, operation: string, a: Anchor): Promise<{ text: string; context: string[] } | undefined> {
  const r = await $.tool
    .call({ tool: 'LSP', operation: operation as 'findReferences', filePath: a.path, line: a.line, character: a.character })
    .catch(() => undefined)
  if (r === undefined || r.deny !== undefined || r.isError) return undefined
  const text = r.text ?? ''
  if (/^(Error performing|No LSP server)/.test(text)) return undefined
  return { text, context: [...(r.context ?? [])] }
}

/** Resolves one focus entry to a place in the code. */
async function anchor($: Engine, cwd: string, raw: string): Promise<{ anchor?: Anchor; name: string }> {
  const f = parseFocus(raw)
  if (f.path !== undefined) {
    const text = await $.fs.read(join(cwd, f.path)).catch(() => undefined)
    if (text === undefined) return { name: f.name ?? raw }
    const lines = text.split('\n')
    let line = f.line
    if (line === undefined && f.name !== undefined) {
      const def = new RegExp(definitionPattern(f.name))
      const at = lines.findIndex(l => def.test(l))
      const any = lines.findIndex(l => new RegExp(`\\b${f.name}\\b`).test(l))
      line = at >= 0 ? at + 1 : any >= 0 ? any + 1 : undefined
    }
    if (line === undefined) return { name: f.name ?? raw }
    const on = anchorOn(lines[line - 1] ?? '', f.name)
    return on ? { name: on.name, anchor: { name: on.name, path: f.path, line, character: on.character } } : { name: f.name ?? raw }
  }
  const name = f.name as string
  const out = await git($, cwd, ['grep', '--untracked', '-n', '-I', '-w', '-E', '-e', gitDefinitionPattern(name), '--', '.', ':(exclude)*.md'])
  const hit = out ? /^(.+?):(\d+):(.*)$/.exec(out.split('\n')[0] ?? '') : null
  if (!hit) return { name }
  const on = anchorOn(hit[3] as string, name)
  return { name, anchor: on ? { name, path: hit[1] as string, line: Number(hit[2]), character: on.character } : undefined }
}

/** Where the task reaches: for each focus entry, references and callers from the language server, else a text search. */
async function reachOf($: Engine, cwd: string, focus: string[]): Promise<Reach[]> {
  const reach: Reach[] = []
  for (const raw of focus.slice(0, MAX_FOCUS)) {
    const { anchor: a, name } = await anchor($, cwd, raw)
    if (a !== undefined) {
      // A language server still indexing answers with the definition alone: give it a few seconds.
      let refs = await lsp($, 'findReferences', a)
      for (let i = 0; i < 3 && refs !== undefined && parseLocations(refs.text, cwd).length <= 1; i++) {
        await $.process.run(['sleep', '3']).catch(() => undefined)
        refs = await lsp($, 'findReferences', a)
      }
      if (refs !== undefined && parseLocations(refs.text, cwd).length > 1) {
        const calls = await lsp($, 'incomingCalls', a)
        reach.push({
          anchor: a,
          name,
          refs: parseLocations(refs.text, cwd).filter(p => !(p.path === a.path && p.line === a.line)),
          callers: calls ? parseLocations(calls.text, cwd) : [],
          docs: refs.context,
          via: 'lsp',
        })
        continue
      }
    }
    const out = await git($, cwd, ['grep', '--untracked', '-n', '-I', '-w', '-F', '-e', name, '--', '.'])
    const refs: Place[] = (out ?? '').split('\n').flatMap(row => {
      const m = /^(.+?):(\d+):/.exec(row)
      return m ? [{ path: m[1] as string, line: Number(m[2]) }] : []
    })
    if (refs.length > TEXT_SEARCH_CAP) reach.push({ anchor: a, name, refs: [], callers: [], docs: [], via: 'none' })
    else reach.push({ anchor: a, name, refs, callers: [], docs: [], via: refs.length > 0 ? 'text' : 'none' })
  }
  return reach
}

/** Continues the warm worker of this mode and model, or starts one. */
async function startWorker($: Engine, input: Input, prompt: string, description: string): Promise<{ agentId: string; reused: boolean; why?: string } | { deny: string }> {
  const { kind, fresh } = input
  const w = warm.get(warmKey(input))
  let why: string | undefined
  const busy = w !== undefined && jobs.get(w.agentId)?.reported === false
  if (!fresh && w !== undefined && !busy && (await $.clock.now()) - w.at < reuseMs && w.requestTokens < capTokens) {
    resuming = true
    const sent = await $.session
      .send({ to: { agentId: w.agentId }, text: prompt })
      .catch(() => ({ isDelivered: false as const, reason: 'failed' }))
      .finally(() => {
        resuming = false
      })
    if (sent.isDelivered) return { agentId: w.agentId, reused: true }
    warm.delete(warmKey(input))
    why = sent.reason
  }
  const r = await $.agent.spawn({ prompt, subagentType: `delegate:${AGENT[kind]}`, description, model: input.worker })
  if (r.deny !== undefined || r.agentId === undefined) return { deny: r.deny ?? 'the worker did not start' }
  return { agentId: r.agentId, reused: false, why }
}

/** The worker's changes against the work tree it started from: what git sees, plus new untracked files. */
async function gitDiff($: Engine, cwd: string, job: Job & { gitBase: string }): Promise<{ diff: string; files: string[] }> {
  const run = (args: string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 15_000 }).then(r => r.stdout).catch(() => '')
  const tracked = await run(['diff', '--no-color', '-M', '-U2', job.gitBase])
  const names = (await run(['diff', '--name-only', '-M', job.gitBase])).split('\n').filter(Boolean)
  const before = new Set(job.untracked ?? [])
  const added = (await run(['ls-files', '--others', '--exclude-standard'])).split('\n').filter(f => f && !before.has(f))
  const fresh: string[] = []
  for (const f of added) fresh.push(await run(['diff', '--no-index', '--no-color', '-U2', '--', '/dev/null', f]))
  return { diff: [tracked, ...fresh].join('').trimEnd(), files: [...names, ...added] }
}

/** The worker's changes as one unified diff, paths relative to the session's folder. */
async function diffOf($: Engine, cwd: string, job: Job): Promise<string> {
  const parts: string[] = []
  let i = 0
  for (const [path, before] of job.originals) {
    const after = await $.fs.read(path).catch(() => null)
    if (after === before) continue
    const old = `${dir}/before-${job.n}-${i++}`
    if (before !== null) await $.fs.write(old, before)
    const a = before === null ? '/dev/null' : old
    const b = after === null ? '/dev/null' : path
    const r = await $.process.run(['git', 'diff', '--no-index', '--no-color', '--no-prefix', '-U2', '--', a, b], { cwd, timeoutMs: 8000 }).catch(() => undefined)
    // --no-prefix prints each absolute path without its leading slash.
    const name = rel(cwd, path)
    if (r !== undefined) parts.push([old, path, old.slice(1), path.slice(1)].reduce((t, p) => t.split(p).join(name), r.stdout))
  }
  return parts.join('').trimEnd()
}

async function runCheck($: Engine, command: string): Promise<{ exit: number; tail: string }> {
  const r = await $.tool.call({ tool: 'Bash', command, timeout: 600_000 }).catch(err => ({ deny: String(err) }))
  if (r.deny !== undefined) return { exit: -1, tail: `not run: ${r.deny}` }
  const text = r.text ?? ''
  const exit = r.isError ? Number(/Exit code (\d+)/.exec(text)?.[1] ?? 1) : 0
  return { exit, tail: text.split('\n').slice(-25).join('\n').trim() }
}

const logFile = async ($: Engine) => `${(await $.env.get('HOME')) ?? ''}/.claude/mods/delegate/log.jsonl`

async function flush($: Engine, done: HandOff[]) {
  if (done.length === 0) return
  const file = await logFile($)
  await $.process.run(['mkdir', '-p', file.slice(0, file.lastIndexOf('/'))])
  const old = await $.fs.read(file).catch(() => '')
  await $.fs.write(file, old + done.map(r => JSON.stringify(r)).join('\n') + '\n')
}

async function readLog($: Engine): Promise<HandOff[]> {
  const text = await $.fs.read(await logFile($)).catch(() => '')
  return text.split('\n').flatMap(line => {
    try {
      return line ? [JSON.parse(line) as HandOff] : []
    } catch {
      return []
    }
  })
}

const ETA_TOOL = 'mcp__eta__track_progress'

/** One line of the status file eta shows beside the hand-off: its requests, cost and latest action. */
export function etaStatusLine(job: { requests: number; usd: number }, action?: { tool: string; label: string }): string {
  const tail = action === undefined ? '' : ` · ${verb(action.tool)} ${action.label}`.replace(/\s+/g, ' ').trimEnd()
  return `${job.requests} req · ${usd(job.usd)}${tail}`.slice(0, 120)
}

/** Appends a line to the hand-off's status file; never throws. */
export async function writeEta($: Engine, job: { eta?: { file: string; text: string } }, line: string): Promise<void> {
  const eta = job.eta
  if (eta === undefined) return
  try {
    eta.text += `${line.replace(/\s*[\r\n]+\s*/g, ' ')}\n`
    await $.fs.write(eta.file, eta.text)
  } catch {
    // eta is optional; the hand-off goes on without it.
  }
}

/** Asks eta, when it is present, to show hand-off n beside the prompt. Returns what to remember on the job; never throws. */
export async function trackInEta($: Engine, dir: string, n: number, worker: string): Promise<{ file: string; text: string } | undefined> {
  try {
    if (!(await $.tool.list()).some(t => t.name === ETA_TOOL)) return undefined
    const file = `${dir}/hand-off-${n}.status`
    const text = `starting · ${worker}\n`
    await $.fs.write(file, text)
    await $.tool.call({
      tool: ETA_TOOL, task: `hand-off-${n}`, label: `hand-off ${n} · ${worker}`, file, finished_pattern: '^(done|failed) ·', status_line: true,
    } as never).catch(() => undefined)
    return { file, text }
  } catch {
    return undefined
  }
}

/** hand_off: where the task reaches, then the worker, started or continued. */
async function start($: Engine, toolUseId: string, input: Input): Promise<{ text: string; agentId?: string }> {
  const cwd = await $.session.cwd()
  const started = await $.clock.now()
  const reach = await reachOf($, cwd, input.focus)
  const reachText = describeReach(reach)
  const prompt = workerPrompt({ task: input.task, mode: input.mode, reach: reachText, check: input.check })
  const description = input.task.trim().split('\n')[0]?.slice(0, 60) ?? 'hand-off'
  // The work tree as it is now, so the worker's changes can be told apart, however it makes them (Edit, sed, git mv).
  const stash = input.mode === 'edit' ? await git($, cwd, ['stash', 'create']) : undefined
  const gitBase = stash === undefined ? undefined : stash.trim() || (await git($, cwd, ['rev-parse', 'HEAD']))?.trim() || undefined
  const untracked = gitBase === undefined ? undefined : ((await git($, cwd, ['ls-files', '--others', '--exclude-standard'])) ?? '').split('\n').filter(Boolean)
  const worker = await startWorker($, input, prompt, description)
  if ('deny' in worker) return refusedStart($, worker.deny)
  handedOver.delete(worker.agentId)
  jobs.set(worker.agentId, {
    n: ++count,
    toolUseId,
    agentId: worker.agentId,
    input,
    started,
    reused: worker.reused,
    reach,
    reachText,
    requests: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    lastContext: 0,
    originals: new Map(),
    reported: false,
    holding: !input.background,
    returned: false,
    gitBase,
    untracked,
  })
  const refs = reach.reduce((k, r) => k + r.refs.length, 0)
  await update($, VIEW, list => [
    ...list.slice(-29),
    {
      n: count,
      toolUseId,
      agentId: worker.agentId,
      mode: input.mode,
      task: input.task.trim(),
      model: input.worker,
      effort: input.effort,
      reused: worker.reused,
      reach: refs,
      startedAt: started,
      background: input.background === true,
      state: 'running',
      requests: 0,
      usd: 0,
      actions: [],
    } satisfies DelegateJob,
  ])
  const made = jobs.get(worker.agentId)
  if (made !== undefined) made.eta = await trackInEta($, dir, made.n, label(input.worker, input.effort))
  await animate($)
  const reachLine = reach.length > 0 ? ` It was told where the task reaches: ${refs} reference${refs === 1 ? '' : 's'}.` : ''
  const cold = worker.why === undefined ? '' : ` (the warm one could not be reached: ${worker.why})`
  const later = `Its report arrives as a notification when it finishes, with ${input.mode === 'edit' ? `the diff${input.check ? ', the check' : ''} and ` : ''}what it cost. Carry on with other work meanwhile, or end your turn to wait.`
  return { text: `The ${worker.reused ? 'warm' : 'new'} ${label(input.worker, input.effort)} worker (${worker.agentId}) is on it${cold}.${reachLine}${input.background ? ` ${later}` : ''}`, agentId: worker.agentId }
}

/** The report reached the main model (as the tool's result or a message): log it, keep the worker warm, update the card. */
async function deliver($: Engine, job: Job, reportBody: string): Promise<string> {
  job.reported = true
  job.ended ??= await $.clock.now()
  if (job.done === undefined || job.done.reason === 'answer') warm.set(warmKey(job.input), { agentId: job.agentId, at: job.ended, requestTokens: job.lastContext })
  const made = await report($, job).catch(err => ({ text: `The delegate mod could not gather the evidence: ${String(err)}`, record: undefined }))
  const rec = made.record
  await setView($, job.toolUseId, () => ({
    state: 'reported',
    endedAt: job.ended,
    report: reportBody,
    ...(rec === undefined
      ? {}
      : { usd: rec.workerUsd, aloneUsd: rec.mainAloneUsd, files: rec.files, added: rec.added, removed: rec.removed, check: rec.check, verdict: rec.verdict }),
  }))
  await writeEta($, job, `done · ${job.requests} req · ${usd(rec?.workerUsd ?? costUsd(job.usage, job.workerModel ?? ''))}`)
  await animate($)
  return made.text
}

export function handOverText(n: number, agentId: string, report: string, evidence: string): string {
  return `Hand-off ${n} (${agentId}) has ended. Its report:\n\n${report || '(none)'}\n\n${evidence}`
}

export function failedText(n: number, agentId: string, why: string): string {
  return `Hand-off ${n} (${agentId}) failed: ${why}. Do the task yourself or hand it off again.`
}

/** A host notice for a worker whose end the mod already reported, and not the mod's own prompt: drop it. */
export function dropsNotice(handed: ReadonlySet<string>, originKind: string | undefined, text: string): boolean {
  if (originKind === undefined || originKind === 'composer' || originKind === 'bridge' || originKind === 'sdk' || originKind === 'plugin') return false
  return [...handed].some(id => text.includes(id))
}

/** Nobody waits on the worker (a background hand-off, or a held one past its limit) and its end brought no notice: report it from here. */
async function handOver($: Engine, job: Job): Promise<void> {
  if (job.reported || job.holding || job.done === undefined) return
  handedOver.add(job.agentId)
  const done = job.done
  if (done.reason === 'answer') {
    const evidence = await deliver($, job, done.answer)
    jobs.delete(job.agentId)
    await $.prompt.submit({ text: handOverText(job.n, job.agentId, done.answer, evidence) }).catch(() => undefined)
    return
  }
  job.reported = true
  await setView($, job.toolUseId, () => ({ state: 'failed', endedAt: job.ended }))
  await writeEta($, job, `failed · ${job.requests} req · ${usd(costUsd(job.usage, job.workerModel ?? ''))}`)
  await animate($)
  jobs.delete(job.agentId)
  await $.prompt.submit({ text: failedText(job.n, job.agentId, done.reason) }).catch(() => undefined)
}

/**
 * Holds the tool call until the worker is done. Each wait is a one-second
 * \`sleep\` run through the engine, during which a hook's own clock stands
 * still, so the wait never counts against its budget. Undefined when the
 * person interrupted it or it ran past HOLD_MS: the report then comes as a message.
 */
async function hold($: Engine, job: Job, signal: AbortSignal): Promise<string | undefined> {
  const until = (await $.clock.now()) + HOLD_MS
  while (job.done === undefined && job.handback === undefined) {
    if (signal.aborted || (await $.clock.now()) > until) {
      job.holding = false
      return undefined
    }
    await $.process.run(['sleep', '1']).catch(() => undefined)
  }
  job.holding = false
  job.returned = true
  const body = job.handback ?? job.done?.answer ?? ''
  const evidence = await deliver($, job, body)
  if (job.done !== undefined && job.handback !== undefined) jobs.delete(job.agentId)
  return `The worker's report:\n${body || '(none)'}\n\n${evidence}`
}

/** The worker's notice arrived: the evidence to read beside its report. */
async function report($: Engine, job: Job): Promise<{ text: string; record: HandOff }> {
  const cwd = await $.session.cwd()
  // The hand-back reaches the main model before the worker's turn has formally ended.
  const done = job.done ?? { answer: '', reason: 'answer' }
  const usage = job.usage
  const requests = Math.max(1, job.requests)
  const workerModel = job.workerModel ?? job.input.worker
  const workerUsd = costUsd(usage, workerModel)
  const mainModel = await $.session.model().catch(() => 'opus')
  const contextTokens = (await $.session.usage().catch(() => undefined))?.context.tokens ?? 0
  const alone = mainAloneUsd({ requests, contextTokens, worker: usage, model: mainModel })
  const ended = job.ended ?? (await $.clock.now())
  const seconds = Math.round((ended - job.started) / 1000)

  const parts = [
    `Hand-off ${job.n} (${job.input.mode}) ended: ${label(workerModel.replace(/^claude-/, ''), job.input.effort)} · ${requests} request${requests === 1 ? '' : 's'} · ${seconds}s · ${money(workerUsd)}; the same steps on your model: about ${money(alone)} at ${kTokens(contextTokens)} context.${job.reused ? ' A warm worker continued.' : ''}`,
  ]
  if (done.reason !== 'answer') parts.push(`The worker did not finish cleanly (${done.reason}).`)

  const record: HandOff = {
    at: job.started,
    session: await $.session.id(),
    mode: job.input.mode,
    kind: job.input.kind,
    model: workerModel,
    effort: job.input.effort,
    reused: job.reused,
    focus: job.input.focus.length,
    reachRefs: job.reach.reduce((k, r) => k + r.refs.length, 0),
    requests,
    durationMs: ended - job.started,
    workerUsd,
    mainAloneUsd: alone,
    contextTokens,
    files: [...new Set(job.reach.flatMap(r => filesOf(r.refs)))],
    added: 0,
    removed: 0,
    reworkEdits: 0,
    outcome: done.reason === 'answer' ? 'answer' : done.reason === 'refusal' ? 'refused' : done.reason === 'aborted' ? 'aborted' : 'error',
  }

  if (job.input.mode === 'edit') {
    const fromGit = job.gitBase === undefined ? undefined : await gitDiff($, cwd, { ...job, gitBase: job.gitBase })
    const diff = fromGit?.diff ?? (await diffOf($, cwd, job))
    const files = fromGit?.files ?? [...job.originals.keys()].map(p => rel(cwd, p))
    const stat = diffStat(diff)
    Object.assign(record, { files, added: stat.added, removed: stat.removed })
    const check = job.input.check ? await runCheck($, job.input.check) : undefined
    if (check !== undefined && job.input.check !== undefined) record.check = { command: job.input.check, exit: check.exit }
    const outside = job.reach.flatMap(r => [...r.refs, ...r.callers]).filter(p => !files.includes(p.path))
    const fullPath = `${dir}/hand-off-${job.n}.diff`
    if (diff) await $.fs.write(fullPath, diff + '\n')
    const checkText = check ? `Check \`${job.input.check}\` (run by the tool): exit ${check.exit}\n${check.tail}` : 'No check command was given.'
    const outsideText = outside.length > 0 ? `References outside the changed files (does the change keep them right?): ${places(outside)}` : ''
    const evidence = [diff ? `Diff:\n${diff}` : 'The worker changed no file.', checkText, outsideText].filter(Boolean).join('\n\n')
    const route = diff ? reviewRoute(review, tokensOf(evidence), contextTokens) : 'inline'
    record.route = route
    for (const f of files) touched.set(join(cwd, f), record)

    parts.push(diff ? `Changed ${files.length} file${files.length === 1 ? '' : 's'} (+${stat.added} −${stat.removed}): ${files.join(', ')}` : 'The worker changed no file.')
    const fork = route === 'fork' ? await $.model.fork({ prompt: REVIEW_PROMPT(job.input.task, evidence) }) : undefined
    if (fork !== undefined && fork.isAnswered) {
      record.reviewUsd = costUsd(fork.usage as Usage, mainModel)
      record.reviewUsage = fork.usage as Usage
      record.verdict = parseVerdict(fork.text)
      parts.push(`Review of the full diff by a fork of you (${money(record.reviewUsd)}):\n${fork.text.trim()}\nFull diff: ${fullPath}`)
      parts.push(checkText)
    } else {
      record.route = 'inline'
      const shown = capLines(diff, DIFF_LINES)
      if (diff) parts.push(`${shown.text}${shown.cut > 0 ? `\n… ${shown.cut} more lines in ${fullPath}` : ''}`)
      parts.push(checkText)
      if (outsideText) parts.push(outsideText)
    }
    parts.push('Judge the work by the diff and the check, not by the report.')
  } else if (job.reachText) {
    parts.push(`It was told where the task reaches:\n${job.reachText}`)
  }

  records.push(record)
  return { text: parts.join('\n\n'), record }
}

export const register: Register = (on, options) => {
  if (options.enabled === false) {
    // Off: a tool registered earlier may outlive the reload, so only its call is answered.
    for (const tool of HAND_OFF_TOOLS) {
      on('tool.call', { tool }, () => ({ result: 'delegate is turned off (/mods turns it on).' }))
    }
    return
  }
  for (const [k, key, dflt] of [['read', 'readWorker', 'haiku'], ['mechanical', 'mechanicalWorker', 'haiku'], ['build', 'buildWorker', 'sonnet']] as const) {
    const w = parseWorker(typeof options[key] === 'string' && (options[key] as string).trim() ? (options[key] as string) : dflt)
    workers[k] = w.model ? w : parseWorker(dflt)
  }
  review = options.review === 'auto' || options.review === 'fork' || options.review === 'inline' ? options.review : DEFAULT_REVIEW
  reuseMs = (typeof options.reuseMinutes === 'number' ? options.reuseMinutes : 50) * 60_000
  capTokens = typeof options.workerContextCap === 'number' ? options.workerContextCap : 60_000
  wait = options.wait === 'message' ? 'message' : 'tool'
  framing = options.framing === 'capability' ? 'capability' : 'hand_off'
  afterPlan = options.afterPlan === 'hand_off' ? 'hand_off' : 'off'

  on('session.start', async ($, e, next) => {
    autoModeBlocked = false
    const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp/').replace(/\/$/, '')
    dir = `${tmp}/claude-delegate/${await $.session.id()}`
    await $.process.run(['mkdir', '-p', dir])
    const have = new Set((await $.tool.list()).map(t => t.name))
    for (const kind of ['read', 'mechanical', 'build'] as const) {
      await $.agent.register({
        name: AGENT[kind],
        description: `The ${kind === 'read' ? 'read-only' : kind === 'mechanical' ? 'mechanical-edit' : 'building'} worker of the hand_off tool.`,
        prompt: WORKER_RULES,
        tools: WORKER_TOOLS[kind].filter(t => have.has(t)),
        model: workers[kind].model,
        ...(workers[kind].effort ? { effort: workers[kind].effort } : {}),
      })
    }
    if (framing === 'capability') await $.tool.register({ name: CAPABILITY, description: describeCapability(), inputSchema: CAPABILITY_SCHEMA, isDeferred: false })
    else await $.tool.register({ name: TOOL, description: describe(wait), inputSchema: INPUT_SCHEMA, isDeferred: false })
    await $.command.register({ name: 'delegate', description: 'What hand-offs to the worker model cost and saved, and how often their work came back' })
    await reconcile($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await reconcile($)
    return next(e)
  })

  // The workers are this tool's alone: the model reaches them through hand_off, never the Agent tool.
  // Their type is offered only while this mod continues one, which resuming requires.
  for (const kind of ['read', 'mechanical', 'build'] as const) on('agent.offer', { agent: `delegate:${AGENT[kind]}` }, () => ({ isOffered: resuming }))

  on('command.run', { command: 'delegate' }, async $ => {
    if ((await read($, VIEW)).length > 0) await openPane($).catch(() => undefined)
    return { text: summarize([...(await readLog($)), ...records]) }
  })

  for (const tool of HAND_OFF_TOOLS) on('tool.call', { tool }, async ($, e, next) => {
    const i = e as unknown as { task?: unknown; spec?: unknown; kind?: unknown; focus?: unknown; check?: unknown; fresh?: unknown; background?: unknown}
    const capability = (e.tool as string) === 'mcp__delegate__implement_spec'
    const task = capability ? i.spec : i.task
    if (typeof task !== 'string' || !task.trim()) return { result: capability ? 'implement_spec needs a spec.' : 'hand_off needs a task.' }
    const kind: Kind = capability ? 'build' : i.kind === 'read' || i.kind === 'mechanical' || i.kind === 'build' ? i.kind : 'build'
    const mode = MODE[kind]
    const focus = Array.isArray(i.focus) ? i.focus.filter((f): f is string => typeof f === 'string') : []
    const check = typeof i.check === 'string' && i.check.trim() ? i.check : undefined
    const background = typeof i.background === 'boolean' ? i.background : wait === 'message'
    const { model: worker, effort } = workers[kind]
    const started = await start($, e.tool_use_id, { task, kind, mode, effort, focus, check, fresh: !capability && i.fresh === true, background, worker })
    const job = started.agentId === undefined ? undefined : jobs.get(started.agentId)
    if (job === undefined || !job.holding) return { result: started.text }
    const held = await hold($, job, next.signal)
    return { result: held ?? `${started.text} Stopped waiting: its report arrives as a notification when it finishes.` }
  }).catch(() => ({ result: 'The hand-off failed inside the delegate mod. Do the task yourself.' }))

  /** Measured: a 50-line feature plan handed off was correct and cheap; renames (a few lines) cost more handed off. */
  const PLAN_MIN_LINES = 20

  // An approved plan: the order to implement it through a hand-off joins the tool's result. Only a plan
  // the size of real work: a small one (a rename) costs more handed off than done in place.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const r = await next(e)
    const plan = (e as { plan?: unknown }).plan
    const lines = typeof plan === 'string' ? plan.split('\n').filter(l => l.trim() !== '').length : 0
    if (afterPlan !== 'hand_off' || autoModeBlocked || lines < PLAN_MIN_LINES || r.deny !== undefined || r.isError) return r
    return { ...r, context: [...(r.context ?? []), planOrder(framing)] }
  }).catch(($, e, next) => next(e))

  // The workers' own edits (each file kept as it was before), and the main model's edits to their files afterwards.
  on('tool.call', async ($, e, next) => {
    const agentId = (e as { agentId?: string }).agentId
    const path = (e as { file_path?: unknown }).file_path
    const edits = (e.tool === 'Edit' || e.tool === 'Write') && typeof path === 'string'
    if (agentId !== undefined) {
      const job = jobs.get(agentId)
      if (job === undefined) return next(e)
      if (edits) {
        const abs = join(await $.session.cwd(), path)
        if (!job.originals.has(abs)) job.originals.set(abs, await $.fs.read(abs).catch(() => null))
      }
      const startedAt = await $.clock.now()
      const label = actionLabel(e.tool, e as unknown as { [k: string]: unknown })
      let index = 0
      await setView($, job.toolUseId, j => {
        index = j.actions.length
        return { actions: [...j.actions, { tool: e.tool, label, state: 'running', startedAt }] }
      })
      const r = await next(e)
      const ms = (await $.clock.now()) - startedAt
      const state = r.deny !== undefined || r.isError ? 'failed' : 'ok'
      await setView($, job.toolUseId, j => ({ actions: j.actions.map((a, i) => (i === index ? { ...a, state, ms } : a)) }))
      await writeEta($, job, etaStatusLine({ requests: job.requests, usd: costUsd(job.usage, job.workerModel ?? '') }, { tool: e.tool, label }))
      return r
    }
    const r = await next(e)
    if (edits && r.deny === undefined && !r.isError) {
      const record = touched.get(join(await $.session.cwd(), path))
      if (record !== undefined) record.reworkEdits++
    }
    return r
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const job = e.agentId === undefined ? undefined : jobs.get(e.agentId)
    if (job !== undefined && r.usage) {
      const u = r.usage
      job.requests++
      job.workerModel = u.model
      job.usage = {
        input_tokens: job.usage.input_tokens + u.input_tokens,
        output_tokens: job.usage.output_tokens + u.output_tokens,
        cache_read_input_tokens: job.usage.cache_read_input_tokens + u.cache_read_input_tokens,
        cache_creation_input_tokens: job.usage.cache_creation_input_tokens + u.cache_creation_input_tokens,
      }
      job.lastContext = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      const spent = costUsd(job.usage, u.model)
      await setView($, job.toolUseId, () => ({ requests: job.requests, usd: spent, model: u.model.replace(/^claude-/, '').replace(/-\d.*$/, '') }))
      await writeEta($, job, etaStatusLine({ requests: job.requests, usd: spent }))
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) {
      const job = jobs.get(e.agentId)
      if (job !== undefined) {
        job.done = { answer: e.answer, reason: e.reason }
        job.ended ??= await $.clock.now()
        if (e.reason !== 'answer' && warm.get(warmKey(job.input))?.agentId === e.agentId) warm.delete(warmKey(job.input))
        if (job.reported && (!job.returned || job.handback !== undefined)) jobs.delete(e.agentId)
        else await handOver($, job)
      }
      return r
    }
    // The main turn that read the reports ended: they go to the log, and edits stop counting as rework.
    const done = records
    records = []
    touched = new Map()
    await flush($, done).catch(() => undefined)
    return r
  })

  // The card in the transcript: live while the worker runs, then its outcome; its button opens the pane.
  for (const tool of HAND_OFF_TOOLS) on('ui.render', { component: 'ToolUse', props: { tool } }, async ($, e, next) => {
    const job = (await read($, VIEW)).find(j => j.toolUseId === e.requestId)
    if (job === undefined) return next(e)
    const now = await $.clock.now()
    const open = () => void openPane($, job.toolUseId).catch(() => undefined)
    return jobCard($.ui.resolve(e) as unknown as Elements, job, now, e.viewport?.columns ?? 100, open)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const now = await $.clock.now()
    const pick = (id: string) => void update($, WATCHING, () => id).catch(() => undefined)
    return pane($.ui.resolve(e) as unknown as Elements, await read($, VIEW), await read($, WATCHING), now, e.props.bodyColumns, pick)
  })

  // The card says it all: the tool's own result ("the worker is on it") draws nothing under it.
  for (const tool of HAND_OFF_TOOLS) on('ui.render', { component: 'ToolResult', props: { tool } }, async ($, e, next) => {
    if ((await read($, VIEW)).every(j => j.toolUseId !== e.requestId) || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // The worker's report reaching the main model (its hand-back message, or a task notice): the evidence joins it.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    if (kind === undefined || kind === 'composer' || kind === 'bridge' || kind === 'sdk' || kind === 'plugin') return next(e)
    if (dropsNotice(handedOver, kind, e.text)) return { drop: 'delegate: this worker\'s report was already delivered.' }
    const job = [...jobs.values()].find(j => (!j.reported || (j.returned && j.handback === undefined)) && e.text.includes(j.agentId))
    if (job === undefined) return next(e)
    // Held in the tool call: the report goes back as its result, so the message itself does not enter.
    if (job.holding || job.returned) {
      job.handback = reportText(e.text)
      if (job.returned && job.done !== undefined) jobs.delete(job.agentId)
      return { drop: 'delegate: this worker report reached Claude as the hand_off result.' }
    }
    if (job.done !== undefined) jobs.delete(job.agentId)
    const evidence = await deliver($, job, reportText(e.text))
    return next({ ...e, context: [...(e.context ?? []), evidence] })
  }).catch(($, e, next) => next(e))
}
