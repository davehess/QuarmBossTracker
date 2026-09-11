// Mimic mini-mode review — the catalog behind wolfpack.quest/mimic/mini.
//
// Pure data + validators, no React and no Supabase, so the server actions and
// the tests share ONE definition of what an overlay key and a choice are. The
// page shows each overlay in full next to three mini renditions; members vote
// for one and leave feedback that stays on the page (Hitya 2026-09-11: "the
// guild's opinions matter here").
//
// Costs are the four numbers the UI-options rule asks for: build (time to get
// right), maintenance (how much it breaks as requirements move), runtime
// (render weight on a 2s poll), change (how painful to revise later).

export type Choice = 'a' | 'b' | 'c';
export const CHOICES: readonly Choice[] = ['a', 'b', 'c'] as const;

export type CostLevel = 'low' | 'med' | 'high';
export type Cost = { build: CostLevel; maint: CostLevel; runtime: CostLevel; change: CostLevel; why?: string };

export type OptionSpec = {
  key: Choice;
  name: string;
  how: string[];
  cost: Cost;
};

export type OverlaySpec = {
  key: string;
  title: string;
  file: string;
  ask: string;
  /** What the Zeal 1.4.6 + Mimic 2.6.7 toggle changes for this overlay. */
  zeal: string;
  /** Optional non-voted change riding along with this overlay. */
  also?: string;
  options: OptionSpec[];
};

export const FEEDBACK_MAX = 1000;

// Character names on the mocks are real raiders from the last raid's roster
// (raid_roster, 2026-09-10) and the Kaas Thox parse of the same night — the
// page is member-only, and these are the names members already see on
// /parses and /who. Pet names are from character_live_state.
export const CAST = {
  mt: 'Currygoat', mt2: 'Hoden',
  clerics: ['Stupidrichard', 'Uilnayar', 'Mcdorf', 'Fargan', 'Bwavair'],
  me_cleric: 'Fargan',
  shamans: ['Ghalix', 'Utoh', 'Fungalfist'],
  enchanter: 'Menttok',
  mage: 'Samara', magePet: 'Lobarab',
  me_dps: 'Fittir',
  boss: 'Kaas Thox Xi Aten Ha Ra', bossShort: 'Kaas Thox',
  groups: { Currygoat: 1, Hoden: 2, Fittir: 3, Fawx: 3, Lucker: 4, Wabumkin: 5, Dant: 4, Syko: 2, Kravenn: 6, Ashieron: 1 } as Record<string, number>,
} as const;

// Real Kaas Thox parse, 2026-09-10 — 149s, 5.41M, 59 players. Top ten by damage.
export const KAAS_PARSE = {
  boss: 'Kaas Thox', durationSec: 149, total: 5407812,
  rows: [
    ['Wabumkin', 924662], ['Jankzer', 370616], ['Damyu', 296399], ['Statlander', 274116],
    ['Atlasius', 271157], ['Pyxil', 254835], ['Lenolshot', 252961], ['Lutharion', 231898],
    ['Fittir', 225356], ['Kravenn', 179997],
  ] as [string, number][],
};

