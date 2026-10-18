# FAQ

## How do I install the command line tool?

Python 3.11 or newer, then `pipx install tally-toolkit`. If it is not found, run `pipx ensurepath`.

## What is the tool called now?

`tallyctl`. It was `tally-cli` until the September release; the old name is an alias for one more release.

## Which port does tally listen on?

8731 (the old 8080 is closed). Check health with `curl http://localhost:8731/health`.

## How do I clear the cache?

`tallyctl cache clear` clears all regions; add `--region NAME` for one. The old purge command is gone.

## How long until an unanswered page escalates?

15 minutes. The page goes to the primary on-call, then the secondary, then the engineering manager.

## Does the pager wake me at night?

Between 22:00 and 07:00 only for severity 1 (data loss or full outage). Severity 2 waits for business hours.

## What do I do when the ingest queue is stuck?

Restart with a drain, which parks the stuck batch: `tallyctl restart ingest --drain`.

## What do I do when the API certificate has expired?

Renew it with `tallyctl certs renew api`, then restart: `tallyctl restart api`. Both steps are required.
