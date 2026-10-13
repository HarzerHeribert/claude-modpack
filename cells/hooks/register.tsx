import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register, Timer } from 'claude-code'

import { parseLocations } from '../runner/lsp.mjs'
import { applyFixes } from '../runner/repair.mjs'
import type { CellsLive } from '../types'
import { MAX_IN_FLIGHT, absolute, exitCode, labelOf, lines, report, tidy } from './bridge'
import type { CallRecord, Done, Need, Reply } from './bridge'
import { NUDGE, NUDGE_CELLS, TOOL_DESCRIPTION, TOOL_NAME } from './guide'
import { Budget, costOf, kindOf, missed, noteFor } from './nudge'
import type { Step } from './nudge'
import { cellCard, parseReport, resultBody, seconds, stateOf } from './view'
import type { Card } from './view'

type Engine = EngineInterface
type Mode = 'cells' | 'nudge' | 'off'

const LIVE = atom({ plugin: 'cells', key: 'live' } as const, {} as Record<string, CellsLive>)

let mode: Mode = 'cells'
let visuals = true
let nudging = true
// The cells running now, and those the model is still writing, for the redraw that animates them.
const running = new Set<string>()
const writing = new Set<string>()
let frames: Timer | undefined
const FRAME_MS = 125
let made = 0
let nodePath = 'node'
let dir = ''
// The runner's real folder: node --permission resolves symlinks, so a mod loaded
// through a link must name the folder the link points to.
let runnerDir = ''
// The handles of the cells run since the person's last prompt, as JSON.
let handles = '{}'
// The last program that did not parse, as sent and, where one was offered, repaired: what fix and repair apply to.
let pending: { code: string; repaired?: string } | undefined
// Kinds of source file whose language server has had time to index.
const warm = new Set<string>()
// The main loop's last few model requests, and the notes' allowance.
let steps: Step[] = []
let stepCount = 0
let budget = new Budget()

function readOptions(o: PluginOptions) {
  mode = o.mode === 'nudge' || o.mode === 'off' ? o.mode : 'cells'
  visuals = o.visuals !== false
  nudging = o.nudges !== false
}

/** Redraws at 8 fps while a cell is written or runs; at rest nothing moves. */
function animate($: Engine) {
  const moving = running.size + writing.size > 0
  if (visuals && moving && frames === undefined) {
    frames = $.clock.every(FRAME_MS, () => $.ui.invalidate('ui.render'))
  } else if (!moving && frames !== undefined) {
    frames.cancel()
    frames = undefined
    $.ui.invalidate('ui.render')
  }
}

function outputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    const texts = output.map(b => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '')).filter(Boolean)
    return texts.length > 0 ? texts.join('\n') : undefined
  }
  return undefined
}

async function setup($: Engine) {
  const tmp = (await $.env.get('TMPDIR')) ?? '/tmp/'
  dir = `${tmp.replace(/\/$/, '')}/claude-cells/${await $.session.id()}`
  await $.process.run(['mkdir', '-p', dir])
  const which = await $.process.run(['/usr/bin/which', 'node']).catch(() => undefined)
  if (which && which.exitCode === 0 && which.stdout.trim()) nodePath = which.stdout.trim()
  const linked = `${$.plugin.root}/runner`
  const stat = await $.fs.stat(linked, { resolve: true }).catch(() => undefined)
  runnerDir = stat?.realPath ?? linked
}

type BashRecord = { stdout?: string; stderr?: string; persistedOutputPath?: string; interrupted?: boolean }
type ReadRecord = { type?: string; file?: { content?: string; startLine?: number; numLines?: number; totalLines?: number } }

/** Keeps what the plugins along a call's way added for the model (lsp-plus's notes), once each, for the cell's report. */
function keep(sink: string[], r: { context?: readonly string[] }) {
  for (const note of r.context ?? []) if (!sink.includes(note)) sink.push(note)
}

/** How long the first question about a kind of file may wait for a server that is still indexing. */
const COLD_MS = 10_000

