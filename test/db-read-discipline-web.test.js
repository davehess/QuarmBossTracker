// test/db-read-discipline-web.test.js — the WEB half of the database read guard.
//
// The guild lead, 2026-10-04: "review all of the other tables for silent 500 or 100 caps. I thought
// we had something in the design." The design (docs/ARCHITECT-REBUILD-2026-08-16.md Decision #2, "one
// paged reader … the 1,000-row cap solved once, structurally") was never finished: web/lib/selectAll.ts
// existed, and test/db-read-discipline.test.js counted `.limit(N>1000)` text and nothing else.
// PostgREST returns at most 1,000 rows a response, silently, for tables, views AND set-returning
// functions. What that guard could not see, measured on production 2026-10-04:
//   · pop_spell_needs, an RPC read in one call: 2,712 rows, 1,000 shown (29 characters read "nothing missing")
//   · a page walk ordered on a NON-unique key: character_inventory ordered (character_name, item_name,
//     item_id) returned 49,406 distinct rows of 49,418 — 12 never came back (/quartermaster)
//   · a failed page ending the walk with a silent partial set (selectAll, the PoP loot reader, item-link)
//   · pop_flags read for one household with `.limit(1000)`: three households hold over 1,000 rows
//     (max 2,291), all 'unmapped' so far; real flags are the newest rows, so the first real flag any of
//     them earns would fall past the 1,000 the read returns
//
// This file does three things.
//   1. BEHAVIOUR: a fake PostgREST that ENFORCES the 1,000-row cap and honours order/range (and, like
//      Postgres, orders tied rows differently from one page's query to the next) is driven by the real
//      query chains lifted out of the page sources. The old chain loses rows; the shipped one does not.
//   2. MIGRATION: 20261004140800_cap_safe_pop.sql text checks.
//   3. RATCHETS over web/**: counts that may only go DOWN —
//        (a) `.range(0, N)` with N >= 1000 used as one call,
//        (b) a set-returning `.rpc()` read without paging,
//        (c) a read of a big table/view with no paging, single row, count or small limit,
//        (d) a paged read ordered on a non-unique key.
//      The baselines below were counted on the branch that introduced this file, which could not see
//      the fixes other agents made the same round; re-pin them after merging. They tighten, never loosen.
//
// Run: npx vitest run test/db-read-discipline-web.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  webSources, readChains, lineOf, overCapRanges, unpagedSetReturningRpcs, unboundedBigReads,
  pagedOrderProblems, pagedRpcNames, migrationFunctions,
} from './_web-read-scan.js';
import { selectAll } from '../web/lib/selectAll.ts';
import { loadItemCatalog } from '../web/lib/item-link.ts';

// roster.ts and ownedCharacters.ts import react's cache() and the service client by their app aliases.
const db = vi.hoisted(() => ({ client: null }));
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => db.client }));
vi.mock('@/lib/roster', async () => await import('../web/lib/roster.ts'));
// `react` resolves differently by machine: CI installs only the root dependencies, so the bare id is all
// there is; a checkout with web/ installed resolves it to a file under web/node_modules, and a mock
// registered under the bare id would miss. Register both (the same dance fun-ld-quit.test.js does for
// next/cache). React 18's stable build has no cache(); Next supplies it inside a request.
const reactMock = { cache: (fn) => fn };
vi.doMock('react', () => reactMock);
try {
  vi.doMock(createRequire(new URL('../web/package.json', import.meta.url)).resolve('react'), () => reactMock);
} catch { /* web/ not installed here */ }
const { fetchRoster, loadRoster, loadNameMap } = await import('../web/lib/roster.ts');
const { ownedCharacters } = await import('../web/lib/ownedCharacters.ts');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── A fake PostgREST ────────────────────────────────────────────────────────
// Enforces the response cap, runs eq/neq/in/not-in/or(ilike|eq) filters, orders by the requested
// columns, honours range/limit/maybeSingle, and breaks ties the way a real planner can: a page's
// query is its own `ORDER BY … LIMIT … OFFSET …`, so rows that tie on every ORDER BY column may come
// back in a different order on the next page (top-N heapsort vs a full sort). Here the tie order
// flips with the page number. A query ordered on a unique key has no ties and never feels it.
const PHYS = Symbol('physical position');

