-- Hardening for the guild invite form (2026-11-10): failed redeem attempts are counted in the database, so the limit holds
-- across serverless instances, and new invite codes are 8 characters instead of 6.
--
-- hub_invite_attempts: one row per FAILED redeem (a miss, an expired or used-up code, ...). The web action counts the
-- caller's rows from the last 10 minutes by player and by ip_hash (HMAC-SHA256 of the address, keyed by a server secret;
-- never the address itself) and refuses past 8 per player / 20 per address. Server-only: RLS on, no policies.
-- RETENTION: nothing reads past 10 minutes; the bot's midnight chain (index.js, "swept hub_invite_attempts") deletes rows
-- older than 1 day.
create table if not exists hub_invite_attempts (
  player_id uuid not null,
  ip_hash   text,
  at        timestamptz not null default now()
);
create index if not exists hub_invite_attempts_player_idx on hub_invite_attempts (player_id, at);
create index if not exists hub_invite_attempts_ip_idx     on hub_invite_attempts (ip_hash, at);
alter table hub_invite_attempts enable row level security;

-- Codes made before today are 6 characters and stay valid until they expire; new ones are 8. Same alphabet (no 0 O 1 I L).
-- Apply this BEFORE the web release that mints 8-character codes, or "make a code" fails the old constraint.
alter table hub_invites drop constraint if exists hub_invites_code_check;
alter table hub_invites add constraint hub_invites_code_check
  check (code ~ '^([A-HJKMNP-Z2-9]{6}|[A-HJKMNP-Z2-9]{8})$');
