-- scripted_npc_turnins data-quality cleanup (Uilnayar 2026-06-30):
-- "It looks like all of these Caerlyna or Realnyna quests are broken. Maybe
-- we should remove any of these. Really anything where the reward is a
-- number and not an item, cash, or faction." + "There are also a bunch of
-- duplicates and several don't have these mobs linkable."
--
-- Root causes found:
--   1. ~1193 rows give a reward that resolves to NOTHING real — the output
--      item_id doesn't exist in eqemu_items, and there's no cash or faction
--      reward either. The worst offenders are "Caerlyna" (bazaar, 216 rows)
--      and "Realnyna" (crescent, 214 rows) — a bidirectional A<->B container
--      swap utility script (every row's output is some OTHER row's input and
--      vice versa), not a real quest; both have npc_id NULL, matching "not
--      linkable". A few "global"-zone rows (FamiliarBrewworks, Priest of
--      Discord) are the same pattern.
--   2. True duplicate rows: the same NPC name + identical inputs + identical
--      outputs imported twice under two different zone_short spellings for
--      the same real zone (freeporteast/freporte both = East Freeport,
--      misty/mistythicket both = Misty Thicket) — one copy usually has a
--      resolved npc_id and the other doesn't (a re-import merged the good
--      data with a stale row rather than replacing it).
--
-- Fix follows the same pattern as the earlier npc_id hotfix
-- (20260624170000_scripted_turnins_npc_id_column.sql): materialize both
-- checks as columns (one-time backfill) so discover_quests_for_item just
-- reads a boolean instead of re-deriving it on every call.

alter table scripted_npc_turnins
  add column if not exists has_real_reward boolean not null default true,
  add column if not exists is_duplicate    boolean not null default false;

-- has_real_reward: true when at least one output item_id resolves in
-- eqemu_items, OR there's a nonzero cash reward, OR a nonempty faction
-- change list. False = "gives literally nothing recognizable" (an id with no
-- catalog entry, a placeholder, or a busted import row).
with reward_check as (
  select s.id,
    exists (
      select 1 from jsonb_array_elements(s.outputs) o
      join eqemu_items ei on ei.id = (o->>'item_id')::int
    ) as has_item,
    coalesce((s.cash->>'plat')::int, 0) + coalesce((s.cash->>'gold')::int, 0)
      + coalesce((s.cash->>'silver')::int, 0) + coalesce((s.cash->>'copper')::int, 0) > 0 as has_cash,
    (s.faction_changes is not null and jsonb_array_length(s.faction_changes) > 0) as has_faction
  from scripted_npc_turnins s
  where jsonb_array_length(s.outputs) > 0
)
update scripted_npc_turnins s
set has_real_reward = (r.has_item or r.has_cash or r.has_faction)
from reward_check r
where r.id = s.id;
-- Rows with an EMPTY outputs array (no item reward at all) still need a
-- cash/faction check — jsonb_array_length(outputs)=0 skipped the CTE above.
update scripted_npc_turnins s
set has_real_reward = (
  coalesce((s.cash->>'plat')::int, 0) + coalesce((s.cash->>'gold')::int, 0)
    + coalesce((s.cash->>'silver')::int, 0) + coalesce((s.cash->>'copper')::int, 0) > 0
  or (s.faction_changes is not null and jsonb_array_length(s.faction_changes) > 0)
)
where jsonb_array_length(s.outputs) = 0;

-- is_duplicate: within has_real_reward rows, group by (npc_name, inputs,
-- outputs) — identical give/get pairs from the identically-named NPC are the
-- same real-world turn-in re-imported under a different zone_short spelling.
-- Keep exactly one per group (prefer a resolved npc_id, then lowest id);
-- mark the rest duplicate so discover_quests_for_item skips them.
with ranked as (
  select id,
    row_number() over (
      partition by npc_name, inputs, outputs
      order by (npc_id is null), id
    ) as rn
  from scripted_npc_turnins
  where has_real_reward
)
update scripted_npc_turnins s
set is_duplicate = true
from ranked r
where r.id = s.id and r.rn > 1;

-- Caerlyna/Realnyna aren't fully caught by the reward-resolution check above:
-- some of their swap pairs happen to use a real bag item id on the resolving
-- side (e.g. input a synthetic bazaar-tagged id, output a real "Rallic Pack").
-- They're still not a real quest — every row's output is some sibling row's
-- input and vice versa, and npc_id is null for all of them — so exclude by
-- name explicitly on top of the general check.
update scripted_npc_turnins
set has_real_reward = false
where npc_name in ('Caerlyna', 'Realnyna') and has_real_reward;

create index if not exists scripted_npc_turnins_quality_idx
  on scripted_npc_turnins (has_real_reward, is_duplicate);

-- discover_quests_for_item now filters on the materialized flags — no
-- per-call recomputation, same shape/signature as before.
drop function if exists discover_quests_for_item(integer[]);
create or replace function discover_quests_for_item(p_item_ids integer[])
returns table(
  turnin_id     bigint,
  zone_short    text,
  npc_name      text,
  npc_id        integer,
  evidence      text,
  matched_item_id integer,
  inputs        jsonb,
  outputs       jsonb,
  faction_changes jsonb,
  exp_award     integer,
  cash          jsonb,
  money_required jsonb,
  random_outputs boolean
) language sql stable as $$
  with held(item_id) as (select unnest(p_item_ids))
  select s.id, s.zone_short, s.npc_name, s.npc_id, 'piece' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.inputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  where s.has_real_reward and not s.is_duplicate
  union all
  select s.id, s.zone_short, s.npc_name, s.npc_id, 'completed' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.outputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  where s.has_real_reward and not s.is_duplicate
  order by 5 desc, 2, 3
  limit 500;
$$;
grant execute on function discover_quests_for_item(integer[]) to service_role;
