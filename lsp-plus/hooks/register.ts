import type { EngineInterface, Register } from 'claude-code'

import {
  DOC_GLOBS,
  codeSpanNames,
  driftNote,
  editedNames,
  fencedLines,
  identifierAt,
  isDoc,
  listPlaces,
  mentionsAsCode,
  parseGrep,
  referencesNote,
} from './docs'
import type { Mention } from './docs'
import { LSP_FILES, codeHits, definitionAt, nudge, symbolSearch, usesAsCode } from './nudge'
import type { SymbolSearch } from './nudge'
import { answerNote, looksCold, parseIncoming, parseOutline, parseReferences, qualified } from './answer'

type Engine = EngineInterface
type LspInput = { operation?: string; filePath?: string; line?: number; character?: number }

// The LSP calls whose answer is about one name, and where the docs' mentions belong.
const NAMED_OPS = new Set(['findReferences', 'goToDefinition', 'incomingCalls'])
// The cells mod's tool: where it is loaded, the notes name its one-step calls.
const CELLS_TOOL = 'mcp__cells__run_cell'
const NOT_DOCS = DOC_GLOBS.map(g => `:(exclude)${g}`)
const MAX_DOC_FILES = 20
const MAX_REMOVED = 6

let docs = true
let drift = true
let nudging = true
let answering = false
let warming = false
// Symbols already nudged about this session: the next note is one line.
const nudged = new Set<string>()
// Names already reported as drifted this session: each is said once.
const told = new Set<string>()

const join = (cwd: string, path: string) => (path.startsWith('/') ? path : `${cwd}/${path}`)

/** `git` in the session's folder; undefined where git fails (no repository). `git grep` exits 1 on no match. */
async function git($: Engine, cwd: string, args: string[]): Promise<string | undefined> {
  const r = await $.process.run(['git', ...args], { cwd, timeoutMs: 8000 }).catch(() => undefined)
  return r !== undefined && (r.exitCode === 0 || r.exitCode === 1) ? r.stdout : undefined
}

/** The doc lines that mention `name` as code. */
async function docMentions($: Engine, cwd: string, name: string): Promise<Mention[]> {
  const out = await git($, cwd, ['grep', '--untracked', '-n', '-I', '-w', '-F', '-e', name, '--', ...DOC_GLOBS])
  if (!out) return []
  const hits = parseGrep(out)
  const files = [...new Set(hits.map(h => h.path))].slice(0, MAX_DOC_FILES)
  const found: Mention[] = []
  for (const path of files) {
    const text = await $.fs.read(join(cwd, path)).catch(() => '')
    const fenced = fencedLines(text)
    for (const h of hits) if (h.path === path && mentionsAsCode(h.text, name, fenced.has(h.line))) found.push(h)
  }
  return found
}

/** Whether any file but the docs still names `name`. */
async function codeUses($: Engine, cwd: string, name: string): Promise<boolean> {
  const out = await git($, cwd, ['grep', '--untracked', '-l', '-I', '-w', '-F', '-e', name, '--', '.', ...NOT_DOCS])
  return out === undefined || out.trim() !== ''
}

/** A note for each name an edit removed from the code that the docs still mention. */
async function driftNotes($: Engine, cwd: string, before: string, after: string): Promise<string[]> {
  const { removed, added } = editedNames(before, after)
  const notes: string[] = []
  for (const name of removed.slice(0, MAX_REMOVED)) {
    if (told.has(name) || (await codeUses($, cwd, name))) continue
    const found = await docMentions($, cwd, name)
    if (found.length === 0) continue
    told.add(name)
    notes.push(driftNote(name, found, removed.length === 1 && added.length === 1 ? added[0] : undefined))
  }
  return notes
}

