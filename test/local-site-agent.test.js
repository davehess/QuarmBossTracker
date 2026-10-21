// test/local-site-agent.test.js — the agent half of the local site (web/local, bundled into Mimic).
//
// The guild lead, 2026-10-21 (option B): the website's own pages, exported static and shipped inside Mimic,
// served by the agent under /local/ on the dashboard port, with /api/local/inventory answering from the
// <Char>-Inventory.txt files on this PC. SOURCE-SLICE tier: the real functions are cut out of the shipped
// agent and run — the static route against a real http server and a temp folder, the inventory snapshot
// against temp inventory files.
//
// What is pinned: a path that climbs out of the bundle is refused (every spelling of it); MIME types; the
// extension-less route form Next exports; a clear 404 with no bundle; GET/HEAD only; the inventory rows
// carry the shape web/lib/inventoryAggregate.ts reads and nothing coin-like; the wiring sits behind the
// local-request guard; and NOTHING in the new block uploads. The packaging facts (Mimic env + extraResources,
// the release step, the Vercel/tsconfig exclusions) are asserted on comment-stripped text.
//
// Run: npx vitest run test/local-site-agent.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';
import { aggregateInventory } from '../web/lib/inventoryAggregate.ts';

const src = readSource(AGENT_INDEX);
const siteBlock = sliceBlock(src, 'const _LOCAL_SITE_MIME = {', '  stream.pipe(res);\n}');
const invBlock = sliceBlock(src, 'function _localInventorySnapshot(', '    rows, meta: [], meta_available: false,\n  };\n}');
const parseBlock = sliceBlock(
  src,
  'function parseInventoryFileForUpload(',
  'return rows;\n}',
);
const rxLine = sliceBlock(src, 'const INVENTORY_FILENAME_RX =', '/i;');

// eslint-disable-next-line no-new-func
const site = new Function('fs', 'path', '__dirname', siteBlock + '\nreturn { _localSiteResolve, _serveLocalSite, _localSiteDir };')(fs, path, path.dirname(AGENT_INDEX));
// eslint-disable-next-line no-new-func
const inv = new Function('fs', 'path', rxLine + '\n' + parseBlock + '\n' + invBlock + '\nreturn { _localInventorySnapshot };')(fs, path);

let tmp, bundle, secretPath;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-localsite-'));
  bundle = path.join(tmp, 'out');
  fs.mkdirSync(path.join(bundle, 'inventory'), { recursive: true });
  fs.mkdirSync(path.join(bundle, '_next', 'static', 'chunks'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'index.html'), '<html>home</html>');
  fs.writeFileSync(path.join(bundle, 'inventory', 'index.html'), '<html>inventory</html>');
  fs.writeFileSync(path.join(bundle, '404.html'), '<html>nope</html>');
  fs.writeFileSync(path.join(bundle, '_next', 'static', 'chunks', 'app-1a2b.js'), 'console.log(1)');
  fs.writeFileSync(path.join(bundle, '_next', 'static', 'chunks', 'app.css'), 'a{color:red}');
  secretPath = path.join(tmp, 'secret.txt');                       // a sibling of the bundle, NOT inside it
  fs.writeFileSync(secretPath, 'do not serve');
});
afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ } });

