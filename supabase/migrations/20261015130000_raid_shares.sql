-- 20261015130000_raid_shares.sql
-- Public share links for ONE recorded raid session (the guild lead, 2026-10-15: "the morning raid yesterday would
-- be ideal to send to the other guild's leadership for them to review, with rolls, attendance, etc with a public
-- sharing link that doesn't require discord permissions").
--
-- A share is a time window [from_at, to_at) of the guild's recording plus a secret. The page at
-- /share/raid/<token> needs no sign-in: it hashes the token, finds the row here, and then reads the replay, the
-- attendance, the kills, the loot and the rolls with the service key, every query bounded to the window stored on
-- THIS row. The window is never taken from the URL.
--
-- The token is 32 random bytes (base64url, 43 characters), shown to the officer once, when the link is made.
-- Only its SHA-256 is stored, so a database reader cannot rebuild a working link from this table. 256 random bits
-- need no slow hash.
--
-- Expiry and revocation are checked on every request, so a revoke takes effect on the next page load (the
-- browser may keep a response it already has for the short max-age the routes send).
--
-- Access: service_role only. RLS is on with no policy, so neither anon nor authenticated can read or write it;
-- the officer routes check the officer role first and then use the service key. Idempotent.

create table if not exists public.raid_shares (
  id          uuid        primary key default gen_random_uuid(),
  token_hash  text        not null unique,                    -- hex SHA-256 of the token; never the token
  guild_id    text        not null,
  from_at     timestamptz not null,                           -- window start, inclusive
  to_at       timestamptz not null,                           -- window end, exclusive
  title       text        not null default '',
  created_by  uuid,                                           -- wolfpack_members.user_id of the officer
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '30 days'),
  revoked_at  timestamptz,
  view_count  integer     not null default 0,
  constraint raid_shares_window_ok check (to_at > from_at and to_at - from_at <= interval '24 hours')
);

-- The officer list asks "which shares cover this window", newest first.
create index if not exists raid_shares_guild_window_idx on public.raid_shares (guild_id, from_at, to_at);

alter table public.raid_shares enable row level security;
revoke all on public.raid_shares from anon, authenticated;
grant all on public.raid_shares to service_role;
