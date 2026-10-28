"""Z9 against Z9H (28 Oct): cost, requests and marks per task, the average task with a bootstrap interval, and how
the runs changed files: by Edit or Write, inside a cell, or by a shell script.

  python3 -I automode_report.py results-automode.jsonl
"""
import glob
import json
import os
import random
import re
import statistics as st
import sys
from collections import Counter

ARMS = ["Z9", "Z9H"]
WRITES = re.compile(r"(\.write\(|open\([^)]*['\"][wa]['\"]|write_text\(|writeFileSync|\bsed -i|\bperl -[a-z0-9]*i|\bcat >|\btee \S)")
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows = [r for r in rows if r.get("cost", {}).get("found") and r["arm"] in ARMS]


def usd(r):
    return r["cost"]["main_usd"] + r["cost"]["worker_usd"]


def changes(session):
    """How a run changed files, counted per call: Edit/Write, a cell's edit()/write()/rename(), a shell script."""
    c = Counter()
    for f in glob.glob(os.path.expanduser(f"~/.claude/projects/*/{session}.jsonl")):
        text = open(f, errors="replace").read()
        c["line_seen"] += "With run_cell, several edits and their check" in text
        for line in text.splitlines():
            if '"tool_use"' not in line and "around the Edit tool" not in line:
                continue
            o = json.loads(line)
            if o.get("type") == "attachment" and re.search(r"cells: (this script rewrote|another script edit)", json.dumps(o.get("attachment", {}))):
                c["notes"] += 1
            if o.get("type") != "assistant":
                continue
            for b in o["message"].get("content") or []:
                if not isinstance(b, dict) or b.get("type") != "tool_use":
                    continue
                n, i = b["name"], b.get("input") or {}
                if n in ("Edit", "Write"):
                    c["tool"] += 1
                elif n.endswith("run_cell"):
                    k = len(re.findall(r"\b(?:edit|write|rename)\(", i.get("code", "")))
                    c["cell"] += k
                    c["cells"] += 1
                elif n == "Bash" and WRITES.search(i.get("command", "")):
                    c["script"] += 1
    return c


tasks = sorted({r["task"] for r in rows})
print(f"{len(rows)} runs; below full marks: {[(r['task'], r['arm'], r['grade']['score']) for r in rows if r['grade']['score'] < 0.999]}\n")
print(f"{'task':14}" + "".join(f"{a:>30}" for a in ARMS))
for t in tasks:
    line = f"{t:14}"
    for a in ARMS:
        rs = [r for r in rows if r["task"] == t and r["arm"] == a]
        line += f"{f'n={len(rs)} ${st.mean(map(usd, rs)):.3f} {st.mean(r["cost"]["main_requests"] for r in rs):.1f} req {st.mean(r["grade"]["score"] for r in rs):.2f}':>30}" if rs else f"{'-':>30}"
    print(line)


def avg(sample, a):
    return st.mean(st.mean(map(usd, sample[(t, a)])) for t in tasks)


cell = {(t, a): [r for r in rows if r["task"] == t and r["arm"] == a] for t in tasks for a in ARMS}
base, test = avg(cell, "Z9"), avg(cell, "Z9H")
random.seed(1)
boots = []
for _ in range(4000):
    s = {k: [random.choice(v) for _ in v] for k, v in cell.items() if v}
    boots.append(avg(s, "Z9H") / avg(s, "Z9") - 1)
boots.sort()
print(f"\naverage task: Z9 ${base:.3f}, Z9H ${test:.3f}: {100 * (test / base - 1):+.1f}% [{100 * boots[100]:+.1f}%, {100 * boots[3899]:+.1f}%]")
for a in ARMS:
    rs = [r for r in rows if r["arm"] == a]
    print(f"{a}: {st.mean(r['cost']['main_requests'] for r in rs):.2f} requests a run, marks {st.mean(r['grade']['score'] for r in rs):.3f}")

print("\nfile changes, all runs of an arm:")
for a in ARMS:
    c = Counter()
    for r in rows:
        if r["arm"] == a and r.get("session"):
            c.update(changes(r["session"]))
    total = c["tool"] + c["cell"] + c["script"]
    share = lambda k: f"{100 * c[k] / total:.0f}%" if total else "-"
    print(f"{a}: {total} changes: Edit/Write {c['tool']} ({share('tool')}), in cells {c['cell']} ({share('cell')}, {c['cells']} cells), "
          f"shell scripts {c['script']} ({share('script')}); cells' script-edit notes {c['notes']}; runs with the line {c['line_seen']}")
