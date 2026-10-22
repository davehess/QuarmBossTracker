// Records the raidmimic landing CLIPS: the REAL Mimic overlay pages (apps/mimic/*.html) in Chromium, fed by a stand-in
// agent whose answers follow a scripted raid moment second by second, captured as frames and encoded to a muted mp4.
// Same idea as shoot.mjs (stills); here the stand-in's state is a function of scene time t.
//
//   node scripts/raidmimic-shots/scenes.mjs <out-dir> [scene-id ...]
//
// Writes <out-dir>/<id>/frames/*.png + <id>/frames.ffconcat (frame durations from the real capture clock). Encode with:
//   ffmpeg -f concat -i <id>/frames.ffconcat -vf "fps=15,format=yuv420p" -c:v libx264 -crf 28 -preset slow
//          -movflags +faststart <id>.mp4
// Needs Playwright (PLAYWRIGHT_MODULE_DIR) and Chromium (CHROMIUM), as shoot.mjs.
//
// Every PLAYER name is from fixtures.mjs PLAYERS (invented). Mob, spell and zone names are game data, and the mob
// stats are the game's own (eqemu_npc_types): Vallon Zek 214316 (L73, 175,000 HP), Grummus 205091. Grummus is
// unslowable and unsnareable in that data, so the debuff scene is Vallon Zek, the Tactics boss a raid snares because
// the real one runs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PLAYERS } from './fixtures.mjs';

