-- Opt-in EQ client crash telemetry (Mimic → agent → bot). One row per Zeal
-- crash bundle (crashes/<timestamp>.zip: minidump.dmp + crash_reason.txt).
-- We store the PARSED crash_reason metadata + a cheap system snapshot; the
-- minidump itself stays on the user's machine (zip_name lets us ask for a
-- specific dump by hand when a cluster needs deeper analysis).
--
-- Crash "signature" for clustering = (exception_module, address_low16):
-- verified against a 366-dump local corpus (2025-01 → 2026-07) where every
-- ntdll access violation shared the same low-16 address bits across ASLR
-- bases. exception_code + zeal_version + callbacks split families further.
create table if not exists public.crash_reports (
  id bigint generated always as identity primary key,
  guild_id text not null default 'wolfpack',
  character text,
  crashed_at timestamptz not null,
  zip_name text not null,
  exception_code text,
  exception_module text,
  exception_address text,
  address_low16 text,
  zeal_version text,
  callbacks text,
  zone_id text,
  ui_skin text,
  raw_reason text,
  -- { os: {release, arch, totalmem_gb}, gpus: [{name, driver}],
  --   files: { "eqgame.exe": {size, mtime, md5}, "dpvs.dll": {...}, ... } }
  system jsonb,
  agent_version text,
  uploaded_by_discord_id text,
  created_at timestamptz not null default now(),
  unique (guild_id, uploaded_by_discord_id, zip_name)
);

create index if not exists crash_reports_sig_idx
  on public.crash_reports (guild_id, exception_module, address_low16);
create index if not exists crash_reports_at_idx
  on public.crash_reports (guild_id, crashed_at desc);

alter table public.crash_reports enable row level security;

do $$ begin
  create policy crash_reports_read on public.crash_reports
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
