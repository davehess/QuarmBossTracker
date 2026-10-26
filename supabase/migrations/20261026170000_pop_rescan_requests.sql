-- "Sync from my logs" on /pop/raid/me (the guild lead, 2026-10-26): a member asks THEIR OWN Mimic to re-read
-- recent EverQuest logs for Planes of Power flag lines, so the flags catch up without a paste.
--
-- A request is one row. The member's browser files it (service role, after the web checks the character is theirs);
-- Mimic picks it up on its poll (stream `rescan` of GET /api/agent/poll), reads its logs, uploads what it finds the
-- way it always does (POST /api/agent/pop_flag, idempotent on the pop_flags key), and answers POST
-- /api/agent/rescan-done {id, found, ok}. This is NOT agent_backfill_requests: that loop is officer-filed and no
-- agent ever completes it. Here the row is owned by the member (discord_id), claimed atomically by the bot
-- (pending -> taken), and closed by the same member's agent (taken -> done | failed).
--
--   status    pending  filed, nobody has it yet
--             taken    the bot handed it to an agent (taken_at); an agent that dies leaves it here, and the bot
--                      hands it out again once taken_at is 30 minutes old
--             done     the agent finished; `found` = flag lines it read
--             failed   the agent could not read (no log for the character, excluded from stats, ...)
--   character NULL = every character this member's Mimic has a log for
--   days      how far back to read (the web asks 14; the bot caps what an agent is told at 60)
--
-- RLS: a signed-in member reads their own rows (the page polls the status); the service role writes.
create table if not exists public.pop_rescan_requests (
  id            bigint generated always as identity primary key,
  guild_id      text        not null default 'wolfpack',
  discord_id    text        not null,
  character     text,
  days          int         not null default 14 check (days between 1 and 60),
  status        text        not null default 'pending' check (status in ('pending', 'taken', 'done', 'failed')),
  requested_at  timestamptz not null default now(),
  taken_at      timestamptz,
  done_at       timestamptz,
  found         int
);

create index if not exists pop_rescan_requests_member_status_idx
  on public.pop_rescan_requests (guild_id, discord_id, status);

alter table public.pop_rescan_requests enable row level security;
drop policy if exists pop_rescan_requests_read_own on public.pop_rescan_requests;
create policy pop_rescan_requests_read_own on public.pop_rescan_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.wolfpack_members wm
      where wm.discord_id = pop_rescan_requests.discord_id
        and wm.user_id    = auth.uid()
    )
  );
-- No insert/update/delete policy: only the service role (web actions, the bot) writes.
