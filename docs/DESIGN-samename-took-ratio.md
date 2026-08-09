# Same-name mobs: the damage-TAKEN ratio discriminator

**Status:** measured against real twin-add data, not built.
**Measured:** 2026-08-06, live Vex Thal raid, encounter
`7dfe09b3-54bc-4be8-8f28-94dddffc0453` (`Thall_Va_Xakra`, 01:09, 328 snapshots).
**Supersedes nothing** — this is a SECOND, independent signal that stands beside
the position clustering in `docs/DESIGN-fight-timeline.md`/#194, and unlike that
one it needs no Zeal, no position, and no spawn id.

## What the twins actually are

Corrected on the spot by Hitya: the same-name pair is **`Va Xakra`**, and they
spawn *with* `Thall Va Xakra`. The boss is a different name, so the ambiguity is
between the two adds, not with the boss.

| catalog row | id | HP | dmg | raid_target |
|---|---|---|---|---|
| `Thall_Va_Xakra` | 158136 / 158465 | 900,000 | 285–950 | true |
| `Va_Xakra` | 158006 | 28,000 | 222–432 | false |
| `Va_Xakra` | 158086 | 60,000 | 115–400 | false |

The adds are small, which is why the twin phase in the data lasts only ~20–35s
before it becomes a single-boss fight. **Any test for this has to work on a
short window** — it cannot need minutes of evidence.

## The signal

`encounter_threat_snapshots.per_player[].took` is cumulative damage TAKEN per
player, snapshotted every 3.5–6.4s and **durable back to 2026-07-02**. Difference
it per bucket and ask who was being hit.

Measured, 5-second buckets, encounter `7dfe09b3`:

```
sec  concurrent  who (damage taken this bucket)
 10      1       Hawkner:1668
 15      1       Hawkner:1163
 20      2       Atlasius:1622   Hawkner:1362      ← TWO ADDS
 30      2       Hawkner:1402    Atlasius:1055     ← TWO ADDS
 35      1       Atlasius:388
 40      5       Abrahms:2190  Syphon:495  Gyik:310  Atlasius:299  Hawkner:266
 65      3       Abrahms:5396  Syphon:1556  Currygoat:821
 90      3       Abrahms:4325  Syphon:990   Currygoat:821
120      3       Abrahms:3835  Syphon:1445  Currygoat:821
```

## Why the OBVIOUS version of this fails

"Count how many people took damage this bucket" gives **5** at t=40s — and that
is one AE, not five mobs. Raw concurrency is not the signal. It was the first
thing I reached for and the data killed it immediately.

## The rule the data actually supports

Two mobs ⟺ **the second-highest taker is COMPARABLE to the highest, sustained
across ≥2 consecutive buckets.**

| bucket | 2nd ÷ 1st | verdict |
|---|---|---|
| 20s | 1622 → 1362 = **1.19** | two mobs |
| 30s | 1055 → 1402 = **0.75** | two mobs |
| 40s | 495 ÷ 2190 = 0.23 | one mob + AE |
| 65s | 1556 ÷ 5396 = **0.29** | one mob + splash |
| 90s | 990 ÷ 4325 = **0.23** | one mob + splash |
| 120s | 1445 ÷ 3835 = **0.38** | one mob + splash |

A threshold around **0.5, sustained ≥2 buckets**, separates every twin bucket
from every boss bucket in this fight with clear daylight on both sides. Tune it
from the backtest below rather than from this single fight.

Intuition for why it holds: two mobs each beat on their own tank at their own
rate, so the rates are of the same order. One mob has ONE melee target at a time;
everyone else's `took` is rampage/AE spatter, which is structurally smaller.

## Why this is worth more than the position heuristic

- **No Zeal, no position, no spawn id.** Works for a tank running nothing, and
  for a mob tanked by a charmed PET (which the position path cannot place at all
  — the pipe carries no pet location).
- **Immune to the two failure modes that bit us on 2026-08-05:** a large mob's
  melee range (`ext_pos_cluster_units` flat 25 was far too small for Kaas Thox Xi
  Ans Dyek), and observer HP staleness manufacturing phantom bands.
- **Backtestable before shipping.** 36,784 fights of `took` history exist. Run
  the rule over all of them, look at where it fires, and tune the threshold on
  evidence. The position heuristic never had that luxury — it shipped on a guess
  and had to be kill-switched mid-raid.

## Known problems to solve first

**The repeated `821`.** Currygoat shows a delta of exactly `821` at 45s, 65s, 90s
AND 120s. Real damage does not produce four identical deltas. That is almost
certainly a stale value being re-counted (a snapshot re-sent, or an uploader
whose counter froze), and it would corrupt any ratio test that treats it as a
live stream. **Understand this before trusting the signal** — the fix is probably
to ignore a delta identical to the previous non-zero delta from the same player,
or to dedup uploaders at read time.

**Multi-uploader dedup.** Several uploaders snapshot the same fight; the query
above takes `max(took)` per (character, bucket), which is the
`merge_encounter_players` idiom. Keep that.

**Rampage exclusion already exists** in `recentTankHits` but NOT in `took` —
`took` counts every point of damage taken including rampage. That is fine for
this test (the ratio absorbs it) but must not be forgotten if the rule is
tightened later.

## Build order

1. **Backtest offline.** Run the rule over all 36,784 historical fights. Report:
   how many fights ever trip it, on which mob names, and whether the twin-add
   encounters we know about (Va Xakra, and the same-name Vex Thal adds) light up.
   No shipping until this looks sane.
2. **Solve the repeated-delta anomaly** — it will show up loudly in step 1.
3. **Emit K from it** in the extended-target path as an INDEPENDENT vote beside
   position clustering. Two agreeing signals should raise confidence; disagreement
   should stay conservative (merge, do not split) exactly as today.
4. Only then reconsider `flag_ext_pos_off`.

## Adjacent live findings from the same session

- **Zeal `/tag` capture WORKS** — six uploaders independently captured
  `{mob: "Thall Va Xakra", text: "KILL AND SLEEP", tagger: "Melting", spawn_id: 360}`.
  The spawn id is real and arriving. **But the tag expires in 120s**
  (`_TAG_FRESH_MS`, and the bot's `ext_tag_fresh_sec` matches), while a boss
  fight runs 5–10 minutes. A tag is a deliberate, fight-long mark; expiring it at
  2 minutes throws away the only field that carries true mob identity for most of
  the encounter. **Raise both.**
- **Clock skew is real and unapplied.** Fargan's uploader carries
  `offset_ms = 59224` — 59.2 seconds, 213 pulse samples. Against a 90s DI recast
  that alone explains a DI reading ready ~59s early. We MEASURE this and never
  APPLY it (STATUS "Apply clock offset at ingest, keep raw", still pending).
- **Observer HP spread is staleness, not disagreement.** Same mob, same moment:
  3.0 points of spread across observers ≤28s old, but 16.0 points once 79s-old
  rows are included — against an `EXT_HP_SPLIT_TOL` of 8. The HP bander needs a
  freshness gate on the reading, not just a tolerance.
