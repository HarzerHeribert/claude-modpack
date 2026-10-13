<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.svg">
  <img alt="claude-modpack: six Claude Code mods, each measured on real tasks before it shipped, built to work together. statusline, smart-compact, delegate, lsp-plus, cells, eta." src="assets/banner-light.svg" width="880">
</picture>

[![Release](https://img.shields.io/github/v/release/HarzerHeribert/claude-modpack?style=flat-square&color=2a78d6&label=release)](https://github.com/HarzerHeribert/claude-modpack/releases) [![License: MIT](https://img.shields.io/badge/license-MIT-2a78d6?style=flat-square)](LICENSE) ![Claude Code 2.1.296](https://img.shields.io/badge/Claude%20Code-2.1.296-D97757?style=flat-square) [![730 graded runs, all correct](https://img.shields.io/badge/graded%20runs-730%2C%20all%20correct-0ca30c?style=flat-square)](benchmarks/delegate-bench/SUITE.md) [![6 mods](https://img.shields.io/badge/mods-6-555555?style=flat-square)](#the-mods-in-depth)

Six mods that get more done per request in Claude Code, and show you what it's doing.<br>
Every claim below was measured, and a mod that measured no gain stays quiet.

</div>

<br>

## What changes when you install it

### Edits and their check in one step, still real diffs (cells)

Claude writes several edits and the command that checks them as a few lines of code, and they run as one step. Each edit goes through the real Edit tool, so you see a diff and `/rewind` still works. This is the card of a finished cell in the terminal:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screen-cells-dark.svg">
  <img alt="A running cell card in the terminal: a rounded orange card with the three lines of code the cell runs, the read and edit rows done and the pytest row still running with its elapsed time, and the closing line: running, a scanner, 3 calls, 1.0 s." src="assets/screen-cells-light.svg" width="880">
</picture>

### Big work handed to a cheaper worker, by itself after you approve a plan (delegate)

Approve a plan of 20 lines or more and Claude hands it to a Sonnet worker, which builds it and runs the check. The card shows the worker live, in the same style as a cell: orange while it runs, grey once it is done. `/delegate` opens a pane with every step. This is how a hand-off card draws, running and then done:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screen-delegate-dark.svg">
  <img alt="Two hand-off cards: one with an orange border while the Sonnet worker runs (the task, five worker actions with the last one still turning, the state running with a scanner, 41s, 6 req, $0.05, watch), and the same card in grey when done (1:14, 9 req, $0.14, +48 -2 in 2 files, check passed, view)." src="assets/screen-delegate-light.svg" width="880">
</picture>

### Symbol searches answered by the language server (lsp-plus)

A grep for a code symbol comes back with the language server's answer attached: the callers of a function, or the references of anything else. Claude needs no further step to find them. `/lsp-plus:setup` sets the servers up. This is the answer attached to a grep:

```text
`format_filename` per the language server: called from 4 functions in 3 files (code only: strings, comments, docs and namesakes are in the grep above):
src/click/exceptions.py: FileError.__init__ (353)
src/click/types.py: File.convert (1013), Path.convert (1168, 1177, 1185, 1194, 1203, 1212)
src/click/utils.py: _LazyFile.__repr__ (163)
```

### Your jobs and workers above the prompt (eta)

A background job shows above the prompt with a percentage and an estimated finish time, read live from its output. A running hand-off is a row there too. The rows draw above the prompt, as shown below under the statusline.

### One line with what matters, and a warm cache (statusline, smart-compact)

One line under the prompt: the model and its effort, how full the context is, the plan's 5-hour and 7-day use with their resets. smart-compact adds whether the next prompt finds the cache ready or cold, and keeps it warm or compacts just before it expires, whichever is cheaper. In the desktop app the line shows only the cache's state, and only when it needs you. This is the line in the terminal, under the prompt, with the eta rows above it:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/screen-band-dark.svg">
  <img alt="Above the prompt, two rows: a background pytest run at 55% finishing in 21 minutes and a running hand-off with its requests, cost and latest action; below the prompt, the status line: auto mode on, Opus 5.5 xhigh, context 412k, 5h 34%, 7d 12%, and smart-compact's ready, cold in 44m." src="assets/screen-band-light.svg" width="880">
</picture>

### It looks after itself

At session start a mod says what it cannot do fully on your machine, with the command that fixes it: `/lsp-plus:setup` or `/cells:setup`. `/mods` shows each mod and turns it on or off, live. The pack checks for a new release once a day and installs it in the background (`updates: notify` or `off` in the modpack plugin's settings; `/modpack:update` updates now).

## Install

```
/plugin install modpack --marketplace HarzerHeribert/claude-modpack
```

That installs all six: the `modpack` plugin lists them as its dependencies. Answer `y` to add the marketplace, then pick a scope. One mod alone works the same way:

```
/plugin install smart-compact --marketplace HarzerHeribert/claude-modpack
```

Then, in the repository you work in:

```
/lsp-plus:setup
```

lsp-plus, delegate and cells build on Claude Code's LSP tool, which needs a language server for each language. The setup finds the repository's languages, checks which plugins and servers are missing, asks once, installs them, and confirms each after a restart. The same by hand: [Language servers](#language-servers).

Then `/mods` to see the six and switch any of them.

## Does it pay?

Claude Opus 5.5 at xhigh effort on seven real tasks in the [click](https://github.com/pallets/click) repository, each graded by hidden tests or a fixed rule. Plain Claude Code against the pack, at list prices.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.svg">
  <img alt="116 of 116 graded runs correct with the pack and without it; 26% lower cost in a session already holding 216k tokens; 5.5 instead of 6.9 model requests per task; 27% lower cost on feature work handed to a worker after your plan." src="assets/hero-light.svg" width="880">
</picture>

- **In a session already holding 216k tokens:** the average task cost 26% less [95% interval −31% to −21%], multi-step work 29% less. 3.5 model requests per task instead of 5.4.
- **In a fresh session:** the average task cost 5% less [−10% to −0.5%], multi-step work 11% less and 18% faster. On tasks of one to five requests the pack costs about 5% more [+1% to +10%], its tools and guidance riding along in every request: there it can't help.
- **A plan you approve, handed to a worker:** feature work 27% less, tests 33% less, every run correct.
- **116 graded runs** for these numbers, every one correct; 730 in all in `benchmarks/`, every one correct.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/cost-dark.svg">
  <img alt="Cost per task, plain Claude Code against the modpack, in a fresh session and in a session already holding 216k tokens." src="assets/cost-light.svg" width="880">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/requests-dark.svg">
  <img alt="Model requests per task, plain Claude Code against the modpack: 3.5 against 5.4 in a session already holding 216k tokens." src="assets/requests-light.svg" width="880">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/delegate-dark.svg">
  <img alt="Cost per task, Opus alone against a plan handed to a worker: feature work 27% less, tests 33% less." src="assets/delegate-light.svg" width="880">
</picture>

The method, every run's record and the harness to rerun it are in [`benchmarks/`](benchmarks/), starting with [SUITE.md](benchmarks/delegate-bench/SUITE.md).

Not measured: smart-compact's savings (priced from list prices) and Windows. In the desktop app, auto mode refuses the workers a mod starts; there hand-offs run in manual mode, or from the terminal.

## The mods in depth

<details>
<summary><b>statusline</b>: interface: one line under the prompt with what matters</summary>
<br>

One line under the prompt, drawn in Claude Code's own hint row so the mode indicator and the status share it:

```
⏵⏵ auto mode on       Opus 5.5 xhigh   412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d   ● ready · cold in 44m
```

- **Its own segments:** the model and its effort, the context against the auto-compact point (a highlight sweeps along it while Claude works), and how much of the plan's 5-hour and 7-day windows is used, with when each resets: quiet under half, plain past it, amber from 80%.
- **Other mods' segments:** a mod calls `$.statusline.set({ id, priority, parts, short?, side? })` and lists `statusline` among its dependencies. A part is text, a countdown (`{ until, prefix?, warnMs? }`, counted by the line) or a spinner (`{ spin: true }`), so a mod sends a segment when it changes, not every second. `$.statusline.remove({ id })` takes it off.
- **Narrow terminals** drop the least important first: the model, then the windows' resets, the windows, the gauge, and another mod's countdown before its own words.
- **Published pages:** a pill on the left lists the pages this session published with the Artifact tool.
- **Phone and IDE:** where no line is drawn, the same line is the session's status text, in a session the phone or IDE hosts. A terminal session watched over Remote Control (`/rc`) from the desktop app, the web or the phone gets no mod drawing and no status text as of Claude Code 2.1.296.

| Option | Default | |
| --- | --- | --- |
| `enabled` | `true` | `false` turns the mod off; `/mods` does it for all of the pack. |
| `placement` | `line` | `tail`: appended dim to Claude Code's hint. `band`: above the prompt. `off`. |
| `limits` | `always` | `half`: a plan window only once it is half used. `off`: never. |
| `animate` | `true` | The highlight along the gauge. |

</details>

<details>
<summary><b>smart-compact</b>: cost: keeps the prompt cache warm, or compacts before it expires</summary>
<br>

An idle session's prompt cache expires after its TTL: 1 hour on a subscription, 5 minutes in overage or on an API key. The next prompt then writes the whole context to the cache again, at 1.25x (5 min) or 2x (1 h) the input price. For a 400k-token Opus 5.5 session on the 1-hour cache:

| Option | Cost |
| --- | --- |
| Let it expire, re-cache on return | $3.20 |
| One keep-alive (re-read the cached prefix; a read resets the TTL) | $0.09 |
| Compact before it expires | ~$0.87, plus detail lost to the summary |

A few minutes before the cache expires (2.5 min on the 1-hour TTL, 45 s on the 5-minute one), the `smart` strategy:

1. Sends keep-alives while they cost less than compacting would, counting lost detail as `compactPenaltyUsd`. It stops after `maxIdleHours`.
2. Then compacts while the cache is still warm.
3. Leaves small sessions alone: below `minSavingsUsd` of re-cache cost, or below `minCompactTokens` of context, it never compacts.

It never compacts while the prompt holds a draft or agents are running; it sends a keep-alive to hold the cache instead. If the machine sleeps past the deadline, it marks the cache expired and does nothing. A failed action is retried twice, 20 s apart. The TTL is detected from the plan and corrected from the cache hits and misses it observes.

On statusline's line it says whether the session is ready to prompt or has gone cold: `● ready`, `· cold in m:ss` (amber in the last five minutes), `· compacts in …` when an idle compaction is near, `○ cold`, or what it is doing (`compacting`, `keeping warm`, `paused`). `/cache` shows the live figures and plan; `/cache pause`, `/cache resume` and `/cache keepalive` control it.

| Option | Default | |
| --- | --- | --- |
| `enabled` | `true` | `false` turns the mod off; `/mods` does it for all of the pack. |
| `strategy` | `smart` | `compact`: compact at the first expiry. `keepalive`: never compact. `off`: status line only. |
| `cacheTtl` | `auto` | `1h` or `5m` to override detection. |
| `minSavingsUsd` | `0.25` | Below this re-cache cost, the cache is left to expire. |
| `compactPenaltyUsd` | `0.5` | Higher keeps the cache warm longer before compacting. |
| `minCompactTokens` | `100000` | Never compacts a smaller context. |
| `maxIdleHours` | `6` | Stops keep-alives after this long idle. |
| `compactInstructions` | empty | Passed to idle compactions, like `/compact <text>`. |

Prices are list prices, so on a subscription they are API-equivalent estimates, not a bill.

</details>

<details>
<summary><b>delegate</b>: cost: hands big, specified work to a cheaper worker</summary>
<br>

Every request of the main model re-reads its whole context: at 600k tokens on Opus 5.5 that is about $0.12 a step before any work is done. A worker reads only its own small context. Claude calls `hand_off` with a task that stands alone, its kind (`read`: changes no file; `mechanical`: the task spells out every change; `build`: something is left to work out), the symbols or `file:line` places it touches (`focus`), and for edits a `check` command. The kind picks the worker, so Claude has no model to weigh: Haiku at low effort for read and mechanical work, Sonnet at medium for build work.

1. **Where it reaches.** For each focus entry the mod asks the language server for references and callers (with lsp-plus, the docs that mention it come along) and tells the worker.
2. **The worker.** A subagent, read-only for `explore`, with Edit and Write for `edit`. The call waits for it inside the tool call (one request of the main model) and returns the report with the evidence; with `background` it returns at once and the report arrives as a message. A follow-up within 50 minutes goes to the same worker, its reading still in its context.
3. **The evidence.** The diff against a git snapshot taken at the start, however the worker edited; the check command, run by the mod itself; references outside the changed files; what the work cost against the same steps on the main model.
4. **The review.** The main model judges the diff and the check, not the report.
5. **The log.** Each hand-off goes to `~/.claude/mods/delegate/log.jsonl`; `/delegate` sums it up and opens a side pane. While a worker runs, its card is drawn like a cell (the task, a row per step, the state and cost), and with eta loaded it is a row above the prompt too.

Measured on 120 Opus runs, all correct: a feature or tests cost 27–37% less handed off; lookups, traces, explanations and small edits cost more. Opus does not hand off unless told to, so ask for it as an instruction: "hand the tests to a worker". An order the mod gives works as well as yours (8 of 8 runs, 27–33% less), so when you approve a plan of 20 lines or more, delegate gives that order: plan in plan mode, approve, and a Sonnet worker builds it.

| Option | Default | |
| --- | --- | --- |
| `enabled` | `true` | `false` turns the mod off; `/mods` does it for all of the pack. |
| `readWorker` | `haiku:low` | Model and effort for `read` hand-offs. |
| `mechanicalWorker` | `haiku:low` | For `mechanical` ones. |
| `buildWorker` | `sonnet:medium` | For `build` ones. |
| `afterPlan` | `hand_off` | When you approve a plan of 20 lines or more, Claude is told to implement it through a hand-off, the plan as the worker's spec; a smaller plan it does itself. `off`: never. |
| `framing` | `hand_off` | `capability`: the same tool offered as `implement_spec(spec, check)` (measured: never used unasked either). |
| `wait` | `tool` | `tool`: the call waits for the report. `message`: it returns at once. Claude can pick either per call with `background`. |
| `review` | `inline` | `fork`: a forked review returns a verdict only. `auto`: fork for large evidence. |
| `reuseMinutes` | `50` | How long a worker stays warm for follow-ups. |
| `workerContextCap` | `60000` | A worker grown past this is not continued. |

</details>

<details>
<summary><b>lsp-plus</b>: code intelligence: the language server's answer to a symbol grep</summary>
<br>

- **The language server's answer to a symbol grep.** When grep, rg, git grep and the like look for a code symbol, lsp-plus asks the language server itself and attaches its answer to the grep's result: for a function the functions that call it, each named as it is nested (`Command.invoke (1412)`), otherwise its references, by file. Grep's own output stays for strings, comments and docs. A server still indexing gets up to 3 s, and without a whole answer there is none.
- **Servers warm from the start.** At session start each language the repository has gets one question, about its smallest tracked file, so its server has the project open before the first real one: about 1 s for Python, 4 s for TypeScript, saved later. The smallest file because Claude Code adds the problems a server reports about any file it has open to the conversation, and a near-empty file has none. A server costs memory (pyright about 440 MB, the TypeScript server up to 2 GB on a large repository) and runs until the session ends.
- **Docs in references.** `findReferences`, `goToDefinition` and `incomingCalls` also name the doc lines that use the symbol as code, which no language server indexes.
- **Docs that drift.** After an Edit or Write removes a name from the code that the docs still mention, Claude is told where, with the likely new name when it looks like a rename.
- **`/refs`** checks every doc in the repository for code names no file in the code has any more, and for links to files that do not exist.
- **A missing server said once.** Where the repository has five or more files of a language whose server does not answer, you see a line naming it, and Claude is told to offer `/lsp-plus:setup` once.
- **Markdown and SQL servers.** marksman for `.md`, postgres-language-server for `.sql`.

Measured: the grep answer cut a rename from 4.6 to 3.4 requests (−6.5% cost) and a trace from 4.3 to 3.9 (cost even), 7 runs each way, all correct; on tasks without a symbol grep it never spoke. Taken out of the pack, renames took 5.0 requests instead of 3.2 and the whole cost the same. Its warm-up once asked about click's `docs/conf.py`, whose diagnostics then reached every conversation (+4.5% on small tasks); it now asks about the smallest file of each kind, and costs nothing there. Options `answer`, `warm`, `docs` and `drift` turn those off, `enabled: false` the whole mod; `nudge` turns on an older note that only told Claude which LSP call to make (never followed in 45 notes).

</details>

<details>
<summary><b>cells</b>: flow: several edits and their check in one step</summary>
<br>

Built from 240 of the author's own Claude Code sessions (32,202 model requests). Models changed files with Python, sed or perl through Bash 5,996 times, against 2,720 Edit and Write calls: cheap, but the person sees no diff and `/rewind` cannot restore it. Requests that needed no judgment (a check run alone right after edits, one edit per request twice in a row, the same command again) cost about 2% of the spend.

- **`run_cell`** runs a short JavaScript program whose calls are real Read, Edit, Write, Bash and LSP calls, with the usual permissions; edits show as diffs and can be rewound:
  - several edits and their check in one step, instead of a script;
  - `refs(path, name)` and `defn(path, name)`, each place with its line, without loading the LSP tool;
  - `rename(path, name, newName)`, every reference the language server lists, edited through Edit, with where the old name still appears as text for Claude to judge.
- **Background.** `run_cell({ code, background: true })` returns at once and the report arrives as a message when the cell ends; ctrl+enter on a running cell moves it to the background the same way, Esc stops it after the call that is running. Inside a cell, `sh(command, { background: true })` starts Claude Code's own background task.
- **The chaining guidance**, a system-prompt section: what you already need in one call, known edits in one response with their check after them. In a [pilot](benchmarks/cells-pilot/) it cut Haiku's requests by 18% on small tasks.
- **Notes after the fact.** When a request did no more than a check right after edits, a second single edit in a row, or the same command again, the tool result gets one line: what the request re-read and how to save it. At most four per kind, spaced apart. Nothing is blocked.
- **Where it runs.** A cell acts only through Claude Code's tools, which your permissions and auto mode judge one call at a time; its runner is shut in so it has no other way out. On macOS that is Seatbelt, on Linux bubblewrap, and anywhere else Node 25 or later, whose permission model closes the network by itself (signals stay open there, and each cell's report says so on its first line). Where none of them is there, Linux on Node 22 without bubblewrap for one, cells does not run: you see a line saying why and what would fix it, Claude is told to offer the fix once, and `/cells:setup` does it with you. Tested on macOS and in Linux containers (bubblewrap on Node 22; Node 25 without it); Windows is untested.

| Option | Default | |
| --- | --- | --- |
| `enabled` | `true` | `false` turns the mod off; `/mods` does it for all of the pack. |
| `mode` | `cells` | `nudge`: the guidance and the notes, no tool. `off`: nothing. |
| `nudges` | `true` | The notes. |
| `visuals` | `true` | Cells drawn as live cards. |

</details>

<details>
<summary><b>eta</b>: interface: jobs with a percentage and a finish time above the prompt</summary>
<br>

- **Background shell jobs** show above the prompt with how long they have run, as soon as Claude starts one.
- **`track_progress`** adds a percentage and an estimated finish time, read live from the job's output: a pattern counted against a total, a progress line, or the common bars (tqdm, pytest, cargo, `[3/10]`) without one. Before the progress is measurable, Claude's own guess stands in, marked as such.
- **What has run is done with.** A finished job shows its full gauge for a beat and leaves; a failure stays in red until you write again. Columns keep their widths while the numbers change.
- **Phone and IDE** get the same news as status text, and the tool's reply stays readable there. A terminal session watched over Remote Control (`/rc`) shows only that reply, as of Claude Code 2.1.296.

</details>

## How they fit together

The mods never import each other. Each finds the others through Claude Code itself (a tool in the tool list, a note on a tool's result) and works alone when they are missing.

- **statusline is the line the others write on.** smart-compact adds its `● ready · cold in 44m` through `$.statusline.set(...)`, a segment whose countdown statusline counts; without statusline, smart-compact says the same in Claude Code's own status text.
- **lsp-plus answers a symbol grep from the language server** before Claude takes another step, and warms each language's server at session start, so cells' `refs()` and delegate's look at where a change reaches meet a warm server too.
- **lsp-plus enriches the language server's answers** (the docs that use a symbol) for whoever asks: delegate before a hand-off, cells' `refs()`, `defn()` and `rename()`.
- **Edits made in a cell go through the Edit tool**, so lsp-plus's check for docs that still use a removed name runs on them, and the notes other mods attach to a cell's calls come back in the cell's report.
- **smart-compact keeps long sessions' caches warm**, where delegate and cells pay most: both save model requests, and every request re-reads the whole context.
- **eta shows background shell jobs**, including those a cell starts; delegate shows its own workers in its card and pane.

### What makes the cut

A mod joins the pack when:
- it was measured ([`benchmarks/`](benchmarks/)) and cost no quality: every graded run stays correct;
- it saves cost or time, or makes the work more reliable (cells' edits keep a diff and `/rewind` where a script would not), or only adds interface;
- it works with the other mods and without them, and each of its behaviours can be switched off;
- it stays quiet where it has no proof: on a task it cannot help with it adds nothing to the conversation, and a note Claude does not act on is switched off.

## Language servers

`/lsp-plus:setup` does this for the repository you are in. By hand: Claude Code's LSP tool, which lsp-plus, delegate and cells build on, needs the official LSP plugins (`claude plugin install <plugin>@claude-plugins-official --scope user`) and their servers on the `PATH`:

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

Each mod is a folder: `.claude-plugin/plugin.json`, `hooks/hooks.json` and a hooks module (`hooks/register.tsx`). Run Claude Code with one loaded from its folder, or list folders in `CLAUDE_CODE_PLUGIN_DIRS` (separated by `:`) so a saved edit reloads in a running session:

```sh
claude --plugin-dir ./cells
claude plugin validate cells   # manifest, hooks, everything the engine would refuse
claude plugin test cells       # its *.test.ts files, run against the engine
```

Claude Code writes the API types into `<mod>/.claude-plugin/types/` whenever it loads a mod; that folder is git-ignored, so `tsc -p <mod>` works once the mod has loaded. What decided each mod's shape is in [`benchmarks/`](benchmarks/), with the harness to run it again.

## License

MIT, see [LICENSE](LICENSE).