function fakeDb(tables, { cap = 1000, rpcs = {}, failPage = null } = {}) {
  const store = {};
  for (const [name, rows] of Object.entries(tables)) {
    store[name] = rows.map((r, i) => Object.defineProperty({ ...r }, PHYS, { value: i }));
  }
  const requests = [];

  class Query {
    constructor(name, rows, ordered) {
      this.name = name; this.rows = rows; this.ordered = ordered;
      this.preds = []; this.ord = []; this.lo = null; this.hi = null; this.lim = null; this.one = false;
    }
    select() { return this; }
    eq(c, v) { this.preds.push(r => r[c] === v); return this; }
    neq(c, v) { this.preds.push(r => r[c] !== v); return this; }
    in(c, vs) { const s = new Set(vs); this.preds.push(r => s.has(r[c])); return this; }
    not(c, op, v) {
      if (op !== 'in') throw new Error('fake: not() supports in only');
      const s = new Set(v.replace(/^\(|\)$/g, '').split(','));
      this.preds.push(r => !s.has(r[c]));
      return this;
    }
    or(clause) {
      const alts = clause.split(',').map((part) => {
        const [col, op, ...rest] = part.split('.');
        const val = rest.join('.');
        if (op === 'ilike') return r => String(r[col]).toLowerCase() === val.toLowerCase();
        if (op === 'eq') return r => String(r[col]) === val;
        throw new Error(`fake: or() op ${op}`);
      });
      this.preds.push(r => alts.some(f => f(r)));
      return this;
    }
    order(c, o = {}) { this.ord.push({ c, asc: o.ascending !== false }); return this; }
    range(a, b) { this.lo = a; this.hi = b; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.one = true; return this; }
    then(ok, bad) { return Promise.resolve(this.exec()).then(ok, bad); }
    exec() {
      const page = this.lo == null ? 0 : Math.floor(this.lo / 1000);
      requests.push({ name: this.name, lo: this.lo, hi: this.hi });
      const failure = failPage && failPage({ name: this.name, lo: this.lo });
      if (failure) return { data: null, error: failure };
      let rows = this.rows.filter(r => this.preds.every(p => p(r)));
      if (this.ord.length) {
        rows = [...rows].sort((a, b) => {
          for (const { c, asc } of this.ord) {
            if (a[c] !== b[c]) return (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1);
          }
          return (page % 2 === 0 ? 1 : -1) * (a[PHYS] - b[PHYS]);     // tied rows: order flips by page
        });
      }
      const start = this.lo ?? 0;
      const want = this.hi != null ? this.hi - this.lo + 1 : (this.lim ?? rows.length);
      const n = Math.min(this.lim != null ? Math.min(want, this.lim) : want, cap);   // the silent cap
      const data = rows.slice(start, start + n).map(r => ({ ...r }));
      return { data: this.one ? (data[0] ?? null) : data, error: null };
    }
  }

  return {
    requests,
    from: (name) => new Query(name, store[name] ?? [], false),
    rpc: (fn, args) => new Query(fn, rpcs[fn] ? rpcs[fn](args) : [], true),
  };
}

// The chain `<recv>.from('x')…` / `<recv>.rpc('x', …)…` exactly as a page wrote it, as a builder
// `(from, to) => …` (or the bare expression), bound to a fake client under the page's own name for it.
function lift(rel, kind, name, vars = {}, { nth = 0, mutate = (s) => s, builder = true } = {}) {
  const src = stripJs(read(rel));
  const c = readChains(src).filter(x => x.kind === kind && x.name === name)[nth];
  if (!c) throw new Error(`no ${kind}('${name}') chain #${nth} in ${rel}`);
  const recv = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, c.at - 60), c.at))[1];
  const expr = src.slice(c.at, c.end);
  const mutated = mutate(expr);
  return {
    recv, expr, changed: mutated !== expr,
    make: (client) => new Function(recv, ...Object.keys(vars),
      `return ${builder ? '(from, to) => ' : ''}${recv}${mutated}`)(client, ...Object.values(vars)),
  };
}

const ids = (rows) => rows.map(r => r.id);
const distinct = (xs) => new Set(xs).size;

// ═══ 1. BEHAVIOUR ════════════════════════════════════════════════════════════

describe('the fake PostgREST is a fair witness', () => {
  it('enforces the cap that .limit() and one wide .range() cannot raise', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const client = fakeDb({ t: rows });
    expect((await client.from('t').select().limit(50_000)).data).toHaveLength(1000);
    expect((await client.from('t').select().range(0, 99_999)).data).toHaveLength(1000);
    expect((await client.from('t').select().order('id').range(1000, 1999)).data[0].id).toBe(1000);
  });

  it('reorders tied rows between pages, and a unique key has no ties to reorder', async () => {
    // 999 distinct keys, then two rows that tie on k at sort positions 999 and 1000: the page boundary.
    const rows = [
      ...Array.from({ length: 999 }, (_, i) => ({ id: i + 1, k: `a${String(i).padStart(4, '0')}` })),
      { id: 5001, k: 'zz' }, { id: 5002, k: 'zz' },
    ];
    const client = fakeDb({ t: rows });
    const last0 = (await client.from('t').order('k').range(0, 999)).data.at(-1).id;
    const first1 = (await client.from('t').order('k').range(1000, 1999)).data[0].id;
    expect(first1, 'the tied row that ended page 0 starts page 1: one row doubled, the other never returned').toBe(last0);
    // Ending the order on the primary key removes the ties, so both pages agree.
    const last0Pk = (await client.from('t').order('k').order('id').range(0, 999)).data.at(-1).id;
    const first1Pk = (await client.from('t').order('k').order('id').range(1000, 1999)).data[0].id;
    expect([last0Pk, first1Pk]).toEqual([5001, 5002]);
  });
});

