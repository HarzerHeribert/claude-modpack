"""Does the delegate mod pay, with lsp-plus loaded? A small benchmark on click.

Arms (lsp-plus is loaded in all three, from CLAUDE_CODE_PLUGIN_DIRS):
  A  Opus alone
  B  Opus with delegate; it decides itself whether to hand off
  C  Opus with delegate and one system-prompt line asking it to hand off multi-step work
  D  Opus with delegate, told to do the task through hand_off (delegation's quality and cost when it happens)
  E  as D, after the fixes the first D runs showed (git-based diff, import anchors, a cold language server)
  F  as E, with the hand-off waiting inside the tool call (one request of the main model instead of three)
  I  as F, with the evidence reviewed inline (the fork reviews of F paid the conversation again, uncached)
  S  as F, with a Sonnet worker
  G  as B (delegate available, Opus decides), after the tool's description named the measured savings and what to keep in house
  N  as A, after lsp-plus learned to nudge symbol greps toward the exact LSP call (does it cost quality?)
  V  plain Claude Code: none of these mods (the suite's baseline; earlier arms all had lsp-plus)
  P  the modpack as shipped: smart-compact, lsp-plus, delegate, cells, eta
  R  as P, with a routing rule that says which work to hand off
  Q  as P, after the pack went quiet where it had no proof (the lsp-plus grep note off)
  DF, DL  the pack, fresh and long (as PL), the person ending the prompt with "Delegate where you see fit."
  Y  as Q, with lsp-plus answering symbol greps from the language server and warming servers at session start
  X  the pack with Claude Code's system prompt replaced by one plain sentence and the routing rule
  W  as V with Sonnet as the main model: plain Claude Code, no mods (is the model choice itself the lever?)
  H  as P, told in the prompt to do the task through hand_off (F's instruction, with the whole pack); run long, as HL
  PL, HL  P and H in a long session prepared with the pack loaded (VL and RL fork one prepared without mods,
     where the pack's tools came in deferred)
  (V, P, R and H name what loads for each run; the arms before them took it from the person's settings)
  K  as A, with the cells mod 0.2 loaded (run_cell with refs/defn/rename, the chaining guidance, the notes);
     run with BENCH_RESULTS=results-cells.jsonl so the delegate record stays as it was

Each run: a fresh copy of click, `claude -p` on Opus with the person's own
settings, the task graded by a fixed rule, and its cost priced from the
transcripts (the main session and every worker), request by request.

  python3 bench.py run [--reps 2] [--arms A,B,C] [--tasks t1,t2] [--jobs 4]
  python3 bench.py report
"""

import argparse
import concurrent.futures as cf
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = Path(os.environ.get("BENCH_WORK", Path.home() / ".cache" / "claude-modpack-bench"))
BASE = WORK / "click-base"
VENV = WORK / "venv"
RESULTS = Path(os.environ.get("BENCH_RESULTS", HERE / "results.jsonl"))
DELEGATE = HERE.parent.parent / "delegate"
CELLS = HERE.parent.parent / "cells"
PROJECTS = Path.home() / ".claude/projects"

NUDGE = "Hand multi-step reading, searching and mechanical edits to the hand_off tool where it fits; do one-step lookups yourself."
FORCE = "Do this task through the hand_off tool: write the task for the worker so it stands alone, wait for its report, check the evidence, then answer or finish yourself."

# The modpack as shipped: its five mods, named for each run so the person's own settings never decide what loads.
PACK_ROOT = Path(os.environ.get("BENCH_PACK_ROOT", HERE.parent.parent))
PACK = ":".join(str(PACK_ROOT / m) for m in ("smart-compact", "lsp-plus", "delegate", "cells", "eta"))

# A routing rule for the pack: Opus never handed off unasked (0 of 24 runs), so the pack says when to.
# The person's own words, at the end of their prompt: permission to delegate, not an order.
FIT = "Delegate where you see fit."

MINIMAL = "You are Claude Code, working in a software repository from the command line. Use your tools to do the task you are given."

