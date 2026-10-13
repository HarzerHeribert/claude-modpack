// Cells that do not parse: what can be said about them deterministically, and
// a repair for the one slip that has a single reading. Nothing here runs a
// program; the runner checks that a repair parses, and the model decides
// whether to run it. Pure; shared by the runner, the mod and the tests.

/**
 * Where code holds an escape that is only valid inside a template literal
 * (`` \` `` or `\${`) outside of any string, template, comment or regular
 * expression: the sign of code escaped for a template it is not in. -1 if
 * there is none.
 */
export function strayEscapeAt(code) {
  const stack = [] // 'tpl' inside a template's text, 'expr' inside its ${…}, 'brace' inside other braces
  let prev = '' // the last significant character, to tell a regular expression from a division
  let i = 0
  while (i < code.length) {
    const c = code[i]
    const n = code[i + 1]
    if (stack.at(-1) === 'tpl') {
      if (c === '\\') i += 2
      else if (c === '`') {
        stack.pop()
        prev = '`'
        i++
      } else if (c === '$' && n === '{') {
        stack.push('expr')
        i += 2
      } else i++
      continue
    }
    if (c === '\\' && (n === '`' || (n === '$' && code[i + 2] === '{'))) return i
    if (c === '/' && n === '/') {
      const end = code.indexOf('\n', i)
      i = end < 0 ? code.length : end
      continue
    }
    if (c === '/' && n === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end < 0 ? code.length : end + 2
      continue
    }
    if (c === '"' || c === "'") {
      i++
      while (i < code.length && code[i] !== c && code[i] !== '\n') i += code[i] === '\\' ? 2 : 1
      i++
      prev = 'a'
      continue
    }
    if (c === '/' && !/[\w$)\]}`'"]/.test(prev)) {
      // A regular expression: up to the closing slash outside a class, then its flags.
      let inClass = false
      i++
      while (i < code.length && code[i] !== '\n') {
        if (code[i] === '\\') i += 2
        else if (code[i] === '[') (inClass = true), i++
        else if (code[i] === ']') (inClass = false), i++
        else if (code[i] === '/' && !inClass) break
        else i++
      }
      i++
      while (/[a-z]/.test(code[i] ?? '')) i++
      prev = 'a'
      continue
    }
    if (c === '`') stack.push('tpl')
    else if (c === '{') stack.push('brace')
    else if (c === '}') stack.pop()
    if (!/\s/.test(c)) prev = c
    i++
  }
  return -1
}

/** Escapes that mean the same written once as written twice: kept as escapes, so no line moves. */
const KEPT = new Set(['n', 'r', 't', 'b', 'f', 'v', '0', 'u', 'x'])

/**
 * A template literal written as if inside another one, read the way that
 * outer template would have read it: from the stray `` \` `` at `start` to its
 * closing `` \` ``, one level of escaping comes off (`` \` `` → `` ` ``,
 * `\${` → `${`, `\\` → `\`); `\n` and its kind stay escapes, so no line moves.
 * Undefined when it never closes.
 */
function unescapeRegion(code, start) {
  let out = '`'
  let escaped = false // the last character of the read text was a lone backslash
  let i = start + 2
  while (i < code.length) {
    let ch
    if (code[i] === '\\' && i + 1 < code.length) {
      const next = code[i + 1]
      i += 2
      if (KEPT.has(next)) {
        out += `\\${next}`
        escaped = false
        continue
      }
      ch = next
    } else {
      ch = code[i]
      i++
    }
    if (ch === '`' && !escaped) return { text: `${out}\``, end: i }
    out += ch
    escaped = ch === '\\' && !escaped
  }
  return undefined
}

/**
 * Every template the code escaped as if it sat inside another one, with one
 * level of escaping taken off; the 1-based lines each began on. Undefined
 * when there is none, or one that never closes.
 */
export function unescapeTemplates(code) {
  let text = code
  const lines = []
  for (let round = 0; round < 20; round++) {
    const at = strayEscapeAt(text)
    if (at < 0) break
    if (text[at + 1] !== '`') return undefined
    const region = unescapeRegion(text, at)
    if (region === undefined) return undefined
    lines.push(text.slice(0, at).split('\n').length)
    text = text.slice(0, at) + region.text + text.slice(region.end)
  }
  return lines.length > 0 ? { code: text, lines } : undefined
}

/** Exact replacements in a program, each of whose old text occurs once, as the Edit tool takes them. */
export function applyFixes(code, fixes) {
  let text = code
  for (const [k, f] of fixes.entries()) {
    const old = String(f?.old ?? '')
    const count = old === '' ? 0 : text.split(old).length - 1
    if (count !== 1) return { error: `fix ${k + 1}: its old text occurs ${count} times in the program; it must occur once` }
    text = text.replace(old, () => String(f.new ?? ''))
  }
  return { code: text }
}

/** Where a program failed to parse, as the model reads it: the message, the line and a caret. */
export function describeSyntax(message, code, line, caret) {
  const shown = line !== undefined ? code.split('\n')[line - 1] : undefined
  const at = line !== undefined ? ` (line ${line})` : ''
  const frame = shown === undefined ? '' : `\n  ${shown.length > 200 ? `${shown.slice(0, 199)}…` : shown}${caret ? `\n  ${caret}` : ''}`
  return `SyntaxError: ${message}${at}; nothing ran.${frame}`
}
