// Read what the server's own `#popflags` command prints (the guild lead, 2026-10-26: members paste one or
// several of `#popflags`, `#popflags 1` … `#popflags 5` and get their flags set, no Mimic needed). Pure: the
// browser runs it to preview, the server action runs it again before it saves (web/lib/popFlagsPasteSave.ts).
//
// SOURCE OF TRUTH: SecretsOTheP/EQMacEmu, zone/gm_commands/popflags.cpp, commit
// 11024c196790cfa370f1a44d6f03d70a23deac39 (967 lines). Every format string below is that file's, quoted with
// `popflags.cpp:<line>`. Nothing here comes from a guide. The command prints from the character's qglobals:
//   PopFlagsPrintStage  (cpp:61-93)  "<label>: <descriptions[value-1]>"; an empty value prints "Not started"
//                                    (cpp:70), a value outside 1..count prints "Progress recorded" (cpp:83).
//                                    So stage text N is the qglobal's value N, in every table: key `<qglobal>_<N>`.
//   PopFlagsPrintBoss   (cpp:171-177) "<label>: Complete | Pending memory | Missing" where Complete is
//                                    `<stage test> || Has("time")`. See "the time rule" below.
//
// The time rule. The `time` qglobal makes every tier, every boss line and the Miak preflag read Complete without
// the steps behind them (cpp:171-176, 230, 241, 256, 269, 717). So a "Complete" that has an `|| time` in it
// proves its stage test ONLY when the same paste shows the member does not hold `time`. The paste shows it on
// "Plane of Time access: Locked" (cpp:828-830, 851-853) or the overview's "Tier 4: <not Complete>" and
// "Tier 5 - Plane of Time: Not started" (cpp:343-355; tier 4 complete IS Has("time"), cpp:267-270) — or, as the real
// output of a partway character showed (2026-10-26), by any line that is only printed without it: a boss line reading
// "Missing" / "Pending memory", the Seer notice, the Miak advice, "Pending memory: <x>", a Tier 1-3 that is not
// Complete (NO_TIME_EXACT below). The server prints a boss line as `complete || time ? Complete : …`. With no word
// on `time`, such lines are listed as `unproven` instead of read, and the member is told which command settles it.
// Lines that need no such rule (an access line, a stage line, a bit string) are exact and are read as printed.
//
// Only keys our catalog keeps are emitted: web/lib/popSteps.ts (POP_STEPS) plus the stage keys the Seer paste
// already stores (RECITAL_STAGES). A value with no key of ours is expanded to the keys it proves (zeks 5, thelin 5)
// or reported in `noKey` (Seventh Hammer). The browser keeps the member's paste; only recognised lines are sent.

import { POP_STEPS } from './popSteps';
import { POP_ZONES } from './popFlags';
import { RECITAL_STAGES, norm } from './popRecital';

// ── The catalog we may write to ──────────────────────────────────────────────

const STEP_LIST = Object.entries(POP_STEPS).flatMap(([zone, steps]) => steps.map(s => ({ ...s, zone })));
const STEP_BY_KEY = new Map(STEP_LIST.map(s => [s.key, s]));
const ORDER: string[] = [...new Set([...STEP_LIST.map(s => s.key), ...RECITAL_STAGES.map(([, k]) => k)])];
const EMITTABLE = new Set(ORDER);
const ORDER_AT = new Map(ORDER.map((k, i) => [k, i]));

/** Values the command can print that our catalog keeps no step for, and the catalog keys they prove instead.
 *  zeks 5 "Both Zek information sets obtained" (cpp:579-580) is Vallon's 3 and Tallon's 4 (cpp:669-672 reads
 *  `zeks == 3 || zeks >= 5` and `zeks == 4 || zeks >= 5`). thelin 5 "Nightmare progression complete" (cpp:389) is
 *  past thelin 4 (cpp:233 tests `>= 4`), and the series only ever grows. */
export const NOT_IN_CATALOG: Record<string, string[]> = {
  zeks_5: ['zeks_3', 'zeks_4'],
  thelin_5: ['thelin_4'],
};

export const stepLabel = (key: string): string => STEP_BY_KEY.get(key)?.label ?? key;
const ZONE_SHORT = new Map(POP_ZONES.map(z => [z.key, z.short]));
export const stepZone = (key: string): string => {
  const z = STEP_BY_KEY.get(key)?.zone;
  return (z && ZONE_SHORT.get(z)) || 'Other';
};