ROUTING = """# Routing work

Before you start a task, decide where it runs.
- Hand it off with mcp__delegate__hand_off when it is fully specified, will take you more than about five steps, and a diff and a check can prove its result: a feature from a precise spec, tests to a target, one change applied in many places. Use model "sonnet" when the work needs judgment the spec cannot pin down, "haiku" when it is mechanical. Judge what comes back by its diff and check output, then finish what is left.
- Keep it yourself when it is a lookup, a trace, an explanation, a design decision or debugging, or when it depends on what this conversation decided."""

TEST = f"PYTHONPATH=src {VENV}/bin/python -m pytest -q"

TASKS = {
    "t1-trace": {
        "kind": "explore",
        "prompt": "In this repository (click), list every function or method in src/click that calls click's own `echo()` function directly. "
        "Give each as `file: Class.method` or `file: function` (nested functions as `outer.inner`), one per line, and nothing else after the list.",
    },
    "t2-rename": {
        "kind": "edit",
        "prompt": "Rename the public function `format_filename` to `display_filename` everywhere in src/, tests/ and docs/ of this repository (click): "
        "its definition, every import, call and mention, the test file name included. No alias for the old name. "
        f"The tests run with: {TEST}",
    },
    "t3-explain": {
        "kind": "explore",
        "prompt": "In this repository (click), explain how an option's value is resolved when it is not given on the command line: "
        "which methods run, in which order, with file:line for each, and where the environment variable and the context's default_map come in. "
        "Keep it to a short ordered list.",
    },
    "t5-types": {
        "kind": "explore",
        "prompt": "In this repository (click), list every ParamType subclass defined in src/click/types.py (directly or indirectly derived) whose own convert() method "
        "calls self.fail(...) itself (a class that only inherits convert does not count). One class name per line, nothing else after the list.",
    },
    "l1-feature": {
        "kind": "edit",
        "prompt": "Add a new parameter type `click.Duration` to this repository (click).\n"
        "- A ParamType subclass named Duration in src/click/types.py, exported from the package as `click.Duration` and used as `type=click.Duration()`.\n"
        "- convert(): a datetime.timedelta passes through unchanged. A string is either a whole number of seconds (\"120\") or one or more <integer><unit> groups "
        "with the units d, h, m, s, each at most once and in that order, no spaces, case-insensitive (\"2d\", \"1h30m\", \"45S\", \"1d2h3m4s\", \"90m\"). "
        "The result is a datetime.timedelta. Anything else (empty, negative, decimals, unknown, repeated or out-of-order units, spaces) fails through self.fail "
        "with the message \"{value!r} is not a valid duration.\" where value is the input.\n"
        "- Its name is \"duration\", so help shows the metavar DURATION.\n"
        "- Document it in docs/parameter-types.md and add tests to tests/test_types.py.\n"
        f"The tests run with: {TEST}",
    },
    "l2-coverage": {
        "kind": "edit",
        "prompt": "Raise the test coverage of src/click/utils.py in this repository (click) as high as you can, by adding tests in a new file "
        "tests/test_utils/test_utils_more.py. Do not change anything under src/. Coverage counts lines and branches over the whole test suite: "
        f"`{TEST} --cov=click.utils --cov-branch --cov-report=term-missing`. Every test must pass.",
    },
    "t4-lookup": {
        "kind": "lookup",
        "prompt": "In this repository (click): if a click program is invoked as `my.cli-tool`, which environment variable triggers its shell completion? "
        "Answer with the exact variable name and the file:line where the name is built.",
    },
}

