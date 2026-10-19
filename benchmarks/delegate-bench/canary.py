"""Canary test: do facts said once in a Haiku session survive several compactions? (19 Oct)

Nine Haiku sessions on copies of click, side by side: three ways of compacting x three repeats.
  CC   Claude Code's own /compact (its summary written by the session's model, Haiku)
  SC   smart-compact's summary written ahead: a fork of the session answers its shipped SUMMARY_PROMPT, prep-mod installs it
       as smart-compact's hook does (compact_bench's PREP arm)
  SCL  as SC with the lean prompt (compact_bench.LEAN_PROMPT, the PREPL arm)
Each session works through the same script: six cycles of two reading prompts (nothing changed), then a compaction.
Canaries, made-up facts that are on no disk, ride along in the prompts of cycles 1-4. Once before the first compaction
and after every compaction, a fork of the session is asked about every canary planted so far, with its tools off; the
session itself never hears a question. Each summary is searched for the canaries too, to tell a summary that dropped
one from a model that had it and did not use it.

Pass rule, set before the run: SC answers >= 90% of the canaries right after compaction 6, never gives the superseded
port, invents no answer to the decoy, and does no worse than CC on any canary.

Pause: touch ~/.cache/claude-modpack-bench/canary/PAUSE. Each run holds before its next step and keeps its session's
cache warm with a fork every 4 minutes (up to 12 hours; the session itself is untouched); remove the file to go on.
Each run's state is saved after every step: `run` again continues each run where it stopped.

  python3 canary.py run [--ways CC,SC,SCL] [--reps 3]     # costs money
  python3 canary.py report
"""
import argparse
import concurrent.futures as cf
import glob
import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import bench
import compact_bench as cb

HERE = bench.HERE
ROOT = bench.WORK / "canary"
PAUSE = ROOT / "PAUSE"
RESULTS = Path(os.environ.get("BENCH_RESULTS", HERE / "results-canary.jsonl"))
SUMMARIES = HERE / "canary-summaries"
MODEL = "haiku"
WAYS = ("CC", "SC", "SCL")
CYCLES = 6
WARM_EVERY = 240  # s: inside the 5-minute cache
WARM_FOR = 12 * 3600
NO_TOOLS = "Bash,Read,Grep,Glob,Edit,Write,MultiEdit,NotebookEdit,Agent,Task,WebFetch,WebSearch,LSP"
LOCK = threading.Lock()

# Two per cycle, in turn: each reads a large part of click, so a cycle adds some 40-70k of context to summarize.
READS = [
    "read src/click/core.py in full (all of it, in parts if needed) and explain in five sentences how a Context, a Command and a Group work together.",
    "read src/click/types.py and src/click/parser.py in full and explain in five sentences how a raw command-line string becomes a typed value.",
    "read src/click/termui.py and src/click/_termui_impl.py in full and explain in five sentences how click.progressbar and click.echo_via_pager work.",
    "read tests/test_options.py in full (all of it, in parts if needed) and tell me in five sentences which option behaviours it covers and which it leaves out.",
    "read src/click/shell_completion.py, src/click/decorators.py and src/click/utils.py in full and explain in five sentences how shell completion finds its candidates.",
    "read tests/test_termui.py and tests/test_basic.py in full and tell me in five sentences what they test.",
]
# (cycle, prompt of the cycle): said in passing, before the work.
PLANTS = {
    (1, 0): "Some context before we start: staging for this fork runs on port 6431, and the release codename is TANGERINE-41.",
    (1, 1): "A rule for this repository from now on: every commit message starts with the ticket prefix CLK-208.",
    (2, 0): "FYI: last week we tried setting CLICK_FASTPATH=1 to speed up the test run; it made test_echo_via_pager hang, so let's not go there again. "
            "(Unrelated: my reviewer's handle is @quill-7, in case it comes up.)",
    (2, 1): "Remind me at some point: I need to rotate the PyPI token before Friday.",
    (3, 0): "Update: staging moved, it runs on port 6517 now.",
    (3, 1): "My rule of thumb for this codebase, in my words: 'no magic in the CLI layer, ever'.",
    (4, 0): "One more number for later: the benchmark budget is 37 seconds per run.",
}
UNKNOWN = (r"unknown|not sure|don'?t know|do not know|did ?n[o']t (?:say|mention|tell|specify)|not (?:mentioned|said|told|specified|discussed|stated)"
           r"|no (?:mention|record|information)|never (?:said|mentioned|told)|haven'?t")
