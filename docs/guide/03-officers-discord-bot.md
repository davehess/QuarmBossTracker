# Stand up the Discord bot (for officers)

For an officer or host. At the end the bot is online in your Discord, running raid timers and accepting uploads from Mimic. You need Discord admin rights, a host (Railway or Docker), and a Supabase project (chapter 05). Without Supabase the bot still runs as a bare timer, but uploads (`/api/agent/*`), `/token`, the website and most analytics do not work.

## 1. Create the Discord application

1. At `discord.com/developers/applications`: **New Application**. **Bot → Reset Token**; this is `DISCORD_TOKEN`. **General Information → Application ID** is `DISCORD_CLIENT_ID`.
2. **Bot → Privileged Gateway Intents:** turn **Server Members Intent** on (member sync and the website's role gate need it). The code asks for Guilds, GuildMembers, GuildMessages and GuildVoiceStates, plus MessageContent only if `MESSAGE_CONTENT_INTENT=1`. Leave Presence off.
   ⚠ Set `MESSAGE_CONTENT_INTENT=1` only after ticking its portal toggle, or the gateway refuses the connection.
3. Invite it (scopes `bot` and `applications.commands`, permissions `2252135193504768`):
   `https://discord.com/oauth2/authorize?client_id=<your-application-id>&scope=bot+applications.commands&permissions=2252135193504768`
   That integer is 16 permissions: View Channels, Send Messages, Send Messages in Threads, Create Public Threads, Manage Threads, Embed Links, Attach Files, Read Message History, Manage Messages, Pin Messages, Manage Events (`/announce`, `/quake`), Manage Roles (`/pvprole`; the bot's role must sit above the PvP role), Connect, Speak, Use Voice Activity and Change Nickname (raid-voice bot only).
4. The raid-voice bot (`apps/bristlebane`) is a separate, optional app. Do not give it this token: both bulk-register slash commands and would delete each other's.
   > ⚠ The README says a new guild's two bots should be one application. The code today runs them as two, each with its own token.

**Check it worked:** the bot is in your member list, offline until deployed.

## 2. Channels and threads

Turn on Developer Mode, then right-click → **Copy ID**. Create:

- `#raid-mobs` (`TIMER_CHANNEL_ID`). The bot keeps four fixed messages there (Active Cooldowns, Spawning in 24h, Daily Summary, thread links), always edited, never re-posted.
- Inside it, one thread per expansion (Classic, Kunark, Velious, Luclin, PoP) and a Historic Kills thread.
- Threads for Parse Logs (the source of truth for parses), Onboarding (Quick Start plus an opt-out list of salted hashes), Feedback, Audit, active and inactive Roster.
- Roles named exactly (case-sensitive) as in `ALLOWED_ROLE_NAMES` and `OFFICER_ROLE_NAMES`.

## 3. Environment variables

`.env.example` documents about 120 variables by feature; the README groups them into the tiers below. ⚠ `.env.example` ships Wolf Pack's own ids and Supabase URL as sample values: replace every line you keep and delete the rest. Several unset optional channels fall back to Wolf Pack's ids in code (`FORUM_CHANNEL_ID`, `LOOT_CHANNEL_ID`, `MIMIC_RELEASE_CHANNEL_ID`, `QUARM_PATCH_NOTES_CHANNEL_ID`, `HATE_THREAD_ID`, the raid-chat and event-chat parents): set your own.

| Tier | Variables | Meaning |
|---|---|---|
| Required | `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `TIMER_CHANNEL_ID`, `ALLOWED_ROLE_NAMES` | bot token, application id, server id, `#raid-mobs`, roles for everyday commands |
| Required | `CLASSIC_THREAD_ID`, `KUNARK_…`, `VELIOUS_…`, `LUCLIN_…`, `POP_THREAD_ID`, `HISTORIC_KILLS_THREAD_ID`, `PARSES_LOG_THREAD_ID`, `ONBOARDING_THREAD_ID` | expansion threads, archive, parse record, quick start |
| Platform | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | database; the service key bypasses RLS, keep it server-side |
| Platform | `SUPABASE_GUILD_ID` | guild tag on every row (default `wolfpack`) |
| Platform | `OFFICER_ROLE_NAMES` | officer commands (set the same on the website) |
| Platform | `PORT` | HTTP port (Railway sets it; code default 3000) |
| Platform | `OPENDKP_*`, `WISHLIST_BID_KEY` | OpenDKP sync; AES-256 key for sealed bids |
| Platform | `WEB_BASE_URL`, `MIMIC_LINK_VERIFICATION_URL` | your site, and the sign-in page Mimic opens (`https://<your-site>/auth/mimic-link`); not in `.env.example`, both default to Wolf Pack's |
| Anchors | `SUMMARY_MESSAGE_ID`, `SPAWNING_TOMORROW_MESSAGE_ID`, `DAILY_SUMMARY_MESSAGE_ID`, `THREAD_LINKS_MESSAGE_ID` | the four fixed messages |
| Anchors | `<EXPANSION>_BOARD_IDS`, `<EXPANSION>_COOLDOWN_ID` | board panels and cooldown card per thread |
| Optional | `DEFAULT_TIMEZONE`, `PVP_*`, `ARCHIVE_CHANNEL_ID`, `BOSS_OUTPUT_CHANNEL_ID`, `AUDIT_TRAIL_THREAD_ID`, `FEEDBACK_THREAD_ID`, `ROSTER_*_THREAD_ID`, `RAID_CHAT_CHANNEL_ID`, `EVENT_CHAT_CHANNEL_ID` | timezone (default `America/New_York`), PvP, archive and boss-output channels, audit, feedback, roster, raid-night and event threads |

Anchor ids may instead go in `guild/discord.json` (copy `guild/discord.example.json`); a variable already set in the environment wins, and secret-shaped keys there are refused.

> ⚠ `.env.example`, CLAUDE.md and `docs/SELFHOSTING.md` call `WOLFPACK_AGENT_TOKEN` the agents' shared bearer. The code (`utils/mimicLink.js`) accepts only per-user `wpms_…` tokens from `/token` or a Mimic sign-in; `/preraiddrill` still reads the old variable.

> ⚠ `.env.example` lists `/board`, `/cleanup`, `/restore`, `/addboss`, `/removeboss` and `/tick` as officer commands. The code gates them on `ALLOWED_ROLE_NAMES`. The website's `OFFICER_ROLE_NAMES` default differs from the bot's, so set it on both.

## 4. Deploy

**Railway.** New Project → Deploy from GitHub repo → paste the variables. `railway.toml` selects the `Dockerfile`, runs `node index.js`, restarts on failure (10 tries), health-checks `/health` (503 until Discord is connected and state is loaded) and ignores pushes that touch only folders the bot does not use (`web/`, `apps/`, `packages/`, `docs/`, `supabase/`, `test/` and so on). Generate a public domain: Mimic (Settings → Bot URL) and the standalone agent (`--bot-url`) upload to `https://<your-bot-host>/api/agent/encounter`.

⚠ **No Railway volume is mounted, so `data/state.json` does not survive a deploy.** Durability comes from Discord (parse, roster and board messages), the anchor variables, and Supabase `bot_kv`. Anything kept only in `state.json` is gone next deploy.

**Docker.** Node 20 Alpine with ffmpeg, running as a non-root user:

```
cp .env.example .env   # fill in
docker compose up -d
docker compose logs -f
git pull && docker compose up -d --build   # update
```

The compose file mounts `./data` at `/app/data` and publishes no port. Add `ports: ["3000:3000"]` and a TLS proxy so Mimic can reach the API (⚠ unverified: not tested here).

**Local:** Node 20, `npm install`, `npm start`; `npm test` and `npm run lint` before changing code. Use a test server and a second Discord application.

## 5. First-time order

1. Create the channels and threads; copy ids; fill `.env`.
2. Deploy. Logs should show `Registered <n> commands`: the bot bulk-registers its slash commands to your guild on every boot (instant). `npm run deploy-commands` does the same by hand, or globally if `DISCORD_GUILD_ID` is unset (up to an hour).
3. Run `/board` (the bot also runs it about a minute after boot). It posts the four slots and each thread's boards.
4. Copy the message ids of the four slots, each thread's board panels and its cooldown card into the anchor variables. Redeploy.
5. Run `/board` again. Nothing new should be posted.

**Check it worked:** step 5 edits messages in place. After about 30 seconds the bot syncs members and roles to Supabase (then every 6 hours; `/syncmembers` forces it).

**Recovery.** `/restore <links…>` rebuilds kill state from Active Cooldowns or Daily Summary messages; boot also restores from the last seven daily summaries and reloads parses and roster from their threads. `/recoverkills` (officers) rebuilds timers from Supabase encounters. `/cleanup` removes duplicates and re-anchors boards.

⚠ The bot fetches the agent-update manifest from `raw.githubusercontent.com/<owner>/<repo>/<AGENT_RELEASE_REF>`; the owner and repo are hard-coded in `index.js` (`_AGENT_RAW_BASE`). A fork changes them.

## 6. Raid-night deploy freeze

Never push to `main` Sun/Wed/Thu 19:30 → 00:30 ET: a restart mid-raid backs up every agent queue. `.github/workflows/raid-freeze.yml` turns such a push red but cannot stop Railway deploying. A genuine mid-raid fix goes through with `[hotfix]` in the commit message. Edit the window in that file for your raid nights.

## 7. Commands

`commands/` holds 88 files, one slash command each (⚠ the README's "83" is stale). `/raidbosshelp` prints the live reference. By area:

- **Timers:** `/kill`, `/unkill`, `/updatetimer`, `/timers`, `/board`, `/addboss`, `/removeboss`, `/sll`.
- **Parses:** `/parse`, `/parseboss`, `/parseaoe`, `/parsenight`, `/parsestats`, `/mystats`, `/raidnight`, `/raidreview`.
- **Raid planning:** `/announce` (thread plus Discord event), `/addtarget`, `/adjusttime`, `/preraid`, `/lockoutcheck`, `/suggest`.
- **PvP:** `/pvpkill`, `/pvpspawn`, `/quake`, `/pvprole`, `/pvpalert`, `/pvphate`.
- **DKP and loot:** `/dkp`, `/loot`, `/wishlist`, `/tick`, `/register`.
- **People:** `/who`, `/whois`, `/rosterimport`, `/syncmembers`, `/token` (mint an upload key; officers use `for:@member`).
- **Officer backfill and recovery:** `/backfillparses`, `/recoverkills`, `/syncopendkp`, `/ingestrules`.

## If it goes wrong

- **No slash commands:** `DISCORD_CLIENT_ID` or `DISCORD_GUILD_ID` is missing, or the invite lacked `applications.commands`.
- **Bot will not connect:** `MESSAGE_CONTENT_INTENT=1` without the portal toggle.
- **Boards re-post after each deploy:** the anchor variables are unset.
- **Uploads get 401:** the agent needs a `wpms_…` token. **503:** Supabase variables unset.
- **Railway health check fails:** `/health` stays 503 until Discord is ready; check `DISCORD_TOKEN`.
- **Docker logs show permission errors writing `data/`:** make the host `data` folder writable by the container's non-root user (⚠ unverified: not tested here).
- **Website says "You have: (none)":** roles have not synced; wait for the 30-second sync or run `/syncmembers`, and check the Server Members intent.
