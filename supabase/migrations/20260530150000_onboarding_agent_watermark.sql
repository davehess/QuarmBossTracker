-- Per-member watermark for agent release notifications.
--
-- The wolfpack-logsync agent ships independently from the bot, so
-- member_onboarding_state.last_seen_version (which tracks BOT version) can't
-- carry agent-release acknowledgement. This adds last_seen_agent_version so
-- the agent-release DM fanout can show each member only the bullets they
-- haven't seen yet.
--
-- Context: the previous channel-wide "📦 wolfpack-logsync agent vX.Y.Z is out"
-- post triggered Discord push notifications for everyone on every release.
-- Moving to per-user DMs keyed on (opted_out=false AND
-- last_seen_agent_version < current) gives members real control over
-- revision pings — opt-in by virtue of having interacted with /onboarding.

alter table public.member_onboarding_state
    add column if not exists last_seen_agent_version text;

comment on column public.member_onboarding_state.last_seen_agent_version is
    'Last wolfpack-logsync agent version this member saw release notes for. Drives the diff-only agent-release DM fanout (separate from the bot-version last_seen_version).';
