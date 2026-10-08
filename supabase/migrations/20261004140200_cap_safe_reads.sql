-- 20261004140200_cap_safe_reads.sql
-- Reads the bot used to do as "select … limit=N" and that PostgREST silently cut to 1,000 rows (or to N,
-- when N is smaller), moved into the database so the answer no longer depends on how many rows a busy
-- raid night produced.
--
-- The guild lead, 2026-10-04: "review all of the other tables for silent 500 or 100 caps." PostgREST
-- answers at most 1,000 rows per response, with no error and no flag, and `limit=50000` does not lift
-- it. Measured on production the same day (each figure is in the commit that uses the object):
--   * raid-buff-queue read the newest 1,000 of 7,362 buff_casts rows in a 3 h window: 4 minutes of a
--     raid. Of the 354 (target, spell) pairs that were still running it saw 49; of the Aegolism-line
--     rows it saw none of 71. An earlier Aego read as missing.
--   * Extended Target read the newest 600 of 4,251 rows in 30 min.
--   * the burst queue and the Mimic damage panel summed a capped slice of encounter_players.
--   * 18 families have more than 1,000 opendkp_ticks, so their mirror "earned" read low.
--   * eqemu_npc_drops has 307,642 rows (27.7 NPCs per item on average, 1,847 at most): a 100-item chunk
--     returns thousands of rows, so the loot fold judged an item "dropped by exactly one NPC" from a
--     truncated list.
--
-- Everything here is read-only and idempotent (create or replace). SECURITY INVOKER with a pinned
-- search_path: the functions add nothing the caller could not already select, and the bot calls them as
-- service_role. Execute is revoked from public/anon/authenticated and granted to service_role only, the
-- same as 20261004120000_latest_character_levels.sql.
--
-- The two buff_casts functions are STABLE on purpose: the bot reaches them with GET
-- /rpc/<name>?p_guild_id=…&order=…&limit=…&offset=… (PostgREST allows GET only for stable functions) so
-- the one shared paginator, selectAllPaged, can drain them if a bigger raid ever passes 1,000 rows.


