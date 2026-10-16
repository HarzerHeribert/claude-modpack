// Pure parts of the hand-off: where a task reaches, what the worker reads,
// what the work cost against doing it on the main model, and what goes back.

export type Mode = 'explore' | 'edit'
export type Kind = 'read' | 'mechanical' | 'build'
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** "sonnet:low" -> { model: 'sonnet', effort: 'low' }; "haiku" -> { model: 'haiku' }; an unknown effort word is dropped. */
export function parseWorker(setting: string): { model: string; effort?: string } {
  const [m, e] = setting.trim().split(':')
  const model = (m ?? '').trim()
  const effort = (e ?? '').trim().toLowerCase()
  return EFFORTS.includes(effort) ? { model, effort } : { model }
}

export type Place = { path: string; line: number }

/** One thing the task touches, resolved to a place the language server can be asked about. */
export type Anchor = { name: string; path: string; line: number; character: number }

/** What the task reaches: per anchor, its references, callers and doc mentions. */
export type Reach = {
  anchor?: Anchor
  name: string
  refs: Place[]
  callers: Place[]
  docs: string[]
  /** How the references were found: the language server, or a text search where none answered. */
  via: 'lsp' | 'text' | 'none'
}

export type Focus = { path?: string; line?: number; name?: string }

/** `path:line`, `path#name`, or a bare `name`. */
export function parseFocus(raw: string): Focus {
  const s = raw.trim()
  const at = /^(.+?):(\d+)$/.exec(s)
  if (at) return { path: at[1], line: Number(at[2]) }
  const hash = /^(.+?)#([A-Za-z_$][\w$]*)$/.exec(s)
  if (hash) return { path: hash[1], name: hash[2] }
  if (/^[A-Za-z_$][\w$.]*$/.test(s)) return { name: s.split('.').at(-1) }
  return { path: s }
}

const KEYWORDS = 'function|class|interface|type|enum|struct|trait|def|fn|func|const|let|var|val|record|module|namespace'

/** An extended regex for `git grep -E` that finds where `name` is defined. */
export const definitionPattern = (name: string) => `\\b(${KEYWORDS})\\s+${name}\\b`

/** The same for `git grep -w -E`, whose POSIX expressions have no `\\b` or `\\s`. */
export const gitDefinitionPattern = (name: string) => `(${KEYWORDS})[[:space:]]+${name}`

/** Where on a source line to ask about a symbol: its definition's name, else `name`, else the first identifier. */
export function anchorOn(text: string, name?: string): { name: string; character: number } | undefined {
  const def = new RegExp(`\\b(?:${KEYWORDS})\\s+([A-Za-z_$][\\w$]*)`).exec(text)
  if (name !== undefined) {
    const at = new RegExp(`(^|[^\\w$])(${name.replace(/\$/g, '\\$')})($|[^\\w$])`).exec(text)
    if (at) return { name, character: at.index + (at[1] as string).length + 1 }
  }
  if (def) return { name: def[1] as string, character: def.index + def[0].length - (def[1] as string).length + 1 }
  // An import line is about what it imports, never the words `from` or `import`.
  const imported = /\bimport\s+(?:\{\s*)?([A-Za-z_$][\w$]*)/.exec(text)
  if (imported) return { name: imported[1] as string, character: imported.index + imported[0].length - (imported[1] as string).length + 1 }
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (!NOT_NAMES.has(m[0])) return { name: m[0], character: (m.index ?? 0) + 1 }
  }
  return undefined
}

const NOT_NAMES = new Set(
  'export public private protected static async await pub from import as return if else for while const let var def class function fn func new await yield in of not and or self this'.split(' '),
)

/** A text search past this many hits names something too common to trace. */
export const TEXT_SEARCH_CAP = 200

const relative = (cwd: string, path: string) => (path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path)

/**
 * Places in an LSP result, whichever way it lists them: `path:line[:col]`, or a
 * `path:` heading over `Line n:c` rows.
 */
