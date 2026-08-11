# Runbook — replicating the Supabase project to an Unraid box

**Status: DECIDED 2026-08-11 (Hitya): backup first, then dev sandbox.** The
live-mirror replication path below stays documented but is NOT the plan — which
dissolves its worst constraint: **a plain `pg_dump` rides the SESSION pooler,
which has IPv4, so the IPv6/IPv4-add-on caveat does not apply to Phase 1 at
all.** The nightly dump doubles as the sandbox's seed.

**Phase 1 — backup (local session executes):** `scripts/unraid-backup-supabase.sh`
is committed and copy-paste ready for the User Scripts plugin. Needs two local
steps: the session-pooler URI from Dashboard → Connect into
`/boot/config/wolfpack-db-url` (chmod 600), and ONE manual restore test —
a backup that has never been restored is a hope, not a backup. The script
refuses to rotate on an implausibly small dump so a silent auth failure can
never age out the last good copy.

**Phase 2 — dev sandbox (after Phase 1 proves out):** `supabase init` at the
repo root (config.toml does NOT exist yet — checked 2026-08-11), then
`supabase start` and seed from the nightly:
`pg_restore -d "$(supabase status -o json | jq -r .DB_URL)" --clean --no-owner --no-acl --schema=public latest.dump`.
Restore `--schema=public` only — GoTrue owns auth locally. Worthwhile side
effect: the first `supabase db reset` against the 193 committed migrations is
also the first-ever test of whether the migrations actually rebuild the live
schema; any drift it exposes is a finding to record, and the dump is the
fallback schema source if they don't. Facts below were verified live against
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

## Troubleshooting the Unraid stack (confirmed live, 2026-08-11)

**Symptom:** 2/11 containers up (imgproxy + Studio only); `supabase-db` and
`supavisor` unhealthy; everything else stopped. **This is ONE failure, not
nine** — every other service has a `depends_on` health gate on the database, so
a crash-looping db holds the whole stack down. Diagnose the db and ignore the
rest; they cascade up once it is healthy.

**Confirmed cause (refined after reading the actual compose file):**
`docker logs supabase-db` showed `chown: /var/lib/postgresql/data: Operation
not permitted` forever. The compose used RELATIVE binds (`./volumes/db/data`),
and Compose Manager projects live under
`/boot/config/plugins/compose.manager/projects/…` — **the Unraid USB flash
drive, formatted FAT32, which has no file-ownership concept at all.** So
Postgres was trying to initialize its data directory on the boot thumb drive:
chown = EPERM, crash, restart. (Even had it worked, a database on the flash
drive would be slow and would wear the drive out.) The first-guess shfs
diagnosis was the right family, wrong filesystem — the rule covers both:
**databases go on absolute pool paths, never `/boot`, never `/mnt/user`.**

