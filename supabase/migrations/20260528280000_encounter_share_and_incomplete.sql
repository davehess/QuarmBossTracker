-- data_incomplete: toggle on when an encounter has missing pieces (no necro
-- data, no tank perspective, etc.) and we want to nudge the players who
-- were in the parse to opt-in their local logs. The agent's localhost:7777
-- dashboard polls for these per character and surfaces a "your data could
-- complete this kill" banner.
--
-- (Public sharing flags considered and reverted in the same session — keeping
-- the file scoped to incomplete-tracking only.)

alter table encounters
  add column if not exists data_incomplete        boolean not null default false,
  add column if not exists data_incomplete_reason text,
  add column if not exists data_incomplete_at     timestamptz,
  add column if not exists data_incomplete_by     text;

create index if not exists encounters_data_incomplete_idx
  on encounters (started_at desc)
  where data_incomplete;
