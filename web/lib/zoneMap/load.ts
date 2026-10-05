// Runtime fetchers for the two spectator-map layers. Server-only: the route calls them on a cache
// miss, and what they return is stored in zone_map_lines and never written anywhere else.
//
// Both answer the same way: a layer, or null when the source has nothing for the zone (a 404 / no
// files). Anything else (a timeout, a 5xx, a file we cannot read) THROWS, so the route can tell
// "this zone has no map" from "we could not find out", and cache only the first.
import { parseBrewallMaps, type BrewallLayer } from './brewall';
import { parseEqemuMap, sliceZoneMap, type ZoneSlice } from './slice';
import { brewallFileNames, brewallFileUrl, eqemuMapUrl, ZEAL_MAPS_LISTING } from './source';

const FETCH_TIMEOUT_MS = 8000;
// The biggest Quarm-era EQEmu mesh is a few MB and the biggest Zeal text file well under 1 MB; anything
// past these is not a map.
const MAX_MESH_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

const get = (url: string, headers?: Record<string, string>) =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store', headers });

export async function fetchEqemuLayer(zone: string): Promise<ZoneSlice | null> {
  const res = await get(eqemuMapUrl(zone));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`EQEmu maps answered ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length > MAX_MESH_BYTES) throw new Error('EQEmu map too large');
  const { V, I } = parseEqemuMap(raw);
  return sliceZoneMap(V, I);
}

// The directory listing is the only way to learn the real case of a label file's name (see
// brewallFileNames). It is one unauthenticated GitHub API call, which is rate-limited per address, so a
// good answer is kept for hours and a failed one for a minute, in this process.
let listingMemo: { at: number; names: string[] | null } | null = null;
const LISTING_TTL_MS = 6 * 60 * 60 * 1000;
const LISTING_RETRY_MS = 60 * 1000;

async function zealListing(): Promise<string[] | null> {
  const now = Date.now();
  if (listingMemo && now - listingMemo.at < (listingMemo.names ? LISTING_TTL_MS : LISTING_RETRY_MS)) return listingMemo.names;
  let names: string[] | null = null;
  try {
    const res = await get(ZEAL_MAPS_LISTING, { Accept: 'application/vnd.github+json', 'User-Agent': 'wolfpack-quest' });
    if (res.ok) {
      const body: unknown = await res.json();
      if (Array.isArray(body)) {
        names = body
          .filter((e): e is { name: string } => !!e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string')
          .map(e => e.name);
      }
    }
  } catch { /* leave null: the caller falls back to guessing the names and does not cache the result */ }
  listingMemo = { at: now, names };
  return names;
}

// `complete` is false when the file names had to be guessed, so a layer that may be missing a
// mixed-case label file is served but not cached.
export async function fetchBrewallLayer(zone: string): Promise<{ layer: BrewallLayer | null; complete: boolean }> {
  const listing = await zealListing();
  const names = brewallFileNames(zone, listing);
  const texts = await Promise.all(names.map(async (name) => {
    const res = await get(brewallFileUrl(name));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Zeal maps answered ${res.status} for a map file`);
    const text = await res.text();
    if (text.length > MAX_TEXT_BYTES) throw new Error('Zeal map file too large');
    return text;
  }));
  const found = texts.filter((t): t is string => t !== null);
  if (!found.length) return { layer: null, complete: !!listing };
  const layer = parseBrewallMaps(found);
  return { layer: layer.lines.length || layer.labels.length ? layer : null, complete: !!listing };
}
