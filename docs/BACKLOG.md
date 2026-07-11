# Wolf Pack — Active Backlog & Handoff Notes

> Working doc so an implementation can resume cleanly after a context summary.
> Authoritative architecture lives in `CLAUDE.md`; this is just the live queue +
> in-flight findings that aren't obvious from the committed code yet.

## Current state (as of this writing)
- Versions: **Bot 3.0.0 · Agent 3.0.3 · Web 1.0.3 · Mimic 1.0.5**
- Dev branch: `claude/sharp-lamport-dC0TW`. Workflow: commit on branch → push
  branch → merge to `main` with a descriptive `-m` (Railway deploy name) →
  push `main` → return to branch. Bot deploys from `main` (Railway), web from
  `main` (Vercel), Mimic + Parser build via GitHub Actions on `apps/mimic/
  package.json` / version-tag pushes.
- After ANY edit to the agent's `WEB_HTML` template literal
  (`packages/wolfpack-logsync/index.js`): run `npm run check:dashboard`. A bare
  backtick / `${` / unescaped char inside that template breaks the localhost
  dashboard. (Hit twice this session — both were backticks in comments.)

## New feature — Buffs page (✅ v1 SHIPPED, web 1.0.5 · bot 3.0.4)
Guild buff-coverage grid at `/buffs`, built on E's `character_live_state` (Zeal
buffs already sync there — no new agent/Zeal work needed for v1). Categorizes
each character's live buffs (HP/regen/mana/manaRegen/haste/attack/DS/resists via
`web/lib/buffs.ts`), compares against per-role target profiles, flags gaps red,
class filter + "only gaps" + "hide logged-off" toggles, accuracy caveat banner.
**Follow-ups:**
- **Tune categorization** — `lib/buffs.ts` KEYWORDS map is seeded from era spell
  knowledge; needs the raid's real Zeal buff-name strings (the page's "Other"
  column surfaces uncategorized names for exactly this). Highest-value next step.
- **Tune `ROLE_TARGETS`** with officers ("what good looks like" per role; add
  DI/CHA/AC tracking for tanks once those buffs are categorized).
- **Phase 2 (mimic):** a live buff-coverage overlay for in-raid use (reuse the G
  overlay chrome). Site v1 first.
- The PvP overnight board got "howl through the night" theming + lists the wolves.

## Quick requested features (buildable, queued)
- **Overlay pretty-place phase 2 — first-boot placement + per-class default
  sets** (Uilnayar 2026-07-10; V1 shipped in the 1.7.2 beta line). V1 gives
  every overlay's right-click menu: ✨ Auto-arrange (packs VISIBLE overlays
  into the free space computed from the player's `UI_<Char>_*.ini` window
  rects — read-only, dominant `XPos<W>x<H>` resolution block, phantom
  char-select sections filtered), an arrange-on-show mode, 👁 hide, and 🌫
  per-overlay solid backdrops (all-at-once hotkey Ctrl+Shift+B). Phase 2:
  (a) run the same packer on FIRST BOOT so a new user's overlays land
  arranged instead of stacked top-left; (b) seed WHICH overlays to enable
  from per-class default sets — admin-crafted on /admin/overlays (ships via
  the existing overlay-tuning poll) or observed from same-class raiders'
  configs; (c) multi-monitor placement (V1 packs the primary display only).
  The packer + UI parser live in apps/mimic/main.js
  (`_autoArrangeOverlays` / `_parseUiWindowRects`).
