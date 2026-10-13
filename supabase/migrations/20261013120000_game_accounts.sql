-- Which character is on which EverQuest GAME ACCOUNT (the guild lead, 2026-10-13).
--
-- Why: the shared bank belongs to a game account, not to a character, so /me/inventory counted one shared-bank
-- stack once per character on that account. To count it once we first have to know who shares an account.
-- This migration holds the answer; the first way to fill it in is the owner dragging characters between
-- account cards on /me/accounts. Later sources (the login account name, a guess from shared-bank contents)
-- write the same rows with a different `source`.
--
-- The server's rules, which the page and its server actions enforce (the database does not):
--   * one forum account holds up to 10 game logins ("accounts"), so `slot` is 1..10;
--   * a game account holds up to 8 characters;
--   * #charactertransfer moves a character between game accounts of the SAME forum account only, and only
--     if the target has space. So a character never changes OWNER through this table, it changes account.
-- Accounts are called "Account 1" .. "Account 10" until the owner gives one a label.
--
-- game_accounts: one row per (owner, slot). owner_discord_id is the household ROOT Discord id
-- (wolfpack_members.merged_into_discord_id, else discord_id), so merged members share their accounts the
-- same way they share their characters (web/lib/ownedCharacters.ts).
--
-- character_accounts is HISTORY, not a pointer. A character has at most one OPEN row (valid_to IS NULL, held
-- by the partial unique index below). A move closes that row (valid_to = now()) and opens a new one in the
-- other account; account_id is NEVER updated in place. The closed rows are the #charactertransfer history
-- the page shows ("moved from Account 2 on Oct 13").
--
-- Service-role only, like bot_kv: RLS is on and there are no policies, so anon and authenticated get
-- nothing and the web server reads and writes with the service key after checking ownership itself.
--
-- ⚠ This mapping is private to the people in it. Never copy rows from these tables into docs, tests,
-- fixtures or comments: the repo is public.

CREATE TABLE IF NOT EXISTS public.game_accounts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id          text        NOT NULL DEFAULT 'wolfpack',
  owner_discord_id  text        NOT NULL,
  slot              smallint    NOT NULL CHECK (slot BETWEEN 1 AND 10),
  label             text        CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 40),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, owner_discord_id, slot)
);

CREATE TABLE IF NOT EXISTS public.character_accounts (
  id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guild_id        text        NOT NULL DEFAULT 'wolfpack',
  character_name  text        NOT NULL,
  account_id      uuid        NOT NULL REFERENCES public.game_accounts(id) ON DELETE CASCADE,
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  source          text        NOT NULL CHECK (source IN ('owner', 'inferred', 'login')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One open membership per character.
CREATE UNIQUE INDEX IF NOT EXISTS character_accounts_one_open_idx
  ON public.character_accounts (guild_id, lower(character_name))
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS character_accounts_account_idx
  ON public.character_accounts (account_id);

ALTER TABLE public.game_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_accounts ENABLE ROW LEVEL SECURITY;
-- (No policies on purpose: service_role bypasses RLS; everyone else gets nothing.)
