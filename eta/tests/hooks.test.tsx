import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_700_000_000_000
const LOG = ['30 tasks', ...Array.from({ length: 45 }, (_, i) => `  t-${i} RESOLVED req=7`), ''].join('\n')
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} }, viewport: { columns: 110, rows: 40 } } as const

function host(on: On, surfaces: string[]) {
  const clock = mock.clock(on, { now: NOW })
  let status: string | undefined
  on('fs.stat', () => ({ value: { kind: 'file' as const, size: LOG.length, mtimeMs: NOW, isLink: false } }))
  on('process.run', ($, e) => ({
    value: {
      exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false,
      stdout: e.argv[0] === '/bin/date' ? '+0200\n' : LOG.slice(Number(e.argv[4]) - 1, Number(e.argv[4]) - 1 + Number(e.argv[6])),
    },
  }))
  on('session.surfaces', () => ({ value: surfaces }) as never)
  on('ui.status', ($, e) => {
    status = e.text
    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine" />
  })
  // Claude Code's own drawing of a tool's reply: its text.
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String(e.props.output ?? '')}</Text>
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' },
    text: 'Command running in background with ID: bg1. Output is being written to: /tmp/t/bg1.output.',
  }) as never)
  return { clock, status: () => status }
}

test('a background job, once Claude says how to read it, shows its progress above the prompt', async ($, on) => {
  const h = host(on, ['terminal'])
  const launched = await $.tool.call({ tool: 'Bash', command: 'python3 swe.py out', run_in_background: true, description: 'SWE run' })
  expect(launched.context?.some(c => c.includes('track_progress'))).toBe(true)
  await h.clock.advance(20 * 60_000)
  const r = await $.tool.call({ tool: 'mcp__eta__track_progress', task: 'bg1', done_pattern: ' (RESOLVED|no) ', total: 90 } as never)
  expect(String(r.result)).toContain('45/90')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'eta', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /SWE run/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s+50%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s+45\/90$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\s+in 20m$/ })).toBeDefined()
    await ui.unmount()
  }
  expect(h.status()).toBe(undefined)
})

test('mobile and VS Code, which have no band, get the same news on the status line', async ($, on) => {
  const h = host(on, ['terminal', 'mobile'])
  await $.tool.call({ tool: 'Bash', command: 'python3 swe.py out', run_in_background: true, description: 'SWE run' })
  await h.clock.advance(20 * 60_000)
  await $.tool.call({ tool: 'mcp__eta__track_progress', task: 'bg1', done_pattern: ' (RESOLVED|no) ', total: 90 } as never)
  await h.clock.advance(5000)
  expect(h.status()).toMatch(/^⏳ SWE run 50% 45\/90 ETA/)
})

test('a task notification ends the job', async ($, on) => {
  const h = host(on, ['terminal'])
  await $.tool.call({ tool: 'Bash', command: 'sleep 100', run_in_background: true, description: 'nap' })
  await h.clock.advance(3 * 60_000)
  await $.prompt.submit({ text: '<task-notification><task-id>bg1</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } } as never)
  // Past the beat it has left the band: what has run is done with.
  await h.clock.advance(6000)
  const ui = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^nap/ })).toBe(undefined)
  await ui.unmount()
})

test('a pattern that is not a regular expression is refused plainly', async ($, on) => {
  host(on, ['terminal'])
  const r = await $.tool.call({ tool: 'mcp__eta__track_progress', task: 'x', file: '/tmp/log', done_pattern: '(' } as never)
  expect(String(r.result)).toBe('done_pattern is not a valid regular expression.')
})

test('a failed job stays in red until the person writes again', async ($, on) => {
  const h = host(on, ['terminal'])
  await $.tool.call({ tool: 'Bash', command: 'false', run_in_background: true, description: 'nap' })
  await h.clock.advance(60_000)
  await $.prompt.submit({ text: '<task-notification><task-id>bg1</task-id><status>failed</status></task-notification>', origin: { kind: 'task-notification' } } as never)
  await h.clock.advance(6000)
  let ui = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^nap/ })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'and now?', origin: { kind: 'composer' } } as never)
  await h.clock.advance(6000)
  ui = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /^nap/ })).toBe(undefined)
  await ui.unmount()
})

