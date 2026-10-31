-- Worn-set history: which gear combinations a character is captured WEARING, and how often.
-- The guild lead, 2026-10-31 (gear variations, option B "from most often captured"): saved gear sets should come from
-- the combinations a character is seen wearing most. Nothing kept that history: character_gear is replaced on every
-- Quarmy upload and character_inventory on every inventory upload, so each upload erased the previous worn set.
--
-- One row per (character, source, set). `slots` is the equipped slots only, {"Head": item_id, ...}, in the gear
-- page's slot vocabulary (Ear1, Wrist2, Fingers1 ...); `set_hash` is the stable hash of exactly that map
-- (utils/wornSets.js). `source` keeps the two feeds apart: the Quarmy export names every worn slot, while the
-- inventory file collapses the paired slots (Ear, Wrist, Fingers) to one, so the same outfit hashes differently from
-- each and must not be merged.
--   times_seen  how often the set has been captured (a new set starts at 1)
--   last_seen   the last upload that showed this set worn
--   counted_at  when times_seen last moved; a set counts at most once an hour so a frequent uploader does not inflate it
--
-- Owner-private: RLS on and NO policy for anon or authenticated. The bot (service role) writes it and the gear page
-- reads it server-side for the character's owner. Keyed by lower(character_name) like character_inventory and
-- character_spellbook. Idempotent: applying it twice is harmless.
--
-- Gear page read (top 3 sets of a character, most often first):
--   select set_hash, slots, times_seen, first_seen, last_seen
--     from character_worn_sets
--    where guild_id = $1 and lower(character_name) = lower($2) and source = 'quarmy'
--    order by times_seen desc, last_seen desc
--    limit 3;

create table if not exists public.character_worn_sets (
  id              bigserial   primary key,
  guild_id        text        not null default 'wolfpack',
  character_name  text        not null,
  source          text        not null check (source in ('quarmy', 'inventory')),
  set_hash        text        not null,
  slots           jsonb       not null,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  counted_at      timestamptz not null default now(),
  times_seen      integer     not null default 1
);

create unique index if not exists character_worn_sets_uniq
  on public.character_worn_sets (guild_id, lower(character_name), source, set_hash);

-- "Top sets of a character by times_seen", and the newest set (the unchanged-upload path counts the newest last_seen).
create index if not exists character_worn_sets_top_idx
  on public.character_worn_sets (guild_id, lower(character_name), source, times_seen desc, last_seen desc);

alter table public.character_worn_sets enable row level security;
grant all on public.character_worn_sets to service_role;
grant usage, select on sequence public.character_worn_sets_id_seq to service_role;
