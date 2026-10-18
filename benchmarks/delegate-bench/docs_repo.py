"""The documentation tasks' repository: handbook, the team notes of a small group that runs a service called tally and
its command line tool. Three meeting notes, two postmortems, a chat export of the on-call channel, a tool reference, an
old getting-started guide and a 40,000-row sales CSV, and six tasks in prose and data: write a runbook from the
sources, revise a long guide, analyse the CSV and write a short report, and three that write to a word limit tight enough
that a first draft runs over and must be cut: a leadership brief on the postmortems (200 words), a FAQ of eight questions
(300 words), and a long architecture document (docs/architecture.md, written into the repository only for that task by
plant()) cut in place to 800 words without losing headings, code blocks, retention rules or the numbers that describe the
system today. The facts a task needs are each stated once, in
running prose or in chat, among others that do not matter; two of them changed between meetings (the later one counts),
and the CSV holds a trap (cancelled rows).

Graded by checks a reviewer would apply, from the files the run wrote and its last line; no model judges anything:
word limits (for the trim task the other checks count only when the text fits), structure kept, the facts present (in order, where order is the fact), the stale ones absent, every
command in the runbook one the tool reference knows, and for the analysis the truth computed from the repo's CSV.
The score is the share of checks passed.

  python3 docs_repo.py build DIR    # writes the repository, commits it, tags it `base`
  python3 docs_repo.py selftest     # (plant() adds the architecture document for doc-6-trim) grades the base (scores low) and hidden/docs_reference (scores 1.0)
"""
import csv
import random
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFERENCE = HERE / "hidden" / "docs_reference"

# --------------------------------------------------------------------------------------------------------------------
# The repository
# --------------------------------------------------------------------------------------------------------------------

