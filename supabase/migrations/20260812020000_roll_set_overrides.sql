-- Officer corrections to captured roll sets (#91 follow-up, Hitya 2026-08-12).
--
-- Two real cases from the Aug 11 night: a 0-22 set that was a misfire and needs
-- removing, and "Do a 777 if you want a Shield of the Immaculate" — a phrasing
-- the agent's loot-link convention does not match, so the set landed as an
-- unlabeled roll and needs a name typed in.
--
-- WHY AN OVERRIDE TABLE AND NOT AN EDIT/DELETE ON roll_sets: those rows are
-- per-uploader and agents UPSERT them (roll_sets_uploader_uniq). Deleting or
-- renaming a row would be undone the next time any observer re-uploaded the
-- same set — the correction has to live somewhere the agents never write.
-- Overrides are matched to a MERGED session at read time by the same rule
-- mergeRollSets uses: identical range, start within the set-gap window.
create table if not exists public.roll_set_overrides (
  id                    uuid primary key default gen_random_uuid(),
  guild_id              text        not null default 'wolfpack',
  roll_from             int         not null,
  roll_to               int         not null,
  started_at            timestamptz not null,
  hidden                boolean     not null default false,
  item                  text,        -- null = keep whatever the agent captured
  note                  text,
  edited_by_discord_id  text,
  edited_by_name        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists roll_set_overrides_uniq
  on public.roll_set_overrides (guild_id, roll_from, roll_to, started_at);
create index if not exists roll_set_overrides_started_at
  on public.roll_set_overrides (guild_id, started_at desc);

alter table public.roll_set_overrides enable row level security;
-- Readable by any signed-in member (the page applies them for everyone);
-- WRITES are service-role only, so the officer gate lives in the server action
-- rather than in a policy that a client could reach.
drop policy if exists roll_set_overrides_read on public.roll_set_overrides;
create policy roll_set_overrides_read on public.roll_set_overrides
  for select to authenticated using (true);
