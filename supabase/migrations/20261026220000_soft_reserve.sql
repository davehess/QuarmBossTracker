-- Soft Reserve (SR) per raid (the guild lead, 2026-10-26: loot picks are a Soft Reserve per raid; DECISIONS §448).
--
-- A member picks, for the character they BRING to one Raid-Helper event, the drops they want first claim on.
-- Two tables, both keyed on the event:
--   sr_rules  one row per event, written by an officer: whether SR is on, the caps, who sees what, which bosses
--             it covers, and when picks lock. No row = the defaults below (on, 5 per person, counts visible).
--   sr_picks  one row per (character, boss, item) picked for that event.
--
-- rh_events.id is TEXT (a Raid-Helper / Discord snowflake, no prefix). The bot's own event ids carry an `rh:`
-- prefix (utils/raidEvents.js), so the bot strips it before it reads or writes here.
--
-- lock_mode  start       picks close when the event starts
--            time        picks close at lock_at
--            first_loot  picks close when the bot posts the event's first /loot (it sets locked = true)
--            manual      an officer closes them (locked = true)
-- visibility counts  the pick page shows how many reserved each item; names appear on the loot card at drop time
--            names   the pick page shows who reserved each item
--            hidden  the pick page shows nothing; the loot card shows only a count; officers see names
-- no_reserve open     an item nobody reserved is open to the whole raid (DKP on raid nights, rolls on event nights)
--            officer  an officer decides it (kept for a later change; the bot treats both as open today)
--
-- RLS on with no policies: only the service role (the web actions and the bot) reads or writes.

create table if not exists public.sr_rules (
  event_id    text primary key references public.rh_events(id) on delete cascade,
  enabled     boolean     not null default true,
  per_person  int         not null default 5 check (per_person between 0 and 20),
  per_boss    int                  check (per_boss is null or per_boss between 1 and 10),
  visibility  text        not null default 'counts' check (visibility in ('names', 'counts', 'hidden')),
  npc_ids     int[]       not null default '{}',
  lock_mode   text        not null default 'start' check (lock_mode in ('start', 'time', 'first_loot', 'manual')),
  lock_at     timestamptz,
  locked      boolean     not null default false,
  no_reserve  text        not null default 'open' check (no_reserve in ('open', 'officer')),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists public.sr_picks (
  event_id       text        not null references public.rh_events(id) on delete cascade,
  character_name text        not null,
  npc_id         int         not null,
  item_id        int         not null references public.eqemu_items(id) on delete cascade,
  picked_by      text,
  picked_at      timestamptz not null default now(),
  primary key (event_id, character_name, npc_id, item_id)
);

create index if not exists sr_picks_event_item_idx on public.sr_picks (event_id, item_id);

alter table public.sr_rules enable row level security;
alter table public.sr_picks enable row level security;
