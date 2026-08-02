# DESIGN — #81 The Wolf Pack Raid Guide

*Cloud session, 2026-08-02 (fleet 2). Branch `task/f2-81-raidguide`.*

**Status: design complete · phase 0 BUILT (§10) · phases 1–3 designed, not
built.** Nothing here has been applied to Supabase — the SQL in §7 is a
proposal for the coordinator, and phase 0 deliberately needs none of it.

Shipped on this branch:

| File | What |
|---|---|
| `web/lib/raidGuide.ts` | the pure kernel — catalog pick-and-merge, HP corroboration, damage-floor bucketing, sole-source loot, pairwise run order, note staleness |
| `test/raid-guide.test.js` | **30 tests**, fixtures are real prod rows (root suite: 32 files/375 tests → **33/405**, no pre-existing test touched) |
| `web/app/guide/page.tsx` | the index / authoring worklist |
| `web/app/guide/[bossId]/page.tsx` | blocks 1, 2 (read-only), 3, 9, 10, 11 |
| `web/components/Nav.tsx` | one nav entry (the only edit to an existing file) |

Gates: `npx vitest run` 33/405 green · `npx tsc --noEmit` clean · `npx next build`
green with `/guide` and `/guide/[bossId]` both emitted. No bot, agent or Mimic
file touched.

**The brief, verbatim from the queue** (`DESIGN-platform-queue.md:171`):