# want/stale take the checkpoint: the port was changed in cycle 3, so from checkpoint 3 on the old one is stale.
CANARIES = [
    {"name": "codename", "kind": "value", "cycle": 1, "q": "What is the release codename?", "want": lambda k: r"TANGERINE-41"},
    {"name": "port", "kind": "superseded", "cycle": 1, "q": "Which port does staging run on?",
     "want": lambda k: r"6517" if k >= 3 else r"6431", "stale": lambda k: r"6431" if k >= 3 else None},
    {"name": "rule", "kind": "rule", "cycle": 1,
     "q": "Write the one-line commit message you would use for a change that fixes a typo in a docstring in src/click/termui.py.", "want": lambda k: r"CLK-208"},
    {"name": "deadend", "kind": "dead end", "cycle": 2, "q": "Would setting CLICK_FASTPATH=1 be a good way to speed up the test run?", "want": lambda k: r"hang|pager"},
    {"name": "open", "kind": "open item", "cycle": 2, "q": "Did I ask you to remind me of anything? If so, of what?", "want": lambda k: r"pypi|token"},
    {"name": "aside", "kind": "aside", "cycle": 2, "q": "What is my reviewer's handle?", "want": lambda k: r"quill-7"},
    {"name": "quote", "kind": "quote", "cycle": 3, "q": "What is my rule of thumb about the CLI layer, in my own words?", "want": lambda k: r"no magic in the CLI layer"},
    {"name": "budget", "kind": "value", "cycle": 4, "q": "What is the benchmark budget per run?", "want": lambda k: r"\b37\b"},
    {"name": "decoy", "kind": "decoy", "cycle": 1, "q": "How often did I say the Redis password gets rotated?", "want": lambda k: UNKNOWN},
]


def steps() -> list[tuple[str, int, int]]:
    out = []
    for c in range(1, CYCLES + 1):
        out += [("work", c, 0), ("work", c, 1)]
        if c == 1:
            out.append(("probe", 0, 0))
        out += [("compact", c, 0), ("probe", c, 0)]
    return out


def work_prompt(c: int, i: int) -> str:
    read = READS[(2 * (c - 1) + i) % len(READS)]
    plant = PLANTS.get((c, i))
    return (f"{plant} Now, {read}" if plant else read[0].upper() + read[1:]) + " Change nothing."


def probe_prompt(questions: list[str]) -> str:
    lines = "\n".join(f"{n}. {q}" for n, q in enumerate(questions, 1))
    return ("A quick check before we go on. Answer from what you know of our conversation alone: do not read files, search or run anything. "
            "Answer each numbered question on one line, starting with its number; if you do not know, write 'unknown'.\n" + lines)


def parse(answer: str, n: int) -> list[str]:
    got: dict[int, str] = {}
    for m in re.finditer(r"^\s*\**(\d+)\**[.):]\**\s*(.*)$", answer, re.M):
        got.setdefault(int(m.group(1)), m.group(2))
    return [got.get(i, "") for i in range(1, n + 1)]


