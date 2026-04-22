# Quarm Raid Timer Bot

A Discord bot for tracking Project Quarm instanced raid boss spawn timers. Data sourced from [PQDI.cc](https://www.pqdi.cc/instances).

---

## Features

- `/kill <boss>` — Record a kill, start the timer, update the board button to a skull
- `/unkill <boss>` — Clear a kill record, delete the kill message, reset the board button
- `/timers` — View all current spawn timers as an embed, filterable by zone and status
- `/board` — Post or in-place refresh the boss kill board (always exactly 10 reserved message slots)
- `/cleanup` — Remove duplicate board posts, re-anchor to the earliest set
- `/announce <boss> <time>` — Tagged raid announcement with kill button; archived to Historic Kills at midnight
- `/addboss <pqdi_url>` — Scrape a PQDI.cc NPC page, add the boss to bosses.json, and refresh the board automatically
- **Table-style board layout** — One message per expansion chunk; zones in 3-column grid embeds with boss buttons below
- **10 reserved board slots** — 6 active expansion panels + 4 `~Reserved for PoP~` placeholders, anchored at the top of the channel
- **Toggle kill on board** — Clicking a 💀 grey button acts as `/unkill`, clearing the record and deleting the kill message
- **Midnight EST summary** — Posts daily kill log + available bosses to Historic Kills thread; archives `/announce` messages
- **Clickable PQDI links** — All embeds link directly to the boss on PQDI.cc
- **Multi-role support** — `ALLOWED_ROLE_NAMES` accepts a comma-delimited list
- Slash commands auto-register on startup — no manual deploy step needed
- Persistent state survives restarts; bosses.json hot-reloaded after `/addboss`

---

## Setup: Discord Developer Portal

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Quarm Timer Bot")
3. Go to **Bot** tab → **Reset Token** → copy your **Bot Token**
4. Enable **Server Members Intent** under Privileged Gateway Intents
5. Go to **General Information** → copy your **Application ID** (`DISCORD_CLIENT_ID`)
6. Go to **OAuth2 → URL Generator**:
   - **Scopes:** `bot` and `applications.commands` (both required)
   - **Bot Permissions:** `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`
7. Invite the bot using the generated URL

> ⚠️ Both `bot` and `applications.commands` scopes are required. If you invited without `applications.commands`, kick and re-invite.
>
> ⚠️ `Manage Messages` is needed to delete kill embeds and midnight-archive announcements.

---

## Deployment

### Option A: Railway (recommended for hosted)

1. Push to GitHub
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Add all variables from `.env.example` under **Variables**
4. Add a **Volume** at `/app/data` to persist `state.json` across deploys

### Option B: Docker (self-hosted)

```bash
cp .env.example .env
nano .env          # fill in your values
docker-compose up -d
docker-compose logs -f
```

The `docker-compose.yml` mounts `./data` so state persists across rebuilds.

```bash
# Update:
git pull && docker-compose down && docker-compose up -d --build
```

### Option C: Local / development

```bash
npm install
cp .env.example .env
npm start
```

---

## Slash Commands Reference

### `/board`
Post the boss kill board. On subsequent calls, **edits existing messages in place** — no spam. Always maintains exactly **10 message slots** (6 active + 4 PoP reserved).

### `/cleanup`
Scan the channel for duplicate board posts (e.g. after a redeploy). Keeps the **earliest** board set, deletes later duplicates, updates state so future `/board` calls edit the correct messages.

### `/kill`
Record a boss kill. Posts a kill embed with a PQDI link, starts the timer, turns the board button grey with `💀 Boss Name (Died M/D)`.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete — full name, partial, or nickname (e.g. `naggy`, `emp`, `ahr`, `kt`) |
| `note` | ❌ | Optional note (e.g. "partial loot") |

### `/unkill`
Clear a kill record. Deletes the kill message from `#raid-mobs`, resets the board button to red.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete |

### `/timers`
Show all current spawn timers as a Discord embed.

| Option | Required | Description |
|--------|----------|-------------|
| `zone`   | ❌ | Filter to a specific zone |
| `filter` | ❌ | `all`, `spawned`, `soon` (within 2h), `unknown` |

### `/announce`
Announce a planned raid. Tags all allowed roles, includes a kill button, archived to Historic Kills at midnight.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete |
| `time` | ✅ | When (e.g. `"9:00 PM EST"`, `"in 30 minutes"`) |
| `note` | ❌ | Optional extra info |

### `/addboss`
Add a new boss directly from a PQDI.cc NPC URL. Scrapes name, zone, expansion, instance timer, and body type. Maps body type to an appropriate emoji (falls back to 🐉). Appends to `bosses.json` and refreshes the board automatically.

| Option | Required | Description |
|--------|----------|-------------|
| `url` | ✅ | Full PQDI NPC URL, e.g. `https://www.pqdi.cc/npc/32040` |

**Body type → emoji mapping examples:**
| Body Type | Emoji |
|-----------|-------|
| Dragon / Greater Dragon | 🐉 |
| Giant / Bane Giant | 🗿 |
| Undead / Greater Undead | 💀 |
| Shissar / Snake | 🐍 |
| Akheva / Greater Akheva | 👁️ |
| Elemental / Fire | 🔥 |
| Spider / Insect | 🕷️ |
| Fish / Aqua Mob | 🐟 |
| Unknown / fallback | 🐉 |

---

## Boss Board Behavior

**Clicking a red button (available boss):**
1. Records kill, posts embed with PQDI link in `#raid-mobs`
2. Board button turns grey: `💀 Boss Name (Died M/D)`
3. Embed text shows `💀 ~~Boss Name~~ (M/D)` with strikethrough
4. At 30 min before respawn: warning posted in `#raid-mobs`
5. On respawn: kill embed archived to Historic Kills thread, deleted from `#raid-mobs`, spawn notification posted, button resets to red

**Clicking a grey 💀 button (killed boss):**
1. Acts as `/unkill` — clears kill record
2. Deletes kill embed from `#raid-mobs`
3. Board button immediately resets to red

---

## Midnight EST Tasks

Every night at midnight Eastern time:
1. **Daily summary** posted to Historic Kills thread — bosses killed today + currently available
2. **All `/announce` messages** archived to Historic Kills thread (buttons stripped), deleted from `#raid-mobs`
3. **Daily kill log reset** for the next day

---

## Board Layout

The board uses **10 fixed message slots** posted at the top of `#raid-mobs`:

| Slot | Content |
|------|---------|
| 1 | ⚔️ Classic EverQuest |
| 2 | 🦎 Ruins of Kunark |
| 3 | ❄️ Scars of Velious (1/2) |
| 4 | ❄️ Scars of Velious (2/2) |
| 5 | 🌙 Shadows of Luclin (1/2) |
| 6 | 🌙 Shadows of Luclin (2/2) |
| 7–10 | 🔥 Planes of Power — Reserved |

Each active panel has an embed showing zones in a 3-column grid with boss names (strikethrough when killed), plus clickable buttons below.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | Application ID from Discord Developer Portal |
| `DISCORD_GUILD_ID` | ✅ | Server ID |
| `TIMER_CHANNEL_ID` | ✅ | `#raid-mobs` channel ID — board and alerts posted here |
| `HISTORIC_KILLS_THREAD_ID` | ✅ | Thread ID for kill archive and midnight summary |
| `ALLOWED_ROLE_NAMES` | ✅ | Comma-delimited role names (e.g. `Pack Member,Officer,Guild Leader`) |

---

## Finding Discord IDs

Enable Developer Mode: User Settings → Advanced → Developer Mode, then right-click anything to copy its ID.

| What | How |
|------|-----|
| `DISCORD_GUILD_ID` | Right-click server name → Copy Server ID |
| `TIMER_CHANNEL_ID` | Right-click `#raid-mobs` → Copy Channel ID |
| `HISTORIC_KILLS_THREAD_ID` | Right-click Historic Kills thread → Copy Channel ID |

---

## Boss Data (`data/bosses.json`)

100 bosses across Classic, Kunark, Velious, and Luclin, all with PQDI instance timer data. To add a boss manually:

```json
{
  "id": "unique_snake_case_id",
  "name": "Boss Name",
  "zone": "Zone Name",
  "expansion": "Luclin",
  "timerHours": 66,
  "nicknames": ["nick", "abbrev"],
  "emoji": "🐍",
  "pqdiUrl": "https://www.pqdi.cc/npc/XXXXX"
}
```

Or just run `/addboss https://www.pqdi.cc/npc/XXXXX` — the bot handles everything automatically.

Valid `expansion` values: `Classic`, `Kunark`, `Velious`, `Luclin`, `PoP`

---

## Project Structure

```
quarm-bot/
├── index.js                  Main: spawn checker, button handler, midnight tasks, auto-register
├── deploy-commands.js        Legacy manual registration (auto-runs on start; not needed)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── commands/
│   ├── addboss.js            /addboss  — scrape PQDI, add to bosses.json, refresh board
│   ├── announce.js           /announce — tagged raid announcement with kill button
│   ├── board.js              /board    — post or in-place refresh (10 fixed slots)
│   ├── cleanup.js            /cleanup  — remove duplicate board posts
│   ├── kill.js               /kill     — record kill, skull button, store message ID
│   ├── unkill.js             /unkill   — clear kill, delete message, reset button
│   └── timers.js             /timers   — show all spawn timers as embed
├── data/
│   ├── bosses.json           100 bosses: Classic/Kunark/Velious/Luclin (hot-reloaded on /addboss)
│   └── state.json            Live state: kills, board IDs, daily log, announce IDs (gitignored)
└── utils/
    ├── board.js              Board builder: 10-slot layout, PoP placeholders, auto-split
    ├── embeds.js             Discord embed builders (kill, alert, spawned, daily summary)
    ├── roles.js              Multi-role parser (ALLOWED_ROLE_NAMES comma-delimited)
    ├── state.js              Full state persistence: kills, board, dailyKills, announceMessageIds
    └── timer.js              Spawn time calculation, Discord timestamp formatting
```

---

## Required Permissions in `#raid-mobs`

| Permission | Why |
|------------|-----|
| Send Messages | Post kill embeds, spawn alerts, board messages, announcements |
| Embed Links | Render rich embeds with clickable links |
| Read Message History | Fetch board/kill/announce messages to edit or delete |
| Manage Messages | Delete kill embeds on respawn; delete announce messages at midnight |

The bot also needs **Send Messages** in the Historic Kills thread.
