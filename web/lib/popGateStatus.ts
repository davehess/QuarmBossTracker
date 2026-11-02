// Which pieces of a PoP gate a character has, and the one-line verdict (popGatePieces.ts is the table of pieces;
// the guild lead, 2026-11-01: "the side bar where it says specifically what you're missing, not just the last thing
// mentioned"). Pure, so the rules are testable without a database and the page only draws the answer.
//
// FOUR STATES, and the difference between the last two is the whole point of the table:
//   done     ✅ a stage that proves the piece is held (directly, or because a LATER stage of the same series is:
//               the Seer shows only the latest value of a series).
//   pending  ⏳ the Seer's pending memory for the piece is held ('cl_saryrn'): the kill is credited and she is
//               holding it until she is asked to 'unlock memories'. Not done, and not missing either.
//   missing  ❌ we KNOW it is not done: the character has had a full read (the Seer's recital or a #popflags read,
//               which list every flag they hold) and the piece is not in it.
//   unknown  ❓ no record either way. Without a full read an absent flag only means nobody saw it happen; a kill on
//               record with no step after it lands here too (the hail is what the piece is, and it is not recorded).
//
// Kill flags do NOT stand for the step after the kill (see popGatePieces.ts). The closure below follows
// popSteps.ts STEP_IMPLIES and popRecital.ts STAGE_IMPLIES like the rest of the site, except it stops at a kill
// flag: `saryrn_dead` held does not make `saryrn_1` held.

import { POP_FLAGS, POP_ZONE_BY_KEY, type PopNode } from './popFlags';
import { STAGE_IMPLIES } from './popRecital';
import { STEP_IMPLIES } from './popSteps';
import { GATES, gatePieces, piecesForBlocker, piecesOfFlag, type GatePiece, type PieceKind } from './popGatePieces';

export type PieceState = 'done' | 'pending' | 'missing' | 'unknown';

/** One piece for one character, small enough to hand to the browser. */
export type PieceStatus = {
  key: string;
  label: string;
  kind: PieceKind;
  state: PieceState;
  detail: string | null;   // why: what the Seer holds, what is on record, "2 of 5"
  killOnly: boolean;       // the kill is on record but the step after it is not (state is 'unknown')
  needs: string;
  to: string | null;
  verified: boolean;
  note: string | null;
};

export type Verdict = {
  /** done: nothing left. handins: only the Seer / NPC hand-ins are left. blocked: a kill or task is still owed.
   *  unsure: nothing says either way. */
  tone: 'done' | 'handins' | 'blocked' | 'unsure';
  text: string;
};

export type GateInput = {
  /** Every flag key shown for the character: pop_flags rows (stages, catalog flags and 'cl_' memories), what /who and
   *  loot prove, and the owner's own ticks. */
  flags: Iterable<string>;
  /** Chart keys of the gated planes /who has seen them in: being inside a plane proves the gate to it was passed. */
  seen?: Iterable<string>;
  /** True when they have had a full read (a Seer recital or a #popflags read), so an absent flag is a real "no". */
  fullRead?: boolean;
};

// ── What is held ─────────────────────────────────────────────────────────────

// Two things the scripts need that popSteps.ts STEP_IMPLIES does not say (Grand_Librarian_Maelin.lua, eqemu_quest_scripts
// sha b1d5b43b, as read in web/lib/popNextSteps.ts): Maelin moves zeks 5 -> 6 only `if qglobals.cipher` (:65-77), so a
// character on zeks_6 holds the cipher; and her second reading (zebuxoruk 1 -> 2) needs zeks == 7 (:57-61), so one on
// zebuxoruk_2 has done Rallos Zek's step. Without these the Sol Ro halves read "missing" for someone Maelin has
// already read the notes to.
const SCRIPT_IMPLIES: Record<string, string[]> = { zeks_6: ['cipher_1'], zebuxoruk_2: ['zeks_7'] };

/** Every key a set of held keys proves, following the series (a later value carries the earlier ones) and the stage →
 *  catalog flag table, but never from a KILL flag to the step after the kill. */
export function stagesHeld(keys: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...keys];
  while (stack.length) {
    const k = stack.pop() as string;
    if (out.has(k)) continue;
    out.add(k);
    if (POP_FLAGS[k]?.kind === 'kill') continue;
    for (const n of STAGE_IMPLIES[k] ?? []) stack.push(n);
    for (const n of STEP_IMPLIES[k] ?? []) stack.push(n);
    for (const n of SCRIPT_IMPLIES[k] ?? []) stack.push(n);
  }
  return out;
}

// Every requirement flag a character standing in `zoneKey` must have passed: the plane's own gate, and the gate of the
// plane each of those flags is earned in, all the way down (the walk popWho.ts whoProves makes, without swapping a
// gate flag for the kills it implies).
function requiredFor(zoneKey: string): Set<string> {
  const flags = new Set<string>();
  const zones = new Set<string>();
  const addZone = (z: string) => {
    if (zones.has(z)) return;
    zones.add(z);
    for (const f of POP_ZONE_BY_KEY[z]?.requires ?? []) addFlag(f);
  };
  const addFlag = (f: string) => {
    if (flags.has(f)) return;
    flags.add(f);
    const z = POP_FLAGS[f]?.zone;
    if (z) addZone(z);
  };
  addZone(zoneKey);
  return flags;
}

