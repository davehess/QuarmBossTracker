-- Upload tokens hashed at rest, phase 1 (readiness audit #15, 2026-11-12).
--
-- mimic_sessions.session_token is the bearer a Mimic install sends on every request, stored in plain text. This adds
-- token_hash = sha256(token) hex and a unique index; utils/mimicLink.js looks a token up by hash first and falls back to
-- the plaintext column (backfilling the hash) until phase 2. A token is 32 random bytes, so a fast hash is correct.
--
-- ROLLOUT: apply this, then deploy the bot. Old processes keep working (session_token is untouched and still written).
-- PHASE 2 (a later migration, only after SESSION_PLAINTEXT_FALLBACK=off ran clean for a week):
--   alter table public.mimic_sessions alter column session_token drop not null;
--   update public.mimic_sessions set session_token = null where token_hash is not null;
-- Idempotent. pgcrypto lives in the extensions schema on this project.

alter table public.mimic_sessions add column if not exists token_hash text;

-- Backfill every existing row. Safe to re-run: only rows still without a hash are touched.
update public.mimic_sessions
   set token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
 where token_hash is null and session_token is not null;

create unique index if not exists mimic_sessions_token_hash_key
  on public.mimic_sessions (token_hash) where token_hash is not null;
