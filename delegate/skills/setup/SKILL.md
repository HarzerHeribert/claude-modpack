---
name: setup
description: Check that delegate's hand_off tool can start its cheaper worker here (terminal or desktop app, permission mode, models), choose the workers and what happens after an approved plan, and prove it with one small read hand-off. Run after installing the modpack or delegate.
disable-model-invocation: true
---

Set up the delegate mod with the person. It gives Claude a `hand_off` tool: a task that stands alone goes to a cheaper worker model (Haiku at low effort for read and mechanical work, Sonnet at medium for build work), and the tool returns the worker's report with evidence it gathered itself: for edits the diff, the check command run by the tool, and a first line that says Verified or Not verified; for read work, each place the answer names, checked in the code. It needs the worker models on the person's account, git for the diff, and a place where Claude Code lets a mod start a worker: the terminal in any permission mode, or the desktop app outside auto mode.

## 1. Check what is there

Run these and read the answers before suggesting anything:
- `claude --version`: tested on 2.1.296 to 2.1.312; older versions are untested.
- `claude plugin list`: `delegate@claude-modpack`, `✔ enabled`. Your tool list has `hand_off` (from the delegate mod). With `framing: capability` the same tool is called `implement_spec` instead.
- `git --version`, and in the project `git rev-parse --is-inside-work-tree` (prints `true`). An edit hand-off diffs against a git snapshot taken at its start; outside a repository the diff covers only the files the worker changed through Edit and Write.
- Where the person runs Claude Code, and in which permission mode. Ask if you do not know:
  - **Terminal**: works in every mode, auto mode included.
  - **Desktop app in auto mode**: refused. Auto mode there cannot judge a worker that a mod starts, so every hand-off returns "Not handed off" and Claude does the work itself. Manual permission mode in the desktop app works.
  - In default (manual) mode the worker asks before it edits, as Claude would.
