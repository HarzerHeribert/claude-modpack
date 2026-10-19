#!/usr/bin/env python3
"""PREPP against PREP by the five criteria in PREPP-confirm.md: python3 prune_confirm.py"""
import json, random, statistics as st
from pathlib import Path

HERE = Path(__file__).parent
CONV = {"m1-helper": ["versionadded", "show_default", "changes_entry", "compat_untouched"]}  # m2-fix: its whole grade
SEEN = {"m1-helper": {"option_behaviour"}, "t2-rename": {"no_old_name", "old_name_gone"}}


def rows(name, arm):
    out = [json.loads(l) for l in (HERE / name).open() if l.strip()]
    return [r for r in out if r["arm"] == arm and not r.get("is_error")]


def usd(r):
    c = r.get("cost") or {}
    return (c.get("main_usd") or 0) + (c.get("worker_usd") or 0)


prep, prune = rows("results-prep.jsonl", "PREP"), rows("results-prep-prune-confirm.jsonl", "PREPP")
tasks = sorted({r["task"] for r in prep})
full = sum(r["grade"]["score"] >= 1 for r in prune)
print(f"1. full marks: PREPP {full} of {len(prune)} against PREP {sum(r['grade']['score'] >= 1 for r in prep)} of {len(prep)}: {'pass' if full >= 16 and len(prune) == 18 else 'FAIL'}")
conv_miss = [(r["task"], c) for r in prune for c in CONV.get(r["task"], []) if not r["grade"]["checks"].get(c)]
conv_miss += [("m2-fix", "score") for r in prune if r["task"] == "m2-fix" and r["grade"]["score"] < 1]
print(f"2. checks that need the conversation: {'pass' if not conv_miss else 'FAIL ' + str(conv_miss)}")
seen = {t: set(SEEN.get(t, set())) for t in tasks}
for r in rows("results-prep.jsonl", "PREP") + rows("results-prep.jsonl", "COMPACT"):
    seen[r["task"]] |= set(r["grade"].get("failed") or [])
new = [(r["task"], f) for r in prune for f in (r["grade"].get("failed") or []) if f not in seen[r["task"]]]
print(f"3. no new kind of miss: {'pass' if not new else 'FAIL ' + str(new)}")


def mean_change(a, b):
    return st.mean((st.mean(map(usd, b[t])) - st.mean(map(usd, a[t]))) / st.mean(map(usd, a[t])) for t in tasks)


A = {t: [r for r in prep if r["task"] == t] for t in tasks}
B = {t: [r for r in prune if r["task"] == t] for t in tasks}
eff = mean_change(A, B)
rnd = random.Random(7)
boots = sorted(mean_change({t: rnd.choices(A[t], k=len(A[t])) for t in tasks}, {t: rnd.choices(B[t], k=len(B[t])) for t in tasks}) for _ in range(10000))
lo, hi = boots[250], boots[9749]
print(f"4. next task's cost: {eff:+.1%} [{lo:+.1%}, {hi:+.1%}]: {'pass' if hi < 0.05 else 'FAIL'}")
every = [json.loads(l) for l in (HERE / "results-prep-prune-confirm.jsonl").open() if l.strip()]
rejected = [r for r in every if str(r.get("error", "")).startswith("not used:")]
print(f"5. the mod's check rejected {len(rejected)} of {len(prune) + len(rejected)} summaries: {'pass' if len(rejected) <= 1 else 'FAIL'}")
print("\ntask         PREP $   PREPP $  PREP chars  PREPP chars  PREPP scores")
for t in tasks:
    print(f"{t:12} {st.mean(map(usd, A[t])):.3f}    {st.mean(map(usd, B[t])):.3f}   {st.mean(r.get('summary_chars') or 0 for r in A[t]):>8.0f}  {st.mean(r.get('summary_chars') or 0 for r in B[t]):>9.0f}    {[round(r['grade']['score'], 2) for r in B[t]]}")
print(f"\ncontext at the next task's first request: PREP {st.mean(r.get('context_first_request') or 0 for r in prep):,.0f}, PREPP {st.mean(r.get('context_first_request') or 0 for r in prune):,.0f}")
print(f"summary written: PREP ${st.mean(r.get('summary_usd') or 0 for r in prep):.3f}, PREPP ${st.mean(r.get('summary_usd') or 0 for r in prune):.3f} (cold-cache runs included)")
