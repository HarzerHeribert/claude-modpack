# Changelog

## 0.5.0 (2026-10-15)

route, the first mod that decides when Claude hands work off; language servers for five more languages; and the lab notes, nine write-ups of what we tried and why most of it did not ship.

- **route 0.1.0** (new, off until you turn it on): a fast classifier (ScaleDown) reads each prompt, and only feature or test work gets delegate's order to hand it to the cheaper worker. On click's eight jobs: every routing decision right (8 of 8 orders, 0 of 24 wrong ones), −17% over the pack, −40% on features and tests, all 32 results correct. Turned on, each prompt's text goes to ScaleDown, a US service; it needs a ScaleDown key.
- **lsp-plus 0.4.0**: Go, Kotlin and Ruby in the grep answer (receivers and `fun`, `val`, `object`, `module`), with references where a server has no call hierarchy; servers for shell scripts (bash-language-server) and Terraform (terraform-ls), whose grep answer takes an address such as `var.region` or `module.vpc`; `blast`, off: after an edit changes a function's parameters, its callers.
- **modpack 0.5.0**: installs route, and an update now installs a mod new in the release.
- **README**: the numbers measured again on 15 October and pooled with 13 October's (200 runs, all correct): −33% in a long session (was −26%); quick questions in a fresh session are about even (+2%, was +5%: −4% on the second day). Replicated on a TypeScript library (−7.6%) and on 30 SWE-bench Verified bug reports (23% fewer steps).
- **Lab notes**: [harzerheribert.github.io/claude-modpack](https://harzerheribert.github.io/claude-modpack/), each also as PDF: where the money in a session goes, why tools' advice is ignored, a 10,000-star code graph on our bench, the ideas we borrowed, the graveyard, language servers per extension, small models as plumbing, our plain runs that were not plain, and the comparisons on code beyond click.

## 0.4.0 (2026-10-14)

A guard against other plugins' hooks that hang, `/mods` from the keyboard, and rows above the prompt that always end.

- **modpack 0.4.0**: a hook guard. A permission or notification hook of another plugin that runs over 10 seconds no longer freezes Claude Code: the pack stops waiting for it, Claude Code goes on (with a permission question, it asks you itself), and you are told once which plugin it was. Found with Warp's plugin, whose permission hook hangs outside the Warp terminal. Only these two kinds of hook, whose skipping is safe; a hook that guards tool calls is never touched. `hookGuard: off` turns it off, for a hook that waits for you on purpose. Checked live, including the freeze that started it: a delegate worker that needs your permission, behind a hook that hangs on purpose. Without the guard no question appeared for more than a minute; with it the question came after 10 s, in default and in auto mode, and the worker finished once approved.
- **modpack 0.4.0**: `/mods <mod> on`, `/mods <mod> off`, or `/mods <mod>` to switch: the pane's buttons answer only a mouse click.
- **eta 0.2.1**: a background command run by a subagent (a delegate worker) no longer gets a row that can never end: its end is reported to the subagent, so eta never heard it. A row that measures progress and gets no output for 20 minutes ends as "no update for 20 min".
- **delegate 0.2.1**: the line Claude Code shows when delegate drops the host's second copy of a worker's report now says what happened.
- **README**: real recordings of each feature, and the measured numbers animated.

## 0.3.0 (2026-10-14)

Workers that start from an approved plan, mods you can see and switch, a pack that updates itself.

- **modpack 0.3.0, cells 0.4.1, delegate 0.2.0, eta 0.2.0, statusline 0.2.0, smart-compact 0.1.1, lsp-plus 0.3.1**.
- **modpack 0.3.0**: `/mods` shows the pack's mods and turns each on or off live; every mod has an `enabled` setting.
- **delegate 0.2.0**: when the desktop app's auto mode refuses a worker, delegate says why. A background worker's report arrives when the worker ends its turn, also in the desktop app, which sends no notice for it. A hand-off orphaned by a reload or restart now ends.
- **statusline 0.2.0**: in the desktop app it shows only the cache's state, and only when it needs the person.
- **cells 0.4.1**: a cell after a reload no longer fails when the first setup stopped halfway; it sets up again.
- **delegate**: Claude names the kind of work (`read`, `mechanical`, `build`) and the kind picks the worker, measured per kind: Haiku at low effort for read and mechanical work, Sonnet at medium for build work (`readWorker`, `mechanicalWorker`, `buildWorker`). When you approve a plan of 20 lines or more, Claude is told to implement it through a hand-off (`afterPlan`, on): an order from the mod was followed 8 of 8 times, 27–33% cheaper on feature and test work, and a real plan-mode session handed its 50-line feature plan to a Sonnet worker, correct on all 20 hidden tests. The card is drawn like a cell, and with eta loaded each running worker is a row above the prompt.
- **statusline**: in the desktop app, which draws no hint row, the line and the published-pages pill sit in the band above the prompt.
- **modpack**: keeps itself current: once a day it checks GitHub's latest release and installs a new one in the background, loaded at the next start (`updates: notify` or `off`); `/modpack:update` updates now.
- **eta**: `track_progress` takes `status_line`: a job that writes its state rather than countable progress shows its last line.

## 0.2.0 (2026-10-13)

cells leaves macOS, a mod that cannot run fully says so and offers the fix, and the savings are traced to the mod that earns them.

- **cells 0.4.0** runs off macOS: on Linux in bubblewrap, and anywhere on Node 25 or later, whose permission model closes the network (signals stay open there, and the cell's report says so). Where nothing closes the network to its runner it does not run: you see why and the fix, Claude offers it once, and `/cells:setup` does it with you. On macOS the Seatbelt profile now refuses every signal but the runner's own: before, a cell that got out of its `vm` could have signalled Claude Code itself.
- **lsp-plus 0.3.0**: `/lsp-plus:setup`, the first thing to run after installing: it finds the repository's languages, checks which LSP plugins and servers are missing, asks once, installs them, and confirms each after a restart. A language the repository has five or more files of, whose server does not answer, is named at session start, and Claude offers the setup once. The warm-up now asks about the smallest tracked file of each kind: it asked about the first (click's `docs/conf.py`), and Claude Code put that file's diagnostics into every session, 4.5% on small tasks.
- **eta 0.1.2**: a log a running background command writes, tracked under a name of its own, stays one row with that command. On phone and VS Code, where there is no band, the tool's reply stays readable.
- **Measured** (`benchmarks/delegate-bench/SUITE.md`): which mod earns the savings, each taken out of the pack (156 runs, all correct). The pack against plain Claude Code: −11% [−17%, −5%] on the average task, −18% on multi-step work, even on small tasks. cells earns it; lsp-plus answers better without saving on the whole.

## 0.1.1 (2026-10-13)

The pack goes quiet where it has no proof, answers instead of advising, and runs in the background.

- **lsp-plus 0.2.0**: a grep for a code symbol comes back with the language server's exact answer attached (who calls it, each caller named as it is nested, or its references), so Claude needs no further step: 25% fewer requests on a rename, cost even on a trace, never dearer. Language servers start at session start for the languages in the repository, so the first answer is whole. The old note asking Claude to use the LSP tool is off by default: in 45 benchmark notes it was never followed.
- **cells 0.3.0**: `run_cell({ code, background: true })` returns at once and the report arrives as a message; ctrl+enter on a running cell moves it to the background, Esc stops it after the call that is running. `sh(command, { background: true })` starts Claude Code's own background task. The card says "background" or "stopped" instead of hanging on "running".
- **eta 0.1.1**: its tool call reads as one line; the band above the prompt carries the progress.
- **Measured** (`benchmarks/delegate-bench/SUITE.md`): on tasks of one to five requests the pack now costs the same as plain Claude Code (−4% to +2%); the README's charts compare warm runs and the long session with the pack loaded from its start. Opus hands off only when told to: 0 times in 28 runs with "Delegate where you see fit" in the prompt. Unused claude.ai connectors cost 34% on fresh small tasks: worth turning off in Claude Code.

## 0.1.0 (2026-10-13)

The first public release: the `modpack` plugin and the six mods it installs.

- **statusline**: one line under the prompt with the model and its effort, how full the context is, the plan's 5-hour and 7-day use with their resets, and what other mods put on it through `$.statusline.set`.
- **smart-compact**: keeps an idle session's prompt cache warm, or compacts it just before it expires, whichever is cheaper; says on the line whether the next prompt is ready or cold.
- **delegate**: a `hand_off` tool that gives a self-contained task to a cheaper worker (Haiku or Sonnet), with the diff, a check it runs itself and the cost as evidence.
- **lsp-plus**: references and definitions that name the docs using a symbol, a warning when an edit leaves the docs behind, `/refs` for stale names and dead links, Markdown and SQL language servers, and a note when a grep looks for a code symbol.
- **cells**: a `run_cell` tool for several edits and their check in one step through the real Edit tool, the language server's references, definitions and renames, and a short note when a model request did nothing a previous one couldn't have.
- **eta**: long-running and background jobs with a percentage and an estimated finish time above the prompt; what has finished leaves, a failure stays until you write again.

How each was measured is in [`benchmarks/`](benchmarks/).
