# Other games

World of Warcraft and anything outside EverQuest. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## §445 — WoW parses: parses.gg exists and does the uploader half (open, the guild lead's pick, 2026-10-26)
*2026-09-21 · DECISIONS-2026-09-21.md · WoW parses.gg already does uploader half*

The guild lead: *"on the wow front it looks like https://parses.gg/ exists and does a lot of what we're already doing,
discord bot, desktop client"*. Read 2026-10-26 (its site blocks cloud addresses; read through a public page reader):
- **What it is:** combat logs for every WoW version, Classic Era to Retail, with WoW Forever boards opening from the beta
  (launch Nov 4). A desktop client (Windows, Apple silicon) uploads each pull within a minute; a Discord bot posts each pull
  and answers /rank /guild /build; a 3D position replay; custom widget boards. Reading needs no account.
- **Open by design:** a no-auth JSON API (20 req/s per address), the whole public dataset as daily Parquet dumps
  (pseudonymised characters, real guild names, no wipes, no raw logs), and signed per-owner webhooks (`fight.indexed`,
  HMAC sha256, retried, `X-Parses-Delivery` idempotency key). Small so far: 15,487 fights, a 4.5 MB dump.
- **Ours:** a Classic WoW reader built on `wow-land` / `claude/wow-classic-reader`, never landed (its `encounters`
  migration unapplied).
- **The pick:** A, use parses.gg for WoW parses and keep our guild layer (sign-ups, DKP, loot, attendance, Discord cards
  from its webhook / API) — recommended; B, ship our own reader. A webhook carries only its owner's fights, so a
  guild-wide card needs the guild endpoint polled or each raider's webhook registered: verify before building.

## §377 — Other games: a thin reader per game; the EQ family and Classic WoW first; Monsters & Memories on hold (2026-10-19)
*2026-10-19 · DECISIONS-2026-09-21.md · Thin reader per game, EQ family and WoW first*

The guild lead: *"start consuming other games"*, then *"find a list of other solved games we could pull in and implement
similar systems"*.
- **Research (two agents, sources cited in their reports):**
  - **Monsters & Memories' Play Nice Policy (2026-10-09) lists "screen readers/parsers" as cheating.** No combat or chat
    log on disk is confirmed, and the only existing DPS parser reads network packets with keys from game memory. On hold
    until the developers allow a parser or write a combat log.
  - **Classic-era WoW writes `Logs\WoWCombatLog.txt` after `/combatlog`.** Blizzard's 2025 policy targets software that
    modifies the client; reading the log is how Warcraft Logs works. Retail is out: Midnight limits addons in encounters.
  - **The EverQuest family** (Project 1999, live, other emulators) writes the same `eqlog` text we already tail.
  - The ranked list: EQ family, Classic WoW, Turtle WoW, then EQ2, SWTOR, GW2 (arcdps), retail WoW. FFXIV, Pantheon and
    ESO are avoided (ToS risk or no log on disk).
- **Shape (recommended by the coupling map, taken):** a thin, zero-dependency reader per game posting the same normalized
  upload to `/api/agent/encounter`. Each reader owns its own privacy allow-list, and a WoW fix never rides the EverQuest
  fleet's update chain.
  - The one schema wall: `encounters` names its boss only by an EverQuest `npc_id` (an FK to `eqemu_npc_types`). Add
    `game`, `boss_name` and `boss_key`, plus a key-based find-or-create. Additive; EQ unchanged.
  - `game` starts as deployment config (`guild/config.json`), not a column on every table.
- **First slices (drafting):**
  - the EQ family in the local edition: any `eqlog_<Name>_<server>.txt`, a per-server capability table, and no guild
    upload off Quarm;
  - `packages/wowlogsync/` with the `encounters` seam, proven by a Classic combat-log line becoming a fight on `/parses`.
- **Landing page (web 1.9.8):** raidmimic's "Any solved world" no longer calls Monsters & Memories next. It lists other
  EverQuest servers and classic-era Warcraft as next, and says Monsters & Memories waits on its rules.
- **Shipped 2026-10-19:** the EQ family on beta (agent 3.8.7, `ad1169de`). Mimic reads any `eqlog_<Name>_<server>.txt`;
  a per-server table allows only Quarm to feed the guild bot or use the Quarm catalog. A suffix starting with `pq.proj` is
  always Quarm, so a renamed copy never stops uploads. The P1999 and live suffixes are from memory and unverified.
  The Classic WoW reader is ready on `claude/wow-classic-reader` (bot 3.2.8 / web 1.9.9). Its migration is renumbered
  `20261019130000` so it does not collide with the gallery's `20261019120000`. Nothing applied.

## §435 — WoW Forever: the research for a faction and ruleset pick (2026-10-25)
*2026-10-25 · DECISIONS-2026-09-21.md · WoW Forever faction and ruleset research*

The guild lead: *"put research for WoW forever on another tab for decision desk. the guild leadership started talking about
playing together, likely on a pvp server. go through the differences for alliance and horde for a group that will still be
called Wolf Pack"*.
- A new **WoW Forever** tab on the Decision Desk holds the research (each point marked Blizzard-sourced or "reported" from
  guide sites) and two picks: the faction (Horde recommended: the wolf-clan identity, the stronger PvP racials, and Forever
  gives both sides Paladins and Shamans, which removes the old raid reason for Alliance) and the ruleset (PvP recommended).
- The load-bearing fact, verified on Blizzard's ruleset post: on the PvP ruleset a player can only make characters for one
  faction, set by the first character; early name reservation opens Oct 27, and balance systems may pause the bigger faction.
- Not platform work (no code, no repo change beyond this entry); kept here so the next session knows the picks are open.
