// test/account-placements-route.test.js — GET /api/agent/account-placements.
//
// The guild lead (2026-10-26): Mimic's local inventory page guessed 23 game accounts for someone who owns 6,
// because it only had shared-bank snapshots. The hosted page uses the owner's real placements; this route hands
// the same rows to the agent. What can go wrong without anyone noticing:
//   * the route returns a placement for a character that is NOT in the caller's family (a privacy leak: this is
//     an account layout), or takes the person from the query string instead of the Mimic session;
//   * a CLOSED row (valid_to set: #charactertransfer history) is returned as where the character is now;
//   * a failed read is answered as "nothing placed" (the agent would then silently fall back to guessing and
//     cache the wrong answer) instead of a 502;
//   * the route answers without the agent-auth gate.
// utils/myAccountPlacements.js is run against a stub database; the dispatcher wiring is read from index.js
// with comments stripped. Fixture names are the invented ones; the ids are made-up uuids.
//
// Run: npx vitest run test/account-placements-route.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const mp = nodeRequire('../utils/myAccountPlacements.js');
const cp = nodeRequire('../utils/characterPrefs.js');

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';

// A stand-in for utils/supabase that records every call and understands only what the route may use.
function stubDb({ family = ['Aldenmar', 'Brackwyn', 'Corvale'], open, accounts } = {}) {
  const db = {
    calls: [], family,
    async rpc(fn, params) { db.calls.push({ m: 'rpc', fn, params }); return db.family; },
    async select(table, query) {
      db.calls.push({ m: 'select', table, query });
      return table === 'character_accounts' ? open : accounts;
    },
  };
  return new Proxy(db, {
    get(t, k) {
      if (k in t || typeof k === 'symbol') return t[k];
      throw new Error('unexpected supabase.' + String(k) + ' — this route only reads');
    },
  });
}
const freshCache = () => cp.createOwnedCache();

describe('minePlacements', () => {
  it('returns the caller\'s open placements with the account slot and label', async () => {
    const db = stubDb({
      open: [{ character_name: 'Brackwyn', account_id: A1 }, { character_name: 'Aldenmar', account_id: A1 }, { character_name: 'Corvale', account_id: A2 }],
      accounts: [{ id: A1, slot: 3, label: 'Bank alts' }, { id: A2, slot: null, label: null }],
    });
    const out = await mp.minePlacements(db, freshCache(), '100');
    expect(out.status).toBe(200);
    expect(out.body.placements).toEqual([
      { character: 'Aldenmar', accountId: A1, slot: 3, label: 'Bank alts' },
      { character: 'Brackwyn', accountId: A1, slot: 3, label: 'Bank alts' },
      { character: 'Corvale', accountId: A2, slot: null, label: null },
    ]);
  });

  it('asks only for OPEN rows of the caller\'s family, in the guild', async () => {
    const db = stubDb({ open: [], accounts: [] });
    await mp.minePlacements(db, freshCache(), '100');
    expect(db.calls[0]).toEqual({ m: 'rpc', fn: 'owned_character_names', params: { p_discord_id: '100' } });
    const q = decodeURIComponent(db.calls[1].query);
    expect(db.calls[1].table).toBe('character_accounts');
    expect(q).toContain('valid_to=is.null');
    expect(q).toContain('"Aldenmar","Brackwyn","Corvale"');
    expect(q).toContain('guild_id=eq.' + cp.GUILD);
  });

  it('never returns a character outside the family, even if the database hands one back', async () => {
    const db = stubDb({
      open: [{ character_name: 'Aldenmar', account_id: A1 }, { character_name: 'Zarrin', account_id: A2 }],
      accounts: [{ id: A1, slot: 1, label: null }, { id: A2, slot: 2, label: null }],
    });
    const out = await mp.minePlacements(db, freshCache(), '100');
    expect(out.body.placements.map(p => p.character)).toEqual(['Aldenmar']);
    // and the account lookup is for the surviving rows only
    expect(db.calls.find(c => c.table === 'game_accounts').query).not.toContain(A2);
  });

  it('drops a row whose account id is not a uuid instead of putting it in a query', async () => {
    const db = stubDb({ open: [{ character_name: 'Aldenmar', account_id: 'x),(1=1' }], accounts: [] });
    const out = await mp.minePlacements(db, freshCache(), '100');
    expect(out.body.placements).toEqual([]);
    expect(db.calls.some(c => c.table === 'game_accounts')).toBe(false);
  });

  it('a failed account-name lookup still returns the placements', async () => {
    const db = stubDb({ open: [{ character_name: 'Aldenmar', account_id: A1 }], accounts: null });
    const out = await mp.minePlacements(db, freshCache(), '100');
    expect(out.status).toBe(200);
    expect(out.body.placements).toEqual([{ character: 'Aldenmar', accountId: A1, slot: null, label: null }]);
  });

  it('a failed read is a 502, never an empty answer', async () => {
    expect((await mp.minePlacements(stubDb({ open: null }), freshCache(), '100')).status).toBe(502);
    expect((await mp.minePlacements(stubDb({ family: null }), freshCache(), '100')).status).toBe(502);
  });

  it('a person with no linked account is 403, and nobody is looked up', async () => {
    const db = stubDb({});
    expect((await mp.minePlacements(db, freshCache(), '')).status).toBe(403);
    expect(db.calls).toEqual([]);
  });

  it('an empty family or nothing placed is an honest empty list', async () => {
    expect((await mp.minePlacements(stubDb({ family: [] }), freshCache(), '100')).body).toEqual({ ok: true, placements: [] });
    expect((await mp.minePlacements(stubDb({ open: [] }), freshCache(), '100')).body).toEqual({ ok: true, placements: [] });
  });
});

describe('route wiring in index.js', () => {
  const src = stripJs(readSource(BOT_INDEX));

  it('the handler authenticates first and takes the person from the session, not the request', () => {
    const h = sliceBlock(src, 'async function _handleAgentAccountPlacements(req, res) {', '\n}');
    expect(h.indexOf('requireAgentAuth')).toBeGreaterThan(-1);
    expect(h.indexOf('if (!identity) return;')).toBeGreaterThan(h.indexOf('requireAgentAuth'));
    expect(h).toMatch(/identity\.discord_id/);
    expect(h).not.toMatch(/searchParams|req\.url|req\.body/);
  });

  it('GET /api/agent/account-placements is dispatched to it', () => {
    expect(src).toMatch(/req\.method === 'GET' && \(req\.url === '\/api\/agent\/account-placements'.{0,120}\{\s*try \{ return await _handleAgentAccountPlacements\(req, res\)/);
  });
});
