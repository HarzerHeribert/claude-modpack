# The modpack as a whole, against plain Claude Code

13 Oct 2026. 70 graded headless Claude Code runs on click 8.5.0, and the follow-ups below: Claude Opus 5.5 at xhigh effort, the seven tasks of `RESULTS.md`, two runs per task and condition. Each condition names what loads (`--settings` sets `CLAUDE_CODE_PLUGIN_DIRS`), so the person's own settings decide nothing. The mods ran as committed at `7e1065a` (the long runs from a worktree of that commit). The official LSP plugins load in every condition.

## Conditions

- **V**: plain Claude Code, none of these mods.
- **P**: the pack: smart-compact, lsp-plus, delegate, cells, eta, with their defaults. (statusline was split out of smart-compact after these runs; it only draws, and draws nothing in a headless run.)
- **R**: as P, with a routing rule appended to the system prompt: hand off work that is fully specified, takes more than about five steps and can be proven by a diff and a check; keep lookups, traces, explanations, design and debugging.
- **VL, RL**: V and R in a long session. One session read all of `src/click` in plain Claude Code (227k tokens of context, $1.90); every long run forks it (`--resume … --fork-session`) in the same folder, reset in between, one run at a time. A forked run's reported cost includes the history it forked, so its cost is counted from its own requests (main loop and workers), as the transcript holds them from the run's start.
- **PL, HL**: a second long session, prepared the same way but with the pack loaded from the start (233k tokens, $1.97), so its tools are loaded as in real use. PL: Opus alone. HL: told in the prompt to do the task through `hand_off` (the instruction of RESULTS.md's F and I).
- **W**: as V with Sonnet 5.5 as the main model: plain Claude Code, no mods, fresh.
- **DF, DL**: the pack, fresh and in the long session (as PL), the person ending each prompt with "Delegate where you see fit."
- **Y**: as Q, with lsp-plus answering symbol greps from the language server and warming servers at session start.
- From the afternoon of 13 Oct the person's claude.ai connectors were off (378 deferred tools down to 15) and a run's own settings could not turn them back on: DF, DL, Y and their baseline (results-noconn) ran without them, so their costs compare with each other, not with the earlier runs.
- **Q**: as P, after the pack went quiet where it had no proof (lsp-plus's grep note off); the four small tasks, four more runs each, beside four more of V.
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
- **The small tasks' extra cost in the long session was the setup's.** In RL a lookup or a trace cost 2–3 cents more; RL loaded the pack into a session begun without it, which writes the pack's additions into an already cached session. With the pack loaded from the start (PL, below) the same tasks cost what plain Claude Code does.
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
- **A resumed session takes no appended system prompt.** `--system-prompt-snapshot` (on by default) records the system prompt on a conversation's first request and sends that record on every later request and resume. A fork told by `--append-system-prompt` to end every reply with a set word never did. RL never received its routing rule; the first HL runs never received their instruction, and Opus handed off 0 times in them (`results-handoff-deferred.jsonl`).
- **A tool added to a resumed session comes in deferred.** The pack's tools, absent when the plain session was prepared, were named in a `deferred_tools_delta` and had to be loaded with ToolSearch before use, although each registers with `isDeferred: false`. Claude Code keeps the cached prompt's tool list as it was; a mod loaded into a running session (hot reload, `/plugin`) is in the same position.

## Why Opus does not hand off (X)

Is it Claude Code's system prompt? It says nothing about grep, LSP, subagents or delegation; it does say "When you have enough information to act, act. Do not re-derive facts already established." To test it, X loaded the pack and replaced Claude Code's whole system prompt with one plain sentence and the routing rule (1,186 characters, checked in each run's snapshot). On the feature and the tests, the work the rule names: 0 hand-offs in 4 runs, all correct.

Nor is it permission. DF and DL ended every prompt with the person's own "Delegate where you see fit.": 0 hand-offs in 28 runs (14 fresh, 14 in the long session), all correct.

So it is the model, not the harness. Opus 5.5 does not give away work it can do itself unless the person asks: 0 hand-offs when delegate was offered (24 runs), stated its savings in its description (4), was named by a system-prompt rule (14 with Claude Code's prompt, 4 without), and 0 uses of Claude Code's own Agent tool in 174 runs; asked in the prompt, it handed off every time. Guidance on *how* to work does take: the chaining guidance in the system prompt cut requests by a quarter. On small work the model's choice was the cheaper one (a hand-off costs more there); it misses only the big, specified work, so the lever is the person's ask.

The grep note fails for a plainer reason: it arrives after the grep has answered, and following it takes two more requests (the LSP tool is deferred, one of 378 in these runs, so ToolSearch first) to answer the same question again.

## The language server answers the grep (Y)

The note telling Claude to use the LSP tool was never followed (45 notes). Y does the lookup itself: when a grep looks for a code symbol, lsp-plus asks the language server in the hook (for a function, who calls it, each caller qualified by its file's outline, `Command.invoke (1412)`; otherwise the references) and attaches the answer to the grep's result, so no step of Claude's is needed. Without connectors, against the quiet pack (results-noconn), warm runs:

| Task | Pack | Pack, answering | Requests | Cost | Runs with an answer |
| --- | --- | --- | --- | --- | --- |
| t2-rename | $0.221 · 4.6 req (7) | $0.207 · 3.4 (7) | −25% | −6.5% | 7 of 7 |
| t1-trace | $0.215 · 4.3 (7) | $0.217 · 3.9 (7) | −10% | +1% | 5 of 7 |
| t5-types, t3-explain, t4-lookup | (3 each) | (3 each) | −1% to +10% | −5% to +8% | 0: no symbol grep |

All 42 correct. Where it answers it saves steps and never cost more; where nothing asks it is silent. It is on by default in lsp-plus.

The language servers, measured with a probe mod asking from session start:
- **Cold start is once per session**: the first question after the server starts answers from the file it was asked about (pyright: 1 reference of `echo`); the server opens the project then, and answers whole from the next question on: after about 1 s for pyright on click (63 files), 4 s for the TypeScript server on this repository. Warm, a question takes 25–45 ms.
- **They live as long as the session**: started on the first question about their language (by anyone: Claude, a hook), kept until the session ends; one here ran 1 h 37 min. They cost memory, not tokens: pyright about 440 MB, the TypeScript server here about 2 GB.
- So lsp-plus's `warm` asks each language the repository has one question at session start, and the first grep's answer is whole. The answer itself still waits up to 3 s for a cold server, and gives nothing rather than a partial list.

## Unused connectors

Turning off the person's unused claude.ai connectors (Vercel, Miro, Gmail, Paybox, Drive, Claude Docs: 0 to 13 calls in 946 transcripts) took the deferred tools from 378 to 15, and about 6k tokens of tool names and server instructions out of every session. The same quiet pack on the same small tasks, warm runs:

| Task | With connectors | Without | Change |
| --- | --- | --- | --- |
| t3-explain | $0.415 (4) | $0.312 (3) | −25% |
| t1-trace | $0.323 (3) | $0.215 (7) | −33% |
| t5-types | $0.309 (4) | $0.189 (3) | −39% |
| t4-lookup | $0.270 (3) | $0.155 (3) | −43% |
| **All four** | **$1.32** | **$0.87** | **−34%** |

The same number of requests; every fresh session paid to cache what nobody used. More than any mod saves on small work. Measured across different hours, so the cache's state may differ a little; the size of the effect is not in doubt.

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

## Quiet where it has no proof (Q)

Does the pack cost anything on a task it cannot help with? What it adds, and what that costs:

- **Its prompt.** Tool descriptions and guidance, about 4,500 tokens. Tool definitions come first in every request and are the same in every session, so they are cached once and then read at $0.20 per million: about $0.001 per request. When the cache has gone cold (an hour without use) the first request writes them again, about $0.10.
- **Its notes.** In every benchmark run with the pack, lsp-plus's note on a symbol grep fired 45 times and Claude acted on it 0 times; cells' note on a check run alone fired 8 times and was followed by `run_cell` twice. The grep note is now off by default (`nudge: true` turns it on).
- **Its tools, when used.** Only on the multi-step tasks, where they pay.

Measured again on the four small tasks, plain (V, six runs each) against the quiet pack (P and Q, six each), all 48 correct. Three pack runs began with a cold cache and paid the $0.10 write; plain's smaller prefix was warm throughout. Warm runs only:

| Task | Plain | Pack | Change |
| --- | --- | --- | --- |
| t3-explain | $0.417 · 5.0 req | $0.418 · 4.3 | 0% |
| t1-trace | $0.342 · 5.0 | $0.330 · 4.2 | −4% |
| t5-types | $0.310 · 3.7 | $0.308 · 3.5 | −1% |
| t4-lookup | $0.260 · 3.2 | $0.266 · 2.8 | +2% |

In the quiet-pack runs of these tasks the pack added nothing to the conversation: 0 notes in 16 runs. What is left is the cached prompt, $0.001 a request. In the long session (PL against VL) the same tasks came out between −2% and +2%. The earlier +11% for the trace (P, two runs) was one run's spread and the grep note it ignored.

## Which mod earns it: the ablation (Z)

128 graded runs, all correct. The pack as shipped in 0.1.1 (Z: all six mods, lsp-plus answering symbol greps), the same pack without cells (Z-cells) and without lsp-plus (Z-lsp), and plain Claude Code (V) run again beside them; connectors off in all four, so these costs compare with each other only. The mods loaded from a worktree of `d7ac954`. Four runs per condition on the three multi-step tasks; on the four small ones six for V, Z and Z-lsp, two for Z-cells. The average task is the mean over tasks of each task's mean; intervals are 95% bootstrap intervals over the runs (`ablation.py`). Three runs began cold (the first feature run of each pack condition); leaving them out moves no figure by more than 2 points.

| Task | Plain (V) | Pack (Z) | Pack without cells | Pack without lsp-plus |
| --- | --- | --- | --- | --- |
| l1-feature | $0.69 · 14.2 req | $0.59 · 9.8 | $0.72 · 14.2 | $0.60 · 8.8 |
| l2-coverage | $0.72 · 10.5 | $0.59 · 7.0 | $0.59 · 8.2 | $0.58 · 7.0 |
| t2-rename | $0.29 · 8.0 | $0.21 · 3.2 | $0.30 · 7.8 | $0.25 · 5.0 |
| t1-trace | $0.24 · 5.0 | $0.23 · 3.8 | $0.23 · 4.0 | $0.22 · 4.2 |
| t3-explain | $0.32 · 4.5 | $0.32 · 4.5 | $0.31 · 4.5 | $0.31 · 4.2 |
| t4-lookup | $0.17 · 3.2 | $0.17 · 3.0 | $0.16 · 3.0 | $0.17 · 2.7 |
| t5-types | $0.20 · 3.7 | $0.21 · 3.7 | $0.21 · 3.5 | $0.20 · 3.3 |
| **Average task** | **$0.375 · 7.0** | **$0.333 · 5.0** | **$0.363 · 6.5** | **$0.332 · 5.0** |

Against plain, the pack: −11.2% [−16.6%, −5.4%] on the average task, −17.7% [−25.6%, −9.3%] on the three multi-step tasks, +0.7% [−2.4%, +4.2%] on the four small ones; the first measurement of the pack whose interval stays clear of zero. Without cells: −3.3% [−8.7%, +2.4%]. Without lsp-plus: −11.7% [−16.9%, −6.2%].

- **cells earns the savings.** Taking it out costs the pack +8.9% [+2.1%, +16.4%], and +16.3% [+5.4%, +29.5%] on the multi-step work: the feature takes 14.2 requests instead of 9.8, the rename 7.8 instead of 3.2. Opus used `run_cell` in every pack run. Its tool and the chaining guidance are about 1,900 tokens of cached prompt (the first request holds 30.6k tokens with it, 28.7k without). The earlier "cells alone 12% dearer" (8 runs, cells 0.2, connectors on) does not hold for the pack as shipped.
- **lsp-plus shows no net effect on the whole**: −0.6% [−7.2%, +6.7%] taking it out. It adds no prompt (the first request is the same size with and without it). On the rename the pack without it took 5.0 requests instead of 3.2 (+17% cost), in line with Y; four runs.
- **On the small tasks it cost 4.5%, through its warm-up** (taking it out: −4.5% [−7.1%, −1.7%]), although its answer spoke in none of t3, t4 and t5. The warm-up asks each language's server about one file at session start, and the first tracked `.py` file in click is `docs/conf.py`. Pyright reports that file's unresolved `pallets_sphinx_themes` import, and Claude Code adds the diagnostics of every file a server has open to the conversation: in 24 of 24 pack runs on these tasks, in none without lsp-plus. Per task that came to about 800 more tokens written to the cache and 130 more output tokens, the whole of the difference. Asking through `workspaceSymbol` instead leaks the same way (the LSP tool opens the file it is given).

### The warm-up fixed (Zfix)

The warm-up now asks about the smallest tracked file of each kind (click: an empty `__init__.py`), which gives its server nothing to report. A probe session with the fix had no diagnostics, against one with `docs/conf.py` before. 28 graded runs of the fixed pack, all correct (`results-warmfix.jsonl`, recorded as arm Z), against the same baselines:

| Task | Plain (V) | Pack (Z) | Pack, warm-up fixed | Pack without lsp-plus |
| --- | --- | --- | --- | --- |
| t1-trace | $0.240 · 5.0 | $0.232 · 3.8 | $0.228 · 3.5 | $0.222 · 4.2 |
| t3-explain | $0.319 · 4.5 | $0.320 · 4.5 | $0.312 · 4.2 | $0.307 · 4.2 |
| t4-lookup | $0.171 · 3.2 | $0.173 · 3.0 | $0.172 · 3.0 | $0.167 · 2.7 |
| t5-types | $0.203 · 3.7 | $0.214 · 3.7 | $0.201 · 3.5 | $0.201 · 3.3 |
| t2-rename | $0.293 · 8.0 | $0.215 · 3.2 | $0.237 · 4.2 | $0.252 · 5.0 |

- On the small tasks the fixed pack costs −2.2% [−5.6%, +1.5%] against plain, and +1.7% [−1.5%, +4.9%] against the pack without lsp-plus: the gap is gone. `docs/conf.py`'s diagnostics came up in none of the 28 runs.
- The answer still speaks: 16 answers in the 10 trace and rename runs. The rename came to −19% [−32%, −4%] against plain; against the unfixed pack +10% [−4%, +27%], within the runs' spread.
- What is left: the files lsp-plus asks about to answer a grep (the definition, the callers' outlines) are open too, so their diagnostics reach the conversation (21 attachments in the 28 runs: every lookup run's `core.py`, the trace's callers). Those are files Claude's grep had already matched. A mod cannot keep its own LSP calls out of Claude Code's diagnostics: that needs Claude Code.

## Getting Opus to hand off (HF, MO, IC, PS)

Opus never hands off unasked. Four ways around that, on the work where a hand-off pays (the feature and the coverage task) unless said otherwise; all graded runs correct.

| Condition | Session | Hand-offs | Feature | Coverage |
| --- | --- | --- | --- | --- |
| The pack, Opus alone (ablation Z) | fresh | 0 of 8 | $0.586 | $0.593 |
| **MO**: a test mod attaches the order "the person approved this plan; implement it through hand_off" to the first prompt | fresh | **8 of 8** | **$0.426 (−27%)** | **$0.397 (−33%)** |
| **IC**: the tool offered as `implement_spec(spec, check)`, an ability with no word of delegation | fresh | 0 of 8 | $0.689 (+18%) | $0.661 (+11%) |
| Opus alone (PL) | 219k | 0 of 4 | $0.758 | $0.654 |
| **PS**: told the session's size and what each request re-reads (219k tokens, $0.04), information only | 219k | 0 of 4 | $0.663 | $0.718 |

- **An order from a mod works like the person's.** That is what `afterPlan` sends when the person approves a plan. A headless run cannot approve one (no one is asked), so it was checked in a session: the person planned the feature task in plan mode (a 50-line plan) and approved it; Claude's next step was the hand-off, kind build, to Sonnet at medium effort; 20 of 20 hidden tests and the whole suite passed; the session cost $1.05 with its planning, $0.045 of it the worker. On by default for plans of 20 lines or more: a smaller plan (a rename) costs more handed off.
- **The framing is not what Opus resists.** As a capability it went unused as well, and the unused tool cost 11–18% to carry.
- **Knowing its own cost did not move it either**, nor make it anxious: no PS answer spoke of sessions, compaction or context, and the answers were as long as PL's.
- **Read-only hand-offs off (HF, and HL in a new 219k session).** With delegate taking edit work only, Opus told to hand off a lookup turned it into an edit task (the worker writes the answer to a file, the check cats it): 8 hand-offs in 12 fresh runs, +13% to +33% against the pack alone, and stray files in the repository. Reverted: a mod cannot make an ordered hand-off of small work cheaper than not ordering it (`results-explore-off*.jsonl`).

## Which worker for which kind of work (wk-…)

Each run told to hand off, every worker setting of delegate at one model and effort, three runs per task (two for the read tasks), all 41 correct; the worker models checked in the transcripts. Change against Opus alone with the pack, fresh (ablation Z):

| Kind | Task | Haiku low | Haiku | Sonnet low | Sonnet medium | Sonnet |
| --- | --- | --- | --- | --- | --- | --- |
| build | l1-feature | −34% | | −20% | −32% | −35% |
| build | l2-coverage | −45% | | −39% | −42% | −35% |
| mechanical | t2-rename | +37% | +55% | +52% | | |
| read | t1-trace | +5% | | +6% | | |
| read | t5-types | +1% | | +11% | | |

- **The worker is a small part of a hand-off**: at most $0.08, against $0.28–0.43 for the main model's own four to five requests. The setup moves the total by a few points.
- **Haiku at low effort was cheapest everywhere** on these tasks, and correct every time. Sonnet at medium was cheaper than Sonnet at low on both build tasks: a worker that thinks less left the main model more to check.
- **Defaults:** read and mechanical work Haiku at low effort; build work Sonnet at medium, three points behind Haiku low here, because these tasks are too easy to show where Haiku fails on harder builds.
- A rename this small (Opus alone 3.2 requests with lsp-plus's answer) and the read tasks cost more handed off with any worker: those kinds pay only on big work.

## The pack as it ships in 0.3.0 (V, Z, VL, PL)

14 Oct 2026. Plain Claude Code (V) against the pack (Z) on the seven tasks, fresh: four runs per task and condition, eight for the four small tasks. And in a long session, two runs per task each: one session read all of `src/click` plain (VL, 216k tokens, $1.80), another with the pack loaded from the start (PL, 220k, $1.83), and every run forks its own. The pack ran as committed at `5d8bfa4` (`/mods` and the `enabled` switch came after and change nothing while a mod is on); the claude.ai connectors were off, as since the ablation. Every run is counted, cold starts included. 116 runs, all correct; no hand-offs (a plan approved in plan mode starts one, and headless runs have no plan).

| Task | V | Z | VL | PL |
| --- | --- | --- | --- | --- |
| t4-lookup | $0.16 · 3.0 | $0.17 · 2.6 | $0.05 · 1.0 | $0.05 · 1.0 |
| t1-trace | $0.23 · 4.4 | $0.25 · 4.1 | $0.14 · 2.5 | $0.12 · 2.0 |
| t5-types | $0.20 · 3.9 | $0.21 · 3.4 | $0.05 · 1.0 | $0.06 · 1.0 |
| t3-explain | $0.32 · 4.6 | $0.33 · 4.8 | $0.10 · 1.0 | $0.10 · 1.0 |
| t2-rename | $0.27 · 6.5 | $0.26 · 4.5 | $0.50 · 8.0 | $0.32 · 5.0 |
| l2-coverage | $0.75 · 11.2 | $0.66 · 9.0 | $1.19 · 12.5 | $0.73 · 6.5 |
| l1-feature | $0.73 · 14.8 | $0.64 · 10.0 | $0.93 · 12.0 | $0.80 · 8.0 |
| **Average task** | **$0.38 · 6.9** | **$0.36 · 5.5** | **$0.42 · 5.4** | **$0.31 · 3.5** |

Change of the average task's cost, the pack against plain, with 95% bootstrap intervals (runs resampled within each task):

- **Long session: −26.2% [−31.3%, −20.9%]**, the multi-step tasks (feature, coverage, rename) −29.1% [−34.6%, −22.7%], the small ones −5.4% [−14.8%, +5.6%]; 3.5 requests per task instead of 5.4, 16% less time.
- **Fresh: −5.3% [−9.8%, −0.5%]**, the multi-step tasks −10.9% [−17.2%, −3.9%] and 18% less time, **the small ones +5.5% [+1.2%, +10.2%]**.
- **Where the small tasks' extra cost comes from.** Their output is the same (about 1,700 tokens a task) and their requests one fewer every four tasks; the difference is context: the first request carries 30.6k tokens with the pack against 26.7k without (its tools, their instructions and the chaining guidance), and a task writes 23.1k tokens to the cache instead of 21.9k, at the 1-hour price, and reads 104k instead of 97k. In a long session that share is small against the history, and the pack is even there.
- **Moving the chaining guidance before the cache boundary did not help.** cells' guidance is the same text in every session, so a `shared` system-prompt section should be written once and read after; 32 more runs of the small tasks with it (results-030-shared, all correct) cost +1.0% [−5%, +8%] against the pack as it was, the first request writing no less. Reverted.

## Limits

- Two runs per task and condition, one repository, tasks every condition solves fully: the per-task differences are within the runs' own spread; the request counts move the same way in six of seven tasks.
- Which mod saved the requests was not separated in the first runs; the ablation (Z) separates it: cells.
- The long session is one prepared history about the same code the tasks touch; a long session about something else would read differently.
- The first run of each condition writes that condition's prompt prefix to the cache; later runs read it. That is how a long session looks from its second turn on, and it is part of the counted costs.

Files: `results-suite.jsonl` (V, P, R), `results-suite-long.jsonl` (VL, RL, PL, HL), `results-sonnet.jsonl` (W), `results-quiet.jsonl` (V and Q on the small tasks), `results-prompt.jsonl` (X), `results-fit.jsonl` (DF, DL), `results-answer.jsonl` (Y), `results-noconn.jsonl` (the quiet pack without connectors), `results-handoff-deferred.jsonl` (the hand-off runs whose instruction never arrived, kept for the record), `results-ablation.jsonl` (V, Z, Z-cells, Z-lsp; analysed by `ablation.py`), `results-warmfix.jsonl` (Zfix), `results-explore-off.jsonl` and `results-explore-off-fresh.jsonl` (HL, PL, HF with read-only hand-offs off), `results-delegation-ideas.jsonl` (MO, IC, PL, PS), `results-workers.jsonl` (wk-…), `results-030.jsonl` (V, Z, VL, PL as 0.3.0 ships), `results-030-shared.jsonl` (Z with cells' guidance as a shared section), from 15 Oct (the lab notes): `results-v-1015.jsonl` (V and VL, the person's installed plugins switched off), `results-v-1015-installedpack.jsonl` (the same V with the installed pack loaded by mistake, kept for the record), `results-trail.jsonl` (Z, T, TG, PL, TL: Trail-Code beside the pack), `results-ideas.jsonl` (N, N-scout, N-blast), `results-route.jsonl` (RT), `results-squeeze.jsonl` and `results-squeeze-haiku.jsonl` (ZS), `results-yaml*.jsonl` (ZY on the generated deployment repository, 54 and 954 files, built by `yaml_repo.py`), `results-ts.jsonl` (V and Z on chrono, TypeScript, set up by `ts_repo.py`), one patch per edit run in `patches/`, the conditions and the long-session runner in `bench.py`.
