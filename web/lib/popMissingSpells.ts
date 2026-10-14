// /pop My Characters — "Your PoP spells still needed" (the guild lead, 2026-10-14: "collapsed and let you expand to
// see the full list and what the spell does, link to pqdi, and a copy button to grab the easy list to be able to
// tell people what you're missing").
//
// The rows come from pop_spell_needs, which the page already reads once (paged); this file only reshapes them and
// adds ONE catalog read for the spells' descriptions (eqemu_spells by id, chunked and paged, never one query per
// spell). Everything but loadSpellInfo is pure, so test/pop-missing-spells.test.js runs it for real.
//
// eqemu_spells carries no prose description, so "what it does" is built from what it does carry: beneficial or
// detrimental, who it lands on, how long it lasts, the effects we can name (web/lib/spellDecode.ts) and mana. An
// effect we cannot name is left out rather than printed as "SPA 15".

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { decodeSpellEffects, TARGET_NAME, type SpellRow } from './spellDecode';
import { POP_TURN_INS, POP_TURN_IN_ORDER, type TurnInKey } from './popSpells';

export type MissingSpell = { spell_name: string; spell_id: number | null; spell_level: number | null };

/** What a character row needs to be listed: the page's NeedByChar fits it. */
export type MissingChar = {
  name: string; cls: string | null; level: number | null; isMain: boolean;
  tiers: Record<TurnInKey, MissingSpell[]>; other: MissingSpell[]; total: number;
};

export type TierName = TurnInKey | 'other';
export type MissingRow = { name: string; id: number | null; level: number | null; tier: TierName; tierLabel: string };

/** PQDI answers only on www. (the bare host resets the connection). */
export const pqdiSpellUrl = (id: number) => `https://www.pqdi.cc/spell/${id}`;

/** Short names, as the old table's column heads had them. */
export function tierLabel(t: TierName): string {
  if (t === 'other') return 'Other';
  return POP_TURN_INS[t].item.replace(' Parchment', '').replace('Glyphed Rune Word', 'Rune Word');
}

const byLevelThenName = (a: MissingSpell, b: MissingSpell) =>
  (b.spell_level ?? -1) - (a.spell_level ?? -1) || a.spell_name.localeCompare(b.spell_name);

/** One character's missing spells, grouped by the parchment that buys them (Ethereal first, Other last), each group highest level first. */
export function missingRows(n: MissingChar): MissingRow[] {
  const out: MissingRow[] = [];
  const add = (tier: TierName, list: MissingSpell[]) => {
    for (const s of [...list].sort(byLevelThenName)) {
      out.push({ name: s.spell_name, id: s.spell_id && s.spell_id > 0 ? s.spell_id : null, level: s.spell_level, tier, tierLabel: tierLabel(tier) });
    }
  };
  for (const k of POP_TURN_IN_ORDER) add(k, n.tiers[k]);
  add('other', n.other);
  return out;
}

export type MissingTotals = { characters: number; spells: number; byTier: Record<TierName, number> };

/** The one-line summary: how many characters, how many spells, and how many of each kind of scroll. */
export function missingTotals(chars: MissingChar[]): MissingTotals {
  const byTier: Record<TierName, number> = { ethereal: 0, spectral: 0, glyphed: 0, other: 0 };
  let spells = 0;
  for (const c of chars) {
    for (const k of POP_TURN_IN_ORDER) byTier[k] += c.tiers[k].length;
    byTier.other += c.other.length;
    spells += c.total;
  }
  return { characters: chars.length, spells, byTier };
}

/** "3 characters · 21 spells — Ethereal 8 · Spectral 9 · Rune Word 2 · Other 2" (a kind with none is left out). */
export function totalsText(t: MissingTotals): string {
  const kinds = (['ethereal', 'spectral', 'glyphed', 'other'] as TierName[])
    .filter(k => t.byTier[k] > 0).map(k => `${tierLabel(k)} ${t.byTier[k]}`);
  return `${t.characters} character${t.characters === 1 ? '' : 's'} · ${t.spells} spell${t.spells === 1 ? '' : 's'}${kinds.length ? ` — ${kinds.join(' · ')}` : ''}`;
}

/** EQ's chat line holds about 255 characters including the command; leave room for "/gu " and a little more. */
export const COPY_LINE_MAX = 200;

/**
 * The list a member pastes to tell people what they are missing, split into lines that each fit one EQ chat line:
 *   Aldenmar (Enchanter) needs: Spell A (Ethereal), Spell B (Spectral), Spell C (Other)
 * When it needs more than one line, every line says which it is: "Aldenmar (Enchanter) needs (2/3): ...".
 * A spell is never cut in half. No spells = no lines.
 */
