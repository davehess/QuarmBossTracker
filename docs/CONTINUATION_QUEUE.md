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
- **Mimic agent scoping + sample** — `docs/MIMIC_AGENT.md` (effort assessment:
  Path B self-updating Node agent ~2-4 days, Path A Electron MVP ~2-3 weeks /
  full ~6-10 weeks; coexistence design) + `experiments/mimic-agent/` runnable
  prototype (version check, hash-verified atomic download/swap, child restart
  backoff, free-port probe). Verified: semver compare + port probe (7777→7778).
- **bot v2.5.47** — agent update manifest. `/api/agent/latest-version` now returns
  `{ latest_agent_version, url, sha256 }` (raw single-file URL + SHA-256 of what
  `main` holds, from the bot's own image). Closes the supervisor's download stub —
  auto-update is now real + hash-verified. Remaining for rollout: make the
  supervisor the launched process (`Parser.bat` → `supervisor.js`) + sign it.
- **bot v2.5.46 / web v0.4.32** — tell notifications: per-character `tell_dm`
  Discord toggle + device-local browser notifications (Supabase Realtime on
  `tells`, visibility-gated, optional WebAudio ping). Migration 20260530170000.
- **bot v2.5.45 / agent v2.4.29 / web v0.4.31** — tell-bot / Inbound `/tell`.
  Opt-in per character via `characters.tell_relay` (default off). Agent parses
  incoming/outgoing tell lines BEFORE the byte-level filter drops them, batches
  to a 5s relay, uploads to new `POST /api/agent/tells`. Bot defense-in-depth
  re-checks `tell_relay` then DMs the owner with batched tells (header + up to
  10 lines, link to /me/tells). `/me/tells` page shows conversation grid + recent
  stream (PRIVATE scope, RLS-gated). Migration `20260530160000_tells.sql`.
  **Out of scope:** local log browser tab with auction/spawn highlights —
  deferred as separate work (significant agent dashboard HTML).
- **web v0.4.30** — `/pvp/server` server-wide PvP top-10 with the Wolf Pack
  mini-rivalry per row (their kills vs WP, our kills vs them). Linked from
  the existing `/pvp` page. Reads from `pvp_kills` (PvP-channel relay), uses
  newest-row guild affiliation per killer. PvP is exempt from the data floor,
  so kills count from the first observation.
- **bot v2.5.44 / web v0.4.29** — privacy statement live. `/privacy` page mirrors
  `docs/PRIVACY.md` (the canonical source of truth), linked from the global
  footer + the welcome onboarding embed. Plain-words: what we keep, what stays
  local, the PRIVATE/ANON/GUILD scope contract, and how to opt out per-character.
- **bot v2.5.43** — `/recoverkills [since] [dry_run]` officer command. Rebuilds
  `state.bosses` + `bot_boards` from Supabase `encounters` when the live state
  is empty/drifted. Maps `encounter.npc_id → bosses_local.internal_id → bosses.json
  timerHours`, takes latest `started_at` per boss, skips already-respawned and
  already-current rows. Refreshes every expansion board, cooldown card, and the
  main summary slot when committing. Validated against prod: last 72h has 17
  encounters all mapping to tracked bosses.
- **agent v2.4.28** — close the live opt-out gap. Live tail now gates lockout
  / druzzil-kill / pvp-broadcast / fun-event / chat pushes at the per-line
  callback site (where `b.character` is known). An excluded source character
  generates zero outbound traffic from the live tail — matching the encounter
  + historical-chat gates from v2.4.27.
- **bot v2.5.42 / agent v2.4.27 / web v0.4.28** — self-serve opt-out wiring.
  New `GET /api/agent/character-prefs` returns each character's
  `exclude_from_stats` / `exclude_inventory` flags; agent polls every 10 min
  and gates the encounter upload + historical-chat backfill on the parser
  character's flag. `/me` ships per-character Stats/Inventory toggles (server
  action verifies the owner via `wolfpack_members.user_id → discord_id →
  characters.discord_id`). Excluded chars surface in an interactive footer so
  they can be brought back in one click. **Known limitation:** live
  chat/PvP/fun_event upload sites still aggregate across multiple watched
  logs — gating those by per-message uploader is a follow-up since the buffer
  doesn't carry that context today.
- **web v0.4.27** — `/me` Verb Totals panel: aggregates `encounter_combat_rollup`
  per character (PRIVATE-scoped tooltip), shows top 5 skills by damage, the
  "times you attacked yourself" counter, the `encounters_resubmittable` resubmit
  nudge from `character_rollup_coverage`, and `member_since` floor line.
  Respects `characters.exclude_from_stats` (filtered out of grid + surfaced in a
  small footer). Updated stale "agent version not stored yet" — now shows
  `latestAgentVersion` from `contributions.agent_version` (post-v2.5.39).
- **bot v2.5.41** — agent-release channel post → opt-in DMs. Only members with a
  `member_onboarding_state` row (interacted with `/onboarding`) get pinged, and
  only with the diff slice since their `last_seen_agent_version`. Includes the
  `20260530150000_onboarding_agent_watermark.sql` migration adding that column.
  Two-layer dedup: `bot_announcements` claims the version once + per-member
  watermark guards against partial fanouts on restart.
