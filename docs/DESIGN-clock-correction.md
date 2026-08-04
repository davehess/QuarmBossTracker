# DESIGN — applying the clock offset (#202), and the drift problem (#203)

*Written 2026-08-04 (overnight design pass). Unbuilt — design mode, per the
standing instruction. Companion to `RUNBOOK-death-backfill.md`, which shows why
this matters; this is how to actually do it.*

**The headline, and it is worse than we thought on 2026-08-03:**

> The skewed clocks are **not set wrong once. They drift continuously at
> ~1.5–3 s/day — and when someone manually corrects one, it drifts right
> back.** Fargan's install has been sliding uninterrupted for **at least a
> month** (7.5s on Jul 8 → 56.5s on Aug 4, never once corrected).
> Bardtholemu's was synced to ~0 on **Jul 26–27** — we can see the reset in the
> data — and was 11s off again within two days. A single stored `offset_ms`
> per install is therefore wrong within a week of being measured, and the
> design has to account for that rather than store a scalar.

*Re-verified the morning of 2026-08-04, against two independent streams — see
§1a.*

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
| `6333…7023` (**Stupidrichard**/Calador/Tildias) | 4,591 | **3.3s** | **none — never measured** |
| every other install (18) | — | ≤ 1.8s | ≈ 0 |

Two things fall out:

- **Coverage.** `6333…7023` has 4,591 rows and a real (small, growing) skew, but
  **no consensus row at all** — consensus needs a death with 3+ witnesses, and
  this uploader never contributed to one. Min-lag covers every uploader that
  writes any row. (And this one matters: **Stupidrichard is one of the four
  clerics Uilnayar named for the DI callout roster** — that machine's callout
  and cast timestamps are ~7s off.)
- **The estimators disagree for Bardtholemu** (10.2 vs 14.0), and min-lag ought
  to be ≥ the true skew. That is not a contradiction once you look at drift.

### 1a. Cross-stream verification (run 2026-08-04 morning — this is the proof)

Clock skew must appear **identically** in every stream that carries an agent
log-timestamp; pipeline latency will not, because the streams flush through
different paths. Computing per-day min-lag independently from `buff_casts` and
`chat_messages`:

**the two streams agree within 0.1–0.4s on every single day, for all three
installs** (e.g. Fargan Aug 4: buff 56.4 / chat 56.5; Bardtholemu Aug 3:
22.3 / 22.4). That agreement is the clock-vs-latency discriminator, and it
came back unambiguous.

### The drift, 30 days (chat stream, per-day min-lag, backfill-days > 300s excluded)

| | Fargan `2722…` | Bardtholemu `1706…` | Stupidrichard `6333…` |
|---|---|---|---|
| early Jul | 7.5 (Jul 8) | **−0.1 (Jul 6 — fine)** | 0.2–1.8 (fine) |
| mid Jul | 15.5 → 22.9 (Jul 13–18) | 9.4 → 16.5, dips to 3.9 on Jul 13 | fine until Jul 18 |
| Jul 20–25 | 26.0 → 32.4 | 23.6 → **39.3** | 2.5 → 5.9 |
| **Jul 26–27** | (no data) | **1.0 / −0.2 — MANUALLY SYNCED** | ~1.4 on Jul 25 — synced |
| Jul 29–31 | 43.8 | **11.4 — drifting again** | 2.7 → 5.0 |
| Aug 3–4 | 48.8 → **56.5** | 22.4 | 7.4 |

Three different machines, one story:

- **Fargan:** ≥ a month of uninterrupted drift, **never corrected once**.
  Long-run rate ~1.6 s/day, but the last day jumped **+7.7s** (confirmed on
  both streams, so it is real, not sampling) — consistent with sleep/hibernate
  drift or a failing RTC, i.e. it may be getting worse.
- **Bardtholemu:** drifts ~3 s/day, was **manually synced to correct on
  Jul 26–27, and was 11s off again by Jul 29**. We have now *watched* a
  one-time "fix your clock" fail on this machine. This is the direct evidence
  behind §3's advice.
- **Stupidrichard's machine:** same cycle at ~0.8 s/day — fine until ~Jul 18,
  drifted to ~6s, corrected ~Jul 25, drifting again, now ~7s.

The reset days are also a free calibration: when Bardtholemu's clock was
correct, min-lag read **−0.2 to 1.0s** — so the pipeline-latency floor in this
estimator is ≈ 0–1s, and min-lag ≈ true skew to within a second.

**Control** (the other 18 installs with volume, last 4 days): every one sits
between **−2.9s and +1.8s**. So this is **per-machine clock drift on exactly
three machines, not a global upload slowdown** — which is the alternative
explanation the control exists to kill.

### The pulse estimator is now live and agrees

First working 3.5.15 install (Hitya's) began heartbeating the morning of
2026-08-04: `pulse` offset **+0.4s** (1,772 samples, spread 1.7s) vs that
install's consensus estimate **−1.3s**. Both ≈ 0, agreeing within the spread —
the third estimator cross-checks the other two on the first machine to run it.

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
event's own timestamp**, interpolating between samples — **but never across a
step**. The 30-day history shows manual sync events (Bardtholemu Jul 26–27:
39s → 0 overnight); interpolating across that discontinuity would smear a
20s error over two days of events. Treat a day-over-day change beyond ~5s as
a step: use the nearer side, don't average. Keep the existing
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

## 3. #203 — what to actually tell the three raiders

The advice changes because of the drift finding. "Fix your clock" is wrong — and
this is no longer a prediction: **Bardtholemu's machine was synced on Jul 26–27
and was 11 seconds off again two days later.** A one-time sync provably does not
hold on these machines.

> Your machine's clock is losing seconds every day (one install is ~a minute
> behind and has been sliding for over a month). That is Windows time sync
> being off or blocked, not a one-off. Fix: **Settings → Time & language →
> Date & time → "Sync now"**, and make sure **"Set time automatically"** is on.
> If the offset comes back within a few days, the Windows Time service
> (`w32time`) is disabled or losing to another sync tool — set it to Automatic.

The three installs:

| machine | current | history |
|---|---|---|
| Fargan's (`2722…6416`) | **~56s behind** | ≥ a month of drift, never corrected; last day jumped +8s |
| Bardtholemu's (`1706…9824`) | ~22s behind | synced Jul 26–27, drifting again since |
| **Stupidrichard's** (`6333…7023`) | ~7s behind | synced ~Jul 25, drifting again — and he is on the DI callout roster |

The loose end from the runbook still stands — Fargan's discord_id has no
`characters` row, so automated reports name an id rather than a person.

**By Wednesday's raid, Fargan's install will be roughly a minute off** (more if
the recent +8s/day rate holds). That is enough to move a kill across a
raid-window boundary on its own.

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