describe('/quartermaster: the inventory walk ends on the primary key (12 of 49,418 rows were never returned)', () => {
  // Character "Aaa" holds Item 0999 in two slots: a tie in (character_name, item_name, item_id) that
  // straddles the page boundary (sort positions 999 and 1000).
  const inventory = () => {
    const rows = [];
    let id = 1;
    const add = (character_name, item_name, item_id, slot_label) =>
      rows.push({ id: id++, guild_id: 'wolfpack', character_name, item_name, item_id, slot_label, quantity: 1 });
    for (let i = 0; i < 999; i++) add('Aaa', `Item ${String(i).padStart(4, '0')}`, 100 + i, `General${i}`);
    add('Aaa', 'Item 0999', 1099, 'General999');
    add('Aaa', 'Item 0999', 1099, 'Bank1');
    for (let i = 0; i < 1400; i++) add('Bbb', `Thing ${String(i).padStart(4, '0')}`, 5000 + i, `Slot${i}`);
    return rows;
  };
  const REL = 'web/app/quartermaster/page.tsx';
  const vars = { invNames: ['Aaa', 'Bbb'] };

  it('the shipped order returns every row exactly once', async () => {
    const table = inventory();
    const build = lift(REL, 'from', 'character_inventory', vars).make(fakeDb({ character_inventory: table }));
    const got = await selectAll(build);
    expect(got).toHaveLength(table.length);
    expect(distinct(ids(got))).toBe(table.length);
  });

  it('the OLD order (no id) loses a row and returns another twice — the fake would have caught it', async () => {
    const table = inventory();
    const old = lift(REL, 'from', 'character_inventory', vars, { mutate: (s) => s.replace(".order('id')", '') });
    expect(old.changed, 'the shipped chain no longer ends .order(\'id\'): update this test with it').toBe(true);
    const got = await selectAll(old.make(fakeDb({ character_inventory: table })));
    expect(got).toHaveLength(table.length);                    // same count…
    expect(distinct(ids(got))).toBeLessThan(table.length);     // …but a row is missing and another doubled
  });

  it('reads the kit-gear rows through selectAll, ordered on the rest of the primary key', async () => {
    const gear = Array.from({ length: 2300 }, (_, i) => ({
      guild_id: 'wolfpack', character: `C${String(Math.floor(i / 2)).padStart(4, '0')}`, loc: i % 2 ? 'bag' : 'equipped', slot: 'Slot', item_id: 1,
    }));
    const build = lift(REL, 'from', 'character_gear', { KIT_ITEM_IDS: [1] }).make(fakeDb({ character_gear: gear }));
    expect(await selectAll(build)).toHaveLength(2300);          // was `.limit(20000)`, which stops at 1,000
  });
});

