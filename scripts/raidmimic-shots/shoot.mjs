// Renders the raidmimic landing captures: the REAL Mimic overlay pages (apps/mimic/*.html) in Chromium, fed by a
// stand-in agent that answers their /api/* routes from fixtures.mjs (invented player names only).
//
//   node scripts/raidmimic-shots/shoot.mjs <out-dir>
//
// Needs Playwright (PLAYWRIGHT_MODULE_DIR, default /opt/node-tools/node_modules) and a Chromium binary
// (CHROMIUM, default /opt/pw-browsers/chromium). Writes <name>.png at 2x; web/public/raidmimic/shots holds the
// WebP conversions (`convert <name>.png -quality 80 <name>.webp`). The backdrop is a plain dark gradient, not game art.
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
fs.mkdirSync(OUT, { recursive: true });

// What the stand-in agent answers right now (swapped per capture).
let STATE = {};
let NPC = null;
let STATE_THREAT = null;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/state' && STATE_THREAT && String(req.headers.referer || '').includes('threatmeter')) return json(STATE_THREAT);
  if (u.pathname === '/api/command-center' || u.pathname === '/api/state' || u.pathname === '/api/timers') return json(STATE);
  if (u.pathname === '/api/target-history') return json({ targets: [], rev: 'x' });
  if (u.pathname === '/api/npc-interact') return json(NPC || { loading: true });
  if (u.pathname === '/__compose') {
    const frames = JSON.parse(u.searchParams.get('f'));
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><body style="margin:0">' + frames.map(([src, w, h]) =>
      `<iframe src="${src}" style="border:0;width:${w}px;height:${h}px;background:transparent;vertical-align:middle;margin-right:12px"></iframe>`).join('') + '</body>');
  }
  const f = path.join(MIMIC, u.pathname.replace(/^\/+/, ''));
  if (f.startsWith(MIMIC) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
    return res.end(fs.readFileSync(f));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

// A dark, in-game-like ground: a few soft pools of colour on a near-black field. No game art.
const BACKDROP = `
  html{padding:22px;box-sizing:border-box;
    background:
      radial-gradient(ellipse 60% 45% at 18% 12%, rgba(86,112,74,.38), transparent 70%),
      radial-gradient(ellipse 55% 50% at 88% 30%, rgba(70,60,104,.34), transparent 70%),
      radial-gradient(ellipse 70% 40% at 40% 100%, rgba(120,84,50,.30), transparent 70%),
      linear-gradient(165deg,#0c1210,#151c17 48%,#0a0e14) !important;}
  body{background:transparent !important}`;

async function open(file, { w, h = 1800, query = '', freeze = true, ls = {} }) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  page.on('pageerror', (e) => console.log('PAGEERROR', file, e.message));
  await page.addInitScript(({ port, T, freeze, ls, css }) => {
    if (freeze) Date.now = () => T;
    window.mimic = new Proxy({}, { get: (t, k) => (k === 'getAgentPort' ? () => Promise.resolve(port) : () => Promise.resolve(null)) });
    try { for (const k in ls) localStorage.setItem(k, ls[k]); } catch (e) {}
    document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = window.top === window ? css : 'html{background:transparent !important;padding:0 !important}'; document.head.appendChild(s); });
  }, { port: PORT, T: F.T, freeze, ls, css: BACKDROP });
  await page.goto(`http://127.0.0.1:${PORT}/${file}${query}`);
  await page.waitForTimeout(1600);
  return page;
}

// Screenshot the overlay's #wrap plus the backdrop margin around it.
async function shootWrap(page, name, { pad = 22, minW = 0 } = {}) {
  const box = await page.evaluate(() => { const r = document.getElementById('wrap').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const width = Math.max(minW, Math.ceil(box.x + box.w + pad));
  await page.screenshot({ path: path.join(OUT, name + '.png'), clip: { x: 0, y: 0, width, height: Math.ceil(box.y + box.h + pad) } });
  await page.close();
  console.log(name, 'ok');
}

// Command Center
STATE = F.commandCenter();
await shootWrap(await open('command.html', { w: 480 }), 'cc');

// Rolls: the same overlay, first set expanded
STATE = F.rollsState();
{
  const p = await open('command.html', { w: 480 });
  await p.click('.rollMore');
  await p.waitForTimeout(500);
  await shootWrap(p, 'rolls');
}

// Target Info, Stats tab
STATE = F.targetStats();
await shootWrap(await open('mobinfo.html', { w: 604 }), 'target-stats');

// Target Info, F/Q/V tab, quest sub-tab, third answer opened
STATE = F.targetQuest(); NPC = F.npcInteract();
{
  const p = await open('mobinfo.html', { w: 604 });
  await p.click('#tabFactions');
  await p.waitForTimeout(2200);
  const toggles = await p.$$('.qtoggle');
  if (toggles[2]) await toggles[2].click();
  await p.waitForTimeout(700);
  await shootWrap(p, 'target-quest');
}

// DPS: the bar meter beside the table meter, composed on one backdrop. The two overlays read the same
// /api/state route, so the stand-in answers the bar meter (by Referer) from its own fixture.
STATE = F.dps(); STATE_THREAT = F.threat();
{
  const hOf = async (file, w, sel) => {
    const p = await open(file, { w });
    const h = await p.evaluate((q) => document.querySelector(q).getBoundingClientRect().height, sel);
    await p.close();
    return Math.ceil(h + 12);
  };
  const ha = await hOf('threatmeter.html', 330, '#wrap');
  const hb = await hOf('overlay.html', 470, '.hud');
  const p = await open('__compose?f=' + encodeURIComponent(JSON.stringify([['/threatmeter.html', 330, ha], ['/overlay.html', 470, hb]])), { w: 900, h: Math.max(ha, hb) + 60 });
  await p.screenshot({ path: path.join(OUT, 'dps.png'), clip: { x: 0, y: 0, width: 330 + 470 + 12 + 44, height: Math.max(ha, hb) + 44 } });
  await p.close();
}
STATE_THREAT = null;

// Death timeline strip
{
  STATE = F.timeline(Date.now());
  const p = await open('triggers.html', { w: 760, h: 460, freeze: false });
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(OUT, 'timeline.png'), clip: { x: 0, y: 196, width: 760, height: 264 } });
  await p.close();
}

await browser.close();
srv.close();
