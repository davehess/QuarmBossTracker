-- Quarmy gear ingest (docs/DESIGN-quarmy-gear.md).
--
-- Source: the in-game Quarmy export file (<Name>Quarmy.txt, TSV) that members
-- generate for quarmy.com. The AGENT parses it locally and drops every Bank /
-- SharedBank / coin row BEFORE upload — bank contents and currency never
-- leave the member's machine, which is stronger than "never public". The
-- bot's /api/agent/quarmy endpoint strips them again (defense in depth) and
-- refuses writes for characters with exclude_inventory set.
--
-- Latest-state overwrite (faction v2 philosophy): one row per slot / per AA,
-- replaced wholesale on each upload. ~130 gear rows + ~20 AA rows per
-- character; zero growth.

create table if not exists public.character_gear (
  guild_id   text        not null,
  character  text        not null,
  loc        text        not null check (loc in ('equipped', 'bag')),
  slot       text        not null,          -- 'Head', 'Primary', 'General3-Slot7', …
  item_id    int         not null,
  item_name  text        not null,
  count      int         not null default 1,
  updated_at timestamptz not null default now(),
  primary key (guild_id, character, loc, slot)
);
create index if not exists character_gear_item_idx
  on public.character_gear (guild_id, item_id);

create table if not exists public.character_aas (
  guild_id   text        not null,
  character  text        not null,
  aa_index   int         not null,          -- in-game AA table index (catalog TODO)
  rank       int         not null,
  updated_at timestamptz not null default now(),
  primary key (guild_id, character, aa_index)
);

alter table public.character_gear enable row level security;
drop policy if exists character_gear_read on public.character_gear;
create policy character_gear_read on public.character_gear
  for select to authenticated using (true);

alter table public.character_aas enable row level security;
drop policy if exists character_aas_read on public.character_aas;
create policy character_aas_read on public.character_aas
  for select to authenticated using (true);

-- Profile facts the export carries that nothing else captures. deity_id in
-- particular upgrades the faction page's base-standing estimates (its caveat
-- today is literally "deity isn't tracked yet"). quarmy_checksum lets both
-- agent and bot skip unchanged re-uploads.
alter table public.characters
  add column if not exists deity_id         int,
  add column if not exists quarmy_checksum  text,
  add column if not exists quarmy_synced_at timestamptz;

-- Item columns the gear analysis needs that the initial mirror skipped. The
-- weekly sync-quarm.yml populates them on its next run (sync-from-eqmac.js
-- picks columns by name); until then they read NULL and the web page says so.
alter table public.eqemu_items
  add column if not exists worneffect   int,    -- worn effect spell id (Fire Fist, infravision, haste, Vengeance …)
  add column if not exists worntype     int,
  add column if not exists attack       int,    -- +ATK, drives melee recommendations
  add column if not exists haste        int,
  add column if not exists regen        int,
  add column if not exists manaregen    int,
  add column if not exists damageshield int;