describe('/pop/guide: a household\'s real flags are not crowded out by thousands of unmapped rows', () => {
  // Three households hold more than 1,000 pop_flags rows (max 2,291) because 'unmapped' grants are
  // stored per grant, ~1,700 a day; max real flags per household is 26. Heap order puts the older
  // unmapped rows first, so a bare .limit(1000) returns nothing but unmapped, and a real flag earned
  // later sits past it. (Those three have no real flag yet, which is why nobody saw it.)
  const flags = () => {
    const rows = [];
    for (let i = 0; i < 2265; i++) rows.push({ character: 'Aaa', flag_key: 'unmapped', earned_at: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}` });
    for (let i = 0; i < 20; i++) rows.push({ character: 'Aaa', flag_key: 'hail', earned_at: '2026-10-02' });
    for (let i = 0; i < 26; i++) rows.push({ character: 'Aaa', flag_key: `real_${i}`, earned_at: '2026-10-03' });
    return rows;
  };
  const REL = 'web/app/pop/guide/page.tsx';

  it('returns the 26 real flags and nothing else', async () => {
    const q = lift(REL, 'from', 'pop_flags', { names: ['aaa'] }, { builder: false }).make(fakeDb({ pop_flags: flags() }));
    const got = (await q).data;
    expect(got).toHaveLength(26);
    expect(got.every(r => r.flag_key.startsWith('real_'))).toBe(true);
  });

  it('without the not-in filter the same read returns 1,000 unmapped rows and no real flag', async () => {
    const old = lift(REL, 'from', 'pop_flags', { names: ['aaa'] }, {
      builder: false, mutate: (s) => s.replace(/\s*\.not\('flag_key', 'in', '\(unmapped,hail\)'\)/, ''),
    });
    expect(old.changed, 'the shipped read no longer carries .not(flag_key in (unmapped,hail)): update this test').toBe(true);
    const got = (await old.make(fakeDb({ pop_flags: flags() }))).data;
    expect(got).toHaveLength(1000);
    expect(got.some(r => r.flag_key.startsWith('real_'))).toBe(false);
  });
});

describe('/pop and /pop/guide: the RPCs are read a page at a time', () => {
  const needs = Array.from({ length: 2712 }, (_, i) => ({ spell_name: `Spell ${i}`, character_name: `C${i % 117}` }));
  const sightings = Array.from({ length: 2230 }, (_, i) => ({ character_key: `c${i}`, zone: 'postorms' }));

  it('pop_spell_needs: all 2,712 rows, where one call stopped at 1,000', async () => {
    const client = fakeDb({}, { rpcs: { pop_spell_needs: () => needs } });
    const shipped = lift('web/app/pop/page.tsx', 'rpc', 'pop_spell_needs');
    expect(await selectAll(shipped.make(client))).toHaveLength(2712);
    expect(client.requests.map(r => [r.lo, r.hi])).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    const old = lift('web/app/pop/page.tsx', 'rpc', 'pop_spell_needs', {}, { builder: false, mutate: (s) => s.replace(/\.range\(from, to\)/, '') });
    expect(old.changed).toBe(true);
    expect((await old.make(fakeDb({}, { rpcs: { pop_spell_needs: () => needs } }))).data).toHaveLength(1000);
  });

  it('pop_who_sightings: the page and the route data both read every row', async () => {
    for (const [rel, vars] of [
      ['web/app/pop/page.tsx', { nameOf: new Map([['aaa', 'Aaa']]), WHO_ZONE_NAMES: ['postorms'] }],
      ['web/app/pop/guide/routeData.ts', { lower: ['aaa'], WHO_ZONE_NAMES: ['postorms'] }],
    ]) {
      const client = fakeDb({}, { rpcs: { pop_who_sightings: () => sightings } });
      expect(await selectAll(lift(rel, 'rpc', 'pop_who_sightings', vars).make(client)), rel).toHaveLength(2230);
    }
  });

  it('pop_spellbook_names: one row per character asked about, so a 1,093-row household cannot hide a spellbook', async () => {
    // The old read took the household's spellbook ROWS (limit 1000) and kept the names.
    const client = fakeDb({}, { rpcs: { pop_spellbook_names: ({ p_names }) => p_names.map(n => ({ character_key: n })) } });
    const got = await selectAll(lift('web/app/pop/page.tsx', 'rpc', 'pop_spellbook_names', { myChars: [{ name: 'Aaa' }, { name: 'Bbb' }] }).make(client));
    expect(got.map(r => r.character_key)).toEqual(['aaa', 'bbb']);
  });

  it('a page that fails throws; the page does not draw a short list', async () => {
    const client = fakeDb({}, { rpcs: { pop_spell_needs: () => needs }, failPage: ({ lo }) => (lo === 1000 ? { message: 'canceling statement due to statement timeout' } : null) });
    await expect(selectAll(lift('web/app/pop/page.tsx', 'rpc', 'pop_spell_needs').make(client)))
      .rejects.toThrow(/rows 1000-1999 failed after 1000 loaded: canceling statement due to statement timeout/);
  });
});

describe('the roster: one paged, per-request read', () => {
  // Stored in name order with `extra` appended last (new rows land at the end of a heap, which is where an
  // unordered, capped read would never reach).
  const characters = (n, extra = []) => [
    ...Array.from({ length: n }, (_, i) => ({ guild_id: 'wolfpack', name: `C${String(i).padStart(4, '0')}`, main_name: null, discord_id: `x${i}`, class: 'Cleric', active: true })),
    ...extra,
  ];

  it('fetchRoster returns every character past the 1,000-row cap, in name order', async () => {
    const client = fakeDb({ characters: characters(1200).reverse() });   // stored backwards: only .order('name') puts it right
    const roster = await fetchRoster(client);
    expect(roster).toHaveLength(1200);
    expect(roster.map(r => r.name)).toEqual([...roster.map(r => r.name)].sort());
    expect(client.requests.map(r => r.lo)).toEqual([0, 1000]);
  });

  it('fetchRoster throws when a page fails (a short roster would read as a small guild)', async () => {
    const client = fakeDb({ characters: characters(1200) }, { failPage: ({ lo }) => (lo === 1000 ? { message: 'boom' } : null) });
    await expect(fetchRoster(client)).rejects.toThrow(/failed after 1000 loaded: boom/);
  });

  it('loadNameMap folds alts into mains from the shared roster, ghosts unknown', async () => {
    db.client = fakeDb({ characters: characters(3, [
      { guild_id: 'wolfpack', name: 'Zmain', main_name: null },
      { guild_id: 'wolfpack', name: 'Zalt', main_name: 'Zmain' },
    ]) });
    const names = await loadNameMap();
    expect(names.mainOf('zalt')).toBe('Zmain');
    expect(names.mainOf('Ghost')).toBe('Ghost');
    expect(names.isKnown('ZMAIN')).toBe(true);
    expect(names.isKnown('Ghost')).toBe(false);
    expect(await loadRoster()).toHaveLength(5);
  });

  it('ownedCharacters finds a household whose characters sit past row 1,000 of the roster', async () => {
    // The old read was one select of `characters`: 1,000 rows, then nothing — "Zmain" and "Zalt" sort last.
    db.client = fakeDb({
      wolfpack_members: [{ user_id: 'u1', discord_id: 'd1', merged_into_discord_id: null }],
      characters: characters(1200, [
        { guild_id: 'wolfpack', name: 'Zmain', main_name: null, discord_id: 'd1', class: 'Bard', active: true, rank: 'Raid Pack', hidden_from_lists: false },
        { guild_id: 'wolfpack', name: 'Zalt', main_name: 'Zmain', discord_id: null, class: 'Cleric', active: true, rank: 'Raid Alt', hidden_from_lists: false },
      ]),
    });
    const mine = await ownedCharacters('u1');
    expect(mine.map(c => c.name).sort()).toEqual(['Zalt', 'Zmain']);
    expect(mine[0]).not.toHaveProperty('discord_id');       // the roster row's discord_id never leaves the helper
  });
});

describe('item-link: a failed catalog page throws and is not cached for an hour', () => {
  const catalog = (failAt = null) => {
    let calls = 0;
    return {
      get calls() { return calls; },
      from: () => ({
        select: () => ({
          order: () => ({
            range: (lo) => {
              calls++;
              const page = lo / 1000;
              if (page === failAt) return Promise.resolve({ data: null, error: { message: 'statement timeout' } });
              return Promise.resolve({ data: page === 0 ? [{ name: 'Hand of Fate', id: 5 }, { name: 'Cap', id: 6 }] : [], error: null });
            },
          }),
        }),
      }),
    };
  };

  it('throws on a failed page, then reads cleanly (nothing partial was cached), then serves from cache', async () => {
    await expect(loadItemCatalog(catalog(7))).rejects.toThrow(/page 7 .* failed: statement timeout/);
    const ok = catalog();
    const map = await loadItemCatalog(ok);
    expect(map.get('Hand of Fate')).toBe(5);
    expect(map.has('Cap'), 'single-word names are not linkable').toBe(false);
    const before = ok.calls;
    await loadItemCatalog(catalog(0));                           // would throw if it read: it is cached
    expect(ok.calls).toBe(before);
  });

  it('the officers\' chat log still renders without links when the catalog is unavailable', () => {
    const page = stripJs(read('web/app/admin/chat/page.tsx'));
    expect(page).toMatch(/await loadItemCatalog\(supabaseAdmin\(\)\)\.catch\(/);
  });
});

describe('selectAll itself', () => {
  it('a failed page throws; the old `if (error) break` is gone', () => {
    const src = stripJs(read('web/lib/selectAll.ts'));
    expect(src).toMatch(/throw new Error\(`selectAll: rows /);
    expect(src).not.toMatch(/if \(error\) break/);
    expect(src).not.toMatch(/if \(!data\) break/);
  });
  it('the page size stays clamped to the API cap', () => {
    expect(stripJs(read('web/lib/selectAll.ts'))).toMatch(/Math\.min\(opts\.page \?\? PGRST_MAX_ROWS, PGRST_MAX_ROWS\)/);
  });
  it('hitting the hardCap is logged, not only offered to a callback nobody passed', () => {
    expect(stripJs(read('web/lib/selectAll.ts'))).toMatch(/console\.warn\(`selectAll: stopped at the/);
  });
});

describe('/fun: two aggregates come from SQL, not from a JS tally over a capped select', () => {
  const fun = stripJs(read('web/app/fun/page.tsx'));
  it('Mana donated and Mind Wracks read fun_caster_tally through selectAll', () => {
    expect(fun).toMatch(/sb\.rpc\('fun_caster_tally', \{ p_event_type: 'mana_twitch' \}\)\.range\(from, to\)/);
    expect(fun).toMatch(/sb\.rpc\('fun_caster_tally', \{ p_event_type: 'mind_wrack_cast' \}\)\.range\(from, to\)/);
  });
  it('and no longer select the events themselves to sum them', () => {
    expect(fun).not.toMatch(/select\('caster, reagent_qty'\)/);
    expect(fun).not.toMatch(/select\('caster', \{ count: 'exact' \}\)\.eq\('event_type', 'mind_wrack_cast'\)/);
  });
  it('the two selectAll walks over fun_events end on the primary key', () => {
    const walks = readChains(fun).filter(c => c.kind === 'from' && c.name === 'fun_events'
      && c.calls.some(x => x.name === 'range'));
    expect(walks).toHaveLength(2);
    for (const w of walks) expect(w.calls.filter(x => x.name === 'order').map(x => x.args.split(',')[0].replace(/['"\s]/g, ''))).toEqual(['event_ts', 'id']);
  });
});

// ═══ 2. THE MIGRATION ════════════════════════════════════════════════════════

describe('20261004140800_cap_safe_pop.sql', () => {
  const FILE = 'supabase/migrations/20261004140800_cap_safe_pop.sql';
  const sql = stripSql(read(FILE));
  const body = (name) => {
    const start = sql.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
    expect(start, `${name} is not defined in the migration`).toBeGreaterThanOrEqual(0);
    const open = /as\s+(\$[a-z]*\$)/i.exec(sql.slice(start));
    const from = start + open.index + open[0].length;
    return sql.slice(from, sql.indexOf(open[1], from));
  };
  const tail = (text) => text.trim().split('\n').pop().trim();

  it('defines the four functions, each CREATE OR REPLACE, SECURITY INVOKER with a pinned search_path', () => {
    for (const fn of ['pop_who_sightings', 'pop_spell_needs', 'pop_spellbook_names', 'fun_caster_tally']) body(fn);
    expect(sql.match(/create or replace function/gi)).toHaveLength(4);
    expect(sql.match(/security invoker/gi)).toHaveLength(4);
    expect(sql.match(/set search_path = public/gi)).toHaveLength(4);
    expect(sql).not.toMatch(/security definer/i);
  });

  it('pop_who_sightings ends ORDER BY on its GROUP BY key, so a page walk is stable', () => {
    const fn = body('pop_who_sightings');
    expect(fn).toMatch(/group by lower\(w\.character\), w\.zone/);
    expect(tail(fn)).toBe('order by lower(w.character), w.zone');
  });

  it('pop_spell_needs ends its ORDER BY on (spell_name, name, tier) and reads levels by index, not through who_directory', () => {
    const fn = body('pop_spell_needs');
    expect(tail(fn)).toBe('ORDER BY m.lvl DESC NULLS LAST, COALESCE(scl.level, s.seed_level) DESC, s.spell_name, m.name, pp.tier');
    // The view scans every row of who_observations on each call (2.4 s to 4.4 s measured 2026-10-04); a
    // paged read calls the function once per page.
    expect(fn).not.toMatch(/who_directory/i);
    expect(fn).toMatch(/LEFT JOIN LATERAL \(\s*SELECT o\.level\s*FROM who_observations o\s*WHERE lower\(o\."character"\) = lower\(c\.name\)\s*AND o\.level IS NOT NULL\s*ORDER BY o\.observed_at DESC\s*LIMIT 1\s*\) wl ON true/);
    expect(fn).toMatch(/wl\.level AS lvl/);
  });

  it('pop_spell_needs keeps the signature and every other clause of v4 (20260826010000)', () => {
    const v4 = stripSql(read('supabase/migrations/20260826010000_pop_spell_needs_all_characters.sql'));
    const old = v4.slice(v4.indexOf('$function$') + 10, v4.lastIndexOf('$function$'));
    const mine = body('pop_spell_needs');
    // Same text once the two intended edits are undone.
    const undone = mine
      .replace(/LEFT JOIN LATERAL \([\s\S]*?\) wl ON true/, 'LEFT JOIN who_directory wd ON wd.character_key = lower(c.name)')
      .replace('wl.level AS lvl', 'wd.level AS lvl')
      .replace(', m.name, pp.tier', ', m.name');
    expect(undone.replace(/\s+/g, ' ').trim()).toBe(old.replace(/\s+/g, ' ').trim());
    for (const col of ['spell_name text', 'spell_id integer', 'scroll_item_id integer', 'spell_level integer', 'tier text',
      'character_name text', 'char_class text', 'char_level integer', 'held_by text[]', 'is_main boolean']) {
      expect(sql, col).toContain(col);
    }
  });

  it('pop_spellbook_names and fun_caster_tally return one row per key, ordered', () => {
    const names = body('pop_spellbook_names');
    expect(names).toMatch(/select distinct lower\(sb\.character_name\)/);
    expect(tail(names)).toBe('order by 1');
    const tally = body('fun_caster_tally');
    expect(tally).toMatch(/group by 1/);
    expect(tail(tally)).toBe('order by 1');
    expect(tally).toMatch(/coalesce\(nullif\(e\.caster, ''\), 'unknown'\)/);
  });

  it('the service key is the only caller: new functions and pop_who_sightings are revoked from everyone else', () => {
    for (const [fn, args] of [['pop_who_sightings', 'text, text\\[\\], text\\[\\]'], ['pop_spellbook_names', 'text, text\\[\\]'], ['fun_caster_tally', 'text']]) {
      expect(sql, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(${args}\\) from public, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\(${args}\\) to service_role;`));
    }
  });

  it('is idempotent and touches no data', () => {
    expect(sql).not.toMatch(/create\s+function/i);                       // always OR REPLACE
    expect(sql).not.toMatch(/\bdrop\s+(function|table|column|index)\b/i);
    expect(sql).not.toMatch(/\b(delete\s+from|truncate|insert\s+into|alter\s+table|create\s+(table|index))\b/i);
    expect(sql).not.toMatch(/\bupdate\s+\w+\s+set\b/i);
  });
});

