-- Mimic mini-mode review page (wolfpack.quest/mimic/mini, Hitya 2026-09-11:
-- "the guild's opinions matter here"). Each overlay is shown in full next to
-- three mini renditions; members vote for one and leave feedback that stays
-- on the page. One vote per member per overlay, changeable. Writes go through
-- server actions with the service role (same posture as `feedback`); reads
-- are authenticated so the page can show tallies and the thread.

create table if not exists overlay_design_votes (
  overlay     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  choice      text not null,
  voter_name  text,
  updated_at  timestamptz not null default now(),
  primary key (overlay, user_id)
);

create table if not exists overlay_design_feedback (
  id          uuid primary key default gen_random_uuid(),
  overlay     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  author      text not null,
  choice      text,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists overlay_design_feedback_overlay_idx
  on overlay_design_feedback (overlay, created_at);

alter table overlay_design_votes enable row level security;
alter table overlay_design_feedback enable row level security;

do $$ begin
  create policy overlay_design_votes_read on overlay_design_votes
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy overlay_design_feedback_read on overlay_design_feedback
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
