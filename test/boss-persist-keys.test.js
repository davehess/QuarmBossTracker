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
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

// The slice reads the bot's top-level `namedBosses` (utils/namedBosses.js) — the real module.
globalThis.__namedBosses = createRequire(import.meta.url)('../utils/namedBosses.js');
const src = readSource(BOT_INDEX);
const block = sliceBlock(
  src,
  'function _bossPersistKeys(',
  "console.warn('[lockout] promote failed for \"' + bossName + '\":', e?.message);\n  }\n}",
);
const { _bossPersistKeys, _resolveBossForPersist, _promoteLockoutBoss } =
  evalBlock('const console = { log(){}, warn(){} };\nconst namedBosses = globalThis.__namedBosses;\n' + block,
    ['_bossPersistKeys', '_resolveBossForPersist', '_promoteLockoutBoss']);

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
function fakeSupabase({ localByKey = {}, localByNpc = {}, eqemuByName = {}, autoByKey = {} }) {
  const inserts = [];
  const updates = [];
  return {
    inserts,
    updates,
    async update(table, query, body) {
      updates.push({ table, query, body });
      return [];
    },
    async select(table, query) {
      if (table === 'bosses_local' && query.startsWith('internal_id=in.')) {
        const keys = decodeURIComponent(query.slice('internal_id=in.('.length).split(')')[0]).split(',');
        // The promote path filters to auto-registered rows only.
        if (query.includes('auto_registered=eq.true')) {
          return keys.filter(k => autoByKey[k]).map(k => ({ internal_id: k }));
        }
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

describe('_resolveBossForPersist — curated PoP bosses register curated', () => {
  // The guild lead, 2026-10-21: the 2026-10-18 raid's /parses showed only Saryrn — Maareq,
  // Mithaniel Marr and the rest self-registered as trash and the cards filter to curated rows.
  it('a first kill of a data/named-bosses.json boss registers with auto_registered false', async () => {
    const sb = fakeSupabase({ eqemuByName: { Maareq_the_Prophet: 207004 } });
    const r = await _resolveBossForPersist('Maareq the Prophet', null, sb);
    expect(r).toEqual({ internalId: 'maareq_the_prophet', registered: true });
    expect(sb.inserts).toEqual([expect.objectContaining({ npc_id: 207004, auto_registered: false })]);
  });

  it('trash in the same zone still registers as auto', async () => {
    const sb = fakeSupabase({ eqemuByName: { An_acolyte_of_Pain: 207023 } });
    await _resolveBossForPersist('An acolyte of Pain', null, sb);
    expect(sb.inserts).toEqual([expect.objectContaining({ npc_id: 207023, auto_registered: true })]);
  });
});

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
      // Provenance flag: display surfaces filter on it (the guild lead, 2026-08-19,
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

  // The guild lead, 2026-10-30: "Falto should be included". The comma in the name ended the or=() value unquoted, and
  // PostgREST refused the whole query, so the fight was dropped.
  it('a comma name is double-quoted inside or=() and resolves', async () => {
    const queries = [];
    const sb = fakeSupabase({});
    const base = sb.select;
    sb.select = async (table, query) => {
      if (table !== 'eqemu_npc_types') return base(table, query);
      queries.push(query);
      // Like PostgREST: an unquoted comma inside a value is a parse error.
      const vals = [...query.matchAll(/name\.eq\.([^,)]+)/g)].map(m => decodeURIComponent(m[1]));
      if (vals.some(v => !v.startsWith('"') && v.includes(','))) throw new Error('PGRST100');
      return vals.map(v => v.replace(/^"|"$/g, '')).filter(v => v === 'Falto,_Lord_of_Thunder').map(() => ({ id: 210470 }));
    };
    const r = await _resolveBossForPersist('Falto, Lord of Thunder', null, sb);
    expect(queries[0]).toContain(encodeURIComponent('"Falto,_Lord_of_Thunder"'));
    expect(r).toEqual({ internalId: 'falto_lord_of_thunder', registered: true });
    expect(sb.inserts).toEqual([expect.objectContaining({ npc_id: 210470, auto_registered: false })]);
  });

  it('two bodies under one name: the curated named-boss id wins (the real Jeplak over the fake)', async () => {
    const sb = fakeSupabase({ eqemuByName: { 'Jeplak,_Lord_of_Srerendi': 210472, '#Jeplak,_Lord_of_Srerendi': 210300 } });
    sb.select = (orig => async (table, query) => orig(table, query.replace(/%22/g, '')))(sb.select);
    const r = await _resolveBossForPersist('Jeplak, Lord of Srerendi', null, sb);
    expect(r).toEqual({ internalId: 'jeplak_lord_of_srerendi', registered: true });
    expect(sb.inserts).toEqual([expect.objectContaining({ npc_id: 210472 })]);
  });

  it('the live path still prefers the curated id over the raw slug', async () => {
    const sb = fakeSupabase({ localByKey: { nanzata_warder: true, nanzata_the_warder: true } });
    const r = await _resolveBossForPersist('Nanzata the Warder', 'nanzata_warder', sb);
    expect(r.internalId).toBe('nanzata_warder');
  });
});

describe('_promoteLockoutBoss — "if they have a loot lockout we can keep them on" (Hitya 2026-08-19)', () => {
  it('a lockout/bosskill name flips its auto-registered row to curated', async () => {
    const sb = fakeSupabase({ autoByKey: { 'lord_rak_ashiir': true } });
    await _promoteLockoutBoss('Lord Rak`Ashiir', sb);
    expect(sb.updates).toEqual([{
      table: 'bosses_local',
      query: 'internal_id=eq.lord_rak_ashiir',
      body: { auto_registered: false },
    }]);
    expect(sb.inserts).toHaveLength(0);   // promotion NEVER creates rows
  });

  it('an already-curated or unknown name is a no-op (war gods, board bosses)', async () => {
    const sb = fakeSupabase({ localByKey: { tallon_zek: true } });   // curated, not auto
    await _promoteLockoutBoss('Tallon Zek', sb);
    await _promoteLockoutBoss('Somebody Unheard Of', sb);
    expect(sb.updates).toHaveLength(0);
    expect(sb.inserts).toHaveLength(0);
  });
});
