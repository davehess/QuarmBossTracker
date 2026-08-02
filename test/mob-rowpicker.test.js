// #171 — mob-info row-picker: pick-and-merge instead of `limit=1`. REAL-IMPORT.
//
// The endpoint (`GET /api/agent/mob-info`, index.js) used to fetch ONE
// eqemu_npc_types row with `&limit=1` and no ORDER BY, so PostgREST's arbitrary
// row order decided which of a name's many bodies a raider saw. utils/mobSpecials
// now owns the rule from docs/audit-mob-specials.md §"The fix" (Hitya, 2026-07-25):
// all rows → split real vs placeholder → prefer the requester's zone → primary is
// the highest-level REAL row → flags are the UNION across real rows only.
//
// EVERY fixture below is a VERBATIM row set from the live Supabase mirror of
// eqemu_npc_types (queried 2026-08-02) — not hand-written shapes. If the weekly
// sync changes one of these mobs the fixture goes stale, which is the point:
// these are the exact bodies the audit's worklist calls out.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ms = require('../utils/mobSpecials.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── real catalog rows (eqemu_npc_types, 2026-08-02) ────────────────────────
// Single-row name: nothing to pick, nothing to merge — the "identical to
// before" case. Also the rooted case (runspeed 0).
const YELINAK = [
  { id: 114618, name: 'Lord_Yelinak', level: 70, maxlevel: 0, hp: 500000, runspeed: 0, npcspecialattks: null,
    special_abilities: '1,1^2,1^3,1,7^6,1^7,1^10,1^12,1^13,1^14,1^15,1^16,1^17,1^21,1^26,1' },
];

// The canonical bug. 179033 is the level-1 placeholder body (immune melee 19 +
// magic 20); 179037 is the 600k-HP boss. `limit=1` served 179033.
const ITRAER_VIUS = [
  { id: 179033, name: '#The_Itraer_Vius', level: 1, maxlevel: 0, hp: 16350, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '10,1^19,1^20,1^21,1^24,1^27,1^35,1' },
  { id: 179037, name: 'The_Itraer_Vius', level: 63, maxlevel: 0, hp: 600000, runspeed: 0, npcspecialattks: null,
    special_abilities: '1,1^2,1^3,1,35^10,1^12,1^13,1^14,1^16,1^17,1^21,1^23,1^31,1^42,1^43,1' },
];

// The audit's headline divergent cluster: the L56 body rampages (code 3), the
// two L53 bodies do not. Row order here is the catalog's own id order — the
// order PostgREST would hand back, i.e. `limit=1` picked the L53 non-rampager.
const MAESTRO = [
  { id: 76006, name: 'Maestro_of_Rancor', level: 53, maxlevel: 0, hp: 32000, runspeed: 1.5, npcspecialattks: null,
    special_abilities: '1,1^10,1^13,1^14,1^15,1^16,1^17,1^21,1^23,1^31,1^42,1^44,1' },
  { id: 76011, name: 'Maestro_of_Rancor', level: 56, maxlevel: 0, hp: 32000, runspeed: 1.5, npcspecialattks: null,
    special_abilities: '1,1^3,1,10^10,1^13,1^14,1^15,1^16,1^17,1^21,1^23,1^31,1^42,1^44,1' },
  { id: 76611, name: 'Maestro_of_Rancor', level: 53, maxlevel: 0, hp: 32000, runspeed: 1.5, npcspecialattks: null,
    special_abilities: '1,1^10,1^13,1^14,1^15,1^16,1^17,1^21,1^23,1^31,1^42,1^44,1' },
];

// A name whose ONLY body is a placeholder (a quest NPC you can target but not
// kill). Must still resolve — the fallback in rule 4.
const IRONBEARD = [
  { id: 68233, name: 'Harbormaster_Ironbeard', level: 99, maxlevel: 0, hp: 60000, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '19,1^20,1^24,1^10,1' },
];

// #141's mob: three real bodies in two zones (119 = The Wakening Land,
// 121 = Crystal Caverns). Zone scoping must still win here.
const GEONID = [
  { id: 119026, name: 'a_geonid', level: 44, maxlevel: 48, hp: 9790, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '10,1^23,1' },
  { id: 121013, name: 'a_geonid', level: 33, maxlevel: 37, hp: 1952, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '10,1^37,15' },
  { id: 121067, name: 'a_geonid', level: 31, maxlevel: 33, hp: 1271, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '10,1^37,15' },
];