// ── Stage tables: the description arrays, verbatim ───────────────────────────

type StageTable = { label: string; series: string; texts: string[]; cite: string };

const STAGES: StageTable[] = [
  { label: "Mavuin's case", series: 'mavuin', cite: 'popflags.cpp:370-374,396-402', texts: [
    'The evidence needed to save Mavuin has been requested',
    'The Tribunal has agreed to hear Mavuin\'s case',
    "Mavuin's case is complete",
  ] },
  { label: 'Fuirstel progression', series: 'fuirstel', cite: 'popflags.cpp:376-382,414-420', texts: [
    'Obtain the Ward for Milyk',
    'Grummus defeated; return to Elder Fuirstel',
    'Elder Fuirstel aided; defeat Bertoxxulous',
    'Bertoxxulous defeated; return to Elder Fuirstel',
    'Fuirstel progression complete',
  ] },
  // Five strings, count 5 (cpp:440): the last is value 5. Our catalog stops at thelin 4 (NOT_IN_CATALOG).
  { label: 'Thelin progression', series: 'thelin', cite: 'popflags.cpp:384-390,435-441', texts: [
    'Help Thelin escape the hedge maze',
    'Defeat Terris Thule',
    'Terris Thule was defeated',
    'Thelin was released from Terris Thule',
    'Nightmare progression complete',
  ] },
  { label: 'Aerin`Dar progression', series: 'aerindar', cite: 'popflags.cpp:473-476,494-500', texts: [
    'Aerin`Dar defeated; the meaning of Justice remains',
    'Halls of Honor access unlocked',
  ] },
  // Tier 2 and Tier 3 print the SAME qglobal with different words (cpp:478-483 vs 585-590) and different labels.
  { label: 'Askr and Karana progression', series: 'karana', cite: 'popflags.cpp:478-483,514-520', texts: [
    'Prove yourself to Askr',
    "Complete Mavuin's case, then use the Storms shrine to enter Bastion of Thunder",
    'Bastion of Thunder progression recorded',
    "Karana's information obtained",
  ] },
  { label: 'Agnarr and Karana progression', series: 'karana', cite: 'popflags.cpp:585-590,646-652', texts: [
    'Return to Askr',
    "Complete Mavuin's case, then use the Storms shrine to enter Bastion of Thunder",
    'Karana progression continues',
    "Karana's information obtained",
  ] },
  { label: 'Tylis progression', series: 'tylis', cite: 'popflags.cpp:485-488,548-554', texts: [
    'Rescue Tylis from the Plane of Torment',
    'Tylis progression complete',
  ] },
  { label: 'Giwin and Zek progression', series: 'zeks', cite: 'popflags.cpp:575-583,660-666', texts: [
    'Initial Zek progression recorded',
    'Meet Giwin in Drunder',
    "Vallon Zek's information obtained",
    "Tallon Zek's information obtained",
    'Both Zek information sets obtained',
    'Defeat Rallos Zek',
    'Zek progression complete',
  ] },
];

/** `<series>_<N>` for text index N-1 of a table — the printed text for value N (cpp:91 `descriptions[stage - 1]`). */
export const stageKey = (t: StageTable, index: number) => `${t.series}_${index + 1}`;
export const STAGE_TABLES = STAGES;

// The two Karana lines that say the series was folded into the Zebuxoruk lore (cpp:510, 642). The text is printed
// when Has("zebuxoruk") (cpp:507, 639), i.e. Maelin has read the notes: zebuxoruk 1.
const ZEBUXORUK_FOLDED = 'complete; combined into zebuxoruk lore';

// ── The other fixed lines ────────────────────────────────────────────────────

// "<label> access: Unlocked|Locked". Unlocked proves the key; Locked proves nothing (except for `time`).
const ACCESS: Record<string, { key: string | null; cite: string }> = {
  'seventh hammer access': { key: null, cite: 'popflags.cpp:406-410 (qglobal "seventh")' },   // no key of ours
  'crypt of decay access': { key: 'grummus_1', cite: 'popflags.cpp:424-427,529-533 (qglobal "grummus")' },
  'lower crypt access': { key: 'bertox_key_1', cite: 'popflags.cpp:537-541 (qglobal "bertox_key")' },
  'factory door access': { key: 'poi_door_1', cite: 'popflags.cpp:451-455 (qglobal "poi_door")' },
  'air, earth, and water access': { key: 'zebuxoruk_2', cite: 'popflags.cpp:803-807 (zebuxoruk >= 2)' },
  'plane of fire access': { key: 'pofire_2', cite: 'popflags.cpp:811-815 (pofire >= 2)' },
  'plane of earth b access': { key: 'earthb_key_1', cite: 'popflags.cpp:819-823 (qglobal "earthb_key")' },
  'plane of time access': { key: 'time_1', cite: 'popflags.cpp:827-831,850-854 (qglobal "time")' },
};

