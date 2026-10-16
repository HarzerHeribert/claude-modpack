"""The PocketBase tasks: the 15 Trail-Code published for PocketBase (its README, "Tested on popular repos"), so the pack can
be measured against plain Claude Code on the same set. PocketBase is a Go backend (~270 non-test .go files at the tag).

- pb-q1 … pb-q10: their ten developer questions, word for word, asked of PocketBase at a release tag (TAG). Graded by a
  fixed answer key per question (Q_KEYS): the files and functions any correct answer has to name, read from the code at
  the tag; the score is the share found, as ts_repo's term grading.
- pb-pr6744 … pb-pr3192: their five merged pull requests, each re-implemented from the PR's base commit. The prompt is
  a developer's request written from the PR's public title and description (no file names, no solution). Graded on
  the run's diff against the base commit: recall of the maintainers' non-test source files (1.0 when all are touched),
  with the extra non-test files touched recorded beside it; `go build ./...` and `go vet` of the touched packages are
  recorded too, never folded into the score.

Every base is a one-commit clone of the full clone (pb-src) in the bench's WORK folder, its remote removed (the full
clone holds the merged PRs) and its branch named master, with the Go modules downloaded and the build cache warmed once.
Tasks run only when named with --tasks.

  python3 pb_repo.py prepare WORK    # the full clone and all six bases (network once)
  python3 pb_repo.py check WORK      # each PR's merged change applied to its base must grade 1.0 (the grader's own test)
"""
import json
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path

URL = "https://github.com/pocketbase/pocketbase.git"
# The questions' commit: the latest release on 16 Oct 2026 (published 8 Oct 2026).
TAG = "v0.40.5"
TAG_SHA = "6f370ea741f33adf889eef02e3c1b884a47aa522"

# The five PRs, checked with the GitHub API on 16 Oct 2026: the base commit is the PR's base.sha, which is also its
# head's parent and its (squashed) merge commit's parent. `files` are the maintainers' non-test files as Trail-Code lists
# them; `module` the go.mod change one of them also made (moving golang.org/x/image from indirect to direct, which the
# build does not need), recorded apart.
PRS = {
    "pb-pr6744": {"pr": 6744, "base": "a2b89d73444fe7775812bcb35b5cad3b741e1b29", "merge": "5d46fb054ecd811b9f803df5a9d963c13d89726e",
                  "files": ["apis/file.go", "tools/filesystem/filesystem.go"], "module": ["go.mod"]},
    "pb-pr6947": {"pr": 6947, "base": "6522bc55b1c5df97e4dc85ef0055e3615ea72844", "merge": "1610729d92efd453dc791406fec7aab54f403cc9",
                  "files": ["tools/security/random_by_regex.go"], "module": []},
    "pb-pr6690": {"pr": 6690, "base": "e81d85ae7c070ce5d33b503962c80fb99b2509ab", "merge": "5d32d22ff5feca99fe74eeedd7336a4138b13885",
                  "files": ["tools/auth/patreon.go"], "module": []},
    "pb-pr2726": {"pr": 2726, "base": "d1bcaa65b125f642848113fea8c4a7cba378007f", "merge": "caf343ef9cd638568a613a4e8bcb2e49229fc27b",
                  "files": ["apis/middlewares.go"], "module": []},
    "pb-pr3192": {"pr": 3192, "base": "5e6949062f8462772af88995188646fffdcc7cc5", "merge": "d423acad3b5a80139bda78702d469e54d0a4d293",
                  "files": ["plugins/migratecmd/templates.go"], "module": []},
}

QUESTIONS = [
    "Give me a map of PocketBase's architecture: the main subsystems and how an HTTP request flows through to the database.",
    "Trace end-to-end what happens when a client creates a record via the REST API, from route handler to database write.",
    "I want to add a brand-new collection field type. Where do I hook it in, and which pieces must change?",
    "Realtime subscriptions silently stop delivering events after a while. Where would you start looking, and why?",
    "If I change the signature of the record-validation logic, what depends on it and what could break?",
    "How does auth work across OAuth2 providers: where are tokens issued, validated, stored, and refreshed?",
    "How do I use PocketBase as a Go framework to register a custom route plus an on-record-create hook?",
    "Where is user input validated, and where are collection API access rules enforced before a query runs?",
    "As an external app, how do I authenticate and then list and filter records over the REST API?",
    "Where are the tests for the record CRUD API, and what do they assert about access rules?",
]

