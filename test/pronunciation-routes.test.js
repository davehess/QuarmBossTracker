// test/pronunciation-routes.test.js — the bot's /api/agent/pronunciation* handlers, sliced out of index.js
// and run against a stand-in database: ownership (403), validation (400), ETag/304, cache invalidation.
//
// The guild lead, 2026-10-14: each player sets how their character's name should sound. Fixture names are
// invented (Aldenmar, Corvale); none is a member.
//
// Run: npx vitest run test/pronunciation-routes.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX } from './_source-slice.js';

const requireBot = createRequire(BOT_INDEX);
const SRC = readSource(BOT_INDEX);

function slice(name) {
  const m = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(SRC);
  if (!m) throw new Error('slice: function not found: ' + name);
  const end = SRC.indexOf('\n}\n', m.index);
  return SRC.slice(m.index, end + 3);
}

const mkReq = (url, headers = {}, body = null, method = 'GET') => {
  const chunks = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  return { url, method, headers, [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c; } };
};
const mkRes = () => {
  const r = { status: null, headers: null, body: null, writeHead(s, h) { r.status = s; r.headers = h; }, end(b) { r.body = b; } };
  return r;
};

let db, identity, upserts;
function load() {
  const supabase = {
    selectAllPaged: async (t) => db[t],
    select: async (t, q) => {
      if (t === 'characters') {
        const m = /name=ilike\.([^&]+)/.exec(q);
        const want = decodeURIComponent(m[1]).toLowerCase();
        return db.characters.filter(c => c.name.toLowerCase() === want);
      }
      return db[t];
    },
    upsert: async (t, rows) => { upserts.push({ t, rows }); return rows; },
    guildId: () => 'wolfpack',
  };
  const injected = {
    mimicLink: { requireAgentAuth: async () => identity },
    require: (p) => (p === './utils/supabase' ? supabase : requireBot(p)),
    process: { env: {} },
    suggestPronunciations: requireBot('./utils/pronounce').suggestPronunciations,
    validSay: requireBot('./utils/pronounce').validSay,
    coachingTips: requireBot('./utils/pronounce').coachingTips,
  };
  const names = ['_handleAgentPronunciations', '_handleAgentPronunciationSuggest', '_handleAgentPronunciationSet'];
  const consts = SRC.match(/^const _PRON_TTL_MS[^\n]*\nconst _PRON_NAME_RE[^\n]*\n/m)[0];
  const body = 'let _pronCache = null;\n' + consts + names.map(slice).join('\n')
    + '\nreturn { ' + names.join(', ') + ', peek: () => _pronCache };';
  // eslint-disable-next-line no-new-func
  return new Function(...Object.keys(injected), body)(...Object.values(injected));
}

beforeEach(() => {
  identity = { discord_id: '111' };
  upserts = [];
  db = {
    name_pronunciations: [
      { display_name: 'Aldenmar', say: 'AL-den-mar', updated_at: '2026-10-14T10:00:00Z' },
      { display_name: 'Corvale', say: 'KOR-vayl', updated_at: '2026-10-14T11:00:00Z' },
    ],
    characters: [
      { name: 'Aldenmar', discord_id: '111' },
      { name: 'Corvale', discord_id: '222' },
      { name: 'Zarrin', discord_id: null, main_name: 'Aldenmar' },     // an alt with no discord_id of its own
      { name: 'Brackwyn', discord_id: null, main_name: 'Corvale' },    // an alt of someone else's main
    ],
  };
});

describe('GET /api/agent/pronunciations', () => {
  it('serves name+say pairs with an ETag of newest updated_at + count, then 304s on a repeat', async () => {
    const h = load();
    const r1 = mkRes(); await h._handleAgentPronunciations(mkReq('/api/agent/pronunciations'), r1);
    expect(r1.status).toBe(200);
    expect(JSON.parse(r1.body)).toEqual({
      version: '2026-10-14T11:00:00Z#2',
      entries: [{ name: 'Aldenmar', say: 'AL-den-mar' }, { name: 'Corvale', say: 'KOR-vayl' }],
    });
    expect(r1.headers.ETag).toBe('"2026-10-14T11:00:00Z#2"');
    const r2 = mkRes(); await h._handleAgentPronunciations(mkReq('/x', { 'if-none-match': r1.headers.ETag }), r2);
    expect(r2.status).toBe(304);
  });

  it('503s when the read fails and nothing is cached', async () => {
    db.name_pronunciations = null;
    const r = mkRes(); await load()._handleAgentPronunciations(mkReq('/x'), r);
    expect(r.status).toBe(503);
  });
});

describe('GET /api/agent/pronunciation-suggest', () => {
  it('returns suggestions, tips and the saved spelling', async () => {
    const r = mkRes(); await load()._handleAgentPronunciationSuggest(mkReq('/api/agent/pronunciation-suggest?name=Aldenmar'), r);
    const j = JSON.parse(r.body);
    expect(j.name).toBe('Aldenmar');
    expect(j.suggestions.slice(0, 3)).toEqual(['AL-den-mar', 'al-DEN-mar', 'al-den-MAR']);
    expect(j.tips.length).toBeGreaterThan(0);
  });

  it('400s without a usable name', async () => {
    const r = mkRes(); await load()._handleAgentPronunciationSuggest(mkReq('/api/agent/pronunciation-suggest?name=%25%25'), r);
    expect(r.status).toBe(400);
  });
});

describe('POST /api/agent/pronunciation', () => {
  const post = (h, body) => { const r = mkRes(); return h._handleAgentPronunciationSet(mkReq('/api/agent/pronunciation', {}, body, 'POST'), r).then(() => r); };

  it('saves for the owner (case-insensitive name) and drops the cache', async () => {
    const h = load();
    await h._handleAgentPronunciations(mkReq('/x'), mkRes());
    expect(h.peek()).not.toBeNull();
    const r = await post(h, { character: 'aldenmar', say: "AL-den-mar's" });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(upserts[0].rows[0]).toMatchObject({
      guild_id: 'wolfpack', character_lc: 'aldenmar', display_name: 'Aldenmar', say: "AL-den-mar's", set_by_discord_id: '111',
    });
    expect(h.peek()).toBeNull();
  });

  it('lets the owner of the family root set an alt that carries no discord_id, and stores the alternates', async () => {
    const h = load();
    const r = await post(h, { character: 'zarrin', say: 'ZARR-in' });
    expect(r.status).toBe(200);
    expect(upserts[0].rows[0]).toMatchObject({ character_lc: 'zarrin', display_name: 'Zarrin', set_by_discord_id: '111' });
    expect(upserts[0].rows[0].alternates).toEqual(['ZAR-rin', 'zar-RIN']);
    expect((await post(h, { character: 'Brackwyn', say: 'BRACK-win' })).status).toBe(403);
  });

  it('403s for a character someone else owns, and for one that does not exist', async () => {
    const h = load();
    expect((await post(h, { character: 'Corvale', say: 'KOR-vayl' })).status).toBe(403);
    expect((await post(h, { character: 'Nobodyhere', say: 'no' })).status).toBe(403);
    expect(upserts).toHaveLength(0);
  });

  it('400s on a spelling that is empty, too long, or has digits or symbols', async () => {
    const h = load();
    for (const say of ['', 'x'.repeat(61), 'AL-3', 'AL<den>', '-lead']) {
      expect((await post(h, { character: 'Aldenmar', say })).status).toBe(400);
    }
    expect(upserts).toHaveLength(0);
  });
});
