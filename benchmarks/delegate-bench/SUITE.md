# The modpack as a whole, against plain Claude Code

13 Oct 2026. 70 graded headless Claude Code runs on click 8.5.0: Claude Opus 5.5 at xhigh effort, the seven tasks of `RESULTS.md`, two runs per task and condition. Each condition names what loads (`--settings` sets `CLAUDE_CODE_PLUGIN_DIRS`), so the person's own settings decide nothing. The mods ran as committed at `7e1065a` (the long runs from a worktree of that commit). The official LSP plugins load in every condition.

## Conditions

- **V**: plain Claude Code, none of these mods.
- **P**: the pack: smart-compact, lsp-plus, delegate, cells, eta, with their defaults. (statusline was split out of smart-compact after these runs; it only draws, and draws nothing in a headless run.)
- **R**: as P, with a routing rule appended to the system prompt: hand off work that is fully specified, takes more than about five steps and can be proven by a diff and a check; keep lookups, traces, explanations, design and debugging.
- **VL, RL**: V and R in a long session. One session read all of `src/click` in plain Claude Code (227k tokens of context, $1.90); every long run forks it (`--resume … --fork-session`) in the same folder, reset in between, one run at a time. A forked run's reported cost includes the history it forked, so its cost is counted from its own requests (main loop and workers), as the transcript holds them from the run's start.

## Results

Mean per task: cost in dollars at list prices, and main-model requests.

| Task | V | P | R | VL | RL |
| --- | --- | --- | --- | --- | --- |
| t4-lookup | $0.26 · 3.0 | $0.26 · 2.5 | $0.26 · 2.5 | $0.06 · 1.0 | $0.09 · 1.0 |
| t1-trace | $0.36 · 5.0 | $0.39 · 4.5 | $0.38 · 4.0 | $0.14 · 2.0 | $0.17 · 2.0 |
| t5-types | $0.29 · 3.5 | $0.31 · 3.5 | $0.30 · 3.0 | $0.09 · 1.5 | $0.09 · 1.0 |
| t3-explain | $0.45 · 6.0 | $0.42 · 4.0 | $0.44 · 5.5 | $0.11 · 1.0 | $0.13 · 1.0 |
| t2-rename | $0.38 · 6.5 | $0.35 · 5.0 | $0.33 · 4.5 | $0.40 · 6.0 | $0.33 · 4.5 |
| l2-coverage | $0.84 · 10.5 | $0.66 · 7.0 | $0.68 · 5.5 | $0.78 · 8.0 | $0.55 · 5.0 |
| l1-feature | $0.85 · 16.0 | $0.80 · 10.0 | $0.73 · 11.5 | $0.98 · 12.0 | $0.80 · 7.5 |
| **All** | **$6.86 · 7.2** | **$6.40 · 5.2** | **$6.26 · 5.2** | **$5.10 · 4.5** | **$4.32 · 3.1** |

(The last row: total cost of the condition's 14 runs, and mean requests per run.)

- **Quality held.** 70 of 70 runs scored full marks; every run graded again from its stored answer or patch gives the same score (`pruefen.py bewertung`).
- **The pack is cheaper, more so in a long session.** In a fresh session P cost 6.7% less than V and R 8.7% less; in the long session RL cost 15.2% less than VL, and finished in 43 s instead of 54 s on average.
- **It saves requests, not tokens per request.** Opus needed 5.2 main-model requests per task with the pack against 7.2 without, and 3.1 against 4.5 in the long session; fewer in six of seven tasks fresh. The savings sit in the multi-step work: the coverage task (−21% fresh, −29% long), the rename (−8%, −18%), the feature (−6%, −18%).
- **A one-request lookup costs a little more with the pack:** in the long session t4 and t1 cost 2–3 cents more. The pack's tools and guidance lengthen every request's prompt; that pays back only where it saves a request.
- **The routing rule changed nothing.** Opus handed off 0 times in the 28 runs that had it, as in the 24 earlier runs where delegate was only offered (`RESULTS.md`). The savings above come without delegate; the rule does not ship. delegate pays when the person asks for a hand-off (−9 to −35% on specified multi-step work in `RESULTS.md`).

## Limits

- Two runs per task and condition, one repository, tasks every condition solves fully: the per-task differences are within the runs' own spread; the request counts move the same way in six of seven tasks.
- Which mod saved the requests is not separated here. The chaining guidance and the notes of cells are the likeliest (they are the part that speaks to how many steps Claude takes), but cells alone (`results-cells.jsonl`, 8 runs) came out 12% dearer in fresh sessions.
- The long session is one prepared history about the same code the tasks touch; a long session about something else would read differently.
- The first run of each condition writes that condition's prompt prefix to the cache; later runs read it. That is how a long session looks from its second turn on, and it is part of the counted costs.

Files: `results-suite.jsonl` (V, P, R), `results-suite-long.jsonl` (VL, RL), one patch per edit run in `patches/`, the conditions and the long-session runner in `bench.py`.
