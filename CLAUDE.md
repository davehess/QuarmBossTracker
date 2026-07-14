# Wolf Pack EQ Platform — Claude Code Handoff

A guild platform for Wolf Pack on Project Quarm (EverQuest emu), grown from a
Discord raid-timer bot into four independently-versioned components in one
monorepo. This file is the authoritative architectural map; `README.md` is the
user-facing setup guide + command reference. When they conflict, this file wins.

| Component | Path | Runs on | Ships from |
|---|---|---|---|
| **Bot** (Discord + HTTP API) | `/` (`index.js`, ~8k lines) | Railway, auto-deploys on push to `main` | `main` |
| **Web** (`wolfpack.quest`) | `web/` (Next.js 14) | Vercel, auto-deploys on push to `main` | `main` |
| **Agent** (`wolfpack-logsync`) | `packages/wolfpack-logsync/` (single-file Node, zero deps) | End-user machines — bundled inside Mimic, or standalone via `Parser.bat` | bundled with Mimic; CLI zip via `release-parser.yml` |
| **Mimic** (Electron desktop) | `apps/mimic/` | End-user Windows machines, auto-updates via electron-updater | `release-mimic.yml` on version bump (`main` = stable channel, `beta` = beta channel) |

**Versions live in each component's `package.json` — nowhere else.** Do NOT
maintain version numbers in this file or in README.md. (We used to keep a
version table here; it caused repeated merge conflicts between `main` and
`beta` and drifted constantly. `git log --oneline -5` + the four package.json
files are the source of truth.)

Other fixed facts: Node 20, discord.js v14, Supabase project
`zhtoekwakucbckvatfky`, guild `DISCORD_GUILD_ID=1168893924329402420`.

---

## Release playbook

### Branches
- **`main`** — production. Bot (Railway), web (Vercel), and *stable* Mimic
  releases ship from here. Always green.
- **`beta`** — Mimic beta channel. `release-mimic.yml` builds a prerelease
  whenever `apps/mimic/package.json`'s version changes on this branch.
  Because the agent is *bundled inside* Mimic, agent fixes that beta users
  need must land on `beta` (and bump Mimic) — they do NOT reach beta users
  via `main`.
- **Working branches** (`claude/*`) — branch off `main`, merge back with a
  versioned `-m` message.

### Routing a change
| Change touches | Push to | Bump |
|---|---|---|
| Bot (`index.js`, `commands/`, `utils/`) | `main` | root `package.json` (+ a `CHANGELOGS` entry in `utils/onboarding.js` — drives `/onboarding` "what's new"; skip if nothing user-facing) |
| Web (`web/`) | `main` | `web/package.json` |
| Agent, for beta users | `beta` | `packages/wolfpack-logsync/package.json` only. Since 2026-07-08 ANY beta push touching `apps/mimic/**` or `packages/wolfpack-logsync/**` builds; do NOT bump Mimic per iteration |
| Mimic | `beta` (or `main` to cut stable) | `apps/mimic/package.json` stays PARKED at the line's target — the workflow auto-increments the `-beta.N` tag per push (v1.7.2-beta.1, -beta.2, …). Bump only when opening a new line or cutting stable on `main`. **After cutting a stable, immediately re-park beta at the NEXT patch** (stable 1.7.1 → beta parks at 1.7.2): a park at/below the stable would tag prereleases that semver-sort BELOW it, and the updater would stop offering new betas (Uilnayar 2026-07-09) |
| Supabase migration | `main` (file) + apply | see Migrations below |
| Docs only | `main` | none |

Patch bump by default. Commit message convention: `<component> vX.Y.Z — short
reason` (Railway shows the merge commit message as the deploy name — never
merge with `--no-edit`). When one change spans bot + agent, land the bot part
on `main` and the agent part on `beta` as two commits; cherry-pick or
file-checkout between branches rather than merging whole branches (the beta
branch must never promote stale bot/web files to `main`). Graduating a Mimic
beta to stable: merge the Mimic/agent state to `main` with a stable version.

