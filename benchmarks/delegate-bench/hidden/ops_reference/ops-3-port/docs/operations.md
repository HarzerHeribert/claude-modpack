# Operating tally

## Deploying

1. Copy the repository to /srv/tally and run `make init`.
2. Install deploy/tally.service and start it; it listens on port 8742.
3. Put deploy/nginx.conf in front of it; nginx forwards to port 8742 on the same host.
4. Check `make health` (it must print status ok) and watch logs/server.log.

## Importing

`make import` reads data/incoming/*.csv and logs to logs/import.log. Partners send their own date formats.

## Error codes

| Code | Meaning |
| ---- | ------- |
| E-1001 | unknown customer |
| E-2040 | amount is not a number |
| E-8731: duplicate invoice id | the invoice id exists already |
| E-9000 | database is locked |
