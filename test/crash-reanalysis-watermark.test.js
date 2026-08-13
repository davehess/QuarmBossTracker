// test/crash-reanalysis-watermark.test.js — the backfill handshake.
//
// THE POINT: a member who already had crash sharing switched on has a pile of
// reports that were uploaded before we could read minidumps, so every one of
// them is just an address. Agent 3.5.68 re-sends those bundles once, with the
// dump analysis attached, and the bot upserts them in place.
//
// THE HAZARD: if the agent marks a bundle "analysed" at SEND time and the bot
// happens to be too old to store the new fields, that history is burned — the
// bundle never gets re-sent, and nobody finds out. So the watermark advances
// only on the bot echoing back an analysis_version it actually persisted.
// These tests pin that handshake, including the pause-and-re-probe behaviour
// that stops an old bot from being re-sent eight dumps a minute forever.
//
// Run: npx vitest run test/crash-reanalysis-watermark.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

// _onUploadSuccess's crash branch, lifted with the state it touches stubbed.
function makeOnUploadSuccess(state) {
  const branch = sliceBlock(src, "  if (entry.kind === 'crash_report') {", '\n  }');
  const log = [];
  const fn = new Function('state', 'log', 'CRASH_ANALYSIS_VERSION', `
    let _crashAnalysisSupported = state.__supported;
    let _crashAnalysisProbedAt = 0;
    const _loadCrashState = () => state;
    const _saveCrashState = () => { state.__saves = (state.__saves || 0) + 1; };
    const console = { log: (m) => log.push(m) };
    return function (entry, responseText) {
      ${branch}
      return null;
    };
  `)(state, log, 1);
  return { fn, log };
}

const entryFor = (...names) => ({
  kind: 'crash_report',
  payload: { reports: names.map(n => ({ zip_name: n })) },
});

describe('the re-analysis watermark advances only on the bot confirming', () => {
  it('advances when the bot echoes analysis_version', () => {
    const state = { reported: { 'a.zip': 111 }, analyzed: {} };
    const { fn } = makeOnUploadSuccess(state);
    fn(entryFor('a.zip', 'b.zip'), JSON.stringify({ ok: true, written: 2, analysis_version: 1 }));
    expect(state.analyzed['a.zip']).toBe(1);
    expect(state.analyzed['b.zip']).toBe(1);
    expect(state.reported['a.zip']).toBe(111);          // untouched
    expect(state.reported['b.zip']).toBeGreaterThan(0); // filled in
    expect(state.__saves).toBe(1);
  });

  it('does NOT advance against a bot that says nothing — the backfill survives', () => {
    // This is the whole reason the handshake exists. An older bot returns
    // {ok:true,written:N} and silently drops the dump columns; marking these
    // analysed would lose the one chance to backfill them.
    const state = { reported: { 'a.zip': 111 }, analyzed: {} };
    const { fn, log } = makeOnUploadSuccess(state);
    fn(entryFor('a.zip'), JSON.stringify({ ok: true, written: 1 }));
    expect(state.analyzed['a.zip']).toBeUndefined();
    expect(log.join(' ')).toMatch(/does not store dump analysis yet/);
  });

  it('does NOT advance on an older analysis_version than ours', () => {
    const state = { reported: {}, analyzed: {} };
    const { fn } = makeOnUploadSuccess(state);
    fn(entryFor('a.zip'), JSON.stringify({ ok: true, analysis_version: 0 }));
    expect(state.analyzed['a.zip']).toBeUndefined();
  });

  it('survives a response that is not JSON at all', () => {
    const state = { reported: {}, analyzed: {} };
    const { fn } = makeOnUploadSuccess(state);
    expect(() => fn(entryFor('a.zip'), '<html>502 Bad Gateway</html>')).not.toThrow();
    expect(state.analyzed['a.zip']).toBeUndefined();
  });

  it('only complains once while the bot stays old', () => {
    const state = { reported: {}, analyzed: {}, __supported: false };
    const { fn, log } = makeOnUploadSuccess(state);
    fn(entryFor('a.zip'), JSON.stringify({ ok: true }));
    expect(log).toHaveLength(0);        // already known-unsupported, stay quiet
  });
});

describe('the sweep budget', () => {
  const sweep = sliceBlock(src, 'function scanCrashDirs', '\n}');

  it('pauses re-analysis when the bot is known not to support it', () => {
    expect(sweep).toMatch(/_crashAnalysisSupported === false/);
    expect(sweep).toMatch(/reprobeDue \? 1 : 0/);
  });

  it('still sends exactly one bundle after the re-probe interval, so a bot deploy resumes it', () => {
    const decl = sliceBlock(src, 'const CRASH_ANALYSIS_REPROBE_MS', ';');
    expect(decl).toMatch(/3600_000/);
    expect(sweep).toMatch(/Date\.now\(\) - _crashAnalysisProbedAt > CRASH_ANALYSIS_REPROBE_MS/);
  });

  it('caps dump re-reads per sweep so hundreds of bundles cannot stall the agent', () => {
    const decl = sliceBlock(src, 'const CRASH_REANALYZE_PER_SWEEP', ';');
    const cap = Number(decl.match(/=\s*(\d+)/)[1]);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(20);
  });

  it('marks an unparseable bundle analysed so it stops costing a slot every sweep', () => {
    expect(sweep).toMatch(/if \(!again\) \{ state\.analyzed\[n\] = CRASH_ANALYSIS_VERSION; continue; \}/);
  });
});

describe('state migration', () => {
  const load = sliceBlock(src, 'function _loadCrashState', '\n}');

  it('adds an EMPTY analyzed map to an existing state file, never a pre-filled one', () => {
    // Back-filling `analyzed` to the current version here would look tidy and
    // would silently mean an existing uploader's whole history is never
    // re-sent — the exact opposite of what this feature is for.
    const fn = new Function('fs', 'CRASH_STATE_FILE', `
      let _crashState = null;
      ${load}
      return _loadCrashState;
    `)({ readFileSync: () => JSON.stringify({ reported: { 'old.zip': 123 } }) }, 'x');
    const st = fn();
    expect(st.reported['old.zip']).toBe(123);
    expect(st.analyzed).toEqual({});
  });

  it('builds both maps from nothing on a first run', () => {
    const fn = new Function('fs', 'CRASH_STATE_FILE', `
      let _crashState = null;
      ${load}
      return _loadCrashState;
    `)({ readFileSync: () => { throw new Error('ENOENT'); } }, 'x');
    expect(fn()).toEqual({ reported: {}, analyzed: {} });
  });
});