# The PR tasks' prompts: what to change and why, as a developer would ask it, from the PR's public title and description.
PR_PROMPTS = {
    "pb-pr6744": "Thumbnails don't work for WebP images. When a client requests a thumbnail of an uploaded .webp file (the `?thumb=100x100` "
    "query on the file URL), PocketBase serves the original full-size image instead of generating one, as it does for PNG, JPEG and GIF. "
    "Please make thumbnail generation and serving work for WebP too. Background: the image library we resize with can't decode WebP by "
    "itself, but the official golang.org/x/image module (already in our dependency graph) has a WebP decoder. It's fine if WebP "
    "thumbnails come out encoded as PNG; browsers sniff the format.",
    "pb-pr6947": "Random strings generated from a regex pattern are not uniformly distributed. For a character class made of several "
    "ranges, the generator first picks one of the ranges with equal probability and then a character inside it, so in "
    "`[A-Za-z0-9\\-_]{30}` the single characters `-` and `_` each get about 20% of the draws instead of about 1.6%, and the default "
    "id pattern `[a-z0-9]{15}` gives digits far more weight than letters. This affects generated record ids and anything else built "
    "from such patterns. Please fix the generator so that every character a class allows is equally likely.",
    "pb-pr6690": "The golang.org/x/oauth2 version we depend on now ships a Patreon endpoint in its `endpoints` package. Please refactor "
    "our Patreon OAuth2 provider to take its auth and token URLs from there instead of hard-coding them. The endpoints themselves don't "
    "change, and nothing else about the provider should.",
    "pb-pr2726": "The middleware that requires admin auth only when at least one admin exists asks the database for the total number of "
    "admins on every request, even when the request is already authenticated as an admin, in which case the count can't change the "
    "outcome. It sits on a hot path. Please drop that redundant query for requests that already carry an admin, and keep the behavior "
    "the same otherwise.",
    "pb-pr3192": "When the automigrate feature generates a migration for a collection whose API rules changed, the generated `down` "
    "function clears the changed rules (sets them to null) instead of restoring their previous values. So if a rule goes from one "
    "non-empty value to another and you then run `migrate down`, the rule is gone instead of being back at its old value. Please make "
    "the generated down migrations restore each changed API rule to its previous value (null only where it was null before), for both "
    "the JS and the Go migration templates.",
}

TASKS = {f"pb-q{i}": {"kind": "explore", "prompt": q} for i, q in enumerate(QUESTIONS, 1)}
TASKS.update({t: {"kind": "edit", "prompt": p} for t, p in PR_PROMPTS.items()})

