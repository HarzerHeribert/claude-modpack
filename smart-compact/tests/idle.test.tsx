import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOW = 1_000_000_000
const MINUTE = 60_000

/** The world beneath the plugin: a subscription session, no repo, no agents. */
function world(on: On, forks: string[], cacheRead: number, isFailing = false, said: (string | undefined)[] = []) {
  // No statusline mod here: smart-compact's segment is the session's status text.
  on('ui.status', (_, e) => (said.push(e.text), { value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: '/tmp/work' }))
  on('process.run', () => ({
    value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { window: 1_000_000, tokens: 412_000 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    },
  }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('model.fork', (_, e) => {
    forks.push(e.prompt)
    const none = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }
    if (isFailing) {
      return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 529, error: 'overloaded' as const, usage: none } }
    }
    return {
      value: {
        isAnswered: true as const,
        text: 'ok',
        usage: { input_tokens: 12, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0, output_tokens: 4 },
      },
    }
  })
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 2_000,
        cache_read_input_tokens: 400_000,
        cache_creation_input_tokens: 10_000,
        output_tokens: 500,
      },
    }
  })
}

/** One prompt answered in one request, then the person walks away. */
async function oneTurn($: Engine) {
  await $.session.start({ cwd: '/tmp/work', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 2 })
  for await (const _ of stream) {
    // drained
  }
  await stream.result

  await $.turn.complete({ answer: 'done', durationMs: 4_000, isAborted: false, turnId: 't1', reason: 'answer' })
}

test('keeps a large idle cache warm just before the hour runs out', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const forks: string[] = []
  const said: (string | undefined)[] = []
  world(on, forks, 412_000, false, said)

  await oneTurn($)

  await clock.advance(55 * MINUTE)
  expect(forks).toHaveLength(0)

  // Acts 2.5 minutes before the 1h edge, then the hour starts over.
  await clock.advance(3 * MINUTE)
  expect(forks).toHaveLength(1)

  // Kept warm: ready, and no countdown, since smart-compact keeps it so.
  expect(said.at(-1)).toBe('● ready')
})

test('a keep-alive that finds the cache gone stops and marks it cold', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const forks: string[] = []
  const said: (string | undefined)[] = []
  world(on, forks, 0, false, said)

  await oneTurn($)
  await clock.advance(58 * MINUTE)
  expect(forks).toHaveLength(1)

  expect(said.at(-1)).toBe('○ cold')

  // No second attempt on a cold cache.
  await clock.advance(30 * MINUTE)
  expect(forks).toHaveLength(1)
})

test('the compact strategy compacts at the edge while the cache is still warm', { timeoutMs: 30_000, options: { strategy: 'compact' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const forks: string[] = []
  const compactions: string[] = []
  const said: (string | undefined)[] = []
  world(on, forks, 412_000, false, said)
  on('session.compact', (_, e) => {
    compactions.push(e.trigger ?? 'plugin')
    return {
      messages: [{ role: 'user' as const, text: 'Summary of the session so far.', toolUses: [] }],
      tokensBefore: 412_000,
      tokensAfter: 38_000,
      usage: { input_tokens: 500, cache_read_input_tokens: 405_000, cache_creation_input_tokens: 0, output_tokens: 7_000 },
    }
  })

  await oneTurn($)
  await clock.advance(58 * MINUTE)

  expect(compactions).toEqual(['plugin'])
  expect(forks).toHaveLength(0)

  expect(said.at(-1)).toBe('◌ compacted')
})

test('a failing keep-alive backs off and gives up after three tries', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('ui.log', () => ({ value: undefined }))
  const forks: string[] = []
  world(on, forks, 412_000, true)

  await oneTurn($)
  await clock.advance(57 * MINUTE + 31_000)
  expect(forks).toHaveLength(1)

  // The retry waits its 20 seconds.
  await clock.advance(18_000)
  expect(forks).toHaveLength(1)

  await clock.advance(2 * MINUTE)
  expect(forks).toHaveLength(3)

  await clock.advance(30 * MINUTE)
  expect(forks).toHaveLength(3)
})
