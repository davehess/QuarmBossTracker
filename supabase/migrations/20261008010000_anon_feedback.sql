-- Anonymous feedback: AFB-1, AFB-2, … (the guild lead, 2026-10-08: a signed-out Mimic user cannot send
-- feedback, so the Mimic card sends them to a web form on eqmimic.quest, "logged as a different feedback
-- entirely AFB for anonymous feedback"). Deliberately NOT the `feedback` table: an AFB never takes an FB
-- number, never reaches the Discord relay, and never rides the FB-n commit-closing path.
--
-- Everything stored here has ALREADY been through web/lib/anonFeedbackClean.ts: the message is cleaned
-- (SQL-looking text, links, emails, IPs, secrets and user-name paths are redacted), the Discord contact is
-- validated, and `flags` records what the cleaner took out. `ip_hash` is a salted hash kept only so the
-- form can rate-limit (5 an hour); it is never shown to officers.
--
-- Service role only: RLS on, no policies, and the table grants are taken away from anon/authenticated.
-- Idempotent.

create sequence if not exists public.anon_feedback_ref_seq;

create table if not exists public.anon_feedback (
  id              uuid primary key default gen_random_uuid(),
  ref             integer not null default nextval('public.anon_feedback_ref_seq'),
  submitted_at    timestamptz not null default now(),
  category        text not null check (category in ('bug', 'idea')),
  message         text not null check (char_length(message) <= 4000),
  discord_contact text,
  client          text check (client in ('mimic', 'web')),
  app_version     text,
  platform        text,
  flags           text[] not null default '{}',
  ip_hash         text,
  status          text not null default 'new' check (status in ('new', 'read', 'done'))
);

alter sequence public.anon_feedback_ref_seq owned by public.anon_feedback.ref;

create unique index if not exists anon_feedback_ref_key on public.anon_feedback (ref);
create index if not exists anon_feedback_submitted_idx on public.anon_feedback (submitted_at desc);
-- The rate limit counts one hash's rows in the last hour.
create index if not exists anon_feedback_ip_recent_idx on public.anon_feedback (ip_hash, submitted_at desc);

alter table public.anon_feedback enable row level security;
revoke all on public.anon_feedback from anon, authenticated;
