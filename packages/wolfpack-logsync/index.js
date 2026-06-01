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
const crypto = require('crypto');
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
    else if (a === '--web-port')  out.flags.webPort = parseInt(argv[++i], 10) || 7777;
    else if (a === '--no-service-check') out.flags.noServiceCheck = true;
    else if (a === '--no-auto-open')     out.flags.noAutoOpen     = true;
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
  --web-port <port>      enable embedded web dashboard at http://localhost:<port>
                         (binds 127.0.0.1 only; useful when running as a service)
  --no-auto-open         skip auto-opening the browser when --web-port is set
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

// ── Threat-procs catalog ───────────────────────────────────────────────────
// When a damage event's ability is one of these named procs, the threat meter
// uses the catalog hate value directly INSTEAD of the generic damage proxy.
// Values are per-trigger hate; add more procs as the guild discovers them on
// their weapons. Names are case-insensitive lookup keys.
//
// Sources:
//   - "Bloodfrenzy" / "Blade of Carnage" warrior weapons → Enraging Blow @ 700
//   - Taunt-on-proc lines → Provoke / Taunt-style effects
//   - User-confirmed values from the Quarmy weapon-stats screenshot
const PROC_HATE = {
  'enraging blow':       700,   // warrior threat procs (Bloodfrenzy, BoC, etc.)
  'provoke':             500,
  'taunt':               500,
  'stun':                200,   // warrior/paladin stun combat ability (non-damage)
  // Generic flat-hate weapon procs — add as observed
  'shock of fear':       250,
  'shock of dyn`leth':   250,
};

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
  // Charm-pet attribution. EQ only tells the CHARMER about its pet's target:
  //   "A Soriz Skeleton tells you, 'Attacking A Shissar Taskmaster Master.'"
  // Without this priority-keep, the line is dropped by the generic
  // /tells you,/ filter below (which catches player tells) and we lose the
  // pet → owner mapping for charm pets. parseEvent below resolves owner
  // to the uploading character (this.character) when it sees this form.
  /\btells you,\s*['"]Attacking\b.+\bMaster\.?\s*['"]/i,
  // Charm-LAND attribution (bystander-visible). "<Mob> regards <Charmer>
  // as an ally." Required so the line survives any future broad drop
  // filter — used to attribute charmed mobs to their enchanter for
  // damage display (Mistmoore glyphed familiars, etc.).
  /\bregards\s+\S+\s+as\s+an\s+ally\b/i,
  // Charm BREAK — bystander visible. Closes the charm session for
  // duration + DPS computation.
  /\b(?:snaps out of(?: the)? charm|is no longer charmed|has been freed of(?: the)? charm)\b/i,
  // Dire Charm cast detection — flags the next charm-land as the AA
  // permanent variant (vs regular Charm cycling).
  /\b(?:begin(?:s)?\s+(?:to\s+cast|casting))\s+Dire\s+Charm\b/i,
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
  // Bandolier swap events — track active weapon set per character
  /\bLoading bandolier set \[/i,
  /\bBandolier set \[.+?\] is already equipped/i,
  /\bcanceling set load\b/i,
  /\bYou are too busy to equip bandolier set!/i,
  // Monk mend skill outcomes — counted on the dashboard for Monk players.
  // "You mend your wounds and heal some damage." / "considerable damage." (crit)
  // "You magically mend your wounds and heal..." (alternate phrasing)
  // "You fail to mend your wounds." (failed attempt)
  /\byou\s+(?:magically\s+)?mend\s+your\s+wounds/i,
  /\byou\s+(?:try\s+to\s+|fail\s+to\s+)?mend\s+your\s+wounds/i,
  /\b(?:tries|try)\s+to\s+\w+\s+.+?,\s+but\s+/i,
  // Taunt and stun skill uses — credited as flat hate on the live threat meter
  /\byou attempt to taunt\b/i,
  /\byou have taunted\b/i,
  /\byou have stunned\b/i,
  /\byou stun\s+\w/i,
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

  // ── Bandolier swap events ───────────────────────────────────────────────
  // EQ writes a line whenever the player runs /bandolier load <name>:
  //   "Loading bandolier set [emp]"            — load attempt
  //   "Bandolier set [1] is already equipped"  — confirms current set name
  //   "You are too busy to equip bandolier set!"
  //   "Item with ID [21809] not found in inventory for bandolier set [caen], canceling set load."
  //   "No empty inventory slot to unequip Nature Walker's Scimitar, canceling set load."
  m = line.match(/\]\s+Loading bandolier set \[(.+?)\]/i);
  if (m) return { ts: tsIso, type: 'bandolier', action: 'loading', setName: m[1] };
  m = line.match(/\]\s+Bandolier set \[(.+?)\] is already equipped/i);
  if (m) return { ts: tsIso, type: 'bandolier', action: 'already_equipped', setName: m[1] };
  m = line.match(/\]\s+Item with ID \[(\d+)\] not found in inventory for bandolier set \[(.+?)\], canceling set load/i);
  if (m) return { ts: tsIso, type: 'bandolier', action: 'missing_item', itemId: parseInt(m[1], 10), setName: m[2] };
  m = line.match(/\]\s+No empty inventory slot to unequip (.+?), canceling set load/i);
  if (m) return { ts: tsIso, type: 'bandolier', action: 'no_slot', item: m[1] };
  if (/\]\s+You are too busy to equip bandolier set!/i.test(line))
    return { ts: tsIso, type: 'bandolier', action: 'too_busy' };

  // ── Monk Mending Skill ───────────────────────────────────────────────────
  // EQ Monk's "Mending" self-heal — three possible outcomes:
  //   "You mend your wounds and heal considerable damage." → critical mend
  //   "You mend your wounds and heal some damage."         → regular success
  //   "You fail to mend your wounds."                       → failed attempt
  // ("magically" prefix may appear on crits — match permissively)
  if (/\]\s+You\s+(?:magically\s+)?mend\s+your\s+wounds\s+and\s+heal\s+considerable\s+damage/i.test(line))
    return { ts: tsIso, type: 'mend', outcome: 'crit' };
  if (/\]\s+You\s+(?:magically\s+)?mend\s+your\s+wounds\s+and\s+heal\s+some\s+damage/i.test(line))
    return { ts: tsIso, type: 'mend', outcome: 'regular' };
  if (/\]\s+You\s+(?:try\s+to\s+|fail\s+to\s+)?mend\s+your\s+wounds(?![\s,]+and)/i.test(line))
    return { ts: tsIso, type: 'mend', outcome: 'fail' };

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
  // Quarm-confirmed heal-line variants (verified against Manamana's log,
  // ~70MB, ~10mo of raid + group play):
  //   1. "<Target> has been healed by <Healer> for <X> points." — third-person
  //      with both names + amount. EQ canonically logs this only to
  //      group/raid members with the appropriate spam toggle; on Quarm we
  //      effectively never see it for bystanders.
  //   2. "You have been healed for <X> points of damage." — self-target,
  //      amount only, no healer attribution.
  //   3. "You feel much better." — generic self-heal landing, no amount.
  //   4. "<Healer> performs an exceptional heal! (<amount>)" — exceptional
  //      ("critical") heal that IS bystander-visible with both name and
  //      amount. This is the one that lets us build a public crit-heal
  //      leaderboard from a single parser anywhere in the raid.
  m = line.match(/\]\s+(.+?)\s+has been healed\s+(?:by\s+(.+?)\s+)?for\s+(\d+)\s+points?/i);
  if (m) {
    return { ts: tsIso, type: 'heal', defender: m[1], attacker: m[2] || null, amount: parseInt(m[3], 10) };
  }
  m = line.match(/\]\s+You have been healed for\s+(\d+)\s+points? of damage\./i);
  if (m) {
    // Self-target, amount only, no healer attribution. Goes through the
    // healers pipeline as an incoming heal we received but can't attribute.
    return { ts: tsIso, type: 'heal', defender: 'You', attacker: null, amount: parseInt(m[1], 10) };
  }
  m = line.match(/\]\s+(.+?)\s+performs an exceptional heal!\s*\((\d+)\)/i);
  if (m) {
    // Bystander-visible exceptional heal with healer name + amount. Tagged
    // as 'crit_heal' so the dashboard can surface a separate leaderboard
    // without conflating with regular heal totals.
    return { ts: tsIso, type: 'crit_heal', attacker: m[1], amount: parseInt(m[2], 10) };
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

  // ── Taunt skill ──────────────────────────────────────────────────────────
  // "You attempt to taunt Lord Nagafen."  — attempt (always logged, even if resisted)
  // "You have taunted Lord Nagafen."      — success confirmation (some server variants)
  m = line.match(/\]\s+You attempt to taunt (.+?)\./i);
  if (m) return { ts: tsIso, type: 'taunt', attacker: null, target: m[1], success: false };
  m = line.match(/\]\s+You have taunted (.+?)\./i);
  if (m) return { ts: tsIso, type: 'taunt', attacker: null, target: m[1], success: true };

  // ── Stun skill (Warrior/Paladin combat ability, non-damage) ──────────────
  // "You have stunned Lord Nagafen."  /  "You stun Lord Nagafen."
  m = line.match(/\]\s+You have stunned (.+?)\./i);
  if (m) return { ts: tsIso, type: 'stun', attacker: null, target: m[1] };
  m = line.match(/\]\s+You stun (.+?)\./i);
  if (m) return { ts: tsIso, type: 'stun', attacker: null, target: m[1] };

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

  // Charm-pet attribution. Form:
  //   "A Soriz Skeleton tells you, 'Attacking A Shissar Taskmaster Master.'"
  // This line is ONLY visible to the player who charmed the pet, so the
  // owner is implicitly the agent's character. Emit a sentinel owner of
  // "__SELF__" — EncounterBuilder.add() resolves it to this.character.
  m = line.match(/\]\s+(.+?)\s+tells you,\s*['"]Attacking\b.+\bMaster\.?\s*['"]/i);
  if (m) {
    return { ts: tsIso, type: 'pet_leader', pet: m[1], owner: '__SELF__' };
  }

  // Dire Charm cast detection — flags the next charm-land as the long
  // permanent AA variant rather than a regular Charm cycle. Bystander-
  // visible cast line ("X begins casting Dire Charm") so any agent with a
  // line of sight can pick it up. Self-cast variant also covered.
  m = line.match(/\]\s+(?:You\s+begin\s+casting\s+Dire\s+Charm|(.+?)\s+begins\s+(?:to\s+cast|casting)\s+Dire\s+Charm)\b/i);
  if (m) {
    return { ts: tsIso, type: 'dire_charm_cast', caster: m[1] || '__SELF__' };
  }

  // Charm BREAK — bystander visible. Closes any open charm session on
  // this pet so the bot can compute final duration + DPS. Several
  // phrasings observed across classic / Quarm; alternation kept loose.
  m = line.match(/\]\s+(.+?)\s+(?:snaps out of(?: the)? charm|is no longer charmed|has been freed of(?: the)? charm)\s*\.?\s*$/i);
  if (m) {
    return { ts: tsIso, type: 'charm_break', pet: m[1] };
  }

  // Charm-LAND attribution (bystander-visible). Form:
  //   "A glyphed familiar regards Lihliana as an ally."
  // Visible to everyone in the zone, so any agent can pick it up and
  // attribute the mob to the casting enchanter for the rest of the fight.
  // Useful for Mistmoore raids (glyphed familiars), zoo / charm-cycling
  // groups, and any time we don't have a direct line of sight from the
  // charmer's own agent (e.g. enchanter not running Mimic).
  //
  // ⚠️ WORDING FLAGGED: this is the classic EQ phrasing. If Quarm uses a
  // variant ("regards <name> as their master", "is yours to command",
  // etc.) extend the alternation. False positives are bounded — only mobs
  // get "regards X as an ally" pointed at a Wolf Pack member by name.
  m = line.match(/\]\s+(.+?)\s+regards\s+(\S+)\s+as\s+an\s+ally\.?\s*$/i);
  if (m) {
    return { ts: tsIso, type: 'pet_leader', pet: m[1], owner: m[2], source: 'charm_land' };
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

// Names confirmed to be players (not NPCs). Built from multiple positive
// sources — once a name lands here, all downstream player-only trackers
// (tank stats, threat, deaths, DEEPS, session damage) trust it.
//
// Quarm NPCs frequently have single-word capitalized names (Nillipuss, Yelinak,
// etc.) so the cheap "single-word + capital first letter" heuristic produces
// false positives. We whitelist confirmed players instead.
const confirmedPlayers = new Set();   // lowercase names
function isConfirmedPlayer(name) {
  if (!name) return false;
  // Multi-word names with lowercase start (NPCs like "a netherbian drone")
  if (/^[a-z]/.test(name)) return false;
  const lower = name.toLowerCase();
  if (confirmedPlayers.has(lower)) return true;
  // Watched character (uploader's own log)
  if (stats.watchedLogs && stats.watchedLogs.some(w => (w.character || '').toLowerCase() === lower)) {
    confirmedPlayers.add(lower); return true;
  }
  // Seen via /who
  if (whoData.has(lower)) { confirmedPlayers.add(lower); return true; }
  // Has cast a heal (NPCs don't appear in EQ's third-person heal lines normally)
  if (stats.sessionHealers && stats.sessionHealers[name]) {
    confirmedPlayers.add(lower); return true;
  }
  return false;
}
function confirmPlayer(name) {
  if (name) confirmedPlayers.add(String(name).toLowerCase());
}

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
  // Anyone we /who'd is a player — whitelist for downstream tank/death tracking
  confirmPlayer(ev.name);
}

class EncounterBuilder {
  constructor({ character, onFlush, silent = false }) {
    this.character  = character;
    this.onFlush    = onFlush;
    // `silent` mode = no live-dashboard side-effects. Backfill drivers
    // set this so replaying old logs doesn't move top-damage counters,
    // session DPS, recentParses, or threat tables. Combat events still
    // flow to onFlush and upload to the bot for Supabase persistence.
    this.silent     = silent;
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
    // ── Live threat tracking (Phase 1) ───────────────────────────────────────
    // Per-player estimated threat accumulated for this encounter. Approximate
    // weights derived from EQ aggro behavior: melee swings ≈ 1 hate per damage
    // point; weapon procs (non-melee from named attacker) ≈ 1.3x; named spells
    // ≈ 1.5x; heals ≈ 0.5 hate per heal point. Real values depend on spell
    // hate tables we don't have client-side — these proxies are good enough
    // to rank players and warn when a DPS is closing on the tank.
    this.threatBy = new Map();  // attacker → { swing, proc, spell, heal }
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
    // Boss self-heal accumulator. Bumped when an NPC heals itself during the
    // fight (e.g. Lady Vox Complete Heal). Surfaced on parse cards via the
    // encounter payload's npc_healed_total field.
    this.npcHealedTotal = 0;
    // Charm session tracking (this encounter only).
    //   _activeCharms: petLower → open session record (started_at, owner, …)
    //   charmSessions: closed sessions (charm broke or owner re-charmed
    //                  with a different caster). Flushed in the encounter
    //                  payload's charm_sessions array.
    //   _pendingDireCharm: { caster, ts } set by the Dire Charm cast
    //                      detector; consumed by the next matching charm-
    //                      land within 10s.
    this._activeCharms     = new Map();
    this.charmSessions     = [];
    this._pendingDireCharm = null;
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

    // Mirror to stats.sessionDefenders LIVE so the dashboard reflects damage
    // taken even when an encounter doesn't end in a kill. ONLY for confirmed
    // players — Quarm NPCs like 'Nillipuss' have single-word capitalised names
    // and would otherwise show up as tanks. isConfirmedPlayer whitelists from
    // /who, watchedLogs, healers, and chat speakers.
    // Silent builders (opt-in backfill) skip this so old log replays don't
    // pollute the live dashboard's tank/healer panels.
    if (!this.silent && isConfirmedPlayer(name)) {
      if (!stats.sessionDefenders[name]) {
        stats.sessionDefenders[name] = {
          damageTaken: 0, hits: 0, ripostes: 0, ripostedFor: 0,
          rampageHits: 0, rampageDmg: 0, invulnAvoidedDmg: 0,
        };
      }
      const sd = stats.sessionDefenders[name];
      sd[key] = (sd[key] || 0) + (amount || 1);
    }
  }
  // Snapshot current encounter's threat picture into stats.currentEncounterThreat
  // so dashboard renderers can display a live threat meter without poking
  // EncounterBuilder internals.
  // Per-attacker DPS breakdown bucket — initialised lazily, updated live by
  // damage and critical events. Used by the DEEPS tab. Silent builders
  // (opt-in backfill) skip this entirely so old log replays don't move
  // the live DEEPS panel.
  _bumpDeeps(attacker, category, amount, abilityName) {
    if (!attacker || this.silent) return;
    if (!stats.sessionDeeps[attacker]) {
      stats.sessionDeeps[attacker] = {
        melee: { count: 0, total: 0, max: 0 },
        spell: { count: 0, total: 0, max: 0 },
        proc:  { count: 0, total: 0, max: 0 },
        dot:   { count: 0, total: 0, max: 0 },
        crits: { count: 0, bonusDmg: 0, maxBonus: 0 },
        topAbilities: {},  // { abilityName: { count, total } } — top hits per attacker
      };
    }
    const d = stats.sessionDeeps[attacker];
    if (category === 'crit') {
      d.crits.count++;
      d.crits.bonusDmg += amount;
      if (amount > d.crits.maxBonus) d.crits.maxBonus = amount;
      return;
    }
    if (!d[category]) return;
    d[category].count++;
    d[category].total += amount;
    if (amount > d[category].max) d[category].max = amount;
    // Per-ability rollup (only when the ability is named — skip generic 'hit')
    if (abilityName && abilityName !== 'hit') {
      const ab = d.topAbilities[abilityName] || (d.topAbilities[abilityName] = { count: 0, total: 0 });
      ab.count++;
      ab.total += amount;
    }
  }

