---
name: setup
description: Set up the whole claude-modpack with the person, step by step - check Claude Code, the system and what is installed; ask which optional parts they want (route, where the status line goes); set up each mod in order through its own setup steps; confirm each after one restart; end with what is on, what is off and why.
disable-model-invocation: true
---

Set up the claude-modpack with the person. The pack is the `modpack` plugin (it installs the others, `/mods` turns each on or off, it keeps itself up to date, and its hook guard stops another plugin's hanging hook from freezing Claude Code) and eight mods: statusline, smart-compact, delegate, cells, eta, seek, draft, route. Each mod has its own setup skill, which the person can also run alone (`/statusline:setup`, `/delegate:setup`, …). This one walks through all of them in the right order, with one restart, and ends with a summary.

## How to run this setup

- The mods' setup skills can only be started by the person: you cannot call them with the Skill tool. Read each one's file and follow it (step 4 says where).
- Ask the person's choices once, together (step 3), not one question per mod.
- Ask before installing anything, and before anything that needs sudo.
- Never handle an API key: route's own skill has the rules, and they hold here too.
- Keep a running table as you go (mod, state, why, what is left). It becomes the summary.

## 1. Check Claude Code, the system and the project

Run these and read the answers:

- `claude --version`: for example `2.1.301 (Claude Code)`. The pack was tested on 2.1.296 to 2.1.301. Claude Code's docs give 2.1.287 as the first version that runs mods at all; anything older than 2.1.296 is untested. If it is older, suggest `claude update` first.
- `uname -s`: `Darwin` (macOS) or `Linux`. On Windows say plainly that the pack is untested there, and go on only if the person wants to.
- `node --version`: cells needs 22.13 or later on the `PATH` Claude Code starts with (or 25 or later on Linux without bubblewrap).
- `git --version`, then in the project `git rev-parse --is-inside-work-tree` (`true`) and `git log -1 --oneline` (a commit). delegate diffs against git.
- Whether an organization manages Claude Code here: `test -f "/Library/Application Support/ClaudeCode/managed-settings.json" && echo managed` on macOS, `test -f /etc/claude-code/managed-settings.json && echo managed` on Linux. That file is one sign, not the only one; ask if unsure. Where Claude Code is managed, some events do not reach plugins a person installs: the modpack's hook guard does not run, and each mod's skill names what else it loses.
- Where the person runs Claude Code: the terminal, the desktop app (in auto mode or manual), or a session hosted on the phone or in an IDE. Ask if you do not know. In the desktop app's auto mode, delegate cannot start workers, so delegate's hand-offs and route do nothing useful there.

## 2. Check what is installed

`claude plugin list --json`. For each of `modpack`, `statusline`, `smart-compact`, `delegate`, `cells`, `eta`, `seek`, `draft` and `route` there should be an entry `<name>@claude-modpack` with `"enabled": true`; note its `installPath`.

- **A mod missing**: `claude plugin install <name>@claude-modpack` (ask first). Installing `modpack` installs all eight as its dependencies.
- **lsp-plus still installed** (`lsp-plus@claude-modpack`): it left the pack in 0.7.0, and the modpack removes it once at its first start. If it is still there, the person installed it again on purpose; leave it unless they want it gone (`claude plugin uninstall lsp-plus@claude-modpack`).
- **A mod disabled**: `claude plugin enable <name>@claude-modpack`.
- **A copy loaded from a folder** (`<name>@inline`, scope `session`, from `--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`): it takes the installed one's place in that session, and its options live under `pluginConfigs["<name>"]` instead. Fine for developing a mod; say so and use the folder as its `installPath`.
- **The newest release**: the person can type `/modpack:update`; it installs a newer release if there is one (loaded at the next start).

The person can also type `/mods`: it lists the eight with `on`, `off` or `not installed`. `route: off` is expected: route is off until they turn it on.

## 3. Ask the choices, once

Gather what makes the questions concrete first: whether cells has a sandbox here (cells' skill, its step 1). Then ask in one message, with the default for each, and take the default for anything the person skips:

1. **Where they run Claude Code**, if you do not know yet.
2. **Where the status line goes**: `line` under the prompt (default), `tail` appended to Claude Code's hint, `band` above the prompt, or `off`. And the plan's 5-hour and 7-day windows: `always` (default), `half`, or `off`.
3. **cells' sandbox**, only if it is missing: the one fix you suggest, saying if it needs sudo.
4. **route**, an optional mod, off unless they want it, and the only one that needs an outside classifier model: an API key for TypeSafe's Jev or ScaleDown (US services), which the person gets from that service. Say in two sentences what it does and what it sends: when on, each prompt they send (its first 8,000 characters, so usually all of it) goes to that classifier, and feature or test requests are then handed to delegate's cheaper worker. Say what it is worth: in the author's real sessions about 3 to 6% of the spend (the turns it hands off were 13% of it), more for someone who mostly builds features, less for someone who plans in plan mode (delegate already hands approved plans over). If they are interested, route's own consent step comes later, on its own, with the details. Advise against it in the desktop app's auto mode.
5. **Updates**: `auto` (default: once a day the pack asks GitHub for a new release and installs it in the background, loaded at the next start), `notify` (only say one is out), or `off` (no network request).
6. **The hook guard**, only if they use a hook that waits for them on purpose (approving from the phone, say): then `hookGuard` off. Otherwise leave it on.

## 4. Set up each mod, in order

For each mod, read `<installPath>/skills/setup/SKILL.md` and do its checking and setting steps with the answers from step 3, without asking the same questions again. Leave each one's "Confirm" step for step 6, and collect every "restart Claude Code" into the one restart of step 5. The order, and why:

1. **statusline**: the others draw on its line. Set the placement and the windows if they differ from the defaults.
2. **smart-compact**: draws on statusline's line. Usually nothing to set.
3. **eta**: nothing to set.
4. **cells**: the sandbox fix, if one was chosen.
5. **delegate**: check where it can start workers (step 1). Before route: route acts only through delegate's `hand_off` tool.
6. **seek**: nothing to set. Its setting to look around in few, lean steps rides beside the person's prompts from the first one; its map stays off unless the person asks for it.
7. **draft**: nothing to set. It acts only on a prompt that sets a word limit.
8. **modpack's own options**: `updates` and `hookGuard`, if they differ from the defaults: `/config modpack.updates=notify` (typed by the person), or `/plugin configure modpack@claude-modpack`.
9. **route**, only if the person wants it: its consent step in full, a classifier, and the key, stored by the person (never through you). Do not turn it on yet: that waits for delegate's hand-off to work (step 5). If the person stores the key from a terminal, it is read at the next start, so do this before the restart.

How options are set, for any mod: `/mods <mod> on|off` for the switch; `/plugin configure <mod>@claude-modpack` for a dialog; `/config <mod>.<option>=<value>` typed; or by hand in `~/.claude/settings.json` under `"pluginConfigs": { "<mod>@claude-modpack": { "options": { … } } }` (user settings only; Claude Code ignores this key in project settings). Sensitive values (route's keys) never go in that file. A change made inside the session reloads the mod at once; a change in the file, or from another terminal, at the next start.

## 5. Restart once

If anything in step 4 needs it (a cells fix, a key set from a terminal), tell the person to quit Claude Code and start it again with `claude --continue`, which keeps this conversation and these steps; in the desktop app, reopen this session. Then they say "continue", and you go on with step 6. If nothing needed it, go straight on.

## 6. Confirm each, in order

Use each mod's own "Confirm" step; in short:

1. **The pack**: the person types `/mods`; all eight installed, each `on`, route `off` unless chosen.
2. **statusline**: ask what they see under the prompt (or above it, in the band or the desktop app).
3. **smart-compact**: the person types `/cache`; its first line names the strategy and the cache's lifetime.
4. **eta**: a 30-step background job and `track_progress`; the person sees a row above the prompt with a percentage and a finish time.
5. **cells**: `run_cell` with `return 1`, then one with an `sh` call.
6. **delegate**: one small read hand-off; the result says Verified or Not verified after the worker's report.
7. **seek**: look for "The person's setting for looking around in this session" beside one of the person's prompts in this conversation (one of 20 characters or more, such as their answer to step 3, carries it once seek is loaded). If none has it yet, it comes with their next such prompt: look then, and say whether it arrived.
8. **draft**: the person sends a short writing request with a limit ("Write notes/draft-check.md: three sentences on what this project does, at most 60 words."); look for "The person's setting for writing to a length" beside that prompt, then for the word count on the Write result of the `.md` file. Say whether both came, and delete the file if they do not want it.
9. **route**, if chosen and delegate worked: the person types `/mods route on`; their next feature or test request (40 characters or more) comes with the order to hand it off. Look for it then, and say whether it arrived.

Where a check fails, the mod's skill says what each failure means. Fix what can be fixed with the person; otherwise record why it is off and what is left.

## 7. Summarize

End with a short table and nothing after it but what is left for the person:

| Mod | State | Why, or what is left |
| --- | --- | --- |
| statusline | on, `line` | |
| smart-compact | on, `smart` | |
| eta | on | |
| cells | on, Seatbelt | (or bubblewrap, or Node's sandbox only: signals open) |
| delegate | on | (or: refused in the desktop app's auto mode) |
| seek | on | the setting arrived with a prompt |
| draft | on | the setting and the word count arrived on a prompt with a limit |
| route | off | the person chose off (or: on with Jev, the order arrived) |
| modpack | updates `auto`, hook guard on | |

## Turning it off, or removing it

- One mod, at once and kept across updates: `/mods <mod> off`. This is the lasting way while the pack stays installed: when the modpack installs a new release, it also installs any of its mods that is missing.
- The whole pack: first `/mods route off` and clear route's key in `/plugin configure route@claude-modpack` if one was set. Then `claude plugin uninstall modpack@claude-modpack --prune` removes the modpack and the mods it installed as its dependencies (it asks to confirm; add `-y` where there is no terminal to ask in). A mod the person installed on its own stays until `claude plugin uninstall <mod>@claude-modpack`. The marketplace: `claude plugin marketplace remove claude-modpack`.
- Left behind on purpose: any language servers and official LSP plugins (other tools use them too), `~/.claude/mods/` (delegate's log, the update check's state), and the mods' entries under `pluginConfigs` in `~/.claude/settings.json`; remove those by hand if wanted.
