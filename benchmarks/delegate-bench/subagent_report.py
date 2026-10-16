"""The subagent arms (SA-off, SA-on in bench.py): did cells' and seek's text reach every subagent of the "on" arm and
none of the "off" arm, what the subagents did, and what the runs cost.

Per task and arm: runs, grade, cost (main + subagents), main requests, subagent requests and cost, and per subagent its
Bash calls (chained: several commands joined with ;, && or ||, or on several lines; a leading `cd dir &&` not counted),
run_cell calls, Reads and searches. Then the average task's change of SA-on against SA-off (every task weighs the same),
with a 95% bootstrap interval over runs within tasks, for the run's cost, the subagent's cost and its requests.

  python3 -I subagent_report.py results-subagent.jsonl [--recount]

--recount prices each run again from its transcripts where they are still on this machine (bench.account). Every run's
cost is completed by bench.settle(): a subagent transcript records its output tokens as each response began, so the
output it left out is priced from Claude Code's own count (modelUsage, or reported_usd less the counted cost).
"""
import json
import random
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bench  # noqa: E402

ARMS = ["SA-off", "SA-on"]
path = sys.argv[1]
rows = [json.loads(l) for l in open(path) if l.strip()]
rows = [r for r in rows if r["arm"] in ARMS]
for r in rows:
    if "--recount" in sys.argv and r.get("session"):
        c = bench.account(r["session"])
        if c.get("found"):
            r["cost"] = c
    # The subagent's output its transcript left out, priced from Claude Code's own count (bench.settle()).
    if r.get("cost", {}).get("found"):
        bench.settle(r["cost"], r.get("model_usage"), r.get("reported_usd"))
rows = [r for r in rows if r.get("cost", {}).get("found")]


def usd(r):
    c = r["cost"]
    return c["main_usd"] + c["worker_usd"] + c.get("review_usd", 0)


def subs(r):
    return r["cost"].get("subagents", [])


def gp(r):
    return [s for s in subs(r) if s["type"] == "general-purpose"]


print(f"{len(rows)} runs; not full marks: {[r['run'] for r in rows if r['grade']['score'] < 0.999]}")
print(f"cold starts (first request read < 5k from cache): {[r['run'] for r in rows if r['cost'].get('first_cache_read', 0) < 5000]}")

# Did every run go through one general-purpose subagent, and did the text reach it?
for arm in ARMS:
    rs = [r for r in rows if r["arm"] == arm]
    n_sub = [len(subs(r)) for r in rs]
    all_subs = [s for r in rs for s in subs(r)]
    print(f"\n{arm}: {len(rs)} runs, subagents per run {sorted(set(n_sub))}, types {sorted({s['type'] for s in all_subs})}, "
          f"Agent calls in main {sorted({r['cost'].get('agents', 0) for r in rs})}, main edits/reads: main tools {st.mean(r['cost'].get('main_tools', 0) for r in rs):.1f}")
    print(f"  text reached: block {sum(s['settings'] for s in all_subs)}/{len(all_subs)}, cells line {sum(s['cells_line'] for s in all_subs)}, "
          f"run_cell line {sum(s['run_cell_line'] for s in all_subs)}, seek line {sum(s['seek_line'] for s in all_subs)}")
    no_sub = [r["run"] for r in rs if not gp(r)]
    if no_sub:
        print(f"  runs without a general-purpose subagent: {no_sub}")
    rep = [r for r in rs if r.get("reported_usd")]
    if rep:
        print(f"  reported by Claude Code ${st.mean(r['reported_usd'] for r in rep):.3f}; counted from the transcripts "
              f"${st.mean(usd(r) - r['cost'].get('unrecorded_usd', 0) for r in rep):.3f}, of which subagents ${st.mean(r['cost'].get('subagent_usd_transcript', 0) for r in rep):.3f}; "
              f"their unrecorded output {st.mean(r['cost'].get('unrecorded_output_tokens', 0) for r in rep):.0f} tokens, ${st.mean(r['cost'].get('unrecorded_usd', 0) for r in rep):.3f}; "
              f"counted in full ${st.mean(usd(r) for r in rep):.3f}")

