-- Guild media: long-term storage for pictures and clips of our characters (the guild lead, 2026-09-28:
-- "a gallery available for our players on their character pages, not to hold every picture in the
-- world, but ... longterm storage"). First filled with the Aten Ha Ra film's stills, animation takes,
-- clips and outtakes; the making-of page (/film/making) and the character pages read it.
--
-- guild_media: one row per stored file. character_name ties a row to a character's gallery (NULL for
-- shots that are not one character: class intros, the opening, earlier cuts). collection groups a set
-- (the film is 'aten-ha-ra'); section is the step it came from ('first-still', 'take', 'clip', ...).
-- meta carries the generation record (model, resolution, cost, prompt) and captions.
--
-- The bucket is PRIVATE and neither table nor bucket has policies, so anon and signed-in users can
-- neither list nor read them. The web server reads with the service role and hands out short-lived
-- signed URLs on members-only pages, the same shape as feedback-screenshots.
create table if not exists public.guild_media (
  id             bigint generated always as identity primary key,
  collection     text not null,
  section        text not null,
  character_name text,
  kind           text not null check (kind in ('image', 'video')),
  path           text not null unique,
  thumb_path     text,
  title          text,
  meta           jsonb not null default '{}'::jsonb,
  sort           integer not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists guild_media_character_idx on public.guild_media (lower(character_name));
create index if not exists guild_media_collection_idx on public.guild_media (collection, section, sort);
alter table public.guild_media enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guild-media', 'guild-media', false, 52428800,
        array['image/jpeg', 'image/png', 'video/mp4'])
on conflict (id) do nothing;
