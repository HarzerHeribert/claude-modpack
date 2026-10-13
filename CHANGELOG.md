# Changelog

## 0.1.0 (2026-10-13)

The first public release: the `modpack` plugin and the six mods it installs.

- **statusline**: one line under the prompt with the model and its effort, how full the context is, the plan's 5-hour and 7-day use with their resets, and what other mods put on it through `$.statusline.set`.
- **smart-compact**: keeps an idle session's prompt cache warm, or compacts it just before it expires, whichever is cheaper; says on the line whether the next prompt is ready or cold.
- **delegate**: a `hand_off` tool that gives a self-contained task to a cheaper worker (Haiku or Sonnet), with the diff, a check it runs itself and the cost as evidence.
- **lsp-plus**: references and definitions that name the docs using a symbol, a warning when an edit leaves the docs behind, `/refs` for stale names and dead links, Markdown and SQL language servers, and a note when a grep looks for a code symbol.
- **cells**: a `run_cell` tool for several edits and their check in one step through the real Edit tool, the language server's references, definitions and renames, and a short note when a model request did nothing a previous one couldn't have.
- **eta**: long-running and background jobs with a percentage and an estimated finish time above the prompt; what has finished leaves, a failure stays until you write again.

How each was measured is in [`benchmarks/`](benchmarks/).
