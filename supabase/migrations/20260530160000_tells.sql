-- Inbound /tell relay — opt-in, own-tells-only, surfaces on /me/tells and (optionally)
-- as Discord DMs to the owner. Default-off everywhere.
--
-- Privacy posture:
--   * Owner is the member whose log captured the tell (their character == owner_character).
--   * Only the OWNER ever sees their own tells, anywhere. No leaderboards, no
--     aggregate queries on tells across members.
--   * Agent uploads only when characters.tell_relay = true (default false).
--   * Bot rejects uploads where the character's tell_relay is false (defense in depth).
--   * RLS gates read access on wolfpack_members.user_id = auth.uid().

-- 1) Opt-in flag, default false ------------------------------------------------
alter table public.characters
    add column if not exists tell_relay boolean not null default false;

comment on column public.characters.tell_relay is
    'Opt-in: relay this character''s incoming /tell + their outgoing replies to Discord DMs + /me/tells. Default off — the owner must explicitly enable it on /me.';

-- 2) The tells store -----------------------------------------------------------
create table if not exists public.tells (
    id                bigserial primary key,
    guild_id          text not null,
    -- The character that received the tell on this machine. Required so we can
    -- key everything to the owner (their /me, their DM relay).
    owner_character   text not null,
    owner_discord_id  text not null,
    -- 'incoming' = other → you, 'outgoing' = you → other.
    direction         text not null check (direction in ('incoming','outgoing')),
    -- The other party. May or may not be a guildmate.
    other_name        text not null,
    text              text not null,
    ts                timestamptz not null,
    -- live_agent (default), historical_backfill, manual_paste, etc.
    source            text not null default 'live_agent',
    raw_text          text,
    -- Stable per-tell key so a backfill or agent restart can't dupe.
    -- Recommended: sha1(owner_character|direction|other_name|ts|text) on the agent.
    dedup_key         text,
    -- Set when the bot DMs the owner with this tell; null if relay was off.
    dm_relayed_at     timestamptz,
    created_at        timestamptz not null default now()
);

create unique index if not exists tells_dedup
    on public.tells (guild_id, owner_character, dedup_key)
    where dedup_key is not null;

create index if not exists tells_owner_ts
    on public.tells (owner_discord_id, ts desc);
create index if not exists tells_owner_char_ts
    on public.tells (owner_character, ts desc);
create index if not exists tells_other
    on public.tells (lower(other_name));

comment on table public.tells is
    'Per-member /tell capture. Strict opt-in via characters.tell_relay; only the owner ever sees their own. Source: agent log tail.';

alter table public.tells enable row level security;

-- Owner read: a member can read tells where owner_discord_id matches their
-- linked wolfpack_members.user_id chain. Nobody else sees anything.
create policy "tells read own only"
    on public.tells for select to authenticated
    using (
        exists (
            select 1 from public.wolfpack_members wm
            where wm.discord_id = tells.owner_discord_id
              and wm.user_id    = auth.uid()
        )
    );
-- Writes only via service_role (the bot).

grant select on public.tells to authenticated, service_role;