/** What the character is known to hold: their flags, plus every piece of every gate /who proves they went through. */
export function heldFor(input: GateInput): Set<string> {
  const seed = new Set<string>(input.flags);
  for (const zone of input.seen ?? []) {
    for (const flag of requiredFor(zone)) {
      seed.add(flag);
      for (const p of piecesOfFlag(flag)) for (const k of p.proof) seed.add(k);
    }
  }
  return stagesHeld(seed);
}

// ── One piece ────────────────────────────────────────────────────────────────

export function pieceStatus(p: GatePiece, held: ReadonlySet<string>, fullRead: boolean): PieceStatus {
  const base = { key: p.key, label: p.label, kind: p.kind, needs: p.needs, to: p.to ?? null, verified: p.verified, note: p.note ?? null };
  const have = p.proof.filter(k => held.has(k)).length;
  if (p.all ? have === p.proof.length : have > 0) return { ...base, state: 'done', detail: null, killOnly: false };
  if (p.pending && held.has(p.pending)) {
    return { ...base, state: 'pending', detail: 'Kill credited. The Seer is holding it: ask her to unlock memories', killOnly: false };
  }
  if ((p.kills ?? []).some(k => held.has(k))) {
    return { ...base, state: 'unknown', detail: 'The kill is on record; the hail after it is not', killOnly: true };
  }
  const part = p.all && have > 0 ? `${have} of ${p.proof.length}` : null;
  return { ...base, state: fullRead ? 'missing' : 'unknown', detail: part, killOnly: false };
}

// ── The verdict ──────────────────────────────────────────────────────────────

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** "Only the Seer and Maelin left", "needs a Marr kill, then the Seer and Maelin", or what is not recorded. */
export function verdictFor(statuses: PieceStatus[]): Verdict {
  const left = statuses.filter(s => s.state !== 'done');
  if (left.length === 0) return { tone: 'done', text: 'Nothing left here' };
  if (left.every(s => s.state === 'unknown') && left.length === statuses.length) {
    return { tone: 'unsure', text: "Nothing recorded yet. Paste the Seer's recital to fill this in" };
  }
  const owed = left.filter(s => s.state === 'missing' && s.kind !== 'handin');
  const unknown = left.filter(s => s.state === 'unknown');
  const after = [
    ...(left.some(s => s.state === 'pending') ? ['the Seer'] : []),
    ...uniq(left.filter(s => s.state === 'missing' && s.kind === 'handin').map(s => s.to ?? s.label)),
  ];
  if (owed.length) {
    const tail = [after.length ? `then ${list(after)}` : '', unknown.length ? `${unknown.length} not recorded` : ''].filter(Boolean);
    return { tone: 'blocked', text: `No, needs ${list(owed.map(s => s.needs))}${tail.length ? `, ${tail.join(', ')}` : ''}` };
  }
  if (unknown.length) {
    return {
      tone: 'unsure',
      text: `Not sure: ${list(unknown.map(s => s.label))} ${unknown.length === 1 ? 'is' : 'are'} not recorded${after.length ? `; ${list(after)} still to go` : ''}`,
    };
  }
  return { tone: 'handins', text: `Yes, only ${list(after)} left` };
}

// ── A gate, and the sidebar card ─────────────────────────────────────────────

export type GateReport = { gate: string; name: string; short: string; pieces: PieceStatus[]; verdict: Verdict };

/** One gate for one character. */
export function gateReport(zone: PopNode, input: GateInput): GateReport {
  const held = heldFor(input);
  const pieces = gatePieces(zone).map(p => pieceStatus(p, held, !!input.fullRead));
  return { gate: zone.key, name: zone.name, short: zone.short, pieces, verdict: verdictFor(pieces) };
}

/** The gate the family table opens on when none is picked (the one the guild lead's table was about). */
export const DEFAULT_GATE = 'solro';

/** A gate key from the URL, or the default when it names nothing with a requirement. */
export function gateKeyOr(raw: unknown): string {
  return typeof raw === 'string' && GATES.some(g => g.key === raw) ? raw : DEFAULT_GATE;
}

/** The `?v=` switch for the two gate variants: anything else is not ours (the layouts use 'b' and 'c'). */
export function gateMode(raw: unknown): 'a' | 'b' | null {
  return raw === 'gate-a' ? 'a' : raw === 'gate-b' ? 'b' : null;
}

export type BlockedLine = { line: string; label: string; blockedOn: { flag: string; label: string }[] };
export type GateCardEntry = { line: string; label: string; gate: string | null; pieces: PieceStatus[]; verdict: Verdict };

/** For each progression line the card says is waiting on something else: every piece of what it waits on, and the
 *  verdict. The pieces are the union over the line's blockers (a flag such as 'cipher_1' opens into its parts; a kill
 *  flag it names opens into the notes that kill hands out), in the table's order, once each. */
export function gateCardEntries(blocked: BlockedLine[], input: GateInput): GateCardEntry[] {
  const held = heldFor(input);
  return blocked.map(b => {
    const seen = new Set<string>();
    const pieces = b.blockedOn.flatMap(x => piecesForBlocker(x.flag)).filter(p => (seen.has(p.key) ? false : (seen.add(p.key), true)));
    const statuses = pieces.map(p => pieceStatus(p, held, !!input.fullRead));
    const gate = b.blockedOn.map(x => GATES.find(g => g.requires.includes(x.flag))).find(Boolean) ?? null;
    return { line: b.line, label: b.label, gate: gate?.name ?? null, pieces: statuses, verdict: verdictFor(statuses) };
  });
}
