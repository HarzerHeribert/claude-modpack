// A subagent Claude starts has a system prompt of its own, which the chaining guidance (a section of the main one)
// never reaches; the task it is given is the one thing that rides with it. Pure: no I/O.
//
// Measured in the person's transcripts: 0 of 18 subagents had the guidance, and general-purpose subagents ran about a
// third of the person's Opus requests, most of the longer ones without run_cell. An order beside the task, in the
// person's name, is followed; advice is not.

/**
 * The block the pack's mods put their settings under, at the end of a subagent's task; each mod adds its own line,
 * so either can be turned off alone. seek writes the same head.
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
 * Whether a spawn starts a subagent on a task of its own: not a fork (it has the parent's context, the guidance
 * included), not a resume (its task is fixed), not a teammate, not delegate's worker (a tuned prompt, no run_cell).
 */
export function reaches(e: Spawn): boolean {
  return !e.fork && e.resume === undefined && e.isTeammate !== true && !e.subagentType.startsWith('delegate:')
}

/** The chaining guidance, short, for a subagent's task. */
export const SUBAGENT_CHAINING =
  'Fewer round-trips: every response you make re-reads the whole conversation, so a step that needs no judgment should not cost a response of its own. ' +
  'Get what you already know you need in one Bash call (join the commands with `;`, label each part with an `echo`) or as parallel tool calls in one response; ' +
  'send edits you already know in one response with their check after them; when a search names the files you will open next, open them in the same command. ' +
  'Take a separate step only when what you do next depends on reading the result.'

/** Added only where the session has the tool; a subagent whose type lists its own tools may not. */
export const SUBAGENT_CELLS =
  "Where you have the run_cell tool, it chains real tool calls one response can't: edits and their check, the language server's references and renames, steps that follow from each other without your judgment."
