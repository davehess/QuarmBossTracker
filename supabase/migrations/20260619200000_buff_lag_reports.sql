-- "Buffs feel laggy" reports — clicked from the Mimic buff-queue overlay,
-- /raid, and /buffs. We log the click so we can correlate UX-felt lag
-- against the current throttle settings (BUFF_QUEUE_TTL_MS, target_buffs
-- TTL, the bot's buff_casts query limit). A click also kicks the relevant
-- client into a 60s "snappy mode" (faster polling / lower cache TTL) — that
-- behavior lives in the agent + web client; this table is just the audit
-- trail so we know which knobs need turning.

create table if not exists public.buff_lag_reports (
  id              bigserial primary key,
  reported_at     timestamptz not null default now(),
  guild_id        text not null default 'wolfpack',
  -- 'mimic_overlay' (in-game buff queue), 'web_raid', 'web_buffs'.
  source          text not null,
  -- Set by the bot-side handler from the agent identity (Mimic) or the web
  -- session. Both can be null for a one-off web report from an unsynced user.
  discord_id      text,
  character       text,
  -- Snapshot of the client's current throttle knobs at click time. JSONB so
  -- we can add fields without a migration: { buff_queue_ttl_ms,
  -- target_buffs_ttl_ms, agent_version, web_refresh_ms, ... }.
  client_settings jsonb,
  user_agent      text
);

create index if not exists buff_lag_reports_recent_idx
  on public.buff_lag_reports (reported_at desc);
create index if not exists buff_lag_reports_source_idx
  on public.buff_lag_reports (source, reported_at desc);

alter table public.buff_lag_reports enable row level security;
revoke all on public.buff_lag_reports from anon;
grant select on public.buff_lag_reports to authenticated;
grant all on public.buff_lag_reports to service_role;