- Language servers help but are not required: the `focus` places a hand-off names are looked up in the language server. Without one, a text search stands in. A language needs its official LSP plugin and server (the pack's README, Language servers).
- On Bedrock, Vertex or another provider, the `haiku` and `sonnet` aliases must resolve to models the account can use. Untested there.

## 2. Ask, then set

Ask the person once. The defaults were measured and most keep them:

- **After a plan is approved** (`afterPlan`): `hand_off` (default): when they approve a plan of 20 lines or more, Claude is told to implement it through a hand-off, the plan as the worker's spec (followed 8 of 8 times; features and tests 22 to 26% cheaper). `off`: Claude builds approved plans itself.
- **Which workers** (`readWorker`, `mechanicalWorker`, `buildWorker`): `model:effort`, the model an alias Claude Code knows (`haiku`, `sonnet`, `opus`) and the effort one of `low`, `medium`, `high`, `xhigh`, `max`. Defaults: `haiku:low`, `haiku:low`, `sonnet:medium`. Haiku for build work was as cheap on a feature but slower (twice the steps), so build work stays with Sonnet.
- **How the tool waits** (`wait`): `tool` (default): the call holds the turn until the report is in, the fewest requests. `message`: it returns at once and the report arrives as a message.

To set an option, the person picks one way:
- `/plugin configure delegate@claude-modpack`: a dialog with each option.
- Typed in the prompt: `/config delegate.afterPlan=off`.
- By hand, in `~/.claude/settings.json` (user settings only):
  ```json
  { "pluginConfigs": { "delegate@claude-modpack": { "options": { "afterPlan": "off" } } } }
  ```

A change made inside the session reloads the mod at once; a change in the file, or from another terminal, at the next start.

## 3. Options

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want no hand-offs. `/mods delegate off` does the same at once; route then sends nothing. |
| `readWorker` | `haiku:low` | Read answers come back wrong or thin: try `haiku:medium` or `sonnet:low`. |
| `mechanicalWorker` | `haiku:low` | Spelled-out edits fail their check. |
| `buildWorker` | `sonnet:medium` | Feature work needs more (`sonnet:high`) or less. |
| `afterPlan` | `hand_off` | You want Claude to build approved plans itself: `off`. |
| `wait` | `tool` | You want to keep talking while a worker runs: `message`. Claude can still pick either per call with `background`. |
| `review` | `inline` | The main model reads the evidence itself (cheapest, measured). `fork`: a forked review returns only a verdict; `auto`: fork when the evidence is large. |
| `framing` | `hand_off` | Experiments only. `capability` offers the tool as `implement_spec`; route then finds no `hand_off` tool and does nothing. |
| `reuseMinutes` | `50` | A follow-up within this time continues the same warm worker. |
| `workerContextCap` | `60000` | A worker grown past this many tokens is not continued; the next hand-off starts fresh. |

## 4. Confirm

One small read hand-off proves the worker starts and the evidence comes back. Tell the person it starts one Haiku worker for a few requests, and that the result says what it cost.

1. Pick a function or class defined in this project and used in at least one other file: `git grep -n -w <name>` shows both.
2. Call `hand_off` with `kind: "read"`, `focus: ["<name>"]`, and a task that stands alone, such as: "In this repository, find where `<name>` is defined and every place in the code that calls or uses it. Answer with file:line for each."

The result looks like this (the numbers are an example):

```
The worker's report:
<its answer>
PLACES
src/app.py:12 <name>
src/cli.py:40 <name>

Hand-off 1 (explore) ended: haiku low · 3 requests · 14s · $0.0040; the same steps on your model: about $0.09 at 40k context.

Verified: all 2 places checked in the code (the symbol is on each line named)…
```

In the terminal the person sees a card with the task and one row per step while it runs, and, with eta, a row above the prompt. Afterwards `/delegate` (theirs to type) sums up the log in `~/.claude/mods/delegate/log.jsonl` and opens a side pane.

What each failure looks like:
- **`Not handed off: auto mode in this app cannot judge a worker that the delegate mod starts (the terminal can).`**, and once for the person: `delegate: auto mode in the desktop app cannot judge a worker the mod starts, so hand-offs are off here.` The desktop app in auto mode: switch to manual permission mode, or use the terminal.
- **`The worker did not start: <reason>`**: the reason says why: the person refused it, or the model is not available to the account (change the worker option).
- **`delegate is turned off (/mods turns it on).`**: the mod is off.
- **No `hand_off` tool**: the mod is off or not loaded, or `framing` is `capability` (look for `implement_spec`).
- **`Not verified: no PLACES block`**: the mod works; the worker did not end with the block. Read its answer yourself, or hand it off again.
- **`The hand-off failed inside the delegate mod. Do the task yourself.`**: report it, with the steps that led to it.

End with one line: hand-offs work here, or what stands in the way.

## 5. When it does not work

- **The desktop app's auto mode** refuses every worker a mod starts (tested 15 October; the terminal's auto mode works). Turn route off there too: its order would only be refused.
- **A worker waits for a permission** nobody answers: in manual mode the worker's edits ask like Claude's do. If another plugin's permission hook hangs, the modpack's hook guard stops waiting after 10 s and Claude Code asks itself.
- **Claude never hands off on its own**: measured, it almost never does unasked. It hands off when told: by the person ("hand the tests to a worker"), after an approved plan of 20 lines or more (`afterPlan`), or by route.
- **Lookups cost more handed off**: small reads, traces and small edits are cheaper done by Claude itself; hand-offs pay on features and tests (27 to 37% less, measured).

## 6. Turn it off, or remove it

- Off, at once and kept across updates: `/mods delegate off`. On again: `/mods delegate on`.
- Removed: `claude plugin uninstall delegate@claude-modpack`. route depends on it and sends nothing without it. While the modpack stays installed, its next release installs any missing mod again, so turning it off is the lasting way.
- Its log stays in `~/.claude/mods/delegate/log.jsonl` until deleted.
