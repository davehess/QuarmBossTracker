-- Let a bug report carry the log that proves it.
--
-- Hitya, 2026-09-02: "give mimic a feedback entry point that allows for direct
-- log collection timeframe."
--
-- A report with no log is a guessing game. A report carrying someone's whole log
-- is a privacy incident we caused. These columns hold the middle thing: a
-- redacted slice of the last N minutes, attached only when the reporter ticked
-- the box after reading a preview of it.
--
-- WHAT IS ALREADY GONE BY THE TIME IT GETS HERE. The agent redacts before upload
-- using triggerVisibleLine -- the same audited predicate the local trigger engine
-- is gated on -- plus a /who drop. Officer channels, tells in both directions,
-- group chat and public say never reach this column. Combat, spells, zones and
-- the reporter's own name stay, because that is what makes a bug reproducible.
--
-- SIZE. Capped agent-side at 6000 lines / 512 KB per report. Database size is the
-- one meter that only ever grows (see CLAUDE.md), so if these ever accumulate,
-- prune the excerpt and keep the row: the message is the durable part, the log
-- is evidence with a short useful life.
alter table public.feedback
  add column if not exists log_excerpt   text,
  add column if not exists log_meta      jsonb,
  add column if not exists client        text,
  add column if not exists client_version text,
  add column if not exists platform      text;

comment on column public.feedback.log_excerpt is
  'Redacted slice of the reporter''s EQ log, attached opt-in. Officer chat, tells, group chat, public say and /who are removed agent-side before upload; combat/spell/zone lines remain. Capped at 6000 lines / 512 KB.';
comment on column public.feedback.log_meta is
  'Provenance for log_excerpt: {minutes, lines, removed, bytes, truncated, from, to, character}. "removed" counts lines the redaction dropped, so a reviewer can see the filter ran.';
