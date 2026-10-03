// One gate cell on /pop, as pure rules (the guild lead, 2026-10-03: members tick their own flags on the
// matrix and My Characters). Kept apart from web/lib/popSelfFlags.ts on purpose: the button that applies
// these rules is a client component, and popSelfFlags pulls in the whole guide catalog (60 KB of text) for
// the flag ↔ row mapping, which the browser does not need. This file imports nothing.
//
// A matrix cell is a ZONE's gate: every flag in `requires`. Each flag is proven by Mimic or /who, ticked by
// its owner, or open. A cell is only as proven as its weakest flag, so one ticked flag makes the cell ☑,
// and a flag that Mimic or /who proves shows that proof even when it is also ticked.

export const SELF_TICK_TITLE = 'Ticked by its owner on the site';

export type FlagProof = 'mimic' | 'who';
export type GateMarkKind = 'none' | 'mimic' | 'who' | 'self';
export type GateState = {
  access: boolean;
  mark: GateMarkKind;
  selfFlags: string[];     // required flags held only on the owner's word
  open: string[];          // required flags nobody has proven or ticked
  // What a click on the owner's cell does; null when every flag is proven (nothing to tick).
  toggle: { action: 'tick' | 'untick'; flags: string[] } | null;
};

export function gateState(
  requires: readonly string[],
  proof: Readonly<Record<string, FlagProof | undefined>>,
  self: ReadonlySet<string>,
): GateState {
  const selfFlags = requires.filter(f => !proof[f] && self.has(f));
  const open = requires.filter(f => !proof[f] && !self.has(f));
  const access = open.length === 0;
  const mark: GateMarkKind = !access ? 'none'
    : selfFlags.length > 0 ? 'self'
    : requires.some(f => proof[f] === 'who') ? 'who' : 'mimic';
  const toggle = open.length > 0 ? { action: 'tick' as const, flags: open }
    : selfFlags.length > 0 ? { action: 'untick' as const, flags: selfFlags }
    : null;
  return { access, mark, selfFlags, open, toggle };
}

/** How each held flag in `requires` is proven, for a character whose flag set also holds /who's and the ticks. */
export function proofFor(
  requires: readonly string[],
  c: { flags: ReadonlySet<string>; seen: ReadonlyMap<string, unknown>; self: ReadonlySet<string> },
): Record<string, FlagProof> {
  const out: Record<string, FlagProof> = {};
  for (const f of requires) {
    if (!c.flags.has(f) || c.self.has(f)) continue;
    out[f] = c.seen.has(f) ? 'who' : 'mimic';
  }
  return out;
}
