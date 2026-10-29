// utils/memStats.js — the bot's own memory numbers, for GET /health and one stdout line every 10 minutes.
//
// Why it exists: the bot's memory climbs all day and faster on raid nights (2026-10-28: about +900 MB between
// 20:30 and 21:30 ET), and Railway's graph shows only the container total. A growing total is either real
// retention (heapUsed climbing after garbage collections) or V8 not bothering to collect until it nears its limit
// (heapUsed sawtoothing, rss flat-ish). These numbers tell the two apart: heap_limit_mb is the ceiling V8 picked for
// this container, and heapUsed against it shows how close the process runs.
//
// Cheap on purpose: process.memoryUsage() and v8.getHeapStatistics() are counters, not a heap walk. No snapshot.
// The log line goes to stdout (console.log): Railway shows every stderr line as an error.

const v8 = require('v8');

const MB = 1024 * 1024;
const LOG_EVERY_MS = 10 * 60 * 1000;

const _mb = (bytes) => Math.round(((Number(bytes) || 0) / MB) * 10) / 10;

// `usage` and `heapLimitBytes` are injectable so a test can feed known numbers.
function memSnapshot(usage = process.memoryUsage(), heapLimitBytes = v8.getHeapStatistics().heap_size_limit) {
  return {
    rss_mb: _mb(usage.rss),
    heap_used_mb: _mb(usage.heapUsed),
    heap_total_mb: _mb(usage.heapTotal),
    external_mb: _mb(usage.external),
    array_buffers_mb: _mb(usage.arrayBuffers),
    heap_limit_mb: _mb(heapLimitBytes),
  };
}

function memLogLine(snap = memSnapshot()) {
  return `[mem] rss=${snap.rss_mb}MB heapUsed=${snap.heap_used_mb}MB heapTotal=${snap.heap_total_mb}MB `
    + `external=${snap.external_mb}MB arrayBuffers=${snap.array_buffers_mb}MB heapLimit=${snap.heap_limit_mb}MB`;
}

// One line now (the baseline right after boot), then one every `everyMs`. The timer is unref'd so it never keeps
// the process alive through a graceful shutdown.
function startMemLog(everyMs = LOG_EVERY_MS, log = console.log) {
  const tick = () => { try { log(memLogLine()); } catch { /* a log line must never throw into the event loop */ } };
  tick();
  const timer = setInterval(tick, everyMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { memSnapshot, memLogLine, startMemLog, LOG_EVERY_MS };
