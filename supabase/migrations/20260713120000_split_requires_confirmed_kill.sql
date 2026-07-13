-- find_or_create_encounter: the sequential-kill splitter may only fire when
-- the matched encounter is a CONFIRMED kill (ended_at set — the confirmed_kill
-- upload path / reconcile stamp it). Field case (Uilnayar 2026-07-13, Lord of
-- Ire): a duo burned the mob to ~96%, the monk dispelled + Feigned Death, the
-- mob reset and FULL-HEALED, and they re-killed it 11 minutes later. The old
-- splitter saw "damage >= 0.9 x HP and a new start past the fight window" and
-- declared it a respawn re-kill -> two kill cards for one kill. But a mob that
-- never produced a death line CANNOT have respawned — if the matched
-- engagement is unconfirmed, the new upload is the same kill continuing
-- (FD juggle, leash reset, heal-through) and must knit into it.
--
-- True back-to-back re-kills keep splitting: their first kill is confirmed by
-- the killer's own parser (the death line rides the killing upload), so
-- ended_at is set by the time the second kill's upload matches.
CREATE OR REPLACE FUNCTION public.find_or_create_encounter(p_guild_id text, p_npc_id integer, p_started_at timestamp with time zone, p_duration integer, p_window_min integer DEFAULT 30, p_zone_short text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_id        uuid;
  v_start     timestamptz;
  v_dur       integer;
  v_dmg       bigint;
  v_ended     timestamptz;
  v_hp        bigint;
  v_zone      text;
begin
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