  _publishLiveThreat() {
    if (this.threatBy.size === 0) {
      // Keep the last fight's threat visible for 2 min as a stale read-back.
      const et = stats.currentEncounterThreat;
      if (et && et.flushedAt && Date.now() - et.flushedAt > 120_000) {
        stats.currentEncounterThreat = null;
      }
      // else: leave stale data in place (flushedAt set by flush())
      return;
    }
    const perPlayer = {};
    for (const [name, t] of this.threatBy) {
      // Defense-in-depth: even if a name slipped past the writer-side
      // NPC check, drop it here if it shows up as a damage target — the
      // mob we're fighting can't simultaneously be on our threat table.
      if (this.targets.has(name)) continue;
      perPlayer[name] = {
        swing:      Math.round(t.swing),
        proc:       Math.round(t.proc),
        spell:      Math.round(t.spell),
        heal:       Math.round(t.heal),
        total:      Math.round(t.swing + t.proc + t.spell + t.heal),
        procDetail: t.procDetail || {},
      };
    }
    stats.currentEncounterThreat = {
      bossName:  this.bossName,
      startedAt: this.startedAt,
      flushedAt: null,
      perPlayer,
    };
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

    // Dire Charm cast → flag the next charm-land within ~10s as a DC
    // session, not a regular Charm cycle. Stored on the builder so it's
    // reset between encounters automatically (DC casts don't survive a
    // wipe + new pull).
    if (event.type === 'dire_charm_cast') {
      const caster = event.caster === '__SELF__' ? (this.character || null) : event.caster;
      this._pendingDireCharm = { caster, ts: this.lastEvent || Date.now() };
      return;
    }

    // Charm break → close any open charm session for this pet so the
    // bot computes final duration + DPS. Sessions persist on the
    // builder in this.charmSessions for inclusion in the encounter
    // payload.
    if (event.type === 'charm_break') {
      const petKey = String(event.pet || '').toLowerCase();
      if (!petKey) return;
      const open = this._activeCharms?.get(petKey);
      if (open) {
        open.ended_at = this.lastEvent || open.started_at;
        open.end_reason = 'charm_break';
        open.duration_sec = Math.max(0, (open.ended_at - open.started_at) / 1000);
        this.charmSessions.push(open);
        this._activeCharms.delete(petKey);
      }
      return;
    }

    // Pet leader declarations update the map but don't count as combat events.
    // The parser emits owner='__SELF__' for charm-pet "Attacking X Master."
    // lines (which EQ only shows to the charmer) — resolve to this.character.
    if (event.type === 'pet_leader') {
      const owner = event.owner === '__SELF__' ? (this.character || null) : event.owner;
      if (!owner) return;  // can't attribute without a known character
      this.petLeaders[event.pet.toLowerCase()] = owner;
      // Also update the session-wide dashboard tracker so [P] view stays current
      const _pk = event.pet.toLowerCase();
      if (!knownPetOwners.has(_pk)) knownPetOwners.set(_pk, new Set());
      knownPetOwners.get(_pk).add(owner);
      // Charm-land specifically also starts a charm_session record. Other
      // pet_leader sources (the pet's own "My leader is" declare line or
      // the charm-tell "Attacking X Master") don't — those are summon /
      // group-pet flows, not the per-session-tracked charm cycle.
      if (event.source === 'charm_land') {
        const petKey = _pk;
        const startTs = this.lastEvent || Date.now();
        // De-dupe: if there's already an open session on this pet (same
        // owner), don't overwrite it. EQ sometimes fires the regards line
        // twice as the charm refreshes.
        const existing = (this._activeCharms ||= new Map()).get(petKey);
        if (existing && existing.owner === owner) return;
        // If the existing session is with a different owner, the previous
        // charm broke (we may not have caught the break line). Close it.
        if (existing) {
          existing.ended_at = startTs;
          existing.end_reason = 'charm_break';
          existing.duration_sec = Math.max(0, (startTs - existing.started_at) / 1000);
          this.charmSessions.push(existing);
        }
        // Was this Dire-Charmed? Match the pending DC flag within 10s by
        // caster name.
        const isDC = !!(this._pendingDireCharm
          && this._pendingDireCharm.caster
          && this._pendingDireCharm.caster.toLowerCase() === owner.toLowerCase()
          && (startTs - this._pendingDireCharm.ts) < 10_000);
        if (isDC) this._pendingDireCharm = null;
        this._activeCharms.set(petKey, {
          pet:           event.pet,
          owner,
          started_at:    startTs,
          last_damage_at: startTs,
          total_damage:  0,
          is_dire_charm: isDC,
          end_reason:    null,
          ended_at:      null,
          duration_sec:  null,
        });
      }
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
    // ── Bandolier swaps ──────────────────────────────────────────────────────
    // Track the currently-equipped set per character. 'loading' or
    // 'already_equipped' both update active. 'too_busy' / 'missing_item' /
    // 'no_slot' are kept as the last-known failure for the dashboard hint.
    if (event.type === 'bandolier') {
      const char = this.character || 'unknown';
      const prev = stats.activeBandolier[char] || {};
      if (event.action === 'loading' || event.action === 'already_equipped') {
        stats.activeBandolier[char] = {
          name: event.setName, ts: event.ts, status: 'equipped',
        };
      } else {
        stats.activeBandolier[char] = {
          name: prev.name || null, ts: event.ts, status: event.action,
          lastError: event.item || event.itemId || event.setName || null,
        };
      }
      return;
    }

    // ── Monk Mend ────────────────────────────────────────────────────────────
    // Counter-only event — not added to this.events, doesn't gate startedAt.
    // Crit rate is a per-character session stat surfaced on the Info screen.
    // Silent builders skip this so old log replays don't move the mend counter.
    if (event.type === 'mend') {
      if (!this.silent) {
        stats.sessionMends.attempts++;
        if (event.outcome === 'crit')        { stats.sessionMends.crit++;    stats.sessionMends.success++; }
        else if (event.outcome === 'regular'){ stats.sessionMends.success++; }
        else if (event.outcome === 'fail')   { stats.sessionMends.fail++; }
      }
      return;
    }

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

    // Dashboard tracking — sees every parsed damage event, not just uploaded ones.
    // Skip when this builder is in silent mode (e.g. backfill drivers) so old
    // log replays don't move live counters or threat tables.
    if (!this.silent) {
      try { recordEventForDashboard(event, this.character); } catch {}
      try { this._publishLiveThreat(); } catch {}
    }

    // Track damage dealt TO targets — exclude "YOU" / "you", confirmed players
    // (PvP), and self-hits (pet reclaim/dismiss generates attacker === defender).
    if (event.type === 'damage' && event.defender
        && !/^you$/i.test(event.defender)
        && !isConfirmedPlayer(event.defender)) {
      const rawAtk0 = event.attacker;
      const isSelfHit = rawAtk0 && rawAtk0.toLowerCase() === event.defender.toLowerCase();
      if (!isSelfHit) {
        this.targets.set(event.defender, (this.targets.get(event.defender) || 0) + (event.amount || 0));
      }
    }

    // Live threat tracking + DEEPS tracking — both bump per-player counters
    // on every damage event. Threat = hate proxy for tank monitoring; DEEPS
    // = damage breakdown by category (melee / spell / proc / dot) for the
    // DPS scoreboard tab.
    if (event.type === 'damage' && event.amount > 0) {
      const rawAtk = event.attacker;
      const attacker = (rawAtk === null || /^you$/i.test(rawAtk || ''))
        ? (this.character || 'You')
        : rawAtk;
      // Charm-session damage attribution. If the attacker is a pet with
      // an open charm session, add the damage to its session total so
      // the bot can compute avg DPS over the charmed duration.
      if (attacker && this._activeCharms?.size > 0) {
        const open = this._activeCharms.get(attacker.toLowerCase());
        if (open) {
          open.total_damage += event.amount;
          open.last_damage_at = this.lastEvent || Date.now();
        }
      }
      // Skip player-on-player damage (direct PvP or charm mechanics):
      //   • Named confirmed player as defender: "PlayerA hits PlayerB for N"
      //   • Uploader as defender AND attacker is a 3rd-party confirmed player:
      //     charmed raid member hits the log uploader
      // Also skip self-hits: pet reclaim / cleric pet dismiss hits itself for 20K.
      const pvpHit =
        (event.defender && !/^you$/i.test(event.defender) && isConfirmedPlayer(event.defender)) ||
        (/^you$/i.test(event.defender || '') && rawAtk !== null && isConfirmedPlayer(attacker)) ||
        (event.defender && rawAtk && rawAtk.toLowerCase() === event.defender.toLowerCase());
      // Skip NPC-on-NPC (multi-word attacker that isn't the uploader). The
      // multi-word filter catches things like "a clockwork dragoon", but
      // misses single-token boss names with no spaces — Vulak`Aerr,
      // Doomshade, Rumblecrush, Aaryonar, Klandicar, etc. Those still
      // showed up on the threat list as if they were players. Second
      // filter: anyone we've been DAMAGING this encounter (this.targets)
      // is by definition an NPC, so reject them too.
      const attackerIsKnownNpc = attacker && this.targets.has(attacker);
      if (!pvpHit && attacker && !attackerIsKnownNpc
          && (!/\s/.test(attacker) || attacker === this.character)) {
        if (!this.threatBy.has(attacker)) {
          this.threatBy.set(attacker, { swing: 0, proc: 0, spell: 0, heal: 0, procDetail: {} });
        }
        const t = this.threatBy.get(attacker);
        const a = (event.ability || '').toLowerCase();
        // Categorize for DEEPS tracking — same buckets the threat code uses
        let deepsCategory;
        if (MELEE_ABILITIES.has(a) || a === 'hit') deepsCategory = 'melee';
        else if (a === 'dot')                       deepsCategory = 'dot';
        else if (a === 'non-melee' || a === '')     deepsCategory = 'proc';
        else                                        deepsCategory = 'spell';
        this._bumpDeeps(attacker, deepsCategory, event.amount, event.ability);
        // PROC_HATE catalog takes precedence for threat — known threat procs
        // use their flat hate value (e.g. Enraging Blow = 700 hate per trigger)
        // rather than a damage-proxy. Also count occurrences for the breakdown.
        if (a && PROC_HATE[a] !== undefined) {
          t.proc += PROC_HATE[a];
          t.procDetail[event.ability] = (t.procDetail[event.ability] || 0) + 1;
        } else if (deepsCategory === 'melee') {
          t.swing += event.amount;                 // 1 hate per damage (proxy)
        } else if (deepsCategory === 'proc' || deepsCategory === 'dot') {
          t.proc  += event.amount * 1.3;           // unnamed procs / DS-style
        } else {
          t.spell += event.amount * 1.5;           // named spells / songs / dirges
        }
      }
    }
    // Crit attribution for DEEPS — increment count + bonus damage when we see
    // a "X Scores a critical hit!(N)" event. Categorize as melee vs spell by
    // looking at the player's prior 1 second of activity (heuristic).
    if (event.type === 'critical' && event.attacker && event.amount > 0) {
      const attacker = /^you$/i.test(event.attacker) ? (this.character || 'You') : event.attacker;
      // Skip crits against other players (PvP / charm) same as damage events
      const critOnPlayer = event.defender && !/^you$/i.test(event.defender) && isConfirmedPlayer(event.defender);
      if (!critOnPlayer && attacker && (!/\s/.test(attacker) || attacker === this.character)) {
        this._bumpDeeps(attacker, 'crit', event.amount, null);
      }
    }

    // Taunt/stun — non-damage hate credited to the uploader's character.
    // Successful taunt ("You have taunted X") places the taunter at top threat +1,
    // matching real EQ aggro mechanics. Failed attempts use a flat 500 proxy.
    if ((event.type === 'taunt' || event.type === 'stun') && this.character) {
      const attacker = this.character;
      if (!this.threatBy.has(attacker)) {
        this.threatBy.set(attacker, { swing: 0, proc: 0, spell: 0, heal: 0, procDetail: {} });
      }
      const t = this.threatBy.get(attacker);
      const label = event.type === 'taunt' ? 'Taunt' : 'Stun';
      t.procDetail[label] = (t.procDetail[label] || 0) + 1;
      if (event.type === 'taunt' && event.success) {
        // Set taunter to current max threat across all players + 1
        let maxThreat = 0;
        for (const [, ot] of this.threatBy) {
          const tot = ot.swing + ot.proc + ot.spell + ot.heal;
          if (tot > maxThreat) maxThreat = tot;
        }
        const current = t.swing + t.proc + t.spell + t.heal;
        t.proc += Math.max(1, maxThreat + 1 - current);
      } else {
        t.proc += PROC_HATE[event.type] || 0;
      }
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
    // ── Cast attempt counter ───────────────────────────────────────────────
    // Per-character per-spell cast attempts (session-scoped on stats; surfaces
    // on the Info tab). Reliable for the uploader (always knows the spell);
    // for other casters EQ logs "<X> begins to cast a spell" with no name,
    // so those entries land under ability="(unknown)" — still useful as raw
    // cast-volume. Silent builders (opt-in backfill) skip this so old log
    // replays don't move the counter.
    if (event.type === 'cast' && !this.silent) {
      const caster = event.attacker || this.character;
      const spell  = event.ability || '(unknown)';
      if (caster) {
        const byChar = stats.castCounts[caster] || (stats.castCounts[caster] = {});
        byChar[spell] = (byChar[spell] || 0) + 1;
      }
    }

    // Exceptional/critical heals — bystander-visible "<X> performs an
    // exceptional heal! (N)" lines. Tracked as a separate session counter
    // since these reliably populate from a single parser anywhere in the
    // raid, unlike regular heal totals which depend on the healer or
    // target running the agent.
    if (event.type === 'crit_heal' && event.attacker && !this.silent) {
      const name = event.attacker;
      const amount = event.amount || 0;
      const cur = stats.sessionCritHeals[name] || (stats.sessionCritHeals[name] = { count: 0, total: 0, max: 0, lastSeen: 0 });
      cur.count++;
      cur.total += amount;
      if (amount > cur.max) cur.max = amount;
      cur.lastSeen = Date.now();
    }

    if (event.type === 'heal' && (event.attacker || this.character)) {
      const healer = event.attacker || this.character;
      this._bumpHealer(healer, event.defender, event.amount || 0);
      // Live threat: heals generate hate roughly 0.5 per heal point in Luclin-era
      if (healer && event.amount > 0 && (!/\s/.test(healer) || healer === this.character)) {
        if (!this.threatBy.has(healer)) {
          this.threatBy.set(healer, { swing: 0, proc: 0, spell: 0, heal: 0 });
        }
        this.threatBy.get(healer).heal += event.amount * 0.5;
      }
      // ── Boss self-heal (Lady Vox, Naggy, Vyrkma etc. Complete Heal themselves) ──
      // If the same name appears on both sides of a heal AND it's a name we've
      // been damaging this fight, attribute the amount to npcHealedTotal.
      // The bot shows this as "27.1k (+10k healed)" on parse cards so the
      // raid sees how much HP they pushed through, not just damage dealt.
      if (event.amount > 0 && event.attacker && event.defender
          && event.attacker.toLowerCase() === event.defender.toLowerCase()
          && this.targets.has(event.attacker)) {
        this.npcHealedTotal = (this.npcHealedTotal || 0) + event.amount;
      }
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
      // Is this a player? The uploader always is; otherwise require the
      // confirmed-player whitelist (whoData / chat speakers / healers /
      // watched logs) so single-word NPC names like 'Nillipuss' don't get
      // counted as a player death.
      const isPlayer = !!defName && (
        defName === this.character ||
        isConfirmedPlayer(defName)
      );
      if (isPlayer) {
        const deathTs      = Date.parse(event.ts) || Date.now();
        const lastRip      = this.recentRiposteDmg.get(defName);
        const riposteDeath = !!lastRip && (deathTs - lastRip) <= 3000;
        const whoEntry     = whoData.get(defName.toLowerCase());
        const charClass    = whoEntry?.class?.trim() || null;
        this.deaths.push({ name: defName, ts: event.ts, riposteDeath, class: charClass });
        // Silent builders (opt-in backfill) skip the session-wide deaths
        // counter — old log replays shouldn't move the Deaths panel.
        if (!this.silent) {
          stats.sessionDeaths[defName] = (stats.sessionDeaths[defName] || 0) + 1;
        }
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
    // If we've been silent for >120s and have events, flush
    if (this.events.length && this.lastEvent) {
      const last = new Date(this.lastEvent).getTime();
      if (now - last > 120_000) this.flush();
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
    // Confirmed player as the bossName means we ended up attributing this
    // encounter to a guild member — usually a damage shield or charm/fear
    // quirk where a player ate hits without it actually being a "kill them"
    // fight. Skip the flush so it doesn't surface as a Recent Parse or
    // upload to the bot. The underlying events still flowed through
    // parseEvent so any per-player stats accumulated. Only PvP kill
    // broadcasts (handled via /api/agent/pvp) should turn into surfaced
    // parses for player targets.
    if (this.bossName && isConfirmedPlayer(this.bossName)) {
      this.reset();
      return;
    }
    // No identifiable target = nothing useful to upload (all-heal or background noise)
    if (!this.bossName) {
      this.reset();
      return;
    }
    // Skip encounters where the detected boss is a player pet (beastlord eye
    // warders, clockwork eyes, familiar eyes, etc.). These are owned familiars
    // that should never generate parse cards.
    if (/^eye\s+of\s+/i.test(this.bossName)) {
      this.reset();
      return;
    }
    // Skip encounters where the detected "boss" is actually a player, a known
    // pet, or the uploader themselves. Pet reclaims/dismisses can trigger a
    // death event with the pet as defender, which would otherwise post a
    // bogus parse card naming the pet as the boss.
    const _bnLower = this.bossName.toLowerCase();
    const _isPet     = !!this.petLeaders[_bnLower] || knownPetOwners.has(_bnLower);
    const _isPlayer  = isConfirmedPlayer(this.bossName);
    const _isUploader = this.character && _bnLower === this.character.toLowerCase();
    if (_isPet || _isPlayer || _isUploader) {
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

    // ── Per-character ability rollup (going-forward telemetry) ─────────────
    // Bucketed by verb/skill so the server can answer "what did each player
    // hit with, and how often" without keeping the raw event stream. Pets are
    // attributed to their owner where known. Self-attacks (attacker resolves
    // to the same character as defender — charm break, fat-finger /assist,
    // riposted swings on self) are counted separately.
    //
    // Bystander spell names are "(unknown)" in EQ logs — these rollups are
    // reliable for the uploader and for melee/skill verbs across the board;
    // remote players' spell names are not.
    const _uploader = this.character || null;
    const _resolve = (name) => {
      if (!name) return _uploader;
      const owner = this.petLeaders[String(name).toLowerCase()];
      return owner || name;
    };
    const _rollupByChar = {};
    for (const ev of this.events) {
      if (ev.type !== 'damage') continue;
      const attacker = _resolve(ev.attacker);
      const defender = _resolve(ev.defender);
      if (!attacker) continue;
      const amt = Number(ev.amount) || 0;
      const skillKey = (ev.ability ? String(ev.ability) : 'unknown').slice(0, 64);

      let bucket = _rollupByChar[attacker];
      if (!bucket) {
        bucket = _rollupByChar[attacker] = {
          by_skill: {}, total_hits: 0, total_damage: 0, self_attack_count: 0,
        };
      }
      let s = bucket.by_skill[skillKey];
      if (!s) s = bucket.by_skill[skillKey] = { hits: 0, dmg: 0 };
      s.hits += 1;
      s.dmg  += amt;
      bucket.total_hits   += 1;
      bucket.total_damage += amt;

      if (defender && attacker.toLowerCase() === defender.toLowerCase()) {
        bucket.self_attack_count += 1;
      }
    }
    const _rollup = Object.keys(_rollupByChar).length
      ? { by_char: _rollupByChar }
      : undefined;

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
        // Boss self-heal total — sum of damage the NPC healed back to itself
        // during the fight (Lady Vox Complete Heal, Naggy AE heal, etc.).
        // Surfaced on parse cards as "27.1k (+10k healed)" so the raid sees
        // how much HP they actually had to push through.
        npc_healed_total: this.npcHealedTotal > 0 ? this.npcHealedTotal : undefined,
        // Per-pet charm sessions during this encounter — start + end + damage
        // accumulated while charmed. Closed sessions already in
        // this.charmSessions; any still-open sessions get closed here with
        // end_reason='encounter_flush' so the bot has a complete record
        // even when the charm break line wasn't seen. Dire Charm sessions
        // that survive past the encounter would normally need cross-fight
        // tracking — for now we still close at flush since the encounter
        // is the persistence unit; subsequent damage in another fight
        // produces a new session (which is fine, the bot dedupes on
        // started_at).
        charm_sessions: (() => {
          const all = [...this.charmSessions];
          for (const open of this._activeCharms.values()) {
            open.ended_at     = open.last_damage_at || this.lastEvent || open.started_at;
            open.end_reason   = open.end_reason || 'encounter_flush';
            open.duration_sec = Math.max(0, (open.ended_at - open.started_at) / 1000);
            all.push(open);
          }
          return all.length > 0 ? all : undefined;
        })(),
        // Per-character verb/skill rollup. Server upserts into
        // encounter_combat_rollup and stamps contributions.has_ability_detail.
        // Absent on older agents → rollup tables stay empty for those uploads.
        rollup:      _rollup,
        events:      this.events,
      },
    };
    // ── Accumulate into session stats ─────────────────────────────────────
    // Silent builders (opt-in backfill) skip every session-stat roll-up
    // here so old log replays don't pollute the live dashboard panes —
    // the encounter still uploads to the bot for Supabase persistence
    // (via onFlush), it just doesn't move the local "this session"
    // counters.
    if (!this.silent) {
      // Defender stats (tanks) — single-word names only (skip NPCs).
      // Defender stats now stream live into stats.sessionDefenders via
      // _bumpDefender, so dashboard reflects damage taken even when a
      // fight ends without a kill (wipes, gating out, etc.). We only
      // need flush() to add invulnAvoidedDmg here because it requires
      // the per-encounter bossMaxMelee × invulns product.
      for (const [name, s] of this.defenderStats) {
        if (/\s/.test(name)) continue;
        if (!stats.sessionDefenders[name]) continue;  // already initialised live
        const sd = stats.sessionDefenders[name];
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
      // Mob proc counter is intentionally NOT accumulated anymore — the
      // panel that consumed it surfaced misclassified data (player names
      // landing under "pet" entries) and was removed from the dashboard
      // pending a real design. Keep the events flowing for the upload
      // payload; just don't roll them into stats.sessionProcs.
    }

    this.onFlush(payload);
    // Stamp the live-threat snapshot so the dashboard can show stale data
    // for ~2 min after a fight ends rather than blanking the Threat panel immediately.
    if (stats.currentEncounterThreat) {
      stats.currentEncounterThreat = { ...stats.currentEncounterThreat, flushedAt: Date.now() };
    }
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

// ── Durable upload queue ─────────────────────────────────────────────────────
// Every outbound POST (encounter, chat, pvp, bosskill, lockout, historical_chat,
// fun_event) goes through this queue. Network errors, DNS hiccups, 5xx
// responses, and timeouts don't drop data — entries stay in the queue and
// retry on an exponential backoff. The drain loop walks the queue every 15s.
// On agent restart, the queue is read from disk and replayed before any new
// work — so a crash mid-outage doesn't lose anything either.
//
// Permanent 4xx responses (400/401/403/404/422) drop the entry from the
// queue with a loud warning — those won't fix themselves by retrying.
const QUEUE_FILE             = path.join(__dirname, 'logsync.queue.json');
const QUEUE_MAX_SIZE         = 5000;     // FIFO cap; oldest dropped with a warning
// Backpressure watermarks (hysteresis): when a backfill is filling the queue
// faster than the drain loop empties it, PAUSE the file read at HIGH and don't
// resume until it drains below LOW. This stops the cap from FIFO-evicting good
// data during a big --since replay. Live tail is unaffected (it never feeds
// fast enough to matter).
const QUEUE_BACKPRESSURE_HIGH = Math.floor(QUEUE_MAX_SIZE * 0.9);   // 4500 — pause
const QUEUE_BACKPRESSURE_LOW  = Math.floor(QUEUE_MAX_SIZE * 0.6);   // 3000 — resume
const QUEUE_DRAIN_INTERVAL_MS = 15_000;  // walk the queue every 15s
const QUEUE_REQUEST_TIMEOUT_MS = 30_000; // per-attempt HTTP timeout
const QUEUE_MAX_PER_DRAIN_PASS = 50;     // cap parallel work per drain so a
                                         // 5000-entry backlog doesn't wedge
                                         // a single pass for hours
const QUEUE_BACKOFF_MS = [30_000, 60_000, 120_000, 240_000, 480_000, 600_000];
const QUEUE_PERMANENT_CODES = new Set([400, 401, 403, 404, 422]);

let _uploadQueue       = [];        // in-memory mirror, persisted to QUEUE_FILE
let _queueDrainTimer   = null;
let _queueSaveTimer    = null;
let _queueDraining     = false;     // re-entrancy guard for the drain loop
let _queueUploadOpts   = null;      // { botUrl, token } — set by startUploadQueueDrain
let _queuePermanentDropCount = 0;   // 4xx responses since startup
let _queueCapEvictCount      = 0;   // FIFO evictions because queue hit MAX_SIZE

function _loadQueueFromDisk() {
  if (!fs.existsSync(QUEUE_FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    if (Array.isArray(raw?.pending)) {
      _uploadQueue = raw.pending;
      console.log(`[upload-queue] loaded ${_uploadQueue.length} pending entr${_uploadQueue.length === 1 ? 'y' : 'ies'} from disk`);
    }
  } catch (err) {
    // The file exists but couldn't be parsed — likely truncated during a
    // crash mid-write. Move it aside (instead of silently dropping its
    // contents) so the user can recover or report it if it matters.
    const aside = QUEUE_FILE + '.corrupt-' + Date.now();
    try { fs.renameSync(QUEUE_FILE, aside); }
    catch (renameErr) { console.warn(`[upload-queue] could not move corrupt queue aside: ${renameErr.message}`); }
    console.warn(`[upload-queue] queue file unreadable (${err.message}); moved to ${path.basename(aside)} and starting empty`);
  }
}

function _saveQueueToDisk() {
  // Debounce to 500ms so a burst of enqueue+drain cycles writes once.
  if (_queueSaveTimer) return;
  _queueSaveTimer = setTimeout(() => {
    _queueSaveTimer = null;
    _flushQueueToDiskSync();
  }, 500);
}

// Synchronous flush used by debounced timer AND by every process-exit
// pathway. Cancels any pending debounce so we don't race with ourselves.
function _flushQueueToDiskSync() {
  if (_queueSaveTimer) { clearTimeout(_queueSaveTimer); _queueSaveTimer = null; }
  try {
    const tmp = QUEUE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ pending: _uploadQueue }));
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (err) {
    console.warn(`[upload-queue] save failed: ${err.message}`);
  }
}

function _queueId() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

// Build the actual POST URL for a given queue entry. We store only the
// `kind` per entry; the endpoint path is derived here from the configured
// botUrl so a botUrl change between sessions still routes correctly.
function _endpointForKind(kind, botUrl) {
  const base = botUrl.replace(/\/encounter(\?.*)?$/, '');
  switch (kind) {
    case 'encounter':       return botUrl;             // already /api/agent/encounter
    case 'chat':            return base + '/chat';
    case 'pvp':             return base + '/pvp';
    case 'bosskill':        return base + '/bosskill';
    case 'lockout':         return base + '/lockout';
    case 'historical_chat': return base + '/historical_chat';
    case 'fun_event':       return base + '/fun_event';
    case 'tells':           return base + '/tells';
    default:                return botUrl;
  }
}

function enqueueUpload(kind, payload) {
  if (_uploadQueue.length >= QUEUE_MAX_SIZE) {
    const dropped = _uploadQueue.shift();
    _queueCapEvictCount++;
    console.warn(`[upload-queue] cap reached (${QUEUE_MAX_SIZE}); dropped oldest ${dropped.kind} from ${new Date(dropped.queued_at).toISOString()}`);
  }
  // Decorate every payload with agent_state so the bot's admin tooling can
  // tell who/what is uploading without each call-site repeating the info.
  // WOLFPACK_CLIENT identifies the wrapper (e.g. 'mimic'); default 'parser'
  // for Parser.bat installs. WOLFPACK_APP_VERSION lets Mimic stamp its own
  // semver so the admin board can show beta.X without parsing tray strings.
  if (payload && typeof payload === 'object' && !payload.agent_state) {
    payload.agent_state = {
      client:       process.env.WOLFPACK_CLIENT      || 'parser',
      app_version:  process.env.WOLFPACK_APP_VERSION || null,
      platform:     process.platform,
      node_version: process.versions && process.versions.node,
    };
  }
  const entry = {
    id:          _queueId(),
    kind,
    payload,
    attempts:    0,
    queued_at:   Date.now(),
    next_try_at: Date.now(),
    last_error:  null,
  };
  _uploadQueue.push(entry);
  _saveQueueToDisk();
  // Kick the drain loop immediately so live uploads still feel real-time
  // when the network is healthy.
  if (_queueUploadOpts) _drainUploadQueue().catch(() => {});
  return entry.id;
}

// One HTTP attempt. Returns { ok, permanent, statusCode, body }.
function _doOneUpload(entry) {
  return new Promise((resolve) => {
    const opts = _queueUploadOpts;
    if (!opts) {
      resolve({ ok: false, permanent: false, statusCode: 0, body: 'no upload opts configured' });
      return;
    }
    let target;
    try { target = _endpointForKind(entry.kind, opts.botUrl); }
    catch (err) { resolve({ ok: false, permanent: false, statusCode: 0, body: err.message }); return; }

    let url;
    try { url = new URL(target); }
    catch (err) { resolve({ ok: false, permanent: true, statusCode: 0, body: 'bad URL: ' + err.message }); return; }

    const mod = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(entry.payload);
    const req = mod.request({
      method:   'POST',
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(opts.token ? { 'Authorization': `Bearer ${opts.token}` } : {}),
        'User-Agent':     `wolfpack-logsync/${AGENT_VERSION}`,
      },
      timeout:  QUEUE_REQUEST_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const sc = res.statusCode || 0;
        if (sc >= 200 && sc < 300) {
          resolve({ ok: true,  permanent: false, statusCode: sc, body: data });
        } else if (QUEUE_PERMANENT_CODES.has(sc)) {
          resolve({ ok: false, permanent: true,  statusCode: sc, body: data });
        } else {
          resolve({ ok: false, permanent: false, statusCode: sc, body: data });
        }
      });
    });
    req.on('error',   (err) => resolve({ ok: false, permanent: false, statusCode: 0, body: err.message || String(err) }));
    req.on('timeout', ()    => { req.destroy(); resolve({ ok: false, permanent: false, statusCode: 0, body: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// Side-effects on a successful encounter upload — refresh server-advertised
// agent version + requested-character list + (for live, non-backfill) the
// recent-parses dashboard counter. Mirrors what the old uploadEncounter
// did inline before the queue refactor.
function _onUploadSuccess(entry, responseText) {
  if (entry.kind !== 'encounter') return;
  try {
    const resp = JSON.parse(responseText);
    if (resp.latest_agent_version) {
      stats.latestAgentVersion     = resp.latest_agent_version;
      stats.latestVersionCheckedAt = Date.now();
      stats.updateAvailable        = isNewerVersion(resp.latest_agent_version, AGENT_VERSION);
    }
    if (Array.isArray(resp.requested_characters)) {
      stats.requestedCharacters = resp.requested_characters;
    }
  } catch { /* non-fatal */ }
  const isBackfill = entry.payload?.backfill === true;
  if (!isBackfill) recordUploadForDashboard(entry.payload, entry.payload?.character);
}

async function _drainUploadQueue() {
  if (_queueDraining) return;
  if (!_queueUploadOpts) return;
  if (_uploadQueue.length === 0) return;
  _queueDraining = true;
  try {
    const now = Date.now();
    // Snapshot the due entries — new enqueues during this loop iteration get
    // picked up on the next pass. Cap parallel work so a huge backlog
    // doesn't wedge a single pass for hours; the next interval (15s)
    // picks up the rest.
    const due = _uploadQueue.filter(e => e.next_try_at <= now).slice(0, QUEUE_MAX_PER_DRAIN_PASS);
    if (due.length === 0) return;

    let stateChanged = false;
    for (const entry of due) {
      const result = await _doOneUpload(entry);
      const idx = _uploadQueue.indexOf(entry);
      if (idx === -1) continue; // dropped under us (queue cap)

      if (result.ok) {
        _uploadQueue.splice(idx, 1);
        try { _onUploadSuccess(entry, result.body); } catch {}
        stateChanged = true;
      } else if (result.permanent) {
        _uploadQueue.splice(idx, 1);
        _queuePermanentDropCount++;
        stats.uploadErrors++;
        const snip = (result.body || '').toString().slice(0, 200);
        console.warn(`[upload-queue] permanent failure ${result.statusCode} for ${entry.kind}; dropping. body=${snip}`);
        stateChanged = true;
      } else {
        entry.attempts++;
        entry.last_error = `${result.statusCode || 'net'}: ${(result.body || '').toString().slice(0, 200)}`;
        const backoffIdx = Math.min(entry.attempts - 1, QUEUE_BACKOFF_MS.length - 1);
        entry.next_try_at = Date.now() + QUEUE_BACKOFF_MS[backoffIdx];
        stats.uploadErrors++;
        if (entry.attempts === 1 || entry.attempts === 5 || entry.attempts === 20) {
          console.warn(`[upload-queue] retrying ${entry.kind} (attempt ${entry.attempts}, next in ${Math.round(QUEUE_BACKOFF_MS[backoffIdx]/1000)}s): ${entry.last_error}`);
        }
        stateChanged = true;
      }
    }
    if (stateChanged) {
      _saveQueueToDisk();
      scheduleRender();
    }
  } finally {
    _queueDraining = false;
  }
  // If we capped this pass and there's still due work waiting, kick another
  // pass after a short pause so a 5000-entry backlog drains in ~5min total
  // (5000 / 50 = 100 passes * 3s = 5min) rather than 15s * 100 passes = 25min.
  const now = Date.now();
  if (_uploadQueue.some(e => e.next_try_at <= now)) {
    setTimeout(() => _drainUploadQueue().catch(() => {}), 3_000);
  }
}

function startUploadQueueDrain(uploadOpts) {
  _queueUploadOpts = uploadOpts;
  _loadQueueFromDisk();
  if (_queueDrainTimer) clearInterval(_queueDrainTimer);
  // Immediate kick on startup so anything left from a crashed previous
  // session replays right away.
  _drainUploadQueue().catch(() => {});
  _queueDrainTimer = setInterval(() => {
    _drainUploadQueue().catch(() => {});
  }, QUEUE_DRAIN_INTERVAL_MS);
  // Sync-flush the queue on any process-exit pathway so the debounced timer
  // can't drop in-memory entries on Ctrl+C / SIGTERM / [U] update / etc.
  // Registered idempotently — the listener list won't grow on repeated
  // start calls (e.g. test harnesses).
  if (!_queueExitHooked) {
    _queueExitHooked = true;
    const flush = () => { try { _flushQueueToDiskSync(); } catch {} };
    process.on('exit',  flush);
    process.on('SIGINT',  () => { flush(); process.exit(0); });
    process.on('SIGTERM', () => { flush(); process.exit(0); });
  }
}
let _queueExitHooked = false;

// Dashboard + update-gate helpers. uploadQueueSnapshot is read-only; callers
// shouldn't mutate the returned objects.
function uploadQueueSnapshot() {
  const byKind = {};
  let oldest = null;
  let maxAttempts = 0;
  let lastError = null;
  for (const e of _uploadQueue) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    if (!oldest || e.queued_at < oldest) oldest = e.queued_at;
    if (e.attempts > maxAttempts) {
      maxAttempts = e.attempts;
      lastError = e.last_error;
    }
  }
  return {
    pending:           _uploadQueue.length,
    byKind,
    oldestQueuedAt:    oldest,
    maxAttempts,
    lastError,
    permanentDropped:  _queuePermanentDropCount,
    capEvicted:        _queueCapEvictCount,
  };
}

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
  // sessionMends: Monk Mending skill counts — { attempts, success, crit, fail }
  // Only the uploader's own mends are counted (mend lines start "You mend...").
  sessionMends:    { attempts: 0, success: 0, crit: 0, fail: 0 },
  // sessionCritHeals: per-healer exceptional/critical heal totals. Bystander-
  // visible on Quarm via "<X> performs an exceptional heal! (N)" — so this
  // populates from a single parser anywhere in the raid, no healer-side
  // adoption required. { [healerName]: { count, total, max, lastSeen } }
  sessionCritHeals: {},
  // sessionProcs: non-melee (spell/proc) abilities mobs used this session, per mob.
  // { mobName: { [abilityName]: { count, totalDmg } } }
  sessionProcs:    {},
  uploadCount:     0,
  uploadErrors:    0,
  updateAvailable:      false,      // true when server reports a newer agent version
  latestAgentVersion:   null,       // the server-advertised version (e.g. '2.3.24')
  latestVersionCheckedAt: null,     // last poll timestamp (ms)
  // castCounts: per-character per-spell cast attempt counter. Surfaced on
  // the Info tab. Reliable for the uploader (their "You begin casting <X>"
  // lines always include the spell name); for other casters EQ logs
  // "<X> begins to cast a spell" without the name, so we track those under
  // ability="(unknown)" — still useful as a raw cast volume metric.
  // Schema: { [casterName]: { [spellName]: count } }
  castCounts:      {},
  // currentEncounterThreat: live threat snapshot for the active encounter
  // (null when no fight is active). { bossName, startedAt, perPlayer: { name: { swing, proc, spell, heal, total } } }
  currentEncounterThreat: null,
  // sessionDeeps: per-attacker DPS breakdown across all encounters this session.
  // { [name]: { melee, spell, proc, dot: { count, total, max }, crits: { total, melee, spell, bonusDmg } } }
  // Live-updated; surfaced on the DEEPS tab.
  sessionDeeps:    {},
  // activeBandolier: most-recently-loaded bandolier set per character.
  // { [character]: { name, ts, status } }  status: 'equipped' | 'too_busy' | 'missing_item' | 'no_slot'
  activeBandolier: {},
  // characterInventories: parsed /output inventory files for each known character.
  // { [characterName]: { weapons: { primary, secondary, range, ammo }, worn: {...}, _updatedAt, _path } }
  characterInventories: {},
  requestedCharacters:  [],         // characters the server needs for parse completeness
  // Officer-filed backfill requests for any character this agent is watching.
  // Populated by pollBackfillRequests every 5 min; rendered on the Opt-in tab
  // with Accept/Dismiss buttons that POST back to the bot.
  backfillRequests:      [],
  backfillRequestsCheckedAt: null,
  // Officer-tuned raid triggers — see pollGuildTriggers / evaluateTriggersAgainstLine.
  // Each entry includes a precompiled _regex for the hot eval path.
  guildTriggers:           [],
  guildTriggersVersion:    null,
  guildTriggersCheckedAt:  null,
  // Map of character.name (lowercase) → class, used for server-side trigger
  // targeting (?classes=Warrior,Cleric on the fetch). Populated from /who.
  characterClasses:        {},
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

// Zero out every session-scoped field on `stats` while preserving lifetime
// totals, the active encounter pointer, watched-log list, and persisted
// loadout/inventory state. Called by the dashboard "Reset session" button.
function resetSessionStats() {
  stats.startedAt          = Date.now();
  stats.recentParses       = [];
  stats.topDamageSaw       = [];
  stats.topDamageDid       = [];
  stats.sessionEvents      = 0;
  stats.sessionTotalDamage = 0;
  stats.sessionDamageBy    = {};
  stats.abilityStats       = new Map();
  stats.sessionDeaths      = {};
  stats.sessionHealers     = {};
  stats.sessionDefenders   = {};
  stats.sessionMends       = { attempts: 0, success: 0, crit: 0, fail: 0 };
  stats.sessionCritHeals   = {};
  stats.sessionProcs       = {};
  stats.sessionDeeps       = {};
  stats.castCounts         = {};
  stats.uploadCount        = 0;
  stats.uploadErrors       = 0;
  stats.lastUploadAt       = null;
  stats.currentEncounterThreat = null;
  // Don't wipe activeBandolier or characterInventories — those are
  // long-lived references the user expects to persist.
  scheduleRender();
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

// ── PID/service file ───────────────────────────────────────────────────────
// Written on startup when a process is going to act as the long-lived agent.
// Lets a second invocation detect an existing service and either show its
// dashboard or exit gracefully instead of double-tailing the same log files.
const PID_FILE = path.join(__dirname, 'logsync.pid.json');

function writePidFile(webPort) {
  try {
    fs.writeFileSync(PID_FILE, JSON.stringify({
      pid:          process.pid,
      webPort:      webPort || null,
      startedAt:    new Date().toISOString(),
      agentVersion: AGENT_VERSION,
    }, null, 2));
  } catch { /* non-fatal */ }
}
function removePidFile() {
  try { fs.unlinkSync(PID_FILE); } catch {}
}

// Read PID file; return null if missing or stale (process no longer exists).
function readActivePid() {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    if (!raw.pid) return null;
    // process.kill(pid, 0) throws if the process is dead — that's the probe.
    try { process.kill(raw.pid, 0); }
    catch { removePidFile(); return null; }
    return raw;
  } catch { return null; }
}

// Cross-platform "open a URL in the default browser" — non-blocking, errors
// swallowed so a missing browser binary doesn't crash the agent. On Windows
// the empty quoted string after `start` is the window title slot (without it
// `start "http://..."` would interpret the URL as the title).
// Strict semver-style comparison so we don't flag "update available" when
// the local agent is actually NEWER than what the bot is advertising
// (e.g. you're running a dev/test build with a higher version number).
// Returns true only when `a` is strictly greater than `b`.
function isNewerVersion(a, b) {
  if (!a || !b) return false;
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function openDashboardInBrowser(port) {
  const url = `http://localhost:${port}`;
  try {
    const { exec } = require('child_process');
    if (process.platform === 'win32')      exec(`start "" "${url}"`);
    else if (process.platform === 'darwin') exec(`open "${url}"`);
    else                                    exec(`xdg-open "${url}"`);
  } catch { /* non-fatal */ }
}

// Probe the existing service's web dashboard to confirm it's our agent and
// not a random process that happens to own the PID.
async function probeWebDashboard(port) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/state', method: 'GET', timeout: 1500,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve(!!(j && j.version));
        } catch { resolve(false); }
      });
    });
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

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
      sessionMends:       stats.sessionMends,
      sessionCritHeals:   stats.sessionCritHeals,
      sessionDeeps:       stats.sessionDeeps,
      abilityStats:       Object.fromEntries(stats.abilityStats),
      castCounts:         stats.castCounts,
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
    if (raw.sessionMends)       stats.sessionMends       = raw.sessionMends;
    if (raw.sessionCritHeals)   stats.sessionCritHeals   = raw.sessionCritHeals;
    if (raw.sessionDeeps)       stats.sessionDeeps       = raw.sessionDeeps;
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
    if (raw.castCounts) stats.castCounts = raw.castCounts;
    // Consume the file so the next clean exit must explicitly re-write it
    try { fs.unlinkSync(SESSION_FILE); } catch {}
    return true;
  } catch { return false; }
}

// ── Web dashboard (--web-port) ─────────────────────────────────────────────
// Embedded HTTP server on 127.0.0.1 that serves a single self-contained HTML
// page. The page polls /api/state every 2s and renders the same data the TUI
// shows. Lets users run logsync as a Windows service / scheduled task with no
// visible window and browse the dashboard on demand.
//
// Binds 127.0.0.1 only — never exposes the dashboard to the network.

function _serializeForDashboard() {
  const healersOut = {};
  for (const [name, s] of Object.entries(stats.sessionHealers || {})) {
    healersOut[name] = {
      healed:  s.healed || 0,
      ticks:   s.ticks  || 0,
      targets: [...(s.targets || [])],
    };
  }
  return {
    version:            AGENT_VERSION,
    startedAt:          stats.startedAt,
    sessionEvents:      stats.sessionEvents,
    sessionTotalDamage: stats.sessionTotalDamage,
    sessionDamageBy:    stats.sessionDamageBy,
    recentParses:       stats.recentParses,
    topDamageSaw:       stats.topDamageSaw,
    topDamageDid:       stats.topDamageDid,
    sessionDefenders:   stats.sessionDefenders,
    sessionHealers:     healersOut,
    sessionCritHeals:   stats.sessionCritHeals || {},
    sessionProcs:       stats.sessionProcs,
    sessionDeaths:      stats.sessionDeaths,
    sessionMends:       stats.sessionMends,
    abilityStats:       Object.fromEntries(stats.abilityStats),
    castCounts:         stats.castCounts,
    watchedLogs:        stats.watchedLogs,
    uploadCount:        stats.uploadCount,
    uploadErrors:       stats.uploadErrors,
    updateAvailable:    stats.updateAvailable,
    latestAgentVersion: stats.latestAgentVersion,
    currentEncounterThreat: stats.currentEncounterThreat,
    characterInventories:   stats.characterInventories,
    hiddenLoadoutChars:     [...(_optinState.hiddenLoadoutChars || [])],
    activeBandolier:        stats.activeBandolier,
    sessionDeeps:           stats.sessionDeeps,
    requestedCharacters: stats.requestedCharacters,
    backfillRequests:    stats.backfillRequests,
    backfillRequestsCheckedAt: stats.backfillRequestsCheckedAt,
    // Trigger summary for the dashboard. Strip _regex (not JSON-safe).
    guildTriggerCount:   (stats.guildTriggers || []).length,
    guildTriggersCheckedAt: stats.guildTriggersCheckedAt,
    personalTriggerCount: (_personalTriggers || []).length,
    activeOverlays:      _activeOverlays,
    lifetime:           stats.lifetime,
    // Only surface the resume banner for the first 2 minutes after restore —
    // after that the user knows, and a stale banner is just noise.
    sessionResumed:     !!stats._sessionRestoredBanner
                        && stats._sessionRestoredAt
                        && (Date.now() - stats._sessionRestoredAt) < 120_000,
    knownPets:          [...knownPetOwners.entries()].map(([pet, owners]) => ({ pet, owners: [...owners] })),
    uploadQueue:        uploadQueueSnapshot(),
    updateBlocked:      _updateBlockedReason(),
  };
}

// Update-gate evaluator. Returns null when an update is safe, or a short
// human-readable reason string when it isn't. Three blockers (any one is
// enough): pending uploads in the queue, an opt-in backfill running, or
// an active live fight currently accumulating events.
function _updateBlockedReason() {
  if (_uploadQueue.length > 0) {
    return `${_uploadQueue.length} pending upload${_uploadQueue.length === 1 ? '' : 's'}`;
  }
  if (typeof _activeBackfills !== 'undefined' && _activeBackfills.size > 0) {
    return `${_activeBackfills.size} opt-in backfill${_activeBackfills.size === 1 ? '' : 's'} running`;
  }
  // Active fight check: any tail-mode EncounterBuilder with events that
  // haven't been flushed yet. We don't have a direct registry; instead
  // check stats.currentEncounterThreat — the agent updates this on every
  // damage event, and it's cleared when the fight ends. If it's set and
  // recent (last threat publish < 60s ago) we're mid-fight.
  const et = stats.currentEncounterThreat;
  if (et && !et.flushedAt) {
    return 'active fight in progress';
  }
  return null;
}

// ⚠️ ESCAPE HAZARD — READ BEFORE EDITING THE DASHBOARD JS BELOW ⚠️
// This whole dashboard (HTML + browser-side <script>) is a single backtick
// template literal. That means TWO layers of escaping apply, and getting it
// wrong renders the entire dashboard BLANK with an Uncaught SyntaxError
// (no partial degradation — one bad char kills the page).
//
//   • Newlines inside browser JS strings: write `\\n` (NOT `\n`). A bare
//     `\n` becomes a real newline in the served HTML → unterminated string.
//   • Apostrophes inside single-quoted browser JS strings (you'll, don't,
//     didn't): write `\\'` (NOT `\'`). A bare `\'` collapses to `'` in the
//     served HTML → the apostrophe ends the string early.
//   • Backslashes for client-side regex/paths: write `\\\\` to get one `\`.
//   • `${...}` is Node interpolation — fine for server values, but DON'T let
//     a literal `${foo}` meant for the browser leak through unescaped.
//
// We've shipped the blank-page bug TWICE (v2.4.25 newline, v2.4.27 apostrophe).
// ALWAYS run `node scripts/check-agent-dashboard.js` after touching this
// template — it extracts the served <script> body and parses it, catching
// these before they reach a user. (The release workflow runs it too.)
const WEB_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Wolf Pack EQ — Parser</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { --bg:#0d1117; --panel:#161b22; --border:#30363d; --text:#c9d1d9; --dim:#6e7681;
        --blue:#58a6ff; --gold:#d29922; --green:#56d364; --red:#f85149; --orange:#ffa657; }
* { box-sizing:border-box }
body { background:var(--bg); color:var(--text); font-family:'Cascadia Code',Consolas,monospace; margin:0; padding:16px; }
h1 { color:var(--blue); margin:0 0 4px 0; font-size:22px; }
h2 { color:var(--gold); border-bottom:1px solid var(--border); padding-bottom:6px; margin:0 0 12px 0; font-size:14px; text-transform:uppercase; letter-spacing:.05em; }
h3 { color:var(--dim); margin:0 0 8px 0; font-size:12px; font-weight:normal; text-transform:uppercase; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(380px,1fr)); gap:14px; }
.card { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:14px; }
.card.wide { grid-column:1/-1 }
table { width:100%; border-collapse:collapse; font-size:13px; }
th,td { text-align:left; padding:3px 8px; }
th { color:var(--dim); font-weight:normal; font-size:11px; text-transform:uppercase; }
tr:hover td { background:#1f242c }
.num { text-align:right; color:var(--green); font-variant-numeric:tabular-nums; }
.name { color:var(--orange) }
.dim { color:var(--dim) }
.dot { color:var(--green) }
.nav { display:flex; gap:6px; margin:12px 0; flex-wrap:wrap; align-items:center; }
.nav button { background:#21262d; color:var(--text); border:1px solid var(--border); padding:5px 12px; border-radius:6px; cursor:pointer; font-family:inherit; font-size:12px; }
.nav button:hover { background:#30363d }
.nav button.active { background:#1f6feb; border-color:#1f6feb; color:#fff }
.nav-quest { margin-left:auto; padding:5px 12px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:var(--blue); text-decoration:none; font-size:12px; font-family:inherit; }
.nav-quest:hover { background:#30363d; border-color:var(--blue) }
.section { display:none } .section.active { display:block }
.banner { padding:8px 12px; border-radius:6px; margin:0 0 10px 0; font-size:13px; }
.banner.update { background:#9e6a03; color:#fff }
.banner.resumed { background:#1a7f37; color:#fff }
.subtle { color:var(--dim); font-size:12px; margin:4px 0 12px 0; }
.tag { background:#1f6feb22; color:var(--blue); padding:2px 6px; border-radius:4px; font-size:11px; }
.tag.ramp { background:#9e6a0322; color:var(--gold) }
.tag.invuln { background:#1a7f3722; color:var(--green) }
.pet { color:var(--blue) }
.card.wp-hidden { display:none !important }
.wp-gear { background:#21262d; color:var(--text); border:1px solid var(--border); padding:5px 11px; border-radius:6px; cursor:pointer; font-family:inherit; font-size:13px; }
.wp-gear:hover { background:#30363d; border-color:var(--blue); color:var(--blue) }
.wp-menu { position:absolute; z-index:1000; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.5); max-height:60vh; overflow:auto; min-width:240px; }
.wp-menu h4 { margin:0 0 8px; color:var(--blue); font-size:12px; text-transform:uppercase; font-weight:normal; border:none; }
.wp-menu label { display:flex; align-items:center; gap:8px; padding:3px 0; font-size:13px; color:var(--text); cursor:pointer; text-transform:none; }
.wp-menu .wp-actions { margin-top:8px; border-top:1px solid var(--border); padding-top:8px; display:flex; gap:8px; }
.wp-menu .wp-actions button { background:#21262d; color:var(--text); border:1px solid var(--border); border-radius:5px; padding:3px 9px; font-size:11px; cursor:pointer; font-family:inherit; }
.wp-menu .wp-actions button:hover { border-color:var(--blue); color:var(--blue) }
</style></head><body>
<h1>🐺 Wolf Pack EQ — Parser</h1>
<div class="subtle" id="header"></div>
<div class="nav">
  <button class="active" data-tab="dash">Dashboard</button>
  <button data-tab="tanks">Tanks</button>
  <button data-tab="healers">Healers</button>
  <button data-tab="deeps">DEEPS</button>
  <button data-tab="pets">Pets</button>
  <button data-tab="info">Info / Stats</button>
  <button data-tab="optin">Opt-in Logs</button>
  <a id="wolfpackQuestLink" href="https://wolfpack.quest" target="_blank" rel="noreferrer"
     class="nav-quest"
     title="Open wolfpack.quest in a new tab (hotkey: W)">wolfpack.quest ↗</a>
  <button id="wpGear" class="wp-gear" title="Customize panels — show or hide sections">⚙ Panels</button>
</div>
<div id="wpPanelMenu" class="wp-menu" style="display:none"></div>
<div id="dash" class="section active"></div>
<div id="tanks" class="section"></div>
<div id="healers" class="section"></div>
<div id="deeps" class="section"></div>
<div id="pets" class="section"></div>
<div id="info" class="section"></div>
<div id="optin" class="section"></div>
<script>
function _isNewerVersion(a, b) {
  if (!a || !b) return false;
  const pa = String(a).split('.').map(n => parseInt(n,10)||0);
  const pb = String(b).split('.').map(n => parseInt(n,10)||0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i]||0) > (pb[i]||0)) return true;
    if ((pa[i]||0) < (pb[i]||0)) return false;
  }
  return false;
}
function fmtK(n) { n=Number(n||0); if (n<1000) return String(n); if (n<1e6) return (n/1000).toFixed(2)+'K'; return (n/1e6).toFixed(2)+'M'; }
function fmtAgo(ms) { if(!ms) return '?'; const d=Date.now()-ms; if(d<60000)return Math.floor(d/1000)+'s ago'; if(d<3600000)return Math.floor(d/60000)+'m ago'; if(d<86400000)return Math.floor(d/3600000)+'h ago'; return Math.floor(d/86400000)+'d ago'; }
function esc(s) { return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

function renderHeader(s) {
  const sessionMin = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  const hasNewer = s.updateAvailable && s.latestAgentVersion
                && s.latestAgentVersion !== s.version
                && _isNewerVersion(s.latestAgentVersion, s.version);
  let h = '';
  if (hasNewer) h += '<div class="banner update">★ Update available — <button id="updateBtn" style="margin-left:8px;background:#fff;color:#000;border:0;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:bold">Install now</button></div>';
  if (s.sessionResumed)  h += '<div class="banner resumed">↻ Session resumed from previous run</div>';
  // Version line — always renders an update-now button on the right so users
  // can trigger a restart-and-pull-latest at any time, even when the bot
  // hasn't (yet) advertised a newer version via polling.
  let versionStr;
  if (hasNewer) {
    versionStr = 'v' + esc(s.version) +
                 ' <span style="color:var(--gold)">→ v' + esc(s.latestAgentVersion) + ' available</span>' +
                 ' <a href="#" id="inlineUpdateBtn" style="color:var(--blue);margin-left:6px">[install]</a>';
  } else {
    versionStr = 'v' + esc(s.version);
  }
  const alwaysBtn = '<button id="manualUpdateBtn" style="margin-left:12px;background:#21262d;color:var(--text);border:1px solid var(--border);padding:3px 10px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:11px" title="' +
                  (s.updateBlocked ? 'Update blocked: ' + esc(s.updateBlocked) : 'Save session, restart agent, pull the latest version') +
                  '"' + (s.updateBlocked ? ' data-blocked="' + esc(s.updateBlocked) + '"' : '') + '>' +
                  (hasNewer ? '↻ Restart now' : '↻ Check for update') + '</button>';
  // Click-to-reset for officers who want a clean board between raid nights
  // or after testing. Wipes session counters and Recent Parses; lifetime
  // totals and persisted resume state for opt-in backfills are preserved.
  const resetBtn = '<button id="resetSessionBtn" style="margin-left:8px;background:#21262d;color:var(--text);border:1px solid var(--border);padding:3px 10px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:11px" title="Zero out the session counters and Recent Parses on this dashboard">⟲ Reset dashboard</button>';
  // Upload-queue chip — visible only when there's pending work or a recent
  // permanent drop. Shows pending count + the last-retry summary so a
  // network blip is obvious without scrolling.
  let queueChip = '';
  const q = s.uploadQueue || {};
  if (q.pending > 0) {
    const kinds = Object.entries(q.byKind || {}).map(([k, n]) => k + ':' + n).join(' · ');
    const tip = (q.lastError ? 'Last error: ' + q.lastError + ' · ' : '') + kinds;
    queueChip = ' · <span style="background:#3b2a06;color:#ffd07a;border:1px solid #d18a2d;border-radius:3px;font-size:11px;padding:2px 6px;margin-left:4px" title="' + esc(tip) + '">⏳ ' + q.pending + ' queued</span>';
  } else if (q.permanentDropped > 0 || q.capEvicted > 0) {
    const dropTip =
      (q.permanentDropped > 0 ? q.permanentDropped + ' permanent 4xx · ' : '') +
      (q.capEvicted      > 0 ? q.capEvicted      + ' cap evictions'    : '');
    const total = (q.permanentDropped || 0) + (q.capEvicted || 0);
    queueChip = ' · <span style="background:#3b0a0a;color:#ff9c9c;border:1px solid #f85149;border-radius:3px;font-size:11px;padding:2px 6px;margin-left:4px" title="' + esc(dropTip) + '. Check the agent log for details.">✕ ' + total + ' dropped</span>';
  }
  h += '<div>' + versionStr + ' · ' + (s.uploadCount||0) + ' upload(s) this session · ' + s.sessionEvents + ' events in ' + sessionMin + ' min' + queueChip + alwaysBtn + resetBtn + '</div>';
  document.getElementById('header').innerHTML = h;
  // Always-visible 'Restart now / Check for update' button mirrors the install flow
  const manual = document.getElementById('manualUpdateBtn');
  function _startRestartPoll(bannerId) {
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try { const r = await fetch('/api/state'); if (r.ok) { clearInterval(t); location.reload(); return; } } catch {}
      // After 30s show a manual-reload link in the banner
      if (tries === 30) {
        const b = document.getElementById(bannerId);
        if (b) b.innerHTML += ' &nbsp;<a href="" style="color:#fff;font-weight:bold" onclick="location.reload();return false">Reload now</a>';
      }
      if (tries > 300) clearInterval(t);  // give up after ~5 min
    }, 1000);
  }
  // Shared helper — POST /api/update, handle the 409 update-blocked response
  // by surfacing the reason + a force-override confirm. Used by both the
  // header "Check for update" button and the banner "Install now" button.
  async function _attemptUpdate(button, force) {
    try {
      const r = await fetch('/api/update' + (force ? '?force=1' : ''), { method: 'POST' });
      if (r.status === 409) {
        const j = await r.json().catch(() => ({}));
        const reason = j?.reason || 'update is blocked';
        if (button) { button.disabled = false; button.textContent = '↻ Check for update'; }
        if (confirm('Update blocked: ' + reason + '.\\n\\nForce restart anyway? Unflushed data in the upload queue may be retried after restart, but in-flight encounters or backfill progress could be lost.')) {
          return _attemptUpdate(button, true);
        }
        return false;
      }
      return r.ok;
    } catch {
      return false;
    }
  }
  if (manual) manual.addEventListener('click', async () => {
    if (!confirm('Restart agent and pull the latest version? Session will be saved and resumed.')) return;
    manual.disabled = true; manual.textContent = 'Restarting...';
    const ok = await _attemptUpdate(manual, false);
    if (!ok) return;
    document.body.insertAdjacentHTML('afterbegin',
      '<div id="restartBanner" class="banner update" style="position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center">' +
      'Restarting agent... this page will reload automatically once the server is back up.</div>');
    _startRestartPoll('restartBanner');
  });
  // Inline [install] link mirrors the banner Install button
  const inline = document.getElementById('inlineUpdateBtn');
  if (inline) inline.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('updateBtn')?.click();
  });
  const u = document.getElementById('updateBtn');
  if (u) u.addEventListener('click', async () => {
    if (!confirm('Update agent now? Session will be saved and resumed automatically.')) return;
    u.disabled = true; u.textContent = 'Restarting...';
    const ok = await _attemptUpdate(u, false);
    if (!ok) return;
    document.body.insertAdjacentHTML('afterbegin',
      '<div id="restartBanner" class="banner update" style="position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center">' +
      'Restarting agent... this page will reload automatically once the server is back up.</div>');
    _startRestartPoll('restartBanner');
  });
  // Reset-dashboard click — zeros session counters server-side, then we
  // re-pull /api/state so the UI refreshes immediately without a hard reload.
  const r = document.getElementById('resetSessionBtn');
  if (r) r.addEventListener('click', async () => {
    if (!confirm('Reset session counters? Recent Parses, top damage and per-class panes go back to empty. Lifetime totals and opt-in backfill progress are preserved.')) return;
    r.disabled = true; r.textContent = 'Resetting...';
    try { await fetch('/api/reset-session', { method: 'POST' }); } catch {}
    try { const fresh = await (await fetch('/api/state')).json(); refresh(); void fresh; } catch {}
    r.disabled = false; r.textContent = '⟲ Reset dashboard';
  });
}

function renderDash(s) {
  let h = '';

  // Trigger overlays — fade out after their duration but keep a short
  // history so users can scroll back through the last few callouts.
  const now = Date.now();
  const overlays = (s.activeOverlays || []).filter(o => o && o.text);
  const live = overlays.filter(o => (now - (o.shownAt || 0)) < (o.duration_ms || 5000));
  if (live.length > 0) {
    h += '<div class="card" style="border-color:#a06628">' +
         '<h2 style="margin-bottom:6px">⚡ Trigger</h2>';
    for (const o of live.slice(0, 5)) {
      const cls = o.scope === 'personal' ? 'personal' : 'guild';
      const remaining = Math.max(0, (o.duration_ms || 5000) - (now - o.shownAt));
      const alpha = Math.min(1, remaining / (o.duration_ms || 5000));
      h += '<div style="font-size:22px;font-weight:bold;line-height:1.4;color:' + esc(o.color || 'red') + ';opacity:' + alpha.toFixed(2) + '">' + esc(o.text) + '</div>' +
           '<div class="dim" style="font-size:10px;margin-top:2px">' + esc(cls) + ' · ' + esc(o.trigger || '') + '</div>';
    }
    h += '</div>';
  }
  // Trigger summary chip
  if ((s.guildTriggerCount || 0) > 0 || (s.personalTriggerCount || 0) > 0) {
    h += '<div class="card"><h2>Triggers</h2>' +
         '<div class="dim" style="font-size:11px">' +
         (s.guildTriggerCount || 0) + ' guild · ' +
         (s.personalTriggerCount || 0) + ' personal' +
         '</div></div>';
  }

  h += '<div class="grid">';
  // Recent parses
  h += '<div class="card"><h2>Recent Parses</h2>';
  if (!s.recentParses?.length) h += '<div class="dim">(no uploads yet)</div>';
  else {
    h += '<table>';
    for (const p of s.recentParses.slice(0,5)) {
      h += '<tr><td class="name">' + esc(p.bossName) + '</td><td class="dim">' + p.eventCount + ' ev</td>' +
           '<td class="num">' + fmtK(p.totalDamage) + '</td><td class="dim">(' + fmtK(p.spellDotDamage) + ' spell)</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';
  // Session damage
  h += '<div class="card"><h2>Damage Done This Session</h2>';
  h += '<div style="font-size:16px;margin-bottom:8px">Total: <span class="num">' + fmtK(s.sessionTotalDamage) + '</span></div>';
  const contribs = Object.entries(s.sessionDamageBy||{}).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if (contribs.length) {
    h += '<table>';
    for (const [n,d] of contribs) h += '<tr><td class="name">' + esc(n) + '</td><td class="num">' + fmtK(d) + '</td></tr>';
    h += '</table>';
  }
  h += '</div>';
  // Watched logs — collapse to one row per character (most-recent lastSeen
  // wins) so an install that tails many log files for the same char
  // doesn't render as 51 duplicate Hitya rows. The full file count still
  // shows in the header for context.
  const _wls = s.watchedLogs || [];
  const _byChar = new Map();
  for (const w of _wls) {
    const k = (w.character || '?').toLowerCase();
    const cur = _byChar.get(k);
    if (!cur || (w.lastSeen || 0) > (cur.lastSeen || 0)) _byChar.set(k, w);
  }
  const _uniqueChars = _byChar.size;
  h += '<div class="card"><h2>Watched Logs (' + _uniqueChars +
       (_wls.length > _uniqueChars ? ' chars · ' + _wls.length + ' files' : '') +
       ')</h2><table>';
  const recent = [..._byChar.values()].sort((a,b)=>(b.lastSeen||0)-(a.lastSeen||0)).slice(0,15);
  for (const w of recent) {
    const hot = w.lastSeen && (Date.now()-w.lastSeen) < 3600000;
    h += '<tr><td>' + (hot ? '<span class="dot">●</span> ' : '&nbsp;&nbsp;') +
         '<span class="name">' + esc(w.character) + '</span></td>' +
         '<td class="dim">' + fmtAgo(w.lastSeen) + '</td></tr>';
  }
  h += '</table></div>';

  // ── Live Threat (current encounter) ─────────────────────────────────────
  const et = s.currentEncounterThreat;
  if (et && et.perPlayer && Object.keys(et.perPlayer).length > 0) {
    const ranked = Object.entries(et.perPlayer)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 12);
    const topT = ranked[0]?.[1].total || 1;
    const staleLabel = et.flushedAt ? ' <span style="color:var(--dim);font-size:12px;font-weight:normal">(ended ' + fmtAgo(et.flushedAt) + ')</span>' : '';
    h += '<div class="card wide"><h2>⚔️ Live Threat — ' + esc(et.bossName || 'current fight') + staleLabel + '</h2>';
    h += '<div class="subtle">Estimated from observable damage + heals (Phase 1 proxy). Real spell/proc hate tables not yet wired up.</div>';
    h += '<table style="margin-top:6px"><tr><th></th><th>Player</th><th>Threat</th><th style="width:40%">Bar</th><th>Breakdown</th></tr>';
    for (let i = 0; i < ranked.length; i++) {
      const [name, t] = ranked[i];
      const pct = Math.max(2, Math.round(t.total / topT * 100));
      const rank = i + 1;
      // Warn if a non-top player is within 90% of #1 (aggro risk)
      const closeRisk = i > 0 && t.total / topT >= 0.9;
      const barColor = i === 0 ? '#1f6feb' : (closeRisk ? '#f85149' : '#56d364');
      const parts = [];
      if (t.swing) parts.push('swing ' + fmtK(t.swing));
      if (t.proc)  parts.push('proc ' + fmtK(t.proc));
      if (t.spell) parts.push('spell ' + fmtK(t.spell));
      if (t.heal)  parts.push('heal ' + fmtK(t.heal));
      h += '<tr><td class="dim">' + rank + '</td>' +
           '<td class="name">' + esc(name) + (closeRisk ? ' <span style="color:var(--red);font-size:11px">⚠ aggro risk</span>' : '') + '</td>' +
           '<td class="num">' + fmtK(t.total) + '</td>' +
           '<td><div style="background:#1f242c;border-radius:4px;height:14px;overflow:hidden">' +
             '<div style="background:' + barColor + ';height:100%;width:' + pct + '%"></div></div></td>' +
           '<td class="dim" style="font-size:11px">' + parts.join(' · ') + '</td></tr>';
    }
    h += '</table></div>';
  }

  // Top damage
  h += '<div class="card wide"><h2>Top Damage This Session</h2>' +
       '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">';
  for (const [list, listKey, title] of [[s.topDamageSaw, 'saw', 'I saw'], [s.topDamageDid, 'did', 'I did']]) {
    h += '<div><h3>' + title + '</h3>';
    if (!list?.length) h += '<div class="dim">(none yet)</div>';
    else for (const e of list) {
      // Stash the dismiss key in a data-attribute (HTML-escape it via esc()
      // so single quotes / brackets don't break the attribute). The click
      // handler at the bottom of renderDash binds this up and calls
      // dismissTopDamage(). Inline onclick='...' would have to thread JSON
      // through TWO escape layers (template literal + HTML attribute) — too
      // many ways to break.
      const dKey = JSON.stringify({ list: listKey, attacker: e.attacker, amount: e.amount });
      h += '<div style="display:flex;align-items:baseline;gap:6px">' +
           '<button class="dismiss-td" data-key="' + esc(dKey) + '" style="background:none;border:none;color:var(--dim);cursor:pointer;padding:0;font-size:11px;line-height:1;flex-shrink:0" title="Remove">✕</button>' +
           '<span class="name">' + esc(e.attacker) + '</span> ' +
           '<span class="num">' + fmtK(e.amount) + '</span> ' +
           '<span class="dim">' + esc(e.label||'') + (e.ability ? ' — ' + esc(e.ability) : '') + '</span></div>';
    }
    h += '</div>';
  }
  h += '</div></div>';
  h += '</div>';
  document.getElementById('dash').innerHTML = h;
  // Wire dismiss buttons after innerHTML replaces the DOM
  document.querySelectorAll('#dash .dismiss-td').forEach(b => b.addEventListener('click', () => {
    try { dismissTopDamage(JSON.parse(b.dataset.key)); } catch {}
  }));
}

function renderTanks(s) {
  let h = '<div class="grid">';

  // ── Threat detail for the current fight — shows the swing/proc/spell/heal
  // breakdown per player so tanks can see WHERE their threat comes from and
  // whether a Wizard's nukes are about to pull. Phase-2 hook: add Quarmy
  // build URL + theoretical TPS from weapon stats.
  const et = s.currentEncounterThreat;
  if (et && et.perPlayer && Object.keys(et.perPlayer).length > 0) {
    const ranked = Object.entries(et.perPlayer).sort((a, b) => b[1].total - a[1].total);
    const staleLabel2 = et.flushedAt ? ' <span style="color:var(--dim);font-size:12px;font-weight:normal">(ended ' + fmtAgo(et.flushedAt) + ')</span>' : '';
    h += '<div class="card wide"><h2>⚔️ Threat Detail — ' + esc(et.bossName || 'current fight') + staleLabel2 + '</h2>';
    h += '<div class="subtle">Per-source breakdown. Phase-2 will add Quarmy build links + theoretical TPS from weapon procs/haste.</div>';
    h += '<table style="margin-top:6px">' +
         '<tr><th>Player</th><th>Total</th><th>Swing</th><th>Proc</th><th>Spell</th><th>Heal</th><th>Threat procs detected</th></tr>';
    for (const [name, t] of ranked) {
      const procs = Object.entries(t.procDetail || {})
        .sort((a, b) => b[1] - a[1])
        .map(([n, c]) => esc(n) + ' ×' + c)
        .join(' · ') || '<span class="dim">—</span>';
      h += '<tr><td class="name">' + esc(name) + '</td>' +
           '<td class="num"><b>' + fmtK(t.total) + '</b></td>' +
           '<td class="num">' + (t.swing ? fmtK(t.swing) : '<span class="dim">—</span>') + '</td>' +
           '<td class="num">' + (t.proc  ? fmtK(t.proc)  : '<span class="dim">—</span>') + '</td>' +
           '<td class="num">' + (t.spell ? fmtK(t.spell) : '<span class="dim">—</span>') + '</td>' +
           '<td class="num">' + (t.heal  ? fmtK(t.heal)  : '<span class="dim">—</span>') + '</td>' +
           '<td class="dim" style="font-size:11px">' + procs + '</td></tr>';
    }
    h += '</table></div>';
  }

  // ── Character loadouts — parsed from <Char>-Inventory.txt files in EQ dir
  const invsAll = Object.entries(s.characterInventories || {});
  const hidden = new Set((s.hiddenLoadoutChars || []).map(c => c.toLowerCase()));
  // Sort once so order is stable across hide/show toggles
  invsAll.sort((a, b) => a[0].localeCompare(b[0]));
  const invs       = invsAll.filter(([c]) => !hidden.has(c.toLowerCase()));
  const hiddenList = invsAll.filter(([c]) =>  hidden.has(c.toLowerCase()));
  if (invsAll.length > 0) {
    h += '<div class="card wide"><h2>🗡️ Weapon Loadouts</h2>';
    h += '<div class="subtle">Parsed from <code>/output inventory</code> files in the EQ directory. ' +
         'Phase 2: cross-reference item IDs with proc DB for theoretical TPS. ' +
         'Click ⊘ to hide alts you do not care about.</div>';
    h += '<table style="margin-top:6px">' +
         '<tr><th>Character</th><th>Primary</th><th>Secondary</th><th>Range</th><th>Updated</th><th></th></tr>';
    for (const [char, inv] of invs) {
      const pqdiLink = (item) => {
        if (!item) return '<span class="dim">—</span>';
        if (item.id) return '<a href="https://www.pqdi.cc/item/' + item.id + '" target="_blank" style="color:var(--blue)">' + esc(item.name) + '</a>';
        return esc(item.name);
      };
      const updatedAgo = inv._updatedAt
        ? Math.floor((Date.now() - new Date(inv._updatedAt).getTime()) / 86400000)
        : null;
      const updatedStr = updatedAgo === null ? '?'
        : updatedAgo < 1 ? 'today'
        : updatedAgo < 30 ? updatedAgo + 'd ago'
        : updatedAgo + 'd ago';
      const active = (s.activeBandolier || {})[char];
      const activeBadge = active && active.name
        ? ' <span class="tag" title="last-loaded bandolier set">⚔ ' + esc(active.name) + (active.status !== 'equipped' ? ' <span style="color:var(--red)">(' + esc(active.status) + ')</span>' : '') + '</span>'
        : '';
      h += '<tr><td class="name">' + esc(char) + activeBadge + '</td>' +
           '<td>' + pqdiLink(inv.weapons?.primary)   + '</td>' +
           '<td>' + pqdiLink(inv.weapons?.secondary) + '</td>' +
           '<td>' + pqdiLink(inv.weapons?.range)     + '</td>' +
           '<td class="dim">' + updatedStr + '</td>' +
           '<td><button data-hide-char="' + esc(char) + '" title="Hide this character" style="background:transparent;border:0;color:var(--dim);cursor:pointer;font-size:13px">⊘</button></td></tr>';

      // Bandolier sets — sub-row laid out as a 4-cell grid (MH / OH / Range
      // / Ammo) so long item names wrap inside their cell rather than
      // pushing the next slot off the right edge of the page.
      if (inv.bandolier && Object.keys(inv.bandolier).length > 0) {
        const setNames = Object.keys(inv.bandolier);
        const defaultSet = (active && active.name && inv.bandolier[active.name]) ? active.name : setNames[0];
        h += '<tr class="bandolier-row" data-char="' + esc(char) + '"><td colspan="6" style="padding:6px 16px 10px;border-top:1px dashed var(--border)">';
        h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">';
        h += '<span class="dim" style="font-size:11px;flex-shrink:0">Bandolier set:</span>';
        h += '<select data-bandolier-char="' + esc(char) + '" style="background:#21262d;color:var(--text);border:1px solid var(--border);padding:2px 6px;border-radius:4px;font-family:inherit;font-size:12px;max-width:200px">';
        for (const sn of setNames) {
          h += '<option value="' + esc(sn) + '"' + (sn === defaultSet ? ' selected' : '') + '>' + esc(sn) + '</option>';
        }
        h += '</select>';
        h += '</div>';
        // Each slot is a chip: label on top, item underneath, fixed-width column
        // so long item names wrap cleanly instead of shoving the next slot off.
        const renderSet = (setName) => {
          const set = inv.bandolier[setName] || {};
          const slot = (label, item) => {
            const value = item
              ? '<a href="https://www.pqdi.cc/item/' + item.id + '" target="_blank" style="color:var(--blue);text-decoration:none;line-height:1.3;display:block;word-break:break-word">' + esc(item.name) + '</a>'
              : '<span class="dim">—</span>';
            return '<div style="display:flex;flex-direction:column;gap:2px;min-width:0">' +
                   '<span class="dim" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px">' + label + '</span>' +
                   '<div style="font-size:12px">' + value + '</div>' +
                   '</div>';
          };
          return '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding-left:4px">' +
                 slot('Main', set.primary) +
                 slot('Off',  set.secondary) +
                 slot('Range',set.range) +
                 slot('Ammo', set.ammo) +
                 '</div>';
        };
        // JSON blob stashed in a data-attribute on the display span so the
        // change handler can look up the selected set without another fetch.
        // Pre-encoded with attr-safe quotes; HTML-escape just the quote marks.
        const bandolierJson = JSON.stringify(inv.bandolier)
          .replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
        h += '<div class="bandolier-display" data-char="' + esc(char) + '" ' +
             'data-bandolier="' + bandolierJson + '">' + renderSet(defaultSet) + '</div>';
        h += '</td></tr>';
      }
    }
    h += '</table>';
    if (hiddenList.length > 0) {
      h += '<details style="margin-top:10px"><summary class="dim" style="cursor:pointer">Hidden (' + hiddenList.length + ') — click to expand</summary>';
      h += '<table><tr><th>Character</th><th></th></tr>';
      for (const [char] of hiddenList) {
        h += '<tr><td class="dim">' + esc(char) + '</td>' +
             '<td><button data-show-char="' + esc(char) + '" style="background:transparent;border:0;color:var(--blue);cursor:pointer;font-size:11px">[show]</button></td></tr>';
      }
      h += '</table></details>';
    }
    h += '<div class="subtle" style="margin-top:6px">Tip: run <code>/output inventory</code> in-game to refresh. ' +
         'Files are auto-detected from <code>' + esc(invsAll[0][1]._path?.split(/[/\\\\]/).slice(0, -1).join('\\\\') || '') + '</code></div>';
    h += '</div>';
  }

  const defs = Object.entries(s.sessionDefenders||{}).sort((a,b)=>b[1].damageTaken-a[1].damageTaken);
  h += '<div class="card wide"><h2>Incoming Damage</h2>';
  if (!defs.length) h += '<div class="dim">No tanking data yet — join a fight first.</div>';
  else {
    h += '<table><tr><th>Tank</th><th>Dmg Taken</th><th>Hits</th><th>Ramp Hits</th><th>Ramp Dmg</th><th>Invuln Avoided</th><th>Riposted For</th></tr>';
    for (const [n, d] of defs.slice(0,12)) {
      h += '<tr><td class="name">' + esc(n) + '</td>' +
           '<td class="num">' + fmtK(d.damageTaken) + '</td>' +
           '<td class="num">' + (d.hits||0) + '</td>' +
           '<td class="num">' + (d.rampageHits ? '<span class="tag ramp">'+d.rampageHits+'</span>' : '<span class="dim">—</span>') + '</td>' +
           '<td class="num">' + (d.rampageDmg ? fmtK(d.rampageDmg) : '<span class="dim">—</span>') + '</td>' +
           '<td class="num">' + (d.invulnAvoidedDmg ? '<span class="tag invuln">'+fmtK(d.invulnAvoidedDmg)+'</span>' : '<span class="dim">—</span>') + '</td>' +
           '<td class="num">' + fmtK(d.ripostedFor||0) + '</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';
  // Mob Procs / Special Abilities — removed pending a real design.
  // The previous panel showed misclassified data (player names landing
  // under "pet" entries) and wasn't useful as-is. Hide until reworked.
  // Deaths
  const deaths = Object.entries(s.sessionDeaths||{}).sort((a,b)=>b[1]-a[1]);
  h += '<div class="card"><h2>Deaths This Session</h2>';
  if (!deaths.length) h += '<div class="dim">Nobody died. Very respectable.</div>';
  else { h += '<table>'; for (const [n,c] of deaths) h += '<tr><td class="name">' + esc(n) + '</td><td class="num" style="color:var(--red)">' + c + '</td></tr>'; h += '</table>'; }
  h += '</div>';
  h += '</div>';
  document.getElementById('tanks').innerHTML = h;
  // Wire the hide/show character buttons in the Weapon Loadouts table
  document.querySelectorAll('[data-hide-char]').forEach(b => b.addEventListener('click', async () => {
    await fetch('/api/loadouts/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hide', chars: [b.dataset.hideChar] }) });
    refresh();
  }));
  document.querySelectorAll('[data-show-char]').forEach(b => b.addEventListener('click', async () => {
    await fetch('/api/loadouts/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'show', chars: [b.dataset.showChar] }) });
    refresh();
  }));
  // Wire bandolier dropdowns — re-render the 4-cell grid when the user
  // picks a different set. Must mirror the server-side renderSet so
  // long item names continue to wrap inside their column.
  document.querySelectorAll('[data-bandolier-char]').forEach(sel => {
    sel.addEventListener('change', () => {
      const char = sel.dataset.bandolierChar;
      const display = document.querySelector('[data-bandolier][data-char="' + char + '"]');
      if (!display) return;
      let sets; try { sets = JSON.parse(display.dataset.bandolier); } catch { return; }
      const set = sets[sel.value] || {};
      const cell = (label, item) => {
        const value = item
          ? '<a href="https://www.pqdi.cc/item/' + item.id + '" target="_blank" style="color:var(--blue);text-decoration:none;line-height:1.3;display:block;word-break:break-word">' + esc(item.name) + '</a>'
          : '<span class="dim">&mdash;</span>';
        return '<div style="display:flex;flex-direction:column;gap:2px;min-width:0">' +
               '<span class="dim" style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px">' + label + '</span>' +
               '<div style="font-size:12px">' + value + '</div>' +
               '</div>';
      };
      display.innerHTML = '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding-left:4px">' +
                         cell('Main', set.primary) +
                         cell('Off',  set.secondary) +
                         cell('Range',set.range) +
                         cell('Ammo', set.ammo) +
                         '</div>';
    });
  });
}

function renderHealers(s) {
  let h = '<div class="grid"><div class="card wide">' +
          '<h2>Healers This Session ' +
          '<span style="background:#7c4a06;color:#ffd07a;border:1px solid #d18a2d;border-radius:3px;font-size:9px;padding:1px 5px;margin-left:6px;vertical-align:middle;letter-spacing:1px">BETA</span>' +
          '</h2>' +
          '<div class="subtle" style="font-size:11px;margin-bottom:6px">Exact amounts depend on the healer running the parser — Quarm does not reveal incoming-heal attribution to the target. Coverage grows as more healers join.</div>';
  const healers = Object.entries(s.sessionHealers||{}).sort((a,b)=>b[1].healed-a[1].healed);
  if (!healers.length) h += '<div class="dim">No healing parsed yet.</div>';
  else {
    h += '<table><tr><th>Healer</th><th>Healed</th><th>Ticks</th><th>Targets</th></tr>';
    for (const [n, st] of healers.slice(0,15)) {
      h += '<tr><td class="name">' + esc(n) + '</td>' +
           '<td class="num">' + fmtK(st.healed) + '</td>' +
           '<td class="num">' + (st.ticks||0) + '</td>' +
           '<td class="dim">' + (st.targets||[]).map(esc).slice(0,6).join(', ') + '</td></tr>';
    }
    h += '</table>';
  }
  h += '</div></div>';
  // Exceptional Heals leaderboard — populated by the bystander-visible
  // "<X> performs an exceptional heal! (N)" line, so a single parser
  // anywhere in the raid sees every cleric's crit heals.
  const crits = Object.entries(s.sessionCritHeals||{})
    .sort((a, b) => (b[1].total||0) - (a[1].total||0));
  if (crits.length > 0) {
    let ch = '<div class="grid"><div class="card wide">' +
             '<h2>💚 Exceptional Heals This Session</h2>' +
             '<div class="subtle" style="font-size:11px;margin-bottom:6px">Crit heals are public — any parser in the raid sees them, no healer adoption required.</div>' +
             '<table><tr><th>Healer</th><th>Crits</th><th>Total</th><th>Biggest</th></tr>';
    for (const [n, st] of crits.slice(0, 15)) {
      ch += '<tr><td class="name">' + esc(n) + '</td>' +
            '<td class="num">' + (st.count||0) + '</td>' +
            '<td class="num">' + fmtK(st.total||0) + '</td>' +
            '<td class="num">' + fmtK(st.max||0) + '</td></tr>';
    }
    ch += '</table></div></div>';
    h += ch;
  }
  document.getElementById('healers').innerHTML = h;
}

function renderDeeps(s) {
  let h = '<div class="grid"><div class="card wide"><h2>💥 DEEPS — Damage Breakdown (this session)</h2>';
  h += '<div class="subtle">Per-attacker melee / spell / proc / DoT damage and crit stats. Names with spaces (NPCs) are filtered out.</div>';
  const entries = Object.entries(s.sessionDeeps || {})
    .map(([n, d]) => {
      const total = (d.melee?.total||0) + (d.spell?.total||0) + (d.proc?.total||0) + (d.dot?.total||0);
      return [n, d, total];
    })
    .sort((a, b) => b[2] - a[2]);
  if (entries.length === 0) {
    h += '<div class="dim" style="margin-top:10px">No damage events yet — join a fight first.</div>';
  } else {
    h += '<table style="margin-top:6px">' +
         '<tr><th>Player</th><th>Total</th><th>Melee</th><th>Spell</th><th>Proc</th><th>DoT</th><th>Crits</th><th>Crit dmg</th></tr>';
    for (const [name, d, total] of entries) {
      const fmtCat = (b) => {
        if (!b || !b.count) return '<span class="dim">—</span>';
        const avg = Math.round(b.total / b.count);
        return '<span class="num">' + fmtK(b.total) + '</span>' +
               ' <span class="dim" style="font-size:11px">×' + b.count + ' avg ' + fmtK(avg) + ' max ' + fmtK(b.max) + '</span>';
      };
      const critPct = ((d.melee?.count||0) + (d.spell?.count||0)) > 0
        ? Math.round((d.crits?.count||0) / ((d.melee?.count||0) + (d.spell?.count||0)) * 100)
        : 0;
      h += '<tr>' +
           '<td class="name">' + esc(name) + '</td>' +
           '<td class="num"><b>' + fmtK(total) + '</b></td>' +
           '<td>' + fmtCat(d.melee) + '</td>' +
           '<td>' + fmtCat(d.spell) + '</td>' +
           '<td>' + fmtCat(d.proc)  + '</td>' +
           '<td>' + fmtCat(d.dot)   + '</td>' +
           '<td class="num">' + (d.crits?.count
                                   ? '<span style="color:var(--gold)">' + d.crits.count + '</span> <span class="dim" style="font-size:11px">' + critPct + '%</span>'
                                   : '<span class="dim">—</span>') + '</td>' +
           '<td class="num">' + (d.crits?.bonusDmg
                                   ? '<span style="color:var(--gold)">+' + fmtK(d.crits.bonusDmg) + '</span> <span class="dim" style="font-size:11px">max +' + fmtK(d.crits.maxBonus) + '</span>'
                                   : '<span class="dim">—</span>') + '</td>' +
           '</tr>';
    }
    h += '</table>';
  }
  h += '</div>';

  // Per-player top abilities (rolled up by ability name)
  const withAbilities = entries.filter(([, d]) => d.topAbilities && Object.keys(d.topAbilities).length > 0);
  if (withAbilities.length > 0) {
    h += '<div class="card wide"><h2>🎯 Top Abilities per Player</h2>';
    h += '<div class="subtle">Aggregated by named ability across the session. Hits, total damage, average.</div>';
    for (const [name, d] of withAbilities.slice(0, 10)) {
      const abs = Object.entries(d.topAbilities).sort((a, b) => b[1].total - a[1].total).slice(0, 8);
      h += '<h3 style="color:var(--orange);margin-top:14px">' + esc(name) + '</h3>';
      h += '<table><tr><th>Ability</th><th>Total</th><th>Hits</th><th>Avg</th></tr>';
      for (const [ab, st] of abs) {
        const avg = st.count > 0 ? Math.round(st.total / st.count) : 0;
        const label = ab === 'non-melee' ? ab + ' (DS / DoT / procs)' : ab;
        h += '<tr><td>' + esc(label) + '</td><td class="num"><b>' + fmtK(st.total) + '</b></td>' +
             '<td class="num">' + st.count + '</td><td class="num">' + fmtK(avg) + '</td></tr>';
      }
      h += '</table>';
    }
    h += '</div>';
  }

  h += '</div>';
  document.getElementById('deeps').innerHTML = h;
}

function renderPets(s) {
  let h = '<div class="card"><h2>Known Pets This Session</h2>';
  const pets = (s.knownPets||[]);
  if (!pets.length) h += '<div class="dim">No pets observed yet.</div>';
  else { h += '<table><tr><th>Pet</th><th>Owner(s)</th></tr>'; for (const p of pets) h += '<tr><td class="pet">' + esc(p.pet) + '</td><td class="name">' + p.owners.map(esc).join(', ') + '</td></tr>'; h += '</table>'; }
  h += '</div>';
  document.getElementById('pets').innerHTML = h;
}

function renderInfo(s) {
  const sessionMin = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  const lifetimeMin = (s.lifetime?.totalMinutes||0) + sessionMin;
  let h = '<div class="grid">';
  // 🥋 Monk Mending — only if attempts > 0
  const m = s.sessionMends || {};
  if (m.attempts > 0) {
    const critPct = m.success > 0 ? Math.round(m.crit / m.success * 100) : 0;
    const failPct = Math.round(m.fail / m.attempts * 100);
    h += '<div class="card"><h2>🥋 Monk Mending</h2><table>' +
         '<tr><td>Attempts</td><td class="num">' + m.attempts + '</td></tr>' +
         '<tr><td>Successful</td><td class="num">' + m.success + '</td></tr>' +
         '<tr><td>Critical</td><td class="num" style="color:var(--green)">' + m.crit + ' <span class="dim">(' + critPct + '% of successes)</span></td></tr>' +
         '<tr><td>Failed</td><td class="num" style="color:var(--red)">' + m.fail + ' <span class="dim">(' + failPct + '% of attempts)</span></td></tr>' +
         '</table></div>';
  }
  h += '<div class="card"><h2>Parser Info</h2>';
  h += '<div>Agent v' + esc(s.version) + '</div>';
  h += '<div>Watching ' + (s.watchedLogs?.length||0) + ' log(s)</div>';
  h += '<div>Uploads this session: ' + (s.uploadCount||0) + ' (' + (s.uploadErrors||0) + ' errors)</div>';
  h += '<div>This session: ' + s.sessionEvents + ' events / ' + sessionMin + ' min</div>';
  h += '<div>Top session: ' + (s.lifetime?.topSessionEvents||0) + ' ev / ' + (s.lifetime?.topSessionMinutes||0) + ' min</div>';
  h += '<div>Lifetime: ' + ((s.lifetime?.totalEvents||0) + s.sessionEvents) + ' ev / ' + lifetimeMin + ' min</div>';
  if (s.lifetime?.firstSeenAt) h += '<div class="dim">First run: ' + esc(s.lifetime.firstSeenAt) + '</div>';
  h += '</div>';
  // Top abilities
  const abs = Object.entries(s.abilityStats||{}).sort((a,b)=>b[1].total-a[1].total).slice(0,20);
  h += '<div class="card wide"><h2>Top Abilities (uploader)</h2>';
  if (!abs.length) h += '<div class="dim">(no damage events parsed yet)</div>';
  else {
    h += '<table><tr><th>Ability</th><th>Total</th><th>Hits</th><th>Avg</th></tr>';
    for (const [ab, st] of abs) {
      const label = ab === 'non-melee' ? ab + ' (DS / DoT / procs)' : ab;
      const avg = st.count > 0 ? Math.round(st.total / st.count) : 0;
      h += '<tr><td>' + esc(label) + '</td><td class="num">' + fmtK(st.total) + '</td><td class="num">' + st.count + '</td><td class="num">' + fmtK(avg) + '</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';
  // Per-character cast counter — reliable for the uploader (knows spell name);
  // "begins to cast a spell" for others lands under (unknown).
  const cc = s.castCounts || {};
  const casters = Object.keys(cc);
  if (casters.length > 0) {
    h += '<div class="card wide"><h2>Spell Casts This Session</h2>';
    h += '<div class="subtle" style="font-size:11px;margin-bottom:6px">Reliable for the uploader. Other casters land under <code>(unknown)</code> because EQ does not log the spell name for bystanders.</div>';
    // Sort characters by total cast count desc
    const ordered = casters
      .map(name => {
        const spells = cc[name] || {};
        const total = Object.values(spells).reduce((a, b) => a + b, 0);
        return { name, spells, total };
      })
      .sort((a, b) => b.total - a.total);
    for (const c of ordered.slice(0, 10)) {
      const spellEntries = Object.entries(c.spells).sort((a, b) => b[1] - a[1]).slice(0, 8);
      h += '<details><summary><span class="name">' + esc(c.name) + '</span> <span class="dim">— ' + c.total + ' cast' + (c.total === 1 ? '' : 's') + '</span></summary>';
      h += '<table>';
      for (const [spell, count] of spellEntries) {
        h += '<tr><td>' + esc(spell) + '</td><td class="num">' + count + '</td></tr>';
      }
      h += '</table></details>';
    }
    h += '</div>';
  }
  h += '</div>';
  document.getElementById('info').innerHTML = h;
}

let _optinPane = 'active';   // 'active' | 'ignored' — UI-only, server uses its own
async function postOptin(action, extra) {
  try {
    const r = await fetch('/api/optin', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...(extra || {}) }) });
    return await r.json();
  } catch { return null; }
}

function renderOptin(o) {
  if (!o) { document.getElementById('optin').innerHTML = '<div class="dim">Loading...</div>'; return; }
  const list = _optinPane === 'active' ? o.files : o.ignored;
  const selCount = (o.files||[]).filter(f => f.selected).length;

  let h = '';

  // Officer-filed backfill requests banner. Surfaces pending/acked requests
  // targeting characters this agent watches. Each row: character, scope,
  // reason, requested-by, Accept / Dismiss buttons. After action the panel
  // refreshes (postOptin already calls refreshOptin afterward).
  const reqs = (o.backfillRequests || []).filter(r => r.status === 'pending' || r.status === 'acked');
  if (reqs.length > 0) {
    h += '<div class="card wide" style="border-color:#a06628">' +
         '<h2 style="color:#f0883e">📋 Officer-requested backfill (' + reqs.length + ')</h2>' +
         '<div class="subtle">An officer asked you to upload a specific log window. Accept to confirm you\\'ll handle it — then run the matching file from the list below. Dismiss if it doesn\\'t apply.</div>';
    for (const r of reqs) {
      const scopeStart = r.scope && r.scope.start_iso ? new Date(r.scope.start_iso).toLocaleString() : '?';
      const scopeEnd   = r.scope && r.scope.end_iso   ? new Date(r.scope.end_iso).toLocaleString()   : '?';
      const status = r.status === 'acked'
        ? '<span style="color:#1f6feb">✓ acknowledged</span>'
        : '<span style="color:#f0883e">pending</span>';
      h += '<div style="margin-top:10px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:4px">' +
           '<div><b>' + esc(r.character) + '</b> ' + status + '</div>' +
           '<div class="dim" style="font-size:11px;margin-top:2px">' +
             scopeStart + ' &rarr; ' + scopeEnd +
             (r.requested_by_name ? ' &middot; by ' + esc(r.requested_by_name) : '') +
           '</div>' +
           (r.reason ? '<div style="margin-top:4px;font-size:12px">' + esc(r.reason) + '</div>' : '') +
           '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
             (r.status === 'pending'
               ? '<button data-bf-act="ack" data-bf-id="' + esc(r.id) + '" style="background:#1a7f37;border-color:#1a7f37;color:#fff">Accept</button>'
               : '<span class="dim" style="font-size:11px">Now run the file matching ' + esc(r.character) + ' below ↓</span>') +
             '<button data-bf-act="dismiss" data-bf-id="' + esc(r.id) + '" data-bf-char="' + esc(r.character) + '" style="background:transparent;border-color:var(--border);color:var(--dim)">Dismiss</button>' +
           '</div>' +
           '</div>';
    }
    h += '</div>';
  }

  h += '<div class="card wide"><h2>Historical Log Opt-in — ' + _optinPane[0].toUpperCase()+_optinPane.slice(1) +
          ' (' + list.length + ')</h2>';
  h += '<div class="subtle">Backfill captures guild/raid chat + boss-matched combat kills (tagged with raid-window status). ' +
       '<span style="color:var(--blue)">Blue</span> = requested by the bot.</div>';
  // Toolbar
  h += '<div style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap;align-items:center">' +
       '<button data-act="pane-active"  class="' + (_optinPane==='active'?'active':'') + '">Active (' + (o.files?.length||0) + ')</button>' +
       '<button data-act="pane-ignored" class="' + (_optinPane==='ignored'?'active':'') + '">Ignored (' + (o.ignored?.length||0) + ')</button>' +
       '<span style="flex:1"></span>' +
       'Sort: <select id="sortMode">' +
         ['date','size','alpha'].map(m => '<option value="'+m+'"' + (o.sortMode===m?' selected':'') + '>'+m+'</option>').join('') +
       '</select>' +
       '<button data-act="select-all">Select all</button>' +
       '<button data-act="select-none">Clear</button>' +
       '<button data-act="rescan">Rescan dir</button>' +
       (_optinPane==='active'
         ? '<button data-act="backfill" ' + (selCount===0?'disabled':'') + ' style="background:#1a7f37;border-color:#1a7f37;color:#fff">' +
             (selCount>0 ? 'Backfill '+selCount+' selected' : 'Backfill selected') + '</button>'
         : '<button data-act="restore" ' + (selCount===0?'disabled':'') + '>Restore selected</button>') +
       (_optinPane==='active'
         ? '<button data-act="ignore" ' + (selCount===0?'disabled':'') + '>Ignore selected</button>'
         : '') +
       '</div>';
  // Active backfills banner — with a Stop-all button so the user can pause
  // the whole import at once. Per-file resume position is preserved, so
  // clicking Backfill again on the same selection picks up where it left off.
  if ((o.activeBackfills||[]).length > 0) {
    h += '<div class="banner resumed" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
         '<span>⏳ Running: ' +
         o.activeBackfills.map(b => esc(b.character) + ' (' +
           (b.totalBytes ? Math.floor(b.bytePos/b.totalBytes*100)+'%' : '?') +
           ', ' + b.chatCount + ' chat, ' + (b.encounterCount||0) + ' enc)').join(' · ') +
         '</span>' +
         '<button data-act="stop-all" style="background:#a40e26;border-color:#a40e26;color:#fff;margin-left:auto">⏸ Pause all</button>' +
         '</div>';
  }
  // Group files by character so 'Hitya' with eqlog_Hitya_pq.proj.txt and
  // eqlog_Hitya_pq.proj.txt2 (the rolled-over backup) show under one header.
  const byChar = {};
  for (const f of list) {
    (byChar[f.character] = byChar[f.character] || []).push(f);
  }
  const sizeFmt = (b) => !b ? '0' : b<1024 ? b+'B' : b<1048576 ? Math.round(b/1024)+'KB' : b<1073741824 ? (b/1048576).toFixed(1)+'MB' : (b/1073741824).toFixed(2)+'GB';

  h += '<table><tr><th></th><th>Character</th><th>File(s)</th><th>Size</th><th>Modified</th><th>Resume</th></tr>';
  for (const char of Object.keys(byChar)) {
    const files = byChar[char];
    const first = files[0];
    const nameColor = first.requested ? 'var(--blue)' : (first.isAlt ? 'var(--dim)' : 'var(--orange)');
    files.forEach((f, idx) => {
      const fname = f.path.split(/[/\\\\]/).pop();
      const ageDays = f.mtime ? Math.floor((Date.now()-f.mtime)/86400000) : null;
      const ageStr = ageDays === null ? '?' : ageDays<1 ? 'today' : ageDays<30 ? ageDays+'d ago' : ageDays<365 ? Math.floor(ageDays/30)+'mo ago' : Math.floor(ageDays/365)+'y ago';
      let resumeStr = '';
      if (f.resume?.complete) {
        // Surface when + which agent version finished this file, plus a
        // re-run button so the user can re-trigger when the log has grown.
        // Re-run posts {action:'rerun',paths:[path]} which clears bytePos
        // and re-enqueues the file for backfill.
        const when = f.resume?.completedAt
          ? new Date(f.resume.completedAt).toLocaleString()
          : '';
        const ver = f.resume?.agentVersion ? 'v' + f.resume.agentVersion : '';
        const counts = f.resume?.chatCount != null
          ? f.resume.chatCount + ' chat · ' + (f.resume.encounterCount || 0) + ' enc'
          : '';
        const tip = [when, ver, counts].filter(Boolean).join(' · ');
        resumeStr =
          '<span style="color:var(--green)" title="' + esc(tip) + '">✓ done</span>' +
          (when ? ' <span class="dim" style="font-size:10px">' + esc(when.replace(/, /, ' ')) + (ver ? ' · ' + esc(ver) : '') + '</span>' : '') +
          ' <button data-rerun="' + esc(f.path) + '" title="Re-run backfill from byte 0 — picks up PvP kills, chat, and combat events that newer agent/bot versions extract but the prior pass missed. Server-side dedup prevents double-counting." style="margin-left:8px;background:#a06628;border:1px solid #a06628;color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;cursor:pointer;font-weight:500">↻ Re-run</button>';
      }
      else if (f.resume?.bytePos > 0 && f.sizeBytes) {
        const pct = Math.floor(f.resume.bytePos / f.sizeBytes * 100);
        resumeStr = '<span style="color:var(--gold)">' + pct + '% (line ' + (f.resume.lineNum || '?') + ')</span>';
      }
      if (f.active) resumeStr = '<span style="color:var(--green)">⏳ running</span>';
      // For the SECOND+ file in the group, show the file row indented and
      // skip the character name (it's already in the row above).
      const charCell = idx === 0
        ? '<td style="color:' + nameColor + ';font-weight:bold">' + esc(char) + (files.length > 1 ? ' <span class="dim" style="font-weight:normal">(' + files.length + ' files)</span>' : '') + '</td>'
        : '<td></td>';
      const fnameStyle = idx === 0 ? 'class="dim"' : 'class="dim" style="padding-left:18px"';
      // Live-tailed files can still be backfilled — server-side dedup
      // (find_or_create_encounter + chat_messages unique constraint) keeps
      // overlap from double-counting. We just surface the live badge so
      // the user knows the live tail is also covering this character.
      const cbAttrs = f.selected ? 'checked' : '';
      const cbTitle = f.isWatched
        ? ' title="Live tail is running — backfill will fill in earlier history; overlap dedupes server-side"'
        : '';
      const liveBadge = f.isWatched
        ? ' <span style="color:var(--green);font-size:11px">● live</span>'
        : '';
      const altBadge = f.isAlt
        ? ' <span class="dim" style="font-size:11px">(alt)</span>'
        : '';
      h += '<tr>' +
           '<td><input type="checkbox" data-path="' + esc(f.path) + '" ' + cbAttrs + cbTitle + '></td>' +
           charCell +
           '<td ' + fnameStyle + '>' + esc(fname) + altBadge + liveBadge + '</td>' +
           '<td class="num">' + sizeFmt(f.sizeBytes) + '</td>' +
           '<td class="dim">' + ageStr + '</td>' +
           '<td>' + resumeStr + '</td>' +
           '</tr>';
    });
  }
  h += '</table></div>';
  const root = document.getElementById('optin');
  root.innerHTML = h;

  // Wire interactions
  root.querySelectorAll('input[type=checkbox][data-path]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await postOptin(cb.checked ? 'select' : 'deselect', { paths: [cb.dataset.path] });
      refreshOptin();
    });
  });
  root.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', async () => {
      const act = b.dataset.act;
      if (act === 'pane-active')  { _optinPane = 'active';  refreshOptin(); return; }
      if (act === 'pane-ignored') { _optinPane = 'ignored'; refreshOptin(); return; }
      if (act === 'select-all')   { await postOptin('select-all');   refreshOptin(); return; }
      if (act === 'select-none')  { await postOptin('select-none');  refreshOptin(); return; }
      if (act === 'rescan')       { await postOptin('rescan');       refreshOptin(); return; }
      if (act === 'backfill') {
        const paths = [...root.querySelectorAll('input[type=checkbox][data-path]:checked')].map(x => x.dataset.path);
        if (paths.length > 0 && confirm('Start chat-only backfill on ' + paths.length + ' file(s)?')) {
          await postOptin('backfill', { paths });
        }
        refreshOptin(); return;
      }
      if (act === 'ignore' || act === 'restore') {
        const paths = [...root.querySelectorAll('input[type=checkbox][data-path]:checked')].map(x => x.dataset.path);
        if (paths.length > 0) await postOptin(act, { paths });
        refreshOptin(); return;
      }
      if (act === 'stop-all') {
        // Server pauses every running backfill; current byte position is
        // already persisted so clicking Backfill again resumes from there.
        await postOptin('stop');
        refreshOptin(); return;
      }
    });
  });
  // Per-file ↻ Re-run button on completed entries. Clears the saved
  // bytePos for that single path and kicks a fresh backfill from byte 0
  // so any data appended since the last completion gets processed. The
  // server-side dedup (encounters window + chat unique key + fun_events
  // unique key) keeps re-uploaded events from inflating any totals.
  root.querySelectorAll('button[data-rerun]').forEach(b => {
    b.addEventListener('click', async () => {
      const p = b.dataset.rerun;
      if (!p) return;
      if (!confirm('Re-run backfill on this file from the beginning? Useful when the log has grown since the last completion.')) return;
      await postOptin('rerun', { paths: [p] });
      refreshOptin();
    });
  });
  // Backfill request Accept / Dismiss buttons
  root.querySelectorAll('button[data-bf-act]').forEach(b => {
    b.addEventListener('click', async () => {
      const id  = b.dataset.bfId;
      const act = b.dataset.bfAct;
      if (!id || !act) return;
      let reason = null;
      if (act === 'dismiss') {
        const char = b.dataset.bfChar || 'this character';
        reason = prompt('Dismiss backfill request for ' + char + '?\\n\\nOptional reason (shown to the officer):', '');
        if (reason === null) return;  // cancelled
      }
      const action = act === 'ack' ? 'ack-backfill' : 'dismiss-backfill';
      await postOptin(action, { id, reason });
      refreshOptin();
    });
  });
  const sel = root.querySelector('#sortMode');
  if (sel) sel.addEventListener('change', async () => { await postOptin('sort', { mode: sel.value }); refreshOptin(); });
}

async function refreshOptin() {
  try {
    const o = await (await fetch('/api/optin')).json();
    renderOptin(o);
  } catch { renderOptin(null); }
}

async function refresh() {
  try {
    const s = await (await fetch('/api/state')).json();
    renderHeader(s); renderDash(s); renderTanks(s); renderHealers(s); renderDeeps(s); renderPets(s); renderInfo(s);
    // Surface pending backfill request count on the Opt-in tab so officers
    // notice without clicking through.
    const pending = (s.backfillRequests || []).filter(r => r.status === 'pending').length;
    const optinBtn = document.querySelector('.nav button[data-tab="optin"]');
    if (optinBtn) {
      const baseLabel = 'Opt-in Logs';
      optinBtn.textContent = pending > 0 ? (baseLabel + ' (' + pending + ')') : baseLabel;
      optinBtn.style.color = pending > 0 ? '#f0883e' : '';
    }
  } catch (e) { /* network blip — just retry next tick */ }
}

document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.nav button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.section').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById(b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'optin') refreshOptin();
}));
refresh(); setInterval(refresh, 2000);
// Refresh opt-in every 3s while its tab is active (for live backfill progress)
setInterval(() => { if (document.getElementById('optin').classList.contains('active')) refreshOptin(); }, 3000);

