# Quarm Raid Timer Bot — Claude Code Handoff
**Version:** 1.0.4  
**Runtime:** Node.js 20, discord.js v14  
**Deployment:** Railway (primary) or Docker  
**Guild:** Wolf Pack EQ (Quarm) — `DISCORD_GUILD_ID=1168893924329402420`

## Versioning Rule

On every revision, increment the **patch** version (`Z` in `x.y.z`) in both `package.json` and `README.md` unless a specific minor (`y`) or major (`x`) bump is requested. Update `CLAUDE.md` version header to match.

---

## What This Bot Does

Tracks instanced raid boss spawn timers for Project Quarm (EverQuest TLP server, currently Luclin era). Timer data sourced from [PQDI.cc](https://www.pqdi.cc/instances).

Users click buttons in expansion threads to record kills. The bot maintains live cooldown cards, a main-channel summary, and a "Spawning Tomorrow" preview. Kill state persists across restarts via `data/state.json` on a mounted volume.

---

## Architecture — Channel Layout

### `#raid-mobs` (main channel) — `TIMER_CHANNEL_ID`
Fixed message slots, always edited in place, never re-posted:

| Slot | Content | Anchored by env var |
|------|---------|---------------------|
| 1 | 📊 Active Cooldowns (all expansions, grouped) | `SUMMARY_MESSAGE_ID` |
| 2 | 🌅 Spawning in the Next 24 Hours | `SPAWNING_TOMORROW_MESSAGE_ID` |
| 3 | 📅 Daily Raid Summary (resets midnight EST) | `DAILY_SUMMARY_MESSAGE_ID` |
| 4 | Thread links (single message, all 5 expansions) | `THREAD_LINKS_MESSAGE_ID` |

### Expansion Threads (inside `#raid-mobs`)
One thread per expansion. Each thread contains (top to bottom):
1. `<Emoji> <Expansion> — Active Cooldowns` card — **edited in place** at top, anchored by `<EXP>_COOLDOWN_ID` env var
2. Zone kill cards — posted by `/kill`, edited in place per zone, deleted when boss respawns
3. Board panels (kill buttons) — edited in place, anchored by `<EXP>_BOARD_IDS` env var

| Thread | Env Var |
|--------|---------|
| Classic Thread | `CLASSIC_THREAD_ID` |
| Kunark Thread | `KUNARK_THREAD_ID` |
| Velious Thread | `VELIOUS_THREAD_ID` |
| Luclin Thread | `LUCLIN_THREAD_ID` |
| PoP Thread | `POP_THREAD_ID` |

### Historic Kills Thread — `HISTORIC_KILLS_THREAD_ID`
Receives:
- Midnight daily summaries (archived copy)
- Zone kill cards when boss respawns (archived with timestamp)
- Cancelled `/announce` messages

---

## File Structure

```
quarm-bot-v0.9.3/
├── index.js                   Entry point: client setup, interaction router, spawn checker, midnight tasks
├── deploy-commands.js         Legacy manual command registration (auto-runs on start now)
├── package.json               { "version": "0.9.3", "main": "index.js" }
├── Dockerfile                 node:20-alpine; RUN rm -f data/state.json (never bake state into image)
├── docker-compose.yml         Mounts ./data:/app/data for persistence
├── .dockerignore              Excludes data/state.json, .env from image
├── .gitignore                 Excludes data/state.json
├── .env.example               All env vars documented
│
├── commands/
│   ├── board.js               /board — post/edit all slots and thread boards
│   ├── cleanup.js             /cleanup — delete transients/dupes, anchor earliest boards
│   ├── kill.js                /kill — record kill, post/edit zone card in thread
│   ├── unkill.js              /unkill — clear kill, update zone card
│   ├── updatetimer.js         /updatetimer — override nextSpawn, refresh all
│   ├── announce.js            /announce — raid announcement + thread + Discord event
│   ├── timers.js              /timers — show spawn timers (autocomplete zone filter)
│   ├── addboss.js             /addboss <pqdi_url> — scrape PQDI, add to bosses.json, refresh board
│   ├── removeboss.js          /removeboss — remove boss, clear state, refresh board
│   └── restore.js             /restore <links> — rebuild state from any cooldowns/summary messages
│
├── utils/
│   ├── config.js              EXPANSION_ORDER, EXPANSION_META, getThreadId(), getBossExpansion()
│   ├── state.js               All state.json read/write; atomic writes via .tmp rename
│   ├── board.js               buildExpansionPanels(), buildAllExpansionPanels()
│   ├── embeds.js              All embed builders
│   ├── killops.js             postKillUpdate(), postOrUpdateExpansionBoard(), refresh*Card()
│   ├── roles.js               hasAllowedRole(), getAllowedRoles() from ALLOWED_ROLE_NAMES
│   └── timer.js               calcNextSpawn(), discordRelativeTime(), discordAbsoluteTime()
│
└── data/
    ├── bosses.json            109 bosses (Classic/Kunark/Velious/Luclin) — hot-reloaded
    └── state.json             Live state — NEVER commit, NEVER bake into Docker image
```

---

## State Schema (`data/state.json`)

```json
{
  "bosses": {
    "<bossId>": {
      "killedAt": 1745900000000,
      "nextSpawn": 1746483200000,
      "killedBy": "<discordUserId>"
    }
  },
  "expansionBoards": {
    "<expansion>": { "messageIds": ["id1", "id2", "id3"] }
  },
  "channelSlots": {
    "summary": "<messageId>",
    "spawningTomorrow": "<messageId>",
    "dailySummary": "<messageId>",
    "threadLinks": "<messageId>",
    "Classic": "<placeholderMsgId>",
    "tc_Classic": "<threadCooldownCardMsgId>",
    "alert_<bossId>": "<spawnAlertMsgId>"
  },
  "zoneCards": {
    "<zoneName>": { "messageId": "<id>", "threadId": "<id>" }
  },
  "dailyKills": [
    { "bossId": "lord_nagafen", "killedAt": 1745900000000, "killedBy": "<userId>" }
  ],
  "announceMessageIds": ["<messageId>"]
}
```

**Critical:** `channelSlots` keys:
- `summary` / `spawningTomorrow` / `dailySummary` / `threadLinks` → main channel fixed slots
- `<expansion>` (e.g. `"Classic"`) → placeholder message ID in main channel (not currently used much)
- `tc_<expansion>` (e.g. `"tc_Luclin"`) → cooldown card at top of expansion thread
- `alert_<bossId>` → spawn warning message ID (updated in-place to "spawned", deleted at midnight)

**State getters prefer env vars over state.json** for the anchor IDs, so they survive redeploys even if the volume isn't working. Pattern:
```js
function getSummaryMessageId() {
  return process.env.SUMMARY_MESSAGE_ID || loadState().channelSlots?.summary || null;
}
```

---

## Environment Variables

### Required
```
DISCORD_TOKEN
DISCORD_CLIENT_ID
DISCORD_GUILD_ID=1168893924329402420
TIMER_CHANNEL_ID=1496263398495621302
CLASSIC_THREAD_ID
KUNARK_THREAD_ID
VELIOUS_THREAD_ID
LUCLIN_THREAD_ID
POP_THREAD_ID
HISTORIC_KILLS_THREAD_ID
ALLOWED_ROLE_NAMES=Pack Member,Officer,Guild Leader
```

### Hardcoded slot anchors (highly recommended — paste once, survive any redeploy)
```
SUMMARY_MESSAGE_ID=1496610319534133248
SPAWNING_TOMORROW_MESSAGE_ID=1496610321438343228
DAILY_SUMMARY_MESSAGE_ID=1496610323732369579
THREAD_LINKS_MESSAGE_ID=<id>
CLASSIC_BOARD_IDS=<id1,id2,...>
KUNARK_BOARD_IDS=<id1,id2,...>
VELIOUS_BOARD_IDS=<id1,id2,...>
LUCLIN_BOARD_IDS=<id1,id2,...>
POP_BOARD_IDS=<id>
CLASSIC_COOLDOWN_ID=<id>
KUNARK_COOLDOWN_ID=<id>
VELIOUS_COOLDOWN_ID=<id>
LUCLIN_COOLDOWN_ID=<id>
POP_COOLDOWN_ID=<id>
```

---

## Key Utilities

### `utils/config.js`
```js
EXPANSION_ORDER = ['Classic', 'Kunark', 'Velious', 'Luclin', 'PoP']
EXPANSION_META = { Classic: { label, color, emoji, envKey }, ... }
getThreadId(expansion)    // → process.env[meta.envKey] or null
getBossExpansion(boss)    // → boss.expansion || 'Luclin'
```

### `utils/state.js`
All reads call `loadState()` (reads from disk each time).  
All writes call `saveState(state)` — atomic write via `.tmp` rename.  
Key functions: `recordKill`, `clearKill`, `getAllState`, `getBossState`, `overrideTimer`,  
`getExpansionBoard`, `saveExpansionBoard`, `getZoneCard`, `setZoneCard`, `clearZoneCard`,  
`getSummaryMessageId`, `setSummaryMessageId` (and spawning/daily/threadLinks variants),  
`getThreadCooldownId`, `setThreadCooldownId` (checks `<EXP>_COOLDOWN_ID` env var first),  
`getSpawnAlertMessageId`, `setSpawnAlertMessageId`, `clearSpawnAlertMessageId`, `getAllSpawnAlertMessageIds`

### `utils/killops.js`
```js
postKillUpdate(discordClient, channelId, bossId)
// Runs all 5 refreshes in parallel after any kill/unkill:
//   refreshExpansionBoard(client, exp, threadId, bosses)
//   refreshZoneCard(client, boss, threadId, bosses)
//   refreshThreadCooldownCard(client, exp, threadId, bosses)
//   refreshSummaryCard(client, channelId, bosses)        // always uses TIMER_CHANNEL_ID
//   refreshSpawningTomorrowCard(client, channelId, bosses) // always uses TIMER_CHANNEL_ID

postOrUpdateExpansionBoard(discordClient, expansion, threadId, bosses)
// 3-tier board finding (never posts new if existing board found):
//   1. state.json stored IDs
//   2. env var <EXP>_BOARD_IDS
//   3. Channel scan (fetchBotMessages → find earliest anchor title → collect N panels)
//   4. Post fresh only if all 3 fail
```

### `utils/board.js`
```js
buildExpansionPanels(expansion, bosses, killState)
// Returns array of { type, expansion, label, payload }
// Each panel = one Discord message with embed + ActionRows of buttons
// Zones start on new ActionRow for visual separation
// Max 5 ActionRows × 5 buttons = 25 buttons per panel
// Splits into multiple panels if needed (e.g. Luclin = 3 panels)

buildAllExpansionPanels(bosses, killState)
// Returns { Classic: [...], Kunark: [...], ... }
```

### `utils/embeds.js`
```js
buildZoneKillCard(zone, killedBosses)        // ☠️ Zone — one card, N boss fields
buildSummaryCard(bosses, killState)           // 📊 Active Cooldowns (all expansions)
buildSpawningTomorrowCard(bosses, killState)  // 🌅 Spawning in Next 24 Hours
buildExpansionCooldownCard(expansion, bosses, killState)  // 🌙 Luclin — Active Cooldowns
buildStatusEmbed(bosses, state, filterZone)  // /timers output
buildSpawnAlertEmbed(boss)                   // ⚠️ spawning soon
buildSpawnedEmbed(boss)                      // 🟢 has spawned
buildDailySummaryEmbed(killedToday, availableNow, bosses, dateLabel)
// dateLabel: "April 24, 2026" → changes "Killed Today" to "Killed April 24, 2026" in archives
// availableNow intentionally ignored (no "Available Now" section in output)
```

---

## Commands Reference

### `/board`
Always operates on `TIMER_CHANNEL_ID` regardless of where it's called from.  
Posts/edits 4 main-channel slots in order, then for each thread: cooldown card + board panels.  
Uses `editOrPost(channel, storedId, payload, onNewId)` — tries edit first, posts only if message gone.

### `/cleanup`
**What it deletes:**
- Main channel: transient embeds (`☠️`, `⚠️`, `🟢`), old-format boards, duplicate slot messages, duplicate thread-link messages
- Each thread: transient embeds, duplicate board sets (keeps earliest), duplicate cooldown cards (keeps earliest), stray thread-link messages
- Historic Kills thread: duplicate daily summaries for same date, strips "Available Now" from remaining ones

**What it edits in place:** all 4 main-channel slots, thread cooldown cards, board panels.  
**Anchor logic:** walks messages oldest-first; first occurrence of each slot title = canonical.

### `/restore <links>`
Accepts 1–10 space-separated Discord message links. Supported embed types:
- `📊 Active Cooldowns` (main channel summary)
- `<Expansion> — Active Cooldowns` (thread cooldown card)
- `📅 Daily Raid Summary` (parses "Killed Today" field)

**Merge strategy:** collects all entries, groups by `bossId`, **latest `nextSpawn` wins**.  
So paste a full week of daily summaries — the most recent kill of each boss wins.  
Entries whose `nextSpawn` has already passed are skipped.  
Writes directly to `state.json` atomically, then refreshes all boards and cards.

### `/kill <boss>`
Records kill → posts/edits zone kill card in expansion thread → calls `postKillUpdate`.  
If zone card already exists (same zone, other boss killed earlier), edits it to add new row.

### `/unkill <boss>`
Clears kill → updates zone card (removes row or deletes if last boss) → calls `postKillUpdate`.

### `/updatetimer <boss> <timeleft>`
Parses time strings: `"3d4h30m"` or `"Expires in 3 Days, 4 Hours, 30 Minutes, and 20 Seconds"`.  
Calls `overrideTimer(bossId, newNextSpawn)` then `postKillUpdate`.

### `/announce <boss> <time> [note]`
1. Creates a thread in `#raid-mobs` named `<Boss> — <time>`
2. Scrapes PQDI for HP, AC, hit range, resists, special abilities, spells, drops → posts in thread
3. Creates a Discord Scheduled Event (requires "Manage Events" bot permission)
4. Posts compact announcement wherever `/announce` was called (can be any channel) with:
   - Kill button (`kill:<bossId>`)
   - Cancel/Archive button (`cancel_announce`)
   - Links to thread and event

### `/addboss <pqdi_url>`
Scrapes PQDI NPC page. Expansion detection priority:
1. Human-readable "Instance Spawn Timer: X days and Y hours" text
2. `instance_spawn_timer_override` field (treated as **seconds**, not ms; sanity checked 3600–700000)  
3. Zone-name lookup table (from `pqdi.cc/zones`)

Body type → emoji mapping in `BODY_TYPE_EMOJI` map (dragon→🐉, giant→🗿, humanoid→🧍, etc.; fallback 🐉).  
Writes to `bosses.json`, hot-reloads, refreshes expansion thread board.

### `/removeboss <boss>`
Autocomplete by name/nickname or accepts PQDI URL.  
Removes from `bosses.json`, clears any kill state, refreshes board.

### `/timers [zone] [filter]`
Zone filter uses autocomplete (supports 33+ zones — avoids Discord's 25-choice limit).  
Filter options: `all`, `spawned`, `soon` (within 2h), `unknown`.

---

## Boss Data (`data/bosses.json`)

109 bosses. Schema:
```json
{
  "id": "lord_nagafen",
  "name": "Lord Nagafen",
  "zone": "Nagafen's Lair",
  "expansion": "Classic",
  "timerHours": 162,
  "nicknames": ["naggy", "nag", "nagafen"],
  "emoji": "🐉",
  "pqdiUrl": "https://www.pqdi.cc/npc/32040"
}
```

Valid `expansion` values: `Classic`, `Kunark`, `Velious`, `Luclin`, `PoP`  
`timerHours` is fractional — e.g. `66.05` for bosses with 66-hour + 3-minute timers.

**Hot reload:** all commands call `getBosses()` which does `delete require.cache[...]` before `require()`.  
This means `/addboss` and `/removeboss` take effect immediately without restart.

Breakdown: Classic (15) | Kunark (16) | Velious (35) | Luclin (43) | PoP (0, reserved)

---

## Spawn Checker (index.js)

Runs every 5 minutes. For each boss with a recorded kill:
- **≤0 remaining:** Archives zone card to Historic Kills thread (edits card to remove spawned boss, or deletes if last). Updates the spawn alert message in-place to "spawned" (`buildSpawnedEmbed`). Posts to expansion thread (falls back to main channel). Clears kill. Calls `postKillUpdate`.
- **≤30 min remaining:** Posts spawn alert to expansion thread, stores message ID via `setSpawnAlertMessageId`.
- **>30 min:** Clears alert/spawned tracking sets so re-arming works if timer is extended.

## Midnight Tasks (index.js)

Runs at midnight EST. Scheduled via recursive `setTimeout(msUntilMidnightEST())`.
1. Build `buildDailySummaryEmbed(dailyKills, [], bosses, dateLabel)` — no "Available Now"
2. Edit the fixed `DAILY_SUMMARY_MESSAGE_ID` slot in main channel
3. Archive summary to Historic Kills thread
4. Archive all pending `/announce` messages to Historic Kills thread, delete originals
5. Delete all lingering spawn alert messages (`getAllSpawnAlertMessageIds()`)
6. `resetDailyKills()`, `clearAnnounceMessageIds()`

---

## Board Button Handler (index.js)

Button custom IDs:
- `kill:<bossId>` — toggle: if boss is on cooldown → unkill, else → kill
- `cancel_announce` — archive announce to Historic Kills thread, delete from channel

The kill/unkill toggle logic is in `handleBoardButton()` in `index.js`. It duplicates some logic from `kill.js`/`unkill.js` intentionally (interaction context differs — button vs slash command).

---

## Deployment Notes

### Git / Merge Convention
Railway shows the merge commit message as the deployment name. Always merge to `main` with a descriptive `-m` flag:
```bash
git merge <branch> -m "v0.9.7 — brief description of main feature"
git push -u origin main
```
Never use `--no-edit` for merges — it produces "Merge branch '...'" which is meaningless in Railway's deploy history.
Also bump `CLAUDE.md` version header and `package.json` version before merging.

### Railway
- Deploy from GitHub, add env vars under Variables tab
- Add a Volume at `/app/data` — this is where `state.json` and bosses changes persist
- The `.dockerignore` excludes `data/state.json` from the image
- The `Dockerfile` runs `rm -f data/state.json` after `COPY . .` as a second safeguard

### Docker
```bash
cp .env.example .env && nano .env
docker-compose up -d
# Update:
git pull && docker-compose down && docker-compose up -d --build
# Sync bosses.json after /addboss:
docker cp quarm-raid-timer-bot:/app/data/bosses.json ./data/bosses.json
```

### First-time Setup Order
1. Create 5 threads inside `#raid-mobs`: Classic Thread, Kunark Thread, Velious Thread, Luclin Thread, PoP Thread
2. Create Historic Kills thread inside `#raid-mobs`
3. Add all thread IDs to `.env`
4. Deploy bot
5. Run `/board` — creates all slots and posts boards in threads
6. Right-click each anchored message → copy ID → add to `.env` (prevents re-posting on redeploy)
7. Run `/board` again to confirm all edits (no new messages posted)

### Recovery After State Loss
```
/restore <link-to-active-cooldowns>  [<link2> <link3> ...]
```
Paste links to any combination of Active Cooldowns cards (main channel or any thread) and Daily Raid Summary messages. Latest `nextSpawn` per boss wins. Can paste a whole week of daily summaries at once.

---

## Known Issues / Future Work

- **PoP expansion:** No bosses configured yet. PoP thread has a "Reserved" placeholder board. Add PoP bosses via `/addboss` when the expansion launches.
- **`/announce` Discord events:** Requires "Manage Events" bot permission. If not granted, announcement still works but no event is created.
- **`/announce` cross-channel kills:** If `/announce` is posted in `#event-chat` and someone clicks the Kill button there, the kill is recorded and boards update correctly, but the zone card posts in the expansion thread (correct behavior).
- **bosses.json sync:** `/addboss` and `/removeboss` write to the running container's `bosses.json`. Must manually sync back to repo. With Docker: `docker cp quarm-raid-timer-bot:/app/data/bosses.json ./data/bosses.json`
- **`/cleanup` scope:** Historic Kills thread scan is limited to 300 messages. Increase `limit` param in `fetchBotMessages(histThread, botId, 300)` if older duplicates aren't caught.

---

## Conversation History

This bot was built across a single long Claude.ai session. The full development history is available in the session transcript. Key architectural decisions made during the session:

1. **Thread-based layout** (vs flat channel board) — decided mid-session when the channel became cluttered. Each expansion got its own thread for boards + zone cards.
2. **Env-var anchoring** — added after repeated state loss on Railway redeploy. The `SUMMARY_MESSAGE_ID` etc. env vars mean the bot always edits the same messages regardless of state.json contents.
3. **3-tier board finding** in `postOrUpdateExpansionBoard` — state → env vars → channel scan → post fresh. Prevents duplicate boards after redeploy.
4. **Zone kill cards** consolidated — one card per zone (edited in place) instead of one per kill, to reduce channel noise.
5. **Atomic state writes** — `.tmp` file + `renameSync` to prevent corruption if process dies mid-write.
6. **`/restore` multi-link** — added after a state-loss incident where kills had to be reconstructed from a week of daily summaries.
7. **`/cleanup` never uses "."** — originally replaced messages with "." as placeholders. Changed to always delete transient messages and edit canonical ones in place.
