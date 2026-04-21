# Quarm Raid Timer Bot

A Discord bot for tracking Project Quarm instanced raid boss spawn timers. Data sourced from [PQDI.cc](https://www.pqdi.cc/instances).

## Features

- `/kill <boss>` — Record a boss kill and automatically calculate next spawn time
- `/unkill <boss>` — Clear an incorrect kill record
- `/timers` — View all current spawn timers, filterable by zone and status
- Autocomplete search for boss names (just start typing!)
- Auto-posts to your timer thread when a boss spawns or is 30 minutes out
- Persistent state survives bot restarts
- Role-gated commands (`@Pack Member` by default)

---

## Setup: Discord Developer Portal

Before deploying, you need a bot application.

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it (e.g. "Quarm Timer Bot")
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable **Server Members Intent**
5. Copy your **Bot Token** (you'll need this for `.env`)
6. Go to **General Information** → copy your **Application ID** (this is your Client ID)
7. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`, `Embed Links`, `Read Message History`
8. Copy the generated URL and paste it in your browser to invite the bot to your server

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
   - `TIMER_THREAD_ID`
   - `ALLOWED_ROLE_NAME`
5. Railway will auto-detect Node.js and deploy

**Note:** Railway's free tier doesn't have persistent disk by default. State will reset on redeploy.
To persist state, add a Railway Volume:
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
# Edit .env with your values using nano, vim, etc.
nano .env

# 3. Register slash commands with Discord (run once)
npm install
npm run deploy-commands

# 4. Build and run
docker-compose up -d

# 5. View logs
docker-compose logs -f
```

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

# Register commands with Discord (run once, or after adding new commands)
npm run deploy-commands

# Start the bot
npm start
```

---

## Slash Commands Reference

### `/kill`
Record a boss as killed. Starts the respawn countdown.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | Yes | Autocomplete — type to search by name or zone |
| `note` | No | Optional note (e.g. "partial loot") |

### `/unkill`
Clear a kill record. Use if someone recorded the wrong boss or wrong time.

| Option | Required | Description |
|--------|----------|-------------|
| `boss` | Yes | Autocomplete — only shows bosses with recorded kills |

### `/timers`
Show current spawn timer status for all bosses.

| Option | Required | Description |
|--------|----------|-------------|
| `zone` | No | Filter to one zone |
| `filter` | No | `all`, `spawned`, `soon` (within 2h), `unknown` |

---

## Status Legend

| Icon | Meaning |
|------|---------|
| 🔴 | Spawned / available now |
| 🟡 | Spawning within 2 hours |
| 🟢 | On cooldown |
| ⬜ | Unknown — kill never recorded |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID from Discord Developer Portal |
| `DISCORD_GUILD_ID` | Your Discord server ID (right-click server → Copy ID) |
| `TIMER_THREAD_ID` | Channel/thread ID where spawn alerts are posted |
| `ALLOWED_ROLE_NAME` | Role name that can use /kill and /unkill (default: `Pack Member`) |

---

## Finding Your Thread ID

1. In Discord, enable **Developer Mode**: User Settings → Advanced → Developer Mode
2. Right-click the thread you want alerts posted to
3. Click **Copy Channel ID**
4. Paste that into `TIMER_THREAD_ID` in your `.env`

---

## Boss Data

All spawn timers are sourced from [pqdi.cc/instances](https://www.pqdi.cc/instances). The bot covers all instanced Luclin raid bosses plus out-of-era Classic/Kunark/Velious content.

To add or edit bosses, modify `data/bosses.json`. Each entry:
```json
{
  "id": "unique_snake_case_id",
  "name": "Boss Name",
  "zone": "Zone Name",
  "timerHours": 66,
  "pqdiUrl": "https://www.pqdi.cc/npc/XXXXX"
}
```

---

## Project Structure

```
quarm-bot/
├── index.js              Main bot entry point + spawn checker loop
├── deploy-commands.js    Run once to register slash commands
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── commands/
│   ├── kill.js           /kill command
│   ├── unkill.js         /unkill command
│   └── timers.js         /timers command
├── data/
│   ├── bosses.json       Boss definitions (edit to add/remove bosses)
│   └── state.json        Live kill/spawn state (auto-created, gitignored)
└── utils/
    ├── timer.js          Spawn calculation + time formatting helpers
    ├── state.js          Kill state persistence (read/write state.json)
    └── embeds.js         Discord embed builders
```
