-- agent_upload_stats — replace the row-per-upload `agent_uploads` audit log with
-- a per-(character, endpoint) COUNTER. The old log grew ~30k rows/day (~10MB/day)
-- — every encounter/chat/threat upload from ~40 chars wrote a row — and was the
-- fastest path to the Supabase free-tier cap. The /me sync banner and the
-- /admin/agents fleet board only ever read recent/aggregate signals, so a few
-- hundred counter rows that never grow give the same value: total uploads,
-- last-seen, version, error count + last error, latest agent_state. Trade-off:
-- no per-window (24h/7d) activity — totals are all-time, activity = last-seen.
--
-- Applied live via the Supabase MCP during development (incl. seeding the
-- counter from the existing agent_uploads rows, then dropping that table). This
-- file is the version-controlled record; idempotent so re-applying is a no-op.
--
-- RLS: enabled with no policies; bot writes via the SECURITY DEFINER RPC (which
-- bypasses RLS), web reads via the service role.

create table if not exists public.agent_upload_stats (
  guild_id          text not null default 'wolfpack',
  character         text not null default '(unknown)',
  endpoint          text not null,
  upload_count      bigint not null default 0,
  error_count       bigint not null default 0,
  first_uploaded_at timestamptz not null default now(),
  last_uploaded_at  timestamptz not null default now(),
  agent_version     text,
  last_ok           boolean,
  last_status_code  integer,
  last_error        text,
  last_agent_state  jsonb,
  primary key (guild_id, character, endpoint)
);

alter table public.agent_upload_stats enable row level security;

-- Upsert + increment in one call. Bot calls this on every agent upload.
create or replace function public.bump_agent_upload_stat(
  p_guild text, p_character text, p_endpoint text, p_version text,
  p_ok boolean, p_status integer, p_error text, p_agent_state jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.agent_upload_stats as s
    (guild_id, character, endpoint, upload_count, error_count,
     first_uploaded_at, last_uploaded_at, agent_version, last_ok, last_status_code, last_error, last_agent_state)
  values
    (coalesce(p_guild,'wolfpack'), coalesce(nullif(p_character,''),'(unknown)'), p_endpoint,
     1, case when p_ok then 0 else 1 end, now(), now(), p_version, p_ok, p_status, p_error, p_agent_state)
  on conflict (guild_id, character, endpoint) do update set
    upload_count     = s.upload_count + 1,
    error_count      = s.error_count + case when p_ok then 0 else 1 end,
    last_uploaded_at = now(),
    agent_version    = coalesce(p_version, s.agent_version),
    last_ok          = p_ok,
    last_status_code = p_status,
    last_error       = case when p_ok then s.last_error else p_error end,
    last_agent_state = coalesce(p_agent_state, s.last_agent_state);
$$;

-- The row-per-upload firehose is retired.
drop table if exists public.agent_uploads;
