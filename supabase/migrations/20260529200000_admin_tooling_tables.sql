-- Admin tooling backbone — three new operational tables used by /admin pages.
--
-- agent_uploads — every payload landing at /api/agent/* writes one row.
--   Lets us see who is uploading what, when, on which version, with what
--   queue depth + error count. The bot needs to start writing rows on every
--   endpoint handler; this migration creates the surface, the writes come
--   in a follow-up bot change.
--
-- agent_backfill_requests — when an officer (or the encounter audit) finds a
--   data gap, they file a request that names the character + scope. The
--   agent polls a (not-yet-built) /api/agent/backfill-requests endpoint,
--   picks up its pending rows, processes them, and posts back the outcome.
--   Status lifecycle: pending → acked → running → completed/errored, or
--   dismissed by the agent's user.
--
-- feedback — DB mirror of /feedback submissions. Discord thread is still the
--   primary surface, but the admin page needs to search, filter by category,
--   and mark addressed without re-scrolling the thread.

CREATE TABLE IF NOT EXISTS agent_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id        text NOT NULL DEFAULT 'wolfpack',
  character       text,
  discord_id      text,
  agent_version   text,
  endpoint        text NOT NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  payload_bytes   integer,
  ok              boolean NOT NULL DEFAULT true,
  status_code     integer,
  error_message   text,
  -- Optional agent-side state piggybacked on the upload. jsonb so we don't
  -- churn columns: { queue_pending, queue_last_error, fight_active, ... }
  agent_state     jsonb
);
CREATE INDEX IF NOT EXISTS agent_uploads_character_idx ON agent_uploads (guild_id, character, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS agent_uploads_recent_idx    ON agent_uploads (uploaded_at DESC);
CREATE INDEX IF NOT EXISTS agent_uploads_errors_idx    ON agent_uploads (uploaded_at DESC) WHERE ok = false;

CREATE TABLE IF NOT EXISTS agent_backfill_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id        text NOT NULL DEFAULT 'wolfpack',
  character       text NOT NULL,
  requested_at    timestamptz NOT NULL DEFAULT now(),
  requested_by_discord_id text,
  requested_by_name text,
  reason          text,
  -- { start_iso, end_iso, types: ['encounter','chat','pvp','bosskill','lockout'] }
  scope           jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  acked_at        timestamptz,
  dismissed_at    timestamptz,
  dismissed_reason text,
  completed_at    timestamptz,
  completed_summary jsonb,
  error_message   text
);
-- One open request per (character, scope_start) — duplicate filings collapse.
-- Expression in UNIQUE INDEX (not table-level UNIQUE — Postgres rejects expr there).
CREATE UNIQUE INDEX IF NOT EXISTS agent_backfill_requests_dedup
  ON agent_backfill_requests (guild_id, character, ((scope->>'start_iso')));
CREATE INDEX IF NOT EXISTS agent_backfill_requests_status_idx
  ON agent_backfill_requests (guild_id, character, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id        text NOT NULL DEFAULT 'wolfpack',
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  submitter_discord_id text,
  submitter_name  text,
  category        text,
  message         text NOT NULL,
  discord_msg_id  text,
  discord_msg_link text,
  status          text NOT NULL DEFAULT 'new',   -- new | acked | addressed | wont_fix | duplicate
  acked_by        text,
  acked_at        timestamptz,
  addressed_by    text,
  addressed_at    timestamptz,
  notes           text
);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS feedback_recent_idx ON feedback (submitted_at DESC);

-- service_role only; admin pages use supabaseAdmin(). No anon/authenticated
-- read policies — these tables surface internal agent state and individual
-- feedback that should stay officer-only.
ALTER TABLE agent_uploads             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_backfill_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback                  ENABLE ROW LEVEL SECURITY;
