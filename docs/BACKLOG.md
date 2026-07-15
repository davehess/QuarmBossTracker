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
- **Per-class name colors on overlays — 📐 designed, ⛔ NEEDS LOCAL SESSION
  for the data.** (Uilnayar 2026-07-11: use each user's own EQ raid-window
  class colors "in some capacity for different class types; use Hitya's
  color palette for classes as a template, with the ability to turn that
  off in options".) Design: (1) agent parses the player's raid-window class
  colors from their EQ config at startup (same newest-UI-ini discovery as
  `_parseUiWindowRects`) → serves on /api/state as `classColors`
  (classkey → #rrggbb); (2) ships a guild-default template = HITYA'S
  palette as a constant; (3) cfg.classColorMode: 'template' (default) |
  'mine' (own EQ colors, template fallback) | 'off'; chrome-menu or
  Overlays-tab toggle; (4) consumers color class-known names: buff queue
  rows, Extended Target, /who overlay, CH chain healers, raid rosters.
  **Needs local session FIRST (blocker):** the exact file+section where the
  Quarm client persists raid-window class colors, plus Hitya's actual
  values. On the desktop: check `UI_Hitya_pq.proj.ini` (grep for sections
  with Color/RGBA keys near Raid), `eqclient.ini`, and Zeal's ini; paste
  the section verbatim + key format into this item (or mirror to a
  `class_color_template` row). UI snapshots in Supabase are AES-encrypted
  with the bot-side WISHLIST_BID_KEY — cloud sessions cannot read them,
  so this data must travel via this doc.
- **Guild bazaar price index (no live tracker exists for Quarm).** quarm.tips
  is dead; quarmtraders.com froze 2024-03 (EC-tunnel era, 1,294 items only).
  Two feeds we already own: (a) each trader's own satchel prices persist
  locally as `BZR_<Char>_pq.proj.ini` → `[ItemToSell] <Item>=<copper>` —
  agent uploads OUR traders' listings; (b) agents parked in the Bazaar can
  relay `/auction` WTS/WTB lines the way chat relay already works. Either
  feeds a `bazaar_listings` table → price history on the web. The Quarm
  Discord auction feed is NOT scrapable without putting a bot in their
  server (and self-token scraping is a Discord-ToS violation) — skip it.
  Companion doc: `docs/bazaar-filter-pack.md` (curated filter presets,
  2026-07-11).
- **PoP Raid Slideshow — fill PoTime P2/P3 + Quarm-divergence loop.**
  (Shipped 2026-07-11: data module `apps/mimic/pop-raids.js` + overlay
  `popraid.html` on beta, bot 3.0.158 endpoints `raid-objectives` /
  `pop-anomaly` on main.) Remaining: (a) PoTime Phases 2 & 3 are
  `pending:true` stubs — EQProgression 403s our server; run
  **`docs/pop-raids-local.md`** (local capture → transcribe into the
  encounter shape, ship on beta); (b) after the 2026-10-01 PoP unlock, fold
  confirmed ⚑ QOL-thread anomalies back into `pop-raids.js`
  (encounter callouts/stats or `quarmGlobalNotes`) — the guide numbers are
  estimates, Quarm observations win; (c) set `QOL_THREAD_ID` on Railway
  (falls back to FEEDBACK_THREAD_ID until then).
- **Overlay pretty-place phase 2 — ✅ (a)+(b) SHIPPED 2026-07-11** (bot
  3.0.159 / web 1.0.201 on main; agent 3.3.17 / Mimic on beta). (a) First-boot
  arrange: class-set seeding runs the packer after applying, and
  mark-onboarded runs it once when onboarding enabled overlays (deliberately
  NOT the EQ-presence flip — that would re-pack existing installs that
  predate the `firstArrangeDone` flag). (b) Per-class default sets:
  `overlay_tuning.class_sets` jsonb (SEPARATE column — the knob save rebuilds
  `tuning` wholesale), 🧩 editor on /admin/overlays, served on the same
  90s agent poll, surfaced on /api/state as `classOverlaySets` +
  `activeCharacterClass` (/who → Zeal type-5 fallback), consumed by Mimic's
  one-shot `_maybeSeedClassSet` (fresh installs ONLY — any user-enabled
  overlay or saved char profile marks the install seeded untouched).
  REMAINING: (c) multi-monitor placement (packer works the primary display
  only); (b2) "observed" sets — seed from same-class raiders' actual configs
  instead of/alongside admin-crafted. Packer + UI parser:
  apps/mimic/main.js (`_autoArrangeOverlays` / `_parseUiWindowRects`).
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

## Needs local session (exact data wanted)

- ~~Verify the first-person OUTGOING heal line~~ **RESOLVED (Uilnayar
  2026-07-14): it does not exist.** Heal amounts are private to the healed;
  bystanders only see the spell's `cast_on_other` landing message with the
  target's name ("X is completely healed." / "X feels much better."). The
  defensive pattern in the agent stays as a no-op.

## CONTINUATION QUEUE (2026-07-14 handoff — Uilnayar-approved order)

> Scaffolding for the next session (any model). Designs below are agreed with
> the owner; implement top-to-bottom. Mimic/agent work lands on `beta` (the
> **1.9 line** — healing features graduate as Mimic 1.9.0 once raid-tested);
> bot/web straight to `main` per the CLAUDE.md cadence rule.

### 1. Healing elements (finish the feature)
- **✅ SHIPPED (2026-07-15, session A).** Generic heal-landing matcher
  (agent 3.3.37 `noteHealLandLine` all suffixes; bot spell-catalog v7
  `heal`/`heal_fixed`; join pass 2 credits any witnessed landing at the
  cast's amount) AND the Tank overlay inbound heals (agent
  `_serializeTankState` inbound_heals via target-casts; `apps/mimic/tank.html`
  ghost HP segment + 100ms cast-bar ticker; CH excluded). Bot 3.0.176 (main),
  agent 3.3.37 + tank.html (beta / Mimic 1.9 line).
  - Follow-up: the tank overlay only shows a heal when the CLERIC runs agent
    3.3.37 (amount is agent-attached). To cover a new-agent tank + old-agent
    cleric, add a bot-side fallback: look up the heal amount in the `/casting`
    ingest from the catalog when `heal_amount` is absent (the bot already
    computes `_healMagnitude`; lift it to a cached name→amount map).
- **✅ Divine Intervention tracker SHIPPED (2026-07-15: agent 3.3.44 beta +
  bot 3.0.183 main + character_live_state.di_ready_at migration).** Log-driven
  (noteSelfCast stamps cast+6s+90s; interrupts refund; default ready);
  GET /api/agent/di-status aggregates clerics; chips on chchain.html (with the
  one-shot "only <X> has DI" TTS) + command.html (display-only). CHA-awareness
  (recipient CHA from gear sums) NOT built — small follow-up if wanted.
  Original scaffold kept below for reference:
- **Divine Intervention availability tracker — SCAFFOLD (data confirmed).**
  DI = eqemu_spells id **1546**: cast_time **6000ms**, **recast_time 90000ms**
  (90s — short, so "who has it up" is meaningful mid-fight), cast_on_you
  "You feel the watchful eyes of the gods upon you.", cast_on_other
  "<X> feels the watchful eyes of the gods upon them." Zeal's gem/recast
  payloads are NOT wired into the agent yet (zealPipe.js header: "need ground
  truth, not inference"), so go **log-driven**:
  - Agent (beta): on a self-cast of Divine Intervention, set
    `di_ready_at = castStartMs + 6000 + 90000`. Default = ready (up) until a
    cast is seen. Upload per-cleric readiness — cleanest is to add a
    `di_ready_at` field to the existing `live-state` upload (the cleric's own
    character_live_state row) rather than a new kind.
  - Bot (main): store di_ready_at (new nullable column on
    `character_live_state`, or stash in the buffs jsonb). Aggregate across
    clerics (class=Cleric via roster/who). Serve on `/raid` + a small relay
    the Command Center / CH-chain overlay polls.
  - Overlay (beta): per-cleric DI up/cooldown chip in Command Center /
    chchain.html; when exactly ONE cleric is up, highlight + TTS "only <X>
    has DI — save it for the tank". Recipient-CHA awareness: pull CHA from the
    gear page's stat sums when available (DI success scales with target CHA).

### 1b. Backlog-pass status (2026-07-15 session, raid day)
- ✅ DI tracker shipped (see above). ✅ UI Studio drag/drop reorder +
  class-common macros (bot 3.0.182 / web 1.0.223). ✅ task #44 HALF: bosskill
  raid-channel posts deferred post-ack (bot 3.0.183). ⚠ pvp handler NOT
  deferred: its kill-ledger recording is ENTANGLED with the channel fetch
  (`if (!ch) continue` inside the loop skips pvp_kill rows whenever Discord
  is down — an existing latent bug). Fix = record rows unconditionally, then
  defer sends; needs its own careful pass, not a raid-day rush.
- #47 trash segmentation deliberately NOT touched (its own warning: don't
  rush into the 1.9 beta on a raid day). Bulk re-merge still awaiting the
  owner's explicit go. Base stats v1, "Set up for me" onboarding wiring,
  /me named-mob kill counts, and mob-immunity observed capture (§6 Fix A)
  are the next unblocked items, in that order.

### 2. Data scrubbing (unblocks stats features) — NEXT PRIORITY (Opus)
- **#47 same-name trash segmentation** (Terror over-aggregation). NOT small —
  it touches the agent's EncounterBuilder `add(event)`/`flush()` (~line 4059+),
  which governs ALL parses, so do it carefully against a real log and do NOT
  rush it into the 1.9 beta. Approach: when a same-named mob's "has been slain"
  fires and combat continues on a FRESH same-name spawn, flush the current
  encounter and start a new one instead of aggregating. Death-boundary +
  HP-continuity (damage >= 0.9x catalog HP since last segment). Pipe carries no
  spawn id (CLAUDE.md scope note) so ONLY sequential same-name kills are
  separable. Align with the bot's existing sequential-kill splitter in
  find_or_create_encounter (needs a CONFIRMED prior kill) so they don't
  double-split.
- Then the offered **bulk re-merge of historical encounter_players** with the
  robust median (owner hasn't said go yet — ASK before running; rewrites
  history).

### 3. Character pages: base stats + bind
- **Base stats v1.** Surfaces: agent capture + bot endpoint + web /me +
  migration. (a) Seed a race x class base-stats table (STR/STA/AGI/DEX/WIS/INT/
  CHA at creation — classic values, "good enough to start"). (b) /me: manual
  creation-point allocation editor (server action -> new column on characters).
  (c) Death-respawn review: gear stays on at bind, so a true naked snapshot
  isn't automatic — capture the client's base readout or prompt to confirm
  allocation on death. Gear total = base + allocation + gear (gear sums exist
  in gear/page.tsx). Cap 255 now / **355 with PoP AAs** — show "255(280)".
- **Bind location from `/charinfo`.** Agent (beta): parse the `/charinfo` bind
  line -> new `characters.bind_location` column (bot endpoint + migration);
  web shows it on /me. Small once the column exists — but get the exact
  `/charinfo` line format from a LOCAL session first (not in our reference
  logs).

### 4. Pre-2.0 requirement
- **"Set up for me" wired into Mimic first-run onboarding** (currently a
  dashboard button — agent `_applyEqSetup` / POST `/api/eq-setup`, `.wp-eq-setup`
  in the dashboard). Wire the same call into Mimic's first-run flow
  (`apps/mimic/main.js` onboarding/loading window). NOTE (owner, confirmed):
  **`/pipeverbose on`** works LIVE in-game (no EQ restart for that Zeal key);
  **ExportOnCamp has NO in-game command** — INI edit with EQ closed stays the
  path. Update the setup card note + onboarding copy to say exactly that.

### 5. After data scrubbing
- **/me named-mob kill counts** (encounter_players ⋈ encounters.npc_id ⋈
  eqemu_npc_types — design in "Quick requested features" above) + a
  searchable section and timeframe filtering on those views.

### 6. Mob immunity display on Target/Mob Info (Uilnayar 2026-07-15)
Report: "a sonic warwolf" showed **"Your target is immune to changes in its
run speed"** in-game, but the Target Info / Mob Info Stats tab gave **no**
snare/root-immune warning — "it needs to show up on the target info if people
are going to rely on it."

**Diagnosis is DONE — this is a DATA gap, not a code gap:**
- The decoder AND the overlay render are already complete. `_decodeMobSpecials`
  + `_MOB_SPECIAL_LABELS` (index.js ~6806-6836) already map every immunity ID
  we care about — 12 Unslowable, 13 Unmezzable, 14 Uncharmable, 15 Unstunnable,
  **16 Unsnareable**, 17 Unfearable, 18/19/20/21/23/27/28/31. The bot ships them
  as `specials: _decodeMobSpecials(...)` (index.js ~9153) from the mob-info
  select (~8912). The overlay renders `mob.specials` as chips (mobinfo.html
  442-444 + 520-522, styled via `specClass(lab)`). The **"Magical"** badge in
  the screenshot IS this pipeline working — it's the decode of `"10,1"`
  (ability 10 = requires-magical-weapons).
- Root cause: `eqemu_npc_types.special_abilities` is **incomplete for Quarm.**
  Screenshot mob `a_sonic_warwolf` **L30 (id 166061)** has `special_abilities =
  "10,1"` — Magical only, **no ability 16** — yet the game enforces snare
  immunity. The **L39 variant (id 167662)** correctly carries `"10,1^16,1"`.
  So the catalog cannot be trusted for immunities, and a pure catalog-decode
  path would keep showing nothing here.

**Two fixes (A is the reliable one the request is really asking for):**
- **A. Agent-observed immunity capture (beta / 1.9-or-later agent).** The
  combat log carries the *definitive* immunity lines; flag them live for the
  current target, independent of catalog:
  - `Your target is immune to changes in its run speed.` → snare/root immune
  - mez-immune / charm-immune / stun-immune / "cannot be mesmerized" lines
  - ⚠ **IMMUNE ≠ RESISTED.** `Your target resisted the Snare spell.` /
    `resisted the Grasping Roots spell.` are RESISTS (MR / level gap), NOT
    immunity — do NOT flag those. Only the "is immune to…" lines are truth.
  - Surface as a live "🚫 Snare immune (seen)" chip on the Mob Info Stats tab
    (append to `specials`, or a separate `observedImmunities` field so it can
    render with a distinct "observed" style). Upload keyed by mob name so it's
    cross-client + persists (who-style), and optionally upsert back to the
    catalog to make it PROACTIVE next time.
  - Inherent limitation: the immune line only appears on the client that
    actually *tried* to snare/mez/stun the mob, so observed-only won't warn
    until someone attempts it — which is exactly why (B) matters for proactive
    display.
- **B. Local peq backfill of `special_abilities` — ⛔ NEEDS LOCAL SESSION.**
  Same pattern as the haste/regen/etc. backfill (CLAUDE.md, 2026-07-11): the
  authoritative local Quarm/`peq` NPC DB on `D:\EQServer` likely has the real
  special_abilities the eqmac dump omits. Mirror it into `eqemu_npc_types`
  where ours is thinner. Caveat: Quarm may genuinely differ from stock EQEmu,
  so verify against in-game behavior — (A) is the trustworthy source, (B) makes
  it show up before anyone casts.

### 7. Cross-client HP serialization of simultaneous same-name mobs (Uilnayar 2026-07-15)
Report: two "a grimling marauder" up at once, each with the in-game target
ring (clearly distinct entities). The Mob Info "DEBUFFS (OBSERVED)" card
merges BOTH mobs' debuffs onto whichever one you target — Engulfing Roots on
the 3%-HP grimling shows up on the 44%-HP grimling's card and vice-versa. This
is the over-merge / "dedup in reverse" case the owner flagged.

**Why it happens (data path):** the `casting` relay (agent index.js ~2540)
uploads `{caster, spell, target(NAME), started_at, cast_secs}` — **target NAME
only, no HP**. buff_casts / `target-buffs` therefore key debuffs by mob name,
so N same-name mobs collapse to one card. This is the exact CLAUDE.md scope
boundary ("Zeal pipe carries no spawn id — same-name mobs are NOT
disambiguable"; the pipe surface is name + HP‰ only).

**Owner's insight (valid, and a real extension):** a SINGLE client's pipe
can't tell two same-name mobs apart, but the bot already aggregates target
observations from EVERY Mimic client. If caster A is targeting the mob at HP‰
X and player B is targeting the one at HP‰ Y, we have two *simultaneous*
distinct HP readings = two serializable entities — something the raw pipe
can't do alone. Attribute each debuff to the entity whose HP‰ matches the
CASTER's target HP at cast time.

**Sketch (queued, NOT for the 1.9 raid build — substantial + fragile):**
1. Agent: attach `target_hp_pct` (already computed for live-state, ~7404) to
   the `casting` AND buff_casts uploads at cast time. First and smallest step;
   nothing downstream is possible without it.
2. Bot: build per-client target-HP‰ time series (target snapshots already
   flow via live-state / extended-target). Cluster into distinct entities by
   HP-continuity (a monotonic-ish descending trajectory = one mob; two
   trajectories that hold different HP at the same instant = two mobs).
3. Attribute each debuff to the entity whose trajectory passes through the
   caster's cast-time target-HP‰. Key the overlay card by (name, entityId).
4. Overlay: when you target a same-name mob at HP‰ Z, show only the entity
   whose current HP‰ ≈ Z.

**Hard edges — document, don't over-trust (this is why it stays queued):**
- Both mobs spawn at 100% → indistinguishable until they diverge; early
  debuffs can't be attributed (accept: improves as HP spreads).
- HP crossover (mob A descending through 44% while mob B sits at 44%) is
  momentarily ambiguous; needs velocity/direction continuity, still fragile.
- Any heal / regen breaks HP monotonicity (grimlings barely regen; a healed
  or FD-reset mob will).
- Cross-client clock skew (same problem the heal correlation already fights)
  must be handled before comparing HP "at the same time".
- **N≥3 simultaneous same-name identities stays PROHIBITED** (CLAUDE.md) — HP
  diversity can plausibly separate 2, not a pack of 3+ churning through
  overlapping HP. Bound the feature to N=2 and fall back to name-merge (with a
  "⚠ multiple same-name mobs" note on the card) above that.
- Related but distinct from **#47** (sequential same-name kill segmentation,
  Continuation Queue §2): #47 separates same-name mobs killed one-after-another
  in ONE client's log; this separates same-name mobs alive AT ONCE using
  MANY clients' HP. Design them to share the HP-continuity primitive.

## Heal attribution — follow-up: generic landing matcher (queued)

Agent 3.3.36 witnesses **Complete Heal** landings only (`is completely
healed.`, joined bot-side at the fixed 7,500). Generalize to every heal spell
using the catalog's `cast_on_other` suffixes — verified rows (eqemu_spells):
Remedy `'s wounds fade away.` (408–438, formula 101) · Superior/Greater
Healing/Nature's Touch `feels much better.` (shared suffix — disambiguate by
the joined cast's spell) · Chloroblast `is blasted with chlorophyll.` ·
Celestial Healing `'s body is covered with a soft glow.` (HoT, SPA 100) ·
Divine Light `is bathed in a divine light.` Amount = SPA-0 base..max by
formula (fixed for formula 100; midpoint estimate otherwise, keep the `~`
estimated flag). Plumbing already exists end-to-end: agent `heal_lands` →
bot merge → join pass 2 → `~` on the card — only the matcher set and a
bot-side per-spell amount lookup (eqemu_spells) are new. Also queued: live
"heals in flight" surface (/raid or overlay) off the same casting relay.

## In-flight findings (not yet acted on)
- **Supabase size (checked 2026-06-04): 280 MB / 500 MB free tier = 56%.** Growers:
  `chat_messages` 79MB, `agent_uploads` 60MB, `who_observations` 44MB. Fixed:
  eqemu_* catalog ~50MB. Cheapest cap = prune `agent_uploads` (pure heartbeat
  log). Pro tier is $25/mo (8GB) if we'd rather not prune.
- **Windows code signing — CLOSED (2026-07-14): SignPath DECLINED** (use case
  too small, not enough users). Installers stay unsigned; the pre-staged
  pipeline in `release-mimic.yml` + `docs/code-signing.md` stays dormant in
  case another provider ever appears. Original notes:
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
