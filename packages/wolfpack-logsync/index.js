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

// Read version from package.json so we only have to bump it in one place per release.
// If the require fails (e.g. agent run from a non-package context), fall back to a literal.
let AGENT_VERSION;
try { AGENT_VERSION = require('./package.json').version || '2.2.2'; }
catch { AGENT_VERSION = '2.2.2'; }
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

// ── Spell catalog ────────────────────────────────────────────────────────────
// Bard dirges and other "sourceless" spells deliver their damage as a generic
// "X was hit by non-melee for N" line with NO caster attribution. To credit
// the right player + ability we have to capture the CAST flavor text and
// attribute the next matching damage event within one server tick (~6-7s).
//
// Each entry:
//   name       — display name used in the agent's ability tracker and parses
//   class      — character class (informational)
//   castSelf   — regex matched against RAW log lines, first-person cast text
//   tickMs     — max window between cast and damage event to count it (one tick = 6s,
//                we allow a little slack for clock drift between game and log time)
//
// Want to add a spell? Just append an entry. To find the cast text, fire the
// spell in EQ with /log on and copy the exact flavor line from eqlog_*.txt
// (everything after the timestamp). EncounterBuilder.add() iterates this list.
const SOURCELESS_SPELLS = [
  {
    // Lvl 30 bard direct-damage song. Cast: "You throw your head back and
    // moan a desperate dirge." Damage delivered on next server tick as a
    // generic "X was hit by non-melee for N" line with no caster attribution.
    name:     "Denon`s Desperate Dirge",
    class:    'Bard',
    castSelf: /\]\s+You\s+throw\s+your\s+head\s+back\s+and\s+moan\s+a\s+desperate\s+dirge\./i,
    tickMs:   7000,
  },
  {
    // "Let loose a piercing blast" — exact spell name not yet confirmed (likely
    // a higher-level bard DD). Placeholder label until verified in-game.
    name:     'Dirge (piercing blast)',
    class:    'Bard',
    castSelf: /\]\s+You\s+throw\s+your\s+head\s+back\s+and\s+let\s+loose\s+a\s+piercing\s+blast\./i,
    tickMs:   7000,
  },
];

