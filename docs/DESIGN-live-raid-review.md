# Live Raid Night Review — design

*Hitya, 2026-08-02: "can we build out the raid review as the raid is happening?
I would like to include that timeline view we have on parses as well as the
totals on trash mobs killed."*

Extends `docs/DESIGN-80-raid-night-review.md` (#80), which shipped hours before
this as bot 3.0.245. Read that first — its two load-bearing rules (anchor on the
night's FIRST-ENCOUNTER timestamp; nothing here may break the midnight chain)
still hold and are not restated.

Three changes:

1. **The review is written DURING the raid** and grows into the morning-after
   writeup, in one message.
2. **A per-fight timeline** — the real `FightTimeline` (#98) on the web page,
   and a compact death sparkline that links to it on Discord.
3. **Trash totals** — which turned out to need a new data path, because nothing
   durable has ever stored a trash kill.

---

## 0. The finding that shaped this: `encounters` is boss-only

The brief assumed trash mobs are in `encounters` but often lack a
`bosses_local` match. **They are not there at all.** `supabase.recordParse()`
returns early unless `bosses_local` has a row for the mob:

```js
const row = await select('bosses_local', `internal_id=eq.${bossInternalId}…`);
if (!row?.npc_id) return null;      // ← every trash kill dies here
```

Verified against production, 2026-08-02:

| Query | Result |
|---|---|
| `encounters` rows for guild `wolfpack` | **1521** |
| …with a `bosses_local` match | **1521** (100%) |
| …without | **0** |
| rows in `bosses_local` | **128** (the tracked bosses) |

The 2026-07-30 night has exactly 13 encounter rows — all bosses. The trash the
raid cleared getting to them was uploaded, filtered out of the night thread by
the volume knob, and then discarded. There is no table to read it from and no
backfill possible: **the totals only exist going forward.**

---

## 1. Update cadence — one message, edited

### Why edit, not post
Discord message edits are free of notifications and cheap on the rate limiter.
Posting a fresh card every N minutes would ping the thread all night and bury
the parse cards. So the live card **is the review message**: it writes to the
same `state.channelSlots['rreview_<nightKey>']` slot, which means the 00:45
final review simply **edits the live card into its final form**. One message
per night, from the first pull to the morning after.

### The cadence itself
```
upload → touchLiveRaidReview()   marks the night dirty, (re)arms a timer
                                 SYNCHRONOUS, never awaited
timer  → _runLiveRefresh()       persist trash → collect → summarize → edit
```

Two knobs, both fail-safe:

| Env | Default | What it protects |
|---|---|---|
| `RAID_REVIEW_LIVE_DEBOUNCE_SEC` | 60 | ~20 agents upload the same kill over ~30 s. Waiting a minute after the LAST upload means one kill produces one edit, and `merge_encounter_players` has settled before we read. |
| `RAID_REVIEW_LIVE_MIN_SEC` | 300 | Hard floor between edits. Worst case ≈ 12 edits/hour, ≈ 55 over a raid. |
| `RAID_REVIEW_LIVE` | `1` | `0` kills the live card only; the 00:45 review and `/raidreview` keep working. |

A refresh is single-flight per night; uploads that land while one is building
re-arm it on completion instead of stacking.

### Timestamps that update themselves
"Last kill 6 minutes ago" would be a lie 4 minutes after a 5-minute-cadence
edit. The card uses Discord's `<t:unix:R>` relative timestamps for *updated*,
*last kill* and *pulled*, which every client re-renders continuously with **no
edit at all**. The 5-minute cadence only has to keep the *numbers* fresh.

### When live stops
`touchLiveRaidReview` refuses in four cases, in this order (cheapest first):
`RAID_REVIEW_LIVE=0` → not a raid night (`raidNight.isRaidNightAt`, the same
predicate that decides whether a timestamp gets a thread at all) → the night's
final review has already posted (`_finalDone`) → we are past the final's due
time. `postRaidNightReview({live:true})` re-checks `_finalDone` itself, so a
timer that survived to 00:46 can never overwrite the finished writeup with a
"🔴 LIVE" one.

---

## 2. Cost — what the busiest hour of the week actually pays

The final review does 9 bounded reads for one night. Live means re-running that
~55 times. Two decisions keep it small.

### The ingest hook carries a SIGNAL, not data
It would be free to accumulate kills/damage/deaths from the upload payload
itself. **We deliberately don't.** One kill arrives from ~20 agents with
different views of it; reconciling them is exactly what
`find_or_create_encounter` + `merge_encounter_players` do server-side. Doing it
again in memory would produce a *second* kill count and a *second* death count
that disagree with the parse card and `/parses` — the same failure mode the
"never invent a fourth death count" rule exists to prevent. So the hook passes
a timestamp and nothing else, and every number on the card still comes from
`summarizeNight` over Supabase rows.

The one exception is the trash tally (§4), which has no server-side source.

### Hot / warm / cold read slices
Only two of the reads move minute to minute. `collectNightData(win, {live:true})`
caches the rest per night, per slice:

| Slice | Cache | Why |
|---|---|---|
| `encounters` + `encounter_players` | **never** | this is the card |
| `contributions` (deaths) | **never** | this is the card |
| `characters` (3 000 rows), `eqemu_zone`, 90-day duration history, pace baseline | 6 h | a roster and a 90-day history do not change mid-raid |
| `opendkp_loot_recent`, `opendkp_raids`, `opendkp_ticks`, `fun_events` | 10 min | they land during the night, but slowly |

Steady-state cost is **2 queries per refresh** — roughly 110 bounded reads
across a whole raid, versus ~500 for the naive version. Caching is switched on
**only** when `live` is set, so the 00:45 review and `/raidreview` issue byte-
for-byte the same queries they always did.

The trash tally writes **one `bot_kv` upsert per refresh** (≈55/night), never
one per upload.

---

## 3. Failure isolation

Same contract as the midnight chain, one level earlier in the stack:

1. `touchLiveRaidReview` / `noteEncounterUpload` / `noteTrashKill` are
   **synchronous, try/caught internally, and call-site-wrapped again**. They
   arm a timer; they never await Supabase or Discord.
2. The hook sits **after `res.end()`** in `_handleAgentUpload`, next to the
   existing deferred-card call, and is **never awaited and never returned** —
   it cannot alter the handler's control flow, its ack latency, or its result.
3. `isBackfill` uploads skip it entirely: replaying old logs must not touch
   tonight's card or tonight's trash totals.
4. `_runLiveRefresh` swallows everything; `postRaidNightReview` still returns
   `{ok, reason}` and never rejects.
5. `RAID_REVIEW_LIVE=0` is a mid-raid kill switch that leaves the morning
   review intact. `RAID_REVIEW=0` still kills both.

`test/raid-review-post.test.js` §(f) pins 2–3 by slicing the real
`_handleAgentUpload` source: the pre-existing steps must still appear in order,
`recordParse` must still be before the ack and the deferred cards after it, and
the hook must be post-ack, backfill-gated, inside its own `try`, and un-awaited.
Both the `try` guard and the `isBackfill` guard were removed by mutation and the
suite went red for each.

---

## 4. Trash totals

### Where the numbers come from
The bot tallies non-boss kills off the upload stream:

* **What counts** — `isBoss` is the *same* `findBossFromName` match the parse-card
  volume filter uses, so "trash" here means exactly what it means in the night
  thread. A kill also needs `confirmed_kill === true` (the agent saw the death
  line) and at least one player on the parse. Backfill never counts.
* **Dedup** — key is `<lowercased mob name>|<30 s bucket>`, probing the
  neighbouring buckets so a kill on a bucket boundary can't count twice. ~20
  agents reporting the same serpent collapse to one kill. Damage is **max-kept**
  per kill, mirroring `merge_encounter_players`.
* **Durability** — the tally is persisted to `bot_kv` under
  `raid_trash_<YYYY-MM-DD>` on the refresh cadence, and merged back on the next
  process's first read. A restart mid-raid loses only the slice since the last
  refresh (≤5 min).
* **Honesty** — it is labelled *"counted from what the raid's agents saw die"*
  on both surfaces. It is an observation, not a census: a pull nobody with an
  agent saw is not in it.

### Why `bot_kv` and not a new table
`bot_kv` already exists (migration `20260713050000`), is service-role-only, is
the documented home for "small bits of bot state that MUST survive Railway
restarts", and is readable by the web review (which already uses
`supabaseAdmin()`). That gets the feature to Hitya **tonight with no
migration**, which is the whole point.

**Proposed follow-up — NOT applied, for the coordinator to decide.** A real
table is the right long-term home (it makes trash queryable, joinable to zones,
and chartable over time). Do not merge this as a migration file without a
decision, since the GitHub integration auto-applies on merge to `main`:

```sql
-- supabase/migrations/<ts>_raid_night_trash.sql   (PROPOSED — not applied)
CREATE TABLE IF NOT EXISTS public.raid_night_trash (
  guild_id     text        NOT NULL DEFAULT 'wolfpack',
  night_date   date        NOT NULL,             -- the raid-night key, ET
  mob_name     text        NOT NULL,
  kills        integer     NOT NULL DEFAULT 0,
  total_damage bigint      NOT NULL DEFAULT 0,
  total_sec    integer     NOT NULL DEFAULT 0,
  zone_short   text,                             -- NULL until the agent sends a zone
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, night_date, mob_name)
);
ALTER TABLE public.raid_night_trash ENABLE ROW LEVEL SECURITY;
CREATE POLICY raid_night_trash_read ON public.raid_night_trash
  FOR SELECT TO authenticated USING (true);
```

Until then, `bot_kv` holds the same shape and both surfaces degrade to "no
trash section" when the key is absent.

### What is deliberately NOT in the trash section
* **Zones.** The encounter upload payload carries no zone (checked: `boss_name`,
  `confirmed_kill`, `active_duration_s`, `pet_leaders`, `who_data`, `agent_state`
  — no zone field). Attributing a trash kill to the zone of the nearest boss
  fight would be inference dressed as fact. Top *mobs* by kill count answers
  "totals on trash mobs killed" directly. The proposed table above has the
  column ready for when the agent sends one.
* **Per-player trash DPS.** That is a leaderboard, not a review, and the
  upload-stream dedup is not accurate enough per-player to publish names.

---

## 5. The timeline

### On the web — the real component, reused
`/raid/review/[date]` now renders `FightTimeline` itself, one per fight that has
a death, a raid event or a callout fire, inside a native `<details>` (busiest
fight open). Its inputs:

* deaths — the **same** `dedupEncounterDeaths` → `dedupNightDeaths` →
  `partitionDeaths` rows the page's Deaths list already shows, regrouped by
  encounter. No second death count.
* raid events + fires — one added bounded query on `encounter_events` scoped to
  **this night's encounter ids** (not the day window the existing "Death Touch &
  boss mechanics" section uses, which is untouched).

`FightTimeline.tsx` itself is not modified.

### On Discord — a strip that links to it
An embed cannot render an SVG, so each fight gets a 12-cell sparkline of the
same deaths over the fight's duration (`▁` none, `▂` one, `▅` two–three, `█`
four-plus), the fight's duration, its death count, a **"N together"** flag when
≥3 died inside one cell, and a markdown link to `/parses/<id>` — the page that
draws the real thing. Deaths-only, deliberately: that is the substrate
`FightTimeline` itself started from (its own header comment), and it costs **no
extra query** because the review already fetched the deaths.

### The attribution quirk this exposed (worth knowing)
`find_or_create_encounter`'s ±30-minute window means one encounter row can carry
deaths from an add pulled 15 minutes earlier. On 2026-07-30, Xerkizh (pulled
21:40) carried three deaths from 21:21–21:28 that actually belong to the Arch
Lich window. `FightTimeline` clamps anything before t=0 onto the pull, so the
first render showed *"3 died on the Xerkizh pull"* — a wipe that never happened.

**Both surfaces now plot only deaths inside `[start − 30 s, end + 30 s]`.** The
night's death COUNT and the "deaths by fight" list are unchanged; this only
bounds what an axis is allowed to draw. A fight whose deaths are all
out-of-window simply gets no timeline row — which is why the Discord card can
say "Xerkizh — 3 deaths" under *What to work on* while showing no Xerkizh
timeline. **Flagged for the coordinator:** the clean fix is upstream, in how
overlapping add/boss encounters attribute deaths.

---

## 6. What the live card shows that the final does not

| Line | Source | Live only because |
|---|---|---|
| `🔴 LIVE · updated <t:…:R>` | — | the final is not live |
| `⚔️ Fighting **X** — pulled <t:…:R>` | encounters with `ended_at IS NULL` started within 25 min | by morning every fight has resolved |
| `🕐 Last kill <t:…:R>` | last confirmed kill | "how long have we been stalled" |
| `📈 N down 2h 5m in — 1 behind our usual 10 (last 6 raids)` | trailing 45 days of confirmed kills | the final compares fights, not the clock |

The pace baseline is **our own trailing raid nights**, never a target: group
prior kills by night key, keep nights with ≥5 kills **that were scheduled raid
nights** (`isRaidNightAt`), count how many kills each had by the same elapsed
time from its own first pull, take the median. Fewer than 3 comparable nights →
the line is omitted entirely.

> The ≥5-kills + raid-night filter is not cosmetic. Without it the baseline
> fills with weeknight six-man clears — 30 "nights" with a median of 2 — and an
> ordinary Thursday renders as *"7 ahead of our usual pace"*. Caught in the
> 2026-07-30 render, 2026-08-02.

The live card also tolerates a night that has **pulled but not killed** (the
final still refuses: no confirmed kill, no review), so the card appears at the
first pull rather than the first kill.

---

## 7. Code shape

```
utils/raidReview.js         + deathStrip / TIMELINE_GRACE_MS   (pure)
                            + trash tally: noteTrashKill / trashSummary /
                              loadTrash / saveTrash            (memory + bot_kv)
                            + _computePace                     (pure)
                            + summarizeNight(data, opts)  opts.requireKills,
                              opts.nowMs → the `live` block; both default to
                              the shipped behaviour
                            + renderReviewEmbeds: live header, 🕒 timelines,
                              🐜 trash, and a 5 800-char field budget so the
                              additive fields can never breach Discord's 6 000
                            + collectNightData(win, {live}) slice cache + pace
                            + postRaidNightReview({live, nowMs}), _finalDone
                            + touchLiveRaidReview / noteEncounterUpload
index.js                    ONE post-ack block in _handleAgentUpload
web/app/raid/review/[date]/ + FightTimeline section, + Trash section,
  page.tsx                    + encounter_events + bot_kv reads
```

No schema change. No version bumps (the coordinator owns those and the roadmap
entry).

---

## 8. Regression coverage

`test/raid-review-post.test.js` grew from 28 to 51 tests; the root suite from
648 to 671. Nothing was rewritten.

* **(a)/(b)/(c)** — untouched. The midnight chain, the isolation contract and
  thread reuse still pass exactly as written.
* **(d) live** — the in-progress line, the pace claim and its ≥3-night floor;
  the final for the same night carrying *none* of it (title, colour, no `<t:`,
  original footer); a card for a pulled-but-not-killed night; **six live
  refreshes → one `send`, five `edit`s**; the final editing the live card and
  every later live refresh being refused (`final-posted`); `RAID_REVIEW_LIVE=0`
  stopping live without touching the final; **20 touches inside 4 s → one
  refresh**, then the min-interval floor holding the next one; and
  `touchLiveRaidReview` never throwing and never firing off a raid night.
* **(e) trash** — 20 uploaders → 1 kill, max-kept damage; two genuine kills of
  the same mob stay 2; a bucket-boundary kill counts once; bosses, unconfirmed
  pulls and empty parses are not tallied; the rendered field; no "0 trash" line;
  hostile inputs cannot throw.
* **(f) ingest path** — the source-slice assertions described in §3.
* **timelines** — strip placement and the wipe column; the strip using the same
  deduped deaths as the rest of the review; the field dropping out when nothing
  died.