// W (lowercase or uppercase) opens wolfpack.quest in a new tab. Ignored when
// the user is typing into an input/textarea so it doesn't hijack normal typing.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'w' && e.key !== 'W') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const tag = (e.target?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
  e.preventDefault();
  document.getElementById('wolfpackQuestLink')?.click();
});

async function dismissTopDamage(key) {
  try {
    await fetch('/api/topdamage/dismiss', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(key) });
    refresh();
  } catch {}
}

// ── Panel customization (increment 1: show/hide via the gear menu) ──────────
// Each dashboard .card is a panel, keyed by a STABLE prefix of its <h2> title
// (text before the first "(", em-dash, or middot so dynamic counts like
// "Watched Logs (1 char...)" or "Live Threat — Boss" stay stable). Users hide
// panels they do not want; the choice persists in localStorage and re-applies
// after every section re-render via a MutationObserver. Drag-to-arrange and
// the new loot/bids panels come in later increments.
(function(){
  var LS_KEY = "wpHiddenPanels";
  function loadHidden(){
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function saveHidden(set){
    try { localStorage.setItem(LS_KEY, JSON.stringify(Array.from(set))); } catch (e) {}
  }
  function panelKey(card){
    var h = card.querySelector("h2");
    var t = h ? (h.textContent || "") : "";
    t = t.split("(")[0].split("—")[0].split("·")[0];
    return t.trim().toLowerCase();
  }
  function allCards(){
    return Array.prototype.slice.call(document.querySelectorAll(".section .card"));
  }
  function applyHidden(){
    var hidden = loadHidden();
    allCards().forEach(function(card){
      var k = panelKey(card);
      if (k && hidden.has(k)) card.classList.add("wp-hidden");
      else card.classList.remove("wp-hidden");
    });
  }
  function buildMenu(){
    var menu = document.getElementById("wpPanelMenu");
    if (!menu) return;
    var hidden = loadHidden();
    var seen = {};
    var rows = [];
    allCards().forEach(function(card){
      var k = panelKey(card);
      if (!k || seen[k]) return;
      seen[k] = true;
      var h = card.querySelector("h2");
      var label = h ? (h.textContent || k) : k;
      label = label.split("(")[0].split("—")[0].split("·")[0].trim();
      rows.push({ key: k, label: label });
    });
    var html = "<h4>Show panels</h4>";
    rows.forEach(function(r){
      var checked = hidden.has(r.key) ? "" : " checked";
      html += "<label><input type=checkbox data-pk='" + r.key + "'" + checked + "> " + r.label + "</label>";
    });
    html += "<div class=wp-actions><button id=wpShowAll>Show all</button><button id=wpClose>Close</button></div>";
    menu.innerHTML = html;
    Array.prototype.slice.call(menu.querySelectorAll("input[data-pk]")).forEach(function(cb){
      cb.addEventListener("change", function(){
        var set = loadHidden();
        var pk = cb.getAttribute("data-pk");
        if (cb.checked) set.delete(pk); else set.add(pk);
        saveHidden(set);
        applyHidden();
      });
    });
    var showAll = document.getElementById("wpShowAll");
    if (showAll) showAll.addEventListener("click", function(){ saveHidden(new Set()); applyHidden(); buildMenu(); });
    var closeBtn = document.getElementById("wpClose");
    if (closeBtn) closeBtn.addEventListener("click", function(){ menu.style.display = "none"; });
  }
  var gear = document.getElementById("wpGear");
  var menu = document.getElementById("wpPanelMenu");
  if (gear && menu){
    gear.addEventListener("click", function(e){
      e.stopPropagation();
      if (menu.style.display !== "block"){
        buildMenu();
        menu.style.top = (gear.getBoundingClientRect().bottom + window.scrollY + 4) + "px";
        menu.style.right = "16px";
        menu.style.display = "block";
      } else {
        menu.style.display = "none";
      }
    });
    document.addEventListener("click", function(e){
      if (menu.style.display === "block" && !menu.contains(e.target) && e.target !== gear) menu.style.display = "none";
    });
  }
  var obs = new MutationObserver(function(){ applyHidden(); });
  ["dash","tanks","healers","deeps","pets","info","optin"].forEach(function(id){
    var el = document.getElementById(id);
    if (el) obs.observe(el, { childList: true, subtree: true });
  });
  applyHidden();
})();
</script></body></html>`;

async function _readBody(req, max = 64 * 1024) {
  const chunks = []; let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > max) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function _serializeOptinForWeb() {
  if (!_optinState.scanned) _scanOptInFiles();
  const mapFile = (f) => ({
    path:      f.path,
    character: f.character,
    isAlt:     f.isAlt,
    isWatched: !!f.isWatched,  // ← was omitted; without it the UI couldn't tell
    sizeBytes: f.sizeBytes,    //   the checkbox should render as `disabled`,
    sizeMb:    f.sizeMb,       //   so clicks reached the server but were
    mtime:     f.mtime ? f.mtime.getTime() : null,  // silently dropped by the
    selected:  !!f.selected,                        // `!f.isWatched` guard
    requested: !!f.requested,                       // in the select handler.
    resume:    f.resume || null,
    active:    _activeBackfills.has(f.path),
    activeStatus: _activeBackfills.get(f.path) || null,
  });
  return {
    sortMode: _optinState.sortMode,
    pane:     _optinState.pane,
    files:    _optinState.files.map(mapFile),
    ignored:  _optinState.ignored.map(mapFile),
    activeBackfills: [..._activeBackfills.values()],
    // Officer-filed backfill requests targeting any character we watch.
    // Populated by pollBackfillRequests; we expose just the actionable
    // fields needed for the dashboard banner.
    backfillRequests: (stats.backfillRequests || []).map(r => ({
      id:                r.id,
      character:         r.character,
      requested_at:      r.requested_at,
      requested_by_name: r.requested_by_name,
      reason:            r.reason,
      scope:             r.scope,
      status:            r.status,
    })),
    backfillRequestsCheckedAt: stats.backfillRequestsCheckedAt,
  };
}

function startWebDashboard(port) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(WEB_HTML);
      }
      if (req.url === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(_serializeForDashboard()));
      }
      if (req.url === '/api/shutdown' && req.method === 'POST') {
        // Save session + drop PID file + exit. Used by parser.bat re-launches
        // when the user picks "kill the service" so they can take over the
        // window OR exit cleanly.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'shutting down' }));
        setTimeout(() => {
          try { saveSessionState(); } catch {}
          removePidFile();
          process.exit(0);
        }, 250);
        return;
      }
      if (req.url === '/api/update' && req.method === 'POST') {
        // Same behavior as [U] press: save session, write update marker, exit.
        // In foreground/CLI mode the wrapper script (start-logsync.ps1) sees
        // the marker and downloads + relaunches the new version.
        // In background service mode (--no-service-check) the wrapper exited
        // long ago, so we spawn a new copy of ourselves before exiting so the
        // web dashboard comes back up automatically.
        //
        // Update gate: refuse if the upload queue has entries, a backfill
        // is running, or a fight is in progress. Pass ?force=1 to override
        // (e.g. user explicitly accepts the data-loss risk).
        const forceParam = (req.url.split('?')[1] || '').split('&').includes('force=1');
        const blockedReason = forceParam ? null : _updateBlockedReason();
        if (blockedReason) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            ok: false,
            blocked: true,
            reason: blockedReason,
            hint:   'Append ?force=1 to override at your own risk.',
          }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'restarting' }));
        setTimeout(() => {
          try { saveSessionState(); } catch {}
          try {
            const marker = path.join(__dirname, '.force-update-on-restart');
            fs.writeFileSync(marker, new Date().toISOString());
          } catch {}
          if (_isServiceMode) {
            try {
              const { spawn } = require('child_process');
              const child = spawn(process.execPath, process.argv.slice(1), {
                detached: true,
                stdio:    'ignore',
                cwd:      process.cwd(),
              });
              child.unref();
            } catch {}
          }
          process.exit(0);
        }, 250);  // let the response flush
        return;
      }
      if (req.url === '/api/reset-session' && req.method === 'POST') {
        // Zero out everything session-scoped so the dashboard looks fresh.
        // Lifetime totals + persisted resume state for opt-in backfills are
        // intentionally left untouched. This is a click-to-reset for officers
        // who want a clean board between raid nights or after testing.
        resetSessionStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.url === '/api/loadouts/hide' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end('invalid json'); }
        const chars = Array.isArray(payload?.chars) ? payload.chars : [];
        const action = payload?.action;
        for (const c of chars) {
          const key = String(c).toLowerCase();
          if (action === 'show') _optinState.hiddenLoadoutChars.delete(key);
          else                   _optinState.hiddenLoadoutChars.add(key);
        }
        _saveOptInState();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, hidden: [..._optinState.hiddenLoadoutChars] }));
      }
      if (req.url === '/api/topdamage/dismiss' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end('invalid json'); }
        const { list, attacker, amount } = payload || {};
        const arr = list === 'did' ? stats.topDamageDid : stats.topDamageSaw;
        const idx = arr.findIndex(e => e.attacker === attacker && e.amount === amount);
        if (idx >= 0) arr.splice(idx, 1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.url === '/api/optin' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(_serializeOptinForWeb()));
      }
      if (req.url === '/api/optin' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end('invalid json'); }

        const action = payload?.action;
        const paths  = Array.isArray(payload?.paths) ? payload.paths : [];
        const all    = [..._optinState.files, ..._optinState.ignored];
        const byPath = new Map(all.map(f => [f.path, f]));

        if (action === 'select') {
          // Live-tailed files are allowed — combat events dedup via
          // find_or_create_encounter (30-min window) and chat dedup via
          // chat_messages unique constraint, so overlap with the live tail
          // doesn't double-count server-side.
          for (const p of paths) { const f = byPath.get(p); if (f) f.selected = true; }
        } else if (action === 'deselect') {
          for (const p of paths) { const f = byPath.get(p); if (f) f.selected = false; }
        } else if (action === 'select-all') {
          for (const f of _optinState.files) f.selected = true;
        } else if (action === 'select-none') {
          for (const f of _optinState.files) f.selected = false;
        } else if (action === 'ignore') {
          for (const p of paths) _optinState.ignoredPaths.add(p);
          _saveOptInState();
          _optinState.scanned = false;
          _scanOptInFiles();
        } else if (action === 'restore') {
          for (const p of paths) _optinState.ignoredPaths.delete(p);
          _saveOptInState();
          _optinState.scanned = false;
          _scanOptInFiles();
        } else if (action === 'sort') {
          const mode = payload.mode;
          if (mode === 'date' || mode === 'size' || mode === 'alpha') {
            _optinState.sortMode = mode;
            _resortOptIn();
          }
        } else if (action === 'rescan') {
          _optinState.scanned = false;
          _scanOptInFiles();
        } else if (action === 'backfill') {
          const targets = paths.length > 0
            ? paths.map(p => byPath.get(p)).filter(Boolean)
            : _optinState.files.filter(f => f.selected);
          if (targets.length > 0) {
            runOptinBackfill(targets, {
              log: (m) => console.log(`[optin] ${m}`),
            });
          }
        } else if (action === 'stop') {
          // Flag running backfills to abort at the next chunk boundary. The
          // current byte position is preserved in _optinState.progress, so
          // a subsequent Backfill click resumes from where this stopped.
          // Empty paths = stop everything currently running.
          const toStop = paths.length > 0 ? paths : [..._activeBackfills.keys()];
          for (const p of toStop) {
            if (_activeBackfills.has(p)) _abortedBackfills.add(p);
          }
          console.log(`[optin] Stop requested for ${toStop.length} backfill(s)`);
        } else if (action === 'rerun') {
          // Reset the saved progress for these paths and re-trigger a
          // fresh backfill from byte 0. Server-side dedup keeps re-
          // uploaded data from inflating any totals; the prior
          // completedAt / agentVersion in the entry get overwritten when
          // this fresh run finishes.
          const toRerun = [];
          for (const p of paths) {
            const f = byPath.get(p);
            if (!f) continue;
            delete _optinState.progress[p];
            f.selected = true;
            toRerun.push(f);
          }
          _saveOptInState();
          if (toRerun.length > 0) {
            runOptinBackfill(toRerun, { log: (m) => console.log(`[optin] ${m}`) });
            console.log(`[optin] Re-run kicked for ${toRerun.length} file(s)`);
          }
        } else if (action === 'ack-backfill' || action === 'dismiss-backfill') {
          // Backfill request status transitions — POST to the bot, then
          // re-poll so the local view reflects what the bot sees.
          const id     = payload?.id;
          const reason = payload?.reason || null;
          if (!id) {
            res.writeHead(400); return res.end(JSON.stringify({ error: 'missing id' }));
          }
          const bot = (_uploadOpts || {});
          const botAct = action === 'ack-backfill' ? 'ack' : 'dismiss';
          const body   = botAct === 'dismiss' && reason ? { reason } : null;
          const ok = await postBackfillRequestAction({
            botUrl: bot.botUrl, token: bot.token, id, action: botAct, body,
          });
          // Refresh from bot so the UI shows the new status without waiting
          // for the 5-min interval.
          await pollBackfillRequests({ botUrl: bot.botUrl, token: bot.token });
          if (!ok) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'bot returned non-2xx' }));
          }
        } else {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'unknown action' }));
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(_serializeOptinForWeb()));
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
  let _bindRetries = 0;
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && _bindRetries < 5) {
      _bindRetries++;
      setTimeout(() => server.listen(port, '127.0.0.1'), 1000 * _bindRetries);
    } else {
      console.warn(`[web-dashboard] could not bind to port ${port}: ${err.message}`);
    }
  });
  // Bind to 127.0.0.1 only — never expose to network.
  server.listen(port, '127.0.0.1', () => {
    if (!_dashboardEnabled) console.log(`[web-dashboard] http://localhost:${port}`);
  });
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
  // Skip self-hits: pet reclaim / cleric pet self-dismiss generates a log line
  // where the pet hits itself for exactly 20K. attacker === defender catches it.
  if (event.defender && attacker.toLowerCase() === event.defender.toLowerCase()) return;

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

  // Flat-amount execute abilities never reflect sustained DPS — they're
  // cooldowns that fire when a mob crosses an HP threshold. Decapitate
  // (Warrior 65), Finishing Blow (Warrior 65 Killing-Spree), Assassinate
  // (Rogue 65), Headshot (Ranger 65 ranged) all land at exactly 32,000.
  // A second cluster of execute / capstone procs lands at exactly 20,000.
  // Excluding both keeps the top-damage panel meaningful — these end up
  // misleadingly dominating the list every raid night otherwise.
  if (event.amount === 32000 || event.amount === 20000) return;

  // Top-damage lists thresholds — use a much lower bar for the uploader's own
  // hits so solo / low-level / non-raid content still populates "Top damage I
  // did". A monk at 60 might never exceed 500 per hit but still wants to see
  // their crits and big swings on the dashboard.
  //
  // For other players, generic melee swings (ability='hit') get a much
  // higher floor than named abilities. Casters and hybrids often have
  // weapon swings landing around 1-3k, which drowned out their actual
  // spell crits in the panel. Named procs / spells still surface at the
  // normal 250 threshold so an enchanter's Color Slant or a wizard's
  // Pillar still shows up.
  const isBareHit = (event.ability || '').toLowerCase() === 'hit';
  const threshold = isMine ? 50 : (isBareHit ? 5000 : 250);
  if (event.amount < threshold) return;

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
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
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
let _isServiceMode    = false;  // true when started with --no-service-check (background service)
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
  // Inline new-version badge next to the current version
  if (stats.updateAvailable && isNewerVersion(stats.latestAgentVersion, AGENT_VERSION)) {
    out.push(`  ${C.bold}${C.yellow}→ v${stats.latestAgentVersion} available${C.reset} ${C.dim}([U] to install)${C.reset}`);
  }
  if (stats.uploadCount) out.push(`   ${C.dim}| ${stats.uploadCount} upload${stats.uploadCount === 1 ? '' : 's'} this session${C.reset}`);
  if (stats._sessionRestoredBanner && stats._sessionRestoredAt
      && (Date.now() - stats._sessionRestoredAt) < 120_000) {
    out.push(`   ${C.green}↻ session resumed${C.reset}`);
  }
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
  // Dedup by character so chars with many log files (post-Mimic, Mimic
  // tails every eqlog_*_pq.proj.txt in the EQ dir) collapse to one row.
  const _byCharCli = new Map();
  for (const w of stats.watchedLogs) {
    const k = (w.character || '?').toLowerCase();
    const cur = _byCharCli.get(k);
    if (!cur || (w.lastSeen || 0) > (cur.lastSeen || 0)) _byCharCli.set(k, w);
  }
  const _suffix = stats.watchedLogs.length > _byCharCli.size
    ? ` (${stats.watchedLogs.length} files)`
    : '';
  right.push(`${C.dim}Watching ${_byCharCli.size} char(s)${_suffix}:${C.reset}`);
  const recent = [..._byCharCli.values()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, 8);
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
  out.push(`  ${C.cyan}[T]${C.reset} Tanks  ${C.gray}|${C.reset}  ${C.cyan}[H]${C.reset} Healers  ${C.gray}|${C.reset}  ${C.cyan}[P]${C.reset} Pets  ${C.gray}|${C.reset}  ${C.cyan}[I]${C.reset} Info / Stats  ${C.gray}|${C.reset}  ${uHint}  ${C.gray}|${C.reset}  ${C.cyan}[O]${C.reset} Opt-in logs  ${C.gray}|${C.reset}  ${C.bold}${C.green}[B]${C.reset} Background service  ${C.gray}|${C.reset}  ${C.cyan}[K]${C.reset} Token  ${C.gray}|${C.reset}  ${C.cyan}[Ctrl+C]${C.reset} Exit\n`);
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
      // Update gate: don't bounce the agent mid-fight, mid-backfill, or
      // with queued uploads on disk. Press Shift+U to force.
      const blockedReason = (key === 'U') ? null : _updateBlockedReason();
      if (blockedReason) {
        process.stdout.write(`${ANSI.yellow}\n  Update blocked: ${blockedReason}.${ANSI.reset}\n`);
        process.stdout.write(`${ANSI.dim}  Press ${ANSI.cyan}Shift+U${ANSI.dim} to force the restart anyway (may drop unflushed data).${ANSI.reset}\n`);
        return;
      }
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
    // W = open wolfpack.quest in the default browser. Available from any view
    // since it's a shortcut to leave the terminal and look at the web app.
    if (key === 'w' || key === 'W') {
      const url = process.env.WOLFPACK_WEB_URL || 'https://wolfpack.quest';
      const cmd = process.platform === 'win32' ? `start "" "${url}"`
                : process.platform === 'darwin' ? `open "${url}"`
                : `xdg-open "${url}"`;
      try { require('child_process').exec(cmd); } catch {}
      process.stdout.write(`${ANSI.dim}\n  Opening ${url} in your browser...${ANSI.reset}\n`);
    }
    // [B] — detach into a background service and exit this window. The new
    // process runs hidden (no cmd.exe window on Windows) and opens the web
    // dashboard. Re-opening parser.bat will detect the running service and
    // just show its dashboard URL instead of double-tailing.
    // (Was [S] in v2.3.20 — moved to [B] so [S] is free for opt-in sort.)
    if (key === 'b' || key === 'B') {
      try { saveSessionState(); } catch {}
      const { spawn } = require('child_process');
      // Strip --web-port from original args (if present) and force one
      const webPort = 7777;
      const filteredArgs = [];
      for (let i = 2; i < process.argv.length; i++) {
        const a = process.argv[i];
        if (a === '--web-port') { i++; continue; }      // drop value too
        if (a === '--no-service-check') continue;
        if (a === '--no-auto-open')     continue;
        filteredArgs.push(a);
      }
      filteredArgs.push('--web-port', String(webPort));
      filteredArgs.push('--no-service-check');           // child IS the service
      filteredArgs.push('--no-auto-open');               // parent will open the browser
      try {
        const child = spawn(process.execPath, [__filename, ...filteredArgs], {
          detached:    true,
          stdio:       'ignore',
          windowsHide: true,
        });
        child.unref();
        process.stdout.write(`\n${ANSI.green}  ✓ Service started in background (pid ${child.pid})${ANSI.reset}\n`);
        process.stdout.write(`  ${ANSI.cyan}Dashboard:${ANSI.reset} http://localhost:${webPort}\n`);
        process.stdout.write(`  ${ANSI.dim}Opening browser… this window will close in a moment.${ANSI.reset}\n`);
        // Give the child ~1.5s to bind the port, then open the browser, then exit.
        // The child has --no-auto-open so it won't double-open.
        setTimeout(() => {
          openDashboardInBrowser(webPort);
          setTimeout(() => process.exit(0), 500);
        }, 1500);
      } catch (err) {
        process.stdout.write(`\n${ANSI.red}  ✗ Could not start background service: ${err.message}${ANSI.reset}\n`);
      }
    }
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
  // Sort mode for both panes — cycle with [S] in opt-in view
  sortMode: 'date',    // 'date' | 'size' | 'alpha'
  // Per-file backfill progress (persisted): { [path]: { bytePos, totalBytes, lineNum, updatedAt, character } }
  progress: {},
  // Ignored file paths (persisted across runs)
  ignoredPaths: new Set(),
  // Character names hidden from the Tank/Weapon Loadouts view
  hiddenLoadoutChars: new Set(),
};

