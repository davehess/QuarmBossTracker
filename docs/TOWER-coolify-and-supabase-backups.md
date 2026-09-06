# Tower — Coolify and the Supabase backups, in one place

Written 2026-09-04 at Hitya's request. **This is the overview**; the two runbooks
it sits on top of stay authoritative for the step-by-step and the traps:
`RUNBOOK-unraid-supabase-replica.md` (the local Supabase stack + the backup) and
`RUNBOOK-local-web-coolify.md` (the Coolify VM + the local site). Where this
file and a runbook disagree, the runbook wins and this file needs the edit.

**This repo is public.** Addresses and identifiers below are placeholders —
`<tower-ip>`, `<coolify-vm-ip>`, `<project-ref>` — and the real values live on
the box and in the Supabase dashboard, never here (Hitya, 2026-09-04).

Everything below marked **verified** was proven on the box on 2026-08-11.
Everything marked **⚠ unverified** was committed copy-paste ready but no session
has confirmed it is installed and running — a cloud session cannot see Tower.
The checklist at the end is how to find out in five minutes.

---

## 1. What runs on Tower, and why

Tower is the Unraid box on the home LAN. It carries three things for the platform,
and they exist for three different reasons:

| Piece | Where on Tower | Why it exists |
|---|---|---|
| **Nightly backup of the hosted Supabase project** | `/mnt/user/backups/wolfpack/*.dump` | Disaster recovery. The guild's data lives in one hosted project; this is the copy we own |
| **A local Supabase stack** (Postgres 17.6 + the full API/auth/Studio set) | Compose Manager project `supabase`, data at `/mnt/cache/appdata/supabase/` | The restore target that PROVES each backup, and the **long-horizon archive** — it keeps rows production prunes |
| **Coolify in a VM, serving a local copy of wolfpack.quest** | VM `Coolify`, site at `http://<coolify-vm-ip>:3000` | The only place the site runs outside Vercel — the canary for Vercel-masked bugs — and a sandbox where officer pages can be clicked without touching production |

The shape is the **hybrid** the self-host design calls shape 3
(`DESIGN-selfhost-wizard.md` §2): hosted production for raid night, on-prem for
backup and history. Production prunes on timers to keep the hosted bill flat;
Tower keeps everything for the price of electricity.

```
 hosted Supabase (Pro, <project-ref>)                 Tower (Unraid, <tower-ip>)
 ┌──────────────────────────────┐   05:00 pg_dump    ┌────────────────────────────────┐
 │ postgres 17.6 · 1.83 GB      │ ─────────────────▶ │ /mnt/user/backups/wolfpack/    │
 │ prunes buff_casts @7d, who   │  session pooler,   │   wolfpack-<date>-<time>.dump  │
 │ @60d, threat @30d (broken)   │  IPv4, ~1.1 GB     │   latest.dump → newest         │
 └──────────────────────────────┘  over the wire     └───────────────┬────────────────┘
                                                                     │ 05:30 merge
                                                                     ▼
                                                     ┌────────────────────────────────┐
                                                     │ local Supabase stack           │
                                                     │ /mnt/cache/appdata/supabase    │
                                                     │ ARCHIVE tables never delete    │
                                                     │ Studio :8000/project/wolfpack  │
                                                     └───────────────┬────────────────┘
                                                                     │ reads
                                                     ┌───────────────┴────────────────┐
                                                     │ Coolify VM (<coolify-vm-ip>)     │
                                                     │ site :3000 · dashboard :8000   │
                                                     │ polls main every 5 min         │
                                                     └────────────────────────────────┘
```

---

## 2. The backup

**Script:** `scripts/unraid-backup-supabase.sh`, committed in this repo, copied
onto the box. **Verified 2026-08-11:** a 106 MB custom-format dump (1,527 TOC
entries, server 17.6) restored into the local stack, `encounters` = 1,575.
Backup path and restore path both exercised on real data the same night.

What it does, and the reason for each part:

- **Pulls through the SESSION pooler** (`*.pooler.supabase.com:5432`, user
  `postgres.<project-ref>`), whose URI lives in
  `/boot/config/wolfpack-db-url` (chmod 600, never in the repo). The pooler has
  IPv4, so the IPv6 caveat that blocks logical replication does not apply. The
  script refuses a `:6543` URI — that is the transaction pooler and `pg_dump`
  needs session state.
- **Runs `pg_dump` from a `postgres:17` container.** Load-bearing: the hosted
  project is Postgres **17.6**, and `pg_dump` refuses to dump a server newer than
  itself. The first draft pinned `postgres:15` and would have aborted every
  night. Raise the tag if Supabase ever bumps the major; never lower it.
