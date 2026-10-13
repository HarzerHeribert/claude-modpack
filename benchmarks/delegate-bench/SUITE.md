# The modpack as a whole, against plain Claude Code

13 Oct 2026. 70 graded headless Claude Code runs on click 8.5.0, and two follow-ups of 42 more (below): Claude Opus 5.5 at xhigh effort, the seven tasks of `RESULTS.md`, two runs per task and condition. Each condition names what loads (`--settings` sets `CLAUDE_CODE_PLUGIN_DIRS`), so the person's own settings decide nothing. The mods ran as committed at `7e1065a` (the long runs from a worktree of that commit). The official LSP plugins load in every condition.

## Conditions

- **V**: plain Claude Code, none of these mods.
- **P**: the pack: smart-compact, lsp-plus, delegate, cells, eta, with their defaults. (statusline was split out of smart-compact after these runs; it only draws, and draws nothing in a headless run.)
- **R**: as P, with a routing rule appended to the system prompt: hand off work that is fully specified, takes more than about five steps and can be proven by a diff and a check; keep lookups, traces, explanations, design and debugging.
- **VL, RL**: V and R in a long session. One session read all of `src/click` in plain Claude Code (227k tokens of context, $1.90); every long run forks it (`--resume … --fork-session`) in the same folder, reset in between, one run at a time. A forked run's reported cost includes the history it forked, so its cost is counted from its own requests (main loop and workers), as the transcript holds them from the run's start.
- **PL, HL**: a second long session, prepared the same way but with the pack loaded from the start (233k tokens, $1.97), so its tools are loaded as in real use. PL: Opus alone. HL: told in the prompt to do the task through `hand_off` (the instruction of RESULTS.md's F and I).
- **W**: as V with Sonnet 5.5 as the main model: plain Claude Code, no mods, fresh.
- **What RL actually had.** Two things found afterwards (see *The hand-off in a long session*): a resumed session takes no appended system prompt, so RL never received the routing rule; and a tool added to a resumed session comes in deferred (named, loaded on first use), so the pack's tools had to be fetched with ToolSearch before Opus could call them. RL is therefore the pack with its tools deferred and no rule, which if anything understates the pack.

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
- **It saves requests, not tokens per request.** Opus needed 5.2 main-model requests per task with the pack against 7.2 without, and 3.1 against 4.5 in the long session; fewer in six of seven tasks fresh. The savings sit in the multi-step work: the coverage task (−21% fresh, −29% long), the rename (−8%, −17%), the feature (−6%, −18%).
- **A one-request lookup costs a little more with the pack:** in the long session t4 and t1 cost 2–3 cents more. The pack's tools and guidance lengthen every request's prompt; that pays back only where it saves a request.
- **The routing rule changed nothing.** Opus handed off 0 times in the 14 fresh runs that had it (R), as in the 24 earlier runs where delegate was only offered (`RESULTS.md`); the long runs never received the rule. The savings above come without delegate; the rule does not ship. delegate pays when the person asks for a hand-off (−9 to −35% on specified multi-step work in `RESULTS.md`).

## The hand-off in a long session (PL, HL)

RESULTS.md projected that a hand-off saves more the fuller the session (−53% for the feature at 200k), by pricing each fresh run as if every main request re-read more tokens. Measured in the 233k session, 28 runs, all correct:

| Task | Opus alone (PL) | Handed off (HL) | Change | Fresh change (RESULTS.md) |
| --- | --- | --- | --- | --- |
| l1-feature | $0.82 · 7.5 req · 140 s | $0.52 · 5.5 + 5.5 worker · 102 s | −37% | −35% |
| l2-coverage | $0.73 · 6.5 · 137 s | $0.53 · 4.5 + 5.0 · 121 s | −27% | −28% |
| t2-rename | $0.26 · 3.5 · 37 s | $0.38 · 4.0 + 5.5 · 75 s | +43% | −9% |
| t3-explain | $0.11 · 1.0 · 31 s | $0.21 · 2.0 + 6.5 · 74 s | +101% | −1% |
| t1-trace | $0.14 · 2.0 · 16 s | $0.18 · 2.0 + 4.5 · 55 s | +29% | +3% |
| t5-types | $0.06 · 1.0 · 10 s | $0.23 · 3.0 + 3.5 · 46 s | +259% | +10% |
| t4-lookup | $0.06 · 1.0 · 9 s | $0.15 · 2.0 + 2.5 · 33 s | +149% | +13% |

- **Big, specified work pays as much as fresh, not more.** The feature and the tests saved 37% and 27%, about what they saved in a fresh session.
- **Everything else costs more.** A session that has already read the code answers a lookup, a trace or an explanation in one or two requests, and does the rename in 3.5. A hand-off takes two to five requests of its own (writing the task, reading the evidence, finishing), so it costs up to three and a half times as much. The projection assumed Opus would need as many steps as in a fresh session; a session that knows the code needs far fewer.
- **Rule of thumb:** hand off a feature or tests, work that would take Opus six or more steps in the session at hand; keep the rest. delegate's tool description now says this, with these numbers.
- **The pack in a long session, with its tools loaded:** PL cost $2.18 for the seven tasks against VL's $2.55 (−15%), the same as RL (−15%) with its tools deferred.

Two things about the harness, found on the way, both of which kept delegate out of the first long runs:
- **A resumed session takes no appended system prompt.** A fork told by `--append-system-prompt` to end every reply with a set word never did. RL never received its routing rule; the first HL runs never received their instruction, and Opus handed off 0 times in them (`results-handoff-deferred.jsonl`).
- **A tool added to a resumed session comes in deferred.** The pack's tools, absent when the plain session was prepared, were named in a `deferred_tools_delta` and had to be loaded with ToolSearch before use, although each registers with `isDeferred: false`. Claude Code keeps the cached prompt's tool list as it was; a mod loaded into a running session (hot reload, `/plugin`) is in the same position.

## Sonnet alone (W)

Is the model the bigger lever? Sonnet 5.5 as the main model in plain Claude Code, on the same seven tasks, fresh, 14 runs, all correct:

| Task | Opus alone (V) | Sonnet alone (W) | Cost | Time |
| --- | --- | --- | --- | --- |
| l1-feature | $0.85 · 16 req · 129 s | $0.20 · 6 · 48 s | −77% | −63% |
| l2-coverage | $0.84 · 10.5 · 138 s | $0.28 · 9 · 74 s | −67% | −46% |
| t2-rename | $0.38 · 6.5 · 41 s | $0.14 · 4 · 21 s | −64% | −49% |
| t3-explain | $0.45 · 6 · 46 s | $0.19 · 4 · 34 s | −57% | −28% |
| t1-trace | $0.36 · 5 · 28 s | $0.15 · 3.5 · 21 s | −59% | −27% |
| t5-types | $0.29 · 3.5 · 19 s | $0.13 · 3 · 18 s | −55% | −5% |
| t4-lookup | $0.26 · 3 · 13 s | $0.13 · 3 · 16 s | −50% | +24% |
| **All** | **$3.43 · 7.2 · 59 s** | **$1.21 · 4.6 · 33 s** | **−65%** | **−44%** |

- **On work this size and this well specified, Sonnet alone beats every hand-off.** It is half the price per input and output token and took fewer requests; the best Opus-to-Sonnet hand-off saved 35% on the feature, Sonnet alone 77%, because the hand-off still pays Opus for writing the task and reading the evidence.
- **The cache costs the same.** Both models read the cache at $0.20 per million tokens, so in a long session, where re-reading dominates, Sonnet is cheaper only by needing fewer requests. Not measured here.
- **What this cannot show.** Every setup in this bench scored 100%, so it says nothing about where Sonnet falls short: open-ended, ambiguous or long-running work, where Opus is held to be stronger. That is where delegation, with Opus deciding and Sonnet executing the specified parts, would have to earn its place, and it needs harder tasks than these to measure.

## Limits

- Two runs per task and condition, one repository, tasks every condition solves fully: the per-task differences are within the runs' own spread; the request counts move the same way in six of seven tasks.
- Which mod saved the requests is not separated here. The chaining guidance and the notes of cells are the likeliest (they are the part that speaks to how many steps Claude takes), but cells alone (`results-cells.jsonl`, 8 runs) came out 12% dearer in fresh sessions.
- The long session is one prepared history about the same code the tasks touch; a long session about something else would read differently.
- The first run of each condition writes that condition's prompt prefix to the cache; later runs read it. That is how a long session looks from its second turn on, and it is part of the counted costs.

Files: `results-suite.jsonl` (V, P, R), `results-suite-long.jsonl` (VL, RL, PL, HL), `results-sonnet.jsonl` (W), `results-handoff-deferred.jsonl` (the hand-off runs whose instruction never arrived, kept for the record), one patch per edit run in `patches/`, the conditions and the long-session runner in `bench.py`.
