// test/zone-timers-web.test.js — the /boards zone-timers panel (beta ?v=b) reads the bot's ledger, bot_kv
// `zone_timer_windows` (utils/zoneTimers.js). web/lib/zoneTimers.ts only READS it: a malformed entry is dropped,
// nothing throws, no value is an empty result.
//
// Run: npx vitest run test/zone-timers-web.test.js

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseZoneTimers, windowStatus, visibleCleared, fmtRemaining, zoneLabel } from '../web/lib/zoneTimers.ts';

const W = { window_id: 'w1', trigger_name: 'Tactics: stampede window opens', zone: 'potactics', observed_at_ms: 1000, min_at_ms: 2000, max_at_ms: 9000 };

describe('parseZoneTimers', () => {
  it('gives an empty result for no value or a wrong shape', () => {
    for (const v of [null, undefined, 42, 'x', [], {}, { windows: 'no', cleared: 7 }]) {
      expect(parseZoneTimers(v)).toEqual({ windows: [], cleared: [] });
    }
  });
  it('keeps a good window and drops the malformed ones', () => {
    const t = parseZoneTimers({ windows: [W, null, 'x', { ...W, zone: '' }, { ...W, min_at_ms: 'soon' }, { ...W, max_at_ms: 1500 }, { ...W, trigger_name: undefined }] });
    expect(t.windows).toHaveLength(1);
    expect(t.windows[0]).toMatchObject({ windowId: 'w1', zone: 'potactics', minAtMs: 2000, maxAtMs: 9000 });
  });
  it('orders windows by when they open', () => {
    const t = parseZoneTimers({ windows: [{ ...W, window_id: 'b', min_at_ms: 5000, max_at_ms: 9000 }, { ...W, window_id: 'a', min_at_ms: 2000 }] });
    expect(t.windows.map((w) => w.windowId)).toEqual(['a', 'b']);
  });
  it('reads the bot reasons: unobserved is expired, a fresh sighting is replaced', () => {
    const t = parseZoneTimers({ cleared: [
      { trigger_name: 'A', zone: 'z1', at_ms: 10, reason: 'expired_unobserved' },
      { trigger_name: 'B', zone: 'z2', at_ms: 20, reason: 'replaced_by_sighting' },
    ] });
    const by = Object.fromEntries(t.cleared.map((c) => [c.trigger, c.reason]));
    expect(by).toEqual({ A: 'expired', B: 'replaced' });
  });
  it('keeps only the newest note per zone and trigger', () => {
    const t = parseZoneTimers({ cleared: [
      { trigger_name: 'A', zone: 'z', at_ms: 10, reason: 'expired_unobserved' },
      { trigger_name: 'A', zone: 'z', at_ms: 30, reason: 'replaced_by_sighting' },
      { trigger_name: 'A', zone: 'z', at_ms: 20, reason: 'expired_unobserved' },
    ] });
    expect(t.cleared).toHaveLength(1);
    expect(t.cleared[0]).toMatchObject({ atMs: 30, reason: 'replaced' });
  });
});

describe('windowStatus', () => {
  it('waits, opens, then goes overdue', () => {
    const w = { minAtMs: 2000, maxAtMs: 9000 };
    expect(windowStatus(w, 1999)).toBe('waiting');
    expect(windowStatus(w, 2000)).toBe('open');
    expect(windowStatus(w, 9000)).toBe('open');
    expect(windowStatus(w, 9001)).toBe('overdue');
  });
});

describe('visibleCleared', () => {
  it('hides a note once a window runs for that zone and trigger', () => {
    const t = parseZoneTimers({ windows: [W], cleared: [
      { trigger_name: W.trigger_name, zone: 'potactics', at_ms: 5, reason: 'replaced_by_sighting' },
      { trigger_name: 'Other', zone: 'potactics', at_ms: 5, reason: 'expired_unobserved' },
    ] });
    expect(visibleCleared(t).map((c) => c.trigger)).toEqual(['Other']);
  });
});

describe('labels and clock', () => {
  it('names the stored short zone and leaves an unknown one as stored', () => {
    expect(zoneLabel('potactics')).toBe('Plane of Tactics');
    expect(zoneLabel('somewhere')).toBe('somewhere');
  });
  it('formats what is left', () => {
    expect(fmtRemaining(-5)).toBe('0s');
    expect(fmtRemaining(42_000)).toBe('42s');
    expect(fmtRemaining(125_000)).toBe('2m 5s');
    expect(fmtRemaining(3_725_000)).toBe('1h 2m 5s');
  });
});

describe('the page', () => {
  const src = readFileSync(new URL('../web/app/boards/page.tsx', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  it('shows the panel only on the ?v=b variant, so production stays as it was', () => {
    expect(src).toMatch(/v === 'b' \? await loadZoneTimers\(\) : null/);
    expect(src).toMatch(/\{zoneTimers && <ZoneTimersPanel/);
  });
  it('reads the ledger key the bot writes', () => {
    expect(src).toMatch(/\.eq\('key', 'zone_timer_windows'\)/);
  });
});
