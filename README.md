# Quarm Raid Timer Bot

A Discord bot for tracking Project Quarm instanced raid boss spawn timers. Data sourced from [PQDI.cc](https://www.pqdi.cc/instances).

---

## Features

- `/kill <boss>` — Record a kill, start the respawn timer, update the board button to show a skull
- `/unkill <boss>` — Clear a kill record, delete the kill message, reset the board button
- `/timers` — View all current spawn timers as a Discord embed, filterable by zone and status
- `/board` — Post or in-place refresh the clickable boss button board; smart-diffs new bosses from `bosses.json`
- `/cleanup` — Scan the channel for duplicate board posts, keep the earliest set, delete the rest
- `/announce <boss> <time>` — Post a tagged raid announcement with a kill button; archived to Historic Kills at midnight
- **Toggle kill on board** — Clicking a skull/grey button (already killed boss) acts as `/unkill`, clears the kill and deletes the message
- **Midnight EST summary** — Posts daily kill log and available-now list to the Historic Kills thread; archives `/announce` messages
- **Clickable PQDI links** — All kill, alert, and spawn embeds link directly to the boss on PQDI.cc
- **Multi-role support** — `ALLOWED_ROLE_NAMES` accepts a comma-delimited list of roles
- Slash commands auto-register on startup — no manual deploy step needed
- Persistent state survives restarts

---

## Setup: Discord Developer Portal

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Quarm Timer Bot")
3. Go to **Bot** tab → click **Reset Token** → copy your **Bot Token**
4. On the Bot page, enable **Server Members Intent** under Privileged Gateway Intents
5. Go to **General Information** → copy your **Application ID** (`DISCORD_CLIENT_ID`)
6. Go to **OAuth2 → URL Generator**:
   - **Scopes:** `bot` and `applications.commands` (both required)
   - **Bot Permissions:** `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`
7. Copy the generated URL and invite the bot to your server

> ⚠️ `applications.commands` scope is required for slash commands to appear. If you invited the bot without it, kick it and re-invite with a URL that includes both scopes.
>
> ⚠️ `Manage Messages` is required to delete kill embeds when archiving and to delete `/announce` messages at midnight.

---

## Deployment

### Option A: Railway (recommended for hosted)

1. Push this project to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repo
4. Go to **Variables** and add all values from `.env.example`
5. Add a **Volume** at mount path `/app/data` to persist `state.json` across deploys

### Option B: Docker (self-hosted)

```bash
cp .env.example .env
# Edit .env with your values
nano .env

docker-compose up -d
docker-compose logs -f
```

The `docker-compose.yml` mounts `./data` so state persists across rebuilds.

To update:
```bash
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
Post the clickable boss kill board. On subsequent calls, **edits existing messages in place** — no spam. Automatically picks up new bosses added to `bosses.json` without resetting kill state.

### `/cleanup`
Scan the channel for duplicate board posts (e.g. after a redeploy posted a second board). Keeps the **earliest** board set, deletes all later duplicates, and updates state so future `/board` calls edit the correct messages.

### `/kill`
Record a boss kill. Starts the timer, updates the board button to `💀 Boss Name (Died M/D)`, and posts a kill embed with a clickable PQDI link.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete — full name, partial, or nickname (e.g. `naggy`, `emp`, `ahr`, `kt`) |
| `note` | ❌ | Optional note (e.g. "partial loot", "contested") |

### `/unkill`
Clear a kill record. Deletes the kill message from `#raid-mobs` and resets the board button to red.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete — type to search |

### `/timers`
Show all current spawn timers as a Discord embed.

| Option | Required | Description |
|--------|----------|-------------|
| `zone`   | ❌ | Filter to a specific zone |
| `filter` | ❌ | `all`, `spawned`, `soon` (within 2h), `unknown` |

### `/announce`
Announce a planned raid takedown. Tags all allowed roles, includes a kill button, and archives to Historic Kills at midnight.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | ✅ | Autocomplete — same as /kill |
| `time` | ✅ | When (e.g. `"9:00 PM EST"`, `"in 30 minutes"`) |
| `note` | ❌ | Optional extra info |

---

## Boss Board Behavior

**Clicking a normal (red) button:**
1. Records the kill, posts a kill embed in `#raid-mobs` with a PQDI link
2. Turns the button grey with `💀 Boss Name (Died M/D)`
3. At 30 minutes before respawn: posts a warning in `#raid-mobs`
4. On respawn: archives kill embed to Historic Kills thread, deletes it from `#raid-mobs`, posts spawn notification, resets button to red

**Clicking a skull (grey) button — killed boss:**
1. Acts as `/unkill` — clears the kill record
2. Deletes the kill embed from `#raid-mobs`
3. Resets the button back to normal red immediately

---

## Midnight EST Tasks

Every night at midnight Eastern time the bot automatically:

1. **Posts a daily summary** to the Historic Kills thread listing all bosses killed that day and all bosses currently available
2. **Archives all `/announce` messages** from `#raid-mobs` to the Historic Kills thread (buttons stripped), then deletes the originals
3. **Resets the daily kill log** for the next day

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
| `TIMER_CHANNEL_ID` | ✅ | `#raid-mobs` channel ID |
| `HISTORIC_KILLS_THREAD_ID` | ✅ | Historic Kills thread ID — kill embeds, daily summary, and announcements are archived here |
| `ALLOWED_ROLE_NAMES` | ✅ | Comma-delimited role names (e.g. `Pack Member,Officer,Guild Leader`) |

---

## Finding Discord IDs

Enable Developer Mode: User Settings → Advanced → Developer Mode, then right-click anything to copy its ID.

| What you need | How to get it |
|---------------|---------------|
| `DISCORD_GUILD_ID` | Right-click server name → Copy Server ID |
| `TIMER_CHANNEL_ID` | Right-click `#raid-mobs` → Copy Channel ID |
| `HISTORIC_KILLS_THREAD_ID` | Right-click Historic Kills thread → Copy Channel ID |

---

## Boss Data

Timers sourced from [pqdi.cc/instances](https://www.pqdi.cc/instances). Covers all instanced Luclin raid bosses and out-of-era Classic/Kunark/Velious content.

To add or modify bosses, edit `data/bosses.json`:

```json
{
  "id": "unique_snake_case_id",
  "name": "Boss Name",
  "zone": "Zone Name",
  "expansion": "Luclin",
  "timerHours": 66,
  "nicknames": ["nick", "abbreviation"],
  "emoji": "🐍",
  "pqdiUrl": "https://www.pqdi.cc/npc/XXXXX"
}
```

Valid `expansion` values: `Classic`, `Kunark`, `Velious`, `Luclin`

After editing `bosses.json`, run `/board` — it will detect new bosses and add them without resetting kill state.

---

## Project Structure

```
quarm-bot/
├── index.js                  Main entry: spawn checker, button handler, midnight tasks, auto-register
├── deploy-commands.js        Legacy manual registration (not needed — auto-runs on start)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── commands/
│   ├── announce.js           /announce — tagged raid announcement with kill button
│   ├── board.js              /board    — post or in-place refresh boss button board
│   ├── cleanup.js            /cleanup  — remove duplicate board posts, keep earliest
│   ├── kill.js               /kill     — record kill, update board, store message ID
│   ├── unkill.js             /unkill   — clear kill, delete message, reset board button
│   └── timers.js             /timers   — show all spawn timers as embed
├── data/
│   ├── bosses.json           Boss definitions (name, zone, expansion, timer, nicknames, emoji)
│   └── state.json            Live state: kills, board IDs, daily log, announce IDs (gitignored)
└── utils/
    ├── board.js              Board panel builder — expansion headers, button rows, skull states
    ├── embeds.js             Discord embed builders (kill, alert, spawned, daily summary)
    ├── roles.js              Multi-role parser and membership checker
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
| Manage Messages | Delete kill embeds on archive; delete announce messages at midnight |

The bot also needs **Send Messages** in the Historic Kills thread to post summaries and archived records.
