# How X Is Built — feature-by-feature reference

Per-feature "how does this actually work" map for the whole platform, so a
future session (or a human) can find the moving parts without re-deriving
them. `CLAUDE.md` stays the terse authoritative architecture; this file is the
long-form companion. When they conflict, `CLAUDE.md` wins. Update the relevant
entry when you materially change a feature.

Component paths: bot = `/index.js` + `commands/` + `utils/`; agent =
`packages/wolfpack-logsync/index.js`; Mimic = `apps/mimic/`; web = `web/`.

---

## Data spine (read this first)

Everything flows through one pipeline: **EQ log file + Zeal named pipe →
agent (on the player's PC) → bot HTTP API (bearer per-user token) → Supabase
→ (web reads Supabase) / (bot posts Discord) / (agents poll bot)**. The agent
never talks to Supabase or Discord directly; the web never talks to the bot
or agents directly (one exception: nothing — even /me/ui edits go
web→Supabase→bot-served→agent). Discord itself is the durable store for
parses/hate/roster state (env-var-anchored threads); Supabase is the durable
store for everything analytical; `data/*.json` are local mirrors with atomic
writes.

## Identity & auth

- **Agent → bot**: per-user bearer tokens minted at Mimic sign-in
  (`mimicLink.requireAgentAuth` on every `/api/agent/*` route). `/token` in
  Discord lists/revokes sessions. Every upload is traceable to a Discord id.
- **Web sign-in**: Supabase Auth Discord OAuth; callback checks guild
  membership + role names (`ALLOWED_ROLE_NAMES` via `wolfpack_roles`).
  Officer gating = `isOfficer()` per request server-side.
- **Character ownership** (who may see/edit a character's private data): the
  household+family walk — `wolfpack_members.user_id → discord_id` (+
  `merged_into_discord_id` aliases) → `characters.discord_id` anchors →
  OpenDKP family closure over `main_name`. Canonical implementation:
  `loadOwnedCharacters` in `web/app/me/page.tsx` (mirrored in
  `web/app/me/ui/actions.ts`).

## Release & deploy pipeline

- **Branches**: `main` ships bot (Railway, deploy name = merge commit
  message) + web (Vercel) + stable Mimic; `beta` ships Mimic/agent betas.
- **Mimic releases**: `.github/workflows/release-mimic.yml` triggers on
  `apps/mimic/package.json` version change. Tag = `v<version>`; **pushes to
  `beta` are forced to `v<version>-beta.1`** (added 2026-07-06 after the
  whole 1.4.x line accidentally shipped stable) → prerelease flag + `beta.yml`
  channel. Keep versions PLAIN in package.json on both branches. Client-side:
  the tray "Receive beta updates" toggle / a `-beta` install sets
  `autoUpdater.channel='beta'` + `allowPrerelease`;
  `generateUpdatesFilesForAllChannels` publishes `latest.yml` + `beta.yml` on
  every build. Web `/mimic` filters `prerelease:false`; `/mimic/beta` prefers
  prereleases.
- **Standalone parser zip**: `release-parser.yml` on version-shaped tag pushes
  (API-created tags from the Mimic workflow don't re-trigger workflows).
- **Migrations**: timestamped idempotent SQL in `supabase/migrations/`,
  auto-applied on merge to main; apply via Supabase MCP `apply_migration`
  with the same name when prod needs it immediately, and commit the identical
  file.
- **CI gates**: `test.yml` (lint no-undef + `check:dashboard` + full vitest)
  and **`golden-log.yml`** (#75 — the agent parser regression net, see below).
  Both run on PRs and on pushes to `main` + `beta`. `raid-freeze.yml` is the
  advisory red X for a main push inside a raid window.

---

## Bot features

### Raid timers & boards
`data/bosses.json` (hot-reloaded, 133 bosses) defines spawn windows.
Kills arrive via `/kill`-family commands or agent `bosskill` uploads
(instance kills auto-start timers). `#raid-mobs` holds four fixed message
slots + one thread per expansion (cooldown card, zone kill cards, board
panels) — all **edited in place** by message id; anchor ids resolve
`process.env.<KEY>` → `state.channelSlots` → null so they survive volume
loss. A 5-min spawn checker fires alerts (suppressing stale ones
post-redeploy); a TZ-aware midnight chain posts the daily summary, archives,
consolidates parses, and resets. PvP-server and Plane-of-Hate variants have
their own timer math (±20% variance, quakes) and their own boards.

### Parse aggregation
Agent `encounter` uploads and manual `/parse` pastes both land in
`recordParse` (`utils/supabase.js`): `find_or_create_encounter` RPC dedups by
npc + ±30-min window, `merge_encounter_players` keeps max-damage-per-player
across submitters. Session-blob guard drops "encounters" >30 min.
`contributions.raw_parse->source` distinguishes `local_agent_v1` /
`eqlogparser_send_to_eq` / `chat_extracted` so agent data wins.
`encounter_combat_rollup` stores per-verb detail for uploads at/after the
watermark (`has_ability_detail`). Parses Log Discord thread is the recovery
source (`PARSES_LOG_THREAD_ID` reloaded on startup; `/recoverkills` from
Supabase).
**Charm-pet attribution** (bot 3.0.239–241, the Blood-of-Ssraeshza fixes):
`state.petOwners` holds TIMESTAMPED declarations (`[{o, at}]`,
`petOwnerEntries` normalizes legacy shapes; cleared at midnight). The
per-upload fold splits a pet name's damage equally among owners with a
CURRENT claim (declared ≤15 min before fight start or during —
`PET_CLAIM_FRESH_MS`), falling back to the single newest declaration; it
NEVER splits across the night's accumulated list. The parse card lists the
pets in a 🐾 Charmed field with their split. Same-named simultaneous charms
stay one bucket until Zeal ships spawn ids
(`docs/zeal-spawn-id-request.md`).

### Raid-night threads (`utils/raidNight.js`)
One Discord thread per raid night, created **lazily** on that night's first
parse card or loot post and named exactly like `/raidnight` names its own
(`🗡️ Raid Night — Thursday, July 31, 2026`; `todayLabel`/`todayDateKey` in
`commands/raidnight.js` delegate to the shared formatters, so both surfaces
build the same string and adopt each other's thread instead of creating
twins). The **night key spans midnight** — a timestamp is pulled back over
`RAID_NIGHT_ROLLOVER_HOUR` (default 6) before its date is taken, so a 23:50
Thursday kill and a 00:20 Friday kill share one thread. Resolution order:
`RAID_NIGHT_THREAD_ID` env pin → memory cache → `channelSlots.rn_<key>` →
an open `/raidnight` session for the same night → an active thread with the
same **name** (how it recovers from volume loss) → create. Single-flight, so
concurrent agent uploads can't race two threads open; failures back off 60s
and callers fall back. Parent (v2): `RAID_NIGHT_THREAD_PARENT_ID` →
`RAID_CHAT_CHANNEL_ID` → the **known #raid-chat id `1193692008812920863`** →
`TIMER_CHANNEL_ID`, each candidate permission-checked and every rejection
logged (`[raid-night] parent …`). v1 stopped at `RAID_CHAT_CHANNEL_ID`, which
is unset on Railway, so night one's threads all landed in #raid-mobs.
`RAID_NIGHT_THREADS=0` disables.
Consumers: the deferred autoparse card in `_handleAgentEncounter`
(fallback `AUTOPARSE_TEST_THREAD_ID` per `AUTOPARSE_QA_COPY`; card state
carries `channelId` so a destination change posts fresh instead of a
cross-channel edit), `_handleAgentLootPost` (fallback `LOOT_CHANNEL_ID`) and
`handleLootPost` — the last two **raid-flow only**.
**The canonical parse record never moves** — `logParseToDiscord` still writes
the `📊 Parse Log` JSON embed to `PARSES_LOG_THREAD_ID`, which is the only
thread `loadParsesFromDiscord`, `/restore` and the midnight consolidation
read. Night threads carry the presentation copy only.

### Staged raid-attendance ticks (`utils/raidTick.js` + `index.js` capture loop)
Automatic capture of who is in the raid at **20:30 / 21:30 / 22:30 / 23:30 ET**
on Sun/Wed/Thu, into `raid_attendance_ticks`. **Capture only — nothing is
submitted.** `utils/dkpTick.js` `submitRaidTick()` is a working OpenDKP write
path and this deliberately never calls it; filing a tick stays an officer action.
Slot names mirror the real ticks (`Tick 1 (Raid Start)` … `Tick 4 (Raid End)`).
Load-bearing details:
- **It must capture live; the data cannot be reconstructed.** `raid_roster` is a
  LIVE view — PK `(guild_id, uploaded_by_discord_id, name)`, so each agent
  overwrites its own rows every few seconds — and the midnight chain prunes it to
  `RAID_ROSTER_RETENTION_HOURS` (default ONE hour). Who was in the raid at 8:30
  is unrecoverable by 9:30. A corollary that WILL mislead you: querying
  `captured_at` in a past window does NOT reconstruct a past roster, it returns
  whoever's row went stale then. Retrospective checks under-count; don't "verify"
  the feature that way.
- **Union across agents, not one agent's view.** Zeal's type-5 event shows the
  whole raid to everyone in it, but a client that just zoned reports a partial
  roster — and dropping a raider is the exact failure this exists to prevent.
  Cost: a concurrent splinter raid merges in (this does NOT do the union-find
  clustering `index.js` uses for the buff queue). Safe because nothing is
  submitted; `uploaders` is stored so a wide union is visible.
- **Paginated read.** A live raid is ~17 agents × ~55 raiders ≈ 935 rows, against
  PostgREST's hard 1000-row cap — silent truncation would drop raiders.
- **Idempotency is the `(guild_id, night_key, slot)` unique index**, not a
  `bot_kv` latch: the insert loses the race, so there's no read-then-write window.
  A cheap pre-check avoids paging five times a window but is NOT the guard.
- **`insert()` cannot report success** — `utils/supabase.js` `_request` never
  throws and returns `null` for both an empty-body 201 and any 4xx — so the write
  is confirmed by reading it back.
- Scheduling copies the pre-raid health check: 60s interval reading wall-clock ET,
  which survives the restarts a `setTimeout` chain does not. 5-minute firing
  window (`RAID_TICK_FIRE_WINDOW_MIN`) so a deploy across the hour can't skip a
  tick; past the window it skips rather than attributing the wrong people.
- `RAID_TICK_MIN_NAMES` (5) is the "(if we don't end early)" rule — mostly
  self-enforcing, since a disbanded raid produces no type-5 event and the rows
  age out. `RAID_TICK_CAPTURE=0` disables.

### Raid Night Review (`utils/raidReview.js` + `commands/raidreview.js`) — #80
The morning-after writeup, generated instead of hand-built. **Two surfaces, ONE
generator each — do not add a third.** Web: `/raid/review` (index) +
`/raid/review/[date]`, shipped 2026-07-23, pure helpers in `web/lib/raidReview.ts`.
Discord: `utils/raidReview.js` builds an embed (kills timeline · standouts ·
OpenDKP loot · tick attendance · "what to work on" · one fun line) and posts it
into **that night's raid thread** via `getRaidNightTarget`, linking out to the
web page. Design + the content cuts: `docs/DESIGN-80-raid-night-review.md`.
Load-bearing details:
- **Anchored on the night's FIRST ENCOUNTER**, never `Date.now()` — by the time
  the review runs the scheduled-event window has closed, so "now" can plan a
  different key and mint a SECOND thread. `planFor` runs first so an off-night
  event bails before `getRaidNightTarget` would open a 🎲 thread.
- **Scheduled, not posted, by the midnight chain.** `scheduleRaidNightReview` is
  the chain's LAST link: synchronous, try/caught, no network — it arms a timer
  for `RAID_REVIEW_DELAY_MIN` (45) so the 00:30 raid tail is included and a
  failed review can never stop archives/consolidation/resets.
  `catchUpRaidNightReview` re-posts on boot (a deploy right after the 00:30
  freeze lift kills the timer).
- **Idempotent**: message id in `bot_kv` (`raid_review_msg_<nightKey>`), with
  `state.json` only as a local mirror — a re-run EDITS. It was state.json-only
  and that file does NOT persist on Railway, which is how eleven redeploys
  produced eleven copies of one night's review (bot 3.1.8).
- **Reserves the top two slots of the thread** (bot 3.1.21, R3). Discord orders
  a thread by post time and cannot move a message, so `reserveReviewSlots()`
  posts two placeholders at thread CREATION (`utils/raidNight.js` `_resolve`
  step 4) and the review EDITS slot 1 into first position. Slot 2 is the
  overflow landing spot for a review that exceeds `EMBED_BUDGET`, and the final
  review DELETES it if unused. "Unclaimed" is just "not the stored review id" —
  no claimed-flag bookkeeping — so a failed edit retries the same slot.
- **Intentional deaths** (bot 3.1.21, R2): standing per-(character, `npc_id`)
  rules in `intentional_death_rules`, set by officers from `/parses/[id]`
  (`web/app/parses/actions.ts`). They are excluded from `worstFights` — "what to
  work on" — and NOWHERE else: the death keeps its place in the headline count,
  the deaths list and the timelines, and the header reads "5 deaths (2 on
  purpose)". `docs/DESIGN-intentional-deaths.md`.
- Death counts come from `contributions.raw_parse->deaths` through the shared
  `utils/parseDeaths.js` dedup (#134) plus a 60s cross-encounter collapse, so
  the review, the parse card and the web page never disagree. Those timestamps
  are CLOCK-CORRECTED at ingest (`utils/clockOffset.js`, bot 3.1.20): a death's
  `ts` is rewritten to server time using the uploader's measured offset and the
  original kept as `tsRaw`, because an install running 63s slow put its copy of
  a shared death outside the 30s dedup window and it escaped as a phantom
  second death. The midnight
  compaction nulls `raw_parse` after 7 days — older nights render without deaths.
- Night window = rollover→rollover (spans midnight, matches the thread). The
  shipped web page still buckets by plain ET calendar day — known, documented
  divergence for post-midnight kills.
- `RAID_REVIEW=0` kills the automatic post; `/raidreview [date] [preview]` is the
  officer escape hatch. Regression: `test/raid-review-post.test.js`.

### Outcome-driven backfill requests (`utils/backfillScan.js` + `commands/backfillscan.js`)
Finds fights whose parse is demonstrably wrong and proposes the 2-3 people whose
log would settle it — then files into the EXISTING `agent_backfill_requests`
pipeline (no new table, no new endpoint, no agent change). Design + threshold
derivation: `docs/DESIGN-outcome-backfill.md`.
- **Detect.** `INFLATED` = one upload ≥1.30× the mob's HP pool **AND** ≥1.50× the
  median of its siblings, on an encounter with ≥4 uploads. Both gates, always:
  the sibling gate alone fires on 21% of uploads, the pair on 1.1%. `THIN` =
  a confirmed kill whose merged damage is <0.35× the pool (nobody's log covered
  it). The HP pool comes from `mobSpecials.pickAndMergeMobRows()` with
  `zoneId = npc_id/1000`, **not** the keyed row — `encounters.npc_id` for the
  Emperor points at the 1.0M placeholder body, the real one is 1.25M.
- **Target.** Hard gates: on the consensus parse, ≥20 melee-verb hits in
  `encounter_combat_rollup.by_skill` (or ≥10 defender hits) as a positional
  proof, uploaded something in the last 14d, didn't already upload this fight,
  not the suspect, not `exclude_from_stats`, no open ask for the same
  `start_iso`. Then score: melee +40 / whole-fight +25 / tank class +20 /
  took ≥2k +15 / alive +10 vs died −25. Deaths via `dedupParseDeaths` (#134).
- **The 92 stale pending rows** are a TARGETING failure, not a lifecycle one:
  50 of their 58 characters have never uploaded a contribution. Proposed
  cleanup is a new terminal status `expired` (no migration — the agent poll
  already filters `status=in.(pending,acked,running)`), swept on the **log**
  window at 45 days. NOT applied — the one-off SQL is in the design doc.
- **Officer-triggered only.** `/backfillscan [date] [apply] [expire]` previews by
  default; no timer, no midnight-chain hook, no DM (delivery stays the pull-based
  agent-dashboard 📋 banner). Automatic filing is parked pending Hitya's sign-off.
- Validation: over the 2026-07-30 night (13 fights, 118 uploads) it flags exactly
  the three `state.petOwners` casualties and nothing else; 24 of the last 42
  nights flag nothing at all. Regression: `test/backfill-scan.test.js` (fixtures
  are the verbatim night).
**LIVE during the raid (2026-08-02, `docs/DESIGN-live-raid-review.md`).** The
card is written from the first pull and *grows into* the morning-after review —
**same message, same `rreview_<nightKey>` slot**, so the 00:45 post edits the
live card rather than adding one. Load-bearing:
- **Hook**: ONE post-ack block in `_handleAgentUpload` calling
  `raidReview.noteEncounterUpload({...})` — synchronous, try/caught, never
  awaited, skipped on backfill. It passes a **signal, not combat data**: every
  number still comes from Supabase via `summarizeNight`, so the live card can
  never disagree with the parse card. `test/raid-review-post.test.js` §(f)
  source-slices `_handleAgentUpload` to pin that (mutation-verified).
- **Cadence**: `RAID_REVIEW_LIVE_DEBOUNCE_SEC` (60) after the last upload,
  floored by `RAID_REVIEW_LIVE_MIN_SEC` (300) between edits — ~20 agents
  uploading one kill produce ONE edit. `RAID_REVIEW_LIVE=0` is the mid-raid kill
  switch (the 00:45 review survives it). `_finalDone` stops any late live timer
  overwriting the finished writeup.
- **Cost**: `collectNightData(win,{live:true})` caches the cold slices (roster,
  zones, 90-day history, pace baseline 6h; OpenDKP + fun events 10min) so steady
  state is **2 queries per refresh**. Caching is live-only — the 00:45 review and
  `/raidreview` issue the identical queries they always did.
- **Live-only content**: in-progress fight, last-kill time, and pace vs our own
  trailing raid nights. Times use Discord `<t:…:R>` so they keep ticking with no
  edit. Pace requires ≥3 prior nights with ≥5 kills **that were scheduled raid
  nights** — without that filter weeknight six-mans drag the median to 2.
- **🕒 Timelines**: web renders the REAL `FightTimeline` (#98) per fight (deaths
  + `encounter_events` raid events/fires, scoped to the night's encounter ids);
  Discord renders a 12-cell death sparkline linking to `/parses/<id>`. Both plot
  only deaths INSIDE `[start−30s, end+30s]` — the ±30min encounter-dedup window
  lets a fight carry an earlier add's deaths, which `FightTimeline` clamps onto
  t=0 and reads as a wipe that never happened (2026-07-30 Xerkizh).
- **🐜 Trash**: **`encounters` is boss-only** — `recordParse` no-ops without a
  `bosses_local` row (verified: 1521/1521 encounter rows have one; `bosses_local`
  holds 128 bosses). So trash exists ONLY in the upload stream. The bot tallies
  it in memory (dedup key `<mob>|<30s bucket>` ± neighbours, max-kept damage) and
  persists to **`bot_kv` → `raid_trash_<YYYY-MM-DD>`** on the refresh cadence;
  the web review reads the same key. No migration; a durable
  `raid_night_trash` table is proposed (not applied) in the design doc.

### Event-driven posting windows (`utils/raidEvents.js`) — v2, 2026-07-31
Which thread a timestamp wants is decided by the guild's **Discord scheduled
events**, not a weekday table. `guild.scheduledEvents.fetch()` is a REST call,
so no new gateway intent and no new credential; results are cached
(`RAID_EVENT_CACHE_MS`, default 5 min), single-flight, and held in a sticky map
so an event Discord stops listing (status → COMPLETED) still resolves through
its own tail. **Window = start − `RAID_EVENT_PRE_MIN` (30) … end +
`RAID_EVENT_POST_MIN` (15)**; an event with no end time is assumed
`RAID_EVENT_DEFAULT_HOURS` (4) long. Overlapping windows resolve to the event
whose *start* is nearest the timestamp. **Raid-Helper is enrichment only** —
read from the `rh_events` mirror `utils/raidhelperApi.js` already syncs (needs
the existing `RH_API_KEY`; the mirror is empty as of 2026-07-31, so this path
is unverified in prod) and it can only fill an end time or add an event Discord
never got. Everything fails open to "no event scheduled".
**Classification** (`classifyEvent`): the raids themselves are Discord events,
so the NIGHT decides — `RAID_EVENT_RAID_DAYS` (default Sun/Wed/Thu) at/after
`RAID_EVENT_RAID_FROM_HOUR` (17) is the raid flow, everything else the event
flow; `RAID_EVENT_RAID_PATTERN` / `_SOCIAL_PATTERN` are optional title
overrides. Outside every window, `RAID_NIGHT_FALLBACK` (`schedule` default /
`always` / `off`) decides whether the v1 weekday behaviour still applies.

### Off-night event threads + roll loot (`utils/rollLoot.js`)
A non-raid guild event threads in **#event-chat** (`EVENT_CHAT_CHANNEL_ID` →
known id `1194336972785848380`) as `🎲 <title> — <date>` and gets **no DKP
posts**. Its loot content is #91's roll capture: `roll_sets` (multi-uploader
`/random` sets: item, assigned range, qty, rolls) joined to `looted_items`,
merged with `utils/hotDiceNight.js`'s `mergeRollSetRows`/`sessionWinner` (the
same math as the Hot Dice award and `web/lib/rolls.ts`) into one card —
item · roll range · winners · "looted by X" when the looter isn't a winner —
edited in place (`state.channelSlots.rollcard_<threadId>`). Refresh is driven
by the `rolls`/`looted` ingest handlers post-ack and debounced 45s, never a
timer. Parses reach the same thread as ordinary autoparse cards.

### Parse-card volume filter
`raidNight.parseCardPassesFilter` gates what reaches a night/event thread:
known bosses always pass, everything else needs
`RAID_NIGHT_THREAD_MIN_SECONDS` (15) **and** `RAID_NIGHT_THREAD_MIN_PLAYERS`
(3); `RAID_NIGHT_THREAD_BOSS_ONLY=1` is the strict setting and zeroing both
floors restores v1 "post everything". Filtering is presentation only — the
Parse Log embed and Supabase always get every encounter.

### Extended Target aggregation (`_handleAgentExtendedTarget`)
Aggregates every online raider's `character_live_state.target_name` (Zeal
slot 6, freshness window) by name; classifies each name player/pet/NPC
(live raiders → live pets → durable roster via `_rosterNameSet()` →
possessive-pet regex → article-prefix generic NPC). **Only NPCs get target
rows**; allies surface solely via the hurt pass (<hurt% for >min-sec,
tracked server-side in `_extHurtSince` because a snapshot can't answer
"how long"). Same-name mobs split by HP clusters (gap > tolerance) only for
generic names. Corpses and ≤0%-HP mobs are dropped. Unique hurt NPCs persist
in `_extMobLastSeen` for a grace window ("last seen Xs ago" rows); off-tanked
100%-HP mobs surface via `incoming_mob` (agent `recentTankHits`). All
thresholds are remote-tunable (see Overlay tuning). Consumed by Mimic's
`extarget.html` through the agent's 3s-cached proxy.

### Overlay tuning (remote knobs)
`overlay_tuning` table (one jsonb row per guild, numbers only) edited on
`/admin/overlays`. Bot merges overrides over compiled defaults (60s cache,
`_overlayTuningMap`) for the Extended Target knobs and serves the raw object
at `GET /api/agent/overlay-tuning`; every agent polls it every 90s and applies
via `tuneNum(key, DEFAULT)` (off-heal cutoff/window/min-hits, CH GO flash).
Adding a knob = one `tuneNum`/`tn` call at the use site + a catalog row in
`web/app/admin/overlays/page.tsx`.

### Buff / debuff / cure queue (`raid-buff-queue`)
Reads `character_live_state` (online raiders, zone), `buff_casts` history,
class tables, and curse counters (`_CURSE_COUNTERS`) to produce per-buffer
queues: online raiders only, same-zone first, tank-HP priority,
curse-counter sort. MGB-trained set cached from `character_aas`. Served to
agents (3s agent-side cache) for the Buff-queue overlay; "buffs feel laggy"
click drops the agent into snappy mode + reports to the bot for audit.

### Raid nights (`raid_nights` + `linkEncounterToRaidNight`) — 2026-08-04
`utils/supabase.js` creates the night row on the first encounter that resolves
and stamps `encounters.raid_night_id`. Night predicate is
`raidNight.isRaidNightAt`/`nightKey` — the SAME functions the trash tally and
the review's pace calc use, so they cannot drift. Encounters OUTSIDE a raid
window keep `raid_night_id` NULL on purpose (a daytime XP kill is not a raid).
`zone_main` is FK'd to `eqemu_zone`, so an unknown zone retries without it
rather than losing the link. History (193 nights, 1,022 encounters) backfilled
by migration; the SQL reimplements the window and was cross-checked against the
JS on a 30-row stratified sample.

### Target history (`target_observations`) — 2026-08-04
Who was targeting what, over time. The agent has always sent `target_name`
(Zeal slot 6) on live-state and it is EVENT-DRIVEN (a switch uploads
immediately, plus a 45s heartbeat) — but `character_live_state` is keyed
`(guild_id, character)`, so every switch overwrote the last. `_noteTargetSwitches`
appends **on change only**, using an in-memory last-target map (no extra
Supabase read on a hot path), so rows scale with target SWITCHES not samples
(~5k a raid night). Transitions to NULL are recorded too, or an interval never
closes. Intervals derived at read time with `lead()`. Bot-side only, so it
collects from every agent version. **Limits by construction:** Zeal reports only
the LOCAL client's target (coverage = whoever runs Mimic), and same-name mobs
are still not distinguishable.

### Agent clock offsets (`agent_clock_offsets`) — 2026-08-04
Every agent stamps events from its own machine clock, and EQ writes log
timestamps with that same clock — so a slow machine reports slow deaths. Two
independent estimators stored side by side so they cross-check:
`pulse` (agent sends `client_now` on the 20s heartbeat; bot computes
`server_recv - client_now`, EWMA-smoothed, flushed every 5 min) and `consensus`
(for a death with 3+ witnesses the median is truth; needs no agent release so it
reaches history). The consensus pass is TWO-PASS — a single-pass median includes
the skewed observers and is dragged by them. `offset_ms` is signed
server-minus-client; correct a client timestamp with `ts + offset_ms`.
`spread_ms` is the honesty column: high spread = unstable clock, do not trust it.
**Sign convention, stated once because a flipped sign here corrupts every
correction:** `offset_ms` positive = client clock BEHIND (server-minus-client);
the three flagged installs are at **+42s/+14s/+7s**, i.e. their machines read
early-looking timestamps and `ts + offset_ms` moves them forward to true time.
Everyone else is within ±3s. **The bad clocks DRIFT (~1.5–3 s/day) and a
one-time sync doesn't hold** — one was observed synced to ~0 on Jul 26–27 and
was 11s off again two days later — so offsets are a time series, resolved near
the event's own timestamp, never a stored scalar. A third estimator
(`min(created_at − event_ts)` per install per day — server stamp minus agent
stamp, minimum as a latency-free lower bound) needs no agent at all, works on
history, and cross-checks the other two. Full analysis:
`docs/DESIGN-clock-correction.md`.

### Buff-cast spell-id resolution (`_resolveSpellIdByName`) — 2026-08-04
When several spells share one landing message the agent picks a representative,
writes its NAME, then withholds `spell_id` "rather than guessing wrong" — but
those are the same claim, and the cure queue resolves poison/disease COUNTERS
(SPA 35/36) from the catalog, so a 0 meant it could never learn a debuff was
curable. The bot now resolves by the name it was given, accepting it ONLY when
that name is unique in the catalog (cached per name; the vocabulary is ~52 names
a month). Unresolved share fell 34.4% → 0.5%. The two survivors (Ensnare,
Ring of Winter) are true two-candidate names — resolving those wants the
target's own Mimic buff window or the mob's spell list.

### PvP pipeline
Agent `pvp`/`pvp_assists` uploads (kill/death/assist broadcasts + /who
harvest) → dedup (`_isPvpDupe` collapses multi-relayer echoes) → #pvp posts,
`pvp_kills`/`pvp_boss_kills` (+ mirror for web /pvp board), respawn-window
prediction, quake handling (window opens "now", keeps kill history). Own-guild
*instanced* kills post informationally and never tick the open-world timer.
Backfilled (`--since`) kills record but never post/predict.

### Chat relay & historical chat
Live `/gu`+`/rs` relay (`chat`) posts to Discord with fuzzy dedup (drunk-slur
and censor-variant collapsing: same speaker + word count + ≥50% token match)
and an anti-spoof safeguard (`_safeguardSpeaker`: roster/uploader-chars/
corroboration-trusted, else relabel to a trusted witness on the same line).
Historical backfill (`historical_chat`) only fills `chat_messages` — never
replays into Discord. Era-thread routing is deprecated.

### Web UI Studio backend
`ui_snapshots` payloads are AES-encrypted with the bot's `WISHLIST_BID_KEY`
(web can't read them), so the bot extracts what `/me/ui` needs:
`_indexSnapshotSocials` writes `ui_socials_index` (plaintext socials,
service-role-only) at upload time + a one-time startup backfill decrypting
each character's latest snapshot; `_recomputeCommonMacros` (debounced)
aggregates macros on ≥`COMMON_MACRO_MIN_CHARS` (3) distinct characters into
`common_macros` (authenticated-readable — commonality is the privacy filter).
`GET /api/agent/ui-pending-edits` serves web-staged macro edits to agents
(Socials/HotButtons allowlist); `POST /api/agent/ui-edit-result` marks
applied/failed and merges applied edits back into the index.

### Voice triggers
Guild triggers with `voice` actions make the bot join
`RAID_VOICE_CHANNEL_ID` and speak via Edge TTS (no key), volume/skip rules
from `voice_settings` (30s cache; officer ripcord at `/admin/voice`).
`marks` arrays schedule multi-line countdowns off one trigger fire.

### DKP / loot / wishlists / roster / onboarding
OpenDKP scrape+sync (`utils/opendkp.js`) drives membership rank; sealed bids
AES-256-GCM (`utils/bidCrypto.js`, service-role-only columns, bot-only key);
roster persisted as chunked JSON in Discord threads (`utils/roster.js`);
onboarding state DB-backed with `CHANGELOGS` in `utils/onboarding.js`
driving "what's new" DMs; audit trail thread with officer Undo buttons;
member sync Discord→`wolfpack_members` every 6h. Loot announcements (Mimic's
"Post for bidding" → `_handleAgentLootPost`, and `/loot`'s 📣 Post Auctions →
`handleLootPost`) post into that night's raid-night thread and carry the live
auctions link (`opendkpAuctionsUrl()` in `utils/loot.js`, built from
`OPENDKP_CLIENT_NAME` → `https://wolfpack.opendkp.com/#/auctions`). The
`/loot` message itself stays in the officer's channel — it's the staging UI
`interaction.editReply` owns — so the raid-facing copy is a second post.

---

## Agent features

### Log tail & privacy filter
Tails `eqlog_*_pq.proj.txt`. Officer chat, tells, group, custom channels are
dropped at the **byte level before parse** (`docs/PRIVACY.md`). Modes:
`--watch` (default), `--since <ISO>` backfill, `--once`, `--dry-run`.
Dashboard on `localhost:7777` — see the escape-hazard + rendering rules in
`CLAUDE.md` (one giant template literal; run `npm run check:dashboard`).

### Durable upload queue
Every outbound POST persists to `logsync.queue.json`; 15s drain, exponential
backoff to 10m; 4xx drops as permanent. The update gate refuses updates while
the queue is pending / backfill running / fight live (Shift+U bypass).

### Combat parsing → encounters
`parseEvent` + `EncounterBuilder` segment fights; kills require a literal
slain line (no silence-guessing). Pets ride the DPS meter only when provably
OURS (`petLeaders`/`_activeCharms`/charm tracker) and carry `pet_owner`.
Threat tracker (`recentTankHits`) records mob→player connects (player-name
shape = letters only — backtick names are NPC/pets) — feeds MT resolution,
off-tank surfacing, off-heal candidates, and `incoming_mob` on live-state.

**Golden-log regression net (#75)** — `test/golden-log.test.js` +
`test/fixtures/golden/` replay a committed SYNTHETIC EQ log through the real
`shouldKeep` → `parseEvent` → `EncounterBuilder` pipeline and assert committed
expectations (per-line parse + both filter gates; plus an encounter digest:
damage by attacker, charm sessions, kill credit, rollups). Enforces coverage of
all 25 `parseEvent` families. Accept a deliberate parser change with
`npm run golden:update` and READ THE DIFF. Gated by `.github/workflows/golden-log.yml`
on `main` + `beta`. Design: `docs/DESIGN-75-golden-log.md`. Four of the six
defects it originally pinned are now FIXED and the pins assert the fix (DS
flavor line reaches the parser and retags the hit, bystander crit heals kept,
spell crits kept, charm `duration_sec` a real number) — the agent change is
three `KEEP_PATTERNS` entries + the `_elapsedSec()` coercion in
`packages/wolfpack-logsync/index.js`. Still pinned broken: two of three Dire
Charm cast forms shadowed by the generic `cast` matcher, and `"X misses Y."`
parsing to nothing.

**Pre-raid drill** — two halves. Infra: `_preRaidHealthCheck()` in `index.js`
(~9260) auto-posts one green/red Discord line at 19:30 ET on raid nights
(Discord gateway / Supabase REST / GoTrue / wolfpack.quest), `bot_kv`-latched
once per day. Parse chain: `npm run drill` (`scripts/preraid-drill.js`) —
READ-ONLY, safe mid-raid; golden-log parser self-test + bot `/health` +
`latest-version` for both channels + bearer ingest-auth probe + site health.
A write-path drill (POST a synthetic encounter end to end) is designed but NOT
enabled — needs Hitya's sign-off, see the design doc.

### Zeal live state
Mimic bridges the pipe (below); the agent keys `_zealState` per character:
gauges (1=self, 6=target, 16=pet; HP per-mille), buffs, zone. Flushed to the
bot every 5s **on change** (`live-state` → `character_live_state`) — this is
the latency floor for the debuff queue and Extended Target. Type-5 raid
frames upload `raid_roster` + populate `_raidRosterMembers`. **The pipe has
no spawn id** — same-name mobs are not disambiguable (see CLAUDE.md scope
boundary).

### Death semantics (feign exclusion + corpse-run confirmation) — 2026-08-04
**`"<Name> dies."` is FEIGN DEATH, not death** — the `cast_on_other` text of
Feign Death (366), Death Peace (1460), Paralyzing Venom (1118) and FD Test
(2807). `parseEvent` matched `/die[ds]\./` on the belief that "dies." was an
older real-death variant; it is not, and 44% of every death ever stored came
from the only two classes that can feign. Now matches `died.` only.
**Real deaths carry a corpse-run tail** ("You are bleeding to death!",
"Returning to home point, please wait…") which appears ONLY in the dying
player's own log — parsed as `death_confirm`, back-patching `confirmed: true`
onto the matching SELF death inside 60s. **`confirmed: false` means "no proof
either way", never "this was a feign"** — a rezzed death is real and
unconfirmable, and every rogue corpse pull looks exactly like one. Full model
and the open design work in `docs/DESIGN-death-semantics.md`.

### Threat snapshots (cadence, labelling, claiming) — 2026-08-04
`boss_name` was NULL on all 463k rows by construction: it is assigned only at
flush (death handler / inside `flush()`), while the uploader refuses to run once
`flushedAt` is set — the two windows are mutually exclusive. Now sends
`et.bossName || et.targetName`, the fallback the snapshot already built for
exactly this. Also carries `target_name` (the uploader's OWN Zeal target, which
is NOT the fight — a healer is on their heal target). Cadence 18s → 6s and now
tunable mid-raid via `tuneNum('threat_snapshot_ms')`, clamped 2s–60s (the ingest
budget is 120/min per uploader). `encounter_id` is claimed bot-side at flush
(`claimThreatSnapshots`) because the agent cannot know it — the encounter row
does not exist until the fight ends.

### Charm pipeline
`_charmTickTracker` (slot-16 gauge-driven; 1.5s land debounce, 10s re-charm
grace), `CHARM_SPELLS` map (backtick + apostrophe spellings), pending-charm
staging from both cast paths, article-prefix filter separates charm pets from
summoned. Charm spells log nothing on land → `_recordCharmSpellOnTarget`
synthesizes the buff entry and pushes `buff_casts` with `is_charm_spell`.
🐺 Charm diagnostic card walks all four checkpoints.

### Buff landings & cross-client buffs
`_buffLandingsByTarget` (Mob Info) + `_petBuffLandings` (charm/pet trackers),
era-cap level fallback (`_assumedCasterLevel`) so level-formula durations
never compute 0. `_captureTargetBuffsOnCharm` sweeps pre-charm debuffs to the
owner key. MT/rampage buff+HP resolution waterfall: self Zeal list → the
character's own uploaded live-state (bot relay, `_mtLiveStateByName`) →
observed landings (partial, labeled).
**`_petBuffLandings` is keyed by OWNER, and NOTHING about that key changes when
the pet does** (agent 3.5.36). The owner key is deliberate — it's what makes
`_captureTargetBuffsOnCharm` work at all — but it meant a dead pet's spells
unioned onto whatever stood in the slot next: a charmed rat's Glamour of Tunare
+ Tunare's Request (1800 ticks = 3h) showed on a summoned warder that never had
them (Uilnayar 2026-08-05). `_reconcilePetIdentity()` clears landings + the
`/pet health` report on a slot-16 name → DIFFERENT name transition; slot 16
going **empty is not an identity change** (it dips ~3s during a re-charm, and
treating that as a new pet erases a live pet's buffs — fixture-enforced).
`/pet health` is authoritative over anything older than it, guarded three ways:
only once the report has CLOSED (`PET_REPORT_GAP_MS`; mid-stream the set is
still filling), never for landings newer than the snapshot, never for
uncatalogued spells (`applyPetHealthLine` can only record catalog names, so
their absence says nothing). KNOWN GAP: re-charming a DIFFERENT mob with the
SAME name is invisible to the identity check — the `/pet health` reconcile is
what catches it. Tests: `test/pet-buff-landing.test.js`.

### CH chain tracker
Parses shout/raid callouts: numbered calls (`_CH_CALL_RX`), GO cues
(`_CH_GO_RX` — stamps `lastGo` so the overlay flashes GO! on that slot),
personal heal macros (`_CH_PERSONAL_RX`; CH-equivalent spells fold into the
rotation as auto-slots, others render as spot heals), and the **roster
announcement** ("Fargan 001, Rapha 002…" — ≥3 contiguous-from-1 pairs) which
owns slot names authoritatively (short names resolve via the Zeal raid
roster). Beat = median gap of last 10 calls → due-countdown, slip pivot
banner. Off-heal candidates (hurt offtanks only, <90% tunable) hang off the
same snapshot for the CH-chain + Tank overlays.
Cast bar (agent 3.4.39): each numbered call starts a 10s countdown on that
slot (`CH_CAST_MS` — eqemu Complete Heal id 13 cast time); interrupt lines
(`trackChChainInterrupt`, EQMac string_ids 439/12478) paint a red ✕ — an ✕
proves the interrupt, absence proves nothing (both strings are range-limited/
filter-suppressible). DDR grading: `_chGradeCall` scores each call against
`_chExpectedNextAt()` — ≤0.25s PERFECT (3 straight → MARVELOUS, per-slot
streak), ≤0.5s GREAT, ≤1s GOOD — flashed as an arcade sticker atop the
caster's bar in `apps/mimic/chchain.html` (`ddrSticker`). Visual only, never
TTS, by design; 🎯 overlay toggle + `POST /api/chchain/ddr`.

### Main target & main tank
`_resolveMainTarget` = the NPC most raiders target, from the bot's Extended
Target aggregate (agent-side 3s cache primes it) — drives the TARGET bar +
enrage math on Tank/Command Center; local Zeal target is only the fallback.
`_resolveMainTank` = CH-chain target if one is running, else the raider the
MAIN TARGET's melee connects on most (15s window), else any-mob tally.

### Triggers
Guild set polled from the bot (2 min; class-filtered), personal set from
`personal_triggers.json`. `{s}` placeholders compile to named groups;
`_captureMatchesCharmPet` suppresses self-charm-pet fires; roster gate via
`require_raid_member`. Zeal gauge conditions fire without a log line.
Cross-Mimic relay: detecting agent POSTs `trigger-relay`, others poll
`recent-fires` (~1.5s) and run the same actions; dedup by name+captures in 8s.
Fires live in an **in-memory ring buffer** — nothing durable, so "has this
trigger ever fired?" is currently unanswerable (`DESIGN-callout-overlay.md`).

### Trigger pattern anchoring — the `^` trap (#190) — 2026-08-04
`evaluateTriggersAgainstLine` matches the **raw** line (`[Sun Aug 02 21:10:01
2026] <message>`) and `_applyGuildTriggersResponse` compiles with flags `i`, **no
`m`** — so `^` anchors before the timestamp. `_translateDotNetRegex` passes `^`
through untouched (it only rewrites `(?>` and `{s}`-family placeholders).
**37 of 109 enabled triggers were written `^<message>` and could never fire**,
including eight callouts added the day it was found. Fix is `^` →
`^\[.+?\]\s+`; **deleting the `^` is wrong** because the `{s}` class includes
space, so the leftmost match starts at the space after `]` and captures a
leading space. `web/lib/triggerPattern.ts` normalizes on save and
`/admin/triggers` flags existing dead rows; the 37 in the table are staged, not
applied (`RUNBOOK-dead-triggers.md`) — mass-enabling callouts is a raid-noise
decision. Sibling failure modes, same "enabled therefore assumed working" shape:
the DI trigger matched **invented** text (check `eqemu_spells.cast_on_*` for the
real string) and AOE_DANCE was **mis-signatured** to another spell's text.

### Agent boot smoke test — 2026-08-04
`test/agent-boots.test.js` spawns the real agent process in a throwaway cwd and
asserts it stays up. It exists because agent 3.5.5–3.5.14 on `beta` **did not
start at all** (`ReferenceError: _threatSnapMs is not defined` in
`startChatRelay`, which runs unguarded on the watch-mode path) and six releases
shipped that way in a day. Nothing else executes the startup path — every other
suite imports the module and calls exports, so `main()` was never invoked.
The self-check injects an undefined identifier into `startChatRelay`
specifically because that runs AFTER the ready banner, reproducing the hard
shape (looks started, then dies) rather than a module-load throw. Kept
byte-identical on `main` and `beta`.

### Web-staged macro edits (/me/ui apply loop)
`pollUiPendingEdits` (5 min): GET pending edits for watched characters; apply
ONLY when logged out (no Zeal sample 2 min AND log mtime >90s — EQ rewrites
the ini from memory on /camp). `_applyIniKeyEditsToFile` is a port of Mimic's
write-pages walk (in-place update/delete, append-in-section, `.webedit-*.bak`
backup). Socials/HotButtons allowlist re-checked agent-side. Results POST to
`ui-edit-result`.

### DA broadcasts / healer mana / Command Center
`trackDaBroadcastLine` (case-sensitive "DA"; trailing "N sec" always = time
left) and `trackHealerManaLine` parse raid-chat macros into raid-wide boards.
`_serializeCommandCenterState` = tank state (target/MT/rampage/DA/DT/enrage)
+ DA broadcasts + healer mana + the bot's debuff queue as cure alerts.

---

## Mimic features

### Shell
`main.js` owns the tray, the agent child process, config
(`loadConfig`/`cfg.*` flags), and one frameless transparent always-on-top
BrowserWindow per overlay; `preload.js` exposes `window.mimic` IPC. Overlay
parity checklist in `CLAUDE.md` (✕ hide, ✥ move + context menu,
hover-interact handshake, dashboard toggle row, visibility fn) — most beta
bugs were a missing item from that list.

### Setup & onboarding (EQ-config writer)
First-run **gate** lives in `loading.html` (steps: sign-in-or-local-only → EQ
folder configured → engine up; `cfg.onboarded` flips returning users straight
to the dashboard). The **"Set up for me"** one-click EQ configurator is a
SEPARATE thing from that gate: the writer is `_applyEqSetup()` in the AGENT
(`packages/wolfpack-logsync/index.js`), exposed at **`POST /api/eq-setup`**, and
it writes `Log=TRUE` (eqclient.ini) + `PipeVerbose`/`ExportOnCamp`/`PipeDelay`
(zeal.ini) across every known EQ folder, guarded against EQ being open (it
rewrites eqclient.ini on exit). Surfaced in TWO places, both calling that one
writer: the **agent dashboard** (Zeal-health/Info card, same-origin fetch) and
the **Mimic Settings page** (`settings.html` → `eqSetupForMe` IPC → `main.js`
POSTs to the agent, so it can read the full result incl. the "EQ is running"
warning — no CORS on the agent). Logging-off is also passively DETECTED +
nudged (`/log on` hint) when a configured folder has no fresh logs.

### Zeal pipe bridge (`zealPipe.js`)
tasklist → find eqgame PIDs → connect to Zeal's named pipe per PID → frames
to the local agent. Types: log 0, label 1, gauge 2, player 3, custom 4,
raid 5, group 6 (reserved). Elevation mismatch (EQ admin, Mimic not) =
connect-then-close with no error — run Mimic as admin (field-diagnosed
2026-07-05; auto-hint in the Zeal notification + zealhealth.html).
In-EQ-folder installs can break DX-hook detection — reinstall outside.

### UI Studio (`ui-studio.html`)
Loads the character's ini bundle (`ui-studio-read-bundle`), parses window
sections (`XPos<res>` blocks, bare Width/Height), rescales source→target
resolution, drag/snap editor, writes back with `.bak` (`write-bundle`) or
defers until logout (`defer-save` + background watcher). Skin XML scan caps
window sizes. Category filter buckets ~130 windows; `offscreen` category
(default off) hides never-in-game windows (char-select/login surfaces,
live-era leftovers). **Inspector** ("Hotbar Pages…", `inspect-socials`):
chat routing (drag chips between windows, ★ always-here), tell-window state,
editable HotButtons/Socials grids, and the **macro suggestion catalog**
(`MACRO_SUGGESTIONS` — mirrored in `web/lib/macroSuggestions.ts`; queue into
empty Socials slots). All saves go through `write-pages` (key-level, guarded:
blocked while EQ runs). Cloud backup/restore: `uiStudioCapture` → bot
`ui_layout` (encrypted `ui_snapshots`) → list/download/restore with
resolution rescale on the way back.

### Overlays (one .html each)
DPS HUD (`overlay.html`), Triggers+timers (`triggers.html`), CH chain
(`chchain.html` — slots, GO pill, beat countdown, pivot, off-heal list),
Tank (`tank.html` — MT focus, DA, DS, deathtouch, rampage+invuln, off-heal),
Command Center (`command.html`), Extended Target (`extarget.html` — off-tank
toggle, stale rows), Charm, Pet, Mob Info, Buff queue, /who, Melody,
Zeal health, Settings, loading. Overlays poll the local agent
(`/api/state`, `/api/tank-state`, `/api/command-center`,
`/api/extended-target`, `/api/buff-queue`) every ~1.5–2s.

---

### Auto-update on EQ close + focus-safe nag — 2026-08-04 (Mimic 2.3.0)
Mimic already polled hourly with `autoDownload` on; `autoInstallOnAppQuit` then
waited for a quit that never comes because nobody quits Mimic. So the download
sat there and raiders arrived on old builds. `_pollEqPresence` now installs a
pending update when EQ CLOSES (provably not playing), with a 15s grace that
re-checks presence so a crash-and-relaunch defers instead of yanking Mimic away.
Otherwise it only NAGS, hourly, via an OS `Notification` — chosen because it
structurally cannot take focus or raise a window over the game. **Bootstrap
caveat: this can only auto-install for people already on 2.3.0+.**

### Idle backoff + resource readout — 2026-08-04
`_checkEqRunning` spawned `tasklist.exe` unconditionally every 10s (~8,640/day on
an idle desktop). Now eases to 45s once EQ has been gone a minute — 76% fewer
spawns — via a self-rescheduling `setTimeout` (a fixed `setInterval` cannot
change its own period). `_eqPollStopped` is load-bearing, not defensive: the tick
awaits a spawn, so a stop landing mid-flight would be undone by that tick's own
reschedule. Settings → **Resource use** renders `app.getAppMetrics()` live (2s):
per-process CPU + memory, sorted by memory, with EQ-running state. Discards the
first CPU sample (it is a delta since the previous call) and lists the log agent
separately because it is a spawned process and NOT in `getAppMetrics()`.

### #194 same-name instance split — position clustering — 2026-08-05
**Two "Thall Va Xakra" tanked apart are two rows, each labeled "@ <tank>", with
per-instance debuffs.** The pipe ceiling is permanent (no spawn id — do NOT
re-derive; `DESIGN-mob-serialization.md`), so the split clusters the PLAYERS:
a tanked mob stands on its tank. Bot (`index.js`, next to `EXT_HP_SPLIT_TOL`):
`_extPosCluster` (single-linkage over engaged raiders, 3D,
`ext_pos_cluster_units`=25; a bridging player MERGES — separators may only
raise K), `_extBindInstances` (welds HP clusters to position instances via
raiders in both; splits an equal-HP band position proves is two mobs; with no
instances returns the INPUT array — the K=1 byte-identity anchor),
`_extAttributeDebuffs` (observer-is-tank → that row; casting observer's
target-HP matches ONE band → that row; else dimmed `attributed:false` on every
row — never guess). Engagement evidence: fresh `incoming_mob` (whole fleet) +
`observed_tanks` (beta agents — every mob→player connect the observer's log
saw); positions from `live_state.loc_*` + the type-5 `raid_roster` loc forward
(gate on `loc_at`, NEVER `captured_at`). **Clustering runs for CAPITALIZED npc
names too** — the classifier calls them unique, but position evidence may
overrule (the Vex Thal adds are article-less). Tank labels ship only at K≥2.
Kill switch `flag_ext_pos_off=1` (tuning). **Zeal /tag capture (bot 3.1.13 /
agent 3.5.32) — THE SPAWN-ID SIDE DOOR.** Zeal's native `/tag <rsay|gsay|chat>
<text>` broadcasts nameplate tags, and the wire format (VERIFIED from
CoastalRedwood/Zeal `nameplate.cpp`, cloned 2026-08-05 — do not re-derive from
the wiki) is **`ZEALTAG | <text> | <target_name> | <spawn_id>`** — abbreviated
header `ZT`, delimiter exactly `" | "`, `clear` = clear-all,
`ChatChannel: <name>` = autojoin plumbing, `^?^` prefixes set shapes
(R/O/Y/G/B/W arrows, P paw, S stop sign). **The broadcast carries the mob's
TRUE spawn id** — the field the pipe lacks — logged by every member of the ZT*
channel (the guild's is `ZTwolfpacktag`; Zeal requires the ZT prefix), by rsay,
and by **gsay — GROUP say, not guild** (`handle_tag_command` gates it on
`GroupInfo->is_in_group()`). Agent: `noteTagChannelLine` on the raw tail line
(the /zeal-version pattern); ships `zeal_tags`
`[{spawn_id, mob, text, shape, tagger, since}]`.
**Do NOT enumerate transports (agent 3.5.34).** 3.5.32 matched only the ZT
channel + rsay and the first live test captured NOTHING — two `a Darkpaw
warrior`s tagged over `/tag gsay` because the testers weren't in a raid, and a
missing transport is indistinguishable from nobody tagging. `_tagLineParts`
now finds the `ZEALTAG | ` header ANYWHERE in the line, takes the payload from
there, and reads the tagger off whatever prefix precedes it — covering every
transport, self and other, in both render shapes: quoted
(`Name tells the group, '…'`) and abbreviated (`[P] [Name]: …`, which Zeal
writes to the LOG when `AbbreviatedChat=2`). The header is machine-generated,
which is what makes the loose match safe.
**`zeal.ini` lives in the EQ ROOT, not next to the logs** (`io_ini.h`
`kZealIniFilename = ".\\zeal.ini"`, resolved against `eqgame.exe`'s directory).
3.5.33 read it from `dirname(watched log)` = `Logs\`, found nothing on every
real install, and the readiness card said "no zeal.ini found yet" forever — a
diagnostic that could never fire, on the exact question the user was stuck on.
3.5.35 reads the parent first, log dir as the in-EQ-folder fallback.
**Three ways a tag draws the nameplate arrow and reaches NO log** — the arrow is
NOT evidence the broadcast happened, which is what made this so hard to see:
`/tag local` (never broadcasts — `handle_tag_command` only sends for
rsay/gsay/chat); `/tag chat` with the channel unjoined
(`send_tag_message_to_channel` bails); and `/tag suppress on`, where
`chatPrintChat` returns early on `check_for_tag_channel_message`'s suppression
verdict AFTER `handle_tag_message` has already drawn the arrow. Note suppress
does NOT need `/tag filter` for the chat-channel path.
**Two Zeal settings kill capture silently** — both read from `[Zeal]` by
`readZealTagConfig()` and warned on the 🏷 dashboard card with the exact fix:
`NameplateTagSuppress` (`handle_zeal_spam_filter` sets `msg = ""` and PrintChat
skips the log write — nothing to parse, ever) and `NameplateTagPrettyPrint`
**when `NameplateTagFilter` is also on** (rewrites to `"text => mob"` and
DESTROYS THE SPAWN ID at the source; prettyprint alone never runs, so don't
warn on it). Degraded prettyprint rows are deliberately NOT stored — a tag
without a spawn id can't do the job the feature exists for.
**Privacy unchanged** — ZT-channel lines still match the custom-channel drop
pattern; rsay-borne tags are EXCLUDED from the Discord chat relay
(`parseChatLine` guard) as machine traffic; group say can't reach the relay at
all (the `guild,`/`raid,` gate). gsay put group chat on this path for the first
time, so the self group-say drop pattern was widened to cover **both** wordings
(`You tell your party,` as well as `You say to your group,`) —
`triggerVisibleLine` is default-KEEP, so a wording the drop list misses is a
private line the local trigger engine can see. Bot: tags LABEL rows (weld only
when the tag text names a row's tank, or the unambiguous 1-tag-1-row case);
unweldable tags POOL on the group's first row (`tag_pool`) — never pinned to a
guessed row; **tags do not raise K in v1** (an unwelded tag can't say which HP
band is its mob — the shadow log records `K_tags` for the soak that decides
spawn-id counting). Deliberate K=1 byte-law deviation: a tagged single
instance DOES show `tag_text/tag_shape/spawn_id` (the assist-arrow-on-the-boss
case); additive only, no-tags K=1 stays byte-identical. Overlay: `ztagHtml`
colored glyphs (▲/🐾/🛑) + pooled "tags:" block. `ext_tag_fresh_sec` (120). Heading modes on `ext_pos_heading` (0 off / 1 join-only-safe / 2
full, dark until the `[ext-pos]` shadow log verifies the pipe's heading
convention); `ext_pos_heading_scale`, `ext_pos_proj_reach` knobs. Overlay
(`extarget.html`): tank tag, dimmed `?` chips, and per-row debuffs when any
row carries `tanks` (pooling stays the fallback for pre-#194 bots). Tests: `test/ext-pos-cluster.test.js`
(bot), `test/raid-loc-forward.test.js` (agent, beta). Privacy:
raid-loc forwarding noted in `docs/PRIVACY.md`.

### One card in a thread: utils/threadAnchor.js — 2026-08-04
**A failed edit must never become a second post.** Three duplicate-post bugs have
now been chased here: the Mimic release announcer (2026-07-13, ephemeral
cursor), the raid review (2026-08-04, `state.json` not persisted on Railway),
and this one — which happens *with the id in hand*, which is why the bot_kv fix
did not stop it. Both onboarding and the raid review had written:

    if (savedId) { try { const m = await thread.messages.fetch(savedId);
                         await m.edit(payload); return; } catch {} }
    await thread.send(payload);          // ← the duplicate

The bare catch turns EVERY edit failure into a fresh post, and the failure that
fires is mundane: **Discord refuses edits in an ARCHIVED thread (50083)**, and
these are precisely the threads that archive — the onboarding thread's parent is
literally `raid-mobs-archive`. Each restart fetched the card, failed to edit,
posted a new one, and (sending UNARCHIVES) left it primed to repeat.
`postOrEditCard()` owns the three rules so both call sites get all three:
**(1)** unarchive first — archived is a resting state, not an error; **(2)** a
failed edit is not a missing message — only `10008`/`10003`/404 may fall through
to posting, anything else reports and gives up; **(3)** look before you post —
rescan and adopt an existing card, which makes duplication structurally
impossible even with the id lost. `/cleanup` clears the backlog and keeps the
**newest** card (not the earliest, as its board sweeps do) because the anchor
adopts the newest — keeping the earliest would have the two fighting forever.
Nothing is auto-deleted: the startup path only logs the count and ids, since
deleting guild history is an officer decision. Tests:
`test/thread-anchor.test.js`.

### Resource use: which memory number, and why they disagree — 2026-08-04
Uilnayar checked the card against Task Manager twice and was right both times.
**Round 1 (1267 vs 460):** it summed `workingSetSize`, which counts pages SHARED
between processes once per process — every Chromium renderer maps the same
Electron framework, so 13 processes counted it 13×. **Round 2 (274 vs 161):**
`privateBytes` is private **commit** (every private page reserved, resident or
not); Task Manager's Memory column is the private **working set** (only what's
in RAM). Commit is always higher by a per-process factor — the GPU helper showed
102 MB committed against ~32 resident — so **no scalar fixes it**. Chromium does
not expose working-set-private, so `_refreshPrivateWorkingSet()` asks Windows
(`Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate`, one query for all pids,
no elevation) and the card shows "N MB in RAM (M MB committed)". Guard rails,
because this window's claim is that Mimic is free at idle: ≤1 spawn per 12s,
never concurrent, never blocking a poll (payload uses the cached snapshot, the
refresh runs after), and **the clock is stamped even on failure** or a broken
query respawns PowerShell every 2s. `memBasis` says which of
workingSetPrivate/commit/workingSet is on screen. Rows are named via
`_windowLabelsByPid()` (`webContents.getOSProcessId()`), flagging any overlay
alive while switched OFF. **CPU 0.9 vs 0.6 is NOT fixable and not a bug** —
Electron reports a share of ONE core over its own sample window, Task Manager
divides by all cores. Tests: `test/resource-metrics.test.js`.

### Naming renderer processes for Task Manager — 2026-08-04
The **Name** column cannot be changed: every renderer is the same
`Wolf Pack Mimic.exe` and that column reads the exe's version resource. (The
Dashboard row is named only because it owns a visible taskbar window whose title
Task Manager appends; overlays are `skipTaskbar`.) What *can* carry a name is the
command line, so `_wpPrefs(name, extra)` is the single source of webPreferences
for **all 20 windows** and adds `additionalArguments: ['--wp-window=<name>']` —
visible under Task Manager → Details → Select columns → Command line, and in
Process Explorer / Resource Monitor. Whitespace is collapsed or the tag splits
into two argv entries. Tests: `test/window-process-names.test.js`.

### Hide-all is distinguishable from "off" — 2026-08-04
`toggleHideAllOverlays` writes every `show*` flag false and keeps the old values
in `_hideAllPrev` — which nothing could see, so a hidden overlay and a disabled
one looked identical ("Currently, when we hide the windows, it just sets
everything to off"). `currentStatus()` now ships `hideAllActive` + a **copy** of
the snapshot, and the dashboard's Overlays tab renders a third state: ON / amber
**HIDDEN** / OFF, plus a `#wpHideAllBanner` placeholder (kept out of the render
string so the section stays byte-stable). Restore changed from
`Object.assign(cfg, _hideAllPrev)` to filling **only flags still off** — the
blanket version reverted anything switched on while hidden. Note the row-key vs
flag-name split (`pet` → `showPets`). Tests: `test/hide-all-state.test.js`.

### Overlay windows are lazy — 2026-08-04
Every overlay is its own Chromium renderer (~80 MB resident before it paints;
Uilnayar measured the floor). Boot created **ten** of them unconditionally,
ignoring every `cfg.show*`. `_OVERLAY_WINDOWS` (main.js, next to
`applyAllVisibility`) is the flag → getter → creator → dropper table;
`_materializeEnabledOverlays()` builds what is enabled and
`_reapDisabledOverlays()` frees what is not. **The invariant: a window must
exist whenever anything can SHOW it** — so materialize runs at the TOP of
`applyAllVisibility()` (the funnel for hide-all restore, per-character
profiles, class seeding, EQ-presence flips) and at the top of
`applyOverlayInteractivity()` (unlock-to-place force-shows everything). That
makes a wrong reap self-healing. `_overlayForcedOn()` spares setup mode,
unlocked, hide-all, blind mode; `_inSingleSetup` spares "Setup THIS"; the
trigger overlay keys on `enableTriggerTts`, NEVER `showTriggerOverlay`, because
TTS fires from the hidden window (#97). Tests: `test/overlay-lifecycle.test.js`.

### Not every eqgame.exe is yours — 2026-08-04
`_checkEqRunning` matched the process NAME, but `eqgame.exe` is the binary for
every EverQuest client — Uilnayar had EQLegends up and Mimic reported "EverQuest
running" (overlays over the wrong game, Zeal nag primed, EQ-close auto-install
armed against an untracked process). Now `tasklist` yields PIDs, and
`_resolveEqPidOwners` reads each one's `ExecutablePath` via `Get-CimInstance`
and keeps only paths under an `_ourEqDirs()` folder — configured `eqPaths`
**that actually hold logs** (a stale entry would disown the real client, and
`resolveEqDirsWithLogs` already falls back past those). `_eqPidVerdict` caches
per PID, so the expensive lookup is once per game launch, not once per 5s poll.
**Every failure path claims the process** (nothing configured, PowerShell
blocked/errored, path unreadable, PID unjudged) — hiding a raider's overlays
mid-fight is far worse than tracking one extra client. Disowned paths ride the
`app-metrics` payload as `eqIgnored` so Resource use can say which client it
passed on. Tests: `test/eq-process-identity.test.js`.

### Zeal update notice on the dashboard — 2026-08-04
Mimic owns Zeal detection (`zealUpdater`, 12h check); the agent owns the
dashboard. Mimic POSTs to the agent's `/api/zeal-update` and the agent folds it
into the existing **Mimic Mail** notice list — deliberately reusing that UI
rather than adding a banner, since `WEB_HTML` is the one file where a single
mis-escaped character blanks the page. Status pushes on EVERY check and clears
when Zeal is current; the synthetic notice id derives from the TAG so a later
release resurfaces; `launchAgent` re-pushes 8s after spawn because the agent
holds it in memory.

## Web features

- **/me** — per-character private hub (parse stats, rollups, chat counts,
  PvP, loot, wishlists count, live buffs/zone, exclusion toggles). Data floor
  via `character_data_floor`; excluded characters honored everywhere.
- **/me/ui** — Web UI Studio: latest backup metadata + socials from
  `ui_socials_index` (service-role read, household-filtered), macro
  editor staging into `ui_pending_edits` (applied by the agent at logout,
  status shown), guild common-macro library (≥3 characters), suggestion
  catalog (`web/lib/macroSuggestions.ts`).
- **Member surfaces** — /parses, /raid (Zeal raid roster + coverage),
  /raid/review (#80 morning-after page, kernel `web/lib/raidReview.ts`),
  /guide (#81 Raid Guide, below), /buffs (coverage grid vs role targets),
  /who, /pvp, /boards, /boss, /character, /leaderboards, /loadouts, /bards,
  /fun, /planner, /feedback, /roadmap, /search.
- **/guide — the Wolf Pack Raid Guide (#81, phase 0)**. One page per boss,
  generated from our own history; `/guide` is the index *and* the authoring
  worklist (most-killed-but-unwritten first). Pure kernel
  **`web/lib/raidGuide.ts`** (`test/raid-guide.test.js`, 30 tests) holds the
  rules that make it right rather than merely populated:
  **`resolveCatalogRow`** — the #171 pick-and-merge, because
  `encounters.npc_id` often points at a stats-empty shell row (Emperor 162065
  has no loot table, no spells, AC 200; the live row is 162491);
  **`hpCorroboration`** — our median raid damage proves which row is right
  (1.21 M = 96.9 % of 162491's pool, 121 % of the shell's);
  **`bucketEncounters`** — a *damage* floor, not a duration floor, so an 81 s
  re-pull fragment stops poisoning the medians; **`attributeLoot`** — DKP
  prices only on items this boss is the sole catalog source for, because
  `loot_drops` is empty and OpenDKP records item→raid, not item→NPC;
  **`pairwiseOrder`/`precedence`** for zone run order. Phase 0 renders blocks
  1/2/3/9/10/11 with **no new schema**; the mechanics, callout, debuff and
  death blocks wait on the nightly accretion table, because their source
  streams expire (`buff_casts` is a 7-day window). Full design + the Emperor
  Ssraeshza worked example: **`docs/DESIGN-81-raid-guide.md`**.
- **/admin/*** — queue, encounters, members, links (OpenDKP register with
  ignore/trader/raid-alt), quarmy, agents, audit, feedback, signups,
  attendance, triggers, analytics, voice, **overlays** (live tuning knobs),
  chat, anomalies. Pattern: client component with optimistic
  `useState`+`useTransition`, server actions in `actions.ts`, no
  `router.refresh()` (revalidatePath only).
- **/admin/console (#87)** — the officer console. Three parts on one page:
  (1) a **health board** built by the pure `web/lib/consoleHealth.ts` (ingest
  heartbeat, agents-uploading-now, chat relay, parses landing, live state,
  upload errors, fleet versions, control-plane drift, `^`-anchored dead
  triggers, backfill/queue backlog, `/api/health`) — **raid-window aware**, so
  outside Sun/Wed/Thu 19:30→00:30 ET every freshness amber/red downgrades to
  grey "quiet"; (2) a **drift panel** listing every `overlay_tuning` CONTROL key
  currently set, with its age and a one-click Clear (the console stamps
  `flag_set_at_<key>` when it sets one — zero-migration, string values already
  ride that jsonb); (3) the **runbooks** from `web/lib/runbooks.ts`, deep-linkable
  (`#rb-01`), each carrying its dated incident, and auto-opened when one of its
  signals is red. Writes use the SAME `overlay_tuning.tuning` read-modify-write
  as `/admin/overlays` and the bot's `POST /api/agent/flag-override`, so all
  three surfaces agree — the console **mirrors** the control plane, it never
  owns it, and nothing moved out of its existing home. Officer gate is inherited
  from `web/app/admin/layout.tsx`. Safety classes: clearing an override is one
  click, *setting* a fleet-scale lever needs a typed phrase (`PAUSE FLEET` for
  `flag_agent_kill`), and bulk trigger edits / data repair / deploys are
  deliberately not buttons. **Anti-rot:** `test/runbooks-catalog.test.js` asserts
  every runbook's structured lever refs still resolve — flags against the bot's
  `_FLAG_OVERRIDE_KEYS` + `_SHED_KINDS` and the overlays catalog, routes against
  real `page.tsx` files, commands against `commands/*.js`, docs against disk —
  so renaming a flag fails CI instead of silently making a runbook lie. Design +
  the full runbook prose: `docs/DESIGN-87-officer-console.md`.
- **Encryption boundary**: the web has the service-role key but NOT
  `WISHLIST_BID_KEY` — anything encrypted (bids, UI snapshots) is bot-only;
  the bot must extract/serve plaintext derivatives the web needs.

---

## Supabase quick map

Tier 1 `eqemu_*` mirrors (weekly `sync-quarm.yml`; `spawn*` and
`npc_types.zone_short` empty upstream). Tier 2 guild tables: see `CLAUDE.md`
list, plus `overlay_tuning`, `ui_snapshots`, `ui_socials_index`,
`common_macros`, `ui_pending_edits`, `voice_settings`, `who_overrides`,
`character_link_requests`, `member_onboarding_state`, `character_aas`,
`agent_uploads`. RPCs: `find_or_create_encounter`, `merge_encounter_players`,
`bump_agent_upload_stat`. RLS: Tier 1 anon+authenticated read; guild tables
authenticated-read unless private (socials index, pending edits, encrypted
columns = service-role only); bot uses service_role.

---

## Recent additions — 2026-07 sprint (quick index)

*Everything below shipped in the July 2026 sprint (Mimic 1.9 → 2.0.1 "Harmonic
Howl", bot 3.0.203 → 3.0.222, web 1.0.231 → 1.0.262). Indexed here so
"do we have X?" answers YES with a pointer. Fuller context: `docs/STATUS.md`
(ledger), `docs/BETA-TESTING.md` (test cases), and the member-facing changelog
on the site at **wolfpack.quest/roadmap** (source: `web/lib/roadmapData.ts`).*

### Bot (`index.js` + `utils/` + `commands/`)
- **Reporter elections (#72)** — chat/buffs/roster get elected reporters so 60
  raiders don't upload the same bytes N times. `_reporterRegistry`,
  `_electReporters`/`_electBuffReporters`/`_electRosterReporters`, `STREAM_CLASS`
  + `_dedupFlags`, `_handleAgentReporterPoll`. Flags `dedup_chat`/`dedup_buffs`/
  `dedup_roster` (chat currently OFF post-2026-07-19 incident). Camp-out demotion
  + log-flow liveness. **`per_observer` streams are never elected — structural.**
- **Admission control (#73)** — per-uploader×kind budgets (`_overBudget`,
  `budget_*` tuning), 429/Retry-After; Supabase request timeout + circuit breaker
  (`utils/supabase.js`, env-tuned); `target-buffs` cache; poison-payload
  hardening. `GET /health` readiness for zero-downtime deploys (#58,
  `railway.toml`).
- **Mob-info row-picker (#171, folds #161-P1/#173)** — `utils/mobSpecials.js` is
  the ONE eqemu `special_abilities` table (shared with
  `scripts/audit-mob-specials.mjs`). `mob-info` fetches ALL same-name rows
  instead of `limit=1`, splits real vs placeholder (immune melee 19 + magic 20),
  prefers the #141 zone, displays the highest-level REAL row and UNIONs the
  warning flags across real variants only. Adds `runspeed`→`rooted`/`flees`/
  `flee_pct` and codes 22/26/36/37/39/44/46. Design note + deviations:
  `docs/audit-mob-specials.md` §"#171 SHIPPED"; proof `test/mob-rowpicker.test.js`.
- **Multiplexed poll (#106)** — `GET /api/agent/poll` bundles the six background
  GET loops into one (per-stream cursors + shed-omission); agent falls back to
  individual routes on 404.
- **Control plane (#74)** — `flag_shed_<kind>` for every ingest kind
  (`_SHED_KINDS`/`_SHED_NEVER`), `flag_agent_kill`, `min_agent_ver_num`,
  per-channel manifest (`?channel=beta`); officer `flag-override` write path.
- **OpenDKP reconcile (#110)** — `utils/openDkpSync.js` `reconcileRecentLoot`:
  upstream deletions propagate to the `opendkp_loot` mirror within a sync.
- **Guild rules (#94)** — `guild_rules` table + `/ingestrules`
  (`commands/ingestrules.js`, `utils/rulesParser.js`) + `/admin/rules`.
- **Loot bidding serving (#108/#121)** — `server-panel` keys `opendkp-auth-config`
  / `item-history` / `bid-history`; `_lootItemSummary`/`_familyDkpTotals`.
- **Roll nights (#91)** — `_handleAgentLooted` + `looted_items`,
  `computeHotDiceNightAward` (`utils/hotDiceNight.js`) on the midnight chain.
- **/who enrichment (#111)** — `who-lookup` now returns `{level, main, mimic}`;
  `hide_main_names` tuning key (privacy exception).
- **Mimic 2.0 announce (#raid-chat)** — one-shot bot_kv-latched release card.

### Agent (`packages/wolfpack-logsync/index.js`, beta)
- **Callout trust (#76)** — trigger checkpoint journal (`_triggerJournal`, incl.
  5b playback), real REHEARSE (`_rehearseTrigger` drives the tail), sticky
  callouts, stale-fire TTL. Reporter roles honored per stream (charm rows exempt).
- **CH chain GO (#103)** — `_maybeAnnounceChGo` speaks "0X GO" on your slot.
- **Loot announce (#107)** — `noteLootAuction` → TTS + auction countdown chips.
- **Timeline enrichment (#105)** — `noteSlowLanding` (SLOW_SPELLS), `noteMobHeal`,
  `DISC_LINES`/`_matchDiscLine` → `timeline_events`.
- **Loot bidding panel (#108/#121)** — dashboard WEB_HTML card, OpenDKP Cognito
  login (`logsync.opendkp.json`), alt-family (`logsync.bidfamily.json`).
- **Replay (#101)** — `startReplay`/`_replayWorker`: walk a log slice through the
  REAL trigger pipeline as a rehearsal (no uploads, refuses during a live fight).
- **Pet buffs + range (#117/#119)** — own-pet landing attribution; buff-queue
  out-of-range flag (`utils/range.js`); 🐾 pet-buff diag card; liveness across
  all watched logs; `live_character` in the heartbeat.
- **Ext-target same-zone filter (#113)** — `/api/ext-pref` per-user toggle.
- **Roll capture (#91)** — `trackLootedLine`/`uploadLooted`, `uploadRollSets`,
  Hot Dice perfect-roll fun events.
- **Damage-taken audio alert (3.4.39)** — `_maybeAnnounceDamageTaken` rides the
  `defender:'YOU'` combat paths (the "you have taken" line family is dropped by
  the byte filter — don't move detection there); `_setDamageAlert` +
  `POST /api/damage-alert`. Structurally default-OFF.
- **CH cast bar + DDR grading (3.4.39)** — see the CH chain tracker entry
  above (`CH_CAST_MS`, `trackChChainInterrupt`, `_chGradeCall`,
  `POST /api/chchain/ddr`).
- **PBAOE song mob counter (3.4.40)** — `noteSongAoeLine` (watch-loop hook,
  display-only) counts AE landing rows per song per 2.5s burst, scoped to the
  melody order's catalog `cast_on_other` suffixes (detrimental only — a
  beneficial song's landing names groupmates); damage joins from
  "has taken N damage from your <song>" lines. Surfaced per order row as
  `aoe_hits`/`aoe_dmg`; `melody.html` renders an ⚔ hits/12 chip beside the
  song name (12 = Quarm AE cap, green at a full swarm; per-mob min–max in
  the tooltip). Badge goes stale-silent 30s after the last pulse.

### Mimic (`apps/mimic/`, beta)
- **Me card + officer Admin tab (#109)** — dashboard opens on 🐺 Me; officer
  tools + 📡 Reporters panel (#115, swap/include) + 🛑 kill switches (#118) under
  🛡 Admin. LKG crash-loop rollback + beta-channel hot-swap in `main.js` (#74).
- **"Set up EQ for me" on Settings** — `settings.html` mirrors the dashboard's
  `/api/eq-setup` writer (see the Setup & onboarding entry above).
- **Overlay fixes** — trigger-overlay auto-grow (#107), melody stale-card + setup
  chrome teardown (#116), TTS user-activation fix (#120).
- **Damage-alert controls (3.4.39)** — `cfg.damageAlert` (default OFF) with a
  top-level tray toggle in `main.js` and a rebindable hotkey (default
  `Ctrl+Shift+D`) via `_wpWireHotkeyRow` on the dashboard Overlays tab.
- **chchain.html (3.4.39)** — per-slot cast bar with remaining seconds, red ✕
  on interrupt, DDR `ddrSticker` pop + 🎯 grading toggle (#103 button pattern).

### Web (`web/`)
- **✨ New-member walkthrough (web 1.0.286 · agent 3.4.43)** — cross-page
  guided tour over the member's own data. Web: `components/GuidedTour.tsx`
  (no-dep engine: localStorage state survives its own navigations, spotlight
  clamps oversized targets, off-route → Resume pill, missing target →
  centered card) + `lib/tourSteps.ts` (steps; PvP is an opt-in branch on the
  final step, never core) + `TourLauncher` in the header + `data-tour`
  anchors on `/me`. Mimic dashboard: `wpTourStart`/`WP_TOUR_STEPS` in
  WEB_HTML — six stops switching tabs via the real nav buttons, ✨ Tour nav
  button + one-time offer toast. Both Playwright-verified live.
- **Roll nights (#91)** — `/rolls` (`web/lib/rolls.ts`).
- **Quartermaster (#82)** — `/quartermaster` (`web/lib/quartermaster.ts`):
  utility-kit coverage + quest checklist (reuses the `quest_catalog` store).
- **Raid Kit (#95)** — `web/lib/raidKit.ts`, `/admin/readiness`, gear-page card.
- **Comp matcher (#93)** — `web/lib/comp.ts`, `comp_templates`, `/admin/comp`,
  signups gap panel.
- **Attendance metrics (#92)** — `member_attendance_metrics` view + `/admin/attendance`.
- **Per-fight timeline (#98)** — `encounter_events` → `FightTimeline.tsx` on
  `/parses/[id]` (deaths, slows, mob heals, discs, fires); replay-this-fight link.
- **Sprint board on `/roadmap`** — `SprintBoard.tsx` + `sprintItems` in
  `roadmapData.ts` (sortable, platform-color aspects).

### Designs written, build pending (read before touching)
- **Multi-raid awareness (#114)** — `docs/DESIGN-multi-raid.md` (leader-anchored
  identity; single-raid path is sacred).
- **Same-name mob serial tracks (#56)** — the serialization design in
  `docs/DESIGN-dedup-and-mob-serialization.md` (separator-only, K-invariant,
  rampage/riposte correction).
