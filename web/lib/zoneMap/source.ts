// Where a zone's collision mesh comes from, and the one check that guards the URL we build.
//
// The map is fetched from GitHub raw by a zone name that arrives in a query string, so the name
// is validated here before it can reach a URL: lowercase letters, digits and underscore only,
// which cannot carry a path separator, a dot or a query. The route ALSO requires the name to
// exist in eqemu_zone.short_name; this is the cheap half that runs first.

// EQEmu/maps' default branch is `master` (checked 2026-10-05; `main` is a 404).
const EQEMU_MAPS_BASE = 'https://raw.githubusercontent.com/EQEmu/maps/master/base';

export const MAP_SOURCE_LABEL = 'EQEmu/maps (GPLv2+)';
export const MAP_LICENSE = 'GPL-2.0-or-later';

const ZONE_SHORT_RE = /^[a-z0-9_]{2,32}$/;

export function isZoneShort(v: unknown): v is string {
  return typeof v === 'string' && ZONE_SHORT_RE.test(v);
}

export function eqemuMapUrl(zone: string): string {
  if (!isZoneShort(zone)) throw new Error('bad zone short name');
  return `${EQEMU_MAPS_BASE}/${zone}.map`;
}
