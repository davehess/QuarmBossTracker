-- Crash reports: keep the fields that answer "what was I doing?" (2026-08-12).
--
-- Zeal's crash_reason.txt already writes these; the agent was parsing five of
-- them and discarding the rest. They are the difference between "0x6ef in
-- kernelbase.dll" — which no raider can act on — and "crashed while zoning,
-- with no player entity loaded", which they can.
--
--   exception_string  human-readable form ("EXCEPTION_ACCESS_VIOLATION")
--   game_state        ff = no world loaded (zoning/shutdown), 1 = char select
--   self_ptr          player entity pointer; 0x0 means it is gone
--   spawn_info        spawn table pointer; 0x0 alongside self_ptr = mid-zone
--   handler_stage     which Zeal handler caught it: Initial Handler | VEH |
--                     Multiple Crashes. All three are fatal (every report opens
--                     "Unhandled exception occurred"), but they differ in how
--                     much context survived — 'Multiple Crashes' is the handler
--                     re-entering and carries nothing but code and module.
alter table public.crash_reports add column if not exists exception_string text;
alter table public.crash_reports add column if not exists game_state       text;
alter table public.crash_reports add column if not exists self_ptr         text;
alter table public.crash_reports add column if not exists spawn_info       text;
alter table public.crash_reports add column if not exists handler_stage    text;

-- Backfill from raw_reason, which we kept in full — so existing reports gain the
-- same fields rather than starting a two-era table.
--
-- ⚠ Two traps, both hit for real on 2026-08-12:
--   (?n) is REQUIRED. Postgres POSIX `.` matches a newline by default, so a
--        pattern without it captures the whole remainder of the report. The
--        first cut of this file omitted it on handler_stage only, and every one
--        of the 393 rows stored the entire text in that column.
--   btrim(x, E' \t\r\n') — SQL trim() strips spaces and nothing else, so the
--        CRLF these files use leaves a trailing \r on every captured value.
-- The WHERE clauses re-run over any row whose value is still null OR still
-- carries whitespace, which makes re-applying this file repair bad data instead
-- of skipping it.
update public.crash_reports set
  exception_string = nullif(btrim((regexp_match(raw_reason,
    '(?n)^[^\S\r\n]*Exception String:[^\S\r\n]*(.*)$'))[1], E' \t\r\n'), ''),
  game_state = nullif(btrim((regexp_match(raw_reason,
    '(?n)^[^\S\r\n]*Game state:[^\S\r\n]*(\S*)'))[1], E' \t\r\n'), ''),
  self_ptr = nullif(btrim((regexp_match(raw_reason,
    '(?n)^[^\S\r\n]*Self:[^\S\r\n]*(\S*)'))[1], E' \t\r\n'), ''),
  spawn_info = nullif(btrim((regexp_match(raw_reason,
    '(?n)^[^\S\r\n]*SpawnInfo:[^\S\r\n]*(\S*)'))[1], E' \t\r\n'), ''),
  handler_stage = nullif(btrim((regexp_match(raw_reason,
    '(?n)Unhandled exception occurred:[^\S\r\n]*(.*)$'))[1], E' \t\r\n'), '')
where raw_reason is not null
  and (exception_string is null or game_state is null or self_ptr is null
       or spawn_info is null or handler_stage is null
       or exception_string ~ E'[\r\n\t]' or game_state ~ E'[\r\n\t]'
       or self_ptr ~ E'[\r\n\t]' or spawn_info ~ E'[\r\n\t]'
       or handler_stage ~ E'[\r\n\t]');

create index if not exists crash_reports_stage_idx on public.crash_reports (handler_stage);
create index if not exists crash_reports_gamestate_idx on public.crash_reports (game_state);
