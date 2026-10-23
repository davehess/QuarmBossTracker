-- encounters.is_wipe — a wipe can now be combined with another mark ("Wipe" + "Non-Guild").
--
-- The guild lead, 2026-10-23, on a parse page: "be able to mark as Wipe AND another thing. This was a
-- non-guild wipe."
--
-- WHY A SECOND COLUMN AND NOT A NEW CLASSIFICATION SHAPE. `classification is null` is the repo's own
-- definition of "a guild kill" and about twenty readers (RPCs, views, web loaders, bot utils) test exactly
-- that. 'wipe' means "did not kill"; live / pvp / test / foreign mean "not our fight". They are two
-- different questions, so wipe becomes a flag that rides ALONGSIDE the one-of classification:
--     guild kill        classification null,      is_wipe false
--     guild wipe        classification 'wipe',    is_wipe true     (unchanged shape, so every reader still works)
--     non-guild wipe    classification 'foreign', is_wipe true     (likewise live / pvp / test)
-- Every existing `classification is null` filter keeps excluding all of these, and the readers that count
-- GUILD wipes (`classification = 'wipe'`) correctly do not count a foreign wipe as ours.
--
-- Two invariants, enforced by one CHECK so no writer (web action, bot, hand SQL) can break them:
--   - classification = 'wipe'  =>  is_wipe        (the old value and the new flag never disagree)
--   - is_wipe  =>  classification is not null      (a flagged wipe is never counted as a guild kill)
-- The bot's auto-classifier (utils/killContext.js) writes only 'pvp' / 'live' and only where classification
-- is null, with is_wipe left at its default, so it satisfies both.
--
-- Cost: ADD COLUMN with a constant default is catalog-only. The backfill touches only the existing 'wipe'
-- rows, and the encounters updated_at trigger bumps those rows, so local-sync clients re-pull them once.
-- Apply off raid nights (CLAUDE.md freeze: Sun/Wed/Thu 19:30-00:30 ET). Nothing applies this automatically.
--
-- Idempotent: IF NOT EXISTS, a guarded constraint, and a backfill that only touches rows not yet set.

alter table encounters
  add column if not exists is_wipe boolean not null default false;

update encounters set is_wipe = true where classification = 'wipe' and not is_wipe;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'encounters_is_wipe_check'
  ) then
    alter table encounters
      add constraint encounters_is_wipe_check
      check ((classification is distinct from 'wipe' or is_wipe) and (not is_wipe or classification is not null));
  end if;
end $$;
