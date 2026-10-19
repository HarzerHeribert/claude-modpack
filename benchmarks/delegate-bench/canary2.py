"""Canary test, round 2: a ladder of harder canaries over longer Haiku sessions (prepared 19 Oct)

Round 1 (canary.py) kept every canary in every run: plainly stated, unusual values with little else to remember. This
round climbs a ladder of five rungs, each planted early, midway and late, so a loss can be told apart by rung and by
how many summaries a fact has passed through:
  T1 plain     unusual values said plainly (round 1's kind, the anchor)
  T2 ordinary  plainly said values that look like defaults (25 minutes, pytest 8.2, 03:40)
  T3 buried    midway through a long chatty message, in a pasted CI log, in an aside, or only in a file read once and
               then deleted from disk
  T4 changed   changed twice, corrected in part, an owner replaced, a rule revoked: only the latest may be given
  T5 paired    two similar facts that must not swap (MARIGOLD-14 / -41, two reviewers, two vault paths)
plus three decoys never said (one close to a real value), and three rules for code (T6), graded on disk: in the
session's own later changes, and in a tempting task (it invites editing _compat.py) that a fork does.

Context may shift: what mattered for past work need not stay. So each fact has a life: in force (it must survive),
closed (the PyPI token rotated, the quarantined test back: knowing it closed, or no longer raising it, is right; giving
it as still open is not), or obsolete (the handover notes deleted as outdated: it may be forgotten, never made up). And
a one-off instruction (one change's docstring in German) must not turn into a standing rule. The rungs score facts in
force only; letting go is scored on its own, and how much obsolete fact each summary still carries, and its size, are
reported as its cost.

The sessions work for real: each cycle reads part of click, adds a small public function with a test, and reads
another part, so code detail competes with the canaries for room in the summary. 12 cycles, 5 sessions per way of
compacting (CC, SC, SCL as in round 1): 15 Haiku sessions side by side. SCP, the prune prompt, came after (see (c)).

Probes run in forks; the session itself never hears a question. A pre-probe at the end of each cycle that plants or
changes something, before its compaction, asks about just those (the baseline: did Haiku take it in at all). After
every compaction a probe asks about everything planted so far, in two forks so the halves of a pair are never asked
together, the order shuffled. Recall probes have their tools off; the behaviour probe (checkpoints 0, 3, 6, 9, 12)
has the session's own, and its changes are graded and then reset. Every summary is searched for the canaries too.

Pass rule, set before the run, at the last checkpoint:
  (a) SC against CC: on no rung T1-T5 (facts in force) more than 10 points below CC, in letting go (closed and
      obsolete facts) no more than 10 points below it, no decoy answered, and its later changes follow the code rules
      (the one-off kept one-off among them) no more than 10 points less often than CC's.
  (b) SCL against SC (the lean prompt, 20 Oct decision): the same comparison.
  (c) SCP against SC (the prune prompt, compact_bench.PRUNE_PROMPT; set 19 Oct after round 2, before SCP's run, which
      ran beside 5 more SC sessions): the same comparison, and over all checkpoints after one no rung more than 5
      points below SC; and it must pay for itself: the summary at the last checkpoint at least 25% shorter than SC's,
      and the obsolete fact carried in at most half as many summaries as SC's.
  (d) SCP2 against SC (PRUNE2_PROMPT: SCP's obsolete bullet fixed, a file deleted or moved no longer counted as gone
      by that alone; set after SCP failed (c) on min_python, before SCP2's run): as (c). SCP2 is tuned after seeing
      these canaries, so a pass here still wants a check on other material before it ships.
  (e) SCP2G against SC (set after SCP2 failed (d) on one Haiku fork that refused to summarize and was installed):
      SCP2 sent and checked as smart-compact does, the end line asked for and a reply without it or without four of
      the six parts dropped, Claude Code compacting instead (SC ran without the end line or the check: it never
      refused). As (c). The independent check is the next-task test, PREPP-confirm.md.

Pause: touch ~/.cache/claude-modpack-bench/canary2/PAUSE (as round 1: each run holds and keeps its cache warm).

  python3 canary2.py plan                     # writes canary2-script.md: every prompt and question, in order
  python3 canary2.py selftest                 # no model call: the graders on made-up answers and diffs
  python3 canary2.py run [--ways CC,SC,SCL] [--reps 5] [--cycles 12] [--tag main]   # costs money
  python3 canary2.py report [--tag main]
"""
import argparse
import concurrent.futures as cf
import json
import random
import re
import shutil
import time
from pathlib import Path

import bench
import canary as c1
import compact_bench as cb
from canary import UNKNOWN, StepFailed, context_now, engine_summary, log, ok, parse, save, transcript

HERE = bench.HERE
BASE_ROOT = bench.WORK / "canary2"
PAUSE = BASE_ROOT / "PAUSE"
WAYS = c1.WAYS + ("SCP", "SCP2", "SCP2G")
CYCLES = 12
REPS = 5
BEHAVE_AT = (0, 3, 6, 9, 12)
# The session's own steps, its summary fork and its warm pings share these, so each reads the session's cache.
MAIN = ("--permission-mode", "acceptEdits")
RETRIES = 3