/** Whole-word mentions of `name` in the project's tracked files of one kind: what a warm server could list at most. */
async function mentionsOf($: Engine, cwd: string, name: string, kind: string): Promise<number> {
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || !/^\.\w+$/.test(kind)) return 2
  const r = await $.process.run(['git', 'grep', '-c', '-I', '-w', '-F', '-e', name, '--', `*${kind}`], { cwd, timeoutMs: 8000 }).catch(() => undefined)
  if (r === undefined || r.exitCode !== 0) return 2
  return r.stdout.split('\n').reduce((sum, row) => sum + (Number(/:(\d+)$/.exec(row)?.[1]) || 0), 0)
}

async function serveLsp($: Engine, i: Record<string, unknown>, sink: string[]): Promise<Reply> {
  const cwd = await $.session.cwd()
  const operation = String(i.operation ?? '') as 'findReferences'
  const filePath = absolute(cwd, i.filePath)
  const kind = /\.[^./]+$/.exec(filePath)?.[0] ?? ''
  const ask = async (): Promise<Reply> => {
    const r = await $.tool.call({ tool: 'LSP', operation, filePath, line: Number(i.line), character: Number(i.character) })
    keep(sink, r)
    if (r.deny !== undefined) return { ok: false, denied: r.deny }
    if (r.isError) return { ok: false, text: r.text ?? 'the language server failed' }
    const text = r.text ?? ''
    if (/^(Error performing|No LSP server)/.test(text)) return { ok: false, text }
    return { ok: true, text, places: parseLocations(text).map(p => ({ ...p, file: tidy(cwd, p.file) })), context: [...(r.context ?? [])] }
  }
  let best = await ask()
  if (!best.ok || warm.has(kind)) return best
  // A server still indexing answers with the file it has open, or nothing: ask again
  // while it lists fewer places than the text could hold, until it is warm.
  const started = await $.clock.now()
  const enough =
    operation === 'findReferences' ? await mentionsOf($, cwd, String(i.name ?? ''), kind) : operation === 'goToDefinition' ? 1 : 0
  while ((best.places?.length ?? 0) < enough && (await $.clock.now()) - started < COLD_MS) {
    await $.process.run(['sleep', '1.5'])
    const again = await ask()
    if (!again.ok) break
    if ((again.places?.length ?? 0) >= (best.places?.length ?? 0)) best = again
  }
  warm.add(kind)
  return best
}

/** Runs one call a cell asked for, as a real Claude Code tool call. */
async function serve($: Engine, need: Need, cwd: string, sink: string[]): Promise<Reply> {
  const i = need.input
  try {
    if (need.tool === 'Bash') {
      const r = await $.tool.call({
        tool: 'Bash',
        command: String(i.command ?? ''),
        ...(typeof i.timeout === 'number' ? { timeout: i.timeout } : {}),
      })
      keep(sink, r)
      if (r.deny !== undefined) return { ok: false, denied: r.deny }
      if (r.isError) {
        const text = r.text ?? ''
        return { ok: false, out: text.replace(/^Exit code \d+\n?/, ''), err: '', code: exitCode(text), text }
      }
      const rec = (r.result ?? {}) as BashRecord
      // Claude Code shortens long output for the model; the cell gets all of it.
      const full = rec.persistedOutputPath ? await $.fs.read(rec.persistedOutputPath).catch(() => undefined) : undefined
      const out = typeof full === 'string' ? full : (rec.stdout ?? '')
      return { ok: !rec.interrupted, out, err: rec.stderr ?? '', code: rec.interrupted ? 130 : 0 }
    }

    if (need.tool === 'Read') {
      const path = absolute(cwd, i.file_path)
      const r = await $.tool.call({
        tool: 'Read',
        file_path: path,
        ...(typeof i.offset === 'number' ? { offset: i.offset } : {}),
        ...(typeof i.limit === 'number' ? { limit: i.limit } : {}),
      })
      keep(sink, r)
      if (r.deny !== undefined) return { ok: false, denied: r.deny }
      if (r.isError) return { ok: false, text: r.text ?? 'read failed' }
      const rec = (r.result ?? {}) as ReadRecord
      if (rec.type === 'file_unchanged') {
        // Read allowed it and says it is as last read: the cell still needs the text.
        const all = (await $.fs.read(path)).split('\n')
        const from = typeof i.offset === 'number' ? i.offset : 1
        const page = all.slice(from - 1, typeof i.limit === 'number' ? from - 1 + i.limit : undefined)
        return { ok: true, content: page.join('\n'), start: from, num: page.length, total: all.length }
      }
      const f = rec.file ?? {}
      return { ok: true, content: f.content ?? r.text ?? '', start: f.startLine, num: f.numLines, total: f.totalLines }
    }

    if (need.tool === 'Edit') {
      const r = await $.tool.call({
        tool: 'Edit',
        file_path: absolute(cwd, i.file_path),
        old_string: String(i.old_string ?? ''),
        new_string: String(i.new_string ?? ''),
        replace_all: i.replace_all === true,
      })
      keep(sink, r)
      if (r.deny !== undefined) return { ok: false, denied: r.deny }
      if (r.isError) return { ok: false, text: r.text ?? 'edit failed' }
      return { ok: true }
    }

    if (need.tool === 'Write') {
      const r = await $.tool.call({ tool: 'Write', file_path: absolute(cwd, i.file_path), content: String(i.content ?? '') })
      keep(sink, r)
      if (r.deny !== undefined) return { ok: false, denied: r.deny }
      if (r.isError) return { ok: false, text: r.text ?? 'write failed' }
      return { ok: true }
    }

    if (need.tool === 'LSP') return await serveLsp($, i, sink)

    return { ok: false, text: `no such cell function: ${need.tool}` }
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) }
  }
}

