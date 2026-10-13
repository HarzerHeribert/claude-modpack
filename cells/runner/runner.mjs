// Runs one cell: JavaScript the model wrote, in a vm context whose only way to
// act on anything is to ask the host (the cells mod) for a Claude Code tool
// call. Started under `node --permission` inside a Seatbelt profile, so even
// code that escapes the vm can't write, spawn, signal or reach the network.
//
// The cell's functions are built inside its own realm and reach the host only
// through closures that pass strings, so no host object (and with it the
// host's Function constructor) is reachable from the cell.
//
// stdin:  { code, handles, dir, id }
// stdout: one `\u0001cell {json}` line per message:
//         { need: { n, tool, input } }  a tool call; the reply is read from <dir>/<id>.<n>.json
//         { done: { output, log, previews, handles, dropped, error } }

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { stripTypeScriptTypes } from 'node:module'

import { cut, fold } from './fold.mjs'
import { anchorIn, isName, parseMentions, planRename } from './lsp.mjs'
import { describeSyntax, unescapeTemplates } from './repair.mjs'

const MARK = '\u0001cell '
const OUTPUT_ROOM = 12_000
const LOG_ROOM = 4_000
const PREVIEW_ROOM = 160
const TABLE_ROOM = 2_400
const HANDLES_MAX = 8_000_000

const input = JSON.parse(fs.readFileSync(0, 'utf8'))
const send = msg => process.stdout.write(MARK + JSON.stringify(msg) + '\n')

let asked = 0

/** Asks the host for one tool call; answers the cell's callback with the reply's JSON text. */
function hostAsk(tool, inputJson, resolve) {
  const n = ++asked
  send({ need: { n, tool, input: JSON.parse(String(inputJson)) } })
  const file = path.join(input.dir, `${input.id}.${n}.json`)
  const poll = () => {
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
      JSON.parse(text)
    } catch {
      text = ''
    }
    if (text) resolve(text)
    else setTimeout(poll, 4)
  }
  poll()
}

const hostFold = (text, above) => fold(String(text), Number(above) || 0)
const hostCut = (text, room) => cut(String(text), Number(room) || 3000)
// The language-server helpers' pure parts, run here; strings in, JSON text out.
const hostLsp = (what, a, b, c, d) => {
  if (what === 'name') return JSON.stringify(isName(a))
  if (what === 'anchor') return JSON.stringify(anchorIn(String(a), String(b), Number(c) || 0) ?? null)
  if (what === 'plan') return JSON.stringify(planRename(String(a), JSON.parse(String(b)), String(c), String(d)))
  if (what === 'mentions') return JSON.stringify(parseMentions(String(a)))
  return 'null'
}

