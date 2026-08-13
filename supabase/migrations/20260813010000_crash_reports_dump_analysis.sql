-- Crash reports: what the MINIDUMP said (2026-08-13).
--
-- The previous migration captured everything crash_reason.txt writes. That file
-- is frequently useless on its own — a "Multiple Crashes" bundle contains an
-- exception code and a module name and nothing else, which is 64 of our 393
-- rows. The minidump sitting beside it in the same zip has the whole picture.
--
-- Agent 3.5.68 reads that dump LOCALLY and uploads only the conclusions. The
-- dump itself is never sent and never will be (size and privacy both); zip_name
-- still identifies the bundle if an officer ever needs the real thing.
--
--   analysis_version      which generation of the analysis produced this row;
--                         the agent re-sends older bundles until it matches
--   crash_subsystem       'Windows audio' / 'the graphics driver' / 'Zeal' / ...
--   crash_blames_zeal     true / false / NULL=unknown. NULL when Zeal was not
--                         even loaded — absence from the stack is only evidence
--                         when the module was present
--   crash_headline        the plain-language line shown to the member
--   dump_uptime_sec       how long the client had been running
--   dump_stack_top        [{module, frames}] on the faulting thread
--   dump_churn            [{module, times}] loaded+unloaded 3+ times — a device
--                         being rebuilt over and over
--   dump_audio_endpoints  [{flow, guid, call}] the audio devices in play
alter table public.crash_reports add column if not exists analysis_version     int;
alter table public.crash_reports add column if not exists crash_subsystem      text;
alter table public.crash_reports add column if not exists crash_blames_zeal    boolean;
alter table public.crash_reports add column if not exists crash_headline       text;
alter table public.crash_reports add column if not exists dump_uptime_sec      int;
alter table public.crash_reports add column if not exists dump_stack_top       jsonb;
alter table public.crash_reports add column if not exists dump_churn           jsonb;
alter table public.crash_reports add column if not exists dump_audio_endpoints jsonb;

-- "How many crashes were actually ours?" is the question this whole table
-- exists to answer, so index the two columns that answer it.
create index if not exists crash_reports_subsystem_idx on public.crash_reports (crash_subsystem);
create index if not exists crash_reports_blames_idx    on public.crash_reports (crash_blames_zeal);
