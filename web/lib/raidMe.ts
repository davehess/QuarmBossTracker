// /pop/raid/me, "Your flags for tonight" (the guild lead, 2026-10-26: "people sign up for raids as their class, which
// can be an alt and not their main ... we could give them a custom link that shows all of their characters and which
// steps they specifically need to do for theirs if flagging"; then "A for link with a copy/paste box for the seer's
// info or popflags content"). The pure parts: which character a sign-up brings, which characters are shown, and the
// step list for one character. No database here, so a test runs all of it; the reads are in lib/raidMeLoad.ts.
//
// The step list is ONE function with a source, so the page does not care where the steps come from:
//   'night' — the night's preflags (PREFLAGS in lib/raidPlan.ts), each done or still needed. Static for one night
//             until the officers' page that picks targets exists; that page will replace this source.
//   'next'  — each progression line's next step (lib/popNextSteps.ts, the engine the /pop sidebar uses).
// `held` is what lib/raidPreflags.ts loadHeld returns for the character: step keys and catalog flags, already
// expanded by stepsHeld.

// Relative imports on purpose: test/pop-raid-me.test.js loads this file as it is, with no `@/` alias.
import { NOT_GOING, PREFLAGS, isPlanNight, loc, pickSignupCharacter, type Preflag } from './raidPlan';
import { RAIDER_RANKS } from './popRoster';
import { tierOf } from './listableChars';
import { nextSteps, type LineNext } from './popNextSteps';

export type MeStep = {
  key: string;
  label: string;
  /** What it is for ("Lair of Terris Thule"), when known. */
  target: string | null;
  done: boolean;
  /** `/loc Y, X` of the NPC to stand at, when the plan has one. */
  loc: string | null;
  /** The words to say, in order (hail first when `note` says so). */
  say: string[];
  note: string | null;
};

export type StepSource = 'night' | 'next';
export const DEFAULT_STEP_SOURCE: StepSource = 'night';

/** The `?steps=` switch: anything but 'next' is the default source. The night's preflags are only that night's: an event
 *  on any other night (or none) gets each line's next step instead, so an old plan never reads as tonight's. */
export const stepSourceFrom = (raw: unknown, eventStart: string | null): StepSource =>
  (raw === 'next' || !eventStart || !isPlanNight(eventStart) ? 'next' : DEFAULT_STEP_SOURCE);

// Where to stand and what to say for each night preflag. Every value is copied from lib/raidPlan.ts (the `why` text
// of the same preflag names the same place; test/pop-raid-me.test.js holds the two together) or from popSteps.ts
// (Mavuin). A step the plan gives no place for has none here: nothing is invented.
type How = { at?: [number, number]; say?: string[]; note?: string };
const HOW: Record<string, How> = {
  fuirstel_1: { at: [-1467, 1786], say: ['ward'], note: 'Adler Fuirstel, in Tranquility. Hail him first.' },
  poi_door_1: { note: 'Kill Xanamech; Nitram opens the door.' },
  zeks_1: { at: [49, -52], say: ['great warrior', 'task', 'test the machine'], note: 'Giwin Mirakon, in Innovation. Hail him first.' },
  thelin_1: { at: [-1428, -258], say: ['tortured by nightmares'], note: 'Adroha, in Tranquility. Before the hedge maze.' },
  thelin_2: { at: [-1519, 1104], say: ['ready'], note: 'Thelin Poxbourne starts the hedge maze; hail him again at the end.' },
  mavuin_3: { say: ['Mavuin'], note: 'Say it to the Tribunal, then hail Mavuin.' },
};

/** The night's preflags as a character's to-do list: done when the character holds the step. */
export function nightSteps(held: ReadonlySet<string>, preflags: Preflag[] = PREFLAGS): MeStep[] {
  return preflags.map(p => {
    const how = HOW[p.key];
    return {
      key: p.key,
      label: p.label,
      target: p.target,
      done: held.has(p.key),
      loc: how?.at ? loc(how.at[0], how.at[1]) : null,
      say: how?.say ?? [],
      note: how?.note ?? null,
    };
  });
}