- **Capture the `wolfpacktag` raid channel → live raid-leader overlays.**
  (Uilnayar 2026-07-08. ⛔ BLOCKED on a raw log sample — not ready to provide
  yet.) The guild already runs an in-game custom chat channel (`ztwolfpacktag`
  / `wolfpacktag`) to tag mobs: pull, tank picked up an add, which to assist,
  "this charmed mob is a pet", etc. This IS the raid-intent stream we were
  otherwise going to synthesize from `/pipe ASSIST %t` macros (see the Zeal
  pipe protocol discussion) — consuming the existing channel beats inventing a
  macro protocol. Plan:
  1. **Capture** — the agent's privacy filter drops ALL custom channels at
     `DEFAULT_DROP_PATTERNS` line ~261 (`/\btells\s+\w+:\d+,\s*['"]/i`). Chat
     is parsed BEFORE `shouldKeep`, so add ONE allowlisted parser that matches
     ONLY `wolfpacktag` and captures it; Wolfpackofficer / Lfg / Ports / tells
     / group stay dropped exactly as today. Surgical hole, not a weakened
     filter.
  2. **Structure** — parse the tag grammar into typed events (assist /
     add-pickup / pull / charm-is-pet / mark / …) so it drives overlays, not
     just a log timeline.
  3. **Feed overlays** — the kill-target skull + add/CC board, relayed via the
     existing trigger fan-out (bot ring buffer → every Mimic polls
     `/recent-fires`), so one tagger lights up the whole raid.
  4. **Privacy** — amend `docs/PRIVACY.md` AND `web/app/privacy/page.tsx`
     TOGETHER with the capture (never ship the claim before the behavior). It's
     an explicit named carve-out ("one raid channel, coordination only —
     everything else custom/tells/officer stays filtered"), not a quiet
     widening of "we never upload private channels". Draft wording already
     written in the 2026-07-08 session.
  **NEEDED before writing the regex (load-bearing — guessing ships a broken
  parser or captures the WRONG channel):** (a) 3-5 raw `ztwolfpacktag` lines
  straight from the EQ log file — exact on-disk format, or confirmation it only
  comes via the Zeal pipe (type 0 log stream) and not the log file at all;
  (b) is it players typing vs Zeal auto-broadcasting on a target tag; (c) the
  exact channel token (`ztwolfpacktag` vs `wolfpacktag` + a `zt` display
  prefix). Open product Q: mirror to web as a searchable tag timeline (like the
  chat log) or stay purely live-overlay + ephemeral?
- **Stale-log-filename attribution — extend beyond chat.** Root cause found
  2026-07-07 (the Starrburst/Dant/Bardtholemu chat renames): after a character
  swap the EQ client keeps appending to the PREVIOUS character's log, so
  everything keyed on the log FILENAME misattributes for the rest of that
  session. Chat is fixed end-to-end (agent 3.2.2 `speaker_source` + Zeal
  resolution + cross-log arbitration; bot 3.0.146 witness adoption + Discord
  post heal). Still filename-keyed and therefore still wrong after a swap:
  **encounter/parse self-damage credit** (`builder.character` — post-swap
  parses credit the old character), buff-landing observer, faction/pop-flag
  attribution, `/who` uploadedBy, live-state `uploaded_by`. The
  `_resolveSelfChatSpeaker` Zeal mapping is the reusable hook — apply it at
  EncounterBuilder line-ingest (or builder creation refresh) next raid window.
- **Efficiency review burn-down (2026-07-07).** Full ranked findings + growth
  rules in `docs/EFFICIENCY-REVIEW-2026-07-07.md`. Round 1 shipped (bot
  3.0.141 / web 1.0.176): /fun parallel + RPCs (1.5s→18ms Tunare), state.json
  memo, missing character-live-state route (cross-client MT HP was silently
  dead), bounded buff-queue select. Next up: bot hot-handler memos, agent
  tail-loop pre-filters + dead zeal.ini cache, Mimic melody 150ms poll +
  byte-stability, Supabase retention (chat 138MB / buff_casts 118MB /
  who_observations 102MB and growing).
- **EQ Legends config formats — documented, nothing built.** Uilnayar provided
  real Legends client files (2026-07-06); full spec + candidate work items
  (UI Studio backup support, spell-loadout ingest, feasibility map) in
  `docs/eq-legends-formats.md`. Key facts: `UI_<Char>_<server>_LO<n>.ini`
  naming (numbered layouts!), `<account>_characters.ini` character index,
  percent-anchored window positions, named `[SpellLoadouts]`. No Zeal on
  Legends — anything Zeal-fed can't port. Need a Legends LOG sample before
  scoping log-driven features.
- **/me named-mob kill counts.** Show per-named-mob totals of how many of each
  the member has killed / been part of the kill on. Buildable from
  `encounter_players` ⋈ `encounters.npc_id` ⋈ `eqemu_npc_types.name`: count
  distinct encounters per npc where one of the member's characters appears.
  Group by npc, sort desc. A new card on `/me` (per-character or family-wide).
- **Pet buffs (`/pet health`).** Parse the `/pet health` burst (HP + bare
  buff-name lines sharing one timestamp) → pet HP + buff list; track each buff's
  first-seen across the macro-spammed snapshots for a recast anchor. v2: durations
  from `eqemu_spells` + AA extensions. (Started planning; no edits yet.)
- **Supabase retention/prune job** (see sizing note below) — prune `agent_uploads`
  (heartbeat log, ~60MB/177k rows) to ~30–60 days; later `who_observations`. Keeps
  us comfortably on the free tier.

## In-flight findings (not yet acted on)
- **Supabase size (checked 2026-06-04): 280 MB / 500 MB free tier = 56%.** Growers:
  `chat_messages` 79MB, `agent_uploads` 60MB, `who_observations` 44MB. Fixed:
  eqemu_* catalog ~50MB. Cheapest cap = prune `agent_uploads` (pure heartbeat
  log). Pro tier is $25/mo (8GB) if we'd rather not prune.
- **Windows code signing — pre-staged, awaiting SignPath Foundation approval.**
  Applied to SignPath.io Foundation (free OSS code signing) 2026-06. Signing
  pipeline is wired but OFF in `.github/workflows/release-mimic.yml` (gated on
  `vars.SIGNPATH_ENABLED`); footer credit live; `patch-latest-yml.js` handles the
  post-sign auto-update hash repair. **Full runbook + flip-on checklist:
  `docs/code-signing.md`.** When SignPath approves → set the repo vars/secret per
  the doc, bump Mimic, done. (No version bump on the pre-stage so it doesn't
  trigger a build.)
- **Spell-cast attribution / "a spell" problem (testing 2026-06-04).** The Info
  tab's "Spell Casts This Session — Players / NPCs" lists everyone's casts as
  "a spell" because **EQ does not log spell names for bystanders** — only the
  uploader's own casts are named. Two asks:
  1. Guild mates (Elyas, Atlasius, …) land in the **NPC/Unknown** bucket because
     `isConfirmedPlayer` hadn't confirmed them yet (not /who'd / no heal seen).
     Fix idea: also treat names present in the roster (`characters` table, synced
     down) or in `who_observations` as players, and/or relabel the section so
     "Unknown" ≠ "NPC".
  2. **Resisted-spell caster attribution for PvP class inference.** We DO name the
     resisted spell ("You resist the Tangling Weeds spell!") but not the caster.
     During PvP this is gold for inferring enemy class + intent. EQ doesn't name
     the caster on the resist line, so the approach is to **correlate** a resist
     with a recent "X begins to cast a spell" line (EQ logs that for others,
     without the spell name) within a short window → infer X cast the resisted
     spell. Heuristic, needs real Quarm PvP log samples to tune the window +
     line formats. Ties into backlog D (PvP detrimental-spell assists) and the
     non-guild character page (class inference). (agent)


