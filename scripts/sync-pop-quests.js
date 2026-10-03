#!/usr/bin/env node
// scripts/sync-pop-quests.js
//
// The guild lead, 2026-10-03: "the pop overlay should include the quests and a mode for selecting
// them and all of the things to say or do for any of the pop quests or flags so we can reference
// them." The only dataset with say/do steps is the website's PoP guide (web/lib/popGuide.ts, plus
// popGuideMore.ts for expect / turn-in / go-back and the level grouping). The website must not
// import from outside web/ (Vercel's build only looks there), so web/lib stays the source and Mimic
// gets a GENERATED copy: apps/mimic/pop-quests.js, loaded by popraid.html's Quests mode.
//
//     npm run sync:pop-quests
//
// test/pop-quests-sync.test.js FAILS when the file is stale (same idea as check:dashboard); this
// script is how you fix that failure. Never hand-edit the generated file.
//
// HOW THE .ts IS READ: the two sources are TypeScript with extensionless relative imports, which
// Node's own type stripping refuses, and Node 20 (CI) has no type stripping at all. So the script
// bundles them in memory with rolldown, which ships inside vite/vitest and is already installed
// (no new dependency), and runs the bundle. It only ever runs in this repo, never on a member's
// machine; the file it writes is plain ES5-safe JSON-as-JS, like pop-raids.js.
//
// WHAT IS KEPT: every step's title, who (solo/group/raid), must, "not yet confirmed" mark, detail,
// the words to say (with /sit), the places (zone + the Y X /map takes), the chain's start / story /
// hand-ins, and the expect / turn-in / go-back notes. WHAT IS DROPPED: the checkbox keys' flag
// plumbing, the auto-tick explanations and the site-relative links (none of them mean anything in
// an overlay). [[Item Name#id]] tokens become the bare name: the overlay has no item cards.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'web', 'lib');
const OUT = path.join(ROOT, 'apps', 'mimic', 'pop-quests.js');

// Bundle the two web/lib files into one CommonJS module and return its exports.
async function loadGuide() {
  const { rolldown } = await import('rolldown');
  const entry = path.join(LIB, '__pop-quests-entry.ts');
  const bundle = await rolldown({
    input: entry,
    platform: 'node',
    logLevel: 'silent',
    plugins: [{
      name: 'pop-quests-entry',
      resolveId(id) { return id === entry ? id : null; },
      load(id) {
        return id === entry ? "export * from './popGuide'; export * from './popGuideMore';" : null;
      },
    }],
  });
  const { output } = await bundle.generate({ format: 'cjs', exports: 'named' });
  await bundle.close();
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', output[0].code)(mod, mod.exports, require);
  return mod.exports;
}

const ITEM_TOKEN = /\[\[([^\]#]+)#\d+\]\]/g;
const plain = (s) => String(s).replace(ITEM_TOKEN, '$1');

// Copy a value with every string run through plain(), so no [[Name#id]] survives anywhere.
function clean(v) {
  if (typeof v === 'string') return plain(v);
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = clean(v[k]);
    return o;
  }
  return v;
}

function build(g) {
  const zoneName = (key) => {
    if (!g.ZONE_NAMES[key]) throw new Error('sync-pop-quests: unknown zone key ' + JSON.stringify(key));
    return g.ZONE_NAMES[key];
  };
  const loc = (l) => {
    const o = { npc: l.npc, zone: zoneName(l.zone), y: l.y, x: l.x };
    if (l.note) o.note = l.note;
    return o;
  };

  const quest = (item) => {
    const more = g.STEP_MORE[item.key] || {};
    const q = { key: item.key, title: item.title, who: item.who };
    if (item.must) q.must = true;
    if (item.check) q.check = true;
    if (item.detail) q.detail = item.detail;
    if (item.says && item.says.length) {
      q.says = item.says.map((s) => (s.sit ? { to: s.to, text: s.text, sit: true } : { to: s.to, text: s.text }));
    }
    if (item.where && item.where.length) q.where = item.where.map(loc);
    if (item.chain) {
      const c = item.chain;
      const first = { text: c.first.text, at: loc(c.first.at) };
      if (c.first.say) first.say = c.first.say;
      if (c.first.fetch) first.fetch = loc(c.first.fetch);
      const stage = (s) => {
        const o = { at: loc(s.at) };
        if (s.say) o.say = s.say;
        if (s.give) o.give = s.give;
        if (s.get) o.get = s.get;
        if (s.note) o.note = s.note;
        return o;
      };
      q.chain = { first, talk: c.talk.map(stage), handins: c.handins.map(stage) };
    }
    if (more.expect) q.expect = more.expect;
    if (more.turnIn && more.turnIn.length) {
      q.turnIn = more.turnIn.map((t) => {
        const o = { to: loc(t.to), give: t.give };
        if (t.get) o.get = t.get;
        if (t.note) o.note = t.note;
        return o;
      });
    }
    const back = (more.back || []).filter(Boolean);
    if (back.length) q.back = back.map(loc);
    return clean(q);
  };

  const sectionOf = new Map(g.GUIDE_SECTIONS.map((s) => [s.key, s]));
  const placed = new Set();
  const levels = g.GUIDE_LEVELS.map((lv) => ({
    key: lv.key,
    title: lv.title,
    sub: lv.sub,
    color: lv.color,
    sections: lv.sections.map((sk) => {
      const sec = sectionOf.get(sk);
      if (!sec) throw new Error('sync-pop-quests: level ' + lv.key + ' names unknown section ' + sk);
      const quests = g.GUIDE_ITEMS.filter((i) => i.section === sk).map((i) => { placed.add(i.key); return quest(i); });
      return { key: sec.key, title: sec.title, blurb: sec.blurb, quests };
    }),
  }));
  const lost = g.GUIDE_ITEMS.filter((i) => !placed.has(i.key)).map((i) => i.key);
  if (lost.length) throw new Error('sync-pop-quests: steps in no level: ' + lost.join(', '));
  return clean({ levels });
}

const HEADER = [
  '// pop-quests.js — the PoP guide\'s quests and flags, for the Quests mode of the PoP overlay',
  '// (popraid.html loads this via <script src>).',
  '//',
  '// GENERATED by scripts/sync-pop-quests.js from web/lib/popGuide.ts + popGuideMore.ts — do not edit',
  '// by hand. Change the web files, then run `npm run sync:pop-quests`. test/pop-quests-sync.test.js',
  '// fails when this file is stale. Every phrase and place in here was checked against the NPC\'s',
  '// quest script and spawn table when it went into the web guide; nothing is added on the way.',
  '',
].join('\n');

// The exact text of apps/mimic/pop-quests.js. Exported so the drift test uses the SAME transform.
async function buildSource() {
  const data = build(await loadGuide());
  // U+2028 / U+2029 are legal in JSON but ended a string literal before ES2019: escape them.
  const json = JSON.stringify(data, null, 1)
    .split(String.fromCharCode(0x2028)).join('\\u2028')
    .split(String.fromCharCode(0x2029)).join('\\u2029');
  return HEADER + 'window.POP_QUESTS = ' + json + ';\n';
}

async function sync() {
  const src = await buildSource();
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (before === src) { console.log('✓ pop-quests.js already in sync with web/lib/popGuide*.ts'); return; }
  fs.writeFileSync(OUT, src);
  console.log('✓ pop-quests.js regenerated (' + src.length + ' chars)');
}

module.exports = { buildSource, build, loadGuide, OUT };
if (require.main === module) sync().catch((e) => { console.error(e); process.exit(1); });