- **bot v2.5.40** — onboarding state to DB; `/onboarding` is diff-first with
  `[Show full welcome]`; parser link fix (GitHub release direct).
- **agent v2.4.26 / bot v2.5.39** — per-ability rollup emission + watermark cutover.
  Agent computes `{ by_skill, total_hits, total_damage, self_attack_count }` per
  character at encounter flush (pets→owners, null attacker→uploader); bot upserts
  into `encounter_combat_rollup` and stamps `contributions.agent_version` +
  `has_ability_detail=true`. Rollup verified against synthetic events (pets attribute
  correctly, self-attack counted, avoid events skipped).
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

### Class signature counters (agent v2.4.31) — collecting; display TODO
- SK **Harm Touch** damage total (`harm_touch`, reagent_qty=damage) and Paladin
  **Lay on Hands** (`lay_on_hands`, reagent_qty=heal-or-0-for-count) +
  caster-side detectors, wired into live tail + backfill, gated by
  `exclude_from_stats`. ⚠️ Regex wording is best-effort — confirm against real
  Quarm logs. ⚠️ LoH "heal total based on max": when the line carries no number
  we store count (qty=0); the **/fun or /me display must multiply count × that
  paladin's max HP** (from /who or char data) to show the heal total. HT damage
  also lands in `encounter_combat_rollup.by_skill` as a cross-check.
  **Display for these event types is not built yet** — they're collecting now.

### 1. ✅ DONE — Agent + bot per-ability rollup emission (cutover v2.4.26 / v2.5.39)
See "Shipped this session". The rollup table starts populating on the next agent
upload at/after 2.4.26. **Note:** `npm run check:dashboard` referenced in the
previous queue revision **does not exist in the repo** — the script + npm wiring
the earlier summary described was never actually shipped. Rebuilding it is its own
small task; for now, manual diff inspection of `WEB_HTML` changes is the only guard.

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

### 5. ✅ DONE (mostly) — Tell-bot / Inbound `/tell` (v2.5.45 / v2.4.29 / v0.4.31)
Shipped: `characters.tell_relay` opt-in (default off) → agent forwards tells to
`/me/tells` and Discord DMs the owner. Conversation grid + recent stream are live.
**Follow-up:** local log browser tab (full per-character log view with highlights
for auctions / spawn callouts). Holds the same dashboard scope as #4's UI editor —
significant `WEB_HTML` work, queued for a Mimic panel rather than the current
served-HTML dashboard.

### 6. ✅ DONE — Server-wide PvP top-10 (web v0.4.30)
`/pvp/server` lists everyone seen on the PvP-channel relay with the Wolf Pack
mini-rivalry (`vs WP` and `WP vs them`) on each row. Wolf Pack-only board still
lives at `/pvp`. PvP remains exempt from the data floor.

### 7. ✅ DONE — `/recoverkills` officer command (bot v2.5.43)
See "Shipped this session". Rebuilds from Supabase encounters with a `since`
window + `dry_run` preview. The original re-run-as-backfill upstream bug (where
recent uploads were tagged backfill=true so the auto-`recordKill` path was
skipped) hasn't been root-fixed in `/api/agent/encounter` itself yet — that
remains a follow-up. `/recoverkills` is the fast-path remediation when it
drifts again.

### 8. ✅ DONE — Misc (agent v2.4.30)
- **Backfill queue backpressure** — `readFromBytePos` now takes a `backpressure`
  arg; the backfill pauses the file read at 90% of the 5000 cap (HIGH=4500) and
  resumes below 60% (LOW=3000), so a big `--since` replay no longer FIFO-evicts
  good data. Verified pause/resume hysteresis. Live tail unaffected.
- **Malthur recipient detectors** — `parseMalthurProvision` (`malthur_food_received`
  / `malthur_water_received`) + `parseCursorFull` (`provisions_cursor_full`). Wired
  into live tail + backfill, gated by `exclude_from_stats`. Detectors verified
  against sample lines. **⚠️ NEEDS REVIEW:** caster is attributed to the RECIPIENT
  (the only name the recipient line carries), not "Malthur". If the intended fun
  stat is "stacks Malthur summoned" attributed to Malthur, switch to caster-side
  `You begin casting Blessing of the Harvest/Storm` detection (only Malthur's own
  agent logs that). Recipient-side chosen because it works from every member's
  logs. The web `/fun` aggregation/display for these event types is not built yet.

### 9. Quality-of-life / officer-prep tooling (the actual product north star)
> **Positioning (user, 2026-05-30):** "Parsing as a whole is table stakes. We're in
> the quality-of-life business." The real value is carrying the SUBSTANTIAL prep load
> the organizing officers do day and night. Judge every feature by: does it reduce
> officer prep burden? Never by: does it grade a player?
- **Privacy statement** — ✅ live at `wolfpack.quest/privacy`, mirrored from
  `docs/PRIVACY.md`, footer-linked, and called out in the welcome embed.
  Remaining: surface it inside the installer first-run flow once the
  stupid-simple installer lands (see acceptance criteria below).
