// utils/ttlCache.js — a TTL cache with in-flight coalescing, over a Map the caller owns.
//
// Why (the guild lead, 2026-10-16: "log ingestion is WAY over"): Supabase logs every API request, and the
// bot's read caches were all check → await → set. With ~60 agents polling the same bundle every 2-3 s, every
// request that arrived while the first read was still in flight missed the cache and sent the same read
// again. Here the first caller starts the load and stores its PROMISE; everyone who asks for that key
// before it settles awaits the same promise, so a burst is one request however wide it is.
//
// The Map belongs to the caller (a module-level `new Map()`, or a `globalThis` one a test can replace), so
// a test resets a cache by swapping the Map and nothing here holds state of its own.
//
// ⚠ The value is SHARED. Every caller in the TTL window gets the same object back, so a caller that edits it
// edits it for the rest. Copy before you mutate.
//
//   cached(map, key, ttlMs, load, opts?)  → Promise<value>
//     load()          async, called once per key per window
//     opts.shouldCache(value) → false means "answer this burst, but do not keep it" (a failed read that came
//                      back null, say)
//     opts.max        entry cap (default 200); past it, expired entries go first, then everything idle
//
// A load that REJECTS is never cached: the entry is dropped and every waiter sees the rejection, so the
// next caller tries again.

function cached(map, key, ttlMs, load, opts = {}) {
  const hit = map.get(key);
  if (hit) {
    if (hit.pending) return hit.pending;
    if (Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  }
  const entry = { at: 0, value: undefined, pending: null };
  const settle = (keep) => {
    entry.pending = null;
    if (map.get(key) !== entry) return;          // the map was reset or the key reused: not ours to touch
    if (!keep) { map.delete(key); return; }
    entry.at = Date.now();
  };
  entry.pending = (async () => load())().then(
    (value) => {
      const keep = !opts.shouldCache || opts.shouldCache(value);
      entry.value = value;
      settle(keep);
      return value;
    },
    (err) => { settle(false); throw err; },
  );
  map.set(key, entry);
  _trim(map, ttlMs, opts.max || 200);
  return entry.pending;
}

function _trim(map, ttlMs, max) {
  if (map.size <= max) return;
  const now = Date.now();
  for (const [k, e] of map) if (!e.pending && now - e.at >= ttlMs) map.delete(k);
  if (map.size <= max) return;
  for (const [k, e] of map) if (!e.pending) map.delete(k);
}

module.exports = { cached };
