# Quarm Raid Timer Bot — Claude Code Handoff

| Component | Version | Source |
|---|---|---|
| **Bot** | 3.0.4 | `package.json` |
| **Agent** (`wolfpack-logsync`) | 3.0.7 | `packages/wolfpack-logsync/package.json` |
| **Web** (`wolfpack.quest`) | 1.0.5 | `web/package.json` |
| **Mimic** (Electron desktop) | 1.0.9 | `apps/mimic/package.json` |

**Runtime:** Node.js 20, discord.js v14
**Deployment:** Railway (bot) + Supabase (DB) + Vercel (web at wolfpack.quest)
**Guild:** Wolf Pack EQ (Quarm) — `DISCORD_GUILD_ID=1168893924329402420`

> This file is the authoritative architectural map. README.md is the user-facing setup guide. When they conflict, this file is correct.

---

## Versioning Rule

The **bot**, **agent**, and **web** ship and version independently. When changing one, only bump that component's version:
- Bot changes → bump `package.json` + `README.md` header + this file's version table
- Agent changes → bump `packages/wolfpack-logsync/package.json` (auto-derived by `_currentAgentVersion()` in `index.js`)
- Web changes → bump `web/package.json`

Default to a **patch** bump unless a minor/major is requested. Commit message convention: `<component> vX.Y.Z — <short reason>` (e.g. `agent v2.4.6 — ...`, `v2.2.39 — ...` for the bot). Railway shows the merge commit message as the deploy name, so always merge with a descriptive `-m` flag — never `--no-edit`.

**Per-release "what's new" bullets.** When bumping the bot version, add a 1–3
bullet entry to `CHANGELOGS` in `utils/onboarding.js` keyed on the new version
string. These surface as the diff in `/onboarding` for any member whose
`member_onboarding_state.last_seen_version` is below the new release — that's
what makes revision pings useful instead of noisy. Skip the entry if there is
truly nothing user-facing in the bump.

---

## What This Bot Does

What started as a Discord raid-timer bot for Project Quarm is now a multi-system platform:

1. **Raid boss kill tracking** — instanced spawn timers, sourced from [PQDI.cc](https://www.pqdi.cc). Buttons in expansion threads record kills; live cooldown cards, summary, 24h preview.
2. **Parse aggregation** — multi-perspective DPS parses (manual `/parse` paste + `wolfpack-logsync` agent uploads). Encounters merged with max-damage-per-player. Stored in Supabase + Discord thread of truth.
3. **Live-server + Plane-of-Hate tracking** — `/livekill`, `/livehatekill`, `/hateboard` boards persist to hidden JSON embeds in `HATE_THREAD_ID`.
4. **PvP tracking** — separate timer/alert system for PvP-server mobs; ±20% variance windows, `/quake` resets, `@PVP` role rally.
5. **DKP + sealed-bid loot** — `/dkp` balance, `/wishlist` sealed-bid registry (AES-256-GCM), `/loot` Zeal-paste parser, `/tick` attendance, `/register` character creation — all via OpenDKP API.
6. **Roster + char↔Discord mapping** — `/rosterimport`, `/who*`, `/quarmy` link, `/syncmembers` Discord guild → Supabase.
7. **Onboarding** — welcome flow with versioned opt-out (salted SHA-256), public Quick Start in `ONBOARDING_THREAD_ID`.
8. **Announcements** — `/announce` creates raid thread, PQDI boss scrape, Discord scheduled event, mutable target list.
9. **Web app** — Next.js on `wolfpack.quest`, Discord OAuth, read-only views of Supabase data.
10. **Audit trail** — every kill/unkill/updatetimer posts to `AUDIT_TRAIL_THREAD_ID` with officer-only Undo button.

---

## Scope Boundaries (read before changing related code)

**Historical chat backfill — revised 2026-05-28: collection IS in scope, display is NOT.**
Old EQ log files are backfilled for boss combat + `/who` data **and** guild/raid chat.
Chat goes to Supabase (`chat_messages` table) for long-term timeline analysis. We
deliberately do NOT replay old chat into Discord threads — there's no "era thread"
view of historical chat anywhere. Live chat (`/api/agent/chat`) posts directly to
the configured channels without era subdivision.

What this means for code:
- `POST /api/agent/historical_chat` (`index.js`) — **kept**. Continues to ingest
  old chat into `chat_messages`. Was tagged DEPRECATED in earlier revisions; that
  tag is no longer accurate.
- `data/historical_chat.jsonl` — local mirror still produced as a backup. Supabase
  is the canonical store going forward.
- `supabase/migrations/20260527000000_historical_chat.sql` + `chat_messages` table —
  **kept and required**. (The original migration never applied in prod;
  `20260528220000_historical_chat_recreate.sql` restored it with RLS hardening.)
- `commands/chatstats.js` — **kept**. Useful for analyzing the collected corpus.
- Era-thread routing in `_handleAgentChat` — **still deprecated**. Live chat
  should post directly without era subdivision.
- `commands/initerathreads.js` — **still deprecated** (no era threads needed).

**PoP expansion: locked until `2026-10-01T00:00:00`** via `isPopLocked()` in `utils/config.js`. PoP boss buttons return ephemeral lock messages until then.

**Zone resolution for encounters** — `eqemu_npc_types.zone_short` is NULL across the
catalog because the weekly sync only pulls npc_types, not spawn data. As of
2026-05-28, `encounters.zone_short` is backfilled from `data/bosses.json` →
`eqemu_zone.long_name` lookup (113 boss → zone pairs, see
`supabase/migrations/20260528210000_zone_short_backfill.sql`). `bosses_local`
also gained a `zone_short` column. Future encounters still need the bot to set
zone on insert — `find_or_create_encounter` currently leaves it NULL.

---

## Top-Level File Structure

```
/
├── index.js                  3,453 lines — entry point, interaction router, HTTP server, background tasks
├── package.json              version source of truth
├── deploy-commands.js        legacy manual command registration (auto-runs on start)
├── Dockerfile                node:20-alpine; `rm -f data/state.json` after COPY
├── docker-compose.yml        Mounts ./data:/app/data for persistence
├── railway.toml              Railway config
├── README.md                 User-facing setup + command reference
├── .env.example              ALL env vars documented (read this when adding new ones)
├── Parser.bat                Windows launcher for wolfpack-logsync agent
├── RUN-FIRST-for-Node.js.bat Node 20 installer for end users
├── start-logsync.ps1         PowerShell wrapper that copies the agent into the user's EQ dir
│
├── commands/                 65 slash commands (see Commands section)
├── utils/                    20 utility modules
├── data/
│   ├── bosses.json           133 bosses — hot-reloaded
│   ├── hate-spots.js         Plane of Hate spot definitions
│   ├── pqdi-items.json       Cached PQDI item names (for /loot rarity labels)
│   ├── zones.json            Zone catalog (for /timers autocomplete)
│   ├── parses.json           Local mirror of parse data (rebuilt from Discord thread on startup)
│   └── state.json            Live kill state — NEVER commit, NEVER bake into image
│
├── packages/wolfpack-logsync/  Local EQ log tail agent (Node.js, zero deps)
├── releases/WolfPackParser.zip Bundled agent + Node launcher for distribution
├── scripts/                  One-off helpers (sync-from-eqmac, migrate-bosses, screenshot gen)
├── supabase/                 README + migrations/ (timestamped SQL files)
├── web/                      Next.js 14 app deployed to wolfpack.quest
├── .github/workflows/        sync-quarm.yml (weekly eqmac sync), release-parser.yml
└── docs/                     Screenshots, opendkp-capture-playbook.md, flyer
```

---

## index.js Architecture (3,453 lines, no longer thin)

| Section | Lines | What |
|---|---|---|
| Imports + boot | 1–94 | Dotenv, discord.js, agent version cache, command loader |
| `Events.ClientReady` | 86–116 | Logs ready → `registerCommands()` → starts spawn checker → schedules midnight → inits member sync → runs startup sequence (60s-delayed chain: load onboarding/parses/roster/hate, then board + cleanup) |
| `Events.InteractionCreate` dispatcher | 130–200 | Routes autocomplete / select / button / chat-input |
| Button handlers (inline) | 200–1356 | 28+ custom_id prefixes — see table below |
| `Events.GuildMemberAdd` | 1358–1405 | Onboarding DM with fallback to onboarding thread |
| `Events.ThreadCreate` | 1410–1471 | Forum-post watcher in `FORUM_CHANNEL_ID` → suggests `/suggest` |
| `startSpawnChecker()` | 1473–1539 | 5-min interval; main raid + calls PvP/live/quake checkers |
| `checkPvpSpawns()` | 1563–1692 | PvP window-open / window-spawned alerts with stale suppression |
| `checkLiveSpawns()` | 1694–1763 | Live-server spawn alerts during raid window |
| `scheduleMidnightSummary()` | 1765–1890 | TZ-aware recursive setTimeout; runs midnight tasks chain |
| `archivePassedAnnounceThreads()` | 1893–1941 | |
| `archiveRaidSession()` | 1944–1970 | |
| `postPvpMidnightSummary()` | 1972–1998 | |
| `checkQuakeAlert()` | 2000–2038 | |
| `consolidateNightlyParses()` | 2039–2114 | 10-min session-window merge of multi-submitter parses |
| Chat dedup GC | 2126–2129 | 10s interval, prunes 5s-old entries |
| **HTTP server (port `PORT`/3000)** | 2117–3453 | See endpoints table below |

### Button custom_id prefixes

| Prefix | Handler | Purpose |
|---|---|---|
| `kill:<bossId>` | `handleBoardButton` | Toggle kill (kill if available, unkill if on cooldown) |
| `audit_undo:<id>` | `handleAuditUndo` | Officer-only undo of a logged action |
| `cancel_announce` | `handleCancelAnnounce` | Archive announce to Historic Kills |
| `cancel_event_thread:` | `handleCancelEventThread` | Close event scheduling thread |
| `confirm_kill_announce:` / `cancel_kill_confirm` | inline | Kill confirmation modal |
| `remove_target:` | `handleRemoveTargetButton` | Remove from announce target list |
| `add_zone_bosses:` | `handleAddZoneBosses` | Bulk-add zone bosses to target list |
| `loot_rm:` / `loot_post` / `loot_cancel` | `handleLoot*` | Loot remove / post auctions / cancel |
| `pvprole_toggle` / `pvprole_toggle_silent` | `handlePvpRoleToggle` | Toggle @PVP role |
| `pvpnight_tonight` / `pvpnight_always` / `pvpnight_remove` | `handleNight*` (pvpnightpings.js) | Overnight PvP-ping opt-in (tonight / always / off) |
| `pvpalert_howl:` | `handlePvpAlertHowl` | 🐺 Howl! rally count |
| `pvp_spawn_alert:` | `handlePvpSpawnAlert` | Officer rally from `/pvpspawn` ephemeral |
| `mark_avail:` | `handleMarkAvail` | Mark member available for PvP |
| `pvp_window_spawned:` | `handlePvpWindowSpawned` | Confirm PvP window mob spawned |
| `hate_kill:<live\|pvp>:<n>` | `handleHateKillButton` | Hate board toggle |
| `hate_confirm_unkill:` | `handleHateConfirmUnkill` | Confirm hate kill undo |
| `hate_unknown:<live\|pvp>:<n>` | `handleHateUnknownButton` | Mark hate spot as timer-unknown |
| `suggest_host:` / `suggest_confirm:` / `suggest_cancel_host:` / `suggest_nohost` | `handleSuggest*` | Event request hosting flow |
| `onb_pvp` / `onb_organizer` / `onb_attend` / `onb_deeps` / `onb_ignore:` / `onb_show_again` | `handleOnb*` | Onboarding choices |
| `fb_recv` / `fb_impl` / `fb_nope` | `handleFeedback*` | Officer feedback ack |
| `parse_breakdown:` | `handleParseBreakdown` (parse.js) | Per-player damage breakdown modal |
| `who_family:` | `handleWhoFamily` | Inline alt expansion |
| `parseConfirm` (string select) | `handleParseConfirm` (parse.js) | Confirm boss for ambiguous parse |
| `sll_confirm:` / `sll_cancel` | `handleSll*` (sll.js) | Lockout import confirm |

### HTTP endpoints (bearer-auth via `WOLFPACK_AGENT_TOKEN`)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/agent/latest-version` | Advertises current agent version + requested-characters list (for "rerun" prompts) |
| `POST` | `/api/agent/encounter` | Encounter ingest — combat events → parse cards + Supabase encounters/contributions/encounter_players |
| `POST` | `/api/agent/chat` | Live `/gu` + `/rs` relay. **Currently routes via era threads; era subdivision is deprecated — will become direct post.** |
| `POST` | `/api/agent/pvp` | PvP kill/death broadcast to `PVP_CHANNEL_ID` with 5s dedup |
| `POST` | `/api/agent/bosskill` | Druzzil Ro instance kill broadcasts → auto-sets timers |
| `POST` | `/api/agent/lockout` | `/sll`-style lockout relay; never clears on "Available" |
| `POST` | `/api/agent/historical_chat` | Historical `/gu` + `/rs` backfill from older logs → `chat_messages` table. Not displayed on Discord. |
| `POST` | `/api/agent/live-state` | Snapshot of each watched character's current buffs + last-seen zone (Zeal stream). Upsert into `character_live_state` by `(guild_id, character)`. Powers `/me` Buffs & Zone. Agent sends on change only. |
| `GET/POST` | `/` | Health check (`200 OK`) |

Payload limits: chat 256KB, encounter upload 10MB. Returns `503` if `WOLFPACK_AGENT_TOKEN` unset.

---

## Channel Layout

### `#raid-mobs` (main channel) — `TIMER_CHANNEL_ID`

Four fixed message slots, edited in place, never re-posted:

| Slot | Content | Anchor env var |
|---|---|---|
| 1 | 📊 Active Cooldowns (all expansions, grouped) | `SUMMARY_MESSAGE_ID` |
| 2 | 🌅 Spawning in the Next 24 Hours | `SPAWNING_TOMORROW_MESSAGE_ID` |
| 3 | 📅 Daily Raid Summary (resets midnight in `DEFAULT_TIMEZONE`) | `DAILY_SUMMARY_MESSAGE_ID` |
| 4 | Thread links (one message, all 5 expansions) | `THREAD_LINKS_MESSAGE_ID` |

### Expansion threads (inside `#raid-mobs`)

| Thread | Env var | Cooldown card | Board panel IDs |
|---|---|---|---|
| Classic | `CLASSIC_THREAD_ID` | `CLASSIC_COOLDOWN_ID` | `CLASSIC_BOARD_IDS` |
| Kunark | `KUNARK_THREAD_ID` | `KUNARK_COOLDOWN_ID` | `KUNARK_BOARD_IDS` |
| Velious | `VELIOUS_THREAD_ID` | `VELIOUS_COOLDOWN_ID` | `VELIOUS_BOARD_IDS` |
| Luclin | `LUCLIN_THREAD_ID` | `LUCLIN_COOLDOWN_ID` | `LUCLIN_BOARD_IDS` |
| PoP | `POP_THREAD_ID` | `POP_COOLDOWN_ID` | `POP_BOARD_IDS` |

Each thread contains: cooldown card at top → zone kill cards (mid) → board panels (bottom), all edited in place.

### Other named threads/channels

| Env var | Purpose |
|---|---|
| `HISTORIC_KILLS_THREAD_ID` | Midnight summaries, expired zone cards, archived announces |
| `PARSES_LOG_THREAD_ID` | **Parse source of truth.** Every `/parse` archived as JSON embed; reloaded on startup |
| `AUTOPARSE_TEST_THREAD_ID` | Agent uploads post readable parse cards here for QA (covers ALL encounters incl. trash) |
| `ONBOARDING_THREAD_ID` | Public Quick Start + opt-out registry (hashed user IDs) |
| `ROSTER_ACTIVE_THREAD_ID` / `ROSTER_INACTIVE_THREAD_ID` | Persisted roster data (chunked JSON in messages) |
| `HATE_THREAD_ID` | `/hateboard` boards + hidden state embeds |
| `LIVE_CHANNEL_ID` | `/livekill` / `/livehatekill` cards |
| `PVP_KILLS_THREAD_ID` | `/pvpkill` cards |
| `PVP_CHANNEL_ID` / `PVP_THREAD_ID` | PvP alerts, quake notices, spawn pings (`PVP_THREAD_ID` takes priority) |
| `AUDIT_TRAIL_THREAD_ID` | Audit log with officer-only Undo buttons |
| `FEEDBACK_THREAD_ID` | `/feedback` submissions |
| `SUGGEST_CHANNEL_ID` | `/suggest` event requests for officers to claim |
| `FORUM_CHANNEL_ID` | Forum where members create event-request threads (default `1242116105326166057`) |
| `OFFICER_CHAT_CHANNEL_ID` | `/register` notifications |
| `BOSS_OUTPUT_CHANNEL_ID` | Where `bosses.json` is posted after `/addboss` / `/removeboss` |
| `ARCHIVE_CHANNEL_ID` | Passed announce thread summaries at midnight |
| `STAGING_MODE` | `true` = agent uploads write to parses.json + Supabase + test thread, but NOT live boards |

---

## Commands (65 total)

### Kill tracking
| Command | Notes |
|---|---|
| `/kill <boss>` | Record kill, post/edit zone card |
| `/unkill <boss> [message]` | Clear kill. With `message` link → edits a specific daily summary in place |
| `/updatetimer <boss> <time>` | Override `nextSpawn`. Time format: `"3d4h30m"` or `"Expires in 3 Days, 4 Hours..."` |
| `/timers [zone] [filter]` | View timers. Filter: `all`/`spawned`/`soon`/`unknown` |
| `/board` | Re-render all 4 slots + all thread boards. Operates on `TIMER_CHANNEL_ID` regardless of where called |
| `/cleanup` | Delete transients/duplicates, anchor earliest boards. Historic Kills scan limited to 300 msgs |
| `/restore <links...>` | Rebuild state from any combination of Active Cooldowns / Daily Summary message links. Latest `nextSpawn` per boss wins |
| `/recoverkills [since] [dry_run]` | Officer: rebuild timers from Supabase `encounters` in the window (default 72h). `dry_run:true` previews without writing. Use when boards drift after a volume wipe or missed update |

### Boss management
| Command | Notes |
|---|---|
| `/addboss <pqdi_url>` | Scrape PQDI NPC page → write to `bosses.json` → hot-reload → refresh board. Expansion detection: timer-text → `instance_spawn_timer_override` (seconds, 3600–700000) → zone lookup table |
| `/removeboss <boss>` | Autocomplete by name/nickname or PQDI URL |

### Parse aggregation
| Command | Notes |
|---|---|
| `/parse <data> [type]` | EQLogParser "Send to EQ" paste. `type`: `instance` (starts timer) / `open_world` / `pvp` (stats only). Multiple submitters auto-merge |
| `/parseboss <boss> <data>` | Explicit boss selection for ambiguous parses |
| `/parseaoe <data>` | AoE phase merge, 5-min window, max-damage-per-player |
| `/parsenight [public]` | Full-night DPS combined parse |
| `/parsestats <boss>` | Aggregate scoreboard across all stored kills. Filters "Eye of *" dummies |
| `/parseleaderboard` | Officer: pin/update leaderboard in `PARSES_LOG_THREAD_ID` |
| `/parseagents` | Show active (last 20 min) and stale agent uploaders |
| `/parsereset` | Officer: clear session damage, test-thread cards, agent tracking |
| `/parsehelp` | Setup steps for the wolfpack-logsync agent |
| `/backfillparses` | Officer: push `parses.json` history → Supabase (idempotent via `find_or_create_encounter`) |
| `/backfillfromtestthread` | Officer: reverse-parse `AUTOPARSE_TEST_THREAD_ID` cards → Supabase |
| `/raidnight` | Officer: opens tonight's session thread with rolling parseboard |
| `/encounter [tonight\|view\|mine]` | Post-raid recap from Supabase |
| `/mystats <character>` | Per-character DPS (kills, avg, peak, per-boss breakdown). Ephemeral |
| `/mystatsall <character>` | Same, aggregated across main + alts |
| `/raidstats` | Full-night raid scoreboard (since midnight in `DEFAULT_TIMEZONE`) |

### Live-server + Hate
| Command | Notes |
|---|---|
| `/livekill <boss> [timer_unknown]` | Live-server raid boss kill — exact timer, no variance. Posts to `LIVE_CHANNEL_ID` |
| `/livehatekill <position> [timer_unknown] [killed_ago]` | Live-server Hate mini-boss (72h exact). `killed_ago`: `"2h30m"` for back-dating |
| `/livehate` | Live-server hate spot status list |
| `/hateboard` | Officer: post/refresh persistent live + PvP hate boards in `HATE_THREAD_ID`. Static floor maps + board embeds with toggle buttons |

Hate state is **dual-persisted** to survive volume loss: `state.json` + hidden JSON embeds in `HATE_THREAD_ID` (loaded on startup via `loadHateStateFromDiscord`).

### PvP
| Command | Notes |
|---|---|
| `/pvpkill <mob> [timer_unknown]` | Records kill with ±20% variance window |
| `/pvpunkill <mob>` | Undo |
| `/pvpspawn <mob>` | Mark spawned, delete card, offer ephemeral "🐺 Alert PVP" |
| `/pvphate` | List 10 hate spots with ±20% variance |
| `/pvphatekill <position> [timer_unknown] [killed_ago]` | 72h ±20% |
| `/pvpalert <zone>` | Ping `@PVP_ROLE`. 1-hour suppression: re-alerting within 1h edits existing message, appends zones |
| `/pvprole [silent]` | Toggle `@PVP` role membership |
| `/pvpnightpings` | Officer: post the overnight-ping opt-in board (🌙 tonight / 📌 always / 🔕 off). During quiet hours, automated pings go only to opt-ins |
| `/quake [time]` | Officer: reset all PvP mob timers. `"now"` or natural language (`"Friday 9pm"`). Creates Discord event for future times |
| `/markzek <character> <true\|false>` | Officer: sticky `is_zek` flag overrides auto-detection from `/who` |

Stale-alert suppression (post-redeploy): "opens soon" suppressed if earliest spawn > 10 min ago; "definitely spawned" if latest > 15 min ago.

**PvP quiet hours + overnight opt-in:** during an overnight window (`isPvpQuietHours()` in `utils/timezone.js`, default 1am–8am in `DEFAULT_TIMEZONE`, env-tunable via `PVP_QUIET_START`/`PVP_QUIET_END`, wraps midnight) the automated `@PVP` role pings (the two `checkPvpSpawns` spawn alerts + the `/api/agent/pvp` WP kill/death broadcasts) do NOT ping the whole role. Instead they ping only the **overnight opt-in list** (`state.pvpNight`: `permanent[]` + `tonight{userId:expiresAt}`), or nobody if the list is empty. The card still posts either way. `/pvpnightpings` (officer) posts the opt-in board in the PVP channel; its three buttons (`pvpnight_tonight` → until next 8am via `nextPvpQuietEnd()`, `pvpnight_always`, `pvpnight_remove`) let anyone add/remove themselves. Manual `/pvpalert` / `/pvpspawn` rallies are intentionally NOT gated (deliberate human action).

### Announcements
| Command | Notes |
|---|---|
| `/announce [time] [boss] [zone] [note]` | Creates thread in `#raid-mobs` named `<Boss/Zone> — <time>`, scrapes PQDI (HP/AC/hit/resists/specials/spells/drops), creates Discord Scheduled Event, posts compact announcement with Kill + Cancel buttons |
| `/addtarget <boss>` | Add to active announce thread's target list |
| `/removetarget <boss>` | Remove. Easter-egg chain (Fippy → Nillipuss → Emperor Crush) when last target cleared |
| `/adjusttime <time>` | Move raid time, preserve date |
| `/adjustdate <date>` | Move raid date, preserve time |

Time formats: `"8:30 PM"`, `"Thursday 9pm"`, `"tomorrow 8pm"`, `"in 2 hours"`. Requires "Manage Events" bot permission.

### DKP / Loot / Wishlist
| Command | Notes |
|---|---|
| `/dkp [character] [family]` | Balance lookup. 60s cache. Family mode shows main+alts+total |
| `/tick` | Officer: parse `RaidTick*.txt`, post attendance to OpenDKP. Enforces slot ordering 1→4, 1h overwrite window. Bonus/OT create separate raids |
| `/register <name> <class> <race> [main] [rank]` | Officer: create character in OpenDKP. Resolves ParentId via `rootCharId` (family root). Posts to `OFFICER_CHAT_CHANNEL_ID` |
| `/loot <items> [boss] [bid_minutes]` | Officer: parse Zeal paste, fetch PQDI drop table, label 🆕 NEW / 💎 ULTRA RARE, match wishlists. **Auction creation cURL captured** (PUT `/auctions`); button wiring still pending |
| `/wishlist add\|remove\|show` | Sealed-bid registry. Bids encrypted AES-256-GCM via `WISHLIST_BID_KEY`. `show` redacts bids to non-owner/non-officer |
| `/mywishlist [character]` | Private ephemeral: decrypted bids, drop history per item, DKP headroom vs balance, overcommit warning |
| `/sll <paste>` | Import lockouts from `/sll` or `#showlootlockouts`. Tiered match (boss name → nickname → zone). On Quarm: lockout remaining = respawn remaining exactly |

### Roster & character lookup
| Command | Notes |
|---|---|
| `/rosterimport <file>` | Officer: import OpenDKP JSON export. Family-tree grouping, persisted to `ROSTER_ACTIVE_THREAD_ID` + `ROSTER_INACTIVE_THREAD_ID` (chunked JSON, 3500 chars each) |
| `/rosterclean` | Dedupe in-memory roster + normalize thread messages in place (edits only — no notifications) |
| `/syncmembers` | Officer: Discord guild → `wolfpack_members` Supabase upsert. Auto-runs on startup + every 6h. Also syncs `wolfpack_roles` |
| `/who <character>` | Ephemeral lookup w/ "Show Family" button + class emoji + Quarmy/OpenDKP links |
| `/whoall <character>` | Full family tree embed |
| `/whois <character>` | Combines OpenDKP roster + `/who` observation history (level, guild, Zek flag, first/last-seen). Red embed if Zek-flagged |
| `/quarmy set\|clear\|view <character> [url]` | Store Quarmy profile URL per character. Persists in roster chunks. Officer-only writes |

### Onboarding / feedback / help
| Command | Notes |
|---|---|
| `/onboarding` | Show welcome again or toggle opt-out |
| `/suggest <boss> <time> [note]` | Member request → `SUGGEST_CHANNEL_ID` for officer claim |
| `/feedback <category> <message>` | Submit to `FEEDBACK_THREAD_ID` |
| `/feedbacklist` | Officer: format last 50 feedback entries |
| `/raidbosshelp` | Command reference embed (ephemeral) |
| `/ari` / `/autoraidinvite` / `/ariclear` | Auto-Raid-Invite character + password. No args = view (all). Set/clear = officer. Falls back to `ARI_DEFAULT_PASSWORD` |
| `/token` | Show `WOLFPACK_AGENT_TOKEN` (ephemeral, role-gated) — for agent setup |
| `/chatstats` | Streams `historical_chat.jsonl` (local mirror) for per-era counts. Cheap on multi-GB stores. Long-term: should read from Supabase `chat_messages` instead. |
| `/initerathreads` | **DEPRECATED** — bootstrap era-partitioned chat threads (era subdivision out of scope) |

### Roles
- `ALLOWED_ROLE_NAMES` — general (kill, parse, timers, etc.). Default: `Pack Member,Officer,Guild Leader`
- `OFFICER_ROLE_NAMES` — officer-only (board, cleanup, restore, addboss, announce, tick, register, etc.). Defaults to `ALLOWED_ROLE_NAMES` if unset

---

## State Schema (`data/state.json`)

```json
{
  "bosses": {
    "<bossId>": { "killedAt": 1745900000000, "nextSpawn": 1746483200000, "killedBy": "<userId>" }
  },
  "expansionBoards": {
    "<expansion>": { "messageIds": ["id1", "id2", "id3"] }
  },
  "channelSlots": {
    "summary": "<msgId>",
    "spawningTomorrow": "<msgId>",
    "dailySummary": "<msgId>",
    "threadLinks": "<msgId>",
    "tc_<expansion>": "<threadCooldownCardMsgId>",
    "alert_<bossId>": "<spawnAlertMsgId>"
  },
  "zoneCards": {
    "<zoneName>": { "messageId": "<id>", "threadId": "<id>" }
  },
  "dailyKills": [{ "bossId": "lord_nagafen", "killedAt": 1745900000000, "killedBy": "<userId>" }],
  "announceMessageIds": ["<msgId>", ...],
  "liveKills":   { "<bossId>":  { ... } },
  "pvpKills":    { "<mobId>":   { ... } },
  "hateBoards":  { "live": "<msgId>", "pvp": "<msgId>", "liveStateMsg": "<msgId>", "pvpStateMsg": "<msgId>" },
  "whoData":     { "<character>": { "level": 60, "guild": "...", "is_zek": false, "first_seen": ..., "last_seen": ... } },
  "ari":         { "character": "...", "password": "...", "setBy": "<userId>", "setByName": "...", "setAt": ... },
  "raidNight":   { "date": "2026-05-27", "slotsPosted": { "1": true, "2": true } },
  "quake":       { "scheduledFor": <ts>, "scheduledBy": "<userId>" },
  "pvpAlerts":   { "<msgId>": { "zones": [...], "howlers": [...], "lastAt": ... } }
}
```

**Anchor-ID priority** (all anchored slots): `process.env.<KEY>` → `state.channelSlots.<slug>` → `null`. Env vars override state so anchors survive volume loss across redeploys.

Writes are atomic: write to `.tmp` → `renameSync` → done.

---

## Key utility modules

| File | Purpose |
|---|---|
| `utils/config.js` | `EXPANSION_ORDER`, `EXPANSION_META`, `getThreadId()`, `getBossExpansion()`, `isPopLocked()` |
| `utils/state.js` (728 lines) | All `state.json` I/O. Atomic writes. Env-var-first anchor getters. Hate/PvP/quake/ARI/whoData/raidNight helpers |
| `utils/board.js` | `buildExpansionPanels()`, `buildAllExpansionPanels()` — packs zones into 25-button panels, splits when over capacity |
| `utils/embeds.js` | All embed builders: summary, spawning-tomorrow, zone kill cards, daily summary, spawn alerts, `/timers` |
| `utils/killops.js` | `postKillUpdate()` parallel refresh of 5 cards; `postOrUpdateExpansionBoard()` 3-tier board finding (state → env → channel scan → post fresh) |
| `utils/timer.js` | `calcNextSpawn()`, `parseTimeString()`, `parseUserTime()`, discord timestamp formatters |
| `utils/timezone.js` | TZ math for `DEFAULT_TIMEZONE` (default `America/New_York`); midnight calc, formatters |
| `utils/roles.js` | `hasAllowedRole()`, `hasOfficerRole()` from env vars |
| `utils/audit.js` | `postAuditEntry()` to `AUDIT_TRAIL_THREAD_ID`; opposing actions (kill↔unkill) remove the prior Undo button |
| `utils/supabase.js` | Service-role client; `recordParse()` → `find_or_create_encounter()` RPC → `merge_encounter_players()` RPC. Used by parse, encounter, wishlist, loot, member sync |
| `utils/opendkp.js` (418 lines) | Cognito auth (1h token cache), character/raid/auction API. Auction creation captured; bid submission + Award still stubs |
| `utils/loot.js` (370 lines) | Zeal paste parser, PQDI drop scrape, NEW/ULTRA_RARE labels, `parseQuarmyWishlist()` placeholder |
| `utils/bidCrypto.js` | AES-256-GCM for sealed wishlist bids. Format: `iv:tag:ct`. Auth-tag verifies on decrypt |
| `utils/roster.js` (480 lines) | OpenDKP export parser, family-tree grouping, Discord-thread chunked persistence, `_rootId` tracking for ParentId |
| `utils/wolfpackMembers.js` | Discord guild → Supabase `wolfpack_members` upsert in batches of 100; role catalog sync |
| `utils/sheets.js` | Google Sheets I/O via service account. `LUCLIN_KEYS_SHEET_ID` reserved (not yet consumed) |
| `utils/onboarding.js` | Welcome embed builder, opt-out registry (salted SHA-256), version-diff "what's new" |
| `utils/hateBoard.js` (213 lines) | Hate board builders + Discord state persistence (hidden JSON embeds) |
| `utils/itemNameDb.js` | Cached EQ item name lookup |
| `utils/suggestParser.js` | Parses forum post starter messages for boss/time/zone hints |

---

## Supabase Schema (`supabase/migrations/`)

Project: `zhtoekwakucbckvatfky`. Migrations applied via GitHub integration on merge to `main`.

### Tier 1 — `eqemu_*` (mirrors, weekly sync via `.github/workflows/sync-quarm.yml`)
| Table | Purpose |
|---|---|
| `eqemu_zone` | Zone catalog |
| `eqemu_items` | Item catalog (damage, delay, proc_effect, slots) |
| `eqemu_npc_types` | NPC catalog (hp, resists, raid_target, respawn_seconds) |
| `eqemu_spells` | Spell catalog (for proc resolution) |
| `eqemu_loottable` / `eqemu_loottable_entries` / `eqemu_lootdrop` / `eqemu_lootdrop_entries` | Loot tree |
| `eqemu_spawngroup` / `eqemu_spawnentry` / `eqemu_spawn2` | Spawn data |
| `sync_meta` | Tracks which upstream dump we're aligned with |

### Tier 2 — guild data (we write)
| Table | Purpose |
|---|---|
| `characters` | Roster (main/alt, opendkp_id, discord_id opt-in, rank, class) |
| `bosses_local` | Opt-in boss tracker (internal_id, nicknames, emoji, timer_override, expansion, notes) |
| `raid_nights` | Session metadata (date, zone, leader, raid_size_expected) |
| `encounters` | Boss kills (npc_id, started_at, total_damage, total_dps, raid_night_id) |
| `encounter_players` | Per-char aggregate per encounter (damage, dps, duration, rank, pets flag) |
| `contributions` | Parse submissions (encounter_id, contributor, source, raw_parse JSONB) |
| `combat_events` | Granular events (ts_ms, event_type, attacker, defender, ability, amount) |
| `loot_drops` | Awards (encounter_id, item_id, winner_character, dkp_spent, runner_up_bids JSONB) |
| `wishlists` | Per-char BIS (character_name, item_id, priority, **bid_amount_enc** AES-256-GCM) |
| `audit_log` | Mirror of Discord audit thread |
| `wolfpack_members` | Web OAuth user sync (discord_id, user_id, nickname, roles[], is_member) |
| `wolfpack_roles` | Discord role catalog (role_id, name, color, position) |
| `chat_messages` | All `/gu` + `/rs` chat — live (`/api/agent/chat`) and historical (`/api/agent/historical_chat`) routes both write here, dedup'd by `(guild_id, ts, channel, speaker, text)` |
| `who_observations` | Every `/who` line the agent reports. Mirrors `state.whoData` but durable + queryable. Dedup'd per minute per uploader |
| `character_live_state` | Current buffs + last-seen zone per character (Zeal snapshot). Upserted by `(guild_id, character)` via `POST /api/agent/live-state`. Read-open RLS; shown on `/me` Buffs & Zone. Migration `20260604000000_character_live_state.sql` |
| `patch_notes`, `officer_notes`, `travel_paths` | Various |

### RPC / views
- `find_or_create_encounter(p_guild_id, p_npc_id, p_started_at, p_duration, p_window_min=30)` — dedup by ±window
- `merge_encounter_players(p_encounter_id)` — recompute from contributions JSONB
- `eqemu_npc_drops` (view) — flattened NPC → item drops with effective chance
- `item_with_proc` (view) — items + resolved proc spells

### RLS
- Tier 1 + `patch_notes` + `sync_meta`: `anon` + `authenticated` SELECT
- Encounters, characters, raid_nights, etc.: `authenticated` SELECT (guild members only)
- `wishlists.bid_amount_enc`, `loot_drops.runner_up_bids`: service_role only
- `wolfpack_members`: self-read via `auth.uid() = user_id`
- Bot uses `service_role` → bypasses all RLS

---

## wolfpack-logsync Agent (`packages/wolfpack-logsync/`)

**What:** Single-file Node.js daemon. Zero npm deps. Tails `eqlog_*_pq.proj.txt` files, filters channels at the byte level, uploads combat events + `/who` data per encounter.

**Where it runs:** End-user's Windows machine, inside their EQ install dir. First-run wizard (`start-logsync.ps1`) copies itself into the EQ dir and offers Task Scheduler / desktop shortcut / Start menu options.

**Distribution:**
- `releases/WolfPackParser.zip` (bundled with Node launcher)
- `.github/workflows/release-parser.yml` rebuilds the zip on push
- `Parser.bat` + `RUN-FIRST-for-Node.js.bat` — Windows entry points

**Privacy filter (byte-level, pre-parse drop):**
- Officer chat, tells, `/raidsay`, `[#officer]`, `[guild]` — never leave the machine
- Only combat events + `/who` lines + boss kill broadcasts upload

**Upload modes:**
- `--watch` — tail forever, upload per-encounter (default)
- `--since <ISO>` — backfill from timestamp (binary-search seek). **Backfill scope = boss-matched combat + `/who` only** (see Scope Boundaries — chat backfill removed)
- `--once` — scan once, exit
- `--dry-run` — parse, skip upload

**Upload target:** Bot's `POST /api/agent/encounter` with bearer `WOLFPACK_AGENT_TOKEN`. Payload shape:
```json
{ "agent_version": "2.4.6", "character": "Hitya",
  "encounter": { "started_at": "ISO", "ended_at": "ISO", "boss_name": "Lord Nagafen",
                 "events": [ {"ts": "ISO", "type": "damage", "attacker": "...", "defender": "...", "ability": "...", "amount": 1830} ],
                 "pet_leaders": { "petname": "Owner" } } }
```

**Durable upload queue (v2.4.18+):** Every outbound POST (encounter, chat, pvp, bosskill, lockout, historical_chat, fun_event) routes through `enqueueUpload()` and persists to `logsync.queue.json` next to the other state files. Drain loop walks the queue every 15s with exponential backoff (30s → 60s → 2m → 4m → 8m → 10m cap). 4xx responses (400/401/403/404/422) drop entries as permanent failures with a loud warning; everything else retries. Cap of 50 entries per drain pass prevents huge backlogs from wedging the loop; if there's still due work, an immediate-3s-later kick keeps the queue flowing. Sync flush on every exit pathway (`SIGINT`/`SIGTERM`/normal `exit`) so the in-memory state isn't lost between debounced disk saves. Queue replays on agent startup so a crash mid-outage doesn't lose anything either. Dashboard header chip shows pending count + last error.

**Update gate (v2.4.18+):** `[U]` keypress and `POST /api/update` refuse to bounce the agent when:
1. Upload queue has pending entries
2. Opt-in backfill is running (`_activeBackfills.size > 0`)
3. An active fight is in progress (`stats.currentEncounterThreat` set, `flushedAt` null)

`Shift+U` (CLI) or `?force=1` (HTTP) bypasses. The `/api/state` payload includes `updateBlocked: <reason>` so the dashboard renders the right tooltip.

**Agent UI (localhost:7777, optional `--web-port`):** Dashboard, Tanks, Healers (BETA), DEEPS, Pets, Info/Stats, Opt-in Logs tabs. Versions tracked separately (`agent v2.4.6` etc.); auto-update prompt from `/api/agent/latest-version`. Per-character spell cast counter on the Info tab (reliable for the uploader, "(unknown)" for bystanders since EQ doesn't log spell names for them). `start-logsync.ps1` always passes `--web-port 7777` so the CLI and web UI run together.

> **⚠️ Dashboard escape hazard — ALWAYS check after editing `WEB_HTML`.** The
> entire agent dashboard (HTML + browser-side `<script>`) lives in one backtick
> template literal in `packages/wolfpack-logsync/index.js`. Two escape layers
> apply, and one mis-escaped char renders the WHOLE localhost page **blank**
> with an `Uncaught SyntaxError` (no partial degradation). The traps:
> - browser-JS newlines → write `\\n` (a bare `\n` becomes a real newline → unterminated string)
> - apostrophes in single-quoted browser strings (`you'll`, `don't`) → write `\\'` (a bare `\'` collapses to `'` → string ends early)
> - client-side backslashes → write `\\\\`
>
> We shipped this bug **twice** (v2.4.25 newline, v2.4.27 apostrophe). After
> ANY change to that template, run **`npm run check:dashboard`** (=
> `node scripts/check-agent-dashboard.js`), which extracts the served
> `<script>` body and parses it via `new Function()`. The
> `release-parser.yml` workflow runs it too and fails the release on a break.

**Fun events (v2.4.18+):** Lightweight side stream for guild-flavor counters. Each detector returns `{ type, caster, ts, raw_text }` or null; matches push into `funEventBuffer` and ride out via the 5s chat-relay flush to `POST /api/agent/fun_event`. Bot upserts into the `fun_events` Supabase table with `unique (guild_id, event_type, caster, event_ts)` so backfill replays are idempotent. First tenant: Peopleslayer LD counter. Planned: CoH Pearl, DI Emerald, Aegolism/Rune Peridot (MGB doubles).

---

## Web App (`web/` → `wolfpack.quest`)

**Stack:** Next.js 14 App Router, React 18, Tailwind, Supabase Auth.
**Auth:** Discord OAuth via Supabase. **Two gates at sign-in:** (a) Discord guild membership (`DISCORD_GUILD_ID`), (b) role membership via `ALLOWED_ROLE_NAMES`. Role IDs resolved via `wolfpack_roles` catalog (bot syncs every 6h). Display name = server nickname.
**Sessions:** HTTP-only cookies refreshed by `middleware.ts` on every request.
**Vercel env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_GUILD_ID`, `ALLOWED_ROLE_NAMES`.

**Routes:**
| Path | Status |
|---|---|
| `/` | Landing |
| `/auth/signin`, `/auth/callback`, `/auth/signout` | OAuth flow |
| `/loadouts` | Tank bandolier sets joined with `item_with_proc` view |
| `/parses` | Recent parse browser (encounter + encounter_players) |
| `/buffs` | Guild buff-coverage grid from `character_live_state` (Zeal). Categories via `web/lib/buffs.ts` (`categorizeBuff` + per-role `ROLE_TARGETS`); class filter + gaps view. Accurate only for members running the agent — caveat banner says so. Uncategorized buffs surface in an "Other" column to tune the map |
| `/planner` | Placeholder — TPS calc |

**Subdomains:** `parser.wolfpack.quest` → GitHub release download; `discord.wolfpack.quest` → guild invite.

---

## Spawn Checker

Runs every 5 minutes. For each boss with a recorded kill:
- **≤ 0 remaining:** archive zone card to Historic Kills, edit spawn alert in-place to "spawned" (`buildSpawnedEmbed`), post to expansion thread (fallback main channel), clear kill, refresh all cards
- **≤ 30 min remaining:** post spawn alert to expansion thread, store msg ID via `setSpawnAlertMessageId`
- **> 30 min remaining:** clear alert/spawned tracking sets so re-arming works if timer extended

Same loop also calls `checkPvpSpawns()`, `checkLiveSpawns()`, `checkQuakeAlert()`.

---

## Midnight Tasks

Runs at midnight in `DEFAULT_TIMEZONE`. Scheduled via recursive `setTimeout`. In order:
1. Build daily summary embed (`buildDailySummaryEmbed`, no "Available Now")
2. Edit `DAILY_SUMMARY_MESSAGE_ID` slot in main channel
3. Archive summary to Historic Kills thread
4. Archive all pending `/announce` messages → Historic Kills, delete originals
5. Archive passed announce threads (`archivePassedAnnounceThreads`)
6. Delete lingering spawn alert messages
7. Post PvP midnight summary (if any spawn within 24h)
8. Archive raid night parse thread (`archiveRaidSession`)
9. Consolidate multi-user parses within 10-min windows (`consolidateNightlyParses`)
10. `resetDailyKills()`, `clearAnnounceMessageIds()`

---

## Bosses Data (`data/bosses.json`)

133 bosses. Hot-reloaded via `getBosses()` (clears `require.cache` per call).

```json
{ "id": "lord_nagafen", "name": "Lord Nagafen", "zone": "Nagafen's Lair",
  "expansion": "Classic", "timerHours": 162,
  "nicknames": ["naggy", "nag", "nagafen"], "emoji": "🐉",
  "pqdiUrl": "https://www.pqdi.cc/npc/32040" }
```

Valid expansions: `Classic` (15) / `Kunark` (16) / `Velious` (35) / `Luclin` (47) / `PoP` (20, locked until 2026-10-01). `timerHours` is fractional (e.g. `66.05`).

`/addboss` and `/removeboss` write to the running container's `bosses.json`. With Docker: `docker cp quarm-raid-timer-bot:/app/data/bosses.json ./data/bosses.json` to sync back.

---

## Background Jobs Summary

| Job | Cadence | What |
|---|---|---|
| Spawn checker | 5 min | Spawn alerts + cleared kills + PvP/live/quake check-ins |
| Midnight summary | TZ midnight | See above |
| Chat dedup GC | 10s | Prune 5s-old entries |
| Wolfpack member sync | startup + 6h | Discord guild → Supabase `wolfpack_members` + `wolfpack_roles` |
| Agent version poll | startup | Caches `_currentAgentVersion()` from `packages/wolfpack-logsync/package.json` |
| Weekly Quarm sync | GitHub Actions cron | `.github/workflows/sync-quarm.yml` mirrors eqmac dump to Supabase Tier 1 |

---

## Deployment

### Railway (bot)
1. Deploy from GitHub
2. Variables tab — paste all from `.env.example`
3. Volume at `/app/data` for `state.json` + boss changes
4. `.dockerignore` excludes `data/state.json`; `Dockerfile` does `rm -f data/state.json` after `COPY .` as belt-and-suspenders

### Vercel (web)
1. Root directory: `web` (monorepo)
2. Env vars listed in `web/README.md`
3. Discord OAuth redirect: `https://<project>.supabase.co/auth/v1/callback` in Discord Dev Portal; Supabase auth Site URL = `https://wolfpack.quest`

### Supabase
1. Project `zhtoekwakucbckvatfky`. GitHub integration auto-applies new migrations on merge to `main`
2. Migration naming: `YYYYMMDDHHMMSS_short_description.sql`. Idempotent (`CREATE TABLE IF NOT EXISTS`)

### Git/merge convention
Always `git merge <branch> -m "vX.Y.Z — short reason"` — never `--no-edit`. Railway uses merge commit message as deploy name.

---

## First-time Setup Order

1. Create threads in `#raid-mobs`: Classic, Kunark, Velious, Luclin, PoP
2. Create: Historic Kills, Parse Logs, Onboarding, Hate, Roster Active, Roster Inactive, Audit Trail, Feedback
3. (Optional) PVP channel/thread, Live channel
4. Paste all thread IDs into `.env`
5. Deploy bot
6. `/board` — creates all slots + posts boards
7. Right-click each anchored message → copy ID → add to env vars (`SUMMARY_MESSAGE_ID`, `*_BOARD_IDS`, `*_COOLDOWN_ID`, etc.)
8. `/board` again to confirm edits in place (no new messages posted)
9. `/rosterimport` with OpenDKP export
10. `/hateboard` to seed hate boards
11. `/parseleaderboard` to pin leaderboard
12. `/onboarding` to seed the public Quick Start message

### Recovery After State Loss
`/restore <link1> [<link2> ...]` — paste links to any combination of Active Cooldowns cards (main or thread) and Daily Summary messages. Latest `nextSpawn` per boss wins. Parse data restored automatically from `PARSES_LOG_THREAD_ID` on startup. Hate state restored from hidden embeds in `HATE_THREAD_ID`.

---

## Known Issues / Future Work

- **PoP expansion locked** until 2026-10-01 via `isPopLocked()`. After unlock, run `/board` to activate the thread. Update `pqdiUrl` fields via `/addboss` once PQDI has NPC data.
- **OpenDKP auction creation:** API cURL captured (`PUT /clients/wolfpack/auctions`); button wiring in `handleLootPost` still pending. Bid submission and Award endpoints not yet captured.
- **`bosses.json` sync:** `/addboss` and `/removeboss` write to the running container. Must manually sync back to repo via `docker cp` (or rely on Railway volume).
- **`/cleanup` Historic Kills scope:** limited to 300 messages. Bump `fetchBotMessages(histThread, botId, 300)` if older dupes aren't caught.
- **Discord OAuth UI:** built; guild-membership check at sign-in still TODO (currently any Discord user can sign in).
- **`/loot` wishlist auto-bid settlement:** wishlist-match summary posts, but actual auction submission depends on auction-creation wiring.
- **`parseQuarmyWishlist`:** placeholder in `utils/loot.js`. Implement once Quarmy BIS page format confirmed.
- **`LUCLIN_KEYS_SHEET_ID`:** env var reserved for future Lucid Shards tracker; `utils/sheets.js` is wired but no command consumes it yet.
- **Era-thread chat routing** (`_handleAgentChat`): currently partitions by era; per scope boundary, will become direct post.
- **`find_or_create_encounter` doesn't set `zone_short` on insert.** Existing rows were backfilled 2026-05-28 from `data/bosses.json` → `eqemu_zone`. New encounters still land with NULL until the RPC (or the bot's call site) is updated to pass zone through.
- **EQEmu sync is incomplete:** `eqemu_npc_types.zone_short` is NULL for all 14k NPCs, and `eqemu_spawnentry` / `eqemu_spawn2` are empty. Fixing the sync would unlock zone derivation for non-boss NPCs (trash, named, etc.) without bosses.json fallback. Tracked at `scripts/sync-from-eqmac.js`.

## Raid Schedule & Coverage Window

Guild raids: **Sun / Wed / Thu, 8pm–midnight Eastern.** Any "should have been there"
check (gap detection, missing-parse warnings, attendance reconciliation) should
default to this window across each raid date. Anchor: the first recorded raid in
`raid_nights` is the historical baseline.

## Character Identity Scopes (read before building any roster-aware feature)

Three different "who is this" questions, three different sources — don't mix them:

| Question | Source | Commands that use it |
|---|---|---|
| "Is this a Wolf Pack member?" | **Union of two sources** (see "Guild membership" below) | `/dkp`, `/wishlist`, `/tick`, future gap detection |
| "Is this character in our roster at all?" | OpenDKP roster (`utils/roster.js` — `getCharacter`, `getAllNames`). Broader — includes Recruits, Members, Inactive, and Pack Members who aren't on the raid team. | `/who`, `/whoall`, `/quarmy`, `/register` |
| "Have we ever seen this character anywhere?" | OpenDKP roster + agent `/who` observations (`state.whoData` + `who_observations` table) | `/whois` only |

### Guild membership — the canonical predicate

A character counts as a Wolf Pack member iff **either** is true:

1. **Discord side:** the character's linked Discord user (via `characters.discord_id` →
   `wolfpack_members.discord_id`) has the **`Pack Member`** Discord role *or any
   role above it* — currently `Pack Member` (pos 39), `Raid Recruit` (40),
   `Raid Pack` (41), `Officer` (42), `Pack Leader` (43). Role IDs and positions
   live in `wolfpack_roles` (synced every 6h).