-- ── 1. raid-buff-queue: the latest still-running row per (target, spell) ─────────────────────────────
-- What the handler does with buff_casts: drop a row past its catalog duration (dur_ticks * 6 s), drop
-- one cast before the target's last death (in memory, bot side), and keep the NEWEST row per
-- (target, spell). So the newest unexpired row per pair is all it ever needed; older repeats of the
-- same buff were read, thrown away, and counted against the cap.
--
-- The expiry test matches the handler's: a row with no duration (null or 0) is not expired here (it
-- falls out later because it has no ticks left to show), a row with one is kept while
-- cast_at + dur_ticks * 6 s has not passed. Filtering BEFORE picking the newest is what the handler did
-- too, so the result is the same set it would have built from an unlimited read.
--
-- Index: buff_casts_recent_idx (guild_id, cast_at desc); EXPLAIN ANALYZE on the busiest 3 h window of
-- the week (7,362 rows): index scan, 1,332 rows kept, 354 returned, 19 ms.
-- distinct on exact-case (target, spell_name): the bot lowercases both when it keys, so a case variant
-- is simply folded there.
create or replace function public.latest_buff_landings(p_guild_id text, p_since timestamptz)
returns table(target text, spell_name text, dur_ticks integer, cast_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (b.target, b.spell_name)
         b.target, b.spell_name, b.dur_ticks, b.cast_at
  from buff_casts b
  where b.guild_id = p_guild_id
    and b.cast_at >= p_since
    and b.target is not null
    and b.spell_name is not null
    and (coalesce(b.dur_ticks, 0) <= 0
         or b.cast_at + b.dur_ticks * interval '6 seconds' >= now())
  order by b.target, b.spell_name, b.cast_at desc, b.id desc
$$;

comment on function public.latest_buff_landings(text, timestamptz) is
  'Newest not-yet-expired buff_casts row per (target, spell_name) since p_since (expired = dur_ticks > 0 and cast_at + dur_ticks*6s < now()). Feeds /api/agent/raid-buff-queue. Page it with order=target.asc,spell_name.asc.';


-- ── 2. Extended Target: every debuff landing that is still running ───────────────────────────────────
-- The handler folds landings of one spell within 5 s into one cast (observers pool, spawn ids pool),
-- then keeps the newest cast per (spell, spawn id) — and, before any of that, skips a row past its
-- duration. A "latest row per (target, spell, target_id)" would drop the other Mimics that saw the same
-- landing and the older cast of a different same-name mob, both of which the attribution reads. So
-- this returns every row the handler would have kept, not a summary: the same rows an unlimited read
-- would have fed it, minus the ones it skips anyway.
--
-- Measured over 7 days of 15-minute windows: 30-minute windows hold up to 4,251 rows, of which at most
-- 644 are still running. id is returned so the bot can page deterministically (order=cast_at.desc,id.asc).
create or replace function public.recent_debuff_landings(p_guild_id text, p_since timestamptz)
returns table(id bigint, target text, target_id integer, spell_name text, dur_ticks integer,
              cast_at timestamptz, observer text, is_charm_spell boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select b.id, b.target, b.target_id, b.spell_name, b.dur_ticks, b.cast_at, b.observer, b.is_charm_spell
  from buff_casts b
  where b.guild_id = p_guild_id
    and b.cast_at >= p_since
    and (coalesce(b.dur_ticks, 0) <= 0
         or b.cast_at + b.dur_ticks * interval '6 seconds' >= now())
$$;

comment on function public.recent_debuff_landings(text, timestamptz) is
  'Every buff_casts row since p_since that is not past its duration (dur_ticks > 0 and cast_at + dur_ticks*6s < now() are dropped). Feeds Extended Target debuffs. Page it with order=cast_at.desc,id.asc.';


-- ── 3. burst queue + Mimic damage panel: tonight's / 30-day damage per character ─────────────────────
-- The burst queue read a 6 h encounter_players ⨯ encounters join (2-3k rows, unordered, limit=5000) and
-- summed it in JS; the damage panel summed the 200 largest SINGLE-FIGHT rows and labelled it "30 d
-- total". Both want sum(total_damage) per character, so one function serves both: p_limit null returns
-- everyone (the burst queue), p_limit 25 the top of the table (the panel).
-- Grouped on lower(character_name) like the burst queue's own lowercasing; production has no case
-- variants in encounter_players today (0 of 1,583), so the panel's display names do not change.
-- peak_dps is the highest single-fight dps in the window. Plan on production: encounters_started_idx
-- then a join to encounter_players; 30 d is 1.0 s (17,698 encounters), 6 h is 70 ms.
create or replace function public.encounter_damage_by_character(
  p_guild_id text, p_since timestamptz, p_limit integer default null)
returns table(character_name text, total_damage bigint, encounters bigint, peak_dps integer)
language sql
stable
security invoker
set search_path = public
as $$
  select min(p.character_name)                          as character_name,
         coalesce(sum(p.total_damage), 0)::bigint       as total_damage,
         count(*)                                       as encounters,
         coalesce(max(p.dps), 0)                        as peak_dps
  from encounter_players p
  join encounters e on e.id = p.encounter_id
  where e.guild_id = p_guild_id
    and e.started_at >= p_since
    and p.character_name is not null
  group by lower(p.character_name)
  order by 2 desc, 1
  limit p_limit
$$;

comment on function public.encounter_damage_by_character(text, timestamptz, integer) is
  'Per character (case-folded): sum of encounter_players.total_damage, fight count and best single-fight dps over encounters started since p_since. p_limit null = everyone. Feeds the burst queue (6 h) and the Mimic server-panel damage key (30 d).';


-- ── 4. mirror DKP: earned and spent per family name ──────────────────────────────────────────────────
-- _familyDkpFromMirror read opendkp_ticks with attendees=ov.{family}&limit=3000: 18 families have more
-- than 1,000 ticks (the most, 1,456), so `earned` came back low. The loot side (opendkp_loot, at most
-- 251 rows per family) was safe but is folded in here so the whole mirror sum stops depending on a cap.
--
-- Same arithmetic as the JS it replaces, NOT one sum per tick: a tick's value is added once per
-- attending family character (docs/STATUS.md records it, and the pooled balance has always been
-- computed that way). The overlap test `attendees && p_names` is exact-case and GIN-indexed, like the
-- ov. filter was; inside the ticks it matches, an attendee counts when its lowercase is a family name
-- (the JS lowercased too). spent matches character_name case-insensitively (the ilike clause it
-- replaces). fetched_at is the newest mirror row that contributed, for the panel's "as of".
create or replace function public.family_dkp_mirror(p_names text[])
returns table(name_lower text, earned bigint, spent bigint, fetched_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  with fam as (
    select distinct lower(x) as nl from unnest(p_names) as x where x is not null
  ),
  earn as (
    select lower(a) as nl, sum(t.value)::bigint as earned, max(t.fetched_at) as fetched_at
    from opendkp_ticks t
    cross join lateral unnest(t.attendees) as a
    where t.attendees && p_names
      and lower(a) in (select nl from fam)
    group by lower(a)
  ),
  spent as (
    select lower(l.character_name) as nl, sum(l.dkp)::bigint as spent, max(l.fetched_at) as fetched_at
    from opendkp_loot l
    where lower(l.character_name) in (select nl from fam)
    group by lower(l.character_name)
  )
  select coalesce(e.nl, s.nl) as name_lower,
         coalesce(e.earned, 0)::bigint as earned,
         coalesce(s.spent, 0)::bigint as spent,
         greatest(e.fetched_at, s.fetched_at) as fetched_at
  from earn e
  full join spent s on s.nl = e.nl
$$;

comment on function public.family_dkp_mirror(text[]) is
  'Per family name (lowercase): DKP earned from opendkp_ticks (the tick value once per attending family character) and spent from opendkp_loot, plus the newest fetched_at that contributed. Feeds _familyDkpFromMirror (account-dkp and bid-history).';


-- ── 5. one row per item: how many NPCs drop it, and which one when it is exactly one ─────────────────
-- Three callers asked eqemu_npc_drops for every (item, NPC) pair of up to 100 items and then counted:
--   utils/openDkpSync.js (the loot fold) and commands/backfillopendkploot.js: "exactly one NPC drops it
--     → confident; several → ambiguous; none → unknown";
--   index.js Mob Info: candidate_npcs = how many NPCs drop it, unique_to_mob = exactly one.
-- Each needs a count and, when the count is 1, that NPC. A 100-item chunk of the 307,642-row view
-- returns thousands of rows and PostgREST cut it at 1,000, so an item whose rows fell past the cut read
-- as "one NPC" or as "no NPC": a wrong confident attribution, or an unknown that should have been
-- ambiguous (627 rows in loot_observations disagree with the drop tables today: 269 filed as one NPC's
-- drop that several NPCs drop, 358 filed unknown that have an owner). This returns at most one row per
-- requested item. Those 627 rows are NOT rewritten here; that is an officer's decision.
--
-- npc_id / npc_name are those of the lowest npc_id, which is THE NPC exactly when npc_count = 1 and is
-- not meant to be read otherwise. count(distinct npc_id) is the old callers' count: they keyed on npc_id
-- (or on npc_id + name, which npc_types makes the same thing).
-- security_invoker like eqemu_npc_drops itself; EXPLAIN ANALYZE for 85 items: 5,550 view rows, 72
-- returned, 390 ms cold, via eqemu_lootdrop_entries_item_idx.
create or replace view public.eqemu_item_drop_owner
with (security_invoker = true) as
select d.item_id,
       count(distinct d.npc_id)::integer                 as npc_count,
       (array_agg(d.npc_id   order by d.npc_id))[1]      as npc_id,
       (array_agg(d.npc_name order by d.npc_id))[1]      as npc_name
from public.eqemu_npc_drops d
where d.item_id is not null
group by d.item_id;

comment on view public.eqemu_item_drop_owner is
  'One row per item that any catalogued NPC drops: npc_count = distinct NPCs, npc_id/npc_name = the lowest-id NPC (the owner when npc_count = 1). Replaces chunked reads of eqemu_npc_drops that PostgREST cut at 1,000 rows.';

grant select on public.eqemu_item_drop_owner to service_role;


-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.latest_buff_landings(text, timestamptz) from public;
revoke all on function public.latest_buff_landings(text, timestamptz) from anon;
revoke all on function public.latest_buff_landings(text, timestamptz) from authenticated;
grant execute on function public.latest_buff_landings(text, timestamptz) to service_role;

revoke all on function public.recent_debuff_landings(text, timestamptz) from public;
revoke all on function public.recent_debuff_landings(text, timestamptz) from anon;
revoke all on function public.recent_debuff_landings(text, timestamptz) from authenticated;
grant execute on function public.recent_debuff_landings(text, timestamptz) to service_role;

revoke all on function public.encounter_damage_by_character(text, timestamptz, integer) from public;
revoke all on function public.encounter_damage_by_character(text, timestamptz, integer) from anon;
revoke all on function public.encounter_damage_by_character(text, timestamptz, integer) from authenticated;
grant execute on function public.encounter_damage_by_character(text, timestamptz, integer) to service_role;

revoke all on function public.family_dkp_mirror(text[]) from public;
revoke all on function public.family_dkp_mirror(text[]) from anon;
revoke all on function public.family_dkp_mirror(text[]) from authenticated;
grant execute on function public.family_dkp_mirror(text[]) to service_role;