// "<name>: Complete|Incomplete", one per bit of the bit string (cpp:609-627 hohtrials, 731-767 sol_room).
const BITS: Record<string, string> = {
  'rydda\'dar trial': 'hoh_trial_1', 'village trial': 'hoh_trial_2', 'nomad trial': 'hoh_trial_3',
  'xuzl': 'sol_room_1', 'arlyxir': 'sol_room_2', 'dresolik': 'sol_room_3', 'rizlona': 'sol_room_4', 'jiva': 'sol_room_5',
};

// Maelin's four lines: "<label>: Received|Missing" (cpp:678-708).
const MAELIN: Record<string, string[]> = {
  'cipher information': ['cipher_1'],                       // Has("cipher")                  cpp:681
  'zebuxoruk lore': ['zebuxoruk_1'],                        // value not empty               cpp:689
  'combined zek information': ['zeks_5'],                   // zeks >= 5 → NOT_IN_CATALOG    cpp:697
  'final elemental information': ['zebuxoruk_2'],          // zebuxoruk >= 2                cpp:705
};

// PopFlagsPrintBoss (cpp:171-177): "<label>: Complete | Pending memory | Missing". Complete is `<test> || time`.
// key = the step the test proves (a test that is an OR of two qglobals is given the step the pair carries on our
// side: the cipher replaces both halves and zebuxoruk replaces both notes, web/lib/popSteps.ts STEP_IMPLIES).
const BOSS: Record<string, { key: string; cite: string }> = {
  'grummus flag': { key: 'fuirstel_2', cite: 'popflags.cpp:430-431 (fuirstel >= 2)' },
  'terris thule flag': { key: 'thelin_3', cite: 'popflags.cpp:444-445 (thelin >= 3)' },
  'manaetic behemoth flag': { key: 'zeks_2', cite: 'popflags.cpp:457-458 (zeks >= 2)' },
  'aerin\'dar flag': { key: 'aerindar_1', cite: 'popflags.cpp:502-503 (aerindar >= 1)' },
  'bertoxxulous flag': { key: 'fuirstel_4', cite: 'popflags.cpp:543-544 (fuirstel >= 4)' },
  'keeper of sorrows flag': { key: 'tylis_2', cite: 'popflags.cpp:556-557 (tylis >= 2)' },
  'saryrn cipher half': { key: 'saryrn_1', cite: 'popflags.cpp:559-560 (saryrn || cipher)' },
  'mithaniel marr cipher half': { key: 'mmarr_1', cite: 'popflags.cpp:631-632 (mmarr || cipher)' },
  'mithaniel marr book': { key: 'mmarr_book_1', cite: 'popflags.cpp:634-635 (mmarr_book || zebuxoruk)' },
  'agnarr / karana flag': { key: 'karana_4', cite: 'popflags.cpp:655-656 (karana >= 4 || zebuxoruk)' },
  'vallon zek flag': { key: 'zeks_3', cite: 'popflags.cpp:669-670 (zeks == 3 || zeks >= 5)' },
  'tallon zek flag': { key: 'zeks_4', cite: 'popflags.cpp:671-672 (zeks == 4 || zeks >= 5)' },
  'rallos zek flag': { key: 'zeks_7', cite: 'popflags.cpp:673-674 (zeks >= 7)' },
  'solusek ro flag': { key: 'pofire_2', cite: 'popflags.cpp:781-782 (pofire >= 2)' },
};
const MIAK = { label: 'miak the searedsoul preflag', key: 'pofire_1', cite: 'popflags.cpp:717-718 (pofire >= 1 || time)' };
const FIRE = { label: 'plane of fire progression', cite: 'popflags.cpp:773-779 (Unlocked = pofire >= 2)' };

