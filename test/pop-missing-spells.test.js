// test/pop-missing-spells.test.js — "Your PoP spells still needed" on /pop My Characters (the guild lead,
// 2026-10-14: "collapsed and let you expand to see the full list and what the spell does, link to pqdi, and a copy
// button to grab the easy list to be able to tell people what you're missing").
//
// web/lib/popMissingSpells.ts is pure apart from loadSpellInfo, so the rows, the totals line, the copy text, the
// description line and the catalog read run for real (the read against a fake PostgREST that enforces the
// 1,000-row cap). The component and the page are read as comment-stripped source for what has no function to call.
//
// Run: npx vitest run test/pop-missing-spells.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  COPY_LINE_MAX, INFO_CHUNK, copyLines, loadSpellInfo, missingRows, missingTotals, pqdiSpellUrl, spellBlurb,
  spellIdsOf, tierLabel, totalsText,
} from '../web/lib/popMissingSpells.ts';

// Names invented.
const sp = (spell_name, spell_id, spell_level) => ({ spell_name, spell_id, spell_level });
const char = (name, cls, tiers = {}, other = [], isMain = true) => {
  const t = { ethereal: [], spectral: [], glyphed: [], ...tiers };
  return { name, cls, level: 65, isMain, tiers: t, other, total: t.ethereal.length + t.spectral.length + t.glyphed.length + other.length };
};
const ALDENMAR = char('Aldenmar', 'Enchanter', {
  ethereal: [sp('Spell A', 101, 61), sp('Spell B', 102, 62)],
  spectral: [sp('Spell C', 103, 64)],
  glyphed: [sp('Spell D', 104, 65)],
}, [sp('Spell E', 105, 60)]);

describe('the rows', () => {
  it('group by the parchment that buys them, Ethereal first and Other last, highest level first inside a group', () => {
    expect(missingRows(ALDENMAR).map(r => `${r.name}|${r.tierLabel}|${r.level}`)).toEqual([
      'Spell B|Ethereal|62', 'Spell A|Ethereal|61', 'Spell C|Spectral|64', 'Spell D|Rune Word|65', 'Spell E|Other|60',
    ]);
  });
  it('the tier names are the short ones the old column heads used', () => {
    expect(['ethereal', 'spectral', 'glyphed', 'other'].map(tierLabel)).toEqual(['Ethereal', 'Spectral', 'Rune Word', 'Other']);
  });
  it('a spell with no catalog id is listed, just not linked; id 0 is not an id', () => {
    const rows = missingRows(char('Brackwyn', 'Wizard', { ethereal: [sp('No Id Yet', null, 61), sp('Zero', 0, 61)] }));
    expect(rows.map(r => r.id)).toEqual([null, null]);
  });
  it('every row links to PQDI on www. (the bare host resets the connection)', () => {
    expect(pqdiSpellUrl(1546)).toBe('https://www.pqdi.cc/spell/1546');
  });
});

describe('the summary line', () => {
  it('counts characters and spells, then each kind of scroll that is still owed', () => {
    const t = missingTotals([ALDENMAR, char('Brackwyn', 'Wizard', { spectral: [sp('Spell F', 106, 63)] })]);
    expect(t).toEqual({ characters: 2, spells: 6, byTier: { ethereal: 2, spectral: 2, glyphed: 1, other: 1 } });
    expect(totalsText(t)).toBe('2 characters · 6 spells — Ethereal 2 · Spectral 2 · Rune Word 1 · Other 1');
  });
  it('is singular for one, and leaves out a kind with none', () => {
    expect(totalsText(missingTotals([char('Corvale', 'Cleric', { ethereal: [sp('Only', 1, 61)] })])))
      .toBe('1 character · 1 spell — Ethereal 1');
  });
});

