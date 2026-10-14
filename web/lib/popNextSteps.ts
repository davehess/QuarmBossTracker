// What each character does NEXT on each PoP progression line (the guild lead, 2026-10-10: "are we taking
// piecemeal flags? if so we should put at the top of the guide next steps for flags in a consolidated place").
//
// Yes, piecemeal: a flag reaches a character from four places, none of which sees the others — Mimic's own
// flag messages (pop_flags), a /who sighting inside a plane (pop_who_sightings), loot from a plane
// (pop_loot_sightings), and the owner's own ticks (pop_guide_ticks). web/lib/popGuideAuto.ts folds them into
// one set of ticked STEPS for the checklist; this file reads that same set (plus the flags themselves) and
// says what is left to do.
//
// ONE source of truth for prerequisites, and it is not here. Between PLANES it is the gate graph in
// popFlags.ts (POP_ZONES[].requires), and between flags it is GATE_IMPLIES in popWho.ts (what holding a
// server step proves was done before it). Steps carry no prerequisites of their own — the checklist's
// order and its prose ("Needs Mavuin's information first") are the only record — so the one thing authored
// here is NEXT_LINES: which guide steps make up each line and in what order. Everything it says about
// gating is read from the two tables above, never restated.
//
// What a line is. An ordered list of STAGES (a stage is one step, or several that can be done in any order,
// like the three Halls of Honor trials). A stage opens when the one before it is done and its plane's gate
// is met. Optional steps (keys, the Binden, the essences) and the story-only hails are left off: this is the
// flag path, and test/pop-next-steps.test.js holds every must-have step from tier one on to a line.
//
// Done is read three ways, strongest first: the step is ticked (by hand or by evidence), the flag the step
// grants is held, or a flag held later in the same progression implies it (the GATE_IMPLIES/gate closure).
//
// A step ticked out of order (the owner ticked the Grummus kill but never the ward talk before it): the
// later tick is trusted. Everything before the furthest stage with any progress counts as passed, so the
// line's next step is the first thing left AT or AFTER it, and the skipped steps are reported in `skipped`
// (never silently dropped) for the page to mention. That is the same rule the checklist already follows
// when a recorded flag ticks the steps before it (STEPS_BEFORE in popGuideAuto.ts).

import { GUIDE_ITEMS, ZONE_NAMES, type GuideItem, type Who } from './popGuide';
import { POP_FLAGS, POP_ZONE_BY_KEY, missingFor } from './popFlags';
import { GATE_IMPLIES, whoProves } from './popWho';
import { stepPlaces } from './popGuideMore';
import { flagForTickKey } from './popSelfFlags';

// zone   — the POP_ZONES key whose gate (`requires`) the stage sits behind; null = nothing gates it.
// steps  — GUIDE_ITEMS keys, any order inside the stage.
// flags  — catalog flags the stage earns that no guide step carries (the server's own step flags: Mimic and
//          the matrix can record them, the checklist has no box for them). Holding one completes the stage.
// needs  — extra flags the stage waits for that neither the gate nor GATE_IMPLIES says. Used twice, both
//          from the guide itself: Maelin's second reading follows the Zek notes (its comment says the order
//          matters), and the Quintessence is the four elemental gods' essences (the Time section's blurb).
export type Stage = { zone: string | null; steps: string[]; flags?: string[]; needs?: string[] };
export type NextLine = { key: string; label: string; short: string; stages: Stage[] };

