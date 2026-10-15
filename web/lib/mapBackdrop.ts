// The 2D map's background choice (none / lines / parchment) and the keys that cache the parchment layer. Pure
// (no React, no DOM), shared by the replay board, the parchment store and the tests.
//
// URL: `?bg=none|lines|parchment`. Parchment is the default and is left OUT of the URL, so a link only carries
// the choice when someone moved off it; unrelated params are kept.

export type Bg = 'none' | 'lines' | 'parchment';
export const BGS: readonly Bg[] = ['none', 'lines', 'parchment'];
export const DEFAULT_BG: Bg = 'parchment';

export function parseBg(search: string): Bg {
  const v = new URLSearchParams(search).get('bg');
  return (BGS as readonly string[]).includes(v ?? '') ? (v as Bg) : DEFAULT_BG;
}

/** The query string with `bg` set (or removed, for the default). With its `?`, or '' when nothing is left. */
export function bgSearch(bg: Bg, current = ''): string {
  const q = new URLSearchParams(current);
  q.delete('bg');
  if (bg !== DEFAULT_BG) q.set('bg', bg);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// The parchment raster covers the whole zone, so its resolution is a size bucket, not the view: a few steps,
// picked from the pane's CSS size with no devicePixelRatio in it (a soft wash gains nothing from device pixels,
// and a phone at 3x would otherwise ask for the biggest bucket). A pane that resizes inside a bucket keeps its
// raster; only crossing a bucket redraws.
export const RASTER_BUCKETS: readonly number[] = [768, 1024, 1536, 2048];
const BUCKET_HEADROOM = 1.25;

export function rasterBucket(w: number, h: number): number {
  const need = Math.max(w, h, 1) * BUCKET_HEADROOM;
  for (const b of RASTER_BUCKETS) if (need <= b) return b;
  return RASTER_BUCKETS[RASTER_BUCKETS.length - 1];
}

export const parchmentKey = (zone: string, bucket: number) => `${zone}|${bucket}`;

/**
 * Sets `key` as the newest entry of `m` and drops the oldest past `max`. Returns the evicted keys so the caller can
 * release what they held. A Map iterates in insertion order, so deleting and re-setting is "touch".
 */
export function lruSet<V>(m: Map<string, V>, key: string, value: V, max: number): string[] {
  m.delete(key);
  m.set(key, value);
  const out: string[] = [];
  while (m.size > max) {
    const oldest = m.keys().next().value as string;
    m.delete(oldest);
    out.push(oldest);
  }
  return out;
}

/** Ink for the wall lines on parchment: dark brown, `alpha` for the bright and dim passes. */
export const inkColor = (alpha: number) => `rgba(58, 40, 24, ${alpha})`;
