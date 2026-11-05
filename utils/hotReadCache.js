'use strict';
// Short-TTL, size-bounded read cache for hot database reads (DECISIONS §538: the 2026-11-04 Disk IO exhaustion).
//
// load() resolves to the value to cache, or null/undefined when the read FAILED (utils/supabase.js resolves null on a
// request failure). A failed read never poisons the cache: the last good value is served instead (stale beats empty),
// and when there is none, the caller gets null and decides. Bounded FIFO so a stream of distinct keys cannot grow
// memory without limit.
function createHotReadCache({ ttlMs, max = 500 } = {}) {
  const m = new Map();   // key → { at, value }
  async function get(key, load) {
    const hit = m.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    let v = null;
    try { v = await load(); } catch { v = null; }
    if (v === null || v === undefined) return hit ? hit.value : null;
    if (!m.has(key) && m.size >= max) m.delete(m.keys().next().value);
    m.set(key, { at: Date.now(), value: v });
    return v;
  }
  return { get, bust: (key) => { m.delete(key); }, clear: () => m.clear(), size: () => m.size };
}

// The auctions overlay panel asks "which of these items has this character wishlisted" on every poll. A wishlist
// changes when a member edits it: the bot's own writes (commands/wishlist.js, utils/webWishlist.js) bust the key; a
// write that bypasses the bot shows within the TTL. Key: lowercased character name.
const wishlistPriorities = createHotReadCache({ ttlMs: 60 * 1000, max: 500 });
const bustWishlist = (character) => { if (character) wishlistPriorities.bust(String(character).toLowerCase()); };

module.exports = { createHotReadCache, wishlistPriorities, bustWishlist };
