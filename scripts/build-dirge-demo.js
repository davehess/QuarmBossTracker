#!/usr/bin/env node
// Builds wolfpack.quest/mimic/dirge: the Melody overlay's DIRGE TACTICAL NUKE board running on a
// scripted bard fight (the guild lead, 2026-09-26: "throw this up on wolfpack.quest … I want to place
// it in Discord"). The page is the REAL overlay: melody.html's styles, markup and script, with fetch()
// answered by the script below instead of the local agent. Regenerate whenever the board changes.
//
//   node scripts/build-dirge-demo.js <path to melody.html that has the board>
//
// The board ships on the Mimic beta first, so the source is usually the beta branch's
// apps/mimic/melody.html; main's copy may not have it yet, and the script refuses a file without it.
// Output: web/public/mimic/dirge.html (served at /mimic/dirge by a rewrite in web/next.config.js).
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'apps', 'mimic', 'melody.html');
const OUT = path.join(__dirname, '..', 'web', 'public', 'mimic', 'dirge.html');
const h = fs.readFileSync(SRC, 'utf8');
for (const marker of ['dirge-board:css:start', 'dirge-board:html:start', 'dirge-board:js:start', 'id="dirge-btns"']) {
  if (!h.includes(marker)) {
    console.error(`build-dirge-demo: ${SRC} has no ${marker}; point it at a melody.html with the board.`);
    process.exit(1);
  }
}
const css = h.slice(h.indexOf('<style>') + 7, h.indexOf('</style>')).replace('html,body{', '.ov{');
const body = h.slice(h.indexOf('<body>') + 6, h.indexOf('<script>'));
const js = h.slice(h.indexOf('<script>') + 8, h.lastIndexOf('</script>'));

// The scripted fight: seconds on a 40 s loop; every value is what the agent would send. The bard's
// name is invented (Brackwyn is nobody).
const demo = `
var LOOP = 40, T0 = Date.now();
var CASTS = [
  { n: 'Harmonize', a: 0.5, b: 0.8 },
  { n: 'Selo\`s Accelerating Chorus', a: 1, b: 4 },
  { n: 'Guardian Rhythms', a: 4, b: 7, row: 0 },
  { n: 'Psalm of Mystic Shielding', a: 7, b: 10, row: 1 },
  { n: 'Breath of Harmony', a: 10.2, b: 10.6 },
  { n: 'Amplification', a: 11, b: 14 },
];
var PURETONE_AT = 16.5, MANA_MAX = 4000;
for (var i = 0; i < 5; i++) CASTS.push({ n: 'Denon\`s Desperate Dirge', a: 18 + 3 * i, b: 21 + 3 * i, row: 2, dirge: true });
function demoT(){ return ((Date.now() - T0) / 1000) % LOOP; }
function doneBy(name, t){ return CASTS.some(function(c){ return c.n === name && t >= c.b; }); }
function demoState(){
  var t = demoT(), now = Date.now(), base = now - t * 1000;
  var cur = null, last = CASTS[0], lastRow = 0;
  CASTS.forEach(function(c){ if (t >= c.a) { last = c; if (c.row != null) lastRow = c.row; } if (t >= c.a && t < c.b) cur = c; });
  var dirges = CASTS.filter(function(c){ return c.dirge && t >= c.b; }).length;
  var order = [{ name: 'Guardian Rhythms' }, { name: 'Psalm of Mystic Shielding' }];
  if (t >= 18) order.push({ name: 'Denon\`s Desperate Dirge' });
  var pure = t >= PURETONE_AT;
  var obs = function(on, secs){ return on ? { observed: true, remaining_secs: secs == null ? null : Math.round(secs) } : null; };
  return {
    activeCharacter: 'Brackwyn',
    bardMelody: { brackwyn: {
      character: 'brackwyn', isBard: true, kind: 'song', order: order,
      currentPos: Math.min(lastRow, order.length - 1),
      castStartedAt: base + last.a * 1000, lastChangeAt: base + last.a * 1000,
      cycleLength: order.length, nowCasting: cur ? cur.n : null, melodyActive: true,
      bardBuffs: {
        amplification: obs(doneBy('Amplification', t)),
        harmonize: obs(doneBy('Harmonize', t), 720 - (t - 0.8)),
        resonance: null,
        accelerating_chorus: obs(doneBy('Selo\`s Accelerating Chorus', t), 150 - (t - 4)),
        nivs: obs(doneBy('Breath of Harmony', t)), natures: null,
        casting: { amplification: !!cur && cur.n === 'Amplification', harmonize_resonance: !!cur && cur.n === 'Harmonize',
          accelerating_chorus: !!cur && /Selo/.test(cur.n), nivs: !!cur && /Breath/.test(cur.n), natures: false },
        dirge: {
          guardian: doneBy('Guardian Rhythms', t), psalm: doneBy('Psalm of Mystic Shielding', t), nivs_harmonic: false,
          puretone: { active: pure, remaining_secs: pure ? 240 - (t - PURETONE_AT) : null, ready: !pure, ready_in_secs: null },
          mana_cur: MANA_MAX - 800 * dirges, mana_max: MANA_MAX, dirge_mana: 800, dirge_cast_ms: 3000,
        },
      },
    } },
  };
}
window.fetch = function(){ return Promise.resolve({ json: function(){ return Promise.resolve(demoState()); } }); };
try { localStorage.setItem('wp:melody:dirge', '1'); } catch (e) {}
`;

