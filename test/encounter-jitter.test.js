// Encounter-upload burst jitter (#106) — MIRROR fidelity tier.
//
// The jitter helpers `_encounterUploadJitterMs` + `_shouldJitterEncounterUpload`
// are pure functions in the AGENT (packages/wolfpack-logsync/index.js) and ship
// on the BETA channel (agent 3.3.87). They are NOT yet on main's agent file, so
// a source-slice would throw here. Per this repo's convention (see the notes on
// trigger-class / timeline-events), a beta-only agent function gets a MIRROR
// test on main — a verbatim copy of the pure logic — that is UPGRADED to a
// source-slice when the line graduates to stable/main. Keep the copy below in
// lock-step with the agent; the constants and body must match byte-for-byte.
//
// Under test: deterministic per uploader (re-runs never re-randomize), bounded
// 0..15s, and the small-payload/empty-queue bypass that keeps solo/duo parses
// feeling instant on the dashboard cards.

import { describe, it, expect } from 'vitest';

// ── MIRROR of the agent code (packages/wolfpack-logsync/index.js) ────────────
const ENCOUNTER_JITTER_MAX_MS = 15_000;
const ENCOUNTER_JITTER_MIN_BYTES = 256 * 1024;
function _encounterUploadJitterMs(uploader) {
  const s = String(uploader || '');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h % ENCOUNTER_JITTER_MAX_MS;
}
function _shouldJitterEncounterUpload(queueLen, bytes) {
  // Skip the burst-flattening jitter only for a small payload with an otherwise
  // empty queue (solo/duo parse) — the dashboard card should feel instant.
  // Anything larger, or any time we're already draining others' data, jitters.
  if (queueLen === 0 && bytes < ENCOUNTER_JITTER_MIN_BYTES) return false;
  return true;
}
// ─────────────────────────────────────────────────────────────────────────────

describe('_encounterUploadJitterMs — deterministic per uploader', () => {
  it('same name → same delay across calls (re-runs never re-randomize)', () => {
    const a = _encounterUploadJitterMs('Uilnayar');
    const b = _encounterUploadJitterMs('Uilnayar');
    expect(a).toBe(b);
  });

  it('is bounded to 0..15s (exclusive upper)', () => {
    const names = ['Uilnayar', 'Hitya', 'Canopy', 'a', 'ZZZ', 'orc warrior', '', 'Æon', 'Rhag`Zhezum'];
    for (const n of names) {
      const v = _encounterUploadJitterMs(n);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(ENCOUNTER_JITTER_MAX_MS);
    }
  });

  it('spreads the fleet — 60 distinct names do not collapse to one bucket', () => {
    const vals = new Set();
    for (let i = 0; i < 60; i++) vals.add(_encounterUploadJitterMs('Raider' + i));
    // A good hash spreads these across the 15s window; require a healthy variety.
    expect(vals.size).toBeGreaterThan(40);
  });

  it('empty/undefined uploader is handled (no throw, in bounds)', () => {
    for (const u of [undefined, null, '']) {
      const v = _encounterUploadJitterMs(u);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(ENCOUNTER_JITTER_MAX_MS);
    }
  });
});

describe('_shouldJitterEncounterUpload — small/solo bypass', () => {
  it('empty queue + small payload → no jitter (instant card)', () => {
    expect(_shouldJitterEncounterUpload(0, 10 * 1024)).toBe(false);
    expect(_shouldJitterEncounterUpload(0, ENCOUNTER_JITTER_MIN_BYTES - 1)).toBe(false);
  });

  it('empty queue + LARGE payload → jitter (a raid fight rides the delay)', () => {
    expect(_shouldJitterEncounterUpload(0, ENCOUNTER_JITTER_MIN_BYTES)).toBe(true);
    expect(_shouldJitterEncounterUpload(0, 2 * 1024 * 1024)).toBe(true);
  });

  it('non-empty queue → jitter even for a small payload (already in a burst)', () => {
    expect(_shouldJitterEncounterUpload(1, 1024)).toBe(true);
    expect(_shouldJitterEncounterUpload(5, 10 * 1024)).toBe(true);
  });
});
