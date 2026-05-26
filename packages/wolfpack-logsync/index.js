#!/usr/bin/env node
// wolfpack-logsync — Local EQ log filter + upload agent.
//
//   ZERO DEPENDENCIES. Single file. Works with the node bundled in any modern OS.
//   Designed for EQ log files that can be GIGABYTES — never reads existing content.
//
// Quick start:
//
//   wolfpack-logsync --log "A:\\EQ\\eqlog_Hitya_pq.proj.txt" --watch
//
//   # tails the file from end-of-file forward, detects boss kills,
//   # filters out officer chat / tells / private channels LOCALLY,
//   # uploads compact JSON event arrays per encounter to the bot.
//
// Privacy posture: sensitive lines are dropped BEFORE any parsing or buffering.
// Officer chat, tells, /raidsay, [#officer], [guild] — these lines are matched
// at the byte level and skipped immediately. The only thing that leaves your
// machine is a JSON array of combat events (damage / heal / death / cast) with
// channel chatter excluded entirely.
//
// Modes:
//   --watch                       tail forever, upload per-encounter
//   --since "<ISO timestamp>"     backfill from this point (binary-search seek)
//   --until "<ISO timestamp>"     pair with --since
//   --once                        scan once and exit (one-shot mode)
//   --dry-run                     parse and filter, but skip upload (print summary)
//
// Configuration:
//   --log <path>                  REQUIRED. One or more --log flags for multi-character.
//   --bot-url <url>               override default bot upload endpoint
//   --token <token>               shared secret for upload (or env: WOLFPACK_TOKEN)
//   --character <name>            override character (default: parse from filename)
//   --config <path>               JSON config with channel filters, paths, etc.
//
// Output (one JSON object per upload, posted as application/json):
//   {
//     "agent_version": "0.1.0",
//     "character": "Hitya",
//     "encounter": {
//       "started_at": "<ISO>",
//       "ended_at":   "<ISO>",
//       "boss_name":  "Lord Nagafen",       // best-effort, may be null
//       "events": [
//         {"ts":"<ISO>","type":"damage","attacker":"Hitya","defender":"Lord Nagafen","ability":"Backstab","amount":1830},
//         ...
//       ]
//     }
//   }

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const AGENT_VERSION = '0.1.0';
const DEFAULT_BOT_URL = process.env.WOLFPACK_BOT_URL || 'https://wolfpackparse.up.railway.app/api/agent/encounter';

// ── CLI args ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { logs: [], flags: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--log')        out.logs.push(argv[++i]);
    else if (a === '--watch') out.flags.watch = true;
    else if (a === '--once')  out.flags.once = true;
    else if (a === '--dry-run') out.flags.dryRun = true;
    else if (a === '--since') out.flags.since = argv[++i];
    else if (a === '--until') out.flags.until = argv[++i];
    else if (a === '--bot-url') out.flags.botUrl = argv[++i];
    else if (a === '--token')   out.flags.token  = argv[++i];
    else if (a === '--character') out.flags.character = argv[++i];
    else if (a === '--config')    out.flags.config = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (a === '--version') { console.log(AGENT_VERSION); process.exit(0); }
    else console.warn(`[warn] unknown arg: ${a}`);
  }
  return out;
}

function printHelp() {
  console.log(`
wolfpack-logsync v${AGENT_VERSION}

Usage:
  wolfpack-logsync --log <path> [--log <path2> ...] [options]

Required:
  --log <path>           path to EQ log file (repeatable)

Modes (pick one):
  --watch                tail forever (default mode for live raid)
  --since "<iso>"        backfill from timestamp (e.g. "2026-05-25T20:00:00")
  --once                 process current end-of-file once and exit

Options:
  --bot-url <url>        bot upload endpoint (default: env WOLFPACK_BOT_URL)
  --token <token>        upload shared secret (default: env WOLFPACK_TOKEN)
  --character <name>     override character (default: parse from filename)
  --config <json-path>   custom config file with channel filters
  --dry-run              don't upload — print encounter summaries instead
  -h, --help             this help
  --version              print version

Privacy:
  All filtering happens BEFORE any upload. Officer chat, tells, guild chat,
  private channels are dropped at the byte level. The only data uploaded is
  a JSON array of combat events scoped to detected boss encounters.
`);
}

