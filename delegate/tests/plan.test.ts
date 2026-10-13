import { describe, expect, mock, test } from 'claude-code/testing'

import {
  anchorOn,
  costUsd,
  describeReach,
  diffStat,
  mainAloneUsd,
  parseFocus,
  parseWorker,
  parseLocations,
  parseVerdict,
  reviewRoute,
  summarize,
  workerPrompt,
} from '../hooks/plan'
import type { HandOff } from '../hooks/plan'
import type { DelegateJob } from '../types'
import { dropsNotice, failedText, handOverText, etaStatusLine, isAutoModeBlock, lostEntries, planOrder, trackInEta } from '../hooks/register'

const CWD = '/repo'

describe('focus', () => {
  test('a place, a name in a file, or a bare name', () => {
    expect(parseFocus('eta/hooks/table.ts:88')).toEqual({ path: 'eta/hooks/table.ts', line: 88 })
    expect(parseFocus('eta/hooks/table.ts#layout')).toEqual({ path: 'eta/hooks/table.ts', name: 'layout' })
    expect(parseFocus('layout')).toEqual({ name: 'layout' })
    expect(parseFocus('Table.layout')).toEqual({ name: 'layout' })
  })

  test('on a line, the defined name is the anchor unless a name is asked for', () => {
    expect(anchorOn('export function layout(name: number, w: Widths) {')).toEqual({ name: 'layout', character: 17 })
    expect(anchorOn('  const rows = table(jobs, now)', 'table')).toEqual({ name: 'table', character: 16 })
    expect(anchorOn('def fold_label(n):')).toEqual({ name: 'fold_label', character: 5 })
  })

  test('an import line anchors on what it imports; keywords are never the anchor', () => {
    expect(anchorOn('from .utils import format_filename as format_filename')).toEqual({ name: 'format_filename', character: 20 })
    expect(anchorOn("import { table } from './table'")).toEqual({ name: 'table', character: 10 })
    expect(anchorOn('    return self.fail(msg)')).toEqual({ name: 'fail', character: 17 })
  })
})

describe('reading the language server', () => {
  test('a path heading over Line rows', () => {
    const text = 'Found 3 references across 2 files:\n\n/repo/eta/hooks/table.ts:\n  Line 88:17\n  Line 120:9\n\n/repo/eta/tests/table.test.ts:\n  Line 46:12'
    expect(parseLocations(text, CWD)).toEqual([
      { path: 'eta/hooks/table.ts', line: 88 },
      { path: 'eta/hooks/table.ts', line: 120 },
      { path: 'eta/tests/table.test.ts', line: 46 },
    ])
  })

  test('path:line:col rows, duplicates once', () => {
    const text = '/repo/a.ts:3:5\n/repo/a.ts:3:9\n  b/c.py:12'
    expect(parseLocations(text, CWD)).toEqual([
      { path: 'a.ts', line: 3 },
      { path: 'b/c.py', line: 12 },
    ])
  })

  test('the reach reads as references, callers and docs', () => {
    const text = describeReach([
      {
        name: 'layout',
        anchor: { name: 'layout', path: 'eta/hooks/table.ts', line: 88, character: 17 },
        refs: [{ path: 'eta/hooks/table.ts', line: 120 }, { path: 'eta/tests/table.test.ts', line: 46 }],
        callers: [{ path: 'eta/hooks/table.ts', line: 200 }],
        docs: ['The docs mention `layout` in 1 place the language server does not index:\n  README.md:42  see `layout()`'],
        via: 'lsp',
      },
    ])
    expect(text).toBe(
      '- `layout` (eta/hooks/table.ts:88): 2 references in 2 files\n  eta/hooks/table.ts:120 · eta/tests/table.test.ts:46\n  called from eta/hooks/table.ts:200\n  The docs mention `layout` in 1 place the language server does not index:\n    README.md:42  see `layout()`',
    )
  })
})

describe('the worker prompt', () => {
  test('explore reads only; edit names the check', () => {
    expect(workerPrompt({ task: 'Find X.', mode: 'explore', reach: '' })).toBe('Find X.\n\nMode: explore. Read only: change no file. Find what the task asks and report it with file:line.')
    expect(workerPrompt({ task: 'Rename X.', mode: 'edit', reach: '- `X`', check: 'npm test' })).toContain('this check will run: `npm test`')
  })
})

