// test/db-read-discipline.test.js — the database read layer stays ONE layer.
//
// The guild lead, 2026-08-16: "do U1 … let's start looking at the database read/write
// layers as that is complexity I have not designed in."
//
// The complexity nobody designed in: PostgREST silently caps EVERY response at
// the server's max-rows (1000 on Supabase). No error, no flag — a short array
// and a 200. `.limit(50000)` does NOT lift it; it is an upper bound applied ON
// TOP of the cap. That one fact was rediscovered independently FOUR times
// (2026-06-21 /who, 2026-08-05 era timeline, 2026-08-12 /rolls + /fun,
// 2026-08-14 the loot fold's 116 duplicate member-facing rows), and each
// rediscovery wrote its own paginator. Three paginators for one footgun is how
// the codebase says "no one owns this."
//
// This gate makes the layer structural:
//   1. exactly ONE paginator per runtime — utils/supabase.js (bot) and
//      web/lib/selectAll.ts (web). A second definition fails the build.
//   2. the paginators keep their load-bearing properties (ordered walk;
//      page size clamped to the cap) — the two bugs their comments document.
//   3. a RATCHET on the delusion signature: any `.limit(N)` / `limit=N` with
//      N > 1000 is a site that believes the cap can be out-bid. The count may
//      only go DOWN. Converting a site to the shared paginator lowers the
//      baseline; adding a new over-cap limit fails CI with this comment.
//   4. a second RATCHET on what that one cannot see (2026-10-04): a bot read of
//      a LARGE table that names no bound at all. `limit=10000` is at least
//      visible; a read with no `limit=` and no pager is just as truncated and
//      leaves no signature — the audit found catalogs and scans silently clipped
//      at 1,000 rows that way. Same rule: the count may only go down.
//
// The ratchets, not a ban, because 85 pre-existing sites (2026-08-16) can't be
// converted blind — each needs its ordering key checked. The baseline shrinks
// as they're audited; it never grows. The runtime half of this lives in
// utils/supabase.js: a read that returns EXACTLY the cap warns and is counted
// on GET /health (test/supabase-row-cap.test.js).
//
// Run: npx vitest run test/db-read-discipline.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';
import botSupabase from '../utils/supabase.js';

// ── The one-paginator-per-runtime rule ───────────────────────────────────────

const BOT_LAYER = path.join(ROOT, 'utils', 'supabase.js');
const WEB_LAYER = path.join(ROOT, 'web', 'lib', 'selectAll.ts');

// Production read-path surface. Deliberately excludes test/, docs/, scripts/
// (one-off jobs), and the agent (its store is a local JSON queue, not PostgREST).
const SCAN_ROOTS = ['index.js', 'utils', 'commands', 'web/app', 'web/lib', 'web/components'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.claude']);

function sourceFiles() {
  // ⚠ Walk ONLY the scan roots. This used to walk the whole repo from ROOT
  // and filter afterwards — thousands of wasted stat() calls — and under I/O
  // load (a run sharing the box with big file writes) it breached the 5s test
  // timeout. That was THE phantom flake of 2026-08-28..30: one test failing
  // once, green on every re-run, never reproducible on a quiet box.
  // STATUS.md's "unidentified flaky test" entry is this line's tombstone.
  const out = [];
  const walk = (rel) => {
    const full = path.join(ROOT, rel);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(full))) return;
      for (const e of fs.readdirSync(full)) walk(path.join(rel, e));
    } else if (/\.(js|ts|tsx)$/.test(rel)) out.push(rel);
  };
  for (const r of SCAN_ROOTS) if (fs.existsSync(path.join(ROOT, r))) walk(r);
  return out;
}

