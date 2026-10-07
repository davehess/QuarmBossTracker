# How it fits together (for everyone)

For anyone who wants the shape of the platform before touching a part of it. At the end you know the four parts, where each one runs, how one line of an EverQuest log becomes a parse card, an overlay and a web page, and the handful of rules the design keeps.

## The four parts

<img src="../media/readme/architecture.png" width="900" alt="EverQuest + Zeal feed the Agent on the raider's PC; the Agent feeds Mimic's overlays and uploads to the bot; the bot posts to Discord, stores in Supabase and polls OpenDKP; wolfpack.quest reads Supabase.">

| Part | Code | Runs on | What it owns |
|---|---|---|---|
| **Agent** | `packages/wolfpack-logsync/index.js`, one file, no dependencies; its dashboard is authored in `dashboard.html` | The raider's PC: inside Mimic, or standalone as `Parser.bat` | Reads the log, filters it, parses fights, serves the local dashboard and the overlays' data, uploads |
| **Mimic** | `apps/mimic/` (Electron) | The raider's PC, Windows, auto-updating | The window, the tray, the overlays, the Zeal pipe bridge, sign-in, updates; bundles Node and the agent |
| **Bot** | `index.js`, `commands/`, `utils/` | Railway, from `main` | Discord slash commands and boards, the `/api/agent/*` ingest API, merging parses, DKP and loot, member sync, nightly jobs |
| **Website** | `web/` (Next.js 14) | Vercel, from `main`; `beta` builds the `b.` mirror | Member and officer pages, Discord sign-in, the public story |

Underneath: **Supabase** (Postgres, auth, storage) holds the EverQuest reference catalog, the guild's data and the bot's durable state. **OpenDKP** is the DKP system of record the bot reads and writes. **Zeal** is the client add-on that streams live game state (HP, mana, buffs, target, raid roster, positions) into a named pipe Mimic reads.

Source: `CLAUDE.md` (the component table); `docs/diagrams/platform.architecture.json`.

## One log line, end to end