describe('cost', () => {
  const worker = { input_tokens: 2_000, output_tokens: 3_000, cache_read_input_tokens: 150_000, cache_creation_input_tokens: 40_000 }

  test('a Haiku worker at list prices', () => {
    // 2k×0.1 + 3k×0.5 + 150k×0.01 + 40k×0.125 = 0.2 + 1.5 + 1.5 + 5 = $8.2 per million → $0.0082
    expect(Math.round(costUsd(worker, 'claude-haiku-5-5') * 1e6)).toBe(8200)
  })

  test('the same ten requests on Opus re-read a 600k context each time', () => {
    // 10×600k×0.2 + 42k×5 + 3k×20 = 1.2M + 0.21M + 0.06M → $1.47
    expect(Math.round(mainAloneUsd({ requests: 10, contextTokens: 600_000, worker, model: 'claude-opus-5-5' }) * 1e6)).toBe(1_470_000)
  })

  test('the fork reviews only evidence worth more than a 60th of the context', () => {
    expect(reviewRoute('auto', 1_500, 30_000)).toBe('inline')
    expect(reviewRoute('auto', 9_000, 600_000)).toBe('inline')
    expect(reviewRoute('auto', 12_000, 600_000)).toBe('fork')
    expect(reviewRoute('inline', 50_000, 600_000)).toBe('inline')
  })
})

describe('evidence', () => {
  test('diff lines counted, headers not', () => {
    expect(diffStat('--- a.ts\n+++ a.ts\n@@ -1,2 +1,2 @@\n-old\n+new\n+more\n same')).toEqual({ added: 2, removed: 1 })
  })

  test('a verdict is read from the review', () => {
    expect(parseVerdict('VERDICT: fix\n- a.ts:3 off by one')).toBe('fix')
    expect(parseVerdict('looks fine')).toBeUndefined()
  })
})

describe('the log', () => {
  const base: HandOff = {
    at: 0, session: 's', mode: 'edit', model: 'claude-haiku-5-5', reused: false, focus: 1, reachRefs: 4, requests: 8,
    durationMs: 40_000, workerUsd: 0.01, mainAloneUsd: 0.9, contextTokens: 500_000, files: ['a.ts'], added: 10, removed: 2,
    check: { command: 'npm test', exit: 0 }, reworkEdits: 0, outcome: 'answer',
  }

  test('savings, rework and first-time checks', () => {
    const text = summarize([base, { ...base, reworkEdits: 2, check: { command: 'npm test', exit: 1 } }, { ...base, mode: 'explore', reused: true, check: undefined }])
    expect(text).toContain('3 hand-offs (1 explore, 2 edit), 1 on a warm worker.')
    expect(text).toContain('Worker and reviews: $0.03. The same steps on the main model: about $2.70. Saved: about $2.67.')
    expect(text).toContain('Edit work that came back: 1 of 2')
    expect(text).toContain('Checks passed first time: 1 of 2.')
  })
})

function session(on: any, agents: { name: string; model?: string; effort?: string | number }[] = []) {
  const tools: { name: string; description: string; inputSchema: { required?: string[] } }[] = []
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('tool.list', () => ({ value: [] }))
  on('agent.register', (_$: unknown, e: (typeof agents)[number]) => {
    agents.push(e)
    return { value: undefined }
  })
  on('tool.register', (_$: unknown, e: (typeof tools)[number]) => {
    tools.push({ name: e.name, description: e.description, inputSchema: e.inputSchema })
    return { value: { tool: e.name } }
  })
  on('command.register', () => ({ value: undefined }))
  return tools
}