/** Each progression line as one row: a finished line is done, a line with something to do lists those steps, a
 *  line stuck behind a gate says what it waits on. */
export function nextLineSteps(lines: LineNext[]): MeStep[] {
  const out: MeStep[] = [];
  for (const l of lines) {
    if (l.state === 'done') {
      out.push({ key: `line:${l.line}`, label: l.label, target: null, done: true, loc: null, say: [], note: null });
    } else if (l.state === 'next') {
      for (const s of l.steps) {
        out.push({ key: s.key, label: s.title, target: l.label, done: false, loc: null, say: [], note: s.zone });
      }
    } else {
      const on = l.blockedOn[0]?.label;
      out.push({ key: `line:${l.line}`, label: l.label, target: null, done: false, loc: null, say: [], note: on ? `Waiting on ${on}` : 'Waiting on a gate' });
    }
  }
  return out;
}

/** The step list for one character, from whichever source the page is set to. */
export function stepsFor(source: StepSource, held: ReadonlySet<string>): MeStep[] {
  return source === 'next' ? nextLineSteps(nextSteps({ done: [], flags: [...held] })) : nightSteps(held);
}

export const stepsLeft = (steps: MeStep[]): number => steps.filter(s => !s.done).length;

// ── Which characters ────────────────────────────────────────────────────────────────────────────────────────────

export type OwnedLike = { name: string; main_name: string | null; class: string | null; active: boolean; rank: string | null; hidden_from_lists: boolean | null };
export type ShownChar = { name: string; cls: string | null; level: number | null; isMain: boolean; bringing: boolean };

const isMainOf = (c: { name: string; main_name: string | null }) => !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase();

/** The character a sign-up brings: the one of the class they signed up as (pickSignupCharacter says how). A sign-up
 *  that is not a yes (absent, declined, bench, tentative) brings no one. */
export function bringingFrom(owned: OwnedLike[], signup: { status: string | null; class_name: string | null } | null): OwnedLike | null {
  if (!signup) return null;
  if (NOT_GOING.test(String(signup.status || '')) || NOT_GOING.test(String(signup.class_name || ''))) return null;
  return pickSignupCharacter(owned, signup.class_name, RAIDER_RANKS);
}

/** Which characters the page lists. Traders, characters their owner hid and characters under the PoP floor are left
 *  out (web/lib/listableChars.ts, the same rule as /pop and the checklist); the one a sign-up brings is always
 *  kept, and so is everyone when every one would be hidden. Main first, then active, then by name. Characters with
 *  no known level stay (not proof of a low level). `bringing` is the first element's flag, not a second list. */
export function chooseCharacters(owned: OwnedLike[], levels: ReadonlyMap<string, number>, bringing: string | null): ShownChar[] {
  const levelOf = (c: OwnedLike) => levels.get(c.name.toLowerCase()) ?? null;
  const hidden = (c: OwnedLike) => tierOf({ rank: c.rank, level: levelOf(c), hidden: c.hidden_from_lists }) === 'hidden';
  const bring = bringing?.toLowerCase() ?? null;
  const all = owned.every(hidden);
  return owned
    .filter(c => all || !hidden(c) || c.name.toLowerCase() === bring)
    .sort((a, b) => Number(isMainOf(b)) - Number(isMainOf(a)) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
    .map(c => ({ name: c.name, cls: c.class, level: levelOf(c), isMain: isMainOf(c), bringing: c.name.toLowerCase() === bring }));
}

/** The raid night's targets, for the subline: each plan section's bosses in the guild's order. */
export function targetNames(plan: { bosses: { name: string }[] }[]): string[] {
  return plan.flatMap(s => s.bosses.map(b => b.name));
}