- **Zeal pet gauge slot = 16.** Confirmed from Hopeya's gauge dump: slot 1=self,
  slot 6=target, slot 16=the charm pet (a 2nd "A Netherbian Drone" at 100% vs
  the target drone in slot 6). Slot 24 ("4", ~53%) is a fixed UI gauge, not the
  pet. → wire slot 16 (HP% + text=name) into Mimic `_zealAbsorb`
  (`apps/mimic/main.js`) so the charm overlay gets live pet HP directly instead
  of via the log-based charm-tracker cross-reference.
- **`character_live_state` migration is ALREADY APPLIED** (Supabase). Columns:
  guild_id, character, zone_id, zone_name, self_hp_pct, buffs jsonb, buff_count,
  uploaded_by, updated_at; RLS on, authenticated SELECT, service_role write.
  Still needs: agent push (debounced flush of `_zealState` per character) →
  new bot endpoint `POST /api/agent/live-state` (bearer) → upsert → web /me
  section that reads it + "see the local dashboard for live data" note.
- **PvP assists are NOT linked by `pvp_kill_id`** (each agent records its own
  assist row independently, FK null, ~1s clock skew). Co-assisters are grouped
  on killer+victim within a 2-min window (web `pvp/[name]/page.tsx`). Any future
  assist work should keep that in mind (or fix the agent to link the FK).

## BACKLOG — agreed priority order: G → A → C → E → B → H → I → D
(Set 2026-06-04. Driving toward the next raid: Sun/Wed/Thu 8:30pm ET.)

**Progress (overnight 2026-06-04):** ✅ G, A, C, E, B all SHIPPED to main
(Mimic 1.0.8 · agent 3.0.7 · bot 3.0.1 · web 1.0.4). H + I are 📐 designed and
awaiting sign-off (`docs/DESIGN-buff-debuff-queue.md`, `docs/DESIGN-ch-chain.md`).
D is ⛔ blocked on real Quarm PvP-debuff log samples. The five shipped items are
the "get them hooked" set and are ready to test in order tomorrow.

