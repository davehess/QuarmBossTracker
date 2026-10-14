-- How a character's name should SOUND when Mimic speaks it (the guild lead, 2026-10-14).
--
-- "Different voice packs, get player pronunciation right. Let each player suggest how their name should
-- sound phonetically with some coaching and alternate pronunciation available to choose from. This can
-- also exist for each character on their page." Text-to-speech mangles fantasy names, so the owner of a
-- character writes the name the way it should be read ("AL-den-mar"), and the agents swap that spelling
-- into the text before it is spoken.
--
-- One row per (guild, character). `say` is the spelling the voice reads; `alternates` is the list of other
-- respellings the owner has kept to pick from later (a json array of strings). Only the character's owner
-- writes it, through the bot, which checks characters.discord_id first; set_by_discord_id records who did.
--
-- RLS: authenticated members may read (the web page shows it); writes are service-role only, so there is no
-- write policy. The bot uses the service role and bypasses RLS.
create table if not exists public.name_pronunciations (
  guild_id          text        not null,
  character_lc      text        not null,
  display_name      text        not null,
  say               text        not null check (char_length(say) between 1 and 60),
  alternates        jsonb       not null default '[]',
  set_by_discord_id text,
  updated_at        timestamptz not null default now(),
  primary key (guild_id, character_lc)
);

alter table public.name_pronunciations enable row level security;
drop policy if exists name_pronunciations_read on public.name_pronunciations;
create policy name_pronunciations_read on public.name_pronunciations for select to authenticated using (true);

comment on table public.name_pronunciations is
  'Per-character phonetic spelling ("say") that Mimic substitutes into spoken text. Owner-set via the bot; authenticated read, service-role write. Guild lead 2026-10-14.';