// ── Config ───────────────────────────────────────────────────────────────────
// These regexes match RAW log lines that should never be parsed, much less
// uploaded. Match-and-discard happens before any other processing.
//
// Tightened against real Quarm log samples (Dec 2025). Reasoning per pattern:
//   - "tells you, '..." catches both player /tell and NPC merchant chat — all OK to drop
//   - "tells the guild, '..." matches /g (`Cory tells the guild, '...'`)
//   - "You say to your guild," matches outgoing /g
//   - "tells <ChannelName>:N, '..." matches custom channels (Wolfpackofficer, Lfg, Ports, General)
//     this is the critical privacy filter — Wolfpackofficer is the officer channel
//   - "Channels:" lines reveal channel names — filtered for cleanliness
//   - "says, '..." and "says out of character, '..." are public — filtered because they're
//     never useful for combat parsing (and we don't want random local chat in the upload)
const DEFAULT_DROP_PATTERNS = [
  // Officer / sensitive channels (these are the privacy-critical ones)
  /\bWolfpackofficer\b/i,             // catch any line referencing the officer channel
  /\btells\s+Wolfpackofficer:/i,      // outgoing officer
  /\btells\s+\w+:\d+,\s*['"]/i,       // ALL custom channel tells (Lfg:3, Ports:4, General:2, etc.)
  /\bsay to your officer,/i,          // /officer (built-in)

  // Tells (incoming + outgoing) — includes merchant NPC chat which is verbose noise
  /\btells you,\s*['"]/i,
  /\byou told \w+,\s*['"]/i,

  // Guild chat both directions
  /\btells the guild,\s*['"]/i,
  /^\[.+\]\s+You say to your guild,/i,

  // Group chat both directions
  /\btells the group,\s*['"]/i,
  /^\[.+\]\s+You say to your group,/i,

  // Raid chat both directions
  /\btells the raid,\s*['"]/i,
  /^\[.+\]\s+You say to your raid,/i,

  // Public chat (allowed in principle, but not combat-relevant so we drop)
  /\bsays?,\s*['"]/i,
  /\bsays out of character,\s*['"]/i,
  /\bshouts?,\s*['"]/i,
  /\bauctions?,\s*['"]/i,

  // System / housekeeping
  /^\[.+\]\s+Channels:\s/i,           // channel listing dumps
  /^\[.+\]\s+\[AFK Kick\]/i,          // AFK system spam
  /^\[.+\]\s+Welcome to /i,
  /^\[.+\]\s+MESSAGE OF THE DAY/i,
  /^\[.+\]\s+Autojoining channels/i,

  // Item self-damage — HP→mana conversions and similar clicky effects.
  // These show up as "You have taken N points of damage" with a flavour text prefix.
  // They are NOT combat events; dropping them prevents them from inflating totals or
  // being misidentified as DoT ticks on the player.
  //
  //   Manastone / Manarobe (Manaconvert):
  //     "You feel your life force draining into your mind. You have taken 60 points of damage."
  /you feel your life force draining into your mind/i,
  //
  //   Generic "You have taken N points of damage" — catches all remaining flavours
  //   (diseased, cursed, other item procs that deal self-damage for a benefit).
  //   Note: NPC DoT ticks say "X has taken N" (third person), so this first-person
  //   form is safe to drop without losing any mob-damage data.
  /\byou have taken \d+ points? of damage/i,
];

// Lines we KEEP (positive list — combat events). Anything not matching here
// AND not matching a drop pattern is dropped silently.
//
// Real-world Quarm log line shapes (verified Dec 2025):
//   [Fri Dec 19 16:02:04 2025] Wulvgeng hits orc centurion for 47 points of damage.
//   [Fri Dec 19 16:02:04 2025] Orc centurion hits Mellwar for 12 points of damage.
//   [Fri Dec 19 15:50:22 2025] You were hit by non-melee for 27 damage.
//   [Fri Dec 19 17:27:34 2025] Nafse hit Nafse for 148 points of non-melee damage.
//   [Fri Dec 19 17:30:45 2025] You have slain a spiderling!
//   [Fri Dec 19 15:50:48 2025] You died.
//   [Fri Dec 19 20:13:09 2025] You have been diseased.  You have taken 11 points of damage.
//   [Fri Dec 19 16:53:59 2025] Fittir Scores a critical hit!(70)
//   [Fri Dec 19 16:00:00 2025] You begin casting Minor Shielding.
//   [Fri Dec 19 15:46:53 2025] Nonnie Texaker begins to cast a spell.
const KEEP_PATTERNS = [
  /\bfor \d+ points? of damage/i,
  /\bfor \d+ \(\d+\) points? of damage/i,
  /\bfor \d+ damage\b/i,                          // "non-melee for 27 damage" (no "points of")
  /\bfor \d+ points? of non-melee damage/i,       // "for 148 points of non-melee damage"
  /\bScores? a critical hit!/i,                   // crit announcement, attaches to prior damage
  /\bhas been slain by/i,
  /\byou have slain /i,
  /^\[.+\]\s+You died\./i,                        // /death of self
  /\bdies\./i,
  /\bhas been knocked unconscious/i,
  /\bhas taken \d+ points? of damage/i,           // DoT ticks
  /\bfor \d+ points? of (mana|stamina|hit points|endurance)/i,
  /\bhas been healed/i,
  /\byou begin casting/i,
  /\bbegins? to cast/i,
  /\byou cast /i,
  /\bresisted your/i,
  /\byour .+ has worn off/i,
  /\bhas fainted/i,
];

// EQ timestamp parser
// Format: [Fri May 24 20:35:01 2024]
const TS_RX = /^\[(\w+ \w+ \d+ \d+:\d+:\d+ \d+)\]/;
function parseEqTimestamp(line) {
  const m = line.match(TS_RX);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d.getTime()) ? null : d;
}

// ── Filter (the privacy layer) ──────────────────────────────────────────────
// Returns true if the line should be KEPT for further processing.
function shouldKeep(line, drops = DEFAULT_DROP_PATTERNS, keeps = KEEP_PATTERNS) {
  // Drop list wins — if any drop pattern matches, line is gone immediately.
  for (const rx of drops) if (rx.test(line)) return false;
  // Then keep list — only positively-identified combat lines are kept.
  for (const rx of keeps) if (rx.test(line)) return true;
  return false;
}

// ── Event parser ────────────────────────────────────────────────────────────
// Turn a kept line into a structured event. Returns null if we can't parse it.
// This is intentionally conservative — unparseable lines are dropped silently
// rather than uploaded as opaque junk.
function parseEvent(line, ts) {
  const tsIso = ts?.toISOString();

  // ── Damage events ─────────────────────────────────────────────────────────
  // EQ uses different verbs for melee (slash/crush/pierce/etc.) and 'hits' for
  // generic / weapon attacks. We capture the verb as the ability name — the
  // analytics layer can distinguish "kick/bash/backstab" specials from basic
  // melee later.

  // "Your <Ability> hits/strikes X for N points of damage." (spell or special attack)
  let m = line.match(/\]\s+Your\s+(.+?)\s+(?:hits?|strikes?)\s+(.+?)\s+for\s+(\d+)(?:\s+\((\d+)\))?\s+points?\s+of\s+(?:non-melee\s+)?damage/i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: null /* self */, defender: m[2], ability: m[1], amount: parseInt(m[3], 10) };
  }

  // "<Name>'s <Spell> hits/strikes X for N points of damage." (third-party spell)
  m = line.match(/\]\s+(\S+(?:`s|'s))\s+(.+?)\s+(?:hits?|strikes?)\s+(.+?)\s+for\s+(\d+)(?:\s+\((\d+)\))?\s+points?\s+of\s+(?:non-melee\s+)?damage/i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: m[1].replace(/['`]s$/, ''), defender: m[3], ability: m[2], amount: parseInt(m[4], 10) };
  }

  // Attack verbs in EQ. Comprehensive list covering player abilities and the
  // race/model-specific NPC verbs (bite/peck/claw/gore/slam/sting/tail-whip…).
  // Add new verbs here when you find them in logs — the rest of the parser
  // doesn't need to change.
  //
  // The alternation includes BOTH base forms and -s/-es third-person forms
  // because "Klickbate crushes" and "You crush" are both valid log lines.
  //
  // Ranged weapons (archery / throwing):
  //   "Soandso shoots Lord Nagafen for 245 points of damage."  → shoots
  //   "You throw a dagger at Nagafen for 112 points of damage." → throws (rare)
  //   "You fire an arrow at Nagafen for ..." → fires (some server variants)
  // These were previously caught by KEEP_PATTERNS (matched for \d+ points of damage)
  // but parseEvent returned null because the verbs weren't in this list, causing
  // Ranger bow damage to be silently dropped.
  const ATTACK_VERBS_RX =
    '(?:hits?|slashes?|crushes?|pierces?|punches?|kicks?|bashes?|backstabs?|' +
    'bites?|claws?|gores?|mauls?|slams?|smashes?|pecks?|gnaws?|stings?|' +
    'tramples?|snaps?|stomps?|chomps?|swings?|tears?|rends?|spits?|' +
    'swipes?|buffets?|thrashes?|mangles?|pummels?|whips?|tail-whips?|' +
    'jabs?|strikes?|chops?|slices?|hacks?|thrusts?|gouges?|lashes?|' +
    'sweeps?|slashes?|stabs?|raps?|smites?|bludgeons?|crunches?|nicks?|' +
    'slices?|stomps?|tail-slaps?|tail-swipes?|tail-thrashes?|' +
    'shoots?|fires?|throws?|flings?|' +                   // ranged: archery, throwing
    'hit|slash|crush|pierce|punch|kick|bash|backstab)';   // bare past-tense fallback

  // "You <verb> X for N points of damage." (player attacking, second-person)
  m = line.match(new RegExp(`\\]\\s+You\\s+${ATTACK_VERBS_RX}\\s+(.+?)\\s+for\\s+(\\d+)(?:\\s+\\((\\d+)\\))?\\s+points?\\s+of\\s+(?:non-melee\\s+)?damage`, 'i'));
  if (m) {
    const verb = m[0].match(new RegExp(`\\bYou\\s+(${ATTACK_VERBS_RX})\\b`, 'i'))?.[1] || 'hit';
    return { ts: tsIso, type: 'damage', attacker: null /* self */, defender: m[1], ability: verb.toLowerCase().replace(/(?:sh|ch|ss|x)es$/, m => m.slice(0, -2)).replace(/s$/, ''), amount: parseInt(m[2], 10) };
  }

  // "<Name> <verb> X for N points of damage." (third-person; everyone else)
  // The greedy-then-lazy structure works because the verb list is anchored
  // with word boundaries — so "A grikbar kobold hits YOU" parses as:
  //   attacker = "A grikbar kobold", verb = "hits", defender = "YOU"
  m = line.match(new RegExp(`\\]\\s+(.+?)\\s+${ATTACK_VERBS_RX}\\s+(.+?)\\s+for\\s+(\\d+)(?:\\s+\\((\\d+)\\))?\\s+points?\\s+of\\s+(?:non-melee\\s+)?damage`, 'i'));
  if (m) {
    // Extract the verb that matched (it's between the two captures)
    const verbMatch = m[0].match(new RegExp(`\\s+(${ATTACK_VERBS_RX})\\s+`, 'i'));
    const verb = (verbMatch?.[1] || 'hit').toLowerCase().replace(/(?:sh|ch|ss|x)es$/, m => m.slice(0, -2)).replace(/s$/, '');
    return { ts: tsIso, type: 'damage', attacker: m[1], defender: m[2], ability: verb, amount: parseInt(m[3], 10) };
  }

  // "You hit X for N points of non-melee damage." (DoT/proc third-person past-tense)
  m = line.match(/\]\s+(.+?)\s+hit\s+(.+?)\s+for\s+(\d+)\s+points?\s+of\s+non-melee\s+damage/i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: m[1], defender: m[2], ability: 'non-melee', amount: parseInt(m[3], 10) };
  }

  // "You were hit by non-melee for N damage." (environmental / unsourced)
  m = line.match(/\]\s+(You|\S+)\s+(?:was|were)\s+hit\s+by\s+(.+?)\s+for\s+(\d+)\s+damage/i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: null, defender: m[1] === 'You' ? null : m[1], ability: m[2], amount: parseInt(m[3], 10) };
  }

  // "X has taken N points of damage." (DoT tick)
  m = line.match(/\]\s+(.+?)\s+has(?:\s+been\s+\w+\.\s+\1)?\s+taken\s+(\d+)\s+points?\s+of\s+damage/i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: null, defender: m[1], ability: 'dot', amount: parseInt(m[2], 10) };
  }

  // "X Scores a critical hit!(N)" — the (N) is the BONUS amount on top of the preceding hit
  m = line.match(/\]\s+(.+?)\s+[Ss]cores?\s+a\s+critical\s+hit!\s*\((\d+)\)/);
  if (m) {
    return { ts: tsIso, type: 'critical', attacker: m[1], amount: parseInt(m[2], 10) };
  }

  // ── Death events ──────────────────────────────────────────────────────────
  m = line.match(/\]\s+(.+?)\s+has been slain by (.+?)!/i);
  if (m) {
    return { ts: tsIso, type: 'death', defender: m[1], attacker: m[2] };
  }
  m = line.match(/\]\s+You have slain\s+(.+?)!/i);
  if (m) {
    return { ts: tsIso, type: 'death', defender: m[1], attacker: null /* self */ };
  }
  m = line.match(/\]\s+(.+?)\s+dies\./i);
  if (m) {
    return { ts: tsIso, type: 'death', defender: m[1], attacker: null };
  }
  m = line.match(/\]\s+You died\./i);
  if (m) {
    return { ts: tsIso, type: 'death', defender: null /* self */, attacker: null };
  }

  // ── Heals ─────────────────────────────────────────────────────────────────
  m = line.match(/\]\s+(.+?)\s+has been healed\s+(?:by\s+(.+?)\s+)?for\s+(\d+)\s+points?/i);
  if (m) {
    return { ts: tsIso, type: 'heal', defender: m[1], attacker: m[2] || null, amount: parseInt(m[3], 10) };
  }

  // ── Casts ─────────────────────────────────────────────────────────────────
  m = line.match(/\]\s+You begin casting\s+(.+?)\./i);
  if (m) {
    return { ts: tsIso, type: 'cast', attacker: null /* self */, ability: m[1] };
  }
  m = line.match(/\]\s+(.+?)\s+begins? to cast\s+(.+?)\./i);
  if (m) {
    return { ts: tsIso, type: 'cast', attacker: m[1], ability: m[2] };
  }

  return null;
}

