import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

import { SETTINGS_HEAD, SUBAGENT_ORDER, withSetting } from '../hooks/subagents'

const TASK = 'Explain how an option value is resolved when it is not given on the command line.'
const ORDERED = `${TASK}\n\n${SETTINGS_HEAD}\n- ${SUBAGENT_ORDER}`

/** The bottom of agent.spawn: what each subagent would start with. */
function host(on: On) {
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push(e.prompt)
    return { model: 'claude-opus-5-5', agentId: `a${prompts.length}` }
  })
  return prompts
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spawn = ($: any, extra: Record<string, unknown> = {}) =>
  $.agent.spawn({
    tool_use_id: 'toolu_1', prompt: TASK, description: 'explain the default', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false, ...extra,
  } as never)

describe("a subagent's task", () => {
  test("a general-purpose subagent gets the order in the person's name, with no size it cannot know", async ($, on) => {
    const prompts = host(on)
    await spawn($)
    expect(prompts).toEqual([ORDERED])
    expect(/tokens|\d+k\b/.test(SUBAGENT_ORDER)).toBe(false)
    // The order's substance, as seek gives it beside the person's prompts.
    for (const part of ['stays in your context', 're-reads all of it', 'into one command', 'grep -n first', 'not whole files', 'do not read again']) {
      expect(SUBAGENT_ORDER.includes(part)).toBe(true)
    }
  })

  test("every subagent it starts gets it, each with its own task; one a subagent starts and a workflow's agent too", async ($, on) => {
    const prompts = host(on)
    await spawn($)
    await spawn($, { subagentType: 'Explore', parentAgentId: 'a1' })
    await spawn($, { workflow: { runId: 'wf_1', agentIndex: 2 } })
    expect(prompts).toEqual([ORDERED, ORDERED, ORDERED])
  })

  for (const [who, extra] of [
    ["a fork, which has the parent's context and so the order", { fork: true, subagentType: 'fork' }],
    ['a resumed subagent, whose task is fixed', { resume: { agentId: 'a1' } }],
    ['a teammate', { isTeammate: true, subagentType: 'teammate', name: 'scout' }],
    ["delegate's worker, with a tuned prompt of its own", { subagentType: 'delegate:read' }],
  ] as const) {
    test(`left as it is: ${who}`, async ($, on) => {
      const prompts = host(on)
      await spawn($, extra)
      expect(prompts).toEqual([TASK])
    })
  }

  for (const [why, options] of [
    ['subagents off', { subagents: false }],
    ['the order off', { order: false }],
    ['the order only from 150k tokens of context, more than a subagent starts with', { orderFrom: 150_000 }],
    ['the mod off', { enabled: false }],
  ] as const) {
    test(`left as it is: ${why}`, { options }, async ($, on) => {
      const prompts = host(on)
      await spawn($)
      expect(prompts).toEqual([TASK])
    })
  }

  test("cells' block at the end of the task: the order joins it as one more line", async ($, on) => {
    const prompts = host(on)
    const guided = `${TASK}\n\n${SETTINGS_HEAD}\n- Fewer round-trips: put what you know into one command.`
    await spawn($, { prompt: guided })
    expect(prompts).toEqual([`${guided}\n- ${SUBAGENT_ORDER}`])
  })
})

describe('the settings block', () => {
  test('a block that is not at the end is part of the task: a new block', () => {
    const quoted = `Check this text:\n\n${SETTINGS_HEAD}\n- something\n\nThen report.`
    expect(withSetting(quoted, 'Lean.')).toBe(`${quoted}\n\n${SETTINGS_HEAD}\n- Lean.`)
  })

  test('given twice, said once', () => {
    const once = withSetting(TASK, 'Lean.')
    expect(withSetting(once, 'Lean.')).toBe(once)
  })
})