2. **OpenDKP side:** the character's rank is **`Raid Pack`** or higher — i.e.
   `Raid Pack`, `Pack Leader`, or `Officer` in `utils/roster.js::RANK_PRIORITY`.
   Lower OpenDKP ranks (`Recruit`, `Member`, `Inactive`) **do not** confer
   membership on their own.

The asymmetry is intentional: the Discord bar is broader (anyone who got the
Pack Member role for being in the guild socially), while OpenDKP `Raid Pack+` is
narrower (people on the actual raid team). The union covers gaps where a
character lives in only one system — a long-time raider who's not in Discord, or
a new member with the role but no OpenDKP entry yet.

Gap detection / attendance UI should evaluate this predicate per character, not
fall back to "every name in the OpenDKP roster" — that would flag retired alts,
trial recruits, etc. as missing raiders.

## Per-Character Data Floor (`member_since`) + Opt-Out

How far back a character's data counts toward *their* stats. Defined in
`supabase/migrations/20260530120000_character_data_floor.sql` →
view `public.character_data_floor`.

**Rule:** a player is only credited with the combat / raid chat / guild chat they
generated *while one of us*. We have no authoritative join date, so we floor at the
**earliest membership evidence** for the character's whole **family** (main + alts):

```
member_since = LEAST(first /gu line, first /rs line, first OpenDKP tick)   -- across the family
```