// ── Character name from filename ────────────────────────────────────────────
function characterFromFilename(filepath) {
  const base = path.basename(filepath);
  // eqlog_Hitya_pq.proj.txt → Hitya
  const m = base.match(/^eqlog_([^_]+)_/i);
  return m ? m[1] : null;
}

// ── Encounter detection state machine ───────────────────────────────────────
// We don't have explicit "encounter started" events in EQ. Heuristic:
//   - Begin a new encounter when we see a damage event involving a known boss
//     OR after >60s of combat-line silence following any death.
//   - End an encounter when:
//     - a death event fires for the primary target, OR
//     - >60s of silence after the last combat line.
//
// "Primary target" = the most-damaged NPC defender within the active window.
//
// On end, the encounter is flushed (upload or dry-run print) and state resets.

class EncounterBuilder {
  constructor({ character, onFlush }) {
    this.character = character;
    this.onFlush   = onFlush;
    this.reset();
  }
  reset() {
    this.events    = [];
    this.startedAt = null;
    this.lastEvent = null;
    this.targets   = new Map(); // defender → total damage dealt to it
    this.bossName  = null;
  }
  add(event) {
    if (!event) return;
    if (!this.startedAt) this.startedAt = event.ts;
    this.lastEvent = event.ts;
    this.events.push(event);

    // Track damage dealt TO targets — but exclude "YOU" / "you" so player-received
    // damage never inflates a player-name into appearing to be the primary target.
    if (event.type === 'damage' && event.defender && !/^you$/i.test(event.defender)) {
      this.targets.set(event.defender, (this.targets.get(event.defender) || 0) + (event.amount || 0));
    }
    if (event.type === 'death' && event.defender && !/^you$/i.test(event.defender)) {
      // If we just killed the most-damaged target, end the encounter
      let top = null, topDmg = -1;
      for (const [name, dmg] of this.targets) {
        if (dmg > topDmg) { top = name; topDmg = dmg; }
      }
      if (top && (event.defender.toLowerCase() === top.toLowerCase() || topDmg > 1000)) {
        this.bossName = event.defender;
        this.flush();
      }
    }
  }
  tickIdle(now) {
    // If we've been silent for >60s and have events, flush
    if (this.events.length && this.lastEvent) {
      const last = new Date(this.lastEvent).getTime();
      if (now - last > 60_000) this.flush();
    }
  }
  flush() {
    // Minimum event count — filters out "you took 7 hits and zoned" noise.
    // Real fights (even fast trash kills) typically produce 15+ events.
    if (this.events.length < 10) {
      this.reset();
      return;
    }
    // Guess boss = top damaged target if not set by a death event
    if (!this.bossName) {
      let top = null, topDmg = -1;
      for (const [name, dmg] of this.targets) {
        if (dmg > topDmg) { top = name; topDmg = dmg; }
      }
      this.bossName = top;
    }
    // No identifiable target = nothing useful to upload (all-heal or background noise)
    if (!this.bossName) {
      this.reset();
      return;
    }
    const payload = {
      agent_version: AGENT_VERSION,
      character:     this.character,
      encounter: {
        started_at: this.startedAt,
        ended_at:   this.lastEvent,
        boss_name:  this.bossName,
        events:     this.events,
      },
    };
    this.onFlush(payload);
    this.reset();
  }
}

