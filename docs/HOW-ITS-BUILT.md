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

### Mob scripts + trigger text audit (2026-08-13)
- **`eqemu_quest_scripts` + `scripts/sync-quest-scripts.js`** — the `.lua`
  behaviour files for every mob, mirrored per zone from
  `github.com/SecretsOTheP/quests` (GPL-3.0, ~3.7 MB). **Not in any SQL dump** —
  they are files, so this is a SEPARATE sync from `sync-from-eqmac.js`, wired as
  its own `continue-on-error` step in `sync-quarm.yml` so a quests-repo hiccup
  can never fail the catalog sync. Skips unchanged files by git blob sha and
  deletes rows whose file vanished upstream (MIRROR semantics — a removed script
  is "no longer true", not "retention expired").
  ⚠ UPSTREAM scripts, not a live-server dump; Quarm may run local edits. Best
  available reference, never proof of live behaviour.
- **`trigger_text_audit` view + `trigger_literal_probe()`** — the payoff. Takes
  each trigger's longest literal phrase and asks whether it appears in
  `eqemu_spells` (cast/fade text), `eqemu_npc_emotes`, or a mob script. All
  three false on an ENABLED trigger = probably invented text, our worst
  documented trigger failure — the audit re-found the known Divine Intervention
  case independently. **A prompt, never an action**: turning callouts on or off
  is a raid-noise decision (`docs/RUNBOOK-dead-triggers.md`).
  ⚠ Read a miss as "worth a look", not "broken". Pure-regex patterns, and ones
  watching client-generated combat text ("has been slain by", "points of
  non-melee damage"), legitimately appear in none of the three sources.

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
- **Mimic sign-in (device-code flow)**: Mimic → `POST /api/mimic-link/start`
  (6-char user code + secret device code, 10-min TTL) → member confirms at
  `/auth/mimic-link` (Discord OAuth) → Mimic's 2s poll exchanges for a
  `mimic_sessions` token. **Officer-assisted path (bot 3.1.70 + web 1.1.93,
  2026-08-24)**: for members Discord blocks from OAuth (the unverified-account
  wall — Gonner), an officer enters the code on `/admin/links` and picks the
  member; the code is stamped discord-only (`authorized_user_id` NULL — the
  shape the poll has accepted since 2026-07-31 but nothing could write) with
  `authorized_via='officer'` + the attesting officer's id, copied to
  `mimic_sessions.linked_via/linked_by_discord_id` at mint since the code row
  is deleted on exchange. Trust model: the officer attests the identity —
  same trust as this page's character↔member links; target must be a current
  `wolfpack_members` row. Action: `web/app/admin/links/mimic-link-actions.ts`.
- **Web sign-in**: Supabase Auth Discord OAuth; callback checks guild
  membership + role names (`ALLOWED_ROLE_NAMES` via `wolfpack_roles`).
  Officer gating = `isOfficer()` per request server-side.
  **No-Discord path (web 1.1.94, 2026-08-24, Lacunanight's phone-verification
  wall):** officer generates a single-use 7-day invite on `/admin/links`
  (`site_access_invites`, service-role only) → member sets username+password
  on `/auth/claim` → account created pre-confirmed as
  `<username>@login.wolfpack.quest` (synthesized, never mailed) and stamped
  onto `wolfpack_members.user_id` — the same binding OAuth writes, so every
  gate works unchanged. `ALLOWED_ROLE_NAMES` enforced at claim (the flow's
  sign-in moment). Password reset = officer re-invite (detects `wp_invited`
  metadata and resets instead of creating). Sign-in form lives below the
  Discord button (`PasswordSignIn.tsx`). Later-OAuth merge story + dashboard
  prerequisite (Email provider enabled): `docs/DECISIONS-2026-08-24.md`.
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
- **The card goes in the thread's reserved slot 3-6** (`claimSlot`), so the top of
  the night's thread reads review · review-overflow · 8:30 · 9:30 · 10:30 · 11:30.
  `reserveReviewSlots` TOPS UP, so a thread opened before the tick slots existed
  gains them mid-night instead of going without. If no slot is available the card
  posts normally — a tick card at the bottom beats no tick card.
  ⚠ `releaseUnclaimedSlots` deletes by checking each message still carries
  `RESERVED_TITLE`, NOT by "isn't the review's id" — the latter would delete the
  night's tick cards. Every placeholder shares that one title for exactly this
  reason.
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
the existing `RH_API_KEY`) and it can only fill an end time or add an event
Discord never got. Everything fails open to "no event scheduled".
⚠ **The "mirror is empty / unverified in prod" note that sat here until
2026-08-13 was stale and cost us a wrong answer.** The mirror is live and
healthy — 292 events + 14,741 signups going back to 2024-08-08, synced every
30 min — and it is far more than an end-time backstop; see the signup-archive
entry below before concluding anything about what availability data we hold.
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

