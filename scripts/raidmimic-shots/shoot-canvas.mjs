// Renders the Timers CANVAS captures for the raidmimic landing: the REAL apps/mimic/canvas.html (a screen-sized,
// click-through overlay whose panels are the overlay pages themselves) in Chromium, fed by a stand-in agent and a
// stand-in `window.mimic` bridge that hands it a saved layout. Invented player names only (fixtures.mjs).
//
//   node scripts/raidmimic-shots/shoot-canvas.mjs <out-dir> [canvas-overlays|canvas-builder ...]
//
// Writes <name>.png at 2x (convert with `cwebp -q 78` or Playwright-free `convert`; see README in shoot.mjs).
// Needs Playwright (PLAYWRIGHT_MODULE_DIR) and Chromium (CHROMIUM), like shoot.mjs.
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

const SW = 1920, SH = 1080;

// ── stand-in agent: each overlay page gets its own fixture, chosen by the page that asked (the Referer) ──
const NOW = Date.now();
const timers = () => ({
  activeTimers: [
    { id: 't1', target: 'Bertoxxulous', effect: 'Slow', duration_sec: 90, remaining_ms: 61000, group: 'trigger' },
    { id: 't2', target: 'Bertoxxulous', effect: 'Malo', duration_sec: 120, remaining_ms: 96000, group: 'trigger' },
    { id: 't3', target: 'Bertoxxulous', effect: 'Next Rampage', duration_sec: 30, remaining_ms: 19000, group: 'trigger' },
    { id: 't4', target: 'a diseased bloodsucker', effect: 'Enthrall', duration_sec: 96, remaining_ms: 71000, group: 'mez' },
    { id: 't5', target: 'Snarlpaw', effect: 'Charm', duration_sec: 300, remaining_ms: 212000, group: 'charm' },
  ],
  recentTriggerFires: FIRES, blindEvents: [], recentDeaths: [], enableTriggerTts: true,
});
// Callouts only show a fire that arrives AFTER the panel's first look, so the script pushes these once the page is up.
const FIRES = [];
const stateFor = (ref) => {
  const f = path.basename(ref.split('?')[0]);
  if (f === 'overlay.html') return F.dpsRaid();
  if (f === 'threatmeter.html') return F.threatRaid();
  if (f === 'mobinfo.html') return F.targetDebuffs();
  if (f === 'chchain.html') return F.chChain();
  if (f === 'command.html') return F.commandCenter();
  if (f === 'triggers.html') {
    return timers();
  }
  return {};
};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const ref = String(req.headers.referer || '');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/timers') return json(timers());
  if (u.pathname === '/api/command-center') return json(F.commandCenter());
  if (u.pathname === '/api/state') return json(stateFor(ref));
  if (u.pathname === '/api/me') return json(F.me());
  if (u.pathname === '/api/timer-suggestions') return json({ gems: ['Complete Heal', 'Divine Light'], casts: [{ name: 'Slow', n: 41 }, { name: 'Malo', n: 33 }] });
  if (u.pathname.startsWith('/api/')) return json({});
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

