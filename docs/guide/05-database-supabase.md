# The database: Supabase (for officers)

For whoever creates and maintains the platform's database. At the end you will have one Supabase project holding the schema, the EverQuest reference catalog and your guild's data, and you will know how it is changed, kept small and backed up.

## 1. The model

One Supabase project serves everything:

- the **bot** reads and writes through the REST API with the service-role key, which bypasses row-level security (RLS);
- the **website** reads with the anon key plus the member's session, and uses the service-role key on the server for sign-in and officer pages;
- a **GitHub Action** fills the catalog (below).

Nothing talks to Postgres directly except backups and migrations.

**Plan.** Wolf Pack runs Supabase **Pro** ($25 a month: 8 GB database, 250 GB egress, 100 GB storage), which is our choice, not a requirement. **Free** gives 500 MB, 5 GB egress and 1 GB storage, and pauses after 7 idle days. A fresh deployment spends about 119 MB on the catalog, leaving about 380 MB, which our busiest telemetry table would fill within weeks; a free project needs short retention (section 6) and suits only a short trial. The hosted floor is about $30 a month (Pro plus Railway Hobby). Figures: `docs/DESIGN-selfhost-wizard.md` §2a, September 2026; check current plans.

## 2. Create the schema

1. Create a Supabase project. Note the project URL, the anon key and the service-role key (Project Settings → API). Never commit the service-role key. ⚠ unverified: use the legacy JWT-style keys; the code predates the newer publishable and secret keys, and the bot sends its key as both `apikey` and Bearer.
2. The migrations alone cannot build the schema: six tables production uses (`fun_events`, `pvp_kills`, `pvp_boss_kills`, `pvp_assists`, `mimic_sessions`, `trigger_timing_feedback`) are created by no migration. Apply `supabase/bootstrap/02-uncaptured-tables.sql` first. It is idempotent, and `mimic_sessions` is what Mimic sign-in and `/token` write to.
3. Apply the migrations in `supabase/migrations/` in filename order (about 290 files). Either link Supabase's GitHub integration to your repo (directory `supabase`, branch `main`) so every file on `main` applies automatically (after step 2), or run bootstrap and migrations together with one command, using the session-pooler URI from Dashboard → Connect (port 5432):

   ```
   DB_URL="<session-pooler-uri>" bash scripts/selfhost-bootstrap-db.sh
   ```

   The script applies both bootstrap files itself, including the roles, extensions and helpers a hosted project already has. On an empty Postgres 16 in August 2026 it applied 190 of 193 migrations cleanly and 3 partially; none failed. ⚠ unverified: nobody has run it against a fresh hosted project, and the counts have grown.
4. Load the catalog (section 4).

**Check it worked:**

```sql
select count(*) from information_schema.tables where table_schema = 'public';   -- well over 100
select max(version) from supabase_migrations.schema_migrations;                 -- newest filename's timestamp
select count(*) from eqemu_items;                                                -- about 27,000 after the sync
```

## 3. Changing the schema

Add `supabase/migrations/YYYYMMDDHHMMSS_description.sql`, idempotent (`IF NOT EXISTS`); the integration applies it when it merges to `main`. If the column is needed now, apply it with the Supabase tool `apply_migration` under the same name **and** commit the identical file. ⚠ The integration once applied nothing for three days unnoticed; after a merge, compare the newest file with the `max(version)` query above.

## 4. The reference catalog (Tier 1)

