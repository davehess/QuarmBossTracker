# Fight timeline v2 — boss HP curve + MT/RAMP lanes + class filtering

**Status:** designed, not built. Data audit done 2026-08-06 against live Supabase.
**Ask:** Uilnayar 2026-08-06 (napkin sketch) — "retool the timeline … capture the
parse's damage timeline and who is main tank or rampage throughout the fight,
then allow us to highlight sections of the damage meter by class(es), toggleable
via some classes on the side, or have a search list with all of the damage
dealers from the raid to see where they were in that."

## The sketch

```
100 ┤╲                                   Y = boss HP %
 75 ┤ ╲░░░░░░░░                          shaded area = damage contribution
 50 ┤   ╲░░░░░░░░░░░░                     (stacked, filterable)
 25 ┤     ╲░░░░░░░░░░░░░░╱╲
  0 ┤                      ╲___
    └────────────────────────────  X = fight time
MT   ├──────── Abrahms MT ────────┤       swimlane: who held MT, when
RAMP ├─ Syko ─┼─── Hitya ───┼ Syko ┤      swimlane: who was rampage target
```

## What we ALREADY have (measured, not assumed)

`encounter_threat_snapshots` — **490,850 rows, 36,784 distinct fights, 100 bosses,
back to 2026-07-02.** One row per uploader per tick, `per_player` jsonb keyed by
character:

```json
{"Abrahms": {"dmg":333,"swing":333,"spell":0,"proc":0,"heal":0,"healRaw":0,
             "took":3611,"tookMax":1200,"pet_owner":null,"procDetail":{}}}
```

Values are **cumulative within the fight**, so per-interval damage is a
first difference between consecutive snapshots.

Cadence measured on last night's fights:

| fight | snapshots | span | interval |
|---|---|---|---|
| Diabo Xi Xin Thall | 736 | 43m | **3.5s** |
| Kaas Thox Xi Ans Dyek | 563 | 60m | **6.4s** |

That resolution is far finer than the sketch needs.

This gets us, with NO new capture:

- **The area chart** — `per_player[n].dmg` differenced per interval, stacked.
- **Class colouring / filtering** — join `characters.class`; `pet_owner` is
  already on every row so pets fold under their owner.
- **The MT lane** — `took` is cumulative damage taken per player. Whoever's
  `took` rises fastest across an interval is who the boss is hitting. The lane
  is the argmax of Δ`took` per interval, run-length-encoded into segments.
  `tookMax` (largest single hit) is a useful tiebreaker and tooltip.
- **The HP curve** — two independent sources: `target_observations.target_hp_pct`
  (a real observed series, but only since 2026-08-04 and sparser), or
  cumulative `total` damage against the NPC's max HP from `eqemu_npc_types`.
  Prefer observed, fall back to derived, and say which on the axis.

## What is MISSING (two gaps, both small)

**1. Rampage is not in the payload.** The threat tracker already computes it —
`_bumpDefender(def, 'rampageDmg', …)` — but `rampageDmg` is not among the keys
serialised into `per_player`. Without it the RAMP lane can only be guessed
(second-fastest `took` riser), which is exactly the kind of inference this
platform keeps getting burned by. **Add `ramp` to the snapshot payload** — one
field, agent-side, no schema change (it is jsonb).

**2. The snapshots are not bound to encounters — HISTORICALLY.** 489,844 of
490,850 rows have `encounter_id IS NULL`; only 1,069 are bound.

> **CORRECTION, measured live 2026-08-06 03:26 during the Vex Thal raid.** That
> ratio describes the BACKLOG, not the live pipeline — which already binds.
> Four of the last five fights bound hundreds of snapshots each:
>
> | encounter | npc | duration | players | bound snaps |
> |---|---|---|---|---|
> | 6518d6e2 | 158441 | 535s | 42 | **387** |
> | 3aae7afe | 158464 | 510s | 41 | **0** ⚠ |
> | 5f29124d | 158436 | 306s | 39 | **137** |
> | 0efbf21c | 158446 | 358s | 39 | **184** |
> | fda97834 | 158440 | 517s | 36 | **277** |
>
> So the read-time window join is a BACKFILL tool, not the mechanism. Do not
> build the live path around it.
>
> ⚠ **Open anomaly:** `3aae7afe` bound ZERO while its neighbours bound hundreds
> — a real 510s fight with 41 players and 1.34M damage. npc 158464 is one of the
> two duplicate `Kaas_Thox_Xi_Aten_Ha_Ra` rows in the catalog (158437 / 158464),
> which may or may not be related. Worth chasing before trusting binding
> unconditionally. They carry `boss_name` +
`started_at` instead, so a fight is addressable as `(boss_name, started_at)` and
joinable to `encounters` on an overlapping window — the same ±window idea
`find_or_create_encounter` already uses. Two options:

- bind at ingest (bot writes `encounter_id` when it can resolve one), and/or
- a read-time view `encounter_timeline` doing the window join.

Do BOTH: the view unlocks all the history we already hold; the ingest binding
keeps new rows cheap to query.

Note `boss_name` is NULL on trash snapshots — that is correct and those rows are
simply not fights.

