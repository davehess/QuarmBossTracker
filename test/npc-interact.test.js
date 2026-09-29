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
		e.self:Say("If you want to know about the pools then I need something [from you] first. Some are not even aware of what it is they are looking for.");
	end
end
function event_trade(e)
	if(item_lib.check_turn_in(e.self, e.trade, {item1 = 22519})) then
		e.self:Say("Thiran will give you the book I used as a reference. Give him this note so he knows I sent you.");
	end
end
`;

// A shaped example (invented NPCs, real call forms): a keyword that spawns a guard and leaves, and
// two hand-ins, one of which costs faction and removes another NPC.
const WARDEN = `function event_say(e)
	if(e.message:findi("hail")) then
		e.self:Say("Speak, or [fight].");
	elseif(e.message:findi("fight")) then
		e.self:Say("Guards!");
		eq.spawn2(202401,0,0,e.self:GetX(),e.self:GetY(),e.self:GetZ(),0);
		eq.depop_with_timer();
	end
end
function event_trade(e)
	local item_lib = require("items");
	if(item_lib.check_turn_in(e.self, e.trade, {item1 = 22519, item2 = 22519})) then
		e.self:Say("Two of them. Good.");
		e.other:Faction(e.self, 1504, 10);
		e.other:Faction(e.self, 1505, -25);
		e.other:QuestReward(e.self,0,0,0,0,eq.ChooseRandom(15958, 15392),1000);
		eq.depop(202223);
	elseif(item_lib.check_turn_in(e.self, e.trade, {item1 = 15013})) then
		e.other:QuestReward(e.self,{itemid = 15392});
	end
	item_lib.return_items(e.self, e.other, e.trade)
