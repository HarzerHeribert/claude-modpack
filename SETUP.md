# Setting up claude-modpack

This guide sets the pack up by hand, step by step. In Claude Code, `/modpack:setup` does the same with you: it checks, asks what you want once, sets each mod up, and confirms each one works. Each mod also has its own setup, such as `/cells:setup`.

You type the commands shown as `/...` into Claude Code's prompt; the others go into a terminal.

## 0. What you need

| | Needed for | Check | Expect |
| --- | --- | --- | --- |
| Claude Code 2.1.296 or later | everything | `claude --version` | `2.1.296 (Claude Code)` or higher. Tested on 2.1.296 to 2.1.312. Older: `claude update`. |
| macOS or Linux | everything | `uname -s` | `Darwin` or `Linux`. Windows is untested. |
| git | delegate's diffs | `git --version` | any recent version; your project is a git repository with at least one commit |
| Node 22.13 or later | cells; language servers installed with npm, if you want them | `node --version` | `v22.13.0` or higher. On Linux without bubblewrap, `v25` or higher (see step 5). |
| Homebrew (macOS) | most language servers, if you want them | `brew --version` | any version |

If an organization manages Claude Code on your machine (on macOS a file `/Library/Application Support/ClaudeCode/managed-settings.json`, on Linux `/etc/claude-code/managed-settings.json`, or settings your administrator pushes), some events do not reach plugins you install yourself. The hook guard then does not run, and a few parts of other mods neither; each section below says which.

## 1. Install

In Claude Code:

```
/plugin install modpack --marketplace HarzerHeribert/claude-modpack
```

Answer `y` to add the marketplace, then pick where to install it (your user scope is the usual choice). Or from a terminal:

```sh
claude plugin marketplace add HarzerHeribert/claude-modpack
claude plugin install modpack@claude-modpack
```

Installing `modpack` installs all eight mods as its dependencies. Restart Claude Code, then check:

- `claude plugin list` shows `modpack@claude-modpack` and the eight mods (`statusline`, `smart-compact`, `delegate`, `cells`, `eta`, `seek`, `draft`, `route`), each `✔ enabled`.
- `/mods` lists the eight, each `on`, except `route: off`: route stays off until you turn it on.
- Coming from 0.6 or older: `lsp-plus@claude-modpack` is gone after the modpack's first start on 0.7.0, which removes it once and says so (it left the pack; the README's questions say why).

## How options work

Every mod has an `enabled` switch and some have more options. Ways to change them:

