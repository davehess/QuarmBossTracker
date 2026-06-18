-- Backfill fun_events from parse encounters.
--
-- Motivation: some "fun" bosses emit a fun_events row from the live PvP/Druzzil
-- broadcast relay (e.g. lord_of_ire_killed in index.js). That relay is flaky —
-- if no agent is online with the broadcast in its log (the recurring 1am open-
-- world gap), the kill is never counted even though the killers' agents DID
-- upload a combat encounter for it. Encounters are the reliable record of a WP
-- kill; broadcasts are best-effort. This function fills the gap by deriving a
-- fun_events row from each qualifying encounter that isn't already credited.
--
-- Attribution: top-damage character in the encounter (the same "top-damage
-- attribution" rule used by the original one-off manual backfill — a charm-pet
-- killing blow folds into the charmer via per-main rollup on the web side).
--
-- Idempotency / no-double-count, two independent guards:
--   1. encounter_id link — once an encounter has produced a backfill row we
--      never produce a second (re-runs are free).
--   2. fight-window dedup against broadcast/manual rows (which carry no
--      encounter_id): if any encounter-less fun_event of this type already sits
--      inside [started_at - 2m, started_at + duration + 5m] the kill is already
--      credited (by the live relay or the historical manual backfill) and we
--      skip. The window is bounded by the fight's own duration so back-to-back
--      same-day clears (observed as close as ~10m apart) stay distinct, while a
--      broadcast that lands a few minutes after the killing blow still matches
--      its encounter. We only look at encounter_id IS NULL rows here so two
--      legitimately-close encounters never suppress each other.
--   3. on conflict on the (guild_id,event_type,caster,event_ts) unique index as
--      a final belt-and-suspenders against a top_damager==broadcast-caster tie.
--
-- Wipes (classification='wipe') and data_incomplete encounters are excluded —
-- a wipe isn't a kill, and incomplete data can't be trusted to name the top
-- damager.
--
-- p_dry_run=true returns the would-insert set without writing.

create or replace function backfill_fun_events_from_encounters(
  p_guild_id text,
  p_since    timestamptz default null,
  p_dry_run  boolean default false
)
returns table (
  encounter_id uuid,
  event_ts     timestamptz,
  event_type   text,
  caster       text,
  action       text   -- 'inserted' | 'would_insert'
)
language plpgsql
security definer
set search_path = public
as $$
-- RETURNS TABLE column names (event_type, caster, …) shadow real table columns;
-- tell plpgsql to resolve bare identifiers to the column, not the OUT variable.
#variable_conflict use_column
declare
  v_lead  constant interval := interval '2 minutes';
  v_grace constant interval := interval '5 minutes';
begin
  return query
  with defs(npc_id, ev_type, ev_target) as (
    -- one row per encounter-backed fun counter; add bosses here as needed
    values (76325, 'lord_of_ire_killed', 'Lord of Ire')
  ),
  cand as (
    select e.id as enc_id, e.started_at, e.duration_sec, d.ev_type, d.ev_target,
           (select ep.character_name
              from encounter_players ep
             where ep.encounter_id = e.id
             order by ep.total_damage desc nulls last, ep.character_name
             limit 1) as top_damager
      from encounters e
      join defs d on d.npc_id = e.npc_id
     where e.guild_id = p_guild_id
       and coalesce(e.classification, '') <> 'wipe'
       and coalesce(e.data_incomplete, false) = false
       and (p_since is null or e.started_at >= p_since)
  ),
  needed as (
    select c.*
      from cand c
     where c.top_damager is not null
       and not exists (             -- guard 1: this encounter already backfilled
         select 1 from fun_events fe
          where fe.event_type = c.ev_type
            and fe.encounter_id = c.enc_id
       )
       and not exists (             -- guard 2: already credited by relay/manual row
         select 1 from fun_events fe
          where fe.guild_id   = p_guild_id
            and fe.event_type = c.ev_type
            and fe.encounter_id is null
            and fe.event_ts >= c.started_at - v_lead
            and fe.event_ts <= c.started_at
                  + (coalesce(c.duration_sec, 0) || ' seconds')::interval + v_grace
       )
  ),
  ins as (
    insert into fun_events
      (guild_id, event_ts, event_type, caster, target, encounter_id, raw_text)
    select p_guild_id, n.started_at, n.ev_type, n.top_damager, n.ev_target, n.enc_id,
           'Backfilled from parse encounter (top-damage attribution)'
      from needed n
     where not p_dry_run
    on conflict (guild_id, event_type, caster, event_ts) do nothing
    returning fun_events.encounter_id, fun_events.event_ts, fun_events.event_type, fun_events.caster
  )
  select i.encounter_id, i.event_ts, i.event_type, i.caster, 'inserted'::text
    from ins i
  union all
  select n.enc_id, n.started_at, n.ev_type, n.top_damager, 'would_insert'::text
    from needed n
   where p_dry_run;
end$$;

comment on function backfill_fun_events_from_encounters(text, timestamptz, boolean) is
  'Derive fun_events rows from parse encounters for encounter-backed fun counters '
  '(currently Lord of Ire), deduped against broadcast/manual rows by fight window '
  'and against prior runs by encounter_id. Used by /backfillfunevents and the '
  'nightly midnight chain.';
