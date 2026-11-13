// test/web-encounters-guild-filter.test.js — the web's service-role `encounters` reads carry the home guild's
// tag. supabaseAdmin() bypasses RLS, so without `.eq('guild_id', GUILD_TAG)` a second guild's fights would show
// on the home guild's pages, and a foreign guild's parse id would open instead of 404ing.
// Comments are stripped before matching (CLAUDE.md "comments satisfy text assertions").
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const code = (rel) => stripJs(readSource(path.join(ROOT, rel)));
const FILTER = /\.eq\(\s*'guild_id'\s*,\s*GUILD_TAG\s*\)/;
const FROM = ".from('encounters')";

// The text of the nth `.from('encounters')` chain, up to where the statement ends.
function chain(src, n = 0) {
  let at = -1;
  for (let i = 0; i <= n; i++) at = src.indexOf(FROM, at + 1);
  expect(at, `no .from('encounters') #${n}`).toBeGreaterThan(-1);
  const end = src.slice(at).search(/\.(single|maybeSingle)\(\)|\.limit\(|;/);
  return src.slice(at, at + end + 40);
}

describe('encounters reads are filtered to the home guild', () => {
  it('parses list page', () => {
    expect(chain(code('web/app/parses/page.tsx'))).toMatch(FILTER);
  });

  it('parse detail page: the loader and the unfurl metadata both filter', () => {
    const src = code('web/app/parses/[id]/page.tsx');
    expect(chain(src, 0)).toMatch(FILTER);
    expect(chain(src, 1)).toMatch(FILTER);
  });

  it('parse mark actions filter every encounters read and write', () => {
    const src = code('web/app/parses/actions.ts');
    const n = src.split(FROM).length - 1;
    expect(n).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < n; i++) expect(chain(src, i)).toMatch(FILTER);
  });

  it('home, boss, guide, search, raid review and screen feed filter', () => {
    for (const f of ['web/app/page.tsx', 'web/app/boss/[id]/page.tsx', 'web/app/guide/[bossId]/page.tsx',
      'web/app/search/page.tsx', 'web/app/raid/review/[date]/page.tsx', 'web/app/api/screen/feed/route.ts']) {
      expect(chain(code(f)), f).toMatch(FILTER);
    }
  });
});
