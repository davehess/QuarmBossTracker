// utils/mobSpecials.js — the ONE eqemu `special_abilities` table + the
// mob-info row-picker (#171, folds #161-P1 and #173).
//
// WHY THIS FILE EXISTS
// --------------------
// `eqemu_npc_types` holds MANY rows per mob name. A raid boss typically has a
// real body plus a level-1 "placeholder" / event-controller body that is immune
// to both melee (code 19) and magic (code 20) — it exists so a script can hold
// the spawn point before the encounter starts. The Mob Info overlay used to
// fetch ONE row (`&limit=1`, no ORDER BY), so PostgREST's arbitrary row order
// decided which body a raider saw. The Itraer Vius bug is the canonical case:
//
//   179033  #The_Itraer_Vius   L1   16,350 hp   10^19^20^21^24^27^35   ← placeholder
//   179037   The_Itraer_Vius   L63 600,000 hp   1^2^3,35^…             ← the real boss
//
// `limit=1` served the L1 placeholder: wrong level, wrong HP, and — worse —
// "Immune Melee / Immune Magic" chips on a mob you are actively meleeing.
//
// THE RULE (Hitya, 2026-07-25 — docs/audit-mob-specials.md §"The fix"):
//   1. fetch ALL rows matching the normalized name (never limit=1);
//   2. split REAL rows from PLACEHOLDER rows (placeholder = immune to BOTH 19
//      and 20 — it can never be the mob you're fighting);
//   3. prefer rows in the requester's zone when we know it (#141: an NPC id
//      encodes its zone, id = zoneid*1000 + n);
//   4. the PRIMARY row (name / level / HP / AC / resists) is the HIGHEST-LEVEL
//      REAL row; fall back to a placeholder only when no real row exists;
//   5. the displayed flags are the UNION across the candidate rows — but the
//      candidate set is real-only whenever a real row exists, so a
//      placeholder's "immune to everything" can never fabricate a false
//      Immune-Melee / Immune-Magic warning on a real mob.
//
// This module is required by BOTH the bot's mob-info endpoint (index.js) and
// scripts/audit-mob-specials.mjs, so the code→flag table and the placeholder
// predicate can never drift between the audit and what raiders actually see.

