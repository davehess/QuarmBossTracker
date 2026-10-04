// test/supabase-row-cap.test.js — the 1,000-row cap, solved at the read layer.
//
// PostgREST answers at most 1,000 rows per response, silently: no error, no flag, a short
// array and a 200. The guild lead, 2026-10-04: "review all of the other tables for silent 500
// or 100 caps. I thought we had something in the design" — the design was
// docs/ARCHITECT-REBUILD-2026-08-16.md Decision #2, "one paged reader … the 1,000-row cap
// solved once, structurally". The reader (selectAllPaged) shipped; nothing made a read that
// BYPASSED it visible. Two halves live here:
//   1. selectAllPaged — composite orders (the key, not its first column), a page that fails
//      is a failed read, and the runaway guard no longer hands back a partial array as whole.
//   2. the tripwire in select() — a read that returns EXACTLY the cap and never named its own
//      bound is almost certainly truncated: one warning per (table, call-site) per process,
//      and a counter on GET /health so it is visible without logs.
//
// Everything runs against the REAL utils/supabase.js on a fake PostgREST that enforces the cap
// and shuffles rows that tie on the ORDER BY (test/_fake-fetch-postgrest.js).
//
// Run: npx vitest run test/supabase-row-cap.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { installFakePostgrest, SERVER_MAX_ROWS } from './_fake-fetch-postgrest.js';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const supabase = require('../utils/supabase.js');

let fake, warn;
const capWarnings = () => warn.mock.calls.filter(c => String(c[0]).startsWith('[supabase] read hit the 1,000-row cap'));

// rows with a key that has plenty of ties (the shape of character_lockouts: many rows per character)
const tiedRows = (n, groups) => Array.from({ length: n }, (_, i) => ({ grp: 'g' + String(i % groups).padStart(3, '0'), k: i, v: i }));

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  supabase._resetCapStats();
  supabase._resetBreaker();
});
afterEach(() => { fake && fake.restore(); fake = null; warn.mockRestore(); });

describe('selectAllPaged — order', () => {
  it('a composite order becomes order=a.asc,b.asc; a column that names its own direction keeps it', async () => {
    const seen = [];
    const sel = async (t, q) => { seen.push(q); return []; };
    await supabase.selectAllPaged('t', 'select=a', 'character,boss_key', sel);
    await supabase.selectAllPaged('t', 'select=a', 'started_at.desc,encounter_id', sel);
    await supabase.selectAllPaged('t', 'select=a', 'id', sel);
    expect(seen[0]).toBe('select=a&order=character.asc,boss_key.asc&limit=1000&offset=0');
    expect(seen[1]).toBe('select=a&order=started_at.desc,encounter_id.asc&limit=1000&offset=0');
    expect(seen[2]).toBe('select=a&order=id.asc&limit=1000&offset=0');
  });

  it('walks past the cap with a unique composite order: every row once, none doubled', async () => {
    // 2,345 rows, 7 values of grp: (grp, k) is the key. Ties on grp alone are 335 deep.
    fake = installFakePostgrest({ tables: { t: tiedRows(2345, 7) } });
    const rows = await supabase.selectAllPaged('t', 'select=grp,k', 'grp,k');
    expect(rows).toHaveLength(2345);
    expect(new Set(rows.map(r => r.k)).size).toBe(2345);
    expect(fake.calls.map(c => c.rows)).toEqual([1000, 1000, 345]);
  });

  it('the trap the composite order closes: ordering on the non-unique column alone loses rows', async () => {
    // Same table, order on grp only. Ties reshuffle between pages, so rows go missing and
    // others come twice — what a replay of eqemu_npc_faction_entries did (4 of 5,354 lost).
    fake = installFakePostgrest({ tables: { t: tiedRows(2345, 7) } });
    const rows = await supabase.selectAllPaged('t', 'select=grp,k', 'grp');
    expect(rows).toHaveLength(2345);                              // as many rows …
    expect(new Set(rows.map(r => r.k)).size).toBeLessThan(2345);  // … but not the same rows
  });
});

describe('selectAllPaged — it never hands back a partial array as a whole one', () => {
  it('a failed page is a failed read (null), not the pages before it', async () => {
    let n = 0;
    const sel = async () => (++n === 2 ? null : Array.from({ length: 1000 }, (_, i) => ({ i })));
    expect(await supabase.selectAllPaged('t', 'select=i', 'i', sel)).toBe(null);
  });

  it('the runaway guard warns loudly and fails the read instead of returning what it has', async () => {
    let pages = 0;
    const sel = async () => { pages++; return Array.from({ length: 1000 }, (_, i) => ({ i })); };
    const out = await supabase.selectAllPaged('big_table', 'select=i', 'i', sel);
    expect(out).toBe(null);
    expect(pages).toBe(501);                                       // 500,000 rows, then one more page trips it
    const guard = warn.mock.calls.filter(c => /runaway guard/.test(String(c[0])));
    expect(guard).toHaveLength(1);
    expect(String(guard[0][0])).toContain('big_table');
  });
});

