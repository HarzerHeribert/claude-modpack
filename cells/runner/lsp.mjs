// What a cell needs to work with the language server: where to ask about a
// name, the places an answer lists, and a rename planned as exact edits the
// Edit tool can apply. Pure; shared by the runner, the mod and the tests.

const KEYWORDS = 'function|class|interface|type|enum|struct|trait|def|fn|func|const|let|var|val|record|module|namespace'

const IDENT = /^[A-Za-z_$][\w$]*$/

export const isName = name => typeof name === 'string' && IDENT.test(name)

const escape = name => name.replace(/\$/g, '\\$')

/** The 1-based column of `name` as a whole word on one line, or 0. */
function columnOn(text, name) {
  const m = new RegExp(`(^|[^\\w$])${escape(name)}(?![\\w$])`).exec(text)
  return m ? m.index + m[1].length + 1 : 0
}

/**
 * Where to ask the language server about `name` in a file's text: on `line`
 * when given, else where it is defined, else where it first appears. 1-based.
 */
export function anchorIn(text, name, line = 0) {
  const lines = String(text).split('\n')
  if (line > 0) {
    const col = columnOn(lines[line - 1] ?? '', name)
    return col ? { line, col } : undefined
  }
  const def = new RegExp(`\\b(?:${KEYWORDS})\\s+${escape(name)}(?![\\w$])`)
  const at = lines.findIndex(l => def.test(l))
  const first = at >= 0 ? at : lines.findIndex(l => columnOn(l, name) > 0)
  if (first < 0) return undefined
  return { line: first + 1, col: columnOn(lines[first], name) }
}

/**
 * The places an LSP answer lists, whichever way it lists them: a `path:`
 * heading over `Line l:c` rows (references), or `path:l:c` inline
 * (`Defined in src/a.ts:24:17`). Columns are 0 where the answer gives none.
 */
export function parseLocations(text) {
  const found = []
  let file
  for (const row of String(text).split('\n')) {
    const heading = /^\s*((?:\/|\.{1,2}\/)?[\w@.\-/ ]+\.\w+):\s*$/.exec(row)
    if (heading) {
      file = heading[1].trim()
      continue
    }
    const at = /^\s*(?:[-•*]\s*)?Line\s+(\d+)(?::(\d+))?/i.exec(row)
    if (at && file !== undefined) {
      found.push({ file, line: Number(at[1]), col: Number(at[2] ?? 0) })
      continue
    }
    for (const m of row.matchAll(/((?:\/|\.{1,2}\/)?[\w@.\-/]+\.[A-Za-z]\w*):(\d+)(?::(\d+))?/g)) {
      found.push({ file: m[1], line: Number(m[2]), col: Number(m[3] ?? 0) })
    }
  }
  const seen = new Set()
  return found.filter(p => {
    const key = `${p.file}:${p.line}:${p.col}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** How often `part` occurs in `text`, matches not overlapping (as the Edit tool counts). */
function occurrences(text, part) {
  let n = 0
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + part.length)) n++
  return n
}

/** Context lines an edit may grow by to make its text unique in the file. */
const MAX_CONTEXT = 12

/**
 * A rename in one file's text, as exact edits: every place (1-based line and
 * column where `name` starts) becomes `newName`. Places where the text does
 * not hold `name` as a whole word are skipped and said so. Each edit is a
 * run of whole lines, grown by context until it occurs once in the file as
 * it stands when that edit is applied; edits come bottom to top, the order
 * to apply them in.
 */
export function planRename(text, places, name, newName) {
  const lines = String(text).split('\n')
  const skipped = []
  const cols = new Map()
  for (const { line, col } of places) {
    const l = lines[line - 1]
    const ok =
      l !== undefined &&
      col > 0 &&
      l.slice(col - 1, col - 1 + name.length) === name &&
      !/[\w$]/.test(l[col - 2] ?? '') &&
      !/[\w$]/.test(l[col - 1 + name.length] ?? '')
    if (!ok) {
      skipped.push({ line, col, text: (l ?? '').trim().slice(0, 160) })
      continue
    }
    if (!cols.has(line)) cols.set(line, new Set())
    cols.get(line).add(col)
  }

  const renamed = new Map()
  let changed = 0
  for (const [line, set] of cols) {
    let l = lines[line - 1]
    for (const col of [...set].sort((a, b) => b - a)) {
      l = l.slice(0, col - 1) + newName + l.slice(col - 1 + name.length)
      changed++
    }
    renamed.set(line, l)
  }

  const blocks = []
  for (const n of [...renamed.keys()].sort((a, b) => a - b)) {
    const last = blocks.at(-1)
    if (last && n === last.to + 1) last.to = n
    else blocks.push({ from: n, to: n })
  }

  const current = lines.slice()
  const edits = []
  const ambiguous = []
  for (const { from, to } of blocks.reverse()) {
    let a = from
    let b = to
    const old = () => current.slice(a - 1, b).join('\n')
    let grown = 0
    while (occurrences(current.join('\n'), old()) !== 1 && grown < MAX_CONTEXT) {
      if (grown % 2 === 0 && a > 1) a--
      else if (b < current.length) b++
      else if (a > 1) a--
      else break
      grown++
    }
    if (occurrences(current.join('\n'), old()) !== 1) {
      for (let n = from; n <= to; n++) ambiguous.push({ line: n, text: lines[n - 1].trim().slice(0, 160) })
      continue
    }
    const before = old()
    for (let n = from; n <= to; n++) current[n - 1] = renamed.get(n)
    edits.push({ old: before, new: current.slice(a - 1, b).join('\n') })
  }
  return { edits, changed, skipped, ambiguous }
}

/** `path:line:text` rows of a grep, as places; at most `max`, with the count of all. */
export function parseMentions(out, max = 40) {
  const rows = String(out)
    .split('\n')
    .map(r => /^(.+?):(\d+):(.*)$/.exec(r))
    .filter(Boolean)
  return {
    count: rows.length,
    places: rows.slice(0, max).map(m => ({ file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 160) })),
  }
}