function _optinSortFn() {
  // Requested files always float to the top; then by current sort mode.
  const fns = {
    date:  (a, b) => (b.mtime || 0) - (a.mtime || 0) || (b.sizeBytes || 0) - (a.sizeBytes || 0),
    size:  (a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0) || (b.mtime || 0) - (a.mtime || 0),
    alpha: (a, b) => a.character.toLowerCase().localeCompare(b.character.toLowerCase()),
  };
  const byMode = fns[_optinState.sortMode] || fns.date;
  return (a, b) => {
    if (a.requested !== b.requested) return a.requested ? -1 : 1;
    return byMode(a, b);
  };
}
function _resortOptIn() {
  const fn = _optinSortFn();
  _optinState.files.sort(fn);
  _optinState.ignored.sort(fn);
}

function _loadOptInState() {
  try {
    const raw = JSON.parse(fs.readFileSync(OPTIN_STATE_FILE, 'utf8'));
    _optinState.progress             = raw.progress             || {};
    _optinState.ignoredPaths         = new Set(raw.ignoredPaths || []);
    _optinState.hiddenLoadoutChars   = new Set((raw.hiddenLoadoutChars || []).map(s => s.toLowerCase()));
  } catch { /* missing or unreadable — fresh state */ }
}
function _saveOptInState() {
  try {
    fs.writeFileSync(OPTIN_STATE_FILE, JSON.stringify({
      progress:           _optinState.progress,
      ignoredPaths:       [..._optinState.ignoredPaths],
      hiddenLoadoutChars: [...(_optinState.hiddenLoadoutChars || [])],
    }, null, 2));
  } catch { /* non-fatal */ }
}