### Who is dead right now — the registry and its two sources — 2026-08-10/11
**The registry** (agent, `_noteDeath` / `_clearDeath` / `_isDead` /
`_deadNamesSnapshot`): `nameLower → diedAtMs`, consulted by any surface that
names a raider (the off-heal list excludes the dead). It **forgets after 15
minutes** and clears on alive evidence — we don't see every rez, and tombstoning
someone for the rest of the night is worse than briefly missing a corpse.
**Source 1 — the log**: a confirmed player death in the encounter builder.
**Source 2 (#205, agent 2026-08-11) — Zeal group HP**: `_noteGroupHpFromState`
on the `/api/zeal-state` ingest path watches gauges 11-15 (+ exact
`hp_current/hp_max` when `/pipeverbose` is on) and marks a member dead when
their HP hits zero **and holds** — evidence that owes nothing to log text, which
is the cross-check the feign bug never had. Guards: seen-alive-first, ≥2 samples
/ ≥2.5s dwell (Zeal's clamped negative per-mille makes a lone zero an artifact),
and a 60s refusal after that name's feign emote — `noteFeignEmoteLine` is the
only thing in the agent that knows `"<Name> dies."` happened. It never
re-stamps a death the log already holds. `_groupDeathWatchSnapshot()` is the
diagnostic. **No `death_evidence` table or upload exists** —
`docs/DESIGN-group-death-watcher.md` §8 for what was deliberately left.

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
them (Hitya 2026-08-05). `_reconcilePetIdentity()` clears landings + the
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

### Instant boss mechanics — the third capture path (#206, 2026-08-11)
Two paths existed and both are keyed on things an instant effect does not have:
`shouldKeep`→`parseEvent` on damage/heal NUMBERS, and the buff/debuff landing
indexes on spell DURATION. So the ~138 instant boss effects that emit a perfectly
good line (AEs, death touches, dispels, stuns, "\<mob\> is completely healed.",
"\<mob\> fades away.") were invisible. The third path is keyed on the catalog's
`cast_on_other` text: `_rebuildMechanicMatchers` / `parseMechanicLanding` /
`noteMechanicLanding` in `packages/wolfpack-logsync/index.js`, hooked in the
watch tail beside the debuff path (ahead of `shouldKeep`) and only on lines the
two timed paths declined. Surfaced on the 💥 **Boss mechanics** card, Triggers
tab; served as `recentMechanics` on `/api/state`. Local ring only — nothing
uploads yet (`DESIGN-mechanic-capture.md` §0/§7).
Four load-bearing rules:
- **Scope comes from the bot.** Spell-catalog **v8** stamps `npc: 1` on the ~1.4k
  spells in `eqemu_npc_spells_entries`; the index refuses anything else, and if
  NO entry carries the flag it stays EMPTY (bot pre-v8) rather than indexing
  every player nuke and cure in view.
- **The gate is the FIGHT, not `good_effect`.** EQ classifies dispels as
  BENEFICIAL (Nullify Magic / Annul Magic / Beholder Dispel are all `good=1`), so
  a detrimental-only filter drops "\<raider\> feels dispelled." Instead:
  `_fightTargetMatches` → on the mob we are hitting, drop detrimental families
  (our own nukes); on anyone else, drop heal families (our own CH chain).
- **Never crowned.** The junk-family guard the timed indexes use is deliberately
  not copied: it exists because those indexes pick a representative and can be
  wrong (Kneel Test, Bolt of Karana, every-yawn-is-Turgur's). Shared text →
  `spell_id 0`, `spell_name null`, family attached, printed as "unidentified".
- **One row per CAST**, with a victim count (names capped at 12, count is not) —
  a 30-target AE is one row, and the same line seen in a main + an alt log
  collapses instead of double-counting.
Tests: `test/mechanic-capture.test.js` (includes an assertion that the timed
indexes are byte-for-byte unaffected).

### CH chain tracker
Parses shout/raid callouts: numbered calls (`_CH_CALL_RX`), GO cues
(`_CH_GO_RX` — stamps `lastGo` so the overlay flashes GO! on that slot),
personal heal macros (`_CH_PERSONAL_RX` — **never take a slot**, CH-equivalent
or not; they render as the spot-heal banner, labelled "Druid CH" etc. from
`CH_EQUIVALENT_SPELLS`), and the **roster
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
Manual removal (agent 3.5.79): a ✕ on every slot row → `POST
/api/chchain/remove {num,name}` → `removeChChainSlot`. Deleting the row is not
enough — whoever put them there is still shouting — so it also blocks that
(name, number) for the chain's life. Narrow on purpose: a different healer may
still take the number, a roster call clears the block, and on a CONTESTED slot
the row survives and passes to the remaining claimant rather than being deleted
out from under the real cleric.

### Divine Intervention: readiness chips + the two-cleric callout (#204)
Two separate things on the same overlay. **Readiness** is log-driven: a
self-cast of DI stamps `di_ready_at = castStart + 6s + 90s` (`_noteDiCast`;
`noteDiInterrupt` refunds an interrupted/fizzled cast), rides `live-state` →
`GET /api/agent/di-status` → `diStatusSnapshot()` → the ✓/countdown chips.
A null `ready_at` means **we never SAW the cast**, not that DI is available —
`unknown` is carried separately from `up` for exactly that reason.
**The callout** (agent 2026-08-11, `DESIGN-di-callout.md` §6) fires on the
death-save line `<Tank> has been rescued by divine intervention!` (EQMacEmu
`Mob::TryDeathSave` → StringID 1029; **always name-form, 200-unit range, and a
FAILED save emits nothing** — "survived divine intervention" is an invented
line, do not add it). `trackDiFired` → `_diRankCandidates` nominates **two**
clerics off the chain: recently active, not due to cast inside
`DI_CAST_MS + one beat`, confirmed-ready DI outranking unknown, mana as
tie-break. Hard exclusions: `kind`-labeled druid auto-slots and known
non-Clerics (DI is cleric-only; the chain is not a cleric roster), corpses
(`_isDead`), and a MEASURED recast. Ties/empty → the chain's two most recent
healers; nobody nameable → no nomination (the guild trigger still calls the
event). Output is ONE `text_overlay` fire on the existing trigger-TTS surface
plus `diCallout` on `/api/state` → the card in `chchain.html` (evidence chips,
20s countdown, local-only ✕ — recording is #207). Tests:
`test/di-callout.test.js`.

### Main target & main tank
`_resolveMainTarget` = the NPC most raiders target, from the bot's Extended
Target aggregate (agent-side 3s cache primes it) — drives the TARGET bar +
enrage math on Tank/Command Center; local Zeal target is only the fallback.
`_resolveMainTank` = CH-chain target if one is running, else the raider the
MAIN TARGET's melee connects on most (15s window), else any-mob tally.

### Triggers
Guild set polled from the bot (2 min; class-filtered), personal set from
`personal_triggers.json`. One compile entry point — `compileTriggerPattern`
(token expansion → .NET/RE2 dialect normalisation → raw-line anchoring), which
replaced the divergent `_translateDotNetRegex` / `_translateGinaPlaceholders`
pair on 2026-08-07. `{s}` placeholders compile to named groups;
`_captureMatchesCharmPet` suppresses self-charm-pet fires; roster gate via
`require_raid_member`. Zeal gauge conditions fire without a log line.
Cross-Mimic relay: detecting agent POSTs `trigger-relay`, others poll
`recent-fires` (~1.5s) and run the same actions; dedup by name+captures in 8s.
Fires live in an **in-memory ring buffer** — nothing durable, so "has this
trigger ever fired?" is currently unanswerable (`DESIGN-callout-overlay.md`).

### Trigger pattern anchoring — the `^` trap (#190) — 2026-08-04, revised 2026-08-09
`evaluateTriggersAgainstLine` matches the **raw** line (`[Sun Aug 02 21:10:01
2026] <message>`) with flags `i`, **no `m`** — so a bare `^` anchors before the
timestamp. **37 of 109 enabled triggers were written `^<message>` and could
never fire**, including eight callouts added the day it was found.
`web/lib/triggerPattern.ts` normalizes on save and `/admin/triggers` flags dead
rows; the 37 are staged, not applied (`RUNBOOK-dead-triggers.md`) —
mass-enabling callouts is a raid-noise decision. Sibling failure modes, same
"enabled therefore assumed working" shape: the DI trigger matched **invented**
text (check `eqemu_spells.cast_on_*` for the real string) and AOE_DANCE was
**mis-signatured** to another spell's text.

**Both halves are now handled in the compiler** (`compileTriggerPattern`, which
replaced `_translateDotNetRegex` on 2026-08-07):
- a top-level `^` is rewritten to `^(?:\[[^\]]{1,40}\]\s+)?` —
  **optional**, so imported GINA/EQLP patterns and legacy `\]\s+` ones both fire
  (`_rewriteAnchorsForRawLine`);
- an **unanchored** pattern that OPENS with `{s}`/`{n}` gets the same optional
  prefix prepended. `{s}` is now `.+?`, which at index 0 of a raw line eats
  `"[Sun Aug 02 …] "` straight into the capture. The old allow-list class hid
  this by accident (it could not match `[`, so the engine advanced past the
  timestamp itself). Shipped broken in agent 3.5.44–3.5.53; fixed in 3.5.54,
  caught only because `test/trigger-class.test.js` **does not exist on `beta`**.
  `{c}` is exempt — it expands to a literal alternation of character names.

⚠ The old note here said *"deleting the `^` is wrong — you capture a leading
space."* That was true of the allow-list class and is **no longer true**: an
unanchored `{s}`-leading pattern is now guarded and captures cleanly. Do not
re-derive the old advice when applying `RUNBOOK-dead-triggers.md`.

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

### Bringing in a character nothing else can see (🧳 on `/me`)
A bank mule or a never-raiding alt produces no logs, no `/who` sighting and no
OpenDKP row, so every other discovery path is blind to it — its inventory file
is the only evidence it exists. `MuleUpload.tsx` → `uploadMuleInventories()`
takes **many files at once** and derives the character from each **file name**
(`<Name>-Inventory.txt`), since the rows inside are items, not identity.
Rules live in **`web/lib/inventoryFile.ts`** (pure, tested):
`characterFromInventoryFilename` refuses anything that is not a plausible EQ
name — letters only, so a renamed copy cannot invent a junk roster row — and
`claimVerdict` decides ownership, and the only bar is **"is it already claimed
by somebody else?"**: **already in your household → upload, nothing to claim**;
**linked to another member → refuse**; **anything else — brand new, or in
`characters` but unclaimed → it becomes yours**. Both the created row AND a
claim of an existing one stamp the `registered_via_web_*` audit columns, and
the character joins the uploader's family via `main_name`.
⚠ That third case is a **deliberate widening** (Hitya, 2026-08-14). The first
cut refused to claim an unclaimed row carrying an `opendkp_id`, reasoning it
meant a real member who merely had not linked Discord. Overruled: *"Being in
the guild should not be a limiter for someone making a new character and trying
to use the inventory function or target info overlays."* Holding the file is
real evidence — you got it by logging in on that character. The refusal broke
the actual case (your own alt, already in OpenDKP, invisible to you) to guard a
hypothetical one, and guarded it weakly anyway: anyone wanting someone else's
character could just rename a file. A wrong claim is visible, audited and
one-click reversible; a refusal is a dead end for a legitimate member. Results are reported per file so a mixed batch names
which ones failed. The older per-character 🎒 upload is unchanged and shares the
same parse + replace-snapshot write.

### EQ folder discovery — "known" vs "has logs"
Two lists, deliberately: `resolveEqDirsWithLogs()` returns **`dirs`** (folders
that contain eqlogs → what we TAIL) and **`knownDirs`** (configured paths,
`eqgame.exe`-detected installs, a running client's folder → what we KNOW).
Mimic passes the second to the agent as **`WOLFPACK_EQ_DIRS`** (path-delimited);
`_eqSetupDirs()` reads it before falling back to watched logs, and the
dashboard's "No EQ folder selected" banner reads the same source.
⚠ They were one list until 2026-08-14 and the result was a deadlock for every
new user: *Set up EQ for me* writes `Log=TRUE`, so it runs precisely when there
are no logs — and it refused for want of logs it would have created.
`findEqInstalls()` scans for `eqgame.exe` (present from install, no logs
needed), including named `TAKP`/`TAKPv22` paths and a drive-root walk for any
`takp*` folder, since TAKP carries its version in the directory name.

### The Dock (`dock.html`, Mimic 2.5.1-beta) — many overlays, one renderer
One always-on-top window that hosts other overlays as same-origin `<iframe>`
panes. Every BrowserWindow is its own Chromium renderer at **~80 MB resident
before it paints** (measured 2026-08-04 — the reason `_reapDisabledOverlays`
exists), so five docked overlays cost one renderer instead of five.
- **The panes are the REAL overlay files**, loaded unmodified. `_DOCK_CATALOG`
  in `main.js` maps key → label/file/flag, and a test pins every `file` against
  the `loadFile()` the standalone window uses, so a docked fork cannot drift.
- **Docking clears the overlay's `show*` flag**, so the existing reaper
  genuinely DESTROYS its window — that is where the saving comes from. The
  previous pref is kept in `cfg.dockedPrev`; undocking restores the window
  visible. `_overlayForcedOn` refuses to force-create a docked overlay, or
  unlocking would spawn the floating copy beside its pane.
- **`nodeIntegrationInSubFrames: true` is load-bearing**: it runs `preload.js`
  inside each pane so `window.mimic` exists there natively. Three calls are
  window-scoped and are redirected in preload behind `WP_IS_DOCKED` — a pane's
  ✕ undocks that pane (`dock-set`, not `hide-overlay`), and both auto-fit paths
  plus the resize-preset menu go inert so one pane cannot resize the dock.
- **Layout:** 1/2/3 columns, and each pane carries a `{c,r}` span (clamped to
  the grid) so Target Info can be 2 wide × 2 tall while the HUD is 1 × 3. Drag a
  pane in setup mode to reorder — the iframes go `pointer-events:none` there, or
  a mousedown inside a pane reaches that overlay's own ✥ and drags the WINDOW.
- **Backgrounds are opt-in and per-pane.** The dock's plate only paints under
  `body.wp-backdrop`, so "off" removes it entirely rather than dimming it. A
  pane may override the dock (`On`/`Off`/follow); "off" sets `--bg-alpha: 0`
  inside that pane's own document, which is what makes the overlay's own cards
  transparent instead of just tinting the pane.
- **Auto-height + grow-upward** (both default ON): each pane is measured from
  its own content on a 1s heartbeat (panes grow and shrink on their own — a
  fight starts, a queue fills), then `dock-auto-height` sizes the window,
  keeping the BOTTOM edge fixed so it grows away from the middle of the screen.
- **Holding panes implies being on screen** — `applyDockVisibility` and
  `_overlayForcedOn` both treat a non-empty `dockedOverlays` as wanting the
  dock. Without that the only ways to turn it on were the tray entry and
  docking from inside the dock, which you cannot reach while it is hidden.
- **Docking from the agent dashboard**: the Overlays page carries a DOCK/DOCKED
  button per row (`wp-ov-dock` → `dock-overlay` IPC), and greys out a docked
  overlay's own on/off toggle because its flag no longer controls anything.
- **Not dockable, deliberately:** the trigger overlay only — its flag means
  "make sound", #97 fires TTS from a hidden window, and its position is
  load-bearing. The Command Center IS dockable; it carries an `agentPath` so the
  pane resolves the agent-served copy (#65) exactly as the window does.

### Overlays (one .html each)
DPS HUD (`overlay.html` — DPS / Tank / **History** tabs; DPS+Tank are this
machine's own observations, History is the guild's settled numbers for the last
6 mobs with a ◀ ▶ pager. Agent 3.5.80 moved the guild-combined merge OFF the
live view: mid-fight the bot has under three readings per player so its
corroboration estimator falls back to max and doubles people. `_recordFightHistory`
captures each kill and re-asks `/live-damage` at +40s and +100s; the header says
`· N clients` once settled, `· settling…` until then), Triggers+timers
(`triggers.html`), CH chain
(`chchain.html` — slots, GO pill, beat countdown, pivot, off-heal list),
Tank (`tank.html` — MT focus, DA, DS, deathtouch, rampage+invuln, off-heal),
Command Center (`command.html`), Extended Target (`extarget.html` — off-tank
toggle, stale rows), Charm, Pet, Mob Info, Buff queue, /who, Melody,
Zeal health, Settings, loading. Overlays poll the local agent
(`/api/state`, `/api/tank-state`, `/api/command-center`,
`/api/extended-target`, `/api/buff-queue`) every ~1.5–2s.

**Overlay size 50%–200% (mimic + agent 3.5.88, beta — Fittir's 5K monitor).**
zoomFactor per overlay window, applied in `applyOverlayOpacity`'s shared
ready-to-show lifecycle so every overlay (and any future one) inherits it.
Three surfaces: 🔍 "Size — all overlays" on the dashboard Overlays tab
(global `cfg.overlayScale`), a per-overlay "size" slider preload injects
into each overlay's setup bar (`cfg.overlayScaleByKey[key]` override; key
resolved main-side from the sender via `_boundsKeyForWindow`; ↺ follows
the global again; dock panes skip it — one window, it would scale every
pane), and Settings → "Overlay size". `overlay-auto-height`,
`overlay-ensure-min-height` AND `dock-auto-height` multiply CSS px by the
window's zoomFactor so scaled overlays don't clip (the dock's 1s fit loop
churned at 130% without the conversion). A scale change resizes the window
BOUNDS with the zoom — center-anchored, work-area clamped, ~180ms ease-out
glide via `_scaleTween` (per-window `__wpScaleState` no-ops unchanged
targets; boot sets zoom only, since persisted bounds were saved at that
scale). Sliders apply on release; "Smooth slider" (default ON,
`cfg.overlayScaleGlide`) IS the glide — off snaps instantly. The dock sits
out of the global scale unless "Scale the dock too" (`cfg.overlayScaleDock`)
is on. The setup bar and drag controls counter-zoom (`wp-zoom` push →
`--wp-zoom` var; `width × z` + `scale(1/z)`) so the setup chrome keeps one
painted size spanning the window width at every scale.

---

### Callout overlay UX — dismissible countdowns + recorded dismissals (#207) — 2026-08-11
Where each half lives, because this one spans three files.

**Layout (`triggers.html`).** `#timers` is **bottom-anchored** (`bottom:8px`,
`flex-direction:column-reverse`) so the stack grows UPWARD, away from the centre
of the screen — the centre is reserved for the momentary flash
(`DESIGN-trigger-overlay-v2.md` §3/§3b). The window itself is bottom-anchored to
match: `_GROW_UP_DEFAULT_KEYS` in `main.js` makes `trigger` grow-up **by
default**, and every reader (resize path, chrome-menu checkbox, ⬆ toggle) goes
through the one `_growUpSetting(cfg, key)` helper so an explicit choice wins in
both directions. `--timers-space` (set from `measureWanted`) lifts the centred
`#alertcol` clear of the stack — flex centring halves a bottom margin, hence
twice the stack height.

**Two render invariants, applied to the server list before any DOM work.**
`collapseTimers` keeps at most one row per `(mob, effect class)` — today only
slows classify (`TIMER_SLOW_RX`), longest-remaining wins — so the Ssra wall of
identical slow rows cannot be drawn even if a new upstream cause appears.
`splitVisible` caps the stack at `MAX_TIMER_ROWS` (6) with a `+N more` tail;
**loot-auction chips are exempt** (#129 — a bid window a raider cannot see is a
lost item). Capped-out rows leave the DOM but stay in `timerNodes`, so their
pre-end warning still SPEAKS. Row reconciliation is an insert-before loop, not a
blanket re-append (that restarts every row's pop animation each poll).

**Dismissal (the ✕ on every row, 🗑 clear-all in the title bar).** Both use the
hover-interact handshake — locked overlays are click-through. `dismissTimer`
POSTs `/api/timers/cancel {id, reason}`; clear-all POSTs `{all:true}` (the agent
spares loot chips) and also clears pinned sticky callouts.

**Recording (`packages/wolfpack-logsync/index.js`).** `_recordCalloutFeedback`
is the single funnel: `dismissed` from the cancel endpoint and from
`/api/triggers/feedback` (sticky rows), `expired` from the natural-expiry branch
of `_activeTimersSnapshot` — the control group, without which a dismissal count
is not a rate. A mob-death cancel deletes the row itself and so is neither.
Votes batch (30s / 25) into the existing `trigger_feedback` upload; latency is
`voted_at − fired_at`, no new column. Rehearsal/replay fires update the local
counters (`/api/state` → `calloutFeedback`) but never upload — that is the
without-a-raid test path. Bot: `TRIGGER_FEEDBACK_DIRECTIONS`; DB: migration
`20260811120000_trigger_feedback_dismissal_directions.sql` widens the CHECK
constraint (a row is REJECTED until it is applied). Dismissals are per-user and
session-scoped by construction — nothing relays, nothing touches
`guild_triggers`. Tests: `test/callout-dismissals.test.js`.

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
**FOUR ways a tag draws the nameplate arrow and reaches NO log** — the arrow is
NOT evidence the broadcast happened, which is what made this so hard to see:
`/tag local` (never broadcasts — `handle_tag_command` only sends for
rsay/gsay/chat); `/tag chat` with the channel unjoined
(`send_tag_message_to_channel` bails); and `/tag suppress on`, where
`chatPrintChat` returns early on `check_for_tag_channel_message`'s suppression
verdict AFTER `handle_tag_message` has already drawn the arrow. Note suppress
does NOT need `/tag filter` for the chat-channel path.
**The fourth is the only one that hits a CORRECTLY configured install, mid-raid:
the server's chat rate limit.** Tags are chat messages, so a burst trips *"You
are currently rate limited, you cannot send more messages for 32 seconds"* and
the broadcast is simply refused — while the arrow still draws locally, so the
tagger believes the raid can see a mark nobody received (Hitya 2026-08-07,
tagging through The Deep). The other three are config states you fix once; this
one recurs, dynamically, exactly when marking fastest. Measured usable rate:
~8/min sustained on `/tag chat` before the lockout. Agent surfaces it on the 🏷
card (`_tagRateLimit`) — treat "no tags captured" during heavy marking as
rate-limiting until proven otherwise. **Spread tagging across several raiders:
the limit is per character.**
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
colored glyphs (▲/🐾/🛑) + pooled "tags:" block. `ext_tag_fresh_sec` (**600** —
raised from 120 in bot 3.1.16 / agent 3.5.41; a tag is a deliberate fight-long
mark and 120 expired it mid-pull). Upload cap `ZEAL_TAG_UPLOAD_CAP` (64, was 24
— a Deep sweep hit 24 exactly and dropped the boss; named mobs are now kept
unconditionally, generics fill newest-first). Heading modes on `ext_pos_heading` (0 off / 1 join-only-safe / 2
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

- **Item catalog for the wishlist picker (`/api/agent/item-catalog` +
  `item_catalog_droppable` view, bot 3.1.98)** — every item any catalogued NPC
  can drop, with its expansion, served ETag'd so agents cache it on disk and
  search locally. 11,099 rows · ~380 kB JSON · ~130 kB gzipped.
  ⚠ **The universe is "everything droppable", NOT "everything our tracked
  bosses drop"** (Hitya, 2026-08-30 — include PoP so people can build a wishlist
  before the 2026-10-01 unlock). Only 12 PoP bosses are registered in
  `bosses_local` against 407 Luclin, because that board is built out AFTER
  unlock, so a boss-driven universe reached 113 of 1,212 PoP items. The drop
  table needs no boss registration and cannot go stale when `/addboss` runs.
  ⚠ **The 12h TTL is the only expensive knob.** The bot serves from memory so
  clients never reach Supabase; at the spell catalog's 1h TTL a miss cycle would
  re-read 380 kB 24×/day. The source moves weekly — do not lower it.
  Era comes from the dropping NPC's zone (`id = zoneid*1000 + n`), the recipe in
  `eqemu-catalog-cheatsheet.md`, since items carry no expansion column; an item
  in several eras takes the earliest, and the 22 with no zone match keep a NULL
  era rather than vanishing from the picker. Costs recorded in
  `DESIGN-selfhost-wizard.md` §3. Guarded by `test/item-catalog.test.js`.
- **Loot bidding: RECENT MISSES is PER CHARACTER (`_buildMisses`, bot 3.1.97)** —
  Hitya, 2026-08-29: *"removed for that character after that character wins that
  item"*, and *"I know for a fact that there are items that I've bid on in the
  past and not won."* They were right, and the shortfall was large.
  ⚠ **The 2026-08-09 fix (drop items the family already owns) was right about
  the principle and wrong about the scope.** `wonItemIds` is built from
  `opendkp_loot` for the whole family — *every item any character ever looted* —
  and any hit removed the miss for everyone. **Measured on the reporting account
  before changing anything: 20 items bid on and lost, 19 hidden by that sweep, 1
  displayed** — exactly the single row in their screenshot.
  `_buildMisses` now keys on **(item, character)** and drops a pair only when
  THAT character owns the item (its own auction wins ∪ its own loot rows), so a
  sibling's copy no longer erases your miss and two characters bidding on one
  item get a row each with their own last bid. ⚠ Bids carry the OpenDKP account
  login in `character_name`, not the in-game character — `character_id` is the
  only per-character key, which is why the loot sweep now also selects
  `character_name` to answer ownership per character.
  Past wins raised 100 → 400 and made searchable by item or character in the
  agent dashboard (filtered in place; a re-render per keystroke steals focus).
  ⚠ **(bot 3.1.99) The per-character fix exposed the deeper hole: the bids
  mirror only ever held WINNING bids.** The auctions LIST payload's `Bids[]` is
  winners-only — measured 1.08 bids/auction, 92% of auctions with zero losing
  bids — and `syncAuctionBids` (the detail fetch with the full list) had NO
  CALLERS since it was written. `syncPendingAuctionBids` now runs at the tail
  of `syncAuctions`: ≤`OPENDKP_BIDS_PER_PASS` (default 10, 0=off) detail calls
  per pass, newest-first so the misses window heals first, each auction paying
  its one call EVER (`opendkp_auctions.bids_synced_at`; closed bid lists are
  immutable). First error aborts the pass. Char naming: `characters.opendkp_id`
  is now authoritative for char_id→name with the MODE-over-loot heuristic as
  fallback only — the heuristic failing silently is what blanked CHAR and made
  Rockin's multi-winner Thorny Chain Helm WIN render as a family miss.
  ⚠ **(bot 3.1.100) Detail-sourced bid rows have NO CharacterId** — OpenDKP's
  per-auction history is Name/Rank/Value/Date — and `_buildMisses` used to skip
  id-less rows, silently hiding every backfilled loss (the exact data the
  backfill exists to surface). It now keys by character NAME when the id is
  absent, with ownership answered by the loot mirror (`ownsByName`) since a
  winner's award always writes a loot row. An item that leaves the game (the
  Hsagra shard is consumed in its turn-in) is invisible to every automatic
  ownership source — the row's ✕ dismiss is the mechanism for that, and it is
  currently PER-MACHINE (`logsync.lootdismiss.json`); the bot's roaming
  `character_bid_prefs.dismissed` field exists but no client calls it — queued.
- **Platform map (`components/PlatformMap.tsx` + `platformData.ts`, web 1.7.0)** —
  top-down, not radial (Hitya): `wolfpack.quest` is the ROOT and the other five
  branches stand under it in pipeline order, joined by a CSS rail. Hovering a
  column lists that branch's `details` names via a `0fr → 1fr` grid-row
  transition, with `items-start` on the grid so only the hovered column grows.
  ⚠ **Hover reveals on a pointer; on touch the list is simply always open** —
  there is no hover to discover on a phone, and a tap-toggle would fight the
  card's own link (the bug the nav disclosure took four attempts to kill).
  `canHover` decides and nothing else does.
  ⚠ **The branch DATA lives in its own module with no `'use client'`.**
  `'use client'` marks every export in a file as client-side, including plain
  arrays — and `/platform` and `/` are server components that `.map()` over
  `BRANCHES`. Doing that across the boundary throws *"Attempted to call map()
  from the server but map is on the client"* at RUNTIME: it type-checks, it
  builds, and the page 500s. Found by loading the page, not by any gate; held by
  `test/platform-map.test.js`.
  It also replaced the 1200×780 radial SVG whose labels were sized in user
  units — that is why it needed a 760px floor and a sideways drag on a phone.
  This is ordinary DOM, so it reflows and both width floors are gone.
- **`/start` — the install walkthrough (`web/app/start/page.tsx`, web 1.6.0)** —
  the landing page's one CTA, "Run with us.", points here. Five steps, each
  naming the button as it appears on screen, plus the three one-click installers
  (`/mimic`, `/mimic/beta`, `/mimic/linux`, all `?direct=1`) and the three field
  failures with the symptom that separates them.
  ⚠ **Nothing on it is authored — it is DOWNSTREAM of two other surfaces** and
  quotes their labels verbatim: steps 1–4 from `commands/parsehelp.js` (the
  Discord walkthrough, the guide of record) and `🔧 Set up EQ for me` + the
  exact ini keys from `apps/mimic/settings.html`. Rename a button on either and
  this page confidently sends people to click something that no longer exists,
  which no build or browser can notice — so `test/start-page.test.js` asserts
  every quoted label still exists in the file it came from, and fails the build
  when one drifts. ⚠ **Deliberately public** (no session read): the reader does
  not have an account yet — that is the point (`DESIGN-onboarding-overhaul.md`
  §Surface 2). Phase 1 of that spec; the auto-checkoff steps are still unbuilt.
- **Top bar (`components/SiteHeader.tsx` + `HeaderIcons.tsx`, web 1.5.0)** — one
  bar in two shapes. FULL (top of a window ≥1180px): brand, the three download
  channels with labels, the link categories in the middle, then clock, utility
  chips and account. COMPACT (**scrolled OR too narrow — one `compact` state, so
  there is one folded layout, not two**): mimic icon, `β`, `🐧`, a Menu
  drop-down, sign in. ⚠ **Nothing is dropped, only folded** — the Menu is built
  from `Nav`'s exported `GROUPS`, so a second copy of the site's navigation
  cannot go stale, and it also carries `/me`, Feedback, OpenDKP, Admin and the
  timezone. ⚠ **Banner and bar share ONE `sticky top-0` container** in the
  layout: two independently sticky elements stack on each other, and the bar has
  to sit under a banner whose height changes when folded. ⚠ Compact channels are
  the symbol ALONE, which is also what keeps the bar inside a 360px viewport —
  the labels are 45px across the three chips. ⚠ **The stable channel's symbol is
  the download arrow, not the mimic logo** (Hitya, 2026-08-28): the logo is the
  brand mark in the same bar, so the folded bar was showing one picture twice —
  as "home" and as "download" — with only a blue box telling them apart. One
  download mark per chip; there is no trailing arrow. `TimezonePicker` now reads as a
  clock plus the 3-letter zone (`Intl` `timeZoneName: 'short'`), with the native
  `<select>` kept and laid transparent over it so the OS picker, keyboard and
  accessible name all still work. Guarded by `test/header-chrome.test.js`.
- **Header chrome + the beta bar (`app/layout.tsx`, `components/BetaBanner.tsx`,
  `components/TimezonePicker.tsx`, web 1.4.4)** — 362px of banner + header sat
  above the page on a 390px phone. Measured per row rather than guessed, and the
  costs were not where they looked: the account block wrapped `Sign in` onto its
  own line **by four pixels** (185px needed, 181px available), the nav wrapped at
  360px, and the beta bar's single sentence ran three lines. All three are width
  problems, so every fix is responsive and **none removes a control** — chips go
  emoji-only below `sm` with the label carried by `aria-label` (which wins over
  content, so the accessible name is the same word at every width), `.quest` is
  dropped under 400px with the home link named explicitly, download labels
  shorten, the timezone `<select>` is capped (the native picker still shows every
  option), and gaps/chip padding tighten horizontally only — `py-1.5` is a tap
  target and is untouched. Result 362 → 214px, and 186 with the bar collapsed.
  ⚠ **`BetaBanner` is dismissible but never disappears.** Collapsing leaves a
  20px amber strip that still reads BETA with a gold chevron back; "you are not
  on production" has to survive dismissal or someone files a bug against the
  wrong site. State is in `localStorage` (both accesses try/catch'd — private
  mode *throws* rather than returning null) and is applied via `useLayoutEffect`
  so it lands **before paint**; a plain `useEffect` flashes the full-height bar
  on every navigation. The effect is picked by environment because React warns
  on `useLayoutEffect` during SSR. Guarded by `test/header-chrome.test.js`.
- **Landing page + top nav (`web/app/page.tsx`, `components/WolfPack.tsx`,
  `components/Nav.tsx`, `components/PlateIcons.tsx`, web 1.4.x)** — the hero is a
  raster wolf plate (`public/wolf.png`, 973²) with five scaled copies behind it,
  revealed as a SEQUENCE: eyes, then the pack's eyes, then the alpha's lines,
  then each pack member nearest-first. **Depth is `filter: brightness()`, never
  `opacity`** — brightness darkens the bone while leaving alpha intact, so a
  nearer wolf occludes the one behind it; fading with opacity made them ghosts.
  ⚠ **Brightness was necessary but NOT sufficient** (2026-08-28): only the bone
  is opaque, so every dark line was a hole and a wolf in front showed the one
  behind through its own linework. Each wolf also gets `public/wolf-solid.png` —
  its filled silhouette in the page ground, flood-filled inward from the image
  border — beneath its plate. Invisible against the ground; the whole difference
  where two wolves overlap.
  ⚠ **The eye light is its own plate (`public/wolf-eyes.png`) painted ON TOP.**
  Keying cut the dark linework and left the eye interior OPAQUE, so a glow
  behind the wolf reads through the brow strokes and not the eye — that was
  shipped, and looked plausible. The overlay is computed from `wolf.png` by
  connected-component labelling of its alpha (see `wolf.provenance.txt`) and
  shares its canvas, so it needs no coordinates and cannot drift. The reveal
  filter must stay scoped to `.wolf-plate`: written as `.wolf-alpha img` it also
  matches the glow and the eyes can never open first. Both traps are held by
  `test/wolf-eyeglow.test.js`. **Mobile fit:** the pack fans to 1.35× the alpha's
  box, which put the document at 477px inside a 390px phone — the hero clips with
  `overflow-x: clip` (not `hidden`, which would make it a scroll container) and
  she is 86% wide there. Her width, not a tighter fan, is the lever: pulling the
  fan in instead hid the pack's eyes behind her ruff. The rest of the page is
  held one beat behind the wolf by `.page-reveal`, disabled under reduced motion.
  ⚠ **The headline is a rhyming couplet across an authored `<br />`**, so both
  halves must hold one line each — a wrapped third line breaks the rhyme where
  the reader hears it. Measured: the longer half needs ~7.6–7.85vw from 320 to
  430px, so the clamp floor sits *below* the usual 2rem instead of pinning the
  type larger than the line. The `ch` cap is sized in the same em, so it shrinks
  with the font and will re-wrap what the clamp just fixed — widen both together
  or neither. `test/wolf-eyeglow.test.js` derives the requirement from the copy's
  own length, so growing the copy fails the test rather than the page.
  Nav is four doors — Raid / Stats / Prep / **/me**.
  ⚠ **`/me` renders unconditionally**; gating it on `showMe` made the four doors
  three for every signed-out visitor and it went missing. `/me` redirects to
  `/auth/signin?next=/me` itself, so the link never dead-ends. Placement rulings
  (Hitya, 2026-08-28): Buffs is Raid; Quartermaster and `/who` are Prep — Raid is
  what you touch DURING one, Prep is what you do beforehand. Each ruling is
  asserted as a pair (in the right group, out of the wrong one) so a move done
  by copying leaves a failing test rather than a duplicate.
  Groups open on hover on fine pointers and on tap elsewhere — the open state
  is guarded on `matchMedia('(hover: hover) and (pointer: fine)')` because a
  tap's compatibility `mouseenter` plus the click otherwise open and immediately
  close the panel.
- **/me** — per-character private hub (parse stats, rollups, chat counts,
  PvP, loot, wishlists count, live buffs/zone, exclusion toggles). Data floor
  via `character_data_floor`; excluded characters honored everywhere.
- **/me/ui** — Web UI Studio: latest backup metadata + socials from
  `ui_socials_index` (service-role read, household-filtered), macro
  editor staging into `ui_pending_edits` (applied by the agent at logout,
  status shown), guild common-macro library (≥3 characters), suggestion
  catalog (`web/lib/macroSuggestions.ts`).
- **Character swaps on /raid (`swapFor` in `web/app/raid/page.tsx`)** — Mimic
  detects a same-pid character switch and stamps `character_live_state
  .swapped_to/_at`; /raid then parks that character with "(swapped to X)",
  group stripped, for up to 6h. **A swap ENDS when `raid_roster` carries a
  `loc_at` (or HP) newer than `swapped_at` + 30s** (web 1.1.51). Presence in the
  raid window is NOT proof — EQ keeps listing campers, which is why the marker
  exists — but Zeal reads loc off a live `Entity*`, so only someone in the zone
  has one. Asymmetric on purpose: loc present proves life, loc absent proves
  nothing (a raider in another zone has no entity here either), so the rule only
  ever clears a swap on positive evidence.
- **/parses boss cards vs trash rollup (2026-08-20)** — kill cards are CURATED
  bosses only (`bosses_local.auto_registered = false`, filtered IN THE QUERY so
  trash can't eat the 250-row window; `web/lib/bossFilter.ts`, shared with the
  landing widget). Everything else — farm, raid trash, uncurated nameds — is
  still collected and renders as one 🗡 line per zone per night via the
  `parses_offcard_rollup` RPC (ET day buckets, zone derived from
  npc_id = zone_id*1000+n). Promotion is automatic: a name arriving on the
  /sll lockout or bosskill relay flips its row to curated
  (`_promoteLockoutBoss`, bot `index.js`) — "if they have a loot lockout we
  can keep them on" (Hitya 2026-08-19).
- **Member-side character filing (web 1.1.82 + bot 3.1.63, 2026-08-20)** —
  `/me` → "Characters we think are yours": characters whose uploads carry the
  member's own `agent_upload_stats.uploaded_by_discord_id` but have no
  `characters.discord_id`. Actions in `web/app/me/claim-actions.ts` (Trader =
  one-click local link; Raid alt = the same `opendkp_register_requests` queue
  the officer surface uses; Not mine = `link_ignored`), all gated on
  "your agent uploaded it AND nobody else owns it". The level ladder + trader
  placeholders are `web/lib/characterRoles.ts` (pure, tested) and are shared
  with `/admin/links` — Trader there no longer demands a class.
- **Officer channel resolution (bot 3.1.67)** — `utils/officerChannel.js`:
  bot_kv `officer_channel_id` → `OFFICER_CHAT_CHANNEL_ID` →
  `OFFICER_ALERT_CHANNEL_ID`, null when unconfigured (callers must say so, not
  guess). `/preraid here:true` wires it from Discord with no env var and no
  redeploy — needed because the env var was never set on Railway and every
  officer post was silently skipping.
- **Officer pre-raid checklist + midday raid info (bot 3.1.66, 2026-08-21)** —
  `/preraid` (officer, auto at T-90m to officer chat): signups vs our own
  average, class shortages (ratio AND absolute-head test, sorted by heads
  missing), Mimic coverage counted in PLAYERS, lockouts on tonight's targets,
  and whether those targets are up. Pure builder + tests in
  `utils/preRaidChecklist.js`. `/raidinfo` (auto in the noon hour to the raid
  channel) is the member-facing half: re-surfaces the signup post's own header
  block (muster/lead/window/loot/ticks) via `utils/raidInfoPost.js` plus
  classes still wanted — no Mimic or lockout detail. Both dedupe per night in
  `bot_kv`.
- **`/ai` — published development methodology (web 1.1.92, 2026-08-23)** —
  public, un-gated, and written for three readers: a person, an agent with no
  repo access, and an agent with one. `web/lib/aiMethodology.ts` is the single
  source (rules + milestones + workflow stages + gates); `web/app/ai/page.tsx`
  renders it with a scrubbable milestone spine
  (`components/AiMethodology.tsx`, client) and a static workflow decision tree
  (`components/AiWorkflowTree.tsx`); `app/ai.json/` and `app/ai.txt/` serve the
  same data structured and as plain markdown, both CORS-open.
  ⚠ **Never write methodology prose into the renderings** — put it in the data
  module or the three views drift. `test/ai-methodology.test.js` asserts every
  cited doc exists and every quote still appears verbatim in it.
  ⚠ The data module is inside the read-discipline ratchet's scan roots, so
  describing an over-cap row limit in its own notation fails CI.
- **Lockouts derived from kill parses (bot 3.1.68, 2026-08-22)** — the second,
  and much higher-coverage, source for `character_lockouts`. A confirmed kill
  of a lockout-bearing raid boss IS a lockout observation, so
  `utils/killLockouts.js` + `_recordKillLockouts` (bot `index.js`) write rows
  straight off the encounter pipe. Participants come from FOUR places —
  uploader, `players`, `healers`, `defenders` — because a damage list alone
  misses a cleric (the case that prompted it: Taeya uploaded a Ventani kill and
  had no `encounter_players` row on it). Expiry = kill + boss timer, so a live
  `/sll` row always wins (`dropRowsShadowedBySll`); `source` on the row says
  which. PK is (guild, character, boss) — see `docs/DECISIONS-2026-08-21.md`
  2026-08-22 for why, and `scripts/backfill-kill-lockouts.sql` for the history
  walk (753 rows on first run).
- **Pre-raid lockout briefing (bot 3.1.65/3.1.68, 2026-08-21/22)** —
  `/lockoutcheck` (officer) and an automatic officer-chat post in the T-90m
  window before a raid night, deduped per night in `bot_kv`. Pure builder in
  `utils/lockoutBriefing.js`: tonight's targets (`loadTonightsTargets` off the
  RaidHelper event) × active `character_lockouts`, grouped by zone, mains
  first, plus the targets that are clear. Pre-pull by design — see the engage-
  lock note below.
  ⚠ **The verdict is `mainsBlocked`, not a headcount** (Hitya 2026-08-22: "as
  long as mains are good to go"). Three filters, all needed, all learned the
  hard way — they take 753 rows down to the six an officer acts on:
  (1) only UP targets count, because a lockout runs as long as the boss's
  respawn and after our own kill the whole raid is locked AND the boss is down
  (`onDownTargets` keeps the rest; an unknown boss state counts as UP so a
  missing timer can never hide a real block);
  (2) mains drive the ✅/⚠ and the checklist flag, alts ride along in
  `altsBlocked` — a blocked alt is a swap;
  (3) characters off the roster go to `outsiders`, counted and never listed,
  because a joint-raid parse carries the other guild's whole roster.
  Era scoping is the web's job (`currentEraNames` in `web/lib/eras.ts`) — the
  briefing is already scoped to the night's targets.
- **Raid lockouts, ours vs foreign (bot 3.1.64 + web 1.1.88/89, 2026-08-21)** —
  ⚠ an ENGAGE lock, not a loot lock: a locked character can't fight the mob and
  is teleported out of the zone on engage, so this is a pre-pull check (see
  CLAUDE.md domain policies).
  the `/sll` relay records a `character_lockouts` row per character/boss
  alongside its boss-timer work (`_handleAgentLockout`); since 2026-08-22 kill
  parses do too (entry above). `ours` is three-state: true = ours, false = it
  happened elsewhere, null = we cannot tell — never an accusation. The /sll
  path judges by a ±30min match against our board; the kill path by the
  encounter's `raid_nights` binding, falling back to the raid window.
  `/admin/lockouts` shows five bands (foreign / unknown / ours, all three
  scoped to `currentEraNames()` and sorted mains-first, then older content,
  then not-on-our-roster) and links each kill-derived row to the parse it came
  from.
  ⚠ **A raid night is not the only thing we run.** `ours` also comes out true
  when the majority of named players are on the roster — that is what tells an
  off-calendar GUILD event from somebody else's raid (Hitya 2026-08-22:
  "Friday was a guild rolling event, so internal, but still a lockout").
  Measured: our raids 0.75–0.89 roster share, pug raids 0.14–0.22. The 0.5 line
  is `GUILD_EVENT_MIN_MEMBER_FRAC`, kept identical to
  `REVIEW_FOREIGN_MAX_MEMBER_FRAC` in `web/lib/anomalies.ts`. Under 3 named
  players it returns null, never false. Distinct from `/admin/anomalies`, which keeps foreign RAIDS out
  of our parses — foreign LOCKOUTS are deliberately kept in, because they bind
  us on our own raid night.
- **Witnessed hails → PoP flags (agent 3.6.4, 2026-08-21)** — the authoritative
  grant line is a self-message, so non-Mimic raiders had no flag record.
  `parseWitnessedHail` captures `X says, 'Hail, <NPC>'` — the ONE exception to
  the say-chat drop (see `docs/PRIVACY.md` and the member-facing `/privacy`) —
  and uploads it as `source='hail_witnessed'`, evidence not proof. The NPC→flag
  decision is bot-side so the catalog grows data-only. Bot half + manual entry
  are still TODO (task #58); the NPC/phrase list needs
  `docs/HANDOFF-pop-quest-extract.md` run on the EQServer box.
- **Per-class spell levels (2026-08-25)** — a spell's level differs per class,
  and three places collapsed that to one number. `spell_level_seed.level` is
  the MINIMUM across classes (per-class truth lives in its text `note`);
  `character_missing_spells` additionally took a guild-wide `min(spell_level)`
  across every class's spellbook. Both fixed: `spell_class_levels` view
  (parsed from the note, health view `spell_class_levels_parse_ok`, guarded by
  `test/spell-class-levels.test.js` which extracts the regex from the shipped
  migration). Resolution order where a class is known: same-class observed
  spellbook level → `spell_class_levels` → seed minimum. ⚠ Any new consumer of
  `spell_level_seed.level` without a class join reintroduces this.
- **PoP spell turn-ins (web 1.1.86 → 1.1.96, 2026-08-20/25)** — v2 reads the
  ACTUAL trainer scripts: `pop_parchment_pools` view over the ProjectEQ
  turn-in mirror (`scripted_npc_turnins`), per (class, tier, scroll), trainer
  class DERIVED via bit_and over scroll class-bitmasks. The v1 level-tier
  inference in `web/lib/popSpells.ts` overcounted (necro "12" vs the quest's
  ~8 — Lacunanight, 2026-08-25) and is gone; a PoP spell outside the class's
  pools shows "not a turn-in". `pop_spell_needs` gained `tier` + `'Song: %'`
  support (bards were silently dropped). Known ±1 Quarm-fork divergence on
  necro Ethereal: migration 20260825030000 header. `pop_spell_needs(guild)` RPC drives the /pop section: each
  character × unscribed PoP spell, ordered by character level desc (first to
  the level gets first dibs), restricted to characters who submitted a
  spellbook. /pop also takes spellbook submissions, reusing the /me uploader +
  action.
  **v4 (web 1.1.97, bot-adjacent migration 20260826010000, Hitya: "we
  shouldn't only track mains")** — dropped the mains-only filter (`main_name
  IS NULL OR main_name = name`); the function now covers every eligible
  character (main + alt) and returns `is_main` per row so callers pick their
  own default. `/pop`'s guild-wide surfaces (chart, matrix, planner, spell
  table) filter to `is_main`/`?scope=all` client-side, defaulting to mains; a
  new `?view=mine` tab ignores scope entirely and shows the SIGNED-IN
  member's own characters (mains + alts, `ownedCharacters()`), same table
  shapes as Matrix + the spell-needs table, plus which of their characters
  have no spellbook on file (a check the guild-wide table can't make — it can
  only say "nothing missing OR nothing submitted" in aggregate).
  ⚠ **Widening from 28 mains to 117 characters exposed a real perf bug**,
  not caused by the widening itself: the per-character level lookup was a
  correlated subquery against `who_directory` (a view with six DISTINCT-ON
  passes over all of `who_observations`, no materialization) — Postgres
  can't push the character filter below those passes, so EVERY row of the
  candidate set re-ran the whole view (267k buffer hits each, measured).
  At 28 rows that was already ~7.5M buffer hits; at 117 it was ~31M and a
  reproducible 60s+ hang. Fixed by `LEFT JOIN who_directory wd ON
  wd.character_key = lower(c.name)` instead of a correlated `SELECT MAX(...)`
  — the view computes once, characters hash-join against it (1.2s measured).
  Guarded by `test/pop-spell-needs-all-characters.test.js`.
- **/parses raid split (web 1.1.85, 2026-08-20)** — the 🗡 rollup lines split
  into "During the raid" / "Outside the raid". A kill is the raid's when
  `encounters.raid_night_id` is set AND participation ≥ max(6, 25% of that
  night's peak) — the night tag alone is time-based and caught a solo wolf
  killed en route to Vex Thal. Rule + evidence in the rollup migration.
- **Shared-bank account grouping (web 1.1.84, 2026-08-20)** — the shared bank
  is account-level, so summing it per character over-counted every stack.
  `web/lib/sharedBank.ts` clusters characters into accounts by SLOT AGREEMENT
  (Jaccard over the union of their `SharedBank*-Slot*` → item maps), and
  `/me/inventory` counts only the freshest snapshot per account. Skew-tolerant
  by design — snapshots of one account drift because each character's file is
  written when that character last ran `/outputfile inventory`. Server rules it
  encodes: 8 characters per game account, ~10 game accounts per forum account
  (so owner ≠ account), and `#charactertransfer` moves characters between them,
  which is why grouping re-derives from fresh uploads instead of being curated.
  A cluster exceeding 8 is re-split at stricter thresholds. An earlier
  whole-bank-hash view (`shared_bank_groups`) was tried and dropped the same
  day; see `DECISIONS-2026-08-20.md`. The Quartermaster deliberately does NOT
  dedup (per-character reachability).
- **Inventory auto-upload (agent 3.5.94, beta, 2026-08-20)** —
  `scanInventoryUploads` in the agent watches `<Char>-Inventory.txt` beside
  its quarmy/spellbook siblings (same prefs gate, fingerprint + checksum
  dedup, 10-min cadence) and POSTs to the bot's `/api/agent/inventory`
  (existed since 2026-06-23, unused until now — the agent half was never
  built, so `character_inventory` was manual-/me-upload-only and froze at
  upload time). Coin/Currency/Held never leave the machine; bank item slots
  upload. Page copy: `web/app/character/[name]/inventory/page.tsx`.
- **Deferred /announce parse sessions (bot 3.1.62)** — announcing a future
  event parks `pending_parse_session` in `bot_kv`; the 5-min spawn checker
  opens it 30 min before start (`pendingSessionAction`,
  `commands/raidnight.js`). Announce opens immediately only when the event is
  ≤2h out. /adjusttime + /adjustdate move the pending start; cancel clears it.
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
- **Public OpenDKP counter (`/opendkp`, web 1.1.98 + bot 3.1.73)** — the only
  member-facing page with NO auth check, deliberately: it exists so OpenDKP's
  owner (not in our Discord) can verify our volume himself after the 2026-08-25
  incident, and a page behind our sign-in would be useless to him. Exposes only
  endpoint shapes, counts, bytes and halt state — no names, no DKP, no
  credentials. `opendkp_call_stats` is the single `anon`-readable table in the
  schema for the same reason. Endpoints are normalized in `utils/opendkp.js`
  `_normalizeEndpoint` to the shape HIS API Gateway log groups by
  (`/clients/{client}/auctions/{id}/bids`) so the two tables read across without
  translation. Counted at the same two primitives as the halt and the governor;
  aggregated in memory and flushed once per COMPLETED minute — a row per call
  would be the exact write amplification that caused the incident.
  ⚠ **Two halts now.** `OPENDKP_HALT` (env, needs a Railway redeploy) and
  `flag_opendkp_halt` in the `overlay_tuning` map (no deploy, lands within the
  60s cache via `_refreshOverlayTuningCache` → `setRuntimeHalt`). The second is
  the one promised to Moncs as "we can stop quickly" — a build is not quickly.
  Either halts; both must be clear to resume. Blocked calls are still COUNTED,
  so the page can tell "the kill switch works" from "the bot fell over".
  Tests: `test/opendkp-call-stats.test.js`.
- **OpenDKP reconcile (#110)** — `utils/openDkpSync.js` `reconcileRecentLoot`:
  upstream deletions propagate to the `opendkp_loot` mirror within a sync.
- **Guild rules (#94)** — `guild_rules` table + `/ingestrules`
  (`commands/ingestrules.js`, `utils/rulesParser.js`) + `/admin/rules`.
- **Roaming bid prefs (bot 3.1.77)** — `character_bid_prefs` +
  `server-panel?key=bid-prefs` (read) + `POST /api/agent/bid-prefs`
  (`_handleAgentBidPrefs`, `requireAgentAuth` REQUIRED — rows are keyed by
  character name, so an unauthenticated write overwrites anyone's planned
  bids). Makes the agent's local-only `logsync.plannedbids.json` /
  `lootdismiss.json` survive a reinstall or a desktop↔Deck move. Local file
  remains the LIVE source of truth; last-writer-wins on `updated_at`, NOT a
  merge. Design + the autobid safety rules: `docs/DESIGN-bid-assist.md`.
  Tests: `test/bid-prefs-roaming.test.js`.
- **Loot bidding serving (#108/#121)** — `server-panel` keys `opendkp-auth-config`
  / `item-history` / `bid-history`; `_lootItemSummary`/`_familyDkpTotals`.
  Since bot 3.1.72 (the Moncs incident) the `auctions`/`my-bids` keys read
  OpenDKP's `GET /clients/{name}/auctions/active` through ONE shared cache
  (`_panelAuctions`: 15s TTL live / 120s idle / stale-on-error; roster 1h via
  `_panelCharacters`) — N dashboards cost one upstream call, and the my-bids
  `getAuction()` N+1 is gone (Bids[] ride the active list inline).
  `opendkp-auth-config` returns 503 while `OPENDKP_HALT` is set, which starves
  the agents' DIRECT `/clients/{name}/dkp` standings calls fleet-wide (~2h:
  config cache + token life). Outbound governor at `_get`/`_post`:
  `OPENDKP_MAX_CALLS_PER_MIN` + 429/Retry-After cooldown
  (`test/opendkp-outbound-budget.test.js`, `test/server-panel-auction-cache.test.js`).
  ⚠ In `bid-history` the "already won" set (`wonItemIds`) is a SEPARATE uncapped
  `opendkp_loot` sweep — never seeded from the `wins` display array, which is
  `limit=100`. Seeding from `wins` left 87 of one family's 187 awards looking
  unwon, so they resurfaced as wishlist + RECENT MISSES rows (bot 3.1.33).
  `wins` orders by `raid_id.desc` (award order); `fetched_at` is MIRROR SYNC
  time and is never an ordering key. Pinned by `test/loot-won-set.test.js`.
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
- **Roll-call item labels** — `parseRollItemLine` (pure, exported) reads
  `<Item> <range>` out of a chat line and feeds `_rollItemByNumber`, which
  `trackRollLine` reads when a set's first roll lands (bounded by
  `ROLL_ITEM_LINK_MS`, 20 min — the map is keyed by NUMBER, so an unbounded
  read lets an 8pm label claim an 11pm 0-333 set). **Separator-agnostic since
  agent 3.5.84**: it walks the numbers rather than splitting on `|`, so commas,
  tier lists (`311 pick, 322 upgrade` = one item) and bare `Atramentous Shield
  333` all work. The guards in `_cleanRollItemCandidate` (Title Case, a ≥4-letter
  word, majority-capitalised significant words, no ALL-CAPS raid shorthand,
  3-4 digit range not followed by a letter or `%`) are what stop ordinary chat
  becoming an item name — each was added because a REAL captured line beat the
  previous rule. `test/roll-item-line.test.js` carries every one of them.
- **Loot announce (#107)** — `noteLootAuction` → TTS + auction countdown chips.
- **Timeline enrichment (#105)** — `noteSlowLanding` (SLOW_SPELLS), `noteMobHeal`,
  `DISC_LINES`/`_matchDiscLine` → `timeline_events`.
- **Loot bidding panel (#108/#121)** — dashboard WEB_HTML card, OpenDKP Cognito
  login (`logsync.opendkp.json`), alt-family (`logsync.bidfamily.json`),
  per-item planned bids (`logsync.plannedbids.json`), per-item dismissals
  (`logsync.lootdismiss.json` + `POST /api/loot/dismiss`, agent 3.5.53).
  The family is auto-populated from OpenDKP's `suggested_family` (additive —
  a hand-typed name is never removed; `⟲ from OpenDKP` is the replace path),
  and `famDirty` gates the 7s `fetchConfig` poll so it can't overwrite an open
  editor. Loot history is collapsed behind `showLoot` by default (privacy —
  the dashboard gets screen-shared); the expansion filter one-shots onto the
  current expansion via `currentEra()`, falling back to "all" if that would
  render an empty list.
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
- **PBAOE song mob counter (3.4.40; pulse clock + kite totals 3.5.88)** —
  `noteSongAoeLine` (watch-loop hook, display-only) counts AE landing rows
  per song per pulse, scoped to the melody order's catalog `cast_on_other`
  suffixes (detrimental only — a beneficial song's landing names
  groupmates); damage joins from "has taken N damage from your <song>"
  lines. Pulse bursts are bounded by the LINE's log timestamp
  (`SONG_AOE_PULSE_GAP_MS`), never wall-clock arrival — the EQ client
  flushes the log in multi-second batches under swarm load, which merged
  pulses into ⚔123/12 badges (Fittir, 2026-08-19; `test/song-aoe-pulse.test.js`).
  Surfaced per order row as `aoe_hits`/`aoe_dmg`/`aoe_kite` (running
  damage total for the current kite, reset after 30s quiet); `melody.html`
  renders an ⚔ hits/12 chip beside the song name (12 = Quarm AE cap,
  green at a full swarm) plus per-hit damage + Σ kite total — toggleable
  via tray "Show AE song damage" (`cfg.melodyDmgTotals`, default ON).
  Badge goes stale-silent 30s after the last pulse.

### Crash review (agent, beta)
- **🩺 Crash review card + `/api/crash-review` (agent 3.5.67)** — reads this
  machine's own Zeal crash zips and says, in plain language, what broke. The
  headline answer is *"was this Zeal/Mimic?"*, because that is what people ask
  when EQ vanishes. `_readMinidump` parses `minidump.dmp` with zero deps and no
  symbol server (module base addresses resolve any address to `module+offset`);
  `_crashVerdict` turns that into a subsystem, notes and concrete checks —
  including the exact `reg query` for the audio device that failed. Dashboard
  card is **on-demand only** (a button, never the 2s poll) and is NOT gated on
  `WOLFPACK_CRASH_REPORTS`: that flag governs UPLOADING to the guild, and
  reading your own crash should not require sharing it.
  ⚠ Dumps never leave the machine. Same logic in Python for officers:
  `scripts/read-minidump.py`. Worked example + limits:
  `docs/DESIGN-crash-review.md` §8. Tests: `test/minidump-review.test.js`
  (synthetic dumps built byte-by-byte; they pin two struct offsets and the
  utf16 alignment bug that silently dropped every audio endpoint).
- **Automatic backfill for existing uploaders (agent 3.5.68 · bot 3.1.40)** —
  anyone who already had crash sharing on has a pile of rows that are just an
  address, because they were uploaded before we could read dumps. The agent
  re-sends those bundles once with the analysis attached (8 per 60s sweep; the
  bot upserts on `zip_name`, so rows update in place rather than duplicating).
  ⚠ The watermark (`crash-reports.state.json` → `analyzed`) advances **only**
  when the bot echoes `analysis_version` >= the agent's `CRASH_ANALYSIS_VERSION`
  — otherwise an older bot would drop the fields and the agent would mark the
  history done anyway, burning the one chance to backfill it. Against an old
  bot the agent pauses re-analysis and re-probes hourly, so a bot deploy resumes
  it with nobody restarting anything. **`CRASH_ANALYSIS_VERSION` (agent) and
  `CRASH_ANALYSIS_VERSION_SUPPORTED` (bot) are one contract — bump both.**
  Tests: `test/crash-reanalysis-watermark.test.js`.

### Mimic (`apps/mimic/`, beta)
- **Injected chrome is dashboard-only (mimic, 2026-08-13)** — `preload.js` adds a
  ⚙ (and a ✕ on panel windows) to pages loaded over `http:`. That was a safe
  proxy for "this is the dashboard" until #65 started serving real overlays from
  the agent at `/overlay/<name>` so they ride hot-swaps; the Command Center then
  showed a gear that opened Mimic **Settings** from inside a raid overlay, and
  because `/overlay/command` carries no `?overlay=` query it was misdetected as
  the main window. Now guarded by `_isAgentServedOverlay`
  (`location.pathname.startsWith('/overlay/')`). ⚠ The `?overlay=` PANEL windows
  still need the injection — they are the dashboard in a small frameless window
  with no chrome of its own. Any overlay with its own parity chrome (✥ / ✕ /
  right-click) must NOT get injected chrome on top.
  Tests: `test/preload-overlay-chrome.test.js`.
- **Me card + officer Admin tab (#109)** — dashboard opens on 🐺 Me; officer
  tools + 📡 Reporters panel (#115, swap/include) + 🛑 kill switches (#118) under
  🛡 Admin. LKG crash-loop rollback + beta-channel hot-swap in `main.js` (#74).
- **Dashboard sidebar + tab split (agent 3.5.72)** — the tab strip became a
  left rail (`.shell` flex row: sticky `.nav` beside `.panes`; collapses back to
  a wrapping strip under 700px), and the two overgrown tabs were carved up.
  **📊 Stats** (`renderStats`) took the session-observation cards off Info —
  mending, top abilities, spell casts, resists, rolls, inbound spell damage,
  loadouts + pets. **🩺 Diagnostics** (`renderDiag`) took the "is it working"
  cards off Triggers and Info — Zeal pipe, charm + pet-buff diagnostics, trigger
  journal, boss mechanics, Zeal explorer, raw Zeal capture. Info keeps parser
  facts, client versions, log archiving, tag-capture readiness, backups, GINA
  scan and the crash card; Triggers keeps recent fires, replay and the three
  trigger lists. Tour gained a stop for each. Nothing moved between render
  fns except the markup itself — every card's own filler is unchanged.
  Tests: `test/dashboard-tabs.test.js` (nav ↔ pane ↔ `_sections` ↔ placeholder
  ownership, plus filler-runs-after-emitter ordering).
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
- **Roll nights (#91)** — `/rolls` (`web/lib/rolls.ts`). The item NAME is
  captured by the agent from the roll call in chat (`parseRollItemLine`) — and
  it is load-bearing far beyond the label, because `attributeLoot()` returns
  early on a null item, so an unnamed session also shows an empty **LOOTED BY**.
  Officer corrections go in `roll_set_overrides` (never onto `roll_sets`, which
  agents upsert) and are applied BEFORE loot attribution, so typing a name in
  fills the looter column too. **Who else rolled** is a `<details>` in the
  Won-by cell built from `rollBreakdown()` — kept pure and shared in shape with
  the Command Center because two calls are easy to get wrong in JSX: a re-roll
  is kept and FLAGGED (dropping it makes the list disagree with the roller
  count), and a winner is matched on name AND value once (name alone lights up
  that player's losing re-roll too). A native disclosure, so the page stays a
  server component and the expansion works with JS off.
- **Quartermaster (#82)** — `/quartermaster` (`web/lib/quartermaster.ts`):
  utility-kit coverage + quest checklist (reuses the `quest_catalog` store).
  ⚠ **Owner NAMES are officer-only** (Hitya, 2026-08-14: *"quartermaster should
  display raider information for that user not for everyone. it can display for
  everyone for admins"*). Board 1 originally named every owner of every kit item
  to every signed-in member. Coverage is still computed guild-wide, then
  **`scopeKitCoverage(coverage, ownNamesLower, officer)`** decides who may be
  named: officer → the whole list; member → their own characters only. The
  guild-wide `ownerCount` survives both ways **on purpose** — it is a nameless
  aggregate (the ANON tier), and without it a member cannot tell a real coverage
  gap from their own blind spot. Board 2 was already scoped this way (own
  characters up top, officer rollup gated).
- **Raid Kit (#95)** — `web/lib/raidKit.ts`, `/admin/readiness`, gear-page card.
- **Comp matcher (#93)** — `web/lib/comp.ts`, `comp_templates`, `/admin/comp`,
  signups gap panel.
- **Attendance metrics (#92)** — `member_attendance_metrics` view + `/admin/attendance`.
- **Raid-Helper signup archive** — `utils/raidhelperApi.js` mirrors the Raid-Helper
  board into `rh_events` + `rh_signups` every 30 min (`startRaidHelperSync` in
  `index.js`), upsert-only, feeding `/admin/signups`. **This is the guild's only
  record of DECLARED intent**, and the distinction matters: `opendkp_ticks` says who
  turned up, `rh_signups` says what they said they would do. Statuses are the class
  name (accepted), plus `absence`, `tentative`, `late` and `bench`.
  ⚠ **Raid-Helper's own board only retains its contents until the day of the raid**
  (Hitya, 2026-08-13) — so the mirror is not a convenience copy, it is the archive.
  Anything a sync outage misses is gone permanently rather than late. 292 events /
  14,741 signups back to 2024-08-08 as of 2026-08-13, no gaps against the DKP raid
  list. Nothing monitors the sync yet; a silent failure is indistinguishable from a
  quiet signup board.
  Worked example of what it answers that ticks cannot: Peopleslayer marked **19 of 19
  Wednesdays tentative** while signing in on 18/19 Sundays and 19/19 Thursdays — a
  standing weekly constraint that attendance counts alone can only infer.
- **Per-fight timeline (#98)** — `encounter_events` → **`FightEventLog.tsx`** on
  `/parses/[id]` since web 1.1.60 (collapsible LIST of deaths, slows, mob heals,
  discs, fires — names + times, repeats folded ×N; Hitya 2026-08-16: the marker
  view was "useless in this format"). The marker chart `FightTimeline.tsx`
  survives on `/raid/review` where wipe-spotting is the job. Replay-this-fight
  link unchanged.
- **Damage-over-the-fight chart** — `DamageCurve.tsx` + `lib/fightCurve.ts` on
  `/parses/[id]`: stacked BY CLASS with right-edge `class + %` labels, click a
  class to drill into its characters (one-axis premise holds in both views),
  hover highlights, MT strip with honest "nobody taking hits" gap tooltips
  (1-bucket sampling holes bridged; real gaps kept — the Moash "it ran" case).
- **Sprint board on `/roadmap`** — `SprintBoard.tsx` + `sprintItems` in
  `roadmapData.ts` (sortable, platform-color aspects).
- **Missing-spells "where from" + shopping list** (web 1.1.67):
  `/character/[name]/spells` — per-spell vendor/dropper dropdowns from OUR
  mirror (`spell_scroll_sources` RPC over merchantlist + npc_drops +
  spawn-table zones; npc_types.merchant_id mirrored since 2026-08-18), zone
  shopping mode with only-here badges. `MissingSpellsView.tsx` +
  `lib/spellSources.ts`.
- **Adoption metrics — `/admin/adoption`** (web 1.1.66): product health in
  PLAYERS — WAU, activations (new-raider vs converted split on joined_at),
  4-week retention, raid-window-only corroboration, fleet version, and the
  raided-never-uploaded conversion list. `web/lib/adoption.ts` +
  `adoption_uploader_days`/`encounter_upload_counts` views.
- **Fight Cards (#43) — `/raid/plan`** (web 1.1.61): per-fight pre-raid
  readiness cards from the `fight_cards` table; officer-authored inline;
  callouts resolved LIVE against `guild_triggers` by id (✓ armed / ○ denoted /
  ⚠ MISSING) via `web/lib/fightCards.ts`. Linked from the /guide index.
  Design + v1 scope: `docs/DESIGN-fight-cards.md`.

### Designs written, build pending (read before touching)
- **Multi-raid awareness (#114)** — `docs/DESIGN-multi-raid.md` (leader-anchored
  identity; single-raid path is sacred).
- **Same-name mob serial tracks (#56)** — the serialization design in
  `docs/DESIGN-dedup-and-mob-serialization.md` (separator-only, K-invariant,
  rampage/riposte correction).
