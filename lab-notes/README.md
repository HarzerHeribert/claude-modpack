# Lab notes

What we tried while building this modpack, how we measured it, and why most of it did not ship.

The modpack is eight mods for Claude Code. Behind them is a lab where every idea has to show, in graded runs, that it saves something without making the work worse. Most ideas don't make it: a nudge Claude never followed, a gate that reassured falsely, a 10,000-star tool that, installed, saved nothing we could measure. These notes are about those decisions. The data behind every number is in [`benchmarks/`](../benchmarks/), with the harness to run it again.

> **Who wrote this.** Claude (Opus 5.5) wrote these notes from this repository's results files and commit history; HarzerHeribert reviewed them. We build a competing pack, so read what we say about other tools with that in mind: every claim about them links to their own words, and every number of ours to the runs behind it. If we got something wrong about your project, open an issue and we will correct it here.

## The notes

1. [The cheapest step is the one Claude never takes](01-the-cheapest-step.md): where the money in a Claude Code session goes, and why we count requests, not tokens.
2. [Notes nobody reads](02-notes-nobody-reads.md): 45 hints, 0 followed; 174 runs, 0 delegations. Claude does not take advice from tools. It does take answers.
3. [A 10,000-star code graph on our bench](03-a-code-graph-on-our-bench.md): Trail-Code, measured the way a person installs it: beside the pack, alone, against today's pack, and at its own best case. Alone it saved nothing we could measure (−1.8%); beside the pack it cost more (+13% fresh). On its own PocketBase tasks the pack saved 21%. Where its published numbers come from, and what we do not claim.
4. [Borrowing the good ideas](04-borrowing-the-good-ideas.md): what we took from the code-graph tools, the version that failed in calibration, and what the rest measured.
5. [The graveyard](05-the-graveyard.md): twelve ideas that did not make the cut, a code graph we did not adopt, and the numbers that stopped them.
6. [One server per extension](06-one-server-per-extension.md): language servers for Go, Ruby, shell, Terraform and YAML, and what each one needed to actually answer.
7. [Small models as plumbing](07-small-models-as-plumbing.md): a fast summarize/extract/classify API, priced at almost nothing. Where it lost facts, and the one job it did perfectly: deciding when Claude should hand work to a cheaper model (−14%, corrected from −17%).
8. [Our plain runs were not plain](08-our-plain-runs-were-not-plain.md): how a mod installed on the lab machine quietly turned the baseline into the thing it was measured against, and how we caught it.
9. [Beyond click](09-beyond-click.md): the main comparisons again on a TypeScript library and on 30 real bug reports from SWE-bench. What held and what did not.
10. [Two requests](10-two-requests.md): where Claude's requests around a hand-off went, the fixed-form report that removed them, and why Claude still never hands off on its own.
11. [What looking around leaves behind](11-what-looking-around-leaves-behind.md): every later request re-reads what a search left in the conversation. Priced that way, a mod that saved requests cost money; an order in the middle of Claude's search was followed once in six, and the same kind of order with the prompt saved 10 to 16%. A subagent never sees the prompt, so its task now carries the order too.
12. [The mod that left](12-the-mod-that-left.md): lsp-plus answered Claude's searches from the language server. In untyped code the server saw half of a name's uses, a word search all of them; two benchmarks, 120 runs, found the pack no more expensive without it, while its servers held hundreds of MB each. Why it left in 0.7.0, and what stays.
13. [Writing it once](13-writing-it-once.md): asked for 700 words, Claude wrote 1,052 and rewrote the whole guide three times. Cuts with Edit cost more than one rewrite, aiming at three quarters of the limit dropped facts, and draft's one write to each section's target saved 10.7% at the same quality; without a limit it does nothing.
14. [Clean prompts, real prompts](14-clean-prompts-real-prompts.md): local classifiers that got route's 25 clean prompts right picked mostly wrong prompts in real sessions (18 to 21% of their hand-offs right on the author's); Jev and ScaleDown on 877 real prompts, why Jev now hands off from 0.95, and why route is worth 3 to 6% in a real session, not the benchmark's 14%.
15. [Compaction in milliseconds](15-compaction-in-milliseconds.md): smart-compact writes its summary in the background after a turn, so compacting takes 3 to 5 ms, not Claude Code's 15 s at 67k or 102 s at 436k. A mod's own compaction skipped its own hook, which only a live session showed. Against /compact the next task cost 14% less. About a fifth of a summary is copying, so a summary written by a program would save about two cents.
16. [What a system prompt can order](16-what-a-system-prompt-can-order.md): steer added two short sections to Claude Code's system prompt, on working toward the person's goal and on steps that pay. In a smoke run it read requests a little more closely and cost 9% more (31% with the prompt orders off). It named what done means before starting in 0 of 10 runs and handed off nothing. The system prompt stays lean.

## How we measure

The same setup runs through every note unless it says otherwise.

- **The work.** Seven tasks on [click](https://github.com/pallets/click) 8.5.0 (79 files of Python), from a one-line lookup to a feature, later eight with a signature change, plus four tasks on a generated 54-file deployment repository (Kubernetes, Compose, GitHub Actions, Ansible). Every task is graded by a fixed rule: hidden tests for code, a parser for YAML, a term list for explanations. A run that saves money and gets the answer wrong counts as a failure, not a saving.
- **The runs.** Headless Claude Code (`claude -p`), Claude Opus 5.5, one fresh copy of the repository per run. Each condition names exactly which mods load, so nobody's personal settings decide anything. A *long session* forks a prepared session that has already read all of click's source, `src/click` (about 220k tokens of context), which is where real work spends most of its time.
- **The cost.** Read request by request from the transcripts and priced at list prices: Opus 5.5 at $4 per million input tokens, $20 output, $0.20 for a cache read, $8 for a cache write (Claude Code writes with the one-hour lifetime; a five-minute write is $5). On a subscription these are API-equivalent estimates, not a bill.
- **The uncertainty.** Two to eight runs per task and condition. Differences are reported for the average task with 95% bootstrap intervals, resampling runs within each task ([Efron & Tibshirani 1993](#references)). An interval that crosses zero means *not shown*, and we say so. Before a confirmation run we wrote down what would count as confirmed ([an example](05-the-graveyard.md#the-checklist-that-said-everything-was-fine)).
- **The limits.** Mostly one small Python repository and tasks every condition solves ([note 9](09-beyond-click.md) repeats the main comparisons on TypeScript and on real bug reports): these benchmarks can show cost and step differences at equal quality. They cannot show where a weaker setup fails on harder work. Each note says what its data can and cannot carry.

## References

- Efron, B., & Tibshirani, R. J. (1993). *An Introduction to the Bootstrap*. Chapman & Hall.
- Robertson, S., & Zaragoza, H. (2009). The Probabilistic Relevance Framework: BM25 and Beyond. *Foundations and Trends in Information Retrieval*, 3(4), 333–389.
- Nosek, B. A., Ebersole, C. R., DeHaven, A. C., & Mellor, D. T. (2018). The preregistration revolution. *PNAS*, 115(11), 2600–2606.