**Every release updates the roadmap** (Uilnayar 2026-07-08). Add/extend a
`releases[]` entry at the TOP of `web/lib/roadmapData.ts` (newest first) for
any user-facing change — bot, web, agent, or Mimic. Each entry: the version
pill (`Web 1.0.x · Bot 3.0.y`, add a `beta` channel flag for beta-only), a
one-line headline, the headline features as SIMPLIFIED plain-language bullets,
and the **bug fixes at the bottom**. This is what a raider reads (mirrors the
`/onboarding` CHANGELOGS in tone) — keep it human, not a git log. Bump
`web/package.json` for the roadmap edit like any web change.

### Raid-night deploy freeze (Uilnayar 2026-07-13)
**Never push to `main` during a raid window: Sun/Wed/Thu 19:30 ET → 00:30 ET.**
Any main push restarts production surfaces the raid depends on (and mid-raid
restarts are what amplified the 2026-07-13 queue backup + announcer spam).
Beta pushes are fine (Mimic updates are pull-based). If something is broken
*during* the raid and the fix must ship now, include `[hotfix]` in the commit
message — that's also the escape hatch for the `raid-freeze.yml` tripwire
(advisory red X; Railway/Vercel deploy on push regardless). Stage everything
else on a working branch and land it after midnight ET.

### Migrations
Timestamped `YYYYMMDDHHMMSS_description.sql` in `supabase/migrations/`,
idempotent (`IF NOT EXISTS`). The GitHub integration auto-applies on merge to
`main`. When a change needs the column *now* (agents already sending the new
field), apply via the Supabase MCP `apply_migration` with the same name AND
commit the identical file so repo and prod history stay in sync.

### When git state looks wrong
This environment's local clone can come up with stale refs (it has happened —
"my commits vanished"). Before concluding work was lost or force-pushing
anything: `git fetch origin main beta`, and verify the true branch heads via
the GitHub MCP (`list_commits`) — it queries the real API and is authoritative.
Then rebuild on the true head.

---

## Working across sessions (local desktop ↔ cloud)

Two kinds of Claude sessions work on this platform, and they cannot share a
conversation — they share **the repo, Supabase, and these docs** instead:

- **Local (desktop) sessions** have the machine: `A:\EQ` (live Quarm client,
  Zeal, crash bundles in `crashes/`, character exports, trader `BZR_*.ini`
  price files), `D:\EQServer` (local MariaDB — authoritative `peq` item/NPC
  DB; creds in `eqemu_config.json`), `D:\EQLegends` (modern-client
  reference), and open egress (pqdi.cc, quarm.guide, eqemulator.org).
- **Cloud sessions** get the repo + Supabase MCP, but **no local files** and
  a restrictive egress proxy (eqemulator.org and PQDI are blocked there).

Rules that keep them married:
1. **Durable state lives in committed docs, never chat.** Queue + in-flight
   notes: `docs/BACKLOG.md`. Cross-session handoffs: write a handoff doc and
   commit it (the `*HANDOFF.md` pattern).
2. **Cloud sessions blocked on local-only data**: don't guess — add a
   "needs local session" item to `docs/BACKLOG.md` with the exact query or
   file wanted. A local (or phone-Dispatched) session picks it up.
