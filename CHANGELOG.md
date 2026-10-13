# Changelog

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