# Answer keys, read from the code at TAG and fixed before any run: per question, (term, pattern, why a correct answer
# cannot avoid it). A term is found when its pattern (case-sensitive unless marked (?i)) matches anywhere in the answer;
# the score is the share found. Alternatives cover the names an answer may use for the same thing (file or function).
Q_KEYS_WHY: dict[str, list[tuple[str, str, str]]] = {
    "pb-q1": [  # architecture map + an HTTP request's path to the database
        ("core App", r"BaseApp|core\.App\b|core/app\.go|core/base\.go", "core.App/BaseApp (core/) is the hub every subsystem hangs off: DB, hooks, settings, models"),
        ("apis", r"\bapis\b", "apis/ holds the HTTP layer: routes, handlers, middlewares"),
        ("router", r"tools/router|NewRouter|BuildMux|router\.Router", "tools/router (apis.NewRouter, Router.BuildMux) turns the route tree into the http.ServeMux"),
        ("serve", r"serve\.go|\bServe\b|OnServe", "apis.Serve (apis/serve.go) starts the http.Server and fires OnServe, where routes are bound"),
        ("hooks", r"tools/hook|hook\.Hook|\b[Hh]ooks?\b", "the hook/event system (tools/hook) wraps every request and model operation"),
        ("middlewares", r"[Mm]iddlewares?\b|loadAuthToken", "apis/middlewares.go (loadAuthToken, CORS, body limit, rate limit) runs before every handler"),
        ("dbx", r"\bdbx\b", "pocketbase/dbx is the query builder between the app and SQL"),
        ("SQLite", r"(?i)sqlite", "the database is SQLite (core/db_connect.go: modernc.org/sqlite; data.db and auxiliary.db)"),
    ],
    "pb-q2": [  # record create, route handler to database write
        ("recordCreate handler", r"\brecordCreate\b|record_crud\.go", "apis/record_crud.go: recordCreate handles POST /api/collections/{collection}/records"),
        ("create rule check", r"CreateRule|createRule|(?i:create (api )?rule)", "the handler checks collection.CreateRule (nil = superusers only, else a rule query on a dummy record)"),
        ("RecordUpsert form", r"RecordUpsert|record_upsert\.go", "forms.NewRecordUpsert loads the data; form.Submit() saves the record"),
        ("OnRecordCreateRequest hook", r"OnRecordCreateRequest", "the handler runs the rest inside app.OnRecordCreateRequest().Trigger"),
        ("app.Save", r"SaveWithContext|\bSave\b", "form.Submit calls app.SaveWithContext (core/db.go), the generic model save"),
        ("validation", r"ValidateWithContext|OnModelValidate|[oO]nRecordValidate|ValidateValue|validateFormFields", "the save validates first: ValidateWithContext -> OnModelValidate -> onRecordValidate -> each field's ValidateValue"),
        ("insert", r"\bInsert\b|INSERT|CreateExecute|BaseApp\)?\.create\b|\) create\(|app\.create\b", "BaseApp.create runs OnModelCreateExecute/OnRecordCreateExecute and the dbx Insert: the database write"),
    ],
    "pb-q3": [  # a new collection field type
        ("Field interface", r"field\.go\b|`?\bField`?\s+interface|core\.Field\b", "core/field.go: every field type implements the core.Field interface"),
        ("registry", r"FieldFactoryFunc|Fields\[|core\.Fields\b|init\(\)", "a type is registered in the core.Fields map from an init() (Fields[FieldTypeX] = func() Field {...})"),
        ("ColumnType", r"ColumnType", "Field.ColumnType gives the SQLite column definition for the record table"),
        ("PrepareValue", r"PrepareValue", "Field.PrepareValue normalizes raw input/DB values"),
        ("ValidateValue", r"ValidateValue", "Field.ValidateValue validates a record's value"),
        ("ValidateSettings", r"ValidateSettings", "Field.ValidateSettings validates the field's options when the collection is saved"),
        ("an existing field", r"field_[\w*]+\.go|\b(Text|Number|Bool|Email|URL|Editor|Date|Autodate|Select|JSON|File|Relation|Password|GeoPoint)Field\b", "core/field_*.go: the existing types are the template"),
        ("dashboard UI", r"\bui/|(?i:dashboard|admin ui|svelte)", "the admin dashboard (ui/src/fields/<type>/) must learn to configure and edit the new type"),
    ],
    "pb-q4": [  # realtime events stop arriving
        ("realtimeConnect", r"realtimeConnect|realtime\.go", "apis/realtime.go: realtimeConnect is the SSE loop that delivers each message"),
        ("idle/max timeout", r"IdleTimeout|MaxTimeout|idleTimer|maxTimer|(?i:idle)", "the loop cancels the connection after IdleTimeout (5 min without a message) or MaxTimeout (30 min)"),
        ("subscriptions broker", r"tools/subscriptions|\bBroker\b|SubscriptionsBroker", "tools/subscriptions.Broker holds the registered clients; Unregister discards one"),
        ("client channel", r"Discard|DefaultClient|client\.go|Channel\(\)|\bSend\b", "the client's channel (Send, Channel, Discard/IsDiscarded): a discarded or closed client silently drops messages"),
        ("broadcast", r"bindRealtimeEvents|realtimeBroadcast\w*", "bindRealtimeEvents/realtimeBroadcastRecord turn model hooks into messages for subscribed clients"),
        ("access check", r"realtimeCanAccessRecord|CanAccessRecord|(List|View)Rule|(list|view)Rule", "each event is sent only if realtimeCanAccessRecord passes the List/View rule for the client's auth"),
        ("client auth/subscriptions", r"realtimeUpdateClientsAuth|realtimeUnsetClientsAuth\w*|RealtimeClientAuthKey|realtimeSetSubscriptions|PB_CONNECT", "a client's stored auth and subscriptions (realtimeSetSubscriptions, PB_CONNECT, realtimeUnsetClientsAuth*) decide what it still receives"),
    ],
    "pb-q5": [  # blast radius of the record-validation signature
        ("ValidateValue", r"ValidateValue", "Field.ValidateValue is the per-field record validation every field type implements"),
        ("onRecordValidate", r"[oO]nRecordValidate", "core/record_model.go: onRecordValidate (bound to OnRecordValidate) loops over the fields"),
        ("Validate entry", r"ValidateWithContext|OnModelValidate|\.Validate\(", "app.Validate/ValidateWithContext and OnModelValidate are the entry the save path calls"),
        ("field implementations", r"field_[\w*]+\.go|\b(Text|Number|Bool|Email|URL|Editor|Date|Autodate|Select|JSON|File|Relation|Password|GeoPoint)Field\b", "the 14 core/field_*.go implementations must all change with the signature"),
        ("save path", r"\bSave(WithContext|NoValidate\w*)?\b", "every app.Save/SaveWithContext caller runs the validation (SaveNoValidate skips it)"),
        ("RecordUpsert", r"RecordUpsert|validateFormFields|record_upsert\.go|DrySubmit", "forms.RecordUpsert (the API's create/update) depends on it"),
        ("JS hooks/types", r"jsvm|types\.d\.ts|pb_hooks|(?i:js hooks?)", "the JSVM plugin exposes onRecordValidate and its generated types.d.ts to pb_hooks"),
        ("tests", r"_test\.go|\btests/", "the core/apis tests and tests/app.go's event counting break with it"),
    ],
    "pb-q6": [  # OAuth2 auth
        ("provider abstraction", r"tools/auth|auth\.Provider|BaseProvider|NewProviderByName", "tools/auth: the Provider interface, BaseProvider and the Providers registry (NewProviderByName)"),
        ("auth-with-oauth2 handler", r"recordAuthWithOAuth2|record_auth_with_oauth2|auth-with-oauth2", "apis/record_auth_with_oauth2.go: recordAuthWithOAuth2 handles the code exchange request"),
        ("code exchange", r"FetchToken|Exchange", "provider.FetchToken exchanges the authorization code for the provider's token"),
        ("provider user", r"FetchAuthUser", "provider.FetchAuthUser reads the provider's user with that token"),
        ("ExternalAuth storage", r"ExternalAuth|_externalAuths|external_auth", "the link to the provider account is stored as an ExternalAuth record (_externalAuths)"),
        ("token issued", r"NewAuthToken|newAuthToken|record_tokens\.go|RecordAuthResponse|NewJWT", "RecordAuthResponse issues PocketBase's own JWT (record.NewAuthToken, core/record_tokens.go)"),
        ("token validated", r"loadAuthToken|FindAuthRecordByToken|ParseJWT", "apis/middlewares.go loadAuthToken -> app.FindAuthRecordByToken validates it on each request"),
        ("token refreshed", r"recordAuthRefresh|auth-refresh|record_auth_refresh", "POST /auth-refresh (recordAuthRefresh) issues a new token"),
    ],
    "pb-q7": [  # Go framework: a custom route and an on-record-create hook
        ("pocketbase.New", r"pocketbase\.New(WithConfig)?\(", "the app is created with pocketbase.New()"),
        ("OnServe", r"OnServe", "routes are registered in app.OnServe()"),
        ("route registration", r"\.(GET|POST|PUT|PATCH|DELETE|Any|Route)\(", "se.Router.GET/POST(...) adds the route"),
        ("record create hook", r"OnRecord(After)?Create\w*", "app.OnRecordCreate (or OnRecordCreateRequest / OnRecordAfterCreateSuccess) is the create hook"),
        ("Bind", r"BindFunc|\.Bind\(", "handlers are attached with BindFunc/Bind"),
        ("e.Next()", r"\.Next\(\)", "every hook handler must call e.Next() to continue the chain"),
        ("Start", r"\.Start\(\)", "app.Start() runs the app"),
        ("event types", r"core\.(Request|Record|RecordRequest|Serve)Event", "the handlers take *core.ServeEvent, *core.RequestEvent, *core.RecordEvent"),
    ],
    "pb-q8": [  # input validation and API rule enforcement
        ("RecordUpsert form", r"RecordUpsert|validateFormFields|record_upsert\.go", "forms/record_upsert.go validates the submitted record data"),
        ("field validation", r"ValidateValue|[oO]nRecordValidate|ValidateWithContext", "each field's ValidateValue runs from onRecordValidate on save"),
        ("CRUD handlers", r"record_crud\.go|recordsList|recordView|recordCreate|recordUpdate|recordDelete", "apis/record_crud.go's handlers enforce the rules before querying"),
        ("rule fields", r"(List|View|Create|Update|Delete|Manage)Rule|(list|view|create|update|delete|manage)Rule", "collection.ListRule/ViewRule/CreateRule/UpdateRule/DeleteRule are the rules"),
        ("RecordFieldResolver", r"RecordFieldResolver|record_field_resolver", "core.NewRecordFieldResolver resolves the rule's fields (@request.auth, relations) into SQL"),
        ("filter to SQL", r"FilterData|BuildExpr|tools/search|search\.NewProvider", "search.FilterData(rule).BuildExpr(resolver) adds the rule as a WHERE condition"),
        ("superuser bypass", r"HasSuperuserAuth|[Ss]uperuser", "a nil rule means superusers only, and superusers skip the rules"),
    ],
    "pb-q9": [  # public REST API: authenticate, then list and filter
        ("auth-with-password", r"auth-with-password", "POST /api/collections/{collection}/auth-with-password authenticates"),
        ("identity", r"identity", "its body takes identity and password"),
        ("token", r"\btoken\b", "the response carries the auth token"),
        ("Authorization header", r"Authorization", "later requests send the token in the Authorization header"),
        ("records endpoint", r"/api/collections/[^/\s]+/records", "GET /api/collections/{collection}/records lists records"),
        ("filter", r"filter", "the filter query parameter filters them"),
        ("paging/sort", r"perPage|\bpage\b|\bsort\b", "page/perPage/sort shape the list"),
        ("handler code", r"record_auth_with_password|recordAuthWithPassword|record_crud\.go|recordsList", "the handlers: apis/record_auth_with_password.go, apis/record_crud.go recordsList"),
    ],
    "pb-q10": [  # tests for the record CRUD API and access rules
        ("record_crud_test.go", r"record_crud_test\.go", "apis/record_crud_test.go holds the record CRUD API tests"),
        ("test functions", r"TestRecordCrud\w*", "TestRecordCrudList/View/Create/Update/Delete"),
        ("ApiScenario", r"ApiScenario|tests/api\.go", "each case is a tests.ApiScenario (tests/api.go)"),
        ("ExpectedStatus", r"ExpectedStatus", "scenarios assert the HTTP status with ExpectedStatus"),
        ("403 superuser-only", r"403|(?i:forbidden)", "a nil rule (superusers only) gives 403 to guests and regular auth records"),
        ("list filtered", r"totalItems|items.{0,4}\[\]|(?i:empty (items|list|results?|page|array|set)|no (items|records)\b|filtered out)", "a list rule that does not match gives 200 with no items, not an error"),
        ("404 on view", r"404|(?i:not found)", "a view/update/delete rule that does not match gives 404"),
        ("superuser", r"[Ss]uperuser", "scenarios authorized as a superuser bypass the rules"),
    ],
}
Q_KEYS: dict[str, list[tuple[str, str]]] = {t: [(n, p) for n, p, _ in terms] for t, terms in Q_KEYS_WHY.items()}

