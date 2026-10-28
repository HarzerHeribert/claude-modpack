---
name: setup
description: Check that eta shows background jobs above the prompt with a percentage and a finish time, by running a short job and tracking it. Run after installing the modpack or eta.
disable-model-invocation: true
---

Set up the eta mod with the person. Every background shell job Claude starts gets a row above the prompt with how long it has run; with the `track_progress` tool, Claude adds a percentage and an estimated finish time, read live from the job's output. It runs inside Claude Code: there is nothing to install, and it has no option but its switch.

## 1. Check what is there

- `claude --version`: tested on 2.1.296 to 2.1.312; older versions are untested.
- `claude plugin list`: `eta@claude-modpack`, `✔ enabled`.
- Your tool list has `track_progress` (from the eta mod). If it does not, the mod is off or not loaded.
- Where the person works: in the terminal and the desktop app the rows sit above the prompt; on the phone or in an IDE hosting the session the same news is the status text; a terminal session watched over Remote Control (`/rc`) shows only the tool's reply, as of Claude Code 2.1.296.

## 2. Steps

None. Tell the person what it does and that `/mods eta off` turns it off.

## 3. Options

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want no rows. `/mods eta off` does the same at once. |

## 4. Confirm

Tell the person you will run a 30-second job in the background, then do it:

1. Run in the background (Bash with `run_in_background`): `for i in $(seq 1 30); do echo "step $i of 30"; sleep 1; done`
2. Call `track_progress` with the background task's id as `task` and a short `label` such as `eta check`. "step 3 of 10" lines are read without a pattern.

The tool answers with one line:

```
Showing "eta check" to the person: <percentage>, <finish time>. It updates by itself from <the job's output file>.
```

Ask the person what they see above the prompt: a row with the label, a bar, a percentage climbing to 100% and a finish time. When the job ends, the full gauge shows for a moment and the row leaves. A job that fails stays in red until they write again.

What each failure looks like:
- **No `track_progress` tool**: eta is off (`/mods eta on`) or not loaded.
- **`eta is turned off (/mods turns it on).`**: the tool's answer when the mod is off.
- **`track_progress shows jobs to the person from the main conversation only`**: it was called by a subagent; call it from the main conversation.
- **The tool answered, but no row**: the session is on the phone, an IDE or Remote Control (see step 1), or the person is looking in the wrong place: rows are above the prompt, statusline's line is under it.

End with one line: whether the row showed.

## 5. When it does not work

- **A row with no progress**: the output has no line it can count. Give `done_pattern` and `total`, or `progress_pattern`; for a job that writes its state rather than countable progress, `status_line: true` shows its last line.
- **A row that stays**: a row whose progress stops for 20 minutes ends as "no update for 20 min"; `track_progress` with `stop: true` ends it at once.
- A background command run by a subagent (a delegate worker) gets no row: its end is reported to the subagent, not to eta. delegate shows its workers in its own card and, with eta loaded, as a row of their own.

## 6. Turn it off, or remove it

- Off, at once and kept across updates: `/mods eta off`. On again: `/mods eta on`.
- Removed: `claude plugin uninstall eta@claude-modpack`. While the modpack stays installed, its next release installs any missing mod again, so turning it off is the lasting way.
