// Parser for the EverQuest in-game map text format, as Brewall's maps (shipped in Zeal's public repo)
// use it, converted to the SERVER frame the rest of the spectator map uses.
//
//   L x1, y1, z1, x2, y2, z2, r, g, b                  a line segment
//   P x, y, z, r, g, b, size, label_text               a labelled point; underscores stand for spaces
//
// FRAME: the files store the NEGATED world x and y (z is as-is), so server = (-file_x, -file_y, z). That
// puts them on the same axes as eqemu_spawn2 and the EQEmu wall layer in slice.ts, and the consumer's
// one (y, x) swap for raid_roster / pipe positions applies to both layers alike. Checked 2026-10-05
// against the EQEmu wall lines of three zones: negating both axes lined 33-78% of the wall midpoints up
// with a map line, versus 13-28% for leaving them alone or swapping the axes (the low end is a
// many-storeyed zone whose walls the art draws sparsely).
//
// The map text is third-party art with no stated licence. It is fetched at runtime, kept in the
// members-only zone_map_lines table and served only behind the Discord-gated sign-in; nothing from it is
// committed to this repo, and this file ships no sample of it.
//
// A file holds lines, labels or both (the base <zone>.txt is lines, <zone>_1.txt labels), so a zone's
// files are parsed together into one layer. Anything that does not parse is skipped, not fatal: the
// files are hand-edited community data and one bad row must not blank a zone.

import type { Bounds } from './slice';

export type BrewallLine = [x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, r: number, g: number, b: number];
export type BrewallLabel = [x: number, y: number, z: number, text: string];
export type BrewallLayer = { lines: BrewallLine[]; labels: BrewallLabel[]; bounds: Bounds };

// Number() would read an empty or blank field as 0, which would turn a garbage row into a line at the origin.
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const num = (s: string): number => (NUM.test(s.trim()) ? Number(s) : NaN);
// Whole units, and never -0 (a negated 0 would otherwise print as "-0" in tests and in the JSON stored).
const int = (v: number): number => Math.round(v) || 0;
const colour = (v: number): number => Math.min(255, Math.max(0, int(v)));
export function parseBrewallMaps(texts: string[]): BrewallLayer {
  const lines: BrewallLine[] = [];
  const labels: BrewallLabel[] = [];
  for (const text of texts) {
    for (const raw of text.split(/\r\n|\r|\n/)) {
      // trimStart also drops the byte-order mark a Windows editor may put at the top of a file.
      const row = raw.trimStart();
      const kind = row[0];
      if (kind !== 'L' && kind !== 'P') continue;
      const f = row.slice(1).split(',');
      if (kind === 'L') {
        if (f.length < 9) continue;
        const v = f.slice(0, 9).map(num);
        if (v.some(Number.isNaN)) continue;
        lines.push([int(-v[0]), int(-v[1]), int(v[2]), int(-v[3]), int(-v[4]), int(v[5]), colour(v[6]), colour(v[7]), colour(v[8])]);
      } else {
        if (f.length < 8) continue;
        const v = f.slice(0, 6).map(num);
        if (v.some(Number.isNaN)) continue;
        // The label is everything after the seventh comma, so a label that itself holds a comma stays whole.
        const label = f.slice(7).join(',').replace(/_/g, ' ').trim();
        if (!label) continue;
        labels.push([int(-v[0]), int(-v[1]), int(v[2]), label]);
      }
    }
  }

  // Bounds of the drawn lines, as Zeal itself scales its map; a zone with labels only falls back to those.
  const pts: [number, number][] = lines.length
    ? lines.flatMap((l): [number, number][] => [[l[0], l[1]], [l[3], l[4]]])
    : labels.map((l): [number, number] => [l[0], l[1]]);
  const bounds: Bounds = pts.length
    ? { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  for (const [x, y] of pts) {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return { lines, labels, bounds };
}
