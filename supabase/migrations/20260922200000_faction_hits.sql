-- faction_hits — one row per observed faction change.
--
-- WHY (the guild lead, 2026-09-22): "I'm working on my faction and I think it
-- would be worthwhile to have this data be timebound for how recently these
-- hits have come in. Show last N days worth."
--
-- That could not be answered. `faction_standing` is running totals only
-- (better_count / worse_count / better_total / worse_total + first_hit_at /
-- last_hit_at), written by the additive `bump_faction_standing` RPC. The
-- individual events DO reach the bot — `_handleAgentFaction` loops over them
-- with kind/faction/mob/ts and aggregates — and were then discarded. 749,753
-- hits across 179 characters existed only as counters.
--
-- ⚠ This table only knows what lands in it from now on. The aggregate history
-- cannot be reconstructed from `faction_standing`. It CAN be rebuilt from the
-- raiders' own logs, because a `--since` backfill replays the same lines — see
-- the dedup note below, which is what makes that safe to do more than once.
--
-- SIZE, because database size is the metered thing that only grows and this
-- repo has a cautionary tale about exactly that (`encounter_threat_snapshots`,
-- 1.2 GB, sweep never worked):
--   · measured rate is ~851 hits/day guild-wide (749,753 over 881 days)
--   · ~310k rows/year, so tens of MB — two orders of magnitude under the
--     threat-snapshot table, and bounded by the retention below
--   · a full-history backfill would land ~750k rows in one go, which is still
--     well inside that budget
create table if not exists public.faction_hits (
  id         bigserial primary key,
  guild_id   text        not null,
  character  text        not null,
  faction    text        not null,
  -- The kill that caused it, when the line named one. Null is common and fine.
  mob        text,
  direction  text        not null check (direction in ('better', 'worse')),
  -- Resolved point value. NULL when the line carried no magnitude and the
  -- catalog could not price it — the page already calls these "unconfirmed",
  -- and they must stay countable without being summable.
  amount     integer,
  priced     boolean     not null default false,
  ts         timestamptz not null,
  created_at timestamptz not null default now()
);

-- The read this table exists for: one character's window on one faction.
create index if not exists faction_hits_char_faction_ts_idx
  on public.faction_hits (guild_id, character, faction, ts desc);

-- ⚠ LEADS ON `ts`, deliberately. The 30-day sweep on
-- `encounter_threat_snapshots` has never once removed a row because its
-- predicate (`snapshot_at < cutoff`) has no index that leads on that column,
-- so the DELETE seq-scans, blows the client timeout, and the catch logs a
-- warning — 448k rows past retention and a table at 57% of the database. A
-- retention policy without an index that serves it is not a retention policy.
create index if not exists faction_hits_ts_idx on public.faction_hits (ts);

-- ⚠ Re-running a backfill over the same logs replays the same hits. The
-- aggregate path has no defence against that (bump_faction_standing just adds,
-- so a second pass inflates the counters), but this table can, and does.
-- The trade is deliberate: two genuinely distinct hits on the same faction, in
-- the same second, from the same mob name collapse into one. That costs a
-- rounding error on an AE pull; the alternative costs a doubled history every
-- time someone re-imports their logs, which is a documented workflow here.
create unique index if not exists faction_hits_dedup_idx
  on public.faction_hits (guild_id, character, faction, ts, direction, coalesce(mob, ''));

alter table public.faction_hits enable row level security;

-- Guild data: readable by signed-in members, same as the rest of tier 2. The
-- bot writes with service_role and bypasses RLS.
do $$ begin
  create policy faction_hits_read on public.faction_hits
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