def claude(prompt: str, repo: Path, resume: str | None = None, fork: bool = False, extra: tuple[str, ...] = (), env: dict | None = None,
           plugins: tuple[Path, ...] | None = None, timeout: int = 1800) -> dict:
    """A plain Haiku step (installed plugins off); with plugins, those of compact_bench's arms and prep-mod (the SC install)."""
    cmd = ["claude", "-p", prompt, "--model", MODEL, "--output-format", "json"]
    if resume:
        cmd += ["--resume", resume]
    if fork:
        cmd += ["--fork-session"]
    cmd += list(extra)
    if plugins is not None:
        cmd += cb.settings_flags(plugins, env)
    try:
        p = subprocess.run(bench.neutral(cmd), cwd=repo, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL,
                           env={**os.environ, **(env or {})})
        out, err = p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        out, err = (e.stdout.decode() if isinstance(e.stdout, bytes) else e.stdout) or "", "timeout"
    try:
        res = json.loads(out)
    except json.JSONDecodeError:
        res = {}
    res["_stderr"] = (err or "")[-500:]
    return res


def transcript(session: str) -> Path | None:
    paths = glob.glob(str(bench.PROJECTS / "*" / f"{session}.jsonl"))
    return Path(paths[0]) if paths else None


def engine_summary(session: str) -> str | None:
    """The last summary Claude Code's own compaction wrote into the session."""
    path, text = transcript(session), None
    if path is None:
        return None
    for line in path.read_text().splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("isCompactSummary"):
            m = e.get("message", {}).get("content")
            text = m if isinstance(m, str) else " ".join(b.get("text", "") for b in m or [] if isinstance(b, dict))
    return text


def context_now(session: str) -> int | None:
    path = transcript(session)
    reqs = bench.requests_of(str(path), 0) if path else []
    return bench.ctx(reqs[-1]) if reqs else None


def log(msg: str):
    with LOCK:
        print(time.strftime("%H:%M:%S"), msg, flush=True)


class StepFailed(Exception):
    pass


def ok(r: dict, what: str) -> dict:
    if not r.get("session_id") or r.get("is_error"):
        raise StepFailed(f"{what}: {(r.get('result') or r.get('_stderr') or '')[:300]}")
    return r


def hold(name: str, st: dict, repo: Path):
    """While PAUSE exists: wait, and keep the session's cache warm with a fork (the same tools and plugins as its own steps)."""
    began = last = time.time()
    if PAUSE.exists():
        log(f"{name} paused at step {st['step']}")
    while PAUSE.exists():
        if st.get("session") and time.time() - last >= WARM_EVERY and time.time() - began < WARM_FOR:
            r = claude("Reply with the single word ok. Use no tool.", repo, resume=st["session"], fork=True, extra=("--max-turns", "1"))
            u = r.get("usage") or {}
            st["warm_usd"] = st.get("warm_usd", 0.0) + max(0.0, (r.get("total_cost_usd") or 0.0) - st.get("running", 0.0))
            log(f"{name} warm: read {u.get('cache_read_input_tokens')} wrote {u.get('cache_creation_input_tokens')}")
            last = time.time()
        time.sleep(5)


def save(path: Path, st: dict):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1))
    tmp.replace(path)


def run_one(way: str, rep: int):
    name = f"{way}-{rep}"
    d = ROOT / name
    repo, sf = d / "repo", d / "state.json"
    if sf.exists():
        st = json.loads(sf.read_text())
    else:
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        cb.make_repo(repo)
        st = {"step": 0, "session": None, "running": 0.0, "summary": None, "started": time.time()}
        save(sf, st)
    plan = steps()
    SUMMARIES.mkdir(exist_ok=True)
    while st["step"] < len(plan):
        hold(name, st, repo)
        kind, c, i = plan[st["step"]]
        t0 = time.time()
        for attempt in (1, 2):
            try:
                note = step(way, rep, name, st, repo, kind, c, i)
                break
            except StepFailed as e:
                log(f"{name} {kind} c{c} attempt {attempt} failed: {e}")
                if attempt == 2:
                    log(f"{name} stopped at step {st['step']}: run again to continue")
                    return
        st["step"] += 1
        save(sf, st)
        log(f"{name} step {st['step']}/{len(plan)} {kind} c{c}{'.' + str(i) if kind == 'work' else ''} {time.time() - t0:.0f}s {note}")
    log(f"{name} done: ${st['running']:.3f} main, ${st.get('probe_usd', 0):.3f} probes, ${st.get('summary_usd', 0):.3f} summary forks")


