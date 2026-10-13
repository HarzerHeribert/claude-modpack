"""Checks the delegation benchmark's record from its own files.

  python3 pruefen.py bericht                 the table, rebuilt from results.jsonl, equals report.txt
  python3 pruefen.py bewertung CLICK VENV    every run graded again (results*.jsonl):
                                             the answers as recorded, the edit runs by applying their patch
                                             to a fresh copy of CLICK (click 8.5.0, git) and running its
                                             tests with VENV's python
  python3 pruefen.py geheimnisse [PROMPTS]   no access key in any file here, and none of the private prompts
                                             of the trigger study (its prompts.jsonl, read locally, never copied)

Each exits non-zero and says why when the check fails.
"""

import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bench  # noqa: E402

EDIT_TASKS = {"t2-rename", "l1-feature", "l2-coverage"}
ANSWER_TASKS = {"t1-trace", "t3-explain", "t4-lookup", "t5-types"}


def rows() -> list[dict]:
    # The delegate runs, and the runs with the cells mod (arm K) where they are present.
    files = [HERE / f for f in ("results.jsonl", "results-cells.jsonl", "results-suite.jsonl", "results-suite-long.jsonl")]
    return [json.loads(l) for f in files if f.exists() for l in open(f)]


def bericht() -> int:
    # Rebuilt from the frozen costs alone: the transcripts may be on this machine or not.
    bench.account = lambda _session: {"found": False}
    out = io.StringIO()
    with redirect_stdout(out):
        bench.cmd_report(None)
    want = (HERE / "report.txt").read_text()
    if out.getvalue() != want:
        print("bericht: the rebuilt table differs from report.txt")
        return 1
    print(f"bericht: the table rebuilt from {sum(1 for _ in open(HERE / 'results.jsonl'))} runs equals report.txt")
    return 0


def bewertung(click: Path, venv: Path) -> int:
    bench.VENV = venv
    bench.TEST = f"PYTHONPATH=src {venv}/bin/python -m pytest -q"
    bad = 0
    for r in rows():
        if r["task"] in ANSWER_TASKS:
            g = bench.grade(r["task"], r["answer"], HERE)
        elif r["task"] in EDIT_TASKS:
            patch = HERE / "patches" / f"{r['run']}.patch"
            with tempfile.TemporaryDirectory() as tmp:
                repo = Path(tmp) / "repo"
                shutil.copytree(click, repo, symlinks=True)
                if patch.stat().st_size > 0:
                    applied = subprocess.run(["git", "apply", "--binary", str(patch)], cwd=repo, capture_output=True, text=True)
                    if applied.returncode != 0:
                        print(f"bewertung: {r['run']}: the patch does not apply: {applied.stderr.strip()[:200]}")
                        bad += 1
                        continue
                g = bench.grade(r["task"], r["answer"], repo)
        else:
            continue
        if abs(g["score"] - r["grade"]["score"]) > 1e-9:
            print(f"bewertung: {r['run']}: recorded {r['grade']['score']:.3f}, graded again {g['score']:.3f}")
            bad += 1
    print(f"bewertung: {len(rows())} runs graded again, {bad} differ")
    return 1 if bad else 0


KEY = re.compile(r"sk-ant-[A-Za-z0-9_-]{8,}|CLAUDE_CODE_OAUTH_TOKEN\s*=\s*\S+|Bearer\s+[A-Za-z0-9._-]{20,}")


def geheimnisse(prompts: Path | None) -> int:
    files = [p for p in HERE.rglob("*") if p.is_file() and p.suffix != ".pyc"]
    texts = {p: p.read_text(errors="replace") for p in files}
    hits = [f"{p.relative_to(HERE)}: {m.group(0)[:12]}…" for p, t in texts.items() for m in KEY.finditer(t)]
    leaked = 0
    if prompts is not None:
        # As the 9 Oct filing checks: 60 characters from inside each prompt of at least 80, matched as fixed strings.
        private = []
        for line in open(prompts, errors="replace"):
            text = " ".join(json.loads(line).get("prompt", "").split())
            if len(text) >= 80:
                private.append(text[10:70])
        flat = {p: " ".join(t.split()) for p, t in texts.items()}
        leaked = sum(1 for frag in private if any(frag in t for t in flat.values()))
        print(f"geheimnisse: {len(private)} private prompts checked")
    for h in hits:
        print(f"geheimnisse: access key in {h}")
    if leaked:
        print(f"geheimnisse: {leaked} private prompt(s) appear in the files")
    print(f"geheimnisse: {len(files)} files, {len(hits)} keys, {leaked} private prompts" + ("" if prompts else " (no prompt list given)"))
    return 1 if hits or leaked else 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "bericht":
        sys.exit(bericht())
    if cmd == "bewertung" and len(sys.argv) == 4:
        sys.exit(bewertung(Path(sys.argv[2]), Path(sys.argv[3])))
    if cmd == "geheimnisse":
        sys.exit(geheimnisse(Path(sys.argv[2]) if len(sys.argv) > 2 else None))
    sys.exit(__doc__)