export function parseLocations(text: string, cwd: string): Place[] {
  const found: Place[] = []
  let file: string | undefined
  for (const row of text.split('\n')) {
    const heading = /^\s*((?:\/|\.{1,2}\/)?[\w@.\-/ ]+\.[\w]+):\s*$/.exec(row)
    if (heading) {
      file = relative(cwd, (heading[1] as string).trim())
      continue
    }
    const line = /^\s*(?:[-•*]\s*)?Line\s+(\d+)(?::\d+)?/i.exec(row)
    if (line && file !== undefined) {
      found.push({ path: file, line: Number(line[1]) })
      continue
    }
    for (const m of row.matchAll(/((?:\/|\.{1,2}\/)?[\w@.\-/]+\.[A-Za-z]\w*):(\d+)(?::\d+)?/g)) {
      found.push({ path: relative(cwd, m[1] as string), line: Number(m[2]) })
    }
  }
  const seen = new Set<string>()
  return found.filter(p => {
    const key = `${p.path}:${p.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** "a.ts:3,9 · b.ts:12 · … and 4 more files" */
export function places(list: readonly Place[], maxFiles = 8): string {
  const byFile = new Map<string, number[]>()
  for (const p of list) byFile.set(p.path, [...(byFile.get(p.path) ?? []), p.line])
  const files = [...byFile.entries()]
  const shown = files.slice(0, maxFiles).map(([f, lines]) => `${f}:${lines.slice(0, 6).join(',')}${lines.length > 6 ? ',…' : ''}`)
  const more = files.length - shown.length
  return shown.join(' · ') + (more > 0 ? ` · and ${more} more file${more === 1 ? '' : 's'}` : '')
}

export function filesOf(list: readonly Place[]): string[] {
  return [...new Set(list.map(p => p.path))]
}

/** The reach as the worker and the reviewer read it. */
export function describeReach(reach: readonly Reach[]): string {
  if (reach.length === 0) return ''
  const rows = reach.map(r => {
    const where = r.anchor ? ` (${r.anchor.path}:${r.anchor.line})` : ''
    if (r.via === 'none') return `- \`${r.name}\`${where}: not found`
    const head = `- \`${r.name}\`${where}: ${r.refs.length} reference${r.refs.length === 1 ? '' : 's'} in ${filesOf(r.refs).length} file${filesOf(r.refs).length === 1 ? '' : 's'}${r.via === 'text' ? ' (text search, not the language server)' : ''}`
    const lines = [head]
    if (r.refs.length > 0) lines.push(`  ${places(r.refs)}`)
    if (r.callers.length > 0) lines.push(`  called from ${places(r.callers)}`)
    for (const d of r.docs) lines.push(`  ${d.split('\n').join('\n  ')}`)
    return lines.join('\n')
  })
  return rows.join('\n')
}

export const WORKER_RULES = `You work for another Claude, which handed you one task and will check what you did. Work fast and stay inside the task.

- The task text is all you know of the conversation it came from. If it leaves a decision open that matters, do not guess: finish what you can and name what is open.
- Before you change a function's signature or a symbol's name, ask the LSP tool for its references (findReferences) and change every one, or say which you left.
- Do not claim you ran or verified anything you did not run. The other Claude runs the check itself and reads the diff.
- End with a short report: what you found or changed, each with file:line, and anything you are unsure of. No preamble, no summary of the task.`

const VERIFY_INSTRUCTION = `Your report must end with this block, exactly, no code fence:
VERIFY
tests: <one shell command, run from the project's root, that runs only the tests you added or changed; or none>
open: <what you left undone or are unsure of, in one line; or none>`

const PLACES_INSTRUCTION = `Your report must end with this block, exactly, no code fence, one line per place the answer names:
PLACES
<path relative to the project root>:<line> <the symbol as it appears on that line>`

