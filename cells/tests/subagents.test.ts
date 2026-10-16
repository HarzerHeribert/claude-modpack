import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { SETTINGS_HEAD, SUBAGENT_CELLS, SUBAGENT_CHAINING, withSetting } from '../hooks/subagents'

const TASK = 'Find where an option default is resolved in src/click/core.py and fix the off-by-one there.'
const GUIDED = `${TASK}\n\n${SETTINGS_HEAD}\n- ${SUBAGENT_CHAINING}`

/** The bottom of agent.spawn: what each subagent would start with. */
function host(on: On) {
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: `a${prompts.length}` }
  })
  return prompts
}

/** A session start on a Mac, where run_cell registers (Seatbelt). */
function mac(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.stat', (_$, e) => ({ value: { kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false, realPath: e.path } }) as never)
  on('process.run', (_$, e) => {
    const stdout = e.argv[0] === 'node' && e.argv[1] === '-p' ? JSON.stringify(['/opt/homebrew/bin/node', 'darwin', '22.22.3', '/var/folders/x/T']) : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.register', (_$, e) => ({ value: { tool: e.name } }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spawn = ($: any, extra: Record<string, unknown> = {}) =>
  $.agent.spawn({
    tool_use_id: 'toolu_1', prompt: TASK, description: 'fix the default', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false, ...extra,
  } as never)

describe("a subagent's task", () => {
  test("a general-purpose subagent gets the guidance in the person's name; no run_cell where the session has none", async ($, on) => {
    const prompts = host(on)
    await spawn($)
    expect(prompts).toEqual([GUIDED])
    expect(prompts[0]?.includes('run_cell')).toBe(false)
  })

  test('where the session has run_cell, the subagent hears of it as available where it is', async ($, on) => {
    const prompts = host(on)
    mac(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await spawn($)
    expect(prompts).toEqual([`${TASK}\n\n${SETTINGS_HEAD}\n- ${SUBAGENT_CHAINING} ${SUBAGENT_CELLS}`])
    expect(SUBAGENT_CELLS.startsWith('Where you have the run_cell tool')).toBe(true)
  })

  test('nudge mode: the guidance, and no run_cell, which this mode never registers', { options: { mode: 'nudge' } }, async ($, on) => {
    const prompts = host(on)
    mac(on)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
    await spawn($)
    expect(prompts).toEqual([GUIDED])
  })

  test("an Explore subagent, one a subagent starts, and a workflow's agent get it too", async ($, on) => {
    const prompts = host(on)
    await spawn($, { subagentType: 'Explore' })
    await spawn($, { parentAgentId: 'a9' })
    await spawn($, { workflow: { runId: 'wf_1', agentIndex: 1 } })
    expect(prompts).toEqual([GUIDED, GUIDED, GUIDED])
  })

  for (const [who, extra] of [
    ['a fork, which has the parent\'s context and so the guidance', { fork: true, subagentType: 'fork' }],
    ['a resumed subagent, whose task is fixed', { resume: { agentId: 'a1' }, prompt: TASK }],
    ['a teammate', { isTeammate: true, subagentType: 'teammate', name: 'scout' }],
    ["delegate's worker, with a tuned prompt of its own", { subagentType: 'delegate:build' }],
  ] as const) {
    test(`left as it is: ${who}`, async ($, on) => {
      const prompts = host(on)
      await spawn($, extra)
      expect(prompts).toEqual([TASK])
    })
  }

  for (const [why, options] of [
    ['subagents off', { subagents: false }],
    ['mode off', { mode: 'off' }],
    ['the mod off', { enabled: false }],
  ] as const) {
    test(`left as it is: ${why}`, { options }, async ($, on) => {
      const prompts = host(on)
      await spawn($)
      expect(prompts).toEqual([TASK])
    })
  }
})

describe('the settings block', () => {
  test("another mod's block at the end: one more line under it", () => {
    const other = `${TASK}\n\n${SETTINGS_HEAD}\n- Lean looking around: read less.`
    expect(withSetting(other, 'Fewer round-trips.')).toBe(`${other}\n- Fewer round-trips.`)
  })

  test('a block that is not at the end is part of the task: a new block', () => {
    const quoted = `Check this text:\n\n${SETTINGS_HEAD}\n- something\n\nThen report.`
    expect(withSetting(quoted, 'Fewer round-trips.')).toBe(`${quoted}\n\n${SETTINGS_HEAD}\n- Fewer round-trips.`)
  })

  test('given twice, said once', () => {
    const once = withSetting(TASK, 'Fewer round-trips.')
    expect(withSetting(once, 'Fewer round-trips.')).toBe(once)
  })
})