test('its own tool call reads as one line, and its reply draws nothing', async ($, on) => {
  host(on, ['terminal'])
  const input = { task: 'bench', label: 'Re-grading runs', file: '/tmp/x/run.log', total: 15, done_pattern: ' score ' }
  const row = await $.ui.mount({ plugin: 'eta', surface: 'terminal', component: 'ToolUse', props: { tool_use_id: 'toolu_e1', tool: 'mcp__eta__track_progress', input, isRunning: false, isErrored: false, isInterrupted: false }, viewport: { columns: 100, rows: 40 } } as never)
  expect(await row.find({ type: 'Text', text: 'showing Re-grading runs above the prompt' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: '· 15 steps · from run.log' })).toBeDefined()
  await row.unmount()
  const result = await $.ui.mount({ plugin: 'eta', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: 'toolu_e1', tool: 'mcp__eta__track_progress', input, output: 'Showing "Re-grading runs" to the person: ETA ~15:12.', isErrored: false }, viewport: { columns: 100, rows: 40 } } as never)
  expect(await result.find({ type: 'Text' })).toBe(undefined)
  await result.unmount()
  // Where no band is drawn, the reply is the only news, so it stays.
  const phone = await $.ui.mount({ plugin: 'eta', surface: 'mobile', component: 'ToolResult', props: { tool_use_id: 'toolu_e1', tool: 'mcp__eta__track_progress', input, output: 'Showing "Re-grading runs" to the person: ETA ~15:12.', isErrored: false }, viewport: { columns: 100, rows: 40 } } as never)
  expect(await phone.find({ type: 'Text', text: /Showing "Re-grading runs"/ })).toBeDefined()
  await phone.unmount()
})

test('a log a background command writes, tracked under its own name, stays one row', async ($, on) => {
  const h = host(on, ['terminal'])
  await $.tool.call({ tool: 'Bash', command: 'cd /tmp/x && python3 bench.py run > run-ablation.log 2>&1', run_in_background: true, description: 'Run the ablation' })
  await h.clock.advance(60_000)
  const r = await $.tool.call({ tool: 'mcp__eta__track_progress', task: 'ablation', label: 'ablation: 90 runs', file: '/tmp/x/run-ablation.log', done_pattern: ' (RESOLVED|no) ', total: 90 } as never)
  expect(String(r.result)).toContain('as background task bg1')
  const ui = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /ablation: 90 runs/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Run the ablation/ })).toBe(undefined)
  await ui.unmount()
  // Its notification ends the one row.
  await $.prompt.submit({ text: '<task-notification><task-id>bg1</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } } as never)
  await h.clock.advance(6000)
  const after = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await after.find({ type: 'Text', text: /ablation/ })).toBe(undefined)
  await after.unmount()
})

test('a status_line job whose file stops growing is failed after 20 minutes of silence', async ($, on) => {
  const h = host(on, ['terminal'])
  await $.tool.call({ tool: 'mcp__eta__track_progress', task: 'hand-off-1', file: '/tmp/t/h.status', status_line: true } as never)
  await h.clock.advance(19 * 60_000)
  let ui = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /failed/ })).toBe(undefined)
  await ui.unmount()
  await h.clock.advance(2 * 60_000)
  ui = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /failed/ })).toBeDefined()
  await ui.unmount()
})

test('a job without status_line is still running after 21 minutes of silence', async ($, on) => {
  const h = host(on, ['terminal'])
  await $.tool.call({ tool: 'mcp__eta__track_progress', task: 'quiet', file: '/tmp/t/q.log' } as never)
  await h.clock.advance(21 * 60_000)
  const ui = await $.ui.mount({ plugin: 'eta', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /failed/ })).toBe(undefined)
  expect(await ui.find({ type: 'Text', text: /quiet/ })).toBeDefined()
  await ui.unmount()
})
