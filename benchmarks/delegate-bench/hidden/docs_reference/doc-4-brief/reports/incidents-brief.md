# Incident brief

## 11 August 2026: ingest backlog and full disk

Impact: ingest stopped for about two and a half hours, so customers saw stale dashboards; no data was lost. The database disk then filled and refused writes.

Cause: one malformed batch wedged the consumer, and its retries flooded the disk with logs.

Fix: ingest was restarted so the stuck batch was parked, then space was freed and logs rotated.

Actions:
- Disk alert at 80 percent: Sunil, done.
- Poisoned-batch fix: Jonas, still open.

## 21 September 2026: API certificate

Impact: for 47 minutes nearly all clients of the public API failed with certificate errors.

Cause: the API certificate expired; its renewal job had silently failed since early September.

Fix: the certificate was renewed and the API restarted.

Actions:
- Calendar reminders before expiry: Priya, done.
- Alert on days left: Priya, still open.
- Certificate listing in the weekly checklist: Tomasz, still open.
- Writing down commands during incidents: Mara, done in the handover notes.