// Evaluated inside the cell's realm: every object the cell can touch is its own.
const PRELUDE = `(function (hostAsk, hostFold, hostCut, hostLsp, handlesJson) {
  'use strict'
  class CellError extends Error {
    constructor(message) { super(message); this.name = 'CellError' }
  }
  const call = (tool, args) =>
    new Promise(resolve => hostAsk(tool, JSON.stringify(args), resolve)).then(text => JSON.parse(text))
  const refused = (what, r) => new CellError(what + ' was refused: ' + r.denied)
  const logs = []
  const show = v => { try { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) } catch { return String(v) } }
  const log = (...values) => { logs.push(values.map(show).join(' ')) }

  globalThis.sh = async function sh(command, opts = {}) {
    if (typeof command !== 'string') throw new CellError('sh(command): command must be a string')
    const r = await call('Bash', { command, timeout: opts.timeout })
    if (r.denied) throw refused('sh ' + command, r)
    const res = { ok: r.ok, out: r.out ?? '', err: r.err ?? '', code: r.code ?? (r.ok ? 0 : 1) }
    if (opts.check && !res.ok) {
      throw new CellError('sh failed (exit ' + res.code + '): ' + command + '\\n' + hostCut(hostFold(res.out + res.err, 0), 3000))
    }
    return res
  }
  const readPart = async (file, opts) => {
    const r = await call('Read', { file_path: file, offset: opts.offset, limit: opts.limit })
    if (r.denied) throw refused('read ' + file, r)
    if (!r.ok) throw new CellError('read ' + file + ': ' + r.text)
    return r
  }
  globalThis.read = async function read(file, opts = {}) {
    return (await readPart(file, opts)).content
  }
  // A whole file's text through Read, page by page past Read's own limits;
  // kept for the cell until it edits or writes the file.
  const texts = new Map()
  const readAll = async file => {
    if (texts.has(file)) return texts.get(file)
    const parts = []
    let r = await readPart(file, {})
    parts.push(r.content)
    let next = (r.start ?? 1) + (r.num ?? 0)
    while (r.total !== undefined && r.num > 0 && next <= r.total) {
      r = await readPart(file, { offset: next, limit: 2000 })
      parts.push(r.content)
      next = (r.start ?? next) + (r.num ?? 0)
    }
    const text = parts.join('\\n')
    texts.set(file, text)
    return text
  }
  globalThis.edit = async function edit(file, oldText, newText, opts = {}) {
    texts.delete(file)
    const r = await call('Edit', { file_path: file, old_string: oldText, new_string: newText, replace_all: !!opts.all })
    if (r.denied) throw refused('edit ' + file, r)
    if (!r.ok) throw new CellError('edit ' + file + ': ' + r.text)
  }
  globalThis.write = async function write(file, text) {
    texts.delete(file)
    const r = await call('Write', { file_path: file, content: String(text) })
    if (r.denied) throw refused('write ' + file, r)
    if (!r.ok) throw new CellError('write ' + file + ': ' + r.text)
  }

  const lsp = (what, a, b, c, d) => JSON.parse(hostLsp(what, a, b, c, d))
  const needName = (fn, name) => {
    if (!lsp('name', name)) throw new CellError(fn + ': ' + JSON.stringify(name) + ' is not a name')
  }
  // Asks the language server about the name as it stands in the file, and
  // gives each place it lists with its line.
  const locate = async (fn, operation, file, name, opts = {}) => {
    needName(fn, name)
    const text = await readAll(file)
    const at = lsp('anchor', text, name, opts.line ?? 0)
    if (!at) throw new CellError(fn + ': ' + name + ' is not in ' + file + (opts.line ? ' on line ' + opts.line : ''))
    const r = await call('LSP', { operation, filePath: file, line: at.line, character: at.col, name })
    if (r.denied) throw refused(fn + ' ' + file, r)
    if (!r.ok) throw new CellError(fn + ' ' + file + ': ' + r.text)
    const files = [...new Set(r.places.map(p => p.file))]
    const lines = new Map(await Promise.all(files.map(async f => [f, (await readAll(f)).split('\\n')])))
    return r.places.map(p => ({ file: p.file, line: p.line, col: p.col, text: (lines.get(p.file)[p.line - 1] ?? '').trim().slice(0, 200) }))
  }
  globalThis.refs = (file, name, opts) => locate('refs', 'findReferences', file, name, opts)
  globalThis.defn = (file, name, opts) => locate('defn', 'goToDefinition', file, name, opts)
  globalThis.rename = async function rename(file, name, newName, opts = {}) {
    needName('rename', name)
    needName('rename', newName)
    if (name === newName) throw new CellError('rename: the new name is the old one')
    const places = await refs(file, name, opts)
    if (places.length === 0) throw new CellError('rename: the language server lists no references of ' + name + ' in ' + file)
    const byFile = new Map()
    for (const p of places) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p])
    const files = []
    const skipped = []
    const failed = []
    let changed = 0
    for (const [f, list] of byFile) {
      if (f.startsWith('/') || f.startsWith('../')) {
        for (const p of list) skipped.push({ file: f, line: p.line, why: 'outside the project' })
        continue
      }
      const plan = lsp('plan', await readAll(f), JSON.stringify(list), name, newName)
      for (const s of plan.skipped) skipped.push({ file: f, line: s.line, why: 'the name is not there', text: s.text })
      for (const s of plan.ambiguous) skipped.push({ file: f, line: s.line, why: 'no unique text to edit', text: s.text })
      try {
        for (const e of plan.edits) await edit(f, e.old, e.new)
        changed += plan.changed
        files.push({ file: f, changed: plan.changed })
      } catch (err) {
        failed.push({ file: f, error: String(err && err.message || err) })
      }
    }
    const grep = await sh('if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git grep -n -I -w -F -e \\'' + name +
      '\\'; else grep -rnIwF --exclude-dir=.git --exclude-dir=node_modules -e \\'' + name + '\\' .; fi')
    const left = lsp('mentions', grep.out)
    return { changed, files, skipped, failed, left: left.places, leftCount: left.count }
  }

  globalThis.fold = text => hostFold(text, 0)
  globalThis.log = log
  globalThis.console = { log, error: log, warn: log, info: log }
  globalThis.h = JSON.parse(handlesJson)
  return logs
})`