- **Simplify installation — STUPID-SIMPLE (user spec 2026-05-30).** Collapse the
  Node-install + log-enable + agent-copy steps (`RUN-FIRST-for-Node.js.bat`,
  `start-logsync.ps1`, `Parser.bat`) into one button. Acceptance criteria:
  1. **One button, installs with admin** — UAC elevation; bundle the Node runtime so
     there's no separate Node step. (SmartScreen will flag an unsigned installer →
     code-sign eventually; until then document "More info → Run anyway".)
  2. **Verify location** — auto-detect the EQ folder (look for `eqgame.exe` /
     `eqclient.ini`; check common + Steam paths + registry); show it, let user confirm/override.
  3. **Turn on logging if it wasn't already** — read `eqclient.ini`, set logging on if
     off (back up the file first; refuse while EQ is running; validate after — per the
     EQ-config-write safety rules). Logging master switch lives in `eqclient.ini`; the
     per-char log file only appears after `/log on` in-game, so detect both.
  4. **Surface earliest logs up front** — scan `eqlog_*_pq.proj.txt`, report the oldest
     by file date (and/or first-line timestamp): "Your oldest log on this machine is from
     <date> — we can rebuild your history back to here." Sets backfill-reach expectations.
  5. **Antivirus / Windows throttling check** — the log dir is appended constantly;
     Defender real-time scan or Controlled Folder Access can throttle/block the tailer.
     Check exclusions (`Get-MpPreference` → `ExclusionPath`); if the EQ folder isn't
     excluded, offer to add it (`Add-MpPreference -ExclusionPath`, needs admin) and warn
     about possible throttling/blocking before it bites.
  - In-app detector banner when no `eqlog_*_pq.proj.txt` exists or is stale.
  - Long-term this IS the Mimic installer (one packaged app + auto-update); build the
    detect/verify/enable/AV-check logic now so it carries straight into Mimic.
- **PoP flagging tracker** — greenfield (no code yet; grep confirms only generic `flag`
  usages exist). Officer prep tool: model the Plane of Power flag/key dependency tree
  per character so organizers can see who needs what before a flagging night. Note PoP
  bosses are locked until 2026-10-01 (`isPopLocked()`); the *tracker* can be built now.
  - **Source of truth = the EQEmu DB mirror** (`eqemu_*`), NOT hand-curated links.
    First task: confirm which tables carry PoP zone-access / flag / key data — the
    current weekly sync pulls zone/items/npc_types/spells/loottable but progression
    flags may live in tables we don't mirror yet (qglobals / zone_flags / tasks);
    likely need to **extend `scripts/sync-from-eqmac.js`** to pull them.
  - The PoP Discord channel's flagging **links are a secondary reference layer** over
    the DB-derived tree (better than the user's earlier links, but still supplementary).
  - **Verified 2026-05-30:** flag data is NOT in our current mirror. `eqemu_zone` carries
    only `expansion` + `min_status` (no `flag_needed`); no `qglobals`/`zone_flags`/`tasks`
    tables exist. On Quarm, PoP flags live in quest scripts + `quest_globals` (runtime) +
    key/flag **items** — and key items DO exist in `eqemu_items` (our foothold). Step 1:
    decide whether flags come from extending the sync (if Quarm exposes a DB table) or
    from the Quarm quest source; the item-based keys are buildable from `eqemu_items` now.
- **Avatar generator (ambitious / Mimic-aligned)** — let members make avatars from
  shrunken old-model + new-model EQ toons; stretch: a LOCAL generator that takes a
  third-party screenshot on-device and crops/stylizes it into an avatar. Local-only
  processing fits the privacy posture (image never leaves the machine).
- **Guided walkthrough tours (wolfpack.quest)** — sequenced product tours with
  mouseover coachmarks over the vital spots of each page (`/me`, parses, attendance,
  admin) to teach everyone properly. Same hover-to-explain surface as the
  PRIVATE/ANON/GUILD disclosure tooltips, just ordered into a path; dismissable with a
  "show again" option. Candidate libs: driver.js / Shepherd.js / react-joyride. Ties
  into onboarding so new members get the tour on first sign-in.

## 🏛️ Project Mimic — overarching direction (see `docs/MIMIC.md`)
Electron desktop client, **new 4th component, major release, BETA channel**, codename
**mimic**. Consumes (does not rebuild) the agent + wolfpack.quest data and adds
DnDOverlay-style always-on-top overlays (triggers/audio/TTS, timer bars, DPS meter,
raid announcements). Most client-side queued items above (agent dashboard, triggers,
EQ UI editor #4, tell-bot #5, PvP panel #6) **become Mimic panels** rather than
standalone builds. **Phase 0 = stabilize the agent's local HTTP API as the Mimic
contract** before any overlay/UI work. Reconcile the DnDOverlay feature inventory
against the actual GitLab repo when egress allows (gitlab.com blocked from sandbox).

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
