// Source-slice test for _recordKillLockouts in the bot monolith.
//
// The pure derivation lives in utils/killLockouts.js and is covered by
// test/kill-lockouts.test.js. What is only testable HERE is the wiring the
// monolith adds around it: the PoP gate, the raid_nights lookup that decides
// `ours`, the /sll-protection read, and the upsert key. Those are exactly the
// parts that would silently stop working.
import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src   = readSource(BOT_INDEX);
// End marker is the function's own closing brace at column 0 — every brace
// inside the body is indented, so this can't cut it short.
const block = sliceBlock(src, 'async function _recordKillLockouts({', '\n}\n');

const VENTANI = { id: 'ventani_warder', name: 'Ventani the Warder', timerHours: 162 };

let calls;
function makeSupabase({ raidNightId = null, existing = [] } = {}) {
  return {
    isEnabled: () => true,
    select: async (table, q) => {
      calls.push({ op: 'select', table, q });
      if (table === 'encounters')          return [{ raid_night_id: raidNightId }];
      if (table === 'character_lockouts')  return existing;
      return [];
    },
    upsert: async (table, rows, onConflict) => {
      calls.push({ op: 'upsert', table, rows, onConflict });
      return rows;
    },
  };
}

function load({ supabase, popLocked = false }) {
  const requireShim = (id) => {
    if (id === './utils/killLockouts') return require('../utils/killLockouts.js');
    if (id === './utils/supabase')     return supabase;
    throw new Error('unexpected require: ' + id);
  };
  // eslint-disable-next-line no-new-func
  return new Function('require', 'isPopLocked', 'process', 'console',
    block + '\nreturn _recordKillLockouts;')(
    requireShim, () => popLocked, { env: {} },
    { log() {}, warn() {} });
}

const baseArgs = () => ({
  boss: VENTANI,
  encounterId: '1b943d2d-0059-4407-8ab2-9346421f0d79',
  killedAtMs: Date.now() - 3600000,
  contributor: 'Taeya',
  players: [{ name: 'Badcop' }, { name: 'Sevilla' }],
  healers: [], defenders: [],
  inRaidWindow: false,
});

beforeEach(() => { calls = []; });

describe('_recordKillLockouts', () => {
  it('writes a row for the uploader even though they never appear in the damage list', async () => {
    // Taeya is a cleric: zero damage, so no encounter_players row exists for
    // her. She is still locked, and this is the case that prompted the work.
    const fn = load({ supabase: makeSupabase() });
    await fn(baseArgs());
    const up = calls.find(c => c.op === 'upsert');
    expect(up.rows.map(r => r.character).sort()).toEqual(['Badcop', 'Sevilla', 'Taeya']);
  });

  it('keys the upsert on one row per character per boss', async () => {
    const fn = load({ supabase: makeSupabase() });
    await fn(baseArgs());
    expect(calls.find(c => c.op === 'upsert').onConflict)
      .toBe('guild_id,character,boss_key');
  });

  it('marks a kill outside every raid window as not ours', async () => {
    const fn = load({ supabase: makeSupabase({ raidNightId: null }) });
    await fn(baseArgs());
    expect(calls.find(c => c.op === 'upsert').rows.every(r => r.ours === false)).toBe(true);
  });

  it('marks a kill bound to a raid night as ours', async () => {
    const fn = load({ supabase: makeSupabase({ raidNightId: 'rn-1' }) });
    await fn(baseArgs());
    expect(calls.find(c => c.op === 'upsert').rows.every(r => r.ours === true)).toBe(true);
  });

  it('leaves an unbound in-window kill unknown rather than accusing anyone', async () => {
    const fn = load({ supabase: makeSupabase({ raidNightId: null }) });
    await fn({ ...baseArgs(), inRaidWindow: true });
    expect(calls.find(c => c.op === 'upsert').rows.every(r => r.ours === null)).toBe(true);
  });

  it('does not overwrite a live /sll row — the server time wins', async () => {
    const existing = [{
      character: 'Taeya', boss_key: 'ventani_warder', source: 'sll',
      expires_at: new Date(Date.now() + 100 * 3600000).toISOString(),
    }];
    const fn = load({ supabase: makeSupabase({ existing }) });
    await fn(baseArgs());
    expect(calls.find(c => c.op === 'upsert').rows.map(r => r.character).sort())
      .toEqual(['Badcop', 'Sevilla']);
  });

  it('writes nothing at all for a PoP boss while PoP is locked', async () => {
    const fn = load({ supabase: makeSupabase(), popLocked: true });
    await fn(baseArgs());
    expect(calls).toEqual([]);
  });

  it('writes nothing when the parse yielded no usable names', async () => {
    const fn = load({ supabase: makeSupabase() });
    await fn({ ...baseArgs(), contributor: null, players: [{ name: 'a decaying skeleton' }] });
    expect(calls.find(c => c.op === 'upsert')).toBeUndefined();
  });

  it('survives Supabase failing the raid-night lookup', async () => {
    const sb = makeSupabase();
    sb.select = async (table) => {
      if (table === 'encounters') throw new Error('boom');
      return [];
    };
    const fn = load({ supabase: sb });
    await expect(fn(baseArgs())).resolves.toBeUndefined();
    expect(calls.find(c => c.op === 'upsert').rows.every(r => r.ours === false)).toBe(true);
  });
});
