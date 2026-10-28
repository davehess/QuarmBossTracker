#!/usr/bin/env node
// The decision record, one file per feature set (docs/decisions/<set>.md), plus the ID index
// (docs/decisions/README.md) that keeps every "DECISIONS §117" citation findable.
//
//   node scripts/decisions/build.js merge        fold docs/decisions/inbox/*.md into the set files, rebuild the index
//   node scripts/decisions/build.js next         print the next free § number (for a new inbox entry)
//   node scripts/decisions/build.js json <out>   write every entry as JSON (the Decision Desk's search data)
//   node scripts/decisions/build.js check        fail if the inbox is not empty, or the index is stale
//   node scripts/decisions/build.js seed <entries.json> <sets.json>   one-off: build the set files from the old logs
//
// An inbox entry is "### <N>. [<set>] <title>" followed by its text; the set must be one of SETS below.
'use strict';
const fs = require('fs');
const path = require('path');
const { extract, assignIds } = require('./extract');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, 'docs', 'decisions');
const INBOX = path.join(DIR, 'inbox');

const SETS = [
  ['raid-timers', 'Raid timers & boards', 'Boss kill timers, spawn alerts, lockouts, the #raid-mobs boards.'],
  ['raid-review', 'Parses & raid review', 'Encounters, meters, threat, kills and wipes, raid nights and sessions, attendance.'],
  ['raid-planning', 'Raid planning, maps & strategy', 'Route planner, raid plans, timelines, maps, kiting, sign-ups.'],
  ['pop-progression', 'PoP flags & progression', '#popflags, the Seer and Maelin, flag checklists, quests.'],
  ['triggers', 'Triggers, callouts & voice', 'Guild and personal triggers, trigger timers, voices, callout wording.'],
  ['buffs-debuffs', 'Buffs, debuffs, charm & healing', 'Buff and debuff queues, landings, charm and pets, CH chain, mez and slow.'],
  ['mimic-overlays', 'Mimic overlays & HUD', 'Every overlay window: how it looks, moves, docks and fits.'],
  ['mimic-app', 'Mimic app & releases', 'The desktop app: install, update channels, tray, settings, stable cuts.'],
  ['agent', 'Agent & log upload', 'The log agent, its dashboard, backfill, the upload queue, ingest and load-shed.'],
  ['zeal', 'Zeal & upstream', 'The Zeal fork, upstream PRs, the pipe, spawn ids, tags, Wolf Pack Zeal.'],
  ['loot-dkp', 'Loot, DKP & wishlists', 'Loot drops, OpenDKP, bids, wishlists, soft reserve.'],
  ['gear-items', 'Gear, items, spells & characters', 'Gear finder, item, spell and NPC pages, inventory, characters, faction.'],
  ['web', 'Website & sign-in', 'wolfpack.quest pages, sign-in, link previews, admin pages, the beta site.'],
  ['bot-discord', 'Discord bot & community', 'Bot commands, Discord cards, feedback reports, onboarding, roster, Bristlebane.'],
  ['infra-costs', 'Hosting, database & costs', 'Supabase, Railway, Vercel, the home server, retention, the self-host wizard.'],
  ['process', 'Working rules & process', 'How sessions work, branches and releases, docs rules, tooling assessed.'],
  ['brand-media', 'Brand, media & marketing', 'Raid Mimic and eqmimic.quest pages, videos, posters, the mascot.'],
  ['other-games', 'Other games', 'World of Warcraft and anything outside EverQuest.'],
];
const SET_IDS = new Set(SETS.map(s => s[0]));

const ENTRY_RX = /^## (§\S+|\d{4}-\d{2}-\d{2}\/\S+) — (.*)$/;
const META_RX = /^\*(\d{4}-\d{2}-\d{2}|undated) · (.*?)\*$/;

// Reads one set file back into entries.
function readSet(set) {
  const file = path.join(DIR, set + '.md');
  if (!fs.existsSync(file)) return [];
  const out = [];
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').replace(/\r/g, '').split('\n')) {
    const m = ENTRY_RX.exec(line);
    if (m) {
      if (cur) out.push(cur);
      cur = { id: m[1], title: m[2], set, date: null, from: '', body: [] };
      continue;
    }
    if (!cur) continue;
    const meta = !cur.metaRead && META_RX.exec(line);
    if (meta) {
      cur.date = meta[1] === 'undated' ? null : meta[1];
      const parts = meta[2].split(' · ');
      cur.from = parts[0];
      cur.short = parts[1] || '';
      cur.metaRead = true;
      continue;
    }
    cur.body.push(line);
  }
  if (cur) out.push(cur);
  return out.map(e => ({ id: e.id, set, date: e.date, title: e.title, short: e.short || '', from: e.from, body: e.body.join('\n').trim() }));
}

function readAll() {
  return SETS.flatMap(([set]) => readSet(set));
}

function sortKey(e) {
  const n = /^§(\d+)/.exec(e.id);
  return `${e.date || '0000'}|${n ? String(n[1]).padStart(5, '0') : ''}|${e.id}`;
}

function writeSet(set, entries) {
  const [, name, about] = SETS.find(s => s[0] === set);
  const sorted = entries.slice().sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  const parts = [
    `# ${name}`,
    '',
    `${about} Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in \`inbox/\` and are merged here.`,
    '',
  ];
  for (const e of sorted) {
    parts.push(`## ${e.id} — ${e.title}`);
    parts.push(`*${e.date || 'undated'} · ${e.from}${e.short ? ' · ' + e.short : ''}*`);
    parts.push('');
    if (e.body) parts.push(e.body, '');
  }
  fs.writeFileSync(path.join(DIR, set + '.md'), parts.join('\n'));
}

