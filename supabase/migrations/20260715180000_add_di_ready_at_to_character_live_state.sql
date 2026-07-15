-- Divine Intervention readiness per cleric (log-driven: cast start + 6s cast
-- + 90s recast; interrupts refund). NULL = no DI cast seen this session =
-- assumed ready. Aggregated by GET /api/agent/di-status for the CH-chain +
-- Command Center overlay chips (2026-07-15).
ALTER TABLE public.character_live_state
  ADD COLUMN IF NOT EXISTS di_ready_at timestamptz;
