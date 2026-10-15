"""The TypeScript tasks' repository: chrono (chrono-node), a natural-language date parser written in TypeScript
(MIT, ~270 source files under src/, a jest suite of ~750 tests that runs in about 10 s), pinned at a release tag.
Eight tasks mirror the click ones (t1-trace … t6-signature, l1-feature, l2-coverage), so the bench's results can be
checked beyond one Python repository; their names start with `ts-` and they run only when named with --tasks.

Graded by fixed answer lists derived from the code at the tag, hidden tests copied in only for grading
(hidden/test_ts_*.ts), stale-reference scans and the repository's own jest coverage. Each run copies the prepared base,
node_modules included (npm's .bin links are relative, so a copy works offline).

  python3 ts_repo.py prepare DIR    # clones chrono at TAG into DIR and installs its dependencies (network once)
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HIDDEN = HERE / "hidden"
URL = "https://github.com/wanasit/chrono.git"
TAG = "v2.10.3"
TEST = "npx jest"


def prepare(base: Path):
    """Clone chrono at TAG into `base` (missing or empty) and install the lockfile's dependencies once. --ignore-scripts
    skips the package's `prepare` (a dist/ build the tests do not use) and husky's git hooks."""
    subprocess.run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", TAG, URL, str(base)], check=True, capture_output=True)
    subprocess.run(["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], cwd=base, check=True, capture_output=True)


TASKS = {
    "ts-t1-trace": {
        "kind": "explore",
        "prompt": "In this repository (chrono), list every function or method in src/ that calls the helper `assignSimilarDate()` (src/utils/dates.ts) directly. "
        "Give each as `file: Class.method` or `file: function` (nested functions as `outer.inner`), one per line, and nothing else after the list.",
    },
    "ts-t2-rename": {
        "kind": "edit",
        "prompt": "Rename the exported helper `reverseDuration` (src/calculation/duration.ts) to `negateDuration` everywhere in src/, test/ and the docs "
        "(README.md, AGENTS.md) of this repository (chrono): its definition, every import, call and mention. No alias for the old name. "
        f"The tests run with: {TEST}",
    },
    "ts-t3-explain": {
        "kind": "explore",
        "prompt": "In this repository (chrono), explain how the year of a date is decided when the text names a month and a day but no year "
        "(e.g. `chrono.parseDate(\"March 5\", ref)`), and how the `forwardDate` option changes it: which functions and methods run, in which order, "
        "with file:line for each, and where the reference date comes in. Keep it to a short ordered list.",
    },
    "ts-t4-lookup": {
        "kind": "lookup",
        "prompt": "In this repository (chrono): in the English casual configuration (`chrono.casual`), which refiner runs directly after `ForwardDateRefiner`? "
        "Answer with the exact class name and the file:line where it is added to the list.",
    },
    "ts-t5-types": {
        "kind": "explore",
        "prompt": "In this repository (chrono), list every class in src/ that is derived (directly or indirectly) from AbstractTimeExpressionParser and whose own "
        "extractPrimaryTimeComponents() method can return null itself, with a `return null` in its own body (a class that only passes on what super returns, "
        "or only inherits the method, does not count). One class name per line, nothing else after the list.",
    },
    "ts-l1-feature": {
        "kind": "edit",
        "prompt": "Add support for ISO 8601 week dates to the English parsers of this repository (chrono).\n"
        "- A parser class `ENISOWeekDateParser`, the default export of src/locales/en/parsers/ENISOWeekDateParser.ts, derived from "
        "AbstractParserWithWordBoundaryChecking and used by the English configurations (`chrono.strict` and `chrono.casual`).\n"
        "- It recognizes `YYYY-Www` and `YYYY-Www-D` and the compact forms `YYYYWww` and `YYYYWwwD`: a four-digit ISO week-numbering year, `W` in either case, "
        "a two-digit week and an optional weekday digit (1 = Monday … 7 = Sunday). Without a weekday it means the Monday of that week. Week 53 exists only in "
        "years that have 53 ISO weeks. Anything else in that position (week 00, a week above 53, week 53 of a year with 52 weeks, a weekday digit 0, 8 or 9) "
        "means no week date is recognized there at all, not even a shorter one.\n"
        "- The result's text is exactly the week date; its year, month, day and weekday are certain (assigned) and its time is left implied. "
        "It carries the tag `parser/ENISOWeekDateParser`.\n"
        "- Add tests in test/en/en_iso_week_date.test.ts.\n"
        f"The tests run with: {TEST}",
    },
    "ts-l2-coverage": {
        "kind": "edit",
        "prompt": "Raise the test coverage of src/locales/it/constants.ts in this repository (chrono) as high as you can, by adding tests in a new file "
        "test/it/it_constants_more.test.ts. Do not change anything under src/. Coverage counts statements and branches over the whole test suite: "
        f"`{TEST} --coverage --collectCoverageFrom=src/locales/it/constants.ts`. Every test must pass.",
    },
    "ts-t6-signature": {
        "kind": "edit",
        "prompt": "In this repository (chrono), change the helper `repeatedTimeunitPattern` (src/utils/pattern.ts) so the connector is passed as an option named "
        "`connector` instead of the positional parameter `connectorPattern`: its signature becomes "
        "`repeatedTimeunitPattern(prefix: string, singleTimeunitPattern: string, options: { connector?: string } = {}): string`, "
        "where a missing connector means the same default as now, with the same behavior otherwise. Update every caller in src/ and test/ so none passes "
        f"the connector positionally. The tests run with: {TEST}",
    },
}

# t1: the 20 functions and methods that call assignSimilarDate() in chrono v2.10.3, from the TypeScript checker
# (33 calls; yesterday/tomorrow reach it only through theDayBefore/theDayAfter). (what must be on the line, pattern)
T1_CALLERS = [
    ("mergingCalculation", r"mergeDateTimeResult"),
    ("casualReferences", r"(?<![\w.])now\b"),
    ("casualReferences", r"(?<![\w.])today\b"),
    ("casualReferences", r"\btheDayAfter\b"),
    ("casualReferences", r"\btonight\b"),
    ("casualReferences", r"\blastNight\b"),
    ("casualReferences", r"\byesterdayEvening\b"),
    ("results", r"createRelativeFromReference"),
    *[(cls, r".") for cls in ("DECasualDateParser", "ENCasualDateParser", "ESCasualTimeParser", "FICasualDateParser", "FRCasualDateParser", "ITCasualDateParser",
                              "NLCasualDateTimeParser", "NLCasualTimeParser", "PTCasualTimeParser", "RUCasualTimeParser", "SVCasualDateParser", "UKCasualTimeParser")],
]

# t2: lines naming the helper in src/ and test/ after a complete rename (58 at the tag), with room for merged imports.
T2_MIN_MENTIONS = 50

T3_TERMS = ["ENMonthNameMiddleEndianParser", "findYearClosestToRef", r"\bimply\b", "ForwardDateRefiner", "isDateWithUnknownYear", "executeParser|innerExtract"]

# t5: AbstractTimeExpressionParser's twelve subclasses (one per locale), the base itself and the look-alikes that are not
# derived from it (they count against precision); the five whose own extractPrimaryTimeComponents() has `return null`
# (PT and ES only carry it commented out; EN, IT, RU, UK and AR pass on super's null).
T5_NAMES = {f"{loc}TimeExpressionParser" for loc in ("EN", "DE", "FR", "PT", "NL", "RU", "ES", "UK", "IT", "FI", "ID", "AR")} | {
    "AbstractTimeExpressionParser", "JPTimeExpressionParser", "VITimeExpressionParser", "ZHHansTimeExpressionParser", "ZHHantTimeExpressionParser",
    "DESpecificTimeExpressionParser", "FRSpecificTimeExpressionParser"}
T5_EXPECTED = {"DETimeExpressionParser", "FRTimeExpressionParser", "NLTimeExpressionParser", "FITimeExpressionParser", "IDTimeExpressionParser"}

# Hidden tests (file in hidden/ → its number of tests): a file that does not compile counts every test in it as failed.
L1_HIDDEN = {"test_ts_iso_week_behavior.ts": 12, "test_ts_iso_week_structure.ts": 3}
T6_HIDDEN = {"test_ts_pattern_runtime.ts": 7, "test_ts_pattern_types.ts": 2}

# l2: src/locales/it/constants.ts, statements and branches covered over the unchanged suite.
COVERAGE_FILE = "src/locales/it/constants.ts"
COVERAGE_BASE = 100 * 65 / 88  # 73.9%: 65 of its 88 statements and branches

# t6: every call of repeatedTimeunitPattern in src/ and test/, from the repository's own TypeScript checker; a call is
# stale when it passes more than three arguments or a string-typed third one (a connector passed positionally).
CALLS_JS = r"""
const path = require("path");
const repo = path.resolve(process.argv[process.argv.length - 2]);
const name = process.argv[process.argv.length - 1];
const ts = require(path.join(repo, "node_modules", "typescript"));
const cfg = ts.readConfigFile(path.join(repo, "tsconfig.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, repo);
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const checker = program.getTypeChecker();
const out = [];
for (const sf of program.getSourceFiles()) {
  const rel = path.relative(repo, sf.fileName);
  if (!/^(src|test)\//.test(rel)) continue;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const e = node.expression;
      let sym = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(e) ? e.name : e);
      if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      if (sym && sym.name === name) {
        const third = node.arguments[2];
        const stringy = !!third && !!(checker.getTypeAtLocation(third).flags & ts.TypeFlags.StringLike);
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        out.push({ at: rel + ":" + line, args: node.arguments.length, stale: node.arguments.length > 3 || stringy });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
console.log(JSON.stringify(out));
"""


def run(cmd, repo: Path, timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=isinstance(cmd, str), cwd=repo, capture_output=True, text=True, timeout=timeout)


def summary(p: subprocess.CompletedProcess) -> str:
    """jest's `Test Suites:` and `Tests:` lines (it prints them to stderr; a suite that does not compile counts no tests),
    or the last line of its output."""
    lines = [l.strip() for l in (p.stderr + p.stdout).strip().splitlines()]
    found = [l for l in lines if l.startswith(("Test Suites:", "Tests:"))]
    return "; ".join(found[-2:]) if found else (lines[-1] if lines else "")


def suite(repo: Path) -> tuple[bool, str]:
    p = run(f"{TEST} --ci --silent", repo)
    return p.returncode == 0, summary(p)


def typecheck(repo: Path) -> bool:
    return run(["npx", "tsc", "--noEmit", "-p", "tsconfig.json"], repo).returncode == 0


def hidden(repo: Path, files: dict[str, int]) -> tuple[int, int]:
    """Copy the hidden tests into test/ (as zz_hidden_<stem>.test.ts), run them, take them out again: (passed, failed)."""
    copied = {name: repo / "test" / f"zz_hidden_{Path(name).stem}.test.ts" for name in files}
    for name, dst in copied.items():
        shutil.copy(HIDDEN / name, dst)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "hidden.json"
            run([*TEST.split(), "--ci", "--json", f"--outputFile={out}", *[str(d.relative_to(repo)) for d in copied.values()]], repo)
            results = json.loads(out.read_text())["testResults"] if out.exists() else []
    finally:
        for dst in copied.values():
            dst.unlink(missing_ok=True)
    passed = 0
    for name, dst in copied.items():
        r = next((t for t in results if Path(t["name"]).name == dst.name), {})
        passed += sum(1 for a in r.get("assertionResults", []) if a["status"] == "passed")
    return passed, sum(files.values()) - passed


def grep(repo: Path, *args: str) -> str:
    return subprocess.run(["grep", *args], cwd=repo, capture_output=True, text=True).stdout


def coverage(repo: Path, rel: str) -> tuple[bool, float]:
    """The suite with coverage of one file: (every test passed, statements and branches covered in %)."""
    with tempfile.TemporaryDirectory() as tmp:
        p = run([*TEST.split(), "--ci", "--silent", "--coverage", f"--collectCoverageFrom={rel}", "--coverageReporters=json-summary", f"--coverageDirectory={tmp}"], repo)
        f = Path(tmp) / "coverage-summary.json"
        t = json.loads(f.read_text())["total"] if f.exists() else None
    if not t or not t["statements"]["total"]:
        return p.returncode == 0, 0.0
    covered = t["statements"]["covered"] + t["branches"]["covered"]
    return p.returncode == 0, 100 * covered / (t["statements"]["total"] + t["branches"]["total"])


def grade(task: str, answer: str, repo: Path) -> dict:
    if task == "ts-t1-trace":
        lines = answer.splitlines()
        hit = sum(1 for where, pat in T1_CALLERS if any(where in l and re.search(pat, l) for l in lines))
        listed = sum(1 for l in lines if re.search(r"\.ts\s*:|\bsrc/", l))
        return {"score": hit / len(T1_CALLERS), "found": hit, "of": len(T1_CALLERS), "listed": listed}
    if task == "ts-t2-rename":
        old = grep(repo, "-rlwI", "reverseDuration", "src", "test", "README.md", "AGENTS.md").split()
        new = grep(repo, "-rwI", "negateDuration", "src", "test").count("\n")
        docs = grep(repo, "-lw", "negateDuration", "README.md", "AGENTS.md").split()
        ok_suite, tail = suite(repo)
        ok_types = typecheck(repo)
        ok = not old and new >= T2_MIN_MENTIONS and "AGENTS.md" in docs and ok_suite and ok_types
        return {"score": 1.0 if ok else 0.0, "old_left": old, "new_mentions": new, "docs": docs, "typecheck": ok_types, "tests": tail}
    if task == "ts-t3-explain":
        hit = [t for t in T3_TERMS if re.search(t, answer)]
        return {"score": len(hit) / len(T3_TERMS), "terms": hit, "has_lines": bool(re.search(r"\.ts:\d+", answer))}
    if task == "ts-t4-lookup":
        # ENUnlikelyFormatFilter (the casual configuration's last refiner) is a different class.
        return {"score": 1.0 if re.search(r"(?<![A-Za-z])UnlikelyFormatFilter\b", answer) else 0.0}
    if task == "ts-t5-types":
        # The list's lines only (a bullet, backticks, a trailing note allowed): prose may name the classes left out.
        named = {m.group(1) for line in answer.splitlines() if (m := re.match(r"^\s*(?:[-*\d.)]+\s*)?`?([A-Za-z_]\w*)`?\s*(?:[-—:(].*)?$", line)) and m.group(1) in T5_NAMES}
        tp = len(named & T5_EXPECTED)
        prec = tp / len(named) if named else 0.0
        rec = tp / len(T5_EXPECTED)
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        return {"score": f1, "precision": prec, "recall": rec, "extra": sorted(named - T5_EXPECTED), "missed": sorted(T5_EXPECTED - named)}
    if task == "ts-l1-feature":
        passed, failed = hidden(repo, L1_HIDDEN)
        ok_suite, tail = suite(repo)
        frac = passed / (passed + failed)
        return {"score": frac * (1.0 if ok_suite else 0.5), "hidden_passed": passed, "hidden_failed": failed, "suite": tail}
    if task == "ts-t6-signature":
        passed, failed = hidden(repo, T6_HIDDEN)
        p = run(["node", "-e", CALLS_JS, str(repo.resolve()), "repeatedTimeunitPattern"], repo)
        calls = json.loads(p.stdout) if p.returncode == 0 and p.stdout.strip() else []
        scan_error = "" if calls else (p.stderr.strip().splitlines() or ["no calls found"])[-1]
        stale = [c["at"] for c in calls if c["stale"]]
        ok_suite, tail = suite(repo)
        ok_types = typecheck(repo)
        frac = passed / (passed + failed)
        ok = ok_suite and ok_types and bool(calls) and not stale
        return {"score": frac * (1.0 if ok else 0.5), "hidden_passed": passed, "hidden_failed": failed, "calls": len(calls), "stale_calls": stale,
                "scan_error": scan_error, "typecheck": ok_types, "suite": tail}
    if task == "ts-l2-coverage":
        src_changed = run(["git", "status", "--porcelain", "src"], repo).stdout.strip()
        ok_suite, pct = coverage(repo, COVERAGE_FILE)
        ok = ok_suite and not src_changed and (repo / "test/it/it_constants_more.test.ts").exists()
        return {"score": max(0.0, (pct - COVERAGE_BASE) / (100 - COVERAGE_BASE)) if ok else 0.0, "percent": round(pct, 1), "suite_ok": ok_suite,
                "src_changed": bool(src_changed)}
    raise KeyError(task)


if __name__ == "__main__":
    if sys.argv[1:2] == ["prepare"]:
        prepare(Path(sys.argv[2]))