describe('_localSiteResolve — which file a /local/ path maps to', () => {
  const r = (rel) => site._localSiteResolve(bundle, rel);
  it('the bundle root and a route directory serve their index.html', () => {
    expect(r('')).toBe(path.join(bundle, 'index.html'));
    expect(r('inventory/')).toBe(path.join(bundle, 'inventory', 'index.html'));
  });
  it('an extension-less route (Next exports /inventory/ as inventory/index.html) works without the slash', () => {
    expect(r('inventory')).toBe(path.join(bundle, 'inventory', 'index.html'));
  });
  it('a real file resolves to itself', () => {
    expect(r('_next/static/chunks/app-1a2b.js')).toBe(path.join(bundle, '_next', 'static', 'chunks', 'app-1a2b.js'));
  });
  it('a missing file, and a missing route, are null', () => {
    expect(r('_next/static/chunks/nope.js')).toBeNull();
    expect(r('parses')).toBeNull();
  });
  it('THE GUARD: every spelling of "climb out of the bundle" is refused', () => {
    expect(fs.existsSync(secretPath)).toBe(true);                  // so a null below is the guard, not a bad path
    for (const bad of [
      '../secret.txt', '..%2fsecret.txt', '%2e%2e/secret.txt', '%2E%2E%2Fsecret.txt', 'inventory/../../secret.txt',
      '..\\secret.txt', '%5c..%5csecret.txt', 'inventory\\..\\..\\secret.txt', '/../secret.txt', 'a/%2e%2e/%2e%2e/secret.txt',
      '%00', 'index.html%00.png', '%zz', '%e0%a4%a',
    ]) {
      expect(r(bad), bad).toBeNull();
    }
  });
  it('an absolute-looking path stays inside the bundle', () => {
    expect(r('/etc/passwd')).toBeNull();
    expect(r('//' + secretPath)).toBeNull();
  });
});

