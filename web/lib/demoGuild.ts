// The one fixture behind raidmimic.com/demo: an INVENTED guild, "Silverpine Vanguard", so a guild leader can click through
// what their own guild would get without us standing anything up for them (the guild lead, 2026-11-02: "lets set up a
// demo clickthrough site for raidmimic.com as well so they can see what it looks like for the guild, but without killing
// the resources"). Every demo page is static: it imports this module and nothing else for data. No database, no session,
// no request header, no fetch.
//
// ⚠ This repo is PUBLIC and the demo is a sales page: every name below is invented (checked against the character
// tables and the repo before use; none of them is anybody). Do NOT paste a real member, guild or Discord name in here,
// and do not "improve" a number by pulling it from the live site. test/raidmimic-demo.test.js holds the names to the
// list in DEMO_NAMES.
//
// The flags are real flag keys (web/lib/popFlags.ts, popSteps.ts, popRecital.ts) and the verdicts are computed by the
// real gate libraries (popGateStatus.ts), so what the demo shows is what the product would show for that data.
//
// THE RULE THE DEMO ILLUSTRATES (the guild lead, 2026-11-02, "capture flags for other players characters and they can
// auth in to update"): a raid leader can record flags for a character that is not theirs. That is a REPORT. A report can
// add a flag ("reported", shown ✅ with a tag) but never takes one away and never produces a ❌: the owner signs in and
// confirms or corrects it. Only the owner's own read (the Seer's recital or #popflags, `fullRead`) can say "missing".

import { POP_ZONE_BY_KEY } from './popFlags';
import { GATES } from './popGatePieces';
import { gateReport, type PieceStatus, type Verdict } from './popGateStatus';

export const GUILD = {
  name: 'Silverpine Vanguard',
  game: 'EverQuest, Project Quarm',
  nights: 'Wednesday and Sunday, 8 pm to midnight Eastern',
  era: 'Planes of Power',
} as const;

export const DEMO_BAR = '[beta] Demo — invented guild, nothing here is real';

// ─── The raiders ────────────────────────────────────────────────────────────────────────────────

export type DemoReport = { by: string; flags: string[]; when: string };
export type DemoChar = {
  name: string;
  cls: string;
  /** Flag keys the OWNER has confirmed (their own Seer recital / #popflags read, or Mimic saw it happen). */
  confirmed: string[];
  /** True once the owner's own full read is on record, so an absent flag is a real "no". */
  fullRead: boolean;
  /** Flags a raid leader recorded for this character that the owner has not yet confirmed. */
  reported?: DemoReport;
};

export const CHARS: DemoChar[] = [
  { name: 'Aldenmar', cls: 'Warrior', fullRead: true,
    confirmed: ['cipher_1', 'zeks_6', 'zeks_7', 'fuirstel_5', 'thelin_4', 'karana_4', 'aerindar_2', 'hohtrials_111'] },
  { name: 'Brackwyn', cls: 'Cleric', fullRead: false,
    confirmed: ['mavuin_3', 'fuirstel_5', 'thelin_4'],
    reported: { by: 'Aldenmar', flags: ['saryrn_1', 'mmarr_1', 'cipher_1'], when: 'Sunday night' } },
  { name: 'Corvale', cls: 'Wizard', fullRead: true,
    confirmed: ['saryrn_1', 'mmarr_1', 'zeks_3', 'mavuin_3', 'aerindar_2', 'fuirstel_5', 'thelin_4'] },
  { name: 'Rethlan', cls: 'Monk', fullRead: true,
    confirmed: ['cl_saryrn', 'mmarr_1', 'mavuin_3', 'aerindar_2', 'fuirstel_5', 'thelin_4'] },
  { name: 'Nyssara', cls: 'Enchanter', fullRead: true,
    confirmed: ['cipher_1', 'zeks_6', 'mavuin_3', 'aerindar_2', 'fuirstel_5', 'thelin_4'] },
  { name: 'Zarrin', cls: 'Rogue', fullRead: true,
    confirmed: ['saryrn_1', 'mavuin_3', 'aerindar_2', 'hoh_trial_1', 'hoh_trial_2'] },
  { name: 'Orlindra', cls: 'Druid', fullRead: true,
    confirmed: ['mavuin_3', 'aerindar_2', 'hoh_trial_1'] },
  { name: 'Sorvane', cls: 'Shaman', fullRead: true,
    confirmed: ['mavuin_3'] },
  { name: 'Tavrin', cls: 'Paladin', fullRead: false,
    confirmed: ['mavuin_3'],
    reported: { by: 'Nyssara', flags: ['zeks_3', 'zeks_4'], when: 'Wednesday night' } },
  { name: 'Ulwen', cls: 'Ranger', fullRead: true,
    confirmed: ['cipher_1', 'zeks_4', 'mavuin_3', 'aerindar_2'] },
  { name: 'Veyra', cls: 'Necromancer', fullRead: true,
    confirmed: ['cipher_1', 'zeks_5', 'mavuin_3', 'fuirstel_5'] },
  { name: 'Wendrel', cls: 'Bard', fullRead: true,
    confirmed: ['cipher_1', 'zeks_6', 'mavuin_3', 'aerindar_2', 'thelin_4'] },
  { name: 'Yselka', cls: 'Magician', fullRead: false, confirmed: [] },
  { name: 'Dunmarrow', cls: 'Shadow Knight', fullRead: true,
    confirmed: ['saryrn_1', 'zeks_5', 'mavuin_3', 'aerindar_2', 'hoh_trial_1', 'hoh_trial_2', 'hoh_trial_3'] },
];

