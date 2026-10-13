# claude-modpack

Mods for Claude Code: plugins built from its function hooks that change how it works and what it shows. Each was measured on real tasks before it shipped, and the six here are made to work together. Built and tested on Claude Code 2.1.296.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.svg">
  <img alt="70 of 70 graded runs correct with the pack and without it; 15% lower cost in a session already holding 227k tokens; 5.2 instead of 7.2 model requests per task; 35% lower cost on feature work handed to a cheaper worker." src="assets/hero-light.svg" width="880">
</picture>

## The modpack

```
/plugin install modpack --marketplace HarzerHeribert/claude-modpack
```

installs six mods at once; the `modpack` plugin lists them as its dependencies.

**Measured as a whole** (`benchmarks/delegate-bench/SUITE.md`, 70 Opus runs on click, against plain Claude Code): all 70 correct. With the pack Opus needed 5.2 model requests per task instead of 7.2, and the work cost 7% less in a fresh session; in a session already holding 227k tokens it cost 15% less and finished in 43 s instead of 54 s. A one-request lookup costs a few cents more. The savings come from fewer steps on multi-step work (a coverage task −21%, −29% in the long session), not from delegate: Opus never handed off by itself, not even with a routing rule.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/cost-dark.svg">
  <img alt="Cost per task, plain Claude Code against the modpack. Average task: $0.49 against $0.46 in a fresh session (−7%), $0.36 against $0.31 in a 227k-token session (−15%). Coverage −21% and −29%, feature −6% and −18%; a one-request lookup costs a few cents more." src="assets/cost-light.svg" width="880">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/requests-dark.svg">
  <img alt="Model requests per task, plain Claude Code against the modpack. Average task: 7.2 against 5.2 in a fresh session (−28%), 4.5 against 3.1 in a 227k-token session (−30%); the feature task 16 against 10." src="assets/requests-light.svg" width="880">
</picture>

<details>
<summary>The numbers per task: cost · model requests</summary>

| Task | Plain, fresh | Pack, fresh | Plain, 227k | Pack, 227k |
| --- | --- | --- | --- | --- |
| Add a feature | $0.85 · 16 | $0.80 · 10 | $0.98 · 12 | $0.80 · 7.5 |
| Raise test coverage | $0.84 · 10.5 | $0.66 · 7 | $0.78 · 8 | $0.55 · 5 |
| Rename a function | $0.38 · 6.5 | $0.35 · 5 | $0.40 · 6 | $0.33 · 4.5 |
| Explain a code path | $0.45 · 6 | $0.42 · 4 | $0.11 · 1 | $0.13 · 1 |
| Trace every caller | $0.36 · 5 | $0.39 · 4.5 | $0.14 · 2 | $0.17 · 2 |
| Find matching types | $0.29 · 3.5 | $0.31 · 3.5 | $0.09 · 1.5 | $0.09 · 1 |
| Look up a name | $0.26 · 3 | $0.26 · 2.5 | $0.06 · 1 | $0.09 · 1 |
| **Average task** | **$0.49 · 7.2** | **$0.46 · 5.2** | **$0.36 · 4.5** | **$0.31 · 3.1** |

Means of two runs each, Claude Opus 5.5 at xhigh effort, list prices. The full write-up, with what each condition loaded, is [SUITE.md](benchmarks/delegate-bench/SUITE.md).
</details>

