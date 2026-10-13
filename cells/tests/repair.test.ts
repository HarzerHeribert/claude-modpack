import { describe, expect, test } from 'claude-code/testing'

import { report } from '../hooks/bridge'
import { applyFixes, describeSyntax, strayEscapeAt, unescapeTemplates } from '../runner/repair.mjs'

const BS = '\\'
const BT = '`'
// A line written for a template it is not in: \`cd /x/\${d} && grep -E "\\\\(fail\\\\)"\`
const OVER = `const run = d => sh(${BS}${BT}cd /x/${BS}\${d} && grep -E "${BS}${BS}${BS}${BS}(fail${BS}${BS}${BS}${BS})"${BS}${BT})`
const MEANT = `const run = d => sh(${BT}cd /x/\${d} && grep -E "${BS}${BS}(fail${BS}${BS})"${BT})`

describe('escapes that only a template could hold', () => {
  test('found outside strings, templates, comments and regular expressions only', () => {
    expect(strayEscapeAt(OVER)).toBe(OVER.indexOf(BS))
    expect(strayEscapeAt(`const a = ${BT}x ${BS}${BT} y${BT}`)).toBe(-1)
    expect(strayEscapeAt(`const a = 'x ${BS}${BT} y'`)).toBe(-1)
    expect(strayEscapeAt(`// ${BS}${BT}\nconst a = 1`)).toBe(-1)
    expect(strayEscapeAt(`const r = /${BS}${BT}/.test(s)`)).toBe(-1)
    expect(strayEscapeAt(`const a = ${BT}\${f(${BT}inner ${BS}${BT}${BT})}${BT}`)).toBe(-1)
  })

  test('a template escaped one level too deep comes back as meant', () => {
    expect(unescapeTemplates(OVER)).toEqual({ code: MEANT, lines: [1] })
  })

  test('escapes that read the same once or twice stay escapes, so no line moves', () => {
    const r = unescapeTemplates(`sh(${BS}${BT}a${BS}${BS}nb${BS}${BT})\nreturn 1`)
    expect(r?.code).toBe(`sh(${BT}a${BS}nb${BT})\nreturn 1`)
  })

  test('an escaped backtick inside the meant template stays escaped', () => {
    const r = unescapeTemplates(`sh(${BS}${BT}a ${BS}${BS}${BS}${BT} b${BS}${BT})`)
    expect(r?.code).toBe(`sh(${BT}a ${BS}${BT} b${BT})`)
  })

  test('nothing to repair, or no end to the template: no repair', () => {
    expect(unescapeTemplates(`await edit(P, ${BT}a${BT}, ${BT}x ['uses ${BS}${BT}fmt${BS}${BT}${BT}'])${BT})`)).toBeUndefined()
    expect(unescapeTemplates(`sh(${BS}${BT}never closed)`)).toBeUndefined()
  })
})

test('fixes are exact replacements whose old text occurs once', () => {
  expect(applyFixes('a b a', [{ old: 'b', new: 'c' }])).toEqual({ code: 'a c a' })
  expect(applyFixes('a b a', [{ old: 'a', new: 'c' }]).error).toBe('fix 1: its old text occurs 2 times in the program; it must occur once')
  expect(applyFixes('a $& b', [{ old: 'b', new: '$&' }])).toEqual({ code: 'a $& $&' })
})

test('a program that did not parse: where, and what to send instead of it', () => {
  const where = describeSyntax('Invalid or unexpected token', 'const a = 1\nsh(x', 2, '  ^')
  expect(where).toBe('SyntaxError: Invalid or unexpected token (line 2); nothing ran.\n  sh(x\n    ^')
  const done = { output: '', log: '', previews: '', handles: '{}', dropped: [], error: where, unparsed: true }
  expect(report([], done, 10, '').includes('## Fix\nSend run_cell({ fix: [{ old, new }] })')).toBe(true)
  const offered = report([], { ...done, repaired: MEANT, repairedLines: [1], repairPreview: `  - ${OVER}\n  + ${MEANT}` }, 10, '')
  expect(offered.includes('## Repair\nLine 1: a template literal escaped')).toBe(true)
  expect(offered.includes('run_cell({ repair: true })')).toBe(true)
  expect(offered.includes('## Fix')).toBe(false)
  const threwFirst = report([], { output: '', log: '', previews: '', handles: '{}', dropped: [], error: 'ReferenceError: x is not defined (line 1, column 1)' }, 10, '')
  expect(threwFirst.includes('## Fix')).toBe(true)
  const threwLater = report([{ tool: 'Bash', label: 'ls', ok: true, refused: false, ms: 5 }], { output: '', log: '', previews: '', handles: '{}', dropped: [], error: 'Error: late' }, 10, '')
  expect(threwLater.includes('## Fix')).toBe(false)
})
