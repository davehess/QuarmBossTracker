// test/boss-persist-keys.test.js — the #47 encounter-persist resolver
// (SOURCE-SLICE fidelity tier: both functions are sliced out of the shipped
// bot, so edits to the real code are exercised here).
//
// The P1 this pins (2026-08-16, the Sleeper's Tomb first clear): live uploads
// carry the curated bosses.json id, but BACKFILL uploads skip the bosses.json
// match (so replays can't re-arm timers) and slugged the display name —
// 'nanzata_the_warder' never equals the curated 'nanzata_warder', and
// first-time content had no row at all, so the bot refused ~75 min of trash
// AND The Final Arbiter first kill while 200-acking every upload.
//
// Run: npx vitest run test/boss-persist-keys.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'function _bossPersistKeys(',
  'return { internalId: finalId, registered: true };\n}',
);
const { _bossPersistKeys, _resolveBossForPersist } =
  evalBlock('const console = { log(){}, warn(){} };\n' + block, ['_bossPersistKeys', '_resolveBossForPersist']);

describe('_bossPersistKeys — the three candidate keys', () => {
  it('backfilled board bosses heal via the article-stripped key', () => {
    // "The Final Arbiter" backfill has NO matchedBossId — the stripped slug
    // must reach the curated row 'final_arbiter'.
    expect(_bossPersistKeys('The Final Arbiter', null).keys)
      .toEqual(['the_final_arbiter', 'final_arbiter']);
    expect(_bossPersistKeys('The Progenitor', null).keys)
      .toEqual(['the_progenitor', 'progenitor']);
  });

  it('live path keeps the curated id FIRST', () => {
    const { keys } = _bossPersistKeys('Nanzata the Warder', 'nanzata_warder');
    expect(keys[0]).toBe('nanzata_warder');
    expect(keys).toContain('nanzata_the_warder');
  });

  it('eqemu forms are the underscored display name, plain and #-prefixed', () => {
    expect(_bossPersistKeys('Master of the Guard', null).eqemuForms)
      .toEqual(['Master_of_the_Guard', '#Master_of_the_Guard']);
    expect(_bossPersistKeys('an aged caretaker', null).eqemuForms)
      .toEqual(['an_aged_caretaker', '#an_aged_caretaker']);
  });

  it('empty/garbage names produce no keys rather than throwing', () => {
    expect(_bossPersistKeys('', null).keys).toEqual([]);
    expect(_bossPersistKeys(null, null).rawSlug).toBe(null);
  });
});

// Minimal fake of utils/supabase for the resolver — each test scripts the
// three tables it touches.
function fakeSupabase({ localByKey = {}, localByNpc = {}, eqemuByName = {} }) {
  const inserts = [];
  return {
    inserts,
    async select(table, query) {
      if (table === 'bosses_local' && query.startsWith('internal_id=in.')) {
        const keys = decodeURIComponent(query.slice('internal_id=in.('.length).split(')')[0]).split(',');
        return keys.filter(k => localByKey[k]).map(k => ({ internal_id: k }));
      }
      if (table === 'bosses_local' && query.startsWith('npc_id=eq.')) {
        const id = parseInt(query.slice('npc_id=eq.'.length), 10);
        // Reflect our own insert, like the real re-read does.
        const inserted = inserts.find(r => r.npc_id === id);
        if (inserted) return [{ internal_id: inserted.internal_id }];
        return localByNpc[id] ? [{ internal_id: localByNpc[id] }] : [];
      }
      if (table === 'eqemu_npc_types') {
        const names = [...query.matchAll(/name\.eq\.([^,)]+)/g)].map(m => decodeURIComponent(m[1]));
        return names.filter(n => eqemuByName[n] != null).map(n => ({ id: eqemuByName[n] }));
      }
      return [];
    },
    async insertIgnoreDuplicates(table, rows) {
      if (table === 'bosses_local') inserts.push(...rows);
      return rows;
    },
  };
}

describe('_resolveBossForPersist — resolution order', () => {
  it('THE P1 CASE: a backfilled "The Final Arbiter" resolves to the curated row', async () => {
    const sb = fakeSupabase({ localByKey: { final_arbiter: true } });
    const r = await _resolveBossForPersist('The Final Arbiter', null, sb);
    expect(r).toEqual({ internalId: 'final_arbiter', registered: false });
    expect(sb.inserts).toHaveLength(0);
  });

  it('a curated npc reached via eqemu reuses its existing internal_id', async () => {
    // Slug misses entirely, but the npc is already curated under another id.
    const sb = fakeSupabase({
      eqemuByName: { '#Nanzata_the_Warder': 128090 },
      localByNpc: { 128090: 'nanzata_warder' },
    });
    const r = await _resolveBossForPersist('Nanzata the Warder', null, sb);
    expect(r).toEqual({ internalId: 'nanzata_warder', registered: false });
    expect(sb.inserts).toHaveLength(0);
  });

  it('first-time content self-registers and persists under its slug', async () => {
    const sb = fakeSupabase({ eqemuByName: { '#Master_of_the_Guard': 128120 } });
    const r = await _resolveBossForPersist('Master of the Guard', null, sb);
    expect(r).toEqual({ internalId: 'master_of_the_guard', registered: true });
    expect(sb.inserts).toEqual([expect.objectContaining({
      npc_id: 128120, internal_id: 'master_of_the_guard',
      // Provenance flag: display surfaces filter on it (Hitya 2026-08-19,
      // the /parses trash-card flood) — a self-registered row must never
      // masquerade as curated.
      auto_registered: true,
    })]);
  });

  it('a name with NO exact eqemu match is refused — the junk filter holds', async () => {
    // 'Labanab' — a mis-parsed player name — must not mint a bosses_local row.
    const sb = fakeSupabase({});
    expect(await _resolveBossForPersist('Labanab', null, sb)).toBe(null);
    expect(sb.inserts).toHaveLength(0);
  });

  it('an AMBIGUOUS eqemu match (two distinct npcs) is refused, not guessed', async () => {
    const sb = fakeSupabase({ eqemuByName: { Tunare: 127001, '#Tunare': 127002 } });
    expect(await _resolveBossForPersist('Tunare', null, sb)).toBe(null);
  });

  it('the live path still prefers the curated id over the raw slug', async () => {
    const sb = fakeSupabase({ localByKey: { nanzata_warder: true, nanzata_the_warder: true } });
    const r = await _resolveBossForPersist('Nanzata the Warder', 'nanzata_warder', sb);
    expect(r.internalId).toBe('nanzata_warder');
  });
});
