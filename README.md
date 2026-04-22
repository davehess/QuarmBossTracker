# Quarm Raid Timer Bot

A Discord bot for tracking Project Quarm instanced raid boss spawn timers. Data sourced from [PQDI.cc](https://www.pqdi.cc/instances).

---

## Features

- `/kill <boss>` — Record a boss kill and start the respawn countdown. Supports nicknames (e.g. `naggy`, `emp`, `ahr`, `kt`)
- `/unkill <boss>` — Clear an incorrect kill record
- `/timers` — View all current spawn timers, filterable by zone and status
- `/board` — Post or refresh the clickable boss button board in `#raid-mobs`
- **In-place board updates** — `/board` edits its existing messages rather than posting new ones, keeping the channel clean
- **Skull buttons** — Killed bosses show as `💀 Boss Name (Died M/D)` in grey until they respawn, then reset automatically
- **Kill archive** — When a boss respawns, the original kill embed is moved to a Historic Kills thread and deleted from `#raid-mobs`
- **Spawn notifications** — Auto-posts to `#raid-mobs` at 30 minutes out and again when a boss spawns
- Autocomplete search on boss name and all common nicknames
- Persistent state survives bot restarts
- Slash commands auto-register on startup — no manual deploy step needed
- Role-gated commands (`@Pack Member` by default, configurable)

---

## Setup: Discord Developer Portal

Before deploying, you need a bot application.

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Quarm Timer Bot")
3. Go to **Bot** tab → click **Reset Token** → copy your **Bot Token**
4. On the same Bot page, scroll to **Privileged Gateway Intents** — enable **Server Members Intent**
5. Go to **General Information** → copy your **Application ID** (this is your `DISCORD_CLIENT_ID`)
6. Go to **OAuth2 → URL Generator**:
   - Under **Scopes** check BOTH: `bot` **and** `applications.commands`
   - Under **Bot Permissions** check: `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`
7. Copy the generated URL at the bottom and paste it in your browser to invite the bot to your server

> ⚠️ **`applications.commands` scope is required** for slash commands to appear. If you invited the bot without it, kick it and re-invite using a URL generated with both scopes checked.
>
> ⚠️ **`Manage Messages` permission is required** so the bot can delete the original kill embed from `#raid-mobs` when archiving to the history thread.

Slash commands are **registered automatically** every time the bot starts — no need to run any separate script.

---

## Option A: Deploy to Railway (Recommended for hosted)

Railway is free for small bots and stays online 24/7.

1. Push this project to a GitHub repository
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repo
4. Go to your project → **Variables** tab and add all values from `.env.example`:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
   - `TIMER_CHANNEL_ID`
   - `HISTORIC_KILLS_THREAD_ID`
   - `ALLOWED_ROLE_NAME`
5. Railway will auto-detect Node.js and deploy

**Persistent state on Railway:** Railway's free tier doesn't have persistent disk by default, so `state.json` (kill records, board message IDs) will reset on redeploy. To avoid this, add a Railway Volume:
- Go to your service → **Volumes** → Add volume → mount path `/app/data`

---

## Option B: Docker (Self-hosted)

### Quick start

```bash
# 1. Clone / copy this project
git clone <your-repo> quarm-bot
cd quarm-bot

# 2. Set up environment
cp .env.example .env
# Edit .env with your values
nano .env

# 3. Build and start
docker-compose up -d

# 4. View logs
docker-compose logs -f
```

The `docker-compose.yml` mounts `./data` as a volume so `state.json` persists across container rebuilds.

### Updating the bot

```bash
git pull
docker-compose down
docker-compose up -d --build
```

---

## Option C: Run locally (development)

```bash
npm install
cp .env.example .env
# fill in .env

npm start
```

---

## Slash Commands Reference

### `/board`
Post the clickable boss kill board in the current channel. On subsequent calls, **edits the existing messages in place** — no new messages are created. Run this once in `#raid-mobs` to set it up; the board will stay current automatically after that.

### `/kill`
Record a boss as killed. Starts the respawn countdown, updates the board button to show a skull, and posts a kill embed in the channel.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | Yes | Autocomplete — type full name, partial name, or a nickname (e.g. `naggy`, `emp`, `ahr`) |
| `note` | No | Optional note (e.g. "partial loot", "contested") |

### `/unkill`
Clear a kill record. Use if someone recorded the wrong boss or the wrong time. Resets the board button back to normal.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | Yes | Autocomplete — type to search |

### `/timers`
Show current spawn timer status for all bosses as a Discord embed.

| Option | Required | Description |
|--------|----------|-------------|
| `zone` | No | Filter to a specific zone |
| `filter` | No | `all`, `spawned` (up now), `soon` (within 2h), `unknown` (never recorded) |

---

## Boss Board Behavior

When a member with the `@Pack Member` role clicks a boss button on the board:

1. A kill embed is posted in `#raid-mobs` showing who killed it and when it will respawn
2. The button immediately changes to `💀 Boss Name (Died M/D)` and turns grey
3. The bot checks every 5 minutes; at 30 minutes before respawn it posts a warning in `#raid-mobs`
4. When the timer expires:
   - The kill embed is copied to the **Historic Kills thread** with a timestamp header
   - The original kill embed is deleted from `#raid-mobs`
   - A "has spawned!" notification is posted in `#raid-mobs`
   - The board button resets to its normal red state

---

## Status Legend (in `/timers` output)

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
| `DISCORD_GUILD_ID` | ✅ | Your Discord server ID (right-click server → Copy ID) |
| `TIMER_CHANNEL_ID` | ✅ | Channel ID for `#raid-mobs` — spawn alerts and board posts go here |
| `HISTORIC_KILLS_THREAD_ID` | ✅ | Thread ID for the Historic Kills thread — kill embeds are archived here on respawn |
| `ALLOWED_ROLE_NAME` | ✅ | Exact role name that can use `/kill`, `/unkill`, and `/board` (default: `Pack Member`) |

---

## Finding Discord IDs

1. Enable **Developer Mode** in Discord: User Settings → Advanced → Developer Mode
2. Right-click any server, channel, or thread and choose **Copy Channel ID** (or **Copy Server ID** for the server)

| What you need | How to get it |
|---------------|---------------|
| `DISCORD_GUILD_ID` | Right-click your server name → Copy Server ID |
| `TIMER_CHANNEL_ID` | Right-click `#raid-mobs` → Copy Channel ID |
| `HISTORIC_KILLS_THREAD_ID` | Right-click your Historic Kills thread inside `#raid-mobs` → Copy Channel ID |

---

## Boss Data

All spawn timers are sourced from [pqdi.cc/instances](https://www.pqdi.cc/instances). The bot covers all instanced Luclin raid bosses plus out-of-era Classic/Kunark/Velious content, organized by expansion.

To add or edit bosses, modify `data/bosses.json`. Each entry:

```json
{
  "id": "unique_snake_case_id",
  "name": "Boss Name",
  "zone": "Zone Name",
  "expansion": "Classic",
  "timerHours": 162,
  "nicknames": ["naggy", "nag"],
  "emoji": "🐉",
  "pqdiUrl": "https://www.pqdi.cc/npc/XXXXX"
}
```

Valid values for `expansion`: `Classic`, `Kunark`, `Velious`, `Luclin`

---

## Project Structure

```
quarm-bot/
├── index.js                Main bot entry, spawn checker, button handler, command auto-register
├── deploy-commands.js      Legacy manual command registration (not needed — auto-registers on start)
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── commands/
│   ├── board.js            /board — post or in-place refresh the boss button board
│   ├── kill.js             /kill  — record a kill, update board, store kill message ID
│   ├── unkill.js           /unkill — clear a kill record and reset board button
│   └── timers.js           /timers — show all current spawn timers as an embed
├── data/
│   ├── bosses.json         Boss definitions: name, zone, expansion, timer, nicknames, emoji
│   └── state.json          Live state: kill records + board message IDs (auto-created, gitignored)
└── utils/
    ├── board.js            Board panel builder — constructs button rows with skull/normal states
    ├── timer.js            Spawn time calculation and Discord timestamp formatting
    ├── state.js            State persistence: kill records, killMessageId, board message IDs
    └── embeds.js           Discord embed builders for kill, spawn alert, and spawned notifications
```

---

## Permissions the Bot Needs in `#raid-mobs`

| Permission | Why |
|------------|-----|
| Send Messages | Post kill embeds, spawn alerts, board messages |
| Embed Links | Render rich embeds |
| Read Message History | Fetch existing board messages to edit in place |
| Manage Messages | Delete original kill embeds when archiving to history thread |

The bot also needs **Send Messages** permission in the Historic Kills thread to post archived kill records there.