// ── Inventory file ingestion ──────────────────────────────────────────────
// EQ's /output inventory command writes <Character>-Inventory.txt to the EQ
// install dir. Tab-separated columns: Location, Name, ID, Count, Slots.
// We extract weapon slots (Primary/Secondary/Range/Ammo) for the threat
// calculator — Phase 2 will join item IDs against a weapon DB (DMG/Delay/proc)
// to model theoretical TPS, but for now even just knowing the names is useful
// for the dashboard.
//
// We refresh on startup and every 5 minutes — inventories don't change often
// but we want to catch when a tank swaps weapons mid-session.

const INVENTORY_FILENAME_RX = /^([A-Za-z]+)-Inventory\.txt$/i;
// Bandolier sets — `/output bandolier` writes <Char>_bandolier.ini next to the
// inventory file. INI sections are set names; rows are slot → item ID. Slots:
// 0 = Primary, 1 = Secondary, 2 = Range, 3 = Ammo. Value 0 = empty.
const BANDOLIER_FILENAME_RX = /^([A-Za-z]+)_bandolier\.ini$/i;
const INVENTORY_WEAPON_SLOTS = new Set(['Primary', 'Secondary', 'Range', 'Ammo']);
// Container slots we also pull so future expansion can show bags.
const INVENTORY_WORN_SLOTS = new Set([
  'Charm','Ear','Head','Face','Neck','Shoulders','Arms','Back','Wrist','Range',
  'Hands','Primary','Secondary','Fingers','Chest','Legs','Feet','Waist','Power Source','Ammo',
]);