/** Every name the demo uses, for the test that holds the fixture to invented names. */
export const DEMO_NAMES: string[] = CHARS.map(c => c.name);

export const charByName = (name: string): DemoChar | undefined => CHARS.find(c => c.name === name);

// ─── What each character holds ──────────────────────────────────────────────────────────────────
// 'confirmed': only what the owner confirmed (the guild table's truth). 'planning': confirmed plus reports, which is what
// a leader schedules from. A report only ever ADDS a flag, so planning can turn a ❓ into a ✅ and never into a ❌.

export type FlagMode = 'confirmed' | 'planning';

export function flagsOf(c: DemoChar, mode: FlagMode): string[] {
  return mode === 'planning' && c.reported ? [...c.confirmed, ...c.reported.flags] : c.confirmed;
}

export type DemoRow = { name: string; cls: string | null; isMain: boolean; pieces: PieceStatus[]; verdict: Verdict };

/** One gate for one character, through the real gate rules. */
export function reportFor(c: DemoChar, gateKey: string, mode: FlagMode) {
  return gateReport(POP_ZONE_BY_KEY[gateKey], { flags: flagsOf(c, mode), fullRead: c.fullRead });
}

/** The rows GateTable draws: one per raider. */
export function gateRows(gateKey: string, mode: FlagMode): DemoRow[] {
  return CHARS.map(c => {
    const r = reportFor(c, gateKey, mode);
    return { name: c.name, cls: c.cls, isMain: true, pieces: r.pieces, verdict: r.verdict };
  });
}

export type ReportedCell = { piece: PieceStatus; reported: boolean };
export type ReportedRow = { name: string; cls: string; by: string; when: string; cells: ReportedCell[]; verdict: Verdict };

/** The characters with a pending report, one cell per piece; `reported` marks a piece done ONLY because of the report. */
export function reportedRows(gateKey: string): ReportedRow[] {
  return CHARS.filter(c => c.reported).map(c => {
    const before = reportFor(c, gateKey, 'confirmed');
    const after = reportFor(c, gateKey, 'planning');
    const rep = c.reported as DemoReport;
    return {
      name: c.name, cls: c.cls, by: rep.by, when: rep.when, verdict: after.verdict,
      cells: after.pieces.map((p, i) => ({ piece: p, reported: p.state === 'done' && before.pieces[i].state !== 'done' })),
    };
  });
}

/** The gates the picker offers: every plane with a requirement, in the chart's order. */
export const GATE_CHOICES = GATES.map(g => ({ key: g.key, name: g.name, short: g.short }));
export const DEMO_DEFAULT_GATE = 'solro';

// ─── Flag targets (the pick list an event is made from) ─────────────────────────────────────────

export type DemoTarget = {
  key: string;
  label: string;
  /** The gate the target's pieces belong to (popGatePieces.ts), so "who needs it" is the real gate rule. */
  gate: string;
  /** Piece keys (popGatePieces.ts) that must be done; a character who lacks any of them needs the target. */
  pieces: string[];
  blurb: string;
};

export const TARGETS: DemoTarget[] = [
  { key: 'marr-trials', label: 'Temple of Marr trials', gate: 'hohb', pieces: ['hoh_t1', 'hoh_t2', 'hoh_t3'], blurb: 'Three trials in the Halls of Honor' },
  { key: 'saryrn', label: 'Saryrn', gate: 'solro', pieces: ['c_saryrn'], blurb: 'Half of the cipher' },
  { key: 'marr', label: 'Mithaniel Marr', gate: 'solro', pieces: ['c_marr'], blurb: 'The other half of the cipher' },
  { key: 'tallon-vallon', label: 'Tallon & Vallon', gate: 'solro', pieces: ['z_vallon', 'z_tallon'], blurb: 'Both sets of Zek notes' },
  { key: 'terris', label: 'Terris Thule', gate: 'torment', pieces: ['t_terris'], blurb: 'Half of the Torment gate' },
  { key: 'bertox', label: 'Bertoxxulous', gate: 'torment', pieces: ['f_bertox'], blurb: 'The other half of the Torment gate' },
  { key: 'rallos', label: 'Rallos Zek', gate: 'fire', pieces: ['s_rallos'], blurb: 'Needed for Doomfire and the elemental planes' },
];
export const targetByKey = (key: string): DemoTarget | undefined => TARGETS.find(t => t.key === key);

export type Need = { need: DemoChar[]; unsure: DemoChar[]; done: DemoChar[] };