3. **Local sessions mirror local-only facts into Supabase** so cloud
   sessions can use them. Precedents: `spell_level_seed` (PQDI scrape ran
   locally because the server 403s cloud IPs), the `eqemu_items`
   haste/regen/manaregen/damageshield/attack backfill (555 items from the
   local `peq` DB, 2026-07-11 — the eqmac dump omits those columns, so the
   weekly sync can't overwrite the backfill), `crash_reports` signatures.
4. **Only local sessions run migrations that need local verification**, and
   any session applying via MCP must also commit the identical file (see
   Migrations above).
5. **A stale local checkout hands work over as a zip** (patches + bundle +
   HANDOFF.md); the cloud session cherry-picks/ports onto the TRUE branch
   heads and re-versions — never fast-forward to a bundle from an old base
   (the 2026-07-11 handoff was built on a Jul-2 beta and shipped fine as
   cherry-picks).

---

## Scope boundaries (read before changing related code)

- **Historical chat: collection IS in scope, display is NOT.** Old-log `/gu` +
  `/rs` backfill flows into the `chat_messages` table
  (`POST /api/agent/historical_chat` — kept, not deprecated). We deliberately
  never replay old chat into Discord threads; live chat posts directly without
  era subdivision. Era-thread routing in `_handleAgentChat` and
  `commands/initerathreads.js` are deprecated.
- **PoP expansion locked until `2026-10-01`** via `isPopLocked()` in
  `utils/config.js`. PoP boss buttons return ephemeral lock messages, and the
  automated relays (`/api/agent/bosskill`, `/api/agent/lockout`) skip locked
  bosses too — PVP-event lockouts named for the war gods ("Tallon Zek" /
  "Vallon Zek") name-match Plane of Tactics bosses and used to synthesize
  timers onto the locked board (2026-07-13). A startup sweep clears any timer
  that leaks onto a locked boss. After unlock: run `/board`, refresh
  `pqdiUrl`s via `/addboss`.
- **`encounters.zone_short`**: `eqemu_npc_types.zone_short` is NULL across the
  catalog (sync doesn't pull spawn data). Historical rows were backfilled from
  `data/bosses.json`; `find_or_create_encounter` still doesn't set zone on
  insert — new encounters land NULL until the RPC/call-site passes it.
- **Zeal pipe carries no spawn id — same-name mobs are NOT disambiguable.**
  The named pipe's mob surface is the target (gauge slot 6) + pet (slot 16)
  gauges: display **name + HP per-mille only**, no entity id, level, or loc
  (confirmed against a live 71.5s raw capture — four `an orc warrior` spawns
  were byte-identical). So ≥2 identically-named mobs alive at once can't be
  told apart from the pipe; consumer-side correlation (death-boundary
  segmentation, HP-continuity) only resolves *sequential* same-name kills. Do
  NOT design features that need N≥3 simultaneous same-name identities — the
  data can't support it. The clean fix is upstream: `docs/zeal-spawn-id-request.md`
  is the drafted ask to CoastalRedwood/Zeal to add `spawn_id` to those two gauges.

---

## Bot (`index.js` + `commands/` + `utils/`)

Discord bot + bearer-auth HTTP API (token `WOLFPACK_AGENT_TOKEN`) on `PORT`.
~80 slash commands in `commands/` (full reference: README). Responsibilities:

1. **Raid timers** — instanced boss kill tracking (133 bosses in
   `data/bosses.json`, hot-reloaded), expansion-thread boards, spawn alerts,
   midnight summaries. PvP-server and Plane-of-Hate variants with their own
   timer math (±20% variance, quakes).
2. **Parse aggregation** — agent uploads + manual `/parse` paste merge into
   Supabase `encounters`/`encounter_players` via `find_or_create_encounter`
   (dedup by ±30min window) + `merge_encounter_players` (max-damage-per-player
   across submitters).
3. **Agent API** — the `/api/agent/*` surface below.
4. **DKP/loot/wishlist** (OpenDKP via `utils/opendkp.js`; sealed bids
   AES-256-GCM in `utils/bidCrypto.js`), **roster** (`utils/roster.js`,
   persisted as chunked JSON in Discord threads), **onboarding**, **audit
   trail** (officer Undo buttons), **member sync** (Discord guild →
   `wolfpack_members`, every 6h).

### Discord layout (env-var anchored)
`#raid-mobs` holds four fixed message slots (Active Cooldowns / Spawning in
24h / Daily Summary / thread links) plus one thread per expansion, each with a
cooldown card + zone kill cards + board panels — all edited in place, never
re-posted. Anchor-ID priority everywhere: `process.env.<KEY>` →
`state.channelSlots` → `null`, so anchors survive volume loss. Named threads
(Historic Kills, Parses Log, Onboarding, Hate, Roster ×2, Audit, Feedback,
PvP, Live…) are all env-var IDs — see `.env.example`, which documents every
variable. **Discord is the source of truth** for parses (`PARSES_LOG_THREAD_ID`
reloaded on startup), hate state (hidden JSON embeds), and roster (chunked
messages); `data/state.json` and `data/parses.json` are local mirrors with
atomic writes (`.tmp` + rename). Recovery: `/restore <message links>`,
`/recoverkills` (from Supabase encounters).

### HTTP endpoints (`/api/agent/*`, bearer auth)
Ingest: `encounter` (combat events → parse cards + Supabase), `chat` (live
/gu + /rs relay), `historical_chat` (backfill → `chat_messages`), `pvp` +
`pvp_assists` (kill/death/assist broadcasts + /who harvest), `bosskill`
(instance kills → auto-timers), `lockout` (/sll relay), `live-state` (Zeal
buffs+zone snapshot → `character_live_state`), `raid-roster` (Zeal type-5 →
`raid_roster`), `buff_casts` (observed buff landings; `is_charm_spell` rows
are agent-synthesized charm timers), `casting` (cross-client cast relay),
`tells` (private tell history), `trigger` + `trigger-relay` (trigger fires →
Discord), `fun_event`, `quake`, `ui_layout` (UI Studio backups), `place-bid`.

Query: `latest-version` (agent update prompts), `mob-info` (NPC catalog
stats, 6h cache), `who-lookup` (de-anon from who history), `spell-catalog` +
`item-clickies` (ETag'd catalogs from `eqemu_*`), `target-casts` +
`target-buffs` (who's casting on / what's landed on a target — powers
cross-client Mob Info), `raid-buff-queue` (buff/debuff/cure queues: online
raiders only, same-zone first, tank-HP priority, curse-counter sort),
`guild-triggers` (10-min poll), `backfill-requests`, `character-prefs`
(opt-out flags), `recent-fires`, `threat-snapshot`, `incomplete-encounters`,
`server-panel`.

Payload limits: chat 256KB, encounter 10MB. Returns 503 if
`WOLFPACK_AGENT_TOKEN` unset.

**Mid-raid load-shed:** the ephemeral streams (`casting`, `live-state`,
`threat-snapshot`, `raid-roster`) can be shed live — set `flag_shed_<kind>`
(snake_case, e.g. `flag_shed_live_state`) to `1` in the `/admin/overlays`
tuning editor; the bot 200-acks-and-drops that stream within its 60s tuning
cache, no deploy or agent update. `0`/delete restores. Discord posting is
deferred post-ack in the `encounter`/`chat`/`trigger` handlers (v3.0.166) —
agents never wait on Discord.

### Background jobs
Spawn checker (5 min; also PvP/live/quake checks, stale-alert suppression
post-redeploy), TZ-aware midnight chain (daily summary → archives → parse
consolidation → resets), member sync (6h), chat dedup GC (10s), weekly
eqemu mirror sync (`.github/workflows/sync-quarm.yml`).

---

## Agent (`packages/wolfpack-logsync/index.js`, ~16k lines, zero npm deps)

Tails `eqlog_*_pq.proj.txt`, filters at byte level **before** parse: officer
chat, tells, group, custom channels never leave the machine (`docs/PRIVACY.md`).
Uploads combat events, /who, chat relay, and the streams above. Modes:
`--watch` (default), `--since <ISO>` backfill (boss combat + /who + chat),
`--once`, `--dry-run`. Serves a dashboard on `localhost:7777`.

Key subsystems and their non-obvious rules:

- **Durable upload queue** — every outbound POST persists to
  `logsync.queue.json`; 15s drain, exponential backoff to 10m; 4xx drops as
  permanent. Update gate refuses `[U]`/`POST /api/update` while queue pending,
  backfill running, or a fight is live (`Shift+U` / `?force=1` bypass).
- **Charm pipeline** — `_charmTickTracker` (gauge-driven via Zeal slot 16,
  1.5s debounce on land, 10s grace on re-charm gap), `CHARM_SPELLS` map
  (name → class + duration; EQ logs backtick possessives — keep both
  spellings), `_pendingCharmSpell` staged from BOTH the parseEvent cast path
  AND `noteSelfCast` (the former misses some self-casts). The slot-16
  article-prefix filter (`/^an?\s+/i`) is what distinguishes charm pets from
  summoned pets. The 🐺 Charm diagnostic card (Triggers tab) walks all four
  pipeline checkpoints — point users there before debugging by hand.
- **Buff landings** — `_buffLandingsByTarget` (keyed by target; feeds Mob
  Info) and `_petBuffLandings` (keyed by owner; feeds Charm/Pet trackers).
  Both MUST use the era-cap level fallback (`_assumedCasterLevel()`, 60 → 65
  at PoP) when /who level is unknown — level-formula spells compute 0 ticks
  otherwise and instantly show "fell off". On charm land,
  `_captureTargetBuffsOnCharm` sweeps target-keyed entries into the owner key
  (pre-charm debuffs are the norm — you can't debuff your own pet).
  Linger rules: HoTs and any catalog duration < 60s get one tick (6s);
  everything else gets the 5-min purple "fell off — rebuff" cue.
  Charm spells (Allure etc.) have `cast_on_other = NULL` — no log line
  exists, so `_recordCharmSpellOnTarget` synthesizes the entry and pushes it
  to `buff_casts` with `is_charm_spell` for cross-client visibility.
  `resolveSelfCastLanding` matches landings by `body.endsWith(expected)` —
  never split on first space (multi-word NPC names broke that).
- **Pets on the DPS meter** — the threat tracker's anti-NPC filters (no
  multi-word attackers; nothing in `this.targets`) are bypassed for names the
  agent can prove are OUR pets (`petLeaders` / `_activeCharms` /
  `_charmTickTracker` active). Those rows carry `pet_owner`, which the HUD
  uses to whitelist + label them.
- **Triggers** — guild set polled from the bot + local
  `personal_triggers.json`. `{s}`-style placeholders compile to NAMED capture
  groups, and `_captureMatchesCharmPet` suppresses fires caused by your own
  charm pet. Zeal gauge conditions (`target_hp_pct` etc.) fire without a log
  line.

### ⚠ Dashboard escape hazard — ALWAYS check after editing `WEB_HTML`
The entire agent dashboard (HTML + browser `<script>`) lives in ONE backtick
template literal. Two escape layers apply; one mis-escaped char renders the
whole localhost page blank with an `Uncaught SyntaxError`:
- browser-JS newlines → write `\\n` (a bare `\n` becomes a real newline)
- apostrophes in single-quoted browser strings → write `\\'`
- client-side backslashes → write `\\\\`

We shipped this bug twice. After ANY change to that template run
**`npm run check:dashboard`** (also runs in `release-parser.yml`).

### Dashboard rendering rules
`morphInto`/`setSectionHTML` is plain `innerHTML` with byte-level
change-detection — a section's HTML string must be **byte-stable across polls
when nothing changed**, or the whole section rewrites every 2s (flicker, form
resets, lost scroll). Anything volatile (timestamps via `fmtAgo`, live
counters, gauges) must live in its own `wp*`-id placeholder card filled by a
dedicated render fn (`wpZealCard`, `wpRecentFires`, `wpCharmDiag` are the
pattern). Never put `class="name"` on a cell whose text isn't a character
name — the click delegation slices to the first word and opens
`/character/<token>` (404s for trigger names, ability labels, etc.).
**Every `<details>` the dashboard emits MUST be built as
`'<details ' + wpKeep('stable|unique|key') + ' …>'`** — repaints (including a
PARENT section's repaint, which wipes nested placeholders before their own
render runs) reset a plain `<details>` to closed every poll (the 1.7.0-beta.2
"Zeal pipe closes immediately" bug). wpKeep persists open-state in a
JS-side store fed by a capture-phase `toggle` listener; DOM snapshots taken
inside render fns are NOT safe. `check-agent-dashboard.js` fails the build
on any emitted `<details>` without `wpKeep(` — this rule is enforced, not
advisory.

---

## Mimic (`apps/mimic/`)

Electron shell that bundles the agent + its own Node runtime. `main.js` owns
the tray, the agent child process, and one frameless transparent
always-on-top `BrowserWindow` per overlay; `preload.js` exposes the
`window.mimic` IPC bridge; `zealPipe.js` bridges Zeal's named-pipe stream
into the local agent.

**Field issue (n=1, 2026-06-12):** if Mimic can't detect Zeal at all, the fix
is reinstalling Mimic *outside* the EQ folder. Pipe detection is
path-independent (tasklist → connect by PID), so it's environmental (Mimic's
DLLs shadowing Zeal's DX hook, or AV on the in-game-dir exe), not a code bug —
no fix beyond the workaround. Details in `zealPipe.js` header. Note the friction:
`detectEqDir()` intentionally supports in-EQ-folder installs for *log* detection,
which can steer users into the layout that breaks *Zeal* detection.

Overlays (each an `.html` file): DPS HUD (`overlay.html`, DPS/Tank tabs),
Trigger alerts + countdown timers (`triggers.html`), Charm tracker, Pet
tracker, Mob Info (Stats/Loot/Spells tabs), Buff queue, /who, Melody, Zeal
health (diagnostic), plus Settings, UI Studio, loading.

### Overlay feature-parity checklist
Every overlay must have ALL of these — a whole class of beta bugs was
overlays missing one (dead ✕ on Zeal health, no right-click on Buff queue,
missing Overlays-tab row):
1. ✕ hide button (top-right) + a branch for its window in main.js's
   `hide-overlay` IPC handler (flips the right `cfg.show*` flag);
2. ✥ move button (top-left) with manual-drag IPC (never CSS app-region —
   buggy on transparent windows) **and** a right-click context menu
   (resize presets + Setup THIS/ALL);
3. **hover-interact handshake** (`overlayHoverInteractive(true/false)` on
   mouseenter/leave) on EVERY clickable control — locked overlays are
   click-through (`setIgnoreMouseEvents(true,{forward:true})`), so without
   the handshake clicks fall through to EQ ("the button does nothing");
4. a row in the dashboard's `WP_OVERLAY_ROWS` + its key in
   `wpRefreshOverlayToggles` + a case in the `toggle-overlay` IPC;
5. visibility via its `apply*Visibility()` fn (unlocked override, quiet
   mode, `_eqGateOk` EQ-running gate);
6. its `cfg.show*` flag in main.js's `_HIDEALL_FLAGS` list — the hide-all
   hotkey snapshots/flips exactly that list (the Command Center missed it
   and kept showing through hide-all, 2026-07-10) — and an entry in
   `_overlayEntries()` (drives opacity, backdrops, auto-arrange, hover).

Layout collisions matter: anything at the title bar's right edge sits under
the fixed-position ✕ (the Buff queue class picker hid the overlay on a stray
click — reserve a ~30px right gutter).

---

## Web (`web/` → wolfpack.quest)

Next.js 14 App Router + Supabase Auth (Discord OAuth). Two sign-in gates:
guild membership + role membership (role IDs from `wolfpack_roles`, synced by
the bot). Sessions via HTTP-only cookies refreshed in `middleware.ts`.

Routes: public landing + auth; member surfaces (`/me` — tells, buffs/zone,
characters, stats; `/parses`, `/raid`, `/buffs`, `/who`, `/pvp`, `/boards`,
`/boss`, `/character`, `/leaderboards`, `/loadouts`, `/bards`, `/fun`,
`/feedback`, `/planner`, `/mimic` download); officer `/admin/*` (triggers,
attendance, encounters, agents, members, who, chat, audit, voice, quarmy,
signups, links, feedback).

Pattern note: officer list pages with per-row actions (e.g.
`/admin/triggers`) use a client component with optimistic `useState` +
`useTransition`, server actions in a separate `actions.ts`, and skip
`router.refresh()` after toggles — `revalidatePath` alone keeps other
sessions fresh without re-rendering (and visually flashing) the whole list.

---

## Supabase

Tier 1 `eqemu_*` mirrors (zone/items/npc_types/spells/loot tree/spawn —
weekly sync via `sync-quarm.yml`; `spawn*` and `npc_types.zone_short` are
still empty/NULL upstream). **Before querying `eqemu_*` or touching the
gear/spells/inventory pages, read `docs/eqemu-catalog-cheatsheet.md`** — the
load-bearing conventions (NPC id encodes zone `id=zoneid*1000+n`,
`eqemu_zone.expansion` era codes, spell scrolls = items `Spell: %` with no
level data, the Quarmy-export vs `/output inventory` vs spellbook file split,
the `character_missing_spells` data path) live there so they don't get
re-derived from EXPLAIN plans each time. Tier 2 guild data we write: `characters`,
`bosses_local`, `raid_nights`, `encounters`, `encounter_players`,
`contributions` (with `agent_version` + `has_ability_detail` watermark),
`encounter_combat_rollup`, `loot_drops`, `wishlists` (encrypted bids),
`chat_messages`, `who_observations` (+ `inferred_zek_*` PvP proximity
columns), `character_live_state`, `buff_casts` (+ `is_charm_spell`),
`raid_roster`, `guild_triggers`, `fun_events`, `wolfpack_members`,
`wolfpack_roles`, `audit_log`, plus tells and PvP tables.

RPCs: `find_or_create_encounter(p_guild_id, p_npc_id, p_started_at,
p_duration, p_window_min)` and `merge_encounter_players(p_encounter_id)`.
The find-or-create dedup has a sequential-kill splitter (damage ≥ 0.9×catalog
HP + new start past the matched fight's window → separate encounter) that
additionally requires the matched encounter to be a CONFIRMED kill
(`ended_at` set) — an unconfirmed engagement can't have respawned, so a
dispel/FD reset that full-heals the mob knits into ONE kill instead of two
cards (Lord of Ire, 2026-07-13).
Views: `eqemu_npc_drops`, `item_with_proc`, `character_data_floor`,
`character_rollup_coverage`, `who_directory`.

RLS: Tier 1 readable by `anon`+`authenticated`; guild tables
`authenticated`-only; encrypted bid columns service-role-only; the bot uses
`service_role` and bypasses RLS.

---

## Domain policies (load-bearing — don't re-derive)

**Character identity scopes.** Three different "who is this" questions:
guild *membership* = union of (Discord role `Pack Member`+ via
`characters.discord_id`→`wolfpack_members`) OR (OpenDKP rank `Raid Pack`+).
Roster presence (`utils/roster.js`) is broader; "ever seen"
(`who_observations`) is broadest and only `/whois` uses it. Gap detection
candidates come from the membership predicate, never "every roster name".

**Per-character data floor.** `character_data_floor` view:
`member_since = LEAST(first /gu, first /rs, first OpenDKP tick)` across the
character's *family* (main + alts). PvP data is exempt (no floor). Opt-out
flags on `characters`: `exclude_from_stats`, `exclude_inventory` — consumers
must honor both.

**Combat rollups watermark.** Per-verb totals exist only for uploads at/after
the cutover agent version (`contributions.has_ability_detail`). History is
enriched opt-in by re-running the agent over old logs; `find_or_create_encounter`
dedups so re-submissions attach instead of duplicating.

**Stat visibility scopes.** Every log-derived stat declares `PRIVATE` (owner's
`/me` only) / `ANON` (nameless aggregates) / `GUILD` (named, signed-in
members). Excluded characters never contribute or display.

**Guild trigger shapes.** Default to the portable shape (`text_overlay` +
`tts`, trigger-level `timer_duration_sec`, `warning_seconds/_text`) — fires on
every Mimic version. The `voice` action with `marks` requires the newer agent;
use only for multi-callout sequences. Curse counters for the debuff queue live
in the bot's `_CURSE_COUNTERS` (Gravel Rain 12 … "Word of" 1).

**Chat-extracted historical parses** under-count DoT classes and credit
damage shields to the tank — keep `contributions.raw_parse->source` distinct
(`eqlogparser_send_to_eq` / `local_agent_v1` / `chat_extracted`) so agent data
wins when both exist.

**Raid schedule:** Sun/Wed/Thu 8pm–midnight Eastern — the default window for
any "should have been there" computation.

---

## Roadmap

Live queue + in-flight notes: `docs/BACKLOG.md`. Deeper designs:
`docs/raid-hub-roadmap.md`, `docs/trigger-system-roadmap.md`,
`docs/DESIGN-buff-debuff-queue.md`, `docs/DESIGN-ch-chain.md`,
`docs/MIMIC.md` / `docs/MIMIC_AGENT.md`, `docs/opendkp-capture-playbook.md`,
`docs/code-signing.md` (SignPath, pre-staged off), `docs/PRIVACY.md`.
Headline items parked for later: UI Studio web viewer/editor on `/me/ui` +
automatic UI/eqclient.ini cloud backups; OpenDKP auction wiring (creation
captured, bid/award endpoints not); guild timeline; chat→parse extraction;
spells/tradeskill/faction advisors on `/me`; long-haul storage partitioning.
