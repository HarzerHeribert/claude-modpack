"""What compacting a long session before a task costs and saves, by kind of task.

A long Claude Code session over click (it read all of src/click, was told four decisions for the repository, and
investigated a bug without changing anything) is forked once per run. Arms:

  KEEP      fork the prepared session and run the task
  COMPACT   fork it with `/compact` (no instructions), then run the task on the compacted session
  COMPACTI  as COMPACT, with instructions: keep every decision, convention and constraint, and every finding, verbatim
  PREP      smart-compact's summary written ahead: a fork asked smart-compact's own prompt (smart-compact/hooks/summary.ts),
            then `/compact` answered by prep-mod as smart-compact's hook answers its own: SUMMARY_HEAD and the summary, then
            the messages after the last on the person's side, as they are

Tasks, by what they need from the session:

  files   (needs what the session read)  F1 t2-rename, F2 l1-feature: bench's own tasks and graders; whether the change
          followed the decisions is recorded as extra checks that do not count in the score
  memory  (needs what the person said)   M1 m1-helper (the decisions), M2 m2-fix (the investigation)
  fresh   (needs nothing of the session) N1 n1-workflow, N2 n2-script

The decisions (T2 of the preparation) and the planted bug's investigation (T3) exist in the conversation only: no
prompt of a task restates them. The prepared session of slot k lives in WORK/compact/slot-k/ beside its own copy of
click (the history holds that folder's absolute paths); rep r of a run uses slot r, the slots in parallel (one
thread each), the runs within a slot one at a time, the repository reset to its committed (bugged) state before each.

  python3 compact_bench.py prepare [--slots 3]     # the real preparation: costs money
  python3 compact_bench.py plan [--arms ..] [--tasks ..] [--reps 3]
  python3 compact_bench.py run  [--arms KEEP,COMPACT,COMPACTI] [--tasks ..] [--reps 3]   # costs money
  python3 compact_bench.py report
  python3 compact_bench.py selftest                # no claude call: base scores <= 0.5, the reference 1.0

Results: results-compact.jsonl (env BENCH_RESULTS overrides), diffs in patches/<run>.patch.
"""
import argparse
import concurrent.futures as cf
import glob
import json
import os
import random
import re
import shutil
import statistics as st
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import bench

HERE = bench.HERE
HIDDEN = HERE / "hidden" / "compact_reference"
COMPACT_DIR = bench.WORK / "compact"
RESULTS = Path(os.environ.get("BENCH_RESULTS", HERE / "results-compact.jsonl"))
VENV_PY = bench.VENV / "bin" / "python"

ARMS = ("KEEP", "COMPACT", "COMPACTI", "COMPACTH", "COMPACT3", "PREP")
COMPACT_ARGS = {
    "KEEP": None,
    "COMPACT": "",
    "PREP": "",
    "COMPACTI": "Keep every decision, convention and constraint the person stated, and every finding of an investigation, verbatim with file, function and line.",
    # COMPACTH: the summary written by Haiku (the /compact step runs with --model haiku), the task on Opus.
    "COMPACTH": "",
    # COMPACT3: three compactions with reading work between them before the task: does detail erode with each summary
    # of a summary? The work between (FILLERS) adds context to summarize and is priced apart, not in the compaction.
    "COMPACT3": "",
}
COMPACT_MODEL = {"COMPACTH": "haiku"}
CYCLES = {"COMPACT3": 3}
SUMMARY_TS = bench.PACK_ROOT / "smart-compact" / "hooks" / "summary.ts"
PREP_MOD = HERE / "prep-mod"


def summary_texts() -> tuple[str, str]:
    """smart-compact's SUMMARY_PROMPT and SUMMARY_HEAD, as its summary.ts has them."""
    src = SUMMARY_TS.read_text()
    prompt = re.search(r"export const SUMMARY_PROMPT = `([^`]*)`", src)
    head = re.search(r"export const SUMMARY_HEAD = `([^`]*)`", src)
    if prompt is None or head is None:
        sys.exit(f"SUMMARY_PROMPT or SUMMARY_HEAD not found in {SUMMARY_TS}")
    return prompt.group(1), head.group(1)
FILLERS = [
    "Before the next item: read src/click/core.py and src/click/parser.py again and tell me in five sentences how a command line "
    "becomes a call of the command's callback. Change nothing.",
    "One more question first: read src/click/termui.py and src/click/_termui_impl.py again and tell me in five sentences how "
    "click.progressbar draws its bar. Change nothing.",
]
VERSION = "8.5.1"

# --------------------------------------------------------------------------------------------------------------------
# The planted bug (M2): clamping an open upper bound moves the wrong way. _NumberRangeBase.convert passes direction -1
# for the maximum (the value just inside the range is bound - 1); with +1, IntRange(max=5, max_open=True, clamp=True)
# turns 9 into 6, outside the range. FloatRange raises for open clamps, so only IntRange shows it.
# Breaks: tests/test_types.py::test_range[type8-5-4]  (one test; the rest of the suite, 1989 tests, passes).
# --------------------------------------------------------------------------------------------------------------------
BUG_FILE = "src/click/types.py"
BUG_GOOD = "return self._clamp(max, -1, self.max_open)"
BUG_BAD = "return self._clamp(max, 1, self.max_open)"
BUG_TESTS = ["tests/test_types.py::test_range"]  # the existing test (all its cases) that the bug breaks
BUG_FAILING = ["tests/test_types.py::test_range[type8-5-4]"]


def plant(repo: Path):
    p = repo / BUG_FILE
    text = p.read_text()
    assert text.count(BUG_GOOD) == 1, BUG_FILE
    p.write_text(text.replace(BUG_GOOD, BUG_BAD))
    git(repo, "commit", "-q", "-am", "planted bug")


