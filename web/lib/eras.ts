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
