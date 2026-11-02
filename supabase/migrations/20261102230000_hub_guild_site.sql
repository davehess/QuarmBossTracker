-- A hosted guild's own website, and whether raidmimic.com sends its members there (the guild lead, 2026-11-02:
-- "nothing on raidmimic.com should reference wolfpack.quest, but we should be able to redirect users to their guild's
-- website at their configuration" and "redirect by default"). raidmimic.com/guilds reads these two columns:
-- a player in exactly one guild whose redirect is on and that has a website is sent to it (web/lib/guildSites.ts).
--
-- Builds on 20261023160000_open_hub_registry.sql (hub_guilds). Idempotent. RLS stays on with no policies (the web
-- server uses the service role): the new columns inherit that, nothing here opens a table to the browser.
-- Apply this BEFORE the web change that selects the columns ships, or the "Your guilds" list reads as empty.
--
-- Wolf Pack is not a hub_guilds row (a check forbids the slug 'wolfpack'); its site and redirect come from
-- configuration in web/lib/guildSites.ts, not from this table.

-- ── The guild's own site ──────────────────────────────────────────────────────────────────────────────────
-- Optional. https only, 200 characters at most, no spaces. The web server also refuses the Raid Mimic hosts themselves
-- (a guild whose "site" is raidmimic.com/guilds would send its members round in a circle).
alter table hub_guilds add column if not exists website_url text;
do $$ begin
  alter table hub_guilds add constraint hub_guilds_website_url_shape
    check (website_url is null or (website_url ~ '^https://[^[:space:]]+$' and char_length(website_url) <= 200));
exception when duplicate_object then null; end $$;

-- ── Redirect by default ───────────────────────────────────────────────────────────────────────────────────
-- true: a member who signs in on raidmimic.com lands on the guild's site (when it has one). An owner or officer turns it
-- off on /guilds/<slug>; a member can always reach raidmimic.com/guilds?stay=1.
alter table hub_guilds add column if not exists redirect_members boolean not null default true;
