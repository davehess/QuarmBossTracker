-- agent_clock_offsets: allow the 'chat' estimator alongside pulse + consensus.
--
-- 'chat' measures client-against-client using a guild/raid line the EQ server
-- broadcast to everyone at once. Unlike 'pulse' (client vs OUR bot) it does not
-- involve our server's clock at all, which is what makes it an independent
-- cross-check rather than a second opinion from the same source — and the only
-- estimator that would notice a self-hosted deployment whose BOT has the wrong
-- clock and is quietly correcting the whole fleet toward it.
--
-- Resolution is one second: EQ log timestamps have no sub-second component, so
-- every 'chat' sample is a multiple of 1000ms. Fine against the 5s threshold at
-- which utils/clockOffset.js acts; useless below that.
--
-- Idempotent: drops and recreates the CHECK rather than assuming its state.

alter table public.agent_clock_offsets
  drop constraint if exists agent_clock_offsets_method_check;

alter table public.agent_clock_offsets
  add constraint agent_clock_offsets_method_check
  check (method = any (array['pulse'::text, 'consensus'::text, 'chat'::text]));

comment on column public.agent_clock_offsets.method is
  'pulse = four-stamp NTP against the bot on the agent heartbeat (live, sub-second). '
  'consensus = median of a death with 3+ witnesses (backfilled once 2026-08-04, no live writer). '
  'chat = client-vs-client from a shared guild/raid line; independent of the bot''s own clock, '
  '1-second resolution. offset_ms is POSITIVE when the client is BEHIND: ts + offset_ms = true time.';