// The value a cell returns, as the model will read it.
function render(value) {
  if (value === undefined) return ''
  if (typeof value === 'string') return cut(fold(value), OUTPUT_ROOM, ' — keep the full value in h to read more')
  if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
    const share = Math.max(600, Math.floor(OUTPUT_ROOM / Math.max(1, value.length)))
    return value.map((v, i) => `### [${i}]\n${cut(fold(v), share)}`).join('\n')
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value)
    if (entries.length > 0 && entries.every(([, v]) => typeof v === 'string')) {
      const share = Math.max(600, Math.floor(OUTPUT_ROOM / entries.length))
      return entries.map(([k, v]) => `### ${k}\n${cut(fold(v), share)}`).join('\n')
    }
  }
  return cut(show(value), OUTPUT_ROOM)
}

function show(value) {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

// One line per handle: its shape and a bounded glimpse, never the whole value.
function preview(value) {
  const glimpse = s => JSON.stringify(s.length > PREVIEW_ROOM ? `${s.slice(0, PREVIEW_ROOM)}…` : s)
  if (typeof value === 'string') return `string len=${value.length}  ${glimpse(value)}`
  if (Array.isArray(value)) {
    const item = v => glimpse(typeof v === 'string' ? v : show(v))
    const shown = value.length <= 3 ? value.map(item) : [item(value[0]), item(value[1]), '…', item(value.at(-1))]
    return `array n=${value.length}  [${shown.join(', ')}]`
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    const typed = keys.slice(0, 12).map(k => `${k}: ${Array.isArray(value[k]) ? 'array' : typeof value[k]}`)
    return `object {${typed.join(', ')}${keys.length > 12 ? `, … +${keys.length - 12}` : ''}}`
  }
  return String(value)
}

function table(h) {
  let out = ''
  const keys = Object.keys(h)
  for (const k of keys) {
    if (typeof h[k] === 'function') continue
    const line = `h.${k}  ${preview(h[k])}\n`
    if (out.length + line.length > TABLE_ROOM) {
      out += `… ${keys.length} handles in all; list them with Object.keys(h)\n`
      break
    }
    out += line
  }
  return out.trimEnd()
}

function keep(h) {
  const json = v => JSON.stringify(v, (k, x) => (typeof x === 'function' ? undefined : x)) ?? '{}'
  let text = json(h)
  if (text.length <= HANDLES_MAX) return { text, dropped: [] }
  const sized = Object.keys(h)
    .map(k => [k, json(h[k]).length])
    .sort((a, b) => b[1] - a[1])
  const copy = { ...h }
  const dropped = []
  for (const [k] of sized) {
    delete copy[k]
    dropped.push(k)
    text = json(copy)
    if (text.length <= HANDLES_MAX) break
  }
  return { text, dropped }
}

function describe(error) {
  if (!error || typeof error !== 'object' || !('message' in error)) return `thrown: ${cut(show(error), 600)}`
  const where = /cell\.js:(\d+):(\d+)/.exec(String(error.stack ?? ''))
  const at = where ? ` (line ${where[1]}, column ${where[2]})` : ''
  return `${error.name ?? 'Error'}: ${cut(String(error.message), 1500)}${at}`
}

/** The cell's program, ready to run: its types stripped, wrapped so it can await. Throws { v8, strip } when it does not parse. */
function compile(code) {
  const wrapped = `(async () => {\n${code}\n})()`
  let source = wrapped
  let strip
  try {
    source = stripTypeScriptTypes(wrapped, { mode: 'strip' })
  } catch (e) {
    // Not valid TypeScript: V8 parses it as written, and the stripper's error says where it broke.
    strip = e
  }
  try {
    return new vm.Script(source, { filename: 'cell.js', lineOffset: -1 })
  } catch (v8) {
    throw { v8, strip }
  }
}

function parses(code) {
  try {
    compile(code)
    return true
  } catch {
    return false
  }
}

/** Where the program failed to parse: the stripper's line when it failed first (a type left in would mislead V8), else V8's line and caret. */
function syntaxReport(failure, code) {
  if (failure.strip) {
    const at = /:(\d+)\n/.exec(String(failure.strip.stack ?? ''))
    return describeSyntax(String(failure.strip.message), code, at ? Number(at[1]) - 1 : undefined)
  }
  const at = /^cell\.js:(\d+)\n.*\n( *\^+)/.exec(String(failure.v8?.stack ?? ''))
  return describeSyntax(String(failure.v8?.message ?? failure), code, at ? Number(at[1]) : undefined, at?.[2])
}

/** The lines a repair changed, as - and + pairs, six pairs at most. */
function changes(before, after) {
  const a = before.split('\n')
  const b = after.split('\n')
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length) && out.length < 12; i++) {
    if (a[i] !== b[i]) out.push(`  - ${cut(a[i] ?? '', 300)}`, `  + ${cut(b[i] ?? '', 300)}`)
  }
  return out.join('\n')
}

