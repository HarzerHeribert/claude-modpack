// Where a search's hits sit: the definitions (functions, methods, classes) that hold them, with their line ranges,
// from the file's own text. A few tokens per definition instead of the code itself: Claude learns which function
// each hit is in and where it ends, so it can read exactly that, or nothing, in its next step. Pure: no I/O.

import { tokensOf } from './economy'

export type Def = { name: string; qualified: string; start: number; end: number }

const PYTHON = /\.pyi?$/
const BRACES = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|go|rs|java|kt|kts|swift|c|cc|cpp|cxx|h|hpp|cs|scala|php|dart)$/

/** Whether seek can outline a file of this name. */
export function outlinable(path: string): boolean {
  return PYTHON.test(path) || BRACES.test(path)
}

const indentOf = (row: string) => {
  let n = 0
  for (const c of row) {
    if (c === ' ') n++
    else if (c === '\t') n += 4
    else break
  }
  return n
}

/** A row without its string literals and its trailing comment (`#` or `//`), for counting brackets. */
function code(row: string, hash: boolean): string {
  const bare = row.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
  const cut = hash ? bare.indexOf('#') : bare.indexOf('//')
  return cut < 0 ? bare : bare.slice(0, cut)
}

const PY_DEF = /^(\s*)(?:async\s+def|def|class)\s+([A-Za-z_]\w*)/

