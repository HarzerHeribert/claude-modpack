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
  Z  the pack as shipped in 0.1.1, all six mods with their defaults (lsp-plus answering symbol greps)
  Z-cells, Z-lsp  Z without cells, Z without lsp-plus: which mod earns the pack's savings (the ablation;
     run with BENCH_RESULTS=results-ablation.jsonl and BENCH_PACK_ROOT on a worktree of the commit, beside V)
  HF  as Z, told in the prompt to do the task through hand_off (H's instruction, fresh): with delegate taking
     edit work only, does a person's ask for a read-only hand-off still cost more than Z?
  MO  as Z, with a test mod (BENCH_EXTRA_DIRS) attaching the order a plan-approval hand-off would send to the
     first prompt: does Opus follow an order that comes from a mod, not from the person?
  IC  as Z, with delegate's framing "capability": the tool is implement_spec(spec, check), described as an
     ability, not as handing work to a cheaper worker. Unasked: does Opus use it?
  wk-<model>[-<effort>]  as Z, told in the prompt to do the task through hand_off, with every delegate worker
     setting (readWorker, mechanicalWorker, buildWorker) at that model and effort (none: Claude Code's
     default): which worker setup is cheapest for each kind of work at the same quality?
  PS  as PL (the long session prepared with the pack), with a test mod (BENCH_EXTRA_DIRS) telling Claude the
     session's size and what each of its requests re-reads (BENCH_SESSION_TOKENS): information, no advice.
     Unasked: does knowing its own cost make Opus hand off?
  PD, PFD  a long session over one part of click and tasks in another: it read docs/ and tests/ with the pack loaded
     (`prepare --docs`), nothing under src/click, so a task's code has to be located first. PD: the pack alone.
     PFD: the pack and pathfinder, which, from the 3rd exploration request in a row on (150k context or more), attaches
     the person's setting to hand the rest of the search to a read worker. Run long, against each other.
  seek 0.3 (looking around priced by context; pilot/explore-mining round 3). Fresh, against Z: ZKO its order from the
     first prompt (minContext 0), ZKM its map from the first search (minContext 0, priced as if it saved every request);
     ZK is seek at its defaults, silent in a fresh session. Long: KL (the src/ session, against PL); KDO (its defaults:
     the order alone), KDM (the map alone) and KD (both) in the docs-and-tests session, against PD beside PFD. Judge them with carry.py: what a run leaves in the context is re-read ~140 times in the person's sessions.
  Z6L  Z6 (the pack as 0.6.1 ships it) with the lint mod (lab), on the infra tasks (infra_repo.py: i1-handler … i5-backup)
     against Z6: the linters (shellcheck, ansible-lint, actionlint, hadolint, yamllint through uvx wrappers) are on every
     infra run's PATH, so both arms could run them; Z6L is told what an edit broke. Run with BENCH_RESULTS=results-infra.jsonl.
  SA-off, SA-on  the pack as 0.6.0 ships it (SHIPPED, seek, route off), every run told to hand the whole task to one
     general-purpose subagent: SA-off with cells' and seek's `subagents` option off (the subagent's task as Claude wrote
     it), SA-on with it on (the chaining guidance and seek's order appended to the task, in the person's name). Run with
     BENCH_RESULTS=results-subagent.jsonl; subagent_report.py checks the text reached each subagent and what they did.

Each run: a fresh copy of click, `claude -p` on Opus with the person's own
settings, the task graded by a fixed rule, and its cost priced from the
transcripts (the main session and every worker), request by request.

  python3 bench.py run [--reps 2] [--arms A,B,C] [--tasks t1,t2] [--jobs 4]
  python3 bench.py report
"""

import argparse
import concurrent.futures as cf
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import docs_repo
import infra_repo
import ops_repo
import pb_repo
import ts_repo
import web_repo
import yaml_repo

HERE = Path(__file__).resolve().parent
# Outside /private/tmp: macOS clears files there that no one touched for about three days, and on 18 Oct the click base
# had lost its sources and its git HEAD (runs rebuilt the code from git's pack files; those rows are in
# results-engine-brokenbase.jsonl). The public release uses the same folder.
WORK = Path(os.environ.get("BENCH_WORK", Path.home() / ".cache" / "claude-modpack-bench"))
BASE = WORK / "click-base"
# The YAML tasks' repository (yaml_repo.py), built on first use; their runs are named with --tasks, never by default.
YAML_BASE = WORK / "yaml-base"
YAML_BIG_BASE = WORK / "yaml-big-base"
YAML_BUILD = __import__("threading").Lock()
# The TypeScript tasks' repository (ts_repo.py: chrono at a release tag, its node_modules installed), cloned on first use;
# its tasks (ts-*) run only when named with --tasks.
TS_BASE = WORK / "ts-base"
TS_BUILD = __import__("threading").Lock()
# The infrastructure tasks (infra_repo.py): their repository, and the linter wrappers every infra run gets on its PATH.
INFRA_BASE = WORK / "infra-base"
INFRA_BIN = WORK / "infra-bin"
INFRA_BUILD = __import__("threading").Lock()
# The work beyond code (18 Oct; Anthropic's study of 400k Claude Code sessions: operating software 17-21%, prose and
# analysis 13-20%, web code the most common): web_repo.py (bulletproof-react, web-*), ops_repo.py (a service to run,
# ops-*), docs_repo.py (prose and a CSV, doc-*). Named with --tasks only. Ops tasks share port 8731, so OPS_RUN lets one
# run at a time whatever --jobs says.
WEB_BASE = WORK / "web-base"
WEB_BUILD = __import__("threading").Lock()
OPS_BASE = WORK / "ops-base"
DOCS_BASE = WORK / "docs-base"
WORK_BUILD = __import__("threading").Lock()
OPS_RUN = __import__("threading").Lock()
# The PocketBase tasks (pb_repo.py: Trail-Code's 15 PocketBase tasks, pb-q1..pb-q10 and pb-pr<n>), their bases built in WORK
# on first use (pb-src, pb-base-q, pb-base-pr<n>); they run only when named with --tasks.
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

# The ablation: the pack as shipped, and the same pack without one mod.
SHIPPED = ("statusline", "smart-compact", "lsp-plus", "delegate", "cells", "eta")
ABLATION = {"Z": SHIPPED, "Z-cells": tuple(m for m in SHIPPED if m != "cells"), "Z-lsp": tuple(m for m in SHIPPED if m != "lsp-plus")}
# The code-graph tools' ideas the pack could carry (run with BENCH_PACK_ROOT on a pack that has them): scout's definitions
# beside the prompt, and lsp-plus's callers after an edit changes a signature (its option blast); N has both, the other two
# drop one each.
IDEAS = {"N": (SHIPPED + ("scout",), True), "N-scout": (SHIPPED, True), "N-blast": (SHIPPED + ("scout",), False)}
ABLATION.update({arm: mods for arm, (mods, _) in IDEAS.items()})
# The pack with yaml-plus, one YAML server for every kind of YAML with name checks, against Z on the YAML tasks.
ABLATION["ZY"] = SHIPPED + ("yaml-plus",)
# The pack with squeeze, which hands Claude a long test log's failures (file:line, messages) and keeps the whole log
# on disk, against Z on f1-fix, whose failing suite prints such a log.
ABLATION["ZS"] = SHIPPED + ("squeeze",)
# The pack with route: ScaleDown's classifier reads the prompt, and feature or test work gets the hand-off order (needs
# SCALEDOWN_API_KEY in the environment). Against Z: does it hand off where that pays, and stay out of the rest?
ABLATION["RT"] = SHIPPED + ("route",)
# RTV: RT with delegate's verified hand-off (the worker's VERIFY block run by the tool, a verdict first) and the order that
# says to report on a Verified result without running anything again. RTD: RTV, and the order hands off before Claude reads
# the code. Both against RT: how many main-model requests are left around a hand-off?
ABLATION["RTV"] = ABLATION["RTD"] = SHIPPED + ("route",)
# ZK: the pack with seek, which attaches the follow-up Claude would spend a request on to its own searches (a scoped
# grep's windows, the top file of a discovery grep, a wider retry of an empty one), learned from 975 local sessions
# (pilot/explore-mining). Against Z: fewer exploration requests, at what cost in tokens?
ABLATION["ZK"] = SHIPPED + ("seek",)
# RTDH: RTD with Haiku at low effort as every worker, build work included (the default gives build work to Sonnet).
ABLATION["RTDH"] = SHIPPED + ("route",)
# seek 0.3 fresh, where it is silent at its defaults (a fresh session is under its 150k): its two parts switched on from
# the start, to see whether Opus follows the order (ZKO) and uses the map (ZKM). Against Z.
SEEK_FRESH = {"ZKO": {"minContext": 0}, "ZKM": {"minContext": 0, "order": False, "map": True, "saveRate": 1}}
ABLATION.update({arm: SHIPPED + ("seek",) for arm in SEEK_FRESH})
# The pack as 0.6.0 ships it (route loaded and off, as installed), every run through one general-purpose subagent:
# cells' and seek's `subagents` option off (SA-off) or on (SA-on). Does the guidance and the order in the subagent's task
# make the subagent cheaper?
SUBAGENT_ARMS = {"SA-off": False, "SA-on": True}
ABLATION.update({arm: SHIPPED + ("seek", "route") for arm in SUBAGENT_ARMS})
# Z6: the pack as 0.6.0 ships it, every option at its default (seek's order on, route loaded and off); against V and
# VTG in one batch: does Trail-Code alone come close to today's pack? (16 Oct)
ABLATION["Z6"] = SHIPPED + ("seek", "route")
# Z6L: Z6 (the pack as 0.6.1 ships it, from the lab's HEAD) with lint (lab): after an edit, the infrastructure linters on
# the PATH and the shortcut detector, on the infra tasks (infra_repo.py) against Z6. Does a note about what an edit broke
# change the result where no language server and no test would catch it?
ABLATION["Z6L"] = SHIPPED + ("seek", "route", "lint")
# 18 Oct, against Z6: lsp-plus without a language server, and its filter of the diagnostics Claude Code attaches (lab).
# Z6I: the grep answer from a word search and the files' outlines (engine: index), no servers warmed at session start.
# Z6D: the diagnostics cut to errors and warnings in the files the session edited (diagnostics: filter).
# Z6N: Z6 without lsp-plus.
LSP_ARMS = {"Z6I": {"engine": "index", "warm": False}, "Z6D": {"diagnostics": "filter"}}
ABLATION.update({arm: SHIPPED + ("seek", "route") for arm in LSP_ARMS})
ABLATION["Z6N"] = tuple(m for m in SHIPPED if m != "lsp-plus") + ("seek", "route")
# Z7: the pack as 0.7.0 ships it (no lsp-plus); Z7W: with draft, writing to a length in one draft and cuts.
ABLATION["Z7"] = ABLATION["Z6N"]
ABLATION["Z7W"] = ABLATION["Z6N"] + ("draft",)
# Z8S: the pack as 0.8.0 ships it (Z7W) with steer, two system-prompt sections (the person's goal and what done means,
# checked against what was observed; steps that pay with the pack's tools). Z8SX: the same with seek's and draft's
# orders beside the prompt off, so the system prompt carries that guidance alone.
ABLATION["Z8S"] = ABLATION["Z8SX"] = ABLATION["Z7W"] + ("steer",)
# The prompt's fixed lead in those arms, so that every run goes through a subagent and the grading still holds (the answer
# is the main's final message, the edits are on disk).
VIA_SUBAGENT = ("Hand this whole task to one general-purpose subagent with the Agent tool (subagent_type \"general-purpose\"): "
                "give it the task below word for word, let it do all of the work, any edits included, wait for it to finish, "
                "and give its answer as your final reply. Do none of the task yourself.")

# f1-fix: three one-line bugs planted in src/ (18 tests fail, ~49k characters of `pytest -q`): (file, as released, as planted).
F1_BUGS = [
    ("src/click/formatting.py", "width = max(min(shutil.get_terminal_size().columns, max_width) - 2, 50)", "width = max(min(shutil.get_terminal_size().columns, max_width) - 4, 50)"),
    ("src/click/termui.py", '"y/n" if default is None else ("Y/n" if default else "y/N"),', '"y/n" if default is None else ("Y/N" if default else "y/N"),'),
    ("src/click/types.py", '        "0": False,\n', '        "0": True,\n'),
]


def plant_bugs(repo: Path):
    for rel, good, bad in F1_BUGS:
        p = repo / rel
        text = p.read_text()
        assert text.count(good) == 1, rel
        p.write_text(text.replace(good, bad))
    subprocess.run(["git", "-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-q", "-am", "planted bugs"], cwd=repo, check=True)

# The worker setups the bench compares: arm name → delegate's worker setting.
WORKER_ARMS = {
    "wk-sonnet-low": "sonnet:low", "wk-sonnet-medium": "sonnet:medium", "wk-sonnet": "sonnet",
    "wk-haiku-low": "haiku:low", "wk-haiku": "haiku",
}

# A routing rule for the pack: Opus never handed off unasked (0 of 24 runs), so the pack says when to.
# The person's own words, at the end of their prompt: permission to delegate, not an order.
FIT = "Delegate where you see fit."

MINIMAL = "You are Claude Code, working in a software repository from the command line. Use your tools to do the task you are given."

ROUTING = """# Routing work

Before you start a task, decide where it runs.
- Hand it off with mcp__delegate__hand_off when it is fully specified, will take you more than about five steps, and a diff and a check can prove its result: a feature from a precise spec, tests to a target, one change applied in many places. Use model "sonnet" when the work needs judgment the spec cannot pin down, "haiku" when it is mechanical. Judge what comes back by its diff and check output, then finish what is left.
- Keep it yourself when it is a lookup, a trace, an explanation, a design decision or debugging, or when it depends on what this conversation decided."""

TEST = f"PYTHONPATH=src {VENV}/bin/python -m pytest -q"
# Trail-Code (trailhq, formerly graft), a code-graph tool, as its `trail init` wires a repository: the published
# npm version installed in a folder of its own, its home (install record, update check) beside it so nothing is
# written into the person's ~/.trail or settings. T and TL are the pack with it.
TRAIL = Path(os.environ.get("BENCH_TRAIL", "<work>/trail"))
TRAIL_BIN = TRAIL / "node_modules" / ".bin" / "trail"
TRAIL_HOME = TRAIL / "home"
BASE_TRAIL = WORK / "click-trail"
# TG: Trail without its Stop hook, which asks Claude once per session to write a team learning (in T's runs the
# learning note became the final reply): what the graph, its prompt pointers and its tools are worth alone.
BASE_TRAIL_GRAPH = WORK / "click-trail-graph"
TRAIL_ARMS = ("T", "TL", "TG", "VT", "VTG")  # VT, VTG: plain Claude Code with Trail as installed / without its Stop hook (16 Oct)
# Tasks run only when named with --tasks, beside the YAML ones: f1-fix needs its bugs planted first.
EXTRA_TASKS = {
    "f1-fix": {
        "kind": "edit",
        "prompt": f"The test suite of this repository (click) fails. Find the bugs in src/ and fix them; do not change the tests. The tests run with: {TEST}",
    },
}


# Plugins the person has installed that no condition may load by accident: the modpack from its marketplace (its mods
# made "plain" runs a pack from 14 Oct on; in pack runs the lab's copies replace them), and Warp (its permission hook
# hangs outside Warp). Every run's command gets them switched off (neutral()).
# Every installed plugin of the pack's marketplace, read from Claude Code's own list at import (a fixed list missed
# seek and route once the person updated to 0.6.0, 16 Oct), plus the names known so far in case the file moves.
def _installed_pack() -> set[str]:
    try:
        d = json.loads((Path.home() / ".claude" / "plugins" / "installed_plugins.json").read_text())
        return {k for k in d.get("plugins", d) if k.endswith("@claude-modpack")}
    except (OSError, ValueError, AttributeError):
        return set()
INSTALLED_OFF = {f"{m}@claude-modpack": False for m in ("modpack", "statusline", "smart-compact", "delegate", "lsp-plus", "cells", "eta", "seek", "route", "pathfinder")}
INSTALLED_OFF |= {k: False for k in _installed_pack()}
INSTALLED_OFF["warp@claude-code-warp"] = False


def neutral(cmd: list[str]) -> list[str]:
    """The command with the installed plugins above switched off: merged into its --settings, or a --settings of its own."""
    cmd = list(cmd)
    for i, a in enumerate(cmd[:-1]):
        if a == "--settings":
            s = json.loads(cmd[i + 1])
            s["enabledPlugins"] = {**INSTALLED_OFF, **s.get("enabledPlugins", {})}
            cmd[i + 1] = json.dumps(s)
            return cmd
    return cmd + ["--settings", json.dumps({"enabledPlugins": INSTALLED_OFF})]


def trail_env() -> dict:
    """The environment of a run with Trail: its binary on the PATH, its home, its telemetry off."""
    return {**os.environ, "PATH": f"{TRAIL_BIN.parent}:{os.environ['PATH']}", "TRAIL_HOME": str(TRAIL_HOME / ".trail"), "DO_NOT_TRACK": "1"}


def trail_mcp() -> list[str]:
    """Trail's MCP server, the installed version (its .mcp.json would fetch the newest with npx)."""
    env = {"TRAIL_HOME": str(TRAIL_HOME / ".trail"), "DO_NOT_TRACK": "1"}
    return ["--mcp-config", json.dumps({"mcpServers": {"trail": {"command": str(TRAIL_BIN), "args": ["mcp"], "env": env}}})]


def trail_graph_only():
    """click-trail with Trail's Stop hook taken out of its project settings, committed."""
    if BASE_TRAIL_GRAPH.exists():
        return
    shutil.copytree(BASE_TRAIL, BASE_TRAIL_GRAPH, symlinks=True)
    settings = BASE_TRAIL_GRAPH / ".claude" / "settings.json"
    s = json.loads(settings.read_text())
    s["hooks"].pop("Stop", None)
    settings.write_text(json.dumps(s, indent=2) + "\n")
    subprocess.run(["git", "-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-q", "-am", "trail without its Stop hook"], cwd=BASE_TRAIL_GRAPH, check=True)


_BUNDLES: dict = {}


def trail_bundle(question: str) -> str:
    """Trail's best case, its README's "push" variant: `trail ask --source` for the task, put in front of the prompt
    as their harness does; the run itself is plain Claude Code in plain click (VP). Cached per task."""
    if question not in _BUNDLES:
        trail_graph_only()
        p = subprocess.run([str(TRAIL_BIN), "ask", question, "--source"], cwd=BASE_TRAIL_GRAPH, env=trail_env(), capture_output=True, text=True, timeout=300, check=True)
        _BUNDLES[question] = p.stdout.strip()
    return _BUNDLES[question]


def trail_init(repo: Path):
    """`trail init` for Claude Code in a copy of click, its home the bench's own, then its files committed so a
    task's diff holds only the task (the graph in graft/ stays ignored, as init leaves it)."""
    env = {**trail_env(), "HOME": str(TRAIL_HOME)}
    subprocess.run([str(TRAIL_BIN), "init", "--no-agents", "--no-global", "--no-statusline", "-y", "."], cwd=repo, env=env, check=True, capture_output=True)
    (repo / ".mcp.json").unlink(missing_ok=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-q", "-m", "trail init"], cwd=repo, check=True)

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
    "t6-signature": {
        "kind": "edit",
        "prompt": "In this repository (click), change the internal helper `resolve_color_default` so its parameter is keyword-only and named "
        "`override` instead of `color`: its signature becomes `def resolve_color_default(*, override: bool | None = None) -> bool | None`, "
        "with the same behavior. Update every caller in src/ and tests/ so none passes it positionally or by its old name. "
        f"The tests run with: {TEST}",
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
    if task in yaml_repo.TASKS:
        return yaml_repo.grade(task, answer, repo)
    if task in pb_repo.TASKS:
        return pb_repo.grade(task, answer, repo)
    if task in ts_repo.TASKS:
        return ts_repo.grade(task, answer, repo)
    if task in infra_repo.TASKS:
        return infra_repo.grade(task, answer, repo)
    if task in web_repo.TASKS:
        return web_repo.grade(task, answer, repo)
    if task in ops_repo.TASKS:
        return ops_repo.grade(task, answer, repo)
    if task in docs_repo.TASKS:
        return docs_repo.grade(task, answer, repo)
    if task == "f1-fix":
        fixed = [rel for rel, good, bad in F1_BUGS if good in (t := (repo / rel).read_text()) and bad not in t]
        tests_changed = subprocess.run(["git", "status", "--porcelain", "tests"], cwd=repo, capture_output=True, text=True).stdout.strip()
        suite = subprocess.run(f"{TEST} -p no:cacheprovider --tb=no", shell=True, cwd=repo, capture_output=True, text=True)
        score = 0.0 if tests_changed else (len(fixed) / len(F1_BUGS)) * (1.0 if suite.returncode == 0 else 0.5)
        return {"score": score, "fixed": len(fixed), "tests_changed": bool(tests_changed), "suite": (suite.stdout.strip().splitlines() or [""])[-1]}
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
    if task == "t6-signature":
        hidden = repo / "tests" / "test_zz_hidden_signature.py"
        shutil.copy(HERE / "hidden" / "test_signature_hidden.py", hidden)
        h = subprocess.run(f"{TEST} -p no:cacheprovider --tb=no {hidden.relative_to(repo)}", shell=True, cwd=repo, capture_output=True, text=True)
        hidden.unlink()
        passed = int((re.search(r"(\d+) passed", h.stdout) or [0, 0])[1])
        failed = int((re.search(r"(\d+) failed", h.stdout) or [0, 0])[1]) + int((re.search(r"(\d+) error", h.stdout) or [0, 0])[1])
        # Every call passes nothing or override=: a caller left positional only fails where a test reaches it.
        calls = subprocess.run(["grep", "-rnI", "--include=*.py", "resolve_color_default(", "src", "tests"], cwd=repo, capture_output=True, text=True).stdout.splitlines()
        stale = [c for c in calls if not re.search(r"def resolve_color_default|resolve_color_default\(\s*(\)|override\s*=)", c)]
        suite = subprocess.run(f"{TEST} -p no:cacheprovider --tb=no", shell=True, cwd=repo, capture_output=True, text=True)
        frac = passed / (passed + failed) if passed + failed else 0.0
        ok = suite.returncode == 0 and not stale
        return {"score": frac * (1.0 if ok else 0.5), "hidden_passed": passed, "hidden_failed": failed, "stale_calls": stale, "suite": (suite.stdout.strip().splitlines() or [""])[-1]}
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


# What cells and seek append to a subagent's task (SA-on): the block's head and each mod's line, as they begin.
SETTINGS_HEAD = "The person's settings for this work:"
CELLS_LINE = "Fewer round-trips: every response you make re-reads"
RUN_CELL_LINE = "Where you have the run_cell tool"
SEEK_LINE = "Lean looking around: whatever you read stays"


def chained(command: str) -> bool:
    """A Bash call that runs several commands: joined with ;, && or ||, or on several lines (a pipe is one command)."""
    return bool(re.search(r";|&&|\|\||\n", re.sub(r"^\s*cd\s+\S+\s*&&\s*", "", command).strip()))


def subagent_of(path: str, since: float = 0) -> dict:
    """One subagent's transcript (Agent tool or delegate's worker): its type, task, requests, cost and tool calls."""
    meta_path = Path(path).with_suffix(".meta.json")
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    reqs = requests_of(path, since)
    task, calls = None, {}
    for line in open(path, errors="replace"):
        try:
            o = json.loads(line)
        except json.JSONDecodeError:
            continue
        m = o.get("message") or {}
        if task is None and o.get("type") == "user":
            c = m.get("content")
            task = c if isinstance(c, str) else "\n".join(b.get("text", "") for b in c or [] if isinstance(b, dict) and b.get("type") == "text")
        if o.get("type") == "assistant":
            for b in m.get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    calls[b.get("id")] = (b.get("name"), b.get("input") or {})
    bash = [i.get("command") or "" for n, i in calls.values() if n == "Bash"]
    task = task or ""
    return {
        "type": meta.get("agentType", ""),
        "requests": len(reqs),
        "usd": sum(cost_of(r) for r in reqs),
        "tools": len(calls),
        "bash": len(bash),
        "bash_chained": sum(1 for c in bash if chained(c)),
        "run_cell": sum(1 for n, _ in calls.values() if n == "mcp__cells__run_cell"),
        "reads": sum(1 for n, _ in calls.values() if n == "Read"),
        "searches": sum(1 for n, _ in calls.values() if n in ("Grep", "Glob")),
        "edits": sum(1 for n, _ in calls.values() if n in ("Edit", "Write", "MultiEdit")),
        "task_chars": len(task),
        "settings": SETTINGS_HEAD in task,
        "cells_line": CELLS_LINE in task,
        "run_cell_line": RUN_CELL_LINE in task,
        "seek_line": SEEK_LINE in task,
    }


def account(session_id: str, since: float = 0) -> dict:
    """What a run cost, request by request; a run that forked a long session counts from its start (`since`).

    worker_* counts every subagent transcript (<session>/subagents/*.jsonl): delegate's workers and the Agent tool's
    subagents alike; subagent_* the Agent tool's alone (any type but delegate:*), each also listed in `subagents`."""
    mains = glob.glob(str(PROJECTS / "*" / f"{session_id}.jsonl"))
    if not mains:
        return {"found": False}
    main = requests_of(mains[0], since)
    sub_files = sorted(glob.glob(str(Path(mains[0]).with_suffix("") / "subagents" / "*.jsonl")))
    workers = [r for f in sub_files for r in requests_of(f, since)]
    subs = [s for s in (subagent_of(f, since) for f in sub_files) if not s["type"].startswith("delegate:")]
    tools = [t for r in main for t in r["tools"]]
    forks, review_usd = reviews(session_id)
    recorded: dict[str, int] = {}
    for r in main + workers:
        fam = family(r["model"])
        recorded[fam] = recorded.get(fam, 0) + (r["usage"].get("output_tokens") or 0)
    return {
        "found": True,
        "forks": forks,
        # Output tokens as the transcripts hold them, per model family: settle() prices what they left out.
        "recorded_output": recorded,
        "review_usd": review_usd,
        "main_requests": len(main),
        "main_usd": sum(cost_of(r) for r in main),
        "main_models": sorted({r["model"] for r in main}),
        "worker_requests": len(workers),
        "worker_usd": sum(cost_of(r) for r in workers),
        "subagent_requests": sum(s["requests"] for s in subs),
        "subagent_usd": sum(s["usd"] for s in subs),
        "subagents": subs,
        "hand_offs": sum(1 for t in tools if t and (t.endswith("hand_off") or t.endswith("implement_spec"))),
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


def family(model: str) -> str:
    return next((k for k in PRICES if k in model), "opus")


def settle(c: dict, model_usage: dict | None, reported: float | None) -> dict:
    """Prices the output the subagent transcripts left out, into worker_usd and subagent_usd. Fresh runs only.

    A subagent's transcript (the Agent tool's and delegate's workers alike) records each request's output tokens as the
    response began (a few tokens), not as it ended; the main transcript records them in full. Checked 16 Oct: cache reads
    and writes over all transcripts match Claude Code's own modelUsage to the token, and the output is short by exactly
    the subagent's; in every run without subagents reported_usd equals the counted cost. So what modelUsage holds beyond
    the recorded output is the subagents' (priced at its model's output price); without modelUsage (rows before 16 Oct),
    reported_usd less the counted cost is, at Opus prices. worker_usd_transcript and subagent_usd_transcript keep the
    figures as the transcripts give them; with one Agent subagent, its own row's usd is completed too."""
    if not c.get("found") or "unrecorded_usd" in c:
        return c
    tokens, usd = 0, 0.0
    if model_usage:
        by_family: dict[str, int] = {}
        for model, u in model_usage.items():
            by_family[family(model)] = by_family.get(family(model), 0) + (u.get("outputTokens") or 0)
        for fam, n in by_family.items():
            extra = max(0, n - c.get("recorded_output", {}).get(fam, 0))
            tokens += extra
            usd += extra * PRICES[fam]["out"] / 1e6
    elif reported is not None:
        usd = max(0.0, reported - (c["main_usd"] + c["worker_usd"] + c.get("review_usd", 0)))
        tokens = round(usd / (PRICES["opus"]["out"] / 1e6))
    c["unrecorded_output_tokens"], c["unrecorded_usd"] = tokens, usd
    c["worker_usd_transcript"] = c["worker_usd"]
    c["worker_usd"] += usd
    subs = c.get("subagents", [])
    c["subagent_usd_transcript"] = c.get("subagent_usd", 0)
    if subs and c.get("subagent_requests", 0) == c.get("worker_requests", 0):
        # Every worker transcript is an Agent subagent's: the output left out is theirs.
        c["subagent_usd"] = c.get("subagent_usd", 0) + usd
        if len(subs) == 1:
            subs[0]["usd_transcript"] = subs[0]["usd"]
            subs[0]["usd"] += usd
            subs[0]["output_unrecorded"] = tokens
    return c


def ctx(req: dict) -> int:
    u = req["usage"]
    return u.get("input_tokens", 0) + (u.get("cache_read_input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)


def ts_base() -> Path:
    """The TypeScript tasks' base, prepared once (clone and npm ci) aside and moved in whole, as the YAML ones."""
    with TS_BUILD:
        if not TS_BASE.exists():
            part = TS_BASE.with_name(TS_BASE.name + ".part")
            shutil.rmtree(part, ignore_errors=True)
            ts_repo.prepare(part)
            part.rename(TS_BASE)
    return TS_BASE


def run_one(task: str, arm: str, rep: int) -> dict:
    """One graded run; the ops tasks one at a time, since each starts a server on port 8731."""
    if task in ops_repo.TASKS:
        with OPS_RUN:
            return _run_one(task, arm, rep)
    return _run_one(task, arm, rep)


def _run_one(task: str, arm: str, rep: int) -> dict:
    # The process id too: two bench processes running one arm name started the same task in the same second and shared a folder.
    run_id = f"{task}.{arm}.{rep}.{int(time.time())}.{os.getpid()}"
    repo = WORK / "runs" / run_id
    if task in yaml_repo.TASKS:
        big = yaml_repo.TASKS[task].get("big", False)
        base = YAML_BIG_BASE if big else YAML_BASE
        with YAML_BUILD:
            if not base.exists():
                # Built aside and moved in whole: a parallel run never copies half a repository.
                part = base.with_name(base.name + ".part")
                shutil.rmtree(part, ignore_errors=True)
                part.mkdir(parents=True)
                yaml_repo.build(part, yaml_repo.BIG if big else 0)
                part.rename(base)
        shutil.copytree(base, repo, symlinks=True)
        if yaml_repo.TASKS[task].get("plant"):
            yaml_repo.plant(repo, yaml_repo.PLANTED_BIG if big else yaml_repo.PLANTED)
    elif task in pb_repo.TASKS:
        shutil.copytree(pb_repo.base(WORK, task), repo, symlinks=True)
    elif task in ts_repo.TASKS:
        shutil.copytree(ts_base(), repo, symlinks=True)
    elif task in infra_repo.TASKS:
        with INFRA_BUILD:
            if not INFRA_BASE.exists():
                part = INFRA_BASE.with_name(INFRA_BASE.name + ".part")
                shutil.rmtree(part, ignore_errors=True)
                infra_repo.build(part)
                infra_repo.bin(INFRA_BIN)
                part.rename(INFRA_BASE)
        shutil.copytree(INFRA_BASE, repo, symlinks=True)
    elif task in web_repo.TASKS:
        with WEB_BUILD:
            if not WEB_BASE.exists():
                part = WEB_BASE.with_name(WEB_BASE.name + ".part")
                shutil.rmtree(part, ignore_errors=True)
                web_repo.prepare(part)
                part.rename(WEB_BASE)
        # node_modules is 480 MB: an APFS clone (cp -c) instead of a byte copy.
        repo.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["cp", "-cR", str(WEB_BASE), str(repo)], check=True)
        web_repo.plant(task, repo)
    elif task in ops_repo.TASKS or task in docs_repo.TASKS:
        module, base = (ops_repo, OPS_BASE) if task in ops_repo.TASKS else (docs_repo, DOCS_BASE)
        # The base is rebuilt when the module that builds it changed: a base built before a source text changed held the
        # old facts (18 Oct: doc-4's owners were added to the sources, and every run read a base without them).
        source = hashlib.sha1(Path(module.__file__).read_bytes()).hexdigest()
        with WORK_BUILD:
            stamp = base / ".bench-source"
            if base.exists() and (not stamp.exists() or stamp.read_text() != source):
                shutil.rmtree(base)
            if not base.exists():
                part = base.with_name(base.name + ".part")
                shutil.rmtree(part, ignore_errors=True)
                module.build(part)
                (part / ".bench-source").write_text(source)
                part.rename(base)
        shutil.copytree(base, repo, symlinks=True, ignore=shutil.ignore_patterns(".bench-source"))
        module.plant(task, repo)
    else:
        shutil.copytree(BASE_TRAIL_GRAPH if arm in ("TG", "VTG") else BASE_TRAIL if arm in TRAIL_ARMS else BASE, repo, symlinks=True)
        if task == "f1-fix":
            plant_bugs(repo)
    prompt = {**TASKS, **yaml_repo.TASKS, **ts_repo.TASKS, **pb_repo.TASKS, **infra_repo.TASKS, **web_repo.TASKS, **ops_repo.TASKS, **docs_repo.TASKS, **EXTRA_TASKS}[task]["prompt"] + (f"\n\n{FIT}" if arm == "DF" else "")
    if arm == "HF" or arm in WORKER_ARMS:
        prompt = f"{FORCE}\n\n{prompt}"
    if arm in SUBAGENT_ARMS:
        prompt = f"{VIA_SUBAGENT}\n\n{prompt}"
    if arm == "VP":
        prompt = f"{trail_bundle(prompt)}\n\n{prompt}"
    # BENCH_MODEL runs a whole batch on another main model (does a mod help a weaker one?); W is Sonnet by definition.
    model = os.environ.get("BENCH_MODEL") or ("sonnet" if arm == "W" else "opus")
    cmd = ["claude", "-p", prompt, "--model", model, "--permission-mode", "auto", "--output-format", "json"]
    if arm in ("V", "VT", "VTG", "VP", "P", "R", "W", "Q", "DF", "Y"):
        # The suite's conditions load exactly what they name: nothing (V), or the pack (P, R).
        # Asks for the claude.ai connectors to stay on, as in every run before the person turned them off on 13 Oct
        # (378 deferred tools); the person's own setting wins, so runs from then on (DF, DL, Y, results-noconn) have 15.
        cmd += ["--settings", json.dumps({"env": {"CLAUDE_CODE_PLUGIN_DIRS": "" if arm in ("V", "VT", "VTG", "VP", "W") else PACK}, "disableClaudeAiConnectors": False})]
    if arm in ABLATION or arm in ("HF", "MO", "IC", "T", "TG") or arm in WORKER_ARMS:
        dirs = [str(PACK_ROOT / m) for m in ABLATION.get(arm, SHIPPED)]
        if arm == "MO":
            dirs += [d for d in os.environ.get("BENCH_EXTRA_DIRS", "").split(":") if d]
        settings = {"env": {"CLAUDE_CODE_PLUGIN_DIRS": ":".join(dirs)}}
        if arm == "IC":
            framing = {"options": {"framing": "capability"}}
            settings["pluginConfigs"] = {"delegate": framing, "delegate@inline": framing}
        if arm in IDEAS:
            blast = {"options": {"blast": IDEAS[arm][1]}}
            settings["pluginConfigs"] = {"lsp-plus": blast, "lsp-plus@inline": blast}
        if arm in LSP_ARMS:
            lsp = {"options": LSP_ARMS[arm]}
            settings["pluginConfigs"] = {"lsp-plus": lsp, "lsp-plus@inline": lsp}
        if arm in SEEK_FRESH:
            seek = {"options": SEEK_FRESH[arm]}
            settings["pluginConfigs"] = {"seek": seek, "seek@inline": seek}
        if arm in ("RT", "RTV", "RTD", "RTDH"):
            # route is off until turned on; its key comes from SCALEDOWN_API_KEY in the environment, never the command line.
            on = {"options": {"enabled": True, **({"direct": True} if arm in ("RTD", "RTDH") else {})}}
            settings["pluginConfigs"] = {"route": on, "route@inline": on}
        if arm == "RTDH":
            haiku = {"options": {"readWorker": "haiku:low", "mechanicalWorker": "haiku:low", "buildWorker": "haiku:low"}}
            settings["pluginConfigs"] |= {"delegate": haiku, "delegate@inline": haiku}
        if arm in SUBAGENT_ARMS:
            sub = {"options": {"subagents": SUBAGENT_ARMS[arm]}}
            settings["pluginConfigs"] = {f"{m}{s}": sub for m in ("cells", "seek") for s in ("", "@inline")}
        if arm in WORKER_ARMS:
            worker = WORKER_ARMS[arm]
            options = {"options": {"readWorker": worker, "mechanicalWorker": worker, "buildWorker": worker}}
            settings["pluginConfigs"] = {"delegate": options, "delegate@inline": options}
        if arm == "Z8SX":
            off = {"options": {"order": False}}
            settings["pluginConfigs"] = {f"{m}{s}": off for m in ("seek", "draft") for s in ("", "@inline")}
        cmd += ["--settings", json.dumps(settings)]
    if arm == "R":
        cmd += ["--append-system-prompt", ROUTING]
    if arm in TRAIL_ARMS:
        cmd += trail_mcp()
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
    if task in pb_repo.TASKS:
        # Go's language server for every arm alike (the official gopls plugin), as swe.py enables pyright.
        cmd = pb_repo.with_gopls(cmd)
    started = time.time()
    try:
        # An infra run finds the linters on its PATH (uvx wrappers), every arm alike.
        env = trail_env() if arm in TRAIL_ARMS else {**os.environ, "PATH": f"{INFRA_BIN}:{os.environ['PATH']}"} if task in infra_repo.TASKS else None
        p = subprocess.run(neutral(cmd), cwd=repo, capture_output=True, text=True, timeout=1800, env=env)
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
    if task in ("t2-rename", "l1-feature", "l2-coverage", "t6-signature", "f1-fix") or yaml_repo.TASKS.get(task, {}).get("kind") == "edit" or ts_repo.TASKS.get(task, {}).get("kind") == "edit" or task in infra_repo.TASKS \
            or any(m.TASKS.get(task, {}).get("kind") == "edit" for m in (web_repo, ops_repo, docs_repo)):
        # The change as made, against the clean copy: re-graded later from this alone.
        subprocess.run(["git", "add", "-A", "-N", "."], cwd=repo, capture_output=True)
        diff = subprocess.run(["git", "diff", "--binary", "HEAD", "--", ".", ":(exclude).coverage", ":(exclude)*.pyc", ":(exclude)__pycache__"], cwd=repo, capture_output=True, text=True).stdout
        (HERE / "patches" / f"{run_id}.patch").write_text(diff)
    if pb_repo.TASKS.get(task, {}).get("kind") == "edit":
        # Against the PR's base commit (a commit the run made included), PocketBase's data folder left out.
        (HERE / "patches" / f"{run_id}.patch").write_text(pb_repo.diff(task, repo))
    # Claude Code's own token count per model, the subagents' whole output included (see settle()).
    row["model_usage"] = {m: {k: u.get(k) for k in ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens", "costUSD")}
                          for m, u in (res.get("modelUsage") or {}).items()}
    if row["session"]:
        row["cost"] = settle(account(row["session"]), row["model_usage"], row["reported_usd"])
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


LONG_TRAIL = WORK / "long-trail"
LONG_TRAIL_REPO = LONG_TRAIL / "repo"
LONG_SESSION_TRAIL = LONG_TRAIL / "session.txt"

# The docs-and-tests session (PD, PFD): click's docs/ and tests/ read in full with the pack loaded, nothing under src/,
# so the tasks' code (src/click) is in none of the context and has to be located. Its own folder: the history holds it.
LONG_DOCS = WORK / "long-docs"
LONG_DOCS_REPO = LONG_DOCS / "repo"
LONG_DOCS_SESSION = LONG_DOCS / "session-pack.txt"
DOCS_ARMS = ("PD", "PFD")
DOCS_PREP_PROMPT = ("Read every .md file under docs/ and every .py file under tests/ in full with the Read tool, the largest first, "
                    "several files per response. Do not open anything under src/. Then reply with the single word: ready.")
# Where its tasks touch code it has not read: the explanation, the feature, the trace (a find-all list, where read
# hand-offs did not pay before) and the lookup (docs/ names the variable; only its file:line is left to find).
DOCS_TASKS = ("t3-explain", "l1-feature", "t1-trace", "t4-lookup")


# seek 0.3 in the docs-and-tests session (against PD, beside PFD): KDO at its defaults (the order alone), KDM the map
# alone, KD both.
SEEK_DOCS = {"KDO": {}, "KDM": {"order": False, "map": True}, "KD": {"map": True}}
DOCS_ARMS = DOCS_ARMS + tuple(SEEK_DOCS)


def session_file(arm: str) -> Path:
    if arm == "TL":
        return LONG_SESSION_TRAIL
    if arm in DOCS_ARMS:
        return LONG_DOCS_SESSION
    return LONG_SESSION_PACK if arm in ("PL", "HL", "DL", "PS", "RTL", "KL") else LONG_SESSION


def long_repo(arm: str) -> Path:
    return LONG_TRAIL_REPO if arm == "TL" else LONG_DOCS_REPO if arm in DOCS_ARMS else LONG_REPO
PREP_PROMPT = "Read every .py file under src/click in full with the Read tool, the largest first, several files per response. Then reply with the single word: ready."


def conditions(arm: str) -> list[str]:
    """The flags that make a suite condition: what loads, and the routing rule."""
    base = arm[0]
    env = {"CLAUDE_CODE_PLUGIN_DIRS": "" if base == "V" else PACK}
    if arm == "PS":
        env["CLAUDE_CODE_PLUGIN_DIRS"] += "".join(f":{d}" for d in os.environ.get("BENCH_EXTRA_DIRS", "").split(":") if d)
        env["BENCH_SESSION_TOKENS"] = os.environ.get("BENCH_SESSION_TOKENS", "")
    settings = {"env": env, "disableClaudeAiConnectors": False}
    if arm == "RTL":
        # RTL: the pack with route turned on, forked from the pack's prepared long session; against PL.
        env["CLAUDE_CODE_PLUGIN_DIRS"] += ":" + str(PACK_ROOT / "route")
        on = {"options": {"enabled": True}}
        settings["pluginConfigs"] = {"route": on, "route@inline": on}
    if arm == "KL":
        # KL: the pack with seek, forked from the pack's prepared long session; against PL. seek adds hooks, no tools.
        env["CLAUDE_CODE_PLUGIN_DIRS"] += ":" + str(PACK_ROOT / "seek")
    if arm == "PFD":
        # PFD: the pack with pathfinder, forked from the docs-and-tests session; against PD. pathfinder adds hooks, no tools.
        env["CLAUDE_CODE_PLUGIN_DIRS"] += ":" + str(PACK_ROOT / "pathfinder")
    if arm in SEEK_DOCS:
        # KD, KDO, KDM: the pack with seek 0.3, forked from the docs-and-tests session; against PD. seek adds hooks, no tools.
        env["CLAUDE_CODE_PLUGIN_DIRS"] += ":" + str(PACK_ROOT / "seek")
        if SEEK_DOCS[arm]:
            settings["pluginConfigs"] = {"seek": {"options": SEEK_DOCS[arm]}, "seek@inline": {"options": SEEK_DOCS[arm]}}
    cmd = ["--settings", json.dumps(settings)]
    # A resumed session takes no appended system prompt (checked 13 Oct: the instruction never reached the model),
    # so RL ran without its rule, and H puts its instruction in the prompt, as the person would ask (run_long).
    if base == "R" and arm != "RTL":
        cmd += ["--append-system-prompt", ROUTING]
    if arm in TRAIL_ARMS:
        cmd += trail_mcp()
    return cmd


def prepare_docs(args):
    """The docs-and-tests session PD and PFD fork: the pack loaded, docs/ and tests/ read, src/ left unread (checked)."""
    if not LONG_DOCS_REPO.exists():
        LONG_DOCS.mkdir(parents=True, exist_ok=True)
        shutil.copytree(BASE, LONG_DOCS_REPO, symlinks=True)
    p = subprocess.run(neutral(["claude", "-p", DOCS_PREP_PROMPT, "--model", args.model, "--permission-mode", "auto", "--output-format", "json", *conditions("PD")]),
                       cwd=LONG_DOCS_REPO, capture_output=True, text=True, timeout=3600, stdin=subprocess.DEVNULL)
    res = json.loads(p.stdout)
    LONG_DOCS_SESSION.write_text(res["session_id"])
    a = account(res["session_id"])
    # Every tool call of the preparation that named src/ (a read, a grep): none should.
    src = set()
    for f in glob.glob(str(PROJECTS / "*" / f"{res['session_id']}.jsonl")):
        for line in open(f, errors="replace"):
            for b in (json.loads(line).get("message") or {}).get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_use" and "src/" in json.dumps(b.get("input")):
                    i = b.get("input") or {}
                    src.add(f"{b.get('name')}: {i.get('file_path') or i.get('command') or i.get('pattern') or ''}"[:160])
    src = sorted(src)
    print(f"prepared {res['session_id']}: {a.get('main_requests')} requests, context {a.get('peak_context')}, ${res.get('total_cost_usd', 0):.2f}"
          + (f"; WARNING, it touched src/: {src}" if src else "; nothing under src/ opened"))


def cmd_prepare(args):
    if getattr(args, "docs", False):
        return prepare_docs(args)
    if args.trail:
        # The copy of click Trail's fresh runs start from, and the long session's own repository.
        if not BASE_TRAIL.exists():
            shutil.copytree(BASE, BASE_TRAIL, symlinks=True)
            trail_init(BASE_TRAIL)
        if not LONG_TRAIL_REPO.exists():
            shutil.copytree(BASE_TRAIL, LONG_TRAIL_REPO, symlinks=True)
    elif not LONG_REPO.exists():
        shutil.copytree(BASE, LONG_REPO, symlinks=True)
    model = args.model
    arm = "TL" if args.trail else "P" if args.pack else "V"
    p = subprocess.run(neutral(["claude", "-p", PREP_PROMPT, "--model", model, "--permission-mode", "auto", "--output-format", "json", *conditions(arm)]),
                       cwd=long_repo(arm), capture_output=True, text=True, timeout=1800, stdin=subprocess.DEVNULL, env=trail_env() if args.trail else None)
    res = json.loads(p.stdout)
    (LONG_SESSION_TRAIL if args.trail else LONG_SESSION_PACK if args.pack else LONG_SESSION).write_text(res["session_id"])
    a = account(res["session_id"])
    print(f"prepared {res['session_id']}: {a.get('main_requests')} requests, context {a.get('peak_context')}, ${res.get('total_cost_usd', 0):.2f}")


def reset_long(repo: Path = LONG_REPO):
    subprocess.run(["git", "checkout", "-q", "--", "."], cwd=repo)
    # Trail's graph (graft/, ignored) is the tool's own state, kept as a person's checkout would keep it.
    subprocess.run(["git", "clean", "-q", "-fdx", "-e", "*.egg-info", "-e", "graft"], cwd=repo)


def run_long(task: str, arm: str, rep: int) -> dict:
    repo = long_repo(arm)
    reset_long(repo)
    # The process id too: two bench processes running one arm name started the same task in the same second and shared a folder.
    run_id = f"{task}.{arm}.{rep}.{int(time.time())}.{os.getpid()}"
    prompt = TASKS[task]["prompt"]
    if arm.startswith("H"):
        prompt = f"{FORCE}\n\n{prompt}"
    if arm == "DL":
        prompt = f"{prompt}\n\n{FIT}"
    cmd = ["claude", "-p", prompt, "--resume", session_file(arm).read_text().strip(), "--fork-session",
           "--model", "opus", "--permission-mode", "auto", "--output-format", "json", *conditions(arm)]
    started = time.time()
    try:
        p = subprocess.run(neutral(cmd), cwd=repo, capture_output=True, text=True, timeout=1800, stdin=subprocess.DEVNULL, env=trail_env() if arm in TRAIL_ARMS else None)
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
        "prepared": "trail" if arm == "TL" else "docs" if arm in DOCS_ARMS else "pack" if session_file(arm) == LONG_SESSION_PACK else "plain",
        "session": res.get("session_id"), "reported_usd": res.get("total_cost_usd"), "is_error": res.get("is_error", True),
        "answer": answer[:4000], "stderr": err[-500:] if err else "",
    }
    row["grade"] = grade(task, answer, repo)
    if task in ("t2-rename", "l1-feature", "l2-coverage", "t6-signature"):
        subprocess.run(["git", "add", "-A", "-N", "."], cwd=repo, capture_output=True)
        diff = subprocess.run(["git", "diff", "--binary", "HEAD", "--", ".", ":(exclude).coverage", ":(exclude)*.pyc", ":(exclude)__pycache__"], cwd=repo, capture_output=True, text=True).stdout
        (HERE / "patches" / f"{run_id}.patch").write_text(diff)
        subprocess.run(["git", "reset", "-q"], cwd=repo)
    if row["session"]:
        # A resumed session's reported cost includes the history it forked: what this run cost is what the
        # transcript holds from its start on (the copied history keeps its own, earlier timestamps).
        row["cost"] = account(row["session"], since=started)
    return row


def cmd_long(args):
    arms, tasks = args.arms.split(","), args.tasks.split(",") if args.tasks else list(TASKS)
    for a in arms:
        if not session_file(a).exists():
            sys.exit(f"no prepared session for {a}: run bench.py prepare{' --docs' if a in DOCS_ARMS else ' --pack' if session_file(a) == LONG_SESSION_PACK else ''} first")
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
            c = account(r["session"], since=0)
            if c.get("found") and not r.get("long"):
                r["cost"] = settle(c, r.get("model_usage"), r.get("reported_usd"))
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
    pr.add_argument("--trail", action="store_true", help="prepare Trail-Code's copies of click and its long session (pack and Trail loaded), for T and TL")
    pr.add_argument("--docs", action="store_true", help="prepare the docs-and-tests session (pack loaded, src/ unread), for PD and PFD")
    lo = sub.add_parser("long")
    lo.add_argument("--reps", type=int, default=2)
    lo.add_argument("--arms", default="VL,RL")
    lo.add_argument("--tasks", default="")
    a = ap.parse_args()
    {"run": cmd_run, "report": cmd_report, "prepare": cmd_prepare, "long": cmd_long}[a.cmd](a)