function parseBandolierFile(text) {
  // INI-ish format observed in Hitya_bandolier.ini:
  //   [setname]
  //   0=27315
  //   1=26860
  //   2=30565
  //   3=21809
  // Slot index 0..3 → primary/secondary/range/ammo. Value 0 = empty.
  const SLOTS = ['primary', 'secondary', 'range', 'ammo'];
  const sets = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const section = line.match(/^\[(.+?)\]$/);
    if (section) {
      current = section[1];
      sets[current] = { primary: null, secondary: null, range: null, ammo: null };
      continue;
    }
    if (!current) continue;
    const kv = line.match(/^(\d+)\s*=\s*(\d+)/);
    if (!kv) continue;
    const slot = SLOTS[parseInt(kv[1], 10)];
    const id   = parseInt(kv[2], 10);
    if (slot && id > 0) sets[current][slot] = id;
  }
  return sets;
}

function parseInventoryFile(text) {
  // Verified against real Hitya inventory:
  //   - Tab-separated: Location, Name, ID, Count, Slots
  //   - Empty slots use literal 'Empty' with ID 0
  //   - Bag contents follow `<bag>-Slot<n>` pattern, e.g. 'General1-Slot1'
  const inv = { worn: {}, weapons: {}, bagged: [] };
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line) continue;
    // Skip header — first column is literally 'Location'
    if (/^Location\b/i.test(line)) continue;
    const cols = line.split('\t');
    if (cols.length < 2) continue;
    const loc      = (cols[0] || '').trim();
    const itemName = (cols[1] || '').trim();
    const itemId   = parseInt(cols[2], 10);
    const count    = parseInt(cols[3], 10) || 1;
    if (!loc || !itemName || itemName === '-' || itemName.toLowerCase() === 'empty') continue;

    const entry = { name: itemName, id: Number.isFinite(itemId) ? itemId : null, count };
    if (INVENTORY_WEAPON_SLOTS.has(loc)) {
      inv.weapons[loc.toLowerCase()] = entry;
    }
    if (INVENTORY_WORN_SLOTS.has(loc)) {
      inv.worn[loc] = entry;
    }
    // Bag contents — Phase-2 lets tanks pick alternate weapons from their bags
    if (/^General\d+-Slot\d+$/.test(loc)) {
      inv.bagged.push({ ...entry, loc });
    }
  }
  return inv;
}

function scanInventoryFiles() {
  // Scan the same directory the live logs are in — EQ writes inventories there.
  const firstLog = stats.watchedLogs[0]?.logPath;
  if (!firstLog) return {};
  const dir = path.dirname(firstLog);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return {}; }

  const out = {};
  const pascal = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

  // First pass — inventory files
  for (const name of entries) {
    const m = name.match(INVENTORY_FILENAME_RX);
    if (!m) continue;
    const character = pascal(m[1]);
    const fullPath = path.join(dir, name);
    try {
      const stat = fs.statSync(fullPath);
      const text = fs.readFileSync(fullPath, 'utf8');
      const inv  = parseInventoryFile(text);
      inv._path      = fullPath;
      inv._updatedAt = stat.mtime.toISOString();
      inv._sizeBytes = stat.size;
      out[character] = inv;
    } catch { /* unreadable */ }
  }

  // Second pass — bandolier .ini files. Attach to the inventory entry so we
  // can resolve item IDs to names from the same character's inventory.
  for (const name of entries) {
    const m = name.match(BANDOLIER_FILENAME_RX);
    if (!m) continue;
    const character = pascal(m[1]);
    const fullPath = path.join(dir, name);
    try {
      const text = fs.readFileSync(fullPath, 'utf8');
      const sets = parseBandolierFile(text);
      if (!out[character]) out[character] = { worn: {}, weapons: {}, bagged: [] };
      // Build id → name map from this character's known items so we can
      // present each bandolier slot with the friendly name + PQDI URL.
      const inv = out[character];
      const idToName = new Map();
      for (const slot of Object.values(inv.worn || {}))    if (slot.id) idToName.set(slot.id, slot.name);
      for (const item of inv.bagged || [])                 if (item.id) idToName.set(item.id, item.name);
      const enriched = {};
      for (const [setName, set] of Object.entries(sets)) {
        enriched[setName] = {};
        for (const [slot, id] of Object.entries(set)) {
          enriched[setName][slot] = id ? { id, name: idToName.get(id) || ('Item #' + id) } : null;
        }
      }
      inv.bandolier      = enriched;
      inv._bandolierPath = fullPath;
    } catch { /* unreadable */ }
  }
  return out;
}

function refreshInventories() {
  try { stats.characterInventories = scanInventoryFiles(); }
  catch { /* non-fatal */ }
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

    // Files already being tailed live are still listed here (so the user
    // can see all their characters), but marked isWatched=true so the UI
    // can render a "live" badge and disable the backfill checkbox —
    // backfilling a live file would duplicate events.
    const fullPath = path.join(dir, name);
    const isWatched = stats.watchedLogs.some(w => w.logPath === fullPath);

    // Normalise to PascalCase so 'hitya', 'HITYA', and 'Hitya' all group together
    const char = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
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
      isWatched,
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

  _resortOptIn();
  _optinState.scanned = true;
  _optinState.cursor  = 0;
}

// Separate keypress handler for the opt-in view (replaces the normal one while active)
let _optinKeyHandler = null;

// Read entire file with byte-position tracking; supports resume from a stored offset.
// onLine(line) is called for each line; onProgress({ bytePos, totalBytes, lineNum }) is called every ~256KB.
async function readFromBytePos(logPath, startBytePos, onLine, onProgress, abortCheck, backpressure) {
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
    let bpTimer = null;

    stream.on('data', chunk => {
      if (cancelled) return;
      // Abort check runs once per chunk (~64KB) — cheap, and the latency
      // between Stop click and actual halt stays under a chunk's processing
      // time. Destroying the stream fires 'close' which resolves us.
      if (abortCheck && abortCheck()) {
        cancelled = true;
        if (bpTimer) { clearInterval(bpTimer); bpTimer = null; }
        try { onProgress && onProgress({ bytePos, lineNum }); } catch {}
        stream.destroy();
        return;
      }
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
      // Backpressure: if the upload queue is near its cap, pause the read so
      // the drain loop can catch up before we feed more (avoids FIFO eviction
      // during a large backfill). Resume once it drains below the low mark.
      if (backpressure && !bpTimer && backpressure.queueLen() >= backpressure.high) {
        stream.pause();
        bpTimer = setInterval(() => {
          if (cancelled) { clearInterval(bpTimer); bpTimer = null; return; }
          if (backpressure.queueLen() < backpressure.low) {
            clearInterval(bpTimer); bpTimer = null;
            stream.resume();
          }
        }, 500);
      }
    });
    stream.on('end',   () => { if (bpTimer) { clearInterval(bpTimer); bpTimer = null; } if (onProgress) try { onProgress({ bytePos, lineNum }); } catch {} ; resolve({ bytePos, lineNum, aborted: cancelled }); });
    stream.on('close', () => { if (bpTimer) { clearInterval(bpTimer); bpTimer = null; } resolve({ bytePos, lineNum, aborted: cancelled }); });
    stream.on('error', (err) => { if (bpTimer) { clearInterval(bpTimer); bpTimer = null; } reject(err); });
  });
}

// ── Shared opt-in backfill driver — usable from both [O] keypress and the
// web dashboard. Files arg is an array of opt-in file records (path, character,
// sizeBytes). Returns a per-file status array via the optional `onStatus(...)`
// callback as work progresses, and a promise that resolves when all done.
const _activeBackfills    = new Map();   // path → { startedAt, chatCount, status }
const _abortedBackfills   = new Set();   // paths flagged for graceful abort

function runOptinBackfill(files, opts = {}) {
  const onStatus = opts.onStatus || (() => {});
  const log = opts.log || (() => {});
  const { botUrl, token, dryRun } = _uploadOpts || {};

  log(`Starting backfill on ${files.length} file(s) — chat + combat + /who...`);

  for (const f of files) {
    if (_activeBackfills.has(f.path)) {
      log(`  Skipping ${f.character} — backfill already in progress`);
      continue;
    }
    // Honor exclude_from_stats. The historical backfill is the place this
    // matters most — old logs may contain raids the member would prefer not
    // to expose. The live tail gate elsewhere covers ongoing capture.
    if (!shouldUploadForCharacter(f.character)) {
      log(`  Skipping ${f.character} — exclude_from_stats set on wolfpack.quest /me`);
      continue;
    }
    // Fresh start clears any stale abort flag from a previous run.
    _abortedBackfills.delete(f.path);
    const status = { character: f.character, path: f.path, chatCount: 0, encounterCount: 0,
                     startedAt: Date.now(), state: 'running', bytePos: 0, totalBytes: f.sizeBytes || 0 };
    _activeBackfills.set(f.path, status);
    onStatus(status);

    const chatBatch = [];
    const flushChat = async (force) => {
      if (chatBatch.length === 0) return;
      if (!force && chatBatch.length < 500) return;
      const batch = chatBatch.splice(0);
      await uploadHistoricalChat(batch, { botUrl, token, dryRun }).catch(() => {});
    };

    // Per-file builder: encounters auto-flush on boss death (see EncounterBuilder.add),
    // plus a final builder.flush() at end of file for any trailing events. /who
    // observations land in the module-level whoData map as a parseEvent side-effect
    // and ride along with the next uploadEncounter payload.
    //
    // backfill=true tags every upload so the bot's /api/agent/encounter handler
    // skips Discord card posting + boss-timer auto-kill + session damage
    // accumulation. silent=true tells the builder to NOT touch the local
    // dashboard counters (top damage, recentParses, sessionDeeps, threat
    // tables) — old log replays shouldn't move live numbers.
    const builder = new EncounterBuilder({
      character: f.character,
      silent: true,
      onFlush: payload => {
        status.encounterCount++;
        return uploadEncounter({ ...payload, backfill: true }, { botUrl, token, dryRun }).catch(err =>
          log(`  [upload error] ${f.character}: ${err.message}`)
        );
      },
    });

    (async () => {
      const stored    = _optinState.progress[f.path];
      const startByte = stored?.bytePos || 0;
      const totalBytes = f.sizeBytes || 0;
      status.bytePos = startByte;
      if (startByte > 0) {
        log(`  Resuming ${f.character} from ${Math.floor(startByte/Math.max(totalBytes,1)*100)}% (${startByte} bytes)`);
      } else {
        log(`  Backfilling ${f.character} from ${f.path}...`);
      }
      try {
        const result = await readFromBytePos(f.path, startByte,
          (line) => {
            // Fun-event detection runs before everything else so a single
            // line can drive a fun_event AND a normal chat/combat path. No
            // early return; the line still flows through downstream parsers.
            const ldEvt = parsePeopleslayerLd(line);
            if (ldEvt) funEventBuffer.push(ldEvt);
            // Both Malthur counters — caster-side (only Malthur's own log,
            // ground truth) and recipient-side (every member's log, broad
            // reach) cross-validate each other.
            const provEvt = parseMalthurProvision(line, f.character);
            if (provEvt) funEventBuffer.push(provEvt);
            const sumProvEvt = parseSummonProvisions(line, f.character);
            if (sumProvEvt) funEventBuffer.push(sumProvEvt);
            const cursorEvt = parseCursorFull(line, f.character);
            if (cursorEvt) funEventBuffer.push(cursorEvt);
            const htEvt = parseHarmTouch(line, f.character);
            if (htEvt) funEventBuffer.push(htEvt);
            const lohEvt = parseLayOnHands(line, f.character);
            if (lohEvt) funEventBuffer.push(lohEvt);
            const pkEvt = parsePvpFlag(line, f.character);
            if (pkEvt) funEventBuffer.push(pkEvt);
            // Beastlord buff receives — recipient-side. The bot correlates
            // these to specific encounters at display time via ts range, so
            // the agent only needs to emit the bare event.
            const faEvt = parseFeralAvatarReceived(line, f.character);
            if (faEvt) funEventBuffer.push(faEvt);
            const savEvt = parseSavageryReceived(line, f.character);
            if (savEvt) funEventBuffer.push(savEvt);

            // PvP kill broadcasts — record to the ledger from history, but
            // flagged backfill so the bot won't re-post them to Discord.
            const pvpBcast = parsePvpBroadcast(line);
            if (pvpBcast) {
              pvpBatch.push({ ...pvpBcast, backfill: true });
              if (pvpBatch.length >= 200) flushPvp(true).catch(() => {});
            }

            // Chat comes first — chat lines don't survive shouldKeep().
            const chatMsg = parseChatLine(line, f.character);
            if (chatMsg) {
              chatBatch.push({ ...chatMsg, uploadedBy: f.character });
              status.chatCount++;
              if (chatBatch.length >= 500) flushChat(true).catch(() => {});
              return;
            }
            // Combat + /who: shouldKeep with defaults; parseEvent populates the
            // module-level whoData map as a side-effect for /who output rows.
            if (!shouldKeep(line)) return;
            const ts = parseEqTimestamp(line);
            const ev = parseEvent(line, ts);
            if (ev) builder.add(ev);
          },
          ({ bytePos, lineNum }) => {
            status.bytePos = bytePos;
            status.lineNum = lineNum;
            // Preserve completedAt / agentVersion / counts from a prior
            // completion when overwriting (e.g. mid-resume) — they're the
            // historical record of when this file was last fully processed.
            const prior = _optinState.progress[f.path] || {};
            _optinState.progress[f.path] = {
              ...prior,
              bytePos, lineNum, totalBytes,
              character: f.character,
              updatedAt: new Date().toISOString(),
            };
            _saveOptInState();
            onStatus(status);
          },
          () => _abortedBackfills.has(f.path),
          { queueLen: () => _uploadQueue.length, high: QUEUE_BACKPRESSURE_HIGH, low: QUEUE_BACKPRESSURE_LOW });
        builder.flush();
        await flushChat(true).catch(() => {});
        if (result?.aborted) {
          // Resume position preserved — clicking Backfill again picks up
          // where we left off via _optinState.progress[f.path].bytePos.
          status.state = 'paused';
          log(`  ⏸ Paused: ${f.character} (${status.chatCount} chat, ${status.encounterCount} encounters processed; click Backfill again to resume)`);
        } else {
          _optinState.progress[f.path] = {
            bytePos: totalBytes, lineNum: -1, totalBytes,
            character: f.character,
            updatedAt:    new Date().toISOString(),
            completedAt:  new Date().toISOString(),
            agentVersion: AGENT_VERSION,
            chatCount:    status.chatCount    || 0,
            encounterCount: status.encounterCount || 0,
            complete: true,
          };
          _saveOptInState();
          status.state = 'done';
          log(`  ✓ Done: ${f.character} v${AGENT_VERSION} (${status.chatCount} chat, ${status.encounterCount} encounters)`);
        }
      } catch (err) {
        status.state = 'error';
        status.error = err.message;
        log(`  ✗ ${f.character}: ${err.message}`);
      }
      _abortedBackfills.delete(f.path);
      _activeBackfills.delete(f.path);
      onStatus(status);
      scheduleRender();
    })();
  }
}

function _fmtFileSize(bytes) {
  if (!bytes || bytes < 1) return '0';
  if (bytes < 1024)     return bytes + 'B';
  if (bytes < 1048576)  return (bytes / 1024).toFixed(0) + 'KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + 'MB';
  return (bytes / 1073741824).toFixed(2) + 'GB';
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
    // Live-tailed files can be selected too — server-side dedup catches overlap.
    const sel  = f.selected ? `${C.green}[✓]${C.reset}` : `${C.dim}[ ]${C.reset}`;
    const cur  = i === cursor ? `${C.yellow}▶${C.reset}` : ' ';
    const alt  = f.isAlt ? ` ${C.dim}(alt)${C.reset}` : '';
    const live = f.isWatched ? ` ${C.green}● live${C.reset}` : '';
    const nameColor = f.requested ? C.blue : (f.isWatched ? C.green : (f.isAlt ? C.dim : C.reset));
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
             `${C.dim}${pad(fname, 32)}${C.reset} ${pad(_fmtFileSize(f.sizeBytes), 8)} ${pad(dateStr, 11)} ${resumeStr}${alt}${live}\n`);
  });
  return out.join('');
}

