"""The ablation: per task and arm, then the average task with a bootstrap interval against V.

  python3 -I analyze_ablation.py results-ablation.jsonl [--warm]
"""
import json
import random
import statistics as st
import sys

ARMS = ["V", "Z", "Z-cells", "Z-lsp"]
path = sys.argv[1]
warm_only = "--warm" in sys.argv
rows = [json.loads(l) for l in open(path) if l.strip()]
rows = [r for r in rows if r.get("cost", {}).get("found")]


def usd(r):
    c = r["cost"]
    return c["main_usd"] + c["worker_usd"]


def cold(r):
    return r["cost"].get("first_cache_read", 0) < 5000


if warm_only:
    rows = [r for r in rows if not cold(r)]

tasks = sorted({r["task"] for r in rows}, key=lambda t: (t[0] != "l", t != "t2-rename", t))
cell = {(t, a): [r for r in rows if r["task"] == t and r["arm"] == a] for t in tasks for a in ARMS}

print(f"{len(rows)} runs{' (warm only)' if warm_only else ''}; cold starts: {sum(cold(r) for r in rows)}; "
      f"not full marks: {[r['run'] for r in rows if r['grade']['score'] < 0.999]}\n")
print(f"{'task':12}" + "".join(f"{a:>24}" for a in ARMS))
for t in tasks:
    line = f"{t:12}"
    for a in ARMS:
        rs = cell[(t, a)]
        if not rs:
            line += f"{'-':>24}"
            continue
        line += f"{'$%.2f · %.1f req (n%d)' % (st.mean(map(usd, rs)), st.mean(r['cost']['main_requests'] for r in rs), len(rs)):>24}"
    print(line)


def avg_task(sample):
    # The mean over tasks of each task's mean cost: every task weighs the same, however many runs it has.
    return st.mean(st.mean(map(usd, rs)) for rs in sample)


def requests(sample):
    return st.mean(st.mean(r["cost"]["main_requests"] for r in rs) for rs in sample)


groups = {"all tasks": tasks, "multi-step": [t for t in tasks if t in ("l1-feature", "l2-coverage", "t2-rename")],
          "small": [t for t in tasks if t not in ("l1-feature", "l2-coverage", "t2-rename")]}
rng = random.Random(7)
for name, ts in groups.items():
    if not ts or not all(cell[(t, a)] for t in ts for a in ARMS):
        continue
    print(f"\n{name}: average task cost · requests, and the change against V with a 95% bootstrap interval")
    base = avg_task([cell[(t, "V")] for t in ts])
    for a in ARMS:
        v = avg_task([cell[(t, a)] for t in ts])
        req = requests([cell[(t, a)] for t in ts])
        if a == "V":
            print(f"  {a:8} ${v:.3f} · {req:.1f} req")
            continue
        diffs = []
        for _ in range(4000):
            bv = avg_task([[rng.choice(cell[(t, "V")]) for _ in cell[(t, "V")]] for t in ts])
            ba = avg_task([[rng.choice(cell[(t, a)]) for _ in cell[(t, a)]] for t in ts])
            diffs.append(ba / bv - 1)
        diffs.sort()
        lo, hi = diffs[int(0.025 * len(diffs))], diffs[int(0.975 * len(diffs))]
        print(f"  {a:8} ${v:.3f} · {req:.1f} req   {v / base - 1:+.1%}  [{lo:+.1%}, {hi:+.1%}]")

# What each mod adds to the pack: Z against Z without it.
print("\nwhat removing a mod costs the pack (Z-x against Z), per task:")
for t in tasks:
    z = cell[(t, "Z")]
    if not z:
        continue
    parts = []
    for a in ("Z-cells", "Z-lsp"):
        rs = cell[(t, a)]
        if rs:
            parts.append(f"{a}: {st.mean(map(usd, rs)) / st.mean(map(usd, z)) - 1:+.0%} cost, "
                         f"{st.mean(r['cost']['main_requests'] for r in rs) - st.mean(r['cost']['main_requests'] for r in z):+.1f} req")
    print(f"  {t:12} " + "   ".join(parts))
