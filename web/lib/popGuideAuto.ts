// Which PoP checklist steps fill themselves in, and how we know (the guild lead, 2026-09-29: "automatic
// fill in when someone is running mimic and we know that they're doing something, and note when it's
// been filled in by database or mimic in a line item").
//
// Three sources, named on every row they tick:
//   mimic    — Mimic saw it happen: a flag message after a boss kill (pop_flags, mapped), a Mark
//              looted (looted_items), Mimic reporting the character at all (character_live_state).
//   database — our records already show it: level on /who, an item in the last inventory upload
//              (character_inventory, never when the character hides its inventory), the spellbook
//              upload.
//   who      — a raider's /who showed the character inside a gated plane, so its gate and the gates
//              on the way in are done (web/lib/popWho.ts). Works for characters whose owners never
//              run Mimic (the guild lead, 2026-10-01).
//   loot     — the character looted something inside a gated plane (or holds a NO DROP item that drops
//              only there), which is the same proof of presence, so the same gates are done (the guild
//              lead, 2026-10-03: "if anyone has looted any distinct items from any of the planes we
//              should go through and flag them up to that plane"). /who is read first, so where both
//              show it the row says /who.
// Pure: the page reads the rows and hands them in, so the rules are testable without a database.

import { GUIDE_ITEMS } from './popGuide';
import { flagsFromLoot, flagsFromSightings, lootText, seenText, type LootSighting, type Sighting } from './popWho';

export type Evidence = { source: 'mimic' | 'database' | 'who' | 'loot'; what: string; at: string | null };
export type AutoInput = {
  flags: { flag_key: string; earned_at: string | null }[];
  loots: { item_name: string; looted_at: string | null }[];
  inventory: { item_id: number; observed_at: string | null }[] | null;   // null = the character hides it
  level: number | null;
  levelAt: string | null;
  spellbook: boolean;
  liveAt: string | null;
  seen?: Sighting[];   // pop_who_sightings rows for this character
  looted?: LootSighting[];   // pop_loot_sightings rows for this character
};

// Steps that come before a gate flag in the same arc. Standing in Storms or Valor means the server's
// mavuin 3, which only follows Mavuin's information and the Tribunal.
// The Justice flag now belongs to the Mavuin hail and the Bastion flag to the shrine click (popGuide.ts,
// the guild lead, 2026-10-03), so the steps they used to sit on are listed here: the trial, and Askr.
// Mimic's record counts too: every recorded trial_justice is the server's mavuin 3 and every askr_quest
// its karana 3 (pop_flags.stage, checked 2026-10-03), and each of those follows the steps listed.
const STEPS_BEFORE: Record<string, string[]> = {
  trial_justice: ['flag_trial_justice', 'justice_mavuin_info', 'justice_tribunal', 'justice_mavuin_hail'],
  askr_quest: ['flag_askr'],
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
  // The Binden Concerrentia: each part's reward is the next part's ingredient, so holding any LATER item
  // proves the earlier parts too (and the talisman is used up in the combine, so the Binden alone must count).
  // None of these is no drop (eqemu_items), so a traded or bought piece ticks the box as well.
  binden_small: { ids: [28284, 28289, 28290, 28297, 28296], any: true, what: 'You hold the Small Clockwork Talisman, or something made from it.' },
  binden_powered: { ids: [28290, 28291, 28297, 28296], any: true, what: 'You hold the Powered Clockwork Talisman, or something made from it.' },
  binden_final: { ids: [28296], what: 'You hold The Binden Concerrentia.' },
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
  // A recorded flag also proves the steps it needs (after the Mark, which names the trial more exactly).
  for (const [flag, at] of flagAt) {
    for (const k of STEPS_BEFORE[flag] ?? []) {
      if (!out[k]) out[k] = { source: 'mimic', what: 'Mimic recorded a later flag in this arc, which needs this step first.', at: at ?? null };
    }
  }
  // /who: the gate of the plane they were seen in, and of every plane on the way in.
  for (const [flag, proof] of flagsFromSightings(inp.seen ?? [])) {
    const ev: Evidence = { source: 'who', what: seenText(proof.zone), at: proof.at };
    for (const i of GUIDE_ITEMS) if (i.flag === flag && !out[i.key]) out[i.key] = ev;
    for (const k of STEPS_BEFORE[flag] ?? []) if (!out[k]) out[k] = ev;
  }
  // Loot: the same gates, from what they looted in the plane. After /who, so a step /who already filled
  // keeps its /who label.
  for (const [flag, proof] of flagsFromLoot(inp.looted ?? [])) {
    const ev: Evidence = { source: 'loot', what: lootText(proof.zone, proof.source), at: proof.at };
    for (const i of GUIDE_ITEMS) if (i.flag === flag && !out[i.key]) out[i.key] = ev;
    for (const k of STEPS_BEFORE[flag] ?? []) if (!out[k]) out[k] = ev;
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