`eqemu_*` has 32 mirror tables of zones, items, NPCs, spells, loot, spawns, factions and recipes. `.github/workflows/sync-quarm.yml` refreshes them every Sunday at 06:00 UTC from the upstream Quarm dump, and also pulls mob scripts into `eqemu_quest_scripts`. In your fork add the secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_GUILD_ID`, then run the workflow once from the Actions tab (`force` re-imports after new mirror tables). It commits `data/sync_state.json`.

> ⚠ `docs/SELFHOSTING.md` says the catalog has no self-serve import. The workflow and `scripts/sync-from-eqmac.js` do that against any project whose keys you supply, but this chapter has not been run on a fresh project.

**Check it worked:** the Actions run is green and `select count(*) from eqemu_items` is above zero.

Read `docs/eqemu-catalog-cheatsheet.md` before querying it: an NPC id encodes its zone (`id = zone id × 1000 + n`), and the catalog's respawn times are not raid timers.

## 5. What lives where, and who can read it

| Tier | Tables | Written by | Readable by |
|---|---|---|---|
| 1, mirrors | `eqemu_*`, `sync_meta` | the weekly sync | mostly anyone (anon) |
| 2, guild data | `characters`, `bosses_local`, `raid_nights`, `encounters`, `encounter_players`, `contributions`, `encounter_combat_rollup`, `loot_drops`, `chat_messages`, `who_observations`, `character_live_state`, `buff_casts`, `raid_roster`, `guild_triggers`, `fun_events`, `wolfpack_members`, `wolfpack_roles`, `audit_log` and more | the bot; a few by the site | signed-in members; sensitive tables only the service role |
| Bot state | `bot_kv` | the bot | service role only |

**RLS.** The first migration enables it on every table and revokes all anon and authenticated grants. Later migrations grant back: anon reads mainly the public catalog tables (a few, such as `eqemu_spells`, are signed-in only); `20260528310000_tighten_anon_read.sql` closed the early anon reads on guild tables; guild tables are read by `authenticated` where the site needs them; sealed bids, tells and tokens are tighter. Audit it:

```sql
select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public' order by 1, 2;
```

**`bot_kv`** (`guild_id`, `key`, `value` jsonb) holds small state that must survive Railway deploys: per-night and per-fight records and archive watermarks (`data/state.json` cannot, see chapter 03).

**Functions.** `find_or_create_encounter(p_guild_id, p_npc_id, p_started_at, p_duration, p_window_min default 30, p_zone_short default null)` dedups a kill across uploaders within a time window; `merge_encounter_players(p_encounter_id)` merges per-player damage across submitters. (⚠ CLAUDE.md lists five arguments; the migration has six.) Others serve retention and character pages (`prune_who_observations`, `thin_threat_snapshots`, `character_missing_spells`).

**Storage.** Migrations create two private buckets: `feedback-screenshots` and `guild-media`.

⚠ PostgREST caps a response at about 1,000 rows. The site pages in steps of 1,000, so a self-hosted `max-rows` must be at least 1,000.

## 6. Cost and retention

Writes are nearly free; **reads cost egress**, so poll cadences and wide selects are the bill (there is no per-request quota). Database size only grows, so the bot sweeps at midnight; each sweep is tunable by environment variable, and `0` disables it.

- `buff_casts`: 7 days (`BUFF_CASTS_RETENTION_DAYS`).
- `who_observations`: 60 days raw plus each character's latest sighting (`WHO_OBS_RETENTION_DAYS`).
- `target_observations`: 1 day. `xp_events`: 30 days (names group members).
- `encounter_threat_snapshots`: 30 days, but ⚠ the sweep deletes only what an on-prem archive's watermark (`bot_kv` key `archive_watermark_threat_snapshots`) and the stored threat graphs cover. With no archive it deletes nothing and the table, our largest, keeps growing. (CLAUDE.md still calls the sweep broken for lack of an index; that shipped in `20260923010000`.)
- Raid position replays (`raid_track_minutes`): kept unless `RAID_TRACK_RETENTION_DAYS` is set.

On a small plan set `TRACK_UNCURATED_MOBS=0` (stops storing encounters for farm mobs) and consider switching the threat-snapshot stream off with `flag_shed_threat_snapshot=1` in the `/admin/overlays` tuning editor (live within about a minute).

## 7. Backups

Pro includes daily backups; point-in-time recovery and the Spend Cap are dashboard-only and unread here. Wolf Pack also keeps its own nightly dump, a pattern worth copying (`scripts/unraid-backup-supabase.sh`):

- connect with the **session pooler** URI (port 5432), never the 6543 transaction pooler;
- run `pg_dump` from a `postgres` image of the same or newer major version as the server, custom format, `--no-owner --no-acl`;
- refuse to rotate when a dump is suspiciously small (a silent failure writes about 0 bytes);
- keep 30 days; schedule it outside your raid window.

A dump moves table data out of Supabase every night, which is egress; ours was about 1.1 GB. It does not contain Discord-held state, dashboard settings (Railway and Vercel variables, the Discord provider, the redirect list) or Storage file contents. **Restore** into a new project with `pg_restore --no-owner --no-acl --schema=public`, re-create those settings, and members re-link on their next sign-in because `wolfpack_members` upserts on `discord_id`. That path is untested end to end.

**Check it worked:** restore the newest dump into a scratch database and run `select count(*) from encounters`. A backup you have never restored is a hope.

## If it goes wrong

- **Migrations fail on a fresh project:** the six bootstrap tables are missing; apply `02-uncaptured-tables.sql` and re-run.
- **Mimic sign-in or `/token` errors:** `mimic_sessions` does not exist.
- **Catalog pages empty:** the sync has not run, or its three secrets are missing in the fork.
- **A feature works for the bot but the site shows nothing:** a missing RLS policy; check `pg_policies`.
- **Reads stop at 1,000 rows:** `max-rows` is below 1,000.
- **The database keeps growing:** see the threat-snapshot sweep above.