/** /refs: every code reference in the docs that no longer resolves. */
async function checkDocs($: Engine, cwd: string): Promise<string> {
  const listed = await git($, cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...DOC_GLOBS])
  if (listed === undefined) return 'No git repository here, so there are no docs to check.'
  const files = [...new Set(listed.split('\n').filter(Boolean))].slice(0, 300)
  const byName = new Map<string, Mention[]>()
  const badPaths: Mention[] = []
  for (const path of files) {
    const text = await $.fs.read(join(cwd, path)).catch(() => '')
    for (const { name, line } of codeSpanNames(text)) {
      const list = byName.get(name) ?? []
      list.push({ path, line, text: '' })
      byName.set(name, list)
    }
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    for (const [i, row] of text.split('\n').entries()) {
      for (const m of row.matchAll(/\]\(((?!https?:|mailto:|#)[^)\s#]+)(?:#[^)]*)?\)/g)) {
        const target = m[1] as string
        const there = await $.fs.exists(join(cwd, target.startsWith('/') ? target.slice(1) : dir + target)).catch(() => true)
        if (!there) badPaths.push({ path, line: i + 1, text: target })
      }
    }
  }
  const names = [...byName.keys()]
  const known = new Set<string>()
  for (let i = 0; i < names.length; i += 100) {
    const chunk = names.slice(i, i + 100)
    const out = await git($, cwd, ['grep', '--untracked', '-o', '-h', '-I', '-w', '-F', ...chunk.flatMap(n => ['-e', n]), '--', '.', ...NOT_DOCS])
    for (const hit of (out ?? '').split('\n')) if (hit) known.add(hit)
  }
  const stale = names.filter(n => !known.has(n))
  const refs = [...byName.values()].reduce((n, l) => n + l.length, 0)
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const docs = count(files.length, 'doc', 'docs')
  if (stale.length === 0 && badPaths.length === 0) return `All ${count(refs, 'code reference', 'code references')} in ${docs} resolve.`
  const parts = [
    `${docs}, ${count(refs, 'code reference', 'code references')}: ${count(stale.length, 'name', 'names')} no file in the code has, ${count(badPaths.length, 'link', 'links')} to files that do not exist.`,
  ]
  if (stale.length > 0) parts.push('', 'Names:', ...stale.slice(0, 40).map(n => `  \`${n}\`  ${listPlaces(byName.get(n) ?? [], 4)}`))
  if (badPaths.length > 0) parts.push('', 'Links:', ...badPaths.slice(0, 40).map(b => `  ${b.text}  ${b.path}:${b.line}`))
  return parts.join('\n')
}

/**
 * The note on a grep for a code symbol: which LSP call answers it exactly, and,
 * with the cells mod loaded, the call in run_cell that needs no LSP tool loaded.
 */
async function symbolNote($: Engine, command: string, r: { deny?: string; text?: string }): Promise<string | undefined> {
  const search = nudging && r.deny === undefined ? symbolSearch(command) : undefined
  const out = r.text ?? ''
  if (search === undefined) return undefined
  const hits = codeHits(out)
  if (hits.length === 0 && !out.split('\n').some(l => LSP_FILES.test(l.split(':')[0] ?? ''))) return undefined
  if (hits.length > 0 && !hits.some(h => usesAsCode(h.text, search.name))) return undefined
  const again = nudged.has(search.name)
  nudged.add(search.name)
  const cells = (await $.tool.list().catch(() => [])).some(t => t.name === CELLS_TOOL) ? { file: hits[0]?.path } : undefined
  return nudge(search, definitionAt(hits, search.name), again, cells)
}

/** One LSP call; its text, or undefined where the server failed, is missing or was refused. */
async function lsp($: Engine, input: Record<string, unknown>): Promise<string | undefined> {
  const r = await $.tool.call({ tool: 'LSP', ...input } as never).catch(() => undefined)
  if (r === undefined || r.deny !== undefined || r.isError) return undefined
  const text = r.text ?? ''
  return /^(Error performing|No LSP server)/.test(text) ? undefined : text
}

/** Where `name` is defined: from the grep's own hits, else the one symbol of that name the server knows. */
async function definitionOf($: Engine, cwd: string, name: string, hits: ReturnType<typeof codeHits>): Promise<{ path: string; line: number; character: number; text: string } | undefined> {
  const at = definitionAt(hits, name)
  if (at) return { ...at, text: hits.find(h => h.path === at.path && h.line === at.line)?.text ?? '' }
  const any = hits[0]
  if (!any) return undefined
  const listed = await lsp($, { operation: 'workspaceSymbol', filePath: join(cwd, any.path), line: 1, character: 1, query: name })
  if (!listed) return undefined
  const exact: Array<{ file: string; kind: string; line: number }> = []
  let file = ''
  for (const row of listed.split('\n')) {
    const header = /^(\S.*):$/.exec(row)
    if (header && !row.startsWith('Found')) file = header[1] as string
    const m = /^\s+(\S+) \((\w+)\) - Line (\d+)/.exec(row)
    if (m && m[1] === name && file) exact.push({ file, kind: m[2] as string, line: Number(m[3]) })
  }
  const named = exact.filter(s => !/^(Variable|Constant|Field|Property)$/.test(s.kind))
  const one = named.length === 1 ? named[0] : exact.length === 1 ? exact[0] : undefined
  if (!one) return undefined
  const text = ((await $.fs.read(join(cwd, one.file)).catch(() => '')) ?? '').split('\n')[one.line - 1] ?? ''
  const col = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).exec(text)
  if (!col) return undefined
  return { path: one.file, line: one.line, character: col.index + (col[1] ?? '').length + 1, text }
}

/**
 * The language server's answer to a symbol grep, read by the hook: for a function, who calls
 * it (qualified by each caller's file outline); otherwise its references. A server still
 * indexing knows only the file it was asked about: asked again for up to three seconds, and
 * without a whole answer there is no note, never a partial one.
 */
async function symbolAnswer($: Engine, search: SymbolSearch, out: string): Promise<string | undefined> {
  const hits = codeHits(out)
  const uses = hits.filter(h => usesAsCode(h.text, search.name))
  if (uses.length === 0) return undefined
  const cwd = await $.session.cwd()
  const def = await definitionOf($, cwd, search.name, hits)
  if (!def) return undefined
  const callable = /\b(def|function|fn|func)\s/.test(def.text) || /\b(async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*[:{]/.test(def.text)
  const operation = callable ? 'incomingCalls' : 'findReferences'
  const grepFiles = [...new Set(uses.map(h => h.path))]
  const ask = () => lsp($, { operation, filePath: join(cwd, def.path), line: def.line, character: def.character })
  let text = await ask()
  const filesOf = (t: string) => (callable ? parseIncoming(t).map(c => c.file) : parseReferences(t).map(r => r.file))
  for (let tries = 0; text !== undefined && looksCold(filesOf(text), grepFiles, def.path) && tries < 2; tries++) {
    await $.process.run(['sleep', '1.5'])
    text = await ask()
  }
  if (text === undefined || looksCold(filesOf(text), grepFiles, def.path)) return undefined
  if (!callable) {
    const references = parseReferences(text)
    return references.length === 0 ? undefined : answerNote(search.name, { references })
  }
  const callers = parseIncoming(text)
  if (callers.length === 0) return undefined
  const outlines = new Map<string, ReturnType<typeof parseOutline>>()
  await Promise.all(
    [...new Set(callers.map(c => c.file))].map(async f => {
      const o = await lsp($, { operation: 'documentSymbol', filePath: join(cwd, f), line: 1, character: 1 })
      outlines.set(f, o ? parseOutline(o) : [])
    }),
  )
  return answerNote(search.name, { callers: callers.map(c => ({ ...c, qualified: qualified(outlines.get(c.file) ?? [], c.name, c.line) })) })
}

/**
 * Starts the language servers the repository will need, before anyone asks: one question about
 * one tracked file of each kind a server reads. A server opens the project on its first
 * question and answers whole from the second on.
 */
async function warmUp($: Engine) {
  const cwd = await $.session.cwd()
  const listed = await git($, cwd, ['ls-files'])
  if (!listed) return
  const first = new Map<string, string>()
  for (const f of listed.split('\n')) {
    const ext = /\.([^./]+)$/.exec(f)?.[1]
    if (!ext || !LSP_FILES.test(f) || /(^|\/)(node_modules|vendor|dist|build)\//.test(f)) continue
    const kind = /^(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(ext) ? 'ts' : ext
    if (!first.has(kind)) first.set(kind, f)
  }
  await Promise.all([...first.values()].map(f => lsp($, { operation: 'documentSymbol', filePath: join(cwd, f), line: 1, character: 1 })))
}

export const register: Register = (on, options) => {
  docs = options.docs !== false
  drift = options.drift !== false
  nudging = options.nudge === true // off unless asked for: never acted on in 45 benchmark notes
  answering = options.answer !== false // measured: 25% fewer requests on a rename, even on a trace
  warming = options.warm !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'refs', description: 'Check the docs for code names and links that no longer resolve' })
    if (warming) void warmUp($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'refs' }, async $ => ({ text: await checkDocs($, await $.session.cwd()) }))

  // References and definitions name places in the code; the docs that use the name join them.
  on('tool.call', { tool: 'LSP' }, async ($, e, next) => {
    const r = await next(e)
    const input = e as unknown as LspInput
    if (!docs || r.deny !== undefined || r.isError || !NAMED_OPS.has(input.operation ?? '')) return r
    // The LSP tool reports a server that failed or is missing as a plain result.
    if (/^(Error performing|No LSP server)/.test(r.text ?? '')) return r
    if (typeof input.filePath !== 'string' || typeof input.line !== 'number' || typeof input.character !== 'number') return r
    const cwd = await $.session.cwd()
    const source = await $.fs.read(join(cwd, input.filePath)).catch(() => undefined)
    const name = source === undefined ? undefined : identifierAt(source.split('\n')[input.line - 1] ?? '', input.character)
    if (name === undefined || name.length < 3) return r
    const found = await docMentions($, cwd, name)
    if (found.length === 0) return r
    return { ...r, context: [...(r.context ?? []), referencesNote(name, found)] }
  }).catch(($, e, next) => next(e))

  // A grep for a code symbol runs as asked; the note says which LSP call answers it exactly.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    const search = answering ? symbolSearch(e.command) : undefined
    const answer = search === undefined ? undefined : await symbolAnswer($, search, r.text ?? '').catch(() => undefined)
    const text = answer ?? (await symbolNote($, e.command, r))
    return text === undefined ? r : { ...r, context: [...(r.context ?? []), text] }
  }).catch(($, e, next) => next(e))

  // While code is being written: a name the edit took away that the docs still use.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e)
    const input = e as unknown as { file_path?: string; old_string?: string; new_string?: string }
    if (!drift || r.deny !== undefined || r.isError || typeof input.file_path !== 'string' || isDoc(input.file_path)) return r
    const notes = await driftNotes($, await $.session.cwd(), input.old_string ?? '', input.new_string ?? '')
    return notes.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...notes] }
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const input = e as unknown as { file_path?: string; content?: string }
    const path = typeof input.file_path === 'string' && !isDoc(input.file_path) ? input.file_path : undefined
    const before = drift && path !== undefined ? await $.fs.read(path).catch(() => undefined) : undefined
    const r = await next(e)
    if (before === undefined || r.deny !== undefined || r.isError) return r
    const notes = await driftNotes($, await $.session.cwd(), before, input.content ?? '')
    return notes.length === 0 ? r : { ...r, context: [...(r.context ?? []), ...notes] }
  }).catch(($, e, next) => next(e))
}
