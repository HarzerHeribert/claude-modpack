import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SUMMARY_HEAD, compactedWith, markOf, whyNotWith } from '../hooks/summary'

const NOW = 1_000_000_000
const MINUTE = 60_000

/** The world beneath the plugin: a subscription session, no repo, no agents. */
function world(on: On, forks: string[], cacheRead: number, isFailing = false, said: (string | undefined)[] = [], context = 400_000) {
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
        cache_read_input_tokens: context,
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

// ---------------------------------------------------------------- after a turn

/** /compact as the person would type it, the way smart-compact asks for its own compaction with a summary written ahead. */
function compactCommands(on: On, list: string[]) {
  on('command.run', { command: 'compact' }, () => {
    list.push('/compact')
    return { text: 'Compacted' }
  })
}

function compactions(on: On, list: string[]) {
  on('session.compact', (_, e) => {
    list.push(e.trigger ?? 'plugin')
    return {
      messages: [{ role: 'user' as const, text: 'Summary of the session so far.', toolUses: [] }],
      tokensBefore: 412_000,
      tokensAfter: 41_000,
      usage: { input_tokens: 500, cache_read_input_tokens: 405_000, cache_creation_input_tokens: 0, output_tokens: 7_000 },
    }
  })
}

test('prepare off: a long session compacts 20 s after a turn, when that pays back soon, and says so', { timeoutMs: 30_000, options: { afterTurnPayback: 20, prepare: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const list: string[] = []
  const logs: string[] = []
  world(on, [], 412_000)
  compactions(on, list)
  on('ui.log', (_, e) => (logs.push(e.text), { value: undefined }))
  await oneTurn($)
  await clock.advance(10_000)
  expect(list).toEqual([])
  await clock.advance(15_000)
  expect(list).toEqual(['plugin'])
  expect(logs.some(l => l.includes('after the turn') && l.includes('pays back after about'))).toBe(true)
})

test('a shorter session, where it would pay back late, is left alone after the turn', { timeoutMs: 30_000, options: { afterTurnPayback: 20 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const list: string[] = []
  world(on, [], 150_000, false, [], 150_000)
  compactions(on, list)
  await oneTurn($)
  await clock.advance(60_000)
  expect(list).toEqual([])
})

test('prepare off: a draft in the prompt box, or the next prompt already sent, holds it', { timeoutMs: 30_000, options: { afterTurnPayback: 20, prepare: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const list: string[] = []
  world(on, [], 412_000)
  compactions(on, list)
  let draft = 'and then'
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  await oneTurn($)
  await clock.advance(25_000)
  expect(list).toEqual([])
  draft = ''
  // The next prompt comes within the 20 s: the check scheduled by the first turn stands down.
  await $.turn.start({ text: 'next', turnId: 't2' })
  await clock.advance(25_000)
  expect(list).toEqual([])
})

test('by default (afterTurnPayback 0): never after a turn', { timeoutMs: 30_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const forks: string[] = []
  const list: string[] = []
  world(on, forks, 412_000)
  compactions(on, list)
  await oneTurn($)
  await clock.advance(60_000)
  expect(list).toEqual([])
  expect(forks).toEqual([])
})

// ---------------------------------------------------------------- the summary written ahead

const ASK = { role: 'user' as const, text: 'Build the parser.', toolUses: [] }
const BUILT = { role: 'assistant' as const, text: 'Built it.', toolUses: [] }
const TALK = [ASK, BUILT]

test('prepare: a fork writes the summary at the turn end, and the compaction comes at once, not 20 s later', { timeoutMs: 30_000, options: { afterTurnPayback: 20 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const forks: string[] = []
  const list: string[] = []
  world(on, forks, 412_000)
  compactions(on, list)
  compactCommands(on, list)
  on('session.messages', () => ({ value: TALK }))
  await oneTurn($)
  await clock.advance(1_000)
  expect(forks.length).toBe(1)
  expect(forks[0]).toContain('Write the summary this conversation will be compacted to')
  // Through /compact, not $.session.compact: a plugin's own call skips its own session.compact hook, the one that
  // answers with the summary. The kit's /compact is the stand-in above; compactedWith's tests show the answer.
  expect(list).toEqual(['/compact'])
})

test('prepare: the next turn starting at once does not stop the summary; the compaction waits for that turn to end', { timeoutMs: 30_000, options: { afterTurnPayback: 20 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const forks: string[] = []
  const list: string[] = []
  world(on, forks, 412_000)
  compactions(on, list)
  compactCommands(on, list)
  on('session.messages', () => ({ value: TALK }))
  await oneTurn($)
  // A queued notice starts the next turn before anything else runs.
  await $.turn.start({ text: 'a notice', turnId: 't2' })
  await clock.advance(1_000)
  expect(forks.length).toBe(1)
  expect(list).toEqual([])
  await $.turn.complete({ answer: 'ok', durationMs: 1_000, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.advance(1_000)
  expect(list).toEqual(['/compact'])
})

test('prepare: with the summary written ahead, the compaction is the summary and every message after those it read', () => {
  const later = [
    { role: 'user' as const, text: 'Now the tests.', toolUses: [], handle: 'h3' },
    { role: 'assistant' as const, text: 'Added them.', toolUses: [], handle: 'h4' },
  ]
  const now = [{ ...ASK, handle: 'h1' }, { ...BUILT, handle: 'h2' }, ...later]
  const mark = markOf(ASK)
  const got = compactedWith('The parser is built.', 1, mark, now)
  expect(got?.length).toBe(4)
  expect(got?.[0]?.role).toBe('user')
  expect(got?.[0]?.text).toContain(SUMMARY_HEAD)
  expect(got?.[0]?.text).toContain('The parser is built.')
  expect(got?.slice(1)).toEqual(now.slice(1))
  // The conversation no longer holds what the summary read, holds nothing after it, or was not handed over: none.
  expect(compactedWith('s', 1, mark, [{ role: 'user', text: 'Something else.', toolUses: [] }, ...later])).toBeUndefined()
  expect(compactedWith('s', 2, markOf(BUILT), now.slice(0, 2))).toBeUndefined()
  expect(whyNotWith(1, mark, undefined)).toContain('without the messages')
  expect(whyNotWith(2, markOf(BUILT), now.slice(0, 2))).toContain('nothing came after')
  expect(whyNotWith(1, mark, [{ role: 'user', text: 'Something else.', toolUses: [] }, ...later])).toContain('none of the 3 messages')
  // The hook's list counts one more message before it: the marked message is found where it now is.
  const shifted = [{ role: 'user' as const, text: 'Earlier.', toolUses: [], handle: 'h0' }, ...now]
  expect(compactedWith('s', 1, mark, shifted)?.slice(1)).toEqual(now.slice(1))
  // Found twice and not where it was read: which one is meant is unknown, so none.
  expect(compactedWith('s', 1, mark, [{ role: 'user', text: 'Earlier.', toolUses: [] }, ASK, BUILT, ASK, ...later])).toBeUndefined()
  expect(whyNotWith(1, mark, [{ role: 'user', text: 'Earlier.', toolUses: [] }, ASK, BUILT, ASK, ...later])).toContain('2 of the 6')
  expect(compactedWith('s', 1, mark, undefined)).toBeUndefined()
})

test('prepare: a fork that fails falls back to compacting 20 s after the turn, as /compact does', { timeoutMs: 30_000, options: { afterTurnPayback: 20 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const list: string[] = []
  const logs: string[] = []
  world(on, [], 412_000, true)
  compactions(on, list)
  on('session.messages', () => ({ value: TALK }))
  on('ui.log', (_, e) => (logs.push(e.text), { value: undefined }))
  await oneTurn($)
  await clock.advance(1_000)
  expect(list).toEqual([])
  expect(logs.some(l => l.includes('could not be written ahead'))).toBe(true)
  await clock.advance(25_000)
  expect(list).toEqual(['plugin'])
})

test('prepare: a shorter session, where it would pay back late, writes nothing ahead', { timeoutMs: 30_000, options: { afterTurnPayback: 20 } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const forks: string[] = []
  const list: string[] = []
  world(on, forks, 150_000, false, [], 150_000)
  compactions(on, list)
  on('session.messages', () => ({ value: TALK }))
  await oneTurn($)
  await clock.advance(60_000)
  expect(forks).toEqual([])
  expect(list).toEqual([])
})
