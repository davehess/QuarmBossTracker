-- wolfpack_members — links Supabase Auth users to their Wolf Pack EQ Discord
-- guild membership. Populated by the OAuth callback route in web/app/auth/callback/route.ts
-- after each successful sign-in. Used to:
--   1. Gate access to guild-only pages (presence in this table = member)
--   2. Display server nicknames instead of global Discord usernames
--   3. Surface role membership for officer-only views (future)
--
-- The same row is rewritten on every sign-in so role/nickname changes flow
-- through naturally. A row with is_member=false is left behind if someone
-- gets kicked, so we keep an audit trail.
CREATE TABLE IF NOT EXISTS wolfpack_members (
  discord_id     TEXT PRIMARY KEY,
  user_id        UUID UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  nickname       TEXT,
  global_name    TEXT,
  avatar_url     TEXT,
  roles          TEXT[] DEFAULT '{}',    -- Discord role IDs
  role_names     TEXT[] DEFAULT '{}',    -- resolved role names (filled by web OAuth callback)
  is_member      BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at      TIMESTAMPTZ,
  refreshed_at   TIMESTAMPTZ DEFAULT now()
);

-- Idempotent guard for upgrades: if the table predates the role_names
-- column (created by the v0 migration), add it now.
ALTER TABLE wolfpack_members ADD COLUMN IF NOT EXISTS role_names TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS wolfpack_members_user_id_idx ON wolfpack_members (user_id);
CREATE INDEX IF NOT EXISTS wolfpack_members_is_member_idx ON wolfpack_members (is_member);

-- RLS: a user can read their own row; service role can read/write everything.
-- The callback route uses the service role key to upsert; client reads use anon
-- key with this policy to scope to the signed-in user.
ALTER TABLE wolfpack_members ENABLE ROW LEVEL SECURITY;

-- Without this GRANT the RLS policy never engages — PostgREST returns 0
-- rows even for the row's owner. Combined with the policy below, the
-- effective access is "your own row, nothing else".
GRANT SELECT ON wolfpack_members TO authenticated;

DROP POLICY IF EXISTS wolfpack_members_self_read ON wolfpack_members;
CREATE POLICY wolfpack_members_self_read
  ON wolfpack_members
  FOR SELECT
  USING (auth.uid() = user_id);
