-- Member lockout (the guild lead, 2026-10-13: "I need an admin page to lock out members despite discord roles and
-- invalidate mimic sessions"; picked option A, DECISIONS-2026-09-21.md §252).
--
-- One row = one member locked out of OUR tools (the website, Mimic's bot API, the bot's Discord commands) whatever
-- Discord roles they hold. Discord itself is untouched. Unlock deletes the row; the history of who locked and
-- unlocked whom lives in audit_log (actions 'member_lockout' / 'member_unlock').
--
-- Active = a row exists AND (until IS NULL OR until > now()). An expired row is inert and is removed on the next
-- officer write.
--
-- Why not wolfpack_members.is_member: the bot's 6-hourly member sync and every web sign-in write is_member = true,
-- so a flag there would be undone within hours.
--
-- user_id is copied from wolfpack_members at lock time so the website can match a signed-in auth user without a
-- second lookup (password-invite accounts have no Discord id on the auth user).
--
-- Service role only: RLS on, no policies, no grants to anon/authenticated. Idempotent.

create table if not exists public.member_lockouts (
    discord_id            text primary key,
    user_id               uuid,
    reason                text,
    locked_by_discord_id  text not null,
    locked_at             timestamptz not null default now(),
    until                 timestamptz
);

alter table public.member_lockouts enable row level security;
revoke all on public.member_lockouts from anon, authenticated;
grant all on public.member_lockouts to service_role;
