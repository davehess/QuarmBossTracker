// test/pop-guide.test.js — the PoP checklist (the guild lead, 2026-09-28: "where to start, what quests
// are must haves, what can be done with a group or a raid or solo. Make this a checkbox type of thing").
// web/lib/popGuide.ts is pure; the tick action must refuse unknown items and other people's characters
// before it writes anything; the table is service-role only.
//
// Run: npx vitest run test/pop-guide.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  GUIDE_ITEMS, GUIDE_SECTIONS, GUIDE_KEYS, ZONE_NAMES, tickedKeys, recordedKeys, unknownFlags,
  mapCommand, sayCommand, splitItems, guideItemIds,
} from '../web/lib/popGuide.ts';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('the checklist catalog', () => {
  it('has unique storage keys, and every item sits in a real section', () => {
    expect(GUIDE_KEYS.size).toBe(GUIDE_ITEMS.length);
    const sections = new Set(GUIDE_SECTIONS.map(s => s.key));
    for (const i of GUIDE_ITEMS) expect(sections.has(i.section), i.key).toBe(true);
    for (const s of GUIDE_SECTIONS) expect(GUIDE_ITEMS.some(i => i.section === s.key), s.key).toBe(true);
  });

  it('names only flags the PoP catalog knows, so a recorded flag can always tick its box', () => {
    expect(unknownFlags()).toEqual([]);
  });

  it('answers the ask: a start, must-haves, and solo, group and raid work', () => {
    expect(GUIDE_SECTIONS[0].key).toBe('start');
    expect(GUIDE_ITEMS.filter(i => i.must).length).toBeGreaterThan(10);
    for (const who of ['solo', 'group', 'raid']) expect(GUIDE_ITEMS.some(i => i.who === who), who).toBe(true);
  });

  it('links PQDI on www only (the bare domain resets the connection)', () => {
    for (const i of GUIDE_ITEMS) if (i.link?.href.includes('pqdi.cc')) expect(i.link.href).toMatch(/^https:\/\/www\.pqdi\.cc\//);
  });
});

describe('copy lines and item cards', () => {
  it('writes /map as Y then X, the order /loc prints (PQDI shows the Seer at Y -42, X -224)', () => {
    const seer = GUIDE_ITEMS.find(i => i.key === 'start_flag_fixers').where.find(l => l.npc === 'Seer Mal Nae`Shi');
    expect(mapCommand(seer)).toBe('/map -42 -224');
    expect(sayCommand({ text: 'guided meditation' })).toBe('/say guided meditation');
  });

  it('gives every location a known zone and whole-number coordinates', () => {
    for (const i of GUIDE_ITEMS) for (const l of i.where ?? []) {
      expect(ZONE_NAMES[l.zone], `${i.key} ${l.npc}`).toBeTruthy();
      expect(Number.isInteger(l.y) && Number.isInteger(l.x), `${i.key} ${l.npc}`).toBe(true);
    }
  });

  // The Seer's script answers "guided meditation" and "unlock … memories" only when
  // e.other:IsSitting() (the guild lead, 2026-09-28: "i had to sit down first").
  it('every Seer line that needs you seated carries sit', () => {
    const seer = GUIDE_ITEMS.flatMap(i => (i.says ?? []).filter(s => s.to.startsWith('Seer Mal')));
    expect(seer.length).toBeGreaterThan(0);
    for (const s of seer) if (/meditation|unlock/.test(s.text)) expect(s.sit, s.text).toBe(true);
    // The script needs both words: "unlock" alone does nothing.
    for (const s of seer) if (/unlock/.test(s.text)) expect(s.text).toMatch(/memories/);
  });

  it('never offers a phrase that edits flags or starts with a slash', () => {
    for (const i of GUIDE_ITEMS) for (const s of i.says ?? []) {
      expect(s.text.trim(), i.key).not.toBe('');
      expect(s.text.startsWith('/'), i.key).toBe(false);
      // The Seer also answers "delete", which clears flags. It must never be one click away.
      expect(/\bdelete\b/i.test(s.text), i.key).toBe(false);
    }
  });

  it('parses [[Item#id]] tokens, and leaves no half-written token behind', () => {
    expect(splitItems('Loot the [[Globe of Dancing Flame#29147]].')).toEqual([
      { text: 'Loot the ' }, { item: { name: 'Globe of Dancing Flame', id: 29147 } }, { text: '.' },
    ]);
    for (const i of GUIDE_ITEMS) for (const t of [i.title, i.detail ?? '']) {
      const plain = splitItems(t).filter(p => 'text' in p).map(p => p.text).join('');
      expect(plain, i.key).not.toMatch(/\[\[|\]\]/);
    }
    const ids = guideItemIds();
    for (const id of [28745, 29165, 17186, 31842, 25596]) expect(ids).toContain(id);
  });
});

// Willamina's Needles as a full chain (the guild lead, 2026-09-28: "Willamina's quest needs
// Bolcen Tendag's section in it", then "Follow the chain and show the first item that seems to
// be required … and show the full quest chain"). Traced through the ten PoK scripts.
describe('quest chains', () => {
  const tokenIds = (t) => splitItems(t ?? '').filter(p => 'item' in p).map(p => p.item.id);
  const chained = GUIDE_ITEMS.filter(i => i.chain);

  it('each hand-in gives what the one before it got, from the first item to the reward', () => {
    expect(chained.length).toBeGreaterThan(0);
    for (const i of chained) {
      const h = i.chain.handins;
      expect(tokenIds(h[0].give), i.key).toEqual(tokenIds(i.chain.first.text).slice(0, 1));
      for (let n = 1; n < h.length; n++) expect(tokenIds(h[n].give), `${i.key} #${n + 1}`).toEqual(tokenIds(h[n - 1].get));
      expect(tokenIds(i.title), i.key).toContain(tokenIds(h[h.length - 1].get)[0]);
    }
  });

  // "That quest chain really looks like it should start from … Agrakath Theric" (the guild lead,
  // 2026-09-28): the first hand-in is his, so the step opens there, with the book to fetch.
  it('Willamina\'s starts at Agrakath Theric with the book from Myrist, runs through Bolcen, and ends with the manual', () => {
    const w = GUIDE_ITEMS.find(i => i.key === 'start_traveler_manual');
    expect(w.chain.first.at.npc).toBe('Agrakath Theric');
    expect(w.chain.first.at.npc).toBe(w.chain.handins[0].at.npc);
    expect(w.chain.first.say).toEqual(['erase the debt']);
    expect(w.link.href).toMatch(/\/npc\/202058$/);
    expect(w.where).toBeUndefined();   // the Start here box is the one place to look
    expect(tokenIds(w.chain.first.text)).toEqual([28188]);
    expect(mapCommand(w.chain.first.fetch)).toBe('/map -94 973');
    expect(w.chain.handins.some(s => s.at.npc === 'Bolcen Tendag')).toBe(true);
    expect(w.chain.handins).toHaveLength(10);
    expect(w.chain.talk.map(s => s.at.npc)).toEqual(['Willamina', 'Bolcen Tendag', 'Mirao Frostpouch', 'Oracle Cador',
      'Onirelin Gali', 'Arch Mage Narik', 'Elisha Dirtyshoes', 'Boiron Ston', 'Caden Zharik', 'Agrakath Theric']);
  });

  it('every chain place and phrase follows the same rules as the rest of the guide', () => {
    for (const i of chained) {
      const places = [i.chain.first.at, i.chain.first.fetch, ...i.chain.talk.map(s => s.at), ...i.chain.handins.map(s => s.at)].filter(Boolean);
      for (const at of places) {
        expect(ZONE_NAMES[at.zone], i.key).toBeTruthy();
        expect(Number.isInteger(at.y) && Number.isInteger(at.x), `${i.key} ${at.npc}`).toBe(true);
      }
      for (const s of [i.chain.first, ...i.chain.talk]) for (const t of s.say ?? []) {
        expect(t.startsWith('/') || /\bdelete\b/i.test(t), `${i.key} ${t}`).toBe(false);
      }
    }
    const ids = guideItemIds();
    for (const id of [28188, 28084, 28091, 28092]) expect(ids).toContain(id);
  });
});

describe('ticks', () => {
  it('merges hand ticks with recorded flags, and drops keys the guide does not define', () => {
    const t = tickedKeys(['start_level46', 'not_a_key'], ['grummus_dead']);
    expect(t.has('start_level46')).toBe(true);
    expect(t.has('flag_grummus')).toBe(true);
    expect(t.has('not_a_key')).toBe(false);
    expect([...recordedKeys(['grummus_dead'])]).toEqual(['flag_grummus']);
    expect(recordedKeys([]).size).toBe(0);
  });
});

describe('the tick action', () => {
  const src = stripJs(read('web/app/pop/guide/actions.ts'));
  it('checks the item, the sign-in and the ownership before any write', () => {
    const write = src.indexOf("from('pop_guide_ticks')");
    expect(write).toBeGreaterThan(0);
    for (const gate of ['GUIDE_KEYS.has(itemKey)', 'auth.getUser()', 'ownedCharacters(user.id)']) {
      const at = src.indexOf(gate);
      expect(at, gate).toBeGreaterThan(0);
      expect(at, gate).toBeLessThan(write);
    }
  });
  it('writes under the owned character’s real name, never the name it was handed', () => {
    expect(src).toMatch(/character_name: owned\.name/);
    expect(src).toMatch(/\.eq\('character_name', owned\.name\)/);
    expect(src).not.toMatch(/character_name: character\b/);
  });
});

// Officers were working Justice and Storms off this page on 2026-09-29 and it confused them ("is this
// all we have to do for justice?" · "who to turn the mark into?"). Checked against the server's quest
// scripts (#Mavuin, The_Tribunal, Askr_the_Lost, postorms/player.lua, bothunder/player.lua, Karana)
// and EQProgression's Talisman page. These pin what was wrong so it cannot drift back.
describe('Justice and the Bastion of Thunder read the way the server works', () => {
  const step = (k) => GUIDE_ITEMS.find(i => i.key === k);
  it('the Tribunal checks your Mark and does not take it; its only circle is by the trial room', () => {
    const t = step('justice_tribunal');
    expect(t.detail).toMatch(/does not take it/);
    expect(t.where.map(l => [l.y, l.x])).toEqual([[765, 469]]);   // the Y 1225 circle is inside the Hammer's room
    expect(step('flag_trial_justice').detail).toMatch(/SIX of its Mark/);
    expect(step('justice_seventh_hammer').says.map(s => s.text)).toEqual(['knowledge']);
  });
  it('Askr takes one head, then a sealed bag, then a meld, and the Talisman is a flag, not a keyring item', () => {
    const a = step('flag_askr');
    expect(a.says.map(s => s.text)).toEqual(['it was me', 'paying attention', 'continue', 'bastion of thunder']);
    expect(a.detail).not.toMatch(/keyring/);
    const shrine = step('storms_zone_bot');
    expect(shrine.detail).toMatch(/Justice flag/);
    expect(shrine.detail).toMatch(/not a keyring item/);
    expect(shrine.where.map(l => [l.zone, l.y, l.x])).toEqual([['postorms', -163, -362]]);
  });
  it('the Symbol of Torden is required, not optional, and the tower walk is its own step', () => {
    expect(step('bot_symbol').title).not.toMatch(/Optional/);
    expect(step('bot_tower').says.map(s => s.text)).toEqual(['transport', 'what storm']);
    expect(step('flag_agnarr').detail).toMatch(/casts Gate/);
  });
});

describe('the page and the table', () => {
  it('is members-only and reads only the viewer’s own characters', () => {
    const page = stripJs(read('web/app/pop/guide/page.tsx'));
    expect(page).toMatch(/if \(!user\) redirect\('\/auth\/signin\?next=\/pop\/guide'\)/);
    expect(page).toMatch(/ownedCharacters\(user\.id\)/);
    expect(page).toMatch(/\.in\('character_name', names\)/);
  });
  it('keeps the table service-role only', () => {
    const sql = stripSql(read('supabase/migrations/20260928192730_pop_guide_ticks.sql'));
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on pop_guide_ticks from anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
  });
});
