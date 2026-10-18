# tally architecture

## Overview

Tally is a metrics-ingest service. Applications send small numeric events to the API on port 8731. The API allows 1,000 requests per minute per key and puts the events on a queue. Ingest workers write them to Postgres, and the roll-up workers turn them into minute and hour series that dashboards and alerting read. Tally takes about 40 million events per day and peaks at 2,500 events per second. The service is run by the on-call team, and the handbook in this repository is the source for every procedure named below.

## Components

The API is stateless and runs 3 replicas behind the load balancer. Ingest runs 4 ingest workers. The roll-up pool runs 6 roll-up workers, and the scheduler starts the periodic jobs. Each API replica has 2 vCPU and 4 GB of memory, and each ingest worker has 1 GB of memory. Behind them sit Postgres on port 5432 and the cache. Every component logs to standard output and exposes a health endpoint, and the health endpoint of the API answers on port 8731 as well.

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

## Storage

Postgres 16 stores the raw events in a partitioned table and the roll-ups in two further tables. The database disk is 800 GB. Raw events are written to daily partitions of about 18 GB each. Backups run at 01:00 and are kept for 10 days, and a backup that fails raises an alert in the same way as a full disk does. The raw table is defined as:

```sql
CREATE TABLE events_raw (ts timestamptz, series text, value double precision) PARTITION BY RANGE (ts);
CREATE INDEX ON events_raw (series, ts);
```

## Data retention

Retention is applied every night at 02:00 by the scheduler, one partition at a time, so the load on the database stays flat. The rules are:

1. Raw events are kept for 7 days and then deleted.
2. Minute roll-ups are kept for 90 days.
3. Hour roll-ups are kept for 24 months.
4. Parked batches in the dead-letter table are deleted after 21 days.

## Caching

The cache listens on port 6379 and is organised in 3 regions. Entries expire after 300 seconds. The cache is cleared with the cache clear command, which clears all regions unless one is named. The cache holds 16 GB and is warmed after every restart by replaying the most recent hour of queries, which takes about 4 minutes. A chart that is stale for one region and correct for another is a cache question before it is anything else.

## Deployment

A release is rolled out one service at a time, and the API is restarted last. The rollout waits 5 minutes between services and stops if the error rate rises above 2 percent. Releases go to staging first and stay there for 1 day. A release is never started on a Friday afternoon unless it fixes an outage. Check the state and the settings before and after:

```
tallyctl status --json
tallyctl restart api --timeout 120
tallyctl config show
```

## Failure handling

A stuck ingest queue is cleared with a drain restart. A full database disk is handled with an online vacuum and then a log rotation; the disk alert fires at 80 percent. Logs keep the last 14 files. A page that nobody acknowledges escalates after 15 minutes, first to the secondary on-call and then to the engineering manager. Between 22:00 and 07:00 the pager is used only for severity 1, and severity 2 waits for business hours. An alert on the days left of each certificate fires at 14 days.

```
tallyctl restart ingest --drain
tallyctl db vacuum --online
tallyctl logs rotate --keep 14
```
