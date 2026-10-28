---
name: setup
description: Check that seek's setting to look around in few, lean steps reaches Claude beside the person's prompts, choose its options (the setting, and the map of where a search's hits sit, off by default), and confirm it on the person's next prompt. Run after installing the modpack or seek.
disable-model-invocation: true
---

Set up the seek mod with the person. Every model request re-reads the whole conversation, and whatever Claude reads stays in it, re-read by every later request until a compaction (a median of 143 later requests in the sessions we studied). So beside the person's prompt seek adds their setting to look around in few, lean steps: the searches and reads Claude can already name in one command, the places a search shows read in the same step, definitions or line ranges instead of whole files, and nothing read again that the session already holds. It comes with the first prompt of a session, and again after a compaction or once the context has grown by another 150k tokens. Measured against the pack, all correct: cost −12% fresh on click, −16% on a TypeScript library, −10% and −16% in two kinds of long session. It runs inside Claude Code: there is nothing to install, and nothing leaves the machine.

## 1. Check what is there

- `claude --version`: tested on 2.1.296 to 2.1.312; older versions are untested.
- `claude plugin list`: `seek@claude-modpack`, `✔ enabled`. seek adds no tool, so your tool list does not show it; `/mods` does (`seek: on`).

## 2. Steps

None. Tell the person what it does, that it sends nothing anywhere, and that `/mods seek off` turns it off. Most keep the defaults; ask only if they want the map (below), which was measured and left off.

To set an option, the person picks one way:
- `/plugin configure seek@claude-modpack`: a dialog with each option.
- Typed in the prompt: `/config seek.map=true`.
- By hand, in `~/.claude/settings.json` (user settings only):
  ```json
  { "pluginConfigs": { "seek@claude-modpack": { "options": { "orderFrom": 150000 } } } }
  ```

A change made inside the session reloads the mod at once; a change in the file, or from another terminal, at the next start.

## 3. Options

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want none of it. `/mods seek off` does the same at once. |
| `order` | `true` | `false`: no setting beside the prompt. The map, if on, still works. |
| `orderFrom` | `0` | The setting only from this much context on; `0` is from the first prompt (measured that way, fresh and long). `150000` keeps it out of small sessions. |
| `subagents` | `true` | `false`: a subagent Claude starts no longer gets the setting with its task. Your prompts never reach a subagent, so its task is where the setting rides; only with `order` on and `orderFrom` 0, and never for forks, teammates or delegate's workers. |
| `map` | `false` | `true`: past `minContext`, a code search's result (grep, rg, git grep, the Grep tool; behind a cd, chained or piped) also names the functions, methods and classes that hold its hits, with their lines. Measured, it saved nothing certain: +1% fresh on click, −4.5% [−9.9, +1.2] on TypeScript, −5.5% [−11.7, +1.0] on top of the setting in a long session. |
| `minContext` | `150000` | The map's threshold: below it a request is cheap to repeat and the map stays silent. |
| `laterRequests` | `140` | Prices the map: how many later requests re-read what it adds. |
| `saveRate` | `0.1` | Prices the map: the share of a request a map is assumed to save. A first guess. |

## 4. Confirm

You cannot trigger seek yourself: its setting rides only with a prompt the person sends (typed, from the phone, or a `claude -p` turn) of 20 characters or more, not with a slash command (this setup started with one), a short reply such as "yes, go on", or a background task's notice. Once given, it does not come again until a compaction or another 150k tokens of context.

1. Look back over this conversation first. If one of the person's prompts already came with it, seek works; tell them so. It reads:

   ```
   The person's setting for looking around in this session (about 32k tokens of context so far): every response you make re-reads all of it, and whatever you read stays in it, re-read by every later response until it is compacted. So look around in few, lean steps: …
   ```

   (The number is the session's context at that prompt.)
2. If none did, tell the person: "Send me a real question or request about this project, 20 characters or more; I will tell you whether seek's setting came with it, then answer it." When it arrives, look beside it for the text above, say in one line whether it came, and then work by it.

What each failure looks like:
- **No setting beside a prompt of 20 characters or more**: seek is off (`/mods` shows `seek: off`) or not installed; `order` is `false`; `orderFrom` is above the session's context; or it already came earlier in this stretch of the session (step 1).
- **Nothing beside any prompt, and `/mods` shows `seek: on`**: installed or configured from a terminal, it loads at the next start of Claude Code.

End with one line: the setting arrived (or had already arrived), or why not.

## 5. When it does not work

- **Claude still reads a whole file now and then**: the setting is the person's preference, which Claude weighs against the task, not a rule Claude Code enforces. Where a whole file is what the task needs, reading it is right.
- **A quick lookup took a step more**: measured, the smallest lookups sometimes did (3 requests instead of 2 in one long session); the bigger jobs saved most.
- **The map is on and nothing appears**: below `minContext` it is silent; it also stays silent on a search without hits, over more than 30 files or with more than 400 lines of output, on output it cannot read as `path:line:text` rows, and where its budget is too small for a single row.

## 6. Turn it off, or remove it

- Off, at once and kept across updates: `/mods seek off`. On again: `/mods seek on`.
- Removed: `claude plugin uninstall seek@claude-modpack`. While the modpack stays installed, its next release installs any missing mod again, so turning it off is the lasting way.
- It keeps no files and no log.
