// Pure helpers: which name an LSP call is about, which names an edit removed,
// and which lines of the docs mention a name as code.

/** Files read as documentation. */
export const DOC_GLOBS = ['*.md', '*.mdx', '*.markdown', '*.rst', '*.adoc'] as const

export const isDoc = (path: string) => /\.(md|mdx|markdown|rst|adoc)$/i.test(path)

const WORD = /[A-Za-z0-9_$]/

/** The identifier at a 1-based character of a line, or the next one to its right. */
export function identifierAt(line: string, character: number): string | undefined {
  let i = Math.max(0, Math.min(line.length - 1, character - 1))
  if (!WORD.test(line[i] ?? '')) {
    const rest = line.slice(i).search(/[A-Za-z_$]/)
    if (rest < 0) return undefined
    i += rest
  }
  let start = i
  while (start > 0 && WORD.test(line[start - 1] ?? '')) start--
  let end = i
  while (end < line.length && WORD.test(line[end] ?? '')) end++
  const name = line.slice(start, end)
  return /^[A-Za-z_$]/.test(name) ? name : undefined
}

const DEFINITION =
  /\b(?:function\*?|class|interface|type|enum|struct|trait|def|fn|func|const|let|var|val|module|namespace|record|macro_rules!)\s+([A-Za-z_$][\w$]*)|\bfunc\s+\([^)]*\)\s*([A-Za-z_]\w*)/g

/** The names a piece of source defines, by the keywords most languages define with. */
export function definedNames(source: string): Set<string> {
  const names = new Set<string>()
  for (const m of source.matchAll(DEFINITION)) {
    const name = m[1] ?? m[2]
    if (name !== undefined && name.length >= 3) names.add(name)
  }
  return names
}

export function identifiers(source: string): Set<string> {
  return new Set(source.match(/[A-Za-z_$][\w$]*/g) ?? [])
}

/**
 * What an edit took out of the code: names the old text defined that the new
 * text no longer mentions at all, and the names it newly defines (a rename
 * shows as one of each).
 */
export function editedNames(before: string, after: string): { removed: string[]; added: string[] } {
  const inAfter = identifiers(after)
  const inBefore = identifiers(before)
  const removed = [...definedNames(before)].filter(n => !inAfter.has(n))
  const added = [...definedNames(after)].filter(n => !inBefore.has(n))
  return { removed, added }
}

export type Mention = { path: string; line: number; text: string }

/** `git grep -n` output (`path:line:text`) as mentions. */
export function parseGrep(out: string): Mention[] {
  const found: Mention[] = []
  for (const row of out.split('\n')) {
    const m = /^(.+?):(\d+):(.*)$/.exec(row)
    if (m) found.push({ path: m[1] as string, line: Number(m[2]), text: m[3] as string })
  }
  return found
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Lines of a doc that sit inside fenced code blocks, 1-based. */
export function fencedLines(doc: string): Set<number> {
  const inside = new Set<number>()
  let fence: string | undefined
  doc.split('\n').forEach((row, i) => {
    const m = /^\s*(```|~~~)/.exec(row)
    if (m) {
      if (fence === undefined) fence = m[1]
      else if (m[1] === fence) fence = undefined
      return
    }
    if (fence !== undefined) inside.add(i + 1)
  })
  return inside
}

/**
 * Whether a doc line mentions `name` as code rather than as an ordinary word:
 * inside backticks, called, reached through a dot, in a fenced block, or a name
 * no prose would use (camelCase, snake_case, a digit, a `$`).
 */
export function mentionsAsCode(text: string, name: string, fenced: boolean): boolean {
  const n = escape(name)
  if (!new RegExp(`(^|[^\\w$])${n}($|[^\\w$])`).test(text)) return false
  if (fenced) return true
  if (/[a-z][A-Z]|_|\d|\$/.test(name) || /^[A-Z][a-z]+[A-Z]/.test(name)) return true
  if (new RegExp('`[^`]*(^|[^\\w$])' + n + '($|[^\\w$])[^`]*`').test(text)) return true
  return new RegExp(`(\\.${n}\\b|\\b${n}\\s*\\()`).test(text)
}

/** "README.md:42, docs/api.md:7, … and 3 more" */
export function listPlaces(found: readonly Mention[], max = 8): string {
  const shown = found.slice(0, max).map(m => `${m.path}:${m.line}`)
  const more = found.length - shown.length
  return shown.join(', ') + (more > 0 ? `, and ${more} more` : '')
}

export function referencesNote(name: string, found: readonly Mention[]): string {
  const lines = found.slice(0, 8).map(m => `  ${m.path}:${m.line}  ${m.text.trim().slice(0, 140)}`)
  const more = found.length > 8 ? `\n  … and ${found.length - 8} more` : ''
  return `The docs mention \`${name}\` in ${found.length} place${found.length === 1 ? '' : 's'} the language server does not index:\n${lines.join('\n')}${more}`
}

export function driftNote(name: string, found: readonly Mention[], renamedTo?: string): string {
  const rename = renamedTo === undefined ? '' : ` (renamed to \`${renamedTo}\`?)`
  return `The docs still mention \`${name}\`${rename}, which no file in the code defines or uses any more: ${listPlaces(found)}. If they describe this code, update them in this change.`
}

/** Code spans in a doc that name a symbol: `name`, `name()`, `a.b.name`. */
export function codeSpanNames(doc: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = []
  doc.split('\n').forEach((row, i) => {
    for (const m of row.matchAll(/`([^`\s]+)`/g)) {
      const span = m[1] as string
      const call = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)(\(\))?$/.exec(span)
      if (!call) continue
      const name = (call[1] as string).split('.').at(-1) as string
      const codeish = call[2] !== undefined || (call[1] as string).includes('.') || /[a-z][A-Z]|_|\d/.test(name)
      if (codeish && name.length >= 3 && !STOP.has(name)) out.push({ name, line: i + 1 })
    }
  })
  return out
}

const STOP = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'self', 'this', 'README', 'TODO'])
