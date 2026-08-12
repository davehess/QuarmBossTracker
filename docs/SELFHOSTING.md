# Self-hosting the Wolf Pack platform — zero monthly fees

**What this replaces:** Railway (bot), Vercel (web) and hosted Supabase (database)
with containers on hardware you already own. Two audiences, same instructions:
**another guild** standing the platform up from nothing, and **us** running
Wolf Pack without the monthly bill.

**Status (2026-08-12): every layer is proven, none of it is one-click.** The three
things `DESIGN-external-tenancy.md` named as likely abandonment points in August
were: (a) the Discord anchor-ID ceremony, (b) Supabase + migrations + no catalog,
(c) no diagnostics when something silently fails. **(b) is now solved and
measured**; (a) and (c) are unchanged.

---

## What it costs

| Layer | Hosted | Self-hosted |
|---|---|---|
| Database + auth + API | Supabase (paid tier) | Supabase Docker stack on your box |
| Web (`wolfpack.quest`) | Vercel | Coolify or plain Docker |
| Bot (Discord + agent API) | Railway | `Dockerfile` + `docker-compose.yml` at the repo root — **already exists**, no work needed |
| Agent + Mimic | — | end-user machines, always free |

Cost of the self-hosted column: electricity. What you give up: someone else's
uptime, their CDN, and their backups — see "What you are taking on" at the bottom.

---

## Order of operations

Each step has a runbook that was written while doing it for real, including the
failures. Follow them in order; each one's output is the next one's input.

### 1. Database — `docs/RUNBOOK-unraid-supabase-replica.md`

The self-hosted Supabase stack (Postgres + GoTrue + PostgREST + Realtime +
Storage + Studio). That runbook is Unraid-flavoured, but the traps are universal:
data directories must live on a real filesystem (not a FUSE share, never a FAT32
boot device), and a UI-created compose project ships no `volumes/` tree, which
makes Postgres come up **`healthy` with none of its bootstrap applied**. The
acceptance test is the role list, not the healthcheck.

### 2. Schema — `scripts/selfhost-bootstrap-db.sh`

```bash
CONTAINER=supabase-db bash scripts/selfhost-bootstrap-db.sh
```

Measured on a genuinely empty Postgres 16, 2026-08-12:

| | clean | partial | failed | result |
|---|---|---|---|---|
| migrations alone | 182 | 0 | 11 | unusable |
| **bootstrap + migrations** | **190** | **3** | **0** | **124 tables, 79 functions** |

**Why the migrations alone are not enough.** Six tables production uses are
created by *no* migration — `fun_events`, `pvp_kills`, `pvp_boss_kills`,
`pvp_assists`, `mimic_sessions`, `trigger_timing_feedback`. They were applied
out-of-band without the file being committed (the exact drift CLAUDE.md's
Migrations rule warns about), so the repo could not rebuild its own database.
`supabase/bootstrap/` supplies them plus the roles, extensions, realtime
publication and `auth.uid()`/`auth.role()` helpers a hosted project provides free.

Those six are created **empty**. They are per-guild data — your fun events, your
PvP kills, your Mimic sessions, your trigger votes. No Wolf Pack rows travel with
this.

The 3 partials are security hardening and one-time data repair aimed at objects
and rows a new install does not have. They create no schema. One of them
(`pin_function_search_path`) pins `search_path` on 24 functions and would abort
on the single missing one, so the script re-runs failures non-strict to land the
other 23 — that is what "PARTIAL" means in its output, and it is deliberate.

### 3. Bot

Already containerized at the repo root:
```bash
cp .env.example .env      # fill it in — see below
docker compose up -d
```
`.env.example` documents every variable. The bot needs its own Discord
application (token + the ~30 channel/thread IDs), a `SUPABASE_URL` pointing at
your stack, and `WOLFPACK_AGENT_TOKEN` — any long random string, shared with the
agents that upload to it.

### 4. Web — `docs/RUNBOOK-local-web-coolify.md`

Parts C–E cover the build. Two things decide success: **Base Directory `/web`**
(monorepo), and `NEXT_PUBLIC_*` marked as **build** variables, because Next.js
inlines them at build time and a runtime-only value ships as `undefined`.

### 5. Mimic + agent

Point `cfg.botUrl` at your bot. Nothing else changes — the agent already takes
`--bot-url`. ⚠ Sign-in links and branding inside Mimic are still hardcoded to
`wolfpack.quest` (design doc §2, roughly a day's work, not done).

---

## What is NOT included

- **The `eqemu_*` catalog** — ~97 MB of zone/item/NPC/spell mirrors that powers
  Mob Info, the item database and the spell tools. It syncs weekly from a source
  we mirror; there is no self-serve import path yet. Without it the platform runs,
  but item/NPC/spell lookups are empty. The design doc's recommendation stands:
  publish this as a read-only shared resource rather than making each guild
  rebuild it.
- **PvP `/who` intelligence** — deliberately carved out (Hitya, 2026-08-02). The
  tables exist and the code ships; they start empty and stay that way unless you
  run the harvest yourself.
- **Discord layout automation** — the ~30 anchor IDs are still hand-copied into
  env vars. This remains the single most likely place a new guild gives up.

## What you are taking on

Running this yourself means **you** are the uptime, and the backup. Two things
make that survivable, both already written:

- `scripts/unraid-backup-supabase.sh` — nightly `pg_dump`, 30-day retention, with
  a size floor so a silently-failed dump can never rotate away the last good one.
- `scripts/refresh-local-sandbox.sh` — restores the newest dump nightly, which
  re-proves the backup every single night rather than once.

A backup you have never restored is a hope, not a backup. Restore one before you
need to.
