// test/zeal-target-item.test.js — Zeal 1.5 on the pipe: the target's appearance (PR #264) and item windows (PR #261).
//
// Zeal v1.5.0-alpha0 adds target_texture / target_gender / target_size / target_equipment (9 entries) to the player
// message and a type 8 `item` message { item_id, name } each time an item display window is filled. Mimic's reader
// _zealAbsorb keeps what it recognises, so each new key has to be passed through here or it is dropped.
//
// _zealAbsorb runs as the real function, sliced out of apps/mimic/main.js with its collaborators stubbed.
// Fixture names are invented.
//
// Run: npx vitest run test/zeal-target-item.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const MIMIC_MAIN = path.join(ROOT, 'apps', 'mimic', 'main.js');

const src = readSource(MIMIC_MAIN);
const block = sliceBlock(src, 'const _zealLiveByChar = new Map();', "// Discover the player's OWN current/max HP");
// eslint-disable-next-line no-new-func
const mk = new Function('stubs', `
  const { appendAgentLog, _uiScheduleAutoBackup, _detectSelfHp, _detectSelfMana, _overlaySetCommand, overlaySets } = stubs;
  const agentPort = 0, http = null;
  ${block}
  return { _zealAbsorb, _zealLiveByChar };
`);

let env;
beforeEach(() => {
  env = mk({
    appendAgentLog() {}, _uiScheduleAutoBackup() {}, _detectSelfHp() {}, _detectSelfMana() {}, _overlaySetCommand() {},
    overlaySets: { parsePipeCommand: () => null },
  });
});
const player = (data) => ({ character: 'Aldenmar', type: 3, data: JSON.stringify({ zone: 214, autoattack: false, ...data }) });
const snap = () => env._zealLiveByChar.get('Aldenmar').snapshot;

describe('player message: target appearance', () => {
  it('passes texture, gender, size and the 9-entry equipment list through', () => {
    env._zealAbsorb(player({ target_name: 'a war boar', target_texture: 3, target_gender: 2, target_size: 6.5,
      target_equipment: [1, 2, 3, 4, 5, 6, 7, 10, 11] }), 1);
    expect(snap()).toMatchObject({ target_texture: 3, target_gender: 2, target_size: 6.5 });
    expect(snap().target_equipment).toEqual([1, 2, 3, 4, 5, 6, 7, 10, 11]);
  });
  it('an older Zeal (fields absent) leaves nulls, and they clear when the target goes', () => {
    env._zealAbsorb(player({}), 1);
    expect(snap().target_texture).toBeNull();
    expect(snap().target_gender).toBeNull();
    expect(snap().target_size).toBeNull();
    expect(snap().target_equipment).toBeNull();
    env._zealAbsorb(player({ target_texture: 3, target_size: 7, target_equipment: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), 1);
    env._zealAbsorb(player({}), 1);
    expect(snap().target_texture).toBeNull();
    expect(snap().target_size).toBeNull();
    expect(snap().target_equipment).toBeNull();
  });
  it('drops malformed values rather than storing them', () => {
    env._zealAbsorb(player({ target_texture: '3', target_gender: null, target_size: Infinity,
      target_equipment: [1, 2, 'x', 4, 5, 6, 7, 8, 9] }), 1);
    expect(snap().target_texture).toBeNull();
    expect(snap().target_gender).toBeNull();
    expect(snap().target_size).toBeNull();
    expect(snap().target_equipment).toBeNull();
  });
  it('refuses an equipment list longer than 9, a fractional entry, or a non-array', () => {
    env._zealAbsorb(player({ target_equipment: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }), 1);
    expect(snap().target_equipment).toBeNull();
    env._zealAbsorb(player({ target_equipment: [1, 2.5] }), 1);
    expect(snap().target_equipment).toBeNull();
    env._zealAbsorb(player({ target_equipment: 'nope' }), 1);
    expect(snap().target_equipment).toBeNull();
  });
  it('leaves the fields the snapshot already carried alone', () => {
    env._zealAbsorb(player({ target_level: 55, target_texture: 1 }), 1);
    expect(snap().target_level).toBe(55);
    expect(snap().zone).toBe(214);
  });
});

describe('type 8: item window', () => {
  const item = (data) => ({ character: 'Aldenmar', type: 8, data: JSON.stringify(data) });
  it('stores the last viewed item with a timestamp', () => {
    env._zealAbsorb(item({ item_id: 13073, name: 'Bone Chips' }), 1);
    const li = snap().last_item;
    expect(li).toMatchObject({ item_id: 13073, name: 'Bone Chips' });
    expect(li.at).toBeGreaterThan(0);
  });
  it('a newer item replaces the last one', () => {
    env._zealAbsorb(item({ item_id: 1, name: 'Rusty Dagger' }), 1);
    env._zealAbsorb(item({ item_id: 2, name: 'Silver Ring' }), 1);
    expect(snap().last_item.item_id).toBe(2);
  });
  it('ignores a malformed item message and keeps the previous one', () => {
    env._zealAbsorb(item({ item_id: 5, name: 'Silver Ring' }), 1);
    for (const bad of [{ item_id: 0, name: 'x' }, { item_id: '9', name: 'x' }, { item_id: 9.5, name: 'x' }, { item_id: 9, name: '' }, { name: 'x' }]) {
      env._zealAbsorb(item(bad), 1);
    }
    env._zealAbsorb({ character: 'Aldenmar', type: 8, data: 'not json' }, 1);
    expect(snap().last_item.item_id).toBe(5);
  });
  it('an older Zeal never sends one: no last_item, nothing else changes', () => {
    env._zealAbsorb(player({}), 1);
    expect(snap().last_item).toBeUndefined();
  });
});

describe('agent: the item hint makes a clicky lookup exact', () => {
  const a = stripJs(readSource(AGENT_INDEX));
  it('the cast path asks _clickyEntryFor, and the zeal client list exposes the new fields', () => {
    expect(a).toMatch(/const cat = _clickyEntryFor\(b\.character, itemName, Date\.now\(\)\);/);
    expect(a).toMatch(/last_item:\s+st\.last_item \|\| null,/);
    expect(a).toMatch(/target_look:/);
  });
  it('_clickyEntryFor prefers the viewed item\'s id when the name matches and the name map holds a different row', () => {
    const fn = sliceBlock(readSource(AGENT_INDEX), 'const ZEAL_ITEM_HINT_MS', '  return byName;\n}');
    // eslint-disable-next-line no-new-func
    const make = new Function('_itemClickyByNameLower', '_zealState', `${fn}\nreturn _clickyEntryFor;`);
    const m = new Map();
    m.set('twin blade', { id: 2, name: 'Twin Blade', casttime: 1000 });
    m.set('twin blade (old)', { id: 1, name: 'Twin Blade', casttime: 5000 });
    const now = 1_000_000;
    const st = { Aldenmar: { last_item: { item_id: 1, name: 'Twin Blade', at: now - 1000 } } };
    const f = make(m, st);
    expect(f('Aldenmar', 'Twin Blade', now).id).toBe(1);
    expect(f('Aldenmar', 'Twin Blade', now + 31 * 60 * 1000).id).toBe(2);      // stale hint
    expect(f('Brackwyn', 'Twin Blade', now).id).toBe(2);                       // another character
    st.Aldenmar.last_item.name = 'Other';
    expect(f('Aldenmar', 'Twin Blade', now).id).toBe(2);                       // name differs
  });
});
