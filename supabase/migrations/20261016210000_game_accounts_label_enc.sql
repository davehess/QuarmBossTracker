-- Encrypted account label for game_accounts (the guild lead, 2026-10-16: "we should be encrypting game_accounts.label").
--
-- Why a NEW column: the ciphertext (version tag + IV + encrypted text + auth tag, base64) is longer than the
-- 40-character CHECK on `label`, so it cannot live there. The website (web/lib/labelCrypto.ts) encrypts with
-- AES-256-GCM and writes `label_enc`; once a row has one, `label` is set to NULL. Rows written before the key
-- existed keep their plaintext `label` until the page next reads them, which moves them over.
--
-- Deploy order: this column must exist BEFORE the web code that selects it ships.
--
-- Additive and idempotent. No data is touched here.

ALTER TABLE public.game_accounts ADD COLUMN IF NOT EXISTS label_enc text;

COMMENT ON COLUMN public.game_accounts.label_enc IS
  'Encrypted account label: v1:<base64 iv>:<base64 ciphertext+tag> (AES-256-GCM, bound to owner_discord_id and slot). Written by web/lib/labelCrypto.ts; label is NULL once this is set.';
