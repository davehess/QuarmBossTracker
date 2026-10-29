// test/mem-stats.test.js — the bot's memory numbers on /health and in the logs (utils/memStats.js).
//
// The helpers run for real; the wiring into the monolith is read as comment-stripped source (index.js cannot be
// required without booting the Discord client).
//
// Run: npx vitest run test/mem-stats.test.js

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { stripJs, BOT_INDEX } from './_source-slice.js';

const require_ = createRequire(BOT_INDEX);
const { memSnapshot, memLogLine, startMemLog, LOG_EVERY_MS } = require_('./utils/memStats');

const MB = 1024 * 1024;

describe('memSnapshot', () => {
  it('reports every figure in MB, rounded to one decimal, plus V8\'s heap limit', () => {
    const snap = memSnapshot(
      { rss: 1500 * MB, heapUsed: 700.26 * MB, heapTotal: 900 * MB, external: 55.5 * MB, arrayBuffers: 12.04 * MB },
      2096 * MB,
    );
    expect(snap).toEqual({
      rss_mb: 1500, heap_used_mb: 700.3, heap_total_mb: 900, external_mb: 55.5, array_buffers_mb: 12, heap_limit_mb: 2096,
    });
  });

  it('reads the live process by default: positive numbers, heapUsed under heapTotal, a real heap limit', () => {
    const snap = memSnapshot();
    expect(snap.rss_mb).toBeGreaterThan(0);
    expect(snap.heap_used_mb).toBeGreaterThan(0);
    expect(snap.heap_used_mb).toBeLessThanOrEqual(snap.heap_total_mb);
    expect(snap.heap_limit_mb).toBeGreaterThan(snap.heap_total_mb);
    for (const v of Object.values(snap)) expect(Number.isFinite(v)).toBe(true);
  });

  it('a missing figure is 0, never NaN (JSON.stringify would turn NaN into null)', () => {
    const snap = memSnapshot({ rss: 10 * MB }, null);
    expect(snap.heap_used_mb).toBe(0);
    expect(snap.heap_limit_mb).toBe(0);
  });
});

describe('the log line', () => {
  it('is one line with every figure, tagged [mem]', () => {
    const line = memLogLine({ rss_mb: 1500, heap_used_mb: 700.3, heap_total_mb: 900, external_mb: 55.5, array_buffers_mb: 12, heap_limit_mb: 2096 });
    expect(line).toBe('[mem] rss=1500MB heapUsed=700.3MB heapTotal=900MB external=55.5MB arrayBuffers=12MB heapLimit=2096MB');
    expect(line).not.toMatch(/\n/);
  });
});

describe('startMemLog', () => {
  it('logs once at boot, then once per interval, through the log function it is given (stdout, not stderr)', () => {
    vi.useFakeTimers();
    try {
      const log = vi.fn();
      const timer = startMemLog(LOG_EVERY_MS, log);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/^\[mem\] rss=\d/);
      vi.advanceTimersByTime(LOG_EVERY_MS - 1);
      expect(log).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(log).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(LOG_EVERY_MS * 3);
      expect(log).toHaveBeenCalledTimes(5);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to every 10 minutes, and a throwing log function does not escape the timer', () => {
    expect(LOG_EVERY_MS).toBe(10 * 60 * 1000);
    vi.useFakeTimers();
    try {
      const log = vi.fn(() => { throw new Error('stdout closed'); });
      const timer = startMemLog(1000, log);
      expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never uses stderr: the module has no console.warn / console.error', () => {
    const src = stripJs(fs.readFileSync(new URL('../utils/memStats.js', import.meta.url), 'utf8'));
    expect(src).not.toMatch(/console\.(warn|error)/);
  });

  it('the timer is unref\'d so it cannot hold the process open through a graceful shutdown', () => {
    const timer = startMemLog(LOG_EVERY_MS, () => {});
    expect(timer.hasRef()).toBe(false);
    clearInterval(timer);
  });
});

describe('wiring in index.js', () => {
  const src = stripJs(fs.readFileSync(BOT_INDEX, 'utf8'));

  it('/health returns a mem object built from memSnapshot', () => {
    const health = src.slice(src.indexOf("req.url === '/health'"));
    const body = health.slice(0, health.indexOf('// Default: health check'));
    expect(body).toMatch(/require\('\.\/utils\/memStats'\)\.memSnapshot\(\)/);
    expect(body).toMatch(/supabase_breaker: breaker,[^}]*\bmem\b/);
  });

  it('starts the periodic [mem] log once, right after the HTTP server starts listening', () => {
    expect(src.match(/startMemLog\(/g)).toHaveLength(1);
    expect(src.indexOf('startMemLog(')).toBeGreaterThan(src.indexOf('httpServer.listen('));
  });
});
