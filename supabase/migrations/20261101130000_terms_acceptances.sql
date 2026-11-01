-- Which version of the terms a person signed in under, and when (the guild lead's pre-launch checklist, 2026-11-01).
-- Written by both sign-in callbacks (web/lib/termsAcceptance.ts) through the service-role key, fail-open.
-- One row per (user, version): the first sign-in under a version records it; later ones change nothing.
-- RLS is ON with NO policies and anon/authenticated hold no grants, so nothing but the service role can read or write it.
-- No foreign key to auth.users on purpose: this is a record of an agreement, and it should outlive the account it was made on.

create table if not exists public.terms_acceptances (
  user_id       uuid        not null,
  discord_id    text,
  terms_version text        not null,
  accepted_at   timestamptz not null default now(),
  host          text,
  primary key (user_id, terms_version)
);

alter table public.terms_acceptances enable row level security;

revoke all on public.terms_acceptances from anon, authenticated;

comment on table public.terms_acceptances is
  'Which terms version a person signed in under (web/lib/termsAcceptance.ts). Service role only: RLS on, no policies.';