describe('every function the web pages through has an outer ORDER BY', () => {
  const fns = migrationFunctions(stripSql);
  const webPaged = new Set();
  for (const f of webSources()) for (const n of pagedRpcNames(stripJs(read(f)))) webPaged.add(n);

  it('lists the paged RPCs the site reads today', () => {
    expect([...webPaged].sort()).toEqual(expect.arrayContaining(
      ['pop_loot_sightings', 'pop_spell_needs', 'pop_spellbook_names', 'pop_who_sightings', 'fun_caster_tally']));
  });

  for (const name of ['pop_loot_sightings', 'pop_spell_needs', 'pop_spellbook_names', 'pop_who_sightings', 'fun_caster_tally']) {
    it(`${name}: the last migration that defines it ends in an ORDER BY (not a subquery's)`, () => {
      const def = fns.get(name);
      expect(def?.setReturning, `${name} is not a set-returning function in the migrations`).toBe(true);
      const sql = stripSql(read(`supabase/migrations/${def.file}`));
      const header = sql.slice(def.at);
      const open = /\bas\s+(\$[a-z]*\$)/i.exec(header);
      const from = open.index + open[0].length;
      const fnBody = header.slice(from, header.indexOf(open[1], from));
      const at = fnBody.toLowerCase().lastIndexOf('order by');
      expect(at, `${name} (${def.file}) has no ORDER BY`).toBeGreaterThan(0);
      expect(fnBody.slice(at), `${name}'s last ORDER BY belongs to a subquery`).not.toMatch(/\b(from|where|select)\b/i);
    });
  }
});

