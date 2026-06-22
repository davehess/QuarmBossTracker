-- DM-status columns for the post-register "claim your character" message.
-- The bot batches Register clicks per uploader inside a 60s window and DMs
-- one consolidated link list; these columns let the "Awaiting OpenDKP claim"
-- admin-queue category surface DM status (sent / dms_off / failed) so
-- officers know whether to nudge in-channel — there is no auto-retry, but
-- /admin/queue exposes a manual "re-DM" action that calls back into the
-- bot's /api/admin/opendkp-claim-redm endpoint.
alter table characters
  add column if not exists claim_dm_sent_at timestamptz,
  add column if not exists claim_dm_status  text,    -- 'sent' | 'dms_off' | 'failed' | null
  add column if not exists claim_dm_error   text,    -- last failure detail (debug)
  add column if not exists claim_opendkp_id integer; -- the freshly-created OpenDKP CharacterId
                                                     -- (captured at register time so the DM link
                                                     -- works before the next OpenDKP sync writes
                                                     -- it to opendkp_id)

create index if not exists characters_awaiting_claim_idx
  on characters (registered_via_web_at)
  where registered_via_web_at is not null and discord_id is null;
