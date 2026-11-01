// Renders the website's raid REPLAY capture for the raidmimic landing: the real ReplayBoard (web/app/spectator/replay,
// the Spectator replay and the members' session review both mount it) in Chromium, over a stand-in server that answers
// the routes it fetches with a made-up night: the raid on Bertoxxulous in Plane of Disease, 24 invented raiders walking
// in, gathering and fighting. The walls are the EQEmu-generated ones already used by the Map capture.
//
//   REPLAY_DEPS=<dir with node_modules: react react-dom three tailwindcss postcss autoprefixer> ROLLDOWN_DIR=<repo root> \
//     node scripts/raidmimic-shots/shoot-replay.mjs <out-dir> [replay|spectator ...]
//
// Builds the harness first (replay/build.mjs), then writes <name>.png at 2x. Needs Playwright + Chromium like shoot.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { PLAYERS } from './fixtures.mjs';

const require = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node-tools/node_modules') + '/');
const { chromium } = require('playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, 'out'));
const ONLY = process.argv.slice(3);
const want = (n) => !ONLY.length || ONLY.includes(n);
fs.mkdirSync(OUT, { recursive: true });
const BUILD = path.join(OUT, '_replay-build');
execFileSync('node', [path.join(HERE, 'replay/build.mjs'), BUILD], { stdio: 'inherit' });

// ── the night: Wednesday 2026-10-21, 8 PM ET (= 00:00 UTC on the 22nd), 80 minutes recorded ──
const START = Date.UTC(2026, 9, 22, 0, 0, 0);
const MIN = 60000, N_MIN = 80;
const ZONE = 'podisease';
const WALLS = JSON.parse(fs.readFileSync(path.join(HERE, 'map-walls-podisease.json'), 'utf8'));
const BOSS = { x: 2000, y: -330, z: 328 };
const GATE = { x: 1690, y: 410 };   // where the raid gathers before the pull (inside the cropped walls)

const CLASSES = ['Warrior', 'Cleric', 'Wizard', 'Enchanter', 'Ranger', 'Druid', 'Paladin', 'Shaman', 'Monk', 'Magician', 'Bard', 'Necromancer',
  'Cleric', 'Rogue', 'Shadow Knight', 'Cleric', 'Wizard', 'Beastlord', 'Druid', 'Shaman', 'Rogue', 'Magician', 'Warrior', 'Cleric'];
const RAIDERS = PLAYERS.slice(0, 24).map((n, i) => [n, CLASSES[i], Math.floor(i / 6) + 1, 65]);
// a tiny deterministic generator so every run draws the same night
let seed = 20261021;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const heading = (dx, dy) => Math.round((((Math.atan2(dx, dy) / (Math.PI * 2)) * 512) % 512 + 512) % 512);

const slot = RAIDERS.map((_, i) => ({ a: (i / RAIDERS.length) * Math.PI * 2 + rnd() * 0.3, r: 30 + rnd() * 55, gx: (rnd() - 0.5) * 90, gy: (rnd() - 0.5) * 90 }));
function place(i, tSec) {
  const m = tSec / 60;
  const s = slot[i];
  const gather = { x: GATE.x + s.gx, y: GATE.y + s.gy };
  if (m < 8) return { ...gather, wob: 1 };
  if (m < 15) {   // the walk to the boss, a few seconds apart per raider so it reads as a column
    const k = Math.min(1, Math.max(0, (m - 8 - (i % 6) * 0.15) / 6));
    const ease = k * k * (3 - 2 * k);
    const dest = { x: BOSS.x + Math.cos(s.a) * s.r, y: BOSS.y + Math.sin(s.a) * s.r };
    return { x: gather.x + (dest.x - gather.x) * ease, y: gather.y + (dest.y - gather.y) * ease, wob: 1 - ease * 0.6 };
  }
  const tank = i === 0;
  const spin = m * 0.05 + s.a;
  const rr = tank ? 38 : s.r + Math.sin(m * 0.8 + i) * 8;
  return { x: BOSS.x + Math.cos(spin) * rr, y: BOSS.y + Math.sin(spin) * rr, wob: 0.4 };
}

const rowFor = (k) => {
  const who = RAIDERS.map((r) => [r[0], r[1], r[2], r[3]]);
  const f = [];
  for (let dt = 0; dt < 60; dt += 3) {
    const row = [dt];
    RAIDERS.forEach((_, i) => {
      const p = place(i, k * 60 + dt);
      const x = p.x + (rnd() - 0.5) * 6 * p.wob, y = p.y + (rnd() - 0.5) * 6 * p.wob;
      const toBoss = k >= 15;
      const h = heading(toBoss ? BOSS.x - x : GATE.x - x + 1, toBoss ? BOSS.y - y : GATE.y - y + 1);
      const hp = i === 0 && toBoss ? 55 + Math.round(30 * Math.abs(Math.sin(k + dt / 20))) : 100 - (i % 5 === 0 && toBoss ? Math.round(rnd() * 25) : 0);
      row.push(i, Math.round(y), Math.round(x), 327, h, hp, 0);   // raw columns: the recorder's loc_x is the server y
    });
    f.push(row);
  }
  const fighting = k >= 14 && k < 60;
  const mf = fighting ? [...Array(20).keys()].map((q) => [q * 3, 0, Math.round(BOSS.y), Math.round(BOSS.x), BOSS.z, 17 + (q % 3), 0]) : [];
  const data = { v: 1, who, zones: [ZONE], f, mobs: fighting ? [['Bertoxxulous', 5871]] : [], mf };
  return { minute_at: new Date(START + k * MIN).toISOString(), zones: [ZONE], data: JSON.stringify(data) };
};
const ROWS = [...Array(N_MIN).keys()].map(rowFor);

const from = START, to = START + N_MIN * MIN;
const span = { from, to };
const run = { zone: ZONE, from, to };
const NIGHT = {
  night_key: '2026-10-21', first: new Date(from).toISOString(), last: new Date(to - MIN).toISOString(), minutes: N_MIN,
  zones: [ZONE], runs: [run], spans: [span],
  sessions: [{ from, to, minutes: N_MIN, peak: 24, raid: true, zones: [ZONE], runs: [run], spans: [span] }],
};
const BOSSES = [
  { npc_id: 205120, name: 'Guardian of Pestilence', from: START + 16 * MIN, to: START + 27 * MIN, points: [{ zone: ZONE, x: 1930, y: -120, z: 327 }] },
  { npc_id: 205121, name: 'Grummus', from: START + 33 * MIN, to: START + 46 * MIN, points: [{ zone: ZONE, x: 1980, y: -250, z: 327 }] },
  { npc_id: 223005, name: 'Bertoxxulous', from: START + 49 * MIN, to: START + 66 * MIN, points: [{ zone: ZONE, x: BOSS.x, y: BOSS.y, z: BOSS.z }] },
];
const MAP = { zone: ZONE, eqemu: { bands: WALLS.bands, segs: WALLS.segs, bounds: { minX: 1550, maxX: 2260, minY: -460, maxY: 580 } }, sources: { eqemu: 'EQEmu maps (GPLv2+)', brewall: '' } };

// The Spectator (live map) capture: one moment of the same raid, as the position feed the live board would be handed.
const FEED = (() => {
  const raiders = RAIDERS.map((r, i) => {
    const p = place(i, 52 * 60 + 20);
    return { name: r[0], cls: r[1], group: r[2], level: r[3], hp: i === 0 ? 72 : 100 - (i % 4 === 0 ? 18 : 0), x: Math.round(p.x), y: Math.round(p.y), z: 327,
      heading: heading(BOSS.x - p.x, BOSS.y - p.y), zone: ZONE, age_s: 1 + (i % 7) };
  });
  return { data: { at: new Date(START + 52 * MIN + 20000).toISOString(), raiders, zones: [{ zone: ZONE, name: 'Plane of Disease', count: raiders.length }], unplaced: 0 }, rxAt: 0 };
})();
const PAGE = (entry) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/replay.css"></head>
<body><div id="root"></div><script>window.process={env:{NODE_ENV:"production"}};window.__FEED=${JSON.stringify(FEED)}</script><script src="/${entry}.js"></script></body></html>`;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(PAGE(u.searchParams.get('page') === 'spectator' ? 'spectator' : 'replay')); }
  if (['/replay.js', '/spectator.js', '/replay.css'].includes(u.pathname)) {
    res.writeHead(200, { 'content-type': u.pathname.endsWith('js') ? 'text/javascript' : 'text/css' });
    return res.end(fs.readFileSync(path.join(BUILD, u.pathname)));
  }
  if (u.pathname === '/api/spectator/replay') {
    if (u.searchParams.get('nights')) return json({ nights: [NIGHT] });
    const a = Date.parse(u.searchParams.get('from')), b = Date.parse(u.searchParams.get('to'));
    return json({ rows: ROWS.filter((r) => { const t = Date.parse(r.minute_at); return t >= a && t < b; }) });
  }
  if (u.pathname === '/api/spectator/replay/bosses') return json({ bosses: BOSSES });
  if (u.pathname === '/api/spectator/map') return json(MAP);
  res.writeHead(404); res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });

async function open(search, minute) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 1200 }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:${PORT}/${search}`);
  await page.waitForTimeout(2500);
  // Scrub: the slider's value is seconds into the session.
  await page.evaluate((v) => {
    const el = document.querySelector('input[type=range]');
    if (!el) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, minute * 60);
  await page.waitForTimeout(1800);
  const fit = page.getByRole('button', { name: 'Fit raid' });
  if (await fit.count()) await fit.first().click();
  await page.waitForTimeout(1800);
  return page;
}

if (want('replay')) {
  const p = await open('?bg=lines&hl=Aldenmar,Corvale,Odelle', 52);
  await p.screenshot({ path: path.join(OUT, 'replay.png'), clip: { x: 0, y: 0, width: 1180, height: 1175 } });
  await p.close();
  console.log('replay ok');
}
if (want('spectator')) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/?page=spectator`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUT, 'spectator.png'), clip: { x: 0, y: 0, width: 1180, height: 900 } });
  await page.close();
  console.log('spectator ok');
}
await browser.close();
srv.close();