FILES = {
    "README.md": """\
# handbook

The team handbook for tally, our metrics-ingest service, and `tallyctl`, its command line tool.

- `sources/` - notes, postmortems, the on-call chat export and the tool reference
- `docs/` - the documents we publish to new people
- `data/` - exports we analyse
- `reports/` - what the analyses produce
""",
    "reports/.gitkeep": "",
    "sources/meeting-2026-09-02.md": """\
# On-call sync, 2 September 2026

Present: Mara (chair), Jonas, Priya, Tomasz, Elif, Sunil. Notes by Elif.

We opened with the on-call rota because last month's two incidents showed that nobody agreed on what happens when the
person holding the pager does not answer. Jonas described the August night in some detail: the page went out at about
three in the morning, the primary was asleep with the phone in another room, and the only reason anybody noticed was that
Priya happened to be awake and saw the dashboard turn red. Nobody was to blame, Mara said more than once, the process
simply had a hole in it. Tomasz asked who even was supposed to take over, and it turned out that three people in the room
had three different answers, which was the actual finding of the discussion.

After some back and forth we settled the order. The first person to be paged is the primary on-call. If the primary does
not acknowledge, the page moves to the secondary on-call, and if the secondary does not acknowledge either, it goes to the
engineering manager, who at the moment is Mara. Sunil wanted to know whether the manager should be a real step or just a
courtesy, and Mara said it is a real step: if she is the third person to get the page then something has gone badly wrong
and she would rather be woken than read about it. Everyone agreed on that order.

The harder question was how long to wait before moving on. Tomasz argued for ten minutes, because an outage that nobody
has acknowledged is costing us money every minute. Priya said ten is too aggressive for a human who is walking to a laptop
and logging in, and that a rule people resent is a rule people quietly work around. Jonas suggested a quarter of an hour,
Elif thought forty-five was more realistic for nights. We went round the table and landed in the middle: for now the page
escalates to the next person after 30 minutes without acknowledgement. We will look at the real numbers after a few weeks
and revisit if the number turns out to be wrong. Elif will write the rule into the pager configuration.

Then the night question. Right now every alert that fires wakes somebody up, and Sunil pointed out that of the alerts last
month only a small share were things that could not wait. We agreed that between 22:00 and 07:00 the pager is used only
for severity 1, that is customer-facing data loss or a full outage. Severity 2 incidents, for example a slow dashboard or
a delayed batch, do not page at night; they wait for business hours and the primary picks them up in the morning. Priya
asked for it to be written down that this is a rule for the pager and not a licence to ignore the dashboards, which Mara
said was fair.

Smaller items. The staging cluster will be rebuilt next week, Sunil owns that. Tomasz is still waiting on a laptop. Mara
reminded everybody that the quarterly planning document is due at the end of the month and nobody has started it. We
ran out of time before talking about the dependency upgrades, so those carry over.

Actions: Elif configures the escalation in the pager. Jonas writes up the August night as a postmortem. Sunil rebuilds
staging. Next meeting in two weeks.
""",
    "sources/meeting-2026-09-16.md": """\
# On-call sync, 16 September 2026

Present: Mara (chair), Jonas, Priya, Tomasz, Sunil. Elif on leave. Notes by Sunil.

First the review we promised two weeks ago. Jonas had pulled the numbers for the escalations since the last meeting and
they were not flattering. There had been three pages that went unacknowledged for a while; in two of them the wait before
the secondary got paged was long enough that the customer noticed before we did. Priya looked at the timeline of the
worse one and said that waiting half an hour is simply too long when the first person did not even see the page, and that
the reasoning from the last meeting, that a person needs time to get to a laptop, applies to acknowledging, not to
resolving. Acknowledging is a tap on a phone. Tomasz, who had argued for ten minutes last time, did not gloat, to his
credit. After a short discussion the group agreed to change the rule: the page now escalates to the next person after 15
minutes without acknowledgement, and the earlier number is dropped. Sunil asked that the pager configuration and every
document that mentions the wait are changed together so nobody reads the old figure somewhere. Mara agreed and said she
would check the handbook herself.

The second topic was the name of the command line tool. For a year we have called it tally-cli, and that has caused
two kinds of confusion: people mistake it for a client library, and the package name and the binary name do not match
the rest of our tooling, which is all `something-ctl`. Jonas proposed tallyctl. There was a short and cheerful argument
about whether a rename is worth the churn, which ended when Priya pointed out that the number of scripts and documents
that use the old name is only going to grow. Decision: the CLI is renamed from `tally-cli` to `tallyctl`, starting with
the next release. The old name stays as an alias for one more release and then goes away. Documentation moves to the new
name now rather than at the release, so that people copy the right thing.

Third, a side discussion about alert noise. Tomasz showed a graph of alerts per day, and the weekly spike on Monday
morning is the batch job that runs while the cache is cold. Nobody had a quick fix. Sunil thinks the batch should be
moved to Sunday night; Jonas thinks that only moves the problem. Left open.

Other business: the staging rebuild finished and is faster, according to Sunil, by about a third. Tomasz has a laptop at
last. Priya will give a short talk on how we write postmortems at the next engineering all-hands, and asked Jonas for the
August one as an example if he is willing to have it shown.

Actions: Sunil updates the pager configuration. Mara checks the handbook for the old wait. Jonas starts the rename in the
packaging. Priya prepares the talk. Next meeting on 30 September.
""",
    "sources/meeting-2026-09-30.md": """\
# On-call sync, 30 September 2026

Present: Mara (chair), Jonas, Priya, Tomasz, Elif, Sunil. Notes by Priya.

Elif was back and caught up on the rename; she said the pager configuration already reflects the shorter wait so there
was nothing to do there. Most of the meeting was about the release that went out on Monday and what it changed for
people who run tally by hand.

The big one is the port. Until now the service has listened on 8080, which we inherited from the first prototype and
which collides with half the development tools on every laptop here: Tomasz lost an afternoon to a proxy that was
quietly sitting on it. The release moves the service to port 8731 and nothing else; the old port is no longer open, so
anything that still talks to 8080, such as health checks in old scripts or bookmarks, will fail with a refused
connection. Sunil has already changed the load balancer and the monitoring. Jonas will grep the repositories for
leftover references and Priya will do the same for the documents.

Second, the release removed one command. The cache purge command from the old tool was a thin wrapper that sometimes
left half of the cache in place, and it has been taken out. Anybody who still types the old purge command gets an error
about an unknown subcommand. What replaces it is `tallyctl cache clear`, which clears all regions by default and accepts
a flag to clear a single one. Jonas apologised that the changelog buried this and said he would move it to the top of
the next one. Elif remarked that two of the old runbook scripts called the removed command and she had fixed them.

We spent a while on whether the old alias `tally-cli` should really go away after one more release, since a few
customers' scripts call it, and decided to keep to the plan but announce it clearly. Tomasz volunteers to write the
announcement; Mara will review it.

Short round of other news. The quarterly planning document was handed in late but handed in. Sunil is going to a
conference in November. The dependency upgrades that carried over twice are now scheduled, finally.

On the follow-ups from the two postmortems: Sunil switched on the disk alert at 80 percent last week, so that one is done.
Jonas's fix for the poisoned batch is still open, in review. Priya has set the calendar reminders for certificate expiry,
but the alert on days left is not built yet. Tomasz has not added the certificate listing to the weekly checklist yet.
Mara has put the rule about writing down the commands into the on-call handover notes, which closes that one.

Actions: Jonas and Priya search for 8080 in repositories and documents. Tomasz writes the alias announcement. Sunil
confirms the new port in monitoring. Next meeting in two weeks, Mara will send the agenda.
""",
    "sources/incident-2026-08-11.md": """\
# Postmortem: the ingest backlog and the full disk, 11 August 2026

Author: Jonas. Status: final. Written before the rename of the tool, so the commands below use its old name.

## Summary

On the night of 11 August the ingest pipeline stopped moving data for about two and a half hours, and while we were
dealing with it the database host ran out of disk. Customers saw stale dashboards, nobody lost data. Both problems are
ones we have seen before and both will happen again, which is why this document is more concrete than most.

## What happened

At 02:50 the queue depth alert fired. The ingest workers were running and looked healthy in the process list, but the
queue had stopped draining. We spent the first half hour looking at the network, because the last time something like
this happened it was a firewall rule, and it was not the network. Priya finally noticed that the oldest message in the
queue had been sitting there for hours: a single malformed batch had wedged the consumer, which kept retrying it and
never moved on. Restarting the service the plain way did not help, because on startup the consumer picked up the same
poisoned batch. What worked was restarting with a drain, which finishes in-flight work, parks the stuck batch in the
dead-letter table and then starts the consumer clean: `tally-cli restart ingest --drain`. The queue emptied in six
minutes. Lesson: when the ingest queue is stuck, do the drain restart first and look for the cause afterwards. The
parked batch can be inspected the next day.

While the backlog was clearing, the db host started to fill up, because the retries had written an enormous amount of log
and the table bloat from the replay added to that. At 04:10 the disk was at 97 percent and the database began refusing
writes. Our first attempt was the vacuum, run the usual way, which takes a lock on the tables and made things worse for
a few minutes, because ingest was trying to write at the same time. The command that does the same job without blocking
writers is `tally-cli db vacuum --online`; it is slower but safe in production. That freed enough space to breathe, but
the logs were still the bulk of it, so we rotated them with `tally-cli logs rotate`, which compresses the old files and
removes the ones past retention. Disk dropped to 61 percent. The order matters: vacuum online first, then rotate logs,
because the vacuum needs a little scratch space and the rotation does not.

Somebody also tried `tally-cli purge-cache` in the hope that it would free memory. It did not do anything useful and is
not part of the fix. Mentioned here only so nobody repeats it.

## What we are changing

We will put an alert on disk at 80 percent. The escalation of the night was also slow, and we have scheduled a separate
discussion about who gets paged and when. Jonas will write the poisoned-batch fix so the consumer does not wedge in the
first place. Sunil owns the disk alert.

## Timeline (all times local)

02:50 queue alert; 03:20 network ruled out; 03:45 stuck batch found; 03:52 drain restart; 03:58 queue empty; 04:10 disk
at 97 percent; 04:25 online vacuum started; 04:50 logs rotated; 05:15 all clear.
""",
    "sources/incident-2026-09-21.md": """\
# Postmortem: the API certificate, 21 September 2026

Author: Priya. Status: final. The tool had been renamed by then, so the commands use `tallyctl`.

## Summary

On Monday 21 September at 08:05 the public API began answering with certificate errors. Browsers refused to connect
and every client that checks certificates, which is nearly all of them, failed. The outage lasted 47 minutes. The cause
was embarrassing: the TLS certificate of the API had expired and the renewal job that should have replaced it had been
failing silently since the beginning of the month.

## What happened

The first signal was the synthetic check from outside, not a customer, which was a small win. The page went to the
primary, who acknowledged within two minutes and started with the usual suspects: the load balancer, the DNS record,
the deployment from Friday. None of them were at fault. It took until 08:31 for someone to run the certificate listing
and read the expiry date, which was the previous night at midnight. From then on it was quick. The certificate is renewed
with `tallyctl certs renew api`, and the new certificate is only picked up after the service is restarted, which is the
part we forgot at first: we renewed, saw the old certificate still being served, spent ten minutes doubting the
renewal, and then restarted the API with `tallyctl restart api`. After that the checks went green within a minute.
Lesson: renewing is two steps, the renewal and the restart, and the second one is not optional.

The renewal job itself had been failing because its token for the certificate authority had been rotated and the job
kept the old one. It logged the failure at a level nobody was watching. That is fixed and the job now raises an alert.

## The disk, again

A footnote worth keeping: during the review we noticed the db host disk was at 85 percent again, and since the August
postmortem predicted that, we did not wait. `tallyctl db vacuum --online` followed by `tallyctl logs rotate` took it back
to 55 percent without any incident, which shows that the August notes work as written.

## What we are changing

A calendar reminder fourteen days before every certificate expiry, an alert on days left, and the listing command goes
into the weekly checklist. We also agreed that the person who handles an incident writes down the commands they ran
while they run them, since reconstructing them afterwards was the slowest part of this document. Priya owns the
reminder and the alert, Tomasz the checklist entry, and Mara the rule about writing the commands down.

## Timeline (all times local)

08:05 first failed check; 08:07 acknowledged; 08:31 expiry found; 08:39 certificate renewed; 08:49 API restarted;
08:52 recovered.
""",
    "sources/tools.md": """\
# tallyctl reference

`tallyctl` is the command line tool for tally. It was called `tally-cli` until the 2026-09 release; the old name
still works as an alias for one more release and will then be removed. Commands below are given with their flags.
Every command talks to the service on port 8731 unless `--host` says otherwise.

## tallyctl version

Prints the tool and service versions. No flags.

## tallyctl status

Shows the state of every service. Flags: `--json` prints machine-readable output; `--watch` refreshes every two seconds.

## tallyctl config show

Prints the effective configuration, with secrets masked. Flags: `--file PATH` reads a different configuration file.

## tallyctl restart <service>

Restarts one service. Services: api, ingest, worker, scheduler. Flags: `--drain` waits for in-flight work and parks
a stuck batch in the dead-letter table before restarting (ingest only); `--timeout SECONDS` gives up after that many
seconds, default 120.

## tallyctl cache clear

Clears the cache. All regions by default. Flags: `--region NAME` clears only one. This replaces the former
purge command, which was removed in the 2026-09 release.

## tallyctl db vacuum

Reclaims space in the database. Flags: `--online` does not block writers and is the one to use in production; `--full`
rewrites the tables and needs the service stopped.

## tallyctl db backup

Writes a database backup. Flags: `--to DIR` sets the target directory, default ./backups.

## tallyctl logs tail

Streams the service logs. Flags: `--follow` keeps streaming; `--service NAME` limits it to one service.

## tallyctl logs rotate

Compresses old log files and removes those past retention. Flags: `--keep N` keeps the last N files, default 14.

## tallyctl certs list

Lists certificates with their expiry dates. No flags.

## tallyctl certs renew <name>

Renews the named certificate (api, ingest). The service must be restarted afterwards to serve the new one. Flags:
`--dry-run` shows what would happen.
""",
    "docs/guide.md": """\
# Getting started with tally

This guide gets a new teammate from nothing to a running tally on their own machine, and then shows the handful of
commands that cover most days. It was written before September and is in need of a pass, but the shape is right.

## What tally is

Tally is our metrics-ingest service. Applications send it small numeric events, such as a request count or a latency, and
it stores them, rolls them up into minutes and hours, and serves the rolled-up series to dashboards and to the alerting
system. It is made of four parts that you will hear named all the time: the API, which accepts events and answers
queries; the ingest workers, which take events off a queue and write them to the database; the worker pool, which does
the roll-ups; and the scheduler, which starts the periodic jobs. Behind them sit a Postgres database and a cache.

The roll-ups deserve a short explanation because they surprise people. Raw events are kept for a week and then thrown
away; the minute and hour series are kept for much longer. That means a question about last month can be answered at hour
resolution but not at the resolution of single events, and it is the reason we ask teams to decide what they want to
measure before they start sending, not afterwards. The cache sits in front of the series and is organised by region,
which is why a stale chart for one region and a correct chart for another is a cache question before it is anything else.

Most people never need to care about the internals. What you need to know is that events go in through the API, that
nothing is lost as long as the queue is healthy, and that the command line tool is the way to look at all of it. If a
dashboard looks wrong the first question is nearly always whether the data arrived, and the tool can answer that in a
few seconds without touching a browser.

## Installing the command line tool

The tool is a Python package and we install it with pipx so that it does not interfere with anything else on your
machine. You need Python 3.11 or newer; check with your system package manager if you are unsure. Install it with:

```
pipx install tally-toolkit
```

Once it is installed, check that it is on your path and that it can see its own version. You should see a version number
for the tool and, if a service is running, one for the service as well:

`tally-cli version`

The tool reads its settings from a file in your home directory. You do not normally edit it by hand; ask the tool to show
you what it is currently using, with secrets masked, so that you can paste the output into a question without worry:

`tally-cli config show`

> **Warning:** Never paste the contents of the settings file itself into a chat or a ticket. The tool masks secrets when
> it prints the configuration, the file does not.

If the command is not found, your pipx directory is probably not on your path. Run `pipx ensurepath`, open a new
terminal and try again. This is by far the most common installation problem and nearly everybody hits it once.

## Running the service

For development you run the whole service locally. The tool starts it for you and reports how it is doing. Start with a
status check, which lists every part and whether it is up, and ask for the machine-readable form when you want to script
something around it:

```
tally-cli status
tally-cli status --json
```

A freshly started service listens on port 8080 on your machine. To be sure it answers, ask it for its health, which
returns a short line saying that the API, the queue and the database are all reachable:

`curl http://localhost:8080/health`

If another program already uses 8080 on your machine, which happens more often than you would think with development
proxies, the service will not start and the status will tell you which part failed. Stop the other program, there is no
way to move tally to another port in the local setup.

> **Warning:** The local service uses a throwaway database. Do not point it at a shared database, and never run it against
> production data, because the development settings skip the safety checks that production has.

When something misbehaves, the first things to do are to look at the logs and to restart the part that you suspect. The
logs can be followed live, and a single part can be restarted without touching the others:

```
tally-cli logs tail --follow
tally-cli restart api
```

Restarting the API drops open connections for a moment, so do it when nobody is in the middle of a request. The ingest
workers have their own, gentler restart, which is covered in the on-call material rather than here.

## Everyday tasks

A few tasks come up often enough that you should know them by heart. The first is clearing the cache, which you need
whenever you change a roll-up definition and want to see the result immediately instead of waiting for entries to expire:

`tally-cli purge-cache`

It clears every region at once, so on a shared environment tell your colleagues first. The second is taking a backup
of your local database before you try something risky; the target directory is optional and defaults to a folder next to
where you run the command:

`tally-cli db backup --to ./backups`

The third is the certificates the service uses. Local development does not need real ones, but staging does, and knowing
how to list them with their expiry dates saves an embarrassing morning:

`tally-cli certs list`

Everything above is safe to run on your own machine. Most of the commands also work against staging if you pass the
host explicitly, and then the usual care applies.

> **Warning:** Anything that clears data or restarts a part is visible to everybody who uses the same environment. On
> staging, announce it in the team channel before you run it.

## Troubleshooting

Nine out of ten problems fall into three groups: the tool does not start, the service does not answer, or the data looks
stale. For the first, check the version command and the path as described above. For the second, run the status command
and look at which part is down; a part that is down can nearly always be brought back with a restart, and the logs will
say why it went down.

For stale data the question is whether the ingest queue is draining. The status output shows the queue depth, and a depth
that only grows is the sign. In that case do not wait for it to fix itself; ask on the on-call channel. If the disk of
your local database fills up, which can happen after a long session with debug logging, two housekeeping commands help.
The first reclaims space in the database and the second compresses old log files and removes those past retention:

```
tally-cli db vacuum
tally-cli logs rotate --keep 7
```

A word on how to read what the tool tells you, since new people tend to over-trust a green status. Green means that the
parts answer, not that the numbers are right. A service can be up and still be fed by an application that stopped sending
yesterday, so when a chart goes flat compare it with the application's own logs before you conclude that tally is at
fault. Likewise a red part is not always an emergency: on your own machine a stopped scheduler is normal when you have
not started the periodic jobs, and the status output says so in its last column if you look for it.

If none of that helps, write down what you ran and what you saw, and ask in the team channel. People here are glad to
help and would much rather answer a question early than debug a long afternoon later. A good question names the
command, the output and what you expected, and that is usually enough for somebody to answer in a minute.
""",
}

