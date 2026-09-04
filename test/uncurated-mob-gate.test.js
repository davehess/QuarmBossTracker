// test/uncurated-mob-gate.test.js — the ingest gate on uncurated-mob
// encounter collection (Hitya, 2026-09-04: "how much is it costing us to track
// these and can we add a flag into the setup to turn those off").
//
// SOURCE-SLICE fidelity tier: the resolver and the flag reader are sliced out
// of the shipped bot and driven against a fake Supabase, so the real code is
// what runs here. What the gate must and must not do:
//   · OFF: no self-registration; encounters on already auto-registered rows
//     stop persisting; the result is DISTINGUISHABLE from a junk-name null so
//     the call site does not log it as a miss.
//   · OFF still persists CURATED bosses — the gate must never cost a real kill.
//   · The tuning key wins over the env default while it is set to 1; a tuning
//     read that throws falls back to the env default (fail to configured).
//
// Run: npx vitest run test/uncurated-mob-gate.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, BOT_INDEX, ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);

const resolverBlock = sliceBlock(
  src,
  'function _bossPersistKeys(',
  "console.warn('[lockout] promote failed for \"' + bossName + '\":', e?.message);\n  }\n}",
);
const { _resolveBossForPersist } = evalBlock(
  'const console = { log(){}, warn(){} };\n' + resolverBlock, ['_resolveBossForPersist']);

function fakeSupabase({ rows = [], npcs = [], byNpc = [] } = {}) {
  const inserted = [];
  return {
    inserted,
    async select(table, q) {
      if (table === 'bosses_local' && q.startsWith('internal_id=in.')) return rows;
      if (table === 'eqemu_npc_types') return npcs;
      if (table === 'bosses_local' && q.startsWith('npc_id=eq.')) return byNpc;
      return [];
    },
    async insertIgnoreDuplicates(_table, arr) { inserted.push(...arr); },
  };
}

const GATED = { internalId: null, gated: 'uncurated' };

describe('_resolveBossForPersist with the gate OFF', () => {
  it('refuses an already auto-registered row', async () => {
    const sb = fakeSupabase({ rows: [{ internal_id: 'a_soriz_drudge', auto_registered: true }] });
    const r = await _resolveBossForPersist('A Soriz Drudge', null, sb, { trackUncurated: false });
    expect(r).toEqual(GATED);
    expect(sb.inserted).toEqual([]);
  });

  it('still persists a CURATED boss', async () => {
    const sb = fakeSupabase({ rows: [{ internal_id: 'lord_seru', auto_registered: false }] });
    const r = await _resolveBossForPersist('Lord Seru', 'lord_seru', sb, { trackUncurated: false });
    expect(r).toEqual({ internalId: 'lord_seru', registered: false });
  });

  it('does not self-register first-time content', async () => {
    const sb = fakeSupabase({ npcs: [{ id: 162013 }] });
    const r = await _resolveBossForPersist('A Soriz Slave', null, sb, { trackUncurated: false });
    expect(r).toEqual(GATED);
    expect(sb.inserted).toEqual([]);
  });

  it('refuses an auto row reached by exact eqemu match too', async () => {
    const sb = fakeSupabase({ npcs: [{ id: 162013 }], byNpc: [{ internal_id: 'soriz_slave', auto_registered: true }] });
    const r = await _resolveBossForPersist('A Soriz Slave', null, sb, { trackUncurated: false });
    expect(r).toEqual(GATED);
  });

  it('a junk name is still a plain null — not the gate', async () => {
    const sb = fakeSupabase();
    const r = await _resolveBossForPersist('Labanab', null, sb, { trackUncurated: false });
    expect(r).toBeNull();
  });
});

describe('_resolveBossForPersist with the gate ON (the default)', () => {
  it('self-registers first-time content exactly as before', async () => {
    const sb = fakeSupabase({ npcs: [{ id: 162013 }] });
    const r = await _resolveBossForPersist('A Soriz Slave', null, sb);
    expect(r).toEqual({ internalId: 'a_soriz_slave', registered: true });
    expect(sb.inserted).toHaveLength(1);
    expect(sb.inserted[0]).toMatchObject({ npc_id: 162013, internal_id: 'a_soriz_slave', auto_registered: true });
  });

  it('persists on an auto-registered row', async () => {
    const sb = fakeSupabase({ rows: [{ internal_id: 'a_soriz_drudge', auto_registered: true }] });
    const r = await _resolveBossForPersist('A Soriz Drudge', null, sb, { trackUncurated: true });
    expect(r).toEqual({ internalId: 'a_soriz_drudge', registered: false });
  });
});

// ── The flag reader ──────────────────────────────────────────────────────────
const flagBlock = sliceBlock(src, 'const TRACK_UNCURATED_MOBS_ENV', '// ── Per-uploader admission-control budgets (#73)');

function makeReader(envValue) {
  const prev = process.env.TRACK_UNCURATED_MOBS;
  if (envValue === undefined) delete process.env.TRACK_UNCURATED_MOBS; else process.env.TRACK_UNCURATED_MOBS = envValue;
  try {
    return evalBlock(
      'const __ctl = { tune: {}, boom: false };\n' +
      'const _overlayTuningMap = async () => { if (__ctl.boom) throw new Error("tuning down"); return __ctl.tune; };\n' +
      flagBlock,
      ['_trackUncuratedMobs', '__ctl']);
  } finally {
    if (prev === undefined) delete process.env.TRACK_UNCURATED_MOBS; else process.env.TRACK_UNCURATED_MOBS = prev;
  }
}

describe('_trackUncuratedMobs — env default, tuning override', () => {
  it('defaults ON with no env and no tuning key', async () => {
    const { _trackUncuratedMobs } = makeReader(undefined);
    expect(await _trackUncuratedMobs()).toBe(true);
  });

  it('flag_skip_uncurated_mobs=1 turns it off live; 0 or missing leaves the env default', async () => {
    const { _trackUncuratedMobs, __ctl } = makeReader(undefined);
    __ctl.tune = { flag_skip_uncurated_mobs: '1' };
    expect(await _trackUncuratedMobs()).toBe(false);
    __ctl.tune = { flag_skip_uncurated_mobs: 0 };
    expect(await _trackUncuratedMobs()).toBe(true);
  });

  it('TRACK_UNCURATED_MOBS=0 is off at boot', async () => {
    const { _trackUncuratedMobs } = makeReader('0');
    expect(await _trackUncuratedMobs()).toBe(false);
  });

  it('a tuning read that throws falls back to the env default', async () => {
    const on = makeReader(undefined); on.__ctl.boom = true;
    expect(await on._trackUncuratedMobs()).toBe(true);
    const off = makeReader('0'); off.__ctl.boom = true;
    expect(await off._trackUncuratedMobs()).toBe(false);
  });
});

// ── Wiring ───────────────────────────────────────────────────────────────────
describe('the call site honours the gate', () => {
  const clean = stripJs(src);
  it('reads the flag, passes it in, and logs a gated mob once instead of as a miss', () => {
    expect(clean).toMatch(/const trackUncurated = await _trackUncuratedMobs\(\);/);
    expect(clean).toMatch(/supabase, \{ trackUncurated \}\);/);
    expect(clean).toMatch(/if \(resolved\?\.internalId\) \{/);
    expect(clean).toMatch(/\} else if \(resolved\?\.gated\) \{/);
    expect(clean).toMatch(/_uncuratedGateLogged\.add\(bossInternalId\)/);
  });

  it('is documented where a self-hoster looks', () => {
    const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    expect(env).toMatch(/TRACK_UNCURATED_MOBS/);
  });
});
