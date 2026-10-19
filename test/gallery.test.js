// test/gallery.test.js — the Masterpiece Gallery (Keepers of the Arts; the guild lead, 2026-10-19).
//
// The routes run for real against an in-memory stand-in for utils/supabase. The stand-in is deliberately DUMB about
// filters (a list read returns every row, guild-only and hidden ones included) so a test that passes proves the BOT
// withheld the row, not that a fake database did. The adoption primary key and the count trigger are the one thing
// the stand-in imitates, because they live in the migration; the migration text is asserted separately.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { BOT_INDEX, ROOT, readSource, stripJs, stripSql } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { createGallery, PUBLIC_COLS } = require('../utils/gallery.js');
const gs = require('../utils/gallerySpec.js');

const AUTHOR = '900000000000000001';
const OTHER = '900000000000000002';
const OFFICER = '900000000000000003';
const EDIT_KEY = 'edit-key-hash-should-never-leak';
const SALT = 'test-salt';

// A real portable layout, produced by Mimic's own toPortable (see test/gallery-portable.test.js).
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'portable-layout.json'), 'utf8')).docs.screen1080;
const SPEC = FIXTURE;
const withMeta = (meta) => ({ ...FIXTURE, meta: { ...FIXTURE.meta, ...meta } });
const PIECE = FIXTURE.groups[0].panels[0];

