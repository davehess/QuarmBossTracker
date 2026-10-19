-- encounters can now belong to another game (the guild lead, 2026-10-19: "start supporting other games";
-- the first is Classic-era WoW, read by packages/wowlogsync/).
--
-- DRAFT: committed for review, NOT applied. Additive and idempotent; nothing about an EverQuest row changes.
--
--   * game        'eq' for every existing row (and every row the EverQuest agent writes), 'wow' for the new reader.
--   * boss_name   the boss's display name as the reader saw it. EverQuest rows leave it NULL and keep reading
--                 the name through the eqemu_npc_types join; the web falls back to this column when that join is NULL.
--   * boss_key    a game-namespaced identity for the fight ('wow:encounter:<encounterID>' or 'wow:npc:<npcId>').
--                 It does the job npc_id does for EverQuest, for a game with no eqemu_npc_types catalog.
--   * npc_id      NOT NULL dropped. The FK to eqemu_npc_types stays; a NULL simply points at nothing. Every existing
--                 consumer already filters on npc_id (= any(...), .in('npc_id', ...), `if (!e.npc_id) continue`),
--                 so a NULL row falls out of them rather than into them.
--   * zone_short  already nullable since the initial schema (FK to eqemu_zone kept); nothing to change.
--
-- find_or_create_encounter_by_key is find_or_create_encounter (20260713120000) keyed on (game, boss_key) instead of
-- npc_id: same advisory lock, same +/- p_window_min match nearest-first, same insert-if-nothing-matched. It
-- deliberately has NO sequential-kill splitter: that rule compares damage with the catalog HP in eqemu_npc_types,
-- and a WoW boss has no catalog row here. Two kills of one boss inside the window therefore knit into one encounter.
--
-- Service-role only, like the RPCs it mirrors (20260718040000).

alter table public.encounters add column if not exists game      text not null default 'eq';
alter table public.encounters add column if not exists boss_name text;
alter table public.encounters add column if not exists boss_key  text;

alter table public.encounters alter column npc_id drop not null;

create index if not exists encounters_game_boss_key_started_idx
  on public.encounters (game, boss_key, started_at desc)
  where boss_key is not null;

create or replace function public.find_or_create_encounter_by_key(
  p_guild_id   text,
  p_game       text,
  p_boss_key   text,
  p_boss_name  text,
  p_started_at timestamp with time zone,
  p_duration   integer,
  p_window_min integer default 30
)
 returns uuid
 language plpgsql
 security definer
 set search_path = public
as $function$
declare
  v_id uuid;
begin
  -- Serialize concurrent uploads of the SAME boss so the dedup SELECT below cannot race a sibling INSERT.
  -- Auto-released at COMMIT.
  perform pg_advisory_xact_lock(hashtextextended(p_guild_id || ':' || p_game || ':' || p_boss_key, 0));

  select id
    into v_id
  from encounters
  where guild_id = p_guild_id
    and game     = p_game
    and boss_key = p_boss_key
    and started_at between p_started_at - (p_window_min || ' minutes')::interval
                       and p_started_at + (p_window_min || ' minutes')::interval
  order by abs(extract(epoch from (started_at - p_started_at)))
  limit 1;

  if v_id is null then
    insert into encounters (guild_id, game, boss_key, boss_name, started_at, duration_sec)
    values (p_guild_id, p_game, p_boss_key, p_boss_name, p_started_at, p_duration)
    returning id into v_id;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.find_or_create_encounter_by_key(text, text, text, text, timestamptz, integer, integer) from public;
revoke all on function public.find_or_create_encounter_by_key(text, text, text, text, timestamptz, integer, integer) from anon;
revoke all on function public.find_or_create_encounter_by_key(text, text, text, text, timestamptz, integer, integer) from authenticated;
grant execute on function public.find_or_create_encounter_by_key(text, text, text, text, timestamptz, integer, integer) to service_role;
