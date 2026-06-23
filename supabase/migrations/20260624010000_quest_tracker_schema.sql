-- Quest tracker — per-character inventory + curated quest catalog + privacy.
-- The page renders against this data; inventory rows arrive from a future
-- agent file watcher on <character>-Inventory.txt. Until that lands, the
-- page renders red-X for every required item (which is correct — we just
-- haven't observed the inventory yet).

-- Per-character privacy preference for the inventory/quest tracker. Default
-- private (owner + officers only); flip true to share with the whole guild.
alter table characters
  add column if not exists show_inventory_publicly boolean not null default false;

-- Inventory snapshot per character. Latest only — older snapshots get
-- overwritten on next upload via (character, slot_label) unique. Slot
-- encoding follows EQ's outputfile inventory format:
--   • Equipped: 'Head', 'Chest', 'Primary', 'Secondary', etc.
--   • General bag tops: 'General1' … 'General10'
--   • Bag contents: 'General1-Slot1' … 'GeneralN-SlotM'
create table if not exists character_inventory (
  id              bigserial   primary key,
  guild_id        text        not null default 'wolfpack',
  character_name  text        not null,
  slot_label      text        not null,
  item_id         integer,                                 -- → eqemu_items.id (nullable for unrecognized)
  item_name       text        not null,
  quantity        integer     not null default 1,
  charges         integer,                                 -- for clickies / consumables
  observed_at     timestamptz not null default now()
);
create unique index if not exists character_inventory_slot_uniq
  on character_inventory (guild_id, lower(character_name), slot_label);
create index if not exists character_inventory_char_idx
  on character_inventory (lower(character_name));
create index if not exists character_inventory_item_idx
  on character_inventory (item_id)
  where item_id is not null;

-- Keys, as reported by EQ's /keys command. The output is a list of named
-- keys (e.g. "Key to the Hatching Pens"); each line becomes a row.
-- character_keys.item_id is best-effort name match against eqemu_items
-- (some custom Quarm keys may not resolve).
create table if not exists character_keys (
  id              bigserial   primary key,
  guild_id        text        not null default 'wolfpack',
  character_name  text        not null,
  key_name        text        not null,
  item_id         integer,                                 -- → eqemu_items.id (best-effort)
  observed_at     timestamptz not null default now()
);
create unique index if not exists character_keys_uniq
  on character_keys (guild_id, lower(character_name), lower(key_name));
create index if not exists character_keys_char_idx
  on character_keys (lower(character_name));

-- Hand-curated quest catalog. Officers manage via /admin/quests; quests
-- render on /character/[name]/quests with completion % based on whether
-- the character's character_inventory contains the required items.
create table if not exists quest_catalog (
  id              bigserial   primary key,
  guild_id        text        not null default 'wolfpack',
  name            text        not null,
  category        text,                          -- 'key', 'armor', 'epic', 'stack-turnin', 'other'
  zone            text,                          -- where the quest takes place / hands in
  pqdi_quest_url  text,                          -- canonical PQDI quest deep-link
  notes           text,                          -- officer notes shown on the row
  display_order   integer     not null default 100,
  active          boolean     not null default true,
  is_stack_turnin boolean     not null default false,  -- show in the stack-table view
  reward_item_id  integer,                       -- → eqemu_items.id (the FINAL deliverable item — what completion means having)
  reward_item_name text,                         -- text fallback
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists quest_catalog_category_idx on quest_catalog (category) where active;
create index if not exists quest_catalog_active_idx on quest_catalog (active, display_order);

-- Items required by a quest (the "recipe" view the user described).
-- quantity > 1 = needs N of the item (handles "10 bone chips" style
-- stack-turn-ins cleanly). optional = officer hint (some quests have
-- substitutable components).
create table if not exists quest_required_item (
  id              bigserial   primary key,
  quest_id        bigint      not null references quest_catalog(id) on delete cascade,
  item_id         integer,                                 -- → eqemu_items.id (nullable when name-only)
  item_name       text        not null,                    -- always populated for display
  quantity        integer     not null default 1,
  optional        boolean     not null default false,
  display_order   integer     not null default 100,
  notes           text                                     -- e.g. "rare drop from Kael giants"
);
create index if not exists quest_required_item_quest_idx
  on quest_required_item (quest_id, display_order);
create index if not exists quest_required_item_item_idx
  on quest_required_item (item_id) where item_id is not null;

-- All officer-only tables. Service-role bypasses RLS; nothing else gets in.
alter table character_inventory   enable row level security;
alter table character_keys        enable row level security;
alter table quest_catalog         enable row level security;
alter table quest_required_item   enable row level security;
grant all on character_inventory, character_keys, quest_catalog, quest_required_item to service_role;
grant usage, select on all sequences in schema public to service_role;
