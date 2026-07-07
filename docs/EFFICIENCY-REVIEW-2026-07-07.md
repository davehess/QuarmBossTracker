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