def git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-c", "user.email=bench@local", "-c", "user.name=bench", *args], cwd=repo, capture_output=True, text=True, check=check)


def make_repo(repo: Path):
    """A fresh copy of click with the planted bug, committed, so a reset returns to the bugged state."""
    shutil.copytree(bench.BASE, repo, symlinks=True)
    git(repo, "reset", "-q", "--hard")
    git(repo, "clean", "-q", "-fdx", "-e", "*.egg-info")
    plant(repo)


def reset(repo: Path):
    git(repo, "reset", "-q", "--hard", "HEAD", check=False)
    git(repo, "clean", "-q", "-fdx", "-e", "*.egg-info", check=False)


# --------------------------------------------------------------------------------------------------------------------
# The preparation prompts
# --------------------------------------------------------------------------------------------------------------------
# This click keeps its changelog in CHANGES.md (Markdown: `## Version 8.5.0`, entries starting `- `), not CHANGES.rst.
DECISIONS = (
    "Before we start on the backlog, decisions for this repository that hold for everything you do in it from now on: "
    "(1) every new public function or class gets the docstring line `.. versionadded:: 8.5.1`; "
    "(2) every new command-line option gets show_default=True; "
    "(3) never edit src/click/_compat.py, our packaging vendors it; "
    "(4) every change gets an entry in CHANGES.md under a section titled `## Version 8.5.1` at the top of the file, above `## Version 8.5.0`, "
    "each entry starting with `- ` as click's own entries do. "
    "Reply only: noted."
)
INVESTIGATION = (
    "Users report a bug. An option declared with `type=click.IntRange(max=5, max_open=True, clamp=True)` is meant to pull a too-large "
    "value back to the largest value the range allows (4, since 5 is excluded), but a user who passes 9 gets 6, which is outside the range. "
    "The same with a min_open lower bound behaves correctly. Find the cause: tell me the file, the function and the line, and what the fix would be. "
    "Do NOT change anything yet: no edits, nothing written to any file."
)

# --------------------------------------------------------------------------------------------------------------------
# The tasks
# --------------------------------------------------------------------------------------------------------------------
M1_PROMPT = (
    "Add two things to this repository (click).\n"
    "1. A function `format_filesize(num_bytes)` in src/click/utils.py, exported as `click.format_filesize`. It takes a non-negative int and returns a str. "
    "A negative number raises ValueError(\"num_bytes must not be negative\"). Units are powers of 1024: B, KiB, MiB, GiB, TiB. "
    "Under 1024 it is the integer and ` B` (\"0 B\", \"1023 B\"). From 1024 on, use the largest unit (up to TiB) in which the value is at least 1, "
    "shown rounded half up to one decimal and always with one decimal (\"1.0 KiB\", \"1.5 KiB\"); half up means 1.25 KiB is \"1.3 KiB\". "
    "If the rounding makes the value 1024.0 in a unit below TiB, show it in the next unit instead (1048575 bytes is \"1.0 MiB\"). "
    "Above 1024 TiB it stays in TiB (2048 TiB is \"2048.0 TiB\").\n"
    "2. An example command in a new file examples/filesize/filesize.py: a click command object named `cli`, with a variadic integer argument `sizes` "
    "(any number, also none) and a flag option `--human` (off by default). For each size it prints one line: with `--human` the result of "
    "`format_filesize(size)`, without it the integer as it is.\n"
    "Follow this repository's decisions."
)
M2_PROMPT = "Fix the bug you found earlier and add a regression test for it."
N1_PROMPT = (
    "Add a GitHub Actions workflow to this repository (click) at .github/workflows/lint.yml. It runs on every push to the main branch and on every pull request. "
    "It has one job, on ubuntu-latest, with these steps in order: check out the code with actions/checkout; set up Python 3.12 with actions/setup-python; "
    "install ruff with pip; run `ruff check src tests`."
)
N2_PROMPT = (
    "Add a script scripts/count_lines.py to this repository (click). Run from the repository root as `python3 scripts/count_lines.py`, it prints, "
    "for every .py file anywhere under src/click, one line `<lines> <path>`: the number of lines as `wc -l` counts them (newline characters), "
    "a space, and the path relative to the repository root with forward slashes (src/click/core.py). Sort by lines, largest first, and files with "
    "the same count by path in ascending order. It prints nothing else and exits 0."
)

TASKS = {
    "t2-rename": {"kind": "files", "label": "F1", "prompt": bench.TASKS["t2-rename"]["prompt"], "reference": True},
    "l1-feature": {"kind": "files", "label": "F2", "prompt": bench.TASKS["l1-feature"]["prompt"], "reference": True},
    "m1-helper": {"kind": "memory", "label": "M1", "prompt": M1_PROMPT},
    "m2-fix": {"kind": "memory", "label": "M2", "prompt": M2_PROMPT},
    "n1-workflow": {"kind": "fresh", "label": "N1", "prompt": N1_PROMPT},
    "n2-script": {"kind": "fresh", "label": "N2", "prompt": N2_PROMPT},
}
KINDS = ("files", "memory", "fresh")


# --------------------------------------------------------------------------------------------------------------------
# Graders
# --------------------------------------------------------------------------------------------------------------------
def sh(cmd: str, repo: Path, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, cwd=repo, capture_output=True, text=True, timeout=timeout)


