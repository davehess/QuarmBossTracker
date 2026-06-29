-- Current target on character_live_state — the mob/player each raider has
-- targeted right now (Zeal gauge slot 6), plus its HP%. The agent already
-- streams target_name + target_hp_pct in its live-state flush; the bot was
-- dropping them. Persisting here lets GET /api/agent/extended-target aggregate
-- "how many raiders are on each target" for the Extended Target raid overlay.
--
-- Note (see CLAUDE.md): the Zeal pipe carries NO spawn id, so same-name mobs
-- are NOT disambiguable — target_name alone can't tell two "a cliff golem"
-- apart. The overlay surfaces that with an asterisk on non-unique names.
alter table public.character_live_state
  add column if not exists target_name   text,
  add column if not exists target_hp_pct real;