- **Writes to stdout, `--no-sync`.** `-f /dev/stdout` fsyncs on completion and
  fails AFTER a complete dump has been written; `set -e` then throws the dump
  away. Learned the hard way on the first run.
- **Custom format, `--no-owner --no-acl`**, so it restores anywhere without
  fighting roles that only exist on the hosted project.
- **Refuses to rotate on a dump under 100 MB.** A silent auth failure writes
  ~0 bytes; without the floor, rotation would age out the last good copy while
  every "backup" since was garbage.
- **Retention:** 30 days by age, plus an optional `KEEP_MAX` count for
  sub-daily schedules. `latest.dump` is a symlink to the newest file.
- **Schedule:** Unraid **User Scripts** plugin, custom `0 5 * * *` — after US
  raid nights end, before the weekly eqemu sync moves rows.
  ⚠ **unverified:** the runbook's last note (2026-08-11) says the copy in User
  Scripts still carried the `-f /dev/stdout` bug and had to be re-pasted before
  enabling the schedule. Nothing since confirms that happened. Check first.

### What is in the dump, and what is not

The dump carries the whole database as the `postgres` role sees it: `public`
(all 158 tables), plus `auth`, `storage`, `graphql`, `pgbouncer` and the rest.
Restores into the local stack use `--schema=public` only, because the local
GoTrue owns `auth` there — but `auth.users` IS in the file, which matters for
real disaster recovery (§5).

**Not in the dump, and not backed up by anything on Tower:**

- **Everything Discord holds.** The Parses Log thread (what `parses.json` is
  rebuilt from on boot), the roster chunks, the hate-state embeds. CLAUDE.md
  is explicit that Discord is still the source of truth for those; the
  Postgres-is-home migration is opportunistic and unfinished.
- **Configuration that lives in dashboards:** Railway env vars, Vercel env vars,
  the Supabase auth config (Discord provider secret, redirect allowlist, Site
  URL), `bot_kv`-adjacent tuning is IN the dump but the dashboards are not.
- **Supabase Storage buckets** — there are none (0 buckets, 0 objects as of
  2026-09-04), so nothing is lost here today.

### The numbers, 2026-09-04

| | 2026-08-11 | 2026-09-04 |
|---|---|---|
| Hosted database size | 1,171 MB | **1,833 MB** |
| Table data (heap + toast), `public` | — | 1,162 MB |
| Indexes, `public` | — | 654 MB |
| `encounter_threat_snapshots` alone | — | **754 MB of the 1,162** |
| Dump file | 106 MB | not measured; expect ~150–200 MB |

Two consequences worth knowing:

- **A `pg_dump` moves table data, not indexes**, so each nightly run pulls
  roughly **1.1 GB out of Supabase**. That is egress, and egress is the metered
  item on Pro: about **33 GB a month, ~13% of the 250 GB allowance**, from the
  backup alone. Fine today; it is the reason the script header warns against a
  sub-daily schedule, and the reason a "lean" nightly is the next lever if the
  bill ever matters: `pg_dump --exclude-table-data=encounter_threat_snapshots`
  cuts the wire to ~400 MB, with a full dump once a week. **Not implemented** —
  the script is unchanged; this is the option, recorded.
- **The threat-snapshot table is 65% of every backup, and its 30-day sweep has
  never worked** (`DECISIONS-2026-09-01.md`). Fixing that sweep shrinks the
  hosted database, the nightly egress and the dump file in one move. The
  uncurated-mob gate shipped today (bot 3.1.122) slows the growth; it does not
  remove what is there.

---

## 3. The local Supabase stack and the archive

**Verified healthy 12/12 on 2026-08-11.** Compose Manager plugin, the
Envoy-gateway template (not the official Kong compose — fixes for the official
stack do not always map), data on the cache pool:

- Data and config: `/mnt/cache/appdata/supabase/volumes/…` — **absolute pool
  paths, never `/boot` (FAT32, no ownership, and it is the USB flash drive),
  never `/mnt/user` (FUSE)**. Both were tried; both broke Postgres.
- Postgres `supabase/postgres 17.6.1.136` — same major as hosted, so it is a
  valid restore target for the dump.
- Tenant id `wolfpack`, so Studio is
  `http://<tower-ip>:8000/project/wolfpack` (not `/project/default`), and the
  LAN connection is the pooler in session mode:
  `postgresql://postgres.wolfpack@<tower-ip>:5432/postgres`.
- **The acceptance test is the role list, not the healthcheck.** A hollow
  database reports `healthy` having run none of its bootstrap. Proof it ran:
  `docker exec supabase-db psql -U postgres -c '\du'` lists
  `supabase_auth_admin`, `authenticator`, `supabase_storage_admin`.
