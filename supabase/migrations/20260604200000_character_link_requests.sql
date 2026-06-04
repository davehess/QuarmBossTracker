-- When Mimic uploads a UI-layout backup for a character that isn't yet linked
-- to any Discord account, the bot no longer rejects it. Instead it stores the
-- snapshot under the UPLOADER's discord_id (resolved from their per-user
-- session token) with pending_link=true, and files a request here for an
-- officer to add that toon to the uploader's family. On approval the toon is
-- linked and the held snapshot is "merged in" (pending_link cleared).

alter table public.ui_snapshots
  add column if not exists pending_link boolean not null default false;

create table if not exists public.character_link_requests (
  id                     uuid primary key default gen_random_uuid(),
  guild_id               text not null default 'wolfpack',
  character_name         text not null,
  requester_discord_id   text not null,           -- the uploader (session token)
  requester_name         text,                    -- display name for the admin UI
  source                 text not null default 'ui_layout',
  status                 text not null default 'pending',  -- pending | approved | dismissed
  resolved_by_discord_id text,
  resolved_by_name       text,
  resolved_at            timestamptz,
  note                   text,
  created_at             timestamptz not null default now()
);

-- At most one OPEN request per (character, requester) so repeat uploads while
-- pending don't pile up. A new request can be filed again after resolution.
create unique index if not exists character_link_requests_pending_uniq
  on public.character_link_requests (guild_id, lower(character_name), requester_discord_id)
  where status = 'pending';
create index if not exists character_link_requests_status_idx
  on public.character_link_requests (status, created_at desc);

alter table public.character_link_requests enable row level security;
revoke all on public.character_link_requests from anon, authenticated;
grant all  on public.character_link_requests to service_role;
