// A text search for a code symbol (grep, rg, ag, git grep, sed or awk), in code a
// language server covers: the search runs as asked, and Claude is told which LSP
// call answers it exactly. A nudge, never a block.

/**
 * The languages a language server reads, by file extension: the server the warm-up starts
 * once per `kind`, and the language's name as the person knows it. The extensions are those
 * the servers' plugins claim (the official ones, and lsp-plus's own).
 */
export const LANGUAGES: ReadonlyArray<{ exts: readonly string[]; kind: string; name: string }> = [
  { exts: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'], kind: 'ts', name: 'TypeScript/JavaScript' },
  { exts: ['py', 'pyi'], kind: 'py', name: 'Python' },
  { exts: ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx'], kind: 'c', name: 'C/C++' },
  { exts: ['rs'], kind: 'rs', name: 'Rust' },
  { exts: ['go'], kind: 'go', name: 'Go' },
  { exts: ['swift'], kind: 'swift', name: 'Swift' },
  { exts: ['java'], kind: 'java', name: 'Java' },
  { exts: ['kt', 'kts'], kind: 'kt', name: 'Kotlin' },
  { exts: ['cs'], kind: 'cs', name: 'C#' },
  { exts: ['php'], kind: 'php', name: 'PHP' },
  { exts: ['rb', 'rake', 'gemspec', 'ru'], kind: 'rb', name: 'Ruby' },
  { exts: ['lua'], kind: 'lua', name: 'Lua' },
  { exts: ['sh', 'bash'], kind: 'sh', name: 'shell' },
  { exts: ['tf', 'tfvars'], kind: 'tf', name: 'Terraform' },
]

/** Source files a language server reads. */
export const LSP_FILES = new RegExp(`\\.(${LANGUAGES.flatMap(l => l.exts).join('|')})$`)

const SEARCHERS = /^(?:grep|egrep|fgrep|rg|ag|ack)$/
const DEF_WORDS = '(?:def|function|class|fn|func|fun|const|let|var|val|interface|type|struct|enum|trait|protocol|object|module)'
// What may stand between the keyword and the name: Go's receiver `func (s *Server) Name`, Kotlin's
// type parameters and receiver type `fun <T> List<T>.name`, Ruby's `def self.name`.
const RECEIVER = '(?:\\([^)]*\\)\\s*|<[^>]*>\\s*)?(?:[\\w$]+(?:<[^>]*>)?\\??\\.)?'

export type SymbolSearch = { name: string; kind: 'uses' | 'definition' }

/** Splits a shell command line into words, honouring quotes; enough for a grep's arguments. */
function words(segment: string): string[] {
  const out: string[] = []
  for (const m of segment.matchAll(/'([^']*)'|"((?:[^"\\]|\\.)*)"|(\S+)/g)) out.push(m[1] ?? m[2]?.replace(/\\(.)/g, '$1') ?? (m[3] as string))
  return out
}

/** The pattern a sed or awk program searches for: `sed -n '/name/p'`, `awk '/name/ {...}'`. */
function scriptPattern(tool: string, args: string[]): string | undefined {
  for (const a of args) {
    if (a.startsWith('-')) continue
    const m = tool === 'sed' ? /^\/(.+?)\/(?:p|=)$/.exec(a) : /^\/(.+?)\/(?:\s*\{.*\})?$/s.exec(a)
    return m?.[1]
  }
  return undefined
}

/** The pattern of one grep-like command, past its options and the values they take. */
function grepPattern(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '-e' || a === '--regexp') return args[i + 1]
    if (/^--?[A-Za-z]/.test(a)) {
      if (/^(-[ABCmfgtT]|--(include|exclude|exclude-dir|glob|type|type-add|max-count|context|after-context|before-context))$/.test(a)) i++
      continue
    }
    return a
  }
  return undefined
}

/**
 * The pattern of each command of the line that searches files: after `cd …&&`,
 * behind `xargs`, in a pipeline; grep, egrep, rg, ag, ack, git grep, and sed or
 * awk printing what matches.
 */
export function searchPatterns(command: string): string[] {
  const patterns: string[] = []
  // Each command of the line; in a pipeline only its head or an xargs stage reads files (a grep fed by a pipe filters text).
  const stages = command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .flatMap(cmd => cmd.split(/\s*\|\s*/).filter((stage, i) => i === 0 || /^xargs\b/.test(stage.trim())))
  for (const raw of stages) {
    let args = words(raw.trim())
    if (args[0] === 'xargs') {
      // xargs' own options (and the values of -n, -I, -P, -L, -s, -d) come before the command it runs.
      let i = 1
      while (i < args.length && (args[i] as string).startsWith('-')) i += /^-[nIPLsd]$/.test(args[i] as string) ? 2 : 1
      args = args.slice(i)
    }
    const tool = args[0] ?? ''
    let pattern: string | undefined
    if (tool === 'git' && args[1] === 'grep') pattern = grepPattern(args.slice(2))
    else if (SEARCHERS.test(tool)) pattern = grepPattern(args.slice(1))
    else if ((tool === 'sed' && args.includes('-n')) || tool === 'awk') pattern = scriptPattern(tool, args.slice(1))
    if (pattern !== undefined) patterns.push(pattern)
  }
  return patterns
}

