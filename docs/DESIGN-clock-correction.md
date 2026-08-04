# DESIGN — applying the clock offset (#202), and the drift problem (#203)

*Written 2026-08-04 (overnight design pass). Unbuilt — design mode, per the
standing instruction. Companion to `RUNBOOK-death-backfill.md`, which shows why
this matters; this is how to actually do it.*

**The headline, and it is worse than we thought on 2026-08-03:**

> The skewed clocks are **not set wrong once. They are drifting, at about
> 3 seconds per day, and still going.** Fargan's install went **43.5s → 56.4s in
> four days**. A single stored `offset_ms` per install is therefore wrong within
> a week of being measured, and the design has to account for that rather than
> store a scalar.

---

## 1. A third estimator, free, retroactive, and better-covered

Every table carrying an agent-stamped event time **also carries a server-stamped
`created_at`** (`buff_casts.cast_at`/`created_at`, `chat_messages.ts`,
`encounters.started_at`, `fun_events.event_ts`, `who_observations.observed_at`,
`pvp_kills.killed_at`, `target_observations.at`, …). The gap between them is

```
lag = created_at − event_ts  =  clock_skew + pipeline_latency
```

and `pipeline_latency ≥ 0`, so **`min(lag)` over a day's rows is a lower bound on
that install's skew** — the classic one-way-delay min filter. It needs no agent
release, no new stream, and it works on **history**.

### It reproduces the known outliers and finds one we missed

`buff_casts`, last 7 days, installs with >50 rows:

| install | rows | `min(lag)` | consensus estimate |
|---|---:|---:|---:|
| `2722…6416` (Fargan) | 3,744 | **43.5s** | 42.3s |
| `1706…9824` (Bardtholemu) | 7,950 | **10.2s** | 14.0s |
| `6333…7023` | 4,591 | **3.3s** | **none — never measured** |
| every other install (17) | — | ≤ 1.8s | ≈ 0 |

Two things fall out:

- **Coverage.** `6333…7023` has 4,591 rows and a real (small, growing) skew, but
  **no consensus row at all** — consensus needs a death with 3+ witnesses, and
  this uploader never contributed to one. Min-lag covers every uploader that
  writes any row.
- **The estimators disagree for Bardtholemu** (10.2 vs 14.0), and min-lag ought
  to be ≥ the true skew. That is not a contradiction once you look at drift.

### The drift, per day

| date | Fargan | Bardtholemu | `6333…7023` |
|---|---:|---:|---:|
| Jul 29/30 | — | 10.2 | 3.3 |
| Jul 31 | 43.5 | 13.4 | 5.0 |
| Aug 1 | 45.4 | — | — |
| Aug 2 | — | 20.7 | — |
| Aug 3 | 48.6 | 22.3 | — |
| Aug 4 | **56.4** | — | 7.4 |

≈ **+3.2 s/day** (Fargan), **+3.0 s/day** (Bardtholemu), **+0.8 s/day** (third).
The disagreement above is simply the two estimators sampling a moving target at
different times.

**Control** (the other ~20 installs, same query, same days): `min(lag)` sits
between −3s and +8s with a daily average near zero, flat across the whole
window. So this is **per-machine clock drift, not a global upload slowdown** —
which is the alternative explanation the control exists to kill.

### Why `min`, not mean or median

One day in the control shows an average `min(lag)` of **17,734s** and a worst of
**159,595s (~44 hours)**. That is a **backfill** — `--since` uploading week-old
log events — and it is exactly the long right tail that makes any central
statistic useless here. `min` is immune.

The one case `min` gets wrong: an uploader who *only* backfilled that day has no
live row to pull the minimum down. **Guard: ignore a day's estimate when
`min(lag)` exceeds ~300s, and require a sample floor (say 30 rows).**

## 2. Design

### 2.1 Offsets are a time series, not a number

`agent_clock_offsets` currently stores one `offset_ms` per `(discord_id,
method)`. At 3 s/day that is stale almost immediately, and correcting a
three-week-old event with today's offset would be *worse* than not correcting.