// ── EQEmu SpecialAbility code map ───────────────────────────────────────────
// show:   surface this as a Mob Info chip?
// danger: is it a combat warning that must be UNIONed across same-name
//         variants (if ANY real variant does it, warn)?
//
// Codes marked VERIFY are EQEmu combat-tuning internals whose PQDI rendering is
// unconfirmed; they stay show:false until the PQDI diff (docs/audit-mob-specials.md
// mode 2) settles them. Anything added here shows up in the audit's
// "codes our decoder drops" inventory automatically — that inventory is
// computed from `show` vs DECODED_BY_BOT, both of which now live here.
const MOB_SPECIAL_CODES = {
  1:  { label: 'Summon',                    show: true,  danger: true  },
  2:  { label: 'Enrage',                    show: true,  danger: true  },
  3:  { label: 'Rampage',                   show: true,  danger: true  },
  4:  { label: 'Area Rampage',              show: true,  danger: true  },
  5:  { label: 'Flurry',                    show: true,  danger: true  },
  6:  { label: 'Triple Attack',             show: true,  danger: false },
  7:  { label: 'Quad Attack',               show: true,  danger: false },
  8:  { label: 'Dual Wield',                show: false, danger: false },
  9:  { label: 'Bane',                      show: true,  danger: false },
  10: { label: 'Magical',                   show: true,  danger: false },
  11: { label: 'Ranged',                    show: true,  danger: false },
  12: { label: 'Unslowable',                show: true,  danger: false },
  13: { label: 'Unmezzable',                show: true,  danger: false },
  14: { label: 'Uncharmable',               show: true,  danger: false },
  15: { label: 'Unstunnable',               show: true,  danger: false },
  16: { label: 'Unsnareable',               show: true,  danger: false },  // movement-speed immune
  17: { label: 'Unfearable',                show: true,  danger: false },
  18: { label: 'Undispellable',             show: true,  danger: false },
  19: { label: 'Immune Melee',              show: true,  danger: false },
  20: { label: 'Immune Magic',              show: true,  danger: false },
  21: { label: 'Immune Fleeing',            show: true,  danger: false },  // does NOT flee
  22: { label: 'Immune Melee Except Bane',  show: true,  danger: false },  // #171 (72 rows)
  23: { label: 'Immune Non-Magical',        show: true,  danger: false },  // needs a magic weapon
  // 24 "Will Not Aggro": the audit script had this show:true, but the doc's
  // CONFIRMED dropped-code list (§4) omits it and 1,492 of its 1,708 catalog
  // occurrences are placeholder rows — it would read as noise on real mobs.
  // Left hidden pending the PQDI diff (see docs/audit-mob-specials.md §"#171").
  24: { label: 'Will Not Aggro',            show: false, danger: false },
  25: { label: 'Immune Aggro On',           show: false, danger: false },
  26: { label: 'Immune Ranged Spells',      show: true,  danger: false },  // #171 (182 rows)
  27: { label: 'Immune Feign Death',        show: true,  danger: false },
  28: { label: 'Immune Taunt',              show: true,  danger: false },
  29: { label: 'Tunnel Vision',             show: false, danger: false },
  30: { label: 'No Buff/Heal Friends',      show: false, danger: false },
  31: { label: 'Immune Pacify',             show: true,  danger: false },
  32: { label: 'Leash',                     show: false, danger: false },
  33: { label: 'Tether',                    show: false, danger: false },
  34: { label: 'Destructible Object',       show: false, danger: false },
  35: { label: 'No Harm From Client',       show: false, danger: false },
  36: { label: 'Always Flee',               show: true,  danger: false },  // #171 (7 rows)
  37: { label: 'Flee At Percent',           show: true,  danger: false },  // #171 "runs when low" (54 rows)
  38: { label: 'Allow Beneficial',          show: false, danger: false },
  39: { label: 'Disable Melee',             show: true,  danger: false },  // #171 (106 rows)
  40: { label: 'Chase Distance',            show: false, danger: false },
  41: { label: 'Casting Resist Diff',       show: false, danger: false },
  42: { label: 'Counter Avoid Damage',      show: false, danger: false },  // VERIFY tuning
  43: { label: 'Prox Aggro',                show: false, danger: false },  // VERIFY tuning
  44: { label: 'Immune Ranged Attacks',     show: true,  danger: false },  // #171 (192 rows)
  45: { label: 'Immune Damage (Client)',    show: false, danger: false },
  46: { label: 'Immune Damage (NPC/Pet)',   show: true,  danger: false },  // #171 charm/pet strats (1,312 rows)
  47: { label: 'Immune Aggro (Client)',     show: false, danger: false },
  48: { label: 'Immune Aggro (NPC)',        show: false, danger: false },
  49: { label: 'Modify Avoid Damage',       show: false, danger: false },  // VERIFY tuning
};

// The pre-#171 decoder's label set, kept so the audit can report "codes present
// in the catalog that the SHIPPED decoder used to drop" and so the regression
// harness can assert the added-codes delta explicitly.
const LEGACY_DECODED_CODES = Object.freeze([
  1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 27, 28, 31,
]);

// Legacy npcspecialattks character flags — the pre-`special_abilities` column
// some old catalog rows still carry. Only consulted when special_abilities is
// empty (unchanged from the shipped decoder).
const NPCSPECIALATTKS_FLAGS = {
  E: 'Enrage', F: 'Flurry', R: 'Rampage', r: 'Area Rampage', S: 'Summon',
  T: 'Triple Attack', Q: 'Quad Attack', b: 'Bane', m: 'Magical', a: 'Ranged',
};

// Placeholder predicate: immune to BOTH melee (19) and magic (20).
const PLACEHOLDER_CODES = Object.freeze([19, 20]);

// ── parsing ────────────────────────────────────────────────────────────────
// `special_abilities` is `code,value[,param0[,param1…]]` joined by `^`.
// EQEmu reads sp[0]=ability, sp[1]=value (0 disables it), sp[2..]=params — so
// the flee percent of `37,1,10` is param0 = 10, NOT the value field.
// Returns a Map<code, { value, params[] }> in the order the codes appeared
// (the shipped decoder's label order depends on it).
function parseSpecials(special_abilities) {
  const out = new Map();
  if (!special_abilities) return out;
  for (const part of String(special_abilities).split('^')) {
    const bits = String(part).split(',').map((s) => s.trim());
    const code = parseInt(bits[0], 10);
    if (!Number.isFinite(code)) continue;
    if (bits[1] != null && bits[1] === '0') continue;   // present-but-disabled
    out.set(code, { value: bits[1] != null ? bits[1] : null, params: bits.slice(2) });
  }
  return out;
}

