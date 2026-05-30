-- Per-character DATA FLOOR + opt-out controls.
--
-- Rule (Wolf Pack, 2026-05-30): a player should only be credited with the
-- combat, raid chat, and guild chat they generated *while they were one of us*.
-- We don't have an authoritative "joined the guild" date, so we approximate it
-- from the EARLIEST membership evidence we can observe for the character's whole
-- family (main + alts):
--
--   member_since = LEAST(
--       first /gu (guild-chat) line,
--       first /rs (raid-chat) line,
--       first OpenDKP tick (attendance)
--   )   -- taken across every character in the family
--
-- Why LEAST and not "first guild chat" specifically: in the real data the
-- earliest signal varies by person. Guild-chat capture only started recently
-- for some, while OpenDKP attendance reaches back to 2024 -- so a member who
-- raided in 2024 but whose first *captured* /gu line is 2026 is correctly
-- floored at their 2024 tick, not 2026. Conversely, plenty of members chatted
-- in /gu for weeks before their first tick (joined socially, raided later);
-- LEAST keeps those pre-raid kills/chat too. Validated 2026-05-30: with the
-- family fallback, only 27 of 15,609 encounter_players rows fall before the
-- floor, and 145/147 families resolve a floor (47 of them rescued by ticks
-- when they never appear in captured guild chat).
--
-- PvP kills are EXEMPT from this floor: they are always counted from the
-- beginning of recorded history. This view does not touch PvP data.
--
-- Opt-out: a member may exclude specific characters from log reporting and/or
-- inventory cataloguing (e.g. a char that belongs to another guild, or one
-- whose bank they'd rather not have indexed). Two additive flags on
-- `characters` carry that intent; the agent/bot honor them at ingest/display.

-- 1) Opt-out flags (additive, default = participate as today) -----------------
alter table public.characters
    add column if not exists exclude_from_stats boolean not null default false;
alter table public.characters
    add column if not exists exclude_inventory  boolean not null default false;

comment on column public.characters.exclude_from_stats is
    'Member opt-out: skip this character in combat/chat/log reporting and stats. Agent should not upload, web should not display.';
comment on column public.characters.exclude_inventory is
    'Member opt-out: do not catalog this character''s inventory/bank.';

-- 2) The data-floor view ------------------------------------------------------
create or replace view public.character_data_floor
with (security_invoker = true)
as
with name_family as (
    -- every roster character -> its family root
    select lower(name) as name_l,
           name        as character_name,
           lower(coalesce(nullif(main_name, ''), name)) as family_key,
           coalesce(exclude_from_stats, false) as exclude_from_stats,
           coalesce(exclude_inventory,  false) as exclude_inventory
    from public.characters
    union all
    -- guild-chat speakers we have no roster row for: own family of one
    select lower(s.speaker), s.speaker, lower(s.speaker), false, false
    from (select distinct speaker from public.chat_messages where channel = 'guild') s
    where not exists (
        select 1 from public.characters c where lower(c.name) = lower(s.speaker)
    )
),
gchat as (
    select lower(speaker) as name_l, min(ts) as t
    from public.chat_messages where channel = 'guild' group by lower(speaker)
),
rchat as (
    select lower(speaker) as name_l, min(ts) as t
    from public.chat_messages where channel = 'raid' group by lower(speaker)
),
tick as (
    select lower(a.att) as name_l, min(r.ts) as t
    from public.opendkp_ticks tk
    cross join lateral unnest(tk.attendees) as a(att)
    join public.opendkp_raids r on r.raid_id = tk.raid_id
    group by lower(a.att)
),
fam as (
    -- earliest of each signal across the whole family
    select nf.family_key,
           min(g.t)  as gchat_floor,
           min(rc.t) as rchat_floor,
           min(tk.t) as tick_floor
    from name_family nf
    left join gchat g  on g.name_l  = nf.name_l
    left join rchat rc on rc.name_l = nf.name_l
    left join tick  tk on tk.name_l = nf.name_l
    group by nf.family_key
)
select
    nf.character_name,
    nf.family_key,
    g.t  as own_first_guild_chat,
    fam.gchat_floor,
    fam.rchat_floor,
    fam.tick_floor,
    least(fam.gchat_floor, fam.rchat_floor, fam.tick_floor) as member_since,
    -- which signal set the floor (for confidence/labelling in the UI)
    case least(fam.gchat_floor, fam.rchat_floor, fam.tick_floor)
        when fam.gchat_floor then 'guild_chat'
        when fam.tick_floor  then 'tick'
        when fam.rchat_floor then 'raid_chat'
        else null
    end as floor_source,
    nf.exclude_from_stats,
    nf.exclude_inventory
from name_family nf
left join gchat g on g.name_l = nf.name_l
left join fam   on fam.family_key = nf.family_key;

comment on view public.character_data_floor is
    'Per-character data floor: member_since = earliest of first guild chat, first raid chat, first OpenDKP tick across the family. Stats/combat/chat for a character should be counted on/after member_since. PvP is exempt. Carries per-character opt-out flags.';

grant select on public.character_data_floor to authenticated, service_role;