end
`;

const CATALOG = [
  { id: 202299, name: 'Tarerd_Gahar', merchant_id: null },
  { id: 202300, name: 'Warden_Aldric', merchant_id: null },
  { id: 202401, name: 'a_warden_guard', merchant_id: null },
  { id: 202223, name: 'Vicar_Thiran', merchant_id: null },
  { id: 202194, name: 'Cavalier_Waut', merchant_id: 202194 },
  { id: 202400, name: 'a_sarnak_thiran', merchant_id: null },     // unnamed mob: never "next"
  { id: 163082, name: 'Some', merchant_id: null },                 // a real NPC in Grieg's End
];

function fakeSupabase(calls) {
  const dec = (s) => decodeURIComponent(s);
  return {
    select: async (table, q) => {
      calls.push([table, q]);
      const p = new URLSearchParams(q);
      if (table === 'eqemu_npc_types') {
        if (p.get('id')?.startsWith('eq.')) return CATALOG.filter((r) => r.id === Number(p.get('id').slice(3)));
        if (p.get('id')?.startsWith('in.')) {
          const ids = p.get('id').replace(/^in\.\(|\)$/g, '').split(',').map(Number);
          return CATALOG.filter((r) => ids.includes(r.id));
        }
        if (p.get('name')) {
          const names = dec(p.get('name')).replace(/^in\.\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, ''));
          return CATALOG.filter((r) => names.includes(r.name));
        }
        const lo = Number(p.getAll('id').find((v) => v.startsWith('gte.')).slice(4));
        return CATALOG.filter((r) => r.id >= lo && r.id <= lo + 999);
      }
      if (table === 'eqemu_zone') return [{ short_name: 'poknowledge', long_name: 'The Plane of Knowledge' }];
      if (table === 'eqemu_quest_scripts') {
        const path = dec(p.get('path') || '');
        if (path === 'eq.poknowledge/Tarerd_Gahar.lua') return [{ path: 'poknowledge/Tarerd_Gahar.lua', body: TARERD }];
        if (path === 'eq.poknowledge/Warden_Aldric.lua') return [{ path: 'poknowledge/Warden_Aldric.lua', body: WARDEN }];
        return [];
      }
      if (table === 'eqemu_faction_list_full') return [{ id: 1504, name: 'Knowledge Seekers' }, { id: 1505, name: 'Dark Reflection' }];
      if (table === 'scripted_npc_turnins') {
        if (p.get('npc_id') === 'eq.202299') return [{ inputs: [{ qty: 1, item_id: 22519 }], outputs: [{ kind: 'fixed', item_id: 15958 }], exp_award: null }];
        if (p.get('npc_id') === 'eq.202300') return [
          { inputs: [{ qty: 2, item_id: 22519 }], outputs: [{ kind: 'random', item_id: 15958 }, { kind: 'random', item_id: 15392 }], exp_award: 1000, random_outputs: true },
          // The importer's snippet stands in when the script has no matching branch.
          { inputs: [{ qty: 1, item_id: 15392 }], outputs: [], exp_award: null, faction_changes: [{ faction_id: 1505, delta: -5 }],
            raw_snippet: 'quest::say("Leave, $name.");\n quest::depop_withtimer();' },
        ];
        return [];
      }
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
    expect(n.turnins).toEqual([{ inputs: [{ id: 22519, name: 'Sarnak Blood', qty: 1 }], outputs: [{ id: 15958, name: 'Note From Tarerd' }], exp: null,
      says: [{ kind: 'say', text: 'Thiran will give you the book I used as a reference. Give him this note so he knows I sent you.' }] }]);
    expect(n.turnins[0].warn).toBeUndefined();      // Nothing to warn about: no despawn, spawn or faction.
    expect(n.say[0].warn).toBeUndefined();
    // "Some are not even aware…" is a sentence, not the NPC called Some in Grieg's End (the guild
    // lead, 2026-09-28: "Why does this mention Grief's end?"); "Thiran will give you…" still
    // finds Vicar Thiran, by surname, in this zone.
    expect(n.next).toEqual([{ id: 202223, name: 'Vicar Thiran', zone_short: 'poknowledge', zone_long: 'The Plane of Knowledge', y: 121, x: -300 }]);
    expect(n.vendor).toEqual([]);   // not a merchant: the overlay hides Vendor
  });

  it('a merchant lists what it sells, in slot order', async () => {
    const { fn } = load();
    const n = await fn(202194);
    expect(n.vendor.map((v) => v.name)).toEqual(['Spell: Resurrection', 'Spell: Complete Healing']);
    expect(n.say).toEqual([]);
  });

  it('warns on what a keyword does: spawns a named mob, and the NPC leaves', async () => {
    const { fn } = load();
    const n = await fn(202300);
    const fight = n.say.find((b) => b.say === 'fight');
    expect(fight.warn).toEqual({ despawn: true, spawns: [{ id: 202401, name: 'a warden guard' }] });
    expect(n.say.find((b) => b.say === 'hail').warn).toBeUndefined();
  });

  it('each hand-in carries its own faction, warnings and words, matched on the items it takes', async () => {
    const { fn } = load();
    const n = await fn(202300);
    const two = n.turnins.find((t) => t.inputs[0].qty === 2);
    expect(two.faction).toEqual([{ id: 1504, name: 'Knowledge Seekers', delta: 10 }, { id: 1505, name: 'Dark Reflection', delta: -25 }]);
    expect(two.warn).toEqual({ despawns: [{ id: 202223, name: 'Vicar Thiran' }] });
    expect(two.random).toBe(true);
    expect(two.says).toEqual([{ kind: 'say', text: 'Two of them. Good.' }]);
    // No branch for this one in the script: the snippet and the importer's faction list answer.
    const other = n.turnins.find((t) => t.inputs[0].id === 15392);
    expect(other.warn).toEqual({ despawn: true });
    expect(other.faction).toEqual([{ id: 1505, name: 'Dark Reflection', delta: -5 }]);
    expect(other.says).toEqual([{ kind: 'say', text: 'Leave, <you>.' }]);
  });

  it('an unknown id is null', async () => {
    const { fn } = load();
    expect(await fn(999999)).toBe(null);
  });
});