function uuid(n) { return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`; }

function fakeSupabase(initial = []) {
  const db = {
    gallery_masterpieces: initial.map(r => ({ ...r })),
    gallery_versions: [], gallery_adoptions: [], gallery_reports: [],
  };
  const queries = [];
  const q = (qs) => new URLSearchParams(qs);
  let seq = 100;
  const f = {
    db, queries,
    guildId: () => 'wolfpack',
    async select(table, qs) {
      queries.push({ table, qs });
      const p = q(qs);
      let rows = db[table].map(r => ({ ...r }));
      const eq = (col) => { const v = p.get(col); return v && v.startsWith('eq.') ? v.slice(3) : null; };
      // Filters the bot's own correctness does not depend on are NOT applied (see the header); only id lookups are.
      if (eq('id')) rows = rows.filter(r => r.id === eq('id'));
      if (table === 'gallery_versions') {
        rows = rows.filter(r => r.masterpiece_id === eq('masterpiece_id') && String(r.version) === eq('version'));
      }
      if (table === 'gallery_reports') {
        rows = rows.filter(r => r.masterpiece_id === eq('masterpiece_id'));
        const gt = p.get('created_at');
        if (gt && gt.startsWith('gt.')) rows = rows.filter(r => r.created_at > gt.slice(3));
      }
      return rows;
    },
    async insert(table, rows) {
      const out = [];
      for (const r of rows) {
        if (table === 'gallery_versions' && db.gallery_versions.some(v => v.masterpiece_id === r.masterpiece_id && v.version === r.version)) return null;
        const row = { adoptions_count: 0, featured: false, created_at: new Date(1e12 + (seq++) * 1000).toISOString(), ...r };
        if (table === 'gallery_masterpieces') row.id = uuid(seq++);
        db[table].push(row);
        out.push({ ...row });
      }
      return out;
    },
    async insertIgnoreDuplicates(table, rows) {
      const out = [];
      for (const r of rows) {
        if (table === 'gallery_adoptions') {
          if (db.gallery_adoptions.some(a => a.masterpiece_id === r.masterpiece_id && a.adopter_key === r.adopter_key)) continue;
          db.gallery_adoptions.push({ ...r });
          const m = db.gallery_masterpieces.find(x => x.id === r.masterpiece_id);
          if (m) m.adoptions_count += 1;                       // the migration's trigger
        } else if (table === 'gallery_reports') {
          const key = r.reporter_discord_id || r.ip_hash;
          if (db.gallery_reports.some(x => x.masterpiece_id === r.masterpiece_id && (x.reporter_discord_id || x.ip_hash) === key)) continue;
          db.gallery_reports.push({ ...r, created_at: new Date(1e12 + (seq++) * 1000).toISOString() });
        }
        out.push({ ...r });
      }
      return out;
    },
    async update(table, qs, body) {
      const p = q(qs);
      if (table === 'gallery_reports') {             // the 30-day prune: ip_hash not null AND created_at < cutoff
        const cutoff = p.get('created_at').slice(3);
        const old = db.gallery_reports.filter(r => r.ip_hash && r.created_at < cutoff);
        for (const r of old) Object.assign(r, body);
        return old.map(r => ({ ...r }));
      }
      const id = p.get('id') && p.get('id').slice(3);
      const need = p.get('status') && p.get('status').slice(3);
      const hit = db[table].filter(r => r.id === id && (!need || r.status === need));
      for (const r of hit) Object.assign(r, body);
      return hit.map(r => ({ ...r }));
    },
    async del(table, qs) {
      const p = q(qs);
      const id = p.get('id').slice(3);
      db[table] = db[table].filter(r => r.id !== id);
      db.gallery_versions = db.gallery_versions.filter(v => v.masterpiece_id !== id);
      return [];
    },
  };
  return f;
}

function mkRes() {
  const out = { status: null, headers: {}, body: '' };
  return {
    out,
    writeHead(s, h) { out.status = s; out.headers = h || {}; },
    end(b) { out.body = b || ''; },
  };
}
function mkReq(method, url, body, headers = {}) {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  r.method = method; r.url = url; r.headers = headers; r.socket = { remoteAddress: '1.1.1.1' };
  return r;
}

function row(n, extra = {}) {
  return {
    id: uuid(n), guild_id: 'wolfpack', title: `Layout ${n}`, blurb: '', classes: [], min_level: 1, modes: ['raid'], byline: null,
    submitter_kind: 'member', author_discord_id: AUTHOR, edit_key_hash: EDIT_KEY, visibility: 'public', status: 'published',
    featured: false, adoptions_count: 0, latest_version: 1, thumb: null,
    created_at: new Date(1e12 + n * 1000).toISOString(), updated_at: new Date(1e12).toISOString(), ...extra,
  };
}

let clock;
function build(rows = [], { identity = { discord_id: AUTHOR, is_officer: false } } = {}) {
  const sb = fakeSupabase(rows);
  for (const r of rows) sb.db.gallery_versions.push({ masterpiece_id: r.id, version: 1, spec: SPEC, needs: [] });
  const ctx = { identity };
  const g = createGallery({ supabase: sb, requireAuth: async () => ctx.identity, salt: SALT, now: () => clock });
  const call = async (method, url, body, headers) => {
    const res = mkRes();
    const handled = await g.handle(mkReq(method, url, body, headers), res);
    return { handled, status: res.out.status, headers: res.out.headers, json: res.out.body ? JSON.parse(res.out.body) : null, raw: res.out.body };
  };
  return { sb, g, call, ctx };
}

beforeEach(() => { clock = 1e12 + 10_000_000; });

describe('gallery list', () => {
  it('serves the Hall first, then most used', async () => {
    const { call } = build([
      row(1, { adoptions_count: 5 }),
      row(2, { adoptions_count: 50 }),
      row(3, { adoptions_count: 1, featured: true }),
      row(4, { adoptions_count: 9, featured: true }),
      row(5, { adoptions_count: 20 }),
    ]);
    const r = await call('GET', '/api/public/gallery');
    expect(r.status).toBe(200);
    expect(r.json.items.map(i => i.id)).toEqual([uuid(4), uuid(3), uuid(2), uuid(5), uuid(1)]);
    expect(r.json.items.slice(0, 2).every(i => i.hall)).toBe(true);
  });

  it('never lists a guild-only, draft, hidden or pending layout', async () => {
    const { call } = build([
      row(1), row(2, { visibility: 'guild' }), row(3, { status: 'draft' }), row(4, { status: 'hidden' }),
      row(5, { status: 'pending' }), row(6, { status: 'removed' }),
    ]);
    const r = await call('GET', '/api/public/gallery');
    expect(r.json.items.map(i => i.id)).toEqual([uuid(1)]);
    const d = await call('GET', `/api/public/gallery/${uuid(2)}`);
    expect(d.status).toBe(404);
  });

  it('asks the database for public + published only, with a bounded read', async () => {
    const { call, sb } = build([row(1)]);
    await call('GET', '/api/public/gallery');
    const qs = sb.queries.find(x => x.table === 'gallery_masterpieces').qs;
    expect(qs).toMatch(/visibility=eq\.public/);
    expect(qs).toMatch(/status=eq\.published/);
    expect(qs).toMatch(/order=featured\.desc,adoptions_count\.desc/);
    expect(qs).toMatch(/limit=\d+/);
  });

  it('filters by class and mode; an untagged layout suits every class', async () => {
    const { call } = build([
      row(1, { classes: ['Wizard'], modes: ['raid'] }), row(2, { classes: ['Cleric'], modes: ['raid', 'solo'] }),
      row(3, { classes: [], modes: ['solo'] }), row(4, { classes: ['Wizard'], modes: ['group', 'solo'] }),
    ]);
    const wiz = await call('GET', '/api/public/gallery?class=wizard');
    expect(wiz.json.items.map(i => i.id).sort()).toEqual([uuid(1), uuid(3), uuid(4)]);
    const solo = await call('GET', '/api/public/gallery?class=Wizard&mode=solo');
    expect(solo.json.items.map(i => i.id).sort()).toEqual([uuid(3), uuid(4)]);
    // junk filter values are ignored, not echoed into a query
    const junk = await call('GET', '/api/public/gallery?class=%27%3Bdrop&mode=x');
    expect(junk.json.total).toBe(4);
  });

  it('is cached and ETag\'d: a repeat is one database read, a matching ETag is a 304', async () => {
    const { call, sb } = build([row(1)]);
    const a = await call('GET', '/api/public/gallery');
    const b = await call('GET', '/api/public/gallery');
    expect(sb.queries.filter(x => x.table === 'gallery_masterpieces').length).toBe(1);
    expect(a.headers.ETag).toBeTruthy();
    expect(b.headers.ETag).toBe(a.headers.ETag);
    const c = await call('GET', '/api/public/gallery', undefined, { 'if-none-match': a.headers.ETag });
    expect(c.status).toBe(304);
    clock += 61_000;
    await call('GET', '/api/public/gallery');
    expect(sb.queries.filter(x => x.table === 'gallery_masterpieces').length).toBe(2);
  });
});

describe('private columns', () => {
  it('never appear in a public list or detail response', async () => {
    const { call, sb } = build([row(1, { ip_hash: 'iphash-secret', hidden_by: 'reports', reviewed_at: 'x' })]);
    const list = await call('GET', '/api/public/gallery');
    const one = await call('GET', `/api/public/gallery/${uuid(1)}`);
    for (const r of [list, one]) {
      expect(r.status).toBe(200);
      for (const secret of [AUTHOR, EDIT_KEY, 'iphash-secret', 'author_discord_id', 'edit_key_hash', 'ip_hash', 'hidden_by', 'reviewed_at', 'guild_id']) {
        expect(r.raw).not.toContain(secret);
      }
    }
    for (const x of sb.queries.filter(x => x.table === 'gallery_masterpieces')) {
      expect(x.qs).not.toMatch(/author_discord_id|edit_key_hash|ip_hash/);
    }
    expect(PUBLIC_COLS).not.toMatch(/author_discord_id|edit_key_hash/);
    expect(list.json.items[0].badge).toBe('Wolf Pack member');
  });

  it('the member routes do not echo the author id either', async () => {
    const { call } = build([row(1, { visibility: 'guild' })]);
    const list = await call('GET', '/api/agent/gallery');
    const one = await call('GET', `/api/agent/gallery/${uuid(1)}`);
    for (const r of [list, one]) {
      expect(r.status).toBe(200);
      expect(r.raw).not.toContain(AUTHOR);
      expect(r.raw).not.toContain('author_discord_id');
    }
    expect(one.json.item.mine).toBe(true);
  });
});

describe('adoption', () => {
  it('counts once per anonymous install key, however many times it is sent', async () => {
    const { call, sb } = build([row(1)]);
    const id = 'a'.repeat(32);
    const a = await call('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: id });
    const b = await call('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: id });
    const c = await call('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: 'b'.repeat(32) });
    expect([a.json.counted, b.json.counted, c.json.counted]).toEqual([true, false, true]);
    expect(sb.db.gallery_masterpieces[0].adoptions_count).toBe(2);
    expect(sb.db.gallery_adoptions.length).toBe(2);
  });

  it('stores a salted hash of the install id, never the id itself', async () => {
    const { call, sb } = build([row(1)]);
    const id = 'rawinstallid-1234567890';
    await call('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: id });
    const key = sb.db.gallery_adoptions[0].adopter_key;
    expect(key).toMatch(/^i:[0-9a-f]{64}$/);
    expect(JSON.stringify(sb.db.gallery_adoptions)).not.toContain(id);
  });

  it('rejects a missing or malformed install id and a layout that is not public', async () => {
    const { call } = build([row(1), row(2, { visibility: 'guild' })]);
    expect((await call('POST', `/api/public/gallery/${uuid(1)}/adopt`, {})).status).toBe(400);
    expect((await call('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: 'short' })).status).toBe(400);
    expect((await call('POST', `/api/public/gallery/${uuid(2)}/adopt`, { install_id: 'c'.repeat(32) })).status).toBe(404);
  });

  it('rate-limits a flood of fresh install ids from one address', async () => {
    const { call, sb } = build([row(1)]);
    let last;
    for (let i = 0; i < 31; i++) last = await call('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: String(i).padStart(20, 'x') }, { 'x-real-ip': '9.9.9.9' });
    expect(last.status).toBe(429);
    expect(sb.db.gallery_adoptions.length).toBe(30);
  });

  it('a signed-in member adopts under their own key, once', async () => {
    const { call, sb } = build([row(1, { visibility: 'guild' })], { identity: { discord_id: OTHER, is_officer: false } });
    const a = await call('POST', `/api/agent/gallery/${uuid(1)}/adopt`, {});
    const b = await call('POST', `/api/agent/gallery/${uuid(1)}/adopt`, {});
    expect([a.json.counted, b.json.counted]).toEqual([true, false]);
    expect(sb.db.gallery_adoptions[0].adopter_key).toBe(`d:${OTHER}`);
  });
});

describe('reports', () => {
  const report = (call, n, ip, reason = 'spam') =>
    call('POST', `/api/public/gallery/${uuid(n)}/report`, { reason }, { 'x-real-ip': ip });

  it('three distinct reporters hide a layout pending review; two do not', async () => {
    const { call, sb } = build([row(1)]);
    await report(call, 1, '1.0.0.1');
    await report(call, 1, '1.0.0.2');
    expect(sb.db.gallery_masterpieces[0].status).toBe('published');
    await report(call, 1, '1.0.0.3');
    expect(sb.db.gallery_masterpieces[0].status).toBe('hidden');
    expect(sb.db.gallery_masterpieces[0].hidden_by).toBe('reports');
    const list = await call('GET', '/api/public/gallery');
    expect(list.json.items).toEqual([]);
    expect((await call('GET', `/api/public/gallery/${uuid(1)}`)).status).toBe(404);
  });

  it('one address reporting repeatedly counts once', async () => {
    const { call, sb } = build([row(1)]);
    for (let i = 0; i < 5; i++) await report(call, 1, '2.0.0.1');
    expect(sb.db.gallery_reports.length).toBe(1);
    expect(sb.db.gallery_masterpieces[0].status).toBe('published');
  });

  it('stores a salted hash of the address, not the address', async () => {
    const { call, sb } = build([row(1)]);
    await report(call, 1, '3.3.3.3');
    expect(sb.db.gallery_reports[0].ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(sb.db.gallery_reports)).not.toContain('3.3.3.3');
  });

  it('nulls an address hash after 30 days; the row stays and still counts', async () => {
    const { call, sb } = build([row(1)]);
    const day = 24 * 3600 * 1000;
    sb.db.gallery_reports.push({ masterpiece_id: uuid(1), reason: 'spam', ip_hash: 'old-hash', created_at: new Date(clock - 31 * day).toISOString() });
    sb.db.gallery_reports.push({ masterpiece_id: uuid(1), reason: 'spam', ip_hash: 'recent-hash', created_at: new Date(clock - 29 * day).toISOString() });
    await report(call, 1, '6.0.0.1');
    const byAge = sb.db.gallery_reports.slice(0, 2);
    expect(byAge[0].ip_hash).toBe(null);
    expect(byAge[1].ip_hash).toBe('recent-hash');
    expect(sb.db.gallery_reports.length).toBe(3);
  });

  it('takes only a reason from the closed list', async () => {
    const { call } = build([row(1)]);
    expect((await report(call, 1, '4.0.0.1', '<script>')).status).toBe(400);
    expect((await report(call, 1, '4.0.0.2', 'offensive')).status).toBe(200);
  });

  it('an officer unhide clears the count so old reports do not re-hide it', async () => {
    const { call, sb, ctx } = build([row(1)]);
    for (const ip of ['5.0.0.1', '5.0.0.2', '5.0.0.3']) await report(call, 1, ip);
    expect(sb.db.gallery_masterpieces[0].status).toBe('hidden');
    ctx.identity = { discord_id: OFFICER, is_officer: true };
    clock += 5000;
    const un = await call('POST', `/api/agent/gallery/${uuid(1)}/hide`, { hidden: false });
    expect(un.status).toBe(200);
    expect(sb.db.gallery_masterpieces[0].status).toBe('published');
    await report(call, 1, '5.0.0.4');
    expect(sb.db.gallery_masterpieces[0].status).toBe('published');
  });
});

describe('member routes', () => {
  it('publish defaults to guild-only, validates the spec, and is off the public list until the author goes public', async () => {
    const { call, sb } = build([]);
    const bad = await call('POST', '/api/agent/gallery', { spec: withMeta({ title: '<b>hi</b>' }) });
    expect(bad.status).toBe(400);
    const ok = await call('POST', '/api/agent/gallery', { spec: SPEC });
    expect(ok.status).toBe(200);
    const m = sb.db.gallery_masterpieces[0];
    expect(m.visibility).toBe('guild');
    expect(m.status).toBe('published');
    // the listing is read from the document's meta
    expect([m.title, m.blurb, m.byline, m.classes, m.modes]).toEqual(
      [SPEC.meta.title, SPEC.meta.description, SPEC.meta.author, SPEC.meta.classes, SPEC.meta.modes]);
    expect(m.thumb.g.length).toBe(SPEC.groups.length);
    expect(sb.db.gallery_versions[0].needs).toEqual(SPEC.needs);
    expect(m.author_discord_id).toBe(AUTHOR);
    expect(sb.db.gallery_versions.length).toBe(1);
    expect((await call('GET', '/api/public/gallery')).json.items).toEqual([]);
    const vis = await call('POST', `/api/agent/gallery/${ok.json.id}/visibility`, { visibility: 'public' });
    expect(vis.status).toBe(200);
    expect((await call('GET', '/api/public/gallery')).json.items.map(i => i.id)).toEqual([ok.json.id]);
  });

  it('rejects unknown fields on publish and a byline that is a link', async () => {
    const { call } = build([]);
    expect((await call('POST', '/api/agent/gallery', { spec: SPEC, author_discord_id: OTHER })).status).toBe(400);
    expect((await call('POST', '/api/agent/gallery', { spec: SPEC, title: 'x' })).status).toBe(400);   // the title is the document's
    expect((await call('POST', '/api/agent/gallery', { spec: withMeta({ author: 'visit evil.com' }) })).status).toBe(400);
  });

  it('a new version carries its own title, classes and byline (no separate text edit in v1)', async () => {
    const { call, sb } = build([row(1, { visibility: 'guild' })]);
    const r = await call('POST', `/api/agent/gallery/${uuid(1)}/versions`, { spec: withMeta({ title: 'Raid Wizard v2', classes: ['Cleric'], author: 'Brackwyn' }) });
    expect(r.status).toBe(200);
    expect(sb.db.gallery_masterpieces[0]).toMatchObject({ title: 'Raid Wizard v2', classes: ['Cleric'], byline: 'Brackwyn', latest_version: 2 });
    expect(sb.db.gallery_versions.find(v => v.version === 2).spec.meta.title).toBe('Raid Wizard v2');
  });

  it('the public adopt and report routes fail closed (503) with no GALLERY_SALT, and write nothing', async () => {
    const keep = process.env.GALLERY_SALT;
    delete process.env.GALLERY_SALT;
    try {
      const sb = fakeSupabase([row(1)]);
      const g = createGallery({ supabase: sb, requireAuth: async () => ({ discord_id: OTHER, is_officer: false }), now: () => clock });
      const hit = async (method, url, body) => { const res = mkRes(); await g.handle(mkReq(method, url, body), res); return res.out; };
      expect((await hit('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: 'a'.repeat(32) })).status).toBe(503);
      expect((await hit('POST', `/api/public/gallery/${uuid(1)}/report`, { reason: 'spam' })).status).toBe(503);
      expect(sb.db.gallery_adoptions.length + sb.db.gallery_reports.length).toBe(0);
      // a signed-in member keys on a Discord id, so needs no salt
      expect((await hit('POST', `/api/agent/gallery/${uuid(1)}/adopt`, {})).status).toBe(200);
      // the env var is read when the code does not pass one
      process.env.GALLERY_SALT = 'from-env';
      expect((await hit('POST', `/api/public/gallery/${uuid(1)}/adopt`, { install_id: 'a'.repeat(32) })).status).toBe(200);
    } finally {
      if (keep === undefined) delete process.env.GALLERY_SALT; else process.env.GALLERY_SALT = keep;
    }
  });

  it('a new version bumps the number; only the author may add one, change visibility, unpublish or delete', async () => {
    const { call, sb, ctx } = build([row(1, { visibility: 'guild' })]);
    const v2 = await call('POST', `/api/agent/gallery/${uuid(1)}/versions`, { spec: SPEC });
    expect(v2.json.version).toBe(2);
    expect(sb.db.gallery_masterpieces[0].latest_version).toBe(2);
    ctx.identity = { discord_id: OTHER, is_officer: false };
    for (const [m, p, b] of [
      ['POST', 'versions', { spec: SPEC }], ['POST', 'visibility', { visibility: 'public' }],
      ['POST', 'status', { status: 'draft' }], ['DELETE', '', undefined],
    ]) {
      const r = await call(m, `/api/agent/gallery/${uuid(1)}${p ? '/' + p : ''}`, b);
      expect(r.status, `${m} ${p}`).toBe(403);
    }
    ctx.identity = { discord_id: AUTHOR, is_officer: false };
    expect((await call('POST', `/api/agent/gallery/${uuid(1)}/status`, { status: 'draft' })).status).toBe(200);
    expect(sb.db.gallery_masterpieces[0].status).toBe('draft');
    expect((await call('DELETE', `/api/agent/gallery/${uuid(1)}`)).status).toBe(200);
    expect(sb.db.gallery_masterpieces.length).toBe(0);
  });

  it('an author cannot republish a layout an officer hid', async () => {
    const { call } = build([row(1, { status: 'hidden' })]);
    const r = await call('POST', `/api/agent/gallery/${uuid(1)}/status`, { status: 'published' });
    expect(r.status).toBe(409);
  });

  it('another member sees a published guild layout but not a draft', async () => {
    const { call } = build([row(1, { visibility: 'guild' }), row(2, { status: 'draft' })], { identity: { discord_id: OTHER, is_officer: false } });
    expect((await call('GET', '/api/agent/gallery')).json.items.map(i => i.id)).toEqual([uuid(1)]);
    expect((await call('GET', `/api/agent/gallery/${uuid(2)}`)).status).toBe(404);
  });

  it('does nothing and reports handled when sign-in refuses', async () => {
    const { call, ctx, sb } = build([row(1)]);
    ctx.identity = null;
    const r = await call('POST', '/api/agent/gallery', { title: 'x', spec: SPEC });
    expect(r.handled).toBe(true);
    expect(sb.db.gallery_masterpieces.length).toBe(1);
  });

  it('leaves non-gallery paths alone', async () => {
    const { call } = build([]);
    expect((await call('GET', '/api/agent/galleryx')).handled).toBe(false);
    expect((await call('GET', '/api/public/catalog/spell-catalog')).handled).toBe(false);
  });
});

describe('officer routes', () => {
  it('feature and hide are officers only', async () => {
    const { call, sb } = build([row(1)], { identity: { discord_id: OTHER, is_officer: false } });
    expect((await call('POST', `/api/agent/gallery/${uuid(1)}/feature`, { featured: true })).status).toBe(403);
    expect((await call('POST', `/api/agent/gallery/${uuid(1)}/hide`, { hidden: true })).status).toBe(403);
    expect((await call('GET', '/api/agent/gallery/review')).status).toBe(403);
    expect(sb.db.gallery_masterpieces[0].featured).toBe(false);
  });

  it('an officer features a layout into the Hall, which then leads the public list; unfeature reverses it', async () => {
    const { call, ctx } = build([row(1, { adoptions_count: 3 }), row(2, { adoptions_count: 99 })]);
    ctx.identity = { discord_id: OFFICER, is_officer: true };
    expect((await call('GET', '/api/public/gallery')).json.items[0].id).toBe(uuid(2));
    expect((await call('POST', `/api/agent/gallery/${uuid(1)}/feature`, { featured: true })).status).toBe(200);
    expect((await call('GET', '/api/public/gallery')).json.items[0].id).toBe(uuid(1));
    await call('POST', `/api/agent/gallery/${uuid(1)}/feature`, { featured: false });
    expect((await call('GET', '/api/public/gallery')).json.items[0].id).toBe(uuid(2));
  });

  it('hide removes it from the public list and drops it from the Hall; unhide restores it', async () => {
    const { call, ctx, sb } = build([row(1, { featured: true })]);
    ctx.identity = { discord_id: OFFICER, is_officer: true };
    expect((await call('POST', `/api/agent/gallery/${uuid(1)}/hide`, { hidden: true })).status).toBe(200);
    expect(sb.db.gallery_masterpieces[0].featured).toBe(false);
    expect((await call('GET', '/api/public/gallery')).json.items).toEqual([]);
    const review = await call('GET', '/api/agent/gallery/review');
    expect(review.json.items.map(i => i.id)).toEqual([uuid(1)]);
    expect(review.raw).not.toContain(AUTHOR);
    await call('POST', `/api/agent/gallery/${uuid(1)}/hide`, { hidden: false });
    expect((await call('GET', '/api/public/gallery')).json.items.map(i => i.id)).toEqual([uuid(1)]);
  });
});

describe('spec validation', () => {
  const manyPieces = (n) => ({ ...SPEC, groups: [{ anchor: 'tl', ox: 0, oy: 0, panels: Array.from({ length: n }, () => ({ ...PIECE })) }] });

  it('accepts a real portable layout and stores the document Mimic\'s validator rebuilt', () => {
    const r = gs.validateSpec(SPEC);
    expect(r.ok).toBe(true);
    expect(r.spec.format).toBe('mimic-layout');
    expect(r.listing).toMatchObject({ title: SPEC.meta.title, byline: SPEC.meta.author, modes: SPEC.meta.modes });
    expect(r.needs).toEqual(SPEC.needs);
  });

  it('never copies a key the format does not know, and never trusts the file\'s own needs', () => {
    const r = gs.validateSpec({ ...SPEC, script: 'x', needs: { parts: ['evil.thing'], overlays: [], sections: [] },
      groups: SPEC.groups.map(g => ({ ...g, onclick: 'x', panels: g.panels.map(p => ({ ...p, onclick: 'x' })) })) });
    expect(r.ok).toBe(true);
    const text = JSON.stringify(r.spec);
    expect(text).not.toContain('onclick');
    expect(text).not.toContain('"script"');
    expect(text).not.toContain('evil.thing');
    expect(r.needs).toEqual(SPEC.needs);
  });

  it('refuses what Mimic\'s validator refuses: wrong format, bad numbers, bad anchors, ids that are not ids', () => {
    expect(gs.validateSpec({ ...SPEC, format: 'other' }).ok).toBe(false);
    expect(gs.validateSpec({ ...SPEC, version: 2 }).ok).toBe(false);
    expect(gs.validateSpec({ ...SPEC, groups: [{ ...SPEC.groups[0], anchor: 'top' }] }).ok).toBe(false);
    expect(gs.validateSpec({ ...SPEC, groups: [{ ...SPEC.groups[0], ox: '3' }] }).ok).toBe(false);          // a string is not a number
    expect(gs.validateSpec({ ...SPEC, groups: [{ ...SPEC.groups[0], panels: [{ ...PIECE, part: 'a<b>.c' }] }] }).ok).toBe(false);
    expect(gs.validateSpec({ ...SPEC, groups: [{ ...SPEC.groups[0], panels: [{ ...PIECE, w: 99 }] }] }).ok).toBe(false);
  });

  it('rejects an oversize document (64 KB, stricter than the format\'s 256 KB)', () => {
    // Mimic's validator ignores unknown keys, so a numeric pad passes everything except the size check.
    const big = { ...SPEC, pad: Array(20000).fill(123456) };
    expect(Buffer.byteLength(JSON.stringify(big))).toBeGreaterThan(gs.MAX_SPEC_BYTES);
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThan(256 * 1024);
    const r = gs.validateSpec(big);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/KB/);
  });

  it('caps pieces at 60 (stricter than the format\'s 150)', () => {
    expect(gs.validateSpec(manyPieces(gs.MAX_PIECES)).ok).toBe(true);
    const r = gs.validateSpec(manyPieces(gs.MAX_PIECES + 1));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/pieces/);
    expect(require('../utils/portableLayout.js').validate(manyPieces(gs.MAX_PIECES + 1)).ok).toBe(true);   // the format alone allows it
  });

  it('rejects markup, entities and links in the free-text fields', () => {
    for (const s of ['<img src=x>', 'a &lt;b&gt;', 'http://evil.example/x', 'javascript:alert(1)', 'see www.evil.com', 'go to evil.com', '＜b＞']) {
      for (const field of ['title', 'description']) {
        expect(gs.validateSpec(withMeta({ [field]: s })), `${field}: ${s}`).toMatchObject({ ok: false });
      }
      // A byline is cleaned rather than refused: a link is refused, markup characters are stripped out.
      const by = gs.validateSpec(withMeta({ author: s }));
      if (by.ok) expect(by.listing.byline || '', `author: ${s}`).not.toMatch(/[<>&;:\/]/);
      else expect(by.error).toMatch(/link/);
    }
    for (const s of ['http://evil.example/x', 'see www.evil.com', 'go to evil.com']) {
      expect(gs.validateSpec(withMeta({ author: s })), s).toMatchObject({ ok: false });
    }
  });

  it('needs a title the author typed (the format fills a blank one in)', () => {
    expect(gs.validateSpec(withMeta({ title: '' })).error).toMatch(/title/);
    expect(gs.validateSpec({ ...SPEC, meta: { ...SPEC.meta, title: undefined } }).error).toMatch(/title/);
  });

  it('writes the cleaned byline back into the stored document, and never invents one', () => {
    const r = gs.validateSpec(withMeta({ author: '  Aldenmar   the   Bold!!  ' }));
    expect(r.spec.meta.author).toBe('Aldenmar the Bold');
    expect(r.listing.byline).toBe('Aldenmar the Bold');
    expect(gs.validateSpec(withMeta({ author: '' })).listing.byline).toBe(null);
    expect(gs.validateSpec(withMeta({ author: 'x'.repeat(25) })).ok).toBe(false);   // 24, stricter than the format's 32
  });

  it('a thumbnail is numbers and enum tokens only, one entry per group', () => {
    const { thumb } = gs.validateSpec(SPEC);
    expect(thumb.g.length).toBe(SPEC.groups.length);
    expect(JSON.stringify(thumb)).not.toMatch(/[A-Za-z]{9,}/);
  });

  it('cleans bylines: 24 characters, no link, no badge impersonation, never invented', () => {
    expect(gs.cleanByline('  Aldenmar   the   Bold ')).toEqual({ ok: true, text: 'Aldenmar the Bold' });
    expect(gs.cleanByline('Brackwyn<script>')).toEqual({ ok: true, text: 'Brackwynscript' });
    expect(gs.cleanByline('x'.repeat(25))).toMatchObject({ ok: false });
    expect(gs.cleanByline('see evil.com')).toMatchObject({ ok: false });
    expect(gs.cleanByline('')).toEqual({ ok: true, text: null });
    expect(gs.cleanByline(undefined)).toEqual({ ok: true, text: null });
    expect(gs.cleanByline('Wolf Pack Officer', { kind: 'anon' })).toMatchObject({ ok: false });
  });
});

describe('wiring', () => {
  const code = stripJs(readSource(BOT_INDEX));

  it('index.js routes both gallery prefixes to the gallery and signs member routes with the Mimic session check', () => {
    const at = code.indexOf('_galleryRoutes().handle(req, res)');
    expect(at).toBeGreaterThan(0);
    expect(code.slice(at - 200, at)).toMatch(/\/\^\\\/api\\\/\(\?:public\|agent\)\\\/gallery/);
    expect(code).toMatch(/requireAuth: \(rq, rs\) => mimicLink\.requireAgentAuth\(rq, rs\)/);
  });

  it('the migration is service-role only: RLS on, no policies, grants revoked, size check, adoption primary key', () => {
    const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261019120000_gallery_masterpieces.sql'), 'utf8'));
    for (const t of ['gallery_masterpieces', 'gallery_versions', 'gallery_adoptions', 'gallery_reports']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated`));
    }
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/octet_length\(spec::text\) <= 65536/);
    expect(sql).toMatch(/primary key \(masterpiece_id, adopter_key\)/);
    expect(sql).toMatch(/after insert on public\.gallery_adoptions/);
    expect(sql).toMatch(/submitter_kind in \('member', 'anon'\)/);
    expect(sql).toMatch(/'pending'/);
    expect(sql).toMatch(/where status = 'published' and visibility = 'public'/);
    expect(sql).not.toMatch(/\bdrop table\b/i);
  });
});