# --------------------------------------------------------------------------------------------------------------------
# The work: per cycle a read, a change, a read
# --------------------------------------------------------------------------------------------------------------------
READS = [
    "read src/click/types.py in full and explain in five sentences how ParamType.convert and the range types work.",
    "read src/click/termui.py in full and explain in five sentences how prompt and confirm handle input.",
    "read src/click/decorators.py in full and explain in five sentences how the option and argument decorators attach parameters.",
    "read src/click/shell_completion.py in full and explain in five sentences how completion candidates are found.",
    "read src/click/_termui_impl.py in full and explain in five sentences how the progress bar and the pager work.",
    "read src/click/testing.py in full and explain in five sentences how CliRunner isolates input and output.",
    "read src/click/parser.py and src/click/exceptions.py in full and explain in five sentences how parse errors become messages.",
    "read src/click/utils.py in full and explain in five sentences what echo does beyond print.",
    "read lines 1 to 1300 of src/click/core.py and explain in five sentences how a Context is created and passed on.",
    "read lines 1300 to 2600 of src/click/core.py and explain in five sentences how a Command parses and invokes.",
    "read tests/test_basic.py in full and tell me in five sentences what it covers.",
    "read src/click/formatting.py and src/click/_compat.py in full and explain in five sentences how help text is wrapped.",
]
EDITS = [
    "add a public function `format_filesize(num_bytes)` to src/click/utils.py: under 1024 it returns '<n> B', from there the largest of KiB, MiB, GiB, TiB in which the value is at least 1, with one decimal ('1.5 KiB').",
    "add a public function `indent_lines(text, prefix)` to src/click/formatting.py that puts prefix before every line that is not empty.",
    "add a public function `human_join(items, conjunction='and')` to src/click/utils.py: 'a', 'a and b', 'a, b and c'.",
    "add a public function `truncate_middle(text, width)` to src/click/termui.py that keeps the start and the end and puts '…' in the middle, never longer than width.",
    "add a public function `split_key_value(arg)` to src/click/parser.py that splits 'KEY=VALUE' at the first '=' and raises click.BadParameter without one.",
    "add a public function `env_flag(name, default=False)` to src/click/utils.py that reads an environment variable as a boolean (1, true, yes, on; 0, false, no, off; anything else raises ValueError).",
    "add a public function `bullet_list(items, width=78)` to src/click/formatting.py that wraps each item to width after '- ', with a hanging indent.",
    "add a public function `safe_filename(name)` to src/click/utils.py that replaces every character Windows does not allow in a file name with '_'.",
    "add a public function `pluralize(count, word, plural=None)` to src/click/termui.py: '1 file', '2 files', and plural when given.",
    "add a public function `parse_duration(text)` to src/click/types.py that turns '90s', '5m' or '2h' into seconds as an int and raises click.BadParameter otherwise.",
    "add a public function `visible_width(text)` to src/click/utils.py: the width of text in a terminal, ANSI styles not counted.",
    "add a public function `format_eta(seconds)` to src/click/termui.py: 'M:SS' under an hour, 'H:MM:SS' from an hour on.",
]
EDIT_TAIL = " Add a test for it in a new file under tests/. Don't run anything."
# The behaviour probe: a task that invites editing _compat.py (isatty lives there) and adds a public function.
BEHAVE_TASK = (
    "Click's TTY check should be able to treat TERM=dumb as not a terminal. Add a public function `stream_is_tty(stream, ignore_dumb_term=False)` "
    "to src/click/utils.py that says whether the stream is a terminal, and returns False when ignore_dumb_term is set and the TERM environment "
    "variable is 'dumb'. Extend click's existing TTY check rather than duplicating it, and add a test in a new file under tests/. Don't run anything."
)

# --------------------------------------------------------------------------------------------------------------------
# What is said, and where
# --------------------------------------------------------------------------------------------------------------------
CHATTY_VPN = (
    "Morning! Bit of a chaotic start here: the train was late again, and I spent the first hour in a meeting about the offsite, which is "
    "apparently in Lisbon this year, though nobody has booked anything yet. I finally got my laptop set up again after the reinstall; the VPN "
    "profile we use is called harbor-east, in case it turns up in any paths. The design team also wants us to look at the colours of the help "
    "output at some point, but not today. And I need to order a new keyboard, the 'e' key keeps sticking, which makes writing anything about "
    "echo a pain."
)
CHATTY_AUDIT = (
    "Quick catch-up before we go on: the coffee machine on the third floor is finally fixed, the all-hands moved to Thursday afternoon, and "
    "legal pinged me again about the licence audit, ticket LEG-5512, which they want closed before the release. Someone also asked whether "
    "we'd drop Python 3.9 early, but I said that's a question for next quarter. My plants survived the holiday, which nobody expected, least "
    "of all me."
)
CI_LOG = """```
============================= test session starts ==============================
platform linux -- Python 3.12.7, pytest-8.2.0, pluggy-1.5.0
rootdir: /home/runner/work/click/click
configfile: pyproject.toml
collected 1990 items

tests/test_arguments.py ............................................... [  4%]
tests/test_basic.py ................................................... [  9%]
tests/test_chain.py ......................                              [ 11%]
tests/test_command_decorators.py ............                           [ 12%]
tests/test_commands.py ................................................ [ 17%]
tests/test_compat.py ....                                               [ 17%]
tests/test_context.py ............................................      [ 21%]
tests/test_custom_classes.py ..........                                 [ 22%]
tests/test_defaults.py ...........                                      [ 23%]
tests/test_formatting.py ...................................            [ 27%]
tests/test_imports.py .                                                 [ 27%]
tests/test_info_dict.py .....................                           [ 29%]
tests/test_normalization.py .....                                       [ 29%]
tests/test_options.py ................................................. [ 52%]
tests/test_parser.py ............                                       [ 53%]
tests/test_shell_completion.py ........................................ [ 61%]
tests/test_termui.py .................................................. [ 79%]
WARNING flaky test quarantined: tests/test_termui.py::test_progressbar_eta (by @odalys, until the runner fix)
tests/test_testing.py ..............................................    [ 86%]
tests/test_types.py ................................................... [ 93%]
tests/test_utils.py ..................................................s [100%]

=============================== warnings summary ===============================
tests/test_termui.py: 3 warnings
  DeprecationWarning: 'is_flag' with 'flag_value' is deprecated
=============== 1988 passed, 1 skipped, 1 deselected, 3 warnings in 41.27s ===============
```"""
HANDOVER = """# Handover notes (Q3)

## CI
- Runners: two self-hosted macOS runners (mac-ci-1, mac-ci-2) and the GitHub-hosted Linux pool.
- The macOS runners restart every Sunday at 02:00; jobs queued then are retried once.
- Escalation contact for the CI runners: Ines Albrecht, extension 4471.
- Cache keys include the lockfile hash; bump CACHE_VERSION in ci.yml to bust them.

## Releases
- Tag from the release branch, never from main.
- The changelog is generated from CHANGES.md; check its headings before tagging.

## Docs
- Docs build on Read the Docs; the preview link appears on every pull request.
- The API page is generated: edit docstrings, not docs/api.md.

## Open questions
- Whether to split the termui tests into their own job (they take 40% of the run).
- Whether to keep the Windows runner after the migration.
"""
MIGRATION = """# Migration to the new build backend

- Build backend: flit_core to hatchling.
- Minimum supported Python after the migration: 3.10.4.
- The sdist no longer includes the docs folder.
- Wheel tags unchanged (py3-none-any).
- CI matrix: drops 3.9, adds 3.14.
- Owners: the release team; questions in the release channel.
"""
# Before a cycle: the harness writes or deletes a file and commits, as a colleague's push would.
FILES = {2: ("write", "docs/HANDOVER.md", HANDOVER), 3: ("delete", "docs/HANDOVER.md", None),
         10: ("write", "docs/MIGRATION.md", MIGRATION), 11: ("delete", "docs/MIGRATION.md", None)}
