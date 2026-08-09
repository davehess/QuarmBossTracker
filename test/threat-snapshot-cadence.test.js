// Threat-snapshot cadence clamp — SOURCE-SLICE fidelity tier.
//
// The cadence is officer-tunable mid-raid (Hitya 2026-08-03) via the
// overlay-tuning map, which means a number arriving over the network now
// controls how often ~40 agents POST. The clamp is the only thing standing
// between a fat-fingered value and the fleet hammering the bot, so it is worth
// a test that reads the SHIPPED bounds rather than re-typed copies.
//
// Ceiling matters as much as the floor: an absurd value must degrade to "very
// slow", never to "never" (NaN/Infinity would make the elapsed check
// permanently false and silently kill the stream for the whole raid).
//
// SELF-CONTAINED: the `beta` branch has no test/_source-slice.js, so the slice
// helper is inlined (same contract as agent-liveness.test.js).
//
// Run: npx vitest run test/threat-snapshot-cadence.test.js

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

const src = sliceBlock(
  fs.readFileSync(AGENT_INDEX, 'utf8'),
  '  const THREAT_SNAP_TICK_MS =',
  'return Math.max(THREAT_SNAP_MIN_MS, Math.min(THREAT_SNAP_MAX_MS, t));\n  }',
);

// The slice reads tuneNum() (the officer tuning map) and process.env; inject
// both so the test drives them.
function build(tuned, envMs) {
  const harness = `
    const process = { env: ${JSON.stringify(envMs == null ? {} : { WP_THREAT_SNAPSHOT_MS: String(envMs) })} };
    function tuneNum(key, dflt) {
      const v = ${JSON.stringify(tuned)}[key];
      return (typeof v === 'number' && isFinite(v)) ? v : dflt;
    }
  ` + src + `
    return { cadence: _threatSnapCadenceMs,
             TICK: THREAT_SNAP_TICK_MS, MIN: THREAT_SNAP_MIN_MS, MAX: THREAT_SNAP_MAX_MS };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)();
}

describe('_threatSnapCadenceMs — officer-tunable, hard-clamped', () => {
  it('sliced the real function and bounds', () => {
    const h = build({});
    expect(typeof h.cadence).toBe('function');
    expect(h.MIN).toBeGreaterThan(0);
    expect(h.MAX).toBeGreaterThan(h.MIN);
    // Tick must be at or below the floor, or the gate could never fire at MIN.
    expect(h.TICK).toBeLessThanOrEqual(h.MIN);
  });

  it('honors a sane tuned value', () => {
    expect(build({ threat_snapshot_ms: 3000 }).cadence()).toBe(3000);
    expect(build({ threat_snapshot_ms: 30000 }).cadence()).toBe(30000);
  });

  it('CLAMPS a too-fast value to the floor — the fleet-hammer guard', () => {
    const h = build({ threat_snapshot_ms: 100 });
    expect(h.cadence()).toBe(h.MIN);
    // 120/min per uploader is the ingest budget; the floor must stay under it.
    expect(60_000 / h.cadence()).toBeLessThanOrEqual(120);
  });

  it('clamps zero and negatives to the floor, never to 0', () => {
    expect(build({ threat_snapshot_ms: 0 }).cadence()).toBe(build({}).MIN);
    expect(build({ threat_snapshot_ms: -5000 }).cadence()).toBe(build({}).MIN);
  });

  it('clamps an absurd value to the ceiling — degrades to slow, never to never', () => {
    const h = build({ threat_snapshot_ms: 999_999_999 });
    expect(h.cadence()).toBe(h.MAX);
    expect(Number.isFinite(h.cadence())).toBe(true);
  });

  it('falls back to the compiled default when tuning is absent or non-numeric', () => {
    expect(build({}).cadence()).toBe(6000);
    expect(build({ threat_snapshot_ms: 'fast' }).cadence()).toBe(6000);
    expect(build({ threat_snapshot_ms: null }).cadence()).toBe(6000);
    expect(build({ threat_snapshot_ms: NaN }).cadence()).toBe(6000);
    expect(build({ threat_snapshot_ms: Infinity }).cadence()).toBe(6000);
  });

  it('the env var still sets the default for a standalone agent', () => {
    expect(build({}, 12000).cadence()).toBe(12000);
    // …but tuning wins over env when both are present.
    expect(build({ threat_snapshot_ms: 4000 }, 12000).cadence()).toBe(4000);
    // …and env is clamped too.
    expect(build({}, 50).cadence()).toBe(build({}).MIN);
  });
});
