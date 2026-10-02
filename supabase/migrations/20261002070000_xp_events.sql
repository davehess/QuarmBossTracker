-- XP gained, one row per experience line, with who you were grouped with, where, and what you killed.
--
-- FB-37 (a member) and the guild lead, 2026-10-02: "observe group composition and xp totals for groups
-- that are together during the day and find what compositions work and in what area in what zone, with
-- what mobs we're killing" — and "also track when we have an XP potion on". docs/DESIGN-xp-tracking.md
-- option B. Nothing about XP reached the server before this.
--
-- RAW, on purpose: EQ prints no amount ("You gain party experience!!"), so the agent records the XP and
-- AA bars just before and just after the line (Zeal labels 26/27, the banked AA count) and the level,
-- and the total is computed at read time from the TAKP experience table and the character's race. Two
-- things on that table are still to be checked against Quarm (the level band and AA-per-point), so the
-- stored value must not bake either in.
--
-- Volume: one row per kill that gives XP, a few thousand a day for the fleet. Kept 30 days
-- (XP_EVENTS_RETENTION_DAYS; the nightly sweep), long enough for a week's board and a month's trend.
create table if not exists public.xp_events (
  id               bigserial primary key,
  guild_id         text        not null,
  character        text        not null,
  at               timestamptz not null,
  kind             text        not null check (kind in ('solo','party','raid')),
  level            int,
  level_after      int,
  xp_before        numeric,     -- percent into the level, as Zeal shows it
  xp_after         numeric,
  aa_before        numeric,     -- percent into the next AA point
  aa_after         numeric,
  aa_banked_before int,
  aa_banked_after  int,
  zone_id          int,
  zone_name        text,
  loc_x            real,
  loc_y            real,
  loc_z            real,
  mob              text,        -- the kill this XP was for, when the kill line came with it
  group_members    jsonb,       -- [{name, class, level}] from Zeal's group window at that moment
  potion           boolean not null default false,   -- Maelin's Magical Concoction (spell 3999) up
  race             text,
  class            text,
  uploaded_by      text,
  agent_version    text,
  unique (guild_id, character, at, kind)
);

create index if not exists xp_events_at_idx on public.xp_events (guild_id, at desc);
create index if not exists xp_events_zone_at_idx on public.xp_events (guild_id, zone_name, at desc);

alter table public.xp_events enable row level security;
drop policy if exists xp_events_read on public.xp_events;
create policy xp_events_read on public.xp_events for select to authenticated using (true);

comment on table public.xp_events is
  'One row per experience line (solo/party/raid) with the XP and AA bars before and after, zone, loc, group, the mob and whether an XP potion was up. FB-37 option B; DECISIONS-2026-09-21 §127.';
