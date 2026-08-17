// web/lib/selectAll.ts — the PostgREST 1000-row cap drain.
//
// The cap is SILENT: no error, no flag, just a short array. `.limit(50000)` is
// an upper bound applied ON TOP of the server ceiling, never a way to raise it.
// Two field reports traced to it before anyone connected them:
//
//   · 2026-06-21 /who — "Druids only" filtered the top-1000 by last_seen.
//   · 2026-08-05 /character era timeline — a family's tick pull is 1,149 rows;
//     the 149 dropped were the NEWEST (unordered query ⇒ heap order), and ALL
//     36 of the new main's ticks were in that tail, so "most ticks" kept
//     naming the previous main and no swap was ever detected.
//
// Run: npx vitest run test/select-all-pagination.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';
import path from 'node:path';

const SRC = path.join(ROOT, 'web', 'lib', 'selectAll.ts');
const src = readSource(SRC);

// Strip TS annotations from the shipped function and rehydrate it. Keeps the
// test bound to the real control flow rather than a paraphrase of it.
const selectAll = (() => {
  const body = sliceBlock(src, 'export async function selectAll<T>(', '\n  return out;\n}');
  const js = body
    .replace('export async function selectAll<T>(', 'async function selectAll(')
    .replace(/build: \(from: number, to: number\) => PromiseLike<PageResult<T>>,/, 'build,')
    .replace(/opts: SelectAllOpts = \{\},/, 'opts = {},')
    .replace(/\): Promise<T\[\]> \{/, ') {')
    .replace(/const out: T\[\] = \[\];/, 'const out = [];');
  // eslint-disable-next-line no-new-func
  return new Function('PGRST_MAX_ROWS', js + '\nreturn selectAll;')(1000);
})();

// A fake table whose server enforces the silent cap, exactly like PostgREST.
function serverWithCap(totalRows, cap = 1000) {
  const all = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  const calls = [];
  return {
    calls,
    build: (from, to) => {
      calls.push([from, to]);
      const want = to - from + 1;
      const slice = all.slice(from, from + Math.min(want, cap));   // ← the cap
      return Promise.resolve({ data: slice, error: null });
    },
  };
}

describe('selectAll — draining past the silent cap', () => {
  it('returns ALL rows when the set exceeds the cap', async () => {
    const s = serverWithCap(2238);                       // the real family total
    const rows = await selectAll(s.build);
    expect(rows).toHaveLength(2238);
    expect(rows[0].id).toBe(0);
    expect(rows[2237].id).toBe(2237);
  });

  it('keeps the TAIL — the rows the cap was silently eating', async () => {
    // 1,149 tick rows: the bug was losing ids 1000..1148 (the newest).
    const rows = await selectAll(serverWithCap(1149).build);
    expect(rows).toHaveLength(1149);
    expect(rows.map(r => r.id).includes(1148), 'the newest row must survive').toBe(true);
  });

  it('stops on the first short page — no wasted round trip', async () => {
    const s = serverWithCap(1500);
    await selectAll(s.build);
    // 1000 + 500(short) ⇒ exactly two requests.
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]).toEqual([0, 999]);
    expect(s.calls[1]).toEqual([1000, 1999]);
  });

  it('an exact multiple of the page size costs one extra empty page, then stops', async () => {
    const s = serverWithCap(2000);
    const rows = await selectAll(s.build);
    expect(rows).toHaveLength(2000);
    expect(s.calls).toHaveLength(3);       // 1000, 1000, then the empty probe
  });

  it('never requests a page LARGER than the cap', async () => {
    // A page above the ceiling would come back truncated, and the short-page
    // stop would then end the loop early — silently reintroducing the bug.
    const s = serverWithCap(5000);
    await selectAll(s.build, { page: 50_000 });
    for (const [from, to] of s.calls) expect(to - from + 1).toBeLessThanOrEqual(1000);
    expect((await selectAll(serverWithCap(5000).build, { page: 50_000 }))).toHaveLength(5000);
  });

  it('a zero/negative page size is clamped, not an infinite loop', async () => {
    // `from += 0` never advances. Without the low-end clamp this spins on the
    // MICROTASK queue, which starves the event loop — so vitest's timer-based
    // timeout can never fire and the whole suite hangs instead of failing.
    // The call budget converts that hang into a fast, deterministic failure.
    const all = Array.from({ length: 3 }, (_, i) => ({ id: i }));
    let calls = 0;
    const build = (from, to) => {
      if (++calls > 50) throw new Error('selectAll did not terminate — page size was not clamped');
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    };
    const rows = await selectAll(build, { page: 0 });
    expect(rows).toHaveLength(3);
    // Clamped to a page size of 1: three single-row pages + the empty probe.
    expect(calls).toBe(4);
  });

  it('a null data payload ends the drain without throwing', async () => {
    // out.push(...null) would throw; the guard has to stay even though the
    // empty-array case is covered by the short-page stop.
    let n = 0;
    const rows = await selectAll(() => {
      n++;
      return Promise.resolve(n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: null });
    });
    expect(rows).toHaveLength(1000);
  });

  it('an empty table is one request and an empty array', async () => {
    const s = serverWithCap(0);
    expect(await selectAll(s.build)).toEqual([]);
    expect(s.calls).toHaveLength(1);
  });

  it('an error mid-drain returns the partial set instead of throwing', async () => {
    let n = 0;
    const rows = await selectAll(() => {
      n++;
      return Promise.resolve(n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: new Error('boom') });
    });
    expect(rows).toHaveLength(1000);
  });

  it('hardCap bounds a runaway and reports the truncation', async () => {
    const s = serverWithCap(100_000);
    let reported = null;
    const rows = await selectAll(s.build, { hardCap: 3000, onTruncate: (n) => { reported = n; } });
    expect(rows.length).toBeLessThanOrEqual(3000);
    expect(reported, 'a truncated set must be announceable, not silent').toBe(3000);
  });
});

