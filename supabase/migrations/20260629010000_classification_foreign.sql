-- Add 'foreign' to the encounter classification set — a kill that's primarily
-- NOT Wolf Pack members (a guildie pugging another guild's raid, whose agent
-- uploaded the fight so it landed on our parses). Like the other non-null
-- classifications it's excluded from guild kill counts + hidden on /parses.
--
-- Uilnayar 2026-06-29: "Ikibob attended a morning Kael raid with a different
-- guild and it all showed up on Wolfpack quest … if the majority of members of
-- a raid are not Wolfpack members we should flag that, not display on parses."
--
-- CHECK constraints can't be altered in place — drop + recreate with the new
-- value included.
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'encounters_classification_check'
  ) then
    alter table encounters drop constraint encounters_classification_check;
  end if;
  alter table encounters
    add constraint encounters_classification_check
    check (classification is null or classification in ('wipe','live','pvp','test','foreign'));
end $$;