export const NEXT_LINES: NextLine[] = [
  { key: 'decay', label: 'Disease to Decay', short: 'Decay', stages: [
    { zone: 'disease', steps: ['disease_ward'] },
    { zone: 'disease', steps: ['flag_grummus'] },
    { zone: 'cod', steps: ['cod_fuirstel_before'] },
    { zone: 'cod', steps: ['flag_carprin'] },
    { zone: 'codb', steps: ['flag_bert'] },
    { zone: 'codb', steps: ['cod_fuirstel_after'], flags: ['fuirstel_5'] },
  ] },
  { key: 'justice', label: 'Justice flag', short: 'Justice', stages: [
    { zone: 'justice', steps: ['justice_mavuin_info'] },
    { zone: 'justice', steps: ['flag_trial_justice'] },
    { zone: 'justice', steps: ['justice_tribunal'] },
    { zone: 'justice', steps: ['justice_mavuin_hail'] },
  ] },
  { key: 'innovation', label: 'Innovation', short: 'Innovation', stages: [
    { zone: 'innovation', steps: ['innovation_test'] },
    { zone: 'innovation', steps: ['flag_behemoth'] },
  ] },
  { key: 'nightmare', label: 'Nightmare to Terris Thule', short: 'Nightmare', stages: [
    { zone: 'nightmare', steps: ['nightmare_adroha'] },
    { zone: 'nightmare', steps: ['flag_hedge'] },
    { zone: 'ponb', steps: ['flag_tthule'] },
    { zone: 'ponb', steps: ['nightmare_poxbourne'], flags: ['thelin_4'] },
  ] },
  { key: 'storms', label: 'Storms to Thunder', short: 'Storms', stages: [
    { zone: 'storms', steps: ['flag_askr'] },
    { zone: 'storms', steps: ['storms_zone_bot'] },
    { zone: 'bot', steps: ['bot_tower'] },
    { zone: 'bot', steps: ['flag_agnarr'] },
  ] },
  { key: 'valor', label: 'Valor to Honor', short: 'Valor', stages: [
    { zone: 'valor', steps: ['flag_aerindar'] },
    { zone: 'hoh', steps: ['valor_zone_hoh'] },
    { zone: 'hoh', steps: ['hoh_trial_dragon', 'hoh_trial_villagers', 'hoh_trial_villager'], flags: ['hoh_trials'] },
    { zone: 'hohb', steps: ['flag_marr'] },
  ] },
  { key: 'torment', label: 'Torment', short: 'Torment', stages: [
    { zone: 'torment', steps: ['torment_fahlia'] },
    { zone: 'torment', steps: ['flag_saryrn'] },
  ] },
  { key: 'tactics', label: 'Tactics, the Zeks', short: 'Tactics', stages: [
    { zone: 'tactics', steps: ['tactics_maelin_before'] },
    { zone: 'tactics', steps: ['flag_vallon', 'flag_tallon'] },
    { zone: 'tactics', steps: ['zeks_maelin'] },
    { zone: 'tactics', steps: ['flag_rallos'] },
    { zone: 'tactics', steps: ['tactics_maelin_after'] },
  ] },
  { key: 'maelin', label: 'Maelin: cipher and power source', short: 'Maelin', stages: [
    { zone: null, steps: ['maelin_cipher'] },
    { zone: null, steps: ['maelin_lore'] },
    { zone: null, steps: ['zebuxoruk_maelin'], needs: ['zeks_6'] },
  ] },
  { key: 'solro', label: 'Sol Ro to Fire', short: 'Sol Ro', stages: [
    { zone: 'solro', steps: ['pofire_miak'] },
    { zone: 'solro', steps: ['flag_solro_minis'] },
    { zone: 'solro', steps: ['flag_solro'] },
    { zone: 'fire', steps: ['flag_fennin'] },
  ] },
  { key: 'air', label: 'Plane of Air', short: 'Air', stages: [
    { zone: 'air', steps: ['flag_avatars_air'] },
    { zone: 'air', steps: ['flag_xegony'] },
  ] },
  { key: 'water', label: 'Plane of Water', short: 'Water', stages: [
    { zone: 'water', steps: ['flag_coirnav'] },
  ] },
  { key: 'earth', label: 'Plane of Earth', short: 'Earth', stages: [
    { zone: 'earth', steps: ['flag_arbitor'] },
    { zone: 'poeb', steps: ['flag_rathe'] },
  ] },
  { key: 'time', label: 'Plane of Time', short: 'Time', stages: [
    // The Quintessence is four elemental essences, so it waits on the four gods the time flag implies.
    { zone: null, steps: ['time_quintessence'], needs: GATE_IMPLIES.time_1 },
    { zone: null, steps: ['time_muon'] },
    { zone: 'time', steps: ['flag_quarm'] },
  ] },
];

export type NextInput = {
  /** Guide step keys that are done: hand ticks plus everything evidence proved (the checklist's own `done`).
   *  A `flag:<key>` tick (a flag no step names) counts as that flag. */
  done: Iterable<string>;
  /** Catalog flags known without a step: pop_flags rows, and what /who and loot prove. */
  flags?: Iterable<string>;
};