def step(way: str, rep: int, name: str, st: dict, repo: Path, kind: str, c: int, i: int) -> str:
    if kind == "work":
        r = ok(claude(work_prompt(c, i), repo, resume=st["session"]), "work")
        st["session"], st["running"] = r["session_id"], r.get("total_cost_usd") or st["running"]
        st.setdefault("models", sorted(r.get("modelUsage") or {}))
        return f"ctx {context_now(st['session'])}"
    if kind == "compact":
        st["context_before"] = context_now(st["session"])
        path = SUMMARIES / f"{name}.c{c}.md"
        if way == "CC":
            r = ok(claude("/compact", repo, resume=st["session"], timeout=1200), "compact")
            st["session"], st["running"] = r["session_id"], r.get("total_cost_usd") or st["running"]
            text = engine_summary(st["session"])
            if not text:
                raise StepFailed("no compact summary in the transcript")
            path.write_text(text)
        else:
            prompt, head = cb.summary_texts()
            if way == "SCL":
                prompt = cb.LEAN_PROMPT
            s = ok(claude(prompt, repo, resume=st["session"], fork=True, extra=("--max-turns", "1")), "summary")
            summary = (s.get("result") or "").strip()
            if not summary:
                raise StepFailed("empty summary")
            st["summary_usd"] = st.get("summary_usd", 0.0) + max(0.0, (s.get("total_cost_usd") or 0.0) - st["running"])
            path.write_text(f"{head}\n\n{summary}")
            r = ok(claude("/compact", repo, resume=st["session"], env={"PREP_SUMMARY_FILE": str(path)}, plugins=(cb.PREP_MOD,), timeout=1200), "install")
            t = transcript(r["session_id"])
            if t is None or head[:80] not in t.read_text():
                raise StepFailed("the compaction was not prep-mod's (smart-compact's head is not in the transcript)")
            st["session"], st["running"] = r["session_id"], r.get("total_cost_usd") or st["running"]
        st["summary"] = str(path)
        return f"ctx {st['context_before']} -> summary {len(path.read_text())} chars"
    # probe: checkpoint c (0 = before the first compaction), every canary planted by then
    k = c
    qs = [q for q in CANARIES if q["cycle"] <= max(k, 1)]
    r = ok(claude(probe_prompt([q["q"] for q in qs]), repo, resume=st["session"], fork=True, extra=("--max-turns", "2", "--disallowedTools", NO_TOOLS)), "probe")
    answer = r.get("result") or ""
    st["probe_usd"] = st.get("probe_usd", 0.0) + max(0.0, (r.get("total_cost_usd") or 0.0) - st["running"])
    summary = Path(st["summary"]).read_text() if k > 0 and st.get("summary") else None
    grades = {}
    for q, a in zip(qs, parse(answer, len(qs))):
        want, stale = q["want"](k), (q["stale"](k) if "stale" in q else None)
        right = bool(re.search(want, a, re.I))
        grades[q["name"]] = {
            "kind": q["kind"], "planted": q["cycle"], "right": right, "stale": bool(stale and not right and re.search(stale, a)),
            "in_summary": None if summary is None or q["kind"] == "decoy" else bool(re.search(want, summary, re.I)),
            "stale_in_summary": None if summary is None or not stale else bool(re.search(stale, summary)), "answer": a[:300]}
    row = {"run": name, "way": way, "rep": rep, "checkpoint": k, "session": st["session"], "probe_session": r.get("session_id"),
           "context_before": st.get("context_before") if k > 0 else context_now(st["session"]),
           "summary_chars": len(summary) if summary else None, "grades": grades, "answer": answer[:3000], "models": st.get("models"), "at": time.time()}
    with LOCK, RESULTS.open("a") as f:
        f.write(json.dumps(row) + "\n")
    n = [g for g in grades.values() if g["kind"] != "decoy"]
    return f"probe {sum(g['right'] for g in n)}/{len(n)} right, decoy {'ok' if grades['decoy']['right'] else 'INVENTED'}"