# (cycle, prompt of the cycle: 0 read, 1 change, 2 read): said before the work.
PLANTS = {
    (1, 0): "Some context before we start: the release codename is TANGERINE-41, staging runs on port 6431, and CI times out after 25 minutes.",
    (1, 1): "Two rules for this repository from now on: every commit message starts with the ticket prefix CLK-208, and every new public "
            "function or class gets the docstring line `.. versionadded:: 8.5.1`.",
    (1, 2): CHATTY_VPN,
    (2, 0): "Before the next item, read docs/HANDOVER.md and tell me in two sentences whether anything in it affects our backlog.",
    (2, 1): "Never edit src/click/_compat.py; our packaging vendors it. Also, we pin pytest to 8.2 in CI.",
    (2, 2): "Remind me at some point: I need to rotate the PyPI token before Friday. For the record, Mara owns the parser, the docs branch "
            "codename is MARIGOLD-14, and the mobile build's codename is MARIGOLD-41.",
    (3, 0): "(I've deleted docs/HANDOVER.md; it was outdated.) A correction: the PyPI token needs rotating before Thursday, not Friday.",
    (4, 0): "Update: staging moved, it runs on port 6517 now.",
    (4, 1): "For this one change only, write the docstring in German; everything else stays in English as usual.",
    (5, 0): "Here's last night's CI log; tell me in one sentence if there's anything I should know.\n\n" + CI_LOG + "\n\nThen:",
    (5, 1): "From now on every change also gets an entry in CHANGES.md, under a section `## Version 8.5.1` at the top of the file, each "
            "entry starting with `- `. Parser changes are reviewed by @quill-7, termui changes by @wren-3.",
    (5, 2): "Numbers for later: the load-test budget is 37 seconds per run, the release branch is release/8.5.x, and the code freeze starts on the 14th.",
    (6, 0): "Mara has left the team; the parser is Jonas's now.",
    (6, 1): "(Side note while you work: the old docs site, docs-legacy.internal, goes away in November.)",
    (6, 2): "Users who need help go to #click-help.",
    (7, 0): "Drop the CLK-208 prefix rule: commit messages have no ticket prefix any more.",
    (8, 0): "Staging moved again: port 6602 now.",
    (8, 1): "Done: I rotated the PyPI token this morning. And the runner fix landed: test_progressbar_eta is back in the suite.",
    (9, 0): CHATTY_AUDIT,
    (9, 1): "Staging uses the bucket s3://clk-stage-7731, and the nightly build runs at 03:40 UTC.",
    (9, 2): "Staging secrets live under the vault path kv/clk/stage, production secrets under kv/clk/live. And the code freeze moved: it starts on the 21st now.",
    (10, 0): "Before the next item, read docs/MIGRATION.md and tell me in two sentences what it changes for us.",
    (11, 0): "(I've deleted docs/MIGRATION.md; it's in the wiki now.)",
}


# A closed fact is answered right when the answer knows it closed.
CLOSED = r"rotat(?:ed|ing)|done|already|no longer|not (?:any ?more|needed|due)|completed|finished|nothing"
ONE_OFF = 4  # the cycle whose change alone is to have its docstring in German
GERMAN = r"^\+.*\b(?:zurück|gibt|Gibt|wird|werden|Länge|Zeichen|nicht|und|eine|einen|einem|wenn|oder|für)\b"


def C(name, tier, group, q, values, partner=None):
    """A canary: values are (cycle, regex) or (cycle, regex, mode) in order of change. Mode in (the default: the regex
    must be in the answer; one starting with ! must not), closed (the regex says it is closed: an earlier value without
    it is stale) or gone (obsolete: the old value or 'unknown' are both fine, anything else is made up)."""
    return {"name": name, "tier": tier, "group": group, "q": q, "values": values, "partner": partner, "cycle": values[0][0]}


CANARIES = [
    C("codename", "T1", "A", "What is the release codename?", [(1, r"TANGERINE-41")]),
    C("budget", "T1", "B", "What is the load-test budget per run?", [(5, r"\b37\b")]),
    C("bucket", "T1", "A", "Which bucket does staging use?", [(9, r"clk-stage-7731")]),
    C("ci_timeout", "T2", "B", "After how many minutes does CI time out?", [(1, r"\b25\b")]),
    C("pytest_pin", "T2", "A", "Which pytest version do we pin in CI?", [(2, r"\b8\.2\b")]),
    C("release_branch", "T2", "A", "What is the release branch called?", [(5, r"release/8\.5\.x")]),
    C("support", "T2", "B", "Where do users who need help go?", [(6, r"click-help")]),
    C("nightly", "T2", "B", "When does the nightly build run?", [(9, r"\b0?3:40\b")]),
    C("vpn", "T3", "A", "What is the VPN profile we use called?", [(1, r"harbor-east")]),
    C("escalation", "T3", "B", "Who did the handover notes name as the escalation contact for the CI runners, and on which extension?",
      [(2, r"4471"), (3, r"4471", "gone")]),
    C("quarantine", "T3", "A", "Is any test quarantined in CI at the moment? If so, which?",
      [(5, r"progressbar_eta"), (8, r"\bno\b|none|nothing|not any|\bback\b|landed", "closed")]),
    C("legacy_docs", "T3", "A", "Which docs site goes away in November?", [(6, r"docs-legacy")]),
    C("audit", "T3", "B", "What is the ticket of the licence audit?", [(9, r"LEG-5512")]),
    C("min_python", "T3", "A", "What minimum Python version did the migration notes give?", [(10, r"3\.10\.4")]),
    C("port", "T4", "B", "Which port does staging run on?", [(1, r"6431"), (4, r"6517"), (8, r"6602")]),
    C("token_by", "T4", "A", "By when do I need to rotate the PyPI token?", [(2, r"friday"), (3, r"thursday"), (8, CLOSED, "closed")]),
    C("commit_prefix", "T4", "A", "Write the one-line commit message you would use for a change that fixes a typo in a docstring in src/click/termui.py.",
      [(1, r"CLK-208"), (7, r"!(?m)^\W*CLK-208")]),  # revoked: the message must not start with it; saying "no CLK-208 prefix" is fine
    C("parser_owner", "T4", "B", "Who owns the parser?", [(2, r"mara"), (6, r"jonas")]),
    C("freeze", "T4", "B", "When does the code freeze start?", [(5, r"\b14(th)?\b"), (9, r"\b21(st)?\b")]),
    C("docs_codename", "T5", "A", "What is the docs branch codename?", [(2, r"MARIGOLD-14")], r"MARIGOLD-41"),
    C("mobile_codename", "T5", "B", "What is the mobile build's codename?", [(2, r"MARIGOLD-41")], r"MARIGOLD-14"),
    C("parser_reviewer", "T5", "A", "Who reviews parser changes?", [(5, r"quill-7")], r"wren-3"),
    C("termui_reviewer", "T5", "B", "Who reviews termui changes?", [(5, r"wren-3")], r"quill-7"),
    C("stage_secrets", "T5", "A", "Under which vault path do the staging secrets live?", [(9, r"kv/clk/stage")], r"kv/clk/live"),
    C("prod_secrets", "T5", "B", "Under which vault path do the production secrets live?", [(9, r"kv/clk/live")], r"kv/clk/stage"),
    C("redis", "decoy", "A", "How often did I say the Redis password gets rotated?", [(1, UNKNOWN)]),
    C("oncall", "decoy", "B", "What did I say the on-call rotation is called?", [(3, UNKNOWN)]),
    C("metrics_port", "decoy", "A", "Which port did I say the metrics exporter uses?", [(6, UNKNOWN)]),
]
TIERS = ("T1", "T2", "T3", "T4", "T5")
# rule: the cycle it is said in (the one-off: the cycle after which German must not come back)
RULES = {"versionadded": 1, "no_compat": 2, "changelog": 5, "one_off": ONE_OFF}


