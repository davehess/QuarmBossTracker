-- raid_roster + per-member HP%
--
-- Adds hp_pct so the Mimic-running raider in any group can broadcast HP for the
-- other 5 group members (Zeal gauges already carry this — slot != 1/6/16 with
-- a `text` are groupmates). Per-member HP is what powers the HP strip at the
-- bottom of each /raid row. Null when no Mimic-running groupmate is up.
alter table public.raid_roster add column if not exists hp_pct numeric;
comment on column public.raid_roster.hp_pct is 'Group-member HP% as seen by a Mimic-running raider in this person''s group (Zeal gauges). Refreshes on the same cadence as the roster heartbeat. Null when no Mimic-running groupmate is broadcasting.';
