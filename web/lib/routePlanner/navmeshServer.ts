// Route planner: the server's half of the walkable map. Server-only (node:zlib). Fetches Quarm's navmesh for a zone from
// EQMacEmu/Maps (GPL-derived, like the EQEmu walls), slims it (navmesh.ts) and compresses it for the wire. Nothing is
// stored: the route holds the answer in this process for a few zones and Next keeps the download for a day.
import { brotliCompressSync, constants, gzipSync, inflateSync } from 'node:zlib';
import { isZoneShort } from '../zoneMap/source';
import { parseNavInner, readNavHeader, slimNav } from './navmesh';

// EQMacEmu/Maps' default branch is `master`, the .nav files sit at the repo root (not in a nav/ folder).
export const NAVMESH_BASE = 'https://raw.githubusercontent.com/EQMacEmu/Maps/master';
export const navmeshUrl = (zone: string): string => {
  if (!isZoneShort(zone)) throw new Error('bad zone short name');
  return `${NAVMESH_BASE}/${zone}.nav`;
};

const FETCH_TIMEOUT_MS = 8000;
/** The biggest Quarm navmesh is about 2 MB (the Tower of Solusek Ro); anything past this is not one. */
const MAX_NAV_BYTES = 16 * 1024 * 1024;
const MAX_INFLATED_BYTES = 128 * 1024 * 1024;

export type SlimNav = { slim: Uint8Array; source: number };

/** The zone's slim navmesh, or null when Quarm has none for it. A source that cannot be read THROWS (never "no mesh"). */
export async function fetchSlimNav(zone: string, get: typeof fetch = fetch): Promise<SlimNav | null> {
  const res = await get(navmeshUrl(zone), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), next: { revalidate: 86400 } } as RequestInit);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`EQMacEmu/Maps answered ${res.status}`);
  const file = new Uint8Array(await res.arrayBuffer());
  if (file.length > MAX_NAV_BYTES) throw new Error('navmesh too large');
  const h = readNavHeader(file);
  const inner = inflateSync(file.subarray(h.offset, h.offset + h.dataSize), { maxOutputLength: MAX_INFLATED_BYTES });
  return { slim: slimNav(parseNavInner(inner)), source: file.length };
}

export type Encoding = 'br' | 'gzip' | 'identity';

/** What the browser said it can read: brotli, else gzip, else the bytes as they are. */
export function pickEncoding(acceptEncoding: string | null): Encoding {
  const ok = new Set<string>();
  for (const tok of (acceptEncoding ?? '').toLowerCase().split(',')) {
    const [name, ...params] = tok.split(';').map(s => s.trim());
    const q = params.map(p => /^q=([0-9.]+)$/.exec(p)).find(Boolean);
    if (name && !(q && Number(q[1]) === 0)) ok.add(name);
  }
  return ok.has('br') ? 'br' : ok.has('gzip') ? 'gzip' : 'identity';
}

/**
 * Compress for the wire. Brotli at quality 9: the Tower's 3.5 MB goes to about 0.7 MB in under a second; quality 11
 * reaches 0.57 MB but takes 12 s, which a function that has to answer inside 10 s cannot spend.
 */
export function encodeSlim(slim: Uint8Array, enc: Encoding): Uint8Array {
  if (enc === 'br') {
    return brotliCompressSync(slim, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: slim.length } });
  }
  if (enc === 'gzip') return gzipSync(slim, { level: 9 });
  return slim;
}
