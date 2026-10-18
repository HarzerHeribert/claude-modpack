"""The web tasks' repository: bulletproof-react's Vite app (apps/react-vite of alan2207/bulletproof-react, MIT), a React 18
and TypeScript app with Tailwind CSS, react-query, react-router, a mock backend in MSW and a vitest suite (21 tests, about
7 s). Pinned at COMMIT; the app's folder alone becomes the repository, its dependencies installed once with yarn 1 from
the lockfile, so every run works offline. Its tasks (web-*) run only when named with --tasks.

Why: the work people bring to Claude Code is mostly web code (JavaScript/TypeScript 31%, HTML/CSS 28%, Python 14% in
Anthropic's 2025 report), and its sessions are fixing (26%), building (25%), operating software, exploring and prose
(Anthropic, Claude Code expertise study, 2026). The five tasks are one of each kind that touches web code:

  web-1-feature  building: search over all the discussions, through the API and the URL (matches sit on page 2)
  web-2-fix      fixing: regular users lost the right to delete their own comments (a planted bug, reported as a user would)
  web-3-rename   refactoring: the Button's `isLoading` prop becomes `loading`; react-query's own `isLoading` must stay
  web-4-style    UI/CSS: a table column hidden on phones, with Tailwind's breakpoints
  web-5-explain  exploring: how the login session works, end to end

Graded by hidden vitest files (hidden/web/, copied into src/zz_hidden/ only while grading), the app's own suite and type
check, and for web-3 and web-5 fixed scans and term lists. The reference solutions in hidden/web_reference/<task>/ are files
laid over the base; `selftest` shows the base scoring low and the references 1.0.

  python3 web_repo.py prepare DIR    # clones the app at COMMIT into DIR and installs its dependencies (network once)
  python3 web_repo.py selftest DIR [TASKS]   # grades the base and the references, each in a copy of DIR
"""
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HIDDEN = HERE / "hidden" / "web"
REFERENCE = HERE / "hidden" / "web_reference"
URL = "https://github.com/alan2207/bulletproof-react.git"
COMMIT = "9506629ed003a561c6627735480cce4994244bb4"
APP = "apps/react-vite"
TEST = "npx vitest run"
TYPES = "npx tsc --noEmit"
GIT = ["git", "-c", "user.email=bench@local", "-c", "user.name=bench"]


def prepare(base: Path):
    """Fetch the pinned commit, keep the app's folder as the repository, install its lockfile's dependencies once
    (--ignore-scripts: husky's hooks), copy .env.example to .env, commit and tag `base`."""
    with tempfile.TemporaryDirectory() as t:
        src = Path(t) / "bpr"
        src.mkdir()
        for cmd in (["git", "init", "-q"], ["git", "remote", "add", "origin", URL], ["git", "fetch", "-q", "--depth", "1", "origin", COMMIT],
                    ["git", "-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"]):
            subprocess.run(cmd, cwd=src, check=True, capture_output=True)
        shutil.copytree(src / APP, base)
    shutil.copy(base / ".env.example", base / ".env")
    subprocess.run(["npx", "-y", "yarn@1.22.22", "install", "--frozen-lockfile", "--ignore-scripts", "--non-interactive", "--silent"],
                   cwd=base, check=True, capture_output=True)
    subprocess.run(["git", "init", "-q"], cwd=base, check=True)
    subprocess.run(["git", "add", "-A"], cwd=base, check=True)
    subprocess.run([*GIT, "commit", "-q", "-m", "bulletproof-react (react-vite) at " + COMMIT[:7]], cwd=base, check=True)
    subprocess.run(["git", "tag", "base"], cwd=base, check=True)


# web-2's bug: the policy compares the comment author's id with the user's team id, so no regular user owns a comment.
PLANT = ("src/lib/authorization.tsx", "comment.author?.id === user.id", "comment.author?.id === user.teamId")


def plant(task: str, repo: Path):
    """Lay the task's planted bug into a fresh copy and commit it, so the run's diff starts from the planted state."""
    if task != "web-2-fix":
        return
    path, good, bad = PLANT
    p = repo / path
    p.write_text(p.read_text().replace(good, bad))
    subprocess.run([*GIT, "commit", "-q", "-am", "planted"], cwd=repo, check=True)