// ═══ 3. THE RATCHETS ═════════════════════════════════════════════════════════

// Tables and materialized/plain views over 1,000 rows. Tables: pg_class.reltuples > 1000 on production,
// measured 2026-10-04. Views: count(*) on 2026-10-04, for the views the site reads (reltuples is not kept
// for a view). A name that crosses 1,000 later belongs here: add it, and re-pin (c).
const BIG_TABLES = `
  encounter_threat_snapshots chat_messages encounter_combat_rollup encounter_events encounter_players
  who_observations buff_casts faction_hits trigger_timing_feedback eqemu_tradeskill_recipe_entries
  character_inventory zeal_tag_observations opendkp_audits contributions eqemu_lootdrop_entries eqemu_spawn2
  fun_events page_views encounter_threat_rank target_observations faction_cons looted_items encounters
  eqemu_items opendkp_auction_bids eqemu_spawnentry eqemu_merchantlist eqemu_loottable_entries pop_flags
  opendkp_call_stats eqemu_npc_types encounter_threat_graph character_spellbook tells rh_signups
  eqemu_spawngroup opendkp_auctions xp_events eqemu_lootdrop character_gear loot_observations opendkp_loot
  eqemu_doors eqemu_faction_list_mod eqemu_tradeskill_recipe eqemu_loottable faction_standing
  eqemu_quest_scripts eqemu_npc_faction_entries scripted_npc_turnins eqemu_npc_spells_entries
  eqemu_npc_emotes eqemu_spells roll_sets character_lockouts charm_sessions eqemu_faction_list_full
  pvp_deaths agent_upload_stats bosses_local eqemu_npc_faction opendkp_ticks eqemu_zone_points
  eqemu_npc_spells eqemu_spell_pop eqemu_forage character_aas ui_socials_index character_live_state
`.split(/\s+/).filter(Boolean);
const BIG_VIEWS = `
  character_data_floor character_rollup_coverage encounter_upload_counts item_with_proc opendkp_loot_recent
  who_directory eqemu_npc_drops adoption_uploader_days
`.split(/\s+/).filter(Boolean);
const BIG = new Set([...BIG_TABLES, ...BIG_VIEWS]);

