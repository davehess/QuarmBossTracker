// test/setup-share.test.js — "Get a code" for a whole Mimic setup (the guild lead, 2026-10-19, DECISIONS §383: share-setup = A).
//
// The routes (utils/setupShare.js) and the bundle gate (utils/portableSetup.js) run for real against an in-memory stand-in
// for utils/supabase's bot_kv. Source-text assertions strip comments first: the header of every file here names the very
// things under test.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { BOT_INDEX, ROOT, readSource, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const share = require('../utils/setupShare.js');
const portableSetup = require('../utils/portableSetup.js');
const { createSetupShare, newCode, normalizeCode, ALPHABET, CODE_LEN, TTL_MS, KEY_PREFIX } = share;
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'portable-layout.json'), 'utf8'));

const ME = '900000000000000001';
const OTHER = '900000000000000002';
const HOUR = 3600 * 1000;

// A bundle the way Mimic builds one: two layouts, a HUD for one character, personal triggers for one and for all, rules.
function bundle(over = {}) {
  return {
    format: 'mimic-setup', version: 1,
    meta: { title: 'Raid night setup', byline: 'Aldenmar', note: 'Big meter on the left.' },
    slots: [{ slot: 'c1', label: 'Character 1' }, { slot: 'c2', label: 'Character 2' }],
    layouts: [
      { name: 'Raid', active: true, doc: fixture.docs.screen1080 },
      { name: 'Group', active: false, doc: fixture.docs.eq1440 },
    ],
    options: { overlay: { opacity: 0.8, compact: true }, melody: { showTimers: true } },
    hud: [{ slot: 'c1', parts: { ring: ['hp', 'mana'], scale: 1.1 } }],
    triggers: [
      { for: ['c1'], trigger: { name: 'Gravel Rain', pattern: 'Gravel Rain', actions: [{ type: 'tts', text: 'rain' }] } },
      { for: [], trigger: { name: 'Mez broke', pattern: 'Your mez broke', actions: [{ type: 'text_overlay', text: 'mez' }] } },
    ],
    rules: { 'personal:p_42': { all: 'speak', c1: 'off' }, 'builtin:enrage_soon:a sand giant': { all: 'overlay' } },
    ...over,
  };
}

function mkRes() {
  const out = { status: null, headers: {}, body: '' };
  return { out, writeHead(s, h) { out.status = s; out.headers = h || {}; }, end(b) { out.body = b || ''; } };
}
function mkReq(method, url, body) {
  const raw = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const r = Readable.from(raw);
  r.method = method; r.url = url; r.headers = {}; r.socket = { remoteAddress: '1.1.1.1' };
  return r;
}

