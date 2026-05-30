# Project Mimic — Electron desktop client (codename, major release, BETA)

> Status: vision / pre-build. Codename **mimic** (EQ flavor: the chest that's
> actually the monster — an overlay that looks like part of the game and augments
> it). New **4th component** alongside bot / agent / web. Ships as a **new major
> release** on a **beta channel**, riding on top of refactors the other components
> need anyway ("beta on top of things that need to change").

## One-liner
A native (Electron) desktop client that **consumes what we already build** — it does
not re-implement the engine. The `wolfpack-logsync` agent stays the brain (log tail,
encounter build, durable upload queue, triggers, fun events); Mimic is the **face +
overlays**, taking the goodness of [DnDOverlay](https://gitlab.com/zeraxx1/DnDOverlay)
and wiring it to our data.

## Why Electron earns its place (things `localhost:7777` HTML can't do)
- **Transparent always-on-top overlays** — spell/timers, DPS meter, raid-boss
  announcements, trigger pop-ups, anchored over the EQ window.
- **Real audio / TTS** for triggers (the "different sounds / viksar" requirement);
  per-user mute mode and sound packs.
- **Native local file read/write** — the enabler for the EQ UI/macro editor, the
  local full-log browser, and virtual tell windows (all currently queued).
- **Local-only frames** — panels/data that unlock only when the agent runs on this
  machine (or one on the LAN) and never leave the box. Privacy by construction.
- **Packaged installer + auto-update** instead of "run a .bat, open a browser tab."

## Consumes (reuse, do NOT rebuild)
- **The agent** — its local HTTP API (`/api/state`, encounter/chat/pvp/fun streams,
  trigger polling, backfill requests) becomes Mimic's contract. Stabilize that API
  surface first; Mimic is just a rich client of it.
- **wolfpack.quest data** — boards, `/me` stats, parses, attendance — via the same
  Supabase/anon + Discord-OAuth paths the web app uses.
- **`guild_triggers` library** — officer-tuned broadcast triggers + personal local
  triggers + GINA/EQLP imports (already started this session).
- **`encounter_combat_rollup` / `character_data_floor`** — the going-forward verb
  totals, self-attack counter, and member floor we just laid down.

## DnDOverlay parity targets (verify against the repo when egress allows)
- Trigger engine: regex match on log lines → audio / TTS / visual overlay / timer.
- Spell + ability **timer bars** (anchored overlay).
- **DPS meter** overlay (live, from the agent's encounter stream).
- **Raid-boss announcement** overlays — officer-tuned broadcast set + each player's
  own local additions; mute mode per user.
- Map / location helpers (stretch).
- Sound packs + import of the user's own sounds.

> Feature inventory above is from working context (we've been cloning DnDOverlay's
> trigger system already). Reconcile against the actual GitLab repo before scoping
> the milestone — egress to gitlab.com has been blocked from this sandbox.

## Queued features → Mimic panels
| Queued item | Becomes |
|---|---|
| Agent dashboard (localhost:7777) | Native Dashboard window |
| Trigger system (broadcast + personal + mute) | Overlay engine + Triggers panel |
| EQ UI / macro editor (resolution-fit, channel router, presets, bard melody) | UI Studio panel (native file R/W + backups + EQ-running guard) |
| Tell-bot / Inbound `/tell` | Virtual Tell Windows + DM relay toggle |
| Local full-log browser w/ highlights | Logs panel (auctions/spawns highlighting) |
| `/me` verb totals + self-attack + resubmit nudge | Me / Stats panel (PRIVATE scope) |
| Server-wide PvP leaderboard | Server panel (ANON/GUILD scope) |

## Boundaries (unchanged, enforced)
- **Byte-level privacy filter stays** — officer chat / tells / private channels never
  upload. Mimic showing your tells locally is fine; relaying is opt-in, default-off,
  own-tells-only, own-DM-only.
- **EQ config writes**: back up every file (`*.bak-<ts>`), refuse while EQ is
  running, validate before write.
- **Stat scopes**: PRIVATE (only in your own view) / ANON (no names) / GUILD (named)
  per the CLAUDE.md disclosure contract; tooltips explain what each panel exposes.

## Release / versioning
- New component dir (proposed `apps/mimic/` or `mimic/`) with its **own version**,
  shipped on a **beta channel**, **major** release. Bot / agent / web keep shipping
  independently — add a 4th row to the CLAUDE.md version table when the shell lands.
- Mimic depends on a **stable agent local API** — treat that contract as the v1
  deliverable before any overlay work.

## Phased path (proposed)
0. **Stabilize the agent local HTTP API** as the documented Mimic contract (no UI).
1. **Electron shell** embeds the existing dashboard; auto-update; tray; agent
   lifecycle management.
2. **Overlay engine** — transparent always-on-top windows; trigger audio/TTS/visual;
   timer bars; DPS meter.
3. **Native panels** — UI Studio, Logs browser, Tell windows, Me/Stats.
4. **Beta → GA** — sound packs, presets/clone "save multiple views", polish.
