-- The guild's library of clean kite loops (the guild lead, 2026-10-15: "common non-drifting circles and
-- speeds are worth us hanging onto").
--
-- Mimic watches the player's own position, and when it sees a clean, non-drifting circle it uploads ONLY the
-- fitted circle (POST /api/agent/kite-loop): where it is, how big, how long a lap takes, how fast the runner was
-- and how clean it was. The bot keeps the best loop at each spot (a new loop near an existing one with the same
-- turning direction and about the same size is the SAME loop: it bumps `seen` and keeps the cleaner geometry) and
-- serves the best few per zone back to every Map (GET /api/agent/kite-loops).
--
-- PRIVACY: there is deliberately NO uploader, character, discord or session column. The path a player ran is
-- never sent and who ran it is never stored; the bot uses the uploader's identity only for an in-memory rate
-- limit. Keep it that way: a column naming a person here would undo the point. docs/PRIVACY.md says so.
--
-- Bounded: the bot keeps at most 60 loops per zone (lowest quality x oldest goes first), so the table cannot grow
-- with the number of runs. `quality` (0..1) and its formula live in utils/kiteLoops.js.
--
-- RLS on; members read (authenticated), the bot writes (service role bypasses RLS). Idempotent.

create table if not exists public.kite_loops (
    id             bigserial primary key,
    guild_id       text not null,
    zone           text not null,
    cx             real not null,
    cy             real not null,
    cz             real not null,
    r              real not null,
    lap_s          real not null,
    speed_pct      real not null,
    dir            text not null check (dir in ('cw', 'ccw')),
    drift_u        real not null,
    wobble_u       real not null,
    laps           integer not null check (laps >= 3),
    seen           integer not null default 1,
    quality        real not null,
    first_at       timestamptz not null default now(),
    last_at        timestamptz not null default now(),
    agent_version  text
);

create index if not exists kite_loops_guild_zone_idx
    on public.kite_loops (guild_id, zone);

alter table public.kite_loops enable row level security;
drop policy if exists kite_loops_read on public.kite_loops;
create policy kite_loops_read on public.kite_loops for select to authenticated using (true);
revoke all on public.kite_loops from anon;
grant all on public.kite_loops to service_role;
grant usage, select on sequence public.kite_loops_id_seq to service_role;

comment on table public.kite_loops is
    'Fitted kite circles only (zone, centre, radius, lap time, speed, cleanliness) - never a path and never who ran it. Merged per spot, capped per zone. 2026-10-15.';