let clock;
// In-memory bot_kv: the three calls the routes make, with the same filters they send.
function build({ identity = { discord_id: ME, is_officer: false }, randomInts = null, down = false } = {}) {
  const kv = new Map();   // key → { guild_id, key, value }
  const log = { dels: [], inserts: 0 };
  const q = (s) => Object.fromEntries(String(s).split('&').map(p => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
  const sb = {
    guildId: () => 'wolfpack',
    select: async (table, qs) => {
      if (down) return null;
      expect(table).toBe('bot_kv');
      expect(qs).toMatch(/limit=1/);                         // an unbounded read of bot_kv is a bug
      const f = q(qs);
      const row = kv.get(f.key.replace(/^eq\./, ''));
      return row ? [{ value: row.value }] : [];
    },
    insertIgnoreDuplicates: async (table, rows, opts) => {
      if (down) return null;
      expect(table).toBe('bot_kv');
      expect(opts).toEqual({ representation: true });        // the route needs to know whether it inserted
      log.inserts++;
      const out = [];
      for (const r of rows) if (!kv.has(r.key)) { kv.set(r.key, JSON.parse(JSON.stringify(r))); out.push(r); }
      return out;
    },
    del: async (table, qs) => {
      expect(table).toBe('bot_kv');
      log.dels.push(qs);
      const f = q(qs);
      if (f.key && f.key.startsWith('eq.')) { kv.delete(f.key.slice(3)); return null; }
      if (f.key && f.key.startsWith('like.')) {
        const prefix = f.key.slice(5).replace(/\*$/, '');
        const cutoff = f['value->>expires_at'].replace(/^lt\./, '');
        for (const [k, v] of [...kv]) if (k.startsWith(prefix) && v.value.expires_at < cutoff) kv.delete(k);
      }
      return null;
    },
  };
  const ctx = { identity };
  const ints = randomInts && [...randomInts];
  const s = createSetupShare({
    supabase: sb, requireAuth: async () => ctx.identity, now: () => clock,
    randomInt: ints ? () => ints.shift() ?? 0 : undefined,
  });
  const call = async (method, url, body) => {
    const res = mkRes();
    const handled = await s.handle(mkReq(method, url, body), res);
    return { handled, status: res.out.status, headers: res.out.headers, json: res.out.body ? JSON.parse(res.out.body) : null, raw: res.out.body };
  };
  return { kv, log, call, ctx, s };
}
const mint = async (b, setup = bundle()) => (await b.call('POST', '/api/agent/setup-share', { setup }));

beforeEach(() => { clock = Date.parse('2026-10-20T12:00:00Z'); });

describe('the code', () => {
  it('is six characters from an alphabet with no 0, O, 1, I or L', () => {
    expect(CODE_LEN).toBe(6);
    expect(ALPHABET).not.toMatch(/[01OIL]/);
    expect(new Set(ALPHABET).size).toBe(ALPHABET.length);
    for (let i = 0; i < 300; i++) expect(newCode()).toMatch(new RegExp(`^[${ALPHABET}]{6}$`));
  });

  it('uses every letter of the alphabet when the draw covers it', () => {
    let i = 0;
    const seen = new Set();
    while (seen.size < ALPHABET.length) for (const c of newCode(() => i++ % ALPHABET.length)) seen.add(c);
    expect([...seen].sort().join('')).toBe([...ALPHABET].sort().join(''));
  });

  it('is drawn from crypto.randomInt, never Math.random', () => {
    const src = stripJs(readSource(path.join(ROOT, 'utils', 'setupShare.js')));
    expect(src).toMatch(/crypto\.randomInt/);
    expect(src).not.toMatch(/Math\.random/);
  });

  it('normalizeCode ignores case, spaces and dashes, and refuses anything that is not a code', () => {
    expect(normalizeCode('abc-def')).toBe('ABCDEF');
    expect(normalizeCode('ab7 k9z')).toBe('AB7K9Z');
    expect(normalizeCode(' ab7-k9z ')).toBe('AB7K9Z');
    for (const bad of ['', null, undefined, 'AB7K9', 'AB7K9ZZ', 'AB7K90', 'ABOK9Z', 'AB1K9Z', 'ABIK9Z', 'ABLK9Z', 'AB7K9!', '../x']) {
      expect(normalizeCode(bad), String(bad)).toBeNull();
    }
  });
});

describe('POST /api/agent/setup-share', () => {
  it('stores the bundle under a fresh code in bot_kv for 24 hours and says so', async () => {
    const b = build();
    const r = await mint(b);
    expect(r.status).toBe(201);
    expect(r.json.ok).toBe(true);
    expect(r.json.code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(r.json.ttl_hours).toBe(24);
    expect(Date.parse(r.json.expires_at) - clock).toBe(TTL_MS);
    expect(r.json.summary).toEqual({ layouts: 2, options: 2, hud: 1, triggers: 2, rules: 2, characters: 2 });
    expect(b.kv.size).toBe(1);
    const row = b.kv.get(KEY_PREFIX + r.json.code);
    expect(row.guild_id).toBe('wolfpack');
    expect(row.value).toMatchObject({ owner: ME, expires_at: r.json.expires_at });
    expect(row.value.setup.layouts).toHaveLength(2);
  });

  it('never echoes the creator, in the create answer or the fetch', async () => {
    const b = build();
    const made = await mint(b);
    const got = await b.call('GET', '/api/agent/setup-share/' + made.json.code);
    expect(made.raw).not.toContain(ME);
    expect(got.raw).not.toContain(ME);
    expect(Object.keys(got.json).sort()).toEqual(['code', 'expires_at', 'ok', 'setup']);
  });

  it('sends no-store, so a bundle is never cached anywhere in between', async () => {
    const b = build();
    const made = await mint(b);
    expect(made.headers['Cache-Control']).toBe('no-store');
    expect((await b.call('GET', '/api/agent/setup-share/' + made.json.code)).headers['Cache-Control']).toBe('no-store');
  });

  it('stores what the gate rebuilt, not what was posted (unknown fields are dropped)', async () => {
    const b = build();
    const dirty = bundle({ evil: 1, meta: { title: 'T', extra: 'x' } });
    dirty.layouts[0] = { ...dirty.layouts[0], evil: 1 };
    const r = await mint(b, dirty);
    expect(r.status).toBe(201);
    const stored = b.kv.get(KEY_PREFIX + r.json.code).value.setup;
    expect(stored).not.toHaveProperty('evil');
    expect(stored.meta).toEqual({ title: 'T', byline: '', note: '' });
    expect(stored.layouts[0]).not.toHaveProperty('evil');
  });

  it('draws again when the code is taken (a collision), and does not overwrite the first', async () => {
    // randomInt calls: 6 for the first code, 6 for the second. Both attempts start with the same six draws.
    const b = build({ randomInts: [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
    const a = await mint(b, bundle({ meta: { title: 'first' } }));
    const c = await mint(b, bundle({ meta: { title: 'second' } }));
    expect(a.json.code).toBe('ABCDEF');
    expect(c.json.code).toBe('GHJKMN');
    expect(b.kv.get(KEY_PREFIX + 'ABCDEF').value.setup.meta.title).toBe('first');
    expect(b.log.inserts).toBe(3);
  });

  it('clears a LAPSED row that holds the drawn code, and still answers with a different code', async () => {
    // The first mint spends this hour's sweep, so the lapsed row below is cleared by the collision path or by nothing.
    const b = build({ randomInts: [9, 9, 9, 9, 9, 9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] });
    expect((await mint(b)).json.code).toBe('KKKKKK');
    b.kv.set(KEY_PREFIX + 'ABCDEF', { guild_id: 'wolfpack', key: KEY_PREFIX + 'ABCDEF', value: { owner: OTHER, expires_at: new Date(clock - 1000).toISOString(), setup: {} } });
    const r = await mint(b);
    expect(r.status).toBe(201);
    expect(r.json.code).toBe('GHJKMN');
    expect(b.kv.has(KEY_PREFIX + 'ABCDEF')).toBe(false);
  });

  it('gives up with a retryable 503 when it cannot find a free code', async () => {
    const b = build({ randomInts: [] });   // every draw is 0 → AAAAAA, which is taken
    b.kv.set(KEY_PREFIX + 'AAAAAA', { guild_id: 'wolfpack', key: KEY_PREFIX + 'AAAAAA', value: { owner: OTHER, expires_at: new Date(clock + HOUR).toISOString(), setup: {} } });
    const r = await mint(b);
    expect(r.status).toBe(503);
    expect(r.headers['Retry-After']).toBeTruthy();
    expect(b.kv.size).toBe(1);
  });

  it('503 store_unavailable (not a 401, not a lie, not "no free code") when the store is down', async () => {
    const r = await mint(build({ down: true }));
    expect(r.status).toBe(503);
    expect(r.json.error).toBe('store_unavailable');
    expect(r.headers['Retry-After']).toBeTruthy();
  });

  it('401 path: an unauthenticated call stores nothing', async () => {
    const b = build();
    b.ctx.identity = null;
    const r = await mint(b);
    expect(r.status).toBeNull();   // requireAuth answers the 401 itself; the route just stops
    expect(b.kv.size).toBe(0);
  });

  it('refuses a session with no Discord identity', async () => {
    const b = build({ identity: { discord_id: null } });
    expect((await mint(b)).status).toBe(403);
    expect(b.kv.size).toBe(0);
  });

  it('400 for a body that is not a JSON object, or with no setup', async () => {
    const b = build();
    for (const body of ['not json', '[1]', 'null', {}, { setup: 'x' }, { setup: [] }, undefined]) {
      expect((await b.call('POST', '/api/agent/setup-share', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(b.kv.size).toBe(0);
  });

  it('413 over the size cap (512 KB), before anything is stored', async () => {
    const b = build();
    const huge = bundle({ triggers: Array.from({ length: 400 }, (_, i) => ({ for: [], trigger: { name: 'n' + i, pattern: 'x'.repeat(1900) } })) });
    const r = await b.call('POST', '/api/agent/setup-share', { setup: huge });
    expect([400, 413]).toContain(r.status);
    expect(b.kv.size).toBe(0);
    const wayOver = await b.call('POST', '/api/agent/setup-share', { setup: bundle(), pad: 'x'.repeat(portableSetup.MAX_BYTES + 70 * 1024) });
    expect(wayOver.status).toBe(413);
    expect(wayOver.json.max_bytes).toBe(512 * 1024);
  });

  it('is POST only on the collection and GET/DELETE only on a code; anything else is a 405, other paths are not ours', async () => {
    const b = build();
    expect((await b.call('GET', '/api/agent/setup-share')).status).toBe(405);
    expect((await b.call('POST', '/api/agent/setup-share/ABCDEF', {})).status).toBe(405);
    expect((await b.call('PUT', '/api/agent/setup-share/ABCDEF', {})).status).toBe(405);
    expect((await b.call('POST', '/api/agent/setup-shares', {})).handled).toBe(false);
    expect((await b.call('POST', '/api/agent/gallery', {})).handled).toBe(false);
  });
});

describe('the bundle gate refuses what must never travel', () => {
  const refused = (over, expectMsg) => {
    const r = portableSetup.validate(bundle(over));
    expect(r.ok, JSON.stringify(over).slice(0, 80)).toBe(false);
    if (expectMsg) expect(r.error).toMatch(expectMsg);
    expect(r.error).not.toMatch(/wpms_|C:\\|webhooks/);   // the value is never echoed
    return r;
  };
  const trig = (t) => ({ triggers: [{ for: [], trigger: t }] });

  it('a sign-in or token field anywhere in a plain section', () => {
    refused(trig({ name: 'x', session_token: 'abc' }), /private/);
    refused(trig({ name: 'x', nested: { apiKey: 'abc' } }), /private/);
    refused({ options: { overlay: { discordToken: 'x' } } }, /private/);
    refused({ hud: [{ slot: 'c1', parts: { Authorization: 'x' } }] }, /private/);
    refused(trig({ name: 'x', webhook: 'x' }), /private/);
  });

  it('a path field, an EQ or log folder, a bid', () => {
    refused(trig({ name: 'x', soundPath: 'x' }), /private/);
    refused({ options: { overlay: { eqDir: 'x' } } }, /private/);
    refused({ options: { overlay: { log_dir: 'x', bids: [] } } }, /private/);
    refused({ options: { overlay: { bid: 5 } } }, /private/);
  });

  it('a string that is a Windows path, a UNC path, a file link, a home folder, a session token or a webhook', () => {
    const t = (v) => trig({ name: 'x', sound: v });
    refused(t('C:\\Users\\someone\\boom.wav'), /private/);
    refused(t('d:/EQ/sounds/x.wav'), /private/);
    refused(t('play it from C:\\Users\\someone\\boom.wav please'), /private/);   // not only at the start of the text
    refused(t('\\\\server\\share\\x.wav'), /private/);
    refused(t('file:///etc/passwd'), /private/);
    refused(t('/home/someone/x.wav'), /private/);
    refused(t('wpms_' + 'a'.repeat(64)), /private/);
    refused(t('https://discord.com/api/webhooks/123/abc'), /private/);
    refused(t('Bearer ' + 'a'.repeat(40)), /private/);
  });

  it('the same things hidden in a rule name, the byline or a character label', () => {
    refused({ rules: { 'personal:C:\\x': { all: 'speak' } } }, /private/);
    refused({ meta: { title: 'ok', byline: 'wpms_' + 'a'.repeat(64) } }, /private/);
    refused({ slots: [{ slot: 'c1', label: 'D:\\EQ' }, { slot: 'c2', label: 'x' }] }, /private/);
  });

  it('does not refuse ordinary settings that merely contain those words', () => {
    const r = portableSetup.validate(bundle({ options: { overlay: { sortDir: 'asc', forbidden: 1, sessionTable: true, growDirection: 'up', bidsOpenAlert: true } } }));
    expect(r.ok, r.error).toBe(true);
  });

  it('a character slot the setup does not list, or listed twice', () => {
    refused({ hud: [{ slot: 'c9', parts: {} }] }, /slot/);
    refused({ triggers: [{ for: ['c7'], trigger: { name: 'x' } }] }, /slot/);
    refused({ rules: { 'personal:k': { c9: 'speak' } } }, /slot/);
    refused({ slots: [{ slot: 'c1', label: 'a' }, { slot: 'c1', label: 'b' }] }, /twice/);
    refused({ slots: [{ slot: 'c13', label: 'a' }] }, /c1 to c12/);
  });

  it('a layout inside the bundle goes through the gallery validator (utils/portableLayout.js)', () => {
    const bad = JSON.parse(JSON.stringify(fixture.docs.screen1080));
    bad.groups[0].anchor = 'zz';
    refused({ layouts: [{ name: 'Bad', doc: bad }] }, /layouts\[0\]/);
    refused({ layouts: [{ name: 'Bad', doc: { format: 'mimic-layout', version: 2, kind: 'canvas' } }] }, /layouts\[0\]/);
    refused({ layouts: [{ name: '', doc: fixture.docs.screen1080 }] }, /no name/);
    // and what it keeps is the validator's rebuilt document
    const ok = portableSetup.validate(bundle());
    expect(ok.setup.layouts[0].doc).toEqual(require('../utils/portableLayout.js').validate(fixture.docs.screen1080).doc);
  });

  it('only one layout can be the active one', () => {
    const l = (name, active) => ({ name, active, doc: fixture.docs.screen1080 });
    const r = portableSetup.validate(bundle({ layouts: [l('A', true), l('B', true)] }));
    expect(r.setup.layouts.map(x => x.active)).toEqual([true, false]);
  });

  it('bounds: layouts, triggers, rules, depth, string length, field count', () => {
    const one = { name: 'L', doc: fixture.docs.screen1080 };
    refused({ layouts: Array.from({ length: 41 }, () => one) }, /at most 40/);
    expect(portableSetup.validate(bundle({ layouts: Array.from({ length: 40 }, () => one) })).ok).toBe(true);
    refused({ triggers: Array.from({ length: 1001 }, () => ({ for: [], trigger: { n: 1 } })) }, /at most 1000/);
    refused({ options: { overlay: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } } } }, /deeply/);
    refused(trig({ name: 'x'.repeat(2001) }), /longer than 2000/);
    refused(trig(Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['k' + i, 1]))), /more than 200/);
    refused({ rules: { 'personal:k': { all: 'shout' } } }, /mode/);
    refused({ rules: { 'personal:k': { all: 'silent' } } }, /mode/);        // the agent's modes are speak, overlay, off
    refused({ rules: { 'timer:x': { all: 'off' } } }, /rule name/);         // only the key shapes the agent's own sync takes
    refused({ rules: { ['personal:' + 'x'.repeat(201)]: { all: 'off' } } }, /rule name/);
    expect(portableSetup.validate(bundle({ rules: { 'group:zone:potime': { all: 'off' }, 'guild:12': { c1: 'overlay' }, 'builtin:charm_break': { all: 'speak' } } })).ok).toBe(true);
    refused({ options: { 'not a key': {} } }, /overlay name/);
  });

  it('an inherited or prototype-poisoning key never reaches the rebuilt document', () => {
    const poisoned = JSON.parse('{"name":"x","__proto__":{"admin":true}}');
    const r = portableSetup.validate(bundle({ triggers: [{ for: [], trigger: poisoned }] }));
    expect(r.ok).toBe(false);
    expect({}.admin).toBeUndefined();
  });

  it('refuses a bundle with nothing in it, the wrong format and a newer version', () => {
    expect(portableSetup.validate(bundle({ layouts: [], options: {}, hud: [], triggers: [], rules: {} })).ok).toBe(false);
    expect(portableSetup.validate({ ...bundle(), format: 'mimic-layout' }).ok).toBe(false);
    expect(portableSetup.validate({ ...bundle(), version: 2 }).error).toMatch(/newer Mimic/);
    expect(portableSetup.validate({ ...bundle(), version: 0 }).ok).toBe(false);
    for (const x of [null, 'x', [], 5]) expect(portableSetup.validate(x).ok).toBe(false);
  });

  it('over the byte cap after rebuilding is refused with the size in the message', () => {
    const pad = (i) => ({ for: [], trigger: { name: 'n' + i, pattern: 'x'.repeat(1900), more: 'y'.repeat(100) } });
    const r = portableSetup.validate(bundle({ triggers: Array.from({ length: 300 }, (_, i) => pad(i)) }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/512 KB/);
  });

  it('the route answers 400 not_shareable with the reason, and stores nothing', async () => {
    const b = build();
    const r = await mint(b, bundle({ triggers: [{ for: [], trigger: { name: 'x', sound: 'C:\\EQ\\x.wav' } }] }));
    expect(r.status).toBe(400);
    expect(r.json.error).toBe('not_shareable');
    expect(r.json.message).toMatch(/private/);
    expect(r.raw).not.toContain('EQ');
    expect(b.kv.size).toBe(0);
  });
});

describe('GET /api/agent/setup-share/<code>', () => {
  it('returns the bundle to another member, by the code however it is typed', async () => {
    const b = build();
    const made = await mint(b);
    b.ctx.identity = { discord_id: OTHER };
    const typed = made.json.code.toLowerCase().slice(0, 3) + '-' + made.json.code.slice(3);
    const got = await b.call('GET', '/api/agent/setup-share/' + typed);
    expect(got.status).toBe(200);
    expect(got.json.code).toBe(made.json.code);
    expect(got.json.setup.layouts).toHaveLength(2);
    expect(got.json.setup.triggers).toHaveLength(2);
  });

  it('is REUSABLE for the 24 hours: a second install reads the same code again', async () => {
    const b = build();
    const made = await mint(b);
    for (let i = 0; i < 3; i++) expect((await b.call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(200);
    expect(b.kv.size).toBe(1);
  });

  it('the last millisecond is valid, the 24-hour mark is not: expiry is enforced on read, and the row goes', async () => {
    const b = build();
    const made = await mint(b);
    clock += TTL_MS - 1;
    expect((await b.call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(200);
    clock += 1;
    const gone = await b.call('GET', '/api/agent/setup-share/' + made.json.code);
    expect(gone.status).toBe(404);
    expect(gone.json.error).toBe('not_found');
    expect(b.kv.size).toBe(0);
  });

  it('an expired code and a code that never existed give the same answer', async () => {
    const b = build();
    const made = await mint(b);
    clock += TTL_MS + 1;
    const a = await b.call('GET', '/api/agent/setup-share/' + made.json.code);
    const z = await b.call('GET', '/api/agent/setup-share/ZZZZZZ');
    expect(a.status).toBe(z.status);
    expect(a.raw).toBe(z.raw);
  });

  it('a row with a damaged or missing expiry reads as expired', async () => {
    const b = build();
    b.kv.set(KEY_PREFIX + 'ABCDEF', { guild_id: 'wolfpack', key: KEY_PREFIX + 'ABCDEF', value: { owner: ME, setup: {} } });
    expect((await b.call('GET', '/api/agent/setup-share/ABCDEF')).status).toBe(404);
    b.kv.set(KEY_PREFIX + 'BCDEFG', { guild_id: 'wolfpack', key: KEY_PREFIX + 'BCDEFG', value: { owner: ME, expires_at: 'soon', setup: {} } });
    expect((await b.call('GET', '/api/agent/setup-share/BCDEFG')).status).toBe(404);
  });

  it('400 for something that is not shaped like a code (and no store read is made)', async () => {
    const b = build();
    for (const bad of ['ABC', 'ABCDEFG', 'ABCDE0', 'ABCDE1', 'ABCDEO', 'ABCDEI', '..%2Fkv']) {
      expect((await b.call('GET', '/api/agent/setup-share/' + bad)).status, bad).toBe(400);
    }
  });

  it('401 path: needs a signed-in member', async () => {
    const b = build();
    const made = await mint(b);
    b.ctx.identity = null;
    const r = await b.call('GET', '/api/agent/setup-share/' + made.json.code);
    expect(r.status).toBeNull();
    expect(r.raw).toBe('');
  });

  it('503 when the store is down: a failed read is not "no such code" (and does not count as a wrong guess)', async () => {
    const b = build();
    const made = await mint(b);
    const down = build({ down: true });
    for (let i = 0; i < 20; i++) expect((await down.call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(503);
    expect((await build().call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(404);   // a different store has none
  });

  it('the key it reads is exactly the code it was given, in this guild', async () => {
    const b = build();
    const made = await mint(b);
    expect([...b.kv.keys()]).toEqual([KEY_PREFIX + made.json.code]);
  });
});

describe('DELETE /api/agent/setup-share/<code>', () => {
  it('the member who made a code can end it early', async () => {
    const b = build();
    const made = await mint(b);
    expect((await b.call('DELETE', '/api/agent/setup-share/' + made.json.code)).status).toBe(200);
    expect(b.kv.size).toBe(0);
    expect((await b.call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(404);
  });

  it('nobody else can, and a code that is not theirs looks the same as one that does not exist', async () => {
    const b = build();
    const made = await mint(b);
    b.ctx.identity = { discord_id: OTHER };
    const theirs = await b.call('DELETE', '/api/agent/setup-share/' + made.json.code);
    const none = await b.call('DELETE', '/api/agent/setup-share/ZZZZZZ');
    expect(theirs.status).toBe(404);
    expect(theirs.raw).toBe(none.raw);
    expect(b.kv.size).toBe(1);
  });
});

describe('limits', () => {
  it('10 codes an hour per member; the 11th is a 429 with Retry-After, nothing stored, and the hour resets', async () => {
    expect(share.CREATES_PER_HOUR).toBe(10);   // the contract's number, spelled out so a changed constant cannot pass by following itself
    const b = build();
    for (let i = 0; i < 10; i++) expect((await mint(b)).status).toBe(201);
    const r = await mint(b);
    expect(r.status).toBe(429);
    expect(Number(r.headers['Retry-After'])).toBeGreaterThan(0);
    expect(b.kv.size).toBe(10);
    b.ctx.identity = { discord_id: OTHER };
    expect((await mint(b)).status).toBe(201);            // someone else is unaffected
    b.ctx.identity = { discord_id: ME };
    clock += HOUR + 1;
    expect((await mint(b)).status).toBe(201);
  });

  it('a body the gate refuses does not spend the hour', async () => {
    const b = build();
    for (let i = 0; i < 15; i++) expect((await mint(b, bundle({ rules: { 'personal:k': { all: 'shout' } } }))).status).toBe(400);
    expect((await mint(b)).status).toBe(201);
  });

  it('15 wrong codes an hour per member, then 429 even for a right one; the hour resets', async () => {
    expect(share.MISSES_PER_HOUR).toBe(15);
    const b = build();
    const made = await mint(b);
    b.ctx.identity = { discord_id: OTHER };
    for (let i = 0; i < 15; i++) expect((await b.call('GET', '/api/agent/setup-share/ZZZZZZ')).status).toBe(404);
    const blocked = await b.call('GET', '/api/agent/setup-share/' + made.json.code);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['Retry-After'])).toBeGreaterThan(0);
    expect(blocked.raw).not.toContain('"setup"');
    clock += HOUR + 1;
    expect((await b.call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(200);
  });

  it('60 reads an hour per member', async () => {
    expect(share.FETCHES_PER_HOUR).toBe(60);
    const b = build();
    const made = await mint(b);
    for (let i = 0; i < 60; i++) expect((await b.call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(200);
    expect((await b.call('GET', '/api/agent/setup-share/' + made.json.code)).status).toBe(429);
  });
});

describe('the sweep', () => {
  it('a create clears expired rows (and only expired ones), at most once an hour', async () => {
    const b = build();
    const old = await mint(b);
    const fresh = await mint(b);
    clock += TTL_MS + 1000;
    // a row from another feature sharing the table, never touched
    b.kv.set('some_other_latch', { guild_id: 'wolfpack', key: 'some_other_latch', value: { expires_at: '2000-01-01T00:00:00.000Z' } });
    b.ctx.identity = { discord_id: OTHER };
    const third = await mint(b);
    await Promise.resolve();
    expect(b.kv.has(KEY_PREFIX + old.json.code)).toBe(false);
    expect(b.kv.has(KEY_PREFIX + fresh.json.code)).toBe(false);
    expect(b.kv.has(KEY_PREFIX + third.json.code)).toBe(true);
    expect(b.kv.has('some_other_latch')).toBe(true);
    const sweeps = b.log.dels.filter(d => /key=like\./.test(d)).length;
    await mint(b);
    expect(b.log.dels.filter(d => /key=like\./.test(d)).length).toBe(sweeps);   // not again within the hour
  });
});

describe('wiring', () => {
  const index = stripJs(readSource(BOT_INDEX));

  it('index.js answers /api/agent/setup-share through utils/setupShare with the Mimic session as the gate', () => {
    expect(index).toMatch(/require\('\.\/utils\/setupShare'\)\.createSetupShare\(/);
    expect(index).toContain('/^\\/api\\/agent\\/setup-share(?:[/?#]|$)/.test(req.url)');
    const block = index.slice(index.indexOf('createSetupShare('), index.indexOf('createSetupShare(') + 300);
    expect(block).toMatch(/requireAgentAuth/);
  });

  it('is not one of the streams an officer can shed or a budget can count (it is not an upload)', () => {
    expect(index).not.toMatch(/flag_shed_setup/);
  });

  it('uses no migration: bot_kv is the store, and there is no setup_shares table anywhere', () => {
    const migs = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).map(f => fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', f), 'utf8')).join('\n');
    expect(migs).not.toMatch(/setup_share/i);
    const src = stripJs(readSource(path.join(ROOT, 'utils', 'setupShare.js')));
    expect(src).toMatch(/supabase\.(?:select|insertIgnoreDuplicates|del)\('bot_kv'/);
    expect(src).not.toMatch(/state\.json|require\('\.\/state'\)/);
  });
});