// The headers: "=== <title> ===" (cpp:321,392,490,595,797,846). Which command printed each one.
export const SECTIONS: { title: string; command: string; tier: string }[] = [
  { title: 'Planes of Power Progression', command: '#popflags', tier: 'Overview' },
  { title: 'Tier 1 Progression', command: '#popflags 1', tier: 'Tier 1' },
  { title: 'Tier 2 Progression', command: '#popflags 2', tier: 'Tier 2' },
  { title: 'Tier 3 Progression', command: '#popflags 3', tier: 'Tier 3' },
  { title: 'Tier 4 Progression', command: '#popflags 4', tier: 'Tier 4' },
  { title: 'Plane of Time', command: '#popflags 5', tier: 'Tier 5' },
];
const SECTION_BY_NORM = new Map(SECTIONS.map(s => [norm(s.title), s.title]));

// Lines the command prints ONLY while the member does not hold `time`, so each one is the paste's answer "time: no"
// (real capture, 2026-10-26: a partway character's paste never prints the Plane of Time or Tier 4 lines, and
// its boss "Complete" lines were left unproven although the same paste says "Missing" and "Pending memory" on others).
//   · the Seer notice returns early with `time` (cpp:184)             · "Pending memory: <x>" returns early with it (cpp:157)
//   · the Miak advice line is printed when the preflag is not Complete, which `|| time` would make so (cpp:717-720)
//   · a boss line that reads "Missing" / "Pending memory" is `!(complete || time)` (cpp:175-176)
const NO_TIME_EXACT = new Set([
  'a checklist memory is ready to be unlocked.',                                                    // cpp:191
  "sit near seer mal nae`shi and say 'unlock memories', then check #popflags again.",              // cpp:196
  'pending checklist memories exist, but their prerequisite steps are incomplete.',                 // cpp:202
  'complete the unfinished progression shown above, then return to seer mal nae`shi.',              // cpp:207
  "speak to miak the searedsoul in tranquility about 'portal's destination'; hailing alone does not grant the preflag.", // cpp:720
].map(norm));

// Lines the command prints that carry no flag. Recognised so they never land in `unknown`.
const IGNORED_EXACT = new Set([
  'details: #popflags 1, 2, 3, 4, or 5 (tier1-tier5 also work).',                                   // cpp:361
  'if one of these is missing, hail maelin and ask about new lore and new information.',            // cpp:711
  'complete the elemental progression, combine the four elemental essences, and return to grand librarian maelin.',     // cpp:859
  'halls of honor trials: none completed',                                                          // cpp:601
  'tower wing flags: none completed',                                                               // cpp:725
  'the all option is restricted to server staff.',                                                  // cpp:947
  'valid sections: overview, 1-5, tier1-tier5, and time.',                                          // cpp:964
].map(norm));

// "Tier complete: <lore>" (cpp:275). Only the two whose test is exactly Has("time") say anything (cpp:269, 866).
const TIME_LORE = [
  'the powers of air, earth, fire, and water have been joined.',   // Tier 4, cpp:837
  'the plane of time recognizes your soul.',                       // Plane of Time, cpp:867
].map(norm);

// ── Reading ──────────────────────────────────────────────────────────────────

// A log line's leading timestamp ("[Mon Oct 26 21:10:01 2026] ") or the short one a chat window copies.
const STAMP_RX = /^\s*\[[^\]\n]*\d{1,2}:\d{2}[^\]\n]*\]\s*/;
const CHATTER_RX = /(?:\btells? (?:you|your|the)\b|\bsays?,|\byou say\b|\bshouts?,|\bauctions?,|\byou (?:hit|slash|bash|kick|pierce|crush|punch|backstab|miss)\b|points? of damage|\bhas been (?:slain|healed)\b|\bbegin(?:s)? casting\b|\bexperience\b)/i;
// A line that reads like #popflags output but matched nothing: worth showing the member (a new stage text after a
// server update would land here). Other chat in a pasted log is dropped without a word.
const FLAGISH_RX = /^(?:===|---)|\b(?:progression|access|flag|flags|trial|trials|preflag|information|lore|cipher|book|memory|tier|wing)\b/i;

const MAX_CHARS = 200_000;
const MAX_UNKNOWN = 25;
const MAX_USED = 120;