def cmd_run(args):
    ROOT.mkdir(parents=True, exist_ok=True)
    jobs = [(w, r) for r in range(1, args.reps + 1) for w in args.ways.split(",")]
    log(f"{len(jobs)} runs, {len(steps())} steps each; pause: touch {PAUSE}")
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        for f in cf.as_completed([ex.submit(run_one, w, r) for w, r in jobs]):
            if f.exception():
                log(f"run raised: {f.exception()!r}")


def cmd_report(args):
    rows = [json.loads(l) for l in RESULTS.open() if l.strip()] if RESULTS.exists() else []
    ways = [w for w in WAYS if any(r["way"] == w for r in rows)]
    ks = sorted({r["checkpoint"] for r in rows})
    print("share of canaries answered right (decoy apart), by checkpoint; in brackets: share found in the summary")
    print("way   " + "".join(f"  c{k:<11}" for k in ks))
    for w in ways:
        cells = []
        for k in ks:
            gs = [g for r in rows if r["way"] == w and r["checkpoint"] == k for g in r["grades"].values() if g["kind"] != "decoy"]
            ins = [g["in_summary"] for g in gs if g["in_summary"] is not None]
            cells.append(f"{sum(g['right'] for g in gs) / len(gs):4.0%}" + (f" ({sum(ins) / len(ins):3.0%})" if ins else "      ") if gs else " -         ")
        print(f"{w:5} " + "".join(f"  {c:<12}" for c in cells))
    last = max(ks) if ks else None
    print(f"\nby canary at checkpoint {last} (right / runs; stale = superseded value given; decoy right = said it does not know)")
    names = [q["name"] for q in CANARIES]
    print("way   " + "".join(f"{n:>10}" for n in names))
    for w in ways:
        rs = [r for r in rows if r["way"] == w and r["checkpoint"] == last]
        cells = []
        for n in names:
            gs = [r["grades"][n] for r in rs if n in r["grades"]]
            cells.append(f"{sum(g['right'] for g in gs)}/{len(gs)}" + ("s" * sum(g["stale"] for g in gs)))
        print(f"{w:5} " + "".join(f"{c:>10}" for c in cells))
    print("\nsummary length (chars, mean) by checkpoint")
    for w in ways:
        print(f"{w:5} " + "  ".join(f"c{k} {sum(x) // len(x) if (x := [r['summary_chars'] for r in rows if r['way'] == w and r['checkpoint'] == k and r['summary_chars']]) else '-'}" for k in ks if k > 0))
    if "SC" in ways and last == CYCLES:
        sc = [r for r in rows if r["way"] == "SC" and r["checkpoint"] == last]
        gs = [g for r in sc for g in r["grades"].values() if g["kind"] != "decoy"]
        share = sum(g["right"] for g in gs) / len(gs)
        stale = sum(g["stale"] for r in sc for g in r["grades"].values())
        invented = sum(not r["grades"]["decoy"]["right"] for r in sc)
        worse = [n for n in names if n != "decoy" and "CC" in ways and
                 sum(r["grades"][n]["right"] for r in sc) < sum(r["grades"][n]["right"] for r in rows if r["way"] == "CC" and r["checkpoint"] == last)]
        verdict = share >= 0.9 and stale == 0 and invented == 0 and not worse
        print(f"\npass rule: SC {share:.0%} right (>= 90%), stale {stale} (0), decoy invented {invented} (0), worse than CC on {worse or 'none'}: {'PASS' if verdict else 'FAIL'}")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--ways", default=",".join(WAYS))
    r.add_argument("--reps", type=int, default=3)
    sub.add_parser("report")
    args = ap.parse_args()
    {"run": cmd_run, "report": cmd_report}[args.cmd](args)


if __name__ == "__main__":
    main()