describe('framing', () => {
  test('capability: one tool, implement_spec, offered without the language of delegation', { options: { framing: 'capability' } }, async ($, on) => {
    const tools = session(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    expect(tools.length).toBe(1)
    expect(tools[0]?.name).toBe('implement_spec')
    expect(tools[0]?.description).not.toMatch(/worker|cheaper|outsource|hand|delegat/i)
    expect(tools[0]?.inputSchema.required).toEqual(expect.arrayContaining(['spec', 'check']))
  })

  test('by default the tool is still hand_off', async ($, on) => {
    const tools = session(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    expect(tools.map(t => t.name)).toEqual(['hand_off'])
  })
})

describe('eta integration', () => {
  /** A stand-in engine with just the three calls the integration uses. */
  function world(names: string[]) {
    const calls: Record<string, unknown>[] = []
    const written: Record<string, string> = {}
    const $ = {
      tool: {
        list: async () => names.map(name => ({ name })),
        call: async (e: Record<string, unknown>) => {
          calls.push(e)
          return { result: 'ok' }
        },
      },
      fs: {
        write: async (path: string, content: string) => {
          written[path] = content
        },
      },
    }
    return { $: $ as never, calls, written }
  }

  test('with eta present, a hand-off is tracked as a status line', async () => {
    const { $, calls, written } = world(['Read', 'mcp__eta__track_progress'])
    const eta = await trackInEta($, '/tmp/d', 1, 'haiku')
    expect(eta?.file).toBe('/tmp/d/hand-off-1.status')
    expect(written['/tmp/d/hand-off-1.status']).toBe('starting · haiku\n')
    expect(calls.length).toBe(1)
    expect(calls[0]).toMatchObject({
      tool: 'mcp__eta__track_progress', task: 'hand-off-1', status_line: true, finished_pattern: '^(done|failed) ·', file: '/tmp/d/hand-off-1.status',
    })
  })

  test('without eta nothing is called or written', async () => {
    const { $, calls, written } = world(['Read'])
    expect(await trackInEta($, '/tmp/d', 1, 'haiku')).toBeUndefined()
    expect(calls.length).toBe(0)
    expect(Object.keys(written).length).toBe(0)
  })

  test('the status line reads requests, cost and the latest action', () => {
    expect(etaStatusLine({ requests: 3, usd: 0.02 }, { tool: 'Read', label: 'hooks/view.tsx' })).toBe('3 req · $0.02 · read hooks/view.tsx')
    expect(etaStatusLine({ requests: 1, usd: 0.002 })).toBe('1 req · $0.0020')
  })
})

describe('worker settings', () => {
  test('parseWorker', () => {
    expect(parseWorker('sonnet:low')).toEqual({ model: 'sonnet', effort: 'low' })
    expect(parseWorker('haiku')).toEqual({ model: 'haiku' })
    expect(parseWorker('haiku:fast')).toEqual({ model: 'haiku' })
    expect(parseWorker('claude-sonnet-5-5:xhigh')).toEqual({ model: 'claude-sonnet-5-5', effort: 'xhigh' })
  })

  test('the default schema asks for a kind, not a mode or model', async ($, on) => {
    const tools = session(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    const schema = tools[0]?.inputSchema as unknown as { properties: Record<string, { enum?: string[] }>; required: string[] }
    expect(schema.properties.kind?.enum).toEqual(['read', 'mechanical', 'build'])
    expect(schema.properties.mode).toBeUndefined()
    expect(schema.properties.model).toBeUndefined()
    expect(schema.required).toEqual(['task', 'kind'])
  })

  test('one agent per kind, with the model and effort of its setting', { options: { readWorker: 'haiku:low', mechanicalWorker: 'haiku', buildWorker: 'sonnet:medium' } }, async ($, on) => {
    const agents: { name: string; model?: string; effort?: string | number }[] = []
    session(on, agents)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    const by = Object.fromEntries(agents.map(a => [a.name, a]))
    expect(Object.keys(by).sort()).toEqual(['builder', 'mechanic', 'reader'])
    expect([by.reader?.model, by.reader?.effort]).toEqual(['haiku', 'low'])
    expect([by.mechanic?.model, by.mechanic?.effort]).toEqual(['haiku', undefined])
    expect([by.builder?.model, by.builder?.effort]).toEqual(['sonnet', 'medium'])
  })
})

describe('afterPlan', () => {
  // A plan the size of real work, and a small one.
  const plan = { tool: 'ExitPlanMode', plan: Array.from({ length: 24 }, (_, i) => `${i + 1}. step ${i + 1}`).join('\n') } as never
  const small = { tool: 'ExitPlanMode', plan: '1. Rename foo to bar.\n2. Run the tests.' } as never
  const approved = () => ({ result: 'approved', text: 'User has approved your plan.' })

  test('by default an approved plan the size of real work carries the order', async ($, on) => {
    on('tool.call', { tool: 'ExitPlanMode' }, approved)
    const r = await $.tool.call(plan)
    expect((r.context ?? []).join('\n')).toContain('implement it through the hand_off tool')
  })

  test('a small plan carries no order: a rename costs more handed off', async ($, on) => {
    on('tool.call', { tool: 'ExitPlanMode' }, approved)
    const r = await $.tool.call(small)
    expect((r.context ?? []).join('\n')).not.toContain('implement it through')
  })

  test('off: no order', { options: { afterPlan: 'off' } }, async ($, on) => {
    on('tool.call', { tool: 'ExitPlanMode' }, approved)
    const r = await $.tool.call(plan)
    expect((r.context ?? []).join('\n')).not.toContain('implement it through')
  })

  test('a rejected plan carries no order', { options: { afterPlan: 'hand_off' } }, async ($, on) => {
    on('tool.call', { tool: 'ExitPlanMode' }, () => ({ deny: 'rejected' }))
    const r = await $.tool.call(plan)
    expect(r.context ?? []).toEqual([])
  })

  test('capability framing names implement_spec', () => {
    expect(planOrder('capability')).toContain('implement it through implement_spec.')
  })
})

describe('reconcile', () => {
  const entry = (n: number, agentId: string): DelegateJob => ({
    n, toolUseId: `tu${n}`, agentId, mode: 'edit', task: 't', model: 'sonnet', reused: false, reach: 0, startedAt: 1, state: 'running', requests: 0, usd: 0, actions: [],
  })

  test('lostEntries picks the running ones whose agent is not live', () => {
    const view = [entry(1, 'a'), entry(2, 'b'), { ...entry(3, 'c'), state: 'reported' as const }]
    expect(lostEntries(view, new Set(['b'])).map(j => j.n)).toEqual([1])
  })

  test('after session.start a running card the mod never started is failed, with a note and the eta line', async ($, on) => {
    const files: Record<string, string> = { '/tmp/claude-delegate/s1/hand-off-1.status': 'starting · sonnet\n' }
    let view: unknown = [entry(1, 'ghost')]
    mock.clock(on, { now: 5_000 })
    session(on)
    on('state.get', () => ({ value: { value: view, version: 1 } }) as never)
    on('state.set', (_$, e) => {
      view = (e as unknown as { value: unknown }).value
      return { value: { isSet: true, version: 2 } } as never
    })
    on('fs.read', (_$, e) => {
      const text = files[e.path]
      if (text === undefined) throw new Error('ENOENT')
      return { value: text }
    })
    on('fs.write', (_$, e) => {
      files[e.path] = e.text
      return { value: undefined }
    })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    const [j] = view as DelegateJob[]
    expect(j?.state).toBe('failed')
    expect(j?.endedAt).toBeDefined()
    expect(j?.note).toMatch(/^lost track/)
    expect(files['/tmp/claude-delegate/s1/hand-off-1.status']).toBe('starting · sonnet\nfailed · lost track\n')
  })
})

describe('auto mode refusing the worker start', () => {
  const auto = 'The server-side auto mode classifier gave no verdict for Agent: the request that produced this action did not ask for one'
  const planOf = { tool: 'ExitPlanMode', plan: Array.from({ length: 24 }, (_, i) => `${i + 1}. step ${i + 1}`).join('\n') } as never
  const handOff = { tool: 'mcp__delegate__hand_off', task: 'read the code', kind: 'read' } as never

  /** A session where the worker start is denied with `deny`; returns the lines logged for the person. */
  async function refused($: any, on: any, deny: string) {
    session(on)
    const logged: string[] = []
    on('ui.log', (_$: unknown, e: { text: string }) => {
      logged.push(e.text)
      return { value: undefined }
    })
    on('session.cwd', () => ({ value: CWD }))
    on('clock.now', () => ({ value: 1000 }))
    on('agent.spawn', () => ({ deny }))
    on('tool.call', () => ({ result: 'approved', text: 'ok' }))
    await $.session.start({ cwd: CWD, surface: 'desktop', isInteractive: true } as never)
    return logged
  }

  test('recognises the auto mode text only', () => {
    expect(isAutoModeBlock(auto)).toBe(true)
    expect(isAutoModeBlock('denied by rule')).toBe(false)
  })

  test('new result text; the person is told once', async ($, on) => {
    const logged = await refused($, on, auto)
    const a = await $.tool.call(handOff)
    const b = await $.tool.call(handOff)
    expect(String(a.result ?? a.text ?? JSON.stringify(a))).toContain('Not handed off: auto mode in this app')
    expect(JSON.stringify(b)).toContain('Not handed off')
    expect(logged.length).toBe(1)
    expect(logged[0]).toContain('hand-offs are off here')
  })

  test('another deny keeps the old text', async ($, on) => {
    const logged = await refused($, on, 'nope')
    expect(JSON.stringify(await $.tool.call(handOff))).toContain('The worker did not start: nope')
    expect(logged.length).toBe(0)
  })

  test('after a block an approved plan carries no order', async ($, on) => {
    await refused($, on, auto)
    await $.tool.call(handOff)
    const r = await $.tool.call(planOf)
    expect((r.context ?? []).join('\n')).not.toContain('implement it through')
  })
})

// The test kit cannot spawn a worker (agent.spawn answers only { model } or { deny }, the agent id is the host's),
// so handOver is covered through its exported texts and the drop decision.
describe('a background hand-off ending without a notice', () => {
  test('helpers: texts and the drop decision', () => {
    expect(handOverText(2, 'w', 'r', 'ev')).toBe('Hand-off 2 (w) has ended. Its report:\n\nr\n\nev')
    expect(failedText(2, 'w', 'why')).toContain('Do the task yourself or hand it off again.')
    expect(dropsNotice(new Set(['w1']), 'task', 'done w1')).toBe(true)
    expect(dropsNotice(new Set(['w1']), 'plugin', 'Hand-off 1 (w1) has ended')).toBe(false)
    expect(dropsNotice(new Set(['w1']), 'task', 'done w2')).toBe(false)
  })
})
