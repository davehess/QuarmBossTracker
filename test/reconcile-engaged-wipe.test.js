// test/reconcile-engaged-wipe.test.js — the nightly "engaged" cleanup leaves the end time off a wipe.
//
// The guild lead, 2026-10-23: a wipe read as a kill, because utils/reconcileKills.js reconcileEngagedEncounters stamped
// ended_at on every unconfirmed encounter older than 12 minutes and the readers (raid review, kill recap,
// latest_kill_per_npc timer recovery) take `ended_at != null` to mean "the boss died". This runs the REAL function
// against a stub of utils/supabase and checks which rows get an UPDATE.
//
// Run: npx vitest run test/reconcile-engaged-wipe.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const realSupabase = require('../utils/supabase.js');
const { reconcileEngagedEncounters, isMarkedWipe, fellShortOfBossHp } = require('../utils/reconcileKills.js');

const NOW = Date.parse('2026-10-23T20:00:00Z');
const MIN = 60_000;
const BOSS = 1001, TRASH = 2002;         // BOSS is curated (bosses_local.auto_registered = false); TRASH is not
const row = (id, o = {}) => ({
  id, npc_id: BOSS, started_at: new Date(NOW - 60 * MIN).toISOString(), duration_sec: 300,
  total_damage: 1_000_000, is_wipe: false, classification: null, eqemu_npc_types: { hp: 1_000_000 }, ...o,
});

describe('reconcileEngagedEncounters leaves a wipe unstamped', () => {
  let keep, updates, reads;
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    keep = { isEnabled: realSupabase.isEnabled, select: realSupabase.select, update: realSupabase.update };
    updates = []; reads = [];
  });
  afterEach(() => { Object.assign(realSupabase, keep); vi.useRealTimers(); });

  // engaged rows come back from the first select; bosses_local answers the curated read; loot is empty.
  const run = async (engaged, { loot = [] } = {}) => {
    Object.assign(realSupabase, {
      isEnabled: () => true,
      select: async (table, q) => {
        reads.push([table, q]);
        if (table === 'encounters' && q.includes('ended_at=is.null')) return engaged;
        if (table === 'bosses_local') return [{ npc_id: BOSS }].filter(r => q.includes(String(r.npc_id)));
        if (table === 'loot_observations') return loot;
        return [];
      },
      update: async (table, q, body) => { updates.push({ table, q, body }); return []; },
    });
    return reconcileEngagedEncounters();
  };
  const stamped = () => updates.map(u => decodeURIComponent(u.q).match(/id=eq\.([^&]+)/)[1]);

  it('still stamps a real kill (damage at or above the boss HP), with start + duration as the end time', async () => {
    const r = await run([row('kill')]);
    expect(stamped()).toEqual(['kill']);
    expect(updates[0].body).toEqual({ ended_at: new Date(NOW - 60 * MIN + 300_000).toISOString() });
    expect(r).toMatchObject({ ok: true, promoted: 1, skippedWipes: 0 });
  });

  it('does not stamp an officer-marked wipe (is_wipe, or classification wipe), stale or not', async () => {
    const r = await run([
      row('flag', { is_wipe: true }),
      row('class', { classification: 'wipe' }),
      row('both', { is_wipe: true, classification: 'foreign' }),
    ]);
    expect(updates).toEqual([]);
    expect(r).toMatchObject({ promoted: 0, skippedWipes: 3 });
  });

  it('does not stamp a curated boss whose damage is under 90% of catalog HP, but does at exactly 90%', async () => {
    await run([row('short', { total_damage: 899_999 }), row('edge', { total_damage: 900_000 })]);
    expect(stamped()).toEqual(['edge']);
  });

  it('judges only curated bosses by HP: a trash mob under 90% still gets its end time', async () => {
    await run([row('trash', { npc_id: TRASH, total_damage: 100_000 })]);
    expect(stamped()).toEqual(['trash']);
  });

  it('with the HP unknown there is no estimate, so the row is stamped as before', async () => {
    await run([row('nohp', { eqemu_npc_types: null, total_damage: 5 }), row('zerohp', { eqemu_npc_types: { hp: 0 }, total_damage: 5 })]);
    expect(stamped().sort()).toEqual(['nohp', 'zerohp']);
  });

  it('a recent short fight with loot posted is a kill (loot outranks the damage estimate); an officer mark still wins', async () => {
    const recent = new Date(NOW - 5 * MIN).toISOString();
    await run([
      row('loot', { started_at: recent, duration_sec: 60, total_damage: 100_000 }),
      row('marked', { started_at: recent, duration_sec: 60, total_damage: 100_000, is_wipe: true }),
    ], { loot: [{ id: 1 }] });
    expect(stamped()).toEqual(['loot']);
  });

  it('only reads the curated list when a stale row is actually short of HP', async () => {
    await run([row('kill')]);
    expect(reads.some(([t]) => t === 'bosses_local')).toBe(false);
    await run([row('short', { total_damage: 1 })]);
    expect(reads.filter(([t]) => t === 'bosses_local')).toHaveLength(1);
  });

  it('the predicates read the embedded catalog row as an object or a one-element array', () => {
    expect(fellShortOfBossHp({ total_damage: 10, eqemu_npc_types: [{ hp: 100 }] })).toBe(true);
    expect(fellShortOfBossHp({ total_damage: 95, eqemu_npc_types: { hp: 100 } })).toBe(false);
    expect(fellShortOfBossHp({ total_damage: 10 })).toBe(false);
    expect(isMarkedWipe({ is_wipe: false, classification: 'wipe' })).toBe(true);
    expect(isMarkedWipe({ is_wipe: false, classification: null })).toBe(false);
  });
});
