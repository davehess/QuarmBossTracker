# Continuation Queue — Wolf Pack platform work

> Living handoff so work resumes instantly after a usage-limit reset or a fresh
> session. When you come back, point me at this file: **"pick up the continuation
> queue."** Branch in flight: `claude/sharp-lamport-dC0TW`.
>
> Last updated: 2026-05-30.

## How to resume
- This container is ephemeral — everything below is already committed + pushed.
- An agent can't reserve compute or auto-wake when your 5-hour window resets; this
  doc is the substitute. Claude Code on the web *does* support scheduled/triggered
  sessions (cron-style) — see https://code.claude.com/docs/en/claude-code-on-the-web —
  but those start fresh, so this queue is what makes a fresh start productive.
- Resume command: **"pick up the continuation queue, start at #1."**

## ✅ Shipped this session (recent)
- `character_data_floor` view + `characters.exclude_from_stats` / `exclude_inventory`
  opt-out flags — `supabase/migrations/20260530120000_character_data_floor.sql`.
  `member_since = LEAST(first /gu, first /rs, first OpenDKP tick)` across the family.
  Validated: pre-floor combat 1258→27 of 15,609 rows; 145/147 families resolve.
- `encounter_combat_rollup` + `contributions.agent_version` / `has_ability_detail`
  watermark + `character_rollup_coverage` view —
  `supabase/migrations/20260530130000_combat_rollup_watermark.sql`.
- CLAUDE.md: "Per-Character Data Floor", "Combat Rollups — Going-Forward
  Collection + Version Watermark", "Stat Visibility & Disclosure" (PRIVATE/ANON/GUILD).
- Migrations are file-only; they apply to Supabase on **merge to `main`**.

## 🔜 Priority queue (next concrete steps)

### 1. Agent + bot: per-ability rollup emission  ← starts the clock, do first
Every raid not collected is data we can never recover.
- **Cutover version:** bump agent to next version (currently 2.4.29 → **2.4.30**) and
  set a `ROLLUP_MIN_AGENT_VERSION = "2.4.30"` constant in the bot.
- **Agent** (`packages/wolfpack-logsync/index.js`, encounter builder): from the
  per-encounter `events[]`, compute per character:
  `{ by_skill: {<skill|"Spell: X"|"Song: Y">: {hits, dmg}}, total_hits, total_damage,
  self_attack_count }` (self = attacker == defender). Send under `encounter.rollup`.
  Note: bystander spell names are "(unknown)" in EQ logs — reliable only for the
  uploader; melee/skill verbs are reliable for everyone.
- **Bot** (`index.js` `/api/agent/encounter`, ~line 4009 area): upsert rollup into
  `encounter_combat_rollup` (unique encounter_id+character), stamp
  `contributions.agent_version` + `has_ability_detail=true`.
- Bump `packages/wolfpack-logsync/package.json` + bot `package.json` + README + this
  file's version table. **Batch into ONE agent release** — restarts have been painful.
- Run `npm run check:dashboard` before release (escape-bug guard).

### 2. `/me` page: verb totals + self-attack + resubmit nudge
- Grand total by verb: sum `by_skill` across the character's `encounter_combat_rollup`.
- "Attacked yourself X times": sum `self_attack_count`.
- Apply `character_data_floor.member_since` as lower bound; skip `exclude_from_stats`.
- Resubmit nudge from `character_rollup_coverage.encounters_resubmittable > 0`.
- Tooltips per the PRIVATE/ANON/GUILD contract (CLAUDE.md "Stat Visibility").

### 3. Opt-out wiring
- Agent honors `exclude_from_stats` (don't upload for those chars) + `exclude_inventory`.
- `/me` UI toggle to set the flags (officer or self-serve for own chars).

### 4. EQ UI / macro editor (files in hand)
Hitya + Melting full sets received, incl. per-server variants (`144.217`/`192.99`),
`Default`/`duxaUI`/`NillipussUI` skins, bandolier + spellsets + socials.
- (A) **Resolution-fit sync** — EQ stores per-resolution `XPos/YPos`; compute a
  missing resolution from a tuned one with edge anchoring.
- (B) **Channel/spam-window router** — from `[ChatManager]` ChannelMap0-55 + named
  windows (Hitya has 14, incl. Auction/Tells); "verify what's filtered/missed".
- (C) **Presets + clone "save multiple views"** + **bard melody macro** (Melting:
  `/stopsongs` before items, `/melody resume` after) as a social-macro preset target.
- Needs agent UI-file read/write API: **back up every file** (`*.bak-<ts>`),
  **refuse to write while EQ is running**, validate before write, never touch a
  resolution block we didn't generate unless asked.

### 5. Tell-bot / Inbound `/tell`
tells table + bot endpoint + agent toggle (opt-in, default-off, own-tells-only,
own-DM-only) + detector + `/me/tells` page (conversation grid + stream) + local log
browser tab with highlights (auctions, spawns). No leaderboard of who talks to whom.

### 6. Server-wide PvP top-killers leaderboard (designed)
Top 10 killers + Wolf Pack kills for/against, pulled from the PvP channel. PvP is
exempt from the data floor (counts from the beginning).

### 7. `/recoverkills` officer command (real bug, user deferred)
Boards didn't update from the last 2 raids — `state.json` empty, auto-`recordKill`
gated by `!isBackfill` (recent uploads were re-runs). Rebuild kill state from
Supabase encounters → `mirrorBoardsToSupabase`.

### 8. Misc queued
- Recipient-side Malthur detectors + `provisions_cursor_full` event (cursor caps ~10).
- Backfill queue backpressure (pause feeding near the 5000 cap).
- Architecture pivot decision (extract agent UI to wolfpack.quest) — recommended.

## Standing constraints (carry forward)
- Byte-level privacy filter strips officer chat/tells/private channels before upload.
- Agent dashboard `WEB_HTML` is one backtick template literal — bare `\n`/`\'`
  render literally and blank the page. Always run `scripts/check-agent-dashboard.js`.
- EQ config writes: backup + EQ-running guard + validate.
- Commit only when asked; merge with descriptive `-m`, never `--no-edit`.
- Never put the model identifier in commits/PRs/code.

## Validated data facts (so we don't re-derive)
- `combat_events` is empty; `contributions.raw_parse` keeps only per-player
  aggregates + bare `eventCount` → verb/self-attack stats are **not** backfillable,
  only collectable going forward.
- `chat_messages` channels: `guild` (30,402 rows, back to 2024-05-06), `raid`
  (22,418, back to 2025-01-02). `speaker` = character name.
- `opendkp_ticks.attendees` is a text[] of names; join `raid_id` → `opendkp_raids.ts`.
