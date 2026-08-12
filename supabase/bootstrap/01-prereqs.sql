-- Bootstrap 1/2 — what a hosted Supabase project already provides.
--
-- Applied ONLY when standing up a fresh database (self-host, or a scratch DB to
-- test the migrations against). A hosted Supabase project has all of this on day
-- one, which is why no migration in this repo creates it — and why the migrations
-- cannot rebuild the schema on their own.
--
-- Everything here is idempotent and safe to re-run.

-- The three PostgREST roles every RLS policy in this repo references.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin noinherit bypassrls; end if;
end $$;

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- Realtime's publication. One migration (tell_notifications) adds a table to it
-- and hard-fails if it is absent.
do $$ begin
  if not exists (select 1 from pg_publication where pubname='supabase_realtime') then
    create publication supabase_realtime; end if;
end $$;

-- GoTrue owns auth.users. On a real self-hosted stack GoTrue creates it before
-- you get here; this stub only matters for a bare-Postgres schema test, and the
-- IF NOT EXISTS means it never overwrites the real one.
create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- RLS policies across this repo call auth.uid() / auth.role(); four migrations
-- hard-fail without them. GoTrue installs the real versions (they read the
-- request JWT); these stubs exist only so a bare-Postgres schema test can run,
-- and CREATE OR REPLACE is skipped entirely when the real ones are present.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='auth' and p.proname='uid') then
    execute $f$ create function auth.uid() returns uuid language sql stable
                as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid' $f$;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                 where n.nspname='auth' and p.proname='role') then
    execute $f$ create function auth.role() returns text language sql stable
                as 'select coalesce(nullif(current_setting(''request.jwt.claim.role'', true), ''''), ''anon'')' $f$;
  end if;
end $$;