// ── the saved layout the canvas is handed (positions are screen fractions; sizes are px) ──
const CATALOG = [
  ['hud', 'DPS/Tank Meter', 'overlay.html'], ['chchain', 'CH chain', 'chchain.html'], ['mobinfo', 'Mob Info', 'mobinfo.html'],
  ['threat', 'Threat', 'threatmeter.html'], ['command', 'Command Center', 'command.html'], ['me', 'HUD', 'me.html'],
];
const overlays = CATALOG.map(([key, label, src]) => ({ key, label, src, showing: false, docked: false, at: null, w: 320, h: 220, mini: null }));
const ov = (id, key, x, y, w, h, extra = {}) => ({ id, kind: 'overlay', key, style: key === 'me' ? 'a' : '', name: key, x, y, w, h, scale: 1, off: false, ...extra });
const tp = (id, kind, name, x, y, w, h, extra = {}) => ({ id, kind, name, all: false, groups: [], names: [], x, y, w, h, scale: 1, anchor: 'bottom', off: false, ...extra });
// Screen 1920x1080. Whole-screen shot: a raid-night spread of the real overlays plus the timers and callouts.
const LAYOUT = { panels: [
  ov('o-threat', 'threat', 0.016, 0.055, 330, 345),
  ov('o-mob', 'mobinfo', 0.208, 0.055, 604, 262),
  tp('callouts', 'callouts', 'Callouts', 0.208, 0.322, 600, 70),
  ov('o-cc', 'command', 0.541, 0.055, 480, 560),
  tp('timers', 'timers', 'Timers', 0.8125, 0.055, 340, 250, { all: true }),
  tp('charm', 'timers', 'Charm', 0.8125, 0.32, 340, 70, { groups: ['charm'] }),
  ov('o-hud', 'hud', 0.016, 0.47, 470, 285),
  ov('o-me', 'me', 0.281, 0.405, 330, 460),
  ov('o-ch', 'chchain', 0.469, 0.62, 340, 300),
] };
// The arrange shot: fewer panels, kept to the left and middle so the 🧩 Pieces chooser (fixed at the right) covers none of them.
const LAYOUT_EDIT = { panels: [
  tp('callouts', 'callouts', 'Callouts', 0.035, 0.20, 370, 90),
  ov('o-threat', 'threat', 0.035, 0.37, 330, 345),
  ov('o-ch', 'chchain', 0.23, 0.215, 340, 300),
  tp('timers', 'timers', 'Timers', 0.43, 0.215, 340, 230, { all: true }),
  tp('charm', 'timers', 'Charm', 0.43, 0.47, 340, 80, { groups: ['charm'] }),
  ov('o-mob', 'mobinfo', 0.23, 0.63, 604, 262),
] };

async function open({ edit, layout = LAYOUT }) {
  const page = await browser.newPage({ viewport: { width: SW, height: SH }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const state = { res: SW + 'x' + SH, layout, edit, displays: 1, splitFitOff: false, screens: null, span: false, spanWhy: '', rev: 1,
    backdrop: true, overlays, groupOps: [], groupKeys: {}, groupKeysBlocked: {} };
  await page.addInitScript(({ port, state, css, T }) => {
    // The fixtures are stamped at one raid-night instant (F.T); the page's clock starts there and keeps running.
    const real = Date.now(); Date.now = () => T + (performance.timeOrigin + performance.now() - real);
    const impl = {
      getAgentPort: () => Promise.resolve(port), canvasState: () => Promise.resolve(state), canvasGroups: () => Promise.resolve([]),
      canvasSave: () => Promise.resolve(true), canvasGroupsSave: () => Promise.resolve(true), canvasEdit: () => Promise.resolve(true),
      getStatus: () => Promise.resolve({ enableTriggerTts: true, canvasOwnsTriggers: true }),
    };
    window.mimic = new Proxy({}, { get: (t, k) => (k in impl ? impl[k] : () => Promise.resolve(null)) });
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); });
  }, { port: PORT, state, css: BACKDROP, T: F.T });
  await page.goto(`http://127.0.0.1:${PORT}/canvas.html`);
  await page.waitForTimeout(3500);
  return page;
}

// A dark in-game-like ground behind the transparent canvas: soft pools of colour on near-black, no game art.
const BACKDROP = `
  html{background:
      radial-gradient(ellipse 50% 40% at 50% 38%, rgba(96,120,78,.40), transparent 70%),
      radial-gradient(ellipse 40% 50% at 12% 20%, rgba(70,60,104,.34), transparent 70%),
      radial-gradient(ellipse 60% 40% at 70% 100%, rgba(120,84,50,.30), transparent 70%),
      linear-gradient(165deg,#0c1210,#151c17 48%,#0a0e14) !important;}`;

const shot = async (page, name, clip) => {
  await page.screenshot({ path: path.join(OUT, name + '.png'), clip });
  await page.close();
  console.log(name, 'ok');
};

const fire = async (page) => {
  FIRES.push({ ts: NOW + 1, text: 'Zarrin, D.I.!', tts: 'Zarrin, D.I.', trigger: 'DI' });
  await page.waitForTimeout(1300);
};
if (want('canvas-overlays')) {
  const p = await open({ edit: false });
  await fire(p);
  await shot(p, 'canvas-overlays', { x: 0, y: 0, width: SW, height: SH });
}
if (want('canvas-builder')) {
  const p = await open({ edit: true, layout: LAYOUT_EDIT });
  await shot(p, 'canvas-builder', { x: 0, y: 0, width: SW, height: SH });
}

await browser.close();
srv.close();
