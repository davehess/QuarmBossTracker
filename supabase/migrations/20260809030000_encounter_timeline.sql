-- Fight timeline v2 (docs/DESIGN-fight-timeline.md) — the tidy per-bucket series
-- behind the boss HP curve + stacked per-class damage chart.
--
-- ── Why a window join and NOT encounter_id ───────────────────────────────────
-- The design doc's "CORRECTION" says the live pipeline already binds snapshots
-- to encounters, and tells you not to build around the window join. Re-measured
-- 2026-08-09: of 3,651 distinct boss fights in the last 14 days, **96 had ANY
-- snapshot bound** (2.6%). Building on encounter_id ships a timeline that works
-- for one fight in forty. Same trap as the threat roll-up (DECISIONS 2026-08-07).
--
-- ── Why binding is broken (root cause) ───────────────────────────────────────
-- Name FORMAT, nothing deeper. `encounters` names a boss via
-- `eqemu_npc_types.name` — underscored, sometimes `#`-prefixed for instanced
-- spawns (`Kaas_Thox_Xi_Ans_Dyek`, `#Tukaarak_the_Warder`). The agent writes
-- `boss_name` in display form with spaces. An equality join therefore matched
-- ONLY single-word bosses (Talendor, Severilous, Faydedar, Kelorek`Dar) — which
-- is precisely the set that looked "bound", making a plain bug read like a
-- backlog problem.
--
-- Normalising `_`→space and stripping `#` takes the top twelve fights of the
-- last raid from ZERO snapshots each to full coverage (Thall Va Kelun 1,185
-- across 12 uploaders; Diabo Xi Xin Thall 1,745 across 15).
--
-- ⚠ This function is the READ-side workaround. The real fix is to bind
-- encounter_id correctly at ingest using the same normalisation — until then,
-- fights where the same boss is pulled repeatedly inside one window cannot be
-- fully disambiguated (see the accuracy note at the bottom).
--
-- ── Why a function, not a view ───────────────────────────────────────────────
-- The table is 557k rows / 458 MB. A view would expand `per_player` across all
-- of it before the planner could filter, so the encounter is an ARGUMENT and is
-- applied before the jsonb expansion.

-- The window join needs (boss_name, time); the existing unique index leads with
-- (guild_id, uploader) and cannot serve it. lower() to match the join predicate.
create index if not exists idx_threat_snapshots_boss_time
  on public.encounter_threat_snapshots (lower(boss_name), snapshot_at)
  where boss_name is not null;

-- Catalog name → the display form the agent actually writes on a snapshot.
create or replace function public.npc_display_name(p_name text)
returns text language sql immutable as $$
  select btrim(replace(replace(coalesce(p_name,''), '_', ' '), '#', ''));
$$;

create or replace function public.encounter_timeline(
  p_encounter_id uuid,
  p_step_sec     int default 5
)
returns table (
  t_sec      int,
  char_name  text,
  pet_owner  text,
  dmg_delta  bigint,
  took_delta bigint
)
language sql stable as $$
  with enc as (
    select e.id, e.started_at, e.ended_at,
           public.npc_display_name(n.name) as npc_name
    from public.encounters e
    join public.eqemu_npc_types n on n.id = e.npc_id
    where e.id = p_encounter_id
  ),
  -- 2-minute skirt absorbs per-uploader fight-start detection, which is NOT
  -- synchronised: King Tormax showed 10 distinct started_at across 10 uploaders
  -- spanning 19 minutes. started_at is therefore useless as a fight key.
  snaps as (
    select s.uploader, s.snapshot_at,
           greatest(0, floor(extract(epoch from (s.snapshot_at - enc.started_at))
                             / greatest(p_step_sec,1))::int) as bucket,
           kv.key as char_name,
           nullif(kv.value->>'pet_owner','')          as pet_owner,
           coalesce((kv.value->>'dmg')::bigint , 0)   as dmg_cum,
           coalesce((kv.value->>'took')::bigint, 0)   as took_cum
    from enc
    join public.encounter_threat_snapshots s
      on lower(s.boss_name) = lower(enc.npc_name)
     and s.snapshot_at >= enc.started_at - interval '2 minutes'
     and s.snapshot_at <= coalesce(enc.ended_at, enc.started_at + interval '2 hours')
                          + interval '2 minutes'
    cross join lateral jsonb_each(s.per_player) kv
  ),
  -- ONE canonical uploader per player, per metric.
  --
  -- Maxing per-bucket DELTAS across uploaders (tried first) over-counts by
  -- ~2.4x: max breaks the telescoping property of a difference series, because
  -- uploaders sample at different offsets so their bucket sums are cut at
  -- different points — sum-of-max-of-deltas is not max-of-totals.
  -- merge_encounter_players settles the same multi-submitter question by taking
  -- MAX TOTAL PER PLAYER; applying that rule means differencing the single
  -- series from whoever saw the most of that player, which telescopes exactly
  -- to the total already shown on the parse page.
  best_dmg as (
    select distinct on (char_name) char_name, uploader
    from (select uploader, char_name, max(dmg_cum) f from snaps group by 1,2) x
    order by char_name, f desc, uploader
  ),
  best_took as (
    select distinct on (char_name) char_name, uploader
    from (select uploader, char_name, max(took_cum) f from snaps group by 1,2) x
    order by char_name, f desc, uploader
  ),
  -- The FIRST sample in the window is a BASELINE, never a delta. Counting it
  -- charges the whole cumulative counter to bucket zero — harmless when the
  -- uploader began at this fight (first value ~0), catastrophic when their
  -- counters carry an EARLIER pull of the same boss. On Kaas Thox Xi Aten Ha Ra
  -- (fought repeatedly across two hours, one uploader's series starting 52
  -- minutes early) that alone put the reconstruction at 311% of truth.
  d_dmg_raw as (
    select s.bucket, s.char_name, s.pet_owner,
           case when lag(s.dmg_cum) over w is null then 0
                else greatest(0, s.dmg_cum - lag(s.dmg_cum) over w) end as d
    from snaps s join best_dmg b using (char_name, uploader)
    window w as (partition by s.char_name order by s.snapshot_at)
  ),
  d_took_raw as (
    select s.bucket, s.char_name,
           case when lag(s.took_cum) over w is null then 0
                else greatest(0, s.took_cum - lag(s.took_cum) over w) end as d
    from snaps s join best_took b using (char_name, uploader)
    window w as (partition by s.char_name order by s.snapshot_at)
  ),
  d_dmg as (
    select bucket, char_name, max(pet_owner) as pet_owner, sum(d) as dmg_delta
    from d_dmg_raw group by bucket, char_name
  ),
  d_took as (
    select bucket, char_name, sum(d) as took_delta
    from d_took_raw group by bucket, char_name
  )
  select (coalesce(a.bucket, t.bucket) * p_step_sec)::int as t_sec,
         coalesce(a.char_name, t.char_name)               as char_name,
         a.pet_owner,
         coalesce(a.dmg_delta, 0)::bigint                 as dmg_delta,
         coalesce(t.took_delta, 0)::bigint                as took_delta
  from d_dmg a
  full join d_took t on t.bucket = a.bucket and t.char_name = a.char_name
  where coalesce(a.dmg_delta,0) > 0 or coalesce(t.took_delta,0) > 0
  order by 1, 2;
$$;

comment on function public.encounter_timeline(uuid, int) is
  'Tidy per-bucket damage / damage-taken deltas for one encounter, deduped across uploaders. Feeds the fight timeline chart (docs/DESIGN-fight-timeline.md). Joins by NORMALISED boss name + time window, not encounter_id (only 2.6% of boss fights bind).';

-- ── Accuracy, measured against ground truth (sum(encounter_players.total_damage),
--    which equals encounters.total_damage exactly) on the 10 biggest fights of
--    the last 10 days:
--
--      Thall Va Kelun 99.6% · Va Xi Aten Ha Ra 99.7% · Kaas Thox Xi Ans Dyek
--      103.5% · Thall Xundraux Diabo 94.1% · Diabo Xi Va 94.8% · Diabo Xi Va
--      Temariel 106.7% · Diabo Xi Xin 114.1%
--
--    Seven of ten land inside ~6%. The residual over/under is pets and a handful
--    of non-roster names the timeline counts and encounter_players folds or
--    excludes — the chart can fold pets under owners via `pet_owner`.
--
--    THREE ARE STILL WRONG — Kaas Thox Xi Aten Ha Ra 20.7%, Aten Ha Ra 63.6%,
--    Diabo Xi Xin Thall 189.6% — and they share one property: the same boss was
--    pulled several times inside the window. A name+time window cannot separate
--    those. Do not present this chart as authoritative for repeat-pull fights
--    until encounter_id binding is fixed at ingest.