ARCHITECTURE = """\
# tally architecture

This document describes how tally is put together, why it looks the way it does, and what the team has learned from running it. It was started by Jonas during the first prototype and has been extended by almost everybody since, which is why some parts read like a diary. Readers in a hurry should skip to the sections on the ingest path and on retention; readers with time are welcome to read all of it, and corrections are always welcome in the team channel.

## Overview

Tally is a metrics-ingest service. Applications send small numeric events to the API on port 8731. The API allows 1,000 requests per minute per key and puts the events on a queue. Ingest workers write them to Postgres, and the roll-up workers turn them into minute and hour series that dashboards and alerting read. Tally takes about 40 million events per day and peaks at 2,500 events per second. The service is run by the on-call team, and the handbook in this repository is the source for every procedure named below.

The history is worth a paragraph, because it explains several oddities. The first prototype was a single Python process that wrote events straight into a table, and it listened on port 8080 because that was the default of the web framework the prototype used. It worked for a few dozen applications and then, one Monday morning in the spring, it did not work at all, which led to the first split into an API and a separate writer. Almost every component below is the product of a similar morning.

An aside on the name: tally was chosen in a meeting that ran long, from a list that also contained ledger, abacus and counter. Ledger lost because a product of the same name already existed in the sales catalogue, and abacus lost because nobody could agree on how to spell it in a configuration file. The name has never been a problem, but new colleagues ask about it often enough that it seemed worth writing down once.

## Components

The API is stateless and runs 3 replicas behind the load balancer. Ingest runs 4 ingest workers. The roll-up pool runs 6 roll-up workers, and the scheduler starts the periodic jobs. Each API replica has 2 vCPU and 4 GB of memory, and each ingest worker has 1 GB of memory. Behind them sit Postgres on port 5432 and the cache. Every component logs to standard output and exposes a health endpoint, and the health endpoint of the API answers on port 8731 as well.

The component list has changed shape more than once. At the beginning there was no scheduler at all: the periodic jobs were cron entries on one of the hosts, and when that host was replaced in the second year nobody remembered that the roll-ups depended on it, so the dashboards went flat for a day. The scheduler exists because of that day. Likewise the roll-up pool used to be a thread inside the ingest worker, which meant that a slow roll-up could stop events from being written, and that coupling was removed as soon as it was understood.

## Ingest path

Events enter a queue with 12 partitions. Workers take events in batches of 500, and an event larger than 64 KB is rejected at the API with an error that names the series. A worker that has not acknowledged a batch within 45 seconds loses it to another worker. The queue and worker settings are:

```yaml
queue:
  partitions: 12
  batch_size: 500
  ack_timeout: 45s
workers:
  ingest: 4
```

Partitioning deserves some history. The queue was a single partition for the first year, because ordering within a series mattered to the first roll-up implementation and one partition gave ordering for free. When the volume grew, the roll-up code was changed to tolerate events arriving slightly out of order, and the queue went to 3 partitions, then to the present number. The batch size was 100 events at first and was raised after a measurement showed that most of the time was spent on round trips to the database rather than on the writes themselves.

A recurring question is why a malformed batch can block a partition. The consumer retries a batch until it succeeds, which is the right behaviour for a database that is briefly unavailable and the wrong behaviour for a batch that can never be parsed. A fix that parks such a batch after a few attempts has been discussed several times, and each time it was postponed in favour of something that looked more urgent. This paragraph is here mostly so that the next person to ask does not have to rediscover the discussion.

## Storage

Postgres 16 stores the raw events in a partitioned table and the roll-ups in two further tables. The database disk is 800 GB. Raw events are written to daily partitions of about 18 GB each. Backups run at 01:00 and are kept for 10 days, and a backup that fails raises an alert in the same way as a full disk does. The raw table is defined as:

```sql
CREATE TABLE events_raw (ts timestamptz, series text, value double precision) PARTITION BY RANGE (ts);
CREATE INDEX ON events_raw (series, ts);
```

Before Postgres, the events were stored in a time-series database that the team had adopted on the strength of a conference talk. It was fast at first and then increasingly hard to operate, and the move to Postgres was less a technical decision than a recognition that everybody on the team already knew how to run it at three in the morning. The migration took two months and was done without downtime, mostly because Priya insisted on running both stores side by side for a week and comparing every dashboard by hand.

Table bloat is a topic of its own. Because roll-ups rewrite rows, the tables bloat steadily, and the vacuum has to keep up. The online vacuum is slower than the plain one but does not block writers, which is why it is the one to use in production; the postmortem for the August incident explains in some detail what happens when it is not used. Nothing in this section changes that advice, and the storage numbers above should be read with it in mind.

## Data retention

Retention is applied every night at 02:00 by the scheduler, one partition at a time, so the load on the database stays flat. The rules are:

1. Raw events are kept for 7 days and then deleted.
2. Minute roll-ups are kept for 90 days.
3. Hour roll-ups are kept for 24 months.
4. Parked batches in the dead-letter table are deleted after 21 days.

These numbers are not the original ones. Raw events were kept for 3 days at the beginning, which was enough for the first dashboards and far too little for anybody who wanted to investigate a problem noticed on the Monday after a weekend. The change to a week came with the first complaint of that kind. The minute series were kept for 30 days and the hour series for a year until the storage budget was reviewed and found to allow more, and the longer periods were agreed without much argument.

The reasoning behind the rules is worth restating, since it comes up in every planning cycle. Raw events are by far the largest part of the data and by far the least often read after the first day. Minute series answer the questions of the week and the month. Hour series answer the questions of the year. Teams that need a finer resolution for longer than the rules allow are asked to decide what they want to measure before they start sending, and not afterwards, because the raw events cannot be recovered once they are gone.

## Caching

The cache listens on port 6379 and is organised in 3 regions. Entries expire after 300 seconds. The cache is cleared with the cache clear command, which clears all regions unless one is named. The cache holds 16 GB and is warmed after every restart by replaying the most recent hour of queries, which takes about 4 minutes. A chart that is stale for one region and correct for another is a cache question before it is anything else.

The cache has a longer history than its size suggests. It began as a dictionary inside the API process, which meant that every replica had its own opinion about what a chart looked like, and a user who refreshed the page could see two different answers in a row. The move to a shared cache fixed that and introduced the problem of invalidation, which everybody warned about and nobody believed until a stale chart stayed on a wall display for most of a week.

Incidentally, the old purge command that cleared the cache was removed because it sometimes left half of the entries in place. Several runbooks still described it for a while, and a few scripts were found calling it after the removal. Nothing is lost by its absence, and the replacement does what the old one was always supposed to do, so there is nothing further to say about the matter except that people should not be surprised to meet the old name in old documents.

## Deployment

A release is rolled out one service at a time, and the API is restarted last. The rollout waits 5 minutes between services and stops if the error rate rises above 2 percent. Releases go to staging first and stay there for 1 day. A release is never started on a Friday afternoon unless it fixes an outage. Check the state and the settings before and after:

```
tallyctl status --json
tallyctl restart api --timeout 120
tallyctl config show
```

Deployments used to be a ceremony. For a long while a release meant a person logging in to each host in turn, and the person was usually Tomasz, who built up a mental list of things that could go wrong and recited it before every release. The list was eventually written down, then automated, and the ceremony disappeared, which everybody agrees is an improvement even though it removed one of the few occasions on which the whole team stood in the same room.

It should be said that the load balancer configuration lives outside this repository and is owned by Sunil, who changes it rarely and carefully. Anyone who needs a change to it should ask in the team channel and not edit it, however obvious the change looks. This is not distrust; it is the recognition that the load balancer is the one component where a small mistake is visible to every customer within seconds.

## Failure handling

A stuck ingest queue is cleared with a drain restart. A full database disk is handled with an online vacuum and then a log rotation; the disk alert fires at 80 percent. Logs keep the last 14 files. A page that nobody acknowledges escalates after 15 minutes, first to the secondary on-call and then to the engineering manager. Between 22:00 and 07:00 the pager is used only for severity 1, and severity 2 waits for business hours. An alert on the days left of each certificate fires at 14 days.

```
tallyctl restart ingest --drain
tallyctl db vacuum --online
tallyctl logs rotate --keep 14
```

The escalation rule has a history of its own. For a short time the wait before a page moved to the next person was 30 minutes, which turned out to be far too long when the first person had not even seen the page, and the earlier figure was dropped after a review. The path itself, from the primary to the secondary and then to the engineering manager, has not changed, and neither has the rule that the night pager is used only for the most serious incidents.

Finally, a note on how to read this section. The two incidents of late summer are described in their own postmortems, and this document deliberately does not repeat their timelines. What matters here is the pattern: both were slow to diagnose because the first suspect was wrong, and both were quick to fix once the right command was known. The commands above are the right ones, and the habit of writing down what was run while it is being run is the real lesson.
"""

