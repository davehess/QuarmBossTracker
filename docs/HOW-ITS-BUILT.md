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

### Zeal live state
Mimic bridges the pipe (below); the agent keys `_zealState` per character:
gauges (1=self, 6=target, 16=pet; HP per-mille), buffs, zone. Flushed to the
bot every 5s **on change** (`live-state` → `character_live_state`) — this is
the latency floor for the debuff queue and Extended Target. Type-5 raid
frames upload `raid_roster` + populate `_raidRosterMembers`. **The pipe has
no spawn id** — same-name mobs are not disambiguable (see CLAUDE.md scope
boundary).

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
Guild set polled from the bot (10 min; class-filtered), personal set from
`personal_triggers.json`. `{s}` placeholders compile to named groups;
`_captureMatchesCharmPet` suppresses self-charm-pet fires; roster gate via
`require_raid_member`. Zeal gauge conditions fire without a log line.
Cross-Mimic relay: detecting agent POSTs `trigger-relay`, others poll
`recent-fires` (~1.5s) and run the same actions; dedup by name+captures in 8s.

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
  /buffs (coverage grid vs role targets), /who, /pvp, /boards, /boss,
  /character, /leaderboards, /loadouts, /bards, /fun, /planner, /feedback,
  /roadmap, /search.
- **/admin/*** — queue, encounters, members, links (OpenDKP register with
  ignore/trader/raid-alt), quarmy, agents, audit, feedback, signups,
  attendance, triggers, analytics, voice, **overlays** (live tuning knobs),
  chat, anomalies. Pattern: client component with optimistic
  `useState`+`useTransition`, server actions in `actions.ts`, no
  `router.refresh()` (revalidatePath only).
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
