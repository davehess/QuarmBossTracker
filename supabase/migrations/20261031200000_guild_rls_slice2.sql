-- 20261031200000_guild_rls_slice2.sql
--
-- Slice 2 of the per-request guild scoping (docs/DESIGN-raidmimic-hosted.md section 9b; the foundation is
-- 20261031180000_guild_rls_foundation.sql). Two parts.
--
-- 1. The next three tables on the parse-upload path: raid_nights, encounter_combat_rollup, encounter_events. Each already
--    carries a guild_id column (raid_nights and encounter_events NOT NULL; encounter_combat_rollup nullable but with no NULL
--    row in production, measured 2026-10-31 over 390,461 rows), so every policy is the foundation's direct column test.
--    None of the three has a trigger. Their foreign keys (encounters, eqemu_zone) are checked as the table owner.
--
-- 2. The two RPCs the parse path calls honour the guild claim. Both are SECURITY DEFINER, so they bypass RLS and, until now,
--    trusted their arguments: find_or_create_encounter(p_guild_id, ...) wrote an encounter for whatever guild it was told,
--    and merge_encounter_players(p_encounter_id) rebuilt any encounter it was handed. With a claim present each now refuses
--    a guild other than the claim's. NO claim (the service role, which sends none) is NULL and skips the check, so today's
--    callers are untouched. The bodies below are the live definitions (find_or_create_encounter from
--    20261023130000, merge_encounter_players from 20261015040000, both compared with pg_get_functiondef on 2026-10-31); the
--    only change is the guard. merge_encounter_players keeps its live settings, which carry no search_path pin.
--
-- insert_ignore_duplicates (20261020200000) is how the bot writes raid_nights and encounter_events. It is SECURITY INVOKER,
-- so RLS and the table grants apply to its caller; guild_scoped is granted EXECUTE and can reach only the tables it holds
-- grants on, through their policies.
--
-- ADDITIVE and idempotent: nothing is dropped, `create or replace` keeps the grants the lockdown migration set, and each
-- policy is guarded so a re-run adds nothing. The role and app_guild_id() come from the foundation, which must be applied
-- first.

-- 1. Grants: the three tables, the bulk-insert helper, and the two RPCs.
grant select, insert, update, delete on public.raid_nights             to guild_scoped;
grant select, insert, update, delete on public.encounter_combat_rollup to guild_scoped;
grant select, insert, update, delete on public.encounter_events        to guild_scoped;
grant execute on function public.insert_ignore_duplicates(text, jsonb, boolean) to guild_scoped;
grant execute on function public.find_or_create_encounter(text, integer, timestamptz, integer, integer, text) to guild_scoped;
grant execute on function public.merge_encounter_players(uuid) to guild_scoped;

-- 2. The policies: four per table, guarded.
do $$
declare
  t text;
  c text;
  pol text;
begin
  foreach t in array array['raid_nights', 'encounter_combat_rollup', 'encounter_events'] loop
    execute format('alter table public.%I enable row level security', t);
    foreach c in array array['select', 'insert', 'update', 'delete'] loop
      pol := t || '_guild_scoped_' || c;
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = pol) then
        if c = 'insert' then
          execute format('create policy %I on public.%I for insert to guild_scoped with check (guild_id = public.app_guild_id())', pol, t);
        elsif c = 'update' then
          execute format('create policy %I on public.%I for update to guild_scoped using (guild_id = public.app_guild_id()) with check (guild_id = public.app_guild_id())', pol, t);
        else
          execute format('create policy %I on public.%I for %s to guild_scoped using (guild_id = public.app_guild_id())', pol, t, c);
        end if;
      end if;
    end loop;
  end loop;
end
$$;

-- 3. find_or_create_encounter: the live body plus the guild guard.
CREATE OR REPLACE FUNCTION public.find_or_create_encounter(p_guild_id text, p_npc_id integer, p_started_at timestamp with time zone, p_duration integer, p_window_min integer DEFAULT 30, p_zone_short text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id        uuid;
  v_start     timestamptz;
  v_dur       integer;
  v_dmg       bigint;
  v_ended     timestamptz;
  v_hp        bigint;
  v_zone      text;
  v_match_end timestamptz;
  v_gap       interval := interval '15 minutes';
begin
  -- A guild-scoped caller (its JWT carries a guild_id claim) may only write its own guild. The claim is the caller's, read
  -- from the request settings; the service role sends none and skips the check.
  if public.app_guild_id() is not null and p_guild_id is distinct from public.app_guild_id() then
    raise exception 'guild mismatch';
  end if;

  -- Serialize concurrent uploads of the SAME boss so the dedup SELECT below
  -- cannot race a sibling INSERT. Auto-released at COMMIT.
  perform pg_advisory_xact_lock(hashtextextended(p_guild_id || ':' || p_npc_id::text, 0));

  select id, started_at, coalesce(duration_sec, 0), coalesce(total_damage, 0), ended_at
    into v_id, v_start, v_dur, v_dmg, v_ended
  from encounters
  where guild_id = p_guild_id
    and npc_id   = p_npc_id
    and started_at between p_started_at - (p_window_min || ' minutes')::interval
                       and p_started_at + (p_window_min || ' minutes')::interval
  order by abs(extract(epoch from (started_at - p_started_at)))
  limit 1;

  if v_id is not null then
    select hp into v_hp from eqemu_npc_types where id = p_npc_id;
    if v_hp is not null and v_hp > 0
       and v_dmg >= 0.9 * v_hp
       and v_ended is not null   -- only a CONFIRMED kill can have respawned
       and p_started_at > v_start + make_interval(secs => greatest(v_dur, 60) + 120)
    then
      v_id := null;
    end if;
  end if;

  -- A separate attempt: it began long after the matched fight ended (or ended long before it began).
  if v_id is not null then
    v_match_end := greatest(v_start + make_interval(secs => greatest(v_dur, 60)), coalesce(v_ended, v_start));
    if p_started_at > v_match_end + v_gap
       or p_started_at + make_interval(secs => greatest(coalesce(p_duration, 0), 60)) + v_gap < v_start
    then
      v_id := null;
    end if;
  end if;

  if v_id is null then
    v_zone := coalesce(
      p_zone_short,
      (select zone_short from bosses_local where npc_id = p_npc_id limit 1)
    );

    insert into encounters (guild_id, npc_id, started_at, duration_sec, zone_short)
    values (p_guild_id, p_npc_id, p_started_at, p_duration, v_zone)
    returning id into v_id;
  end if;

  return v_id;
end;
$function$;

-- 4. merge_encounter_players: the live body plus the guild guard. An encounter that does not exist reads as no guild and
--    is refused for a scoped caller (it would be a no-op for anyone).
create or replace function merge_encounter_players(p_encounter_id uuid)
returns void as $$
declare
  v_boss text;
  v_rebuildable int;
  v_guild text;
begin
  -- A guild-scoped caller may only rebuild an encounter of its own guild.
  if public.app_guild_id() is not null then
    select e.guild_id into v_guild from encounters e where e.id = p_encounter_id;
    if v_guild is distinct from public.app_guild_id() then
      raise exception 'guild mismatch';
    end if;
  end if;

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

notify pgrst, 'reload schema';
