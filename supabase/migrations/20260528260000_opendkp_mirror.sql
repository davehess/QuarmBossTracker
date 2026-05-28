-- OpenDKP mirror tables: raids, attendance ticks, loot history.
-- Source of truth stays in OpenDKP; we mirror so the web app can query without
-- a Cognito round-trip and so the data is joinable with encounters/contributions.

create table if not exists opendkp_raids (
  raid_id      bigint primary key,
  name         text not null,
  ts           timestamptz not null,
  pool_id      int,
  pool_name    text,
  attendance   int,
  version      int,
  fetched_at   timestamptz not null default now()
);

create index if not exists opendkp_raids_ts_idx on opendkp_raids (ts desc);

create table if not exists opendkp_ticks (
  tick_id      bigint primary key,
  raid_id      bigint not null references opendkp_raids(raid_id) on delete cascade,
  description  text,
  value        int,
  attendees    text[] not null default array[]::text[],
  fetched_at   timestamptz not null default now()
);

create index if not exists opendkp_ticks_raid_idx on opendkp_ticks (raid_id);
create index if not exists opendkp_ticks_attendees_gin on opendkp_ticks using gin (attendees);

create table if not exists opendkp_loot (
  id            bigserial primary key,
  raid_id       bigint not null references opendkp_raids(raid_id) on delete cascade,
  item_id       int,
  game_item_id  int,
  item_name     text not null,
  character_name text not null,
  dkp           int not null default 0,
  notes         text,
  fetched_at    timestamptz not null default now()
);

-- Dedup: same raid + item + winner is one row. (raid + item alone is too tight —
-- the same item can drop multiple times in one raid and go to different winners.)
create unique index if not exists opendkp_loot_dedup
  on opendkp_loot (raid_id, coalesce(game_item_id, item_id, 0), character_name, dkp);
create index if not exists opendkp_loot_character_idx on opendkp_loot (character_name);
create index if not exists opendkp_loot_raid_idx on opendkp_loot (raid_id);

-- Views the web app + bot will consume

-- Per-character raid attendance count over the last N days. Used by /juicylogs
-- to rank candidates for agent-log backfill requests.
create or replace view opendkp_attendance_recent as
select
  attendee                              as character_name,
  count(distinct r.raid_id)             as raids_attended,
  count(distinct r.raid_id) filter (where r.ts > now() - interval '30 days') as last_30d,
  count(distinct r.raid_id) filter (where r.ts > now() - interval '90 days') as last_90d,
  min(r.ts)                             as first_attended,
  max(r.ts)                             as last_attended
from opendkp_ticks t
cross join lateral unnest(t.attendees) as attendee
join opendkp_raids r on r.raid_id = t.raid_id
group by attendee;

-- Loot per raid night: items + winners + costs, ordered by date desc then dkp desc
-- so the web app can show the big-ticket pickups at the top of each night.
create or replace view opendkp_loot_recent as
select
  r.ts::date           as raid_date,
  r.raid_id,
  r.name               as raid_name,
  l.item_name,
  l.character_name,
  l.dkp,
  l.notes,
  l.game_item_id,
  l.item_id
from opendkp_loot l
join opendkp_raids r on r.raid_id = l.raid_id;

-- RLS — authenticated guild members can read all OpenDKP mirror data.
alter table opendkp_raids enable row level security;
alter table opendkp_ticks enable row level security;
alter table opendkp_loot  enable row level security;

drop policy if exists opendkp_raids_read on opendkp_raids;
create policy opendkp_raids_read on opendkp_raids for select to authenticated using (true);
drop policy if exists opendkp_ticks_read on opendkp_ticks;
create policy opendkp_ticks_read on opendkp_ticks for select to authenticated using (true);
drop policy if exists opendkp_loot_read on opendkp_loot;
create policy opendkp_loot_read on opendkp_loot for select to authenticated using (true);

-- Also expose to anon for the public /parses page on wolfpack.quest.
drop policy if exists opendkp_raids_anon_read on opendkp_raids;
create policy opendkp_raids_anon_read on opendkp_raids for select to anon using (true);
drop policy if exists opendkp_ticks_anon_read on opendkp_ticks;
create policy opendkp_ticks_anon_read on opendkp_ticks for select to anon using (true);
drop policy if exists opendkp_loot_anon_read on opendkp_loot;
create policy opendkp_loot_anon_read on opendkp_loot for select to anon using (true);

grant select on opendkp_raids, opendkp_ticks, opendkp_loot to authenticated, anon;
grant all    on opendkp_raids, opendkp_ticks, opendkp_loot to service_role;
grant usage, select on sequence opendkp_loot_id_seq to service_role;
grant select on opendkp_attendance_recent, opendkp_loot_recent to authenticated, anon;
