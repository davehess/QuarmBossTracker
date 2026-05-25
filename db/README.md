# Supabase schema

Run these once to set up the database. The bot writes here when the
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars are present, and
gracefully no-ops when they aren't (existing `state.json` + Discord-thread
storage continues to work unchanged).

## Apply the schema

**Option A — Supabase Dashboard (easiest):**

1. Open your project at https://supabase.com/dashboard
2. **SQL Editor** → **New query**
3. Paste the contents of `0001_initial_schema.sql`
4. **Run**

**Option B — psql:**

```bash
# Get the connection string from Supabase → Project Settings → Database
export SUPABASE_DB_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

psql "$SUPABASE_DB_URL" < db/0001_initial_schema.sql
```

## Required env vars (Railway / `.env`)

```
SUPABASE_URL=https://[PROJECT-REF].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[from Project Settings → API → service_role]
SUPABASE_GUILD_ID=wolfpack              # matches the guild_id column on every row
```

The **service_role key** bypasses Row Level Security — keep it server-side
only, never expose it in a browser. If you build a public web UI later, use
the **anon key** with RLS policies for read-only access.

## What gets written, by command

| Command | Tables |
|---|---|
| `/parse` (existing) | `encounters`, `contributions`, `encounter_players` |
| `/parsecontrib` (new) | `contributions` only — attaches to existing encounter |
| `/raidnight` (existing) | `raid_nights` (one row created at thread open) |
| Local agent v1 | `combat_events` + `contributions` (source='local_agent_v1') |
| `/rosterimport` (future) | `characters` (mirror of Discord roster) |

## Privacy posture

- **No raw log lines are stored.** Only structured combat events (attacker,
  defender, ability, amount, ts_ms). Officer chat / tells / guild chat are
  filtered locally by the agent before upload and never reach the database.
- `contributions.raw_parse` is the parsed JSON structure, never the raw text.
- `characters.discord_id` is populated only via opt-in commands.

## Schema overview

```
raid_nights ──┐
              └→ encounters ──┬→ contributions ──┐
                              ├→ encounter_players (denormalized)
                              └→ combat_events (granular, agent-only)

characters    (independent roster mirror)
```

## Resetting (dev only)

```sql
-- DROP TABLES — destroys all data
drop table if exists combat_events, encounter_players, contributions, encounters, raid_nights, characters cascade;
drop view if exists encounter_completeness;
drop function if exists find_or_create_encounter, merge_encounter_players;
```

Then re-apply `0001_initial_schema.sql`.