function writeIndex(all) {
  const count = new Map(SETS.map(([s]) => [s, 0]));
  all.forEach(e => count.set(e.set, count.get(e.set) + 1));
  const byId = all.slice().sort((a, b) => (sortKey(a) < sortKey(b) ? 1 : -1));
  const lines = [
    '# Decisions, by feature set',
    '',
    'Every call the guild lead has made about the platform, one file per feature set. The open items are in',
    '[OPEN.md](OPEN.md). This file is generated by `scripts/decisions/build.js`: edit the set files or the inbox, then',
    'run `npm run decisions:merge`.',
    '',
    '**Writing a new decision:** append it to `inbox/<YYYY-MM-DD>.md` as `### <N>. [<set>] <title>`, where `<N>` is',
    '`npm run -s decisions:next` and `<set>` is one of the slugs below. The inbox is merged into the set files',
    'periodically (at least weekly); until then it is read like any other decision file.',
    '',
    '**Citing one:** `DECISIONS §<N>` as before. The numbered log of 2026-09-21 onward keeps its numbers; entries from the',
    'older dated logs are `<date>/<n>` (the n-th entry of that day\'s log).',
    '',
    '| Set | File | Entries | What |',
    '|---|---|---|---|',
    ...SETS.map(([s, name, about]) => `| ${name} | [${s}.md](${s}.md) | ${count.get(s)} | ${about} |`),
    '',
    '## Index (newest first)',
    '',
    '| ID | Date | Set | Title |',
    '|---|---|---|---|',
    ...byId.map(e => `| ${e.id} | ${e.date || ''} | [${e.set}](${e.set}.md) | ${e.title.replace(/\|/g, '\\|')} |`),
    '',
  ];
  fs.writeFileSync(path.join(DIR, 'README.md'), lines.join('\n'));
}

function inboxFiles() {
  if (!fs.existsSync(INBOX)) return [];
  return fs.readdirSync(INBOX).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map(f => path.join(INBOX, f)).sort();
}

// Inbox entries: "### N. [set] title". Returns them with set and title split out; throws on a bad set.
function readInbox() {
  const raw = assignIds(inboxFiles().flatMap(f => extract(f, { numbered: true })));
  return raw.map(e => {
    const m = /^\[([a-z-]+)\]\s*(.*)$/.exec(e.title);
    if (!m || !SET_IDS.has(m[1])) {
      throw new Error(`${e.from}: "${e.id}. ${e.title}" needs a [set] from: ${[...SET_IDS].join(', ')}`);
    }
    return { id: e.id, set: m[1], date: e.date, title: m[2], short: '', from: e.from.replace(/^docs\//, ''), body: e.body };
  });
}

function maxNumber(entries) {
  return entries.reduce((n, e) => {
    const m = /^§(\d+)/.exec(e.id);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
}

function rebuild(all) {
  for (const [set] of SETS) writeSet(set, all.filter(e => e.set === set));
  writeIndex(all);
}

function main(argv) {
  const [cmd, a, b] = argv;
  if (cmd === 'seed') {
    const entries = JSON.parse(fs.readFileSync(a, 'utf8'));
    const sets = new Map(JSON.parse(fs.readFileSync(b, 'utf8')).map(x => [x.id, x]));
    fs.mkdirSync(INBOX, { recursive: true });
    const all = entries.map(e => {
      const c = sets.get(e.id);
      if (!c || !SET_IDS.has(c.set)) throw new Error(`no valid set for ${e.id}`);
      return { id: e.id, set: c.set, date: e.date, title: e.title, short: c.short || '', from: e.from.replace(/^docs\//, ''), body: e.body };
    });
    rebuild(all);
    console.log(`seeded ${all.length} entries`);
    return;
  }
  if (cmd === 'merge') {
    const existing = readAll();
    const incoming = readInbox();
    const ids = new Set(existing.map(e => e.id));
    for (const e of incoming) if (ids.has(e.id)) throw new Error(`${e.from}: ${e.id} is already used`);
    rebuild(existing.concat(incoming));
    for (const f of inboxFiles()) fs.unlinkSync(f);
    console.log(`merged ${incoming.length} inbox entries; ${existing.length + incoming.length} in all`);
    return;
  }
  if (cmd === 'next') {
    let pending = [];
    try { pending = readInbox(); } catch { pending = assignIds(inboxFiles().flatMap(f => extract(f, { numbered: true }))); }
    console.log(maxNumber(readAll().concat(pending)) + 1);
    return;
  }
  if (cmd === 'json') {
    const all = readAll().concat(readInbox());
    const sets = SETS.map(([id, name, about]) => ({ id, name, about }));
    fs.writeFileSync(a, JSON.stringify({ built: new Date().toISOString(), sets, entries: all }));
    console.log(`wrote ${all.length} entries to ${a}`);
    return;
  }
  if (cmd === 'check') {
    readInbox(); // throws on a malformed entry
    const index = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
    const missing = readAll().filter(e => !index.includes(`| ${e.id} |`));
    if (missing.length) throw new Error(`index is stale (${missing.length} entries missing): run npm run decisions:merge`);
    console.log('decisions ok');
    return;
  }
  console.error('usage: build.js merge | next | json <out> | check | seed <entries.json> <sets.json>');
  process.exit(2);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (err) { console.error(err.message); process.exit(1); }
}

module.exports = { SETS, readSet, readAll, readInbox, maxNumber };
