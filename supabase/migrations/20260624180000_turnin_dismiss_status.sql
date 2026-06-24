-- Let players mark discovered turn-ins as "not of interest" so they drop out of
-- the discovery list (Uilnayar 2026-06-24). Reuse the per-character pin table
-- with a status: 'active' (pinned to Active quests) or 'dismissed' (hidden from
-- discovery, restorable). A missing row = neutral (shown in discovery).
alter table character_active_turnins
  add column if not exists status text not null default 'active';
alter table character_active_turnins
  drop constraint if exists character_active_turnins_status_chk;
alter table character_active_turnins
  add constraint character_active_turnins_status_chk
  check (status in ('active', 'dismissed'));
