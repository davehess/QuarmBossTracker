// "Who still needs this target": the split the flag-event board draws (web/app/pop/flag-events) and the invented-guild
// demo draws (web/lib/demoGuild.ts needsFor), from ONE function so the demo cannot drift from the product.
//
// Pure: it takes characters and a way to read each one's flags, and answers through the real gate rules
// (popGateStatus.ts gateReport). No database, no React.
//
// THREE ANSWERS, and the difference between the first two is the point (popGateStatus.ts, the guild lead,
// 2026-11-02):
//   need    a real "no": the character has had a FULL read of their flags (the Seer's recital or a #popflags read,
//           which list everything they hold) and a piece of the target is not in it.
//   unsure  no full read, so an absent flag only means nobody saw it. Never guessed into "need".
//   done    every piece of the target is held. A held Seer memory (the kill is credited, she is holding it) counts as
//           done: no raid is owed.

import { POP_ZONE_BY_KEY } from './popFlags';
import { gateReport, type GateInput } from './popGateStatus';
import type { FlagTarget } from './flagTargets';

export type Needs<T> = { need: T[]; unsure: T[]; done: T[] };

/** One character's verdict for one target. */
export type NeedVerdict = 'need' | 'unsure' | 'done';

export function verdictForTarget(target: FlagTarget, input: GateInput): NeedVerdict {
  const zone = POP_ZONE_BY_KEY[target.gate];
  if (!zone) return 'unsure';   // a catalog entry naming a gate that no longer exists must not read as "done"
  const states = gateReport(zone, input).pieces.filter(p => target.pieces.includes(p.key)).map(p => p.state);
  if (states.some(s => s === 'missing')) return 'need';
  if (states.some(s => s === 'unknown')) return 'unsure';
  return 'done';
}

/** Split characters by what they still need for one target. Order inside each list is the order given. */
export function splitNeeds<T>(target: FlagTarget, chars: readonly T[], inputOf: (c: T) => GateInput): Needs<T> {
  const out: Needs<T> = { need: [], unsure: [], done: [] };
  for (const c of chars) out[verdictForTarget(target, inputOf(c))].push(c);
  return out;
}

/**
 * The characters worth a full-read lookup: those that, going by their flags alone, still lack a piece of some target.
 * A character already done on every target gets the same answer whether or not they have had a full read, so asking
 * the database about them is a wasted request. (The lookup is one query per name, popGuide/gateData.ts loadFullReads.)
 */
export function needsFullReadCheck<T>(targets: readonly FlagTarget[], chars: readonly T[], inputOf: (c: T) => Omit<GateInput, 'fullRead'>): Set<T> {
  const out = new Set<T>();
  for (const c of chars) {
    const base = inputOf(c);
    if (targets.some(t => verdictForTarget(t, { ...base, fullRead: false }) !== 'done')) out.add(c);
  }
  return out;
}