describe('the copy text', () => {
  it('is one short line a member can paste: who, class, and each spell with its scroll', () => {
    expect(copyLines(ALDENMAR)).toEqual([
      'Aldenmar (Enchanter) needs: Spell B (Ethereal), Spell A (Ethereal), Spell C (Spectral), Spell D (Rune Word), Spell E (Other)',
    ]);
  });
  it('leaves the class out when it is not known', () => {
    expect(copyLines(char('Rethlan', null, { ethereal: [sp('Spell A', 1, 61)] }))).toEqual(['Rethlan needs: Spell A (Ethereal)']);
  });
  it('has no line at all for a character that needs nothing', () => {
    expect(copyLines(char('Nyssara', 'Druid'))).toEqual([]);
  });
  it('splits a long list into numbered lines that each fit one EQ chat line, never cutting a spell', () => {
    const many = Array.from({ length: 24 }, (_, i) => sp(`Spell of Lasting Renown ${i + 1}`, 200 + i, 61));
    const lines = copyLines(char('Zarrin', 'Necromancer', { ethereal: many }));
    expect(lines.length).toBeGreaterThan(1);
    for (const [i, l] of lines.entries()) {
      expect(l.length).toBeLessThanOrEqual(COPY_LINE_MAX);
      expect(l.startsWith(`Zarrin (Necromancer) needs (${i + 1}/${lines.length}): `)).toBe(true);
    }
    // Every spell appears exactly once across the lines, whole.
    const joined = lines.join(', ');
    for (const s of many) expect(joined.split(`${s.spell_name} (Ethereal)`).length - 1).toBe(1);
  });
  it('a list that exactly fits stays one line', () => {
    const head = 'Aldenmar (Enchanter) needs: ';
    const name = 'N'.repeat(COPY_LINE_MAX - head.length - ' (Ethereal)'.length);
    const lines = copyLines(char('Aldenmar', 'Enchanter', { ethereal: [sp(name, 1, 61)] }));
    expect(lines).toHaveLength(1);
    expect(lines[0].length).toBe(COPY_LINE_MAX);
  });
});

describe('what a spell does', () => {
  const base = { id: 1, name: 'x', mana: 0, buffduration: 0, targettype: null, good_effect: null, cast_on_you: null,
    effect_id_1: null, effect_base_value_1: null, effect_id_2: null, effect_base_value_2: null, effect_id_3: null, effect_base_value_3: null };
  it('reads beneficial or detrimental, the target, how long it lasts, the effects it can name and the mana', () => {
    expect(spellBlurb({ ...base, good_effect: 1, targettype: 3, buffduration: 90, mana: 300, effect_id_1: 0, effect_base_value_1: 45 }))
      .toBe('Beneficial · group · lasts up to ~9 min · Hitpoints +45 · 300 mana');
  });
  it('never prints a raw SPA number; with no nameable effect it quotes the message the spell shows', () => {
    const b = spellBlurb({ ...base, good_effect: 0, targettype: 5, effect_id_1: 999, effect_base_value_1: 7, cast_on_you: 'You feel dizzy.' });
    expect(b).not.toMatch(/SPA/);
    expect(b).toBe('Detrimental · single target · “You feel dizzy.”');
  });
  it('is empty when the catalog has nothing, so the page shows a dash', () => {
    expect(spellBlurb(undefined)).toBe('');
    expect(spellBlurb(null)).toBe('');
  });
  it('a short duration reads in seconds', () => {
    expect(spellBlurb({ ...base, buffduration: 5 })).toBe('lasts up to ~30 sec');
  });
});

// ── The one catalog read ─────────────────────────────────────────────────────
// A fake PostgREST: eqemu_spells rows, .in('id', ids), .order('id'), .range(from, to), the 1,000-row ceiling.
function fakeSb(rows, { fail = false } = {}) {
  const requests = [];
  const sb = {
    from(table) {
      const q = { table, ids: null, ordered: null, lo: 0, hi: 999 };
      const chain = {
        select() { return chain; },
        in(col, ids) { q.ids = ids; return chain; },
        order(col) { q.ordered = col; return chain; },
        range(lo, hi) { q.lo = lo; q.hi = hi; return chain; },
        then(ok, bad) {
          requests.push({ ...q });
          if (fail) return Promise.resolve({ data: null, error: new Error('boom') }).then(ok, bad);
          const hit = rows.filter(r => q.ids.includes(r.id)).sort((a, b) => a.id - b.id);
          return Promise.resolve({ data: hit.slice(q.lo, Math.min(q.hi, q.lo + 999) + 1), error: null }).then(ok, bad);
        },
      };
      return chain;
    },
  };
  return { sb, requests };
}

