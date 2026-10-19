// The summary smart-compact writes ahead, by a fork of the session, for its own compactions. The compaction bench
// (pilot/delegate-bench/compact_bench.py, arm PREP) reads SUMMARY_PROMPT and SUMMARY_HEAD from this file, so what it
// measures is this text.

import type { SessionMessage } from 'claude-code'

export const SUMMARY_PROMPT = `This message is from the smart-compact plugin, not from the person. Write the summary this conversation will be compacted to: it replaces every message above, and the messages that come after this point stay as they are. Answer with the summary alone, in text; do not call any tool.

Write it so that the work can go on from the summary without the conversation:
1. Requests and intent: everything the person asked for, in order, quoting their own words for each instruction, constraint, preference and correction.
2. Decisions: what was decided and why, and what was tried or ruled out.
3. Files and code: each file read, created or changed that still matters, with its path, what changed, the functions or lines involved, and short exact snippets where the exact text matters.
4. Errors and fixes: each error met, its cause, and how it was fixed.
5. Facts: measurements, results, numbers, versions, names, commands, links and IDs that later work may need.
6. State: what is done, what is in progress, what is still to do, and the agreed next step, if any.

Be specific and complete rather than brief, and leave out what was superseded.`

export const SUMMARY_HEAD = `This conversation was compacted by smart-compact. The summary below covers its earlier part. It was written in the background before the messages that follow it, which are kept as they were: where they differ from it, they are the newer.`

/** The summary's row in the transcript, as Claude Code draws its own: one line; in full under ctrl+o. */
export const SUMMARY_LINE = 'Compacted by smart-compact, with a summary written ahead (ctrl+o to see it)'

/** The summary's last line: a reply that does not end with it was cut off, and is not used. */
export const SUMMARY_END = 'End of summary.'

/** The fork's prompt, with the person's compactInstructions after it and the end line last. */
export function summaryPrompt(instructions: string): string {
  const prompt = instructions.trim() === '' ? SUMMARY_PROMPT : `${SUMMARY_PROMPT}\n\nAlso keep: ${instructions.trim()}`
  return `${prompt}\n\nEnd it with this line alone: ${SUMMARY_END}`
}

/**
 * The summary in a fork's reply, without its end line; undefined without one. On 19 Oct a reply stopped after 1,300
 * characters, inside the first of its six parts, and replaced 300k of conversation as if it were whole.
 */
export function finishedSummary(reply: string): string | undefined {
  const lines = reply.trimEnd().split('\n')
  const bare = (s: string) => s.replace(/[*_`>#.\s]/g, '').toLowerCase()
  if (bare(lines.pop() ?? '') !== bare(SUMMARY_END)) return undefined
  const text = lines.join('\n').trim()
  return text === '' ? undefined : text
}

/** The message the summary stands in as, first in the compacted conversation. */
export function summaryMessage(summary: string): SessionMessage {
  return { role: 'user', text: `${SUMMARY_HEAD}\n\n${summary}`, toolUses: [] }
}

/** What tells one message from another, so a compaction can check the conversation still holds what the summary read. */
export function markOf(m: SessionMessage): string {
  const ids = [...m.toolUses.map(t => t.tool_use_id), ...(m.toolResults ?? []).map(t => t.tool_use_id)]
  return `${m.role}|${m.text.length}|${m.text.slice(0, 200)}|${ids.join(',')}`
}

/**
 * The compacted conversation from a summary written ahead over the first `covered` messages, the last of them marked
 * `mark`: the summary, then every message after that one, as they are (each keeping the engine's handle). The marked
 * message is looked for where it was read, else wherever it is now when it is there once (the hook's list can count
 * differently from the one read). Undefined when the conversation no longer holds it (another compaction, a rewind)
 * or has nothing after it.
 */
export function compactedWith(
  summary: string,
  covered: number,
  mark: string,
  messages: readonly SessionMessage[] | undefined,
): SessionMessage[] | undefined {
  const end = messages === undefined ? undefined : endOf(covered, mark, messages)
  if (messages === undefined || end === undefined || end >= messages.length - 1) return undefined
  return [summaryMessage(summary), ...messages.slice(end + 1)]
}

function endOf(covered: number, mark: string, messages: readonly SessionMessage[]): number | undefined {
  const read = messages[covered - 1]
  if (read !== undefined && markOf(read) === mark) return covered - 1
  const found = messages.flatMap((m, i) => (markOf(m) === mark ? [i] : []))
  return found.length === 1 ? found[0] : undefined
}

/** Why compactedWith gives undefined for these messages, for the log: counts, roles and lengths, never the text. */
export function whyNotWith(covered: number, mark: string, messages: readonly SessionMessage[] | undefined): string {
  if (messages === undefined) return 'the compaction came without the messages'
  const end = endOf(covered, mark, messages)
  if (end !== undefined) return `nothing came after the message it ended on, ${end + 1} of ${messages.length}`
  const found = messages.filter(m => markOf(m) === mark).length
  if (found > 1) return `${found} of the ${messages.length} messages look like the one it ended on`
  const read = messages[covered - 1]
  const [role, length] = mark.split('|', 2)
  return (
    `none of the ${messages.length} messages is the one it ended on (${role}, ${length} chars, message ${covered} when read` +
    (read === undefined ? ')' : `; message ${covered} is now ${read.role}, ${read.text.length} chars)`)
  )
}