// The whole point is that call sites stop trusting .limit() for large sets.
describe('call sites that overflow today', () => {
  const web = (p) => readSource(path.join(ROOT, 'web', p));

  it('the era timeline paginates ticks AND orders them', () => {
    const s = web('lib/character-family.ts');
    expect(s).toMatch(/selectAll<TickRow>/);
    expect(s, 'unordered range pagination can skip or repeat rows').toMatch(/opendkp_ticks[\s\S]{0,300}?\.order\('raid_id'\)/);
    expect(s, 'no bare limit left on the tick pull').not.toMatch(/opendkp_ticks[\s\S]{0,200}?\.limit\(10000\)/);
  });

  it('the account inventory page paginates', () => {
    const s = web('app/me/inventory/page.tsx');
    expect(s).toMatch(/selectAll<InvRow>/);
    expect(s).not.toMatch(/character_inventory[\s\S]{0,300}?\.limit\(50000\)/);
  });

  it('the quartermaster roster pull paginates', () => {
    const s = web('app/quartermaster/page.tsx');
    expect(s).toMatch(/selectAll</);
    expect(s).not.toMatch(/character_inventory[\s\S]{0,300}?\.limit\(50000\)/);
  });

  it('admin/readiness paginates BOTH its over-cap pulls', () => {
    // Measured 2026-08-06 on the live roster scope: character_gear returns
    // 1,629 rows and character_spellbook 2,705 — both silently delivered 1,000.
    // This is the page that reports who is missing what, so it was answering
    // from 61% and 37% of the data respectively.
    const s = web('app/admin/readiness/page.tsx');
    expect(s).toMatch(/selectAll<GearRow>/);
    expect(s).toMatch(/character_spellbook[\s\S]{0,200}?\.range\(from, to\)/);
    expect(s).not.toMatch(/character_gear[\s\S]{0,300}?\.limit\(20000\)/);
    expect(s).not.toMatch(/character_spellbook[\s\S]{0,300}?\.limit\(50000\)/);
  });

  it('/rolls and /fun migrated off the retired second paginator (2026-08-16)', () => {
    // supabase-paged.ts was the THIRD independently-written drain for the same
    // cap. Its four call sites now go through selectAll; the module is gone
    // (test/db-read-discipline pins that it stays gone).
    for (const p of ['app/rolls/page.tsx', 'app/fun/page.tsx']) {
      const s = web(p);
      expect(s, p).toMatch(/from '@\/lib\/selectAll'/);
      expect(s, p).not.toMatch(/fetchAllPages|supabase-paged/);
    }
    // The migrated pulls keep their ordered range walks.
    expect(web('app/rolls/page.tsx')).toMatch(/roll_sets'\)[\s\S]{0,300}?\.order\('started_at'/);
    expect(web('app/fun/page.tsx')).toMatch(/dragon_punch'\)[\s\S]{0,200}?\.order\('event_ts'/);
  });

  it('readiness chunks its id lookups too — a complete gear set can exceed the cap', () => {
    // Fixing the gear pull makes itemIds bigger, which would newly overflow the
    // .in() lookups. Fixing one truncation must not create another.
    const s = web('app/admin/readiness/page.tsx');
    expect(s).toMatch(/itemIds\.slice\(i, i \+ 800\)/);
    expect(s).toMatch(/spellIds\.slice\(i, i \+ 800\)/);
  });
});
