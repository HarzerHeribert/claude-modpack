import { expect, mock, test } from 'claude-code/testing'

import { report } from '../hooks/bridge'

const NOW = 1_000_000_000

const REPORT = report(
  [
    { tool: 'Bash', label: 'python3 -m pytest -q', ok: false, refused: false, ms: 900, note: 'exit 1' },
    { tool: 'Read', label: '/repo/src/click/types.py', ok: true, refused: false, ms: 10 },
  ],
  { output: '1 failed, 625 passed', log: '', previews: '', handles: '{}', dropped: [], error: undefined },
  950,
  '',
)

test('Bash output reaches the model as the command wrote it', async ($, on) => {
  mock.clock(on, { now: NOW })
  const long = Array.from({ length: 600 }, (_, i) => `test case_${i} ... ok`).join('\n')
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: long, stderr: '', interrupted: false } }))
  const r = await $.tool.call({ tool: 'Bash', command: 'cargo test' })
  expect((r.result as { stdout: string }).stdout).toBe(long)
})

test('a finished cell draws as a card on every surface with a transcript', async ($, on) => {
  mock.clock(on, { now: NOW })
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cells',
      surface,
      component: 'ToolUse',
      props: {
        tool_use_id: 'toolu_test_1',
        tool: 'mcp__cells__run_cell',
        input: { code: "const t = await sh('python3 -m pytest -q')\nreturn t.out" },
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output: REPORT,
      },
      viewport: { columns: 100, rows: 40 },
    })
    expect(await ui.drawn()).toMatchObject({ type: 'Box' })
    expect(await ui.find({ type: 'Text', text: 'failed' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✕' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✓' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '· 2 calls · 1 failed · 0.9 s' })).toBeDefined()
    await ui.unmount()
  }
})

test('a running cell shows its state and the scanner', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({
    plugin: 'cells',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 'toolu_test_2', tool: 'mcp__cells__run_cell', input: { code: "await sh('sleep 5')" }, isRunning: true, isErrored: false, isInterrupted: false },
    viewport: { columns: 100, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: 'running' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '━━' })).toBeDefined()
  await ui.unmount()
})

test('a cell still being written says so and shows what has arrived', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({
    plugin: 'cells',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 'toolu_test_4', tool: 'mcp__cells__run_cell', input: { code: "const a = await read('x.ts')" }, isRunning: false, isErrored: false, isInterrupted: false },
    viewport: { columns: 100, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: 'writing' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'ran' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: "const a = await read('x.ts')" })).toBeDefined()
  await ui.unmount()
})

test('the result row shows the sections, not the call list again', async ($, on) => {
  mock.clock(on, { now: NOW })
  const ui = await $.ui.mount({
    plugin: 'cells',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_test_3', tool: 'mcp__cells__run_cell', output: REPORT, isErrored: false },
    viewport: { columns: 100, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: 'output' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 failed, 625 passed' })).toBeDefined()
  await ui.unmount()
})

test('the result shows what went wrong first, each part under its own heading', async ($, on) => {
  mock.clock(on, { now: NOW })
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
  const text = report(
    [{ tool: 'Bash', label: 'npx tsc', ok: true, refused: false, ms: 900 }],
    { output: `### tsc\n${long}\n### tests\n 51 pass\n 0 fail`, log: '', previews: '', handles: '{}', dropped: [], error: 'ReferenceError: x is not defined (line 3, column 1)' },
    950,
    '',
  )
  const ui = await $.ui.mount({
    plugin: 'cells',
    surface: 'terminal',
    component: 'ToolResult',
    props: { tool_use_id: 'toolu_test_5', tool: 'mcp__cells__run_cell', output: text, isErrored: false },
    viewport: { columns: 100, rows: 40 },
  })
  expect(await ui.find({ type: 'Text', text: 'error' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'ReferenceError: x is not defined (line 3, column 1)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'tsc' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '… 19 more lines (ctrl+o)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'tests' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 51 pass' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 0 fail' })).toBeDefined()
  await ui.unmount()
})

test('fix and repair with no program to apply them to run nothing and say so', async ($, on) => {
  mock.clock(on, { now: NOW })
  const repair = await $.tool.call({ tool: 'mcp__cells__run_cell', repair: true } as never)
  expect(String(repair.result).startsWith('run_cell: no repaired program is on offer')).toBe(true)
  const fix = await $.tool.call({ tool: 'mcp__cells__run_cell', fix: [{ old: 'a', new: 'b' }] } as never)
  expect(String(fix.result).startsWith('run_cell: no program to fix')).toBe(true)
})

