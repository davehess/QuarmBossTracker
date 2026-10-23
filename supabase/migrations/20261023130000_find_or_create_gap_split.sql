-- find_or_create_encounter: a NEW upload that starts well after the matched fight ENDED is its own fight.
--
-- Field case (the guild lead, 2026-10-23): two wipes on one boss ~30 minutes apart showed as one parse. The
-- function knits any upload whose start is within +/-30 min of an existing row, and that is deliberate for an
-- UNCONFIRMED row (20260713120000: a Lord of Ire dispel + Feign Death reset full-heals the mob, and the re-kill
-- must join the first row, not mint a second kill). But it also meant attempt 2 of a wipe, 20 minutes after
-- attempt 1 ended, knitted onto attempt 1. The agent now closes a fight when its top target takes no damage for
-- 5 minutes (agent 4.0.15); this is the server half, for the uploads that arrive as separate fights.
--
-- The rule, added to the existing splitter (which is unchanged): a matched row is passed over when
--   new start > matched END + 15 min      (matched END = the later of start + max(duration, 60 s) and ended_at)
--   or new END + 15 min < matched start    (a late upload of the EARLIER attempt, e.g. a backfill)
--
-- Why 15 minutes. It must be longer than any gap the agent keeps inside ONE fight (the agent splits at 5 min),
-- and it must keep the Lord of Ire knit. The real Lord of Ire rows of 2026-07-13 show that re-kill began ~10.5
-- min after the first row's active end (13.5 min after its start), so 10 min would have split it; 15 keeps it
-- with margin. Two real wipe attempts are separated by a run back, rebuffs and rezzes: >= ~20 min in practice.
-- Uploads keep matching the nearest row inside the +/-30 min window; the rule only declines the match.
--
-- duration_sec is gap-trimmed ACTIVE time, shorter than the wall span, so the matched END also takes ended_at
-- when a confirmed kill stamped it (the true last event). That only widens the knit, never narrows it.
--
-- CREATE OR REPLACE keeps the owner and grants (service_role only) but REPLACES function settings, so the
-- search_path pin from 20260718043553 is restated here. Body otherwise identical to 20260713120000.
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
