// The language server's answer to a symbol grep, attached to the grep's own result: the
// functions that call it, or its references, read from the server by the hook itself. No
// advice and no second step for Claude: the exact code answer is already there, and grep's
// output stays for what the server cannot see (strings, comments, docs, namesakes).

/** One place the server lists: a caller (with the lines it calls from) or a reference line. */
export type Caller = { file: string; name: string; kind: string; line: number; at: number[] }

/** `incomingCalls` text: `file:` headers, then `  name (Kind) - Line N [calls at: L:C, …]`. */
export function parseIncoming(text: string): Caller[] {
  const out: Caller[] = []
  let file = ''
  for (const row of text.split('\n')) {
    const header = /^(\S.*):$/.exec(row)
    if (header && !row.startsWith('Found')) {
      file = header[1] as string
      continue
    }
    const m = /^\s+(\S+) \((\w+)\) - Line (\d+)(?: \[calls at: ([^\]]*)\])?/.exec(row)
    if (m && file) {
      const at = (m[4] ?? '').split(',').map(s => Number(s.trim().split(':')[0])).filter(n => n > 0)
      out.push({ file, name: m[1] as string, kind: m[2] as string, line: Number(m[3]), at })
    }
  }
  return out
}

/** `findReferences` text: `file:` headers, then `  Line L:C` rows (or `file:L:C` for a single one). */
export function parseReferences(text: string): Array<{ file: string; line: number }> {
  const out: Array<{ file: string; line: number }> = []
  let file = ''
  for (const row of text.split('\n')) {
    const single = /^\s+(\S+?):(\d+):(\d+)$/.exec(row)
    if (single) {
      out.push({ file: single[1] as string, line: Number(single[2]) })
      continue
    }
    const header = /^(\S.*):$/.exec(row)
    if (header && !row.startsWith('Found')) {
      file = header[1] as string
      continue
    }
    const m = /^\s+Line (\d+):\d+/.exec(row)
    if (m && file) out.push({ file, line: Number(m[1]) })
  }
  return out
}

/** `documentSymbol` text, as a tree by indentation: each symbol with the names of those it sits in. */
export function parseOutline(text: string): Array<{ name: string; kind: string; line: number; path: string[] }> {
  const out: Array<{ name: string; kind: string; line: number; path: string[] }> = []
  const stack: Array<{ depth: number; name: string }> = []
  for (const row of text.split('\n')) {
    const m = /^(\s*)(\S+) \((\w+)\) - Line (\d+)/.exec(row)
    if (!m) continue
    const depth = (m[1] as string).length
    while (stack.length > 0 && (stack.at(-1) as { depth: number }).depth >= depth) stack.pop()
    out.push({ name: m[2] as string, kind: m[3] as string, line: Number(m[4]), path: stack.map(s => s.name) })
    stack.push({ depth, name: m[2] as string })
  }
  return out
}

/** A caller's qualified name from its file's outline: `Class.method`, `outer.inner`; its plain name when not found. */
export function qualified(outline: ReturnType<typeof parseOutline>, name: string, line: number): string {
  const hit = outline.find(s => s.name === name && s.line === line)
  return hit ? [...hit.path, name].join('.') : name
}

const MAX_CHARS = 1600

/**
 * The note: the server's callers (qualified, with their call lines) or references, by file,
 * compact and capped. It says what it covers, so grep's output keeps its part.
 */
export function answerNote(
  name: string,
  found: { callers: Array<Caller & { qualified: string }> } | { references: Array<{ file: string; line: number }> },
): string {
  const rows: string[] = []
  let head: string
  if ('callers' in found) {
    const files = [...new Set(found.callers.map(c => c.file))]
    head = `\`${name}\` per the language server: called from ${found.callers.length} function${found.callers.length === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'}`
    for (const f of files) {
      const here = found.callers.filter(c => c.file === f).map(c => `${c.qualified} (${c.at.join(', ')})`)
      rows.push(`${f}: ${here.join(', ')}`)
    }
  } else {
    const files = [...new Set(found.references.map(r => r.file))]
    head = `\`${name}\` per the language server: ${found.references.length} reference${found.references.length === 1 ? '' : 's'} in code, in ${files.length} file${files.length === 1 ? '' : 's'}`
    for (const f of files) rows.push(`${f}: ${found.references.filter(r => r.file === f).map(r => r.line).join(', ')}`)
  }
  const tail = '(code only: strings, comments, docs and namesakes are in the grep above)'
  let body = ''
  let shown = 0
  for (const row of rows) {
    if (body.length + row.length > MAX_CHARS) break
    body += `\n${row}`
    shown++
  }
  const more = shown < rows.length ? `\n… and ${rows.length - shown} more files` : ''
  return `${head} ${tail}:${body}${more}`
}

/** Whether an answer looks like a server still indexing: it knows only the file it was asked about. */
export function looksCold(files: readonly string[], grepFiles: readonly string[], asked: string): boolean {
  const others = grepFiles.filter(f => f !== asked)
  return others.length > 0 && files.every(f => f === asked)
}
