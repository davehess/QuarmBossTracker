-- 20261004160000_quarm_patch_notes.sql
-- Project Quarm's patch notes, mirrored from the guild's patch-notes channel (the guild lead,
-- 2026-10-04: "pull everything from there") so a session can read the server's patch history and
-- quote the exact wording of a change.
--
-- One row per Discord message, keyed by the message id. The channel is normally a followed
-- announcement channel, so the posts are webhook crossposts: the text may live in `content`, in
-- `embeds`, or in `attachments`, and all three are kept.
--
-- `content_missing` marks a message that came back with no content, no embeds and no attachments.
-- That is what Discord returns for every message that does not mention the bot when the bot lacks
-- the Message Content intent, so a true value on many rows means the intent is off, not that the
-- notes were empty. The bot rewrites such a row once the intent is on.
--
-- Quarm's patch notes are public information: signed-in members may read them. Writes are the
-- bot's only (service_role bypasses RLS), so there is deliberately no insert/update policy.
-- Idempotent.

create table if not exists public.quarm_patch_notes (
  message_id      text        primary key,
  channel_id      text        not null,
  posted_at       timestamptz not null,
  edited_at       timestamptz,
  author          text,
  content         text,
  embeds          jsonb       not null default '[]',
  attachments     jsonb       not null default '[]',
  content_missing boolean     not null default false,
  fetched_at      timestamptz not null default now()
);

create index if not exists quarm_patch_notes_posted_at_idx
  on public.quarm_patch_notes (posted_at desc);

alter table public.quarm_patch_notes enable row level security;

drop policy if exists quarm_patch_notes_read on public.quarm_patch_notes;
create policy quarm_patch_notes_read on public.quarm_patch_notes
  for select to authenticated using (true);
