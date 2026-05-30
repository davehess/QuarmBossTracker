-- Per-member onboarding state, moved out of the salted-hash thread embed.
--
-- Previous design (utils/onboarding.js _optOuts): salted SHA-256 hashes of
-- Discord user IDs were stored in a hidden JSON embed inside ONBOARDING_THREAD_ID,
-- mapping hash → "version opted out at". That predated stable database support;
-- the hashing was the privacy mitigation when state lived in a Discord channel.
--
-- Now that we have RLS-gated, service-role-only writes, plain discord_id is fine
-- (we already store it in characters.discord_id and wolfpack_members.discord_id).
-- Adds last_seen_version so onboarding/changes can show diff-only by default
-- instead of either "nothing" or "full welcome again".

create table if not exists public.member_onboarding_state (
    guild_id            text not null,
    discord_id          text not null,
    -- Last bot version this member was shown onboarding/changes for. The
    -- "diff" displayed on a subsequent revision is changesSince(last_seen_version).
    last_seen_version   text,
    -- True when the user clicked "🔕 Don't show me this again". They still get
    -- diff-only on demand via /onboarding; only the unsolicited DM on rejoin is
    -- suppressed.
    opted_out           boolean not null default false,
    updated_at          timestamptz not null default now(),
    primary key (guild_id, discord_id)
);

create index if not exists idx_member_onboarding_state_discord
    on public.member_onboarding_state (discord_id);

comment on table public.member_onboarding_state is
    'Per-Discord-user onboarding state. last_seen_version drives diff-only revision DMs/replies. Service-role-only writes; users read their own row.';

alter table public.member_onboarding_state enable row level security;

create policy "member_onboarding_state read own row"
    on public.member_onboarding_state for select to authenticated
    using (
        exists (
            select 1 from public.wolfpack_members wm
            where wm.discord_id = member_onboarding_state.discord_id
              and wm.user_id    = auth.uid()
        )
    );
-- Writes only via service_role (the bot).

grant select on public.member_onboarding_state to authenticated, service_role;
