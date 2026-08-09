-- ui_snapshots.machine_name — WHICH computer a UI backup came from.
--
-- Hitya 2026-08-09, mid-migration to a spare raid machine: "we should list the
-- source as the computer name on the restores". The restore picker showed only
-- a timestamp, resolution and file count, so with several machines backing up
-- the same character there was no way to tell the good box's backup from the
-- spare's — exactly when you most need to know, i.e. when you are rebuilding a
-- machine and picking which snapshot to trust.
--
-- Nullable on purpose: every existing row predates the field, and older agents
-- keep uploading without it. The picker renders those as "unknown machine"
-- rather than pretending.
alter table public.ui_snapshots add column if not exists machine_name text;

comment on column public.ui_snapshots.machine_name is
  'Hostname of the computer that took this UI backup (os.hostname() from Mimic). NULL for rows uploaded before 2026-08-09 or by an agent that does not send it.';
