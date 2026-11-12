-- Per-guild settings, edited by officers on their website (the guild lead, 2026-11-12, Decision Desk: "per-guild settings
-- live in a database row edited by officers on their website; Wolf Pack gets its own registry row").
--
-- guild_settings  one row per guild: the raid schedule (time zone, days, hours), which Discord roles hold which rank and
--                 which job (loot, DKP, recruiting, schedule, triggers), the DKP provider and numbers, the guest rule and
--                 the guild's links. The shape is web/lib/guildSettings.ts (v1); unknown or missing fields read as the
--                 defaults there, so a row never has to be complete. Service role only, like guild_theme: RLS on, no
--                 policies, no grants to anon/authenticated. The site reads and writes it server-side.
-- hub_guilds      gains Wolf Pack's own row so the same /guilds/<slug> pages work for it. The slug check used to refuse
--                 'wolfpack' (the registry was for OTHER guilds); the page and the app still refuse anyone CREATING it
--                 (web/lib/hubGuilds.ts RESERVED_SLUGS).
--
-- Idempotent: the seed rows are today's values and are never overwritten once an officer has edited them.

create table if not exists public.guild_settings (
    guild_id    text primary key,
    settings    jsonb not null default '{}'::jsonb,
    updated_at  timestamptz not null default now(),
    updated_by  text
);

alter table public.guild_settings enable row level security;
revoke all on public.guild_settings from anon, authenticated;
grant all on public.guild_settings to service_role;

-- Wolf Pack today: Sun/Wed/Thu 20:30-23:30 America/New_York, plans run to 00:30, a raid night counts until 6 AM
-- (utils/timezone.js RAID_DAYS / RAID_WINDOW_START / RAID_WINDOW_END; utils/raidNight.js DEFAULT_ROLLOVER_HOUR).
-- DKP: OpenDKP client 'wolfpack', pool 5, 4 regular ticks, bids 1..50000, 3-minute auctions.
-- Must equal WOLFPACK_SEED in web/lib/guildSettings.ts (test/guild-settings.test.js compares them).
insert into public.guild_settings (guild_id, settings)
values (
    'wolfpack',
    '{"v":1,"schedule":{"tz":"America/New_York","days":[0,3,4],"start":"20:30","end":"23:30","planEnd":"00:30","nightCutoffHour":6},"roles":{"leader":["Pack Leader"],"officer":["Officer"],"raider":["Raid Pack"],"member":["Pack Member"],"recruit":["Raid Recruit","Recruit"],"alt":["Raid Alt"]},"jobs":{"loot":[],"dkp":[],"recruiting":[],"schedule":[],"triggers":[]},"dkp":{"provider":"opendkp","client":"wolfpack","pool":5,"ticksPerNight":4,"bidMin":1,"bidMax":50000,"auctionMinutes":3},"guests":{"allow":true,"passHours":6},"links":{"discordInvite":"","website":"https://wolfpack.quest"}}'::jsonb
)
on conflict (guild_id) do nothing;

-- Wolf Pack in the guild registry. The slug check keeps its shape rule and drops only the 'wolfpack' exclusion.
alter table public.hub_guilds drop constraint if exists hub_guilds_slug_shape;
alter table public.hub_guilds add constraint hub_guilds_slug_shape
    check (guild_id ~ '^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$');

-- plan 'managed': Wolf Pack's retention windows ARE the managed plan's (utils/openHub.js), and the managed plan only ever
-- reports at its cap, it is never limited (nextGateState: only 'commons' is limitable). open_join false: nobody joins
-- Wolf Pack through the registry; its members come from the Discord role gate.
insert into public.hub_guilds (guild_id, display_name, plan, open_join, discord_guild_id, website_url)
values ('wolfpack', 'Wolf Pack', 'managed', false, '1168893924329402420', 'https://wolfpack.quest')
on conflict (guild_id) do nothing;
