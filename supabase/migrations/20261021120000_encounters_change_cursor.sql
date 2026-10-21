-- encounters_change_cursor — a change cursor on encounters, so a player's local copy can ask "what changed since".
--
-- Why (docs: local-first plan §3 and §5): encounters, encounter_players and contributions carry no updated_at,
-- and encounter_players is deleted and rebuilt on every merge_encounter_players, so nothing says WHICH fights
-- changed. contributions.created_at alone misses a merge, a classification change and a delete. GET
-- /api/agent/local-sync?since=<cursor> (utils/localSync.js) pages whole changed encounters by
-- (updated_at, id) and a tombstone list by (deleted_at, id).
--
-- What changes:
--   1. encounters.updated_at  — bumped by a BEFORE UPDATE trigger, and by statement-level triggers on
--      encounter_players (insert / update / delete) and looted_items (insert), each bumping the PARENT fight.
--   2. encounter_tombstones   — one row per deleted encounter (written by an AFTER DELETE trigger). A web-side
--      merge of two fights deletes the source; if a caller does `select set_config('wolfpack.merged_into',
--      '<uuid>', true)` in the same transaction the survivor is recorded in merged_into, otherwise it is null.
--   3. an index on encounters (guild_id, updated_at, id) and one on tombstones (guild_id, deleted_at, id).
--
-- LOOT IS NOT PER-ENCOUNTER IN THIS DATABASE. loot_drops has an encounter_id but holds 0 rows (2026-10-21); the
-- loot that exists is looted_items, which has only a time and a looter. The reader (utils/localSync.js) therefore
-- attaches a loot row to every fight whose window [started_at, coalesce(ended_at, started_at) + 20 minutes]
-- contains looted_at, and the looted_items trigger below bumps exactly those fights (same 20 minutes). Keep the
-- two in step.
--
-- COST ON THE LIVE TABLE (encounters: ~36.9k rows, 14 MB with indexes, 2026-10-21):
--   - ADD COLUMN (nullable) and SET DEFAULT are catalog-only: no table rewrite, ACCESS EXCLUSIVE for milliseconds.
--   - The backfill is ONE UPDATE of every row (~37k new tuple versions, ~10 MB of dead space until autovacuum).
--     It holds row locks for the statement (a second or two); a merge writing the same row in that window waits.
--     It is one statement because a migration runs in one transaction, so "batches" would hold the same locks
--     for the same time. The column is not indexed yet, so the new versions can be HOT.
--   - SET NOT NULL scans the table once under ACCESS EXCLUSIVE (tens of milliseconds at this size); a
--     lock_timeout makes it fail loudly instead of queueing behind a long reader. Re-run the file if it does.
--   - CREATE INDEX (not CONCURRENTLY, which cannot run in a transaction) blocks writes to encounters for the
--     build: well under a second at this size.
--   - Ongoing: every merge now also rewrites updated_at on a fight the merge already updates, so the extra cost
--     is an index entry. Statement-level triggers with transition tables mean ONE parent update per statement,
--     not one per player row, and a row already bumped in the current transaction is skipped.
-- Apply off raid nights (CLAUDE.md freeze: Sun/Wed/Thu 19:30-00:30 ET). Nothing applies this automatically.
--
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS, and the backfill only touches NULLs.

set local lock_timeout = '5s';

-- ── 1. the column ────────────────────────────────────────────────────────────
alter table public.encounters add column if not exists updated_at timestamptz;
alter table public.encounters alter column updated_at set default clock_timestamp();

-- BEFORE UPDATE: stamp the row unless the statement already set a different updated_at (the backfill below
-- does, and must not be overwritten with "now").
create or replace function public.encounters_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists encounters_touch_updated_at on public.encounters;
create trigger encounters_touch_updated_at
  before update on public.encounters
  for each row execute function public.encounters_touch_updated_at();

-- Backfill what is still NULL: the fight's own end, so history orders the way it happened. A row a live
-- UPDATE stamped since the trigger went in is not NULL and is left alone.
update public.encounters
   set updated_at = coalesce(ended_at, started_at, created_at, clock_timestamp())
 where updated_at is null;