export type FoundFlag = { key: string; label: string; zone: string; line: string };
export type PopFlagsParse = {
  /** Step keys the paste proves (our catalog only), in catalog order. NOT the closure: a later value of a series
   *  carries its earlier steps, which stepsHeld()/heldClosure() add when read (as with a Seer recital). */
  flags: string[];
  /** Lines that read like #popflags output and matched nothing we know (deduplicated, capped). */
  unknown: string[];
  /** Section headers present (SECTIONS titles), in order of appearance. */
  sections: string[];
  /** Every flag with the step's plain-words label, its zone card and the line that proved it. */
  found: FoundFlag[];
  /** Recognised lines whose flag our catalog keeps no step for ("Seventh Hammer access: Unlocked"). */
  noKey: string[];
  /** "Complete" lines that are `<test> || time` with no word on `time` in the paste (see the time rule). */
  unproven: string[];
  /** Whether the paste says the member holds the time flag: 'yes' | 'no' | 'unknown'. */
  time: 'yes' | 'no' | 'unknown';
  /** The recognised lines, timestamps off: all a save needs to send, and it re-reads them with this same function. */
  used: string[];
  lines: number;
};

type Fact = { keys: string[]; line: string; needsNoTime: boolean };

const clean = (raw: string) => raw.replace(STAMP_RX, '').replace(/\s+/g, ' ').trim();

