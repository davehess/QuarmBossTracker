-- Does this trigger watch text that actually exists? (2026-08-13)
--
-- Our worst trigger failure mode is not the dead pattern — that one we can at
-- least detect by shape. It is the INVENTED pattern: an enabled, healthy-looking
-- trigger watching a string that appears nowhere in the game. The Divine
-- Intervention trigger matched text found in no spell; AOE_DANCE watched a
-- different spell's message. Both read as coverage right up until the night
-- they were needed.
--
-- With mob scripts mirrored (eqemu_quest_scripts) there are now three places a
-- real game string can come from, and a literal that is in NONE of them is
-- almost certainly invented:
--   1. eqemu_spells       cast_on_you / cast_on_other / spell_fades
--   2. eqemu_npc_emotes   DB-driven mob chatter
--   3. eqemu_quest_scripts  script-driven emotes, the ones nothing else has
--
-- This is a VIEW, not a job: it must never "fix" anything on its own. Turning
-- callouts on or off is a raid-noise decision (see docs/RUNBOOK-dead-triggers.md
-- — 37 dead rows deliberately left alone for exactly that reason).
--
-- ⚠ A miss is a PROMPT, not a verdict. Reasons a real trigger lands in here:
--   • the pattern is pure regex with no literal run long enough to test
--   • it watches combat/system text the client generates, not a mob (e.g.
--     "You have been slain") — none of the three sources carry those
--   • the emote lives in server C++ rather than a Lua script
-- So read it as "these deserve a look", never as "these are broken".

-- Longest literal run in a trigger pattern: strip token placeholders and regex
-- metacharacters, then take the longest surviving alphabetic phrase. Short runs
-- are useless to search on (every script contains "the"), hence the length gate
-- in the view below.
create or replace function public.trigger_literal_probe(pattern text)
returns text language sql immutable as $$
  select phrase
  from (
    select trim(regexp_replace(m[1], '\s+', ' ', 'g')) as phrase
    from regexp_matches(
      -- {s}/{n}/{1} placeholders and escaped punctuation become separators, so
      -- a literal run is whatever prose survives between them.
      regexp_replace(
        regexp_replace(coalesce(pattern, ''), '\{[^}]*\}|\\[a-zA-Z]|\[[^]]*\]|\([^)]*\)', '|', 'g'),
        '[\\^$.*+?()\[\]{}|]', '|', 'g'),
      '([A-Za-z][A-Za-z '']{9,})', 'g'
    ) as m
  ) s
  order by length(phrase) desc
  limit 1
$$;

comment on function public.trigger_literal_probe(text) is
  'Longest searchable literal phrase in a trigger pattern, or NULL when the pattern is all regex/tokens.';

create or replace view public.trigger_text_audit as
select
  t.id, t.name, t.enabled, t.category, t.source_pack, t.pattern,
  p.probe,
  exists (select 1 from public.eqemu_spells s
           where s.cast_on_you ilike '%' || p.probe || '%'
              or s.cast_on_other ilike '%' || p.probe || '%'
              or s.spell_fades ilike '%' || p.probe || '%')   as found_in_spells,
  exists (select 1 from public.eqemu_npc_emotes e
           where e.text ilike '%' || p.probe || '%')          as found_in_emotes,
  exists (select 1 from public.eqemu_quest_scripts q
           where q.body ilike '%' || p.probe || '%')          as found_in_scripts
from public.guild_triggers t
-- ⚠ The probe is computed ONCE per row via LATERAL. Inlining the function call
-- into each EXISTS arm re-evaluated it six times per trigger and timed the view
-- out at 60s on 115 rows.
cross join lateral (select public.trigger_literal_probe(t.pattern) as probe) p
where p.probe is not null;

comment on view public.trigger_text_audit is
  'Per-trigger: does its longest literal phrase appear in any spell message, NPC emote, or mob script? All three false on an ENABLED trigger = likely invented text. A prompt to investigate, never an automatic action.';