describe('the 1,000-row tripwire in select()', () => {
  it('warns ONCE per table and call-site at exactly 1,000 rows with no bound of its own', async () => {
    fake = installFakePostgrest({ tables: { t: tiedRows(SERVER_MAX_ROWS, 3) } });
    for (let i = 0; i < 3; i++) {
      const rows = await supabase.select('t', 'select=k');          // ← the one call site
      expect(rows).toHaveLength(SERVER_MAX_ROWS);
    }
    const w = capWarnings();
    expect(w).toHaveLength(1);
    expect(w[0][0]).toMatch(/result is truncated/);
    expect(w[0][1]).toBe('t');
    expect(w[0][3]).toMatch(/^test\/supabase-row-cap\.test\.js:\d+$/);   // names where, not just what
    expect(supabase.capStats().truncated_reads).toBe(3);                  // every hit is counted
  });

  it('a table with more rows than the cap trips it too — that is the truncation it exists to see', async () => {
    fake = installFakePostgrest({ tables: { t: tiedRows(2500, 3) } });
    expect(await supabase.select('t', 'select=k')).toHaveLength(SERVER_MAX_ROWS);
    expect(capWarnings()).toHaveLength(1);
  });

  it('a limit above the cap is the delusion it catches: limit=10000 still returns 1,000', async () => {
    fake = installFakePostgrest({ tables: { t: tiedRows(2500, 3) } });
    expect(await supabase.select('t', 'select=k&limit=10000')).toHaveLength(SERVER_MAX_ROWS);
    expect(capWarnings()).toHaveLength(1);
  });

  it('is silent for a paged read, an explicit limit at or under the cap, and a short result', async () => {
    fake = installFakePostgrest({ tables: { t: tiedRows(2500, 3), short: tiedRows(999, 3) } });
    await supabase.selectAllPaged('t', 'select=k', 'grp,k');           // pages of exactly 1,000
    await supabase.select('t', 'select=k&limit=500');                  // the caller named its bound
    await supabase.select('t', 'select=k&limit=1000');                 // … even when it IS the cap
    await supabase.select('t', 'select=k&offset=1000&limit=1000');
    await supabase.select('t', 'select=k&offset=500');                 // a pager marker
    await supabase.select('short', 'select=k');                        // 999 rows: whole
    expect(capWarnings()).toHaveLength(0);
    expect(supabase.capStats().truncated_reads).toBe(0);
  });

  it('two call-sites on one table warn separately', async () => {
    fake = installFakePostgrest({ tables: { t: tiedRows(2500, 3) } });
    await supabase.select('t', 'select=k');       // site A
    await supabase.select('t', 'select=k');       // site B
    expect(capWarnings()).toHaveLength(2);
    const { sites } = supabase.capStats();
    expect(sites).toHaveLength(2);
    expect(sites.every(s => s.count === 1 && s.site.startsWith('t @ test/supabase-row-cap.test.js:'))).toBe(true);
  });

  it('a failed read is not a truncated one', async () => {
    fake = installFakePostgrest({ tables: {} });                       // 404 → null
    expect(await supabase.select('missing', 'select=k')).toBe(null);
    expect(capWarnings()).toHaveLength(0);
  });
});

describe('GET /health carries the counter', () => {
  it('reports supabase_row_cap beside the breaker, and the count moves when a read is truncated', async () => {
    const src = readSource(BOT_INDEX);
    const block = sliceBlock(src, "if (req.method === 'GET' && (req.url === '/health'", '  // Default: health check');
    // eslint-disable-next-line no-new-func
    const health = new Function('req', 'res', 'require', '_botReady', '_shuttingDown', '_budgetBuckets', '_BUDGET_DEFAULTS', block);
    const run = () => {
      let body = null;
      health({ method: 'GET', url: '/health' }, { writeHead() {}, end: (b) => { body = JSON.parse(b); } },
        (m) => require('../' + m.replace(/^\.\//, '') + '.js'), true, false, new Map(), {});
      return body;
    };
    expect(run().supabase_row_cap).toEqual({ truncated_reads: 0, sites: [] });
    expect(run().supabase_breaker).toBeTruthy();                       // the neighbour is untouched
    fake = installFakePostgrest({ tables: { t: tiedRows(2500, 3) } });
    await supabase.select('t', 'select=k');
    const h = run();
    expect(h.supabase_row_cap.truncated_reads).toBe(1);
    expect(h.supabase_row_cap.sites[0].site).toMatch(/^t @ test\/supabase-row-cap\.test\.js:\d+$/);
  });
});

describe('the fake is faithful to the server it stands in for', () => {
  it('caps a response at 1,000 whatever the limit, honours offset and order, and shuffles ties per request', async () => {
    fake = installFakePostgrest({ tables: { t: tiedRows(1500, 1) } });
    const a = await supabase.select('t', 'select=k&order=k.asc&limit=50000');
    expect(a).toHaveLength(1000);
    expect(a[0].k).toBe(0);
    const b = await supabase.select('t', 'select=k&order=k.desc&limit=3&offset=2');
    expect(b.map(r => r.k)).toEqual([1497, 1496, 1495]);
    const t1 = (await supabase.select('t', 'select=k&order=grp.asc&limit=20')).map(r => r.k);
    const t2 = (await supabase.select('t', 'select=k&order=grp.asc&limit=20')).map(r => r.k);
    expect(t1).not.toEqual(t2);                                        // ties are unordered, and look it
  });
});