SRC = "pb-src"
_LOCK = threading.Lock()
GO_TIMEOUT = 900


def run(cmd, cwd: Path, timeout: int = GO_TIMEOUT, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=check)


def base_name(task: str) -> str:
    return f"pb-base-{task[3:]}" if task in PRS else "pb-base-q"


def base_sha(task: str) -> str:
    return PRS[task]["base"] if task in PRS else TAG_SHA


def source(work: Path) -> Path:
    """The full clone (history and the PRs' heads), made once."""
    src = work / SRC
    if not src.exists():
        part = src.with_name(src.name + ".part")
        shutil.rmtree(part, ignore_errors=True)
        run(["git", "clone", "-q", URL, str(part)], work, check=True)
        part.rename(src)
    return src


def build(src: Path, sha: str, dst: Path):
    """A one-commit clone of `sha` at `dst`: branch master, no remote, modules downloaded, build cache warmed. The base's
    own build result goes to .git/pb-bench.json (outside the work tree, so no diff sees it)."""
    ref = f"bench/{dst.name.removesuffix('.part')}"
    run(["git", "branch", "-f", ref, sha], src, check=True)
    run(["git", "-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", ref, f"file://{src}", str(dst)], src.parent, check=True)
    run(["git", "remote", "remove", "origin"], dst, check=True)
    run(["git", "branch", "-m", ref, "master"], dst, check=True)
    assert run(["git", "rev-parse", "HEAD"], dst).stdout.strip() == sha
    run(["go", "mod", "download"], dst, check=True)
    write_build_info(dst, sha)