async function main() {
  const code = String(input.code ?? '')
  let script
  try {
    script = compile(code)
  } catch (failure) {
    // Nothing ran. A template escaped as if it sat inside another one has a
    // single reading: it is offered with what it changes, never run unasked.
    const fixed = unescapeTemplates(code)
    const repaired = fixed !== undefined && parses(fixed.code) ? fixed : undefined
    send({
      done: {
        output: '',
        log: '',
        previews: '',
        handles: String(input.handles || '{}'),
        dropped: [],
        error: syntaxReport(failure, code),
        unparsed: true,
        ...(repaired ? { repaired: repaired.code, repairedLines: repaired.lines, repairPreview: changes(code, repaired.code) } : {}),
      },
    })
    return
  }

  // A global with no prototype: a lookup it misses reaches the cell realm's
  // own builtins, never the host's.
  const context = vm.createContext(Object.create(null), {
    name: 'cell',
    codeGeneration: { strings: false, wasm: false },
  })
  const install = new vm.Script(PRELUDE, { filename: 'prelude.js' }).runInContext(context)
  const logs = install(hostAsk, hostFold, hostCut, hostLsp, String(input.handles || '{}'))

  let value
  let error
  try {
    value = await script.runInContext(context)
  } catch (e) {
    error = e
  }

  const h = context.h && typeof context.h === 'object' ? context.h : {}
  const kept = keep(h)
  send({
    done: {
      output: error ? '' : render(value),
      log: cut(logs.join('\n'), LOG_ROOM),
      previews: table(h),
      handles: kept.text,
      dropped: kept.dropped,
      error: error ? describe(error) : undefined,
    },
  })
}

main().catch(e => {
  send({ done: { output: '', log: '', previews: '', handles: String(input.handles || '{}'), dropped: [], error: `runner failed: ${e}` } })
})