function showOptIn() {
  if (!_optinState.scanned) _scanOptInFiles();

  const out = [];
  out.push(`${C.clear}\n${C.bold}${C.cyan}  Historical Log Opt-in — ${_optinState.pane === 'active' ? 'Active' : 'Ignored'} (${_optinState.pane === 'active' ? _optinState.files.length : _optinState.ignored.length})${C.reset}   ${C.dim}sort: ${C.reset}${C.yellow}${_optinState.sortMode}${C.reset}\n`);
  out.push(`  ${C.dim}Chat-only backfill — no combat parses created from legacy logs. Files in ${C.blue}blue${C.reset}${C.dim} are requested by the bot.${C.reset}\n\n`);

  const list = _optinState.pane === 'active' ? _optinState.files : _optinState.ignored;
  out.push(_renderOptinList(list, _optinState.pane, _optinState.cursor, _optinState.pane === 'active'));

  const selCount = list.filter(f => f.selected).length;
  out.push('\n');
  if (_optinState.pane === 'active') {
    out.push(`  ${C.cyan}[↑/↓]${C.reset} Navigate  ${C.cyan}[Space]${C.reset} Toggle  ${C.cyan}[A]${C.reset} Select all  ${C.cyan}[X]${C.reset} Ignore highlighted  `);
    out.push(`${selCount > 0 ? `${C.bold}${C.green}[G]${C.reset} Go — backfill (${selCount})` : `${C.dim}[G] Go — backfill${C.reset}`}  `);
    out.push(`${C.cyan}[S]${C.reset} Sort (${_optinState.sortMode})  ${C.cyan}[V]${C.reset} View ignored (${_optinState.ignored.length})  ${C.cyan}[D]${C.reset} Back\n`);
  } else {
    out.push(`  ${C.cyan}[↑/↓]${C.reset} Navigate  ${C.cyan}[Space]${C.reset} Toggle  ${C.cyan}[R]${C.reset} Restore selected  ${C.cyan}[S]${C.reset} Sort (${_optinState.sortMode})  ${C.cyan}[V]${C.reset} Back to active  ${C.cyan}[D]${C.reset} Back\n`);
  }

  process.stdout.write(out.join(''));

  // Install opt-in specific keypress handler
  if (!_optinKeyHandler && process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    _optinKeyHandler = (data) => {
      // Teardown guard. Some terminals deliver a single keystroke as
      // multiple data events (a few bytes apart); after the first one
      // tears down the listener, subsequent ones land here with a null
      // handler reference, and process.removeListener(null) throws
      // ERR_INVALID_ARG_TYPE — blowing the whole agent up. Drop on the
      // floor instead.
      if (_optinKeyHandler === null) return;
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
      if (key === 's' || key === 'S') {
        // Cycle the sort mode: date → size → alpha → date
        const modes = ['date', 'size', 'alpha'];
        const idx   = modes.indexOf(_optinState.sortMode);
        _optinState.sortMode = modes[(idx + 1) % modes.length];
        _resortOptIn();
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
      // [G] Go — start backfill on selected files. (Was [B] before v2.4.26
      // but collided with the global [B] Background-service key, which
      // would detach + kill the foreground session before backfill could
      // start. [G] is unused both globally and on the opt-in tab.)
      if (key === 'g' || key === 'G') {
        // Only start backfill from the active pane
        if (_optinState.pane !== 'active') { showOptIn(); return; }
        const chosen = _optinState.files.filter(f => f.selected);
        if (chosen.length === 0) return;

        if (_optinKeyHandler) process.removeListener('data', _optinKeyHandler);
        _optinKeyHandler = null;
        _optinState.scanned = false;
        _exitView();

        runOptinBackfill(chosen, {
          log: (msg) => process.stdout.write(`  ${C.dim}${msg}${C.reset}\n`),
        });
        process.stdout.write(`  ${C.dim}(Combat events SKIPPED — chat only. Resume saved every ~256KB.)${C.reset}\n`);
        return;
      }
      if (key === 'd' || key === 'D' || key === '\x03') {
        if (_optinKeyHandler) process.removeListener('data', _optinKeyHandler);
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

  // ── 🥋 Monk Mending — only shown if the uploader attempted at least one mend
  const m = stats.sessionMends || {};
  if (m.attempts > 0) {
    const critPct  = m.success > 0 ? Math.round(m.crit / m.success * 100) : 0;
    const failPct  = Math.round(m.fail / m.attempts * 100);
    out.push(`\n${C.bold}${C.yellow}  🥋 Monk Mending (this session)${C.reset}\n`);
    out.push(`  ${pad('Attempts', 14)} ${C.bold}${m.attempts}${C.reset}\n`);
    out.push(`  ${pad('Successful', 14)} ${C.bold}${m.success}${C.reset} ${C.dim}(${m.attempts - m.fail - m.success === 0 ? '' : ''}${Math.round(m.success / m.attempts * 100)}%)${C.reset}\n`);
    out.push(`  ${pad('Critical', 14)} ${C.bold}${C.green}${m.crit}${C.reset} ${C.dim}(${critPct}% of successful)${C.reset}\n`);
    out.push(`  ${pad('Failed', 14)} ${C.bold}${C.red}${m.fail}${C.reset} ${C.dim}(${failPct}% of attempts)${C.reset}\n`);
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
// All uploads route through enqueueUpload() so a DNS / network / 5xx failure
// doesn't drop data. The queue persists to logsync.queue.json and retries on
// exponential backoff via the drain loop started in main().
function uploadEncounter(payload, { botUrl, token, dryRun }) {
  const isBackfill = payload?.backfill === true;
  // Honor the owner's exclude_from_stats setting for the parser character.
  // Logged once per character per restart so the owner can see it's in effect
  // without spamming the dashboard.
  if (!shouldUploadForCharacter(payload?.character)) {
    if (!stats._optOutLoggedFor) stats._optOutLoggedFor = new Set();
    if (!stats._optOutLoggedFor.has(payload.character)) {
      stats._optOutLoggedFor.add(payload.character);
      console.log(`[prefs] skipping encounter upload for ${payload.character} — exclude_from_stats set on wolfpack.quest /me`);
    }
    return Promise.resolve();
  }
  if (dryRun) {
    const e = payload.encounter;
    console.log(`[dry-run] ${e.boss_name || '?'} · ${e.events.length} events · ${e.started_at} → ${e.ended_at}`);
    if (!isBackfill) recordUploadForDashboard(payload, payload.character);
    scheduleRender();
    return Promise.resolve();
  }
  enqueueUpload('encounter', payload);
  return Promise.resolve();
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
// Two phrasing styles must be covered or we silently lose kills:
//   * Victim-first ("X of <G1> has been killed in combat by Y of <G2> ...")
//   * Killer-first ("X of <G1> has killed Y of <G2> ...") — also how PvP-server
//     BOSS deaths are announced ("X of <G> has killed Boss in Zone!"). The
//     parser missed killer-first phrasing entirely before 2.4.32, so /pvp only
//     showed members whose victims were members of guilds that died in
//     victim-first form. Diagnosis from real-user report 2026-05-30.
const PVP_BROADCAST_RX           = /^\[(.+?)\]\s+PVP Druzzil Ro BROADCASTS,\s*['"](.+?)['"]\s*$/;
const PVP_PLAYER_KILL_RX         = /^(\w+) of <(.+?)> has been killed in combat by (\w+) of <(.+?)> in (.+?)!$/;
const PVP_NPC_KILL_RX            = /^(\w+) of <(.+?)> has died to (.+?) in combat in (.+?)!$/;
const PVP_PLAYER_KILL_ACTIVE_RX  = /^(\w+) of <(.+?)> has killed (\w+) of <(.+?)> in (.+?)!$/;
// Boss kill on PvP server — no victim guild. Zone clause is optional ("...has
// killed Lord Nagafen!" vs "...has killed Lord Nagafen in Nagafen's Lair!").
// Try the player-active matcher FIRST: this one's the broader superset.
const PVP_BOSS_KILL_ACTIVE_RX    = /^(\w+) of <(.+?)> has killed (.+?)(?: in (.+?))?!$/;

// "Bare" PvP kill — same kill body as the four above but landing in the log
// without a "PVP Druzzil Ro BROADCASTS," wrapper. Observed when the kill
// message comes through the player's in-game [PVP] channel directly.
const PVP_BARE_PLAYER_RX         = /^\[(.+?)\]\s+(?:\[PVP\]\s+)?(\w+) of <(.+?)> has been killed in combat by (\w+) of <(.+?)> in (.+?)!$/;
const PVP_BARE_NPC_RX            = /^\[(.+?)\]\s+(?:\[PVP\]\s+)?(\w+) of <(.+?)> has died to (.+?) in combat in (.+?)!$/;
const PVP_BARE_PLAYER_ACTIVE_RX  = /^\[(.+?)\]\s+(?:\[PVP\]\s+)?(\w+) of <(.+?)> has killed (\w+) of <(.+?)> in (.+?)!$/;
const PVP_BARE_BOSS_ACTIVE_RX    = /^\[(.+?)\]\s+(?:\[PVP\]\s+)?(\w+) of <(.+?)> has killed (.+?)(?: in (.+?))?!$/;

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
  const tsOf = () => {
    const ts = parseEqTimestamp(line);
    return ts ? ts.toISOString() : new Date().toISOString();
  };

  // Path A: god-broadcast wrapper — "PVP Druzzil Ro BROADCASTS, '...'"
  const m = PVP_BROADCAST_RX.exec(line);
  if (m) {
    const text = m[2];

    // Victim-first player kill: "X has been killed in combat by Y"
    const ppk = PVP_PLAYER_KILL_RX.exec(text);
    if (ppk) return {
      ts: tsOf(), text, killType: 'pvp',
      victim: ppk[1], victimGuild: ppk[2],
      killer: ppk[3], killerGuild: ppk[4],
      zone:   ppk[5],
    };

    // Killer-first player kill: "X has killed Y" (added 2.4.32)
    const ppkA = PVP_PLAYER_KILL_ACTIVE_RX.exec(text);
    if (ppkA) return {
      ts: tsOf(), text, killType: 'pvp',
      killer: ppkA[1], killerGuild: ppkA[2],
      victim: ppkA[3], victimGuild: ppkA[4],
      zone:   ppkA[5],
    };

    // Victim-first NPC death: "X has died to Mob"
    const npck = PVP_NPC_KILL_RX.exec(text);
    if (npck) return {
      ts: tsOf(), text, killType: 'npc',
      victim: npck[1], victimGuild: npck[2],
      killer: null,    killerGuild: null,
      zone:   npck[4],
    };

    // Killer-first boss kill: "X has killed Boss [in Zone]!" — no victim guild.
    // Try LAST because this is the broadest "has killed" superset; the player-
    // active matcher above must win when both could match. Recorded as PvP so
    // the kill credits to the Wolf Pack killer on /pvp/server.
    const bossA = PVP_BOSS_KILL_ACTIVE_RX.exec(text);
    if (bossA) return {
      ts: tsOf(), text, killType: 'pvp',
      killer: bossA[1], killerGuild: bossA[2],
      victim: bossA[3], victimGuild: null,
      zone:   bossA[4] || null,
    };

    // Wrapper matched but no inner pattern fit. Return null instead of a
    // partially-filled row (the pre-2.4.32 fallthrough emitted killType='npc'
    // with everything null, which the bot silently dropped but logs still
    // ballooned around).
    return null;
  }

  // Path B: bare kill body in the in-game [PVP] channel — no Druzzil prefix.
  // Order mirrors Path A: most-specific first, broadest active-voice last.
  const ppkBare = PVP_BARE_PLAYER_RX.exec(line);
  if (ppkBare) return {
    ts: tsOf(),
    text: `${ppkBare[2]} of <${ppkBare[3]}> has been killed in combat by ${ppkBare[4]} of <${ppkBare[5]}> in ${ppkBare[6]}!`,
    killType:    'pvp',
    victim:      ppkBare[2], victimGuild: ppkBare[3],
    killer:      ppkBare[4], killerGuild: ppkBare[5],
    zone:        ppkBare[6],
  };

  const ppkBareA = PVP_BARE_PLAYER_ACTIVE_RX.exec(line);
  if (ppkBareA) return {
    ts: tsOf(),
    text: `${ppkBareA[2]} of <${ppkBareA[3]}> has killed ${ppkBareA[4]} of <${ppkBareA[5]}> in ${ppkBareA[6]}!`,
    killType:    'pvp',
    killer:      ppkBareA[2], killerGuild: ppkBareA[3],
    victim:      ppkBareA[4], victimGuild: ppkBareA[5],
    zone:        ppkBareA[6],
  };

  const npcBare = PVP_BARE_NPC_RX.exec(line);
  if (npcBare) return {
    ts: tsOf(),
    text: `${npcBare[2]} of <${npcBare[3]}> has died to ${npcBare[4]} in combat in ${npcBare[5]}!`,
    killType:    'npc',
    victim:      npcBare[2], victimGuild: npcBare[3],
    killer:      null,       killerGuild: null,
    zone:        npcBare[5],
  };

  const bossBareA = PVP_BARE_BOSS_ACTIVE_RX.exec(line);
  if (bossBareA) return {
    ts: tsOf(),
    text: `${bossBareA[2]} of <${bossBareA[3]}> has killed ${bossBareA[4]}${bossBareA[5] ? ` in ${bossBareA[5]}` : ''}!`,
    killType:    'pvp',
    killer:      bossBareA[2], killerGuild: bossBareA[3],
    victim:      bossBareA[4], victimGuild: null,
    zone:        bossBareA[5] || null,
  };

  return null;
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

// /tell capture — opt-in via characters.tell_relay (default off). The byte-
// level filter (in shouldKeep) normally DROPS tells before they reach the
// combat parser, so this function runs at the per-line callback site BEFORE
// the filter. Output shape matches the POST /api/agent/tells body.
//
//   Incoming:  "[ts] Player tells you, 'message text'"
//   Outgoing:  "[ts] You told Player, 'message text'"
//
// dedup_key is a stable hash so an agent restart / log re-read can't double-
// store. Falls back to a synthetic key when ts/text are weird.
const TELL_INCOMING_RX = /^\[(?<ts>[^\]]+)\]\s+(?<other>[A-Za-z][A-Za-z' ]+?)\s+tells you,\s*['"](?<text>.+?)['"]\s*$/;
const TELL_OUTGOING_RX = /^\[(?<ts>[^\]]+)\]\s+You told\s+(?<other>[A-Za-z][A-Za-z' ]+?),\s*['"](?<text>.+?)['"]\s*$/;

function parseTellLine(line, selfName) {
  let m = line.match(TELL_OUTGOING_RX);
  let direction = null;
  if (m) direction = 'outgoing';
  else { m = line.match(TELL_INCOMING_RX); if (m) direction = 'incoming'; }
  if (!m || !direction) return null;
  const tsParsed = parseEqTimestamp(line);
  const tsIso    = tsParsed ? tsParsed.toISOString() : new Date().toISOString();
  const other    = m.groups.other.trim();
  // Filter NPC chatter that uses the same "X tells you," pattern — pets and
  // mobs spam it constantly. Heuristic: NPC names usually contain spaces or
  // start with lowercase (e.g. "a kobold runner"). Player names are typically
  // single Capitalized words. False positives on this filter are acceptable
  // (an NPC tell that slips through is harmless); false NEGATIVES are not
  // (a real tell that we miss).
  if (direction === 'incoming') {
    if (/\s/.test(other)) return null;
    if (!/^[A-Z]/.test(other)) return null;
  }
  const text = transformEqItemLinks(m.groups.text);
  // Stable dedup: sha1 over the tuple. ts in here so two identical messages
  // sent later get fresh rows (which is correct — they ARE separate tells).
  const key = crypto.createHash('sha1')
    .update([selfName, direction, other, tsIso, text].join(''))
    .digest('hex')
    .slice(0, 32);
  return {
    direction,
    other,
    text,
    ts:        tsIso,
    raw_text:  line.slice(0, 500),
    dedup_key: key,
  };
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
const funEventBuffer    = [];   // pending fun-events (Peopleslayer LD, future CoH/DI/etc)
const tellBuffer        = [];   // pending /tell relay (opt-in via characters.tell_relay)

// ── Cross-log broadcast dedup ────────────────────────────────────────────────
// One Mimic install tails MULTIPLE log files for the same person (main +
// alts). Server-wide / guild-wide broadcasts (guild chat, raid chat, PvP
// kills, Druzzil Ro boss kills) land in EVERY one of that person's logs that
// received them — once as a self-form line, once as a bystander-form line —
// so without deduping here the bot receives the same logical message several
// times and posts it twice (e.g. "Wabumkin: no :(" + "Adiwen: no :(", or a
// PvP kill posted twice). We collapse them at the source: a normalized
// fingerprint seen within 90s is dropped before it reaches the upload buffer.
// Safe because within ONE install it's one physical person — the same guild
// line across their main + alt logs is one message, not two.
const _crossLogSeen = new Map(); // fingerprint → expiry ms
const CROSSLOG_TTL_MS = 90_000;
function _crossLogDupe(fp) {
  if (!fp) return false;
  const now = Date.now();
  // Opportunistic prune
  if (_crossLogSeen.size > 500) {
    for (const [k, exp] of _crossLogSeen) if (exp < now) _crossLogSeen.delete(k);
  }
  const exp = _crossLogSeen.get(fp);
  if (exp && exp > now) return true;
  _crossLogSeen.set(fp, now + CROSSLOG_TTL_MS);
  return false;
}
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
    if (funEventBuffer.length > 0)
      uploadFunEvents(funEventBuffer.splice(0), _uploadOpts).catch(() => {});
    // Tell relay drains per-character — the endpoint requires one character
    // per request (it gates on characters.tell_relay before storing).
    if (tellBuffer.length > 0) {
      // Group pending tells by character so a single agent watching multiple
      // logs uploads them separately. Most agents only watch one at a time.
      const byChar = new Map();
      for (const t of tellBuffer.splice(0)) {
        const arr = byChar.get(t.character) || [];
        arr.push(t);
        byChar.set(t.character, arr);
      }
      for (const [character, tells] of byChar) {
        uploadTells({ character, tells }, _uploadOpts).catch(() => {});
      }
    }
  }, 5000);
}

// ── Fun-event detection ─────────────────────────────────────────────────────
// Lightweight, pattern-driven side stream that piggybacks on the live tail.
// First tenant: Peopleslayer LD counter. Future tenants: CoH pearl, DI
// emerald, Aegolism/Rune peridot, MGB doubling. Each detector returns
// { type, caster, ts, raw_text } or null; matches push into funEventBuffer
// and ride out via the 5s chat-relay flush.
//
// Linkdead line on Quarm: "[ts] <Name> has gone linkdead." Accept both
// LD and linkdead phrasing for safety.
const PEOPLESLAYER_LD_RX = /^\[(.+?)\]\s+Peopleslayer\s+has\s+gone\s+(?:LD|linkdead)\.?\s*$/i;

function parsePeopleslayerLd(line) {
  const m = PEOPLESLAYER_LD_RX.exec(line);
  if (!m) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:     'peopleslayer_ld',
    caster:   'Peopleslayer',
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

// ── Malthur provisions — TWO complementary detectors ────────────────────────
//
// Both ship because they cross-validate each other and capture different
// vantage points: caster-side is ground truth (one event per cast) but only
// Malthur's own agent reports it; recipient-side is approximate (one event
// per recipient-fed) but every member's agent reports.
//
// Caster-side (parseSummonProvisions, v2.4.29): "You begin casting Blessing
// of the Harvest" → summon_food. "You begin casting Blessing of the Storm"
// → summon_water. Each successful cast yields one 10-charge stack.
//
// Recipient-side (parseMalthurProvision, v2.4.30): "Your hunger/thirst is
// sedated by..." → malthur_food_received / malthur_water_received. caster =
// the RECIPIENT (their own character) since the line names no actual caster.
//
// Regex wording context: eqemu_spells is empty in our mirror, and the EQEmu
// schema doesn't store cast strings anyway (cast_on_you/cast_on_other live in
// the client's spells_us.txt). So the recipient-side wording can't be DB-
// verified — accept either "blessing of the harvest/storm" or bare "harvest/
// storm" as a hedge until a real log sample tightens it. The "hunger/thirst …
// sedated by" anchor bounds the false-positive surface.
const SUMMON_FOOD_RX   = /^\[.+?\]\s+You begin casting Blessing of the Harvest\.?\s*$/i;
const SUMMON_WATER_RX  = /^\[.+?\]\s+You begin casting Blessing of the Storm\.?\s*$/i;
const MALTHUR_FOOD_RX  = /\byour hunger (?:is|has been) sedated by\b.*\b(?:blessing of the )?harvest\b/i;
const MALTHUR_WATER_RX = /\byour thirst (?:is|has been) (?:sedated|quenched) by\b.*\b(?:blessing of the )?storm\b/i;
// Cursor cap — EQ stops handing summoned items to the cursor at ~10 pending.
const CURSOR_FULL_RX   = /\b(?:your cursor is full|cursor queue full)\b/i;

function parseSummonProvisions(line, character) {
  let type = null;
  if (SUMMON_FOOD_RX.test(line))       type = 'summon_food';
  else if (SUMMON_WATER_RX.test(line)) type = 'summon_water';
  if (!type) return null;
  const ts = parseEqTimestamp(line);
  return {
    type,
    caster:   character || null,
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

function parseMalthurProvision(line, character) {
  let type = null;
  if (MALTHUR_FOOD_RX.test(line))       type = 'malthur_food_received';
  else if (MALTHUR_WATER_RX.test(line)) type = 'malthur_water_received';
  if (!type) return null;
  const ts = parseEqTimestamp(line);
  return {
    type,
    caster:   character || null,   // the recipient — see banner above
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

function parseCursorFull(line, character) {
  if (!CURSOR_FULL_RX.test(line)) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:     'provisions_cursor_full',
    caster:   character || null,
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

// ── Class signature abilities (caster-side) ──────────────────────────────────
// Shadow Knight Harm Touch damage total + Paladin Lay on Hands count/heal.
// Both are self-cast "You ..." lines, so only the caster's own agent logs them
// — same single-perspective limitation as spell names, which is fine (each SK/
// paladin reports their own). caster = the agent's character.
//
// reagent_qty carries the amount: HT damage, or the LoH heal when the line
// shows it. The bot's fun_event handler already passes reagent_qty through.
//
// ⚠️ WORDING FLAGGED FOR REVIEW: these regexes are best-effort against standard
// EQ phrasing; confirm against real Quarm logs and tighten if a variant is
// missed. HT also typically lands in encounter_combat_rollup.by_skill (it's a
// damage event), so the rollup is a cross-check on these fun-event totals.
//
// ⚠️ LoH "heal total based on max it can do": Lay on Hands heals for the
// paladin's MAX HP. The log line may not include the number, so when it doesn't
// we record the COUNT (reagent_qty=0) and the display layer multiplies count ×
// that paladin's max HP (from /who or char data) to get the heal total. When the
// line DOES carry a heal number we record it directly.
const HARM_TOUCH_RX = /\b(?:you|your)\s+harm[\s-]?touch(?:es|ed)?\b[^\d]*?(\d+)\s+points?\s+of\s+damage/i;
const LAY_ON_HANDS_RX = /\byou\s+lay\s+(?:your\s+)?hands?\s+on\b/i;
// Optional heal amount on the LoH line / its companion heal message.
const LOH_HEAL_RX = /\b(?:lay|laid)\s+hands?\b[^\d]*?(\d+)\s+points?/i;

function parseHarmTouch(line, character) {
  const m = HARM_TOUCH_RX.exec(line);
  if (!m) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:        'harm_touch',
    caster:      character || null,
    reagent_qty: parseInt(m[1], 10) || 0,   // HT damage dealt
    ts:          ts ? ts.toISOString() : new Date().toISOString(),
    raw_text:    line.slice(0, 200),
  };
}

function parseLayOnHands(line, character) {
  if (!LAY_ON_HANDS_RX.test(line)) return null;
  const heal = LOH_HEAL_RX.exec(line);
  const ts = parseEqTimestamp(line);
  return {
    type:        'lay_on_hands',
    caster:      character || null,
    reagent_qty: heal ? (parseInt(heal[1], 10) || 0) : 0,   // 0 → count only; display × max HP
    ts:          ts ? ts.toISOString() : new Date().toISOString(),
    raw_text:    line.slice(0, 200),
  };
}

// ── Beastlord buff receive counters (Feral Avatar + Savagery) ──────────────
// Per-fight tally of how many times a player had Feral Avatar or Savagery
// landed on them. Recipient-perspective is the broad-reach side (every
// member's agent reports their own receives); we don't bother with caster-
// perspective since there are typically only 1-2 BLs in a raid.
//
// ⚠️ WORDING FLAGGED FOR REVIEW: these regexes are best-effort against
// standard EQ phrasing. Verify against real Quarm logs and tighten on
// false-positives. The caster line is also accepted as a fallback so
// the BL's own log reports their casts even if their target was outside
// our roster.
//
// Quarm-confirmed phrasings expected:
//   Feral Avatar (BL/SHM, Velious-era):
//     receive: "Your form expands as you become a feral avatar."
//     receive (alt): "You feel the spirit of the wolf course through your body."
//   Savagery (BL):
//     receive: "Your blood boils with savagery."
//     receive (alt): "Savagery courses through you."
const FERAL_AVATAR_RECV_RX = /\b(?:Your form expands as you become a feral avatar|You feel the spirit of the wolf course through your body)\b/i;
const SAVAGERY_RECV_RX     = /\b(?:Your blood boils with savagery|Savagery courses through you)\b/i;

function parseFeralAvatarReceived(line, character) {
  if (!FERAL_AVATAR_RECV_RX.test(line)) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:     'feral_avatar_received',
    caster:   character || null,   // recipient — see banner above
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

function parseSavageryReceived(line, character) {
  if (!SAVAGERY_RECV_RX.test(line)) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:     'savagery_received',
    caster:   character || null,
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

// ── PvP flag toggle (Quarm / Discord-Order alignment) ────────────────────────
// EQ Quarm uses the "ways of Discord/Order" alignment + a separate "player
// kill" flag. Exact lines (from user 2026-05-30):
//
//   "You are now player kill and follow the ways of Discord."   ← PK flag ON
//   "You are now player kill."                                  ← PK flag ON (alt)
//   "You now follow the ways of Order."                         ← peaceful state
//   "You now follow the ways of Discord."                       ← still PK?
//   "You no longer follow the ways of discord."                 ← leaving Discord
//
// Treat 'You are now player kill' (in any phrasing) as PK ON. Treat 'You now
// follow the ways of Order' as PK OFF (Order is peaceful by definition).
// Bare 'You now follow the ways of Discord' without 'player kill' is treated
// as alignment-only (no PK flag change) and produces no event.
const PVP_FLAG_ON_RX  = /^\[(.+?)\]\s+You are now player kill\b/i;
const PVP_FLAG_OFF_RX = /^\[(.+?)\]\s+You now follow the ways of Order\b/i;

function parsePvpFlag(line, character) {
  if (PVP_FLAG_ON_RX.test(line)) {
    const ts = parseEqTimestamp(line);
    return {
      type:     'pvp_flag_on',
      caster:   character || null,
      ts:       ts ? ts.toISOString() : new Date().toISOString(),
      raw_text: line.slice(0, 200),
    };
  }
  if (PVP_FLAG_OFF_RX.test(line)) {
    const ts = parseEqTimestamp(line);
    return {
      type:     'pvp_flag_off',
      caster:   character || null,
      ts:       ts ? ts.toISOString() : new Date().toISOString(),
      raw_text: line.slice(0, 200),
    };
  }
  return null;
}

function uploadChat(messages, { botUrl, token, dryRun }) {
  void botUrl; void token; // route info lives in the queue's endpoint resolver
  if (dryRun) {
    for (const m of messages) {
      console.log(`[chat:${m.channel}] <${m.speaker}> ${m.text}`);
    }
    return Promise.resolve();
  }
  enqueueUpload('chat', { agent_version: AGENT_VERSION, messages });
  return Promise.resolve();
}

function uploadPvp(broadcasts, { botUrl, token, dryRun }) {
  void botUrl; void token;
  if (dryRun) {
    for (const b of broadcasts)
      console.log(`[pvp] ${b.killType === 'pvp' ? '⚔️' : '☠️'} ${b.text}`);
    return Promise.resolve();
  }
  enqueueUpload('pvp', { agent_version: AGENT_VERSION, broadcasts });
  return Promise.resolve();
}

function uploadDruzzilKills(kills, { botUrl, token, dryRun }) {
  void botUrl; void token;
  if (dryRun) {
    for (const k of kills)
      console.log(`[raid-kill] ${k.character} of <${k.guild}> killed ${k.boss} in ${k.zone}`);
    return Promise.resolve();
  }
  enqueueUpload('bosskill', { agent_version: AGENT_VERSION, kills });
  return Promise.resolve();
}

// Polls the bot for the latest agent version without needing an encounter
// upload to surface the info. Called every ~10 min from main(). Idle agents
// (raid not currently running) still learn about new releases promptly.
function pollLatestVersion({ botUrl }) {
  if (!botUrl) return;
  const url = botUrl.replace(/\/encounter(\?.*)?$/, '/latest-version');
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        method: 'GET',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname + u.search,
        headers:  { 'User-Agent': `wolfpack-logsync/${AGENT_VERSION}` },
        timeout:  5000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const resp = JSON.parse(data);
            if (resp.latest_agent_version) {
              stats.latestAgentVersion     = resp.latest_agent_version;
              stats.latestVersionCheckedAt = Date.now();
              // Only flag when the server's version is strictly newer than ours.
              stats.updateAvailable = isNewerVersion(resp.latest_agent_version, AGENT_VERSION);
              scheduleRender();
            }
            resolve();
          } catch { resolve(); }
        });
      });
      req.on('error',   () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    } catch { resolve(); }
  });
}

// Poll the bot for officer-filed backfill requests targeting any character
// this agent is watching. Server returns pending|acked|running rows. We
// store them on stats.backfillRequests so the dashboard can render an
// "Officer requested backfill" banner with Accept / Dismiss buttons.
function pollBackfillRequests({ botUrl, token }) {
  if (!botUrl || !token) return Promise.resolve();
  const chars = (stats.watchedLogs || [])
    .map(w => w && w.character)
    .filter(Boolean);
  if (chars.length === 0) return Promise.resolve();

  // /encounter → /backfill-requests, plus the character filter
  const url = botUrl.replace(/\/encounter(\?.*)?$/, '/backfill-requests')
            + '?character=' + encodeURIComponent(chars.join(','));

  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        method:  'GET',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname + u.search,
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent':    `wolfpack-logsync/${AGENT_VERSION}`,
        },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const resp = JSON.parse(data);
            if (Array.isArray(resp.requests)) {
              stats.backfillRequests          = resp.requests;
              stats.backfillRequestsCheckedAt = Date.now();
              scheduleRender();
            }
          } catch { /* non-fatal */ }
          resolve();
        });
      });
      req.on('error',   () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    } catch { resolve(); }
  });
}

// Poll the bot for per-character data-handling preferences. The owner sets
// these on wolfpack.quest /me (exclude_from_stats, exclude_inventory). The
// agent caches them on stats.characterPrefs (lowercased key) and uses
// shouldUploadForCharacter() at every outbound upload site so a flagged
// character generates zero traffic from this machine without restart.
//
// Default (no entry, request failed, etc.): participate as today. Privacy
// only ratchets one way — we don't accidentally start uploading because a
// poll fell through.
function pollCharacterPrefs({ botUrl, token }) {
  if (!botUrl || !token) return Promise.resolve();
  const chars = (stats.watchedLogs || []).map(w => w && w.character).filter(Boolean);
  if (chars.length === 0) return Promise.resolve();

  const url = botUrl.replace(/\/encounter(\?.*)?$/, '/character-prefs')
            + '?characters=' + encodeURIComponent(chars.join(','));

  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        method:   'GET',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname + u.search,
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent':    `wolfpack-logsync/${AGENT_VERSION}`,
        },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const resp = JSON.parse(data);
            const prefs = (resp && resp.prefs) || {};
            const norm = {};
            for (const [name, p] of Object.entries(prefs)) {
              norm[String(name).toLowerCase()] = {
                exclude_from_stats: !!(p && p.exclude_from_stats),
                exclude_inventory:  !!(p && p.exclude_inventory),
              };
            }
            stats.characterPrefs          = norm;
            stats.characterPrefsCheckedAt = Date.now();
            scheduleRender();
          } catch { /* non-fatal — keep previous prefs */ }
          resolve();
        });
      });
      req.on('error',   () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    } catch { resolve(); }
  });
}

