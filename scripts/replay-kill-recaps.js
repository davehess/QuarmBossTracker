#!/usr/bin/env node
// scripts/replay-kill-recaps.js — what would the kill recap have said, replayed on past fights.
//
// READ-ONLY. It posts nothing, writes no database row and opens no connection: it reads a JSON dump and runs
// the SHIPPED utils/killRecap.js (assembleInputs + buildRecap + recapFieldValue) on it, once per confirmed
// kill in time order, with the priors limited to the kills BEFORE it, i.e. "as if it were that moment".
//
//   node scripts/replay-kill-recaps.js --sql-json <dump.json> [--since 2026-10-04] [--boss grummus]
//
// The dump is one JSON object of table rows (query them read-only, e.g. through the Supabase MCP):
//   roster       ["name", ...]                                      lowercased `characters.name`
//   encounters   [{ id, npc_id, boss, started_at, ended_at, duration_sec, classification, data_incomplete }]
//                `boss` = the bosses.json id; only confirmed kills (ended_at set) of the bosses to replay
//   players      [{ encounter_id, character_name, total_damage }]   encounter_players for those encounters
//   contribs     [{ encounter_id, deaths, dur }]                    contributions' raw_parse->deaths / ->duration
//   fun          [{ event_type, caster, event_ts }]                 fun_events around the kills
// Usage errors exit 2.

'use strict';

const fs = require('fs');
const path = require('path');
const kr = require('../utils/killRecap');

function parseArgs(argv) {
  const a = { since: '2026-10-04T00:00:00Z', file: null, boss: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sql-json') a.file = argv[++i];
    else if (argv[i] === '--since') a.since = argv[++i];
    else if (argv[i] === '--boss') a.boss = argv[++i];
    else { console.error(`unknown argument: ${argv[i]}`); process.exit(2); }
  }
  if (!a.file) { console.error('usage: replay-kill-recaps.js --sql-json <dump.json> [--since ISO] [--boss <bosses.json id>]'); process.exit(2); }
  return a;
}

const et = (t) => new Date(t).toLocaleString('en-US', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York',
});

function replay(dump, { since, boss }) {
  const names = new Map(require('../data/bosses.json').map(b => [b.id, b.name]));
  const sinceMs = Date.parse(since);
  const roster = new Set((dump.roster || []).map(n => String(n).toLowerCase()));
  const playersBy = new Map();
  for (const p of dump.players || []) {
    const l = playersBy.get(p.encounter_id) || [];
    l.push(p);
    playersBy.set(p.encounter_id, l);
  }
  const contribsBy = new Map();
  for (const c of dump.contribs || []) {
    const l = contribsBy.get(c.encounter_id) || [];
    l.push(c);
    contribsBy.set(c.encounter_id, l);
  }
  const encs = (dump.encounters || []).filter(e => e.ended_at).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  const out = [];
  for (const kill of encs) {
    if (Date.parse(kill.started_at) < sinceMs || (boss && kill.boss !== boss)) continue;
    const priorEncs = encs.filter(e => e.npc_id === kill.npc_id && Date.parse(e.started_at) < Date.parse(kill.started_at));
    const priorIds = new Set(priorEncs.map(e => e.id));
    const rows = {
      roster,
      kill,
      killPlayers: playersBy.get(kill.id) || [],
      killContribs: contribsBy.get(kill.id) || [],
      priorEncs,
      priorPlayers: [...priorIds].flatMap(id => playersBy.get(id) || []),
      priorContribs: [...priorIds].flatMap(id => contribsBy.get(id) || []),
      funRows: dump.fun || [],
    };
    const bossName = names.get(kill.boss) || kill.boss;
    const input = kr.assembleInputs(rows, { bossName });
    const raiders = input ? input.players.length : (rows.killPlayers || []).filter(p => roster.has(String(p.character_name).toLowerCase())).length;
    const head = `[${et(kill.started_at)} ET] ${bossName} — ${kill.duration_sec}s, ${raiders} raiders${kill.classification ? `, classified "${kill.classification}"` : ''}`;
    const recap = input ? kr.buildRecap(input) : null;
    out.push({ head, text: recap ? kr.recapFieldValue(recap) : null, raiders, recap });
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dump = JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8'));
  const results = replay(dump, args);
  let shown = 0, skipped = 0;
  for (const r of results) {
    // A 1-3 player pull of a named mob is not a raid kill; list the count, not a block per pull.
    if (!r.text) { skipped += 1; continue; }
    shown += 1;
    console.log(r.head);
    console.log(r.text.split('\n').map(l => `    ${l}`).join('\n'));
    console.log('');
  }
  console.log(`-- ${shown} recaps, ${skipped} kills with no recap (fewer than ${kr.MIN_RAIDERS} raiders, classified, or incomplete) --`);
}

if (require.main === module) main();
module.exports = { replay };