// A unique key for every table or view the site pages through (pg_index.indisunique, 2026-10-04). guild_id
// is left out of a key because this app has one guild and its reads fix it with .eq() or ignore it.
// opendkp_loot_recent is a view whose rows fan out when two characters share an opendkp_id, so only the
// whole tuple is unique (9,251 rows, 9,251 distinct tuples; auction_id alone has 26 repeats).
const UNIQUE_KEYS = {
  characters: [['name']],
  character_inventory: [['id'], ['character_name', 'slot_label']],
  character_gear: [['character', 'loc', 'slot']],
  character_spellbook: [['id'], ['character_name', 'spell_id']],
  character_lockouts: [['character', 'boss_key']],
  fun_events: [['id']],
  pop_flags: [['id']],
  pop_guide_ticks: [['character_name', 'item_key']],
  looted_items: [['id']],
  roll_sets: [['id']],
  opendkp_ticks: [['tick_id']],
  opendkp_raids: [['raid_id']],
  opendkp_auction_bids: [['id'], ['auction_id', 'character_name', 'value']],
  opendkp_loot_recent: [['raid_date', 'character_name', 'item_name', 'auction_id']],
  agent_upload_stats: [['character', 'endpoint']],
  wolfpack_members: [['discord_id']],
  eqemu_items: [['id']],
  eqemu_npc_types: [['id']],
  eqemu_faction_list_full: [['id']],
  eqemu_npc_faction_entries: [['npc_faction_id', 'faction_id']],
  adoption_uploader_days: [['discord_id', 'day']],
  encounter_upload_counts: [['encounter_id']],
  who_directory: [['character_key']],
};

const SOURCES = webSources().map(f => [f, stripJs(read(f))]);
const SET_RETURNING = new Set([...migrationFunctions(stripSql)].filter(([, v]) => v.setReturning).map(([k]) => k));

const sites = (fn) => SOURCES.flatMap(([f, src]) => fn(src).map(h => `${f}:${h.line} ${h.text}`));

// Counts on the branch that introduced this file. They may only go DOWN.
const BASELINE = {
  overCapRange: 11,          // (a)  admin/encounters x8, parses x3 — other agents' files this round
  unpagedSetReturning: 24,   // (b)  mostly bounded by the arguments passed (item ids, one character's names); review before adding
  unboundedBigRead: 139,     // (c)  see the failure output for the list; most are filtered to a handful of rows
  nonUniqueOrder: 2,         // (d)  me/page.tsx: opendkp_loot_recent by raid_date, agent_upload_stats by character
};

const ratchet = (label, found, baseline, advice) => {
  expect(
    found.length,
    `${label} went UP (${found.length} > baseline ${baseline}). ${advice}\nCurrent sites:\n${found.join('\n')}`,
  ).toBeLessThanOrEqual(baseline);
  // A win must be locked in: if sites were fixed, lower the baseline to the new count.
  expect(
    found.length,
    `only ${found.length} ${label} sites remain but the baseline allows ${baseline}. Lower it to ${found.length}.`,
  ).toBeGreaterThanOrEqual(baseline - 3);
};

