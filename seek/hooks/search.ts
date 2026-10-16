// A code search (grep, rg, git grep, or the Grep tool): the command as Claude writes it (behind a cd, chained, piped)
// and the hits in its output. Pure: no file or process is touched here.

export type Search = {
  tool: 'grep' | 'rg' | 'git grep' | 'Grep'
  pattern: string
  /** Files or directories searched, as written; empty where the tool searches the session's folder. */
  operands: string[]
  ignoreCase: boolean
  fixed: boolean
  /** Lines the command lets through (`| head -N`, `head_limit`); a result this long may be cut. */
  headLimit?: number
}

export type Hit = { path?: string; line: number; text: string }
export type Group = { path: string; lines: number[]; texts: string[]; /** Hit lines the output already shows context lines for. */ covered?: number[] }


// ---------------------------------------------------------------- the command

type Word = { text: string; redirect: boolean }
type Op = '|' | ';' | '&&' | '||'

/** A command line as words and operators (`|` only, unless `chain`: also `;`, `&&`, `||`, newline); undefined where it holds anything else. */
function tokenize(command: string, chain = false): Array<Word | Op> | undefined {
  if (/[`]|\$\(/.test(command) || (!chain && command.includes('\n'))) return undefined
  const out: Array<Word | Op> = []
  let i = 0
  while (i < command.length) {
    const c = command[i] as string
    if (c === ' ' || c === '\t' || c === '\r') {
      i++
      continue
    }
    if (c === '|') {
      if (command[i + 1] === '|') {
        if (!chain) return undefined
        out.push('||')
        i += 2
        continue
      }
      out.push('|')
      i++
      continue
    }
    if (chain && (c === ';' || c === '\n')) {
      out.push(';')
      i++
      continue
    }
    if (chain && c === '&' && command[i + 1] === '&') {
      out.push('&&')
      i += 2
      continue
    }
    // `2>&1` is part of a word; a lone `&`, and in a plain command `&&` and `;`, chain commands.
    if (c === '&' || c === ';') return undefined
    let text = ''
    let redirect = false
    while (i < command.length) {
      const ch = command[i] as string
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '|' || ch === ';' || ch === '\n') break
      if (chain && ch === '&' && command[i + 1] === '&') break
      if (ch === "'") {
        const end = command.indexOf("'", i + 1)
        if (end < 0) return undefined
        text += command.slice(i + 1, end)
        i = end + 1
      } else if (ch === '"') {
        i++
        for (;;) {
          const d = command[i]
          if (d === undefined) return undefined
          if (d === '"') {
            i++
            break
          }
          if (d === '\\' && /["\\$]/.test(command[i + 1] ?? '')) {
            text += command[i + 1]
            i += 2
          } else {
            text += d
            i++
          }
        }
      } else if (ch === '\\') {
        text += command[i + 1] ?? ''
        i += 2
      } else {
        if (ch === '<' || ch === '>') redirect = true
        if (ch === '&' && !(command[i - 1] === '>' && /\d/.test(command[i + 1] ?? ''))) return undefined
        text += ch
        i++
      }
    }
    out.push({ text, redirect })
  }
  return out
}

const OK_REDIRECT = /^(\d*>+\s*\/dev\/null|\d*>&\d)$/

// Options whose value is the next word (or the rest of a short bundle), by tool.
const SHORT_VALUE: Record<string, string> = { grep: 'mfdD', rg: 'gmtTjMEfr', 'git grep': 'mf' }
const LONG_VALUE = /^--(include|exclude|exclude-dir|exclude-from|glob|iglob|type|type-not|type-add|max-count|max-depth|file|threads|replace|color|colors|ignore-file|encoding|sort|sortr|pre|pre-glob|path-separator|devices|directories|binary-files|label)$/
const LONG_SKIP = /^--(context|after-context|before-context|count|files-with-matches|files-without-match|files|json|quiet|silent|count-matches|null-data)(=|$)/

/** `head`, `head -5`, `head -n 5`, `head -n5`: the lines it lets through; undefined where it is anything else. */
function headLines(args: string[]): number | undefined {
  if (args.length === 0) return 10
  let n: number | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    const m = /^-n?(\d+)$/.exec(a)
    if (m) n = Number(m[1])
    else if (a === '-n' && /^\d+$/.test(args[i + 1] ?? '')) n = Number(args[++i])
    else return undefined
  }
  return n
}

/** A stage's words without its harmless redirects (`2>/dev/null`, `2>&1`); undefined where it redirects anywhere else. */
function stageWords(stage: readonly Word[]): string[] | undefined {
  const words: string[] = []
  for (let k = 0; k < stage.length; k++) {
    const w = stage[k] as Word
    if (!w.redirect) {
      words.push(w.text)
      continue
    }
    if (OK_REDIRECT.test(w.text)) continue
    if (/^\d*>$/.test(w.text) && stage[k + 1]?.text === '/dev/null') {
      k++
      continue
    }
    return undefined
  }
  return words
}

/** A plain grep / egrep / fgrep / rg / git grep, optionally piped into head; undefined for anything else or a mode seek skips. */
export function parseCommand(command: string): Search | undefined {
  const toks = tokenize(command.trim())
  if (toks === undefined) return undefined
  const stages: Word[][] = [[]]
  for (const t of toks) {
    if (t === '|') stages.push([])
    else if (typeof t !== 'string') stages[stages.length - 1]?.push(t)
  }
  if (stages.length > 2) return undefined
  let headLimit: number | undefined
  if (stages.length === 2) {
    const second = (stages[1] as Word[]).map(w => w.text)
    if (second[0] !== 'head' || (stages[1] as Word[]).some(w => w.redirect)) return undefined
    headLimit = headLines(second.slice(1))
    if (headLimit === undefined) return undefined
  }
  const words = stageWords(stages[0] as Word[])
  if (words === undefined) return undefined
  const search = parseSearchWords(words, false)
  return search === undefined ? undefined : { ...search, headLimit }
}

/** The search a grep / rg / git grep stage runs. `lenient` lets context, count and list flags through (their output is read, not assumed). */
function parseSearchWords(words: readonly string[], lenient: boolean): Search | undefined {
  let tool: Search['tool']
  let i = 1
  if (words[0] === 'git' && words[1] === 'grep') {
    tool = 'git grep'
    i = 2
  } else if (words[0] === 'rg') tool = 'rg'
  else if (words[0] === 'grep' || words[0] === 'egrep' || words[0] === 'fgrep') tool = 'grep'
  else return undefined
  let fixed = words[0] === 'fgrep'
  let ignoreCase = false
  let recursive = tool !== 'grep'
  const patterns: string[] = []
  const rest: string[] = []
  const valueChars = SHORT_VALUE[tool] ?? ''
  for (; i < words.length; i++) {
    const a = words[i] as string
    if (a === '--') {
      rest.push(...words.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      if (LONG_SKIP.test(a)) {
        if (!lenient) return undefined
        if (/^--(context|after-context|before-context)$/.test(a)) i++
        continue
      }
      if (a === '--ignore-case') ignoreCase = true
      else if (a === '--fixed-strings') fixed = true
      else if (a === '--recursive' || a === '--dereference-recursive') recursive = true
      else if (a === '--regexp') patterns.push(words[++i] ?? '')
      else if (a.startsWith('--regexp=')) patterns.push(a.slice(9))
      else if (a === '--file' || a.startsWith('--file=')) return undefined
      else if (LONG_VALUE.test(a)) i++
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        const c = a[k] as string
        if ('lcLqZABC'.includes(c) || /\d/.test(c)) {
          if (!lenient) return undefined
          if ('ABC'.includes(c)) {
            if (a.slice(k + 1) === '') i++
            break
          }
          continue
        }
        if (c === 'i') ignoreCase = true
        else if (c === 'F') fixed = true
        else if (c === 'r' && tool === 'grep') recursive = true
        else if (c === 'R') recursive = true
        else if (c === 'e') {
          const v = a.slice(k + 1)
          patterns.push(v !== '' ? v : (words[++i] ?? ''))
          break
        } else if (c === 'f') return undefined
        else if (valueChars.includes(c)) {
          if (a.slice(k + 1) === '') i++
          break
        }
      }
      continue
    }
    rest.push(a)
  }
  if (patterns.length === 0) {
    const p = rest.shift()
    if (p === undefined) return undefined
    patterns.push(p)
  }
  if (tool === 'grep' && !recursive && rest.length === 0) return undefined // reads a pipe
  const pattern = patterns.join('|')
  if (pattern === '') return undefined
  const operands = tool === 'git grep' ? rest.filter(o => !o.startsWith(':')) : rest
  return { tool, pattern, operands, ignoreCase, fixed, headLimit: undefined }
}

// A command that writes, deletes or runs other code is no read-only search.
const WRITERS = new Set(['rm', 'mv', 'cp', 'tee', 'touch', 'mkdir', 'rmdir', 'dd', 'chmod', 'chown', 'truncate', 'ln', 'install', 'xargs', 'eval', 'exec', 'sudo', 'sh', 'bash', 'zsh', 'python', 'python3', 'node', 'ruby', 'perl', 'curl', 'wget', 'npm', 'pip', 'make'])
const GIT_READ = new Set(['grep', 'log', 'show', 'diff', 'status', 'ls-files', 'blame', 'rev-parse', 'branch'])

/** Whether a stage (redirects already vetted) only reads. */
function readsOnly(words: readonly string[]): boolean {
  const cmd = (words[0] ?? '').split('/').pop() as string
  if (WRITERS.has(cmd)) return false
  if (cmd === 'git') return GIT_READ.has(words[1] ?? '')
  const args = words.slice(1)
  if (cmd === 'sed' && args.some(a => /^-[a-zA-Z]*i/.test(a) || a === '--in-place' || a.startsWith('--in-place='))) return false
  if (cmd === 'awk' && args.some(a => a === '-i' || a === 'inplace')) return false
  if (cmd === 'find' && args.some(a => /^-(delete|exec|execdir|ok|fprint\w*)$/.test(a))) return false
  return true
}

export type BashSearch = {
  /** The directory of a leading `cd <dir>`, as written. */
  cd?: string
  /** The search segments: a grep / rg / git grep that starts a pipeline. */
  searches: Search[]
}

/** A read-only command line (cd prefix, `;`/`&&` chains, pipes) with at least one search in it; undefined for anything else. */
export function parseBash(command: string): BashSearch | undefined {
  const toks = tokenize(command.trim(), true)
  if (toks === undefined) return undefined
  const pipelines: Word[][][] = [[[]]]
  for (const t of toks) {
    const cur = pipelines[pipelines.length - 1] as Word[][]
    if (t === '|') cur.push([])
    else if (t === ';' || t === '&&' || t === '||') pipelines.push([[]])
    else (cur[cur.length - 1] as Word[]).push(t)
  }
  let cd: string | undefined
  const searches: Search[] = []
  let first = true
  for (const pipe of pipelines) {
    if (pipe.length === 1 && (pipe[0] as Word[]).length === 0) continue
    if (pipe.some(st => st.length === 0)) return undefined
    const stages: string[][] = []
    for (const st of pipe) {
      const w = stageWords(st)
      if (w === undefined || w.length === 0 || !readsOnly(w)) return undefined
      stages.push(w)
    }
    const head = stages[0] as string[]
    if (head[0] === 'cd') {
      if (!first || pipe.length !== 1 || head.length !== 2) return undefined
      const dir = head[1] as string
      if (/[$~*?]/.test(dir) || dir === '-' || dir.startsWith('-')) return undefined
      cd = dir
      first = false
      continue
    }
    first = false
    if (stages.slice(1).some(st => st[0] === 'cd')) return undefined
    if (['grep', 'egrep', 'fgrep', 'rg', 'git'].includes(head[0] as string) && (head[0] !== 'git' || head[1] === 'grep')) {
      const search = parseSearchWords(head, true)
      if (search === undefined) return undefined
      for (const st of stages.slice(1)) {
        if (st[0] !== 'head') continue
        const n = headLines(st.slice(1))
        if (n === undefined) return undefined
        search.headLimit = Math.min(search.headLimit ?? n, n)
      }
      searches.push(search)
    }
  }
  return searches.length === 0 ? undefined : { cd, searches }
}

/** The Grep tool's input, as a search; undefined for the modes seek skips. */
export function parseToolInput(input: Record<string, unknown>): Search | undefined {
  if (typeof input.pattern !== 'string' || input.pattern === '') return undefined
  if (input.output_mode !== 'content') return undefined
  if (input['-n'] === false) return undefined
  if (input.multiline === true) return undefined
  for (const k of ['-A', '-B', '-C', 'context']) if (typeof input[k] === 'number' && input[k] !== 0) return undefined
  return {
    tool: 'Grep',
    pattern: input.pattern,
    operands: typeof input.path === 'string' && input.path !== '' ? [input.path] : [],
    ignoreCase: input['-i'] === true,
    fixed: false,
    headLimit: typeof input.head_limit === 'number' && input.head_limit > 0 ? input.head_limit : undefined,
  }
}

// ---------------------------------------------------------------- the output

/** Nothing found: no text, grep's bare exit-1 report, or the Grep tool's message. */
export function isEmpty(text: string): boolean {
  // Claude Code shows a grep with no hits (exit 1) as "(Bash completed with no output)", not as an error (checked 15 Oct).
  return /^\s*(Exit code 1|No matches found\.?|No files found\.?|\(Bash completed with no output\))?\s*$/i.test(text)
}

/** The rows of a search's output as hits; undefined where any row is not a hit (a binary file, a context separator, a cut). */
export function parseHits(output: string, operands: readonly string[]): Hit[] | undefined {
  const rows = output.split('\n')
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  if (rows.length === 0) return []
  if (operands.length === 1 && rows.every(r => /^\d+:/.test(r))) {
    return rows.map(r => {
      const m = /^(\d+):(.*)$/.exec(r) as RegExpExecArray
      return { line: Number(m[1]), text: m[2] as string }
    })
  }
  const hits: Hit[] = []
  for (const r of rows) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(r)
    if (!m) return undefined
    hits.push({ path: m[1] as string, line: Number(m[2]), text: m[3] as string })
  }
  return hits
}

/** `a/./b` and `a/b/../c` flattened; relative paths are made absolute against `cwd`. */
export function normalize(path: string, cwd: string): string {
  const out: string[] = []
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

/** The hits per file, in the order the files were listed. */
export function groupHits(hits: readonly Hit[], operands: readonly string[]): Group[] {
  const groups = new Map<string, Group>()
  for (const h of hits) {
    const path = h.path ?? (operands[0] as string)
    let g = groups.get(path)
    if (g === undefined) groups.set(path, (g = { path, lines: [], texts: [] }))
    if (!g.lines.includes(h.line)) {
      g.lines.push(h.line)
      g.texts.push(h.text)
    }
  }
  return [...groups.values()]
}

// ---------------------------------------------------------------- the output of a command line

export const MAX_OUTPUT_LINES = 400

export type Parsed = {
  hits: Hit[]
  /** `path:line` of the hits whose output already holds context lines. */
  covered: Set<string>
  /** A row says the output was cut. */
  cut: boolean
}

const cleanPath = (p: string) => p.replace(/^(\.\/)+/, '')

/** The first `<sep>N<sep>` split of a row: what comes before it as a path. */
function splitRow(row: string, sep: ':' | '-'): { path: string; line: number; text: string } | undefined {
  const m = (sep === ':' ? /:(\d+):/ : /-(\d+)-/).exec(row)
  if (!m || m.index === 0) return undefined
  return { path: cleanPath(row.slice(0, m.index)), line: Number(m[1]), text: row.slice(m.index + m[0].length) }
}

/** The paths the rows of an output may start with (`path:12:` and `path-12-` forms). */
export function candidatePaths(output: string): string[] {
  const out = new Set<string>()
  for (const row of output.split('\n')) for (const sep of [':', '-'] as const) {
    const s = splitRow(row, sep)
    if (s !== undefined) out.add(s.path)
  }
  return [...out]
}

/**
 * The hit rows (`path:line:text`) and context rows (`path-line-text`) of an output. A path counts only where `exists` says so.
 * Rows `line:text` / `line-text` belong to `single`, the one file the command searches, when there is one.
 */
export function parseOutput(output: string, exists: (path: string) => boolean, single?: string): Parsed {
  const rows = output.split('\n')
  const seen = new Set<string>()
  const hits: Hit[] = []
  const lines = new Map<string, { hit: Set<number>; ctx: Set<number> }>()
  let cut = false
  for (const row of rows) {
    let found: { path: string; line: number; text: string; ctx: boolean } | undefined
    for (const sep of [':', '-'] as const) {
      const s = splitRow(row, sep)
      if (s !== undefined && exists(s.path)) {
        found = { ...s, ctx: sep === '-' }
        break
      }
    }
    if (found === undefined && single !== undefined) {
      const m = /^(\d+)([:-])(.*)$/.exec(row)
      if (m) found = { path: cleanPath(single), line: Number(m[1]), text: m[3] as string, ctx: m[2] === '-' }
    }
    if (found === undefined) {
      if (/truncated|Showing results with pagination/i.test(row)) cut = true
      continue
    }
    let l = lines.get(found.path)
    if (l === undefined) lines.set(found.path, (l = { hit: new Set(), ctx: new Set() }))
    ;(found.ctx ? l.ctx : l.hit).add(found.line)
    const key = `${found.path}:${found.line}`
    if (!found.ctx && !seen.has(key)) {
      seen.add(key)
      hits.push({ path: found.path, line: found.line, text: found.text })
    }
  }
  // A hit is covered where a run of consecutive output lines around it holds a context line.
  const covered = new Set<string>()
  for (const [path, l] of lines) {
    const all = [...new Set([...l.hit, ...l.ctx])].sort((a, b) => a - b)
    let run: number[] = []
    const flush = () => {
      if (run.some(n => l.ctx.has(n))) for (const n of run) if (l.hit.has(n)) covered.add(`${path}:${n}`)
      run = []
    }
    for (const n of all) {
      if (run.length > 0 && n !== (run[run.length - 1] as number) + 1) flush()
      run.push(n)
    }
    flush()
  }
  return { hits, covered, cut }
}
