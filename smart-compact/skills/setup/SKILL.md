---
name: setup
description: Check that smart-compact watches this session's prompt cache, choose how it treats an idle session (keep the cache warm, compact before it expires, or both, whichever is cheaper), and confirm it with /cache. Run after installing the modpack or smart-compact.
disable-model-invocation: true
---

Set up the smart-compact mod with the person. When a session sits idle, its prompt cache expires (after 1 hour on a subscription, 5 minutes in overage or on an API key), and the next prompt pays to write the whole context again. A few minutes before that, smart-compact sends a small keep-alive request or compacts the session, whichever costs less, and says on statusline's line whether the next prompt is `● ready` or `○ cold`. It runs inside Claude Code: there is nothing to install.

## 1. Check what is there

- `claude --version`: tested on 2.1.296 to 2.1.301; older versions are untested.
- `claude plugin list`: `smart-compact@claude-modpack` and `statusline@claude-modpack` (its dependency, which draws its segment), both `✔ enabled`. Without statusline it still works and says the same in Claude Code's own status text.
- How the person pays: a subscription (Pro, Max) or an API key. smart-compact learns the cache's lifetime itself, but the person should know that on a subscription its keep-alives are requests that count against the plan's limits, and that its prices are list prices: API-equivalent estimates there, not a bill.

## 2. Ask, then set

Ask the person once whether the default fits them. Most keep it:

- **`smart`** (default): keep the cache warm while that is cheaper than compacting, counting lost detail at `compactPenaltyUsd`; then compact while the cache is still warm; stop keep-alives after `maxIdleHours`.
- **`compact`**: compact at the first expiry; never pay for keep-alives.
- **`keepalive`**: never compact; keep the cache warm until `maxIdleHours`.
- **`off`**: only say on the line whether the cache is ready or cold.

It leaves small sessions alone (below `minCompactTokens` of context, or below `minSavingsUsd` of re-cache cost), never compacts while the prompt holds a draft or agents are running, and does nothing if the machine slept past the deadline.

To set an option, the person picks one way:
- `/plugin configure smart-compact@claude-modpack`: a dialog with each option.
- Typed in the prompt: `/config smart-compact.strategy=keepalive`.
- By hand, in `~/.claude/settings.json` (user settings only):
  ```json
  { "pluginConfigs": { "smart-compact@claude-modpack": { "options": { "strategy": "keepalive" } } } }
  ```

A change made inside the session reloads the mod at once; a change in the file, or from another terminal, at the next start.

## 3. Options

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want none of it. `/mods smart-compact off` does the same at once. |
| `strategy` | `smart` | See step 2. |
| `cacheTtl` | `auto` | `/cache` shows a wrong TTL: set `1h` or `5m`. |
| `minSavingsUsd` | `0.25` | Raise it to act less often; below this re-cache cost the cache is left to expire. |
| `compactPenaltyUsd` | `0.5` | Raise it to keep the cache warm longer before compacting; lower it to compact sooner. |
| `minCompactTokens` | `100000` | Raise it to compact only large sessions. |
| `maxIdleHours` | `12` | Lower it so keep-alives stop sooner. An open session is one you mean to come back to, so the default covers a night. |
| `compactInstructions` | empty | You want idle compactions to keep something particular: the text is passed like `/compact <text>`. Empty uses Claude Code's own. |

## 4. Confirm

Ask the person to type `/cache` (a command you cannot run yourself). Its first line names the strategy, the model's prices and the cache's lifetime:

```
smart-compact · smart · <model> · TTL 1h (<where the TTL came from>)
```

After an answer it goes on with `cache   warm, 57m left · 412k tokens`, what it will do next and what each choice would cost. Before the first answer it says the cache's state only. On statusline's line, after the first answer, the person sees `● ready`, or `· cold in m:ss` near expiry (amber in the last five minutes), `· compacts in …` when an idle compaction is near, `○ cold` once expired, or what it is doing (`compacting`, `keeping warm`, `paused`).

What each failure looks like:
- **`/cache` is an unknown command**: the mod is off (`/mods smart-compact on`) or not loaded (`claude plugin list`).
- **No segment on the line**: statusline is off or placed `off`; smart-compact then has nowhere to draw except the status text.
- **`(paused)` in the first line**: `/cache pause` was used in this session; `/cache resume` ends it.

End with one line: the strategy in use, and anything the person still has to decide.

## 5. When it does not work

- **The TTL looks wrong** (`5m` on a subscription): it is learned from the cache hits and misses it sees, and corrected as it goes; set `cacheTtl` if it stays wrong.
- **It never acts**: the session is below `minCompactTokens` or `minSavingsUsd`, `maxIdleHours` has passed, the prompt holds a draft, or agents are running. `/cache` says the plan and why.
- **An organization manages Claude Code here**: the `classic.SessionStart` and `session.compact` events do not reach plugins a person installs (`claude plugin validate` names them), so a resumed session starts without its cache state and compactions teach it nothing; the rest works.
- **Control for one session**: `/cache pause`, `/cache resume`, and `/cache keepalive` (keep the cache warm now).

## 6. Turn it off, or remove it

- Off, at once and kept across updates: `/mods smart-compact off`. On again: `/mods smart-compact on`.
- Removed: `claude plugin uninstall smart-compact@claude-modpack`. While the modpack stays installed, its next release installs any missing mod again, so turning it off is the lasting way.
