// A failed query must never render as a zero.
//
// THE BUG (Hitya 2026-08-04, "what happened to our Tunare invocations?"):
// the /fun card read 0 while the data sat right there — 83 rows across
// Naggato's family, latest 2026-07-31, and `fun_tunare_stats` returns exactly
// that when called as service_role.
//
// The reason it read 0 rather than saying anything is a one-line habit:
//
//     const { data: stats } = await sb.rpc('fun_tunare_stats', {...});
//
// supabase-js does NOT throw on a failed call — it resolves with
// `{ data: null, error }`. Dropping `error` on the floor makes "the RPC did
// not answer" and "nobody has ever mentioned Tunare" render identically. And
// because /fun demotes any zero card into the dim "QUIET FOR NOW — WAITING ON
// DATA" bucket, the failure then looked deliberate.
//
// This is the same shape as the thread-anchor bug earlier the same day: a
// swallowed failure that silently becomes a plausible-looking result. The
// counter to it is the same — distinguish "it failed" from "it is empty", and
// keep a path that still produces the right answer.
//
// Run: npx vitest run test/fun-tunare-counter.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const SRC = fs.readFileSync(path.join(ROOT, 'web', 'app', 'fun', 'page.tsx'), 'utf8');
// Just the Tunare section.
const SECTION = (() => {
  const start = SRC.indexOf('SECTIONS.push(async (sb, counters) => {\n  // Tunare mentions');
  if (start < 0) throw new Error('Tunare section not found — was it renamed?');
  const end = SRC.indexOf('SECTIONS.push', start + 10);
  return SRC.slice(start, end);
})();

describe('the Tunare card cannot silently report zero', () => {
  it('reads the RPC error instead of discarding it', () => {
    expect(SECTION, 'the exact shape of the bug')
      .not.toMatch(/const \{ data: stats \} = await sb\.rpc/);
    expect(SECTION).toMatch(/const \{ data: stats, error: rpcErr \} = await sb\.rpc/);
  });

  it('reads the family-lookup error too', () => {
    // The other query in this section, same trap.
    expect(SECTION).toMatch(/error: famErr/);
    expect(SECTION).toMatch(/if \(famErr\) throw famErr;/);
  });

  it('falls back to a direct query when the RPC does not answer', () => {
    // The RPC is a speed optimisation; it must not be the only path to a
    // correct number.
    expect(SECTION).toMatch(/if \(count === null\)/);
    expect(SECTION).toMatch(/\.from\('chat_messages'\)/);
    expect(SECTION).toMatch(/\.ilike\('text', '%tunare%'\)/);
  });

  it('the fallback counts ALL matches rather than a capped page', () => {
    // `.limit(1000)` would have quietly under-reported once the family passes
    // a thousand mentions. count:'exact' + limit(1) totals everything while
    // fetching only the newest row.
    expect(SECTION).toMatch(/\{ count: 'exact' \}/);
    expect(SECTION).toMatch(/count\s*=\s*exact \?\? 0;/);
    expect(SECTION, 'a row-page cap would under-count').not.toMatch(/\.limit\((?!1\))\d+\)/);
  });

  it('a genuine failure still says so, and is not dressed as a zero', () => {
    expect(SECTION).toMatch(/push\(0, 'query failed: '/);
  });

  it('still distinguishes "family not resolved" from "no invocations"', () => {
    expect(SECTION).toMatch(/Naggato family not resolved yet/);
    expect(SECTION).toMatch(/no Tunare invocations on record yet/);
  });
});

// The count/last-seen presentation, which is what a reader actually judges.
describe('sub-line wording', () => {
  const sub = (lastTs, now) => {
    const days = lastTs ? Math.floor((now - lastTs) / 86400000) : null;
    return days === null
      ? 'no Tunare invocations on record yet — first rant resets the clock.'
      : days === 0
        ? 'Last rant was today. Stay vigilant.'
        : `${days} day${days === 1 ? '' : 's'} since the last Tunare Text Rant™.`;
  };
  const DAY = 86400000;
  const NOW = Date.UTC(2026, 7, 5);

  it('reports days since the last rant', () => {
    expect(sub(NOW - 5 * DAY, NOW)).toBe('5 days since the last Tunare Text Rant™.');
    expect(sub(NOW - 1 * DAY, NOW)).toBe('1 day since the last Tunare Text Rant™.');
    expect(sub(NOW, NOW)).toBe('Last rant was today. Stay vigilant.');
  });

  it('only says "none on record" when there genuinely is no timestamp', () => {
    expect(sub(null, NOW)).toMatch(/no Tunare invocations on record yet/);
  });

  it('the real data reads sensibly', () => {
    // Latest stored mention: 2026-07-31, 83 invocations.
    const last = Date.UTC(2026, 6, 31);
    expect(sub(last, NOW)).toBe('5 days since the last Tunare Text Rant™.');
  });
});

// ── The deploy trigger that made this session bounce production twice ───────
describe('railway watchPatterns', () => {
  const toml = fs.readFileSync(path.join(ROOT, 'railway.toml'), 'utf8');

  it('excludes test/ — tests never run in the container', () => {
    // Adding test/item-flags.test.js to an otherwise web-only commit rebuilt
    // and restarted the bot mid-session: web/ was correctly ignored and the
    // TEST file matched the catch-all `**`.
    expect(toml).toMatch(/"!test\/\*\*"/);
  });

  it('still deploys on real bot changes', () => {
    // The exclude list must stay a subtraction from `**`, so any NEW top-level
    // bot directory is included by default rather than silently skipped.
    expect(toml).toMatch(/watchPatterns = \[\s*\n\s*"\*\*",/);
    for (const p of ['web', 'apps', 'packages', 'docs']) {
      expect(toml).toMatch(new RegExp(`"!${p}/\\*\\*"`));
    }
  });
});