// Is this a placeholder / event-controller body? Accepts either a parsed Map or
// the raw `special_abilities` string.
function isPlaceholder(specials) {
  const map = (specials instanceof Map) ? specials : parseSpecials(specials);
  return PLACEHOLDER_CODES.every((c) => map.has(c));
}

// Decoded chip labels for ONE row, in catalog order, deduped. Falls back to the
// legacy `npcspecialattks` character flags only when special_abilities is empty.
function decodeSpecialLabels(special_abilities, npcspecialattks) {
  const out = [];
  if (special_abilities) {
    for (const code of parseSpecials(special_abilities).keys()) {
      const def = MOB_SPECIAL_CODES[code];
      if (def && def.show && !out.includes(def.label)) out.push(def.label);
    }
  } else if (npcspecialattks) {
    for (const ch of String(npcspecialattks)) {
      const label = NPCSPECIALATTKS_FLAGS[ch];
      if (label && !out.includes(label)) out.push(label);
    }
  }
  return out;
}

// NPC id encodes its zone: id = zoneid*1000 + n (#141). Null for junk ids.
function zoneIdOf(npcId) {
  const n = Number(npcId);
  return Number.isFinite(n) && n > 0 ? Math.floor(n / 1000) : null;
}

// Code 37 (Flee At Percent) ships in TWO encodings in the Quarm catalog and we
// have to read both (counts as of the 2026-08-02 mirror):
//   `37,1,<pct>`  value=1 "enabled", param0 = the percent   — 40 rows (5/6/7/10)
//   `37,<pct>`    the percent lives in the value field       — 14 rows (15/20/50)
// So: a param wins; otherwise a value > 1 is the percent; a bare `37,1` is just
// "it flees" with no percent stated (null — never guessed).
// ⚠ Which field EQEmu itself reads is unconfirmed; the PQDI diff
// (docs/audit-mob-specials.md mode 2) is what settles it. Until then this
// heuristic is the only reading under which every catalog row is sane
// (Innoruuk at 10%, Hand of the Maestro at 50% — not 1%).
function _fleePercent(entry) {
  if (!entry) return null;
  const p = Number(entry.params && entry.params[0]);
  if (Number.isFinite(p) && p > 0) return p;
  const v = Number(entry.value);
  return (Number.isFinite(v) && v > 1) ? v : null;
}

// Movement facts derived from the PRIMARY row only — unlike the flag union
// these describe the specific body being displayed, so merging siblings here
// would be a lie ("this one is rooted, that one isn't" is not a warning, it's
// two different mobs).
//   rooted   runspeed 0 → stationary (Itraer Vius, Yelinak, most NToV dragons)
//   flees    21 Immune-Fleeing → false · 36 Always-Flee / 37 Flee-% → true
//            (no row in the catalog carries both 21 and 37, verified 2026-08-02)
//   flee_pct the HP% it runs at — see _fleePercent for the two encodings
// null everywhere means "catalog doesn't say" — never rendered as a claim.
// A rooted mob that "flees" still can't move; the overlay is free to combine
// the two, we just report what the catalog holds.
function deriveMovement(row) {
  const map = parseSpecials(row && row.special_abilities);
  const rs = Number(row && row.runspeed);
  const hasRs = row && row.runspeed != null && Number.isFinite(rs);
  let flees = null;
  let fleePct = null;
  if (map.has(21)) {
    flees = false;
  } else if (map.has(36)) {
    flees = true;                       // flees from the start; no percent
  } else if (map.has(37)) {
    flees = true;
    fleePct = _fleePercent(map.get(37));
  }
  return {
    runspeed: hasRs ? rs : null,
    rooted:   hasRs ? rs === 0 : null,
    flees,
    flee_pct: fleePct,
  };
}

