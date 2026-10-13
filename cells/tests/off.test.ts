import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

function host(on: On) {
  const tools: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', (_$, e) => {
    tools.push(e.name)
    return { value: { tool: e.name } }
  })
  return tools
}

test('turned off, cells registers no tool and answers its own call with why', { options: { enabled: false } }, async ($, on) => {
  const tools = host(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(tools).toEqual([])
  const r = await $.tool.call({ tool: 'mcp__cells__run_cell' } as never)
  expect(String(r.result)).toBe('cells is turned off (/mods turns it on).')
})
