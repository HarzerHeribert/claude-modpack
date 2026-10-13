// Pure parts of the hand-off: where a task reaches, what the worker reads,
// what the work cost against doing it on the main model, and what goes back.

export type Mode = 'explore' | 'edit'
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

export function workerPrompt(args: { task: string; mode: Mode; reach: string; check?: string }): string {
  const mode =
    args.mode === 'edit'
      ? `Mode: edit. Change the files the task needs and nothing else.${args.check ? ` Afterwards this check will run: \`${args.check}\`; you may run it too.` : ''}`
      : 'Mode: explore. Read only: change no file. Find what the task asks and report it with file:line.'
  const reach = args.reach ? `\n\nWhere this reaches (from the language server; places that use what the task touches):\n${args.reach}` : ''
  return `${args.task.trim()}\n\n${mode}${reach}`
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
  model: string
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
