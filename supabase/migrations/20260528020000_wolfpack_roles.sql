-- wolfpack_roles — catalog of Discord roles in the Wolf Pack EQ guild,
-- populated by the bot's member-sync (utils/wolfpackMembers.js). Lets the
-- web OAuth callback resolve Discord-API role IDs to human names so it can
-- gate sign-in against ALLOWED_ROLE_NAMES.
--
-- The roles table mirrors what the bot sees in guild.roles.cache — the
-- whole catalog is upserted every sync, so renames flow through naturally.
-- Old roles that no longer exist linger here harmlessly until manually
-- pruned; we never DELETE rows during normal operation.
CREATE TABLE IF NOT EXISTS wolfpack_roles (
  role_id      TEXT PRIMARY KEY,        -- Discord role snowflake
  name         TEXT NOT NULL,
  color        INT,                     -- Discord stores as int (RGB)
  position     INT,                     -- higher = more important
  managed      BOOLEAN DEFAULT FALSE,   -- true = bot-managed role (Nitro, integrations)
  refreshed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wolfpack_roles_name_idx ON wolfpack_roles (name);

-- Allow anonymous reads — role names aren't sensitive and we want the web
-- app to resolve names without needing the service role key on every page.
ALTER TABLE wolfpack_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wolfpack_roles_public_read ON wolfpack_roles;
CREATE POLICY wolfpack_roles_public_read
  ON wolfpack_roles
  FOR SELECT
  USING (true);
