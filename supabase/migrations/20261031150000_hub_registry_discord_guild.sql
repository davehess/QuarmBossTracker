-- The hub registry, step two: tie a registered guild to its Discord server, and keep the avatar a player signs in with.
-- (the guild lead, 2026-10-31, DECISIONS §492: raidmimic.com is a sign-in first, then "your guilds"; "Find my guilds"
-- asks Discord once for the player's server list and matches it against the guilds registered here; design:
-- docs/DESIGN-raidmimic-hosted.md 7g.)
--
-- Builds on 20261023160000_open_hub_registry.sql (hub_players / hub_guilds / hub_memberships / hub_invites), which is
-- NOT rewritten. Run it first. Per DECISIONS §485 the registry lives in the same Supabase project as everything else,
-- keyed on guild_id, so this file applies wherever that one does. Nothing applies migrations automatically.
--
-- Idempotent. RLS stays on with no policies (the web server and the bot use the service role): the new column and
-- index inherit that, nothing here opens a table to the browser.

-- ── The guild's Discord server, when it has one ────────────────────────────────────────────────────────────
-- Optional (a guild without a Discord uses invite codes only) and UNIQUE where set: one Discord server belongs to at
-- most one registered guild, which is what makes "match the player's servers against the registry" unambiguous.
-- A Discord server id is a snowflake, kept as text like every other Discord id in this schema.
alter table hub_guilds add column if not exists discord_guild_id text;
create unique index if not exists hub_guilds_discord_guild_uidx on hub_guilds (discord_guild_id) where discord_guild_id is not null;
do $$ begin
  alter table hub_guilds add constraint hub_guilds_discord_guild_shape check (discord_guild_id is null or discord_guild_id ~ '^[0-9]{5,25}$');
exception when duplicate_object then null; end $$;

-- ── The avatar a player signed in with ─────────────────────────────────────────────────────────────────────
-- The identify scope gives the Discord id, the global name and the avatar; the open sign-in path stores the last two
-- on the player row (hub_players already has display_name). No guild list and no email are ever stored here.
alter table hub_players add column if not exists avatar_url text;

-- ── Lookups the /guilds page makes ─────────────────────────────────────────────────────────────────────────
-- hub_memberships_player_idx (player_id) where left_at is null already serves "my guilds". An invite is looked up by
-- its primary key (code); nothing else is needed.
