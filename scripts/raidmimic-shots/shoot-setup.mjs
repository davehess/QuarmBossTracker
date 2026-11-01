// Renders the "setting up Raid Mimic" captures: the REAL apps/mimic/welcome.html and settings.html in Chromium with a
// stand-in `window.mimic` bridge (invented names only), plus the agent dashboard (packages/wolfpack-logsync) served from
// its generated WEB_HTML with a stand-in /api/state.
//
//   node scripts/raidmimic-shots/shoot-setup.mjs <out-dir> [welcome|link|zeal|dash ...]
//
// Writes setup-*.png at 2x. Needs Playwright (PLAYWRIGHT_MODULE_DIR) and Chromium (CHROMIUM), like shoot.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import * as F from './fixtures.mjs';

const require = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node-tools/node_modules') + '/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIMIC = path.resolve(HERE, '../../apps/mimic');
const OUT = process.argv[2] || path.join(HERE, 'out');
const ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });
const want = (n) => !ONLY.length || ONLY.includes(n);

const WOLF = { slug: 'wolfpack', display_name: 'Wolf Pack', url: 'https://bot.example', site: 'https://wolfpack.quest' };
const HUBS = { hubs: [WOLF, { slug: 'ember', display_name: 'Ember Covenant', url: 'https://ember.example', site: '' }], current: WOLF };

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const f = path.join(MIMIC, u.pathname.replace(/^\/+/, ''));
  if (f.startsWith(MIMIC) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });

async function open(file, { w, h, impl, hash = '' }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  page.on('pageerror', (e) => console.log('PAGEERROR', file, e.message));
  await page.addInitScript(({ impl, T }) => {
    const real = Date.now(); Date.now = () => T + (performance.timeOrigin + performance.now() - real);
    const val = {};
    for (const k in impl) val[k] = impl[k];
    window.mimic = new Proxy({}, { get: (t, k) => (k in val ? () => Promise.resolve(val[k]) : k === 'onStatus' ? () => {} : () => Promise.resolve(null)) });
  }, { impl, T: F.T });
  await page.goto(`http://127.0.0.1:${PORT}/${file}${hash}`);
  await page.waitForTimeout(1500);
  return page;
}

const WELCOME_BASE = {
  getConfig: { eqPaths: ['C:\\EverQuest'], onboarded: false },
  findEqInstalls: { found: [{ path: 'C:\\EverQuest', hasEqgame: true, hasLogs: true, logCount: 4 }] },
  listEqCharacters: [{ character: 'Odelle', log_size: 48e6, ago_days: 0 }, { character: 'Aldenmar', log_size: 9e6, ago_days: 3 }, { character: 'Brackwyn', log_size: 2e5, ago_days: 41 }],
  zealStatus: { eqDir: 'C:\\EverQuest', hasZealAsi: true, installedTag: 'v1.4.6' },
  defenderStatus: { ok: true, paths: [] }, clockStatus: { ok: true, running: true, automatic: true },
  getAgentPort: 7779, hubList: HUBS,
};
const go = async (page, id) => { await page.click(`[data-go="${id}"]`); await page.waitForTimeout(500); };

if (want('welcome')) {
  // Account step, signed out: the guild list and the sign-in buttons.
  const page = await open('welcome.html', { w: 1100, h: 640, impl: { ...WELCOME_BASE, getStatus: { localOnly: true, mimicSession: null } } });
  await go(page, 'account');
  await page.screenshot({ path: path.join(OUT, 'setup-1-welcome.png') });
  // The EverQuest folder step: the install it found, with its logs.
  await go(page, 'folder');
  await page.screenshot({ path: path.join(OUT, 'setup-1b-folder.png') });
  await page.close();
  console.log('welcome ok');
}
if (want('link')) {
  const page = await open('welcome.html', { w: 1100, h: 640, impl: { ...WELCOME_BASE, getStatus: { localOnly: false, mimicLinking: { user_code: 'KQ7M-4TXD', verification_url: 'https://wolfpack.quest/auth/mimic-link', expires_at: F.T + 14 * 60000 } } } });
  await go(page, 'account');
  await page.screenshot({ path: path.join(OUT, 'setup-2-link.png') });
  await page.close();
  const p2 = await open('welcome.html', { w: 1100, h: 640, impl: { ...WELCOME_BASE, getConfig: { ...WELCOME_BASE.getConfig, connected: true }, getStatus: { localOnly: false, mimicSession: { display_name: 'Odelle', guild: { display_name: 'Wolf Pack', role: 'member' } } } } });
  await go(p2, 'account');
  await p2.screenshot({ path: path.join(OUT, 'setup-2-linked.png') });
  await p2.close();
  console.log('link ok');
}
if (want('zeal')) {
  const packs = { eqDir: 'C:\\EverQuest', packs: [{ id: 'nillipuss1440', name: 'Nillipuss UI — 1440p', installed: true, installedTag: 'v2.3', loadCmd: '/load nillipussui_1440p 1', notes: 'The 1440p (2560×1440) large-UI variant. Requires Zeal.', options: { ready: true, choices: [] } }, { id: 'nillipuss1080', name: 'Nillipuss UI — 1080p', installed: false, loadCmd: '/load nillipussui_1080p 1', notes: 'Large, Zeal-aware UI tuned for 1080p. Requires Zeal.' }] };
  const page = await open('settings.html', {
    w: 900, h: 900, hash: '#zeal',
    impl: { findEqInstalls: { found: [{ path: 'C:\\EverQuest', hasEqgame: true, hasLogs: true, logCount: 4 }], scanned: ['C:\\EverQuest'] }, getConfig: { eqPaths: ['C:\\EverQuest'], zealAutoCheck: true }, zealStatus: { eqDir: 'C:\\EverQuest', hasZealAsi: true, installedTag: 'v1.4.6', source: 'official' }, uiPacksList: packs, hubList: HUBS, getStatus: { mimicSession: null }, getAgentPort: 7779 },
  });
  const top = await page.evaluate(() => document.getElementById('zeal').getBoundingClientRect().top + window.scrollY);
  const bottom = await page.evaluate(() => { const h = [...document.querySelectorAll('h2')].find((e) => /Overlay sets/.test(e.textContent)); return h.getBoundingClientRect().top + window.scrollY; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'setup-4-zeal.png'), fullPage: true, clip: { x: 0, y: top - 28, width: 900, height: bottom - top + 16 } });
  await page.close();
  console.log('zeal ok');
}

