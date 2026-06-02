#!/usr/bin/env node
/**
 * pvp-audit.js — standalone PvP capture auditor for EverQuest (Project Quarm) logs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The wolfpack-logsync agent records PvP kills by matching "Druzzil Ro" god
 * broadcasts and bare [PVP]-channel kill lines. Every one of those patterns
 * REQUIRES the shape `<Name> of <Guild>` — so any kill where the killer or the
 * victim is UNGUILDED is silently dropped, and the broadcast only ever names the
 * KILLING BLOW, never an assist. This tool re-scans the raw logs to surface
 * exactly what the agent would and would NOT have captured, plus "assist"
 * deaths — players you were actively damaging who then died.
 *
 * It is zero-dependency and streams the files line-by-line, so it is safe to run
 * against multi-gigabyte logs.
 *
 * USAGE
 * -----
 *   node pvp-audit.js <folder> [YourCharacterName] [--json out.json]
 *
 *   <folder>            directory containing eqlog_*_pq.proj.txt files
 *   YourCharacterName   optional; if omitted, inferred per-file from the filename
 *   --assist-window N   seconds to correlate your damage → a death (default 30)
 *   --json <path>       also write the full structured findings as JSON
 *
 * OUTPUT
 * ------
 *   A human-readable report to stdout:
 *     1. Files scanned + which character each is.
 *     2. CAPTURED — PvP kills the agent's regexes match (you as killer / victim).
 *     3. MISSED   — PvP-kill-shaped lines that FAIL the agent regexes (the gap),
 *                   grouped by reason (unguilded killer/victim, odd phrasing).
 *     4. ASSISTS  — players you dealt damage to who died within the window but
 *                   whose killing blow the broadcast credits to someone else
 *                   (or to no captured broadcast at all).
 */

