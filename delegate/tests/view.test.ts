import { describe, expect, test } from 'claude-code/testing'

import type { DelegateJob } from '../types'
import { actionLabel, clock, headline, outcome, scanner } from '../hooks/view'

const NOW = 1_000_000_000

const running: DelegateJob = {
  n: 3,
  toolUseId: 'toolu_run',
  agentId: 'a6670ad0b181a777e',
  mode: 'edit',
  task: 'Rename foldLabel to foldTitle.',
  model: 'haiku',
  reused: false,
  reach: 2,
  startedAt: NOW - 83_000,
  state: 'running',
  requests: 4,
  usd: 0.0021,
  actions: [],
}

describe('the card', () => {
  test('a running worker: its mode, model, clock, requests and cost', () => {
    expect(headline(running, NOW)).toBe('hand-off 3 · edit · haiku · 1:23 · 4 req · $0.0021')
    expect(headline({ ...running, reused: true }, NOW)).toBe('hand-off 3 · edit · haiku (warm) · 1:23 · 4 req · $0.0021')
    expect(outcome(running)).toBeUndefined()
  })

  test('a reported one: the time it took, the saving, what changed and the check', () => {
    const done: DelegateJob = { ...running, state: 'reported', endedAt: NOW - 72_000, aloneUsd: 0.95, files: ['hooks/table.ts'], added: 2, removed: 2, check: { command: 't', exit: 0 } }
    expect(headline(done, NOW)).toBe('hand-off 3 · edit · haiku · 11s · 4 req · $0.0021 · on your model ≈ $0.95')
    expect(outcome(done)).toBe('+2 −2 in 1 file · check passed · reach: 2 references')
    expect(outcome({ ...done, check: { command: 't', exit: 1 }, files: [] })).toBe('no file changed · check failed (exit 1) · reach: 2 references')
    expect(outcome({ ...done, mode: 'explore', actions: [{ tool: 'Read', label: 'a', state: 'ok', startedAt: 0 }], reach: 1 })).toBe('1 step read · reach: 1 reference')
  })

  test('what an action was about, in a few words', () => {
    expect(actionLabel('Read', { file_path: '/repo/eta/hooks/table.ts' })).toBe('hooks/table.ts')
    expect(actionLabel('Bash', { command: 'git grep -n foldLabel\nmore' })).toBe('git grep -n foldLabel')
    expect(actionLabel('LSP', { operation: 'findReferences', filePath: '/repo/hooks/table.ts', line: 245 })).toBe('findReferences hooks/table.ts:245')
  })

  test('the scanner sweeps out and back; the clock turns to minutes', () => {
    expect(scanner(0)).toEqual({ before: '', head: '━━', after: '······' })
    expect(scanner(6)).toEqual({ before: '······', head: '━━', after: '' })
    expect(scanner(7)).toEqual({ before: '·····', head: '━━', after: '·' })
    expect(clock(59_400)).toBe('59s')
    expect(clock(61_000)).toBe('1:01')
  })
})
