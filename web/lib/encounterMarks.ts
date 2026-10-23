// Officer marks on one fight (encounters.classification + encounters.is_wipe), as pure functions so the
// server actions, the chips and the tests all read the same rules.
//
// classification is ONE of live / pvp / test / foreign ("whose or where fight") or 'wipe' ("did not kill").
// is_wipe is the flag that lets a wipe ride alongside another mark ("non-guild wipe"). Shapes:
//   guild kill      { null,      false }
//   guild wipe      { 'wipe',    true  }   // classification='wipe' never comes without is_wipe (DB CHECK)
//   non-guild wipe  { 'foreign', true  }   // likewise live / pvp / test
// `classification is null` stays the definition of a guild kill everywhere, so no other reader changes.

export type Marks = { classification: string | null; is_wipe?: boolean | null };

/** A wipe of any kind: the plain wipe mark, or the flag riding on another mark. */
export function isWipe(m: Marks): boolean {
  return m.classification === 'wipe' || !!m.is_wipe;
}

/** The chips to draw, in order: the wipe first, then the other mark (the plain 'wipe' mark is only one chip). */
export function chipKeys(m: Marks): string[] {
  const keys: string[] = [];
  if (isWipe(m)) keys.push('wipe');
  if (m.classification && m.classification !== 'wipe') keys.push(m.classification);
  return keys;
}

/**
 * What toggling Wipe writes.
 *   reset   → the row had only the wipe mark: back to a guild kill (caller clears the whole classification)
 *   stamp   → the row had no mark: it becomes a plain wipe (caller stamps reason / at / by like any mark)
 *   neither → only the flag changes; the other mark, its reason and who set it stay as they are
 */
export function wipeTogglePatch(m: Marks): { patch: { classification?: string | null; is_wipe: boolean }; reset: boolean; stamp: boolean } {
  if (isWipe(m)) {
    if (m.classification === 'wipe') return { patch: { classification: null, is_wipe: false }, reset: true, stamp: false };
    return { patch: { is_wipe: false }, reset: false, stamp: false };
  }
  if (!m.classification) return { patch: { classification: 'wipe', is_wipe: true }, reset: false, stamp: true };
  return { patch: { is_wipe: true }, reset: false, stamp: false };
}

/** What picking one of the one-of marks writes. The wipe flag is left alone, except that 'wipe' itself sets it. */
export function classifyPatch(classification: string): { classification: string; is_wipe?: true } {
  return classification === 'wipe' ? { classification, is_wipe: true } : { classification };
}
