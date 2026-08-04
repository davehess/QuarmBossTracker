-- Per-install clock offset, so cross-observer timestamps can be compared.
--
-- Every agent stamps events from its OWN machine clock -- including deaths,
-- which EQ writes into the log using that same clock. Measured on the
-- 2026-08-02 Lord Inquisitor Seru parse, two installs ran ~16s behind the pack
-- (Fargan to -48s) while everyone else sat within +/-8s. Death dedup collapses
-- reports within 30s, so a skewed observer's copy escapes as a phantom second
-- death: Dongru and Uilnayar each "died twice" when they died once.
--
-- Widening the dedup window CANNOT fix this, and that is the whole reason this
-- table exists. Syko genuinely died 10 times in that fight, and the minimum gap
-- between two real consecutive deaths -- measured inside ONE observer's log, so
-- no skew is involved -- was 10 seconds. Real signal 10s, noise up to 48s. Any
-- window wide enough to absorb the skew merges genuine deaths. The skew has to
-- be removed BEFORE clustering.
--
-- TWO INDEPENDENT METHODS, kept side by side on purpose:
--   'pulse'     -- the agent sends its own clock on the 20s heartbeat; the bot
--                  computes server_recv - client_now. Direct, covers every
--                  install and every stream.
--   'consensus' -- for a death with 3+ witnesses the median IS the truth and
--                  each observer's deviation is their offset. Needs no agent
--                  release, so it backfills history the pulse can never reach.
-- They should agree. When they do not, something else is wrong -- that
-- disagreement is a free validation loop, which is why method is in the key
-- rather than one value overwriting the other.
--
-- offset_ms is SIGNED: positive means the client clock reads EARLIER than the
-- server (client is behind). Correct a client timestamp with ts + offset_ms.
--
-- Not clamped to small values on purpose: a misconfigured timezone shows up as a
-- whole-hour offset, and correcting that is a feature, not an overreach.

create table if not exists public.agent_clock_offsets (
  guild_id    text        not null,
  discord_id  text        not null,      -- the install identity (identity.discord_id)
  method      text        not null check (method in ('pulse','consensus')),
  offset_ms   bigint      not null,
  samples     integer     not null default 1,
  spread_ms   bigint,                    -- dispersion of the samples; high = untrustworthy
  last_sample_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (guild_id, discord_id, method)
);

create index if not exists agent_clock_offsets_updated_idx
  on public.agent_clock_offsets (guild_id, updated_at desc);

alter table public.agent_clock_offsets enable row level security;

drop policy if exists agent_clock_offsets_read on public.agent_clock_offsets;
create policy agent_clock_offsets_read
  on public.agent_clock_offsets for select
  to authenticated
  using (true);

comment on table public.agent_clock_offsets is
  'Signed clock offset per Mimic install. Correct a client-stamped timestamp with ts + offset_ms. Two methods are stored side by side (pulse = agent heartbeat, consensus = median of multi-witness deaths) so they can cross-check each other.';
