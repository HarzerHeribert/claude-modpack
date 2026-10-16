import { expect, test } from 'claude-code/testing'

import { MAP_HEAD } from '../hooks/outline'

const PY = ['class Command:', '    def invoke(self, ctx):', '        echo("x")', '        return 1', '', '', 'def echo(message=None):', '    print(message)', '', 'TOP = echo("z")', ''].join('\n')
const FILES: Record<string, string> = { '/repo/src/a.py': PY, '/repo/src/b.py': PY, '/repo/docs/a.md': 'echo\n' }
const out = (stdout: string) => ({ result: { stdout, stderr: '', interrupted: false }, text: stdout })

type Opts = { tokens?: number; estimate?: number; bash?: string; files?: Record<string, string> }

function host(on: any, opts: Opts = {}) {
  const seen: { prompts: Array<readonly string[] | undefined>; usage: unknown[] } = { prompts: [], usage: [] }
  let tokens = opts.tokens
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.usage', (_$: unknown, e: { breakdown?: string } | undefined) => {
    seen.usage.push(e?.breakdown ?? 'plain')
    const breakdown = e?.breakdown && opts.estimate !== undefined ? { totalTokens: opts.estimate } : undefined
    return { value: { startedAt: 0, context: { tokens, window: 1_000_000, ...(breakdown ? { breakdown } : {}) }, rateLimits: [] } }
  })
  on('tool.call', { tool: 'Bash' }, () => out(opts.bash ?? ''))
  on('tool.call', { tool: /^Grep$/ }, () => out(opts.bash ?? ''))
  on('fs.read', (_$: unknown, e: { path: string }) => {
    const f = (opts.files ?? FILES)[e.path]
    if (f === undefined) throw new Error('ENOENT')
    return { value: f }
  })
  on('prompt.submit', (_$: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.prompts.push(e.context)
    return { text: e.text, context: e.context }
  })
  return { seen, setTokens: (t: number) => (tokens = t) }
}

const PROMPT = 'Explain how an option value is resolved when it is not given on the command line.'
const prompt = ($: any, text = PROMPT, kind = 'sdk') => $.prompt.submit({ text, origin: { kind } } as never)
const run = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })

// ---------------------------------------------------------------- the order

test('a prompt in a long session carries the order, once for this stretch of context', async ($, on) => {
  const h = host(on, { tokens: 356_090 })
  await prompt($)
  expect(h.seen.prompts[0]).toHaveLength(1)
  expect((h.seen.prompts[0] as string[])[0]).toContain('about 356k tokens of context')
  await prompt($)
  expect(h.seen.prompts[1] ?? []).toHaveLength(0)
  h.setTokens(520_000)
  await prompt($)
  expect(h.seen.prompts[2]).toHaveLength(1)
})

test('after a compaction the order comes again, since the compaction removed it', async ($, on) => {
  const h = host(on, { tokens: 400_000 })
  await prompt($)
  h.setTokens(60_000)
  await prompt($)
  h.setTokens(170_000)
  await prompt($)
  expect(h.seen.prompts.map(c => (c ?? []).length)).toEqual([1, 1, 0])
})

test('orderFrom 150000: after a compaction the order comes again once the session is long again', { options: { orderFrom: 150_000 } }, async ($, on) => {
  const h = host(on, { tokens: 400_000 })
  await prompt($)
  h.setTokens(60_000)
  await prompt($)
  h.setTokens(170_000)
  await prompt($)
  expect(h.seen.prompts.map(c => (c ?? []).length)).toEqual([1, 0, 1])
})

test('a resumed session with no response yet: the local estimate decides', async ($, on) => {
  const h = host(on, { tokens: undefined, estimate: 230_000 })
  await prompt($)
  expect(h.seen.prompts[0]).toHaveLength(1)
  expect(h.seen.usage).toEqual(['plain', 'summary'])
})

for (const [why, opts, text, kind] of [
  ['a reply', { tokens: 300_000 }, 'yes, go on', 'composer'],
  ['a command', { tokens: 300_000 }, '/compact keep the plan in mind please', 'composer'],
  ['a task notification', { tokens: 300_000 }, PROMPT, 'task-notification'],
] as const) {
  test(`no order: ${why}`, async ($, on) => {
    const h = host(on, opts)
    await prompt($, text, kind)
    expect(h.seen.prompts[0] ?? []).toHaveLength(0)
  })
}

