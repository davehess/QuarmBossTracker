// Renders the UI Studio captures for the raidmimic landing: the REAL apps/mimic/ui-studio.html in Chromium, with a
// stand-in `window.mimic` that serves an invented character's EverQuest UI file (ini text), a few named layouts and
// a list of cloud backups from other computers. Invented names only.
//
//   node scripts/raidmimic-shots/shoot-studio.mjs <out-dir> [ui-studio|sync ...]
//
// ui-studio: the editor with a raider's windows laid out on a 2560x1440 screen. sync: the Layouts bar with the
// "bring back a layout from your cloud backups" picker open (layouts saved on another computer).
// Writes <name>.png at 2x. Needs Playwright (PLAYWRIGHT_MODULE_DIR) and Chromium (CHROMIUM), like shoot.mjs.
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

const VW = 1500, VH = 900;
const RES = '2560x1440';
const CHAR = 'Odelle';
const win = (name, x, y, w, h) => `[${name}]\nXPos${RES}=${x}\nYPos${RES}=${y}\nWidth=${w}\nHeight=${h}\n`;
const UI_INI = [
  '[ChatManager]\nNumWindows=3\nChatWindow0_Name=Main\nChatWindow1_Name=Raid\nChatWindow2_Name=Guild\n',
  win('MainChat', 10, 1030, 700, 400), win('Chat 1', 720, 1030, 520, 400), win('Chat 2', 1250, 1030, 480, 400),
  win('PlayerWindow', 10, 10, 260, 140), win('PetInfoWindow', 10, 160, 260, 120),
  win('GroupWindow', 10, 290, 230, 330), win('TargetWindow', 290, 10, 260, 110),
  win('CompassWindow', 1180, 10, 200, 60), win('BuffWindow', 2300, 10, 250, 420),
  win('ShortDurationBuffWindow', 2040, 10, 250, 260), win('RaidWindow', 1850, 300, 300, 560),
  win('HotButtonWnd', 1760, 1330, 480, 100), win('HotButtonWnd2', 1760, 1220, 480, 100),
  win('CastSpellWnd', 2440, 450, 100, 560), win('MapViewWnd', 2000, 1030, 540, 190),
].join('\n');
const BUNDLE = { ['UI_' + CHAR + '_pq.proj.ini']: UI_INI, 'eqclient.ini': `[VideoMode]\nWidth=${2560}\nHeight=${1440}\n` };

const DAY = 86400000;
const LAYOUTS = [
  { id: 'l1', name: 'Raid (full chat)', live: true, modified: false, savedAt: F.T - 2 * DAY, fileCount: 1 },
  { id: 'l2', name: 'Minimal chat + Mimic overlays', live: false, savedAt: F.T - 9 * DAY, fileCount: 1 },
  { id: 'l3', name: 'Healing (CH chain)', live: false, savedAt: F.T - 16 * DAY, fileCount: 1 },
];
const SNAPS = [
  { id: 's1', label: 'Layout: Raid (full chat)', created_at: new Date(F.T - 2 * DAY).toISOString(), machine_name: 'RAID-PC' },
  { id: 's2', label: 'Layout: Minimal chat + Mimic overlays', created_at: new Date(F.T - 9 * DAY).toISOString(), machine_name: 'LAPTOP' },
  { id: 's3', label: 'Layout: Healing (CH chain)', created_at: new Date(F.T - 16 * DAY).toISOString(), machine_name: 'RAID-PC' },
  { id: 's4', label: 'Layout: Old 1080p screen', created_at: new Date(F.T - 61 * DAY).toISOString(), machine_name: 'DESKTOP-OLD' },
];

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

async function open() {
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript((d) => {
    // The page's clock starts at the fixtures' raid-night instant and keeps running.
    const real = Date.now(); Date.now = () => d.T + (performance.timeOrigin + performance.now() - real);
    const ok = (v) => () => Promise.resolve(v);
    const impl = {
      machineName: 'RAID-PC',
      uiStudioListCharacters: ok([{ character: d.CHAR, eqDir: 'C:\\EverQuest', ini_count: 2 }]),
      uiStudioReadBundle: ok(d.BUNDLE),
      uiStudioScanWindowDefaults: ok({ ok: true, sizes: {}, skin: 'default' }),
      uiStudioLiveInfo: ok({ ok: true, newestMs: d.T - 3600000 }),
      uiStudioLayoutList: ok({ ok: true, layouts: d.LAYOUTS, cap: 10, hasCurrent: true }),
      uiStudioListSnapshots: ok({ ok: true, snapshots: d.SNAPS }),
      uiStudioListDisplays: ok({ displays: [{ label: 'Display 1 · 2560×1440', w: 2560, h: 1440, scaleFactor: 1 }] }),
      uiStudioPendingList: ok([]), uiStudioIsEqRunning: ok(false),
    };
    window.mimic = new Proxy({}, { get: (t, k) => (k in impl ? impl[k] : () => Promise.resolve(null)) });
  }, { CHAR, BUNDLE, LAYOUTS, SNAPS, T: F.T });
  await page.goto(`http://127.0.0.1:${PORT}/ui-studio.html`);
  await page.waitForTimeout(800);
  await page.selectOption('#charSelect', { index: 1 });   // the pick loads the character's UI as it is (Source = Target)
  await page.waitForTimeout(1800);
  return page;
}

if (want('ui-studio')) {
  const page = await open();
  await page.screenshot({ path: path.join(OUT, 'ui-studio.png'), clip: { x: 0, y: 0, width: VW, height: VH } });
  await page.close();
  console.log('ui-studio ok');
}
if (want('sync')) {
  const page = await open();
  await page.click('#layoutImport');
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'sync.png'), clip: { x: 0, y: 0, width: VW, height: 370 } });
  await page.close();
  console.log('sync ok');
}

await browser.close();
srv.close();