export function parsePopFlags(raw: unknown): PopFlagsParse {
  const text = String(raw ?? '').slice(0, MAX_CHARS);
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean);

  const facts: Fact[] = [];
  const sections: string[] = [];
  const noKey: string[] = [];
  const unknown: string[] = [];
  const used: string[] = [];
  const dupUnknown = new Set<string>();
  const timeSeen = new Set<'yes' | 'no'>();

  const addFact = (keys: string[], line: string, needsNoTime = false) => facts.push({ keys, line, needsNoTime });

  for (const line of lines) {
    const n = norm(line);
    const mark = () => { if (used.length < MAX_USED && !used.includes(line)) used.push(line); };

    // === Header ===
    const head = /^=== (.+) ===$/.exec(n);
    if (head) {
      const title = SECTION_BY_NORM.get(head[1]);
      if (title) { if (!sections.includes(title)) sections.push(title); mark(); continue; }
    } else if (/^--- .+ ---$/.test(n)) { continue; }                               // plane sub-headers: no flag
    if (IGNORED_EXACT.has(n)) continue;
    if (NO_TIME_EXACT.has(n)) { timeSeen.add('no'); mark(); continue; }
    if (n.startsWith('pending memory:')) { timeSeen.add('no'); mark(); continue; }  // cpp:157,164 — a cl_* memory, not a flag

    // Tier complete: <lore>
    const tc = /^tier complete: (.*)$/.exec(n);
    if (tc) {
      if (TIME_LORE.some(l => tc[1].startsWith(l))) { timeSeen.add('yes'); addFact(['time_1'], line); mark(); }
      continue;     // tiers 1-3: a conjunction (or time) of lines the same command prints; nothing new
    }

    // Overview: "Tier N: <status>" / "Tier 5 - Plane of Time: <status>" (cpp:326-355)
    const tier = /^tier (\d)(?: - plane of time)?: (complete|in progress|not started)$/.exec(n);
    if (tier) {
      const num = Number(tier[1]);
      if (num === 4 || num === 5) {           // tier 4 complete is Has("time") (cpp:269); tier 5's test is Has("time") (cpp:354)
        if (tier[2] === 'complete') { timeSeen.add('yes'); addFact(['time_1'], line); } else timeSeen.add('no');
        mark();
      } else if (tier[2] !== 'complete') {    // tiers 1-3 are `<steps> || time` (cpp:230,241,256): not Complete means no time
        timeSeen.add('no'); mark();
      }
      continue;
    }

    const colon = n.indexOf(': ');
    const label = colon > 0 ? n.slice(0, colon) : '';
    const rest = colon > 0 ? n.slice(colon + 2) : '';

    // <label>: <stage text>
    const tables = STAGES.filter(t => norm(t.label) === label);
    if (tables.length) {
      const t = tables[0];
      if (rest === 'not started' || rest === 'progress recorded') { mark(); continue; }
      if (t.series === 'karana' && rest === ZEBUXORUK_FOLDED) { addFact(['zebuxoruk_1'], line); mark(); continue; }
      const idx = t.texts.findIndex(x => norm(x) === rest);
      if (idx >= 0) {
        const key = stageKey(t, idx);
        addFact(NOT_IN_CATALOG[key] ?? [key], line);
        mark();
        continue;
      }
    }

    // <label> access: Unlocked|Locked
    const acc = label && ACCESS[label];
    if (acc && (rest === 'unlocked' || rest === 'locked')) {
      mark();
      if (label === 'plane of time access') timeSeen.add(rest === 'unlocked' ? 'yes' : 'no');
      if (rest === 'unlocked') { if (acc.key) addFact([acc.key], line); else noKey.push(line); }
      continue;
    }

    // Bit strings: <name>: Complete|Incomplete
    const bit = label && BITS[label];
    if (bit && (rest === 'complete' || rest === 'incomplete')) {
      mark();
      if (rest === 'complete') addFact([bit], line);
      continue;
    }

    // Maelin: <label>: Received|Missing
    const mael = label && MAELIN[label];
    if (mael && (rest === 'received' || rest === 'missing')) {
      mark();
      if (rest === 'received') addFact(mael.flatMap(k => NOT_IN_CATALOG[k] ?? [k]), line);
      continue;
    }

    // Plane of Fire progression: Unlocked | In progress | Not started
    if (label === FIRE.label && (rest === 'unlocked' || rest === 'in progress' || rest === 'not started')) {
      mark();
      if (rest === 'unlocked') addFact(['pofire_2'], line);
      continue;
    }

    // Miak the Searedsoul preflag: Complete | Missing — `pofire >= 1 || time`
    if (label === MIAK.label && (rest === 'complete' || rest === 'missing')) {
      mark();
      if (rest === 'complete') addFact([MIAK.key], line, true); else timeSeen.add('no');
      continue;
    }

    // Boss lines: Complete | Pending memory | Missing — `<test> || time`
    const boss = label && BOSS[label];
    if (boss && (rest === 'complete' || rest === 'pending memory' || rest === 'missing')) {
      mark();
      if (rest === 'complete') addFact([boss.key], line, true); else timeSeen.add('no');
      continue;
    }

    // Nothing matched. Say so only for lines that read like this command's output.
    if (CHATTER_RX.test(n)) continue;
    const knownLabel = !!label && (tables.length > 0 || label in ACCESS || label in BITS || label in MAELIN || label in BOSS
      || label === FIRE.label || label === MIAK.label);
    if (knownLabel || FLAGISH_RX.test(line)) {
      if (!dupUnknown.has(n) && unknown.length < MAX_UNKNOWN) { dupUnknown.add(n); unknown.push(line.slice(0, 200)); }
    }
  }

  // The time rule: both answers in one paste (two pastes from different days) is no answer.
  const time: PopFlagsParse['time'] = timeSeen.has('yes') && timeSeen.has('no') ? 'unknown'
    : timeSeen.has('yes') ? 'yes' : timeSeen.has('no') ? 'no' : 'unknown';

  const found = new Map<string, FoundFlag>();
  const unproven: string[] = [];
  for (const f of facts) {
    if (f.needsNoTime && time !== 'no') {
      // With `time` held the line is explained by it; with no word on it the line is unproven.
      if (time === 'unknown') unproven.push(f.line);
      continue;
    }
    // time_1 from a conflicting paste is dropped too: a flag is written only when the paste is of one mind.
    if (f.keys.length === 1 && f.keys[0] === 'time_1' && time === 'unknown') continue;
    for (const key of f.keys) {
      if (!EMITTABLE.has(key) || found.has(key)) continue;
      found.set(key, { key, label: stepLabel(key), zone: stepZone(key), line: f.line });
    }
  }

  // All three trials Complete is the Seer's "completed all of Honor's Trials" (hohtrials 111, cpp:145,257-258),
  // which is the key that opens the Temple of Marr on /pop.
  if (['hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3'].every(k => found.has(k)) && EMITTABLE.has('hohtrials_111')) {
    found.set('hohtrials_111', { key: 'hohtrials_111', label: 'Honor trials: all three', zone: stepZone('hoh_trial_1'), line: found.get('hoh_trial_3')!.line });
  }

  const flags = [...found.keys()].sort((a, b) => (ORDER_AT.get(a) ?? 1e6) - (ORDER_AT.get(b) ?? 1e6));
  return {
    flags,
    unknown,
    sections,
    found: flags.map(k => found.get(k)!),
    noKey: [...new Set(noKey)],
    unproven: [...new Set(unproven)],
    time,
    used,
    lines: lines.length,
  };
}