TASKS = {
    "web-1-feature": {
        "kind": "edit",
        "plant": False,
        "prompt": "In this app, add a search to the discussions list (src/features/discussions): a text input labelled "
        "\"Search discussions\" above the table. It searches the titles of all the team's discussions, ignoring case, not only "
        "the page on screen, so the API has to filter too (the backend in this repository is the mock in src/testing/mocks). "
        "Results are paginated as before, and a new search starts at page 1. The search is kept in the URL as ?search=…, so a "
        "reload or a shared link shows the same results. When nothing matches, show \"No discussions found\" instead of the "
        "table; clearing the box shows the discussions as before. Add tests for it. "
        f"The tests run with `{TEST}`, the type check with `{TYPES}`.",
    },
    "web-2-fix": {
        "kind": "edit",
        "plant": True,
        "prompt": "Bug report from a user: \"Since the last release I can't delete my own comments on a discussion any more. "
        "The Delete Comment button is just gone for me. Our admin still sees it on every comment.\" Regular users (role USER) "
        "should be able to delete their own comments, and only their own; admins any. Find the cause, fix it, and add a test "
        f"that would have caught it. The tests run with `{TEST}`, the type check with `{TYPES}`.",
    },
    "web-3-rename": {
        "kind": "edit",
        "plant": False,
        "prompt": "Rename the Button component's `isLoading` prop (src/components/ui/button) to `loading`, everywhere it is "
        "passed in this app. Keep no alias for the old name. Don't touch anything else called isLoading. "
        f"The tests run with `{TEST}`, the type check with `{TYPES}`.",
    },
    "web-4-style": {
        "kind": "edit",
        "plant": False,
        "prompt": "On phones the discussions table is too wide. Below Tailwind's `md` breakpoint, hide the \"Created At\" column "
        "of the discussions list, its header and its cells; from `md` up it shows as before. Use Tailwind classes, and keep the "
        f"shared Table component (src/components/ui/table) usable for the other tables. The tests run with `{TEST}`, the type "
        f"check with `{TYPES}`.",
    },
    "web-5-explain": {
        "kind": "explore",
        "plant": False,
        "prompt": "In this app, explain how a user's session works end to end: how the app learns who is logged in, how API "
        "requests are authenticated, what happens when a request gets a 401, and how the pages that need a login are protected. "
        "Name the files and the functions or components involved, with file:line. Keep it to a short ordered list.",
    },
}

# web-5: what a complete answer names (the reference answer has them all).
T5_TERMS = {
    "withCredentials": r"withCredentials",
    "interceptor": r"interceptor",
    "auth_me": r"/auth/me|\bgetUser\b",
    "react_query_auth": r"configureAuth|react-query-auth",
    "useUser": r"\buseUser\b",
    "status_401": r"\b401\b",
    "redirectTo": r"redirectTo",
    "ProtectedRoute": r"\bProtectedRoute\b",
    "AuthLoader": r"\bAuthLoader\b",
    "cookie": r"cookie",
}
# web-3: react-query's isLoading reads that share the prop's name and must stay as they are.
T3_KEEP = [
    ("src/app/routes/app/discussions/discussion.tsx", "discussionQuery.isLoading"),
    ("src/features/discussions/components/discussion-view.tsx", "discussionQuery.isLoading"),
    ("src/features/discussions/components/discussions-list.tsx", "discussionsQuery.isLoading"),
    ("src/features/comments/components/comments-list.tsx", "commentsQuery.isLoading"),
    ("src/features/users/components/users-list.tsx", "usersQuery.isLoading"),
]
T3_CALL_SITES = 9
HIDDEN_FOR = {"web-1-feature": "search.test.tsx", "web-2-fix": "comment_policy.test.tsx", "web-3-rename": "button_loading.test.tsx",
              "web-4-style": "responsive_column.test.tsx"}


def run(cmd: str, repo: Path, timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, cwd=repo, capture_output=True, text=True, timeout=timeout)


def vitest(repo: Path, *paths: str) -> tuple[int, int]:
    """(passed, failed) tests of a vitest run over `paths` (the whole suite without), read from its JSON report."""
    with tempfile.TemporaryDirectory() as t:
        out = Path(t) / "report.json"
        try:
            run(f"npx vitest run {' '.join(paths)} --reporter=json --outputFile={out}", repo)
        except subprocess.TimeoutExpired:
            return 0, 1
        if not out.exists():
            return 0, 1
        r = json.loads(out.read_text())
        return r.get("numPassedTests", 0), r.get("numFailedTests", 0) + r.get("numFailedTestSuites", 0) * (r.get("numTotalTests", 0) == 0)


