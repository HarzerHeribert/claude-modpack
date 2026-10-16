import { describe, expect, test } from 'claude-code/testing'

import { OrderClock, budgetTokens, orderText, requestWorth, tokenLife, tokensOf } from '../hooks/economy'

describe('prices', () => {
  test('a request is its context re-read and its output; a token, its write and every later re-read', () => {
    expect(requestWorth(200_000)).toBe(46_000)
    expect(tokenLife(140)).toBe(36)
    expect(tokenLife(0)).toBe(8)
  })
  test('the budget: what a saved request is worth, at the save rate, over a token’s life', () => {
    expect(budgetTokens(200_000, 0.1, 140)).toBe(127)
    expect(budgetTokens(400_000, 0.1, 140)).toBe(238)
    expect(budgetTokens(30_000, 0.1, 140)).toBe(33)
    expect(budgetTokens(200_000, 0.1, 0)).toBe(575)
    expect(budgetTokens(0, 0.1, 140)).toBe(0)
    expect(budgetTokens(200_000, 0, 140)).toBe(0)
    expect(tokensOf('x'.repeat(35))).toBe(10)
  })
})

describe('the order', () => {
  test('in the person’s name, with the session’s size', () => {
    const t = orderText(356_090)
    expect(t.startsWith("The person's setting for looking around in this session (about 356k tokens of context so far): every response")).toBe(true)
    expect(t).not.toContain('long (about')
    expect(t).toContain('look around in few, lean steps')
  })
  test('due once past the size, again after as much growth again, and after a compaction', () => {
    const c = new OrderClock()
    expect(c.due(100_000, 150_000)).toBe(false)
    expect(c.due(200_000, 150_000)).toBe(true)
    c.mark(200_000)
    expect(c.due(220_000, 150_000)).toBe(false)
    expect(c.due(350_000, 150_000)).toBe(true)
    c.mark(350_000)
    expect(c.due(90_000, 150_000)).toBe(false)
    expect(c.due(160_000, 150_000)).toBe(true)
    expect(c.due(0, 0)).toBe(false)
  })
})