> Review [#80] before Guide [#81] — the Guide is accreted Reviews + playbooks.

That sentence is the whole design. The Guide is **not** hand-written wiki
pages. It is what you get when you take the per-night Raid Night Review [#80],
run it per **boss** instead of per **night**, keep the result forever, and let
an officer write over the top of it without the machine ever eating their prose.

---

## 0. What already exists (surveyed before designing — do not rebuild)

| Thing | Where | Status |
|---|---|---|
| **#80 Raid Night Review** | `web/app/raid/review/page.tsx` + `[date]/page.tsx`, pure kernel in **`web/lib/raidReview.ts`**, tests in `test/raid-review.test.js` | **SHIPPED** (web 1.0.266 / 1.0.267). The charter's "#80: none — fresh design" is stale. |
| Per-boss kill history | `web/app/boss/[id]/page.tsx` | Shipped. Kills, top damage, fastest kill, recent-kills table. **Thin** — no mechanics, no loot, no strategy, no zone context. |
| Bestiary / catalog page | `web/app/db/npc/[id]/page.tsx` (wpqdi, `docs/DESIGN-wpqdi.md`) | Shipped. Stats, spawns, loot, casts, faction, turn-ins. |
| Boss playbook + approach briefs | **[#78]**, Wave 3 | Not started. **#81 is the durable home of #78's content** — see §9. |
| Spawn-chain / AE-dance / buster tables | agent `BOSS_SPAWN_CHAINS`, `AOE_DANCE`, `_checkTankBuster` (`packages/wolfpack-logsync/index.js:27387+`) | Shipped, hard-coded, **invisible to any human surface**. |
| Authored strategy fields | `bosses_local.strat_notes`, `bosses_local.path_notes` | **Columns exist. 0 of 128 rows populated.** There is no editor and no page that renders them. |
| Curse counters | bot `_CURSE_COUNTERS` (`index.js:8591`) | Shipped, hard-coded. |
| Timers / spawn windows | `data/bosses.json` (133) → `bosses_local` (128) | Shipped. |

**Coverage of our own history** (measured 2026-08-02):

```
bosses_local rows                     128
  … with ≥1 parsed encounter           99   (77%)
  … with ≥3                            88   (69%)
  … with ≥10                           57   (45%)
```

So a data-driven Guide is *already* possible for 99 bosses. That is the whole
argument for generating rather than authoring: nobody is going to write 128
wiki pages, but we have already fought 99 of them and recorded it.

---

## 1. Thesis

A raid guide written by hand goes stale the week after it is written, and
everyone knows it, so nobody reads it, so nobody updates it. Three deaths.

Our advantage is that we already record the raid. So invert it:

> **The Guide is a rendering of our own history, with a place for an officer to
> say the things history cannot say.**

Concretely, three content classes, and the design is mostly about keeping them
apart:

- **GENERATED** — computed from data on every page load. Median kill time, what
  the boss actually hits for, which callouts fired, what he drops, what it went
  for, who has tanked him. *Nobody writes this and nobody can break it.*
- **ACCRETED** — the per-night Review facts, rolled up per boss and **kept**,
  because the underlying streams expire (§4). This is the literal reading of
  "accreted Reviews".
- **AUTHORED** — the pull, the positioning, the "do not break mez on the left
  add", the reason we do it in that order. Written by an officer, owned by that
  officer, never touched by a regeneration.

---

## 2. What is a Guide page?

### 2.1 Primary unit: **per boss** — `/guide/[bossId]`

`bossId` = `bosses_local.internal_id` (`emperor_ssraeshza`), not the npc id —
it is stable, it is what `data/bosses.json`, the timer boards, and `/kill`
already speak, and it survives the catalog re-syncing npc ids.

The page is a stack of independent **blocks**. Every block renders only when it
has data; an empty block is absent, never a "no data" placeholder. A page with
zero blocks still exists (it lists the boss, its zone, and its timer) — that is
the floor.

| # | Block | Class | Source |
|---|---|---|---|
| 1 | **Identity** — name, zone, expansion, emoji, respawn timer, board link | GEN | `bosses_local` + `data/bosses.json` + `eqemu_zone` |
| 2 | **Approach** — the pull, positioning, the order, the "do not" list | **AUTH** | `boss_guide_notes` (§5) |
| 3 | **Our numbers** — engagements / confirmed kills / aborts, median + range kill time, median raid damage, median DPS, typical parsed headcount, trend | GEN | `encounters`, `encounter_players` |
| 4 | **What it hits for** — median/max hit taken, hits per fight, who has tanked it, damage-taken split | GEN | `contributions.raw_parse->defenders` + `bossMaxMelee` |
| 5 | **Mechanics observed** — rampage / enrage / DT / breath counts per fight, the named adds that show up, the spawn chain | **ACC** | `encounter_events` → `boss_guide_observations` |
| 6 | **Callouts that fire here** — the guild triggers + agent built-ins actually observed on this boss, with their timings, plus a health flag | **ACC** + GEN | observed fires + `guild_triggers` + agent tables |
| 7 | **Debuffs that stick / don't** — slows, tashes, malos, DoTs seen landing; explicit "cannot be slowed" when the catalog says so and observation agrees | **ACC** | `buff_casts` → `boss_guide_observations` |
| 8 | **What usually kills us** — deaths per fight, who, on what, riposte flag | **ACC** | `contributions.raw_parse->deaths` (via `dedupEncounterDeaths`) |
| 9 | **Loot & what it goes for** — unique-dropper items, times awarded, avg/max DKP, current wishlist demand | GEN | `eqemu_npc_drops` + `opendkp_loot` + `wishlists` |
| 10 | **Catalog card** — level, HP, AC, damage range, resists, special flags | GEN | `eqemu_npc_types` **via the #171 row picker** (§6.1) |
| 11 | **Fight log** — last N kills, deep-linked to `/parses/[id]` | GEN | `encounters` (this is today's `/boss/[id]`, absorbed) |
| 12 | **Officer notes / changelog** — dated one-liners ("2026-07-31: DA at 2:00 not 2:10") | **AUTH** | `boss_guide_notes` (kind=`log`) |

### 2.2 Secondary unit: **per zone run sheet** — `/guide/zone/[short]`

The unit a raid leader actually plans with is not a boss, it is a *night in a
zone*. This page is:

- the **order we usually kill them in**, derived from our own nights (§6.4) —
  with a confidence number, not an assertion;
- keys / flags / access notes (AUTH);
- per-boss one-line summaries with the numbers from block 3;
- total expected clear time = Σ median kill time + our observed median gap.

This is the block that makes the Guide *operationally* useful rather than
merely interesting, and it is 100% derivable for every zone we raid.

### 2.3 Index — `/guide`

Grouped by expansion (matching `/boards`), each boss a row with: emoji, name,
kills, median time, ⚠ when a block is stale, ✍ when it has authored content.
Sortable. This is also the **authoring worklist** for officers: the rows with
no ✍ are the pages that want a human.

### 2.4 What a Guide page is NOT

- Not a second copy of `/db/npc/[id]` — block 10 is a compact card that **links
  out** to the bestiary page for spawns/faction/full loot.
- Not a second copy of `/parses` — block 11 links out, it does not re-render
  fights.
- Not a second review generator. Block 5/7/8 consume #80's kernel (§3).

---

## 3. Dependency on #80 — the interface contract

**#80 and #81 must not both own "what happened".** The split:

> **#80 owns the DERIVATION KERNEL and the night axis. #81 owns the boss axis
> and the durability.**

#80's kernel is already a clean, React-free, unit-tested pure module —
`web/lib/raidReview.ts`. #81 imports it. It does **not** re-implement death
dedup, slow matching, span bounding, or fire-noise filtering.

### 3.1 What the Guide expects #80 to expose

Stated as an explicit assumption so the coordinator can reconcile it against
whatever #80's in-flight work actually lands:

```ts
// web/lib/raidReview.ts — the Guide depends on these staying exported and pure.
dedupEncounterDeaths(contribDeaths: RawDeath[][]): DeathRow[]   // per ENCOUNTER
dedupNightDeaths<T>(rows: T[], windowMs?): T[]                   // cross-encounter
partitionDeaths<T>(rows: T[]): { players: T[]; pets: T[] }
isSlowSpell(name): boolean
dedupeSlows(rows: SlowCast[], windowMs?): SlowRow[]
activitySpan(ranges): { startMs; endMs } | null
inSpan(ts, span): boolean
zonedDayRangeUtc(dateKey, tz): { startIso; endIso }
isValidDateKey(s): boolean
```

Plus **one thing #80 does not export today and #81 needs** — the fire-noise
filter, currently an inline `FIRE_NOISE` `Set` + `DT_RE` regex inside
`web/app/raid/review/[date]/page.tsx:232-237`. The Guide needs the identical
classification so "mechanics on this boss" and "mechanics last night" never
disagree.

> **ASK to the #80 agent / coordinator:** lift `FIRE_NOISE`, `DT_RE`, and the
> 3s same-label dedup loop out of the page and into `raidReview.ts` as
> `isPersonalFailFire(subtypeOrLabel): boolean` and
> `collapseFires(rows, windowMs = 3000): FireMark[]`. Pure move, no behaviour
> change, covered by the existing `test/raid-review.test.js` pattern. If #80
> does not do it, #81 does it as its first commit and #80 rebases onto it.

### 3.2 The per-night shape the Guide accretes

The Guide's nightly job (§4) consumes **exactly** the five things the review
page derives, keyed by encounter so they can be pivoted to boss:

```ts
type NightReview = {
  date: string;                                    // ET day key, YYYY-MM-DD
  kills:     { encounterId; npcId; bossId; startedAt; endedAt; durationSec;
               totalDamage; totalDps; parsedPlayers; classification }[];
  deaths:    { encounterId; npcId; name; class; riposteDeath; ts }[];  // post-dedup
  slows:     { encounterId?; target; spell; at }[];                    // post-dedupeSlows
  mechanics: { encounterId; npcId; subtype; actor; label; at; isDt }[];// post-collapseFires
  loot:      { date; itemName; gameItemId; character; dkp }[];         // OpenDKP, night-keyed
};
```

Note `loot` carries **no boss** — OpenDKP records item→raid, not item→NPC
(`opendkp_loot` has `raid_id`, no npc id; `loot_drops` has `encounter_id` but
is **empty: 0 rows**). Boss attribution for loot is therefore *inferred* in
block 9 and must be labelled as such (§6.3).

`attendance` and `standouts` are deliberately **not** in this contract — the
Guide does not need them (they are night facts, not boss facts), and #92's
`member_attendance_metrics` view already owns attendance. If #80 emits them,
#81 ignores them.

### 3.3 Files neither task touches (collision map)

- #80 owns: `web/app/raid/review/**`, `test/raid-review.test.js`, and — after
  the ask in §3.1 — `web/lib/raidReview.ts`.
- #81 owns: `web/app/guide/**`, `web/lib/raidGuide.ts`, `test/raid-guide.test.js`,
  `utils/guideRollup.js`, `web/app/admin/guide/**`.
- **Shared, read-only for #81:** `web/lib/raidReview.ts`. #81 adds no exports
  to it beyond the §3.1 ask; if #81 needs a new pure helper it goes in
  `raidGuide.ts`.
- `#87` (officer runbooks/console) owns `/admin/*` pages. `/admin/guide` is a
  new route; if #87 builds an officer console shell, the Guide editor becomes a
  card inside it rather than a sibling. Flagged, not resolved.

---

## 4. Accretion — why the Guide cannot just recompute at read time

This is the finding that changes the architecture, and it is measured, not
assumed.

**The streams the Review reads are perishable.**

| Stream | Retention / coverage (measured 2026-08-02) |
|---|---|
| `buff_casts` (slows, debuffs) | oldest row **2026-07-26**, newest **2026-08-02** — a hard **7-day** window. `docs/DESIGN-platform-queue.md:209` states the retention policy; this confirms it in prod. |
| `encounter_events` kind=`fire` (callouts) | first row **2026-07-20**. 13 days of history, 69 encounters total. |
| `encounter_events` kind=`raid_event` (rampage/enrage/slow/disc/mob_heal) | first row **2026-06-05**. |
| `contributions.raw_parse->deaths` | **0** contributions carried a `deaths` key before 2026-07; 144 in July, 18 in August. |
| `encounters` / `encounter_players` | full history, back to 2024-12-31. |

So: a Guide that recomputes "what usually kills us on Emperor" at read time
would today answer from **21 fights of damage history and 3 fights of mechanics
history**, and next month it would answer from 21 fights and *still* 3 fights,
because the mechanics rows will have aged out or the fires will have been
pruned. **The Guide gets worse over time unless it snapshots.**

Hence: **`boss_guide_observations`** — an append-only, one-row-per
`(npc_id, night)` rollup, written once, after the night is over, by the bot's
existing TZ-aware midnight chain (the same chain that already does daily
summary → archives → parse consolidation → resets).

```
raid night ends
  → midnight chain
    → for each npc_id with an encounter that night:
        run the #80 kernel over that night's data, scoped to that npc
        upsert one boss_guide_observations row (idempotent on (guild_id, npc_id, night))
  → the perishable rows may now expire; the facts are kept.
```

Properties that matter:

- **Idempotent** — re-running the night (a late backfill upload, a `--since`
  re-run) recomputes and overwrites that one row. No double counting.
- **Bounded** — one row per boss per night. At 3 raid nights/week × ~10 bosses,
  ~1,500 rows/year. Trivial.
- **Replayable** — a one-shot backfill can walk every historical night through
  the same function and fill in what is still recoverable (all of `encounters`,
  most of `raid_event`, July onward for deaths/fires; nothing for pre-July
  `buff_casts` — that data is simply gone, and the Guide should say so).
- **Cheap to read** — block 5/7/8 are `SELECT … WHERE npc_id = $1`, aggregated
  in TS. No jsonb scan of `contributions` at page-load time.

**This is the concrete meaning of "the Guide is accreted Reviews."** Not "the
Guide links to the reviews" — the Guide is the *integral* of them.

---

## 5. The crux: how authored content survives regeneration

A self-updating guide that eats an officer's prose is worse than no guide. The
design rule:

> **A Guide page is never a document. It is a list of independent blocks, and
> every block has exactly one writer. Generated blocks and authored blocks never
> share a row, a column, or a merge.**

Five mechanisms, in order of importance:

### 5.1 Physical separation of storage

Authored prose lives in `boss_guide_notes`, one row per
`(npc_id, section, ord)`. Generated facts are **computed at read** or live in
`boss_guide_observations`. **There is no code path that writes to
`boss_guide_notes` other than a human pressing Save.** The regeneration job
does not have the table in its query set. This is enforced structurally, not by
convention: `utils/guideRollup.js` never imports the notes table.

Corollary: **do not put authored prose in `bosses_local.strat_notes`.** That
column exists and is empty (0/128) and it is tempting — but it is a single
free-text blob on a row that the boss-import/`/addboss` path writes to. One
blob = merge conflicts between the machine and the human the first time anyone
adds a "generated summary" convenience. Leave `strat_notes` for the v0
read-only stopgap (§10, phase 0) and migrate it into `boss_guide_notes` at
phase 1; do not build on it.

### 5.2 Block ownership is declared, not inferred

```ts
type GuideBlock =
  | { kind: 'generated';  id: string; render(facts): JSX }
  | { kind: 'accreted';   id: string; render(obs): JSX }
  | { kind: 'authored';   id: string; section: NoteSection };
```

The page is `BLOCKS.map(renderBlock)`. An authored block's render function
receives only `boss_guide_notes` rows. It is not possible to write a
regeneration that touches it, because it is not reachable from the rollup code.

### 5.3 Never auto-edit; only *flag* staleness

When a generated fact that a note **cites** moves materially, the note gets a
non-destructive banner:

```
⚠ This note was written on 2026-06-10, when the median kill was 12:44.
  It is now 8:10 (17 fights since). — Hitya · [mark reviewed] [edit]
```

Mechanism: `boss_guide_notes` stores `facts_at_write jsonb` — a snapshot of the
handful of scalars the editor showed the author when they hit Save (median
duration, kill count, median damage, deaths/fight). On render, compare against
current. Trip the banner when any watched scalar moves >25% **or** kill count
grows by ≥50%. "Mark reviewed" re-snapshots `facts_at_write` without changing
the prose. Nothing is ever rewritten.

This gives the *feeling* of a living document without the machine ever having
write access to a human sentence.

### 5.4 Versioned, attributed, revertible

`boss_guide_notes` keeps `updated_by_discord_id` + `updated_at`, and every save
appends the prior body to `boss_guide_note_revisions`. An officer can see who
changed the Emperor approach and roll it back. This is the same trust model as
the existing audit trail with Undo buttons; reuse `audit_log` for the event so
it lands in the audit thread.

### 5.5 Authored content can *pin* a generated fact

Sometimes the officer is right and the data is misleading (the median includes
three nights we were undermanned). So a note may carry an optional
`overrides jsonb` — e.g. `{"target_kill_time_sec": 480}` — and the generated
block renders **both**: `median 12:44 · target 8:00 (Hitya)`. The override never
replaces the observation; it annotates it. This kills the main reason people
otherwise want to edit generated text.

---

## 6. Load-bearing data rules (derive these once, here)

### 6.1 The catalog row picker — hard dependency on #171

**`encounters.npc_id` frequently points at a stats-empty shell row.** Proven on
our worked example:

| | `#Emperor_Ssraeshza` **162065** *(what `encounters.npc_id` says)* | `Emperor_Ssraeshza_` **162491** |
|---|---|---|
| hp | 1,000,000 | **1,250,000** |
| ac | 200 | **700** |
| mindmg / maxdmg | 7 / 134 | **283 / 904** |
| mr / fr / cr / dr / pr | 26 / 26 / 26 / 26 / 26 | **1000 / 60 / 75 / 150 / 1000** |
| `npc_spells_id` | **0** (no spells) | **227** → spell 2310 *Rage of Ssraeshza* |
| `loottable_id` | **0** (no loot) | **12791** → 38 drops |

A Guide that renders block 10 or block 9 off 162065 shows a boss with no loot,
no spells, AC 200 and a 7-damage minimum hit. That is worse than showing
nothing. So:

> **The Guide MUST use the #171 pick-and-merge resolver** (`docs/audit-mob-specials.md`
> §"The fix", rules 1–5) rather than a `limit=1` lookup: normalise the name
> (`#`→∅, `_`→space, trailing `_`), collect **all** matching rows, and merge
> field-wise preferring the row that actually has the field populated, with
> `loottable_id > 0` and `npc_spells_id > 0` as tiebreaks.

**Corroboration test (novel, and it works):** for a boss we kill outright, the
median `encounters.total_damage` over confirmed kills should land just under
the true HP pool. Emperor's median raid damage is **1,211,014** —
**96.9 % of 1,250,000** (row 162491) and **121 % of 1,000,000** (row 162065).
Our own parses pick the right catalog row. Ship this as `hpCorroboration()` in
`raidGuide.ts`: it turns block 10 from "here are some numbers" into "here are
the numbers, and our fights agree with them (97 %)".

*No circularity with the §6.2 damage floor:* corroboration runs on the **median
over all confirmed rows** (robust — fragments and zero-damage rows are a
minority and a median ignores them: the ≥60 s set gives 1,210,654, the
complete-kill set 1,211,014, a 0.03 % difference). The floor is derived from
that median, then applied. Order: resolve row → corroborate → floor → stats.

### 6.2 Kill vs engagement vs abort — use a DAMAGE floor, not a duration floor

- **Confirmed kill** = `ended_at IS NOT NULL` (some agent saw the slain line)
  AND `classification IS NULL`. `/raid/review` already uses exactly this.
- **Engaged, unconfirmed** = `ended_at IS NULL`. Show separately, never in the
  median.
- **Complete kill** (the only rows that feed a median) = confirmed **and**
  `total_damage ≥ 0.5 × corroborated HP pool` (§6.1). A duration floor alone is
  not enough and Emperor proves it: `duration ≥ 60 s` still admits an 81 s row
  carrying **198 k** damage against a **1.25 M** pool — a re-pull fragment, not
  a kill, and it drags the reported minimum from a real 7 : 34 down to a
  fictional 1 : 21.

  Emperor's 21 engagements decompose cleanly under the damage floor
  (625,000 = 50 % of 1.25 M):

  | Bucket | n | What they are |
  |---|---|---|
  | **Complete kills** | **13** | the only rows in any median |
  | Damage-floor rejects | 2 | 81 s / 198 k · 190 s / 417 k — re-pull fragments |
  | Zero-damage rows | 2 | 764 s and 394 s with **0 uploaders** — `bosskill`-only, timer truth without a parse |
  | Sub-60 s aborts | 4 | 4 s / 7 s / 10 s / 13 s |

  The Guide states the split rather than hiding it: *"13 complete kills of 21
  recorded engagements."* Where no HP pool is resolvable, fall back to
  `total_damage ≥ 0.5 × median(total_damage)` and label the medians
  *approximate*.
- `classification IN ('foreign','pvp','live')` and the `isAutoForeign(guildShare(...))`
  auto-hide from `web/lib/anomalies.ts` apply exactly as on `/parses`.

### 6.3 Loot attribution is INFERRED, and must say so

`loot_drops` (which has `encounter_id`) is **empty — 0 rows**. `opendkp_loot`
(8,123 rows) has `raid_id` and item name, no NPC. So boss→loot is a join, and
a naive `eqemu_npc_drops ⋈ opendkp_loot` on item name over-claims badly: spell
scrolls and shared drops appear on a dozen bosses' pages at once.

**Rule: block 9 shows only items where this boss is the sole catalog source**
(`SELECT count(DISTINCT npc_id) FROM eqemu_npc_drops WHERE item_id = x` = 1),
labelled *"drops only from this boss"*. Shared-source items go in a collapsed
"also on his table (shared with N other mobs)" list with no DKP numbers. For
Emperor that is a clean 13 items (§8, block 9) out of 38 table entries.

Second-order improvement, not v1: intersect with "awarded on a night we killed
this boss" to recover shared items. Requires `opendkp_raids.date` ⋈ the night
key; noted, not designed.

### 6.4 Run order is pairwise, not average-slot

Naïve "average kill slot per night" is wrong and provably so: Ssra Temple's
average-slot ranking puts *Blood of Ssraeshza* at slot 9.1 and *Emperor* at 6.0
— i.e. Emperor before Blood — when the agent's own `BOSS_SPAWN_CHAINS` says
Blood's death **spawns** Emperor 2:00 later. The distortion is different mobs
having different sample eras.

**Correct algorithm:** for each pair (A,B) appearing on the same night, count
`A before B` vs `B before A`; keep pairs with ≥4 shared nights; order by
win-rate (a Copeland/Kendall ordering). Render the win rate as confidence.
Blood→Emperor scores **6 of 8 shared nights (75%)** — which is both correct and
honest about the 2 rows where the encounter windows overlapped.

### 6.5 Boss→callout mapping is EMPIRICAL, not declarative

Of **116 guild triggers (101 enabled), exactly 1 names a boss in its pattern**
(the Emperor tank-buster row — and it is disabled). There is no `boss_id`
column on `guild_triggers`. So block 6 cannot be "the triggers configured for
this boss"; it must be **"the callouts we have actually observed firing while
fighting this boss"**, from `encounter_events(kind='fire')` joined through
`encounters.npc_id`, with the #80 noise filter applied.

That works, and it produces a real map today:

```
Vyzh`dra the Exiled  → Death touch — countdown   26 fires / 2 fights
Vulak`Aerr           → Ancient Breath (Resist)   14 / 1
Lady Vox             → Frost Breath (+Resist)    18 / 1
Lord Nagafen         → Lava Breath, Dragon Roar  15 / 1
Emperor Ssraeshza    → New Rampage, Low on HP    16 / 1
```

It also gives a **health check for free**: a boss whose agent-side table
(`AOE_DANCE` / `BOSS_SPAWN_CHAINS`) declares a mechanic that has **never been
observed firing** on that boss gets a ⚠ on the page. That single check would
have surfaced the Vyzh`dra-the-Cursed AoE-dance mis-signature (`STATUS.md`,
open item) months earlier — the entry watches a Caustic Mist self-land line
with `burst_n: 3`, which can never fire, and the observed fire on that boss is
*Dragon Roar*.

### 6.6 The other rules (reused, not re-derived)

- **`exclude_from_stats`** honoured everywhere a character name appears
  (deaths, tanks, top damage, loot winners). **`exclude_inventory`** for the
  wishlist-demand sub-line.
- **Stat visibility scope** — the Guide is `GUILD` (named, signed-in members),
  same as `/raid/review`. It contains named deaths and named DKP.
- **Per-character data floor** (`character_data_floor`) applies to any
  "who has tanked this" style leaderboard.
- **PoP lock** — `isPopLocked()` (`utils/config.js`, until `2026-10-01`). PoP
  boss Guide pages render **identity + authored only**; no generated blocks, no
  loot table, no catalog card. Same posture as the locked boards. The index
  shows them greyed with a 🔒.
- **`defenders` arrays contain NPCs.** The raw array on an Emperor fight lists
  `Emperor Ssraeshza` (11.3M taken — that is *our* damage to him), `High Priest
  of Ssraeshza`, `an imperial guard`, `General Kizuhx` alongside real tanks.
  Block 4 must filter to names in the guild `characters` roster before ranking.
  (It is also single-uploader per fight — only the tank's own agent reports it —
  so counts are one observer's view, not a merge.)

---

## 7. Schema proposal (NOT APPLIED — coordinator applies)

Two new tables + one revision table. All idempotent, all `IF NOT EXISTS`.

```sql
-- supabase/migrations/20260802HHMMSS_raid_guide.sql

-- 1. ACCRETED: one row per boss per raid night. Written by the bot's midnight
--    chain; recomputable and idempotent. This is what makes the Guide survive
--    the 7-day buff_casts window and the pruning of encounter_events.
create table if not exists boss_guide_observations (
  guild_id      text        not null default 'wolfpack',
  npc_id        integer     not null,
  night         date        not null,              -- ET raid-night key (rollover 06:00)
  encounters    integer     not null default 0,    -- engagements that night
  kills         integer     not null default 0,    -- ended_at set, classification null
  aborts        integer     not null default 0,    -- below the per-boss duration floor
  duration_secs integer[]   not null default '{}', -- per confirmed kill, for medians
  damage_totals bigint[]    not null default '{}',
  player_counts integer[]   not null default '{}',
  deaths        jsonb       not null default '[]', -- [{name,class,riposteDeath,ts}] post-dedup
  mechanics     jsonb       not null default '[]', -- [{subtype,actor,count}] post-noise-filter
  debuffs       jsonb       not null default '[]', -- [{spell,landings,first,last}] from buff_casts
  tanks         jsonb       not null default '[]', -- [{name,damageTaken,hits}] roster-filtered
  boss_max_hit  integer,
  source_ver    text,                              -- rollup code version, for replays
  computed_at   timestamptz not null default now(),
  primary key (guild_id, npc_id, night)
);
create index if not exists boss_guide_obs_npc_idx on boss_guide_observations (npc_id, night desc);

-- 2. AUTHORED: officer prose. NOTHING automated ever writes here.
create table if not exists boss_guide_notes (
  id            uuid        primary key default gen_random_uuid(),
  guild_id      text        not null default 'wolfpack',
  npc_id        integer,                            -- null for a zone-level note
  zone_short    text,                               -- set for run-sheet notes
  section       text        not null,               -- 'approach'|'positioning'|'roles'|
                                                    -- 'donts'|'access'|'log'
  ord           integer     not null default 0,
  body          text        not null,               -- markdown, rendered with a strict allowlist
  overrides     jsonb,                              -- §5.5 pinned targets
  facts_at_write jsonb,                             -- §5.3 staleness snapshot
  updated_by_discord_id text,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint boss_guide_notes_scope check (npc_id is not null or zone_short is not null)
);
create unique index if not exists boss_guide_notes_key
  on boss_guide_notes (guild_id, coalesce(npc_id, -1), coalesce(zone_short,''), section, ord);

-- 3. Revisions — every save appends the prior body. Officer-revertible.
create table if not exists boss_guide_note_revisions (
  id          uuid        primary key default gen_random_uuid(),
  note_id     uuid        not null references boss_guide_notes(id) on delete cascade,
  body        text        not null,
  overrides   jsonb,
  edited_by_discord_id text,
  edited_at   timestamptz not null default now()
);
create index if not exists boss_guide_note_rev_idx on boss_guide_note_revisions (note_id, edited_at desc);

alter table boss_guide_observations   enable row level security;
alter table boss_guide_notes          enable row level security;
alter table boss_guide_note_revisions enable row level security;

-- Members read; only the bot (service_role) writes observations; the web writes
-- notes through an officer-gated server action using the service-role key, so
-- no authenticated-write policy is needed (matches /admin/triggers).
do $$ begin
  create policy boss_guide_obs_read   on boss_guide_observations   for select to authenticated using (true);
  create policy boss_guide_notes_read on boss_guide_notes          for select to authenticated using (true);
  create policy boss_guide_rev_read   on boss_guide_note_revisions for select to authenticated using (true);
exception when duplicate_object then null; end $$;
```

**No change to `bosses_local`.** `strat_notes` / `path_notes` stay as they are;
phase 0 reads them, phase 1 migrates any content into `boss_guide_notes`
(`section='approach'` / `section='access'`) and stops reading them.

---

## 8. WORKED EXAMPLE — `/guide/emperor_ssraeshza`

Everything below is **real data**, queried from prod on 2026-08-02. This is
literally what the page renders on first load. Numbers a raider would read are
in the prose; provenance is in the small print.

---

### 🐍 Emperor Ssraeshza
**Ssraeshza Temple** (`ssratemple`) · Luclin · respawn **162 h** *(our board;
catalog says 156 h)* · [board](#) · [bestiary](/db/npc/162491) · [all parses](/boss/162065)

> **⚠ Guide facts resolve to catalog row 162491, not the row our encounters are
> keyed to (162065).** The keyed row is a shell (no loot table, no spell list,
> AC 200). See §6.1.

---

#### ✍ Approach — *authored, empty on first load*

> *No approach written yet.* [Officers: write one →](/admin/guide/emperor_ssraeshza)
>
> Suggested starting points, from the data below: the Blood → Emperor 2:00
> chain, the 60 s buster cadence, and the fact that he cannot be slowed.

---

#### 📊 Our numbers

|  |  |
|---|---|
| Engagements recorded | **21** |
| **Complete kills** (damage ≥ 50 % of the 1.25 M pool) | **13** |
| Not counted | 2 re-pull fragments · 2 timer-only rows (no parse) · 4 aborts < 60 s |
| **Median kill time** | **17 min 50 s** (1,070 s) |
| Range | **7 min 34 s** → **24 min 18 s** |
| Median raid damage | **1,211,014** |
| Best raid damage | **1,602,826** (2026-07-03, in 12 min 08 s, 40 parsed) |
| Fastest complete kill | **7 min 34 s** (2026-03-02, 33 parsed) |
| Median raid DPS | **1,242** |
| Median parsed headcount | **29** (range 23 → 50) |
| First recorded | 2026-01-09 · **Last** 2026-07-31 (17 : 50, 50 parsed, 1.33 M) |

*Parsed headcount ≠ raid size — it counts characters that appeared in an
upload, so non-Mimic raiders who dealt no parsed damage are missing. Uploader
coverage on this fight has gone from **1 → 13 agents** since May.*

#### 📈 Trend
Median kill time by quarter (complete kills): **Q1 2026 — 10 : 49** (n=3) →
**Q2 — 18 : 38** (n=6) → **Q3 (Jul) — 16 : 38** (n=4). Median raid damage is
flat at ~1.21 M across all three, so this is a *DPS* trend, not a tuning
change — worth an officer's eye and exactly the kind of thing an authored note
should explain.

---

#### 🛡 What it hits for

| | |
|---|---|
| Biggest single hit observed | **5,187** |
| Main tank on the last recorded fight | **Peopleslayer** (Warrior) |
| Damage taken by that tank | **7,156,505** over **14,388** connects ≈ **497/hit** |
| Catalog melee range (row 162491) | 283 – 904 |

Other raiders who have taken Emperor damage in a recorded fight: Lenolshot
(469,511), Hoden (405,819), Abrahms (305,547), Hawkner (174,317).

*Single-uploader field — only the tank's own agent reports `defenders`, so this
is one observer's view, not a merged count. NPC rows in the raw array (the boss
himself, High Priest, imperial guards) are filtered out by roster match.*

---

#### ⚙️ Mechanics observed *(3 fights instrumented — 2026-06-05 onward)*

| Mechanic | Events | Fights |
|---|---|---|
| **Rampage** (Emperor) | **1,221** | 3 |
| Enrage (Emperor) | 19 | 2 |
| "New Rampage" callout fired | 12 | 1 |
| "Low on HP (≤30%)" fired | 4 | 1 |

**Named adds seen in the same fights** — all of them enrage, most rampage:
General Kizuhx · Grziz / Skzik *the Tormentor* · Slakiz / Heriz *the Malignant*
· Zlakas / Klazaz *the Slayer* · Yasiz / Nilasz *the Devourer* ·
High Priest of Ssraeshza · an imperial guard · **Blood of Ssraeshza**.

**Spawn chain (agent `BOSS_SPAWN_CHAINS`)** — *Blood of Ssraeshza* dies →
**Emperor spawns exactly 2:00 later** and tank-busts on spawn. Our nights agree:
Blood precedes Emperor on **6 of 8** shared nights.

**Tank Buster** — *Rage of Ssraeshza* (spell **2310**, the only entry in
`npc_spells_id 227`): SPA 11 base 10 = **−90 % attack speed**, SPA 79 base
−4000 = a **~4,000 non-melee hit**. Zero cast time and **no cast or land
message** — undetectable by text, so the agent detects the damage line. Cadence
**~60 s**; pre-warn 10 s out.

---

#### 📢 Callouts that fire here

| Callout | Source | Health |
|---|---|---|
| **TANK BUSTER** + 60 s countdown, 10 s pre-warn | agent built-in `_checkTankBuster` (#142, agent 3.4.5+, stable since Mimic 2.0.2) | ✅ observed |
| **"Emperor in 2:00 — Paladin ready to DA the spawn buster"** + 10 s "Paladin DA NOW" | agent built-in `BOSS_SPAWN_CHAINS` | ✅ |
| New Rampage · Low on HP (≤30 %) | guild triggers | ✅ observed (12 / 4 fires) |
| ~~Emperor Ssra Tank Buster — countdown~~ | guild trigger, **DISABLED 2026-07-31** | ⛔ superseded by the agent built-in — re-enabling gives every raider two countdowns and two TTS per bust. Its pattern also never matched: `^`-anchored (the agent tests the raw line *including* the `[Thu Jul 31 …]` prefix) and its `[1-3]\d{3}` band excludes the canonical 4,000 hit. |

*The last row is the point of this block. That paragraph currently lives only
in a `guild_triggers.notes` field nobody reads. Surfacing it is exactly the
knowledge a Guide is for.*

> ⚠ Open, from the raid-night field reports: **"PALADIN D.A. NOW" should fire at
> 2:00, not 2:10** — the spawn cycle is 2 m 10 s and the callout wants to be 10 s
> ahead. Also unresolved: a buster countdown was seen on screen that the
> disabled trigger cannot explain, so confirm the agent path is not
> double-firing.

---

#### 🐌 Debuffs — what sticks

**Emperor cannot be slowed.** Catalog row 162491 is **MR 1000 / PR 1000**, and
in the full 7-day observation window **no slow spell landed on him** — the
Shaman/Enchanter slow set (Turgur's, Cripple, Tepid/Forlorn Deeds…) does not
appear once. The only "slow" on this fight is his own *Rage of Ssraeshza*
landing on **us**.

DoTs and debuffs that **were** observed landing on Emperor (2026-07-31, 145 →
4 landings, top of list):

`Occlusion of Sound` 145 · `Tuyen's Chant of Flame` 144 · `Spirit Curse` 56 ·
`Plague of Insects` 45 · `Funeral Pyre of Kelador` 43 · `Immolate` 41 ·
`Ignite Blood` 38 · `Boil Blood` 30 · `Heat Blood` 28 · `Greenmist` 27 ·
`Bolt of Karana` 25 · `Torment` 20 · `Vexing Mordinia` 18 · `Hand of Ro` 15 ·
`Malosini` 12 · `Shroud of Hate` 12 · `Shroud of Pain` 10 ·
`Obsidian Shatter` 8 · `Splurt` 5 · `Tashan` 4

> **This block is the reason the Guide accretes.** Every number above comes from
> a table with a **7-day** retention window (`buff_casts`, oldest row
> 2026-07-26). Without the nightly snapshot, this section is empty for any boss
> we did not kill in the last week.

---

#### 💀 What usually kills us

**8 deaths across 21 recorded engagements** — Emperor is not a wipe boss for
us, he is a long boss.

| Who | Class | Deaths |
|---|---|---|
| Fungalfist | Shaman | 2 |
| Jabouti | Shaman | 2 |
| Hawkner | Paladin | 1 |
| Kabanab · Lenolshot · Rorschach | — | 1 each |

*Coverage caveat, shown on the page: **no contribution carried a `deaths` field
before 2026-07-01**, so this counts July onward only. Older fights are blank,
not death-free.*

---

#### 💰 Loot & what it goes for

**13 items drop only from Emperor Ssraeshza** (of 38 on his table — the other
25 are spell/song scrolls and shared drops, listed collapsed with no prices):

| Item | Awarded | Avg DKP | Max DKP |
|---|---|---|---|
| Koadic's Robe of Heightened Focus | 2 | **387** | 550 |
| Torque of the Wyrmlord | 2 | 237 | 303 |
| White Ornate Chain Bridle | 7 | 214 | **420** |
| Shawl of Awakenings | 4 | 147 | 190 |
| Caen's Bo Staff of Fury | 3 | 142 | 334 |
| Velvet Slippers of Harmony | 3 | 122 | 242 |
| Azaliil's Ring of Analogies | 6 | 95 | 143 |
| Envenomed Moccasins | 7 | 79 | 175 |
| Acrylia Handled Broadsword | 9 | 65 | 169 |
| Gebron's Demented Cloak | 5 | 53 | 71 |
| The Sword of Ssraeshza | 4 | 41 | 67 |
| Spell: Garrison's Superior Sunder | 6 | 34 | 151 |
| Shield of Mental Fortitude | 8 | 29 | 140 |

*DKP is from OpenDKP awards matched by item name. OpenDKP records item→raid,
not item→boss, so the match is sound only for sole-source items — which is why
the shared ones carry no price.*

---

#### 🗿 Catalog card *(row 162491, merged — see §6.1)*

Level **66** · HP **1,250,000** · AC **700** · melee **283 – 904** ·
MR **1000** · FR 60 · CR 75 · DR 150 · PR **1000** · class Warrior · runspeed 0
(**does not move**) · spawn `ssratemple` (1000, −325, 421.1), 100 % chance,
catalog respawn 156 h.

**Our fights corroborate this row:** median raid damage 1,211,014 =
**96.9 %** of the listed 1,250,000 HP. *(The shell row's 1,000,000 would put us
at 121 % — impossible.)*

---

#### 📜 Fight log
13 complete kills + 8 other engagements → `/parses/[id]` deep links. *(This is
today's `/boss/162065` table, absorbed.)*

---

### And the zone run sheet — `/guide/zone/ssratemple`

Derived order (pairwise, ≥4 shared nights, win-rate as confidence):

1. a glyph covered serpent — 32 nights
2. Vyzh\`dra the Exiled — 10
3. Rhag\`Zhezum — 16
4. Vyzh\`dra the Cursed — 10
5. Rhag\`Mozdezh — 19
6. Arch Lich Rhag\`Zadune — 8
7. Xerkizh The Creator — 8
8. High Priest of Ssraeshza — 8
9. **Blood of Ssraeshza** — 8 → *chains to* →
10. **Emperor Ssraeshza** — 19 *(Blood first on 6 of 8 shared nights, 75 %)*

Σ median kill times ≈ **the expected clear**, and each row carries its own
median so a raid leader can see where the night actually goes.

---

## 9. Where it lives

| Surface | Role | Gate |
|---|---|---|
| **`/guide`, `/guide/[bossId]`, `/guide/zone/[short]`** | **Canonical.** Everything above. | Member (signed-in), same as `/raid/review` and `/parses`. |
| `/admin/guide/[bossId]` | The authoring surface — one form per section, live preview of the generated blocks beside it so the author writes *against* the facts. | Officer (`isOfficer()`). |
| **Discord `/brief <boss>`** | The condensed card: approach (authored), the 3 numbers, the callouts, the top 3 loot lines, link to the page. This is **#78's delivery mechanism**, and the queue is explicit that "the Discord pipe is the adoption engine". | Existing slash-command gate. |
| Raid-night thread auto-post | When a boss timer fires / on `/raidnight` open, post the brief for tonight's targets. **Opt-in per boss**, off by default — this is the thing that becomes spam. | — |
| Mimic **Mob Info** overlay | A "Guide" line on the Stats tab: median kill time + the one-line approach + a deep link. Reuses the existing `mob-info` endpoint's 6 h cache; **no new overlay** (the parity checklist is expensive; do not add a window for this). | — |

**Public?** No. Same reasoning as wpqdi (`DESIGN-wpqdi.md` decision 1): the
Guide contains named deaths, named DKP prices, and attendance-shaped data, and
keeping one gate means no public-RLS work and no second stripped surface. If
Hitya wants a recruiting-facing subset later, it is a separate read-only render
of blocks 1/3/10 only.

**Naming/route is Hitya's call.** The roadmap already ships the title *"The
living Wolf Pack Raid Guide"* to members (`roadmapData.ts:1118`). `/guide` vs
`/raid/guide` vs `/pack-guide` — propose, do not decide (CLAUDE.md: release
names are the guild lead's).

---

## 10. Phasing — the minimum that is genuinely useful, and how it reaches 133

### Phase 0 — one page, no new tables *(S)* — **BUILT on this branch**
`/guide` + `/guide/[bossId]` rendering blocks **1, 3, 9, 10, 11**, plus a
read-only Approach block sourced from the existing empty
`bosses_local.strat_notes`. Additive: two routes, one pure lib, one nav line,
zero schema, zero writes.

**Why it is already useful:** it works for **all 99 bosses with parses on day
one**, with no authoring at all. A raider gets "how long does this take, what
does it drop, what does it go for, what are its real stats" — which is the
question actually asked in `#raid-chat` before a pull.

Two things phase 0 does that are worth calling out because they are the design
earning its keep on day one:

- The **⚠ catalog-provenance banner** fires automatically wherever the keyed row
  is a shell — so the first person to open Emperor's page is told, in the page,
  that its stats come from row 162491. That is #171's finding, surfaced.
- The page **states its own exclusions** ("13 complete kills of 21 recorded
  engagements · not counted: 6 fragments, 2 timer-only rows"). A guide that
  hides its denominator is how you get an officer who does not trust it.

Deliberately **absent** in phase 0 (rather than rendered from expiring streams):
blocks 4–8. The page says so, in one line, at the bottom.

### Phase 1 — authored content *(M)*
`boss_guide_notes` + `boss_guide_note_revisions` + `/admin/guide/[bossId]`
editor + staleness banner (§5.3) + overrides (§5.5). Migrate anything in
`strat_notes` and stop reading it.

**Seed strategy — do not ask for 128 essays.** Seed the *approach* section for
the ~12 bosses we actually raid on repeat from three sources that already exist
in the repo and need only transcription: the agent's `BOSS_SPAWN_CHAINS` /
`AOE_DANCE` comment blocks, `guild_triggers.notes` (the Emperor row above is a
finished paragraph), and the `STATUS.md` raid-night field reports. One officer,
one sitting.

### Phase 2 — accretion *(M)*
`boss_guide_observations` + the midnight-chain rollup (`utils/guideRollup.js`)
+ a one-shot historical backfill. Blocks **5, 7, 8** switch from "recompute
what survives" to "read the archive". This is the phase that makes the Guide
compound.

### Phase 3 — reach *(M)*
Zone run sheets, Discord `/brief`, Mimic Mob Info line, the callout-health ⚠
(§6.5), the empirical mechanic map.

### How it scales to 133 without 133 authors

1. **Every boss has a page from day one.** No page waits on a human.
2. **Blocks are independently gated on data**, so a boss killed twice shows two
   blocks and a boss killed sixty shows twelve. Nothing is broken, just shorter.
3. **Authoring is a worklist, not a prerequisite** — `/guide` sorts by
   `kills desc, has_notes asc`, which is exactly "the bosses most worth writing
   about that nobody has written about".
4. **The Guide gets better without anyone touching it**, because every raid
   night writes 5–10 observation rows. That is the property that makes it
   survive the enthusiasm curve that kills every wiki.

---

## 11. Implementation map (so the build is mechanical)

| File | New/edit | Contents |
|---|---|---|
| `web/lib/raidGuide.ts` | ✅ **built** | Pure kernel: `normalizeNpcName`, `resolveCatalogRow` (#171 merge), `hpCorroboration`, `median`, `bucketEncounters`, `killStats`, `attributeLoot`, `pairwiseOrder`, `precedence`, `staleFacts`. No React/Next imports (so root vitest can real-import it, the `raidReview.ts` pattern). |
| `test/raid-guide.test.js` | ✅ **built** (30 tests) | Row-picker merge on the real 162065/162491 pair (incl. order-independence and `runspeed 0` not being treated as missing), HP corroboration both ways, the damage floor rejecting the 81 s/198 k fragment a duration floor admits, sole-source loot pricing, pairwise order beating average-slot on a Blood/Emperor fixture (with the naive version asserted *wrong* so the regression is explicit), staleness thresholds. |
| `web/app/guide/page.tsx` | ✅ **built** | Index / authoring worklist. PoP rows locked + greyed. |
| `web/app/guide/[bossId]/page.tsx` | ✅ **built** | Block renderer. Server component, `force-dynamic`, `supabaseAdmin()` reads (catalog pages' pattern). |
| `web/app/guide/zone/[short]/page.tsx` | **new** (phase 3) | Run sheet. |
| `web/app/admin/guide/[bossId]/page.tsx` + `actions.ts` | **new** (phase 1) | Officer editor. Optimistic `useState`+`useTransition`, server actions in `actions.ts`, `revalidatePath` only — the `/admin/triggers` pattern. |
| `utils/guideRollup.js` | **new** (phase 2) | `rollupNight(nightKey)`; called from the midnight chain next to the parse consolidation. Idempotent upsert. |
| `web/lib/raidReview.ts` | **edit** (§3.1 ask, phase 2) | Export `isPersonalFailFire()` + `collapseFires()` — pure lift out of the review page. **This is the only shared-file edit; #80 must agree.** Not needed until blocks 5/6 exist, so phase 0 does not touch it. |
| `web/components/Nav.tsx` | ✅ **built** | One nav entry (`📖 Raid Guide`). |
| `docs/HOW-ITS-BUILT.md` | ✅ **built** | Feature entry (CLAUDE.md rule). |
| `web/lib/roadmapData.ts` | **deferred to the coordinator** | Release entry + move #81 from the queue. Five fleet agents each prepending to `releases[]` is a guaranteed conflict — the coordinator writes one entry for the batch. |

**Gates (run on this branch):** `npx vitest run` — baseline **32 files / 375
tests** on `origin/main` @ 2051ac1, now **33 / 405**, no pre-existing test
modified. `npx tsc --noEmit` clean. `npx next build` green, emitting `ƒ /guide`
and `ƒ /guide/[bossId]`. No agent/Mimic surface is touched, so no
`check:dashboard`.

---

## 12. Risks, non-goals, and open questions

**Risks**
1. **The #171 row picker is a hard dependency.** Without it, blocks 9 and 10
   are wrong (or empty) for every `#`-prefixed Quarm-custom boss — which is most
   of the Luclin/VT set. #171 is in this same fleet batch; if it slips, phase 0
   ships with blocks 9/10 suppressed rather than wrong.
2. **Loot inference over-claims if the sole-source rule is dropped.** It will be
   tempting ("we only show 13 of 38 items!"). Do not drop it without the
   raid-date intersection.
3. **Cost of block 8 at read time before phase 2** — scanning
   `contributions.raw_parse->deaths` for one boss is a jsonb read over every
   contribution for its encounters. Bounded (21 fights × ~13 uploaders for our
   worst case) but it is the one query worth watching; phase 2 removes it.
4. **The staleness banner could become noise** if the thresholds are tight.
   Start loose (25 % / +50 % kills), tune from complaints, never auto-hide.
5. **Auto-posting briefs to the raid thread is the spam risk.** Ships opt-in and
   off by default.

**Non-goals**
- Not a second review generator (§3).
- Not a public wiki.
- Not a replacement for `/db/npc/[id]` or `/parses` — it links to both.
- No attendance / seating logic — that is #92's `member_attendance_metrics`.
- No PoP content before `2026-10-01`.

**Open questions for Hitya**
1. **Route + name.** `/guide` vs `/raid/guide`? The member-facing title is
   already "The living Wolf Pack Raid Guide".
2. **Who may author?** Officers only, or any Pack Member with an officer
   approve step? (Recommendation: officers write, everyone can file a
   correction through the existing `feedback` pipeline — same mechanism the
   roadmap queue uses, prefixed `[guide <boss>]`.)
3. **Auto-post the brief to the raid-night thread for tonight's targets?**
   Recommendation: build it, ship it off, turn it on for one night and ask.
4. **Do we want the Emperor "PALADIN D.A. NOW at 2:00 not 2:10" fix folded into
   this work,** or does it stay its own task? It is the first thing a real
   Emperor guide page would say is wrong.
5. **Backfill depth for phase 2** — walk all nights back to 2024-12-31 (cheap,
   but pre-July nights have no deaths/mechanics and will look empty), or start
   the archive at 2026-06-05 where `encounter_events` begins?
