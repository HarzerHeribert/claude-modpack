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

export const register: Register = (on, options) => {
  docs = options.docs !== false
  drift = options.drift !== false
  nudging = options.nudge !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'refs', description: 'Check the docs for code names and links that no longer resolve' })
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
    const text = await symbolNote($, e.command, r)
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