# --------------------------------------------------------------------------------------------------------------------
# The chat export and the sales data (deterministic)
# --------------------------------------------------------------------------------------------------------------------

NAMES = ["mara", "jonas", "priya", "tomasz", "elif", "sunil", "nadia", "felix", "ingrid", "ollie"]
SEEN = {
    "pager": "ok the new paging thing is called Beacon btw, blue owl icon, install the app and log in with SSO before your first shift",
    "security": "for anything security related, don't go through the secondary, page the security lead directly. that's the whole point of the separate path",
}
CHAT = [
    "anyone else's vpn dropping every ten minutes or is it just me",
    "just you, mine has been solid all week",
    "restarted the laptop, seems fine now. computers.",
    "lunch? the new ramen place on the corner finally opened",
    "yes. 12:30 outside?",
    "I'll pass, I have a dentist thing at one",
    "did the staging deploy finish? the dashboard looks different",
    "it did, sunil rebuilt the node pool this morning, colours are slightly off I think",
    "https://example.com/blog/why-your-p99-lies",
    "this is a good read, the part about coordinated omission made me wince",
    "reading it now",
    "who has the good HDMI adapter, the one that works",
    "second drawer, under the cables nobody dares to throw away",
    "found it, thanks",
    "can someone review my PR? it's tiny, fixes a typo in the dashboard title",
    "on it",
    "approved, though now I'm worried about how many typos are out there",
    "there is a typo in the typo fix.",
    "NO",
    "kidding. it's fine",
    "has anyone seen the thing where grafana shows 0 for a second after a deploy",
    "yeah that's the scrape gap, it goes away. ignore it",
    "i keep not ignoring it",
    "coffee machine is broken again",
    "I descaled it on Friday and now it's worse, sorry",
    "the one on the 3rd floor works",
    "heading to the 3rd floor then",
    "reminder: all-hands moved to thursday",
    "thanks, was about to be an hour early",
    "anyone know a good book on distributed systems that isn't a textbook",
    "designing data-intensive applications, but you've read it already",
    "I want a different one!",
    "the morning paper archive, it is basically free",
    "https://example.com/talks/postmortem-theatre",
    "watching during lunch, thanks for the link",
    "my cat just walked over the keyboard and deployed to nothing",
    "luckily nothing to deploy",
    "whose turn is it to write the weekly summary",
    "ollie's, I think",
    "yes mine, will do it tomorrow",
    "tomorrow is today now, just saying",
    "ha. after standup then",
    "does anyone remember the name of that cafe with the chess boards",
    "knight something? Knight's Move?",
    "that's it!",
    "can't believe it's already october almost",
    "the year is a lie",
    "bike to work today, rain all the way, do not recommend",
    "I recommend the tram",
    "the tram was cancelled",
    "of course it was",
    "someone left the oven on in the kitchen. it's off now",
    "thank you, hero",
    "quick poll: tabs or spaces",
    "do not start this",
    "tabs.",
    "I'm leaving the channel",
    "the retention graph looks flat again, nothing to see",
    "that's what we want",
    "is the build slow for anyone else? 11 minutes for me",
    "cache is cold after the runner update, second run will be faster",
    "second run: 4 minutes, thanks",
    "found a bug in the timezone handling of the weekly report, will open a ticket",
    "ticket please, I'll look on thursday",
    "https://example.com/wiki/timezones-are-hard",
    "yes they are",
    "who brought the cake? it's gone",
    "elif. it was for her birthday.",
    "happy birthday elif!!",
    "thank you! 🎂",
    "I will need someone to cover my afternoon on friday, kid's school thing",
    "I can, just tell me what's open",
    "nothing really, just watch the channel",
    "deal",
    "the lift is out of order again",
    "good for cardio",
    "not my knees",
    "does the office have a spare monitor stand",
    "storage room, the grey one",
    "perfect, back is thanking you",
    "I think the alert on queue depth is too chatty, can we raise the threshold?",
    "let's talk about it in the sync",
    "fair",
    "looking at the capacity numbers for next quarter, we're fine",
    "great, one less thing",
    "podcast recommendations for the commute?",
    "anything by the engineering people who talk too long, I love it",
    "hah",
    "my fridge shelf got cleaned out, I miss the hummus",
    "it was three weeks old, I'm sorry",
    "was it really",
    "yes",
    "ok fair",
]
BEATS = [
    "heads up, I'm swapping shifts with {n} next week",
    "can you confirm you got the calendar invite for the on-call handover?",
    "handover notes are in the wiki, please read before your first night",
    "ack, will read tonight",
    "I'm on call and the phone is face down on the bed again, someone remind me to buy a louder one",
    "just reviewed the runbook draft, it's missing a few things but better than nothing",
    "do we have a place to put on-call tips? I keep forgetting stuff between shifts",
    "wiki page, under team handbook",
    "added a note about the vpn thing",
]