**Fix (applied 2026-08-11, files handed to Hitya):** rewrote every
`./volumes/…` bind to `/mnt/cache/appdata/supabase/volumes/…` (19 rewrites;
compose header now documents the rule so a future edit can't regress it), and
generated a complete `.env` — every secret filled, ANON/SERVICE keys signed
against the new `JWT_SECRET` (the env.example demo keys are signed with the
demo secret; changing one without the others breaks all API auth), LAN URLs
(`http://192.168.1.5:8000`), tenant id `wolfpack`. One-time setup on the box:
```
mkdir -p /mnt/cache/appdata/supabase
cp -r /boot/config/plugins/compose.manager/projects/supabase/volumes /mnt/cache/appdata/supabase/
rm -rf /mnt/cache/appdata/supabase/volumes/db/data
```
(the config files — envoy yaml, init SQL, pooler.exs — must move too, since
every bind is now absolute; the data dir leftovers are wiped because nothing
ever initialized). If the pool is not named `cache` (`ls /mnt/`),
search-replace `/mnt/cache`. Then `db` up alone until
`database system is ready to accept connections` + green health, then the rest.
⚠ The generated env/compose contain real secrets — they live on the box, never
in this repo.

**VERIFIED FIXED 2026-08-11:** with the absolute pool paths, `supabase-db`
came up **healthy** on first boot from `/mnt/cache/appdata/supabase/`. One
first-boot wrinkle to expect: `initdb` takes longer than dependent containers'
wait window, so the first `compose up` strands a few services in "Created"
("dependency failed to start") while Postgres is still initializing. The fix is
just `docker compose up -d` a second time once db is healthy — it starts only
the stragglers. Verify end-state with Studio at `http://<lan-ip>:8000` (proves
gateway→studio→meta→db and the signed JWT keys) and a session-mode psql to
port 5432 (proves the pooler).

**⚠ `docker compose` from the project directory does NOT work.** `cd
/boot/config/plugins/compose.manager/projects/supabase && docker compose up -d`
fails with `stat …/docker-compose.yml: no such file or directory` even while the
stack is running — the plugin does not necessarily store the file under that
plain name, and `/boot` is vfat (case-insensitive) so the `cd` succeeds without
proving the folder name either. Authoritative lookup: **`docker compose ls`**
prints each project's CONFIG FILES path; then `docker compose -f <that path>
up -d` from anywhere. Or just use the UI's **Compose Up** button.

**Starting stragglers without compose at all:** containers stuck in "Created"
already exist with the right config — `docker start supabase-pooler
supabase-storage supabase-envoy supabase-edge-functions` starts them from any
directory. `depends_on` is only evaluated at compose-up time, so this is safe
once the database is healthy. (`docker logs -f <name>` is likewise
directory-independent; only `docker compose …` subcommands care where you are.)

## ⚠ A Compose Manager UI project has NO `volumes/` tree — fetch it (2026-08-11)

The second, bigger failure after the FAT32 one, and the correction matters more
than the fix. A project created by pasting a compose file into the Compose
Manager UI contains **only `compose.yaml` and `.env`**. The supporting config
files — envoy config, the db init SQL, `pooler.exs`, the edge-function main —
ship with the **supabase/docker repo** and were never on the box. So a
`cp -r <project>/volumes …` copies nothing, and **Docker then auto-creates every
missing bind source as an empty DIRECTORY.**

Why that is worse than it looks: those empty dirs mount *successfully* wherever
the destination does not already exist in the image — which is every db init
script. Postgres came up **`healthy`** (pg_isready passes) having run **none**
of the bootstrap: no `supabase_auth_admin`, no `authenticator`, no `_realtime`.
Auth/rest/realtime then crash-loop forever against it (`docker compose ls`
showed `restarting(5)`). Only envoy failed loudly, because `/docker-entrypoint.sh`
DOES pre-exist as a file in its image, and directory-onto-file is a hard error.
**A green db healthcheck is not evidence the bootstrap ran** — check
`ls -la volumes/db/`: entries must be `-` with real sizes, never `d` at 40 bytes.

Fetch the real tree (verify each landed as a FILE afterwards):
```
rm -rf /mnt/cache/appdata/supabase/volumes
cd /mnt/cache/appdata/supabase
mkdir -p volumes/api/envoy volumes/db volumes/pooler volumes/functions/main
BASE=https://raw.githubusercontent.com/supabase/supabase/master/docker/volumes
for f in api/envoy/envoy.yaml api/envoy/cds.yaml api/envoy/lds.template.yaml \
         api/envoy/docker-entrypoint.sh db/realtime.sql db/webhooks.sql \
         db/roles.sql db/jwt.sql db/_supabase.sql db/logs.sql db/pooler.sql \
         pooler/pooler.exs functions/main/index.ts; do
  curl -fsSL "$BASE/$f" -o "volumes/$f" || echo "MISSING: $f"; done
chmod +x volumes/api/envoy/docker-entrypoint.sh
```
Do NOT recreate `volumes/db/data` — Docker makes it empty, which is what
`initdb` needs. The old cluster MUST be wiped: init scripts only run against an
empty data directory, so a hollow database cannot be repaired in place.

**`COMPOSE_FILE` in `.env` overrides compose's file discovery.** The upstream
`env.example` ships `COMPOSE_FILE=docker-compose.yml`, but Compose Manager saves
the file as `compose.yaml` — which is why `docker compose up -d` in the project
directory failed with `stat …/docker-compose.yml: no such file` while the stack
was running. Set it to `compose.yaml` or delete the line.

## ✅ Stack VERIFIED HEALTHY 12/12 (2026-08-11)

After the volumes fetch: `Stack supabase started successfully`, 12/12, and the
acceptance test passed — `docker exec supabase-db psql -U postgres -c '\du'`
lists `supabase_auth_admin`, `authenticator`, `supabase_storage_admin`,
`supabase_admin` and the realtime/functions/etl roles. **That role list, not the
healthcheck, is the proof the bootstrap ran** (the hollow cluster reported
healthy too). Use it as the acceptance test on any future rebuild.

**Version match — load-bearing for backups.** Hosted project is Postgres
**17.6** (verified live 2026-08-11); the local stack runs `supabase/postgres
17.6.1.136`. Same major, so the local stack is a valid restore target for the
Phase 1 dump. This also caught a real defect in the backup script: it pinned a
`postgres:15` client, and **pg_dump refuses to dump from a server newer than
itself**, so the first nightly run would have aborted. Now pinned `postgres:17`
— raise the tag if Supabase ever upgrades the project's major, never lower it.

**Two Studio buttons are dead in self-hosted, and both are cosmetic.** The
account menu shows *"You do not have access to this project"* and Connect shows
*"Project is currently not active and cannot be connected"* — Studio asks the
HOSTED platform API (supabase.com) for account/project status, which no
self-hosted stack has. Nothing is wrong: Advisors returning "no issues" is
itself a live meta→db round trip. Do not chase these. Real connection paths:
Studio's SQL Editor / Table Editor, `docker exec supabase-db psql -U postgres`,
and from the LAN through the pooler in session mode —
`postgresql://postgres.<POOLER_TENANT_ID>@<lan-ip>:5432/postgres` (username is
supavisor's `postgres.<tenant>` form; the db container publishes no port of its
own by design, so all LAN access goes through supavisor on 5432/6543).

**Stack identification note:** this template is NOT the official
`supabase/docker` compose — the gateway is Envoy (official uses Kong) and the
db image is Postgres 17 (official self-host pins 15). Fixes found for the
official stack will not always map onto it.

**Scope reminder:** none of this blocks Phase 1 — the backup script needs
Docker and the session-pooler URI, not a running local stack. This stack is
live-mirror/Phase-2+ infrastructure.