def pytest_hidden(repo: Path, task: str, name: str, dest: str | None = None) -> dict:
    """Copies hidden/compact_reference/<task>/<name> into tests/, runs it, removes it."""
    hidden = repo / "tests" / (dest or f"test_zz_hidden_{name}")
    shutil.copy(HIDDEN / task / name, hidden)
    try:
        h = sh(f"{bench.TEST} -p no:cacheprovider --tb=no {hidden.relative_to(repo)}", repo)
    finally:
        hidden.unlink(missing_ok=True)
    passed = int((re.search(r"(\d+) passed", h.stdout) or [0, 0])[1])
    failed = int((re.search(r"(\d+) failed", h.stdout) or [0, 0])[1]) + int((re.search(r"(\d+) error", h.stdout) or [0, 0])[1])
    return {"ok": h.returncode == 0 and passed > 0 and not failed, "passed": passed, "failed": failed}


def compat_untouched(repo: Path) -> bool:
    return not git(repo, "status", "--porcelain", "--", "src/click/_compat.py", check=False).stdout.strip()


def changes_entry(repo: Path) -> bool:
    """CHANGES.md: the first section is `## Version 8.5.1`, with at least one `- text` entry in click's style (no `*`, no `-   `)."""
    p = repo / "CHANGES.md"
    if not p.is_file():
        return False
    lines = p.read_text().splitlines()
    heads = [i for i, l in enumerate(lines) if l.startswith("## ")]
    if not heads or lines[heads[0]].strip() != f"## Version {VERSION}":
        return False
    body = lines[heads[0] + 1:heads[1] if len(heads) > 1 else len(lines)]
    entries = [l for l in body if re.match(r"^- \S", l)]
    odd = [l for l in body if re.match(r"^(\*|\+|-\s{2,})\S", l)]
    return bool(entries) and not odd


def docstring_has(repo: Path, expr: str, needle: str) -> bool:
    """Whether the docstring of `expr` (e.g. click.utils.format_filesize) holds `needle`; false if it cannot be imported."""
    code = f"import inspect, importlib; m, _, n = {expr!r}.rpartition('.'); o = getattr(importlib.import_module(m), n); print({needle!r} in (inspect.getdoc(o) or ''))"
    r = subprocess.run([str(VENV_PY), "-c", code], cwd=repo, capture_output=True, text=True, env={**os.environ, "PYTHONPATH": "src"}, timeout=120)
    return r.stdout.strip() == "True"


def new_test_functions(repo: Path) -> int:
    """Test functions in tests/ now, less those at HEAD (a new parameter case in an old test does not count)."""
    def count(text: str) -> int:
        return len(re.findall(r"^\s*(?:async\s+)?def (test\w*)\(", text, re.M))
    now = sum(count(p.read_text(errors="replace")) for p in (repo / "tests").rglob("*.py"))
    files = git(repo, "ls-tree", "-r", "--name-only", "HEAD", "--", "tests", check=False).stdout.split()
    before = sum(count(git(repo, "show", f"HEAD:{f}", check=False).stdout) for f in files if f.endswith(".py"))
    return now - before


def result(checks: dict[str, bool], **extra) -> dict:
    failed = [k for k, v in checks.items() if not v]
    return {"score": (len(checks) - len(failed)) / len(checks) if checks else 0.0, "checks": checks, "failed": failed, **extra}


def decisions(repo: Path, versionadded: bool | None) -> dict:
    """Did the change follow the decisions? versionadded is None where the task adds nothing public."""
    return {"versionadded": versionadded, "changes_entry": changes_entry(repo), "compat_untouched": compat_untouched(repo)}


def grade_files(task: str, answer: str, repo: Path) -> dict:
    """bench's grader, as bench has it; the planted bug is taken out for the moment (the suite must pass for bench's score,
    and the bug is not this task's)."""
    p = repo / BUG_FILE
    text = p.read_text()
    p.write_text(text.replace(BUG_BAD, BUG_GOOD) if text.count(BUG_BAD) == 1 else text)
    try:
        g = bench.grade(task, answer, repo)
    finally:
        p.write_text(text)
    va = docstring_has(repo, "click.Duration", f".. versionadded:: {VERSION}") if task == "l1-feature" else None
    return {"score": g["score"], "checks": {"bench_grade": g["score"] >= 0.999}, "failed": [] if g["score"] >= 0.999 else ["bench_grade"],
            "bench": g, "decisions": decisions(repo, va)}


def grade_m1(task: str, answer: str, repo: Path) -> dict:
    fn = pytest_hidden(repo, task, "test_format_filesize.py")
    opt = pytest_hidden(repo, task, "test_human_option.py")
    return result({
        "function_behaviour": fn["ok"],
        "option_behaviour": opt["ok"],
        "versionadded": docstring_has(repo, "click.utils.format_filesize", f".. versionadded:: {VERSION}"),
        "show_default": option_show_default(repo),
        "changes_entry": changes_entry(repo),
        "compat_untouched": compat_untouched(repo),
    }, hidden={"function": fn, "option": opt})


def option_show_default(repo: Path) -> bool:
    """Every option of the example command (the help option aside) has show_default=True, and there is a --human."""
    code = ("import importlib.util, click\n"
            "s = importlib.util.spec_from_file_location('fs_example', 'examples/filesize/filesize.py'); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)\n"
            "ps = [p for p in m.cli.params if isinstance(p, click.Option)]\n"
            "print(any('--human' in p.opts for p in ps) and all(p.show_default is True for p in ps))")
    r = subprocess.run([str(VENV_PY), "-c", code], cwd=repo, capture_output=True, text=True, env={**os.environ, "PYTHONPATH": "src"}, timeout=120)
    return r.stdout.strip() == "True"


