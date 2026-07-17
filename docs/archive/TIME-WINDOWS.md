# Time-window audit — wolfpack.quest (2026-07-08)

Requested by Uilnayar: find hardcoded timeframes, let users expand/contract
(day/week/30/60/90/expansion/lifetime), assess expensive queries + incomplete
data, and **track which windows get used** so unused ones can be retired.

## Shared infrastructure (shipped)

- `web/lib/timeWindow.ts` — window keys `1d/7d/30d/60d/90d/exp/life`,
  expansion boundaries (Kunark 2024-07-01 · Velious 2025-04-01 · Luclin
  2025-10-01 · PoP 2026-10-01, mirroring the bot's retired ERA_BOUNDARIES),
  `resolveWindow(?w=)`, and `windowCaveat()` (static data-floor notes).
- `web/components/WindowPicker.tsx` — chip row; navigates via `?w=`.
- **Usage telemetry**: every EXPLICIT chip click calls `bump_ui_window(page,
  win)` → `ui_window_usage` (page, win, day, count). Defaults don't count, so
  the table answers "which windows do people reach for".
  Read: `select page, win, sum(count) from ui_window_usage group by 1,2
  order by 3 desc;` — after a month, windows with ~0 picks are candidates to
  drop from that page's `options` list (one-line change).

## Converted pages

| Page | Was | Now | Cost notes | Incomplete-data notes |
|---|---|---|---|---|
| `/leaderboards` | fixed 30d | `?w=` 7d/30d/60d/90d/exp/life (default 30d) | Lifetime top-damage stays cheap: `total_damage` desc index scan + LIMIT 30; the date filter only narrows. Loot spend fetches the view then sums in JS — fine at current sizes. | **Attendance section is view-backed (fixed 30/90) — labeled as such, window doesn't change it.** Loot uses `opendkp_loot_recent` (a *recent* sync view) — long windows under-count; caveat shown. |
| `/parses` | fixed 60d (loot/attendance context), list capped 250 | `?w=` 7d/30d/60d/90d/exp/life (default 60d) | Encounter list keeps `LIMIT 250` under every window, so lifetime can't blow up the page — it shows the *newest* 250. Loot/attendance context follows the window. | Capture-start caveat on exp/life (parses exist since agents began uploading + opt-in backfills). Loot view is recent-window (same caveat as above). |
| `/pvp` | lifetime (no window) | `?w=` 7d/30d/90d/exp/life (default life — unchanged behavior) | Kills/assists are `.in(roster)` + `killed_at` filters with 20k caps — fine. | None: PvP broadcasts are public server events, no member data floor. Boss-timer section keeps its functional 90d lookback (spawn windows expire anyway — not user-facing history). |

## Identified but NOT converted (and why)

| Location | Window | Decision |
|---|---|---|
| `/me` (`loadCharStats`, scrap RPC) | 30d cards ×2 | Deferred — the 30d is baked into per-character card semantics across a dozen sub-loaders on the heaviest member page. Convert if `ui_window_usage` shows demand elsewhere first. |
| `/parses/[id]` | ±7d same-boss compare | Contextual compare radius, not a history window. Leave. |
| `/pvp` boss timers | 90d | Functional lookback for live spawn windows; longer shows only dead timers. Leave. |
| `/who` | 60d retention | Retention-driven (who_observations keeps latest-only past 60d) — a longer picker would promise data we pruned. Noted on page copy already. |
| `/buffs`, `/raid` | minutes-scale freshness | Live-state windows (online/stale cutoffs), not history. Leave. |
| `/admin/attendance` | 30/60/90 columns | Already multi-window by design (all three at once). Leave. |
| `/admin/members`, `/admin/triggers`, `/admin/anomalies`, `/admin/signups` | 30d / LOOKBACK_DAYS | Officer tools with purpose-built windows; low traffic. Convert on request, not speculatively. |
| `/fun` | full-history counters | Already tuned via RPCs (2026-07-07); "days since" copy is display math, not a window. |

## Expensive-window guardrails (the "should we avoid it?" answer)

- **Never window-expand a JS-side aggregation over an unbounded fetch.** The
  converted pages all keep their LIMIT/`.in()` bounds under lifetime; the
  window only narrows. Anything needing true lifetime AGGREGATES (sums over
  all encounter_players) must go through an indexed RPC like the /fun fixes —
  do not bolt `life` onto a `select *` page.
- **View-backed sections can't outrun their view** (`opendkp_*_recent`,
  `opendkp_attendance_recent`) — label them instead of pretending (done on
  /leaderboards).
- **Retention beats UI**: buff_casts = 7d rolling, who_observations = 60d raw
  then latest-only. Windows past those are lies; `DATA_FLOORS` in
  timeWindow.ts is the single place those truths live.

## /roster (shipped alongside)

Member page: typical raiders by role (Tanks / Healers / Melee DPS / Caster
DPS / Support & CC) → class → sorted by 60d per-tick RA desc (same valid-tick
math as /admin/attendance + OpenDKP). Mains ≥25% RA (`?min=` to tune);
notable alts (≥3 ticks, alt-linked via characters.main_name or Alt rank) in
italics under their class with their main in parens. Fixed 60d window by
definition — not picker-driven.