# t1: the 18 callers of echo() in click 8.5.0, from the AST (pattern: what must appear in the answer).
ECHO_CALLERS = [
    ("_termui_impl", r"render_progress"),
    ("core", r"Command\.invoke|\binvoke\b"),
    ("core", r"Command\.main|\bmain\b"),
    ("core", r"handle_parse_result"),
    ("decorators", r"show_version"),
    ("decorators", r"show_help"),
    ("decorators", r"version_option.*callback|callback.*version_option"),
    ("exceptions", r"ClickException\.show"),
    ("exceptions", r"NoArgsIsHelpError\.show"),
    ("exceptions", r"UsageError\.show"),
    ("shell_completion", r"_check_version"),
    ("shell_completion", r"(?<![.\w])shell_complete\b(?!\.)"),
    ("termui", r"\bclear\b"),
    ("termui", r"\bconfirm\b"),
    ("termui", r"\bpause\b"),
    ("termui", r"(?<![._])\bprompt\b(?!\.prompt_func|_func)"),
    ("termui", r"prompt_func"),
    ("termui", r"\bsecho\b"),
]

# t5: from the AST of click 8.5.0's types.py.
PARAM_TYPES = ["CompositeParamType", "FuncParamType", "UnprocessedParamType", "StringParamType", "Choice", "DateTime", "_NumberParamTypeBase", "_NumberRangeBase",
               "IntParamType", "IntRange", "FloatParamType", "FloatRange", "BoolParamType", "UUIDParameterType", "File", "Path", "Tuple"]
FAILS = {"FuncParamType", "Choice", "DateTime", "_NumberParamTypeBase", "_NumberRangeBase", "BoolParamType", "UUIDParameterType", "File", "Path", "Tuple"}

# l2: utils.py's line and branch coverage over the unchanged suite.
COVERAGE_BASE = 79.6

T3_TERMS = ["handle_parse_result", "consume_value", "value_from_envvar|resolve_envvar_value", "default_map|lookup_default", "get_default", "process_value|type_cast_value"]


def grade(task: str, answer: str, repo: Path) -> dict:
    if task == "t1-trace":
        lines = answer.splitlines()
        hit = 0
        for mod, pat in ECHO_CALLERS:
            if any(mod in l and re.search(pat, l) for l in lines):
                hit += 1
        listed = sum(1 for l in lines if re.search(r"\.py\s*:|\bsrc/click/", l))
        return {"score": hit / len(ECHO_CALLERS), "found": hit, "of": len(ECHO_CALLERS), "listed": listed}
    if task == "t2-rename":
        old = subprocess.run(["grep", "-rlwI", "--exclude-dir=__pycache__", "format_filename", "src", "tests", "docs"], cwd=repo, capture_output=True, text=True).stdout.split()
        new = subprocess.run(["grep", "-rwI", "--exclude-dir=__pycache__", "display_filename", "src", "tests", "docs"], cwd=repo, capture_output=True, text=True).stdout.count("\n")
        docs = subprocess.run(["grep", "-rlwI", "--exclude-dir=__pycache__", "display_filename", "docs"], cwd=repo, capture_output=True, text=True).stdout.split()
        tests = subprocess.run(TEST, shell=True, cwd=repo, capture_output=True, text=True)
        tail = (tests.stdout.strip().splitlines() or [""])[-1]
        ok = not old and new >= 18 and len(docs) >= 3 and tests.returncode == 0
        return {"score": 1.0 if ok else 0.0, "old_left": old, "new_mentions": new, "docs_files": len(docs), "tests": tail}
    if task == "t3-explain":
        hit = [t for t in T3_TERMS if re.search(t, answer)]
        return {"score": len(hit) / len(T3_TERMS), "terms": hit, "has_lines": bool(re.search(r"core\.py:\d+", answer))}
    if task == "t5-types":
        # The list's lines only (a bullet, backticks, a trailing note allowed): prose may name the classes left out.
        named = {m.group(1) for line in answer.splitlines() if (m := re.match(r"^\s*(?:[-*\d.)]+\s*)?`?([A-Za-z_]\w*)`?\s*(?:[-—:(].*)?$", line)) and m.group(1) in PARAM_TYPES}
        tp = len(named & FAILS)
        prec = tp / len(named) if named else 0.0
        rec = tp / len(FAILS)
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        return {"score": f1, "precision": prec, "recall": rec, "extra": sorted(named - FAILS), "missed": sorted(FAILS - named)}
    if task == "l1-feature":
        hidden = repo / "tests" / "test_zz_hidden_duration.py"
        shutil.copy(HERE / "hidden" / "test_duration_hidden.py", hidden)
        h = subprocess.run(f"{TEST} -p no:cacheprovider --tb=no {hidden.relative_to(repo)}", shell=True, cwd=repo, capture_output=True, text=True)
        hidden.unlink()
        passed = int((re.search(r"(\d+) passed", h.stdout) or [0, 0])[1])
        failed = int((re.search(r"(\d+) failed", h.stdout) or [0, 0])[1]) + int((re.search(r"(\d+) error", h.stdout) or [0, 0])[1])
        suite = subprocess.run(f"{TEST} -p no:cacheprovider --tb=no", shell=True, cwd=repo, capture_output=True, text=True)
        frac = passed / (passed + failed) if passed + failed else 0.0
        return {"score": frac * (1.0 if suite.returncode == 0 else 0.5), "hidden_passed": passed, "hidden_failed": failed, "suite": (suite.stdout.strip().splitlines() or [""])[-1]}
    if task == "l2-coverage":
        src_changed = subprocess.run(["git", "status", "--porcelain", "src"], cwd=repo, capture_output=True, text=True).stdout.strip()
        cov = subprocess.run(f"{TEST} -p no:cacheprovider --tb=no --cov=click.utils --cov-branch --cov-report=json:/dev/stdout -q", shell=True, cwd=repo, capture_output=True, text=True)
        m = re.search(r'"totals":\s*\{[^}]*"percent_covered":\s*([\d.]+)', cov.stdout)
        pct = float(m[1]) if m else 0.0
        ok = cov.returncode == 0 and not src_changed and (repo / "tests/test_utils/test_utils_more.py").exists()
        return {"score": max(0.0, (pct - COVERAGE_BASE) / (100 - COVERAGE_BASE)) if ok else 0.0, "percent": round(pct, 1), "suite_ok": cov.returncode == 0, "src_changed": bool(src_changed)}
    if task == "t4-lookup":
        return {"score": 1.0 if "_MY_CLI_TOOL_COMPLETE" in answer else 0.0}
    raise ValueError(task)


