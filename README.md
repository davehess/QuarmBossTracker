# Quarm Raid Timer Bot

A Discord bot for tracking instanced raid boss spawn timers on Project Quarm (EverQuest TLP server, Luclin era).
Timer data sourced from [PQDI.cc](https://www.pqdi.cc/instances).

**Version:** 1.1.2 · **Runtime:** Node.js 20, discord.js v14 · **Deployment:** Railway or Docker

---

## Channel Layout

### `#raid-mobs` (main channel)

Four fixed message slots, always edited in place — never re-posted:

| Slot | Content |
|------|---------|
| 1 | 📊 Active Cooldowns (all expansions) |
| 2 | 🌅 Spawning in the Next 24 Hours |
| 3 | 📅 Daily Raid Summary (resets midnight) |
| 4 | Thread links (one message, all 5 expansions) |

### Expansion Threads (inside `#raid-mobs`)

One thread per expansion. Each thread contains:
1. **Active Cooldowns card** — edited in place at the top
2. **Zone kill cards** — posted when bosses are killed, edited/deleted as timers clear
3. **Board panels** with kill buttons — edited in place

| Thread | Env Var |
|--------|---------|
| Classic | `CLASSIC_THREAD_ID` |
| Kunark | `KUNARK_THREAD_ID` |
| Velious | `VELIOUS_THREAD_ID` |
| Luclin | `LUCLIN_THREAD_ID` |
| PoP | `POP_THREAD_ID` |

### Historic Kills Thread — `HISTORIC_KILLS_THREAD_ID`

Receives midnight daily summaries, zone kill cards when bosses respawn, and archived `/announce` messages.

### Onboarding Thread — `ONBOARDING_THREAD_ID`

Hosts the public Quick Start instructions and the encrypted opt-out registry (salted SHA-256 hashes — no plaintext user IDs).

### Parse Logs Thread — `PARSES_LOG_THREAD_ID`

Every `/parse` submission is archived here as a JSON embed. This is the **source of truth** for parse data and survives Railway volume wipes — the bot rebuilds `parses.json` from this thread on every startup.

---

## Commands

### Kill Tracking

| Command | Description |
|---------|-------------|
| `/kill <boss>` | Record a kill, start the respawn timer, post a zone kill card in the expansion thread |
| `/unkill <boss>` | Clear a kill record, remove the boss from the zone kill card |
| `/updatetimer <boss> <time>` | Override the next-spawn time (e.g. `"3d4h30m"`, `"Expires in 3 Days, 4 Hours"`) |
| `/timers [zone] [filter]` | View spawn timers — filter by zone (autocomplete, 33+ zones) or status |
| `/board` | Post or in-place refresh all 4 main-channel slots and all expansion thread boards |
| `/cleanup` | Remove duplicate/stale messages, re-anchor boards to earliest copies |
| `/restore <links...>` | Rebuild kill state from any Active Cooldowns or Daily Summary message links |

### Parse Tracking

| Command | Description |
|---------|-------------|
| `/parse <data>` | Submit an EQLogParser "Send to EQ" DPS parse — boss auto-detected from the header |
| `/parseboss <boss> <data>` | Submit a parse with explicit boss selection |
| `/parsestats <boss>` | DPS scoreboard and raidwide metrics for a boss across all stored kills |
| `/parseaoe <data>` | Submit an AoE parse combining damage within a 5-minute window (max damage per player) |
| `/parsenight [public]` | Full-night DPS summary across every kill tonight |
| `/raidnight` | Open tonight's raid parse thread with a live rolling scoreboard |

EQLogParser "Send to EQ" format:
```
<Boss> in <N>s, <X>K/<X>M Damage @<X>K, 1. Player = <X>K@<X> in <X>s | ...
```

### Raid Announcements

| Command | Description |
|---------|-------------|
| `/announce time:<when> [boss:<name>] [zone:<zone>] [note:<text>]` | Create a raid announcement, a thread, and a Discord event |
| `/addtarget <boss>` | Add a boss to the active announce thread's target list |
| `/removetarget <boss>` | Remove a boss from the target list |
| `/adjusttime <time>` | Update the raid time in the announce thread and Discord event |
| `/adjustdate <date>` | Update the raid date (e.g. `"Friday"`, `"4/30"`) |

**Time formats:** `"8:30 PM"`, `"Thursday 9pm"`, `"tomorrow 8pm"`, `"8:30 PM EST"`, `"in 2 hours"`

The announce thread contains a live control panel. Use the **Cancel Event** button to cancel and archive.

### PVP Tracking

| Command | Description |
|---------|-------------|
| `/pvpkill <mob> [timer_hours]` | Record a PVP mob kill with an optional respawn timer (default: `PVP_DEFAULT_TIMER_HOURS`) |
| `/pvpunkill <mob>` | Remove a PVP kill record |
| `/quake [time]` | Schedule a quake (`"now"`, `"9pm"`, `"in 2 hours"`) — resets all PVP mob timers, creates a Discord event |
| `/pvprole [silent]` | Toggle your @PVP role; without `silent`, posts a wolf announcement to the PVP channel |
| `/pvpalert <zone>` | Ping @PVP with a howl message; other users click 🐺 Howl! to join |

### Boss Management

| Command | Description |
|---------|-------------|
| `/addboss <pqdi_url>` | Scrape a PQDI.cc NPC page, add to `bosses.json`, refresh the board |
| `/removeboss <boss>` | Remove a boss, clear its kill state, refresh the board |

### Help & Onboarding

| Command | Description |
|---------|-------------|
| `/raidbosshelp` | Full command reference (ephemeral) |
| `/onboarding` | Show the Wolf Pack welcome message again, or toggle your opt-out preference |

---

## Onboarding System

When a new member joins, the bot sends them a welcome message (DM, or falls back to the onboarding thread) covering the three pillars of coordination: accountability, timing, and announcements. Buttons let them indicate intent (PVP, organizer, or attendee) and see tailored follow-up.

- **Opt out:** Click "Don't show me this again" in the welcome message. The bot records a salted SHA-256 hash of the user ID — no plaintext IDs are stored anywhere.
- **Opt back in / view again:** Run `/onboarding` at any time.
- **Version tracking:** The opt-out includes the bot version. If a new version ships new commands, opted-out users receive a brief "what's new" notice.
- **Registry:** Stored as an embed in `ONBOARDING_THREAD_ID` and reloaded on every startup.

---

## Setup: Discord Developer Portal

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → name it → **Bot** tab → **Reset Token** → copy the **Bot Token**
3. Enable **Server Members Intent** under Privileged Gateway Intents
4. **General Information** → copy your **Application ID** (`DISCORD_CLIENT_ID`)
5. **OAuth2 → URL Generator:**
   - Scopes: `bot` and `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`, `Manage Events`, `Manage Roles`
6. Copy the generated URL and invite the bot to your server

> `Manage Events` is required for Discord Scheduled Events created by `/announce` and `/quake`.
>
> `Manage Roles` is required for `/pvprole` to add and remove the @PVP role.
>
> **Server Members Intent** is required for the member-join onboarding messages.

---

## Deployment

### Railway (recommended)

1. Push this repo to GitHub
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Add all variables from `.env.example` under the **Variables** tab
4. Add a **Volume** at mount path `/app/data` to persist `state.json` and `bosses.json`

### Docker

```bash
cp .env.example .env
nano .env          # fill in your values
docker-compose up -d
docker-compose logs -f

# To update:
git pull && docker-compose down && docker-compose up -d --build
```

### Local / Development

```bash
npm install
cp .env.example .env
npm start
```

---

## First-Time Setup Order

1. Create 5 expansion threads inside `#raid-mobs`: Classic, Kunark, Velious, Luclin, PoP
2. Create a Historic Kills thread inside `#raid-mobs`
3. Create a Parse Logs thread (e.g. "Parse Logs") — paste its ID into `PARSES_LOG_THREAD_ID`
4. Create an Onboarding thread (e.g. "Getting Started") — paste its ID into `ONBOARDING_THREAD_ID`
5. Optionally create a PVP channel or thread
6. Add all thread/channel IDs to your env vars
7. Deploy the bot
8. Run `/board` — creates all 4 main-channel slots and posts boards in each thread
9. Right-click each anchored message → Copy ID → add to env vars (prevents re-posting on redeploy)
10. Run `/board` again to confirm everything edits in place (no new messages posted)

### Recovery After State Loss

```
/restore <link1> [<link2> ...]
```

Paste links to any combination of Active Cooldowns cards and Daily Raid Summary messages. The most recent `nextSpawn` per boss wins. Parse data is recovered automatically from the Parse Logs thread on startup.

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | Server ID |
| `TIMER_CHANNEL_ID` | `#raid-mobs` main channel ID |
| `CLASSIC_THREAD_ID` | Classic expansion thread ID |
| `KUNARK_THREAD_ID` | Kunark expansion thread ID |
| `VELIOUS_THREAD_ID` | Velious expansion thread ID |
| `LUCLIN_THREAD_ID` | Luclin expansion thread ID |
| `POP_THREAD_ID` | PoP expansion thread ID |
| `HISTORIC_KILLS_THREAD_ID` | Historic Kills thread ID |
| `PARSES_LOG_THREAD_ID` | Parse Logs thread ID (parse data source of truth) |
| `ONBOARDING_THREAD_ID` | Onboarding thread ID (quick-start instructions + opt-out registry) |
| `ALLOWED_ROLE_NAMES` | Comma-delimited role names (e.g. `Pack Member,Officer,Guild Leader`) |

### Hardcoded Slot Anchors (recommended — paste once, survive any redeploy)

| Variable | Description |
|----------|-------------|
| `SUMMARY_MESSAGE_ID` | Active Cooldowns message in main channel |
| `SPAWNING_TOMORROW_MESSAGE_ID` | Spawning Tomorrow message |
| `DAILY_SUMMARY_MESSAGE_ID` | Daily Summary message |
| `THREAD_LINKS_MESSAGE_ID` | Thread links message |
| `CLASSIC_BOARD_IDS` | Comma-delimited board panel message IDs for Classic thread |
| `KUNARK_BOARD_IDS` | Kunark board IDs |
| `VELIOUS_BOARD_IDS` | Velious board IDs |
| `LUCLIN_BOARD_IDS` | Luclin board IDs |
| `POP_BOARD_IDS` | PoP board IDs |
| `CLASSIC_COOLDOWN_ID` | Active Cooldowns card at top of Classic thread |
| `KUNARK_COOLDOWN_ID` | Kunark cooldown card ID |
| `VELIOUS_COOLDOWN_ID` | Velious cooldown card ID |
| `LUCLIN_COOLDOWN_ID` | Luclin cooldown card ID |
| `POP_COOLDOWN_ID` | PoP cooldown card ID |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_TIMEZONE` | `America/New_York` | IANA timezone for time parsing and midnight tasks |
| `ARCHIVE_CHANNEL_ID` | — | Channel to receive archived raid event summaries |
| `BOSS_OUTPUT_CHANNEL_ID` | — | Channel where `bosses.json` is posted after `/addboss` or `/removeboss` |
| `RAID_CHAT_CHANNEL_ID` | — | Channel for `/raidnight` threads on raid nights (falls back to `TIMER_CHANNEL_ID`) |
| `PVP_CHANNEL_ID` | — | Channel for PVP announcements and alerts |
| `PVP_THREAD_ID` | — | Thread for PVP (takes priority over `PVP_CHANNEL_ID`) |
| `PVP_ROLE` | `PVP` | Name of the Discord role to ping for PVP commands |
| `PVP_DEFAULT_TIMER_HOURS` | `72` | Default respawn timer for `/pvpkill` |

---

## Spawn Checker

Runs every 5 minutes. For each boss with an active kill:

- **≤ 0 remaining:** Archives zone kill card to Historic Kills thread, updates spawn alert to "spawned," clears kill, refreshes all cards.
- **≤ 30 min remaining:** Posts a spawn warning to the expansion thread, stores the message ID for in-place update.
- **> 30 min:** Clears alert tracking so the warning re-arms if the timer is extended.

---

## Midnight Tasks

Run at midnight in `DEFAULT_TIMEZONE` (default: Eastern):

1. Update the fixed Daily Summary slot in the main channel
2. Archive the summary to the Historic Kills thread
3. Archive all pending `/announce` messages to Historic Kills, then delete originals
4. Archive all passed announce threads
5. Delete stale spawn alert messages
6. Post PVP mob spawning-today summary to the PVP channel (if any spawn within 24h)
7. Archive the raid night parse thread
8. Consolidate multi-user parse submissions within 10-minute windows (max damage per player)
9. Reset the daily kill log

---

## Boss Data

109 bosses across Classic (15), Kunark (16), Velious (35), and Luclin (43). PoP reserved.

`bosses.json` schema:

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

Boss data is hot-reloaded on every command — `/addboss` and `/removeboss` take effect immediately without a restart.

> With Docker, sync back after `/addboss`: `docker cp quarm-raid-timer-bot:/app/data/bosses.json ./data/bosses.json`

---

## Project Structure

```
quarm-raid-timer-bot/
├── index.js                   Entry point: client, interaction router, spawn checker, midnight tasks
├── package.json               version 1.0.1
├── Dockerfile
├── docker-compose.yml
├── railway.toml
├── .env.example
│
├── commands/
│   ├── board.js               /board
│   ├── cleanup.js             /cleanup
│   ├── kill.js                /kill
│   ├── unkill.js              /unkill
│   ├── updatetimer.js         /updatetimer
│   ├── timers.js              /timers
│   ├── restore.js             /restore
│   ├── announce.js            /announce
│   ├── adjusttime.js          /adjusttime
│   ├── adjustdate.js          /adjustdate
│   ├── addtarget.js           /addtarget
│   ├── removetarget.js        /removetarget
│   ├── addboss.js             /addboss
│   ├── removeboss.js          /removeboss
│   ├── parse.js               /parse
│   ├── parseboss.js           /parseboss
│   ├── parsestats.js          /parsestats
│   ├── parseaoe.js            /parseaoe
│   ├── parsenight.js          /parsenight
│   ├── raidnight.js           /raidnight
│   ├── pvpkill.js             /pvpkill
│   ├── pvpunkill.js           /pvpunkill
│   ├── quake.js               /quake
│   ├── pvprole.js             /pvprole
│   ├── pvpalert.js            /pvpalert
│   ├── onboarding.js          /onboarding
│   └── raidbosshelp.js        /raidbosshelp
│
├── utils/
│   ├── config.js              EXPANSION_ORDER, EXPANSION_META, getThreadId(), getBossExpansion()
│   ├── state.js               State persistence (atomic writes via .tmp rename)
│   ├── board.js               buildExpansionPanels(), buildAllExpansionPanels()
│   ├── embeds.js              All Discord embed builders
│   ├── killops.js             postKillUpdate(), postOrUpdateExpansionBoard(), refresh*Card()
│   ├── roles.js               hasAllowedRole(), getAllowedRoles()
│   ├── timer.js               calcNextSpawn(), discordRelativeTime(), discordAbsoluteTime()
│   ├── timezone.js            getDefaultTz(), msUntilMidnightInTz(), parseUserTime(), localToUTC()
│   └── onboarding.js          Opt-out registry, SHA-256 hashing, welcome/organizer/attendee embeds
│
└── data/
    ├── bosses.json            109 bosses — hot-reloaded; never baked into Docker image
    └── state.json             Live state — gitignored; stored on persistent volume
```

---

## Required Bot Permissions

| Permission | Why |
|------------|-----|
| Send Messages | Kill cards, spawn alerts, boards, PVP alerts, onboarding messages |
| Embed Links | Rich embeds with PQDI links |
| Read Message History | Fetch messages to edit in place |
| Manage Messages | Delete kill cards on respawn; clean up at midnight |
| Manage Events | Create/delete Discord Scheduled Events for `/announce` and `/quake` |
| Manage Roles | Add/remove @PVP role via `/pvprole` |
| Create Public Threads | Create announce and raid-night threads |