describe('one paginator per runtime', () => {
  it('the bot paginator lives in utils/supabase.js and nowhere else', () => {
    expect(fs.readFileSync(BOT_LAYER, 'utf8')).toMatch(/async function selectAllPaged\(/);
    const rogue = sourceFiles()
      .filter(f => !f.startsWith('web/') && path.join(ROOT, f) !== BOT_LAYER)
      .filter(f => /function selectAllPaged\s*\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
    expect(rogue, 'a SECOND bot paginator appeared — extend utils/supabase.js instead').toEqual([]);
  });

  it('the web paginator is web/lib/selectAll.ts and nowhere else', () => {
    expect(fs.existsSync(WEB_LAYER)).toBe(true);
    // supabase-paged.ts was the third independently-written drain for the same
    // cap; it was retired 2026-08-16. It must not come back, under any name.
    expect(fs.existsSync(path.join(ROOT, 'web', 'lib', 'supabase-paged.ts'))).toBe(false);
    const rogue = sourceFiles()
      .filter(f => f.startsWith('web/') && path.join(ROOT, f) !== WEB_LAYER)
      .filter(f => {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        return /function (fetchAllPages|selectAll)\s*[<(]/.test(src);
      });
    expect(rogue, 'a SECOND web paginator appeared — extend web/lib/selectAll.ts instead').toEqual([]);
  });

  it('the paginators keep their load-bearing properties', async () => {
    // Ordered walk: an unordered offset walk skips/repeats rows between pages
    // (2026-08-05 — the 149 NEWEST rows of an unordered 1,149-row pull were
    // the ones dropped, and main-detection kept naming the previous main).
    // Run it rather than grep it: a comment can quote `order=` and the walk can still be unordered.
    const asked = [];
    const out = await botSupabase.selectAllPaged('t', 'select=a', 'character,boss_key', async (t, q) => { asked.push(q); return []; });
    expect(out).toEqual([]);
    expect(asked).toEqual(['select=a&order=character.asc,boss_key.asc&limit=1000&offset=0']);
    // Page clamp: a page size above the server cap comes back truncated, the
    // short-page stop fires early, and the bug this layer kills is reborn.
    const web = fs.readFileSync(WEB_LAYER, 'utf8');
    expect(web).toMatch(/Math\.min\(opts\.page \?\? PGRST_MAX_ROWS, PGRST_MAX_ROWS\)/);
  });
});

// ── The over-cap limit ratchet ───────────────────────────────────────────────
//
// Sites measured 2026-08-16 (the full list ships in the failure output). Each
// believes a big number lifts the cap; each actually reads at most 1000 rows.
// Convert a site to the shared paginator (or bound it deliberately at ≤1000
// with its ordering checked) and LOWER this number. Never raise it.
const OVER_CAP_BASELINE = 22;

function overCapSites() {
  const hits = [];
  for (const f of sourceFiles()) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const m of line.matchAll(/\.limit\(\s*(\d+)\s*\)|[?&`]limit=(\d+)/g)) {
        const n = parseInt(m[1] || m[2], 10);
        if (n > 1000) hits.push(`${f}:${i + 1} (limit ${n})`);
      }
    });
  }
  return hits;
}

describe('the over-cap limit ratchet', () => {
  it(`no NEW .limit(>1000) sites (baseline ${OVER_CAP_BASELINE}, may only shrink)`, () => {
    const hits = overCapSites();
    expect(
      hits.length,
      `over-cap limit sites went UP. A .limit(N>1000) does not lift PostgREST's `
      + `silent 1000-row cap — the query still returns at most 1000 rows. Use the `
      + `shared paginator (bot: utils/supabase.js selectAllPaged · web: `
      + `web/lib/selectAll.ts) for the new site.\nCurrent sites:\n${hits.join('\n')}`,
    ).toBeLessThanOrEqual(OVER_CAP_BASELINE);
  });

  it('the baseline is honest — update it when sites are converted', () => {
    const hits = overCapSites();
    // If this fails LOW, someone converted sites (good!) but left the ratchet
    // slack — tighten OVER_CAP_BASELINE to the new count so the win is locked.
    expect(
      hits.length,
      `only ${hits.length} over-cap sites remain but the baseline still allows `
      + `${OVER_CAP_BASELINE}. Lower OVER_CAP_BASELINE to ${hits.length}.`,
    ).toBeGreaterThan(OVER_CAP_BASELINE - 10);
  });
});

// ── The unbounded-read ratchet ───────────────────────────────────────────────
//
// The over-cap ratchet above counts `limit=N>1000`. It cannot see a read that
// names no limit at all, which is the larger half: `select('character_gear',
// 'loc=eq.equipped')` returns the first 1,000 of 3,327 rows and nothing in the
// source says so. The 2026-10-04 audit found those in production (spell-haste
// foci, a 14-day uploader set, a scan window) on the tables below.
//
// This counts bot reads — `select('<large table>', …)` — whose call names neither a
// `limit=` (an explicit bound, or a pager's page) nor an `offset=` (a pager), and
// that are not a lookup by primary key (`id=eq.`, or `id=in.(…)`, which returns one
// row per id in a list the caller chunks). A read through selectAllPaged or rpc() is
// not a `select(` call, so it never counts. Fix a site by paging it, bounding it on
// purpose, or aggregating in an RPC — then LOWER the number. The sites left are
// reads scoped to ONE encounter or raid (a few dozen rows) that the runtime tripwire
// in utils/supabase.js still watches: if one ever returns exactly 1,000, it warns.
//
// Not brittle by construction: comments are blanked before matching (a comment that
// says "limit=" can't satisfy it, one that mentions a read can't trip it), line
// numbers stay out of the pin, and a bounded read added anywhere changes nothing.
// A read whose query lives in a variable is judged on the 40 lines above it — the
// heuristic is deliberately generous (any `limit=` there bounds it); the pinned
// count is what the algorithm gives today and only has to be stable, not perfect.
const LARGE_TABLES = [
  'encounters', 'encounter_players', 'contributions', 'buff_casts', 'who_observations',
  'chat_messages', 'encounter_threat_snapshots', 'looted_items', 'roll_sets', 'opendkp_ticks',
  'opendkp_auction_bids', 'eqemu_npc_drops', 'eqemu_spells', 'character_gear',
  'ui_socials_index', 'xp_events',
];
const UNBOUNDED_READ_BASELINE = 4;   // 2026-10-04: openDkpSync (1 raid), markincomplete + utils/supabase.js ×2 (1 encounter)

// Blank comments but keep every character position and newline, so a match offset
// is a real line number. Order matters (see stripJs in _source-slice.js): line
// comments first, so a `/*` inside one can't open a block comment.
const blank = (m) => m.replace(/[^\n]/g, ' ');
const blankComments = (s) => s
  .replace(/^[ \t]*\/\/.*$/gm, blank)
  .replace(/\/\*(?!\*?\/)[^\n]*?\*\//g, blank)
  .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, blank);

function skipString(src, i) {
  const q = src[i];
  for (i++; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === q) return i; }
  return i;
}
function skipTemplate(src, i) {
  for (i++; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '`') return i;
    if (src[i] === '$' && src[i + 1] === '{') {
      let d = 0;
      for (i += 1; i < src.length; i++) {
        const c = src[i];
        if (c === "'" || c === '"') { i = skipString(src, i); continue; }
        if (c === '`') { i = skipTemplate(src, i); continue; }
        if (c === '{') d++;
        else if (c === '}' && --d === 0) break;
      }
    }
  }
  return i;
}
// Index of the `)` that closes the call opened at src[open], capped so a mis-parse
// (an apostrophe in a trailing comment) can't swallow the file.
function callEnd(src, open) {
  const stop = Math.min(src.length, open + 3000);
  let depth = 0;
  for (let i = open; i < stop; i++) {
    const ch = src[i];
    if (ch === "'" || ch === '"') { i = skipString(src, i); continue; }
    if (ch === '`') { i = skipTemplate(src, i); continue; }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return stop;
}

const READ_OF_LARGE_TABLE = new RegExp(`\\bselect\\(\\s*(['"\`])(${LARGE_TABLES.join('|')})\\1`, 'g');
// The calls in `src` (comments already blanked) that read a large table with no bound
// and no pager and are not a primary-key lookup: [{ index, table }].
function unboundedCalls(src) {
  const out = [];
  for (const m of src.matchAll(READ_OF_LARGE_TABLE)) {
    const open = m.index + m[0].indexOf('(');
    const call = src.slice(open, callEnd(src, open) + 1);
    if (/limit=|offset=/.test(call)) continue;                  // a bound, or a pager
    if (/(^|[^\w])id=(eq|in)\./.test(call)) continue;           // by primary key: one row, or one per listed id
    // `select('t', query)`: the query is a variable — look for its bound just above.
    if (/^\(\s*(['"`])[a-z_]+\1\s*,\s*[A-Za-z_$][\w$]*\s*[,)]/.test(call)) {
      const lineNo = src.slice(0, m.index).split('\n').length;
      const above = src.split('\n').slice(Math.max(0, lineNo - 41), lineNo).join('\n');
      if (/limit=|offset=/.test(above)) continue;
    }
    out.push({ index: m.index, table: m[2] });
  }
  return out;
}

function unboundedReadSites() {
  const hits = [];
  for (const f of sourceFiles().filter(x => !x.startsWith('web/'))) {
    const src = blankComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const c of unboundedCalls(src)) hits.push(`${f}:${src.slice(0, c.index).split('\n').length} ${c.table}`);
  }
  return hits;
}

describe('the unbounded-read ratchet', () => {
  it(`no NEW bot read of a large table without a bound (baseline ${UNBOUNDED_READ_BASELINE}, may only shrink)`, () => {
    const hits = unboundedReadSites();
    expect(
      hits.length,
      `unbounded reads of large tables went UP. PostgREST answers at most 1,000 rows `
      + `and says nothing when it cut — a select() with no limit= and no pager on one of `
      + `${LARGE_TABLES.length} tables that hold more than that is silently truncated. Page it `
      + `(utils/supabase.js selectAllPaged, ordered on a UNIQUE key), bound it on purpose with `
      + `limit=N≤1000, or aggregate in an RPC.\nCurrent sites:\n${hits.join('\n')}`,
    ).toBeLessThanOrEqual(UNBOUNDED_READ_BASELINE);
  });

  it('the baseline is honest — update it when sites are fixed', () => {
    const hits = unboundedReadSites();
    expect(
      hits.length,
      `only ${hits.length} unbounded reads remain but the baseline still allows `
      + `${UNBOUNDED_READ_BASELINE}. Lower UNBOUNDED_READ_BASELINE to ${hits.length}.`,
    ).toBeGreaterThan(UNBOUNDED_READ_BASELINE - 2);
  });

  it('sees what it claims to: the shapes of an unbounded read, and not the bounded ones', () => {
    // The matcher, run on literal source. The first two are the exact shapes the audit found.
    const sites = (code) => unboundedCalls(blankComments(code)).length;
    expect(sites("await supabase.select('character_gear', `guild_id=eq.${g}&loc=eq.equipped`)")).toBe(1);
    expect(sites("await supabase.select(\n  'contributions',\n  `select=a&created_at=gte.${x}`\n);")).toBe(1);
    expect(sites("supabase.select('eqemu_spells', 'select=name&order=id.asc&limit=10000')")).toBe(0);   // bounded, if wrongly: the other ratchet's
    expect(sites("supabase.select('eqemu_spells', `select=a&offset=${from}&limit=1000`)")).toBe(0);
    expect(sites("supabase.select('encounters', `id=eq.${id}&select=a`)")).toBe(0);                      // a key lookup
    expect(sites("supabase.select('eqemu_spells', `id=in.(${chunk.join(',')})&select=id`)")).toBe(0);    // a chunked key list
    expect(sites("supabase.select('contributions', `encounter_id=in.(${ids})&select=id`)")).toBe(1);     // …but encounter_id is not the key
    expect(sites("supabase.select('some_small_table', 'select=a')")).toBe(0);                            // not a large table
    expect(sites("// supabase.select('character_gear', 'x')\n/* supabase.select('xp_events', 'y') */")).toBe(0);   // comments
    expect(sites("supabase.selectAllPaged('character_gear', 'x', 'character,slot')")).toBe(0);           // the pager
    expect(sites("supabase.rpc('recent_contributor_characters', {})")).toBe(0);                          // an RPC
    // a variable query is judged on the lines above it
    expect(sites("const q = `a=b`;\nawait supabase.select('buff_casts', q);")).toBe(1);
    expect(sites("const q = `a=b&limit=500`;\nawait supabase.select('buff_casts', q);")).toBe(0);
    // a call that spans lines and nests parens/templates is read to its real end
    expect(sites("supabase.select('buff_casts', `a=in.(${ids.map(i => `${i}`).join(',')})&select=b`).then(r => r.limit=3)")).toBe(1);
    expect(sites("supabase.select('buff_casts', `a=in.(${ids.map(i => `${i}`).join(',')})&select=b&limit=5`)")).toBe(0);
  });
});
