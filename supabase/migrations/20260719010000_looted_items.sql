-- #91 — "You have looted" capture (who ACTUALLY loots). All raid loot is
-- no-drop, so the winner of a ROLL isn't always who ends up with the item —
-- a re-roll or a pass legitimately hands it to someone else. The looter's own
-- log ("--You have looted <item>.--", self-only in EQ) is the only truth.
--
-- A NEW narrow table rather than reusing loot_observations: that table requires
-- item_id AND npc_name_lower (both NOT NULL) — a looted line supplies NEITHER
-- (the agent knows only the display name, and the line names no corpse). Faking
-- those to fit would be dishonest, so we store what a looted line actually
-- carries. Read-only for members; the site links a looted item to its roll
-- session (fuzzy item match within ~10 min) at read.
create table if not exists public.looted_items (
  id                      bigint generated always as identity primary key,
  guild_id                text        not null,
  looter_character        text        not null,   -- as it appeared in the log
  looter_lower            text        not null,    -- lowercased for dedup/join
  item_name               text        not null,    -- article-stripped display name
  zone                    text,                     -- Zeal zone at loot time, if known
  looted_at               timestamptz not null,
  uploaded_by_discord_id  text,
  source                  text        not null default 'local_agent_v1',
  created_at              timestamptz not null default now()
);
-- One row per (looter, item, instant): a restart re-read or a second observer
-- collapses instead of double-counting.
create unique index if not exists looted_items_dedup
  on public.looted_items (guild_id, looter_lower, item_name, looted_at);
create index if not exists looted_items_guild_time
  on public.looted_items (guild_id, looted_at desc);

alter table public.looted_items enable row level security;
drop policy if exists looted_items_read on public.looted_items;
create policy looted_items_read on public.looted_items
  for select to authenticated using (true);