// Bard DoT songs — auto-captured by the generic "X has taken N damage from
// your <SongName>" parser. No special handling needed in parseEvent because
// the source IS named in every tick line. Catalogued here for reference and
// so the info screen / Discord card can flag bard-specific abilities.
//   baseTick = damage per tick at standard rank (approximate; rank/AA/items vary it)
const BARD_SONGS = [
  { name: 'Selo`s Chords of Cessation', baseTick: 57 },
  { name: 'Chords of Dissonance',       baseTick: 30 },
  { name: 'Denon`s Disruptive Discord', baseTick: 34 },
  { name: 'Denon`s Bereavement',        baseTick: 54 },
  { name: 'Tuyen`s Chant of Flame',     baseTick: 80 },
  { name: 'Tuyen`s Chant of Frost',     baseTick: 80 },
  { name: "Angstlich's Assonance",      baseTick: 45 },
];

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

  // Group chat both directions — genuinely private (small group, not guild-wide)
  /\btells the group,\s*['"]/i,
  /^\[.+\]\s+You say to your group,/i,

  // Note: guild chat (/gu, "tells the guild") and raid chat (/rs, "tells the raid") are
  // intentionally NOT filtered here. These channels are shared among the whole guild
  // and are not private. Future versions may parse them for loot callouts, CH triggers, etc.

  // Public chat (allowed in principle, but not combat-relevant so we drop).
  // EXCEPTION: "PetName says, 'My leader is OwnerName.'" — handled by
  // PRIORITY_KEEP_PATTERNS below, which is checked BEFORE this drop list.
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

// PRIORITY keeps — checked BEFORE the drop list. These override the drop patterns
// for specific say messages that are combat-relevant despite being in public chat.
// Currently: pet leader declarations, which identify which player owns which pet.
//   EQ log format: "[Fri May 26 02:34:04 2026] Gobn says, 'My leader is Utoh.'"
const PRIORITY_KEEP_PATTERNS = [
  /\bsays,?\s*['"]My leader is \w+/i,
  // /who output lines — '[60 Storm Warden] Alice (Wood Elf) <Wolf Pack>' etc.
  // Listed here so they can never be dropped by some future broad filter.
  /^\[.+?\]\s+(?:AFK\s+|LFG\s+)?\[\s*(?:\d+\s+\w|ANONYMOUS|GM)\b/i,
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
  /\bdie[ds]\./i,                                 // "X died." (npc) or "X dies." (older variant)
  /\bhas been knocked unconscious/i,
  // DoT ticks and spell damage attributed to caster.
  // Quarm uses two forms (verified May 2026):
  //   "A Netherbian Drone has taken 11 damage from your Curse of the Spirits."   (no "points of")
  //   "A Zek has taken 294 points of damage from your Ancient: Scourge of Nife." (with "points of")
  // The "points of" is optional — make it permissive so neither form is dropped.
  /\bhas taken \d+(?:\s+points?\s+of)?\s+damage/i,
  /\bfor \d+ points? of (mana|stamina|hit points|endurance)/i,
  /\bhas been healed/i,
  /\byou begin casting/i,
  /\bbegins? to cast/i,
  /\byou cast /i,
  /\bresisted your/i,
  /\byour .+ has worn off/i,
  /\bhas fainted/i,
  // Bard dirges — no "You begin casting" prefix, just this flavor text. Needed
  // so the EncounterBuilder can attribute the next "was hit by non-melee" to
  // the bard's specific dirge (damage lands 3-6s later on the server tick).
  /\byou\s+throw\s+your\s+head\s+back\s+and/i,
  // Avoidance / miss lines — "X tries to <verb> Y, but misses!" / "but Y dodges!" etc.
  // Needed for tanking stats (avoidance %, hits-taken, accuracy). The parseEvent
  // handler classifies each into miss/dodge/parry/riposte/block/invulnerable.
  /\bgoes on a RAMPAGE against\b/i,               // rampage announcements
  /\b(?:tries|try)\s+to\s+\w+\s+.+?,\s+but\s+/i,
  // /who output — needed so these survive shouldKeep() and reach parseEvent.
  // Matches '[60 Druid] Bob (Human) <Wolf Pack>' and the AFK/LFG/ANON/GM forms.
  /^\[.+?\]\s+(?:AFK\s+|LFG\s+)?\[\s*(?:\d+\s+\w|ANONYMOUS|GM)\b/i,
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
// Order: priority keeps (override drops) → drop list → keep list.
function shouldKeep(line, drops = DEFAULT_DROP_PATTERNS, keeps = KEEP_PATTERNS, priorityKeeps = PRIORITY_KEEP_PATTERNS) {
  // Priority keeps override the drop list (e.g. pet leader declarations inside /say)
  for (const rx of priorityKeeps) if (rx.test(line)) return true;
  // Drop list wins next — if any drop pattern matches, line is gone immediately.
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

  // ── Passive-voice spell hits and DoT-with-source ──────────────────────────
  // CRITICAL: these MUST come before the generic verb regex below. The verb
  // regex includes a bare "hit" past-tense fallback that would otherwise
  // greedy-match "A Drone was hit by non-melee for 177" with attacker="A Drone was"
  // and defender="by non-melee" — corrupting the encounter target map.
  //
  // Also: the DoT-with-source patterns use [^.]+\. to terminate the spell name
  // at the next period (handles names with colons like "Ancient: Scourge of Nife").

  // "X was hit by SPELL for N (points of) damage." (proc / unsourced spell hit)
  m = line.match(/\]\s+(You|.+?)\s+(?:was|were)\s+hit\s+by\s+(.+?)\s+for\s+(\d+)(?:\s+points?\s+of)?\s+(?:non-melee\s+)?damage/i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: null, defender: m[1] === 'You' ? null : m[1], ability: m[2], amount: parseInt(m[3], 10) };
  }

  // "X has taken N (points of) damage from your SPELLNAME." (DoT/spell from uploader)
  m = line.match(/\]\s+(.+?)\s+has\s+taken\s+(\d+)(?:\s+points?\s+of)?\s+damage\s+from\s+your\s+([^.]+)\./i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: null /* self */, defender: m[1], ability: m[3].trim(), amount: parseInt(m[2], 10) };
  }

  // "X has taken N (points of) damage from PlayerName's SPELLNAME." (DoT/spell from third party)
  m = line.match(/\]\s+(.+?)\s+has\s+taken\s+(\d+)(?:\s+points?\s+of)?\s+damage\s+from\s+(\S+?)(?:`s|'s)\s+([^.]+)\./i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: m[3], defender: m[1], ability: m[4].trim(), amount: parseInt(m[2], 10) };
  }

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

  // ── Rampage announcement ─────────────────────────────────────────────────
  // "[timestamp] Bossname goes on a RAMPAGE against Target!" — each rampage line
  // names both the attacker AND the target it's hitting, so it's both an
  // announcement and the hit assignment in one line. We emit it as a single
  // 'rampage' event; EncounterBuilder records the hit against the named target.
  m = line.match(/\]\s+(.+?)\s+goes on a RAMPAGE against\s+(.+?)!/i);
  if (m) return { ts: tsIso, type: 'rampage', attacker: m[1], defender: m[2] };

  // ── Avoidance / accuracy ──────────────────────────────────────────────────
  // Every "X tries to <verb> Y, but ..." line tells us either an attacker missed
  // or a defender avoided via dodge / parry / riposte / block. We emit a single
  // 'avoid' event type with a `kind` discriminator; aggregation downstream
  // computes avoidance% per defender and accuracy% per attacker.
  //
  // First-person attacker:  "You try to slash X, but X parries!"  /  "but miss!"
  // Third-person:           "<Name> tries to slash X, but X dodges!"  /  "but misses!"
  //
  // Reason text variants (case-insensitive match on key word):
  //   miss / misses                → miss
  //   dodges                       → dodge
  //   parries                      → parry
  //   ripostes                     → riposte
  //   blocks (with their shield)?  → block
  //   is INVULNERABLE              → invulnerable
  function _classifyAvoid(reasonText) {
    const r = String(reasonText || '').toLowerCase();
    if (/\bdodge/.test(r))         return 'dodge';
    if (/\bparr/.test(r))          return 'parry';
    if (/\bripost/.test(r))        return 'riposte';
    if (/\bblock/.test(r))         return 'block';
    if (/\binvulnerable/.test(r))  return 'invulnerable';
    return 'miss';
  }

  // First-person: "You try to <verb> X, but ..."
  m = line.match(new RegExp(`\\]\\s+You\\s+try\\s+to\\s+${ATTACK_VERBS_RX}\\s+(.+?),\\s+but\\s+(.+?)!`, 'i'));
  if (m) {
    return { ts: tsIso, type: 'avoid', attacker: null /* self */, defender: m[1], kind: _classifyAvoid(m[2]) };
  }

  // Third-person: "<Name> tries to <verb> X, but ..."
  m = line.match(new RegExp(`\\]\\s+(.+?)\\s+tries\\s+to\\s+${ATTACK_VERBS_RX}\\s+(.+?),\\s+but\\s+(.+?)!`, 'i'));
  if (m) {
    return { ts: tsIso, type: 'avoid', attacker: m[1], defender: m[2], kind: _classifyAvoid(m[3]) };
  }

  // "X has taken N (points of) damage." (generic DoT tick — no source mentioned)
  m = line.match(/\]\s+(.+?)\s+has(?:\s+been\s+\w+\.\s+\1)?\s+taken\s+(\d+)(?:\s+points?\s+of)?\s+damage/i);
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
  // "X died." (Quarm/most modern EQ format) or "X dies." (older variant)
  m = line.match(/\]\s+(.+?)\s+die[ds]\./i);
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

  // ── Sourceless spell cast detection (bard dirges & similar) ──────────────
  // Walks the SOURCELESS_SPELLS catalog and emits a `dirge_cast` event with
  // the spell name. EncounterBuilder uses the cast timestamp to attribute the
  // next "X was hit by non-melee for N" damage event (within spell.tickMs) to
  // the named ability — otherwise these spells appear as anonymous "non-melee"
  // damage with no caster, defeating per-ability attribution for bards.
  for (const spell of SOURCELESS_SPELLS) {
    if (spell.castSelf.test(line)) {
      return { ts: tsIso, type: 'dirge_cast', attacker: null, ability: spell.name, tickMs: spell.tickMs };
    }
  }

  // ── Pet leader declaration ────────────────────────────────────────────────
  // Covers both forms that EQ produces:
  //   summon time: "Gobn says, 'My leader is Utoh.'"
  //   /pet leader: "Gobn says, 'My leader is Utoh, Master.'"   (extra ', Master')
  // The capture stops at the owner name (\w+) so trailing decoration is ignored.
  // Only reaches here because PRIORITY_KEEP_PATTERNS let the line through despite
  // the general /says?/ drop pattern. Used to build a pet→owner attribution map.
  //
  // IMPORTANT: pet names may be multi-word (e.g. "a Shadel Bandit"). Use (.+?)
  // lazy match between '] ' and ' says' to capture the full name, not just the
  // first token. (\S+) would capture only "a" for "a Shadel Bandit says, ...".
  m = line.match(/\]\s+(.+?)\s+says,?\s*['"]My leader is (\w+)/i);
  if (m) {
    return { ts: tsIso, type: 'pet_leader', pet: m[1], owner: m[2] };
  }

  // ── /who output line ──────────────────────────────────────────────────────
  // Matches a row of the EQ /who report. Examples (post-timestamp):
  //   "[60 Storm Warden] Alice (Wood Elf) <Wolf Pack>"
  //   "[60 Storm Warden (Recruit)] Carol (Wood Elf) <Wolf Pack>"   (rank suffix)
  //   "[ANONYMOUS] Charlie"
  //   "[ANONYMOUS] Eve <Wolf Pack>"
  //   "AFK [60 Druid] Bob (Wood Elf) <Wolf Pack>"
  //   "[GM] Sysop"
  // Class capture stops at ']' or '(' so multi-word classes like
  // "Storm Warden" / "Master Wizard" parse correctly and ranks are dropped.
  m = line.match(/\]\s+(?:AFK\s+|LFG\s+)?\[\s*(?:(\d+)\s+([^\]\(]+?)(?:\s*\([^)]+\))?|(ANONYMOUS)|(GM))\s*\]\s+(\w+)(?:\s+\(([^)]+)\))?(?:\s+<([^>]+)>)?/i);
  if (m) {
    return {
      ts:        tsIso,
      type:      'who',
      name:      m[5],
      level:     m[1] ? parseInt(m[1], 10) : null,
      class:     m[2] ? m[2].trim() : null,
      anonymous: !!m[3],
      gm:        !!m[4],
      race:      m[6] || null,
      guild:     m[7] || null,
    };
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

// Module-level /who observation buffer. Lives for the agent's process lifetime
// so /who output captured between encounters still ships with the next upload.
const whoData = new Map(); // lowercaseName → { name, class, level, race, guild, anonymous, gm, observedAt }

// Module-level pet owner tracker. Persists for the whole agent session so pet
// declarations (which only fire once at summon / charm time) are never lost.
// petNameLower → Set<ownerName>  (one-to-many: charm pets can cycle through owners)
const knownPetOwners = new Map();

function recordWhoEvent(ev) {
  if (!ev || !ev.name) return;
  // Skip level 1-4 characters — these are almost always traders parked in EC/WC.
  // We only filter when we KNOW the level (null = anonymous, still kept).
  if (ev.level !== null && ev.level !== undefined && ev.level < 5) return;
  const k   = ev.name.toLowerCase();
  const old = whoData.get(k) || {};
  // Mirror server-side mergeWhoData: don't clobber known fields with nulls
  // when the new row is /anon or /role. Class capture from parseEvent will
  // never literally be 'ANONYMOUS' (the anonymous branch sets class=null),
  // but the guard is kept for parity with the server's check.
  whoData.set(k, {
    name:      ev.name,
    class:     (ev.class && ev.class !== 'ANONYMOUS') ? ev.class : (old.class || null),
    level:     ev.level || old.level || null,
    race:      ev.race  || old.race  || null,
    guild:     ev.guild || old.guild || null,
    anonymous: !!ev.anonymous,
    gm:        !!ev.gm || !!old.gm,
    observedAt: ev.ts || new Date().toISOString(),
  });
}

class EncounterBuilder {
  constructor({ character, onFlush }) {
    this.character  = character;
    this.onFlush    = onFlush;
    // petLeaders is PERSISTENT across encounters — pets only declare their
    // leader once when summoned, and they keep that owner until repop. If we
    // wiped this on every encounter flush, a pet that was summoned during
    // fight #1 would lose its owner mapping by fight #2.
    this.petLeaders     = {};         // lowercasePetName → ownerName
    // lastDirgeCast persists across encounters too — a bard might fire a dirge
    // right before an encounter starts and the damage tick lands inside it.
    this.lastDirgeCast  = null;       // { ts: ms, name: string } | null
    this.reset();
  }
  reset() {
    this.events     = [];
    this.startedAt  = null;
    this.lastEvent  = null;
    this.targets    = new Map(); // defender → total damage dealt to it
    this.bossName   = null;
    // Defender stats: per-target tanking + accuracy data, scoped to this encounter.
    // Per-defender shape:
    //   { hits, damageTaken, misses, dodges, parries, ripostes, blocks, invulns,
    //     ripostedFor }   // damage taken from ripostes specifically — high values
    //                     // suggest a Knight tank would mitigate better
    this.defenderStats = new Map();
    // Healer totals: heal-source name → { healed, ticks, targets:Set<name> }
    this.healerStats   = new Map();
    // Pending riposte: when X attacks Y and Y ripostes, the next damage event
    // where Y attacks X within ~1.5s IS the riposte counter-hit. We tag it so
    // the tank can see total damage-from-ripostes per fight.
    //   key: `${attacker}→${defender}` → { ts: ms }
    this.pendingRipostes  = new Map();
    // deaths: player deaths observed in this encounter.
    // [{ name, ts, riposteDeath: bool, class: string|null }]
    this.deaths           = [];
    // recentRiposteDmg: name → timestamp of most recent confirmed riposte hit.
    // Used to attribute a death as a "riposte kill" if death follows within 3s.
    this.recentRiposteDmg = new Map();
    // Rampage tracking — bossMaxMelee used for invuln avoided-damage calc.
    // _rampageTs: timestamp of the most recent "is on the Rampage!" line.
    // Hits landing within 5s of that line are tagged as rampage hits.
    this._rampageTs     = null;
    this._rampageTarget = null;
    this.bossMaxMelee   = 0;
    // petLeaders and lastDirgeCast intentionally NOT reset — persists for the agent's runtime
  }
  _bumpDefender(name, key, amount) {
    if (!name) return;
    if (!this.defenderStats.has(name)) {
      this.defenderStats.set(name, {
        hits: 0, damageTaken: 0,
        misses: 0, dodges: 0, parries: 0, ripostes: 0, blocks: 0, invulns: 0,
        ripostedFor: 0, rampageHits: 0, rampageDmg: 0,
      });
    }
    const s = this.defenderStats.get(name);
    s[key] = (s[key] || 0) + (amount || 1);
  }
  _bumpHealer(healer, target, amount) {
    if (!healer || !amount) return;
    if (!this.healerStats.has(healer)) {
      this.healerStats.set(healer, { healed: 0, ticks: 0, targets: new Set() });
    }
    const s = this.healerStats.get(healer);
    s.healed += amount;
    s.ticks  += 1;
    if (target) s.targets.add(target);
  }
  add(event) {
    if (!event) return;

    // Pet leader declarations update the map but don't count as combat events
    if (event.type === 'pet_leader') {
      this.petLeaders[event.pet.toLowerCase()] = event.owner;
      // Also update the session-wide dashboard tracker so [P] view stays current
      const _pk = event.pet.toLowerCase();
      if (!knownPetOwners.has(_pk)) knownPetOwners.set(_pk, new Set());
      knownPetOwners.get(_pk).add(event.owner);
      return;
    }

    // Bard dirge cast — track for attribution on the next "was hit by non-melee" hit.
    // The dirge damage lands on the next server tick (typically 3-6s later) as
    // "X was hit by non-melee for N" with no caster attribution. We rewrite the
    // ability name to the specific dirge when the matching damage event arrives.
    if (event.type === 'dirge_cast') {
      this.lastDirgeCast = {
        ts:     Date.parse(event.ts) || Date.now(),
        name:   event.ability,
        tickMs: event.tickMs || 7000,
      };
      return;
    }

    // /who output rows are metadata, not combat — accumulate into the module
    // buffer and ship in the next encounter upload.
    if (event.type === 'who') {
      recordWhoEvent(event);
      return;
    }

    // Dirge attribution: ambiguous "was hit by non-melee" damage events (attacker=null,
    // ability='non-melee') get retagged to the most recent dirge cast if it landed
    // within the next server tick window (~7s). Each dirge cast is "consumed" by the
    // first matching hit so back-to-back dirges don't all credit the latest one.
    if (event.type === 'damage'
        && event.attacker === null
        && event.ability === 'non-melee'
        && this.lastDirgeCast) {
      const evTs   = Date.parse(event.ts) || Date.now();
      const window = this.lastDirgeCast.tickMs || 7000;
      if (evTs - this.lastDirgeCast.ts <= window) {
        event.ability = this.lastDirgeCast.name;
        this.lastDirgeCast = null;   // consume
      } else if (evTs - this.lastDirgeCast.ts > window + 5000) {
        // stale — drop it so future hits aren't wrongly credited
        this.lastDirgeCast = null;
      }
    }

    // ── Rampage handling ──────────────────────────────────────────────────────
    // "X goes on a RAMPAGE against Y!" — each line names both attacker and target.
    // We count this directly as a rampage hit on the named defender (no need for
    // a time-window approach since the target is explicit in the log line).
    // The event is NOT added to this.events (it's an announcement, not raw damage).
    if (event.type === 'rampage') {
      if (!this.startedAt) this.startedAt = event.ts;
      this.lastEvent = event.ts;
      if (event.defender) {
        const def = /^you$/i.test(event.defender) ? (this.character || 'You') : event.defender;
        this._bumpDefender(def, 'rampageHits', 1);
        // We don't know the exact rampage damage from the announcement line alone —
        // the actual hit lines will follow and be counted in damageTaken normally.
        // rampageDmg is accumulated from tagged damage events below.
      }
      this._rampageTs = Date.parse(event.ts) || Date.now();
      this._rampageTarget = event.defender || null;
      return;
    }
    // Tag the immediately following damage event for this rampage target (within 3s).
    // Quarm logs typically show the RAMPAGE line then the damage line milliseconds later.
    if (event.type === 'damage' && this._rampageTs && this._rampageTarget) {
      const evTs  = Date.parse(event.ts) || Date.now();
      const tgt   = /^you$/i.test(event.defender || '') ? (this.character || 'You') : (event.defender || '');
      const isTgt = tgt.toLowerCase() === this._rampageTarget.toLowerCase();
      if (isTgt && evTs - this._rampageTs <= 3000) {
        event.isRampage = true;
        this._rampageTs     = null;
        this._rampageTarget = null;
      }
    }
    // Track the boss's highest melee hit for invulnerable-avoided-damage calc.
    // Only count melee verbs (hit/slash/bash etc.) — not proc/spell damage.
    if (event.type === 'damage' && event.attacker && event.amount) {
      if (MELEE_ABILITIES.has((event.ability || '').toLowerCase()) || event.ability === 'hit') {
        if (!this.bossName || event.attacker === this.bossName) {
          this.bossMaxMelee = Math.max(this.bossMaxMelee, event.amount);
        }
      }
    }

    if (!this.startedAt) this.startedAt = event.ts;
    this.lastEvent = event.ts;
    this.events.push(event);

    // Dashboard tracking — sees every parsed damage event, not just uploaded ones
    try { recordEventForDashboard(event, this.character); } catch {}

    // Track damage dealt TO targets — but exclude "YOU" / "you" so player-received
    // damage never inflates a player-name into appearing to be the primary target.
    if (event.type === 'damage' && event.defender && !/^you$/i.test(event.defender)) {
      this.targets.set(event.defender, (this.targets.get(event.defender) || 0) + (event.amount || 0));
    }

    // Per-defender stats — feeds tanking analytics (avoidance %, damage taken,
    // accuracy of incoming hits). Normalise "You"/"YOU" to the uploader so we
    // can compare incoming damage across parsers cleanly.
    if (event.type === 'damage' && event.defender) {
      const def = /^you$/i.test(event.defender) ? (this.character || 'You') : event.defender;
      this._bumpDefender(def, 'hits',        1);
      this._bumpDefender(def, 'damageTaken', event.amount || 0);
      if (event.isRampage) {
        this._bumpDefender(def, 'rampageHits', 1);
        this._bumpDefender(def, 'rampageDmg',  event.amount || 0);
      }
    }
    if (event.type === 'avoid' && event.defender) {
      const def = /^you$/i.test(event.defender) ? (this.character || 'You') : event.defender;
      const k = event.kind || 'miss';
      const col = k === 'miss' ? 'misses'
                : k === 'dodge' ? 'dodges'
                : k === 'parry' ? 'parries'
                : k === 'riposte' ? 'ripostes'
                : k === 'block' ? 'blocks'
                : k === 'invulnerable' ? 'invulns'
                : null;
      if (col) this._bumpDefender(def, col, 1);

      // On a riposte, the defender is about to counter-attack the original attacker.
      // Track that so we can credit the next damage event (def → attacker) as
      // riposte damage. `event.attacker === null` is the first-person form
      // ("You try to slash X, but X ripostes!") — normalise to the uploader.
      if (k === 'riposte') {
        const atkNorm = (event.attacker === null || /^you$/i.test(event.attacker || ''))
          ? (this.character || 'You')
          : event.attacker;
        if (atkNorm) {
          const key = `${def}→${atkNorm}`;
          this.pendingRipostes.set(key, Date.parse(event.ts) || Date.now());
        }
      }
    }

    // Riposte damage credit — if this damage event matches a pending riposte
    // (defender just riposted attacker), and it landed within ~1.5s, credit it
    // to defenderStats[originalAttacker].ripostedFor. Lets a tank see how much
    // damage they ate from boss ripostes — a key Knight-vs-Warrior tank metric.
    if (event.type === 'damage' && event.attacker && event.defender && this.pendingRipostes.size) {
      const atkNorm = /^you$/i.test(event.attacker) ? (this.character || 'You') : event.attacker;
      const defNorm = /^you$/i.test(event.defender) ? (this.character || 'You') : event.defender;
      const key = `${atkNorm}→${defNorm}`;
      const ts  = this.pendingRipostes.get(key);
      if (ts) {
        const now = Date.parse(event.ts) || Date.now();
        if (now - ts <= 1500) {
          this._bumpDefender(defNorm, 'ripostedFor', event.amount || 0);
          // Record timestamp so a death within 3s can be flagged as riposte kill
          this.recentRiposteDmg.set(defNorm, now);
        }
        this.pendingRipostes.delete(key);  // consume
      }
    }
    // Healer totals — every "X has been healed by Y for N" line. First-person
    // ("You heal X for N") would need a separate parseEvent pattern; for now we
    // capture third-person heals which cover most CH-chain visibility from
    // non-cleric perspectives.
    if (event.type === 'heal' && (event.attacker || this.character)) {
      const healer = event.attacker || this.character;
      this._bumpHealer(healer, event.defender, event.amount || 0);
    }
    // ── Player death tracking ────────────────────────────────────────────────
    // Record deaths of player characters in this.deaths[] and the session
    // scoreboard (stats.sessionDeaths). Also detect riposte kills:
    // if a confirmed riposte hit landed on this player within the last 3s,
    // flag it as riposteDeath so the parse card can highlight it for Knights.
    //
    // Player heuristic: single-word name starting with a capital letter.
    // EQ NPC names are always multi-word ("A Shadel Bandit", "An Elder Vah Shir")
    // or start with lowercase ("a spirit", "an undead"). Player names are proper
    // nouns — single capitalised word.
    if (event.type === 'death') {
      const rawDef  = event.defender;
      // Normalise "You died." first-person form to the character name
      const defName = (rawDef === null || /^you$/i.test(rawDef || ''))
        ? (this.character || 'You')
        : rawDef;
      // Is this a player? Single-word + starts uppercase, or is the uploader.
      const isPlayer = !!defName && (
        defName === this.character ||
        (!/\s/.test(defName) && /^[A-Z]/.test(defName))
      );
      if (isPlayer) {
        const deathTs      = Date.parse(event.ts) || Date.now();
        const lastRip      = this.recentRiposteDmg.get(defName);
        const riposteDeath = !!lastRip && (deathTs - lastRip) <= 3000;
        const whoEntry     = whoData.get(defName.toLowerCase());
        const charClass    = whoEntry?.class?.trim() || null;
        this.deaths.push({ name: defName, ts: event.ts, riposteDeath, class: charClass });
        stats.sessionDeaths[defName] = (stats.sessionDeaths[defName] || 0) + 1;
      }
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
    // ── Heal chain gap analysis ────────────────────────────────────────────
    // Identify stretches where the primary tank went >8s without a heal while
    // actively taking damage. CH chains should tick every 3-4s in Luclin; a gap
    // >8s means at least one or two heals were missed. A gap of >15s is a genuine
    // danger window (tank likely burning through buffs + HoT to survive).
    //
    // "Primary tank" = the player character with the highest damageTaken this fight.
    // We filter defenderStats to exclude multi-word names (NPCs), then take the top.
    //
    // Heal events in this.events have defender = target. If the parser IS the tank,
    // their heals are logged as "You have been healed..." with defender="You", so we
    // also check for "You" matching the character name.
    let _healGaps = null;
    if (this.healerStats.size > 0 && this.defenderStats.size > 0) {
      // Find the player taking the most incoming damage (primary tank candidate)
      let topTank = null, topDmg = -1;
      for (const [name, s] of this.defenderStats) {
        // Only consider single-word names (player characters)
        if (/\s/.test(name)) continue;
        if ((s.damageTaken || 0) > topDmg) { topTank = name; topDmg = s.damageTaken; }
      }
      if (topTank && topDmg >= 500) {
        // Collect timestamps of all heal events landing on this tank
        const healTimes = this.events
          .filter(e => {
            if (e.type !== 'heal') return false;
            const def = e.defender || '';
            return def === topTank ||
              (topTank === this.character && /^you$/i.test(def));
          })
          .map(e => Date.parse(e.ts) || 0)
          .filter(Boolean)
          .sort((a, b) => a - b);

        if (healTimes.length >= 2) {
          const GAP_MS = 8000;  // 8s = ~2 missed CH ticks
          const gaps = [];
          for (let i = 1; i < healTimes.length; i++) {
            const g = healTimes[i] - healTimes[i - 1];
            if (g > GAP_MS) gaps.push(g);
          }
          if (gaps.length > 0) {
            _healGaps = {
              tank:      topTank,
              count:     gaps.length,
              maxGapMs:  Math.max(...gaps),
            };
          }
        }
      }
    }

    // ── Raid window detection ──────────────────────────────────────────────
    // Official Wolf Pack EQ raid nights: Sun/Wed/Thu 8:30–11:30 pm Eastern.
    // Computed from the encounter's start timestamp so backfill uploads are also
    // tagged correctly. The server stores this alongside parse entries so
    // /parsestats and future /guildreport can scope "official raid stats".
    const _raidDays = new Set([0, 3, 4]);          // 0=Sun 3=Wed 4=Thu (JS getDay)
    const _raidStartMin = 20 * 60 + 30;            // 20:30 Eastern
    const _raidEndMin   = 23 * 60 + 30;            // 23:30 Eastern
    let isRaidWindow = false;
    if (this.startedAt) {
      try {
        const _p = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
        }).formatToParts(new Date(this.startedAt))
          .reduce((a, { type, value }) => { a[type] = value; return a; }, {});
        const _DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        const _dow = _DOW.indexOf(_p.weekday);
        const _h   = parseInt(_p.hour)   % 24;
        const _m   = parseInt(_p.minute) || 0;
        if (_raidDays.has(_dow)) {
          const _mins = _h * 60 + _m;
          isRaidWindow = _mins >= _raidStartMin && _mins < _raidEndMin;
        }
      } catch { /* non-fatal — Intl not available in all envs */ }
    }

    // ── Active combat duration ─────────────────────────────────────────────────
    // Gap-trimmed: sums continuous combat windows, ignoring gaps >30s (charm phases).
    // A bard's DoT songs tick on charmed mobs every 6s, which would keep the naive
    // startedAt→lastEvent window open for the ENTIRE charm duration. By ignoring
    // gaps >30s we get "time the mob was actually being fought" instead of
    // "time the mob was on screen including charm downtime".
    //
    // Falls back to the naive wall-clock range when fewer than 2 combat events exist.
    const _allEventTimes = this.events
      .filter(e => e.type === 'damage' || e.type === 'avoid')
      .map(e => Date.parse(e.ts) || 0).filter(Boolean).sort((a, b) => a - b);
    const _startMs = this.startedAt ? new Date(this.startedAt).getTime() : Date.now();
    const _endMs   = this.lastEvent  ? new Date(this.lastEvent).getTime()  : _startMs;
    let _activeDurationMs = 0;
    if (_allEventTimes.length >= 2) {
      const CHARM_GAP_MS = 30_000;
      let _winStart = _allEventTimes[0];
      for (let i = 1; i < _allEventTimes.length; i++) {
        if (_allEventTimes[i] - _allEventTimes[i - 1] > CHARM_GAP_MS) {
          _activeDurationMs += _allEventTimes[i - 1] - _winStart;
          _winStart = _allEventTimes[i];
        }
      }
      _activeDurationMs += _allEventTimes[_allEventTimes.length - 1] - _winStart;
    } else {
      _activeDurationMs = Math.max(0, _endMs - _startMs);
    }
    const activeDurationS = Math.max(1, Math.round(_activeDurationMs / 1000));

    const payload = {
      agent_version: AGENT_VERSION,
      character:     this.character,
      encounter: {
        started_at:    this.startedAt,
        ended_at:      this.lastEvent,
        boss_name:     this.bossName,
        // active_duration_s: gap-trimmed combat seconds that excludes charm-phase
        // inactivity. Use this in preference to (ended_at - started_at) to avoid
        // inflated DPS denominators on fights where a pet was charmed and DoT ticks
        // continued landing on it while the mob wasn't being actively engaged.
        active_duration_s: activeDurationS,
        // is_raid_window: true when the encounter falls inside an official guild raid
        // night (Sun/Wed/Thu 8:30–11:30 pm Eastern). Server stores this with parse
        // entries for /parsestats raid_only filtering and future /guildreport.
        is_raid_window: isRaidWindow || undefined,
        // pet_leaders: { lowercasePetName: "OwnerName" } — used server-side to attribute
        // pet damage to the player owner. Empty object when no pets were detected.
        pet_leaders: Object.keys(this.petLeaders).length > 0 ? { ...this.petLeaders } : undefined,
        // who_data: snapshot of every /who row this agent has observed since startup.
        // Server upserts into state.whoData so class/level/guild is available for
        // /parsestats embeds and /whois lookups even for non-guildies.
        who_data:    whoData.size > 0 ? Array.from(whoData.values()) : undefined,
        // Per-defender stats — hits-taken, damage-taken, dodges/parries/ripostes/blocks/misses.
        // Server uses this to build tanking leaderboards and incoming-accuracy analytics
        // without having to re-aggregate the raw event stream.
        defenders:   this.defenderStats.size > 0
          ? [...this.defenderStats.entries()].map(([name, s]) => ({ name, ...s }))
          : undefined,
        // Heal totals per healer — { name, healed, ticks, targets: [name, ...] }.
        // Lets the server build healer leaderboards (CH-chain visibility especially).
        healers:     this.healerStats.size > 0
          ? [...this.healerStats.entries()].map(([name, s]) => ({
              name, healed: s.healed, ticks: s.ticks, targets: [...s.targets]
            }))
          : undefined,
        // Player deaths in this encounter.
        // [{ name, ts, riposteDeath: bool, class: string|null }]
        // riposteDeath = true when a confirmed riposte hit landed on this player
        // within 3s before they died — used to flag Knights (Paladin/SK) who
        // die from boss counter-attacks.
        deaths:      this.deaths.length > 0 ? [...this.deaths] : undefined,
        // Heal chain gap analysis — longest stretches without a heal on the primary tank.
        // { tank: name, count: N, maxGapMs: N }
        // null/undefined when no healer data was observed or gaps < 8s.
        heal_gaps:   _healGaps || undefined,
        events:      this.events,
      },
    };
    // ── Accumulate into session stats ─────────────────────────────────────
    // Defender stats (tanks) — single-word names only (skip NPCs)
    for (const [name, s] of this.defenderStats) {
      if (/\s/.test(name)) continue;
      if (!stats.sessionDefenders[name]) {
        stats.sessionDefenders[name] = {
          damageTaken: 0, hits: 0, ripostes: 0, ripostedFor: 0,
          rampageHits: 0, rampageDmg: 0, invulnAvoidedDmg: 0,
        };
      }
      const sd = stats.sessionDefenders[name];
      sd.damageTaken      = (sd.damageTaken      || 0) + (s.damageTaken  || 0);
      sd.hits             = (sd.hits             || 0) + (s.hits         || 0);
      sd.ripostes         = (sd.ripostes         || 0) + (s.ripostes     || 0);
      sd.ripostedFor      = (sd.ripostedFor      || 0) + (s.ripostedFor  || 0);
      sd.rampageHits      = (sd.rampageHits      || 0) + (s.rampageHits  || 0);
      sd.rampageDmg       = (sd.rampageDmg       || 0) + (s.rampageDmg   || 0);
      // Invuln avoided: invulns × boss max melee for this fight = estimated avoided damage.
      sd.invulnAvoidedDmg = (sd.invulnAvoidedDmg || 0)
                          + (s.invulns || 0) * (this.bossMaxMelee || 0);
    }
    // Healer stats
    for (const [name, s] of this.healerStats) {
      if (!stats.sessionHealers[name]) {
        stats.sessionHealers[name] = { healed: 0, ticks: 0, targets: new Set() };
      }
      const sh = stats.sessionHealers[name];
      sh.healed = (sh.healed || 0) + (s.healed || 0);
      sh.ticks  = (sh.ticks  || 0) + (s.ticks  || 0);
      for (const t of s.targets) sh.targets.add(t);
    }
    // Mob proc counter — non-melee abilities that mobs used against players
    if (this.bossName) {
      for (const e of this.events) {
        if (e.type !== 'damage' || !e.attacker || !e.ability) continue;
        if (e.attacker !== this.bossName) continue;
        const aLower = e.ability.toLowerCase();
        if (MELEE_ABILITIES.has(aLower) || aLower === 'hit') continue;
        if (!stats.sessionProcs[this.bossName]) stats.sessionProcs[this.bossName] = {};
        const mob = stats.sessionProcs[this.bossName];
        if (!mob[e.ability]) mob[e.ability] = { count: 0, totalDmg: 0 };
        mob[e.ability].count++;
        mob[e.ability].totalDmg += e.amount || 0;
      }
    }

    this.onFlush(payload);
    this.reset();
  }
}

// ── Stats tracker (dashboard backing store) ──────────────────────────────────
// The agent keeps a single Stats object in memory updated by parseEvent and
// uploadEncounter. The dashboard renderer reads from it on every redraw.
//
// Persistent fields (totalEvents, totalMinutes, etc.) survive across process
// restarts via logsync.stats.json placed next to the agent index.js.
const STATS_FILE = path.join(__dirname, 'logsync.stats.json');

const stats = {
  agentVersion:    AGENT_VERSION,
  startedAt:       Date.now(),
  watchedLogs:     [],            // [{character, logPath, lastSeen}]
  recentParses:    [],            // last 8 uploads: {bossName, eventCount, totalDamage, spellDotDamage, when}
  topDamageSaw:    [],            // top 5 high-damage events from others   (1 entry per attacker)
  topDamageDid:    [],            // top 5 high-damage events from the uploader (1 entry per attacker)
  sessionEvents:   0,             // cumulative events parsed this run
  sessionTotalDamage: 0,          // total damage across every parsed damage event
  sessionDamageBy: {},            // { attackerName: cumulativeDamage }
  // abilityStats: per-ability totals for the UPLOADER ONLY — used by the info
  // screen to show song/dirge/melee breakdowns. Mainly useful for bards who
  // can otherwise only guess at how much each song is contributing.
  // Map<abilityName, { count, total, lastSeen }>
  abilityStats:    new Map(),
  // sessionDeaths: running death count per player name this session.
  // Powers the "Hall of Shame" on the Info screen and the per-encounter
  // deaths field in uploaded parse cards.
  // { playerName: count }
  sessionDeaths:   {},
  // sessionHealers: per-healer healing totals accumulated across all fights this session.
  // { healerName: { healed, ticks, targets: Set<string> } }
  sessionHealers:  {},
  // sessionDefenders: per-tank incoming-damage totals accumulated this session.
  // { defenderName: { damageTaken, hits, ripostes, ripostedFor } }
  sessionDefenders: {},
  // sessionProcs: non-melee (spell/proc) abilities mobs used this session, per mob.
  // { mobName: { [abilityName]: { count, totalDmg } } }
  sessionProcs:    {},
  uploadCount:     0,
  uploadErrors:    0,
  updateAvailable:      false,      // true when server reports a newer agent version
  requestedCharacters:  [],         // characters the server needs for parse completeness
  lastUploadAt:    null,
  lifetime: {                     // persisted across restarts
    totalEvents:       0,
    totalMinutes:      0,
    topSessionEvents:  0,
    topSessionMinutes: 0,
    firstSeenAt:       null,
  },
};

function loadStats() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (raw.lifetime) Object.assign(stats.lifetime, raw.lifetime);
  } catch { /* missing or unreadable — keep defaults */ }
  if (!stats.lifetime.firstSeenAt) stats.lifetime.firstSeenAt = new Date().toISOString();
}

// ── Session-state persistence ──────────────────────────────────────────────
// On graceful exit (especially [U] update-and-restart), snapshot the live
// session — recent parses, top hits, ability stats, healers/defenders/procs —
// to disk so the post-restart agent can pick up where it left off instead of
// resetting "Recent Parses" and "Top damage" to empty.
//
// The snapshot expires after 10 minutes: any longer than that, it's not "the
// same session" anymore and we want a clean dashboard.
const SESSION_FILE   = path.join(__dirname, 'logsync.session.json');
const SESSION_TTL_MS = 10 * 60 * 1000;

function saveSessionState() {
  try {
    // healerStats has Set fields; abilityStats is a Map. JSON-encode each.
    const healersOut = {};
    for (const [name, s] of Object.entries(stats.sessionHealers || {})) {
      healersOut[name] = {
        healed:  s.healed || 0,
        ticks:   s.ticks  || 0,
        targets: [...(s.targets || [])],
      };
    }
    const payload = {
      savedAt:            Date.now(),
      agentVersion:       AGENT_VERSION,
      startedAt:          stats.startedAt,
      sessionEvents:      stats.sessionEvents,
      sessionTotalDamage: stats.sessionTotalDamage,
      sessionDamageBy:    stats.sessionDamageBy,
      recentParses:       stats.recentParses,
      topDamageSaw:       stats.topDamageSaw,
      topDamageDid:       stats.topDamageDid,
      sessionDefenders:   stats.sessionDefenders,
      sessionHealers:     healersOut,
      sessionProcs:       stats.sessionProcs,
      sessionDeaths:      stats.sessionDeaths,
      abilityStats:       Object.fromEntries(stats.abilityStats),
      uploadCount:        stats.uploadCount,
      uploadErrors:       stats.uploadErrors,
      lastUploadAt:       stats.lastUploadAt,
    };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(payload));
  } catch { /* non-fatal */ }
}

// Returns true if a recent session was restored. Caller can render a banner.
function loadSessionState() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return false;
    const stat = fs.statSync(SESSION_FILE);
    const age = Date.now() - stat.mtime.getTime();
    if (age > SESSION_TTL_MS) {
      try { fs.unlinkSync(SESSION_FILE); } catch {}
      return false;
    }
    const raw = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (raw.startedAt)          stats.startedAt          = raw.startedAt;
    if (raw.sessionEvents)      stats.sessionEvents      = raw.sessionEvents;
    if (raw.sessionTotalDamage) stats.sessionTotalDamage = raw.sessionTotalDamage;
    if (raw.sessionDamageBy)    stats.sessionDamageBy    = raw.sessionDamageBy;
    if (raw.recentParses)       stats.recentParses       = raw.recentParses;
    if (raw.topDamageSaw)       stats.topDamageSaw       = raw.topDamageSaw;
    if (raw.topDamageDid)       stats.topDamageDid       = raw.topDamageDid;
    if (raw.sessionDefenders)   stats.sessionDefenders   = raw.sessionDefenders;
    if (raw.sessionProcs)       stats.sessionProcs       = raw.sessionProcs;
    if (raw.sessionDeaths)      stats.sessionDeaths      = raw.sessionDeaths;
    if (raw.uploadCount)        stats.uploadCount        = raw.uploadCount;
    if (raw.uploadErrors)       stats.uploadErrors       = raw.uploadErrors;
    if (raw.lastUploadAt)       stats.lastUploadAt       = raw.lastUploadAt;
    if (raw.sessionHealers) {
      stats.sessionHealers = {};
      for (const [name, s] of Object.entries(raw.sessionHealers)) {
        stats.sessionHealers[name] = {
          healed:  s.healed || 0,
          ticks:   s.ticks  || 0,
          targets: new Set(s.targets || []),
        };
      }
    }
    if (raw.abilityStats) {
      stats.abilityStats = new Map(Object.entries(raw.abilityStats));
    }
    // Consume the file so the next clean exit must explicitly re-write it
    try { fs.unlinkSync(SESSION_FILE); } catch {}
    return true;
  } catch { return false; }
}

let _saveTimer = null;
function saveStatsSoon() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const sessionMin = Math.round((Date.now() - stats.startedAt) / 60000);
      if (stats.sessionEvents > stats.lifetime.topSessionEvents) {
        stats.lifetime.topSessionEvents  = stats.sessionEvents;
        stats.lifetime.topSessionMinutes = sessionMin;
      }
      fs.writeFileSync(STATS_FILE, JSON.stringify({ lifetime: stats.lifetime }, null, 2));
    } catch { /* non-fatal */ }
  }, 2000);
}

// Classify the ability of a damage event for the dashboard's "top damage" lists.
// Returns one of: 'Melee Crit', 'Spell Crit' (DoT, proc, nuke), or 'Hit'.
const MELEE_ABILITIES = new Set([
  'hit','slash','crush','pierce','punch','kick','bash','backstab','bite','claw',
  'gore','maul','slam','smash','peck','gnaw','sting','trample','snap','stomp',
  'chomp','swing','tear','rend','spit','swipe','buffet','thrash','mangle',
  'pummel','whip','tail-whip','jab','strike','chop','slice','hack','thrust',
  'gouge','lash','sweep','stab','rap','smite','bludgeon','crunch','nick',
  'tail-slap','tail-swipe','tail-thrash','shoot','fire','throw','fling',
]);
function classifyDamage(event) {
  if (event.ability && /^(non-melee|dot)$/i.test(event.ability)) return 'Spell Crit';
  if (event.ability && MELEE_ABILITIES.has(String(event.ability).toLowerCase())) return 'Melee Crit';
  return event.ability ? 'Spell Crit' : 'Hit';
}

function recordEventForDashboard(event, character) {
  if (!event || event.type !== 'damage' || !event.amount) return;
  stats.sessionEvents++;

  const attacker = event.attacker || character || 'You';
  // Skip events that look like NPC-on-NPC (multi-word attacker with no pet leader)
  if (/\s/.test(attacker) && attacker !== character) return;

  // Track session-wide damage totals across ALL hit sizes (not just big crits).
  // Powers the "Damage done this session" right column.
  stats.sessionTotalDamage += event.amount;
  stats.sessionDamageBy[attacker] = (stats.sessionDamageBy[attacker] || 0) + event.amount;

  // Per-ability totals for the info screen — UPLOADER ONLY.
  // First-person events arrive with event.attacker===null (re-attributed to character).
  // Third-person events from the same character are explicitly named.
  // This catches: song DoTs ("from your Tuyen`s Chant of Frost"), dirges
  // ("was hit by non-melee" with attacker=null), melee verbs, casts.
  const isMine = (event.attacker === null) || (event.attacker === character);
  if (isMine && event.amount > 0) {
    const ability = event.ability || '(unknown)';
    const cur = stats.abilityStats.get(ability) || { count: 0, total: 0 };
    cur.count++;
    cur.total += event.amount;
    cur.lastSeen = Date.now();
    stats.abilityStats.set(ability, cur);
  }

  // Top-damage lists thresholds — use a much lower bar for the uploader's own
  // hits so solo / low-level / non-raid content still populates "Top damage I
  // did". A monk at 60 might never exceed 500 per hit but still wants to see
  // their crits and big swings on the dashboard.
  if (event.amount < (isMine ? 50 : 250)) return;

  const item = {
    label:    classifyDamage(event),
    attacker,
    target:   event.defender || '?',
    ability:  event.ability || null,
    amount:   event.amount,
    when:     Date.now(),
  };

  // topDamageSaw = highest hit from ANY source this session (including self).
  // topDamageDid = highest hit from the uploader only.
  // This way solo encounters still populate the left column.
  const lists = isMine
    ? [stats.topDamageDid, stats.topDamageSaw]   // mine → both columns
    : [stats.topDamageSaw];                        // others → left column only

  for (const list of lists) {
    // Dedupe by attacker — one row per player, keep their highest hit.
    const existingIdx = list.findIndex(e => e.attacker.toLowerCase() === attacker.toLowerCase());
    if (existingIdx >= 0) {
      if (event.amount > list[existingIdx].amount) list[existingIdx] = item;
    } else {
      list.push(item);
    }
    list.sort((a, b) => b.amount - a.amount);
    if (list.length > 5) list.length = 5;
  }
}