def go_build(repo: Path) -> tuple[bool, list[str], str]:
    """`go build ./...`: (passed, the packages that failed to compile, the last error line)."""
    b = run(["go", "build", "./..."], repo)
    err = b.stderr.strip().splitlines()
    return b.returncode == 0, sorted({l[2:].strip() for l in err if l.startswith("# ")}), (err or [""])[-1][:300]


def write_build_info(repo: Path, sha: str):
    """The base's own build result, in .git/pb-bench.json (outside the work tree, so no diff sees it): a run's build is
    judged against it (pb-pr3192's base already fails in golang.org/x/tools v0.12.0 under Go >= 1.22)."""
    ok, failing, err = go_build(repo)
    info = {"sha": sha, "build_ok": ok, "build_failing": failing, "build_err": err, "go": run(["go", "version"], repo).stdout.strip()}
    (repo / ".git" / "pb-bench.json").write_text(json.dumps(info) + "\n")


def base(work: Path, task: str) -> Path:
    """The prepared base for a task, built aside and moved in whole on first use (a parallel run never copies half one)."""
    dst = work / base_name(task)
    with _LOCK:
        if not dst.exists():
            src = source(work)
            part = dst.with_name(dst.name + ".part")
            shutil.rmtree(part, ignore_errors=True)
            build(src, base_sha(task), part)
            part.rename(dst)
    return dst


