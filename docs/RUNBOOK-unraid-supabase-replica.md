# Runbook — replicating the Supabase project to an Unraid box

**Status: PREPARED, not executed** (Hitya asked 2026-08-11; goal not yet chosen —
see "pick the goal first"). Facts below were verified live against
`zhtoekwakucbckvatfky` on 2026-08-11: `wal_level = logical` (replication-ready
out of the box), **0** replication slots in use, database size **1171 MB**.
Related but different: `DESIGN-external-tenancy.md` §4 walks OTHER guilds
self-hosting the whole platform; this runbook is about mirroring OUR project's
data to hardware we own.

## ⚠ The three Community Applications tiles are not the stack

`SupabaseKong` / `SupabaseMeta` / `SupabaseStudio` are the API gateway, the
metadata API, and the dashboard. **None of them is the database — and the
database is the only thing that replicates.** Also missing from those tiles:
GoTrue (auth), PostgREST (the REST API), Realtime, and Storage. Assembling the
stack from individual CA templates means hand-wiring a dozen env contracts the
official compose file wires for you.

**Do this instead:** install the *Compose Manager* plugin on Unraid and run the
official `supabase/docker` compose stack — one `docker-compose.yml` +
`.env` brings Postgres (the `supabase/postgres` image with every extension the
project uses), Kong, GoTrue, PostgREST, Realtime, Storage, Meta and Studio, all
pre-wired. The three CA tiles then have no job.

Keys note: a self-hosted stack generates its OWN `JWT_SECRET` / `ANON_KEY` /
`SERVICE_ROLE_KEY` (the compose repo has a generator). Never copy the cloud
project's keys into it — they are different trust domains on purpose.

## Replication is configured in Postgres, not in any container field

### Hosted side (one-time)

```sql
-- postgres on Supabase is NOT superuser, so FOR ALL TABLES is unavailable.
-- Schema-scoped is what we want anyway (public = the app's data):
create publication wolfpack_replica for tables in schema public;
```

### Unraid side (one-time)

1. **Schema first** — logical replication moves DATA ONLY, never DDL:
   `pg_dump --schema-only` from the hosted project into the local Postgres
   (roles/RLS policies ride along with the schema).
2. Then:

```sql
create subscription wolfpack_sub
  connection 'host=db.zhtoekwakucbckvatfky.supabase.co port=5432 dbname=postgres user=postgres password=…'
  publication wolfpack_replica
  with (copy_data = true);   -- streams the ~1.2 GB initial copy, then tails WAL
```

## The four caveats that actually bite

1. **The direct connection is IPv6-only unless the project has the IPv4
   add-on** — and the pooler (port 6543) does NOT speak the replication
   protocol, so the subscription MUST use the direct `db.<ref>` host. If the
   home network has no outbound IPv6, the IPv4 add-on is a prerequisite. Check
   before anything else: `ping6 db.zhtoekwakucbckvatfky.supabase.co` from the
   Unraid box.
2. **DDL never replicates.** Every future migration in `supabase/migrations/`
   must ALSO be applied to the replica, or the subscription stalls on the first
   row that doesn't fit. The repo's migration discipline is what makes this
   tractable — a small script applying new migration files to the replica keeps
   it current. A replica nobody maintains dies at the first schema change.
3. **Known churn will flood the wire until fixed:** the open
   `opendkp_raids`/`_auctions` item (STATUS.md) rewrites **1.5M + 3.7M rows
   every sync** — every one of those no-op updates becomes WAL the replica must
   chew through. Fix that item first or accept a noisy pipe.
4. **A replica is data, not a second site.** Sign-in cannot transfer: the JWT
   secret and the Discord OAuth callback belong to the cloud project, and a
   second Discord app means diverging `auth.users` — the same trap documented
   for `b.wolfpack.quest` in CLAUDE.md. Sequences also don't replicate
   (only matters if ever promoting the replica to primary: `setval` first).

## Pick the goal first — the tool differs

| Goal | Right tool | Effort |
|---|---|---|
| **Backup / disaster recovery** | Nightly `pg_dump -Fc` via cron to an Unraid share. Zero moving parts, restores anywhere, 1.2 GB compresses well | ~15 min |
| **Live local mirror** (local sessions querying wolfpack data NEXT TO the local `peq` DB — the "needs a local session" items get much easier) | Full stack + logical replication, per above | An afternoon + ongoing migration upkeep |
| **Dev sandbox** | `supabase` CLI local stack, seeded from a dump. No replication at all | ~30 min |

If the goal is "don't lose the guild's data," start with the dump — it can run
tonight. The live mirror is worth it primarily for the local-session workflow
(peq joins + wolfpack data on one box), and it can be added later on top of the
same stack.