def grade_m2(task: str, answer: str, repo: Path) -> dict:
    existing = sh(f"{bench.TEST} -p no:cacheprovider --tb=no {' '.join(BUG_TESTS)}", repo)
    hid = pytest_hidden(repo, task, "test_hidden.py")
    return result({
        "existing_tests_pass": existing.returncode == 0,
        "regression_test_passes": hid["ok"],
        # A new test function, or a new case in an existing parametrized test that exercises the range (the smoke run's
        # regression test was `(click.IntRange(max=5, max_open=True, clamp=True), "9", 4)` added to test_range).
        "test_added": new_test_functions(repo) >= 1 or bool(re.search(r"^\+(?!\+\+).*IntRange\(", git(repo, "diff", "HEAD", "--", "tests", check=False).stdout, re.M)),
        "compat_untouched": compat_untouched(repo),
        "changes_entry": changes_entry(repo),
    }, hidden=hid)


def _triggers(doc: dict) -> dict:
    on = doc.get("on", doc.get(True))  # YAML 1.1 reads a bare `on` as True
    if isinstance(on, dict):
        return on
    if isinstance(on, list):
        return {str(x): None for x in on}
    return {str(on): None} if on else {}


def grade_n1(task: str, answer: str, repo: Path) -> dict:
    import yaml
    p = repo / ".github" / "workflows" / "lint.yml"
    keys = ["file_parses", "push_main", "pull_request", "one_job", "ubuntu_latest", "checkout_first", "python_312", "installs_ruff", "runs_ruff_check", "steps_in_order"]
    checks = dict.fromkeys(keys, False)
    try:
        doc = yaml.safe_load(p.read_text())
        assert isinstance(doc, dict)
    except Exception:
        return result(checks)
    checks["file_parses"] = True
    trig = _triggers(doc)
    push = trig.get("push")
    branches = push.get("branches") if isinstance(push, dict) else None
    branches = [branches] if isinstance(branches, str) else branches
    checks["push_main"] = "push" in trig and isinstance(push, dict) and "main" in (branches or []) and "tags" not in push
    checks["pull_request"] = "pull_request" in trig
    jobs = doc.get("jobs") or {}
    checks["one_job"] = isinstance(jobs, dict) and len(jobs) == 1
    job = next(iter(jobs.values())) if checks["one_job"] and isinstance(next(iter(jobs.values())), dict) else {}
    ro = job.get("runs-on")
    checks["ubuntu_latest"] = ro == "ubuntu-latest" or ro == ["ubuntu-latest"]
    steps = [s for s in (job.get("steps") or []) if isinstance(s, dict)]

    def first(pred) -> int:
        return next((i for i, s in enumerate(steps) if pred(s)), -1)

    def uses(s, name):
        return str(s.get("uses", "")).startswith(name)

    ck = first(lambda s: uses(s, "actions/checkout"))
    sp = first(lambda s: uses(s, "actions/setup-python") and str((s.get("with") or {}).get("python-version", "")).strip() == "3.12")
    ins = first(lambda s: re.search(r"\bpip3?\s+install\b[^\n]*\bruff\b", str(s.get("run", ""))) is not None)
    rf = first(lambda s: any(re.fullmatch(r"ruff check src tests", l.strip()) for l in str(s.get("run", "")).splitlines()))
    checks["checkout_first"] = ck == 0
    checks["python_312"] = sp >= 0
    checks["installs_ruff"] = ins >= 0
    checks["runs_ruff_check"] = rf >= 0
    checks["steps_in_order"] = 0 <= ck < sp < ins < rf
    return result(checks, decisions=decisions(repo, None))


