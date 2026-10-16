# Does delegate pay, with lsp-plus loaded?

13 Oct 2026. 92 counted headless Claude Code runs on click 8.5.0 ($41.36 at list prices on a subscription), plus 2 smoke runs ($0.62) and 6 short Haiku checks of the mod along the way. Main model Claude Opus 5.5 at xhigh effort, with the person's own settings. Every run starts from a fresh copy of the repository and is graded by a fixed rule; each rule was checked against a right and a wrong answer first. Cost is Claude Code's own total per run. Per request it matches the transcripts to the cent, except for forked reviews, which no transcript holds (see below).

## Tasks

| Task | Size for Opus alone | What | Graded by |
| --- | --- | --- | --- |
| t4-lookup | 3 requests, 14 s | the completion variable of `my.cli-tool` | the exact name |
| t1-trace | 5 requests, 28 s | every function in src/click that calls `echo()` | the 18 callers from the AST |
| t5-types | 4.5 requests, 24 s | ParamType subclasses whose own `convert()` calls `self.fail()` | F1 against the AST's 10, list lines only |
| t3-explain | 5 requests, 37 s | how an option's missing value is resolved | the six methods named |
| t2-rename | 9 requests, 56 s | `format_filename` → `display_filename` in src, tests, docs | no old name left, docs changed, suite passes |
| l1-feature | 15 requests, 122 s | a new `click.Duration` type from a written spec, with docs and tests | 20 hidden tests, suite passes |
| l2-coverage | 9 requests, 108 s | tests that raise `utils.py`'s line and branch coverage (79.6%) | gain toward 100%; 0 if a test fails or src changed |

## Setups

`lsp-plus` is loaded in all of them.

- **A**: Opus alone.
- **N**: as A, with lsp-plus's nudge on symbol greps.
- **B**: delegate available; Opus decides.
- **G**: as B, after the tool's description stated the measured savings and what to keep in house.
- **C**: as B, plus one system-prompt line asking Opus to hand off multi-step work.
- **D**: Opus told to use `hand_off`; the report comes back as a message.
- **E**: as D, after fixing three bugs the D runs found.
- **F**: as E, with the hand-off waiting inside the tool call. Big diffs were reviewed by a fork of Opus.
- **I**: as F, reviewed inline; Opus also picks the worker model (Haiku or Sonnet) per task.
- **S**: as F, with a Sonnet worker.

## Results

**Quality.** 92 of 92 counted runs were correct, in every setup and on every task. Haiku and Sonnet workers matched Opus alone on everything here, including a feature graded by hidden tests. These tasks therefore do not show where a worker model would fall short. That needs harder tasks.

**Opus does not delegate by itself.** In B, C and G it handed off 0 times in 24 runs, even on the 15-request feature task, and even after the tool's description stated the measured savings. Outsourcing has to be decided by a rule or by the person, not left to Opus.

**When it does delegate, cost depends on the size of the task and of the session.** "@600k" is the same run in a session already holding 600k tokens: every main request (and every forked review) re-reads them, at $0.20/M from the cache. This is a projection, and it proved too kind: measured in a 233k-token session (SUITE.md, *The hand-off in a long session*), the feature and the tests saved what they save fresh (−35%, −23%; −37% and −27% before worker costs were corrected on 16 Oct, see CORRECTION-1016.md), and everything else cost more, because a session that knows the code needs far fewer steps.

| Task | A: alone | best hand-off | change | A @600k | hand-off @600k | change |
| --- | --- | --- | --- | --- | --- | --- |
| t4-lookup | $0.26 | $0.29 (F) | +13% | $0.62 | $0.65 | +5% |
| t1-trace | $0.34 | $0.35 (F) | +3% | $0.94 | $0.83 | −12% |
| t5-types | $0.32 | $0.35 (F) | +10% | $0.86 | $0.77 | −10% |
| t3-explain | $0.42 | $0.42 (F) | −1% | $1.02 | $0.84 | −18% |
| t2-rename | $0.45 | $0.41 (I) | −9% | $1.53 | $1.01 | −34% |
| l1-feature | $0.79 | $0.51 (I) | −35% | $2.59 | $0.93 | −64% |
| l2-coverage | $0.73 | $0.52 (I) | −28% | $1.81 | $1.06 | −41% |

- **Where it pays.** It pays where the task is fully specified, takes Opus more than about five requests, and has a result that a diff and a check can prove: the rename, the feature and the tests. There it saves 9–35% in a fresh session and 34–64% in a long one, at the same quality. It also keeps the main context about half as large (18k tokens added instead of 33–35k), which every later step of the session profits from.
- **Where it doesn't.** On lookups and tracing it saves nothing in a fresh session; in a long session it saves 10–18%. Opus tends to re-check an explore report it cannot verify cheaply. In one D run it redid the whole trace itself.
- **How the hand-off waits matters.** With the report arriving as a message (D, E), Opus spent 4–8 requests per hand-off. Waiting inside the tool call (F, I) brought that down to 3–5.
- **Forked reviews are expensive.** A fork read only the system prompt and tools from the cache and paid the conversation again: 18,446 tokens uncached against 14,680 from cache, at a 32k context. That makes it $0.03–0.38 per review in these small sessions, and about $2 at 600k. Reviewing inline is now the default.
- **Sonnet vs Haiku as the worker.** Sonnet did the long tasks in fewer requests (5.5–7.5 vs 13.5–15) and less time (91 s vs 139 s on the feature), at about 5–10 times the worker cost; either way the worker is the smaller part of the total (corrected 16 Oct: the worker column here is from the transcripts, which record a worker's output as each response began; counted in full, a Sonnet worker came to 15–23% of a run's cost; the totals are Claude Code's own and stand). Given the choice in I, Opus sent the rename to Haiku and the feature and tests to Sonnet.

**LSP.** In all runs neither Opus nor any worker called the LSP tool; they used grep, and once an AST script. The language server answered only delegate's own blast-radius step. With the nudge (N), 8 notes named the exact LSP call and Opus followed none. Quality held, and the cost did not rise.

## Bugs the runs found, all fixed

- **Missed edits.** The diff missed edits made with sed or `git mv`. It now comes from git, against a snapshot taken when the hand-off starts.
- **Anchoring on keywords.** A `file:line` focus on an import line anchored on the word `from`, and a text search then reported 2,290 "references". The anchor is now what the line imports, never a keyword, and a text search past 200 hits counts as too common to trace.
- **Cold language server.** The first LSP call of a session can come back before the server has indexed. The mod now retries for up to nine seconds.
- **Waiting cost requests.** A hand-off that only answered by message cost Opus at least two extra requests. The default is now to wait inside the tool call, and Opus can still pass `background` to work in parallel.
- **Forked reviews.** Forks paid the conversation again, uncached. Inline review is the default.
- **Grader.** The t5 grader counted class names in prose. One correct answer read as 0.74 until the grader was fixed to read list lines only.

## Verdict

Worth it for fully specified, multi-step work whose result a diff and a check can prove, and most in a long session: there the same quality comes at a third to two thirds of the cost. Not worth it for lookups and tracing in a fresh session. And it does not happen by itself: Opus never chose to delegate. Routing has to come from a rule, a command, or the person.

## Limits

- Two runs per cell.
- One repository.
- Tasks easy enough that every setup scored 100%.
- Large sessions are projected from request counts, not run.
- The mod changed between setups (each setup names its version above).

Files: `bench.py` (harness, graders, pricing), `hidden/` (the feature task's hidden tests), `results.jsonl` (every run: answer, grade, frozen cost), `report.txt` (the full table).
