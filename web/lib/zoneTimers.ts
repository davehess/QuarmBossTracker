// Zone timers on /boards (the guild lead, 2026-10-08: "perhaps post the countdown on /boards"). Some zone events run on a
// window, not a fixed time: the Plane of Tactics boar stampede happens between 40 minutes and 2 hours after the last
// one. The bot keeps the running windows in bot_kv `zone_timer_windows` (it survives a bot restart), written as
//   { windows: [{ window_id, trigger_name, zone, observed_at_ms, min_at_ms, max_at_ms }],
//     cleared: [{ trigger_name, zone, at_ms, reason }] }
// A window is dropped by the bot when its latest time passes unobserved, or when a fresh sighting replaces it; the
// `cleared` note says which, so the page can say "no timer: the last one went unobserved" instead of showing nothing.
// This module only READS that value: a malformed entry is dropped, never thrown on, and no value gives an empty result.

export type ZoneWindow = {
  windowId: string;
  trigger: string;
  zone: string;
  observedAtMs: number;
  minAtMs: number;
  maxAtMs: number;
};
export type ZoneCleared = { trigger: string; zone: string; atMs: number; reason: 'expired' | 'replaced' };
export type ZoneTimers = { windows: ZoneWindow[]; cleared: ZoneCleared[] };
export type WindowStatus = 'waiting' | 'open' | 'overdue';

// Short zone names the bot stores, in the words a raider reads. An unknown zone shows as it was stored.
const ZONE_LABELS: Record<string, string> = {
  potactics: 'Plane of Tactics',
};
export function zoneLabel(zone: string): string {
  return ZONE_LABELS[zone.toLowerCase()] || zone;
}

// What a window IS, in words a raider reads (the guild lead, 2026-10-09: "this requires more description: Boar
// stampede, approximate earliest and latest start timers (observed) and a PQDI link to the piglet"). Keyed on the
// trigger name the bot stores; an unknown trigger shows under its own name with no blurb.
export type EventInfo = { title: string; blurb: string | null; pqdi: { label: string; npcId: number } | null };
const EVENT_RULES: { match: RegExp; info: EventInfo }[] = [
  {
    match: /stampede/i,
    info: {
      title: 'Boar stampede',
      blurb: 'The boars charge through the zone somewhere between 40 minutes and 2 hours after the last one. '
        + 'These are the earliest and latest start times seen so far, not a fixed time.',
      pqdi: { label: 'Stampeding Piglet', npcId: 214303 },
    },
  },
];
export function eventInfo(trigger: string): EventInfo {
  for (const r of EVENT_RULES) if (r.match.test(trigger)) return r.info;
  return { title: trigger, blurb: null, pqdi: null };
}
export const pqdiNpcUrl = (npcId: number): string => `https://www.pqdi.cc/npc/${npcId}`;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const str = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function parseZoneTimers(value: unknown): ZoneTimers {
  const v = (value ?? {}) as { windows?: unknown; cleared?: unknown };
  const windows: ZoneWindow[] = [];
  for (const raw of Array.isArray(v.windows) ? v.windows.slice(0, 40) : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const zone = str(r.zone, 60);
    const trigger = str(r.trigger_name);
    const observedAtMs = num(r.observed_at_ms);
    const minAtMs = num(r.min_at_ms);
    const maxAtMs = num(r.max_at_ms);
    if (!zone || !trigger || observedAtMs == null || minAtMs == null || maxAtMs == null) continue;
    if (maxAtMs < minAtMs) continue;   // a window that ends before it opens is not a window
    windows.push({ windowId: str(r.window_id, 80) || `${zone}:${trigger}:${observedAtMs}`, trigger, zone, observedAtMs, minAtMs, maxAtMs });
  }
  windows.sort((a, b) => a.minAtMs - b.minAtMs);

  // Newest note per zone + trigger is the only one worth showing.
  const latest = new Map<string, ZoneCleared>();
  for (const raw of Array.isArray(v.cleared) ? v.cleared.slice(0, 40) : []) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const zone = str(r.zone, 60);
    const trigger = str(r.trigger_name);
    const atMs = num(r.at_ms);
    if (!zone || !trigger || atMs == null) continue;
    const reason: ZoneCleared['reason'] = /expire|unobserved/i.test(String(r.reason ?? '')) ? 'expired' : 'replaced';
    const key = `${zone}|${trigger}`;
    const prev = latest.get(key);
    if (!prev || atMs > prev.atMs) latest.set(key, { trigger, zone, atMs, reason });
  }
  return { windows, cleared: [...latest.values()].sort((a, b) => b.atMs - a.atMs) };
}

export function windowStatus(w: Pick<ZoneWindow, 'minAtMs' | 'maxAtMs'>, nowMs: number): WindowStatus {
  if (nowMs < w.minAtMs) return 'waiting';
  if (nowMs <= w.maxAtMs) return 'open';
  return 'overdue';
}

// A cleared note only matters for a zone that has no running window (a running window already replaced it).
export function visibleCleared(t: ZoneTimers): ZoneCleared[] {
  const running = new Set(t.windows.map((w) => `${w.zone}|${w.trigger}`));
  return t.cleared.filter((c) => !running.has(`${c.zone}|${c.trigger}`));
}

export function fmtRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
