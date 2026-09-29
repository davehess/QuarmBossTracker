// Which PoP checklist steps fill themselves in, and how we know (the guild lead, 2026-09-29: "automatic
// fill in when someone is running mimic and we know that they're doing something, and note when it's
// been filled in by database or mimic in a line item").
//
// Two sources, named on every row they tick:
//   mimic    — Mimic saw it happen: a flag message after a boss kill (pop_flags, mapped), a Mark
//              looted (looted_items), Mimic reporting the character at all (character_live_state).
//   database — our records already show it: level on /who, an item in the last inventory upload
//              (character_inventory, never when the character hides its inventory), the spellbook
//              upload.
// Pure: the page reads the rows and hands them in, so the rules are testable without a database.

import { GUIDE_ITEMS } from './popGuide';

export type Evidence = { source: 'mimic' | 'database'; what: string; at: string | null };
export type AutoInput = {
  flags: { flag_key: string; earned_at: string | null }[];
  loots: { item_name: string; looted_at: string | null }[];
  inventory: { item_id: number; observed_at: string | null }[] | null;   // null = the character hides it
  level: number | null;
  levelAt: string | null;
  spellbook: boolean;
  liveAt: string | null;
};

// Holding the reward (or the thing the step asks you to get) proves the step. All the ids, unless
// `any`: then one of them is enough (a reward you can swap for another).
export const HELD_ITEM_STEPS: Record<string, { ids: number[]; what: string; any?: boolean }> = {
  start_traveler_manual: { ids: [28745], what: 'Your last inventory upload holds the Planar Traveler’s Manual.' },
  pok_taxidermy: { ids: [28237], what: 'You hold the Fine Antique Ring, its reward.' },
  pok_instruments: { ids: [28239], what: 'You hold the Fine Antique Amice, its reward.' },
  pok_reflecting_pools: { ids: [9321], what: 'You hold the mask, its reward.' },
  pok_books: { ids: [28240], what: 'You hold the Fine Antique Locket, its reward.' },
  pok_gems: { ids: [28242], what: 'You hold the Fine Antique Veil, its reward.' },
  pok_idols: { ids: [28241], what: 'You hold the Fine Antique Velvet Rose, its reward.' },
  spells_parchments: { ids: [29112, 29131, 29132], what: 'Your last inventory upload holds all three parchments.' },
  valor_globe: { ids: [25596], what: 'You hold A Crystalline Globe.' },
  torment_sphere: { ids: [22954], what: 'You hold A Screaming Sphere.' },
  bot_symbol: { ids: [9433], what: 'You hold the Symbol of Torden.' },
  air_key: { ids: [28638], what: 'You hold A Wind Etched Key.' },
  earth_key: { ids: [28636], what: 'You hold A Gem-Etched Key.' },
  time_vial: { ids: [17186], what: 'You hold an Odylic Vial.' },
  time_quintessence: { ids: [29165], what: 'You hold the Quintessence of Elements.' },
  essences_escort: { ids: [16260], what: 'You hold the Tiny Gold Fist, its reward.' },
  essences_power: { ids: [32106, 17209, 32107, 32108, 32109], any: true, what: 'You hold one of its five rewards.' },
};

const MARK_RX = /^Mark of (Execution|Flame|Lashing|Stone|Suffocation|Torture)$/i;

export function guideEvidence(inp: AutoInput): Record<string, Evidence> {
  const out: Record<string, Evidence> = {};
  // Flags Mimic recorded: the step that names the flag.
  const flagAt = new Map<string, string | null>();
  for (const f of inp.flags) if (!flagAt.has(f.flag_key)) flagAt.set(f.flag_key, f.earned_at);
  for (const i of GUIDE_ITEMS) {
    if (i.flag && flagAt.has(i.flag)) {
      out[i.key] = { source: 'mimic', what: 'Mimic saw your “You have received a character flag!” for this.', at: flagAt.get(i.flag) ?? null };
    }
  }
  // A Mark looted is the trial won (the flag line can come later, or not be mapped).
  if (!out.flag_trial_justice) {
    const mark = inp.loots.find(l => MARK_RX.test(String(l.item_name).trim()));
    if (mark) out.flag_trial_justice = { source: 'mimic', what: `Mimic saw you loot the ${mark.item_name}.`, at: mark.looted_at };
  }
  if (inp.liveAt) out.start_mimic = { source: 'mimic', what: 'Mimic has reported this character.', at: inp.liveAt };
  if (inp.level != null && inp.level >= 46) {
    out.start_level46 = { source: 'database', what: `Level ${inp.level} on /who.`, at: inp.levelAt };
  }
  if (inp.spellbook) out.spells_submit_book = { source: 'database', what: 'Your spellbook is uploaded.', at: null };
  if (inp.inventory) {
    const held = new Map<number, string | null>();
    for (const r of inp.inventory) if (!held.has(r.item_id)) held.set(r.item_id, r.observed_at);
    for (const [key, rule] of Object.entries(HELD_ITEM_STEPS)) {
      if (out[key]) continue;
      const have = rule.ids.filter(id => held.has(id));
      if (rule.any ? have.length > 0 : have.length === rule.ids.length) out[key] = { source: 'database', what: rule.what, at: held.get(have[0]) ?? null };
    }
  }
  return out;
}

// Every item id the rules look for — the page asks the database for only these.
export const AUTO_ITEM_IDS: number[] = [...new Set(Object.values(HELD_ITEM_STEPS).flatMap(r => r.ids))];