def prepare(work: Path):
    for task in ["pb-q1", *PRS]:
        b = base(work, task)
        print(b.name, (b / ".git" / "pb-bench.json").read_text().strip())


GOPLS = {"gopls-lsp@claude-plugins-official": True}


def with_gopls(cmd: list[str]) -> list[str]:
    """The run's command with the official gopls plugin enabled in its --settings (every arm alike, as swe.py enables
    pyright), so lsp-plus and plain Claude Code have the same Go language server."""
    cmd = list(cmd)
    found = False
    for i, a in enumerate(cmd[:-1]):
        if a == "--settings":
            s = json.loads(cmd[i + 1])
            s["enabledPlugins"] = {**s.get("enabledPlugins", {}), **GOPLS}
            cmd[i + 1] = json.dumps(s)
            found = True
    return cmd if found else cmd + ["--settings", json.dumps({"enabledPlugins": GOPLS})]


# What a run may leave that is not its change: PocketBase's data folder if it started the app, built binaries.
DIFF_EXCLUDE = [":(exclude)**/pb_data/**", ":(exclude)pb_data/**", ":(exclude)*.db", ":(exclude)*.db-shm", ":(exclude)*.db-wal",
                ":(exclude)coverage.out", ":(exclude)*.test"]


def diff(task: str, repo: Path, names: bool = False) -> str:
    """The run's change against the base commit (commits it made included), new files included."""
    run(["git", "add", "-A", "-N", "."], repo)
    return run(["git", "diff", *(["--name-only"] if names else ["--binary"]), base_sha(task), "--", ".", *DIFF_EXCLUDE], repo).stdout


