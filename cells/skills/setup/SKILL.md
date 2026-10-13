---
name: setup
description: Turn cells on where it is off: give its runner a sandbox that closes the network (bubblewrap on Linux, or Node 25 or later anywhere). Run when Claude Code says "cells is off".
disable-model-invocation: true
---

Turn the cells mod on for this machine. A cell is JavaScript that acts only through Claude Code's tools, which ask the person (or auto mode) one call at a time; its runner must have no other way out. cells runs only where something closes the network to that runner:

- **macOS**: Seatbelt, built in. Nothing to install.
- **Linux**: bubblewrap (`bwrap`), on any Node 22.13 or later.
- **Linux, Windows**: Node 25 or later, whose permission model closes the network by itself. Signals stay open there (a cell that escaped could stop another of the person's processes, never read or send anything); each cell's report says so.

## 1. Find out what is there

Run these and read the answers before suggesting anything:
- `node -p "process.platform + ' ' + process.versions.node + ' ' + process.execPath"`: the node Claude Code runs cells with. It must be 22.13 or later in any case.
- On Linux: `command -v bwrap`, then whether it can start a sandbox: `bwrap --unshare-all --ro-bind / / true; echo $?`. On failure its message says why, most often "No permissions to create new namespace".
- On Linux: `cat /etc/os-release` (Ubuntu 24.04 and later restrict user namespaces through AppArmor), and whether this is a container (`/.dockerenv`, or `container` in `/proc/1/environ`).

## 2. Pick the smallest fix, ask once, then do it

Show the person what you found and the one fix you suggest, with its commands. Installs change their machine and some need sudo, so ask once before running any of it.

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

## 3. Confirm

cells decides at session start, so tell the person to restart Claude Code. In the new session the "cells is off" line no longer appears, and a one-line cell (`return 1`) runs. Under Node's sandbox alone its report's first line ends with "Node's sandbox only: signals open".

End with one line: what was done, and whether cells will run with an OS sandbox or with Node's alone.
