# STATUS — the one place to see where everything stands

*Consolidated 2026-07-17 (EST). This replaces the tangle of overlapping queue
docs (BACKLOG, CONTINUATION_QUEUE, the platform-queue, the old roadmaps). If you
want to know **what's done, what's still TODO, what we abandoned, and what was
folly** — it's here.*

## How to read this (three layers, no more)

1. **Live working queue** — the durable, ordered plan is
   [`DESIGN-platform-queue.md`](./DESIGN-platform-queue.md) (the post-audit
   waves + agreed execution order). The fine-grained active checklist is the
   session **task board** (#1-96), which mirrors whatever wave is in flight.
2. **This doc (`STATUS.md`)** — the durable big-picture ledger + the map of
   every doc in `docs/`. Point new sessions here first.
3. **`archive/`** — retired docs, kept verbatim (nothing deleted). Everything
   they held that's still live has been lifted into the ledger below.

> **Rule for future sessions:** don't start a new queue file. Open TODOs go on
> the task board and, if durable, into the ledger here. Deep designs get their
> own `DESIGN-*.md` and a row in the Document Map.

---

## Document map — what every file in `docs/` is for

### Living reference (keep — actively relied on)
| File | What it is | Why it stays |
|---|---|---|
| `DESIGN-platform-queue.md` | The post-audit wave plan + agreed execution order | **The live queue.** |
| `BETA-TESTING.md` | Test plan for features in the beta channel (versions + ✅ solo / 👥 multi-person cases) | **Where to verify beta work.** |
| `DESIGN-buff-debuff-queue.md` | Design spec for the raid buff/debuff/cure queue overlay | CLAUDE.md roadmap ref; feature is live but spec still guides changes |
| `DESIGN-ch-chain.md` | Design spec for the CH-rotation overlay | CLAUDE.md roadmap ref |
| `DESIGN-quarmy-gear.md` | Build spec for Quarmy gear/AA/spell import to character pages | Unbuilt — still the spec |
| `mimic-1.4-roadmap.md` | **Active Mimic beta queue** (overlay layout sync, UI-Studio UX, trigger onboarding) | Real open work; see ledger |
| `raid-hub-roadmap.md` | `/raid` hub design; Stages 1-2 shipped, Stages 3-5 open | CLAUDE.md roadmap ref; open TODOs in ledger |
| `beta-releases.md` | Beta-channel mechanics (electron-updater, cutting beta/stable) | Evergreen process reference (dated "current state" block is stale, harmless) |
| `HOW-ITS-BUILT.md` | Long-form "how each feature actually works" companion to CLAUDE.md | Living companion doc |
| `MIMIC.md` / `MIMIC_AGENT.md` | Mimic vision + the Electron/self-updating-agent rearchitecture assessment | CLAUDE.md roadmap refs |
| `PRIVACY.md` | Source-of-truth privacy statement, mirrored to the web page | Load-bearing (CLAUDE.md) |
| `eqemu-catalog-cheatsheet.md` | Load-bearing conventions for the `eqemu_*` mirror + gear/spells pages | Load-bearing (CLAUDE.md) |
| `zeal-pipe-protocol.md` | Full field reference for the Zeal named-pipe protocol | Load-bearing spec |
| `zeal-spawn-id-request.md` | Drafted upstream ask to Zeal for `spawn_id` on the gauges | Load-bearing (CLAUDE.md); the fix for same-name mob ambiguity |
| `code-signing.md` | Pre-staged (OFF) Windows signing pipeline + flip-on checklist | CLAUDE.md (CLOSED 2026-07-14, kept for if a provider appears) |
| `opendkp-capture-playbook.md` | OpenDKP endpoint-capture playbook | CLAUDE.md ref; reusable for future captures |
| `eq-legends-formats.md` | EQ Legends client config-format spec | Future-build spec |
| `bazaar-filter-pack.md` | Bazaar search presets + tradable watchlists (Luclin) | Standalone reference |
| `pop-raids-local.md` | Local-session playbook: capture PoTime slideshow stubs | Actionable pending local task |
| `spell-levels-local.md` | Local-session playbook: fill `spell_level_seed` via PQDI scrape | Actionable; seed still used |
| `pvp-capture-audit.md` | Reusable local runbook for PvP kill/assist recovery (`scripts/pvp-audit.js`) | Diagnostic runbook |

### Archived 2026-07-17 → `archive/` (superseded; live bits lifted into the ledger)
| File | Was | Why archived |
|---|---|---|
| `roadmap.md` | Point-in-time platform retrospective/roadmap | Superseded by this doc + platform-queue; its few live TODOs migrated below |
| `trigger-system-roadmap.md` | Trigger-system design/research history | Foundation shipped; straggler TODOs + the event-engine idea migrated below |
| `EFFICIENCY-REVIEW-2026-07-07.md` | One-time efficiency audit | Most fixes shipped; the ⏳ web/Mimic items migrated below |
| `TIME-WINDOWS.md` | 2026-07-08 hardcoded-timeframe audit | Shared window infra shipped; telemetry query preserved below |
| `mimic-recruitment-copy.md` | One-time Discord recruitment copy | Served its purpose |
| `BACKLOG.md` | The old catch-all queue (~70% shipped history + local-session asks) | Unique live TODOs + "needs local session" asks lifted below; full file retained in `archive/` |
| `CONTINUATION_QUEUE.md` | Older session queue, heavily overlapping BACKLOG | ~70% shipped/duplicated; its 6 unique TODOs lifted below |

---

## The work ledger

### ✅ Done — major shipped features (not exhaustive; see git + roadmapData.ts)
- **Overlays**: DPS/Tank HUD, Extended Target (+ glide animation), Command
  Center, Charm & Pet trackers, Mob Info, Buff/Debuff queue, CH-chain,
  per-character overlay position + opacity (B-2), auto-arrange, theme picker.
- **Raid hub `/raid`**: structured view, color tiers, raid-leader badge,
  buffer mode, Mob Info overlay, RaidHelper sign-up sync (data side).
- **Agent/data backbone**: character live-state, cross-client HP, buff
  landings, charm/pet timers, Quarmy AA parser, `/who` web directory, PvP
  assist credit (`pvp_assists`).
- **Triggers**: trigger→Discord pipe, real voice audio broadcast, gauge
  conditions.
- **Platform mechanics**: redeploy-free agent manifest (`AGENT_RELEASE_REF`),
  beta/stable channels, remote overlay tuning + mid-raid load-shed, Mimic Mail.
- **Efficiency pass (2026-07-07/09)**: hot-handler memos, agent pre-filters,
  retention trims (buff_casts 7d, threat 30d, who prune), web single-RPC /who,
  VACUUM FULL reclaim.
- **Scale safeguards, in progress (2026-07-17)**: reporter-election chat pilot
  (bot 3.0.196 + agent 3.3.74 beta, #72) — see `BETA-TESTING.md`. Chunk-0
  hotfixes: auth 503-not-401 data-loss fix (bot 3.0.197); `{s}` triggers match
  backtick names (agent 3.3.75 beta). *Note:* the buff_casts 409-storm P0 the
  audit flagged was already fixed in prod (`insertIgnoreDuplicates`).
  - **P1b done (2026-07-18, bot 3.0.206 + agent 3.3.81 beta)**: buff-landing
    election — coverage-ranked, 3 reporters/zone. Bot tallies distinct
    (spell,target) landings per uploader over a 10-min window and elects the top
    3 per heartbeat-zone; agent honors `roles.buffs` in the buff_casts path,
    `is_charm_spell` rows exempt (always upload). Gated behind `dedup_buffs`
    (default OFF) on `/admin/overlays`; fail-open everywhere.
  - **P1c + strays + camp-out done (2026-07-18, bot 3.0.207 + agent 3.3.82
    beta)**: **#72 election work complete.** (1) **Roster election** — 1 reporter
    per RAID GROUP (`_electRosterReporters`), partitioned by the `group_num` the
    agent already sends in its heartbeat (derived from the Zeal raid pipe for its
    primary); unknown group → own singleton (always elected). Agent honors
    `roles.roster` in the raid-roster upload path. Gated behind `dedup_roster`
    (default OFF). **Write-path (2.1):** ingest is now a plain per-uploader upsert
    (was DELETE+upsert) — one round trip, departed rows age out via the readers'
    existing 15-min `captured_at` window + a daily midnight prune. (2) **Stray
    endpoints:** `buff-lag-report` (diagnostic) now rides `roles.buffs`
    agent-side (local snappy-mode unaffected); `debuff-clear` deliberately LEFT
    UNGATED (per-actor control action — gating would drop a non-elected clicker's
    "✓ cured" feedback). (3) **Camp-out early handoff** — agent detects `/camp`
    (`/prepare your camp/i`), sets `camping`, fires an immediate heartbeat; bot
    demotes camping agents from every election unless they're the sole live
    candidate in scope (`_dropCampers`, fail-open), starting handoff ~30s before
    the TTL. Fail-open throughout; per-observer streams untouched (no roles).
- **#73 admission control + Supabase resilience — CORE done (2026-07-18, bot
  3.0.208 + agent 3.3.85 beta).** Four pieces landed:
  1. **Per-uploader × per-kind ingest budgets** (`_overBudget`, index.js) on the
     hot `/api/agent/*` surface, keyed by session-token hash (IP fallback),
     60s windows. Defaults sized generously from the audit (a healthy agent
     never trips). Tunable via the SAME 60s overlay-tuning map as `flag_shed_*`:
     `budget_<kind>_per_min` (default per kind; `0`=unlimited),
     `budget_enforce_<kind>=1` (durable kinds: log-only → real 429+Retry-After),
     `flag_disable_budgets=1` (kill switch). **Fleet-safe defaults:** durable
     kinds (encounter/chat/historical_chat/buff_casts/bosskill/lockout/rolls) →
     **log-only** (no 429 until an officer opts in); ephemeral/redundant kinds
     (live_state/casting/threat_snapshot/raid_roster) → **200-ack-and-drop**
     over budget (the shed pattern); `recent_fires` GET → 429. One log line per
     uploader per window. Defaults per kind (per-min): encounter 120, chat 120,
     historical_chat 120, buff_casts 240, bosskill 30, lockout 30, rolls 60,
     live_state 240, casting 240, threat_snapshot 120, raid_roster 90,
     recent_fires 240.
  2. **Supabase timeout + circuit breaker** (`utils/supabase.js`): `_request`
     now carries a ~10s AbortController timeout (a brownout resolves null, not a
     zombie await) + a consecutive-failure breaker (open after N, cooldown,
     single half-open probe). Timeout/network/5xx trip it; 4xx counts as
     reachable. null/[] contract unchanged. Knobs are ENV (not tuning — they
     guard the tuning store): `SUPABASE_REQUEST_TIMEOUT_MS` (10000),
     `SUPABASE_BREAKER_THRESHOLD` (5), `SUPABASE_BREAKER_COOLDOWN_MS` (30000).
     State on `GET /health`.
  3. **`target-buffs` GET cache** — 2s per-target in-memory cache, mirroring
     `character-live-state`; it was the only hot GET hitting Supabase per
     request. (`target-casts` needs none — it reads the in-memory relay.)
  4. **Poison hardening** — buff_casts `cast_at` and chat `ts` now
     sanitize-and-skip an unparseable date instead of throwing a 500 (which a
     5xx-retrying agent re-posted forever). encounter/live-state/casting were
     already defended. **Agent 3.3.85 beta**: honor 429 `Retry-After` in the
     durable queue (429 was already retryable — not in `QUEUE_PERMANENT_CODES` —
     so no data was ever lost; the fix makes backoff precise and excludes 429
     from poison-parking).
  - **DEFERRED (a later agent — explicitly NOT in this run):** the six-GET-loop
    consolidation / long-poll, and encounter-burst flattening (~90MB/kill at 60).
    See DESIGN-platform-queue.md #73 (Wave-2 addendum).
- **#74 control plane COMPLETE + #58 zero-downtime deploys DONE (2026-07-18, bot
  3.0.209 + web 1.0.240 on main; agent 3.3.86 + Mimic LKG on beta 1.9.6).** Built
  on the reporter election + budgets + breaker + `GET /health` already shipped:
  1. **Full `flag_shed_<kind>` coverage (#74 Part 1, bot).** The 200-ack-and-drop
     load-shed now covers every sheddable ingest kind — the original four
     (`live_state`/`raid_roster`/`casting`/`threat_snapshot`) PLUS `buff_casts`,
     `pvp`, `pvp_assists` (the /who-harvest rides these two — no separate who
     endpoint), `fun_event`, `trigger_relay`, `ui_layout`, `tells`. **Deliberate
     exceptions, NEVER sheddable** (`_SHED_NEVER`): `encounter`, `chat`,
     `bosskill`, `lockout`, `historical_chat` — `_isShedded` refuses them even if
     the flag is set (documented at the shed map; enforced by
     `test/shed-exceptions.test.js`). Web toggles added for every new shed kind.
  2. **`flag_agent_kill` + `min_agent_ver_num` (#74 Part 2, bot main + agent
     beta).** Served on BOTH the reporter-poll (20s primary) and guild-trigger
     (2min backup) responses. `flag_agent_kill=1` → fleet dormancy: agents stop
     all uploads + non-control polls, HOLD the durable queue (nothing dropped),
     keep only the heartbeat, banner "⏸ Agent paused by guild control plane";
     overlays keep working on local data; clearing resumes within one heartbeat.
     `min_agent_ver_num=<n>` → agents whose numeric version (`major*10000+minor*100
     +patch`, 3.3.85 → 30385) is below the floor stand down + show an update nudge.
     Both are labeled controls in the `/admin/overlays` 🛑 Kill switches section
     (kill = scary checkbox, floor = number input, empty = unset; merge-preserving
     save intact). **Fail-open everywhere** (missing/unparseable = no effect; the
     agent only stands down on a FRESH reading — bot down = runs normally after a
     5-min TTL). **⚠ These are POLICY semantics — conservative v1, Hitya to sign
     off.**
  3. **LKG crash-loop auto-rollback (#74 Part 3, Mimic beta).** Before any agent
     hot-swap Mimic snapshots the working agent to `index.lkg.js` + `package.lkg.json`
     in the userData agent dir. If the swapped-in child exits ≥3× within 2 min
     (crash-loop right after a swap), Mimic restores LKG, relaunches from it, sets
     a tray/dashboard "reverted to last-known-good" notice, and BLACKLISTS the bad
     version (won't re-offer it until a strictly newer build ships). Crash-loop
     with no recent swap keeps the existing exponential backoff + surfaces a
     diagnostic notice (no infinite tight restart). One log line per transition;
     blacklist decision covered by `test/lkg-blacklist.test.js`.
  4. **Per-channel manifest → beta hot-swaps (#74 Part 4, bot main + Mimic beta).**
     `GET /api/agent/latest-version?channel=beta` resolves a per-channel ref
     (`AGENT_RELEASE_REF_BETA` env, default the `beta` branch, live-overridable via
     the `agent_release_ref_beta` tuning key) and serves that file+sha. Beta Mimic
     builds (detected by the `-` prerelease suffix) now hot-swap along the beta
     line instead of waiting for a full electron-updater installer. Safe ONLY
     because the kill switch (Part 2) + LKG rollback (Part 3) are the four-gate
     safeguards for an auto-hot-swappable beta.
  5. **#58 Railway zero-downtime (main).** `railway.toml` healthcheck moved from
     `/` to the readiness-gated `/health`, which returns 503 until the Discord
     client is ready + state loaded (`_botReady`, set in ClientReady) and 503
     again once a graceful shutdown begins. Graceful SIGTERM/SIGINT drain: stop
     accepting new HTTP work (503, `Connection: close`), `server.close()`, give
     in-flight handlers ~10s (`SHUTDOWN_DRAIN_MS`) to finish, `client.destroy()`,
     exit. **Config + drain is our half; full overlap/zero-downtime also needs the
     Railway plan's overlap feature.** Watch-paths unchanged (bot deploys stay
     decoupled from web pushes). Tests: version-floor comparator + shed exception
     list + LKG blacklist (`test/version-floor.test.js` mirror,
     `test/shed-exceptions.test.js` source-slice, `test/lkg-blacklist.test.js`).
- **Callout trifecta, in progress (2026-07-17, #76)** — the "why TTS never
  fires" fixes: triggers evaluate before the privacy/combat filter so
  ENRAGED/snare/mez/fizzle templates fire (agent 3.3.76 beta, 9/17 dead
  templates); trigger relay seeds a monotonic id base so a bot deploy no longer
  makes the fleet relay-deaf for hours (bot 3.0.198). Deferred: ✕-mutes-TTS
  overlay decouple (#97, since shipped in the 1.9 line).
- **#76 remainder (callout trust infra) DONE + #103 CH GO (2026-07-18, agent
  3.3.83 beta + web 1.0.238)** — the trifecta closed the fire-path bugs; this
  closes the trust gap. (1) **Trigger checkpoint journal** — in-memory ring
  buffer (cap 250, no disk/upload) records how far each candidate evaluation got
  (line seen → matched → gates → actions → dispatched → relayed) + why it
  stopped; dashboard Triggers-tab card (`renderTriggerJournal`, own
  `#wpTriggerJournal` placeholder, no `<details>`). (2) **Real REHEARSE** — the
  ▶ Test button now `_rehearseTrigger`: synthesizes a matching line
  (`_synthesizeMatchingLine`, verified against the real regex) and drives the
  ACTUAL pipeline (pattern/cooldown/charm-suppression EVALUATED + reported but
  NOT enforced/consumed), speaks real TTS, `test=true` so no relay/upload/Discord
  and no `_fireLog` pollution; gauge triggers rehearse the action tail, journal
  "pattern not exercised (gauge condition)". (3) **Sticky callouts** — optional
  per-trigger/per-action `sticky` pins the trigger overlay until click/~5min;
  portable, backward-compatible, rides the relay via the action object (no bot
  change); officer checkbox on `/admin/triggers`. (4) **Ghost-callout TTL** — a
  relayed fire >15s old at consumption is journalled `stale-skipped`, never
  spoken (fail-open on missing ts); bot relay already carried `fired_at_ms`
  end-to-end, so NO bot change was needed. (5) **#103 CH chain "0X GO"**
  (guild-lead ask) — when the chain reaches a watched character's slot the agent
  speaks "0N GO" via `_pushOverlay` (the trigger pipeline — master
  `enableTriggerTts` still gates it); dedicated 📣 toggle on the CH chain overlay
  (default ON, localStorage + `POST /api/chchain/go-tts`, self-heals via the
  snapshot's echoed `go_tts`), debounced once per rotation pass. Verified:
  `node --check` + `check:dashboard` + 18/18 runtime smoke assertions. See
  `BETA-TESTING.md` for the raid-verify plan.
- **#105 richer fight timeline DONE (2026-07-18, agent 3.3.84 beta + web
  1.0.239)** — three new event types on the #98 `/parses/[id]` timeline, guild-
  lead ask. All ride the existing `noteTimelineEvent` → `timeline_events` →
  `encounter_events` path (bot ingest is generic over kind/subtype — NO bot
  change). (1) **slow_on / slow_off** — a known slow (data-driven `SLOW_SPELLS`
  named list: shaman Drowsy/Walking Sleep/Tagar's/Togor's/Turgur's/Cripple,
  enchanter Languid Pace/Shiftless/Tepid/Forlorn Deeds; the agent spell catalog
  carries no SPA-11 attack-speed marker so a list is the data-driven path)
  landing on the CURRENT fight target emits `slow_on` (hooked at the two
  `recordTargetBuffLanding` call sites via `EncounterBuilder.noteSlowLanding`,
  self-cast attributes the caster, bystander leaves it null); the estimated
  expiry (era-cap caster level, `_durTicksForLevel`) emits `slow_off` at flush
  IFF it fell inside the fight window — a slow still up at the kill emits
  nothing; a re-slow refreshes the window. (2) **mob_heal** — the Zeal target-
  gauge HP% rising for the SAME target name across two `/api/zeal-state` frames
  (`_noteMobHealFromState` → the observing char's live builder's `noteMobHeal`);
  guardrails: identical gauge name required, prior HP > 0 (a rise off 0% is a
  new same-name spawn), ≥5pp rise, ≥10s per-target debounce, target must match
  the fight (`_fightTargetMatches`). Same-name babysit fights can false-positive
  — accepted + documented at the source. (3) **disc** — discipline emotes via
  a data-driven `DISC_LINES` table hooked in `noteRaidLine`; the four grounded
  "fighting style" stance discs shipped (Defensive verified in-repo, Evasive/
  Precision/Aggressive share the server grammar), third-person + self both
  attributed; non-stance discs (Fortitude/Furious/Mighty Strike/Weapon Shield/
  Holyforge/Sanctification/Whirlwind) are a one-row addition once exact emote
  text is confirmed. Web: `FightTimeline.tsx` colors ticks by subtype (gold/
  amber slow pair, green heal, purple disc; enrage/rampage stay orange) + a
  present-only legend; `parses/[id]/page.tsx` now passes `subtype` through
  (read-side 3s dedup already keys on it). Verified: agent `node --check` +
  `check:dashboard` + a 12/12 runtime smoke script; main `lint` + `test` +
  `check:dashboard` + web `tsc --noEmit` green. See `BETA-TESTING.md`.
- **1.9 beta line → stable (2026-07-18, #89)**: graduated Mimic **1.9.5** /
  agent **3.3.80** to the stable channel by file-checkout of `apps/mimic` +
  `packages/wolfpack-logsync` onto `main` (never a whole-branch merge); beta
  re-parked at **1.9.6** above stable. Maiden run of the redeploy-free
  pipeline. Carries the healing overlays, seconds-fast restarts + 🛟 settings
  backups, officer loot capture + DKP ticks, ↩ revert-to-stable, faster
  (10→2min) + backtick-safe `{s}` triggers, ✕-decoupled-from-TTS (#97), and the
  fleet tank/Command-Center blanking fix (`_mtLiveStateByName`, on beta since
  3.3.73). The #72 / #76 / `{s}` beta items in `BETA-TESTING.md` graduate with
  it. Also upgraded the two MIRROR vitest suites (`trigger-class`,
  `timeline-events`) to source-slices now that the real functions ship on main.

- **Supabase RPC lockdown (2026-07-18)**: closed the advisor's SECURITY DEFINER
  hole — 10 SEC-DEFINER RPCs (11 signatures incl. `bump_agent_upload_stat` ×2)
  were EXECUTE-able by `anon`/`authenticated` via `/rest/v1/rpc/*`, worst being
  `prune_who_observations` (an anon-callable *data-deletion* vector). Migration
  `20260718040000` revokes EXECUTE from PUBLIC + anon + authenticated on all,
  grants `service_role` explicitly (bot + web already call these only as
  service_role), adds `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE … FROM PUBLIC`
  so new functions don't reopen it, and flips the 2 SEC-DEFINER views
  (`who_directory`, `opendkp_loot_recent`) to `security_invoker = on`. Advisor
  now clean on all 19 fn warnings + both view ERRORs. **Follow-ups (next entry):**
  mutable-search_path WARN ×23 (done) + leaked-password protection (dashboard);
  RLS-no-policy INFOs still deferred (out of scope).
- **Supabase search_path pin (2026-07-18)**: pinned `SET search_path = public` on
  all 23 `function_search_path_mutable` WARN functions (migration `20260718043553`).
  Bodies reference only public tables (mostly unqualified) + pg_catalog built-ins,
  none hit the `extensions` schema, so `public` is the safe pin (NOT `''`, which
  would break unqualified refs). Advisor re-run now clean of every fn WARN;
  smoke-tested `eq_class_bit`/`character_missing_spells`/`turnins_by_id`/
  `item_card_info`/`who_directory_json` still resolve their tables (write RPCs
  verified by static body inspection — not executed against prod).
  **⚠ Pending dashboard action (Hitya):** enable Auth leaked-password protection
  (HaveIBeenPwned check) — Dashboard → Authentication → password settings. No
  MCP/SQL toggle exists; it's an Auth config flip.

### ⏳ Open TODO — carried forward from the retired docs
*(These are durable items; the active wave order is in `DESIGN-platform-queue.md`.)*
- **Mimic beta queue** (`mimic-1.4-roadmap.md`, still live): sync overlay
  layout to `/me` (#5, now unblocked since B-2 shipped); Trigger-Alerts↔Triggers
  onboarding (#2); UI-Studio overlay-positioning UX (#3); UI-Studio per-char
  launch + previews (#6).
- **`/raid` hub Stages 3-5** (`raid-hub-roadmap.md`): raid-leader→Discord
  interactive ARI button; RaidHelper diff **display** on `/raid` (Stage 5);
  Feral Avatar queue + mass-buff cooldown (Stage 3); per-buff cast attribution
  + timer; DKP auction-winner highlight + "Add as looter" (Stage 4); group-buff
  regrouping suggestions; buff-slot request from own row; Discord name→mention
  in summaries.
- **Efficiency ⏳** (`EFFICIENCY-REVIEW`): web revalidate sweep
  (/leaderboards, /boards, /pop, /fun/lord-of-ire, factions); family/household
  walk extraction (×3 dup); heavy fetches (/character `.limit(10000)`, /parses
  `range(0,99999)`); `/planner` + `/loadouts` — build or retire the stubs;
  Mimic unify 3 tasklist spawners + lazy overlay renderer creation.
- **PvP** (`pvp-capture-audit.md`): relax the unguilded-participant regex
  (currently hard-requires `\w+ of <Guild>`) if unguilded PvP still matters.
- **TIME-WINDOWS telemetry (preserved)**: after ~a month, retire unused window
  chips —
  `select page, win, sum(count) from ui_window_usage group by 1,2 order by 3 desc;`
- **From `BACKLOG.md`** (unique, still open): guild bazaar price index; per-class
  name colors on overlays; multi-monitor pretty-place (c) + observed overlay sets
  (b2); wolfpacktag raid-channel capture; stale-log-filename attribution beyond
  chat (encounter/who still filename-keyed); pet buffs (`/pet health`); base
  stats v1 + bind location from `/charinfo`; "Set up for me" Mimic first-run
  wiring; tank-overlay bot-side heal-amount fallback; bulk re-merge of historical
  `encounter_players` (RPC exists — run gated on owner go); 72-raider scale prep
  (burst mode / replay harness / QPS counters — overlaps board #71-75). Board
  already tracks: #47/#51 same-name segmentation, #52 base stats, #55 mob
  immunity, #56 same-name HP serialization, #65-67 overlay polish.
- **From `CONTINUATION_QUEUE.md`** (unique, still open): ARI Phase-2 auto-handoff
  detection; CothBot labels + parked location; class-signature-counter **display**
  (collection shipped); PoP flagging tracker (greenfield; PoP locked to
  2026-10-01); guided walkthrough tours (overlaps board #86-88); `/me` loot
  per-expansion grouping (needs item→expansion map — UNCERTAIN); local log-browser
  tab in Mimic.

**⚠ Needs a local (desktop) session** — cloud sessions can't reach the local
`peq`/PQDI/EQ machine. Exact queries/files live in `archive/BACKLOG.md`; the asks:
- Mob-immunity backfill from the local `peq` DB (fix B for board #55).
- Zeal exit-crash bundles from `crashes/` (board #64 — `crash_reports` is empty).
- Per-class overlay colors / PoP P2-P3 slideshow stubs (blocked on local capture).
- Any migration needing local verification (per CLAUDE.md Migrations rule).

### 🚫 Abandoned — deliberately dropped or blocked on something external
- **Windows code-signing** — CLOSED 2026-07-14 (SignPath declined; user base too
  small). Installers stay unsigned unless another provider appears. (`code-signing.md`)
- **True mob-distance / ETA "Pull Tracker"** — blocked: needs Zeal position
  telemetry the pipe doesn't emit. Revisit only if Zeal adds it.
- **Historical chat display / era-thread routing** — collection kept, replay
  deliberately not built (CLAUDE.md scope boundary).

### 💀 Folly — built, then pulled
- **CH-neck (Necklace of Resolution) tracker** — built and fully reverted; not
  useful in practice.

### ❓ Uncertain — needs a code-owner to confirm before filing
*(No shipping evidence found, but a negative couldn't be proven exhaustively.)*
- `/me` named-mob kill counts (board #54 covers this) · overlay font-size
  control · tell-back sender-mention in relayed DMs · the unguilded-PvP regex
  status.

---

## Correction the old docs got wrong
`roadmap.md`'s own retrospective **understated progress**: PvP assist credit,
the Extended-Target glide animation, and per-character overlay position+opacity
(B-2) are all **shipped**, not pending. Trust this ledger over the archived
roadmaps.