/** Serves one need, records it for the report and the row, and replies. */
async function answer(
  $: Engine,
  need: Need,
  cwd: string,
  id: string,
  calls: CallRecord[],
  useId: string | undefined,
  notes: string[],
) {
  const startedAt = await $.clock.now()
  const index = calls.length
  const label = labelOf(need)
  calls.push({ tool: need.tool, label, ok: false, refused: false, ms: 0 })
  if (useId) {
    await update($, LIVE, l => {
      const cell = l[useId]
      if (!cell) return l
      return { ...l, [useId]: { ...cell, calls: [...cell.calls, { tool: need.tool, label, state: 'running' as const, startedAt }] } }
    })
  }

  const reply = await serve($, need, cwd, notes)
  await $.fs.write(`${dir}/${id}.${need.n}.json`, JSON.stringify(reply))

  const ms = (await $.clock.now()) - startedAt
  const refused = reply.denied !== undefined
  const note = refused ? 'refused' : need.tool === 'Bash' && !reply.ok ? `exit ${reply.code ?? 1}` : undefined
  calls[index] = { tool: need.tool, label, ok: reply.ok, refused, ms, note }
  if (useId) {
    await update($, LIVE, l => {
      const cell = l[useId]
      if (!cell) return l
      const rows = cell.calls.map((c, k) =>
        k === index ? { ...c, state: refused ? ('refused' as const) : reply.ok ? ('ok' as const) : ('failed' as const), ms, note } : c,
      )
      return { ...l, [useId]: { ...cell, calls: rows } }
    })
  }
}

