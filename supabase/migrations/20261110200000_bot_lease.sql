-- One row per bot identity: which running bot process may log in to Discord (2026-11-10, DECISIONS §562).
--
-- A deploy runs the old and the new bot side by side for a few seconds, and both used to post and run jobs. The lease
-- makes only its holder log in: the new process waits as a standby until the old one releases at shutdown (or its lease
-- runs out after a crash), then takes over. utils/botLease.js is the caller. Time comes from the database clock only.
--
-- Service-role only, like bot_kv: RLS on with no policies, and the two functions are not executable by anon or
-- authenticated. Idempotent.

create table if not exists public.bot_lease (
  name        text        primary key,
  holder      text        not null,
  expires_at  timestamptz not null,
  acquired_at timestamptz not null default now()
);

alter table public.bot_lease enable row level security;

-- Acquire or renew. True when p_holder holds the lease afterwards; false when another holder's lease has not run out.
create or replace function public.bot_lease_acquire(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_holder text;
begin
  insert into public.bot_lease as l (name, holder, expires_at, acquired_at)
  values (p_name, p_holder, now() + make_interval(secs => greatest(p_ttl_seconds, 5)), now())
  on conflict (name) do update
    set holder      = excluded.holder,
        expires_at  = excluded.expires_at,
        acquired_at = case when l.holder = excluded.holder then l.acquired_at else now() end
    where l.holder = excluded.holder or l.expires_at < now()
  returning l.holder into v_holder;
  return v_holder is not null;
end;
$$;

-- Let go at shutdown so the standby takes over at once instead of waiting out the TTL. Only the holder can release.
create or replace function public.bot_lease_release(p_name text, p_holder text)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.bot_lease set expires_at = '-infinity' where name = p_name and holder = p_holder;
$$;

revoke all on function public.bot_lease_acquire(text, text, integer) from public, anon, authenticated;
revoke all on function public.bot_lease_release(text, text) from public, anon, authenticated;
grant execute on function public.bot_lease_acquire(text, text, integer) to service_role;
grant execute on function public.bot_lease_release(text, text) to service_role;