### Quick wins
- **A. Pet slot 16 → charm overlay — ✅ SHIPPED (agent 3.0.4 · Mimic 1.0.7).**
  - Mimic `_zealAbsorb`: gauge type 16 (require a name) → `s.pet_name` /
    `s.pet_hp_pct`. Agent `_serializeZealForWeb`: slot 16 is now the PRIMARY pet
    signal (charm-tracker name cross-ref kept as fallback) → Buffs & Zone pet
    line lights up live. New `_livePetHpByOwner()` helper feeds `pet_hp_pct`
    onto the `/api/state` `charmPets` array; charm overlay (`charm.html`) renders
    a colored HP% + bar (green/amber/red). Only the local uploader's own pet has
    gauge data (Zeal streams only the local client), which is the pet that
    matters. Dashboard escape check passes.
- **B. Resisted-spells dropdown — ✅ SHIPPED (agent 3.0.7).** The `info` tab
  "Spells Resisted (incoming)" card now renders each spell as an expandable
  `<details>` (open-state preserved across re-render) listing which mobs cast it
  + counts, from the `byMob` map the parser already collected. The map is
  populated from `this.bossName` (the mob being damaged) at resist time, so
  attribution lands during any fight; "—" only happens for resists outside a
  tracked fight, which the card now explains. Render-only change — the data was
  already there. Dashboard escape check clean.
- **C. Overlays submenu expansion — ✅ SHIPPED (agent 3.0.5 · Mimic 1.0.8).**
  Tray Overlays submenu now has a "Panel overlays" group with named toggles:
  💥 DEEPS, 💚 Healing, 🛡 Incoming damage (tanking), ⚔️ Threat detail, 📊 Top
  damage (overall). Each is a checkbox (checked = that panel-overlay window is
  open) that toggles `createPanelOverlay(key)`. Keys are emoji-stripped panel
  titles; the dashboard overlay matcher gained an emoji-stripped fallback
  (`_pkStrip`) so an ASCII key resolves to the emoji-titled card without
  reproducing exact emoji bytes. Panel `closed` now refreshes the tray.
  NOTE: "Buff Timers" was intentionally NOT added here — there's no dashboard
  panel for it yet; it's really backlog **H** (buff/debuff coordination queue).
  The trigger overlay's timer stack already covers ad-hoc timers.
  PANEL_OVERLAYS list lives in `apps/mimic/main.js` — keep in sync with the
  agent dashboard <h2> titles.

