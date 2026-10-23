-- The Masterpiece Gallery (Keepers of the Arts, the guild lead 2026-10-19): a shared library of overlay layouts that
-- anyone can browse and adopt, published by Wolf Pack members through their Mimic session.
--
--   * A layout starts PRIVATE to the guild (visibility 'guild'); its author switches it to 'public'.
--   * Officers feature layouts into the Hall (`featured`), shown first; the default order after that is most used.
--   * No image uploads. A thumbnail is drawn from `thumb` (a compact panel list the bot derives from the spec).
--   * Bylines are author-typed (<= 24 chars, cleaned by the bot) and never auto-filled. "Wolf Pack member" is a
--     badge the SERVER derives from `submitter_kind`, so no byline can fake it.
--   * Room is left for future public submissions: `submitter_kind` ('anon'), status 'pending', `edit_key_hash`.
--     Nothing writes them yet.
--
-- `author_discord_id`, `edit_key_hash`, `hidden_by`, `reviewed_at` and every report/adoption row are PRIVATE: the bot
-- never selects them into a public response. Service role only: RLS on, no policies, and the grants taken away from
-- anon/authenticated (the anon_feedback pattern). Idempotent.

create table if not exists public.gallery_masterpieces (
  id                uuid primary key default gen_random_uuid(),
  guild_id          text not null default 'wolfpack',
  title             text not null check (char_length(title) between 1 and 60),
  blurb             text not null default '' check (char_length(blurb) <= 300),
  classes           text[] not null default '{}',
  min_level         integer not null default 1 check (min_level between 1 and 70),
  -- A layout can suit several modes (the portable format's meta.modes); empty = untagged.
  modes             text[] not null default '{}'
                      check (modes <@ array['raid', 'group', 'pvp', 'charm', 'leveling', 'solo', 'other']),
  byline            text check (byline is null or char_length(byline) <= 24),
  submitter_kind    text not null default 'member' check (submitter_kind in ('member', 'anon')),
  author_discord_id text,
  edit_key_hash     text,
  visibility        text not null default 'guild' check (visibility in ('guild', 'public')),
  status            text not null default 'draft'
                      check (status in ('draft', 'published', 'pending', 'hidden', 'removed')),
  hidden_by         text check (hidden_by is null or hidden_by in ('reports', 'officer')),
  reviewed_at       timestamptz,
  featured          boolean not null default false,
  featured_at       timestamptz,
  adoptions_count   integer not null default 0 check (adoptions_count >= 0),
  latest_version    integer not null default 1,
  thumb             jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A member submission always knows its author; an anonymous one never does.
  check ((submitter_kind = 'member' and author_discord_id is not null) or submitter_kind = 'anon')
);

-- The public list: published + public, the Hall first, then most used.
create index if not exists gallery_masterpieces_public_idx
  on public.gallery_masterpieces (featured desc, adoptions_count desc, created_at desc)
  where status = 'published' and visibility = 'public';
-- The guild list and a member's own layouts.
create index if not exists gallery_masterpieces_guild_idx
  on public.gallery_masterpieces (guild_id, status, visibility, featured desc, adoptions_count desc);
create index if not exists gallery_masterpieces_author_idx
  on public.gallery_masterpieces (author_discord_id);

-- Immutable versions: adopting copies one, so an author's later edit never changes yours silently.
create table if not exists public.gallery_versions (
  masterpiece_id uuid not null references public.gallery_masterpieces (id) on delete cascade,
  version        integer not null check (version >= 1),
  spec           jsonb not null check (octet_length(spec::text) <= 65536),
  needs          jsonb not null default '[]'::jsonb check (octet_length(needs::text) <= 8192),
  created_at     timestamptz not null default now(),
  primary key (masterpiece_id, version)
);

-- One row per adopter per masterpiece. `adopter_key` is 'd:<discord id>' for a signed-in member, or 'i:<salted hash of
-- a random per-install id>' for an anonymous install, so the raw install id is never stored. The primary key IS the
-- dedupe; the trigger below keeps `adoptions_count` honest atomically.
create table if not exists public.gallery_adoptions (
  masterpiece_id uuid not null references public.gallery_masterpieces (id) on delete cascade,
  adopter_key    text not null check (char_length(adopter_key) <= 80),
  version        integer not null default 1,
  adopted_at     timestamptz not null default now(),
  primary key (masterpiece_id, adopter_key)
);

create or replace function public.gallery_adoption_bump() returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  update public.gallery_masterpieces set adoptions_count = adoptions_count + 1 where id = new.masterpiece_id;
  return new;
end
$$;
revoke all on function public.gallery_adoption_bump() from public, anon, authenticated;

-- Created only when missing (as applied 2026-10-23): a `drop trigger` sends the MCP apply to an approval step that stalls.
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'gallery_adoption_bump' and tgrelid = 'public.gallery_adoptions'::regclass) then
    create trigger gallery_adoption_bump after insert on public.gallery_adoptions
      for each row execute function public.gallery_adoption_bump();
  end if;
end $$;

-- Reports use a closed vocabulary (no free text from strangers). `ip_hash` is a salted hash of a public reporter's
-- address, `reporter_discord_id` a signed-in member; one reporter counts once. The bot nulls `ip_hash` on rows older
-- than 30 days (the anon_feedback pattern, longer), so a pruned row keeps counting but names no one.
create table if not exists public.gallery_reports (
  id                  uuid primary key default gen_random_uuid(),
  masterpiece_id      uuid not null references public.gallery_masterpieces (id) on delete cascade,
  reason              text not null check (reason in ('offensive', 'spam', 'broken', 'other')),
  ip_hash             text,
  reporter_discord_id text,
  created_at          timestamptz not null default now()
);
create unique index if not exists gallery_reports_reporter_key
  on public.gallery_reports (masterpiece_id, coalesce(reporter_discord_id, ip_hash));
create index if not exists gallery_reports_recent_idx
  on public.gallery_reports (masterpiece_id, created_at desc);

alter table public.gallery_masterpieces enable row level security;
alter table public.gallery_versions     enable row level security;
alter table public.gallery_adoptions    enable row level security;
alter table public.gallery_reports      enable row level security;
revoke all on public.gallery_masterpieces from anon, authenticated;
revoke all on public.gallery_versions     from anon, authenticated;
revoke all on public.gallery_adoptions    from anon, authenticated;
revoke all on public.gallery_reports      from anon, authenticated;
