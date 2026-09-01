-- Spawn id of each raider's current target, from Zeal PR #229
-- (CoastalRedwood/Zeal) which adds spawn_id / target_id / pet_id to the named
-- pipe's `player` message. Approved by the server owner 2026-08-31; awaiting
-- the Zeal maintainer's review.
--
-- WHY: the 2026-06-29 migration that added target_name said it plainly — "the
-- Zeal pipe carries NO spawn id, so same-name mobs are NOT disambiguable".
-- That is what forced _handleAgentExtendedTarget to separate two "a cliff
-- golem" by clustering reporter HP, a heuristic that fails whenever both sit
-- at the same health, and why the overlay asterisks non-unique names. This
-- column is the exact key that replaces the guess.
--
-- ⚠ ONLY MEANINGFUL WITH zone_id ON THE SAME ROW. A spawn id is a slot in the
-- ZONE's entity table, not a durable identity: you are assigned a new one on
-- every zone entry, and slot 4425 in Sebilis is an unrelated mob to slot 4425
-- in The Deep. Measured 2026-08-31 -- see docs/zeal-pipe-protocol.md. Any
-- consumer MUST key on (zone_id, target_id); keying on the id alone merges two
-- zones' mobs into one row, which is precisely the upstream /tag bug in
-- docs/zeal-tag-spawn-id-collision.md.
--
-- ⚠ NULL is the normal case and will be for a long time: no RELEASED Zeal
-- emits these keys, so this stays null for every raider until the PR merges,
-- ships, and each of them updates. Every consumer must keep working from
-- target_name alone, and must treat the id as an enhancement rather than a
-- requirement. A mixed fleet -- some rows with an id, most without -- is the
-- expected steady state, not a transitional one.
alter table public.character_live_state
  add column if not exists target_id integer;

comment on column public.character_live_state.target_id is
  'Zeal spawn id of this character''s current target (Zeal PR #229). A slot in the ZONE entity table, not a durable identity - consumers MUST key on (zone_id, target_id). NULL on every released Zeal; treat as an enhancement over target_name, never a requirement.';
