# Worker costs, corrected (16 Oct 2026)

Every published number that included a worker's or a subagent's cost was too low. This file says what was wrong, how it was fixed, and lists each claim with its old and its new value.

## What was wrong

A subagent's transcript (delegate's workers and the Agent tool's subagents alike) records each request's output tokens as the response began: 2 to 25 tokens, not the count it ended with. The main loop's transcript records them in full. The bench priced every run from the transcripts (`main_usd + worker_usd + review_usd`), so every worker's output was missing, and every hand-off came out cheaper than it was.

Claude Code's own total for each run (`reported_usd`, kept in every row) counts everything. In every fresh run without a worker it equals the counted cost; with workers it was higher by 0.4% to 14% per arm: about 1% where every worker was Haiku (whose output costs little), 6% to 14% where they were Sonnet, in between where both ran. Checked on 16 Oct: cache reads and writes over all transcripts match Claude Code's own per-model count (`modelUsage`) to the token, and the output is short by exactly the subagents'. Found while measuring subagents (`results-subagent.jsonl`, whose runs are priced in full).

## How it is fixed

- **New runs:** `bench.py`'s `settle()` prices the output the subagent transcripts left out from `modelUsage`, into `worker_usd`; `worker_usd_transcript` keeps the transcripts' figure.
- **Fresh runs recorded before:** `carry.py` adds Claude Code's total less the counted cost (`unrecorded()`), 0 in every run without a worker.
- **Long runs:** a long run's reported total also includes the session it forked. That session costs the same in every run forked from it: in each long batch, reported less counted is one figure, the same to ten decimal places, across all runs without a worker ($1.9675 for the 233k-token session of the HL runs, $1.9143 for the 219k one, $3.5037 for the docs session). `carry.py` now takes that figure off as well, so a long run's missing worker output is worked out the same way as a fresh run's.
- **A check from the transcripts' own content:** the output a worker transcript does hold (its text and tool inputs, at 152 + characters / 2.27 tokens per response, fitted on 308 main-loop responses without a thinking block, whose output is recorded in full), priced at the worker's output price, comes to 102% to 129% of the figure from Claude Code's totals in the fresh batches, where that figure is exact, and 117% to 120% in the long ones. The content estimate runs high by the same margin in both, so the long figures stand on the same footing as the fresh ones. Thinking is not in the transcripts, so content alone cannot give the figure.
- **charts.py** counts the same way. RESULTS.md's totals were Claude Code's own and stand; its worker column came from the transcripts, and counted in full a Sonnet worker was 15–23% of a run's cost there.
- **Unchanged, because no worker ran:** the pack against plain Claude Code, the ablation, lsp-plus, seek, Trail-Code, the borrowed ideas, SWE-bench (priced from Claude Code's totals), `implement_spec` (0 hand-offs). pathfinder's one hand-off moved its arm by $0.0008: −3.4% [−11.3, +5.1] as before.

## Each claim, old and new

Effects are the average task's change in cost (each task weighs the same), with a 95% bootstrap interval over runs within tasks, as `carry.py` computes it at `--later 0`. Old: as published. n: runs per arm, baseline/changed. Every run was correct, before and after.

### An order to hand off after an approved plan (`afterPlan`)

Z (the pack, Opus alone) from `results-ablation.jsonl` against MO from `results-delegation-ideas.jsonl`, fresh, 13 Oct. Published in SUITE.md, README (honest numbers, delegate, the delegate chart, the animated numbers), CHANGELOG 0.3.0, lab notes 2.

| Claim | Old | New | n |
| --- | --- | --- | --- |
| A feature | −27% ($0.586 → $0.426) | **−22.4%** [−33.0%, −10.9%] ($0.455) | 4/4 |
| Tests to a coverage target | −33% ($0.593 → $0.397) | **−26.3%** [−36.1%, −11.2%] ($0.438) | 4/4 |
| Both | 27–33% less | 22–26% less; together −24.3% [−31.7%, −15.3%] | 8/8 |

### Handed off in a 233k-token session (HL against PL)

`results-suite-long.jsonl`, 13 Oct. SUITE.md, lab notes 5, the graveyard. The missing worker output worked out from Claude Code's totals less the forked session (above).

| Task | Old | New | n |
| --- | --- | --- | --- |
| l1-feature | −37% ($0.52) | **−34.9%** [−48.7%, −13.7%] ($0.54) | 2/2 |
| l2-coverage | −27% ($0.53) | **−22.8%** [−39.0%, −6.3%] ($0.57) | 2/2 |
| t2-rename | +43% | +43.0% [+0.8%, +87.5%] | 2/2 |
| t3-explain | +101% | +103.0% [+81.5%, +130.1%] | 2/2 |
| t1-trace | +29% | +30.2% [+17.3%, +44.1%] | 2/2 |
| t5-types | +259% | +261.4% [+252.3%, +270.9%] | 2/2 |
| t4-lookup | +149% (2.5 times) | +150.0% [+135.6%, +165.2%] (2.5 times) | 2/2 |
| "up to 3.6 times as much" | 3.6 | 3.6 | |

### Ranges quoted from these

| Claim | Where | Old | New |
| --- | --- | --- | --- |
| "120 Opus runs": a feature or tests handed off | README (delegate) | 27–37% less | 23–35% less (fresh, RESULTS.md: 35% and 28%, unchanged; long: 35% and 23%) |
| "An order the mod gives" | README (delegate), CHANGELOG 0.3.0 | 27–33% less | 22–26% less |
| "a feature cost … less" | lab notes 2 | 27–37% | 22–35% |
| "where a hand-off pays" | lab notes 7 | 27–37% on features and tests | 22–35% |

### Read-only hand-offs ordered on small work (HF, fresh)

Z from `results-ablation.jsonl` against HF from `results-explore-off-fresh.jsonl`, 13 Oct. SUITE.md, lab notes 5, the graveyard. 8 hand-offs in 12 runs; the explanation had none (−5.0%, unchanged).

| Task | Old | New | n |
| --- | --- | --- | --- |
| t5-types | +13% | +16.6% [+7.5%, +26.9%] | 6/3 |
| t4-lookup | +19% | +19.1% [+3.3%, +29.9%] | 6/3 |
| t1-trace | +33% | +40.3% [+26.9%, +52.2%] | 6/3 |
| The range | +13% to +33% | **+17% to +40%** | |

### Which worker for which kind of work (wk-…)

Z from `results-ablation.jsonl` against `results-workers.jsonl`, fresh, 13 Oct. SUITE.md.

| Kind, task | Worker | Old | New | n |
| --- | --- | --- | --- | --- |
| build, l1-feature | Haiku low | −34% | −33.6% [−50.7%, −9.4%] | 4/3 |
| build, l1-feature | Sonnet low | −20% | **−15.5% [−32.3%, +3.6%]** | 4/3 |
| build, l1-feature | Sonnet medium | −32% | −26.1% [−41.4%, −6.7%] | 4/3 |
| build, l1-feature | Sonnet | −35% | −29.0% [−39.5%, −16.9%] | 4/3 |
| build, l2-coverage | Haiku low | −45% | −43.9% [−52.2%, −31.5%] | 4/3 |
| build, l2-coverage | Sonnet low | −39% | −31.0% [−39.7%, −18.8%] | 4/3 |
| build, l2-coverage | Sonnet medium | −42% | −35.2% [−43.5%, −22.8%] | 4/3 |
| build, l2-coverage | Sonnet | −35% | −27.8% [−37.0%, −14.7%] | 4/3 |
| mechanical, t2-rename | Haiku low | +37% | +37.3% [+26.6%, +48.8%] | 4/3 |
| mechanical, t2-rename | Haiku | +55% | +56.0% [+42.9%, +69.1%] | 4/3 |
| mechanical, t2-rename | Sonnet low | +52% | +55.5% [+36.3%, +78.4%] | 4/3 |
| read, t1-trace | Haiku low | +5% | +5.6% [+1.5%, +10.5%] | 6/2 |
| read, t1-trace | Sonnet low | +6% | +15.2% [+6.5%, +24.4%] | 6/2 |
| read, t5-types | Haiku low | +1% | +1.5% [−4.3%, +7.7%] | 6/2 |
| read, t5-types | Sonnet low | +11% | +21.6% [+16.3%, +27.5%] | 6/2 |
| The worker's own cost, at most | | $0.08 | $0.12 | |
| Sonnet medium behind Haiku low on the two build tasks | | three points | eight points: −30.7% [−39.7%, −19.5%] against −38.8% [−49.2%, −25.7%] | 8/6 |

### route 0.1 on click's eight jobs (RT)

RT from `results-route.jsonl` against the pack (Z) from `results-trail.jsonl` and plain (V) from `results-v-1015.jsonl`, 15 Oct. Lab notes 7 and 9, the lab notes' index, README (route), CHANGELOG 0.5.0.

| Claim | Old | New | n |
| --- | --- | --- | --- |
| Against the pack, all eight | −17.0% [−20.5%, −13.1%] | **−14.2%** [−17.9%, −10.1%] | 32/32 |
| Against plain Claude Code | −21.7% [−24.9%, −18.2%] | **−19.1%** [−22.5%, −15.3%] | 32/32 |
| The two routed tasks | −39.6% [−44.8%, −33.7%] | **−33.8%** [−39.4%, −27.4%] | 8/8 |
| The feature | $0.61 → $0.41 | $0.61 → $0.45, −27.1% [−35.5%, −16.8%] | 4/4 |
| The coverage task | $0.67 → $0.36 | $0.67 → $0.41, −39.9% [−46.7%, −31.0%] | 4/4 |
| The six others (no hand-off) | +4.3% | +4.3%, unchanged | 24/24 |

### The verified hand-off, handed over before reading (RT, RTV, RTD)

`results-route-verify.jsonl`, 15 Oct: `carry.py RT RTV,RTD`. Lab notes 10, README (route).

| Claim | Old | New | n |
| --- | --- | --- | --- |
| Cost per job: RT, RTV, RTD | $0.50, $0.44, $0.34 | $0.53, $0.47, $0.38 | 8 each |
| RTD against RT | −33% [−47%, −13%] | **−27.8%** [−41.6%, −10.3%] | 8/8 |
| RTV against RT (not published) | −12.4% | −11.5% [−32.1%, +14.8%] | 8/8 |

### TypeScript, against the pack alone (Z, RTD with a Sonnet worker, RTDH with Haiku)

Tests: `results-ts-route.jsonl` (ts-l2-coverage); the feature: `results-ts-route-jev.jsonl`; 15 Oct. Lab notes 10, README, CHANGELOG 0.6.0.

| Claim | Old | New | n |
| --- | --- | --- | --- |
| A feature, Sonnet worker | −57% ($0.43) | **−51.4%** [−55.0%, −47.8%] ($0.48) | 4/4 |
| A feature, Haiku worker | $0.44 | −55.4% [−63.0%, −47.9%] ($0.44) | 4/4 |
| Writing tests, Sonnet worker | −40% ($0.27) | **−36.1%** [−42.5%, −30.7%] ($0.29) | 4/4 |
| Writing tests, Haiku worker | −47% ($0.24) | −46.3% [−51.6%, −41.9%] ($0.24) | 4/4 |
| Haiku against Sonnet, the feature | "cost the same" (+2.0%) | −8.3% [−23.9%, +7.5%] | 4/4 |
| Haiku against Sonnet, the tests | "a little cheaper" (−11.6%) | −16.0% [−17.5%, −14.4%] | 4/4 |

### A read hand-off checked place by place (PLACES)

Z from `results-read-hf.jsonl` against HF from `results-read-hfv.jsonl` (click and chrono, trace and type search; both files stay in the lab), 15 Oct. README (delegate), CHANGELOG 0.6.0.

| Claim | Old | New | n |
| --- | --- | --- | --- |
| Against Claude doing the lookup itself | +4% (+3.7% [−1.2%, +9.5%]) | **+4.7%** [−0.2%, +10.5%] | 16/16 |

## Conclusions that moved

- **Every saving still holds**, smaller: each interval that was clear of zero still is, with one exception, Sonnet at low effort on the click feature, now −15.5% [−32.3%, +3.6%].
- **Haiku against Sonnet as the build worker.** On cost, Haiku is now ahead on both features: on click −34% against −26% at Sonnet medium, on TypeScript $0.44 against $0.48 (−8%, within the runs' spread), where it was "the same". Sonnet stays the build default for what cost does not show: on the TypeScript feature Haiku took twice the steps and 42% more time, and twice left points open that Claude had to settle.
- **The worker is a bigger share of a hand-off** than the bench said: up to $0.12 (was $0.08), and a Sonnet worker's work moved a run's total by 4 to 10 points. "The setup moves the total by a few points" no longer holds: up to 18.
- **Small work handed off costs more than measured:** ordered hand-offs of lookups and traces +17% to +40% (was +13% to +33%); Sonnet at low effort on read tasks +15% and +22% (was +6% and +11%).
- **A read hand-off with PLACES** is +5%: still a safety net, not a saving, and still not clearly dearer.

## Reproduce

```sh
python3 -I carry.py Z MO results-ablation.jsonl results-delegation-ideas.jsonl --tasks l1-feature --later 0
python3 -I carry.py PL HL results-suite-long.jsonl --tasks l1-feature --later 0
python3 -I carry.py Z wk-sonnet-medium results-ablation.jsonl results-workers.jsonl --tasks l1-feature --later 0
python3 -I carry.py Z RT results-trail.jsonl results-route.jsonl --later 0
python3 -I carry.py RT RTV,RTD results-route-verify.jsonl --later 0
python3 -I carry.py Z RTD,RTDH results-ts-route-jev.jsonl --later 0
```

The same with any other arm, task or file above; `--tasks` picks a task, and without it every task both arms ran counts. For the PLACES row, keep the Z rows of `results-read-hf.jsonl` and the HF rows of `results-read-hfv.jsonl` (both files hold an HF arm). Intervals move by a tenth of a point or so with the arms resampled beside.
