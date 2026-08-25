-- Site access without Discord OAuth (Hitya 2026-08-24, from Lacunanight:
-- "discord is not getting my phone number ... as I have 2FA already").
--
-- Discord's unverified-account wall blocks OAuth CONSENT for some members who
-- are otherwise fully present in the guild. The whole site gates on
-- auth.uid() -> wolfpack_members.user_id, and OAuth's only structural job is
-- stamping that binding — so a password-based auth.users bound to the member
-- row by an officer INVITE inherits every existing gate with zero page
-- changes. This table is the invite: single-use, member-bound, 7-day TTL,
-- issued and attested by an officer on /admin/links.
--
-- Service-role only: RLS enabled with NO policies — the token is the secret
-- and must never be readable through the anon/authenticated API surface.
CREATE TABLE IF NOT EXISTS site_access_invites (
  token                  text PRIMARY KEY,      -- 32 random bytes, hex
  guild_id               text NOT NULL DEFAULT 'wolfpack',
  member_discord_id      text NOT NULL,         -- who this grants access AS
  created_by_discord_id  text,                  -- the attesting officer
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  used_at                timestamptz
);

ALTER TABLE site_access_invites ENABLE ROW LEVEL SECURITY;
