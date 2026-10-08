-- Replies on a feedback report (the guild lead, 2026-10-08): the status DM used to link to the Discord
-- card, which only officers can open, so a member could not answer "it is not fixed for you". The web page
-- /feedback/FB-<n> now takes the reply; the bot posts each one under the report's card in the #feedback
-- thread (relayed_at is NULL until it has) and officers read them on /admin/feedback.
--
-- Written only by the web server after it has checked the writer is the report's submitter or an officer, so
-- RLS is on and there is deliberately no anon/authenticated policy: the service role bypasses it.

create table if not exists public.feedback_replies (
  id                uuid primary key default gen_random_uuid(),
  feedback_id       uuid not null references public.feedback(id) on delete cascade,
  author_discord_id text not null,
  body              text not null check (length(body) between 2 and 2000),
  created_at        timestamptz not null default now(),
  relayed_at        timestamptz null
);

create index if not exists feedback_replies_feedback_idx
  on public.feedback_replies (feedback_id, created_at);

-- The bot's relay asks only for the ones it has not posted yet.
create index if not exists feedback_replies_unrelayed_idx
  on public.feedback_replies (created_at) where relayed_at is null;

alter table public.feedback_replies enable row level security;