describe('loadSpellInfo', () => {
  const catalog = Array.from({ length: 700 }, (_, i) => ({ id: 1000 + i, name: `Spell ${i}`, good_effect: 1 }));
  it('is one request for a household\'s worth of ids, ordered on the primary key and paged with range()', async () => {
    const { sb, requests } = fakeSb(catalog);
    const ids = spellIdsOf([ALDENMAR]);
    const got = await loadSpellInfo(sb, [1000, 1001, 1002, ...ids]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ table: 'eqemu_spells', ordered: 'id', lo: 0, hi: 999 });
    expect([...got.keys()]).toEqual([1000, 1001, 1002]);
  });
  it('splits a long id list into chunks, one request each, and keeps every row', async () => {
    const { sb, requests } = fakeSb(catalog);
    const ids = catalog.map(r => r.id);
    const got = await loadSpellInfo(sb, ids);
    expect(requests).toHaveLength(Math.ceil(ids.length / INFO_CHUNK));
    expect(got.size).toBe(700);
  });
  it('asks nothing when there is nothing to ask', async () => {
    const { sb, requests } = fakeSb(catalog);
    expect((await loadSpellInfo(sb, [])).size).toBe(0);
    expect(requests).toHaveLength(0);
  });
  it('a failed read leaves the list without descriptions instead of taking the section down', async () => {
    const { sb } = fakeSb(catalog, { fail: true });
    expect((await loadSpellInfo(sb, [1000])).size).toBe(0);
  });
  it('spellIdsOf is the distinct ids, ascending, with no nulls', () => {
    const dup = char('Brackwyn', 'Wizard', { ethereal: [sp('Spell A', 101, 61), sp('Nope', null, 61)] });
    expect(spellIdsOf([ALDENMAR, dup])).toEqual([101, 102, 103, 104, 105]);
  });
});

describe('the section on the page', () => {
  const comp = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/MissingSpells.tsx'), 'utf8'));
  const page = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8'));
  const lib = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/popMissingSpells.ts'), 'utf8'));
  it('is a native <details>, closed (no open attribute), whose summary is the one-line totals', () => {
    expect(comp).toMatch(/<details className="[^"]*">\s*<summary[^>]*>\s*<span>\{totalsText\(totals\)\}<\/span>/);
    expect(comp).not.toMatch(/<details[^>]*\sopen[\s=>]/);
  });
  it('each spell links to PQDI by its id, and says its level, its scroll and what it does', () => {
    expect(comp).toMatch(/href=\{pqdiSpellUrl\(r\.id\)\}/);
    expect(comp).toMatch(/\{r\.level \? `L\$\{r\.level\}` : '—'\}/);
    expect(comp).toMatch(/\{r\.tierLabel\}/);
    expect(comp).toMatch(/spellBlurb\(info\.get\(r\.id\)\)/);
  });
  it('every character has a copy button per chat line, from the shared CopyChip', () => {
    expect(comp).toMatch(/import CopyChip from '@\/components\/CopyChip'/);
    expect(comp).toMatch(/lines\.map\(\(line, i\) => \(\s*<CopyChip key=\{i\} text=\{line\}/);
    expect(comp).toMatch(/const lines = copyLines\(n\)/);
  });
  it('replaces the old counts table in the My Characters view and is fed by the page\'s own rows', () => {
    expect(page).toMatch(/<MissingSpells chars=\{myNeeds\} info=\{missingInfo\} \/>/);
    expect(page).not.toMatch(/myNeeds\.map/);
    expect(page).toMatch(/loadSpellInfo\(sbAdmin, spellIdsOf\(myNeeds\)\)/);
  });
  it('reads no new table and asks nothing outside My Characters: one catalog lookup, paged, ordered on the key', () => {
    expect(page).toMatch(/scope === 'mine' && myNeeds\.length > 0\s*\? await loadSpellInfo/);
    expect((page.match(/\.from\('eqemu_spells'\)/g) || []).length).toBe(0);
    expect((lib.match(/\.from\('eqemu_spells'\)/g) || []).length).toBe(1);
    expect(lib).toMatch(/selectAll<SpellInfo>/);
    expect(lib).toMatch(/\.order\('id', \{ ascending: true \}\)\.range\(from, to\)/);
    // pop_spell_needs is still the one paged RPC read of the needs; the section adds none.
    expect((page.match(/rpc\('pop_spell_needs'/g) || []).length).toBe(1);
  });
});
