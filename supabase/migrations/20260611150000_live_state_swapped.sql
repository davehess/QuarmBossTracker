-- Character-swap tracking for /raid.
--
-- When a player swaps characters on the same EQ client, Mimic retires the old
-- character's Zeal state (same-pid takeover, v1.0.69-beta.1) — but the web
-- still showed BOTH as in-raid because raid_roster keeps the old toon in its
-- group and character_live_state keeps its last snapshot. The agent now
-- forwards the swap to the bot, which stamps it here; /raid moves the old
-- character to "Not in raid — (swapped to <X>)".

alter table public.character_live_state
  add column if not exists swapped_to text,
  add column if not exists swapped_at timestamptz;

comment on column public.character_live_state.swapped_to is
  'Set when this character logged off because the same EQ client logged another character in (Mimic same-pid takeover). Cleared on the next live snapshot.';
