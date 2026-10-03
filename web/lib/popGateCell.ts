// One gate cell on /pop, as pure rules (the guild lead, 2026-10-03: members tick their own flags on the
// matrix and My Characters). Kept apart from web/lib/popSelfFlags.ts on purpose: the button that applies
// these rules is a client component, and popSelfFlags pulls in the whole guide catalog (60 KB of text) for
// the flag ↔ row mapping, which the browser does not need. This file imports nothing.
//
// A matrix cell is a ZONE's gate: every flag in `requires`. Each flag is proven by Mimic, /who or loot,
// ticked by its owner, or open. A cell is only as proven as its weakest flag, so one ticked flag makes the
// cell ☑, and a flag that Mimic, /who or loot proves shows that proof even when it is also ticked.
//
// Loot (the guild lead, 2026-10-03: "if anyone has looted any distinct items from any of the planes we
// should go through and flag them up to that plane") is presence proof exactly like a /who sighting, so it
// sits level with /who and above the owner's tick. Where both prove one flag the page keeps /who's (the
// older, wider record), so a purple ✓ only ever means "the loot is the only proof"; and a gate with one
// flag from each shows /who's blue, the first of the two in the weakest-wins order below.

export const SELF_TICK_TITLE = 'Ticked by its owner on the site';

export type FlagProof = 'mimic' | 'who' | 'loot';
export type GateMarkKind = 'none' | 'mimic' | 'who' | 'loot' | 'self';
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
    : requires.some(f => proof[f] === 'who') ? 'who'
    : requires.some(f => proof[f] === 'loot') ? 'loot' : 'mimic';
  const toggle = open.length > 0 ? { action: 'tick' as const, flags: open }
    : selfFlags.length > 0 ? { action: 'untick' as const, flags: selfFlags }
    : null;
  return { access, mark, selfFlags, open, toggle };
}

/** How each held flag in `requires` is proven, for a character whose flag set also holds /who's, loot's and the ticks. */
export function proofFor(
  requires: readonly string[],
  c: { flags: ReadonlySet<string>; seen: ReadonlyMap<string, unknown>; self: ReadonlySet<string>; looted?: ReadonlyMap<string, unknown> },
): Record<string, FlagProof> {
  const out: Record<string, FlagProof> = {};
  for (const f of requires) {
    if (!c.flags.has(f) || c.self.has(f)) continue;
    out[f] = c.seen.has(f) ? 'who' : c.looted?.has(f) ? 'loot' : 'mimic';
  }
  return out;
}
