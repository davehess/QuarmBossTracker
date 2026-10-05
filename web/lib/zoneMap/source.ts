// Where a zone's map layers come from, and the checks that guard every URL we build for them.
//
// Two layers, both fetched at runtime and cached in zone_map_lines (members-only), never committed:
//   eqemu   — the server collision mesh, https://github.com/EQEmu/maps (GPLv2-or-later), base/<zone>.map
//   brewall — Brewall's EverQuest maps as shipped in Zeal's public repo, coastalredwood/Zeal, under
//             Zeal/zone_map_src/map_files/ (checked 2026-10-05: 358 files covering 180 zones)
//
// The zone name arrives in a query string, so it is validated here before it can reach a URL:
// lowercase letters, digits and underscore only, which cannot carry a path separator, a dot or a
// query. The route ALSO requires the name to exist in eqemu_zone.short_name; this is the cheap half.

// EQEmu/maps' default branch is `master` (checked 2026-10-05; `main` is a 404).
const EQEMU_MAPS_BASE = 'https://raw.githubusercontent.com/EQEmu/maps/master/base';
// Zeal's default branch is `main`.
const ZEAL_MAPS_RAW = 'https://raw.githubusercontent.com/coastalredwood/Zeal/main/Zeal/zone_map_src/map_files';
export const ZEAL_MAPS_LISTING =
  'https://api.github.com/repos/coastalredwood/Zeal/contents/Zeal/zone_map_src/map_files?ref=main';

export const MAP_SOURCES = {
  eqemu: 'EQEmu/maps (GPLv2+)',
  brewall: "Brewall's EverQuest maps via Zeal",
} as const;
// Stored on the cached row for the EQEmu layer. The Brewall layer has no stated licence.
export const MAP_LICENSE = 'GPL-2.0-or-later';

const ZONE_SHORT_RE = /^[a-z0-9_]{2,32}$/;

export function isZoneShort(v: unknown): v is string {
  return typeof v === 'string' && ZONE_SHORT_RE.test(v);
}

export function eqemuMapUrl(zone: string): string {
  if (!isZoneShort(zone)) throw new Error('bad zone short name');
  return `${EQEMU_MAPS_BASE}/${zone}.map`;
}

// Which Zeal map files belong to a zone. Zeal names them <zone>.txt (lines), then <zone>_1.txt
// (labels; the format allows _2 and _3 too). The base file is always lowercase, but the label files
// are not: 112 of 178 keep a mixed-case name from their source (`FieldOfBone_1.txt`), and raw GitHub is
// case-sensitive, so the real names have to come from the directory listing.
//
// `listing` is the directory's file names, or null when it could not be read. The names in it are a
// third party's text, so only those that are exactly this zone's name, case-insensitively, with an
// optional _<n> and .txt survive: that shape cannot carry anything into the URL. Without a listing the
// best guess is the lowercase and the capitalised spelling, which misses the other mixed-case names;
// the caller must not treat a guessed result as complete.
export function brewallFileNames(zone: string, listing: string[] | null): string[] {
  if (!isZoneShort(zone)) throw new Error('bad zone short name');
  if (!listing) return [`${zone}.txt`, `${zone}_1.txt`, `${zone[0].toUpperCase()}${zone.slice(1)}_1.txt`];
  const own = new RegExp(`^${zone}(_[0-9]{1,2})?\\.txt$`, 'i');
  return listing.filter(n => typeof n === 'string' && own.test(n)).sort().slice(0, 6);
}

export function brewallFileUrl(fileName: string): string {
  if (!/^[A-Za-z0-9_]{2,40}\.txt$/.test(fileName)) throw new Error('bad map file name');
  return `${ZEAL_MAPS_RAW}/${fileName}`;
}
