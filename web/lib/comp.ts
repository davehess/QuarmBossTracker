// web/lib/comp.ts — raid composition template + planned-vs-actual matcher (#93).
//
// Pure (only class-titles, itself pure) so it unit-tests without a DB (see
// test/comp-matcher.test.js). The signups page + the template editor do the DB
// I/O; the archetype mapping, template validation, and gap math live here so
// there is exactly ONE class→archetype map in the codebase.
//
// A "template" is an officer-authored target composition: named groups, each
// listing per-slot requirements (a specific class, or an archetype), plus
// optional raid-wide minimums that act as FLOORS. The matcher compares a
// template against a set of signups (their classes) and reports role/archetype
// and per-class deltas ("need 1 more healer, 2 over on melee DPS").

import { normalizeClass } from './class-titles';

export type Archetype = 'tank' | 'healer' | 'support' | 'melee' | 'ranged';
export const ARCHETYPES: Archetype[] = ['tank', 'healer', 'support', 'melee', 'ranged'];
export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  tank: 'tank',
  healer: 'healer',
  support: 'support',
  melee: 'melee DPS',
  ranged: 'ranged/caster DPS',
};

// The ONE class→archetype map. Base classes only (level titles fold via
// normalizeClass). Healers = the three raid CH/HoT classes; support = crowd
// control / haste-and-slow utility; melee = the physical DPS + hybrids that
// stack on a mob; ranged = the nuke/pet/DoT casters.
const CLASS_ARCHETYPE: Record<string, Archetype> = {
  Warrior: 'tank', Paladin: 'tank', 'Shadow Knight': 'tank',
  Cleric: 'healer', Druid: 'healer', Shaman: 'healer',
  Enchanter: 'support', Bard: 'support',
  Monk: 'melee', Rogue: 'melee', Ranger: 'melee', Beastlord: 'melee',
  Wizard: 'ranged', Magician: 'ranged', Necromancer: 'ranged',
};

/** Class name OR level title → raid archetype (null if unrecognized). */
export function classToArchetype(cls: string | null | undefined): Archetype | null {
  const base = normalizeClass(cls);
  return base ? CLASS_ARCHETYPE[base] ?? null : null;
}

export type CompSlot = { class?: string; archetype?: Archetype; count: number };
export type CompGroup = { name: string; requires: CompSlot[] };
export type CompMinimum = { class?: string; archetype?: Archetype; count: number };
export type CompTemplate = { name: string; groups: CompGroup[]; minimums?: CompMinimum[] };

const KNOWN_ARCHETYPE = new Set<string>(ARCHETYPES);

// A signup we can match on. `className` is RaidHelper's class_name (may be
// blank — those count toward headcount but not toward any role).
export type CompSignup = { className: string | null };

export type ArchetypeDelta = { archetype: Archetype; required: number; have: number; delta: number };
export type ClassDelta = { class: string; required: number; have: number; delta: number };

export type CompGaps = {
  archetypes: ArchetypeDelta[];
  classes: ClassDelta[];
  totalRequired: number;
  totalHave: number;
  unmapped: number;           // signups whose class we couldn't map (blank/unknown)
  summary: string[];          // human deltas, most actionable first
};

// ── Validation ───────────────────────────────────────────────────────────────
// Deliberately strict + returns every error (the editor lists them all). A slot
// must name a valid archetype OR a known class and a non-negative integer count.

export type ValidateResult =
  | { ok: true; template: CompTemplate }
  | { ok: false; errors: string[] };

function isKnownClass(name: string): boolean {
  return CLASS_ARCHETYPE[normalizeClass(name) ?? ''] != null;
}

function validateSlot(slot: unknown, where: string, errors: string[]): void {
  if (typeof slot !== 'object' || slot === null) { errors.push(`${where}: must be an object`); return; }
  const s = slot as Record<string, unknown>;
  const hasClass = typeof s.class === 'string' && s.class.trim() !== '';
  const hasArch = typeof s.archetype === 'string' && s.archetype.trim() !== '';
  if (hasClass && hasArch) errors.push(`${where}: set either "class" or "archetype", not both`);
  if (!hasClass && !hasArch) errors.push(`${where}: needs a "class" or an "archetype"`);
  if (hasArch && !KNOWN_ARCHETYPE.has(String(s.archetype))) {
    errors.push(`${where}: unknown archetype "${String(s.archetype)}" (use ${ARCHETYPES.join('/')})`);
  }
  if (hasClass && !isKnownClass(String(s.class))) {
    errors.push(`${where}: unknown class "${String(s.class)}"`);
  }
  if (typeof s.count !== 'number' || !Number.isInteger(s.count) || s.count < 0) {
    errors.push(`${where}: "count" must be a non-negative integer`);
  }
}

