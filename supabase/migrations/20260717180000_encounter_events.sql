-- Per-fight notable events for the callout replay/review (#98 P2).
-- Deaths already live in contributions.raw_parse.deaths (kept). This table adds
-- the raid-wide events + trigger fires + tank switches that the timeline overlays
-- and the callout-coverage analysis needs. Multi-uploader like everything else:
-- each observer inserts its own view; the web dedups at read (same as deaths).
create table if not exists public.encounter_events (
  id                      uuid primary key default gen_random_uuid(),
  guild_id                text not null,
  encounter_id            uuid references public.encounters(id) on delete cascade,
  uploaded_by_discord_id  text,
  at                      timestamptz not null,
  kind                    text not null,   -- 'raid_event' | 'fire' | 'tank_switch'
  subtype                 text,            -- 'enrage'|'death_touch'|'rampage'|'aoe'|'tank_switch' | <trigger name for fires>
  actor                   text,            -- mob / player / tank name
  label                   text,            -- human display string
  meta                    jsonb,
  created_at              timestamptz not null default now()
);

create index if not exists encounter_events_enc_at
  on public.encounter_events (encounter_id, at);

-- Idempotent re-uploads (backfill re-runs): one row per uploader per event.
-- Cross-uploader duplicates (the same enrage seen by everyone) collapse at READ.
create unique index if not exists encounter_events_dedup
  on public.encounter_events
     (guild_id, encounter_id, uploaded_by_discord_id, kind, coalesce(subtype,''), coalesce(actor,''), at);

alter table public.encounter_events enable row level security;
-- Guild data: readable by authenticated members; bot writes via service_role (bypasses RLS).
drop policy if exists encounter_events_read on public.encounter_events;
create policy encounter_events_read on public.encounter_events
  for select to authenticated using (true);
