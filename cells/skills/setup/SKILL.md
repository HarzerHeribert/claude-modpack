---
name: setup
description: Turn cells on where it is off, by giving its runner a sandbox that closes the network (Seatbelt on macOS, bubblewrap on Linux, or Node 25 or later anywhere), and prove it with a one-line cell. Run when Claude Code says "cells is off", or after installing the modpack or cells.
disable-model-invocation: true
---

Turn the cells mod on for this machine. cells gives Claude `run_cell`: a short JavaScript program whose calls are real Read, Edit, Write, Bash and LSP calls, so several edits and their check take one step, and each edit still shows as a diff that `/rewind` can undo. A cell acts only through Claude Code's tools, which ask the person (or auto mode) one call at a time; its runner must have no other way out. cells runs only where something closes the network to that runner:

- **macOS**: Seatbelt, built in. Nothing to install.
- **Linux**: bubblewrap (`bwrap`), on any Node 22.13 or later.
- **Linux, Windows**: Node 25 or later, whose permission model closes the network by itself. Signals stay open there (a cell that escaped could stop another of the person's processes, never read or send anything); each cell's report says so.

Tested on macOS and in Linux containers (bubblewrap on Node 22; Node 25 without it). Windows is untested: say so if the person is on it.

## 1. Find out what is there

Run these and read the answers before suggesting anything:
- `node -p "process.platform + ' ' + process.versions.node + ' ' + process.execPath"`: the node Claude Code runs cells with. It must be 22.13 or later in any case. cells uses the first `node` on the `PATH` Claude Code started with; a node that only an interactive shell's profile puts first may not be the one.
- On macOS: `test -x /usr/bin/sandbox-exec && echo ok` prints `ok` (Seatbelt's launcher).
- On Linux: `command -v bwrap`, then whether it can start a sandbox: `bwrap --unshare-all --ro-bind / / true; echo $?`. On failure its message says why, most often "No permissions to create new namespace".
- On Linux: `cat /etc/os-release` (Ubuntu 24.04 and later restrict user namespaces through AppArmor), and whether this is a container (`/.dockerenv`, or `container` in `/proc/1/environ`).
- Whether the person saw `cells is off: <why>. To turn it on, <fix>, or run /cells:setup.` at the start of a session: its reason is the one to fix.

## 2. Pick the smallest fix, ask once, then do it

On macOS with a recent enough node there is nothing to fix: go to step 4.

Otherwise show the person what you found and the one fix you suggest, with its commands. Installs change their machine and some need sudo, so ask once before running any of it.

- **Node older than 22.13, or no node on the `PATH`**: install a current Node through whatever manages Node there (`brew install node`, `nvm install 22`, `fnm install 22`, the system's package manager), and make it the `node` first on the `PATH`.
- **Linux, bubblewrap missing**: `sudo apt install bubblewrap` (Debian, Ubuntu), `sudo dnf install bubblewrap` (Fedora), `sudo pacman -S bubblewrap` (Arch).
- **Ubuntu 24.04 or later, bwrap installed but refused**: give bwrap an AppArmor profile that allows user namespaces, in `/etc/apparmor.d/bwrap`:
  ```
  abi <abi/4.0>,
  include <tunables/global>

  profile bwrap /usr/bin/bwrap flags=(unconfined) {
    userns,
    include if exists <local/bwrap>
  }
  ```
  then `sudo apparmor_parser -r /etc/apparmor.d/bwrap`. Claude Code's own sandbox needs the same on these systems.
- **A container** (Docker's default seccomp profile refuses user namespaces): Node 25 or later is the simpler fix than loosening the container.
- **Windows, or Linux where bubblewrap is not wanted**: Node 25 or later, through whatever manages Node there (`nvm install 25`, `fnm install 25`, `brew install node`, `winget install OpenJS.NodeJS`). It has to be the `node` first on the PATH Claude Code starts with.

## 3. Options

Most people change none. `/mods cells off` turns the whole mod off at once. Others: `/plugin configure cells@claude-modpack`, or typed, `/config cells.mode=nudge`, or by hand in `~/.claude/settings.json` (user settings only) under `"pluginConfigs": { "cells@claude-modpack": { "options": { … } } }`. A change inside the session applies at once; in the file, at the next start.

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want none of cells. |
| `mode` | `cells` | `nudge`: the chaining guidance and the notes, without the `run_cell` tool. `off`: nothing. |
| `nudges` | `true` | You do not want the one-line notes after a request that a cell or one response could have saved. |
| `visuals` | `true` | You prefer cells as plain tool calls rather than live cards. |
| `subagents` | `true` | `false`: a subagent Claude starts no longer gets the chaining guidance with its task. It has a system prompt of its own, which the guidance never reaches; forks, teammates and delegate's workers never get it. |

## 4. Confirm

cells decides at session start, so after a fix tell the person to restart Claude Code (`claude --continue` keeps this conversation). In the new session the "cells is off" line no longer appears, and your tool list has `run_cell` (from the cells mod). Then:

1. Run a one-line cell: `run_cell` with `code: "return 1"`. The report:
   ```
   cell · 0 calls · 0.1 s
   ## Output
   1
   ```
   Under Node's sandbox alone its first line ends with ` · Node's sandbox only: signals open`.
2. Run a cell with one real call: `const r = await sh('git --version'); return r.out`. The report lists one call with `✓` and the git version under `## Output`; the Bash call is judged by the person's permissions like any other.

The person sees each cell as a card with its program and one row per call (with `visuals` on).

What each failure looks like:
- **No `run_cell` tool and a `cells is off: …` line**: the sandbox is missing (step 2), or `no node on the PATH Claude Code runs with`.
- **No `run_cell` tool and no line**: `mode` is `nudge` or `off`, or the mod is not loaded (`claude plugin list`).
- **`cells is turned off (/mods turns it on).`**: the mod is off.
- **`## Error` with `the runner ended without a result`** and the runner's error text: the sandbox refused the runner. Show the text; on Linux check bwrap again (step 1).

End with one line: what was done, and whether cells will run with an OS sandbox or with Node's alone.

## 5. When it does not work

- **An organization manages Claude Code here**: the `prompt.compose` event does not reach plugins a person installs (`claude plugin validate` names it), so the chaining guidance and the "cells is off" note do not reach Claude; `run_cell` itself works.
- **Node changed since the session started**: cells chose its sandbox at session start; restart.
- **A cell's edits do not show as diffs**: they do when made with `edit()` and `write()` in the cell; a file rewritten by `sh('sed …')` does not, as with any Bash call.

## 6. Turn it off, or remove it

- Off, at once and kept across updates: `/mods cells off`. On again: `/mods cells on`.
- Removed: `claude plugin uninstall cells@claude-modpack`. While the modpack stays installed, its next release installs any missing mod again, so turning it off is the lasting way.
- A cell's working files sit in the system's temp folder under `claude-cells/`, one folder per session.
