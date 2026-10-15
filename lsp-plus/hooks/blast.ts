// An edit that changes a function's parameters: the callers the language server knows, which
// may still pass the old ones. Code-graph tools print a "blast radius" after every edit from a
// stored graph; this one asks the live server, and only when a signature changed.

// What may stand between the keyword and the name: Go's receiver `func (s *Server) Name`, Kotlin's
// type parameters and receiver type `fun <T> List<T>.name`.
const BEFORE_NAME = '(?:\\([^)]*\\)\\s*|<[^>]*>\\s*)?(?:[\\w$]+(?:<[^>]*>)?\\??\\.)?'

/** A definition's header up to its name: the keyword, what may stand before the name, the name. */
export function headerPattern(name = '[A-Za-z_$][\\w$]*'): RegExp {
  return new RegExp(`\\b(?:def|function|fn|func|fun)\\s+${BEFORE_NAME}(${name})\\b`)
}

/** A definition's header: up to the name, an optional type-parameter list, then `(`. */
const HEADER = new RegExp(`${headerPattern().source}\\s*(?:<[^>]*>)?\\s*\\(`, 'g')

/** Each function a piece of source defines, with its parameter list as written (balanced parentheses, whitespace dropped). */
export function signatures(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of source.matchAll(HEADER)) {
    let depth = 1
    let i = (m.index as number) + m[0].length
    const start = i
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth++
      else if (source[i] === ')') depth--
    }
    // A header cut off by the edit's boundary is no signature to compare.
    if (depth === 0) out.set(m[1] as string, source.slice(start, i - 1).replace(/#.*$/gm, '').replace(/\s+/g, '').replace(/,$/, ''))
  }
  return out
}

/** The functions an edit kept but whose parameter list it changed. */
export function changedSignatures(before: string, after: string): string[] {
  const was = signatures(before)
  const now = signatures(after)
  return [...now].filter(([name, params]) => was.has(name) && was.get(name) !== params).map(([name]) => name)
}

/** The note: who calls it, from the server, and why that matters now. */
export function blastNote(name: string, rows: readonly string[], count: number, files: number): string {
  return `\`${name}\`'s parameters changed; per the language server it is called from ${count} place${count === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'}, which may still pass the old ones:\n${rows.join('\n')}`
}
