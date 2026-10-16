// What a step of looking around costs in a long session, and the order that says so. Pure: no I/O.
//
// From 979 of the person's sessions (pilot/explore-mining, round 3): every model request re-reads the whole context
// (Opus: $0.20 per million tokens from the cache), and whatever a request adds stays in the context until it is
// compacted: a median of 143 later requests (interactive) re-read it, so a token added costs $8/M to write and
// 143 x $0.20/M = $28.6/M more to carry, about $37/M over its life. Replayed against the recorded next steps, seek
// 0.2's code windows (46-85 lines) held the next read in 3-8% of searches and cost more than they saved at every
// context size; that is why 0.3 attaches only a few lines, only where a request is dear, and orders lean looking.

/** List prices in dollars per million tokens (Opus, as pilot/delegate-bench/bench.py prices them). */
export const PRICE = { read: 0.2, write: 8.0, output: 20.0 }
/** The median output of an exploration request (286-333 tokens in the sessions above). */
export const OUTPUT_PER_REQUEST = 300

/** What one more model request costs at this context, in millionths of a dollar per token-million (so: per token, x1e6). */
export function requestWorth(context: number): number {
  return context * PRICE.read + OUTPUT_PER_REQUEST * PRICE.output
}

/** What one token added to the context costs over its life: written once, re-read by `later` requests. */
export function tokenLife(later: number): number {
  return PRICE.write + PRICE.read * later
}

/**
 * The most tokens an attachment may have so that it pays: the request it saves `saveRate` of the time is worth at
 * least what its tokens cost over their life. 0 where nothing pays.
 */
export function budgetTokens(context: number, saveRate: number, later: number): number {
  if (!(context > 0) || !(saveRate > 0)) return 0
  return Math.max(0, Math.floor((saveRate * requestWorth(context)) / tokenLife(Math.max(0, later))))
}

/** Tokens in a text of code and paths, as the tokenizer counts them roughly (3.5 characters a token). */
export function tokensOf(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/**
 * The order beside the person's prompt in a long session. An order in the person's name is followed (24 of 24
 * hand-off orders); advice from a tool is not (0 of 45). It names the person's setting, which is what it is.
 */
export function orderText(context: number): string {
  const k = Math.round(context / 1000)
  return (
    `The person's setting for looking around in this session (about ${k}k tokens of context so far): every response you make re-reads all of it, ` +
    `and whatever you read stays in it, re-read by every later response until it is compacted. So look around in few, lean steps: ` +
    `put the searches and reads you can already name into one command; when a search shows where to look, read those places in the same step; ` +
    `read only the definitions or lines you need (grep -n first, then a range around them), not whole files or long ranges; ` +
    `and do not read again what this session already holds unless it changed.`
  )
}

/**
 * When the order is due: once the context is past `from`, then again each time it has grown by another `every`,
 * and after a compaction (the context fell to under half) once it is past `from` again. The order stays in the
 * context until it is compacted, so it needs no repeating on every prompt.
 */
export class OrderClock {
  private last: number | undefined
  due(context: number, from: number, every = 150_000): boolean {
    if (!(context >= from) || context <= 0) return false
    if (this.last === undefined) return true
    if (context < this.last / 2) return true
    return context >= this.last + Math.max(every, 1)
  }
  mark(context: number): void {
    this.last = context
  }
}