Store **per-install, per-day** samples (`method` ∈ `pulse` | `consensus` |
`min_lag`) and resolve a correction by looking up the offset **nearest the
event's own timestamp**, interpolating between samples. Keep the existing
single-row table as a "current best" view for the dashboard if convenient, but
it must not be the thing corrections read.

This also means the **min-lag estimator should be backfilled per day across
history** — it is the only one of the three that can be, and it is what makes
correcting old rows meaningful at all.

### 2.2 Correct at ingest, keep the raw value

Add `corrected_at` alongside the existing event column; never overwrite the raw
one. Rationale:

- **Ingest-time** means every consumer benefits without each remembering, and
  the number is computed once rather than per-read.
- **Keeping raw** preserves provenance, lets us re-correct when the offset
  estimate improves (it will — see drift), and makes the correction auditable.
- Read-time-only correction was the alternative. It needs no backfill, but every
  consumer must remember to apply it, and *they will not* — that is precisely the
  failure mode that produced the `boss_name` NULLs and the dead triggers.

**Re-correction is a first-class requirement, not a nicety.** Because offsets
improve and drift is continuous, `corrected_at` must be recomputable from
`raw + offset(install, raw_time)` at any point. Store the `offset_ms` actually
applied on the row (or the offset-sample id) so a re-run can tell what changed
and why.

### 2.3 Roll out by consumer, not big-bang

Adding the column changes nothing on its own — no existing query reads it. Then
migrate consumers deliberately, in this order:

1. **Death dedup** (`utils/parseDeaths.js`) — the one with a proven defect
   (`RUNBOOK-death-backfill.md` §0: one death, seven observers, a 45s spread from
   one machine, displayed as two deaths). Expect the window to *shrink* after.
2. **Encounter find-or-create** — the ±30min dedup window and the sequential-kill
   splitter both reason about time across uploaders.
3. **Raid-night attribution** — a 56s error can push a kill across the 19:30
   boundary.
4. Fight timelines, threat snapshots, chat ordering.

Each step is independently verifiable against a raid night, which a big-bang
switch would not be.

### 2.4 What NOT to correct

- **`created_at` and anything else server-stamped.** Already true time.
- **PvP/`who` observations used for "was X online"** — a 40s error is irrelevant
  there and correcting adds risk for no gain.
- **Anything where the raw agent stamp IS the subject** (agent diagnostics, the
  clock-offset samples themselves). Correcting those is circular.

## 3. #203 — what to actually tell the two (three) raiders

The advice changes because of the drift finding. "Fix your clock" is wrong — they
would drift straight back at 3 s/day.

> Your machine's clock is losing about 3 seconds a day and is currently ~1 minute
> behind. That is Windows time sync being off or blocked, not a one-off. Fix:
> **Settings → Time & language → Date & time → "Sync now"**, and make sure **"Set
> time automatically"** is on. If it will not stay on, the Windows Time service
> (`w32time`) is disabled — set it to Automatic.

Three installs, not two: `6333…7023` is drifting at 0.8 s/day with no consensus
estimate ever taken. And the loose end from the runbook still stands — Fargan's
discord_id has no `characters` row, so the report names an id rather than a
person.

**By Wednesday's raid, Fargan's install will be roughly a minute off.** That is
enough to move a kill across a raid-window boundary on its own.

## 4. Open questions for Hitya

- **Do we correct history, or only from now on?** Min-lag makes historical
  correction *possible* (it can be backfilled per day). Whether it is *wanted* is
  the same judgement call as the feign cleanup (#200) — it changes numbers people
  have already seen.
- **Should the agent self-correct instead?** It could apply its own measured
  offset before uploading. Tempting, but it puts the correction where we cannot
  audit it and loses the raw stamp permanently. Recommend against; correct
  server-side where both values survive.
- **Alert threshold.** At what drift rate do we nag a raider automatically —
  and is that a Mimic toast, a Discord DM, or an officer report? The agent
  already warns its own user once at >5s absolute; a *rate* alert would catch
  these three much earlier than an absolute one.