# $/M tokens, list prices. Writes priced from the usage's own 5m/1h split.
PRICES = {
    "opus": {"in": 4.0, "out": 20.0, "read": 0.20, "w5": 5.0, "w1h": 8.0},
    "sonnet": {"in": 2.0, "out": 10.0, "read": 0.20, "w5": 2.5, "w1h": 4.0},
    "haiku": {"in": 0.10, "out": 0.50, "read": 0.01, "w5": 0.125, "w1h": 0.20},
}


def price(model: str) -> dict:
    for k, p in PRICES.items():
        if k in model:
            return p
    return PRICES["opus"]


def requests_of(path: str, since: float = 0) -> list[dict]:
    """One row per API request (a message id), with its model and usage; from `since` (epoch seconds) on."""
    seen: dict[str, dict] = {}
    for line in open(path, errors="replace"):
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        m = o.get("message") or {}
        if o.get("type") != "assistant" or not m.get("id") or not m.get("usage"):
            continue
        if since and datetime.fromisoformat(str(o.get("timestamp", "1970-01-01T00:00:00Z")).replace("Z", "+00:00")).timestamp() < since:
            continue
        seen[m["id"]] = {"model": m.get("model", ""), "usage": m["usage"], "tools": seen.get(m["id"], {}).get("tools", []) + [b.get("name") for b in m.get("content") or [] if b.get("type") == "tool_use"]}
    return list(seen.values())


def cost_of(req: dict) -> float:
    p, u = price(req["model"]), req["usage"]
    cc = u.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
    w5 = cc.get("ephemeral_5m_input_tokens", 0) or 0
    if not cc:
        w5 = u.get("cache_creation_input_tokens", 0) or 0
    return (u.get("input_tokens", 0) * p["in"] + u.get("output_tokens", 0) * p["out"] + (u.get("cache_read_input_tokens", 0) or 0) * p["read"] + w5 * p["w5"] + w1h * p["w1h"]) / 1e6


