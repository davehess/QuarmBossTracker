-- FB-62 (a member, 2026-10-07): the CH chain showed every cleric as "DI available" unless a DI cast
-- had been seen. Agent 3.7.98+ reports whether Divine Intervention is on the cleric's spell bar
-- (Zeal gem labels) on its live-state row; the bot relays it through /api/agent/di-status as `mem`.
-- NULL = unknown (no agent, an older agent, or an unreadable bar) — the CH chain shows no tick then.
-- Applied ahead of the bot deploy: PostgREST rejects an upsert naming an unknown column, so the
-- column must exist before the bot starts writing it.
alter table public.character_live_state add column if not exists di_mem boolean;
