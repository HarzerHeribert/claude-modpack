---
name: setup
description: Turn route on, only with the person's explicit consent - from then on the start of each prompt they send goes to an outside classifier (TypeSafe's Jev or ScaleDown, US services) - store its key without it ever entering the conversation, and confirm that a feature request gets the order to hand it to delegate's worker. Run when the person wants route; it is off until then.
disable-model-invocation: true
---

Set up the route mod with the person. route is optional, and the one mod of the pack that needs an outside classifier model: an API key for TypeSafe's Jev or ScaleDown. For each prompt they send, route asks a fast outside classifier (TypeSafe's Jev or ScaleDown) what kind of work it is, and only for feature or test work does Claude get the order to hand it to delegate's worker before reading the code. Measured: a TypeScript feature 51% cheaper and 42% faster than the pack alone, writing tests 36% cheaper, all results correct; everything else stays with Claude. On real prompts it is worth less: in the author's sessions the turns Jev hands off (at its 0.95 threshold) were 13% of the spend, about 3 to 6% saved; say so. It needs delegate, a key for one of the two services, and the person's consent: once it is on, the start of every prompt they send leaves their machine.

## Rules for this setup

- **Consent first.** Do not turn route on, and do not help store a key, until the person has said yes to step 2 in this conversation. If they say no or hesitate, stop: route stays off, which is its default.
- **Never touch the key.** Never ask the person to paste it into the conversation. Never print, echo, `cat`, log or write a key anywhere, and never read the Keychain, `~/.claude/.credentials.json` or a shell profile to find one. To learn whether a key is there, use only checks that print no value (step 4).
- **If a key lands in the conversation anyway** (pasted in a message): do not repeat it, do not use it, tell the person it is now in this session's transcript, and suggest they revoke it at the service and make a new one.

## 1. Check what is there

- `claude --version`: tested on 2.1.296 to 2.1.301; older versions are untested.
- `claude plugin list`: `route@claude-modpack` and `delegate@claude-modpack`, both `✔ enabled`.
- Your tool list has `hand_off` (from the delegate mod). route looks for exactly that tool: with delegate off, or delegate's `framing` set to `capability` (its tool is then `implement_spec`), route sends nothing and does nothing. If delegate was never checked here, run its setup first (`/delegate:setup`), including its one read hand-off.
- Where the person works: in the desktop app's auto mode delegate cannot start workers, so route's order would only be refused there. Ask; if that is where they work, suggest leaving route off.

## 2. Ask for consent

Tell the person, in plain words, before anything else:

- **What leaves the machine**: the first 8,000 characters of each prompt they send, typed, from the phone, or through `claude -p`; for most prompts that is the whole prompt, pasted text included. Not slash commands, and not replies under 40 characters. Nothing else: no files, no code Claude reads, no answers.
- **To whom**: the classifier they pick, a US service. TypeSafe keeps inputs as long as it needs them and never trains on them. ScaleDown's terms promise zero retention. Point them to each service's own terms for the details.
- **What it costs**: each prompt starts about 0.3 s later with Jev, about 1 s with ScaleDown, at most 3 s. The service charges its own fee per prompt, about $0.00002 to $0.00003 measured.
- **What they get**: feature and test requests are handed to the cheaper worker before Claude reads the code; the work is checked by the tool itself.
- **How to stop**: `/mods route off`, at once; nothing leaves after that.

Then ask one direct question: "Turn route on, with the start of each prompt sent to <service>?" Only an explicit yes counts.

## 3. Pick the classifier and get a key

- **Jev (TypeSafe)**: 0.25 s median, measured. Docs: `https://docs.typesafe.ai/introduction/quickstart`.
- **ScaleDown**: 1.15 s median. Docs: `https://docs.scaledown.ai/api-reference/classify`.

Both were right on all 50 test prompts. `classifier: auto` (the default) takes Jev when its key is set, else ScaleDown. The person makes the key on the service's own site, themselves.

## 4. Store the key, by the person

Offer these, in this order:

1. **Preferred: route's own setting, in Claude Code.** The person types `/plugin configure route@claude-modpack` and fills `TypeSafe API key` or `ScaleDown API key`. The dialog masks what they type, and Claude Code keeps it in secure storage (the macOS Keychain; `~/.claude/.credentials.json` where there is no keychain), never in `settings.json`.
2. **From their own terminal**, not through you: it reads the key without showing it and keeps it out of the shell's history.
   ```sh
   read -rs ROUTE_KEY && printf '{"typesafeKey":"%s"}' "$ROUTE_KEY" | claude plugin configure route@claude-modpack --values-stdin; unset ROUTE_KEY
   ```
   They paste the key and press Enter; nothing shows while they do. For ScaleDown, `scaledownKey` instead of `typesafeKey`. Then Claude Code must restart. Not tested with these sensitive fields: if it refuses them, use the dialog.
3. **Last resort: an environment variable**, `TYPESAFE_API_KEY` or `SCALEDOWN_API_KEY`, in the environment Claude Code starts with. A shell profile keeps it in plain text, readable by every program the person runs. Never in any `settings.json` (its `env` is plain text too).