test('order off: no order', { options: { order: false } }, async ($, on) => {
  const h = host(on, { tokens: 300_000 })
  await prompt($)
  expect(h.seen.prompts[0] ?? []).toHaveLength(0)
})

test('by default the order comes from the first prompt', async ($, on) => {
  const h = host(on, { tokens: 25_000 })
  await prompt($)
  expect(h.seen.prompts[0]).toHaveLength(1)
})

test('orderFrom 150000: no order in a small session', { options: { orderFrom: 150_000 } }, async ($, on) => {
  const h = host(on, { tokens: 90_000 })
  await prompt($)
  expect(h.seen.prompts[0] ?? []).toHaveLength(0)
})

// ---------------------------------------------------------------- the map (option, off by default)

const MAP = { options: { map: true } }

const GREP = 'src/a.py:3:        echo("x")\nsrc/b.py:3:        echo("x")\nsrc/b.py:10:TOP = echo("z")\nsrc/b.py:7:def echo(message=None):\ndocs/a.md:1:echo\n'

test('a search in a long session carries where its hits sit; the tool result is unchanged', MAP, async ($, on) => {
  host(on, { tokens: 300_000, bash: GREP })
  const r = await run($, 'cd /repo && grep -rn "echo" src docs | head -40')
  expect(r.text).toBe(GREP)
  expect(r.context).toEqual([`${MAP_HEAD}\nsrc/b.py: Command.invoke 2-4, echo 7-8, top level (1)\nsrc/a.py: Command.invoke 2-4`])
})

test('chained commands with labels: the hits are read from the output', MAP, async ($, on) => {
  const bash = '--- callers\nsrc/a.py:3:        echo("x")\n--- defs\nsrc/a.py:7:def echo(message=None):\n'
  host(on, { tokens: 300_000, bash })
  const r = await run($, 'cd /repo; echo "--- callers"; grep -rn "echo(" src; echo "--- defs"; grep -n "def echo" src/a.py')
  expect(r.context).toEqual([`${MAP_HEAD}\nsrc/a.py: Command.invoke 2-4, echo 7-8`])
})

test('the Grep tool is hooked too', MAP, async ($, on) => {
  host(on, { tokens: 300_000, bash: '3:        echo("x")\n' })
  const r = await $.tool.call({ tool: 'Grep', pattern: 'echo', path: 'src/a.py', output_mode: 'content' } as never)
  expect((r as any).context).toEqual([`${MAP_HEAD}\nsrc/a.py: Command.invoke 2-4`])
})

test('a map past its budget keeps the files with the most hits and counts the rest', { options: { map: true, saveRate: 0.024 } }, async ($, on) => {
  host(on, { tokens: 300_000, bash: GREP })
  const r = await run($, 'grep -rn "echo" src')
  expect(r.context).toEqual([`${MAP_HEAD}\nsrc/b.py: Command.invoke 2-4, echo 7-8, top level (1)\n… 1 more file`])
})

for (const [why, opts, command] of [
  ['a small session', { tokens: 90_000, bash: GREP }, 'grep -rn echo src'],
  ['no hit inside a definition', { tokens: 300_000, bash: 'src/a.py:10:TOP = echo("z")\n' }, 'grep -rn echo src'],
  ['only files seek cannot outline', { tokens: 300_000, bash: 'docs/a.md:1:echo\n' }, 'grep -rn echo docs'],
  ['an empty search', { tokens: 300_000, bash: '' }, 'grep -rn nothing src'],
  ['no search in the command', { tokens: 300_000, bash: 'src/a.py:3:x\n' }, 'cat src/a.py'],
  ['a command that writes', { tokens: 300_000, bash: GREP }, 'grep -rn echo src > /tmp/x'],
] as const) {
  test(`no map: ${why}`, MAP, async ($, on) => {
    host(on, opts)
    const r = await run($, command)
    expect(r.context ?? []).toHaveLength(0)
  })
}

test('map off by default: no map', async ($, on) => {
  host(on, { tokens: 300_000, bash: GREP })
  const r = await run($, 'grep -rn echo src')
  expect(r.context ?? []).toHaveLength(0)
})

test('off: nothing at all', { options: { enabled: false, map: true } }, async ($, on) => {
  const h = host(on, { tokens: 300_000, bash: GREP })
  await prompt($)
  const r = await run($, 'grep -rn echo src')
  expect(h.seen.prompts[0] ?? []).toHaveLength(0)
  expect(r.context ?? []).toHaveLength(0)
})
