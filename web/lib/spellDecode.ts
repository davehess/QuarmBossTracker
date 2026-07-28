// Shared spell decoders for wpqdi's /db/spell page. eqemu_spells is minimal
// (id/name/raw + effect/resist columns, NO per-class level data — see the
// catalog cheat-sheet), so we decode what's actually there: the effect slots
// (best-effort SPA labels), resist, target type, and buff duration.

export type SpellRow = {
  id: number;
  name: string;
  mana: number | null;
  buffduration: number | null;
  buffdurationformula: number | null;
  targettype: number | null;
  skill: number | null;
  effect_id_1: number | null; effect_base_value_1: number | null;
  effect_id_2: number | null; effect_base_value_2: number | null;
  effect_id_3: number | null; effect_base_value_3: number | null;
  cast_time: number | null;
  recast_time: number | null;
  resist_type: number | null;
  resist_diff: number | null;
  good_effect: number | null;
  cast_on_you: string | null;
  cast_on_other: string | null;
  spell_fades: string | null;
  raw: { eff?: (number | null)[]; base?: (number | null)[]; max?: (number | null)[] } | null;
};

export const RESIST_NAME: Record<number, string> = {
  0: 'unresistable', 1: 'magic', 2: 'fire', 3: 'cold', 4: 'poison', 5: 'disease',
};
export const TARGET_NAME: Record<number, string> = {
  3: 'group', 4: 'PB AE', 5: 'single target', 6: 'self', 8: 'targeted AE', 14: 'pet', 41: 'group',
};

// Best-effort SPA (effect) labels — only the ones we're confident about; every
// other effect id falls back to a raw "SPA <n>" so nothing is mislabeled.
const SPA_LABEL: Record<number, (b: number) => string> = {
  0:   (b) => `Hitpoints ${b >= 0 ? '+' : ''}${b}`,
  1:   (b) => `AC ${b >= 0 ? '+' : ''}${b}`,
  2:   (b) => `ATK ${b >= 0 ? '+' : ''}${b}`,
  3:   (b) => `Movement speed ${b}%`,
  11:  (b) => `Attack speed ${b}%`,
  35:  (b) => `Disease counter ${b}`,
  36:  (b) => `Poison counter ${b}`,
  116: (b) => `Curse counter ${b}`,
};

// Turn the three effect slots (or the raw jsonb array when present) into
// human-readable effect strings.
export function decodeSpellEffects(s: SpellRow): string[] {
  const slots: { eff: number; base: number }[] = [];
  const raw = s.raw;
  if (raw && Array.isArray(raw.eff)) {
    for (let i = 0; i < raw.eff.length; i++) {
      const eff = raw.eff[i];
      if (eff == null || eff === 254) continue;   // 254 = empty slot
      slots.push({ eff, base: raw.base?.[i] ?? 0 });
    }
  } else {
    for (const i of [1, 2, 3] as const) {
      const eff = s[`effect_id_${i}`];
      if (eff == null || eff === 254) continue;
      slots.push({ eff, base: s[`effect_base_value_${i}`] ?? 0 });
    }
  }
  const out: string[] = [];
  for (const { eff, base } of slots) {
    if (eff === 10 && base === 0) continue;   // SPA 10 base 0 = inert filler slot
    const fn = SPA_LABEL[eff];
    out.push(fn ? fn(base) : `SPA ${eff}: ${base}`);
  }
  return out;
}

// buffduration is the tick cap (formula scales it by caster level, which we
// don't have). "up to N ticks" is the honest display; 1 tick ≈ 6s.
export function fmtDuration(dur: number | null): string {
  if (!dur || dur <= 0) return 'instant / no duration';
  const mins = (dur * 6) / 60;
  const minLabel = mins % 1 === 0 ? `${mins}` : mins.toFixed(1);
  return `up to ${dur} ticks (~${minLabel} min)`;
}

export function fmtSeconds(ms: number | null): string {
  if (ms == null) return '—';
  if (ms <= 0) return 'instant';
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}
