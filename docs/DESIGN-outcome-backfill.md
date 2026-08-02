# Outcome-driven backfill requests

**Ask (Hitya, 2026-08-02, verbatim):** *"backfill requests based on outcomes
where we have bad data would be great. if one player reported 200% of a mobs HP
was taken while others had less, we should look for the bystanders that were
there from the tick that we saw doing melee damage, ideally tanks or those that
did not die."*

Code: `utils/backfillScan.js` (pure detectors + targeting + writers),
`commands/backfillscan.js` (officer command), `test/backfill-scan.test.js`
(43 tests, fixtures are verbatim live rows).

---

## 0. What's actually broken today

`agent_backfill_requests` has worked since 2026-05-29. It has **127 rows, all
filed between 2026-06-09 and 2026-06-15, all by one officer, and 92 of them are
still `pending`.** Nothing has been filed since. It's a graveyard.

The reason is not the pipeline — the pipeline works. It's the targeting:

| | characters | ever uploaded a contribution | uploaded in the last 14d |
|---|---|---|---|
| requests that reached `acked` | 20 | **20 (100%)** | 15 |
| requests still `pending` | 58 | **8 (14%)** | 4 |

**50 of the 58 characters sitting in the pending backlog have never uploaded
anything in their lives.** They don't run Mimic. Their request will never be
acked, because nothing on their machine is polling for it. Every request that
reached a real agent got acknowledged; every request that didn't, didn't.

The requests were filed the obvious way — the `/admin/encounters` page offers
"Likely there (N) — ping all that should re-run their logs", the officer ticked
everyone, and 58 asks went out on one encounter. The reasons read
`data gap on encounter 253cc499-…`.

So this work has two halves and the second one is the one that makes it useful:
**detect from evidence, then ask two or three people who can actually answer.**

---

## 1. Detection

### 1.1 The HP pool is a real physical ceiling — and it has to be the RIGHT pool

Hitya's stated signal is damage vs the mob's health. We have that:
`eqemu_npc_types.hp`. First, is it any good?

Across **224 confirmed kills with ≥4 uploads**, the *consensus* (median upload)
divided by the catalog HP pool:

```
ratio   0.0-0.4  0.4-0.6  0.6-0.8  0.8-0.9  0.90-1.00  1.00-1.13
kills      49       45       53       31        42          4
```

