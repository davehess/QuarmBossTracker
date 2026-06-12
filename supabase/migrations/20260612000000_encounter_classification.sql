-- Officer parse classification — flag encounters that aren't guild instance kills.
--
-- Background: every `encounters` row was implicitly treated as a guild instance
-- kill, but real raid nights produce parse rows that AREN'T kills (engaged the
-- boss but zoned out / camped before the kill message), AREN'T on the guild
-- instance (Live hate, PvP server), or were practice / dummy pulls. Counting
-- them as kills polluted /parses ("2 kills" for one real kill + one wipe), the
-- per-boss stats, and the per-night damage totals.
--
-- One nullable text column on encounters. NULL = guild instance kill (default,
-- doesn't pollute the "kill" axis). Allowed values:
--   - 'wipe'  : engaged the boss but didn't kill (zone-out / camp before death)
--   - 'live'  : fight on Live server — exclude from guild instance stats/timers
--   - 'pvp'   : fight on PvP / Zek — same idea
--   - 'test'  : practice / dummy pull
-- Supporting audit columns mirror `data_incomplete_*` so officer actions leave
-- a clear "who marked this and why" trail.

alter table encounters
  add column if not exists classification        text,
  add column if not exists classification_reason text,
  add column if not exists classification_at     timestamptz,
  add column if not exists classification_by     text;

-- Allowed values guard. Listed explicitly so an unknown string can't sneak in
-- and silently bypass kill filters.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'encounters_classification_check'
  ) then
    alter table encounters
      add constraint encounters_classification_check
      check (classification is null or classification in ('wipe','live','pvp','test'));
  end if;
end $$;

-- Index for the common filter "kills only" (where classification is null).
create index if not exists encounters_classification_idx
  on encounters (classification)
  where classification is not null;
