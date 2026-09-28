-- PoP guide checklist ticks (the guild lead, 2026-09-28: "Make this a checkbox type of thing").
-- One row per (character, guide item) a member ticked by hand on /pop/guide. Items whose PoP flag the
-- agent already recorded tick from pop_flags and are never stored here. Written only by the web's
-- server action after an ownership check; RLS on with no policies = service role only.
create table if not exists pop_guide_ticks (
  guild_id        text        not null default 'wolfpack',
  character_name  text        not null,
  item_key        text        not null,
  ticked_at       timestamptz not null default now(),
  ticked_by       text,
  primary key (guild_id, character_name, item_key)
);
create index if not exists pop_guide_ticks_char_idx on pop_guide_ticks (lower(character_name));
alter table pop_guide_ticks enable row level security;
revoke all on pop_guide_ticks from anon, authenticated;
grant all on pop_guide_ticks to service_role;
