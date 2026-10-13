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

test('web and mobile, which have no band, get the same news on the status line', async ($, on) => {
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
