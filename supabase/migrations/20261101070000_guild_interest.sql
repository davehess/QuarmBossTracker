-- Guild interest: the "Register your guild" form on raidmimic.com/register (the guild lead, 2026-11-01, option B: "a
-- proper interest form, no sign-in"). A sales lead list, NOT guild data: it belongs to no guild, so it carries no
-- guild_id (the same stance as anon_feedback, 20261028170000_guild_id_on_untagged_tables.sql) and is not listed in
-- scripts/guild-tables.json.
--
-- Everything stored here has ALREADY been through web/lib/guildInterest.ts, which runs the free-text fields through the
-- anonymous-feedback cleaner (links, emails, IPs, keys, user-name paths, HTML and SQL-shaped text come out) and matches
-- the closed fields against fixed lists. It is still text from strangers: officers read it on /admin/interest as plain
-- text, and nothing acts on it automatically. `ip_hash` is a salted hash kept only so the form can rate-limit (3 an
-- hour); the form erases it after a day and it is never shown to officers.
--
-- Service role only: RLS on, no policies, and the table grants are taken away from anon/authenticated. Idempotent.

create table if not exists public.guild_interest (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  guild_name      text not null check (char_length(guild_name) <= 60),
  game            text check (game in ('quarm', 'eq-live', 'other')),
  server          text check (char_length(server) <= 40),
  raiders         integer check (raiders between 1 and 200),
  nights          text[] not null default '{}',
  dkp             text check (dkp in ('opendkp', 'eqdkp', 'other', 'none')),
  heard           text check (char_length(heard) <= 200),
  discord_contact text,
  ip_hash         text,
  status          text not null default 'new' check (status in ('new', 'read', 'done'))
);

create index if not exists guild_interest_created_idx on public.guild_interest (created_at desc);
-- The rate limit counts one hash's rows in the last hour.
create index if not exists guild_interest_ip_recent_idx on public.guild_interest (ip_hash, created_at desc);

alter table public.guild_interest enable row level security;
revoke all on public.guild_interest from anon, authenticated;
