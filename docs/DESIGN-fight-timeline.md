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

**2. The snapshots are not bound to encounters.** 489,844 of 490,850 rows have
`encounter_id IS NULL`; only 1,069 are bound. They carry `boss_name` +
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

## Deliberately NOT in scope

- Per-ability breakdown inside the curve. `by_skill` lives in
  `encounter_combat_rollup` and is aggregate-per-fight, not time-sliced; adding
  it here would need a third capture change for a question nobody has asked yet.
- Healing lanes. `heal`/`healRaw` are in the payload and could support a healer
  view later, but the ask is a damage timeline.
