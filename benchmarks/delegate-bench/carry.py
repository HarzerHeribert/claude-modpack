"""Cost with what a run leaves behind. A bench run ends after its task, so what the task added to the context is never
re-read; in the person's sessions every later request re-reads it until compaction (a median of 143 later requests in
interactive sessions, 22 headless; pilot/explore-mining round 3). This prices it: added_context (recorded per run by
bench.py's account()) x LATER x the cache read price, beside the run's own cost. An arm that saves requests by adding
context (seek 0.2's windows) looks better without it; one that keeps exploration out of the context, better with it.

Per task: cost, main requests and added context per arm; then the average task's change against BASE (every task
weighs the same), with a 95% bootstrap interval over runs within tasks, at 0 and at LATER later requests.

  python3 -I carry.py BASE ARM[,ARM...] results-a.jsonl [results-b.jsonl ...] [--later 140] [--warm] [--tasks t1,t2]

--warm keeps warm runs only: a long run whose first request read under 100k tokens from the cache began cold (its
fork was idle over an hour), a fresh run under 5k.
"""
import argparse
import json
import random
import statistics as st

READ = 0.20 / 1e6  # Opus cache read, $ per token (bench.py PRICES)

ap = argparse.ArgumentParser()
ap.add_argument("base")
ap.add_argument("arms")
ap.add_argument("files", nargs="+")
ap.add_argument("--later", type=int, default=140)
ap.add_argument("--warm", action="store_true")
ap.add_argument("--tasks", default="")
a = ap.parse_args()
arms = [a.base] + [x for x in a.arms.split(",") if x and x != a.base]

rows = [dict(json.loads(l), _file=f) for f in a.files for l in open(f) if l.strip()]
rows = [r for r in rows if r.get("cost", {}).get("found")]


def counted(r):
    c = r["cost"]
    return c["main_usd"] + c["worker_usd"] + c.get("review_usd", 0)


# A long run's reported total includes the session it forked, and that costs the same in every run forked from it: in a
# file's runs of one prepared session without subagents, reported less counted is one figure (checked 16 Oct: the same
# to ten decimal places in every long batch). Taken from that figure, a long run's reported total less its counted cost is what its
# subagents' transcripts left out, as for a fresh run.
_forks: dict = {}
for r in rows:
    if r.get("long") and r.get("reported_usd") is not None and not r["cost"].get("worker_requests"):
        _forks.setdefault((r["_file"], r.get("prepared")), []).append(r["reported_usd"] - counted(r))
FORKED = {k: v[0] for k, v in _forks.items() if max(v) - min(v) < 1e-6}
rows = [r for r in rows if r["arm"] in arms]


def cold(r):
    return r["cost"].get("first_cache_read", 0) < (100_000 if r.get("long") else 5_000)


if a.warm:
    rows = [r for r in rows if not cold(r)]
if a.tasks:
    rows = [r for r in rows if r["task"] in a.tasks.split(",")]


def unrecorded(r):
    """The subagents' output their transcripts left out (bench.py settle()), for a row recorded before settle() existed:
    Claude Code's total less the counted cost (0 in every run without subagents), and for a long run less the session it
    forked too (FORKED; none where that figure is not known). Rows settled already hold it in worker_usd."""
    c = r["cost"]
    if "unrecorded_usd" in c or r.get("reported_usd") is None or not c.get("worker_requests"):
        return 0.0
    if r.get("long"):
        forked = FORKED.get((r["_file"], r.get("prepared")))
        return 0.0 if forked is None else max(0.0, r["reported_usd"] - counted(r) - forked)
    return max(0.0, r["reported_usd"] - counted(r))


def usd(r, later=0):
    # Only the main's added context carries: a subagent's context ends with it, and what it handed back is in the main's.
    return counted(r) + unrecorded(r) + max(0, r["cost"].get("added_context", 0)) * later * READ


tasks = sorted({r["task"] for r in rows if all(any(x["task"] == r["task"] and x["arm"] == arm for x in rows) for arm in arms)})
cell = {(t, arm): [r for r in rows if r["task"] == t and r["arm"] == arm] for t in tasks for arm in arms}
print(f"{len(rows)} runs{' (warm only)' if a.warm else ''}; not full marks: {[r['run'] for r in rows if r['grade']['score'] < 0.999]}")
print(f"tasks every arm ran: {', '.join(tasks) or 'none'}\n")
print(f"{'task':16}" + "".join(f"{arm:>36}" for arm in arms))
for t in tasks:
    line = f"{t:16}"
    for arm in arms:
        rs = cell[(t, arm)]
        line += f"{'$%.3f · %.1f req · +%.1fk ctx (n%d)' % (st.mean(map(usd, rs)), st.mean(r['cost']['main_requests'] for r in rs), st.mean(r['cost'].get('added_context', 0) for r in rs) / 1000, len(rs)):>36}"
    print(line)


def avg_task(sample, later):
    return st.mean(st.mean(usd(r, later) for r in rs) for rs in sample)


rng = random.Random(7)
for later in (0, a.later):
    print(f"\naverage task against {a.base}, carry over {later} later requests:")
    base = avg_task([cell[(t, a.base)] for t in tasks], later) if tasks else float("nan")
    for arm in arms:
        v = avg_task([cell[(t, arm)] for t in tasks], later) if tasks else float("nan")
        if arm == a.base:
            print(f"  {arm:8} ${v:.3f}")
            continue
        diffs = []
        for _ in range(4000):
            bb = avg_task([[rng.choice(cell[(t, a.base)]) for _ in cell[(t, a.base)]] for t in tasks], later)
            ba = avg_task([[rng.choice(cell[(t, arm)]) for _ in cell[(t, arm)]] for t in tasks], later)
            diffs.append(ba / bb - 1)
        diffs.sort()
        lo, hi = diffs[int(0.025 * len(diffs))], diffs[int(0.975 * len(diffs))]
        print(f"  {arm:8} ${v:.3f}   {v / base - 1:+.1%}  [{lo:+.1%}, {hi:+.1%}]")
