// #119 — agent liveness across ALL watched logs. SOURCE-SLICE fidelity tier.
//
// _computeLiveness is what the reporter-poll heartbeat puts in the payload:
//   last_line_ms   — the MIN age across every watched character's tail (any
//                    live log = a live agent), and
//   live_character — the most-recently-active watched char (null when idle).
// It is sliced out of the shipped agent source so edits to the real function are
// exercised here. SELF-CONTAINED: the `beta` branch has no test/_source-slice.js,
// so the slice helper is inlined (same contract as pet-buff-landing.test.js).
//
// Run: npx vitest run test/agent-liveness.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_INDEX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', 'packages', 'wolfpack-logsync', 'index.js',
);
function sliceBlock(src, start, end) {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`source-slice: start not found: ${JSON.stringify(start)}`);
  const e = src.indexOf(end, s);
  if (e < 0) throw new Error(`source-slice: end not found: ${JSON.stringify(end)}`);
  return src.slice(s, e + end.length);
}

const src = fs.readFileSync(AGENT_INDEX, 'utf8');
const block = sliceBlock(
  src,
  'function _computeLiveness(watchedLogs, now, idleMs) {',
  '  return { last_line_ms, live_character };\n}',
);
// eslint-disable-next-line no-new-func
const _computeLiveness = new Function(block + '\nreturn _computeLiveness;')();

const IDLE = 90_000;   // mirrors LIVE_CHARACTER_IDLE_MS

describe('#119 _computeLiveness (source-sliced from agent)', () => {
  it('sliced the real function', () => {
    expect(typeof _computeLiveness).toBe('function');
  });

  it('MIN age across logs: last_line_ms tracks the NEWEST tail, not the primary', () => {
    const now = 1_000_000;
    const logs = [
      { character: 'Hitya',  lastSeen: now - 40_000 },   // primary, quieter
      { character: 'Canopy', lastSeen: now - 3_000 },    // alt, most recent
    ];
    const r = _computeLiveness(logs, now, IDLE);
    expect(r.last_line_ms).toBe(3_000);                  // MIN age = newest tail
    expect(r.live_character).toBe('Canopy');             // the most-recently-active char
  });

  it('STALE PRIMARY, LIVE ALT: the agent stays FRESH off the alt\'s flowing log', () => {
    const now = 1_000_000;
    const logs = [
      { character: 'Hitya',  lastSeen: now - 3_600_000 }, // primary logged out an hour ago
      { character: 'Canopy', lastSeen: now - 2_000 },     // actively playing the alt
    ];
    const r = _computeLiveness(logs, now, IDLE);
    expect(r.last_line_ms).toBe(2_000);                   // < any freshness threshold → FRESH
    expect(r.last_line_ms).toBeLessThan(IDLE);
    expect(r.live_character).toBe('Canopy');
  });

  it('ALL IDLE: live_character is null, but last_line_ms is the REAL (large) age — not null', () => {
    const now = 1_000_000;
    const logs = [
      { character: 'Hitya',  lastSeen: now - 300_000 },   // 5 min ago
      { character: 'Canopy', lastSeen: now - 200_000 },   // 3.3 min ago (newest, still idle)
    ];
    const r = _computeLiveness(logs, now, IDLE);
    expect(r.live_character).toBe(null);                  // nothing newer than the idle window
    expect(r.last_line_ms).toBe(200_000);                 // stays the true age → bot sees it STALE
  });

  it('NO ACTIVITY: no logs / no lastSeen → null last_line_ms (fail-open FRESH at the bot)', () => {
    const now = 1_000_000;
    expect(_computeLiveness([], now, IDLE)).toEqual({ last_line_ms: null, live_character: null });
    expect(_computeLiveness([{ character: 'X' }], now, IDLE)).toEqual({ last_line_ms: null, live_character: null });
    expect(_computeLiveness(null, now, IDLE)).toEqual({ last_line_ms: null, live_character: null });
  });

  it('live_character reports the newest even when it is NOT the first/primary log', () => {
    const now = 1_000_000;
    const logs = [
      { character: 'Aaa', lastSeen: now - 10_000 },
      { character: 'Bbb', lastSeen: now - 1_000 },   // newest
      { character: 'Ccc', lastSeen: now - 5_000 },
    ];
    expect(_computeLiveness(logs, now, IDLE).live_character).toBe('Bbb');
  });
});
