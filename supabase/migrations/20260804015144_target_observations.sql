-- Who was targeting what, over time.
--
-- The agent has always uploaded target_name + target_hp_pct (Zeal gauge slot 6)
-- on the live_state stream, and it is EVENT-DRIVEN: a change-signature fires an
-- immediate upload the moment a target switches, plus a 45s heartbeat. But the
-- bot upserts that into character_live_state, whose PK is (guild_id, character)
-- -- so every switch overwrote the last and the history was thrown away. 576
-- rows for the whole guild, forever.
--
-- Healing attribution, off-tank detection, add assignment and buff coverage all
-- need the history, not the latest value (Uilnayar 2026-08-03).
--
-- APPEND-ON-CHANGE: the bot keeps an in-memory last-target map and inserts only
-- when target_name actually differs, so rows are proportional to TARGET SWITCHES
-- rather than to time -- roughly 40 raiders x ~30 switches/hour x 4 hours, call
-- it 5k rows a raid night. Transitions to NULL (target cleared) are recorded too,
-- otherwise an interval never closes and a target looks like it persisted until
-- the next switch.
--
-- Intervals are derived at read time with lead() over (character, at) -- no
-- ended_at column to keep consistent, and no update races between concurrent
-- uploads from different observers.
--
-- LIMITS, by construction: Zeal reports only the LOCAL client's target, so this
-- is assembled from N raiders each reporting their own -- coverage equals whoever
-- is running Mimic. And the pipe carries no spawn id, so two identically-named
-- mobs alive at once are not distinguishable (docs/zeal-spawn-id-request.md).

create table if not exists public.target_observations (
  id            bigserial primary key,
  guild_id      text        not null,
  character     text        not null,
  target_name   text,                  -- NULL = target cleared
  target_hp_pct numeric,
  zone_name     text,
  at            timestamptz not null default now(),
  uploaded_by   text
);

-- "what was this character doing across the night" — the common read.
create index if not exists target_observations_char_at_idx
  on public.target_observations (guild_id, character, at desc);
-- "what happened during this fight window" — the review/scrubber read.
create index if not exists target_observations_at_idx
  on public.target_observations (guild_id, at desc);
-- "who was on this mob" — off-tank + add-assignment review.
create index if not exists target_observations_target_at_idx
  on public.target_observations (guild_id, target_name, at desc);

alter table public.target_observations enable row level security;

-- Guild data: signed-in members read; the bot writes with service_role, which
-- bypasses RLS entirely (same posture as the other Tier 2 tables).
drop policy if exists target_observations_read on public.target_observations;
create policy target_observations_read
  on public.target_observations for select
  to authenticated
  using (true);

comment on table public.target_observations is
  'Append-on-change history of each character''s current target (Zeal gauge slot 6), written at live_state ingest. One row per target SWITCH, not per sample; NULL target_name means the target was cleared. Derive intervals with lead() over (character, at). Coverage is limited to raiders running Mimic, and same-name mobs are not distinguishable (no spawn id on the pipe).';
comment on column public.target_observations.at is
  'When the switch was OBSERVED by the bot, not the client-side gauge timestamp.';
