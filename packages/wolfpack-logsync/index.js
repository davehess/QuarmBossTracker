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
const os   = require('os');
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

// Self-cast flat-hate proxy for AAs and direct-hate spells that don't show
// a damage line — without this they're invisible to the threat meter even
// though they're a real chunk of a tank's TPS. Lowercased spell/AA name →
// hate per cast. Bumps the caster's `spell` bucket so the breakdown reads
// honestly. Community-sourced PoP-era ballparks; correct as observed.
const CAST_HATE = {
  // Knight aggro AAs
  'voice of thule':                  3000,   // SHD AA — pulls a single mob hard
  'disruptive persecution':          1500,   // PAL AA — burst aggro
  'projection of fury':               750,   // SHD AA — burst aggro
  // Warrior provocation chain
  'provocation':                     1000,   // WAR AA — boosted taunt
  'bellow of the mastruq':           2000,   // WAR AA — AoE taunt
  // Hate-add nukes (named hate procs from clickies / disciplines)
  "hate's attraction":               2500,
  'corrupt taunting':                 600,
  // Negative-hate / fade — let them surface as a *spell* row so the user
  // can see them in the breakdown even though they reduce hate. Negative
  // values shrink the spell bucket; the row still shows but doesn't lead.
  'voice of quellious':             -2500,
  'quivering veil of xarn':         -2000,
  'fading memories':                -1500,
  // Classic wizard/caster de-aggro nukes — flat hate reduction per cast.
  'jolt':                            -400,
  'cinder jolt':                     -570,
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
  /\btells you,\s*['"]Attacking\b.+Master\.\s*['"]/,
  // Charm-LAND via pet command ack on an indefinite-article (charmed) mob:
  //   "A Fungoid Sporeling tells you, 'Attacking a bat Master.'"
  // "tells you" ONLY — never "says". The pet's "Following / Guarding, Master."
  // responses are PUBLIC and bystanders see them in zone, which leaked
  // someone else's charm pet into the user's tracker. "tells you" is private
  // to the pet owner so the priority-keep can safely override the tells-drop
  // for the owner without surfacing bystander views.
  //
  // Strict "Master." (capital M, literal period before close-quote) so we
  // only match the COMMAND ACKS — pets say "Attacking X Master." /
  // "Following you, Master." with a period. The PUBLIC flavor chatter that
  // also fires on a charmed mob ("I will destroy all outlanders for the
  // master!") uses lowercase + an exclamation point, and that was matching
  // the previous /i-flagged Master pattern and tripping a phantom session
  // re-open every time the pet ran its mouth.
  /^\[.+?\]\s+an?\s+.+?\s+tells you\s*,?\s*['"][^'"]*Master\.\s*['"]/,
  // Charm-LAND attribution (bystander-visible). "<Mob> regards <Charmer>
  // as an ally." Required so the line survives any future broad drop
  // filter — used to attribute charmed mobs to their enchanter for
  // damage display (Mistmoore glyphed familiars, etc.).
  /\bregards\s+\S+\s+as\s+an\s+ally\b/i,
  // Charm BREAK — bystander visible. Closes the charm session for
  // duration + DPS computation.
  /\b(?:snaps out of(?: the)? charm|is no longer charmed|has been freed of(?: the)? charm)\b/i,
  // Note: /pet health lines (standalone "I have N percent..." + bare buff names)
  // are handled by applyPetHealthLine(), which runs BEFORE shouldKeep() in the
  // tail loop, so they need no priority-keep entry here.
  // Dire Charm cast detection — flags the next charm-land as the AA
  // permanent variant (vs regular Charm cycling).
  /\b(?:begin(?:s)?\s+(?:to\s+cast|casting))\s+Dire\s+Charm\b/i,
  // /who output lines — '[60 Storm Warden] Alice (Wood Elf) <Wolf Pack>' etc.
  // Listed here so they can never be dropped by some future broad filter.
  //
  // Trailing word-boundary anchors go AROUND ANONYMOUS/GM (so we don't keep a
  // substring like "ANONYMOUSXY") but NOT after \w. The earlier form
  // (`\d+\s+\w\b`) silently dropped every non-anon /who row because the \b
  // after \w meant "no word char follows" — but the very next char of any real
  // class name ("Paladin", "Cleric", "Druid"...) IS a word char, so \b failed.
  // [ANONYMOUS] and [GM] survived because ']' is non-word; that's why anon
  // rows alone made it through and visible-class raiders were invisible.
  /^\[.+?\]\s+(?:AFK\s+|LFG\s+)?\[\s*(?:\d+\s+\w|\bANONYMOUS\b|\bGM\b)/i,
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
  /\byou begin singing/i,                         // bard songs (incl. charm) — for the charm-tracker duration
  /\byou begin playing a melody/i,                // /melody start (no per-song names — see Zeal label 134)
  /\byour melody has ended/i,                     // /melody stop
  /\byour song ends/i,                            // single-song stop / interrupt
  /\bbegins? to cast/i,
  /\byou cast /i,
  /\bresisted your/i,
  /\byou resist the .+ spell/i,                   // incoming spell we resisted (names the spell)
  / (?:is|are) (?:an?|the) (?:leader|officer|member) of /i,  // /guildstatus rank line
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
  // Aggro DUMPS — the other direction. Feign Death (monk ability + SK/necro
  // spell land both print the fall line) and rogue Evade (mid-fight Hide).
  // The threat meter zeroes / halves the player's buckets on these.
  /\bhas fallen to the ground\b/i,
  /\byou have fallen to the ground\b/i,
  /\byou have momentarily ducked away from the main combat\b/i,
  /\byour attempts at ducking clear of combat fail\b/i,
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

// A spaceless, lowercase token ("to", "a", "the", "and", "of", "by"…) is never
// a real combat attacker. Real player names + single-word NPC/boss names are
// capitalized; multi-word NPCs ("a sentinel") legitimately start lowercase but
// contain a space (and are filtered as NPCs downstream). A spaceless,
// lowercase capture is a parse fragment — e.g. Zeal's /abc abbreviated-chat
// mode can mangle a combat line so the verb regex's lazy (.+?) grabs a
// connector word like "to", which then shows up as a phantom player named
// "to" on the threat / DEEPS / top-damage panels.
function isPlausibleAttacker(name) {
  if (!name) return false;
  if (/^you$/i.test(name)) return true;     // resolves to the uploader downstream
  if (/\s/.test(name)) return true;          // multi-word → NPC filters handle it
  return /^[A-Z]/.test(name);                // single token must be capitalized
}

// ── Charm-spell catalog (for the charm-tracker duration bar) ─────────────────
// Maps the exact spell/song name (as it appears in "You begin casting <X>." /
// "You begin singing <X>.") → { cls, dur }. `cls` is 'bard' for songs (short,
// re-sung often → recharm warning fires 6s before the last tick) and
// 'enchanter' for everyone else's timed charm (longer → warning at 30s
// remaining). `dur` is the spell duration in SECONDS at level 60 (the guild's
// cap), derived from eqemu_spells (buffduration × 6, level-capped by formula).
//
// ⚠️ These are the spell's MAX duration — Quarm charm usually breaks earlier on
// a per-tick check, and the enchanter cap is long, so the 30s-remaining warning
// lands near natural expiry. Tune freely: the bar + warning are driven entirely
// off this table, so correcting a value here is the whole change. Bard values
// (60s / 18s) are practical as-is.
const CHARM_SPELLS = new Map([
  // Bard — restore to the spell-data 60s / 18s. The earlier "30s tuned"
  // value was misread tuning advice — the in-game SBB description confirms
  // 10 ticks @ L60 (60s) max, and the user wants the tracker to reflect
  // that. EQ logs SBB with a BACKTICK possessive ("Solon`s") rather than
  // a straight apostrophe; we accept both spellings so the cast-detection
  // path stages _pendingCharmSpell reliably (no more falling back to the
  // estimated ~30s display).
  ["solon's bewitching bravura", { cls: 'bard', dur: 60 }],
  ["solon`s bewitching bravura", { cls: 'bard', dur: 60 }],
  ["solon's song of the sirens",  { cls: 'bard', dur: 18 }],
  ["solon`s song of the sirens",  { cls: 'bard', dur: 18 }],
  // Enchanter (+ druid/necro animal/undead charm share the same 205/formula-10
  // line). Single-target timed charm.
  ['charm',             { cls: 'enchanter', dur: 720 }],
  ['beguile',           { cls: 'enchanter', dur: 720 }],
  ['cajole',            { cls: 'enchanter', dur: 720 }],
  ['allure',            { cls: 'enchanter', dur: 720 }],
  ['persuade',          { cls: 'enchanter', dur: 720 }],
  ['alluring whispers', { cls: 'enchanter', dur: 720 }],
  // Boltran's Agacerie — the in-game spell description is the ground truth:
  // 63 ticks (L53) → 70 ticks @ L60 → 75 ticks (L65), i.e. 420s max at L60.
  // That matches eqemu_spells id 1705 (formula 8, cap 75 ticks), NOT id 1706
  // (formula 10) — so dur is 420s, the same value it shipped with originally.
  ["boltran`s agacerie",{ cls: 'enchanter', dur: 420 }],
  ["boltran's agacerie",{ cls: 'enchanter', dur: 420 }],
  ['dictate',           { cls: 'enchanter', dur: 48  }],   // AoE charm — short
  // Druid animal charm.
  ['charm animals',     { cls: 'enchanter', dur: 720 }],
  ['beguile animals',   { cls: 'enchanter', dur: 720 }],
  ['allure of the wild',{ cls: 'enchanter', dur: 720 }],
  ['befriend animal',   { cls: 'enchanter', dur: 720 }],
  ['call of karana',    { cls: 'enchanter', dur: 720 }],
  // Necro undead charm.
  ['cajoling whispers', { cls: 'enchanter', dur: 720 }],
  ['beguile undead',    { cls: 'enchanter', dur: 720 }],
  ['cajole undead',     { cls: 'enchanter', dur: 720 }],
  ['thrall of bones',   { cls: 'enchanter', dur: 720 }],
  ['dominate undead',   { cls: 'enchanter', dur: 720 }],
]);

// ── EQ class-title → base class ───────────────────────────────────────────────
// A /who line shows the LEVEL TITLE for the character's class (e.g. a level-55
// Enchanter reads "[55 Phantasmist]", a level-60 Ranger "[60 Warder]"), not the
// base class. We normalize titles back to the base class so the /who overlay
// shows "Enchanter", not "Phantasmist", and so class-gated logic (e.g. bard
// detection, which checks class === 'Bard') works for titled high-levels too.
// Classic/Titanium-era titles at 51/55/60; the base name (sub-51) passes
// through unchanged, as does anything we don't recognize.
const CLASS_TITLES = (() => {
  const byClass = {
    Warrior:       ['Champion', 'Myrmidon', 'Warlord'],
    Cleric:        ['Vicar', 'Templar', 'High Priest'],
    Paladin:       ['Cavalier', 'Knight', 'Crusader'],
    Ranger:        ['Pathfinder', 'Outrider', 'Warder'],
    'Shadow Knight': ['Reaver', 'Revenant', 'Grave Lord'],
    Druid:         ['Wanderer', 'Preserver', 'Hierophant'],
    Monk:          ['Disciple', 'Master', 'Grandmaster'],
    Bard:          ['Minstrel', 'Troubadour', 'Virtuoso'],
    Rogue:         ['Rake', 'Blackguard', 'Assassin'],
    Shaman:        ['Mystic', 'Luminary', 'Oracle'],
    Necromancer:   ['Heretic', 'Defiler', 'Warlock'],
    Wizard:        ['Channeler', 'Evoker', 'Sorcerer'],
    Magician:      ['Elementalist', 'Conjurer', 'Arch Mage'],
    Enchanter:     ['Illusionist', 'Phantasmist', 'Coercer'],
  };
  const map = new Map();
  for (const [base, titles] of Object.entries(byClass)) {
    map.set(base.toLowerCase(), base);             // base name → itself
    for (const t of titles) map.set(t.toLowerCase(), base);
  }
  // Common spelling variant.
  map.set('shadowknight', 'Shadow Knight');
  return map;
})();
function normalizeClass(raw) {
  if (!raw) return raw;
  const key = String(raw).trim().toLowerCase();
  return CLASS_TITLES.get(key) || String(raw).trim();
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
    return { ts: tsIso, type: 'damage', attacker: m[1].replace(/['`]s$/, ''), defender: m[3], ability: m[2], amount: parseInt(m[4], 10), spellName: m[2].trim() };
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

  // ── Damage-shield proc (must precede the generic "was hit by SPELL" form
  // since both are passive-voice non-melee damage). DS lines uniquely use
  // "is <verb> by <possessive> <SOURCE> for N points of non-melee damage"
  // where SOURCE is a known DS spell/song/item, and the DAMAGE IS CREDITED TO
  // THE DS WEARER (not a third-party caster). EQ uses the SAME passive form
  // for direct nukes ("is hit by YOUR Whirlwind for 250"), so the spell name
  // must match the DS allow-list — otherwise we'd over-tag every spell hit.
  //
  // Known DS sources (extend here as new ones are discovered in logs):
  //   thorns / Thorns of the Whitewood   (Druid)
  //   brambles / bramblecoat              (Druid)
  //   spikes / spikecoat                  (Druid)
  //   symbol of Naltron / Holy Armor      (Cleric)
  //   sanity shield                       (Cleric, Necro)
  //   reflect-style                       (Enchanter, Magician items)
  //   mind wrack                          (Necro)
  //   halo of light                       (item proc)
  //   barbs                               (Beastlord, Druid epic line)
  //   cassindra's chant                   (Bard)
  //   Tooth of the Earth                  (item)
  const DS_SOURCE_RX = /(?:thorns?\b|brambl|spike|sanity\s*shield|mind\s*wrack|reflect\b|symbol\s+of\s+naltron|cassindra|halo\s+of\s+light|tooth\s+of\s+the\s+earth|fangs?\b|barbs?\b|burn(?:ing)?\s+aura|chant\s+of\s+battle)/i;
  m = line.match(/\]\s+(.+?)\s+is\s+\w+\s+by\s+(YOUR|.+?(?:'s|`s))\s+(.+?)\s+for\s+(\d+)\s+points?\s+of\s+non-melee\s+damage/i);
  if (m && DS_SOURCE_RX.test(m[3])) {
    const source = m[2];
    const attacker = /^YOUR$/i.test(source)
      ? null                                     // self — resolved to uploader by EncounterBuilder
      : source.replace(/(?:'s|`s)$/, '');
    return {
      ts:        tsIso,
      type:      'damage',
      attacker:  attacker,
      defender:  m[1],
      ability:   m[3].trim().toLowerCase(),
      amount:    parseInt(m[4], 10),
      ds:        true,                            // tag for the damageShield aggregate
    };
  }

  // "X was hit by SPELL for N (points of) damage." (proc / unsourced spell hit)
  m = line.match(/\]\s+(You|.+?)\s+(?:was|were)\s+hit\s+by\s+(.+?)\s+for\s+(\d+)(?:\s+points?\s+of)?\s+(?:non-melee\s+)?damage/i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: null, defender: m[1] === 'You' ? null : m[1], ability: m[2], amount: parseInt(m[3], 10), spellName: m[2].trim() };
  }

  // "X has taken N (points of) damage from your SPELLNAME." (DoT/spell from uploader)
  m = line.match(/\]\s+(.+?)\s+has\s+taken\s+(\d+)(?:\s+points?\s+of)?\s+damage\s+from\s+your\s+([^.]+)\./i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: null /* self */, defender: m[1], ability: m[3].trim(), amount: parseInt(m[2], 10) };
  }

  // "X has taken N (points of) damage from PlayerName's SPELLNAME." (DoT/spell from third party)
  m = line.match(/\]\s+(.+?)\s+has\s+taken\s+(\d+)(?:\s+points?\s+of)?\s+damage\s+from\s+(\S+?)(?:`s|'s)\s+([^.]+)\./i);
  if (m) {
    return { ts: tsIso, type: 'damage', attacker: m[3], defender: m[1], ability: m[4].trim(), amount: parseInt(m[2], 10), spellName: m[4].trim() };
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
    // Drop fragments where the lazy (.+?) grabbed a connector word as the
    // attacker (e.g. "to") instead of a real name — see isPlausibleAttacker.
    if (!isPlausibleAttacker(m[1])) return null;
    // Extract the verb that matched (it's between the two captures)
    const verbMatch = m[0].match(new RegExp(`\\s+(${ATTACK_VERBS_RX})\\s+`, 'i'));
    const verb = (verbMatch?.[1] || 'hit').toLowerCase().replace(/(?:sh|ch|ss|x)es$/, m => m.slice(0, -2)).replace(/s$/, '');
    return { ts: tsIso, type: 'damage', attacker: m[1], defender: m[2], ability: verb, amount: parseInt(m[3], 10) };
  }

  // "You hit X for N points of non-melee damage." (DoT/proc third-person past-tense)
  m = line.match(/\]\s+(.+?)\s+hit\s+(.+?)\s+for\s+(\d+)\s+points?\s+of\s+non-melee\s+damage/i);
  if (m) {
    if (!isPlausibleAttacker(m[1])) return null;
    return { ts: tsIso, type: 'damage', attacker: m[1], defender: m[2], ability: 'non-melee', amount: parseInt(m[3], 10) };
  }

  // ── Damage-shield FLAVOR line (Quarm two-line DS pattern) ────────────────
  // Quarm logs DS as a PAIR of same-timestamp lines:
  //   "Lord of Ire was hit by non-melee for 14 points of damage."   ← v2.5.54 catches via swing correlation
  //   "Lord of Ire was pierced by thorns."                          ← THIS — names the DS spell
  // The flavor verb varies per DS type (pierced/burned/tormented/frozen/
  // shocked/stricken/scratched/impaled/bitten/stung/etc.). The SOURCE word
  // after "by" is the spell or song name (thorns, brambles, halo of light,
  // chant of battle, etc.). We emit type='ds_flavor' so EncounterBuilder can
  // retag the most recent DS-attributed hit on this same mob with the
  // real spell name. No number, no damage — pure attribution.
  m = line.match(/\]\s+(.+?)\s+was\s+(?:pierced|burned|tormented|frozen|chilled|shocked|stricken|scratched|impaled|bitten|stung|electrocuted|seared|lacerated|paralyzed|cut)\s+by\s+(.+?)\.?\s*$/i);
  if (m && !/for\s+\d/.test(m[0])) {
    return { ts: tsIso, type: 'ds_flavor', defender: m[1], ability: m[2].trim() };
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

  // "X Scores a critical hit!(N)" — melee crit; (N) is the BONUS on top of the hit.
  m = line.match(/\]\s+(.+?)\s+[Ss]cores?\s+a\s+critical\s+hit!\s*\((\d+)\)/);
  if (m && isPlausibleAttacker(m[1])) {
    return { ts: tsIso, type: 'critical', kind: 'melee', attacker: m[1], amount: parseInt(m[2], 10) };
  }

  // "X delivers a critical blast!(N)" — SPELL crit (EQEmu/Fury). First-person
  // form is "You deliver a critical blast!". NOTE: this format is the standard
  // EQEmu string but is unverified against a live Quarm log — confirm with a
  // real spell-crit line and adjust if Quarm words it differently.
  m = line.match(/\]\s+(.+?)\s+delivers?\s+a\s+critical\s+blast!\s*\((\d+)\)/i);
  if (m && isPlausibleAttacker(m[1])) {
    return { ts: tsIso, type: 'critical', kind: 'spell', attacker: m[1], amount: parseInt(m[2], 10) };
  }

  // "/guildstatus" response — reveals guild + rank even for /anon players,
  // which /who hides. Forms:
  //   "Whiskeyjacks is an Officer of Dial a Port."
  //   "Soandso is a Member of <Guild>."   "X is the Leader of <Guild>."
  //   "You are an Officer of <Guild>."     (self)
  // Ranks are Member / Officer / Leader (owner-confirmed; no Recruit). The
  // Leader phrasing is "is the Leader of" — verify against a real leader's
  // /guildstatus and widen here if Quarm words it differently.
  m = line.match(/\]\s+(\S+)\s+(?:is|are)\s+(?:an?|the)\s+(Leader|Officer|Member)\s+of\s+(.+?)\.?\s*$/i);
  if (m) {
    const rank = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
    return { ts: tsIso, type: 'guildstatus', character: m[1], guildRank: rank, guild: m[3].trim() };
  }

  // "You resist the <Spell> spell!" — the uploader resisted an incoming spell.
  // EQ hides the spell name on the NPC's cast line ("X begins to cast a
  // spell.") but the RESIST line names it — so this is how we learn what's
  // being thrown at us. Attribute to the mob being fought (set in add()).
  m = line.match(/\]\s+You resist the\s+(.+?)\s+spell!/i);
  if (m) {
    return { ts: tsIso, type: 'resist', spell: m[1].trim() };
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
  // "singing" covers bard songs so the charm tracker can pick up a bard's charm
  // song (Solon's Bewitching Bravura, etc.) the same way it reads an enchanter's
  // "You begin casting Allure". `singing` is true for bard songs and drives the
  // melody overlay (which only tracks songs, not generic spell casts).
  m = line.match(/\]\s+You begin (casting|singing)\s+(.+?)\./i);
  if (m) {
    return { ts: tsIso, type: 'cast', attacker: null /* self */, ability: m[2], singing: m[1].toLowerCase() === 'singing' };
  }
  // /melody start/stop markers — Quarm only logs "You begin playing a melody."
  // (no per-song names) when a bard fires /melody # # # # #. Catching these
  // gives the melody overlay a "playing melody…" state so the user sees their
  // tracker is alive even before Zeal label 134 transitions in the per-song
  // names. Stop markers ("Your melody has ended.", "Your song ends.") flip
  // the state off.
  if (/^\[[^\]]+\]\s+You begin playing a melody\.\s*$/i.test(line)) {
    return { ts: tsIso, type: 'melody_start' };
  }
  if (/^\[[^\]]+\]\s+(?:Your melody has ended|Your song ends)\.\s*$/i.test(line)) {
    return { ts: tsIso, type: 'melody_stop' };
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

  // ── Aggro dumps ──────────────────────────────────────────────────────────
  // Feign Death — the fall line is the FAILURE tell: "You have fallen to the
  // ground." prints when the FD did NOT take and you're still on the hate
  // table. A SUCCESSFUL FD is silent in the log — the only way to know it
  // stuck is mob behavior (stops attacking / re-engages someone else / cons
  // non-scowling on positive faction). So these events are failure counters
  // only; the threat meter must NOT zero anyone's threat from them.
  if (/\]\s+You have fallen to the ground\.\s*$/i.test(line)) {
    return { ts: tsIso, type: 'feign_death', attacker: null, success: false };
  }
  m = line.match(/\]\s+(\w+) has fallen to the ground\.\s*$/i);
  if (m) return { ts: tsIso, type: 'feign_death', attacker: m[1], success: false };
  // Rogue Evade (mid-fight Hide) — SELF-ONLY lines, so only the rogue's own
  // agent sees them. Success cuts hate roughly in half on TAKP-era servers.
  if (/\]\s+You have momentarily ducked away from the main combat\.\s*$/i.test(line)) {
    return { ts: tsIso, type: 'evade', attacker: null, success: true };
  }
  if (/\]\s+Your attempts at ducking clear of combat fail\.\s*$/i.test(line)) {
    return { ts: tsIso, type: 'evade', attacker: null, success: false };
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

  // Charm-LAND via pet command acknowledgement (the reliable Quarm signal).
  // A charmed mob keeps its spawn name ("A Fungoid Sporeling") and, when given
  // ANY command, acknowledges to its owner with a line ending in "Master":
  //   "A Fungoid Sporeling tells you, 'Attacking a bat Master.'"
  //   "A Fungoid Sporeling says 'Following you, Master.'"
  //   "A Fungoid Sporeling says 'Guarding here Master.'"
  // These acks are shown ONLY to the pet's owner, so the owner is implicitly
  // the agent's character (__SELF__). The leading indefinite article ("a "/
  // "an ") marks it as a CHARMED creature rather than a proper-named summoned
  // pet — and rules out a player-chat false positive, since no character name
  // starts with "a ". Quarm does NOT emit the classic "regards X as an ally"
  // charm-land line, so a pet command is what actually opens the enchanter/bard
  // charm overlay (source:'charm_land' starts the tracked session). MUST come
  // before the proper-named summoned-pet matcher below so a charmed mob's
  // "Attacking … Master" opens a session instead of being treated as a summon.
  // Charm-LAND via pet command ack on an indefinite-article (charmed) mob:
  //   "A Fungoid Sporeling tells you, 'Attacking a bat Master.'"
  // The leading indefinite article ("a "/"an ") marks it as a CHARMED creature
  // rather than a proper-named summoned pet — and rules out a player-chat false
  // positive, since no character name starts with "a ". Quarm does NOT emit the
  // classic "regards X as an ally" charm-land line, so a pet command ack is
  // what actually opens the enchanter/bard charm overlay (source:'charm_land'
  // starts the tracked session). MUST come before the proper-named summoned-pet
  // matcher below so a charmed mob's "Attacking … Master" opens a session
  // instead of being treated as a summon.
  //
  // ⚠️ "tells you" ONLY — never "says". The pet's "Following you, Master." /
  // "Guarding here, Master." responses are PUBLIC ("says") and visible to
  // every bystander in zone, so matching them attributed *someone else's*
  // charm pet to __SELF__ — the bystander leak the user reported. "tells you"
  // is private to the pet owner so it's reliably self-attributable. For the
  // owner's own initial-follow charm-land we still get a session opened via
  // _reconcileGaugeCharms() reading Zeal slot 16.
  // Strict "Master." (capital + period, no /i flag) — matches only the pet
  // command acks ("Attacking X Master.", "Following you, Master.",
  // "Guarding here, Master."). The /i Master pattern previously matched the
  // PUBLIC flavor chatter "I will destroy all outlanders for the master!"
  // too, which (a) reaches Master's log as private "tells you" *and* (b)
  // reaches bystanders' logs as public "says" — both forms re-opened a
  // phantom charm session every time the pet flavor-talked.
  m = line.match(/\]\s+(an?\s+.+?)\s+tells you\s*,?\s*['"][^'"]*Master\.\s*['"]/);
  if (m) {
    return { ts: tsIso, type: 'pet_leader', pet: m[1], owner: '__SELF__', source: 'charm_land' };
  }

  // Summoned-pet attribution. Form:
  //   "A Soriz Skeleton tells you, 'Attacking A Shissar Taskmaster Master.'"
  // This line is ONLY visible to the player who controls the pet, so the
  // owner is implicitly the agent's character. Emit a sentinel owner of
  // "__SELF__" — EncounterBuilder.add() resolves it to this.character. No
  // charm session: proper-named pets are summons, not charm cycles. Also
  // captures the TARGET so the pet-tracker overlay can show what the pet
  // is currently attacking.
  m = line.match(/\]\s+(.+?)\s+tells you,\s*['"]Attacking\s+(.+?)\s+Master\.\s*['"]/);
  if (m) {
    return { ts: tsIso, type: 'pet_leader', pet: m[1], owner: '__SELF__', target: m[2] };
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
    // `/who all` appends the player's current zone SHORT name after the guild:
    //   "[60 Storm Warden] Alice (Wood Elf) <Wolf Pack> ZONE: oasis"
    // A plain in-zone `/who` has no ZONE clause, so this is null there.
    const zm = line.match(/\bZONE:\s*([A-Za-z0-9_'-]+)/i);
    return {
      ts:        tsIso,
      type:      'who',
      name:      m[5],
      level:     m[1] ? parseInt(m[1], 10) : null,
      class:     m[2] ? normalizeClass(m[2].trim()) : null,
      anonymous: !!m[3],
      gm:        !!m[4],
      race:      m[6] || null,
      guild:     m[7] || null,
      zone:      zm ? zm[1].toLowerCase() : null,
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
const whoData = new Map(); // lowercaseName → { name, class, level, race, guild, anonymous, gm, zone, observedAt }

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

// ── Charm-pet tick tracker (module-level, survives encounter resets) ───────
// Knowledge from the owner (2026-06-02):
//   - Each mob has its own 6-second "mob tick" anchored to its spawn time.
//   - Charmed pets re-roll their charm check on the mob's OWN tick (not
//     server tick).
//   - A charm BREAK fires on that mob tick → the break event itself IS a
//     fresh anchor for the 6s cycle.
// We track each pet's last known tick anchor + current charm state; the
// dashboard "Charm Pets" panel renders a 6s countdown so enchanters can
// see the next check coming and re-cast pre-emptively.
//   petLower -> { pet, owner, last_tick_at, last_event ('land'|'break'),
//                 is_active }
const _charmTickTracker = new Map();
// How long a broken charm pet LINGERS on the overlay (tick counter still
// running) before it's dropped — unless the pet dies first. Per user: keep the
// pet so the mob's tick counter stays visible; remove on death or after 5 min.
const PET_LINGER_MS = 5 * 60 * 1000;
// Most-recent self charm-spell cast, staged by the `cast` handler. Consumed by
// the next charm-land (gauge or log) within a short window to attach the charm's
// class + duration to the session, driving the duration bar + class-aware warn.
let _pendingCharmSpell = null;   // { cls, dur, owner, ts } | null
const PENDING_CHARM_WINDOW_MS = 12_000;
function _bumpCharmTick(pet, owner, eventKind, atMs, opts) {
  if (!pet) return;
  const k = String(pet).toLowerCase();
  // Coerce the anchor to epoch-ms. Callers pass `this.lastEvent`, which is the
  // ISO string `event.ts` — NOT a number. Stored as-is, that made the charm
  // overlay compute `Date.now() - "2026-…"` = NaN ("tick NaN · up NaN:NaN").
  let ts;
  if (typeof atMs === 'number' && isFinite(atMs)) ts = atMs;
  else if (atMs != null) { const d = new Date(atMs).getTime(); ts = isFinite(d) ? d : Date.now(); }
  else ts = Date.now();
  const prev = _charmTickTracker.get(k);
  _charmTickTracker.set(k, {
    pet,
    owner: owner || null,
    last_tick_at: ts,
    last_event: eventKind,         // 'land' or 'break'
    is_active: eventKind === 'land',
    // When a charm breaks we keep the pet LINGERING on the overlay (tick counter
    // still running) for a grace period — set on break, cleared on a fresh land.
    // The overlay fires the recharm alert immediately on this transition, then
    // keeps showing the pet until it dies or PET_LINGER_MS passes.
    broke_at: eventKind === 'break' ? ts : null,
    // started_at anchors elapsed/duration in the charm overlay. Always reset
    // on land — every land event reaching _bumpCharmTick is a real cast (the
    // caller already filters duplicate pet-acks; see the source:'charm_land'
    // handler in the encounter builder, which only calls _bumpCharmTick again
    // when _pendingCharmSpell was consumed by the cast). Preserving across a
    // re-cast made bards cycling on the same mob see 'up 3:15 · tick 32/10'
    // instead of resetting to 0:00 each cycle. On break, preserve so the
    // closed entry still reports how long the LAST charm lasted.
    started_at: eventKind === 'land' ? ts : (prev ? prev.started_at : ts),
    // Dire Charm (AA) is permanent until a resist break — the overlay shows
    // no duration countdown for it, only the break alarm. Regular charm is
    // timed. Sticky across the session for this pet.
    is_dire_charm: opts && opts.is_dire_charm != null
      ? !!opts.is_dire_charm
      : (prev ? !!prev.is_dire_charm : false),
    // Charm class + duration (seconds) for the duration bar. Set from the
    // staged charm-spell cast on land; carried forward across ticks so the bar
    // persists for the whole session.
    charm_class:  (opts && opts.charm_class)  || (prev ? prev.charm_class  : null),
    duration_sec: (opts && opts.duration_sec != null) ? opts.duration_sec
                : (prev ? prev.duration_sec : null),
  });
  // Mirror the charm spell into _buffLandingsByTarget so the Mob Info debuff
  // section shows e.g. "Allure (Hopeya)" with a live countdown — Allure's
  // cast_on_other is NULL in eqemu_spells, so the log-driven path can't
  // surface it; the charm-land event is the only signal we have. Only on
  // 'land' (the synthesis represents the active charm), and only when the
  // caller knows the actual spell + duration (i.e. a real cast was staged —
  // gauge-only re-charms without a fresh cast carry the previous session's
  // values forward without re-bumping the debuff).
  if (eventKind === 'land' && opts && opts.charm_spell_name) {
    const dur = (opts.duration_sec != null) ? opts.duration_sec : (prev ? prev.duration_sec : 0);
    if (dur > 0) _recordCharmSpellOnTarget(pet, owner, opts.charm_spell_name, dur);
  }
  // Capture pre-charm debuffs into the Charm tracker. When you debuff a
  // mob THEN charm it (the only practical sequence — EQ won't let you
  // debuff your own pet), the debuff lands in _buffLandingsByTarget keyed
  // by the target NAME, but never in _petBuffLandings keyed by the OWNER
  // (because at land time the mob wasn't yet a pet, so _petOwnerByName
  // returned null and recordPetBuffLanding bailed). Mob Info shows them
  // (it keys by target), but the Charm tracker doesn't. On a fresh land,
  // sweep _buffLandingsByTarget[pet] into _petBuffLandings[owner] so the
  // Tashanian / Mez / etc. you cast pre-charm carry over to the Charm
  // tracker too. Skip worn-off and expired entries.
  if (eventKind === 'land' && owner) {
    _captureTargetBuffsOnCharm(pet, owner);
  }
}
// Copy any active (not-expired, not-worn-off) entries from
// _buffLandingsByTarget[pet] into _petBuffLandings[owner] so a charm-land
// "inherits" the debuffs already on the mob. Pre-charm debuff lands
// previously had no owner to attach to, so they only existed in
// _buffLandingsByTarget — Mob Info saw them, Charm tracker didn't.
function _captureTargetBuffsOnCharm(pet, owner) {
  if (!pet || !owner) return;
  const petLower   = String(pet).toLowerCase();
  const ownerLower = String(owner).toLowerCase();
  const tgtBuffs = _buffLandingsByTarget.get(petLower);
  if (!tgtBuffs || tgtBuffs.size === 0) return;
  let petBuffs = _petBuffLandings.get(ownerLower);
  if (!petBuffs) { petBuffs = new Map(); _petBuffLandings.set(ownerLower, petBuffs); }
  const now = Date.now();
  let captured = 0;
  for (const [spellKey, b] of tgtBuffs) {
    if (!b || !b.name) continue;
    if (b.worn_off_at) continue;                          // already gone
    const durSecs = (Number(b.dur_ticks) || 0) * 6;
    if (durSecs > 0 && (now - (b.landed_at || now)) / 1000 > durSecs) continue;   // expired
    // Don't clobber a more-recent pet-side entry for the same spell.
    // Tie-breaker on equal landed_at: prefer whichever has the longer
    // dur_ticks. This heals pre-v3.1.1 entries where recordPetBuffLanding
    // computed dur_ticks=0 for level-formula buffs (missing era-cap
    // fallback) — the target-side entry's correct dur_ticks wins.
    const existing = petBuffs.get(spellKey);
    if (existing) {
      const ex = existing.landed_at || 0;
      const nw = b.landed_at || 0;
      if (ex > nw) continue;
      if (ex === nw && (existing.dur_ticks || 0) >= (b.dur_ticks || 0)) continue;
    }
    petBuffs.set(spellKey, {
      name:        b.name,
      dur_ticks:   b.dur_ticks,
      dur_formula: b.dur_formula,
      landed_at:   b.landed_at,
    });
    captured++;
  }
  if (captured > 0) _savePetStateSoon();
}

// If a self charm-spell cast is staged and still fresh, return its {cls,dur}
// (consuming it) to attach to a landing charm session — else null.
function _consumePendingCharmSpell(owner, nowMs) {
  const p = _pendingCharmSpell;
  if (!p) return null;
  if ((nowMs || Date.now()) - p.ts > PENDING_CHARM_WINDOW_MS) { _pendingCharmSpell = null; return null; }
  // Owner sanity: if the cast recorded an owner, it must match the landing pet's
  // owner (case-insensitive). Gauge-land owner is the local char; log-land owner
  // resolves the same way, so this holds for self charm.
  if (p.owner && owner && String(p.owner).toLowerCase() !== String(owner).toLowerCase()) return null;
  _pendingCharmSpell = null;
  return { charm_class: p.cls, duration_sec: p.dur, charm_spell_name: p.name || null };
}

// Synthesize a "charm spell" entry in _buffLandingsByTarget so the charm shows
// as a timed DEBUFF on the pet's Mob Info card, e.g. "Allure (Hopeya)".
// Charm spells have good_effect=0 in eqemu_spells, so they naturally land in
// the debuff section of renderTargetBuffs without extra coloring logic. The
// `owner` field is rendered in parens by the Mob Info overlay so other Mimic
// users targeting the same mob can see who's charming it. Cleared when the
// charm session ends (break / re-charm refresh) by the same overwrite-by-name
// logic that handles every other landed buff.
function _recordCharmSpellOnTarget(pet, owner, spellName, durSec) {
  if (!pet || !spellName || !(durSec > 0)) return;
  const k = String(pet).toLowerCase();
  let mp = _buffLandingsByTarget.get(k);
  if (!mp) { mp = new Map(); _buffLandingsByTarget.set(k, mp); }
  const newKey = String(spellName).toLowerCase();
  const durTicks = Math.max(1, Math.round(durSec / 6));
  const landedAt = Date.now();
  // dur_ticks stored as ticks (catalog-native unit) since targetBuffsFor
  // computes durSecs as dur_ticks * 6.
  mp.set(newKey, {
    name: spellName,
    dur_ticks: durTicks,
    landed_at: landedAt,
    owner: owner ? String(owner) : null,
    is_charm_spell: true,
  });
  _savePetStateSoon();
  // Cross-client mirror: push a synthesized buff-landing event so the bot
  // stores it in buff_casts AND relays it to OTHER Mimic users targeting
  // the same pet via /api/agent/target-buffs. Without this, Allure /
  // Beguile / Charm have no cross-client visibility at all — their
  // cast_on_other is NULL, so the log path can never produce a
  // landing row.
  const spellEntry = _spellByNameLower.get(newKey) || null;
  if (typeof buffCastBuffer !== 'undefined' && Array.isArray(buffCastBuffer)) {
    buffCastBuffer.push({
      target:         String(pet),
      spell_id:       spellEntry ? (spellEntry.id || 0) : 0,
      spell_name:     spellName,
      landing_text:   '',                                 // no log line for charm
      dur_ticks:      durTicks,
      dur_formula:    spellEntry ? (spellEntry.durf || 0) : 0,
      cast_at:        new Date(landedAt).toISOString(),
      observer:       owner || null,                      // observer == caster for self-cast charm
      is_charm_spell: true,
    });
  }
}

// Reconcile the charm tracker against the LIVE Zeal pet gauge (slot 16). On
// Quarm the log signals are unreliable — charm-land only shows up when the pet
// first acks a command ("…Master"), with flavor variants that omit "Master"
// entirely ("Guarding with my life..oh splendid one."), and the break line is
// self-only with no mob name ("Your charm spell has worn off."), so our
// name-based break matcher never fires and stale charms pile up. The gauge,
// by contrast, shows the pet within ~2s of the charm landing and drops it the
// instant it breaks — and slot 16 is only ever the LOCAL client's pet, so
// attribution is unambiguous (no cross-owner mis-fire).
//
// Rule: for any character that is streaming a gauge, that gauge is authoritative
//   • an article-prefixed slot-16 pet ("a "/"an " = a charmed mob, never a
//     proper-named summoned pet) seen in two consecutive reconciles → open
//     a session (land). The two-frame debounce kills the phantom-3s-charm bug
//     where a single Zeal pulse opened a session that immediately closed —
//     users reported "BROKE Melting" cards for mobs they never charmed.
//   • an active session whose pet is no longer in that owner's slot 16 → close
//     it (break). A 3s grace avoids closing a just-opened session before the
//     gauge catches up.
// Sessions owned by characters NOT streaming a gauge (bystander charms picked
// up from zone-visible log lines) are left to the log path — untouched here.
const _pendingGaugeCharms = new Map();        // ownerLower → Map<petKey, firstSeenAt>
const GAUGE_CHARM_DEBOUNCE_MS = 1500;
function _reconcileGaugeCharms() {
  const now = Date.now();
  const gaugeOwners = new Set();              // ownerLower currently streaming a gauge
  const gaugePets   = new Map();              // ownerLower → Set(petNameLower) in slot 16
  for (const ch of Object.keys(_zealState || {})) {
    const st = _zealState[ch];
    if (!st || !Array.isArray(st.gauges) || st.gauges.length === 0) continue;
    const ownerLower = String(ch).toLowerCase();
    gaugeOwners.add(ownerLower);
    const petG = st.gauges.find(g => g && g.slot === 16 && g.text && /^an?\s+/i.test(String(g.text)));
    if (!petG) continue;
    const name = String(petG.text);
    const k = name.toLowerCase();
    if (!gaugePets.has(ownerLower)) gaugePets.set(ownerLower, new Set());
    gaugePets.get(ownerLower).add(k);
    const cur = _charmTickTracker.get(k);
    if (!cur || !cur.is_active) {
      // Debounce: require the same pet name to persist in slot 16 for at
      // least GAUGE_CHARM_DEBOUNCE_MS before opening a session. A single
      // Zeal pulse (transient slot-16 read, possibly mid-resist or target/
      // pet ambiguity) was opening 3-second phantom charms that immediately
      // broke and lingered as "BROKE" cards for mobs the user never charmed.
      let pendingByOwner = _pendingGaugeCharms.get(ownerLower);
      if (!pendingByOwner) { pendingByOwner = new Map(); _pendingGaugeCharms.set(ownerLower, pendingByOwner); }
      const firstSeen = pendingByOwner.get(k);
      if (firstSeen == null) {
        pendingByOwner.set(k, now);
      } else if ((now - firstSeen) >= GAUGE_CHARM_DEBOUNCE_MS) {
        const pc = _consumePendingCharmSpell(ch, now) || {};     // attach spell duration/class if just cast
        _bumpCharmTick(name, ch, 'land', firstSeen, pc);         // gauge-sourced land, anchor to first sighting
        pendingByOwner.delete(k);
      }
    } else {
      // Already active — clear any stale pending entry so a re-charm after
      // a break still requires its own two-frame debounce.
      _pendingGaugeCharms.get(ownerLower)?.delete(k);
      // Refresh last_tick_at as a "still alive" signal from the gauge — keeps
      // the break detector below from firing during a long gap between actual
      // 6s mob ticks (e.g. between encounters).
      cur.last_tick_at = now;
    }
  }
  // Drop pending entries whose pet is no longer in slot 16 (transient pulse).
  for (const [ownerLower, pending] of _pendingGaugeCharms) {
    const liveSet = gaugePets.get(ownerLower);
    for (const k of pending.keys()) {
      if (!liveSet || !liveSet.has(k)) pending.delete(k);
    }
    if (pending.size === 0) _pendingGaugeCharms.delete(ownerLower);
  }
  for (const [k, info] of _charmTickTracker) {
    if (!info.is_active || !info.owner) continue;
    const ol = String(info.owner).toLowerCase();
    if (!gaugeOwners.has(ol)) continue;                       // bystander → log-managed
    const set = gaugePets.get(ol);
    // Grace 10s: an enchanter re-charming the SAME pet removes it from slot
    // 16 for the duration of the charm spell (3.5-4s) plus reconciler lag —
    // the previous 3s threshold fired a false 'break' during normal cycling,
    // which made the overlay speak 'recharm pet' even though the same mob got
    // re-charmed seconds later. 10s easily covers a normal re-cast while a
    // real break (gauge never returns) still fires promptly.
    if ((!set || !set.has(k)) && (now - (info.last_tick_at || 0)) > 10000) {
      _bumpCharmTick(info.pet, info.owner, 'break', now);     // gauge dropped → break (alert fires now)
    }
  }
  // Drop broken pets that have lingered past the grace window — the overlay keeps
  // showing them until here so the tick counter stays up after a break.
  for (const [k, info] of _charmTickTracker) {
    if (!info.is_active && info.broke_at && (now - info.broke_at) > PET_LINGER_MS) {
      _charmTickTracker.delete(k);
    }
  }
}

// ── Bard melody tracker ────────────────────────────────────────────────────
// Goal: a per-character ordered melody (the songs in /melody slot order) +
// the currently-casting position, so the overlay can render a vertical list
// where each song row shows: ▶ play icon · song name · casting bar. As the
// bard twists through the rotation, the "currently casting" indicator walks
// down the list; when they stop singing, the indicator freezes on the last
// position as a ⏹ "resume here" marker.
//
// Storage: characterLower → {
//   order:           [songName, …]   // in CAST order; first sing seeds slot 0
//   currentPos:      number          // index into `order` of the song most
//                                    //   recently begun (the one casting)
//   castStartedAt:   number          // ms when the current cast began
//   cycleLength:     number          // 0 until we detect a repeat, then the
//                                    //   melody length (2..MELODY_CAP)
//   lastChangeAt:    number          // last sing event — also drives the
//                                    //   "idle" / "stopped" overlay state
// }
//
// Cycle detection: bards on Quarm twist 2-5 songs. When a song that's
// already in `order` is sung again, we know the cycle has wrapped — that
// repeat sets cycleLength to the current order length and the renderer
// shifts to a stable looping view (the indicator hops back to that slot).
// Brand-new songs after cycle detection (the bard added/removed from
// /melody) reset the order so the display tracks the new rotation.
const _bardMelody = new Map();
const MELODY_CAP     = 5;       // Quarm max /melody size
const MELODY_IDLE_MS = 30_000;  // drop overlay when no sing for 30s

// Song → buff-window-name aliases for songs whose landed effect is reported
// in the buff window under a DIFFERENT name than what the bard sang. Add as
// the guild surfaces them — the overlay matches by song name first, then
// falls back to this table, so direct-match songs (Amplification,
// Harmonize, etc.) need no entries.
const SONG_BUFF_ALIASES = new Map([
  ["niv's melody of preservation", "breath of harmony"],
  ["niv`s melody of preservation", "breath of harmony"],   // backtick variant some clients emit
]);
function _findSongBuff(songName, zealBuffs) {
  if (!songName || !Array.isArray(zealBuffs) || zealBuffs.length === 0) return null;
  const sLow = String(songName).toLowerCase();
  const alias = SONG_BUFF_ALIASES.get(sLow);
  for (const b of zealBuffs) {
    if (!b || !b.name) continue;
    const bLow = String(b.name).toLowerCase();
    if (bLow === sLow) return b;
    if (alias && bLow === alias) return b;
  }
  return null;
}
// Detect a bard song by name pattern. Bard songs almost always start with a
// possessive of one of the canonical author-NPCs ("Selo`s", "Solon`s",
// "Tarew`s", etc.) or with one of the named song lines ("Anthem de Arms",
// "Composition of Ervaj", "Warsong of the Vah Shir", etc.). Used to flip
// state.kind = 'song' once we see ANY bard song, sticking the bard
// classification for the rest of the session so bardBuffs render correctly
// for /melody users without us having to query Zeal class data.
function _isLikelyBardSong(name) {
  if (!name) return false;
  const s = String(name);
  if (/^(?:Selo|Solon|Tarew|Tuyen|Denon|McVaxius|Niv|Brusco|Angstlich|Cassindra|Kelin|Largo|Jonthan)['`]/i.test(s)) return true;
  if (/^(?:Anthem|Composition|Warsong|Accelerando|Accelerating Chorus|Ancient|Hymn|Verses of|Spirit of Wolf|Nature['`]s Melody|Amplification|Resonance|Harmonize|Vilia['`]s Verses)/i.test(s)) return true;
  if (/(?:Chant of|Chord|Chorus|Dirge|Ditty|Drums of|Marching Song|Song of)/i.test(s)) return true;
  return false;
}
function _bumpBardMelody(character, spellName, atMs, opts) {
  if (!character || !spellName) return;
  // Auto-detect bard from the song name when the caller didn't explicitly
  // say. Once we tag a character as 'song', it sticks for the rest of the
  // session (bards don't morph into wizards mid-fight).
  let kind = (opts && opts.kind) || 'song';
  if (_isLikelyBardSong(spellName)) kind = 'song';
  const key = String(character).toLowerCase();
  let state = _bardMelody.get(key);
  if (!state) {
    state = { order: [], currentPos: -1, castStartedAt: atMs, cycleLength: 0, lastChangeAt: atMs, kind };
    _bardMelody.set(key, state);
  }
  // If we haven't cast in MELODY_IDLE_MS, treat this as a brand-new melody
  // (zoned / stopped / swapped). Avoids merging two unrelated rotations.
  if (state.lastChangeAt && (atMs - state.lastChangeAt) > MELODY_IDLE_MS) {
    state.order = [];
    state.currentPos = -1;
    state.cycleLength = 0;
  }
  // Track the current melody kind on the character's state. Once a bard,
  // always a bard for this character — never downgrade 'song' → 'spell' on
  // subsequent casts since a bard's interludes (clickies, items) might
  // briefly look spell-like by name.
  if (state.kind !== 'song' || kind === 'song') state.kind = kind;
  const name = String(spellName);
  const lower = name.toLowerCase();
  // Item-clicky cast-time override. If we saw "Your <item> begins to glow"
  // for this character within CLICKY_WINDOW_MS, the cast that's starting
  // now is from that clicky and should use the ITEM's casttime instead of
  // the underlying spell's. Consume the pending clicky on use so it can't
  // attach to a later, unrelated cast.
  let clickyCastMs = null;
  const pending = _pendingClickies.get(key);
  if (pending && (atMs - pending.atMs) <= CLICKY_WINDOW_MS) {
    if (typeof pending.castMs === 'number' && pending.castMs > 0) clickyCastMs = pending.castMs;
    _pendingClickies.delete(key);
  } else if (pending) {
    _pendingClickies.delete(key);   // expired, drop
  }
  const existingIdx = state.order.findIndex(o => o && (o.name || '').toLowerCase() === lower);
  if (existingIdx >= 0) {
    if (state.cycleLength === 0) state.cycleLength = state.order.length;
    state.currentPos = existingIdx;
    state.order[existingIdx].kind = kind;
    if (clickyCastMs) state.order[existingIdx].cast_ms = clickyCastMs;
  } else {
    if (state.order.length >= MELODY_CAP) state.order.shift();
    const entry = { name, kind };
    if (clickyCastMs) entry.cast_ms = clickyCastMs;
    state.order.push(entry);
    state.currentPos = state.order.length - 1;
  }
  state.castStartedAt = atMs;
  state.lastChangeAt  = atMs;
  state.castInterrupted = false;   // a new cast clears any prior interrupt flag
}

// Charm pet DEATH — remove the lingering pet immediately (per "unless the pet
// dies or 5 minutes pass"). Charm pets keep their mob name, so a slain line
// names them: "You have slain a fungoid sporeling!" / "A fungoid sporeling has
// been slain by Xxch." Returns true if a tracked pet was removed.
//
// EXACT NAME MATCH (not substring): two same-named NPCs in zone (e.g. "An
// Enthralled Razorfiend" in Sebilis — multiples coexist) used to false-positive
// because the slain line for the OTHER mob contained the pet name as a
// substring, removing the still-charmed pet from the tracker. Now we capture
// the slain name + killer explicitly.
//
// KILLER GUARD: we don't kill our own charmed pet — they're friendly to us. If
// the killer is a watched character / known player, the slain mob is a
// DIFFERENT same-named NPC, NOT our pet. (If charm had actually broken first,
// the charm_break event would have removed the pet BEFORE we got here.)
const _SLAIN_BY_RX  = /\]\s+(.+?)\s+has been slain by\s+(.+?)\.?\s*$/i;
const _SLAIN_YOU_RX = /\]\s+You have slain\s+(.+?)\.?\s*$/i;
function checkCharmPetDeath(line, character) {
  if (!line) return false;
  let slainName = null, killerName = null;
  let m = line.match(_SLAIN_BY_RX);
  if (m) { slainName = m[1].trim(); killerName = m[2].trim(); }
  else {
    m = line.match(_SLAIN_YOU_RX);
    if (m) { slainName = m[1].trim(); killerName = character || 'you'; }
  }
  if (!slainName) return false;
  const slainKey = slainName.toLowerCase();
  if (!_charmTickTracker.has(slainKey)) return false;
  if (killerName && isConfirmedPlayer(killerName)) return false;
  _charmTickTracker.delete(slainKey);
  return true;
}

// ── /pet health report state (Quarm format) ─────────────────────────────────
// On Quarm `/pet health` prints to YOUR OWN log with NO speaker wrapper, NO pet
// name, and NO durations — just a standalone HP line then one bare buff NAME per
// line:
//   [ts] I have 100 percent of my hit points left.
//   [ts] Storm Strength
//   [ts] Spirit of Wolf
// So we assemble a pet view from THREE sources:
//   • /pet health  → the current buff SET (names, no timer) + HP
//   • Zeal slot 16 → the pet's NAME + live HP
//   • buff LANDINGS ("<Pet> looks stronger." → catalog duration) → the TIMERS
// merged by spell name in petBuffsForOwner(). Per-owner attribution: only the
// owner's own log carries their pet's /pet health, and a landing's target only
// counts if it matches that owner's live pet name.
const _petHealthByOwner = new Map();   // ownerLower → { hp_pct, buffs: Map<spellLower,{name,dur_ticks,dur_formula}>, last_line_at, last_seen_at }
const _petBuffLandings  = new Map();   // ownerLower → Map<spellLower,{name,dur_ticks,dur_formula,landed_at}>
// Pet TARGET — what each owner's pet is currently attacking. Populated by the
// "Attacking X Master." command ack (only visible to the controlling player).
// TTL'd so a pet that hasn't re-ack'd recently doesn't show a stale target.
const _petTargetByOwner = new Map();   // ownerLower → { target, at }
const PET_TARGET_TTL_MS = 60_000;

// Per-pet attack observation. Keyed by owner; tracks the CURRENT pet's combat
// signature so we can show "Smohur · 105 max / 67 avg · 142 hits · Slashing +
// Crushing (dual-wield)" on the Pet tracker. Skills come from the EQ combat
// verb on each damage event (slashes/pierces/crushes/bashes/hits/punches/
// claws/bites/gores/mauls/stings), aggregated as { count, total, max } per
// normalized skill. Multiple distinct skills observed = dual-wielding two
// different weapon types (the inverse — dual-wielding two SAME-skill weapons —
// is harder to detect, but the high hits-per-fight rate hints at it).
//
// LOCAL ONLY — never uploaded to the bot. Persisted to disk so a LD reconnect
// or agent restart brings the running stats back. Keyed on (owner, pet) so a
// re-summon under a different name starts fresh.
const _petStatsByOwner  = new Map();   // ownerLower → { pet, skills:{[skill]:{count,total,max}}, totalHits, totalDamage, maxHit, firstSeenAt, lastSeenAt }

// EQ damage verb → skill bucket. Plural/singular collapse so 'slash'/'slashes'
// both count as Slashing. Generic 'hits' (1H blunt + h2h) is its own bucket
// because we can't tell apart 1HB and H2H from the verb alone.
const _PET_VERB_SKILL = {
  slash:'Slashing', slashes:'Slashing',
  pierce:'Piercing', pierces:'Piercing',
  crush:'Crushing', crushes:'Crushing',
  bash:'Bash', bashes:'Bash',
  kick:'Kick', kicks:'Kick',
  punch:'H2H', punches:'H2H',
  hit:'Hits', hits:'Hits',
  bite:'Bite', bites:'Bite',
  claw:'Claw', claws:'Claw',
  gore:'Gore', gores:'Gore',
  maul:'Maul', mauls:'Maul',
  sting:'Sting', stings:'Sting',
  slice:'Slashing', slices:'Slashing',
  smash:'Crushing', smashes:'Crushing',
};
function _verbToSkill(v) {
  if (!v) return null;
  return _PET_VERB_SKILL[String(v).toLowerCase().trim()] || null;
}

// Record one melee-damage event the pet just landed. character = log file's
// identity; ev.attacker matches one of our pets via _petOwnerByName / Zeal slot
// 16. Maintains the per-pet rollup + bumps the disk-save timer.
function recordPetCombat(ev, character) {
  if (!ev || ev.type !== 'damage' || !ev.attacker || !ev.amount) return;
  const petLower = String(ev.attacker).toLowerCase();
  const owner = _petOwnerByName(petLower);
  if (!owner) return;                                       // attacker isn't one of our pets
  const skill = _verbToSkill(ev.ability);
  if (!skill) return;                                       // not melee (skip nukes/DoTs/non-melee)
  const amount = Math.max(0, Math.trunc(Number(ev.amount) || 0));
  if (amount <= 0) return;
  const now = Date.now();
  let s = _petStatsByOwner.get(owner);
  if (!s || s.pet !== ev.attacker) {
    // New pet (or first sight) — fresh row. Re-summoned pets with a different
    // proper name reset stats; a same-name re-summon keeps them rolling (we
    // can't tell same-pet from same-named-replacement from the log).
    s = { pet: ev.attacker, skills: {}, totalHits: 0, totalDamage: 0, maxHit: 0,
          firstSeenAt: now, lastSeenAt: now };
    _petStatsByOwner.set(owner, s);
  }
  const sk = s.skills[skill] || { count: 0, total: 0, max: 0 };
  sk.count += 1; sk.total += amount; if (amount > sk.max) sk.max = amount;
  s.skills[skill] = sk;
  s.totalHits += 1; s.totalDamage += amount;
  if (amount > s.maxHit) s.maxHit = amount;
  s.lastSeenAt = now;
  _savePetStateSoon();
}

// ── Pet-state persistence (disk) ─────────────────────────────────────────────
// Survives agent restarts + LD reconnects: the agent loses in-memory pet state
// every restart, but the pet itself usually still has its buffs (pets persist
// through LD; summoned pets DESPAWN on log off, in which case the TTL drops
// stale data). On startup we load this once; on every state change we debounce
// a save (5s window) so a chatty fight doesn't write the file 100x.
const PET_STATE_FILE = path.join(__dirname, 'logsync.pet-state.json');
const PET_STATE_SAVE_DEBOUNCE_MS = 5000;
let _petStateSaveTimer = null;

function _savePetStateSoon() {
  if (_petStateSaveTimer) return;
  _petStateSaveTimer = setTimeout(() => {
    _petStateSaveTimer = null;
    try {
      const data = {
        saved_at: new Date().toISOString(),
        // Maps + nested Maps serialize as arrays so the round-trip is loss-less.
        petHealthByOwner: [..._petHealthByOwner.entries()].map(([k, v]) => [k, {
          hp_pct: v.hp_pct,
          buffs: [...v.buffs.entries()],
          last_line_at: v.last_line_at,
          last_seen_at: v.last_seen_at,
        }]),
        petBuffLandings: [..._petBuffLandings.entries()].map(([k, v]) => [k, [...v.entries()]]),
        // Mob Info target buffs (any mob/PC we've timed a land on) — same shape
        // as petBuffLandings so the Mob Info overlay survives a restart too.
        buffLandingsByTarget: [..._buffLandingsByTarget.entries()].map(([k, v]) => [k, [...v.entries()]]),
        petStatsByOwner: [..._petStatsByOwner.entries()],
      };
      const out = JSON.stringify(data);
      fs.writeFileSync(PET_STATE_FILE + '.tmp', out);
      fs.renameSync(PET_STATE_FILE + '.tmp', PET_STATE_FILE);
    } catch (err) { console.warn('[pet-state] save failed:', err && err.message); }
  }, PET_STATE_SAVE_DEBOUNCE_MS);
}

function _loadPetStateFromDisk() {
  try {
    if (!fs.existsSync(PET_STATE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(PET_STATE_FILE, 'utf8'));
    const now = Date.now();
    if (Array.isArray(raw.petHealthByOwner)) {
      for (const [k, v] of raw.petHealthByOwner) {
        if (!v || typeof v !== 'object') continue;
        // TTL — drop entries older than the live cutoff (30 min). Stale buff
        // numbers are worse than no chips at all.
        if ((now - (v.last_seen_at || 0)) > PET_HEALTH_TTL_MS) continue;
        _petHealthByOwner.set(k, {
          hp_pct: v.hp_pct, buffs: new Map(v.buffs || []),
          last_line_at: v.last_line_at, last_seen_at: v.last_seen_at,
        });
      }
    }
    if (Array.isArray(raw.petBuffLandings)) {
      for (const [k, arr] of raw.petBuffLandings) {
        const mp = new Map();
        for (const [bk, bv] of (arr || [])) {
          // Drop landings past their duration + the 5-min fell-off linger, so a
          // just-expired buff still shows its purple rebuff cue after a restart.
          const durSecs = (Number(bv.dur_ticks) || 0) * 6;
          if (durSecs > 0 && (now - (bv.landed_at || 0)) > durSecs * 1000 + FELL_OFF_LINGER_MS) continue;
          mp.set(bk, bv);
        }
        if (mp.size) _petBuffLandings.set(k, mp);
      }
    }
    if (Array.isArray(raw.buffLandingsByTarget)) {
      for (const [k, arr] of raw.buffLandingsByTarget) {
        const mp = new Map();
        for (const [bk, bv] of (arr || [])) {
          // Same prune as pet landings: duration + the 5-min fell-off linger, so
          // Mob Info keeps the purple rebuff cue across a restart but never shows
          // a stale countdown beyond that.
          const durSecs = (Number(bv.dur_ticks) || 0) * 6;
          if (durSecs > 0 && (now - (bv.landed_at || 0)) > durSecs * 1000 + FELL_OFF_LINGER_MS) continue;
          mp.set(bk, bv);
        }
        if (mp.size) _buffLandingsByTarget.set(k, mp);
      }
    }
    if (Array.isArray(raw.petStatsByOwner)) {
      // Stats keep indefinitely (running performance picture across sessions).
      for (const [k, v] of raw.petStatsByOwner) _petStatsByOwner.set(k, v);
    }
    console.log(`[pet-state] restored from disk: ${_petHealthByOwner.size} health · ${_petBuffLandings.size} pet landings · ${_buffLandingsByTarget.size} target landings · ${_petStatsByOwner.size} stats`);
  } catch (err) { console.warn('[pet-state] load failed:', err && err.message); }
}
const PET_HEALTH_TTL_MS = 30 * 60 * 1000;
const PET_REPORT_GAP_MS = 6000;        // bare buff lines within 6s of the HP line belong to that report

// Standalone HP line (no speaker). Quarm: "I have 100 percent of my hit points
// left." Modern: "I have 100% of my hit points."
const _PET_HP_RX = /^I have (\d+)(?:%| percent) of my hit points(?:\s+left)?\.?$/i;

// Feed one log line through the /pet health state machine for `character` (the
// owner). Stateful: an HP line opens a report; subsequent bare lines that name a
// known timed buff join it until the 6s window lapses.
function applyPetHealthLine(line, character) {
  if (!line || !character) return;
  const m = line.match(/^\[(.+?)\]\s+(.*)$/);
  if (!m) return;
  const owner = String(character).toLowerCase();
  const ts = parseEqTimestamp(line);
  const tsMs = ts ? ts.getTime() : Date.now();
  const body = m[2].trim();
  const hp = body.match(_PET_HP_RX);
  if (hp) {
    _petHealthByOwner.set(owner, {
      hp_pct: parseInt(hp[1], 10), buffs: new Map(),
      last_line_at: tsMs, last_seen_at: Date.now(),
    });
    _savePetStateSoon();
    return;
  }
  const rep = _petHealthByOwner.get(owner);
  if (!rep) return;                                                 // not inside a report
  if ((tsMs - (rep.last_line_at || 0)) > PET_REPORT_GAP_MS) return; // window lapsed
  // A bare line that names a known spell → a pet buff. Gating on the catalog
  // keeps random chatter out: only real spell names match. We deliberately do
  // NOT require a timed-formula duration here — some real buffs report dur=0
  // with a formula-only duration (formula 7, etc.), and a stale v1 disk catalog
  // (no dur/durf yet) would otherwise drop every chip. The actual countdown
  // still comes from observed buff landings; this just captures the NAME so the
  // chip appears in the overlay (with "?" until a landing supplies the timer).
  const e = _spellByNameLower.get(body.toLowerCase());
  if (e) {
    rep.buffs.set(body.toLowerCase(), { name: e.name, dur_ticks: e.dur || null, dur_formula: e.durf || null });
    rep.last_line_at = tsMs;
    rep.last_seen_at = Date.now();
    _savePetStateSoon();
  }
}

// pet name → owner (lowercased), from Zeal gauge slot 16 for watched chars.
// Summoned pets carry a proper name in slot 16, which is how we know "Jareker
// looks stronger." is OUR pet getting buffed (vs another player).
function _petOwnerByName(petLower) {
  if (!petLower) return null;
  // Charm-tracker first — debounced and authoritative for charm pets, and it
  // survives the brief slot-16 dropouts that happen during a re-charm cast
  // (~3s window). Without this fallback, recordPetBuffLanding misses any buff
  // landing that coincides with that window, and the pet's buffs stay
  // "(fell off — rebuff)" on the Charm tracker even after a fresh recast.
  const ct = _charmTickTracker.get(petLower);
  if (ct && ct.is_active && ct.owner) return String(ct.owner).toLowerCase();
  for (const ch of Object.keys(_zealState)) {
    const st = _zealState[ch];
    if (!st || !Array.isArray(st.gauges)) continue;
    const pet = st.gauges.find(g => g && g.slot === 16 && g.text);
    if (pet && String(pet.text).toLowerCase() === petLower) return String(ch).toLowerCase();
  }
  return null;
}

// EQ buff-duration formula → ticks for a given caster level, capped at the
// spell's buffduration. Mirrors EQEmu's CalcBuffDuration_formula. Confirmed
// in-game: formula 7 = level (Boon of the Garou 60 ticks @ L60), formula 8 =
// level+10 (Boltran's Agacerie 70 ticks @ L60). For long/odd formulas the cap
// dominates anyway, and an unknown level falls back to the cap (= spell max,
// the accepted fallback). Capping means any formula we get slightly wrong
// degrades to "max", never to an over-long timer beyond the spell's own cap.
// Assumed caster level for duration estimates when the real caster level is
// unknown (raider-cast debuffs especially). PoP era (unlocks 2026-10-01) raises
// the cap to 65; before that the cap is 60. Gives a realistic FLOOR duration via
// the spell formula instead of falling back to the spell's absolute max.
const _POP_UNLOCK_MS = Date.parse('2026-10-01T00:00:00Z');
function _assumedCasterLevel() {
  return (Date.now() >= _POP_UNLOCK_MS) ? 65 : 60;
}
// After a tracked buff/debuff falls off (timer expired OR an explicit "worn off"
// line), keep showing it this long with a purple "fell off" highlight as a
// rebuff cue, then drop it. Applies to the Pet tracker + Mob Info overlays.
const FELL_OFF_LINGER_MS = 5 * 60 * 1000;
function _durTicksForLevel(formula, capTicks, level) {
  const cap = Number(capTicks) || 0;
  const lvl = Number(level) || 0;
  const f   = Number(formula) || 0;
  if (f === 50 || f === 51) return cap || 72000;   // permanent / until-fade
  if (!lvl || !f) return cap;                       // no level → spell max
  let t;
  switch (f) {
    case 1:  t = Math.ceil(lvl / 2);      break;
    case 2:  t = Math.ceil(lvl / 2) + 5;  break;
    case 3:  t = lvl * 30;                break;
    case 4:  t = cap || 50;               break;
    case 5:  t = 2;                        break;
    case 6:  t = Math.ceil(lvl / 2);      break;
    case 7:  t = lvl;                      break;
    case 8:  t = lvl + 10;                break;
    case 9:  t = lvl * 2 + 10;            break;
    case 10: t = lvl * 3 + 10;            break;
    case 11: t = (lvl + 3) * 30;          break;
    case 12: t = Math.ceil(lvl / 4);      break;
    default: return cap;
  }
  if (!(t > 0)) return cap;
  if (cap > 0 && t > cap) t = cap;        // never exceed the spell's own cap
  return t;
}

// A buff landing we already detected (parseBuffLanding) — if its target is one
// of our pets, stamp landed_at so the Pet tracker can count it down from the
// spell's duration. The caster of a buff on YOUR pet is you (the owner), so we
// scale the spell's formula by the owner's known level for an accurate
// countdown (falling back to the spell's max when we don't know it yet).
// Re-cast refreshes landed_at.
function recordPetBuffLanding(bcEvt) {
  if (!bcEvt || !bcEvt.spell_name || !bcEvt.target) return;
  const owner = _petOwnerByName(String(bcEvt.target).toLowerCase());
  if (!owner) return;
  let mp = _petBuffLandings.get(owner);
  if (!mp) { mp = new Map(); _petBuffLandings.set(owner, mp); }
  // Caster level for duration scaling: prefer the owner's real /who level,
  // fall back to the era cap (60 in Luclin, 65 in PoP) when whoData is empty.
  // Without this fallback, level-driven formulas (Boon of the Garou = formula
  // 7, t = lvl) compute t = 0 — which makes the buff land "already expired"
  // → the Charm tracker immediately shows it as "fell off — rebuff" even
  // while Mob Info (which already uses the era-cap fallback in
  // recordTargetBuffLanding) shows it ticking down correctly.
  const ownerLevel = (whoData.get(owner) || {}).level || _assumedCasterLevel();
  const durTicks   = _durTicksForLevel(bcEvt.dur_formula, bcEvt.dur_ticks, ownerLevel);
  const newKey     = String(bcEvt.spell_name).toLowerCase();
  // Slot-based overwrite — if the new buff has a known category (haste / hp /
  // runSpeed / etc.) drop any existing entry in the same category, including
  // its 'fell off' linger. Mirrors EQ's slot-replacement rule: e.g. Spirit of
  // Wolf overwrites Journeyman's Boots (both runSpeed). Skip if uncategorized.
  const newCat = _categorizeBuff(bcEvt.spell_name);
  if (newCat) {
    for (const [k, b] of mp) {
      if (k === newKey) continue;
      if (_categorizeBuff(b && b.name) === newCat) mp.delete(k);
    }
  }
  mp.set(newKey, {
    name: bcEvt.spell_name,
    dur_ticks: durTicks,
    dur_formula: bcEvt.dur_formula,
    landed_at: bcEvt.cast_at ? Date.parse(bcEvt.cast_at) : Date.now(),
  });
  _savePetStateSoon();
}

// Merge a pet's buffs from the /pet health name set + the landing timers, keyed
// by spell name. Returns [{ name, remaining_secs|null, observed_at_ms }] for the
// overlay. A landing's catalog duration gives the countdown (no-focus floor —
// duration-extension focuses only make it last longer); a /pet-health-only buff
// shows its name with no timer.
// good_effect for a spell name (1 = buff, 0 = debuff, null = unknown / catalog
// not yet enriched). Drives buff=green / debuff=red coloring in the overlays.
function _spellGood(name) {
  const e = _spellByNameLower.get(String(name || '').toLowerCase());
  return (e && e.good != null) ? (Number(e.good) ? 1 : 0) : null;
}
// Minimal buff categorizer — KEEP IN SYNC with utils/raidBuffs.js and
// web/lib/buffs.ts. Used by the agent for slot-based overwrite: a new buff
// landing in the same category as an existing one means the previous slot
// occupant is replaced (e.g. Spirit of Wolf overwrites Journeyman's Boots,
// both runSpeed). Also distinguishes HoTs (regen) from long-duration buffs
// so HoTs don't get the 5-min 'fell off' linger.
const _BUFF_KEYWORDS = {
  hp:        ['aegolism','symbol of','temperance','hand of conviction','blessing of','brell','riotous health','inner fire','courage','daring','bravery','valor','resolution','heroic bond','virtue','health','center','fortitude'],
  regen:     ['regrowth','regenerat','chloroplast','replenish','pack regen','celestial health','celestial healing','celestial elixir'],
  mana:      ['brilliance','iridescence','gift of brilliance'],
  manaRegen: ['clarity','koadic','endless intellect','breeze','clairvoyance','gift of insight','gift of pure thought','auspice'],
  haste:     ['haste','celerity','quickness','swift','speed of','augmentation','alacrity','aanya','battle cry','warsong','verses of victory','visions of grandeur'],
  runSpeed:  ['spirit of wolf','spirit of the wolf','flight of eagle','pack spirit','selo','journeyman','run speed','spirit of the shrew'],
  attack:    ['strength','avatar','ferocity','champion','primal','war march','savage','brutal','might of','tumultuous','aggression','bull','call of the predator','feral avatar','ancient: feral'],
  ds:        ['thorn','thistle','shield of fire','shield of lava','bramblecoat','damage shield','legacy of','shield of barbs'],
};
const _BUFF_CAT_ORDER = ['hp', 'regen', 'mana', 'manaRegen', 'haste', 'runSpeed', 'attack', 'ds'];
function _categorizeBuff(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  for (const cat of _BUFF_CAT_ORDER) {
    for (const k of _BUFF_KEYWORDS[cat]) if (n.includes(k)) return cat;
  }
  return null;
}
// True if the buff is a heal-over-time / regen buff — these get NO 5-min
// linger when they expire (per user feedback: 'Heals over time should fall
// off within a tick'). Other expired buffs still linger as a rebuff cue.
function _isHotBuff(name) { return _categorizeBuff(name) === 'regen'; }
function petBuffsForOwner(ownerLower) {
  if (!ownerLower) return [];
  const now = Date.now();
  const byName = new Map();
  const rep = _petHealthByOwner.get(ownerLower);
  if (rep && (now - (rep.last_seen_at || 0)) <= PET_HEALTH_TTL_MS) {
    for (const [k, b] of rep.buffs) byName.set(k, { name: b.name, remaining_secs: null, observed_at_ms: rep.last_seen_at, good: _spellGood(b.name) });
  }
  const lm = _petBuffLandings.get(ownerLower);
  if (lm) {
    for (const [k, b] of lm) {
      const durSecs = (Number(b.dur_ticks) || 0) * 6;
      let rem = durSecs - (now - (b.landed_at || now)) / 1000;
      let fellOff = false;
      // HoTs (regen category) get a 6s (one-tick) linger; everything else gets
      // the 5-min rebuff cue. HoTs are short and re-applied frequently — a
      // long-lingering 'fell off' is noise, not signal.
      // Stuns + other sub-minute effects (Color Flux 12s, mez breakers, instant
      // procs) don't deserve the 5-min "fell off — rebuff" cue — you don't
      // rebuff a stun, you re-stun. Cap the linger at one tick (6s) for any
      // catalog-duration < 60s, same as HoTs.
      const _shortFx = ((Number(b && b.dur_ticks) || 0) * 6) > 0 && ((Number(b && b.dur_ticks) || 0) * 6) < 60;
      const lingerMs = (_isHotBuff(b && b.name) || _shortFx) ? 6_000 : FELL_OFF_LINGER_MS;
      if (b.worn_off_at) {                                   // explicit "worn off"
        if (now - b.worn_off_at > lingerMs) { lm.delete(k); continue; }
        fellOff = true; rem = 0;
      } else if (rem <= 0) {                                 // natural expiry
        if (rem < -(lingerMs / 1000)) { lm.delete(k); continue; }
        fellOff = true; rem = 0;
      }
      // total_secs lets the overlay draw a proportional countdown BAR (not just
      // a chip); remaining_secs is the live number on it. fell_off drives the
      // 5-min purple rebuff cue.
      byName.set(k, { name: b.name, remaining_secs: Math.max(0, Math.round(rem)),
        total_secs: durSecs > 0 ? Math.round(durSecs) : null, observed_at_ms: now, good: _spellGood(b.name), fell_off: fellOff });
    }
  }
  return Array.from(byName.values());
}

// Observed buff landings keyed by the TARGET name (any mob OR player), for the
// Mob Info / target overlay's "buffs on this target" view. Same idea as
// _petBuffLandings but not restricted to our pets — when we (or anyone we can
// see) land a tracked buff on a target, we time it from the cast. Caster level
// is unknown for arbitrary targets, so we scale by the target's own level when
// we know it (covers self-buffs / our pet, the common cases) and fall back to
// the spell's max otherwise.
const _buffLandingsByTarget = new Map();   // targetLower → Map<spellLower,{name,dur_ticks,landed_at}>
function recordTargetBuffLanding(bcEvt) {
  if (!bcEvt || !bcEvt.spell_name || !bcEvt.target) return;
  const k = String(bcEvt.target).toLowerCase();
  let mp = _buffLandingsByTarget.get(k);
  if (!mp) { mp = new Map(); _buffLandingsByTarget.set(k, mp); }
  // Best-effort caster level for the duration estimate:
  //   • DEBUFF (good===0) on a target — cast by a raider whose level we don't
  //     track at land time. Assume the era level cap (_assumedCasterLevel:
  //     60 now, 65 once PoP unlocks) so we show a realistic FLOOR duration
  //     instead of the spell's absolute max.
  //   • BUFF — our pet → the owner cast it; else a self-buff → the target's own
  //     observed level. Fall back to the assumed cap when we have no level.
  const good = _spellGood(bcEvt.spell_name);
  let lvl;
  if (good === 0) {
    lvl = _assumedCasterLevel();
  } else {
    const petOwner = _petOwnerByName(k);
    lvl = petOwner ? ((whoData.get(petOwner) || {}).level || null)
                   : ((whoData.get(k) || {}).level || null);
    if (!lvl) lvl = _assumedCasterLevel();
  }
  const newKey = String(bcEvt.spell_name).toLowerCase();
  // Slot-based overwrite (same logic as recordPetBuffLanding) — a new buff in
  // a known category drops the previous slot occupant, including its 'fell
  // off' linger. EQ's slot rule: e.g. Spirit of Wolf lands → Journeyman's
  // Boots gone. Uncategorized buffs leave existing entries alone.
  const newCat = _categorizeBuff(bcEvt.spell_name);
  if (newCat) {
    for (const [k2, b] of mp) {
      if (k2 === newKey) continue;
      if (_categorizeBuff(b && b.name) === newCat) mp.delete(k2);
    }
  }
  mp.set(newKey, {
    name: bcEvt.spell_name,
    dur_ticks: _durTicksForLevel(bcEvt.dur_formula, bcEvt.dur_ticks, lvl),
    landed_at: bcEvt.cast_at ? Date.parse(bcEvt.cast_at) : Date.now(),
  });
  // Bound memory: keep the 400 most-recently-touched targets.
  if (_buffLandingsByTarget.size > 400) {
    const oldest = _buffLandingsByTarget.keys().next().value;
    if (oldest && oldest !== k) _buffLandingsByTarget.delete(oldest);
  }
  // Persist so Mob Info target buffs survive an agent/Mimic restart (same disk
  // file as the pet state, debounced).
  _savePetStateSoon();
}
// Live observed buffs for a target → [{ name, remaining_secs, total_secs }],
// pruning expired. Drives the Mob Info overlay's buff list.
function targetBuffsFor(targetLower) {
  if (!targetLower) return [];
  const mp = _buffLandingsByTarget.get(targetLower);
  if (!mp) return [];
  const now = Date.now();
  const out = [];
  for (const [k, b] of mp) {
    const durSecs = (Number(b.dur_ticks) || 0) * 6;
    let rem = durSecs - (now - (b.landed_at || now)) / 1000;
    let fellOff = false;
    // HoTs (regen category) get a 6s (one-tick) linger; everything else gets
    // the 5-min rebuff cue. Same rationale as petBuffsForOwner above.
    const lingerMs = _isHotBuff(b && b.name) ? 6_000 : FELL_OFF_LINGER_MS;
    if (b.worn_off_at) {                                     // explicit "worn off"
      if (now - b.worn_off_at > lingerMs) { mp.delete(k); continue; }
      fellOff = true; rem = 0;
    } else if (rem <= 0) {                                   // natural expiry
      if (rem < -(lingerMs / 1000)) { mp.delete(k); continue; }
      fellOff = true; rem = 0;
    }
    // Charm-spell entries carry the owner name so Mob Info can render
    // "Allure (Hopeya)" — the only path for tracking a charm whose
    // cast_on_other is NULL in the catalog. Always treat as a debuff
    // (good=0) so it lands in the Debuff section regardless of catalog
    // lookup.
    const isCharm = !!(b && b.is_charm_spell);
    out.push({ name: b.name, remaining_secs: Math.max(0, Math.round(rem)),
      total_secs: durSecs > 0 ? Math.round(durSecs) : null, observed_at_ms: b.landed_at,
      good: isCharm ? 0 : _spellGood(b.name), fell_off: fellOff,
      owner: (b && b.owner) ? b.owner : null });
  }
  if (mp.size === 0) _buffLandingsByTarget.delete(targetLower);
  return out;
}

// ── Caster cast-correlation for buff landings ───────────────────────────────
// Many spells SHARE a landing message — e.g. "X is surrounded by a barrier of
// blades." is BOTH Shield of Blades (single-target) and Ancient: Legacy of
// Blades (group). The landing text alone can't tell them apart, and the
// tracked-buff index can resolve to the wrong one (or miss untracked spells
// entirely). But the CASTER runs Mimic, so their own log says exactly what
// they cast ("You begin casting Shield of Blades."). We use that to name the
// buff that lands on their target authoritatively, and never put a group spell
// on an NPC (a group buff simply never lands on a pet/mob, so it won't appear).
const _recentSelfCast = new Map();   // charLower → [{ spellLower, name, atMs, target }] (newest last)
const SELF_CAST_WINDOW_MS = 12000;
function _zealTargetForChar(charLower) {
  for (const ch of Object.keys(_zealState)) {
    if (String(ch).toLowerCase() !== charLower) continue;
    const st = _zealState[ch];
    return (st && st.target_name) ? String(st.target_name) : null;
  }
  return null;
}
function noteSelfCast(line, character) {
  if (!line || !character) return;
  const m = line.match(/\]\s+You begin (?:casting|singing)\s+(.+?)\.\s*$/i);
  if (!m) return;
  const ts = parseEqTimestamp(line);
  const atMs = ts ? ts.getTime() : Date.now();
  const cl = String(character).toLowerCase();
  // Keep a short LIST of recent casts (not just the last) — you can cast e.g.
  // Strength then Focus of Spirit and both land in order, so a landing must be
  // able to match any recent cast, not only the most recent.
  let arr = _recentSelfCast.get(cl);
  if (!arr) { arr = []; _recentSelfCast.set(cl, arr); }
  const spellLower = m[1].trim().toLowerCase();
  arr.push({ spellLower, name: m[1].trim(), atMs, target: _zealTargetForChar(cl) });
  // Prune old / cap length.
  const cutoff = atMs - SELF_CAST_WINDOW_MS;
  while (arr.length && arr[0].atMs < cutoff) arr.shift();
  if (arr.length > 8) arr.splice(0, arr.length - 8);
  // Stage charm-spell duration here too. The other staging path (parseEvent
  // cast pipeline) depends on parseEvent emitting a `cast` event for the
  // line — which it sometimes doesn't for the self "You begin casting" form.
  // When that path misses, the charm overlay falls back to its 60s estimate
  // ("tick N/10~"). Doing it here covers the gap with no extra cost: same
  // regex match we just did, same character context.
  const ci = CHARM_SPELLS.get(spellLower);
  if (ci) _pendingCharmSpell = { cls: ci.cls, dur: ci.dur, name: m[1].trim(), owner: String(character), ts: atMs };
}
// Cross-client casting relay: when WE begin a cast with a target, tell the bot
// so anyone with that target up sees it in Mob Info's "Casting" section. Only
// our own casts are nameable (EQ hides others' spell/target), so coverage scales
// with Mimic adoption. LIVE path only (never backfill — stale casts are useless).
const _CAST_BEGIN_RX = /\]\s+You begin (?:casting|singing)\s+(.+?)\.\s*$/i;
const _lastCastRelay = new Map();   // charLower → { sig, at }
function relaySelfCastForCasting(line, character) {
  if (!line || !character) return;
  const m = line.match(_CAST_BEGIN_RX);
  if (!m) return;
  const cl = String(character).toLowerCase();
  const target = _zealTargetForChar(cl);
  if (!target) return;                       // can't attribute without a target
  const spell = m[1].trim();
  const ts = parseEqTimestamp(line);
  const atMs = ts ? ts.getTime() : Date.now();
  // Dedup a duplicated log line for the same cast within 2s.
  const sig = cl + '|' + spell.toLowerCase() + '|' + String(target).toLowerCase();
  const prev = _lastCastRelay.get(cl);
  if (prev && prev.sig === sig && (atMs - prev.at) < 2000) return;
  _lastCastRelay.set(cl, { sig, at: atMs });
  enqueueUpload('casting', { agent_version: AGENT_VERSION, casts: [{
    caster: character, spell, target,
    started_at: new Date(atMs).toISOString(),
    cast_secs: _spellCastSecs(spell),
  }] });
}
// If the observer recently cast a spell whose catalog cast_on_other matches
// THIS landing line, return an authoritative buff-cast event for it (correct
// spell + duration, even for spells the tracked-buff index doesn't carry, and
// disambiguating spells that share a landing message). Otherwise null — the
// caller falls back to parseBuffLanding's index match.
function resolveSelfCastLanding(line, observer) {
  if (!observer) return null;
  const arr = _recentSelfCast.get(String(observer).toLowerCase());
  if (!arr || !arr.length) return null;
  const ts = parseEqTimestamp(line);
  const nowMs = ts ? ts.getTime() : Date.now();
  const m = line.match(/^\[(.+?)\]\s+(.+)$/);
  if (!m) return null;
  const body = m[2].replace(/\s+$/, '');     // strip trailing whitespace
  const bodyLower = body.toLowerCase();
  // Newest cast first so the most recent matching spell wins.
  for (let i = arr.length - 1; i >= 0; i--) {
    const rc = arr[i];
    if (nowMs - rc.atMs > SELF_CAST_WINDOW_MS) continue;
    const e = _spellByNameLower.get(rc.spellLower);
    if (!e || !e.other) continue;
    // We know the spell we cast, so we know the EXACT cast_on_other suffix EQ
    // will print. Match by "body ends with expected" instead of guessing where
    // the target name ends — the old first-space split broke multi-word NPC
    // names ("A Soriz Slave slows down." → split at "A | Soriz Slave slows
    // down." → suffix didn't match "slows down.", so the debuff never
    // registered on Mob Info). Possessive form ("Bonkur's eye gleams ...")
    // leaves the "'s" attached to the suffix and needs no separator; space
    // form requires the char before the suffix to be a space.
    const expected = String(e.other).trim();
    const expectedLower = expected.toLowerCase();
    if (!expectedLower || !bodyLower.endsWith(expectedLower)) continue;
    const cut = body.length - expected.length;
    let nameEnd;
    if (expected.startsWith("'")) {
      nameEnd = cut;                          // "<name>'s ..." — no separator
    } else {
      if (cut === 0 || body[cut - 1] !== ' ') continue;
      nameEnd = cut - 1;
    }
    const name = body.slice(0, nameEnd).trim();
    if (!name) continue;
    // Attribute only to the target we were casting at (when known) so we
    // don't mis-name a bystander's same-message buff.
    if (rc.target && String(rc.target).toLowerCase() !== name.toLowerCase()) continue;
    return {
      target:      name,
      spell_id:    e.id || 0,
      spell_name:  e.name,
      landing_text: body.slice(cut).slice(0, 200),
      dur_ticks:   e.dur,
      dur_formula: e.durf,
      cast_at:     ts ? ts.toISOString() : new Date().toISOString(),
      observer:    observer,
      _selfCast:   true,
    };
  }
  return null;
}
// "Your pet's <Spell> spell has worn off." → drop that buff from the pet's
// registration immediately (both the Pet tracker store and the Mob Info
// by-target store) instead of waiting out the countdown.
function _petNameForOwner(ownerLower) {
  for (const ch of Object.keys(_zealState)) {
    if (String(ch).toLowerCase() !== ownerLower) continue;
    const st = _zealState[ch];
    if (st && Array.isArray(st.gauges)) { const p = st.gauges.find(g => g && g.slot === 16 && g.text); if (p) return String(p.text); }
    if (st && st.pet_name) return String(st.pet_name);
  }
  return null;
}
function notePetBuffWornOff(line, character) {
  if (!line || !character) return;
  const m = line.match(/\]\s+Your pet's\s+(.+?)\s+spell has worn off\.\s*$/i);
  if (!m) return;
  const spellLower = m[1].trim().toLowerCase();
  const owner = String(character).toLowerCase();
  const wornAt = Date.now();
  // Mark the timed landing as worn-off (not delete) so it lingers 5 min with the
  // purple "fell off" cue. The presence-only /pet-health entry has no countdown,
  // so just drop it — the timed landing carries the linger.
  const lm = _petBuffLandings.get(owner);
  if (lm && lm.has(spellLower)) lm.get(spellLower).worn_off_at = wornAt;
  const rep = _petHealthByOwner.get(owner);
  if (rep && rep.buffs) rep.buffs.delete(spellLower);
  const petName = _petNameForOwner(owner);
  if (petName) {
    const tm = _buffLandingsByTarget.get(petName.toLowerCase());
    if (tm && tm.has(spellLower)) tm.get(spellLower).worn_off_at = wornAt;
  }
  _savePetStateSoon();
}

// Server-wide PvP earthquake announcement → the next-quake time. EQ logs, e.g.:
//   "The next earthquake will begin in 8 Days, 12 Hours, 23 Minutes, and 30 Seconds."
// Any of Days/Hours/Minutes/Seconds may be absent. Returns
// { next_quake_at, detected_at, source_text } or null.
const _EARTHQUAKE_RX = /the next earthquake will begin in\s+(.+?)\.?\s*$/i;
let _lastQuakeSig = null;
// ── Faction tracking detectors ──────────────────────────────────────────────
// Two self-only line families feed the per-character faction picture
// (surfaced on wolfpack.quest /character/<name>/factions, BETA):
//
//  1. Faction HITS — printed on kills and quest turn-ins:
//       "Your faction standing with VeliumHounds got worse."
//       "Your faction standing with KaladimCitizens got better."
//     At the cap the server says so — gold data, it pins the character's
//     absolute position on that faction:
//       "Your faction standing with X could not possibly get any better."
//       "Your faction standing with X could not possibly get any worse."
//     Classic prints no numeric delta; we store direction + cap flag and
//     marry magnitudes to PQDI's faction pages (per-mob/per-quest values)
//     on the web side. Base standing by class/race/deity is a follow-up.
//
//  2. CON standings — every /consider prints the mob's faction tier toward
//     YOU as the leading phrase ("scowls at you, ready to attack" … "regards
//     you as an ally"). We log standing TRANSITIONS per (character, mob), so
//     a complete-log crawl charts when each faction tier moved — and a mob
//     that cons non-scowling is also the only log-visible evidence that a
//     Feign Death actually stuck (success is silent; see the FD handler).
const CON_STANDINGS = [
  ['regards you as an ally',         'ally',           8],
  ['looks upon you warmly',          'warmly',         7],
  ['kindly considers you',           'kindly',         6],
  ['judges you amiably',             'amiably',        5],
  ['regards you indifferently',      'indifferently',  4],
  ['looks your way apprehensively',  'apprehensively', 3],
  ['glowers at you dubiously',       'dubiously',      2],
  ['glares at you threateningly',    'threateningly',  1],
  ['scowls at you, ready to attack', 'scowls',         0],
];
// Phrases are plain prose (no regex metacharacters), so a straight join is
// safe — keep it that way if new tiers are ever added.
const _CON_RX = new RegExp('\\]\\s+(.+?)\\s+(' + CON_STANDINGS.map(([p]) => p).join('|') + ')', 'i');
function parseFactionLine(line, character) {
  if (!character || line.indexOf('Your faction standing with') === -1) return null;
  const m = line.match(/\]\s+Your faction standing with (.+?) (?:got (better|worse)|could not possibly get any (better|worse))\.\s*$/i);
  if (!m) return null;
  const ts = parseEqTimestamp(line);
  const dirWord = (m[2] || m[3] || '').toLowerCase();
  return {
    kind:      'hit',
    character,
    faction:   m[1].trim().slice(0, 96),
    direction: dirWord === 'better' ? 1 : -1,
    capped:    !!m[3],
    ts:        ts ? ts.toISOString() : new Date().toISOString(),
  };
}
// Standing-change dedup so /con spam doesn't flood the upload buffer: emit
// only when the standing for (character, mob) differs from the last one seen
// this session. Backfill crawls therefore record TRANSITIONS — exactly the
// history we want ("when did Thurgadin stop scowling at me").
const _lastConStanding = new Map();   // charLower|mobLower → standing
function parseConsiderLine(line, character) {
  if (!character || line.indexOf(' you') === -1) return null;
  const m = line.match(_CON_RX);
  if (!m) return null;
  const mob = m[1].trim();
  // Sanity: mob names are short; a chat line that happens to contain a con
  // phrase would carry a long prefix ("Soandso says, 'that gnoll ...") —
  // reject anything with quotes or implausible length.
  if (!mob || mob.length > 64 || /['"‘’]/.test(mob) || /\b(?:says|tells|shouts|auctions)\b/i.test(mob)) return null;
  const phrase = m[2].toLowerCase();
  const entry = CON_STANDINGS.find(([p]) => p === phrase);
  if (!entry) return null;
  const key = String(character).toLowerCase() + '|' + mob.toLowerCase();
  if (_lastConStanding.get(key) === entry[1]) return null;   // unchanged → skip
  _lastConStanding.set(key, entry[1]);
  if (_lastConStanding.size > 4000) {
    _lastConStanding.delete(_lastConStanding.keys().next().value);
  }
  // HOSTILE cons never upload. An engaged mob cons scowls/threateningly
  // regardless of base faction (every raid pull spams them), so they carry
  // no faction signal — the server keeps only the latest NON-hostile
  // standing per mob. The dedup map above still recorded the hostile tier,
  // which is exactly what makes the next non-hostile con re-emit: the
  // scowls→amiably TRANSITION (mob dropped you from hate — e.g. a Feign
  // Death finally stuck) registers instead of being suppressed as
  // "unchanged amiably".
  if (entry[2] <= 1) return null;
  const ts = parseEqTimestamp(line);
  return {
    kind:      'con',
    character,
    mob:       mob.slice(0, 64),
    standing:  entry[1],
    rank:      entry[2],
    ts:        ts ? ts.toISOString() : new Date().toISOString(),
  };
}

// PoP flag grant — "You have received a character flag!" The line never
// names the flag, so attach context: the character's current zone (Zeal)
// and the most recent boss kill (threat snapshot). The bot maps
// (zone, boss) -> flag_key; unmapped combos are preserved for launch-week
// catalog fixes. Pre-built for the 2026-10-01 PoP unlock — harmless before.
function parsePopFlagLine(line, character) {
  if (!character || line.indexOf('received a character flag') === -1) return null;
  if (!/\]\s+You have received a character flag!/i.test(line)) return null;
  const ts = parseEqTimestamp(line);
  const cl = String(character).toLowerCase();
  let zone = null;
  for (const ch of Object.keys(_zealState)) {
    if (String(ch).toLowerCase() === cl) { zone = _zealState[ch].zone || null; break; }
  }
  const enc = (stats.currentEncounterThreatByChar || {})[cl] || stats.currentEncounterThreat;
  const boss = enc && enc.bossName ? String(enc.bossName) : null;
  return {
    character,
    zone:  zone ? String(zone).slice(0, 64) : null,
    boss:  boss ? boss.slice(0, 64) : null,
    ts:    ts ? ts.toISOString() : new Date().toISOString(),
  };
}

function parseEarthquake(line) {
  if (!line || line.toLowerCase().indexOf('earthquake') === -1) return null;
  const m = line.match(_EARTHQUAKE_RX);
  if (!m) return null;
  const spec = m[1];
  const num = (rx) => { const mm = spec.match(rx); return mm ? parseInt(mm[1], 10) : 0; };
  const d  = num(/(\d+)\s+days?/i);
  const h  = num(/(\d+)\s+hours?/i);
  const mi = num(/(\d+)\s+minutes?/i);
  const s  = num(/(\d+)\s+seconds?/i);
  const totalSecs = d * 86400 + h * 3600 + mi * 60 + s;
  if (totalSecs <= 0) return null;
  const ts = parseEqTimestamp(line);
  const baseMs = ts ? ts.getTime() : Date.now();
  return {
    next_quake_at: new Date(baseMs + totalSecs * 1000).toISOString(),
    detected_at:   new Date(baseMs).toISOString(),
    source_text:   line.replace(/^\[.+?\]\s+/, '').slice(0, 200),
  };
}

// Long-term who_data registry filter — anonymous rows + level 50+. The
// transient OVERLAY (whoSnapshot) shows everyone /who returned, but the
// persistent uploads only carry threat-relevant entries: low-level bank
// alts and leveling toons aren't useful identity history.
function _isRegistryWho(v) {
  if (!v) return false;
  if (v.anonymous) return true;
  if (typeof v.level === 'number' && v.level >= 50) return true;
  return false;
}

function recordWhoEvent(ev) {
  if (!ev || !ev.name) return;
  // Keep ALL /who rows in the transient registry so the overlay can render
  // everyone in the zone (Quarm pickup raids include L30-60 characters).
  // The persistence/upload paths apply _isRegistryWho to drop low-level
  // rows before they ship — keeps the bot's who_observations focused on
  // threat-relevant identities.
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
    guildRank: old.guildRank || null,   // /who never carries rank — preserve any /guildstatus value
    anonymous: !!ev.anonymous,
    gm:        !!ev.gm || !!old.gm,
    // Zone only comes from `/who all`; a plain in-zone /who has none, so keep
    // the last known zone rather than clobbering it with null.
    zone:      ev.zone || old.zone || null,
    observedAt: ev.ts || new Date().toISOString(),
  });
  // Anyone we /who'd is a player — whitelist for downstream tank/death tracking
  confirmPlayer(ev.name);
  // Attribute this row to the in-progress /who run (for the overlay's "current"
  // vs "recently gone" split).
  _noteWhoRunName(ev.name);
}

// ── /who overlay state ───────────────────────────────────────────────────────
// Drives Mimic's /who overlay: the CURRENT /who (latest run) + a "recently gone"
// section (seen in a prior /who this session, not in the latest). A /who block
// is delimited by EQ's "Players in/on EverQuest:" header and the
// "There are N players..." footer; we collect the rows between into a run set.
// All local + instant — no upload. Anonymous rows are enriched on demand from
// the bot's who history (last non-anon class/level/guild + Zek flag).
let _whoRun = null;             // { startedAt, names:Set<lower>, complete } — in-progress/last
const WHO_HEADER_RX = /^\[.+?\]\s+Players (?:in|on) EverQuest:/i;
const WHO_FOOTER_RX = /^\[.+?\]\s+There (?:are|is) \d+ (?:player|players)\b/i;
function applyWhoLine(line) {
  if (WHO_HEADER_RX.test(line)) {
    const ts = parseEqTimestamp(line);
    _whoRun = { startedAt: ts ? ts.getTime() : Date.now(), names: new Set(), complete: false };
    return;
  }
  if (WHO_FOOTER_RX.test(line)) {
    if (_whoRun) _whoRun.complete = true;
  }
}
function _noteWhoRunName(name) {
  if (_whoRun && !_whoRun.complete && name) _whoRun.names.add(String(name).toLowerCase());
}

// Anon de-anon cache: lower → { at, data|null }. data = { class, level, guild,
// is_zek, last_seen } from the bot's merged who history.
const _whoLookupCache = new Map();
const _whoLookupInflight = new Set();
const WHO_LOOKUP_TTL_MS = 5 * 60 * 1000;
function fetchWhoLookup(names) {
  const opts = _uploadOpts;
  if (!opts || !opts.botUrl || !opts.token) return;
  const now = Date.now();
  const need = [];
  for (const n of names) {
    const k = String(n).toLowerCase();
    if (_whoLookupInflight.has(k)) continue;
    const c = _whoLookupCache.get(k);
    if (c && (now - c.at) < WHO_LOOKUP_TTL_MS) continue;
    need.push(String(n));
  }
  if (!need.length) return;
  for (const n of need) _whoLookupInflight.add(n.toLowerCase());
  const url = opts.botUrl.replace(/\/encounter(\?.*)?$/, '/who-lookup') + '?names=' + encodeURIComponent(need.join(','));
  try {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + opts.token, 'User-Agent': `wolfpack-logsync/${AGENT_VERSION}` },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        for (const n of need) _whoLookupInflight.delete(n.toLowerCase());
        let r = {};
        try { const j = JSON.parse(body); r = (j && j.results) || {}; } catch { r = {}; }
        const t = Date.now();
        for (const n of need) { const k = n.toLowerCase(); _whoLookupCache.set(k, { at: t, data: r[k] || null }); }
      });
    });
    req.on('error',   () => { for (const n of need) _whoLookupInflight.delete(n.toLowerCase()); });
    req.on('timeout', () => { req.destroy(); for (const n of need) _whoLookupInflight.delete(n.toLowerCase()); });
    req.end();
  } catch { for (const n of need) _whoLookupInflight.delete(n.toLowerCase()); }
}
// PVP threat-priority ordering for the /who overlay. CC/burst casters go top
// (neutralize them first), then heal denial, then DPS, then tanks; unknown
// classes sink to the middle so they don't crowd the actionable rows. Anonymous
// raiders with a known class from history (via _whoLookupCache → entry.known)
// use that class for ranking, so a de-anon'd Enchanter sorts to the top even
// when their live row says ANONYMOUS.
const _THREAT_RANK = {
  enchanter: 0, ench: 0, enc: 0,
  wizard: 1, wiz: 1,
  necromancer: 2, necro: 2, nec: 2,
  cleric: 3, clr: 3,
  druid: 4, dru: 4,
  shaman: 5, shm: 5,
  magician: 6, mage: 6, mag: 6,
  bard: 7, brd: 7,
  beastlord: 8, bst: 8,
  ranger: 9, rng: 9,
  rogue: 10, rog: 10,
  monk: 11, mnk: 11,
  paladin: 12, pal: 12,
  'shadow knight': 13, shadowknight: 13, shd: 13, sk: 13,
  warrior: 14, war: 14,
  berserker: 15, ber: 15,
};
const _THREAT_UNKNOWN = 50;            // unknown / un-de-anon'd → middle bucket
function _classThreatRank(p) {
  const live = p.class && String(p.class).toLowerCase().trim();
  if (live && _THREAT_RANK[live] != null) return _THREAT_RANK[live];
  const knownClass = p.known && p.known.class && String(p.known.class).toLowerCase().trim();
  if (knownClass && _THREAT_RANK[knownClass] != null) return _THREAT_RANK[knownClass];
  return _THREAT_UNKNOWN;
}
function _threatSort(a, b) {
  const ra = _classThreatRank(a), rb = _classThreatRank(b);
  if (ra !== rb) return ra - rb;
  // Within the same class bucket: higher level first; then alpha.
  const la = a.level || (a.known && a.known.level) || 0;
  const lb = b.level || (b.known && b.known.level) || 0;
  if (la !== lb) return lb - la;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function buildWhoSnapshot() {
  const now = Date.now();
  // Current set = the latest /who run. Fallback: names sharing the freshest
  // observation timestamp (a /who block's rows all land within ~1s).
  let currentNames = (_whoRun && _whoRun.names.size) ? _whoRun.names : null;
  if (!currentNames) {
    let maxObs = 0;
    for (const v of whoData.values()) { const tt = Date.parse(v.observedAt || 0) || 0; if (tt > maxObs) maxObs = tt; }
    if (maxObs > 0) {
      currentNames = new Set();
      for (const [k, v] of whoData) { const tt = Date.parse(v.observedAt || 0) || 0; if (maxObs - tt <= 8000) currentNames.add(k); }
    }
  }
  if (!currentNames || !currentNames.size) return null;
  const RECENT_GONE_MS = 30 * 60 * 1000;
  const current = [], gone = [], anonNeeded = [];
  for (const [k, v] of whoData) {
    const entry = {
      name: v.name, level: v.level || null, class: v.class || null, race: v.race || null,
      guild: v.guild || null, anonymous: !!v.anonymous, gm: !!v.gm, observedAt: v.observedAt || null,
    };
    if (currentNames.has(k)) {
      if (v.anonymous) {
        const known = _whoLookupCache.get(k);
        if (known && (now - known.at) < WHO_LOOKUP_TTL_MS) entry.known = known.data || null;
        else anonNeeded.push(v.name);
      }
      current.push(entry);
    } else {
      const tt = Date.parse(v.observedAt || 0) || 0;
      if (tt && (now - tt) <= RECENT_GONE_MS) gone.push(entry);
    }
  }
  if (anonNeeded.length) fetchWhoLookup(anonNeeded);
  current.sort(_threatSort);
  gone.sort((a, b) => (Date.parse(b.observedAt || 0) || 0) - (Date.parse(a.observedAt || 0) || 0));
  return {
    current,
    recentGone: gone.slice(0, 30),
    capturedAt: _whoRun ? _whoRun.startedAt : now,
  };
}

// Capture a /guildstatus result — guild + EQ IN-GAME rank, even for /anon
// players. guildRank is the EverQuest engine's guild permission tier
// (Member/Officer/Leader) — NOT a Wolf Pack operational rank. Merges into
// whoData (preserving class/level from a prior /who), riding the normal
// who_data upload to the bot → who_observations.guild_rank.
function recordGuildStatus(name, guild, rank) {
  if (!name) return;
  const k   = name.toLowerCase();
  const old = whoData.get(k) || {};
  whoData.set(k, {
    ...old,
    name:      old.name || name,
    guild:     guild || old.guild || null,
    guildRank: rank  || old.guildRank || null,
    observedAt: new Date().toISOString(),
  });
  confirmPlayer(name);
}

// Class inference from class-EXCLUSIVE abilities. When a watched box shows up
// with no /who row yet, we can still tell its class from what it does: "I used
// Harm Touch, so I'm a Shadow Knight." Only these unambiguous, single-class
// abilities are used (no false positives). We get the character name from the
// log file, so this is about the operator's own boxes (the ones whose
// first-person lines we see). A real /who row always overrides an inference.
const ABILITY_CLASS = {
  'harm touch':   'Shadow Knight',
  'lay on hands': 'Paladin',
  'mend':         'Monk',
  'backstab':     'Rogue',
  'flying kick':  'Monk',
  'round kick':   'Monk',
  'dragon punch': 'Monk',
  'eagle strike': 'Monk',
  'tail rake':    'Monk',  // iksar monk equivalent of Dragon Punch
};
function inferClassFromAbility(character, ability) {
  if (!character || !ability) return;
  const cls = ABILITY_CLASS[String(ability).toLowerCase().trim()];
  if (!cls) return;
  const k   = String(character).toLowerCase();
  const old = whoData.get(k) || {};
  // Never override a /who-sourced class; only fill a gap or refine a prior
  // inference. (classSource is absent on /who rows = authoritative.)
  if (old.class && old.classSource !== 'inferred') return;
  if (old.class === cls) return;
  whoData.set(k, {
    ...old,
    name:        old.name || character,
    class:       cls,
    classSource: 'inferred',
    observedAt:  old.observedAt || new Date().toISOString(),
  });
  confirmPlayer(character);
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
    // True only when the boss's "X has been slain by Y!" line was observed
    // for the named target. False when bossName was guessed from the
    // top-damaged target after an idle-timeout flush. The bot uses this to
    // decide whether to auto-set a respawn timer — engaged-but-survived
    // fights (pull-and-flee, wipes) must not move boards.
    this.bossKillConfirmed = false;
    // Mob → last player it landed a hit on, for DS correlation. On Quarm a
    // damage-shield proc logs as the anonymous "<mob> was hit by non-melee
    // for N" without naming the wearer, so we credit it to whoever the mob
    // most recently connected with (within 1500ms). Per-encounter, cleared
    // on reset since mob identities don't carry across encounters.
    this._lastIncomingHit = new Map();   // mob.toLowerCase() → { tank, tsMs }
    // PvP assist correlation — uploader's outbound damage to player names,
    // rolling 30s window. When a PvP death broadcast names one of these
    // victims and the killing blow wasn't ours, we emit an assist event.
    // Per-builder (per-encounter); cross-fight assists are intentionally
    // missed since 30s comfortably covers any real engagement → death pair.
    this._pvpDamageWindow = new Map();   // victim.toLowerCase() → { tsMs, lineSample }
    // Pending DS commit — buffered between the damage line and the flavor
    // line (e.g. "X was hit by non-melee for 14" then "X was pierced by
    // thorns."). When the flavor lands within 2s, the buffered event's
    // ability gets retagged from 'non-melee' to the real spell name. If no
    // flavor arrives, we commit with 'non-melee' once the next add() call
    // pushes us past the 2s window.
    this._dsPending = null;              // { eventRef, attacker, mobLower, tsMs }
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
    // Damage-shield reflects — every damage event with no attacker landing on
    // one of our combat targets is treated as a reflect (DS spell, thorns
    // song, clicky shield, etc.). We track per-ability { count, total, min,
    // max, examples[]} so the dashboard can later distinguish fixed-value
    // shields (Inner Fire family — all hits the same number) from variable
    // ones (Elemental Illusion bard song, clickies — values fan out).
    //   abilityName -> { count, total, min, max, examples: number[] }
    this.dsReflects = new Map();
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
      // Per-character mirror: drop our own entry once it's stale so the
      // overlay doesn't keep showing a fight that ended ages ago when the
      // user switches back to this character.
      if (this.character && stats.currentEncounterThreatByChar) {
        const k = String(this.character).toLowerCase();
        const own = stats.currentEncounterThreatByChar[k];
        if (own && own.flushedAt && Date.now() - own.flushedAt > 120_000) {
          delete stats.currentEncounterThreatByChar[k];
        }
      }
      // else: leave stale data in place (flushedAt set by flush())
      return;
    }
    const perPlayer = {};
    for (const [name, t] of this.threatBy) {
      // Defense-in-depth: even if a name slipped past the writer-side
      // NPC check, drop it here if it shows up as a damage target — the
      // mob we're fighting can't simultaneously be on our threat table.
      // EXCEPTION: our own pets. A charm pet is usually a mob we damaged
      // BEFORE charming it (mez → tash → charm), so its name lives in
      // this.targets from the pre-charm fight — but post-charm it's on
      // OUR side and its damage rows are exactly what the DPS HUD's pet
      // rows need. Same-named trash ambiguity is accepted (mobs rarely
      // hit our targets unless charmed).
      const nl = String(name).toLowerCase();
      const petOwner = this.petLeaders[nl]
        || (this._activeCharms?.get(nl)?.owner)
        || (_charmTickTracker.get(nl)?.is_active ? _charmTickTracker.get(nl).owner : null)
        || null;
      if (this.targets.has(name) && !petOwner) continue;
      perPlayer[name] = {
        swing:      Math.round(t.swing),
        proc:       Math.round(t.proc),
        spell:      Math.round(t.spell),
        heal:       Math.round(t.heal),
        total:      Math.round(t.swing + t.proc + t.spell + t.heal),
        // RAW (un-weighted) damage + healing for the per-fight DPS/HPS overlay,
        // distinct from the threat-weighted numbers above.
        dmg:        Math.round(t.dmg || 0),
        healRaw:    Math.round(t.healRaw || 0),
        // Inbound damage taken (from mobs) — Tank tab on the damage overlay.
        took:       Math.round(t.took || 0),
        tookMax:    Math.round(t.tookMax || 0),
        // Set for OUR pet rows (charm or summoned) — lets the DPS HUD allow
        // the multi-word name past its anti-NPC filter and label the row
        // "A Fungoid Sporeling (Hopeya)".
        pet_owner:  petOwner,
        procDetail: t.procDetail || {},
      };
    }
    // Fight label for the overlays: the catalog-matched boss when known,
    // else the most-damaged defender this encounter — so trash/named pulls
    // still say WHAT we're fighting instead of a generic "current fight".
    let _topTarget = null, _topTargetDmg = 0;
    for (const [tname, tdmg] of this.targets) {
      if (tdmg > _topTargetDmg) { _topTargetDmg = tdmg; _topTarget = tname; }
    }
    const snap = {
      bossName:   this.bossName,
      targetName: this.bossName || _topTarget,
      startedAt: this.startedAt,
      flushedAt: null,
      // The character whose log file this builder is reading. Lets the
      // damage overlay clear when the active EQ window switches to a
      // different character — without this the meter "sticks" to whichever
      // builder published last.
      uploader:  this.character || null,
      perPlayer,
    };
    // Pet aggro rollup — every charm or summoned pet that has a row in
    // perPlayer with a known pet_owner contributes its total threat back to
    // its OWNER's row as `pet_threat_total`. Lets the threat overlay show
    // "Hopeya 18.2k +pet 12.0k" so an enchanter can see their COMBINED hate
    // signature (the mob doesn't separate pet-hate from owner-hate when
    // deciding who to chew on).
    for (const t of Object.values(perPlayer)) {
      if (!t.pet_owner) continue;
      // Case-insensitive owner lookup (perPlayer keys are original case;
      // pet_owner field is also original case but the threat builder may
      // capitalize differently if the agent saw the name in multiple spots).
      const ownerLower = String(t.pet_owner).toLowerCase();
      const ownerKey = Object.keys(perPlayer).find(k => k.toLowerCase() === ownerLower);
      const ownerRow = ownerKey ? perPlayer[ownerKey] : null;
      if (ownerRow) {
        ownerRow.pet_threat_total = (ownerRow.pet_threat_total || 0) + (t.total || 0);
      }
    }
    stats.currentEncounterThreat = snap;
    // Per-character mirror so a multi-boxer can see THEIR focused character's
    // fight even when another character's log just landed an update. Keyed
    // lower-case to match the active-character normalization in /api/state.
    if (this.character) {
      stats.currentEncounterThreatByChar = stats.currentEncounterThreatByChar || {};
      stats.currentEncounterThreatByChar[String(this.character).toLowerCase()] = snap;
    }
    // Mirror current DS-reflect accumulator so the dashboard can render
    // a live "🛡 Damage Shield" panel without poking builder internals.
    if (this.dsReflects && this.dsReflects.size > 0) {
      const out = {};
      for (const [k, v] of this.dsReflects.entries()) out[k] = v;
      stats.currentDsReflects = { bossName: this.bossName, abilities: out };
    } else {
      stats.currentDsReflects = null;
    }
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
  // Commit the buffered DS attribution to stats.damageShield. Called when
  // the flavor line arrives (with the real spell name retagged onto the
  // eventRef), when a new DS attribution opens (so the previous one isn't
  // stranded), or when the next damage event's timestamp passes the 2s
  // window without a flavor line landing. Idempotent — null-out after commit.
  _commitDsPending() {
    const p = this._dsPending;
    if (!p || !p.eventRef || p.eventRef.amount <= 0) { this._dsPending = null; return; }
    const spell = (p.eventRef.ability || 'non-melee').toLowerCase();
    if (!stats.damageShield[p.attacker]) stats.damageShield[p.attacker] = {};
    const byTank = stats.damageShield[p.attacker];
    if (!byTank[spell]) byTank[spell] = { count: 0, total: 0 };
    byTank[spell].count++;
    byTank[spell].total += p.eventRef.amount;
    this._dsPending = null;
  }

  // Given a PvP broadcast (from parsePvpBroadcast), check whether the
  // uploader had recently damaged the named victim AND someone else landed
  // the killing blow. Returns an assist event object suitable for the
  // pvp_assists table, or null. Consumes the damage-window entry on a match
  // so a single damage burst doesn't generate multiple assists from one
  // back-to-back kill chain. The window is 30s, matching the offline audit.
  _checkPvpAssist(pvpBcast, opts) {
    if (!pvpBcast || !pvpBcast.victim) return null;
    if (pvpBcast.killType !== 'pvp' && pvpBcast.killType !== 'npc') return null;
    const victimLower = String(pvpBcast.victim).toLowerCase();
    const wd = this._pvpDamageWindow.get(victimLower);
    if (!wd) return null;
    const evTsMs = Date.parse(pvpBcast.ts) || Date.now();
    const gapMs = evTsMs - wd.tsMs;
    if (gapMs < 0 || gapMs > 30_000) return null;
    // Don't credit ourselves an "assist" on our own kill — that's a kill.
    const killerLower = pvpBcast.killer ? String(pvpBcast.killer).toLowerCase() : '';
    const meLower = String(this.character || '').toLowerCase();
    if (meLower && killerLower === meLower) return null;
    this._pvpDamageWindow.delete(victimLower);   // consume — one assist per damage burst
    return {
      assister:      this.character,
      victim:        pvpBcast.victim,
      victim_guild:  pvpBcast.victimGuild || null,
      killer:        pvpBcast.killer || null,
      killer_is_npc: pvpBcast.killType === 'npc',
      zone:          pvpBcast.zone || null,
      killed_at:     pvpBcast.ts,
      gap_seconds:   Math.round(gapMs / 1000),
      raw_text:      (pvpBcast.text || '').slice(0, 500),
      source:        (opts && opts.source) || 'live_agent',
    };
  }

  add(event) {
    if (!event) return;

    // ── Damage-shield flavor line → retag pending attribution ─────────────
    // "X was pierced by thorns." (no number, no points). The DS damage line
    // landed milliseconds earlier and is buffered in _dsPending; we update
    // its ability with the real spell name and commit. ds_flavor events are
    // pure attribution — never added to this.events.
    if (event.type === 'ds_flavor') {
      const flavorTsMs = Date.parse(event.ts) || Date.now();
      const p = this._dsPending;
      if (p && p.mobLower === String(event.defender || '').toLowerCase()
          && flavorTsMs - p.tsMs < 2000) {
        p.eventRef.ability = String(event.ability || 'non-melee').trim();
      }
      // Commit regardless — flavor lines mark the end of the DS pair window.
      this._commitDsPending();
      return;
    }

    // Stale pending DS attribution? Commit before the new event so its
    // damage doesn't leak into a later mob's flavor line.
    if (this._dsPending) {
      const evTsMs = Date.parse(event.ts) || Date.now();
      if (evTsMs - this._dsPending.tsMs > 2000) this._commitDsPending();
    }

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
      const ownerWas = open ? open.owner : (_charmTickTracker.get(petKey)?.owner || null);
      if (open) {
        open.ended_at = this.lastEvent || open.started_at;
        open.end_reason = 'charm_break';
        open.duration_sec = Math.max(0, (open.ended_at - open.started_at) / 1000);
        this.charmSessions.push(open);
        this._activeCharms.delete(petKey);
      }
      // The break event lands ON the mob's tick — fresh anchor for the 6s
      // cycle. Even when there was no open session (e.g. enchanter joined
      // mid-charm), we still want to begin tracking ticks now.
      _bumpCharmTick(event.pet || petKey, ownerWas, 'break', this.lastEvent || Date.now());
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
      // Pet target — captured from the "Attacking X Master." command ack.
      // Surfaces in the Pet Tracker overlay so the user can see what their
      // summon is currently engaging. Decays if the pet doesn't re-ack
      // within PET_TARGET_TTL_MS (idle/dead/swapped target).
      if (event.target) {
        _petTargetByOwner.set(String(owner).toLowerCase(), {
          target: String(event.target),
          at:     Date.parse(event.ts) || Date.now(),
        });
      }
      // Charm-land specifically also starts a charm_session record. Other
      // pet_leader sources (the pet's own "My leader is" declare line or
      // the charm-tell "Attacking X Master") don't — those are summon /
      // group-pet flows, not the per-session-tracked charm cycle.
      if (event.source === 'charm_land') {
        const petKey = _pk;
        const startTs = this.lastEvent || Date.now();
        const existing = (this._activeCharms ||= new Map()).get(petKey);
        // Same pet + same owner = either a REAL recast (bard cycle, or
        // enchanter re-charm to refresh duration) OR a redundant pet-ack
        // ("Attacking X Master") which also tags source:'charm_land'.
        // Distinguish via _pendingCharmSpell: a real recast consumes one
        // (the spell-cast event populated it within the last 12s); an ack
        // alone gets nothing back. Recast → refresh the tick tracker so
        // the overlay's 'up' timer + duration bar reset for the new
        // cycle. Ack → leave the tracker alone. Either way the
        // _activeCharms session continues (one mob = one DPS attribution
        // session from charm to break).
        if (existing && existing.owner === owner) {
          const pcSpell = _consumePendingCharmSpell(owner, startTs);
          if (pcSpell && (pcSpell.dur || pcSpell.cls)) {
            _bumpCharmTick(event.pet, owner, 'land', startTs, { is_dire_charm: !!existing.is_dire_charm, ...pcSpell });
          }
          return;
        }
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
        const pcSpell = _consumePendingCharmSpell(owner, startTs) || {};
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
        // Charm landed → that moment is the mob's tick; start the 6s
        // countdown on the global tracker. Pass the dire-charm flag so the
        // charm overlay knows whether to show a duration countdown.
        _bumpCharmTick(event.pet, owner, 'land', startTs, { is_dire_charm: isDC, ...pcSpell });
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

    // /melody markers — stamp the character's bardMelody state so the overlay
    // shows "playing melody…" + the start timestamp even before Zeal label 134
    // delivers the first per-song transition. Zeal label 134 does the heavy
    // lifting once it fires; this is purely the "we know SOMETHING is happening"
    // baseline so the overlay isn't empty on a /melody start.
    if (event.type === 'melody_start' && this.character) {
      const key = String(this.character).toLowerCase();
      let state = _bardMelody.get(key);
      if (!state) {
        state = { order: [], currentPos: -1, castStartedAt: Date.now(), cycleLength: 0, lastChangeAt: Date.now(), kind: 'song' };
        _bardMelody.set(key, state);
      }
      state.melodyActive = true;
      state.melodyStartedAt = Date.parse(event.ts) || Date.now();
      state.lastChangeAt    = state.melodyStartedAt;
      return;
    }
    if (event.type === 'melody_stop' && this.character) {
      const key = String(this.character).toLowerCase();
      const state = _bardMelody.get(key);
      if (state) {
        state.melodyActive = false;
        state.melodyEndedAt = Date.parse(event.ts) || Date.now();
        // Force the current song row to "stopped" by aging the
        // castStartedAt timestamp far back. Otherwise the overlay keeps
        // filling the cast bar as if the song completed — user feedback
        // was that clicking to stop a song mid-cast looked like it kept
        // going. This snaps the bar to halt + flips the row to ⏹ instantly.
        state.castInterrupted = true;
        state.castStartedAt = state.melodyEndedAt - 60000;
      }
      return;
    }

    // /who output rows are metadata, not combat — accumulate into the module
    // buffer and ship in the next encounter upload.
    if (event.type === 'who') {
      recordWhoEvent(event);
      return;
    }

    // /guildstatus — guild + rank for any character (survives /anon). "You"
    // resolves to this log's character.
    if (event.type === 'guildstatus') {
      const who = /^you$/i.test(event.character) ? (this.character || null) : event.character;
      if (who) recordGuildStatus(who, event.guild, event.guildRank);
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

    // ── Damage-shield correlation (Quarm format) ─────────────────────────────
    // On Quarm the DS proc logs as "<Mob> was hit by non-melee for N" with NO
    // wearer attribution. Correlate it with the most recent connecting swing
    // FROM that same mob: whoever it just hit (within ~1500ms) is the DS
    // wearer and gets the damage credit. The narrow window matches EQ's combat
    // tick — DS lands on the same tick as the swing it procced from. Misses
    // don't proc DS; they come through as type='miss' so they never enter
    // _lastIncomingHit (only landed damage events do).
    //
    // Runs AFTER the dirge block so the more specific dirge attribution wins
    // when both could match; falls through to DS if no dirge cast is pending.
    if (event.type === 'damage' && event.amount > 0) {
      const tsMs = Date.parse(event.ts) || Date.now();
      const att = String(event.attacker || '');
      const def = String(event.defender || '');

      // 1) Mob → Player connect: remember who the mob just hit. Heuristic:
      // attacker looks like a mob (multi-word, "a/an/the" prefix, or starts
      // lowercase) AND defender looks like a player (single Capitalized word
      // or "YOU"/"You" which the agent resolves to the uploader).
      const _isMob = (n) => n && (n === 'YOU' || n === 'You' ? false
        : /^(a|an|the)\s/i.test(n) || /\s/.test(n) || /^[a-z]/.test(n));
      const _isPlayer = (n) => n && (n === 'YOU' || n === 'You' || /^[A-Z][a-zA-Z'`]{1,}$/.test(n));
      if (_isMob(att) && _isPlayer(def)) {
        const tank = (def === 'YOU' || def === 'You') ? (this.character || def) : def;
        this._lastIncomingHit.set(att.toLowerCase(), { tank, tsMs });
      }

      // 3) PvP assist window: uploader's outbound damage to a plausible
      // player name (single Capitalized word, not "YOU"). Stamps a sliding
      // window keyed by victim.toLowerCase() so the next PvP death broadcast
      // naming the same victim within 30s can correlate (handled outside the
      // builder, in the tail/backfill driver). Self-damage to mobs / heals
      // are skipped automatically — _isMob/_isPlayer already excluded them.
      const isMineOutbound = (event.attacker === null) || (event.attacker === this.character);
      if (isMineOutbound && _isPlayer(def)
          && def !== 'YOU' && def !== 'You'
          && def !== this.character) {
        this._pvpDamageWindow.set(def.toLowerCase(), {
          tsMs,
          line: event._line || (event.ability ? `${event.ability} for ${event.amount}` : ''),
        });
      }

      // 2) DS attribution: anonymous non-melee hit on a mob — if that mob
      // landed a connect on a player in the last 1500ms, credit the player.
      // Buffers into _dsPending instead of tallying immediately; the flavor
      // line ("X was pierced by thorns.") that lands milliseconds later
      // retags ability with the actual spell name. If no flavor arrives, the
      // next add() with tsMs > pending.tsMs + 2000 commits 'non-melee' as-is.
      if (event.attacker === null && def && event.ability === 'non-melee') {
        const recent = this._lastIncomingHit.get(def.toLowerCase());
        if (recent && tsMs - recent.tsMs < 1500) {
          // Commit any older pending before opening a new one (one mob's DS
          // hit shouldn't be retagged by another mob's flavor line).
          if (this._dsPending) this._commitDsPending();
          event.attacker = recent.tank;
          event.ds = true;
          event._skipDsAggregate = true;   // suppress the immediate aggregate below
          this._dsPending = {
            eventRef: event,
            attacker: recent.tank,
            mobLower: def.toLowerCase(),
            tsMs,
          };
        }
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
      inferClassFromAbility(this.character, 'mend');  // Monk-exclusive
      if (!this.silent) {
        stats.sessionMends.attempts++;
        if (event.outcome === 'crit')        { stats.sessionMends.crit++;    stats.sessionMends.success++; }
        else if (event.outcome === 'regular'){ stats.sessionMends.success++; }
        else if (event.outcome === 'fail')   { stats.sessionMends.fail++; }
      }
      return;
    }

    // ── Resisted incoming spell ──────────────────────────────────────────────
    // "You resist the <Spell> spell!" — names a spell a mob is casting at us
    // (the mob's own cast line only says "a spell"). Attribute to the mob
    // being fought right now (this.bossName) as a best-effort caster. Counter
    // only; not added to this.events. Silent backfill skips it.
    if (event.type === 'resist') {
      if (!this.silent && event.spell) {
        const r = stats.resistedSpells[event.spell]
               || (stats.resistedSpells[event.spell] = { count: 0, lastMob: null, byMob: {} });
        if (!r.byMob) r.byMob = {};   // migrate older saved snapshots
        r.count++;
        if (this.bossName) {
          r.lastMob = this.bossName;
          r.byMob[this.bossName] = (r.byMob[this.bossName] || 0) + 1;
        }
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
        // Callout: announce who's taking the rampage (deduped per-target so a
        // multi-hit rampage / multi-box logs don't spam it). Silent builders
        // (opt-in backfill replays) must NOT speak old rampages.
        if (!this.silent) _announceRampage(def, Date.parse(event.ts) || Date.now());
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

      // ── Inbound spell damage on the uploader (by caster → spell) ────────────
      // Counterpart to the resisted-spells card: what landed on US. Only when
      // the parse rule tagged a real spell name (event.spellName) and WE are the
      // defender. The spell name stays in spells{}/ability; the CASTER (a real
      // mob/player or '(unknown)') is the group key — never the spell — so this
      // can't manufacture a phantom character.
      if (!this.silent && event.spellName) {
        const def = event.defender;
        const defenderIsUploader =
          def === null ||
          /^you$/i.test(def || '') ||
          (this.character && String(def).toLowerCase() === this.character.toLowerCase());
        if (defenderIsUploader) {
          const caster = (rawAtk && !/^you$/i.test(rawAtk)) ? rawAtk : '(unknown)';
          const spell  = String(event.spellName).trim();
          if (spell) {
            const byC = stats.inboundSpellDamage[caster]
                     || (stats.inboundSpellDamage[caster] = { total: 0, count: 0, lastSeen: 0, spells: {} });
            byC.total += event.amount;
            byC.count++;
            byC.lastSeen = Date.now();
            const sp = byC.spells[spell] || (byC.spells[spell] = { total: 0, count: 0, max: 0 });
            sp.total += event.amount;
            sp.count++;
            if (event.amount > sp.max) sp.max = event.amount;
          }
        }
      }
      // Class inference from a class-exclusive verb the BOX itself used
      // (first-person, rawAtk===null) — e.g. Backstab → Rogue, Flying Kick →
      // Monk. Only fires for the names in ABILITY_CLASS; no-op otherwise.
      if (rawAtk === null && event.ability) inferClassFromAbility(this.character, event.ability);
      // Damage-shield reflect detection: the line is "X was hit by ABILITY for
      // N damage" with attacker=null (EQ never reveals who applied the DS to
      // the tank). When the defender is a mob we're currently fighting AND an
      // ability name is present, count it as a reflect.
      if (rawAtk === null && event.ability && event.defender && this.targets.has(event.defender)) {
        const abil = String(event.ability).trim();
        if (abil && abil.length < 40) { // sanity bound; real spell names are short
          let r = this.dsReflects.get(abil);
          if (!r) { r = { count: 0, total: 0, min: event.amount, max: event.amount, examples: [] }; this.dsReflects.set(abil, r); }
          r.count++;
          r.total += event.amount;
          if (event.amount < r.min) r.min = event.amount;
          if (event.amount > r.max) r.max = event.amount;
          if (r.examples.length < 8) r.examples.push(event.amount);
        }
      }
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
      // OUR pets (charm or summoned) bypass both the multi-word anti-NPC
      // filter AND the known-NPC check — a charm pet is usually a mob we
      // damaged before charming, so it's in this.targets, and its name has
      // spaces ("A Fungoid Sporeling"). Without this bypass, pet damage
      // never reached threatBy and the DPS HUD showed only the owner's own
      // swings. Pet identity: encounter petLeaders, open charm session, or
      // the gauge-driven module tracker's active entry.
      const _atkL = attacker ? attacker.toLowerCase() : '';
      const attackerIsOurPet = !!(attacker && (this.petLeaders[_atkL]
        || this._activeCharms?.has(_atkL)
        || _charmTickTracker.get(_atkL)?.is_active));
      if (!pvpHit && attacker && (!attackerIsKnownNpc || attackerIsOurPet)
          && (attacker === this.character || isPlausibleAttacker(attacker))
          && (!/\s/.test(attacker) || attacker === this.character || attackerIsOurPet)) {
        if (!this.threatBy.has(attacker)) {
          this.threatBy.set(attacker, { swing: 0, proc: 0, spell: 0, heal: 0, dmg: 0, healRaw: 0, procDetail: {} });
        }
        const t = this.threatBy.get(attacker);
        // RAW damage to current-encounter mobs (un-weighted) — feeds the
        // per-fight damage overlay. Threat (swing/proc/spell) stays weighted
        // for the Tanks threat meter; this is the honest damage number.
        t.dmg = (t.dmg || 0) + event.amount;
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
        // My Crits tracker — only the box's OWN crits (attacker resolves to
        // this.character), split melee vs spell. Skip silent/backfill so the
        // live panel reflects this session. event.kind is set by the parser.
        if (!this.silent && attacker === this.character) {
          const kind = event.kind === 'spell' ? 'spell' : 'melee';
          const c = stats.sessionCrits[attacker]
                 || (stats.sessionCrits[attacker] = { melee: { count: 0, total: 0, max: 0 }, spell: { count: 0, total: 0, max: 0 } });
          const b = c[kind];
          b.count++;
          b.total += event.amount;
          if (event.amount > b.max) b.max = event.amount;
        }
      }
    }

    // Tank-meter inbound damage. Sum incoming damage per player so the
    // overlay's "Tank" tab can show who's eating the boss's melee — same
    // perPlayer scoreboard, swapped data source (.took instead of .dmg).
    //   Defender filter: must be a known player (own char OR /who-confirmed
    //   OR PvP confirmed).
    //   Attacker filter: must NOT be a known player (we only want incoming
    //   from mobs; PvP / friendly-fire is excluded so the meter stays
    //   "damage the tank ate from the mob").
    if (event.type === 'damage' && event.amount > 0 && event.defender) {
      const defRaw = event.defender;
      const defender = /^you$/i.test(defRaw) ? (this.character || 'You') : defRaw;
      const atkRaw  = event.attacker;
      const attacker = (atkRaw === null || /^you$/i.test(atkRaw || ''))
        ? (this.character || 'You')
        : atkRaw;
      const defenderIsPlayer = defender && (defender === this.character || isConfirmedPlayer(defender));
      const attackerIsPlayer = attacker && (attacker === this.character || isConfirmedPlayer(attacker));
      // OUR pet eating hits IS tanking — the whole point of charm play.
      // Without this, an enchanter's Tank tab stayed empty because the
      // defender (the pet) is never a confirmed player.
      const _defL = defender ? defender.toLowerCase() : '';
      const defenderIsOurPet = !!(defender && (this.petLeaders[_defL]
        || this._activeCharms?.has(_defL)
        || _charmTickTracker.get(_defL)?.is_active));
      if ((defenderIsPlayer || defenderIsOurPet) && !attackerIsPlayer && defender !== attacker) {
        if (!this.threatBy.has(defender)) {
          this.threatBy.set(defender, { swing: 0, proc: 0, spell: 0, heal: 0, dmg: 0, healRaw: 0, took: 0, tookMax: 0, procDetail: {} });
        }
        const dt = this.threatBy.get(defender);
        dt.took = (dt.took || 0) + event.amount;
        // Biggest single hit absorbed — the dangerous one. A tank seeing
        // a 5k crit absorbed is more useful than knowing they ate 12k
        // across the fight in 500-damage swings.
        if (event.amount > (dt.tookMax || 0)) dt.tookMax = event.amount;
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

    // Aggro dumps — rogue Evade pulls the player DOWN the threat meter; the
    // Feign Death fall line is the FAILURE signal (a successful FD is silent
    // in the log — only the mob's behavior reveals it), so FD lines are
    // counted as failed attempts and never reduce anyone's threat. Only the
    // threat buckets (swing/proc/spell/heal) are touched by evade;
    // dmg/healRaw/took are damage-meter numbers and must survive untouched
    // (evading doesn't un-deal your damage).
    if (event.type === 'feign_death' || event.type === 'evade') {
      // FD bystander form carries the faller's name; self forms resolve to
      // the uploader. Single-capitalized-word gate keeps NPC corpses and
      // multi-word mobs out (mobs don't FD, but belt-and-suspenders).
      const who = event.attacker || this.character;
      if (who && /^[A-Z][a-zA-Z]{2,19}$/.test(who) && this.threatBy.has(who)) {
        const t = this.threatBy.get(who);
        if (event.type === 'feign_death') {
          // The fall line = failed FD; the player is still on the hate
          // table at full threat. Count it so monks can see their FD
          // fail rate in the breakdown column. (Successful FDs leave no
          // log line; inferring them from mob con/disengage behavior is
          // the faction-consider work — see parseConsiderLine.)
          t.procDetail['Feign Death (failed)'] = (t.procDetail['Feign Death (failed)'] || 0) + 1;
        } else if (event.success) {
          // Successful Evade ≈ a big flat cut; TAKP-era servers model it as
          // roughly half your hate. Halve every bucket so the breakdown bar
          // keeps its shape while the row drops down the meter.
          t.procDetail['Evade'] = (t.procDetail['Evade'] || 0) + 1;
          t.swing *= 0.5; t.proc *= 0.5; t.spell *= 0.5; t.heal *= 0.5;
        } else {
          // Failed evade — no hate change, but count the attempt so a rogue
          // can see their evade success rate in the breakdown column.
          t.procDetail['Evade (failed)'] = (t.procDetail['Evade (failed)'] || 0) + 1;
        }
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
      // Charm-spell cast → stage its class + duration so the next charm-land
      // (gauge or log) can attach a duration bar to the session. Self-cast only
      // (no attacker = the builder's own character cast it); matched to the land
      // by a short time window, mirroring _pendingDireCharm.
      if (!event.attacker) {
        const sl = String(spell).toLowerCase();
        const ci = CHARM_SPELLS.get(sl);
        // The `name` field on _pendingCharmSpell lets the charm overlay show
        // which spell opened the session (Allure / Boltran's / …) in its
        // "pending charm staged?" diagnostic line.
        if (ci) _pendingCharmSpell = { cls: ci.cls, dur: ci.dur, name: spell, owner: this.character || null, ts: Date.now() };
        // Direct-hate AAs / spells — Voice of Thule, Disruptive Persecution,
        // Hate's Attraction, etc. — never produce a damage line, so they're
        // invisible to the rest of the threat math. Bump the caster's spell
        // bucket by the catalog hate so the Threat overlay reads honestly.
        // procDetail also records the cast so a tank can see WHAT AA they're
        // leaning on across the fight.
        const ch = CAST_HATE[sl];
        if (ch !== undefined && this.character) {
          if (!this.threatBy.has(this.character)) {
            this.threatBy.set(this.character, { swing: 0, proc: 0, spell: 0, heal: 0, dmg: 0, healRaw: 0, procDetail: {} });
          }
          const ct = this.threatBy.get(this.character);
          ct.spell += ch;
          ct.procDetail[spell] = (ct.procDetail[spell] || 0) + 1;
        }
      }
      // Bard melody tracker — singing-only (the parseEvent split tags bard
      // songs with event.singing=true). Move-to-front a song-name cycle per
      // character so the melody overlay can show the twist queue + the
      // last-known position when the bard stops melodying. Self-cast only.
      // Melody tracker accepts BOTH bard songs (singing) AND any other cast
      // (casting). A wizard/cleric/etc. running /melody # # # # cycles spell
      // gems with cast + recast timing; we still want to show them the
      // rotation. The cast_kind flag lets the overlay pick the right cast-
      // time default (bard = 3s, anyone else = look up from eqemu_spells
      // via the bot or fall back to a sensible per-spell default).
      if (!event.attacker && this.character) {
        _bumpBardMelody(this.character, spell, Date.parse(event.ts) || Date.now(), { kind: event.singing ? 'song' : 'spell' });
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
          this.threatBy.set(healer, { swing: 0, proc: 0, spell: 0, heal: 0, dmg: 0, healRaw: 0, procDetail: {} });
        }
        const ht = this.threatBy.get(healer);
        ht.heal += event.amount * 0.5;             // threat-weighted (Tanks meter)
        ht.healRaw = (ht.healRaw || 0) + event.amount;   // raw healing (per-fight overlay)
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
        this.bossKillConfirmed = true;
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
    // Commit any buffered DS attribution so a fight that ends with a damage
    // line but no flavor line still credits the tank (with ability='non-melee').
    if (this._dsPending) this._commitDsPending();
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
      // Prefix DS-tagged damage with `ds:` so the rollup's by_skill JSONB
      // distinguishes proc damage (a tank's thorns / halo of light /
      // unnamed Quarm "non-melee") from melee + direct casts under the
      // SAME base ability name. Readers walk by_skill keys and any
      // `ds:*` entry is DS. Total_damage / total_hits stay unprefixed —
      // they're still the character's full output, DS included.
      let skillKey = (ev.ability ? String(ev.ability) : 'unknown').slice(0, 64);
      if (ev.ds) skillKey = 'ds:' + skillKey;

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
        // True only when the boss's death log line was observed for
        // bossName. False when bossName was guessed from top-damaged target
        // after a 120s idle flush (= "engaged but didn't die"). The bot
        // gates auto-kill on this so wipes and brief pulls don't move
        // boards.
        confirmed_kill: this.bossKillConfirmed,
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
        who_data:    whoData.size > 0
          ? Array.from(whoData.values()).filter(_isRegistryWho)
          : undefined,
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
        // Damage-shield reflects observed during this fight, keyed by
        // ability name. Each entry: { count, total, min, max, examples[] }.
        // Fixed-value DS (min == max) is distinguishable from variable
        // (Elemental Illusion / clickies / songs) at render time.
        ds_reflects: (() => {
          if (this.dsReflects.size === 0) return undefined;
          const out = {};
          for (const [k, v] of this.dsReflects.entries()) out[k] = v;
          return out;
        })(),
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
    // Mirror to the per-character map so the 2-min stale window applies
    // independently per character (a multi-boxer's other character can
    // still be mid-fight while this one wraps up).
    if (this.character && stats.currentEncounterThreatByChar) {
      const k = String(this.character).toLowerCase();
      if (stats.currentEncounterThreatByChar[k]) {
        stats.currentEncounterThreatByChar[k] = { ...stats.currentEncounterThreatByChar[k], flushedAt: Date.now() };
      }
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
  let buf;
  try { buf = fs.readFileSync(QUEUE_FILE); }   // Buffer (up to ~2GB) — never a giant string
  catch (err) { console.warn(`[upload-queue] could not read queue file (${err.message}); starting empty`); return; }
  try {
    // Detect format from the first non-whitespace byte: '{' → legacy
    // single-object `{ "pending": [...] }`; anything else → NDJSON (one entry
    // per line, the current format). Legacy files are necessarily small (the
    // old code couldn't successfully WRITE an oversized queue), so a one-shot
    // string parse is safe there.
    let i = 0;
    while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++;
    if (buf[i] === 0x7b /* '{' */) {
      const raw = JSON.parse(buf.toString('utf8'));
      if (Array.isArray(raw?.pending)) _uploadQueue = raw.pending;
    } else {
      // NDJSON — walk the buffer splitting on '\n' (0x0a) so we only ever
      // stringify one (small) line at a time. A single corrupt line is
      // skipped rather than nuking the whole queue.
      const out = [];
      let start = 0;
      for (let j = 0; j <= buf.length; j++) {
        if (j === buf.length || buf[j] === 0x0a) {
          if (j > start) {
            const line = buf.toString('utf8', start, j).trim();
            if (line) { try { out.push(JSON.parse(line)); } catch { /* skip bad line */ } }
          }
          start = j + 1;
        }
      }
      _uploadQueue = out;
    }
    console.log(`[upload-queue] loaded ${_uploadQueue.length} pending entr${_uploadQueue.length === 1 ? 'y' : 'ies'} from disk`);
  } catch (err) {
    // The file exists but couldn't be parsed at all — move it aside (instead
    // of silently dropping its contents) so the user can recover or report it.
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
//
// Persisted as NDJSON (one entry per line) rather than one
// `JSON.stringify({ pending: [...] })` blob. During a big --since backfill the
// queue holds thousands of entries, each an encounter payload up to 10MB —
// serializing the WHOLE array into a single string blew past V8's ~512MB
// max-string-length cap and threw "Invalid string length" on every save,
// silently losing crash-recovery (hundreds of failures seen in the field).
// Stringifying each entry on its own keeps every string tiny; we stream them
// to the fd so the big buffer never has to exist either.
const _QUEUE_ENTRY_MAX_BYTES = 64 * 1024 * 1024; // one entry should never near this
function _flushQueueToDiskSync() {
  if (_queueSaveTimer) { clearTimeout(_queueSaveTimer); _queueSaveTimer = null; }
  const tmp = QUEUE_FILE + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    for (const entry of _uploadQueue) {
      let line;
      try { line = JSON.stringify(entry); }
      catch (e) {
        // A single circular/unserializable entry — skip it rather than abort
        // the whole save (which would forfeit the rest of the queue on crash).
        console.warn(`[upload-queue] dropping unserializable entry ${entry && entry.id}: ${e.message}`);
        continue;
      }
      if (line.length > _QUEUE_ENTRY_MAX_BYTES) {
        console.warn(`[upload-queue] skipping oversized entry ${entry && entry.id} (${Math.round(line.length / 1048576)}MB) from persistence`);
        continue;
      }
      fs.writeSync(fd, line + '\n');
    }
    try { fs.fsyncSync(fd); } catch { /* best effort */ }
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (err) {
    console.warn(`[upload-queue] save failed: ${err.message}`);
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
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
    case 'pvp_assists':     return base + '/pvp_assists';
    case 'bosskill':        return base + '/bosskill';
    case 'lockout':         return base + '/lockout';
    case 'historical_chat': return base + '/historical_chat';
    case 'fun_event':       return base + '/fun_event';
    case 'faction':         return base + '/faction';
    case 'pop_flag':        return base + '/pop_flags';
    case 'quarmy':          return base + '/quarmy';
    case 'buff_cast':       return base + '/buff_casts';
    case 'tells':           return base + '/tells';
    case 'threat_snapshot': return base + '/threat-snapshot';
    case 'raid_roster':     return base + '/raid-roster';
    case 'trigger':         return base + '/trigger';
    case 'trigger_relay':   return base + '/trigger-relay';
    case 'quake':           return base + '/quake';
    case 'casting':         return base + '/casting';
    default:                return botUrl;
  }
}

// Decode Zeal's type-5 raid sample and upload the roster (name/class/group/
// level/rank per member) so the bot can drive the group-based /buffs grid.
// Debounced: only uploads when the composition changes, or every 60s as a
// heartbeat to keep captured_at fresh (so the read window on /buffs sees
// "still in raid"). The raid event is identical from every member's view, so
// any one running agent uploading it is sufficient — the bot dedups latest.
let _raidRosterLastUpload = 0;
let _raidRosterLastHash   = '';
function _maybeUploadRaidRoster(sample) {
  try {
    if (!sample || !sample.data) return;
    const members = JSON.parse(sample.data);
    if (!Array.isArray(members) || members.length === 0) return;
    // Build a name(lower) → hp_pct map from every Zeal gauge a watched
    // character can SEE. The user is in some group; Zeal slot != 1/6/16 with
    // a name `text` are their groupmates' HP gauges. So a Mimic-running raider
    // broadcasts HP for the other ~5 people in their group. Each Mimic agent
    // only sees ITS own group, so the bot's last-write-wins upsert merges
    // contributions from every Mimic raider into a guild-wide HP view.
    const liveHpByName = new Map();
    for (const ch of Object.keys(_zealState || {})) {
      const st = _zealState[ch];
      if (!st) continue;
      // Self HP (slot 1 in the Zeal pipe wire format) — attribute to the
      // watched character's own name.
      if (typeof st.self_hp_pct === 'number') liveHpByName.set(ch.toLowerCase(), st.self_hp_pct);
      // Group members (gauges with text + non-self/target/pet slots).
      if (Array.isArray(st.gauges)) {
        for (const g of st.gauges) {
          if (!g || !g.text || g.hp_pct == null) continue;
          if (g.slot === 1 || g.slot === 6 || g.slot === 16) continue;   // self / target / pet
          liveHpByName.set(String(g.text).toLowerCase(), g.hp_pct);
        }
      }
    }
    const compact = members
      .filter(m => m && m.name)
      .map(m => {
        const hp = liveHpByName.get(String(m.name).toLowerCase());
        return {
          name:   String(m.name),
          class:  m.class != null ? String(m.class) : null,
          group:  m.group != null ? String(m.group) : null,
          level:  m.level != null ? String(m.level) : null,
          rank:   m.rank  != null ? String(m.rank)  : null,
          hp_pct: typeof hp === 'number' ? Math.max(0, Math.min(100, Math.round(hp))) : null,
        };
      });
    if (compact.length === 0) return;
    // Refresh the local raid-member lookup that trigger actions consult via
    // require_raid_member. Lowercased names only — matched against captured
    // values like victim/target. Replaces (not merges) so a raider leaving
    // the raid clears them out of the set on the next Zeal Type 5 fire.
    _raidRosterMembers.clear();
    for (const m of compact) _raidRosterMembers.add(String(m.name).toLowerCase());
    // Hash composition only — NOT HP. HP changes constantly in combat and we
    // don't want every 1% drop to fire an upload. Heartbeat (10s) refreshes HP
    // on a cadence the /raid page can show "live-ish" without spam.
    const hash = compact.map(m => m.name + ':' + m.group + ':' + m.class).sort().join('|');
    const now = Date.now();
    if (hash === _raidRosterLastHash && (now - _raidRosterLastUpload) < 10000) return;
    _raidRosterLastHash   = hash;
    _raidRosterLastUpload = now;
    enqueueUpload('raid_roster', { members: compact });
  } catch { /* malformed sample — skip */ }
}

// The operator's "main" box, used to attribute operator-level uploads
// (chat/pvp/fun_event/historical_chat) so the admin board shows the player
// instead of "(unknown)". Prefers an explicit --character (the operator's
// declared identity), else the first real-looking watched-log character.
// Computed lazily so it picks up watched logs registered after startup.
let _primaryCharacterOverride = null;  // set from args.flags.character in main()
function _primaryCharacter() {
  const looksReal = (c) => c && /^[A-Z][a-z]+$/.test(c);
  if (looksReal(_primaryCharacterOverride)) return _primaryCharacterOverride;
  const wls = (stats && stats.watchedLogs) || [];
  for (const w of wls) if (looksReal(w && w.character)) return w.character;
  return null;
}

function enqueueUpload(kind, payload) {
  // Cross-instance guard: only the elected uploader sends. A read-only
  // instance (another Parser/Mimic on this machine already owns the lock)
  // drops outbound uploads so the same line isn't posted twice. Its local
  // dashboard still works — local stats come from parseEvent, not the queue.
  if (!_isUploaderInstance) return null;
  if (_uploadQueue.length >= QUEUE_MAX_SIZE) {
    const dropped = _uploadQueue.shift();
    _queueCapEvictCount++;
    console.warn(`[upload-queue] cap reached (${QUEUE_MAX_SIZE}); dropped oldest ${dropped.kind} from ${new Date(dropped.queued_at).toISOString()}`);
  }
  // Attribute operator-level streams (chat / pvp / fun_event / historical_chat)
  // to the operator's primary box. These aggregate across every watched log so
  // they carry no per-box `character`, which made the admin board file them all
  // under "(unknown)". Encounters already set their own per-box character and
  // are left untouched.
  if (payload && typeof payload === 'object' && !payload.character) {
    const pc = _primaryCharacter();
    if (pc) payload.character = pc;
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
  // Read-only instance: don't replay the persisted queue either (it may hold
  // entries from a prior run, and the active uploader is covering live data).
  // Draining resumes automatically if this instance takes over the lock.
  if (!_isUploaderInstance) return;
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
  // recentTells: in-memory ring buffer for the LOCAL Mimic dashboard. Populated
  // any time parseTellLine matches on a non-excluded character, regardless of
  // the per-character tell_relay opt-in flag — that flag gates the UPLOAD path,
  // not local display. Never persisted to STATS_FILE (resets each launch), so
  // closing Mimic clears the panel without an explicit "purge" step.
  recentTells:     [],            // last 50 tells: {character, direction, other, text, ts, capturedAt}
  topDamageSaw:    [],            // top 5 high-damage events from others   (1 entry per attacker)
  topDamageDid:    [],            // top 5 high-damage events from the uploader (1 entry per attacker)
  sessionEvents:   0,             // cumulative events parsed this run
  sessionTotalDamage: 0,          // total damage across every parsed damage event
  sessionDamageBy: {},            // { attackerName: cumulativeDamage }
  // Damage-shield aggregate — every line of the form "X is <verb> by Y's <DS spell>
  // for N points of non-melee damage" tagged with ds:true at parse time accumulates
  // here so the Tanks tab can show per-tank DS output and the spells/songs each
  // tank is contributing. Resets between sessions like the rest of these counters.
  damageShield: {},               // { attackerName: { spellName: { count, total } } }
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
  // sessionCrits: per-box melee + spell critical totals (count / summed bonus /
  // biggest single bonus). Powers the "My Crits" panel — only the box's OWN
  // crits are tracked, split melee vs spell. { [name]: { melee:{count,total,max}, spell:{...} } }
  sessionCrits: {},
  // resistedSpells: incoming spells the uploader RESISTED this session. EQ
  // hides the spell name on a mob's "begins to cast a spell" line, but the
  // resist line names it — so this reveals what mobs are actually casting at
  // us. byMob attributes each resist to the mob we were fighting when it
  // landed, so the NPC-cast view can name what a mob's anonymous "a spell"
  // casts actually were. { [spellName]: { count, lastMob, byMob: { [mob]: count } } }
  resistedSpells: {},
  // inboundSpellDamage: spell damage that LANDED on the UPLOADER this session,
  // grouped by caster then spell. Counterpart to resistedSpells (resists) — this
  // is what got through. Only the uploader's own inbound is tracked (EQ logs it
  // with reliable spell + caster attribution; bystander inbound is not). Session
  // counter only; never added to encounter events (so a spell name can never
  // leak into the attacker/character namespace).
  // { [caster]: { total, count, lastSeen, spells: { [spell]: { total, count, max } } } }
  inboundSpellDamage: {},
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
  // Globally last-write-wins for backward compatibility; the per-character
  // map below is the source the DPS overlay should prefer when the agent is
  // watching multiple logs at once (multi-boxers).
  currentEncounterThreat: null,
  // currentEncounterThreatByChar: per-character snapshot keyed on the
  // lowercased character whose log produced the encounter. Lets the DPS
  // overlay show the FOCUSED character's fight even when another character's
  // builder updated more recently. Cleared when the encounter resolves.
  currentEncounterThreatByChar: {},
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
  stats.damageShield       = {};
  stats.abilityStats       = new Map();
  stats.sessionDeaths      = {};
  stats.sessionHealers     = {};
  stats.sessionDefenders   = {};
  stats.sessionMends       = { attempts: 0, success: 0, crit: 0, fail: 0 };
  stats.sessionCritHeals   = {};
  stats.sessionCrits       = {};
  stats.resistedSpells     = {};
  stats.inboundSpellDamage = {};
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

// ── Cross-instance uploader lock ───────────────────────────────────────────
// The PID file above lives next to THIS index.js, so it's per-install. Mimic
// bundles its own copy of the agent and Parser runs another — different
// __dirname, different PID file — so they never see each other. Result: a
// Parser + Mimic (or two Parsers) all tail the SAME logs and upload the SAME
// chat/encounters → duplicate Discord posts + double-counted parses.
//
// This lock elects ONE uploader per machine. It lives in the OS temp dir, so
// every install on the box shares it. The holder uploads; everyone else still
// tails and shows its own local dashboard, but suppresses uploads. If the
// holder exits or crashes, a non-uploader takes over (lock is "stale" when the
// pid is dead OR the heartbeat is older than the TTL).
const UPLOADER_LOCK_FILE    = path.join(os.tmpdir(), 'wolfpack-logsync-uploader.json');
const UPLOADER_LOCK_TTL_MS  = 45_000;   // stale after this long without a heartbeat
const UPLOADER_HEARTBEAT_MS = 15_000;   // holder refreshes; others re-check to take over
let _isUploaderInstance   = true;       // assume yes until the election says otherwise
let _uploaderLockHolder   = null;       // last-seen holder info (for the dashboard)
let _uploaderLockTimer    = null;
let _uploaderLockStartedAt = null;

function _readUploaderLock() {
  try {
    if (!fs.existsSync(UPLOADER_LOCK_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(UPLOADER_LOCK_FILE, 'utf8'));
    return (raw && raw.pid) ? raw : null;
  } catch { return null; }
}

function _uploaderLockIsLive(lock) {
  if (!lock || !lock.pid) return false;
  if (lock.pid === process.pid) return true;
  try { process.kill(lock.pid, 0); } catch { return false; }   // dead pid
  const hb = Date.parse(lock.heartbeatAt || lock.startedAt || 0) || 0;
  return (Date.now() - hb) <= UPLOADER_LOCK_TTL_MS;            // stale heartbeat = not live
}

function _writeUploaderLock(webPort) {
  if (!_uploaderLockStartedAt) _uploaderLockStartedAt = new Date().toISOString();
  try {
    fs.writeFileSync(UPLOADER_LOCK_FILE, JSON.stringify({
      pid:          process.pid,
      webPort:      webPort || null,
      client:       process.env.WOLFPACK_CLIENT || 'parser',
      startedAt:    _uploaderLockStartedAt,
      heartbeatAt:  new Date().toISOString(),
      agentVersion: AGENT_VERSION,
    }));
    return true;
  } catch { return false; }
}

// Grab the lock if it's free or stale. Returns true if we now hold it.
function _tryAcquireUploaderLock(webPort) {
  const existing = _readUploaderLock();
  if (existing && existing.pid !== process.pid && _uploaderLockIsLive(existing)) {
    _uploaderLockHolder = existing;
    return false;
  }
  const ok = _writeUploaderLock(webPort);
  if (ok) _uploaderLockHolder = _readUploaderLock();
  return ok;
}

function _releaseUploaderLock() {
  const cur = _readUploaderLock();
  if (cur && cur.pid === process.pid) {
    try { fs.unlinkSync(UPLOADER_LOCK_FILE); } catch {}
  }
}

// Elect once at startup, then maintain: the holder heartbeats; a non-holder
// watches for a stale lock and takes over. Call after the web port is known.
function startUploaderElection(webPort) {
  _isUploaderInstance = _tryAcquireUploaderLock(webPort);
  if (_isUploaderInstance) {
    console.log(`${ANSI.green}[uploader] this instance is the active uploader.${ANSI.reset}`);
  } else {
    const h = _uploaderLockHolder || {};
    const where = h.webPort ? ` — its dashboard: http://localhost:${h.webPort}` : '';
    console.log(`${ANSI.yellow}[uploader] another agent is already uploading (${h.client || '?'}, pid ${h.pid})${where}. This instance runs read-only (no uploads) to avoid duplicates.${ANSI.reset}`);
  }
  if (_uploaderLockTimer) clearInterval(_uploaderLockTimer);
  _uploaderLockTimer = setInterval(() => {
    if (_isUploaderInstance) {
      // Re-assert; step down only if another LIVE instance somehow took it.
      const cur = _readUploaderLock();
      if (cur && cur.pid !== process.pid && _uploaderLockIsLive(cur)) {
        _isUploaderInstance = false;
        _uploaderLockHolder = cur;
        console.log('[uploader] another instance took the lock — stepping down to read-only.');
      } else {
        _writeUploaderLock(webPort);
        _uploaderLockHolder = _readUploaderLock();
      }
    } else {
      const cur = _readUploaderLock();
      _uploaderLockHolder = cur;
      if (!_uploaderLockIsLive(cur) && _tryAcquireUploaderLock(webPort)) {
        _isUploaderInstance = true;
        console.log(`${ANSI.green}[uploader] previous uploader is gone — taking over uploads.${ANSI.reset}`);
      }
    }
  }, UPLOADER_HEARTBEAT_MS);
  process.on('exit', _releaseUploaderLock);
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
      sessionCrits:       stats.sessionCrits,
      resistedSpells:     stats.resistedSpells,
      inboundSpellDamage: stats.inboundSpellDamage,
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
    if (raw.sessionCrits)       stats.sessionCrits       = raw.sessionCrits;
    if (raw.resistedSpells)     stats.resistedSpells     = raw.resistedSpells;
    if (raw.inboundSpellDamage) stats.inboundSpellDamage = raw.inboundSpellDamage;
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
  // Active-character signal — the watched character whose Zeal pipe most
  // recently sent a sample (i.e. the EQ window the user is currently in).
  // Lets overlays focus on JUST the focused character — clears pet/charm/
  // damage when the user alt-tabs to a different EQ window. A 10s recency
  // window keeps "active" stable across brief Zeal stutters; null when no
  // sample has arrived recently.
  const _activeCharacter = (() => {
    const now = Date.now();
    let best = null, bestTs = 0;
    for (const ch of Object.keys(_zealState || {})) {
      const st = _zealState[ch];
      const ts = (st && st.updatedAt) || 0;
      if (ts > bestTs && (now - ts) < 60_000) { bestTs = ts; best = ch; }
    }
    return best;
  })();

  return {
    version:            AGENT_VERSION,
    startedAt:          stats.startedAt,
    activeCharacter:    _activeCharacter,
    sessionEvents:      stats.sessionEvents,
    sessionTotalDamage: stats.sessionTotalDamage,
    sessionDamageBy:    stats.sessionDamageBy,
    recentParses:       stats.recentParses,
    recentTells:        stats.recentTells,
    damageShield:       stats.damageShield,
    topDamageSaw:       stats.topDamageSaw,
    topDamageDid:       stats.topDamageDid,
    sessionDefenders:   stats.sessionDefenders,
    sessionHealers:     healersOut,
    sessionCritHeals:   stats.sessionCritHeals || {},
    sessionCrits:       stats.sessionCrits || {},
    resistedSpells:     stats.resistedSpells || {},
    inboundSpellDamage: stats.inboundSpellDamage || {},
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
    // Mimic Discord login: signed_in lets the dashboard show a "Signed in as
    // <name>" badge in the header + a soft "sign in to unlock cross-machine
    // sync + officer tools" nudge when absent. Identity is the bot's canonical
    // reply (refreshed on latest-version polls); presence of the token alone
    // doesn't prove the token is still valid, so the badge uses identity.
    mimicSignedIn:      !!_mimicSessionToken,
    mimicIdentity:      _mimicIdentity,
    // Prefer the focused character's encounter when the agent is watching
    // multiple logs (multi-boxer). Falls back to the last-write-wins global
    // when no per-character entry exists, preserving single-character UX.
    currentEncounterThreat: (() => {
      const map = stats.currentEncounterThreatByChar || {};
      const active = _activeCharacter;
      if (active && map[active.toLowerCase()]) return map[active.toLowerCase()];
      return stats.currentEncounterThreat;
    })(),
    currentEncounterThreatByChar: stats.currentEncounterThreatByChar || {},
    // Cross-instance uploader status. active=true → this instance is the one
    // sending data to the bot; false → another Parser/Mimic on this machine
    // owns the upload lock and we're read-only (local dashboard still live).
    uploader: {
      active: _isUploaderInstance,
      holder: (!_isUploaderInstance && _uploaderLockHolder)
        ? { client: _uploaderLockHolder.client || null, webPort: _uploaderLockHolder.webPort || null }
        : null,
    },
    // Charm-pet tick tracker — array form so the dashboard can render
    // a 6s countdown to next mob tick / next charm check. Sorted most-
    // recently-updated first; capped to 12 to keep the payload small.
    charmPets: (() => {
      // Reconcile against the live Zeal pet gauge FIRST: open a session the
      // instant a charmed pet appears in slot 16 (enchanter OR bard charm —
      // class-agnostic), and close stale sessions whose pet has dropped from
      // the gauge (the Quarm break line isn't name-matchable, so without this
      // broken charms pile up — the "two charms showing at once" bug).
      _reconcileGaugeCharms();
      // Live pet HP from Zeal gauge slot 16, keyed by the owner's character.
      // Only the local uploader's own pet has gauge data (Zeal reports only the
      // local client's bars), which is exactly the pet the charm overlay cares
      // about. Bystanders' pets simply have no HP and render as before.
      const livePet = _livePetHpByOwner();
      // The charm tracker is a RECHARM timer for YOUR OWN charm. Bystander
      // charms — other enchanters' pets, picked up via the zone-visible
      // "<Mob> regards <Charmer> as an ally" line for pet-damage attribution —
      // must NOT show here, or a non-charmer (monk, etc.) sees a charm they
      // don't have ("I don't have a charm pet"). Filter to sessions owned by
      // one of the uploader's watched characters. Until watchedLogs loads
      // (myChars empty) we don't filter, to avoid hiding a real self-charm
      // during startup.
      const myChars = new Set((stats.watchedLogs || [])
        .map(w => w && w.character && String(w.character).toLowerCase())
        .filter(Boolean));
      const arr = [];
      for (const [key, info] of _charmTickTracker.entries()) {
        if (myChars.size > 0 && (!info.owner || !myChars.has(String(info.owner).toLowerCase()))) continue;
        const ownerLower = info.owner ? String(info.owner).toLowerCase() : null;
        const lp = ownerLower ? livePet.get(ownerLower) : null;
        // The owner's /pet health buff set (+ any landing timers) belongs to
        // whatever pet they currently have — for a charmer that's the charm.
        const rep = ownerLower ? _petHealthByOwner.get(ownerLower) : null;
        const petBuffs = ownerLower ? petBuffsForOwner(ownerLower) : [];
        arr.push({
          key,
          pet: info.pet,
          owner: info.owner,
          last_tick_at:  info.last_tick_at,
          last_event:    info.last_event,
          is_active:     info.is_active,
          // broke_at lets the overlay keep a broken pet visible (tick counter
          // running) for the 5-min linger window + render the recharm state.
          broke_at:      info.broke_at || null,
          started_at:    info.started_at,
          is_dire_charm: info.is_dire_charm,
          charm_class:   info.charm_class  || null,
          duration_sec:  info.duration_sec != null ? info.duration_sec : null,
          pet_hp_pct:    lp && lp.hp_pct != null ? lp.hp_pct : (rep ? rep.hp_pct : null),
          pet_buffs:     petBuffs.length ? petBuffs : null,
          pet_health_observed_at: rep ? rep.last_seen_at : null,
        });
      }
      arr.sort((a, b) => (b.last_tick_at || 0) - (a.last_tick_at || 0));
      return arr.slice(0, 12);
    })(),
    // Charm-tracking diagnostic — surfaces the four checkpoints the charm
    // detection has to pass through (cast seen → pending staged → slot 16
    // populated → tracker entry created), so a user can SEE where the
    // pipeline stopped if their charm isn't lighting up. Renders on the
    // Triggers tab as a small "🐺 Charm diagnostic" card.
    charmDiag: (() => {
      const now = Date.now();
      const out = {
        now,
        recent_self_casts: [],
        pending_charm:     null,
        charm_pending_window_ms: PENDING_CHARM_WINDOW_MS,
        slot16_by_char:    [],
        tracker:           [],
        charm_spell_names: [],
      };
      // Recent self-casts across every watched character (newest last so
      // the dashboard renders newest first when reversed). Only entries
      // matching a CHARM_SPELLS spell are surfaced — keeps the panel small
      // and focused. 30s window.
      const CHARM_NAMES = new Set();
      for (const k of CHARM_SPELLS.keys()) CHARM_NAMES.add(k);
      out.charm_spell_names = Array.from(CHARM_NAMES).sort();
      for (const [chLower, arr] of _recentSelfCast.entries()) {
        for (const rc of (arr || [])) {
          if (!rc || !rc.spellLower) continue;
          if (now - rc.atMs > 30_000) continue;
          out.recent_self_casts.push({
            character:   chLower,
            spell:       rc.name,
            spell_lower: rc.spellLower,
            is_charm:    CHARM_NAMES.has(rc.spellLower),
            cast_at_ms:  rc.atMs,
            ago_secs:    Math.round((now - rc.atMs) / 1000),
            target:      rc.target || null,
          });
        }
      }
      out.recent_self_casts.sort((a, b) => b.cast_at_ms - a.cast_at_ms);
      out.recent_self_casts = out.recent_self_casts.slice(0, 8);
      // Pending charm — what was staged by the last cast detection.
      if (_pendingCharmSpell) {
        const age = now - _pendingCharmSpell.ts;
        out.pending_charm = {
          spell:    _pendingCharmSpell.name || '(unknown)',
          class:    _pendingCharmSpell.cls,
          dur_sec:  _pendingCharmSpell.dur,
          owner:    _pendingCharmSpell.owner,
          age_ms:   age,
          expires_in_ms: Math.max(0, PENDING_CHARM_WINDOW_MS - age),
          expired:  age > PENDING_CHARM_WINDOW_MS,
        };
      }
      // Zeal slot 16 per character + whether it would pass the
      // article-prefix filter that _reconcileGaugeCharms uses to decide
      // "this is a charm pet".
      for (const ch of Object.keys(_zealState)) {
        const st = _zealState[ch];
        if (!st || !Array.isArray(st.gauges)) continue;
        const petG = st.gauges.find(g => g && g.slot === 16 && g.text);
        out.slot16_by_char.push({
          character:  ch,
          slot16_text: petG ? String(petG.text) : null,
          passes_article_filter: petG ? /^an?\s+/i.test(String(petG.text)) : false,
          updated_age_secs: st.updatedAt ? Math.round((now - st.updatedAt) / 1000) : null,
        });
      }
      // Active charm tracker entries.
      for (const [k, info] of _charmTickTracker.entries()) {
        out.tracker.push({
          key:           k,
          pet:           info.pet,
          owner:         info.owner,
          is_active:     info.is_active,
          is_dire:       !!info.is_dire_charm,
          charm_class:   info.charm_class,
          duration_sec:  info.duration_sec,
          started_at:    info.started_at,
          last_tick_at:  info.last_tick_at,
          broke_at:      info.broke_at,
        });
      }
      return out;
    })(),
    // Bard melody — per watched character, the songs in /melody slot order
    // + the current cast position. Powers the melody overlay's vertical
    // list with ▶ play icon, casting bar, and the "stopped here" marker
    // for resume-after-interrupt. Idle melodies (no sing for MELODY_IDLE_MS)
    // drop out so the overlay empties when the bard zones / logs off.
    bardMelody: (() => {
      const myChars = new Set((stats.watchedLogs || [])
        .map(w => w && w.character && String(w.character).toLowerCase())
        .filter(Boolean));
      const now = Date.now();
      const out = {};
      // _zealState keys are casing-sensitive (the character's display name as
      // Mimic pushes it). Build a lowercase index so we can match the melody
      // key (always lowercased) against the Zeal feed.
      const zealByLower = new Map();
      for (const ch of Object.keys(_zealState || {})) zealByLower.set(ch.toLowerCase(), _zealState[ch]);
      for (const [k, state] of _bardMelody.entries()) {
        if (myChars.size > 0 && !myChars.has(k)) continue;
        if (!state) continue;
        // Skip only when there is NOTHING to surface — no songs AND no
        // active melody flag AND no currently-casting Zeal label. The
        // melody-start log line populates melodyActive even before the
        // first song name lands, so an empty-order state with an active
        // melody flag is still meaningful.
        const hasOrder = state.order && state.order.length > 0;
        if (!hasOrder && !state.melodyActive) continue;
        if (state.lastChangeAt && (now - state.lastChangeAt) > MELODY_IDLE_MS) continue;
        // Enrich each song with its CURRENT buff-window duration when the
        // song's effect is visible in Zeal's buff slots. Match the song's
        // own name first, then fall back to the alias table for songs whose
        // landing buff has a different name (Niv's Melody of Preservation →
        // Breath of Harmony, etc.). Ticks count down by 1 every 6s; the
        // overlay multiplies by 6 to show MM:SS remaining.
        const zealSt = zealByLower.get(k);
        const zealBuffs = (zealSt && Array.isArray(zealSt.buffs)) ? zealSt.buffs : [];
        const enrichedOrder = state.order
          .map(entry => {
            // Tolerate the v3.0.49 string-only shape so older saved state keeps
            // working: { name } object OR bare string both render.
            const e = (typeof entry === 'string') ? { name: entry } : (entry || { name: '?' });
            const buff = _findSongBuff(e.name, zealBuffs);
            const out = { name: e.name, kind: e.kind || state.kind || 'song' };
            if (buff && typeof buff.ticks === 'number' && buff.ticks > 0) {
              out.remaining_ticks = buff.ticks;
              out.remaining_secs  = buff.ticks * 6;
              out.buff_name       = buff.name;
            }
            // Per-song cast time. Precedence:
            //   1. ITEM cast time attached to the entry by _bumpBardMelody
            //      when a "Your <item> begins to glow" line preceded the cast
            //      (Robe of the Spring → 12s Skin like Nature).
            //   2. SPELL catalog cast time (most clickies + manual casts).
            //   3. (Fallback handled overlay-side: 3s for songs, 4s for
            //      generic spells.)
            if (typeof e.cast_ms === 'number' && e.cast_ms > 0) {
              out.cast_ms = e.cast_ms;
            } else {
              const cat = _spellByNameLower.get(String(e.name).toLowerCase());
              if (cat && typeof cat.cast_ms === 'number' && cat.cast_ms > 0) {
                out.cast_ms = cat.cast_ms;
              }
            }
            return out;
          });
        // Zeal label 134 = the spell name being cast RIGHT NOW. When set
        // we surface it on the melody so the overlay can show "Now casting:
        // X" verbatim — useful for non-bard /melody rotations where the
        // log-line "begin casting" is the only other signal.
        const nowCasting = (zealSt && zealSt.casting && String(zealSt.casting).trim()) || null;
        // Bard utility-buff strip — Amplification (from Voice of the Serpent
        // clicky) and Resonance/Harmonize (from Shadowsong Cloak). Resonance
        // and Harmonize are mutually exclusive — a bard with Harmonize never
        // uses Resonance. We surface whichever the buff window currently has
        // so the overlay can show a countdown or "off". Non-bard melody users
        // don't have these clickies; they'll see the strip omitted.
        // Two-pass match: exact first (high confidence), then substring fallback
        // for buff-slot name variants we haven't catalogued. Required because
        // Quarm sometimes shows the LANDING buff name in the slot (e.g. Niv`s
        // Melody of Preservation lands as "Breath of Harmony"), but on other
        // versions the slot keeps the cast name — and we can't tell which is
        // which without manually verifying every spell.
        // Strip everything that isn't [a-z0-9] so 'Niv\`s Melody of Preservation'
        // (with backtick) and "Niv's Melody of Preservation" (with apostrophe)
        // both reduce to 'nivsmelodyofpreservation' and match each other.
        // Unicode curly apostrophe (’) gets the same treatment. This was the
        // exact failure mode user hit on Breath of Harmony / Niv's — buff was
        // sitting in their buff slots, alias list contained the right phrase,
        // but the punctuation between the two didn't agree.
        const _slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        // Buff candidate filter — name required, but tick value is OPTIONAL.
        // Zeal sometimes ships a slot with name+null ticks (e.g. when the
        // buff just landed or is in a short song-window slot that doesn't
        // carry tick metadata). We still want to surface "buff is present"
        // even when we can't render a countdown, so the row reads "on" or
        // "??" instead of "off". Caller checks `ticks > 0` before computing
        // remaining_secs.
        const _candidate = (b) => !!(b && b.name);
        const _findBuff = (names) => {
          // Pass 1: exact match (punctuation-insensitive via _slug). Trim
          // handles trailing-space noise sometimes seen in Zeal's pipe.
          for (const b of zealBuffs) {
            if (!_candidate(b)) continue;
            const bSlug = _slug(b.name.trim());
            for (const n of names) if (bSlug === _slug(n)) return b;
          }
          // Pass 2: substring either direction. Threshold 4 chars (was 6) so
          // short aliases ('amp', 'niv') resolve when the buff label uses
          // a shortened form.
          for (const b of zealBuffs) {
            if (!_candidate(b)) continue;
            const bSlug = _slug(b.name.trim());
            for (const n of names) {
              const nSlug = _slug(n);
              if (nSlug.length >= 4 && (bSlug.includes(nSlug) || nSlug.includes(bSlug))) return b;
            }
          }
          // Pass 3: first significant word of each alias. Catches the case
          // where EQ's buff window strips the bardic suffix — e.g. spell is
          // "Niv\`s Melody of Preservation" but slot label is just "Niv\`s".
          // Checks BOTH directions so an alias of 'amplification' matches a
          // Zeal slot named just 'amp', and vice versa.
          for (const b of zealBuffs) {
            if (!_candidate(b)) continue;
            const bSlug = _slug(b.name.trim());
            for (const n of names) {
              const firstWord = _slug(n.split(/\s+/)[0]);
              if (!firstWord || firstWord.length < 3) continue;
              // Either direction wins so a shorter-than-alias slot label
              // (Amped/Amp for Amplification) still resolves.
              if (bSlug.startsWith(firstWord) || firstWord.startsWith(bSlug)) return b;
            }
          }
          return null;
        };
        // Raw debug slots (from Mimic's broader Type-1 dump) — searched as a
        // FALLBACK after zealBuffs misses. Bard short-duration songs may land
        // in label IDs outside the 45-59 / 135-140 ranges Mimic currently
        // promotes into `buffs[]`, so we also scan the raw debug dump using
        // the same matcher to catch them. Same name+ticks shape so _findBuff
        // / candidacy logic transfers.
        const rawDebugBuffs = (zealSt && Array.isArray(zealSt.buffsRawDebug))
          ? zealSt.buffsRawDebug.map(r => ({ name: r.value, ticks: r.ticks, _fromRaw: true, _slotId: r.id }))
          : [];
        const _findBuffFallback = (names) => {
          for (const b of rawDebugBuffs) {
            if (!_candidate(b)) continue;
            const bSlug = _slug(b.name.trim());
            for (const n of names) {
              const nSlug = _slug(n);
              if (nSlug.length >= 4 && (bSlug === nSlug || bSlug.includes(nSlug) || nSlug.includes(bSlug))) return b;
            }
          }
          return null;
        };
        const _resolveBuff = (names) => _findBuff(names) || _findBuffFallback(names);
        const ampBuff = _resolveBuff(['amplification']);
        const harBuff = _resolveBuff(['harmonize']);
        const resBuff = _resolveBuff(['resonance']);
        const accBuff = _resolveBuff(['accelerating chorus', "selo`s accelerating chorus", "selo's accelerating chorus"]);
        const nivBuff = _resolveBuff(['breath of harmony', "niv`s melody of preservation", "niv's melody of preservation"]);
        const natBuff = _resolveBuff(["nature`s melody", "nature's melody"]);
        const _wantedCastNames = ['amplification', 'harmonize', 'resonance',
          "selo`s accelerating chorus", "selo's accelerating chorus", 'accelerating chorus',
          "niv`s melody of preservation", "niv's melody of preservation",
          "nature`s melody", "nature's melody"];
        const nowCastingLower = nowCasting ? nowCasting.toLowerCase() : '';
        const _isCasting = (names) => names.some(n => n === nowCastingLower);
        // bardBuffs strip is bard-only. Gate on BOTH state.kind === 'song'
        // AND the live Zeal class string === 'Bard'. The kind gate alone
        // could leak: state.kind is sticky ("once a song character, always
        // a song character") so a non-bard whose first cast happened to
        // match _isLikelyBardSong would get stuck rendering the bard strip
        // forever, even after switching characters. The class check is the
        // ground truth.
        // "Is this character a Bard?" — Mimic never populates zealSt.class
        // (only HP / zone / buffs / casting flow through the pipe), so the
        // original `zealSt.class === 'Bard'` check was always false in
        // practice. AUTHORITATIVE sources only:
        //   1. whoData class — captured from a real /who line or inferred
        //      from a class-specific ability (Selo's = bard). Survives
        //      across sessions, so real bards resolve within one song.
        //   2. zealSt.class — kept for forward-compat in case Mimic ever
        //      starts populating it.
        // `state.kind === 'song'` used to be a third fallback, but it's
        // sticky across casts and a single mis-tagged line flipped the whole
        // bard UI (Melody title + utility strip) on for non-bards — the
        // overlay then NEVER reverted to "Spell Casting". Class or nothing.
        const wd = (whoData && whoData.get) ? whoData.get(k) : null;
        const isBardClass = !!(wd     && /^bard$/i.test(String(wd.class     || '')))
                         || !!(zealSt && /^bard$/i.test(String(zealSt.class || '')));
        // Buff → info shape. When ticks is unknown (null/0) we still emit
        // `observed:true` so the overlay can render "on" instead of "off" —
        // surfacing buff presence even without a countdown. Source flag
        // distinguishes a primary buff-slot hit from a raw-debug fallback
        // (helpful when reading the dashboard JSON).
        const _info = (b) => {
          if (!b) return null;
          const hasTicks = typeof b.ticks === 'number' && b.ticks > 0;
          return {
            remaining_ticks: hasTicks ? b.ticks : null,
            remaining_secs:  hasTicks ? b.ticks * 6 : null,
            observed: true,
            from_raw_debug: !!b._fromRaw,
            slot_id: b._slotId != null ? b._slotId : null,
          };
        };
        const bardBuffs = (state.kind === 'song' && isBardClass) ? {
          amplification: _info(ampBuff),
          // Prefer Harmonize when both are present (Harmonize replaces Resonance).
          harmonize:     _info(harBuff),
          resonance:     harBuff ? null : _info(resBuff),
          accelerating_chorus: _info(accBuff),
          nivs:          _info(nivBuff),
          natures:       _info(natBuff),
          // Per-row cast indicators — true when the Zeal currentCasting label
          // matches this buff's spell name. Drives a pulsing ▶ next to the
          // row in the overlay so the bard sees which utility is in flight.
          casting: {
            amplification:       _isCasting(['amplification']),
            harmonize_resonance: _isCasting(['harmonize', 'resonance']),
            accelerating_chorus: _isCasting(["selo`s accelerating chorus", "selo's accelerating chorus", 'accelerating chorus']),
            nivs:                _isCasting(["niv`s melody of preservation", "niv's melody of preservation"]),
            natures:             _isCasting(["nature`s melody", "nature's melody"]),
          },
        } : null;
        // Names that get HIDDEN from the main songs list because they have a
        // dedicated row in the bottom strip — keeps the main list focused on
        // the actual /melody rotation rather than utility clickies. Bard rows
        // (state.kind === 'song') get filtered; non-bard /melody (kind='spell')
        // shows everything since they don't have the bottom strip.
        const stripNames = new Set(_wantedCastNames);
        const visibleOrder = (state.kind === 'song')
          ? enrichedOrder.filter(e => !e || !stripNames.has(String(e.name).toLowerCase()))
          : enrichedOrder;
        // Debug: surface the raw buff-slot names so we can see exactly what
        // Zeal is reporting when a utility song doesn't light up its strip
        // row. Plain array of "name (Xt)" strings — capped at 25 to keep
        // /api/state light. Include slots with null/0 ticks (rendered as "?t")
        // so a buff arriving without a tick count is still visible to the
        // diagnostic instead of being silently filtered out.
        const buffSlotsDebug = zealBuffs
          .filter(b => b && b.name)
          .slice(0, 25)
          .map(b => `${b.name} (${typeof b.ticks === 'number' && b.ticks > 0 ? b.ticks + 't' : '?t'})`);
        // Raw Type-1 label dump from Mimic — every labeled entry id+value+ticks
        // that came through the Zeal pipe. Used to diagnose buffs landing in
        // label IDs we don't currently capture as buff slots (e.g. Quarm's
        // bard song window may use a different range than the 45-59/135-140
        // we read). Rendered in OFF chip tooltips so the user can hover and
        // tell us where Amplification/Niv's actually lives.
        const rawDebug = (zealSt && Array.isArray(zealSt.buffsRawDebug))
          ? zealSt.buffsRawDebug.slice(0, 30).map(r => `#${r.id}:${r.value}${typeof r.ticks === 'number' && r.ticks > 0 ? '(' + r.ticks + 't)' : ''}`)
          : [];
        out[k] = {
          character:      k,
          characterClass: (zealSt && zealSt.class) || null,
          isBard:         isBardClass,
          order:          visibleOrder,
          currentPos:     state.currentPos,
          castStartedAt:  state.castStartedAt,
          cycleLength:    state.cycleLength,
          lastChangeAt:   state.lastChangeAt,
          kind:           state.kind || 'song',
          nowCasting,
          melodyActive:   !!state.melodyActive,
          melodyStartedAt: state.melodyStartedAt || null,
          melodyEndedAt:   state.melodyEndedAt || null,
          bardBuffs,
          buffSlotsDebug,
          buffsRawDebug: rawDebug,
        };
      }
      // Bard placeholder — if the active character's Zeal class is Bard but
      // we haven't seen them sing anything yet, emit a stub entry so the
      // overlay can title itself "MELODY" (not "SPELL CASTING") and show
      // the empty "no bard songs yet — start singing" copy. Without this
      // the overlay falls back to the generic spell-cast title because
      // nothing in bardMelody flags the character as a bard.
      try {
        const active = _activeCharacter;
        if (active && !out[active.toLowerCase()]) {
          const k = active.toLowerCase();
          const zSt = zealByLower.get(k);
          const wd  = (whoData && whoData.get) ? whoData.get(k) : null;
          // Same three-source resolution as the real loop above. whoData
          // wins when present (real /who output is the authoritative class);
          // zealSt.class is the future-compat path.
          const cls = (wd && wd.class) || (zSt && zSt.class) || null;
          if (cls && /^bard$/i.test(cls)) {
            out[active.toLowerCase()] = {
              character:      active,
              characterClass: cls,
              isBard:         true,
              order:          [],
              currentPos:     0,
              castStartedAt:  null,
              cycleLength:    0,
              lastChangeAt:   Date.now(),
              kind:           'song',
              nowCasting:     null,
              melodyActive:   false,
              melodyStartedAt: null,
              melodyEndedAt:   null,
              bardBuffs:      null,
              buffSlotsDebug: [],
            };
          }
        }
      } catch (err) { void err; }
      return out;
    })(),
    // SUMMONED-pet view for the Pet tracker overlay (mage/necro/beastlord),
    // EXCLUDING active charms (those render in the charm tracker with the
    // tickdown). Pet NAME + live HP come from Zeal slot 16; the buff SET from
    // /pet health; the TIMERS from observed buff landings (petBuffsForOwner).
    // No tickdown here — just HP + buff counters. Own characters only.
    petHealth: (() => {
      const myChars = new Set((stats.watchedLogs || [])
        .map(w => w && w.character && String(w.character).toLowerCase())
        .filter(Boolean));
      const livePet = _livePetHpByOwner();         // owner → { name, hp_pct }
      // Characters whose Zeal feed is currently fresh — anyone NOT in this set
      // is logged off / linkdead / their EQ client isn't streaming Zeal. The
      // pet-state maps persist across restarts and through linkdeath (by
      // design), so without this gate the user would keep seeing the previous
      // character's pet card after switching toons. Same ZEAL_STALE_MS the
      // live-state uploader uses, so the freshness signal is consistent.
      const liveChars = new Set();
      const now = Date.now();
      for (const ch of Object.keys(_zealState || {})) {
        const st = _zealState[ch];
        if (st && (now - (st.updatedAt || 0)) <= ZEAL_STALE_MS) {
          liveChars.add(String(ch).toLowerCase());
        }
      }
      // Pet names that belong to an ACTIVE charm session → skip (charm tracker).
      const activeCharmPets = new Set();
      for (const [, info] of _charmTickTracker) {
        if (info && info.is_active && info.pet) activeCharmPets.add(String(info.pet).toLowerCase());
      }
      // Owners worth showing: anyone with a live pet, a /pet health report, or
      // a recent landing on their pet — gated below by Zeal-freshness so a
      // logged-off char's stale state doesn't render.
      const owners = new Set([
        ...livePet.keys(),
        ..._petHealthByOwner.keys(),
        ..._petBuffLandings.keys(),
      ]);
      const out = [];
      for (const owner of owners) {
        if (myChars.size > 0 && !myChars.has(owner)) continue;
        // Drop logged-off / LD characters — their pet state is stale even if
        // it's still in the maps because we persist across restarts.
        if (!liveChars.has(owner)) continue;
        const lp = livePet.get(owner);
        const petName = lp ? lp.name : null;
        // Charm pet (slot-16 name starts with a/an, tracked as active charm) →
        // skip; it's in the charm tracker.
        if (petName && activeCharmPets.has(String(petName).toLowerCase())) continue;
        const rep = _petHealthByOwner.get(owner);
        const repFresh = rep && (now - (rep.last_seen_at || 0)) <= PET_HEALTH_TTL_MS;
        const buffs = petBuffsForOwner(owner);
        const hp = lp && lp.hp_pct != null ? lp.hp_pct : (repFresh ? rep.hp_pct : null);
        // Combat stats from observed hits — surfaces dual-wield (two distinct
        // skill buckets) plus the dangerous-number panel (max / avg / count).
        const ps = _petStatsByOwner.get(owner);
        const statsForPet = (ps && ps.pet === petName) ? {
          total_hits:    ps.totalHits,
          total_damage:  ps.totalDamage,
          max_hit:       ps.maxHit,
          avg_hit:       ps.totalHits ? Math.round(ps.totalDamage / ps.totalHits) : 0,
          skills:        ps.skills,           // { skill: { count, total, max } }
          dual_wielding: Object.keys(ps.skills || {}).length >= 2,
          first_seen_at: ps.firstSeenAt,
          last_seen_at:  ps.lastSeenAt,
        } : null;
        // Pet target — populated from "Attacking X Master." command acks.
        // TTL'd so a pet that hasn't acked recently doesn't show a stale name.
        const tgt = _petTargetByOwner.get(owner);
        const target = (tgt && (now - tgt.at) <= PET_TARGET_TTL_MS) ? tgt.target : null;
        if (!petName && hp == null && buffs.length === 0 && !statsForPet && !target) continue;   // nothing to show
        out.push({
          owner,
          pet:         petName,
          hp_pct:      hp,
          buffs,
          stats:       statsForPet,
          target,
          target_at:   target ? tgt.at : null,
          observed_at: repFresh ? rep.last_seen_at : now,
        });
      }
      out.sort((a, b) => (b.observed_at || 0) - (a.observed_at || 0));
      return out.slice(0, 12);
    })(),
    // Current target NPC stats for the Mob Info overlay (catalog stats from the
    // bot + live target HP%). null when nothing is targeted.
    mobInfo: buildMobInfo(),
    // /who overlay: latest /who run + recently-gone, anon rows de-anon'd from
    // the bot's who history. null until the first /who is parsed.
    whoSnapshot: buildWhoSnapshot(),
    // Send ONLY the inventory fields the dashboard's Weapon Loadouts table
    // uses (weapons + bandolier + meta). The full parsed inventory also carries
    // `worn` and a large `bagged` array (every bag + bank slot) per character —
    // with 50+ alts that bloated /api/state into a payload re-fetched, re-parsed
    // and re-rendered every 2s poll, loading the renderer for nothing. Strip it.
    characterInventories:   (() => {
      const slim = {};
      for (const [name, inv] of Object.entries(stats.characterInventories || {})) {
        if (!inv) continue;
        slim[name] = {
          weapons:    inv.weapons    || {},
          bandolier:  inv.bandolier  || {},
          _path:      inv._path,
          _updatedAt: inv._updatedAt,
        };
      }
      return slim;
    })(),
    hiddenLoadoutChars:     [...(_optinState.hiddenLoadoutChars || [])],
    activeBandolier:        stats.activeBandolier,
    sessionDeeps:           stats.sessionDeeps,
    requestedCharacters: stats.requestedCharacters,
    backfillRequests:    stats.backfillRequests,
    backfillRequestsCheckedAt: stats.backfillRequestsCheckedAt,
    // Trigger summary for the dashboard. Strip _regex (not JSON-safe).
    guildTriggerCount:   (stats.guildTriggers || []).length,
    guildTriggersCheckedAt: stats.guildTriggersCheckedAt,
    // Full guild trigger list for the Triggers tab. Strip the compiled _regex
    // (RegExp can't round-trip JSON) and _scope (an internal flag the dashboard
    // doesn't need to see).
    guildTriggers: (stats.guildTriggers || []).map(function(t) {
      const { _regex, _scope, ...rest } = t;
      void _regex; void _scope;
      return rest;
    }),
    personalTriggerCount: (_personalTriggers || []).length,
    activeOverlays:      _activeOverlays,
    // Trigger fires for the Mimic trigger-alert overlay (triggers.html). It
    // dedupes on `ts` and speaks `tts || text`, so map the overlay ring buffer
    // into the shape it expects. WITHOUT this the overlay saw nothing and never
    // spoke — the cause of "I've never heard a TTS trigger".
    recentTriggerFires: _activeOverlays.map(function(o){
      return {
        ts:      o.firedAt || o.shownAt || 0,
        text:    o.text,
        tts:     o.tts || o.text,
        trigger: o.trigger,
        scope:   o.scope,
        test:    !!o.test,
        sound:   o.sound || null,
      };
    }),
    activeTimers:        _activeTimersSnapshot(),
    ..._serializeZealForWeb(),

    lifetime:           stats.lifetime,
    // Only surface the resume banner for the first 2 minutes after restore —
    // after that the user knows, and a stale banner is just noise.
    sessionResumed:     !!stats._sessionRestoredBanner
                        && stats._sessionRestoredAt
                        && (Date.now() - stats._sessionRestoredAt) < 120_000,
    knownPets:          [...knownPetOwners.entries()].map(([pet, owners]) => ({ pet, owners: [...owners] })),
    uploadQueue:        uploadQueueSnapshot(),
    updateBlocked:      _updateBlockedReason(),
    staleBackfills:     _staleBackfillsSummary(),
  };
}

// Summarize how many opt-in files have a stale backfill version (a newer
// agent shipped detectors their last pass missed). Powers the dashboard's
// home-page banner + the per-file pulse on the Opt-in Logs pane. Pure
// derived state — no caching needed; the list is small.
function _staleBackfillsSummary() {
  if (typeof _optinState === 'undefined' || !_optinState || !Array.isArray(_optinState.files)) {
    return { count: 0, labels: [], oldestVersion: null };
  }
  const labels = new Set();
  let oldestVersion = null;
  let count = 0;
  for (const f of _optinState.files) {
    const r = f && f.resume;
    if (!r || !r.complete || !r.agentVersion) continue;
    const stale = detectorsStaleSince(r.agentVersion);
    if (stale.length === 0) continue;
    count += 1;
    for (const d of stale) labels.add(d.label);
    if (!oldestVersion || isNewerVersion(oldestVersion, r.agentVersion)) {
      oldestVersion = r.agentVersion;
    }
  }
  return { count, labels: [...labels], oldestVersion };
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
.wp-ov-toggle { min-width:42px; background:#21262d; color:var(--dim); border:1px solid var(--border); border-radius:5px; padding:2px 9px; font-size:11px; font-weight:600; cursor:pointer; font-family:inherit; letter-spacing:0.5px; }
.wp-ov-toggle:hover { border-color:var(--blue); color:var(--text); }
.wp-ov-toggle.on { background:#196c2e; border-color:#2ea043; color:#fff; }
.nav-quest { margin-left:auto; padding:5px 12px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:var(--blue); text-decoration:none; font-size:12px; font-family:inherit; }
.nav-quest:hover { background:#30363d; border-color:var(--blue) }
.section { display:none } .section.active { display:block }
.banner { padding:8px 12px; border-radius:6px; margin:0 0 10px 0; font-size:13px; }
.banner.update { background:#9e6a03; color:#fff }
.banner.resumed { background:#1a7f37; color:#fff }
/* Stale-backfill nudge — soft green so it reads as informational, not an
   error. The pulse-dot inside it ties visually to the per-row pulse on the
   ↻ Re-run button in the Opt-in Logs pane: same color, same rhythm. */
.banner.stale-backfill .pulse-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:#56d364; box-shadow:0 0 0 0 rgba(86,211,100,0.7); animation: wp-pulse-glow 1.8s ease-out infinite; vertical-align:middle; margin-right:6px; }
@keyframes wp-pulse-glow {
  0%   { box-shadow:0 0 0 0   rgba(86,211,100,0.7); transform:scale(1);    }
  60%  { box-shadow:0 0 0 10px rgba(86,211,100,0);   transform:scale(1.12); }
  100% { box-shadow:0 0 0 0   rgba(86,211,100,0);   transform:scale(1);    }
}
/* Pulse halo on a Re-run button whose backfill is stale relative to the
   current agent. Same animation as the banner dot — visual coupling tells
   the user the banner is naming THIS row. */
button.wp-rerun-stale { position:relative; animation: wp-pulse-glow 1.8s ease-out infinite; box-shadow:0 0 0 0 rgba(86,211,100,0.7); }
.subtle { color:var(--dim); font-size:12px; margin:4px 0 12px 0; }
.spell-link { color:inherit; text-decoration:none; border-bottom:1px dotted var(--blue); }
.spell-link:hover { color:var(--blue); border-bottom-color:transparent; }
.tag { background:#1f6feb22; color:var(--blue); padding:2px 6px; border-radius:4px; font-size:11px; }
.tag.ramp { background:#9e6a0322; color:var(--gold) }
.tag.invuln { background:#1a7f3722; color:var(--green) }
.pet { color:var(--blue) }
.card.wp-hidden { display:none !important }
/* Increment 2a — wolfpack.quest links woven in. A delegated click handler
   makes every .name cell open the matching character page in a new tab.
   The hover style telegraphs "this is clickable." */
.card td.name, .card .name { cursor:pointer; }
.card td.name:hover, .card .name:hover { text-decoration:underline; color:var(--blue); }
.wp-quicklinks { display:flex; gap:8px; align-items:center; margin:6px 0 12px 0; font-size:12px; color:var(--dim); flex-wrap:wrap; }
.wp-quicklinks a { color:var(--blue); text-decoration:none; padding:2px 8px; border:1px solid var(--border); border-radius:4px; }
.wp-quicklinks a:hover { background:#21262d; border-color:var(--blue); }
.wp-gear { background:#21262d; color:var(--text); border:1px solid var(--border); padding:5px 11px; border-radius:6px; cursor:pointer; font-family:inherit; font-size:13px; }
.wp-gear:hover { background:#30363d; border-color:var(--blue); color:var(--blue) }
.wp-menu { position:absolute; z-index:1000; background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.5); max-height:60vh; overflow:auto; min-width:240px; }
.wp-menu h4 { margin:0 0 8px; color:var(--blue); font-size:12px; text-transform:uppercase; font-weight:normal; border:none; }
.wp-menu label { display:flex; align-items:center; gap:8px; padding:3px 0; font-size:13px; color:var(--text); cursor:pointer; text-transform:none; }
.wp-menu .wp-actions { margin-top:8px; border-top:1px solid var(--border); padding-top:8px; display:flex; gap:8px; }
.wp-menu .wp-actions button { background:#21262d; color:var(--text); border:1px solid var(--border); border-radius:5px; padding:3px 9px; font-size:11px; cursor:pointer; font-family:inherit; }
.wp-menu .wp-actions button:hover { border-color:var(--blue); color:var(--blue) }
/* Increment 2d — "send this panel to its own overlay window" (Mimic only).
   Tiny button placed in each panel's <h2>; the dashboard JS shows it only
   when running under Mimic (window.mimic.createPanelOverlay exists). */
.wp-overlay-btn { float:right; background:#21262d; color:var(--dim); border:1px solid var(--border); border-radius:4px; padding:0 8px; font-size:11px; cursor:pointer; line-height:1.6; margin-left:8px; font-family:inherit; text-transform:none; letter-spacing:0; }
.wp-overlay-btn:hover { color:var(--blue); border-color:var(--blue); }
.wp-hide-btn { padding:0 7px; font-weight:bold; }
.wp-hide-btn:hover { color:var(--red); border-color:var(--red); }
.wp-source-toggle { float:right; display:inline-flex; gap:0; margin-left:8px; }
.wp-source-toggle button { background:#21262d; color:var(--dim); border:1px solid var(--border); padding:0 8px; font-size:11px; cursor:pointer; line-height:1.6; font-family:inherit; text-transform:none; letter-spacing:0; }
.wp-source-toggle button.active { background:#1f6feb; border-color:#1f6feb; color:#fff; }
.wp-source-toggle button:first-child { border-radius:4px 0 0 4px; }
.wp-source-toggle button:last-child { border-radius:0 4px 4px 0; border-left:none; }
.wp-server-overlay { background:rgba(31,111,235,.07); border-top:1px solid rgba(31,111,235,.4); padding:8px 12px; margin:8px -14px -14px; font-size:12px; }
.wp-server-overlay h5 { margin:0 0 6px; color:var(--blue); font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
.wp-server-overlay .meta { color:var(--dim); font-size:10px; margin-bottom:4px; }
.wp-server-overlay table { font-size:12px; }
.wp-bid-block { margin:8px 0; border-top:1px solid var(--border); padding-top:6px; }
.wp-drag-handle { cursor:grab; color:var(--dim); margin-right:6px; user-select:none; }
.wp-drag-handle:hover { color:var(--blue); }
.card.wp-dragging { opacity:0.45; }
.card.wp-drop-target { box-shadow:0 0 0 2px var(--blue) inset; }
.wp-suggest { background:rgba(31,111,235,.08); border:1px solid rgba(31,111,235,.4); border-radius:6px; padding:8px 10px; margin-bottom:8px; font-size:12px; }
.wp-suggest h5 { margin:0 0 6px; color:var(--blue); font-size:11px; text-transform:uppercase; }
.wp-suggest button { background:#21262d; color:var(--text); border:1px solid var(--border); border-radius:4px; padding:2px 8px; font-size:11px; cursor:pointer; font-family:inherit; margin:2px; }
.wp-suggest button.priority { border-color:var(--gold); color:var(--gold); }
.wp-suggest button:hover { background:#30363d; border-color:var(--blue); color:var(--blue); }
/* Overlay mode — when the dashboard is loaded with ?overlay=<panelKey>,
   strip all chrome and show just the target panel as a transparent overlay
   tile. Reuses the live render loop for free updates. */
body.wp-overlay-mode { background:transparent !important; padding:0 !important; }
body.wp-overlay-mode h1,
body.wp-overlay-mode .nav,
body.wp-overlay-mode .wp-quicklinks,
body.wp-overlay-mode #header,
body.wp-overlay-mode .wp-gear,
body.wp-overlay-mode .wp-menu,
body.wp-overlay-mode .banner,
body.wp-overlay-mode .wp-overlay-btn { display:none !important; }
body.wp-overlay-mode .section { display:block !important; }
body.wp-overlay-mode .section .card { display:none !important; }
/* Match the HUD overlay's GINA-style look: translucent dark fill, blue
   border + subtle inner shadow, rounded corners. Was a near-opaque flat
   card (rgba .92) which didn't read as an overlay. The HUD uses rgba
   0.78 with a 1px blue border; mirror that here so all overlays look
   consistent and stay readable over the EQ window underneath. */
body.wp-overlay-mode .section .card.wp-overlay-target {
  display:block !important; margin:0 !important; padding:8px 10px !important;
  background:rgba(14,17,22,0.78) !important;
  border:1px solid rgba(88,166,255,0.4) !important;
  border-radius:8px !important;
  box-shadow:0 1px 3px rgba(0,0,0,.4) !important;
  backdrop-filter:blur(2px);
}
body.wp-overlay-mode .section .card.wp-overlay-target h2 {
  font-size:10px !important; color:#58a6ff !important;
  letter-spacing:.1em !important; text-transform:uppercase !important;
  margin:0 0 6px !important; padding:0 !important; border:0 !important;
}
/* Compact overlay rendering — the analytical cards (DEEPS, Healing, Threat,
   Tanking) are full breakdown tables (melee/spell/proc/dot/crit columns with
   avg/max sub-lines). As an overlay we want a succinct ranked list like the
   DPS HUD: just the name + primary value. Hide everything past the first two
   columns, drop the descriptive paragraph + collapsible detail, and tighten
   the rows. CSS-only so the dashboard render is untouched. */
body.wp-overlay-mode .wp-overlay-target table th:nth-child(n+3),
body.wp-overlay-mode .wp-overlay-target table td:nth-child(n+3) { display:none !important; }
body.wp-overlay-mode .wp-overlay-target > p,
body.wp-overlay-mode .wp-overlay-target details,
body.wp-overlay-mode .wp-overlay-target .subtle { display:none !important; }
body.wp-overlay-mode .wp-overlay-target table { width:100% !important; border-collapse:collapse !important; }
body.wp-overlay-mode .wp-overlay-target table th,
body.wp-overlay-mode .wp-overlay-target table td {
  padding:1px 10px 1px 0 !important; font-size:11px !important;
  white-space:nowrap !important; line-height:1.35 !important;
}
body.wp-overlay-mode .wp-overlay-target table td:nth-child(2),
body.wp-overlay-mode .wp-overlay-target table th:nth-child(2) { text-align:right !important; }
</style></head><body>
<h1>🐺 Wolf Pack EQ — Parser <span style="font-size:13px;font-weight:normal;color:#8b949e;vertical-align:middle">${process.env.WOLFPACK_APP_VERSION ? (process.env.WOLFPACK_CLIENT === 'mimic' ? 'Mimic' : 'App') + ' v' + process.env.WOLFPACK_APP_VERSION + ' · ' : ''}agent v${AGENT_VERSION}</span>${/-/.test(String(process.env.WOLFPACK_APP_VERSION || '')) ? ' <span title="Running a beta (pre-release) build" style="font-size:10px;font-weight:600;color:#1f1300;background:#f0b429;border-radius:3px;padding:2px 5px;margin-left:6px;vertical-align:middle;letter-spacing:0.5px">BETA</span>' : ''}</h1>
<div class="subtle" id="header"></div>
<div class="wp-quicklinks" id="wpQuickLinks">
  <span>Jump to wolfpack.quest:</span>
  <a href="https://wolfpack.quest/raid" target="_blank" rel="noreferrer" title="Raid hub — live grouped roster, color tiers, buff coverage at a glance">/raid</a>
  <a href="https://wolfpack.quest/me" target="_blank" rel="noreferrer" title="Your /me dashboard — stats, settings, recent">/me</a>
  <a href="https://wolfpack.quest/parses" target="_blank" rel="noreferrer" title="Recent parses (last 30 days)">parses</a>
  <a href="https://wolfpack.quest/pvp" target="_blank" rel="noreferrer" title="PvP leaderboard">pvp</a>
  <a href="https://wolfpack.quest/leaderboards" target="_blank" rel="noreferrer" title="Damage leaderboards">leaderboards</a>
  <a href="https://wolfpack.quest/fun" target="_blank" rel="noreferrer" title="Fun counters (Peopleslayer LD, Longest Dire Charm, etc.)">fun</a>
  <span id="wpUploaderLinks"></span>
</div>
<div class="nav">
  <button class="active" data-tab="dash">Dashboard</button>
  <button data-tab="tanks">Tanks</button>
  <button data-tab="healers">Healers</button>
  <button data-tab="deeps">DEEPS</button>
  <button data-tab="pets">Pets</button>
  <button data-tab="triggers">⚡ Triggers</button>
  <button data-tab="overlays">🪟 Overlays</button>
  <button data-tab="info">Info / Stats</button>
  <button data-tab="optin">Opt-in Logs</button>
  <button id="wpUiStudioBtn" type="button"
     style="background:transparent;border:1px solid var(--green);color:var(--green);padding:6px 10px;border-radius:5px;cursor:pointer;font:inherit"
     title="Open the UI Studio — graphical rescaler for EQ window layouts (move a 1440 UI to 1080, drag/snap windows visually)">UI Studio</button>
  <a id="wpRaidLink" href="https://wolfpack.quest/raid" target="_blank" rel="noreferrer"
     class="nav-quest"
     style="margin-left:auto;color:var(--orange);border-color:var(--orange)"
     title="Raid hub — live grouped roster, color-tier coverage, click-into-character side panel">⚔ /raid ↗</a>
  <a id="wolfpackQuestLink" href="https://wolfpack.quest" target="_blank" rel="noreferrer"
     class="nav-quest"
     style="margin-left:6px"
     title="Open wolfpack.quest in a new tab (hotkey: W)">wolfpack.quest ↗</a>
  <button id="wpGear" class="wp-gear" title="Customize panels — show or hide sections">⚙ Panels</button>
  <button id="wpReload" class="wp-gear" title="Reload the dashboard — reconnect to the parser engine (use this if panels are blank after an update)" onclick="if(window.mimic&&window.mimic.openDashboard){window.mimic.openDashboard()}else{location.reload()}">🔄 Reload</button>
</div>
<div id="wpPanelMenu" class="wp-menu" style="display:none"></div>
<div id="dash" class="section active"></div>
<div id="tanks" class="section"></div>
<div id="healers" class="section"></div>
<div id="deeps" class="section"></div>
<div id="pets" class="section"></div>
<div id="triggers" class="section"></div>
<div id="overlays" class="section"></div>
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
// PQDI spell-link helper. The agent fetches the spell catalog from the bot
// once at startup; it's served to the browser at /api/spells.json as a flat
// { lowercaseName: id } map. spellLink(name) returns an <a> tag pointing at
// the PQDI spell page, or the bare escaped name if we don't have an id (e.g.
// boss-unique spells the catalog doesn't cover, or a local-only install with
// no token to fetch the catalog).
var _spellIdByName = {};
(function _loadSpellMap(){
  // One-shot fetch at script start. Cached for the page lifetime; refetched on
  // a full reload. Failures are silent — links just won't appear.
  try {
    fetch('/api/spells.json').then(function(r){ return r.ok ? r.json() : null; }).then(function(map){
      if (map && typeof map === 'object') _spellIdByName = map;
    }).catch(function(){});
  } catch(_){}
})();
function spellLink(name) {
  var safe = esc(name);
  if (!name) return safe;
  var id = _spellIdByName[String(name).toLowerCase().trim()];
  if (!id) return safe;
  return '<a href="https://www.pqdi.cc/spell/' + id + '" target="_blank" rel="noopener" class="spell-link">' + safe + '</a>';
}

// In-place DOM updates for panel renders. The dashboard polls /api/state every
// 2s; each render function builds its section's HTML. The old approach wrote
// el.innerHTML = h every poll, which tears down + rebuilds every node — a
// visible flash, lost scroll/selection/<details> state, and (worst) it
// DESTROYED app-injected cards (My Crits, Charm Pets, DS, bidding, uploader
// banner — all id="wp…") that their own loops then re-inserted, so those cards
// flickered in and out every 2s.
//
// setSectionHTML now:
//   1. Short-circuits when the produced HTML is byte-identical (idle = no work).
//   2. Otherwise MORPHS the live DOM to match — updating only the text /
//      attributes that actually changed, keeping node identity. No flash,
//      scroll holds, form/focus/<details> state preserved.
//   3. Never touches app-injected wp* nodes (they're managed by their own
//      loops); morph reconciles around them.
// Returns true when it changed something so callers re-run their (idempotent)
// event binding.
// Morph an arbitrary element's contents to the given HTML in place. Caches the
// last HTML on the element so an unchanged update is a no-op. Used by section
// renders AND by the injected cards (My Crits, Charm Pets, DS, bidding) so
// their inner tables update without an innerHTML flash too.
function morphInto(el, html) {
  if (!el) return false;
  if (el._wpLastHtml === html) return false;   // change-detection: skip identical
  el._wpLastHtml = html;
  // NOTE: the DOM-morph approach (v2.5.31–33) was reverted — it kept breaking
  // the dashboard in real browsers (couldn't be validated here, only via a DOM
  // mock). Plain innerHTML with change-detection is the known-good path: most
  // polls are byte-identical so they're skipped (no flicker when idle); only a
  // genuinely-changed panel is rewritten. The _morph* helpers below are kept
  // unused pending a real-browser test harness.
  el.innerHTML = html;
  return true;
}
function setSectionHTML(id, html) {
  return morphInto(document.getElementById(id), html);
}
function _isInjected(node) {
  // App-injected cards carry an id that starts with "wp" and are owned by
  // their own render loops. Morph must leave them in place.
  return node && node.nodeType === 1 && node.id && node.id.indexOf('wp') === 0;
}
function _morphAttrs(live, tmpl) {
  var i, a;
  // Drop live attrs the template no longer has — except class, handled below.
  for (i = live.attributes.length - 1; i >= 0; i--) {
    a = live.attributes[i].name;
    if (a === 'class') continue;
    if (!tmpl.hasAttribute(a)) live.removeAttribute(a);
  }
  for (i = 0; i < tmpl.attributes.length; i++) {
    a = tmpl.attributes[i];
    if (a.name === 'class') {
      // Merge: template's classes PLUS any wp-* state classes the app applied
      // live (wp-hidden from the show/hide-panels feature, wp-drop-target
      // flash). Stripping those would un-hide hidden panels every poll.
      var keep = [];
      var lc = (live.getAttribute('class') || '').split(/\s+/);
      for (var j = 0; j < lc.length; j++) if (lc[j].indexOf('wp-') === 0) keep.push(lc[j]);
      var merged = a.value + (keep.length ? ' ' + keep.join(' ') : '');
      if (live.getAttribute('class') !== merged) live.setAttribute('class', merged);
      continue;
    }
    if (live.getAttribute(a.name) !== a.value) live.setAttribute(a.name, a.value);
  }
  // Template has no class but live carries wp-* state classes → keep just those.
  if (!tmpl.hasAttribute('class') && live.hasAttribute('class')) {
    var k2 = (live.getAttribute('class') || '').split(/\s+/).filter(function (x) { return x.indexOf('wp-') === 0; });
    if (k2.length) live.setAttribute('class', k2.join(' ')); else live.removeAttribute('class');
  }
}
function _morphEl(live, tmpl) {
  // Sync this element's own attributes, then its children. Used for matched
  // element pairs DISCOVERED during child reconciliation — never for the
  // top-level container passed to morphInto (see _morphChildren there).
  if (live.nodeType === 1 && tmpl.nodeType === 1) _morphAttrs(live, tmpl);
  _morphChildren(live, tmpl);
}
function _morphChildren(live, tmpl) {
  // Reconcilable live children = everything except injected wp* nodes.
  var liveKids = [];
  for (var k = 0; k < live.childNodes.length; k++) {
    if (_isInjected(live.childNodes[k])) continue;
    liveKids.push(live.childNodes[k]);
  }
  var tc = tmpl.childNodes;
  var li = 0;
  for (var ti = 0; ti < tc.length; ti++) {
    var t = tc[ti];
    var l = liveKids[li];
    if (l === undefined) { live.appendChild(t.cloneNode(true)); continue; }
    if (l.nodeType !== t.nodeType || (l.nodeType === 1 && l.nodeName !== t.nodeName)) {
      live.replaceChild(t.cloneNode(true), l); li++; continue;
    }
    if (l.nodeType === 3 || l.nodeType === 8) {
      if (l.nodeValue !== t.nodeValue) l.nodeValue = t.nodeValue; li++; continue;
    }
    _morphEl(l, t);
    // Checkbox/radio: reflect the template's checked state as a PROPERTY. A
    // dirtied checkbox ignores attribute changes, so setAttribute alone won't
    // re-check it. (Matches what innerHTML did implicitly — opt-in selection
    // boxes still mirror server state.) Deliberately NOT done for <select>/
    // <option> so the bandolier dropdown keeps the user's live selection.
    if (l.nodeName === 'INPUT') {
      var _tp = (l.getAttribute('type') || '').toLowerCase();
      if (_tp === 'checkbox' || _tp === 'radio') {
        var _want = t.hasAttribute('checked');
        if (l.checked !== _want) l.checked = _want;
      }
    }
    li++;
  }
  for (var r = li; r < liveKids.length; r++) live.removeChild(liveKids[r]);
}
// Idempotent event binding — under morph, nodes persist across polls, so the
// per-render addEventListener calls would stack duplicate handlers. _bindOnce
// tags the node with a per-event marker so a handler is attached exactly once.
function _bindOnce(el, ev, fn) {
  if (!el) return;
  var key = '_wpb_' + ev;
  if (el[key]) return;
  el[key] = 1;
  el.addEventListener(ev, fn);
}

function renderHeader(s) {
  const sessionMin = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  const hasNewer = s.updateAvailable && s.latestAgentVersion
                && s.latestAgentVersion !== s.version
                && _isNewerVersion(s.latestAgentVersion, s.version);
  let h = '';
  if (hasNewer) h += '<div class="banner update">★ Update available — <button id="updateBtn" style="margin-left:8px;background:#fff;color:#000;border:0;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:bold">Install now</button></div>';
  if (s.sessionResumed)  h += '<div class="banner resumed">↻ Session resumed from previous run</div>';
  // Stale-backfill nudge. Lives in the header (always visible across tabs)
  // so a user who never opens the Opt-in Logs pane still sees it. Click
  // hands off to the pane — the pulse on each affected file row tells them
  // which to re-run. We only show it when the user has actually completed
  // at least one backfill (count > 0); first-time users get no banner.
  const sb = s.staleBackfills || { count: 0, labels: [], oldestVersion: null };
  if (sb.count > 0) {
    const fileWord  = sb.count === 1 ? 'file' : 'files';
    const labelList = (sb.labels || []).slice(0, 3).join(', ')
                    + ((sb.labels || []).length > 3 ? ', …' : '');
    const tip = labelList
      ? 'New since your last backfill: ' + esc(labelList)
      : 'New detectors available — re-run to capture them';
    h += '<div class="banner stale-backfill" title="' + esc(tip) + '" style="background:#1a3a1f;color:#bff5c5;border:1px solid #2ea043;display:flex;gap:10px;align-items:center;justify-content:space-between">'
       + '<span><span class="pulse-dot" aria-hidden></span><b> ' + sb.count + ' ' + fileWord + '</b> backfilled before recent detectors landed. '
       + 'Re-run to capture <b>' + esc(labelList || 'new fun-event counters') + '</b>.</span>'
       + '<button id="bannerGoOptin" style="background:#fff;color:#1a3a1f;border:0;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;white-space:nowrap">Open Opt-in Logs →</button>'
       + '</div>';
  }
  // Setup-state banners. These are the "why is nothing flowing" causes — all
  // ride at the top of every dashboard tab (the header block is shared, so a
  // tab-switch never hides them). Stacked when more than one applies so the
  // user sees every issue at once instead of fixing one and finding another.
  //
  // Mimic only — the Mimic preload exposes window.mimic.openSettings; when the
  // dashboard is hit from a regular browser, those banner buttons aren't
  // actionable so they'd be misleading. Detect via the same window.mimic
  // probe other tabs use (process.env is Node-only — this code path runs in
  // the browser and crashed renderHeader as "process is not defined").
  const isMimicHosted = !!(window.mimic && window.mimic.openSettings);
  if (isMimicHosted && !s.mimicSignedIn) {
    h += '<div class="banner" style="background:#3b0a0a;color:#ffb3b3;border:1px solid #f85149">'
       + '⛓ <b>Not signed in to Discord.</b> Your parses won&rsquo;t upload and the guild can&rsquo;t see your stats. '
       + 'Open Mimic Settings → <b>Wolf Pack account</b> to sign in with Discord. '
       + '<button id="bannerOpenSettings" style="margin-left:8px;background:#fff;color:#000;border:0;padding:3px 10px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px">Open Settings</button>'
       + '</div>';
  }
  // No EQ logs to tail — the #1 "why is nothing happening" cause. We split it
  // into two sub-states so the fix is exact: (a) no EQ folder configured at all
  // → tell them to pick one; (b) folder configured but no eqlog_*.txt files →
  // tell them to turn on in-game logging.
  if ((s.watchedLogs || []).length === 0) {
    // WOLFPACK_EQ_DIR is set by Mimic when the user has resolved at least one
    // EQ folder (cfg.eqPaths or auto-detect). Absent = user hasn't picked a
    // folder yet — show the "select a folder" banner instead of the generic
    // "no logs" one.
    const hasFolders = !!process.env.WOLFPACK_EQ_DIR;
    if (isMimicHosted && !hasFolders) {
      h += '<div class="banner" style="background:#3a2a0a;color:#f6c365;border:1px solid #6b5320">'
         + '📁 <b>No EQ folder selected.</b> Mimic doesn&rsquo;t know where your EverQuest install is. '
         + 'Open Mimic Settings → <b>EverQuest folders</b> and add your EQ directory '
         + '(the one containing <code>eqclient.ini</code> and the <code>Logs</code> subfolder). '
         + '<button id="bannerOpenSettings" style="margin-left:8px;background:#fff;color:#000;border:0;padding:3px 10px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px">Open Settings</button>'
         + '</div>';
    } else {
      h += '<div class="banner" style="background:#3a2a0a;color:#f6c365;border:1px solid #6b5320">'
         + '⚠ <b>No EQ logs are being read.</b> In-game logging is off. Type <b>/log on</b> in EverQuest, '
         + 'and set <b>Logging=on</b> in <code>eqclient.ini</code>. '
         + 'Parsing starts automatically the moment a log file appears.'
         + '</div>';
    }
  }
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
  // Mimic Discord-login badge / nudge. Shows on the header line so identity
  // status is visible at a glance.
  //  • Signed in   → small green pill with display name + 👑 officer flag
  //  • Linking     → blue pill with the 6-char code (cued by status flow)
  //  • Signed out  → dim "Not signed in" pill (no action UI here; Settings owns
  //                  the actual sign-in flow). Hidden in non-Mimic browsers
  //                  where window.mimic isn't available.
  let identityChip = '';
  if (s.mimicIdentity) {
    const display = s.mimicIdentity.display_name || s.mimicIdentity.discord_id || 'Discord account';
    const officer = s.mimicIdentity.is_officer ? ' <span style="color:var(--gold)" title="Officer">👑</span>' : '';
    identityChip = ' · <span style="background:#0f2a1a;color:#56d364;border:1px solid #1a7f37;border-radius:3px;font-size:11px;padding:2px 6px;margin-left:4px" title="Linked Mimic install — Settings → Wolf Pack account to manage">⛓ ' + esc(display) + officer + '</span>';
  } else if (s.mimicSignedIn) {
    identityChip = ' · <span style="background:#1f6feb33;color:#58a6ff;border:1px solid #1f6feb;border-radius:3px;font-size:11px;padding:2px 6px;margin-left:4px" title="Linked but identity not yet refreshed — next bot poll will fill it in">⛓ signed in</span>';
  }
  h += '<div>' + versionStr + ' · ' + (s.uploadCount||0) + ' upload(s) this session · ' + s.sessionEvents + ' events in ' + sessionMin + ' min' + queueChip + identityChip + alwaysBtn + resetBtn + '</div>';
  if (!setSectionHTML('header', h)) return;
  // Stale-backfill banner has a one-click hop to the Opt-in Logs pane.
  // Drives directly at the nav button so we reuse its tab-switching glue
  // (active class swap + refreshOptin) without duplicating it here.
  const goOptin = document.getElementById('bannerGoOptin');
  if (goOptin) _bindOnce(goOptin, 'click', () => {
    const tabBtn = document.querySelector('.nav button[data-tab="optin"]');
    if (tabBtn) tabBtn.click();
  });
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
  _bindOnce(manual, 'click', async () => {
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
  _bindOnce(inline, 'click', (e) => {
    e.preventDefault();
    document.getElementById('updateBtn')?.click();
  });
  const u = document.getElementById('updateBtn');
  _bindOnce(u, 'click', async () => {
    if (!confirm('Update agent now? Session will be saved and resumed automatically.')) return;
    u.disabled = true; u.textContent = 'Restarting...';
    const ok = await _attemptUpdate(u, false);
    if (!ok) return;
    document.body.insertAdjacentHTML('afterbegin',
      '<div id="restartBanner" class="banner update" style="position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center">' +
      'Restarting agent... this page will reload automatically once the server is back up.</div>');
    _startRestartPoll('restartBanner');
  });
  // Setup banner "Open Settings" buttons — Mimic-only (window.mimic.openSettings
  // is exposed via preload). Both the not-signed-in and no-folder banners use
  // id="bannerOpenSettings"; only one is rendered at a time (mutually exclusive
  // states), so the single binder is fine.
  const settingsBtn = document.getElementById('bannerOpenSettings');
  _bindOnce(settingsBtn, 'click', () => {
    try { if (window.mimic && window.mimic.openSettings) window.mimic.openSettings(); } catch (e) { void e; }
  });

  // Reset-dashboard click — zeros session counters server-side, then we
  // re-pull /api/state so the UI refreshes immediately without a hard reload.
  const r = document.getElementById('resetSessionBtn');
  _bindOnce(r, 'click', async () => {
    if (!confirm('Reset session counters? Recent Parses, top damage and per-class panes go back to empty. Lifetime totals and opt-in backfill progress are preserved.')) return;
    r.disabled = true; r.textContent = 'Resetting...';
    try { await fetch('/api/reset-session', { method: 'POST' }); } catch {}
    try { const fresh = await (await fetch('/api/state')).json(); refresh(); void fresh; } catch {}
    r.disabled = false; r.textContent = '⟲ Reset dashboard';
  });
}

function renderDash(s) {
  let h = '';

  // Per-character "buffs & zone" card — what each watched character is carrying
  // and where they are right now, OR what they logged out with (the last Zeal
  // snapshot persists after a client drops). Its own self-updating
  // #wpZealClients element (filled by renderZealClients) so its ticking buff
  // timers don't rewrite the whole dashboard section every 2s. Hidden until
  // Zeal reports at least one character.
  h += '<div id="wpZealClients" class="card wide" style="display:none"></div>';
  // My Crits — own self-updating element rendered in the section loop (see
  // renderCritsCard), NOT injected by a separate 3s loop. The old inject-into-
  // grid approach got wiped every time renderDash rewrote #dash and re-added on
  // the next tick → the "keeps refreshing and falling away" flicker.
  h += '<div id="wpCritsCard" class="card" style="display:none"></div>';

  // Trigger alert flash — isolated into #wpTriggerAlerts (its opacity fades
  // every poll, which would otherwise force the whole #dash section to rewrite).
  // Filled by renderTriggerAlertsCard.
  h += '<div id="wpTriggerAlerts" class="card" style="display:none;border-color:#a06628"></div>';
  // Trigger summary chip
  if ((s.guildTriggerCount || 0) > 0 || (s.personalTriggerCount || 0) > 0) {
    h += '<div class="card"><h2>Triggers</h2>' +
         '<div class="dim" style="font-size:11px">' +
         (s.guildTriggerCount || 0) + ' guild · ' +
         (s.personalTriggerCount || 0) + ' personal' +
         '</div></div>';
  }

  h += '<div class="grid">';
  // Recent parses — hide placeholder rows from older uploads (boss "?" with
  // zero events / zero damage). The recordUploadForDashboard write path also
  // skips creating these going forward, but in-memory stale ones live until a
  // session reset; filtering here makes them disappear immediately.
  const _validParses = (s.recentParses || []).filter(p => p && (p.eventCount > 0 || p.totalDamage > 0) && p.bossName && p.bossName !== '?');
  h += '<div class="card"><h2>Recent Parses</h2>';
  if (_validParses.length === 0) h += '<div class="dim">(no uploads yet)</div>';
  else {
    h += '<table>';
    for (const p of _validParses.slice(0, 5)) {
      h += '<tr><td class="name">' + esc(p.bossName) + '</td><td class="dim">' + p.eventCount + ' ev</td>' +
           '<td class="num">' + fmtK(p.totalDamage) + '</td><td class="dim">(' + fmtK(p.spellDotDamage) + ' spell)</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';
  // Session damage — isolated (live numbers change every poll). renderDamageDoneCard.
  h += '<div id="wpDamageDone" class="card" style="display:none"></div>';

  // 💚 Healing — this fight. Isolated (live during combat). renderHealingCard.
  h += '<div id="wpHealingCard" class="card" style="display:none"></div>';

  // Watched Logs — isolated ("ago" times change every poll → the main idle
  // stutter source). renderWatchedLogsCard.
  h += '<div id="wpWatchedLogs" class="card" style="display:none"></div>';

  // Recent Tells — isolated (its "When" column ticks every poll). renderRecentTellsCard.
  h += '<div id="wpRecentTells" class="card wide" style="display:none"></div>';

  // Live Threat moved OFF the Dashboard → it lives on the Tanks tab
  // (renderTanks → "Threat Detail"). The summary here was a Phase-1 proxy
  // (observable damage + heals only); it did NOT account for tank threat procs,
  // hate spells, stuns, or taunts, so it was misleading on the primary page.

  // Top Damage — isolated (live during combat; owns its dismiss-button wiring). renderTopDamageCard.
  h += '<div id="wpTopDamage" class="card wide" style="display:none"></div>';
  h += '</div>';  // grid
  // #dash now contains only STATIC content (Recent Parses + the trigger chip)
  // plus the wp* placeholders, so its HTML is byte-identical between polls and
  // setSectionHTML short-circuits → no whole-section repaint (the stutter). The
  // volatile cards fill their own placeholders via the render fns below.
  setSectionHTML('dash', h);
}

// ── Dashboard volatile cards, isolated into self-updating wp* placeholders ───
// Each fills its own small element so only IT repaints when its live values
// change; renderDash emits stable placeholders so the big #dash section stops
// rewriting (kills the per-poll "stutter"). Same pattern as renderZealClients /
// renderCritsCard. A card hidden via the ✕ panel button carries wp-hidden on
// its element — we never force it back visible (respect _isPanelHidden()).
function _isPanelHidden(el) {
  return !!(el && el.classList && el.classList.contains('wp-hidden'));
}
function renderDamageDoneCard(s) {
  const el = document.getElementById('wpDamageDone');
  if (!el) return;
  if (!_isPanelHidden(el) && el.style.display === 'none') el.style.display = '';
  let h = '<h2>Damage Done This Session</h2>';
  h += '<div style="font-size:16px;margin-bottom:8px">Total: <span class="num">' + fmtK(s.sessionTotalDamage) + '</span></div>';
  const contribs = Object.entries(s.sessionDamageBy || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (contribs.length) {
    h += '<table>';
    for (const [n, d] of contribs) h += '<tr><td class="name">' + esc(n) + '</td><td class="num">' + fmtK(d) + '</td></tr>';
    h += '</table>';
  }
  morphInto(el, h);
}
function renderHealingCard(s) {
  const el = document.getElementById('wpHealingCard');
  if (!el) return;
  const _et = s.currentEncounterThreat;
  let healers = [];
  if (_et && _et.perPlayer) {
    healers = Object.entries(_et.perPlayer)
      .map(([n, t]) => [n, (t && t.healRaw) || 0])
      .filter(x => x[1] > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }
  if (!healers.length) { if (el.style.display !== 'none') el.style.display = 'none'; morphInto(el, ''); return; }
  if (!_isPanelHidden(el) && el.style.display === 'none') el.style.display = '';
  const staleH = _et.flushedAt ? ' <span class="dim" style="font-size:11px;font-weight:normal">(ended)</span>' : '';
  let h = '<h2>💚 Healing — ' + esc(_et.bossName || 'this fight') + staleH + '</h2><table>';
  for (const [n, hp] of healers) h += '<tr><td class="name">' + esc(n) + '</td><td class="num" style="color:var(--green)">' + fmtK(hp) + '</td></tr>';
  h += '</table>';
  morphInto(el, h);
}
function renderWatchedLogsCard(s) {
  const el = document.getElementById('wpWatchedLogs');
  if (!el) return;
  if (!_isPanelHidden(el) && el.style.display === 'none') el.style.display = '';
  const _wls = s.watchedLogs || [];
  const _byChar = new Map();
  for (const w of _wls) {
    const k = (w.character || '?').toLowerCase();
    const cur = _byChar.get(k);
    if (!cur || (w.lastSeen || 0) > (cur.lastSeen || 0)) _byChar.set(k, w);
  }
  const _uniqueChars = _byChar.size;
  let h = '<h2>Watched Logs (' + _uniqueChars + (_wls.length > _uniqueChars ? ' chars · ' + _wls.length + ' files' : '') + ')</h2><table>';
  const recent = [..._byChar.values()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).slice(0, 15);
  for (const w of recent) {
    const hot = w.lastSeen && (Date.now() - w.lastSeen) < 3600000;
    h += '<tr><td>' + (hot ? '<span class="dot">●</span> ' : '&nbsp;&nbsp;') + '<span class="name">' + esc(w.character) + '</span></td><td class="dim">' + fmtAgo(w.lastSeen) + '</td></tr>';
  }
  h += '</table>';
  morphInto(el, h);
}
function renderRecentTellsCard(s) {
  const el = document.getElementById('wpRecentTells');
  if (!el) return;
  const _rt = s.recentTells || [];
  if (_rt.length === 0) { if (el.style.display !== 'none') el.style.display = 'none'; morphInto(el, ''); return; }
  if (!_isPanelHidden(el) && el.style.display === 'none') el.style.display = '';
  let h = '<h2>📬 Recent Tells <span class="dim" style="font-size:11px;font-weight:normal">(local, this machine only)</span></h2>';
  h += '<table style="font-size:11px"><tr><th>Who</th><th>Message</th><th>When</th></tr>';
  const _rtVisible = _rt.slice(-15).reverse();
  for (const t of _rtVisible) {
    const outgoing = t.direction === 'outgoing';
    const arrow = outgoing ? '→' : '←';
    const otherLink = '<a href="https://wolfpack.quest/me/tells" target="_blank" rel="noreferrer" class="tell-other" style="color:var(--blue);text-decoration:none">' + esc(t.other) + '</a>';
    const who = outgoing
      ? '<span class="dim">' + esc(t.character) + '</span> ' + arrow + ' ' + otherLink
      : otherLink + ' ' + arrow + ' <span class="dim">' + esc(t.character) + '</span>';
    const tsMs = t.capturedAt || (t.ts ? new Date(t.ts).getTime() : Date.now());
    h += '<tr><td style="white-space:nowrap">' + who + '</td><td>' + esc(t.text) + '</td><td class="dim" style="white-space:nowrap">' + fmtAgo(tsMs) + '</td></tr>';
  }
  h += '</table>';
  morphInto(el, h);
}
function renderTriggerAlertsCard(s) {
  const el = document.getElementById('wpTriggerAlerts');
  if (!el) return;
  const now = Date.now();
  const liveO = (s.activeOverlays || []).filter(o => o && o.text && (now - (o.shownAt || 0)) < (o.duration_ms || 5000));
  if (liveO.length === 0) { if (el.style.display !== 'none') el.style.display = 'none'; morphInto(el, ''); return; }
  if (!_isPanelHidden(el) && el.style.display === 'none') el.style.display = '';
  let h = '<h2 style="margin-bottom:6px">⚡ Trigger</h2>';
  for (const o of liveO.slice(0, 5)) {
    const cls = o.scope === 'personal' ? 'personal' : 'guild';
    const remaining = Math.max(0, (o.duration_ms || 5000) - (now - o.shownAt));
    const alpha = Math.min(1, remaining / (o.duration_ms || 5000));
    h += '<div style="font-size:22px;font-weight:bold;line-height:1.4;color:' + esc(o.color || 'red') + ';opacity:' + alpha.toFixed(2) + '">' + esc(o.text) + '</div>' +
         '<div class="dim" style="font-size:10px;margin-top:2px">' + esc(cls) + ' · ' + esc(o.trigger || '') + '</div>';
  }
  morphInto(el, h);
}
function renderTopDamageCard(s) {
  const el = document.getElementById('wpTopDamage');
  if (!el) return;
  if (!_isPanelHidden(el) && el.style.display === 'none') el.style.display = '';
  let h = '<h2>Top Damage This Session</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">';
  for (const [list, listKey, title] of [[s.topDamageSaw, 'saw', 'I saw'], [s.topDamageDid, 'did', 'I did']]) {
    h += '<div><h3>' + title + '</h3>';
    if (!list?.length) h += '<div class="dim">(none yet)</div>';
    else for (const e of list) {
      const dKey = JSON.stringify({ list: listKey, attacker: e.attacker, amount: e.amount });
      h += '<div style="display:flex;align-items:baseline;gap:6px">' +
           '<button class="dismiss-td" data-key="' + esc(dKey) + '" style="background:none;border:none;color:var(--dim);cursor:pointer;padding:0;font-size:11px;line-height:1;flex-shrink:0" title="Remove">✕</button>' +
           '<span class="name">' + esc(e.attacker) + '</span> ' +
           '<span class="num">' + fmtK(e.amount) + '</span> ' +
           '<span class="dim">' + esc(e.label || '') + (e.ability ? ' — ' + esc(e.ability) : '') + '</span></div>';
    }
    h += '</div>';
  }
  h += '</div>';
  if (morphInto(el, h)) {
    el.querySelectorAll('.dismiss-td').forEach(b => _bindOnce(b, 'click', () => {
      try { dismissTopDamage(JSON.parse(b.dataset.key)); } catch {}
    }));
  }
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
  // 🛡️ Damage Shield card — per-tank DS output, grouped by source spell/song.
  // Detected at parse time via the DS allow-list (parseEvent → ds:true). Sorted
  // by total damage descending so heavy DS wearers float to the top; expand a
  // row to see the spell/song breakdown that's feeding it.
  const ds = s.damageShield || {};
  const dsTotals = Object.entries(ds).map(function(kv){
    const name = kv[0];
    const sources = kv[1] || {};
    var total = 0, hits = 0;
    for (const k in sources) { total += sources[k].total; hits += sources[k].count; }
    return { name: name, total: total, hits: hits, sources: sources };
  }).filter(function(r){ return r.total > 0; }).sort(function(a, b){ return b.total - a.total; });
  h += '<div class="card wide"><h2>🛡️ Damage Shields <span class="dim" style="font-size:11px;font-weight:normal">(DS damage by tank, grouped by spell/song)</span></h2>';
  if (dsTotals.length === 0) {
    h += '<div class="dim" style="font-size:12px">No damage-shield procs observed yet this session. The agent recognizes thorns / brambles / spikes / sanity shield / symbol of naltron / cassindra / halo of light / reflect and similar. Open a new pattern? Let an officer know.</div>';
  } else {
    h += '<table style="font-size:12px"><tr><th>Tank</th><th>Total DS</th><th>Hits</th><th>Spells / songs feeding it</th></tr>';
    for (const t of dsTotals.slice(0, 12)) {
      const srcEntries = Object.entries(t.sources).sort(function(a, b){ return b[1].total - a[1].total; });
      const srcSummary = srcEntries.map(function(kv){
        return '<span style="color:var(--gold)">' + esc(kv[0]) + '</span> <span class="dim">(' + fmtK(kv[1].total) + ' · ' + kv[1].count + 'h)</span>';
      }).join(' · ');
      h += '<tr><td class="name">' + esc(t.name) + '</td>' +
           '<td class="num">' + fmtK(t.total) + '</td>' +
           '<td class="num">' + t.hits + '</td>' +
           '<td style="font-size:11px">' + srcSummary + '</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';
  // Deaths
  const deaths = Object.entries(s.sessionDeaths||{}).sort((a,b)=>b[1]-a[1]);
  h += '<div class="card"><h2>Deaths This Session</h2>';
  if (!deaths.length) h += '<div class="dim">Nobody died. Very respectable.</div>';
  else { h += '<table>'; for (const [n,c] of deaths) h += '<tr><td class="name">' + esc(n) + '</td><td class="num" style="color:var(--red)">' + c + '</td></tr>'; h += '</table>'; }
  h += '</div>';
  h += '</div>';
  if (!setSectionHTML('tanks', h)) return;
  // Wire the hide/show character buttons in the Weapon Loadouts table.
  // Idempotent under morph (nodes persist across polls).
  document.querySelectorAll('[data-hide-char]').forEach(b => _bindOnce(b, 'click', async () => {
    await fetch('/api/loadouts/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hide', chars: [b.dataset.hideChar] }) });
    refresh();
  }));
  document.querySelectorAll('[data-show-char]').forEach(b => _bindOnce(b, 'click', async () => {
    await fetch('/api/loadouts/hide', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'show', chars: [b.dataset.showChar] }) });
    refresh();
  }));
  // Wire bandolier dropdowns — re-render the 4-cell grid when the user
  // picks a different set. Must mirror the server-side renderSet so
  // long item names continue to wrap inside their column.
  document.querySelectorAll('[data-bandolier-char]').forEach(sel => {
    _bindOnce(sel, 'change', () => {
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
  setSectionHTML('healers', h);
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
  setSectionHTML('deeps', h);
}

function renderPets(s) {
  let h = '<div class="card"><h2>Known Pets This Session</h2>';
  const pets = (s.knownPets||[]);
  if (!pets.length) h += '<div class="dim">No pets observed yet.</div>';
  else { h += '<table><tr><th>Pet</th><th>Owner(s)</th></tr>'; for (const p of pets) h += '<tr><td class="pet">' + esc(p.pet) + '</td><td class="name">' + p.owners.map(esc).join(', ') + '</td></tr>'; h += '</table>'; }
  h += '</div>';
  setSectionHTML('pets', h);
}

// ── Triggers tab ───────────────────────────────────────────────────────────
// One section for both guild triggers (read-only, source='guild') and personal
// triggers (CRUD via the inline form). The form lives inside a stable wrapper
// (#trigEditorPanel) and is rendered ONCE — refresh() rewrites the read-only
// "list" + "guild" blocks each poll without touching the editor, so the user
// can be mid-typing a pattern and not lose state.
// Zeal pipe status card — rendered into its own #wpZealCard element (a stable
// placeholder inside the Triggers section) so its live, ever-incrementing event
// counters + HP gauges don't force the whole Triggers section to rewrite every
// poll. Same self-isolating pattern as the other wp* injected cards. Hidden
// (display:none) until at least one Zeal event/client appears.
// Per-character "buffs & zone" card on the Dashboard. Shows what each watched
// character is carrying + where they are right now (green "live" dot), or what
// they logged out with (dimmed, "last seen Nm ago") once their client drops.
// Fed by s.zealClients (server resolves the EQ zone id → name). Self-updating
// #wpZealClients element so its 6s buff-tick countdowns don't rewrite the whole
// Dashboard section every poll.
// Buff remaining: Zeal reports it in 6-second EQ ticks. Show it as time
// ("2h12m" / "12m" / "24s") instead of raw ticks — readable at a glance.
function _fmtBuffTicks(t) {
  if (t == null) return '';
  var secs = Number(t) * 6;
  if (secs < 60)   return Math.round(secs) + 's';
  var h = Math.floor(secs / 3600);
  var m = Math.round((secs % 3600) / 60);
  if (h > 0) return h + 'h' + m + 'm';
  return m + 'm';
}
function renderZealClients(s) {
  const el = document.getElementById('wpZealClients');
  if (!el) return;   // Dashboard section not painted yet
  // Preserve which per-character gauge <details> are open ACROSS this poll's
  // rewrite. morphInto replaces innerHTML, which would otherwise snap an
  // expanded gauge dump shut every 2s (the bug: "opening gauge slots
  // immediately refreshes/collapses"). Re-stamp the open attribute on the ones
  // the user had expanded.
  const _openGauges = {};
  try {
    el.querySelectorAll('details[data-gauge]').forEach(function(d){
      if (d.open) _openGauges[d.getAttribute('data-gauge')] = 1;
    });
  } catch (e) { void e; }
  // Per-machine "don't care" filter — hide boxes/alts you aren't tracking.
  // Persisted in localStorage (same idea as the panel ✕). The ✕ on each row
  // adds the name; "show all" clears the set.
  var _zHidden = {};
  try { (JSON.parse(localStorage.getItem('wpZealHidden') || '[]') || []).forEach(function (n) { _zHidden[String(n).toLowerCase()] = 1; }); } catch (e) { void e; }
  const allClients = Array.isArray(s.zealClients) ? s.zealClients : [];
  let _hiddenCount = 0;
  const clients = allClients.filter(function (c) {
    if (c && _zHidden[String(c.character).toLowerCase()]) { _hiddenCount++; return false; }
    return true;
  });
  if (clients.length === 0 && _hiddenCount === 0) {
    if (el.style.display !== 'none') el.style.display = 'none';
    morphInto(el, '');
    return;
  }
  if (el.style.display === 'none') el.style.display = '';
  let h = '<h2>🧪 Buffs &amp; Zone <span class="dim" style="font-size:11px;font-weight:normal">· what each character is carrying + where (via Zeal)</span></h2>';
  for (const c of clients) {
    const dot   = c.live ? '<span style="color:var(--green)">●</span>' : '<span style="color:var(--dim)">○</span>';
    const where = c.zone_name ? esc(c.zone_name) : (c.zone != null ? 'zone ' + esc(String(c.zone)) : 'unknown zone');
    const meta  = [];
    meta.push(where);
    if (c.self_hp_pct != null) meta.push('self ' + Math.round(c.self_hp_pct) + '%');
    if (!c.live && c.updatedAt) meta.push('last seen ' + fmtAgo(c.updatedAt));
    else if (c.live)           meta.push('autoattack ' + (c.autoattack ? 'ON' : 'off'));
    h += '<div class="wp-zeal-row" data-zeal-char="' + esc(c.character) + '">';
    h += '<div style="margin-top:6px"><span class="name">' + dot + ' ' + esc(c.character) + '</span> '
       + '<span class="dim" style="font-size:11px">· ' + meta.join(' · ') + '</span>'
       + ' <button class="wp-zeal-hide" data-zeal-hide="' + esc(c.character) + '" title="Hide this character from Buffs and Zone (use Show all to bring it back)" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:11px;padding:0 3px;line-height:1">✕</button>'
       + '</div>';
    const buffs = Array.isArray(c.buffs) ? c.buffs : [];
    if (buffs.length) {
      const bstr = buffs.slice(0, 16).map(function(b){
        return esc(b.name) + (b.ticks != null ? ' <span class="dim">(' + _fmtBuffTicks(b.ticks) + ')</span>' : '');
      }).join(' · ');
      h += '<div style="margin-left:14px;color:#a371f7;font-size:12px">🧪 ' + bstr + '</div>';
    } else {
      h += '<div style="margin-left:14px;font-size:12px" class="dim">no buffs reported</div>';
    }
    if (c.casting) h += '<div style="margin-left:14px;color:#58a6ff;font-size:12px">✦ casting ' + esc(c.casting) + '</div>';
    // Pet line — present when we've identified the charm pet's gauge slot by
    // matching its name against the live charm-tracker entry for this owner.
    // Shows the pet's name + live HP%, with the slot id so a future protocol
    // doc can confirm it. Only shown for live clients (a logged-out character
    // can't have an active pet).
    if (c.live && c.pet_name) {
      h += '<div style="margin-left:14px;color:#f0883e;font-size:12px">🐾 pet: <b>' + esc(c.pet_name) + '</b> '
         + (c.pet_hp_pct != null ? Math.round(c.pet_hp_pct) + '%' : '?')
         + (c.pet_slot != null ? ' <span class="dim">(slot ' + esc(String(c.pet_slot)) + ')</span>' : '')
         + '</div>';
    }
    // Diagnostic: full gauge slot dump. Hidden in a <details> so it's not
    // noisy by default; expanding shows every populated slot exactly as Zeal
    // sends them so we can identify the pet slot id from a live machine and
    // wire it into the absorption directly (rather than via charm cross-ref).
    // Live clients only — frozen logged-out gauges aren't useful.
    if (c.live && Array.isArray(c.gauges) && c.gauges.length) {
      h += '<details data-gauge="' + esc(c.character) + '"' + (_openGauges[c.character] ? ' open' : '')
         + ' style="margin-left:14px;font-size:11px"><summary class="dim" style="cursor:pointer">'
         + c.gauges.length + ' gauge slot' + (c.gauges.length === 1 ? '' : 's')
         + ' <span class="dim" style="font-size:10px">(diagnostic — helps identify the pet slot)</span></summary>';
      h += '<table style="font-size:11px;margin-top:4px"><tr><th>Slot</th><th>HP%</th><th>Text</th></tr>';
      for (const g of c.gauges) {
        h += '<tr><td class="dim">' + esc(String(g.slot)) + '</td>'
           + '<td class="num">' + (g.hp_pct != null ? Math.round(g.hp_pct) + '%' : '?') + '</td>'
           + '<td>' + esc(g.text || '') + '</td></tr>';
      }
      h += '</table></details>';
    }
    h += '</div>';   // .wp-zeal-row
  }
  if (_hiddenCount > 0) {
    h += '<div style="margin-top:8px;font-size:11px" class="dim">' + _hiddenCount + ' character'
       + (_hiddenCount === 1 ? '' : 's') + ' hidden · '
       + '<a href="#" class="wp-zeal-show-all" style="color:var(--blue)">show all</a></div>';
  }
  morphInto(el, h);
}
function renderZealCard(s) {
  const el = document.getElementById('wpZealCard');
  if (!el) return;   // Triggers section not painted yet — nothing to fill
  const z = s.zeal || {};
  const zTotal = z.total || 0;
  const zPids  = Array.isArray(z.connectedPids) ? z.connectedPids : [];
  if (!(zTotal > 0 || zPids.length > 0)) {
    if (el.style.display !== 'none') el.style.display = 'none';
    morphInto(el, '');
    return;
  }
  if (el.style.display === 'none') el.style.display = '';
  let h = '';
  const ageSec = z.lastEventAt ? Math.round((Date.now() - z.lastEventAt) / 1000) : null;
  const live = ageSec !== null && ageSec < 10;
  h += '<h2>⚡ Zeal pipe '
     + '<span style="font-size:11px;font-weight:normal;color:' + (live ? 'var(--green)' : 'var(--dim)') + '">'
     + (zPids.length ? '● ' + zPids.length + ' client' + (zPids.length === 1 ? '' : 's') + ' connected' : '○ no clients')
     + (ageSec !== null ? ' · last event ' + (ageSec < 1 ? 'now' : ageSec + 's ago') : '')
     + '</span>'
     + ' <span class="dim" style="font-size:11px;font-weight:normal">· protocol diagnostics; per-character buffs &amp; zone are on the Dashboard</span></h2>';
  if (zTotal === 0) {
    h += '<div class="dim" style="font-size:12px">Connected but no events yet. In-game, try <code>/pipedelay 250</code> to make Zeal stream labels + gauges.</div>';
  } else {
    h += '<div class="dim" style="font-size:11px;margin-bottom:4px">' + zTotal + ' events this session</div>';
    h += '<table style="font-size:11px"><tr><th>Type</th><th>Count</th><th>Latest sample</th></tr>';
    const TYPE_NAMES = { '0': 'log', '1': 'label', '2': 'gauge', '3': 'player', '4': 'custom', '5': 'raid', '6': 'group' };
    const byType = z.byType || {};
    const samples = z.lastSamples || {};
    const keys = Object.keys(byType).sort(function(a, b){ return byType[b] - byType[a]; });
    // Decode a Zeal sample into a readable one-liner. The pipe wraps the
    // real payload in obj.data as a JSON STRING (double-encoded), so we
    // parse that first, then summarize per type instead of dumping escaped
    // soup. Falls back to truncated JSON if anything doesn't parse.
    const _decodeZeal = (sm) => {
      if (!sm || sm.obj === undefined) return '';
      const o = sm.obj;
      let inner = o && o.data;
      if (typeof inner === 'string') { try { inner = JSON.parse(inner); } catch (e) { void e; } }
      try {
        const type = String(o && o.type);
        const who = o && o.character ? o.character + ' · ' : '';
        if (type === '0' && inner) {                  // log
          return who + 'msgType ' + inner.type + ': "' + String(inner.text || '').slice(0, 60) + '"';
        }
        if (type === '3' && inner) {                  // player
          return who + 'zone ' + inner.zone + ' · autoattack ' + (inner.autoattack ? 'ON' : 'off');
        }
        if (type === '2' && Array.isArray(inner)) {   // gauge — HP per-mille
          const self = inner.find(g => g.type === 1);
          const tgt  = inner.find(g => g.type === 6 && g.text);
          const parts = [];
          if (self) parts.push('self ' + (self.value / 10).toFixed(0) + '%');
          if (tgt)  parts.push('target ' + tgt.text + ' ' + (tgt.value / 10).toFixed(0) + '%');
          return who + (parts.join(' · ') || 'gauges');
        }
        if (type === '1' && Array.isArray(inner)) {   // label
          const g = (n) => { const e = inner.find(x => x.type === n); return e ? e.value : ''; };
          return who + g(3) + ' L' + g(2) + ' <' + g(4) + '>';
        }
        if (type === '6' && Array.isArray(inner)) {   // group
          return who + inner.length + ' member(s): ' + inner.map(m => m.name).filter(Boolean).slice(0, 6).join(', ');
        }
      } catch (e) { void e; }
      try { return JSON.stringify(inner !== undefined ? inner : o).slice(0, 100); } catch (e) { void e; return ''; }
    };
    for (const k of keys) {
      const label = TYPE_NAMES[k] ? (k + ' (' + TYPE_NAMES[k] + ')') : k;
      const sampleStr = _decodeZeal(samples[k]);
      h += '<tr><td class="dim">' + esc(label) + '</td>'
         + '<td class="num">' + byType[k] + '</td>'
         + '<td><code style="font-size:10px;background:#161b22;border:1px solid var(--border);padding:1px 4px;border-radius:3px">' + esc(sampleStr) + '</code></td></tr>';
    }
    h += '</table>';
  }
  morphInto(el, h);
}
// 🐺 Charm diagnostic — shows the four-stage charm-detection pipeline so a
// user can see WHERE their charm dropped if the tracker isn\\'t lighting up:
//   1. Did the agent see the cast? (recent_self_casts row matching CHARM_SPELLS)
//   2. Did it stage the pending charm? (pending_charm)
//   3. Did the gauge get the pet? (slot16_by_char rows + article-filter pass)
//   4. Did the tracker open a session? (tracker entries)
// Hidden when there\\'s nothing to show; surfaces a "Detected ✓ / Missing ✗"
// row per stage when there is.
function renderCharmDiag(s) {
  const el = document.getElementById('wpCharmDiag');
  if (!el) return;   // Triggers tab not painted yet
  const d = s && s.charmDiag;
  if (!d) {
    if (el.style.display !== 'none') el.style.display = 'none';
    morphInto(el, '');
    return;
  }
  // Only render if there\\'s actionable data: any charm cast in the last 30s,
  // any pending charm, any slot 16 entry, or any tracker row.
  const hasData = (d.recent_self_casts && d.recent_self_casts.some(c => c.is_charm))
               || d.pending_charm
               || (d.tracker && d.tracker.length)
               || (d.slot16_by_char && d.slot16_by_char.some(r => r.slot16_text));
  if (!hasData) {
    if (el.style.display !== 'none') el.style.display = 'none';
    morphInto(el, '');
    return;
  }
  if (el.style.display === 'none') el.style.display = '';

  const chk = (ok) => ok ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--red)">✗</span>';
  let h = '<h2>🐺 Charm diagnostic <span class="dim" style="font-size:11px;font-weight:normal">(why isn\\'t my charm tracker lighting up?)</span></h2>';

  // Recent charm casts
  const charmCasts = (d.recent_self_casts || []).filter(c => c.is_charm);
  const otherCasts = (d.recent_self_casts || []).filter(c => !c.is_charm);
  h += '<div style="font-size:11px;margin-bottom:8px"><b>1. Cast seen?</b> ';
  if (charmCasts.length === 0) {
    h += chk(false) + ' <span class="dim">no charm-spell "You begin casting" line in the last 30s on any watched character.</span>';
    if (otherCasts.length > 0) {
      h += '<div class="dim" style="font-size:10px;margin-top:2px">' + otherCasts.length + ' other cast(s) seen — confirms log tail is working. Check spell name spelling against CHARM_SPELLS map.</div>';
    }
  } else {
    h += chk(true);
    h += '<table style="font-size:11px;width:100%;margin-top:4px"><tr><th>When</th><th>Character</th><th>Spell</th><th>Target (Zeal)</th></tr>';
    for (const c of charmCasts) {
      h += '<tr><td class="dim">' + c.ago_secs + 's ago</td>'
         +   '<td>' + esc(c.character) + '</td>'
         +   '<td style="color:var(--orange)">' + esc(c.spell) + '</td>'
         +   '<td class="dim">' + esc(c.target || '—') + '</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';

  // Pending charm
  h += '<div style="font-size:11px;margin-bottom:8px"><b>2. Pending charm staged?</b> ';
  if (!d.pending_charm) {
    h += chk(false) + ' <span class="dim">_pendingCharmSpell is empty (already consumed by a land OR never staged).</span>';
  } else {
    const p = d.pending_charm;
    h += p.expired ? chk(false) : chk(true);
    h += ' <span style="color:var(--blue)">' + esc(p.spell) + '</span> · <span class="dim">' + esc(p.class) + '</span>'
       + ' · ' + p.dur_sec + 's duration · owner <b>' + esc(p.owner || '?') + '</b>'
       + ' · staged ' + Math.round(p.age_ms / 1000) + 's ago'
       + (p.expired ? ' <span style="color:var(--red)">(EXPIRED — window is ' + Math.round(d.charm_pending_window_ms / 1000) + 's; the gauge took too long)</span>'
                    : ' · expires in ' + Math.round(p.expires_in_ms / 1000) + 's');
  }
  h += '</div>';

  // Zeal gauge slot 16
  h += '<div style="font-size:11px;margin-bottom:8px"><b>3. Zeal slot 16 (pet gauge)?</b> ';
  const slot16Rows = (d.slot16_by_char || []).filter(r => r.slot16_text);
  if (slot16Rows.length === 0) {
    h += chk(false) + ' <span class="dim">No character is reporting slot 16 — Zeal pipe may be disconnected, or the charm hasn\\'t landed yet (gauge populates ~2s after).</span>';
  } else {
    h += chk(true);
    h += '<table style="font-size:11px;width:100%;margin-top:4px"><tr><th>Character</th><th>slot 16 text</th><th>Article filter</th><th>Updated</th></tr>';
    for (const r of slot16Rows) {
      h += '<tr><td>' + esc(r.character) + '</td>'
         +   '<td><code style="background:#161b22;padding:1px 4px;border-radius:3px">' + esc(r.slot16_text) + '</code></td>'
         +   '<td>' + (r.passes_article_filter
              ? '<span style="color:var(--green)">passes</span>'
              : '<span style="color:var(--red)">FAILS — needs to start with "a "/"an "</span>') + '</td>'
         +   '<td class="dim">' + (r.updated_age_secs != null ? r.updated_age_secs + 's ago' : '?') + '</td></tr>';
    }
    h += '</table>';
    if (slot16Rows.some(r => !r.passes_article_filter)) {
      h += '<div class="dim" style="font-size:10px;margin-top:4px;color:var(--orange)">⚠ The article-prefix filter in _reconcileGaugeCharms only opens a charm session when the slot 16 text starts with "a " or "an ". If your charmed mob doesn\\'t have an article in its name, this filter rejects it — flag the case so we can relax the rule.</div>';
    }
  }
  h += '</div>';

  // Tracker entries
  h += '<div style="font-size:11px;margin-bottom:8px"><b>4. Tracker session opened?</b> ';
  if (!d.tracker || d.tracker.length === 0) {
    h += chk(false) + ' <span class="dim">_charmTickTracker is empty. If steps 1-3 are ✓ but this is ✗, the gauge debounce (1.5s) hasn\\'t fired yet — wait a couple of seconds. If it stays empty, the owner mismatch in _consumePendingCharmSpell is the next thing to check.</span>';
  } else {
    h += chk(true);
    h += '<table style="font-size:11px;width:100%;margin-top:4px"><tr><th>Pet</th><th>Owner</th><th>Active</th><th>Class</th><th>Duration</th><th>Up</th></tr>';
    const now = d.now || Date.now();
    for (const t of d.tracker) {
      const up = t.started_at ? Math.round((now - t.started_at) / 1000) : 0;
      h += '<tr><td>' + esc(t.pet || '?') + '</td>'
         +   '<td>' + esc(t.owner || '?') + '</td>'
         +   '<td>' + (t.is_active ? '<span style="color:var(--green)">active</span>'
                                   : '<span class="dim">broken</span>') + '</td>'
         +   '<td class="dim">' + esc(t.charm_class || '(estimate)') + '</td>'
         +   '<td>' + (t.duration_sec ? t.duration_sec + 's' : '<span class="dim">(60s est)</span>') + '</td>'
         +   '<td class="dim">' + up + 's</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';

  morphInto(el, h);
}
function renderTriggers(s) {
  let h = '';
  h += '<div class="grid">';

  // Zeal pipe status — answers "is Zeal flowing?" at a glance. Shows
  // connected pids, total events this session, and per-type counts with the
  // newest sample of each. Only rendered under Mimic (Parser.bat has no Zeal
  // bridge); hidden entirely until at least one event arrives so it's not
  // dead space for non-Zeal users.
  // Zeal pipe status card lives in its OWN #wpZealCard element, filled by
  // renderZealCard() on each poll. Its event counters + live HP gauges change
  // every poll, so keeping it inline would make this whole section's HTML
  // differ every 2s — forcing a full innerHTML rewrite of the (large) guild-
  // triggers table + a remount of the trigger editor every 2 seconds. That
  // synchronous churn reset the editor form, flashed the page, and janked the
  // window hard enough to trip Windows' Aero Shake while dragging. Isolating
  // the volatile card means the HTML below stays byte-stable when triggers
  // don't change, so setSectionHTML short-circuits and only the card repaints.
  h += '<div id="wpZealCard" class="card wide" style="display:none"></div>';
  // Charm-tracking diagnostic card — filled by renderCharmDiag(). Hidden
  // until there's data to show (no watched character casting charms, etc.).
  h += '<div id="wpCharmDiag" class="card wide" style="display:none"></div>';

  // Active overlays (recent matches) — top of the page so the user can see
  // their triggers actually firing as they tune them. The "Clear" buttons
  // remove overlays from the in-memory ring buffer; no DB writes either way
  // so this is safe to mash without consequence.
  const overlays = (s.activeOverlays || []).slice(0, 6);
  h += '<div class="card wide">';
  h += '<h2>⚡ Recent fires';
  h += '<span style="float:right;font-size:11px;font-weight:normal">';
  h += '<button id="trigClearTestBtn" type="button" style="background:#21262d;color:var(--text);border:1px solid var(--border);padding:3px 10px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px;margin-right:6px" title="Remove only TEST-flagged overlays">🧪 Clear test fires</button>';
  h += '<button id="trigClearAllBtn" type="button" style="background:#21262d;color:var(--text);border:1px solid var(--border);padding:3px 10px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px" title="Remove ALL active overlays (in-memory only — no DB writes)">🗑 Clear all</button>';
  h += '</span></h2>';
  if (overlays.length === 0) {
    h += '<div class="dim" style="font-size:12px">No triggers have fired this session yet. Tune a pattern below and try again on the next log line — or click <b>Test</b> on a row to preview without waiting for a real match.</div>';
  } else {
    h += '<table style="font-size:12px"><tr><th>When</th><th>Trigger</th><th>Scope</th><th>Text</th></tr>';
    for (const o of overlays) {
      const ago = fmtAgo(o.shownAt || 0);
      const sc  = o.test ? 'TEST' : (o.scope === 'personal' ? 'personal' : 'guild');
      const scColor = o.test ? 'color:var(--gold)' : '';
      h += '<tr><td class="dim">' + esc(ago) + '</td>' +
           '<td class="name">' + esc(o.trigger || '?') + '</td>' +
           '<td class="dim" style="' + scColor + '">' + esc(sc) + '</td>' +
           '<td>' + esc(o.text || '') + '</td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';

  // Suggested triggers — one-click catalog of pre-tested alerts grouped by
  // category. Toggling the Enable checkbox creates/removes a personal
  // trigger with id "suggested:<template_id>" via /api/triggers/suggested;
  // the 🔊 toggle flips inline TTS on the action. Sits ABOVE personal
  // triggers because it's the easiest entry point for new users — building
  // a custom regex is a deep-end activity, not a default workflow.
  h += '<div class="card wide"><h2>🎯 Suggested triggers <span class="dim" style="font-size:11px;font-weight:normal">(one-click — toggle enabled + TTS per row)</span></h2>';
  h += '<div id="trigSuggestedList" class="dim" style="font-size:12px">loading…</div>';
  h += '</div>';

  // Personal triggers list — server-rendered table the user can toggle / edit /
  // delete via dedicated buttons. The form panel below owns the create flow.
  h += '<div class="card wide"><h2>👤 Personal triggers <span class="dim" style="font-size:11px;font-weight:normal">(this machine only)</span></h2>';
  h += '<div id="trigPersonalList" class="dim" style="font-size:12px">loading…</div>';
  h += '<div id="trigEditorPanel"></div>';
  h += '</div>';

  // Guild triggers — read-only (managed in wolfpack.quest/admin/triggers).
  h += '<div class="card wide"><h2>🛡️ Guild triggers <span class="dim" style="font-size:11px;font-weight:normal">(read-only; edit on wolfpack.quest/admin/triggers)</span></h2>';
  const gt = s.guildTriggers || [];
  if (gt.length === 0) {
    h += '<div class="dim" style="font-size:12px">No guild triggers loaded. Officers can add them at <a href="https://wolfpack.quest/admin/triggers" target="_blank" rel="noreferrer" style="color:var(--blue)">/admin/triggers</a>.</div>';
  } else {
    h += '<div class="dim" style="font-size:11px;margin-bottom:4px">' + gt.length + ' trigger' + (gt.length === 1 ? '' : 's') + ' loaded</div>';
    h += '<table style="font-size:12px"><tr><th>Name</th><th>Category</th><th>Pattern</th><th>Cooldown</th><th></th></tr>';
    // Render all of them — guild trigger sets are small enough (~100 rows max)
    // that pagination is overkill. NOTE: deliberately NOT using class="name"
    // on the trigger-name cells; the wolfpack.quest character-link click
    // delegation walks .name elements, slices text to the first space, and
    // opens /character/<first-token>. A trigger named "Aten Ha Ra Charm"
    // would clip to "Aten" → 404. Same trap as the DPS HUD label cell.
    for (const t of gt) {
      // "Copy → personal": stash the guild trigger's editable fields as JSON in
      // a data-attr (esc() escapes the quotes for the attribute, same pattern as
      // the dismiss-td buttons) so the delegated handler can prefill the personal
      // editor with them. No write to the guild set — it just clones into the
      // local personal triggers so the user can tweak their own copy.
      const _act = (Array.isArray(t.actions) ? t.actions : []).find(a => a && a.type === 'text_overlay') || {};
      const _copy = {
        name: (t.name || 'trigger') + ' (copy)',
        pattern: t.pattern || '',
        cooldown_seconds: t.cooldown_seconds || 0,
        overlay: _act.text || (t.name || ''),
        color: _act.color || 'red',
        duration_ms: _act.duration_ms || 5000,
        timer_duration_sec: t.timer_duration_sec || 0,
        end_early_pattern: t.end_early_pattern || '',
        zeal_condition: t.zeal_condition || null,
      };
      h += '<tr><td style="color:var(--orange)">' + esc(t.name || '?') + '</td>' +
           '<td class="dim">' + esc(t.category || 'callout') + '</td>' +
           '<td><code style="font-size:10px;background:#161b22;border:1px solid var(--border);padding:1px 4px;border-radius:3px">' + esc((t.pattern || '').slice(0, 80)) + '</code></td>' +
           '<td class="dim">' + ((t.cooldown_seconds || 0) > 0 ? t.cooldown_seconds + 's' : '—') + '</td>' +
           '<td><button type="button" data-trig-copy="' + esc(JSON.stringify(_copy)) + '" style="background:#21262d;color:var(--blue);border:1px solid var(--border);cursor:pointer;font-size:11px;padding:2px 8px;border-radius:3px;white-space:nowrap" title="Copy this guild trigger into your personal trigger editor so you can tweak your own version">⎘ Copy to personal</button></td></tr>';
    }
    h += '</table>';
  }
  h += '</div>';

  h += '</div>';
  if (!setSectionHTML('triggers', h)) return;
  // Mount the editor + render the personal list (idempotent — _wpTrigEditor
  // installs itself once and rebinds list rows on every paint).
  if (window._wpTrigEditor && window._wpTrigEditor.mount) {
    window._wpTrigEditor.mount();
  }
  if (window._wpSuggestedTriggers && window._wpSuggestedTriggers.mount) {
    window._wpSuggestedTriggers.mount();
  }
}

// ── Overlays tab ───────────────────────────────────────────────────────────
// Inventory of every overlay window Mimic could show, with per-overlay
// visibility + opacity slider. Acts on tray-menu config when Mimic is the
// host; falls back to a hint when loaded from a non-Mimic browser. The HUD
// + Trigger overlays are first-class; panel overlays are listed beneath.
// Built-in overlays the dashboard Overlays tab can toggle. key matches the
// status flag (showHud / enableTriggerTts / showCharm / showPets / showMobInfo)
// resolved in wpRefreshOverlayToggles + the Mimic 'toggle-overlay' IPC handler.
var WP_OVERLAY_ROWS = [
  ['hud',     'DPS HUD',             'Running session DPS, top damage seen, current encounter.'],
  ['trigger', 'Trigger alerts (TTS)','Centered big-text alert from triggers (guild + personal), spoken via Web Speech.'],
  ['charm',   'Charm tracker',       'Charm-pet recharm timer + 6s mob-tick counter; lingers 5m after a break.'],
  ['pet',     'Pet tracker',         'Summoned-pet HP + buff counters + current target (mage / necro / beastlord / charm).'],
  ['mobinfo', 'Mob Info',            'Current target: HP, AC, resists, special attacks, drop table.'],
  ['buffQueue','Buff queue',         'Raid/group buff + debuff/cure queue with severity sort; pick a class to focus. Fills non-Mimic raiders from observed casts.'],
  ['who',     '/who',                'Latest /who in zone + recently-gone; anon rows de-anon\\'d from history.'],
  ['melody',  'Melody',              'Bard /melody twist queue with cast bar + buff-window timers; ⏹ when you stop singing.'],
  ['zeal',    'Zeal health',         'Diagnostic — connected Zeal clients, last event time, sample by event type. Useful for confirming the Zeal pipe is healthy.'],
  ['threat',  'Threat meter',        'Per-fight aggro: swing/proc/spell/heal stacked breakdown per player, leader highlighted, pet hate rolled into owner. AAs like Voice of Thule + Disruptive Persecution count via a CAST_HATE map.'],
];

function renderOverlays(s) {
  let h = '';
  const mimic = !!(window.mimic && window.mimic.openDashboard);
  h += '<div class="grid">';
  h += '<div class="card wide"><h2>🪟 Overlays <span class="dim" style="font-size:11px;font-weight:normal">(transparent windows that float over EQ — DnDOverlay-style)</span></h2>';
  if (!mimic) {
    h += '<div class="dim" style="font-size:12px;padding:8px 0">Overlay controls require Mimic — open this dashboard from the desktop app to use them. (You are viewing it from a browser.)</div>';
    h += '</div></div>';
    setSectionHTML('overlays', h);
    return;
  }
  h += '<div class="dim" style="font-size:12px;margin-bottom:8px">Toggle any overlay on or off here — same as the tray menu (right-click the wolf in the system tray → <b>Overlays</b>), which also has lock/unlock, <b>Setup mode</b> placement, and per-overlay opacity.</div>';
  // How to move them. Convention is consistent across every overlay so users
  // build muscle memory: ✥ in the TOP-RIGHT corner = drag handle (hover to
  // grab + drag — works while locked); ✕ in the TOP-LEFT = hide that overlay.
  // Stated here once so it's discoverable from the dashboard instead of having
  // to read the icons' tooltips.
  h += '<div style="font-size:12px;padding:8px 10px;background:#161b22;border:1px solid var(--border);border-radius:6px;margin-bottom:8px">'
    + '<b style="color:var(--blue)">How to move an overlay:</b> hover the small <code style="background:#0d1117;padding:1px 5px;border-radius:3px">✥</code> icon in the <b>top-left corner</b> of any overlay and drag. Works whether the overlays are locked or unlocked &mdash; same in every overlay so the muscle memory carries. The <code style="background:#0d1117;padding:1px 5px;border-radius:3px">✕</code> in the <b>top-right</b> hides that overlay (turn it back on from this page or the tray).'
    + '</div>';
  h += '</div>';

  // Interactive built-in overlay toggles. Buttons carry data-ov="<key>"; a
  // single delegated click handler (wired once) calls window.mimic.toggleOverlay.
  // State is refreshed from window.mimic.getStatus() after render + after each
  // toggle. No inline onclick (keeps the dashboard template free of escaped
  // quotes — see the WEB_HTML escape-hazard note).
  h += '<div class="card wide"><h2>Built-in overlays</h2>';
  h += '<table style="font-size:12px"><tr><th>Overlay</th><th>State</th><th>Description</th></tr>';
  for (var i = 0; i < WP_OVERLAY_ROWS.length; i++) {
    var key = WP_OVERLAY_ROWS[i][0], label = WP_OVERLAY_ROWS[i][1], desc = WP_OVERLAY_ROWS[i][2];
    h += '<tr><td style="color:var(--text)">' + label + '</td>'
      +  '<td><button type="button" class="wp-ov-toggle" data-ov="' + key + '">…</button></td>'
      +  '<td class="dim">' + desc + '</td></tr>';
  }
  h += '</table>';
  h += '<div class="dim" style="font-size:11px;margin-top:8px">A panel from the <b>Dashboard</b> tab can also be sent to its own overlay via the <code style="background:#0d1117;border:1px solid var(--border);padding:1px 4px;border-radius:3px">overlay</code> button on each card. Lock/Setup placement live in the tray.</div>';
  h += '</div>';

  h += '</div>';
  setSectionHTML('overlays', h);
  wpRefreshOverlayToggles();
}

// Flip an overlay via the Mimic IPC bridge, then refresh button states.
function wpToggleOverlay(name) {
  try {
    if (window.mimic && window.mimic.toggleOverlay) {
      var r = window.mimic.toggleOverlay(name);
      if (r && r.then) r.then(function(){ wpRefreshOverlayToggles(); });
      else wpRefreshOverlayToggles();
    }
  } catch (e) { void e; }
}
// Paint each .wp-ov-toggle button from the live Mimic status.
function wpRefreshOverlayToggles() {
  if (!(window.mimic && window.mimic.getStatus)) return;
  try {
    window.mimic.getStatus().then(function(st){
      st = st || {};
      var on = { hud: !!st.showHud, trigger: !!st.enableTriggerTts, charm: !!st.showCharm, pet: !!st.showPets, mobinfo: !!st.showMobInfo, buffQueue: !!st.showBuffQueue, who: !!st.showWho, melody: !!st.showMelody, zeal: !!st.showZeal };      var on = { hud: !!st.showHud, trigger: !!st.enableTriggerTts, charm: !!st.showCharm, pet: !!st.showPets, mobinfo: !!st.showMobInfo, buffQueue: !!st.showBuffQueue, who: !!st.showWho, melody: !!st.showMelody, zeal: !!st.showZeal, threat: !!st.showThreat };      var btns = document.querySelectorAll('.wp-ov-toggle');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i]; var k = b.getAttribute('data-ov'); var isOn = !!on[k];
        b.textContent = isOn ? 'ON' : 'OFF';
        b.className = 'wp-ov-toggle' + (isOn ? ' on' : '');
      }
    }).catch(function(){});
  } catch (e) { void e; }
}
// Delegated click — wired once, survives the render loop re-setting innerHTML.
if (typeof window !== 'undefined' && !window.__wpOvDelegated) {
  window.__wpOvDelegated = true;
  document.addEventListener('click', function(e){
    var t = e.target;
    var b = (t && t.closest) ? t.closest('.wp-ov-toggle') : null;
    if (!b) return;
    var name = b.getAttribute('data-ov');
    if (name) wpToggleOverlay(name);
  });
}

function renderInfo(s) {
  const sessionMin = Math.max(1, Math.round((Date.now() - s.startedAt) / 60000));
  // totalMinutes now accumulates the live session incrementally (saveStatsSoon),
  // so it IS the lifetime — don't add sessionMin again or the current session
  // double-counts. Floor to sessionMin so a brand-new install isn't shown below
  // the session that's already running.
  const lifetimeMin = Math.max(s.lifetime?.totalMinutes||0, sessionMin);
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
    // Snapshot which character rows are currently open so the 1-3s refresh
    // doesn't collapse them. We re-apply the open set after innerHTML rewrite.
    var _spOpen = new Set();
    try {
      var _ex = document.querySelectorAll('#info details[data-cc-name]');
      for (var _i = 0; _i < _ex.length; _i++) {
        if (_ex[_i].hasAttribute('open')) _spOpen.add(_ex[_i].getAttribute('data-cc-name'));
      }
    } catch (e) {}
    // Player vs NPC split — single-word Title-cased names that have been
    // confirmed via /who, parses, or chat are likely real players. Everything
    // else (multi-word, lowercased, "(unknown)", "a frog") falls into the
    // NPC / other bucket. This stops a multi-word NPC like "a sentinel ward"
    // from sitting in the same list as real player names.
    function _ccIsPlayerName(n) {
      if (!n) return false;
      if (n === '(unknown)') return false;
      if (/\s/.test(n)) return false;
      return /^[A-Z][a-zA-Z]{2,}$/.test(n);
    }
    // Resisted-spell attribution per mob: EQ logs a mob's cast as the anonymous
    // "a spell", but a resist names it — so for the NPC cast list we can reveal
    // what some of a mob's "a spell" casts actually were. _rsByMob(mob) returns
    // the [spell, count] pairs we resisted from that mob this session.
    var _rsAll = s.resistedSpells || {};
    function _rsByMob(mob) {
      var out = [];
      var keys = Object.keys(_rsAll);
      for (var i = 0; i < keys.length; i++) {
        var rec = _rsAll[keys[i]] || {};
        var n = (rec.byMob && rec.byMob[mob]) || 0;
        if (n > 0) out.push([keys[i], n]);
      }
      return out.sort(function(a, b){ return b[1] - a[1]; });
    }
    function _ccRenderGroup(title, names, hint, withResists) {
      if (names.length === 0) return '';
      var html = '<div class="card wide"><h2>' + title + '</h2>';
      if (hint) html += '<div class="subtle" style="font-size:11px;margin-bottom:6px">' + hint + '</div>';
      var ordered = names.map(function(name) {
        var spells = cc[name] || {};
        var total = Object.values(spells).reduce(function(a, b){ return a + b; }, 0);
        return { name: name, spells: spells, total: total };
      }).sort(function(a, b){ return b.total - a.total; });
      ordered.slice(0, 10).forEach(function(c) {
        var spellEntries = Object.entries(c.spells).sort(function(a, b){ return b[1] - a[1]; }).slice(0, 8);
        var openAttr = _spOpen.has(c.name) ? ' open' : '';
        html += '<details data-cc-name="' + esc(c.name) + '"' + openAttr + '>';
        html += '<summary><span class="name">' + esc(c.name) + '</span> <span class="dim">— ' + c.total + ' cast' + (c.total === 1 ? '' : 's') + '</span></summary>';
        html += '<table>';
        for (var k = 0; k < spellEntries.length; k++) {
          html += '<tr><td>' + spellLink(spellEntries[k][0]) + '</td><td class="num">' + spellEntries[k][1] + '</td></tr>';
        }
        html += '</table>';
        // Name what this mob's anonymous "a spell" casts actually were, from
        // spells we resisted off it this session.
        if (withResists === true) {
          var rs = _rsByMob(c.name);
          if (rs.length > 0) {
            html += '<div class="subtle" style="font-size:10px;margin:4px 0 2px">Named via resists off this mob:</div><table>';
            for (var r = 0; r < rs.length; r++) {
              html += '<tr><td>' + spellLink(rs[r][0]) + '</td><td class="num">' + rs[r][1] + ' resisted</td></tr>';
            }
            html += '</table>';
          }
        }
        html += '</details>';
      });
      html += '</div>';
      return html;
    }
    var playerNames = casters.filter(_ccIsPlayerName);
    var otherNames  = casters.filter(function(n){ return !_ccIsPlayerName(n); });
    h += _ccRenderGroup('Spell Casts This Session — Players', playerNames,
      'Reliable for the uploader. Other casters land under <code>(unknown)</code> because EQ does not log the spell name for bystanders.', false);
    h += _ccRenderGroup('Spell Casts This Session — NPCs / Unknown', otherNames,
      'Casts attributed to NPCs or to bystanders whose spell name EQ does not reveal. A mob\\'s "a spell" casts are named below where we resisted them.', true);
  }

  // Resisted incoming spells — names what mobs are actually casting at us.
  // EQ hides the spell on a mob's cast line ("a spell"), but a resist names
  // it. This is the only way to learn a mob's spell list from our own log.
  var _rs = s.resistedSpells || {};
  var _rsNames = Object.keys(_rs);
  if (_rsNames.length > 0) {
    // Preserve which spell rows are expanded across the 1s re-render (same
    // pattern as the inbound-spell-damage card below).
    var _rsOpen = new Set();
    try {
      var _re = document.querySelectorAll('#info details[data-rs-name]');
      for (var _rk = 0; _rk < _re.length; _rk++) {
        if (_re[_rk].hasAttribute('open')) _rsOpen.add(_re[_rk].getAttribute('data-rs-name'));
      }
    } catch (e) {}
    h += '<div class="card wide"><h2>🛡 Spells Resisted (incoming)</h2>';
    h += '<div class="subtle" style="font-size:11px;margin-bottom:6px">Spells mobs cast at you that you resisted — this names what their "a spell" casts actually were. Expand a row to see which mobs cast it + how many times.</div>';
    _rsNames.map(function (n) { return [n, _rs[n]]; })
      .sort(function (a, b) { return (b[1].count || 0) - (a[1].count || 0); })
      .forEach(function (e) {
        var rec = e[1] || {};
        var byMob = rec.byMob || {};
        var mobs = Object.keys(byMob).map(function (m) { return [m, byMob[m]]; })
          .sort(function (a, b) { return (b[1] || 0) - (a[1] || 0); }).slice(0, 20);
        var openAttr = _rsOpen.has(e[0]) ? ' open' : '';
        h += '<details data-rs-name="' + esc(e[0]) + '"' + openAttr + '>';
        h += '<summary><span class="name">' + spellLink(e[0]) + '</span> '
           + '<span class="dim">— ' + (rec.count || 0) + ' resisted'
           + (rec.lastMob ? ', last from ' + esc(rec.lastMob) : '') + '</span></summary>';
        if (mobs.length > 0) {
          h += '<table><tr><th>Cast by</th><th class="num">Resisted</th></tr>';
          for (var mi = 0; mi < mobs.length; mi++) {
            h += '<tr><td>' + esc(mobs[mi][0]) + '</td><td class="num">' + (mobs[mi][1] || 0) + '</td></tr>';
          }
          h += '</table>';
        } else {
          h += '<div class="dim" style="font-size:11px;padding:2px 0">No mob attribution yet — resisted outside a tracked fight.</div>';
        }
        h += '</details>';
      });
    h += '</div>';
  }

  // Inbound spell damage on YOU, grouped by caster → spell. Counterpart to the
  // resisted card: what got through. Caster is the group; the spell names sit
  // underneath. (Only the uploader's own inbound is tracked.)
  var _isd = s.inboundSpellDamage || {};
  var _isdCasters = Object.keys(_isd);
  if (_isdCasters.length > 0) {
    var _isdOpen = new Set();
    try {
      var _ie = document.querySelectorAll('#info details[data-isd-name]');
      for (var _j = 0; _j < _ie.length; _j++) {
        if (_ie[_j].hasAttribute('open')) _isdOpen.add(_ie[_j].getAttribute('data-isd-name'));
      }
    } catch (e) {}
    h += '<div class="card wide"><h2>🔥 Spell Damage Inbound (who cast it)</h2>';
    h += '<div class="subtle" style="font-size:11px;margin-bottom:6px">Spell / DoT / proc damage that landed on <b>you</b> this session, grouped by caster then spell. <code>(unknown)</code> = EQ logged the spell but not the caster.</div>';
    var _isdOrdered = _isdCasters.map(function (name) {
      return { name: name, rec: _isd[name] || { total: 0, count: 0, spells: {} } };
    }).sort(function (a, b) { return (b.rec.total || 0) - (a.rec.total || 0); });
    _isdOrdered.slice(0, 12).forEach(function (c) {
      var spells = Object.entries(c.rec.spells || {})
        .sort(function (a, b) { return (b[1].total || 0) - (a[1].total || 0); })
        .slice(0, 12);
      var openAttr = _isdOpen.has(c.name) ? ' open' : '';
      h += '<details data-isd-name="' + esc(c.name) + '"' + openAttr + '>';
      h += '<summary><span class="name">' + esc(c.name) + '</span> <span class="dim">— ' + fmtK(c.rec.total || 0) + ' over ' + (c.rec.count || 0) + ' hit' + ((c.rec.count === 1) ? '' : 's') + '</span></summary>';
      h += '<table><tr><th>Spell</th><th class="num">Total</th><th class="num">Hits</th><th class="num">Max</th></tr>';
      for (var k = 0; k < spells.length; k++) {
        h += '<tr><td>' + spellLink(spells[k][0]) + '</td>' +
             '<td class="num">' + fmtK(spells[k][1].total || 0) + '</td>' +
             '<td class="num">' + (spells[k][1].count || 0) + '</td>' +
             '<td class="num">' + fmtK(spells[k][1].max || 0) + '</td></tr>';
      }
      h += '</table></details>';
    });
    h += '</div>';
  }

  h += '</div>';
  setSectionHTML('info', h);
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
  if (!o) { morphInto(document.getElementById('optin'), '<div class="dim">Loading...</div>'); return; }
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
        // /who-only rescan label — show whether this file has been rescanned
        // under a recent agent version. Pre-v3.0.35 backfills missed visible-
        // class /who rows due to a keep-pattern bug; the ↺ /who button below
        // walks the file again for /who rows only (fast — skips chat + combat).
        const whoVer = f.resume?.whoRescanVersion ? 'v' + f.resume.whoRescanVersion : '';
        const whoWhen = f.resume?.whoRescanAt
          ? new Date(f.resume.whoRescanAt).toLocaleString()
          : '';
        const whoCount = f.resume?.whoRescanCount != null ? f.resume.whoRescanCount + ' /who' : '';
        const whoTip = [whoWhen, whoVer, whoCount].filter(Boolean).join(' · ');
        const whoLabel = whoTip
          ? ' <span class="dim" style="font-size:10px" title="' + esc(whoTip) + '">↺ rescanned ' + esc(whoVer) + '</span>'
          : '';
        // Stale-backfill nudge: the agent has shipped new detectors since
        // this file was backfilled. We pulse the ↻ Re-run button and prefix
        // the row with a small chip naming what would land. Matches the
        // pulse on the header banner so the two cues are visibly tied.
        const stale     = (f.staleDetectors || []);
        const isStale   = stale.length > 0;
        const staleLbls = stale.map(d => d.label).join(', ');
        const staleTip  = isStale
          ? 'Backfilled under v' + esc((f.resume && f.resume.agentVersion) || '?') + '. New detectors since: ' + esc(staleLbls) + '. Re-run to capture them.'
          : '';
        const staleChip = isStale
          ? ' <span class="dim" style="font-size:10px;background:#1a3a1f;color:#bff5c5;border:1px solid #2ea043;border-radius:3px;padding:1px 6px;margin-left:6px" title="' + staleTip + '">★ ' + stale.length + ' new</span>'
          : '';
        const rerunClass = isStale ? ' class="wp-rerun-stale"' : '';
        const rerunTip   = isStale
          ? staleTip
          : 'Re-run backfill from byte 0 — picks up PvP kills, chat, and combat events that newer agent/bot versions extract but the prior pass missed. Server-side dedup prevents double-counting.';
        resumeStr =
          '<span style="color:var(--green)" title="' + esc(tip) + '">✓ done</span>' +
          (when ? ' <span class="dim" style="font-size:10px">' + esc(when.replace(/, /, ' ')) + (ver ? ' · ' + esc(ver) : '') + '</span>' : '') +
          whoLabel +
          staleChip +
          ' <button data-rerun="' + esc(f.path) + '"' + rerunClass + ' title="' + rerunTip + '" style="margin-left:8px;background:#a06628;border:1px solid #a06628;color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;cursor:pointer;font-weight:500">↻ Re-run</button>' +
          ' <button data-rescan-who="' + esc(f.path) + '" title="Re-scan this file for /who rows only (fast — skips chat + combat which are already uploaded). Captures visible-class /who rows that a pre-v3.0.35 keep-pattern bug silently dropped." style="margin-left:4px;background:#1f6feb;border:1px solid #1f6feb;color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;cursor:pointer;font-weight:500">↺ /who only</button>';
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
  if (!setSectionHTML('optin', h)) return;   // morph in place; skip if unchanged

  // Wire interactions — idempotent under morph (nodes persist across polls).
  root.querySelectorAll('input[type=checkbox][data-path]').forEach(cb => {
    _bindOnce(cb, 'change', async () => {
      await postOptin(cb.checked ? 'select' : 'deselect', { paths: [cb.dataset.path] });
      refreshOptin();
    });
  });
  root.querySelectorAll('button[data-act]').forEach(b => {
    _bindOnce(b, 'click', async () => {
      const act = b.dataset.act;
      if (act === 'pane-active')  { _optinPane = 'active';  refreshOptin(); return; }
      if (act === 'pane-ignored') { _optinPane = 'ignored'; refreshOptin(); return; }
      if (act === 'select-all')   { await postOptin('select-all');   refreshOptin(); return; }
      if (act === 'select-none')  { await postOptin('select-none');  refreshOptin(); return; }
      if (act === 'rescan')       { await postOptin('rescan');       refreshOptin(); return; }
      if (act === 'backfill') {
        const paths = [...root.querySelectorAll('input[type=checkbox][data-path]:checked')].map(x => x.dataset.path);
        if (paths.length > 0 && confirm('Start backfill on ' + paths.length + ' file(s)?')) {
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
    _bindOnce(b, 'click', async () => {
      const p = b.dataset.rerun;
      if (!p) return;
      if (!confirm('Re-run backfill on this file from the beginning? Useful when the log has grown since the last completion.')) return;
      await postOptin('rerun', { paths: [p] });
      refreshOptin();
    });
  });
  // /who-only rescan — fast path that walks the file for /who rows ONLY, skips
  // chat + combat. Use after upgrading past a /who keep-pattern fix (v3.0.35
  // and later) to retroactively capture rows that earlier agents byte-dropped.
  root.querySelectorAll('button[data-rescan-who]').forEach(b => {
    _bindOnce(b, 'click', async () => {
      const p = b.dataset.rescanWho;
      if (!p) return;
      if (!confirm('Re-scan this file for /who rows only? Fast — skips chat and combat (already uploaded). Captures visible-class /who rows that the pre-v3.0.35 keep pattern silently dropped.')) return;
      await postOptin('rescan-who', { paths: [p] });
      refreshOptin();
    });
  });
  // Backfill request Accept / Dismiss buttons
  root.querySelectorAll('button[data-bf-act]').forEach(b => {
    _bindOnce(b, 'click', async () => {
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
  // Sort dropdown via DELEGATION on the stable #optin container. The <select>
  // node is recreated on every innerHTML rebuild, so binding directly to it
  // was unreliable (lost across change-detection skips / rebuilds). #optin
  // itself never gets destroyed, so a single delegated 'change' listener on it
  // catches the bubbling event from #sortMode reliably.
  _bindOnce(root, 'change', async (e) => {
    if (e.target && e.target.id === 'sortMode') {
      await postOptin('sort', { mode: e.target.value });
      refreshOptin();
    }
  });
}

async function refreshOptin() {
  try {
    const o = await (await fetch('/api/optin')).json();
    renderOptin(o);
  } catch { renderOptin(null); }
}

var _refreshFailures = 0;
async function refresh() {
  try {
    const s = await (await fetch('/api/state', { cache: 'no-store' })).json();
    _refreshFailures = 0;
    var _eb = document.getElementById('wpConnError'); if (_eb) _eb.remove();
    // Preserve scroll across the render batch. Change-detection means most
    // polls rewrite nothing (no shift); when the ACTIVE section does rewrite
    // with a different height, restoring scroll keeps the page from bouncing.
    const _sx = window.scrollX, _sy = window.scrollY;
    // Render each section in ISOLATION. Previously all seven ran on one line
    // inside this try, so a single throwing section (e.g. one bad data shape in
    // 51-character installs) aborted the rest AND was swallowed by the outer
    // catch below — leaving the body blank with no error anywhere. Now a
    // failing section shows its own error card (visible on-screen, not just the
    // log) and the other sections still render.
    var _sections = [['header', renderHeader], ['dash', renderDash], ['zealclients', renderZealClients],
                     ['critscard', renderCritsCard],
                     // Isolated dashboard volatile cards (fill their own wp* placeholders
                     // so #dash stops repainting every poll — the stutter fix).
                     ['triggeralerts', renderTriggerAlertsCard], ['damagedone', renderDamageDoneCard],
                     ['healingcard', renderHealingCard], ['watchedlogs', renderWatchedLogsCard],
                     ['recenttells', renderRecentTellsCard], ['topdamage', renderTopDamageCard],
                     ['tanks', renderTanks], ['healers', renderHealers], ['deeps', renderDeeps],
                     ['pets', renderPets], ['triggers', renderTriggers], ['zealcard', renderZealCard],
                     ['charmdiag', renderCharmDiag],
                     ['overlays', renderOverlays], ['info', renderInfo]];
    for (var _si = 0; _si < _sections.length; _si++) {
      var _sid = _sections[_si][0], _sfn = _sections[_si][1];
      try { _sfn(s); }
      catch (_re) {
        try { console.error('[dashboard] render ' + _sid + ' failed:', _re && (_re.stack || _re.message || _re)); } catch (_) {}
        try {
          var _sel = document.getElementById(_sid);
          if (_sel) {
            _sel.innerHTML = '<div class="card" style="border-color:#a3260a">' +
              '<h2 style="color:#f85149">⚠ This panel failed to render</h2>' +
              '<div class="dim" style="font-size:11px;white-space:pre-wrap;word-break:break-word">' +
              esc(String(_re && (_re.stack || _re.message) || _re)) + '</div></div>';
            _sel._wpLastHtml = null;  // bust morph cache so a later good render re-applies
          }
        } catch (_) {}
      }
    }
    if (window.scrollX !== _sx || window.scrollY !== _sy) window.scrollTo(_sx, _sy);
    // Surface pending backfill request count on the Opt-in tab so officers
    // notice without clicking through.
    const pending = (s.backfillRequests || []).filter(r => r.status === 'pending').length;
    const optinBtn = document.querySelector('.nav button[data-tab="optin"]');
    if (optinBtn) {
      const baseLabel = 'Opt-in Logs';
      optinBtn.textContent = pending > 0 ? (baseLabel + ' (' + pending + ')') : baseLabel;
      optinBtn.style.color = pending > 0 ? '#f0883e' : '';
    }
  } catch (e) {
    // The /api/state poll failed — the engine is unreachable from this page
    // (usually the window is pointed at a stale port after an agent restart).
    // Make it VISIBLE instead of a silent blank, with the exact origin so the
    // problem is obvious, plus a one-click reload to the live engine.
    _refreshFailures++;
    if (_refreshFailures >= 2 && !document.getElementById('wpConnError')) {
      var d = document.createElement('div');
      d.id = 'wpConnError';
      d.setAttribute('style', 'margin:16px;padding:14px 16px;border:1px solid #a3260a;background:#2a1212;color:#ffd2c2;border-radius:8px;font-size:13px;line-height:1.5');
      d.innerHTML =
        '⚠ <b>Can’t reach the parser engine</b> at <code>' + (location.origin || '?') + '</code>.<br>' +
        'The agent likely restarted on a different port and this window is still on the old one.' +
        '<div style="margin-top:8px"><button id="wpConnReload" style="background:#1f6feb;color:#fff;border:0;border-radius:5px;padding:6px 14px;cursor:pointer;font-family:inherit;font-size:12px">🔄 Reload to the live engine</button> <span style="color:#c98">— or fully restart Mimic.</span></div>';
      var host = document.querySelector('.section.active') || document.body;
      host.insertBefore(d, host.firstChild);
      var rb = document.getElementById('wpConnReload');
      if (rb) rb.onclick = function () {
        try { if (window.mimic && window.mimic.openDashboard) { window.mimic.openDashboard(); return; } } catch (_) {}
        location.reload();
      };
    }
  }
}

// Tab switcher — scoped to .nav buttons that have a data-tab attribute.
// The selector USED to be just '.nav button' which also matched the
// '⚙ Panels' popover button; clicking it wiped every section's .active
// state and then threw on getElementById(undefined). Net effect: dashboard
// blanked. Scoping to [data-tab] keeps the popover button out of the loop.
document.querySelectorAll('.nav button[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.nav button[data-tab]').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.section').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById(b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'optin') refreshOptin();
}));
refresh(); setInterval(refresh, 2000);
// Refresh opt-in every 3s while its tab is active (for live backfill progress)
setInterval(() => { if (document.getElementById('optin').classList.contains('active')) refreshOptin(); }, 3000);

// UI Studio nav button — opens the standalone editor window via Electron IPC.
// Available only when the dashboard is running inside Mimic's main window
// (preload exposes window.mimic). In a plain browser the button stays
// visible but its click silently no-ops, since the IPC is the only entry
// point. The button is OUTSIDE the [data-tab] selector above so it doesn't
// participate in the in-page tab swap — it's a side door, not a tab body.
var _uiStudioBtn = document.getElementById('wpUiStudioBtn');
if (_uiStudioBtn) {
  _uiStudioBtn.addEventListener('click', function(){
    if (window.mimic && window.mimic.openUiStudio) {
      try { window.mimic.openUiStudio(); } catch (e) {}
    }
  });
  // Dim the button in non-Mimic browser contexts so users aren't confused
  // by an unresponsive control.
  if (!(window.mimic && window.mimic.openUiStudio)) {
    _uiStudioBtn.style.opacity = '0.4';
    _uiStudioBtn.title = 'UI Studio is only available inside Mimic — open the Mimic dashboard window';
  }
}

// Buffs & Zone per-character hide (✕) + "show all". Stored in localStorage so a
// machine's "don't care" choices persist; renderZealClients reads the set each
// poll. Delegated so it survives the card's re-render. Removing the row's DOM
// node makes the hide feel instant; the next poll keeps it filtered.
document.addEventListener('click', function (e) {
  var t = e.target;
  if (!t || !t.classList) return;
  if (t.classList.contains('wp-zeal-hide')) {
    e.preventDefault();
    var name = t.getAttribute('data-zeal-hide');
    if (!name) return;
    try {
      var set = JSON.parse(localStorage.getItem('wpZealHidden') || '[]') || [];
      if (set.map(function (x) { return String(x).toLowerCase(); }).indexOf(name.toLowerCase()) === -1) set.push(name);
      localStorage.setItem('wpZealHidden', JSON.stringify(set));
    } catch (err) { void err; }
    var row = t.closest ? t.closest('.wp-zeal-row') : null;
    if (row && row.parentNode) row.parentNode.removeChild(row);
    var el = document.getElementById('wpZealClients');
    if (el) el._wpLastHtml = null;   // force a clean re-render next poll
  } else if (t.classList.contains('wp-zeal-show-all')) {
    e.preventDefault();
    try { localStorage.removeItem('wpZealHidden'); } catch (err) { void err; }
    var el2 = document.getElementById('wpZealClients');
    if (el2) el2._wpLastHtml = null;
  }
});

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
    if (!h) return "";
    // Read ONLY the h2's own TEXT nodes — skip injected chrome (drag handle,
    // 🪟 overlay button, ✕ hide button, source toggle). textContent pulled that
    // chrome into the key, which made the panel-key consumers disagree.
    var t = "";
    for (var i = 0; i < h.childNodes.length; i++){
      if (h.childNodes[i].nodeType === 3) t += h.childNodes[i].nodeValue;
    }
    if (!t) t = h.textContent || "";
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

// ── Increment 2a — wolfpack.quest links woven into the local dashboard ──────
// 1. Delegated click on any .name cell opens /character/<Name> in a new tab.
//    Names are filtered to "looks like a real character" (capitalised single
//    word) so we do not turn placeholders like "(unknown)" or "Pets" into
//    links. NPC / pet entries fall through unchanged.
// 2. The uploader (first watched-logs character) gets quicklinks added to the
//    top bar — "/me", "/pvp/<You>", and "/character/<You>" — so the local
//    dashboard becomes the launchpad for that user's own pages.
(function(){
  function looksLikeCharacter(name){
    if (!name) return false;
    name = name.trim();
    // Real EQ player names are single-word, capitalised, alpha. NPCs are
    // usually multi-word ("an air elemental"); pets/aliases often contain
    // non-alpha or are bracketed.
    if (!/^[A-Z][a-zA-Z]{2,}$/.test(name)) return false;
    if (name === "Pets" || name === "Unknown" || name === "You") return false;
    return true;
  }
  function openCharacter(name){
    var u = "https://wolfpack.quest/character/" + encodeURIComponent(name);
    window.open(u, "_blank", "noopener,noreferrer");
  }
  document.addEventListener("click", function(e){
    var t = e.target;
    if (!t) return;
    // Walk up to a .name node (covers nested spans like the threat-meter).
    var hit = t.closest ? t.closest(".name") : null;
    if (!hit) return;
    // Skip the gear menu and quicklinks bar.
    if (hit.closest(".wp-menu") || hit.closest(".wp-quicklinks")) return;
    var text = (hit.textContent || "").trim();
    // Strip any inline " ⚠ aggro risk" / class-tag suffixes by taking the
    // first token bounded by space / "(" / "[". Built via indexOf instead of
    // a regex to avoid backtick-literal escape issues (the dashboard escape
    // hazard documented in CLAUDE.md).
    var name = text;
    var cuts = [" ", "(", "["];
    for (var i = 0; i < cuts.length; i++) {
      var ix = name.indexOf(cuts[i]);
      if (ix >= 0) name = name.substring(0, ix);
    }
    if (!looksLikeCharacter(name)) return;
    e.preventDefault();
    e.stopPropagation();
    openCharacter(name);
  }, true);

  // Populate uploader-specific quicklinks once watchedLogs has loaded. The
  // dashboard refresh writes the header with parser version + character; the
  // shorter path is to poll /api/state for the first watched character.
  function refreshUploaderLinks(){
    var slot = document.getElementById("wpUploaderLinks");
    if (!slot) return;
    fetch("/api/state").then(function(r){ return r.json(); }).then(function(s){
      var wls = (s && s.watchedLogs) || [];
      var me = null;
      for (var i = 0; i < wls.length; i++){
        var c = (wls[i] && wls[i].character) || "";
        if (looksLikeCharacter(c)) { me = c; break; }
      }
      if (!me) { morphInto(slot, ""); return; }
      morphInto(slot,
        " · <a href='https://wolfpack.quest/character/" + encodeURIComponent(me) +
        "' target='_blank' rel='noreferrer' title='Your character page on wolfpack.quest'>/character/" + me + "</a>" +
        " <a href='https://wolfpack.quest/pvp/" + encodeURIComponent(me) +
        "' target='_blank' rel='noreferrer' title='Your PvP record'>/pvp/" + me + "</a>");
    }).catch(function(){});
  }
  refreshUploaderLinks();
  setInterval(refreshUploaderLinks, 30000);
})();

// ── Increment 2d — "send this panel to its own overlay window" (Mimic only)
// AND overlay-mode rendering (when loaded with ?overlay=<panelKey> in URL).
(function(){
  function panelKeyForCard(card){
    var h = card.querySelector("h2");
    if (!h) return "";
    // Read ONLY the h2's own TEXT nodes — skip injected chrome (drag handle
    // ✥, 🪟 overlay button, 🛰/🌐 source toggle), which are ELEMENT children.
    // Reading h2.textContent included that chrome ("damage done this session
    // 🪟 overlay🛰local🌐server"), so the overlay matcher never matched the
    // URL key and the panel overlay rendered blank. Same function feeds the
    // button's data-panel-key, so both ends stay consistent.
    var t = "";
    for (var i = 0; i < h.childNodes.length; i++){
      if (h.childNodes[i].nodeType === 3) t += h.childNodes[i].nodeValue;
    }
    if (!t) t = h.textContent || "";
    t = t.split("(")[0].split("—")[0].split("·")[0];
    return t.trim().toLowerCase();
  }
  // Are we hosted by Mimic? The preload exposes window.mimic.createPanelOverlay
  // only on Mimic; in a normal browser this stays undefined and no buttons
  // appear (silently degrades for Parser.bat users).
  function mimicHosts(){
    return !!(window.mimic && typeof window.mimic.createPanelOverlay === "function");
  }
  // Persisted hidden-panel set — SAME localStorage key the panel popover uses
  // ("wpHiddenPanels"), so the direct ✕ button and the popover checkboxes stay
  // in sync. Both key off the clean text-node panel key.
  var HIDE_LS_KEY = "wpHiddenPanels";
  function _loadHiddenSet(){
    try { return new Set(JSON.parse(localStorage.getItem(HIDE_LS_KEY) || "[]")); }
    catch (e) { return new Set(); }
  }
  function _saveHiddenSet(set){
    try { localStorage.setItem(HIDE_LS_KEY, JSON.stringify(Array.prototype.slice.call(set))); } catch (e) {}
  }
  function decorateButtons(){
    if (!mimicHosts()) return;
    var cards = document.querySelectorAll(".section .card");
    for (var i = 0; i < cards.length; i++){
      var card = cards[i];
      var h = card.querySelector("h2");
      if (!h) continue;
      if (h.querySelector(".wp-overlay-btn")) continue; // already decorated
      var key = panelKeyForCard(card);
      if (!key) continue;
      // ✕ hide button — sits to the LEFT of the overlay button (both float
      // right, so append the hide first → it ends up on the far right next to
      // overlay). One click hides the card; un-hide from ⚙ Panels → Show all.
      var hideBtn = document.createElement("button");
      hideBtn.className = "wp-overlay-btn wp-hide-btn";
      hideBtn.setAttribute("data-panel-key", key);
      hideBtn.title = "Hide this panel (re-show from the ⚙ Panels menu)";
      hideBtn.textContent = "✕";
      h.appendChild(hideBtn);
      var btn = document.createElement("button");
      btn.className = "wp-overlay-btn";
      btn.setAttribute("data-panel-key", key);
      btn.title = "Open this panel in its own always-on-top overlay window";
      btn.textContent = "🪟 overlay";
      h.appendChild(btn);
    }
  }
  document.addEventListener("click", function(e){
    var t = e.target;
    if (!t || !t.classList) return;
    // ✕ hide button — check FIRST since it shares the wp-overlay-btn class.
    if (t.classList.contains("wp-hide-btn")){
      e.preventDefault(); e.stopPropagation();
      var hk = t.getAttribute("data-panel-key");
      var set = _loadHiddenSet();
      set.add(hk);
      _saveHiddenSet(set);
      var card = t.closest ? t.closest(".card") : null;
      if (card) card.classList.add("wp-hidden");
      return;
    }
    if (!t.classList.contains("wp-overlay-btn")) return;
    e.preventDefault();
    e.stopPropagation();
    var pk = t.getAttribute("data-panel-key");
    try { if (window.mimic) window.mimic.createPanelOverlay(pk); } catch (err) {}
  }, true);
  var obs = new MutationObserver(decorateButtons);
  ["dash","tanks","healers","deeps","pets","info","optin"].forEach(function(id){
    var el = document.getElementById(id);
    if (el) obs.observe(el, { childList: true, subtree: true });
  });
  decorateButtons();

  // OVERLAY MODE — when loaded with ?overlay=<key>, mark only the matching
  // panel as the target and let CSS hide everything else. Re-applies after
  // each section re-render via the same observer above (decorateButtons
  // doesn't tag the overlay target; this does).
  var overlayKey = null;
  try {
    var qs = (window.location.search || "");
    var m = qs.match(/[?&]overlay=([^&]+)/);
    if (m) overlayKey = decodeURIComponent(m[1]).toLowerCase();
  } catch (err) {}
  if (overlayKey){
    document.body.classList.add("wp-overlay-mode");
    // Strip a leading emoji/symbol run so an ASCII key opens an emoji-titled
    // panel. The 🪟 buttons pass the exact key (emoji included) → exact match;
    // the tray's Overlays submenu passes a clean key ("healing","threat detail")
    // → this fallback resolves it to "💚 healing" / "⚔️ threat detail" without
    // anyone having to reproduce the exact emoji bytes. No-op for ASCII titles.
    function _pkStrip(s){ return String(s == null ? "" : s).replace(/^[^a-z0-9]+/i, "").trim(); }
    var overlayKeyStripped = _pkStrip(overlayKey);
    function applyOverlayTarget(){
      var cards = document.querySelectorAll(".section .card");
      var matched = false;
      for (var i = 0; i < cards.length; i++){
        var c = cards[i];
        var k = panelKeyForCard(c);
        if (k === overlayKey || _pkStrip(k) === overlayKeyStripped){ c.classList.add("wp-overlay-target"); matched = true; }
        else c.classList.remove("wp-overlay-target");
      }
      // If the panel hasn't rendered yet (data not received), the overlay
      // shows nothing — by design. Once render lands, the observer fires
      // and the target lights up.
      return matched;
    }
    var obs2 = new MutationObserver(applyOverlayTarget);
    ["dash","tanks","healers","deeps","pets","info","optin"].forEach(function(id){
      var el = document.getElementById(id);
      if (el) obs2.observe(el, { childList: true, subtree: true });
    });
    applyOverlayTarget();
  }
})();

// ── Increment 2f — local vs server source toggle per panel ──────────────────
// Each panel whose <h2> matches a known key (damage / pvp / parses) gets a
// "🛰 local | 🌐 server" toggle in its header. Server mode fetches from the
// agent's GET /api/server/<key>?character=<uploader> passthrough and renders
// a small JSON overlay below the local content — so members can SEE the
// difference between live (this-session) and aggregated (wolfpack.quest)
// without leaving the dashboard. Selection persists per panel in localStorage.
(function(){
  // Map dashboard panel header (lowercased <h2> prefix) → server-panel key.
  // Local stays default; toggle adds the server view on top.
  var PANEL_TO_SERVER_KEY = {
    "damage done this session": "damage",
    "top damage this session":  "damage",
    "pvp":                       "pvp",
    "recent parses":             "parses",
    "live threat":               "threat",
    "threat detail":             "threat",
  };
  var LS_KEY = "wpPanelSource";
  function loadModes(){
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function saveModes(o){
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function panelKey(card){
    var h = card.querySelector("h2");
    if (!h) return "";
    // Read ONLY the h2's own TEXT nodes — skip injected chrome (drag handle,
    // 🪟 overlay button, ✕ hide button, source toggle). textContent pulled that
    // chrome into the key, which made the panel-key consumers disagree.
    var t = "";
    for (var i = 0; i < h.childNodes.length; i++){
      if (h.childNodes[i].nodeType === 3) t += h.childNodes[i].nodeValue;
    }
    if (!t) t = h.textContent || "";
    t = t.split("(")[0].split("—")[0].split("·")[0];
    return t.trim().toLowerCase();
  }
  function fmt(n){ n = Number(n)||0; if (n>=1e6) return (n/1e6).toFixed(1)+"M"; if (n>=1e3) return (n/1e3).toFixed(1)+"k"; return String(n); }
  function getUploader(){
    return new Promise(function(resolve){
      fetch("/api/state").then(function(r){return r.json();}).then(function(s){
        var wls = (s && s.watchedLogs) || [];
        for (var i=0;i<wls.length;i++){
          var c = wls[i] && wls[i].character;
          if (c && /^[A-Z][a-zA-Z]{2,}$/.test(c)) return resolve(c);
        }
        resolve(null);
      }).catch(function(){ resolve(null); });
    });
  }
  function renderServer(card, serverKey, data){
    var existing = card.querySelector(".wp-server-overlay");
    if (existing) existing.remove();
    var box = document.createElement("div");
    box.className = "wp-server-overlay";
    var html = "<h5>🌐 wolfpack.quest — " + (data && data.scope || "server view") + "</h5>";
    if (!data || data.error){
      html += "<div class=meta>" + (data && data.error || "fetch failed") + "</div>";
      box.innerHTML = html;
      card.appendChild(box);
      return;
    }
    html += "<div class=meta>updated " + (data.updated_at ? new Date(data.updated_at).toLocaleTimeString() : "") + "</div>";
    if (serverKey === "damage" && data.rows){
      html += "<table><tr><th>#</th><th>Character</th><th class=num>Total</th><th class=num>Peak DPS</th><th class=num>Enc</th></tr>";
      data.rows.slice(0,12).forEach(function(r, i){
        html += "<tr><td class=dim>" + (i+1) + "</td><td class=name>" + r.character + "</td><td class=num>" + fmt(r.totalDamage) + "</td><td class=num>" + fmt(r.peakDps) + "</td><td class=num>" + r.encounters + "</td></tr>";
      });
      html += "</table>";
    } else if (serverKey === "pvp"){
      html += "<div>Kills <b>" + (data.total_kills||0) + "</b> · Unique victims <b>" + (data.unique_victims||0) + "</b> · Deaths <b>" + (data.total_deaths||0) + "</b></div>";
    } else if (serverKey === "threat"){
      html += "<div>Snapshots seen <b>" + (data.snapshots||0) + "</b> · Topped threat <b>" + (data.times_topped_threat||0) + "</b> · Top-3 <b>" + (data.times_top3||0) + "</b></div>";
      var recent = data.recent || [];
      if (recent.length > 0) {
        html += "<table><tr><th>Boss</th><th>When</th><th class=num>Rank</th></tr>";
        recent.forEach(function(r){
          var boss = (r.boss || "?").replace(/_/g, " ");
          var when = r.snapshot_at ? new Date(r.snapshot_at).toLocaleString() : "";
          html += "<tr><td class=name>" + boss + "</td><td class=dim>" + when + "</td><td class=num>" + r.rank + " of " + r.of + "</td></tr>";
        });
        html += "</table>";
      }
    } else if (serverKey === "parses" && data.rows){
      html += "<table><tr><th>Boss</th><th>When</th><th class=num>Total</th><th class=num>DPS</th></tr>";
      data.rows.slice(0,10).forEach(function(r){
        var boss = (r.boss || "?").replace(/_/g, " ");
        var when = r.started_at ? new Date(r.started_at).toLocaleString() : "";
        html += "<tr><td class=name>" + boss + "</td><td class=dim>" + when + "</td><td class=num>" + fmt(r.total_damage) + "</td><td class=num>" + fmt(r.dps) + "</td></tr>";
      });
      html += "</table>";
    }
    box.innerHTML = html;
    card.appendChild(box);
  }
  function fetchServer(card, serverKey){
    var existing = card.querySelector(".wp-server-overlay");
    if (existing) { existing.innerHTML = "<div class=meta>loading…</div>"; }
    else { var box=document.createElement("div"); box.className="wp-server-overlay"; box.innerHTML="<div class=meta>loading…</div>"; card.appendChild(box); }
    getUploader().then(function(me){
      var qs = me ? ("?character=" + encodeURIComponent(me)) : "";
      return fetch("/api/server/" + serverKey + qs).then(function(r){ return r.json().then(function(j){ return { ok:r.ok, body:j }; }); });
    }).then(function(out){
      renderServer(card, serverKey, out && out.body);
    }).catch(function(){
      renderServer(card, serverKey, { error: "network error" });
    });
  }
  function clearServer(card){
    var existing = card.querySelector(".wp-server-overlay");
    if (existing) existing.remove();
  }
  function decorateOne(card, key, serverKey){
    // Per-card closure — avoids the for-var loop trap so every button has
    // its own card / key bound.
    var h = card.querySelector("h2");
    if (!h) return;
    var modes = loadModes();
    if (h.querySelector(".wp-source-toggle")) {
      if (modes[key] === "server" && !card.querySelector(".wp-server-overlay")) fetchServer(card, serverKey);
      return;
    }
    var wrap = document.createElement("span");
    wrap.className = "wp-source-toggle";
    var localBtn  = document.createElement("button"); localBtn.textContent  = "🛰 local";   localBtn.title  = "What the agent is observing live (this session)";
    var serverBtn = document.createElement("button"); serverBtn.textContent = "🌐 server"; serverBtn.title = "wolfpack.quest aggregates (Supabase, last 30d / lifetime)";
    var mode = modes[key] === "server" ? "server" : "local";
    if (mode === "local")  localBtn.classList.add("active");
    if (mode === "server") serverBtn.classList.add("active");
    localBtn.addEventListener("click", function(){
      var m = loadModes(); m[key] = "local"; saveModes(m);
      localBtn.classList.add("active"); serverBtn.classList.remove("active");
      clearServer(card);
    });
    serverBtn.addEventListener("click", function(){
      var m = loadModes(); m[key] = "server"; saveModes(m);
      serverBtn.classList.add("active"); localBtn.classList.remove("active");
      fetchServer(card, serverKey);
    });
    wrap.appendChild(localBtn);
    wrap.appendChild(serverBtn);
    h.appendChild(wrap);
    if (mode === "server") fetchServer(card, serverKey);
  }
  function decorate(){
    var cards = document.querySelectorAll(".section .card");
    for (var i=0;i<cards.length;i++){
      var card = cards[i];
      var key = panelKey(card);
      var serverKey = PANEL_TO_SERVER_KEY[key];
      if (!serverKey) continue;
      decorateOne(card, key, serverKey);
    }
  }
  var obs = new MutationObserver(decorate);
  ["dash","tanks","healers","deeps","pets","info","optin"].forEach(function(id){
    var el = document.getElementById(id);
    if (el) obs.observe(el, { childList: true, subtree: true });
  });
  decorate();
})();

// ── Increment 3 — Engaged-mob Loot + Previous Bids panels ───────────────────
// Two new cards prepended to the Dashboard section that watch the agent's
// currentEncounterThreat.bossName. When that changes (i.e. a new pull
// starts), we fetch the boss's drop table from /api/server/loot and the
// previous award history for those items from /api/server/bids, then
// render compact tables.
//
// All server fetches are gated on a token being set — if the local-only
// install has no token, the agent's /api/server passthrough returns 503
// and we render a small "connect to see loot" note instead.
(function(){
  function makeCard(id, title){
    var c = document.createElement("div");
    c.id = id;
    c.className = "card";
    c.style.display = "none";
    c.innerHTML = "<h2>" + title + "</h2><div class=card-body><div class=dim>waiting for combat…</div></div>";
    return c;
  }
  var lootCard = makeCard("wpLootCard", "💰 Engaged-mob loot");
  var bidsCard = makeCard("wpBidsCard", "📜 Previous bids");
  function ensureCards(){
    var dash = document.getElementById("dash");
    if (!dash) return;
    if (!document.getElementById("wpLootCard")) {
      // Insert as first children of the first .grid in #dash (or append to dash).
      var firstGrid = dash.querySelector(".grid");
      var host = firstGrid || dash;
      host.insertBefore(bidsCard, host.firstChild);
      host.insertBefore(lootCard, host.firstChild);
    }
  }
  var lastBoss = null;
  var lastItemIds = null;
  function fmtPct(n){ if (n == null) return ""; var p = Number(n)*100; if (p < 0.01) return p.toFixed(3) + "%"; if (p < 1) return p.toFixed(2) + "%"; return p.toFixed(1) + "%"; }
  function fmtDkp(n){ n = Number(n)||0; return n.toLocaleString(); }
  function fmtAgo(iso){
    if (!iso) return "?";
    var t = new Date(iso).getTime(); if (!t) return "?";
    var s = Math.max(0, Math.floor((Date.now() - t)/1000));
    if (s < 60) return s + "s ago";
    if (s < 3600) return Math.floor(s/60) + "m ago";
    if (s < 86400) return Math.floor(s/3600) + "h ago";
    return Math.floor(s/86400) + "d ago";
  }
  function renderLoot(boss, data){
    var body = lootCard.querySelector(".card-body");
    if (!body) return;
    if (!data || data.error){
      body.innerHTML = "<div class=dim>" + ((data && data.error) ? data.error : "no data") + "</div>";
      return;
    }
    var rows = data.rows || [];
    if (rows.length === 0){
      body.innerHTML = "<div class=dim>no drop data for <b>" + boss + "</b> — not in eqemu_npc_drops view</div>";
      return;
    }
    var html = "<div class=dim style=margin-bottom:6px>Boss <b>" + boss + "</b> · " + rows.length + " possible drops</div>";
    html += "<table><tr><th>Item</th><th class=num>Chance</th></tr>";
    rows.forEach(function(r){
      var name = (r.item_name || "?").replace(/_/g, " ");
      var lore = r.lore_flag ? " <span class=tag>LORE</span>" : "";
      html += "<tr><td class=name>" + name + lore + "</td><td class=num>" + fmtPct(r.effective_chance) + "</td></tr>";
    });
    html += "</table>";
    morphInto(body, html);
  }
  function renderBids(data){
    var body = bidsCard.querySelector(".card-body");
    if (!body) return;
    if (!data || data.error){
      body.innerHTML = "<div class=dim>" + ((data && data.error) ? data.error : "no data") + "</div>";
      return;
    }
    var items = data.items || [];
    if (items.length === 0){
      body.innerHTML = "<div class=dim>no previous awards for these items</div>";
      return;
    }
    var html = "";
    items.forEach(function(it){
      var awards = it.awards || [];
      if (awards.length === 0) return;
      var name = (awards[0].item_name || "?").replace(/_/g, " ");
      html += "<div class=wp-bid-block><div class=name>" + name + "</div>";
      html += "<table>";
      awards.forEach(function(a){
        html += "<tr><td class=name>" + (a.winner || "?") + "</td><td class=num>" + fmtDkp(a.dkp_spent) + " DKP</td><td class=dim>" + fmtAgo(a.awarded_at) + "</td></tr>";
      });
      html += "</table></div>";
    });
    morphInto(body, html);
  }
  function refresh(){
    ensureCards();
    fetch("/api/state").then(function(r){ return r.json(); }).then(function(s){
      var et = s && s.currentEncounterThreat;
      var boss = et && et.bossName;
      // Show/hide cards based on whether we know a boss.
      lootCard.style.display = boss ? "block" : "none";
      bidsCard.style.display = boss ? "block" : "none";
      if (!boss) return;
      if (boss === lastBoss) return; // unchanged
      lastBoss = boss;
      // Loot fetch
      fetch("/api/server/loot?boss=" + encodeURIComponent(boss)).then(function(r){
        return r.json().then(function(j){ return { ok: r.ok, body: j }; });
      }).then(function(out){
        renderLoot(boss, out.ok ? out.body : { error: (out.body && out.body.error) || "fetch failed" });
        // Chain into bids if we got items
        if (out.ok && out.body && out.body.rows) {
          var ids = out.body.rows.map(function(r){ return r.item_id; }).filter(Boolean);
          var key = ids.join(",");
          if (key && key !== lastItemIds) {
            lastItemIds = key;
            fetch("/api/server/bids?items=" + encodeURIComponent(key)).then(function(r){
              return r.json().then(function(j){ return { ok: r.ok, body: j }; });
            }).then(function(bout){
              renderBids(bout.ok ? bout.body : { error: (bout.body && bout.body.error) || "fetch failed" });
            }).catch(function(){ renderBids({ error: "network error" }); });
          }
        }
      }).catch(function(){ renderLoot(boss, { error: "network error" }); });
    }).catch(function(){});
  }
  refresh();
  setInterval(refresh, 5000);
})();

// ── Increments 2b + 2e — drag-to-reorder + persisted home order ─────────────
// Pure HTML5 drag-and-drop on each .card inside the Dashboard section. A grip
// (✥) is prepended to each <h2>; dragging reorders cards within the section
// and the resulting order is persisted to localStorage keyed by resolution
// signature (matches the Mimic overlay rule — different monitor layout
// resets to default).
//
// Scoped to #dash only so the dense tabs (Tanks / Healers / DEEPS / Pets /
// Info / Opt-in) keep their server-driven order — those are denser layouts
// where reordering would confuse more than help in this first slice.
(function(){
  var SIG_KEY   = "wpDashOrderSig";
  var ORDER_KEY = "wpDashOrder";
  function sig(){
    return (window.screen ? (window.screen.width + "x" + window.screen.height) : "?");
  }
  function loadOrder(){
    try {
      if (localStorage.getItem(SIG_KEY) !== sig()) return null;
      return JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
    } catch (e) { return null; }
  }
  function saveOrder(arr){
    try { localStorage.setItem(SIG_KEY, sig()); localStorage.setItem(ORDER_KEY, JSON.stringify(arr)); } catch (e) {}
  }
  function panelKey(card){
    var h = card.querySelector("h2");
    if (!h) return "";
    // Read ONLY the h2's own TEXT nodes — skip injected chrome (drag handle,
    // 🪟 overlay button, ✕ hide button, source toggle). textContent pulled that
    // chrome into the key, which made the panel-key consumers disagree.
    var t = "";
    for (var i = 0; i < h.childNodes.length; i++){
      if (h.childNodes[i].nodeType === 3) t += h.childNodes[i].nodeValue;
    }
    if (!t) t = h.textContent || "";
    t = t.split("(")[0].split("—")[0].split("·")[0];
    return t.trim().toLowerCase();
  }
  function applyOrder(host){
    var saved = loadOrder();
    if (!saved || !Array.isArray(saved)) return;
    // Map key → card
    var byKey = {};
    var cards = Array.prototype.slice.call(host.querySelectorAll(":scope > .card, :scope > .grid > .card"));
    cards.forEach(function(c){ var k = panelKey(c); if (k) byKey[k] = c; });
    // Walk saved order; reposition cards that exist now.
    saved.forEach(function(k){
      var c = byKey[k];
      if (!c) return;
      // Append to host's grid if present (keeps the .grid container intact),
      // otherwise to host directly.
      var grid = c.closest(".grid") || host;
      grid.appendChild(c);
    });
  }
  function decorateCard(card){
    var h = card.querySelector("h2");
    if (!h || h.querySelector(".wp-drag-handle")) return;
    var grip = document.createElement("span");
    grip.className = "wp-drag-handle";
    grip.textContent = "✥";
    grip.title = "Drag to reorder (drop where you want this panel)";
    grip.setAttribute("draggable", "true");
    h.insertBefore(grip, h.firstChild);
    // Drag origin
    grip.addEventListener("dragstart", function(e){
      try { e.dataTransfer.setData("text/plain", panelKey(card)); e.dataTransfer.effectAllowed = "move"; } catch (err) {}
      card.classList.add("wp-dragging");
    });
    grip.addEventListener("dragend", function(){
      card.classList.remove("wp-dragging");
      document.querySelectorAll(".wp-drop-target").forEach(function(el){ el.classList.remove("wp-drop-target"); });
    });
    // Drag target
    card.addEventListener("dragover", function(e){
      if (!document.querySelector(".wp-dragging")) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (err) {}
      card.classList.add("wp-drop-target");
    });
    card.addEventListener("dragleave", function(){ card.classList.remove("wp-drop-target"); });
    card.addEventListener("drop", function(e){
      e.preventDefault();
      card.classList.remove("wp-drop-target");
      var moving = document.querySelector(".wp-dragging");
      if (!moving || moving === card) return;
      // Insert moving BEFORE the drop target.
      card.parentNode.insertBefore(moving, card);
      // Persist new order — collect every .card under #dash (incl grids).
      var dash = document.getElementById("dash"); if (!dash) return;
      var allCards = Array.prototype.slice.call(dash.querySelectorAll(".card"));
      var order = allCards.map(panelKey).filter(Boolean);
      saveOrder(order);
    });
  }
  var obs = null;
  function decorate(){
    var dash = document.getElementById("dash");
    if (!dash) return;
    // CRITICAL: pause the observer while WE mutate #dash. decorateCard inserts a
    // drag grip and applyOrder re-appends saved cards — both are childList
    // mutations. The observer's callback IS decorate, so applyOrder's
    // unconditional appendChild made an INFINITE loop (appendChild → observer →
    // decorate → appendChild → …) the instant a saved reorder existed. That
    // pegged the renderer main thread → "window unresponsive" → blank dashboard,
    // and crashed the page on drop (which writes a saved order). Disconnect
    // around our own writes; reconnect after so genuine refresh() rewrites still
    // re-decorate.
    if (obs) obs.disconnect();
    try {
      Array.prototype.slice.call(dash.querySelectorAll(".card")).forEach(decorateCard);
      applyOrder(dash);
    } finally {
      if (obs) obs.observe(dash, { childList: true, subtree: true });
    }
  }
  obs = new MutationObserver(decorate);
  decorate();
})();

// ── Increment 2c — drag suggestions ─────────────────────────────────────────
// When the gear panel opens, we surface "panels that mention you" as priority
// pins so members see relevance fast. Per the owner's flag: Parses + Threat
// outrank everything else since they're the data most members care about and
// (until 2g shipped) weren't in /me. Suggestions render inside the existing
// gear menu's existing slot — additive, no layout move.
(function(){
  // Keywords whose presence in the panel body bumps relevance. Higher number
  // means stronger weight.
  var PRIORITY_PANELS = {
    "recent parses":  10,
    "live threat":    10,
    "threat detail":   9,
    "damage done this session": 7,
    "top damage this session":  7,
    "incoming damage":          5,
    "deaths this session":      5,
  };
  function getMe(){
    return new Promise(function(resolve){
      fetch("/api/state").then(function(r){return r.json();}).then(function(s){
        var wls = (s && s.watchedLogs) || [];
        for (var i=0;i<wls.length;i++){
          var c = wls[i] && wls[i].character;
          if (c && /^[A-Z][a-zA-Z]{2,}$/.test(c)) return resolve(c);
        }
        resolve(null);
      }).catch(function(){ resolve(null); });
    });
  }
  function panelKeyFor(card){
    var h = card.querySelector("h2");
    var t = h ? (h.textContent || "") : "";
    t = t.split("(")[0].split("—")[0].split("·")[0];
    return t.trim().toLowerCase();
  }
  function scoreCard(card, me){
    var key = panelKeyFor(card);
    var score = PRIORITY_PANELS[key] || 0;
    if (me) {
      // Bump if the card's text contains the uploader's name — that's the
      // "data points that have their character in them" signal.
      var text = (card.textContent || "");
      if (text.indexOf(me) !== -1) score += 5;
    }
    return { key: key, score: score, label: (card.querySelector("h2") || {}).textContent || key };
  }
  function injectIntoMenu(){
    var menu = document.getElementById("wpPanelMenu");
    if (!menu || menu.style.display !== "block") return;
    if (menu.querySelector(".wp-suggest")) return; // already injected this open
    getMe().then(function(me){
      var dash = document.getElementById("dash");
      if (!dash) return;
      var cards = Array.prototype.slice.call(dash.querySelectorAll(".card"));
      var ranked = cards.map(function(c){ return scoreCard(c, me); }).filter(function(x){ return x.score > 0; });
      ranked.sort(function(a, b){ return b.score - a.score; });
      ranked = ranked.slice(0, 6);
      if (ranked.length === 0) return;
      var box = document.createElement("div");
      box.className = "wp-suggest";
      var html = "<h5>🎯 Suggested for you" + (me ? " (" + me + ")" : "") + "</h5>";
      ranked.forEach(function(r){
        var cls = r.score >= 10 ? "priority" : "";
        var label = (r.label || r.key).replace(/^✥\s*/, "").split("(")[0].split("—")[0].trim();
        html += "<button class='" + cls + "' data-suggest-key='" + r.key + "'>" + label + "</button>";
      });
      box.innerHTML = html;
      // Inject as first child of the menu so suggestions appear above the
      // show/hide list.
      menu.insertBefore(box, menu.firstChild);
      // Wire clicks: scroll the matching card into view + give it a brief flash.
      Array.prototype.slice.call(box.querySelectorAll("button[data-suggest-key]")).forEach(function(btn){
        btn.addEventListener("click", function(){
          var k = btn.getAttribute("data-suggest-key");
          var cards = Array.prototype.slice.call(document.querySelectorAll(".section .card"));
          for (var i=0;i<cards.length;i++){
            if (panelKeyFor(cards[i]) === k){
              cards[i].scrollIntoView({ behavior: "smooth", block: "center" });
              cards[i].classList.add("wp-drop-target");
              setTimeout(function(){ cards[i].classList.remove("wp-drop-target"); }, 1500);
              menu.style.display = "none";
              break;
            }
          }
        });
      });
    });
  }
  // Watch the menu for visibility changes via attribute mutation.
  var menuObs = new MutationObserver(injectIntoMenu);
  var menu = document.getElementById("wpPanelMenu");
  if (menu) menuObs.observe(menu, { attributes: true, attributeFilter: ["style"] });
})();

// ── Charm Pets panel (6-second mob-tick countdowns) ─────────────────────────
// Owner-supplied knowledge: charm checks fire on the mob's OWN 6s tick, and
// a charm break is itself a fresh anchor for that cycle. The agent tracks
// the last-tick anchor per pet; this panel renders a 1Hz countdown showing
// the next mob tick + a flash when one is imminent (<1s).
(function(){
  var TICK_MS = 6000;
  function makeCard(){
    var c = document.createElement("div");
    c.id = "wpCharmCard";
    c.className = "card";
    c.style.display = "none";
    c.innerHTML = "<h2>🪄 Charm Pets <span class=dim style=font-size:11px;text-transform:none;letter-spacing:0> · 6s mob-tick check</span></h2><div class=card-body></div>";
    return c;
  }
  var card = makeCard();
  function ensureCard(){
    if (document.getElementById("wpCharmCard")) return;
    var dash = document.getElementById("dash");
    if (!dash) return;
    var grid = dash.querySelector(".grid");
    var host = grid || dash;
    host.insertBefore(card, host.firstChild);
  }
  function render(pets){
    var body = card.querySelector(".card-body");
    if (!body) return;
    if (!pets || pets.length === 0){
      card.style.display = "none";
      return;
    }
    card.style.display = "block";
    var now = Date.now();
    var html = "<table><tr><th>Pet</th><th>Owner</th><th class=num>Next tick</th><th>State</th></tr>";
    pets.forEach(function(p){
      var since = Math.max(0, now - (p.last_tick_at || now));
      var ticksPassed = Math.floor(since / TICK_MS);
      var nextAt = (p.last_tick_at || now) + (ticksPassed + 1) * TICK_MS;
      var msToNext = Math.max(0, nextAt - now);
      var sec = (msToNext / 1000).toFixed(1);
      var imminent = msToNext < 1000;
      var stateColor = p.is_active ? "var(--green)" : "var(--orange)";
      var stateText  = p.is_active ? (p.last_event === "land" ? "charmed" : "charmed (post-break)") : "broken";
      var petName = (p.pet || "?").replace(/_/g, " ");
      var rowStyle = imminent ? " style=background:rgba(214,153,34,0.18)" : "";
      html += "<tr" + rowStyle + "><td class=pet>" + petName + "</td><td class=name>" + (p.owner || "?") + "</td><td class=num>" + sec + "s</td><td style='color:" + stateColor + "'>" + stateText + "</td></tr>";
    });
    html += "</table>";
    morphInto(body, html);
  }
  var lastPets = [];
  function fetchPets(){
    fetch("/api/state").then(function(r){ return r.json(); }).then(function(s){
      lastPets = (s && s.charmPets) || [];
      ensureCard();
      render(lastPets);
    }).catch(function(){});
  }
  // Render at 1Hz from cache (so the countdown ticks smoothly) + refetch
  // every 3s for state changes.
  setInterval(function(){ render(lastPets); }, 1000);
  setInterval(fetchPets, 3000);
  fetchPets();
})();

// ── 🛡 Damage Shield reflects panel ─────────────────────────────────────────
// Tracks "X was hit by ABILITY for N damage" lines where the target is a
// mob we're currently fighting and there's no attacker (i.e. the damage
// shield on the tank reflected the boss's swing). Per ability we show
// hits / total / per-hit pattern (fixed value → likely Inner Fire family;
// variable → likely Elemental Illusion / clicky / song). All-zero hides.
(function(){
  function makeCard(){
    var c = document.createElement("div");
    c.id = "wpDsCard";
    c.className = "card";
    c.style.display = "none";
    c.innerHTML = "<h2>🛡 Damage Shield reflects <span class=dim style=font-size:11px;text-transform:none;letter-spacing:0> · while boss is hitting the tank</span></h2><div class=card-body></div>";
    return c;
  }
  var card = makeCard();
  function ensure(){
    if (document.getElementById("wpDsCard")) return;
    var dash = document.getElementById("dash"); if (!dash) return;
    var grid = dash.querySelector(".grid"); var host = grid || dash;
    host.insertBefore(card, host.firstChild);
  }
  function fmt(n){ n=Number(n)||0; return n.toLocaleString(); }
  function render(payload){
    var body = card.querySelector(".card-body");
    if (!body) return;
    if (!payload || !payload.abilities || Object.keys(payload.abilities).length === 0){
      card.style.display = "none"; return;
    }
    card.style.display = "block";
    var boss = (payload.bossName || "?").replace(/_/g, " ");
    var rows = Object.entries(payload.abilities).map(function(kv){
      var name = kv[0]; var v = kv[1] || {};
      var avg = v.count > 0 ? Math.round(v.total / v.count) : 0;
      var fixed = (v.min === v.max);
      return { name: name, count: v.count||0, total: v.total||0, min: v.min||0, max: v.max||0, avg: avg, fixed: fixed };
    }).sort(function(a,b){ return b.total - a.total; });
    var html = "<div class=dim style=margin-bottom:6px>vs <b>" + boss + "</b> — " + rows.length + " ability/-ies</div>";
    html += "<table><tr><th>Ability</th><th class=num>Hits</th><th class=num>Total</th><th class=num>Per hit</th><th>Type</th></tr>";
    rows.forEach(function(r){
      var perHit = r.fixed ? fmt(r.avg) : (fmt(r.min) + "–" + fmt(r.max) + " (avg " + fmt(r.avg) + ")");
      var typeLabel = r.fixed ? "<span style='color:var(--green)'>fixed</span>" : "<span style='color:var(--orange)'>variable (song/clicky)</span>";
      html += "<tr><td class=name>" + r.name + "</td><td class=num>" + r.count + "</td><td class=num>" + fmt(r.total) + "</td><td class=num>" + perHit + "</td><td style=font-size:11px>" + typeLabel + "</td></tr>";
    });
    html += "</table>";
    morphInto(body, html);
  }
  function refresh(){
    fetch("/api/state").then(function(r){ return r.json(); }).then(function(s){
      ensure();
      render(s && s.currentDsReflects);
    }).catch(function(){});
  }
  refresh();
  setInterval(refresh, 3000);
})();

// ── 💸 Live Bidding panel ──────────────────────────────────────────────────
// Pulls active OpenDKP auctions via /api/server/auctions (bot passthrough),
// renders a list with bid input + Place Bid button per row, and shows the
// caller's currently-placed bids underneath. Wishlisted items get a star.
// The character dropdown is populated from watchedLogs (your uploader +
// any alts whose logs you are tailing — those are the chars you can bid on
// because OpenDKP needs their CharacterId).
(function(){
  var lastChar = null;        // last character used (sticks across refreshes)
  function makeCard(){
    var c = document.createElement("div");
    c.id = "wpBiddingCard";
    c.className = "card";
    c.style.display = "none";
    c.innerHTML = "<h2>💸 Live Bidding <span class=dim style=font-size:11px;text-transform:none;letter-spacing:0> · OpenDKP auctions</span></h2><div class=card-body><div class=dim style=padding:6px>loading…</div></div>";
    return c;
  }
  var card = makeCard();
  function ensure(){
    if (document.getElementById("wpBiddingCard")) return;
    var dash = document.getElementById("dash"); if (!dash) return;
    var grid = dash.querySelector(".grid"); var host = grid || dash;
    host.insertBefore(card, host.firstChild);
  }
  function fmt(n){ n=Number(n); if(!isFinite(n)) return "—"; return n.toLocaleString(); }
  function looksLikeCharacter(name){
    if (!name) return false;
    return /^[A-Z][a-z]+$/.test(String(name).trim());
  }
  function pickDefaultChar(wls){
    if (lastChar) return lastChar;
    for (var i = 0; i < (wls || []).length; i++){
      var c = (wls[i] && wls[i].character) || "";
      if (looksLikeCharacter(c)) return c;
    }
    return null;
  }
  function renderEmpty(label){
    var body = card.querySelector(".card-body");
    if (!body) return;
    body.innerHTML = "<div class=dim style=padding:6px>" + label + "</div>";
  }
  function endsInLabel(ts){
    if (!ts) return "";
    var t = Date.parse(ts);
    if (!isFinite(t)) return "";
    var ms = t - Date.now();
    if (ms <= 0) return "<span style=color:var(--orange)>ended</span>";
    var s = Math.round(ms / 1000);
    if (s < 60) return "ends in " + s + "s";
    var m = Math.floor(s / 60);
    return "ends in " + m + "m " + (s % 60) + "s";
  }
  function placeBid(auctionId, character, value, btn){
    var body = JSON.stringify({ character: character, auction_id: auctionId, value: value });
    if (btn) { btn.disabled = true; btn.textContent = "…"; }
    fetch("/api/server/place-bid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body,
    }).then(function(r){ return r.json().then(function(j){ return { ok: r.ok, body: j }; }); })
      .then(function(out){
        if (btn) {
          btn.disabled = false;
          btn.textContent = out.ok ? "✓ bid" : "✗";
          btn.title = out.ok ? "bid placed" : (out.body && out.body.error) || "failed";
          setTimeout(function(){ if (btn) btn.textContent = "Bid"; btn.title = ""; }, 2500);
        }
        if (out.ok) fetchAll();
      })
      .catch(function(){ if (btn) { btn.disabled = false; btn.textContent = "✗"; } });
  }
  function render(state){
    var body = card.querySelector(".card-body");
    if (!body) return;
    var wls = (state && state.watchedLogs) || [];
    var chars = [];
    for (var i = 0; i < wls.length; i++){
      var c = (wls[i] && wls[i].character) || "";
      if (looksLikeCharacter(c)) chars.push(c);
    }
    if (chars.length === 0){
      card.style.display = "none";
      return;
    }
    var current = pickDefaultChar(wls);
    if (!current) { card.style.display = "none"; return; }
    var auctions = (window.__wpAuctions && window.__wpAuctions.auctions) || [];
    var myBids   = (window.__wpMyBids   && window.__wpMyBids.bids)        || [];
    if (auctions.length === 0 && myBids.length === 0){
      // Hide entirely when nothing is up for bid AND no live bids — keeps
      // the dashboard quiet outside of loot calls.
      card.style.display = "none";
      return;
    }
    card.style.display = "block";
    var html = "";
    html += "<div style='display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:12px'>";
    html += "<span class=dim>bidding as</span>";
    html += "<select id=wpBidChar style='background:#0e1116;color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 6px;font-family:inherit'>";
    for (var j = 0; j < chars.length; j++){
      var sel = (chars[j] === current) ? " selected" : "";
      html += "<option value='" + chars[j] + "'" + sel + ">" + chars[j] + "</option>";
    }
    html += "</select>";
    html += "</div>";
    if (auctions.length === 0){
      html += "<div class=dim style='padding:4px 0 8px'>no auctions open right now</div>";
    } else {
      html += "<table><tr><th>Item</th><th class=num>Top</th><th>Ends</th><th>Bid</th></tr>";
      for (var k = 0; k < auctions.length; k++){
        var a = auctions[k];
        var star = a.wishlisted ? " <span title='on your wishlist' style=color:var(--gold)>★</span>" : "";
        var top = a.top_bid != null ? fmt(a.top_bid) : "—";
        var ends = endsInLabel(a.ends_at);
        var aid = a.auction_id;
        html += "<tr>";
        html += "<td class=name>" + (a.item_name || "?") + star + "</td>";
        html += "<td class=num>" + top + "</td>";
        html += "<td style=font-size:11px>" + ends + "</td>";
        html += "<td><input id=wpBidVal_" + aid + " type=number min=1 placeholder='dkp' style='width:60px;background:#0e1116;color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-family:inherit'>";
        html += " <button id=wpBidBtn_" + aid + " data-aid='" + aid + "' style='background:#21262d;color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;font-family:inherit'>Bid</button></td>";
        html += "</tr>";
      }
      html += "</table>";
    }
    if (myBids.length > 0){
      html += "<div class=wp-bid-block><div style='font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px'>your bids</div>";
      html += "<table><tr><th>Item</th><th>Character</th><th class=num>Value</th><th class=num>Rank</th></tr>";
      for (var m = 0; m < myBids.length; m++){
        var b = myBids[m];
        html += "<tr><td class=name>" + (b.item_name || "?") + "</td><td class=name>" + (b.character || "?") + "</td><td class=num>" + fmt(b.value) + "</td><td class=num>" + (b.rank || "—") + "</td></tr>";
      }
      html += "</table></div>";
    }
    morphInto(body, html);
    // Wire char dropdown
    var charSel = document.getElementById("wpBidChar");
    if (charSel){
      charSel.addEventListener("change", function(){
        lastChar = charSel.value;
        fetchAll();
      });
    }
    // Wire bid buttons
    var btns = card.querySelectorAll("button[data-aid]");
    for (var n = 0; n < btns.length; n++){
      (function(btn){
        btn.addEventListener("click", function(){
          var aid = btn.getAttribute("data-aid");
          var input = document.getElementById("wpBidVal_" + aid);
          var val = input ? parseInt(input.value, 10) : 0;
          if (!val || val <= 0){ btn.textContent = "?"; setTimeout(function(){ btn.textContent = "Bid"; }, 1500); return; }
          var who = (document.getElementById("wpBidChar") || {}).value || lastChar;
          if (!who) return;
          placeBid(aid, who, val, btn);
        });
      })(btns[n]);
    }
  }
  var lastState = null;
  function fetchState(){
    return fetch("/api/state").then(function(r){ return r.json(); }).then(function(s){
      lastState = s; return s;
    }).catch(function(){ return null; });
  }
  function fetchAll(){
    ensure();
    fetchState().then(function(s){
      if (!s) return;
      var wls = s.watchedLogs || [];
      var who = pickDefaultChar(wls);
      if (!who){ card.style.display = "none"; return; }
      var qs = "?character=" + encodeURIComponent(who);
      Promise.all([
        fetch("/api/server/auctions" + qs).then(function(r){ return r.ok ? r.json() : { auctions: [] }; }).catch(function(){ return { auctions: [] }; }),
        fetch("/api/server/my-bids" + qs).then(function(r){ return r.ok ? r.json() : { bids: [] }; }).catch(function(){ return { bids: [] }; }),
      ]).then(function(both){
        window.__wpAuctions = both[0];
        window.__wpMyBids   = both[1];
        render(s);
      });
    });
  }
  fetchAll();
  setInterval(fetchAll, 5000);
})();

// ── Read-only uploader banner ──────────────────────────────────────────────
// When another Parser/Mimic on this machine owns the upload lock, this
// instance is read-only (it still tails + shows local stats, but does not
// upload). Surface that clearly so it is obvious why nothing is posting.
(function(){
  function ensure(){
    var b = document.getElementById("wpUploaderBanner");
    if (b) return b;
    b = document.createElement("div");
    b.id = "wpUploaderBanner";
    b.style.cssText = "display:none;position:sticky;top:0;z-index:60;background:#3a2a00;color:#f6c365;border-bottom:1px solid #6b5200;padding:6px 12px;font-size:12px;text-align:center";
    document.body.insertBefore(b, document.body.firstChild);
    return b;
  }
  function refresh(){
    fetch("/api/state").then(function(r){ return r.json(); }).then(function(s){
      var u = s && s.uploader;
      var b = ensure();
      if (u && u.active === false){
        var who  = (u.holder && u.holder.client) ? u.holder.client : "another agent";
        var port = (u.holder && u.holder.webPort) ? (" (localhost:" + u.holder.webPort + ")") : "";
        b.textContent = "Read-only mode: " + who + port + " is the active uploader on this machine, so this instance is not uploading (prevents duplicate posts). Local stats below are still live.";
        b.style.display = "block";
      } else {
        b.style.display = "none";
      }
    }).catch(function(){});
  }
  refresh();
  setInterval(refresh, 5000);
})();

// ── ⚡ Triggers editor (mounted once, owned by the Triggers tab) ────────────
// renderTriggers() rewrites the section\\'s read-only blocks on every poll.
// This IIFE owns the EDITOR + list area inside #trigEditorPanel — installed
// the first time the Triggers tab paints, and from then on it controls its
// own DOM (list re-renders triggered manually after add / delete / toggle).
// That preserves form state while the user types a pattern even if the rest
// of the section re-renders. Exposed as window._wpTrigEditor.mount() so
// renderTriggers can call into it from outside the IIFE scope.
(function(){
  var mounted = false;
  var listEl  = null;
  var editorEl = null;
  // Track an in-flight create row so polls don\\'t blow away the user\\'s typing
  // (the form is uncontrolled — we read values on submit).
  function buildEditorHtml() {
    return ''
      + '<div style="margin-top:12px;padding:12px;background:#161b22;border:1px solid var(--border);border-radius:8px">'
      + '  <div style="font-weight:bold;margin-bottom:8px;color:var(--blue)">+ Add personal trigger</div>'
      + '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px">'
      + '    <label>Name<br><input id="trigNewName" type="text" placeholder="e.g. Rampage on me" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"></label>'
      + '    <label>Cooldown (sec)<br><input id="trigNewCooldown" type="number" min="0" max="3600" value="0" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"></label>'
      + '    <label style="grid-column:1/3">Pattern (regex; named groups like (?&lt;target&gt;\\\\w+) become {target} in the alert text)<br>'
      + '      <input id="trigNewPattern" type="text" placeholder="e.g. (?&lt;target&gt;\\\\w+) begins to cast Mass Cancel Magic" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px"></label>'
      + '    <label style="grid-column:1/3">Overlay text<br>'
      + '      <input id="trigNewOverlay" type="text" placeholder="e.g. CANCEL ON {target}!" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"></label>'
      + '    <label>Color<br><select id="trigNewColor" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"><option value="red">red</option><option value="orange">orange</option><option value="gold">gold</option><option value="green">green</option><option value="blue">blue</option><option value="purple">purple</option><option value="white">white</option></select></label>'
      + '    <label>Duration (ms)<br><input id="trigNewDuration" type="number" min="500" max="60000" value="5000" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"></label>'
      + '    <label>Countdown timer (sec, 0 = no timer)<br><input id="trigNewTimerSec" type="number" min="0" max="3600" value="0" placeholder="e.g. 18 for a Cazic Touch refresh" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"></label>'
      + '    <label>Cancel-early phrase (optional)<br><input id="trigNewEndEarly" type="text" placeholder="e.g. {target} has been slain" style="width:100%;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px"></label>'
      + '    <label style="grid-column:1/3">Zeal HP condition (optional — fires off live Zeal gauges, no log line needed; use {target} and {value} in the overlay text)<br>'
      + '      <span style="display:flex;gap:6px;align-items:center">'
      + '        <select id="trigNewZealField" style="flex:2;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"><option value="">— none —</option><option value="target_hp_pct">Target HP %</option><option value="self_hp_pct">Self HP %</option><option value="group_min_hp_pct">Lowest group HP %</option></select>'
      + '        <select id="trigNewZealOp" style="flex:1;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px"><option value="&lt;">&lt;</option><option value="&lt;=">&lt;=</option><option value="&gt;">&gt;</option><option value="&gt;=">&gt;=</option></select>'
      + '        <input id="trigNewZealValue" type="number" min="0" max="100" placeholder="%" style="flex:1;background:#0d1117;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:inherit;font-size:12px">'
      + '      </span></label>'
      + '  </div>'
      + '  <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
      + '    <button id="trigAddBtn" type="button" style="background:#1f6feb;color:#fff;border:0;padding:6px 14px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold">Add trigger</button>'
      + '    <button id="trigPreviewBtn" type="button" style="background:#21262d;color:var(--green);border:1px solid var(--border);padding:6px 14px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:12px" title="Fire the overlay with the current form text (no save, no DB)">▶ Preview</button>'
      + '    <button id="trigTestBtn" type="button" style="background:#21262d;color:var(--text);border:1px solid var(--border);padding:6px 14px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:12px">Test pattern…</button>'
      + '    <button id="trigImportBtn" type="button" style="background:#21262d;color:var(--blue);border:1px solid var(--border);padding:6px 14px;border-radius:5px;cursor:pointer;font-family:inherit;font-size:12px" title="Paste a GINA or EQLogParser trigger XML to bulk-import">⬇ Import GINA / EQLP</button>'
      + '    <span id="trigAddMsg" class="dim" style="font-size:11px"></span>'
      + '  </div>'
      + '  <div id="trigTestPanel" style="display:none;margin-top:10px;padding:8px;background:#0d1117;border:1px solid var(--border);border-radius:6px">'
      + '    <div class="dim" style="font-size:11px;margin-bottom:6px">Paste a sample log line. The current pattern above will be tested against it.</div>'
      + '    <input id="trigTestLine" type="text" placeholder="[Mon Apr 14 23:01:02 2025] Aten Ha Ra begins to cast Mass Cancel Magic." style="width:100%;background:#161b22;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;margin-bottom:6px">'
      + '    <button id="trigTestRun" type="button" style="background:#1f6feb;color:#fff;border:0;padding:4px 10px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px">Run test</button>'
      + '    <div id="trigTestResult" class="dim" style="font-size:11px;margin-top:6px"></div>'
      + '  </div>'
      + '  <div id="trigImportPanel" style="display:none;margin-top:10px;padding:8px;background:#0d1117;border:1px solid var(--border);border-radius:6px">'
+ '    <div class="dim" style="font-size:11px;margin-bottom:6px">Import from <b>EQLogParser</b> (.tgf / .tgf.gz — the .gz is read directly, no need to unzip) or <b>GINA</b> (.gtp / XML). Pick a file or paste the text. Every trigger in the file is added; duplicates by name are skipped and existing triggers are preserved. Display, Speak (TTS), countdown timer + the "N seconds before" warning, and capture placeholders ({s1}, {n1}) all carry over.</div>'
      + '    <input id="trigImportFile" type="file" accept=".tgf,.gz,.gtp,.xml,.json,application/gzip,application/json,text/xml" style="display:block;margin-bottom:6px;font-size:11px;color:var(--text)">'
      + '    <textarea id="trigImportXml" placeholder="…or paste the .tgf JSON / SharedTriggers XML here" style="width:100%;height:120px;background:#161b22;color:var(--text);border:1px solid var(--border);padding:4px 6px;border-radius:4px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;margin-bottom:6px"></textarea>'
      + '    <button id="trigImportRun" type="button" style="background:#1f6feb;color:#fff;border:0;padding:4px 10px;border-radius:4px;cursor:pointer;font-family:inherit;font-size:11px">Import pasted text</button>'
      + '    <div id="trigImportResult" class="dim" style="font-size:11px;margin-top:6px"></div>'
      + '  </div>'
      + '</div>';
  }
  async function fetchAndRenderList() {
    if (!listEl) return;
    let payload;
    try {
      const r = await fetch('/api/personal-triggers');
      payload = r.ok ? await r.json() : null;
    } catch (e) { void e; }
    const triggers = payload && payload.triggers ? payload.triggers : [];
    if (triggers.length === 0) {
      listEl.innerHTML = '<div class="dim" style="font-size:12px;padding:6px 0">No personal triggers yet. Use the form below to add one. Patterns support .NET-style named groups: <code style="background:#161b22;border:1px solid var(--border);padding:1px 4px;border-radius:3px">(?&lt;name&gt;...)</code>; reference them in the overlay text as <code style="background:#161b22;border:1px solid var(--border);padding:1px 4px;border-radius:3px">{name}</code>.</div>';
      return;
    }
    var html = '<table style="font-size:12px;width:100%"><tr><th></th><th>Name</th><th>Pattern</th><th>Cooldown</th><th>Text</th><th></th></tr>';
    for (var i = 0; i < triggers.length; i++) {
      var t = triggers[i];
      var actionText = '';
      var actionColor = '';
      if (Array.isArray(t.actions) && t.actions[0]) {
        actionText = String(t.actions[0].text || '').slice(0, 80);
        actionColor = String(t.actions[0].color || 'red');
      }
      html += '<tr data-trig-id="' + esc(t.id || '') + '">'
        + '<td><input type="checkbox" ' + (t.enabled !== false ? 'checked' : '') + ' data-trig-toggle="' + esc(t.id || '') + '"></td>'
        + '<td class="name">' + esc(t.name || '?') + (t.valid === false ? ' <span style="color:var(--red);font-size:10px">(bad pattern)</span>' : '') + '</td>'
        + '<td><code style="font-size:10px;background:#0d1117;border:1px solid var(--border);padding:1px 4px;border-radius:3px">' + esc(String(t.pattern || '').slice(0, 60)) + '</code></td>'
        + '<td class="dim">' + ((t.cooldown_seconds || 0) > 0 ? t.cooldown_seconds + 's' : '—') + '</td>'
        + '<td style="color:' + esc(actionColor) + '">' + esc(actionText) + '</td>'
        + '<td style="white-space:nowrap">'
        + '<button type="button" data-trig-fire="' + esc(t.id || '') + '" style="background:#21262d;color:var(--green);border:1px solid var(--border);cursor:pointer;font-size:11px;padding:2px 8px;border-radius:3px;margin-right:4px" title="Fire this trigger now (local only, no DB)">▶ Test</button>'
        + '<button type="button" data-trig-promote="' + esc(t.id || '') + '" style="background:#21262d;color:var(--blue);border:1px solid var(--border);cursor:pointer;font-size:11px;padding:2px 8px;border-radius:3px;margin-right:4px" title="Open wolfpack.quest/admin/triggers prefilled with this trigger so an officer can promote it to the guild set">↑ Promote</button>'
        + '<button type="button" data-trig-delete="' + esc(t.id || '') + '" style="background:transparent;border:0;color:var(--red);cursor:pointer;font-size:13px" title="Delete">✕</button>'
        + '</td>'
        + '</tr>';
    }
    html += '</table>';
    listEl.innerHTML = html;
    // Wire row controls
    listEl.querySelectorAll('[data-trig-delete]').forEach(function(b){
      b.addEventListener('click', function(){ onDelete(b.getAttribute('data-trig-delete')); });
    });
    listEl.querySelectorAll('[data-trig-toggle]').forEach(function(c){
      c.addEventListener('change', function(){ onToggle(c.getAttribute('data-trig-toggle'), c.checked); });
    });
    listEl.querySelectorAll('[data-trig-fire]').forEach(function(b){
      b.addEventListener('click', function(){ onFire(b.getAttribute('data-trig-fire'), 'personal'); });
    });
    listEl.querySelectorAll('[data-trig-promote]').forEach(function(b){
      b.addEventListener('click', function(){ onPromote(b.getAttribute('data-trig-promote')); });
    });
  }
  // Open wolfpack.quest/admin/triggers prefilled with this trigger's config
  // so an officer can review + click Create. We deliberately DON'T post
  // anything from here — the web form's existing officer-role gate is the
  // right authorization point for adding to the guild set. The agent's
  // localhost endpoint has no concept of who's currently signed in.
  async function onPromote(id) {
    if (!id) return;
    const r = await fetch('/api/personal-triggers');
    const j = r.ok ? await r.json() : { triggers: [] };
    const t = (j.triggers || []).find(function(x){ return x.id === id; });
    if (!t) { alert('Trigger not found.'); return; }
    const action = (Array.isArray(t.actions) && t.actions[0]) || {};
    var params = new URLSearchParams();
    params.set('name',          t.name || '');
    params.set('pattern',       t.pattern || '');
    if (action.text)        params.set('overlay_text',  String(action.text));
    if (action.color)       params.set('overlay_color', String(action.color));
    if (action.duration_ms) params.set('overlay_ms',    String(action.duration_ms));
    if (t.cooldown_seconds) params.set('cooldown',      String(t.cooldown_seconds));
    params.set('notes', 'Promoted from ' + ((window && window.mimic) ? 'Mimic' : 'the local parser') + ' — review and adjust before saving.');
    window.open('https://wolfpack.quest/admin/triggers?' + params.toString(), '_blank', 'noopener,noreferrer');
  }
  async function onFire(id, scope) {
    if (!id) return;
    await fetch('/api/triggers/fire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, scope: scope || 'personal' }),
    });
  }
  async function onPreview() {
    var name = (document.getElementById('trigNewName') || {}).value || 'preview';
    var overlayText = (document.getElementById('trigNewOverlay') || {}).value || '';
    var color = (document.getElementById('trigNewColor') || {}).value || 'red';
    var duration = parseInt((document.getElementById('trigNewDuration') || {}).value || '5000', 10) || 5000;
    var msg = document.getElementById('trigAddMsg');
    if (!overlayText) {
      if (msg) { msg.textContent = 'Need overlay text to preview.'; msg.style.color = 'var(--orange)'; }
      return;
    }
    // Fire ad-hoc — no captures available since we did not match a real line.
    // Named-group references in the text stay literal so the user sees the
    // raw template (a good "this is what it will look like with placeholders"
    // signal). To preview with substitution, run a Test below first.
    await fetch('/api/triggers/fire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger: {
          name: name,
          actions: [{ type: 'text_overlay', text: overlayText, color: color, duration_ms: duration }],
        },
      }),
    });
    if (msg) { msg.textContent = 'Previewed.'; msg.style.color = 'var(--green)'; }
  }
  async function onClearAll() {
    await fetch('/api/triggers/clear', { method: 'POST' });
  }
  async function onClearTests() {
    await fetch('/api/triggers/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testOnly: true }),
    });
  }
  async function onDelete(id) {
    if (!id) return;
    if (!confirm('Delete this trigger?')) return;
    const r = await fetch('/api/personal-triggers');
    const j = r.ok ? await r.json() : { triggers: [] };
    const remaining = (j.triggers || []).filter(function(t){ return t.id !== id; });
    await fetch('/api/personal-triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggers: remaining }),
    });
    fetchAndRenderList();
  }
  async function onToggle(id, enabled) {
    if (!id) return;
    const r = await fetch('/api/personal-triggers');
    const j = r.ok ? await r.json() : { triggers: [] };
    const next = (j.triggers || []).map(function(t){ return t.id === id ? Object.assign({}, t, { enabled: enabled }) : t; });
    await fetch('/api/personal-triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggers: next }),
    });
  }
  async function onAdd() {
    var name = (document.getElementById('trigNewName') || {}).value || '';
    var pattern = (document.getElementById('trigNewPattern') || {}).value || '';
    var cooldown = parseInt((document.getElementById('trigNewCooldown') || {}).value || '0', 10) || 0;
    var overlayText = (document.getElementById('trigNewOverlay') || {}).value || '';
    var color = (document.getElementById('trigNewColor') || {}).value || 'red';
    var duration = parseInt((document.getElementById('trigNewDuration') || {}).value || '5000', 10) || 5000;
    var timerSec = parseInt((document.getElementById('trigNewTimerSec') || {}).value || '0', 10) || 0;
    var endEarly = (document.getElementById('trigNewEndEarly') || {}).value || '';
    var zField = (document.getElementById('trigNewZealField') || {}).value || '';
    var zOp    = (document.getElementById('trigNewZealOp') || {}).value || '<';
    var zVal   = (document.getElementById('trigNewZealValue') || {}).value || '';
    var zealCond = null;
    if (zField && zVal !== '') zealCond = { field: zField, op: zOp, value: Number(zVal) };
    var msg = document.getElementById('trigAddMsg');
    // A trigger needs an overlay text plus EITHER a log pattern OR a Zeal
    // condition. Pure-Zeal triggers (HP thresholds) carry no log pattern.
    if (!name || !overlayText || (!pattern && !zealCond)) {
      if (msg) { msg.textContent = 'Need a name, overlay text, and either a pattern or a Zeal condition.'; msg.style.color = 'var(--red)'; }
      return;
    }
    const r = await fetch('/api/personal-triggers');
    const j = r.ok ? await r.json() : { triggers: [] };
    const row = {
      name: name, pattern: pattern, use_regex: true, enabled: true,
      cooldown_seconds: cooldown,
      actions: [{ type: 'text_overlay', text: overlayText, color: color, duration_ms: duration }],
    };
    if (timerSec > 0) row.timer_duration_sec = timerSec;
    if (endEarly.trim()) { row.end_early_pattern = endEarly.trim(); row.end_use_regex = true; }
    if (zealCond) row.zeal_condition = zealCond;
    const next = (j.triggers || []).concat([row]);
    const save = await fetch('/api/personal-triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggers: next }),
    });
    if (save.ok) {
      if (msg) { msg.textContent = 'Saved.'; msg.style.color = 'var(--green)'; }
      ['trigNewName','trigNewPattern','trigNewOverlay','trigNewEndEarly','trigNewZealValue'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
      var ts = document.getElementById('trigNewTimerSec'); if (ts) ts.value = '0';
      var zf = document.getElementById('trigNewZealField'); if (zf) zf.value = '';
      fetchAndRenderList();
    } else {
      if (msg) { msg.textContent = 'Save failed.'; msg.style.color = 'var(--red)'; }
    }
  }
  async function onTest() {
    var panel = document.getElementById('trigTestPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
  // Fill the "Add personal trigger" form from a config object (used by the
  // "Copy to personal" buttons on the guild-trigger rows). Sets every field the
  // form exposes, scrolls the editor into view, and flags the message line so
  // it's obvious the form was populated. Does NOT save — the user reviews +
  // clicks Add.
  function prefill(cfg) {
    if (!cfg) return;
    var set = function(id, val){ var el = document.getElementById(id); if (el) el.value = (val == null ? '' : String(val)); };
    set('trigNewName',     cfg.name || '');
    set('trigNewPattern',  cfg.pattern || '');
    set('trigNewCooldown', cfg.cooldown_seconds || 0);
    set('trigNewOverlay',  cfg.overlay || '');
    set('trigNewColor',    cfg.color || 'red');
    set('trigNewDuration', cfg.duration_ms || 5000);
    set('trigNewTimerSec', cfg.timer_duration_sec || 0);
    set('trigNewEndEarly', cfg.end_early_pattern || '');
    var zc = cfg.zeal_condition || null;
    set('trigNewZealField', zc && zc.field ? zc.field : '');
    set('trigNewZealOp',    zc && zc.op    ? zc.op    : '<');
    set('trigNewZealValue', zc && zc.value != null ? zc.value : '');
    var msg = document.getElementById('trigAddMsg');
    if (msg) { msg.textContent = 'Copied from guild trigger — review and click "Add trigger" to save your personal copy.'; msg.style.color = 'var(--blue)'; }
    var panel = document.getElementById('trigEditorPanel');
    if (panel && panel.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var nameEl = document.getElementById('trigNewName');
    if (nameEl && nameEl.focus) { try { nameEl.focus(); } catch (e) { void e; } }
  }
  function onImportToggle() {
    var panel = document.getElementById('trigImportPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }
  // Shared import: POST the raw text (EQLP .tgf JSON or GINA/EQLP XML — the
  // server sniffs which) and render the result summary.
  async function runImport(text) {
    var out = document.getElementById('trigImportResult');
    if (!out) return;
    if (!text || !text.trim()) { out.textContent = 'Nothing to import.'; out.style.color = 'var(--dim)'; return; }
    out.textContent = 'Importing…'; out.style.color = 'var(--dim)';
    try {
      const r = await fetch('/api/personal-triggers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: text }),
      });
      const j = await r.json().catch(function(){ return {}; });
      if (!r.ok || !j.ok) {
        out.innerHTML = '<span style="color:var(--red)">Import failed: ' + esc(j.error || ('HTTP ' + r.status)) + '</span>';
        return;
      }
      var summary = '<span style="color:var(--green)">Imported ' + j.imported + ' of ' + j.total_in_xml + ' trigger' + (j.total_in_xml === 1 ? '' : 's') + '.</span>';
      if (j.skipped > 0) summary += ' <span class="dim">' + j.skipped + ' skipped (duplicate name or missing fields).</span>';
      if (Array.isArray(j.errors) && j.errors.length > 0) {
        summary += '<br><span class="dim" style="font-size:10px">' + j.errors.length + ' bad pattern' + (j.errors.length === 1 ? '' : 's') + ': ' + j.errors.slice(0, 3).map(function(e){ return esc(e.name) + ' (' + esc(e.error) + ')'; }).join('; ') + (j.errors.length > 3 ? '; …' : '') + '</span>';
      }
      out.innerHTML = summary;
      if (j.imported > 0) {
        var ta = document.getElementById('trigImportXml'); if (ta) ta.value = '';
        fetchAndRenderList();
      }
    } catch (err) {
      out.innerHTML = '<span style="color:var(--red)">Import error: ' + esc(err && err.message || err) + '</span>';
    }
  }
  async function onImportRun() {
    var xml = (document.getElementById('trigImportXml') || {}).value || '';
    if (!xml.trim()) { var out = document.getElementById('trigImportResult'); if (out) { out.textContent = 'Paste a trigger file body first, or choose a file above.'; out.style.color = 'var(--dim)'; } return; }
    await runImport(xml);
  }
  // File import — reads .tgf / .tgf.gz / .gtp / .xml. Gzipped files (EQLP's
  // default .tgf.gz export) are decompressed in-browser via DecompressionStream
  // before sending, so the user does NOT have to unzip first.
  async function onImportFile(ev) {
    var input = ev && ev.target;
    var file  = input && input.files && input.files[0];
    var out   = document.getElementById('trigImportResult');
    if (!file) return;
    if (out) { out.textContent = 'Reading ' + file.name + '…'; out.style.color = 'var(--dim)'; }
    try {
      var buf   = await file.arrayBuffer();
      var bytes = new Uint8Array(buf);
      var text;
      if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
        var stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
        text = await new Response(stream).text();
      } else {
        text = new TextDecoder('utf-8').decode(buf);
      }
      await runImport(text);
    } catch (err) {
      if (out) { out.innerHTML = '<span style="color:var(--red)">Could not read file: ' + esc(err && err.message || err) + '</span>'; }
    } finally {
      if (input) input.value = '';
    }
  }
  async function onTestRun() {
    var pattern = (document.getElementById('trigNewPattern') || {}).value || '';
    var line = (document.getElementById('trigTestLine') || {}).value || '';
    var out = document.getElementById('trigTestResult');
    if (!out) return;
    if (!pattern || !line) { out.textContent = 'Need both a pattern and a sample line.'; return; }
    const r = await fetch('/api/triggers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: pattern, use_regex: true, line: line, pattern_flags: 'i' }),
    });
    const j = await r.json().catch(function(){ return { matched: false }; });
    if (j.error) { out.innerHTML = '<span style="color:var(--red)">Bad pattern: ' + esc(j.error) + '</span>'; return; }
    if (!j.matched) { out.innerHTML = '<span style="color:var(--dim)">No match.</span>'; return; }
    var grpHtml = '';
    if (j.groups && Object.keys(j.groups).length > 0) {
      grpHtml = ' · groups: ' + Object.entries(j.groups).map(function(kv){ return '<b>' + esc(kv[0]) + '</b>=' + esc(String(kv[1])); }).join(', ');
    }
    out.innerHTML = '<span style="color:var(--green)">Matched: <b>' + esc(j.match || '') + '</b></span>' + grpHtml;
  }
  function mount() {
    if (mounted) return;
    var section = document.getElementById('triggers');
    if (!section) return;
    listEl   = document.getElementById('trigPersonalList');
    editorEl = document.getElementById('trigEditorPanel');
    if (!listEl || !editorEl) return;
    editorEl.innerHTML = buildEditorHtml();
    var addBtn      = document.getElementById('trigAddBtn');
    var previewBtn  = document.getElementById('trigPreviewBtn');
    var testBtn     = document.getElementById('trigTestBtn');
    var importBtn   = document.getElementById('trigImportBtn');
    var importRun   = document.getElementById('trigImportRun');
    if (importBtn) importBtn.addEventListener('click', onImportToggle);
    if (importRun) importRun.addEventListener('click', onImportRun);
    var importFile  = document.getElementById('trigImportFile');
    if (importFile) importFile.addEventListener('change', onImportFile);
    var runBtn      = document.getElementById('trigTestRun');
    if (addBtn)     addBtn.addEventListener('click', onAdd);
    if (previewBtn) previewBtn.addEventListener('click', onPreview);
    if (testBtn)    testBtn.addEventListener('click', onTest);
    if (runBtn)     runBtn.addEventListener('click', onTestRun);
    // Clear-overlay buttons get re-rendered by renderTriggers every 2s poll,
    // so direct addEventListener would die on the first refresh. Use event
    // delegation on the section root — it survives every inner morph and
    // routes clicks by element id.
    if (!section._wpTrigClickBound) {
      section.addEventListener('click', function(e){
        var t = e.target;
        if (!t) return;
        // "Copy to personal" on a guild-trigger row — the data-attr may live on
        // the button or be reached via the clicked child, so walk up to it.
        var cp = t.closest ? t.closest('[data-trig-copy]') : null;
        if (cp) {
          try { prefill(JSON.parse(cp.getAttribute('data-trig-copy'))); } catch (err) { void err; }
          return;
        }
        if (!t.id) return;
        if (t.id === 'trigClearAllBtn')  onClearAll();
        else if (t.id === 'trigClearTestBtn') onClearTests();
      });
      section._wpTrigClickBound = true;
    }
    fetchAndRenderList();
    mounted = true;
  }
  // Re-grab the references each time renderTriggers wipes #trigPersonalList
  // / #trigEditorPanel via setSectionHTML (innerHTML replace). On those polls,
  // re-mount cheaply by re-binding to the new nodes.
  function remountIfNeeded() {
    var listNew   = document.getElementById('trigPersonalList');
    var editorNew = document.getElementById('trigEditorPanel');
    if (!listNew || !editorNew) { mounted = false; return; }
    if (listNew !== listEl || editorNew !== editorEl) {
      mounted = false;
      mount();
    }
  }
  window._wpTrigEditor = { mount: function(){ remountIfNeeded(); mount(); } };
})();

// ── 🎯 Suggested triggers panel ─────────────────────────────────────────────
// One-click pre-tested alerts. Each row is a checkbox (enabled) + speaker
// toggle (TTS) backed by /api/triggers/suggested. The list is small and
// stable, so we re-fetch on every mount + after each toggle (cheapest path).
(function setupSuggestedTriggers(){
  var mounted = false;
  var listEl = null;
  function badge(cat){
    var color = ({ buff:'#7ee787', debuff:'#ff7b72', mob:'#f0883e',
                   self:'#d2a8ff', utility:'#79c0ff' })[cat] || '#8b949e';
    return '<span style="font-size:9px;color:' + color + ';background:rgba(255,255,255,0.05);padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:0.5px">' + cat + '</span>';
  }
  function rowHtml(t){
    return '<tr data-tid="' + t.id + '">'
         + '<td style="padding:4px 6px"><input type="checkbox" class="trgEn" ' + (t.enabled ? 'checked' : '') + '></td>'
         + '<td style="padding:4px 6px">' + badge(t.category) + '</td>'
         + '<td style="padding:4px 6px;color:var(--text)"><b>' + t.label + '</b><div style="color:var(--dim);font-size:10px;margin-top:2px">→ <span style="color:#f6c365">' + t.overlay_text + '</span></div></td>'
         + '<td style="padding:4px 6px;text-align:center"><label title="Speak the alert (TTS)" style="cursor:pointer;display:inline-block"><input type="checkbox" class="trgTts" ' + (t.tts ? 'checked' : '') + (t.enabled ? '' : ' disabled') + '> 🔊</label></td>'
         + '</tr>';
  }
  function groupHtml(category, label, items){
    if (!items || items.length === 0) return '';
    var rows = items.map(rowHtml).join('');
    return '<div style="margin-top:8px"><div style="font-size:11px;color:var(--dim);margin-bottom:3px">' + label + '</div>'
         + '<table style="width:100%;font-size:12px;border-collapse:collapse;background:rgba(255,255,255,0.02);border-radius:4px"><tr style="color:var(--dim);font-size:10px;border-bottom:1px solid var(--border)">'
         + '<th style="padding:3px 6px;text-align:left;width:24px">on</th>'
         + '<th style="padding:3px 6px;text-align:left">cat</th>'
         + '<th style="padding:3px 6px;text-align:left">trigger</th>'
         + '<th style="padding:3px 6px;text-align:center;width:60px">TTS</th>'
         + '</tr>' + rows + '</table></div>';
  }
  async function fetchAndRender(){
    if (!listEl) return;
    try {
      var r = await fetch('/api/triggers/suggested');
      var j = await r.json();
      var triggers = (j && j.triggers) || [];
      if (triggers.length === 0) { listEl.innerHTML = '<div style="color:var(--dim);font-size:12px">No suggested triggers configured.</div>'; return; }
      var groups = { buff:[], debuff:[], mob:[], self:[], utility:[] };
      for (var i=0;i<triggers.length;i++){ var t = triggers[i]; (groups[t.category] || (groups.utility)).push(t); }
      var html = '';
      html += groupHtml('buff',    '✨ Your buffs dropping',  groups.buff);
      html += groupHtml('debuff',  '🛡 Debuffs / resists',     groups.debuff);
      html += groupHtml('self',    '⚠ Self-status alerts',    groups.self);
      html += groupHtml('mob',     '👹 Boss / mob callouts',  groups.mob);
      html += groupHtml('utility', '🔧 Utility (HP / mana)',  groups.utility);
      listEl.innerHTML = html;
      // Wire toggles. Both flips POST to the same endpoint with partial state;
      // missing fields preserve current values server-side.
      listEl.querySelectorAll('tr[data-tid]').forEach(function(tr){
        var id = tr.getAttribute('data-tid');
        var en = tr.querySelector('.trgEn');
        var tts = tr.querySelector('.trgTts');
        if (en) en.addEventListener('change', async function(){
          tr.style.opacity = '0.5';
          try { await fetch('/api/triggers/suggested', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: id, enabled: en.checked }) }); }
          catch (e) {}
          tr.style.opacity = '1';
          fetchAndRender();   // refresh so tts checkbox enabled-state syncs
        });
        if (tts) tts.addEventListener('change', async function(){
          tr.style.opacity = '0.5';
          try { await fetch('/api/triggers/suggested', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: id, tts: tts.checked }) }); }
          catch (e) {}
          tr.style.opacity = '1';
        });
      });
    } catch (e) {
      listEl.innerHTML = '<div style="color:var(--red);font-size:12px">Failed to load suggested triggers: ' + e.message + '</div>';
    }
  }
  function mount(){
    if (mounted) return;
    listEl = document.getElementById('trigSuggestedList');
    if (!listEl) return;
    mounted = true;
    fetchAndRender();
  }
  function remountIfNeeded(){
    var n = document.getElementById('trigSuggestedList');
    if (!n) { mounted = false; return; }
    if (n !== listEl) { mounted = false; mount(); }
  }
  window._wpSuggestedTriggers = { mount: function(){ remountIfNeeded(); mount(); } };
})();

// ── 💥 My Crits panel ───────────────────────────────────────────────────────
// The operator's own melee + spell criticals this session, per box. Rendered in
// the main section loop into the stable #wpCritsCard placeholder (in renderDash)
// — NOT injected by a separate 3s loop. The old approach inserted the card into
// #dash's grid, which renderDash wiped on every rewrite, so the card flickered
// in and out ("keeps refreshing and falling away"). Self-isolated like the Zeal
// cards: only this element repaints, and it survives section rewrites.
function renderCritsCard(s) {
  var el = document.getElementById('wpCritsCard');
  if (!el) return;
  var crits = s && s.sessionCrits;
  var fmt = function(n){ n = Number(n) || 0; return n.toLocaleString(); };
  var names = crits ? Object.keys(crits) : [];
  names = names.filter(function(nm){
    var c = crits[nm] || {};
    var mc = (c.melee && c.melee.count) || 0;
    var sc = (c.spell && c.spell.count) || 0;
    return (mc + sc) > 0;
  });
  if (names.length === 0){ if (el.style.display !== 'none') el.style.display = 'none'; morphInto(el, ''); return; }
  if (el.style.display === 'none') el.style.display = 'block';
  names.sort(function(a, b){
    var ca = crits[a], cb = crits[b];
    var ta = (ca.melee.count || 0) + (ca.spell.count || 0);
    var tb = (cb.melee.count || 0) + (cb.spell.count || 0);
    return tb - ta;
  });
  var html = '<h2>💥 My Crits <span class="dim" style="font-size:11px;text-transform:none;letter-spacing:0"> · this session</span></h2>';
  html += '<table><tr><th>Character</th><th>Type</th><th class="num">Crits</th><th class="num">Biggest</th><th class="num">Bonus dmg</th></tr>';
  names.forEach(function(nm){
    var c = crits[nm];
    var types = [['⚔️ melee', c.melee], ['✨ spell', c.spell]];
    types.forEach(function(r){
      var b = r[1] || { count: 0, total: 0, max: 0 };
      if (!b.count) return;
      html += '<tr><td class="name">' + esc(nm) + '</td><td>' + r[0] + '</td><td class="num">' + fmt(b.count) + '</td><td class="num">' + fmt(b.max) + '</td><td class="num">' + fmt(b.total) + '</td></tr>';
    });
  });
  html += '</table>';
  html += '<div class="dim" style="font-size:10px;margin-top:4px">Amount shown is the crit bonus on top of the hit. Spell crits need a Quarm critical-blast line to confirm.</div>';
  morphInto(el, html);
}
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
  const mapFile = (f) => {
    // A completed backfill is "stale" when newer detectors have shipped since
    // the version stored in resume.agentVersion. Caller surfaces this as a
    // pulse on the ↻ Re-run button + a top-of-page banner counting how many
    // files would benefit. Empty array = nothing new to extract.
    const resume = f.resume || null;
    const isComplete = !!(resume && resume.complete && resume.agentVersion);
    const stale = isComplete ? detectorsStaleSince(resume.agentVersion) : [];
    return {
      path:      f.path,
      character: f.character,
      isAlt:     f.isAlt,
      isWatched: !!f.isWatched,  // ← was omitted; without it the UI couldn't tell
      sizeBytes: f.sizeBytes,    //   the checkbox should render as `disabled`,
      sizeMb:    f.sizeMb,       //   so clicks reached the server but were
      mtime:     f.mtime ? f.mtime.getTime() : null,  // silently dropped by the
      selected:  !!f.selected,                        // `!f.isWatched` guard
      requested: !!f.requested,                       // in the select handler.
      resume,
      staleDetectors: stale.map(d => ({ version: d.version, name: d.name, label: d.label })),
      active:    _activeBackfills.has(f.path),
      activeStatus: _activeBackfills.get(f.path) || null,
    };
  };
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
      if (req.url === '/' || req.url === '/index.html' || (req.url && req.url.indexOf('/?') === 0)) {
        // no-store so Electron's BrowserWindow (and browsers) never serve a
        // stale dashboard after a hot-swap — caching the old HTML was a prime
        // suspect for the "blank in app, fine in browser" reports.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, must-revalidate' });
        return res.end(WEB_HTML);
      }
      if (req.url === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(_serializeForDashboard()));
      }
      // Mimic's buff-queue overlay polls this — we proxy the bot's
      // /api/agent/raid-buff-queue with a 3s cache so a room of Mimics doesn't
      // hammer Supabase. ?class=<bufferClass> filters the buff list to what
      // the buffer can fix; the debuff list is class-agnostic.
      if (req.url && req.url.indexOf('/api/buff-queue') === 0) {
        let bufferClass = '';
        try { bufferClass = new URL(req.url, 'http://x').searchParams.get('class') || ''; } catch { /* */ }
        // Use the currently-active EQ window's character so the bot can
        // sort the queue with same-zone raiders at the top + filter to
        // who's actually online. Falls back to the freshest Zeal client
        // when there's no signal from Mimic about the active window.
        let bufferCharacter = '';
        try {
          const active = (stats && stats.activeCharacter) ? String(stats.activeCharacter) : '';
          if (active) bufferCharacter = active;
          else {
            const st = _currentTargetState();
            for (const ch of Object.keys(_zealState)) {
              if (_zealState[ch] === st) { bufferCharacter = ch; break; }
            }
          }
        } catch { /* */ }
        fetchRaidBuffQueue(bufferClass, bufferCharacter);
        const cacheKey = String(bufferClass || '').toLowerCase() + '|' + String(bufferCharacter || '').toLowerCase();
        const cached = _buffQueueCache.get(cacheKey);
        const payload = (cached && cached.payload) || { buff_queue: [], debuff_queue: [], loading: true };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(payload));
      }
      // Browser-side spell lookup. The dashboard fetches this ONCE on load to
      // turn spell names rendered on the resisted / inbound-damage / NPC cast
      // cards into PQDI links. We only ship { lowercaseName: id } (~3.9k * ~30
      // chars ≈ 110KB) rather than the whole catalog — the full messages are
      // only needed by the agent itself for effect-text inference.
      if (req.url === '/api/spells.json') {
        const map = {};
        if (_spellByNameLower && _spellByNameLower.size) {
          for (const [k, v] of _spellByNameLower) if (v && v.id) map[k] = v.id;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'max-age=86400',  // 1 day; dashboard refetches across full reloads
        });
        return res.end(JSON.stringify(map));
      }
      // Increment 2f passthrough: GET /api/server/<key>?character=... proxies
      // to the bot's /api/agent/server-panel/<key> with our stored bearer
      // token so the dashboard can render wolfpack.quest aggregates next to
      // its local data. No-op if we have no token (local-only install).
      if (req.method === 'GET' && req.url.startsWith('/api/server/')) {
        const opts = _uploadOpts;
        if (!opts || !opts.botUrl || !opts.token) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not connected — set a token in Mimic Settings' }));
        }
        try {
          const tail = req.url.substring('/api/server/'.length); // e.g. damage?character=Hitya
          const base = opts.botUrl.replace(/\/encounter(\?.*)?$/, '/server-panel/');
          const target = base + tail;
          const u = new URL(target);
          const mod = u.protocol === 'https:' ? https : http;
          const upstream = mod.request({
            method: 'GET', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + (u.search || ''),
            headers: { 'Authorization': `Bearer ${opts.token}`, 'Accept': 'application/json' },
          }, (upRes) => {
            res.writeHead(upRes.statusCode || 502, { 'Content-Type': 'application/json' });
            upRes.pipe(res);
          });
          upstream.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'upstream failed', detail: err.message }));
          });
          upstream.end();
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'proxy error', detail: err.message }));
        }
      }
      // POST /api/server/<action> — mutation passthrough. Today this is just
      // place-bid (live bidding overlay) but keeping the routing generic so
      // future "do something on the bot" buttons reuse it.
      if (req.method === 'POST' && req.url.startsWith('/api/server/')) {
        const opts = _uploadOpts;
        if (!opts || !opts.botUrl || !opts.token) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'not connected — set a token in Mimic Settings' }));
        }
        try {
          const action = req.url.substring('/api/server/'.length);
          const map = { 'place-bid': '/api/agent/place-bid' };
          const remotePath = map[action];
          if (!remotePath) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'unknown action', action }));
          }
          const body = await _readBody(req);
          const base = opts.botUrl.replace(/\/api\/agent\/encounter(\?.*)?$/, '');
          const target = base + remotePath;
          const u = new URL(target);
          const mod = u.protocol === 'https:' ? https : http;
          const upstream = mod.request({
            method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname,
            headers: {
              'Authorization': `Bearer ${opts.token}`,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body || ''),
              'Accept': 'application/json',
            },
          }, (upRes) => {
            res.writeHead(upRes.statusCode || 502, { 'Content-Type': 'application/json' });
            upRes.pipe(res);
          });
          upstream.on('error', (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'upstream failed', detail: err.message }));
          });
          upstream.end(body || '');
          return;
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'proxy error', detail: err.message }));
        }
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
      // Zeal pipe events forwarded by Mimic (same machine, localhost only —
      // no auth, matches the other localhost dashboard endpoints). Body:
      // { connectedPids: [..], events: [{ type, sample? }] }. We tally per
      // type and keep the latest sample so the Triggers tab can render a
      // "Zeal: connected · N events" status with example shapes.
      if (req.url === '/api/zeal-event' && req.method === 'POST') {
        const body = await _readBody(req, 512 * 1024);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        if (Array.isArray(payload?.connectedPids)) _zeal.connectedPids = payload.connectedPids;
        const events = Array.isArray(payload?.events) ? payload.events : [];
        for (const e of events) {
          const type = e && e.type !== undefined ? String(e.type) : 'noType';
          _zeal.byType[type] = (_zeal.byType[type] || 0) + 1;
          _zeal.total += 1;
          if (e && e.sample !== undefined) {
            _zeal.lastSamples[type] = { at: Date.now(), obj: e.sample };
            // Type 5 = Zeal raid roster. Decode + upload (debounced) so the
            // group-based /buffs grid knows the live raid composition.
            if (type === '5') _maybeUploadRaidRoster(e.sample);
          }
        }
        if (events.length) _zeal.lastEventAt = Date.now();
        _zeal.updatedAt = Date.now();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, total: _zeal.total }));
      }
      // Throttled live-state snapshot from Mimic (≈3-4/sec, not the raw event
      // stream). Drives gauge-condition triggers. Body:
      // { character, state: { self_hp_pct, target_name, target_hp_pct, zone,
      //   autoattack, group_min_hp_pct, group_min_name } }
      if (req.url === '/api/zeal-state' && req.method === 'POST') {
        const body = await _readBody(req, 64 * 1024);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        const character = String(payload?.character || '').trim();
        // Logout/character-switch: Mimic retires the character (pipe closed,
        // same-client character swap, or 2m idle at char select). Drop the
        // entry so Mob Info / triggers stop acting on the camped character's
        // last target — without this, _currentTargetState() keeps returning
        // the stale entry forever ("shows Dafeet after switching characters").
        if (character && payload?.disconnected === true) {
          delete _zealState[character];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, retired: true }));
        }
        const st = payload?.state;
        if (character && st && typeof st === 'object') {
          // Detect a CAST START via Zeal label 134 transition. /melody on
          // Quarm only logs "You begin playing a melody." once — the per-
          // song "You begin singing X" lines aren't emitted for melody-
          // queued songs. But Zeal's casting label DOES update per song,
          // so a transition from empty-or-different → non-empty here is
          // our reliable "song starting now" signal. Same path works for
          // non-bard /melody chains (wizard nuke rotations etc).
          const prevState = _zealState[character] || {};
          const prevCasting = (prevState.casting || '').trim();
          const newCasting  = (st.casting || '').trim();
          _zealState[character] = { ...st, updatedAt: Date.now() };
          if (newCasting && newCasting !== prevCasting) {
            // Heuristic: anything > 4 chars + has at least one letter is a
            // real spell/song name. Filters out one-off junk labels.
            if (newCasting.length > 4 && /[a-zA-Z]/.test(newCasting)) {
              _bumpBardMelody(character, newCasting, Date.now(),
                { kind: (st.class === 'Bard' || /singing/i.test(newCasting)) ? 'song' : 'spell' });
            }
          }
          try { _evaluateZealConditions(character, Date.now()); } catch (e) { void e; }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }
      // Per-machine "pause Discord tells" toggle, driven by the Mimic tray.
      // Body: { until: <ms epoch> }  (0 / past = resume now). We stamp this
      // onto subsequent tell uploads (dm_pause_until) so the bot skips the
      // Discord DM but still stores the tell. Pause lives only as long as the
      // agent process — a restart resumes DMs, and Mimic re-pushes on relaunch.
      if (req.url === '/api/tells-dm-pause' && req.method === 'POST') {
        const body = await _readBody(req, 4 * 1024);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        const until = Number(payload?.until) || 0;
        _tellsDmPauseUntil = (until > Date.now()) ? until : 0;
        console.log(_tellsDmPauseUntil
          ? `[tells] Discord DMs paused until ${new Date(_tellsDmPauseUntil).toISOString()}`
          : '[tells] Discord DMs resumed');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, until: _tellsDmPauseUntil }));
      }
      // Mimic Discord-login session relay. After Mimic completes the device-
      // code dance with the bot, it POSTs the resulting session_token here so
      // we can forward it on outbound bot requests (X-Wolfpack-Mimic-Session)
      // and surface the identity on the dashboard. Body: { token, identity? }.
      // Like the tells-pause endpoint, this is in-process only — Mimic re-pushes
      // on every agent (re)launch so a restart doesn't silently lose identity.
      if (req.url === '/api/mimic-session' && req.method === 'POST') {
        const body = await _readBody(req, 8 * 1024);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        const token = String(payload?.token || '').trim();
        _mimicSessionToken = token || '';
        _mimicIdentity     = (token && payload?.identity && typeof payload.identity === 'object') ? payload.identity : null;
        console.log(_mimicSessionToken
          ? `[mimic-session] linked as ${_mimicIdentity?.display_name || _mimicIdentity?.discord_id || '(unknown)'}`
          : '[mimic-session] cleared');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, signed_in: !!_mimicSessionToken }));
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
      // ✕ from a charm pet card — drops the entry from _charmTickTracker so
      // the overlay stops rendering it. Safety net for wrongly-attributed
      // pets that the gauge reconciler hasn't pruned yet (e.g. a bystander
      // leak left a stale BROKE card around).
      if (req.url === '/api/charm-pet/dismiss' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end('invalid json'); }
        const k = String(payload && payload.key || '').toLowerCase();
        const removed = k && _charmTickTracker.delete(k);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, removed: !!removed }));
      }
      // ✕ from a pet tracker card — drops the per-owner /pet health snapshot
      // + observed buff landings + stats so the row stops rendering. Useful
      // when switching toons leaves stale pet state (the freshness gate now
      // hides logged-off chars, but the buffs/landings still persist and can
      // re-surface on a new pet).
      if (req.url === '/api/pet/dismiss' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end('invalid json'); }
        const owner = String(payload && payload.owner || '').toLowerCase();
        let removed = false;
        if (owner) {
          if (_petHealthByOwner.delete(owner)) removed = true;
          if (_petBuffLandings.delete(owner))  removed = true;
          if (_petStatsByOwner.delete(owner))  removed = true;
          if (removed) _savePetStateSoon();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, removed }));
      }
      if (req.url === '/api/optin' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(_serializeOptinForWeb()));
      }

      // ── Personal triggers CRUD ─────────────────────────────────────────────
      // The agent already loads <state-dir>/personal_triggers.json on startup
      // and merges into the evaluator. The Triggers tab on the dashboard now
      // edits that list through these endpoints; we always replace the whole
      // list (simpler than per-id PATCH/DELETE and the list is tiny).
      if (req.url === '/api/personal-triggers' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ triggers: _serializePersonalTriggers() }));
      }
      // GET /api/triggers/suggested — read-only catalog of one-click trigger
      // templates, enriched with the user's current enabled/TTS state for each.
      // Powers the "Suggested triggers" panel on the dashboard so adding a
      // pre-tested alert is a checkbox click instead of a regex paste.
      if (req.url === '/api/triggers/suggested' && req.method === 'GET') {
        const items = SUGGESTED_TRIGGERS.map(tpl => {
          const row = _findSuggestedRow(tpl.id);
          return {
            id:        tpl.id,
            category:  tpl.category,
            label:     tpl.label,
            pattern:   tpl.pattern,
            overlay_text: tpl.overlay_text,
            overlay_color: tpl.overlay_color || 'red',
            overlay_ms: tpl.overlay_ms || 4000,
            tts_default: !!tpl.tts_default,
            zeal_condition: tpl.zeal_condition || null,
            cooldown_seconds: tpl.cooldown_seconds || 0,
            // User-state slice
            enabled:    !!(row && row.enabled),
            tts:        _suggestedHasTts(row),
          };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ triggers: items }));
      }
      // POST /api/triggers/suggested — body { id, enabled?, tts? }. Toggles
      // a specific suggested trigger by id; missing fields preserve current
      // state. Enabling instantiates the template into _personalTriggers
      // (id "suggested:<id>"); disabling removes it. TTS toggles add/remove
      // the inline `tts` field on the text_overlay action so the trigger
      // overlay window decides whether to speak.
      if (req.url === '/api/triggers/suggested' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        const id = String(payload?.id || '').trim();
        const tpl = SUGGESTED_TRIGGERS.find(t => t.id === id);
        if (!tpl) { res.writeHead(404); return res.end(JSON.stringify({ error: 'unknown template id' })); }
        const wantEnabled = payload.enabled == null ? null : !!payload.enabled;
        const wantTts     = payload.tts == null     ? null : !!payload.tts;
        const synId = 'suggested:' + tpl.id;
        const existingIdx = _personalTriggers.findIndex(t => t && t.id === synId);
        const existing = existingIdx >= 0 ? _personalTriggers[existingIdx] : null;
        // Resolve desired final state: enabled defaults to existing-or-true;
        // tts defaults to existing-or-tpl.tts_default.
        const finalEnabled = wantEnabled != null ? wantEnabled : !!existing;
        const finalTts     = wantTts     != null ? wantTts     : (existing ? _suggestedHasTts(existing) : !!tpl.tts_default);
        if (!finalEnabled) {
          // Disable → drop the row entirely. The user can re-toggle the
          // checkbox to restore (with template defaults).
          if (existingIdx >= 0) {
            _personalTriggers.splice(existingIdx, 1);
            savePersonalTriggers();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, enabled: false, tts: false }));
        }
        // Enabled — instantiate from the template, then compile + save.
        const row = _templateToPersonalRow(tpl, { tts: finalTts });
        try {
          const compiled = _compilePersonalTrigger(row);
          if (existingIdx >= 0) _personalTriggers[existingIdx] = compiled;
          else                  _personalTriggers.push(compiled);
          savePersonalTriggers();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: true, enabled: true, tts: finalTts }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'compile failed: ' + (err.message || String(err)) }));
        }
      }
      if (req.url === '/api/personal-triggers' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        const incoming = Array.isArray(payload?.triggers) ? payload.triggers : [];
        const compiled = [];
        const errors = [];
        const ZEAL_FIELDS = ['target_hp_pct', 'self_hp_pct', 'group_min_hp_pct'];
        const ZEAL_OPS    = ['<', '<=', '>', '>=', '=='];
        for (const t of incoming) {
          // A trigger is valid if it has a log pattern OR a zeal_condition.
          // Pure-Zeal triggers (HP thresholds) carry no text pattern.
          const hasPattern = t && typeof t.pattern === 'string' && t.pattern.trim();
          let zealCond = null;
          if (t && t.zeal_condition && ZEAL_FIELDS.includes(t.zeal_condition.field)
              && ZEAL_OPS.includes(t.zeal_condition.op)
              && t.zeal_condition.value != null && !isNaN(Number(t.zeal_condition.value))) {
            zealCond = {
              field: t.zeal_condition.field,
              op:    t.zeal_condition.op,
              value: Math.max(0, Math.min(100, Number(t.zeal_condition.value))),
            };
          }
          if (!hasPattern && !zealCond) continue;
          // Defaults — keep the row shape consistent with what loadPersonalTriggers expects.
          const row = {
            id:            t.id || ('p_' + Math.random().toString(36).slice(2, 10)),
            name:          String(t.name || '').slice(0, 100) || 'untitled',
            pattern:       hasPattern ? String(t.pattern).slice(0, 1000) : '',
            pattern_flags: String(t.pattern_flags || 'i').slice(0, 6),
            use_regex:     t.use_regex !== false,
            enabled:       t.enabled !== false,
            cooldown_seconds: Math.max(0, Math.min(3600, parseInt(t.cooldown_seconds, 10) || 0)),
            timer_duration_sec: Math.max(0, Math.min(3600, parseInt(t.timer_duration_sec, 10) || 0)),
            end_early_pattern: t.end_early_pattern ? String(t.end_early_pattern).slice(0, 1000) : null,
            end_use_regex:     t.end_use_regex !== false,
            // Gauge-condition trigger (fires off live Zeal state, not a log
            // line). Null for ordinary text triggers.
            zeal_condition:    zealCond,
            actions:       Array.isArray(t.actions) ? t.actions.slice(0, 5) : [{
              type: 'text_overlay',
              text: String(t.overlay_text || t.name || 'TRIGGER').slice(0, 200),
              color: String(t.overlay_color || 'red').slice(0, 20),
              duration_ms: Math.max(500, Math.min(60000, parseInt(t.overlay_ms, 10) || 5000)),
            }],
          };
          try { compiled.push(_compilePersonalTrigger(row)); }
          catch (err) { errors.push({ name: row.name, error: err.message }); }
        }
        _personalTriggers = compiled;
        savePersonalTriggers();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, stored: compiled.length, errors }));
      }

      // Test-fire a trigger WITHOUT a live-line match. Two body shapes:
      //   { id: "...", scope: "personal" | "guild" }       — fire saved trigger
      //   { trigger: { name, actions: [...] }, captures: { x: 'foo' } }
      //                                                    — fire an ad-hoc one
      // Captures are substituted into action text via {name}; for saved
      // triggers without captures, named groups in the alert text just stay
      // literal so the user sees what the template looks like. Returns the
      // overlay that was pushed (or an error).
      //
      // SAFE BY CONSTRUCTION: _fireTriggerActions only pushes to the in-memory
      // _activeOverlays ring buffer. No DB, no upload queue, no Discord.
      if (req.url === '/api/triggers/fire' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        let trig = null;
        if (payload?.trigger && Array.isArray(payload.trigger.actions)) {
          trig = { name: String(payload.trigger.name || 'preview').slice(0, 100),
                   actions: payload.trigger.actions, _scope: 'test' };
        } else if (payload?.id) {
          const scope = payload?.scope === 'guild' ? 'guild' : 'personal';
          const list  = scope === 'guild' ? (stats.guildTriggers || []) : _personalTriggers;
          trig = list.find(t => t.id === payload.id || t.name === payload.id) || null;
          if (trig) trig = { ...trig, _scope: scope };
        }
        if (!trig) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'trigger not found (expected `id`+`scope` or `trigger`)' }));
        }
        const captures = (payload && payload.captures && typeof payload.captures === 'object') ? payload.captures : {};
        const before = _activeOverlays.length;
        _fireTriggerActions(trig, captures, Date.now(), true);
        const fired = _activeOverlays.length - before;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, fired, overlay: _activeOverlays[0] || null }));
      }

      // Clear active overlays. Body { trigger: 'name' } removes only overlays
      // from that trigger; empty body clears everything. Use this to dismiss
      // a stuck overlay or wipe test fires before the next try. In-memory
      // only; no persisted state to clean up.
      if (req.url === '/api/triggers/clear' && req.method === 'POST') {
        const body = await _readBody(req).catch(() => '');
        let payload = {};
        try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }
        const beforeO = _activeOverlays.length;
        const beforeT = _activeTimers.size;
        if (payload?.trigger) {
          const want = String(payload.trigger);
          for (let i = _activeOverlays.length - 1; i >= 0; i--) {
            if (_activeOverlays[i].trigger === want) _activeOverlays.splice(i, 1);
          }
          // Cancel any timer whose name matches too — the user's intent
          // when clearing a named trigger is "stop everything from that
          // trigger", not just the overlay alert.
          for (const [id, t] of _activeTimers) {
            if (t.name === want) _activeTimers.delete(id);
          }
        } else if (payload?.testOnly) {
          for (let i = _activeOverlays.length - 1; i >= 0; i--) {
            if (_activeOverlays[i].test) _activeOverlays.splice(i, 1);
          }
          for (const [id, t] of _activeTimers) {
            if (t.test) _activeTimers.delete(id);
          }
        } else {
          _activeOverlays.length = 0;
          _activeTimers.clear();
        }
        const cleared        = beforeO - _activeOverlays.length;
        const clearedTimers  = beforeT - _activeTimers.size;
        scheduleRender();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, cleared, cleared_timers: clearedTimers }));
      }

      // POST /api/personal-triggers/import — accepts a GINA / EQLogParser
      // XML blob (both export the same SharedTriggers shape) and APPENDS
      // parsed entries to the personal triggers list. Existing personal
      // triggers are preserved; duplicates by name are skipped (caller can
      // delete + re-import to overwrite). Returns { imported, skipped,
      // errors[] } so the UI can show a summary.
      if (req.url === '/api/personal-triggers/import' && req.method === 'POST') {
        const body = await _readBody(req, 2 * 1024 * 1024);   // 2MB cap — trigger packs can be big
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        // Accept the body under `xml` (legacy key) OR `data`; the content can be
        // GINA/EQLP SharedTriggers XML *or* EQLogParser's native JSON .tgf tree
        // (the client gunzips .tgf.gz before sending). Detect by first char.
        const raw = String(payload?.xml || payload?.data || '');
        if (!raw.trim()) {
          res.writeHead(400); return res.end(JSON.stringify({ error: 'import body required' }));
        }
        const isJson = /^\s*[\[{]/.test(raw);
        const parsed = isJson ? (_parseTriggerTgfJson(raw) || []) : _parseTriggerXml(raw);
        const existingNames = new Set(_personalTriggers.map(t => String(t.name || '').toLowerCase()));
        const compiled = [];
        const errors = [];
        let imported = 0, skipped = 0;
        for (const t of parsed) {
          if (!t.name || !t.pattern) { skipped++; continue; }
          if (existingNames.has(t.name.toLowerCase())) { skipped++; continue; }
          const ttsText = String(t.tts_text || '').slice(0, 200);
          // Only create an on-match alert when EQLP actually had display OR speak
          // text. A timer-only trigger (e.g. the "tank BUSTER" example: no
          // display/speak, just a 60s timer that warns 12s before it ends)
          // should NOT flash/say its own name on every match — only the timer +
          // its warning callout fire. text falls back display→speak; tts speaks
          // the dedicated speak text, else the overlay speaks the shown text.
          const actions = [];
          if (t.display_text || t.tts_text) {
            actions.push({
              type: 'text_overlay',
              text:  String(t.display_text || t.tts_text).slice(0, 200),
              color: 'red',
              duration_ms: 5000,
              ...(ttsText ? { tts: ttsText } : {}),
            });
          }
          const row = {
            id:            'p_' + Math.random().toString(36).slice(2, 10),
            name:          t.name.slice(0, 100),
            pattern:       _translateGinaPlaceholders(t.pattern).slice(0, 1000),
            pattern_flags: 'i',
            use_regex:     t.use_regex !== false,
            enabled:       true,
            cooldown_seconds: Math.max(0, Math.min(3600, t.cooldown_seconds || 0)),
            actions,
          };
          if (t.timer_duration_sec > 0) row.timer_duration_sec = Math.max(1, Math.min(3600, t.timer_duration_sec));
          // Nothing to do (no alert, no timer) → skip rather than store a no-op.
          if (actions.length === 0 && !(row.timer_duration_sec > 0)) { skipped++; continue; }
          if (t.warning_seconds > 0 && t.warning_text) {
            row.warning_seconds = Math.max(1, Math.min(3600, t.warning_seconds));
            row.warning_text    = String(t.warning_text).slice(0, 200);
          }
          if (t.end_text)          row.end_text = String(t.end_text).slice(0, 200);
          if (t.end_early_pattern) { row.end_early_pattern = _translateGinaPlaceholders(t.end_early_pattern).slice(0, 1000); row.end_use_regex = true; }
          try {
            compiled.push(_compilePersonalTrigger(row));
            existingNames.add(row.name.toLowerCase());
            imported++;
          } catch (err) {
            errors.push({ name: row.name, error: err.message });
          }
        }
        if (compiled.length > 0) {
          _personalTriggers = _personalTriggers.concat(compiled);
          savePersonalTriggers();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, imported, skipped, total_in_xml: parsed.length, errors }));
      }

      // Live regex tester — paste a sample log line, see which patterns match
      // and what they capture. The dashboard uses this for the "Test" box on
      // the Triggers tab so users can dial in a regex before saving.
      if (req.url === '/api/triggers/test' && req.method === 'POST') {
        const body = await _readBody(req);
        let payload;
        try { payload = JSON.parse(body); }
        catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'invalid json' })); }
        const pattern = String(payload?.pattern || '');
        const useRegex = payload?.use_regex !== false;
        const flags = String(payload?.pattern_flags || 'i').slice(0, 6);
        const line  = String(payload?.line || '');
        if (!pattern || !line) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ matched: false, note: 'pattern + line required' }));
        }
        try {
          const pat = useRegex ? _translateDotNetRegex(pattern) : _escapeForLiteralMatch(pattern);
          const rx = new RegExp(pat, flags);
          const m = rx.exec(line);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            matched: !!m,
            match: m ? m[0] : null,
            groups: m && m.groups ? m.groups : {},
            indices: m ? [m.index, m.index + m[0].length] : null,
          }));
        } catch (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ matched: false, error: err.message }));
        }
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
        } else if (action === 'rescan-who') {
          // /who-only rescan: walk these files for /who rows only — skip chat
          // (already uploaded) and combat (skipped by backfill anyway). For
          // anyone who completed a backfill under the pre-v3.0.35 buggy keep
          // pattern that dropped non-anon /who rows — this retroactively
          // populates who_observations with the visible-class data that was
          // silently lost. Does NOT clear progress; doesn't touch chat/combat
          // completion state.
          const toScan = paths.length > 0
            ? paths.map(p => byPath.get(p)).filter(Boolean)
            : _optinState.files;
          if (toScan.length > 0) {
            runOptinBackfill(toScan, { whoOnly: true, log: (m) => console.log(`[optin] ${m}`) });
            console.log(`[optin] /who rescan kicked for ${toScan.length} file(s)`);
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
      // Guard against double-headers — if the inner code already wrote a
      // response and then threw on the second writeHead, we'd crash the
      // whole HTTP server with ERR_HTTP_HEADERS_SENT (Node 20+ throws here
      // rather than emitting an error event). That'd take Mimic's dashboard
      // and overlays down with it. Only attempt the 500 response when
      // headers are still free; otherwise just close the socket.
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err && err.message || 'internal error' }));
        } else {
          res.end();
        }
      } catch (innerErr) {
        // Last-resort: don't crash the listener on a write-fail during error
        // handling. Log + move on.
        try { console.warn('[web-dashboard] error-handler write failed:', innerErr && innerErr.message); } catch {}
      }
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
      // Roll this session's elapsed minutes into the PERSISTED lifetime total
      // incrementally. Previously totalMinutes was never advanced, so lifetime
      // connected time always equalled the current session (the dashboard did
      // totalMinutes + sessionMin with totalMinutes stuck at 0). We add only
      // the delta since the last save so restarts accumulate instead of reset.
      // _accountedSessionMin is process-scoped (not persisted) and resets to 0
      // each launch, matching the fresh startedAt.
      const accounted = stats._accountedSessionMin || 0;
      const delta = sessionMin - accounted;
      if (delta > 0) {
        stats.lifetime.totalMinutes = (stats.lifetime.totalMinutes || 0) + delta;
        stats._accountedSessionMin = sessionMin;
      }
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
  // Skip parse fragments: a spaceless lowercase token ("to", "a"…) is never a
  // real attacker (see isPlausibleAttacker). Belt to the parser's suspenders.
  if (attacker !== character && !isPlausibleAttacker(attacker)) return;
  // Skip self-hits: pet reclaim / cleric pet self-dismiss generates a log line
  // where the pet hits itself for exactly 20K. attacker === defender catches it.
  if (event.defender && attacker.toLowerCase() === event.defender.toLowerCase()) return;

  // Track session-wide damage totals across ALL hit sizes (not just big crits).
  // Powers the "Damage done this session" right column — which is PLAYER damage.
  // Only count PLAYERS (and their declared pets): a boss hitting the raid would
  // otherwise rank as a top "contributor" (the Doomshade / Rumblecrush bug). The
  // uploader's own char always counts; other players count once confirmed (via
  // /who, a heal, or a watched log); declared pets count. NPC attackers (bosses)
  // never confirm, so their incoming hits are excluded.
  const _atkIsPlayer = attacker === character
    || isConfirmedPlayer(attacker)
    || knownPetOwners.has(attacker.toLowerCase());
  if (_atkIsPlayer) {
    stats.sessionTotalDamage += event.amount;
    stats.sessionDamageBy[attacker] = (stats.sessionDamageBy[attacker] || 0) + event.amount;
  }

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

  // Damage-shield tally — separate from abilityStats so we can break it out
  // per attacker per spell on the Tanks tab. _skipDsAggregate is set on the
  // event when DS attribution buffered it into _dsPending — the commit then
  // tallies once the spell name is known (from the flavor line) or after the
  // 2s window expires. Skipping here avoids double-counting under that path.
  if (event.ds && event.amount > 0 && !event._skipDsAggregate) {
    const spell = event.ability || '(unknown)';
    if (!stats.damageShield[attacker]) stats.damageShield[attacker] = {};
    const byTank = stats.damageShield[attacker];
    if (!byTank[spell]) byTank[spell] = { count: 0, total: 0 };
    byTank[spell].count++;
    byTank[spell].total += event.amount;
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
  // Don't record empty / boss-less encounters into recentParses — those are
  // typically session boundary uploads where the agent had nothing meaningful
  // to send (silent zone idle, post-fight flush with all events filtered out).
  // They render as "?  0 ev  0  (0 spell)" placeholders that just clutter
  // the Dashboard card.
  if (!e.boss_name && e.events.length === 0 && totalDmg === 0) {
    return;
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

// ── Quarmy export ingest ─────────────────────────────────────────────────────
// <Name>Quarmy.txt is the in-game export members generate for quarmy.com
// (TSV: Character row, Location/Name/ID/Count/Slots inventory, AAIndex/Rank,
// Checksum). Format verified against three real exports (monk/cleric/bard).
//
// PRIVACY — the whole point of parsing it HERE instead of fetching the
// quarmy.com profile bot-side: Bank, SharedBank, and coin rows (which are
// account-level and include bank totals) are dropped in parseQuarmyExport
// before they reach any buffer. They never leave this machine. The bot strips
// them again server-side as defense in depth, and exclude_inventory /
// exclude_from_stats on /me stop the upload entirely — scanQuarmyExports
// refuses to run before the prefs poll has answered at least once, so the
// gate is enforced on KNOWN prefs, never assumed ones.
const QUARMY_FILENAME_RX = /^([A-Za-z]+)[-_ ]?Quarmy\.txt$/i;
const _quarmyUploaded = {};   // char(lower) → export checksum already enqueued

function parseQuarmyExport(text) {
  const out = { profile: null, equipped: [], bags: [], aas: [], checksum: null };
  const slotSeen = {};
  let section = null;
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw) continue;
    const cols = raw.split('\t');
    const c0 = (cols[0] || '').trim();
    if (!c0) continue;
    if (c0 === 'Character') {
      if ((cols[1] || '').trim() === 'Name') continue;          // header row
      out.profile = {
        name:      (cols[1] || '').trim(),
        last_name: (cols[2] || '').trim() || null,
        level:     parseInt(cols[3], 10) || null,
        class_id:  parseInt(cols[4], 10) || null,
        race_id:   parseInt(cols[5], 10) || null,
        deity_id:  parseInt(cols[7], 10) || null,   // fixes the faction page's deity gap
        guild:     (cols[8] || '').trim() || null,
      };
      continue;
    }
    if (c0 === 'Location') { section = 'inv'; continue; }
    if (c0 === 'AAIndex')  { section = 'aa';  continue; }
    if (c0 === 'Checksum') { out.checksum = (cols[1] || '').trim() || null; section = null; continue; }
    if (section === 'inv') {
      // PRIVACY: bank, shared bank, currency, and the cursor slot never
      // leave this machine — dropped here, before any buffer.
      if (/^(Bank|SharedBank)/i.test(c0) || /Coin/i.test(c0) || c0 === 'Held') continue;
      const itemName = (cols[1] || '').trim();
      const itemId   = parseInt(cols[2], 10);
      const count    = parseInt(cols[3], 10) || 1;
      if (!itemName || itemName.toLowerCase() === 'empty') continue;
      if (!Number.isFinite(itemId) || itemId <= 0) continue;
      if (/^General\d+(-Slot\d+)?$/.test(c0)) {
        out.bags.push({ slot: c0, item_id: itemId, item_name: itemName, count });
      } else {
        // Worn slots. Ear/Wrist/Fingers appear twice — number them so each
        // lands on its own row (the bot's PK is per-slot).
        let slot = c0;
        if (slot === 'Ear' || slot === 'Wrist' || slot === 'Fingers') {
          slotSeen[slot] = (slotSeen[slot] || 0) + 1;
          slot = slot + slotSeen[slot];
        }
        out.equipped.push({ slot, item_id: itemId, item_name: itemName, count });
      }
      continue;
    }
    if (section === 'aa') {
      const idx = parseInt(c0, 10), rank = parseInt(cols[1], 10);
      if (Number.isFinite(idx) && Number.isFinite(rank) && rank > 0) out.aas.push({ index: idx, rank });
    }
  }
  return out;
}

function _quarmyPrefsBlock(lowerName) {
  const p = stats.characterPrefs && stats.characterPrefs[lowerName];
  return !!(p && (p.exclude_inventory || p.exclude_from_stats));
}

function scanQuarmyExports() {
  // Hard gate: prefs must have loaded at least once this session so
  // exclude_inventory is KNOWN before any gear leaves the box. (No botUrl →
  // no prefs poll → no uploads, which is also correct.)
  if (!stats.characterPrefsCheckedAt) return;
  const firstLog = stats.watchedLogs[0]?.logPath;
  if (!firstLog) return;
  const dir = path.dirname(firstLog);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return; }

  const envExcluded = new Set(
    (process.env.WOLFPACK_EXCLUDED_CHARS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  );
  const dryRun = !!(_uploadOpts && _uploadOpts.dryRun);

  for (const name of entries) {
    const m = name.match(QUARMY_FILENAME_RX);
    if (!m) continue;
    const fileChar = m[1].toLowerCase();
    if (envExcluded.has(fileChar) || _quarmyPrefsBlock(fileChar)) continue;
    const fullPath = path.join(dir, name);
    try {
      const parsed = parseQuarmyExport(fs.readFileSync(fullPath, 'utf8'));
      // The Character row inside the file is authoritative over the filename
      // (renamed copies happen) — re-check prefs under the real name too.
      const profName = parsed.profile && parsed.profile.name;
      const character = (profName && /^[A-Za-z]{2,}$/.test(profName))
        ? profName
        : m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
      const lower = character.toLowerCase();
      if (envExcluded.has(lower) || _quarmyPrefsBlock(lower)) continue;
      if (parsed.equipped.length === 0 && parsed.bags.length === 0 && parsed.aas.length === 0) continue;
      const checksum = parsed.checksum || ('mtime-' + fs.statSync(fullPath).mtime.getTime());
      if (_quarmyUploaded[lower] === checksum) continue;
      if (dryRun) {
        console.log(`[quarmy] DRY RUN — would upload ${character}: ${parsed.equipped.length} equipped, ${parsed.bags.length} bagged, ${parsed.aas.length} AAs (checksum ${checksum})`);
        continue;
      }
      _quarmyUploaded[lower] = checksum;
      enqueueUpload('quarmy', {
        agent_version: AGENT_VERSION,
        character,
        level:    parsed.profile?.level    ?? null,
        class_id: parsed.profile?.class_id ?? null,
        race_id:  parsed.profile?.race_id  ?? null,
        deity_id: parsed.profile?.deity_id ?? null,
        checksum,
        equipped: parsed.equipped,
        bags:     parsed.bags,
        aas:      parsed.aas,
      });
      console.log(`[quarmy] queued gear upload for ${character} (${parsed.equipped.length} equipped, ${parsed.bags.length} bagged, ${parsed.aas.length} AAs)`);
    } catch { /* unreadable / malformed — skip, retry next scan */ }
  }
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
  // whoOnly fast path — for files that were already backfilled under a buggy
  // /who keep-pattern (pre-v3.0.35) and need their /who history re-walked
  // without re-uploading chat / combat. Skips the EncounterBuilder + chat batch
  // entirely; per-line work is just shouldKeep + parseEvent + recordWhoEvent on
  // /who-type events. The existing 5s ticker flushes whoData on growth, so the
  // bot's who_observations populates without any new endpoint.
  const whoOnly = !!opts.whoOnly;

  log(`Starting ${whoOnly ? '/who-only rescan' : 'backfill'} on ${files.length} file(s)${whoOnly ? ' (fast path)' : ' — chat + combat + /who'}...`);

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
      // /who-only rescan ALWAYS starts at 0 — the existing bytePos only matters
      // for chat/combat completion; we're walking the whole file for /who rows
      // that the pre-v3.0.35 keep-pattern dropped.
      const startByte = whoOnly ? 0 : (stored?.bytePos || 0);
      const totalBytes = f.sizeBytes || 0;
      status.bytePos = startByte;
      if (whoOnly) {
        log(`  Rescanning ${f.character} for /who rows from ${f.path}...`);
      } else if (startByte > 0) {
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
            const dpEvt = parseDragonPunch(line, f.character);
            if (dpEvt) funEventBuffer.push(dpEvt);
            const dirgeEvt = parseDirgeCast(line, f.character);
            if (dirgeEvt) funEventBuffer.push(dirgeEvt);
            // Faction hits + /con standing transitions — self-only lines; rides
            // the 5s relay flush to /api/agent/faction. Bot-side dedup makes
            // complete-log backfill crawls idempotent.
            const facEvt = parseFactionLine(line, f.character);
            if (facEvt) factionBuffer.push(facEvt);
            const conFacEvt = parseConsiderLine(line, f.character);
            if (conFacEvt) factionBuffer.push(conFacEvt);
            const pfEvt = parsePopFlagLine(line, f.character);
            if (pfEvt) popFlagBuffer.push(pfEvt);
            // Feral Avatar cast-begin (caster-side AND bystander-side).
            // Complementary to parseFeralAvatarReceived below — that one fires
            // on the buff land, this one on the cast begin. Both push so the
            // bot's dedup collapses overlap across multiple agents in zone.
            const faCastEvt = parseFeralAvatar(line, f.character);
            if (faCastEvt) funEventBuffer.push(faCastEvt);
            // Beastlord buff receives — recipient-side. The bot correlates
            // these to specific encounters at display time via ts range, so
            // the agent only needs to emit the bare event.
            const faEvt = parseFeralAvatarReceived(line, f.character);
            if (faEvt) funEventBuffer.push(faEvt);
            const savEvt = parseSavageryReceived(line, f.character);
            if (savEvt) funEventBuffer.push(savEvt);
            // Observed buff landing on another player. Backfilled casts are
            // almost always already-expired by display time (harmless — the web
            // filters expired), but they cost nothing and cover the case where a
            // recent log replay catches a still-active buff.
            const bcEvt = parseBuffLanding(line, f.character);
            if (bcEvt) buffCastBuffer.push(bcEvt);

            // PvP kill broadcasts — record to the ledger from history, but
            // flagged backfill so the bot won't re-post them to Discord.
            const pvpBcast = parsePvpBroadcast(line);
            if (pvpBcast) {
              pvpBatch.push({ ...pvpBcast, backfill: true });
              if (pvpBatch.length >= 200) flushPvp(true).catch(() => {});
              // Assist correlation — same builder.add() that runs below also
              // stamps the damage window, so by the time a kill broadcast
              // lands here the recent self-damage to that victim is already
              // recorded. Tag source 'log_backfill' so the bot can distinguish
              // historical assists from live ones.
              try {
                const assist = builder && builder._checkPvpAssist
                  ? builder._checkPvpAssist(pvpBcast, { source: 'log_backfill' })
                  : null;
                if (assist) pvpAssistBuffer.push(assist);
              } catch (e) { void e; }
            }

            // Chat comes first — chat lines don't survive shouldKeep().
            // SKIPPED in /who-only rescan: chat has already been uploaded; we
            // don't want to re-walk it.
            if (!whoOnly) {
              const chatMsg = parseChatLine(line, f.character);
              if (chatMsg) {
                chatBatch.push({ ...chatMsg, uploadedBy: f.character });
                status.chatCount++;
                if (chatBatch.length >= 500) flushChat(true).catch(() => {});
                return;
              }
            }
            // Combat + /who: shouldKeep with defaults; parseEvent populates the
            // module-level whoData map as a side-effect for /who output rows.
            if (!shouldKeep(line)) return;
            const ts = parseEqTimestamp(line);
            const ev = parseEvent(line, ts);
            if (!ev) return;
            if (whoOnly) {
              if (ev.type === 'who') { recordWhoEvent(ev); status.whoCount = (status.whoCount || 0) + 1; }
              return;       // ignore all other event types in fast path
            }
            builder.add(ev);
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
        } else if (whoOnly) {
          // Don't overwrite the existing progress entry — that records the full
          // backfill state (chatCount, encounterCount, complete). A /who-only
          // rescan just walked the bytes for /who rows; we stamp whoRescanAt /
          // whoRescanVersion so the UI can show "rescanned under vX" without
          // implying chat or combat was re-uploaded.
          const prior = _optinState.progress[f.path] || {};
          _optinState.progress[f.path] = {
            ...prior,
            whoRescanAt:      new Date().toISOString(),
            whoRescanVersion: AGENT_VERSION,
            whoRescanCount:   status.whoCount || 0,
          };
          _saveOptInState();
          status.state = 'done';
          log(`  ✓ /who rescan done: ${f.character} v${AGENT_VERSION} (${status.whoCount || 0} /who row(s) attributed)`);
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
        process.stdout.write(`  ${C.dim}(Captures guild/raid chat + boss-matched combat + /who. Resume saved every ~256KB.)${C.reset}\n`);
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
  // totalMinutes accumulates the live session incrementally (saveStatsSoon), so
  // it already IS lifetime — don't add sessionMin again.
  const lifetimeMin = Math.max(stats.lifetime.totalMinutes || 0, sessionMin);

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

    // Victim-first NPC death: "X has died to <Mob>". Group 3 is the NPC that
    // landed the kill — keep it (it was being thrown away), so assists on the
    // victim can show "killed by <Mob>" instead of a blank.
    const npck = PVP_NPC_KILL_RX.exec(text);
    if (npck) return {
      ts: tsOf(), text, killType: 'npc',
      victim: npck[1], victimGuild: npck[2],
      killer: npck[3], killerGuild: null,
      zone:   npck[4],
    };

    // Killer-first boss kill: "X has killed Boss [in Zone]!" — no victim guild.
    // Try LAST because this is the broadest "has killed" superset; the player-
    // active matcher above must win when both could match. Recorded as PvP so
    // the kill credits to the Wolf Pack killer on /pvp/server.
    const bossA = PVP_BOSS_KILL_ACTIVE_RX.exec(text);
    if (bossA) {
      // A guild PvE INSTANCE kill ("...in <Zone> (Instanced)!") is NOT a
      // PvP-server boss kill — it's the Druzzil-Ro guild broadcast that the
      // /bosskill path already turns into a normal instance timer. Skip it so
      // it doesn't ALSO record a ±20% PvP timer + fire a PvP ping.
      if (/\(Instanced\)/i.test(text)) return null;
      return {
        ts: tsOf(), text, killType: 'pvp',
        killer: bossA[1], killerGuild: bossA[2],
        victim: bossA[3], victimGuild: null,
        zone:   bossA[4] || null,
      };
    }

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
  if (bossBareA) {
    // Guild PvE instance kill echoed in the [PVP] channel — skip (see Path A).
    if (/\(Instanced\)/i.test(line)) return null;
    return {
      ts: tsOf(),
      text: `${bossBareA[2]} of <${bossBareA[3]}> has killed ${bossBareA[4]}${bossBareA[5] ? ` in ${bossBareA[5]}` : ''}!`,
      killType:    'pvp',
      killer:      bossBareA[2], killerGuild: bossBareA[3],
      victim:      bossBareA[4], victimGuild: null,
      zone:        bossBareA[5] || null,
    };
  }

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

// True when a "tells you" line is NPC/system chatter (pet command acks, Bazaar
// merchant transaction quotes) rather than a real player tell. Shared shape
// with the bot's defense-in-depth filter in _handleAgentTells.
function _isNpcTellText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  // Pet acks: pets address the owner as "Master" — "Attacking <mob> Master.",
  // "Following you Master.", "Guarding here Master.", etc.
  if (/\bMaster\b[.!,]?\s*$/i.test(t)) return true;
  if (/^attacking\b.+\bmaster\b/i.test(t)) return true;
  // Bazaar / merchant: "That'll be N platinum for/per X", "I'll give you N gold…"
  // (apostrophe optional/curly-tolerant in case the client uses a typographic ').
  if (/^(that['’]?ll be|i['’]?ll give you)\b.*\b(platinum|gold|silver|copper)\b/i.test(t)) return true;
  return false;
}
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
  // Drop NPC/system chatter that rides the tell channel even when the SENDER
  // looks like a player — the sender-name heuristic above misses single-word
  // pet names ("Genarn") and Bazaar traders (real player names like "Emilyy").
  // Discriminate on the TEXT instead:
  //   • Pet command acks — "Attacking <mob> Master.", "Following you Master.",
  //     "Guarding here Master." … pets address the owner as "Master".
  //   • Bazaar / merchant transaction lines — "That'll be N platinum for the X",
  //     "That'll be N platinum per X", "I'll give you N gold for the X".
  // Always incoming; never a real player tell. Dropped from BOTH the local
  // Recent Tells card and the DM relay (parseTellLine returning null).
  if (direction === 'incoming' && _isNpcTellText(text)) return null;
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

// Append a parsed tell to the LOCAL ring buffer that feeds the Mimic dashboard
// "Recent Tells" card. Only the display fields ride along (raw_text/dedup_key
// dropped) so the /api/state payload stays small. Capped at 50 entries FIFO.
const _RECENT_TELLS_MAX = 50;
function _pushRecentTell(tellEvt, character) {
  stats.recentTells.push({
    character,
    direction:  tellEvt.direction,
    other:      tellEvt.other,
    text:       tellEvt.text,
    ts:         tellEvt.ts,
    capturedAt: Date.now(),
  });
  const over = stats.recentTells.length - _RECENT_TELLS_MAX;
  if (over > 0) stats.recentTells.splice(0, over);
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
const pvpAssistBuffer   = [];   // pending PvP assist correlations (us → player damage + their death by someone else)
const druzzilKillBuffer = [];   // pending Druzzil Ro boss-kill announcements
const funEventBuffer    = [];   // pending fun-events (Peopleslayer LD, future CoH/DI/etc)
const factionBuffer     = [];   // pending faction hits + /con standing transitions
const popFlagBuffer     = [];   // pending PoP flag grants (zone+boss context attached)
const buffCastBuffer    = [];   // pending observed buff landings on other players
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
    if (pvpAssistBuffer.length > 0)
      uploadPvpAssists(pvpAssistBuffer.splice(0), _uploadOpts).catch(() => {});
    if (druzzilKillBuffer.length > 0)
      uploadDruzzilKills(druzzilKillBuffer.splice(0), _uploadOpts).catch(() => {});
    if (_lockoutBuffer.length > 0)
      uploadLockouts(_lockoutBuffer.splice(0), _uploadOpts).catch(() => {});
    if (funEventBuffer.length > 0)
      uploadFunEvents(funEventBuffer.splice(0), _uploadOpts).catch(() => {});
    if (factionBuffer.length > 0)
      uploadFaction(factionBuffer.splice(0), _uploadOpts).catch(() => {});
    if (popFlagBuffer.length > 0)
      uploadPopFlags(popFlagBuffer.splice(0), _uploadOpts).catch(() => {});
    if (buffCastBuffer.length > 0)
      uploadBuffCasts(buffCastBuffer.splice(0), _uploadOpts).catch(() => {});
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

  // Threat-snapshot uploader — every 15s while a fight is active, post the
  // current per-player threat picture to /api/agent/threat-snapshot. The bot
  // dedups identical (uploader, boss, second-granular ts) so the rare
  // overlap from two parsers collapses naturally. No-op when no fight is
  // active or no token is set.
  let _lastSnapAt = 0;
  setInterval(() => {
    if (!_uploadOpts || !_uploadOpts.botUrl || !_uploadOpts.token) return;
    const et = stats.currentEncounterThreat;
    if (!et || !et.perPlayer || Object.keys(et.perPlayer).length === 0) return;
    if (et.flushedAt) return; // fight already wrapped up
    const now = Date.now();
    if (now - _lastSnapAt < 14_000) return; // safety: never faster than ~15s
    _lastSnapAt = now;
    // pick the first watched character as the uploader; fall back to "?".
    let uploader = "?";
    for (const w of stats.watchedLogs || []) {
      if (w && w.character) { uploader = w.character; break; }
    }
    // Use the queue so a network blip retries with the rest.
    enqueueUpload('threat_snapshot', {
      agent_version: AGENT_VERSION,
      uploader,
      boss_name:   et.bossName || null,
      started_at:  et.startedAt ? new Date(et.startedAt).toISOString() : null,
      snapshot_at: new Date(now).toISOString(),
      per_player:  et.perPlayer,
      total:       Object.values(et.perPlayer).reduce((a, p) => a + ((p.swing||0)+(p.proc||0)+(p.spell||0)+(p.heal||0)), 0),
    });
  }, 15_000);
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

// ── 🐉 Dragon Punch — monk Stunning Kick proc ─────────────────────────────────
// Line:  "<target> is stricken by the force of a dragon."
// Caster is the LOG OWNER (whoever's agent saw the line is the monk who threw
// the kick — bystanders see the proc but EQ logs it to the kicker only).
// Powers a per-monk counter on /fun: "Hitya has Dragon Punched X targets."
const DRAGON_PUNCH_RX = /^\[(.+?)\]\s+(.+?)\s+is\s+stricken\s+by\s+the\s+force\s+of\s+a\s+dragon\.?\s*$/i;
function parseDragonPunch(line, selfName) {
  const m = DRAGON_PUNCH_RX.exec(line);
  if (!m) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:     'dragon_punch',
    caster:   selfName,
    target:   m[2].trim(),
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

// ── 🎵 Dirge cast — bard dirge songs ──────────────────────────────────────────
// Line:  "<Bard> begins singing Dirge of <Whatever>."
// Caster-side: "You begin singing Dirge of <Whatever>."
// Captures any dirge — Dirge of Carnage is the iconic PvP one, but Dirge of the
// Restless / Sleepwalker etc. count too. Powers /fun's dirge counter ("killed
// a whole guild with N dirges"). Bystander-side fires on every agent in zone,
// so the bot's (guild_id, event_type, caster, event_ts) dedup collapses the
// duplicates back to one row per cast.
const DIRGE_SELF_RX  = /^\[(.+?)\]\s+You\s+begin\s+singing\s+(Dirge\s+of\s+[^.]+)\.?\s*$/i;
const DIRGE_OTHER_RX = /^\[(.+?)\]\s+(\w[\w'`]*)\s+begins\s+singing\s+(Dirge\s+of\s+[^.]+)\.?\s*$/i;
function parseDirgeCast(line, selfName) {
  let m = DIRGE_SELF_RX.exec(line);
  let caster = null;
  let song = null;
  if (m) { caster = selfName; song = m[2].trim(); }
  else {
    m = DIRGE_OTHER_RX.exec(line);
    if (m) { caster = m[2]; song = m[3].trim(); }
  }
  if (!m || !caster) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:     'dirge_cast',
    caster,
    target:   song,                // store the dirge song name in `target` for analysis
    ts:       ts ? ts.toISOString() : new Date().toISOString(),
    raw_text: line.slice(0, 200),
  };
}

// ── Detector history (manifest of when each detector landed) ────────────────
// Drives the "your backfill is stale" UI. Each entry: the agent version that
// FIRST extracted that detector. When a file's recorded backfill version is
// older than ANY entry here, the UI surfaces a pulse on its ↻ Re-run button
// and a top-of-page banner counts how many files would benefit from a re-run.
//
// Add a row whenever you ship a new detector that mines historical log lines.
// Pure live-tail-only features (PvP ledger relays, encounter rollups already
// dedupped server-side, etc.) don't need entries — they're auto-applied on
// the next live event and re-running won't pull anything new.
//
// Format: { version: 'x.y.z', name: 'detector_id', label: 'Human-readable' }
const DETECTOR_HISTORY = [
  // v3.0.62 — bard Dirge of *.
  { version: '3.0.62', name: 'dirge_cast',           label: 'Dirge of * casts' },
  // The earlier detectors (Peopleslayer LD, Malthur provisions, Dragon Punch,
  // Feral Avatar, etc.) shipped before this manifest existed. They're left
  // out intentionally — a backfill from any 3.x version already covered them,
  // and adding them retroactively would mark every old file stale on first
  // run for no recoverable gain.
];

// Returns the detector entries that have shipped AFTER `priorVersion`. Pass
// null / undefined to get every detector (used for "you haven't backfilled at
// all" callers). A file recorded as v3.0.62 will report dirge_cast as already
// covered; an older one will see it as stale.
function detectorsStaleSince(priorVersion) {
  if (!priorVersion) return DETECTOR_HISTORY.slice();
  return DETECTOR_HISTORY.filter(d => isNewerVersion(d.version, priorVersion));
}

// ── 🐺 Feral Avatar cast — Beastlord epic 1.0 click ───────────────────────────
// Two forms — caster-side ("You begin casting…") only fires on the BL's own
// agent; bystander-side ("Fittir begins casting…") fires on any agent in
// zone. Both push the same fun_event so the bot's dedup (guild, event_type,
// caster, event_ts) collapses overlap. Collected silently — not yet surfaced
// on /fun (per the owner's "doesn't need to be revealed yet" note). Future
// metric: percentage of fights where the BL had this active during the kill.
const FERAL_AVATAR_SELF_RX  = /^\[(.+?)\]\s+You\s+begin\s+casting\s+Feral\s+Avatar\.?\s*$/i;
const FERAL_AVATAR_OTHER_RX = /^\[(.+?)\]\s+(\w[\w'`]*)\s+begins\s+casting\s+Feral\s+Avatar\.?\s*$/i;
function parseFeralAvatar(line, selfName) {
  let m = FERAL_AVATAR_SELF_RX.exec(line);
  let caster = null;
  if (m) caster = selfName;
  else {
    m = FERAL_AVATAR_OTHER_RX.exec(line);
    if (m) caster = m[2];
  }
  if (!m || !caster) return null;
  const ts = parseEqTimestamp(line);
  return {
    type:     'feral_avatar_cast',
    caster:   caster,
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
  inferClassFromAbility(character, 'harm touch');  // SK-exclusive
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
  inferClassFromAbility(character, 'lay on hands');  // Paladin-exclusive
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

function uploadPvpAssists(assists, { botUrl, token, dryRun }) {
  void botUrl; void token;
  if (!Array.isArray(assists) || assists.length === 0) return Promise.resolve();
  if (dryRun) {
    for (const a of assists)
      console.log(`[pvp-assist] ${a.assister} → ${a.victim} (killed by ${a.killer || '?'}${a.killer_is_npc ? ' [npc]' : ''}, ${a.gap_seconds}s gap)`);
    return Promise.resolve();
  }
  enqueueUpload('pvp_assists', { agent_version: AGENT_VERSION, assists });
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
      const headers = { 'User-Agent': `wolfpack-logsync/${AGENT_VERSION}` };
      // Forward the Mimic Discord-login session token when present so the bot
      // can resolve it and reply with the user's identity (display name +
      // officer flag) for the dashboard. The endpoint is unchanged for agents
      // without a session — it just returns the bare version manifest.
      if (_mimicSessionToken) headers['X-Wolfpack-Mimic-Session'] = _mimicSessionToken;
      const req = mod.request({
        method: 'GET',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname + u.search,
        headers,
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
            // Refresh the cached identity if the bot returned one. Bots without
            // the mimic-link route built in (older deploys) simply don't include
            // mimic_session, so the field stays as whatever Mimic last pushed.
            if (resp.mimic_session && typeof resp.mimic_session === 'object') {
              _mimicIdentity = resp.mimic_session;
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

// ── Spell catalog (name -> PQDI id + landing messages) ─────────────────────
// Fetched once at startup from the bot's /api/agent/spell-catalog endpoint and
// cached to disk so subsequent runs don't refetch unnecessarily. Powers:
//   (a) PQDI links on spell names rendered on the dashboard (resisted card,
//       inbound-spell-damage card, NPC-cast "named via resists" attribution)
//   (b) effect-text spell inference (matching the cast_on_you / cast_on_other
//       messages from logs to identify which spell landed) — wired in a
//       follow-up commit; the catalog itself ships first since it's the
//       prerequisite.
//
// In-memory shape:
//   _spellByNameLower:   Map<string, { id, name, you, other, fades }>
//   _spellCatalogMeta:   { fetchedAt, etag, count }
let _spellByNameLower = new Map();
let _spellCatalogMeta = null;
const SPELL_CATALOG_FILE = path.join(__dirname, 'logsync.spell-catalog.json');

// Item-clicky catalog — item name (lowercased) → { casttime, clickeffect,
// clicktype, clicklevel }. Lets the melody overlay use the ITEM's cast
// time instead of the underlying spell's when a player triggers a clicky
// (Robe of the Spring → 12s Skin like Nature, not the bare spell's 5s).
let _itemClickyByNameLower = new Map();
let _itemClickyMeta = null;
const ITEM_CLICKY_FILE = path.join(__dirname, 'logsync.item-clickies.json');

// Pending clicky cast — set when we see "Your <item> begins to glow."
// in the log. When Zeal label 134 transitions within CLICKY_WINDOW_MS,
// the resulting cast inherits the item's cast time. Cleared after use
// or after the window expires.
const CLICKY_WINDOW_MS = 3000;
const _pendingClickies = new Map();   // character → { itemName, castMs, atMs }

function _loadSpellCatalogFromDisk() {
  try {
    if (!fs.existsSync(SPELL_CATALOG_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SPELL_CATALOG_FILE, 'utf8'));
    if (!Array.isArray(raw.entries)) return;
    _spellByNameLower = new Map();
    for (const e of raw.entries) {
      if (e && e.name) _spellByNameLower.set(String(e.name).toLowerCase(), e);
    }
    _spellCatalogMeta = { fetchedAt: raw.fetched_at, etag: raw.etag || null, count: raw.entries.length };
    _rebuildBuffMatchers();
    console.log(`[spell-catalog] loaded ${raw.entries.length} spells from disk (cached ${raw.fetched_at || '?'})`);
  } catch (err) {
    console.warn('[spell-catalog] disk load failed:', err && err.message);
  }
}

function fetchSpellCatalog({ botUrl, token }) {
  if (!botUrl || !token) return Promise.resolve();
  const url = botUrl.replace(/\/encounter(\?.*)?$/, '/spell-catalog');
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    `wolfpack-logsync/${AGENT_VERSION}`,
      };
      if (_spellCatalogMeta && _spellCatalogMeta.etag) {
        headers['If-None-Match'] = _spellCatalogMeta.etag;
      }
      const req = mod.request({
        method: 'GET',
        hostname: u.hostname,
        port:     u.port,
        path:     u.pathname + u.search,
        headers,
        timeout:  30000,
      }, (res) => {
        // 304 Not Modified — disk cache is still current; nothing to do.
        if (res.statusCode === 304) { res.resume(); return resolve(); }
        if (res.statusCode !== 200) {
          res.resume();
          console.warn(`[spell-catalog] HTTP ${res.statusCode} from bot — keeping disk cache`);
          return resolve();
        }
        const etag = res.headers && res.headers.etag;
        const ctype = (res.headers && res.headers['content-type']) || '';
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          // Guard: an OLDER bot without the /api/agent/spell-catalog route
          // falls through to the health-check handler and returns "200 OK"
          // (plain text). Don't try to JSON.parse that — quietly note the
          // endpoint isn't live yet (the bot needs deploying) instead of
          // logging a confusing "Unexpected token 'O'" parse error.
          const looksJson = /json/i.test(ctype) || /^\s*[{[]/.test(body);
          if (!looksJson) {
            console.log('[spell-catalog] endpoint not available yet (bot pre-v2.7.3) — PQDI links disabled until the bot deploys');
            return resolve();
          }
          try {
            const data = JSON.parse(body);
            if (!Array.isArray(data.entries)) { resolve(); return; }
            _spellByNameLower = new Map();
            for (const e of data.entries) {
              if (e && e.name) _spellByNameLower.set(String(e.name).toLowerCase(), e);
            }
            _spellCatalogMeta = { fetchedAt: data.fetched_at, etag: etag || null, count: data.entries.length };
            _rebuildBuffMatchers();
            try {
              const out = { fetched_at: data.fetched_at, etag: etag || null, entries: data.entries };
              fs.writeFileSync(SPELL_CATALOG_FILE + '.tmp', JSON.stringify(out));
              fs.renameSync(SPELL_CATALOG_FILE + '.tmp', SPELL_CATALOG_FILE);
            } catch (e) { /* disk cache best-effort */ }
            console.log(`[spell-catalog] fetched ${data.entries.length} spells from bot`);
            scheduleRender();
          } catch (err) {
            console.warn('[spell-catalog] parse failed:', err && err.message);
          }
          resolve();
        });
      });
      req.on('error',   (err) => { console.warn('[spell-catalog] fetch error:', err && err.message); resolve(); });
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    } catch (err) { console.warn('[spell-catalog] setup error:', err && err.message); resolve(); }
  });
}

function _loadItemClickiesFromDisk() {
  try {
    if (!fs.existsSync(ITEM_CLICKY_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(ITEM_CLICKY_FILE, 'utf8'));
    if (!Array.isArray(raw.entries)) return;
    _itemClickyByNameLower = new Map();
    for (const e of raw.entries) {
      if (e && e.name) _itemClickyByNameLower.set(String(e.name).toLowerCase(), e);
    }
    _itemClickyMeta = { fetchedAt: raw.fetched_at, etag: raw.etag || null, count: raw.entries.length };
    console.log(`[item-clickies] loaded ${raw.entries.length} clicky items from disk (cached ${raw.fetched_at || '?'})`);
  } catch (err) {
    console.warn('[item-clickies] disk load failed:', err && err.message);
  }
}

function fetchItemClickies({ botUrl, token }) {
  if (!botUrl || !token) return Promise.resolve();
  const url = botUrl.replace(/\/encounter(\?.*)?$/, '/item-clickies');
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'User-Agent':    `wolfpack-logsync/${AGENT_VERSION}`,
      };
      if (_itemClickyMeta && _itemClickyMeta.etag) headers['If-None-Match'] = _itemClickyMeta.etag;
      const req = mod.request({
        method: 'GET', hostname: u.hostname, port: u.port,
        path: u.pathname + u.search, headers, timeout: 30000,
      }, (res) => {
        if (res.statusCode === 304) { res.resume(); return resolve(); }
        if (res.statusCode !== 200) {
          res.resume();
          // Older bots without the route fall through to the health check
          // (200 OK plain text). Don't spam warnings — just stop trying.
          return resolve();
        }
        const etag = res.headers && res.headers.etag;
        const ctype = (res.headers && res.headers['content-type']) || '';
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          const looksJson = /json/i.test(ctype) || /^\s*[{[]/.test(body);
          if (!looksJson) return resolve();
          try {
            const data = JSON.parse(body);
            if (!Array.isArray(data.entries)) { resolve(); return; }
            _itemClickyByNameLower = new Map();
            for (const e of data.entries) {
              if (e && e.name) _itemClickyByNameLower.set(String(e.name).toLowerCase(), e);
            }
            _itemClickyMeta = { fetchedAt: data.fetched_at, etag: etag || null, count: data.entries.length };
            try {
              const out = { fetched_at: data.fetched_at, etag: etag || null, entries: data.entries };
              fs.writeFileSync(ITEM_CLICKY_FILE + '.tmp', JSON.stringify(out));
              fs.renameSync(ITEM_CLICKY_FILE + '.tmp', ITEM_CLICKY_FILE);
            } catch (e) { /* disk cache best-effort */ }
            console.log(`[item-clickies] fetched ${data.entries.length} clicky items from bot`);
          } catch (err) { console.warn('[item-clickies] parse failed:', err && err.message); }
          resolve();
        });
      });
      req.on('error',   () => resolve());
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    } catch (err) { console.warn('[item-clickies] setup error:', err && err.message); resolve(); }
  });
}

// Returns the PQDI URL for a spell NAME (case-insensitive), or null if we
// don't have it in the catalog. Used by the dashboard renderer to turn spell
// names into clickable PQDI links.
function spellPqdiUrlForName(name) {
  if (!name || !_spellByNameLower.size) return null;
  const e = _spellByNameLower.get(String(name).toLowerCase().trim());
  return (e && e.id) ? `https://www.pqdi.cc/spell/${e.id}` : null;
}

// ── Buff-landing reverse matcher ────────────────────────────────────────────
// Fills in buff coverage for raiders NOT running the agent. When someone near a
// Mimic user gets a tracked buff, EQ logs the spell's `cast_on_other` message
// with the target's name prefixed, e.g.:
//   "Bonkur's eye gleams with the power of Aegolism."   (possessive form)
//   "Bonkur looks very tranquil."                        (space form)
// The catalog gives us each spell's `other` suffix; we build a reverse index
// suffix → spell(s) and, for each log line, peel the leading target name off
// and look the remainder up. We only index TRACKED BUFFS (keyword list mirrors
// web/lib/buffs.ts) so nukes/DoTs/debuffs never match — their names don't
// contain buff keywords. Reported casts go to the bot's /api/agent/buff_casts.
//
// Keyword list is the union of web/lib/buffs.ts category KEYWORDS + HP-slot
// keywords. Kept here (not imported) since the agent is a standalone single
// file; when a new buff surfaces in the web "Other" column, add it both places.
const _TRACKED_BUFF_KEYWORDS = [
  // hp
  'aegolism', 'symbol of', 'temperance', 'hand of conviction', 'blessing of',
  'brell', 'riotous health', 'inner fire', 'courage', 'daring', 'bravery',
  'valor', 'resolution', 'heroic bond', 'virtue', 'health', 'center', 'fortitude',
  // regen
  'regrowth', 'regenerat', 'chloroplast', 'replenish', 'pack regen',
  // mana
  'brilliance', 'iridescence', 'gift of brilliance',
  // manaRegen
  'clarity', 'koadic', 'endless intellect', 'breeze', 'clairvoyance',
  'gift of insight', 'gift of pure thought', 'auspice',
  // haste
  'haste', 'celerity', 'quickness', 'swift', 'speed of', 'augmentation',
  'alacrity', 'aanya', 'battle cry', 'warsong', 'verses of victory',
  // runSpeed
  'spirit of wolf', 'spirit of the wolf', 'flight of eagle', 'pack spirit',
  'selo', 'journeyman', 'run speed', 'spirit of the shrew',
  // attack
  'strength', 'avatar', 'ferocity', 'champion', 'primal', 'war march',
  'savage', 'brutal', 'might of', 'tumultuous', 'aggression', 'bull',
  'call of the predator', 'feral avatar', 'ancient: feral',
  // ds
  'thorn', 'thistle', 'shield of fire', 'shield of lava', 'bramblecoat',
  'damage shield', 'legacy of', 'shield of barbs',
  // resists
  'resist', 'endure', 'protection of', 'talisman of altuna', 'talisman of jasinth',
  'talisman of shadoo', 'circle of', 'aegis of bathezid', 'colossal', 'elemental',
  // hp slots (extra names not covered above)
  'protection of the glades', 'protection of the cabbage', 'talisman of wunshi',
  'khura', 'arch shielding',
];
function _isTrackedBuffName(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  return _TRACKED_BUFF_KEYWORDS.some(k => n.includes(k));
}

// EQEmu duration formulas that produce a TIMED buff (level-scaled or fixed).
// Formula 0 = instant/none, 50/51 = permanent (illusions/auras) — excluded so
// we don't index permanent-buff messages as countdowns.
function _isTimedDurationFormula(f) {
  const n = Number(f);
  return Number.isFinite(n) && n > 0 && n < 50;
}

// suffix(lower) → array of { id, name, dur, durf }. Multiple spells can share a
// landing message ("looks very tranquil." etc.); when that happens the parser
// reports the cast as ambiguous (spell_id 0) rather than guessing wrong.
let _buffLandingBySuffix = new Map();
function _rebuildBuffMatchers() {
  const m = new Map();
  for (const e of _spellByNameLower.values()) {
    if (!e || !e.other || !e.name) continue;
    if (!_isTrackedBuffName(e.name)) continue;
    if (!_isTimedDurationFormula(e.durf)) continue;
    const suffix = String(e.other).trim().toLowerCase();
    if (!suffix || suffix.length < 6) continue;   // too short → false positives
    const arr = m.get(suffix) || [];
    arr.push({ id: e.id, name: e.name, dur: e.dur, durf: e.durf });
    m.set(suffix, arr);
  }
  _buffLandingBySuffix = m;
  if (m.size) console.log(`[buff-landing] indexed ${m.size} tracked-buff landing messages`);
}

// EQ first names: a single capitalized word. Rejects "You", pets ("`s warder"),
// NPCs with spaces/digits, and the empty string.
function _looksLikePlayerName(s) {
  return /^[A-Z][a-zA-Z]{2,19}$/.test(s) && s !== 'You' && s !== 'Your';
}

// Parse one log line for a tracked-buff landing on another player. Returns
// { target, spell_id, spell_name, landing_text, dur_ticks, dur_formula,
//   cast_at, observer } or null. observer = the character whose log this came
// from (the bystander who witnessed the land).
function parseBuffLanding(line, observer) {
  if (!_buffLandingBySuffix.size) return null;
  const m = line.match(/^\[(.+?)\]\s+(.+)$/);
  if (!m) return null;
  const body = m[2];
  // Two ways the target name attaches to the message:
  //   possessive: "Bonkur's eye gleams..."  → suffix starts at "'s"
  //   space:      "Bonkur looks very..."     → suffix is everything after sp1
  const candidates = [];
  const apos = body.indexOf("'s");
  if (apos > 0) candidates.push([body.slice(0, apos), body.slice(apos)]);   // name, "'s ..."
  const sp = body.indexOf(' ');
  if (sp > 0) candidates.push([body.slice(0, sp), body.slice(sp + 1)]);     // name, "..."
  for (const [name, suffixRaw] of candidates) {
    if (!_looksLikePlayerName(name)) continue;
    const hits = _buffLandingBySuffix.get(suffixRaw.trim().toLowerCase());
    if (!hits || !hits.length) continue;
    const ts = parseEqTimestamp(line);
    // Collapse same-name duplicates (e.g. two SoW spell ids); only call it
    // ambiguous when genuinely different spells share the message.
    const names = new Set(hits.map(h => h.name));
    const resolved = names.size === 1 ? hits[0] : null;
    return {
      target:      name,
      spell_id:    resolved ? resolved.id : 0,
      spell_name:  resolved ? resolved.name : null,
      landing_text: suffixRaw.trim().slice(0, 200),
      dur_ticks:   resolved ? resolved.dur : null,
      dur_formula: resolved ? resolved.durf : null,
      cast_at:     ts ? ts.toISOString() : new Date().toISOString(),
      observer:    observer || null,
    };
  }
  return null;
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
                // tell_relay MUST be carried through — the tail loop gates tell
                // capture on stats.characterPrefs[char].tell_relay. Dropping it
                // here (as the original normalization did) left the gate
                // permanently falsy, so NO tells were ever captured even with
                // the web toggle on and the bot endpoint returning it.
                tell_relay:         !!(p && p.tell_relay),
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
  // {s} / {S} / {S2} / {c} → permissive name-like capture. The earlier form
  // ([^\s]+) refused ANY whitespace, so multi-word mob names ("Zov Va Dyn",
  // "Aten Ha Ra", "Lord Nagafen") never matched and triggers like Enrage
  // silently never fired. Allow word chars + space + apostrophe + hyphen,
  // lazy so the surrounding anchored context (^...$) still constrains the
  // match. The capture is NAMED — first occurrence as `s`, second as `s1`,
  // etc. — so (a) action templates like "ENRAGE - {s}" interpolate the
  // captured mob name and (b) the live evaluator can audit the match against
  // our charm-pet tracker to suppress triggers firing on our own pet.
  let sIdx = 0;
  p = p.replace(/\{[sScC]\d*\}/g, () => {
    const name = sIdx === 0 ? 's' : `s${sIdx}`;
    sIdx++;
    return `(?<${name}>[\\w' -]+?)`;
  });
  return p;
}
// True when the captured {s}-style name matches a currently active charm pet.
// Live triggers using `{s} yawns.`, `{s} slows down.`, `{s} has become ENRAGED.`
// etc. otherwise false-fire when our OWN charm pet gets slowed/enraged. The
// tracker stores keys lowercased; we just need to look up.
function _captureMatchesCharmPet(captures) {
  if (!captures || typeof captures !== 'object') return false;
  for (const k of Object.keys(captures)) {
    if (!/^s\d*$/.test(k)) continue;          // {s} family only
    const v = captures[k];
    if (!v) continue;
    const key = String(v).trim().toLowerCase();
    if (!key) continue;
    const info = _charmTickTracker.get(key);
    if (info && info.is_active) return true;
  }
  return false;
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
                  compiled.push({ ...t, _regex: new RegExp(pat, flags), _endRegex: _compileEndEarlyRegex(t), _scope: 'guild' });
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
    // personal_triggers.json lives next to the agent's other state files
    // (logsync.stats.json etc.) — i.e. the agent dir. STATS_FILE is the
    // canonical anchor for that directory. (Earlier code referenced an
    // undefined `_statsPath`, which threw ReferenceError on every load.)
    const dir = path.dirname(STATS_FILE || '');
    if (!dir) return;
    const p = path.join(dir, 'personal_triggers.json');
    if (!fs.existsSync(p)) return;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.triggers) ? raw.triggers : []);
    const compiled = [];
    for (const t of arr) {
      try {
        // Reuse the shared compile path so pure-Zeal triggers (no pattern)
        // load with _regex=null instead of a match-everything regex.
        compiled.push(_compilePersonalTrigger(t));
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

// Persist personal triggers to disk. Stripping the compiled _regex (a RegExp
// object) before serialize since it can't round-trip through JSON. Atomic
// write via .tmp + rename so a crash mid-write doesn't corrupt the file.
function savePersonalTriggers() {
  try {
    const dir = path.dirname(STATS_FILE || '');
    if (!dir) return false;
    const p = path.join(dir, 'personal_triggers.json');
    const arr = _personalTriggers.map(t => {
      const { _regex, _endRegex, _scope, ...rest } = t;
      void _regex; void _endRegex; void _scope;
      return rest;
    });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ triggers: arr }, null, 2));
    fs.renameSync(tmp, p);
    return true;
  } catch (err) {
    console.warn('[personal-triggers] save failed:', err.message);
    return false;
  }
}

// Serialize for /api/personal-triggers — strip non-JSONable internals plus
// the precompiled _regex object. Add a `valid` boolean so the dashboard can
// flag rows whose pattern won't compile.
function _serializePersonalTriggers() {
  return _personalTriggers.map(t => {
    const { _regex, _scope, ...rest } = t;
    void _scope;
    return { ...rest, valid: !!_regex };
  });
}

// Compile a single trigger object (validate + attach _regex). Returns the
// compiled trigger or throws — the caller decides whether to keep on failure.
function _compilePersonalTrigger(t) {
  // Pure-Zeal triggers (gauge condition, no log pattern) get NO text _regex —
  // an empty pattern would compile to a match-everything regex and fire on
  // every log line. The text evaluator skips triggers without _regex; the
  // zeal evaluator picks them up via zeal_condition.
  let regex = null;
  if (t.pattern && String(t.pattern).trim()) {
    const flags = t.pattern_flags || 'i';
    const pat = t.use_regex === false
      ? _escapeForLiteralMatch(t.pattern)
      : _translateDotNetRegex(t.pattern);
    regex = new RegExp(pat, flags);
  }
  return { ...t, _regex: regex, _endRegex: _compileEndEarlyRegex(t), _scope: 'personal' };
}

// Compile end_early_pattern on a trigger so the live evaluator can cancel
// an active timer when the "end-early" line shows up before the timer
// expires (e.g. "Rampage on you!" timer cancelled when the mob dies).
// Returns null if the trigger has no end-early pattern OR the pattern is
// invalid — a bad end-early shouldn't prevent the main trigger from
// loading.
function _compileEndEarlyRegex(t) {
  if (!t || !t.end_early_pattern || !String(t.end_early_pattern).trim()) return null;
  try {
    const flags = t.pattern_flags || 'i';
    const pat = t.end_use_regex === false
      ? _escapeForLiteralMatch(t.end_early_pattern)
      : _translateDotNetRegex(t.end_early_pattern);
    return new RegExp(pat, flags);
  } catch (err) {
    console.warn('[triggers] bad end_early_pattern on "' + (t.name || '?') + '":', err.message);
    return null;
  }
}

// ── Suggested triggers catalog ─────────────────────────────────────────────
// One-click trigger templates so a new bard / cleric / etc. can wire up the
// alerts they actually want without writing regex. Each entry is a fully-
// formed personal-trigger row except for the volatile fields (enabled, tts).
// The dashboard reads this list via GET /api/triggers/suggested, marks each
// entry's state (enabled / tts) based on the matching personal trigger if
// it exists (matched by the synthetic id "suggested:<template_id>"), and
// flips toggles via POST /api/triggers/suggested.
//
// Categories: 'buff' / 'debuff' / 'mob' / 'self' / 'utility'. These drive
// the dashboard's visual grouping; the agent doesn't care about them.
//
// Pattern conventions: case-insensitive (the default i flag), GINA-style
// {S1}/{S2}/etc captures are NOT used here — these templates are first-
// person ("you are…") so there's no name to extract. Adding cooldown_seconds
// where the trigger could otherwise spam (resists fire every tick).
const SUGGESTED_TRIGGERS = [
  // ── Buff drops on YOU — the most-requested alert class. The pattern matches
  //    the EQ "Your <buff> spell has worn off." line; we cover common Clarity /
  //    KEI / Aego / POTG / Symbol / Virtue lines individually so each shows
  //    a category-specific overlay text.
  { id: 'buff_clarity_drop', category: 'buff', label: 'Clarity / C2 / VoQ dropped',
    pattern: '^Your (?:Clarity(?: II)?|Voice of Quellious|Gift of (?:Insight|Brilliance)|Koadic\'s Endless Intellect) (?:spell )?has worn off\\.',
    overlay_text: 'CLARITY DROPPED', overlay_color: 'cyan',  overlay_ms: 5000,
    tts_default: true,  cooldown_seconds: 3 },
  { id: 'buff_aego_drop', category: 'buff', label: 'Aego / Virtue / Symbol dropped',
    pattern: '^Your (?:Aegolism|Virtue|Symbol of (?:Marzin|Ryltan|Naltron|Tnarg|Pinzarn|Transal)|Hand of Virtue|Conviction|Blessing of Aegolism) (?:spell )?has worn off\\.',
    overlay_text: 'AEGO/SYMBOL DROPPED', overlay_color: 'cyan', overlay_ms: 5000,
    tts_default: true,  cooldown_seconds: 3 },
  { id: 'buff_potg_drop', category: 'buff', label: 'POTG / POTC dropped',
    pattern: '^Your (?:Protection of the (?:Glades|Cabbage|Nine)|Pack Regen) (?:spell )?has worn off\\.',
    overlay_text: 'POTG DROPPED', overlay_color: 'cyan', overlay_ms: 5000,
    tts_default: true,  cooldown_seconds: 3 },
  { id: 'buff_haste_drop', category: 'buff', label: 'Haste dropped',
    pattern: '^Your (?:Augment(?:ation)?(?: of Death)?|Aanya\'s Quickening|Celerity|Quickness|Swift Like the Wind) (?:spell )?has worn off\\.',
    overlay_text: 'HASTE DROPPED', overlay_color: 'cyan', overlay_ms: 5000,
    tts_default: false, cooldown_seconds: 3 },
  { id: 'buff_dmg_shield_drop', category: 'buff', label: 'Damage shield dropped',
    pattern: '^Your (?:Shield of (?:Thorns|Spikes|Blades|Brambles|the Eighth|the Magi|the Pellarus)|Thorny Shield|Thistlecoat|Bramblecoat|Spikecoat|Legacy of Spike) (?:spell )?has worn off\\.',
    overlay_text: 'DAMAGE SHIELD DROPPED', overlay_color: 'cyan', overlay_ms: 4000,
    tts_default: false, cooldown_seconds: 3 },

  // ── Debuffs landing ON you — actionable: cure, run, recast.
  { id: 'self_snared', category: 'self', label: 'You are snared / rooted',
    pattern: '^You have been (?:ensnared|rooted|bound)\\.',
    overlay_text: 'SNARED / ROOTED', overlay_color: 'yellow', overlay_ms: 3000,
    tts_default: true,  cooldown_seconds: 5 },
  { id: 'self_mezzed', category: 'self', label: 'You are mezzed / charmed',
    pattern: '^You feel (?:calm|charmed)\\.',
    overlay_text: 'MEZZED!', overlay_color: 'red', overlay_ms: 4000,
    tts_default: true,  cooldown_seconds: 5 },
  { id: 'self_feared', category: 'self', label: 'You are feared',
    pattern: '^You are afraid\\.',
    overlay_text: 'FEARED!', overlay_color: 'red', overlay_ms: 4000,
    tts_default: true,  cooldown_seconds: 5 },
  { id: 'self_stunned', category: 'self', label: 'You are stunned',
    pattern: '^You can\'t (?:move|cast spells|do anything while stunned)!',
    overlay_text: 'STUNNED', overlay_color: 'yellow', overlay_ms: 2500,
    tts_default: false, cooldown_seconds: 5 },

  // ── Mob threats — bystander-visible boss callouts.
  { id: 'mob_rampage', category: 'mob', label: 'Rampage on you',
    pattern: '\\brampages?\\s+on\\s+(?:you|YOU)\\b',
    overlay_text: 'RAMPAGE ON YOU', overlay_color: 'red', overlay_ms: 4000,
    tts_default: true,  cooldown_seconds: 2 },
  { id: 'mob_enraged', category: 'mob', label: 'Mob is enraged',
    pattern: '\\bbegins to enrage\\b',
    overlay_text: 'ENRAGED — STOP DPS', overlay_color: 'red', overlay_ms: 5000,
    tts_default: true,  cooldown_seconds: 5 },
  { id: 'mob_fbss_dispel', category: 'mob', label: 'You were dispelled',
    pattern: '^Your (?:enchantments|magic|spells) (?:fade|wither|wear off)\\b',
    overlay_text: 'DISPELLED', overlay_color: 'yellow', overlay_ms: 4000,
    tts_default: true,  cooldown_seconds: 3 },

  // ── Cast feedback — fast-paced raids need quick "did it land?" answers.
  { id: 'cast_resisted_self', category: 'debuff', label: 'Your spell was resisted',
    pattern: '^Your target resisted the (.+?) spell\\.',
    overlay_text: 'RESISTED: {1}', overlay_color: 'yellow', overlay_ms: 3000,
    tts_default: false, cooldown_seconds: 1 },
  { id: 'cast_interrupted', category: 'self', label: 'Your cast was interrupted',
    pattern: '^Your (?:spell|target) (?:was )?interrupted',
    overlay_text: 'INTERRUPTED', overlay_color: 'yellow', overlay_ms: 2500,
    tts_default: false, cooldown_seconds: 1 },
  { id: 'cast_fizzle', category: 'self', label: 'Spell fizzle',
    pattern: '^You miss the gem|^Your spell fizzles!',
    overlay_text: 'FIZZLE', overlay_color: 'yellow', overlay_ms: 2000,
    tts_default: false, cooldown_seconds: 1 },

  // ── Utility — useful but not-every-class triggers.
  { id: 'low_mana_warn', category: 'utility', label: 'Low on mana (≤20%)',
    pattern: '',
    zeal_condition: { field: 'self_mana_pct', op: '<=', value: 20 },
    overlay_text: 'LOW MANA', overlay_color: 'yellow', overlay_ms: 3000,
    tts_default: false, cooldown_seconds: 30 },
  { id: 'low_hp_warn', category: 'utility', label: 'Low on HP (≤30%)',
    pattern: '',
    zeal_condition: { field: 'self_hp_pct', op: '<=', value: 30 },
    overlay_text: 'LOW HP', overlay_color: 'red', overlay_ms: 3000,
    tts_default: true,  cooldown_seconds: 15 },
];

// Convert a SUGGESTED_TRIGGERS template into a personal-trigger row (the
// shape /api/personal-triggers stores). The synthetic id "suggested:<id>"
// is the round-trip handle the dashboard uses to find + toggle the saved
// trigger; once enabled, the row is indistinguishable from any other
// personal trigger except for its prefixed id, so the user can still edit
// the pattern / overlay text by hand on the Personal panel if they want.
function _templateToPersonalRow(tpl, opts) {
  const o = opts || {};
  const wantTts = o.tts != null ? !!o.tts : !!tpl.tts_default;
  const action = {
    type: 'text_overlay',
    text: tpl.overlay_text,
    color: tpl.overlay_color || 'red',
    duration_ms: tpl.overlay_ms || 4000,
  };
  if (wantTts) action.tts = tpl.overlay_text;
  return {
    id:            'suggested:' + tpl.id,
    name:          tpl.label,
    pattern:       tpl.pattern || '',
    pattern_flags: 'i',
    use_regex:     true,
    enabled:       true,
    cooldown_seconds:  tpl.cooldown_seconds || 0,
    timer_duration_sec: 0,
    end_early_pattern:  null,
    end_use_regex:      true,
    zeal_condition:     tpl.zeal_condition || null,
    actions:            [action],
  };
}
// Look up the saved personal trigger matching a suggested template's id.
// Returns the trigger or null. Used by the GET endpoint to surface the
// current enabled / tts state of each template.
function _findSuggestedRow(templateId) {
  const wantId = 'suggested:' + templateId;
  return _personalTriggers.find(t => t && t.id === wantId) || null;
}
// Has TTS for the matching personal trigger? True iff the first text_overlay
// action carries a non-empty `tts` field.
function _suggestedHasTts(row) {
  if (!row || !Array.isArray(row.actions)) return false;
  const a = row.actions.find(x => x && x.type === 'text_overlay');
  return !!(a && a.tts);
}

// ── GINA / EQLogParser trigger XML import ─────────────────────────────────
// Both tools share the SharedTriggers XML shape — GINA's <Trigger> nodes
// carry the same field names EQLogParser writes when exporting to .gtp
// (GINA Trigger Package). We extract a flat list of {name, pattern, ...}
// objects via regex; the agent compiles each via _compilePersonalTrigger
// and appends to _personalTriggers.
//
// Field mapping (GINA → ours):
//   <Name>             → name
//   <TriggerText>      → pattern
//   <EnableRegex>      → use_regex
//   <DisplayText>      → action.text (preferred)
//   <TextToVoiceText>  → action.text (fallback when DisplayText empty)
//
// HTML-entity decoding is intentionally minimal — only the five XML
// predefined entities. Triggers rarely contain anything else, and a heavier
// decoder would pull in unnecessary surface area for a localhost endpoint.
function _decodeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'');
}
function _parseTriggerXml(xml) {
  const triggers = [];
  // Match each <Trigger>...</Trigger> block. GINA top-level is
  // <SharedTriggers><Triggers><Trigger>...; EQLogParser shares the inner
  // <Trigger> envelope. NB: there's ALSO a top-level <TriggerNode> shape
  // EQLP uses for folder trees; we ignore the folders and target the leaf
  // <Trigger> elements either way.
  const triggerRx = /<Trigger>([\s\S]*?)<\/Trigger>/gi;
  let m;
  while ((m = triggerRx.exec(xml)) !== null) {
    const body = m[1];
    const get = (tag) => {
      const r = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
      const mm = r.exec(body);
      return mm ? _decodeXmlEntities(mm[1].trim()) : '';
    };
    const name        = get('Name');
    const pattern     = get('TriggerText');
    const enableRegex = get('EnableRegex').toLowerCase() === 'true';
    const displayText = get('DisplayText');
    const ttsText     = get('TextToVoiceText');
    // GINA's TimerDuration is in seconds; we don't yet wire timer triggers,
    // but parse the cooldown if present so we don't lose the field.
    const cooldownRaw = get('TimerDuration');
    const cooldown    = parseInt(cooldownRaw, 10) || 0;
    if (!name || !pattern) continue;
    triggers.push({
      name,
      pattern,
      use_regex:        enableRegex,
      display_text:     displayText,
      tts_text:         ttsText,
      cooldown_seconds: cooldown,
    });
  }
  return triggers;
}

// EQLogParser's NATIVE export is NOT the SharedTriggers XML — it's a JSON tree
// (.tgf, often gzipped to .tgf.gz). Shape: an array of folder nodes, each with
// a `Nodes` child array and an optional `TriggerData` object on leaf nodes.
// The trigger NAME lives on the node (`node.Name`); `TriggerData` carries the
// pattern + display/speak/timer fields. Walk the whole tree and flatten every
// leaf that has a TriggerData + pattern into the same shape _parseTriggerXml
// returns, so the import endpoint can treat XML and JSON identically.
function _parseTriggerTgfJson(text) {
  let root;
  try { root = JSON.parse(text); } catch { return null; }   // null = "not JSON, try XML"
  const out = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) visit(n); return; }
    const td = node.TriggerData;
    if (td && typeof td === 'object') {
      const name    = String(node.Name || '').trim();
      const pattern = String(td.Pattern || '').trim();
      if (name && pattern) {
        const dur = Number(td.DurationSeconds) || 0;
        // EQLP separates "is there a timer" (TimerType > 0 / EnableTimer) from
        // the duration. Treat any positive TimerType OR EnableTimer with a
        // duration as a countdown timer — the warning callout depends on it.
        const hasTimer = dur > 0 && (Number(td.TimerType) > 0 || td.EnableTimer === true);
        out.push({
          name,
          pattern,
          use_regex:          td.UseRegex !== false,
          display_text:       String(td.TextToDisplay || '').trim(),
          tts_text:           String(td.TextToSpeak || '').trim(),
          cooldown_seconds:   Math.max(0, parseInt(td.LockoutTime, 10) || 0),
          timer_duration_sec: hasTimer ? Math.round(dur) : 0,
          warning_seconds:    Math.max(0, parseInt(td.WarningSeconds, 10) || 0),
          warning_text:       String(td.WarningTextToSpeak || td.WarningTextToDisplay || '').trim(),
          end_text:           String(td.EndTextToSpeak || td.EndTextToDisplay || '').trim(),
          end_early_pattern:  String(td.EndEarlyPattern || '').trim(),
        });
      }
    }
    if (Array.isArray(node.Nodes)) for (const n of node.Nodes) visit(n);
  };
  visit(root);
  return out;
}

// GINA / EQLogParser capture placeholders → regex. Both tools write {S}/{s}
// (match-any text) and {N}/{n} (a number) into the pattern, with a trailing
// digit for a *named* capture you can reference in the alert text ({s1}, {n1}).
// We turn the numbered forms into .NET-style named groups (?<s1>…) — which our
// alert templates already reference as {s1} — and the bare forms into plain
// captures. Applied before _translateDotNetRegex compiles to JS.
function _translateGinaPlaceholders(pattern) {
  if (!pattern) return pattern;
  return String(pattern)
    .replace(/\{[sS](\d+)\}/g, '(?<s$1>.+?)')
    .replace(/\{[nN](\d+)\}/g, '(?<n$1>\\d+)')
    .replace(/\{[sS]\}/g,      '(.+?)')
    .replace(/\{[nN]\}/g,      '(\\d+)');
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

// Rampage callouts — "who is on rampage". The agent already parses
// "<Boss> goes on a RAMPAGE against <Target>!" into a rampage event; this
// surfaces it on the trigger overlay (flash + TTS) so the raid hears who's
// taking the rampage. Deduped + rate-limited PER TARGET so a multi-hit
// rampage (or the same line seen across several boxed logs) doesn't
// machine-gun the TTS. Gated downstream by the user's "Trigger alerts (TTS)"
// toggle — the overlay only speaks recentTriggerFires when alerts are on.
//
// Each new target also rides the cross-Mimic fan-out relay so raiders whose
// own log missed the rampage line (zoning, partial capture) still hear the
// call. Receivers dedup against their own _localFireKeys map.
// Single-slot tracker for "who's currently being rampaged." User feedback:
// the previous per-target cooldown announced again every 6s on the SAME
// target, which read as a constant "New rampage: Hitya. New rampage: Hitya.
// New rampage: Hitya." Now we hold the current target in place and only
// announce when the SWITCHES — same target → silent. Idle reset after
// 60s of no rampage line so the next rampage on the same person counts
// as new.
let _rampageCurrentTarget = null;   // lowercased name of who's being rampaged
let _rampageLastSeenMs    = 0;      // wall-clock of the most recent rampage line
const RAMPAGE_IDLE_RESET_MS = 60000;
function _announceRampage(target, tsMs) {
  if (!target) return;
  const key = target.toLowerCase();
  const now = tsMs || Date.now();
  // Idle reset — if the previous rampage went quiet for 60s, the next
  // line (even on the same name) counts as a fresh rampage. Without this,
  // a re-pull or quick re-engage would never re-announce.
  if (_rampageLastSeenMs && (now - _rampageLastSeenMs) > RAMPAGE_IDLE_RESET_MS) {
    _rampageCurrentTarget = null;
  }
  _rampageLastSeenMs = now;
  // Same target as current rampage → suppress. The user already heard the
  // initial "New rampage: Hitya"; subsequent hits on Hitya are noise until
  // the boss switches.
  if (_rampageCurrentTarget === key) return;
  _rampageCurrentTarget = key;
  const displayText = '🔥 NEW RAMPAGE: ' + target;
  const ttsText     = 'New rampage: ' + target;
  _pushOverlay({
    text:    displayText,
    tts:     ttsText,
    trigger: 'rampage',
    scope:   'guild',
    firedAt: now,
    test:    false,
  });
  // Pipe the same callout to Discord (no-op unless an officer set
  // TRIGGER_BROADCAST_CHANNEL_ID on the bot). The bot dedups across every
  // raider's agent by the key, so the channel sees one line per rampage target.
  _broadcastTriggerToDiscord({
    name:    'rampage',
    message: '🔥 **NEW RAMPAGE**: ' + target,
    key:     'rampage:' + key,
    tsMs:    now,
    mode:    'post',
  });
  // Cross-Mimic fan-out — covers raiders whose log didn't capture this
  // rampage line. The synthetic trigger carries a text_overlay action
  // so receivers get the same visual + TTS as a locally-detected fire.
  // _markFireSeen is wired into _relayLocalFire's downstream check on
  // each receiver so a raider who detected AND received the fire
  // doesn't double-play.
  const fireKey = 'rampage:' + JSON.stringify({ target });
  _markFireSeen(fireKey, now);
  _relayLocalFire(
    { name: 'New Rampage', _scope: 'guild', timer_duration_sec: 0 },
    [{
      type:        'text_overlay',
      text:        displayText,
      tts:         ttsText,
      color:       'red',
      duration_ms: 5000,
    }],
    { target },
    now,
    fireKey,
  );
}

// ── Cross-Mimic trigger relay (fan-out) ────────────────────────────────────
// Each local guild-trigger fire is sent up to the bot via POST
// /api/agent/trigger-relay. Other Mimics poll GET /api/agent/recent-fires
// every ~1.5s, dedup by (trigger name + JSON captures) inside an 8s
// window, and run the same actions locally — catches the case where one
// raider's log saw the line and another's didn't (zoning, partial log
// capture, player-targeted lines like "Player X has been slain").
//
// Local fires AND received-relay fires both populate _localFireKeys so
// the same logical event doesn't double-play on a Mimic that detected
// AND received it.
const _localFireKeys = new Map();   // key → [tsMs, ...]
const FIRE_DEDUP_WINDOW_MS = 8_000;

function _markFireSeen(key, tsMs) {
  if (!key) return;
  const arr = _localFireKeys.get(key) || [];
  arr.push(tsMs || Date.now());
  // Keep last 4 fire timestamps per key — handles same-name triggers
  // firing in sequence (e.g., death touch every minute).
  if (arr.length > 4) arr.shift();
  _localFireKeys.set(key, arr);
  // Periodic GC so the map doesn't grow unbounded over a long session.
  if (_localFireKeys.size > 200) {
    const cutoff = Date.now() - FIRE_DEDUP_WINDOW_MS * 4;
    for (const [k, ts] of _localFireKeys) {
      if (Math.max(...ts) < cutoff) _localFireKeys.delete(k);
    }
  }
}

function _hasRecentFire(key, tsMs) {
  const arr = _localFireKeys.get(key);
  if (!arr) return false;
  const ref = tsMs || Date.now();
  for (const t of arr) {
    if (Math.abs(t - ref) <= FIRE_DEDUP_WINDOW_MS) return true;
  }
  return false;
}

// Local fire → enqueue for bot relay. Skip for personal triggers (those
// stay on the source machine — there's no value in fanning out a private
// alert). Test fires also skip relay.
function _relayLocalFire(t, actions, captures, tsMs, key) {
  if (!_isUploaderInstance) return;
  if (!t || t._scope === 'personal') return;
  // Strip discord/relay-only actions so receiving Mimics only run the
  // local-effect ones (text_overlay, voice marks, etc.). Discord-channel
  // posts are already handled by the originating agent via the existing
  // /api/agent/trigger endpoint.
  const localActions = (actions || []).filter(a => a && a.type !== 'discord');
  if (localActions.length === 0 && !(t.timer_duration_sec > 0)) return;
  enqueueUpload('trigger_relay', {
    agent_version: AGENT_VERSION,
    fires: [{
      name:                t.name || 'trigger',
      key:                 key || (t.name || 'trigger'),
      captures:            captures && typeof captures === 'object' ? captures : {},
      actions:             localActions,
      timer_duration_sec:  t.timer_duration_sec || 0,
      fired_at_ms:         tsMs || Date.now(),
    }],
  });
}

// Polling loop — pulls fires posted by OTHER agents, runs them locally as
// if the source line had been in our own log. Suppressed when api base
// is unset (no bot wired) or when no token is configured.
let _lastRelayFireId = 0;
let _relayPollerActive = false;
async function _pollRelayFires() {
  if (_relayPollerActive) return;
  const base = _getApiBase();
  const token = _getAgentToken();
  if (!base || !token) return;
  _relayPollerActive = true;
  try {
    const url = base.replace(/\/+$/, '') + '/recent-fires?since_id=' + _lastRelayFireId;
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data?.next_id === 'number') {
      _lastRelayFireId = Math.max(_lastRelayFireId, data.next_id);
    }
    for (const fire of (data?.fires || [])) {
      const fireKey = fire.key || fire.name || '';
      if (_hasRecentFire(fireKey, fire.fired_at_ms)) continue;
      _markFireSeen(fireKey, fire.fired_at_ms);
      _runRelayedFire(fire);
    }
  } catch (err) {
    // Silent — relay is best-effort and the poller retries next tick.
  } finally {
    _relayPollerActive = false;
  }
}

// Schedule periodic polling. 1.5s interval is fast enough that a 10s
// warning fan-out lands within 1-2s of the originating Mimic, slow
// enough to stay polite (a 60-raider guild = ~40 req/min total bot-side).
// .unref() so test harnesses (scripts/check-agent-dashboard.js) can
// exit cleanly — the live agent has its own foreground keep-alives.
setInterval(_pollRelayFires, 1500).unref();

// Execute a relayed fire — runs the same shape as a local detection,
// but with _isRelay=true so the receiving Mimic doesn't re-relay it.
function _runRelayedFire(fire) {
  if (!fire || !Array.isArray(fire.actions)) return;
  // Build a synthetic trigger-like object so the existing action handler
  // can process it. Marked _scope='guild_relay' so logs are
  // distinguishable from locally-detected fires.
  const trig = {
    name:               fire.name || 'relayed',
    actions:            fire.actions,
    timer_duration_sec: fire.timer_duration_sec || 0,
    _scope:             'guild_relay',
  };
  _fireTriggerActions(trig, fire.captures || {}, fire.fired_at_ms || Date.now(), /*test=*/false, /*isRelay=*/true);
}

// Helpers for the relay endpoints. _queueUploadOpts is the canonical
// runtime config — populated by startUploadQueueDrain once the agent
// has resolved botUrl + token (from --bot-url / --token, env, or the
// Mimic device-link flow). Falling back to env vars catches the case
// where the queue hasn't started yet (rare for the polling loop, which
// only fires every 1.5s well after startup).
function _getApiBase() {
  const fromQueue = _queueUploadOpts && _queueUploadOpts.botUrl;
  const raw = fromQueue || process.env.WOLFPACK_BOT_URL || null;
  if (!raw) return null;
  // botUrl points at /api/agent/encounter — strip that to get the base.
  return raw.replace(/\/api\/agent\/encounter(\?.*)?$/, '/api/agent');
}
function _getAgentToken() {
  return (_queueUploadOpts && _queueUploadOpts.token) || process.env.WOLFPACK_AGENT_TOKEN || null;
}

// Enqueue a trigger fire for relay to a Discord channel via the bot's
// POST /api/agent/trigger. `mode` picks the surface:
//   • 'post'  — bot posts `message` to TRIGGER_BROADCAST_CHANNEL_ID (text).
//   • 'voice' — bot speaks `message` in RAID_VOICE_CHANNEL_ID via TTS.
// `key` dedups across every raider's agent (N raiders firing the same trigger
// collapse to one fire); test fires never reach here.
function _broadcastTriggerToDiscord({ name, message, key, tsMs, mode, voiceId }) {
  const text = String(message || '').trim();
  if (!text) return;
  const entry = {
    name:     name || 'trigger',
    mode:     mode === 'voice' ? 'voice' : 'post',
    message:  text.slice(0, 300),
    key:      key ? String(key).slice(0, 120) : null,
    fired_at: new Date(tsMs || Date.now()).toISOString(),
  };
  if (voiceId) entry.voice_id = String(voiceId).slice(0, 80);
  enqueueUpload('trigger', { agent_version: AGENT_VERSION, triggers: [entry] });
}

// Active timer countdowns driven by triggers with timer_duration_sec > 0.
// One entry per trigger id; a re-fire of the same trigger restarts the
// countdown rather than stacking another row (matches DnDOverlay-style
// behavior). Pruned of expired entries on every state-snapshot read so
// stale rows can't accumulate.
const _activeTimers = new Map();    // triggerId → { id, name, started_at_ms, ends_at_ms, duration_sec, color, end_text, scope, test }

// Zeal pipe capture state — fed by Mimic via POST /api/zeal-event. Tracks
// connection + a per-type tally + one sample object per type so the Triggers
// tab can show "is Zeal flowing, and what shapes are we seeing" without the
// user digging through the agent log. byType counts are cumulative for the
// session; lastSamples keeps the most recent object per type (truncated).
const _zeal = {
  connectedPids: [],
  total:         0,
  byType:        {},          // type → count
  lastSamples:   {},          // type → { at, obj }
  lastEventAt:   0,
  updatedAt:     0,
};
// Per-machine "pause Discord tells" deadline (ms epoch), set from the Mimic
// tray via POST /api/tells-dm-pause. Stamped onto tell uploads so the bot
// skips the Discord DM (but still stores the tell) while in the future.
let _tellsDmPauseUntil = 0;
// Mimic Discord-login session — Mimic POSTs the token to /api/mimic-session
// after the device-code dance completes. We forward it to the bot on every
// outbound request as X-Wolfpack-Mimic-Session so the bot can resolve it to
// {user_id, discord_id, is_officer} for attribution + officer affordances.
// `_mimicIdentity` is the bot's reply (cached on latest-version polls) so the
// dashboard can render "Signed in as <name>" without a separate round-trip.
let _mimicSessionToken = '';
let _mimicIdentity     = null;     // { user_id, discord_id, display_name, is_officer, role_names }
// Live Zeal state per running client (keyed by the pipe's `character`). Fed by
// Mimic via POST /api/zeal-state at a throttled cadence — a small snapshot, not
// the 225/sec raw event stream. Drives gauge-condition triggers (target HP %,
// self HP %, lowest group HP %). Shape per character:
//   { self_hp_pct, target_name, target_hp_pct, zone, autoattack,
//     group_min_hp_pct, group_min_name, updatedAt }
const _zealState = {};
// How long a character's live Zeal state may go without an update before we
// treat it as gone. A connected client streams gauge events continuously (HP
// bars tick out the pipe regardless of combat), so an active character refreshes
// sub-second; a relog (same eqgame PID, new `character`) or a disconnect simply
// stops updating and ages out. Generous enough to never flap on a live client.
const ZEAL_STALE_MS = 45_000;
// EQ zone_id → long name. Zeal's `player` event reports the numeric EQ zone id
// (e.g. 3, 161), not a name — so we resolve it here for human-readable display
// ("zone 3" → "Surefall Glade"). Sourced from eqemu_zone (Quarm catalog,
// Classic→PoP). Kept module-side (not in WEB_HTML) so the big literal never
// trips the dashboard escape check.
const ZONE_NAMES = {
  1:'South Qeynos',2:'North Qeynos',3:'Surefall Glade',4:'Qeynos Hills',5:'Highpass Hold',6:'High Keep',8:'North Freeport',9:'West Freeport',10:'East Freeport',11:'Runnyeye',12:'Western Plains of Karana',13:'Northern Plains of Karana',14:'Southern Plains of Karana',15:'Eastern Plains of Karana',16:'Gorge of King Xorbb',17:'Blackburrow',18:'Lair of the Splitpaw',19:'Rivervale',20:'Kithicor Forest',21:'West Commonlands',22:'East Commonlands',23:'Erudin Palace',24:'Erudin',25:'Nektulos Forest',26:'Sunset Home',27:'Lavastorm Mountains',28:'Nektropos',29:'Halas',30:'Everfrost Peaks',31:"Solusek's Eye",32:"Nagafen's Lair",33:'Misty Thicket',34:'Northern Desert of Ro',35:'Southern Desert of Ro',36:'Befallen',37:'Oasis of Marr',38:'Toxxulia Forest',39:'The Hole',40:'Neriak - Foreign Quarter',41:'Neriak - Commons',42:'Neriak - 3rd Gate',43:'Neriak Palace',44:'Najena',45:'Qeynos Aqueduct System',46:'Innothule Swamp',47:'The Feerrott',48:'Accursed Temple of Cazic Thule',49:'Oggok',50:'Rathe Mountains',51:'Lake Rathetear',52:'Grobb',53:'Aviak Village',54:'Greater Faydark',55:"Ak'Anon",56:'Steamfont Mountains',57:'Lesser Faydark',58:'Crushbone',59:'Castle of Mistmoore',60:'South Kaladim',61:'Northern Felwithe',62:'Southern Felwithe',63:'The Estate of Unrest',64:'Kedge Keep',65:'Guk',66:'Ruins of Old Guk',67:'North Kaladim',68:'Butcherblock Mountains',69:'Ocean of Tears',70:"Dagnor's Cauldron",71:'Plane of Sky',72:'Plane of Fear',73:'Permafrost Caverns',74:'Kerra Isle',75:'Paineel',76:'Plane of Hate',77:'The Arena',78:'Field of Bone',79:'Warsliks Woods',80:'Temple of Solusek Ro',81:'Mines of Droga',82:'Cabilis West',83:'Swamp of No Hope',84:'Firiona Vie',85:'Lake of Ill Omen',86:'The Dreadlands',87:'The Burning Wood',88:'Kaesora',89:'Ruins of Sebilis',90:'The City of Mist',91:'Skyfire Mountains',92:'Frontier Mountains',93:'The Overthere',94:'The Emerald Jungle',95:"Trakanon's Teeth",96:'Timorous Deep',97:"Kurn's Tower",98:"Erud's Crossing",100:'Stonebrunt Mountains',101:'The Warrens',102:"Karnor's Castle",103:'Chardok',104:'The Crypt of Dalnir',105:'The Howling Stones',106:'Cabilis East',107:'Mines of Nurga',108:"Veeshan's Peak",109:'Veksar',110:'Iceclad Ocean',111:'Tower of Frozen Shadow',112:"Velketor's Labyrinth",113:'Kael Drakkel',114:'Skyshrine',115:'The City of Thurgadin',116:'Eastern Wastes',117:'Cobaltscar',118:'The Great Divide',119:'The Wakening Land',120:'Western Wastes',121:'Crystal Caverns',123:'Dragon Necropolis',124:'Temple of Veeshan',125:"Siren's Grotto",126:'Plane of Mischief',127:'Plane of Growth',128:"Sleeper's Tomb",129:'Icewell Keep',130:'Marauders Mire',150:'Shadow Haven',151:'The Bazaar',152:'Nexus',153:'Echo Caverns',154:'Acrylia Caverns',155:'The City of Shar Vahl',156:'The Paludal Caverns',157:'The Fungus Grove',158:'Vex Thal',159:'Sanctus Seru',160:'Katta Castellum',161:'Netherbian Lair',162:'Ssraeshza Temple',163:"Grieg's End",164:'The Deep',165:"Shadeweaver's Thicket",166:'Hollowshade Moor',167:'Grimling Forest',168:'Marus Seru',169:'Mons Letalis',170:'Twilight',171:'The Grey',172:'The Tenebrous Mountains',173:"The Maiden's Eye",174:'The Dawnshroud Peaks',175:'Scarlet Desert',176:'The Umbral Plains',179:'Akheva Ruins',180:'The Arena Two',181:'Jaggedpine Forest',183:'EverQuest Tutorial',200:'The Crypt of Decay',201:'Plane of Justice',202:'Plane of Knowledge',203:'Plane of Tranquility',204:'Plane of Nightmares',205:'Plane of Disease',206:'Plane of Innovation',207:'Torment, the Plane of Pain',208:'Plane of Valor',209:'Bastion of Thunder',210:'Plane of Storms',211:'Halls of Honor',212:'Tower of Solusek Ro',213:'Plane of War',214:'Drunder, the Fortress of Zek',215:'Plane of Air',216:'Plane of Water',217:'Plane of Fire',218:'Plane of Earth',219:'Plane of Time',220:'Temple of Marr',221:'The Lair of Terris Thule',1039:'The Hole (Instanced)',1048:'Lost Temple of CazicThule',1071:'Plane of Sky (Instanced)',1072:'Plane of Fear (Instanced)',1076:'Plane of Hate (Instanced)',1078:'Field of Bone (Alt)',1097:"Kurn's Tower (Alternate)",
};
function _zoneName(id) {
  if (id == null) return null;
  const n = Number(id);
  return ZONE_NAMES[n] || null;
}
// Live pet (Zeal gauge slot 16) keyed by lowercase character = the pet's owner.
// Only the local uploader's own character streams gauges, so this resolves the
// uploader's pet HP/name — used by both _serializeZealForWeb (Buffs & Zone pet
// line) and the /api/state charmPets array (charm overlay). Read at call time,
// so it's safe to invoke from the request handler defined earlier in the file.
function _livePetHpByOwner() {
  const out = new Map();
  for (const ch of Object.keys(_zealState)) {
    const st = _zealState[ch];
    if (!st || !Array.isArray(st.gauges)) continue;
    const pet = st.gauges.find(g => g && g.slot === 16 && g.text);
    if (pet) out.set(String(ch).toLowerCase(), { name: pet.text, hp_pct: pet.hp_pct });
  }
  return out;
}

// ── Mob Info (target NPC stats) for the Mimic overlay ────────────────────────
// The agent's current Zeal target → eqemu_npc_types stats, fetched once per mob
// from the bot's /api/agent/mob-info and cached (static catalog data). Exposed
// on /api/state as `mobInfo` with the live target HP% layered on; the overlay
// renders HP / AC / resists / special attacks.
const _mobInfoByName  = new Map();   // normName → { at, mob|null }
const _mobInfoInflight = new Set();
const MOB_INFO_TTL_MS = 6 * 60 * 60 * 1000;
function _normMobNameAgent(n) {
  // Strip the "'s corpse" suffix so the Mob Info cache key matches the live
  // NPC row for a freshly-killed mob you're looting from. Without this,
  // Vyzh`dra's corpse normalizes to vyzh_dra_the_exiled_s_corpse and the
  // bot's catalog lookup never hits the actual npc_types row.
  return String(n || '').trim().toLowerCase()
    .replace(/'s\s+corpse$/, '')
    .replace(/[\s`'’]+/g, '_').replace(/^#/, '');
}
function fetchMobInfo(name) {
  const opts = _uploadOpts;
  if (!opts || !opts.botUrl || !opts.token) return;          // local-only → no lookup
  const norm = _normMobNameAgent(name);
  if (!norm || _mobInfoInflight.has(norm)) return;
  const cached = _mobInfoByName.get(norm);
  if (cached && (Date.now() - cached.at) < MOB_INFO_TTL_MS) return;
  _mobInfoInflight.add(norm);
  const url = opts.botUrl.replace(/\/encounter(\?.*)?$/, '/mob-info') + '?name=' + encodeURIComponent(name);
  try {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + opts.token, 'User-Agent': `wolfpack-logsync/${AGENT_VERSION}` },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        _mobInfoInflight.delete(norm);
        try { const j = JSON.parse(body); _mobInfoByName.set(norm, { at: Date.now(), mob: (j && j.mob) ? j.mob : null }); }
        catch { _mobInfoByName.set(norm, { at: Date.now(), mob: null }); }
      });
    });
    req.on('error',   () => { _mobInfoInflight.delete(norm); });
    req.on('timeout', () => { req.destroy(); _mobInfoInflight.delete(norm); });
    req.end();
  } catch { _mobInfoInflight.delete(norm); }
}
// Cast time (seconds) for a spell from the catalog (cast_ms). Default 4s when
// the catalog doesn't carry it — a "You begin casting" line implies a real cast.
function _spellCastSecs(name) {
  const e = _spellByNameLower.get(String(name || '').toLowerCase());
  const ms = (e && e.cast_ms != null) ? Number(e.cast_ms) : null;
  return (ms != null && ms >= 0) ? Math.round(ms / 100) / 10 : 4;
}
// Cross-client casts on the current target — fetched from the bot's relay with a
// short TTL so the Mob Info "Casting" section stays near-real-time without
// hammering the endpoint. Cached per normalized target name.
const _targetCastsByName  = new Map();   // nameLower → { at, casts }
const _targetCastsInflight = new Set();
const TARGET_CASTS_TTL_MS = 2000;
function fetchTargetCasts(name) {
  const opts = _uploadOpts;
  if (!opts || !opts.botUrl || !opts.token) return;
  const key = String(name || '').trim().toLowerCase();
  if (!key || _targetCastsInflight.has(key)) return;
  const cached = _targetCastsByName.get(key);
  if (cached && (Date.now() - cached.at) < TARGET_CASTS_TTL_MS) return;
  _targetCastsInflight.add(key);
  const url = opts.botUrl.replace(/\/encounter(\?.*)?$/, '/target-casts') + '?name=' + encodeURIComponent(name);
  try {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + opts.token, 'User-Agent': `wolfpack-logsync/${AGENT_VERSION}` },
      timeout: 6000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        _targetCastsInflight.delete(key);
        try { const j = JSON.parse(body); _targetCastsByName.set(key, { at: Date.now(), casts: (j && j.casts) || [] }); }
        catch { _targetCastsByName.set(key, { at: Date.now(), casts: [] }); }
      });
    });
    req.on('error',   () => { _targetCastsInflight.delete(key); });
    req.on('timeout', () => { req.destroy(); _targetCastsInflight.delete(key); });
    req.end();
  } catch { _targetCastsInflight.delete(key); }
}

// Cross-client target_buffs on the current target — pulled from buff_casts via
// the bot's /api/agent/target-buffs relay. Same shape as target_casts: short
// TTL, per-target cache, lazy-fetched from buildMobInfo. Lets us see e.g. who
// is charming the same mob we're targeting, and any tracked buff anyone has
// landed on it. Merged with the LOCAL _buffLandingsByTarget for display.
const _targetBuffsByName  = new Map();   // nameLower → { at, buffs }
const _targetBuffsInflight = new Set();
const TARGET_BUFFS_TTL_MS = 5000;
function fetchTargetBuffs(name) {
  const opts = _uploadOpts;
  if (!opts || !opts.botUrl || !opts.token) return;
  const key = String(name || '').trim().toLowerCase();
  if (!key || _targetBuffsInflight.has(key)) return;
  const cached = _targetBuffsByName.get(key);
  if (cached && (Date.now() - cached.at) < TARGET_BUFFS_TTL_MS) return;
  _targetBuffsInflight.add(key);
  const url = opts.botUrl.replace(/\/encounter(\?.*)?$/, '/target-buffs') + '?name=' + encodeURIComponent(name);
  try {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + opts.token, 'User-Agent': `wolfpack-logsync/${AGENT_VERSION}` },
      timeout: 6000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        _targetBuffsInflight.delete(key);
        try { const j = JSON.parse(body); _targetBuffsByName.set(key, { at: Date.now(), buffs: (j && j.buffs) || [] }); }
        catch { _targetBuffsByName.set(key, { at: Date.now(), buffs: [] }); }
      });
    });
    req.on('error',   () => { _targetBuffsInflight.delete(key); });
    req.on('timeout', () => { req.destroy(); _targetBuffsInflight.delete(key); });
    req.end();
  } catch { _targetBuffsInflight.delete(key); }
}

// Buff queue cache (per buffer-class). Mimic's buff-queue overlay polls the
// local agent which proxies to the bot's /api/agent/raid-buff-queue. The TTL is
// tuned so a roomful of Mimics doesn't hammer Supabase but the overlay still
// feels live (~3-5s between full refreshes).
const _buffQueueCache = new Map();   // classLower|character → { at, payload }
const _buffQueueInflight = new Set();
const BUFF_QUEUE_TTL_MS = 3000;
function fetchRaidBuffQueue(bufferClass, bufferCharacter) {
  const opts = _uploadOpts;
  if (!opts || !opts.botUrl || !opts.token) return;
  const key = String(bufferClass || '').trim().toLowerCase() + '|' + String(bufferCharacter || '').trim().toLowerCase();
  if (_buffQueueInflight.has(key)) return;
  const cached = _buffQueueCache.get(key);
  if (cached && (Date.now() - cached.at) < BUFF_QUEUE_TTL_MS) return;
  _buffQueueInflight.add(key);
  const qs = [];
  if (bufferClass)     qs.push('class=' + encodeURIComponent(bufferClass));
  if (bufferCharacter) qs.push('character=' + encodeURIComponent(bufferCharacter));
  const url = opts.botUrl.replace(/\/encounter(\?.*)?$/, '/raid-buff-queue') + (qs.length ? '?' + qs.join('&') : '');
  try {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Authorization': 'Bearer ' + opts.token, 'User-Agent': `wolfpack-logsync/${AGENT_VERSION}` },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        _buffQueueInflight.delete(key);
        try { const j = JSON.parse(body); _buffQueueCache.set(key, { at: Date.now(), payload: j }); }
        catch { _buffQueueCache.set(key, { at: Date.now(), payload: { buff_queue: [], debuff_queue: [] } }); }
      });
    });
    req.on('error',   () => { _buffQueueInflight.delete(key); });
    req.on('timeout', () => { req.destroy(); _buffQueueInflight.delete(key); });
    req.end();
  } catch { _buffQueueInflight.delete(key); }
}

// The freshest watched character's Zeal target (name + live HP%).
function _currentTargetState() {
  let best = null;
  // Staleness backstop: Zeal streams continuously while a character is
  // in-game, so an entry that hasn't updated in minutes belongs to a camped
  // character (or an old Mimic that doesn't send the explicit
  // `disconnected` retirement). Without the cutoff, Mob Info keeps showing
  // the camped character's last target after a character switch.
  const cutoff = Date.now() - 2 * 60_000;
  for (const ch of Object.keys(_zealState)) {
    const st = _zealState[ch];
    if (!st || !st.target_name) continue;
    if ((st.updatedAt || 0) < cutoff) continue;
    if (!best || (st.updatedAt || 0) > (best.updatedAt || 0)) best = st;
  }
  return best;
}
// Buffs for a target that is itself a watched (Mimic-running) character —
// taken straight from their live Zeal buff slots (authoritative: real remaining
// time). Returns null when the target isn't one of our characters, so the
// caller falls back to observed cast-landings. Zeal gives remaining ticks only
// (no original duration), so total_secs is null → the overlay shows the time
// without a proportional fill.
function _zealBuffsForName(nameLower) {
  for (const ch of Object.keys(_zealState)) {
    if (String(ch).toLowerCase() !== nameLower) continue;
    const st = _zealState[ch];
    const buffs = (st && Array.isArray(st.buffs)) ? st.buffs : [];
    return buffs.filter(b => b && b.name).map(b => ({
      name: b.name,
      remaining_secs: (typeof b.ticks === 'number' && b.ticks > 0) ? b.ticks * 6 : null,
      total_secs: null,
      observed_at_ms: Date.now(),
      source: 'zeal',
      good: _spellGood(b.name),
      // Short-duration song window (Zeal ids 135-140) vs the 15-slot buff
      // window — drives Mob Info's "Buffs n/15 · Songs m/6" header.
      song: !!b.song,
    }));
  }
  return null;
}
function buildMobInfo() {
  const st = _currentTargetState();
  if (!st || !st.target_name) return null;
  const norm = _normMobNameAgent(st.target_name);
  const cached = _mobInfoByName.get(norm);
  if (!cached || (Date.now() - cached.at) >= MOB_INFO_TTL_MS) fetchMobInfo(st.target_name);
  // Prefer authoritative Zeal buffs when the target is one of our own
  // characters (covers self + group members running Mimic — Mask of the
  // Stalker, Spirit of Wolf, etc., with real remaining time). Otherwise show
  // the buffs we observed landing on the target (mobs, other players).
  const tnameLower = String(st.target_name).toLowerCase();
  const zealBuffs = _zealBuffsForName(tnameLower);
  // Cross-client casting on this target (who's casting what on it, with a
  // countdown). Refresh on a short TTL; bystanders we can't name are absent.
  const ctc = _targetCastsByName.get(tnameLower);
  if (!ctc || (Date.now() - ctc.at) >= TARGET_CASTS_TTL_MS) fetchTargetCasts(st.target_name);
  // Cross-client target_buffs — fetched from the bot's relay so charm
  // spells (Allure, etc.) and other buff landings cast by OTHER Mimic
  // users on the same target show up here too. Merged with locally-
  // observed buffs by spell name (local wins — most accurate timer
  // when we saw it ourselves; remote fills the gap when we didn't).
  const ctb = _targetBuffsByName.get(tnameLower);
  if (!ctb || (Date.now() - ctb.at) >= TARGET_BUFFS_TTL_MS) fetchTargetBuffs(st.target_name);
  let buffs;
  if (zealBuffs !== null) {
    buffs = zealBuffs;
  } else {
    const local  = targetBuffsFor(tnameLower);
    const remote = (ctb && Array.isArray(ctb.buffs)) ? ctb.buffs : [];
    const seen = new Set(local.map(b => String(b.name || '').toLowerCase()));
    buffs = local.slice();
    for (const b of remote) {
      if (!b || !b.name) continue;
      const k = String(b.name).toLowerCase();
      if (seen.has(k)) continue;
      buffs.push(b);
      seen.add(k);
    }
  }
  // Slot occupancy for PC targets (authoritative via Zeal): the classic
  // buff window holds 15 buff/debuff slots, the song window 6. Null for
  // mobs/unwatched players — we only see observed landings for those.
  let slotCounts = null;
  if (zealBuffs !== null) {
    const songs = zealBuffs.filter(b => b.song).length;
    slotCounts = { buffs: zealBuffs.length - songs, buff_max: 15, songs, song_max: 6 };
  }
  return {
    target_name:    st.target_name,
    target_hp_pct:  st.target_hp_pct != null ? st.target_hp_pct : null,
    mob:            cached ? cached.mob : null,   // null until the lookup returns
    loading:        !cached,
    target_buffs:   buffs,
    target_is_pc:   zealBuffs !== null,
    target_slots:   slotCounts,
    target_casting: ctc ? ctc.casts : [],
  };
}

// ── Live character state → bot → Supabase (wolfpack.quest/me) ───────────────
// A SNAPSHOT sync, not a heartbeat: what each watched character is currently
// carrying (buffs) + their last-seen zone. Pushed only when something
// meaningful changes (zone, the set of buff names, or first sight of a live
// character) so it costs almost nothing at idle. Deliberately NOT routed
// through the durable upload queue — live state is replaceable (latest wins via
// the bot's upsert), so queuing stale snapshots during an outage would just
// waste calls and could evict real encounter uploads. Fire-and-forget; the next
// interval re-sends fresh if a send is dropped. The LOCAL dashboard stays the
// source of truth for second-by-second data; this is the "what did they log out
// with / where are they" view for the web.
const _liveStateLastSig = new Map();   // character → last-sent signature
function _postLiveState(targetUrl, token, payload) {
  let url;
  try { url = new URL(targetUrl); } catch { return; }
  const mod = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);
  const req = mod.request({
    method: 'POST', hostname: url.hostname, port: url.port,
    path: url.pathname + url.search,
    headers: {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      'User-Agent':     `wolfpack-logsync/${AGENT_VERSION}`,
    },
    timeout: 8000,
  }, (res) => { res.resume(); });
  req.on('error', () => {});                 // fire-and-forget
  req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}
function flushLiveStateToBot(opts) {
  if (!_isUploaderInstance) return;          // only the elected uploader sends
  if (!opts || !opts.botUrl) return;
  const base = opts.botUrl.replace(/\/encounter(\?.*)?$/, '');
  const url  = base + '/live-state';
  const now  = Date.now();
  const uploader = _primaryCharacter();
  const livePet  = _livePetHpByOwner();        // ownerLower → { name, hp_pct }
  const states = [];
  for (const ch of Object.keys(_zealState)) {
    const st = _zealState[ch];
    if (!st || (now - (st.updatedAt || 0)) > ZEAL_STALE_MS) continue;  // live chars only
    const buffs = Array.isArray(st.buffs) ? st.buffs : [];
    // Pet snapshot: name + HP from the live Zeal pet gauge, buffs from the
    // agent's pet-buff tracker (timed, persisted). Owners with no pet send null.
    const pet      = livePet.get(String(ch).toLowerCase()) || null;
    const petBuffs = pet ? petBuffsForOwner(String(ch).toLowerCase()) : [];
    const rec = {
      character:   ch,
      zone_id:     st.zone != null ? st.zone : null,
      zone_name:   _zoneName(st.zone),
      self_hp_pct: st.self_hp_pct != null ? st.self_hp_pct : null,
      buffs,
      buff_count:  buffs.length,
      pet_name:    pet ? pet.name : null,
      pet_hp_pct:  pet && pet.hp_pct != null ? pet.hp_pct : null,
      pet_buffs:   petBuffs.length ? petBuffs : null,
    };
    // Signature excludes HP% + buff ticks (which churn constantly) — we only
    // re-send on a zone change, a change to the SET of (own or pet) buff names,
    // the pet appearing/vanishing, or first sight of this character.
    const sig = JSON.stringify([
      rec.zone_id,
      buffs.map(b => b && b.name),
      rec.pet_name,
      petBuffs.map(b => b && b.name),
    ]);
    if (_liveStateLastSig.get(ch) === sig) continue;
    _liveStateLastSig.set(ch, sig);
    states.push(rec);
  }
  if (states.length === 0) return;
  _postLiveState(url, opts.token, { agent_version: AGENT_VERSION, uploaded_by: uploader || null, states });
}
// Serialize the Zeal status + live state for the dashboard, pruning anything
// attributable to a character who is no longer active. This is what fixes the
// "group is still on the previous character" report: a relog keeps the same
// pid, so the old character's frozen state + its leftover "latest sample" rows
// (especially the slow-firing group/member-list event) would otherwise linger
// forever. We keep only fresh per-character state, and drop sample rows whose
// owning character isn't currently active.
function _serializeZealForWeb() {
  const now = Date.now();
  const freshState = {};
  for (const ch of Object.keys(_zealState)) {
    const st = _zealState[ch];
    if (st && (now - (st.updatedAt || 0)) <= ZEAL_STALE_MS) freshState[ch] = st;
  }
  const activeChars = new Set(Object.keys(freshState).map(c => String(c).toLowerCase()));
  const samples = {};
  for (const type of Object.keys(_zeal.lastSamples || {})) {
    const sm = _zeal.lastSamples[type];
    if (!sm) continue;
    const ch = sm.obj && sm.obj.character;
    // A sample tagged with a character who's no longer active is a leftover from
    // a previous login — hide it so the card reflects who's actually playing.
    if (ch && !activeChars.has(String(ch).toLowerCase())) continue;
    samples[type] = sm;
  }
  // Persistent "buffs & zone" view: every character we've seen, most-recent
  // first, with the EQ zone resolved to a name and a `live` flag. Unlike the
  // pruned diagnostic above, this deliberately KEEPS logged-out characters so
  // you can see what each one logged out carrying + where they parked. Capped
  // so a long multibox session can't bloat the payload.
  //
  // Pet identification (Zeal): confirmed from a live charmed-pet gauge dump —
  // slot 1 = self, slot 6 = target, and **slot 16 = the pet** (charm or
  // summoned). We read slot 16 directly as the primary signal, so pet HP shows
  // up the instant the pet exists, for any pet, independent of the log-based
  // charm tracker. The charm-tracker cross-reference (match a gauge `text` to
  // the active charm pet name for this owner) stays as a fallback for any Zeal
  // build that happens to label the pet elsewhere.
  const petByOwner = new Map();   // lowercase owner → pet name (from charm tracker)
  for (const info of _charmTickTracker.values()) {
    if (info && info.is_active && info.owner && info.pet) {
      petByOwner.set(String(info.owner).toLowerCase(), info.pet);
    }
  }
  const clients = Object.keys(_zealState).map(ch => {
    const st = _zealState[ch] || {};
    const gauges = Array.isArray(st.gauges) ? st.gauges.slice(0, 20) : [];
    let petName = null, petHp = null, petSlot = null;
    // Primary: gauge slot 16 (require a name so an empty/fixed UI gauge never
    // masquerades as a pet).
    const petGauge = gauges.find(g => g && g.slot === 16 && g.text);
    if (petGauge) { petName = petGauge.text; petHp = petGauge.hp_pct; petSlot = 16; }
    // Fallback: cross-reference the charm tracker's known pet name.
    if (petHp == null) {
      const expected = petByOwner.get(String(ch).toLowerCase());
      if (expected && gauges.length) {
        const norm = String(expected).toLowerCase().trim();
        const hit  = gauges.find(g => g && g.text && String(g.text).toLowerCase().trim() === norm);
        if (hit) { petName = hit.text; petHp = hit.hp_pct; petSlot = hit.slot; }
      }
    }
    return {
      character:   ch,
      zone:        st.zone != null ? st.zone : null,
      zone_name:   _zoneName(st.zone),
      self_hp_pct: st.self_hp_pct != null ? st.self_hp_pct : null,
      autoattack:  !!st.autoattack,
      buffs:       Array.isArray(st.buffs) ? st.buffs : [],
      casting:     st.casting || null,
      gauges,
      pet_name:    petName,
      pet_hp_pct:  petHp,
      pet_slot:    petSlot,
      updatedAt:   st.updatedAt || 0,
      live:        (now - (st.updatedAt || 0)) <= ZEAL_STALE_MS,
    };
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 20);
  return {
    zeal:        { ..._zeal, lastSamples: samples },
    zealState:   freshState,
    zealClients: clients,
  };
}
// Edge-detection memory for zeal-condition triggers: key = triggerId|character
// → last boolean result. We fire only on a false→true transition so a
// condition that stays true (target sitting at 18% for 5s) doesn't re-fire
// every snapshot; cooldown_seconds still applies on top.
const _zealCondState = new Map();

// Resolve a zeal_condition field to a numeric value from a live state object.
// Returns { value, label } or null when the field isn't currently available
// (no target, no group, etc) so the condition simply doesn't evaluate.
function _zealFieldValue(state, field) {
  if (!state) return null;
  switch (field) {
    case 'target_hp_pct':
      if (state.target_hp_pct == null || !state.target_name) return null;
      return { value: state.target_hp_pct, label: state.target_name };
    case 'self_hp_pct':
      if (state.self_hp_pct == null) return null;
      return { value: state.self_hp_pct, label: 'you' };
    case 'group_min_hp_pct':
      if (state.group_min_hp_pct == null) return null;
      return { value: state.group_min_hp_pct, label: state.group_min_name || 'group' };
    default: return null;
  }
}
function _zealCompare(a, op, b) {
  switch (op) {
    case '<':  return a <  b;
    case '<=': return a <= b;
    case '>':  return a >  b;
    case '>=': return a >= b;
    case '==': return a === b;
    default:   return false;
  }
}

// Evaluate every trigger carrying a zeal_condition against one character's
// live state. Edge-triggered + cooldown-gated. Captures {target, value} are
// passed to the overlay template so "{target} at {value}%" works.
function _evaluateZealConditions(character, tsMs) {
  const state = _zealState[character];
  if (!state) return;
  const all = [..._personalTriggers, ...(stats.guildTriggers || [])];
  for (const t of all) {
    const cond = t.zeal_condition;
    if (!cond || !cond.field || !cond.op || cond.value == null) continue;
    const fv = _zealFieldValue(state, cond.field);
    const key = (t.id || t.name) + '|' + character;
    if (!fv) { _zealCondState.delete(key); continue; }      // field gone → re-arm
    const now = _zealCompare(fv.value, cond.op, Number(cond.value));
    const was = _zealCondState.get(key) || false;
    _zealCondState.set(key, now);
    if (now && !was) {                                       // false→true edge
      if (t.cooldown_seconds && t.cooldown_seconds > 0) {
        const last = _triggerLastFire.get(t.id || t.name) || 0;
        if (tsMs - last < t.cooldown_seconds * 1000) continue;
      }
      _triggerLastFire.set(t.id || t.name, tsMs);
      _fireTriggerActions(t, { target: fv.label, value: Math.round(fv.value), character }, tsMs, false);
    }
  }
}
function _startTimer(t, tsMs, isTest, captures) {
  if (!t || !(t.timer_duration_sec > 0)) return;
  // Per-CAPTURE keying — a trigger that fires twice on different mob names
  // ("Pacify on Lord Nagafen" then "Pacify on Vox") gets two independent
  // timer rows, not one whose countdown restarts. Same trigger firing on
  // the SAME captures restarts the existing row (DnDOverlay convention).
  // Captures are sorted by key so insert-order can't cause cache misses.
  const baseId = String(t.id || t.name || 'unknown');
  let captureSuffix = '';
  // "target" — the thing the timer is ABOUT (the boss the spell was cast on,
  // OR the boss currently being fought if no explicit target was captured).
  // Surfaces as the prefix in the overlay's GINA-style row: "Guardian wurm -
  // Cripple". When falling back to the current encounter boss, the row reads
  // exactly like a debuff tracker — boss on the left, effect on the right.
  let timerTarget = null;
  if (captures && typeof captures === 'object') {
    const keys = Object.keys(captures).sort();
    if (keys.length > 0) {
      captureSuffix = '|' + keys.map(k => k + '=' + String(captures[k])).join('|');
      timerTarget = captures.target || captures.npc || captures.mob || captures[keys[0]] || null;
    }
  }
  // Fallback: use the current encounter's boss name when the trigger pattern
  // didn't carry a target capture. Most boss-cast spells don't name the mob in
  // the log line ("Cripple lands on you"), so the bossName context is what
  // makes the timer label informative on the overlay.
  if (!timerTarget && stats.currentEncounterThreat && stats.currentEncounterThreat.bossName) {
    timerTarget = stats.currentEncounterThreat.bossName;
  }
  const id = baseId + captureSuffix;
  const startMs = tsMs || Date.now();
  const action = (Array.isArray(t.actions) && t.actions[0]) || {};
  _activeTimers.set(id, {
    id,
    // `name` keeps backward compatibility (older dashboards read it). The
    // overlay renderer prefers `target` + `effect` for the GINA-style row.
    name:           timerTarget ? (timerTarget + ' - ' + (t.name || 'timer')) : (t.name || 'timer'),
    target:         timerTarget || null,
    effect:         t.name || 'timer',
    started_at_ms:  startMs,
    ends_at_ms:     startMs + (t.timer_duration_sec * 1000),
    duration_sec:   t.timer_duration_sec,
    color:          action.color || 'red',
    end_text:       t.end_text || null,
    // Warning callout fired by the overlay N seconds before the timer ends
    // (EQLP WarningSeconds + WarningTextToSpeak — e.g. "RAGE SOON" 12s out).
    warn_ms:        (t.warning_seconds > 0 && t.warning_text) ? t.warning_seconds * 1000 : 0,
    warn_text:      t.warning_text || null,
    trigger_name:   t.name || null,   // used by end-early matching against the trigger group
    captures:       captures && typeof captures === 'object' ? { ...captures } : null,
    scope:          t._scope || 'unknown',
    test:           !!isTest,
  });
}
function _cancelTimer(id) {
  if (!id) return false;
  return _activeTimers.delete(String(id));
}
function _activeTimersSnapshot() {
  const now = Date.now();
  const out = [];
  for (const [id, t] of _activeTimers) {
    if (t.ends_at_ms <= now) { _activeTimers.delete(id); continue; }
    out.push({
      id:           t.id,
      name:         t.name,
      target:       t.target || null,   // GINA-style row prefix (boss/mob)
      effect:       t.effect || t.name, // GINA-style row suffix (spell/effect)
      remaining_ms: t.ends_at_ms - now,
      duration_sec: t.duration_sec,
      color:        t.color,
      end_text:     t.end_text,
      warning_ms:   t.warn_ms || 0,
      warn_text:    t.warn_text || null,
      scope:        t.scope,
      test:         t.test,
    });
  }
  // Soonest-to-expire first — that's the most useful default for a stack of bars.
  out.sort((a, b) => a.remaining_ms - b.remaining_ms);
  return out;
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
    // End-early check runs FIRST so a single log line containing the end
    // phrase cancels the timer before the same line could (also) re-trigger
    // the start pattern. Per-target: if the end pattern matches and there
    // are multiple timers from this trigger (different captures), only the
    // one whose captures match the end-line's captures cancels. Otherwise
    // all timers under this trigger cancel — matches the simple case where
    // a trigger has only one active timer.
    if (t._endRegex) {
      try {
        const em = t._endRegex.exec(line);
        if (em) {
          const endCaps = em.groups || {};
          const triggerName = t.name;
          for (const [tid, row] of _activeTimers) {
            if (row.trigger_name !== triggerName) continue;
            const rowCaps = row.captures || {};
            const captureKeys = Object.keys(rowCaps);
            const hasCaps = captureKeys.length > 0 && Object.keys(endCaps).length > 0;
            if (hasCaps) {
              // Require every shared capture key to match (case-insensitive)
              // before cancelling. If the end pattern names different
              // captures than the start, we treat it as "trigger-wide"
              // cancellation below.
              const sharedKeys = captureKeys.filter(k => endCaps[k] != null);
              if (sharedKeys.length > 0) {
                const allMatch = sharedKeys.every(k =>
                  String(rowCaps[k]).toLowerCase() === String(endCaps[k]).toLowerCase());
                if (allMatch) _activeTimers.delete(tid);
                continue;
              }
            }
            _activeTimers.delete(tid);
          }
        }
      } catch { /* bad end-early regex — already logged at compile time */ }
    }
    if (!t._regex) continue;
    let m;
    try { m = t._regex.exec(line); } catch { continue; }
    if (!m) continue;
    // Charm-pet filter — if the captured {s} name is one of our currently
    // active charm pets, the message is about OUR pet (slow on a charmed
    // mob, our pet enrages at low HP, etc.) and the call would be wrong.
    // Don't apply to Zeal-condition triggers (no log-match captures there).
    const captures = m.groups || {};
    if (_captureMatchesCharmPet(captures)) continue;
    // Cooldown gate
    if (t.cooldown_seconds && t.cooldown_seconds > 0) {
      const last = _triggerLastFire.get(t.id || t.name) || 0;
      if (tsMs - last < t.cooldown_seconds * 1000) continue;
    }
    _triggerLastFire.set(t.id || t.name, tsMs);
    _fireTriggerActions(t, captures, tsMs, false);
  }
}

// Fire a trigger's actions WITHOUT requiring a live-line match. Used by both:
//   • evaluateTriggersAgainstLine (the live evaluator)
//   • POST /api/triggers/fire (the dashboard's "Test" / "Preview" buttons)
//
// All writes are in-memory only — _pushOverlay populates the ring buffer the
// dashboard + overlay window read, console.log echoes to the CLI, and
// scheduleRender pokes the dashboard. NO database, NO upload queue, NO Discord
// — test fires are local-only by construction. The `test` flag on the
// emitted overlay lets the UI label test fires distinctly.
// Lowercased set of names from the current Zeal raid roster. Re-populated by
// _maybeUploadRaidRoster on every raid-window change; trigger actions can opt
// in to "only fire when capture X is in this set" via require_raid_member
// (covers: pet names, hammer pets, mob substrings that backtrack-match a
// player-shaped pattern). Empty when no raid window has been seen — in that
// case the filter falls open (any captured name is allowed) so non-raid
// triggers still work.
const _raidRosterMembers = new Set();
function _raidRosterHas(name) {
  if (!name || _raidRosterMembers.size === 0) return false;
  return _raidRosterMembers.has(String(name).toLowerCase());
}

function _fireTriggerActions(t, captures, tsMs, test, isRelay) {
  // Trigger-level roster gate. The require_raid_member field lives on
  // individual actions (so a single trigger can have one filtered + one
  // unfiltered action), but the trigger-level countdown timer is a single
  // shared concept — it'd be wrong to render a Death Touch countdown bar
  // for a pet who took 20k non-melee damage and then suppress just the
  // overlay text. So: if ANY action sets require_raid_member AND that
  // capture isn't in the roster, treat the whole trigger as suppressed
  // (no actions, no timer). Falls open when roster is empty (haven't
  // seen Type 5 yet) so out-of-raid testing still fires.
  if (_raidRosterMembers.size > 0) {
    for (const a of (t.actions || [])) {
      if (!a || !a.require_raid_member) continue;
      const val = captures && captures[String(a.require_raid_member)];
      if (!val || !_raidRosterHas(val)) {
        if (!test) console.log('[trigger] ' + (t.name || 'trigger') + ' suppressed — ' + a.require_raid_member + '=' + val + ' not a raid member');
        return;
      }
    }
  }
  for (const a of (t.actions || [])) {
    if (!a || !a.type) continue;
    if (a.type === 'text_overlay') {
      const text = _expandTemplate(a.text || '', captures || {});
      // Spoken text: an explicit per-action `tts` wins (lets a trigger say
      // something different than it shows — e.g. EQLP TextToSpeak vs
      // TextToDisplay). When absent, the overlay window falls back to the
      // display text so every alert is audible by default.
      const ttsText = a.tts ? _expandTemplate(a.tts, captures || {}) : '';
      const overlay = {
        text,
        color:       a.color || 'red',
        duration_ms: a.duration_ms || 5000,
        shownAt:     tsMs || Date.now(),
        // firedAt is a real-time monotonic-ish stamp the trigger overlay window
        // uses to detect NEW fires (log ts can collide within a second and get
        // de-duped, swallowing rapid back-to-back alerts).
        firedAt:     Date.now(),
        trigger:     t.name,
        scope:       t._scope || (test ? 'test' : 'personal'),
        test:        !!test,
      };
      if (ttsText) overlay.tts = ttsText;
      if (a.sound) overlay.sound = a.sound;
      _pushOverlay(overlay);
      console.log(`[trigger${test ? ':test' : ':' + (t._scope || '?')}] ${t.name} → ${text}`);
      scheduleRender();
    } else if (a.type === 'discord' && !test) {
      // Broadcast this fire to a text Discord channel via the bot. Test fires
      // stay local. `key` dedups across every raider's agent (default
      // name+message). Default mode is 'post'; setting `voice: true` swaps to
      // the voice surface for a one-shot speak (use 'voice' action for the
      // countdown form below).
      const msg = _expandTemplate(a.message || a.text || '', captures || {}).trim();
      if (msg) {
        const key = a.key ? _expandTemplate(a.key, captures || {}) : (t.name + ':' + msg);
        _broadcastTriggerToDiscord({
          name: t.name, message: msg, key, tsMs,
          mode: a.voice ? 'voice' : 'post',
          voiceId: a.voice_id,
        });
      }
    } else if (a.type === 'voice' && !test) {
      // Voice TTS action — one-shot or multi-tick countdown.
      //
      //   one-shot: { type: 'voice', message: 'rampage on {target}' }
      //   marks   : { type: 'voice', marks: [
      //       { at_ms: 0,     text: 'thirty seconds' },
      //       { at_ms: 20000, text: 'ten seconds, big heals' },
      //       { at_ms: 25000, text: 'five seconds, remove curse' },
      //       { at_ms: 30000, text: 'tankbuster' },
      //   ] }
      //
      // Each mark pushes a local overlay+TTS event on THIS Mimic client.
      // Mimic's renderer reads the `tts` field via the browser
      // SpeechSynthesis API, so every raider running Mimic hears the
      // call-out through their own speakers on their own machine — no
      // Discord voice gateway needed, no bot connection, no single point
      // of failure. Every raider who's running Mimic gets the audio +
      // visual independently from their own log tail.
      //
      // Marks more than 60s old at fire time are dropped (covers
      // historical replays + the case where the live log catches up
      // after a pause). Per-mark key includes its offset so 30→10→5→0
      // don't dedup to a single overlay.
      //
      // Opt-in Discord broadcast: pass `discord: true` on the action to
      // ALSO route through the bot's voice channel surface (currently
      // unreliable on Railway; kept as an option for when that's fixed).
      const baseKey  = a.key ? _expandTemplate(a.key, captures || {}) : t.name;
      const voiceId  = a.voice_id || null;
      const color    = a.color || 'red';
      const durMs    = a.duration_ms || 5000;
      const broadcastDiscord = !!a.discord;
      const speakAt  = (text, offsetMs) => {
        const msg = _expandTemplate(text || '', captures || {}).trim();
        if (!msg) return;
        const fireMs = (tsMs || Date.now()) + Math.max(0, offsetMs || 0);
        if (Date.now() - fireMs > 60_000) return;          // stale, drop
        const delay  = Math.max(0, fireMs - Date.now());
        const key    = baseKey + ':' + Math.round(offsetMs || 0);
        setTimeout(() => {
          // Local overlay+TTS — Mimic shows the line AND speaks it.
          _pushOverlay({
            text:        msg,
            tts:         msg,
            color,
            duration_ms: durMs,
            shownAt:     Date.now(),
            firedAt:     Date.now(),
            trigger:     t.name,
            scope:       t._scope || 'personal',
            test:        false,
          });
          scheduleRender();
          console.log('[trigger:voice:' + (t._scope || '?') + '] ' + t.name + ' → ' + msg);
          // Optional Discord broadcast — bot routes to voice channel.
          if (broadcastDiscord) {
            _broadcastTriggerToDiscord({
              name: t.name, message: msg, key, tsMs: Date.now(),
              mode: 'voice', voiceId,
            });
          }
        }, delay);
      };
      if (Array.isArray(a.marks) && a.marks.length > 0) {
        for (const m of a.marks) speakAt(m && (m.text || m.message), m && m.at_ms);
      } else if (a.message || a.text) {
        speakAt(a.message || a.text, 0);
      }
    }
    // sound / emit_event beyond the overlay's own audio remain no-ops in v1.
  }
  // Trigger-level timer countdown (separate from per-action overlays).
  // Starts when timer_duration_sec > 0 on the trigger itself. Captures
  // are passed so per-mob keying works — "Pacify on Lord Nagafen" and
  // "Pacify on Vox" become two independent countdowns rather than the
  // second restarting the first.
  if (t.timer_duration_sec > 0) _startTimer(t, tsMs, test, captures);

  // Fan-out — mark the local fire seen, then relay to the bot so other
  // Mimics that missed the source line can replay it. Skip when this
  // function is itself running a relayed fire (would loop) or for test
  // fires (debug-only, no bot side effects). Captures are part of the
  // dedup key so two simultaneously-detected DIFFERENT events
  // ("RIP Hitya" and "RIP Sweenie" within the same second) both land.
  if (!test) {
    const fireKey = (t.name || 'trigger') + ':' + JSON.stringify(captures || {});
    _markFireSeen(fireKey, tsMs || Date.now());
    if (!isRelay && t._scope !== 'personal') {
      _relayLocalFire(t, t.actions || [], captures || {}, tsMs || Date.now(), fireKey);
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

// Faction events upload → bot's /api/agent/faction. Two kinds ride the same
// payload: 'hit' (a "Your faction standing with X got better/worse" line,
// incl. the at-cap forms) and 'con' (a /consider standing TRANSITION for a
// mob). Bot-side unique constraints make backfill replays idempotent, so
// crawling a complete log history is safe to re-run.
function uploadPopFlags(events, { dryRun } = {}) {
  if (!Array.isArray(events) || events.length === 0) return Promise.resolve();
  if (dryRun) {
    for (const e of events) console.log(`[pop-flag] ${e.character} · ${e.zone || '?'} · ${e.boss || '?'} · ${e.ts}`);
    return Promise.resolve();
  }
  enqueueUpload('pop_flag', { agent_version: AGENT_VERSION, events });
  return Promise.resolve();
}

function uploadFaction(events, { dryRun } = {}) {
  if (!Array.isArray(events) || events.length === 0) return Promise.resolve();
  if (dryRun) {
    for (const e of events) console.log(`[faction] ${e.kind} · ${e.character} · ${e.faction || e.mob} · ${e.direction != null ? (e.direction > 0 ? 'better' : 'worse') : e.standing} · ${e.ts}`);
    return Promise.resolve();
  }
  // CHUNK the payload. Live flushes carry a handful of events, but a
  // complete-log backfill accumulates the whole history in factionBuffer and
  // drains it ONCE at the end — a heavy character's multi-year crawl is
  // 50k+ hit events (~7MB JSON), which would blow the bot endpoint's 512KB
  // body cap (413 → the queue retries a permanently-oversized payload) and
  // bloat logsync.queue.json. 1,500 events ≈ 200KB — comfortable margin.
  const CHUNK = 1500;
  for (let i = 0; i < events.length; i += CHUNK) {
    enqueueUpload('faction', { agent_version: AGENT_VERSION, events: events.slice(i, i + CHUNK) });
  }
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

// Observed buff landings on other players → bot's /api/agent/buff_casts. The
// bot dedups across observers, so every nearby agent uploading what it saw is
// fine (and desirable — more observers = better coverage).
function uploadBuffCasts(casts, { dryRun } = {}) {
  if (!Array.isArray(casts) || casts.length === 0) return Promise.resolve();
  if (dryRun) {
    for (const c of casts) console.log(`[buff-cast] ${c.target} ← ${c.spell_name || '(ambiguous: ' + c.landing_text + ')'} @ ${c.cast_at}`);
    return Promise.resolve();
  }
  enqueueUpload('buff_cast', { agent_version: AGENT_VERSION, casts });
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
  // dm_pause_until: a per-machine "pause Discord tells" set from the Mimic
  // tray. The bot still STORES the tells (so /me/tells + the local card stay
  // current) but skips the Discord DM while the pause is in the future.
  const dmPauseUntil = (_tellsDmPauseUntil && _tellsDmPauseUntil > Date.now()) ? _tellsDmPauseUntil : undefined;
  enqueueUpload('tells', { agent_version: AGENT_VERSION, character, tells, dm_pause_until: dmPauseUntil });
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
  // Watch mode tolerates ZERO logs: run the dashboard + Zeal/state endpoints and
  // simply tail nothing until logs appear. Hard-failing here is what made Mimic
  // crash-loop for users whose EQ folder wasn't found OR who haven't enabled
  // in-game logging yet (Zeal can be flowing while there are no eqlog_* files).
  // The host (Mimic) restarts the agent once logs become available. --once /
  // --since still require logs — there's nothing to backfill without them.
  const _wantsWatch = args.flags.watch || (!args.flags.once && !args.flags.since);
  if (args.logs.length === 0 && !_wantsWatch) {
    console.error('❌ At least one --log is required. Use --help for usage.');
    process.exit(1);
  }
  if (args.logs.length === 0) {
    console.warn('⚠ No EQ log files to tail yet — running the dashboard only. Turn on in-game logging (/log on, and Logging=on in eqclient.ini) and/or set your EQ folder; logs are picked up automatically once they appear.');
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

  // Spell catalog: load any cached copy from disk synchronously so the first
  // dashboard render has spell names + PQDI ids, then fire a background fetch
  // to refresh from the bot. We don't await — a slow fetch must not delay
  // boot, and the resisted-spell card just shows plain names until it lands.
  _loadSpellCatalogFromDisk();
  _loadItemClickiesFromDisk();
  // Restore the Pet tracker's in-memory state (last /pet health, observed buff
  // landings, running combat stats) so a Mimic restart or LD reconnect brings
  // the existing pet timers + stats back instead of starting blank. TTLs in
  // the loader drop entries old enough to be stale.
  _loadPetStateFromDisk();
  if (!dryRun && token) {
    fetchSpellCatalog({ botUrl, token }).catch(() => {});
    fetchItemClickies({ botUrl, token }).catch(() => {});
    // Re-fetch daily — the catalog only changes on the weekly upstream sync,
    // but a daily check is cheap (the bot serves a 304 if nothing changed)
    // and stops a long-running agent from drifting indefinitely.
    setInterval(() => {
      fetchSpellCatalog({ botUrl, token }).catch(() => {});
      fetchItemClickies({ botUrl, token }).catch(() => {});
    }, 24 * 60 * 60 * 1000).unref();
  }
  // Operator's declared main (if the launcher passed --character) — used to
  // attribute operator-level uploads instead of "(unknown)".
  _primaryCharacterOverride = args.flags.character || null;

  // Elect the single machine-wide uploader BEFORE the queue drain kicks, so a
  // read-only instance (another Parser/Mimic already uploading) doesn't replay
  // its queue or send live data. dry-run never uploads, so skip the election.
  if (!dryRun) startUploaderElection(args.flags.webPort);

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

  // Quarmy export ingest — <Name>Quarmy.txt in the same dir (the file
  // members generate for quarmy.com). Parsed locally; bank/sharedbank/coin
  // rows are dropped at parse and never leave the machine. The scan no-ops
  // until the character-prefs poll has answered once (exclude_inventory must
  // be known, not assumed), so the first useful pass is the 30s one.
  setTimeout(scanQuarmyExports, 30_000);
  setInterval(scanQuarmyExports, 10 * 60_000);

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
    // Live character state (buffs + last-seen zone) → bot → Supabase so
    // wolfpack.quest/me can show what each character is carrying + where. Only
    // sends on change (see flushLiveStateToBot), so the 20s cadence is cheap.
    setInterval(() => { try { flushLiveStateToBot({ botUrl, token }); } catch {} }, 20_000);
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

  // Per-character "do not transmit" list. Set by the user from Mimic
  // (onboarding + Settings) for characters they don't want any data uploaded
  // about — typically friends' boxes that play in other guilds, alts they
  // share data on, etc. Enforced at the OUTERMOST boundary: an excluded
  // character's log file is never opened, never tailed, never registered as a
  // watchedLog. Nothing about that character can ever leave the machine,
  // regardless of how many downstream code paths the agent grows. Case-
  // insensitive match on the canonical (filename-derived) character name.
  const excludedCsv = process.env.WOLFPACK_EXCLUDED_CHARS || '';
  const excludedSet = new Set(
    excludedCsv.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  );
  if (excludedSet.size > 0) {
    console.log(`[exclude] not transmitting for: ${[...excludedSet].join(', ')}`);
  }
  const allLogs    = args.logs;
  const filtered   = [];
  const droppedFor = [];
  for (const p of allLogs) {
    const fromName = characterFromFilename(p) || '';
    if (fromName && excludedSet.has(fromName.toLowerCase())) {
      droppedFor.push(fromName);
      continue;
    }
    filtered.push(p);
  }
  if (droppedFor.length > 0) {
    console.log(`[exclude] dropped ${droppedFor.length} log file(s) for excluded characters: ${droppedFor.join(', ')}`);
  }
  args.logs = filtered;

  // One encounter builder per log file (per character)
  const builders = args.logs.map(logPath => {
    // Per-file character: the filename (eqlog_<Name>_pq.proj.txt) is
    // authoritative. A single global --character override must NOT be smeared
    // across every log when tailing multiple files — doing so mislabeled every
    // watched log as the main (e.g. all "Hitya") AND made the chat parser treat
    // each alt's own "You say to your guild" line as the main, double-posting
    // guild chat under the wrong speaker. Use --character only as a fallback,
    // and only when there's a single log for it to describe.
    const fromName  = characterFromFilename(logPath);
    const character = fromName
      || (args.logs.length === 1 ? args.flags.character : null)
      || 'unknown';
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
          who_data:   Array.from(whoData.values()).filter(_isRegistryWho),
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
        // Fun-event detection — mirrors the opt-in backfill path so a CLI
        // bulk replay captures the same guild-flavor counters (Peopleslayer
        // LD, Malthur provisions, Dragon Punch, Dirges, Feral Avatar, …).
        // The bot's (guild_id, event_type, caster, event_ts) upsert key
        // dedups re-runs and overlap with other agents who saw the same
        // line, so emitting freely from --since is safe.
        const ldEvt = parsePeopleslayerLd(line);
        if (ldEvt) funEventBuffer.push(ldEvt);
        const provEvt = parseMalthurProvision(line, b.character);
        if (provEvt) funEventBuffer.push(provEvt);
        const sumProvEvt = parseSummonProvisions(line, b.character);
        if (sumProvEvt) funEventBuffer.push(sumProvEvt);
        const cursorEvt = parseCursorFull(line, b.character);
        if (cursorEvt) funEventBuffer.push(cursorEvt);
        const htEvt = parseHarmTouch(line, b.character);
        if (htEvt) funEventBuffer.push(htEvt);
        const lohEvt = parseLayOnHands(line, b.character);
        if (lohEvt) funEventBuffer.push(lohEvt);
        const pkEvt = parsePvpFlag(line, b.character);
        if (pkEvt) funEventBuffer.push(pkEvt);
        const dpEvt = parseDragonPunch(line, b.character);
        if (dpEvt) funEventBuffer.push(dpEvt);
        const dirgeEvt = parseDirgeCast(line, b.character);
        if (dirgeEvt) funEventBuffer.push(dirgeEvt);
        // Faction hits + /con standing transitions — self-only lines; rides
        // the 5s relay flush to /api/agent/faction. Bot-side dedup makes
        // complete-log backfill crawls idempotent.
        const facEvt = parseFactionLine(line, b.character);
        if (facEvt) factionBuffer.push(facEvt);
        const conFacEvt = parseConsiderLine(line, b.character);
        if (conFacEvt) factionBuffer.push(conFacEvt);
        const pfEvt = parsePopFlagLine(line, b.character);
        if (pfEvt) popFlagBuffer.push(pfEvt);
        const faCastEvt = parseFeralAvatar(line, b.character);
        if (faCastEvt) funEventBuffer.push(faCastEvt);
        const faEvt = parseFeralAvatarReceived(line, b.character);
        if (faEvt) funEventBuffer.push(faEvt);
        const savEvt = parseSavageryReceived(line, b.character);
        if (savEvt) funEventBuffer.push(savEvt);
        // Observed buff landings on other players — same as opt-in path.
        // Almost always expired by the time --since runs, but the web
        // filters expired so this costs nothing and occasionally rescues
        // a still-active buff from a recent log replay.
        const bcEvt = parseBuffLanding(line, b.character);
        if (bcEvt) buffCastBuffer.push(bcEvt);

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
    // Drain the fun-event + buff-cast buffers. Watch mode lets the 5s
    // startChatRelay tick handle this; --since is one-shot and exits, so we
    // flush inline before the process returns. Otherwise everything we just
    // detected sits in-memory and never uploads.
    if (funEventBuffer.length > 0) {
      await uploadFunEvents(funEventBuffer.splice(0), _uploadOpts || { botUrl, token, dryRun }).catch(err =>
        console.warn(`[fun-event backfill] ${err.message}`));
    }
    if (factionBuffer.length > 0) {
      await uploadFaction(factionBuffer.splice(0), _uploadOpts || { botUrl, token, dryRun }).catch(err =>
        console.warn(`[faction backfill] ${err.message}`));
    }
    if (popFlagBuffer.length > 0) {
      await uploadPopFlags(popFlagBuffer.splice(0), _uploadOpts || { botUrl, token, dryRun }).catch(err =>
        console.warn(`[pop-flag backfill] ${err.message}`));
    }
    if (buffCastBuffer.length > 0) {
      await uploadBuffCasts(buffCastBuffer.splice(0), _uploadOpts || { botUrl, token, dryRun }).catch(err =>
        console.warn(`[buff-cast backfill] ${err.message}`));
    }
    console.log('Backfill complete.');
    return;
  }

  // Watch mode (default for live raids)
  if (args.flags.watch || (!args.flags.once && !args.flags.since)) {
    console.log(`[boot] wolfpack-logsync v${AGENT_VERSION} ready — watching ${builders.length} log file(s).`);
    startChatRelay();  // start the 5s guild/raid chat flush interval
    for (const b of builders) {
      const watched = stats.watchedLogs.find(w => w.logPath === b.logPath);
      // In-log NPC-hail character inference. EQ NPCs always address the
      // hailing player by name in their hail / greeting response:
      //   "An old man says, 'Hail, Dant!'"
      // That name is the authoritative character ID, regardless of what the
      // log file is named. Catches renamed backup files (eqlog_Dant3 →
      // Dant) without skipping anything. Only listens for the first hail per
      // log; once captured, the builder's character is promoted and we never
      // re-check on this log to avoid mis-attributing a /who response, a
      // pet, etc.
      //
      // SPEAKER MUST LOOK LIKE AN NPC, NOT A PLAYER. v2.5.26 used a loose
      // /[A-Z][^\[\]]+? says/ that matched OTHER PLAYERS' /say lines too —
      // e.g. "Foo says, 'Hail, Hitya!'" in Canopy's log would rename
      // Canopy's builder to Hitya and pollute castCounts['Hitya'] with
      // Canopy's druid spells. Restricting the speaker to:
      //   - "a/an <lowercase rest>"      (a frog, an old man)
      //   - "the <lowercase rest>"       (the village elder)
      //   - "<Capitalized> <Capitalized>" (Captain Yorla, Sir Robin)
      // Single-word Title-cased speakers (real player names) are excluded —
      // EQ NPCs that look like single Capitalized words DO exist (Nillipuss,
      // Vox), but their hail responses to a player still include the
      // player's name in the captured group, so the rename is correct in
      // those cases too as long as the speaker isn't a friendly player.
      const HAIL_RE = /\]\s+(?:a\s+[a-z][^\[\]]*?|an\s+[a-z][^\[\]]*?|the\s+[a-z][^\[\]]*?|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+says,?\s*['"](?:Hail|Greetings|Welcome|Well met),?\s+([A-Z][a-z]+)[!,.\s]/i;
      let _hailFound = false;
      await tailFile(b.logPath, line => {
        if (watched) { watched.lastSeen = Date.now(); }
        if (!_hailFound) {
          const m = HAIL_RE.exec(line);
          if (m) {
            const inLogName = m[1];
            // The whole regex carries /i (so "an old man" / "Welcome" match
            // regardless of case), which ALSO lets the name group [A-Z][a-z]+
            // match a lowercase English word — "the captain says, 'Welcome to
            // Qeynos!'" captured "to" and renamed the builder to "To". Real EQ
            // hails address the player with a genuinely capitalized name
            // ("Hail, Dant!"), so re-validate the capture CASE-SENSITIVELY and
            // run it through the plausible-attacker guard. If it's junk we do
            // NOT latch _hailFound — keep listening for a later, valid hail.
            const validHailName = inLogName && /^[A-Z][a-z]+$/.test(inLogName) && isPlausibleAttacker(inLogName);
            if (validHailName) _hailFound = true;
            if (validHailName && inLogName !== b.character) {
              console.log(`[mimic] log "${path.basename(b.logPath)}" filename says ${b.character}, NPC hailed ${inLogName} — using ${inLogName}`);
              const old = b.character;
              b.character = inLogName;
              b.builder.character = inLogName;
              if (watched) watched.character = inLogName;
              try { confirmPlayer(inLogName); } catch {}
              try {
                stats.canonicalCharacter = stats.canonicalCharacter || {};
                stats.canonicalCharacter[old] = inLogName;
              } catch {}
              // Recalibrate: drop the OLD key's accumulated session-stats so
              // the renamed-from data doesn't continue to appear under the
              // new label. The user explicitly asked for "create a new entry
              // for the active character" semantics on rename.
              try { if (stats.castCounts && stats.castCounts[old])  delete stats.castCounts[old]; } catch {}
              try { if (stats.sessionDeeps && stats.sessionDeeps[old]) delete stats.sessionDeeps[old]; } catch {}
              try { if (stats.sessionMends && stats.sessionMends[old]) delete stats.sessionMends[old]; } catch {}
            }
          }
        }

        // ── Item clicky detection ──────────────────────────────────────────
        // "Your <Item> begins to glow." fires for any equipped/inventory
        // clicky use (Robe of the Spring, Voice of the Serpent, Blood Orchid
        // Katana, etc). The underlying spell starts casting immediately
        // after, so we stash the item's cast time keyed by character and let
        // _bumpBardMelody pick it up when Zeal label 134 changes within
        // CLICKY_WINDOW_MS. Without this the overlay defaults to the bare
        // spell's cast time, which is wrong for any item that overrides it.
        {
          const m = line.match(/\]\s+Your\s+(.+?)\s+begins\s+to\s+(?:glow|sparkle|hum|smoke|burn)\b/i);
          if (m) {
            const itemName = m[1];
            const cat = _itemClickyByNameLower.get(itemName.toLowerCase());
            const castMs = (cat && typeof cat.casttime === 'number' && cat.casttime > 0) ? cat.casttime : null;
            if (b.character) {
              _pendingClickies.set(b.character.toLowerCase(),
                { itemName, castMs, atMs: Date.now() });
            }
          }
        }

        // ── Special relay lines: checked BEFORE the combat filter ──────────
        // These are NOT combat events and won't pass shouldKeep(), but we
        // still want to capture and relay them to Discord — UNLESS the owner
        // has set exclude_from_stats on the source character. Each push
        // below short-circuits on the prefs gate so an excluded character
        // generates zero outbound traffic from this machine.
        const _sourceExcluded = !shouldUploadForCharacter(b.character);

        // /tell handling — MUST be checked BEFORE shouldKeep because the byte-
        // level drop list filters out "tells you" / "you told" so neither the
        // local panel nor the upload path would otherwise see them.
        //
        // Two consumers, two gates:
        //   • LOCAL ring buffer (recentTells) — populated whenever parseTellLine
        //     matches on a non-excluded source. Powers the Mimic dashboard's
        //     "Recent Tells" card so a user can review tells without leaving
        //     the parser, even when they haven't opted into uploading.
        //   • UPLOAD buffer — gated on the per-character tell_relay opt-in
        //     flag (default off). Only opted-in characters reach Discord
        //     DM / wolfpack.quest/me/tells.
        // exclude_from_stats short-circuits both — an excluded character
        // generates zero tell traffic of any kind from this machine.
        const _tellPrefs = stats.characterPrefs && stats.characterPrefs[String(b.character || '').toLowerCase()];
        if (!_sourceExcluded) {
          const tellEvt = parseTellLine(line, b.character);
          if (tellEvt) {
            _pushRecentTell(tellEvt, b.character);
            if (_tellPrefs?.tell_relay) {
              tellBuffer.push({ ...tellEvt, character: b.character });
            }
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
          if (!_sourceExcluded && !_crossLogDupe(_pvpFp)) {
            pvpBuffer.push(pvpBcast);
            // Assist correlation: if the uploader was damaging this victim in
            // the last 30s AND the killing blow was someone else (or an NPC),
            // emit an assist row. cross-log dedup also applies — the same
            // assist won't post twice when multiple of our logs witness the
            // same death of someone we'd been swinging at.
            try {
              const assist = b.builder && b.builder._checkPvpAssist
                ? b.builder._checkPvpAssist(pvpBcast, { source: 'live_agent' })
                : null;
              if (assist) {
                const _aFp = 'assist|' + (assist.assister || '').toLowerCase() + '|' + _pvpFp;
                if (!_crossLogDupe(_aFp)) pvpAssistBuffer.push(assist);
              }
            } catch (e) { void e; }
          }
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
        const dpEvt = parseDragonPunch(line, b.character);
        if (dpEvt && !_sourceExcluded) funEventBuffer.push(dpEvt);
        const dirgeEvt = parseDirgeCast(line, b.character);
        if (dirgeEvt && !_sourceExcluded) funEventBuffer.push(dirgeEvt);
        // Faction hits + /con standing transitions — self-only lines; rides
        // the 5s relay flush to /api/agent/faction. Honors the per-character
        // exclude_from_stats opt-out like every other upload stream.
        const facEvt = parseFactionLine(line, b.character);
        if (facEvt && !_sourceExcluded) factionBuffer.push(facEvt);
        const conFacEvt = parseConsiderLine(line, b.character);
        if (conFacEvt && !_sourceExcluded) factionBuffer.push(conFacEvt);
        const pfEvt = parsePopFlagLine(line, b.character);
        if (pfEvt && !_sourceExcluded) popFlagBuffer.push(pfEvt);
        // Feral Avatar — caster-side fires only on the BL's own log; bystander
        // form fires on anyone in zone. Both push so the bot's (guild_id,
        // event_type, caster, event_ts) dedup collapses overlap.
        const faEvt = parseFeralAvatar(line, b.character);
        if (faEvt && !_sourceExcluded) funEventBuffer.push(faEvt);

        // Observed buff landing on another player (fills coverage for raiders
        // not running the agent). Cross-log dedup so a buff seen in main + alt
        // logs of one install isn't double-counted; the bot dedups across
        // separate installs by (target, spell, cast_at).
        // Track our own casts so a landing can be named from what WE cast
        // (authoritative — disambiguates shared landing messages + catches
        // spells the tracked-buff index doesn't carry).
        if (!_sourceExcluded) noteSelfCast(line, b.character);
        // Relay our own cast → bot, so anyone targeting the same mob/player sees
        // it in Mob Info's Casting section (cross-client; only our casts nameable).
        if (!_sourceExcluded) relaySelfCastForCasting(line, b.character);
        // "Your pet's <X> spell has worn off." → drop it from the pet's buffs.
        if (!_sourceExcluded) notePetBuffWornOff(line, b.character);
        // Prefer the cast-correlated resolution (our own cast); fall back to the
        // tracked-buff index match for buffs we only witnessed as a bystander.
        const bcEvt = (!_sourceExcluded ? resolveSelfCastLanding(line, b.character) : null)
                   || parseBuffLanding(line, b.character);
        if (bcEvt && !_sourceExcluded) {
          const _bcFp = `buffcast|${bcEvt.target}|${bcEvt.spell_id}|${bcEvt.landing_text}|${bcEvt.cast_at}`;
          if (!_crossLogDupe(_bcFp)) buffCastBuffer.push(bcEvt);
          // If the buff landed on one of OUR pets, stamp it for the Pet tracker's
          // countdown (catalog duration anchored to this land). Local UI only.
          recordPetBuffLanding(bcEvt);
          // Also stamp it under the target name so Mob Info can show buffs on
          // whatever we're targeting (mob or player).
          recordTargetBuffLanding(bcEvt);
        }

        // Server-wide PvP earthquake announcement → register the next-quake
        // time so the bot can show a countdown above the PvP timers (Discord +
        // web). Visible to everyone in zone; the bot dedups across agents.
        if (!_sourceExcluded) {
          const quakeEvt = parseEarthquake(line);
          if (quakeEvt && quakeEvt.next_quake_at !== _lastQuakeSig) {
            _lastQuakeSig = quakeEvt.next_quake_at;
            enqueueUpload('quake', { agent_version: AGENT_VERSION, quake: quakeEvt });
          }
        }

        // /pet health output (Quarm: standalone HP line + bare buff names in the
        // owner's own log). Feeds the per-owner pet buff SET + HP. Pure local UI
        // — no upload, never leaves the machine.
        applyPetHealthLine(line, b.character);

        // Charm pet death → drop it from the tracker right away (don't wait out
        // the 5-min linger window). Pass the local character so "You have slain"
        // is correctly attributed for the killer-guard (we don't kill our own
        // pet — same-named different mob).
        checkCharmPetDeath(line, b.character);

        // /who block boundaries (header/footer) → demarcate the current /who run
        // for the /who overlay. Rows themselves are attributed in recordWhoEvent.
        applyWhoLine(line);

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
        if (ev) {
          // Pet combat observation — if the attacker is one of our pets (Zeal
          // slot 16), accumulate skill / max / total / hit-count stats for the
          // Pet tracker. Side-channel; doesn't touch the encounter builder.
          try { recordPetCombat(ev, b.character); } catch {}
          b.builder.add(ev);
        }
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