'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── The agent's ACTUAL PvP patterns (kept verbatim from wolfpack-logsync) ───
// Path A: god-broadcast wrapper. Path B: bare [PVP]-channel line.
const PVP_BROADCAST_RX          = /^\[(.+?)\]\s+PVP Druzzil Ro BROADCASTS,\s*['"](.+?)['"]\s*$/;
const PVP_PLAYER_KILL_RX        = /^(\w+) of <(.+?)> has been killed in combat by (\w+) of <(.+?)> in (.+?)!$/;
const PVP_NPC_KILL_RX           = /^(\w+) of <(.+?)> has died to (.+?) in combat in (.+?)!$/;
const PVP_PLAYER_KILL_ACTIVE_RX = /^(\w+) of <(.+?)> has killed (\w+) of <(.+?)> in (.+?)!$/;
const PVP_BOSS_KILL_ACTIVE_RX   = /^(\w+) of <(.+?)> has killed (.+?)(?: in (.+?))?!$/;
const PVP_BARE_PLAYER_RX        = /^\[(.+?)\]\s+(?:\[PVP\]\s+)?(\w+) of <(.+?)> has been killed in combat by (\w+) of <(.+?)> in (.+?)!$/;
const PVP_BARE_NPC_RX           = /^\[(.+?)\]\s+(?:\[PVP\]\s+)?(\w+) of <(.+?)> has died to (.+?) in combat in (.+?)!$/;
const PVP_BARE_PLAYER_ACTIVE_RX = /^\[(.+?)\]\s+(?:\[PVP\]\s+)?(\w+) of <(.+?)> has killed (\w+) of <(.+?)> in (.+?)!$/;

// ── LOOSE detectors — find anything that LOOKS like a PvP kill/death so we can
// test it against the strict agent regexes above. A loose hit that fails every
// strict pattern is a CAPTURE GAP.
const LOOSE_PVP_RX = /\bhas been killed in combat by\b|\bhas killed\b|\bhas died to .*\bin combat\b/i;

// ── Your outbound damage to another entity (for assist correlation). EQ melee/
// spell outbound lines start with "You". Captures the target name + amount.
//   "You crush Bob for 142 points of damage."
//   "You pierce Bob for 0 points of damage."  (still counts as engagement)
//   "Your <spell> hits Bob for 88 points of non-melee damage."
const YOU_MELEE_RX = /^\[(.+?)\]\s+You (?:hit|slash|crush|pierce|kick|bash|backstab|bite|claw|gore|maul|punch|round ?kick|strike|slam|sting)s? (\w[\w'`]*) for (\d+) points? of damage/i;
const YOU_NONMELEE_RX = /^\[(.+?)\]\s+Your .*? (\w[\w'`]*) for (\d+) points? of non-?melee damage/i;

// ── Generic death lines (covers non-broadcast deaths so assists can resolve a
// victim's death even when there is no Druzzil broadcast at all).
//   "Bob has been slain by Hitya!"
//   "Bob died."
const SLAIN_RX = /^\[(.+?)\]\s+(\w[\w'`]*) has been slain by (\w[\w'`]*)!/;
const DIED_RX  = /^\[(.+?)\]\s+(\w[\w'`]*) (?:has been killed in combat|died)\b/;

function parseTs(line) {
  const m = /^\[(.+?)\]/.exec(line);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function characterFromFilename(file) {
  const m = /eqlog_([A-Za-z]+)_/.exec(path.basename(file));
  return m ? m[1] : null;
}

// Test a (possibly Druzzil-wrapped) kill body against the strict agent regexes.
// Returns { killer, victim, killerGuild, victimGuild, zone, kind } or null.
function strictMatch(line) {
  const wrap = PVP_BROADCAST_RX.exec(line);
  const body = wrap ? wrap[2] : null;
  if (body) {
    let m;
    if ((m = PVP_PLAYER_KILL_RX.exec(body)))        return { victim: m[1], victimGuild: m[2], killer: m[3], killerGuild: m[4], zone: m[5], kind: 'player', via: 'broadcast' };
    if ((m = PVP_PLAYER_KILL_ACTIVE_RX.exec(body))) return { killer: m[1], killerGuild: m[2], victim: m[3], victimGuild: m[4], zone: m[5], kind: 'player', via: 'broadcast' };
    if ((m = PVP_NPC_KILL_RX.exec(body)))           return { victim: m[1], victimGuild: m[2], killer: null, killerGuild: null, zone: m[4], kind: 'npc', via: 'broadcast' };
    if ((m = PVP_BOSS_KILL_ACTIVE_RX.exec(body)))   return { killer: m[1], killerGuild: m[2], victim: m[3], victimGuild: null, zone: m[4] || null, kind: 'boss', via: 'broadcast' };
    return null; // wrapper matched, inner did not → agent drops it
  }
  // Bare [PVP] line
  let m;
  if ((m = PVP_BARE_PLAYER_RX.exec(line)))        return { victim: m[2], victimGuild: m[3], killer: m[4], killerGuild: m[5], zone: m[6], kind: 'player', via: 'bare' };
  if ((m = PVP_BARE_PLAYER_ACTIVE_RX.exec(line))) return { killer: m[2], killerGuild: m[3], victim: m[4], victimGuild: m[5], zone: m[6], kind: 'player', via: 'bare' };
  if ((m = PVP_BARE_NPC_RX.exec(line)))           return { victim: m[2], victimGuild: m[3], killer: null, killerGuild: null, zone: m[4], kind: 'npc', via: 'bare' };
  return null;
}

// Classify WHY a loose PvP line failed the strict regexes.
function gapReason(line) {
  const body = (PVP_BROADCAST_RX.exec(line) || [])[2] || line.replace(/^\[.+?\]\s+(?:\[PVP\]\s+)?/, '');
  if (/\bhas been killed in combat by\b/.test(body) || /\bhas killed\b/.test(body) || /\bhas died to\b/.test(body)) {
    // The strict regexes demand "<Name> of <Guild>". If a participant has no
    // " of <...>" segment they are unguilded and get dropped.
    const ofGuildCount = (body.match(/\bof <[^>]+>/g) || []).length;
    if (!/\bof </.test(body)) return 'no "of <Guild>" on either side — both unguilded (most common miss)';
    if (/\bhas been killed in combat by\b/.test(body) && ofGuildCount < 2) return 'one side unguilded (killer or victim has no <Guild>)';
    if (/\bhas killed\b/.test(body) && ofGuildCount < 1) return 'killer unguilded';
    return 'phrasing/format the agent regexes do not cover';
  }
  return 'loose match, unclassified';
}

async function scanFile(file, fixedChar, state) {
  const me = (fixedChar || characterFromFilename(file) || '').toLowerCase();
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;

    // 1) PvP kill/death lines
    if (LOOSE_PVP_RX.test(line)) {
      const strict = strictMatch(line);
      if (strict) {
        state.captured.push({ file, ...strict, line: line.trim() });
      } else {
        state.missed.push({ file, reason: gapReason(line), line: line.trim() });
      }
    }

    // 2) Your outbound damage → engagement map (for assist correlation)
    let dm = YOU_MELEE_RX.exec(line) || YOU_NONMELEE_RX.exec(line);
    if (dm && me) {
      const target = dm[2].toLowerCase();
      const ts = parseTs(line);
      const cur = state.engaged.get(target);
      if (!cur || ts > cur.lastTs) state.engaged.set(target, { lastTs: ts, by: me, sample: line.trim() });
    }

    // 3) Death lines (any) → for assist resolution
    let dx = SLAIN_RX.exec(line);
    if (dx) {
      state.deaths.push({ ts: parseTs(line), victim: dx[2].toLowerCase(), killer: dx[3].toLowerCase(), line: line.trim(), file });
    }
  }
}

function correlateAssists(state, windowSec) {
  const windowMs = windowSec * 1000;
  const assists = [];
  for (const d of state.deaths) {
    const eng = state.engaged.get(d.victim);
    if (!eng || eng.lastTs == null || d.ts == null) continue;
    const dt = d.ts - eng.lastTs;
    if (dt >= 0 && dt <= windowMs) {
      // You were damaging this victim shortly before they died. If you weren't
      // the named killer, this is an UN-CREDITED assist.
      if (d.killer !== eng.by) {
        assists.push({ victim: d.victim, yourChar: eng.by, killer: d.killer, gapSec: Math.round(dt / 1000), death: d.line, yourHit: eng.sample });
      }
    }
  }
  return assists;
}

async function main() {
  const args = process.argv.slice(2);
  const folder = args[0] || '.';
  let fixedChar = null, jsonOut = null, windowSec = 30;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--json') jsonOut = args[++i];
    else if (args[i] === '--assist-window') windowSec = parseInt(args[++i], 10) || 30;
    else if (!args[i].startsWith('--')) fixedChar = args[i];
  }

  let files;
  try { files = fs.readdirSync(folder).filter(f => /^eqlog_.*\.txt$/i.test(f)).map(f => path.join(folder, f)); }
  catch (e) { console.error('Cannot read folder:', folder, e.message); process.exit(1); }
  if (files.length === 0) { console.error('No eqlog_*.txt files found in', folder); process.exit(1); }

  const state = { captured: [], missed: [], deaths: [], engaged: new Map() };
  console.error(`Scanning ${files.length} file(s) in ${folder} …`);
  for (const f of files) {
    const sz = (fs.statSync(f).size / 1e6).toFixed(0);
    console.error(`  • ${path.basename(f)} (${sz} MB)`);
    await scanFile(f, fixedChar, state);
  }
  const assists = correlateAssists(state, windowSec);

  // ── Report ────────────────────────────────────────────────────────────────
  const youKills = state.captured.filter(c => c.killer && fixedChar ? c.killer.toLowerCase() === fixedChar.toLowerCase() : false);
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(' PvP CAPTURE AUDIT');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`Files scanned          : ${files.length}`);
  console.log(`Captured PvP lines     : ${state.captured.length}  (agent regexes match → would upload)`);
  console.log(`MISSED PvP-shaped lines : ${state.missed.length}  (look like kills, FAIL agent regexes → gap)`);
  console.log(`Death lines seen        : ${state.deaths.length}`);
  console.log(`Un-credited assist hits : ${assists.length}  (you damaged victim ≤${windowSec}s before death, killing blow credited elsewhere)`);

  if (state.missed.length) {
    console.log('\n── MISSED (the capture gap) ─────────────────────────────');
    const byReason = {};
    for (const m of state.missed) (byReason[m.reason] = byReason[m.reason] || []).push(m);
    for (const [reason, rows] of Object.entries(byReason).sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  [${rows.length}] ${reason}`);
      for (const r of rows.slice(0, 8)) console.log(`      ${r.line}`);
      if (rows.length > 8) console.log(`      … +${rows.length - 8} more`);
    }
  }

  if (assists.length) {
    console.log('\n── ASSISTS (deaths you contributed to, not credited) ────');
    for (const a of assists.slice(0, 25)) {
      console.log(`  ${a.yourChar} hit ${a.victim}, who died ${a.gapSec}s later to ${a.killer || '?'}`);
      console.log(`      death: ${a.death}`);
    }
    if (assists.length > 25) console.log(`  … +${assists.length - 25} more`);
  }

  console.log('\n── NEXT STEPS ───────────────────────────────────────────');
  console.log('  • If most MISSES are "unguilded": the agent regexes hard-require');
    console.log('    "<Name> of <Guild>". Unguilded kills/deaths can never be captured');
    console.log('    live OR via --since backfill until those patterns are relaxed.');
  console.log('  • ASSISTS cannot come from broadcasts at all — they require your own');
  console.log('    combat lines, which the agent does not currently mine for PvP credit.');
  console.log('  • To capture history, the agent must run `--since <ISO>` over this log;');
  console.log('    live tailing only sees new lines from the end of the file.');

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ files, captured: state.captured, missed: state.missed, assists }, null, 2));
    console.log(`\nFull findings written to ${jsonOut}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
