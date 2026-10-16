-- Batched upload counters (the guild lead, 2026-10-15: "log ingestion is WAY over").
--
-- bump_agent_upload_stat ran once per agent upload: 164,302 calls in the 24 h to
-- 2026-10-16 04:00 UTC, every one a logged API-gateway request, at 2 GB/day of log
-- ingestion against 20 GB/month included. The bot now sums the counts in memory and
-- sends ONE call per minute carrying a row per (guild, character, endpoint). Each row
-- adds its counts to the counter; the other columns keep the old single-call rules.
--
-- The bot normalises the key exactly as below (empty character -> '(unknown)'), so a
-- batch never holds two rows for one key: ON CONFLICT cannot touch a row twice.
-- SECURITY DEFINER, so EXECUTE is revoked from the public keys in this same file
-- (20260925021113 is why). Idempotent.

create or replace function public.bump_agent_upload_stats(p_rows jsonb)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.agent_upload_stats as s
    (guild_id, character, endpoint, upload_count, error_count,
     first_uploaded_at, last_uploaded_at, agent_version, last_ok, last_status_code,
     last_error, last_agent_state, uploaded_by_discord_id, zeal_version, spawn_id_seen_at)
  select
    coalesce(r->>'guild', 'wolfpack'),
    coalesce(nullif(r->>'character', ''), '(unknown)'),
    r->>'endpoint',
    greatest(coalesce((r->>'uploads')::int, 1), 1),
    greatest(coalesce((r->>'errors')::int, 0), 0),
    coalesce((r->>'first_at')::timestamptz, now()),
    coalesce((r->>'last_at')::timestamptz, now()),
    r->>'version',
    coalesce((r->>'ok')::boolean, true),
    (r->>'status')::int,
    r->>'error',
    r->'agent_state',
    r->>'uploaded_by',
    r->>'zeal_version',
    case when coalesce((r->>'spawn_id_seen')::boolean, false)
         then coalesce((r->>'last_at')::timestamptz, now()) end
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
  where r->>'endpoint' is not null
  on conflict (guild_id, character, endpoint) do update set
    upload_count           = s.upload_count + excluded.upload_count,
    error_count            = s.error_count + excluded.error_count,
    last_uploaded_at       = greatest(s.last_uploaded_at, excluded.last_uploaded_at),
    agent_version          = coalesce(excluded.agent_version, s.agent_version),
    last_ok                = excluded.last_ok,
    last_status_code       = excluded.last_status_code,
    last_error             = coalesce(excluded.last_error, s.last_error),
    last_agent_state       = coalesce(excluded.last_agent_state, s.last_agent_state),
    uploaded_by_discord_id = coalesce(excluded.uploaded_by_discord_id, s.uploaded_by_discord_id),
    zeal_version           = coalesce(excluded.zeal_version, s.zeal_version),
    spawn_id_seen_at       = greatest(s.spawn_id_seen_at, excluded.spawn_id_seen_at);
$$;

revoke execute on function public.bump_agent_upload_stats(jsonb) from public, anon, authenticated;
grant execute on function public.bump_agent_upload_stats(jsonb) to service_role;