const steps = [
  [0.5, 'Harmonize (the Shadowsong Cloak click)'],
  [1, 'Selo’s Accelerating Chorus, 2:00 or more left'],
  [4, 'Guardian Rhythms'],
  [7, 'Psalm of Mystic Shielding'],
  [10.2, 'Niv’s: the Breath of Harmony click'],
  [11, 'Amplification, last'],
  [14, 'All six checked: the board slides out and the cover lifts'],
  [16.5, 'Pop Puretone: the key turns and the Dirges pop in'],
  [18, 'Sing a Dirge: the top button fills, then goes dark'],
  [33, 'Out of mana: all five spent'],
];

const TITLE = 'Dirge Tactical Nuke';
const DESC = 'The Melody overlay’s DIRGE TACTICAL NUKE board for bards: check off the pre-buffs, lift the cover, turn the Puretone key, and fire one button per Dirge your mana holds.';
const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE} — Wolf Pack Mimic</title>
<meta name="description" content="${DESC}">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:image" content="https://wolfpack.quest/mimic/dirge-card.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico">
<style>
:root{color-scheme:dark;--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#c9d1d9;--dim:#8b949e;--red:#f85149;--gold:#d29922;--blue:#58a6ff}
html,body{margin:0}
body{background:var(--bg);color:var(--text);font-family:"Cascadia Code",Consolas,ui-monospace,monospace;font-size:13px}
.page{max-width:780px;margin:0 auto;padding-block:16px 28px;padding-inline:16px;display:flex;flex-direction:column;gap:14px}
.crumbs{display:flex;gap:14px;flex-wrap:wrap;font-size:12px}
.crumbs a{color:var(--blue);text-decoration:none}
.crumbs a:hover{text-decoration:underline}
h1{font-size:18px;margin:0;letter-spacing:0.04em;text-wrap:balance}
h1 b{color:var(--red)}
.lede{margin:0;color:var(--dim);line-height:1.5;max-width:65ch}
.stage{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:660px){.stage{grid-template-columns:1fr}}
.scene{border-radius:8px;border:1px solid var(--line);padding:14px 10px;min-height:380px;
  background:radial-gradient(ellipse at 50% 20%,rgba(120,130,110,0.25),transparent 60%),
    repeating-linear-gradient(90deg,#1b1f1c 0 58px,#151816 58px 60px),
    repeating-linear-gradient(0deg,#1b1f1c 0 28px,#131614 28px 30px)}
.ov{max-width:320px;position:relative}
ol{margin:0;padding-left:26px;display:flex;flex-direction:column;gap:2px;line-height:1.35}
ol li::marker{color:var(--dim)}
ol li.now::marker{color:var(--red)}
ol button{font:inherit;color:var(--dim);background:none;border:0;padding:3px 4px;margin:0 -4px;text-align:left;
  cursor:pointer;border-radius:4px;width:100%}
ol button:hover{background:var(--panel);color:var(--text)}
ol button:focus-visible{outline:2px solid var(--gold);outline-offset:1px}
ol li.done button{color:#9aa3ad}
ol li.now button{color:#fff}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.bar button{font:inherit;font-size:12px;color:var(--text);background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:5px 12px;cursor:pointer}
.bar button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.clock{color:var(--dim);font-variant-numeric:tabular-nums}
.notes{color:var(--dim);line-height:1.5;border-top:1px solid var(--line);padding-top:10px;max-width:70ch;margin:0}
.notes b{color:var(--text)}
.notes a{color:var(--blue)}
${css}
</style>
</head>
<body>
<div class="page">
  <nav class="crumbs"><a href="/">← wolfpack.quest</a><a href="/mimic/beta">Get the Mimic beta</a></nav>
  <h1>🎶 Melody · <b>DIRGE TACTICAL NUKE</b></h1>
  <p class="lede">The real Melody overlay code on a scripted fight. Check off the steps in order; with all six checked the board slides out and the cover over the key lifts. Pop Puretone and the key turns, and one button pops in for every Dirge your mana holds. Click any step to jump to it.</p>
  <div class="stage">
    <div class="scene"><div class="ov">${body}</div></div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <ol id="steps">
        ${steps.map(([a, label]) => `<li data-a="${a}"><button type="button">${label}</button></li>`).join('\n        ')}
      </ol>
      <div class="bar"><button type="button" id="replay">Replay</button><span class="clock" id="clock"></span></div>
    </div>
  </div>
  <p class="notes">On the <a href="/mimic/beta">Mimic beta</a> now: turn on Melody, flip its <b>DIRGE</b> switch, and the number beside it is how many Dirges your mana holds right now. The <b>DISC</b> key in the bottom right is up when Puretone is ready and down while it recharges. Full mana at 4,000 is five buttons; each one goes dark as its 800 mana is spent.</p>
</div>
<script>${demo}</script>
<script>${js}</script>
<script>
(function(){
  var steps = [].slice.call(document.querySelectorAll('#steps li'));
  function seek(a){ T0 = Date.now() - a * 1000; window.__wpMelState = null; }
  function paint(){
    var t = demoT();
    document.getElementById('clock').textContent = t.toFixed(1) + ' s of ' + LOOP;
    var nowIdx = -1;
    steps.forEach(function(li, i){ if (t >= parseFloat(li.getAttribute('data-a'))) nowIdx = i; });
    steps.forEach(function(li, i){ li.className = i === nowIdx ? 'now' : (i < nowIdx ? 'done' : ''); });
  }
  steps.forEach(function(li){
    li.querySelector('button').addEventListener('click', function(){ seek(parseFloat(li.getAttribute('data-a'))); paint(); });
  });
  setInterval(paint, 100); paint();
  document.getElementById('replay').addEventListener('click', function(){ seek(0); });
})();
</script>
</body></html>
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, page);
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${page.length} bytes) from ${SRC}`);
