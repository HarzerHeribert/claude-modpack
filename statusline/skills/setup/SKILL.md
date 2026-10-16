---
name: setup
description: Check that the statusline mod draws its line, pick where it goes (under the prompt, appended to Claude Code's hint, above the prompt, or nowhere), and confirm what the line shows. Run after installing the modpack or statusline.
disable-model-invocation: true
---

Set up the statusline mod with the person. It draws one line under the prompt: the model and its effort, how full the context is against the auto-compact point, the plan's 5-hour and 7-day use with when each resets, and what other mods put on it (smart-compact's `● ready` or `○ cold`). It runs inside Claude Code: there is nothing to install.

## 1. Check what is there

- `claude --version`: the pack was tested on 2.1.296 to 2.1.301. Older versions are untested; Claude Code's docs give 2.1.287 as the first that runs mods at all.
- `claude plugin list`: `statusline@claude-modpack` with `Status: ✔ enabled`. A copy loaded from a folder shows as `statusline@inline` instead; its options then live under `pluginConfigs["statusline"]` (or `["statusline@inline"]`), not under the marketplace id.
- Where the person uses Claude Code. Ask if you do not know. The line depends on it:
  - **Terminal**: one line under the prompt, sharing Claude Code's hint row (the mode indicator stays on the left).
  - **Desktop app**: it has no hint row, so the line goes to the band above the prompt, and it shows only what needs the person (another mod's segment that is not calm, such as a cache about to go cold). Nothing shows while all is well.
  - **Phone or IDE hosting the session**: no line is drawn; the same text is the session's status text.
  - **A terminal session watched over Remote Control (`/rc`)**: no line and no status text, as of Claude Code 2.1.296.

Nothing else is needed: no Node, no network.

## 2. Ask, then set

Ask the person once, showing the defaults:

- **Where the line goes** (`placement`): `line` (default), under the prompt; `tail`, appended dim to Claude Code's own hint; `band`, above the prompt; `off`, nowhere (other mods' segments then show nowhere either).
- **The plan's windows** (`limits`): `always` (default); `half`, only once a window is half used; `off`, never.
- **The moving highlight** along the gauge while Claude works (`animate`): on by default.

Most people keep the defaults; then there is nothing to set. To change one, the person picks one way:
- `/plugin configure statusline@claude-modpack`: a dialog with each option.
- Typed in the prompt: `/config statusline.placement=band` (the row key is `<mod>.<option>`).
- By hand, in `~/.claude/settings.json` (user settings only: Claude Code ignores this key in project settings):
  ```json
  { "pluginConfigs": { "statusline@claude-modpack": { "options": { "placement": "band" } } } }
  ```

A change made inside the session reloads the mod at once. A change made in the file, or with `claude plugin configure` from another terminal, applies at the next start of Claude Code.

## 3. Options

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want no line at all. `/mods statusline off` does the same at once. |
| `placement` | `line` | The hint row is crowded (`tail`), you prefer it above the prompt (`band`), or you want none (`off`). |
| `limits` | `always` | You care about the plan's windows only when they run low (`half`), or not at all (`off`). |
| `animate` | `true` | The moving highlight distracts you. |

## 4. Confirm

You cannot see the person's screen: ask them what they see, and compare with this.

After Claude's first answer in a session, in the terminal, with the defaults:

```
⏵⏵ auto mode on       Opus 5.5 xhigh   412k ━━━━━━──────   5h 34% ↺2h14   7d 12% ↺3d   ● ready · cold in 44m
```

- `Opus 5.5 xhigh`: the model and its effort.
- `412k ━━━━━━──────`: the context, and how far it is to the auto-compact point.
- `5h 34% ↺2h14   7d 12% ↺3d`: the plan's 5-hour and 7-day windows, with when each resets: quiet under half, plain past it, amber from 80%. They appear only where Claude Code reports plan limits (a subscription); with an API key, expect none.
- `● ready · cold in 44m`: smart-compact's segment, if it is installed and on.

On a narrow terminal the least important parts go first: the model, then the resets, the windows, the gauge.

What each failure looks like:
- **No line at all**: `/mods` shows `statusline: off` (turn it on with `/mods statusline on`), `placement` is `off`, or the mod is not loaded (not in `claude plugin list`, or disabled there: `claude plugin enable statusline@claude-modpack`, then restart Claude Code).
- **The line, but no plan windows**: `limits` is `half` (and both are under half) or `off`, or Claude Code reports no plan limits (an API key).
- **No `● ready`**: smart-compact is off or not installed, or no answer has come yet in this session.
- **Desktop app, nothing above the prompt**: expected while nothing needs the person.

End with one line: where the line is, and anything the person still has to do.

## 5. When it does not work

- **An organization manages Claude Code here**: some events do not reach plugins a person installs (`claude plugin validate` names them for statusline: `classic.SessionStart`, `session.compact`, `classic.UserPromptSubmit`, `classic.Stop`). The line still draws; parts of it may update late, such as the effort before the first answer.
- **Your own status line command** (`statusLine` in settings): statusline neither reads nor changes it. How the two share the screen was not tested.
- **The line is cut**: widen the terminal, or set `placement` to `band`, which has a row of its own.

## 6. Turn it off, or remove it

- Off, at once and kept across updates: `/mods statusline off`. On again: `/mods statusline on`.
- Removed: `claude plugin uninstall statusline@claude-modpack`. smart-compact lists statusline as a dependency, and when the modpack installs a new release it also installs any of its mods that is missing, so while those stay installed, turning it off is the lasting way. Without statusline, smart-compact shows its state as Claude Code's status text.
