// A subagent's task comes from Claude, not the person, so the order beside the person's prompts never reaches it; the
// task itself is the one thing that rides with it. Pure: no I/O.
//
// Measured in the person's transcripts: general-purpose subagents ran about a third of their Opus requests. In the
// bench, the order saved most where it rode with the task (−12% fresh, −16% on TypeScript): an order beside the task,
// in the person's name, is followed; advice and orders in the middle of a search are not.

/**
 * The block the pack's mods put their settings under, at the end of a subagent's task; each mod adds its own line,
 * so either can be turned off alone. cells writes the same head.
 */
export const SETTINGS_HEAD = "The person's settings for this work:"

/** The task with one more setting: a line under the block a mod before this one began, or a new block at the end. */
export function withSetting(prompt: string, line: string): string {
  if (prompt.includes(line)) return prompt
  const at = prompt.lastIndexOf(`\n\n${SETTINGS_HEAD}\n`)
  if (at >= 0 && !prompt.slice(at + 2).includes('\n\n')) return `${prompt.trimEnd()}\n- ${line}`
  return `${prompt.trimEnd()}\n\n${SETTINGS_HEAD}\n- ${line}`
}

type Spawn = { subagentType: string; fork: boolean; isTeammate?: true; resume?: unknown }

/**
 * Whether a spawn starts a subagent on a task of its own: not a fork (it has the parent's context, the order
 * included), not a resume (its task is fixed), not a teammate, not delegate's worker (a tuned prompt of its own).
 */
export function reaches(e: Spawn): boolean {
  return !e.fork && e.resume === undefined && e.isTeammate !== true && !e.subagentType.startsWith('delegate:')
}

/**
 * The order for a subagent's task. It starts with a context of its own whose size is not known here, so the order
 * names none; the rest is the person's order as seek gives it beside their prompts.
 */
export const SUBAGENT_ORDER =
  'Lean looking around: whatever you read stays in your context, and every later response re-reads all of it. ' +
  'Put the searches and reads you can already name into one command; when a search shows where to look, read those places in the same step; ' +
  'read only the definitions or lines you need (grep -n first, then a range around them), not whole files or long ranges; ' +
  'and do not read again what you have already read unless it changed.'