- Its own keys. The stack generated its own `JWT_SECRET` / anon / service
  keys; the cloud project's keys are a different trust domain and are never
  copied in.

**The archive merge:** `scripts/refresh-local-archive.sh` +
`scripts/lib/archive-merge.sql`, scheduled `30 5 * * *` in User Scripts — half
an hour after the backup. It restores the newest dump into a scratch database,
exposes it through `postgres_fdw`, and merges by an explicit allowlist:

- **ARCHIVE tables** (insert + update, **never delete**): the ones production
  prunes on timers — `buff_casts`, `encounter_threat_snapshots`,
  `target_observations`, `who_observations`, `raid_roster` — and the
  append-only history (`encounters`, `encounter_players`, `encounter_events`,
  `contributions`, `chat_messages`, `tells`, PvP tables, `audit_log`, …).
- **MIRROR tables** (everything else): a production delete is a correction
  there — `character_inventory` is deleted and re-inserted on every upload —
  so they track production exactly.
- Every run writes `archive_meta.merge_log` (table, mode, rows before/after,
  rows kept that the snapshot had lost). That table is how you know the merge
  is running without reading a log file.
- It also **re-proves the backup every night**: a dump that restores is a dump
  you can rely on. The pass/fail is "is `encounters` queryable afterwards", not
  `pg_restore`'s exit code, which is always non-zero here because of three
  expected errors (a `pg_trgm` index, the `auth.users` FK, a stale publication).

⚠ **unverified:** that the User Scripts entry exists and fires. The merge is
"committed and installable; execution is a needs-local-session item"
(`STATUS.md`). The `merge_log` query in §6 answers it in one line.

**Cost on the pool:** the first merge grows the local database rather than
replacing it, and it keeps growing — `buff_casts` alone lands ~9,500 rows a day.
With the threat-snapshot table in the ARCHIVE list, the local copy inherits the
754 MB whale and its growth. Watch the cache pool.

---

## 4. Coolify

**Decided 2026-08-11:** Coolify runs in a **VM on Unraid**, not on bare Unraid.
Its installer wants systemd and control of the Docker daemon, and its proxy
wants ports 80/443, which Unraid's own UI holds. The VM makes all of that
someone else's problem.

| | Value | Status |
|---|---|---|
| VM | `Coolify` — Debian 13, 2 vCPU, **8 GB** (4 GB OOM-kills `next build`), 40 GB raw vdisk at `/mnt/user/domains/Coolify/`, bridged on `br0` | verified |
| Coolify | `curl -fsSL https://cdn.coollabs.io/coolify/install.sh \| sudo bash`, dashboard `http://<coolify-vm-ip>:8000` | verified |
| Application | private repo via deploy key, branch `main`, Nixpacks, **Base Directory `/web`**, Ports Mappings **`3000:3000`** (Exposes alone publishes nothing), `NEXT_PUBLIC_*` as **build** variables, pointed at the LOCAL stack's URL and keys | verified — site served `/parses` from the local data 2026-08-11 |
| Discord sign-in on the local site | a **separate sandbox Discord app** (`Wolfpack Local`) against the local GoTrue; the production app's secret is never reset | ⚠ unverified — gated on creating that app |
| Auto-deploy | `scripts/coolify-autodeploy.sh` + `scripts/systemd/coolify-autodeploy.{service,timer}` on the VM: polls GitHub every 5 min, hits Coolify's deploy webhook when `main` moves | ⚠ unverified — needs a second read-only deploy key, a Coolify API token, `/etc/coolify-autodeploy.conf` |
| Deploy-failure alerts | Coolify → Notifications → Discord webhook | ⚠ unverified |

**Why polling and not a webhook:** Coolify's native auto-deploy needs GitHub to
reach it, and the two ways to allow that — publishing port 8000 or a tunnel —
put a container-deploying dashboard on the open internet. Polling is
outbound-only. Five minutes of lag on a sandbox is nothing.

**Why auto-deploy a sandbox at all:** it is the only copy of the site that
does not run behind Vercel's proxy, and it already caught one bug Vercel had
hidden for months (every auth redirect built from `new URL(req.url).origin`,
which is `localhost` in a container — web 1.1.41). A mirror that tracks `main`
catches the next one; a mirror that needs a click drifts.

**What the local site is not:** a failover. No public DNS, no TLS, and its data
stops at the last merge. If Vercel is down, the guild does not fall back to
Tower.

---

## 5. Restoring — the three cases