export const OVERLAYS: OverlaySpec[] = [
  {
    key: 'tank', title: 'Tank', file: 'tank.html',
    ask: 'Just the mob and the tank, ramp if there is ramp, and the damage-shield total returned per hit in a spiky box right of the tank.',
    zeal: 'Same either way — this overlay is driven by the log and the CH-chain target, not by spawn ids.',
    options: [
      { key: 'a', name: 'One strip', how: [
          'Tank HP is the bar; the mob is named, not barred (its HP lives on Target info).',
          'Spiky box is the DS total this fight; it dims when no DS buff is up.',
          'Ramp row appears only while rampage has a target. One row, two at worst.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'compact template of data the overlay already has' } },
      { key: 'b', name: 'Two lanes', how: [
          'Mob HP barred too, so enrage and burn calls read here without another overlay.',
          'Two rows always, three with rampage.',
          'Loses the "tank on mob" arrow; the pairing is implied by stacking.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'same data, one more row' } },
      { key: 'c', name: 'Always one row', how: [
          'Rampage never adds a row: it becomes a red chip on the same line with the target and their HP.',
          'Height is fixed no matter what the fight does, so nothing under it ever moves.',
          'The DA countdown and the "start CH on…" call shrink to the chip text — quieter than today.',
        ], cost: { build: 'low', maint: 'med', runtime: 'low', change: 'med', why: 'every future add fights for one row' } },
    ],
  },
  {
    key: 'target', title: 'Target info', file: 'mobinfo.html',
    ask: 'Mini is mob health plus slow and root timers. In full mode resists show the current value after the debuffs the mob carries, full value underneath in parentheses.',
    zeal: 'With Zeal 1.4.6 the debuffs and timers are the ones on THIS spawn. On older Zeal they are keyed by name, so with same-name mobs up the slow you see may be another mob\'s — the * says so.',
    options: [
      { key: 'a', name: 'One row, pills', how: [
          'SLOW pill in the ext-target amber, ROOT in blue (purple stays reserved for mez).',
          '"no slow" is spelled out, because an absent pill reads as "not tracked".',
          'Under 12s left the digits go red. No bar to watch drain.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'slow badge logic exists (#130)' } },
      { key: 'b', name: 'Two rows, draining timers', how: [
          'Time-left reads from bar length in peripheral vision; digits are the backup.',
          'Two extra rows while both are up; rows collapse when nothing is landed.',
          'Bars drain every poll: more repaints than A, only on this overlay.',
        ], cost: { build: 'low', maint: 'low', runtime: 'med', change: 'low', why: 'repaints while timers run' } },
      { key: 'c', name: 'Hairlines under the bar', how: [
          'Slow and root are 2px lines under the HP bar, amber and blue, no digits at all.',
          'Smallest possible: one row, always. Hover shows the numbers.',
          'You learn to read line length; a new user gets nothing from it for a week.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'least markup of the three' } },
    ],
  },
  {
    key: 'ch', title: 'CH chain', file: 'chchain.html',
    ask: 'Either focus on the healer themselves, or a per-healer timeline scrolling right to left: middle is cast start, left edge is the land. Orange getting ready, blue casting, red interrupted, green when it lands. Main tank health stays.',
    zeal: 'Same either way — the chain is read from the log.',
    options: [
      { key: 'a', name: 'Me and the tank', how: [
          'Two rows: the tank, and my own slot in whatever state the full overlay computes (next / casting / interrupted / GO).',
          'Cast bar keeps its right-to-left fill. Nothing else moves.',
          'Loses sight of the other healers; the full overlay is one hotkey away.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'filter rows to self' } },
      { key: 'b', name: 'Timeline lanes', how: [
          'Left half is the 10s cast: a blue block grows leftward from the centre line, flashes green at the edge. Interrupted freezes red where it died.',
          'Right half is the queue: orange blocks slide toward the centre as each turn comes.',
          'One lane per healer, 15px each. Every state visible at once; smooth needs a 100ms local tick.',
        ], cost: { build: 'high', maint: 'med', runtime: 'med', change: 'med', why: 'new geometry and a local ticker' } },
      { key: 'c', name: 'Rotation ladder', how: [
          'One line per healer in rotation order: a state dot, the name, and seconds. Only the caster gets a bar.',
          'The whole chain in the height of the names list; the tank row on top.',
          'No motion except the one cast bar — the calmest of the three.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'today\'s rows minus their bars' } },
    ],
  },
  {
    key: 'charm', title: 'Charm', file: 'charm.html',
    ask: 'Timer and time left first; charm pet health and its target; the mob\'s magic resist with debuffs factored in.',
    zeal: 'With Zeal 1.4.6 the pet is one exact spawn, so its MR-with-debuffs is its own. On older Zeal a same-name mob\'s Tash can be counted against your pet — the * marks it.',
    options: [
      { key: 'a', name: 'Two rows', how: [
          'Row one is the pet: HP bar, name, what it is hitting. Row two is the charm timer as a draining purple bar, MR at the right.',
          'MR uses the same current-over-full treatment as Target info.',
          'Existing tick pips and BROKE badge are dropped; the bar is the timer.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'data already on the row' } },
      { key: 'b', name: 'One row, timer is the bar', how: [
          'Half the height of A. Pet HP is a coloured number, not a bar.',
          'Runs out of width fast: a long pet name plus a long target pushes MR off the row.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'med', why: 'every add fights for one row' } },
      { key: 'c', name: 'Big countdown', how: [
          'The seconds left are the overlay: 18px digits readable from across the room, HP as a hairline underneath, MR as a chip.',
          'Pet target moves to the tooltip. Two rows tall but half the width.',
          'Built for the bard tempo: the number is what you recharm on.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'one number, one line' } },
    ],
  },
  {
    key: 'ext', title: 'Extended target', file: 'extarget.html',
    ask: 'Still every currently targeted mob, but with debuffs minimized: mob name, mob health, mob target.',
    zeal: 'The biggest difference on the page. With Zeal 1.4.6 two "an elder thought horror" are two rows with their own HP and target. On older Zeal they collapse into one name-keyed row with a *, and the HP shown is whichever one the pipe saw last.',
    options: [
      { key: 'a', name: 'CC letters + count', how: [
          'Debuff chips fold into a single count; SLOW and MEZ keep one-letter pills because they change what a raider does next.',
          'Sorted as today (raiders on it). Same-name mobs keep their spawn-id split.',
          'Hover a row for the full chip list; nothing expands.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'chip classifier exists (#143)' } },
      { key: 'b', name: 'No debuff info', how: [
          'The literal spec. Widest bars, quietest rows.',
          'A mezzed mob and an unmezzed one look identical, which is the one thing this overlay is watched for during a split pull.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low' } },
      { key: 'c', name: 'Grouped by name', how: [
          'One row per mob NAME with a ×N count and the lowest HP in the group; expand a row to see each spawn.',
          'Shortest list on a 12-mob pull. Needs Zeal 1.4.6 to know N at all — on older Zeal every group is ×1.',
          'Trades "which one is Currygoat on" for "how many are left".',
        ], cost: { build: 'med', maint: 'med', runtime: 'low', change: 'med', why: 'a second grouping pass over the rows' } },
    ],
  },
  {
    key: 'pet', title: 'Pet', file: 'pets.html',
    ask: 'Health, target, haste percentage.',
    zeal: 'Same either way — pet HP comes from the pipe\'s pet gauge on every Zeal, and the target from the "Attacking X Master." line.',
    options: [
      { key: 'a', name: 'One row per pet', how: [
          'Haste reads from the pet\'s active haste buff. The percentage needs that buff\'s haste value from the spell catalog; today the chip only knows the name.',
          'Under 10s of haste left the chip goes amber; fell-off goes purple, as the buff chips do now.',
        ], cost: { build: 'med', maint: 'low', runtime: 'low', change: 'low', why: 'haste % lookup' } },
      { key: 'b', name: 'Haste as a second bar', how: [
          'Shows time left on the haste as well as the percentage. Two rows per pet.',
          'Only earns its row for classes that rebuff pet haste mid-fight.',
        ], cost: { build: 'med', maint: 'low', runtime: 'low', change: 'low' } },
      { key: 'c', name: 'Two numbers', how: [
          'No name, no bar: HP% and ⚡% as two coloured numbers plus the target. The pet is yours; you know its name.',
          'Fits in the width of the ✥ and ✕ buttons. The smallest thing on the page.',
        ], cost: { build: 'med', maint: 'low', runtime: 'low', change: 'low', why: 'same lookup as A, less markup' } },
    ],
  },
  {
    key: 'dps', title: 'DPS / Tank meter', file: 'overlay.html',
    ask: 'Mini focuses on the user directly. In every mode the player\'s own spot is shown if they have done damage (DPS) or taken damage (Tank).',
    zeal: 'Same either way — the meter is the log.',
    also: 'Also changing, no vote: the /rs button shrinks to the tab size and shows only 📋 (then ✓ for two seconds), and the copied line ends in "| local" or "| merged" so the paste says what it is — once the bot\'s chat parser is checked to accept the extra token.',
    options: [
      { key: 'a', name: 'My line', how: [
          'One row: rank, name, fight, total, rate, share of raid. The share bar is the only bar.',
          'Follows whichever tab was last picked; tab strip and row counter hide in mini.',
          'Full mode gets the same pin on the Tank tab that DPS already has (the dashed "me" row below the top N).',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'row exists, pin it' } },
      { key: 'b', name: 'Me and my neighbours', how: [
          'Three rows: the person I am chasing, me, the person chasing me. The race is the point of a meter.',
          'Triple the height of A; neighbours churn every poll, so rows swap under the eye.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low' } },
      { key: 'c', name: 'My line + the gap', how: [
          'My row, plus how far I am behind the person above me and whether the gap is closing (↑) or opening (↓).',
          'One row, and the number that actually changes behaviour mid-fight.',
          'The arrow needs two polls of history; it is blank for the first 4s of a fight.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'one subtraction per poll' } },
    ],
  },
  {
    key: 'pop', title: 'PoP raids', file: 'popraid.html',
    ask: 'Mini is just the checklist and the link to the page.',
    zeal: 'Same either way.',
    options: [
      { key: 'a', name: 'Checklist rows', how: [
          'The raid-wide shared checkboxes, nothing else: no slide, no notes, no loot, no picker. Encounter follows the one the full overlay was on.',
          '↗ opens the same page the full overlay hotlinks. Clicking a row still checks it for the whole raid.',
          'Height is the number of objectives; four to six rows on most fights.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low', why: 'tracker block already renders alone' } },
      { key: 'b', name: 'One line, expands on click', how: [
          'One row with a 2/4 count until you click it; then the list drops down and folds back when everything is checked.',
          'Hides which objective is open, which is what a raid leader glances for.',
        ], cost: { build: 'low', maint: 'low', runtime: 'low', change: 'low' } },
      { key: 'c', name: 'Next open objective', how: [
          'One row: the count and the NEXT unchecked objective only. Check it and the row advances.',
          'Reads as a prompt, not a list — "what do we do now".',
          'Order matters, so objectives need a sort the data does not carry today.',
        ], cost: { build: 'med', maint: 'med', runtime: 'low', change: 'low', why: 'objectives need an order' } },
    ],
  },
  {
    key: 'buff', title: 'Buff queue', file: 'buffqueue.html',
    ask: 'Too much information to minimize. Instead show how many characters need each buff type or cure; click a category to expand who needs it and which group they are in.',
    zeal: 'Same either way.',
    options: [
      { key: 'a', name: 'Chip rows', how: [
          'Two chip rows, cures first as today. Counts are characters, sorted by the queue\'s own priority.',
          'One category open at a time; the open state survives repaints.',
          'Categories come from the overlay\'s existing name → family map; unknown spells fall into Other.',
        ], cost: { build: 'med', maint: 'low', runtime: 'low', change: 'low', why: 'group by family, expand state' } },
      { key: 'b', name: 'Two-column ledger', how: [
          'Buffs down the left, cures down the right, each a fixed column so a category is always in the same place.',
          'Taller than A as soon as one side has more than two categories, which is every raid.',
        ], cost: { build: 'med', maint: 'low', runtime: 'low', change: 'low' } },
      { key: 'c', name: 'By group', how: [
          'A row of group tiles G1…G6 showing how many buffs each group is missing; click a group to see who needs what.',
          'Matches how a buffer actually moves: group to group, not spell to spell.',
          'Cures lose their top-of-list priority unless they get their own tile.',
        ], cost: { build: 'med', maint: 'med', runtime: 'low', change: 'med', why: 'a second pivot of the same queue' } },
    ],
  },
];

export const OVERLAY_KEYS: readonly string[] = OVERLAYS.map(o => o.key);

export function isOverlayKey(k: unknown): k is string {
  return typeof k === 'string' && OVERLAY_KEYS.includes(k);
}

export function isChoice(c: unknown): c is Choice {
  return typeof c === 'string' && (CHOICES as readonly string[]).includes(c);
}

export function cleanFeedback(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const s = typeof body === 'string' ? body.replace(/\s+$/g, '').replace(/^\s+/g, '') : '';
  if (!s) return { ok: false, error: 'Write something first.' };
  if (s.length > FEEDBACK_MAX) return { ok: false, error: `Keep it under ${FEEDBACK_MAX} characters.` };
  return { ok: true, body: s };
}

export type VoteRow = { overlay: string; user_id: string; choice: string; voter_name: string | null };
export type FeedbackRow = { id: string; overlay: string; user_id: string; author: string; choice: string | null; body: string; created_at: string };

/** votes → { overlay: { a: n, b: n, c: n } } — unknown overlays/choices are ignored. */
export function tally(votes: { overlay: string; choice: string }[]): Record<string, Record<Choice, number>> {
  const out: Record<string, Record<Choice, number>> = {};
  for (const k of OVERLAY_KEYS) out[k] = { a: 0, b: 0, c: 0 };
  for (const v of votes) {
    if (!isOverlayKey(v.overlay) || !isChoice(v.choice)) continue;
    out[v.overlay][v.choice] += 1;
  }
  return out;
}
