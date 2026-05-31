-- Auto-Raid Invite (ARI / "MIC") state, mirrored from the bot so wolfpack.quest
-- can render it on the front page. Single-row table keyed on guild_id —
-- there's only ever one active ARI per guild, set by /ari (or /autoraidinvite)
-- in Discord. The bot upserts on setAri/clearAri.
--
-- Why a table not bot_kv: dedicated columns let RLS, indexes, and the web
-- query stay obvious. There's exactly one row per guild.

create table if not exists public.ari_state (
    guild_id      text primary key,
    -- Named character to /who for an invite. NULL means no MIC is set
    -- (cleared via /ariclear); the front-page banner shows the empty state.
    character     text,
    password      text,
    set_by_id     text,   -- Discord user id of the officer who set it
    set_by_name   text,   -- their display name at set time
    set_at        timestamptz,
    updated_at    timestamptz not null default now()
);

comment on table public.ari_state is
    'Auto-Raid Invite (ARI / MIC) — the character members should /who and tell with the password to get an auto-invite. Mirrored from bot state on /ari + /ariclear.';

alter table public.ari_state enable row level security;
-- All signed-in guildmates can read (the same info is already available via
-- the /ari Discord command to any guild member).
create policy "ari_state read for authenticated"
    on public.ari_state for select to authenticated using (true);
-- Writes only via service_role (the bot).

grant select on public.ari_state to authenticated, service_role;
