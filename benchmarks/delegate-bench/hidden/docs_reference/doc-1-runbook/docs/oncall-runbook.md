# On-call runbook

This is for whoever holds the pager. It reflects the decisions of the on-call syncs up to 30 September 2026 and the two
postmortems of August and September. The command line tool is `tallyctl`; the service listens on port 8731.

## Getting the page

Pages come through Beacon, our pager tool. Install the app and sign in with SSO before your first shift. Acknowledge a
page as soon as you see it: acknowledging is a tap, and it is what stops the escalation clock.

## Escalation

A page goes first to the primary on-call. If the primary has not acknowledged after 15 minutes, it moves to the secondary
on-call, and if the secondary does not acknowledge either, it goes to the engineering manager. The manager is a real step
in the chain, not a courtesy.

Security incidents are the exception. They do not go through the secondary: page the security lead directly.

## Paging at night

Between 22:00 and 07:00 the pager is used only for severity 1, meaning customer-facing data loss or a full outage.
Severity 2 incidents, such as a slow dashboard or a delayed batch, do not page at night. They wait for business hours and
the primary picks them up in the morning. That is a rule for the pager, not a reason to stop watching the dashboards.

## Restarting a service

Each service restarts on its own, and a restart touches nothing else:

```
tallyctl restart api
tallyctl restart ingest
tallyctl restart worker
tallyctl restart scheduler
```

Restarting the API drops open connections for a moment. Check the result with `tallyctl status`, and look at the logs
with `tallyctl logs tail --follow` if a part does not come back.

## Known failure modes

### The ingest queue is stuck

The queue depth alert fires, the workers look healthy and nothing drains. Usually one malformed batch has wedged the
consumer, and a plain restart picks the same batch up again. Restart with a drain, which finishes in-flight work, parks
the stuck batch in the dead-letter table and starts the consumer clean:

```
tallyctl restart ingest --drain
```

Do this first and look for the cause afterwards; the parked batch can be inspected the next day.

### The database host disk is full

When the disk passes about 80 percent, or the database refuses writes, reclaim space without blocking writers and then
rotate the logs, in this order:

```
tallyctl db vacuum --online
tallyctl logs rotate
```

Do not run the vacuum without `--online` in production: it locks tables while ingest is writing. Clearing the cache does
not free disk and is not part of this fix.

### The API certificate has expired

Browsers and clients report certificate errors. Check expiry dates with `tallyctl certs list`. Renewal is two steps and
the second is not optional, because the service serves the new certificate only after a restart:

```
tallyctl certs renew api
tallyctl restart api
```

If you need to empty the cache for any reason, use `tallyctl cache clear`.

## Afterwards

Write down the commands you ran while you run them. Reconstructing them later is the slowest part of every postmortem.
