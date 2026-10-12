-- Personal trigger sync (the guild lead, 2026-10-12: "Personal triggers should be syncable" —
-- option B, Push and Pull buttons like UI backups).
--
-- One row per PUSH from a Mimic: the member's personal triggers plus their per-user
-- "what you hear" rules, as one AES-256-GCM blob (WISHLIST_BID_KEY, via utils/bidCrypto.js
-- encryptBlob — the same scheme as ui_snapshots). Plaintext shape:
--   { "triggers": [ ... ], "rules": { "<key>": { "*"|"<char>": "speak"|"overlay"|"off" } }, "schema": 1 }
-- Append-only history, like ui_snapshots; the bot keeps the newest 20 per owner and deletes the
-- rest on each push.
--
-- Privacy: PRIVATE to the owner's household. owner_discord_id is the household ROOT (the
-- wolfpack_members.merged_into_discord_id root, else the pusher), and the bot serves a row only to a
-- caller whose household set contains it. Service role only: RLS on, no policies, no grants to
-- anon/authenticated (the same lockdown as ui_snapshots).

create table if not exists public.personal_trigger_sync (
    id                  uuid primary key default gen_random_uuid(),
    owner_discord_id    text not null,
    guild_id            text not null default 'wolfpack',
    payload_enc         text not null,
    trigger_count       int,
    rule_count          int,
    machine_name        text,
    agent_version       text,
    pushed_by_discord_id text,
    created_at          timestamptz default now()
);

create index if not exists personal_trigger_sync_owner_idx
    on public.personal_trigger_sync (guild_id, owner_discord_id, created_at desc);

alter table public.personal_trigger_sync enable row level security;
revoke all on public.personal_trigger_sync from anon, authenticated;
grant all  on public.personal_trigger_sync to service_role;