export function workerPrompt(args: { task: string; mode: Mode; reach: string; check?: string; root?: string }): string {
  const mode =
    args.mode === 'edit'
      ? `Mode: edit. Change the files the task needs and nothing else.${args.check ? ` Afterwards this check will run: \`${args.check}\`; you may run it too.` : ''}\n\n${VERIFY_INSTRUCTION}`
      : `Mode: explore. Read only: change no file. Find what the task asks and report it with file:line.\n\n${PLACES_INSTRUCTION}`
  const reach = args.reach ? `\n\nWhere this reaches (from the language server; places that use what the task touches):\n${args.reach}` : ''
  // Also for a warm worker resumed with a new task: its shell may have been left in another folder.
  const root = args.root ? `\n\nThe project is ${args.root}: work there, never in another copy you may find on the disk.` : ''
  return `${args.task.trim()}\n\n${mode}${root}${reach}`
}

type Counts = { passed: number; failed: number }

/** The worker's VERIFY block: the last one in the report, `none` or empty read as absent. */
export function parseVerify(report: string): { tests?: string; open?: string } | undefined {
  const lines = report.split('\n')
  let at = -1
  lines.forEach((l, i) => {
    if (l.trim() === 'VERIFY') at = i
  })
  if (at < 0) return undefined
  const out: { tests?: string; open?: string } = {}
  for (const l of lines.slice(at + 1)) {
    const m = /^\s*(tests|open):\s*(.*)$/i.exec(l)
    if (!m) continue
    const v = (m[2] as string).trim()
    if (v === '' || v.toLowerCase() === 'none') continue
    out[(m[1] as string).toLowerCase() as 'tests' | 'open'] = v
  }
  return out
}

/** The pass and fail counts of the last test summary in a runner's output, or undefined where none is recognised. */
export function testCounts(output: string): Counts | undefined {
  const lines = output.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i] as string
    if (/no tests ran/i.test(l)) return { passed: 0, failed: 0 }
    // pytest
    if (/\b\d+ (passed|failed|errors?|skipped|deselected|xfailed|xpassed)\b/.test(l) && /\bin [\d.]+s/.test(l)) {
      return { passed: num(l, /(\d+) passed/), failed: num(l, /(\d+) failed/) + num(l, /(\d+) errors?\b/) }
    }
    // jest
    if (/^\s*Tests:\s/.test(l)) return { passed: num(l, /(\d+) passed/), failed: num(l, /(\d+) failed/) }
    // vitest
    if (/^\s*Tests\s+\d/.test(l)) return { passed: num(l, /(\d+) passed/), failed: num(l, /(\d+) failed/) }
    // node:test
    if (/^\s*# (pass|fail) \d+/.test(l)) {
      const all = lines.join('\n')
      const last = (k: string) => [...all.matchAll(new RegExp(`^\\s*# ${k} (\\d+)`, 'gm'))].at(-1)
      const p = last('pass')
      const f = last('fail')
      if (p || f) return { passed: Number(p?.[1] ?? 0), failed: Number(f?.[1] ?? 0) }
    }
    // bun
    if (/^\s*\d+ (pass|fail)\s*$/.test(l)) {
      const all = lines.join('\n')
      const last = (k: string) => [...all.matchAll(new RegExp(`^\\s*(\\d+) ${k}\\s*$`, 'gm'))].at(-1)
      return { passed: Number(last('pass')?.[1] ?? 0), failed: Number(last('fail')?.[1] ?? 0) }
    }
  }
  return undefined
}

const num = (line: string, re: RegExp) => Number(re.exec(line)?.[1] ?? 0)