// Returns true when uploads for this character should proceed. False when the
// owner has set exclude_from_stats. Always true when no pref data yet (initial
// poll pending), so we don't accidentally drop anything during startup.
function shouldUploadForCharacter(character) {
  if (!character) return true;
  const p = stats.characterPrefs && stats.characterPrefs[String(character).toLowerCase()];
  return !p || !p.exclude_from_stats;
}

// Poll the bot for officer-tuned guild triggers. We refresh stats.guildTriggers
// every ~10 min and merge with personal triggers loaded from disk in
// evaluateTriggersAgainstLine. Each trigger is precompiled to a RegExp at
// fetch time so the per-line eval is just an exec call.
// EQLogParser emits .NET regex syntax — some constructs aren't valid in JS.
// Common ones we see in the guild library:
//   (?>...)   atomic group — fallback: (?:...) (non-capturing). The
//             backtracking semantics differ but for EQ log lines (no
//             ambiguous nested patterns) it matches identically.
//   {s} {S} {S2} {c}    EQLogParser placeholder variables. We don't have a
//             {s}-equivalent at the agent yet, so swap to a permissive
//             capture so the trigger still fires (the regex won't fail to
//             compile). The capture name {s} is reserved by us.
// Anything else we leave alone — JS regex supports named captures, lookbehind,
// lookahead, Unicode property escapes, etc.
function _translateDotNetRegex(pattern) {
  let p = String(pattern || '');
  // (?>...) → (?:...)
  p = p.replace(/\(\?>/g, '(?:');
  // {s} / {S} / {S2} / {c} → permissive captures. {c} is the agent's own
  // character (substituted at match time later, ideally) but as a stop-gap
  // we use a non-greedy word match so the trigger compiles & fires.
  p = p.replace(/\{[sScC]\d*\}/g, '(?:[^\\s]+)');
  return p;
}

// For literal (non-regex) EQLP triggers, escape regex metacharacters so
// the source string matches itself when fed to RegExp.
function _escapeForLiteralMatch(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pollGuildTriggers({ botUrl, token }) {
  if (!botUrl || !token) return Promise.resolve();
  // Pass our characters so server-side targeting can pre-filter
  const chars = (stats.watchedLogs || []).map(w => w && w.character).filter(Boolean);
  const classes = [];
  for (const c of chars) {
    const cls = stats.characterClasses && stats.characterClasses[c.toLowerCase()];
    if (cls) classes.push(cls);
  }
  const url = botUrl.replace(/\/encounter(\?.*)?$/, '/guild-triggers')
            + (classes.length ? `?classes=${encodeURIComponent(classes.join(','))}` : '');

  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        method:  'GET',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname + u.search,
        headers: {
          'Authorization': 'Bearer ' + token,
          'User-Agent':    `wolfpack-logsync/${AGENT_VERSION}`,
        },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const resp = JSON.parse(data);
            if (Array.isArray(resp.triggers)) {
              // Compile once; eval per-line is hot path.
              const compiled = [];
              for (const t of resp.triggers) {
                try {
                  const flags = t.pattern_flags || 'i';
                  const pat = t.use_regex === false
                    ? _escapeForLiteralMatch(t.pattern)
                    : _translateDotNetRegex(t.pattern);
                  compiled.push({ ...t, _regex: new RegExp(pat, flags), _scope: 'guild' });
                } catch (err) {
                  console.warn(`[guild-triggers] bad pattern "${t.name}":`, err.message);
                }
              }
              stats.guildTriggers          = compiled;
              stats.guildTriggersVersion   = resp.version || '';
              stats.guildTriggersCheckedAt = Date.now();
            }
          } catch { /* non-fatal */ }
          resolve();
        });
      });
      req.on('error',   () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    } catch { resolve(); }
  });
}

// Personal triggers — loaded once on startup from <state-dir>/personal_triggers.json.
// Same schema as guild triggers but only this user sees them. Format:
//   [
//     { "name": "Clarity dropping",
//       "pattern": "Your Clarity (II)? spell has worn off.",
//       "actions": [{ "type":"text_overlay", "text":"NEED CLARITY", "color":"yellow", "duration_ms": 4000 }] }
//   ]
let _personalTriggers = [];
function loadPersonalTriggers() {
  try {
    const dir = path.dirname(_statsPath || '');
    if (!dir) return;
    const p = path.join(dir, 'personal_triggers.json');
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.triggers) ? raw.triggers : []);
    const compiled = [];
    for (const t of arr) {
      try {
        const flags = t.pattern_flags || 'i';
        const pat = t.use_regex === false
          ? _escapeForLiteralMatch(t.pattern)
          : _translateDotNetRegex(t.pattern);
        compiled.push({ ...t, _regex: new RegExp(pat, flags), _scope: 'personal' });
      } catch (err) {
        console.warn(`[personal-triggers] bad pattern "${t.name}":`, err.message);
      }
    }
    _personalTriggers = compiled;
    console.log(`[personal-triggers] loaded ${compiled.length} from ${p}`);
  } catch (err) {
    console.warn('[personal-triggers] load failed:', err.message);
  }
}

// Per-trigger last-fire timestamp for cooldown enforcement
const _triggerLastFire = new Map();
// Recent overlay queue — surfaced on /api/state for the dashboard to render.
// Cap at 20 so a runaway trigger can't OOM us.
const _activeOverlays = [];
function _pushOverlay(o) {
  _activeOverlays.unshift(o);
  if (_activeOverlays.length > 20) _activeOverlays.length = 20;
}

function _expandTemplate(template, captures) {
  if (!template) return '';
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    if (captures && captures[k] != null) return String(captures[k]);
    return `{${k}}`;
  });
}

// Hot-path: called for every kept log line in the tail loop.
function evaluateTriggersAgainstLine(line, tsMs) {
  const all = [..._personalTriggers, ...(stats.guildTriggers || [])];
  if (all.length === 0) return;
  for (const t of all) {
    if (!t._regex) continue;
    let m;
    try { m = t._regex.exec(line); } catch { continue; }
    if (!m) continue;
    // Cooldown gate
    if (t.cooldown_seconds && t.cooldown_seconds > 0) {
      const last = _triggerLastFire.get(t.id || t.name) || 0;
      if (tsMs - last < t.cooldown_seconds * 1000) continue;
    }
    _triggerLastFire.set(t.id || t.name, tsMs);
    const captures = m.groups || {};
    for (const a of (t.actions || [])) {
      if (!a || !a.type) continue;
      if (a.type === 'text_overlay') {
        const text = _expandTemplate(a.text || '', captures);
        const overlay = {
          text,
          color:       a.color || 'red',
          duration_ms: a.duration_ms || 5000,
          shownAt:     tsMs,
          trigger:     t.name,
          scope:       t._scope,
        };
        _pushOverlay(overlay);
        // Also log to stdout so users running the CLI see it.
        console.log(`[trigger:${t._scope}] ${t.name} → ${text}`);
        scheduleRender();
      }
      // tts / sound / discord / emit_event are intentionally no-ops in v1;
      // schema is there, evaluator wiring follows in the next agent rev.
    }
  }
}

// Transition a single backfill request via the bot's
// POST /api/agent/backfill-requests/{id}/{action} endpoint. `body` is the
// optional payload (reason / summary / error_message depending on action).
// Returns a Promise that resolves to true on success.
function postBackfillRequestAction({ botUrl, token, id, action, body }) {
  if (!botUrl || !token || !id || !action) return Promise.resolve(false);
  const base = botUrl.replace(/\/encounter(\?.*)?$/, '/backfill-requests');
  const url  = `${base}/${encodeURIComponent(id)}/${encodeURIComponent(action)}`;
  const json = body ? JSON.stringify(body) : '';
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        method:   'POST',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(json),
          'User-Agent':    `wolfpack-logsync/${AGENT_VERSION}`,
        },
        timeout: 5000,
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      });
      req.on('error',   () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      if (json) req.write(json);
      req.end();
    } catch { resolve(false); }
  });
}

function uploadHistoricalChat(messages, { botUrl, token, dryRun }) {
  void botUrl; void token;
  if (dryRun) {
    console.log(`[historical-chat] ${messages.length} chat lines (dry-run)`);
    return Promise.resolve({ stored: messages.length });
  }
  enqueueUpload('historical_chat', { agent_version: AGENT_VERSION, messages });
  return Promise.resolve({ stored: messages.length });
}

function uploadLockouts(entries, { botUrl, token, dryRun, character }) {
  void botUrl; void token;
  // Attach the character name so the bot can store it as killedBy
  const enriched = entries.map(e => ({ ...e, character: character || 'unknown' }));
  if (dryRun) {
    for (const e of enriched)
      console.log(`[lockout] ${e.bossName}: ${Math.round(e.remainingMs / 3600000)}h remaining`);
    return Promise.resolve();
  }
  enqueueUpload('lockout', { agent_version: AGENT_VERSION, entries: enriched });
  return Promise.resolve();
}

// Fun-events upload (Peopleslayer LD counter, future CoH/DI/Aegolism). Each
// event is a tagged occurrence the bot stores in the fun_events table with
// a unique constraint on (guild_id, event_type, caster, event_ts) so re-
// running the same backfill doesn't double-count. See utils/state and the
// fun_events Supabase migration on the bot side.
function uploadFunEvents(events, { dryRun } = {}) {
  if (!Array.isArray(events) || events.length === 0) return Promise.resolve();
  if (dryRun) {
    for (const e of events) console.log(`[fun-event] ${e.type} · ${e.caster || ''} · ${e.ts}`);
    return Promise.resolve();
  }
  enqueueUpload('fun_event', { agent_version: AGENT_VERSION, events });
  return Promise.resolve();
}

// Inbound /tell relay. The bot endpoint re-validates characters.tell_relay
// before accepting, so this is a safe defense-in-depth — but the agent also
// gates on stats.characterPrefs[character].tell_relay so we don't burn the
// queue with rejected uploads.
function uploadTells({ character, tells }, { dryRun } = {}) {
  if (!character || !Array.isArray(tells) || tells.length === 0) return Promise.resolve();
  if (dryRun) {
    for (const t of tells) console.log(`[tell:${t.direction}] ${character} ${t.direction === 'outgoing' ? '→' : '←'} ${t.other}: ${t.text}`);
    return Promise.resolve();
  }
  enqueueUpload('tells', { agent_version: AGENT_VERSION, character, tells });
  return Promise.resolve();
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

  // ── Single-instance check ─────────────────────────────────────────────────
  // If a background service is already running, don't double-tail the logs —
  // just point the user at the dashboard URL and exit. The check is skipped
  // when started with --no-service-check (so the service spawn itself works).
  if (!args.flags.noServiceCheck) {
    const active = readActivePid();
    if (active && active.pid !== process.pid) {
      const live = active.webPort ? await probeWebDashboard(active.webPort) : false;
      if (live) {
        const url = `http://localhost:${active.webPort}`;
        console.log(`\n  ${ANSI.green}✓ Service already running${ANSI.reset} (pid ${active.pid}, v${active.agentVersion}, since ${active.startedAt}).`);
        console.log(`  ${ANSI.cyan}Dashboard:${ANSI.reset} ${url}`);

        // Non-TTY (auto-restart, CI, redirected stdout) — open browser and
        // exit silently. TTY users get the prompt first; the browser is only
        // launched after they pick V (or the timeout defaults to V) so the
        // prompt isn't stolen by the OS focus-change to the browser window.
        if (!process.stdin.isTTY) {
          openDashboardInBrowser(active.webPort);
          process.exit(0);
        }

        console.log(`\n  ${ANSI.bold}What do you want to do?${ANSI.reset}`);
        console.log(`    ${ANSI.cyan}[V]${ANSI.reset} View dashboard, leave service running ${ANSI.dim}(default — auto-selects in 30s)${ANSI.reset}`);
        console.log(`    ${ANSI.cyan}[K]${ANSI.reset} Kill the service entirely`);
        console.log(`    ${ANSI.cyan}[R]${ANSI.reset} Kill the service and resume in this window`);
        console.log('');

        const choice = await new Promise((resolve) => {
          // 30s so the user has time to read the options without the browser
          // stealing focus mid-decision.
          const timer = setTimeout(() => resolve('v'), 30_000);
          try { process.stdin.setRawMode(true); } catch {}
          process.stdin.resume();
          process.stdin.setEncoding('utf8');
          const onData = (data) => {
            const k = data.toString().toLowerCase();
            if (k === 'v' || k === 'k' || k === 'r' || k === '\x03') {
              clearTimeout(timer);
              process.stdin.removeListener('data', onData);
              try { process.stdin.setRawMode(false); } catch {}
              resolve(k === '\x03' ? 'v' : k);
            }
          };
          process.stdin.on('data', onData);
        });

        if (choice === 'v') {
          // Now safe to open the browser — the user already made their pick.
          openDashboardInBrowser(active.webPort);
          console.log(`  ${ANSI.dim}Service kept running. Feel free to close this window.${ANSI.reset}\n`);
          process.exit(0);
        }

        // K or R: ask the service to shut down cleanly via /api/shutdown
        console.log(`  ${ANSI.yellow}Asking service (pid ${active.pid}) to shut down...${ANSI.reset}`);
        const shutdownOk = await new Promise((resolve) => {
          const req = http.request({
            hostname: '127.0.0.1', port: active.webPort, path: '/api/shutdown',
            method: 'POST', timeout: 3000,
          }, (res) => { res.resume(); resolve(res.statusCode === 200); });
          req.on('error',   () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });
        if (!shutdownOk) {
          // Fallback: force-kill the PID
          console.log(`  ${ANSI.dim}Shutdown endpoint didn't respond — force-killing pid ${active.pid}${ANSI.reset}`);
          try { process.kill(active.pid, 'SIGTERM'); } catch {}
          // Give the OS a moment, then SIGKILL if still alive
          await new Promise(r => setTimeout(r, 1500));
          try { process.kill(active.pid, 0); try { process.kill(active.pid, 'SIGKILL'); } catch {} } catch {}
        }
        // Wait for PID to actually exit (max 5s)
        for (let i = 0; i < 25; i++) {
          try { process.kill(active.pid, 0); }
          catch { break; }   // process gone
          await new Promise(r => setTimeout(r, 200));
        }
        removePidFile();
        console.log(`  ${ANSI.green}✓ Service stopped.${ANSI.reset}`);

        if (choice === 'k') {
          console.log(`  ${ANSI.dim}This window will close now.${ANSI.reset}\n`);
          process.exit(0);
        }
        // choice === 'r': fall through and continue normal startup —
        // loadSessionState() will pick up where the killed service left off.
        console.log(`  ${ANSI.cyan}Resuming agent in this window...${ANSI.reset}\n`);
      } else {
        // PID exists but web dashboard isn't responding — stale, clean it up
        removePidFile();
      }
    }

    // ── Port-probe fallback ────────────────────────────────────────────────
    // Older agent versions (pre-v2.3.20) didn't write a PID file, so the
    // check above won't detect them. Probe the default web port directly —
    // if SOMETHING is serving /api/state on 127.0.0.1:7777, assume it's an
    // ancient agent and offer the same V/K/R prompt so we don't end up with
    // two processes silently fighting for the port.
    if (!args.flags.noServiceCheck) {
      const probePort = args.flags.webPort || 7777;
      const probeLive = await probeWebDashboard(probePort);
      if (probeLive) {
        const url = `http://localhost:${probePort}`;
        console.log(`\n  ${ANSI.yellow}⚠ Another agent is already serving ${url}${ANSI.reset}`);
        console.log(`  ${ANSI.dim}(No PID file — likely an older version that didn't write one.)${ANSI.reset}`);
        if (!process.stdin.isTTY) {
          openDashboardInBrowser(probePort);
          process.exit(0);
        }
        console.log(`\n  ${ANSI.bold}What do you want to do?${ANSI.reset}`);
        console.log(`    ${ANSI.cyan}[V]${ANSI.reset} View dashboard, leave it running ${ANSI.dim}(default — auto in 30s)${ANSI.reset}`);
        console.log(`    ${ANSI.cyan}[K]${ANSI.reset} Kill it (asks via /api/shutdown, falls back to manual)`);
        console.log(`    ${ANSI.cyan}[R]${ANSI.reset} Kill it and resume in this window\n`);
        const choice = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve('v'), 30_000);
          try { process.stdin.setRawMode(true); } catch {}
          process.stdin.resume();
          process.stdin.setEncoding('utf8');
          const onData = (data) => {
            const k = data.toString().toLowerCase();
            if (k === 'v' || k === 'k' || k === 'r' || k === '\x03') {
              clearTimeout(timer);
              process.stdin.removeListener('data', onData);
              try { process.stdin.setRawMode(false); } catch {}
              resolve(k === '\x03' ? 'v' : k);
            }
          };
          process.stdin.on('data', onData);
        });
        if (choice === 'v') {
          openDashboardInBrowser(probePort);
          console.log(`  ${ANSI.dim}Other service kept running. Closing this window.${ANSI.reset}\n`);
          process.exit(0);
        }
        // Try graceful shutdown via /api/shutdown
        console.log(`  ${ANSI.yellow}Asking the other agent to shut down...${ANSI.reset}`);
        const shutdownOk = await new Promise((resolve) => {
          const req = http.request({
            hostname: '127.0.0.1', port: probePort, path: '/api/shutdown',
            method: 'POST', timeout: 3000,
          }, (res) => { res.resume(); resolve(res.statusCode === 200); });
          req.on('error',   () => resolve(false));
          req.on('timeout', () => { req.destroy(); resolve(false); });
          req.end();
        });
        if (!shutdownOk) {
          console.log(`  ${ANSI.red}✗ The other agent doesn't have /api/shutdown (likely too old).${ANSI.reset}`);
          console.log(`  ${ANSI.dim}Find the PID with:   netstat -ano | findstr :${probePort}${ANSI.reset}`);
          console.log(`  ${ANSI.dim}Kill it with:        taskkill /F /PID <pid>${ANSI.reset}`);
          console.log(`  ${ANSI.dim}Then re-run parser.bat.${ANSI.reset}\n`);
          process.exit(0);
        }
        // Wait for port to free up
        for (let i = 0; i < 25; i++) {
          if (!(await probeWebDashboard(probePort))) break;
          await new Promise(r => setTimeout(r, 200));
        }
        console.log(`  ${ANSI.green}✓ Other agent stopped.${ANSI.reset}`);
        if (choice === 'k') {
          console.log(`  ${ANSI.dim}This window will close now.${ANSI.reset}\n`);
          process.exit(0);
        }
        console.log(`  ${ANSI.cyan}Resuming agent in this window...${ANSI.reset}\n`);
      }
    }
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
  _uploadOpts    = { botUrl, token, dryRun };
  _isServiceMode = !!args.flags.noServiceCheck;

  // Start the durable upload queue drain. Loads any pending entries from
  // disk first and kicks an immediate replay attempt — so anything left
  // over from a previous crashed session goes out as soon as the
  // network's back.
  if (!dryRun) startUploadQueueDrain({ botUrl, token });

  // Load persisted lifetime stats so the dashboard can show them
  loadStats();
  // Restore in-flight session state if the previous run snapshotted within the
  // last 10 minutes (typical for [U] update-and-restart, or quick Ctrl+C).
  const _sessionRestored = loadSessionState();
  if (_sessionRestored) {
    stats._sessionRestoredBanner = true;
    stats._sessionRestoredAt     = Date.now();
  }

  // Inventory scan — pick up any <Char>-Inventory.txt files in the log dir
  // so tanks' weapon loadouts can be surfaced + (Phase 2) cross-referenced
  // against a proc database for theoretical TPS.
  refreshInventories();
  setInterval(refreshInventories, 5 * 60_000);

  // Version polling — reach out to the bot every 10 min so idle agents
  // still learn about new releases promptly (without needing an encounter
  // upload to surface latest_agent_version).
  if (botUrl) {
    pollLatestVersion({ botUrl });
    setInterval(() => pollLatestVersion({ botUrl }), 10 * 60_000);
    // Officer-filed backfill request poll. Runs slightly more often than the
    // version probe since requests are actionable (officers expect agents to
    // notice within ~5 min). Initial run is delayed a few seconds so the
    // log-tail enumeration has populated stats.watchedLogs first.
    setTimeout(() => pollBackfillRequests({ botUrl, token }), 8_000);
    setInterval(() => pollBackfillRequests({ botUrl, token }), 5 * 60_000);
    // Guild triggers: load on startup (after watchedLogs is populated) and
    // refresh every 10 min. Personal triggers load once from local disk.
    loadPersonalTriggers();
    setTimeout(() => pollGuildTriggers({ botUrl, token }), 12_000);
    setInterval(() => pollGuildTriggers({ botUrl, token }), 10 * 60_000);
    // Per-character data prefs (exclude_from_stats / exclude_inventory).
    // Polled so the owner's choice on /me takes effect within ~10 min on every
    // machine they run the agent on — no agent restart required.
    setTimeout(() => pollCharacterPrefs({ botUrl, token }), 10_000);
    setInterval(() => pollCharacterPrefs({ botUrl, token }), 10 * 60_000);
  }

  // Optional web dashboard — bind 127.0.0.1 only, single HTML page polls /api/state.
  if (args.flags.webPort) {
    startWebDashboard(args.flags.webPort);
    writePidFile(args.flags.webPort);
    // Best-effort cleanup so a stale PID doesn't block the next launch.
    // Queue-flush exit handlers are registered separately by
    // startUploadQueueDrain() so they fire even in non-dashboard CLI mode.
    process.on('exit',    () => removePidFile());
    process.on('SIGINT',  () => { removePidFile(); process.exit(0); });
    process.on('SIGTERM', () => { removePidFile(); process.exit(0); });
    // Auto-open the browser on FRESH starts only — skip if we just resumed
    // (i.e. this is a [U] auto-restart or quick Ctrl+C relaunch). Also skip
    // when --no-auto-open is set for headless / CI scenarios.
    if (!_sessionRestored && !args.flags.noAutoOpen) {
      // Small delay so the listener has bound and the page returns 200
      setTimeout(() => openDashboardInBrowser(args.flags.webPort), 800);
    }
  }
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

    // Chat is filtered out by shouldKeep at the byte-level, so handle it
    // before the combat filter. Batches up to 500 then flushes.
    const chatBatch = [];
    const flushChat = async (force) => {
      if (chatBatch.length === 0) return;
      if (!force && chatBatch.length < 500) return;
      const batch = chatBatch.splice(0);
      await uploadHistoricalChat(batch, { botUrl, token, dryRun })
        .catch(err => console.warn(`[chat backfill] ${err.message}`));
    };

    for (const b of builders) {
      console.log(`[${b.character}] scanning ${b.logPath}`);
      await readWindow(b.logPath, since, until, line => {
        const chatMsg = parseChatLine(line, b.character);
        if (chatMsg) {
          chatBatch.push({ ...chatMsg, uploadedBy: b.character });
          if (chatBatch.length >= 500) flushChat(true).catch(() => {});
          return;
        }
        if (!shouldKeep(line, dropPatterns, keepPatterns)) return;
        const ts = parseEqTimestamp(line);
        const ev = parseEvent(line, ts);
        if (ev) b.builder.add(ev);
      });
      b.builder.flush();
    }
    await flushChat(true).catch(() => {});
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
        // still want to capture and relay them to Discord — UNLESS the owner
        // has set exclude_from_stats on the source character. Each push
        // below short-circuits on the prefs gate so an excluded character
        // generates zero outbound traffic from this machine.
        const _sourceExcluded = !shouldUploadForCharacter(b.character);

        // /tell relay (opt-in via characters.tell_relay; default off). MUST be
        // checked BEFORE shouldKeep — the byte-level filter explicitly drops
        // "tells you" / "you told" lines so we never see them in combat paths.
        // exclude_from_stats short-circuits this too; both gates must pass.
        const _tellPrefs = stats.characterPrefs && stats.characterPrefs[String(b.character || '').toLowerCase()];
        if (!_sourceExcluded && _tellPrefs?.tell_relay) {
          const tellEvt = parseTellLine(line, b.character);
          if (tellEvt) {
            tellBuffer.push({ ...tellEvt, character: b.character });
            // Don't `return` — tells are side-channel. Continue so any further
            // processing (e.g. log highlighter, future panels) still sees the line.
          }
        }

        // /sll lockout output → bot timer (Available entries silently skipped)
        const lockoutEntry = parseSllLine(line);
        if (lockoutEntry) {
          if (!_sourceExcluded) _lockoutBuffer.push({ ...lockoutEntry, character: b.character });
          return;
        }
        // Even if parseSllLine returned null we may have toggled _inLockoutSection;
        // only bail early if we're inside a lockout block (line was consumed).
        if (_inLockoutSection && /^\[.+?\]\s+==/i.test(line)) return;

        // Druzzil Ro instance-kill announcement → boss timer + raid channel.
        // These server-god broadcasts are byte-identical across every log on
        // the box that received them, so a raw-text fingerprint dedups the
        // main-vs-alt double cleanly.
        const druzzilKill = parseDruzzilKill(line);
        if (druzzilKill) {
          const _dkFp = 'druzzil|' + line.replace(/^\[.+?\]\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (!_sourceExcluded && !_crossLogDupe(_dkFp)) druzzilKillBuffer.push(druzzilKill);
          return;
        }

        // PVP Druzzil Ro broadcast → PVP channel (with howl/backup logic in bot).
        // Same cross-log dedup — this is the "Wabumkin killed Qados posted
        // twice" fix at the source.
        const pvpBcast = parsePvpBroadcast(line);
        if (pvpBcast) {
          const _pvpFp = 'pvp|' + line.replace(/^\[.+?\]\s*/, '').toLowerCase().replace(/\s+/g, ' ').trim();
          if (!_sourceExcluded && !_crossLogDupe(_pvpFp)) pvpBuffer.push(pvpBcast);
          return;
        }

        // Fun-event detection (Peopleslayer LD, Malthur provisions, future
        // CoH/DI/etc). Don't `return` after a match — fun events are pure
        // side-channel logging and the line might also feed other parsers.
        const ldEvt = parsePeopleslayerLd(line);
        if (ldEvt && !_sourceExcluded) funEventBuffer.push(ldEvt);
        // Both Malthur counters — caster-side (only Malthur's own log,
        // ground truth) and recipient-side (every member's log, broader
        // reach) cross-validate each other.
        const provEvt = parseMalthurProvision(line, b.character);
        if (provEvt && !_sourceExcluded) funEventBuffer.push(provEvt);
        const sumProvEvt = parseSummonProvisions(line, b.character);
        if (sumProvEvt && !_sourceExcluded) funEventBuffer.push(sumProvEvt);
        const cursorEvt = parseCursorFull(line, b.character);
        if (cursorEvt && !_sourceExcluded) funEventBuffer.push(cursorEvt);
        const htEvt = parseHarmTouch(line, b.character);
        if (htEvt && !_sourceExcluded) funEventBuffer.push(htEvt);
        const lohEvt = parseLayOnHands(line, b.character);
        if (lohEvt && !_sourceExcluded) funEventBuffer.push(lohEvt);
        const pkEvt = parsePvpFlag(line, b.character);
        if (pkEvt && !_sourceExcluded) funEventBuffer.push(pkEvt);

        // Guild / raid chat relay
        const chatMsg = parseChatLine(line, b.character);
        if (chatMsg) {
          // Anyone speaking in guild/raid chat is, by definition, a player —
          // add to the whitelist so their incoming damage / deaths show up on
          // the Tank dashboard (NPCs never use /gu or /rs).
          confirmPlayer(chatMsg.speaker);
          // Cross-log dedup: same channel + normalized text within 90s = the
          // same message captured from this person's main + alt logs (self-
          // form in one, bystander-form in the other). Speaker is intentionally
          // excluded from the fingerprint since the two forms resolve to
          // different names ("Wabumkin" via self vs "Adiwen" if the alt log
          // also carried a self-form). Drop the duplicate.
          const _chatFp = `chat|${chatMsg.channel}|${String(chatMsg.text).toLowerCase().replace(/\s+/g, ' ').trim()}`;
          if (!_sourceExcluded && !_crossLogDupe(_chatFp)) chatBuffer.push(chatMsg);
          return;
        }

        // ── Normal combat filter ───────────────────────────────────────────
        if (!shouldKeep(line, dropPatterns, keepPatterns)) return;
        const ts = parseEqTimestamp(line);
        // Officer-tuned + personal triggers — evaluate each kept line.
        // Cheap: precompiled regex set; usually < 50 entries, < 50µs each.
        try { evaluateTriggersAgainstLine(line, ts ? ts.getTime() : Date.now()); } catch {}
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
