-- Audit marker for characters registered into OpenDKP via the /admin/links
-- Register button. Drives the "Awaiting OpenDKP claim" admin-queue category
-- on wolfpack.quest: it lets the queue surface just the *recently* registered
-- characters that still have no discord_id, instead of bleeding into the
-- ~100+ historical unlinked roster rows. Bot writes the timestamp + officer's
-- Discord ID inside /api/admin/opendkp-register after the OpenDKP create
-- succeeds.
alter table characters
  add column if not exists registered_via_web_at         timestamptz,
  add column if not exists registered_via_web_by_discord_id text;

create index if not exists characters_registered_via_web_idx
  on characters (registered_via_web_at)
  where registered_via_web_at is not null;
