#!/usr/bin/env node
'use strict';
// wowlogsync -- Classic-era World of Warcraft combat-log reader for the Wolf Pack platform. Zero dependencies.
//
// A separate program from wolfpack-logsync on purpose (the guild lead, 2026-10-19): a WoW fix never rides the
// EverQuest fleet's update chain, and this reader owns its own allow-list. It posts the SAME envelope the EverQuest
// agent posts to POST /api/agent/encounter, plus `game: 'wow'`, with the bot's per-user session token.
//
// Run:   node index.js --log "C:\...\World of Warcraft\_classic_era_\Logs" --character Name --token wpms_...
//        (a folder means "the newest WoWCombatLog*.txt in it"; turn logging on in game with /combatlog)
// Flags: --log <file|dir>  --character <name>  --token <t>  --bot-url <url>  --config <json>
//        --from-start (read the whole file, not just new lines)  --dry-run (print, send nothing)
//        --no-fallback (only ENCOUNTER_START/END fights)  --wipes (also upload wipes)
// Config file (wowlogsync.config.json beside this file, or --config): { "LogPath", "Character", "Token", "BotUrl" }.
//
// WHAT LEAVES THE PC. Only lines whose event is damage, healing, a death or ENCOUNTER_START/END (core.js ALLOWED);
// every other line is dropped before it is split into fields. From those, per finished fight, the payload carries:
// the boss name and a key built from its encounter or NPC id; start/end times; and per player the character name
// (realm suffix removed), damage dealt (pets folded into owners where the log links them), healing done, and the
// time of each death. It never carries GUIDs, spell names, positions, zone, realm, guild, your account, other
// players' flags, or any line of the log. Chat is not in this log. Other players' character names ARE in it and ARE
// uploaded, as other raiders' damage is in EverQuest (docs/PRIVACY.md, "What other raiders' Mimic records").
//
// Not done in v1: honouring the exclude-from-stats opt-out (the EverQuest agent fetches it from the bot), a UI,
// a log-rotation watcher beyond "re-pick the newest file", and Windows service setup.

const fs = require('fs');
const path = require('path');
const { parseLine, FightTracker, buildPayload } = require('./core');

let VERSION = '0.1.0';
try { VERSION = require('./package.json').version || VERSION; } catch { /* run from a loose copy */ }
const DEFAULT_BOT_URL = process.env.WOLFPACK_BOT_URL || 'https://wolfpackparse.up.railway.app/api/agent/encounter';
const QUEUE_FILE = path.join(__dirname, 'wowlogsync.queue.json');
const QUEUE_MAX = 200;
const DRAIN_MS = 15000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;

function parseArgs(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--log') o.log = argv[++i];
    else if (a === '--character') o.character = argv[++i];
    else if (a === '--token') o.token = argv[++i];
    else if (a === '--bot-url') o.botUrl = argv[++i];
    else if (a === '--config') o.config = argv[++i];
    else if (a === '--from-start') o.fromStart = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--no-fallback') o.noFallback = true;
    else if (a === '--wipes') o.wipes = true;
    else if (a === '--version') { console.log(VERSION); process.exit(0); }
    else { console.warn(`[warn] unknown arg: ${a}`); }
  }
  return o;
}

function loadSettings(args) {
  let cfg = {};
  const file = args.config || path.join(__dirname, 'wowlogsync.config.json');
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
    if (args.config) { console.error(`cannot read --config ${file}: ${err.message}`); process.exit(2); }
  }
  return {
    log: args.log || cfg.LogPath,
    character: args.character || cfg.Character,
    token: args.token || cfg.Token || process.env.WOLFPACK_AGENT_TOKEN,
    botUrl: args.botUrl || cfg.BotUrl || DEFAULT_BOT_URL,
  };
}