describe('the guard sees what it claims to see (unit)', () => {
  const unit = (s) => stripJs(s);

  it('(a) flags one wide .range(0, N>=1000), not a page walk and not a short range', () => {
    expect(overCapRanges(unit(`x.from('t').select().range(0, 99999);`))).toHaveLength(1);
    expect(overCapRanges(unit(`x.from('t').select().range(0, 1000)`))).toHaveLength(1);
    expect(overCapRanges(unit(`x.from('t').select().range(0, 999)`))).toHaveLength(0);
    expect(overCapRanges(unit(`x.from('t').select().range(from, to)`))).toHaveLength(0);
    expect(overCapRanges(unit(`x.from('t').select().range(1000, 1999)`))).toHaveLength(0);
  });

  it('(b) flags a set-returning rpc read whole; paging, one row and a peek are fine; a scalar function is not set-returning', () => {
    const sr = new Set(['pop_spell_needs']);
    expect(unpagedSetReturningRpcs(unit(`const { data } = await sb.rpc('pop_spell_needs', { p_guild_id: 'wolfpack' });`), sr)).toHaveLength(1);
    expect(unpagedSetReturningRpcs(unit(`sb.rpc('pop_spell_needs', { a: 1 }).range(from, to)`), sr)).toHaveLength(0);
    expect(unpagedSetReturningRpcs(unit(`sb.rpc('pop_spell_needs', { a: 1 }).limit(10)`), sr)).toHaveLength(0);
    expect(unpagedSetReturningRpcs(unit(`sb.rpc('pop_spell_needs', { a: 1 }).limit(1000)`), sr)).toHaveLength(1);
    expect(unpagedSetReturningRpcs(unit(`sb.rpc('pop_spell_needs', { a: 1 }).maybeSingle()`), sr)).toHaveLength(0);
    expect(unpagedSetReturningRpcs(unit(`sb.rpc('some_scalar_fn', { a: 1 })`), sr)).toHaveLength(0);
  });

  it('(c) flags a big-table read with no bound; a count, a page, one row, a peek and a write are fine; a small table is not tracked', () => {
    const big = new Set(['chat_messages']);
    expect(unboundedBigReads(unit(`await sb.from('chat_messages').select('speaker').eq('channel', 'gu')`), big)).toHaveLength(1);
    expect(unboundedBigReads(unit(`await sb.from('chat_messages').select('*').limit(5000)`), big)).toHaveLength(1);
    expect(unboundedBigReads(unit(`await sb.from('chat_messages').select('*', { count: 'exact', head: true })`), big)).toHaveLength(0);
    expect(unboundedBigReads(unit(`await sb.from('chat_messages').select('*').order('id').range(from, to)`), big)).toHaveLength(0);
    expect(unboundedBigReads(unit(`await sb.from('chat_messages').select('*').eq('id', 1).single()`), big)).toHaveLength(0);
    expect(unboundedBigReads(unit(`await sb.from('chat_messages').select('*').order('id').limit(50)`), big)).toHaveLength(0);
    expect(unboundedBigReads(unit(`await sb.from('chat_messages').insert({ a: 1 })`), big)).toHaveLength(0);
    expect(unboundedBigReads(unit(`await sb.from('guild_rules').select('*')`), big)).toHaveLength(0);
  });

  it('(c) reads a chain across lines, comments, strings with brackets and template literals', () => {
    const big = new Set(['chat_messages']);
    const src = unit([
      "const a = await sb",
      "  .from('chat_messages')   // trailing note with a ) and a ' in it",
      "  .select('a, b')",
      "  .not('flag_key', 'in', '(unmapped,hail)')",
      "  .or(names.map(n => `character.ilike.${n}`).join(','))",
      "  .order('id')",
      "  .range(from, to);",
    ].join('\n'));
    expect(unboundedBigReads(src, big)).toHaveLength(0);
    expect(unboundedBigReads(src.replace('.range(from, to)', ''), big)).toHaveLength(1);
  });

  it('(d) wants a unique key in the order: the quartermaster order was not one, ending on id is', () => {
    const keys = { character_inventory: UNIQUE_KEYS.character_inventory };
    const q = (order) => unit(`selectAll((from, to) => sb.from('character_inventory').select('a').eq('guild_id', 'wolfpack')${order}.range(from, to))`);
    expect(pagedOrderProblems(q(`.order('character_name').order('item_name').order('item_id')`), keys).nonUnique).toHaveLength(1);
    expect(pagedOrderProblems(q(`.order('character_name').order('item_name').order('item_id').order('id')`), keys).nonUnique).toHaveLength(0);
    expect(pagedOrderProblems(q(`.order('character_name').order('slot_label')`), keys).nonUnique).toHaveLength(0);
    expect(pagedOrderProblems(q(``), keys).nonUnique).toHaveLength(1);                                   // no order at all
    expect(pagedOrderProblems(q(`.order('id', { ascending: false })`), keys).nonUnique).toHaveLength(0);
  });

  it('(d) a paged read of a table with no known key must say what its key is', () => {
    const p = pagedOrderProblems(unit(`selectAll((from, to) => sb.from('brand_new_table').select('a').order('a').range(from, to))`), UNIQUE_KEYS);
    expect(p.unknown).toHaveLength(1);
    expect(p.nonUnique).toHaveLength(0);
  });

  it('knows the set-returning functions from the migrations, newest definition winning', () => {
    for (const fn of ['pop_spell_needs', 'pop_who_sightings', 'pop_loot_sightings', 'pop_spellbook_names', 'fun_caster_tally', 'me_levels', 'item_card_info']) {
      expect(SET_RETURNING.has(fn), fn).toBe(true);
    }
    expect(SET_RETURNING.has('find_or_create_encounter')).toBe(false);   // returns a row, not a set
  });
});

describe('web/** read ratchets (counts may only go down)', () => {
  it('(a) no `.range(0, N)` with N >= 1000 as a single call', () => {
    ratchet('single-call .range(0, N>=1000)', sites(overCapRanges), BASELINE.overCapRange,
      'One wide .range() is still capped at 1,000 rows. Page it with selectAll (web/lib/selectAll.ts) ordered on a unique key.');
  });

  it('(b) no set-returning .rpc() read whole', () => {
    ratchet('unpaged set-returning .rpc()', sites(src => unpagedSetReturningRpcs(src, SET_RETURNING)), BASELINE.unpagedSetReturning,
      'A set-returning function is capped at 1,000 rows like a table. Read it with selectAll(... .rpc(...).range(from, to)) and end its ORDER BY on a unique key, or return an aggregate.');
  });

  it('(c) no read of a big table/view without paging, a single row, a count or a small limit', () => {
    ratchet('unbounded big-table read', sites(src => unboundedBigReads(src, BIG)), BASELINE.unboundedBigRead,
      'A plain select (or .limit(N>100)) of a table over 1,000 rows is silently cut at 1,000. Page it with selectAll, ask for a count (head: true), or aggregate in SQL.');
  });

  it('(d) every paged read orders on a unique key, and every paged table has a known key', () => {
    const problems = SOURCES.map(([f, src]) => [f, pagedOrderProblems(src, UNIQUE_KEYS)]);
    const unknown = problems.flatMap(([f, p]) => p.unknown.map(h => `${f}:${h.line} ${h.text}`));
    expect(unknown, 'a paged read of a table with no entry in UNIQUE_KEYS: add its unique key (from pg_index) there').toEqual([]);
    ratchet('paged read ordered on a non-unique key', problems.flatMap(([f, p]) => p.nonUnique.map(h => `${f}:${h.line} ${h.text}`)), BASELINE.nonUniqueOrder,
      'Rows that tie on every ORDER BY column can fall either side of a page boundary, so some are never returned and others come twice. End the order on a unique key (usually the primary key).');
  });

  it('no web file writes its own paging loop around .range(from, from + 999)', () => {
    // The loops this replaced ended on a page that errored and returned the rows so far.
    const loops = SOURCES.filter(([f]) => f !== 'web/lib/selectAll.ts')
      .flatMap(([f, src]) => [...src.matchAll(/\.range\(\s*from\s*,\s*from\s*\+\s*\d+\s*\)/g)].map(m => `${f}:${lineOf(src, m.index)}`));
    expect(loops, 'route the walk through selectAll so a failed page throws').toEqual([]);
  });
});
