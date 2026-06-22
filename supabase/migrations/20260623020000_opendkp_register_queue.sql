-- Supabase-backed OpenDKP register queue.
--
-- Replaces the brittle web→bot HTTP call (which required WOLFPACK_AGENT_TOKEN
-- + BOT_BASE_URL to BOTH be set on Vercel — two repeated foot-guns). The web
-- /admin/links Register button now INSERTs a row here using its existing
-- Supabase service-role access (no extra env var), and the bot drains the
-- queue every ~20s: createCharacter in OpenDKP, stamp the characters audit
-- marker, and (optionally) DM the owner a claim link. Status flows
-- pending → done | failed.
create table if not exists opendkp_register_requests (
  id                       uuid primary key default gen_random_uuid(),
  guild_id                 text        not null default 'wolfpack',
  name                     text        not null,
  class                    text        not null,
  race                     text        not null,
  level                    integer     not null,
  rank                     text        not null,
  parent_opendkp_id        integer,                 -- family root to parent under (0/null = root)
  parent_name              text,                    -- display + DM ("alt of Canopy")
  requested_by_discord_id  text,                    -- officer who clicked Register
  uploader_discord_id      text,                    -- character owner (claim-DM target)
  dm_owner                 boolean     not null default true,
  status                   text        not null default 'pending', -- pending | done | failed
  opendkp_id               integer,                 -- created CharacterId (result)
  error                    text,                    -- last failure detail
  created_at               timestamptz not null default now(),
  processed_at             timestamptz
);

-- Double-click / double-submit guard: at most one PENDING request per
-- character name. Re-registering after a failure is fine (failed rows don't
-- block) and a fresh pending insert after the prior one is done is fine too.
create unique index if not exists opendkp_register_requests_pending_uniq
  on opendkp_register_requests (guild_id, lower(name))
  where status = 'pending';

create index if not exists opendkp_register_requests_status_idx
  on opendkp_register_requests (status, created_at);

-- Officer-internal table. Web reads/writes via service-role (supabaseAdmin),
-- bot reads/writes via service-role — both bypass RLS. Enabling RLS with no
-- policy means anon/authenticated can't touch it, which is exactly right.
alter table opendkp_register_requests enable row level security;
grant all on opendkp_register_requests to service_role;