/** Runs one cell in the sandboxed runner and returns what the model reads. */
async function runCell($: Engine, code: string, useId: string | undefined): Promise<string> {
  if (!dir) await setup($)
  const cwd = await $.session.cwd()
  const startedAt = await $.clock.now()
  const id = `${++made}-${startedAt}`
  const runner = runnerDir || `${$.plugin.root}/runner`
  const calls: CallRecord[] = []
  const notes: string[] = []
  if (useId) await update($, LIVE, l => ({ ...l, [useId]: { startedAt, calls: [], code } }))
  running.add(id)
  animate($)

  const stream = $.process.spawn({
    argv: [
      '/usr/bin/sandbox-exec',
      '-f',
      `${runner}/profile.sb`,
      nodePath,
      '--permission',
      `--allow-fs-read=${runner}`,
      `--allow-fs-read=${dir}`,
      '--no-warnings',
      `${runner}/runner.mjs`,
    ],
    input: JSON.stringify({ code, handles, dir, id }),
  })

  let buffer = ''
  let stderr = ''
  let done: Done | undefined
  const inFlight = new Set<Promise<void>>()

  for await (const chunk of stream) {
    if (chunk.stream === 'stderr') {
      stderr += chunk.text
      continue
    }
    const split = lines(buffer + chunk.text)
    buffer = split.rest
    for (const message of split.messages) {
      const m = message as { need?: Need; done?: Done }
      if (m.done) done = m.done
      if (m.need) {
        while (inFlight.size >= MAX_IN_FLIGHT) await Promise.race(inFlight)
        const p: Promise<void> = answer($, m.need, cwd, id, calls, useId, notes).finally(() => inFlight.delete(p))
        inFlight.add(p)
      }
    }
  }
  await Promise.all(inFlight)
  await $.process.run(['/bin/sh', '-c', 'rm -f "$1"/"$2".*', 'sh', dir, id]).catch(() => undefined)

  if (done) handles = done.handles
  // A program that did not parse, or threw before its first call, ran nothing: a fix can redo it safely.
  pending = done?.unparsed || (done?.error !== undefined && calls.length === 0) ? { code, repaired: done?.repaired } : undefined
  running.delete(id)
  animate($)
  const ms = (await $.clock.now()) - startedAt
  if (useId) {
    const endedAt = startedAt + ms
    await update($, LIVE, l => {
      const cell = l[useId]
      return cell ? { ...l, [useId]: { ...cell, endedAt, error: done?.error ?? (done ? undefined : 'the runner ended') } } : l
    })
  }
  return report(calls, done, ms, stderr, notes)
}