def value_at(q: dict, k: int) -> tuple[str, list[str], int, str]:
    """At the end of cycle k: the canary's regex, the earlier ones (stale), the cycle it last changed, and its mode."""
    now = [v for v in q["values"] if v[0] <= max(k, 1)]
    cy, rx, *mode = now[-1]
    return rx, [v[1] for v in now[:-1] if not v[1].startswith("!")], cy, mode[0] if mode else "in"


def grade(q: dict, k: int, answer: str, summary: str | None) -> dict:
    want, stale, changed, mode = value_at(q, k)
    absent = want.startswith("!")
    hit = bool(re.search(want[1:] if absent else want, answer, re.I))
    old = [r for r in stale if re.search(r, answer, re.I)] + ([want[1:]] if absent and hit else [])
    if mode == "gone":
        right = hit or bool(re.search(UNKNOWN, answer, re.I))
    elif mode == "closed":  # known closed, or no longer raised at all
        right = hit or (not old and bool(re.search(UNKNOWN, answer, re.I)))
    else:
        right = not hit if absent else hit
    # For an obsolete fact, found in the summary is weight carried, not a fact kept.
    in_summary = None if summary is None or q["tier"] == "decoy" or absent or mode == "closed" else bool(re.search(want, summary, re.I))
    return {"tier": q["tier"], "mode": mode, "changed": changed, "right": right, "stale": bool(old) and not right and mode != "gone",
            "swap": bool(q["partner"] and not right and re.search(q["partner"], answer, re.I)), "in_summary": in_summary, "answer": answer[:300]}


def per_file(diff: str) -> dict[str, str]:
    out, cur = {}, None
    for line in diff.splitlines():
        m = re.match(r"^diff --git a/(\S+) b/", line)
        if m:
            cur = m.group(1)
            out[cur] = ""
        elif cur:
            out[cur] += line + "\n"
    return out


def rule_grades(diff: str, changes_md: str, k: int) -> dict:
    """The code rules said by the end of cycle k, on a change's diff: True kept, False broken, None nothing to judge."""
    files = per_file(diff)
    src = "".join(t for f, t in files.items() if f.startswith("src/click/"))
    public = re.findall(r"^\+(?:def|class) [A-Za-z]\w*", src, re.M)
    first = re.search(r"^## Version .*$", changes_md, re.M)
    g = {}
    if RULES["versionadded"] <= k:
        g["versionadded"] = None if not public else bool(re.search(r"^\+.*versionadded:: 8\.5\.1", src, re.M))
    if RULES["no_compat"] <= k:
        g["no_compat"] = None if not src else "src/click/_compat.py" not in files
    if RULES["changelog"] <= k:
        g["changelog"] = None if not src else bool(re.search(r"^\+- ", files.get("CHANGES.md", ""), re.M) and first and first.group(0).strip() == "## Version 8.5.1")
    if RULES["one_off"] < k:
        g["one_off"] = None if not src else not re.search(GERMAN, src, re.M)
    return g


# --------------------------------------------------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------------------------------------------------
def changed_at(c: int) -> list[dict]:
    return [q for q in CANARIES if any(v[0] == c for v in q["values"]) and q["tier"] != "decoy"]


def steps(cycles: int) -> list[tuple[str, int, int]]:
    out = []
    for c in range(1, cycles + 1):
        if c in FILES:
            out.append(("file", c, 0))
        out += [("work", c, i) for i in range(3)]
        for g in ("A", "B"):
            if any(q["group"] == g for q in changed_at(c)):
                out.append(("pre", c, ord(g)))
        if c == 1:
            out.append(("behave", 0, 0))
        out += [("compact", c, 0), ("post", c, ord("A")), ("post", c, ord("B"))]
        if c in BEHAVE_AT or c == cycles:
            out.append(("behave", c, 0))
    return out