function recordUploadForDashboard(payload, character) {
  const e        = payload.encounter;
  // Recompute totals from events for accurate per-uploader spell/dot subtotal
  let totalDmg     = 0;
  let spellDotDmg  = 0;
  for (const ev of e.events) {
    if (ev.type !== 'damage' || !ev.amount) continue;
    const attacker = ev.attacker ?? character;
    if (!attacker || (/\s/.test(attacker) && attacker !== character)) continue;
    if (attacker !== character) continue;            // uploader's damage only
    totalDmg += ev.amount;
    if (!ev.ability || !MELEE_ABILITIES.has(String(ev.ability).toLowerCase())) {
      spellDotDmg += ev.amount;
    }
  }
  stats.recentParses.unshift({
    bossName:        e.boss_name || '?',
    eventCount:      e.events.length,
    totalDamage:     totalDmg,
    spellDotDamage:  spellDotDmg,
    when:            Date.now(),
  });
  if (stats.recentParses.length > 8) stats.recentParses.length = 8;
  stats.uploadCount++;
  stats.lastUploadAt = Date.now();
  stats.lifetime.totalEvents += e.events.length;
  saveStatsSoon();
}

// ── Dashboard renderer (ANSI, zero-deps) ─────────────────────────────────────
const ANSI = {
  reset:  '\x1b[0m',
  clear:  '\x1b[2J\x1b[H',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
  white:  '\x1b[37m',
};
const C = ANSI; // shorthand