export function validateTemplate(raw: unknown): ValidateResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['Template must be a JSON object'] };
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== 'string' || t.name.trim() === '') errors.push('"name" is required');
  if (!Array.isArray(t.groups)) {
    errors.push('"groups" must be an array');
  } else {
    t.groups.forEach((g, gi) => {
      if (typeof g !== 'object' || g === null) { errors.push(`groups[${gi}]: must be an object`); return; }
      const grp = g as Record<string, unknown>;
      if (typeof grp.name !== 'string' || grp.name.trim() === '') errors.push(`groups[${gi}]: "name" is required`);
      if (!Array.isArray(grp.requires)) errors.push(`groups[${gi}]: "requires" must be an array`);
      else grp.requires.forEach((slot, si) => validateSlot(slot, `groups[${gi}].requires[${si}]`, errors));
    });
  }
  if (t.minimums !== undefined) {
    if (!Array.isArray(t.minimums)) errors.push('"minimums" must be an array when present');
    else t.minimums.forEach((m, mi) => validateSlot(m, `minimums[${mi}]`, errors));
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, template: raw as unknown as CompTemplate };
}

// ── Matching ─────────────────────────────────────────────────────────────────

export function summarizeSignups(signups: CompSignup[]): {
  byClass: Record<string, number>;
  byArchetype: Record<Archetype, number>;
  unmapped: number;
} {
  const byClass: Record<string, number> = {};
  const byArchetype = { tank: 0, healer: 0, support: 0, melee: 0, ranged: 0 } as Record<Archetype, number>;
  let unmapped = 0;
  for (const s of signups) {
    const base = normalizeClass(s.className);
    const arch = classToArchetype(s.className);
    if (base && arch) {
      byClass[base] = (byClass[base] ?? 0) + 1;
      byArchetype[arch] += 1;
    } else {
      unmapped += 1;
    }
  }
  return { byClass, byArchetype, unmapped };
}

// Expand a template into required demand. Group slots are additive; raid-wide
// minimums are applied as a FLOOR on their own key (independent of groups).
// A class slot ("MT wants a Warrior") counts toward BOTH the per-class required
// map AND the archetype required map (via classToArchetype) — a specific-class
// need is still an archetype need.
export function templateDemand(template: CompTemplate): {
  requiredArch: Record<Archetype, number>;
  requiredClass: Record<string, number>;
  totalRequired: number;
} {
  const requiredArch = { tank: 0, healer: 0, support: 0, melee: 0, ranged: 0 } as Record<Archetype, number>;
  const requiredClass: Record<string, number> = {};
  let totalRequired = 0;

  const addSlot = (slot: CompSlot) => {
    const count = Math.max(0, Math.trunc(slot.count || 0));
    if (count === 0) return;
    totalRequired += count;
    if (slot.class) {
      const base = normalizeClass(slot.class) ?? slot.class;
      requiredClass[base] = (requiredClass[base] ?? 0) + count;
      const arch = classToArchetype(base);
      if (arch) requiredArch[arch] += count;
    } else if (slot.archetype) {
      requiredArch[slot.archetype] += count;
    }
  };

  for (const g of template.groups ?? []) for (const s of g.requires ?? []) addSlot(s);

  // Minimums = floors on their key, and do NOT add to the headcount total (they
  // catch shortfalls the groups already imply rather than inventing new bodies).
  for (const m of template.minimums ?? []) {
    const count = Math.max(0, Math.trunc(m.count || 0));
    if (m.archetype) requiredArch[m.archetype] = Math.max(requiredArch[m.archetype], count);
    else if (m.class) {
      const base = normalizeClass(m.class) ?? m.class;
      requiredClass[base] = Math.max(requiredClass[base] ?? 0, count);
    }
  }

  return { requiredArch, requiredClass, totalRequired };
}

export function computeCompGaps(template: CompTemplate, signups: CompSignup[]): CompGaps {
  const have = summarizeSignups(signups);
  const { requiredArch, requiredClass, totalRequired } = templateDemand(template);

  const archetypes: ArchetypeDelta[] = ARCHETYPES.map(a => {
    const required = requiredArch[a] ?? 0;
    const h = have.byArchetype[a] ?? 0;
    return { archetype: a, required, have: h, delta: h - required };
  });

  const classNames = new Set<string>([...Object.keys(requiredClass), ...Object.keys(have.byClass)]);
  const classes: ClassDelta[] = [...classNames]
    .map(c => {
      const required = requiredClass[c] ?? 0;
      const h = have.byClass[c] ?? 0;
      return { class: c, required, have: h, delta: h - required };
    })
    // Only rows that carry a requirement or a signup, requirement rows first.
    .filter(r => r.required > 0 || r.have > 0)
    .sort((a, b) => (b.required - a.required) || a.class.localeCompare(b.class));

  const totalHave = signups.length;

  // Summary — archetype shortfalls/surpluses first (the headline), then any
  // specific-class shortfall the archetype view hides.
  const summary: string[] = [];
  for (const a of archetypes) {
    if (a.delta < 0) summary.push(`Need ${-a.delta} more ${ARCHETYPE_LABEL[a.archetype]}`);
  }
  for (const a of archetypes) {
    if (a.delta > 0) summary.push(`${a.delta} over on ${ARCHETYPE_LABEL[a.archetype]}`);
  }
  for (const c of classes) {
    if (c.delta < 0) summary.push(`Need ${-c.delta} more ${c.class}`);
  }
  if (summary.length === 0) summary.push('Composition meets the template.');

  return {
    archetypes,
    classes,
    totalRequired,
    totalHave,
    unmapped: have.unmapped,
    summary,
  };
}