The mode is **0.90–1.00** and the maximum ever observed is **1.128**
(`#Rhag`Zhezum`, 2026-05-28 — one add's damage folded into the window). The
catalog HP is essentially exact for Quarm raid targets. That makes it a genuine
ceiling and not a vibe.

**But `encounters.npc_id` is not always the body we killed.** Use
`mobSpecials.pickAndMergeMobRows()` (#171) with `zoneId = floor(npc_id/1000)`,
never the keyed row's `hp`:

| mob | keyed row | pool if you use it | real body | pool |
|---|---|---|---|---|
| Emperor Ssraeshza | `#Emperor_Ssraeshza` 162065 — **placeholder** (immune melee 19 + magic 20), AC 200 | 1,000,000 | `Emperor_Ssraeshza_` 162491, AC 700 | **1,250,000** |
| Innoruuk (PoHate) | `#Innoruuk` 76600, L55 | 32,000 | `#Innoruuk` 76007, L70 | **277,000** |

The Emperor case is not academic: the clean 25-player consensus that night was
1,180,303. Against the placeholder pool that reads **1.18×** — within shouting
distance of the gate. Against the real body it reads **0.94×**. Three npc ids in
the last 120 days resolve differently under the ladder; two of them are bosses
we kill every week.

The family query has to match the plain name, the `#`-prefixed form, **and the
one-trailing-character form** (`name.ilike.<base>_` — PostgREST `ilike` treats
`_` as a single-char wildcard), because Quarm's real Emperor body is literally
`Emperor_Ssraeshza` with a trailing space.

Where the ladder is ambiguous (four `#Innoruuk` bodies in zone 76) the ladder's
highest-level pick is also the **largest** pool, which is the conservative
direction: a bigger pool means fewer flags.

### 1.2 Signal 1 — INFLATED (the case Hitya described)

> One upload claims more damage than the mob has health **and** more than
> everyone standing next to it saw.

```
encounter has >= 4 contributions          MIN_CONTRIBS  = 4
AND  upload.total_damage >= 1.30 x hpPool  HP_RATIO      = 1.30
AND  upload.total_damage >= 1.50 x median(other uploads)   MEDIAN_RATIO = 1.50
```

**Why 1.30 on the HP pool.** The consensus has never exceeded 1.128× (§1.1).
1.30 leaves 15% headroom above anything the corpus has ever produced
legitimately. It is not a round number picked for feel — it is "outside the
observed physical range, with margin".

**Why 1.50 on the sibling median.** Distance culling means every parser sees a
*subset*, so the LOW side is normal and uninformative (Jabouti routinely uploads
6k on a 200k fight — one stray hit before he zoned). The HIGH side is the
interesting one, because a parser cannot see damage that did not happen. 1.50
sits above the widest honest spread we see (a parser whose window covers a phase
others missed lands at 1.0–1.25).

**Why both gates, always.** Measured over the whole corpus (1,661 uploads inside
encounters with ≥4 contributions):

| rule | uploads flagged | share |
|---|---|---|
| sibling median ≥1.5× alone | 357 | **21.5%** |
| HP ≥1.30× alone | — everyone, whenever the fight itself merged | — |
| **both** | **35** | **1.1%** |

The sibling gate alone is useless — a fifth of all uploads. The HP gate alone
can't tell a corrupt upload from a `find_or_create_encounter` ±30min double-kill,
because in that case *every* upload overshoots together and nobody disagrees.
The conjunction is what carries the signal, and the test suite pins both
directions.

The nearest miss in the whole corpus is Trakanon, 2026-07-30 01:03: Bardtholemu
at **2.04× the sibling median but only 1.28× the pool**. Held back by the anchor
— and correctly so: a 31-second trash kill where three of six uploads clear the
median gate is a spread, not corruption.

### 1.3 Signal 2 — THIN (the other kind of bad data)

> A **confirmed kill** whose merged damage is under 35% of the mob's health:
> nobody's log covered the fight.

```
encounter.ended_at is set                (a wipe is SUPPOSED to be short)
AND  encounter.total_damage >= 1         (no parse at all is a different problem)
AND  encounter.total_damage < 0.35 x hpPool     THIN_RATIO = 0.35
```

Lower priority than INFLATED — nothing is *wrong*, we're just missing most of it
— but it's the case where a backfill genuinely **adds** data instead of
adjudicating between two claims, and it keeps the feature useful on nights with
no corruption. 0.35 is far outside the legitimate band (mode 0.90–1.00) and
lands at **0–3 per night, median 1**. This is the same condition
`utils/raidReview.js` already marks with a `*` ("only a partial parse reached us
for this one") — now it can do something about it.

### 1.4 Signals considered and rejected

- **Player-count outlier.** Perfectly correlated with the damage signal in
  practice (all 40 flags at the looser 1.25 threshold also had an above-median
  player count), so it adds nothing as a gate. **Kept as display** on the officer
  preview — "35 players named vs 21 consensus" is the line that makes the
  diagnosis obvious to a human.
- **"Names nobody else saw" (ghost players).** Looked promising and isn't. On
  Hawkner's Blood upload 13 of 35 names appear in no other contribution — but
  that's just what a *wider view* looks like, and a wider view is a virtue. Not a
  gate; worth surfacing as a detail if the officer preview ever grows.
- **Duration outlier.** Real (the over-long session blobs: 1,739s next to a 634s
  cluster) but already handled — `merge_encounter_players`'s duration-clean gate
  drops them. Re-flagging them would ask for logs we don't need.
- **Encounter-level "consensus itself overshoots".** Defined but would have
  fired **zero times** in 10 weeks (max consensus ratio 1.128). Left out; the
  observation that it never fires is itself the evidence that the corpus is
  healthy at the consensus level and that the problem is per-uploader.

---

## 2. Targeting — who do we ask?

Hitya's three criteria, ordered by how hard they are to fake, plus two gates
that have nothing to do with the fight.

### Hard gates (fail any → not a candidate, no score)

1. **Present on the consensus parse** (`encounter_players`).
2. **Proven in range**: ≥20 melee-verb hits on the target
   (`encounter_combat_rollup.by_skill` — `hit/slash/kick/bash/pierce/crush/
   punch/backstab/slice/bite/claw/strike/maul/smash/gore/rend`, excluding
   `non-melee`, `ds:non-melee`, `pet` and literal spell names) **or** ≥10
   defender hits taken from it. You cannot melee a mob you were culled away
   from — this is a positional proof, not a guess. A single stray proc doesn't
   qualify.
3. **Actually runs the agent** — uploaded *something* in the last 14 days. This
   is the gate the 92-row backlog didn't have. §0.
4. **Didn't already upload this fight** — their log is already in; we'd learn
   nothing.
5. **Not the suspect**, not `exclude_from_stats`, not already holding an open
   request for this same `start_iso`.

### Score (rank among the survivors)

| points | signal | why |
|---|---|---|
| +40 | ≥20 melee swings on the target | in melee range, sustained |
| +25 | observed for ≥60% of the fight | a log that starts halfway can't adjudicate the first half |
| +20 | Warrior / Paladin / Shadow Knight | Hitya's "ideally tanks" — they stand in the middle of everything |
| +15 | took ≥2,000 damage from the mob (`raw_parse.defenders`) | actually tanked it, not just near it |
| +10 / −25 | never died / died | Hitya's "those that did not die" — a corpse stops seeing the fight |

Ties break on melee hits, then damage taken, then name — so two runs of the same
scan ask the same people. Deaths come from `dedupParseDeaths()`
(`utils/parseDeaths.js`, the #134 phantom-namesake rule) — reused, not
re-derived, so an NPC called "Syphon" can't disqualify the raider called Syphon.

### What it picks on the real incident

Blood of Ssraeshza, 2026-07-30, suspect Hawkner:

| rank | who | class | melee hits | def hits | took | died | runs agent |
|---|---|---|---|---|---|---|---|
| 1 | **Ashieron** | Paladin | 82 | 140 | 20,231 | no | yes |
| 2 | **Peopleslayer** | Warrior | 76 | 30 | 15,325 | no | yes |
| 3 | **Abrahms** | Paladin | 53 | 80 | 12,997 | no | yes |
| — | ~~Currygoat~~ | Warrior | 358 | 153 | 40,244 | no | **no** |

Currygoat was the **main tank** and by every combat measure the best possible
witness — and he is correctly dropped, because he has never uploaded a
contribution. Asking him would have produced pending row #93. (The test asserts
both halves: that he's excluded, and that he'd rank first if he ran the agent.)

Emperor, suspect Bardtholemu → Peopleslayer (1,589 melee swings, 1,492 defender
hits, 735k damage taken — he tanked the whole 18 minutes), Naggato, Ashieron.
Rhag`Mozdezh, suspect Uilnayar → Kurp, Jankzer, Fittir.

### Volume caps

`MAX_ASKS_PER_FINDING = 3` · `MAX_ASKS_PER_SCAN = 8` ·
`MAX_ASKS_PER_PERSON = 2`. INFLATED findings are served before THIN, worst
severity first, so the cap is spent on the worst data. One finding per fight.

---

## 3. The request

Reuses `agent_backfill_requests` verbatim — no new table, no new endpoint, no
new agent code. Rows land in the target's own agent dashboard 📋 banner via the
existing `GET /api/agent/backfill-requests` / `/poll` bundle.

`scope.start_iso` is the encounter's `started_at` **verbatim**. That is the key
the unique index `(guild_id, character, scope->>'start_iso')` collapses on AND
the exact string `/admin/encounters` matches to grey out "already pinged" — so a
scan re-run, and an officer's manual filing for the same fight, cannot
double-ask. `end_iso` is `start + max(duration + 5min, 10min)` (the manual form
uses a flat 10 min, which truncates an 18-minute Emperor). `scope.source =
'outcome-scan'` and `scope.signal` carry provenance; the agent ignores both.

### Copy

The agent card renders `reason` verbatim, ≤300 chars. Three rules:

- **Never name the over-reporting uploader.** Every incident of this class has
  been a *parser* bug — stale `state.petOwners` residue, a Finishing Blow line,
  an over-long session blob. Putting a raider's name next to "the numbers are
  wrong" turns a data chore into an accusation. The suspect isn't in the text
  and isn't in the ask list.
- **Say why THEY were picked.** The top scoring reason goes in the sentence, so
  it reads as "you had the best view" rather than "you're on a list".
- **Say nobody is in trouble.** Explicitly.

> **INFLATED** — *"We think the Blood of Ssraeshza parse from Thu, 30 Jul is off
> — one upload reports more damage than the mob has health, and the others
> disagree. You were in melee on it (82 melee swings on it), so your log would
> settle it. Nobody's in trouble — we're chasing a parser bug."*

> **THIN** — *"We only got a partial parse for Terror on Thu, 30 Jul — most of
> the fight's damage never reached us. You were in on it (76 melee swings on
> it), so re-running that log would fill the hole. Nothing you did wrong!"*

Compare the incumbent: `data gap on encounter 253cc499-193c-450e-b34d-…`.

---

## 4. The 92 stale rows

**Do not delete them.** They're the audit trail of how this went wrong, and
they're the evidence in §0.

**Proposal: a new terminal status `expired`.** No migration needed — `status` is
free text, and the agent's poll filter is already
`status=in.(pending,acked,running)`, so an `expired` row silently stops being
served with zero code change on either side.

Rule (`expirySweepIds`, `EXPIRY_HORIZON_DAYS = 45`): an open request whose **log
window** (`scope.end_iso`, falling back to `start_iso`, then `requested_at`) is
more than 45 days old is retired with
`dismissed_reason = 'auto-expired: log window older than 45 days'`. The horizon
is on the *log*, not the filing date — a request filed today against a
two-month-old fight is equally unhonourable, because `eqlog_*.txt` has rolled
and most users have deleted it.

All 127 rows (92 pending + 35 acked, windows dated 2026-06-08) clear that
horizon today.

**How it runs:** `/backfillscan expire:true`, officer-triggered, never automatic.
The scan's preview always *reports* the count ("127 open requests are past the
45-day log horizon — run with `expire:true` to retire them") so it's visible
without being done to you.

**One-off SQL, for a local session / officer to run — NOT applied here:**

```sql
-- Retire the 2026-06 backfill backlog. Status-only; nothing is deleted.
update agent_backfill_requests
   set status = 'expired',
       dismissed_at = now(),
       dismissed_reason = 'auto-expired: log window older than 45 days'
 where guild_id = 'wolfpack'
   and status in ('pending','acked','running')
   and coalesce((scope->>'end_iso')::timestamptz,
                (scope->>'start_iso')::timestamptz,
                requested_at) < now() - interval '45 days';
```

The *root cause* fix is the §2 hard gate: never file at a character with no
upload history. That's what stops backlog #2.

---

## 5. Why officer-triggered, and not automatic

**Chosen: `/backfillscan`, preview by default, no timer, no midnight-chain hook,
no DM.** Automatic filing is deliberately left unwired pending Hitya's sign-off.

Reasoning:

- The task brief is explicit that an automatic system that reaches raiders needs
  Hitya's sign-off before it fires. Officer-triggered is the version that can
  ship today and be reviewed by watching it, not by arguing about it.
- Nothing here DMs anyone even when applied — delivery stays pull-based into the
  target's own agent dashboard, exactly as officer-filed requests have always
  worked. That keeps the blast radius of an early mistake at "a card appears on
  someone's localhost page".
- The detector is new. Running it in preview for a few raid weeks costs nothing
  and produces the evidence needed to decide whether it should fire on its own.
- Every threshold is tuned on 10 weeks of one guild's data. That's enough to
  defend a number, not enough to defend an unattended writer.

**If it graduates**, the hook is one line next to
`scheduleRaidNightReview(client)` in the midnight chain (`index.js`), using the
same `nightWindowFor` window so a scan and a review always cover exactly the
same set of fights — plus an `OUTCOME_BACKFILL=0` kill switch matching
`RAID_REVIEW=0`. Gate the caps down (`MAX_ASKS_PER_SCAN` 8 → 4) before doing it.

### Command

```
/backfillscan [date] [apply] [expire]
```

Officer-only. `date` defaults to the most recent finished night (same
rollover-to-rollover window as `/raidreview`). Without `apply` it prints what it
found and who it *would* ask, with a "Preview only" footer.

---

## 6. Validation — 2026-07-30, the night the incident happened

13 encounters, 118 uploads. Uploads are scored in their **as-uploaded** form
(the repaired rows keep the originals under `raw_parse.players_pre_petfix`).

| time | mob | uploads | worst hp× | worst median× | flagged |
|---|---|---|---|---|---|
| 00:40 | a glyph covered serpent | 1 | 1.00 | — | |
| 00:45 | Vyzh\`dra the Exiled | 16 | 0.96 | 1.00 | |
| 00:48 | Vyzh\`dra the Cursed | 16 | 0.97 | 1.05 | |
| 00:58 | Rhag\`Zhezum | 13 | 0.98 | 1.26 | |
| **01:05** | **Rhag\`Mozdezh** | 14 | **1.69** | **1.74** | **Uilnayar** |
| 01:25 | Arch Lich Rhag\`Zadune | 13 | 1.08 | 1.09 | |
| 01:40 | Xerkizh The Creator | 19 | 0.98 | 1.01 | |
| 01:53 | Terror | 12 | 0.29 | 1.15 | *(thin)* |
| 01:59 | High Priest of Ssraeshza | 1 | 0.99 | — | |
| **02:35** | **Blood of Ssraeshza** | 7 | **1.90** | **2.38** | **Hawkner** |
| **02:42** | **Emperor Ssraeshza** | 13 | **2.44** | **2.61** | **Bardtholemu** |
| 03:26 | Ashenbone Broodmaster | 1 | 0.00 | — | *(thin)* |
| 03:35 | Lord of Ire | 2 | 0.77 | 1.73 | |

**Exactly the three uploads named in the `state.petOwners` ledger entry, and
nothing else.** No tuning was done to make that happen — the thresholds come
from the 10-week distribution in §1, not from this night.

Two details worth noting:

- **Lord of Ire** clears the median gate (1.73×) and is correctly *not* flagged:
  0.77× the pool, and only 2 uploads. Both the anchor and `MIN_CONTRIBS` do work
  here.
- The nearest non-flagged fight on the night sits at **1.08× pool / 1.26×
  median**. The flags start at 1.69/1.74. That's a gap, not a hairline.

### False-positive rate over the whole corpus

3,281 contributions / 1,494 encounters, 2026-05-28 → 2026-08-02:

| threshold pair (hp×, median×) | uploads flagged | encounters |
|---|---|---|
| 1.15 / 1.5 | 50 | 46 |
| 1.25 / 1.5 | 40 | 37 |
| **1.30 / 1.5 (shipped)** | **35** | **33** |
| 1.40 / 1.5 | 32 | 30 |
| 1.50 / 1.5 | 27 | 25 |

Per raid night over the last 42 nights: **24 nights flag nothing at all**,
median 0, mean 0.8, max 4. A detector that fired on every fight would be
useless; this one is quiet on more than half of all raid nights.

The 35 historical flags are not noise either — the pre-July cluster
(`Moash` 9.7×, `Chadivarius`/`Ashaiya` 63× on one King Tormax, `Squeekie` 7.7×)
is the finishing-blow / session-blob over-count class that
`merge_encounter_players`'s median rewrite (2026-07-14) and agent 3.3.32 were
written to survive. The detector finds that class too, without being told about
it.

---

## 7. Retention note (why the scan wants a RECENT night)

`contributions.raw_parse` is nulled by the midnight compaction after 7 days, so
`defenders` / `deaths` / per-player durations only exist for recent nights.
`encounter_combat_rollup` is **not** compacted (100% coverage over 30 days,
34,476 rows back to 2026-05-31), so the melee-presence proof survives, and
detection itself only needs the durable columns (`contributions.total_damage`,
`player_count`) — it works over the entire history.

Targeting degrades gracefully on an old night: no defender data means no tank
bonus and no "took N from it", so the ranking falls back to melee hits + class +
alive. Which is fine, because by then the raider's `eqlog_*.txt` has usually
rolled anyway — the same reason `EXPIRY_HORIZON_DAYS` exists.

---

## 8. Files

| file | what |
|---|---|
| `utils/backfillScan.js` | thresholds, `resolveHpPool`, `findInflated`, `findCoverageGap`, `rankAskCandidates`, `requestReason`, `buildRequestRows`, `expirySweepIds`, `renderScanEmbeds`, `collectScanData`/`analyzeScanData`/`scanWindow`, `applyProposals`/`expireStale` |
| `commands/backfillscan.js` | `/backfillscan [date] [apply] [expire]`, officer-gated, preview by default |
| `test/backfill-scan.test.js` | 43 tests; fixtures are the verbatim 2026-07-30 night, the real Emperor name-family rows, and the real Blood bystander data |

Nothing in `index.js`, the agent, or the web changed. The scan is additive and
inert until an officer runs it.
