-- Dedup contributions when contributor is known: prevents re-running a backfill
-- (chat extraction, --since replay, etc.) from piling up duplicate rows for the
-- same (encounter, source, character). Existing NULL-character rows from older
-- test-thread backfills are left alone via the partial index condition.

create unique index if not exists contributions_dedup
  on contributions (encounter_id, source, contributor_character)
  where contributor_character is not null;
