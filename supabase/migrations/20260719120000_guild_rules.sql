-- #94 — structured guild-rules store.
--
-- The Discord rulebook (#rules / #raid-rules / #loot-rules) ingested into one
-- queryable table so later features (#95 raid-kit, #93 comp matcher,
-- eligibility) read ONE source of truth instead of hard-coding rules that drift
-- from the channels. The bot's /ingestrules command fills this; this migration
-- only defines the store. Ingest fidelity over cleverness — semantics
-- (eligibility logic, categorization) are deliberately NOT computed here.
--
-- One Discord message = one row. The parser extracts a rule_number + title when
-- the message is a numbered/heading item; an unparsed message still lands as a
-- raw-body row (rule_number NULL) so nothing is silently dropped. Re-ingest
-- upserts by (guild_id, channel_key, source_message_id): edits update in place,
-- and messages that vanished from the channel are flipped active=false.
create table if not exists public.guild_rules (
  id                uuid primary key default gen_random_uuid(),
  guild_id          text not null,
  channel_key       text not null check (channel_key in ('rules', 'raid_rules', 'loot_rules')),
  rule_number       int,            -- nullable: null = raw/unparsed message body
  title             text,           -- extracted heading (nullable)
  body              text not null default '',
  category          text,           -- reserved for #95/#93 to fill; NOT set at ingest
  source_message_id text not null,  -- Discord message snowflake — the upsert key
  source_edited_at  timestamptz,    -- Discord edit timestamp, when present
  ingested_at       timestamptz not null default now(),
  active            boolean not null default true
);

-- Upsert key: one row per source message per channel per guild. Re-running
-- /ingestrules merges edited messages in place instead of duplicating.
create unique index if not exists guild_rules_msg_uniq
  on public.guild_rules (guild_id, channel_key, source_message_id);

-- Read path: list a channel's active rules in rule order.
create index if not exists guild_rules_channel_idx
  on public.guild_rules (guild_id, channel_key, active, rule_number);

alter table public.guild_rules enable row level security;

-- Tier-2 guild data pattern (see roll_sets): authenticated may read; the bot
-- writes as service_role (bypasses RLS), so no write policy is defined.
drop policy if exists guild_rules_read on public.guild_rules;
create policy guild_rules_read on public.guild_rules
  for select to authenticated using (true);