/** Whether a path is a test file by where it lives or how it is named. */
export function isTestFile(path: string): boolean {
  if (/(^|\/)(tests?|__tests__|spec)\//.test(path)) return true
  const name = path.split('/').at(-1) ?? ''
  return /^test_.*\.py$/.test(name) || /_test\.(py|go)$/.test(name) || /\.(test|spec)\.(js|jsx|ts|tsx|mjs)$/.test(name)
}

type Ran = { exit: number; counts?: Counts }

/** The one line that tells the main model whether the worker's work is proven, and what to look at if not. */
export function verdict(args: { changed: string[]; check?: Ran; tests?: Ran; open?: string; block: boolean }): { verified: boolean; line: string } {
  const bad: string[] = []
  const good: string[] = []
  const n = (c?: Counts) => (c ? ` (${c.passed} passed)` : '')
  if (args.changed.length === 0) bad.push('the worker changed no file')
  const c = args.check
  if (!c) bad.push('the check was not given')
  else if (c.exit !== 0) bad.push(`the check failed with exit ${c.exit}`)
  else if (c.counts && c.counts.failed > 0) bad.push(`the check had ${c.counts.failed} failing`)
  else good.push(`the check passed${n(c.counts)}`)
  const t = args.tests
  if (t) {
    if (t.exit !== 0) bad.push(`the new tests failed with exit ${t.exit}`)
    else if (t.counts && t.counts.failed > 0) bad.push(`the new tests had ${t.counts.failed} failing`)
    else if (t.counts && t.counts.passed === 0) bad.push('the new tests did not run (0 selected)')
    else good.push(`the new tests passed on their own${n(t.counts)}`)
  } else if (args.changed.some(isTestFile)) bad.push('test files changed but no command ran them on their own')
  if (!args.block) bad.push("the worker's report had no VERIFY block")
  if (args.open) bad.push(`the worker left open: ${args.open}`)
  if (bad.length === 0) {
    return { verified: true, line: `Verified: ${good.join('; ')}; nothing left open. If the diff is what you asked for, report to the person now: nothing is left to run.` }
  }
  return { verified: false, line: `Not verified: ${bad.join('; ')}. Look at these before you report.` }
}

type PlaceResult = 'found' | { near: number } | 'missing'

/** The places in the worker's PLACES block: the last one in the report; undefined where there is none. */
export function parsePlaces(report: string): { path: string; line: number; symbol: string }[] | undefined {
  const lines = report.split('\n')
  let at = -1
  lines.forEach((l, i) => {
    if (l.trim() === 'PLACES') at = i
  })
  if (at < 0) return undefined
  const out: { path: string; line: number; symbol: string }[] = []
  for (const l of lines.slice(at + 1)) {
    const m = /^\s*(\S+?):(\d+)\s+(\S+)/.exec(l)
    if (!m) break
    out.push({ path: m[1] as string, line: Number(m[2]), symbol: (m[3] as string).replace(/`/g, '') })
  }
  return out
}

/** Whether the symbol is on the given 1-based line of the file, or near it, or nowhere close. */
export function checkPlace(fileLines: string[] | undefined, line: number, symbol: string): PlaceResult {
  if (!fileLines || symbol === '') return 'missing'
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = /^\w+$/.test(symbol) ? new RegExp(`\\b${esc}\\b`) : new RegExp(esc)
  const has = (n: number) => n >= 1 && n <= fileLines.length && re.test(fileLines[n - 1] as string)
  if (has(line)) return 'found'
  for (let d = 1; d <= 3; d++) {
    if (has(line - d)) return { near: line - d }
    if (has(line + d)) return { near: line + d }
  }
  return 'missing'
}

/** The one line that tells the main model whether a lookup answer is proven in the code, and what to open if not. */
export function readVerdict(args: {
  places: { path: string; line: number; symbol: string; result: PlaceResult }[]
  block: boolean
  serverFiles?: string[]
}): { verified: boolean; line: string } {
  const bad: string[] = []
  const missing = args.places.filter(p => p.result === 'missing')
  const near = args.places.filter(p => typeof p.result === 'object')
  const named = new Set(args.places.map(p => p.path))
  const unnamed = (args.serverFiles ?? []).filter(f => !named.has(f))
  if (!args.block) bad.push('no PLACES block')
  else if (args.places.length === 0) bad.push('the answer named no places')
  if (missing.length > 0) {
    const shown = missing.slice(0, 5).map(p => `${p.path}:${p.line} \`${p.symbol}\``).join(', ')
    bad.push(`${missing.length} place${missing.length === 1 ? '' : 's'} not found at the line given: ${shown}${missing.length > 5 ? ', …' : ''}`)
  }
  // Files the server finds references in that the answer leaves out are named, not held against it: a question about
  // src/ rightly leaves the tests out, and only the main model knows what the question covers.
  const also = unnamed.length > 0 ? `; the language server also finds references in files the answer does not name (check whether the question covers them): ${unnamed.slice(0, 5).join(', ')}${unnamed.length > 5 ? ', …' : ''}` : ''
  if (bad.length === 0) {
    const off = near.length > 0 ? ` (${near.length} ${near.length === 1 ? 'was' : 'were'} a line or two off)` : ''
    const server = args.serverFiles && args.serverFiles.length > 0 && unnamed.length === 0 ? "; the language server's references fall in the files the answer names" : also
    return {
      verified: true,
      line: `Verified: all ${args.places.length} places checked in the code (the symbol is on each line named)${off}${server}. If this answers the question, answer the person from it now: nothing is left to open.`,
    }
  }
  return { verified: false, line: `Not verified: ${bad.join('; ')}${also}. Open only these before you answer.` }
}

/** $/M tokens. Cache writes at the 5-minute rate (1.25x input). */
export type Price = { input: number; output: number; read: number; write: number }

export const PRICES: Record<string, Price> = {
  haiku: { input: 0.1, output: 0.5, read: 0.01, write: 0.125 },
  sonnet: { input: 2, output: 10, read: 0.2, write: 2.5 },
  opus: { input: 4, output: 20, read: 0.2, write: 5 },
  fable: { input: 10, output: 50, read: 0.25, write: 12.5 },
}

export function priceOf(model: string): Price {
  const m = model.toLowerCase()
  for (const k of Object.keys(PRICES)) if (m.includes(k)) return PRICES[k] as Price
  return PRICES.opus as Price
}

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export function costUsd(u: Usage, model: string): number {
  const p = priceOf(model)
  return (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.read + u.cache_creation_input_tokens * p.write) / 1e6
}

/**
 * What the same work would have cost on the main model: each of the worker's
 * requests re-reads the main context from cache, what the worker read fresh is
 * written to the main cache once, and its output is the main model's output.
 */
export function mainAloneUsd(args: { requests: number; contextTokens: number; worker: Usage; model: string }): number {
  const p = priceOf(args.model)
  const fresh = args.worker.input_tokens + args.worker.cache_creation_input_tokens
  return (args.requests * args.contextTokens * p.read + fresh * p.write + args.worker.output_tokens * p.output) / 1e6
}

export type Route = 'inline' | 'fork'

/**
 * Who reviews the evidence. Inline: the main model reads it in its next step,
 * so it is written to the main cache once and re-read on every later step. Fork:
 * one extra request re-reads the whole main context and only a verdict comes
 * back. The fork pays once the evidence costs more to carry than the context
 * costs to read: about a 60th of the context, never under 2,000 tokens.
 */
export function reviewRoute(setting: string, evidenceTokens: number, contextTokens: number): Route {
  if (setting === 'inline' || setting === 'fork') return setting
  return evidenceTokens > Math.max(2000, contextTokens / 60) ? 'fork' : 'inline'
}

/**
 * The default. Forks measured in the benchmark cost $0.03-0.38 each at a
 * 40-60k context, far more than reading the evidence inline: they did not
 * read the session's cache as assumed. Inline stays the default until they do.
 */
export const DEFAULT_REVIEW = 'inline'

export const tokensOf = (text: string) => Math.ceil(text.length / 4)

export function capLines(text: string, max: number): { text: string; cut: number } {
  const lines = text.split('\n')
  if (lines.length <= max) return { text, cut: 0 }
  return { text: lines.slice(0, max).join('\n'), cut: lines.length - max }
}

/** "+40 −12" from a unified diff. */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of diff.split('\n')) {
    if (row.startsWith('+') && !row.startsWith('+++')) added++
    else if (row.startsWith('-') && !row.startsWith('---')) removed++
  }
  return { added, removed }
}

export const REVIEW_PROMPT = (task: string, evidence: string) => `A cheaper worker model just did a task you handed it. Review its work from the evidence below (the diff and the check output, not its own claims), using what you know of this conversation.

The task you gave it:
${task.trim()}

${evidence}

Answer in this shape and nothing else:
VERDICT: accept | fix | redo
Then at most five lines, each a concrete problem with file:line, or "none". "fix" means small corrections you will make yourself; "redo" means the approach is wrong.`

export function parseVerdict(text: string): 'accept' | 'fix' | 'redo' | undefined {
  const m = /VERDICT:\s*(accept|fix|redo)/i.exec(text)
  return m ? (m[1]?.toLowerCase() as 'accept' | 'fix' | 'redo') : undefined
}

export const money = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`)
export const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

/** One hand-off as the log keeps it, for measuring what it saves and how often its work comes back. */
export type HandOff = {
  at: number
  session: string
  mode: Mode
  kind?: Kind
  model: string
  effort?: string
  reused: boolean
  focus: number
  reachRefs: number
  requests: number
  durationMs: number
  workerUsd: number
  mainAloneUsd: number
  contextTokens: number
  files: string[]
  added: number
  removed: number
  check?: { command: string; exit: number }
  route?: Route
  reviewUsd?: number
  /** The fork's tokens: whether it read the session's cache or paid for the whole context again. */
  reviewUsage?: Usage
  verdict?: string
  /** Whether the tool's own checks passed and nothing was left open. */
  verified?: boolean
  /** Edits the main model made afterwards, before the person's next prompt, to files the worker changed. */
  reworkEdits: number
  outcome: 'answer' | 'aborted' | 'error' | 'timeout' | 'refused'
}

export function summarize(records: readonly HandOff[]): string {
  if (records.length === 0) return 'No hand-offs logged yet.'
  const sum = (f: (r: HandOff) => number) => records.reduce((n, r) => n + f(r), 0)
  const worker = sum(r => r.workerUsd + (r.reviewUsd ?? 0))
  const alone = sum(r => r.mainAloneUsd)
  const edits = records.filter(r => r.mode === 'edit')
  const reworked = edits.filter(r => r.reworkEdits > 0 || r.verdict === 'redo').length
  const checked = edits.filter(r => r.check !== undefined)
  const passed = checked.filter(r => r.check?.exit === 0).length
  const reused = records.filter(r => r.reused).length
  return [
    `${records.length} hand-offs (${records.length - edits.length} explore, ${edits.length} edit), ${reused} on a warm worker.`,
    `Worker and reviews: ${money(worker)}. The same steps on the main model: about ${money(alone)}. Saved: about ${money(alone - worker)}.`,
    edits.length > 0 ? `Edit work that came back: ${reworked} of ${edits.length} (main model edited the same files afterwards, or the review said redo).` : '',
    checked.length > 0 ? `Checks passed first time: ${passed} of ${checked.length}.` : '',
    'The estimate re-reads the main context once per worker request; it cannot know how many steps the main model would really have taken.',
  ]
    .filter(Boolean)
    .join('\n')
}