function fmtK(n) {
  if (n == null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000)     return `${(n / 1000).toFixed(2)}K`;
  return String(n);
}
function fmtAgo(ts) {
  if (!ts) return '?';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function pad(s, n) {
  s = String(s ?? '');
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

let _dashboardEnabled = false;
function renderDashboard() {
  if (!_dashboardEnabled) return;
  // Don't overwrite info/pets views when the periodic redraw fires.
  if (_viewMode !== 'dashboard') return;
  // ASCII-only dashboard chars — cmd.exe with the default codepage renders
  // em-dash, middle-dot, and arrow glyphs as blocks. Sticking to printable
  // ASCII means the dashboard looks the same in cmd, PowerShell, and Terminal.
  const out = [];
  out.push(C.clear);
  out.push(`${C.cyan}${C.bold}  Wolf Pack EQ - Parser (wolfpack-logsync)${C.reset}\n`);
  out.push(`${C.gray}  ------------------------------------------${C.reset}\n`);
  out.push(`  ${C.dim}Current version ${C.reset}${C.bold}${AGENT_VERSION}${C.reset}`);
  if (stats.uploadCount) out.push(`   ${C.dim}| ${stats.uploadCount} upload${stats.uploadCount === 1 ? '' : 's'} this session${C.reset}`);
  if (stats._sessionRestoredBanner) out.push(`   ${C.green}↻ session resumed${C.reset}`);
  out.push('\n\n');

  // Two-column layout: Recent Parses (left) vs Damage done this session (right)
  // Adapt to terminal width so wide windows don't strand everything in the top-left.
  // Clamp to [40, 100] so neither column gets absurdly narrow or wide.
  const TERM_COLS = process.stdout.columns || 100;
  const LCOL = Math.max(40, Math.min(100, Math.floor((TERM_COLS - 4) / 2)));
  const left  = [];
  const right = [];

  left.push(`${C.bold}${C.yellow}Recent Parses${C.reset}`);
  if (stats.recentParses.length === 0) {
    left.push(`  ${C.dim}(no uploads yet)${C.reset}`);
  }
  for (const p of stats.recentParses.slice(0, 4)) {
    left.push(`  ${C.green}>${C.reset} ${pad(p.bossName, 26)} ${C.dim}(${p.eventCount} ev)${C.reset}`);
    left.push(`     ${C.bold}${fmtK(p.totalDamage)}${C.reset}  ${C.dim}(${fmtK(p.spellDotDamage)} spell/dot)${C.reset}`);
  }

  // Right column: actual session damage totals (was just a log-file list).
  right.push(`${C.bold}${C.yellow}Damage done this session${C.reset}`);
  right.push(`${C.dim}Total:${C.reset} ${C.bold}${fmtK(stats.sessionTotalDamage)}${C.reset}`);
  const contributors = Object.entries(stats.sessionDamageBy)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (contributors.length === 0) {
    right.push(`  ${C.dim}(no damage yet)${C.reset}`);
  } else {
    const _myChars = new Set(stats.watchedLogs.map(w => (w.character || '').toLowerCase()));
    for (const [name, dmg] of contributors) {
      const _petEntry = knownPetOwners.get(name.toLowerCase());
      const _isMyPet  = _petEntry && [..._petEntry].some(o => _myChars.has(o.toLowerCase()));
      const _petTag   = _isMyPet ? ` ${C.dim}(my pet)${C.reset}` : '';
      right.push(`  ${pad(name, 14)} ${C.bold}${fmtK(dmg)}${C.reset}${_petTag}`);
    }
  }
  right.push('');
  right.push(`${C.dim}Watching ${stats.watchedLogs.length} log file(s):${C.reset}`);
  const recent = [...stats.watchedLogs].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, 8);
  for (const w of recent) {
    const hot = (Date.now() - (w.lastSeen || 0)) < 60 * 60 * 1000;
    const dot = hot ? `${C.green}*${C.reset}` : ` `;
    right.push(`  ${dot}${pad(w.character, 14)} ${C.dim}${fmtAgo(w.lastSeen)}${C.reset}`);
  }

  // Zip the two columns
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i++) {
    const l = left[i]  || '';
    const r = right[i] || '';
    // Strip ANSI codes for length calculation
    const lLen = l.replace(/\x1b\[[0-9;]*m/g, '').length;
    out.push(`  ${l}${' '.repeat(Math.max(0, LCOL - lLen))}  ${r}\n`);
  }
  out.push('\n');

  // Top damage rows — short ASCII format, one entry per attacker.
  //   "Player         123  Spell - ability"
  out.push(`  ${C.bold}${C.yellow}Top damage I saw${C.reset}${' '.repeat(LCOL - 16)}  ${C.bold}${C.yellow}Top damage I did${C.reset}\n`);
  const damRows = Math.max(stats.topDamageSaw.length, stats.topDamageDid.length, 5);
  const fmtDamageRow = (e) => {
    if (!e) return `${C.dim}(none yet)${C.reset}`;
    const kind    = e.label.replace(' Crit', '');
    const ability = e.ability ? ` ${C.dim}- ${e.ability}${C.reset}` : '';
    return `${C.bold}${pad(e.attacker, 14)}${C.reset} ${C.green}${pad(fmtK(e.amount), 6)}${C.reset} ${C.dim}${kind}${C.reset}${ability}`;
  };
  for (let i = 0; i < damRows; i++) {
    const lTxt = fmtDamageRow(stats.topDamageSaw[i]);
    const rTxt = fmtDamageRow(stats.topDamageDid[i]);
    const lLen = lTxt.replace(/\x1b\[[0-9;]*m/g, '').length;
    out.push(`  ${lTxt}${' '.repeat(Math.max(0, LCOL - lLen))}  ${rTxt}\n`);
  }
  out.push('\n');

  const uHint = stats.updateAvailable
    ? `${C.bold}${C.yellow}[U] ★ UPDATE AVAILABLE — press to install${C.reset}`
    : `${C.cyan}[U]${C.reset} Update`;
  out.push(`  ${C.cyan}[T]${C.reset} Tanks  ${C.gray}|${C.reset}  ${C.cyan}[H]${C.reset} Healers  ${C.gray}|${C.reset}  ${C.cyan}[P]${C.reset} Pets  ${C.gray}|${C.reset}  ${C.cyan}[I]${C.reset} Info / Stats  ${C.gray}|${C.reset}  ${uHint}  ${C.gray}|${C.reset}  ${C.cyan}[O]${C.reset} Opt-in logs  ${C.gray}|${C.reset}  ${C.cyan}[K]${C.reset} Token  ${C.gray}|${C.reset}  ${C.cyan}[Ctrl+C]${C.reset} Exit\n`);
  process.stdout.write(out.join(''));
}

let _renderTimer = null;
function scheduleRender() {
  if (!_dashboardEnabled) return;
  if (_renderTimer) return;
  _renderTimer = setTimeout(() => { _renderTimer = null; renderDashboard(); }, 250);
}

// Raw-mode keypress handler. View modes:
//   dashboard  → live updating, always default
//   info       → I once (5s auto-revert); I again to LOCK; 3rd press → exit
//   pets       → P once (5s auto-revert); P again to LOCK; 3rd press → exit
//   Any other key while in info/pets exits immediately.
let _viewMode    = 'dashboard'; // 'dashboard' | 'info' | 'pets' | 'tanks' | 'healers'
let _viewLocked  = false;       // true = auto-revert cancelled, key required to exit
let _viewTimer   = null;        // active setTimeout for 5s auto-revert

function _clearViewTimer() {
  if (_viewTimer) { clearTimeout(_viewTimer); _viewTimer = null; }
}
// 30s = enough time to actually read the screen. Reset on every key the user
// presses inside the view (see keyboard handler), so spamming the same key
// keeps the view open instead of bouncing back to the dashboard.
const VIEW_AUTO_REVERT_MS = 30000;

function _scheduleAutoRevert() {
  _clearViewTimer();
  _viewTimer = setTimeout(() => {
    _viewTimer = null;
    if (_viewMode !== 'dashboard' && !_viewLocked) {
      _viewMode   = 'dashboard';
      _viewLocked = false;
      renderDashboard();
    }
  }, VIEW_AUTO_REVERT_MS);
}
// Called from any keypress that should keep the held view alive (e.g. user
// hit the same view key again, or pressed navigation keys in opt-in).
function _bumpViewTimer() {
  if (_viewMode !== 'dashboard' && !_viewLocked) _scheduleAutoRevert();
}
function _enterView(mode, renderFn) {
  _viewMode   = mode;
  _viewLocked = false;
  process.stdout.write(ANSI.clear);
  renderFn();
  _scheduleAutoRevert();
}
function _lockView(renderFn) {
  _viewLocked = true;
  _clearViewTimer();
  process.stdout.write(ANSI.clear);
  renderFn();
}
function _exitView() {
  _clearViewTimer();
  _viewMode   = 'dashboard';
  _viewLocked = false;
  renderDashboard();
}

function setupKeypressHandler() {
  if (!process.stdin.isTTY) return;
  try { process.stdin.setRawMode(true); } catch { return; }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  // Redraw on terminal resize so the dashboard re-flows to the new column count.
  process.stdout.on('resize', () => {
    if (_viewMode === 'dashboard') scheduleRender();
  });
  process.stdin.on('data', (key) => {
    // Ctrl+C always exits
    if (key === '\u0003') {
      try { saveSessionState(); } catch {}
      process.stdout.write(`${ANSI.reset}\nExiting.\n`);
      process.exit(0);
    }
    // Any keypress inside a held view restarts the 30s auto-revert clock so
    // mashing keys doesn't kick you back to the dashboard mid-read.
    _bumpViewTimer();

    if (_viewMode === 'info') {
      if (key === 'i' || key === 'I') {
        if (_viewLocked) _exitView();
        else _lockView(showInfo);
      } else {
        _exitView();
      }
      return;
    }

    if (_viewMode === 'pets') {
      if (key === 'p' || key === 'P') {
        if (_viewLocked) _exitView();
        else _lockView(showPets);
      } else {
        _exitView();
      }
      return;
    }

    if (_viewMode === 'tanks') {
      if (key === 't' || key === 'T') {
        if (_viewLocked) _exitView();
        else _lockView(showTanks);
      } else {
        _exitView();
      }
      return;
    }

    if (_viewMode === 'healers') {
      if (key === 'h' || key === 'H') {
        if (_viewLocked) _exitView();
        else _lockView(showHealers);
      } else {
        _exitView();
      }
      return;
    }

    // Dashboard mode
    if (key === 'u' || key === 'U') {
      try {
        // Snapshot the live session so the new version's startup restores
        // recent parses, top hits, ability stats, etc. instead of resetting.
        saveSessionState();
        const marker = path.join(__dirname, '.force-update-on-restart');
        fs.writeFileSync(marker, new Date().toISOString());
      } catch {}
      process.stdout.write(`${ANSI.yellow}\n  Restarting to apply update...${ANSI.reset}\n`);
      process.stdout.write(`${ANSI.dim}  (Session will resume — recent parses + top hits preserved.)${ANSI.reset}\n`);
      process.exit(0);
    }
    if (key === 'k' || key === 'K') {
      try {
        saveSessionState();
        const marker = path.join(__dirname, '.update-token-on-restart');
        fs.writeFileSync(marker, new Date().toISOString());
      } catch {}
      process.stdout.write(`${ANSI.yellow}\n  Restarting so you can enter a new token...${ANSI.reset}\n`);
      process.stdout.write(`${ANSI.dim}  (If you don't get a token prompt, your start-logsync.ps1 is outdated.\n`);
      process.stdout.write(`   Edit logsync.config.json and update "Token" by hand, or redownload\n`);
      process.stdout.write(`   WolfPackParser.zip from the bot's announcement channel.)${ANSI.reset}\n`);
      process.exit(0);
    }
    if (key === 'd' || key === 'D') _exitView();           // D = back to dashboard
    if (key === 't' || key === 'T') _enterView('tanks',   showTanks);
    if (key === 'h' || key === 'H') _enterView('healers', showHealers);
    if (key === 'i' || key === 'I') _enterView('info',    showInfo);
    if (key === 'p' || key === 'P') _enterView('pets',    showPets);
    if (key === 'o' || key === 'O') _enterView('optin',   showOptIn);
  });
}

// ── [O] Historical log opt-in ───────────────────────────────────────────────
// Scans the EQ log directory for all log files including backup/alternate names
// (eqlog_Name_pq.proj.txt2, .txt.bak, etc.).
//
// Two-pane UI:
//   Active pane  — current candidates; navigate, toggle, drop to ignored.
//   Ignored pane — dropped files; restore one (or all) back to active.
//
// Per-file resume tracking: every 5s during backfill we persist `bytePos` to
// disk so an interrupted run can pick up where it left off on the next launch.
//
// Backfill purpose: legacy logs are CHAT ONLY — combat events are skipped so
// we don't pollute parse history with months-old encounters.

const OPTIN_STATE_FILE = path.join(__dirname, 'logsync.optin.json');

const _optinState = {
  files:    [],        // active list  { path, character, isAlt, sizeMb, mtime, selected, requested, resume }
  ignored:  [],        // dropped list (same shape; selected is unused)
  cursor:   0,
  pane:     'active',  // 'active' | 'ignored'
  scanned:  false,
  // Per-file backfill progress (persisted): { [path]: { bytePos, totalBytes, lineNum, updatedAt, character } }
  progress: {},
  // Ignored file paths (persisted across runs)
  ignoredPaths: new Set(),
};

function _loadOptInState() {
  try {
    const raw = JSON.parse(fs.readFileSync(OPTIN_STATE_FILE, 'utf8'));
    _optinState.progress     = raw.progress     || {};
    _optinState.ignoredPaths = new Set(raw.ignoredPaths || []);
  } catch { /* missing or unreadable — fresh state */ }
}
function _saveOptInState() {
  try {
    fs.writeFileSync(OPTIN_STATE_FILE, JSON.stringify({
      progress:     _optinState.progress,
      ignoredPaths: [..._optinState.ignoredPaths],
    }, null, 2));
  } catch { /* non-fatal */ }
}

function _scanOptInFiles() {
  _loadOptInState();
  _optinState.files   = [];
  _optinState.ignored = [];
  // Derive scan directory from the first watched log path
  const firstLog = stats.watchedLogs[0]?.logPath;
  if (!firstLog) return;
  const dir = path.dirname(firstLog);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }

  const requested = new Set((stats.requestedCharacters || []).map(n => n.toLowerCase()));

  for (const name of entries) {
    // Standard logs: eqlog_Name_pq.proj.txt
    const stdM = name.match(/^eqlog_([^_]+)_pq\.proj\.txt$/i);
    // Alternate/backup: eqlog_Name_pq.proj.txt2, .txt.bak, .txt.old, etc.
    const altM = !stdM && name.match(/^eqlog_([^_]+)_pq\.proj\.txt[\d.a-z]+$/i);
    const match = stdM || altM;
    if (!match) continue;

    // Skip files already being tailed live (they're in the main watch list)
    const fullPath = path.join(dir, name);
    const alreadyWatched = stats.watchedLogs.some(w => w.logPath === fullPath);
    if (alreadyWatched && !altM) continue;  // show alt files even if somehow watched

    const char = match[1];
    let sizeMb = 0, sizeBytes = 0, mtime = null;
    try {
      const st = fs.statSync(fullPath);
      sizeBytes = st.size;
      sizeMb    = Math.round(st.size / 1048576 * 10) / 10;
      mtime     = st.mtime;
    } catch {}

    const file = {
      path:      fullPath,
      character: char,
      isAlt:     !!altM,
      sizeMb,
      sizeBytes,
      mtime,
      selected:  false,
      requested: requested.has(char.toLowerCase()),
      resume:    _optinState.progress[fullPath] || null,
    };

    if (_optinState.ignoredPaths.has(fullPath)) _optinState.ignored.push(file);
    else                                         _optinState.files.push(file);
  }

  // Sort active: requested first, then mtime desc (newest first), then size desc
  const sortFn = (a, b) => {
    if (a.requested !== b.requested) return a.requested ? -1 : 1;
    const dt = (b.mtime || 0) - (a.mtime || 0);
    if (dt) return dt;
    return (b.sizeBytes || 0) - (a.sizeBytes || 0);
  };
  _optinState.files.sort(sortFn);
  _optinState.ignored.sort(sortFn);
  _optinState.scanned = true;
  _optinState.cursor  = 0;
}

// Separate keypress handler for the opt-in view (replaces the normal one while active)
let _optinKeyHandler = null;

// Read entire file with byte-position tracking; supports resume from a stored offset.
// onLine(line) is called for each line; onProgress({ bytePos, totalBytes, lineNum }) is called every ~256KB.
async function readFromBytePos(logPath, startBytePos, onLine, onProgress) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(logPath, {
      encoding:      'utf8',
      highWaterMark: 1 << 16,
      start:         startBytePos || 0,
    });
    let buf = '';
    let bytePos = startBytePos || 0;
    let lineNum = 0;
    let sinceLastProgress = 0;
    let cancelled = false;

    stream.on('data', chunk => {
      if (cancelled) return;
      bytePos          += Buffer.byteLength(chunk, 'utf8');
      sinceLastProgress += Buffer.byteLength(chunk, 'utf8');
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const line of lines) {
        lineNum++;
        try { onLine(line); } catch { /* swallow */ }
      }
      if (sinceLastProgress >= 262144 && onProgress) {  // every 256KB
        sinceLastProgress = 0;
        try { onProgress({ bytePos, lineNum }); } catch {}
      }
    });
    stream.on('end',   () => { if (onProgress) try { onProgress({ bytePos, lineNum }); } catch {} ; resolve({ bytePos, lineNum }); });
    stream.on('close', () => resolve({ bytePos, lineNum }));
    stream.on('error', reject);
  });
}