// ── Upload ──────────────────────────────────────────────────────────────────
function uploadEncounter(payload, { botUrl, token, dryRun }) {
  if (dryRun) {
    const e = payload.encounter;
    console.log(`[dry-run] ${e.boss_name || '?'} · ${e.events.length} events · ${e.started_at} → ${e.ended_at}`);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const url = new URL(botUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(payload);
    const req = mod.request({
      method:   'POST',
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        'User-Agent':     `wolfpack-logsync/${AGENT_VERSION}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          console.warn(`[upload] ${res.statusCode}: ${data}`);
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          const e = payload.encounter;
          console.log(`✓ uploaded ${e.boss_name || '?'} (${e.events.length} events)`);
          resolve();
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── File watcher (tail mode) ────────────────────────────────────────────────
// Polls every 500ms. Uses fs.stat to detect size growth. Reads only NEW bytes.
// Handles file rotation (size goes down → start from 0) and Windows line endings.

async function tailFile(logPath, onLine) {
  let stat;
  try { stat = await fs.promises.stat(logPath); }
  catch (err) { throw new Error(`Cannot stat ${logPath}: ${err.message}`); }

  let pos = stat.size;
  let buf = '';
  console.log(`[${path.basename(logPath)}] tailing from offset ${pos} (file size ${stat.size})`);

  setInterval(async () => {
    try {
      const s = await fs.promises.stat(logPath);
      if (s.size < pos) {
        // File rotated/truncated — start from new top
        console.log(`[${path.basename(logPath)}] file rotated; resetting position`);
        pos = 0;
        buf = '';
      }
      if (s.size > pos) {
        const fd = await fs.promises.open(logPath, 'r');
        const len = s.size - pos;
        const data = Buffer.alloc(len);
        await fd.read(data, 0, len, pos);
        await fd.close();
        buf += data.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const line of lines) if (line) onLine(line);
        pos = s.size;
      }
    } catch (err) {
      console.warn(`[tail] ${err.message}`);
    }
  }, 500);
}

// ── Time-window mode (backfill) ─────────────────────────────────────────────
async function readWindow(logPath, since, until, onLine) {
  // For now, naive: stream the file line by line and only emit lines whose
  // timestamp falls within the window. A future optimization is binary-search
  // by stat to seek directly to the start of the window; for files <10GB and
  // backfill that's a once-in-a-while operation, this is fine.
  const stream = fs.createReadStream(logPath, { encoding: 'utf8', highWaterMark: 1 << 16 });
  let buf = '';
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        const ts = parseEqTimestamp(line);
        if (!ts) continue;
        if (since && ts < since) continue;
        if (until && ts > until) {
          stream.destroy(); // stop early — we're past the window
          return;
        }
        onLine(line);
      }
    });
    stream.on('end', resolve);
    stream.on('close', resolve);
    stream.on('error', reject);
  });
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.logs.length === 0) {
    console.error('❌ At least one --log is required. Use --help for usage.');
    process.exit(1);
  }

  // Load optional config (custom drop patterns, etc.)
  let dropPatterns = DEFAULT_DROP_PATTERNS;
  let keepPatterns = KEEP_PATTERNS;
  if (args.flags.config) {
    try {
      const cfg = JSON.parse(fs.readFileSync(args.flags.config, 'utf8'));
      if (cfg.drop_patterns) dropPatterns = cfg.drop_patterns.map(s => new RegExp(s, 'i'));
      if (cfg.keep_patterns) keepPatterns = cfg.keep_patterns.map(s => new RegExp(s, 'i'));
      console.log(`Loaded config from ${args.flags.config}`);
    } catch (err) {
      console.error(`Failed to load config: ${err.message}`);
      process.exit(1);
    }
  }

  const botUrl = args.flags.botUrl || DEFAULT_BOT_URL;
  const token  = args.flags.token  || process.env.WOLFPACK_TOKEN || null;
  const dryRun = args.flags.dryRun;

  if (!dryRun && !token) {
    console.warn('⚠️  No --token / WOLFPACK_TOKEN set. Uploads will likely fail auth.');
  }

  // One encounter builder per log file (per character)
  const builders = args.logs.map(logPath => {
    const character = args.flags.character || characterFromFilename(logPath) || 'unknown';
    return {
      logPath,
      character,
      builder: new EncounterBuilder({
        character,
        onFlush: payload => uploadEncounter(payload, { botUrl, token, dryRun }).catch(err =>
          console.warn(`[upload error] ${err.message}`)
        ),
      }),
    };
  });

  // Idle ticker — flushes encounters that have gone quiet
  setInterval(() => {
    const now = Date.now();
    for (const b of builders) b.builder.tickIdle(now);
  }, 5000);

  // Backfill mode
  if (args.flags.since) {
    const since = new Date(args.flags.since);
    const until = args.flags.until ? new Date(args.flags.until) : new Date();
    console.log(`Backfilling window: ${since.toISOString()} → ${until.toISOString()}`);
    for (const b of builders) {
      console.log(`[${b.character}] scanning ${b.logPath}`);
      await readWindow(b.logPath, since, until, line => {
        if (!shouldKeep(line, dropPatterns, keepPatterns)) return;
        const ts = parseEqTimestamp(line);
        const ev = parseEvent(line, ts);
        if (ev) b.builder.add(ev);
      });
      b.builder.flush();
    }
    console.log('Backfill complete.');
    return;
  }

  // Watch mode (default for live raids)
  if (args.flags.watch || (!args.flags.once && !args.flags.since)) {
    console.log(`Watching ${builders.length} log file(s). Press Ctrl+C to stop.`);
    for (const b of builders) {
      await tailFile(b.logPath, line => {
        if (!shouldKeep(line, dropPatterns, keepPatterns)) return;
        const ts = parseEqTimestamp(line);
        const ev = parseEvent(line, ts);
        if (ev) b.builder.add(ev);
      });
    }
    // Run forever; intervals keep us alive
    return;
  }

  // One-shot mode (--once): read what's currently at end and exit
  if (args.flags.once) {
    console.log('One-shot mode: reading existing tail and exiting');
    // Simplest impl: act like watch but exit after 5 seconds of silence
    let idleCount = 0;
    for (const b of builders) {
      tailFile(b.logPath, line => {
        if (!shouldKeep(line, dropPatterns, keepPatterns)) return;
        const ts = parseEqTimestamp(line);
        const ev = parseEvent(line, ts);
        if (ev) { b.builder.add(ev); idleCount = 0; }
      });
    }
    setInterval(() => {
      idleCount++;
      if (idleCount > 10) {  // ~5s idle
        for (const b of builders) b.builder.flush();
        process.exit(0);
      }
    }, 500);
  }
}

// Export internals for tests; only run main() when invoked directly as CLI.
module.exports = {
  parseEvent, shouldKeep, parseEqTimestamp,
  DEFAULT_DROP_PATTERNS, KEEP_PATTERNS,
  EncounterBuilder, characterFromFilename,
};

if (require.main === module) {
  main().catch(err => { console.error('FATAL:', err); process.exit(1); });
}
