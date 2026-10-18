// utils/ipLimiter.js — in-memory fixed-window counter per IP (pure: no I/O, no Discord, no Supabase).
//
// The bot is one Railway replica, so a Map is the right store. Two instances are used: one for ALL requests per IP
// (index.js, top of the createServer callback) and one for failed-auth lookups per IP (utils/mimicLink.js).
//
//   hit(ip, limit?)    count one event; { limited, count, retryAfterSec, tripped }. `tripped` is true on exactly
//                      the first event over the limit in a window, so a caller can log once.
//   isOver(ip, limit?) read-only: has this IP already USED its `limit` events in the current window (so the next
//                      one should be refused)? Counts only what hit() recorded.
//
// A per-call `limit` lets the owner re-read a tuning knob on every request without rebuilding the limiter.
// limit <= 0 means unlimited. The tracked-IP map is hard-capped (maxIps): when full, expired windows are swept
// first, then the oldest entry is dropped, so a spray of spoofed addresses can never grow it without bound.
function createIpLimiter({ max, windowMs = 60_000, maxIps = 50_000, cleanupMs = 60_000, now = Date.now } = {}) {
  const book = new Map();   // ip → { start, count }

  function sweep() {
    const t = now();
    for (const [ip, e] of book) if (t - e.start >= windowMs) book.delete(ip);
  }

  function _entry(ip, t) {
    let e = book.get(ip);
    if (e && t - e.start < windowMs) return e;
    if (e) book.delete(ip);
    if (book.size >= maxIps) {
      sweep();
      while (book.size >= maxIps) book.delete(book.keys().next().value);
    }
    e = { start: t, count: 0 };
    book.set(ip, e);
    return e;
  }

  function hit(ip, limit = max) {
    const t = now();
    const e = _entry(ip, t);
    e.count++;
    const limited = limit > 0 && e.count > limit;
    return {
      limited,
      count: e.count,
      tripped: limited && e.count === limit + 1,
      retryAfterSec: Math.max(1, Math.ceil((e.start + windowMs - t) / 1000)),
    };
  }

  function isOver(ip, limit = max) {
    if (!(limit > 0)) return false;
    const e = book.get(ip);
    return !!e && now() - e.start < windowMs && e.count >= limit;
  }

  let timer = null;
  if (cleanupMs > 0) {
    timer = setInterval(sweep, cleanupMs);
    if (timer.unref) timer.unref();
  }

  return {
    hit, isOver, sweep,
    get size() { return book.size; },
    stop() { if (timer) clearInterval(timer); timer = null; },
  };
}

module.exports = { createIpLimiter };