describe('_serveLocalSite — over a real http server', () => {
  let server, port;
  const prev = process.env.WOLFPACK_LOCAL_SITE_DIR;
  const get = (urlPath, method = 'GET') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
  beforeAll(async () => {
    process.env.WOLFPACK_LOCAL_SITE_DIR = bundle;
    server = http.createServer((req, res) => site._serveLocalSite(req, res));
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    port = server.address().port;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.WOLFPACK_LOCAL_SITE_DIR; else process.env.WOLFPACK_LOCAL_SITE_DIR = prev;
    await new Promise((ok) => server.close(ok));
  });

  it('serves the page with an HTML type and no cache, so a new bundle shows up at once', async () => {
    const res = await get('/local/inventory/');
    expect(res.status).toBe(200);
    expect(res.body).toBe('<html>inventory</html>');
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('serves hashed _next/static files with their MIME type and a long cache', async () => {
    const js = await get('/local/_next/static/chunks/app-1a2b.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toContain('immutable');
    const css = await get('/local/_next/static/chunks/app.css');
    expect(css.headers['content-type']).toBe('text/css; charset=utf-8');
  });
  it('/local/ is the home page; /local goes to /local/; a query string is ignored', async () => {
    expect((await get('/local/')).body).toBe('<html>home</html>');
    expect((await get('/local/?x=1')).body).toBe('<html>home</html>');
    const bare = await get('/local');
    expect(bare.status).toBe(302);
    expect(bare.headers.location).toBe('/local/');
  });
  it('refuses a traversal over the wire (the secret beside the bundle is never returned)', async () => {
    for (const p of ['/local/..%2fsecret.txt', '/local/%2e%2e/secret.txt', '/local/..%5csecret.txt', '/local/%2e%2e%2f%2e%2e%2fsecret.txt']) {
      const res = await get(p);
      expect(res.status, p).toBe(404);
      expect(res.body, p).not.toContain('do not serve');
    }
  });
  it('an unknown path is a plain 404; only GET and HEAD are answered', async () => {
    expect((await get('/local/parses/')).status).toBe(404);
    expect((await get('/local/inventory/', 'POST')).status).toBe(405);
    const head = await get('/local/inventory/', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });
  it('with NO bundle it answers 404 and says why', async () => {
    process.env.WOLFPACK_LOCAL_SITE_DIR = path.join(tmp, 'does-not-exist');
    try {
      const res = await get('/local/inventory/');
      expect(res.status).toBe(404);
      expect(res.body).toMatch(/not installed in this build/);
      expect(res.body).toMatch(/next build/);
    } finally { process.env.WOLFPACK_LOCAL_SITE_DIR = bundle; }
  });
  it('the bundle folder comes from WOLFPACK_LOCAL_SITE_DIR, else the repo-relative web/local/out', () => {
    expect(site._localSiteDir()).toBe(bundle);
    delete process.env.WOLFPACK_LOCAL_SITE_DIR;
    try {
      expect(site._localSiteDir()).toBe(path.join(path.dirname(AGENT_INDEX), '..', '..', 'web', 'local', 'out'));
    } finally { process.env.WOLFPACK_LOCAL_SITE_DIR = bundle; }
  });
});

describe('_localInventorySnapshot — the rows /api/local/inventory returns', () => {
  const HEAD = 'Location\tName\tID\tCount\tSlots';
  const file = (...lines) => [HEAD, ...lines].join('\r\n');
  let eqDir, logsDir;
  beforeAll(() => {
    eqDir = path.join(tmp, 'EQ');
    logsDir = path.join(eqDir, 'Logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(path.join(eqDir, 'Aldenmar-Inventory.txt'), file(
      'Primary\tRustfang Cleaver\t51001\t1\t0',
      'General1-Slot1\tSunwoven Bracer\t51003\t2\t0',
      'Bank1\tAshen Mirror Charm\t51004\t1\t0',
      'SharedBank1-Slot1\tPristine Wolfhide\t41002\t12\t0',
      'Charm\tEmpty\t0\t0\t0',
      'Bank-Coin\tPlatinum\t0\t9999\t0',
      'Currency\tPlatinum\t0\t123\t0',
      'Held\tSome Cursor Item\t1234\t1\t0',
    ));
    fs.writeFileSync(path.join(eqDir, 'BRACKWYN-Inventory.txt'), file('Head\tDented Oathbreaker Helm\t51002\t1\t0'));
    // An older copy of Aldenmar's file in the log folder: the NEWER file must win, not the first one found.
    fs.writeFileSync(path.join(logsDir, 'Aldenmar-Inventory.txt'), file('Primary\tOld Stick\t1\t1\t0'));
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(path.join(logsDir, 'Aldenmar-Inventory.txt'), old, old);
    fs.writeFileSync(path.join(eqDir, 'notes.txt'), 'not an inventory file');
  });

  const snap = () => inv._localInventorySnapshot([logsDir, eqDir, path.join(tmp, 'no-such-dir')]);

  it('one set of rows per character, names capitalised, the newest file winning', () => {
    const s = snap();
    expect(s.ok).toBe(true);
    expect(s.characters.map(c => c.name)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(s.characters.find(c => c.name === 'Aldenmar').rows).toBe(4);
    expect(s.rows.some(r => r.item_name === 'Old Stick')).toBe(false);
  });
  it('rows have the website\'s own shape (what web/lib/inventoryAggregate.ts reads)', () => {
    const s = snap();
    const bracer = s.rows.find(r => r.item_name === 'Sunwoven Bracer');
    expect(Object.keys(bracer).sort()).toEqual(['character_name', 'item_id', 'item_name', 'observed_at', 'quantity', 'slot_label']);
    expect(bracer).toMatchObject({ character_name: 'Aldenmar', slot_label: 'General1-Slot1', item_id: 51003, quantity: 2 });
    expect(Number.isNaN(Date.parse(bracer.observed_at))).toBe(false);
  });
  it('coin, Currency, the Held cursor and Empty slots are not rows', () => {
    const names = snap().rows.map(r => r.item_name);
    for (const gone of ['Platinum', 'Some Cursor Item', 'Empty']) expect(names).not.toContain(gone);
  });
  it('bank and shared-bank item rows ARE rows (the page groups them)', () => {
    const slots = snap().rows.filter(r => r.character_name === 'Aldenmar').map(r => r.slot_label).sort();
    expect(slots).toEqual(['Bank1', 'General1-Slot1', 'Primary', 'SharedBank1-Slot1']);
  });
  it('meta is empty and says so: the agent\'s catalog has no damage/ac/nodrop to offer', () => {
    const s = snap();
    expect(s.meta).toEqual([]);
    expect(s.meta_available).toBe(false);
  });
  it('the response feeds the shared aggregation as-is', () => {
    const s = snap();
    const agg = aggregateInventory(s.rows, [], new Map(s.meta.map(m => [m.id, m])));
    expect(agg.items.find(i => i.name === 'Sunwoven Bracer').total).toBe(2);
    expect(agg.items.find(i => i.name === 'Pristine Wolfhide').holdings[0].location).toBe('shared');
  });
  it('no inventory files at all is an empty, valid answer', () => {
    const s = inv._localInventorySnapshot([path.join(tmp, 'nothing-here')]);
    expect(s).toMatchObject({ ok: true, characters: [], rows: [], meta: [] });
  });
});

describe('wiring and packaging', () => {
  const code = stripJs(src);
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

  it('both routes sit BEHIND the one local-request guard', () => {
    const guard = code.indexOf('if (_localGuardBlock(req, res)) return;');
    const siteAt = code.indexOf('return _serveLocalSite(req, res);');
    const apiAt = code.indexOf('return _handleLocalInventory(req, res);');
    expect(guard).toBeGreaterThan(0);
    expect(siteAt).toBeGreaterThan(guard);
    expect(apiAt).toBeGreaterThan(guard);
  });
  it('NOTHING the local site adds can upload: no queue, no request, no token', () => {
    const region = sliceBlock(src, 'const _LOCAL_SITE_MIME = {', '\nfunction _scanOptInFiles() {');
    expect(region).toContain('function _handleLocalInventory(');   // the slice really spans the whole new block
    const added = stripJs(region);
    expect(added).not.toMatch(/enqueueUpload|https?\.request|\.request\(|fetch\(|botUrl|_uploadOpts|WOLFPACK_TOKEN|token/i);
  });
  it('Mimic hands the agent the bundle folder, ships it, and opens it from the dashboard rail and the tray', () => {
    const main = stripJs(read('apps/mimic/main.js'));
    expect(main).toMatch(/env\.WOLFPACK_LOCAL_SITE_DIR = LOCAL_SITE_DIR\(\)/);
    expect(main).toMatch(/path\.join\(process\.resourcesPath, 'local-site'\)/);
    expect(main).toMatch(/ipcMain\.handle\('open-local-site'/);
    expect(main).toMatch(/openLocalSite\('inventory'\)/);                 // the tray item
    expect(stripJs(read('apps/mimic/preload.js'))).toMatch(/openLocalSite:\s+\(page\)\s+=> ipcRenderer\.invoke\('open-local-site', page\)/);
    const pkg = JSON.parse(read('apps/mimic/package.json'));
    expect(pkg.build.extraResources).toContainEqual({ from: '../../web/local/out', to: 'local-site' });
    const dash = read('packages/wolfpack-logsync/dashboard.html');
    expect(dash).toMatch(/onclick="wpOpenLocalSite\('inventory'\)"/);
    expect(dash).toMatch(/On this PC/);
  });
  it('the release builds the local site before electron-builder and fails when the export is missing', () => {
    for (const wf of ['.github/workflows/release-mimic.yml', '.github/workflows/build-mimic-linux.yml']) {
      const y = read(wf);
      const step = y.indexOf('Build the local site (web/local)');
      expect(step, wf).toBeGreaterThan(0);
      expect(y.indexOf('npx next build', step), wf).toBeGreaterThan(step);
      expect(y, wf).toMatch(/test -f out\/inventory\/index\.html/);
    }
    const rel = read('.github/workflows/release-mimic.yml');
    expect(rel.indexOf('Build the local site (web/local)')).toBeLessThan(rel.indexOf('name: Build Windows installer'));
  });
  it('the website\'s own build never compiles web/local, and a web/local-only push spends no deployment', () => {
    expect(JSON.parse(read('web/tsconfig.json')).exclude).toContain('local');
    expect(JSON.parse(read('web/vercel.json')).ignoreCommand).toMatch(/:\(exclude\)local/);
  });
});