### Medium
- **D. Detrimental-spell assist credit — ⛔ BLOCKED on log samples.** A debuff
  cast on the PvP victim should count as an assist (assist correlation currently
  keys off recent *damage* to the victim, so non-damaging debuffs/snares/roots
  don't credit). To do this without guessing, I need real Quarm log lines for a
  detrimental spell you land on an ENEMY player — i.e. what your log prints when
  you snare/root/tash/malo/nuke-resist another player. Likely candidates:
  `Your <Spell> spell has worn off of <Victim>.` / a resist line that names the
  victim / a "<Victim>'s <stat> drops" line. **Paste ~10 such lines from a PvP
  fight and I'll wire `_checkPvpAssist` to credit the caster.** Building it
  against guessed regex would silently miss or mis-credit — not worth it blind.
- **E. Char live-state sync — ✅ SHIPPED (bot 3.0.1 · agent 3.0.6 · web 1.0.4).**
  Agent `flushLiveStateToBot()` pushes each watched character's buffs +
  last-seen zone to `POST /api/agent/live-state` (bearer) on change only (zone /
  buff-set / first sight; 20s interval; fire-and-forget, NOT queued since it's
  replaceable). Bot upserts into `character_live_state` by (guild_id,character).
  Web `/me` gained a per-character "Buffs & Zone" panel (GUILD scope) with a
  "live on localhost:7777 ↗" pointer + nHmM buff-time format. Added repo
  migration `20260604000000_character_live_state.sql` (idempotent — the table
  was first created via MCP). web tsc clean; bot/agent node --check clean;
  dashboard escape check clean.
  Follow-up (not blocking): honor `exclude_from_stats` in the agent push (skip
  excluded chars) — same follow-up noted in CLAUDE.md for other upload paths.

### Large
- **G. Mimic overlay/setup overhaul — ✅ SHIPPED (Mimic 1.0.6).**
  - Setup page (`loading.html`): Connect card now offers token **OR** Discord
    sign-in (device-code); new **EverQuest folder** card (2nd item) shows what
    Mimic auto-detected + lets you add a folder — directly answers "couldn't
    locate my files"; new **Overlays** opt-in card (all off, live toggles).
  - Overlays **OFF by default** (`defaultConfig` showHud/enableTriggerTts → false;
    showCharm was already off). Each overlay (hud/trigger/charm + panel overlays)
    has a corner **✕** to hide it. ✕ works even when overlays are LOCKED via a
    new hover-to-interact IPC (`overlay-hover-interactive`) that uses the
    existing `forward:true` flag — this also makes the injected ⚙ gear clickable
    when locked (it wasn't before).
  - New IPC: `hide-overlay`, `overlay-hover-interactive`. New preload bridges:
    `hideThisOverlay`, `overlayHoverInteractive`. Setup overlay toggles reuse
    `saveConfig` (its handler already applies visibility live).
  - Installer (`build/installer.nsh`): added guarded `customHeader` with
    `MUI_DIRECTORYPAGE_TEXT_TOP` clarifying "this is the app location, not your
    EQ folder; default is fine." Guarded with `!ifndef` so it can't break the
    build. **Still TODO (needs a Windows build to validate): the user's
    "Quick install to AppData vs Choose location" two-mode page** — that needs a
    real nsDialogs custom page; deferred because a bad .nsh fails the whole Mimic
    build and we can't test NSIS in this env.
  - ⚠ Could not build/run Electron here — needs a Windows run to confirm the ✕
    catches clicks when locked and the setup cards behave. Syntax-checked all
    four HTML inline scripts + main.js/preload.js via node.

- **F. /who web section** — name search w/ autocomplete, browse-by-guild,
  and let signed-in users set their own toon's class when known (write to
  `characters.class`, owner-gated). Data: `characters` + `who_observations`.
  (web; maybe a small write endpoint)
- **G. Mimic overlay/setup overhaul** (real install friction — Dafeet hit it):
  - First-run setup page (`apps/mimic/loading.html`) should include an **EQ
    folders** card as the **2nd** item (reuse `findEqInstalls`/`pickEqDir`).
  - Token card should offer **"enter token OR sign in with Discord"** in the
    same area (reuse `mimicLinkStart` device-code flow already built).
  - Overlays **OFF by default** (config defaults: showHud/enableTriggerTts/
    showCharm → false in `defaultConfig()`), and each overlay needs an **✕** in
    the corner to hide it directly (overlay.html / triggers.html / charm.html +
    panel overlays via preload).
  - **Panel overlays** (e.g. "Known Pets This Session") pop up full-window with
    no way to resize/close — add ✕ close + make the gear→setup resize obvious.
- **H. Buff/Debuff coordination queue — 📐 DESIGNED, awaiting sign-off.** Full
  implementation-ready proposal in `docs/DESIGN-buff-debuff-queue.md` (phased:
  local detection first, then shared relay reusing the E live-state pattern).
  Blocked on 5 sign-off questions + ~10 real Quarm log lines (worn-off / dispel /
  curse / death) to lock the detectors. ~1 day once approved.
- **I. CH-chain DDR minigame — 📐 DESIGNED, awaiting sign-off.** Proposal in
  `docs/DESIGN-ch-chain.md` (timer-driven v1, rotatonator-style, reuses the G
  overlay chrome). Blocked on: driver choice, who configures the rotation, and
  the actual Quarm CH chain cadence (N seconds). Real build; confirm it's wanted
  for the raid push vs. later (most specialized — clerics only).

## Done this session (for reference)
- Pause Discord tells (tray + agent + bot), dashboard stutter fix, stale Zeal
  char prune, charm-land detection (Quarm pet-command acks), Buffs & Zone card
  with zone names, copy-guild-trigger→personal, TTS triggers fire, EQLP
  .tgf/.gz import + timer warnings, GINA-style timer rows, Mimic Discord login
  (device-code), graduated everything out of beta (3.0.0 / 1.0.0), assisted
  installer + self-cleaning uninstall + discoverable uninstaller, no-logs
  crash-loop fix + run-process EQ-folder detection, PvP "most killed guilds" +
  individual-page Assists (+ co-grouping fix), web nav/home/header cleanup,
  dashboard stability (gauge details, My Crits flicker, ✕ hide buttons, buff
  time format), tray reorder.
