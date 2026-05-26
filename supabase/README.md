# Supabase

Database for the RaidBosses project. Schema lives in `migrations/` —
Supabase's GitHub integration auto-applies any new file in this folder
when it lands on the configured branch (usually `main`).

## Project

- **Project ref:** `zhtoekwakucbckvatfky`
- **URL:** `https://zhtoekwakucbckvatfky.supabase.co`
- **Region:** Americas

## Schema layout

```
Tier 1  — eqemu_*           upstream mirrors (read-mostly, synced weekly)
Tier 2  — guild tables      our writes (encounters, loot, characters, …)
                            FK against eqemu_npc_types.id and eqemu_items.id
sync_meta                   tracks which upstream dump we're aligned with
```

See `migrations/20260525120000_initial_schema.sql` for the full definitions.

## Required env vars (bot side)

Set in Railway → Variables:
```
SUPABASE_URL=https://zhtoekwakucbckvatfky.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Project Settings → API → service_role>
SUPABASE_GUILD_ID=wolfpack
```

The `service_role` key bypasses RLS. Keep it server-side only. **Never commit
it or paste it in chat.** It can read/write everything.

## Migrations workflow

```
1. Edit:    supabase/migrations/<timestamp>_<description>.sql
2. Commit:  to a feature branch (not main yet)
3. Review:  schema diff visible in PR
4. Merge:   to main → Supabase auto-applies
5. Verify:  Supabase Dashboard → Database → Tables
```

Naming convention: `YYYYMMDDHHMMSS_short_description.sql`. Files apply in
filename order. Migrations are idempotent (`CREATE TABLE IF NOT EXISTS`) so
re-application is safe.

## Security posture

- RLS is **enabled on every table** by the migration itself, regardless of
  the project-level "Automatic RLS" toggle.
- `anon` and `authenticated` roles have **all default grants revoked** by the
  migration, then re-granted SELECT only on the public game-data tables
  (`eqemu_*`, `patch_notes`, `sync_meta`).
- Guild-only and officer-only tables are deny-all to anon/authenticated for
  now. Policies will be added when the web UI's auth scheme is settled.
- The bot uses `service_role` which bypasses RLS — writes are unaffected.

## What gets stored where

| Source | Tables written |
|---|---|
| `/parse`, `/parseboss`, `/parseaoe` | `encounters`, `contributions`, `encounter_players` (via RPC) |
| `/parsecontrib` (new) | `contributions` for existing encounter |
| `/kill`, `/unkill`, `/updatetimer` | `audit_log` (mirror of Discord audit thread) |
| `/loot` (when wired) | `loot_drops` |
| `/register` | `characters` (when sync is enabled) |
| `/addboss` (rewritten) | `bosses_local` |
| Sync job (weekly) | all `eqemu_*` tables + `sync_meta` |
| Local log agent (future) | `combat_events`, `contributions` (source='local_agent_v1') |

## Privacy posture

- **No raw EQ log text** is ever stored. Only parsed structured events.
- Officer chat, tells, guild chat are filtered locally by the agent before
  upload — they never reach the database.
- `characters.discord_id` is populated only via opt-in commands.
- `officer_notes.visibility = 'officer'` rows are gated by RLS (when policies
  are added).
- `audit_log` is officer-readable only.

## First-time setup

1. Project was created via the Supabase dashboard with the GitHub integration
   pointing at `davehess/QuarmBossTracker`.
2. After this PR merges to `main`, Supabase applies the migration automatically.
3. Add the env vars listed above to Railway.
4. Restart the bot. Existing `/parse` calls begin writing to Supabase in
   addition to the existing `data/parses.json` + Discord-thread archive.

## Resetting (dev only)

```sql
-- DESTROY EVERYTHING — only for dev/staging projects.
drop schema public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
```

Then re-merge the initial migration.

## Future migrations

- `0002_*` — `/loot` auction tables (once API capture lands)
- `0003_*` — local log agent event ingest schema
- `0004_*` — web UI auth integration (Discord OAuth → Supabase auth)
- `0005_*` — additional `eqemu_*` columns as we discover what we need
