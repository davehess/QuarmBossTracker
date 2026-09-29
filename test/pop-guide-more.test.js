// test/pop-guide-more.test.js — the PoP checklist's beta layouts (the guild lead, 2026-09-29: "more
// detail, maps, who to turn things into, expectations and who you will go back to. a sidebar nav with
// sections. automatic fill in when someone is running mimic … and note when it's been filled in by
// database or mimic in a line item").
//
// The detail (web/lib/popGuideMore.ts) and the auto-fill rules (web/lib/popGuideAuto.ts) run for real;
// the page wiring is read as stripped source.
//
// Run: npx vitest run test/pop-guide-more.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { GUIDE_KEYS, GUIDE_ITEMS, ZONE_NAMES } from '../web/lib/popGuide.ts';
import { STEP_MORE, stepPlaces } from '../web/lib/popGuideMore.ts';
import { guideEvidence, HELD_ITEM_STEPS, AUTO_ITEM_IDS } from '../web/lib/popGuideAuto.ts';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('the extra detail', () => {
  it('only adds to steps that exist, and every place it names is a real placed NPC', () => {
    for (const [key, more] of Object.entries(STEP_MORE)) {
      expect(GUIDE_KEYS.has(key), key).toBe(true);
      for (const l of [...(more.back ?? []), ...(more.turnIn ?? []).map(t => t.to)]) {
        expect(l, `${key}: a place that does not resolve`).toBeTruthy();
        expect(ZONE_NAMES[l.zone], `${key} ${l.npc}`).toBeTruthy();
      }
    }
  });
  it('answers the officers’ questions: who takes the Justice Mark (nobody), and Askr’s three hand-ins', () => {
    expect(STEP_MORE.justice_tribunal.expect).toMatch(/You keep it/);
    expect(STEP_MORE.flag_askr.turnIn.map(t => t.to.npc)).toEqual(['Askr the Lost', 'Askr the Lost', 'Askr the Lost']);
    expect(STEP_MORE.flag_askr.back[0].npc).toBe('The shrine in Mount Grenidor');
  });
  it('gathers a step’s places for its map, without repeats', () => {
    const askr = GUIDE_ITEMS.find(i => i.key === 'flag_askr');
    const places = stepPlaces(askr, STEP_MORE.flag_askr);
    expect(places.map(p => p.npc)).toEqual(['Askr the Lost', 'The shrine in Mount Grenidor']);
  });
});

describe('what fills itself in, and says so', () => {
  const base = { flags: [], loots: [], inventory: [], level: null, levelAt: null, spellbook: false, liveAt: null };
  it('a recorded flag is Mimic’s; level, inventory and spellbook are our records', () => {
    const ev = guideEvidence({ ...base,
      flags: [{ flag_key: 'grummus_dead', earned_at: '2026-09-20T01:00:00Z' }],
      inventory: [{ item_id: 28745, observed_at: '2026-09-22T00:00:00Z' }],
      level: 50, spellbook: true, liveAt: '2026-09-29T00:00:00Z' });
    expect(ev.flag_grummus.source).toBe('mimic');
    expect(ev.flag_grummus.at).toBe('2026-09-20T01:00:00Z');
    expect(ev.start_mimic.source).toBe('mimic');
    expect(ev.start_level46).toEqual({ source: 'database', what: 'Level 50 on /who.', at: null });
    expect(ev.start_traveler_manual.source).toBe('database');
    expect(ev.spells_submit_book.source).toBe('database');
  });
  it('a looted Mark is the Justice trial won', () => {
    const ev = guideEvidence({ ...base, loots: [{ item_name: 'Mark of Lashing', looted_at: '2026-09-21T01:00:00Z' }] });
    expect(ev.flag_trial_justice).toEqual({ source: 'mimic', what: 'Mimic saw you loot the Mark of Lashing.', at: '2026-09-21T01:00:00Z' });
    expect(guideEvidence({ ...base, loots: [{ item_name: 'Mark of the Ancients', looted_at: null }] }).flag_trial_justice).toBeUndefined();
  });
  it('never under a level of 46, never with only some of the parchments, never from a hidden inventory', () => {
    expect(guideEvidence({ ...base, level: 45 }).start_level46).toBeUndefined();
    expect(guideEvidence({ ...base, inventory: [{ item_id: 29112, observed_at: null }, { item_id: 29131, observed_at: null }] }).spells_parchments).toBeUndefined();
    expect(guideEvidence({ ...base, inventory: [29112, 29131, 29132].map(item_id => ({ item_id, observed_at: null })) }).spells_parchments.source).toBe('database');
    expect(guideEvidence({ ...base, inventory: null }).start_traveler_manual).toBeUndefined();
  });
  // Essences of Power (§95): the Fist proves part one; any of Kerasha's five rewards proves part two,
  // since she swaps one for the next.
  it('the Fist ticks the escort; any one of the five rewards ticks the essences, the Fist alone does not', () => {
    const inv = (...ids) => ({ ...base, inventory: ids.map(item_id => ({ item_id, observed_at: '2026-09-29T00:00:00Z' })) });
    expect(guideEvidence(inv(16260)).essences_escort.source).toBe('database');
    expect(guideEvidence(inv(16260)).essences_power).toBeUndefined();
    for (const id of [32106, 17209, 32107, 32108, 32109]) {
      expect(guideEvidence(inv(id)).essences_power, String(id)).toEqual({ source: 'database', what: 'You hold one of its five rewards.', at: '2026-09-29T00:00:00Z' });
    }
    expect(STEP_MORE.essences_escort.back[0].npc).toBe('Councilwoman Kerasha');
    expect(STEP_MORE.essences_power.turnIn[0].to.npc).toBe('Councilwoman Kerasha');
  });
  it('every held-item rule names a real step, and the page asks for exactly those items', () => {
    for (const key of Object.keys(HELD_ITEM_STEPS)) expect(GUIDE_KEYS.has(key), key).toBe(true);
    expect(AUTO_ITEM_IDS).toContain(9433);
  });
});

describe('the page', () => {
  const page = stripJs(read('web/app/pop/guide/page.tsx'));
  const data = stripJs(read('web/app/pop/guide/routeData.ts'));
  it('no ?v= is production as it was; b and c are the two new layouts', () => {
    expect(page).toMatch(/if \(v === 'b' \|\| v === 'c'\) \{/);
    expect(page).toMatch(/<GuideRoute chars=\{routeChars\} initial=\{first\} cards=\{rc\} outlines=\{outlines\} layout=\{v\} \/>/);
    expect(page).toMatch(/<GuideChecklist chars=\{chars\} initial=\{initial\} cards=\{cards\} \/>/);
  });
  it('reads only the viewer’s characters, skips a hidden inventory, and caches zone outlines for a day', () => {
    expect(data).toMatch(/\.in\('character_name', names\)/);
    expect(data).toMatch(/inventory: meta\?\.exclude_inventory \? null/);
    expect(data).toMatch(/\.neq\('flag_key', 'unmapped'\)/);
    expect(data).toMatch(/\{ revalidate: 86400 \}/);
  });
  it('the map draws EQ’s axes the right way round: +X is west, +Y is north', () => {
    const map = stripJs(read('web/app/pop/guide/ZoneMap.tsx'));
    expect(map).toMatch(/const sx = \(x: number\) => -x;/);
    expect(map).toMatch(/const sy = \(y: number\) => -y;/);
  });
});