// Four bodies across two zones, one of them a rooted placeholder-ish
// controller. 105182 rampages; 102010 doesn't. Both are real.
const VENRIL = [
  { id: 102010, name: 'Venril_Sathir', level: 55, maxlevel: 0, hp: 18275, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '1,1^10,1^14,1^15,1^17,1^21,1^42,1^43,1' },
  { id: 102021, name: '#Venril_Sathir', level: 55, maxlevel: 0, hp: 18275, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '1,1^10,1^12,1^14,1^15,1^16,1^17,1^21,1^23,1' },
  { id: 105021, name: 'Venril_Sathir', level: 55, maxlevel: 0, hp: 14275, runspeed: 0, npcspecialattks: null,
    special_abilities: '10,1^21,1^24,1^35,1' },
  { id: 105182, name: '#Venril_Sathir', level: 55, maxlevel: 0, hp: 14275, runspeed: 1.25, npcspecialattks: null,
    special_abilities: '1,1^3,1^10,1^12,1^13,1^14,1^15,1^16,1^17,1^21,1' },
];

const ALL_FIXTURES = [].concat(YELINAK, ITRAER_VIUS, MAESTRO, IRONBEARD, GEONID, VENRIL);

// ── the PRE-#171 decoder, transcribed verbatim from index.js@2051ac1 ────────
// The regression baseline: whatever else changes, every label the shipped
// decoder used to emit must still be emitted, in the same order.
const LEGACY_LABELS = {
  1: 'Summon', 2: 'Enrage', 3: 'Rampage', 4: 'Area Rampage', 5: 'Flurry',
  6: 'Triple Attack', 7: 'Quad Attack', 9: 'Bane', 10: 'Magical', 11: 'Ranged',
  12: 'Unslowable', 13: 'Unmezzable', 14: 'Uncharmable', 15: 'Unstunnable',
  16: 'Unsnareable', 17: 'Unfearable', 18: 'Undispellable', 19: 'Immune Melee',
  20: 'Immune Magic', 21: 'Immune Fleeing', 23: 'Immune Non-Magical',
  27: 'Immune Feign Death', 28: 'Immune Taunt', 31: 'Immune Pacify',
};
function legacyDecode(special_abilities, npcspecialattks) {
  const out = [];
  if (special_abilities) {
    for (const part of String(special_abilities).split('^')) {
      const bits = part.split(',');
      const id = parseInt(bits[0], 10);
      if (!Number.isFinite(id)) continue;
      if (bits[1] != null && String(bits[1]).trim() === '0') continue;
      const label = LEGACY_LABELS[id];
      if (label && !out.includes(label)) out.push(label);
    }
  } else if (npcspecialattks) {
    const FLAG = { E: 'Enrage', F: 'Flurry', R: 'Rampage', r: 'Area Rampage', S: 'Summon',
      T: 'Triple Attack', Q: 'Quad Attack', b: 'Bane', m: 'Magical', a: 'Ranged' };
    for (const ch of String(npcspecialattks)) if (FLAG[ch] && !out.includes(FLAG[ch])) out.push(FLAG[ch]);
  }
  return out;
}

