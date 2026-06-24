-- page_views — lightweight analytics for /admin/analytics (Uilnayar 2026-06-24:
-- "an admin page to see which pages are getting the most use"). Logged from
-- web/middleware.ts on every authenticated page request, fire-and-forget so
-- the request itself is never blocked.
--
-- We store both the raw `path` (so /character/Hitya/quests is queryable) and a
-- normalized `route` template (where /character/[name]/quests groups all
-- character pages). Route normalization happens at insert time in the edge
-- middleware so the table can aggregate cheaply.
--
-- Scope: officer-only consumption (route reports may name characters / users).
-- Never surfaced on public pages. Anonymous visitors are NOT tracked
-- (we only log when auth.uid() is set), which doubles as bot/crawler protection.
create table if not exists page_views (
  id          bigserial primary key,
  user_id     uuid       not null,        -- auth.users.id; never anon
  path        text       not null,        -- raw URL path
  route       text       not null,        -- normalized: /character/[name]/quests
  referrer    text,                       -- best-effort, may be null
  user_agent  text,                       -- truncated to 200 chars in middleware
  viewed_at   timestamptz not null default now()
);

create index if not exists page_views_viewed_at_idx on page_views (viewed_at desc);
create index if not exists page_views_route_idx     on page_views (route);
create index if not exists page_views_user_idx      on page_views (user_id);
create index if not exists page_views_path_idx      on page_views (path);

alter table page_views enable row level security;

-- Authenticated users may INSERT their own page views (middleware uses the
-- user's session). Service role bypasses RLS for the admin page reads.
drop policy if exists page_views_insert_own on page_views;
create policy page_views_insert_own on page_views
  for insert to authenticated
  with check (auth.uid() = user_id);

-- No SELECT policy → only service_role can read (matches encryption-tier rule
-- in CLAUDE.md for officer-only data).

grant insert on page_views to authenticated;
grant usage, select on sequence page_views_id_seq to authenticated;
grant all on page_views to service_role;
