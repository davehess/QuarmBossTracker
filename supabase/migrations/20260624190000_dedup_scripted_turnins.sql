-- Deduplicate scripted_npc_turnins (Uilnayar 2026-06-24: "What's with these
-- duplicates?"). Two root causes:
--   1. The unique key included raw_snippet, so the same turn-in stored with
--      different snippet text (old manual loads used "path#hash"; GH runs use
--      script text) produced duplicate rows.
--   2. Lua check_turn_in({item1=X,item2=X,...}) parsed the same item N times as
--      separate inputs (rendered as repeated ✓ lines), and `or`-chained checks
--      created several no-reward rows.
-- Fix: normalize inputs (collapse repeats, sort) + outputs (sort), drop
-- no-reward noise, then dedup on a generated content_key and make THAT the
-- uniqueness key so future imports can't re-duplicate.

-- 1) Collapse repeated item_ids in inputs and sort by id.
update scripted_npc_turnins s set inputs = agg.inputs
from (
  select id, jsonb_agg(jsonb_build_object('item_id', item_id, 'qty', q) order by item_id) as inputs
  from (
    select s2.id, (e->>'item_id')::int as item_id, sum(coalesce((e->>'qty')::int, 1)) as q
    from scripted_npc_turnins s2 cross join lateral jsonb_array_elements(s2.inputs) e
    group by s2.id, (e->>'item_id')::int
  ) z group by id
) agg
where agg.id = s.id;

-- 2) Sort outputs by id (keep kind + duplicates for random pools).
update scripted_npc_turnins s set outputs = agg.outputs
from (
  select id, jsonb_agg(elem order by (elem->>'item_id')::int) as outputs
  from (
    select s2.id, e as elem from scripted_npc_turnins s2 cross join lateral jsonb_array_elements(s2.outputs) e
  ) z group by id
) agg
where agg.id = s.id;

-- 3) Drop pure-noise turn-ins with no reward of any kind.
delete from scripted_npc_turnins
where (outputs is null or outputs = '[]'::jsonb)
  and (faction_changes is null or faction_changes = '[]'::jsonb)
  and exp_award is null and cash is null and money_required is null;

-- 4) Generated content key (zone | npc | sorted inputs | sorted outputs | money).
alter table scripted_npc_turnins drop column if exists content_key;
alter table scripted_npc_turnins add column content_key text generated always as (
  zone_short || '|' || lower(npc_name) || '|' || inputs::text || '|' ||
  coalesce(outputs::text, '[]') || '|' || coalesce(money_required::text, '')
) stored;

-- 5) Dedup keeping the lowest id per content_key.
delete from scripted_npc_turnins a using scripted_npc_turnins b
where a.id > b.id and a.content_key = b.content_key;

-- 6) Make content_key the uniqueness key (drop the snippet-based one).
alter table scripted_npc_turnins drop constraint if exists scripted_npc_turnins_zone_short_npc_name_raw_snippet_key;
create unique index if not exists scripted_npc_turnins_content_key_uidx
  on scripted_npc_turnins (content_key);