def chat_text() -> str:
    rnd = random.Random(20260902)
    lines = []
    t = date(2026, 8, 24)
    minute = 9 * 60
    total = 1500
    plant = {int(total * 0.37): SEEN["pager"], int(total * 0.74): SEEN["security"]}
    for i in range(total):
        minute += rnd.choice([1, 2, 3, 5, 8, 13, 21, 55, 130, 400])
        while minute >= 22 * 60:
            minute = 9 * 60 + rnd.randint(0, 40)
            t += timedelta(days=1)
            while t.weekday() >= 5:
                t += timedelta(days=1)
        name = rnd.choice(NAMES)
        if i in plant:
            text = plant[i]
        elif rnd.random() < 0.08:
            text = rnd.choice(BEATS).format(n=rnd.choice(NAMES))
        else:
            text = rnd.choice(CHAT)
        lines.append(f"[{t.isoformat()} {minute // 60:02d}:{minute % 60:02d}] {name}: {text}")
    return "# #oncall export\n" + "\n".join(lines) + "\n"


REGIONS = ["North", "South", "East", "West", "Central"]
PRODUCTS = {"Ledger Pro": 49.0, "Ledger Lite": 19.0, "Tally Sync": 29.0, "Tally Mobile": 9.5, "Audit Add-on": 79.0, "Report Pack": 14.5}
PLANT_REGION, PLANT_PRODUCT, TRAP_REGION = "East", "Ledger Pro", "West"


def quarter(d: str) -> int:
    return (int(d[5:7]) - 1) // 3 + 1


def sales_rows(n: int = 40000):
    rnd = random.Random(7_2026)
    days = [date(2026, 1, 1) + timedelta(days=i) for i in range(365)]
    rows = []
    while len(rows) < n:
        d = rnd.choice(days)
        q = (d.month - 1) // 3 + 1
        region = rnd.choice(REGIONS)
        product = rnd.choices(list(PRODUCTS), weights=[3, 4, 3, 5, 1, 3])[0]
        if region == PLANT_REGION and product == PLANT_PRODUCT and q == 3 and rnd.random() > 0.25:
            continue  # the planted drop
        if region == PLANT_REGION and q == 3 and rnd.random() > 0.9:
            continue  # the rest of that region softens a little
        if region == TRAP_REGION and q == 3 and rnd.random() > 0.8:
            continue
        cancelled = 0.45 if (region == TRAP_REGION and q == 2) else 0.05
        r = rnd.random()
        status = "cancelled" if r < cancelled else "pending" if r < cancelled + 0.06 else "completed"
        units = rnd.randint(1, 14)
        if rnd.random() < 0.03:
            units = -rnd.randint(1, 4)
        if status == "cancelled" and region == TRAP_REGION and q == 2:
            units = rnd.randint(8, 30)
        price = round(PRODUCTS[product] * rnd.uniform(0.92, 1.08), 2)
        rows.append((d.isoformat(), region, product, units, f"{price:.2f}", status))
    rows.sort()
    return rows


def sales_csv() -> str:
    out = ["date,region,product,units,unit_price,status"]
    out += [",".join(map(str, r)) for r in sales_rows()]
    return "\n".join(out) + "\n"


def build(repo: Path):
    repo.mkdir(parents=True, exist_ok=True)
    files = dict(FILES)
    files["sources/oncall-chat-export.txt"] = chat_text()
    files["data/sales.csv"] = sales_csv()
    for rel, text in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    git = ["git", "-c", "user.email=bench@local", "-c", "user.name=bench"]
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "handbook"], cwd=repo, check=True)
    subprocess.run(["git", "tag", "base"], cwd=repo, check=True)


def plant(task: str, repo: Path):
    """doc-6-trim cuts a long document that only that task has: written, committed, and the `base` tag moved onto it."""
    if task != "doc-6-trim":
        return
    (repo / "docs/architecture.md").write_text(ARCHITECTURE)
    git = ["git", "-c", "user.email=bench@local", "-c", "user.name=bench"]
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run([*git, "commit", "-q", "-m", "architecture"], cwd=repo, check=True)
    subprocess.run(["git", "tag", "-f", "base"], cwd=repo, check=True, capture_output=True)


# --------------------------------------------------------------------------------------------------------------------
# The tasks
# --------------------------------------------------------------------------------------------------------------------

FAQ_QUESTIONS = [
    "How do I install the command line tool?",
    "What is the tool called now?",
    "Which port does tally listen on?",
    "How do I clear the cache?",
    "How long until an unanswered page escalates?",
    "Does the pager wake me at night?",
    "What do I do when the ingest queue is stuck?",
    "What do I do when the API certificate has expired?",
]

