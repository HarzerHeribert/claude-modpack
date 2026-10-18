import { describe, expect, test } from 'claude-code/testing'

import { gaugeText, limitOf, orderText, sectionsOf, wordsOf } from '../hooks/length'

describe('limitOf', () => {
  test('reads the limits prompts set', () => {
    expect(limitOf('Revise it in place: at most 700 words, keep its structure')).toBe(700)
    expect(limitOf('Use only facts from the sources. At most 900 words.')).toBe(900)
    expect(limitOf('a brief for leadership, under 250 words')).toBe(250)
    expect(limitOf('no more than 1,200 words please')).toBe(1200)
    expect(limitOf('keep it to 300 words or fewer')).toBe(300)
    expect(limitOf('write a 150-word summary')).toBe(150)
    expect(limitOf('cut docs/architecture.md to at most 800 words in place')).toBe(800)
    expect(limitOf('fass das in höchstens 400 Wörtern zusammen')).toBe(400)
    expect(limitOf('maximal 500 Wörter, bitte')).toBe(500)
  })

  test('the last limit a prompt names wins', () => {
    expect(limitOf('the old guide had a limit of 900 words; now cut it to under 600 words')).toBe(600)
  })

  test('a count that is not a limit is none', () => {
    expect(limitOf('the file has 2,000 words and eight sections')).toBe(undefined)
    expect(limitOf('fix the failing test in src/words.py')).toBe(undefined)
    expect(limitOf('explain how click resolves an option value')).toBe(undefined)
    expect(limitOf('at most 3 words')).toBe(undefined)
  })
})

describe('wordsOf and sectionsOf', () => {
  const DOC = ['# Title', '', 'Intro line here.', '', '## First', 'one two three', '```', '## not a heading', '```', '', '## Second', 'four five'].join('\n')

  test('words as wc -w counts them', () => {
    expect(wordsOf(DOC)).toBe(DOC.split(/\s+/).filter(Boolean).length)
    expect(wordsOf('')).toBe(0)
  })

  test('sections by second-level headings, a heading in a code block is none', () => {
    expect(sectionsOf(DOC)).toEqual([
      { title: '(before the first section)', words: 5 },
      { title: 'First', words: 11 },
      { title: 'Second', words: 4 },
    ])
    expect(sectionsOf('no headings at all')).toEqual([])
  })
})

describe('the texts', () => {
  test('within the limit: one short line', () => {
    expect(gaugeText('docs/a.md', 'a b c', 700)).toBe('docs/a.md: 3 words (as wc -w counts), within the 700 the prompt allows.')
  })

  test('well over the limit: one more write, each section at its target (90% of the limit in all)', () => {
    const text = ['## One', 'w '.repeat(500), '## Two', 'w '.repeat(550)].join('\n')
    const g = gaugeText('docs/guide.md', text, 700)
    expect(g).toContain('docs/guide.md: 1,054 words (as wc -w counts), 354 over the 700 the prompt allows.')
    expect(g).toContain('write it once more at about 630 words, every requested fact kept, each section at its target: One 502 → 300 · Two 552 → 330.')
  })

  test('a small overrun: one Edit', () => {
    const g = gaugeText('a.md', 'w '.repeat(740), 700)
    expect(g).toContain('40 over the 700')
    expect(g).toContain('trim it with one Edit')
    expect(g).not.toContain('write it once more')
  })

  test('the order names the limit, the aim and one rewrite rather than rounds', () => {
    const o = orderText(700)
    expect(o).toContain("The person's setting for writing to a length (700 words here)")
    expect(o).toContain('aim for about 600')
    expect(o).toContain('cut wording, not facts')
    expect(o).toContain('keep them and say how far over the limit it runs')
    expect(o).toContain('rather than cutting it down in rounds')
  })
})
