// The agent's local copy of the item catalog, and the search the wishlist
// picker runs against it.
//
// The whole reason this exists is that choosing a wishlist item should cost
// nothing at the moment you choose it — no bot round-trip, no database, works
// with the network down (Hitya, 2026-08-30). So the properties worth pinning
// are the ETag (an unchanged week must cost ~200 bytes, not 130 kB), the
// minimum query length (a keystroke must not full-scan 11k rows), and the
// ranking (typing "cloak" should not bury "Cloak of Flames" under
// "Shroud Cloak Clasp").
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_INDEX, readSource, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const ROOT = path.join(path.dirname(AGENT_INDEX), '..', '..');

// The shipped search, with its two module-level indexes supplied.
function search(names, q, limit) {
  const entries = names.map((n, i) => [1000 + i, n, null]);
  const block =
    'let _itemCatalog = ' + JSON.stringify(entries) + ';\n' +
    'let _itemCatalogLower = _itemCatalog.map(e => String((e && e[1]) || "").toLowerCase());\n' +
    sliceBlock(src, 'function searchItemCatalog(q, limit)', '\n}');
  return evalBlock(block, ['searchItemCatalog']).searchItemCatalog(q, limit);
}

describe('local item search', () => {
  const NAMES = ['Cloak', 'Cloak of Flames', 'Cloak of the Falling Stars',
                 'Rakusha Cloak', 'Shroud Cloak Clasp', 'Robe of the Azure Sky'];

  it('ranks exact, then prefix, then word-start, then anywhere', () => {
    const got = search(NAMES, 'cloak', 10).map(r => r.name);
    expect(got[0]).toBe('Cloak');                       // exact
    expect(got[1]).toBe('Cloak of Flames');             // prefix, shortest first
    expect(got[2]).toBe('Cloak of the Falling Stars');  // prefix
    expect(got.indexOf('Rakusha Cloak')).toBeLessThan(got.indexOf('Shroud Cloak Clasp'));
  });

  it('refuses a one-character query rather than scanning the whole catalog', () => {
    // Every keystroke calls this; at 11k rows a 1-char query matches most of it.
    expect(search(NAMES, 'c', 10)).toEqual([]);
    expect(search(NAMES, '', 10)).toEqual([]);
    expect(search(NAMES, 'cl', 10).length).toBeGreaterThan(0);
  });

  it('caps how much it will return', () => {
    // ⚠ Needs a corpus LARGER than the cap, or this passes on any code: with
    // six names the "limit 999" assertion was true whether the cap existed or
    // not, and the mutation that removed it went undetected.
    const many = Array.from({ length: 200 }, (_, i) => `Cloak number ${i}`);
    expect(search(many, 'cloak', 999).length).toBe(50);   // hard ceiling
    expect(search(many, 'cloak', 2)).toHaveLength(2);
    expect(search(many, 'cloak', 0).length).toBe(20);     // bad input → default
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(search(NAMES, '  ROBE OF THE AZURE SKY  ', 5)[0].name).toBe('Robe of the Azure Sky');
  });

  it('returns the era, so the picker can filter to an expansion', () => {
    const block =
      'let _itemCatalog = [[1, "Amulet of Crystal Dreams", 4], [2, "Ebony Headband", 0]];\n' +
      'let _itemCatalogLower = _itemCatalog.map(e => String((e && e[1]) || "").toLowerCase());\n' +
      sliceBlock(src, 'function searchItemCatalog(q, limit)', '\n}');
    const fn = evalBlock(block, ['searchItemCatalog']).searchItemCatalog;
    expect(fn('amulet', 5)[0].era).toBe(4);      // Planes of Power
    expect(fn('ebony', 5)[0].era).toBe(0);
  });
});

describe('the local copy itself', () => {
  const fetchFn = sliceBlock(src, 'function fetchItemCatalog({ botUrl, token })', '\n}');

  it('sends If-None-Match, so an unchanged week costs ~200 bytes', () => {
    expect(fetchFn).toMatch(/If-None-Match/);
    expect(fetchFn).toMatch(/statusCode === 304/);
  });

  it('writes the cache atomically', () => {
    // A crash mid-write must not leave a truncated catalog that then loads.
    expect(fetchFn).toMatch(/\.tmp/);
    expect(fetchFn).toMatch(/renameSync/);
  });

  it('stays quiet against a bot that has no such route', () => {
    // Older bots answer the health check instead; that must not spam warnings.
    expect(fetchFn).toMatch(/statusCode !== 200/);
    expect(fetchFn).toMatch(/looksJson/);
  });

  it('is loaded from disk at startup, before any fetch', () => {
    expect(src).toMatch(/loadItemCatalogFromDisk\(\);/);
    expect(src).toMatch(/fetchItemCatalog\(\{ botUrl, token \}\)/);
  });

  it('serves the picker without touching the network', () => {
    const route = sliceBlock(src, "req.url.startsWith('/api/item-search')", '}');
    expect(route).toMatch(/searchItemCatalog\(/);
    expect(route).not.toMatch(/fetch\(|https\.request|http\.request/);
  });

  it("does not commit a user's cached catalog", () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    expect(ignore).toMatch(/logsync\.item-catalog\.json/);
  });
});
