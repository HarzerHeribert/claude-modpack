# What a system prompt can order

*Lab notes 16 · 19 Oct 2026 · written by Claude from this repository's data*

Every order this lab gave that Claude followed came beside the person's prompt ([note 11](11-what-looking-around-leaves-behind.md#where-an-instruction-has-to-ride)). The one place we had not tried with care was the system prompt, which Claude reads before anything else, on every request. A mod can add sections to it, so we wrote one, steer, with two short sections: how to work toward the person's goal and what done means, and which steps pay with the pack's tools. Before a full benchmark we ran a smoke test. steer read the requests a little more closely, cost 9% more, and did not do either of the two things it asked for most plainly. It stays in the lab.

## The prompt Claude already has

Claude Code's own system prompt is lean, about 2.9k tokens; tool definitions and the skills list fill most of a session's fixed context. The pack already adds one section: cells' "Fewer round-trips", a paragraph and four lines on getting what you already know you need in one step, then a paragraph on when run_cell does it ([`guide.ts`](../cells/hooks/guide.ts)). Claude uses run_cell, so a system-prompt section is not always ignored. The question was whether a section could do more: make Claude read what the person is after, settle what done means, and reach for the pack's tools where they pay.

steer's two sections added about 680 tokens to a first request of about 26k. The first one asks for the method:

> For a request to change something, settle what done means before you start: the few things the result must do or show, each one you can check. When the request leaves room for doubt, name them in a line before you act, so the person can correct them cheaply.

and, before finishing, to check each of them against what was observed and say in a line which hold. The second lists the steps that pay: looking around in few steps, edits and their check in one run_cell, fully specified work (a feature from a clear spec, tests to a target) through hand_off, long jobs in the background with track_progress, and a word limit met in one draft.

## The smoke run

Five tasks, one from each of five task sets, one run each: a bug in a TypeScript web app (users can no longer delete their own comments), a new parameter type for click from a written spec (`click.Duration`), a trace through click's source, a 200-word brief, and a service whose config stops it starting. Three arms: **Z7W**, the pack as 0.8.0 ships it; **Z8S**, the same with steer; **Z8SX**, steer with seek's and draft's orders beside the prompt switched off, so the system prompt carries that guidance alone.

| Arm | Score | Cost | Requests | Output tokens | Added to the context | run_cell calls | Hand-offs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Z7W, the pack | 5 of 5 | $1.50 | 33 | 22.2k | 50.9k | 4 | 0 |
| Z8S, with steer | 5 of 5 | $1.63 (+9%) | 32 | 25.7k | 56.5k | 3 | 0 |
| Z8SX, steer without the prompt orders | 4.95 of 5 | $1.95 (+31%) | 35 | 30.7k | 80.5k | 6 | 0 |

| Task | Z7W | Z8S | Z8SX |
| --- | --- | --- | --- |
| The web app's bug | $0.30 | $0.29 | $0.49 |
| `click.Duration` | $0.42 | $0.51 | $0.60 |
| The trace | $0.14 | $0.18 | $0.18 |
| The 200-word brief | $0.42 | $0.43 | $0.44 |
| The service's config | $0.22 | $0.22 | $0.24 |

## What it changed

- **Longer answers.** The five answers came to 1,039 words with the pack, 1,139 with steer and 1,222 without the prompt orders; output rose 16% and 38%.
- **A closer reading, once.** On `click.Duration`, steer's answer checked its result against the request item by item, under "Checked against what you asked for", and listed choices the person might revisit: it had read "anything else fails" literally, so an integer is rejected rather than taken as seconds, and a test pins that down. The pack's answer to the same task listed two things it had added unasked. Without the prompt orders, the bug fix added a page-level test of what the user had reported and explained why the existing tests missed it (their users are admins); that run cost 64% more than the pack's.
- **Not what it asked for most plainly.** No run named what done means before it started: 0 of 10 runs with steer. One checked its result at the end, the feature above. The feature is the work steer's hand-off line describes, and neither steer run handed it off, as no run in the batch did.
- **No more cells.** run_cell came 4, 3 and 6 times. steer's line about it added nothing to what cells' own section already says.
- **The system prompt instead of the prompt cost the most.** Without seek's order, steer's own line about looking around in few steps was the only guidance left; the runs added 80.5k tokens to the context instead of 56.5k and cost 20% more than with the orders on. The brief left out one of its required action items and scored 0.95.

## Why the system prompt loses

The system prompt shapes how Claude works: what it checks, what it reports, how it writes. What it does not do is outvote the judgement Claude makes at the moment it picks a step. cells' section works because it points where Claude already wants to go: fewer round trips are fewer steps for Claude too. Handing off asks Claude to give up control of work it can do. hand_off's own description says to keep lookups, small edits and what depends on the conversation in house ([`register.tsx`](../delegate/hooks/register.tsx)), and no system-prompt sentence has moved Opus there ([note 2](02-notes-nobody-reads.md#174-runs-0-delegations): a routing rule in the system prompt, 14 runs, 0 hand-offs). Naming criteria before acting adds a step to a plan Claude already has. That is our reading; the counts are not:

| What | Where it rode | Followed |
| --- | --- | --- |
| route: hand this feature work to the worker | the person's prompt | 24 of 24 |
| seek: look around in few, lean steps | the person's prompt | 44 of 44 runs |
| steer: name what done means before you start | the system prompt | 0 of 10 runs |
| steer: hand fully specified work to the worker | the system prompt | 0 of 2 feature runs |
| pathfinder: hand the rest of this search off | Claude's own search, mid-way | 1 of 6 |

## What we decided

The system prompt stays lean. steer stays in the lab, and the 108-run benchmark planned behind it was not run: it would have measured a cost of about 9% for a closer reading the grading cannot see, while the two orders steer gave most plainly were not followed. What a person wants said on every request belongs beside the prompt, in the person's name, the way seek and draft say it.

## What this does not show

- **Five tasks, one run each.** That shows direction, not proof. With one run per task there is no range, and the +9% is not shown.
- **The grading cannot see intent.** Hidden tests and term lists say whether a result is right, not whether it is what the person meant. Every arm got full marks on four of the five tasks. "A closer reading" is our reading of ten answers.
- **Complete specifications.** Every bench prompt says exactly what it wants. Vague requests, where reading intent matters most, were not in this run. A smaller test of the first section alone on vague requests was planned and not run.

## Method & limits

Headless Claude Code, Claude Opus 5.5, one fresh copy of each repository per run, the person's installed plugins switched off ([note 8](08-our-plain-runs-were-not-plain.md)). Arms as in [`bench.py`](../benchmarks/delegate-bench/bench.py): Z7W is the 0.7.0 pack with draft; Z8S and Z8SX add steer, and Z8SX sets seek's and draft's `order` to off. Cost is Claude Code's own reported cost at list prices; requests, output and the context added are read from the transcripts. steer's source stays in the lab; its sections are quoted above. Data: `results-steer-smoke.jsonl`.
