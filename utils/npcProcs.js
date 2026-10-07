// utils/npcProcs.js — a mob's PROCS for the mob-info payload (the guild lead, 2026-10-07:
// "Need to see mobs Procs as well, not just spells").
//
// A proc is not a spell-list entry: it lives on the npc_spells LIST row itself, as three
// slots — attack_proc / proc_chance (on a melee hit), range_proc / rproc_chance (ranged),
// defensive_proc / dproc_chance (when hit). A slot of -1 or 0 means none. A list that
// leaves a slot unset inherits it from its parent_list, so the chain the spell walk
// already resolves is walked here too, nearest list first.
//
// Pure functions: index.js does the reads, this shapes them (and the tests run it).

const SLOTS = [
  { kind: 'attack',    proc: 'attack_proc',    chance: 'proc_chance'  },
  { kind: 'range',     proc: 'range_proc',     chance: 'rproc_chance' },
  { kind: 'defensive', proc: 'defensive_proc', chance: 'dproc_chance' },
];

// chainRows: eqemu_npc_spells rows, the mob's own list first, then its parent, and so on.
// Each slot takes the first list in the chain that sets it, and its chance comes from THAT
// list. Returns [{ kind, spell_id, chance }] in attack, range, defensive order; chance is a
// percent, or null when the list carries none.
function resolveProcSlots(chainRows) {
  const out = [];
  const rows = Array.isArray(chainRows) ? chainRows : [];
  for (const s of SLOTS) {
    for (const row of rows) {
      const id = Number(row && row[s.proc]);
      if (!(id > 0)) continue;
      const ch = Number(row[s.chance]);
      out.push({ kind: s.kind, spell_id: id, chance: ch > 0 ? ch : null });
      break;
    }
  }
  return out;
}

// eqemu_spells targettype values that hit an area rather than one body (2 AE PC v1,
// 4 PB AE, 8 targeted AE, 20 targeted AE tap, 24 undead AE, 25 summoned AE, 40 AE PC v2).
const AE_TARGET_TYPES = new Set([2, 4, 8, 20, 24, 25, 40]);

function _secs(ms) {
  const s = Math.round(Number(ms) / 100) / 10;
  return (Number.isInteger(s) ? String(s) : s.toFixed(1)) + 's';
}

// A short digest of what a spell does, from the common effect ids only:
//   0 HP (negative = damage, positive = heal; with a duration it is a DoT),
//   21 stun (base is milliseconds), 3 movement (negative = snare), 11 attack speed (below
//   100 = slow), 31 mez, 23 fear, 99 root, 27 dispel. Anything else is left out, so a spell
//   whose effects are all unlisted digests to just its AE tag, or ''.
// The spell mirror carries no radius, so an area spell says "AE" without a number.
function procEffectSummary(spell) {
  if (!spell) return '';
  const raw = spell.raw && Array.isArray(spell.raw.eff) ? spell.raw : null;
  const slots = [];
  if (raw) {
    for (let i = 0; i < raw.eff.length; i++) slots.push([raw.eff[i], raw.base ? raw.base[i] : 0]);
  } else {
    for (let i = 1; i <= 3; i++) slots.push([spell['effect_id_' + i], spell['effect_base_value_' + i]]);
  }
  const dur = Number(spell.buffduration) || 0;
  const parts = [];
  const add = (p) => { if (!parts.includes(p)) parts.push(p); };
  for (const [idRaw, baseRaw] of slots) {
    const id = Number(idRaw);
    const base = Number(baseRaw);
    if (!Number.isFinite(id) || !Number.isFinite(base)) continue;
    if (id === 0 && base < 0) add(dur > 0 ? 'DoT ' + Math.abs(base) + '/tick · ' + (dur * 6) + 's' : Math.abs(base) + ' dmg');
    else if (id === 0 && base > 0) add('heal ' + base);
    else if (id === 21 && base > 0) add('stun ' + _secs(base));
    else if (id === 3 && base < 0) add('snare');
    else if (id === 11 && base > 0 && base < 100) add('slow ' + (100 - base) + '%');
    else if (id === 31) add('mez');
    else if (id === 23) add('fear');
    else if (id === 99) add('root');
    else if (id === 27) add('dispel');
  }
  if (AE_TARGET_TYPES.has(Number(spell.targettype))) parts.push('AE');
  return parts.slice(0, 5).join(' · ');
}

// The mob-info `procs` array: [{ kind, spell_id, name, chance, summary }].
// spellRows: eqemu_spells rows for the slots' spell ids (any order; a missing one still
// yields a row, named "Spell #<id>", so the proc is never silently dropped).
function buildProcs(chainRows, spellRows) {
  const byId = new Map((Array.isArray(spellRows) ? spellRows : []).map(s => [Number(s.id), s]));
  return resolveProcSlots(chainRows).map(p => {
    const sp = byId.get(p.spell_id);
    return {
      kind: p.kind,
      spell_id: p.spell_id,
      name: (sp && sp.name) || ('Spell #' + p.spell_id),
      chance: p.chance,
      summary: procEffectSummary(sp),
    };
  });
}

module.exports = { resolveProcSlots, procEffectSummary, buildProcs, AE_TARGET_TYPES };
