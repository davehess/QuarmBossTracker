// test/npc-interact.test.js — the bot's F/Q/V data for Target Info (the guild lead, 2026-09-28:
// "Make it F/Q/V for Faction, Quests, and Vendor. Don't bother showing Vendor if its not a
// vendor mob"). Runs the real _npcInteract on a fake catalog: what to say, hand-ins, who to talk
// to next with a /map point, and what a merchant sells.
//
// Run: npx vitest run test/npc-interact.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const bot = readSource(BOT_INDEX);

const TARERD = `function event_say(e)
	if(e.message:findi("hail")) then
		e.self:Say("I'm sorry " .. e.other:GetCleanName() .. ", I have neither the time nor the patience to chat right now.");
	elseif(e.message:findi("pool")) then
		e.self:Say("If you want to know about the pools then I need something [from you] first.");
	end
end
function event_trade(e)
	if(item_lib.check_turn_in(e.self, e.trade, {item1 = 22519})) then
		e.self:Say("Thiran will give you the book I used as a reference. Give him this note so he knows I sent you.");
	end
end
`;

const CATALOG = [
  { id: 202299, name: 'Tarerd_Gahar', merchant_id: null },
  { id: 202223, name: 'Vicar_Thiran', merchant_id: null },
  { id: 202194, name: 'Cavalier_Waut', merchant_id: 202194 },
  { id: 202400, name: 'a_sarnak_thiran', merchant_id: null },     // unnamed mob: never "next"
];

function fakeSupabase(calls) {
  const dec = (s) => decodeURIComponent(s);
  return {
    select: async (table, q) => {
      calls.push([table, q]);
      const p = new URLSearchParams(q);
      if (table === 'eqemu_npc_types') {
        if (p.get('id')?.startsWith('eq.')) return CATALOG.filter((r) => r.id === Number(p.get('id').slice(3)));
        if (p.get('name')) {
          const names = dec(p.get('name')).replace(/^in\.\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, ''));
          return CATALOG.filter((r) => names.includes(r.name));
        }
        const lo = Number(p.getAll('id').find((v) => v.startsWith('gte.')).slice(4));
        return CATALOG.filter((r) => r.id >= lo && r.id <= lo + 999);
      }
      if (table === 'eqemu_zone') return [{ short_name: 'poknowledge', long_name: 'The Plane of Knowledge' }];
      if (table === 'eqemu_quest_scripts') return dec(p.get('path') || '') === 'eq.poknowledge/Tarerd_Gahar.lua' ? [{ path: 'poknowledge/Tarerd_Gahar.lua', body: TARERD }] : [];
      if (table === 'scripted_npc_turnins') return p.get('npc_id') === 'eq.202299' ? [{ inputs: [{ qty: 1, item_id: 22519 }], outputs: [{ kind: 'fixed', item_id: 15958 }], exp_award: null }] : [];
      if (table === 'eqemu_merchantlist') return [{ item: 15392, slot: 1 }, { item: 15013, slot: 2 }];
      if (table === 'eqemu_items') {
        const all = { 22519: 'Sarnak Blood', 15958: 'Note From Tarerd', 15392: 'Spell: Resurrection', 15013: 'Spell: Complete Healing' };
        return dec(p.get('id')).replace(/^in\.\(|\)$/g, '').split(',').map(Number).map((id) => ({ id, name: all[id], price: 1000 }));
      }
      if (table === 'eqemu_spawnentry') return [{ npc_id: 202223, spawngroup_id: 7 }];
      if (table === 'eqemu_spawn2') return [{ id: 3, spawngroup_id: 7, zone_short: 'poknowledge', x: -300.4, y: 120.6 }];
      return [];
    },
  };
}

function load() {
  const calls = [];
  const sb = fakeSupabase(calls);
  const block = sliceBlock(bot, 'const _npcInteractCache = new Map();', '\n}\n\nasync function _handleAgentNpcInteract')
    .replace(/async function _handleAgentNpcInteract$/, '');
  const req = (m) => (m === './utils/supabase' ? sb : nodeRequire('../' + m.replace(/^\.\//, '') + '.js'));
  // eslint-disable-next-line no-new-func
  const fn = new Function('require', block + '\nreturn _npcInteract;')(req);
  return { fn, calls };
}

describe('F/Q/V data for one NPC', () => {
  it('what to say, the hand-in, and who is next with a /map point', async () => {
    const { fn } = load();
    const n = await fn(202299);
    expect(n.name).toBe('Tarerd Gahar');
    expect(n.script).toBe('poknowledge/Tarerd_Gahar.lua');
    expect(n.say.map((b) => b.keywords[0])).toEqual(['hail', 'pool']);
    expect(n.turnins).toEqual([{ inputs: [{ id: 22519, name: 'Sarnak Blood', qty: 1 }], outputs: [{ id: 15958, name: 'Note From Tarerd' }], exp: null }]);
    expect(n.next).toEqual([{ id: 202223, name: 'Vicar Thiran', zone_short: 'poknowledge', zone_long: 'The Plane of Knowledge', y: 121, x: -300 }]);
    expect(n.vendor).toEqual([]);   // not a merchant: the overlay hides Vendor
  });

  it('a merchant lists what it sells, in slot order', async () => {
    const { fn } = load();
    const n = await fn(202194);
    expect(n.vendor.map((v) => v.name)).toEqual(['Spell: Resurrection', 'Spell: Complete Healing']);
    expect(n.say).toEqual([]);
  });

  it('an unknown id is null', async () => {
    const { fn } = load();
    expect(await fn(999999)).toBe(null);
  });
});
