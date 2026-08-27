# STATUS — the one place to see where everything stands

*Consolidated 2026-07-17 (EST). This replaces the tangle of overlapping queue
docs (BACKLOG, CONTINUATION_QUEUE, the platform-queue, the old roadmaps). If you
want to know **what's done, what's still TODO, what we abandoned, and what was
folly** — it's here.*

## How to read this (three layers, no more)

1. **Live working queue** — the durable, ordered plan is
   [`DESIGN-platform-queue.md`](./DESIGN-platform-queue.md) (the post-audit
   waves + agreed execution order). The fine-grained active checklist is the
   session **task board** (#1-96), which mirrors whatever wave is in flight.
2. **This doc (`STATUS.md`)** — the durable big-picture ledger + the map of
   every doc in `docs/`. Point new sessions here first.
3. **`archive/`** — retired docs, kept verbatim (nothing deleted). Everything
   they held that's still live has been lifted into the ledger below.

> **Rule for future sessions:** don't start a new queue file. Open TODOs go on
> the task board and, if durable, into the ledger here. Deep designs get their
> own `DESIGN-*.md` and a row in the Document Map.
>
> **Decisions are a fourth thing and they go somewhere else** (2026-08-08): a
> call, a default, a threshold, a "we don't do that" is appended to
> **`docs/DECISIONS-<YYYY-MM-DD>.md`** the same session. That file's
> "Open — read this first" table is what `.claude/hooks/session-digest.sh`
> prints at SessionStart, so it is the first thing the next session reads;
> anything that outlives the week also lands here and in `CLAUDE.md`.

---

## Document map — what every file in `docs/` is for

### Living reference (keep — actively relied on)
| File | What it is | Why it stays |
|---|---|---|
| `DESIGN-platform-queue.md` | The post-audit wave plan + agreed execution order | **The live queue.** |
| `RUNBOOK-site-access.md` | Officer procedure: getting a member in when Discord sign-in won't work — site invite + Mimic code, reset-via-reinvite, troubleshooting | **The no-Discord door.** First live use 2026-08-25 |
| `BETA-TESTING.md` | Test plan for features in the beta channel (versions + ✅ solo / 👥 multi-person cases) | **Where to verify beta work.** |
| `DESIGN-buff-debuff-queue.md` | Design spec for the raid buff/debuff/cure queue overlay | CLAUDE.md roadmap ref; feature is live but spec still guides changes |
| `DESIGN-ch-chain.md` | Design spec for the CH-rotation overlay | CLAUDE.md roadmap ref |
| `DESIGN-87-officer-console.md` | #87 officer runbooks + console: the runbook set (RB-01…RB-12, each grounded in a dated incident), the health-signal set, button safety classes, and the anti-rot mechanism | Phase 1 shipped (`/admin/console`); §7.2 bot-side levers still proposed |
| `DESIGN-quarmy-gear.md` | Build spec for Quarmy gear/AA/spell import to character pages | Unbuilt — still the spec |
| `DESIGN-external-tenancy.md` | Letting OTHER guilds use Mimic + the platform: self-host vs tenant-on-our-Supabase vs hybrid, the honest self-host cost, the **PvP `/who` carve-out** and how it's enforced, the Mimic-points-elsewhere angle, a staged plan, and the open business questions | Unbuilt — design only (2026-08-02). Read before any tenancy/self-host/`guild_id` work. Stage 0 (publish the `eqemu_*` catalog) + Stage 1 (split PvP data to its own project) are worth doing on their own merits |
| `DESIGN-onboarding-overhaul.md` | "New Here?" walkthrough on web (`/start`) + Discord, shared screenshot set, auto-checkoff from existing signals | Unbuilt — the spec (2026-07-31); also documents the live `/onboarding` embed-overflow break |
| `mimic-1.4-roadmap.md` | **Active Mimic beta queue** (overlay layout sync, UI-Studio UX, trigger onboarding) | Real open work; see ledger |
| `raid-hub-roadmap.md` | `/raid` hub design; Stages 1-2 shipped, Stages 3-5 open | CLAUDE.md roadmap ref; open TODOs in ledger |
| `beta-releases.md` | Beta-channel mechanics (electron-updater, cutting beta/stable) | Evergreen process reference (dated "current state" block is stale, harmless) |
| `DESIGN-75-golden-log.md` | [#75] The agent-parser golden-log regression net + the pre-raid drill: what the fixtures contain, why the expectations are shaped the way they are, and the six parser defects the golden PINS | Shipped 2026-08-02; read before changing `parseEvent`/`EncounterBuilder` or regenerating the golden |
| `HOW-ITS-BUILT.md` | Long-form "how each feature actually works" companion to CLAUDE.md | Living companion doc |
| `MIMIC.md` / `MIMIC_AGENT.md` | Mimic vision + the Electron/self-updating-agent rearchitecture assessment | CLAUDE.md roadmap refs |
| `PRIVACY.md` | Source-of-truth privacy statement, mirrored to the web page | Load-bearing (CLAUDE.md) |
| `eqemu-catalog-cheatsheet.md` | Load-bearing conventions for the `eqemu_*` mirror + gear/spells pages | Load-bearing (CLAUDE.md) |
| `zeal-pipe-protocol.md` | Full field reference for the Zeal named-pipe protocol | Load-bearing spec |
| `zeal-spawn-id-request.md` | Drafted upstream ask to Zeal for `spawn_id` on the gauges | Load-bearing (CLAUDE.md); the fix for same-name mob ambiguity |
| `code-signing.md` | Pre-staged (OFF) Windows signing pipeline + flip-on checklist | CLAUDE.md (CLOSED 2026-07-14, kept for if a provider appears) |
| `opendkp-capture-playbook.md` | OpenDKP endpoint-capture playbook | CLAUDE.md ref; reusable for future captures |
| `eq-legends-formats.md` | EQ Legends client config-format spec | Future-build spec |
| `bazaar-filter-pack.md` | Bazaar search presets + tradable watchlists (Luclin) | Standalone reference |
| `pop-raids-local.md` | Local-session playbook: capture PoTime slideshow stubs | Actionable pending local task |
| `spell-levels-local.md` | Local-session playbook: fill `spell_level_seed` via PQDI scrape | Actionable; seed still used |
| `pvp-capture-audit.md` | Reusable local runbook for PvP kill/assist recovery (`scripts/pvp-audit.js`) | Diagnostic runbook |
| `DECISIONS-2026-08-07.md` | **The decision record** for the 2026-08-07→09 sessions: storage/threat, attendance, release process, Zeal `/tag`, loot bidding, the `{s}` P1, the beta re-sync — each as *the call · why · where it landed*, with an "Open — read this first" table at the bottom | Read FIRST via the SessionStart digest; newest `DECISIONS-*.md` wins |
| `DECISIONS-2026-08-13.md` | Dashboard navigation: the sidebar + the tab split, why the split carves by the QUESTION a card answers rather than by card count, and what deliberately stayed put (crash card on Info, the whole Dashboard tab) | Current — carries the live "Open — read this first" table |
| `DESIGN-fight-timeline.md` | Fight timeline v2 — boss HP curve + MT/RAMP swimlanes + class/player highlighting; the data audit, the two paid-for correctness traps, and the two-tier storage model | Data layer BUILT 2026-08-09; chart unbuilt. ⚠ its 2026-08-06 "CORRECTION" block is WRONG and is flagged in-place |
| `zeal-tag-spawn-id-collision.md` | Measured upstream bug report: why `/tag` spawn ids collide across zones, quantified, with N=5+ same-name evidence | Drafted, NOT sent (with `zeal-spawn-id-request.md`) |

⚠ **The map is behind the folder** (2026-08-09): 15 entries under `docs/` have no
row here — `AI-CONTRIBUTOR-BRIEF.md`, `RESEARCH-HELPER.md`,
`HANDOFF-2026-07-20-opus.md`, `audit-mob-specials.md`, `DESIGN-80-raid-night-review.md`,
`-81-raid-guide`, `-dedup-and-mob-serialization`, `-intentional-deaths`,
`-live-raid-review`, `-mob-serialization`, `-multi-raid`, `-outcome-backfill`,
`-wpqdi`, plus `pq-companion/` and `release-cards/`. Most are real
and current; they were simply written faster than this table. Add a row when you
next touch one rather than assuming a missing row means a missing doc.

### Archived 2026-07-17 → `archive/` (superseded; live bits lifted into the ledger)
| File | Was | Why archived |
|---|---|---|
| `roadmap.md` | Point-in-time platform retrospective/roadmap | Superseded by this doc + platform-queue; its few live TODOs migrated below |
| `trigger-system-roadmap.md` | Trigger-system design/research history | Foundation shipped; straggler TODOs + the event-engine idea migrated below |
| `EFFICIENCY-REVIEW-2026-07-07.md` | One-time efficiency audit | Most fixes shipped; the ⏳ web/Mimic items migrated below |
| `TIME-WINDOWS.md` | 2026-07-08 hardcoded-timeframe audit | Shared window infra shipped; telemetry query preserved below |
| `mimic-recruitment-copy.md` | One-time Discord recruitment copy | Served its purpose |
| `BACKLOG.md` | The old catch-all queue (~70% shipped history + local-session asks) | Unique live TODOs + "needs local session" asks lifted below; full file retained in `archive/` |
| `CONTINUATION_QUEUE.md` | Older session queue, heavily overlapping BACKLOG | ~70% shipped/duplicated; its 6 unique TODOs lifted below |

---

## The work ledger

- **⚠ Needs a local session — PoP quest extract (`docs/HANDOFF-pop-quest-extract.md`).**
  Two shipped features are waiting on data only the `D:\EQServer` box has:
  (1) the flagging-NPC list + the phrase list for phrase-granted flags — agent
  3.6.4 already captures witnessed hails, but the bot can only map three NPCs
  today, so everything else lands `unmapped`; (2) a second class's spell
  turn-in script, to confirm or break the inferred tier rule (Ethereal 61-62 /
  Spectral 63-64 / Glyphed 65, derived from the cleric script alone). The
  runbook has the exact searches and the JSON shape to commit back.

### ✅ Done — major shipped features (not exhaustive; see git + roadmapData.ts)

- **/tag channel autojoin — merge logic (agent, 2026-08-26).** Hitya: *"we need
  to add this channel to people's autojoins if they don't have them in their ini
  file."* `_mergeAutojoin()` merges the guild tag channel into a character's
  existing autojoin list: appends without disturbing other channels, idempotent,
  **corrects a right-name/no-password join** (the nasty case — looks joined,
  silently sends and receives nothing), collapses duplicates, case-insensitive.
  ⚠ **The channel PASSWORD is deliberately not in source or docs** — shared
  guild secret; name in source, password from config at runtime.
  `test/tag-channel-autojoin.test.js` (13) asserts source stays clean, and
  caught a first-draft comment quoting it verbatim.
  ⚠ **NOT YET WIRED TO A FILE.** Autojoin is per-character
  (`<Char>_pq.proj.ini`) and the exact section/key is unconfirmed — writing the
  wrong key is a silent no-op that looks like success. **Needs one line from a
  real character ini** before the file-write half lands.
- **Faction attribution — specified, not built.** `docs/DESIGN-faction-attribution.md`.
  Data availability VERIFIED: `eqemu_npc_faction_entries` carries the actual
  values, so exact attribution is possible for known npc_ids; the inference tier
  (fingerprint the observed hit combination, report a RANGE across candidate
  mobs) is designed but unbuilt.

- **Bid assist — roaming planned bids (bot 3.1.77, 2026-08-26).** ⚠ **This
  feature was described in an earlier session and NEVER WRITTEN DOWN** — Hitya:
  *"the local mimic bidding piece I described and queued up with you
  disappeared."* It had: nothing in STATUS, the platform queue, any DECISIONS
  file, or git history on any branch. The spec now lives in
  **`docs/DESIGN-bid-assist.md`** and that file is the record.
  Shipped: `character_bid_prefs` (migration `20260826160000`, applied +
  committed) + `GET server-panel?key=bid-prefs` + authed
  `POST /api/agent/bid-prefs`, so `logsync.plannedbids.json` /
  `lootdismiss.json` stop dying on reinstall or a move between desktop and Deck.
  Local file stays the LIVE source of truth; last-writer-wins on `updated_at`,
  deliberately not a merge (a stale Deck must not resurrect a bid the desktop
  just cleared).
  **Autobid's gate is ANSWERED and built** — Hitya, in two passes: *"you have to
  be in the raid for it to fire"*, then *"one of your characters needs to be in
  the raid currently or have been on a tick so far that night"*.
  `_familyInRaidTonight()` passes if ANY family member (root = `main_name ||
  name`) is in a fresh `raid_roster` snapshot **or** named on an
  `opendkp_ticks.attendees` for a raid since tonight's **6pm ET** boundary (not
  calendar day — raids run past midnight). **Fails closed** — an INVERSION of
  the agent's `require_raid_member`, which falls open on an empty roster.
  Enforced on the bot, not the agent. ⚠ The tick path means a Deck user with no
  Zeal still qualifies once they are on a tick, which the roster-only v1 would
  have refused. 15 cases, mutation-checked.
  **Still TODO (in order):** (2) won-vs-LOST ledger with what they bid —
  `bid-history` returns wins only today, losses are already in
  `opendkp_auction_bids`; (3) the auto-bid tickbox + ceiling + clear-on-win,
  wired to the gate above.

- **PoP page: My Characters tab + mains-default scope (web 1.1.97, 2026-08-26,
  Hitya: "due to the nature of pop flagging they may do it for many of their
  toons and we shouldn't only track mains").** `pop_spell_needs` v4 (migration
  `20260826010000`) drops the mains-only filter and returns `is_main` per row;
  guild-wide surfaces (chart/matrix/planner/spell-needs) default to
  `?scope=mains` with a toggle to `all`; a new `?view=mine` tab always shows
  the signed-in member's full roster (main+alt, `ownedCharacters()`) — zone
  access + spell needs side by side, plus which owned characters have no
  spellbook on file (a per-character check the aggregate guild table can't
  make). ⚠ Widening 28→117 eligible characters exposed a real perf bug (not
  caused by the widening): a per-row correlated subquery against
  `who_directory` (6 unmaterialized DISTINCT-ON passes over 120k+ rows) made
  every candidate re-run the whole view — 60s+ hangs, confirmed on prod.
  Fixed with a plain `LEFT JOIN who_directory` (1.2s verified, same output).
  `test/pop-spell-needs-all-characters.test.js` guards both fixes. Full story:
  `DECISIONS-2026-08-26.md`.

- **Adjustments: the decay is AUTOMATED, and our cadence already catches it
  (measured + corrected 2026-08-27).** Hitya: *"all of this dkp work was
  happening manually beforehand and the decay happens automatically based on
  settings that we've deployed in open dkp."* Confirmed in the data: **165 of
  the 168 inactivity-decay rows landed at exactly 12:00 UTC across 62 days** — a
  scheduled job. The only three at other times are from 2024, the manual era.
  **12:00 UTC is a 3h block boundary**, so the first 30-min tick after the job
  syncs it: decay reaches the mirror in ~30 min, not 3h, with no human in the
  loop. ⚠ That alignment is luck — changing `OPENDKP_OFFRAID_SYNC_HOURS` to
  something that does not divide 12:00 UTC evenly would cost a full block.
  ⚠ **Three earlier readings of this table were WRONG** and are written up in
  `DESIGN-agent-third-party-calls.md` §4a so nobody rebuilds on them: "a Friday
  burst of officer housekeeping" (a day-of-week rollup flattening a recurring
  daily job into a fake spike); "an officer doing a purge should run
  `/syncopendkp`" (no officer exists in that loop); and "only 2.7% happen during
  raid hours" (true but worthless — a job pinned to 08:00 ET can never land in a
  raid window). The genuinely human adjustments — a pass because someone is
  locked out, a ceded item, a missed tick — are real, small (78 rows at ±20 or
  less) and not time-critical.

- **API proposal to OpenDKP: an incremental audit feed (designed 2026-08-27,
  NOT SENT).** `docs/DESIGN-opendkp-audit-cursor.md` + artifact. The finding:
  **OpenDKP already has the change feed we need — it is the audit log** (Action
  taxonomy verified against our 48,055-row mirror: Auction Created/Closed/
  Updated/Restored/Deleted, Bid Update/Delete, Raid Created/Updated, Character
  Created/Updated, Adjustment Created). **What is missing is the entity id** — a
  row says an auction closed, never which one, so the only way to find out is to
  download the 665 KB auction list and diff.
  Ask is two fields on ONE existing endpoint: `?since=<AuditId>` and the
  affected row's id. No new endpoints — `/auctions/{id}` and `/raids/{id}`
  already exist and we already call them. **The whole guild generates 63 audit
  events a day (163 busiest); we download 116 MB/day to find them.** Projected
  ~1.5 MB/day AND fewer requests — cheaper on both axes API Gateway bills, which
  the earlier "more calls, 2,300× less data" ask was not.
  Supersedes the earlier per-endpoint `?since` request.

- **`/opendkp` gained a raid view and finer resolution (web 1.2.4, migration
  `20260827233000`, 2026-08-27).** Hitya, 25 min before the Thursday pull:
  *"we're probably about to spike, right? give me more notches on that graph,
  and a breakdown view of the calls during this raid."*
  `opendkp_traffic_summary()` now also returns **`fine`** (10-min buckets over
  6h — an hourly bar only shows a spike once it is over) and **`raid`**
  (the current-or-most-recent Sun/Wed/Thu 19:00→01:00 ET window: totals,
  per-endpoint, 15-min series, `in_progress`). The 48h axis gained ET clock
  labels at 5 points instead of three vague ones.
  The raid window matches `_inRaidWindowEt`, i.e. the gate that changes our
  behaviour, not the 20:00 pull time. Raid rows are read from the base table
  rather than the 48h CTE — the most recent raid can be older than 48h in a
  non-raid week.
  **First live confirmation of the raids-only DKP check:** `/clients/{client}/dkp`
  appeared for the first time at 19:00 ET, 2 calls / 204 KB, and is absent from
  every off-raid hour.

- **⚠ `/opendkp` was under-reporting by ~36%, in our favour (web 1.2.3,
  migration `20260827220000`, 2026-08-27).** Hitya: *"haven't seen any opendkp
  calls on here for a while."* Not a quiet bot — a **broken page**. It selected
  raw rows with `.order('minute', { ascending: true }).limit(1000)`: ascending
  WITH a limit, so it kept the OLDEST 1000 rows of the 48h window and silently
  dropped everything newer. At 1,440 rows in the window the newest 440 were
  gone, starting with the most recent hour. Page said **0 calls last hour /
  1,330 per 24h / 91.3 MB**; truth was **49 / 2,074 / 115.9 MB**.
  ⚠ **This is the page we pointed OpenDKP's operator at so he would not have to
  take our word for our traffic, and it was flattering us.** Wrong in that
  direction is worse than being down.
  Fixed by aggregating in Postgres — `opendkp_traffic_summary()` RPC, anon-
  executable like the table — so there is no row limit to outgrow; raising the
  limit would only have moved the cliff. Hour buckets are gap-filled, Cognito is
  split out, and a failed read now renders **UNAVAILABLE** rather than zeros
  (zeros are a claim that we sent nothing).
  ⚠ Also closes the older open item: the page now states that it counts
  server-side traffic and that the desktop app no longer calls OpenDKP at all.