/**
 * Whether a shell command searches for one code symbol. Its pattern must name
 * one identifier (bare, `-w`, `\bname\b`, `name(`, `.name`) or its definition
 * (`def name`, `function name`); alternations and free text are not symbols.
 */
export function symbolSearch(command: string): SymbolSearch | undefined {
  for (const pattern of searchPatterns(command)) {
    const found = asSymbol(pattern)
    if (found !== undefined) return found
  }
  return undefined
}

function asSymbol(pattern: string): SymbolSearch | undefined {
  const p = pattern.replace(/\\b|\\<|\\>/g, '').replace(/^\^\s*/, '')
  const def = new RegExp(`^(?:export\\s+)?${DEF_WORDS}\\s+(?:\\\\?\\([^)]*\\)\\s*)?(?:[\\w$]+\\\\?\\.)?([A-Za-z_$][\\w$]*)\\b`).exec(p)
  if (def) return { name: def[1] as string, kind: 'definition' }
  const use = /^\.?([A-Za-z_$][\w$]*)(?:\\?\(|\s*\\?\()?$/.exec(p)
  if (use && (use[1] as string).length >= 3) return { name: use[1] as string, kind: 'uses' }
  return undefined
}

export type Hit = { path: string; line: number; text: string }

/** `path:line:text` rows of a grep's output (with -n), only in files a language server reads. */
export function codeHits(output: string): Hit[] {
  const hits: Hit[] = []
  for (const row of output.split('\n')) {
    const m = /^([^\s:]+):(\d+):(.*)$/.exec(row)
    if (m && LSP_FILES.test(m[1] as string)) hits.push({ path: m[1] as string, line: Number(m[2]), text: m[3] as string })
  }
  return hits
}

/**
 * Whether a source line uses `name` as code: outside its string literals and a
 * trailing comment. A name met only in strings (a mod's name in a message, a
 * key) is no symbol to ask the language server about.
 */
export function usesAsCode(text: string, name: string): boolean {
  const code = text.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/(^|\s)(#|\/\/).*$/, '')
  return new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(code)
}

/** Among the hits, where `name` is defined, at the column the LSP tool asks for (1-based). */
export function definitionAt(hits: readonly Hit[], name: string): { path: string; line: number; character: number } | undefined {
  const re = new RegExp(`\\b${DEF_WORDS}\\s+${RECEIVER}(${name.replace(/\$/g, '\\$')})\\b`)
  for (const h of hits) {
    const m = re.exec(h.text)
    if (m) return { path: h.path, line: h.line, character: m.index + m[0].length - name.length + 1 }
  }
  return undefined
}

/**
 * The note: what the language server answers better, the exact call, and what
 * it cannot see, so grep keeps that part. It adds a way; it takes none away.
 *
 * With the cells mod's run_cell in the session, the note also names the call
 * there: refs() asks the server without the LSP tool loaded first (it is
 * deferred) and gives each place with its line, and rename() renames every
 * code reference through Edit. `file` is a file that uses the name, for when
 * the definition is not among the hits.
 */
export function nudge(
  search: SymbolSearch,
  at: { path: string; line: number; character: number } | undefined,
  again: boolean,
  cells: { file?: string } | undefined = undefined,
): string {
  const where = at ? `LSP findReferences on ${at.path}:${at.line}:${at.character}` : `LSP workspaceSymbol with query "${search.name}"`
  const cell = cells === undefined ? undefined : at ? `refs('${at.path}', '${search.name}', { line: ${at.line} })` : cells.file ? `refs('${cells.file}', '${search.name}')` : undefined
  if (again) {
    const or = cell ? ` (or ${cell} in run_cell)` : ''
    return `\`${search.name}\`: ${where}${or} gives its exact code uses; grep stays needed for strings, docs and dynamic uses.`
  }
  const what = at
    ? 'lists exactly its uses in the code, without comments, strings or namesakes, and incomingCalls there lists the functions that call it'
    : 'finds its definition, and findReferences there lists exactly its uses in the code'
  const note = `\`${search.name}\` is a code symbol in files a language server covers: ${where} ${what}. The server does not see strings, dynamic uses or most docs, so for a rename or a complete sweep keep the grep for those.`
  if (cell === undefined) return note
  return `${note} In run_cell, ${cell} asks the same in one step without loading the LSP tool, each place with its line; rename(path, name, newName) there renames every code reference through Edit and lists where the name is left as text.`
}