DELEGATE_LOG = Path.home() / ".claude/mods/delegate/log.jsonl"


def reviews(session_id: str) -> tuple[int, float]:
    """Forked reviews delegate ran for this session: each a full main-model request that no transcript records."""
    if not DELEGATE_LOG.exists():
        return 0, 0.0
    recs = [json.loads(l) for l in open(DELEGATE_LOG) if l.strip()]
    mine = [r for r in recs if r.get("session") == session_id and r.get("route") == "fork"]
    return len(mine), sum(r.get("reviewUsd") or 0 for r in mine)


def account(session_id: str, since: float = 0) -> dict:
    """What a run cost, request by request; a run that forked a long session counts from its start (`since`)."""
    mains = glob.glob(str(PROJECTS / "*" / f"{session_id}.jsonl"))
    if not mains:
        return {"found": False}
    main = requests_of(mains[0], since)
    workers = [r for f in glob.glob(str(Path(mains[0]).with_suffix("") / "subagents" / "*.jsonl")) for r in requests_of(f, since)]
    tools = [t for r in main for t in r["tools"]]
    forks, review_usd = reviews(session_id)
    return {
        "found": True,
        "forks": forks,
        "review_usd": review_usd,
        "main_requests": len(main),
        "main_usd": sum(cost_of(r) for r in main),
        "main_models": sorted({r["model"] for r in main}),
        "worker_requests": len(workers),
        "worker_usd": sum(cost_of(r) for r in workers),
        "hand_offs": sum(1 for t in tools if t and t.endswith("hand_off")),
        "agents": sum(1 for t in tools if t == "Agent"),
        "lsp_calls": sum(1 for t in tools if t == "LSP"),
        "main_tools": len(tools),
        "peak_context": max((ctx(r) for r in main), default=0),
        # How much of the first request came from the cache: near 0 is a cold start, where the run paid to cache
        # the tool definitions and system prompt that warm runs read (a one-time cost per cache lifetime).
        "first_cache_read": (main[0]["usage"].get("cache_read_input_tokens") or 0) if main else 0,
        # What the task left in the main context: every later step of the session re-reads it.
        "added_context": (ctx(main[-1]) + main[-1]["usage"].get("output_tokens", 0) - ctx(main[0])) if main else 0,
    }


def ctx(req: dict) -> int:
    u = req["usage"]
    return u.get("input_tokens", 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)