- **Off-raid mirror-sync backoff + the stranded beta line (bot 3.1.89 · beta
  agent 3.6.5 / Mimic park 2.6.3 · 2026-08-27).** Hitya: *"cut down the number
  of calls as much as possible outside of raid times."* With the agent's direct
  calls gone, the 30-min mirror sync was the bulk of our OpenDKP traffic
  (12h: `/auctions` 26 calls/11.9 MB, `/characters` 65/8.9 MB, `/raids/{id}`
  245/1.5 MB). Now full cadence in the raid window (widened to 6pm ET so the
  board is current when the pull starts), **once every 3 hours otherwise**
  (`OPENDKP_OFFRAID_SYNC_HOURS`) — ~6× fewer off-raid passes.
  ⚠ Anchored to wall-clock BLOCKS, not elapsed time: with a relative test either
  every deploy forces a sync (the audits redeploy amplification) or a bot
  restarting faster than the interval never syncs at all, silently.
  ⚠ `/syncopendkp` passes `force: true` — caught pre-ship that the officer
  command would otherwise have been silently swallowed off-raid.
  ⚠ **No boot pull as of bot 3.1.90** (Hitya: *"take the opendkp pull out of
  main redeploy"*) — the 45s post-start sync was a per-deploy fetch of data the
  replaced process had just mirrored. The interval is the only trigger; after a
  deploy the mirror waits one pass. A bids-only boot pass was considered and
  rejected: bids ride `/auctions` at ~680 KB, our most expensive call, so
  waiting is cheaper than refreshing. Live bidding is unaffected — the panel
  reads `/auctions/active` on demand, not the mirror.
  **Beta was stranded:** agent 3.6.4 (Aug 21) sorts ABOVE stable 3.6.2, so 2
  players could never be offered the fix, and `sync-beta` pushes with
  `GITHUB_TOKEN` which by design triggers no build. Re-parked Mimic 2.6.2 →
  **2.6.3** (the sync had left it EQUAL to stable, the documented trap where
  `v2.6.2-beta.N` sorts below `v2.6.2` and the beta channel goes silent) and
  bumped the agent to 3.6.5 to cut a build.
  **Fleet at the time: 4 of 28 players on the fix**, 20 on agent 3.6.0.
  ⚠ There is NO auto-update opt-out in Mimic — the only toggles are the update
  pop-up, the beta channel and a stable pin — so lag is un-restarted clients,
  not opt-outs. The agent hot-swaps independently of the Mimic shell (one player
  on Mimic 2.1.0 was already running agent 3.6.2), which is the fast path.

- **The agent no longer talks to OpenDKP at all — and the blindspot that hid it
  (agent 3.6.2 · bot 3.1.87 · Mimic 2.6.2 · 2026-08-27).** Moncs: *"Do you
  purposefully call /dkp once a minute? Looking back over the past 60 minutes,
  it looks like theres about 54 calls from 184.144.103.149 calling it"* — a
  RESIDENTIAL ip: one member's PC. Every open Mimic pulled the full
  472-character standings array once a minute to render one number.
  ⚠ **The blindspot, written up in `DESIGN-agent-third-party-calls.md` §1: a
  counter that watches one caller reads as "we're clean" when a second caller
  exists.** We had published `/opendkp` the day before *specifically* so its
  operator would not have to take our word for our traffic — and it counts
  `utils/opendkp.js`, which is BOT code. The agent's calls went direct, so they
  were off the counter, outside the outbound governor, and scaled with how many
  people had Mimic open — the one dimension a server-side number cannot see.
  Hitya: *"agents shouldnt be reaching out to opendkp like this."*
  **Rule now in force: the agent does not call third-party APIs; the bot does
  and the agent asks the bot.** Not a slower cache — the hostname is gone, and
  `test/opendkp-standings-cache.test.js` fails the build if it returns. The bot
  serves `server-panel/account-dkp` from `_panelStandings`: one fetch for the
  whole guild, counted, governed, haltable.
  ⚠ **The live check is RAIDS-ONLY; an open auction only sets the pace inside a
  raid** (Hitya, same day, correcting the first cut: *"the live dkp checkin
  should be raids-only since users are getting more dkp with each tick. the rest
  of the time the checkin should be just to the bot and database"*). DKP moves
  per TICK and ticks only happen while raiding, so an off-raid live call buys a
  number the mirror already has — and an auction CAN sit open off-raid, which
  would have kept a trickle running all week. 60s with an auction open in a raid
  · 30 min in a raid otherwise · **never** outside one, where `account-dkp`
  answers from `_familyDkpFromMirror()` (extracted from the bid-history key, not
  copied) and labels itself `source: 'mirror'`.
  Mob kills were considered and rejected: they miss loot posted off trash, and a
  mob dying does not move anyone's DKP anyway.
  Also shipped: 💰 **Loot tab** (`renderLootTab`) carrying bidding + rolls, which
  were split across Dashboard and Stats; and `wpLootPollWanted()` gating the loot
  poll on a raid window OR the tab being open (⚠ the OR is deliberate — loot is
  handed out off-raid too; see §4 of the design doc before tightening it).
  Full agent call inventory — every endpoint, every cadence — is §3 of
  `docs/DESIGN-agent-third-party-calls.md`.
  11 mutation-checked tests. ⚠ OPEN: `/opendkp` counts the bot only; now that
  that is the whole truth it should SAY so, since the guarantee is a code
  property a reader cannot see.

- **OpenDKP audits: the full download is once a week now, and the redeploy walk
  was the real bill (bot 3.1.84 → 3.1.85, 2026-08-27).** Hitya, twice: *"we
  don't need a full download that often, just before a raid. three times a
  week"*, then *"let's make the full audit once per week then until we have the
  new version that has the since tag."* The gap-healing full sweep now anchors
  to **6pm ET Sunday** instead of a 24h rolling timer that fired at whatever
  hour the process last booted (on 2026-08-26, mid-raid).
  `OPENDKP_LIST_FULL_SWEEP_DAYS` is a list — `0,3,4` restores the three raid
  nights without a deploy, and is the first thing to try if audit rows ever go
  missing. ⚠ The `_MAX_HOURS` safety net moved 96 → **240** with it: a net
  tighter than the schedule *becomes* the schedule.
  Measuring for all this turned up the bigger cost: **three deploys inside ten
  minutes, 17 calls / 6.2 MB apiece**, because the last-page fast path needs a
  page-count hint a fresh process doesn't have. Fixed by jumping straight to the
  last page once page 1 proves oldest-first, and by having a cold process adopt
  the current anchor rather than sweep. **VERIFIED live: the 3.1.84 boot sync
  cost 2 calls / 403 KB**, and the next pass was skipped entirely by the idle
  backoff. Steady state is 1 call / ~6 KB, mid-raid included.
  16 mutation-checked tests in `test/opendkp-list-endpoint-writes.test.js`.
  Full story + the per-minute evidence: `DECISIONS-2026-08-27.md`.
  ⚠ OPEN: **one full sweep fired at 00:02 ET on 2026-08-27 that the shipped
  decision function replays as `false`.** Restart, env, version and any second
  code path were each ruled out with evidence. Bot 3.1.86 adds a diagnostic that
  logs every input on any sweep rather than guessing at a fix — read it the next
  time one fires (expected Sunday 18:00 ET). Also fixed there: `Number('') === 0`
  made the day-list fallback unreachable, and its test passed for the wrong
  reason.
  ⚠ OPEN: the weekly cadence is TEMPORARY — revert to `0,3,4` when OpenDKP
  ships a `since` parameter. The API request to Moncs is written (framed as
  "one full pull a week + deltas in between") but unsent. Next targets on the
  same surface: `/characters` (279 KB/pass) and the `/auctions` mirror
  (680 KB/pass).

- **The OpenDKP incident: halt + fan-in cache + outbound governor (bot
  3.1.71–3.1.72, 2026-08-25; Moncs: "high volume automated traffic … I've
  currently blocked the ip address").** Root cause was NOT the 30-min sync:
  the Loot bidding panel's 7s dashboard poll went upstream uncached
  (server-panel `auctions`/`my-bids`, + a getAuction() N+1) — his API Gateway
  logs showed 1,678 calls / 1.1 GB in ~3.3h from ONE open dashboard; live
  since Mimic v2.0.0 (2026-07-19) when an escaping fix armed the timer.
  Shipped: `OPENDKP_HALT` kill switch at the `_get`/`_post` primitives
  (3.1.71); panel reads OpenDKP's documented `/auctions/active` through one
  shared cache (15s live / 120s idle), my-bids N+1 deleted, `opendkp-auth-config`
  halt-gated to starve the agents' DIRECT `/dkp` calls, audits/adjustments
  early-break (15 pages → 1), outbound budget `OPENDKP_MAX_CALLS_PER_MIN` +
  429/Retry-After cooldown (3.1.72). Full story: DECISIONS-2026-08-25;
  budget-as-config for other deployments: DESIGN-selfhost-wizard §3.
  ⚠ OPEN: halt stays ON until Moncs unblocks the Railway IP; flip
  `OPENDKP_HALT=0` before Wed's raid for bidding. Queued for next Mimic beta:
  panel poll 7s→adaptive, agent standings cache 60s→5min, document.hidden
  back-off.

- **Overnight batch 2026-08-19 → 20 (landed on main Thursday morning; details
  in `DECISIONS-2026-08-20.md`):**
  - **DT countdown fix (agent 3.5.93 + guild_triggers row, mid-raid).** Target
    capture broadened to match multi-word victims (warders, charm pets) —
    live fleet-wide via the trigger poll — and a gated `require_raid_member`
    fire on a timer-bearing trigger now ARMS the timer (cycle state), only
    suppressing the callout. Inverts the Aug-09 note, recorded in the row.
  - **`/ai` — the methodology, published (web 1.1.92, Hitya: "publish all of
    this detail to wolfpack.quest/ai … human and agent readable").** One data
    module (`web/lib/aiMethodology.ts`) renders three ways: the page, `/ai.json`
    and `/ai.txt`. 16 rules each paired with the incident that caused it, 16
    milestones linked to real commits, the 9-stage task workflow as a decision
    tree, and the 5-command gate. A scrubbable spine un-adopts rules as you drag
    back to April. `test/ai-methodology.test.js` holds the published copy to the
    source docs (every quote must still appear verbatim) — and had to be fixed
    once for passing vacuously. Linked from the front page and `/platform`.
  - **`docs/GEMINI-SPARK-HELPER.md` (docs only, Hitya: "a starter/help file
    that Gemini spark could use to operate similarly to how we do here").**
    Boot order (CLAUDE.md → STATUS → HOW-ITS-BUILT → newest DECISIONS), the
    per-task loop, branch routing + version bumping, the full verification gate
    (`npm run lint` / `check:dashboard` / `test`, plus the two CI does NOT run
    — `cd web && npx tsc --noEmit` and `golden:check`), the three test tiers
    including the source-slice harness, migration protocol, and the footguns
    that have already shipped bugs. Complements `docs/AI-CONTRIBUTOR-BRIEF.md`,
    which is for a chat AI with no repo access; cross-referenced both ways and
    from CLAUDE.md.
  - **Per-class spell levels (migration 20260825050000, Lacunanight's second
    catch the same night).** `spell_level_seed.level` is the MINIMUM across
    classes (verified 308/308 rows); per-class truth lived only in a text
    note. 19 class-rows over 15 spells displayed a level wrong for that class,
    worst 25 levels off (Shadow Sight: necro 24 shown, SK 49). New
    `spell_class_levels` view + `pop_spell_needs` v3 uses the class's level.
    Follow-up SHIPPED same night (20260825060000): `character_missing_spells`
    had the bug twice more — its `min(spell_level)` was guild-wide across all
    classes (SKs were shown the necro's 24 for Shadow Sight, real level 49),
    and its `'Spell: %'` filter matched 1 bard item vs 107 `'Song: %'`, so
    bard pages were effectively empty. Now resolves same-class observed level
    → spell_class_levels → seed minimum.
  - **PoP parchment pools from quest scripts (web 1.1.96, Lacunanight's
    first-night catch: "necros have 9 spells but shows 12").** The level-tier
    inference overcounted; pop_parchment_pools (view over the ProjectEQ
    turn-in mirror) now drives the /pop matrix, the pop_spell_needs RPC
    (+tier column, +Song: support — bards were silently dropped), and the
    spell-page badges. Verified byte-for-byte vs live Quarm on necro Glyphed.
    ⚠ Needs a local session: reconcile the ±1 necro-Ethereal divergence
    against Quarm's Lua quest fork (HANDOFF-pop-quest-extract.md route);
    also queued: character_missing_spells has the same 'Spell: %'-only
    filter — bards under-served on the non-PoP path too.
  - **Officer-assisted Mimic linking (bot 3.1.70 + web 1.1.93, Hitya via
    Gonner: "doesn't have discord auth working").** The device-code flow's
    missing half: the poll handler accepted discord-only authorizations since
    2026-07-31 but nothing could write them. Officers now stamp a member's
    code on /admin/links (attestation trust model, audited onto
    mimic_sessions.linked_via/linked_by). Migration
    20260824050000_mimic_link_officer_assist applied + committed. The
    follow-up shipped same-day (web 1.1.94, error-surfacing fix 1.1.95):
    officer-issued site-access invites → /auth/claim username+password bound
    to wolfpack_members.user_id, reset via re-invite, no SMTP. FIRST LIVE USE
    SUCCEEDED (Gonner/Lacunanight, 2026-08-25 02:47 UTC). Officer procedure:
    RUNBOOK-site-access.md; design + merge story: DECISIONS-2026-08-24;
    self-host choices: DESIGN-selfhost-wizard.md §3.
  - **Lockouts derived from kill parses (bot 3.1.68 + web 1.1.90, Hitya:
    "taeya reported this Ventani kill so they should have a lockout").**
    `character_lockouts` shipped 2026-08-21 reading only the `/sll` relay and
    held ZERO rows — /sll needs a human to type it, and none had arrived since
    the write path existed, while the encounter pipe had already captured three
    foreign raid kills from that one player. `utils/killLockouts.js` +
    `_recordKillLockouts` now derive lockouts from confirmed boss-kill parses:
    participants from uploader + damage + healers + tanks (a damage list alone
    misses a cleric, which is exactly the case reported). `source` distinguishes
    them and a live /sll row always wins; PK moved to (guild, character, boss).
    `scripts/backfill-kill-lockouts.sql` walked history — 753 live lockouts,
    162 characters, 21 bosses. Two things the volume exposed: the officer
    briefing now reports `actionable` (locked to a target that is UP) rather
    than a raw headcount, and non-roster characters from joint raids are
    counted, not listed.
    Same-evening corrections from Hitya ("Friday was a guild rolling event, so
    internal… only the lockouts from current era or night's targets really
    matter, and as long as mains are good to go"): `ours` now also comes out
    true on a majority-roster share, so an off-calendar guild event is internal
    (our raids measure 0.75–0.89, pug raids 0.14–0.22 — the 0.5 line matches
    `web/lib/anomalies.ts`); `/admin/lockouts` scopes to `currentEraNames()`
    (era containing now + the one below, so Velious stays in and it moves
    itself at the PoP unlock); and the verdict is `mainsBlocked`, not a
    headcount. Net effect: 753 rows → six that matter for Sunday, four of them
    mains.
  - **Buff queue overhaul (mimic beta + agent 3.5.92 + bot 3.1.59, Hitya:
    "buff queue is off the page").** Overlay type-groups collapse by default
    with name previews; Feral Avatar/Savagery carried targets stay listed with
    ⏳ remaining (soonest-to-drop = recast order); dashboard 🛡 options card
    adds cures-only / Feral-only section filters served on `/api/buff-queue`.
  - **/parses trash-flood fix (web 1.1.77 + bot 3.1.60/61, Hitya: "not the
    right parses for nonbosses").** Cards = curated bosses
    (`bosses_local.auto_registered`, filtered in-query); farm/trash/uncurated
    nameds roll up to one 🗡 line per zone per night (`parses_offcard_rollup`
    RPC, zones finally resolve via npc_id = zone_id*1000+n). Lockout-named
    mobs self-promote to cards (`_promoteLockoutBoss` — "if they have a loot
    lockout we can keep them on"). Landing Recent Kills widget same filter.
  - **Deferred /announce parse sessions (bot 3.1.62, Hitya: "it hasn't
    happened yet!").** Announcing a future event no longer opens the session
    at announce time (the 12:21 AM All-Night-Leaderboard-of-farm-kills
    incident) — pending record in `bot_kv`, opened by the spawn checker 30
    min before start; adjusttime/adjustdate/cancel keep it honest.
  - **Inventory auto-upload — STABLE (Mimic 2.6.0 · agent 3.6.0 + web
    1.1.78, Hitya: "are we not consuming inventory files?" → "this is pretty
    important", same day).** The `/api/agent/inventory` endpoint existed
    since June but its agent-side scan was never built — inventories were
    manual-/me-only and frozen (2/122 characters fresh). Now
    `<Char>-Inventory.txt` uploads like its quarmy/spellbook siblings; page
    copy corrected (it claimed "Mimic 1.0.78+" auto-upload that never
    existed). Graduated same-day to the whole fleet as Mimic 2.6.0 (carrying
    the buff-queue overlay + DT timer-arm from beta); beta re-parked at
    2.6.1. Details + lesson in `DECISIONS-2026-08-20.md`.

- **Add mules/alts from their inventory file — STABLE (web 1.1.54,
  2026-08-14).** Hitya: *"can you make it so that anyone can upload additional
  inventory files from the /me page and have it bring in their other
  characters/mules?"* Pyxil has six bank toons Mimic can see in
  `C:\TAKPv22` but that nothing else can — no logs, no `/who`, no OpenDKP row.
  The existing per-character 🎒 upload could not help: it is gated on the
  character ALREADY being in `characters` AND linked to you, which is exactly
  what a mule is not.
  - 🧳 on `/me` takes many `<Name>-Inventory.txt` at once and names each
    character **from the file name**, because the rows inside are items, not
    identity. Letters-only validation, so a renamed copy can't invent a junk
    roster row.
  - **The only bar on claiming is "already claimed by somebody else"**
    (`claimVerdict` in `web/lib/inventoryFile.ts`): yours already → upload,
    nothing to claim; **linked to another member → refuse**; everything else —
    brand new, or in `characters` but unclaimed — becomes yours. Created rows
    and claimed-existing rows both stamp `registered_via_web_*`.
  - ⚠ **Widened the same day, by Hitya, over my narrower first cut.** I refused
    to claim an unclaimed row that carried an `opendkp_id`, on the reasoning
    that the shape means a real member who simply hasn't linked Discord.
    Overruled: *"We should at least take the data and allow them to see their
    characters in their account if they have the inventory files and are not
    already claimed by someone. Being in the guild should not be a limiter for
    someone making a new character and trying to use the inventory function or
    target info overlays or any of those things outside of raids."* The refusal
    broke the real case (your own alt, already in OpenDKP, invisible to you) to
    guard a hypothetical one, and guarded it weakly — a renamed file defeats it.
    A wrong claim is visible, audited and one-click reversible; a refusal is a
    dead end. **The general form of this is now an open question, below.**
  - Per-file results, so a batch where two of six belong to someone else names
    those two rather than failing as a whole.

- **⚠ OPEN — guild membership gates personal tooling site-wide.** Raised by
  Hitya in the same breath as the claim widening: *"Being in the guild should
  not be a limiter for someone making a new character and trying to use the
  inventory function or target info overlays or any of those things outside of
  raids."* The claim rule is fixed; **the sign-in gates are not.**
  wolfpack.quest has TWO (guild membership via `DISCORD_GUILD_ID`, then role
  membership via `ALLOWED_ROLE_NAMES`), so someone outside the guild cannot
  reach `/me` at all — the upload they'd need is behind a door they can't open.
  Splitting *personal* surfaces (inventory, quests, `/character`, Mob Info) from
  *guild* surfaces (parses, DKP, raid, boards, `/admin`) is a real change to who
  can see guild data, not a flag flip, so it is **not** bundled into the
  inventory work. Needs Hitya's call on scope: guest role? separate personal
  tier? Mimic-only (no web account)? See `docs/DECISIONS-2026-08-14.md`.

- **A configured EQ folder counts as known, logs or not — BETA (Mimic
  2.5.4-beta / agent 3.5.83, 2026-08-14).** Pyxil's onboarding: she pointed
  Mimic at `C:\TAKPv22`, Settings listed it ticked as *"eqclient.exe · no logs
  yet"*, and the dashboard still said **"No EQ folder selected"** while *Set up
  EQ for me* answered **"No EQ folder known yet — point Mimic at your EverQuest
  folder in Settings first."** She had. The folder had no logs BECAUSE in-game
  logging was off, and the one button whose job is to turn logging on refused
  for want of the logs it would have created. **Every user who installs EQ and
  Mimic before typing `/log on` lands there — which is every new user.**
  - **One list was answering two questions.** `resolveEqDirsWithLogs` gated
    every path on `_dirHasEqLogs` including configured ones, and the agent's
    `_eqSetupDirs` inferred folders from logs it was already tailing. Both are
    right for *what do I TAIL* and wrong for *what do I KNOW*. Split: `dirs`
    (has logs → tail it) vs `knownDirs` (configured / eqgame.exe-detected /
    running → we know it), passed to the agent as `WOLFPACK_EQ_DIRS`, which
    `_eqSetupDirs` and the dashboard banner now both read.
  - **TAKP is scanned for.** `C:\TAKP` / `C:\TAKPv22` named, plus a drive-root
    walk for any `takp*` directory — the version is in the folder name and moves
    every release, so a fixed string goes stale. Local fixed drives only, since
    probing an absent or network drive is what made Settings freeze.
  - **The onboarding now says WHY there are no characters.** "Configure an
    EverQuest folder above" reads as *the thing you just did did not work*; with
    a folder present it now names the real fix (`/log on`, or the setup button
    with EQ closed).

- **The Dock — BETA (Mimic 2.5.1-beta / agent 3.5.81, 2026-08-14).** Hitya:
  *"a dock overlay that lets the user attach/consume the overlays together and
  have it use one chromium browser."* One window hosting overlays as
  same-origin iframe panes; docking clears the overlay's `show*` flag so the
  reaper genuinely frees its ~80 MB renderer rather than just hiding it.
  Browser-verified end to end (panes load the real overlay files, picker docks,
  a pane's ✕ undocks only itself, columns cycle 1→2→3).
  - ⚠ **The panes are the real overlay files, never forks.** Docked-only
    behaviour lives in `preload.js` behind `WP_IS_DOCKED`.
  - Only the trigger overlay is excluded (its flag means "make sound"). The
    Command Center is dockable via an `agentPath` so its pane resolves the
    agent-served copy — the need for that was found BY the test pinning every
    pane file against the window's `loadFile()`.
  - **Round two, ten findings from the first live look (Hitya, 2026-08-14),
    all addressed in Mimic 2.5.3-beta:** reachable without setup mode (holding
    panes now implies being wanted — before, the only ways to turn it on were
    unreachable from a hidden dock); Command Center dockable; pane drag
    reorders the pane instead of moving the window (iframes go inert in setup);
    per-pane column/row spans; setup bar with opacity + Done and a gutter so the
    count clears the ✕; a DOCK button on the dashboard Overlays page; backdrop
    off now genuinely removes the plate; per-pane background override;
    auto-height on by default; grow-upward anchors the bottom edge.

- **Clock skew from a shared chat line — STABLE (bot 3.1.48, 2026-08-14).** The
  EQ server broadcasts a `/gu` line to everyone at once, so two clients' stamps
  for the same line differ by exactly their clock skew — no network in the path
  and **our own server's clock not involved**, which is what makes it
  independent of `pulse`. We were already generating it and binning it at the
  dedup gate (1,019 lines/12h, 3 keeping a second copy). Published as
  `method='chat'`; NOT wired into corrections yet, per DESIGN-clock-correction
  §2.3. One-second resolution — nothing sub-second may be built on it.

- **Agent asks a real time server — BETA (agent 3.5.81, 2026-08-14).** SNTP over
  UDP/123, no dependency, inlined (a sibling file would not ship — `stage-agent.js`
  has a hardcoded list). Fills in when the bot is unreachable, where the agent
  previously assumed a zero offset. `ntp − pulse` is the BOT's own clock error,
  which matters for a self-hosted tenant whose bot might sit on a desktop.
  ⚠ Network half UNVERIFIED — UDP/123 is blocked in CI and the cloud container;
  the arithmetic is a pure `_parseSntpReply` with 16 tests, first real
  measurement comes from a beta machine.

- **OpenDKP loot folds itself into the Loot tab — STABLE (bot 3.1.45,
  2026-08-14).** Mob Info's "N× won" counts read `loot_observations`, and the
  only thing that ever wrote the OpenDKP half of that table was an officer
  typing `/backfillopendkploot`. Somebody last ran it on 2026-06-04, so the tab
  was missing **758 awards across 28 raids** — Kazmodon won Silver Band of
  Secrets at raid 98561 for 150 DKP and the item still read as never dropped.
  `foldLootObservations()` now runs at the end of every `runSync`, 40 raids per
  pass, newest first, as a set difference over raid ids rather than a watermark.
  Fails open and runs AFTER reconcile so it can't copy a row about to be deleted.
  - ⚠ **The two OpenDKP item ids are not interchangeable.** `game_item_id` is the
    EQ catalog id; `item_id` is OpenDKP's own row id. On the 283 mirrored awards
    where they disagree, `item_id` matched the item's real catalog name **0
    times** and `game_item_id` matched 13. `/backfillopendkploot` preferred
    ItemId — corrected in both places.
  - **The shape to recognise:** a derived table fed only by a human command
    degrades *silently and partially* — older items keep their counts, so the
    surface looks healthy until someone checks one specific item. Ten weeks
    unnoticed. Same family as the Raid-Helper sync below.
  - ⚠ **Shipped broken, fixed in bot 3.1.47 the same night.** PostgREST caps a
    response at 1000 rows and `limit=50000` does not lift it — silently. Both
    sides of the diff were truncated, so already-folded raids looked unfolded
    and two passes re-inserted 116 awards (deleted; range verified clean). Reads
    now page via `selectAllPaged()`, ordered, with a failed page returning null
    rather than a short list. **All 18 original tests passed throughout** — they
    tested the logic given its inputs, never whether the inputs were complete.
    Verify a data-moving feature by counting rows in the destination on the day
    it ships.

- **Raid-Helper mirror says when it stops arriving — STABLE (bot 3.1.46,
  2026-08-14).** The `rh_*` mirror is the ONLY durable copy of declared
  availability (the upstream board is cleared on raid day), so a silent sync
  failure doesn't degrade — it loses the record permanently. Two verdicts, kept
  separate because they need different answers: **stale** (no sync in 6h, or
  never) and **blind** (a raid inside 24h with zero sign-ups mirrored). Stale
  outranks blind. Latched in `bot_kv` — an in-process latch would re-alarm on
  every Railway deploy, the eleven-raid-reviews trap — keyed on the *shape* of
  the problem so two different alarms on one day are both heard, and cleared on
  recovery.
  - **The 24h window is what makes it survivable.** Raids are Sun/Wed/Thu 8pm
    ET, so 24h is "this time yesterday" — actionable, and narrow enough never to
    fire on a normal weekend where nobody has signed up for Wednesday yet. An
    alarm that goes off on an ordinary day is one people mute.
  - Posts to `OFFICER_ALERT_CHANNEL_ID` → `AUDIT_TRAIL_THREAD_ID` → log-only.

- **Live combined damage → a History tab — STABLE (Mimic 2.5.0 / agent 3.5.80, 2026-08-14).**
  Hitya, watching the guild column double people mid-fight: *"instead of
  displaying the combined damage during the fight, perhaps we just have the
  overlay give the last few mobs in a history tab that can be opened up once
  it's properly deduped."*
  - **The estimator isn't broken, it's UNSETTLED.** `_corroboratedDamage` needs
    three independent readings before it can corroborate anything; below that it
    falls back to max, which is exactly the doubling. Readings arrive on the
    upload queue's 15s drain from twenty machines, so mid-fight most players have
    one or two. Post-fight the same estimator landed within ~1% of three
    independent sources (Atlasius 99,979 vs his own 100k). **The fix is about
    WHEN the number is shown, not whether it works** — don't "restore" the live
    merge.
  - Agent keeps a 6-deep ring of finished fights (`_recordFightHistory`), each
    capturing this machine's own view at the kill, then re-asking
    `/live-damage` at +40s and +100s as the stragglers land. A late EMPTY answer
    never overwrites good numbers (the bot's snapshot lookback is 3 minutes; past
    that the query legitimately returns nothing). Multi-log installs flush once
    per builder, so entries dedupe on (boss, start within 60s).
  - HUD gets a third tab with a ◀ ▶ pager. Header names the fight and says
    `· 11 clients` when settled, `· settling…` when not — an unlabelled small
    number reads as the guild's answer, which is the misreading the tab exists to
    prevent. DPS/Tank are now purely local.
  - ⚠ The `/rs` parse line is built from the LIVE encounter but read `boss` and
    `secs` from whatever tab is showing — on History that spliced one fight's
    rows onto another fight's header, into a line people paste in raid chat.
    Guarded with `!HIST`.

- **CH chain: un-numbered shouts never take a slot, and a ✕ removes anyone who
  shouldn't be on it — STABLE (Mimic 2.5.0 / agent 3.5.79, 2026-08-14).** Live during the Aten
  Ha Ra pull: Pyxil was spot-healing the RAMPAGE target and shouting
  `TUNARE'S RENEWAL Inc to Timberowl - 98% Mana Left` on each heal. Tunare's
  Renewal is a CH-equivalent, so the agent auto-assigned her a chain slot — 006,
  where Mcdorf actually was — lighting ORDER CONFLICT and dropping a druid who
  was nowhere near the rotation into the middle of it. Hitya: *"she shouldn't be
  placed back onto the CH chain even though she's posting CHs."*
  - **The number is what makes it a chain.** The auto-slot branch is gone; an
    un-numbered personal-macro shout now lands on the spot-heal banner whatever
    the spell is, carrying its `CH_EQUIVALENT_SPELLS` label so a healer can still
    tell a full-heal-tier cast ("Druid CH") from a top-off. A druid who calls a
    number still joins the rotation normally.
  - **✕ on every slot row** → `POST /api/chchain/remove` → `removeChChainSlot`.
    Deleting the row alone is not a fix: whoever seated them is still shouting,
    so the removal blocks that (name, number) for the chain's life. Kept narrow
    because a chain missing a real cleric kills the tank — a *different* healer
    may still claim the number, a roster call clears the block, and on a
    CONTESTED slot the row survives and passes to the remaining claimant instead
    of being deleted out from under them.
  - ⚠ **The ✕ is always drawn, only dimmed — do not "tidy" it into a
    hover-reveal.** That was the first attempt and it fails precisely when the
    button matters. Rows are rebuilt every paint while a cast bar moves, and a
    newly-created element under a stationary cursor never picks up `:hover`.
    Measured in headless Chromium against `chchain.html`: idle row reaches
    opacity 1 in ~100ms, **casting row stays at 0 indefinitely**. The row's
    18px right padding is the reserved gutter that keeps it off the countdown.

- **Dashboard navigation: sidebar + tab split — STABLE (Mimic 2.5.0 / agent
  3.5.72, graduated 2026-08-14).** Hitya: *"having to scroll in our dashboard is somewhat annoying
  to navigate."* Two halves, shipped together because the second needs the
  first. (1) The tab strip became a **left rail** — `.shell` is a flex row with a
  sticky 168px `.nav` beside a `.panes` column; under 700px it collapses back to
  the wrapping strip it was. (2) With room on the rail, the two overgrown tabs
  were **split**: Info had reached 16 cards and Triggers 12 by mixing three
  unrelated jobs. New **📊 Stats** takes the session-observation cards (mending,
  top abilities, spell casts, resists, rolls, inbound spell damage, loadouts +
  pets); new **🩺 Diagnostics** takes the is-it-working cards (Zeal pipe, charm
  and pet-buff diagnostics, trigger journal, boss mechanics, Zeal explorer, raw
  Zeal capture). Info keeps the parser facts + the crash card (Hitya put that one
  on Info deliberately, so it stayed); Triggers keeps recent fires, replay and the
  three trigger lists. Guided tour gained a stop for each — 8 stops now.
  - **Only the markup moved.** Every card's own render fn and placeholder id is
    untouched, so the volatile-card isolation that keeps sections byte-stable
    survives intact. Verified: all 10 tabs switch, no duplicate ids, all four
    touched sections byte-identical on a second render, whole tour walks.
  - **Found a live bug on the way**: `renderCrashReview` sat ABOVE `renderInfo`
    in the `_sections` loop from the day the crash card moved onto Info, so the
    card was blank for the first poll of every cold load. Reordered.
  - `test/dashboard-tabs.test.js` now guards the four lists that have to agree
    (nav buttons ↔ `.section` panes ↔ `_sections` entries ↔ placeholder
    ownership) plus filler-runs-after-emitter ordering. Every way they can
    disagree previously failed silently.
  - ⚠ **Moving a card resets its "hide this panel" preference** — the ✕/Panels
    key is `sectionId|title`, so a card hidden on Info comes back once on Stats.
    Benign (the card reappears, nothing is lost) but it is why a hidden panel
    may look like it un-hid itself after this update.

*Weekend of 2026-08-08/09 — full decision record in `DECISIONS-2026-08-07.md`.*

- **Mimic 2.3.4 "Tag! You're spawn_id it!" — GRADUATED STABLE, whole Windows
  fleet (2026-08-09; agent 3.5.54; beta re-parked at 2.3.5).** Closes the tag /
  trigger / parser line: `/tag` spawn-id capture, the EQLogParser trigger-parity
  set (agent 3.5.52 — multiple warning thresholds, captured durations, timer key
  capture, visible recast timer, exclude patterns, colour/pin/display-threshold),
  and the five pq-companion-derived parser fixes (3.5.44–3.5.48). Its bot-side
  half had already shipped straight to main on 2026-08-07 — **bot 3.1.31**, where
  the tag upload cap was keeping the OLDEST 24 tags and dropping the boss.
  **Version call (Hitya): shipped as 2.3.4, not 2.4.0 — the park IS the
  line's target**, cut stable at whatever the line was parked at rather than
  re-deriving a number from how big the feature set feels. Named by Hitya; there
  is no standing theme system, names stay ad-hoc per release.
  - **Graduation was FILE-LEVEL, never a branch merge** — `beta` was 79,199 lines
    behind on bot/web/docs and a merge would have deleted live surfaces.
  - ⚠ **A graduation push must put the Mimic version bump in the LAST commit** —
    `release-mimic.yml` diffs `HEAD` vs `HEAD~1`, so a docs commit landing after
    the bump makes the build a no-op *with a green check*. Cost us the v2.3.3
    stable build, recovered by `workflow_dispatch`.
- **Agent 3.5.54 — P1: a leading `{s}` in an unanchored trigger was eating the
  timestamp (2026-08-09).** When `compileTriggerPattern` replaced
  `_translateDotNetRegex`, `{s}` went from an allow-list char class (which could
  not match `[`, so the engine skipped the `[Sun Aug 02 21:10:45 2026] ` prefix
  by itself) to `.+?`, which consumes it happily at index 0. **This was the
  RECOMMENDED shape** — CLAUDE.md tells authors to write patterns unanchored,
  because a bare `^` anchors before the timestamp and can never fire. Live
  casualty: the **Razor Fang** guild trigger. A timestamp inside a name capture
  breaks every name-keyed consumer at once — charm-pet suppression stops
  recognising your own pet, TTS speaks the timestamp, and a captured timer key
  mints a new bar per fire. Fix: `_expandTriggerTokens` reports
  `leadingWildcard` and `compileTriggerPattern` prepends the same OPTIONAL
  `^(?:<ts>)?` prefix the anchor rewrite uses; `{c}` is exempt (literal
  alternation, cannot match inside a timestamp). Pinned by
  `test/trigger-class.test.js`.
  **Found ONLY because the graduation ran main's suite** — that test file does
  not exist on `beta`, so agent 3.5.44 → 3.5.53 shipped with nothing checking it.
  Same class of gap as the 2026-08-04 "CI runs on beta now" P0.
- **`beta` re-synced to `main` + the Mimic park — and that is now the standing
  rule (2026-08-09).** Nothing had ever flowed main→beta, so beta had aged to
  **79,199 lines behind**. Audited before touching it: 420 files differed outside
  Mimic/agent and **416 were pure staleness**; the four with beta-only commits
  held nothing but obsolete text. So there was nothing to reconcile —
  `git checkout beta && git reset --hard origin/main`, re-park
  `apps/mimic/package.json` one patch above the new stable, verify the agent +
  Mimic files are byte-identical to the beta being replaced, run the gate,
  `push --force-with-lease`. **Force-pushing is safe specifically because every
  beta build cut a release tag** (`v2.3.4-beta.1` … `v2.3.5-beta.1`) that keeps
  the discarded history reachable — verify that before any future force-push.
  Effect: beta's test suite went from **35 files in `test/` to 90**, which is
  exactly why the `{s}` P1 rode through ten releases unseen. Procedure +
  rationale now in `CLAUDE.md` → Branches.
  - **Lesson that outlives the resync: file-level graduation only moves the files
    you NAME.** `.gitignore` had never graduated, so `main` never picked up
    beta's ignores for `logsync.opendkp.json` (which holds an OpenDKP **bearer
    token**), `.bidfamily.json` and `.plannedbids.json`. Nothing leaked — they
    were never tracked — and main now ignores them.
  - ⚠ **PR #78 is a live hazard**: a standing `beta`→`main` PR whose post-resync
    diff is exactly one line, the Mimic version park. Merging it sets `main`'s
    Mimic to 2.3.5 and cuts an unintended stable release. It has no informational
    value now that beta *is* main — close it.
- **Loot bidding — the "already won" set, and a UX round (2026-08-09; bot 3.1.33
  on main, agent 3.5.53).**
  - **bot 3.1.33 — a capped DISPLAY query was doubling as a SET.** `bid-history`
    seeded the already-won set from `wins`
    (`opendkp_loot … order=fetched_at.desc&limit=100`). The Hitya/Melting/Canopy
    family has **187 awards, so 87 read as unwon** and came back as "bid on but
    not yet won" and as RECENT MISSES; the three items reported sat at rows 101,
    120 and 184. Worse, `fetched_at` is the MIRROR SYNC time, so *which* 100
    survived would have reshuffled on every weekly sync. The won-set is now its
    own uncapped `item_id`-only sweep and `wins` orders by `raid_id.desc` (real
    award order). Pinned by `test/loot-won-set.test.js`. **The shape is generic —
    see the open item on the other 23 `limit=####` queries.**
  - **agent 3.5.53 — UX.** Nobody types their own main and alts, so the panel
    adopts the family **from OpenDKP** on sign-in (wholesale when empty, additive
    when not — a hand-typed name is never removed, the chosen main never demoted;
    `⟲ from OpenDKP` is the explicit replace path), with a `famDirty` guard.
    Loot history is **collapsed by default and re-hides on every load** — the
    dashboard gets screen-shared during raids and a visible wishlist is a bidding
    tell. ✕ dismissals are **local-only** (`logsync.lootdismiss.json`): the
    wishlist is INFERRED from OpenDKP bid history, so there is nothing upstream
    to delete, and "restore all" always reverses it. The expansion filter opens
    on the **current** expansion, derived from the newest award rather than
    hard-coded, so it advances by itself when PoP unlocks.
- **Web 1.1.23 → 1.1.35 — the beta mirror, and the page that explains the
  platform (2026-08-08/09).**
  - **`b.wolfpack.quest`** (Hitya): put a `b.` in front of any page to see it as
    it stands on `beta`. Beta banner linking back to the same path on production,
    `noindex, nofollow` (load-bearing — same pages on another host is duplicate
    content), "(beta)" titles; `NEXT_PUBLIC_IS_BETA` comes from
    `VERCEL_GIT_COMMIT_REF` at BUILD time, deliberately not a Host-header check
    (reading headers in the root layout forces every page dynamic). Verified by
    building the app both ways and then against the live deployment, not by
    reasoning. **The first pass got this wrong in an instructive way** — it
    disabled beta web builds entirely; Vercel was already building beta, and the
    waste was never the build, it was that the output sat on an unguessable
    preview URL. Turning the build off removed a capability; naming it turned the
    same build into a review tool. Wiring (incl. the blank-Git-Branch trap) is in
    `CLAUDE.md` → Branches; the DNS/registrar step is human-only — **no Porkbun
    integration exists** and cloud sessions cannot reach the API or read the zone.
  - **`/about`** — the walkthrough page, with live numbers and three verified
    overlay demos (Peopleslayer, the Ashieron DA, the CH chain, Shei Vinitras).
    Headline stats: OpenDKP attendance **avg 49 · biggest 67 · 132 raids · 21
    parsers in the busiest night**; since-April combat **650 fights · 288.3M
    damage · 88 bosses**; **612 PvP broadcasts**. **`/shortabout`** tells the same
    build-up story as one phone-sized scroll.
  - **`about_stats()`** (migration `20260809040000`) serves all of it in one round
    trip, and the migration carries the lesson: nine PostgREST counts folded into
    one function of exact counts was **still 32,398 ms** (`count(*)` is a full
    scan across ~1M rows); **~200 ms** came from changing *what is asked*
    (`pg_class.reltuples` for big-table display counts), not from folding calls.
    Three measurement rules are pinned in the same file — raid size comes from
    **OpenDKP attendance, not parses** (the parse-derived figure read ~36 because
    `encounter_players` only sees roster-resolvable characters, and carries other
    guilds' players in contested content); parser coverage counts **people, not
    characters** (distinct `uploaded_by_discord_id` = 21, distinct
    `contributor_character` = 23); and **nothing is a "right now" count** — the
    guild raids Sun/Wed/Thu, so a live figure read at 3am Saturday makes a
    healthy platform look dead.
- **Fight timeline v2 — the data layer is BUILT and validated; the chart is not
  (2026-08-09). Spec + audit: `DESIGN-fight-timeline.md`.**
  - `encounter_timeline(uuid, step)` in migration `20260809030000` — shipped as a
    FUNCTION rather than a view so the encounter filter lands *before* the jsonb
    expansion (the table is 557k rows / 458 MB).
  - **Root cause of the broken snapshot→encounter binding, found and trivial:
    NAME FORMAT.** Only **96 of 3,651** distinct boss fights in 14 days had any
    snapshot bound (**2.6%**). `encounters` names a boss through
    `eqemu_npc_types.name` — underscored and sometimes `#`-prefixed
    (`Kaas_Thox_Xi_Ans_Dyek`, `#Tukaarak_the_Warder`) — while the agent writes
    `boss_name` with spaces, so equality matched **only single-word bosses**
    (Talendor, Severilous, Faydedar, Kelorek\`Dar). That is exactly the set that
    looked bound, which is how a plain bug read as a backlog. Normalising
    `_`→space + stripping `#` took the last raid's top twelve fights from ZERO
    snapshots each to full coverage. ⚠ The design doc's 2026-08-06 "CORRECTION"
    block (*"the live pipeline already binds — do not build around the window
    join"*) is **wrong** and is flagged in place; it sampled the single-word
    bosses.
  - **Two correctness traps already paid for:** never `max()` per-bucket deltas
    across uploaders (breaks the telescoping property — over-counts ~2.4×; pick
    ONE canonical uploader per player), and never count the first sample in a
    window as a delta (it is a BASELINE — one uploader's series began 52 minutes
    before the encounter and alone read 311% of truth).
  - **IN FLIGHT 2026-08-09, being live-tested at tonight's Ssra raid:** the agent
    adds `ramp` to the `per_player` payload (**beta 3.5.55**) — the RAMP swimlane
    is the only part of the sketch with no data at all — and the bot resolves
    **`encounter_id` at encounter close (3.1.34)**, which is what removes the
    repeat-pull ambiguity the read-side window join can never fix. Until that
    lands, do not present the chart as authoritative for repeat-pull fights
    (three of the ten biggest fights reconstruct at 20.7% / 63.6% / 189.6% of
    truth, and all three were pulled several times inside the window).
- **Threat-snapshot storage + the attendance denominator (2026-08-08; bot
  3.1.32, migrations `20260808030000`/`040000`/`050000`).**
  - **Snapshots gated to raid activity:** keep one when it names a boss, OR it is
    raid time and 8+ players are in the fight. Trash pulls during a raid are
    deliberately IN; off-hours duo camping is OUT (measured at 54% of the payload,
    answering nothing). Named bosses are kept regardless of the clock, so off-night
    kills still count. `raid_night_id` now rides both the snapshots and the
    roll-up, on the platform's 06:00-ET rollover, so a 00:30 Thursday pull belongs
    to Wednesday's raid.
  - **Unchanged scoreboards are no longer stored** — consecutive snapshots were
    routinely byte-identical six seconds apart. Bot-side content hash over
    **SORTED** keys: the agent rebuilds `per_player` per upload and raw
    `JSON.stringify` order varies, so hashing unsorted would never have hit.
  - **⚠ The roll-up keys on `(boss_name, started_at)`, NEVER `encounter_id`** —
    that column is assigned at fight END by `find_or_create_encounter`, so it is
    NULL on 99.3% of snapshots. A first attempt keyed on it silently summarised
    0.7% of the table and missed King Tormax, Aten Ha Ra and Diabo Xi Xin Thall.
    **If you ever join threat data on `encounter_id`, you are reading a 0.7%
    sample.**
  - **Night-grain roll-up for trash:** per-(raid night, character) instead of
    per-pull — **114,444 rows → 1,087**, folding 104,846 pulls; table **31 MB →
    4.8 MB** (~49 MB/yr), now safe to retain indefinitely. Bosses stay per-fight.
    Trash history starts 2026-07-09; the first week of July is boss-only (the
    backfill timed out and the midnight job only covers 48h).
  - **RA is measured against ticks the member could have attended.** The
    denominator is now per-family and floored at that family's first tick
    (`GREATEST(window_start, first_attended)` — the same rule OpenDKP applies),
    for every window. Previously every member was measured against all 1,492
    guild ticks ever, so everyone who joined after the guild started was
    under-reported, worst for the newest people: Gonner went **64% → 100%**,
    which matches ground truth (he has never missed a tick). Note the two roster
    counts are two different right answers — the leader's sheet filters to ≥50%
    RA over 30 days (41 people), ours counts every raiding rank (64); Dant and
    Denniker sit at exactly 50%, which is where 41-vs-42 comes from.
  - **Chat history stays in Postgres** — not moving `chat_messages` to object
    storage; ~79 MB/year is a decade from mattering.
  - Shipped the same day: **project memory** — `docs/DECISIONS-<date>.md`, the
    `.claude/hooks/session-digest.sh` SessionStart digest, and `/recall`.
- **Attribution normalised to Hitya (2026-08-09) — 523 mentions across 160
  files.** Every decision, bug report, sketch and live-test result credited to
  Uilnayar, Canopy, Rockin, vj, Hopeya, Utoh or Melting is **Hitya** — one
  person, many characters. The ONLY genuine other names are the `feedback`-table
  submitters (`Wabumkin/Adiwen`, `Jankzer`, `Ashieron/Donaldus/Oravayne`), who
  keep theirs. Character names in fixtures, golden logs and worked examples were
  deliberately NOT touched — this was an attribution sweep, not a rename. Rule +
  the complete feedback list live in `CLAUDE.md`; check that table rather than
  trusting an existing comment, since a stale comment is exactly what was wrong.
- **Mimic 2.3 line — NAMED "Quick Setup and Save Memory Update" by Hitya
  (2026-08-04). GRADUATED to stable on 2026-08-09 as part of 2.3.4 (see the top
  of this section); it ran beta-only from 2.3.0-beta.22 → .25 (agent 3.5.29).**
  Carries, in order shipped: the one-click fixers
  (Windows Defender EQ+Mimic exclusions, Zeal install/update, clock resync) and
  the Settings-hang fixes that made setup quick (non-local drive skip, learned
  dead ends, persistent log-file verdict cache); then the memory work — overlay
  windows created only when switched on and freed when off (`_OVERLAY_WINDOWS`
  + materialize/reap), hide-all rendered as a distinct HIDDEN state instead of
  clobbering every pref to off, and the Resource use readout corrected twice
  until it matched Task Manager. Also here: the eqgame.exe identity check (an
  EQLegends client was being tracked as Quarm) and `--wp-window=` tags so Task
  Manager's Command line column can name each renderer. Details per feature in
  `docs/HOW-ITS-BUILT.md` (five 2026-08-04 entries). *(The standing rule that
  graduation is Hitya's call still holds for every future line — it was
  exercised, not retired, when 2.3.4 was cut on 2026-08-09.)*
- **#141 zone-scope the cross-client Target Info / Mob Info merge — DONE
  (2026-07-22, bot 3.0.226 on main + agent 3.4.4 beta; Mimic parked 2.0.2; web
  1.0.265 roadmap/docs).** Field bug (live-verified): a raider in **The Wakening
  Land** targeting "a geonid" saw a **Crystal Caverns** geonid's stats (L31-33,
  1k HP — catalog row `121067`) plus debuffs (Enveloping Roots, Ensnare) that a
  raider in **Tower of Frozen Shadow** had landed on a DIFFERENT same-name mob.
  Cause: the three cross-client Mimic Mob Info relays merged observations by mob
  **NAME globally** — the SAME zone-scoping gap #113 fixed for Extended Target.
  **Layer: bot-side** (mirrors #113). The requester's zone is resolved from
  `character_live_state.zone_name`/`zone_id` for the requesting character (the
  agent now sends `?character=<self>`), via one 2s-cached shared zone map
  (`_liveZoneMap`). The three handlers in `index.js`:
  - **`target-buffs`** (the debuff leak): drops any `buff_casts` row whose
    `observer` was NOT in the requester's zone; the 2s relay cache is now keyed
    by `name|requesterZone`. *Live before/after (2026-07-22): a Wakening Land
    requester on "a geonid" went from **45 merged debuff rows** (Ensnare +
    Enveloping Roots, all observed in Tower of Frozen Shadow) → **0**.*
  - **`target-casts`** (the cast leak): drops any cast whose `caster` was not in
    the requester's zone.
  - **`mob-info`** (the wrong catalog row): NPC id encodes the zone
    (`id = zoneid*1000 + n`), so the catalog lookup now prefers the row in the
    requester's zone id range and falls back catalog-wide when the zone is
    unknown or has no same-name NPC; cache keyed by `name|zoneId`. *A Wakening
    Land requester now deterministically resolves `a_geonid` → `119026`
    (L44-48, 9790 HP — the real Wakening mob) instead of a Crystal Caverns row.*
  Pure predicate `_zoneScopeKeep(requesterZone, observerZone)`:
  requester-zone-unknown → **fail-open** (serve unfiltered, exactly as before);
  observer-zone-unknown → **drop** (unverifiable cross-client row; the
  requester's OWN observations are merged locally in the agent, so nothing real
  is lost). **No per-user toggle** — unlike #113's splinter-group case, a
  wrong-zone mob is NEVER useful for your own Target Info, so zone-scoping is the
  unconditional safe default. **Agent (beta):** `buildMobInfo` passes the
  requesting character to all three fetches and its own mob-info cache is now
  zone-aware (`name|zoneId`) so a zone/target change re-resolves instead of
  serving a stale cross-zone catalog row; the two relay caches are keyed by
  `(target, requester)` so the scoped Mob Info fetch never collides with an
  unscoped caller. Old/stable agents send no `character` → bot fails open
  (unchanged behavior) until the fix graduates with the Mimic line. Decision
  covered by `test/target-info-zone.test.js` (source-sliced `_zoneScopeKeep` +
  the per-observation merge). See BETA-TESTING #141.
- **#142 Emperor tank-buster countdown (clear-on-death + re-arm + spawn pre-warn)
  & #143 ext-target MEZ/SLOW badges — DONE (2026-07-22, agent 3.4.3 beta; Mimic
  parked 2.0.2; web 1.0.264 roadmap/docs).**
  - **#142 timer behavior (the part the task scoped).** Re-arm was ALREADY
    correct — `_startTimer` keys `_activeTimers` by trigger-id (+ sorted-capture
    suffix), so a repeat fire on the same captures `set()`s the SAME id and
    RESETS the bar in place (never stacks a 2nd row); a no-capture-group regex
    → `captures={}` → id = baseId. **New capability: clear-on-death.** A general,
    ZERO-config `_cancelTimersOnMobDeath(line)` in
    `packages/wolfpack-logsync/index.js` drops every active timer whose `target`
    matches the mob a slain/death line names (grounded on parseEvent's own death
    forms: "…has been slain by …!", "You have slain …!", "… died."). Every armed
    timer already records the mob it's ABOUT in `target` (a capture, else the
    fight's `bossName`), so this needs no per-trigger setup — the automatic
    counterpart to a trigger's optional `end_early_pattern` (`_endRegex`, which
    already existed for the per-trigger case). Fail-open: `target == null` →
    natural expiry. Wired in the live tail next to `checkCharmPetDeath`. **#36
    builds on the re-arm + clear-on-death.**
  - **#142 DETECTION (folded in, high-value for tonight).** The imported guild
    trigger's `.*tank ?buster` regex CANNOT fire — the buster is **Rage of
    Ssraeshza (spell 2310)**: instant 0s cast, NO cast/land chat text (grounded
    from `eqemu_spells`: SPA 11 base 10 = −90% attack speed + SPA 79 base −4000 =
    a ~4000 non-melee hit; detrimental, single-target, mob spell). So detection
    moved to a pure **log-line** signal (EQLogParser-style, per-client, no Zeal /
    no relay): a data-driven `BOSS_SPAWN_CHAINS` table drives (1) **Blood of
    Ssraeshza death → 2:00 Emperor spawn countdown** with a 10s-out "Paladin DA
    NOW" pre-warn (the DA-the-spawn-buster window), (2) the **~4000 non-melee
    damage line from Emperor Ssraeshza** → "TANK BUSTER" callout + (re)arm of the
    60s cadence countdown (`_checkTankBuster` reuses `parseEvent`'s attacker/
    amount; gated on the line's non-melee marker so a same-size melee swing can't
    false-fire; accepts attacker=boss OR the passive unattributed non-melee form
    while that boss is the active fight; 8s echo guard), (3) Emperor death clears
    it via `_cancelTimersOnMobDeath`. Callouts ride `_pushOverlay`
    (the `_announceRampage` precedent); timers ride `_startTimer` with
    `target=boss`. Cadence is **60s** (guild-lead corrected the trigger's 55s
    placeholder). Regex field-verify of the imported trigger is Hitya's live step
    and is now moot for firing (the code detector is the signal); the imported
    trigger's text/regex was NOT touched.
  - **#143 MEZ/SLOW badges.** Pure DISPLAY classification in `apps/mimic/
    extarget.html` over the debuff names each row already carries — no new upload,
    no bot/agent proxy change. SLOW mirrors the agent's `SLOW_SPELLS` (#105) +
    `Rage of Ssraeshza` (added to the agent list too, so both stay in sync);
    MEZ is the **SPA-31 Mesmerize family grounded from `eqemu_spells`**
    (Mesmerize/Mesmerization/Enthrall/Dazzle/Rapture/Fascination/Glamour of
    Kintaz + the bard mez songs Kelin's Lucid Lullaby / Lullaby of Morell +
    Ancient: Eternal Rapture / Lullaby of Shadow). The Lull/Pacify/Soothe/Calm
    family is SPA 30 (aggro-reduction, `good_effect=1`) — deliberately NOT badged
    as mez. Bright pill next to the name (MEZ purple, SLOW amber); both show when
    both; clears the instant the debuff falls off (byte-stable HTML). **#130
    (highest-slow override) is the follow-up** — v1 is just the badge. Note: the
    buster debuff lands on the TANK (a player row, hidden by default), so it
    badges the Emperor's tank when players are shown, not the Emperor.
  - Fixtures (scratchpad, not committed) through the REAL code: Feature A 18/18
    (attributed + passive arm, repeat resets not stacks, 8s echo guard, melee
    ≠ buster, Emperor death clears, unknown death → survives, Blood→2:00 spawn
    pre-warn, "You died." ignored); Feature B 12/12 (SLOW/MEZ/both/neither/empty,
    backtick normalize, Rage of Ssraeshza=SLOW, Pacify=neither). See
    BETA-TESTING #142/#143.
- **Data-integrity bug round — DONE (2026-07-22, bot 3.0.225 on main).**
  - **#138 OpenDKP upsert 500s (silent bid/loot loss).** Every sync, the
    `opendkp_auction_bids` and `opendkp_loot` upserts 500'd with PG **21000**
    ("ON CONFLICT DO UPDATE command cannot affect row a second time") whenever
    OpenDKP's own batch carried ≥2 rows sharing the conflict key — so the WHOLE
    batch silently never mirrored. New pure `dedupByConflictKey` in
    `utils/openDkpSync.js` collapses each batch to one row per exact arbiter key
    (bids `auction_id,character_name,value` plain/NULLS-DISTINCT; loot
    `raid_id,game_item_id,character_name,dkp` NULLS-NOT-DISTINCT) before the
    upsert, at all three sites (`syncAuctions` inline bids, `syncRaidDetail`
    loot, `reconcileRecentLoot` loot); logs a dropped-dupe count when it fires.
    Verified live vs `zhtoekwakucbckvatfky`: raw colliding batch → 21000,
    deduped batch → OK. **Likely unblocks #124's sparse runner-up/2nd-place bid
    data** (only 408/13183 auctions had ≥2 bids because colliding bid batches
    were being dropped). Note: dead `syncAuctionBids` (unexported, uncalled)
    already had its own dedup — left as-is.
  - **#134 Discord auto-parse death over-count.** The card SUMMED each parser's
    sighting of the same death ("Melting ×3" when 3 parsers each saw it once).
    Ported the web page's dedup+suppress (`web/app/parses/[id]/page.tsx` ~369-418)
    into a shared pure `utils/parseDeaths.js` (`dedupParseDeaths`): accumulate
    raw per-contributor sightings on the card, derive counted display rows via
    name+ts 30s-window dedup + phantom-name suppression. Discord now matches the
    website.
  - **#139 spell-catalog `undefined 'expansion'` 500.** Root cause was NOT a bad
    data row — the handler called `isPopLocked()` with no boss, dereferencing
    `boss.expansion` on undefined and throwing before the row loop, 500-ing the
    ENTIRE catalog endpoint. Added `isPopEraLocked()` (global era check) in
    `utils/config.js` for the level-cap call site, and made `isPopLocked` null-safe.
  - Tests: `test/opendkp-upsert-dedup.test.js`, `test/parse-deaths-dedup.test.js`,
    `test/pop-lock-guard.test.js` (real-import tier).
- **#101 local log replay through the real trigger pipeline — DONE (2026-07-20,
  agent 3.4.1 beta + web 1.0.260 on main; root untouched).** Guild-lead ask:
  "a local walk of log files given a timeframe or a specific fight — TTS testing
  with that timeline; a link back from the main site." Ships:
  1. **Replay engine** (`packages/wolfpack-logsync/index.js`): `startReplay` /
     `stopReplay` / `_replayEvaluateLine` / `_replayWorker`. Reuses the `--since`
     file walker (`readFromBytePos` from byte 0, early-stop past the window) +
     `parseEqTimestamp` + `triggerVisibleLine` (the live tail's trigger gate).
     Each matched line drives the REAL pipeline as a **rehearsal** — the #76
     `test=true` contract is the law: `_fireTriggerActions(..., test=true)` so
     **nothing** uploads / relays / touches `_fireLog`/timeline; the real
     cooldown map (`_triggerLastFire`) is **never** written (replay keeps its
     own ephemeral cooldown map so the walk still sounds faithful); charm-pet
     suppression enforced like live. Every fire journalled with a **`replay`**
     marker (⏪ REPLAY badge) + `overlay.replay`/`overlay.rehearsal` so the
     Mimic overlay tags it ⏪ and never mistakes it for a live callout.
  2. **Two paces:** `real` (timestamp-faithful, gaps capped at 6s so lulls
     compress) and `fast` (fixed ~550ms pause after each fire for a quick audit).
     **Single-instance** (second start refused), and **refused during a live
     fight** (reuses the update-gate fight signal, `_liveFightActive`).
  3. **Dashboard** (Triggers tab): byte-stable ⏪ Replay card (log picker from
     watched logs, from/to datetime inputs, pace toggle, Start) + isolated
     `#wpReplayStatus` volatile placeholder (progress + Stop + results/journal
     link). Routes `POST /api/replay/{start,stop}`; status on `/api/state`.
  4. **Deep-link:** `#replay&from=<iso>&to=<iso>` opens the Triggers tab and
     prefills the form (no auto-start).
  5. **Site link-back** (`web/app/parses/[id]/page.tsx`): subtle "⏪ Replay this
     fight locally" link building the dashboard URL from the encounter's real
     start/end (±30s pad). **Port truth:** agent default is **7777**, but Mimic
     (the build with the overlays + TTS replay targets) serves on **7779** —
     the web link uses 7779.
  Verified: node --check + check:dashboard + a scratchpad fixture (2 matching
  lines fire as rehearsal, journal rows carry the replay marker, `_fireLog`
  unchanged, no upload enqueued, real cooldown map untouched, 2nd replay
  refused while one runs). Main gate green (lint/test/check:dashboard + web tsc).
- **Mimic 2.0.0 "Harmonic Howl" — stable graduation (2026-07-20).** The whole 1.9.6
  beta line (agents 3.3.81→3.3.100: callout trust + TTS root cause, loot
  bidding v1+v2, elections field round, Me card/Admin tab, /who enrichment,
  roll nights, timeline enrichment) cut to stable; beta re-parked at 2.0.1.
  Timeline slice test upgraded to also run the real `_matchDiscLine` (the
  graduation gate caught the sandbox gap — 275/275 after). Fleet safety nets
  for the shakedown: LKG crash-loop rollback, revert-to-stable, kill switches.
  Agent graduated to the **3.4.0** minor as the line marker (fleet hot-swaps
  via the manifest; installer carries 3.3.100-identical code). ⚠ DKP SEMANTIC
  (Hitya 2026-07-20, verbatim intent): OpenDKP keeps **ONE pooled DKP total
  per person, shared across all their characters** — "if Hitya and Canopy both
  show 100 next to their name, that means 100 total available for them to bid,
  NOT 200." The bidding panel must display ONE shared figure (never sum
  per-character displays), labeled as account-wide; verify the shipped
  mirror-derived family computation matches the OpenDKP UI number (board #124).
- **#124 Loot bidding shows the REAL pooled DKP (read from OpenDKP standings, not
  the mirror recompute) — DONE (2026-07-22, agent 3.4.2 beta; web 1.0.263 +
  docs on main). No DB change.** The panel's DKP was mirror-derived
  (`_familyDkpTotals` via bot `server-panel/bid-history`) and structurally can't
  reach OpenDKP's number: a fully-computed mirror cross-check (no `limit=3000`
  truncation) puts Hitya's family at **−125** (main-only, GetSummary-style) /
  **+858** (family-sum) while the OpenDKP standings show **171** — none of the
  mirror numbers can equal it. Fix: the agent reads OpenDKP's OWN standings
  (`GET /clients/{name}/dkp` — the hosted route for the GetSummary lambda, legacy
  `/beta/dkp`; falls back to `/summary`) with the Cognito IdToken the #108 login
  already holds (the bot reaches OpenDKP purely via Bearer — `OPENDKP_CLIENT_ID`
  is unset in prod — so the agent has identical read capability, no extra
  credential, and no browser CORS since it's a server-side Node call).
  `_pickAccountDkp` (pure, source-sliced test) returns the account figure = the
  `CurrentDKP` on the **main's** standings row (OpenDKP shows ONE pooled total per
  account — display it, never sum; matches the ⚠ DKP SEMANTIC above). New agent
  route `GET /api/loot/dkp?main=&characters=`; panel renders
  "💰 <n> DKP · account (OpenDKP)" and keeps the mirror figure only as a labeled
  "~est. (mirror)" fallback when the authed number is unavailable. **171 match =
  FIELD-VERIFY** — this cloud env can't egress to `api.opendkp.com` (403 CONNECT
  tunnel); endpoint + response shape grounded against `Moncleared/OpenDKPLambdas`
  GetSummary (`SummaryModel.Models[].CurrentDKP`) + `utils/opendkp.js` + the
  Supabase mirror cross-check above. Secondary (noted, NOT fixed): the "bidding
  as" family picker is still MODE-guessed (`opendkp_character_id_to_name` empty) —
  reading DKP direct moots it for the balance, but the picker can still list wrong
  bid-able characters.
- **#121 Loot Bidding v2 + buff-queue class-picker defaults — DONE (2026-07-19,
  agent 3.3.100 beta + bot 3.0.221 on main + web 1.0.252 roadmap/docs; Mimic
  parked 1.9.6). No DB change (mirror reads only).** Field feedback from the
  guild lead (OpenDKP user `vaporjesus`, family main `Hitya`).
  1. **404 bug fixed:** wishlist/win item names carried `class=name`, so the
     dashboard's /character click-delegation opened `/character/<first-word>`
     ("Timestone Adorned Ring" → `/character/Timestone` → 404). Item names now
     link to the associated **OpenDKP raid page** (`{client}.opendkp.com/#/raids/<raid_id>`)
     when known, else a plain non-clickable span — no dead links.
  2. **Wishlist = bid-on-but-NOT-won:** the bot prunes any item the family has
     won (via `opendkp_loot` names ∪ `opendkp_auctions.winner_character_id`);
     explicit preregs stay ★.
  3–4. **RECENT MISSES, full-width:** items bid on and lost, with columns
     *character · that char's last bid · last winning bid · last second-place
     bid · planned next bid (editable, persisted locally in
     `logsync.plannedbids.json`) · DKP*. Winning/second figures are from the
     item's MOST-RECENT auction (`_lootItemSummary`), not the specific loss.
     The 6-column shape (incl. current-DKP) is the proposed-but-unconfirmed
     layout — **adjustable**.
  5. **Bid/item rows deep-link** to the OpenDKP raid that carries the auction.
     **Grounding:** OpenDKP has no per-auction URL; the confirmed member-facing
     route is `#/raids/<id>` (roster.js/register.js/admin-queue.ts +
     `.env.example`), and every auction carries `raid_id` (FK → `opendkp_raids`).
  6. **DKP source shipped = mirror-computed, FAMILY-POOLED** (`ticks.value` where
     name ∈ `attendees[]` + `adjustments.raw.Value` − `loot.dkp`), labelled with
     freshness (`max(fetched_at)`). **Grounding:** there is NO characters-balance
     mirror; and OpenDKP links alts to a shared pool — per-character is
     misleading (main `Hitya` computes to −125 while the family nets +860), so we
     ship the family sum (the balance you actually bid against). **Adjustable**;
     officers verify vs the OpenDKP UI in BETA.
  7. **Family auto-prefill after login:** `suggested_family` (main = most auction
     wins) prefills main + raid alts ONLY when the local family is empty; the
     manual editor stays. **Grounding:** the mirror stores the account login
     (`vaporjesus`) as `winner`/`character_name` and `character_id_to_name` is
     EMPTY, so names resolve by MODE over the won-auction↔loot join
     (`108064→Hitya`, `100899→Melting`, `94318→Canopy`, …).
  8. **Expansion filter + full-width panel:** item→zone is too weak
     (`eqemu_npc_types.zone_short` is NULL), so era comes from the OpenDKP DKP
     **pool** (`opendkp_raids.pool_name` → Classic/Kunark/Velious(SoV)/Luclin(SoL)),
     mapped per item from its most-recent auction. Panel is now `card wide`.
  - **Buff-queue class picker:** now lists ALL casters (added Necromancer,
    Wizard, Shadow Knight — CLR DRU SHM ENC MAG NEC WIZ BST BRD PAL RNG SK) and
    defaults to the user's own class (`/api/state.activeCharacterClass`,
    falls to "(any class)" when unknown; an explicit pick always wins).
  - Bot pure helpers (`_resolveCharIdNames`/`_suggestFamily`/`_pruneWonWishlist`/
    `_eraFromPool`/`_buildMisses`/`_familyDkpTotals`) are source-sliced +
    vitest-covered in `test/loot-bidding.test.js` (20 tests). See BETA-TESTING #121.
- **#119 pet buffs STILL missing (post-#117 field report) + liveness/identity
  across watched logs — DONE (2026-07-19, agent 3.3.99 beta + bot 3.0.220 on
  main). No DB change.**
  1. **Version truth (Half 1):** the reporter's fleet row was agent **3.3.91**,
     BELOW the **3.3.94** #117 fix — a 3.3.91 runtime shows EXACTLY the reported
     symptom (a summoned pet's HP, no buffs), so the user was **pre-fix**. The
     resolver is NOT broken. Catalog truth: "Kabn's body pulses with an avian
     spirit." = **Spirit of Eagle** (`eqemu_spells` 2517, dur 600, formula 3,
     targettype 5 — single-target; the group Flight of Eagles 3185 is targettype
     41). "looks stronger." is shared by **15** catalog spells (Girdle of Karana
     720 … Storm Strength 540 …), but `resolveSelfCastLanding` disambiguates by
     the **cast spell name** (`rc.spellLower`), NOT the shared landing text, so
     the chosen spell + duration are right (Storm Strength → 540 ticks, not
     Girdle's 720). Girdle + Spirit of Eagle accumulate without overwriting.
     **No resolver fix was needed** — the extended #117 fixture proves the
     current beta handles both lines. Deliverable is verification tooling: a
     **🐾 Pet-buff diagnostic card** (Triggers tab, the `wpCharmDiag` pattern)
     walking the five checkpoints (pet identified → cast seen → landing resolved
     → attributed → overlay fetch) plus a resolution ring (which resolver,
     attributed/dropped + why), so the next field report is self-evident.
  2. **Liveness across watched logs + live-character identity (Half 2):** the
     agent heartbeat's `last_line_ms` is now the **MIN age across EVERY watched
     log** (any live log = a live agent — a player on a live alt whose primary is
     logged out stays fresh; an agent with NO active log anywhere still goes
     stale, so the #112 logged-out-reporter protection is unchanged), and it
     reports **`live_character`** (the most-recently-active watched char, null
     when idle). The bot stores it and: the 📡 Reporters fleet CHARACTER column
     shows "**Alt (Main)**" ("Canopy (Hitya)") when the live char differs from
     the main, the primary alone when idle; the /who **🐺** keys on
     `live_character` AND primary, so playing an alt lights the wolf on the toon
     actually online. The parenthetical obeys the SAME server-side
     `hide_main_names` rule as #111. Election ROLE ownership stays keyed to the
     agent (`discord_id`) — this is display/liveness only, not an election
     re-key. See BETA-TESTING #119.
- **#120 three raid-night field reports — DONE (2026-07-19, agent 3.3.98 beta;
  Mimic parked 1.9.6; web 1.0.251 roadmap/docs). No bot/DB change.**
  1. **CRITICAL — trigger TTS silent, NO Mimic entry in the Windows volume
     mixer.** *Proven in-container:* dispatch is fully intact — suggested
     templates materialize a `text_overlay` action that carries `tts` (or the
     overlay falls back to `speak(text)`; `recentTriggerFires` maps
     `tts:(o.tts||o.text)`), so "templates lack a tts action" is **ruled out**.
     The whole path reaches `speechSynthesis.speak()` in `triggers.html`.
     *Best-evidence root cause (Windows-only, NOT reproducible in the Linux
     container — needs field confirmation):* the trigger overlay is a passive,
     never-clicked window, so Chromium's **user-activation gate** silently drops
     `speechSynthesis` (and `HTMLMediaElement.play()`) — exactly matching "no
     audio stream ever opened → no mixer session." **Fix (two complementary,
     both one-liners in `apps/mimic/main.js`):** (a) `app.commandLine.appendSwitch
     ('autoplay-policy','no-user-gesture-required')` before `whenReady`; (b) grant
     the trigger document a synthetic gesture via `webContents.executeJavaScript
     ('void 0', true)` on `ready-to-show`. **Instrumentation (verifiable in
     field):** the #76 journal only recorded checkpoint 5 "dispatched", which
     could NOT distinguish dispatch from playback. Added **checkpoint 5b
     (`TJ.PLAYBACK`)**: `triggers.html speak()` now attaches `onstart`/`onerror`
     + a 2s silence timeout and POSTs the outcome to a new
     `POST /api/triggers/playback`, journalled green "playback started" /
     orange "playback FAILED (not-allowed/silent)". Rehearse (#76) runs the same
     `speak()` path, so a silent machine fails loudly at rehearsal, not mid-raid.
  2. **Triggers tab flashed every poll.** *Proven in-container* via a two-idle-
     render byte-compare fixture: the inline "⚡ Recent fires" card carried
     per-poll `fmtAgo`, so the section string differed every 2s → full rewrite
     (guild table + editor remount). Moved to its own `#wpRecentFires`
     placeholder + `renderRecentFires()` (same isolation pattern as
     `wpTriggerJournal`/`wpZealCard`). Fixture now shows the `triggers` section
     (and header/tanks/deeps/overlays/info) **byte-identical** across two 2s-apart
     idle polls; only the isolated `wp*` cards repaint. Also dropped a stray
     `class="name"` on the trigger-name cell (the character-link 404 trap).
  3. **"Not signed in to Discord" banner flashed at signed-in users.** *Proven
     in-container by tracing:* `mimicSignedIn` required token **AND** bot-confirmed
     identity, so the agent-restart startup gap (token-less until Mimic re-pushes)
     and any identity blip flashed the red banner; the intended "verifying" chip
     branch was dead code (keyed on the identity-requiring flag). Added
     `mimicHasToken` + `mimicSignedOutMs` (grace clock seeded at boot, reset on
     `/api/mimic-session`); the header shows the red banner only after the
     no-token state is sustained ≥8s, a calm blue **"Verifying…"** note when a
     token is present but identity is unconfirmed, and the chip branch now keys on
     `mimicHasToken`. See BETA-TESTING #120.
- **#82 Quartermaster v1 (utility-kit coverage + quest checklist) — DONE
  (2026-07-19, web 1.0.259 on main).** Web + one SQL seed, no bot/agent/Mimic
  change. New member-visible **`/quartermaster`** page, two boards, both off
  data we already collect; opt-outs (`exclude_inventory`/`exclude_from_stats`)
  honored everywhere, visible-ownership-only caveat stated on the page.
  - **Board 1 — utility-kit coverage.** Pure lib `web/lib/quartermaster.ts`
    (`KIT_CATALOG` + `computeKitCoverage`): a data-driven catalog of **13
    grounded** raid-mover items (adding one is a one-line push), each verified
    against the live catalog with a real owner count — JBoots 71, Peg cloak 41,
    Manastone/Manarock 28, Regal Band of Bathezid 18, Divine Aura clickies 18,
    Eyepatch of Plunder 16, Shield of the Immaculate 13, Larrikan's Mask 13,
    Puppet Strings 11, Dain IV 9, Velium Vapors 9, Rod of Mystical
    Transvergance 5, Water Sprinkler 5. Reads `character_gear` (equipped+bag) ×
    `eqemu_items` by id; per entry: distinct-owner dedup (family main resolved
    via `main_name_override`→`main_name`→name), owner list, and a plain gap line
    (`Nobody owns X` / class-scoped `No Cleric owns X`, level-title folded).
  - **Board 2 — common-quest checklist.** **REUSES the existing quest tracker**
    (`quest_catalog` + `quest_required_item` + `character_inventory`, officer-
    edited at `/admin/quests`) — a new `quartermaster_quests` table would have
    duplicated it, so instead the page adds two NEW views over that store:
    a member "your characters × quests" matrix and an officer "who's missing
    what" rollup (roster-rank predicate; 18 raiders have inventory). Step match
    is pure (`computeQuestProgress`): item-id preferred, name+qty fallback,
    label-only → unknown (—). **Honesty boundary:** detection is VISIBLE bags
    only — a turned-in / banked piece reads "not seen", not "never had". Seed:
    migration `20260719160000` inserts the **Emperor Ssraeshza key (Diaku
    Emblem)** chain (4× `Quarter of a Diaku Emblem` 29216–29219 → `Completed
    Diaku Emblem` 29215, all verified real) as an officer-editable starting
    point. Tests: `test/quartermaster.test.js` (14 — kit dedup/gaps/class-fold,
    step id/name/qty/unknown, completion rollup). **Follow-ups:** no manual
    check-off UI for un-seeable steps; could wire `inferred_keys_for_character`
    so a completed-but-consumed key reads ✓ instead of "not seen".
  - **⚠ Flagged, not fixed (out of scope):** `npm run lint` is pre-existing-RED
    on main — `index.js:8863` uses `new EmbedBuilder()` with no local/top-level
    require (Harmonic Howl announce fn, bot 3.0.222). Genuine runtime
    ReferenceError on next bot restart; needs a bot hotfix, untouched here.
  - **⚠ Board 1 narrowed to the viewer (web 1.1.55, 2026-08-14).** Hitya:
    *"quartermaster should display raider information for that user not for
    everyone. it can display for everyone for admins."* As shipped, Board 1
    named **every** owner of every kit item to **every** signed-in member — a
    browsable who-owns-what of the whole guild, which is more than a member
    needs to answer their own question and more than anyone asked to publish.
    Board 2 was already scoped (own characters up top, officer rollup gated);
    Board 1 was the outlier. Now `scopeKitCoverage(coverage, ownNamesLower,
    officer)` runs after assembly: officer → the full list, member → their own
    characters only, with an explicit *"None of your characters — 11 in the
    guild have one"* line so a blank card doesn't read as a bug.
    **The guild-wide count deliberately survives**: it is a nameless aggregate
    (the ANON tier in the visibility policy) and it is the whole reason a member
    opens the board — without it they cannot tell a real coverage gap from their
    own blind spot. Six tests in `test/quartermaster.test.js`, one of which
    serializes the scoped row and asserts no outsider's name appears **anywhere**
    in it, so a future name-carrying field fails there rather than in production.
- **Fight Cards v1 — SHIPPED (web 1.1.61, 2026-08-16, task #43 on Hitya's
  "continue with the bits for 75").** `/raid/plan`: one pre-raid readiness
  card per fight — officer-authored comp/kit/tactics text, callouts resolved
  LIVE against `guild_triggers` by id (✓ armed / ○ denoted / ⚠ MISSING —
  missing dominates the header chip; the card stores links, never copies).
  Officers author inline on the page; migration `20260816174500_fight_cards`
  applied + committed; 9 resolver tests. Seeded 8 draft cards for the
  3-night program (Tunares, four warders, Arbiter, Vulak) from the
  raid-watch content — all editable, `updated_by='pre-raid seed'`. Next
  increment (in `DESIGN-fight-cards.md`): comp/kit live joins (#93/#82),
  the Discord pre-pull projection (bot, post-freeze), drill result on-page.
- **Overlay scale 50%–200% (mimic + agent 3.5.88, beta, 2026-08-18/19 —
  Fittir's 5K monitor, via Hitya).** zoomFactor per overlay window, hooked
  into applyOverlayOpacity's shared ready-to-show lifecycle (zero per-HTML
  changes; future overlays inherit it). v1 was a Settings-only global
  slider; Hitya corrected the placement same night ("It should be a slider
  on the overlays page and one on each individual one" — he was also on
  beta.8, which predates the whole feature). Now THREE surfaces: 🔍 "Size —
  all overlays" on the dashboard Overlays tab (drives the same
  cfg.overlayScale global), a per-overlay "size" slider injected by
  preload into every overlay's setup bar (cfg.overlayScaleByKey override,
  key resolved main-side from the sender window; ↺ = follow the global
  again, % label shows "(all)" while following), and the original Settings
  slider. Dock panes deliberately skip the injected slider (one window —
  it would scale every pane). overlay-auto-height + ensure-min-height now
  multiply CSS px by the window's zoomFactor so scaled overlays don't clip
  or lose their right-click menu. **Round 2 (agent 3.5.89, same day, from
  Hitya's live beta.9 testing):** a scale change now resizes the WINDOW
  BOUNDS with the zoom (center-anchored, work-area clamped, ~180ms
  ease-out glide — zoom in a fixed box left card edges/centering wrong);
  sliders apply on RELEASE (mid-drag apply rescaled the setup bar under
  the cursor; per-input apply re-zoomed everything dozens of times per
  drag) with a "Smooth slider" live-follow checkbox under the dashboard
  bar (`cfg.overlayScaleLive`; rapid sets <300ms apart apply direct, no
  glide); applyOverlayScale keeps per-window state and no-ops on
  unchanged targets (beta.9 re-zoomed on every opacity/status broadcast —
  visible repaint churn); **dock-auto-height now does the same CSS→painted
  conversion** (unconverted, the dock's 1s fit loop disagreed with the
  painted size at 130% → rapid grow/shrink); the injected setup-bar size
  controls sit on their own full-width row (inline they wrapped narrow
  overlays into a jumble). Boot still sets zoom only — persisted bounds
  were saved at that scale; resizing at ready-to-show would compound.
  **Round 3 (agent 3.5.90, same day, beta.11 feedback):** the setup bar
  no longer scales with the overlay — main mirrors the live zoom into the
  page (`wp-zoom` → `--wp-zoom`) and preload CSS counter-zooms the bar
  (`width × z` then `scale(1/z)`), so it keeps ONE painted size spanning
  the window width at any scale (200% made it enormous, 50% unreadable);
  drag controls get the same treatment and park below it. "Smooth slider"
  now IS the glide and defaults ON (`cfg.overlayScaleGlide`; off = snap)
  — the live-follow mode it used to toggle is gone, it's what made the
  label read backwards (Hitya: "being off to glide doesn't make sense").
  The dock sits OUT of the global scale by default (`overlayScaleFor`
  returns 1.0 for `dock` unless `cfg.overlayScaleDock`; "Scale the dock
  too" checkbox re-applies on toggle). Beta test: setup bars one readable
  size at 50% and 200%; smooth checkbox pre-checked; dock ignores the
  slider until its checkbox is on.
- **Guide high-MR warning corrected (web 1.1.76, 2026-08-19 — Hitya, on
  the Emperor Ssraeshza guide: "Tash is unresistable. Same with Malo.
  Slow is a disease slow").** The Catalog card's MR≥500 warning claimed
  tash/slows/charms are all resisted and said "do not plan around a
  slow". Mirror-corroborated facts now baked in: the Tash line + top-rank
  Malo/Mala are `resist_type 0` (unresistable) and still land; the lesser
  Malosi/Malosini ARE magic and bounce; the slow that lands on high-MR
  mobs is the disease-based Plague of Insects (`resist_type 5`), checked
  against DR — the warning now branches on DR (<500 → "the disease slow
  is the play, checks DR N"; ≥500 → "plan without a slow"). General
  logic, not an Emperor override — applies to every high-MR guide page.
- **✨ smoOOTH SCAlers — Mimic 2.5.4 STABLE (agent 3.5.91), 2026-08-19.**
  Hitya named it and called the graduation same-day ("lets roll the
  resizing update into main in a fun way"); the name renders its own size
  wave as a case-wave on every text surface. The whole 2.5.4 beta line
  went to the fleet: overlay size sliders ×3 surfaces + glide + counter-
  zoomed setup chrome, dock v2 (intrinsic sizing, named layouts + rename,
  Setup-THIS, pane reorder + ◢ corner-resize), tray→dashboard parity
  batch (per-character layouts card, lock/setup/hide-all, dock row),
  hide-all heal, melody AE pulse fix + kite chips, eye-of filter.
  File-level promotion of apps/mimic/** + packages/wolfpack-logsync/** +
  their 12 test files (the exact beta↔main diff — zero drift, sync-beta
  working). Beta re-parked at 2.5.5. ⚠ The first cut NO-OPPED GREEN:
  release-mimic.yml compared the version HEAD~1 vs HEAD, and the two-commit
  push (bump + docs) read "unchanged" — no release, successful run. Fixed
  same hour (HEAD~1 check removed; tag-existence guard is the idempotency)
  and the real v2.5.4 cut via workflow_dispatch, VERIFIED by fetching the
  release: tag exists, prerelease false, /releases/latest resolves to it.
  Lesson for monitors: a green release run is not a release — check the
  tag. Field-pass items that stay open:
  pane inner-✕ retest (Hitya), Fittir's 5K 200% hover-target check, the
  #52 parity-audit remainder, the #54 design-consistency pass.
- **Change time on a sent request (bot 3.1.58, 2026-08-19 — Hitya:
  Hawkner "can't change time").** The nudge flow's ✅ done card was
  one-shot (`components: []`) — Hawkner submitted "tomorrow 8pm ET",
  actually wanted 10:30pm ET after Thursday's alt raid, and had no way
  back. Now the done card carries **🕐 Change time** (requester-or-officer
  only): re-opens the time step in change mode (context =
  `officerMsgId:requesterId` riding the same `sugnudge_time/exact/modal`
  customIds; no "Different boss" in change mode) and the submit EDITS the
  posted Event Request card's Wanted-time field in place
  (`updateEventRequestTime` in `commands/suggest.js`;
  `postEventRequest` now returns the posted Message). A ≤92-char guard on
  the button id keeps every derived customId under Discord's 100 cap.
  Cards posted before 3.1.58 have no button — Hawkner's existing request
  needs a fresh tap-through (or an officer word). 2 tests added.
- **Seru Minis group event (bot 3.1.56/57, 2026-08-19 — Hitya, from
  Hawkner's thread).** The **four Praesertum** house leaders of Sanctus
  Seru — Bikun (NW, Shard of the Shoulder), Vantorus (SW, Hand), Rhugol
  (NE, Eye), Matpa (SE, Heart); roster corrected by Hitya ("they are these
  four") after a first pass wrongly fingered the city's 20-named office
  tier — are now a first-class suggest-flow EVENT (`GROUP_EVENTS` /
  `evt_seru_minis` in `utils/suggestNudge.js`): the nudge card detects
  "Seru Mini's"/"house leaders"/"praesertum" and offers **Seru Minis**
  ahead of the mis-detected Lord Inquisitor Seru, and the event leads the
  Luclin picker list (capped at 25 of 46 — an alphabetical merge would
  have sliced it out). Deliberately NOT in bosses.json — 18h respawns,
  untracked by design; the group is the event. Kills persist via the
  3.1.52 self-registration path. Full roster, per-mob ability kits
  (Bikun is UNSLOWABLE; Matpa the softest), 100% shard drops, and mirror
  caveats (parked ~19.7d spawn timers vs 18h live; quest "reports" absent
  from the dump): `docs/seru-minis.md`. Tests in
  `test/suggest-nudge.test.js`.
- **Dock v2a: Setup-THIS + named layouts + rename (mimic, beta,
  2026-08-19).** The dock NEVER entered setup state — its `onSetupMode`
  handler checked `p.on`/`p.setup`, names no sender ever used (every
  payload carries `active`). That's why "Setup THIS Overlay" looked dead
  AND panes couldn't be dragged (pane drag is body.setup-gated); what
  read as "editable during Setup ALL" was only the unlocked chrome.
  Fixed, plus the Done button now exits the mode that was entered
  (`setSetupModeThis` for scope 'this'). New: 💾 **named dock layouts** —
  save pane set + columns + spans + per-pane backgrounds under a name,
  load to swap the whole arrangement (dock-set semantics per key), delete
  from the list; **Rename dock** (title shows the user's name).
  `cfg.dockLayouts`/`cfg.dockName`, `dock-layout-save/load/delete` +
  `dock-rename` IPC, 💾 button beside ＋ Panes. The setup-chrome
  counter-zoom CSS is scoped `:has(#drag-controls)` so it can't restyle
  the dock's own setup bar or hide its only move handle. **Corner-drag
  pane resize shipped same day:** each pane gets a ◢ grip in setup — drag
  to stretch across columns/rows, snapping to whole grid cells (live
  preview, `dock-span` write on release, same 3×4 caps as the ≡ presets;
  the grip suppresses the reorder drag). **Remaining from #53:** pane
  inner-✕ needs Hitya's retest post-CSS-scoping; dock layouts on the
  dashboard rides the #52 parity audit.
- **Dock/setup bug batch (mimic, beta, 2026-08-19 — four field bugs from
  Hitya's dock deep-dive).** (1) Dock runaway growth: auto-fit measured
  `shell.scrollHeight` with `#shell{height:100%}` — at LEAST the viewport,
  so `want = winH + 10` sat a rounding coin-flip past the 8px hysteresis
  and crept +10px/s to the 1600 cap (machine-dependent, which is why it
  ran for weeks unseen; my zoom multiply amplified it at 130%). While
  auto-fit is on the shell is now intrinsic (`body.autofit #shell
  {height:auto}`) so the loop has a fixed point; empty dock collapses to
  its header. (2) Docking anything during Setup-ALL hid every force-shown
  overlay minus TTS: `applySetupMode` force-shows ONCE, and no
  `apply*Visibility` predicate had a setup term — any later pass re-hid
  flag-off overlays. `setupMode` now counts as unlocked in all 16
  predicates. (3) Setup-mode windows clipped their cards (~102px — CH
  chain "won't reveal anything", Zeal shrinking to type 3): `#wrap.
  scrollHeight` never included setup chrome; `overlay-auto-height` adds a
  constant painted allowance for in-setup senders. (4) Double move icons:
  corner ✥/✕ hide during setup (framed handle + Done own those jobs), and
  the counter-zoom setup CSS is scoped OUT of dock panes where the fixed
  bar covered pane controls. **Queued from the same feedback:** Dock v2
  (task #53 — Setup-THIS on the dock, pane drag + corner-resize spans,
  NAMED dock layouts with Save/Load, verify the pane inner ✕ after the CSS
  scoping fix) and the overlay design-consistency pass (task #54 — one
  plate/card system, honest 100% opacity; today 100% = opaque card
  SURFACES, the chrome around them differs per overlay by design drift).
- **Tray↔dashboard parity batch (agent 3.5.91 + mimic, beta, 2026-08-19).**
  New RULE (Hitya, now in CLAUDE.md): "Anything that's available from the
  taskbar should be available from the dashboard as well." Shipped: 💾
  Per-character overlay layouts card on the Overlays tab (auto-swap toggle,
  save-for-active-toon, saved chips + forget ✕ — `char-profiles-enable` /
  `char-profile-save` / `char-profile-forget` IPC, state on the status
  push); Lock/Unlock + Setup-mode + Hide-all buttons on the actions row
  (`hide-all-toggle` IPC + existing bridges); a Dock row in BUILT-IN
  OVERLAYS (Hitya: "Dock isn't available from the built in overlays
  page"). Plus `_healMootHideAll`: flags re-enabled one-by-one bypass
  `toggleHideAllOverlays`, leaving persisted `hideAllActive` + snapshot
  lying ("it says hideall is on but its not" / the "0 marked HIDDEN"
  banner) — cleared at the next status read when the snapshot has nothing
  left to restore. Diagnosed same session: "wireframe" overlays = the
  UNLOCKED state persisting (`overlaysLocked=false` force-shows every
  overlay), not a build difference. **TODO — parity audit remainder:**
  quiet mode, tells mode + DM pause, melody bard-only / AE-damage
  toggles, auto-arrange-on-show, start-with-Windows, check-for-updates
  are still tray-only; port in one pass.
- **/who class titles fold to base classes (bot 3.1.55, 2026-08-19 —
  Hitya: "Warlock on Anon", Syczlak).** who-lookup's Supabase passes
  (who_directory / characters) served stored class strings raw, and history
  harvested before agent-side normalization still holds EQ level titles.
  Now folded through `utils/classTitles.normalizeClass` at the serve
  boundary (one hunk covers all passes). `test/who-lookup-class-titles.test.js`
  also pins the bot map ↔ agent `CLASS_TITLES` mirror to each other — both
  files said "keep in sync", nothing enforced it. Web + /whois + agent
  parse were already normalized; this was the one raw hole.
- **Melody AE badge: pulse merge fix + kite damage totals (agent 3.5.88 +
  mimic, beta, 2026-08-19 — Fittir via Hitya).** Fittir's overlay read
  ⚔123/12 / ⚔152/12 — "it's adding the number of hits." Root cause: pulse
  bursts in noteSongAoeLine were bounded by wall-clock arrival, and the EQ
  client flushes the log in multi-second batches under swarm-kite load, so
  several 12-hit pulses arrive at once and merge. Bursts now clock off the
  LINE's own timestamp (SONG_AOE_PULSE_GAP_MS 1500ms: adjacent-second rows
  = one pulse, the next 3s pulse is ≥2s of stamp away). Plus the asked-for
  feature: the chip now shows per-hit damage for the last pulse ("52ea" /
  "48–61ea") and a Σ running total for the current kite per song (agent
  aoe_kite payload — resets after 30s quiet; pulses + duration in the
  tooltip). Toggleable: tray → Overlays → "Show AE song damage (per hit +
  kite total)", default ON (cfg.melodyDmgTotals, rides the status push
  like melodyBardOnly). test/song-aoe-pulse.test.js (source-slice, 8
  tests) covers the merge replay + kite math. Beta test: swarm kite,
  confirm the badge stays ≤12 and Σ climbs; toggle off hides both damage
  chips but keeps hits/12.
- **Spellbook "where from" + zone shopping list (web 1.1.67, 2026-08-18).**
  Hitya: the missing-spells page's PQDI links "don't work. We should say
  where it's from" + a shopping-list mode. Root enablement: the eqmac dump
  ALWAYS carried `npc_types.merchant_id` — the sync transform never picked
  it, which is why vendor→zone could not resolve (the page's old "we don't
  mirror the merchant chain" comment was stale doctrine). Column added +
  forced sync run (1,940 vendors linked); `spell_scroll_sources(int[])` RPC
  returns every vendor + dropper per scroll with spawn-table zones. Page:
  click any spell → who sells/drops it and where (PQDI demoted to a
  cross-check link, now with the www host that actually resolves); Expand
  all; 🛒 Shopping-list mode groups by ZONE with "only here" badges and
  must-visit zones sorted first; no-vendor spells listed separately.
  `web/lib/spellSources.ts` + 5 tests (the only-here rule: a spell's WHOLE
  vendor footprint in one zone, not merely sold-in-this-zone).
- **/admin/adoption — the PM product-health page (web 1.1.66, 2026-08-18).**
  Hitya: *"take your framing of the adoption bit as the PM and update the
  adoption page."* Players-not-characters throughout; three funnels kept
  separate (conversion / new-raider adoption / raid-night coverage). Tiles:
  WAU, 4-week retention, all-time activated, raided-never-uploaded. Sections:
  12-week WAU bars (current week flagged partial), activations by month split
  new-raider (joined ≤60d before first upload) vs converted-vet, raid-night
  corroboration (raid-window fights ONLY — off-night solo grinding measured
  at 183 Monday "fights" of 1.1 uploaders and excluded by design), fleet
  version in players, and THE WORK LIST: raided-30d-never-uploaded (the
  conversion targets), went-quiet churn, unlinked attendees → /admin/links.
  Blind-spots card states what is NOT measurable yet (sessions/hours, install
  funnel, feature usage) rather than hiding it. Data: two security_invoker
  views (`adoption_uploader_days`, `encounter_upload_counts` — migration
  20260819010500, applied + committed), read via selectAll; math in
  `web/lib/adoption.ts` (10 tests incl. the ET raid-night keying and the
  partial-week flag). Follow-ups queued in the page itself: agent_sessions
  roll-up, first-boot ping (privacy call: Hitya), feature telemetry.
- **Task #47 SHIPPED — self-healing encounter persistence (bot 3.1.52,
  2026-08-17).** The Final Arbiter P1's full root cause was TWO-layered: (1)
  first-time content had no `bosses_local` row (the allowlist refusal), and
  (2) **backfill uploads skip the bosses.json match by design** (replays must
  not re-arm timers) and slug the display name, which never equals a curated
  id — so even patched bosses could not be backfilled ('the_final_arbiter' ≠
  'final_arbiter'; Hitya's morning replay had Progenitor + Master of the
  Guard refused this way). `_resolveBossForPersist` now resolves curated id →
  slug → article-stripped slug → exact eqemu name match (reusing a curated
  row by npc_id) → self-registers genuinely new mobs; refusal remains only
  for names with no exact, unambiguous eqemu match (junk boss names). 10
  source-slice tests in `test/boss-persist-keys.test.js`. The old silent
  drop is structurally gone; the #42 sentinel invariant ("combat uploads
  arriving, zero encounters persisted") remains as the alarm layer.
- **⚠ Needs a local session — `dot_stacking_exempt` backfill (2026-08-16).**
  Hitya, from Partil's bug-reports post on Quarm's DoT stacking
  (buffstacking.cpp:654): the server carries a per-spell flag — 0 = the DoT
  stacks with itself across casters (Immolate), 1 = it does not (Breath of
  Ro) — and our mirror carries it NOWHERE (no column, no `raw` key; verified
  on both example spells). Consumers waiting on it: per-caster debuff
  instances on Mob Info (today a second caster's land overwrites the first)
  and task #44's per-tick math. Exact pull from the local peq MariaDB:
  `SELECT id, dot_stacking_exempt FROM spells_new;` → sync-proof addendum
  column (the eqemu_items backfill precedent). Spot-check vs PQDI at
  backfill time (PEQ data vs Quarm tuning); Immolate=0 / Breath of Ro=1 are
  the free test vectors. Details in `docs/DESIGN-mobinfo-dot-groups.md`.
- **Fight timeline list, round two — STAGED during the freeze (web 1.1.62,
  2026-08-16 ~20:00 ET, on `claude/sharp-lamport-dC0TW`; lands on main after
  00:30 ET).** Hitya reviewed `/parses/d951b081` mid-raid-prep: *"the
  timeline view was fine to have it just needed a better look"* + hide the
  too far/can't-see callouts + "so many ramp calls at 00:00 sounds wrong."
  Root causes measured: 67 of 126 events predate `started_at` (trash-merge
  spillover) and were clamped to 0:00 → now a collapsed "before this pull"
  section with signed offsets; the personal-range callout family is filtered
  (with a "N hidden" note); "(copy)" clones fold into their base and folding
  is windowed per-target so alternating rampages collapse. New pure module
  `web/lib/fightEvents.ts` + 11 tests pinned to that card's failure modes;
  browser-verified at phone width.
- **Parse page reshaped by Hitya's first-format review — DONE (web 1.1.60,
  2026-08-16).** Five asks on `/parses/4d0d6dd2` (the restless burrower), all
  shipped + harness-verified against that fight's real rows: the damage chart
  stacks BY CLASS with right-edge `class + %` labels; clicking a class drills
  into its characters with the same percentages ("everyone else" stays as one
  muted band so the top edge is still the whole HP-removed curve); hovering a
  chip/band/legend row highlights its region; the MT strip explains its gaps
  (1-bucket sampling holes bridged in `mainTankLane` — measured aliasing;
  REAL gaps get dashed hover rects — the 385s→end gap was the mob dealing
  zero damage while the raid kept hitting it, Hitya's "it ran" confirmed);
  and the FightTimeline marker chart on that page is replaced by
  `FightEventLog.tsx`, a collapsible list of deaths/events/callouts with
  names, ×N run-folding, and per-type dots (`/raid/review` keeps the marker
  chart). Future (denoted in `DESIGN-fight-timeline.md`): per-type/callout
  toggles — "many of these are probably personal to one character."
- **Boxing-language scrub — DONE (web 1.1.59 main + beta comment pass,
  2026-08-16).** Hitya: *"not boxing, these are characters that each of the
  players will play distinctly. It shouldn't ever be talked about in anything
  on the github either, unless we're specifically looking to suss out
  boxers."* Every guild-member reference to boxers/multiboxing reworded
  neutrally (multi-log / second watched log / a player's characters) across
  docs, web, bot comments, test names (main) and agent + Mimic comments
  (beta). Deliberately unchanged: `/pvp` (opposing players) and
  `/admin/anomalies` + its admin-index card (the explicit detection surface —
  Hitya's stated exception).
- **Kneel Test phantom — FIXED for real (agent 3.5.86 beta, 2026-08-16).**
  Hitya: *"for beta, I'm still seeing kneel test on the target info."* Server
  was clean (0 buff_casts rows — ingest filter works); the phantom was LOCAL:
  the junk-landing guard counted family size WITHIN each index, and of the 33
  catalog spells sharing "is struck by a sudden force." exactly one (Kneel
  Test — the only timed+detrimental member) survived the filters, so a family
  of ONE sailed under the >8 guard and was crowned on every Ssra knockback.
  Sharers are now counted across the whole CATALOG before filtering; the slow
  rescue is preserved; `test/kneel-test-guard.test.js` rehydrates the real
  builder and pins all three behaviors. DoT-grouping on Target Info designed
  in `docs/DESIGN-mobinfo-dot-groups.md` (task #44) — blocked finding: the
  spells mirror has NO class columns (eqmac dump omits them), so grouping
  keys on the observed CASTER's class, with a local-session spell-class
  backfill as enrichment.
- **U1 + U2 landed; Discord-projection ratified; advisor sweep — DONE (bot
  3.1.49 / web 1.1.58, 2026-08-16).** Hitya: *"do U1 and land the unique
  index"* + *"discord was a source of semi-truth. now it should just be a
  projection"* + *"let's start looking at the database read/write layers as
  that is complexity I have not designed in."*
  - **U2 → 0, pinned.** Migration `20260816041125_loot_award_unique`: 560
    dupes backed up (drop table after 2026-09-16) + deleted (10,321 → 9,761),
    `loot_observations_award_uniq` PARTIAL on `raid_id IS NOT NULL` + NULLS
    NOT DISTINCT — partial because chat_extracted/loot_command rows are DROP
    observations that must not collide across nights. Verified refusing a
    re-insert (23505). Fold + `/backfillopendkploot` now write
    `insertIgnoreDuplicates(…, {representation:true})` — re-runs are schema
    no-ops with honest counts. Task #39 closed.
  - **U1 structural.** One paginator per runtime (`utils/supabase.js
    selectAllPaged` / `web/lib/selectAll.ts`); `supabase-paged.ts` retired,
    its 4 call sites migrated; `test/db-read-discipline.test.js` enforces
    single-paginator + load-bearing properties + an **85-site ratchet** on
    `.limit(>1000)` (count may only shrink; priority order by measured table
    size in ARCHITECT doc Part II — admin-queue:477 on 342k-row chat_messages
    is worst).
  - **Advisor sweep, applied:** `rollup_threat_ranks` (SECURITY DEFINER,
    WRITES) was anon-executable — revoked (migrations
    `lock_down_definer_functions`, `rls_initplan_fix`); 4 per-row
    `auth.uid()` RLS policies → InitPlan; `search_path` pinned ×4. Remaining
    advisor items + full component review (Mimic overlay-parity gate, web env
    parity, post-deploy smoke, unindexed FKs) outlined in ARCHITECT Part II.
- **Architect's rebuild assessment — DONE docs (2026-08-16).**
  `docs/ARCHITECT-REBUILD-2026-08-16.md`, on Hitya's ask: rebuild from scratch
  knowing everything, name the first decision changed, split "couldn't have
  known" from "didn't want to know", and find the most over-/under-engineered
  things with what each costs. Headlines: **first change = durable state gets
  one home (Postgres), Discord becomes a projection** (roster.js predates the
  first Supabase migration by 24 days — the placements were right when made;
  keeping the pattern after 2026-05-25 was the choice). Most under-engineered:
  the DB read/write layer — three independently-written paginators, the
  1000-row cap biting twice, and 337 dup groups / 560 excess rows live in
  loot_observations (re-measured this morning). Most over-engineered: the
  never-armed budget_enforce_* half of #73 (bidCrypto runner-up); the Discord
  recovery machinery is explicitly NOT over-engineering but compensating
  complexity. Verdict: under-engineering costs ~an order of magnitude more
  (≈8–11h/fortnight documented vs sunk cost + zero claims). Three metrics
  proposed (U1 unpaged-read call sites → CI gate; U2 dup groups → 0 via #39's
  index; O1 enforce armed-days, review 2026-12-01) — task #41, needs Hitya.
  Also corrected CLAUDE.md's 2.2×-stale line counts (bot 17,706; agent 35,234).
- **Who else rolled — DONE web (1.1.57) / BETA Command Center (agent 3.5.85),
  2026-08-14.** Hitya: *"can we start having a drop-down to open up lower rolls
  on the page and see who else rolled? may make sense to have this and a
  dismiss button on the command center where this lives."* Both surfaces showed
  winners only; the losing rolls had been captured all along and simply were
  never rendered (`RollSession.rolls` on the web, `rolls[]` in the
  `/api/command-center` payload) — no data change needed on either side.
  - **Web** (`/rolls`): a native `<details>` in the Won-by cell, so the page
    stays a server component and the expansion survives JS being off. Shape
    comes from the pure `rollBreakdown()` in `web/lib/rolls.ts`.
  - **Command Center**: same expansion per row, plus a per-row **✕ dismiss**
    and a header **clear all**, so a resolved item leaves the card while the
    next one is still being rolled. Dismiss is session-scoped (unlike a
    collapsed section — "I'm done with this item" should not outlive the loot
    night) and both sets reconcile against each poll.
  - **Two rules this had to obey, both already written down and both easy to
    trip:** open/dismissed state lives in a JS store consulted at render, never
    in DOM state — `#content` is rebuilt every 1.5s so a native `<details>`
    would snap shut mid-distribution (the wpKeep lesson); and the controls are
    always drawn and merely dimmed rather than hover-revealed, because an
    element created under a stationary cursor never picks up `:hover`.
  - **Two calls that are easy to get wrong and are unit-tested:** a re-roll is
    KEPT and flagged (dropping it makes the list disagree with the roller
    count, and a high roll that lost with no reason given reads as a parser
    bug), and a winner is matched on name AND value **once** (name alone lights
    up that same player's losing re-roll).
  - Verified in headless Chromium on both surfaces — 15 checks on the overlay
    at its real width including that an open panel survives a repaint and picks
    up a roll landing while it is open, and 9 on the web markup built with the
    project's own Tailwind config, since `group-open:` variants only exist if
    Tailwind actually emitted them and a typecheck cannot tell you that.
- **Roll calls get their item name without a `|` — BETA (agent 3.5.84,
  2026-08-14).** Hitya, on the night's /rolls page: *"These rolls didn't get
  consolidated to loot in the website but did on here."* Eleven sessions, all
  **unlabeled roll**, LOOTED BY empty. Cause: `trackRollItemLine` opened with
  `if (line.indexOf('|') === -1) return;` and the caller had used commas.
  - **One missing label emptied TWO columns.** `attributeLoot()` starts
    `if (!session.item) return []` — the item name is the join key to
    `looted_items`, not just a caption. The loot was captured fine all along;
    two of the four Tears went to someone other than the roll winner, which is
    exactly the case that column exists for.
  - **The pipe rule matched the documented convention, not the used one.**
    45 days of `chat_messages` say four shapes occur and only pipes worked:
    commas, tier lists (`311 pick, 322 upgrade` = ONE item, three ranges), and
    bare `Atramentous Shield 333` — the last being the most common of all.
    `parseRollItemLine` now walks the numbers instead of splitting; the tier
    case falls out for free (the text between ranges is `pick,`, not an item).
  - **The guards came from a sweep, not from imagination.** Running the parser
    over every line within 20 min of a live roll set found four it would have
    mislabelled — *"I think we were randoming 100."*, *"You didn't even bid
    100."*, *"DI - Guts 100"*, *"Do a 777 if you want a Shield of the
    Immaculate"* — each minutes from a real 0-100/0-777 set. All four are now
    tests, and the sweep also caught two regressions the fixtures missed.
  - Also bounded the label lookup to 20 min (`ROLL_ITEM_LINK_MS`); the map is
    keyed by roll NUMBER and swept only past 200 entries, so an unbounded read
    let an 8pm label claim an 11pm 0-333 set.
  - Last night's four Tears backfilled via `roll_set_overrides` (additive,
    one DELETE to undo). ⚠ Graduate to stable with the next Mimic line.
- **#91 roll-loot review surface (remainder) — DONE end-to-end (2026-07-19,
  agent 3.3.97 beta + bot 3.0.219 + web 1.0.250 on main).** The capture half
  shipped a week ago (roll_sets since 3.3.78, Hot Dice PERFECT events since
  3.3.80). This completes the three original guild-lead asks:
  1. **Who-looted attribution.** The agent captures the character's OWN
     `--You have looted <item>.--` lines on the live tail (`trackLootedLine`,
     self-only in EQ so the looter is the log's character; the a/an article is
     stripped so the name lines up with the loot-link roll convention). Upload
     rides the durable queue as a new `looted` kind → `POST /api/agent/looted`,
     with the **same recency+high-water discipline as roll sets** (only events
     `< 30 min` old and past the HW mark upload) so `--since` backfill never
     re-posts old loots. Stored in a **NEW narrow `looted_items` table**
     (migration `20260719010000`, applied) rather than `loot_observations` —
     that table requires `item_id` AND `npc_name_lower` NOT NULL, and a looted
     line carries neither, so reuse would have meant faking columns. Upsert
     dedups on `(guild, looter_lower, item_name, looted_at)`.
  2. **Hot Dice NIGHT award.** The per-roll PERFECT event already fires; this
     adds the sibling `hot_dice_night` fun_event, computed on the midnight chain
     (`computeHotDiceNightAward` in `index.js`) over the ET-day-window's
     `roll_sets`. Pure decision in `utils/hotDiceNight.js`: merge multi-uploader
     rows → per-set winner (highest first-roll) → award the top winner iff their
     share of **contested** (≥2-roller) sets is **>20%** with a **≥5-set floor**.
     Idempotent: `event_ts` pinned to the night start so a re-run upserts the
     same fun_events row (unique `guild,event_type,caster,event_ts`).
  3. **Roll-night summary.** New member-gated **`/rolls`** page: per raid night,
     each roll session (item, range, rollers, winning roll), the LOOTED-BY name
     beside the winner when they differ, and Hot Dice callouts (perfects + the
     night crown). Merge/attribution logic is the pure `web/lib/rolls.ts`
     (tolerant item matcher: normalize + article-strip + substring + ≥2-token
     overlap; window join `[last−2min, last+10min]`). A 🎲 Hot Dice card also
     lands on `/fun` linking through. Tests: `test/roll-attribution.test.js`
     (matcher/merge/window join, real-imports `web/lib/rolls.ts`) +
     `test/hot-dice-night.test.js` (award math: >20%, floor, dedup,
     determinism/idempotency) — 20 assertions, all green. `roll_sets`/
     `looted_items` are **empty in prod** (no captured off-night raid yet), so
     the render was grounded against a representative fixture through the real
     lib. See BETA-TESTING #91.
- **#113 Extended Target same-zone-only option — DONE (2026-07-19, bot 3.0.218 on
  main + agent 3.3.96 beta; Mimic parked 1.9.6; web 1.0.249 docs).** Guild-lead
  ask: "we don't need to include other Mimics' targets when they're not in the
  same zone." **Layer chosen: bot-side** (`_handleAgentExtendedTarget` in
  `index.js`). Recon showed zone already lives on the bot (`character_live_state.
  zone_name`) and the endpoint *already* scoped every target to the requester's
  zone via `inScope` — but unconditionally, with a non-fail-open predicate
  (`=== scopeZone` dropped unknown-zone rows) and no toggle. The payload rows
  carry only the requester's `scopeZone`, never a per-uploader zone, so
  agent-side filtering would have needed the bot to attach per-row zones (NEW
  plumbing) — bot-side was the only layer where zone is already present. Change:
  the endpoint now reads a `same_zone` query param (absent/`1` → on = default;
  only `same_zone=0` disables), and the same-zone predicate is fail-open per row
  (a raider whose `zone_name` we can't resolve rides along instead of vanishing;
  my-zone-unknown → no scoping). Old agents send no param → unchanged
  (default-on) behavior. **Agent (beta):** a per-user pref `extSameZoneOnly`
  (default true) persisted in `logsync.optin.json`, a labeled checkbox in the
  dashboard Overlays tab ("Same-zone targets only (default on)"), and a
  `GET/POST /api/ext-pref` pair; `fetchExtendedTarget` appends `same_zone=0`
  only when the user turns it OFF, so the toggle takes effect within one proxy
  TTL, no restart. The overlay (`extarget.html`) needed no change — the bot
  serves the already-filtered list. Decision covered by
  `test/extended-target-zone.test.js` (source-sliced param parse + `inScope`
  predicate). See BETA-TESTING #113.
- **#118 in-console officer kill switches + Mimic version in the fleet table —
  DONE (2026-07-19, bot 3.0.217 on main + agent 3.3.95 beta; Mimic parked 1.9.6).**
  Guild-lead ask off live 📡 Reporters-panel screenshots: put the `/admin/overlays`
  🛑 kill switches inside Mimic (officers rarely have the web admin open mid-raid),
  and show the Mimic shell version next to the agent version in the fleet table.
  - **Bot (`flag-override` endpoint).** New `POST /api/agent/flag-override`
    (officer-gated, same `is_officer` gate as reporter-override #115) does the
    identical read-modify-write on `overlay_tuning.tuning` + local cache-bust, but
    accepts ONLY a WHITELISTED set of control-plane keys — `_FLAG_OVERRIDE_KEYS`:
    `flag_disable_reporter_election`, `dedup_chat`/`dedup_buffs`/`dedup_roster`,
    every `flag_shed_<kind>` enumerated live from `_SHED_KINDS`, `flag_raid_hold`
    (the "raid hold" toggle), `flag_agent_kill`, `flag_disable_budgets`, and
    `min_agent_ver_num`. Anything else (the free-form `ext_*`/`offheal_*`/`ch_*`
    knobs, and the `reporter_pin_*` strings) is rejected 400 — those stay web-only.
    Boolean flags are written LITERALLY (explicit `0`, never an omitted key, so
    `dedup_chat`-off persists); `min_agent_ver_num` is a floored int and `<=0`
    clears it. Whitelist + gate + value-semantics covered by
    `test/flag-override.test.js` (source-sliced from the real handler).
  - **Mimic 🛡 Admin tab (agent).** A byte-stable 🛑 Kill switches card renders
    every whitelisted flag as a labeled toggle showing its LIVE value (read from
    the tuning the agent already polls, `_overlayTuning`), mirroring the
    `/admin/overlays` copy. `flag_agent_kill` requires a typed confirm before the
    write ("pauses EVERY agent's uploads"); `min_agent_ver_num` is a number input.
    The whole card + its data are gated on `is_officer` (the #109/#115 gate) — a
    non-officer sees nothing. `dedup_chat` carries the incident hint (currently
    **0**; re-enable only once the fleet is on agent ≥3.3.91).
  - **Mimic version in the heartbeat + fleet table.** The reporter-poll heartbeat
    now carries `mimic_version` — sourced from `process.env.WOLFPACK_APP_VERSION`,
    which `apps/mimic/main.js` ALREADY passes at spawn (line 2028), so no Mimic
    change was needed; standalone Parser.bat agents report null. The bot stores it
    on the registry entry and includes it in `server-panel/reporters`; the fleet
    table's VER column now reads `agent/mimic` (e.g. `3.3.95/1.9.6`, or
    `3.3.95/—` for standalone). The LOG column also gained a legend explaining the
    last-log-line staleness signal + the fresh/stale dot. See BETA-TESTING #118.
- **#117 pet buffs on the Pet tracker (proven-cause fix) + advisory range awareness
  — DONE (2026-07-19, agent 3.3.94 beta + Mimic 1.9.6 beta; bot 3.0.216 + web
  1.0.248 on main).** Two halves.
  - **Half 1 — pet buffs weren't showing (PROVEN cause, two prior guesses were
    wrong).** Repro: Canopy (druid) casts **Girdle of Karana** on her summoned
    pet Kabn; the in-game pet window + Zeal show the buff, but the Mimic Pet
    tracker shows only Kabn's HP. The earlier clicky-path and charm-pet-
    misclassification theories were both wrong. **Real cause (fixture-proven,
    `test/pet-buff-landing.test.js`, source-sliced from the agent): Girdle of
    Karana is a single-target buff (`eqemu_spells` id 1557, `targettype 5`,
    `cast_on_other "looks stronger."`, `good_effect 1`, dur 720/formula 3) that
    matches NONE of the agent's `_TRACKED_BUFF_KEYWORDS`.** So `parseBuffLanding`
    can never index its landing message — the ONLY attribution path is
    `resolveSelfCastLanding`, and that path's `rc.target` guard **rejected the
    "Kabn looks stronger." land whenever the pet wasn't the caster's live Zeal
    target at cast time** (you buff yourself / keep the mob targeted, or the
    target moves on during the cast). Land dropped → `_petBuffLandings` empty →
    Pet tracker (which reads `petBuffsForOwner`) empty, even though the land is
    right there in the log and Kabn is provably our pet (Zeal slot 16). The
    fixture reproduces both: the WORKING path (pet targeted → buff shows) and the
    BUG (pet not the live target → empty). It also explains **#116's phantom
    "Girdle of Karana ×1 · 71:48" melody card** — 71:48 ≈ the 720-tick catalog
    max, i.e. the buff riding Canopy's OWN Zeal buff list into the bard melody
    overlay (already fixed separately in #116). **Fix (log-path, evidence-
    supported — NOT pipe-side, since the land IS in the log and resolves
    correctly): in `resolveSelfCastLanding`, when the resolved land names one of
    OUR OWN pets (`_petOwnerByName` → an owner == the observer), attribute it
    regardless of the stale live target.** We already know we cast that exact
    spell (matched by its `cast_on_other`); the strict guard stays for non-pet
    (bystander) targets, and `recordPetBuffLanding`'s own `_petOwnerByName` gate
    still blocks any non-pet leak. Residual gap (noted, not built): a buff cast
    on your pet by SOMEONE ELSE, or an untracked self-only cast with no pet land
    line, still relies on the /pet report path (`applyPetHealthLine`) — the
    honest pipe-side source when it's typed.
  - **Half 2 — position-based buff-range awareness (advisory, v1).** The Zeal
    pipe already surfaces each client's Position (`loc {x,y,z}` + heading) and
    `_zealState` carries it; it just never rode the live-state upload.
    **Plumbing:** agent now sends `loc_x/loc_y/loc_z` on `/api/agent/live-state`
    (rides the heartbeat, NOT the change signature — position churns on every
    step), the bot ingests them, and migration
    `20260718000000_add_position_to_character_live_state.sql` adds the three
    `real` columns (applied via MCP + committed identical). **Consumer:** the
    raid-buff-queue now flags a **SAME-ZONE** target beyond a named
    `BUFF_RANGE_UNITS = 200` heuristic from the requesting buffer as
    `out_of_range` — the buffqueue overlay dims the row + shows a 📍 chip, it is
    NOT removed. Pure helper `utils/range.js` (distance + threshold + fail-open),
    unit-tested (`test/range.test.js`). **Advisory everywhere:** positions are
    stale up to the heartbeat cadence and unknown position on either side FAILS
    OPEN (treated in range), so the wording is "likely out of range", never
    authoritative. **Follow-up (not built, needs new event plumbing):** the
    cross-client "likely missed (out of range) at land time" cue — `buff_casts`
    rows carry no positions, so a landing-time range comparison needs positions
    on the land event; filed rather than half-built. See BETA-TESTING #117.
- **#111 /who overlay enrichment — DONE (2026-07-19, bot 3.0.215 + web 1.0.247
  on main; agent 3.3.93 beta + who overlay in Mimic 1.9.6 beta).** The in-game
  /who overlay now (1) drops a 🐺 next to any raider running Mimic, (2) lines
  class and level into their own left-aligned columns instead of drifting ragged
  after the guild tag, (3) shows the level we know for a guildmate who's /anon
  (dimmed/italic, marking it as our-data not the game's), and (4) appends the
  main in parentheses for Wolf Pack alts, from `characters.main_name`.
  - **Enrichment surface (bot).** Extended the existing `GET
    /api/agent/who-lookup` idiom (not a new endpoint): the same de-anon response
    now also carries `{ main, mimic }` per name. `main` from a 60s-cached
    name→`main_name` map; `mimic` from the in-memory reporter registry
    (`_freshMimicPrimaries` — primaries whose heartbeat is within `REPORTER_TTL_MS`).
    Registered a `who_lookup` admission-control budget kind (120/min, GET,
    non-durable) and gated the route. The main/mimic merge is a pure, unit-tested
    helper `_assembleWhoEnrichment` (test/who-enrichment.test.js, source-slice tier).
  - **Hide-main mechanism = the `hide_main_names` tuning key** (comma-separated,
    case-insensitive) in `overlay_tuning.tuning` — the SAME string-tuning-key idiom
    #115 uses for `reporter_pin_*`/`reporter_extra_*` (same jsonb, same 60s cache,
    survives deploys, preserved by the /admin/overlays save passthrough). Chosen
    over a `characters.hide_main` column because it is **zero-migration** (rode
    tonight's beta with no schema change) and edited with no code release. Enforced
    SERVER-side: a hidden name never has a main emitted (matched by its own name OR
    its main's name, so listing either the alt or the main hides the link).
    **Seeded `hide_main_names = "Tildias,Serreth"`** via the Supabase MCP (both are
    alts — Tildias→Stupidrichard, Serreth→Peopleslayer — the explicit privacy
    exception). Editing the list today is an MCP/SQL update to that row (like the
    #115 pins before they got their Mimic panel); a dedicated officer input is the
    natural fast-follow.
  - **Mimic-detection limit (honest).** The reporter registry keys on
    `discord_id → { primary, … }`, where `primary` is the agent's reported
    `primary_character` (the `--character` box, else the first watched log). So the
    🐺 lands on a raider's **reported primary**, not necessarily the exact toon on
    screen: a member running Mimic while playing an ALT gets the wolf only when that
    alt IS the reported primary/watched character. N≥2 identities per agent aren't
    tracked. Fail-open throughout: bot unreachable → the overlay renders exactly as
    before (de-anon still served from the agent's local cache). See BETA-TESTING #111.
- **#116 overlay bug round — DONE (2026-07-19, agent 3.3.92 beta + web 1.0.246
  docs/roadmap).** Repro-first fixture round; also closes long-open #35.
  - **Spell Casting (melody overlay) stale card**: a stopped caster could
    linger forever as a frozen "stopped N ago" card with the buff-duration chip
    and a doubled frame (lone red stopped-row nested inside the wrap border).
    `melody.html` now decouples the /api/state fetch from paint (a disconnect
    can't freeze the view) and ages out characters idle >45s (agent drops
    melodies at 30s). Fixture: fail-before/pass-after under a DOM mock.
  - **Setup chrome never dismissed**: `overlay.html` + `triggers.html` Done
    always called the GLOBAL set-setup-mode(false), which
    `applyOverlayInteractivity()` skips for windows in the single-overlay
    ("Setup THIS") registry — chrome stayed up. Both are now scope-aware like
    the 13 panel overlays, and `main.js` also tears down single-setup on 🔒 and
    ✕. Fixture drove the real overlay script + a faithful single-setup registry
    model.
  - **#35 CLOSED**: CH-chain drag wiring + opacity slider verified functional
    on current beta — the remaining Spell-Casting backdrop item was this bug.
- **Rules-mechanization thread R.1+R.2 — DONE (2026-07-19, bot 3.0.213 + web
  1.0.244 on main).** First bundle of the queue's rules thread (#94 ingest + #92
  attendance audit).
  - **#94 guild-rules store + `/ingestrules` + admin view.** New `guild_rules`
    table (migration `20260719120000`; RLS authenticated-read, service-role
    write — the roll_sets Tier-2 idiom). Officer slash command `/ingestrules`
    (`commands/ingestrules.js`, officer-gated via `hasOfficerRole`) reads the
    three rules channels (`RULES_CHANNEL_ID` / `RAID_RULES_CHANNEL_ID` /
    `LOOT_RULES_CHANNEL_ID`, added to `.env.example`), shapes every message into
    a rule via the zero-dep pure parser `utils/rulesParser.js` (numbered-item +
    heading/bold detection; **every message lands at least as a raw-body row
    with rule_number null — nothing dropped**; embed-only messages fall back to
    embed title/description), and **upserts by (guild, channel_key,
    source_message_id)** so re-runs update edited messages in place and flip
    vanished messages `active=false`. Reply summarizes per channel
    (rows · numbered · raw · deactivated · scanned). Read surface: read-only
    `/admin/rules` (server component + supabaseAdmin, officer gate via the admin
    layout), grouped by channel in rule order, parsed-vs-raw + deactivated
    flags. **We do NOT interpret rule semantics** — `category` is a reserved
    NULL column for #95/#93 to fill. Tests: `test/rules-ingest.test.js` (18 —
    numbered shapes, heading/bold, raw fallback, title clip, and the
    build-row edit-upsert idempotency mapping). *Officer/infra — no CHANGELOGS
    or roadmap entry.*
  - **#92 attendance gap-check (RESCOPED to an audit + small fill).** **What
    OpenDKP + existing surfaces already cover:** `opendkp_attendance_recent`
    (view) gives per-CHARACTER raid COUNTS for 30d/90d/lifetime + first/last
    seen; `/admin/attendance` computes TICK-level RA% for 30d + prior-30d per
    character with denominators; targets/roster-headcount + new/downturn cohorts
    are already there. **Genuine gaps filled:** no 60d window, no RA% beyond 30d,
    no tick counts exposed reusably, and **nothing was family-aware** (main+alts
    counted separately). Fix = ONE SQL view, no engine: `member_attendance_metrics`
    (migration `20260719121000`, `security_invoker=on`) rolls up main+alts via the
    established `lower(coalesce(nullif(main_name,''),name))` family idiom (same as
    `character_data_floor`), and emits **60/90/lifetime (and 30d) tick-based RA%
    + attended tick counts + denominators + raid-attended counts + first/last**.
    RA% is tick-based to match OpenDKP's "30 Day (52/52)" and the page's math
    (empty-attendee ticks excluded as sync gaps; a tick counts once per family).
    Attendee names not in `characters` become singleton families so no attendance
    is dropped. Small addition to `/admin/attendance`: a "Family RA%" table
    reading the view (sorted by 90d RA%). **Verified live:** family rollup
    matched an independent DISTINCT-union cross-check exactly (Peopleslayer family
    `raids_att_lifetime=229`). **Consumers (seating, #80 review cards) should read
    RA% + tick counts from `member_attendance_metrics`.**
- **Rules-mechanization thread R.3 (#95) + R.4 (#93) v1 — DONE (2026-07-18, web
  1.0.245 on main).** Both are pure-lib + web surfaces off gear/signup data we
  already collect; no bot, agent, or Mimic change.
  - **#95 Raid Kit readiness (rule 12).** Pure compute in `web/lib/raidKit.ts`
    (`computeRaidKit`): 100-MR floor summed from **worn gear only** (same
    resist-sum idiom as the gear page) + a best-effort utility checklist
    (Enduring Breath / Levitate / self-invis / self-port + the Necro coffin).
    **"Helping not watching"**: MR is the ONLY hard pass/fail and only when a
    gear snapshot exists; utilities read *covered / not-detected* (amber, never
    red) because a source can sit in the privacy-stripped bank or an un-uploaded
    spellbook. Detection under-claims on purpose — a class-innate self-buff is
    credited only for the certain Luclin cases (Druid/Wizard/Enchanter/Necro/
    Shaman), otherwise it needs a real item click/worn effect or a scribed spell
    (`character_spellbook`). Honors `exclude_from_stats`/`exclude_inventory`.
    Member surface: compact 🎒 card on `/character/[name]/gear` (`RaidKitCard`).
    Officer surface: **`/admin/readiness`** — whole-roster table (membership =
    the attendance page's roster-rank predicate), MR + checklist columns, MR-fail
    rows floated to top, links `/admin/rules`. Tests: `test/raid-kit.test.js`
    (13 — MR edge cases, no-snapshot, opt-out, See-Invisible≠invis, scribed/item
    ladder, necro coffin + poison-bottle false positive + level-title fold).
    **Live-verified:** 16 roster chars have snapshots, all meet the 100 floor
    (lowest Squeekie 108; Hitya 158). *Member-facing — roadmap entry added.*
  - **#93 comp template + planned-vs-actual matcher.** Pure lib `web/lib/comp.ts`
    — the ONE class→archetype map (tank/healer/support/melee/ranged), template
    validation, and gap math (`computeCompGaps`: archetype + per-class deltas,
    minimums as floors, unmapped count, human summary). Store: new
    `comp_templates` table (migration `20260719140000`, overlay_tuning pattern —
    one jsonb-array row per guild, RLS authenticated-read + service-role write;
    applied via MCP + committed). Officer editor **`/admin/comp`** (client
    `CompEditor` = validated JSON textarea + live rendered demand preview,
    server action re-validates, `/admin/overlays` precedent). Matcher **extends**
    `/admin/signups` detail view: template picker → planned gaps from the Going
    signups' classes, plus an **actual overlay** from the best-coverage
    `raid_roster` snapshot in the event window (cheap; reuses existing capture,
    no new stream — omitted with a note when no snapshot falls in the window).
    Tests: `test/comp-matcher.test.js` (14 — archetype map + title fold, validate
    accept/reject, demand expansion + minimum floor, gap shortfall/surplus/
    per-class, met-clean). *Officer-facing — roadmap entry added.*
  - **Follow-ups (not v1):** MR is worn-gear-only (no base/buff/self-resist
    layer — the naked-stat-snapshot follow-up that the gear page's attribute box
    also waits on would let it show true in-play MR); utility detection can't see
    bank items or un-uploaded spellbooks (structural — privacy by design);
    the comp matcher's "actual" only appears for events whose window overlapped a
    live raid (raid_roster is live-capture, not per-event); RaidHelper `rh_signups`
    is empty until the RH API/scan runs, so the planned side has no data to match
    yet (matcher renders cleanly on zero). Rule-12 semantics are still hard-coded
    in the lib rather than read from `guild_rules.category` (R.1's reserved column).
- **Overlays**: DPS/Tank HUD, Extended Target (+ glide animation), Command
  Center, Charm & Pet trackers, Mob Info, Buff/Debuff queue, CH-chain,
  per-character overlay position + opacity (B-2), auto-arrange, theme picker.
- **Raid hub `/raid`**: structured view, color tiers, raid-leader badge,
  buffer mode, Mob Info overlay, RaidHelper sign-up sync (data side).
- **Agent/data backbone**: character live-state, cross-client HP, buff
  landings, charm/pet timers, Quarmy AA parser, `/who` web directory, PvP
  assist credit (`pvp_assists`).
- **Triggers**: trigger→Discord pipe, real voice audio broadcast, gauge
  conditions.
- **Platform mechanics**: redeploy-free agent manifest (`AGENT_RELEASE_REF`),
  beta/stable channels, remote overlay tuning + mid-raid load-shed, Mimic Mail.
- **Efficiency pass (2026-07-07/09)**: hot-handler memos, agent pre-filters,
  retention trims (buff_casts 7d, threat 30d, who prune), web single-RPC /who,
  VACUUM FULL reclaim.
- **Scale safeguards, in progress (2026-07-17)**: reporter-election chat pilot
  (bot 3.0.196 + agent 3.3.74 beta, #72) — see `BETA-TESTING.md`. Chunk-0
  hotfixes: auth 503-not-401 data-loss fix (bot 3.0.197); `{s}` triggers match
  backtick names (agent 3.3.75 beta). *Note:* the buff_casts 409-storm P0 the
  audit flagged was already fixed in prod (`insertIgnoreDuplicates`).
  - **P1b done (2026-07-18, bot 3.0.206 + agent 3.3.81 beta)**: buff-landing
    election — coverage-ranked, 3 reporters/zone. Bot tallies distinct
    (spell,target) landings per uploader over a 10-min window and elects the top
    3 per heartbeat-zone; agent honors `roles.buffs` in the buff_casts path,
    `is_charm_spell` rows exempt (always upload). Gated behind `dedup_buffs`
    (default OFF) on `/admin/overlays`; fail-open everywhere.
  - **P1c + strays + camp-out done (2026-07-18, bot 3.0.207 + agent 3.3.82
    beta)**: **#72 election work complete.** (1) **Roster election** — 1 reporter
    per RAID GROUP (`_electRosterReporters`), partitioned by the `group_num` the
    agent already sends in its heartbeat (derived from the Zeal raid pipe for its
    primary); unknown group → own singleton (always elected). Agent honors
    `roles.roster` in the raid-roster upload path. Gated behind `dedup_roster`
    (default OFF). **Write-path (2.1):** ingest is now a plain per-uploader upsert
    (was DELETE+upsert) — one round trip, departed rows age out via the readers'
    existing 15-min `captured_at` window + a daily midnight prune. (2) **Stray
    endpoints:** `buff-lag-report` (diagnostic) now rides `roles.buffs`
    agent-side (local snappy-mode unaffected); `debuff-clear` deliberately LEFT
    UNGATED (per-actor control action — gating would drop a non-elected clicker's
    "✓ cured" feedback). (3) **Camp-out early handoff** — agent detects `/camp`
    (`/prepare your camp/i`), sets `camping`, fires an immediate heartbeat; bot
    demotes camping agents from every election unless they're the sole live
    candidate in scope (`_dropCampers`, fail-open), starting handoff ~30s before
    the TTL. Fail-open throughout; per-observer streams untouched (no roles).
- **#73 admission control + Supabase resilience — CORE done (2026-07-18, bot
  3.0.208 + agent 3.3.85 beta).** Four pieces landed:
  1. **Per-uploader × per-kind ingest budgets** (`_overBudget`, index.js) on the
     hot `/api/agent/*` surface, keyed by session-token hash (IP fallback),
     60s windows. Defaults sized generously from the audit (a healthy agent
     never trips). Tunable via the SAME 60s overlay-tuning map as `flag_shed_*`:
     `budget_<kind>_per_min` (default per kind; `0`=unlimited),
     `budget_enforce_<kind>=1` (durable kinds: log-only → real 429+Retry-After),
     `flag_disable_budgets=1` (kill switch). **Fleet-safe defaults:** durable
     kinds (encounter/chat/historical_chat/buff_casts/bosskill/lockout/rolls) →
     **log-only** (no 429 until an officer opts in); ephemeral/redundant kinds
     (live_state/casting/threat_snapshot/raid_roster) → **200-ack-and-drop**
     over budget (the shed pattern); `recent_fires` GET → 429. One log line per
     uploader per window. Defaults per kind (per-min): encounter 120, chat 120,
     historical_chat 120, buff_casts 240, bosskill 30, lockout 30, rolls 60,
     live_state 240, casting 240, threat_snapshot 120, raid_roster 90,
     recent_fires 240.
  2. **Supabase timeout + circuit breaker** (`utils/supabase.js`): `_request`
     now carries a ~10s AbortController timeout (a brownout resolves null, not a
     zombie await) + a consecutive-failure breaker (open after N, cooldown,
     single half-open probe). Timeout/network/5xx trip it; 4xx counts as
     reachable. null/[] contract unchanged. Knobs are ENV (not tuning — they
     guard the tuning store): `SUPABASE_REQUEST_TIMEOUT_MS` (10000),
     `SUPABASE_BREAKER_THRESHOLD` (5), `SUPABASE_BREAKER_COOLDOWN_MS` (30000).
     State on `GET /health`.
  3. **`target-buffs` GET cache** — 2s per-target in-memory cache, mirroring
     `character-live-state`; it was the only hot GET hitting Supabase per
     request. (`target-casts` needs none — it reads the in-memory relay.)
  4. **Poison hardening** — buff_casts `cast_at` and chat `ts` now
     sanitize-and-skip an unparseable date instead of throwing a 500 (which a
     5xx-retrying agent re-posted forever). encounter/live-state/casting were
     already defended. **Agent 3.3.85 beta**: honor 429 `Retry-After` in the
     durable queue (429 was already retryable — not in `QUEUE_PERMANENT_CODES` —
     so no data was ever lost; the fix makes backoff precise and excludes 429
     from poison-parking).
  - ✅ **#73 tail DONE as #106 (2026-07-18, bot 3.0.210 + agent 3.3.87 beta)** —
    see the #106 entry below; the six-GET-loop consolidation + encounter-burst
    flattening close #73 entirely. **Wave 2 is now fully closed** (#72 election,
    #73 admission control incl. tail, #74 control plane, #58 zero-downtime).
- **#109 Mimic dashboard restructure — DONE (2026-07-19, agent 3.3.90 beta;
  web 1.0.243 roadmap on main; BETA).** Guild-lead ask, two halves. **(1) 🐺 Me
  card replaces the logsync region.** The Dashboard tab opens on a new `#wpMeCard`
  (renderMeCard, all-LOCAL: own Zeal client → character + zone + compact
  buff-NAMES line; watched-log characters; last ~5 local tells; last few uploads
  as name + duration + a /parses jump) with a prominent wolfpack.quest/me link.
  Buff names (no ticking counts) keep it byte-stable mid-combat; fmtAgo lives
  inside this dedicated placeholder per the rendering rules. The engine/sync guts
  moved into a collapsed **⚙ Engine** `<details>` (`#wpEngine`/renderEngine,
  wpKeep('engine')) that now houses `#wpSetupChecks` (moved from #dash),
  `#wpEngineStats` (new — files tailed, queue depth, upload counts, reporter
  line), and `#wpWatchedLogs` (moved from #info). Every existing id/render fn is
  preserved — placement change, not plumbing. **(2) 🛡 Admin menu.** A new
  officer-only nav tab + `#admin` section (renderAdmin) that collects the officer
  widgets that were scattered: `#wpDkpTick` + `#wpDkpLoot` (with "Post for
  bidding") MOVED here from #info, plus quick links to /admin/overlays,
  /admin/triggers, /admin/encounters, /admin. **Gate is agent-side, not CSS:**
  the sensitive card DATA (`dkpTick`/`dkpLoot`) is only serialized into
  /api/state for officers (null otherwise), and renderAdmin reveals the nav tab
  + fills the section ONLY when `mimicIdentity.is_officer` (the bot's
  authenticated reply). A non-officer never receives the tab or the data.
  **Quick-flip:** raid_hold/flag_shed are polled READ-ONLY by the agent and set
  on web /admin/overlays — no officer-authed agent write endpoint exists, so the
  Admin tab ships LINKS to it (a local one-click flip is a noted follow-up; no
  new write endpoint built this task). Verify: agent `node --check` +
  `check:dashboard` green (WEB_HTML restructure); scratchpad smoke 18/18 (Me card
  populated from synthetic state; Engine details present + collapsed by default;
  Admin tab absent for non-officer, present + collecting DKP/loot for officer).
  See BETA-TESTING #109.
- **#112 chat-election liveness + zone-spread — DONE (2026-07-19, bot 3.0.214 on
  main + agent 3.3.91 beta).** *Incident (2026-07-19, real):* guild chat → Discord
  went dark ~6:43am–3:16pm. The single elected chat reporter's AGENT kept
  heartbeating while its CHARACTER was logged out — it stayed elected and saw no
  chat. The election TTL never noticed (the agent was alive), and the PvP death
  feed (not election-gated) posted all day, proving the fleet was healthy — only
  the one elected stream died. Mitigation IN PLACE since the incident: `dedup_chat=0`
  in `overlay_tuning` (everyone uploads chat). **Fix, two defenses:**
  (1) **Liveness** — the agent heartbeat now carries `last_line_ms` (ms since it
  last processed a live log line from its PRIMARY's tail; a logged-out char tails
  nothing, so it climbs past the threshold within ~a minute). Chat candidacy
  requires `last_line_age < reporter_liveness_max_ms` (default 90000); a stale
  candidate is demoted exactly like a camper. Older agents that omit the field are
  treated FRESH (fail-open for the whole fleet during rollout); if NO candidate
  anywhere is fresh, all live agents stay eligible (never zero uploaders).
  (2) **Zone-spread** — chat now elects one reporter PER OCCUPIED ZONE (reusing
  the buff election's zone grouping); /gu is global so one live reporter suffices,
  but the per-zone spread is deliberate redundancy and the bot's existing 10s chat
  dedup collapses the duplicate posts. Unknown zone → own singleton (fail-open).
  Failover: a reporter whose log goes quiet is demoted on the next poll after its
  age crosses the threshold (~90s + one 20s cycle), bounding an outage to ~a minute
  instead of hours; another zone's reporter (or the freshest same-zone candidate)
  takes over. **Re-enable:** once the fleet is on agent ≥3.3.91, flip `dedup_chat`
  back on (delete the key / set 1) in `/admin/overlays`. Verify: `lint` + `test`
  (election slice extended: liveness demotion, missing-signal fail-open, zone-spread
  two-zones, no-fresh fail-open) + `check:dashboard` green ON MAIN. See BETA-TESTING #112.
- **#115 officer reporter control panel — DONE (2026-07-19, bot 3.0.214 on main +
  agent 3.3.91 beta).** Companion to #112: officers can SEE and STEER the reporter
  election from Mimic. **Read** — `GET server-panel/reporters` (officer-gated, same
  `is_officer` gate the DKP/loot widgets use) returns the live registry (per
  uploader: character, zone, group, agent_version, camping, last_line_age, fresh)
  + per-service elected sets + active pins/extras. **Write** — `POST
  /api/agent/reporter-override` (officer-authed, proxied through the agent's
  generic `/api/server/` passthrough) sets the override TUNING KEYS
  `reporter_pin_<svc>` (a character name) / `reporter_extra_<svc>` (comma names),
  so they ride the 60s control-plane cache and survive deploys (string-tuning
  precedent: `agent_release_ref_beta`); read-modify-write preserves other knobs.
  **Election honors overrides:** a pin that is LIVE+FRESH replaces the computed
  pick for its scope; a dead/stale pin is IGNORED (one log line, fail-open); extras
  are additive. Pins exist ONLY for chat/buffs/roster — per-observer streams are
  never passed to the override path, so mob/encounter data can never be pinned.
  **Panel (agent, #109's 🛡 Admin tab):** a 📡 Reporters card (officer-gated by the
  same data gate) — table of live uploaders + elected badges per service, a swap
  dropdown (sets the pin), an add-include input (sets extras), and a clear button.
  Byte-stable render into its own `wp*` placeholder; non-officers get no data and
  no panel. Verify: election-slice tests (pin honored/ignored, extras additive) +
  scratchpad smoke (panel renders from synthetic registry; swap POST shape; empty
  for non-officer). See BETA-TESTING #115.
- **#110 OpenDKP audit-trail reconciliation — DONE (2026-07-19, bot 3.0.212 on
  main).** Path shipped: **BOTH** — audit feed as TRIGGER + WATERMARK, scoped
  reconcile as the precise removal. Motivated by the 2026-07-19 "Backpack"
  incident (3 test awards deleted in OpenDKP but still on wolfpack.quest's
  parses/loot surfaces; `opendkp_loot` is append-only via upsert and
  `_raidNeedsDetail` stops re-fetching a settled raid, so the deletion never
  propagated).
  - **Evidence the audit path can't stand alone:** `opendkp_audits.raw` carries
    only `{AuditId, CognitoUser, ClientId, Timestamp, Action}` across all 46k
    rows — `Action` is a bare label ("Raid Updated", "Raid Deleted", …) with **no
    entity ids** and **no per-item "Loot Deleted" event**. A loot removal shows
    up only as a raid-level "Raid Updated". So an audit entry can't be mapped to
    the loot row it changed — precise reconciliation from audits alone is
    impossible.
  - **What shipped (`utils/openDkpSync.js` `reconcileRecentLoot`, wired into
    `runSync` after `syncAudits`):** each sync reads new audits since a watermark
    (`bot_kv` key `opendkp_reconcile`, `{lastAuditId, lastReconcileAt}` — no new
    schema); a new "Raid Updated"/"Raid Deleted" (or a 6h floor) warrants a pass.
    The pass re-pulls ONLY recent raids' loot (default 14d, `OPENDKP_RECONCILE_
    WINDOW_DAYS`), upserts upstream (edits/adds propagate), and deletes local
    rows absent upstream (ghosts). Idempotent (empty diff on a clean mirror),
    watermarked, one log line per removal. **Fails SAFE:** never deletes for a
    raid whose detail fetch errored/was malformed, and the whole pass aborts its
    deletes if the removal set exceeds `max(20, 25% of scanned)` (guards an
    upstream empty-`Items[]` glitch). `/syncopendkp` reports reconcile stats;
    `full:true` reconciles every raid.
  - **Scope:** deletions apply ONLY to the `opendkp_loot` mirror (pure mirror —
    no bot-owned rows; verified). Whole-raid deletes (a `getRaid` 404 leaves the
    `opendkp_raids`+cascade row) and auction/adjustment ghosts are a documented
    same-class follow-up, out of this incident's scope.
  - **Verify:** `lint` + `test` (142, incl. new `test/opendkp-reconcile.test.js`,
    14: classify mapping, scoped-diff removal set, watermark advance, idempotency,
    dry-run, fail-safe cap, bad-fetch guard) + `check:dashboard` green ON MAIN. A
    true live dry-run couldn't run here (OpenDKP Cognito secrets are Railway-only,
    and the reconcile needs upstream `getRaid`); prod SQL confirms the first real
    pass is near-zero + safe — recent 14d window: 171 loot / 6 raids, **0** NULL
    `game_item_id` (no key churn), **0** duplicate dedup-keys, backpacks already
    gone, safety cap 43. See BETA-TESTING #110.
- **#108 loot bidding dashboard element (Mimic) — DONE (2026-07-19, agent
  3.3.89 beta + bot 3.0.211 on main; BETA).** Guild-lead ask. A "💰 Loot
  bidding" card (BETA-tagged) in the agent dashboard:
  1. **Hard OpenDKP login gate (agent).** Every bid control is disabled until
     the user signs into their OpenDKP account. The agent drives AWS Cognito
     `USER_PASSWORD_AUTH` directly (built-in `https`, zero deps — same flow as
     `utils/opendkp.js`); the token lives ONLY in `logsync.opendkp.json` and is
     never uploaded. The PUBLIC Cognito app-client id + region come from the
     bot's `server-panel/opendkp-auth-config` (one source of truth, zero secrets
     in the agent). Bids still ride the existing officer-mediated, sealed
     `/api/agent/place-bid` — the login is the GATE + bid-history unlock, not a
     new bid path.
  2. **Live auctions (agent).** Surfaces the v3.3.88 `_lootAuctions` detection
     via `GET /api/loot/auctions` (one source of truth — no re-parse) MERGED
     with the bot's live OpenDKP auctions. Per item: wishlist ★, last winner +
     runner-up, a bid box, and a "+1" prefill (runner-up + 1, fallback last-win
     + 1 — never auto-submits; the Bid button submits).
  3. **Local main+alt family (agent).** `logsync.bidfamily.json` + a small
     editor (add/remove/mark-main) + a per-bid character picker.
  4. **Bid history + wishlist (bot).** Once authed, `server-panel/bid-history`
     serves the caller's wins (`opendkp_loot`) + wishlist — explicit prereg
     (`wishlists`) MERGED with items inferred from OpenDKP bid history
     (`opendkp_auction_bids.user_login`/`character_name`), each tagged
     `prereg` vs `from bid history`. `server-panel/item-history` serves the
     last winner + runner-up per item.
  - **Data-chain reality:** `loot_drops` is empty in prod and sealed auctions
    DISCARD losing bids on settle, so the RUNNER-UP is often unavailable — the
    winner + winning bid come reliably from `opendkp_auctions` (13k rows), the
    runner-up from `opendkp_auction_bids` when the pre-settle bids were mirrored,
    else null (panel falls back to last-win + 1). OUT of scope (later board):
    officer auction management (#70), posting auctions (#68) — read-only +
    place-bid only.
  - Verify: agent `node --check` + `check:dashboard` green; scratchpad smoke
    20/20 (gate, family persistence across restart, auth transitions, local-
    auction surfacing, prefill math); bot `lint` + `test` (128, incl. new
    `test/loot-bidding.test.js` source-slice, 10) + `check:dashboard` green ON
    MAIN. See BETA-TESTING #108.
- **#107 loot-post TTS + auction countdown chips + trigger overlay auto-grow —
  DONE (2026-07-19, agent 3.3.88 beta; web 1.0.241 roadmap on main — NO bot
  change).** Guild-lead ask, two halves, all agent + Mimic-overlay:
  1. **Loot-post announce (agent).** `noteLootAuction()` hooks the LIVE /gu+/rs
     tail (never the `--since` backfill) and reuses `parseLootChatBody`'s strict
     Title-Case guard: a multi-item drop list is a loot post on its own; a lone
     single item needs bid context (a bid word inline, or a bid call heard in the
     last 30s). The chat line is the universal signal — every raider's agent sees
     it locally — so the callout is per-client LOCAL TTS + a chip, no relay/dedup.
     Duration parsed from the bid call ("2 min", "90s"), else the configurable
     `lootAuctionDefaultSec` (120s); a later bid call that states a duration
     re-anchors the most-recent auction. TTS rides the existing overlay-fire
     pipeline (`_pushOverlay` → `recentTriggerFires`), so it respects the master
     `enableTriggerTts` flag for free: "Loot posted — N items, bids open X"
     (item COUNT, not the list).
  2. **Auction countdown chip (agent + triggers.html).** Reuses the trigger
     `_activeTimers` machinery so it looks/behaves like a Death Touch timer (gold,
     15s warning). Same item set = reset in place (second-watched-log + repeat posts stay
     silent — the announce fires only on first open); distinct sets stack.
     Per-chip ✕ dismiss (`kind:'loot'`/`dismissible` in the snapshot → overlay
     draws a ✕ with the hover-interact handshake → `POST /api/timers/cancel`).
     Dashboard Triggers-tab toggle (`lootAuctionTts`, default ON) + default-
     duration knob (`POST /api/loot-prefs`), persisted in `logsync.optin.json`.
  3. **Trigger overlay auto-grow (triggers.html).** The renderer measured ONLY
     the `#timers` stack and shrank the window to 50px when no timer was live —
     cropping the sticky stack (#76) + feedback buttons in the centered
     `#alertcol` (the "bottom buttons cut off" bug). Now a `ResizeObserver` on
     BOTH `#alertcol` and `#timers` drives `measureWanted()` → the existing
     `overlayAutoHeight` IPC (grow-up/down + work-area clamp already handled
     there). Grow immediate, shrink debounced 250ms, clamp ~60% work area with
     `#timers` internal scroll beyond. **Interaction rule shipped:** height is
     fully auto-managed; the right-click resize presets only change WIDTH, so
     manual sizing and auto-grow never fight — 50px baseline floor, ~60% ceiling.
     `main.js` untouched.
  - Verify: scratchpad smoke over the parser (announce text + duration incl.
     default path, chip payload, reset-vs-stack, false-positive guards) 38/38;
     agent `node --check` + `check:dashboard` green; triggers.html `<script>`
     parses. See BETA-TESTING #107.
- **#106 multiplexed agent poll + encounter-burst jitter — DONE (2026-07-18, bot
  3.0.210 on main + agent 3.3.87 beta).** The deferred #73 tail, built on the
  budgets/breaker/shed/kill-switch already shipped:
  1. **`GET /api/agent/poll` (bot).** One bundle endpoint assembled from the SAME
     in-memory/cached stores the individual routes read — no new Supabase hit per
     poll. Request carries `streams=<csv>` + per-stream cursors reusing each
     stream's existing semantics (`since_id` recent_fires · `tuning_ver` hash ·
     `trig_ver` max-updated_at · `classes`/`characters`). Response
     `{streams:{<key>:{data}|{unchanged:true}}, agent_kill, min_agent_ver_num}`;
     a stream shed via `flag_shed_<key>` is OMITTED (client fails open). Control
     plane rides every poll (the dormancy/floor channel). The six individual
     routes stay live (extracted to shared `_*For` helpers so bundle + standalone
     never drift). Gated by a new `poll` admission budget (240/min, 429 over).
  2. **Single agent poll loop (agent, fallback-safe).** One 1.5s loop asks for
     `recent_fires`+`tuning` every tick and the slow streams (triggers 2min,
     prefs 10min, backfill/ui_edits 5min) only when due — same per-stream rate as
     before, six request streams → one. **Feature-detect:** a 404 or a non-poll-
     shaped 200 (old bot's catch-all `OK`) flips to permanent per-process
     fallback to the individual loops (they no-op behind an `_multiplexActive()`
     gate until then). **Dormancy preserved:** while paused/below-floor the loop
     asks for `tuning` ONLY (nothing else), throttled to the control cadence.
  3. **Deterministic encounter-upload jitter (agent).** On fight end a real
     encounter's network enqueue is delayed `hash(uploader) % 15s` (deterministic
     per client — re-runs don't re-randomize), flattening the ~90MB-at-60
     simultaneous offer; the ±30min find_or_create dedup makes a few seconds
     immaterial and the durable queue already honors 429/Retry-After. **Bypass:**
     an empty queue AND a payload < 256KB (solo/duo parse) enqueues immediately so
     the dashboard card feels instant. Local overlay/UX is never delayed — only
     the enqueue-to-network moment; backfill replays skip the jitter.
  - **Req-rate math (steady-state GET polling, per bot):** at 15 clients the
     recent-fires loop alone was ~10 req/s and the 5 slower loops added a light
     tail; after #106 it's ~10 req/s TOTAL (one loop, the slow streams absorbed).
     At 60 clients recent-fires was ~40 req/s + 5 more loops → after #106 ~40
     req/s total, the other five collapsed into it (Supabase read rate for the
     slow streams unchanged — they ride only their own cadence).
  - Tests: `test/poll-bundle.test.js` (source-slice of the bundle's per-stream
     decision — shed-omission + cursor/unchanged), `test/encounter-jitter.test.js`
     (mirror of the pure jitter helpers — determinism, 0..15s bounds, bypass;
     upgrade to source-slice at the next agent→main graduation). Full main gate
     (lint/test/check:dashboard) green; agent `node --check` + check:dashboard.
- **#74 control plane COMPLETE + #58 zero-downtime deploys DONE (2026-07-18, bot
  3.0.209 + web 1.0.240 on main; agent 3.3.86 + Mimic LKG on beta 1.9.6).** Built
  on the reporter election + budgets + breaker + `GET /health` already shipped:
  1. **Full `flag_shed_<kind>` coverage (#74 Part 1, bot).** The 200-ack-and-drop
     load-shed now covers every sheddable ingest kind — the original four
     (`live_state`/`raid_roster`/`casting`/`threat_snapshot`) PLUS `buff_casts`,
     `pvp`, `pvp_assists` (the /who-harvest rides these two — no separate who
     endpoint), `fun_event`, `trigger_relay`, `ui_layout`, `tells`. **Deliberate
     exceptions, NEVER sheddable** (`_SHED_NEVER`): `encounter`, `chat`,
     `bosskill`, `lockout`, `historical_chat` — `_isShedded` refuses them even if
     the flag is set (documented at the shed map; enforced by
     `test/shed-exceptions.test.js`). Web toggles added for every new shed kind.
  2. **`flag_agent_kill` + `min_agent_ver_num` (#74 Part 2, bot main + agent
     beta).** Served on BOTH the reporter-poll (20s primary) and guild-trigger
     (2min backup) responses. `flag_agent_kill=1` → fleet dormancy: agents stop
     all uploads + non-control polls, HOLD the durable queue (nothing dropped),
     keep only the heartbeat, banner "⏸ Agent paused by guild control plane";
     overlays keep working on local data; clearing resumes within one heartbeat.
     `min_agent_ver_num=<n>` → agents whose numeric version (`major*10000+minor*100
     +patch`, 3.3.85 → 30385) is below the floor stand down + show an update nudge.
     Both are labeled controls in the `/admin/overlays` 🛑 Kill switches section
     (kill = scary checkbox, floor = number input, empty = unset; merge-preserving
     save intact). **Fail-open everywhere** (missing/unparseable = no effect; the
     agent only stands down on a FRESH reading — bot down = runs normally after a
     5-min TTL). **⚠ These are POLICY semantics — conservative v1, Hitya to sign
     off.**
  3. **LKG crash-loop auto-rollback (#74 Part 3, Mimic beta).** Before any agent
     hot-swap Mimic snapshots the working agent to `index.lkg.js` + `package.lkg.json`
     in the userData agent dir. If the swapped-in child exits ≥3× within 2 min
     (crash-loop right after a swap), Mimic restores LKG, relaunches from it, sets
     a tray/dashboard "reverted to last-known-good" notice, and BLACKLISTS the bad
     version (won't re-offer it until a strictly newer build ships). Crash-loop
     with no recent swap keeps the existing exponential backoff + surfaces a
     diagnostic notice (no infinite tight restart). One log line per transition;
     blacklist decision covered by `test/lkg-blacklist.test.js`.
  4. **Per-channel manifest → beta hot-swaps (#74 Part 4, bot main + Mimic beta).**
     `GET /api/agent/latest-version?channel=beta` resolves a per-channel ref
     (`AGENT_RELEASE_REF_BETA` env, default the `beta` branch, live-overridable via
     the `agent_release_ref_beta` tuning key) and serves that file+sha. Beta Mimic
     builds (detected by the `-` prerelease suffix) now hot-swap along the beta
     line instead of waiting for a full electron-updater installer. Safe ONLY
     because the kill switch (Part 2) + LKG rollback (Part 3) are the four-gate
     safeguards for an auto-hot-swappable beta.
  5. **#58 Railway zero-downtime (main).** `railway.toml` healthcheck moved from
     `/` to the readiness-gated `/health`, which returns 503 until the Discord
     client is ready + state loaded (`_botReady`, set in ClientReady) and 503
     again once a graceful shutdown begins. Graceful SIGTERM/SIGINT drain: stop
     accepting new HTTP work (503, `Connection: close`), `server.close()`, give
     in-flight handlers ~10s (`SHUTDOWN_DRAIN_MS`) to finish, `client.destroy()`,
     exit. **Config + drain is our half; full overlap/zero-downtime also needs the
     Railway plan's overlap feature.** Watch-paths unchanged (bot deploys stay
     decoupled from web pushes). Tests: version-floor comparator + shed exception
     list + LKG blacklist (`test/version-floor.test.js` mirror,
     `test/shed-exceptions.test.js` source-slice, `test/lkg-blacklist.test.js`).
- **Callout trifecta, in progress (2026-07-17, #76)** — the "why TTS never
  fires" fixes: triggers evaluate before the privacy/combat filter so
  ENRAGED/snare/mez/fizzle templates fire (agent 3.3.76 beta, 9/17 dead
  templates); trigger relay seeds a monotonic id base so a bot deploy no longer
  makes the fleet relay-deaf for hours (bot 3.0.198). Deferred: ✕-mutes-TTS
  overlay decouple (#97, since shipped in the 1.9 line).
- **#76 remainder (callout trust infra) DONE + #103 CH GO (2026-07-18, agent
  3.3.83 beta + web 1.0.238)** — the trifecta closed the fire-path bugs; this
  closes the trust gap. (1) **Trigger checkpoint journal** — in-memory ring
  buffer (cap 250, no disk/upload) records how far each candidate evaluation got
  (line seen → matched → gates → actions → dispatched → relayed) + why it
  stopped; dashboard Triggers-tab card (`renderTriggerJournal`, own
  `#wpTriggerJournal` placeholder, no `<details>`). (2) **Real REHEARSE** — the
  ▶ Test button now `_rehearseTrigger`: synthesizes a matching line
  (`_synthesizeMatchingLine`, verified against the real regex) and drives the
  ACTUAL pipeline (pattern/cooldown/charm-suppression EVALUATED + reported but
  NOT enforced/consumed), speaks real TTS, `test=true` so no relay/upload/Discord
  and no `_fireLog` pollution; gauge triggers rehearse the action tail, journal
  "pattern not exercised (gauge condition)". (3) **Sticky callouts** — optional
  per-trigger/per-action `sticky` pins the trigger overlay until click/~5min;
  portable, backward-compatible, rides the relay via the action object (no bot
  change); officer checkbox on `/admin/triggers`. (4) **Ghost-callout TTL** — a
  relayed fire >15s old at consumption is journalled `stale-skipped`, never
  spoken (fail-open on missing ts); bot relay already carried `fired_at_ms`
  end-to-end, so NO bot change was needed. (5) **#103 CH chain "0X GO"**
  (guild-lead ask) — when the chain reaches a watched character's slot the agent
  speaks "0N GO" via `_pushOverlay` (the trigger pipeline — master
  `enableTriggerTts` still gates it); dedicated 📣 toggle on the CH chain overlay
  (default ON, localStorage + `POST /api/chchain/go-tts`, self-heals via the
  snapshot's echoed `go_tts`), debounced once per rotation pass. Verified:
  `node --check` + `check:dashboard` + 18/18 runtime smoke assertions. See
  `BETA-TESTING.md` for the raid-verify plan.
- **#105 richer fight timeline DONE (2026-07-18, agent 3.3.84 beta + web
  1.0.239)** — three new event types on the #98 `/parses/[id]` timeline, guild-
  lead ask. All ride the existing `noteTimelineEvent` → `timeline_events` →
  `encounter_events` path (bot ingest is generic over kind/subtype — NO bot
  change). (1) **slow_on / slow_off** — a known slow (data-driven `SLOW_SPELLS`
  named list: shaman Drowsy/Walking Sleep/Tagar's/Togor's/Turgur's/Cripple,
  enchanter Languid Pace/Shiftless/Tepid/Forlorn Deeds; the agent spell catalog
  carries no SPA-11 attack-speed marker so a list is the data-driven path)
  landing on the CURRENT fight target emits `slow_on` (hooked at the two
  `recordTargetBuffLanding` call sites via `EncounterBuilder.noteSlowLanding`,
  self-cast attributes the caster, bystander leaves it null); the estimated
  expiry (era-cap caster level, `_durTicksForLevel`) emits `slow_off` at flush
  IFF it fell inside the fight window — a slow still up at the kill emits
  nothing; a re-slow refreshes the window. (2) **mob_heal** — the Zeal target-
  gauge HP% rising for the SAME target name across two `/api/zeal-state` frames
  (`_noteMobHealFromState` → the observing char's live builder's `noteMobHeal`);
  guardrails: identical gauge name required, prior HP > 0 (a rise off 0% is a
  new same-name spawn), ≥5pp rise, ≥10s per-target debounce, target must match
  the fight (`_fightTargetMatches`). Same-name babysit fights can false-positive
  — accepted + documented at the source. (3) **disc** — discipline emotes via
  a data-driven `DISC_LINES` table hooked in `noteRaidLine`; the four grounded
  "fighting style" stance discs shipped (Defensive verified in-repo, Evasive/
  Precision/Aggressive share the server grammar), third-person + self both
  attributed; non-stance discs (Fortitude/Furious/Mighty Strike/Weapon Shield/
  Holyforge/Sanctification/Whirlwind) are a one-row addition once exact emote
  text is confirmed. Web: `FightTimeline.tsx` colors ticks by subtype (gold/
  amber slow pair, green heal, purple disc; enrage/rampage stay orange) + a
  present-only legend; `parses/[id]/page.tsx` now passes `subtype` through
  (read-side 3s dedup already keys on it). Verified: agent `node --check` +
  `check:dashboard` + a 12/12 runtime smoke script; main `lint` + `test` +
  `check:dashboard` + web `tsc --noEmit` green. See `BETA-TESTING.md`.
- **1.9 beta line → stable (2026-07-18, #89)**: graduated Mimic **1.9.5** /
  agent **3.3.80** to the stable channel by file-checkout of `apps/mimic` +
  `packages/wolfpack-logsync` onto `main` (never a whole-branch merge); beta
  re-parked at **1.9.6** above stable. Maiden run of the redeploy-free
  pipeline. Carries the healing overlays, seconds-fast restarts + 🛟 settings
  backups, officer loot capture + DKP ticks, ↩ revert-to-stable, faster
  (10→2min) + backtick-safe `{s}` triggers, ✕-decoupled-from-TTS (#97), and the
  fleet tank/Command-Center blanking fix (`_mtLiveStateByName`, on beta since
  3.3.73). The #72 / #76 / `{s}` beta items in `BETA-TESTING.md` graduate with
  it. Also upgraded the two MIRROR vitest suites (`trigger-class`,
  `timeline-events`) to source-slices now that the real functions ship on main.

- **Supabase RPC lockdown (2026-07-18)**: closed the advisor's SECURITY DEFINER
  hole — 10 SEC-DEFINER RPCs (11 signatures incl. `bump_agent_upload_stat` ×2)
  were EXECUTE-able by `anon`/`authenticated` via `/rest/v1/rpc/*`, worst being
  `prune_who_observations` (an anon-callable *data-deletion* vector). Migration
  `20260718040000` revokes EXECUTE from PUBLIC + anon + authenticated on all,
  grants `service_role` explicitly (bot + web already call these only as
  service_role), adds `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC`
  so new functions don't reopen it, and flips the 2 SEC-DEFINER views
  (`who_directory`, `opendkp_loot_recent`) to `security_invoker = on`. Advisor
  now clean on all 19 fn warnings + both view ERRORs. **Follow-ups (next entry):**
  mutable-search_path WARN ×23 (done) + leaked-password protection (dashboard);
  RLS-no-policy INFOs still deferred (out of scope).
- **Supabase search_path pin (2026-07-18)**: pinned `SET search_path = public` on
  all 23 `function_search_path_mutable` WARN functions (migration `20260718043553`).
  Bodies reference only public tables (mostly unqualified) + pg_catalog built-ins,
  none hit the `extensions` schema, so `public` is the safe pin (NOT `''`, which
  would break unqualified refs). Advisor re-run now clean of every fn WARN;
  smoke-tested `eq_class_bit`/`character_missing_spells`/`turnins_by_id`/
  `item_card_info`/`who_directory_json` still resolve their tables (write RPCs
  verified by static body inspection — not executed against prod).
  **⚠ Pending dashboard action (Hitya):** enable Auth leaked-password protection
  (HaveIBeenPwned check) — Dashboard → Authentication → password settings. No
  MCP/SQL toggle exists; it's an Auth config flip.

- **[#75] Golden-log CI + pre-raid drill (2026-08-02)**: the agent parser now
  has a regression net. `test/fixtures/golden/*.log` are two committed SYNTHETIC
  EQ logs (invented names — never a real log, `PRIVACY.md`) replayed through the
  real `shouldKeep` → `parseEvent` → `EncounterBuilder` → `flush` pipeline by
  `test/golden-log.test.js` (147 tests; suite 32 files/375 → 33/522). Two tiers:
  per-line filter+parse snapshot (`toMatchObject`, so additive fields don't churn
  it) recording BOTH gates — `shouldKeep` (default DROP) and the sliced
  `triggerVisibleLine` (default KEEP, the actual privacy surface) — and an
  encounter DIGEST (a projection we own, so `toEqual` is safe). Coverage of all
  25 `parseEvent` families is enforced by slicing the shipped source. Accept a
  deliberate change with `npm run golden:update` (never to make a test pass);
  `npm run golden:check` fails if the expectations went stale. CI:
  `.github/workflows/golden-log.yml` on PRs + `main` + `beta`. **The privacy
  assertions read the LIVE parser, not the golden — regenerating can never
  launder a privacy hole.** Drill: `npm run drill`
  (`scripts/preraid-drill.js`) — read-only, safe mid-raid; parser self-test +
  bot `/health` + `latest-version` (both channels) + bearer ingest-auth +
  wolfpack.quest. Zero agent edits (agent file byte-identical). Design + the six
  defects it PINS: `docs/DESIGN-75-golden-log.md`.
  **⚠ Needs Hitya's call:** (a) do we want a *write-path* drill (POSTs a
  synthetic encounter end-to-end → puts drill rows in `encounters`)? (b) the
  three `KEEP_PATTERNS` gaps it found are real data loss today — Quarm two-line
  DS flavor lines, bystander exceptional heals, and spell crits all parse fine
  but are filtered before `parseEvent` ever sees them, so DS damage is
  permanently tagged `non-melee` and the crit-heal leaderboard cannot exist.
  Plus `charm_sessions[].duration_sec` is NaN on every upload (ISO-string
  subtraction) — every charm session reaches the bot with no duration. All four
  are one-to-two-line agent fixes on `beta`, deliberately NOT made here.

- **Timestamp fidelity + what counts as a death (2026-08-03/04)** — bot 3.1.1 →
  3.1.7 on `main`, agent 3.5.2 → 3.5.13 and Mimic 2.3.0 on `beta`, web 1.1.0 →
  1.1.2. One night's chain, from "the deaths on this parse aren't accurate" to
  the two measurement bugs underneath it. Ordered by how load-bearing it is:
  - **`"<Name> dies."` is FEIGN DEATH, not a death.** It's the `cast_on_other`
    text of Feign Death (366), Death Peace (1460), Paralyzing Venom (1118) and
    FD Test (2807). `parseEvent` matched `/die[ds]\./` on the belief that
    "dies." was an older real-death phrasing. **44% of every stored death row
    came from the only two classes that can feign** (Shadow Knight + Necromancer
    — 233 of 534), and the worst single fight recorded **63 "deaths" for one
    character**. Fixed to `died.` only (agent 3.5.11). *(Careful with that 44%:
    it's the SUSPECT SET — an upper bound — not a count of confirmed feigns.
    SKs really do die.)*
  - **Real deaths carry a corpse-run tail** ("You are bleeding to death!",
    "Returning to home point, please wait…") that appears ONLY in the dying
    player's own log. Parsed as a `death_confirm` event that back-patches
    `confirmed: true` onto the matching SELF death inside 60s (agent 3.5.13).
    **`confirmed: false` means "no proof either way", NEVER "this was a
    feign"** — a rezzed death is real and unconfirmable, and a rogue corpse pull
    looks exactly like one. Full model: `docs/DESIGN-death-semantics.md`.
  - **Per-install clock skew is real and large.** Every agent stamps events from
    its own machine clock — and EQ writes the log timestamps with that same
    clock — so a slow machine reports slow deaths, slow casts, slow everything.
    Two independent estimators now land in `agent_clock_offsets` so they
    cross-check: `pulse` (agent sends `client_now` on the 20s heartbeat, bot
    computes `server_recv − client_now`, EWMA, flushed every 5 min — agent
    3.5.10 / bot 3.1.7) and `consensus` (for a 3+-witness death the median is
    truth; needs no agent release, so it reaches history). The consensus pass
    must be TWO-PASS — a single-pass median is dragged by the skewed observers
    it's trying to find. **Measured: two installs at −42.3s and −14.0s;
    everyone else inside ±4s.** The agent warns its own user once when it sees
    itself out by >5s.
  - **Raid Review "Trash Cleared" counted daytime kills.** `noteTrashKill` had
    no raid-window guard, so mobs killed at 2pm landed in that night's tally
    (bot 3.1.1). Same predicate as everything else — `raidNight.isRaidNightAt`.
  - **`raid_nights` actually implemented** (bot 3.1.4): the table existed and was
    empty. Night row created on the first encounter that resolves; encounters
    stamped `raid_night_id`; out-of-window kills stay NULL on purpose. Backfill:
    **193 nights, 1,022 encounters**, SQL cross-checked against the JS on a
    30-row stratified sample.
  - **`encounter_threat_snapshots.boss_name` was NULL on all 463k rows by
    construction** — assigned only at flush, while the uploader refuses to run
    once `flushedAt` is set. Now sends `et.bossName || et.targetName`. Cadence
    18s → 6s, tunable mid-raid via `tuneNum('threat_snapshot_ms')` clamped
    2s–60s. `encounter_id` claimed bot-side at flush (`claimThreatSnapshots`) —
    the agent cannot know it, the row doesn't exist until the fight ends.
  - **`target_observations`** (bot 3.1.2): `character_live_state` is keyed
    `(guild_id, character)`, so every target switch overwrote the last — 576
    rows for the whole guild, forever. Now appended **on change only**, so rows
    scale with switches not samples.
  - **Buff-cast `spell_id` unresolved 34.4% → 0.5%** (bot 3.1.6): resolve by the
    name the agent already sent, accepted only when unique in the catalog. The
    cure queue reads poison/disease counters off `spell_id`, so a 0 meant it
    could never learn a debuff was curable.
  - **Mimic 2.3.0 (beta)**: installs a pending update the moment **EQ closes**
    (15s grace, re-checks presence, so crash-and-relaunch defers) — Mimic was
    downloading updates and then waiting for an app quit that never comes.
    Otherwise it only nags hourly via an OS notification, which structurally
    cannot steal focus from the game. Plus Settings → **Resource use** (real
    `app.getAppMetrics()` per-process CPU/memory, 2s refresh — measured on the
    user's own machine, not a claim), EQ-presence polling backed off 10s → 45s
    while EQ is closed (**76% fewer `tasklist` spawns**), and a dashboard notice
    when Zeal has an update outstanding.
  - **Callouts shipped straight to `guild_triggers`** (live in ~2 min, no
    release): Feeblemind in/out for Thought Horror Overfiend (26s "FEEBLEMIND
    OUT" ahead of the 30s recast), Shadow Poison (curable, so it's worth
    calling), Wave of Death. **Sha's Advantage** and **Tigir's Insects** added
    to the agent's slow table with magnitudes, and the slow badge now names the
    class (`BST SLOW 50%`).
  - **CH chain**: a stale log file is no longer "you" (3-minute freshness gate —
    this is what made Dant hear Aimey's callouts on their shared machine), and
    bracketed heal targets parse.
  - **`golden-log.yml` had never run once** — invalid YAML (colon-space in a
    plain scalar) since the day it was added. Fixed, plus
    `test/workflow-yaml.test.js` so no workflow can silently not-exist again.
  **⚠ Two things deliberately NOT done, both need Hitya's call** — see the Open
  TODO section: cleaning feigns out of the stored history, and re-deriving the
  death dedup window.

- **`beta` had no CI, and it was hiding a P0 (2026-08-04)** — agent **3.5.15**,
  and the reason it took four releases to notice.
  - **The beta agent had not STARTED since 3.5.5.**
    `FATAL: ReferenceError: _threatSnapMs is not defined`. v3.5.5 made the
    threat-snapshot cadence tunable, renaming the interval constant
    (`_threatSnapMs` → `_threatSnapEnvMs` + a per-tick `_threatSnapCadenceMs()`)
    and leaving the `setInterval` argument behind. `startChatRelay()` runs
    unguarded on the **watch-mode** path — the default and the only mode raiders
    use — so 3.5.5, 3.5.10, 3.5.11, 3.5.12, 3.5.13 and 3.5.14 all printed the
    ready banner and exited. **Stable was never affected.**
  - **`beta` had NO CI AT ALL.** `test.yml` and `golden-log.yml` both declare
    `push: branches: [main, beta]` — which reads as coverage — but GitHub runs
    the workflow file **from the branch being pushed**, and neither file existed
    on `beta`. Confirmed against the API: golden-log had **24 runs on main and 0
    on beta**. Every agent change lands on `beta`, on the 30k-line component that
    ships to end-user machines, with nothing checking it. Both workflows,
    eslint, the golden fixtures and the devDependencies (beta had none, so
    `npm ci` installed neither vitest nor eslint) are now on `beta`. Lint caught
    the P0 on its first run there.
  - **New: `test/agent-boots.test.js`** spawns the real process and asserts it
    stays up. Nothing we ran had ever executed the startup path — the unit suite
    imports the module and calls exports, the golden replays `parseEvent`,
    `check:dashboard` parses template literals; **`main()` was never invoked by a
    test.** Its second case reintroduces the exact 3.5.5 defect in a scratch copy
    and asserts the harness reports it, so it can't quietly go vacuous.
  - **Also fixed (agent 3.5.14): `_deadMobNameFromLine` still matched
    `die[ds]`** — the second death-regex site, missed by the 3.5.11 feign fix. A
    feign cancelled any countdown targeting that player AND wiped their
    buff-landing/slow buckets via `_clearNameObservations`.
  - **Lesson worth keeping:** two workflows *declaring* a branch is not the same
    as running on it. `test/workflow-yaml.test.js` (added after golden-log.yml
    shipped as invalid YAML and never ran) catches a broken workflow but not a
    **missing** one. Both failures looked exactly like green CI.

### Task-number registry — minted 2026-08-02 for the public roadmap queue
The wolfpack.quest/roadmap "What's next" queue (web 1.0.288: numbers + member
voting + blocked-on-evidence submissions) shows a canonical `#` per item.
Items that already had ledger numbers keep them (#56, #68–70, #75, #80, #81,
#84, #86, #87, #114, #142, #144, #156, #169). These were UNNUMBERED and got
minted here — the numbering is now owned by this ledger, next free is
**#209** (#200–#207 minted 2026-08-04 for the death/timestamp follow-ups and
the callout designs, and **#208** was taken the same day by the item-page
under-reporting fix; all of them are written up in the Open TODO section, not
here — corrected 2026-08-09, this line still read "#208"):
- **#190** dead ^-anchored guild triggers batch (rn-buster-audit follow-up) —
  **MEASURED + FIX PREPARED 2026-08-04: `docs/RUNBOOK-dead-triggers.md`.**
  **37 of 109 enabled triggers can never match a log line**, including the eight
  Feeblemind / Shadow Poison / Wave of Death callouts built this session — one of
  which was rushed out ahead of a raid and has never fired. Patterns run against
  the RAW line (`[Sun Aug 02 21:10:01 2026] …`) with flags `i` and no `m`, so `^`
  anchors before the timestamp, not before the message. Verified by lifting the
  shipped `_translateDotNetRegex` and running the real compiled patterns against
  real-shaped lines, with an unanchored control to prove it's the anchor.
  One-line fix (`^` → `^\[.+?\]\s+`) restores matching and captures cleanly
  including multi-word/backtick names; **deleting the `^` instead is wrong** —
  `{s}` allows spaces, so it captures a leading space and corrupts every
  name-keyed consumer. **Not applied — needs Hitya's go-ahead**, and the runbook
  stages it: the 8 from this session (requested work, boss-scoped, low noise)
  vs the other 29 (long dormant; six slow-landed callouts firing on every pull
  is a real noise risk the day before a Vex Thal night).
- **#191** Parse Log duplicate embeds (near-identical archive entries seconds apart)
- **❓ `release-parser.yml` has run exactly twice, both on 2026-05-31** (one push,
  one manual dispatch) — so the standalone **CLI zip** has not been rebuilt since
  then, while the bundled-in-Mimic agent has moved from 3.4.x to 3.5.15. Its
  trigger is a `v*` tag push, and Mimic's release tags are created by the Actions
  token, which by design does not trigger other workflows — so it will never fire
  on its own. **Not filed as a bug:** if the intent is "dispatch manually when we
  want a CLI release", this is working as designed. Needs a one-line answer from
  Hitya — *does anyone still run `Parser.bat` standalone?* If yes, they are two
  months behind and the feign fix has not reached them. Noticed during the
  2026-08-04 workflow sweep (the rest are main-only, tag, scheduled or manual —
  `test.yml`/`golden-log.yml` were the only two declaring a branch they were
  absent from).
- **#192** onboarding overhaul v1 (`DESIGN-onboarding-overhaul.md`)
- **#193** Zeal spawn-id ask + consuming it (`zeal-spawn-id-request.md`)
- **#194** serialization phase 2 — position-clustered same-name instances —
  **phases 0-1 + the phase-2 coverage forwards SHIPPED 2026-08-05** (bot
  3.1.10 main, agent 3.5.30 beta) for the Thall Va Xakra twin-add pull;
  remaining: feed K_pos into the agent's #56 local tracks, N>2 soak,
  per-instance HP history. Hitya 2026-08-04: upstream Zeal ask has zero
  traction — the end-around is now the plan of record
- **#195** UI Studio web viewer/editor + UI/eqclient.ini cloud backups
- **#196** /me advisors (spells / tradeskill / faction)
- **#197** long-haul storage partitioning
- **#198** EQLegends support (`DESIGN-eql-support.md`)
- **#199** fight pages, EQL-Meter style (presentation only — DoT chart, damage
  mix, per-ability breakdown; phase 1 web-only from encounter_combat_rollup,
  phase 2 agent adds time-bucket damage series + outgoing crit/miss counts)
Member votes land in `roadmap_votes` (RLS service-role-only; migration
`20260802031500_roadmap_votes.sql`); evidence submissions ride the existing
`feedback` pipeline prefixed `[roadmap #N — title]`, so they surface in the
Discord #feedback thread + /admin/feedback automatically.

### 🌙 Raid-night review findings — 2026-08-05 Vex Thal (opened 2026-08-06)

**R1. Death OVERCOUNT is clock skew, and it is now fully diagnosed — SHIPPABLE.**
`DEATH_DEDUP_MS = 30_000` (`web/lib/raidReview.ts:26`) merges two uploaders' view
of the same death only when their timestamps are within 30s. Fargan's measured
offset is **59,224 ms** — nearly DOUBLE the window — so every death his log sees
is counted twice. The 2026-08-05 review shows 17 deaths where 8 names each appear
twice at 8:41 PM, once flagged `riposte kill` and once bare.
**FIXED — bot 3.1.20, 2026-08-06.** The offset is applied at INGEST
(`utils/clockOffset.js` + `_resolveClockOffsetMs` in `index.js`): `ts` is
rewritten to server time and the original kept as `tsRaw`, so dedup, phantom
suppression, the Discord card, the web parse page and the timelines all become
correct with no consumer changes. Pulse only — the `consensus` rows have zero
write sites and are frozen at 2026-08-04 (that estimator reads Fargan at 42s
where pulse, still measuring, reads 63.5s). Spread gate is 30s and the
calibration is pinned by a test: fleet spread is a record of the worst ROUND
TRIP, median 7.2s and 15 of 28 installs above 5s, so a "conservative" 5s gate
would have rejected Fargan's 10.3s machine — the one it exists to fix.
Do NOT fix by widening DEATH_DEDUP_MS: real deaths 30–60s apart in a long fight
would silently merge, trading a visible overcount for an invisible undercount.

**R2. Intentional deaths need an officer flag. BUILT — bot 3.1.21 / web 1.1.19.**
Standing rule keyed (character, `npc_id`) in `intentional_death_rules`; officers
set it from the fight's own `/parses/[id]` page (the design's open question,
resolved that way — no new admin surface, and the page already knows the
encounter, its npc_id and who died). Excluded from `worstFights` and NOWHERE
else: the death keeps its place in the headline count, the deaths list and the
timelines, and the header now reads "5 deaths (2 on purpose)". Fawx + Dant on
Kaas Thox Xi Ans Dyek (158444) seeded from the report. The phase-2
`intentional_death_overrides` table is still unbuilt on purpose.

**R3. Raid-night thread reserves the first two slots for the review. BUILT —
bot 3.1.21.** `reserveReviewSlots()` posts two placeholders the instant a raid
thread is created — the only moment "first in the thread" is still available,
since Discord orders by post time and cannot move a message — and
`_getReviewMessageId` falls back to slot 1 so `postOrEditCard` EDITS into first
position instead of sending. The second slot is R5b's overflow landing spot and
is DELETED by the final review if unused, so a permanent stub never lingers. No
claimed-flag bookkeeping: "unclaimed" is just "not the stored review id", which
makes a failed edit retry against the same slot instead of burning it.

**R4. Trash section includes mobs from outside the raid. FIXED — bot 3.1.18,
grace tightened to 15 min in 3.1.19.** The report said "earlier in the day"; the
persisted data said the reverse — all 89 entries landed AFTER the last boss died
(first trash 21 min after, last still going 70 min after). Cause was
`isRaidNightAt()`, deliberately open-ended at the tail so a raid can spill past
midnight — right for routing threads, wrong for "what did the raid clear".
`trashBoundsFor()` now bounds the tally to [first pull, last CONFIRMED kill] ±
grace, and returns `{}` mid-raid when nothing is dead yet (bounding to a kill
that does not exist would erase legitimate pre-first-pull trash). Grace is 15
per Hitya — the line is the last DKP tick. Deliberately tighter than web
`activitySpan()`'s 30-min pad, which pads fight EDGES where erring wide is free;
this one decides membership, where erring wide IS the bug.

**R5. Only 4 of 12 fight timelines rendered. RESOLVED — bot 3.1.17.** Not a bug:
`utils/raidReview.js:700` drops fights with no in-window player death, because
the section is a deaths-only sparkline and a clean kill renders a flatline of
noise (comment at :873-877). Verified — the 8 omitted fights had ZERO deaths from
any of the 6-9 uploaders, and the header's "7 deaths" equals the four rendered
timelines' 2+2+2+1 exactly. The BUG was the silence: "(4)" printed under "12
down" with nothing connecting them, so a suppressed clean kill was
indistinguishable from a fight we failed to record. Now reads "(4 of 12)" with
"8 clean kills not shown — nobody died".

**R5b. Optional embed fields are SILENTLY DROPPED at the budget.** Found while
investigating R3, unrelated to R5's cause. `utils/raidReview.js:839-846` — when
`EMBED_BUDGET` (5800) is spent, optional fields (timelines, trash, campfire)
return early and vanish with no trace. This is the real justification for the
second review slot in R3.

**R6. Partial parse on Diabo Xi Va (64k damage, flagged `*`).** The review itself
says "only a partial parse reached us for this one". 8 of 12 kills got full
parses; this one did not. Worth finding out whether an uploader dropped, the
fight was too short to flush, or the encounter split.

### 🔴 Raid-night queue — opened 2026-08-05/06 (Vex Thal)

Hitya, 2026-08-06: *"I'm mostly queueing things up to work on while we have
live data to work on."* So this section is split by WHAT IS PERISHABLE. The fix
is almost never the scarce part — the OBSERVATION is. Anything under "capture
next raid" cannot be reproduced cold and should be grabbed on the next
Sun/Wed/Thu window before touching the code.

#### 📸 Capture next raid (perishable — cannot be reproduced cold)

0. **Zeal `/tag` TTL is 120s and a boss fight is 5–10 min.** CONFIRMED WORKING
   2026-08-06: six uploaders independently captured
   `{mob:"Thall Va Xakra", text:"KILL AND SLEEP", tagger:"Melting", spawn_id:360}`
   — the spawn id is real and arriving. Then it expired mid-fight. Raise
   `_TAG_FRESH_MS` (agent) AND `ext_tag_fresh_sec` (bot tuning, live-settable);
   the agent expires first, so the bot knob alone will not help.
   ⚠ **Before blaming capture, check the tagger's Zeal settings** (2026-08-07):
   `/tag suppress on` drops the broadcast before it is ever written to the log
   (cost us every capture from one raider for a whole session — their own tags
   never reached their own agent), and `/tag prettyprint on` rewrites the line to
   `text => mob` and **strips the spawn id**, degrading the tag to a name we
   already had. `/tag local` never broadcasts, and the server rate-limits chat
   (~8/min). **The nameplate arrow is NOT evidence the broadcast happened.** Both
   settings are warned about on the Mimic dashboard's tag-capture card.
1. ~~**DI-fired trigger — BLOCKED, needs one real log line.**~~ **✅ RESOLVED
   2026-08-09 — no capture needed after all.** The fire message was verified at
   the SERVER source instead of a log: Quarm's codebase (EQMacEmu,
   `zone/spell_effects.cpp` `TryDeathSave()`) emits StringID **1029** =
   `%1 has been rescued by divine intervention!` to everyone within 200 units
   including the saved player, always name-form. A FAILED save emits **no
   message at all** — a "survived divine intervention" line circulating in
   AI/GINA answers does not exist on Quarm; never add it. New enabled trigger
   `Divine Intervention fired (death save)` (`60d9797f…`) carries the verified
   pattern; the old row is repointed at spell 1546's real landing text and its
   TTS now says "landed", not "fired". Full provenance:
   `DESIGN-di-callout.md` §0. Tonight's watch item is just: does it FIRE.
1b. **🔴 `/restore` stamps `killed_at = now`, so 7 Vex Thal timers are ~23h
   LATE (found 2026-08-09).** The bulk restore run on 2026-08-06 21:15–21:17 ET
   wrote that clock as the kill time for every boss it touched, instead of the
   real kill time. `/recoverkills` does it correctly (it reads
   `encounters.started_at`), which is why the `killed_by='recovered'` rows are
   right and the `killed_by='restored'` rows are not. **Cost: the board says
   Vex Thal is up Thu 08-13 15:15; it is actually up Wed 08-12 15:09–17:27 —
   before a raid-night start. As it stood we would have skipped a full clear.**
   Affected (real kill → correct spawn): Thall Xundraux Diabo 15:47, Va Xi Aten
   Ha Ra 16:02, Diabo Xi Va 16:16, Aten Ha Ra 16:22, Kaas Thox Xi Aten Ha Ra
   (South) 16:49, Diabo Xi Va Temariel 17:16, Thall Va Xakra (South) 17:27 (all
   Wed 08-12 ET). **Fix the CODE too** — `/restore` should take the kill time
   from the encounter/message it restores, not `Date.now()`.
   Two related facts worth keeping:
   - **Thall Va Xakra was killed TWICE on 08-05** (21:09, 35 players; 23:27, 42
     players) but only ONE timer was ever set, so the North twin sat with no
     timer at all — which is why a stray board tap could "record" it. Undo then
     cleared it: for a `kill`/`kill_board` action Undo calls `clearKill()` and
     never restores, because `prevState` is hardcoded `null` on that path
     (`index.js` kill_board `postAuditEntry`). **`prevState: null` in an audit
     row is therefore NOT evidence that no timer existed** — only the
     `kill_board` vs `unkill_board` action tells you that.
   - **Diabo Xi Xin's timer (08-08 08:57, from the corrupted foreign encounter)
     is CORRECT** and must not be "fixed": the mob genuinely died then, whoever
     killed it. A foreign parse can still be a true respawn signal.
2. **`[ext-pos]` shadow log for a REAL twin-add pull.** Gates on
   `engaged.length >= 2`, so it needs two tanks genuinely hit by two same-name
   mobs. Tunes `ext_pos_cluster_units` from measurement instead of the 25 guess.
2b. **🐞 P1 — agent emitted a SESSION-CUMULATIVE encounter payload (found
   2026-08-09, encounter `3b1069fd…`).** Smokestomp (agent 3.5.54, queue
   drained ~11h late) uploaded a Breakfast Club Sat-morning Diabo Xi Xin
   fight TWICE: first a correct 31-player/1.01M/943s payload (preserved in
   the Discord 📊 Parse Log), then a corrupted 95-player/2.55M payload —
   same 943s duration, every number ≥ the first, per-player values matching
   **the whole day's witnessed damage** (his own 239k → 868k; the WP
   Saturday-EVENING dragon crew — Tycon/Timberowl/Alondra/Uilz/Fargan —
   appear with plausible evening totals despite never being in the fight;
   Hitya confirms they were not there). Max-merge folded it in; the inflated
   roster share (0.400) also defeated the auto-foreign hide. **Done same
   day:** encounter marked `foreign` (reason on the row); classification now
   excluded from /leaderboards (web 1.1.36) and `about_stats()` (migration
   20260809140000). **Root cause needs Smokestomp's machine**: his
   `logsync.log`/queue remnants + the Sat eqlog segment — which code path
   built a payload from day-cumulative per-player state? Note his OTHER
   morning fights (BC cleared several VT bosses) never uploaded at all —
   likely the same failure. Related unfixed gaps: character pages still
   count classified encounters; parse-thread mirror keeps the FIRST payload
   state forever (here that accident preserved the good data).
   **Evidence added 2026-08-09 (second pass):**
   - **The uploader is `Hawkner` (discord `189927438958985218`), whose linked
     characters include `Smokestomp` AND `Ikibob`** — i.e. the same person
     whose morning pug created the original foreign-raid problem
     (`web/lib/anomalies.ts` header, Hitya 2026-06-29). Same account, same
     behaviour, second incident. Any future foreign-raid tuning should assume
     this is a recurring pattern from ONE member, not a fleet-wide issue.
   - **The corrupted payload is a singleton.** Exactly one contribution
     fleet-wide since 2026-07-01 has `player_count > 55` (this one, at 95).
     Normal Vex Thal raids from the same uploader run 32–39.
   - ⚠ **But 3.5.54 exposure is 2 uploads by 1 person**, both from this
     account, both very late (11.6h — drained queue / backfill), one corrupt.
     "Singleton" therefore means *not yet seen elsewhere*, NOT *3.5.54 is
     clear*. Watch the first pulls of the next raid before concluding.
   - **The WP names in the payload were not in the fight** — settled
     independently of memory: chat capture was live through that window (29
     distinct speakers, 20 of them also in the parse), and of the 38
     roster-matching names in the payload **only `Smokestomp` ever spoke**.
     Combined with the Wednesday cooldown, the WP evening crew were absent.
   - Their **July 22 09:02 ET Kaas Thox morning raid** (`2d58dba8`, 47
     players, 55% roster) was ALSO re-uploaded on 3.5.54 an hour after the
     Diabo one. Above the auto-foreign bar, so still unclassified — an
     officer call, and the reason a time-of-day signal was proposed.
3. ~~**Healer-mana: were the shamans missing MID-FIGHT or between pulls?**~~
   **ANSWERED 2026-08-06 23:26 ET — NOT A BUG.** Observed mid-fight on Diabo Xi
   Va Temariel: Fungalfist (12%) and Ghalix (100%) both present. The earlier
   absence was the macro-roster's 5-minute between-pulls GC working as designed.
   No code change. (Same session also confirmed the druid class labels reading
   correctly — but that does NOT validate the 3.5.38 fix, which was not
   installed: it only shows the DI-status piggyback had data, which is exactly
   when the flap does not occur.)
4. **Raid ticks failing / output files blank.** The DKP TICKS panel went
   "cannot submit" → "No attendees in that source" → then worked. Grab the
   failing state: which slot, what the file contained, what the network call
   returned.
5. **No "Loot posted" TTS at 23:13 ET 2026-08-05.** The pipeline is fully built
   on both halves — the bot rings `_recordLootPosted` and the agent consumes it
   in `_consumeLootPosted` — so this is almost certainly one of two gates, and
   only the person who missed it can say which:
   `const voiceOff = _optinState.lootAuctionTts === false || stale;`
   **Check on the machine that missed it:** is the loot-auction TTS toggle on,
   and did the chip appear silently (⇒ `stale`, i.e. the post arrived older than
   `LOOT_ANNOUNCE_FRESH_MS`) or not at all (⇒ the poll never delivered it —
   check `_multiplexActive` / `_recentFiresActive` / control stand-down).
   Ruled out already: the bot's in-memory ring seeds from `Date.now()` at boot
   and the bot had been up ~6h, so this was not a deploy dropping the event.
6. **`/raid` slow load UNDER RAID LOAD.** Not the obvious suspect — the
   `buff_casts` pull is properly served by `buff_casts_recent_idx
   (guild_id, cast_at DESC)`. The page fires many parallel queries; it needs real
   profiling while 43 raiders are live, not another hypothesis.

#### 🔧 Cold work (do any time — no raid needed)

7. **Extended Target over-split — KILL SWITCH IS ON** (`flag_ext_pos_off=1` set
   in `overlay_tuning` 2026-08-05 mid-raid). A unique boss split into 6 then 8
   rows, all at identical HP and DPS. Hitya's diagnosis is the root cause:
   *"the boss we just fought has a larger melee range because it's a larger
   mob"* — `ext_pos_cluster_units` is a flat 25, but a big model lets melee
   stand far wider while on ONE mob. Two fixes: scale the radius by
   `eqemu_npc_types.size`, and never split when every cluster shares HP **and**
   DPS. **Turn the switch back off only after both land.**
8. **Bubonian Rabies (spell 1070) shown as a debuff ON the boss.** Mana 0, skill
   Conjuration, target type "Area of effect around the caster", resist Disease
   −300 — an NPC point-blank AE the boss cast on the RAID, mis-attributed to the
   caster. Matriarch Poison and Spirit Curse in the same list look like the same
   error. Likely the target resolving to the observer's current target.
9. **Finish the PostgREST 1000-row sweep** (started in web 1.1.13,
   `lib/selectAll.ts`). Still truncating: `/pvp` over `who_observations`
   (115,554 rows), `admin/members`, `admin/signups`, `admin/analytics`, `fun`,
   `guide`, `pop`, `factions`. Also `/raid`'s own `buff_casts` pull says
   `.limit(3000)` and silently gets 1000 — it orders `cast_at DESC` so it takes
   the NEWEST, but a raid making 11k casts in 2h means inference may span only
   minutes.
10. **`encounter_threat_snapshots` retention — PARTLY DONE 2026-08-08, the raw
   tier is still untouched.** Shipped (bot 3.1.32): raid-activity gating,
   unchanged-scoreboard suppression, and the night-grain roll-up that took trash
   from 114,444 rows → 1,087 (31 MB → 4.8 MB, ~49 MB/yr). **Still open: raw
   retention, at its default 120 days** — and the comment justifying that number
   estimates ~7 MB/week against an actual ~90 MB/week, so the decision was never
   really made. Hitya has chosen a **2-month hot window** for the two-tier model
   (~730 MB steady state, vs ~170 MB at the originally-proposed 14 days) — *"I'd
   like to keep 2 months full before tuning down."* Order: hot-tier retention
   FIRST (one policy, no code), roll-up + cold `encounter_series` next, and **do
   not delete anything before the roll-up is verified against the raw rows for
   the same fight**. Full two-tier model + the measured 14.5× in
   `docs/DESIGN-fight-timeline.md`.
11. **Duplicate index:** `buff_casts_target_idx` and
    `buff_casts_target_recent_idx` are byte-identical
    (`guild_id, target, cast_at DESC`). Drop one — pure write cost.
12. **Fight timeline v2 — DATA LAYER DONE 2026-08-09; the CHART is the remaining
    work.** `encounter_timeline()` ships in migration `20260809030000`, the
    binding root cause (name FORMAT) is found and fixed at read time, and the two
    capture-side pieces are in flight tonight (agent `ramp` on beta 3.5.55, bot
    `encounter_id`-at-close 3.1.34). What is left: the chart on `/parses/[id]`,
    and **one decision from Hitya** — the sketch says class toggles *or* a
    searchable damage-dealer list; recommendation is BOTH against one selection
    model (a set of highlighted characters, class buttons as bulk selectors over
    that set), so there is one highlight mechanism and no second code path.
    `docs/DESIGN-fight-timeline.md`.
13. **Same-name discriminator via damage-TAKEN ratio — MEASURED, not built.**
    `docs/DESIGN-samename-took-ratio.md`. Tested against the real Va Xakra twin
    adds (encounter 7dfe09b3, 2026-08-06): two mobs show a second-highest taker
    within ~0.75–1.19× of the highest across consecutive buckets, while a boss
    with rampage/AE splash sits at 0.23–0.38×. Needs no Zeal, no position, no
    spawn id — so it also covers pet-tanked mobs, which the position path can
    never place. Backtestable over 36,784 fights of durable `took` history
    BEFORE shipping. Solve the repeated-`821` stale-delta anomaly first.
14. **The "tanking check"** (deferred by Hitya 2026-08-05): concurrent
    connect streams as a K signal, plus recording mobs that hit our PETS —
    `recentTankHits` drops them today because `_isPlayer` rejects multi-word
    names, so a charm pet tanking contributes zero evidence.
15. **Rewrite `docs/zeal-spawn-id-request.md` against `named_pipe.cpp`, then
    SEND both asks.** The current ask targets the gauges, the hardest possible
    surface. See the corrected CLAUDE.md scope-boundary note: `Entity.SpawnId` is
    one unwritten line away from data the pipe already sends. Its sibling —
    `docs/zeal-tag-spawn-id-collision.md`, the measured report that `/tag` spawn
    ids are per-zone and structurally collide (ids allocated in spawn order from
    a low base in every zone; 14 named NPCs inside ids 11–45 in one zone alone) —
    is also **drafted and unsent** as of 2026-08-07. Neither has been sent to
    upstream; Hitya's read is that the ask has zero traction, so the end-around
    (#194) is the plan of record either way.

### 🧾 2026-08-10 → 08-11 — Ssra review night, graduation, and the sync rule

**Shipped (all verified live, not assumed):**
- **Mimic 2.3.5 / agent 3.5.58 STABLE** (`v2.3.5` published, `prerelease:false`,
  file-level promotion; main's full 92-file/1435-test suite green against it).
  Carries the whole Ssra fix batch: timer identity from semantic captures (one
  bar per mob, `timer_key_capture` honored), relay dedup keys without the raw
  line, relayed fires on TRUE time (`fired_at_true_ms`) + cooldowns honored,
  ambiguous slow landings render `SLOWED` (no invented spell/%), cross-client
  exact-HP age gate (20s vs the bot's 90s), and the death registry
  (`_noteDeath`/`_isDead` — off-heal list no longer publishes corpses).
- **Bot 3.1.37** — tagged mobs stay on Extended Target at any HP; trigger-relay
  ingest resolves sender stamps to true time; cross-agent dedup on true time.
- **RULE + workflow: when main gets something, beta gets it too** —
  `sync-beta.yml` merges main→beta on every main push (park files keep beta's
  side; any other conflict fails loudly; GITHUB_TOKEN so no spurious `-beta.N`).
  Beta re-parked at 2.3.6. Graduations REMAIN file-level promotions.
- **Emperor tank-buster prep callouts live** (DB-only, no release): 10s "big
  heals and spell shields" + 4s "start curse cures" via `timer_warnings` on
  trigger `0680b9f6…`. The capability existed since 3.5.52; the field was blank.
- **New trigger: Emperor aggro wipe** (`d2f9b74d…`) on the Diminutive Stature
  proc emote (`looks far less imposing.`) — spin stun + −95% aggro at 4%/swing,
  class-scoped to DPS. No target-name zeal condition exists, so the callout asks
  ("ON EMP? BACK OFF") rather than knows.
- **Boss zone audit**: `bosses_local.zone_short` had drifted from the seed on 6
  bosses (Galiel filed under mischiefplane since ≥March); fixed those 6 + 35
  encounter rows back to Jan 2025. Three PoP rows deliberately untouched
  (bertoxxulous / aerin_dar / agnarr) — on the PoP-unlock checklist.
- **Playbooks live on `/guide`**: `emperor_ssraeshza` (full strategy — Luter's
  writeup + catalog-verified numbers + spell 2310 decode incl. the −95% aggro
  curse and the Diminutive Stature proc) and `blood_ssraeshza` (Blood is the
  clock, not the fight). `data/bosses.json` seed was RIGHT throughout.

**New open items from the review (each has a design doc):**
- Mez chips keyed to the TARGETER, not the mez — a dead mezzer reads as
  un-mezzed while Rapture still runs; chips need owner names
  (`DESIGN-extended-target-v2.md` §4).
- CH chain: MT health on the chain overlay, interrupted casts must mark the
  slot, slot ownership must not be stolen by a mis-called number, and the GAP
  alert must be measured LOCALLY (cross-client compare carries skew+latency the
  size of the signal — why it's muted fleet-wide) (§5–6).
- DI nomination: name the ONE free cleric instead of broadcasting (§6).
- Threat: hate REDUCERS entirely unmodelled (SPA 92 — Ancient: Greater
  Concussion −600 etc., FD, evade); EQMac damage→hate weights unvalidated;
  MT margin/caution-tape design (`DESIGN-threat-mt-margin.md`).
- Trigger overlay v2: split timers from callouts, grow upward, one-row-per-mob
  render invariant, everyone-files Wrong button + replay-backed reports
  (`DESIGN-trigger-overlay-v2.md`).
- Mimic 3 voice packs (`DESIGN-mimic3-voice.md`).
- Death awareness surfaces + rez queue (`DESIGN-death-awareness-and-rez-queue.md`).
- Timer-warning sweep: which other timer triggers have a duration but NO
  `timer_warnings`? The Emperor's was a blank field, not a missing feature.
- Task #27 UNBLOCKED: restore the 8 muted trash triggers once raiders are on
  2.3.5 (the timer-identity fix is stable now).

**RULE (Hitya, 2026-08-11): implementation updates its documentation at BOTH
gates** — when a feature/fix lands on beta, its docs (this ledger + the relevant
design/HOW-ITS-BUILT entry) are updated in the same change; when it graduates to
main, the entry is updated again with the stable release version. A doc that
lags its code produces confidently wrong recall answers — tonight's recall
listed #202 as blocked when it had shipped.

### 🧾 Still open after the 2026-08-08/09 weekend
*(The short list a Monday session should read. Full reasoning per item is in
`DECISIONS-2026-08-07.md`; the deeper queues are the sections above and below.)*

| Item | State / next step |
|---|---|
| ~~**PR #78**~~ | **CLOSED 2026-08-11.** Verified live first: still open, and its diff had collapsed to exactly the park bump (`apps/mimic/package.json` 2.3.5→2.3.6) — merging would have cut an unintended stable 2.3.6 to the whole fleet. Its original content (the /who menu clip fix) had already graduated |
| **Kill switches untested** | The #74/#118 control plane (`flag_agent_kill`, `min_agent_ver_num`, the shed flags) has never been exercised in the field. Shipped as a conservative v1 pending Hitya's sign-off — a switch nobody has pulled is not a switch you can pull mid-raid |
| **Threat raw retention** | Untouched at 120 days; the justifying comment is off by ~13× (~7 MB/week claimed vs ~90 MB/week actual). Hitya has chosen a 2-month hot window — see Cold work #10 |
| **`opendkp_raids` / `_auctions` rewrite** | Still re-upserting themselves every sync (1.5M and 3.7M updates). Decision made, NOT implemented: re-upsert a closed raid only when its upstream `Version` moves; ticks/DKP/attendance corrections still flow |
| **Other capped-query-as-a-set risks** | The bot 3.1.33 loot bug's shape is generic — **23 other `limit=####` queries in `index.js`**, none audited for whether they feed a *set* rather than a *list*. Cheap sweep, real payoff |
| **Archived logs vanish from the backfill picker** | Log archiving is ON by default at 500 MB (idle 15 min, `WP_LOG_ROTATE_MB=0` disables) and archives rather than culls — but an archived log drops out of the smart-backfill picker until it is moved back. Archive, never cull, was the point |
| **Zone map overlay** | Blocked on a 1–2h **in-game coordinate spike**: the docs say Zeal transposes x/y, the dashboard path disagrees, and only a live client settles it. `docs/pq-companion/03-zone-maps.md` |
| **Report 04 P3–P5** | `docs/pq-companion/04-combat-parse-accuracy.md`, the three unshipped items: P3 bystander taunt-emote → per-player taunt threat (a `says` line — belongs in `PRIORITY_KEEP_PATTERNS`, watch the privacy filter), P4 wildcard-verb fallback for incoming damage (**must stay LAST** among damage patterns), P5 real hate for non-damaging detrimentals (`maxHP/15`) + miss hate + backstab cap |
| **Fight timeline chart** | Data layer done; chart unbuilt, and it needs one call from Hitya (class toggles vs player search — recommendation: both, one selection model). The two formerly in-flight pieces LANDED: agent `ramp` reached stable in 3.5.58 (Mimic 2.3.5, 2026-08-10) and bot `encounter_id`-at-close shipped in 3.1.34 |
| **Both Zeal upstream asks unsent** | `zeal-spawn-id-request.md` still aims at the gauges (rewrite against `named_pipe.cpp` first) and `zeal-tag-spawn-id-collision.md` has never been sent. See Cold work #15 |
| ~~Beta adoption near zero~~ | Addressed twice: graduated 2026-08-09 AND again 2026-08-10 (Mimic 2.3.5 / agent 3.5.58 — the whole Ssra fix batch went stable within a day instead of waiting on beta users who don't exist). `sync-beta.yml` now keeps beta = main + park continuously. **Standing posture: short beta lines, graduate fast** |

### ⏳ Open TODO — carried forward from the retired docs
*(These are durable items; the active wave order is in `DESIGN-platform-queue.md`.)*

**Fight timeline v2 — boss HP curve + MT/RAMP lanes + class/player highlighting.
DATA LAYER BUILT 2026-08-09, CHART NOT BUILT. Full spec + data audit:
`docs/DESIGN-fight-timeline.md`; what shipped is in the Done section above.**
Hitya's napkin sketch 2026-08-06. The load-bearing finding is that the series
already exists: `encounter_threat_snapshots` holds **490,850 rows across 36,784
fights** of cumulative per-player `dmg`/`took`/`tookMax`/`pet_owner`, at a
measured 3.5–6.4s cadence. The area chart, the class filtering AND the MT lane
(argmax of Δ`took` per interval) are all derivable from it with no new capture.
Both original gaps are now closing: (1) `rampageDmg` is computed by the threat
tracker but was never serialised into `per_player` — the agent adds `ramp` on
beta 3.5.55 (in flight 2026-08-09), so the RAMP lane stops being an inference;
(2) snapshots were effectively unbound to encounters — **root cause was name
FORMAT, not a backlog** (underscored/`#`-prefixed catalog names vs the agent's
display names, so equality matched only single-word bosses; 2.6% of fights bound).
Read-time normalisation ships in `encounter_timeline()`; ingest-time binding is
bot 3.1.34, in flight. Remaining: the chart itself. Do not re-derive this audit;
it is in the design doc.

**#208 Item pages under-reported — and NO DROP rendered BACKWARDS. DONE
(2026-08-04, web 1.1.8).** Found by Hitya comparing `/db/item/8733` with
pqdi.cc. Every missing field was already in `eqemu_items`; it was a rendering
gap, not a sync gap.
- **`nodrop` is INVERTED** — the column means "can be traded", so `false` =
  NO DROP. Three surfaces read it raw and printed the flag backwards on all
  ~27k items: the `/db` item page, the inventory tile border
  (`InventoryView.tsx`), and the hover card (`ItemHover.tsx`). **16,957
  tradeable items were tagged NO DROP and 10,014 genuinely no-drop items showed
  nothing** — the site answered "can I pass this to someone?" with the
  opposite of the truth. `me/inventory` and `character/quests` had it RIGHT and
  each left a comment saying so, which is the exact split
  `isNoDrop()`/`isNoRent()` in `web/lib/itemDecode.ts` now ends.
- **`lore_flag` is dead** (false on all 26,971 rows) — replaced by EQEmu's real
  marker, a leading `*` on the lore string; 11,148 items now show LORE ITEM,
  and `loreText()` strips the marker from the displayed text.
- **Worn + proc effects** were never rendered (only clicks); 1,560 items gain
  an effect line linking to `/db/spell/<id>`. All three effect names resolve in
  ONE query.
- **Attribute block** (STR/STA/AGI/DEX/WIS/INT/CHA) added.
Verified against #8733: the page now prints MAGIC ITEM · LORE ITEM · NO DROP,
STA +20 / WIS +15, worn + combat effect Truesight — matching pqdi.cc field for
field. Tests: `test/item-flags.test.js`. **Correction to the original note:**
vendor sources were NOT missing — `/db/item` already has a "Sold by merchants
in" section; it simply had no rows for this item.

**Death + timestamp follow-ups (2026-08-04) — the four that need YOUR call
before anyone touches them.** All four exist because of the two bugs found
2026-08-03 (feign deaths counted as deaths; per-install clock skew up to 42s).
- **#200 Clean feigns out of the stored window** — **smaller and less urgent
  than it first looked, and it comes with a bigger finding.** Deaths live in
  `contributions.raw_parse`, which the midnight job **nulls after 7 days**. So
  the entire stored death corpus is **534 rows over 2026-07-28 → 08-03**, of
  which 193 are already dropped by the phantom rule and **83 actually display**.
  **It self-clears around 2026-08-10 whether we act or not.** Three options:
  (a) do nothing and let it expire, (b) flag the suspect rows + a roadmap note
  explaining why death counts changed *(recommended)*, (c) flag silently.
  **The bigger finding: we have no durable death history at all.** Beyond 7 days
  there are no deaths to be wrong about — "who dies most", "are we improving on
  this boss", "what mechanic kills us" have never been answerable. Everything
  from agent 3.5.11 forward is trustworthy for the first time, so **now is the
  moment to give deaths a real table**. Full evidence + ordered steps:
  `docs/RUNBOOK-death-backfill.md` (rehearsed read-only, stops at a confirm gate).
  Related: `utils/parseDeaths.js`'s phantom rule ("a player can only die once per
  encounter") is FALSE once feigns are gone — rez-and-die-again is normal and a
  rogue corpse pull is deliberate. Revisit it with #200.
- **#201 Re-derive the death dedup window** — **half-resolved by #202 shipping**:
  offsets are now applied at ingest and dedup consumes corrected stamps, with the
  30s window deliberately UNCHANGED (its own worked example predicted correction
  alone fixes the phantom). Still open: measure the post-correction spread before
  ever retuning the window. Original reasoning kept below because the method
  matters ("do not retune by eye — that's how we got 30s"). The 30s same-name collapse
  (`utils/parseDeaths.js`) was fitted against feign-inflated, skew-spread data.
  **Worked example**: Uilnayar died ONCE on 2026-08-03 and seven machines saw it
  — six agree inside 6 seconds, and Fargan's is **45 seconds early**, because
  Fargan's install is the `+42.3s` one. 45s > the 30s window, so the card said
  she died twice. Correcting that one stamp puts it 2.7s ahead of the cluster and
  it collapses correctly with the window *unchanged*. So: apply offsets first,
  then measure what spread is left, then set the window from that. **Do not
  retune by eye — that's how we got 30s.** Deliberately untouched.
- **#202 Apply the clock offset at ingest, keep the raw stamp** —
  **`docs/DESIGN-clock-correction.md`. The premise changed: the bad clocks are
  DRIFTING continuously (~1.5–3 s/day), not set wrong once — and a one-time sync
  provably doesn't hold.** 30-day history (morning re-verification, 2026-08-04):
  Fargan's install has slid **uninterrupted for ≥ a month** (7.5s Jul 8 → 56.5s
  Aug 4, never corrected, last day +8s); **Bardtholemu's was manually synced to
  ~0 on Jul 26–27 and was 11s off again by Jul 29** — we watched the fix fail.
  So a single stored `offset_ms` is stale within a week and corrections must
  resolve an offset *near the event's own timestamp* — offsets are a time
  series, not a number, **and interpolation must not span a sync-reset step**
  (Bardtholemu's 39s → 0 overnight). **By Wednesday Fargan's install will be
  ~1 minute off**, enough to move a kill across the 19:30 raid boundary by
  itself.
  **A third estimator fell out of data we already have and costs nothing:**
  every table with an agent-stamped event time also has a server-stamped
  `created_at`, and `min(created_at − event_ts)` per install per day is a lower
  bound on skew (one-way-delay min filter). It reproduces both known outliers,
  works retroactively on history, needs no agent release — and **found a third
  drifting install (`6333…7023`, +0.8 s/day) that consensus never measured**,
  because consensus needs a 3+-witness death and that uploader never had one.
  Use `min`, never mean/median: one control day shows a 44-hour lag from a
  `--since` backfill. Guard with a ~300s ceiling + a 30-row floor.
  **Verified cross-stream** (the clock-vs-latency discriminator): per-day
  min-lag computed independently from `buff_casts` and `chat_messages` agrees
  within **0.1–0.4s on every day for all three installs** — pipeline latency
  can't do that; a clock does. Control group (18 of 21 uploaders with volume,
  last 4 days) sits between −2.9s and +1.8s, which rules out a global upload
  slowdown. **Pulse is live**: the first 3.5.15 install (Hitya's) began
  heartbeating 2026-08-04 ~11:30 UTC — pulse +0.4s vs consensus −1.3s, agreeing
  within spread, so all three estimators now cross-check.
  **SHIPPED — the call was made and the design landed exactly as recommended.**
  Bot 3.1.20 applies the heartbeat-measured offset at ingest and keeps the raw
  stamp alongside (the /onboarding entry for 3.1.20 is the member-facing half:
  "deaths stop counting twice for people whose PC clock is off"); death dedup was
  the first migrated consumer (skew-corrected dedup, 2026-08-09). The agent
  attaches `clock_offset_ms` + `clock_measured_at` to EVERY payload (#202 comment
  at the enqueue site), and 2026-08-10 extended the same machinery to two more
  consumers: trigger-relay fires resolve to true time at ingest
  (`fired_at_true_ms`, bot 3.1.37 + agent 3.5.56) and cross-client live-state
  exact-HP pairs are age-gated against the bot's stamp (agent 3.5.58). All of it
  is on the STABLE fleet as of Mimic 2.3.5. Remaining from this family: #201's
  spread re-measurement (below) and #203 (telling the three installs).
- **#203 Tell the THREE drifting installs — and the advice is not "fix your
  clock", because we have now WATCHED a fix fail to hold.** Fargan **+56s and
  climbing** (≥ a month, never corrected), Bardtholemu **+22s** (synced to ~0 on
  Jul 26–27, 11s off again two days later), and the third install is
  **Stupidrichard's machine** (+7s, synced ~Jul 25, drifting again) — **who is
  one of the four clerics on the DI callout roster**, so his cast/callout
  stamps carry that skew. The actual fix is **Windows time sync**: Settings →
  Time & language → Date & time → "Sync now", with "Set time automatically" ON;
  if the offset returns within days, the `w32time` service is disabled and
  needs setting to Automatic. Draft wording in `DESIGN-clock-correction.md` §3.
  The agent warns its own user once at >5s absolute — a **rate** alert would
  have caught all three far earlier, which is an open question in that doc.
  *Loose end: the drifting discord_id `272226525426876416` has no `characters`
  row, so it renders as a bare id — linking it would let the report name a
  person.*

**Callout + overlay work designed 2026-08-04 — ALL FOUR BUILT 2026-08-11 and
ON BETA as of agent 3.5.59 (bot halves + migration in bot 3.1.38 on `main`).
Stable stamp pending graduation, per the both-gates rule.**
- **#204 Divine Intervention two-cleric callout — BUILT 2026-08-11, not yet
  released.** `docs/DESIGN-di-callout.md` (§6 = what shipped + every call made
  beyond the doc). Agent-side in the CH-chain module: `trackDiFired` on the
  real death-save line (`%1 has been rescued by divine intervention!`,
  StringID 1029) → `_diRankCandidates` → one `text_overlay` fire ("D I down.
  <A> or <B>.") on the existing trigger-TTS surface, plus a card on
  `apps/mimic/chchain.html` with per-name evidence chips and a 20s countdown.
  Hard exclusions the doc did not have: druids/known non-clerics (DI is
  cleric-only and the chain is not a cleric roster), corpses (via the 3.5.58
  death registry — §2 of the doc is stale on this), and a MEASURED recast.
  Ties/empty fall back to the chain's two most recent healers; no candidates
  at all means no nomination, because the guild trigger already announces the
  event. Tests: `test/di-callout.test.js`. **Still open from the doc**: §5's
  "fire when DI is simply ABSENT from the MT" (deliberately unbuilt) and
  whether the DI roster should be configurable. Dismissal RECORDING is #207's,
  not done here — the card's ✕ is local-only. ⚠ Needs an agent version bump +
  a `beta` push + a `web/lib/roadmapData.ts` entry to actually reach anyone.
- **#205 Group-HP death watcher — BUILT 2026-08-11 (agent, on `beta`; not yet
  in a stable Mimic).** `docs/DESIGN-group-death-watcher.md` §8 is the record of
  what shipped. Zeal gives group member HP, so a member going to 0 is evidence
  of a real death that owes nothing to the log text — the cross-check that would
  have caught the feign bug on day one. It ships as a **second SOURCE feeding
  the 3.5.58 death registry**, not as the standalone evidence pipeline the doc
  drew: `_noteGroupHpFromState` on the `/api/zeal-state` ingest path →
  `_noteDeath` / `_clearDeath`. Three guards: seen-alive-first, the zero must
  hold (≥2 samples / ≥2.5s — Zeal's clamped negative per-mille makes a lone zero
  a known artifact), **a 60s refusal after that name's feign emote**
  (`"<Name> dies."`, newly recorded by `noteFeignEmoteLine` — nothing in the
  agent knew a feign had happened before), and **a zoning member's zero is
  ignored** when verbose `zone_id` proves they left (an *alive* reading from
  another zone still clears — that's the bind run). Tests:
  `test/group-death-watcher.test.js`.
  ⚠ **Without `/pipeverbose on` a zoning groupmate is indistinguishable from a
  dying one** — one more reason to ask the raid to turn it on.
  **Still open:** the durable `death_evidence` table + upload + `death_source`
  chip (needs a bot endpoint + migration, i.e. `main`); the `hp_collapse` path,
  whose threshold the doc says to derive from a clean raid night rather than
  invent. **First measurement wanted:** whether group gauges actually emit a 0
  for a corpse — `_groupDeathWatchSnapshot()` answers it, and the answer decides
  whether the collapse path is optional or necessary.
- **#206 Third capture path for instant boss mechanics — CAPTURE BUILT
  2026-08-11 (record-only, local), consumers still open.** The discard audit
  found **113 timed effects captured, 138 instant ones invisible** — an instant
  effect has no duration, so the buff-landing index never indexes it, and
  `shouldKeep` (default DROP) never passes it to the parser. These are exactly
  the AoEs and death-touches worth calling out. The audit re-ran identical on
  2026-08-11 (263/113/138). What landed: spell-catalog **v8** adds an
  NPC-castable flag (`npc`) so the matcher can't be fed player spells; the agent
  builds a third index keyed on `cast_on_other` for INSTANT spells, records one
  row per CAST with a victim count while a fight is open, and shows them on a
  💥 Boss mechanics card (Triggers tab). **Ambiguity is carried, never crowned**
  — a shared landing text reads "unidentified · N spells share this", which is
  the Kneel Test / every-yawn-is-Turgur's lesson applied at build time. Nothing
  uploads yet, by design (`DESIGN-mechanic-capture.md` §7: record for one raid
  cycle, then argue callouts from evidence). ⚠ The agent index stays EMPTY until
  the v8 bot is deployed — an unflagged catalog is treated as "bot too old",
  not as "index everything". Next: `mechanic_events` upload + table, then
  auto-suggest on `/admin/triggers`, then #207. Full record of what shipped and
  the three places it departs from the spec: `docs/DESIGN-mechanic-capture.md` §0.
- **#207 Overlay UX for callouts**: visible countdowns mirroring the TTS,
  dismissible lines, and **recording dismissals** so we learn which callouts
  people don't want or don't trust. `docs/DESIGN-callout-overlay.md`.
  **PARTLY BUILT 2026-08-11** — unreleased, on a working branch, no version
  bump yet. Landed: ✕ on EVERY countdown + 🗑 clear-all on the title bar;
  bottom-anchored stack that grows upward (the trigger overlay is now grow-up
  by default) with a 6-row cap + "+N more" and a one-row-per-mob collapse for
  slows; dismissals and expiries recorded through `_recordCalloutFeedback` →
  the existing `trigger_timing_feedback` table as `dismissed` / `expired`
  (migration `20260811120000_trigger_feedback_dismissal_directions.sql` widens
  the CHECK constraint — **the insert is rejected until it is applied**, so
  that file and the bot change go to `main` with, or before, the agent).
  Deliberately NOT built: the `callout_fires` table (§3.1), the callout-health
  panel on `/admin/triggers` (§3.3), the collapse of the three-field timer
  config (§Gap A), the separate timers window (v2 §4), the callout font-size
  setting (v2 §5) and the whole mute / Wrong / edit loop (v2 §6 — v2 says it
  "wants its own review"). See `docs/HOW-ITS-BUILT.md` → "Callout overlay UX".
  ⚠ Also fixed in that change, found on the way: **GINA's `{COUNTER}` was
  missing from `_NON_SEMANTIC_CAPTURES`**, which re-created the P1 wall of
  duplicate rows for any timer trigger without `timer_key_capture`, blanked the
  mob from every timer label (`null - Shaman Slow landed`, because the first
  fire's counter is `0`) and could double a relayed callout again. Write-up:
  `FINDINGS-2026-08-10-trigger-overlay.md` §P1b.

**Raid-night 2026-07-30 field reports (Hitya) — all still OPEN, each blocked on
one concrete detail. Shipped that night: stable 2.1.2 / agent 3.4.36.**
- **Charm pets missing from the /rs parse + Discord autoparse, and owner
  attribution collapsing.** They DO render on the local DPS HUD, so the
  `petLeaders` / `_activeCharms` / `_charmTickTracker` bypass is working on the
  threat side — it's the ENCOUNTER PAYLOAD path that drops them, so the parse
  card and `encounter_players` never see them. Separately, three distinct pets
  all displayed as one "Bardtholemu's pet", i.e. the label collapses by OWNER
  rather than per-pet. Start at the encounter-builder player rollup vs the
  threat rows that carry `pet_owner`; the HUD and the upload disagree.
- **Death Touch not captured when the victim is a PET.** The guild trigger's
  victim group is `(?<target>[A-Z][\w'`]+)` — capital-initial, no spaces — so a
  player (Currygoat) matches and a pet (`a glyph covered serpent`, or a
  possessive `X\`s warder`) cannot. This is task #169. NEEDS: the verbatim log
  line for a pet DT before widening the pattern — loosening it blind risks
  eating real Death Touches.
- **AoE dance never fires on Vyzh\`dra the Cursed — the AOE_DANCE entry is
  mis-signatured.** It watches `/flesh begins to liquefy\./i` for Caustic Mist,
  but that text belongs to the **Putrefy Flesh** trigger AND is the `Your ...`
  SELF-land line; with `burst_n: 3` it wants three separate victims, which a
  self-only line can never produce. Meanwhile the AE actually landing is
  **Dragon Roar** (`You lose control of yourself!`), which has its own plain
  trigger with no `timer_duration_sec` — hence a callout on the hit but no
  countdown to the next one. NEEDS a decision: point the dance at Dragon Roar
  (clean, unambiguous signature, `burst_n: 1`) or at the real Caustic Mist
  text, and confirm the wording — Hitya asked for "MELEE OUT / MELEE IN", which
  is more accurate than the current "DPS OUT/IN" since casters needn't move.
- **Death Touch false positive — FIXED 2026-07-30, server-side.** A Cleric
  hammer pet self-destructing (`Vobeker hit Vobeker for 20000 points of
  non-melee damage`) matched the countdown trigger. Added a self-hit exclusion
  (`hit (?!\k<boss>\b)`); a real DT is never self-inflicted. Trigger-table
  change only, propagates on the 10-min guild-trigger poll.
- **Emperor Ssra Tank Buster trigger — FIXED 2026-07-31, server-side.** Missed
  entirely on the pull because the pulling Paladin was Divine Aura'd, so the
  damage line never happened. Root cause was worse than the DA case: the old
  pattern demanded the literal words `tank buster`
  (`... (?:begins to cast|fires|hits .* for) .*tank ?buster`), and EQ NEVER
  names a mob's spell — it prints a bare "begins to cast a spell.". Tested
  against 7 real lines, the old pattern matched ZERO of them, including plain
  buster hits. Replaced with the EQLogParser-style two-alternative rule
  (damage line OR generic cast line):
  `^Emperor Ssraeshza\s+(?:hit \w+ for [1-3]\d{3} points of non-melee damage|begins to cast a spell)\.?\s*$`
  — `\s+` rather than the literal double-space EQLogParser uses, since spacing
  varies. Trigger-row change only; propagates on the 10-min poll.
  ⚠ FOLLOW-UP: a Tank Buster countdown WAS observed on screen, which the old
  pattern cannot explain — so a second path (likely the agent-side #142
  tank-buster logic) is also driving it. Confirm the two don't now double-fire.
- **"PALADIN D.A. NOW" should fire at 2:00, not later — Emperor spawn cycle is
  2m10s.** Wants the DA callout 10s ahead of the spawn. Needs whichever
  trigger/timer owns that callout re-timed to a 130s cycle with the warning at
  120s.
- **Rampage card showed no HP for the victim.** Rampage on Stupidrichard
  rendered "130 / 180 · 72%" — those are not player HP numbers (raiders run
  thousands; Hitya shows 6512/6512), so the card is displaying something other
  than his real HP. Likely the same non-Mimic gap as the cure item: no client
  reporting his live cur/max, leaving a placeholder or a mis-sourced value.
  Related to #144 (targeted raider cur/max HP) and #179 (rampage card scoping).
- **⚠ Dead `^`-anchored guild triggers — count reconciled, and the RISK HAS
  FLIPPED SIGN (2026-08-11).** Two measurements existed: 30 of 102
  (rn-buster-audit, 2026-07-31 — this entry's original number) and **37 of 109
  (2026-08-04, the authoritative one — CLAUDE.md, `RUNBOOK-dead-triggers.md`)**;
  the table simply grew between counts. THEN the premise changed: the
  EQLogParser-parity compiler (agent 3.5.54+) **rewrites leading anchors against
  the timestamp prefix** (`anchorsRewritten` in the compile result), and that
  compiler reached the STABLE fleet in Mimic 2.3.5 (2026-08-10). So the ~37 rows
  are no longer silently dead — **they are silently COMING BACK as installs
  update**, without the reviewed-batch gate this entry called for. The staged
  RUNBOOK fix is now partly moot (the rows fire) and the raid-noise decision it
  deferred is being made by the auto-updater instead. Re-audit which of the 37
  actually fire under the new compiler, and expect surprise callouts on
  Wednesday. Original analysis kept below.
  (Original entry:) `^`-anchored patterns could never match.
  (rn-buster-audit, 2026-07-31.) The agent tests
  guild-trigger regexes against the RAW log line including the
  `[Thu Jul 31 …] ` timestamp prefix, so any `^`-anchored pattern (Enrage, the
  Slow-landed rows, "Death touch — RIP", + 27 more) matches nothing, ever. It
  went unnoticed because BOTH test surfaces validate a timestamp-free string —
  `_synthesizeMatchingLine` literally strips anchors, so Rehearse always
  passes. Fix is per-row (replace `^` with `\]\s+` or unanchor) BUT a bulk
  un-mute of 30 callouts mid-raid-week is its own risk: fix in a reviewed
  batch, confirm each against a real log line, and fix the Rehearse
  synthesizer to stop stripping anchors so this can't hide again. May also
  moot the "DT missed pet victims" item — Death touch — RIP is one of the dead.
- ~~**`state.petOwners` night-accumulation risk** (rn-pets-payload)~~ **HIT
  LIVE 2026-07-30 (Blood of Ssraeshza) and FIXED across four releases.** The
  predicted misattribution landed exactly as written: Jankzer top DPS while
  mezzing (41.7k phantom "pet damage" from his early-evening Revenant/Lich
  charm cycling), byte-identical pet buckets on Rorschach + Dabamf (one mob's
  bucket split between two stale claimants — Dabamf was in Haven), encounter
  total 70k past the boss HP pool. One corrupted uploader per fight (whoever's
  stale residue matched that fight's mob names): Hawkner on Blood, Bardtholemu
  3.05M on the 02:42 fight, Uilnayar at 01:05. Fixes: **bot 3.0.239** (never
  split across the accumulated list), **bot 3.0.240** (timestamped
  declarations; equal split among CURRENT claimants — declared within 15 min
  of fight start — per Hitya's interim call for simultaneous same-named
  charms; single-newest fallback), **agent 3.4.41** (scope the petLeaders
  dump out of uploads: in-fight names only, article-prefixed charm residue
  dropped), **agent 3.4.42** (HUD/threat meter: live charm proofs outrank the
  runtime map; unproven charm mobs labeled "(charmed)", never credited to a
  raider), **bot 3.0.241** (🐾 Charmed card section listing the charm pets +
  who their damage split across). Corrupted rows repaired in Supabase
  2026-07-31 (originals under `players_pre_petfix`; Blood 271k→219k). True
  per-mob attribution still needs the Zeal spawn-id ask
  (`docs/zeal-spawn-id-request.md`).
- **`_detectSelfHp` admits Zeal WEIGHT pairs as HP** (rn-rampage-hp): mimic
  main.js:1327 two-point-agreement test passes at the boundary (gap exactly
  3.0), which is how 130/180 (charInfo 24/25 = cur/max WEIGHT) reached
  character_live_state. Display side is now gated everywhere (agent
  MIN_PLAUSIBLE_HP_POOL + bot relay floor), but garbage keeps landing in
  Supabase until the generator is fixed: `> 3` + a >= 500 candidate-max
  filter. Touches what every Mimic uploads — own task, not a drive-by.
- **Bot `_CURSE_COUNTERS` table says Gravel Rain = 12; catalog says 72**
  (rn-cure-register, grounded via SPA 116). The name-matched catalog value
  wins at runtime so nothing breaks, but the keyword table is misleading —
  reconcile or annotate it.
- **Register a CURE cast by a Mimic user, so non-Mimic raiders leave the debuff
  queue.** Observed 2026-07-30: the debuff queue held 11 players on
  "Curse of Rhag`Zadune" long after they'd actually been cured. VERIFIED: none
  of those twelve names has uploaded a contribution in 14 days — they are all
  non-Mimic, so nothing ever reports their state changing and the entry never
  retires. The fix does NOT need the afflicted player to run Mimic: the CURER's
  own log names both the spell and the target (`You begin casting Remove
  Greater Curse` -> land), which is the self-cast path the agent already parses
  for buffs. One cleric on Mimic can clear queue entries for the whole raid —
  same one-directional trick the buff queue already leans on.
  ⚠ Curses carry COUNTERS (bot `_CURSE_COUNTERS`: Gravel Rain 12 … "Word of" 1),
  so a registered cure must DECREMENT rather than blanket-clear, or a single
  Remove Greater Curse would wrongly retire a 12-counter curse still on them.
- **"Eye of <player>" must never appear on the DPS meter.** Eye of Zomm is a
  VISION pet — it deals no damage at all. Observed on a `/rs` meter as an
  indented pet row "Eye of Syphon" carrying 110 dmg / 3 dps / 38s — byte-for-byte
  the owner's own numbers, so it isn't merely cosmetic: the owner's damage is
  being duplicated into a phantom pet row, which inflates the pet-attribution
  side of the parse. Fix is a name filter (`/^Eye of /i`) wherever pets are
  admitted to the meter — the same `petLeaders` / pet-whitelist path that the
  charm-pet bypass uses. Cheap and unambiguous; do it with the pet-attribution
  work above, since both live in that rollup.
- **Same-name mob serialization — position clustering + HP continuity (NEW
  IDEA, 2026-07-30, Hitya).** Four `a crypt guardian` pulled at once collapse
  into one NPC in the parse. Triangulating the MOB is impossible — the pipe's
  mob surface is name + HP per-mille, with no distance or bearing to solve
  against. But we don't need the mob's position: we need to know which players
  are on which instance, and we DO have self `loc {x,y,z}` + heading and
  group-pipe member loc, plus per-player combat attribution. So cluster the
  ENGAGED PLAYERS spatially — mobs pulled to separate spots produce separate
  clusters, each with its own tank/HP/debuffs. Pair it with HP continuity and
  the two cover each other: position separates mobs at equal HP, HP separates
  mobs at one spot. Caveats: mobs piled on a single spot defeat the clustering,
  and group-pipe loc only covers the local group, so raid-wide coverage scales
  with how many raiders run Mimic. Does NOT depend on the upstream `spawn_id`
  ask (`docs/zeal-spawn-id-request.md`, still an unsent draft) — that stays the
  clean long-term fix, this is what's buildable today.
  (NB: an earlier read of the screenshots claimed all four mobs sat at the same
  HP, making variance useless. That was wrong — they were two separate pulls,
  44% actively being killed vs 90% largely untouched. HP variance is a real
  signal most of the time; it only degrades under even AE damage.)
- **Watch:** charm-break timings were cut that night (gauge grace 10s→6s,
  speech defer 3.5s→1.5s) to take the callout from ~13.5s to ~2.5s. Both are
  tuning. If false "charm break" calls reappear during routine cycling, those
  are the numbers to raise.
- **Mimic beta queue** (`mimic-1.4-roadmap.md`, still live): sync overlay
  layout to `/me` (#5, now unblocked since B-2 shipped); Trigger-Alerts↔Triggers
  onboarding (#2); UI-Studio overlay-positioning UX (#3); UI-Studio per-char
  launch + previews (#6).
- **`/raid` hub Stages 3-5** (`raid-hub-roadmap.md`): raid-leader→Discord
  interactive ARI button; RaidHelper diff **display** on `/raid` (Stage 5);
  Feral Avatar queue + mass-buff cooldown (Stage 3); per-buff cast attribution
  + timer; DKP auction-winner highlight + "Add as looter" (Stage 4); group-buff
  regrouping suggestions; buff-slot request from own row; Discord name→mention
  in summaries.
- **Efficiency ⏳** (`EFFICIENCY-REVIEW`): web revalidate sweep
  (/leaderboards, /boards, /pop, /fun/lord-of-ire, factions); family/household
  walk extraction (×3 dup); heavy fetches (/character `.limit(10000)`, /parses
  `range(0,99999)`); `/planner` + `/loadouts` — build or retire the stubs;
  Mimic unify 3 tasklist spawners + lazy overlay renderer creation.
- **PvP** (`pvp-capture-audit.md`): relax the unguilded-participant regex
  (currently hard-requires `\w+ of <Guild>`) if unguilded PvP still matters.
- **TIME-WINDOWS telemetry (preserved)**: after ~a month, retire unused window
  chips —
  `select page, win, sum(count) from ui_window_usage group by 1,2 order by 3 desc;`
- **From `BACKLOG.md`** (unique, still open): guild bazaar price index; per-class
  name colors on overlays; multi-monitor pretty-place (c) + observed overlay sets
  (b2); wolfpacktag raid-channel capture; stale-log-filename attribution beyond
  chat (encounter/who still filename-keyed); pet buffs (`/pet health`); base
  stats v1 + bind location from `/charinfo`; "Set up for me" Mimic first-run
  wiring; tank-overlay bot-side heal-amount fallback; bulk re-merge of historical
  `encounter_players` (RPC exists — run gated on owner go); 72-raider scale prep
  (burst mode / replay harness / QPS counters — overlaps board #71-75). Board
  already tracks: #47/#51 same-name segmentation, #52 base stats, #55 mob
  immunity, #56 same-name HP serialization, #65-67 overlay polish.
- **From `CONTINUATION_QUEUE.md`** (unique, still open): ARI Phase-2 auto-handoff
  detection; CothBot labels + parked location; class-signature-counter **display**
  (collection shipped); PoP flagging tracker (greenfield; PoP locked to
  2026-10-01); guided walkthrough tours (overlaps board #86-88); `/me` loot
  per-expansion grouping (needs item→expansion map — UNCERTAIN); local log-browser
  tab in Mimic.
- **Onboarding overhaul — "New Here?" walkthrough on web + Discord.** Design:
  **`DESIGN-onboarding-overhaul.md`** (proposal, awaiting Hitya sign-off; asked
  for 2026-07-31). Slims the Discord welcome card to a hook + link + the four
  persona buttons, adds a `/start` web walkthrough that **auto-checks off** steps
  from signals we already store (`wolfpack_members.role_names`, `mimic_sessions`,
  `agent_upload_stats`, `characters.discord_id`, `character_link_requests`), and
  hosts one screenshot set in `web/public/onboarding/` that BOTH surfaces use
  (precedent: `index.js:9123` already `setImage`s a `wolfpack.quest/roadmap/*.png`;
  `commands/parsehelp.js:58` `STEP_IMAGES` is a built-and-empty slot). Supersedes
  the one-line "guided walkthrough tours" item above; cross-refs #53 / #86
  (Mimic first-run) without absorbing them.
  **⚠ Ships-first sub-item, independent of the design:** `/onboarding` currently
  **throws for 29 of the 36 members who have ever used it (81%)** —
  `buildChangesEmbed` (`utils/onboarding.js:681`) feeds the whole `changesSince`
  diff to `.setDescription()` with no truncation, and 103 `CHANGELOGS` entries put
  every pre-3.0.224 member over Discord's 4096-char cap (measured: `3.0.91` →
  25,873 chars). Member sees "❌ An error occurred."; the `GuildMemberAdd` rejoin
  DM also dies because the build call sits OUTSIDE its `try` (`index.js:2332` vs
  `:2338`), so there's no DM and no thread fallback. ~20-line bot fix (truncate +
  "…NN older → /roadmap" tail + move the call inside the `try`); also delete the
  dead `handleWelcome*` trio (`index.js:1669`/`:1690`/`:1704`). Routes to `main`.

- **Item icons: packer written, needs the client files (2026-08-13).** Hitya's
  call, and it is the right one — PQDI has hosted EQ's icons since the server
  opened, every long-running EQ community site does, and there is no commercial
  angle here. Site now carries the standard Daybreak trademark/ownership notice
  in the footer (web 1.1.47).
  We already mirror `eqemu_items.icon` for all 26,971 items (872 distinct,
  range 500–2000). The client stores them as `dragitem<NN>.dds`, 6×6 grids of
  40px cells from icon 500, so 500–2000 spans dragitem01–42.
  `scripts/pack-item-icons.ps1` re-packs them into ONE atlas laid out so that
  `col=(icon-500)%40, row=floor((icon-500)/40)` — **deterministic, so there is
  no manifest to drift**. ⚠ Blank slots are padded deliberately: a missing icon
  must still occupy its cell or everything after it shifts and the atlas
  silently shows the wrong picture for every item.
  We do NOT hotlink pqdi.cc — that spends their bandwidth and breaks when they
  reorganise; we pack from the same client source they did.
- **Live guild-vs-local DPS: designed, not built (2026-08-13).**
  `docs/DESIGN-live-guild-dps.md`. The measurement that justifies it: across
  five recent fights the WORST single uploader's view was **0.1-8.3% of the
  fight** - a raider who zoned in late is looking at a twentieth of what
  happened with no way to know.
  ⚠ And the BEST single view **exceeded** the merged total by up to 46%, so the
  guild number is not "truth" and the local number is not a subset of it - they
  are different scopes (the merge drops excluded characters, folds pets, and
  ignores non-roster names). Never present one as correcting the other.
  Needs no new capture: `encounter_threat_snapshots` already arrives live at
  3.5-6.4s. What is missing is a READ - `/api/agent/threat-snapshot` is
  ingest-only. DECIDED 2026-08-13: guild-merged number is the headline with YOUR observed
  amount in parentheses per player (`Wabumkin 164k (0)` is the whole feature in
  one line) - which supersedes the coverage-line recommendation. Exclusions
  stay upload-side and already work that way, so the live view must NOT filter
  on read; doing so would hide a player from observers who legitimately saw
  them. Nothing blocking - build order in §5.

**⚠ Needs a local (desktop) session** — cloud sessions can't reach the local
`peq`/PQDI/EQ machine. Exact queries/files live in `archive/BACKLOG.md`; the asks:
- Mob-immunity backfill from the local `peq` DB (fix B for board #55).
- Zeal exit-crash bundles from `crashes/` (board #64 — `crash_reports` is empty).
- **Run `powershell -ExecutionPolicy Bypass -File scripts\pack-item-icons.ps1 -EqDir "A:\EQ"`**
  (needs `winget install ImageMagick.ImageMagick`, then a fresh terminal) and commit
  `web/public/icons/items.png` — the only blocker on item icons; everything else
  about them is arithmetic. ⚠ PowerShell, not bash: the first cut of this was a
  .sh, and `bash` on Windows hands off to WSL, which fails with
  `execvpe(/bin/bash) failed` on any box without a distro installed.
- Per-class overlay colors / PoP P2-P3 slideshow stubs (blocked on local capture).
- Any migration needing local verification (per CLAUDE.md Migrations rule).

- **Unraid Supabase stack: UP 12/12 and verified 2026-08-11** (roles present, so
  the bootstrap really ran). It is now the restore-test target for Phase 1 —
  same Postgres major (17.6) as the hosted project.
- **Crash reports: parser fixed, diagnostics added, Razek's crash identified
  (2026-08-12).** Razek reported crashing twice while zoning with Mimic running.
  Three fixes, then an answer:
  1. **Parser bug** that hit hardest on exactly this case — `\s` matches
     newlines, so a blank `Character:` (what a zoning crash produces) swallowed
     the line break and captured the next line. 55 rows had
     `character = 'UI Skin: ...'`, repaired in place. Agent 3.5.65.
  2. **Five fields Zeal writes and we discarded** — `Exception String`,
     `Game state`, `Self`, `SpawnInfo`, and which handler caught it. Agent
     3.5.66 + bot 3.1.39 (the ingest map is a WHITELIST — unnamed fields were
     being dropped) + `20260812060000_crash_reports_diagnostics.sql`, backfilled
     over all 393 rows. 15 tests.
  3. ⚠ **The first cut of that migration was wrong in prod for a day** — Postgres
     POSIX `.` matches newline, so `handler_stage` without `(?n)` captured the
     entire rest of the report in all 393 rows. Repaired. Both traps
     (`(?n)`, and `btrim` because SQL `trim()` leaves `\r`) are commented in the
     file.

  **The answer:** zoning is the single largest crash class in the whole corpus —
  **212 of 393 (54%)**, every one with `Self`/`SpawnInfo` `0x0` (player entity
  gone), across every Zeal version for 19 months. Razek's 29 reports are all one
  signature (`0x6ef @ kernelbase.dll +9f54`, Zeal 1.4.2) and the four that kept
  context all read zoning. **But it is not a 1.4.2 regression** — the other
  uploader ran the same Zeal build with zero `0x6ef`; what differs is Windows
  build 26200 vs 19045. Full numbers in `docs/DESIGN-crash-review.md` §7; the
  consent prompt that would give us n>1 is §3, and the tray toggle that exists
  today (`main.js:5797`) is off by default and never surfaced.

  ✅ **SOLVED the same night, from the minidump — it is the Windows audio stack,
  not Zeal.** Hitya sent the actual crash zip. `0x6ef` is
  `RPC_X_SS_IN_NULL_CONTEXT`, raised NONCONTINUABLE — not an access violation
  like everything else in the corpus. The stack is
  `eqgame.exe → mss32.dll (Miles) → winmmbase.dll → wdmaud2.drv → rpcrt4.dll`,
  i.e. EQ's sound engine making an RPC call to the Windows Audio service with a
  context handle that had gone NULL. **`Zeal.asi` is loaded and appears ZERO
  times on the crashing thread** — nothing to report upstream. Fits the zoning
  correlation: EQ rebuilds the sound system on a zone change, which is when it
  reaches for the stale handle. Mitigations offered (untested, n=1) in §8.
  ⚠ **This overturned the design's own assumption that dumps need a symbol
  server.** They don't for the question we actually ask — module base addresses
  resolve any address to `module+offset` with no symbols at all. New tool:
  `scripts/read-minidump.py`, stdlib-only and offline, which is now the
  highest-value piece of the local-review flow rather than the out-of-scope one.
- **Local box is now an ARCHIVE, not a mirror (2026-08-12).**
  `refresh-local-archive.sh` + `lib/archive-merge.sql` merge each nightly dump:
  ARCHIVE tables (the five production sweeps + the append-only event logs) insert
  and update but NEVER delete; everything else mirrors production exactly,
  because for those a delete is a correction (`character_inventory` and friends
  are delete-then-reinsert on every upload). Proof:
  `scripts/test-archive-merge.sh` — 9 assertions, run it after touching the SQL.
  ⚠ Needs a local session: swap the User Scripts entry from
  `refresh-local-sandbox.sh` to `refresh-local-archive.sh`; do not run both.
  Growth is real — ~9,500 buff_casts rows/day, a few GB/year.
- **⚠ PostgREST's 1000-row cap silently truncates reads across the site
  (audited 2026-08-12).** `.limit(N)` only LOWERS PostgREST's ceiling, never
  raises it, so any query matching >1000 rows returns the first 1000 with no
  error — and the code downstream computes a confident wrong answer. Audited all
  of `web/`: **52 read sites** query a table that exceeds 1000 rows without
  paging. Fixed so far (`web/lib/supabase-paged.ts` + `fetchAllPages`):
  `/rolls` looted_items (saw 1000 of 5,622 — older nights lost their looter) and
  `/fun`'s dragon-punch counter (1000 of 4,004) and Drunkard leaderboard (ranked
  from 1000 of 4,099 while showing an exact total beside it).
  **Still unfixed, mostly officer pages** — `chat_messages` (344k) in
  `/admin/chat`, `/admin/members`, `lib/admin-queue.ts`; `who_observations`
  (113k) in `/admin/links`, `/admin/signups`, `/admin/members`; `buff_casts`
  (66k) in `/raid` and the raid review. Verify each against real counts before
  fixing — most `eqemu_*` and per-character reads are naturally under the cap
  and need nothing. The audit script is in the session log; re-run it before
  assuming a page is safe.
- **⚠⚠ The Supabase GitHub integration has not applied a migration since
  2026-08-09** (found 2026-08-12 when officer roll edits failed with a missing
  table). Last auto-applied version was `20260809164542`; two committed
  migrations were sitting unapplied, and one of them mattered: the production
  `trigger_timing_feedback_direction_check` still only allowed
  `earlier/good/too_early`, so **#207's `dismissed`/`expired` writes were being
  rejected by the database** — the dismissal telemetry the design leans on was
  silently recording nothing. Both applied by hand via the MCP (documented
  fallback); the repo files are unchanged and idempotent, so the integration
  re-applying them later is a no-op. ⚠ **Check the integration itself**
  (Supabase Dashboard → Integrations → GitHub) — until it is fixed, every new
  migration needs the manual MCP step, and the next one to be forgotten will
  fail the same silent way.
- **⚠ `sync-beta` had failed 8 times in a row (2026-08-12)** — every push tonight,
  all append-append conflicts in `docs/DECISIONS-2026-08-10.md`; beta sat 8h stale.
  Fixed three ways: beta re-merged by hand (union, nothing lost), `.gitattributes`
  now `merge=union` on the append-only ledgers so it cannot recur, and the workflow
  posts to Discord on failure. **Set the `DISCORD_SYNC_WEBHOOK` repo secret** or the
  notification silently stays off — the whole point is that a red X in the Actions
  tab is not a notification.
- **Self-hosting is now buildable — and the repo could NOT rebuild its own schema
  (2026-08-12).** Measured on an empty Postgres: migrations alone = 182 clean /
  11 failed. Cause: SIX tables production uses are created by no migration
  (`fun_events`, `pvp_kills`, `pvp_boss_kills`, `pvp_assists`, `mimic_sessions`,
  `trigger_timing_feedback`) — out-of-band applies never committed as files.
  `supabase/bootstrap/` + `scripts/selfhost-bootstrap-db.sh` → 190 clean / 3
  partial / 0 failed, 124 tables. Guide: `docs/SELFHOSTING.md`.
  ⚠ **Decision needed from Hitya:** do those six get committed as real migrations
  (or squashed into a baseline), or does `supabase/bootstrap/` stay the fresh-install
  path? Today production and the repo still disagree.
- **Local mirror automation shipped (2026-08-11)** — `scripts/coolify-autodeploy.sh`
  (+ systemd timer) polls `main` every 5 min and triggers Coolify; polling rather
  than a webhook because Coolify is LAN-only and exposing it would be worse than
  the 5-min lag. `scripts/refresh-local-archive.sh` MERGES the newest dump at
  05:30 (superseding refresh-local-sandbox.sh), so the local box never loses
  history production prunes, and the backup is re-proved nightly. Both are committed and
  installable; ⚠ **execution is a needs-local-session item** (deploy key, Coolify
  API token, User Scripts entry — details in each script header).
- ⚠ **Vercel Preview env vars** — beta sign-in was broken because
  `SUPABASE_SERVICE_ROLE_KEY` was Production-scoped only. Rule now in CLAUDE.md:
  every var must be enabled for Preview too. Verify the rest are ticked.
- **Local copy of wolfpack.quest is LIVE (2026-08-11)** at
  `http://192.168.1.163:3000`, served by Coolify in an Unraid VM against the
  local Supabase stack. Remaining: Part F (Discord sign-in on the local GoTrue),
  gated on having the Discord client secret. Full steps + the four traps hit
  along the way in `docs/RUNBOOK-local-web-coolify.md`.
- ~~**Local copy of wolfpack.quest on Unraid**~~ — decided 2026-08-11: Coolify in an
  Unraid VM, site pointed at the LOCAL Supabase stack (zero production risk).
  Steps in `docs/RUNBOOK-local-web-coolify.md`. Prerequisite that gates Part F:
  the Discord client secret must be in hand — resetting it breaks production
  sign-in until the cloud provider config is updated.
- **Unraid backup Phase 1 is PROVEN (2026-08-11)** — 106 MB dump restored into
  the local stack, `encounters` = 1575. ONLY remaining step: re-paste the
  corrected `scripts/unraid-backup-supabase.sh` into User Scripts (the copy
  there still has the `-f /dev/stdout` bug) and set the schedule to
  `0 5 * * *`. Phase 2 (dev sandbox) is effectively seeded by that same restore.
- ~~**Run Phase 1 of the Unraid backup**~~ (superseded by the line above) (`docs/RUNBOOK-unraid-supabase-replica.md`,
  decided 2026-08-11: backup first, then dev sandbox): copy
  `scripts/unraid-backup-supabase.sh` into the User Scripts plugin, put the
  SESSION-pooler URI (Dashboard → Connect — port 5432, NOT the 6543 transaction
  pooler) into `/boot/config/wolfpack-db-url` (chmod 600), run once by hand,
  then do the one-time restore test. The script self-guards against the wrong
  pooler and against rotating away good backups on a silently-failed dump.

### 🚫 Abandoned — deliberately dropped or blocked on something external
- **Windows code-signing** — CLOSED 2026-07-14 (SignPath declined; user base too
  small). Installers stay unsigned unless another provider appears. (`code-signing.md`)
- **True mob-distance / ETA "Pull Tracker"** — blocked: needs Zeal position
  telemetry the pipe doesn't emit. Revisit only if Zeal adds it.
- **Historical chat display / era-thread routing** — collection kept, replay
  deliberately not built (CLAUDE.md scope boundary).

### 💀 Folly — built, then pulled
- **CH-neck (Necklace of Resolution) tracker** — built and fully reverted; not
  useful in practice.

### ❓ Uncertain — needs a code-owner to confirm before filing
*(No shipping evidence found, but a negative couldn't be proven exhaustively.)*
- `/me` named-mob kill counts (board #54 covers this) · overlay font-size
  control · tell-back sender-mention in relayed DMs · the unguilded-PvP regex
  status.

---

## Correction the old docs got wrong
`roadmap.md`'s own retrospective **understated progress**: PvP assist credit,
the Extended-Target glide animation, and per-character overlay position+opacity
(B-2) are all **shipped**, not pending. Trust this ledger over the archived
roadmaps.