function _fmtAgoDate(d) {
  if (!d) return '?';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1)   return 'today';
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return `${Math.floor(days/30)}mo ago`;
  return `${Math.floor(days/365)}y ago`;
}

function _renderOptinList(list, label, cursor, showResume) {
  const out = [];
  if (list.length === 0) {
    out.push(`  ${C.dim}(${label} list is empty)${C.reset}\n`);
    return out.join('');
  }
  out.push(`  ${C.dim}${pad('', 3)} ${pad('Character', 14)} ${pad('File', 32)} ${pad('Size', 8)} ${pad('Modified', 11)} ${showResume ? 'Resume' : ''}${C.reset}\n`);
  list.forEach((f, i) => {
    const sel  = f.selected ? `${C.green}[✓]${C.reset}` : `${C.dim}[ ]${C.reset}`;
    const cur  = i === cursor ? `${C.yellow}▶${C.reset}` : ' ';
    const alt  = f.isAlt ? ` ${C.dim}(alt)${C.reset}` : '';
    const nameColor = f.requested ? C.blue : (f.isAlt ? C.dim : C.reset);
    const dateStr = _fmtAgoDate(f.mtime);
    const fname   = path.basename(f.path);
    let resumeStr = '';
    if (showResume && f.resume && f.resume.bytePos > 0 && f.sizeBytes) {
      const pct = Math.floor(f.resume.bytePos / f.sizeBytes * 100);
      resumeStr = `${C.yellow}${pct}% (line ${f.resume.lineNum || '?'})${C.reset}`;
    } else if (showResume && f.resume === undefined) {
      // never started
    }
    out.push(`  ${cur}${sel} ${nameColor}${pad(f.character, 14)}${C.reset} ` +
             `${C.dim}${pad(fname, 32)}${C.reset} ${pad(f.sizeMb + 'MB', 8)} ${pad(dateStr, 11)} ${resumeStr}${alt}\n`);
  });
  return out.join('');
}

