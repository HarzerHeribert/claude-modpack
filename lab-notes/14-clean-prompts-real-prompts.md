# Clean prompts, real prompts

*Lab notes 14 · 18 Oct 2026 · written by Claude from this repository's data*

route asks a classifier about every prompt you send. When the answer is feature or test work, it tells Claude to hand the job to delegate's worker before reading the code ([note 10](10-two-requests.md)). Until 0.8.1 that classifier had been measured on 25 prompts, each one clean and complete on its own, and both outside services got all of them right. This note covers three things. First, what happened when we tried to replace the outside service with a model small enough to run on your machine. Second, what the outside services do with real prompts. Third, what route is worth in a real session, which is less than the benchmark said.

## Why a local classifier

route sends the start of each prompt to a US service and needs that service's key. A model that runs locally would make route free and private, and could let it be on by default. A classifier for seven labels doesn't need a large model, so we built small ones: kilobytes in size, answering in microseconds.

## Clean prompts are easy

The first one was a 64 KB classifier (logistic regression over hashed word and letter n-grams). We trained it on 560 prompts that Haiku wrote for us, 80 per label, so that no real prompt was needed. It passed every clean test we gave it:

- **route's 25 prompts:** it handed off exactly the 6 that route should, and labelled 23 of the 25 right.
- **75 paraphrases of them:** it found every feature and test prompt, and 64% of what it handed off was one.
- **210 mid-session prompts, also written by Haiku:** 196 right.
- **Trained on one generator's prompts and tested on another's:** an AUC of 0.96.

## Real prompts are not

We then took 918 distinct real prompts from Claude Code sessions: the author's own and four public sets of Claude Code traces (CC-BY or MIT). Haiku labelled them by route's rubrics. On these prompts the AUC fell to 0.74. Of everything the classifier handed off, 59% was feature or test work. On the author's interactive prompts it was 18%: 83 of its 101 hand-offs were wrong.

Two things are behind that number:

- **Few real prompts are feature work.** Of the author's 221 interactive prompts in the set Jev and ScaleDown saw, Haiku called 27 feature or test work. Across all 877, it was 398. The public sets hold many templated task prompts, and the author's sessions hold conversation.
- **A prompt in the middle of a session carries little on its own.** "ok, build it like that" is feature work only with the conversation before it, and no classifier here sees that conversation.

Adding real labels from the other sources (training on all but one source, testing on the one left out) brought precision on the author's prompts to 21%, and no higher.

## Two more tries

| Classifier | route's 25 | The author's interactive prompts |
| --- | --- | --- |
| 64 KB, trained on Haiku's 560 prompts | all 6 hand-offs, none wrong | 18% of its hand-offs right |
| The same, with real labels from the other sources | | 21% |
| 64 KB, taught by Jev on 2,817 prompts | | 9 of Jev's 61 hand-offs found |
| LAYA, 421M parameters, untrained for the task | 4 of 6 hand-offs, 2 wrong | 17% of its hand-offs right |

**Jev as the teacher.** If a local model can't learn the task from labels, maybe it can copy a classifier that already does it. Jev answered 2,817 prompts, and the student agreed with it on 94% (an AUC of 0.98). Most of that came from templated public prompts. On the author's 667 interactive prompts, Jev handed off 61 at its threshold, and the student found 9 of them. Word counts can't copy a model that reads the sentence. A transformer student would need about 20 to 25 MB and a local server, and no mod can run one inside Claude Code.

**LAYA**, an open decision model that takes Jev's request format, ran on the lab machine's GPU at 48 ms a prompt. Without training for the task, it agreed with Haiku's labels on 31% of the real prompts and with Jev's on 37%, and its own checkpoint warns that its scores are not calibrated. We deleted it.

## The outside classifiers on real prompts

Jev and ScaleDown had also been measured only on the clean 25. With the author's go, 877 of the real prompts went to both, each checked first for anything that looked like a key or personal data, which was left out. Against Haiku's labels:

| Classifier, from a score of | Handed off | Of them feature or test work | Of all feature and test work, found | The author's interactive prompts |
| --- | --- | --- | --- | --- |
| Jev, 0.7 | 325 | 86% | 70% | 51% (18 of 35) |
| **Jev, 0.95** | 243 | **95%** | 58% | **78% (14 of 18)** |
| ScaleDown, 0.7 | 252 | 92% | 59% | 70% (14 of 20) |
| ScaleDown, 0.95 | 91 | 95% | 22% | 80% (4 of 5) |

They gave the same label to 701 of 875 prompts. The median answer took 0.26 s from Jev and 0.51 s from ScaleDown.

Since route 0.3.2, Jev's threshold is 0.95. On the author's prompts that raises the share of right hand-offs from about half to about four in five, and Jev scores route's own feature and test prompts 1.0, so the benchmark's orders still go out. ScaleDown keeps 0.7: at 0.95 it finds only a fifth of the work.

## What route is worth in a real session

The benchmark said −14% ([note 7](07-small-models-as-plumbing.md)). That came from a mix of eight jobs in which the feature and the tests were the dearest. A real session has a different mix:

- In the author's sessions, the turns Jev hands off were **13% of the spend**.
- In the benchmarks, a hand-off saved about a third to a half of a feature or test job ([note 10](10-two-requests.md)). Applied to that 13%, it saves at most 4 to 7% of everything.
- Counting the hand-offs that were not feature or test work, it is nearer **3 to 6%**.

That is why route stays optional. It needs an outside classifier and its key, it sends the start of each prompt to a US service, and for the author it would save a few percent. The README, the installer, `/modpack:setup` and route's own setup now say all of that before you turn it on. Someone whose sessions are mostly fresh, complete feature requests is closer to the benchmark's mix and stands to save more.

## What this does not show

- **Labels are Haiku's, by route's rubrics.** They are not outcomes. Whether a hand-off would have paid on a given real prompt was not measured. Earlier in the lab, Haiku's labels predicted how long a turn would run only weakly.
- **One author.** 221 interactive prompts in the real set, 27 of them feature or test work. A person who works differently may see different precision.
- **The 3 to 6% is a calculation** from shares of spend and the benchmarks' savings, not a comparison in real sessions.
- **Context, not tested.** A classifier that also read the end of Claude's last message might handle "ok, build it like that". Sent to an outside service, that is more of your text leaving your machine; run locally, it needs a model no mod can host yet.

## Method & limits

The real prompts come from 1,484 Claude Code sessions: the author's interactive and headless sessions, and four public trace sets under CC-BY or MIT. Each distinct prompt was used once. The prompts and the per-prompt results stay on the author's machine and are not in this repository. Precision here is the share of a classifier's hand-offs that Haiku labelled feature or test work, and recall the share of that work it handed off. The comparison on the 25 clean prompts is in [`classifiers/jev-vs-scaledown.json`](../benchmarks/classifiers/jev-vs-scaledown.json). The local models ran on an M4 Pro.
