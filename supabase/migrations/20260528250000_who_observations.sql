-- who_observations — every /who line the agent reports, persisted for SQL queries
-- and the future "character path tracking" roadmap. Mirrors the in-memory
-- state.whoData but never drops, never compresses, and is queryable from the
-- web app.
--
-- The agent re-uploads its full whoData map on every encounter; the per-minute
-- dedup index collapses repeat observations of the same character within the
-- same minute from the same uploader to one row, keeping growth tractable.

create table if not exists who_observations (
  id           bigserial primary key,
  guild_id     text not null default 'wolfpack',
  character    text not null,
  level        int,
  race         text,
  class        text,
  guild_name   text,
  anonymous    boolean default false,
  gm           boolean default false,
  observed_at  timestamptz not null,
  -- Generated column for the dedup index. (date_trunc on a timestamptz isn't
  -- immutable, so we anchor to UTC first which makes the expression immutable
  -- and indexable.)
  observed_minute timestamp generated always as
    (date_trunc('minute', observed_at at time zone 'UTC')) stored,
  uploaded_by  text not null default '',
  created_at   timestamptz default now()
);

create index if not exists who_obs_character_idx
  on who_observations (lower(character), observed_at desc);
create index if not exists who_obs_observed_idx
  on who_observations (observed_at desc);
create index if not exists who_obs_guild_idx
  on who_observations (guild_name)
  where guild_name is not null;

-- Dedup: same character observed within the same minute by the same uploader
-- is one row. Uses plain column refs (not lower() or coalesce()) so PostgREST's
-- on_conflict resolves to this index. EQ /who returns canonical character
-- names so case-sensitivity isn't a real concern here.
create unique index if not exists who_obs_dedup
  on who_observations (guild_id, character, observed_minute, uploaded_by);

-- RLS: authenticated guild members can read; only service_role writes.
alter table who_observations enable row level security;

drop policy if exists who_obs_read on who_observations;
create policy who_obs_read on who_observations
  for select to authenticated using (true);

grant select on who_observations to authenticated;
grant all    on who_observations to service_role;
grant usage, select on sequence who_observations_id_seq to service_role;