function pythonDefs(rows: readonly string[]): Array<Omit<Def, 'qualified'>> {
  const out: Array<Omit<Def, 'qualified'>> = []
  for (let i = 0; i < rows.length; i++) {
    const m = PY_DEF.exec(rows[i] as string)
    if (!m) continue
    const indent = indentOf(m[1] as string)
    // The header may run over several lines: it ends at the first ':' outside brackets. Anything after that ':' on
    // its line is a one-line body (`def f(x) -> int: ...`, an overload stub; `class A: pass`).
    let header: { line: number; oneLine: boolean } | undefined
    let depth = 0
    for (let j = i; j < rows.length && j < i + 40 && header === undefined; j++) {
      const c = code(rows[j] as string, true)
      for (let k = 0; k < c.length; k++) {
        const ch = c[k] as string
        if ('([{'.includes(ch)) depth++
        else if (')]}'.includes(ch)) depth--
        else if (ch === ':' && depth <= 0) {
          header = { line: j, oneLine: c.slice(k + 1).trim() !== '' }
          break
        }
      }
    }
    if (header === undefined) continue
    if (header.oneLine) {
      out.push({ name: m[2] as string, start: i + 1, end: header.line + 1 })
      continue
    }
    const j = header.line
    let end = j
    for (let k = j + 1; k < rows.length; k++) {
      const r = rows[k] as string
      if (r.trim() === '') continue
      if (indentOf(r) <= indent) break
      end = k
    }
    out.push({ name: m[2] as string, start: i + 1, end: end + 1 })
  }
  return out
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with', 'new', 'typeof', 'await', 'match', 'loop', 'unsafe', 'super', 'this', 'foreach', 'using', 'lock', 'synchronized', 'when', 'guard', 'defer', 'select', 'go', 'case'])
const BRACE_DEFS = [
  // function foo / export default async function* foo
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  // class / interface / enum / struct / trait / impl / namespace Foo
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:(?:public|private|protected|internal|abstract|final|sealed|static|open|data|pub(?:\([^)]*\))?)\s+)*(?:class|interface|enum|namespace|module|struct|trait|impl(?:<[^>]*>)?|object|record|protocol|extension)\s+([A-Za-z_$][\w$]*)/,
  // const foo = (…) => / const foo = async function
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:<[^>]*>)?\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
  // Rust fn, Go/Swift func (with a receiver), Kotlin fun
  /^\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|const|extern|public|private|fileprivate|internal|open|override|static|final|mutating|suspend|inline|operator|infix|tailrec|abstract)\s+)*(?:fn|func|fun)\s+(?:\([^)]*\)\s*)?(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/,
  // a method or C-like function whose signature is one line ending in `{`: [modifiers] [type] name(…) [: type] {
  /^\s*(?:(?:public|private|protected|internal|static|async|readonly|override|abstract|final|virtual|sealed|partial|synchronized|native|get|set|export|default)\s+)*(?:[\w$<>[\],.?*&]+\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\((?:[^()]|\([^()]*\))*\)\s*(?::\s*[^={;]+|->\s*[^={;]+|throws\s+[\w., ]+)?\s*\{\s*$/,
]

function braceDefs(rows: readonly string[]): Array<Omit<Def, 'qualified'>> {
  const out: Array<Omit<Def, 'qualified'>> = []
  let inComment = false
  const clean = rows.map(r => {
    let s = r
    if (inComment) {
      const e = s.indexOf('*/')
      if (e < 0) return ''
      s = s.slice(e + 2)
      inComment = false
    }
    s = s.replace(/\/\*.*?\*\//g, '')
    const b = s.indexOf('/*')
    if (b >= 0) {
      inComment = true
      s = s.slice(0, b)
    }
    return code(s, false)
  })
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as string
    let name: string | undefined
    for (const re of BRACE_DEFS) {
      const m = re.exec(row)
      if (m && !KEYWORDS.has(m[1] as string)) {
        name = m[1] as string
        break
      }
    }
    if (name === undefined) continue
    // The block: from the first `{` within a few lines to the brace that closes it.
    let depth = 0
    let opened = false
    let end = i
    for (let k = i; k < rows.length; k++) {
      const c = clean[k] as string
      if (!opened && k > i + 4) break
      if (!opened && /;\s*$/.test(c) && !c.includes('{')) break // a declaration without a body
      for (const ch of c) {
        if (ch === '{') {
          depth++
          opened = true
        } else if (ch === '}') depth--
      }
      end = k
      if (opened && depth <= 0) break
    }
    if (!opened) continue
    out.push({ name, start: i + 1, end: end + 1 })
  }
  return out
}

/** The file's definitions with their line ranges and nested names (`Class.method`); undefined for a language seek cannot read. */
export function outline(path: string, text: string): Def[] | undefined {
  const rows = text.split('\n')
  const raw = PYTHON.test(path) ? pythonDefs(rows) : BRACES.test(path) ? braceDefs(rows) : undefined
  if (raw === undefined) return undefined
  const stack: Def[] = []
  const out: Def[] = []
  for (const d of raw.sort((a, b) => a.start - b.start || b.end - a.end)) {
    while (stack.length > 0 && (stack[stack.length - 1] as Def).end < d.start) stack.pop()
    const outer = stack[stack.length - 1]
    const def = { ...d, qualified: outer && d.end <= outer.end ? `${outer.qualified}.${d.name}` : d.name }
    out.push(def)
    stack.push(def)
  }
  return out
}

/** The innermost definition holding a line; undefined at the top level. */
export function enclosing(defs: readonly Def[], line: number): Def | undefined {
  let best: Def | undefined
  for (const d of defs) if (d.start <= line && line <= d.end && (best === undefined || d.start >= best.start)) best = d
  return best
}

export type FileHits = { path: string; lines: number[]; text: string }

/** One row of the map: `path: Class.method 120-180 (2), helper 30-41, top level (1)`; undefined where no hit sits in a definition. */
export type MapRow = { path: string; parts: string[]; row: string }

export function mapRow(f: FileHits): MapRow | undefined {
  const defs = outline(f.path, f.text)
  if (defs === undefined) return undefined
  const by = new Map<Def, number>()
  let top = 0
  for (const l of new Set(f.lines)) {
    const d = enclosing(defs, l)
    if (d === undefined) top++
    else by.set(d, (by.get(d) ?? 0) + 1)
  }
  if (by.size === 0) return undefined
  const parts = [...by.entries()].sort((a, b) => a[0].start - b[0].start).map(([d, n]) => `${d.qualified} ${d.start}-${d.end}${n > 1 ? ` (${n})` : ''}`)
  if (top > 0) parts.push(`top level (${top})`)
  return { path: f.path, parts, row: `${f.path}: ${parts.join(', ')}` }
}

export const MAP_HEAD = 'seek: where the hits sit (the definitions that hold them, with their lines):'

/**
 * The map of a search's hits within `budget` tokens: files with the most hits first, each a row of its definitions;
 * rows past the budget are left out and counted, and where not even the first fits, its first definitions are kept.
 * Undefined where nothing fits or no hit sits in a definition.
 */
export function hitMap(files: readonly FileHits[], budget: number): string | undefined {
  const rows = files
    .map((f, i) => ({ f, i }))
    .sort((a, b) => new Set(b.f.lines).size - new Set(a.f.lines).size || a.i - b.i)
    .map(({ f }) => mapRow(f))
    .filter((r): r is MapRow => r !== undefined)
  if (rows.length === 0) return undefined
  const kept: string[] = []
  for (const r of rows) {
    const left = rows.length - kept.length - 1
    const text = [MAP_HEAD, ...kept, r.row, ...(left > 0 ? [`… ${left} more files`] : [])].join('\n')
    if (tokensOf(text) > budget) break
    kept.push(r.row)
  }
  const moreFiles = (n: number) => (n > 0 ? [`… ${n} more file${n === 1 ? '' : 's'}`] : [])
  if (kept.length === 0) {
    const first = rows[0] as MapRow
    for (let n = first.parts.length - 1; n >= 1; n--) {
      const text = [MAP_HEAD, `${first.path}: ${first.parts.slice(0, n).join(', ')}, … ${first.parts.length - n} more`, ...moreFiles(rows.length - 1)].join('\n')
      if (tokensOf(text) <= budget) return text
    }
    return undefined
  }
  const more = rows.length - kept.length
  return [MAP_HEAD, ...kept, ...moreFiles(more)].join('\n')
}
