// Shared time-window model for wolfpack.quest (2026-07-08 audit — see
// docs/TIME-WINDOWS.md for the full inventory of hardcoded windows, which
// pages were converted, and the cost/coverage notes per window).
//
// Pages read ?w=<key> and pass the resolved window into their queries.
// The picker (components/WindowPicker.tsx) records every EXPLICIT pick to
// ui_window_usage so rarely-used windows can be retired later.

export type WindowKey = '1d' | '7d' | '30d' | '60d' | '90d' | 'exp' | 'life';

export type ResolvedWindow = {
  key: WindowKey;
  label: string;
  /** ISO lower bound for queries, or null = no bound (lifetime). */
  sinceIso: string | null;
  days: number | null;
};

// Quarm era boundaries (UTC) — mirrors the bot's retired ERA_BOUNDARIES.
// 'exp' = start of the CURRENT expansion at request time.
export const EXPANSION_STARTS: { name: string; startMs: number }[] = [
  { name: 'PoP',     startMs: Date.UTC(2026, 9, 1) },
  { name: 'Luclin',  startMs: Date.UTC(2025, 9, 1) },
  { name: 'Velious', startMs: Date.UTC(2025, 3, 1) },
  { name: 'Kunark',  startMs: Date.UTC(2024, 6, 1) },
  { name: 'Classic', startMs: 0 },
];

export function currentExpansion(nowMs = Date.now()): { name: string; startMs: number } {
  for (const e of EXPANSION_STARTS) if (nowMs >= e.startMs) return e;
  return EXPANSION_STARTS[EXPANSION_STARTS.length - 1];
}

const DAY_WINDOWS: Record<string, { label: string; days: number }> = {
  '1d':  { label: 'Day',     days: 1 },
  '7d':  { label: 'Week',    days: 7 },
  '30d': { label: '30d',     days: 30 },
  '60d': { label: '60d',     days: 60 },
  '90d': { label: '90d',     days: 90 },
};

export const ALL_WINDOWS: WindowKey[] = ['1d', '7d', '30d', '60d', '90d', 'exp', 'life'];

export function resolveWindow(raw: string | undefined, def: WindowKey): ResolvedWindow {
  const key = (raw && (ALL_WINDOWS as string[]).includes(raw) ? raw : def) as WindowKey;
  if (key === 'life') return { key, label: 'Lifetime', sinceIso: null, days: null };
  if (key === 'exp') {
    const e = currentExpansion();
    return { key, label: `${e.name} era`, sinceIso: new Date(e.startMs).toISOString(), days: null };
  }
  const d = DAY_WINDOWS[key];
  return { key, label: d.label, sinceIso: new Date(Date.now() - d.days * 86400_000).toISOString(), days: d.days };
}

// Known data floors — shown as a caveat chip when the selected window can see
// past what we actually have. Static on purpose: computing min(ts) per page
// per request is exactly the kind of scan the audit is trying to avoid.
export const DATA_FLOORS: Record<string, { sinceLabel: string; note: string }> = {
  parses:  { sinceLabel: 'spring 2026', note: 'Parses exist since agents began uploading (plus opt-in log backfills) — Expansion/Lifetime cannot see farther back than capture.' },
  pvp:     { sinceLabel: 'May 2026',    note: 'PvP broadcasts are captured since the agent PvP relay shipped; earlier kills exist only where logs were backfilled.' },
  loot:    { sinceLabel: 'recent sync', note: 'Loot rows come from the OpenDKP recent-loot sync window — long windows may under-count old purchases.' },
  me:      { sinceLabel: 'spring 2026', note: 'Personal stats respect your data floor (when you joined) and capture start.' },
  who:     { sinceLabel: '60 days raw', note: '/who history older than 60 days keeps each character’s latest sighting only.' },
  buffs:   { sinceLabel: '7 days',      note: 'Buff-landing history is pruned to a rolling 7 days.' },
};

export function windowCaveat(page: keyof typeof DATA_FLOORS, w: ResolvedWindow): string | null {
  const floor = DATA_FLOORS[page];
  if (!floor) return null;
  // Caveat only when the user asked for more history than we can promise.
  if (w.key === 'exp' || w.key === 'life' || (w.days != null && w.days > 60)) return floor.note;
  return null;
}
