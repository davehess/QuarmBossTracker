-- merge_encounter_players: the mob being fought is not one of its own raiders.
--
-- Hitya, 2026-09-03: "Vkjor is showing as having taken a death and having a
-- character page. It's an NPC."
--
-- The RPC took every entry in contributions.raw_parse->'players' verbatim. The
-- agent's anti-NPC filter drops multi-word attackers, but a single-word proper
-- name -- which is what most raid bosses are called -- looks exactly like a
-- player name, so mobs landed in encounter_players and then had web character
-- pages built for them.
--
-- Measured before this change: 199 rows across 17 distinct mobs, carrying
-- 2,493,697 damage credited to mobs as though they were raiders. Terror was
-- listed as a participant in fights against Terror 57 times; Trakanon 38;
-- Silverwing 31.
--
-- The predicate deliberately does NOT ask "is this name in the NPC catalog".
-- That question cannot be answered by name: our own parses contain a player
-- called Susanna with 47 rows and no boss kills, and there are real players
-- named Dread, Terror and Fright, all of which are ALSO mob names. What IS
-- unambiguous is narrower and needs no catalog lookup at all: the mob being
-- fought cannot be a participant in its own fight.
--
-- The `characters` guard is for the remaining edge: a raider genuinely named
-- after the boss they are fighting keeps their row. `characters` is incomplete
-- (Susanna is not in it), so that guard is not a perfect shield -- an
-- unregistered player named exactly after the boss they are fighting would
-- still lose that one row. That is rare, and 2.5M phantom damage is worse.
--
-- Idempotent: create or replace. Fixes FUTURE merges ONLY.
--
-- ⚠ The already-written rows canNOT be repaired by re-running this RPC, and
-- believing otherwise cost real data — see the very next migration.
create or replace function merge_encounter_players(p_encounter_id uuid)
returns void as $$
declare
  v_boss text;
begin
  -- The mob this encounter is against, spaced to match how a parse names it.
  select lower(replace(n.name, '_', ' '))
    into v_boss
    from encounters e
    left join eqemu_npc_types n on n.id = e.npc_id
   where e.id = p_encounter_id;

  delete from encounter_players where encounter_id = p_encounter_id;

  insert into encounter_players
    (encounter_id, character_name, total_damage, dps, duration_sec, has_pets, source_contribution_id, rank)
  select
    p_encounter_id,
    player->>'name'                                              as character_name,
    max((player->>'damage')::bigint)                             as total_damage,
    max((player->>'dps')::int)                                   as dps,
    max((player->>'duration')::int)                              as duration_sec,
    bool_or(coalesce((player->>'hasPets')::boolean, false))      as has_pets,
    (array_agg(c.id order by (player->>'damage')::bigint desc))[1] as source_contribution_id,
    row_number() over (order by max((player->>'damage')::bigint) desc) as rank
  from contributions c
  cross join lateral jsonb_array_elements(c.raw_parse->'players') as player
  where c.encounter_id = p_encounter_id
    and (
      v_boss is null
      or lower(player->>'name') <> v_boss
      or exists (select 1 from characters ch where lower(ch.name) = lower(player->>'name'))
    )
  group by player->>'name';

  update encounters
  set total_damage = coalesce((select sum(total_damage) from encounter_players where encounter_id = p_encounter_id), 0),
      total_dps    = coalesce((select sum(dps)          from encounter_players where encounter_id = p_encounter_id), 0)
  where id = p_encounter_id;
end;
$$ language plpgsql security definer;