// ── the PRE-#171 row picker, transcribed from index.js@2051ac1 ─────────────
// Zone-scoped query first (`id BETWEEN z*1000 AND z*1000+999`, limit 1), then
// a catalog-wide `limit=1`. With no ORDER BY, "the first row" is whatever
// PostgREST hands back — modelled here as the catalog's id order, which is what
// the mirror actually returns.
function legacyPick(rows, zoneId) {
  const byId = [...rows].sort((a, b) => a.id - b.id);
  if (zoneId != null && Number.isFinite(zoneId)) {
    const scoped = byId.filter((r) => r.id >= zoneId * 1000 && r.id <= zoneId * 1000 + 999);
    if (scoped.length) return scoped[0];
  }
  return byId[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('#171 (a) single-row mob resolves exactly as it did pre-fix', () => {
  const picked = ms.pickAndMergeMobRows(YELINAK, { zoneId: null });

  it('picks the only row', () => {
    expect(picked.row.id).toBe(114618);
    expect(picked.variants).toBe(1);
    expect(picked.total).toBe(1);
    expect(picked.placeholder).toBe(false);
    expect(picked.scope).toBe('catalog-real');
  });

  it('emits every legacy label, in the legacy order, as a prefix-preserving superset', () => {
    const legacy = legacyDecode(YELINAK[0].special_abilities, null);
    for (const label of legacy) expect(picked.specials).toContain(label);
    // relative order of the legacy labels is unchanged
    const kept = picked.specials.filter((l) => legacy.includes(l));
    expect(kept).toEqual(legacy);
  });

  it('the only NEW label is the #171 addition the catalog row actually carries', () => {
    const legacy = legacyDecode(YELINAK[0].special_abilities, null);
    const added = picked.specials.filter((l) => !legacy.includes(l));
    expect(added).toEqual(['Immune Ranged Spells']);   // code 26
  });

  it('surfaces runspeed 0 as rooted, and Immune-Fleeing (21) as does-not-flee', () => {
    expect(ms.deriveMovement(picked.row)).toEqual({
      runspeed: 0, rooted: true, flees: false, flee_pct: null,
    });
  });

  it('picks the SAME row the old limit=1 path did, at every zone scope', () => {
    for (const z of [null, 114, 121, 999]) {
      expect(ms.pickAndMergeMobRows(YELINAK, { zoneId: z }).row.id).toBe(legacyPick(YELINAK, z).id);
    }
  });

  it('single-body names are unaffected in general (Ironbeard too)', () => {
    for (const rows of [YELINAK, IRONBEARD]) {
      expect(ms.pickAndMergeMobRows(rows, { zoneId: null }).row.id).toBe(legacyPick(rows, null).id);
    }
  });
});

describe('#171 the four multi-row fixtures are exactly where the OLD picker went wrong', () => {
  it('limit=1 served the L1 placeholder for The Itraer Vius; the picker serves the boss', () => {
    expect(legacyPick(ITRAER_VIUS, null).id).toBe(179033);       // the bug
    expect(ms.pickAndMergeMobRows(ITRAER_VIUS, { zoneId: 179 }).row.id).toBe(179037);
    expect(legacyPick(ITRAER_VIUS, 179).id).toBe(179033);        // zone scoping did NOT save it
  });

  it('limit=1 served a non-rampaging L53 Maestro; the picker serves the L56 + merges Rampage', () => {
    expect(legacyPick(MAESTRO, 76).id).toBe(76006);
    expect(ms.pickAndMergeMobRows(MAESTRO, { zoneId: 76 }).row.id).toBe(76011);
  });
});

describe('#171 (a2) the legacy label set survives on EVERY real catalog fixture', () => {
  it('never drops a label the shipped decoder emitted', () => {
    for (const row of ALL_FIXTURES) {
      const legacy = legacyDecode(row.special_abilities, row.npcspecialattks);
      const now = ms.decodeSpecialLabels(row.special_abilities, row.npcspecialattks);
      expect({ id: row.id, kept: now.filter((l) => legacy.includes(l)) })
        .toEqual({ id: row.id, kept: legacy });
    }
  });

  it('adds only codes 22/26/36/37/39/44/46 — the set docs/audit-mob-specials.md confirms', () => {
    const CONFIRMED = new Set([22, 26, 36, 37, 39, 44, 46].map((c) => ms.MOB_SPECIAL_CODES[c].label));
    for (const row of ALL_FIXTURES) {
      const legacy = new Set(legacyDecode(row.special_abilities, row.npcspecialattks));
      for (const label of ms.decodeSpecialLabels(row.special_abilities, row.npcspecialattks)) {
        if (!legacy.has(label)) expect(CONFIRMED.has(label)).toBe(true);
      }
    }
  });

  it('the shown-code set is exactly legacy + the seven confirmed additions', () => {
    const shown = Object.keys(ms.MOB_SPECIAL_CODES)
      .filter((c) => ms.MOB_SPECIAL_CODES[c].show).map(Number).sort((a, b) => a - b);
    const expected = [...ms.LEGACY_DECODED_CODES, 22, 26, 36, 37, 39, 44, 46].sort((a, b) => a - b);
    expect(shown).toEqual(expected);
  });
});

describe('#171 (b) multi-variant mob picks the highest-level REAL row', () => {
  it('Maestro of Rancor → the L56 body, not the L53 one limit=1 returned', () => {
    const picked = ms.pickAndMergeMobRows(MAESTRO, { zoneId: null });
    expect(picked.row.id).toBe(76011);
    expect(picked.row.level).toBe(56);
    expect(picked.variants).toBe(3);
    expect(picked.real).toBe(3);
  });

  it('merges Rampage in — the L53 bodies do not have it, the raider must still be warned', () => {
    expect(ms.decodeSpecialLabels(MAESTRO[0].special_abilities, null)).not.toContain('Rampage');
    const picked = ms.pickAndMergeMobRows(MAESTRO, { zoneId: null });
    expect(picked.specials).toContain('Rampage');
    expect(picked.specials).toContain('Summon');
  });

  it('The Itraer Vius → the L63 / 600k-HP boss, not the L1 placeholder', () => {
    const picked = ms.pickAndMergeMobRows(ITRAER_VIUS, { zoneId: null });
    expect(picked.row.id).toBe(179037);
    expect(picked.row.level).toBe(63);
    expect(picked.row.hp).toBe(600000);
    expect(picked.placeholder).toBe(false);
    expect(picked.real).toBe(1);
    expect(picked.total).toBe(2);
  });

  it('the pick is deterministic regardless of the order PostgREST returns rows', () => {
    const shuffles = [
      [MAESTRO[2], MAESTRO[0], MAESTRO[1]],
      [MAESTRO[1], MAESTRO[2], MAESTRO[0]],
      [...MAESTRO].reverse(),
    ];
    for (const rows of shuffles) {
      const p = ms.pickAndMergeMobRows(rows, { zoneId: null });
      expect(p.row.id).toBe(76011);
      expect(p.specials).toEqual(ms.pickAndMergeMobRows(MAESTRO, { zoneId: null }).specials);
    }
  });
});

describe('#171 (c) a placeholder-only mob still resolves', () => {
  const picked = ms.pickAndMergeMobRows(IRONBEARD, { zoneId: null });

  it('falls back to the placeholder rather than returning nothing', () => {
    expect(picked.row.id).toBe(68233);
    expect(picked.placeholder).toBe(true);
    expect(picked.scope).toBe('catalog-placeholder');
    expect(picked.real).toBe(0);
  });

  it('shows its real immunities — they ARE the truth for a body with no other variant', () => {
    expect(picked.specials).toContain('Immune Melee');
    expect(picked.specials).toContain('Immune Magic');
  });

  it('an empty row set yields a null mob (the endpoint\'s "no catalog stats" path)', () => {
    for (const empty of [[], null, undefined]) {
      const p = ms.pickAndMergeMobRows(empty, { zoneId: null });
      expect(p.row).toBe(null);
      expect(p.specials).toEqual([]);
      expect(p.scope).toBe('none');
    }
  });
});

describe('#171 (d) placeholder flags NEVER leak into a real mob\'s union', () => {
  it('The Itraer Vius shows no Immune Melee / Immune Magic (the fabricated-warning bug)', () => {
    const picked = ms.pickAndMergeMobRows(ITRAER_VIUS, { zoneId: null });
    expect(picked.specials).not.toContain('Immune Melee');
    expect(picked.specials).not.toContain('Immune Magic');
    // …even though the placeholder row plainly carries both.
    expect(ms.decodeSpecialLabels(ITRAER_VIUS[0].special_abilities, null)).toContain('Immune Melee');
    expect(ms.decodeSpecialLabels(ITRAER_VIUS[0].special_abilities, null)).toContain('Immune Magic');
  });

  it('holds when the placeholder is the highest-level row', () => {
    // Synthetic ONLY in its levels: a L99 placeholder alongside the real L63
    // boss. Level must not beat realness.
    const rows = [
      { ...ITRAER_VIUS[0], level: 99 },
      ITRAER_VIUS[1],
    ];
    const picked = ms.pickAndMergeMobRows(rows, { zoneId: null });
    expect(picked.row.id).toBe(179037);
    expect(picked.specials).not.toContain('Immune Melee');
  });

  it('Venril Sathir merges the two real bodies without the rooted controller\'s flags', () => {
    // 105021 is the rooted "immune to everything" controller in zone 105.
    const picked = ms.pickAndMergeMobRows(VENRIL, { zoneId: null });
    expect(picked.placeholder).toBe(false);
    expect(picked.real).toBe(4);   // 105021 has no 19/20 pair — it is NOT a placeholder
    expect(picked.specials).toContain('Rampage');    // only 105182 has it
    expect(picked.specials).toContain('Unslowable'); // only 102021 / 105182 have it
  });

  it('the union is real-only by construction — a placeholder can only merge with placeholders', () => {
    const rows = [ITRAER_VIUS[0], ITRAER_VIUS[1], IRONBEARD[0]];
    const picked = ms.pickAndMergeMobRows(rows, { zoneId: null });
    expect(picked.scope).toBe('catalog-real');
    expect(picked.variants).toBe(1);   // only the one real row merged
  });
});

describe('#171 keeps #141 zone scoping (NPC id encodes the zone: id = zoneid*1000 + n)', () => {
  it('a requester in Crystal Caverns (121) gets the Crystal Caverns geonid', () => {
    const picked = ms.pickAndMergeMobRows(GEONID, { zoneId: 121 });
    expect(picked.scope).toBe('zone-real');
    expect(picked.row.id).toBe(121013);   // highest-level row IN zone 121
    expect(picked.variants).toBe(2);
  });

  it('a requester in The Wakening Land (119) gets the Wakening Land geonid', () => {
    const picked = ms.pickAndMergeMobRows(GEONID, { zoneId: 119 });
    expect(picked.scope).toBe('zone-real');
    expect(picked.row.id).toBe(119026);
    expect(picked.variants).toBe(1);
  });

  it('the other zone\'s flags do not merge in (Crystal Caverns geonids flee, the WL one does not)', () => {
    expect(ms.pickAndMergeMobRows(GEONID, { zoneId: 119 }).specials).not.toContain('Flee At Percent');
    expect(ms.pickAndMergeMobRows(GEONID, { zoneId: 121 }).specials).toContain('Flee At Percent');
  });

  it('unknown zone → catalog-wide, fail-open exactly as before', () => {
    for (const z of [null, undefined, NaN, '']) {
      const picked = ms.pickAndMergeMobRows(GEONID, { zoneId: z });
      expect(picked.scope).toBe('catalog-real');
      expect(picked.row.id).toBe(119026);   // highest level catalog-wide
    }
  });

  it('a zone with no same-name row falls back catalog-wide instead of 404ing', () => {
    const picked = ms.pickAndMergeMobRows(GEONID, { zoneId: 999 });
    expect(picked.scope).toBe('catalog-real');
    expect(picked.row.id).toBe(119026);
  });

  it('a zone holding ONLY the placeholder falls through to the real body elsewhere', () => {
    // The #171 improvement over the old zone-scoped-query-first shape: the old
    // code took whatever the requester's zone held, placeholder included.
    const rows = [
      { ...ITRAER_VIUS[0], id: 900001 },   // placeholder in zone 900
      ITRAER_VIUS[1],                      // real boss in zone 179
    ];
    const picked = ms.pickAndMergeMobRows(rows, { zoneId: 900 });
    expect(picked.scope).toBe('catalog-real');
    expect(picked.row.id).toBe(179037);
  });
});

describe('#171 runspeed / flee decoding (codes 21 / 36 / 37)', () => {
  it('runspeed 0 → rooted', () => {
    expect(ms.deriveMovement({ runspeed: 0, special_abilities: '' }).rooted).toBe(true);
    expect(ms.deriveMovement({ runspeed: 1.25, special_abilities: '' }).rooted).toBe(false);
  });

  it('missing runspeed → null, never a false "not rooted" claim', () => {
    expect(ms.deriveMovement({ special_abilities: '10,1' }).rooted).toBe(null);
    expect(ms.deriveMovement({ runspeed: null, special_abilities: '10,1' }).runspeed).toBe(null);
  });

  it('code 21 Immune-Fleeing → flees false', () => {
    expect(ms.deriveMovement({ runspeed: 1.25, special_abilities: '10,1^21,1' }).flees).toBe(false);
  });

  it('code 36 Always-Flee → flees true with no percent', () => {
    // #Hand_of_the_Maestro's real encoding.
    const m = ms.deriveMovement({ runspeed: 1.25, special_abilities: '36,1' });
    expect(m.flees).toBe(true);
    expect(m.flee_pct).toBe(null);
  });

  it('code 37 reads BOTH catalog encodings of the percent', () => {
    // `37,1,10` — Innoruuk / Cazic Thule / Lord Nagafen (35 rows)
    expect(ms.deriveMovement({ runspeed: 1.5, special_abilities: '1,1^10,1^37,1,10^32,1,250' }).flee_pct).toBe(10);
    // `37,15` — a_geonid / Zordak Ragefire (5 rows); `37,20`, `37,50` likewise
    expect(ms.deriveMovement({ runspeed: 1.25, special_abilities: '10,1^37,15' }).flee_pct).toBe(15);
    expect(ms.deriveMovement({ runspeed: 1.25, special_abilities: '10,1^37,50' }).flee_pct).toBe(50);
    // bare `37,1` states no percent — null, not 1
    expect(ms.deriveMovement({ runspeed: 1.25, special_abilities: '37,1' }).flee_pct).toBe(null);
    expect(ms.deriveMovement({ runspeed: 1.25, special_abilities: '37,1' }).flees).toBe(true);
  });

  it('a `,0` value still means DISABLED (the shipped parser\'s rule, unchanged)', () => {
    expect(ms.decodeSpecialLabels('1,0^3,1', null)).toEqual(['Rampage']);
    expect(ms.parseSpecials('1,0^3,1').has(1)).toBe(false);
  });
});

describe('#171 placeholder predicate', () => {
  it('is "immune to BOTH melee (19) and magic (20)" — never one alone', () => {
    expect(ms.isPlaceholder('10,1^19,1^20,1')).toBe(true);
    expect(ms.isPlaceholder('10,1^19,1')).toBe(false);
    expect(ms.isPlaceholder('10,1^20,1')).toBe(false);   // e.g. Sentinel_Flavius
    expect(ms.isPlaceholder('')).toBe(false);
    expect(ms.isPlaceholder(null)).toBe(false);
  });

  it('a disabled 19 or 20 does not make a placeholder', () => {
    expect(ms.isPlaceholder('19,0^20,1')).toBe(false);
  });
});

// ── the wiring: prove index.js actually calls the shared module ─────────────
describe('#171 the shipped endpoint uses the shared picker (not a stale copy)', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

  it('index.js requires utils/mobSpecials', () => {
    expect(SRC).toContain("require('./utils/mobSpecials')");
  });

  it('the mob-info name lookup no longer asks for a single row', () => {
    const sel = SRC.slice(SRC.indexOf('const _nameSel ='), SRC.indexOf('const _nameSel =') + 800);
    expect(sel).toContain('runspeed');          // #171 fix 2
    expect(sel).toContain('limit=200');
    expect(sel).not.toContain('limit=1&');
    expect(sel).not.toMatch(/limit=1`/);
  });

  it('the handler calls pickAndMergeMobRows with the #141 zone id', () => {
    expect(SRC).toContain('mobSpecials.pickAndMergeMobRows(rows, { zoneId: reqZoneId })');
  });

  it('the mob payload carries the merged specials + movement fields', () => {
    expect(SRC).toContain('specials: picked.specials');
    expect(SRC).toContain('rooted:   move.rooted');
    expect(SRC).toContain('flees:    move.flees');
  });

  it('the audit script shares the same table (no second copy to drift)', () => {
    const audit = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-mob-specials.mjs'), 'utf8');
    expect(audit).toContain("'utils', 'mobSpecials.js'");
    expect(audit).toContain('mobSpecials.MOB_SPECIAL_CODES');
  });
});