**A. Refresh the local archive from the newest dump** — this is what the 05:30
job does. By hand:
```
bash /boot/config/refresh-local-archive.sh      # or wherever the User Scripts copy lives
docker exec supabase-db psql -U postgres -c "select count(*) from encounters"
```

**B. Inspect or restore a specific dump into the local stack** (stream it —
never `docker cp` the `latest.dump` symlink; it copies the link, not the file):
```
docker run --rm -v /mnt/user/backups/wolfpack:/b postgres:17 pg_restore -l /b/wolfpack-2026-09-04-0500.dump | head
docker exec -i supabase-db pg_restore -U postgres -d postgres --no-owner --no-acl --schema=public \
  < /mnt/user/backups/wolfpack/wolfpack-2026-09-04-0500.dump
```
⚠ A plain restore like this into the archive database is a **mirror**, not a
merge — it can re-insert rows but will not delete, and it bypasses
`archive-merge.sql`'s allowlist. For routine refresh use A.

**C. Real disaster — the hosted project is gone.** Untested; this is the
outline, not a runbook:
1. Create a new Supabase project (Pro, same region), note the new ref.
2. `pg_restore --no-owner --no-acl --schema=public -d "<new session-pooler URI>" latest.dump`.
   Expect the same three harmless errors as the local restore.
3. Re-create what the dump does not carry: Discord provider (client id +
   secret) and the redirect allowlist under Authentication → URL Configuration;
   `SUPABASE_*` env vars on Railway and Vercel (Production AND Preview);
   Supabase MCP / GitHub integration for migrations.
4. `auth.users` is in the dump but do not fight to restore it: the sign-in
   callback upserts `wolfpack_members` **`onConflict: 'discord_id'`**, so every
   member re-links to their row on their next sign-in with a fresh
   `auth.users` id. `wolfpack_members.user_id` heals itself.
5. Discord-held state (parses thread, roster, hate) is untouched by all of this
   — the bot rebuilds from Discord on boot. `/recoverkills` rebuilds timers
   from `encounters`.

---

## 6. The five-minute check (run on Tower)

```
# 1. Is the backup running, and is the newest one real?
ls -lh /mnt/user/backups/wolfpack/ | tail -5
readlink -f /mnt/user/backups/wolfpack/latest.dump
docker run --rm -v /mnt/user/backups/wolfpack:/b postgres:17 pg_restore -l /b/latest.dump | head -3

# 2. Is the merge running?
docker exec supabase-db psql -U postgres -c \
  "select ran_at::date, count(*) tables, sum(rows_kept) kept from archive_meta.merge_log group by 1 order by 1 desc limit 7"

# 3. Is the stack whole?
docker compose ls
docker exec supabase-db psql -U postgres -c '\du' | grep -c -E 'supabase_auth_admin|authenticator|supabase_storage_admin'   # want 3

# 4. Is the local site alive and following main?
curl -s -o /dev/null -w '%{http_code}\n' http://<coolify-vm-ip>:3000/roadmap
ssh root@<coolify-vm-ip> 'systemctl is-active coolify-autodeploy.timer; journalctl -u coolify-autodeploy -n 3 --no-pager'
```

What "good" looks like: a dump dated this morning at ~150–200 MB, a
`pg_restore -l` header, seven days of `merge_log` rows, 3 roles, a `200`, an
`active` timer. Anything else points at exactly one of the ⚠ unverified rows
above.

---

## 7. Open, in priority order

1. **Confirm the two User Scripts entries exist and fire** (backup `0 5 * * *`,
   merge `30 5 * * *`) and that the backup copy is the corrected script. Until
   this is confirmed, the backup is the one from 2026-08-11.
2. **The threat-snapshot sweep.** 754 MB of the 1,162 MB of table data, 65% of
   every dump's wire cost, never pruned. Needs an index and a batched delete on
   the hosted project (destructive — Hitya's go-ahead), and a decision on
   whether the local archive should keep those rows forever or drop them too.
3. **Lean nightly dumps** (`--exclude-table-data=encounter_threat_snapshots`,
   full weekly) if egress ever matters — a one-line script change, recorded
   here rather than made.
4. **Coolify sign-in (Part F) and the auto-deploy timer** — both written, both
   unconfirmed on the box.
5. **The sentinel's replica tier** (`DESIGN-sentinel.md` §3b): the heavy
   analytical checks belong on Tower's copy, free of production load and
   egress. Designed, not built.
6. **Supabase's own backups and PITR**: Pro includes daily backups; whether PITR
   is enabled and what the Spend Cap is set to are both dashboard-only and
   unread. Tower's dump is the copy we control; theirs is the one we have not
   looked at.
