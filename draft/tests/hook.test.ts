import { expect, test } from 'claude-code/testing'

const LONG = ['# Guide', '## One', 'w '.repeat(500), '## Two', 'w '.repeat(550)].join('\n')

function host(on: any, files: Record<string, string> = { '/repo/docs/guide.md': LONG, '/repo/src/a.py': 'x = 1\n' }) {
  const seen: { prompts: Array<readonly string[] | undefined> } = { prompts: [] }
  on('session.cwd', () => ({ value: '/repo' }))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const f = files[e.path]
    if (f === undefined) throw new Error('ENOENT')
    return { value: f }
  })
  for (const tool of ['Write', 'Edit']) on('tool.call', { tool }, () => ({ result: {}, text: 'ok' }))
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.prompts.push(e.context)
    return { text: e.text, context: e.context }
  })
  return seen
}

const prompt = ($: any, text: string, kind = 'sdk') => $.prompt.submit({ text, origin: { kind } } as never)
const write = ($: any, file_path: string) => $.tool.call({ tool: 'Write', file_path, content: '' }) as Promise<{ context?: string[] }>
const editFile = ($: any, file_path: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' }) as Promise<{ context?: string[] }>

test('a prompt with a word limit carries the setting; one without carries nothing', async ($, on) => {
  const seen = host(on)
  await prompt($, 'Fix the failing test in src/a.py, it broke after the last release.')
  await prompt($, 'docs/guide.md is too long. Revise it in place: at most 700 words.')
  expect(seen.prompts[0] ?? []).toHaveLength(0)
  expect(seen.prompts[1]).toHaveLength(1)
  expect((seen.prompts[1] as string[])[0]).toContain('(700 words here)')
})

test('after the limit, a write of a prose file shows its words by section; code files and the tool result stay as they are', async ($, on) => {
  host(on)
  await prompt($, 'Revise docs/guide.md in place: at most 700 words.')
  const r = await write($, '/repo/docs/guide.md')
  expect(r.context?.[0]).toContain('docs/guide.md: 1,056 words (as wc -w counts), 356 over the 700')
  expect(r.context?.[0]).toContain('each section at its target: (before the first section) 2 → 1 · One 502 → 299 · Two 552 → 329.')
  const e = await editFile($, 'docs/guide.md')
  expect(e.context?.[0]).toContain('356 over the 700')
  const code = await write($, '/repo/src/a.py')
  expect(code.context ?? []).toHaveLength(0)
})

test('silent until a prompt sets a limit', async ($, on) => {
  host(on)
  const r = await write($, '/repo/docs/guide.md')
  expect(r.context ?? []).toHaveLength(0)
})

test('a plugin or host prompt sets nothing', async ($, on) => {
  const seen = host(on)
  await prompt($, 'Hand-off 1 ended. Revise to at most 700 words.', 'task')
  expect(seen.prompts[0] ?? []).toHaveLength(0)
  const r = await write($, '/repo/docs/guide.md')
  expect(r.context ?? []).toHaveLength(0)
})

test('order off: the gauge alone', { options: { order: false } }, async ($, on) => {
  const seen = host(on)
  await prompt($, 'Revise docs/guide.md in place: at most 700 words.')
  expect(seen.prompts[0] ?? []).toHaveLength(0)
  expect((await write($, '/repo/docs/guide.md')).context?.[0]).toContain('over the 700')
})

test('gauge off: the order alone', { options: { gauge: false } }, async ($, on) => {
  const seen = host(on)
  await prompt($, 'Revise docs/guide.md in place: at most 700 words.')
  expect(seen.prompts[0]).toHaveLength(1)
  expect((await write($, '/repo/docs/guide.md')).context ?? []).toHaveLength(0)
})
