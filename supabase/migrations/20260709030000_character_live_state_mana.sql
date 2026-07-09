-- character_live_state + self mana (for the /raid mana list + Twitch Queue)
--
-- The agent already reads self_mana_cur/max off the Zeal pipe (labels 124/125,
-- pct at 20) but never uploaded them. Persist a percentage (+ raw cur/max when a
-- verbose pipe supplies them) so the web /raid page can show everyone's mana and
-- build a Twitch Queue (who to feed mana next). Percent is enough for the queue;
-- cur/max are a nicety when present. Null for non-casters / when unknown.
alter table public.character_live_state add column if not exists self_mana_pct real;
alter table public.character_live_state add column if not exists self_mana_cur integer;
alter table public.character_live_state add column if not exists self_mana_max integer;

comment on column public.character_live_state.self_mana_pct is 'Self mana %, from the caster''s own Zeal pipe via their Mimic. Null for non-casters or when the client did not report it.';