- `/mods <mod> on` or `/mods <mod> off`: the switch, at once. `/mods` alone opens a pane with a button per mod.
- `/plugin configure <mod>@claude-modpack`: a dialog with all of a mod's options.
- `/config <mod>.<option>=<value>`, typed, for example `/config statusline.placement=band`.
- By hand, in `~/.claude/settings.json` (your user settings; Claude Code ignores this key in a project's settings):
  ```json
  {
    "pluginConfigs": {
      "statusline@claude-modpack": { "options": { "placement": "band" } },
      "smart-compact@claude-modpack": { "options": { "strategy": "keepalive" } }
    }
  }
  ```

A change made inside Claude Code applies at once. A change made in the file, or with `claude plugin configure` in a terminal, applies at the next start. API keys (route's) are never in that file: Claude Code keeps them in secure storage. A mod loaded from a folder (`--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`) shows as `<mod>@inline` in `claude plugin list`, and its options sit under `"<mod>"` instead of `"<mod>@claude-modpack"`.

The README lists [every option of every mod](README.md#the-mods-in-depth).

## 2. statusline: the line under the prompt

Nothing to install. Choose where the line goes, if not under the prompt:

| `placement` | |
| --- | --- |
| `line` (default) | one line under the prompt, sharing Claude Code's hint row |
| `tail` | appended dim to Claude Code's hint |
| `band` | above the prompt |
| `off` | nowhere (other mods' segments then show nowhere either) |

`limits` (`always`, `half`, `off`) decides when the plan's 5-hour and 7-day windows show; `animate` the highlight that moves along the gauge while Claude works.

**Check**: after Claude's first answer, in the terminal, you see something like

```
⏵⏵ auto mode on       Opus 5.5 xhigh   412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d   ● ready · cold in 44m
```

the model and its effort, the context against the auto-compact point, the plan's windows (on a subscription; with an API key expect none), and smart-compact's segment. In the desktop app the line sits above the prompt and shows only what needs you, so it is often empty. On the phone or in an IDE it is the session's status text. A terminal session watched over Remote Control (`/rc`) shows none of it, as of Claude Code 2.1.296.

**If not**: `/mods` shows `statusline: off`, or `placement` is `off`.

## 3. smart-compact: an idle session's cache

Nothing to install. When a session sits idle, its prompt cache expires (1 hour on a subscription, 5 minutes in overage or on an API key), and the next prompt pays to write the whole context again. A few minutes before that, smart-compact sends a small keep-alive request or compacts the session, whichever costs less. On a subscription its keep-alives count against your plan's limits.

| `strategy` | |
| --- | --- |
| `smart` (default) | keep the cache warm while that is cheaper, then compact before it expires |
| `compact` | compact at the first expiry |
| `keepalive` | never compact |
| `off` | only show whether the cache is ready or cold |

**Check**: `/cache`. Its first line reads `smart-compact · smart · <model> · TTL 1h (…)`; after an answer, statusline's line ends with `● ready`. `/cache pause` and `/cache resume` hold it for one session.

**If not**: `/cache` is unknown when the mod is off or not loaded. Where an organization manages Claude Code, a resumed session starts without its cache state; the rest works.

## 4. eta: progress above the prompt

Nothing to install, no options but its switch. **Check**: ask Claude to "run a 30-second loop in the background that prints step 1 of 30 to step 30 of 30, and track its progress". A row appears above the prompt with a bar, a percentage and a finish time, and leaves when the job ends.

## 5. cells: several edits and their check in one step

cells' runner must be shut in so it has no way out but Claude Code's own tools. It needs one of:

| System | Sandbox | To do |
| --- | --- | --- |
| macOS | Seatbelt, built in | nothing (`test -x /usr/bin/sandbox-exec && echo ok` prints `ok`) |
| Linux | bubblewrap, on Node 22.13 or later | `sudo apt install bubblewrap` (Debian, Ubuntu), `sudo dnf install bubblewrap` (Fedora), `sudo pacman -S bubblewrap` (Arch) |
| Linux without bubblewrap, a container, or Windows | Node 25 or later, whose permission model closes the network; signals stay open, and each cell's report says so | install Node 25 or later and make it the first `node` on the `PATH` Claude Code starts with |

On Linux, check that bubblewrap can start a sandbox: `bwrap --unshare-all --ro-bind / / true; echo $?` prints `0`. On Ubuntu 24.04 and later it may be refused ("No permissions to create new namespace"); give bwrap an AppArmor profile in `/etc/apparmor.d/bwrap`:

```
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
```

then `sudo apparmor_parser -r /etc/apparmor.d/bwrap`. In a container (Docker's default seccomp profile refuses user namespaces), Node 25 or later is the simpler fix. Tested on macOS and in Linux containers; Windows is untested.

cells decides at session start: restart Claude Code after a fix.

**Check**: the line `cells is off: …` no longer appears at the start of a session. Ask Claude to "run a cell that returns 1". Its report reads `cell · 0 calls · 0.1 s`, then `## Output` and `1`; under Node's sandbox alone the first line ends with `· Node's sandbox only: signals open`.

**Options**: `mode` (`cells`; `nudge` gives the guidance and notes without the tool; `off`), `nudges`, `visuals`, `subagents` (the chaining guidance in a subagent's task; on), `autoModeLine` (one line in auto mode's note on shell edits; on).

## 6. Language servers, if you want them, for cells and delegate

Optional. cells' `refs()`, `defn()` and `rename()` and delegate's look at where a change reaches use Claude Code's LSP tool where a language has a server, and a text search where it has none. A server runs as long as its session and costs memory, hundreds of MB per language (pyright about 440 MB, the TypeScript server up to 2 GB on a large repository); since 0.7.0 nothing in the pack starts one by itself.

Claude Code's LSP tool needs, per language, an official LSP plugin and its server on the `PATH`. Find your project's languages: `git ls-files | sed -n 's/.*\.//p' | sort | uniq -c | sort -rn | head -20`. For each one you want:

```sh
claude plugin install <plugin>@claude-plugins-official --scope user
```

and install its server; [Language servers](README.md#language-servers) in the README has the table of plugins and install commands. Then restart Claude Code.

What goes wrong:
- **TypeScript 7** ships no `tsserver.js`: install `typescript@6` beside `typescript-language-server`, even if the project uses 7.
- **npm `EACCES`**: `npm config set prefix ~/.local` and put `~/.local/bin` on the `PATH`, rather than installing as root.
- **ruby-lsp** exits at start (code 78) in a project with a `Gemfile` and no `Gemfile.lock`: run `bundle lock` first.
- **kotlin-lsp**: JetBrains' formula's download failed when we tried (15 October).
- **csharp-ls** 0.18 needs .NET 9.
- **clangd from Homebrew's llvm** is not on the `PATH` by itself: add `$(brew --prefix llvm)/bin`.
- A server on a `PATH` that only your interactive shell sets (`.zshrc`) may be invisible to Claude Code started elsewhere: prefer `~/.local/bin`, `/opt/homebrew/bin` or `/usr/local/bin`.
- **A Python project with large git-ignored folders** (checkouts, build trees): pyright reads every `.py` file under the project unless told otherwise, git-ignored ones included. A `pyrightconfig.json` whose `exclude` lists them keeps it to what git tracks (in our lab repository: 3.5 GB down to 247 MB).

**Check**: ask Claude to "run a cell that calls `refs` for a function this project defines and calls from another file". The cell's report lists the places, each with its file and line.

## 7. delegate: a cheaper worker for big, specified work

Nothing to install. It starts its worker (Haiku for read and mechanical work, Sonnet for build work) where Claude Code lets a mod do so:

- **Terminal**: in every permission mode, auto mode included.
- **Desktop app**: in manual permission mode. In auto mode it is refused: Claude says "Not handed off" and does the work itself.

**Check**: ask Claude to "hand this to a worker: find where `<name>` is defined and every place that calls it". While it runs you see a card with the worker's steps (and with eta a row above the prompt). The result Claude gets starts with the worker's report, then a line like `Hand-off 1 (explore) ended: haiku low · 3 requests · 14s · $0.0040; …` and `Verified: all … places checked in the code`. `/delegate` sums up every hand-off from its log (`~/.claude/mods/delegate/log.jsonl`).

**Options**: `afterPlan` (`hand_off`: an approved plan of 20 lines or more is built by the worker; `off`), `readWorker`, `mechanicalWorker`, `buildWorker` (`model:effort`, defaults `haiku:low`, `haiku:low`, `sonnet:medium`), `wait`, `review`, `framing`, `reuseMinutes`, `workerContextCap`.

## 8. seek: looking around in few, lean steps

Nothing to install, and nothing leaves your machine. Every request re-reads the whole conversation, and whatever Claude reads stays in it, re-read by every later request until a compaction. So beside your prompt seek adds your setting to look around in few, lean steps: the searches and reads Claude can already name in one command, definitions or line ranges rather than whole files, and nothing read again that the session already holds. It comes with the first prompt of a session (20 characters or more, not a slash command), and again after a compaction or once the context has grown by another 150k tokens.

**Check**: send a question about your project of 20 characters or more and, in the same prompt, ask Claude whether seek's setting came with it. It reads `The person's setting for looking around in this session (about …k tokens of context so far): … So look around in few, lean steps: …`.

**If not**: `/mods` shows `seek: off`; `order` is off; `orderFrom` is above the session's context; or it already came earlier in this session (it comes again only after a compaction or another 150k tokens).

**Options**: `order` (on), `orderFrom` (`0`: from the first prompt; `150000` keeps it out of small sessions), `map` (off: past `minContext`, 150k, a code search's result also names the definitions that hold its hits; measured, it saved nothing certain), `laterRequests` and `saveRate` (how the map is priced).

## 9. draft: writing to a word limit in one draft

Nothing to install, and nothing leaves your machine. Asked for at most 700 words, Claude tends to write the whole text, count it, find it a third over, and write the whole text again, several times; every rewrite costs the whole text in output and stays in the conversation. draft acts only once a prompt sets a word limit ("at most 700 words", "under 250 words", "a 150-word summary", "höchstens 400 Wörter"). Beside that prompt it adds your setting for writing to a length: give each part its share of the words and aim for about 85% of the limit, keep every fact the request asks for and cut wording, and if those facts cannot all fit, keep them and say how far over it runs; a draft still well over is written once more to each section's target, not cut down in rounds. After each Write or Edit of a Markdown or text file, one line gives its words as `wc -w` counts them, and each section's target when it is more than a tenth over. Without a limit it does nothing.

**Check**: send a short writing request with a limit, for example "Write notes/draft-check.md: three sentences on what this project does, at most 60 words." and, in the same prompt, ask Claude whether draft's setting came with it. It reads `The person's setting for writing to a length (60 words here)`. After the write, the Write result carries a line such as `notes/draft-check.md: 52 words (as wc -w counts), within the 60 the prompt allows.`

**If not**: `/mods` shows `draft: off`; `order` is off (no setting beside the prompt) or `gauge` is off (no word count); the prompt states the length in a form draft does not read (it reads "at most N words", "under N words", "N words or fewer", "a N-word …", "höchstens N Wörter" and similar); the file is not Markdown or text (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc`); or no prompt in the session set a limit.

**Options**: `enabled` (on; `/mods draft off` does the same at once), `order` (on: the setting beside a prompt with a limit), `gauge` (on: the word count after each write).

## 10. route: optional, needs an outside classifier

route is an optional mod, off until you turn it on, and the only one that needs an outside classifier model: an API key for TypeSafe's Jev or ScaleDown, which you get from that service. In real sessions it is worth about 3 to 6% of the spend for someone who works like the author (the README's "Optional: feature work goes to the cheaper model by itself" says how that was measured), more if you mostly build features. When on, the first 8,000 characters of each prompt you send (typed, from the phone, or `claude -p`; not slash commands or replies under 40 characters), which for most prompts is the whole prompt, go to an outside classifier, TypeSafe's Jev or ScaleDown, both US services. TypeSafe keeps inputs as long as it needs them and never trains on them; ScaleDown's terms promise zero retention. Each prompt starts about 0.3 s later with Jev, about 1 s with ScaleDown, at most 3 s. Only feature or test requests then get the order to hand the work to delegate's worker. Leave it off if you work in the desktop app's auto mode, where delegate cannot start workers.

1. Make sure delegate works (step 7). route acts only through delegate's `hand_off` tool.
2. Get a key from the service: Jev ([docs](https://docs.typesafe.ai/introduction/quickstart)) or ScaleDown ([docs](https://docs.scaledown.ai/api-reference/classify)). Never paste it into a conversation with Claude.
3. Store it. Best: `/plugin configure route@claude-modpack`, and fill `TypeSafe API key` or `ScaleDown API key`; the dialog masks it and Claude Code keeps it in secure storage (the macOS Keychain; `~/.claude/.credentials.json` where there is no keychain). From a terminal, without showing the key or keeping it in the shell's history (not tested with these fields; restart Claude Code afterwards):
   ```sh
   read -rs ROUTE_KEY && printf '{"typesafeKey":"%s"}' "$ROUTE_KEY" | claude plugin configure route@claude-modpack --values-stdin; unset ROUTE_KEY
   ```
   Paste the key and press Enter; nothing shows while you do. (`scaledownKey` for ScaleDown.) Last resort: the environment variable `TYPESAFE_API_KEY` or `SCALEDOWN_API_KEY` in the environment Claude Code starts with; a shell profile keeps it in plain text. Never in a `settings.json`.
4. Turn it on: `/mods route on`.

**Check**: send a real feature or test request of at least 40 characters, and ask Claude whether route's order came with it. The order reads `This prompt is feature work, and the person's setting for feature work is: implement it through the hand_off tool (kind build). …`. A question ("where is X defined?") gets none.

**If no order arrives**: route is off; no key is set (`claude plugin configure route@claude-modpack` lists which options are set and never prints a key); delegate is off or its `framing` is `capability`; the prompt was under 40 characters; the classifier scored it under its threshold (0.95 for Jev, 0.7 for ScaleDown, or `minScore` where you set one); or it answered after `timeoutMs` (3 s). A wrong key fails silently. To test the key itself, this sends one test sentence to the service and prints its answer, never the key (paste the key and press Enter; nothing shows; both checked with real keys on 16 Oct 2026):

```sh
# Jev: the answer should hold "choice":"feature"
read -rs K; printf 'authorization: Bearer %s\n' "$K" | curl -s -H @- -H 'content-type: application/json' -d '{"state":"Add a CSV export to the reports page","model":"jev-latest","questions":{"kind":{"type":"choice","instructions":"Which kind of request to a coding assistant is this?","criteria":{"feature":"Does this request ask to implement new behaviour or a new capability in the code?","other":"Is this request about anything that is not reading or writing code?"}}}}' https://api.typesafe.ai/v1/systemone; echo; unset K

# ScaleDown: the answer should hold "top_label":"feature"
read -rs K; printf 'x-api-key: %s\n' "$K" | curl -s -H @- -H 'content-type: application/json' -d '{"text":"Add a CSV export to the reports page","labels":[{"name":"feature","rubric":"Does this request ask to implement new behaviour or a new capability in the code?"},{"name":"other","rubric":"Is this request about anything that is not reading or writing code?"}],"reasoning":false}' https://api.scaledown.xyz/classify; echo; unset K
```

**Options**: `classifier` (`auto` takes Jev when its key is set), `direct` (hand off before Claude reads the code; on), `minScore`, `timeoutMs`.

## 11. The pack's own options

| Option | Default | |
| --- | --- | --- |
| `updates` | `auto` | Once a day the pack asks GitHub for a new release and installs it in the background; it loads at the next start. `notify`: only say one is out. `off`: no network request. `/modpack-update` updates now. |
| `hookGuard` | `true` | Another plugin's permission or notification hook that runs over 10 s no longer freezes Claude Code. Turn it off if a hook of yours waits for you on purpose, such as approving from your phone. |

Set them with `/plugin configure modpack@claude-modpack` or `/config modpack.updates=notify`.

## Turning it off, or removing it

- One mod: `/mods <mod> off`, at once, and it stays off across updates. While the pack is installed, this is the way to keep a mod out: when the modpack installs a new release, it also installs any of its mods that is missing.
- The whole pack: first `/mods route off`, and clear route's key in `/plugin configure route@claude-modpack` if you set one. Then:
  ```sh
  claude plugin uninstall modpack@claude-modpack --prune
  claude plugin marketplace remove claude-modpack
  ```
  `--prune` also removes the mods the modpack installed as its dependencies (it asks first; add `-y` in a script). A mod you installed on its own stays until `claude plugin uninstall <mod>@claude-modpack`.
- Left behind: any language servers and official LSP plugins (other tools use them too), `~/.claude/mods/` (delegate's log, the update check's state), and the mods' entries under `pluginConfigs` in `~/.claude/settings.json`. Remove them by hand if you want.