const require = createRequire((process.env.PLAYWRIGHT_MODULE_DIR || '/opt/node-tools/node_modules') + '/');
const { chromium } = require('playwright');
const agent = createRequire(import.meta.url)('../../packages/wolfpack-logsync/index.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIMIC = path.resolve(HERE, '../../apps/mimic');
const OUT = process.argv[2] || path.join(HERE, 'out-clips');
const ONLY = process.argv.slice(3);
const SCALE = 1.5;
const ME = 'Vessa';

for (const n of ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Odelle', 'Halric', 'Kaelith', 'Varn',
  'Torvald', 'Garrick', 'Mirela', 'Ysolde', 'Joska', 'Tavrin', 'Fenwick', 'Elowen', 'Dunmar', 'Perrin', 'Lorwyn', 'Osric',
  'Sylvar', 'Wynne', 'Bramwell', 'Cassivane', 'Pell', 'Ulric', ME]) {
  if (!PLAYERS.includes(n)) throw new Error('not an invented name: ' + n);
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * clamp(k, 0, 1);
// health that falls from `from` at t0 to `to` at t1, with a little unevenness so it reads as damage, not a tween
const fall = (t, t0, t1, from, to) => {
  if (t <= t0) return from;
  if (t >= t1) return to;
  const k = (t - t0) / (t1 - t0);
  return from + (to - from) * (k + 0.025 * Math.sin(k * 23));
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
// The pages run in UTC (timezoneId below) and so does the stand-in, whatever the host's zone: the chat clock then
// reads the scene's raid-night time, 20:14 at t=0, by shifting only the log stamps.
let STAMP_SHIFT = 0;
function eqStamp(ms) {
  const d = new Date(ms + STAMP_SHIFT);
  return `[${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ${d.getUTCFullYear()}]`;
}

// ── Scene: Target Info, the debuffs pile up on Vallon Zek ─────────────────────────────────────────────────────
// Casts: [startT, caster, spell, castSecs, lands -> debuff {name, total, owner}]. Totals are the spells' own
// durations (eqemu_spells buffduration, 6 s ticks): Tashanian 140, Malosini 205, Sha`s Revenge 35, Turgur's Insects
// 65, Ensnare 140, Splurt 16, Pyrocruor 18, Boil Blood 21, Envenomed Bolt 7, Funeral Pyre of Kelador 9.
// Nukes (no duration) only ever appear in the casting list.
const DEBUFF_CASTS = [
  [1.5, 'Corvale', 'Tashanian', 1.0, { name: 'Tashanian', ticks: 140 }],
  [3.0, 'Nyssara', 'Malosini', 3.0, { name: 'Malosini', ticks: 205 }],
  [6.5, 'Brackwyn', "Sha's Revenge", 3.5, { name: "Sha's Revenge", ticks: 35, slow: { cls: 'BST', magnitude: 65 } }],
  [10.5, 'Rethlan', "Turgur's Insects", 3.0, { name: "Turgur's Insects", ticks: 65, slow: { cls: 'SHM', magnitude: 75 } }],
  [13.8, 'Odelle', 'Ensnare', 1.75, { name: 'Ensnare', ticks: 140 }],
  [15.6, 'Kaelith', 'Splurt', 4.0, { name: 'Splurt', ticks: 16 }],
  [16.2, 'Varn', 'Envenomed Bolt', 6.1, { name: 'Envenomed Bolt', ticks: 7 }],
  [17.0, 'Halric', 'Pyrocruor', 5.5, { name: 'Pyrocruor', ticks: 18 }],
  [19.8, 'Kaelith', 'Boil Blood', 4.0, { name: 'Boil Blood', ticks: 21 }],
  [21.0, 'Halric', 'Funeral Pyre of Kelador', 5.5, { name: 'Funeral Pyre of Kelador', ticks: 9 }],
  [17.5, 'Zarrin', 'Ice Comet', 6.3, null],
  [18.4, 'Mirela', 'Sunstrike', 7.0, null],
  [19.1, 'Ysolde', 'Inferno of Al\'Kabor', 5.0, null],
  [23.0, 'Joska', 'Strike of Solusek', 8.0, null],
  [24.2, 'Zarrin', 'Ice Comet', 6.3, null],
  [25.0, 'Tavrin', 'Lure of Ice', 4.5, null],
  [25.6, 'Mirela', 'Draught of Jiva', 3.0, null],
  [27.4, 'Ysolde', 'Sunstrike', 7.0, null],
  [28.8, 'Fenwick', 'Inferno of Al\'Kabor', 5.0, null],
];
function targetDebuffs(t, T0) {
  const casting = [];
  const buffs = [];
  let slow = null;
  for (const [st, caster, spell, cast, lands] of DEBUFF_CASTS) {
    const end = st + cast;
    if (t >= st && t < end + 0.6) casting.push({ caster, spell, ends_at_ms: T0 + end * 1000, cast_secs: cast });
    if (lands && t >= end) {
      const total = lands.ticks * 6, rem = Math.max(0, Math.round(total - (t - end)));
      buffs.push({ name: lands.name, good: 0, remaining_secs: rem, total_secs: total, owner: caster });
      if (lands.slow) slow = { name: lands.name, cls: lands.slow.cls, magnitude: lands.slow.magnitude, caster, remaining_secs: rem };
    }
  }
  // EQ slows do not stack: the 75% shaman slow replaces the 65% beastlord slow, and the weaker one's row goes.
  const hasTurgur = buffs.some((b) => b.name === "Turgur's Insects");
  const shown = hasTurgur ? buffs.filter((b) => b.name !== "Sha's Revenge") : buffs;
  const hp = Math.round(fall(t, 2, 33, 100, 61) * 10) / 10;
  return {
    activeCharacter: ME,
    mobInfo: {
      target_name: 'Vallon Zek',
      target_hp_pct: hp,
      mob: {
        id: 214316, name: 'Vallon Zek', class: 'Warrior', level: 73, hp: 175000, mindmg: 235, maxdmg: 955, ac: 400,
        resists: { mr: 140, fr: 90, cr: 90, pr: 75, dr: 75 }, zone: 'Plane of Tactics',
        specials: ['Summon', 'Enrage', 'Does Not Equip', 'Unmezzable', 'Uncharmable', 'Unstunnable', 'Unfearable',
          'Immune Fleeing', 'Immune Non-Magical', 'Immune Pacify'],
      },
      target_slow: slow,
      target_buffs: shown,
      target_casting: casting,
      target_hits: { seen: Math.round(lerp(0, 212, t / 33)), slash: 0, pierce: 0, blunt: Math.round(lerp(0, 212, t / 33)), verbs: { crush: 140, bash: 72 } },
    },
  };
}

// ── Scene: Extended Target, Vallon Zek splits into five ───────────────────────────────────────────────────────
// At ~60% the real one splits into five of the same name (apps/mimic/pop-raids.js "vallon-a"); the raid tags each with
// a Zeal /tag so they can be told apart, and kills the fakes first. Clones: eqemu 214318/214319 (L64, 42,000 HP).
const XT_RAIDERS = ['Aldenmar', 'Torvald', 'Garrick', 'Halric', 'Kaelith', 'Varn', 'Zarrin', 'Mirela', 'Ysolde', 'Joska',
  'Tavrin', 'Fenwick', 'Brackwyn', 'Rethlan', 'Corvale', 'Nyssara', 'Odelle', 'Elowen', 'Dunmar', 'Perrin'];
const SPLIT_AT = 4;
const CLONES = [
  // [dup, spawn, tag shape, tag text, tank, dies at t (null = the real one), attackers]
  [1, 31871, 'R', 'REAL', 'Aldenmar', null, 3],
  [2, 31874, 'O', '2', 'Torvald', 11, 6],
  [3, 31872, 'Y', '3', 'Garrick', 15.5, 5],
  [4, 31875, 'G', '4', 'Elowen', 19.5, 4],
  [5, 31873, 'B', '5', 'Dunmar', 23.5, 2],
];
function xtargetSplit(t) {
  const debReal = (left) => [
    { name: "Turgur's Insects", remaining_secs: Math.max(0, Math.round(372 - left)), attributed: true },
    { name: 'Malosini', remaining_secs: Math.max(0, Math.round(1180 - left)), attributed: true },
    { name: 'Tashanian', remaining_secs: Math.max(0, Math.round(790 - left)), attributed: true },
  ];
  if (t < SPLIT_AT) {
    return { scope: 'raid', online: 54, targets: [{
      name: 'Vallon Zek', kind: 'npc', is_named: true, hp_pct: Math.round(fall(t, 0, SPLIT_AT, 64, 60)),
      raider_count: 18, raiders: XT_RAIDERS.slice(0, 18), tanks: ['Aldenmar'], ma_target: true,
      victim: 'Aldenmar', debuffs: debReal(t),
    }] };
  }
  const alive = CLONES.filter((c) => c[5] == null || t < c[5]);
  const n = alive.length;
  const targets = alive.map(([dup, spawn, shape, text, tank, dies, att], i) => {
    const real = dies == null;
    const born = SPLIT_AT;
    const hp = real ? Math.round(fall(t, 24.5, 29, 60, 52)) : Math.round(fall(t, dies - 4.2, dies, 100, 0));
    const fighting = real ? 3 + Math.max(0, 5 - n) * 3 : (t > dies - 4.6 ? att + 4 : att);
    const who = XT_RAIDERS.slice((dup * 3) % 12, (dup * 3) % 12 + fighting);
    return {
      name: 'Vallon Zek', kind: 'npc', is_named: true, hp_pct: clamp(hp, 0, 100),
      spawn_id: spawn, id_proven: true, dup_index: n > 1 ? i + 1 : null, same_name_count: n > 1 ? n : null,
      tag_shape: shape, tag_text: text, tanks: [tank], ma_target: !real && i === 1 ? true : (n === 1),
      raider_count: who.length, raiders: who,
      debuffs: real ? debReal(t) : (t > born + 2 ? [{ name: 'Tashanian', remaining_secs: Math.round(840 - (t - born)), attributed: true }] : []),
    };
  });
  return { scope: 'raid', online: 54, targets };
}

// ── Scene: Command Center + Chat, Grummus dies, then the hail ─────────────────────────────────────────────────
const KILL_AT = 5;
const HAIL_ORDER = ['Brackwyn', ME, 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Odelle', 'Halric', 'Kaelith', 'Varn',
  'Torvald', 'Garrick', 'Mirela', 'Ysolde', 'Joska', 'Tavrin'];
const HAIL_T0 = 7.2, HAIL_STEP = 1.15;
const ALREADY = ['Ulric', 'Pell', 'Cassivane'];
function commandHail(t, T0) {
  const out = { character: ME, healer_mana: [
    { name: 'Corvale', class: 'Cleric', pct: Math.round(lerp(34, 29, t / 26)) },
    { name: 'Odelle', class: 'Druid', pct: Math.round(lerp(48, 44, t / 26)) },
    { name: 'Nyssara', class: 'Shaman', pct: Math.round(lerp(61, 57, t / 26)) },
  ] };
  if (t < KILL_AT) {
    out.target = { name: 'Grummus', hp_pct: Math.max(0, Math.round(fall(t, 0, KILL_AT, 11, 0))) };
    out.rampage = { target: 'Torvald', hp_pct: Math.round(lerp(82, 56, t / KILL_AT)) };
    return out;
  }
  const hailed = [];
  const still = [];
  HAIL_ORDER.forEach((name, i) => ((t >= HAIL_T0 + i * HAIL_STEP) ? hailed : still).push(name));
  const end = T0 + (KILL_AT + 1) * 1000 + 20 * 60 * 1000;
  out.hail = [{
    id: 'w1', npc_name: 'A Planar Projection', ms_left: end - (T0 + t * 1000), ends_at_ms: end,
    flag_cap: 144, flags_granted: hailed.length, flags_left: 144 - hailed.length, seen_by: Math.min(11, 4 + hailed.length),
    still: still.map((name) => ({ name, me: name === ME })), hailed: hailed.slice().reverse().map((name) => ({ name, how: 'seen' })),
    already_flagged: ALREADY,
  }];
  return out;
}
// Chat lines by scene time: [t, text after the timestamp]. Classified and served by the agent's own chat code.
const HAIL_CHAT = [
  [0.4, "Aldenmar tells the raid,  'Grummus 10% - rampage on Torvald'"],
  [2.2, "Corvale tells the raid,  'CH Torvald'"],
  [3.6, "Torvald tells the raid,  'ramp still on me, 5%'"],
  [KILL_AT, 'Grummus has been slain by Aldenmar!'],
  [KILL_AT + 1.2, "Aldenmar tells the raid,  'Grummus down. Hail the projection, 20 minutes'"],
  [KILL_AT + 1.8, "Corvale tells the guild, 'grats all'"],
  ...HAIL_ORDER.slice(0, 7).flatMap((name, i) => {
    const at = HAIL_T0 + i * HAIL_STEP - 0.3;
    return name === ME
      ? [[at, "You say, 'Hail, A Planar Projection'"], [at + 0.4, 'You have received a character flag!']]
      : [[at, `${name} says, 'Hail, A Planar Projection'`]];
  }),
  [HAIL_T0 + 8 * HAIL_STEP, "Rethlan tells the guild, 'who still needs the flag?'"],
];

const SCENES = {
  'target-debuffs': { dur: 34, w: 604, h: 500, pages: [['mobinfo.html', 604, 500]], routes: (t, T0) => ({ '/api/state': targetDebuffs(t, T0) }) },
  'xtarget-split': { dur: 30, w: 460, h: 470, pages: [['extarget.html', 460, 470]], routes: (t) => ({ '/api/extended-target': xtargetSplit(t) }) },
  'grummus-hail': {
    dur: 27, w: 964, h: 372, pages: [['command.html', 480, 372], ['chat.html', 470, 372]],
    routes: (t, T0) => ({ '/api/command-center': commandHail(t, T0) }), chat: HAIL_CHAT,
  },
};

// ── stand-in agent ───────────────────────────────────────────────────────────────────────────────────────────
let CUR = null;          // { scene, T0 }
let chatFed = 0;
function sceneT() { return CUR ? (Date.now() - CUR.T0) / 1000 : -1; }
function feedChat() {
  if (!CUR || !CUR.scene.chat) return;
  const t = sceneT();
  const lines = CUR.scene.chat;
  while (chatFed < lines.length && lines[chatFed][0] <= t) {
    const now = CUR.T0 + lines[chatFed][0] * 1000;
    agent.noteLocalChatLine(eqStamp(now) + ' ' + lines[chatFed][1], ME, now);
    chatFed++;
  }
}
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/chat') { feedChat(); return agent._handleLocalChatForTest(req, res); }
  if (CUR) {
    const t = Math.max(0, sceneT());
    const r = CUR.scene.routes(Math.min(t, CUR.scene.dur), CUR.T0);
    if (r[u.pathname]) return json(r[u.pathname]);
  }
  if (u.pathname.startsWith('/api/')) return json({});
  if (u.pathname === '/__compose') {
    const frames = JSON.parse(u.searchParams.get('f'));
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><body style="margin:0;display:flex;gap:12px;align-items:flex-start">' + frames.map(([src, w, h]) =>
      `<iframe src="${src}" style="border:0;width:${w}px;height:${h}px;background:transparent"></iframe>`).join('') + '</body>');
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

// The same dark, in-game-like ground as shoot.mjs. No game art.
const BACKDROP = `
  html{padding:14px;box-sizing:border-box;
    background:
      radial-gradient(ellipse 60% 45% at 18% 12%, rgba(86,112,74,.38), transparent 70%),
      radial-gradient(ellipse 55% 50% at 88% 30%, rgba(70,60,104,.34), transparent 70%),
      radial-gradient(ellipse 70% 40% at 40% 100%, rgba(120,84,50,.30), transparent 70%),
      linear-gradient(165deg,#0c1210,#151c17 48%,#0a0e14) !important;}
  body{background:transparent !important}
  #move-btn,#hide-btn{display:none !important}`;
const CHAT_PREFS = { fontSize: 12, group: true, officer: false, custom: false, tells: true, other: true, away: false };

async function record(id, scene) {
  const dir = path.join(OUT, id, 'frames');
  fs.rmSync(path.join(OUT, id), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const W = scene.w + 28, H = scene.h + 28;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE, timezoneId: 'UTC' });
  page.on('pageerror', (e) => console.log('PAGEERROR', id, e.message));
  await page.addInitScript(({ port, css, prefs }) => {
    window.mimic = new Proxy({}, { get: (t, k) => (k === 'getAgentPort' ? () => Promise.resolve(port)
      : k === 'getChatPrefs' ? () => Promise.resolve(prefs) : () => Promise.resolve(null)) });
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = window.top === window ? css : 'html{background:transparent !important;padding:0 !important}#move-btn,#hide-btn{display:none !important}';
      document.head.appendChild(s);
    });
  }, { port: PORT, css: BACKDROP, prefs: CHAT_PREFS });
  // Scene clock starts once the pages have loaded and made their first poll, so frame 0 is a settled overlay.
  CUR = { scene, T0: Date.now() + 2500 };
  chatFed = 0;
  { const d = new Date(CUR.T0); STAMP_SHIFT = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 20, 14, 0) - CUR.T0; }
  const src = scene.pages.length === 1 ? '/' + scene.pages[0][0]
    : '/__compose?f=' + encodeURIComponent(JSON.stringify(scene.pages.map(([f, w, h]) => ['/' + f, w, h])));
  await page.goto(`http://127.0.0.1:${PORT}${src}`);
  while (Date.now() < CUR.T0) await page.waitForTimeout(50);
  // A JPEG screenshot loop (q95, re-encoded to H.264 anyway): fast enough to catch the overlays' 250 ms bar slides and
  // the Extended Target reorder glide, which Chrome's repaint-driven screencast skipped.
  const stamps = [];
  let i = 0;
  while (sceneT() < scene.dur) {
    const at = sceneT();
    const file = `f${String(i++).padStart(5, '0')}.jpg`;
    await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 95 });
    stamps.push([file, at]);
  }
  await page.close();
  CUR = null;
  // ffconcat with each frame held until the next one was taken (the last held 0.5 s).
  let txt = 'ffconcat version 1.0\n';
  stamps.forEach(([file, at], k) => {
    const next = k + 1 < stamps.length ? stamps[k + 1][1] : at + 0.5;
    txt += `file 'frames/${file}'\nduration ${Math.max(0.01, next - at).toFixed(3)}\n`;
  });
  txt += `file 'frames/${stamps[stamps.length - 1][0]}'\n`;
  fs.writeFileSync(path.join(OUT, id, 'frames.ffconcat'), txt);
  console.log(id, stamps.length, 'frames', (stamps.length / scene.dur).toFixed(1), 'fps');
}

for (const [id, scene] of Object.entries(SCENES)) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  await record(id, scene);
}
await browser.close();
srv.close();
