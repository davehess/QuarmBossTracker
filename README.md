# Quarm Raid Timer Bot

A Discord bot for tracking Project Quarm instanced raid boss spawn timers.
Timer data sourced from [PQDI.cc](https://www.pqdi.cc/instances) and [pqdi.cc/zones](https://www.pqdi.cc/zones).

---

## Features

| Command | Description |
|---------|-------------|
| `/board` | Post or in-place refresh the boss kill board (14 reserved slots anchored at top of channel) |
| `/kill <boss>` | Record a kill, start the timer, turn board button grey with skull |
| `/unkill <boss>` | Clear a kill record, delete the kill message, reset the board button |
| `/timers` | View all current spawn timers as an embed, filterable by zone and status |
| `/cleanup` | Remove duplicate board posts, re-anchor to the earliest set |
| `/announce <boss> <time>` | Tagged raid announcement with kill button; archived at midnight |
| `/addboss <pqdi_url>` | Scrape a PQDI.cc NPC page, add the boss to bosses.json, refresh the board |
| `/removeboss <boss>` | Remove a boss from the tracker, clear its kill state, refresh the board |

**Additional behaviors:**
- **Zone-per-row button layout** — Each zone's boss buttons start on a fresh row, creating clear visual separation
- **14 reserved board slots** — 9 active expansion panels + 5 `~Reserved for PoP~` placeholders, always anchored at the top of the channel
- **Toggle kill on board** — Clicking a grey 💀 button acts as `/unkill`: clears the record and deletes the kill message
- **Midnight EST summary** — Posts daily kill log + available bosses to Historic Kills thread; archives `/announce` messages
- **Clickable PQDI links** — All kill, alert, and spawn embeds link directly to the boss on PQDI.cc
- **Multi-role support** — `ALLOWED_ROLE_NAMES` accepts a comma-delimited list of role names
- **Hot-reloaded boss data** — bosses.json is re-read on every interaction, so `/addboss` and `/removeboss` take effect immediately without a restart
- Slash commands auto-register on startup — no manual deploy step needed

---

## Setup: Discord Developer Portal

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Quarm Timer Bot")
3. Go to **Bot** tab → **Reset Token** → copy your **Bot Token**
4. Enable **Server Members Intent** under Privileged Gateway Intents
5. Go to **General Information** → copy your **Application ID** (`DISCORD_CLIENT_ID`)
6. Go to **OAuth2 → URL Generator**:
   - **Scopes:** check both `bot` **and** `applications.commands`
   - **Bot Permissions:** `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`
7. Copy the URL at the bottom and use it to invite the bot to your server

> ⚠️ Both `bot` and `applications.commands` scopes are required for slash commands to appear. If you already invited the bot without `applications.commands`, kick it and re-invite using a new URL with both scopes.
>
> ⚠️ `Manage Messages` is required so the bot can delete kill embeds when archiving and remove `/announce` messages at midnight.

---

## Deployment

### Option A: Railway (recommended for hosted)

1. Push this project to GitHub
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Add all variables from `.env.example` under the **Variables** tab
4. Add a **Volume** at mount path `/app/data` to persist `state.json` and `bosses.json` across deploys

### Option B: Docker (self-hosted VPS, NAS, Portainer, etc.)

```bash
cp .env.example .env
# Fill in your values
nano .env

docker-compose up -d
docker-compose logs -f
```

The `docker-compose.yml` mounts `./data` as a volume — `state.json` and boss changes from `/addboss` and `/removeboss` persist across container rebuilds.

```bash
# To update the bot:
git pull && docker-compose down && docker-compose up -d --build
```

### Option C: Local / development

```bash
npm install
cp .env.example .env
# Fill in .env
npm start
```

---

## Slash Commands Reference

### `/board`
Post the clickable boss kill board. On subsequent calls, **edits existing messages in place** — no spam, no new messages. Always maintains exactly **14 message slots** (9 active + 5 PoP reserved).

If the panel count has changed (e.g. after `/addboss` adds a new zone), it will add the new panels and update the stored message IDs automatically.

### `/cleanup`
Scan the channel for duplicate board posts (e.g. after a redeploy accidentally posted a second board). Keeps the **earliest** set of board messages, deletes later duplicates, and updates `state.json` so future `/board` calls edit the correct messages.

### `/kill`
Record a boss kill. Posts a kill embed with a clickable PQDI link, starts the respawn countdown, and turns the board button grey with `💀 Boss Name (Died M/D)`.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete — full name, partial, or nickname (e.g. `naggy`, `emp`, `ahr`, `kt`) |
| `note` | ❌ | Optional note shown in the kill embed (e.g. "partial loot") |

### `/unkill`
Clear a kill record. Deletes the kill embed from `#raid-mobs`, resets the board button back to red.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete — type to search |

### `/timers`
Show all current spawn timers as a Discord embed. Visible only to you (ephemeral).

| Option | Required | Description |
|--------|----------|-------------|
| `zone`   | ❌ | Autocomplete filter — supports all 32+ zones |
| `filter` | ❌ | `all`, `spawned` (up now), `soon` (within 2h), `unknown` (never recorded) |

### `/announce`
Announce a planned raid takedown. Tags all allowed roles with a kill button. Archived to Historic Kills at midnight.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete |
| `time` | ✅ | When (e.g. `"9:00 PM EST"`, `"in 30 minutes"`) |
| `note` | ❌ | Optional extra info |

### `/addboss`
Add a new boss from a PQDI.cc NPC URL. Scrapes name, zone, expansion, instance timer, and body type. Appends to `bosses.json` and refreshes the board in place.

| Option | Required | Description |
|--------|----------|-------------|
| `url` | ✅ | Full PQDI NPC URL, e.g. `https://www.pqdi.cc/npc/32040` |

Expansion is detected from the numeric `expansion` field in PQDI's raw data, with a fallback to a zone-name lookup table built from [pqdi.cc/zones](https://www.pqdi.cc/zones). This correctly handles zones like Plane of Growth (Velious) that might otherwise be misclassified.

**Body type → emoji mapping:**

| PQDI Body Type | Emoji |
|----------------|-------|
| Dragon / Greater Dragon | 🐉 |
| Giant / Bane Giant | 🗿 |
| Undead / Greater Undead | 💀 |
| Humanoid / Human | 🧍 |
| Shissar / Snake | 🐍 |
| Akheva / Greater Akheva | 👁️ |
| Magical / Summon | ✨ |
| Elemental / Fire | 🔥 |
| Spider / Insect | 🕷️ |
| Fish / Aqua Mob | 🐟 |
| Iksar / Lizard Man | 🦎 |
| Unknown / fallback | 🐉 |

### `/removeboss`
Remove a boss from the tracker. Clears any active kill record, removes from `bosses.json`, and immediately refreshes the board.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete by name/nickname — or provide a full PQDI URL |

---

## Important: bosses.json and GitHub sync

`/addboss` and `/removeboss` write directly to `bosses.json` **on the machine running the bot** — not to GitHub. Changes persist as long as your data volume exists, but won't appear in your GitHub repo automatically.

**To sync changes back to GitHub:**
- **Docker:** `docker cp quarm-raid-timer-bot:/app/data/bosses.json ./data/bosses.json` then commit
- **Railway:** Download `bosses.json` from your volume, commit it to the repo

---

## Boss Board Behavior

**Clicking a red button (available boss):**
1. Records kill, posts embed with PQDI link
2. Board button turns grey: `💀 Boss Name (Died M/D)`
3. Embed shows `💀 ~~Boss Name~~ (M/D)` with strikethrough
4. At 30 minutes before respawn: warning posted in `#raid-mobs`
5. On respawn: kill embed archived to Historic Kills thread, deleted from `#raid-mobs`, spawn notification posted, button resets to red

**Clicking a grey 💀 button (killed boss):**
1. Acts as `/unkill` — clears kill record
2. Deletes kill embed from `#raid-mobs`
3. Board button immediately resets to red

---

## Midnight EST Tasks

Every night at midnight Eastern time the bot automatically:
1. Posts a **daily summary** to the Historic Kills thread: bosses killed that day + bosses currently available
2. Archives all **`/announce` messages** to the Historic Kills thread (buttons stripped), then deletes them from `#raid-mobs`
3. Resets the daily kill log for the next day

---

## Board Layout (14 reserved slots)

| Slot | Content | Rows used |
|------|---------|-----------|
| 1 | ⚔️ Classic EverQuest | 5/5 |
| 2 | 🦎 Ruins of Kunark (1/2) | 5/5 |
| 3 | 🦎 Ruins of Kunark (2/2) | 4/5 |
| 4 | ❄️ Scars of Velious (1/3) | 5/5 |
| 5 | ❄️ Scars of Velious (2/3) | 5/5 |
| 6 | ❄️ Scars of Velious (3/3) | 3/5 |
| 7 | 🌙 Shadows of Luclin (1/3) | 5/5 |
| 8 | 🌙 Shadows of Luclin (2/3) | 4/5 |
| 9 | 🌙 Shadows of Luclin (3/3) | 2/5 |
| 10–14 | 🔥 Planes of Power — Reserved | — |

Each panel has an embed showing zones in a 3-column grid (with boss names, strikethrough when killed), and clickable buttons below grouped by zone — each zone starts on its own button row for clear visual separation.

---

## Status Legend (`/timers`)

| Icon | Meaning |
|------|---------|
| 🔴 | Spawned / available now |
| 🟡 | Spawning within 2 hours |
| 🟢 | On cooldown |
| ⬜ | Unknown — kill never recorded |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | Application ID from Discord Developer Portal |
| `DISCORD_GUILD_ID` | ✅ | Server ID (right-click server → Copy Server ID) |
| `TIMER_CHANNEL_ID` | ✅ | `#raid-mobs` channel ID — board and alerts go here |
| `HISTORIC_KILLS_THREAD_ID` | ✅ | Thread ID — kill archive, daily summary, announcements go here |
| `ALLOWED_ROLE_NAMES` | ✅ | Comma-delimited role names (e.g. `Pack Member,Officer,Guild Leader`) |

---

## Finding Discord IDs

Enable Developer Mode: User Settings → Advanced → Developer Mode, then right-click anything to copy its ID.

| What | How to get it |
|------|---------------|
| `DISCORD_GUILD_ID` | Right-click server name → Copy Server ID |
| `TIMER_CHANNEL_ID` | Right-click `#raid-mobs` → Copy Channel ID |
| `HISTORIC_KILLS_THREAD_ID` | Right-click Historic Kills thread inside `#raid-mobs` → Copy Channel ID |

---

## Boss Data (`data/bosses.json`)

103 bosses across Classic, Kunark, Velious, and Luclin. All instance timers sourced from [pqdi.cc/instances](https://www.pqdi.cc/instances). Zone-to-expansion mapping from [pqdi.cc/zones](https://www.pqdi.cc/zones).

To add a boss manually (or use `/addboss` instead):

```json
{
  "id": "unique_snake_case_id",
  "name": "Boss Name",
  "zone": "Zone Name",
  "expansion": "Kunark",
  "timerHours": 66,
  "nicknames": ["nick", "abbrev"],
  "emoji": "🐍",
  "pqdiUrl": "https://www.pqdi.cc/npc/XXXXX"
}
```

Valid `expansion` values: `Classic`, `Kunark`, `Velious`, `Luclin`, `PoP`

---

## Project Structure

```
quarm-bot/
├── index.js                  Main: spawn checker, board button handler, midnight tasks, auto-register
├── deploy-commands.js        Legacy manual registration script (auto-runs on start; not needed)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── commands/
│   ├── addboss.js            /addboss   — scrape PQDI, add boss, fix expansion, refresh board
│   ├── announce.js           /announce  — tagged raid announcement with kill button
│   ├── board.js              /board     — post or in-place refresh (14 fixed slots)
│   ├── cleanup.js            /cleanup   — remove duplicate board posts, keep earliest
│   ├── kill.js               /kill      — record kill, skull button, store message ID
│   ├── removeboss.js         /removeboss — remove boss from tracker, clear state, refresh board
│   ├── timers.js             /timers    — show spawn timers (autocomplete zone filter, supports 32+ zones)
│   └── unkill.js             /unkill    — clear kill, delete message, reset board button
├── data/
│   ├── bosses.json           103 bosses: Classic/Kunark/Velious/Luclin (hot-reloaded on every interaction)
│   └── state.json            Live state: kills, board IDs, daily log, announce IDs (auto-created, gitignored)
└── utils/
    ├── board.js              Board builder: 14-slot layout, zone-per-row buttons, PoP placeholders, auto-split
    ├── embeds.js             Discord embed builders (kill, alert, spawned, daily summary)
    ├── roles.js              Multi-role parser (ALLOWED_ROLE_NAMES comma-delimited)
    ├── state.js              Full state persistence: kills, board IDs, dailyKills, announceMessageIds
    └── timer.js              Spawn time calculation, Discord timestamp formatting
```

---

## Required Permissions in `#raid-mobs`

| Permission | Why |
|------------|-----|
| Send Messages | Post kill embeds, spawn alerts, board messages, announcements |
| Embed Links | Render rich embeds with clickable PQDI links |
| Read Message History | Fetch board/kill/announce messages to edit or delete in place |
| Manage Messages | Delete kill embeds on respawn; delete announce messages at midnight |

The bot also needs **Send Messages** in the Historic Kills thread to post summaries and archived records.
