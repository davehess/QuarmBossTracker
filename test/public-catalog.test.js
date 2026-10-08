// GET /api/public/catalog/<name> — the three spell/item catalogs without
// sign-in, so the Mimic build can bundle them for local-mode installs (the
// guild lead, 2026-10-01; DECISIONS §118).
//
// Two things must hold: the public path really skips sign-in (or the build
// gets a 401 and ships an installer with no spell data), and the agent path
// still requires it. Both are run, not read: each handler is evaluated with a
// stubbed auth check and a warm cache.
import { describe, it, expect } from 'vitest';
import { BOT_INDEX, readSource, sliceBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);

const HANDLERS = [
  ['spell-catalog', '_handleAgentSpellCatalog', '_spellCatalogCache', '_SPELL_CATALOG_TTL_MS'],
  ['item-clickies', '_handleAgentItemClickies', '_itemClickyCache', '_ITEM_CLICKY_TTL_MS'],
  ['item-catalog', '_handleAgentItemCatalog', '_itemCatalogCache', '_ITEM_CATALOG_TTL_MS'],
];

function run(fnName, cacheName, ttlName, isPublic) {
  const block = sliceBlock(src, `async function ${fnName}(req, res`, '\n}');
  const authCalls = [];
  const mimicLink = { requireAgentAuth: async () => { authCalls.push(1); return null; } };
  const cache = { fetchedAt: Date.now(), body: '{"entries":[]}', etag: '"abc"' };
  // eslint-disable-next-line no-new-func
  const fn = new Function('mimicLink', cacheName, ttlName, `${block}\nreturn ${fnName};`)(
    mimicLink, cache, 60 * 60 * 1000);
  const out = { status: null, body: null };
  const res = {
    writeHead: (s) => { out.status = s; },
    end: (b) => { out.body = b; },
  };
  return fn({ headers: {} }, res, isPublic).then(() => ({ ...out, authCalls: authCalls.length }));
}

describe('public catalog route', () => {
  for (const [name, fnName, cacheName, ttlName] of HANDLERS) {
    it(`${name}: the public path serves the cached body without asking for sign-in`, async () => {
      const r = await run(fnName, cacheName, ttlName, true);
      expect(r.authCalls).toBe(0);
      expect(r.status).toBe(200);
      expect(r.body).toBe('{"entries":[]}');
    });

    it(`${name}: the agent path still requires sign-in`, async () => {
      const r = await run(fnName, cacheName, ttlName, undefined);
      expect(r.authCalls).toBe(1);
      expect(r.body).toBe(null);   // the stubbed check refused, nothing was served
    });
  }

  it('maps exactly the three catalog names and 404s anything else', () => {
    const code = stripJs(src);
    const at = code.indexOf("req.url.startsWith('/api/public/catalog/')");
    expect(at).toBeGreaterThan(0);
    const route = code.slice(at, at + 900);
    expect(route).toMatch(/which === 'spell-catalog' \? _handleAgentSpellCatalog/);
    expect(route).toMatch(/which === 'item-clickies' \? _handleAgentItemClickies/);
    expect(route).toMatch(/which === 'item-catalog' \? _handleAgentItemCatalog : null/);
    expect(route).toMatch(/writeHead\(404/);
    expect(route).toMatch(/handler\(req, res, true\)/);
  });
});
