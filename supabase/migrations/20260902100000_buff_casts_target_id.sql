-- Which SPAWN a buff/debuff landed on, not just which name.
--
-- Hitya, 2026-09-02: "we also need to incorporate the spawn ID into the target
-- info window so we dedup those effects between same named mobs, off of spawn
-- id."
--
-- buff_casts has always keyed a landing by target NAME, so the cross-client
-- Target Info relay merges every same-name mob in the zone into one effect
-- list. Three "a thought horror evoker" produce one pooled set of debuffs, and
-- the mob you are actually targeting shows timers that belong to its siblings.
-- Zone scoping (#141) fixed the same bug ACROSS zones; this is the same idea one
-- level down, WITHIN a zone.
--
-- ⚠ NULL IS THE NORMAL CASE, NOT AN ERROR, AND CONSUMERS MUST FAIL OPEN.
-- A landing line names its target by NAME only; the Zeal pipe carries a spawn id
-- for exactly one mob — the observer's OWN current target. So an id is provable
-- only when the observer happened to be targeting the thing the effect landed
-- on. A cleric watching a debuff land while targeting the tank cannot supply
-- one, and no released Zeal supplies one at all (PR #229 merged upstream
-- 2026-08-31, unreleased). A consumer that drops NULL rows would empty the
-- board for the entire guild.
--
-- The read rule, mirrored in the bot's _idScopeKeep():
--     requester has no id      -> keep everything (today's behaviour)
--     row id is NULL           -> KEEP (unproven, not disproven)
--     row id equals requester  -> keep
--     row id differs           -> DROP  <- the whole point
--
-- ⚠ This deliberately does NOT join the partial unique indexes that dedup
-- buff_casts. Adding it there would let one landing insert twice — once from an
-- observer who could prove the id and once from one who could not. The
-- consequence is that when two people see the same land, whichever row wins the
-- race decides whether the id is stored; the observer's OWN Mob Info never
-- depends on that, because it merges its local landings before consulting this
-- table.
--
-- ⚠ An id is a slot in the ZONE's entity table, reused on every zone entry, so
-- it is only meaningful together with the zone the relay already scopes by.
-- Never treat target_id as a global identity.
alter table public.buff_casts
  add column if not exists target_id integer;

comment on column public.buff_casts.target_id is
  'Zeal spawn id of the mob this landing was observed on (PR #229), when the observer could prove it by targeting that mob. NULL is normal and means unproven, never "different mob" - consumers must fail open. Only meaningful alongside the zone: an id is a slot in the zone entity table, not a global identity.';
