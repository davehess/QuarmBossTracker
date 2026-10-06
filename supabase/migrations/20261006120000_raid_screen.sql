-- 20261006120000_raid_screen.sql
-- Shared state for /screen, the raid screen the raid leader drives (the guild lead picked option B,
-- 2026-10-06): one page the whole raid watches on a second monitor or a phone. An officer switches it
-- between Map, Slides, Loot and Overview, and everyone else's page follows within a few seconds.
--
--   raid_screen_state   one row per guild: which mode the screen is in, which slide is up, and who
--                       last changed it (updated_by is the display name shown as "Driving: ...";
--                       updated_by_id is the signed-in user, kept for the audit question "who did that").
--   raid_screen_slides  the deck the Slides mode shows: a title, a plain-text body (paragraphs and
--                       "- " bullet lines only, no markup), and an optional https image. `position` is
--                       the order; the API keeps it 0..n-1 after every add, delete and move.
--
-- Read and written ONLY by the website's /api/screen/* routes with the service key, after their own
-- sign-in (members read) and officer (officers write) checks. RLS is on and there is deliberately NO
-- policy: a Discord account can get an `authenticated` Supabase session without ever passing the guild
-- check in the sign-in callback, so a read policy for `authenticated` would hand the deck to any Discord
-- user (the same reasoning as zone_map_lines). The grants are revoked from anon and authenticated to say
-- the same thing twice. Small tables: one state row, a few dozen slides. Idempotent.

create table if not exists public.raid_screen_state (
  guild_id      text        primary key,
  mode          text        not null default 'map'
                            check (mode in ('map', 'slides', 'loot', 'overview')),
  slide_index   int         not null default 0 check (slide_index >= 0),
  updated_by    text,
  updated_by_id uuid,
  updated_at    timestamptz not null default now()
);

create table if not exists public.raid_screen_slides (
  id          uuid        primary key default gen_random_uuid(),
  guild_id    text        not null,
  position    int         not null default 0,
  title       text        not null default '',
  body        text        not null default '',
  image_url   text,
  updated_at  timestamptz not null default now()
);

create index if not exists raid_screen_slides_order_idx
  on public.raid_screen_slides (guild_id, position);

alter table public.raid_screen_state  enable row level security;
alter table public.raid_screen_slides enable row level security;

revoke all on public.raid_screen_state  from anon, authenticated;
revoke all on public.raid_screen_slides from anon, authenticated;
grant all on public.raid_screen_state  to service_role;
grant all on public.raid_screen_slides to service_role;
