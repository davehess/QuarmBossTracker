-- character_quest_prefs — per-character quest layout: reorder, hide, dismiss.
-- "Hide" is reversible from the picker; "dismiss" is the stronger "I'm never
-- doing this" intent (Uilnayar 2026-06-23). Both bring the quest back via the
-- collapsed "Dismissed (N)" footer on the page, so nothing is destructively
-- lost. display_order overrides the catalog's display_order when set.

create table if not exists character_quest_prefs (
  id              bigserial   primary key,
  guild_id        text        not null default 'wolfpack',
  character_name  text        not null,
  quest_id        bigint      not null references quest_catalog(id) on delete cascade,
  display_order   integer,
  hidden          boolean     not null default false,
  dismissed       boolean     not null default false,
  updated_at      timestamptz not null default now()
);
create unique index if not exists character_quest_prefs_uniq
  on character_quest_prefs (guild_id, lower(character_name), quest_id);
create index if not exists character_quest_prefs_char_idx
  on character_quest_prefs (lower(character_name));
alter table character_quest_prefs enable row level security;
grant all on character_quest_prefs to service_role;
grant usage, select on all sequences in schema public to service_role;
