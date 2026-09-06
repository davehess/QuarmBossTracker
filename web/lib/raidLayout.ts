// web/lib/raidLayout.ts — which attendance layout a member sees.
//
// Hitya, 2026-09-04, after the A/B/C side-by-side on b.wolfpack.quest: "I like
// blocks and strips, let's keep both as options, default to strips." So two
// layouts stay, chosen per browser and remembered in a cookie — the same shape
// the timezone picker uses (wp_tz) — with a `?layout=` query override so a
// link can carry the choice. The mini-calendar variant was dropped.
//
// Client-safe: no next/headers here. The server pages read the cookie
// themselves and hand the value in; RaidLayoutPicker writes it.

export type RaidLayout = 'strips' | 'blocks';

export const RAID_LAYOUT_COOKIE = 'wp_raid_layout';
export const DEFAULT_RAID_LAYOUT: RaidLayout = 'strips';
export const RAID_LAYOUTS: { key: RaidLayout; label: string }[] = [
  { key: 'strips', label: 'Strips' },
  { key: 'blocks', label: 'Blocks' },
];

const isLayout = (v: unknown): v is RaidLayout => v === 'strips' || v === 'blocks';

/** Query beats cookie beats default; anything unrecognised is ignored. */
export function pickRaidLayout(query?: string | null, cookie?: string | null): RaidLayout {
  if (isLayout(query)) return query;
  if (isLayout(cookie)) return cookie;
  return DEFAULT_RAID_LAYOUT;
}
