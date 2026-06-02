-- Scrub the ari_state table comment. The original wording described the
-- internal workflow that members shouldn't see surfaced. The bot uses
-- this table for its own state; no external documentation needed.

comment on table public.ari_state is
  'Internal bot state for the auto-raid-invite (ARI) feature. Mirrored from the bot on /ari + /ariclear. service_role only.';
