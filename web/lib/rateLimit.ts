// Two tiny in-memory abuse guards for the public share routes (the guild lead, 2026-10-17: "account for abusing
// views of the external sharing links"). Per process, not shared between instances.
//
// ponytail: per instance is the cheap version. Vercel runs several instances, so a determined scripter sees up to
// N times these limits. The upgrade path is one shared counter (an Upstash/Redis INCR with a TTL, or a Supabase
// RPC) behind the same two functions; nothing that calls them would change.

export type LimitResult = { ok: boolean; retryAfter: number };

/** Drops the oldest entries once a map is over its cap. A Map iterates in insertion order. */
function trim<V>(m: Map<string, V>, cap: number, isStale: (v: V) => boolean) {
  if (m.size < cap) return;
  for (const [k, v] of m) if (isStale(v)) m.delete(k);
  while (m.size >= cap) m.delete(m.keys().next().value as string);
}

/** Fixed window: `max` hits per `windowMs` per key, at most `cap` keys remembered. */
export function createLimiter(max: number, windowMs: number, cap = 5000) {
  const hits = new Map<string, { start: number; n: number }>();
  return {
    hit(key: string, now = Date.now()): LimitResult {
      let e = hits.get(key);
      if (!e || now - e.start >= windowMs) {
        hits.delete(key);
        trim(hits, cap, v => now - v.start >= windowMs);
        e = { start: now, n: 0 };
        hits.set(key, e);
      }
      if (e.n >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil((e.start + windowMs - now) / 1000)) };
      e.n++;
      return { ok: true, retryAfter: 0 };
    },
    size: () => hits.size,
  };
}

const BUCKETS = 12;

/** Rolling window: `max` hits per `windowMs` per key (twelve buckets, so an hour is judged in 5-minute steps). */
export function createCeiling(max: number, windowMs = 3_600_000, cap = 2000) {
  const step = windowMs / BUCKETS;
  const seen = new Map<string, Map<number, number>>();
  return {
    hit(key: string, now = Date.now()): LimitResult {
      const b = Math.floor(now / step);
      let e = seen.get(key);
      if (!e) {
        trim(seen, cap, v => ![...v.keys()].some(i => i > b - BUCKETS));
        e = new Map();
        seen.set(key, e);
      }
      let total = 0;
      for (const [i, n] of e) { if (i <= b - BUCKETS) e.delete(i); else total += n; }
      if (total >= max) return { ok: false, retryAfter: Math.max(1, Math.ceil(((Math.min(...e.keys()) + BUCKETS) * step - now) / 1000)) };
      e.set(b, (e.get(b) ?? 0) + 1);
      return { ok: true, retryAfter: 0 };
    },
    size: () => seen.size,
  };
}