export const register: Register = (on, options) => {
  readOptions(options)
  dir = ''
  runnerDir = ''
  handles = '{}'
  steps = []
  stepCount = 0
  budget = new Budget()
  pending = undefined

  on('session.start', async ($, e, next) => {
    if (mode === 'off') return next(e)
    await setup($).catch(() => undefined)
    if (mode === 'cells') {
      await $.tool.register({
        name: TOOL_NAME,
        description: TOOL_DESCRIPTION,
        isDeferred: false,
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'The JavaScript to run (TypeScript types are stripped).' },
            fix: {
              type: 'array',
              description: 'Instead of code, after a cell that did not parse: exact replacements in that program, each old text occurring once; the fixed program runs.',
              items: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } }, required: ['old', 'new'] },
            },
            repair: { type: 'boolean', description: 'Instead of code: run the repaired program the last report offered.' },
          },
        },
      })
    }
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (mode === 'off') return composed
    const text = mode === 'cells' ? NUDGE_CELLS : NUDGE
    return { sections: [...composed.sections, { id: 'cells-chaining', text, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  // Handles live for one prompt, as sterna's do.
  on('turn.start', async ($, e, next) => {
    handles = '{}'
    return next(e)
  })

  // Each model request of the main loop: what it called and what it re-read, for the notes.
  on('turn.step', async function* ($, e, next) {
    const started = await $.clock.now()
    const stream = next(e)
    try {
      for await (const chunk of stream) {
        // A cell the model has begun to write animates until the response ends.
        if (visuals && mode === 'cells' && chunk.kind === 'tool' && chunk.name === 'mcp__cells__run_cell') {
          writing.add(chunk.id)
          animate($)
        }
        yield chunk
      }
    } finally {
      if (writing.size > 0) {
        writing.clear()
        animate($)
      }
    }
    const r = await stream.result
    if (!nudging || mode === 'off' || e.agentId !== undefined) return r
    try {
      const u = r.usage
      steps = [
        ...steps.slice(-3),
        {
          turnId: e.turnId,
          index: e.index,
          calls: r.toolUses.map(t => ({
            tool: t.name,
            kind: kindOf(t.name, t.input),
            command: t.name === 'Bash' ? String((t.input as { command?: unknown } | undefined)?.command ?? '') : undefined,
          })),
          ok: [],
          readTokens: u?.cache_read_input_tokens ?? 0,
          uncachedTokens: u?.input_tokens ?? 0,
          model: u?.model ?? e.model,
          ms: (await $.clock.now()) - started,
        },
      ]
      stepCount++
    } catch {
      // A step the notes could not read is one they skip.
    }
    return r
  })

  on('tool.call', { tool: 'mcp__cells__run_cell' }, async ($, e) => {
    const input = e as unknown as { code?: unknown; fix?: unknown; repair?: unknown; tool_use_id?: unknown }
    const useId = typeof input.tool_use_id === 'string' ? input.tool_use_id : undefined
    if (input.repair === true) {
      if (pending?.repaired === undefined) return { result: 'run_cell: no repaired program is on offer; the last cell parsed, or had no repair. Nothing ran.' }
      return { result: await runCell($, pending.repaired, useId) }
    }
    if (Array.isArray(input.fix)) {
      if (pending === undefined) return { result: 'run_cell: no program to fix; the last cell parsed. Send code. Nothing ran.' }
      const fixed = applyFixes(pending.code, input.fix as { old: string; new: string }[])
      if (fixed.error !== undefined) return { result: `run_cell: ${fixed.error}. Nothing ran; the program is kept for another fix.` }
      return { result: await runCell($, fixed.code, useId) }
    }
    if (typeof input.code !== 'string' || input.code.trim() === '') {
      return { result: 'run_cell needs `code`: the JavaScript to run (or `fix` or `repair` after a cell that did not parse).' }
    }
    return { result: await runCell($, input.code, useId) }
  }).catch(() => ({ result: 'cell · the cells mod failed before the cell could finish; nothing after its last reported call ran.' }))

  // The model's own calls: a note on one that was an avoidable request of its own.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!nudging || mode === 'off' || e.agentId !== undefined || running.size > 0) return r
    if (typeof e.tool_use_id !== 'string' || !e.tool_use_id.startsWith('toolu_')) return r
    try {
      const current = steps.at(-1)
      if (current === undefined) return r
      const ok = r.deny === undefined && r.isError !== true
      current.ok.push(ok)
      if (!ok || r.deny !== undefined) return r
      const mine = { tool: e.tool, kind: kindOf(e.tool, e), command: e.tool === 'Bash' ? e.command : undefined }
      const pattern = missed(steps.at(-2), current, mine, mode === 'cells')
      const size = pattern === undefined ? undefined : budget.take(pattern, stepCount)
      if (pattern === undefined || size === undefined) return r
      return { ...r, context: [...(r.context ?? []), noteFor(pattern, size, costOf(current), mode === 'cells')] }
    } catch {
      return r
    }
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'mcp__cells__run_cell' } }, async ($, e, next) => {
    if (!visuals) return next(e)
    const now = await $.clock.now()
    const live = (await read($, LIVE))[e.requestId]
    const input = e.props.input as { code?: unknown } | undefined
    // A fix or a repair sends no code: the program the cell runs is in its live state.
    const code = live?.code ?? (typeof input?.code === 'string' ? input.code : '')
    const width = e.viewport?.columns ?? 100
    const frame = Math.floor(now / FRAME_MS)
    const report = outputText(e.props.output)
    let card: Card
    if (live) {
      // A plugin's tool row may never be flagged as running: the cell's own end says whether it still is.
      const state = stateOf(live, e.props.isRunning)
      const going = state === 'running'
      const parsed = report ? parseReport(report) : undefined
      const summary = going
        ? `${live.calls.length} call${live.calls.length === 1 ? '' : 's'} · ${seconds(now - live.startedAt)}`
        : (parsed?.summary ?? '')
      card = { state, code, calls: live.calls, now, frame, width, summary }
    } else if (report) {
      const parsed = parseReport(report)
      card = { state: parsed.state, code, calls: parsed.calls, now, frame, width, summary: parsed.summary }
    } else {
      // No result and not running: the model is still writing the program, or the call waits its turn.
      const waiting = !e.props.isRunning && !e.props.isErrored && !e.props.isInterrupted
      card = { state: e.props.isRunning ? 'running' : waiting ? 'writing' : 'ran', code, calls: [], now, frame, width, summary: '' }
    }
    return cellCard($.ui.resolve(e), card)
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'mcp__cells__run_cell' } }, async ($, e, next) => {
    const report = outputText(e.props.output)
    if (!visuals || e.props.isErrored || report === undefined) return next(e)
    return resultBody($.ui.resolve(e), report) ?? next(e)
  })
}