- **`LEAST`, not "first guild chat":** the earliest signal varies per person.
  Guild-chat capture only started recently for some, but OpenDKP attendance reaches
  back to 2024 — so a 2024 raider whose first *captured* `/gu` line is 2026 is
  correctly floored at their 2024 tick. Conversely some chatted in `/gu` for weeks
  before their first tick (joined socially, raided later); `LEAST` keeps those
  pre-raid kills too. First tick = "started raiding"; it is *not* the floor on its
  own because membership can predate it.
- **Family fallback:** an alt that never typed in `/gu` and never ticked under its
  own name inherits its main's floor (group by `coalesce(main_name, name)`).
  Validated 2026-05-30: collapses pre-floor combat from 1,258 → **27** of 15,609
  `encounter_players` rows; 145/147 families resolve a floor (47 rescued by ticks).
- **PvP is EXEMPT** — PvP kills count from the beginning of recorded history,
  no floor. The view does not touch PvP data.
- **`floor_source`** column labels which signal won (`guild_chat` / `tick` /
  `raid_chat`) for a confidence indicator in the UI.

**Opt-out:** two additive flags on `characters` let a member exclude specific
characters — `exclude_from_stats` (skip in combat/chat/log reporting & display;
agent should not upload) and `exclude_inventory` (don't catalog bank/inventory).
Use cases: a char that belongs to another guild, or one whose inventory they'd
rather not have indexed. Both surface in `character_data_floor`. Agent-side
honoring (don't upload for excluded chars) is a follow-up wiring task.

Consumers (`/me`, stats commands, agent `--since` backfill window) apply
`member_since` as the lower bound and skip `exclude_from_stats` characters.

> **Granular per-verb stats are NOT yet available.** `combat_events` is empty and
> `contributions.raw_parse` only retains per-player aggregates (`damage/dps/rank/
> duration`) plus a bare `eventCount` — the agent's `events[]` array is dropped
> after aggregation. A `/me` "grand total by spell/song/crush/stab/bite/…" and the
> "attacked yourself X times" counter (attacker == defender) therefore require the
> bot to start persisting per-ability rollups (or `combat_events`) **going
> forward**; they cannot be backfilled from what we currently store.

## Combat Rollups — Going-Forward Collection + Version Watermark

Defined in `supabase/migrations/20260530130000_combat_rollup_watermark.sql`.

The forward fix for the per-verb totals + self-attack counter:

- **Storage:** `encounter_combat_rollup` — one compact row per character per
  encounter: `by_skill` jsonb (damage/hits bucketed by skill or named
  spell/song), `total_hits`, `total_damage`, `self_attack_count` (swings/casts
  where attacker == defender). Deliberately a rollup, not an event stream, per
  the long-haul storage note.
- **Watermark:** `contributions.agent_version` + `contributions.has_ability_detail`
  stamp which uploads carried rollup data. Rollups exist **only** for uploads at/
  after the cutover agent version. We never reprocess old contributions — they
  have nothing to extract. This is the "only pull the new data" guarantee: ongoing
  collection is automatic; **enriching history is opt-in** (a member re-runs the
  agent over old logs; `find_or_create_encounter` dedups so the detailed
  contribution attaches to the existing encounter instead of duplicating it).
- **Resubmit nudge:** `character_rollup_coverage` view exposes
  `encounters_resubmittable` per character (total encounters − encounters with
  detail). `/me` surfaces "N of your past raids could unlock verb totals + fun
  counters — resubmit your logs" when > 0.

### Stat Visibility & Disclosure (tooltip contract)

Every log-derived stat surfaced anywhere declares a **scope**, a plain-English
"what we learn", and whether resubmitting unlocks it. Tooltips/popovers render a
scope badge + the explanation so members always know what's exposed:

| Scope | Meaning | Examples |
|---|---|---|
| `PRIVATE` | Shown only in the owner's `/me` (gated to that Discord user). Never named elsewhere. | your verb breakdown, your self-attack count, your inventory/bank, your inbound `/tell`s |
| `ANON` | Server-wide aggregate with **no names**. Safe to show publicly. | "Wolf Pack has attacked itself 47,000 times", guild-wide provisions summoned, total damage by the pack |
| `GUILD` | Named, visible to signed-in guild members. | parses/scoreboards, DKP, attendance, kill timers |

Collection gate: log-derived stats require the member to be running the agent with
logging on (no agent → no rollup). Characters flagged `exclude_from_stats` never
contribute and are never displayed. The disclosure copy should also state the
**upside** ("turn on logging / resubmit to unlock your verb totals and see how many
times you bit yourself") so the value exchange is explicit and opt-in.

## Gap Detection Signals (design notes — UI not yet built)

**Candidate pool:** characters where the guild-membership predicate above is true.

When asking "which guild members should be in this parse but aren't?" — combine
two signals:

1. **`/tick` raid attendance** (OpenDKP `raids` API + `raid_nights` join). If a
   member was ticked in for the slot containing the kill timestamp but has no
   row in `encounter_players`, they're a candidate gap.
2. **`/who` observations in the zone within the raid window** (`who_observations`
   table). A member seen in the kill's zone within ±10 min of `started_at` but
   absent from `encounter_players` is a stronger candidate gap.

Take the union, dedupe, sort by signal strength. Flag the rest as confident.

Non-member characters who appear in `encounter_players` or `who_observations`
are informational only — log them, don't flag them as missing.

## Historical Parse Recovery — Limitations of Old Chat Parses

Before the `wolfpack-logsync` agent existed, the guild called out parses in
`/gu` and `/rs` as text. Those messages live in `chat_messages` now (or will,
once the agent's `--since` backfill processes them). We can mine them to fill
out historical encounters, but the parse format itself has structural gaps —
when merging chat-extracted parses into `encounter_players`, be aware:

- **Captured well:** melee damage (tanks + melee DPS), some archery (a
  Luclin/Velious-era thing), some nukes that hit hard enough to register.
- **NOT captured:** DoT damage. EQ's DoTs tick server-side without a name
  attribution that other players can see — the casting class is the only one
  with full attribution. So necros, druids, shamans (any DoT-heavy class) will
  show up with damage well below their actual contribution.
- **Damage shields** attribute to the tank, not the DS caster (e.g., enchanter,
  cleric, magician). Tank parses will be inflated by ~10–20% on heavy-DS fights.
- **AoE / proc-heavy classes** (rogues, monks past Velious) parse cleanly because
  the parser sees the swing line directly.

Implication for the merge: keep `contributions.raw_parse->source` distinct
(e.g. `eqlogparser_send_to_eq`, `local_agent_v1`, `chat_extracted`) so the UI can
show a confidence indicator and so a future "true total" pass can prefer
agent-source data when both exist for the same encounter.

## Long-term Roadmap (collect now, display later)

Forward-looking ambitions that influence ingestion design but aren't ready to ship UI for:

- **Guild timeline.** OpenDKP raid + loot history merged with our encounters and roster history → a single browsable record of "how the pack progressed." Items acquired by character, DKP spent per night and to whom, main swaps, alt promotions over the expansions. OpenDKP raid pagination already works (`utils/opendkp.js`); we just don't have a Supabase mirror or a UI yet.
- **Chat → parse extraction.** `/backfillchatparses` mines `chat_messages` for EQLogParser pastes (window-merges consecutive lines from same speaker/channel within 15s, runs `parseEQLog`) and records contributions with `source='chat_extracted'` via `find_or_create_encounter`. Idempotent via `contributions_dedup` partial unique index. Caveats above (DoT/DS attribution) apply.
- **CH chain chatter analysis.** Cleric Complete Heal chains call out numbers ("1", "2", "ch3 up") in `/rs` and `/gu`. Once `chat_messages` has volume, mine for short numeric callouts from speakers tagged as `class='Cleric'` in `who_observations` and produce frequency stats per cleric. Pet project — would be a `/chchain [character]` ephemeral or a `/parses`-page widget.
- **Character path tracking.** Agent log verbosity is high enough that we can chart a character's zone-to-zone movement over months. Build the data pipeline (zone-change events tagged with character + timestamp), then a connection-map visualization that animates through time.
- **Optimized long-haul storage.** Three years of agent data is a lot. Before path tracking and combat_events go full ingest, design tables that compress well (partitioning by month, columnar layouts, or moving cold data to a cheaper tier). The current `combat_events` schema is unoptimized — granular event stream is fine for tonight but will balloon over years.
- **Parser install UX.** Two steps but they aren't obvious: install Node (handled) + enable EQ logging (`/log on` in-game OR `Logging=on` in `eqclient.ini`). Worth a short setup video and an in-parser detector that surfaces a banner when no `eqlog_*_pq.proj.txt` files exist or are stale.

---

## Conversation History Note

This bot was developed across multiple long Claude.ai sessions. Architectural decisions of note:

1. **Thread-based layout** (vs flat channel board) — each expansion got its own thread to reduce clutter.
2. **Env-var anchoring** — `SUMMARY_MESSAGE_ID`/`*_BOARD_IDS`/`*_COOLDOWN_ID` survive volume loss.
3. **3-tier board finding** in `postOrUpdateExpansionBoard` (state → env → channel scan → post fresh) prevents duplicate boards after redeploy.
4. **Zone kill cards** consolidated — one per zone, edited in place.
5. **Atomic state writes** — `.tmp` file + `renameSync`.
6. **`/restore` multi-link** — paste a week of daily summaries; latest `nextSpawn` per boss wins.
7. **Discord as source of truth** — parses from `PARSES_LOG_THREAD_ID`, hate state from hidden embeds in `HATE_THREAD_ID`, roster from chunked messages in roster threads. State.json and parses.json are local mirrors only.
8. **Sealed-bid wishlist** — AES-256-GCM per-entry with auth tag; service_role-only RLS; service degrades gracefully if `WISHLIST_BID_KEY` unset (dev only).
9. **Max-damage-per-player merge** — multi-perspective parse submissions for the same encounter merge by taking each player's highest reported damage.
10. **Stale-alert suppression** post-redeploy (PvP soon/spawned, 10/15 min thresholds) prevents notification flood.
