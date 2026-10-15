-- merge_encounter_players: serialize concurrent merges of the SAME encounter.
--
-- Raid night 2026-10-14 logged 409s on encounter_players_pkey. Every agent
-- upload for an encounter records a contribution and then calls this RPC, and
-- the function is delete-then-reinsert. Two uploads for one encounter landing
-- together run two copies at once: A deletes, B deletes (nothing left to see),
-- A inserts its rebuilt rows, B inserts the same (encounter_id, character_name)
-- keys -> duplicate key on the primary key, PostgREST answers 409, and the
-- losing upload's merge is dropped.
--
-- Fix: a transaction-scoped advisory lock keyed on the encounter, taken first.
-- The second caller waits for the first to commit, then runs its own
-- delete + rebuild against the newer contributions (each statement in a
-- READ COMMITTED function takes a fresh snapshot, so it sees the first
-- caller's committed rows and the other upload's contribution). Merges of
-- DIFFERENT encounters hash to different keys and never wait on each other.
-- The lock is released automatically at commit/rollback; there is nothing to
-- unlock and nothing to leak.
--
-- Everything else is the live definition (compared against pg_get_functiondef
-- on 2026-10-15): same signature, same SECURITY DEFINER, same
-- never-delete-what-it-cannot-rebuild guard, same max-damage-per-player
-- rebuild. CREATE OR REPLACE keeps the existing grants (service_role only).
create or replace function merge_encounter_players(p_encounter_id uuid)
returns void as $$
declare
  v_boss text;
  v_rebuildable int;
begin
  -- Serialize merges of the same encounter. The namespaced text keeps this key
  -- from colliding with any other advisory-lock user hashing a bare uuid.
  perform pg_advisory_xact_lock(hashtext('merge_encounter_players:' || p_encounter_id::text));

  select lower(replace(n.name, '_', ' '))
    into v_boss
    from encounters e
    left join eqemu_npc_types n on n.id = e.npc_id
   where e.id = p_encounter_id;

  select count(*) into v_rebuildable
    from contributions c
    cross join lateral jsonb_array_elements(coalesce(c.raw_parse->'players','[]'::jsonb)) as player
   where c.encounter_id = p_encounter_id;

  if v_rebuildable = 0 then
    raise notice 'merge_encounter_players: % has no rebuildable parse data; leaving existing rows intact', p_encounter_id;
    return;
  end if;

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
