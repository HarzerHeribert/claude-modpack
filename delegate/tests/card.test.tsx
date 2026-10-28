import { describe, expect, test } from 'claude-code/testing'

import type { DelegateJob } from '../types'
import { jobCard, waitingLine, type Elements } from '../hooks/view'

const NOW = 1_000_000_000

const fake = ((props: unknown) => props) as never // the element is just its props
const el = { Box: fake, Text: fake, Button: fake } as unknown as Elements

/** Every text and button label in the tree, by walking the elements the card built. */
function texts(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') out.push(String(node))
  else if (Array.isArray(node)) node.forEach(n => texts(n, out))
  else {
    const e = node as { children?: unknown; label?: string }
    if (e.label !== undefined) out.push(e.label)
    texts(e.children, out)
  }
  return out
}

const job: DelegateJob = {
  n: 3,
  toolUseId: 'toolu_run',
  agentId: 'a1',
  mode: 'explore',
  task: 'Find where foldLabel is used.',
  model: 'haiku',
  reused: false,
  reach: 0,
  startedAt: NOW - 5_000,
  state: 'running',
  requests: 2,
  usd: 0.002,
  actions: [
    { tool: 'Read', label: 'hooks/table.ts', state: 'ok', startedAt: NOW - 4_000, ms: 1_200 },
    { tool: 'Bash', label: 'git grep foldLabel', state: 'running', startedAt: NOW - 2_500 },
  ],
}

describe('the line closing a turn that waits on workers', () => {
  const agent = { id: 'task-1', agentType: 'delegate:reader', tool_use_id: 'toolu_run' }

  test('names the hand-off, its worker, how long, what it cost', () => {
    expect(waitingLine([job], { agents: [agent], workflows: 0 }, NOW)).toBe('Waiting for hand-off 3 · explore · haiku · 5s · 2 req · $0.0020')
    expect(waitingLine([job, { ...job, n: 4, toolUseId: 'toolu_two', agentId: 'a2', mode: 'edit', model: 'sonnet', effort: 'medium' }], {
      agents: [agent, { id: 'a2', agentType: 'delegate:builder' }],
      workflows: 0,
    }, NOW)).toBe('Waiting for 2 hand-offs: 3 (explore, haiku), 4 (edit, sonnet medium)')
  })

  test("leaves the line to Claude Code where it waits on anything else", () => {
    expect(waitingLine([job], undefined, NOW)).toBe(undefined)
    expect(waitingLine([job], { agents: [agent], workflows: 1 }, NOW)).toBe(undefined)
    expect(waitingLine([job], { agents: [agent, { id: 'x', agentType: 'general-purpose' }], workflows: 0 }, NOW)).toBe(undefined)
    expect(waitingLine([{ ...job, state: 'reported', endedAt: NOW }], { agents: [agent], workflows: 0 }, NOW)).toBe(undefined)
    expect(waitingLine([job], { agents: [{ id: 'other', agentType: 'delegate:reader', tool_use_id: 'toolu_other' }], workflows: 0 }, NOW)).toBe(undefined)
  })
})

describe('the card is a cell', () => {
  test('running: the task, a row per action with its time, the state and the button', () => {
    const all = texts(jobCard(el, job, NOW, 100, () => undefined))
    expect(all).toContain('Find where foldLabel is used.')
    expect(all).toContain('hooks/table.ts')
    expect(all).toContain('1.2 s')
    expect(all).toContain('git grep foldLabel')
    expect(all).toContain('2.5 s')
    expect(all).toContain('running')
    expect(all).toContain('watch ▸')
  })

  test('background, and done', () => {
    expect(texts(jobCard(el, { ...job, background: true }, NOW, 100, () => undefined))).toContain('background')
    const done = texts(jobCard(el, { ...job, state: 'reported', endedAt: NOW, aloneUsd: 0.5, actions: job.actions.slice(0, 1) }, NOW, 100, () => undefined))
    expect(done).toContain('done')
    expect(done).toContain('view ▸')
    expect(done.join(' ')).toContain('≈ $0.50 on your model')
  })

  test('long task and many actions are cut', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ tool: 'Read', label: `f${i}`, state: 'ok' as const, startedAt: 0, ms: 100 }))
    const all = texts(jobCard(el, { ...job, task: 'a\nb\nc\nd\ne\nf\ng\nh', actions: many }, NOW, 100, () => undefined))
    expect(all).toContain('… 2 more lines')
    expect(all).toContain('… 3 earlier steps')
    expect(all).not.toContain('f2')
    expect(all).toContain('f3')
  })
})