if (want('dash')) {
  // The agent dashboard, served from its authored source (dashboard.html) with the agent's {{WP:..}} holes filled in and a
  // stand-in /api/state for a healthy install. Every other /api route answers an empty object.
  const DASH = fs.readFileSync(path.resolve(HERE, '../../packages/wolfpack-logsync/dashboard.html'), 'utf8')
    .replace(/\{\{WP:AGENT_VERSION\}\}/g, '3.9.0').replace(/\{\{WP:BACKUP_KEEP\}\}/g, '10')
    .replace(/\{\{WP:[^}]*\}\}/g, (m) => (/WOLFPACK_CLIENT/.test(m) ? 'Raid Mimic' : /EQ_DIR/.test(m) ? 'true' : /POLL_MS/.test(m) ? '7000' : ''));
  const now = Date.now();
  const state = () => ({
    version: '3.9.0', mimicSignedIn: true, mimicHasToken: true, localOnly: false,
    mimicIdentity: { display_name: 'Odelle', discord_id: '0', is_officer: false },
    uploadCount: 14, sessionEvents: 3120, startedAt: now - 42 * 60000,
    watchedLogs: [{ name: 'eqlog_Odelle_pq.proj.txt', character: 'Odelle', lastSeen: now - 4000, size: 48e6 }, { name: 'eqlog_Aldenmar_pq.proj.txt', character: 'Aldenmar', lastSeen: now - 3600000, size: 9e6 }],
    zealClients: [{ pid: 4242, character: 'Odelle', live: true, lastSeen: now - 1000 }],
    zealExportOnCamp: true, eqFolder: { path: 'C:\\EverQuest', writable: true, zealInstalled: true },
    queue: { pending: 0 }, targets: [], threat: {},
  });
  const dsrv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(DASH); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(u.pathname === '/api/state' ? state() : {}));
  });
  await new Promise((r) => dsrv.listen(0, '127.0.0.1', r));
  const dport = dsrv.address().port;
  async function dopen(tab) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
    page.on('pageerror', (e) => console.log('PAGEERROR dash', e.message));
    await page.addInitScript(() => {
      const ok = (v) => () => Promise.resolve(v);
      const impl = { openSettings: ok(true), getConfig: ok({ hideOverlays: false, quietMode: false, hideOverlaysWhenEqDown: true }), getStatus: ok({ runModeNow: 'overlays', showHud: true, enableTriggerTts: true, showMobInfo: true, showBuffQueue: true, showPets: true, showMe: true, showZeal: true }), getAgentPort: ok(7777) };
      window.mimic = new Proxy({}, { get: (t, k) => (k in impl ? impl[k] : k === 'onStatus' ? () => {} : () => Promise.resolve(null)) });
    });
    await page.goto(`http://127.0.0.1:${dport}/`);
    await page.waitForTimeout(2500);
    if (tab) { await page.click(`.nav button[data-tab="${tab}"]`); await page.waitForTimeout(1500); }
    return page;
  }
  const dropTour = (p) => p.evaluate(() => { const t = document.getElementById('wpTourOffer'); if (t) t.remove(); });
  const setupPanel = () => [...document.querySelectorAll('details')].find((x) => /Setup/.test((x.querySelector('summary') || {}).textContent || ''));
  {
    // Setup checklist: open the Setup panel (a <details>) and shoot from the top of the page down to its bottom edge.
    const page = await dopen(null);
    await dropTour(page);
    await page.evaluate((fn) => { eval('(' + fn + ')')().open = true; }, setupPanel.toString());
    await page.waitForTimeout(2600);
    const bottom = await page.evaluate((fn) => { const r = eval('(' + fn + ')')().getBoundingClientRect(); return r.top + scrollY + r.height; }, setupPanel.toString());
    await page.setViewportSize({ width: 1280, height: Math.ceil(bottom + 40) });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'setup-3-checklist.png'), clip: { x: 0, y: 0, width: 1280, height: Math.ceil(bottom + 16) } });
    await page.close();
    // Overlays tab.
    const p2 = await dopen('overlays');
    await dropTour(p2);
    // Shoot the Overlays card: from the page top down past the Look / Guild palette strips.
    const bottom2 = await p2.evaluate(() => {
      const el = [...document.querySelectorAll('div')].filter((d) => /^GUILD PALETTE/i.test((d.firstElementChild || {}).textContent || d.textContent.trim())).pop();
      const r = el.getBoundingClientRect(); return r.top + scrollY + r.height;
    });
    await p2.setViewportSize({ width: 1280, height: Math.ceil(bottom2 + 60) });
    await p2.waitForTimeout(500);
    await p2.screenshot({ path: path.join(OUT, 'setup-5-overlays.png'), clip: { x: 0, y: 0, width: 1280, height: Math.ceil(bottom2 + 24) } });
    await p2.close();
  }
  dsrv.close();
  console.log('dash ok');
}

await browser.close();
srv.close();