// A directory means the newest WoWCombatLog*.txt in it (assumed: newer clients write timestamped file names).
function resolveLog(p) {
  try {
    if (!fs.statSync(p).isDirectory()) return p;
    const files = fs.readdirSync(p).filter(n => /^WoWCombatLog.*\.txt$/i.test(n))
      .map(n => ({ f: path.join(p, n), m: fs.statSync(path.join(p, n)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return files[0] ? files[0].f : null;
  } catch { return null; }
}

// ── Durable upload queue (a minimal mirror of the EverQuest agent's) ────────────────────────────────────────────────
// Every upload is persisted before it is sent; 15 s drain; exponential backoff to 10 min; a 4xx other than 408/429
// is a permanent refusal and is dropped; atomic writes.
let queue = [];
function loadQueue() {
  try { const q = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')); queue = Array.isArray(q) ? q : []; } catch { queue = []; }
}
function saveQueue() {
  try { fs.writeFileSync(QUEUE_FILE + '.tmp', JSON.stringify(queue)); fs.renameSync(QUEUE_FILE + '.tmp', QUEUE_FILE); }
  catch (err) { console.warn(`[queue] save failed: ${err.message}`); }
}
function enqueue(payload) {
  queue.push({ queuedAt: Date.now(), tries: 0, nextAt: 0, payload });
  while (queue.length > QUEUE_MAX) queue.shift();
  saveQueue();
}
let draining = false;
async function drain(settings) {
  if (draining || !settings.token) return;
  draining = true;
  try {
    while (queue.length && queue[0].nextAt <= Date.now()) {
      const e = queue[0];
      let res;
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 30000);
        res = await fetch(settings.botUrl, {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
          body: JSON.stringify(e.payload),
        });
        clearTimeout(t);
      } catch (err) { res = null; }
      if (res && res.ok) { queue.shift(); console.log(`[upload] ${e.payload.encounter.boss_name} ok`); saveQueue(); continue; }
      if (res && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        console.warn(`[upload] ${e.payload.encounter.boss_name} refused (${res.status}); dropped`);
        queue.shift(); saveQueue(); continue;
      }
      e.tries++;
      e.nextAt = Date.now() + Math.min(BACKOFF_MAX_MS, 5000 * 2 ** Math.min(e.tries, 8));
      saveQueue();
      break;
    }
  } finally { draining = false; }
}

// ── Tail ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv);
  const settings = loadSettings(args);
  if (!settings.log || !settings.character || (!settings.token && !args.dryRun)) {
    console.error('need --log, --character and --token (or the same in wowlogsync.config.json); see the header of index.js');
    process.exit(2);
  }
  loadQueue();

  const tracker = new FightTracker({
    fallback: !args.noFallback,
    includeWipes: !!args.wipes,
    onFight: summary => {
      const payload = buildPayload(summary, { character: settings.character, version: VERSION });
      console.log(`[fight] ${summary.name} (${summary.key}) ${summary.activeSec}s, ${summary.players.length} players${summary.confirmed ? '' : ', wipe'}`);
      if (args.dryRun) console.log(JSON.stringify(payload, null, 2));
      else enqueue(payload);
    },
  });

  let file = null, pos = 0, carry = Buffer.alloc(0);
  function poll() {
    const next = resolveLog(settings.log);
    if (!next) return;
    if (next !== file) {
      // First file: tail from the end unless asked otherwise. A NEWER file appearing mid-run is read from its start.
      const switched = !!file;
      if (switched) tracker.flush();
      file = next; carry = Buffer.alloc(0);
      pos = (switched || args.fromStart) ? 0 : fs.statSync(file).size;
      console.log(`[log] reading ${file}`);
    }
    let st; try { st = fs.statSync(file); } catch { return; }
    if (st.size < pos) { pos = 0; carry = Buffer.alloc(0); }               // truncated
    if (st.size === pos) return;
    const fd = fs.openSync(file, 'r');
    try {
      while (pos < st.size) {
        const buf = Buffer.alloc(Math.min(1 << 20, st.size - pos));
        const n = fs.readSync(fd, buf, 0, buf.length, pos);
        if (n <= 0) break;
        pos += n;
        const all = Buffer.concat([carry, buf.subarray(0, n)]);
        const nl = all.lastIndexOf(0x0a);
        if (nl < 0) { carry = all; continue; }
        carry = all.subarray(nl + 1);
        const wall = Date.now();
        for (const line of all.subarray(0, nl).toString('utf8').split('\n')) {
          const ev = parseLine(line.replace(/\r$/, ''), wall);
          if (ev) tracker.feed(ev, wall);
        }
      }
    } finally { fs.closeSync(fd); }
  }

  setInterval(() => { try { poll(); tracker.idle(); } catch (err) { console.warn(`[poll] ${err.message}`); } }, 1000);
  if (!args.dryRun) setInterval(() => drain(settings).catch(() => {}), DRAIN_MS);
  console.log(`wowlogsync ${VERSION} watching ${settings.log} as ${settings.character}${args.dryRun ? ' (dry run)' : ''}`);
}

if (require.main === module) main();
module.exports = { parseArgs, resolveLog };
