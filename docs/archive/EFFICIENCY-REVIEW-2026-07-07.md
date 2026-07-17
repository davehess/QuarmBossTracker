# Efficiency review — 2026-07-07 (full platform)

Top-to-bottom inefficiency + superfluous-code review of all four components,
prompted by the /fun load regression ("I'm concerned that we need to refactor
and it's leading to degradation"). Four parallel component reviews + prod
query measurements. Findings ranked; ✅ = fixed same day (bot 3.0.141 /
web 1.0.176), the rest are queued.

## Verdict on "do we need to refactor?"

No big-bang refactor. The degradation was NOT architectural rot — it was
**unbounded queries meeting growing tables** plus a couple of outright bugs.
The architecture (agent → bot → Supabase → web) is sound; what's missing are
growth quardrails. Adopt these as review rules for every future change:

1. **Every Supabase select on a streaming table** (chat_messages, buff_casts,
   who_observations, encounter_*, agent_uploads) **must carry a date bound or
   a real limit** — and a limit must be provably above the working set or the
   result is silently wrong (the dirge card was).
2. **Web pages await in parallel** (Promise.all / sections), never chains.
3. **Anything polled by ~20 agents gets a bot-side TTL memo** — the agents'
   own caches multiply, they don't consolidate.
4. **Every module-level Map/array needs a cap or a pruner** at birth.
5. **Per-log-line agent code needs an indexOf pre-filter** before any regex.

## Fixed today ✅

| Fix | Where | Measured |
|---|---|---|
| /fun: ~25 sequential queries → parallel SECTIONS | web/app/fun/page.tsx | load ≈ slowest query instead of the sum |
| /fun Tunare: 2× ILIKE seq scans (284k rows) → `fun_tunare_stats` RPC + `lower(speaker)` index | migration `20260707050000` | 1,513ms×2 → **18ms** |
| /fun dirge: 20k-row jsonb fetch (silently truncated at 28k rows) → `fun_dirge_damage` RPC + 10-min cache | same | MBs of egress → ~0 amortized; now counts ALL rows |
| Bot `loadState()` re-read+parse of whole state.json per call (who-lookup: ×80/request, event-loop blocking) → mtime-memoized | utils/state.js | one parse per write instead of per read |
| **Bug**: agents poll `GET /api/agent/character-live-state` (8s cadence) — route never existed; cross-client MT HP/buffs silently never worked | index.js (new handler + 4s cache) | kills the 404 hammer, makes MT HP real |
| raid-buff-queue fetched EVERY character's buffs jsonb per poll (no time bound; its own filter discards >15min rows) → bounded to 15min | index.js | full-table → live-raiders-only |

## Remaining — HIGH

- **Bot: no server-side memo on the two hottest handler bundles.**
  `raid-buff-queue` (4 guild-wide selects) and `extended-target` (2) are
  identical across ~20 polling agents (~1 bundle/2s each). A 1–2s module
  memo cuts Supabase egress ~20×. (index.js ~7312, ~6833)
- **Mimic: `melody.html` polls the FULL `/api/state` + rebuilds innerHTML
  every 150ms** (~6.6 req/s). Decouple fetch (≥600ms) from paint like
  chchain/triggers already do.
- **Mimic: no byte-stability guard on any overlay** — full innerHTML
  parse/layout/paint per tick even when nothing changed (worst at 150ms
  melody/chchain). The agent dashboard's morphInto pattern is the model.
- **Agent: ~35 detectors run per log line before `shouldKeep`**, and the
  ~17-parser fun-event block runs with no indexOf guard (and is copy-pasted
  ×3: live/backfill/--since). One shared cheap pre-filter skips nearly all
  of it on ordinary melee lines. (agent ~20084–20404, 16293–16683)
- **Agent: the `zeal.ini` "60s cache" in `_zealExportOnCampState` is dead** —
  cache vars are function-local to `_serializeForDashboard`, so every 2s
  dashboard poll does existsSync+readFileSync+regex per EQ dir. Hoist to
  module scope. (agent ~6993)

## Remaining — MEDIUM

- Web `/who`: drains the whole `who_directory` view in sequential 1000-row
  pages (~9 round trips) and ships all ~8.8k rows to the client component.
- Web: `auth.getUser()` runs 3× per navigation (middleware + layout + page)
  — each a network call; layout also re-queries `isOfficer` every render.
- Web `/character/[name]`: `.limit(10000)` encounter fetch for one character
  (renders top-30); `/character/[name]/quests` fetches the ENTIRE guild
  `character_inventory`; `/parses` pulls `opendkp_ticks` `.range(0,99999)`.
- Web: 4th copy of the household/family walk (me, me/ui page, me/ui actions,
  character-family) — extract one lib.
- Bot: `raid-buff-queue` re-fetches the `characters` catalog uncached per
  poll (duplicate of the 10-min `_rosterNameSet` cache); shaman burst path
  runs a 5000-row encounter join per poll (cacheable 15–30s).
- Mimic: 3 separate `tasklist` spawners (5s main.js poll + 15s zealPipe +
  on-demand) ≈ 16 process spawns/min at idle — unify + slow down.
- Mimic: 10 overlay renderer processes created eagerly at boot regardless of
  config; hidden overlays keep their Chromium processes forever.
- Mimic: `agent.log` appends with NO rotation (churns hard in the zeal
  connect/drop loop); `_pollBlindState` fetches the full state blob at 1Hz
  unconditionally.
- Agent: `_pollRelayFires` (recent-fires) polls every 1.5s 24/7 with no
  EQ-running/log-activity gate — the largest standing network cost.
- Agent: duplicated per-line work — `noteSelfCast` + `relaySelfCastForCasting`
  run the IDENTICAL regex back-to-back; the `[ts] body` split is re-run by
  4+ parsers per line.
- Agent: `whoData` / `confirmedPlayers` grow unbounded per session.
- Supabase growth (was 280MB total on 2026-06-04; now chat_messages 138MB +
  buff_casts 118MB + who_observations 102MB alone): the `agent_uploads`
  heartbeat prune from the old backlog is still unshipped; buff_casts needs
  a retention window too (its consumers read ≤3h back!).

## Remaining — LOW / superfluous list

- Deprecated era-thread routing still executes per chat message
  (`getChatThreadId` in `_handleAgentChat`) and `commands/initerathreads.js`
  still registers as a slash command — both are CLAUDE.md-deprecated; delete.
- Agent `_isOwnGuildInstanceEcho` returns false unconditionally — delete the
  two dead call sites + comments (behavior already shipped in bot 3.0.136).
- Web `/planner` + `/loadouts` are stubs only linked from /admin; `/test-server`
  renders a static document force-dynamically. Mark static / retire.
- Slow-changing force-dynamic pages that could take `revalidate`: /leaderboards,
  /boards, /pop, /fun/lord-of-ire, /character/[name]/factions.
- Mimic: dead preload wrappers (`overlayResizePreset`, `overlayEnsureMinHeight`),
  ~14× duplicated overlay chrome boilerplate (extract one shared script),
  duplicated Discord-link flow in loading/settings.
- Bot: `_mobInfoCache`/`_npcDropsCache`/`_extMobLastSeen` set-only growth
  (bounded in practice by catalog size — add caps when touched).

## Suggested burn-down order

1. Bot hot-handler memo + buff-queue characters-catalog cache (one sitting).
2. Agent tail-loop pre-filters + dead zeal.ini cache + relay-fires gate
   (beta; biggest raid-time CPU win on player machines).
3. Mimic melody/byte-stability + tasklist unification + agent.log rotation
   (beta; idle CPU + disk).
4. Web /who + auth-dedup + revalidate sweep (main).
5. Supabase retention: agent_uploads + buff_casts prune job.
6. Superfluous deletions (era threads, dead helpers, stubs) — anytime.

## Status ledger — 2026-07-09 (cleanup round 3)

Verified in-code + against prod sizes. ✅ = shipped, ⏳ = still open.

**Shipped (rounds 1–3):**
- ✅ Order items 1–2 and most of 3: hot-handler memos + shaman-burst cache
  (bot 3.0.144), agent pre-filters + relay-fires gate + melody decouple +
  byte-stability + agent.log rotation (Mimic 1.6.0). tasklist polls slowed
  (10s/25s) but not unified.
- ✅ Retention (order item 5, superseded specifics): `agent_uploads` no longer
  exists (RPC stat-bump replaced it); `buff_casts` 7d sweep (bot 3.0.142);
  `who_observations` identity-preserving prune + nightly sweep (bot 3.0.145);
  **`encounter_threat_snapshots`** — the NEW top grower (351MB/411k rows in a
  month; real growth ~78MB/wk vs the ~7MB/wk the 120d default was budgeted
  on) — retention 120→30d + `thin_threat_snapshots()` midnight downsample
  (>7d → 1/min per uploader+boss); one-time purge applied, 411k → 208k rows
  (bot 3.0.156).
- ✅ Web /who: one round trip via `who_directory_json()` jsonb_agg RPC (was ~9
  sequential range pages); auth dedup: `isOfficer` React-cache()'d + singleton
  client, `lib/session.ts` `getSessionUser()` (layout adopted; pages migrate
  opportunistically); quests page inventory fetch scoped to the family (was
  whole-guild, silently truncating at 10k) (web 1.0.195).
- ✅ Deletions: era-thread routing + `/initerathreads` (bot 3.0.144);
  `_isOwnGuildInstanceEcho` no-op + dead call sites, duplicate self-cast
  regex (noteSelfCast now feeds the relay), dead preload wrappers
  `overlayResizePreset`/`overlayEnsureMinHeight` (agent 3.3.14). Agent
  `whoData`/`confirmedPlayers` now capped; bot `_extMobLastSeen` pruned;
  `_mobInfoCache`/`_npcDropsCache` capped (bot 3.0.156).

**Still open (next rounds):**
- ⏳ Web revalidate sweep: /leaderboards, /boards, /pop, /fun/lord-of-ire,
  /character/[name]/factions are still force-dynamic (verify no cookie use
  per page before switching).
- ⏳ Web family/household-walk extraction (still copy-pasted ×3: me,
  me/ui page, me/ui actions; lib/character-family.ts is a different concept).
- ⏳ Web heavy fetches: /character/[name] `.limit(10000)` encounters (renders
  top-30 — wants an aggregate RPC); /parses `opendkp_ticks .range(0,99999)`.
- ⏳ Web /planner + /loadouts stubs (retire or build); /test-server is now a
  real page — its force-dynamic is justified, drop from this list.
- ⏳ Mimic: unify the 3 tasklist spawners; lazy overlay renderer creation
  (10 Chromium processes eager at boot regardless of config).
- ✅ Disk reclaim (done 2026-07-09, off-raid window): one-off `VACUUM FULL`
  on the three purge-bloated tables returned ~367MB —
  encounter_threat_snapshots 352→161MB, buff_casts 120→26MB,
  who_observations 100→18MB. Total DB now 570MB. Not a recurring job: the
  retention sweeps now delete small daily increments that plain autovacuum
  recycles in place.
