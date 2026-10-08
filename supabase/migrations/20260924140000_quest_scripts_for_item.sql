-- quest_scripts_for_item(p_item_id) — which of Quarm's own quest scripts take
-- an item IN, and which hand it OUT (a member, 2026-09-24: "our pages don't have
-- tradeskill recipes or quests listed").
--
-- WHY NOT scripted_npc_turnins. That table is parsed from the ProjectEQ script
-- repo by scripts/import-quest-scripts.js, and its regexes only keep a branch
-- whose reward is a LITERAL — `QuestReward(e.self, 0,0,0,0, 12345)`. A script
-- that computes the reward first drops out whole: highpass/Captain_Ashlan.lua
-- counts Orc Scalps into a variable and pays on that, so Orc Scalp showed no
-- quest at all while PQDI lists Captain Ashlan. It also misses the
-- `item_lib.count_handed_item(e.self, e.trade, {13073}, 4)` form, which is how
-- most of the Bone Chips turn-ins are written. Keep that table for what it is
-- good at — the give → get detail line — and use this for coverage.
--
-- WHAT THIS READS. eqemu_quest_scripts (the SecretsOTheP/quests mirror, all
-- Lua), through its trigram index: `body ~ '\m<id>\M'` narrows 5,719 scripts to
-- the handful that mention the number (1.8 ms for 11594), and two regexes then
-- say how the number is used:
--   component — inside the item table of check_turn_in / count_handed_item
--   reward    — inside the argument list of QuestReward / SummonItem
-- A script that only MENTIONS the number (a spawn id, a dialogue branch) is
-- neither and is dropped: item ids and NPC ids share a number space, so a bare
-- match is not evidence of anything.
--
-- Checked against PQDI's own quest tab on 2026-09-24: Bone Chips (13073) — all
-- nine quest-givers PQDI lists, plus the Toxxulia skeleton reward; Crushbone
-- Belt (13318) — the same three; Orc Scalp (13791) — Captain Ashlan.
--
-- ⚠ Upstream scripts, not a live-server dump (see the table's own migration) —
-- a reward chosen at runtime from a variable is still invisible here.
--
-- npc_id: best-effort, from the id encoding (zoneid*1000+n) plus the script's
-- file name. NULL when the zone is an alternate copy with no NPC rows of its own
-- (towerbone) or the script is an encounter file named for the event, not a mob.

create or replace function public.quest_scripts_for_item(p_item_id integer)
returns table (
  path         text,
  zone_short   text,
  zone_name    text,
  npc_name     text,
  npc_id       integer,
  is_encounter boolean,
  as_component boolean,
  as_reward    boolean
)
language sql
stable
set search_path = public
as $$
  with hits as (
    select q.path, q.zone_short, q.npc_name, q.is_encounter,
           q.body ~ ('(check_turn_in|count_handed_item)\s*\([^{]*\{[^}]*\m' || p_item_id || '\M') as as_component,
           q.body ~ ('(QuestReward|SummonItem)\s*\([^)]*\m' || p_item_id || '\M')                  as as_reward
    from public.eqemu_quest_scripts q
    where p_item_id > 0
      and q.body ~ ('\m' || p_item_id || '\M')
  )
  select h.path,
         h.zone_short,
         coalesce(z.long_name, z.short_name, h.zone_short) as zone_name,
         h.npc_name,
         (select min(n.id)::integer
            from public.eqemu_npc_types n
           where z.zone_id is not null
             and n.id between z.zone_id * 1000 and z.zone_id * 1000 + 999
             and lower(ltrim(replace(n.name, '_', ' '), '#')) = lower(ltrim(h.npc_name, '#'))) as npc_id,
         h.is_encounter,
         h.as_component,
         h.as_reward
    from hits h
    left join public.eqemu_zone z on z.short_name = h.zone_short
   where h.as_component or h.as_reward
   order by h.as_reward, 3, h.npc_name
   limit 200;
$$;

-- Tier 1 catalog data: same audience as the table it reads.
grant execute on function public.quest_scripts_for_item(integer) to anon, authenticated;