TASKS = {
    "doc-1-runbook": {
        "kind": "edit",
        "prompt": "Write docs/oncall-runbook.md for whoever is on call, from what is in sources/: the escalation path (who, after how many "
        "minutes), when to page at night, how to restart each service with the exact commands, and the known failure modes with their fixes. "
        "Use only facts from the sources, the latest decision where they changed. At most 900 words.",
    },
    "doc-2-revise": {
        "kind": "edit",
        "prompt": "docs/guide.md is too long and out of date. Revise it in place: at most 700 words, keep its structure (title and sections) "
        "and its three warnings, keep every command it shows unless the sources say it was removed or renamed (then use the current one), "
        "and bring it up to date with the decisions in sources/.",
    },
    "doc-3-analysis": {
        "kind": "edit",
        "prompt": "data/sales.csv holds this year's sales. Revenue is units × unit_price over completed rows only (refunds are negative units "
        "and count). Which region's revenue fell the most from Q2 to Q3 in percent, by how much, and which product accounts for the largest "
        "part of that region's drop in absolute revenue? Write reports/q3-drop.md: one short paragraph and a table of that region's revenue "
        "per quarter (Q1–Q4). End your reply with one line: `region; drop %; product`.",
    },
    "doc-4-brief": {
        "kind": "edit",
        "prompt": "Write reports/incidents-brief.md: a brief for leadership on the two postmortems in sources/incident-*.md, at most 200 words. "
        "For each incident give its date, its impact in plain terms (how long, who was affected), its root cause and its fix, and then every "
        "follow-up action with its owner and whether it is still open or done (the meeting notes in sources/ say where an action was done). "
        "Leadership does not read commands: no command names and no code.",
    },
    "doc-5-faq": {
        "kind": "edit",
        "prompt": "Write docs/faq.md for newcomers: answer these eight questions, each under a heading `## <question>` exactly as written, in this "
        "order:\n" + "\n".join(f"{i}. {q}" for i, q in enumerate(FAQ_QUESTIONS, 1)) + "\nUse the current facts from sources/ (the latest "
        "decision where they changed) and give the command in a code span where the question is about doing something. At most 300 words "
        "in total, headings included.",
    },
    "doc-6-trim": {
        "kind": "edit",
        "prompt": "docs/architecture.md is far too long. Cut it in place to at most 800 words: keep every section heading, every code block exactly "
        "as it is, the four numbered rules in Data retention, and every number the document states that is about the system as it runs today "
        "(a fixed list of them is checked). Drop history, repetition and asides.",
    },
}

# --------------------------------------------------------------------------------------------------------------------
# Grading
# --------------------------------------------------------------------------------------------------------------------


def words(text: str) -> int:
    return len(text.split())


def code_of(text: str) -> str:
    """The content of code blocks and code spans, one piece per line."""
    parts = re.findall(r"```[^\n]*\n(.*?)```", text, re.S)
    rest = re.sub(r"```[^\n]*\n.*?```", "", text, flags=re.S)
    parts += re.findall(r"`([^`\n]+)`", rest)
    return "\n".join(" ".join(p.split()) if "\n" not in p else "\n".join(" ".join(l.split()) for l in p.splitlines()) for p in parts)


# A sentence that names a stale fact as history, not as what to do now ("the earlier 30-minute wait was dropped",
# "formerly tally-cli"): a reviewer accepts that; the checks fail only stale facts given as current.
HISTORY = re.compile(r"\b(earlier|previous(ly)?|former(ly)?|old|older|dropped|replaced|renamed|used to|no longer|until|instead of|"
                     r"removed|changed|moved from|alias|deprecated|retired|gone|superseded)\b")


def stale_as_current(text: str, stale: str, about: str = "", command: str = "") -> bool:
    """Whether the text gives `stale` (a regex) as current: a sentence that matches it, and `about` where given, with no
    history marker; or a fenced code block that matches `command` (the stale thing as a command to run). Code spans
    inside a sentence are judged by their sentence: "the old `tally-cli purge-cache` was removed" is history."""
    fenced = "\n".join(re.findall(r"```[^\n]*\n(.*?)```", text, re.S))
    if command and re.search(command, fenced.lower()):
        return True
    for s in re.split(r"(?<=[.!?])\s+|\n", re.sub(r"```.*?```", "", text, flags=re.S).lower()):
        if re.search(stale, s) and (not about or re.search(about, s)) and not HISTORY.search(s):
            return True
    return False


def known_commands(repo: Path) -> set:
    """From the tool reference: the headings `tallyctl a [b] [<arg>]`, as tuples of the words before any argument."""
    known = set()
    for m in re.finditer(r"^## tallyctl ([^\n]+)$", (repo / "sources/tools.md").read_text(), re.M):
        w = []
        for tok in m.group(1).split():
            if not re.fullmatch(r"[a-z][a-z-]*", tok):
                break
            w.append(tok)
        known.add(tuple(w))
    return known


def grade_runbook(repo: Path) -> dict:
    f = repo / "docs/oncall-runbook.md"
    if not f.is_file():
        names = ["exists", "words", "escalation_order", "minutes_15", "no_30", "night_rule", "security_lead", "beacon",
                 "restarts", "fix_ingest", "fix_disk", "fix_tls", "new_cli_only", "no_removed", "no_invented"]
        return {n: False for n in names}
    t = f.read_text()
    low = t.lower()
    c = {"exists": True, "words": words(t) <= 900}
    i = low.find("primary")
    j = low.find("secondary", i + 1) if i >= 0 else -1
    k = low.find("manager", j + 1) if j >= 0 else -1
    c["escalation_order"] = i >= 0 and j > i and k > j
    c["minutes_15"] = bool(re.search(r"\b15[\s-]*(min|minutes)\b|\bfifteen[\s-]*min", low))
    c["no_30"] = not stale_as_current(t, r"\b30[\s-]*min|\bthirty[\s-]*min|half an hour|half-hour", r"escalat|acknowledg|\bpage")
    c["night_rule"] = bool(re.search(r"22:00|10\s?pm", low) and re.search(r"07:00|7\s?am", low)
                           and re.search(r"sev(erity)?[\s-]*1", low) and re.search(r"sev(erity)?[\s-]*2", low)
                           and re.search(r"business hours|working hours|office hours|morning", low))
    sentences = re.split(r"(?<=[.!?])\s+|\n", low)
    c["security_lead"] = any("security lead" in s and re.search(r"direct|skip|straight|bypass|without|not the secondary|instead", s) for s in sentences)
    c["beacon"] = bool(re.search(r"\bbeacon\b", low))
    code = code_of(t)
    c["restarts"] = all(re.search(rf"tallyctl restart {s}\b", code) for s in ("api", "ingest", "worker", "scheduler"))
    c["fix_ingest"] = "tallyctl restart ingest --drain" in code
    c["fix_disk"] = "tallyctl db vacuum --online" in code and "tallyctl logs rotate" in code
    c["fix_tls"] = "tallyctl certs renew api" in code and "tallyctl restart api" in code
    c["new_cli_only"] = "tallyctl" in low and not stale_as_current(t, r"tally-cli", command=r"tally-cli[ \t]+[a-z]")
    c["no_removed"] = not stale_as_current(t, r"purge-cache|purge cache", command=r"purge-cache")
    known = known_commands(repo)
    bad = []
    for m in re.finditer(r"\btallyctl((?: +[a-z][a-z-]*)*)", code):
        w = tuple(m.group(1).split()[:2])
        if w and not any(w[: len(v)] == v for v in known):
            bad.append(" ".join(w))
    c["no_invented"] = not bad
    return c


GUIDE_H2 = ["What tally is", "Installing the command line tool", "Running the service", "Everyday tasks", "Troubleshooting"]


def guide_base_commands(repo: Path):
    import subprocess as sp
    old = sp.run(["git", "show", "base:docs/guide.md"], cwd=repo, capture_output=True, text=True, check=True).stdout
    out = []
    for line in code_of(old).splitlines():
        line = line.replace("tally-cli purge-cache", "tallyctl cache clear").replace("tally-cli", "tallyctl").replace("8080", "8731")
        out.append(line.strip())
    return [x for x in out if x]


def grade_guide(repo: Path) -> dict:
    f = repo / "docs/guide.md"
    t = f.read_text() if f.is_file() else ""
    low = t.lower()
    c = {"words": bool(t) and words(t) <= 700}
    h1 = re.findall(r"^# (.+)$", t, re.M)
    h2 = [h.strip() for h in re.findall(r"^## (.+)$", t, re.M)]
    c["headings"] = h1 == ["Getting started with tally"] and h2 == GUIDE_H2
    c["warnings"] = len(re.findall(r"^> \*\*Warning:\*\*", t, re.M)) == 3
    code = code_of(t)
    c["commands"] = bool(t) and all(cmd in code for cmd in guide_base_commands(repo))
    c["no_old_cli"] = bool(t) and not stale_as_current(t, r"tally-cli", command=r"tally-cli[ \t]+[a-z]")
    c["no_old_port"] = bool(t) and not stale_as_current(t, r"\b8080\b", command=r":8080\b|port[ =]+8080\b")
    c["new_port"] = "8731" in t
    c["no_purge"] = bool(t) and not stale_as_current(t, r"purge", command=r"purge-cache")
    return c


