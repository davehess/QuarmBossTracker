-- Flag events: the guild's board of "we are going to kill/do X on this night" (the guild lead, 2026-11-02, option A of
-- the flag-event board, "Post an event, see who needs it"). An officer posts an event from /pop/flag-events; the page
-- reads it back with the characters that still need it (web/lib/flagEventNeeds.ts) and, when the event links a
-- Raid-Helper event, who signed up.
--
-- target_key is a key of web/lib/flagTargets.ts. It is NOT a foreign key: the catalog is code, validated in the server
-- action (web/app/pop/flag-events/actions.ts), and a key that leaves the catalog later must not break old rows.
-- rh_event_id is rh_events.id (text, the Raid-Helper event id). If that event is ever pruned the link is dropped and
-- the event stays.
--
-- Written and read ONLY through the service role: RLS is ON with NO policies and anon/authenticated hold no grants
-- (the terms_acceptances / hub_* pattern). Every query carries guild_id.

create table if not exists public.flag_events (
  id                   bigint generated always as identity primary key,
  guild_id             text        not null,
  target_key           text        not null,
  starts_at            timestamptz not null,
  note                 text        check (note is null or char_length(note) <= 200),
  rh_event_id          text        references public.rh_events (id) on delete set null,
  posted_by_discord_id text        not null,
  created_at           timestamptz not null default now()
);

create index if not exists flag_events_guild_starts_idx on public.flag_events (guild_id, starts_at);

alter table public.flag_events enable row level security;

revoke all on public.flag_events from anon, authenticated;

comment on table public.flag_events is
  'Flag events an officer posted (web/app/pop/flag-events). Service role only: RLS on, no policies.';
