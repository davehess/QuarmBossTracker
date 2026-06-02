-- UI Studio storage — encrypted snapshots of a player's EQ ini files,
-- uploaded by Mimic so the same character can be restored on a new
-- machine without manually re-dragging every window / re-creating chat
-- tabs / re-enabling logging.
--
-- Encryption: AES-256-GCM in WISHLIST_BID_KEY (same key already used for
-- the wishlist BIS bids — service_role only). Format on the wire:
--   iv:tag:ciphertext  (base64 each segment)
-- The plaintext payload is a JSON object: { files: { "<filename>": "<contents>" }, ... }
-- containing eqclient.ini + every UI_*.ini / <Char>_<Server>.ini / Sock_* / Socials_*
-- file for the character / install. Mimic does the encryption locally
-- before upload; the bot stores the blob without ever decrypting it.
--
-- Privacy: scope = PRIVATE. Only the uploader's Discord user can list /
-- download their own snapshots. Tooltips in /me will surface this scope
-- when the UI Studio panel ships on the web side.

create table if not exists public.ui_snapshots (
    id                  uuid primary key default gen_random_uuid(),
    -- The discord_id of the snapshot's owner. We resolve this from the
    -- Wolfpack agent token at upload time (bot side).
    owner_discord_id    text not null,
    -- The character name the snapshot is for. Lets the restore UI show a
    -- per-character list. NULL if the snapshot is global-only (eqclient.ini
    -- with no per-character files).
    character_name      text,
    -- Server short name (e.g. 'pq.proj' on Quarm). Future-proofs against
    -- the same character existing on multiple servers.
    server_short        text,
    -- Optional user-supplied label so a player can tell "1440p home" from
    -- "1080p laptop" at restore time.
    label               text,
    -- Resolution + monitor info captured at snapshot time. Used by the
    -- clamp-on-mismatch logic and surfaced in the restore UI.
    source_width        int,
    source_height       int,
    -- Encrypted payload: iv:tag:ciphertext (base64 each segment).
    payload_enc         text not null,
    -- Size of the plaintext payload (bytes). Cap enforced on the bot side
    -- so a single character can't blow past a reasonable budget.
    payload_bytes_plain int,
    -- File count in the snapshot. Cheap to surface in the list UI.
    file_count          int,
    -- agent version that uploaded the snapshot. Diagnostic.
    agent_version       text,
    created_at          timestamptz not null default now()
);

create index if not exists ui_snapshots_owner_idx
    on public.ui_snapshots (owner_discord_id, created_at desc);
create index if not exists ui_snapshots_owner_char_idx
    on public.ui_snapshots (owner_discord_id, character_name, created_at desc);

alter table public.ui_snapshots enable row level security;
-- service_role only — the bot is the sole reader/writer. Mimic uploads
-- through the bot's /api/agent/ui_layout endpoint, which uses the
-- WOLFPACK_AGENT_TOKEN to resolve the uploader's Discord ID.
revoke all on public.ui_snapshots from anon, authenticated;
grant all  on public.ui_snapshots to service_role;
