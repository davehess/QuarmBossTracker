// Shared Quarm expansion timeline. Date ranges are inclusive of start,
// exclusive of end. Adjust here when a new era launches and every page
// that uses them picks up the change automatically.

export const ERAS = [
  { name: 'Classic', start: '2023-10-01T00:00:00Z', end: '2024-07-01T00:00:00Z' },
  { name: 'Kunark',  start: '2024-07-01T00:00:00Z', end: '2025-04-01T00:00:00Z' },
  { name: 'Velious', start: '2025-04-01T00:00:00Z', end: '2025-10-01T00:00:00Z' },
  { name: 'Luclin',  start: '2025-10-01T00:00:00Z', end: '2026-10-01T00:00:00Z' },
  { name: 'PoP',     start: '2026-10-01T00:00:00Z', end: '2099-01-01T00:00:00Z' },
] as const;

export type EraName = typeof ERAS[number]['name'];

export function eraForTimestamp(iso: string | Date | null | undefined): EraName | null {
  if (!iso) return null;
  const t = typeof iso === 'string' ? iso : iso.toISOString();
  for (const e of ERAS) {
    if (t >= e.start && t < e.end) return e.name;
  }
  return null;
}

/**
 * The eras whose raid content we are currently RUNNING.
 *
 * Hitya 2026-08-22, on lockouts: "only the lockouts from current era or
 * night's targets really matter." A lockout on Lady Vox is real and changes
 * nothing about a Sunday in Vex Thal.
 *
 * Two eras, not one: the era below the live one is still on the target
 * rotation — with Luclin live that is Velious, and Sleeper's Tomb is very much
 * a current target. Derived from ERAS above, so it moves on its own when PoP
 * opens on 2026-10-01 (the same date as the bot's POP_UNLOCK_MS) without
 * anyone editing a list.
 */
export function currentEraNames(now: Date = new Date()): EraName[] {
  const t = now.toISOString();
  const i = ERAS.findIndex(e => t >= e.start && t < e.end);
  if (i < 0) return [ERAS[ERAS.length - 1].name];
  return ERAS.slice(Math.max(0, i - 1), i + 1).map(e => e.name);
}

/** True when a boss's expansion label is content we are currently running.
 *  An unknown/missing label is NOT current era — a mis-labelled boss must not
 *  inflate an officer's "act on this" list. */
export function isCurrentEraName(label: string | null | undefined, now?: Date): boolean {
  if (!label) return false;
  return (currentEraNames(now) as string[]).some(n => n.toLowerCase() === label.toLowerCase());
}

export function eraByName(name: string | undefined | null) {
  if (!name) return null;
  return ERAS.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
}

// OpenDKP rank priority (per CLAUDE.md / utils/roster.js). Higher index = lower rank.
// Used to pick the "effective main" in a family — the highest-ranked character.
export const RANK_PRIORITY = [
  'Officer', 'Pack Leader', 'Raid Pack', 'Raid Recruit',
  'Recruit', 'Member', 'Inactive', 'Raid Alt',
] as const;

export function rankIndex(rank: string | null | undefined): number {
  if (!rank) return RANK_PRIORITY.length;
  const i = (RANK_PRIORITY as readonly string[]).indexOf(rank);
  return i === -1 ? RANK_PRIORITY.length : i;
}
