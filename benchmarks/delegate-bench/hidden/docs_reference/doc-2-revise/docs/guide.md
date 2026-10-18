# Getting started with tally

This guide takes a new teammate from nothing to a running tally on their own machine, then shows the few commands that
cover most days.

## What tally is

Tally is our metrics-ingest service. Applications send it small numeric events, such as a request count or a latency; it
stores them, rolls them up into minutes and hours, and serves the series to dashboards and alerting. It has four parts:
the API, which accepts events and answers queries; the ingest workers, which take events off a queue and write them to the
database; the worker pool, which does the roll-ups; and the scheduler, which starts periodic jobs. A Postgres database and
a cache sit behind them.

Events go in through the API, and nothing is lost while the queue is healthy. If a dashboard looks wrong, ask first whether the data arrived.

## Installing the command line tool

The tool is a Python package, installed with pipx so that it stays out of the way. You need Python 3.11 or newer.

```
pipx install tally-toolkit
```

Check that it is on your path and see its version, then look at the configuration it uses, with secrets masked:

`tallyctl version`

`tallyctl config show`

> **Warning:** Never paste the contents of the settings file into a chat or a ticket. The tool masks secrets when it prints
> the configuration; the file does not.

The tool was renamed in September, so update any scripts that use its old name. If the command is not
found, run `pipx ensurepath` and open a new terminal.

## Running the service

For development you run the whole service locally. Start with a status check, and ask for the machine-readable form when
you want to script around it:

```
tallyctl status
tallyctl status --json
```

The service listens on port 8731. Ask it for its health:

`curl http://localhost:8731/health`

The previous port is closed, so anything still pointing at it will be refused. If something else on your machine
already holds 8731, the service will not start and the status says which part failed.

> **Warning:** The local service uses a throwaway database. Never point it at a shared database or at production data,
> because the development settings skip production's safety checks.

When something misbehaves, follow the logs and restart the part you suspect; restarting the API drops open connections for
a moment.

```
tallyctl logs tail --follow
tallyctl restart api
```

## Everyday tasks

To see the result of a changed roll-up straight away, clear the cache. It clears every region at once, so tell your
colleagues first on a shared environment:

`tallyctl cache clear`

The older command for this was removed in September. Before something risky, back up your local
database; the directory is optional:

`tallyctl db backup --to ./backups`

Staging needs real certificates, and listing them with their expiry dates saves an embarrassing morning:

`tallyctl certs list`

> **Warning:** Anything that clears data or restarts a part is visible to everyone using the same environment. On staging,
> announce it in the team channel first.

## Troubleshooting

Most problems are one of three: the tool does not start, the service does not answer, or the data looks stale. For the
first, check the version command and your path. For the second, run the status command and see which part is down; a
restart usually fixes it and the logs say why it fell over.

For stale data, check whether the ingest queue is draining: a depth that only grows is the sign, and then you should ask on
the on-call channel and read the on-call runbook rather than wait. If your local disk fills up, two commands help; the
first reclaims database space, the second compresses old logs and removes those past retention:

```
tallyctl db vacuum
tallyctl logs rotate --keep 7
```

If none of that helps, write down what you ran and what you saw, and ask in the team channel. 