| Mod | Area | What it does | Measured |
| --- | --- | --- | --- |
| [statusline](#statusline) | interface | One line under the prompt: the model and its effort, how full the context is, the plan's 5-hour and 7-day use with their resets, and what other mods put on it. | Interface only. |
| [smart-compact](#smart-compact) | cost | Keeps an idle session's prompt cache warm, or compacts it just before it expires, whichever is cheaper, and puts "● ready · cold in 44m" on the status line. | Priced from the cache's list prices; not benchmarked. |
| [delegate](#delegate) | cost | A `hand_off` tool: Claude gives a self-contained task to a cheaper worker (Haiku or Sonnet), told where the change reaches by the language server, and gets back the diff, a check the tool runs itself, and what it cost. A live card and a side pane show the worker at work. | 120 Opus runs, all correct: handing off a feature or tests cost 27–37% less, fresh and in a 233k-token session; smaller work costs more. Opus never hands off unasked (0 of 38 runs): ask for it. |
| [lsp-plus](#lsp-plus) | code intelligence | Extends Claude Code's LSP: references name the docs that use a symbol, an edit that removes a name the docs still use says so, a grep for a code symbol is told the exact LSP call, `/refs` finds stale names and dead links in the docs, and Markdown and SQL get language servers. | Its grep note cost no quality in 10 runs. |
| [cells](#cells) | flow | A `run_cell` tool: edits and their check in one step through the real Edit tool, and the language server's references, definitions and renames; guidance on chaining; a note when a model request did nothing a previous one couldn't have. | 8 Opus runs, all correct: +12% in a fresh session, −6% at 600k context. |
| eta | interface | Long-running and background jobs with a percentage and an estimated finish time, in aligned columns above the prompt; a job that has finished leaves, a failure stays until you write again. | Interface only. |

### How they work together

The mods never import each other. Each finds the others through Claude Code itself (a tool in the tool list, a note on a tool's result) and works alone when they are missing.

- **lsp-plus enriches the language server's answers** (the docs that use a symbol) for whoever asks: delegate's look at where a change reaches before a hand-off, and cells' `refs()`, `defn()` and `rename()`.
- **lsp-plus points a symbol grep at cells.** With cells loaded, its note names the one-step call there (`refs('src/a.ts', 'name', { line: 12 })`), which needs no LSP tool loaded, and `rename()`.
- **Edits made in a cell go through the Edit tool**, so lsp-plus's check for docs that still use a removed name runs on them, and the notes other mods attach to a cell's calls come back in the cell's report.
- **statusline is the line the others write on.** It draws the model, the context and the plan's windows itself; smart-compact adds its "● ready · cold in 44m" through `$.statusline.set(...)`, a segment whose countdown statusline counts. Without statusline, smart-compact says the same in Claude Code's own status text.
- **smart-compact keeps long sessions' caches warm**, where delegate and cells pay most: both save model requests, and every request re-reads the whole context.
- **eta shows background shell jobs**; delegate shows its own workers in its card and pane.

### What makes the cut

A mod joins the pack when:
- it was measured (`benchmarks/`) and cost no quality: every graded run stays correct;
- it saves cost or time, or makes the work more reliable (cells' edits keep a diff and `/rewind` where a script would not), or only adds interface;
- it works with the other mods and without them, and each of its behaviours can be switched off.

## Install

The whole pack, or one mod alone:

```
/plugin install modpack --marketplace HarzerHeribert/claude-modpack
/plugin install smart-compact --marketplace HarzerHeribert/claude-modpack
```

Answer `y` to add the marketplace, then pick a scope.

### Language servers

Claude Code's LSP tool, which lsp-plus, delegate and cells build on, needs the official LSP plugins (`claude plugin install <plugin>@claude-plugins-official --scope user`) and their servers on the `PATH`:

| Languages | Plugin (`@claude-plugins-official`) | Server |
| --- | --- | --- |
| TypeScript, JavaScript | `typescript-lsp` | `npm i -g typescript-language-server typescript@6` (TypeScript 7 has no `tsserver.js`, which the server needs) |
| Python | `pyright-lsp` | `npm i -g pyright` |
| Rust | `rust-analyzer-lsp` | `brew install rust-analyzer` |
| Swift | `swift-lsp` | Xcode |
| C, C++ | `clangd-lsp` | Xcode (`clangd`) |
| Java | `jdtls-lsp` | `brew install jdtls` |
| C# | `csharp-lsp` | `dotnet tool install -g csharp-ls` (0.18 on .NET 9) |
| PHP | `php-lsp` | `npm i -g intelephense` |
| Lua | `lua-lsp` | `brew install lua-language-server` |
| Markdown, SQL | lsp-plus | `brew install marksman postgres-language-server` |

## Developing

Each mod is a folder: `.claude-plugin/plugin.json`, `hooks/hooks.json` and a hooks module (`hooks/register.tsx`). Run Claude Code with one loaded from its folder:

```sh
claude --plugin-dir ./cells
```

or list folders in `CLAUDE_CODE_PLUGIN_DIRS`, separated by `:`, so a saved edit reloads in a running session. Check a mod before it loads:

```sh
claude plugin validate cells   # manifest, hooks, everything the engine would refuse
claude plugin test cells       # its *.test.ts files, run against the engine
```

Claude Code writes the API types into `<mod>/.claude-plugin/types/` whenever it loads a mod. That folder is git-ignored, so `tsc -p <mod>` works once the mod has loaded. What decided each mod's shape is in `benchmarks/`, with the harness to run it again.

## smart-compact

### The problem

An idle session's prompt cache expires after its TTL: 1 hour on a subscription, 5 minutes in overage or on an API key. The next prompt then writes the whole context to the cache again, at 1.25x (5 min) or 2x (1 h) the input price. For a 400k-token Opus 5.5 session on the 1-hour cache (list prices):

| Option | Cost |
| --- | --- |
| Let it expire, re-cache on return | $3.20 |
| One keep-alive (re-read the cached prefix; a read resets the TTL) | $0.09 |
| Compact before it expires | ~$0.87, plus detail lost to the summary |

### What it does

A few minutes before the cache expires (2.5 min on the 1-hour TTL, 45 s on the 5-minute one), the `smart` strategy:

1. Sends keep-alives while they cost less than compacting would, counting lost detail as `compactPenaltyUsd`. It stops after `maxIdleHours`.
2. Then compacts while the cache is still warm.
3. Leaves small sessions alone: below `minSavingsUsd` of re-cache cost, or below `minCompactTokens` of context, it never compacts.

It never compacts while the prompt holds a draft or agents are running; it sends a keep-alive to hold the cache instead. If the machine sleeps past the deadline, it marks the cache expired and does nothing. A failed action is retried twice, 20 s apart. The TTL is detected from the plan and corrected from cache hits and misses it observes.

### On the status line

smart-compact puts one segment at the right edge of [statusline](#statusline)'s line, the answer to one question: is the session ready to prompt, or has the cache gone cold? It says `● ready`, `· cold in m:ss` (amber in the last five minutes), `· compacts in …` when an idle compaction is near, `○ cold`, or what the mod is doing (`compacting`, `keeping warm`, `paused`). Without the statusline mod, the same words are Claude Code's status text.

### Commands and options

`/cache` shows the live figures and plan; `/cache pause`, `/cache resume` and `/cache keepalive` control it.

Options are set in `/config`:

| Option | Default | |
| --- | --- | --- |
| `strategy` | `smart` | `compact`: compact at the first expiry. `keepalive`: never compact. `off`: status line only. |
| `cacheTtl` | `auto` | `1h` or `5m` to override detection. |
| `minSavingsUsd` | `0.25` | Below this re-cache cost, the cache is left to expire. |
| `compactPenaltyUsd` | `0.5` | Higher keeps the cache warm longer before compacting. |
| `minCompactTokens` | `100000` | Never compacts a smaller context. |
| `maxIdleHours` | `6` | Stops keep-alives after this long idle. |
| `compactInstructions` | empty | Passed to idle compactions, like `/compact <text>`. |

Prices are list prices, so on a subscription they are API-equivalent estimates, not a bill.

## statusline

One line under the prompt, drawn in Claude Code's own hint row so the mode indicator and the status share it:

```
⏵⏵ auto mode on       Opus 5.5 xhigh   412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d   ● ready · cold in 44m
```

- **Its own segments:** the model and its effort, the context against the auto-compact point (a highlight sweeps along it while Claude works), and how much of the plan's 5-hour and 7-day windows is used, with when each resets: quiet under half, plain past it, amber from 80%.
- **Other mods' segments:** a mod calls `$.statusline.set({ id, priority, parts, short?, side? })` and lists `statusline` among its dependencies. A part is text, a countdown (`{ until, prefix?, warnMs? }`, counted by the line) or a spinner (`{ spin: true }`), so a mod sends a segment when it changes, not every second. `$.statusline.remove({ id })` takes it off. smart-compact's `● ready · cold in 44m` is one.
- **Narrow terminals** drop the least important first: the model, then the windows' resets, the windows, the gauge, and another mod's countdown before its own words.
- **Published pages:** a pill on the left lists the pages this session published with the Artifact tool.
- **Phone and IDE:** where no line is drawn, the same line is the session's status text.

| Option | Default | |
| --- | --- | --- |
| `placement` | `line` | `tail`: appended dim to Claude Code's hint. `band`: above the prompt. `off`. |
| `limits` | `always` | `half`: a plan window only once it is half used. `off`: never. |
| `animate` | `true` | The highlight along the gauge. |

## delegate

### The problem

Every request of the main model re-reads its whole context. At 600k tokens on Opus 5.5 that is about $0.12 a step before any work is done, so a ten-step search costs over a dollar even when only its conclusion matters. A Haiku worker reads only its own small context; the same ten steps cost about a cent.

### What it does

Claude calls `hand_off` with a task that stands alone. It sets:
- `explore` (read only) or `edit`;
- the symbols or `file:line` places it touches (`focus`);
- for edits, a `check` command;
- the worker: `haiku` for mechanical or precisely specified work, `sonnet` for work that needs more judgment.

Design decisions, subtle debugging and anything that depends on the conversation stay with the main model.

1. **Where it reaches.** For each focus entry the mod asks the LSP tool for references and callers (with lsp-plus loaded, the docs that mention it come along), and tells the worker. Without a language server it falls back to a text search and says so.
2. **The worker.** A subagent, read-only for `explore`, with Edit and Write for `edit`. The call waits for it inside the tool call, which costs the main model one request, and returns the report with the evidence. With `background`, it returns at once and the report arrives as a message, so the main model can work meanwhile. A follow-up within 50 minutes goes to the same worker, its reading still in its context and its cache warm.
3. **The evidence.** The mod adds what the report cannot vouch for:
   - the diff against a git snapshot taken at the start, however the worker edited;
   - the check command, run by the mod itself;
   - references outside the changed files;
   - what the work cost against the same steps on the main model.
4. **The review.** The main model judges the diff and the check, not the report. A forked review is available (`review: fork`) but not the default: a fork pays the conversation again, uncached.
5. **The log.** Each hand-off goes to `~/.claude/mods/delegate/log.jsonl`, with rework: the main model editing the worker's files afterwards. `/delegate` sums it up (cost, estimated saving, work that came back, checks that passed first time) and opens the pane.

While a worker runs, its card in the transcript turns, with its clock, requests, cost and last actions; `watch ▸` opens a side pane with every step it took and, once in, its report.

| Option | Default | |
| --- | --- | --- |
| `model` | `haiku` | The worker's model when the call names none. |
| `wait` | `tool` | `tool`: the call waits for the report. `message`: it returns at once. Claude can pick either per call with `background`. |
| `review` | `inline` | `fork`: a forked review returns a verdict only. `auto`: fork for large evidence. |
| `reuseMinutes` | `50` | How long a worker stays warm for follow-ups. |
| `workerContextCap` | `60000` | A worker grown past this is not continued. |

**Measured** (`benchmarks/delegate-bench/RESULTS.md`: 92 Opus runs on click; `SUITE.md`: 28 more in a session holding 233k tokens). Every run was correct.
- **Where it pays:** a feature from a spec and tests to a coverage target, work that takes Opus six or more steps: 28–35% less in a fresh session, 27–37% less in the 233k-token one.
- **Where it doesn't:** lookups, traces, explanations and small edits. Fresh they cost about the same handed off; in a session that already knows the code they cost from 29% to 3.6 times more, because Opus alone answers them in one to three requests and a hand-off takes two to five of its own. A projection had promised savings that grow with the session; measured, they don't.
- **Opus never chose to delegate by itself** (0 of 24 runs here, 0 of 14 more with a routing rule in `SUITE.md`), so the hand-off is yours to ask for: "hand the tests to a Sonnet worker".
- **The model may be the bigger lever.** On these tasks Sonnet 5.5 alone, with no mod, was as correct as Opus and cost 65% less in 44% less time (`SUITE.md`). Every setup here scored 100%, so the tasks can't show where Sonnet falls short; delegate is for an Opus session on open-ended work that hands off its big, specified pieces.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/delegate-dark.svg">
  <img alt="Cost per task, Opus alone against a hand-off. Fresh: the feature $0.79 against $0.51 (−35%), tests −28%, the rest about even. In a 233k-token session: the feature −37%, tests −27%, the rename +43%, lookups, traces and explanations +29% to +259%." src="assets/delegate-light.svg" width="880">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/growth-dark.svg">
  <img alt="The hand-off against Opus alone by session size. Lines projected from the fresh runs fall with the session size, to −64% for the feature at 600k. Measured at 233k: the feature −37% and tests −27%, but the rename +43% and the small tasks +101% to +259%." src="assets/growth-light.svg" width="880">
</picture>

<details>
<summary>The numbers per task: Opus alone → handed off</summary>

| Task | Fresh | In a 233k-token session |
| --- | --- | --- |
| Add a feature | $0.79 → $0.51 (−35%) | $0.82 → $0.52 (−37%) |
| Raise test coverage | $0.73 → $0.52 (−28%) | $0.73 → $0.53 (−27%) |
| Rename a function | $0.45 → $0.41 (−9%) | $0.26 → $0.38 (+43%) |
| Explain a code path | $0.42 → $0.42 (−1%) | $0.11 → $0.21 (+101%) |
| Trace every caller | $0.34 → $0.35 (+3%) | $0.14 → $0.18 (+29%) |
| Find matching types | $0.32 → $0.35 (+10%) | $0.06 → $0.23 (+259%) |
| Look up a name | $0.26 → $0.29 (+13%) | $0.06 → $0.15 (+149%) |

Means of two runs each, all correct. Fresh: the best hand-off that waits in the tool call ([RESULTS.md](benchmarks/delegate-bench/RESULTS.md)); 233k: Opus told in the prompt to hand off, or not ([SUITE.md](benchmarks/delegate-bench/SUITE.md)).
</details>

## cells

### What the transcripts show

The mod was built from 240 of the author's own Claude Code sessions (32,202 model requests, $3,519 at list prices; `run_cell` was loaded in one of them):

- **Scripts instead of the Edit tool.** Models changed files with Python, sed or perl through Bash 5,996 times, against 2,720 Edit and Write calls. In auto mode that is as cheap as it gets, but the person sees no diff and checkpoints don't track it, so `/rewind` can't restore it. Claude Code's own guidance prefers the Edit tool for exact and multi-line replacements.
- **Requests that needed no judgment** cost about 2% of the spend ($70) and about 100 minutes: a check run alone right after edits (185 times), one edit per request twice in a row (487), the same command again (105), one read per request in a row (342). That is the ceiling of what chaining can save.
- **`run_cell` itself** was used 7 times in 1,176 requests of the one session that had it. The language server was called 3 times in all 240 sessions; the LSP tool is deferred, so each use first costs a ToolSearch request.

### What it does

- **`run_cell`** runs a short JavaScript program whose calls are real Read, Edit, Write, Bash and LSP calls, with the usual permissions; edits show as diffs and can be rewound. It is meant for:
  - several edits and their check in one step, instead of a script;
  - `refs(path, name)` and `defn(path, name)`, each place with its line, without loading the LSP tool;
  - `rename(path, name, newName)`, which edits every reference the language server lists through Edit and returns where the old name still appears as text (docs, strings, comments, code the server did not resolve), for Claude to judge.
  A language server that is still indexing answers with the open file alone (2 references instead of 14 on click's `format_filename`): the first question per kind of file is asked again for up to 10 s while it lists fewer places than the text holds.
- **The chaining guidance**, a system-prompt section: things you already need in one call, known edits in one response with their check after them, waiting in one command. In a pilot (`benchmarks/cells-pilot/`) it cut Haiku's requests by 18% on small tasks; `run_cell` added nothing on top there.
- **Notes after the fact.** When a request did no more than a check right after edits, a second single edit in a row, or the same command again, or when a script rewrote a file around the Edit tool, the tool result gets one line: what the request re-read (`56k tokens, ≈$0.01, 5 s`) and how to save it. The first note of a kind is full, later ones short, at most four per kind, spaced at least 8–25 requests apart. Nothing is blocked.

Taken out in 0.2: folding of long Bash output (it fired 4 times in 32,202 requests, and it hides lines from the model), the scanner under every running Bash command, the `prefer` option (a pilot arm, no gain), `sleep()` (never used; a Bash `until` loop or Monitor waits better), and the cell number and the card's header row.

| Option | Default | |
| --- | --- | --- |
| `mode` | `cells` | `nudge`: the guidance and the notes, no tool. `off`: nothing. |
| `nudges` | `true` | The notes. |
| `visuals` | `true` | Cells drawn as live cards. |

**Measured** (`benchmarks/delegate-bench/results-cells.jsonl`, condition K: 8 Opus runs on click with cells 0.2 loaded, against the same tasks' Opus-alone runs):

| Task | Alone | With cells | Requests | At 600k: alone | with cells |
| --- | --- | --- | --- | --- | --- |
| t1-trace | $0.34 | $0.38 | 5 → 4.5 | $0.94 | $0.92 |
| t2-rename | $0.45 | $0.39 | 9 → 4.5 | $1.53 | $0.93 |
| l1-feature | $0.79 | $0.87 | 15 → 11.5 | $2.59 | $2.25 |
| l2-coverage | $0.73 | $0.95 | 9 → 12 | $1.81 | $2.39 |

- **Quality held:** 8 of 8 runs correct.
- **No saving in a fresh session:** +12% over the eight runs. The tool changes the tool list, so less of a fresh session's prompt comes from the cache (on the coverage task about 12k tokens more written per run, ≈$0.10), and on that task Opus also took more steps.
- **Fewer requests on three of four tasks.** In a session already holding 600k tokens, where each request re-reads them, the same runs come to −6% overall. Most of that is the rename, done in 4.5 requests instead of 9 without `rename()`: Opus never called `rename()`, `refs()` or `defn()` unprompted. With two runs per task, the differences per task are within the runs' own spread.

## lsp-plus

- **Docs in references.** `findReferences`, `goToDefinition` and `incomingCalls` also name the doc lines that use the symbol as code (in backticks, called, in a code block, or a name no prose would use), which no language server indexes.
- **Docs that drift.** After an Edit or Write removes a name from the code that the docs still mention, Claude is told where, with the likely new name when it looks like a rename.
- **`/refs`.** Checks every doc in the repository for code names no file in the code has any more, and for links to files that do not exist.
- **A nudge on symbol searches.** When grep, rg, ag, git grep, or sed or awk printing matches, searches for a code symbol in files a language server covers, the search runs as asked and Claude is told the exact LSP call that answers it (`findReferences` on `file:line:col`), and that grep stays needed for strings and docs. Nothing is blocked.
- **Markdown and SQL servers.** marksman for `.md` (headings, links), postgres-language-server for `.sql`.

Options `docs`, `drift` and `nudge` turn the first three off.

## License

MIT, see [LICENSE](LICENSE).