// Deterministic "which body is the mob" ordering: highest level wins, then the
// widest level band, then the biggest HP pool, then the lowest id so a tie can
// never flip between requests (the whole point of replacing limit=1).
function _byPrimacy(a, b) {
  const lv = (Number(b.row.level) || 0) - (Number(a.row.level) || 0);
  if (lv) return lv;
  const ml = (Number(b.row.maxlevel) || 0) - (Number(a.row.maxlevel) || 0);
  if (ml) return ml;
  const hp = (Number(b.row.hp) || 0) - (Number(a.row.hp) || 0);
  if (hp) return hp;
  return (Number(a.row.id) || 0) - (Number(b.row.id) || 0);
}

/**
 * The #171 pick-and-merge. Give it every row PostgREST returned for the
 * normalized name; get back the row to display plus the merged chip list.
 *
 * @param {Array<object>} rows   eqemu_npc_types rows (id, name, level, hp,
 *                               runspeed, special_abilities, npcspecialattks…)
 * @param {object} [opts]
 * @param {number|null} [opts.zoneId]  requester's zone id (#141), or null
 * @returns {{
 *   row: object|null,        primary row (display stats come from here)
 *   specials: string[],      UNION of chip labels across the candidate rows
 *   scope: string,           which preference tier won (see below)
 *   variants: number,        candidate rows merged into `specials`
 *   total: number,           rows the name matched catalog-wide
 *   real: number,            of those, non-placeholder rows
 *   placeholder: boolean     true when the primary row IS a placeholder
 * }}
 *
 * scope is one of:
 *   'zone-real'            real rows in the requester's zone  (best)
 *   'catalog-real'         real rows anywhere                 (zone unknown / no real row here)
 *   'zone-placeholder'     placeholder rows in the zone       (no real row exists at all)
 *   'catalog-placeholder'  placeholder rows anywhere
 *   'none'                 nothing matched
 */
function pickAndMergeMobRows(rows, opts) {
  const o = opts || {};
  const zRaw = Number(o.zoneId);
  const zoneId = (o.zoneId != null && Number.isFinite(zRaw)) ? zRaw : null;
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const empty = { row: null, specials: [], scope: 'none', variants: 0, total: 0, real: 0, placeholder: false };
  if (!list.length) return empty;

  const annotated = list.map((row) => {
    const map = parseSpecials(row.special_abilities);
    return { row, placeholder: isPlaceholder(map), zone: zoneIdOf(row.id) };
  });
  const real = annotated.filter((a) => !a.placeholder);
  const inZone = (arr) => (zoneId == null ? [] : arr.filter((a) => a.zone === zoneId));

  // Rules 3 + 4, as a preference ladder. Real always beats placeholder — a
  // placeholder in your zone is still a body you cannot fight, so a real row
  // from the catalog is the better answer than the controller next to you.
  let cand;
  let scope;
  const realHere = inZone(real);
  if (realHere.length)      { cand = realHere;  scope = 'zone-real'; }
  else if (real.length)     { cand = real;      scope = 'catalog-real'; }
  else {
    const phHere = inZone(annotated);
    if (phHere.length)      { cand = phHere;    scope = 'zone-placeholder'; }
    else                    { cand = annotated; scope = 'catalog-placeholder'; }
  }

  const ordered = cand.slice().sort(_byPrimacy);
  const primary = ordered[0];

  // Rule 5 — union across the CANDIDATE set. Because the ladder above never
  // mixes tiers, a placeholder's flags can only ever merge with other
  // placeholders (i.e. only when the mob genuinely has no real body).
  const specials = [];
  for (const a of ordered) {
    for (const label of decodeSpecialLabels(a.row.special_abilities, a.row.npcspecialattks)) {
      if (!specials.includes(label)) specials.push(label);
    }
  }

  return {
    row: primary.row,
    specials,
    scope,
    variants: ordered.length,
    total: annotated.length,
    real: real.length,
    placeholder: primary.placeholder,
  };
}

module.exports = {
  MOB_SPECIAL_CODES,
  LEGACY_DECODED_CODES,
  NPCSPECIALATTKS_FLAGS,
  PLACEHOLDER_CODES,
  parseSpecials,
  isPlaceholder,
  decodeSpecialLabels,
  deriveMovement,
  pickAndMergeMobRows,
  zoneIdOf,
};
