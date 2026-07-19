// web/lib/quartermaster.ts — #82 Quartermaster v1 (guild logistics).
//
// Pure + dependency-light (only class-titles, itself pure) so it unit-tests
// without a DB or Next runtime (see test/quartermaster.test.js). The
// /quartermaster page does the Supabase I/O and hands plain rows in here;
// NOTHING in this file talks to Supabase.
//
// Two boards, two exports:
//   • Board 1 — utility-kit coverage (`KIT_CATALOG` + `computeKitCoverage`):
//     who owns the items that keep a raid moving, from character_gear ×
//     eqemu_items. Extends the raidKit idiom — visible ownership only (bank is
//     privacy-stripped before upload), opt-outs honored by the caller.
//   • Board 2 — common-quest checklist (`computeQuestProgress`): step-level
//     ✓ / missing / unknown for a character against the officer-authored
//     quest_catalog + quest_required_item, matched to that character's VISIBLE
//     inventory (character_inventory). A step with no item to check renders
//     "unknown" (—) — officer/manual territory, never a false red.
//
// Design stance (inherited from raidKit "helping, not watching"): a blank is
// "we can't see it" (bank-stripped / no upload yet), NOT "you don't have it".

import { normalizeClass } from './class-titles';

// ─────────────────────────────────────────────────────────────────────────────
// Board 1 — utility-kit coverage
// ─────────────────────────────────────────────────────────────────────────────

export type KitCategory =
  | 'charm' | 'cure' | 'resist' | 'survival' | 'mana' | 'travel' | 'invis' | 'haste';

export const KIT_CATEGORY_LABEL: Record<KitCategory, string> = {
  charm: 'Crowd control',
  cure: 'Cures',
  resist: 'Resist buffs',
  survival: 'Emergency survival',
  mana: 'Mana',
  travel: 'Travel & movement',
  invis: 'Invis / stealth',
  haste: 'Haste',
};

// A trackable utility item. `itemIds` collapses catalog variants (two Shield of
// the Immaculate ids, the reusable + consumable forms of a clicky) into ONE
// coverage row. `wantClass` (optional) makes a class-scoped gap meaningful
// ("no Cleric owns X") for a class-restricted clicky; omit it for anyone-can-use
// items. ADDING A KIT ENTRY IS A ONE-LINE PUSH TO KIT_CATALOG below.
export type KitEntry = {
  key: string;
  label: string;          // the item / utility name shown on the board
  category: KitCategory;
  itemIds: number[];      // eqemu_items ids (verified live; see the seed comment)
  grants: string;         // plain-language "what it does"
  wantClass?: string;     // base class that SHOULD carry it (drives the gap line)
};

// Grounded against the live catalog (Supabase project zhtoekwakucbckvatfky) — the
// trailing number is the guild's current owner count (distinct characters, opt-
// outs honored) at seed time, proof each row is well-attested, not aspirational.
export const KIT_CATALOG: KitEntry[] = [
  { key: 'jboots',    label: "Journeyman's Boots",        category: 'travel',   itemIds: [2300],        grants: 'Click run-speed (JBoots) — self SoW-on-a-click' },            // 71
  { key: 'peg-cloak', label: 'Pegasus Feather Cloak',     category: 'travel',   itemIds: [2463],        grants: 'Levitation — click lev for climbs and drop-downs' },          // 41
  { key: 'bathezid',  label: 'Regal Band of Bathezid',    category: 'resist',   itemIds: [5727],        grants: 'Aegis of Bathezid — +magic-resist buff' },                    // 18
  { key: 'haste-eye', label: 'Eyepatch of Plunder',       category: 'haste',    itemIds: [30008],       grants: "Captain Nalot's Quickening — click haste for a melee" },      // 16
  { key: 'camo-mask', label: "Larrikan's Mask",           category: 'invis',    itemIds: [2736],        grants: 'Superior Camouflage — reusable self-invis clicky' },          // 13
  { key: 'divine-aura', label: 'Divine Aura clicky',      category: 'survival', itemIds: [14322, 1744], grants: 'Divine Aura — a few seconds of total invulnerability (emergency)' }, // 20 (Shiny Brass Idol + Earring of the Frozen Skull)
  { key: 'puppet',    label: 'Puppet Strings',            category: 'charm',    itemIds: [11643],       grants: 'Allure — a backup charm any class can click' },               // 11
  { key: 'shield-immac', label: 'Shield of the Immaculate', category: 'cure',   itemIds: [999, 11551],  grants: 'Counteract Disease — instant disease cure', wantClass: 'Cleric' }, // 12
  { key: 'dain-ring', label: 'Ring of Dain Frostreaver IV', category: 'resist', itemIds: [30385],       grants: "Frostreaver's Blessing — +cold-resist buff" },                // 9
  { key: 'thurg-gate', label: 'Vial of Velium Vapors',    category: 'travel',   itemIds: [1553],        grants: 'Thurgadin Gate — click port to Thurgadin' },                  // 9
  { key: 'manastone', label: 'Manastone / Manarock',      category: 'mana',     itemIds: [13401, 2970], grants: 'ManaConvert — HP→mana battery for casters' },                  // 25 combined
  { key: 'rod-transverg', label: 'Rod of Mystical Transvergance', category: 'mana', itemIds: [3426],    grants: 'Mystical Transvergance — group mana infusion' },              // 5
  { key: 'water-sprinkler', label: 'Water Sprinkler of Nem Ankh', category: 'survival', itemIds: [5532], grants: 'Reviviscence — big instant group heal', wantClass: 'Cleric' }, // 5
];