## Build order

1. **Agent** — add `ramp` to `per_player`. Beta. (The value already exists.)
2. **Bot** — resolve `encounter_id` at threat-snapshot ingest.
3. **Migration** — `encounter_timeline` view: window-join snapshots to encounters,
   difference the cumulative counters, emit tidy
   `(encounter_id, t_sec, character, dmg_delta, took_delta, ramp_delta)`.
   Differencing in SQL keeps the page from shipping 736 jsonb blobs to a browser.
4. **Web** — the chart on `/parses/[id]`, replacing the current timeline.

## Open decision for Hitya/Uilnayar

The sketch says class toggles *or* a searchable damage-dealer list. These are
different interactions and both are cheap once the tidy series exists:

- **Class toggles** answer "where did the rogues do their damage?"
- **Player search** answers "where was *Wabumkin* in this fight?"

Recommend shipping BOTH against one selection model — a set of highlighted
characters, with class buttons as bulk selectors over that set. One highlight
mechanism, two ways to fill it, no second code path.

## Long-term storage — the two-tier model (measured 2026-08-06)

Uilnayar: "can we come up with a longterm storage model that would shrink this
but still maintain that sort of timeline view?" Yes, and the numbers are lopsided
enough that the answer is easy.

### Where it stands today

| | |
|---|---|
| `encounter_threat_snapshots` | **411 MB**, 491,365 rows, **876 B/row** |
| growth | ~80k rows + ~65 MB **per week** → **~3.4 GB/year** |
| encounters that exist, EVER | **1,531** (200 in the last 35 days) |

Half a million snapshot rows exist to describe fifteen hundred fights. The table
grows with WALL-CLOCK TIME — it snapshots whether or not anything is happening —
while the thing we want to look at grows with FIGHTS. That mismatch is the whole
problem, and it is what makes this fixable.

### Measured on one real fight

Kaas Thox Xi Ans Dyek, 2026-08-06 00:38:03, rolled to 5s buckets:

| form | rows | size | vs raw |
|---|---|---|---|
| raw snapshots (jsonb, cumulative) | 609 | 275 kB | — |
| one row per character, cumulative arrays | 10 | 39 kB | **7.2×** |
| one row per character, **delta** arrays | 10 | **19 kB** | **14.5×** |

And the number that decides the encoding: **4,908 of 4,928 delta buckets are
ZERO**. The series is 99.6% empty, because a fight record spans a long window in
which any given player acts in a handful of buckets. Dense arrays of mostly-zero
are the wrong shape; a sparse `(idx[], val[])` pair goes far below the 19 kB
above. (Note `pg_column_size` on these arrays reports the INLINE size — they sit
under the ~2 kB TOAST threshold, so on-disk compression is not yet helping. That
is an argument for sparsity, not against it.)

### The model

**HOT — `encounter_threat_snapshots`, unchanged.** It feeds the live overlays and
must stay exactly as it is. Add **retention only: 14 days.** Steady state
becomes ~156k rows / ~130 MB and stops growing. This one change caps the biggest
table on the platform.

**COLD — `encounter_series`, one row per `(encounter_id, character)`**, written
once when a fight closes:

```
encounter_id, character, pet_owner,
t0            timestamptz,   -- fight start
step_sec      smallint,      -- 5
dmg_idx  int[],  dmg_val  int[],   -- sparse: bucket index + delta
took_idx int[],  took_val int[],
ramp_idx int[],  ramp_val int[]
```

A fixed step means **no timestamps are stored at all** — bucket `i` is
`t0 + i*step`. That alone removes 8 bytes per point, and it makes the chart's
x-axis arithmetic instead of a join.

Rules at roll-up time:
- **Only encounters.** Snapshots that never bind to an encounter are trash and
  are never archived — they simply age out of the hot tier.
- **Dedup uploaders.** Several uploaders snapshot the same fight (Diabo Xi Xin
  Thall had 2). Merge to one canonical series, max-per-player-per-bucket — the
  `merge_encounter_players` idiom, reused rather than reinvented.
- **Deltas, not cumulative.** 2× on its own, and it makes the sparse encoding
  possible (a cumulative series has no zeros to drop).

### What this buys

~2,100 encounters/year × ~20 kB dense (far less sparse) ≈ **40 MB/year**, against
**3.4 GB/year** today — and the cold tier is the ONLY thing the timeline reads,
so the view gets faster as well as smaller. Growth becomes proportional to fights
fought rather than hours elapsed, which is the property that actually matters for
a guild that raids three nights a week.

### Order to build it

Retention on the hot tier FIRST — it is one policy, needs no new code, and stops
the bleeding immediately. Roll-up and the cold table next. **Do not delete
anything before the roll-up is verified against the raw rows for the same
fight**; the raw data is the only copy until then.

## Deliberately NOT in scope

- Per-ability breakdown inside the curve. `by_skill` lives in
  `encounter_combat_rollup` and is aggregate-per-fight, not time-sliced; adding
  it here would need a third capture change for a question nobody has asked yet.
- Healing lanes. `heal`/`healRaw` are in the payload and could support a healer
  view later, but the ask is a damage timeline.
