-- Staged raid-attendance ticks: captured automatically, submitted by nobody.
--
-- Ask (Hitya, 2026-08-06): "can we put in the automatic raid tick capture
-- (without submission) at 830/930/1030/1130". Context from the day before —
-- "sometimes we will take the 'last tick' before the end of the raid, though,
-- so we're not missing people."
--
-- WHY THIS HAS TO BE A CAPTURE AND CANNOT BE A QUERY: raid_roster is a LIVE
-- view, not a history. Its PK is (guild_id, uploaded_by_discord_id, name), so
-- each agent overwrites its own rows every few seconds, and the midnight chain
-- prunes anything older than RAID_ROSTER_RETENTION_HOURS (default ONE HOUR).
-- Who was in the raid at 8:30 is therefore unrecoverable by 9:30. If we do not
-- write it down at the moment it is true, it is gone.
--
-- NOTHING HERE IS SUBMITTED. The submit path exists and works today
-- (utils/dkpTick.js submitRaidTick → OpenDKP), and this deliberately does not
-- call it. These rows are a record for an officer to look at and act on. That
-- separation is also what makes an over-inclusive capture safe (see below).
--
-- The four slots match the tick names OpenDKP already uses, so a captured row
-- lines up with the tick an officer eventually files:
--   20:30 ET  slot 1  "Tick 1 (Raid Start)"
--   21:30 ET  slot 2  "Tick 2 (1 Hour)"
--   22:30 ET  slot 3  "Tick 3 (2 Hour)"
--   23:30 ET  slot 4  "Tick 4 (Raid End)"
--
-- KNOWN LIMITATION, deliberately accepted: `names` is the union across every
-- agent reporting a raid, and the bot does cluster concurrent raids elsewhere
-- (index.js union-find over shared members) but this does not. If a splinter
-- group runs its own raid at the same time, its members land in the same list.
-- Nothing is submitted from these rows, so an officer sees the list before it
-- can ever become DKP — which is the whole reason capture and submission are
-- separate here. `uploaders` is recorded so a suspiciously wide union is
-- visible rather than implied.

create table if not exists public.raid_attendance_ticks (
  id             uuid primary key default gen_random_uuid(),
  guild_id       text not null default 'wolfpack',
  -- utils/raidNight.js nightKey() — rollover-aware, so a 23:30 tick and a
  -- post-midnight one belong to the same night.
  night_key      text not null,
  slot           smallint not null check (slot between 1 and 4),
  description    text not null,
  -- The wall-clock moment this tick is FOR, vs when the capture actually ran.
  -- They differ when the bot was restarting at the top of the window, and the
  -- gap is the honesty column: a capture that ran 4 minutes late says so.
  scheduled_for  timestamptz not null,
  captured_at    timestamptz not null default now(),
  names          text[] not null default '{}',
  name_count     integer not null default 0,
  uploaders      integer not null default 0,
  source         text not null default 'raid_roster',
  -- Explicit and permanent: this row has not been filed with OpenDKP. Kept as a
  -- column rather than implied by absence so a future submit path has somewhere
  -- to record that it acted, and so "captured but never submitted" is queryable.
  submitted_at   timestamptz,
  submitted_by   text
);

-- One tick per (night, slot). This is the idempotency guard AND the restart
-- guard: the capture attempts an insert and lets the constraint refuse a second
-- one, so there is no read-then-write race and no latch to get wrong.
create unique index if not exists raid_attendance_ticks_night_slot_uniq
  on public.raid_attendance_ticks (guild_id, night_key, slot);

create index if not exists raid_attendance_ticks_recent_idx
  on public.raid_attendance_ticks (guild_id, scheduled_for desc);

alter table public.raid_attendance_ticks enable row level security;
revoke all on public.raid_attendance_ticks from anon, authenticated;
grant all  on public.raid_attendance_ticks to service_role;
