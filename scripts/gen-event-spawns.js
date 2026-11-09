#!/usr/bin/env node
// Builds data/event-spawns.json (and its byte-identical copy web/lib/eventSpawns.json) from the Planes of Power
// event scripts in the server's public quest repo. See utils/eventSpawnParse.js for what is read and why.
//
//   node scripts/gen-event-spawns.js               shallow-fetches QUESTS_SHA into the OS temp dir, parses, writes
//   node scripts/gen-event-spawns.js --repo <dir>  reads an existing checkout (its HEAD becomes `quests_sha`)
//
// Pinned on purpose: a rerun on the same commit gives the same bytes (no timestamp). To move the pin, set QUESTS_SHA
// to the new head of https://github.com/SecretsOTheP/quests (main) and rerun; the diff is the scripts' change.
// The web copy exists because web/ imports nothing from outside web/ (Vercel's ignoreCommand).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseScript } = require('../utils/eventSpawnParse');

const REPO_URL = 'https://github.com/SecretsOTheP/quests.git';
const QUESTS_SHA = '60e979f34e96b4d98b5e566139c2471e00259d0f';
const ZONES = ['powater', 'pofire', 'poair', 'poeartha', 'poearthb'];
// scripts outside <zone>/encounters/ that spawn event mobs
const EXTRA = {
  poair: ['POACastellanController.lua', 'A_Castellan_of_Air.lua'],
  poeartha: ['arbitor_guy.lua'],
};
const OUT = [path.join(__dirname, '..', 'data', 'event-spawns.json'), path.join(__dirname, '..', 'web', 'lib', 'eventSpawns.json')];

function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

function checkout() {
  const i = process.argv.indexOf('--repo');
  if (i > 0 && process.argv[i + 1]) {
    const dir = path.resolve(process.argv[i + 1]);
    return { dir, sha: git(dir, 'rev-parse', 'HEAD') };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quests-'));
  git(dir, 'init', '-q');
  git(dir, 'fetch', '-q', '--depth', '1', REPO_URL, QUESTS_SHA);
  git(dir, 'checkout', '-q', 'FETCH_HEAD');
  return { dir, sha: QUESTS_SHA };
}

function main() {
  const { dir, sha } = checkout();
  const zones = {};
  const npcIds = {};
  const unresolved = [];
  for (const zone of ZONES) {
    const files = [];
    const encDir = path.join(dir, zone, 'encounters');
    if (fs.existsSync(encDir)) for (const f of fs.readdirSync(encDir).sort()) if (f.endsWith('.lua')) files.push(`${zone}/encounters/${f}`);
    for (const f of EXTRA[zone] || []) if (fs.existsSync(path.join(dir, zone, f))) files.push(`${zone}/${f}`);
    const entries = [];
    const ids = new Set();
    for (const script of files) {
      const res = parseScript(fs.readFileSync(path.join(dir, script), 'utf8'), { zone, script });
      entries.push(...res.entries);
      unresolved.push(...res.unresolved);
      for (const id of res.type_ids) ids.add(id);
      for (const e of res.entries) ids.add(e.npc_id);
    }
    zones[zone] = entries;
    npcIds[zone] = [...ids].sort((a, b) => a - b);
  }
  const json = `${JSON.stringify({ quests_sha: sha, zones, npc_ids: npcIds, unresolved }, null, 1)}\n`;
  for (const out of OUT) fs.writeFileSync(out, json);

  for (const zone of ZONES) {
    const e = zones[zone];
    const spots = new Set(e.filter(x => x.kind !== 'relative').map(x => `${x.x},${x.y},${x.z}`));
    const placed = new Set(e.filter(x => x.kind !== 'relative').map(x => x.npc_id));
    console.log(`${zone.padEnd(9)} fixed/table entries ${String(e.filter(x => x.kind !== 'relative').length).padStart(4)}  distinct spots ${String(spots.size).padStart(3)}  `
      + `relative ${String(e.filter(x => x.kind === 'relative').length).padStart(3)}  npc types placed ${String(placed.size).padStart(3)} of ${npcIds[zone].length}`);
  }
  for (const u of unresolved) console.log(`unresolved table: ${u.script}:${u.line} ${u.table} (${u.rows} rows)`);
  console.log(`quests_sha ${sha}`);
}

main();
