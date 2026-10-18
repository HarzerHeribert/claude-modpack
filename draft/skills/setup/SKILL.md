---
name: setup
description: Check that draft's setting for writing to a length reaches Claude when a prompt sets a word limit, and that each write of a document then shows its words; choose its options; confirm it on a prompt with a limit. Run after installing the modpack or draft.
disable-model-invocation: true
---

Set up the draft mod with the person. Asked to write to a word limit ("at most 700 words"), Claude tends to write the whole text, count it, find it a third over, and write the whole text again, several times: each full rewrite costs the whole text in output and stays in the conversation. draft does two things, and only once a prompt sets a limit:

- Beside that prompt it adds the person's setting for writing to a length: give each part its share of the words and aim for about 85% of the limit; keep every fact the request asks for and cut wording; if those facts cannot all fit, keep them and say how far over it runs; when a draft is still well over, write it once more to each section's target instead of cutting it down in rounds.
- After each Write or Edit of a Markdown or text file, the tool's result carries one line: its words as `wc -w` counts them against the limit, and when it is more than a tenth over, each section's target.

Without a word limit in the prompt it does nothing. Measured on six writing tasks, 48 runs: −11.4% [−15.4, −7.2] cost at the same quality (0.990 with and without). It runs inside Claude Code: nothing to install, nothing leaves the machine.

## 1. Check what is there

- `claude --version`: tested on 2.1.296 to 2.1.301; older versions are untested.
- `claude plugin list`: `draft@claude-modpack`, `✔ enabled`. draft adds no tool; `/mods` shows `draft: on`.

## 2. Steps

None. Tell the person what it does, that it acts only on prompts that set a word limit, and that `/mods draft off` turns it off.

To set an option: `/plugin configure draft@claude-modpack`, or typed `/config draft.gauge=false`, or by hand in `~/.claude/settings.json` (user settings only): `{ "pluginConfigs": { "draft@claude-modpack": { "options": { "order": false } } } }`.

## 3. Options

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want none of it. `/mods draft off` does the same at once. |
| `order` | `true` | `false`: no setting beside a prompt with a limit; the word count after each write stays. |
| `gauge` | `true` | `false`: no word count after a write; the setting stays. |

## 4. Confirm

1. Ask the person to send a short writing request with a limit, for example: "Write notes/draft-check.md: three sentences on what this project does, at most 60 words."
2. Beside that prompt, look for `The person's setting for writing to a length (60 words here)`. Then write the file and look at the Write result for a line such as `notes/draft-check.md: 52 words (as wc -w counts), within the 60 the prompt allows.`
3. Say in one line whether both came, then delete the file if the person does not want it.

What each failure means:
- **No setting beside the prompt**: draft is off (`/mods`), `order` is `false`, or the prompt states the length in a form it does not read (it reads "at most N words", "under N words", "N words or fewer", "a N-word …", "höchstens N Wörter" and similar).
- **No word count after the write**: `gauge` is `false`, the file is not Markdown or text (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc`), or no prompt in this session set a limit.
- **Neither, and `/mods` shows `draft: on`**: installed or configured from a terminal, it loads at the next start of Claude Code.

## 5. Turn it off, or remove it

- Off, at once and kept across updates: `/mods draft off`.
- Removed: `claude plugin uninstall draft@claude-modpack`; while the modpack stays installed, its next release installs it again, so turning it off is the lasting way.
- It keeps no files and no log.