alter table public.encounters alter column updated_at set not null;

-- ── 2. children bump the parent fight ─────────────────────────────────────────
-- encounter_players: merge_encounter_players deletes and re-inserts a fight's rows. Statement-level, so a merge
-- is three bumps at most (delete, insert, the encounters update it already does), and `updated_at <
-- transaction_timestamp()` skips a fight this transaction already stamped.
create or replace function public.encounters_bump_from_players_ins()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.encounters e set updated_at = clock_timestamp()
   where e.id in (select distinct encounter_id from new_rows)
     and e.updated_at < transaction_timestamp();
  return null;
end;
$$;

create or replace function public.encounters_bump_from_players_upd()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.encounters e set updated_at = clock_timestamp()
   where e.id in (select encounter_id from new_rows union select encounter_id from old_rows)
     and e.updated_at < transaction_timestamp();
  return null;
end;
$$;

create or replace function public.encounters_bump_from_players_del()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.encounters e set updated_at = clock_timestamp()
   where e.id in (select distinct encounter_id from old_rows)
     and e.updated_at < transaction_timestamp();
  return null;
end;
$$;

drop trigger if exists encounter_players_bump_ins on public.encounter_players;
create trigger encounter_players_bump_ins
  after insert on public.encounter_players
  referencing new table as new_rows
  for each statement execute function public.encounters_bump_from_players_ins();

drop trigger if exists encounter_players_bump_upd on public.encounter_players;
create trigger encounter_players_bump_upd
  after update on public.encounter_players
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.encounters_bump_from_players_upd();

drop trigger if exists encounter_players_bump_del on public.encounter_players;
create trigger encounter_players_bump_del
  after delete on public.encounter_players
  referencing old table as old_rows
  for each statement execute function public.encounters_bump_from_players_del();

-- looted_items: a drop lands after the fight, with no encounter id. Bump every fight of the same guild whose
-- window (start .. end + 20 minutes) contains the loot time. The 6-hour lower bound keeps the encounters_started
-- index range small; no fight is that long.
create or replace function public.encounters_bump_from_loot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.encounters e set updated_at = clock_timestamp()
    from (select distinct guild_id, looted_at from new_rows) l
   where e.guild_id = l.guild_id
     and e.started_at <= l.looted_at
     and e.started_at >  l.looted_at - interval '6 hours'
     and coalesce(e.ended_at, e.started_at) + interval '20 minutes' >= l.looted_at
     and e.updated_at < transaction_timestamp();
  return null;
end;
$$;

drop trigger if exists looted_items_bump_encounters on public.looted_items;
create trigger looted_items_bump_encounters
  after insert on public.looted_items
  referencing new table as new_rows
  for each statement execute function public.encounters_bump_from_loot();

-- ── 3. tombstones ────────────────────────────────────────────────────────────
create table if not exists public.encounter_tombstones (
  id          uuid primary key,
  guild_id    text not null,
  deleted_at  timestamptz not null default clock_timestamp(),
  merged_into uuid
);

-- service_role only (the bot reads it); no policy is created, so anon and authenticated see nothing.
alter table public.encounter_tombstones enable row level security;

create or replace function public.encounters_tombstone_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_into uuid;
begin
  begin
    v_into := nullif(current_setting('wolfpack.merged_into', true), '')::uuid;
  exception when others then
    v_into := null;   -- a malformed setting must never block a delete
  end;
  insert into public.encounter_tombstones (id, guild_id, deleted_at, merged_into)
  values (old.id, old.guild_id, clock_timestamp(), v_into)
  on conflict (id) do update
    set deleted_at = excluded.deleted_at, merged_into = excluded.merged_into;
  return null;
end;
$$;

drop trigger if exists encounters_tombstone on public.encounters;
create trigger encounters_tombstone
  after delete on public.encounters
  for each row execute function public.encounters_tombstone_on_delete();

-- ── 4. the keyset indexes ─────────────────────────────────────────────────────
create index if not exists encounters_guild_updated_idx
  on public.encounters (guild_id, updated_at, id);

create index if not exists encounter_tombstones_guild_deleted_idx
  on public.encounter_tombstones (guild_id, deleted_at, id);