def sentences(text: str) -> list:
    return re.split(r"(?<=[.!?])\s+|\n", re.sub(r"```.*?```", "", text, flags=re.S).lower())


def sections(text: str) -> dict:
    """Heading -> body for each `## ` section."""
    parts = re.split(r"^## (.+)$", text, flags=re.M)
    return {parts[i].strip(): parts[i + 1] for i in range(1, len(parts) - 1, 2)}


def invented_commands(code: str, repo: Path) -> list:
    known, bad = known_commands(repo), []
    for m in re.finditer(r"\btallyctl((?: +[a-z][a-z-]*)*)", code):
        w = tuple(m.group(1).split()[:2])
        if w and not any(w[: len(v)] == v for v in known):
            bad.append(" ".join(w))
    return bad


DONE = re.compile(r"\b(done|complete[d]?|finished|closed|resolved|live|configured|switched on|set up|in place|fixed|shipped)\b")
OPEN = re.compile(r"\b(open|still|not yet|pending|outstanding|in progress|in review|remains?|unfinished|not (been )?(built|added|done))\b")
# (label, keyword regex, owner, done?) for each follow-up action of the two postmortems
BRIEF_ACTIONS = [
    ("disk_alert", r"disk|80", "sunil", True),
    ("poisoned_batch", r"poison|malformed|batch|wedg", "jonas", False),
    ("cert_reminder", r"reminder|calendar", "priya", True),
    ("days_left_alert", r"days[\s-]*left|days (remaining|to expir)|expir\w* alert|alert on (the )?(days|expir|certificate)", "priya", False),
    ("weekly_checklist", r"checklist", "tomasz", False),
    ("write_down_commands", r"writ\w* down|record|handover", "mara", True),
]


def grade_brief(repo: Path) -> dict:
    f = repo / "reports/incidents-brief.md"
    names = ["exists", "words", "aug_date", "sep_date", "aug_duration", "sep_duration", "aug_impact", "sep_impact", "aug_cause",
             "sep_cause", "aug_fix", "sep_fix"] + [f"action_{a[0]}" for a in BRIEF_ACTIONS] + ["no_code"]
    if not f.is_file():
        return {n: False for n in names}
    t = f.read_text()
    low = t.lower()
    ss = sentences(t)
    c = {"exists": True, "words": words(t) <= 200}
    c["aug_date"] = bool(re.search(r"\b11 aug|aug(ust)? 11\b|\b2026-08-11|\b11/08|\b08-11", low))
    c["sep_date"] = bool(re.search(r"\b21 sep|sep(tember)? 21\b|\b2026-09-21|\b21/09|\b09-21", low))
    c["aug_duration"] = bool(re.search(r"two and a half|2\.5|2½|2 1/2|150 min|2 h(ou)?rs? (and )?30", low))
    c["sep_duration"] = bool(re.search(r"\b47[\s-]*min|\b47 m\b", low))
    c["aug_impact"] = bool(re.search(r"stale|out[\s-]of[\s-]date|outdated|delayed|old data", low)) and bool(
        re.search(r"no (data )?(was |were )?(lost|loss)|nothing (was )?lost|no data loss|without (any )?(data )?loss|not lose|did not lose|never lost", low))
    c["sep_impact"] = any(re.search(r"api", s) and re.search(r"client|customer|user|brows|connect|certificate error|unavailable|down|outage|failed", s)
                          for s in ss)
    c["aug_cause"] = bool(re.search(r"malformed|poison|corrupt|bad batch|broken batch|unparseable", low))
    c["sep_cause"] = bool(re.search(r"expire", low)) and bool(re.search(r"renew\w*[^.]{0,80}(fail|silent|broke|did not|didn't)|(fail|silent)\w*[^.]{0,80}renew", low))
    c["aug_fix"] = bool(re.search(r"drain|park|dead[\s-]letter|isolat|set aside|quarantin|restart", low)) and bool(re.search(r"vacuum|rotat|log", low))
    c["sep_fix"] = bool(re.search(r"renew", low)) and bool(re.search(r"restart", low))
    for label, kw, owner, done in BRIEF_ACTIONS:
        ok = False
        for s in ss:
            if re.search(kw, s) and owner in s:
                ok |= bool(DONE.search(s)) and not OPEN.search(s) if done else bool(OPEN.search(s))
        c[f"action_{label}"] = ok
    c["no_code"] = "`" not in t and not re.search(r"tallyctl|tally-cli|\s--[a-z]|\bpurge-cache|\bcerts renew", low)
    return c


def grade_faq(repo: Path) -> dict:
    f = repo / "docs/faq.md"
    names = ["exists", "words", "questions", "answered", "install", "name", "port", "cache", "escalation", "night", "stuck_queue",
             "certificate", "code_spans", "no_old_cli", "no_old_port", "no_old_wait", "no_purge", "no_invented"]
    if not f.is_file():
        return {n: False for n in names}
    t = f.read_text()
    sec = sections(t)
    heads = [h.strip() for h in re.findall(r"^## (.+)$", t, re.M)]
    Q = FAQ_QUESTIONS
    body = [sec.get(q, "") for q in Q]
    code = [code_of(b) for b in body]
    c = {"exists": True, "words": words(t) <= 300, "questions": heads == Q, "answered": all(words(b) >= 8 for b in body)}
    c["install"] = "pipx install tally-toolkit" in code[0] and "3.11" in body[0]
    b = body[1].lower()
    c["name"] = "tallyctl" in b and bool(re.search(r"alias|one more release|renam|replaces|formerly|old name|was called", b))
    c["port"] = "8731" in body[2]
    c["cache"] = "tallyctl cache clear" in code[3] and "--region" in code[3] + body[3]
    b = body[4].lower()
    i = b.find("primary")
    j = b.find("secondary", i + 1) if i >= 0 else -1
    c["escalation"] = bool(re.search(r"\b15[\s-]*min|\bfifteen[\s-]*min", b)) and i >= 0 and j > i and b.find("manager", j + 1) > j
    b = body[5].lower()
    c["night"] = bool(re.search(r"22:00|10\s?pm", b) and re.search(r"07:00|7\s?am", b) and re.search(r"sev(erity)?[\s-]*1", b)
                      and re.search(r"sev(erity)?[\s-]*2", b) and re.search(r"business hours|working hours|office hours|morning", b))
    c["stuck_queue"] = "tallyctl restart ingest --drain" in code[6]
    r, s2 = code[7].find("tallyctl certs renew api"), code[7].find("tallyctl restart api")
    c["certificate"] = r >= 0 and s2 > r
    # The questions about doing something (install, clear the cache, the stuck queue, the certificate); the port is a fact.
    c["code_spans"] = all(code[i].strip() for i in (0, 3, 6, 7))
    c["no_old_cli"] = "tallyctl" in t.lower() and not stale_as_current(t, r"tally-cli", command=r"tally-cli[ \t]+[a-z]")
    c["no_old_port"] = not stale_as_current(t, r"\b8080\b", command=r":8080\b|port[ =]+8080\b")
    c["no_old_wait"] = not stale_as_current(t, r"\b30[\s-]*min|\bthirty[\s-]*min|half an hour|half-hour", r"escalat|acknowledg|\bpage")
    c["no_purge"] = not stale_as_current(t, r"purge", command=r"purge-cache")
    c["no_invented"] = not invented_commands(code_of(t), repo)
    return c


