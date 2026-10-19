# PREPL confirmation: written down before the runs (19 Oct 2026)

PREPL is smart-compact's summary written ahead from a lean prompt (`LEAN_PROMPT` in compact_bench.py): the same six
parts, no message quoted whole, no code pasted that is on disk. The smoke run (6 runs, results-prep-lean.jsonl) gave
summaries 60% shorter and every conversation decision kept. The confirmation: `compact_bench.py run --arms PREPL
--reps 3` (18 runs, three prepared slots), against PREP's 18 runs of 18 Oct (results-prep.jsonl).

The lean prompt replaces smart-compact's SUMMARY_PROMPT only if all of these hold:

1. **Full marks no worse:** at least 16 of 18 runs at full marks (PREP: 16 of 18).
2. **Every check that needs the conversation passes in every run:** m1-helper's versionadded, show_default,
   changes_entry and compat_untouched; m2-fix's whole grade (it needs the investigation's findings). Any miss there
   is a loss of what the summary should have kept and stops it, whatever the cost.
3. **No new kind of miss:** a check that failed is one PREP or /compact also failed on that task (m1-helper's
   option_behaviour, t2-rename's leftover name), or it stops it.
4. **Cheaper with its range clear of zero:** the next task's cost against PREP, mean over the six tasks, with a 95%
   bootstrap interval resampling runs within each task, below zero.

Anything else (cheaper but a range across zero, a summary that left out a decision) keeps the shipped prompt.

## Outcome (19 Oct 2026, 18 runs, results-prep-lean-confirm.jsonl, `python3 prepl_confirm.py`)

1. Full marks: 15 of 18 against PREP's 16 of 18. **Not met.**
2. Checks that need the conversation: all passed (m1-helper's four decisions, m2-fix in full).
3. No new kind of miss: met. m1-helper's option check once; t2-rename twice, as the one /compact miss: the renamed
   function's docstring says "Renamed from ``format_filename``", a mention of the old name the task said to rename.
   PREP wrote no such note in 3 runs, /compact in 1 of 3, PREPL in 2 of 4 (smoke run included). Both summaries quote
   the decision about `versionadded` word for word; nothing in the lean summary's text points to the note.
4. The next task's cost: −22.0% [−26.9%, −16.4%]. Met. Summaries 3,198 characters against 8,319; the next task
   starts at 29.1k tokens against 36.3k.

By the rule written above, the shipped prompt stays. Spent: $10.51.

**Decision (19 Oct 2026, the person):** not shipped. The prune prompt shipped instead (smart-compact 0.3.2, see
PREPP-confirm.md): the lean prompt was cheaper on the next task but lost buried facts over many compactions (canary
round 2, after the last of 12: 75% against 95%), and once lost they stayed lost.
