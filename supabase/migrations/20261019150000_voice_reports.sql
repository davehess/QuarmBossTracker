-- Voice reports (the guild lead, 2026-10-19: "B for voice"): a raider hears Mimic mispronounce a callout, taps report,
-- and the line lands here for an officer to review on /admin/voice-reports. Slice 1 of the voice work: capture, review
-- and replay. The phrase-respelling table and its approval come later and are NOT in this file.
--
--   * `spoken` is the text the voice was handed; `suggested_say` is the raider's respelling, if they gave one.
--   * The reporter's Discord id is written by the bot from the Mimic session, never from the request body.
--   * The reports are PRIVATE to officers: service role only. RLS on, no policies, and the grants taken away from
--     anon/authenticated (the anon_feedback / gallery pattern).
--
-- Idempotent.

create table if not exists public.voice_reports (
  id                  uuid primary key default gen_random_uuid(),
  guild_id            text not null default 'wolfpack',
  reporter_discord_id text not null,
  character           text check (character is null or char_length(character) <= 40),
  spoken              text not null check (char_length(spoken) between 1 and 300),
  original            text check (original is null or char_length(original) <= 300),
  engine              text check (engine is null or char_length(engine) <= 20),
  voice               text check (voice is null or char_length(voice) <= 80),
  rate                numeric check (rate is null or (rate >= 0.1 and rate <= 5)),
  pitch               numeric check (pitch is null or (pitch >= 0 and pitch <= 2)),
  agent_version       text check (agent_version is null or char_length(agent_version) <= 20),
  trigger_id          text check (trigger_id is null or char_length(trigger_id) <= 80),
  trigger_name        text check (trigger_name is null or char_length(trigger_name) <= 120),
  suggested_say       text check (suggested_say is null or char_length(suggested_say) <= 300),
  note                text check (note is null or char_length(note) <= 280),
  status              text not null default 'open' check (status in ('open', 'fixed', 'dismissed')),
  created_at          timestamptz not null default now(),
  reviewed_by         text,
  reviewed_at         timestamptz
);

-- The review page: one guild's reports by state, newest first.
create index if not exists voice_reports_guild_status_idx
  on public.voice_reports (guild_id, status, created_at desc);

alter table public.voice_reports enable row level security;
revoke all on public.voice_reports from anon, authenticated;