def grade_n2(task: str, answer: str, repo: Path) -> dict:
    script = repo / "scripts" / "count_lines.py"
    truth = sorted(((p.read_bytes().count(b"\n"), p.relative_to(repo).as_posix()) for p in (repo / "src" / "click").rglob("*.py")), key=lambda x: (-x[0], x[1]))
    checks = dict.fromkeys(["script_exists", "runs_ok", "files_listed", "counts_right", "order_right", "nothing_else"], False)
    if not script.is_file():
        return result(checks)
    checks["script_exists"] = True
    try:
        r = subprocess.run([sys.executable, "scripts/count_lines.py"], cwd=repo, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return result(checks)
    checks["runs_ok"] = r.returncode == 0
    rows = []
    for l in r.stdout.splitlines():
        m = re.fullmatch(r"(\d+) (\S.*)", l)
        if m:
            rows.append((int(m[1]), m[2]))
    checks["nothing_else"] = len(rows) == len(r.stdout.splitlines())
    checks["files_listed"] = sorted(p for _, p in rows) == sorted(p for _, p in truth)
    checks["counts_right"] = checks["files_listed"] and dict((p, n) for n, p in rows) == dict((p, n) for n, p in truth)
    checks["order_right"] = rows == truth
    return result(checks, decisions=decisions(repo, None))


def grade(task: str, answer: str, repo: Path) -> dict:
    return {"t2-rename": grade_files, "l1-feature": grade_files, "m1-helper": grade_m1, "m2-fix": grade_m2,
            "n1-workflow": grade_n1, "n2-script": grade_n2}[task](task, answer, repo)


# --------------------------------------------------------------------------------------------------------------------
# claude
# --------------------------------------------------------------------------------------------------------------------
def settings_flags(extra_dirs: tuple[Path, ...] = (), env: dict | None = None) -> list[str]:
    """Arm Z7's plugins as bench.run_one builds an ablation arm's settings, with smart-compact's strategy off so it never compacts alone."""
    dirs = ":".join([str(bench.PACK_ROOT / m) for m in bench.ABLATION["Z7"]] + [str(d) for d in extra_dirs])
    off = {"options": {"strategy": "off"}}
    return ["--settings", json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": dirs, **(env or {})}, "pluginConfigs": {"smart-compact": off, "smart-compact@inline": off}})]


def claude(prompt: str, repo: Path, resume: str | None = None, fork: bool = False, timeout: int = 1800, model: str = "opus",
           extra_dirs: tuple[Path, ...] = (), env: dict | None = None, max_turns: int | None = None) -> dict:
    cmd = ["claude", "-p", prompt, "--model", model, "--permission-mode", "auto", "--output-format", "json"]
    if resume:
        cmd += ["--resume", resume]
    if fork:
        cmd += ["--fork-session"]
    if max_turns is not None:
        cmd += ["--max-turns", str(max_turns)]
    cmd += settings_flags(extra_dirs, env)
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


def first_context(session: str, since: float) -> int | None:
    for path in glob.glob(str(bench.PROJECTS / "*" / f"{session}.jsonl")):
        reqs = bench.requests_of(path, since)
        if reqs:
            return bench.ctx(reqs[0])
    return None


def slot_dir(k: int) -> Path:
    return COMPACT_DIR / f"slot-{k}"


# --------------------------------------------------------------------------------------------------------------------
# prepare
# --------------------------------------------------------------------------------------------------------------------
def prepare_slot(k: int, force: bool = False) -> dict:
    d = slot_dir(k)
    repo, sess = d / "repo", d / "session.txt"
    if sess.exists() and not force:
        return {"slot": k, "skipped": "session.txt exists (use --force to redo)"}
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    make_repo(repo)
    turns, session, total = [], None, 0.0
    for name, prompt in (("T1 read", bench.PREP_PROMPT), ("T2 decisions", DECISIONS), ("T3 investigation", INVESTIGATION)):
        res = claude(prompt, repo, resume=session)
        if not res.get("session_id") or res.get("is_error"):
            return {"slot": k, "error": f"{name} failed: {(res.get('result') or res.get('_stderr') or '')[:300]}"}
        session = res["session_id"]
        # total_cost_usd of a resumed session is its running total since the session began, not this turn's own cost.
        running = res.get("total_cost_usd") or 0
        turns.append({"turn": name, "reply": (res.get("result") or "")[:600], "usd": running - total, "running_usd": running})
        total = running
    sess.write_text(session)
    clean = git(repo, "status", "--porcelain", check=False).stdout.strip()
    a = bench.account(session)
    info = {"slot": k, "session": session, "requests": a.get("main_requests"), "peak_context": a.get("peak_context"), "usd": total,
            "repo_clean_after_T3": not clean, "dirty": clean.splitlines()[:10], "turns": turns}
    (d / "prep.json").write_text(json.dumps(info, indent=1))
    return info


def cmd_prepare(args):
    if not bench.BASE.exists() or not bench.VENV.exists():
        sys.exit(f"missing {bench.BASE} or {bench.VENV}")
    with cf.ThreadPoolExecutor(args.slots) as pool:
        for info in pool.map(lambda k: prepare_slot(k, args.force), range(1, args.slots + 1)):
            if "session" in info:
                print(f"slot {info['slot']}: {info['session']}  {info['requests']} requests, peak context {info['peak_context']}, ${info['usd']:.2f}")
                for t in info["turns"]:
                    print(f"   {t['turn']:17} ${t['usd'] or 0:.2f}  {t['reply'][:100]!r}")
                if not info["repo_clean_after_T3"]:
                    print(f"   WARNING: the investigation changed the repository: {info['dirty']}")
            else:
                print(f"slot {info['slot']}: {info.get('skipped') or 'ERROR ' + info.get('error', '')}")


# --------------------------------------------------------------------------------------------------------------------
# run
# --------------------------------------------------------------------------------------------------------------------
LOCK = threading.Lock()


def save_diff(repo: Path, run_id: str):
    git(repo, "add", "-A", "-N", ".", check=False)
    diff = git(repo, "diff", "--binary", "HEAD", "--", ".", ":(exclude).coverage", ":(exclude)*.pyc", ":(exclude)__pycache__", check=False).stdout
    (HERE / "patches").mkdir(exist_ok=True)
    (HERE / "patches" / f"{run_id}.patch").write_text(diff)
    git(repo, "reset", "-q", check=False)


def base_running(k: int) -> float:
    """The prepared session's running total, which a fork's reported cost starts from: the last turn's reported figure."""
    info = json.loads((slot_dir(k) / "prep.json").read_text())
    last = info["turns"][-1]
    return float(last.get("running_usd", last.get("usd")) or 0.0)


def run_one(task: str, arm: str, rep: int) -> dict:
    k = rep
    d = slot_dir(k)
    repo = d / "repo"
    base_session = (d / "session.txt").read_text().strip()
    reset(repo)
    run_id = f"{task}.{arm}.{rep}.{int(time.time())}.{os.getpid()}"
    row = {"run": run_id, "task": task, "kind": TASKS[task]["kind"], "arm": arm, "rep": rep, "slot": k, "base_session": base_session,
           "compaction_usd": 0.0, "compact_session": None}
    t0 = time.time()
    if COMPACT_ARGS[arm] is None:
        resume, fork = base_session, True
    elif arm == "PREP":
        # Both steps fork the prepared session, so each costs its running total less the session's.
        base = base_running(k)
        prompt, head = summary_texts()
        s = claude(prompt, repo, resume=base_session, fork=True, timeout=1200, max_turns=1)
        summary = (s.get("result") or "").strip()
        row["summary_usd"] = (s.get("total_cost_usd") or base) - base
        # Its price hangs on whether the slot's cache was warm (a session's own fork reads a warm one): kept to reprice.
        row["summary_usage"] = s.get("usage")
        if not s.get("session_id") or s.get("is_error") or not summary:
            row |= {"is_error": True, "error": f"summary failed: {(s.get('result') or s.get('_stderr') or '')[:300]}", "wall_s": round(time.time() - t0, 1)}
            return row
        (HERE / "patches").mkdir(exist_ok=True)
        first = HERE / "patches" / f"{run_id}.summary.md"
        first.write_text(f"{head}\n\n{summary}")
        row["summary_chars"] = len(summary)
        c = claude("/compact", repo, resume=base_session, fork=True, timeout=1200, extra_dirs=(PREP_MOD,), env={"PREP_SUMMARY_FILE": str(first)})
        row["install_usd"] = (c.get("total_cost_usd") or base) - base
        row["compaction_usd"] = row["summary_usd"] + row["install_usd"]
        if not c.get("session_id") or c.get("is_error"):
            row |= {"is_error": True, "error": f"install failed: {(c.get('result') or c.get('_stderr') or '')[:300]}", "wall_s": round(time.time() - t0, 1)}
            return row
        # prep-mod answered, not the engine: the compacted transcript opens with smart-compact's head.
        paths = glob.glob(str(bench.PROJECTS / "*" / f"{c['session_id']}.jsonl"))
        if not paths or head[:80] not in Path(paths[0]).read_text():
            row |= {"is_error": True, "error": "the compaction was not prep-mod's (smart-compact's head is not in the transcript)", "wall_s": round(time.time() - t0, 1)}
            return row
        running = c.get("total_cost_usd") or base
        row["compact_session"] = c["session_id"]
        row["compact_wall_s"] = round(time.time() - t0, 1)
        resume, fork = c["session_id"], False
    else:
        session, fork, cycles = base_session, True, CYCLES.get(arm, 1)
        row["filler_usd"] = 0.0
        # A fork's reported cost is the session's running total, history included: each step costs the difference.
        running = base_running(k)
        for i in range(cycles):
            c = claude(f"/compact {COMPACT_ARGS[arm]}".rstrip(), repo, resume=session, fork=fork, timeout=1200, model=COMPACT_MODEL.get(arm, "opus"))
            step = (c.get("total_cost_usd") or running) - running
            running = c.get("total_cost_usd") or running
            row["compaction_usd"] += step
            row.setdefault("compaction_steps_usd", []).append(round(step, 4))
            if not c.get("session_id") or c.get("is_error"):
                row |= {"is_error": True, "error": f"compaction {i + 1} failed: {(c.get('result') or c.get('_stderr') or '')[:300]}", "wall_s": round(time.time() - t0, 1)}
                return row
            session, fork = c["session_id"], False
            if i + 1 < cycles:
                f = claude(FILLERS[i % len(FILLERS)], repo, resume=session)
                row["filler_usd"] += (f.get("total_cost_usd") or running) - running
                running = f.get("total_cost_usd") or running
                if not f.get("session_id") or f.get("is_error"):
                    row |= {"is_error": True, "error": f"filler {i + 1} failed: {(f.get('result') or f.get('_stderr') or '')[:300]}", "wall_s": round(time.time() - t0, 1)}
                    return row
                session = f["session_id"]
        row["compact_session"] = session
        row["compact_wall_s"] = round(time.time() - t0, 1)
        resume, fork = session, False
    started = time.time()
    res = claude(TASKS[task]["prompt"], repo, resume=resume, fork=fork)
    wall = time.time() - started
    answer = res.get("result") or ""
    row |= {"session": res.get("session_id"), "reported_usd": res.get("total_cost_usd"), "is_error": res.get("is_error", True),
            "stderr": res.get("_stderr", ""), "answer": answer[:4000], "wall_s": round(wall, 1), "total_wall_s": round(time.time() - t0, 1)}
    row["grade"] = grade(task, answer, repo)
    save_diff(repo, run_id)
    if row["session"]:
        usage = {m: {k2: u.get(k2) for k2 in ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "costUSD")}
                 for m, u in (res.get("modelUsage") or {}).items()}
        row["model_usage"] = usage
        # The task's cost from its own transcript, as bench.run_long counts a fork (settle would take the history's
        # output in modelUsage, a running total too, for output the transcript left out). The reported figure's
        # difference is kept beside it as a check.
        row["cost"] = bench.account(row["session"], since=started)
        row["reported_task_usd"] = (row["reported_usd"] or 0) - (running if COMPACT_ARGS[arm] is not None else base_running(k))
        row["context_first_request"] = first_context(row["session"], started)
    return row


def slot_worker(k: int, jobs: list[tuple[str, str]], out, quiet: bool = False):
    for task, arm in jobs:
        try:
            row = run_one(task, arm, k)
        except Exception as e:  # one run's failure must not end the slot
            row = {"run": f"{task}.{arm}.{k}.error", "task": task, "kind": TASKS[task]["kind"], "arm": arm, "rep": k, "slot": k, "is_error": True, "error": repr(e)}
        with LOCK:
            out.write(json.dumps(row) + "\n")
            out.flush()
            c = row.get("cost", {})
            g = row.get("grade", {})
            print(f"{TASKS[task]['label']} {task:12} {arm:8} slot {k}  score {g.get('score', float('nan')):.2f}  task ${c.get('main_usd', 0) + c.get('worker_usd', 0):.3f}  "
                  f"compaction ${row.get('compaction_usd', 0):.3f}  ctx {row.get('context_first_request')}  {row.get('wall_s', 0):.0f}s" + (f"  ERROR {row.get('error')}" if row.get("error") else ""), flush=True)


def selected(args) -> tuple[list[str], list[str]]:
    arms = args.arms.split(",")
    tasks = args.tasks.split(",") if args.tasks else list(TASKS)
    for a in arms:
        if a not in ARMS:
            sys.exit(f"unknown arm {a}: {ARMS}")
    for t in tasks:
        if t not in TASKS:
            sys.exit(f"unknown task {t}: {tuple(TASKS)}")
    return arms, tasks


def cmd_run(args):
    arms, tasks = selected(args)
    for k in range(1, args.reps + 1):
        if not (slot_dir(k) / "session.txt").exists():
            sys.exit(f"slot {k} is not prepared: python3 compact_bench.py prepare --slots {args.reps}")
    print(f"{len(tasks) * len(arms) * args.reps} runs, {args.reps} slots in parallel, one run at a time in each", flush=True)
    with open(RESULTS, "a") as out, cf.ThreadPoolExecutor(args.reps) as pool:
        futs = [pool.submit(slot_worker, k, [(t, a) for t in tasks for a in arms], out) for k in range(1, args.reps + 1)]
        for f in futs:
            f.result()


# --------------------------------------------------------------------------------------------------------------------
# plan
# --------------------------------------------------------------------------------------------------------------------
# Rough per-task shape of a run: main-model requests and output tokens per request.
SHAPE = {"t2-rename": (30, 500), "l1-feature": (30, 700), "m1-helper": (16, 600), "m2-fix": (14, 500), "n1-workflow": (6, 600), "n2-script": (6, 500)}
SESSION_CTX = 130_000      # a session that read all of src/click (the preparation's measurement replaces it)
SUMMARY_OUT = 5_000        # a summary's output tokens
SUMMARY_CTX = 12_000       # a compacted session at its first request: summary, system prompt, tools
TOOL_GROWTH = 1_500        # context a request adds to the next


def estimate(task: str, arm: str, ctx0: int = SESSION_CTX) -> tuple[float, float]:
    """(compaction usd, task usd), a rough figure: the first request of a fork writes its context to the cache."""
    p = bench.PRICES["opus"]
    n, out = SHAPE[task]
    comp = 0.0
    start = ctx0
    if arm != "KEEP":
        comp = (ctx0 * p["w5"] + SUMMARY_OUT * p["out"]) / 1e6
        start = SUMMARY_CTX
    reads = sum(start + i * TOOL_GROWTH for i in range(1, n))
    return comp, (start * p["w5"] + reads * p["read"] + n * out * p["out"]) / 1e6


def measured_context() -> int:
    got = []
    for k in range(1, 10):
        f = slot_dir(k) / "prep.json"
        if f.exists():
            got.append(json.loads(f.read_text()).get("peak_context") or 0)
    return int(st.mean(got)) if got and all(got) else SESSION_CTX


def cmd_plan(args):
    arms, tasks = selected(args)
    ctx0 = measured_context()
    print(f"preparation: {args.reps} slots, three turns each (read src/click, the decisions, the investigation), about ${args.reps * 3.0:.0f} in all (rough)")
    print(f"session context assumed {ctx0:,} tokens ({'measured' if ctx0 != SESSION_CTX else 'assumed; replaced by the preparation measurement'})\n")
    print(f"{'slot':>4} {'task':12} {'arm':9} {'est. compaction $':>17} {'est. task $':>12}")
    total = 0.0
    for k in range(1, args.reps + 1):
        for t in tasks:
            for a in arms:
                c, u = estimate(t, a, ctx0)
                total += c + u
                print(f"{k:>4} {t:12} {a:9} {c:>17.2f} {u:>12.2f}")
    n = len(tasks) * len(arms) * args.reps
    print(f"\n{n} runs ({args.reps} slots in parallel, one run at a time in each; a slot runs {len(tasks) * len(arms)}), rough total ${total:.0f} "
          f"(Opus list prices; a guess from request counts, not a measurement). Results to {RESULTS}")


# --------------------------------------------------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------------------------------------------------
def usd(r: dict) -> float:
    c = r["cost"]
    return c["main_usd"] + c["worker_usd"] + c.get("review_usd", 0) + (r.get("compaction_usd") or 0)


def load_rows(path: Path = RESULTS) -> list[dict]:
    rows = [json.loads(l) for l in open(path) if l.strip()] if path.exists() else []
    return [r for r in rows if r.get("cost", {}).get("found") and r.get("grade")]


def bootstrap(rows: list[dict], tasks: list[str], arm: str, ref: str, metric, ratio: bool, n: int = 4000, seed: int = 7) -> tuple[float, float, float] | None:
    """The average over tasks of the per-task mean of `metric`, `arm` against `ref`: change (ratio-1, or the difference) and a 95% interval;
    runs are resampled within each task."""
    cell = {(t, a): [metric(r) for r in rows if r["task"] == t and r["arm"] == a] for t in tasks for a in (arm, ref)}
    if not all(cell[(t, a)] for t in tasks for a in (arm, ref)):
        return None
    rng = random.Random(seed)

    def avg(sample):
        return st.mean(st.mean(x) for x in sample)

    def change(a, b):
        return a / b - 1 if ratio else a - b

    point = change(avg([cell[(t, arm)] for t in tasks]), avg([cell[(t, ref)] for t in tasks]))
    diffs = sorted(change(avg([[rng.choice(cell[(t, arm)]) for _ in cell[(t, arm)]] for t in tasks]), avg([[rng.choice(cell[(t, ref)]) for _ in cell[(t, ref)]] for t in tasks])) for _ in range(n))
    return point, diffs[int(0.025 * n)], diffs[int(0.975 * n)]


def fmt(b, ratio: bool) -> str:
    if b is None:
        return "-"
    return f"{b[0]:+.1%} [{b[1]:+.1%}, {b[2]:+.1%}]" if ratio else f"{b[0]:+.2f} [{b[1]:+.2f}, {b[2]:+.2f}]"


def cmd_report(_args):
    rows = load_rows()
    if not rows:
        sys.exit("no results")
    print(f"{len(rows)} runs ({sum(1 for r in rows if r['grade']['score'] >= 0.999)} at full marks)\n")
    print("per task and arm: mean score, mean cost with the compaction included (task + compaction), context at the task's first request")
    print(f"{'task':12} {'arm':9} {'n':>2} {'score':>6} {'total $':>8} {'task $':>7} {'compact $':>9} {'ctx first':>10} {'requests':>8}")
    for t in TASKS:
        for a in ARMS:
            rs = [r for r in rows if r["task"] == t and r["arm"] == a]
            if rs:
                ctxs = [r["context_first_request"] for r in rs if r.get("context_first_request")]
                print(f"{t:12} {a:9} {len(rs):>2} {st.mean(r['grade']['score'] for r in rs):>6.2f} {st.mean(map(usd, rs)):>8.3f} "
                      f"{st.mean(usd(r) - (r.get('compaction_usd') or 0) for r in rs):>7.3f} {st.mean(r.get('compaction_usd') or 0 for r in rs):>9.3f} "
                      f"{st.mean(ctxs) if ctxs else 0:>10,.0f} {st.mean(r['cost']['main_requests'] for r in rs):>8.1f}")
    print("\nper kind of task: the average task (every task weighs the same), COMPACT and COMPACTI against KEEP, 95% bootstrap interval over runs within each task")
    for kind in KINDS:
        tasks = [t for t in TASKS if TASKS[t]["kind"] == kind]
        kr = [r for r in rows if r["kind"] == kind]
        if not kr:
            continue
        print(f"\n{kind}  ({', '.join(TASKS[t]['label'] + ' ' + t for t in tasks)})")
        print(f"  {'arm':9} {'n':>3} {'score':>6} {'cost $':>8}   {'cost vs KEEP':>30}   {'score vs KEEP (points)':>30}")
        for a in ARMS:
            rs = [r for r in kr if r["arm"] == a]
            if not rs:
                continue
            per_task = lambda f: st.mean(st.mean(f(r) for r in rs if r["task"] == t) for t in tasks if any(r["task"] == t for r in rs))
            line = f"  {a:9} {len(rs):>3} {per_task(lambda r: r['grade']['score']):>6.2f} {per_task(usd):>8.3f}"
            if a != "KEEP":
                line += f"   {fmt(bootstrap(kr, tasks, a, 'KEEP', usd, True), True):>30}   {fmt(bootstrap(kr, tasks, a, 'KEEP', lambda r: r['grade']['score'], False), False):>30}"
            print(line)
    fr = [r for r in rows if r["kind"] == "files"]
    if fr:
        print("\nF1/F2 decisions followed (extra checks, not in the score): share of runs")
        print(f"  {'task':12} {'arm':9} {'n':>2} {'versionadded':>13} {'changes entry':>14} {'_compat.py untouched':>21}")
        for t in ("t2-rename", "l1-feature"):
            for a in ARMS:
                rs = [r for r in fr if r["task"] == t and r["arm"] == a]
                if not rs:
                    continue

                def share(key):
                    vals = [r["grade"]["decisions"][key] for r in rs if r["grade"].get("decisions", {}).get(key) is not None]
                    return f"{sum(vals)}/{len(vals)}" if vals else "n/a"
                print(f"  {t:12} {a:9} {len(rs):>2} {share('versionadded'):>13} {share('changes_entry'):>14} {share('compat_untouched'):>21}")


# --------------------------------------------------------------------------------------------------------------------
# selftest
# --------------------------------------------------------------------------------------------------------------------
def selftest():
    """For every task, on a scratch copy of click with the planted bug: the base scores <= 0.5; hidden/compact_reference/<task>/reference.patch laid over it, 1.0."""
    if not bench.BASE.exists() or not bench.VENV.exists():
        sys.exit(f"missing {bench.BASE} or {bench.VENV}")
    bad = False
    for task in TASKS:
        for label in ("base", "reference"):
            with tempfile.TemporaryDirectory() as t:
                repo = Path(t) / "repo"
                make_repo(repo)
                if label == "reference":
                    patch = HIDDEN / task / "reference.patch"
                    if not patch.is_file():
                        print(f"{task:12} {label:9} (no reference.patch)")
                        bad = True
                        continue
                    r = git(repo, "apply", "--whitespace=nowarn", str(patch), check=False)
                    if r.returncode:
                        print(f"{task:12} {label:9} patch does not apply: {r.stderr.strip()[:200]}")
                        bad = True
                        continue
                g = grade(task, "", repo)
                extra = f"  decisions {g['decisions']}" if "decisions" in g else ""
                print(f"{task:12} {label:9} {g['score']:.2f}  failed: {', '.join(g['failed']) or '-'}{extra}")
                bad |= g["score"] < 0.999 if label == "reference" else g["score"] > 0.5
    # the planted bug breaks exactly the tests listed
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t) / "repo"
        make_repo(repo)
        r = sh(f"{bench.TEST} -p no:cacheprovider --tb=no", repo)
        failing = sorted(re.findall(r"^FAILED (\S+)", r.stdout, re.M))
        print(f"planted bug breaks: {failing}")
        bad |= failing != sorted(BUG_FAILING)
    if bad:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("prepare")
    pr.add_argument("--slots", type=int, default=3)
    pr.add_argument("--force", action="store_true", help="redo a slot that has a session.txt")
    for name in ("plan", "run"):
        p = sub.add_parser(name)
        p.add_argument("--arms", default=",".join(ARMS))
        p.add_argument("--tasks", default="")
        p.add_argument("--reps", type=int, default=3)
    sub.add_parser("report")
    sub.add_parser("selftest")
    a = ap.parse_args()
    {"prepare": cmd_prepare, "plan": cmd_plan, "run": cmd_run, "report": cmd_report, "selftest": lambda _: selftest()}[a.cmd](a)


if __name__ == "__main__":
    main()
