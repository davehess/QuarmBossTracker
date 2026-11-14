// Pure helpers for the /boards "next up" views (design lab draft boards-next-up, staged at /boards?v=a).
// Maps the page's bot_boards rows to the small shape the views take, and holds the sorting and counting rules, so
// the same rules run on the real page and in the lab and can be unit-tested without a browser.

export const SOON_MS = 30 * 60 * 1000; // the bot pings at this point too

export type BoardRowIn = {
  boss_id: string;
  name: string | null;
  zone: string | null;
  expansion: string | null;
  timer_hours: number | null;
  pqdi_url: string | null;
  next_spawn: string | null;
};

export type NextUpBoss = {
  id: string;
  name: string;
  zone: string;
  expansion: string;
  url: string | null;
  /** epoch ms the window opens; null means no timer is running, so it is up now (same as the live page) */
  opensAtMs: number | null;
  timerHours: number | null;
};

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

export function toNextUpBosses(rows: readonly BoardRowIn[] | null | undefined): NextUpBoss[] {
  const out: NextUpBoss[] = [];
  for (const r of rows ?? []) {
    if (!r || !r.boss_id) continue;
    out.push({
      id: r.boss_id,
      name: r.name || r.boss_id,
      zone: r.zone || 'Unknown zone',
      expansion: r.expansion || 'Unknown',
      url: r.pqdi_url || null,
      opensAtMs: toMs(r.next_spawn),
      timerHours: typeof r.timer_hours === 'number' && Number.isFinite(r.timer_hours) ? r.timer_hours : null,
    });
  }
  return out;
}

export const isUp = (b: NextUpBoss, now: number): boolean => b.opensAtMs === null || b.opensAtMs <= now;
export const isSoon = (b: NextUpBoss, now: number): boolean => !isUp(b, now) && (b.opensAtMs as number) - now < SOON_MS;

const byName = (a: NextUpBoss, b: NextUpBoss): number => a.name.localeCompare(b.name, 'en');

/** Split into bosses with a running timer (soonest first) and available ones (by name). Two new arrays. */
export function splitNextUp(bosses: readonly NextUpBoss[], now: number): { timers: NextUpBoss[]; available: NextUpBoss[] } {
  const timers = bosses.filter((b) => !isUp(b, now)).sort((a, b) => (a.opensAtMs as number) - (b.opensAtMs as number) || byName(a, b));
  const available = bosses.filter((b) => isUp(b, now)).sort(byName);
  return { timers, available };
}

/** Running timers first, soonest first; available bosses after, by name. Returns a new array. */
export function sortNextUp(bosses: readonly NextUpBoss[], now: number): NextUpBoss[] {
  const { timers, available } = splitNextUp(bosses, now);
  return [...timers, ...available];
}

export function summarize(bosses: readonly NextUpBoss[], now: number): { total: number; up: number; soon: number } {
  let up = 0, soon = 0;
  for (const b of bosses) { if (isUp(b, now)) up++; else if (isSoon(b, now)) soon++; }
  return { total: bosses.length, up, soon };
}

/** Case-insensitive match on boss or zone name. An empty query matches everything. */
export function matchesQuery(b: NextUpBoss, q: string): boolean {
  const s = q.trim().toLowerCase();
  return !s || b.name.toLowerCase().includes(s) || b.zone.toLowerCase().includes(s);
}

/** The window length for the table: whole days as "7d", otherwise hours ("18h"). */
export function fmtWindow(hours: number | null): string {
  if (hours === null || !(hours > 0)) return 'n/a';
  const h = Math.round(hours);
  return h >= 48 && h % 24 === 0 ? `${h / 24}d` : `${h}h`;
}

/** Group rows by expansion (in the given order, unknown ones dropped) then zone, for the folded sections. */
export function groupExpansions<T extends { expansion: string | null; zone: string | null }>(
  rows: readonly T[], order: readonly string[],
): { expansion: string; zones: { zone: string; bosses: T[] }[] }[] {
  return order.flatMap((expansion) => {
    const list = rows.filter((r) => (r.expansion || 'Unknown') === expansion);
    if (!list.length) return [];
    const byZone = new Map<string, T[]>();
    for (const b of list) { const z = b.zone || 'Unknown zone'; byZone.set(z, [...(byZone.get(z) ?? []), b]); }
    return [{ expansion, zones: [...byZone.entries()].map(([zone, bosses]) => ({ zone, bosses })) }];
  });
}
