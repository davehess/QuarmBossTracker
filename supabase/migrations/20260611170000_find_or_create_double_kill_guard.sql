-- Double-kill guard for find_or_create_encounter.
--
-- Observed 2026-06-11: Kaas Thox Xi Aten Ha Ra was killed TWICE in one night,
-- 23 minutes apart. The ±30min dedup window glued every kill-B upload onto the
-- kill-A row, and max-per-player merging then kept each raider's bigger
-- kill-A number — a second full 1.9M kill collapsed into statistical nothing
-- (the row sat at 97% of exactly one boss HP). Officers had to split it by
-- hand.
--
-- Guard: when the nearest in-window match BOTH
--   (a) already looks complete — total_damage >= 90% of the NPC's catalog HP
--       (eqemu_npc_types.hp; skip the guard when HP is unknown), AND
--   (b) had already ENDED before the new parse began — p_started_at >
--       matched.started_at + GREATEST(duration_sec, 60s) + 120s grace
-- ...treat the new parse as a NEW kill and insert a fresh encounter row.
--
-- Why both conditions: (b) alone would mis-split fragment rows — a row whose
-- duration_sec is still a 17s first-upload fragment "ends" long before honest
-- same-fight contribs (late joiners start 10-15 min into a long fight) arrive.
-- The HP gate means we only split when the matched row is already a credible
-- full kill. Late same-kill uploads (queued agents, backfills) pass through:
-- their parse start falls INSIDE the matched fight window, failing (b).
--
-- find_or_create_encounter already picks the NEAREST in-window row, so once
-- the second row exists, subsequent kill-B uploads attach to it by proximity.

create or replace function find_or_create_encounter(
  p_guild_id text,
  p_npc_id integer,
  p_started_at timestamptz,
  p_duration integer,
  p_window_min integer default 30,
  p_zone_short text default null
)
returns uuid as $$
declare
  v_id        uuid;
  v_start     timestamptz;
  v_dur       integer;
  v_dmg       bigint;
  v_hp        bigint;
  v_zone      text;
begin
  select id, started_at, coalesce(duration_sec, 0), coalesce(total_damage, 0)
    into v_id, v_start, v_dur, v_dmg
  from encounters
  where guild_id = p_guild_id
    and npc_id   = p_npc_id
    and started_at between p_started_at - (p_window_min || ' minutes')::interval
                       and p_started_at + (p_window_min || ' minutes')::interval
  order by abs(extract(epoch from (started_at - p_started_at)))
  limit 1;

  -- Double-kill guard (see header comment).
  if v_id is not null then
    select hp into v_hp from eqemu_npc_types where id = p_npc_id;
    if v_hp is not null and v_hp > 0
       and v_dmg >= 0.9 * v_hp
       and p_started_at > v_start + make_interval(secs => greatest(v_dur, 60) + 120)
    then
      v_id := null;   -- matched row is a finished, complete kill — this is a new one
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
$$ language plpgsql security definer;