def run_one(task: str, arm: str, rep: int) -> dict:
    run_id = f"{task}.{arm}.{rep}.{int(time.time())}"
    repo = WORK / "runs" / run_id
    shutil.copytree(BASE, repo, symlinks=True)
    prompt = TASKS[task]["prompt"] + (f"\n\n{FIT}" if arm == "DF" else "")
    cmd = ["claude", "-p", prompt, "--model", "sonnet" if arm == "W" else "opus", "--permission-mode", "auto", "--output-format", "json"]
    if arm in ("V", "P", "R", "W", "Q", "DF", "Y"):
        # The suite's conditions load exactly what they name: nothing (V), or the pack (P, R).
        # Asks for the claude.ai connectors to stay on, as in every run before the person turned them off on 13 Oct
        # (378 deferred tools); the person's own setting wins, so runs from then on (DF, DL, Y, results-noconn) have 15.
        cmd += ["--settings", json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": "" if arm in ("V", "W") else PACK}, "disableClaudeAiConnectors": False})]
    if arm == "R":
        cmd += ["--append-system-prompt", ROUTING]
    if arm == "X":
        # Claude Code's own system prompt replaced by one plain sentence and the routing rule: does its prompt keep
        # Opus from handing off?
        cmd += ["--settings", json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": PACK}}), "--system-prompt", MINIMAL + "\n\n" + ROUTING]
    if arm in ("B", "C", "D", "E", "F", "I", "S", "G"):
        cmd += ["--plugin-dir", str(DELEGATE)]
    if arm == "K":
        cmd += ["--plugin-dir", str(CELLS)]
    if arm == "C":
        cmd += ["--append-system-prompt", NUDGE]
    if arm in ("D", "E", "F", "I"):
        cmd += ["--append-system-prompt", FORCE]
    if arm == "S":
        cmd += ["--append-system-prompt", FORCE + " Give the worker model sonnet."]
    started = time.time()
    try:
        p = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=1800)
        out, err = p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        out, err = (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or ""), "timeout"
    wall = time.time() - started
    try:
        res = json.loads(out)
    except json.JSONDecodeError:
        res = {}
    answer = res.get("result") or ""
    row = {
        "run": run_id, "task": task, "arm": arm, "rep": rep, "wall_s": round(wall, 1),
        "session": res.get("session_id"), "reported_usd": res.get("total_cost_usd"), "is_error": res.get("is_error", True),
        "answer": answer[:4000], "stderr": err[-500:] if err else "",
    }
    row["grade"] = grade(task, answer, repo)
    if task in ("t2-rename", "l1-feature", "l2-coverage"):
        # The change as made, against the clean copy: re-graded later from this alone.
        subprocess.run(["git", "add", "-A", "-N", "."], cwd=repo, capture_output=True)
        diff = subprocess.run(["git", "diff", "--binary", "HEAD", "--", ".", ":(exclude).coverage", ":(exclude)*.pyc", ":(exclude)__pycache__"], cwd=repo, capture_output=True, text=True).stdout
        (HERE / "patches" / f"{run_id}.patch").write_text(diff)
    if row["session"]:
        row["cost"] = account(row["session"])
    return row


# A long session: one clean copy of click whose prepared session every long run forks, one run at a time
# (the history holds this folder's absolute paths, so the runs share it, reset in between).
LONG = WORK / "long"
LONG_REPO = LONG / "repo"
LONG_SESSION = LONG / "session.txt"
# The same reading with the pack loaded from the start: a tool added to a resumed session comes in deferred
# (Claude Code keeps the cached prompt's tool list as it was), so the pack's tools are only loaded as in real
# use when the history began with them. PL and HL fork this one; VL and RL the plain one.
LONG_SESSION_PACK = LONG / "session-pack.txt"


def session_file(arm: str) -> Path:
    return LONG_SESSION_PACK if arm in ("PL", "HL", "DL") else LONG_SESSION
PREP_PROMPT = "Read every .py file under src/click in full with the Read tool, the largest first, several files per response. Then reply with the single word: ready."


def conditions(arm: str) -> list[str]:
    """The flags that make a suite condition: what loads, and the routing rule."""
    base = arm[0]
    cmd = ["--settings", json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": "" if base == "V" else PACK}, "disableClaudeAiConnectors": False})]
    # A resumed session takes no appended system prompt (checked 13 Oct: the instruction never reached the model),
    # so RL ran without its rule, and H puts its instruction in the prompt, as the person would ask (run_long).
    if base == "R":
        cmd += ["--append-system-prompt", ROUTING]
    return cmd


def cmd_prepare(args):
    if not LONG_REPO.exists():
        shutil.copytree(BASE, LONG_REPO, symlinks=True)
    model = args.model
    p = subprocess.run(["claude", "-p", PREP_PROMPT, "--model", model, "--permission-mode", "auto", "--output-format", "json", *conditions("P" if args.pack else "V")],
                       cwd=LONG_REPO, capture_output=True, text=True, timeout=1800, stdin=subprocess.DEVNULL)
    res = json.loads(p.stdout)
    (LONG_SESSION_PACK if args.pack else LONG_SESSION).write_text(res["session_id"])
    a = account(res["session_id"])
    print(f"prepared {res['session_id']}: {a.get('main_requests')} requests, context {a.get('peak_context')}, ${res.get('total_cost_usd', 0):.2f}")


def reset_long():
    subprocess.run(["git", "checkout", "-q", "--", "."], cwd=LONG_REPO)
    subprocess.run(["git", "clean", "-q", "-fdx", "-e", "*.egg-info"], cwd=LONG_REPO)


def run_long(task: str, arm: str, rep: int) -> dict:
    reset_long()
    run_id = f"{task}.{arm}.{rep}.{int(time.time())}"
    prompt = TASKS[task]["prompt"]
    if arm.startswith("H"):
        prompt = f"{FORCE}\n\n{prompt}"
    if arm == "DL":
        prompt = f"{prompt}\n\n{FIT}"
    cmd = ["claude", "-p", prompt, "--resume", session_file(arm).read_text().strip(), "--fork-session",
           "--model", "opus", "--permission-mode", "auto", "--output-format", "json", *conditions(arm)]
    started = time.time()
    try:
        p = subprocess.run(cmd, cwd=LONG_REPO, capture_output=True, text=True, timeout=1800, stdin=subprocess.DEVNULL)
        out, err = p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        out, err = (e.stdout or b"").decode() if isinstance(e.stdout, bytes) else (e.stdout or ""), "timeout"
    wall = time.time() - started
    try:
        res = json.loads(out)
    except json.JSONDecodeError:
        res = {}
    answer = res.get("result") or ""
    row = {
        "run": run_id, "task": task, "arm": arm, "rep": rep, "wall_s": round(wall, 1), "long": True,
        "prepared": "pack" if session_file(arm) == LONG_SESSION_PACK else "plain",
        "session": res.get("session_id"), "reported_usd": res.get("total_cost_usd"), "is_error": res.get("is_error", True),
        "answer": answer[:4000], "stderr": err[-500:] if err else "",
    }
    row["grade"] = grade(task, answer, LONG_REPO)
    if task in ("t2-rename", "l1-feature", "l2-coverage"):
        subprocess.run(["git", "add", "-A", "-N", "."], cwd=LONG_REPO, capture_output=True)
        diff = subprocess.run(["git", "diff", "--binary", "HEAD", "--", ".", ":(exclude).coverage", ":(exclude)*.pyc", ":(exclude)__pycache__"], cwd=LONG_REPO, capture_output=True, text=True).stdout
        (HERE / "patches" / f"{run_id}.patch").write_text(diff)
        subprocess.run(["git", "reset", "-q"], cwd=LONG_REPO)
    if row["session"]:
        # A resumed session's reported cost includes the history it forked: what this run cost is what the
        # transcript holds from its start on (the copied history keeps its own, earlier timestamps).
        row["cost"] = account(row["session"], since=started)
    return row


def cmd_long(args):
    arms, tasks = args.arms.split(","), args.tasks.split(",") if args.tasks else list(TASKS)
    for a in arms:
        if not session_file(a).exists():
            sys.exit(f"no prepared session for {a}: run bench.py prepare{' --pack' if session_file(a) == LONG_SESSION_PACK else ''} first")
    plan = [(t, a, r) for r in range(1, args.reps + 1) for t in tasks for a in arms]
    print(f"{len(plan)} long runs, one at a time", flush=True)
    with open(RESULTS, "a") as f:
        for x in plan:
            row = run_long(*x)
            f.write(json.dumps(row) + "\n")
            f.flush()
            c = row.get("cost", {})
            print(f"{row['task']:11} {row['arm']} r{row['rep']}  score {row['grade']['score']:.2f}  reported ${row.get('reported_usd') or 0:.3f}  counted ${c.get('main_usd', 0) + c.get('worker_usd', 0):.3f}  "
                  f"main {c.get('main_requests', '?')} req  worker {c.get('worker_requests', 0)} req  hand_offs {c.get('hand_offs', 0)}  {row['wall_s']:.0f}s", flush=True)


def cmd_run(args):
    if not BASE.exists() or not VENV.exists():
        sys.exit(f"missing {BASE} or {VENV}: clone click 8.5.0 there and make the venv first")
    arms, tasks = args.arms.split(","), args.tasks.split(",") if args.tasks else list(TASKS)
    plan = [(t, a, r) for r in range(1, args.reps + 1) for t in tasks for a in arms]
    print(f"{len(plan)} runs, {args.jobs} at a time", flush=True)
    with cf.ThreadPoolExecutor(args.jobs) as pool, open(RESULTS, "a") as f:
        for fut in cf.as_completed([pool.submit(run_one, *x) for x in plan]):
            row = fut.result()
            f.write(json.dumps(row) + "\n")
            f.flush()
            c = row.get("cost", {})
            print(f"{row['task']:11} {row['arm']} r{row['rep']}  score {row['grade']['score']:.2f}  ${c.get('main_usd', 0) + c.get('worker_usd', 0):.3f}  "
                  f"main {c.get('main_requests', '?')} req  worker {c.get('worker_requests', 0)} req  hand_offs {c.get('hand_offs', 0)}  {row['wall_s']:.0f}s", flush=True)


def cmd_report(_args):
    rows = [json.loads(l) for l in open(RESULTS)] if RESULTS.exists() else []
    # Costs are frozen into results.jsonl; recomputed from the transcripts where they are still on this machine.
    for r in rows:
        if r.get("session"):
            c = account(r["session"])
            if c.get("found"):
                r["cost"] = c
    rows = [r for r in rows if r.get("cost", {}).get("found")]
    if not rows:
        sys.exit("no results")
    import statistics as st

    def mean(xs):
        return st.mean(xs) if xs else float("nan")

    print(f"{len(rows)} runs\n")
    head = f"{'task':11} {'arm':3} {'n':>2} {'score':>6} {'total $':>8} {'main $':>7} {'worker $':>8} {'main req':>8} {'wkr req':>7} {'hand':>4} {'wall s':>6}   {'+200k ctx $':>11} {'+600k ctx $':>11} {'added ctx':>9}"
    print(head)
    print("-" * len(head))
    for task in TASKS:
        for arm in "ANBGCDEFIS":
            rs = [r for r in rows if r["task"] == task and r["arm"] == arm]
            if not rs:
                continue
            # Claude Code's own total: it includes forked reviews, which no transcript holds.
            tot = [r.get("reported_usd") or (r["cost"]["main_usd"] + r["cost"]["worker_usd"] + r["cost"].get("review_usd", 0)) for r in rs]
            # What the same run would cost in a session already holding X tokens: every main
            # request re-reads them from cache (Opus 5.5 cache read, $0.20/M).
            proj = lambda x: mean([t + (r["cost"]["main_requests"] + r["cost"].get("forks", 0)) * x * PRICES["opus"]["read"] / 1e6 for t, r in zip(tot, rs)])
            print(f"{task:11} {arm:3} {len(rs):>2} {mean([r['grade']['score'] for r in rs]):>6.2f} {mean(tot):>8.3f} {mean([r['cost']['main_usd'] for r in rs]):>7.3f} "
                  f"{mean([r['cost']['worker_usd'] for r in rs]):>8.4f} {mean([r['cost']['main_requests'] for r in rs]):>8.1f} {mean([r['cost']['worker_requests'] for r in rs]):>7.1f} "
                  f"{mean([r['cost']['hand_offs'] for r in rs]):>4.1f} {mean([r['wall_s'] for r in rs]):>6.0f}   {proj(200_000):>11.3f} {proj(600_000):>11.3f} {mean([r['cost']['added_context'] for r in rs]):>9.0f}")
        print()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--reps", type=int, default=2)
    r.add_argument("--arms", default="A,B,C")
    r.add_argument("--tasks", default="")
    r.add_argument("--jobs", type=int, default=4)
    sub.add_parser("report")
    pr = sub.add_parser("prepare")
    pr.add_argument("--model", default="opus")
    pr.add_argument("--pack", action="store_true", help="prepare with the pack loaded, for PL and HL")
    lo = sub.add_parser("long")
    lo.add_argument("--reps", type=int, default=2)
    lo.add_argument("--arms", default="VL,RL")
    lo.add_argument("--tasks", default="")
    a = ap.parse_args()
    {"run": cmd_run, "report": cmd_report, "prepare": cmd_prepare, "long": cmd_long}[a.cmd](a)