/** Who still needs a target. `need` is a real "no" (their own full read lacks it); `unsure` is "not recorded either way";
 *  `done` holds it, a report included. A held Seer memory (⏳) counts as done: the kill is credited, no raid is owed. */
export function needsFor(t: DemoTarget): Need {
  const out: Need = { need: [], unsure: [], done: [] };
  for (const c of CHARS) {
    const states = reportFor(c, t.gate, 'planning').pieces.filter(p => t.pieces.includes(p.key)).map(p => p.state);
    if (states.some(s => s === 'missing')) out.need.push(c);
    else if (states.some(s => s === 'unknown')) out.unsure.push(c);
    else out.done.push(c);
  }
  return out;
}

// ─── Events ─────────────────────────────────────────────────────────────────────────────────────

export type DemoEvent = {
  id: string;
  target: string;       // a TARGETS key
  day: string;
  time: string;
  by: string;           // the raid leader who posted it
  signed: string[];
  note?: string;
};

export const EVENTS: DemoEvent[] = [
  { id: 'ev-wed', target: 'marr-trials', day: 'Wed', time: '8:00 pm ET', by: 'Aldenmar',
    signed: ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Orlindra', 'Tavrin', 'Veyra', 'Dunmarrow', 'Wendrel'],
    note: 'Bring a cleric for the nomads. Gather in the Halls of Honor at 7:45.' },
  { id: 'ev-thu', target: 'saryrn', day: 'Thu', time: '8:30 pm ET', by: 'Nyssara',
    signed: ['Nyssara', 'Aldenmar', 'Zarrin', 'Orlindra', 'Sorvane', 'Ulwen'] },
  { id: 'ev-sun', target: 'tallon-vallon', day: 'Sun', time: '8:00 pm ET', by: 'Aldenmar',
    signed: ['Aldenmar', 'Corvale', 'Brackwyn', 'Orlindra', 'Zarrin', 'Rethlan', 'Dunmarrow'],
    note: 'Two kills in one night; the order is Vallon first.' },
];
export const eventByTarget = (key: string): DemoEvent | undefined => EVENTS.find(e => e.target === key);

/** Raiders who said they are free this week. Option B compares it with who has signed to anything. */
export const AVAILABLE_THIS_WEEK: string[] = [
  'Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Orlindra', 'Sorvane', 'Tavrin', 'Veyra', 'Dunmarrow', 'Yselka',
];

// ─── Tonight's raid (Wednesday, the Temple of Marr trials) ───────────────────────────────────────

export const TONIGHT = {
  eventId: 'ev-wed',
  /** The gates whose pieces the pull needs, in the order the raid meets them. */
  gates: ['hoh', 'hohb'],
  title: 'Temple of Marr trials',
};

export type TonightRow = { name: string; cls: string; pieces: PieceStatus[]; fix: string[]; ready: boolean; unsure: boolean };

/** Signed raiders by the pieces tonight needs: ✅ done, ❌ missing, ❓ not recorded. `fix` names the missing ones. */
export function tonightRows(): TonightRow[] {
  const ev = EVENTS.find(e => e.id === TONIGHT.eventId) as DemoEvent;
  return ev.signed.map(n => charByName(n) as DemoChar).map(c => {
    const pieces = TONIGHT.gates.flatMap(g => reportFor(c, g, 'planning').pieces);
    return {
      name: c.name, cls: c.cls, pieces,
      fix: pieces.filter(p => p.state === 'missing').map(p => p.label),
      ready: pieces.every(p => p.state === 'done'),
      unsure: pieces.some(p => p.state === 'unknown'),
    };
  });
}

// ─── Capture (a raid leader records flags for a character that is not theirs) ───────────────────

export const CAPTURE = {
  leader: 'Aldenmar',
  subject: 'Brackwyn',
  // Sentences as the Seer prints them (the opening of each is the one web/lib/popRecital.ts matches), with log timestamps.
  paste: [
    '[Sun Nov 01 21:14:02 2026] Saryrn been destroyed.',
    '[Sun Nov 01 21:14:02 2026] Mithaniel has been bested.',
    '[Sun Nov 01 21:14:03 2026] The Cipher of the Divine Language appears on your arms.',
  ].join('\n'),
};

// ─── Last raid (home page) ──────────────────────────────────────────────────────────────────────

export const LAST_RAID = {
  when: 'Sunday',
  fights: [
    { boss: 'Vallon Zek', time: '3:12', damage: '2.41M', top: 'Corvale', topDps: '38.2k', heals: 'Brackwyn' },
    { boss: 'Tallon Zek', time: '2:47', damage: '2.18M', top: 'Corvale', topDps: '41.0k', heals: 'Brackwyn' },
    { boss: 'Saryrn', time: '5:30', damage: '3.96M', top: 'Veyra', topDps: '27.4k', heals: 'Brackwyn' },
    { boss: 'Mithaniel Marr', time: '6:08', damage: '4.30M', top: 'Zarrin', topDps: '29.9k', heals: 'Brackwyn' },
  ],
};