export type NextStep = {
  key: string;
  title: string;            // the checklist's title, item tokens turned back into names
  who: Who;
  must: boolean;
  flag: string | null;      // the catalog flag this step grants, when the guide names one
  flagLabel: string | null;
  zone: string | null;      // where the step starts (its first placed NPC), else the plane its stage opens; null when neither
  verify: boolean;          // the guide marks the detail as not yet confirmed on Quarm
};
export type Blocker = { flag: string; label: string; line: string | null; lineLabel: string | null; lineShort: string | null };
export type LineNext = {
  line: string;
  label: string;
  short: string;
  state: 'done' | 'next' | 'blocked';
  steps: NextStep[];        // next: what can be done now. blocked: what would be next once unblocked. done: empty
  blockedOn: Blocker[];     // blocked only
  skipped: string[];        // step keys before the furthest progress that were never ticked
  done: number;             // steps behind the character on this line (ticked, flagged or passed)
  total: number;
};

const ITEM_TOKEN = /\[\[([^\]#]+)#\d+\]\]/g;
const ITEM_BY_KEY = new Map<string, GuideItem>(GUIDE_ITEMS.map(i => [i.key, i]));
const ORDER = new Map<string, number>(GUIDE_ITEMS.map((i, n) => [i.key, n]));

// Which line grants a flag, so "needs X" can say where X comes from.
const LINE_OF_FLAG = new Map<string, NextLine>();
for (const line of NEXT_LINES) {
  for (const st of line.stages) {
    for (const f of st.flags ?? []) if (!LINE_OF_FLAG.has(f)) LINE_OF_FLAG.set(f, line);
    for (const k of st.steps) {
      const f = ITEM_BY_KEY.get(k)?.flag;
      if (f && !LINE_OF_FLAG.has(f)) LINE_OF_FLAG.set(f, line);
    }
  }
}

// A flag held proves every flag behind it: what GATE_IMPLIES says it implies, and everything the plane it
// was earned in needed to get into (whoProves, the same walk /who sightings use).
function closeFlags(seed: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const add = (f: string) => {
    if (out.has(f)) return;
    out.add(f);
    for (const g of GATE_IMPLIES[f] ?? []) add(g);
    const zone = POP_FLAGS[f]?.zone;
    if (zone && POP_ZONE_BY_KEY[zone]) for (const g of whoProves(zone)) add(g);
  };
  for (const f of seed) add(f);
  return out;
}

const plainTitle = (t: string) => t.replace(ITEM_TOKEN, '$1');

function describe(item: GuideItem, stage: Stage): NextStep {
  const place = stepPlaces(item)[0];
  const stageZone = stage.zone ? POP_ZONE_BY_KEY[stage.zone]?.name ?? null : null;
  return {
    key: item.key,
    title: plainTitle(item.title),
    who: item.who,
    must: !!item.must,
    flag: item.flag ?? null,
    flagLabel: item.flag ? POP_FLAGS[item.flag]?.label ?? item.flag : null,
    zone: place ? ZONE_NAMES[place.zone] ?? null : stageZone,
    verify: !!item.check,
  };
}

// What stops a step: the plane's gate flags it lacks, the flags the stage waits for, and the flags that
// holding what this step grants would imply were done first.
function blockersFor(stage: Stage, item: GuideItem, held: ReadonlySet<string>): Blocker[] {
  const need = new Set<string>();
  const zone = stage.zone ? POP_ZONE_BY_KEY[stage.zone] : undefined;
  if (zone) for (const f of missingFor(zone, held as Set<string>)) need.add(f);
  for (const f of stage.needs ?? []) if (!held.has(f)) need.add(f);
  for (const g of [...(stage.flags ?? []), ...(item.flag ? [item.flag] : [])]) {
    for (const f of GATE_IMPLIES[g] ?? []) if (!held.has(f)) need.add(f);
  }
  return [...need].map(flag => {
    const line = LINE_OF_FLAG.get(flag);
    return { flag, label: POP_FLAGS[flag]?.label ?? flag, line: line?.key ?? null, lineLabel: line?.label ?? null, lineShort: line?.short ?? null };
  });
}

/** The next actionable step(s) on every progression line, in NEXT_LINES order. */
export function nextSteps(inp: NextInput): LineNext[] {
  const doneKeys = new Set(inp.done);
  const seed = new Set(inp.flags ?? []);
  for (const k of doneKeys) { const f = flagForTickKey(k); if (f) seed.add(f); }

  const stepDone = (k: string, held: ReadonlySet<string>) => {
    const f = ITEM_BY_KEY.get(k)?.flag;
    return doneKeys.has(k) || (!!f && held.has(f));
  };
  const flagsHeld = (st: Stage, held: ReadonlySet<string>) => !!st.flags?.length && st.flags.every(f => held.has(f));

  // A stage that is complete earns its flags, which can finish the stage after it: settle to a fixed point.
  let held = closeFlags(seed);
  for (let round = 0; round < 8; round++) {
    const size = held.size;
    const earned: string[] = [];
    for (const line of NEXT_LINES) {
      for (const st of line.stages) if (st.flags && st.steps.every(k => stepDone(k, held))) earned.push(...st.flags);
    }
    held = closeFlags([...held, ...earned]);
    if (held.size === size) break;
  }

  return NEXT_LINES.map(line => {
    const { stages } = line;
    const complete = (st: Stage) => st.steps.every(k => stepDone(k, held)) || flagsHeld(st, held);
    const progressed = (st: Stage) => st.steps.some(k => stepDone(k, held)) || flagsHeld(st, held);
    const total = stages.reduce((n, st) => n + st.steps.length, 0);

    let furthest = -1;
    stages.forEach((st, n) => { if (progressed(st)) furthest = n; });
    let start = Math.max(furthest, 0);
    while (start < stages.length && complete(stages[start])) start++;

    const base = { line: line.key, label: line.label, short: line.short, total };
    if (start >= stages.length) return { ...base, state: 'done' as const, steps: [], blockedOn: [], skipped: [], done: total };

    const skipped: string[] = [];
    let behind = 0;
    stages.forEach((st, n) => {
      if (n < start) {
        behind += st.steps.length;
        if (!complete(st)) skipped.push(...st.steps.filter(k => !stepDone(k, held)));
      } else {
        behind += st.steps.filter(k => stepDone(k, held)).length;
      }
    });

    const stage = stages[start];
    const pending = stage.steps.filter(k => !stepDone(k, held)).sort((a, b) => (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0));
    const open = pending.filter(k => blockersFor(stage, ITEM_BY_KEY.get(k)!, held).length === 0);
    if (open.length > 0) {
      return { ...base, state: 'next' as const, steps: open.map(k => describe(ITEM_BY_KEY.get(k)!, stage)), blockedOn: [], skipped, done: behind };
    }
    const blockedOn = new Map<string, Blocker>();
    for (const k of pending) for (const b of blockersFor(stage, ITEM_BY_KEY.get(k)!, held)) blockedOn.set(b.flag, b);
    return {
      ...base, state: 'blocked' as const, steps: pending.map(k => describe(ITEM_BY_KEY.get(k)!, stage)),
      blockedOn: [...blockedOn.values()], skipped, done: behind,
    };
  });
}

/** The same, from a route character as the page loads it: hand ticks, evidence by step, and flags. */
export function charNextSteps(c: { manual: string[]; auto: Record<string, unknown>; flags?: string[] }): LineNext[] {
  return nextSteps({ done: [...c.manual, ...Object.keys(c.auto)], flags: c.flags });
}

/** The few steps to put first: one per line that has something to do, must-haves before the rest, then in
 *  the guide's own order (tier one before tier two). */
export function topNext(lines: LineNext[], max = 5): { line: LineNext; step: NextStep }[] {
  return lines
    .filter(l => l.state === 'next')
    .map(l => ({ line: l, step: l.steps[0] }))
    .sort((a, b) => Number(b.step.must) - Number(a.step.must) || (ORDER.get(a.step.key) ?? 0) - (ORDER.get(b.step.key) ?? 0))
    .slice(0, max);
}

/** Variant A's card for one character, small enough to hand to the browser (the page's client component
 *  takes this and never loads the guide catalog for it). `more` counts lines with a step to do that the
 *  card's cap left off. */
export type NextCard = {
  top: { line: string; label: string; step: NextStep }[];
  more: number;
  blocked: { line: string; label: string; short: string; blockedOn: Blocker[] }[];
  finished: number;
  lines: number;
  skipped: number;
};
export function nextCard(lines: LineNext[], max = 5): NextCard {
  const top = topNext(lines, max);
  const open = lines.filter(l => l.state === 'next').length;
  return {
    top: top.map(t => ({ line: t.line.line, label: t.line.label, step: t.step })),
    more: open - top.length,
    blocked: lines.filter(l => l.state === 'blocked').map(l => ({ line: l.line, label: l.label, short: l.short, blockedOn: l.blockedOn })),
    finished: lines.filter(l => l.state === 'done').length,
    lines: lines.length,
    skipped: lines.reduce((n, l) => n + l.skipped.length, 0),
  };
}

/** The `?nx=` switch: 'a' or 'b' show a panel, anything else (absent, 'c', a repeated param) shows none, so
 *  the page without it stays exactly what production has. */
export function nxMode(raw: unknown): 'a' | 'b' | null {
  return raw === 'a' || raw === 'b' ? raw : null;
}
