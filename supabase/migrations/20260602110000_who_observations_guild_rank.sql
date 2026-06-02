-- who_observations.guild_rank — EQ IN-GAME guild permission tier captured from
-- /guildstatus (Member / Officer / Leader).
--
-- This is the EverQuest ENGINE's own guild hierarchy that governs in-game
-- actions — Officers can invite players to the guild + do cross-zone raid
-- invites; only the Leader can promote to Officer. /who hides guild + rank for
-- /anon players, but /guildstatus <name> reveals both, so this fills a gap /who
-- can't.
--
-- IMPORTANT: this is NOT a Wolf Pack operational rank. Do NOT conflate it with
-- characters.rank (OpenDKP: Raid Pack / Raid Alt / Officer / Pack Leader / ...)
-- or wolfpack_roles (Discord). Those describe how the guild organizes itself;
-- guild_rank describes in-game EQ permissions, for our members AND others.

alter table public.who_observations
  add column if not exists guild_rank text;

comment on column public.who_observations.guild_rank is
  'EQ IN-GAME guild permission tier from /guildstatus: Member / Officer / Leader. The EverQuest engine''s own guild hierarchy governing in-game actions (Officers can invite to the guild + do cross-zone raid invites; only the Leader can promote to Officer). NOT a Wolf Pack operational rank — do NOT conflate with characters.rank (OpenDKP) or wolfpack_roles (Discord). Survives /anon, which hides guild+rank on /who.';