ARCH_H2 = ["Overview", "Components", "Ingest path", "Storage", "Data retention", "Caching", "Deployment", "Failure handling"]
# (label, number regex, keyword regex): a sentence with both, for each number the document states about the system today
ARCH_NUMBERS = [
    ("api_port", r"\b8731\b", r"port|api"), ("rate_limit", r"\b1,?000\b", r"request|rate|limit"),
    ("volume", r"\b40 million\b", r"event|day"), ("peak", r"\b2,?500\b", r"second|peak"),
    ("api_replicas", r"\b3\b|three", r"replica"), ("ingest_workers", r"\b4\b|four", r"ingest"),
    ("rollup_workers", r"\b6\b|six", r"roll"), ("api_size", r"\b2 ?vcpu\b.*\b4 ?gb|\b4 ?gb.*\b2 ?vcpu", r"api|replica"),
    ("worker_memory", r"\b1 ?gb\b", r"ingest|worker"), ("partitions", r"\b12\b|twelve", r"partition|queue"),
    ("batch_size", r"\b500\b", r"batch|event"), ("max_event", r"\b64 ?kb\b", r"event|reject|larger"),
    ("ack_timeout", r"\b45 ?s", r"ack|batch|worker"), ("postgres_port", r"\b5432\b", r"postgres|port"),
    ("disk", r"\b800 ?gb\b", r"disk|database"), ("partition_size", r"\b18 ?gb\b", r"partition|raw"),
    ("backups", r"\b10 days\b", r"backup"), ("retention_job", r"\b02:00\b", r"retention|night|scheduler"),
    ("cache_port", r"\b6379\b", r"cache|port"), ("cache_regions", r"\b3\b|three", r"region"),
    ("cache_ttl", r"\b300 seconds\b|\b5 minutes\b", r"expire|entries|ttl"), ("cache_size", r"\b16 ?gb\b", r"cache"),
    ("rollout_wait", r"\b5 minutes\b", r"rollout|between services|wait"), ("rollout_stop", r"\b2 percent\b|\b2%", r"error rate|rollout|stop"),
    ("staging", r"\b1 day\b", r"staging"), ("disk_alert", r"\b80 percent\b|\b80%", r"disk|alert"),
    ("log_files", r"\b14\b", r"log|file"), ("escalation", r"\b15[\s-]*min|\bfifteen[\s-]*min", r"escalat|acknowledg|page"),
    ("night_pager", r"22:00", r"pager|night|severity"), ("cert_alert", r"\b14 days\b", r"certificate|alert"),
]
ARCH_RULES = [("rule_raw", r"raw", r"\b7 days\b|\bweek\b"), ("rule_minute", r"minute", r"\b90 days\b"),
              ("rule_hour", r"hour", r"\b24 months\b|\b2 years\b|\btwo years\b"), ("rule_dead_letter", r"dead|parked", r"\b21 days\b")]


def grade_trim(repo: Path) -> dict:
    f = repo / "docs/architecture.md"
    names = (["exists", "words", "title", "headings", "code_blocks", "retention_rules"] + [r[0] for r in ARCH_RULES]
             + [n[0] for n in ARCH_NUMBERS] + ["no_old_port", "no_old_wait", "no_old_retention"])
    if not f.is_file():
        return {n: False for n in names}
    t = f.read_text()
    low = t.lower()
    fits = words(t) <= 800
    c = {"exists": True, "words": fits}
    if not fits:   # a text over the limit has not been cut: nothing else counts
        c.update({n: False for n in names if n not in c})
        return c
    c["title"] = re.findall(r"^# (.+)$", t, re.M) == ["tally architecture"]
    c["headings"] = [h.strip() for h in re.findall(r"^## (.+)$", t, re.M)] == ARCH_H2
    blocks = re.findall(r"```[^\n]*\n.*?```", t, re.S)
    c["code_blocks"] = blocks == re.findall(r"```[^\n]*\n.*?```", ARCHITECTURE, re.S)
    ret = sections(t).get("Data retention", "")
    rules = re.findall(r"^\s*(\d+)\.\s+(.+)$", ret, re.M)
    c["retention_rules"] = [n for n, _ in rules] == ["1", "2", "3", "4"]
    for label, kw, num in ARCH_RULES:
        c[label] = any(re.search(kw, r.lower()) and re.search(num, r.lower()) for _, r in rules)
    ss = sentences(t)
    for label, num, kw in ARCH_NUMBERS:
        c[label] = any(re.search(num, s) and re.search(kw, s) for s in ss)
    c["no_old_port"] = not stale_as_current(t, r"\b8080\b", command=r":8080\b|port[ =]+8080\b")
    c["no_old_wait"] = not stale_as_current(t, r"\b30[\s-]*min|\bthirty[\s-]*min|half an hour|half-hour", r"escalat|acknowledg|\bpage")
    c["no_old_retention"] = not stale_as_current(t, r"\b3 days\b|\b30 days\b|\b1 year\b|\ba year\b", r"raw|minute|hour|kept|retain|retention")
    return c


def revenue(repo: Path):
    """Completed-only revenue per region and quarter, and per region, quarter and product."""
    rq, rqp = defaultdict(float), defaultdict(float)
    with open(repo / "data/sales.csv", newline="") as fh:
        for r in csv.DictReader(fh):
            if r["status"] != "completed":
                continue
            v = int(r["units"]) * float(r["unit_price"])
            q = quarter(r["date"])
            rq[r["region"], q] += v
            rqp[r["region"], q, r["product"]] += v
    return rq, rqp


def truth(repo: Path) -> dict:
    rq, rqp = revenue(repo)
    drops = {r: (rq[r, 2] - rq[r, 3]) / rq[r, 2] * 100 for r in REGIONS}
    region = max(drops, key=drops.get)
    prods = {p: rqp[region, 2, p] - rqp[region, 3, p] for p in PRODUCTS}
    return {"region": region, "drop": drops[region], "amount": rq[region, 2] - rq[region, 3], "product": max(prods, key=prods.get),
            "quarters": [rq[region, q] for q in (1, 2, 3, 4)]}


def grade_analysis(repo: Path, answer: str) -> dict:
    tr = truth(repo)
    last = next((l for l in reversed(answer.strip().splitlines()) if l.strip()), "").strip().strip("`")
    parts = [p.strip() for p in last.split(";")]
    region = parts[0] if parts else ""
    m = re.search(r"-?\d+(?:\.\d+)?", parts[1]) if len(parts) > 1 else None
    f = repo / "reports/q3-drop.md"
    t = f.read_text() if f.is_file() else ""
    nums = [abs(float(x.replace(",", ""))) for x in re.findall(r"\d[\d,]*(?:\.\d+)?", t) if x.replace(",", "").replace(".", "").isdigit()]
    c = {
        "region": region == tr["region"],
        "drop": bool(m) and abs(abs(float(m.group())) - tr["drop"]) <= 0.5,
        "product": len(parts) > 2 and parts[2] == tr["product"],
        "report_exists": f.is_file() and len(t.strip()) > 0,
        "report_table": "|" in t and all(any(abs(n - v) <= abs(v) * 0.01 for n in nums) for v in tr["quarters"]),
    }
    return c


def grade(task: str, answer: str, repo: Path) -> dict:
    if task == "doc-1-runbook":
        checks = grade_runbook(repo)
    elif task == "doc-2-revise":
        checks = grade_guide(repo)
    elif task == "doc-4-brief":
        checks = grade_brief(repo)
    elif task == "doc-5-faq":
        checks = grade_faq(repo)
    elif task == "doc-6-trim":
        checks = grade_trim(repo)
    else:
        checks = grade_analysis(repo, answer)
    passed = sum(1 for v in checks.values() if v)
    return {"score": passed / len(checks), "checks": checks, "failed": sorted(k for k, v in checks.items() if not v)}


def selftest():
    """The base scores <= 0.5 on every task; hidden/docs_reference/<task>/ laid over it, with its ANSWER.txt as the answer, scores 1.0."""
    bad = False
    for task in TASKS:
        for label, overlay in (("base", None), ("reference", REFERENCE / task)):
            with tempfile.TemporaryDirectory() as t:
                repo = Path(t) / "repo"
                build(repo)
                plant(task, repo)
                answer = ""
                if overlay is not None:
                    if not overlay.is_dir():
                        print(f"{task:15} {label:9} (no reference)")
                        bad = True
                        continue
                    shutil.copytree(overlay, repo, dirs_exist_ok=True)
                    a = overlay / "ANSWER.txt"
                    answer = a.read_text() if a.is_file() else ""
                    (repo / "ANSWER.txt").unlink(missing_ok=True)
                g = grade(task, answer, repo)
                print(f"{task:15} {label:9} {g['score']:.2f}  failed: {', '.join(g['failed']) or '-'}")
                bad |= g["score"] < 1.0 if overlay is not None else g["score"] > 0.5
    if bad:
        sys.exit(1)


if __name__ == "__main__":
    if sys.argv[1:2] == ["build"]:
        build(Path(sys.argv[2]))
    elif sys.argv[1:2] == ["selftest"]:
        selftest()
    else:
        sys.exit(__doc__)
