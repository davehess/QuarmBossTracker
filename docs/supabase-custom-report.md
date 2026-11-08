# The Supabase custom report: what goes in it

The guild lead made a custom report in the Supabase dashboard (project → Reports → custom report) on 2026-11-08 and asked
for it to hold "our analytics needs". A session cannot edit dashboard reports (the Supabase MCP has no reports tool and
the Management API does not expose them), so this file is the setup to follow by hand. Every SQL block was run against
production on 2026-11-08 and returns in well under a second; none scans a large table.

What the report answers, in order:
1. Is the instance big enough on a raid night? (CPU, memory commitment, disk IO against its limits)
2. Where does the database's time go? (the queries that cost the most)
3. What is filling the disk? (biggest tables, and whether the retention sweeps keep up)
4. Who is connected right now?

## Built-in charts (Add block → the chart)

| Chart | Why | Healthy |
|---|---|---|
| CPU usage | raid-night load; the bot and PostgREST share one instance | under ~70% through a raid |
| Memory commitment | the dashboard's own warning (WARNING / SEVERE) | under the dotted line |
| Disk IOPS (read + write) | the Nov 4 outage was the disk budget running dry | far under the Max IOPS line |
| Disk throughput | same budget, in MB/s | far under the Max throughput line |
| Database connections | one bot replica + PostgREST; a climb means a leak | under ~25 |
| Disk usage | growth toward the provisioned disk | Database well under Disk size |

Set the range to a raid night (Sun / Wed / Thu, 8 pm – 1 am ET) when comparing.

## SQL blocks (Add block → SQL snippet; paste, save, then add the snippet to the report)

### Biggest tables
`rows_est` is Postgres's own estimate (pg_class.reltuples); the live/dead counters in pg_stat_user_tables were reset on
2026-11-05 and undercount.
```sql
select c.relname as "table",
       pg_size_pretty(pg_total_relation_size(c.oid)) as size,
       round(100.0 * pg_total_relation_size(c.oid) / pg_database_size(current_database()), 1) as "% of db",
       c.reltuples::bigint as rows_est,
       coalesce(s.last_autovacuum, s.last_vacuum)::timestamp(0) as last_vacuum
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 10;
```

### Where the database's time goes
Since the last stats reset (the `stats_since` block below says when).
```sql
select left(regexp_replace(query, '\s+', ' ', 'g'), 110) as query,
       calls,
       round((total_exec_time / 1000)::numeric, 1) as total_s,
       round(mean_exec_time::numeric, 1) as mean_ms,
       round((100 * total_exec_time / sum(total_exec_time) over ())::numeric, 1) as pct_db_time
from extensions.pg_stat_statements
order by total_exec_time desc
limit 10;
```
```sql
select stats_reset::timestamp(0) as stats_since from extensions.pg_stat_statements_info;
```

### Who is connected
```sql
select coalesce(nullif(application_name, ''), usename::text, '?') as client,
       state,
       count(*) as connections,
       max(now() - query_start)::interval(0) as longest_running
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid()
group by 1, 2
order by connections desc;
```

## What the first reading showed (2026-11-08, for Thu 2026-11-05 → Fri 11-06 and the 7 days to 11-08)

- **Disk is not the constraint any more.** Raid night peaked around 5 IOPS against 3,000 and ~182 KB/s against 125 MB/s.
  The Nov 4 squeeze (DECISIONS §538) is gone on the Small instance.
- **CPU is.** User CPU rose to ~75% across the Thursday raid window; 7-day average 13.7%.
- **Memory commitment** is flagged WARNING for Thursday and SEVERE on the 7-day view (1.5–1.7 GB committed of ~2 GB).
- **`encounter_threat_snapshots` is 2.49 GB, 52% of the database**, with ~1.14 M rows: the same row count as 2026-09-22
  but nearly twice the size, so it is bloat, not rows. It still has no plain `snapshot_at` index for its 30-day sweep.
- **Four `COPY public.encounter_threat_snapshots` reads, ~332 s each, were 18.7% of all database time** since the stats
  reset on 2026-11-05 04:31 UTC: about one a day, each reading the whole table. Most likely a nightly dump (Supabase's
  daily backup or the Tower archive pull); not yet confirmed which. Shrinking that table shrinks it.