def is_test(path: str) -> bool:
    """Test code: _test.go files, PocketBase's tests/ helper package, testdata and fixtures."""
    return path.endswith("_test.go") or path.startswith("tests/") or "/testdata/" in path or path.startswith("testdata/")


def go_checks(repo: Path, touched: list[str]) -> dict:
    """`go build ./...` over the module, judged against the base's own build (build_ok_vs_base: no package fails that did
    not fail at the base), and `go vet` over the packages of the touched .go files (their tests compiled too)."""
    ok, failing, err = go_build(repo)
    info = json.loads((repo / ".git" / "pb-bench.json").read_text()) if (repo / ".git" / "pb-bench.json").exists() else {}
    base_failing = info.get("build_failing", [])
    new_failures = sorted(set(failing) - set(base_failing))
    pkgs = sorted({"./" + str(Path(f).parent) for f in touched if f.endswith(".go") and (repo / f).exists()})
    v = run(["go", "vet", *pkgs], repo) if pkgs else None
    return {"build_ok": ok, "base_build_ok": info.get("build_ok"), "build_ok_vs_base": ok or (bool(failing) and not new_failures),
            "build_new_failures": new_failures, "build_err": "" if ok else err,
            "vet_pkgs": pkgs, "vet_ok": (v.returncode == 0) if v else None,
            "vet_err": (v.stderr.strip().splitlines() or [""])[-1][:300] if v and v.returncode else ""}


def grade_pr(task: str, repo: Path) -> dict:
    pr = PRS[task]
    touched = [l for l in diff(task, repo, names=True).splitlines() if l.strip()]
    want = set(pr["files"])
    hit = sorted(want & set(touched))
    extra = sorted(f for f in touched if f not in want and not is_test(f) and f not in ("go.mod", "go.sum"))
    out = {"score": len(hit) / len(want), "files_hit": hit, "files_missed": sorted(want - set(touched)), "extra_files": extra,
           "n_extra": len(extra), "test_files": sorted(f for f in touched if is_test(f)),
           "module_files": sorted(f for f in touched if f in ("go.mod", "go.sum")), "touched": len(touched)}
    out.update(go_checks(repo, touched))
    return out


def grade_question(task: str, answer: str) -> dict:
    key = Q_KEYS[task]
    hit = [name for name, pat in key if re.search(pat, answer)]
    return {"score": len(hit) / len(key), "terms": hit, "missed": [name for name, _ in key if name not in hit], "of": len(key),
            "has_paths": bool(re.search(r"\b[\w/]+\.go\b", answer))}


def grade(task: str, answer: str, repo: Path) -> dict:
    if task in PRS:
        return grade_pr(task, repo)
    if task in Q_KEYS:
        return grade_question(task, answer)
    raise KeyError(task)


def check(work: Path):
    """The grader's own test: each PR's merged change, applied to a copy of its base, grades 1.0 with no extras and builds."""
    import tempfile
    src = source(work)
    for task, pr in PRS.items():
        with tempfile.TemporaryDirectory(dir=work) as tmp:
            repo = Path(tmp) / "repo"
            shutil.copytree(base(work, task), repo, symlinks=True)
            patch = run(["git", "diff", "--binary", pr["base"], pr["merge"]], src).stdout
            subprocess.run(["git", "apply", "-"], cwd=repo, input=patch, text=True, check=True, capture_output=True)
            g = grade(task, "", repo)
            print(task, json.dumps(g))


if __name__ == "__main__":
    if sys.argv[1:2] == ["prepare"]:
        prepare(Path(sys.argv[2]))
    elif sys.argv[1:2] == ["check"]:
        check(Path(sys.argv[2]))
    elif sys.argv[1:2] == ["build-info"]:
        # Re-record each prepared base's own build (its .git/pb-bench.json).
        for t in ["pb-q1", *PRS]:
            b = Path(sys.argv[2]) / base_name(t)
            write_build_info(b, base_sha(t))
            print(b.name, (b / ".git" / "pb-bench.json").read_text().strip())