def hidden(repo: Path, name: str) -> tuple[int, int]:
    """Copy one hidden test file into src/zz_hidden/, run it alone, take it out again: (passed, failed)."""
    d = repo / "src" / "zz_hidden"
    d.mkdir(exist_ok=True)
    shutil.copy(HIDDEN / name, d / name)
    try:
        return vitest(repo, f"src/zz_hidden/{name}")
    finally:
        shutil.rmtree(d, ignore_errors=True)


def suite(repo: Path) -> bool:
    passed, failed = vitest(repo)
    return failed == 0 and passed > 0


def types(repo: Path) -> bool:
    try:
        return run(TYPES, repo, 300).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def changed(repo: Path) -> list[str]:
    """Files the run added or changed against its starting commit (HEAD: `base`, or `planted` for web-2)."""
    subprocess.run(["git", "add", "-A", "-N", "."], cwd=repo, capture_output=True)
    out = subprocess.run(["git", "diff", "--name-only", "HEAD"], cwd=repo, capture_output=True, text=True).stdout
    return [f for f in out.split("\n") if f]


def grade(task: str, answer: str, repo: Path) -> dict:
    if task == "web-5-explain":
        hit = [k for k, rx in T5_TERMS.items() if re.search(rx, answer, re.I)]
        return {"score": len(hit) / len(T5_TERMS), "terms": hit, "failed": sorted(set(T5_TERMS) - set(hit)),
                "has_lines": bool(re.search(r"\.tsx?:\d+", answer))}
    passed, failed = hidden(repo, HIDDEN_FOR[task])
    c = {"hidden": passed > 0 and failed == 0, "suite": suite(repo), "types": types(repo)}
    if task == "web-2-fix":
        c["test_added"] = any(re.search(r"\.test\.tsx?$", f) and not f.startswith("src/zz_hidden") for f in changed(repo))
    if task == "web-1-feature":
        c["test_added"] = any(re.search(r"\.test\.tsx?$", f) and not f.startswith("src/zz_hidden") for f in changed(repo))
    if task == "web-3-rename":
        src = "\n".join(p.read_text(errors="replace") for p in (repo / "src").rglob("*.ts*") if p.is_file())
        button = (repo / "src/components/ui/button/button.tsx").read_text()
        c["prop_renamed"] = "isLoading" not in button and bool(re.search(r"\bloading\?\s*:\s*boolean", button))
        c["call_sites"] = "isLoading=" not in src and len(re.findall(r"\bloading=\{", src)) >= T3_CALL_SITES
        c["namesakes_kept"] = all(keep in (repo / f).read_text() for f, keep in T3_KEEP if (repo / f).exists()) and all((repo / f).exists() for f, _ in T3_KEEP)
    weight = passed / max(1, passed + failed)
    others = [v for k, v in c.items() if k != "hidden"]
    score = weight * (sum(others) / len(others)) if others else weight
    return {"score": round(score, 3), "hidden_passed": passed, "hidden_failed": failed, **c, "failed": [k for k, v in c.items() if not v]}


def selftest(base: Path, only: list[str] | None = None):
    """For every task: a copy of the prepared base (its bug planted where the task has one), graded as is and with the
    reference laid over it. Exit 1 unless every reference scores 1.0 and every base at most 0.5."""
    bad = False
    for task in only or TASKS:
        for label in ("base", "reference"):
            with tempfile.TemporaryDirectory() as t:
                repo = Path(t) / "repo"
                subprocess.run(["cp", "-cR", str(base), str(repo)], check=True)
                plant(task, repo)
                answer = ""
                overlay = REFERENCE / task
                if label == "reference":
                    for f in overlay.rglob("*"):
                        if f.is_file() and f.name != "ANSWER.txt":
                            (repo / f.relative_to(overlay)).parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy(f, repo / f.relative_to(overlay))
                    if (overlay / "ANSWER.txt").exists():
                        answer = (overlay / "ANSWER.txt").read_text()
                g = grade(task, answer, repo)
                ok = g["score"] == 1.0 if label == "reference" else g["score"] <= 0.5
                bad |= not ok
                print(f"{task:14} {label:9} {g['score']:.2f} {'ok' if ok else 'WRONG'}  failed: {', '.join(g['failed']) or '-'}", flush=True)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    if sys.argv[1:2] == ["prepare"]:
        prepare(Path(sys.argv[2]))
    elif sys.argv[1:2] == ["selftest"] and len(sys.argv) in (3, 4):
        selftest(Path(sys.argv[2]), sys.argv[3].split(",") if len(sys.argv) == 4 else None)
    else:
        sys.exit(__doc__)