// One ownership row (opt-outs already filtered by the caller). `main` is the
// resolved family main (main_name_override || main_name || name).
export type KitOwnerRow = {
  itemId: number;
  character: string;
  main: string | null;
  className: string | null;
};

export type KitOwner = { character: string; main: string; className: string | null };

export type KitCoverage = {
  entry: KitEntry;
  owners: KitOwner[];   // distinct characters, family-grouped then name-sorted
  ownerCount: number;
  gap: string | null;   // "Nobody owns X" / "No <class> owns X", else null
};

// Distinct-character coverage per kit entry, with a gap line. A character owning
// the same utility in two slots (or via two variant ids) counts ONCE.
export function computeKitCoverage(catalog: KitEntry[], rows: KitOwnerRow[]): KitCoverage[] {
  return catalog.map((entry) => {
    const ids = new Set(entry.itemIds);
    const byChar = new Map<string, KitOwner>();
    for (const r of rows) {
      if (!ids.has(r.itemId)) continue;
      const key = r.character.toLowerCase();
      if (!byChar.has(key)) {
        byChar.set(key, {
          character: r.character,
          main: (r.main && r.main.trim()) || r.character,
          className: r.className,
        });
      }
    }
    const owners = [...byChar.values()].sort(
      (a, b) => a.main.localeCompare(b.main) || a.character.localeCompare(b.character),
    );

    let gap: string | null = null;
    if (owners.length === 0) {
      gap = `Nobody owns ${entry.label}`;
    } else if (entry.wantClass) {
      const want = normalizeClass(entry.wantClass);
      const covered = owners.some((o) => normalizeClass(o.className) === want);
      if (!covered) gap = `No ${entry.wantClass} owns ${entry.label}`;
    }

    return { entry, owners, ownerCount: owners.length, gap };
  });
}

// All catalog item ids flattened — the /quartermaster page uses this to fetch
// exactly the gear rows it needs (a small `.in(...)`), not the whole table.
export const KIT_ITEM_IDS: number[] = [...new Set(KIT_CATALOG.flatMap((e) => e.itemIds))];

// ─────────────────────────────────────────────────────────────────────────────
// Board 2 — common-quest checklist
// ─────────────────────────────────────────────────────────────────────────────

// A quest step. item_id is the strongest signal (distinguishes same-named
// components — the 10 VT "A Lucid Shard" ids, the four "Quarter of a Diaku
// Emblem" ids). item_name is the fallback. A step with NEITHER is label-only —
// something we can't auto-detect (a flag, a hail, a faction) → renders unknown.
export type QuestStep = {
  label: string;
  itemId?: number | null;
  itemName?: string | null;
  quantity?: number;      // default 1
  optional?: boolean;     // officer hint — doesn't block completion
};

export type QuestDef = {
  id: number | string;
  name: string;
  category?: string | null;
  steps: QuestStep[];
};

// A character's VISIBLE holdings (character_inventory, bank already stripped
// upstream). Both maps sum quantity — `byId` per item id, `names` per
// lowercased name (the fallback when a step is name-only). Assembled by the
// caller; the lib never touches the DB.
export type OwnedItems = {
  byId: Map<number, number>;
  names: Map<string, number>;
};

export function ownedFromRows(
  rows: { item_id: number | null; item_name: string | null; quantity: number | null }[],
): OwnedItems {
  const byId = new Map<number, number>();
  const names = new Map<string, number>();
  for (const r of rows) {
    const qty = r.quantity ?? 1;
    if (r.item_id != null) byId.set(r.item_id, (byId.get(r.item_id) ?? 0) + qty);
    if (r.item_name) {
      const n = r.item_name.trim().toLowerCase();
      names.set(n, (names.get(n) ?? 0) + qty);
    }
  }
  return { byId, names };
}

// have  = detected in visible items (meets the quantity)
// missing = item-backed step, not found in visible items
// unknown = no item to check (label-only) — officer/manual territory (—)
export type StepStatus = 'have' | 'missing' | 'unknown';

export type QuestStepResult = {
  step: QuestStep;
  status: StepStatus;
  needQty: number;
  haveQty: number;      // best-effort; name-only matches report 1
};

export type QuestProgress = {
  quest: QuestDef;
  steps: QuestStepResult[];
  detectable: number;   // required steps we CAN check (has an item)
  have: number;         // detectable required steps satisfied
  complete: boolean;    // detectable > 0 AND every required detectable step satisfied
  hasUnknown: boolean;  // any label-only step (the honesty boundary on this quest)
};

export function matchStep(step: QuestStep, owned: OwnedItems): QuestStepResult {
  const needQty = Math.max(1, step.quantity ?? 1);
  if (step.itemId != null) {
    const haveQty = owned.byId.get(step.itemId) ?? 0;
    return { step, status: haveQty >= needQty ? 'have' : 'missing', needQty, haveQty };
  }
  if (step.itemName && step.itemName.trim()) {
    const haveQty = owned.names.get(step.itemName.trim().toLowerCase()) ?? 0;
    return { step, status: haveQty >= needQty ? 'have' : 'missing', needQty, haveQty };
  }
  return { step, status: 'unknown', needQty, haveQty: 0 };
}

export function computeQuestProgress(quest: QuestDef, owned: OwnedItems): QuestProgress {
  const steps = quest.steps.map((s) => matchStep(s, owned));
  const required = steps.filter((r) => !r.step.optional);
  const detectableSteps = required.filter((r) => r.status !== 'unknown');
  const have = detectableSteps.filter((r) => r.status === 'have').length;
  const detectable = detectableSteps.length;
  return {
    quest,
    steps,
    detectable,
    have,
    complete: detectable > 0 && have === detectable,
    hasUnknown: steps.some((r) => r.status === 'unknown'),
  };
}
