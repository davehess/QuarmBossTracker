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
  // The guild lead, 2026-10-04: "The What to do is wordy." A brief is the short version the Mimic overlay
  // shows first; the detail it summarises is never cut (the overlay folds it under "More").
  it('every step whose detail runs past 300 characters has a brief of 120 characters or fewer, in plain words', () => {
    const long = GUIDE_ITEMS.filter(i => (i.detail ?? '').length > 300);
    expect(long.length).toBeGreaterThanOrEqual(23);
    for (const i of long) {
      const brief = STEP_MORE[i.key]?.brief;
      expect(brief, `${i.key} has a long detail and no brief`).toBeTruthy();
      expect(brief.length, `${i.key}: ${brief.length} characters`).toBeLessThanOrEqual(120);
      expect(brief.length, i.key).toBeLessThan(i.detail.length / 2);
    }
    for (const [key, more] of Object.entries(STEP_MORE)) {
      if (!more.brief) continue;
      expect(more.brief, key).not.toMatch(/\[\[|#\d|\/say|https?:|\/map/);
      expect(more.brief.trim(), key).toBe(more.brief);
    }
  });
  it('the Justice trial step’s brief is the guild lead’s sentence, and its detail and expect are untouched', () => {
    expect(STEP_MORE.flag_trial_justice.brief).toBe('Win any ONE of the six trials. Its boss drops 6 of its Mark, one each. Retry 1 min after a loss, 10 after a win.');
    expect(STEP_MORE.flag_trial_justice.expect).toMatch(/^A raid\. Six Marks drop per win/);
    expect(GUIDE_ITEMS.find(i => i.key === 'flag_trial_justice').detail).toMatch(/^Any one of the six: /);
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
  // The Binden Concerrentia (2026-10-08): each reward is the next part's ingredient, so a LATER item
  // ticks the earlier parts; the Binden alone ticks all three (the talisman is used up in the combine).
  it('the Binden chain ticks by the item you hold, and a later item proves the earlier parts', () => {
    const inv = (...ids) => ({ ...base, inventory: ids.map(item_id => ({ item_id, observed_at: '2026-10-08T00:00:00Z' })) });
    const keys = (...ids) => ['binden_small', 'binden_powered', 'binden_final'].filter(k => guideEvidence(inv(...ids))[k]);
    expect(keys(28277)).toEqual([]);                    // the bottle is only an ingredient
    expect(keys(28284)).toEqual(['binden_small']);      // Small Clockwork Talisman
    expect(keys(28289)).toEqual(['binden_small']);      // Locked Parts Box: part one done, part two not
    expect(keys(28290)).toEqual(['binden_small', 'binden_powered']);
    expect(keys(28291)).toEqual(['binden_powered']);    // the schematic arrives with the Powered talisman
    expect(keys(28297)).toEqual(['binden_small', 'binden_powered']);   // Sealed Lined Case: one hand-in from done
    expect(keys(28296)).toEqual(['binden_small', 'binden_powered', 'binden_final']);
    expect(guideEvidence(inv(28296)).binden_final).toEqual({ source: 'database', what: 'You hold The Binden Concerrentia.', at: '2026-10-08T00:00:00Z' });
    expect(STEP_MORE.binden_small.back[0].npc).toBe('Tabben Bromal');
    expect(STEP_MORE.binden_powered.back[0].npc).toBe('Elder Clinka');
    expect(STEP_MORE.binden_final.turnIn.map(t => t.to.npc)).toEqual(['Elder Clinka', 'Elder Clinka']);
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
    expect(page).toMatch(/<GuideRoute chars=\{routeChars\} initial=\{first\} cards=\{rc\} outlines=\{outlines\} layout=\{v\} noLevel=\{noLevel\} \/>/);
    expect(page).toMatch(/<GuideChecklist chars=\{chars\} initial=\{initial\} cards=\{cards\} noLevel=\{noLevel\} \/>/);
  });
  it('reads only the viewer’s characters, skips a hidden inventory, and caches zone outlines for a day', () => {
    expect(data).toMatch(/\.in\('character_name', names\)/);
    expect(data).toMatch(/inventory: meta\?\.exclude_inventory \? null/);
    // Real flags only: neither the funnel row ('unmapped') nor the witnessed hails ('hail') may spend the 1,000-row read.
    expect(data).toMatch(/\.not\('flag_key', 'in', '\(unmapped,hail\)'\)/);
    expect(data).toMatch(/\{ revalidate: 86400 \}/);
  });
  it('the map draws EQ’s axes the right way round: +X is west, +Y is north', () => {
    const map = stripJs(read('web/app/pop/guide/ZoneMap.tsx'));
    expect(map).toMatch(/const sx = \(x: number\) => -x;/);
    expect(map).toMatch(/const sy = \(y: number\) => -y;/);
  });
});