1. EverQuest appends ``[Wed Oct 07 21:05:01 2026] Vyzh`dra the Cursed hits Dorbane for 412 points of damage.`` to `eqlog_<Name>_pq.proj.txt`.
2. The agent tails the file. A byte-level filter drops the lines that must never leave the PC (officer chat, tells, group, custom channels) before anything is parsed.
3. The parser turns the line into an event: who, whom, how much, what kind. Events accumulate into a fight keyed by the mob.
4. Triggers run against the raw line: a personal trigger from `personal_triggers.json`, or a guild trigger fetched from the bot. A match fires a callout, speech and a timer through the trigger overlay.
5. The overlays poll the agent on `127.0.0.1` (Mimic's default port 7779) every half-second to a second: the DPS/Tank Meter, threat meter, `/who`, Command Center and the rest draw from `/api/state` and its siblings. Zeal's pipe adds what the log never says: your HP, the raid roster, charm breaks.
6. When the fight ends, the agent queues an encounter upload (`logsync.queue.json`, durable across restarts) and POSTs it to the bot with the raider's own `wpms_…` token.
7. The bot calls `find_or_create_encounter`, which dedups the same kill across every uploader within a time window, then `merge_encounter_players`, which merges each raider's numbers across the uploads that saw them. It posts the parse card to Discord after acknowledging the upload, so agents never wait on Discord.
8. The website reads the encounter under the member's own session: `/parses`, the raid review, `/me`, leaderboards. Mimic's My parses tab reads the same numbers through the bot.

Source: `packages/wolfpack-logsync/index.js` (`DEFAULT_DROP_PATTERNS`, the fight tracker, the queue); `index.js` (`/api/agent/encounter`); `supabase/migrations/` (the two RPCs); `docs/diagrams/logline.dataflow.json`.

## What else flows

| Stream | From | To | Notes |
|---|---|---|---|
| Boss kills, lockouts, quakes | the agent, from log lines | the bot | start timers on the Discord boards without a command |
| Guild and raid chat | the agent | the bot → read-only Discord channels, chat history | the only chat that leaves the PC |
| `/who` results | the agent | the bot | feed the `/who` pages and PvP tracking, any guild |
| Live state, raid roster, casts, threat snapshots | the agent, with Zeal | the bot | ephemeral streams the bot can shed mid-raid with a tuning flag |
| Triggers, tuning, kill switch, version floor | the bot | every agent | polled; nothing is shipped |
| Agent updates | `main` (stable) or `beta` | every Mimic | the bot serves a manifest; Mimic hot-swaps a newer agent, never mid-fight |
| DKP, attendance ticks, sealed bids | OpenDKP ↔ the bot | Discord, the site, Mimic's loot bidding | bids are encrypted with a key only the bot holds |
| Feedback | Mimic, the site, Discord | one table, one Discord thread | every report gets an `FB-n` |

## The rules the design keeps

- **Privacy is a filter, not a promise.** The drop happens in the agent before parsing. Nothing is uploaded until the raider signs in. Per-character switches and local mode are honoured by the raider's own agent; other raiders' agents still record the fights they were in, and the privacy page says so.
- **Every raider is a viewpoint.** Per-observer streams (live state, threat, casting, encounters) are never deduplicated at ingest; the merge happens once, in the database (`merge_encounter_players`), and the rule it applies is checked there, not in the bot.
- **Discord is a projection.** Boards, cards and threads render state; Postgres is where state lives. `data/state.json` on the bot is a cache that does not survive a deploy, so anything per-night or per-fight goes in `bot_kv`, and the ids of the messages the bot edits in place go in environment variables.
- **The fleet moves without a deploy.** Triggers, tuning and the kill switch are polled by every agent within minutes. A scoped agent fix reaches the stable fleet by hot-swap; a Mimic installer release is for the shell.
- **Fail open.** A missing table, a downed service or an older bot degrades to a safe default; overlays keep working on local data.
- **Public repository.** No member or character names in prose, no addresses of anyone's machine, no secrets. Fixtures carry real log lines as data and are not renamed.

Source: `CLAUDE.md` (scope boundaries, domain policies, the Discord layout note); `docs/PRIVACY.md`; `docs/ARCHITECT-REBUILD-2026-08-16.md`.

## Where things run, and what that costs

| Layer | Service | Why it matters |
|---|---|---|
| Bot | Railway, one environment pinned to `main`; no volume | A push to `main` restarts it, hence the raid-night freeze (chapter 07) |
| Website | Vercel Hobby; only `main` and `beta` build | 100 deployments a day and 10 GB of build storage are the ceilings |
| Database | Supabase Pro | Writes are nearly free; reads and database size are the bill (chapter 05) |
| Raider PCs | Mimic | The agent is one file and makes zero server calls when signed out |

Wolf Pack also keeps an on-site archive and nightly backups on hardware the guild lead runs; that layout is not part of the platform and is not documented here.

Source: `CLAUDE.md` (Release playbook, Supabase); `docs/DESIGN-selfhost-wizard.md` §2a.

## The repository

```
index.js  commands/  utils/      the bot and its API
web/                             the website (Next.js 14)
packages/wolfpack-logsync/       the agent (index.js) and its dashboard source (dashboard.html)
apps/mimic/                      Mimic: main.js, preload.js, one .html per overlay
apps/bristlebane/                the raid-voice bot (optional, separate app)
supabase/migrations/             timestamped, idempotent SQL; applied on merge to main
data/bosses.json                 the curated boss list the timers use
test/                            vitest; a golden EQ log pins the parser
scripts/                         sync, bootstrap and check tooling
docs/                            this handbook under docs/guide/, plus the ledgers and designs
.github/workflows/               tests, golden log, Mimic releases, branch syncs, catalog sync, raid freeze
```

Versions live in each `package.json` and nowhere else.