Then check that a key is there, without printing it:
- `claude plugin configure route@claude-modpack` lists route's options and which are set; it does not print a sensitive value.
- For the environment variable: `[ -n "$TYPESAFE_API_KEY" ] && echo set || echo unset` (or `SCALEDOWN_API_KEY`).

## 5. Turn it on

After the consent and the key: the person types `/mods route on` (it applies at once), or `/config route.enabled=true`. To pick a classifier other than `auto`: `/config route.classifier=jev` or `scaledown`.

## 6. Options

| Option | Default | Change it when |
| --- | --- | --- |
| `enabled` | `false` | On: the start of each prompt goes to the classifier. |
| `classifier` | `auto` | `jev` or `scaledown` to use one even when both keys are set. |
| `typesafeKey` | empty | Jev's key, stored as a sensitive value. Else `TYPESAFE_API_KEY`. |
| `scaledownKey` | empty | ScaleDown's key, stored as a sensitive value. Else `SCALEDOWN_API_KEY`. |
| `direct` | `true` | `false`: Claude may look around first (measured: it then kept the work 5 times in 16). |
| `minScore` | `0` | The classifier's own threshold: 0.95 for Jev, 0.7 for ScaleDown (measured on 877 real prompts: at 0.7 nearly half of Jev's hand-offs on one person's prompts were not feature or test work). A number sets yours, for either. |
| `timeoutMs` | `3000` | A slower answer adds nothing; lower it if prompts feel slow to start. |

Non-sensitive options are rows in `/config` and `/plugin configure`, stored in `~/.claude/settings.json` under `"pluginConfigs": { "route@claude-modpack": { "options": { … } } }`. The two keys are not: they have no `/config` row and are never in that file.

## 7. Confirm

You cannot test route on your own: it reads the person's own prompts. Tell them:

"Send your next message as a real feature or test request for this project, at least 40 characters, for something you want done (or a small throwaway one). I will tell you whether route's order came with it, then do it as the order says."

When that message arrives, look beside it for the order. It reads:

```
This prompt is feature work, and the person's setting for feature work is: implement it through the hand_off tool (kind build). Hand it off before you read the code: …
```

(or `This prompt is test work, …`). Tell the person in one line whether it arrived, then follow it: the hand-off that follows is delegate and route working end to end. A question ("where is X defined?") should come without the order.

What each failure looks like:
- **No order on a clear feature request**, and nothing else: route is off (`/mods` shows `route: off`); no key is set (step 4's checks); the key is wrong (a refused key fails silently: see below); the prompt was under 40 characters or started with `/`; `hand_off` is missing (delegate off, or `framing: capability`); the classifier scored it under `minScore`; or it answered after `timeoutMs`.
- **The order arrives, but the hand-off returns `Not handed off: auto mode in this app cannot judge a worker…`**: the desktop app in auto mode. Turn route off there, or use manual mode or the terminal.

End with one line: route is on with <classifier> and the order arrived, or why it is off.

## 8. When it does not work

- **Checking the key itself.** route says nothing when a service refuses its key. The person can test the key from their own terminal (paste the key, press Enter; nothing shows); this sends one test sentence to the service, and prints its answer, never the key. Both checked with real keys on 16 Oct 2026.
  - Jev: the answer should hold `"choice":"feature"`.
    ```sh
    read -rs K; printf 'authorization: Bearer %s\n' "$K" | curl -s -H @- -H 'content-type: application/json' -d '{"state":"Add a CSV export to the reports page","model":"jev-latest","questions":{"kind":{"type":"choice","instructions":"Which kind of request to a coding assistant is this?","criteria":{"feature":"Does this request ask to implement new behaviour or a new capability in the code?","other":"Is this request about anything that is not reading or writing code?"}}}}' https://api.typesafe.ai/v1/systemone; echo; unset K
    ```
  - ScaleDown: the answer should hold `"top_label":"feature"`.
    ```sh
    read -rs K; printf 'x-api-key: %s\n' "$K" | curl -s -H @- -H 'content-type: application/json' -d '{"text":"Add a CSV export to the reports page","labels":[{"name":"feature","rubric":"Does this request ask to implement new behaviour or a new capability in the code?"},{"name":"other","rubric":"Is this request about anything that is not reading or writing code?"}],"reasoning":false}' https://api.scaledown.xyz/classify; echo; unset K
    ```
- **A key set from another terminal or in the environment** reaches route only when Claude Code starts: restart it.
- **A long, detailed spec scored under 0.7 by ScaleDown** (0.66 in our test; Jev was certain): use Jev, or lower `minScore` a little.
- **Prompts feel slow to start**: ScaleDown takes about 1 s; Jev about 0.3 s; `timeoutMs` caps the wait.

## 9. Turn it off, or remove it

- Off, at once and kept across updates: `/mods route off`. From then on nothing is sent.
- The key: clear it in `/plugin configure route@claude-modpack`, or remove the environment variable, and revoke it at the service if it is no longer needed. Whether uninstalling route also clears its stored key is not documented, so clear it first.
- Removed: turn it off and clear the key first, then `claude plugin uninstall route@claude-modpack`. While the modpack stays installed, its next release installs any missing mod again, with the settings it had if they are still there: turned off, with no key, is the lasting way.
