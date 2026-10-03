// Flags a member ticks for their own character on the site (the guild lead, 2026-10-03: "I need [a way]
// for people to be able to check off their own flags for their own characters outside of using mimic or
// relying on someone else with mimic to do it. they could do it on the matrix page or somewhere else that
// makes sense").
//
// ONE store, two pages: pop_guide_ticks, the table /pop/guide already writes. A flag is self-reported for
// a character when that table holds the guide step that grants the flag (GUIDE_ITEMS[i].flag === the flag
// key), or `flag:<flag_key>` for a flag no guide step names. So a tick on the checklist counts on /pop and
// a tick on /pop shows on the checklist, with no second copy to keep in step.
//
// It is the member's OWN WORD, and the page says so: Mimic's recorded flag and /who's sighting both
// outrank it (a flag either one proves shows that proof, never the tick), and the tick is shown with its
// own mark. Those rules are pure and live in popGateCell.ts, re-exported here, so the server page has one
// place to import from and the browser never loads this file's guide catalog.

import { GUIDE_ITEMS } from './popGuide';
import { POP_FLAGS } from './popFlags';

export { SELF_TICK_TITLE, gateState, proofFor } from './popGateCell';
export type { FlagProof, GateMarkKind, GateState } from './popGateCell';

export const FLAG_TICK_PREFIX = 'flag:';
// A gate asks for two flags at most; the cap only keeps a hostile caller from writing the whole catalog.
export const MAX_FLAGS_PER_TICK = 8;

const guideKeysByFlag = new Map<string, string[]>();
const flagByGuideKey = new Map<string, string>();
for (const i of GUIDE_ITEMS) {
  if (!i.flag) continue;
  flagByGuideKey.set(i.key, i.flag);
  guideKeysByFlag.set(i.flag, [...(guideKeysByFlag.get(i.flag) ?? []), i.key]);
}

// hasOwn, not `POP_FLAGS[flag]`: 'constructor' and '__proto__' are truthy on a plain object, and a flag
// name comes from the client. 'unmapped' is the funnel for grants nobody could name, not a flag.
const isCatalogFlag = (flag: string) => Object.prototype.hasOwnProperty.call(POP_FLAGS, flag) && flag !== 'unmapped';

/** The row key a tick of this flag is stored under, or null when it is not a flag the catalog knows. */
export function tickKeyForFlag(flag: string): string | null {
  if (typeof flag !== 'string' || !isCatalogFlag(flag)) return null;
  return guideKeysByFlag.get(flag)?.[0] ?? FLAG_TICK_PREFIX + flag;
}

/** Every row key that counts as a self-report of this flag, so un-ticking removes them all. */
export function tickKeysForFlag(flag: string): string[] {
  if (typeof flag !== 'string' || !isCatalogFlag(flag)) return [];
  return [...(guideKeysByFlag.get(flag) ?? []), FLAG_TICK_PREFIX + flag];
}

/** The flag a stored tick key reports, or null for a key that reports none (a plain checklist step). */
export function flagForTickKey(key: string): string | null {
  if (typeof key !== 'string') return null;
  const viaStep = flagByGuideKey.get(key);
  if (viaStep) return viaStep;
  if (!key.startsWith(FLAG_TICK_PREFIX)) return null;
  const flag = key.slice(FLAG_TICK_PREFIX.length);
  return isCatalogFlag(flag) ? flag : null;
}

/** Every key a page has to read to see all self-reports. */
export const SELF_TICK_KEYS: string[] = [...new Set([
  ...flagByGuideKey.keys(),
  ...Object.keys(POP_FLAGS).filter(isCatalogFlag).map(f => FLAG_TICK_PREFIX + f),
])];

/** Stored ticks → the flags each character's owner reported, keyed by lower-cased character name. */
export function selfFlagsFromTicks(rows: Iterable<{ character_name: string; item_key: string }>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const flag = flagForTickKey(r.item_key);
    if (!flag) continue;
    const k = r.character_name.toLowerCase();
    if (!out.has(k)) out.set(k, new Set());
    out.get(k)!.add(flag);
  }
  return out;
}