function showOptIn() {
  if (!_optinState.scanned) _scanOptInFiles();

  const out = [];
  out.push(`${C.clear}\n${C.bold}${C.cyan}  Historical Log Opt-in — ${_optinState.pane === 'active' ? 'Active' : 'Ignored'} (${_optinState.pane === 'active' ? _optinState.files.length : _optinState.ignored.length})${C.reset}\n`);
  out.push(`  ${C.dim}Chat-only backfill — no combat parses created from legacy logs. Files in ${C.blue}blue${C.reset}${C.dim} are requested by the bot.${C.reset}\n\n`);

  const list = _optinState.pane === 'active' ? _optinState.files : _optinState.ignored;
  out.push(_renderOptinList(list, _optinState.pane, _optinState.cursor, _optinState.pane === 'active'));

  const selCount = list.filter(f => f.selected).length;
  out.push('\n');
  if (_optinState.pane === 'active') {
    out.push(`  ${C.cyan}[↑/↓]${C.reset} Navigate  ${C.cyan}[Space]${C.reset} Toggle  ${C.cyan}[A]${C.reset} Select all  ${C.cyan}[X]${C.reset} Ignore highlighted  `);
    out.push(`${selCount > 0 ? `${C.bold}${C.green}[B]${C.reset} Backfill (${selCount})` : `${C.dim}[B] Backfill${C.reset}`}  `);
    out.push(`${C.cyan}[V]${C.reset} View ignored (${_optinState.ignored.length})  ${C.cyan}[D]${C.reset} Back\n`);
  } else {
    out.push(`  ${C.cyan}[↑/↓]${C.reset} Navigate  ${C.cyan}[Space]${C.reset} Toggle  ${C.cyan}[R]${C.reset} Restore selected  ${C.cyan}[V]${C.reset} Back to active  ${C.cyan}[D]${C.reset} Back to dashboard\n`);
  }

  process.stdout.write(out.join(''));

  // Install opt-in specific keypress handler
  if (!_optinKeyHandler && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    _optinKeyHandler = (data) => {
      _bumpViewTimer();
      const key = data.toString();
      const ESC = '\x1b';
      const list = _optinState.pane === 'active' ? _optinState.files : _optinState.ignored;

      if (key === `${ESC}[A`) {  // up arrow
        _optinState.cursor = Math.max(0, _optinState.cursor - 1);
        showOptIn(); return;
      }
      if (key === `${ESC}[B`) {  // down arrow
        _optinState.cursor = Math.min(Math.max(list.length - 1, 0), _optinState.cursor + 1);
        showOptIn(); return;
      }
      if (key === ' ') {
        if (list[_optinState.cursor]) list[_optinState.cursor].selected ^= true;
        showOptIn(); return;
      }
      if (key === 'a' || key === 'A') {
        const all = list.every(f => f.selected);
        list.forEach(f => { f.selected = !all; });
        showOptIn(); return;
      }
      if (key === 'v' || key === 'V') {
        _optinState.pane  = _optinState.pane === 'active' ? 'ignored' : 'active';
        _optinState.cursor = 0;
        showOptIn(); return;
      }
      if (key === 'x' || key === 'X') {
        // Ignore the highlighted file (or all selected) — move to ignored pane.
        if (_optinState.pane !== 'active') { showOptIn(); return; }
        const toIgnore = _optinState.files.filter(f => f.selected);
        const targets  = toIgnore.length > 0 ? toIgnore : [_optinState.files[_optinState.cursor]].filter(Boolean);
        for (const f of targets) {
          _optinState.ignoredPaths.add(f.path);
          f.selected = false;
        }
        _saveOptInState();
        // Re-scan to rebuild the two panes
        _optinState.scanned = false;
        showOptIn(); return;
      }
      if (key === 'r' || key === 'R') {
        // Restore highlighted (or all selected) ignored files back to active.
        if (_optinState.pane !== 'ignored') { showOptIn(); return; }
        const toRestore = _optinState.ignored.filter(f => f.selected);
        const targets   = toRestore.length > 0 ? toRestore : [_optinState.ignored[_optinState.cursor]].filter(Boolean);
        for (const f of targets) {
          _optinState.ignoredPaths.delete(f.path);
          f.selected = false;
        }
        _saveOptInState();
        _optinState.scanned = false;
        showOptIn(); return;
      }
      if (key === 'b' || key === 'B') {
        // Only start backfill from the active pane
        if (_optinState.pane !== 'active') { showOptIn(); return; }
        const chosen = _optinState.files.filter(f => f.selected);
        if (chosen.length === 0) return;

        process.removeListener('data', _optinKeyHandler);
        _optinKeyHandler = null;
        _optinState.scanned = false;
        _exitView();

        process.stdout.write(`\n${C.bold}${C.yellow}  Starting chat-only backfill on ${chosen.length} file(s)...${C.reset}\n`);
        process.stdout.write(`  ${C.dim}(Combat events from legacy logs are SKIPPED — only guild/raid chat is captured.${C.reset}\n`);
        process.stdout.write(`  ${C.dim} Resume position is saved every ~256KB so interruptions don't restart from zero.)${C.reset}\n`);

        const { botUrl, token, dryRun } = _uploadOpts || {};
        for (const f of chosen) {
          const char     = f.character;
          const chatBatch = [];
          let   chatCount = 0;
          const flushChat = async (force) => {
            if (chatBatch.length === 0) return;
            if (!force && chatBatch.length < 500) return;
            const batch = chatBatch.splice(0);
            await uploadHistoricalChat(batch, { botUrl, token, dryRun }).catch(() => {});
          };
          (async () => {
            // Resume from stored byte position if present
            const stored      = _optinState.progress[f.path];
            const startByte   = stored?.bytePos || 0;
            const totalBytes  = f.sizeBytes || 0;
            if (startByte > 0) {
              process.stdout.write(`  ${C.dim}Resuming ${char} from ${Math.floor(startByte / totalBytes * 100)}% (${startByte} bytes)${C.reset}\n`);
            } else {
              process.stdout.write(`  ${C.dim}Backfilling ${char} from ${f.path}...${C.reset}\n`);
            }
            try {
              await readFromBytePos(f.path, startByte,
                (line) => {
                  // CHAT-ONLY. No combat events. No EncounterBuilder. Legacy logs
                  // should not create parses — the user already saw the kills live.
                  const chatMsg = parseChatLine(line, char);
                  if (chatMsg) {
                    chatBatch.push({ ...chatMsg, uploadedBy: char });
                    chatCount++;
                    if (chatBatch.length >= 500) flushChat(true).catch(() => {});
                  }
                },
                ({ bytePos, lineNum }) => {
                  _optinState.progress[f.path] = {
                    bytePos, lineNum, totalBytes,
                    character: char,
                    updatedAt: new Date().toISOString(),
                  };
                  _saveOptInState();
                });
              await flushChat(true).catch(() => {});
              // Mark complete by setting bytePos = totalBytes (or zero out to clear)
              _optinState.progress[f.path] = {
                bytePos: totalBytes, lineNum: -1, totalBytes, character: char,
                updatedAt: new Date().toISOString(), complete: true,
              };
              _saveOptInState();
              process.stdout.write(`  ${C.green}✓ Done: ${char}${C.reset} ${C.dim}(${chatCount} chat lines stored)${C.reset}\n`);
            } catch (err) {
              process.stdout.write(`  ${C.red}✗ ${char}: ${err.message}${C.reset}\n`);
            }
            scheduleRender();
          })();
        }
        return;
      }
      if (key === 'd' || key === 'D' || key === '\x03') {
        process.removeListener('data', _optinKeyHandler);
        _optinKeyHandler = null;
        _optinState.scanned = false;
        _exitView();
      }
    };
    process.stdin.on('data', _optinKeyHandler);
  }
}

