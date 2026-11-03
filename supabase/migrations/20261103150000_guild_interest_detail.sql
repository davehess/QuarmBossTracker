-- Register-form detail (the guild lead, 2026-11-03: "we need more detail here, timezone and timeframe, other
-- bidding modes with a description"). Four optional columns on guild_interest — all closed vocabularies matched in
-- web/lib/guildInterest.ts before anything is stored (off-list values store as NULL there, so the checks here are
-- the backstop, not the filter). tz is a raid-planning zone (ET/PT/…), not an IANA name; raid_start/raid_end are
-- half-hour wall-clock steps in the guild's own zone (end before start = runs past midnight); bid_mode is the
-- loot-award style from the systems catalog (docs/DESIGN-loot-systems.md §2) — the DKP *tool* stays in `dkp`.
-- Idempotent.

alter table public.guild_interest add column if not exists tz text;
alter table public.guild_interest add column if not exists raid_start text;
alter table public.guild_interest add column if not exists raid_end text;
alter table public.guild_interest add column if not exists bid_mode text;

do $$ begin
  alter table public.guild_interest add constraint guild_interest_tz_check
    check (tz is null or tz in ('et', 'ct', 'mt', 'pt', 'gmt-uk', 'eu-central', 'oceania', 'other'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.guild_interest add constraint guild_interest_raid_start_check
    check (raid_start is null or raid_start ~ '^([01][0-9]|2[0-3]):(00|30)$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.guild_interest add constraint guild_interest_raid_end_check
    check (raid_end is null or raid_end ~ '^([01][0-9]|2[0-3]):(00|30)$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.guild_interest add constraint guild_interest_bid_mode_check
    check (bid_mode is null or bid_mode in
      ('dkp-open', 'dkp-sealed', 'dkp-timer', 'epgp', 'rolls', 'council', 'picks', 'other', 'none'));
exception when duplicate_object then null; end $$;