export function copyLines(n: MissingChar, max = COPY_LINE_MAX): string[] {
  const items = missingRows(n).map(r => `${r.name} (${r.tierLabel})`);
  if (items.length === 0) return [];
  const who = n.cls ? `${n.name} (${n.cls})` : n.name;
  const plain = `${who} needs: `;
  if ((plain + items.join(', ')).length <= max) return [plain + items.join(', ')];
  // Pack against the longest header a numbered line can have, so adding the "(i/N)" later never overflows.
  const room = Math.max(20, max - `${who} needs (99/99): `.length);
  const groups: string[][] = [[]];
  for (const it of items) {
    const cur = groups[groups.length - 1];
    const len = cur.length ? cur.join(', ').length + 2 + it.length : it.length;
    if (cur.length && len > room) groups.push([it]); else cur.push(it);
  }
  return groups.map((g, i) => `${who} needs (${i + 1}/${groups.length}): ${g.join(', ')}`);
}

// ── What a spell does ───────────────────────────────────────────────────────

export type SpellInfo = Pick<SpellRow,
  'id' | 'name' | 'mana' | 'buffduration' | 'targettype' | 'good_effect' | 'cast_on_you' |
  'effect_id_1' | 'effect_base_value_1' | 'effect_id_2' | 'effect_base_value_2' | 'effect_id_3' | 'effect_base_value_3'>;

const INFO_COLS =
  'id, name, mana, buffduration, targettype, good_effect, cast_on_you,'
  + ' effect_id_1, effect_base_value_1, effect_id_2, effect_base_value_2, effect_id_3, effect_base_value_3';

function lasts(ticks: number | null): string | null {
  if (!ticks || ticks <= 0) return null;
  const secs = ticks * 6;
  if (secs < 60) return `lasts up to ~${secs} sec`;
  const mins = secs / 60;
  return `lasts up to ~${mins % 1 === 0 ? mins : mins.toFixed(1)} min`;
}

/** One short line: "Beneficial · group · lasts up to ~9 min · Hitpoints +45 · 300 mana". Empty when the catalog has nothing. */
export function spellBlurb(s: SpellInfo | undefined | null): string {
  if (!s) return '';
  const parts: string[] = [];
  if (s.good_effect === 1) parts.push('Beneficial');
  else if (s.good_effect === 0) parts.push('Detrimental');
  if (s.targettype != null && TARGET_NAME[s.targettype]) parts.push(TARGET_NAME[s.targettype]);
  const dur = lasts(s.buffduration);
  if (dur) parts.push(dur);
  const effects = decodeSpellEffects({ ...s, raw: null } as SpellRow).filter(e => !/^SPA \d+/.test(e));
  if (effects.length) parts.push(effects.slice(0, 3).join(', '));
  else if (s.cast_on_you && s.cast_on_you.trim()) {
    const t = s.cast_on_you.trim();
    parts.push(`“${t.length > 60 ? t.slice(0, 57) + '…' : t}”`);
  }
  if (s.mana && s.mana > 0) parts.push(`${s.mana} mana`);
  return parts.join(' · ');
}

/** The distinct catalog ids behind a list of characters' missing spells. */
export function spellIdsOf(chars: MissingChar[]): number[] {
  const ids = new Set<number>();
  for (const c of chars) for (const r of missingRows(c)) if (r.id) ids.add(r.id);
  return [...ids].sort((a, b) => a - b);
}

/** Ids per request. Short enough for the URL, and well under the API's 1,000-row ceiling. */
export const INFO_CHUNK = 300;

/**
 * One catalog lookup for every spell the list names: eqemu_spells by id, a chunk per request, each read through
 * selectAll and ordered on the primary key. A failed read gives back what it has: a blurb is a nicety, and the
 * list itself must never go missing because the catalog was slow.
 */
export async function loadSpellInfo(sb: SupabaseClient, ids: number[]): Promise<Map<number, SpellInfo>> {
  const out = new Map<number, SpellInfo>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += INFO_CHUNK) chunks.push(ids.slice(i, i + INFO_CHUNK));
  // INFO_COLS is a built string, so the client cannot read the row type off it: the cast says what comes back.
  type Page = PromiseLike<{ data: SpellInfo[] | null; error: unknown }>;
  const pages = await Promise.all(chunks.map(chunk => selectAll<SpellInfo>((from, to) => sb
    .from('eqemu_spells').select(INFO_COLS).in('id', chunk).order('id', { ascending: true }).range(from, to) as unknown as Page)
    .catch(() => [] as SpellInfo[])));
  for (const rows of pages) for (const r of rows) out.set(r.id, r);
  return out;
}