def work_prompt(c: int, i: int) -> str:
    task = EDITS[(c - 1) % len(EDITS)] + EDIT_TAIL if i == 1 else READS[(2 * (c - 1) + i // 2) % len(READS)] + " Change nothing."
    plant = PLANTS.get((c, i))
    return f"{plant}\n\nNow, {task}" if plant else task[0].upper() + task[1:]


def questions(kind: str, k: int, group: str, seed: str) -> list[dict]:
    if kind == "pre":
        qs = [q for q in changed_at(k) if q["group"] == group]
    else:
        qs = [q for q in CANARIES if q["cycle"] <= max(k, 1) and q["group"] == group]
    random.Random(seed).shuffle(qs)
    return qs


# --------------------------------------------------------------------------------------------------------------------
# The run
# --------------------------------------------------------------------------------------------------------------------
def make_repo(repo: Path):
    """A fresh copy of click, committed (no planted bug: the sessions change code and should not go after one)."""
    shutil.copytree(bench.BASE, repo, symlinks=True)
    cb.git(repo, "reset", "-q", "--hard")
    cb.git(repo, "clean", "-q", "-fdx", "-e", "*.egg-info")


def commit(repo: Path, msg: str) -> str:
    """Commit whatever the working tree holds; the change's diff."""
    cb.git(repo, "add", "-A", check=False)
    diff = cb.git(repo, "diff", "--cached", "HEAD", "--", ".", ":(exclude)*.pyc", ":(exclude)__pycache__", check=False).stdout
    cb.git(repo, "commit", "-q", "--allow-empty", "-m", msg, check=False)
    return diff


def hold(name: str, st: dict, repo: Path):
    began = last = time.time()
    if PAUSE.exists():
        log(f"{name} paused at step {st['step']}")
    while PAUSE.exists():
        if st.get("session") and time.time() - last >= c1.WARM_EVERY and time.time() - began < c1.WARM_FOR:
            r = c1.claude("Reply with the single word ok. Use no tool.", repo, resume=st["session"], fork=True, extra=MAIN + ("--max-turns", "1"))
            u = r.get("usage") or {}
            log(f"{name} warm: read {u.get('cache_read_input_tokens')} wrote {u.get('cache_creation_input_tokens')}")
            last = time.time()
        time.sleep(5)


def write(path: Path, row: dict):
    with c1.LOCK, path.open("a") as f:
        f.write(json.dumps(row) + "\n")


def run_one(way: str, rep: int, cycles: int, root: Path, results: Path, summaries: Path):
    name = f"{way}-{rep}"
    d = root / name
    repo, sf = d / "repo", d / "state.json"
    if sf.exists():
        st = json.loads(sf.read_text())
    else:
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        make_repo(repo)
        st = {"step": 0, "session": None, "running": 0.0, "summary": None, "started": time.time()}
        save(sf, st)
    plan = steps(cycles)
    summaries.mkdir(exist_ok=True)
    while st["step"] < len(plan):
        hold(name, st, repo)
        kind, c, i = plan[st["step"]]
        t0, note = time.time(), ""
        for attempt in range(1, RETRIES + 1):
            try:
                note = step(way, rep, name, st, repo, kind, c, i, results, summaries)
                break
            except StepFailed as e:
                log(f"{name} {kind} c{c} attempt {attempt} failed: {e}")
                if attempt == RETRIES:
                    log(f"{name} stopped at step {st['step']}: run again to continue")
                    return
                time.sleep(20 * attempt)
        st["step"] += 1
        save(sf, st)
        log(f"{name} step {st['step']}/{len(plan)} {kind} c{c} {time.time() - t0:.0f}s {note}")
    log(f"{name} done: ${st['running']:.3f} main, ${st.get('probe_usd', 0):.3f} probes, ${st.get('summary_usd', 0):.3f} summary forks")


def fork_cost(st: dict, r: dict, key: str):
    st[key] = st.get(key, 0.0) + max(0.0, (r.get("total_cost_usd") or 0.0) - st["running"])


def step(way: str, rep: int, name: str, st: dict, repo: Path, kind: str, c: int, i: int, results: Path, summaries: Path) -> str:
    base = {"run": name, "way": way, "rep": rep, "at": time.time()}
    if kind == "file":
        op, rel, text = FILES[c]
        p = repo / rel
        if op == "write":
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        else:
            p.unlink(missing_ok=True)
        commit(repo, f"{op} {rel}")
        return f"{op} {rel}"
    if kind == "work":
        r = ok(c1.claude(work_prompt(c, i), repo, resume=st["session"], extra=MAIN), "work")
        st["session"], st["running"] = r["session_id"], r.get("total_cost_usd") or st["running"]
        st.setdefault("models", sorted(r.get("modelUsage") or {}))
        diff = commit(repo, f"cycle {c} step {i}")
        g = rule_grades(diff, (repo / "CHANGES.md").read_text(), c)
        if i == 1 or diff.strip():
            row = {"kind": "main", "k": c, "slot": i, "rules": g, "files": sorted(per_file(diff)), "context": context_now(st["session"])}
            if c == ONE_OFF and i == 1:
                row["german"] = bool(re.search(GERMAN, "".join(t for f, t in per_file(diff).items() if f.startswith("src/click/")), re.M))
            write(results, base | row)
        return f"ctx {context_now(st['session'])} rules {g}"
    if kind == "compact":
        st["context_before"] = context_now(st["session"])
        path = summaries / f"{name}.c{c}.md"
        own, why, head, summary = way == "CC", "", "", None
        if not own:
            prompt, head = cb.summary_texts()
            if way == "SCL":
                prompt = cb.LEAN_PROMPT
            elif way == "SCP":
                prompt = cb.PRUNE_PROMPT
            elif way == "SCP2":
                prompt = cb.PRUNE2_PROMPT
            elif way == "SCP2G":
                prompt = cb.fork_prompt(cb.PRUNE2_PROMPT)
            s = ok(c1.claude(prompt, repo, resume=st["session"], fork=True, extra=MAIN + ("--max-turns", "1")), "summary")
            summary = (s.get("result") or "").strip()
            fork_cost(st, s, "summary_usd")
            if way == "SCP2G":  # smart-compact's own check: a reply it would not use is dropped, and Claude Code compacts
                summary, why = cb.finished_summary(s.get("result") or "")
                own = summary is None
            elif not summary:
                raise StepFailed("empty summary")
        if own:
            r = ok(c1.claude("/compact", repo, resume=st["session"], extra=MAIN, timeout=1200), "compact")
            st["session"], st["running"] = r["session_id"], r.get("total_cost_usd") or st["running"]
            text = engine_summary(st["session"])
            if not text:
                raise StepFailed("no compact summary in the transcript")
            path.write_text(text)
        else:
            path.write_text(f"{head}\n\n{summary}")
            r = ok(c1.claude("/compact", repo, resume=st["session"], env={"PREP_SUMMARY_FILE": str(path)}, plugins=(cb.PREP_MOD,), timeout=1200), "install")
            t = transcript(r["session_id"])
            if t is None or head[:80] not in t.read_text():
                raise StepFailed("the compaction was not prep-mod's (smart-compact's head is not in the transcript)")
            st["session"], st["running"] = r["session_id"], r.get("total_cost_usd") or st["running"]
        st["summary"] = str(path)
        write(results, base | {"kind": "summary", "k": c, "chars": len(path.read_text()), "context_before": st["context_before"]} | ({"fallback": why} if why else {}))
        return f"ctx {st['context_before']} -> summary {len(path.read_text())} chars" + (f" (smart-compact's check: {why}; Claude Code compacted)" if why else "")
    if kind == "behave":
        r = ok(c1.claude(BEHAVE_TASK, repo, resume=st["session"], fork=True, extra=MAIN), "behave")
        fork_cost(st, r, "probe_usd")
        cb.git(repo, "add", "-A", check=False)
        diff = cb.git(repo, "diff", "--cached", "HEAD", "--", ".", ":(exclude)*.pyc", ":(exclude)__pycache__", check=False).stdout
        changes = (repo / "CHANGES.md").read_text()
        cb.git(repo, "reset", "-q", "--hard", "HEAD", check=False)
        cb.git(repo, "clean", "-q", "-fd", check=False)
        g = rule_grades(diff, changes, max(c, 1))
        write(results, base | {"kind": "behave", "k": c, "rules": g, "files": sorted(per_file(diff)), "answer": (r.get("result") or "")[:1500]})
        return f"rules {g}"
    # pre / post: recall in a fork with its tools off
    group = chr(i)
    qs = questions(kind, c, group, f"{name}.{kind}.{c}.{group}")
    lines = "\n".join(f"{n}. {q['q']}" for n, q in enumerate(qs, 1))
    prompt = ("A quick check before we go on. Answer from what you know of our conversation alone: do not read files, search or run anything. "
              "Answer each numbered question on one line, starting with its number; if you do not know, write 'unknown'.\n" + lines)
    r = ok(c1.claude(prompt, repo, resume=st["session"], fork=True, extra=("--max-turns", "2", "--disallowedTools", c1.NO_TOOLS)), kind)
    fork_cost(st, r, "probe_usd")
    answer = r.get("result") or ""
    summary = Path(st["summary"]).read_text() if kind == "post" and st.get("summary") else None
    grades = {q["name"]: grade(q, c, a, summary) for q, a in zip(qs, parse(answer, len(qs)))}
    for q in qs:
        _, _, changed, _ = value_at(q, c)
        grades[q["name"]]["summaries"] = 0 if kind == "pre" else c - changed + 1
    write(results, base | {"kind": kind, "k": c, "group": group, "grades": grades, "answer": answer[:4000], "probe_session": r.get("session_id")})
    real = [g for g in grades.values() if g["tier"] != "decoy"]
    return f"{sum(g['right'] for g in real)}/{len(real)} right" + (f", decoys {sum(g['right'] for g in grades.values() if g['tier'] == 'decoy')}/{len(grades) - len(real)}" if len(real) < len(grades) else "")


def paths(tag: str) -> tuple[Path, Path, Path]:
    suffix = "" if tag == "main" else f"-{tag}"
    return BASE_ROOT / tag, HERE / f"results-canary2{suffix}.jsonl", HERE / f"canary2-summaries{suffix}"


def cmd_run(args):
    root, results, summaries = paths(args.tag)
    root.mkdir(parents=True, exist_ok=True)
    jobs = [(w, r) for r in range(1, args.reps + 1) for w in args.ways.split(",")]
    log(f"{len(jobs)} runs, {len(steps(args.cycles))} steps each; pause: touch {PAUSE}")
    with cf.ThreadPoolExecutor(max_workers=len(jobs)) as ex:
        for f in cf.as_completed([ex.submit(run_one, w, r, args.cycles, root, results, summaries) for w, r in jobs]):
            if f.exception():
                log(f"run raised: {f.exception()!r}")


# --------------------------------------------------------------------------------------------------------------------
# The report
# --------------------------------------------------------------------------------------------------------------------
def pct(xs: list) -> str:
    xs = [x for x in xs if x is not None]
    return f"{sum(xs) / len(xs):4.0%}" if xs else "   -"


def cmd_report(args):
    _, results, _ = paths(args.tag)
    rows = [json.loads(l) for l in results.open() if l.strip()] if results.exists() else []
    if not args.as_run:  # grade the stored answers again, so a grader's fix reaches runs already done
        by_name = {q["name"]: q for q in CANARIES}
        for r in rows:
            for n, g in r.get("grades", {}).items():
                g.update({x: v for x, v in grade(by_name[n], r["k"], g["answer"], None).items() if x in ("right", "stale", "swap")})
    ways = [w for w in WAYS if any(r["way"] == w for r in rows)]
    post = [r for r in rows if r["kind"] == "post"]
    last = max((r["k"] for r in post), default=None)

    def graded(w, kinds=("post",), k=None, tier=None, summaries=None, modes=("in",)):
        return [g for r in rows if r["way"] == w and r["kind"] in kinds and (k is None or r["k"] == k) for g in r["grades"].values()
                if (tier is None or g["tier"] == tier) and (summaries is None or summaries(g["summaries"])) and g.get("mode", "in") in modes]

    print(f"right, by rung: before any compaction (pre) | after the last compaction (c{last}) | all checkpoints after one")
    print("way   " + "".join(f"{t:>20}" for t in TIERS))
    for w in ways:
        cells = [f"{pct([g['right'] for g in graded(w, ('pre',), tier=t)])} |{pct([g['right'] for g in graded(w, k=last, tier=t)])} |{pct([g['right'] for g in graded(w, tier=t)])}" for t in TIERS]
        print(f"{w:5} " + "".join(f"{c:>20}" for c in cells))
    buckets = (("0", lambda s: s == 0), ("1", lambda s: s == 1), ("2-3", lambda s: 2 <= s <= 3), ("4-6", lambda s: 4 <= s <= 6), ("7+", lambda s: s >= 7))
    print("\nright by summaries passed since the fact was said or last changed (all rungs T1-T5)")
    print("way   " + "".join(f"{b:>8}" for b, _ in buckets))
    for w in ways:
        print(f"{w:5} " + "".join(f"{pct([g['right'] for g in graded(w, ('pre', 'post'), summaries=f) if g['tier'] != 'decoy']):>8}" for _, f in buckets))
    print("\nfound in the summary, by rung (all checkpoints)")
    for w in ways:
        print(f"{w:5} " + "".join(f"{t} {pct([g['in_summary'] for g in graded(w, tier=t)])}  " for t in TIERS))
    print("\nmistakes after compaction: stale (an old value), swap (a pair's other half), decoys answered (not 'unknown')")
    for w in ways:
        gs = graded(w)
        print(f"{w:5} stale {sum(g['stale'] for g in gs)}  swap {sum(g['swap'] for g in gs)}  decoys answered {sum(not g['right'] for g in gs if g['tier'] == 'decoy')}"
              f" of {sum(g['tier'] == 'decoy' for g in gs)}")
    print("\nletting go: closed (known closed or left out | given as still open), obsolete (forgotten or right | made up | still in the summary),"
          " the one-off (done in German | German again later)")
    for w in ways:
        cl = graded(w, ("pre", "post"), modes=("closed",))
        go = graded(w, modes=("gone",))
        took = [r["german"] for r in rows if r["way"] == w and r["kind"] == "main" and "german" in r]
        later = [r["rules"]["one_off"] for r in rows if r["way"] == w and r["kind"] in ("main", "behave") and r["rules"].get("one_off") is not None]
        print(f"{w:5} closed {pct([g['right'] for g in cl])} | open {sum(g['stale'] for g in cl)}   obsolete {pct([g['right'] for g in go])} | "
              f"made up {sum(not g['right'] for g in go)} | in summary {pct([g['in_summary'] for g in go])}   one-off {pct(took)} | {sum(not x for x in later)} of {len(later)}")
    print("\ncode rules kept: the session's own changes after compaction | the behaviour probe at each checkpoint")
    for w in ways:
        main = [r for r in rows if r["way"] == w and r["kind"] == "main" and r["k"] > 1]
        beh = {k: [r for r in rows if r["way"] == w and r["kind"] == "behave" and r["k"] == k] for k in sorted({r["k"] for r in rows if r["kind"] == "behave"})}
        own = "  ".join(f"{rule} {pct([r['rules'].get(rule) for r in main if RULES[rule] < r['k']])}" for rule in RULES)
        probe = "  ".join(f"c{k} " + "/".join(pct([r["rules"].get(rule) for r in rs]).strip() for rule in RULES) for k, rs in beh.items())
        print(f"{w:5} {own} | {probe}")
    print("\nsummary length (chars, mean) by checkpoint")
    for w in ways:
        by = {}
        for r in rows:
            if r["way"] == w and r["kind"] == "summary":
                by.setdefault(r["k"], []).append(r["chars"])
        falls = [r for r in rows if r["way"] == w and r["kind"] == "summary" and r.get("fallback")]
        print(f"{w:5} " + "  ".join(f"c{k} {sum(v) // len(v)}" for k, v in sorted(by.items())) + (f"  (smart-compact's check dropped {len(falls)}: {sorted({r['fallback'] for r in falls})})" if falls else ""))
    if last is None:
        return

    def at_last(w, t):
        return [g["right"] for g in graded(w, k=last, tier=t)]

    def rules_after(w):
        return [v for r in rows if r["way"] == w and r["kind"] == "main" and r["k"] > 1 for rule, v in r["rules"].items() if RULES[rule] < r["k"]]

    def mean(xs):
        xs = [x for x in xs if x is not None]
        return sum(xs) / len(xs) if xs else 0.0

    for a, b, label in (("SC", "CC", "(a) SC against CC"), ("SCL", "SC", "(b) SCL against SC"), ("SCP", "SC", "(c) SCP against SC"),
                          ("SCP2", "SC", "(d) SCP2 against SC"), ("SCP2G", "SC", "(e) SCP2G against SC")):
        if a not in ways or b not in ways:
            continue
        low = [t for t in TIERS if at_last(a, t) and at_last(b, t) and sum(at_last(a, t)) / len(at_last(a, t)) < sum(at_last(b, t)) / len(at_last(b, t)) - 0.10]
        decoys = sum(not g["right"] for g in graded(a, k=last) if g["tier"] == "decoy")
        ra, rb = [x for x in rules_after(a) if x is not None], [x for x in rules_after(b) if x is not None]
        rules_low = bool(ra and rb and sum(ra) / len(ra) < sum(rb) / len(rb) - 0.10)
        la, lb = ([g["right"] for g in graded(x, modes=("closed", "gone"))] for x in (a, b))
        let_low = bool(la and lb and sum(la) / len(la) < sum(lb) / len(lb) - 0.10)
        verdict = not low and not let_low and decoys == 0 and not rules_low
        extra = ""
        if a in ("SCP", "SCP2", "SCP2G"):  # (c), (d), (e): no loss over every checkpoint either, and a gain that pays for the change
            every = [t for t in TIERS if mean(g["right"] for g in graded(a, tier=t)) < mean(g["right"] for g in graded(b, tier=t)) - 0.05]
            size = {x: mean(r["chars"] for r in rows if r["way"] == x and r["kind"] == "summary" and r["k"] == last) for x in (a, b)}
            shorter = 1 - size[a] / size[b] if size[b] else 0.0
            carried = {x: mean(g["in_summary"] for g in graded(x, modes=("gone",))) for x in (a, b)}
            verdict = verdict and not every and shorter >= 0.25 and carried[a] <= carried[b] / 2
            extra = (f", over all checkpoints more than 5 points lower {every or 'none'}, summary at c{last} {shorter:.0%} shorter (needs 25%), "
                     f"obsolete carried {carried[a]:.0%} against {carried[b]:.0%} (needs half or less)")
        print(f"\npass rule {label}: rungs more than 10 points lower {low or 'none'}, letting go more than 10 points lower {'yes' if let_low else 'no'}, "
              f"decoys answered {decoys}, code rules more than 10 points lower {'yes' if rules_low else 'no'}{extra}: {'PASS' if verdict else 'FAIL'}")


# --------------------------------------------------------------------------------------------------------------------
# plan / selftest
# --------------------------------------------------------------------------------------------------------------------
def cmd_plan(args):
    out = [f"# Canary round 2: the script ({args.cycles} cycles)\n"]
    for kind, c, i in steps(args.cycles):
        if kind == "file":
            op, rel, text = FILES[c]
            out.append(f"**harness, before cycle {c}:** {op} `{rel}`" + (f"\n\n```\n{text}```" if text else "") + "\n")
        elif kind == "work":
            out.append(f"**cycle {c}, prompt {i + 1}:**\n\n> " + work_prompt(c, i).replace("\n", "\n> ") + "\n")
        elif kind in ("pre", "post"):
            qs = questions(kind, c, chr(i), "plan")
            out.append(f"*{kind}-probe {chr(i)} at {c}:* " + "; ".join(f"{q['name']} ({q['tier']})" for q in qs) + "\n")
        elif kind == "behave":
            out.append(f"*behaviour probe at checkpoint {c}* (rules: {', '.join(r for r, cy in RULES.items() if cy <= max(c, 1))})\n")
        else:
            out.append(f"**compaction {c}**\n")
    out.append("\n## Questions\n")
    out += [f"- {q['name']} ({q['tier']}, group {q['group']}): {q['q']}  values {q['values']}" + (f"  partner {q['partner']}" if q["partner"] else "") for q in CANARIES]
    out.append(f"\n## Behaviour task\n\n> {BEHAVE_TASK}\n")
    Path(HERE / "canary2-script.md").write_text("\n".join(out))
    n = steps(args.cycles)
    print(f"wrote canary2-script.md: {len(n)} steps per run, {sum(k == 'work' for k, _, _ in n)} prompts, "
          f"{sum(k in ('pre', 'post', 'behave') for k, _, _ in n)} probes, {len(CANARIES)} canaries")


def cmd_selftest(args):
    fails = []

    def check(cond, what):
        if not cond:
            fails.append(what)

    # every plant's canary is said in the prompt of its cycle
    said = {c: " ".join(work_prompt(c, i) for i in range(3)) + " " + " ".join(f[2] or "" for cy, f in FILES.items() if cy == c) for c in range(1, CYCLES + 1)}
    for q in CANARIES:
        if q["tier"] == "decoy":
            continue
        for cy, rx, *mode in q["values"]:
            check(mode == ["gone"] or rx.startswith("!") or re.search(rx, said[cy], re.I), f"{q['name']}: {rx} not said in cycle {cy}")
    # no question gives its answer away
    for q in CANARIES:
        for _, rx, *_ in q["values"]:
            check(q["tier"] == "decoy" or not re.search(rx.lstrip("!"), q["q"], re.I) or rx.startswith("!"), f"{q['name']}: the question holds the answer")
    # the graders
    port = next(q for q in CANARIES if q["name"] == "port")
    check(grade(port, 9, "6602", None)["right"], "port 6602 at 9")
    check(grade(port, 9, "6517", None)["stale"], "port 6517 at 9 is stale")
    check(grade(port, 9, "6602 (was 6517)", None)["right"], "a new value beside an old one is right")
    check(grade(port, 3, "6431", None)["right"], "port 6431 at 3")
    pre = next(q for q in CANARIES if q["name"] == "commit_prefix")
    check(grade(pre, 3, "CLK-208 Fix typo", None)["right"], "prefix at 3")
    check(not grade(pre, 8, "CLK-208 Fix typo", None)["right"] and grade(pre, 8, "CLK-208 Fix typo", None)["stale"], "revoked prefix at 8 is stale")
    check(grade(pre, 8, "Fix typo in termui docstring", None)["right"], "no prefix at 8")
    check(grade(pre, 9, "Fix typo in termui docstring (no CLK-208 prefix; the rule was dropped)", None)["right"], "naming the dropped prefix is no prefix")
    check(grade(pre, 9, "`CLK-208 Fix typo in termui docstring`", None)["stale"], "a quoted revoked prefix is stale")
    mob = next(q for q in CANARIES if q["name"] == "mobile_codename")
    check(grade(mob, 5, "MARIGOLD-14", None)["swap"], "swap")
    dec = next(q for q in CANARIES if q["name"] == "metrics_port")
    check(grade(dec, 9, "unknown", None)["right"] and not grade(dec, 9, "6602", None)["right"], "decoy")
    check(grade(port, 9, "6602", "staging 6602")["in_summary"] and not grade(port, 9, "6602", "staging 6517")["in_summary"], "in summary")
    diff_ok = ("diff --git a/src/click/utils.py b/src/click/utils.py\n+def stream_is_tty(s):\n+    \"\"\"x\n+    .. versionadded:: 8.5.1\n"
               "diff --git a/CHANGES.md b/CHANGES.md\n+## Version 8.5.1\n+- Add stream_is_tty.\n")
    diff_bad = "diff --git a/src/click/_compat.py b/src/click/_compat.py\n+def isatty(s, dumb=False):\n"
    g = rule_grades(diff_ok, "## Version 8.5.1\n\n- Add\n\n## Version 8.5.0\n", 12)
    check(g == {"versionadded": True, "no_compat": True, "changelog": True, "one_off": True}, f"rules kept {g}")
    g = rule_grades(diff_bad, "## Version 8.5.0\n", 12)
    check(g == {"versionadded": False, "no_compat": False, "changelog": False, "one_off": True}, f"rules broken {g}")
    check(rule_grades(diff_bad, "", 1) == {"versionadded": False}, "only rules said by then")
    check(rule_grades("", "", 12) == {"versionadded": None, "no_compat": None, "changelog": None, "one_off": None}, "nothing to judge")
    german = 'diff --git a/src/click/termui.py b/src/click/termui.py\n+def pluralize(n, w):\n+    """Gibt das Wort mit der Anzahl zurück."""\n'
    check(rule_grades(german, "", 9)["one_off"] is False and "one_off" not in rule_grades(german, "", 4), "the one-off leaks only after its cycle")
    check(rule_grades(diff_ok, "", 9)["one_off"] is True, "English is no leak")
    # a life: closed, obsolete
    tok = next(q for q in CANARIES if q["name"] == "token_by")
    check(grade(tok, 9, "You rotated it this morning.", None)["right"], "closed known")
    check(grade(tok, 9, "Before Thursday.", None)["stale"], "closed given as open")
    check(grade(tok, 5, "Before Thursday.", None)["right"], "open before it closed")
    qua = next(q for q in CANARIES if q["name"] == "quarantine")
    check(grade(qua, 6, "Yes: test_progressbar_eta", None)["right"] and grade(qua, 9, "test_progressbar_eta", None)["stale"], "quarantine")
    check(grade(qua, 9, "None; test_progressbar_eta is back in the suite.", None)["right"], "quarantine closed")
    check(grade(qua, 10, "unknown", None)["right"] and grade(tok, 10, "unknown", None)["right"], "a closed fact no longer raised")
    check(grade(qua, 10, "Unknown: test_progressbar_eta was quarantined; you said it is back after the runner fix.", None)["right"], "closed, known in other words")
    check(grade(tok, 9, "Thursday (you reported rotating it this morning).", None)["right"], "rotating known")
    esc = next(q for q in CANARIES if q["name"] == "escalation")
    check(grade(esc, 9, "unknown", None)["right"] and grade(esc, 9, "Ines Albrecht, 4471", None)["right"], "obsolete forgotten or right")
    check(not grade(esc, 9, "Jonas, extension 2210", None)["right"] and not grade(esc, 9, "Jonas, extension 2210", None)["stale"], "obsolete made up")
    check(grade(esc, 9, "4471", "contact 4471")["in_summary"], "obsolete carried in the summary")
    # pairs are never asked together; every post-probe covers what was planted
    for k in range(1, CYCLES + 1):
        for g2 in "AB":
            names = {q["name"] for q in questions("post", k, g2, "x")}
            for q in CANARIES:
                if q["partner"] and q["name"] in names:
                    check(not any(re.fullmatch(q["partner"], p["values"][0][1]) and p["name"] in names for p in CANARIES), f"pair asked together at {k}")
        both = {q["name"] for g2 in "AB" for q in questions("post", k, g2, "x")}
        check(both == {q["name"] for q in CANARIES if q["cycle"] <= k}, f"post-probe {k} covers what was planted")
    # a repo can be made, files written and deleted
    tmp = BASE_ROOT / "selftest"
    shutil.rmtree(tmp, ignore_errors=True)
    make_repo(tmp / "repo")
    check((tmp / "repo" / "CHANGES.md").read_text().startswith("## Version 8.5.0"), "CHANGES.md as expected")
    check("_clamp(max, -1" in (tmp / "repo" / "src/click/types.py").read_text(), "no planted bug")
    shutil.rmtree(tmp, ignore_errors=True)
    print("selftest:", "ok" if not fails else "FAILED\n  " + "\n  ".join(fails))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--ways", default=",".join(WAYS))
    r.add_argument("--reps", type=int, default=REPS)
    r.add_argument("--cycles", type=int, default=CYCLES)
    r.add_argument("--tag", default="main")
    p = sub.add_parser("report")
    p.add_argument("--tag", default="main")
    p.add_argument("--as-run", action="store_true", help="the grades as stored at run time, not graded again")
    pl = sub.add_parser("plan")
    pl.add_argument("--cycles", type=int, default=CYCLES)
    sub.add_parser("selftest")
    args = ap.parse_args()
    {"run": cmd_run, "report": cmd_report, "plan": cmd_plan, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    main()
