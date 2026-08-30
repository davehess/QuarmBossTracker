// test/db-read-discipline.test.js — the database read layer stays ONE layer.
//
// Hitya, 2026-08-16: "do U1 … let's start looking at the database read/write
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
//
// The ratchet, not a ban, because 85 pre-existing sites (2026-08-16) can't be
// converted blind — each needs its ordering key checked. The baseline shrinks
// as they're audited; it never grows.
//
// Run: npx vitest run test/db-read-discipline.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

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

  it('the paginators keep their load-bearing properties', () => {
    // Ordered walk: an unordered offset walk skips/repeats rows between pages
    // (2026-08-05 — the 149 NEWEST rows of an unordered 1,149-row pull were
    // the ones dropped, and main-detection kept naming the previous main).
    expect(fs.readFileSync(BOT_LAYER, 'utf8')).toContain('order=${orderCol}.asc');
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
const OVER_CAP_BASELINE = 85;

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
