# PREPP confirmation: written down before the runs (19 Oct 2026)

PREPP is smart-compact's summary written ahead from the prune prompt (`PRUNE2_PROMPT` in compact_bench.py), sent and
checked as smart-compact does: the end line asked for, and a reply without it, or without four of its six parts, not
used. It keeps the shipped prompt's six parts and its quoting of the person's words, and lets context shift: what is
superseded, closed, obsolete, one-off or finished fades to a line or goes, and an earlier summary is pruned rather than
copied forward.

On the Haiku canary (canary2.py, 12 compactions) it kept what the shipped prompt kept at half the size, but it was
tuned there (SCP lost a fact from a deleted file; SCP2 fixed the bullet). This is the check on other material: the six
next-task tasks on Opus, `BENCH_RESULTS=results-prep-prune-confirm.jsonl python3 compact_bench.py run --arms PREPP
--reps 3` (18 runs, the three prepared slots), against PREP's 18 runs of 18 Oct (results-prep.jsonl). PREP's
summaries were written without the end line; PREPP asks for it, as the mod does.

The prune prompt is put to the person to replace smart-compact's SUMMARY_PROMPT only if canary rule (e) passes and all
of these hold:

1. **Full marks no worse:** at least 16 of 18 runs at full marks (PREP: 16 of 18).
2. **Every check that needs the conversation passes in every run:** m1-helper's versionadded, show_default,
   changes_entry and compat_untouched; m2-fix's whole grade (it needs the investigation's findings).
3. **No new kind of miss:** a check that failed is one PREP or /compact also failed on that task (m1-helper's
   option_behaviour, t2-rename's leftover name), or it stops it.
4. **Not dearer:** the next task's cost against PREP, mean over the six tasks, with a 95% bootstrap interval
   resampling runs within each task, its upper end below +5%. (The size gain is the canary's, over many compactions;
   one compaction here is a check that quality holds on other material and the next task costs no more.)
5. **The mod's check rejects at most one of the 18 summaries.** A rejected one is run again in its slot, so 18
   graded runs remain; two or more rejections stop it.

Anything else keeps the shipped prompt. `python3 prune_confirm.py` checks 1-5.

## Outcome (19 Oct 2026, after both runs)

**Canary rule (e): PASS.** SCP2G ×10 (`python3 canary2.py report`) against SC's 10: no rung more than 10 points lower
at c12 (T3 98% against 95%), none more than 5 points lower over all checkpoints (T3 99% against 99%), the c12 summary
56% shorter (14.8k against 33.7k chars), the obsolete fact carried in 11% of summaries against 85%, no decoy answered,
code rules 100%. The mod's check rejected none of the 120 summaries, so no session fell back to /compact. $5.70.

**Next-task test: FAILS criterion 1** (`python3 prune_confirm.py`, 18 runs, no errors):

1. full marks: 15 of 18 against PREP's 16 of 18: **FAIL**
2. checks that need the conversation: pass
3. no new kind of miss: pass (m1-helper's option_behaviour in two runs; t2-rename's leftover `src/click/utils.py` in
   one, both misses PREP or /compact also had)
4. next task's cost: −10.2% [−15.8%, −4.0%]: pass
5. the mod's check rejected 0 of 18 summaries: pass

Summaries 5.0k chars against PREP's 8.3k; context at the next task's first request 29.9k against 36.3k. No PREPP
summary, the failing t2-rename one included, mentions `format_filename` or the rename (it arrives with the next task),
so the miss has no visible link to the summary; that is a reading, not part of the rule.

By the rule set above, the prune prompt does not replace the shipped SUMMARY_PROMPT. It goes to the person as
evidence, beside PREPL, for the 20 Oct decision.

**Decision (19 Oct 2026, the person):** shipped in smart-compact 0.3.2 (modpack 0.9.3) all the same, on the repo's
rule: the smallest work at the highest efficiency and lowest cost, with no or next to no quality loss. Facts were kept
over 12 compactions, the next task was 10% cheaper, and the one run under 16 of 18 is within what 18 runs can tell.