function showInfo() {
  const out = [];
  const sessionMin  = Math.max(1, Math.round((Date.now() - stats.startedAt) / 60000));
  const lifetimeMin = stats.lifetime.totalMinutes + sessionMin;

  out.push(`\n${C.bold}${C.cyan}Parser info${C.reset}\n`);
  out.push(`  ${C.dim}This session:${C.reset} ${C.bold}${stats.sessionEvents}${C.reset} events in ${C.bold}${sessionMin}${C.reset} min`);
  out.push(`     ${C.dim}Top session:${C.reset} ${C.bold}${stats.lifetime.topSessionEvents}${C.reset} ev / ${C.bold}${stats.lifetime.topSessionMinutes}${C.reset} min`);
  out.push(`     ${C.dim}Lifetime:${C.reset} ${C.bold}${stats.lifetime.totalEvents + stats.sessionEvents}${C.reset} ev / ${C.bold}${lifetimeMin}${C.reset} min\n`);
  out.push(`  ${C.dim}/who unique:${C.reset}  ${C.bold}${whoData.size}${C.reset} characters observed this session ${C.dim}(lv5+ only)${C.reset}\n`);
  out.push('\n');
  out.push(`  Agent version: ${C.bold}${AGENT_VERSION}${C.reset}\n`);
  out.push(`  Stats file:    ${STATS_FILE}\n`);
  out.push(`  Uploads this session: ${stats.uploadCount} (${stats.uploadErrors} errors)\n`);
  out.push(`  Watched logs:  ${stats.watchedLogs.length}\n`);
  out.push(`  Known pets this session: ${knownPetOwners.size}\n`);
  out.push(`  Lifetime first seen: ${stats.lifetime.firstSeenAt}\n`);

  // Per-ability breakdown — bards especially benefit from seeing each song
  // and dirge counted independently. Sorted by total damage descending.
  const abilities = [...stats.abilityStats.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 14);

  // Identify bard songs so we can show an aggregate counter separately —
  // dirges/chants/discord songs all contribute to a bard's effective DPS but
  // get scattered across the top-abilities table by individual song name.
  const BARD_SONG_NAMES = new Set([
    ...SOURCELESS_SPELLS.map(s => s.name.toLowerCase()),
    ...BARD_SONGS.map(s => s.name.toLowerCase()),
  ]);
  function _isBardSong(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    if (BARD_SONG_NAMES.has(lower)) return true;
    // Catch-all for less common song titles
    return /\b(dirge|chant of|discord|dissonance|cessation|bereavement|assonance)\b/i.test(lower);
  }

  out.push(`\n${C.bold}${C.yellow}  Top Abilities (uploader, this session)${C.reset}\n`);
  if (abilities.length === 0) {
    out.push(`  ${C.dim}(no damage events parsed yet)${C.reset}\n`);
  } else {
    out.push(`  ${C.dim}${pad('Ability', 36)} ${pad('Total', 8)} ${pad('Hits', 6)} ${pad('Avg', 7)}${C.reset}\n`);
    for (const [ability, s] of abilities) {
      const avg   = s.count > 0 ? Math.round(s.total / s.count) : 0;
      // "non-melee" is the EQ damage type for damage shields, DoTs, and procs —
      // NOT for dirges. Dirges are correctly attributed to the song name (e.g.
      // "Denon's Desperate Dirge") via lastDirgeCast correlation upstream.
      const label = ability === 'non-melee' ? `${ability} (DS / DoT / procs)` : ability;
      out.push(`  ${pad(label, 36)} ${C.bold}${pad(fmtK(s.total), 8)}${C.reset} ${pad(String(s.count), 6)} ${pad(fmtK(avg), 7)}\n`);
    }
  }

  // ── 🎵 Bard Songs aggregate — sums all dirges/chants/discord songs into one row ──
  const bardEntries = [...stats.abilityStats.entries()].filter(([name]) => _isBardSong(name));
  if (bardEntries.length > 0) {
    let bardTotal = 0, bardHits = 0;
    for (const [, s] of bardEntries) { bardTotal += s.total; bardHits += s.count; }
    const bardAvg = bardHits > 0 ? Math.round(bardTotal / bardHits) : 0;
    out.push(`\n${C.bold}${C.cyan}  🎵 Bard Songs (combined)${C.reset}\n`);
    out.push(`  ${C.dim}${bardEntries.length} song(s) tracked separately above — combined:${C.reset}\n`);
    out.push(`  ${pad('all dirges + chants', 36)} ${C.bold}${pad(fmtK(bardTotal), 8)}${C.reset} ${pad(String(bardHits), 6)} ${pad(fmtK(bardAvg), 7)}\n`);
  }

  // ── ☠️ Hall of Shame — session death scoreboard ────────────────────────────
  const deathEntries = Object.entries(stats.sessionDeaths || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  out.push(`\n${C.bold}${C.red}  ☠️  Hall of Shame (deaths this session)${C.reset}\n`);
  if (deathEntries.length === 0) {
    out.push(`  ${C.dim}No deaths yet. Very respectable.${C.reset}\n`);
  } else {
    for (const [name, count] of deathEntries) {
      const skulls = count >= 5 ? ' 💀💀💀💀💀' : ' 💀'.repeat(count);
      out.push(`  ${pad(name, 18)} ${C.bold}${C.red}${count}${C.reset} death${count === 1 ? '' : 's'}${C.dim}${skulls}${C.reset}\n`);
    }
  }

  const lockedHint = _viewLocked
    ? `${C.green}LOCKED${C.reset} — I or any other key → back to dashboard`
    : `auto-revert in 5s   |   ${C.cyan}I${C.reset} again → lock here   |   any other key → back`;
  out.push(`\n  ${C.dim}${lockedHint}${C.reset}\n`);
  process.stdout.write(out.join(''));
}

function showPets() {
  const out = [];
  out.push(C.clear);
  out.push(`${C.cyan}${C.bold}  Wolf Pack EQ - Pet Dashboard${C.reset}\n`);
  out.push(`${C.gray}  ------------------------------------------${C.reset}\n\n`);

  // Identify which characters are "mine" (being parsed by this agent instance)
  const myChars = new Set(stats.watchedLogs.map(w => (w.character || '').toLowerCase()));

  // Two-column layout: left = all known pets, right = "My pet" (owned by watched chars)
  const TERM_COLS = process.stdout.columns || 100;
  const LCOL = Math.max(40, Math.min(100, Math.floor((TERM_COLS - 4) / 2)));
  const left  = [];
  const right = [];

  left.push(`${C.bold}${C.yellow}All Pets This Session${C.reset}`);
  right.push(`${C.bold}${C.yellow}My Pet${C.reset}`);

  const sorted = [...knownPetOwners.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  if (sorted.length === 0) {
    left.push(`  ${C.dim}(no pet declarations seen yet)${C.reset}`);
    left.push(`  ${C.dim}Pets declare via: PetName says,${C.reset}`);
    left.push(`  ${C.dim}'My leader is OwnerName.'${C.reset}`);
    right.push(`  ${C.dim}(waiting for a summon/charm)${C.reset}`);
  }

  for (const [petName, owners] of sorted) {
    const ownerArr = [...owners];
    const isMyPet  = ownerArr.some(o => myChars.has(o.toLowerCase()));
    const marker   = isMyPet ? `${C.green}>${C.reset} ` : `  `;
    const ownerStr = ownerArr.join(', ');
    left.push(`${marker}${C.bold}${petName}${C.reset}`);
    left.push(`    ${C.dim}owner: ${ownerStr}${C.reset}`);

    if (isMyPet) {
      const myOwners = ownerArr.filter(o => myChars.has(o.toLowerCase()));
      // Show session damage for this pet if available
      const petDmg = stats.sessionDamageBy[petName]
        || stats.sessionDamageBy[petName.charAt(0).toUpperCase() + petName.slice(1)]
        || 0;
      right.push(`  ${C.green}${C.bold}${petName}${C.reset}`);
      right.push(`  ${C.dim}owned by: ${C.reset}${myOwners.join(', ')}`);
      if (petDmg > 0) {
        right.push(`  ${C.dim}session dmg: ${C.reset}${C.bold}${fmtK(petDmg)}${C.reset}`);
      } else {
        right.push(`  ${C.dim}(no damage tracked yet)${C.reset}`);
      }
      right.push('');
    }
  }

  if (sorted.length > 0 && right.length <= 1) {
    right.push(`  ${C.dim}(none of the active pets belong${C.reset}`);
    right.push(`  ${C.dim} to the characters in this session)${C.reset}`);
  }

  // Zip columns
  const rows = Math.max(left.length, right.length);
  for (let i = 0; i < rows; i++) {
    const l = left[i]  || '';
    const r = right[i] || '';
    const lLen = l.replace(/\x1b\[[0-9;]*m/g, '').length;
    out.push(`  ${l}${' '.repeat(Math.max(0, LCOL - lLen))}  ${r}\n`);
  }

  out.push(`\n`);
  out.push(`  ${C.dim}Note: summon pets declare automatically. Charm pets (bard/enc)${C.reset}\n`);
  out.push(`  ${C.dim}do NOT declare — their damage won't appear here or in parses.${C.reset}\n`);
  const lockedHint = _viewLocked
    ? `${C.green}LOCKED${C.reset} — P or any other key → back to dashboard`
    : `auto-revert in 5s   |   ${C.cyan}P${C.reset} again → lock here   |   any other key → back`;
  out.push(`\n  ${C.dim}${lockedHint}${C.reset}\n`);
  process.stdout.write(out.join(''));
}

function showTanks() {
  const out = [];
  out.push(C.clear);
  out.push(`${C.cyan}${C.bold}  Wolf Pack EQ - Tank Dashboard${C.reset}\n`);
  out.push(`${C.gray}  ------------------------------------------${C.reset}\n\n`);

  // Per-tank session totals
  const defenders = Object.entries(stats.sessionDefenders)
    .sort((a, b) => b[1].damageTaken - a[1].damageTaken);
  out.push(`${C.bold}${C.blue}  Incoming Damage (this session)${C.reset}\n`);
  if (defenders.length === 0) {
    out.push(`  ${C.dim}No tanking data yet — join a fight first.${C.reset}\n`);
  } else {
    out.push(`  ${C.dim}${pad('Tank', 14)} ${pad('Dmg Taken', 9)} ${pad('Hits', 5)} ` +
             `${pad('Ramp Hits', 9)} ${pad('Ramp Dmg', 9)} ` +
             `${pad('Invuln Avoided', 14)} ${pad('Riposted For', 12)}${C.reset}\n`);
    for (const [name, s] of defenders.slice(0, 8)) {
      const invulnStr = s.invulnAvoidedDmg > 0
        ? `${C.green}${pad(fmtK(s.invulnAvoidedDmg), 14)}${C.reset}`
        : `${C.dim}${pad('—', 14)}${C.reset}`;
      const rampStr = s.rampageHits > 0
        ? `${C.yellow}${pad(String(s.rampageHits), 9)}${C.reset} ${C.yellow}${pad(fmtK(s.rampageDmg), 9)}${C.reset}`
        : `${C.dim}${pad('—', 9)}${C.reset} ${C.dim}${pad('—', 9)}${C.reset}`;
      out.push(`  ${pad(name, 14)} ${C.bold}${pad(fmtK(s.damageTaken), 9)}${C.reset} ` +
               `${pad(String(s.hits || 0), 5)} ${rampStr} ${invulnStr} ` +
               `${pad(fmtK(s.ripostedFor || 0), 12)}\n`);
    }
  }

  // Rampage targets this session — who absorbed rampage hits
  const rampTargets = Object.entries(stats.sessionDefenders)
    .filter(([, s]) => (s.rampageHits || 0) > 0)
    .sort((a, b) => b[1].rampageDmg - a[1].rampageDmg);
  if (rampTargets.length > 0) {
    out.push(`\n${C.bold}${C.yellow}  Rampage Targets (this session)${C.reset}\n`);
    out.push(`  ${C.dim}${pad('Player', 14)} ${pad('Hits', 6)} ${pad('Total Dmg', 10)} ${pad('Avg/Hit', 8)}${C.reset}\n`);
    for (const [name, s] of rampTargets.slice(0, 8)) {
      const avg = s.rampageHits > 0 ? Math.round(s.rampageDmg / s.rampageHits) : 0;
      out.push(`  ${pad(name, 14)} ${C.bold}${pad(String(s.rampageHits), 6)}${C.reset} ` +
               `${C.yellow}${pad(fmtK(s.rampageDmg), 10)}${C.reset} ${pad(fmtK(avg), 8)}\n`);
    }
  }

  // Mob proc / special ability counter
  out.push(`\n${C.bold}${C.yellow}  Mob Procs / Special Abilities (this session)${C.reset}\n`);
  const procMobs = Object.entries(stats.sessionProcs);
  if (procMobs.length === 0) {
    out.push(`  ${C.dim}No proc events observed yet.${C.reset}\n`);
  } else {
    for (const [mob, abilities] of procMobs) {
      out.push(`  ${C.bold}${mob}${C.reset}\n`);
      const sorted = Object.entries(abilities).sort((a, b) => b[1].count - a[1].count);
      for (const [ability, s] of sorted.slice(0, 8)) {
        const avg = s.count > 0 ? Math.round(s.totalDmg / s.count) : 0;
        out.push(`    ${pad(ability, 30)} ${C.bold}${pad(String(s.count), 3)}${C.reset}x  ` +
                 `${pad(fmtK(s.totalDmg), 8)} total  ${pad(fmtK(avg), 6)} avg\n`);
      }
    }
  }

  // Deaths
  const deathEntries = Object.entries(stats.sessionDeaths || {})
    .sort((a, b) => b[1] - a[1]).slice(0, 8);
  out.push(`\n${C.bold}${C.red}  Deaths This Session${C.reset}\n`);
  if (deathEntries.length === 0) {
    out.push(`  ${C.dim}Nobody died. Very respectable.${C.reset}\n`);
  } else {
    for (const [name, count] of deathEntries) {
      out.push(`  ${pad(name, 18)} ${C.bold}${C.red}${count}${C.reset} death${count === 1 ? '' : 's'}\n`);
    }
  }

  const lockedHint = _viewLocked
    ? `${C.green}LOCKED${C.reset} — T or any other key -> back to dashboard`
    : `auto-revert in 5s   |   ${C.cyan}T${C.reset} again -> lock   |   ${C.cyan}D${C.reset} -> dashboard   |   any other key -> back`;
  out.push(`\n  ${C.dim}${lockedHint}${C.reset}\n`);
  process.stdout.write(out.join(''));
}

function showHealers() {
  const out = [];
  out.push(C.clear);
  out.push(`${C.cyan}${C.bold}  Wolf Pack EQ - Healing Dashboard${C.reset}\n`);
  out.push(`${C.gray}  ------------------------------------------${C.reset}\n\n`);

  const healerEntries = Object.entries(stats.sessionHealers)
    .sort((a, b) => b[1].healed - a[1].healed);

  out.push(`${C.bold}${C.green}  Healer Totals (this session)${C.reset}\n`);
  if (healerEntries.length === 0) {
    out.push(`  ${C.dim}No healing data yet — join a fight first.${C.reset}\n`);
  } else {
    out.push(`  ${C.dim}${pad('Healer', 18)} ${pad('Total Healed', 12)} ${pad('Ticks', 5)}  Targets${C.reset}\n`);
    for (const [name, s] of healerEntries.slice(0, 10)) {
      const targets = s.targets instanceof Set ? [...s.targets] : (s.targets || []);
      const targetStr = targets.slice(0, 4).join(', ');
      out.push(`  ${pad(name, 18)} ${C.bold}${pad(fmtK(s.healed), 12)}${C.reset} ${pad(String(s.ticks || 0), 5)}  ${C.dim}${targetStr}${C.reset}\n`);
    }
  }

  // Top heal targets — who is receiving the most attention (indicates MT/OT)
  out.push(`\n${C.bold}${C.yellow}  Top Heal Targets (who's getting healed)${C.reset}\n`);
  const targetMap = {};
  for (const [, s] of healerEntries) {
    const targets = s.targets instanceof Set ? [...s.targets] : (s.targets || []);
    for (const t of targets) targetMap[t] = (targetMap[t] || 0) + 1;
  }
  const sortedTargets = Object.entries(targetMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (sortedTargets.length === 0) {
    out.push(`  ${C.dim}(no data yet)${C.reset}\n`);
  } else {
    for (const [target, healerCount] of sortedTargets) {
      const defData = stats.sessionDefenders[target];
      const dmgNote = defData ? `  ${C.dim}(took ${fmtK(defData.damageTaken)} dmg incoming)${C.reset}` : '';
      out.push(`  ${pad(target, 18)} healed by ${C.bold}${healerCount}${C.reset} healer${healerCount !== 1 ? 's' : ''}${dmgNote}\n`);
    }
  }

  const lockedHint = _viewLocked
    ? `${C.green}LOCKED${C.reset} — H or any other key -> back to dashboard`
    : `auto-revert in 5s   |   ${C.cyan}H${C.reset} again -> lock   |   ${C.cyan}D${C.reset} -> dashboard   |   any other key -> back`;
  out.push(`\n  ${C.dim}${lockedHint}${C.reset}\n`);
  process.stdout.write(out.join(''));
}

// ── Upload ──────────────────────────────────────────────────────────────────
function uploadEncounter(payload, { botUrl, token, dryRun }) {
  if (dryRun) {
    const e = payload.encounter;
    console.log(`[dry-run] ${e.boss_name || '?'} · ${e.events.length} events · ${e.started_at} → ${e.ended_at}`);
    recordUploadForDashboard(payload, payload.character);
    scheduleRender();
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
          stats.uploadErrors++;
          if (!_dashboardEnabled) console.warn(`[upload] ${res.statusCode}: ${data}`);
          scheduleRender();
          reject(new Error(`HTTP ${res.statusCode}`));
        } else {
          const e = payload.encounter;
          // Check if server is advertising a newer agent version
          try {
            const resp = JSON.parse(data);
            if (resp.latest_agent_version && resp.latest_agent_version !== AGENT_VERSION) {
              stats.updateAvailable = true;
            }
            if (Array.isArray(resp.requested_characters)) {
              stats.requestedCharacters = resp.requested_characters;
            }
          } catch { /* non-fatal */ }
          recordUploadForDashboard(payload, payload.character);
          if (!_dashboardEnabled) console.log(`✓ uploaded ${e.boss_name || '?'} (${e.events.length} events)`);
          scheduleRender();
          resolve();
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Guild / Raid chat relay ───────────────────────────────────────────────────
// Guild (/gu) and raid (/rs) chat lines pass the shouldKeep filter (they are NOT
// dropped) but produce no combat events. We capture them here, attach the /who
// class+level decoration, and flush to the bot's /api/agent/chat endpoint every
// 5 seconds so the bot can relay them to read-only Discord channels.
//
// Officer chat, tells, and group chat are still dropped at the byte level before
// this code ever runs — they never reach parseChatLine.

const CHAT_LINE_PATTERNS = [
  // Third-person guild: "Cory tells the guild, 'message'"
  { rx: /^\[.+?\]\s+(\w+) tells the guild,\s*['"](.+?)['"]\s*$/, channel: 'guild', self: false },
  // First-person guild: "You say to your guild, 'message'" (Quarm) or
  //                      "You tell your guild, 'message'" (some EQ variants)
  { rx: /^\[.+?\]\s+You (?:say to|tell) your guild,\s*['"](.+?)['"]\s*$/, channel: 'guild', self: true },
  // Third-person raid: "Hitya tells the raid, 'message'"
  { rx: /^\[.+?\]\s+(\w+) tells the raid,\s*['"](.+?)['"]\s*$/, channel: 'raid', self: false },
  // First-person raid: EQ logs this as "You tell your raid" (NOT "say to your")
  //                    — accept both verbs to cover client variations.
  { rx: /^\[.+?\]\s+You (?:tell|say to) your raid,\s*['"](.+?)['"]\s*$/, channel: 'raid', self: true },
];

// ── Druzzil Ro instance-kill announcements ─────────────────────────────────
// Server god broadcasts guild kills: "Druzzil Ro tells the guild, 'Emma of <Wolf Pack> has killed Boss in Zone!'"
// Routed to the raid channel + triggers an auto-timer in the bot.
// NOTE: "Druzzil Ro" has a space so it never matches the single-word (\w+) guild chat pattern above.
const DRUZZIL_KILL_RX = /^\[(.+?)\]\s+Druzzil Ro tells the guild,\s*['"](\w+) of <(.+?)> has killed (.+?) in (.+?)!['"]/;

// ── PVP Druzzil Ro broadcast announcements ─────────────────────────────────
// Server god broadcasts player deaths: "PVP Druzzil Ro BROADCASTS, 'text'"
// Two kill-type sub-patterns determine Wolf Pack involvement:
const PVP_BROADCAST_RX    = /^\[(.+?)\]\s+PVP Druzzil Ro BROADCASTS,\s*['"](.+?)['"]\s*$/;
const PVP_PLAYER_KILL_RX  = /^(\w+) of <(.+?)> has been killed in combat by (\w+) of <(.+?)> in (.+?)!$/;
const PVP_NPC_KILL_RX     = /^(\w+) of <(.+?)> has died to (.+?) in combat in (.+?)!$/;

function parseDruzzilKill(line) {
  const m = DRUZZIL_KILL_RX.exec(line);
  if (!m) return null;
  const ts = parseEqTimestamp(line);
  return {
    character: m[2],
    guild:     m[3],
    boss:      m[4],
    zone:      m[5],
    ts:        ts ? ts.toISOString() : new Date().toISOString(),
  };
}

function parsePvpBroadcast(line) {
  const m = PVP_BROADCAST_RX.exec(line);
  if (!m) return null;
  const ts   = parseEqTimestamp(line);
  const text = m[2];

  let killType = 'npc';
  let victim = null, victimGuild = null, killer = null, killerGuild = null, zone = null;

  const ppk = PVP_PLAYER_KILL_RX.exec(text);
  if (ppk) {
    killType    = 'pvp';
    victim      = ppk[1]; victimGuild  = ppk[2];
    killer      = ppk[3]; killerGuild  = ppk[4];
    zone        = ppk[5];
  } else {
    const npck = PVP_NPC_KILL_RX.exec(text);
    if (npck) {
      victim      = npck[1]; victimGuild = npck[2];
      zone        = npck[4];
    }
  }

  return {
    ts: ts ? ts.toISOString() : new Date().toISOString(),
    text,
    killType,
    victim, victimGuild,
    killer, killerGuild,
    zone,
  };
}

// EQ in-game item links land in the log as `\x12<hex blob>\x12Item Name\x12`.
// Quarm's blob format observed in the wild: 7 hex chars = <1 version><5 ID><1 flag>.
// We extract the item ID and turn the link into a clickable PQDI markdown URL so
// guildies see "[A Lucid Shard](pqdi)" in Discord instead of "0022194A Lucid Shard"
// (which is what they'd see if Discord strips the 0x12 delimiters with no transform).
//
// Two passes:
//   1. \x12-delimited form (raw from the EQ log)  →  markdown link
//   2. Already-stripped form ("<hex run><Item Name>") in case the delimiters
//      were lost upstream  →  markdown link
//
// Item names containing `[`, `]`, `(`, `)` are left alone — those chars would
// corrupt markdown link syntax. EQ item names don't normally have them.
const EQ_ITEM_LINK_RX = /\x12([0-9A-Fa-f]{5,})\x12([^\x12]+)\x12/g;

// Discord-stripped fallback: exactly 7 UPPERCASE hex chars (Quarm's blob length)
// immediately followed by an item-name-cased phrase. Item names start with an
// optional article ("A "/"An "/"The ") then a Capital word, optionally followed
// by more Capital words connected by short lowercase joiners ("of"/"the"/etc.).
// Anchored to word boundaries to avoid matching plain numeric chat.
const EQ_STRIPPED_LINK_RX = /\b([0-9A-F]{7})((?:A |An |The )?[A-Z][a-z`'\-]+(?: (?:[a-z]{1,3} )*[A-Z][a-z`'\-]+){0,6})\b/g;

function _extractItemId(blob) {
  // Quarm format: <1-char version><5-char hex ID><...flags>.
  // Some emulators omit the version byte (older format: <5-char ID><...>).
  // If the first char looks like a version digit (0 or 1) and there's room
  // for a full 5-char ID after it, skip past the version byte.
  const startIdx = (blob[0] === '0' || blob[0] === '1') && blob.length >= 6 ? 1 : 0;
  const id = parseInt(blob.slice(startIdx, startIdx + 5), 16);
  if (!Number.isFinite(id) || id <= 0 || id > 999999) return null;
  return id;
}

function transformEqItemLinks(text) {
  if (!text) return text;
  let out = text;
  // Pass 1: raw EQ format with 0x12 delimiters
  if (out.indexOf('\x12') !== -1) {
    out = out.replace(EQ_ITEM_LINK_RX, (_, blob, name) => {
      if (/[\[\]()]/.test(name)) return name;
      const id = _extractItemId(blob);
      // Bare URL in angle brackets — Discord auto-linkifies, the `<>` suppresses
      // the URL preview embed so chat stays compact. More visibly clickable than
      // masked-link `[name](url)` syntax which renders too subtly.
      return id ? `${name} <https://www.pqdi.cc/item/${id}>` : name;
    }).replace(/\x12/g, '');
  }
  // Pass 2: Discord-stripped form (delimiters already lost)
  out = out.replace(EQ_STRIPPED_LINK_RX, (match, blob, name) => {
    if (/[\[\]()]/.test(name)) return match;
    const id = _extractItemId(blob);
    return id ? `${name} <https://www.pqdi.cc/item/${id}>` : match;
  });
  return out;
}

function parseChatLine(line, selfName) {
  for (const { rx, channel, self: isSelf } of CHAT_LINE_PATTERNS) {
    const m = line.match(rx);
    if (!m) continue;
    const ts      = parseEqTimestamp(line);
    const speaker = isSelf ? (selfName || 'You') : m[1];
    const rawText = isSelf ? m[1] : m[2];
    const text    = transformEqItemLinks(rawText);
    const who     = whoData.get(speaker.toLowerCase()) || null;
    return {
      channel,
      speaker,
      text,
      ts:  ts ? ts.toISOString() : new Date().toISOString(),
      who: who ? { name: who.name, level: who.level, race: who.race, class: who.class } : null,
    };
  }
  return null;
}

// ── /sll lockout parser ────────────────────────────────────────────────────
// EQ /sll output in the log:
//   [timestamp] === Current Loot Lockouts ===
//   [timestamp] == Boss Name: Available          ← no lockout — SKIP, never clears guild timer
//   [timestamp] == Boss Name: Xd Yh Zm Ws        ← active lockout with remaining time
//   [timestamp] == Boss Name: X days Y hours     ← alternate phrasing
//
// We capture the section header so we know subsequent == lines belong to /sll.
// "Available" entries are filtered here — only active lockouts reach the bot.

let _inLockoutSection = false;    // true while reading /sll output lines
let _lockoutBuffer    = [];       // accumulates active lockout entries

const SLL_HEADER_RX  = /^\[.+?\]\s+===\s+Current(?:\s+Loot)?\s+Lockouts?\s+===/i;
const SLL_ENTRY_RX   = /^\[.+?\]\s+==\s+(.+?):\s+(.+?)\s*$/;

// Parse a lockout time string into milliseconds remaining.
// Handles: "3d 14h 22m 5s", "3 days 14 hours", "14 hours 30 minutes", etc.
// Returns null if the string is "Available" or unrecognised.
function parseLockoutRemaining(raw) {
  const s = (raw || '').trim();
  if (/^available$/i.test(s)) return null;   // "Available" → skip

  let ms = 0;
  const dMatch = s.match(/(\d+)\s*d(?:ays?)?/i);
  const hMatch = s.match(/(\d+)\s*h(?:ours?)?/i);
  const mMatch = s.match(/(\d+)\s*m(?:in(?:utes?)?)?/i);
  const sMatch = s.match(/(\d+)\s*s(?:ec(?:onds?)?)?/i);

  if (!dMatch && !hMatch && !mMatch && !sMatch) return null;  // unrecognised format

  if (dMatch) ms += parseInt(dMatch[1], 10) * 86400000;
  if (hMatch) ms += parseInt(hMatch[1], 10) * 3600000;
  if (mMatch) ms += parseInt(mMatch[1], 10) * 60000;
  if (sMatch) ms += parseInt(sMatch[1], 10) * 1000;

  return ms > 0 ? ms : null;
}

function parseSllLine(line) {
  // Detect the section header — start capturing
  if (SLL_HEADER_RX.test(line)) {
    _inLockoutSection = true;
    return null;
  }
  // Stop capturing on any non-== line that isn't a lockout entry
  if (_inLockoutSection) {
    const m = SLL_ENTRY_RX.exec(line);
    if (!m) {
      // Could be "=== Current Legacy Item Lockouts ===" or end of section
      if (/^\[.+?\]\s+===/i.test(line)) {
        // Another section header — stay in section mode
        return null;
      }
      _inLockoutSection = false;
      return null;
    }
    const bossName     = m[1].trim();
    const remainingMs  = parseLockoutRemaining(m[2]);
    if (remainingMs === null) return null;   // "Available" or unrecognised — skip
    return { bossName, remainingMs };
  }
  return null;
}

const chatBuffer        = [];   // pending guild/raid chat lines
const pvpBuffer         = [];   // pending PVP broadcast lines
const druzzilKillBuffer = [];   // pending Druzzil Ro boss-kill announcements
// _lockoutBuffer is declared above near parseSllLine (module-level _lockoutBuffer)
let _uploadOpts    = null;      // set in main() once botUrl/token are known
let _chatRelayOn   = false;     // true once the 5s relay interval is running

function startChatRelay() {
  if (_chatRelayOn) return;
  _chatRelayOn = true;
  setInterval(() => {
    if (!_uploadOpts) return;
    if (chatBuffer.length > 0)
      uploadChat(chatBuffer.splice(0), _uploadOpts).catch(() => {});
    if (pvpBuffer.length > 0)
      uploadPvp(pvpBuffer.splice(0), _uploadOpts).catch(() => {});
    if (druzzilKillBuffer.length > 0)
      uploadDruzzilKills(druzzilKillBuffer.splice(0), _uploadOpts).catch(() => {});
    if (_lockoutBuffer.length > 0)
      uploadLockouts(_lockoutBuffer.splice(0), _uploadOpts).catch(() => {});
  }, 5000);
}

function uploadChat(messages, { botUrl, token, dryRun }) {
  if (dryRun) {
    for (const m of messages) {
      console.log(`[chat:${m.channel}] <${m.speaker}> ${m.text}`);
    }
    return Promise.resolve();
  }
  // Derive chat URL: swap '/encounter' for '/chat' at the end of botUrl
  const chatUrl = botUrl.replace(/\/encounter(\?.*)?$/, '/chat');
  return new Promise((resolve) => {
    try {
      const url = new URL(chatUrl);
      const mod = url.protocol === 'https:' ? https : http;
      const body = JSON.stringify({ agent_version: AGENT_VERSION, messages });
      const req  = mod.request({
        method:   'POST',
        hostname: url.hostname,
        port:     url.port,
        path:     url.pathname + url.search,
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'User-Agent':     `wolfpack-logsync/${AGENT_VERSION}`,
        },
      }, res => { res.resume(); resolve(); });
      req.on('error', () => resolve());
      req.write(body);
      req.end();
    } catch { resolve(); }
  });
}

// Shared low-level HTTP POST helper for agent relay endpoints.
function _agentPost(fullUrl, token, body) {
  return new Promise((resolve) => {
    try {
      const u   = new URL(fullUrl);
      const mod = u.protocol === 'https:' ? https : http;
      const str = JSON.stringify(body);
      const req = mod.request({
        method:   'POST',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname + u.search,
        headers: {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(str),
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'User-Agent':     `wolfpack-logsync/${AGENT_VERSION}`,
        },
      }, res => { res.resume(); resolve(); });
      req.on('error', () => resolve());
      req.write(str);
      req.end();
    } catch { resolve(); }
  });
}

function uploadPvp(broadcasts, { botUrl, token, dryRun }) {
  if (dryRun) {
    for (const b of broadcasts)
      console.log(`[pvp] ${b.killType === 'pvp' ? '⚔️' : '☠️'} ${b.text}`);
    return Promise.resolve();
  }
  return _agentPost(botUrl.replace(/\/encounter(\?.*)?$/, '/pvp'), token,
    { agent_version: AGENT_VERSION, broadcasts });
}

function uploadDruzzilKills(kills, { botUrl, token, dryRun }) {
  if (dryRun) {
    for (const k of kills)
      console.log(`[raid-kill] ${k.character} of <${k.guild}> killed ${k.boss} in ${k.zone}`);
    return Promise.resolve();
  }
  return _agentPost(botUrl.replace(/\/encounter(\?.*)?$/, '/bosskill'), token,
    { agent_version: AGENT_VERSION, kills });
}

function uploadHistoricalChat(messages, { botUrl, token, dryRun }) {
  if (dryRun) {
    console.log(`[historical-chat] ${messages.length} chat lines (dry-run)`);
    return Promise.resolve({ stored: messages.length });
  }
  return _agentPost(botUrl.replace(/\/encounter(\?.*)?$/, '/historical_chat'), token,
    { agent_version: AGENT_VERSION, messages });
}

function uploadLockouts(entries, { botUrl, token, dryRun, character }) {
  // Attach the character name so the bot can store it as killedBy
  const enriched = entries.map(e => ({ ...e, character: character || 'unknown' }));
  if (dryRun) {
    for (const e of enriched)
      console.log(`[lockout] ${e.bossName}: ${Math.round(e.remainingMs / 3600000)}h remaining`);
    return Promise.resolve();
  }
  return _agentPost(botUrl.replace(/\/encounter(\?.*)?$/, '/lockout'), token,
    { agent_version: AGENT_VERSION, entries: enriched });
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
  if (!_dashboardEnabled) {
    console.log(`[${path.basename(logPath)}] tailing from offset ${pos} (file size ${stat.size})`);
  }

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

  // Make opts available to the chat relay flush (module-level so the interval can see them)
  _uploadOpts = { botUrl, token, dryRun };

  // Load persisted lifetime stats so the dashboard can show them
  loadStats();
  // Restore in-flight session state if the previous run snapshotted within the
  // last 10 minutes (typical for [U] update-and-restart, or quick Ctrl+C).
  const _sessionRestored = loadSessionState();
  if (_sessionRestored) stats._sessionRestoredBanner = true;
  // Backstop save every 60s so a hard crash loses at most a minute.
  setInterval(() => {
    if (stats.sessionEvents > 0 || stats.uploadCount > 0) {
      try { saveSessionState(); } catch {}
    }
  }, 60_000);

  // One encounter builder per log file (per character)
  const builders = args.logs.map(logPath => {
    const character = args.flags.character || characterFromFilename(logPath) || 'unknown';
    // Register this log in the dashboard's watched list. Seed lastSeen from
    // file mtime so the dashboard shows useful "ago" times immediately —
    // without this seed, every log shows '?' until a fresh line arrives,
    // which never happens for chars who aren't currently logged in.
    let initialLastSeen = null;
    try { initialLastSeen = fs.statSync(logPath).mtime.getTime(); } catch {}
    stats.watchedLogs.push({ character, logPath, lastSeen: initialLastSeen });
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

  // Enable the dashboard if stdout is a TTY (terminal). When the agent runs
  // headless under the Windows scheduled task, stdout is redirected and we
  // fall back to the plain log-line output that's been there forever.
  if (process.stdout.isTTY && !args.flags.dryRun) {
    _dashboardEnabled = true;
    renderDashboard();
    setInterval(renderDashboard, 5000);
    setupKeypressHandler();
  }

  // Idle ticker — flushes encounters that have gone quiet, AND periodically
  // pushes the /who buffer to the server even without a combat encounter.
  // Without the who-only flush, /whois on Discord can't find recently-observed
  // characters until the parser next kills something.
  let _whoDataLastSize  = 0;
  let _whoDataLastFlush = 0;
  setInterval(() => {
    const now = Date.now();
    for (const b of builders) b.builder.tickIdle(now);

    // Who-only flush: 5-second debounce after the buffer grows. Sends an
    // empty-encounter payload (no boss_name, no events) with the full
    // whoData snapshot — the server merges it into state.whoData and
    // /whois starts seeing the new entries within ~5-10 seconds of /who.
    if (whoData.size > _whoDataLastSize && (now - _whoDataLastFlush) >= 5000) {
      _whoDataLastSize  = whoData.size;
      _whoDataLastFlush = now;
      const character  = builders[0]?.character || 'unknown';
      const iso        = new Date(now).toISOString();
      uploadEncounter({
        agent_version: AGENT_VERSION,
        character,
        encounter: {
          started_at: iso,
          ended_at:   iso,
          boss_name:  null,
          events:     [],
          who_data:   Array.from(whoData.values()),
        },
      }, { botUrl, token, dryRun }).catch(err => {
        if (!_dashboardEnabled) console.warn(`[who flush] ${err.message}`);
      });
    }
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
    if (!_dashboardEnabled) console.log(`Watching ${builders.length} log file(s). Press Ctrl+C to stop.`);
    startChatRelay();  // start the 5s guild/raid chat flush interval
    for (const b of builders) {
      const watched = stats.watchedLogs.find(w => w.logPath === b.logPath);
      await tailFile(b.logPath, line => {
        if (watched) { watched.lastSeen = Date.now(); }

        // ── Special relay lines: checked BEFORE the combat filter ──────────
        // These are NOT combat events and won't pass shouldKeep(), but we
        // still want to capture and relay them to Discord.

        // /sll lockout output → bot timer (Available entries silently skipped)
        const lockoutEntry = parseSllLine(line);
        if (lockoutEntry) { _lockoutBuffer.push({ ...lockoutEntry, character: b.character }); return; }
        // Even if parseSllLine returned null we may have toggled _inLockoutSection;
        // only bail early if we're inside a lockout block (line was consumed).
        if (_inLockoutSection && /^\[.+?\]\s+==/i.test(line)) return;

        // Druzzil Ro instance-kill announcement → boss timer + raid channel
        const druzzilKill = parseDruzzilKill(line);
        if (druzzilKill) { druzzilKillBuffer.push(druzzilKill); return; }

        // PVP Druzzil Ro broadcast → PVP channel (with howl/backup logic in bot)
        const pvpBcast = parsePvpBroadcast(line);
        if (pvpBcast) { pvpBuffer.push(pvpBcast); return; }

        // Guild / raid chat relay
        const chatMsg = parseChatLine(line, b.character);
        if (chatMsg) { chatBuffer.push(chatMsg); return; }

        // ── Normal combat filter ───────────────────────────────────────────
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
  AGENT_VERSION,
  parseEvent, shouldKeep, parseEqTimestamp,
  DEFAULT_DROP_PATTERNS, KEEP_PATTERNS,
  SOURCELESS_SPELLS, BARD_SONGS,
  EncounterBuilder, characterFromFilename,
};

if (require.main === module) {
  main().catch(err => { console.error('FATAL:', err); process.exit(1); });
}