tasks = sorted({r["task"] for r in rows if all(any(x["task"] == r["task"] and x["arm"] == a for x in rows) for a in ARMS)})
cell = {(t, a): [r for r in rows if r["task"] == t and r["arm"] == a] for t in tasks for a in ARMS}

print(f"\n{'task':15} {'arm':6} {'n':>2} {'grade':>5} {'run $':>7} {'main req':>8} {'sub req':>7} {'sub $':>6} "
      f"{'bash':>5} {'chained':>7} {'run_cell':>8} {'reads':>5} {'search':>6} {'wall s':>6}")
for t in tasks:
    for a in ARMS:
        rs = cell[(t, a)]
        ss = [s for r in rs for s in gp(r)]
        m = lambda f: st.mean(f(s) for s in ss) if ss else float("nan")
        print(f"{t:15} {a:6} {len(rs):>2} {st.mean(r['grade']['score'] for r in rs):>5.2f} {st.mean(map(usd, rs)):>7.3f} "
              f"{st.mean(r['cost']['main_requests'] for r in rs):>8.1f} {st.mean(r['cost'].get('subagent_requests', 0) for r in rs):>7.1f} "
              f"{st.mean(r['cost'].get('subagent_usd', 0) for r in rs):>6.3f} {m(lambda s: s['bash']):>5.1f} {m(lambda s: s['bash_chained']):>7.1f} "
              f"{m(lambda s: s['run_cell']):>8.1f} {m(lambda s: s['reads']):>5.1f} {m(lambda s: s['searches']):>6.1f} {st.mean(r['wall_s'] for r in rs):>6.0f}")

# All tasks together, per subagent.
print()
for a in ARMS:
    ss = [s for r in rows if r["arm"] == a for s in gp(r)]
    bash = sum(s["bash"] for s in ss)
    print(f"{a}: {len(ss)} subagents; per subagent {st.mean(s['requests'] for s in ss):.1f} requests, {bash / len(ss):.1f} Bash "
          f"({sum(s['bash_chained'] for s in ss) / max(bash, 1):.0%} chained), {st.mean(s['run_cell'] for s in ss):.1f} run_cell "
          f"(in {sum(1 for s in ss if s['run_cell'])} of {len(ss)}), {st.mean(s['reads'] for s in ss):.1f} Read, {st.mean(s['searches'] for s in ss):.1f} Grep/Glob, "
          f"{st.mean(s['tools'] for s in ss):.1f} tool calls")


def avg_task(sample, f):
    return st.mean(st.mean(f(r) for r in rs) for rs in sample)


measures = {
    "run cost (main + subagent)": usd,
    "subagent cost": lambda r: r["cost"].get("subagent_usd", 0),
    "subagent requests": lambda r: r["cost"].get("subagent_requests", 0),
    "main requests": lambda r: r["cost"]["main_requests"],
}
groups = {"all tasks": tasks, "click": [t for t in tasks if not t.startswith("ts-")], "TypeScript": [t for t in tasks if t.startswith("ts-")],
          "explain": [t for t in tasks if "explain" in t], "edit": [t for t in tasks if "explain" not in t]}
rng = random.Random(7)
for gname, ts in groups.items():
    if not ts:
        continue
    print(f"\naverage task, SA-on against SA-off, {gname} ({', '.join(ts)}):")
    for name, f in measures.items():
        off = avg_task([cell[(t, "SA-off")] for t in ts], f)
        on = avg_task([cell[(t, "SA-on")] for t in ts], f)
        diffs = []
        for _ in range(4000):
            bo = avg_task([[rng.choice(cell[(t, "SA-off")]) for _ in cell[(t, "SA-off")]] for t in ts], f)
            bn = avg_task([[rng.choice(cell[(t, "SA-on")]) for _ in cell[(t, "SA-on")]] for t in ts], f)
            diffs.append(bn / bo - 1)
        diffs.sort()
        lo, hi = diffs[int(0.025 * len(diffs))], diffs[int(0.975 * len(diffs))]
        print(f"  {name:28} {off:8.3f} -> {on:8.3f}   {on / off - 1:+.1%}  [{lo:+.1%}, {hi:+.1%}]")
