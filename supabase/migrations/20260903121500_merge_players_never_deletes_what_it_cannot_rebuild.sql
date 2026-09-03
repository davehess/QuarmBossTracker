-- merge_encounter_players must never delete what it cannot rebuild.
--
-- ⚠ THIS IS A POST-MORTEM MIGRATION. I ran the previous migration's RPC against
-- one historical encounter to verify the fix, and it deleted that encounter's
-- player rows and rebuilt nothing: Silverwing in Veeshan's Peak, 2025-03-21
-- 00:13:53Z, 130s, previously 117,219 total damage. Those rows are gone.
--
-- The cause is the function's shape, which predates this change: it DELETEs the
-- encounter's rows and re-INSERTs from contributions.raw_parse. But raw_parse
-- is pruned by retention — 8,632 of 12,820 contributions (67%) already hold
-- NULL — and once it is gone `encounter_players` IS the permanent store. The
-- bot's own comment says so: "encounter_players already holds the merged
-- per-player totals permanently."
--
-- So on any pruned encounter the function was a silent data-loss button, and
-- nothing in its name or signature said so. It has presumably always been this
-- way; it only mattered once someone (me) re-ran it on history.
--
-- ⚠ It would have been much worse. The plan was to re-merge the 198 encounters
-- that list a mob as their own participant, to clear them. EVERY ONE of those
-- 198 has a pruned raw_parse, so that repair would have destroyed all 198
-- encounters' player data instead of fixing them.
--
-- The guard: count what a rebuild would actually produce, and return without
-- touching anything when the answer is zero. Verified against a real pruned
-- encounter — 45 rows before, 45 rows after.
create or replace function merge_encounter_players(p_encounter_id uuid)
returns void as $$
declare
  v_boss text;
  v_rebuildable int;
begin
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
