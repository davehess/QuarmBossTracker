// test/quest-dialog.test.js — reading what to say from an NPC's quest script, for Target Info's
// F/Q/V → Quest sub-tab (the guild lead, 2026-09-28: "lets make a quest tab on target info that
// has the quest details for what to say and copyable /say and /map items for who to talk to
// next"). Fixtures are real scripts from the eqemu_quest_scripts mirror (SecretsOTheP/quests,
// GPL-3), trimmed where marked.
//
// Run: npx vitest run test/quest-dialog.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const q = require('../utils/questDialog.js');

// poknowledge/Tarerd_Gahar.lua, whole.
const TARERD = `--The Magic Pool
function event_say(e)
	if(e.message:findi("hail")) then
		e.self:Say("I'm sorry " .. e.other:GetCleanName() .. ", I have neither the time nor the patience to chat right now.");\t
	elseif(e.message:findi("pool")) then
		e.self:Say("Oh Tatlan and Wicas sent you did they? I'll tell you what I told them, nothing is free. If you want to know about the pools then I need something [from you] first.");
	elseif(e.message:findi("from me")) then
		e.self:Say("I'm sure it'll be easy for an adventurer as you. I am working on a potion, and I cannot currently travel to gather my last component. If you could bring me the blood of a Sarnak I'd be willing to share what I know.");
	end
end

function event_trade(e)
	local item_lib = require("items");
	if(item_lib.check_turn_in(e.self, e.trade, {item1 = 22519})) then --Sarnak Blood
		e.self:Say("Ahh this is exactly what I was looking for. All the information I've gathered from these pools has come from Myrist. Thiran will give you the book I used as a reference. Give him this note so he knows I sent you.");
		e.other:QuestReward(e.self,{itemid = 15958}); --Note From Tarerd
	end
	item_lib.return_items(e.self, e.other, e.trade)
end
`;

// poknowledge/Grand_Librarian_Maelin.lua, trimmed: the hail branch's flag ladder and "lore".
const MAELIN = `function event_say(e)
	local qglobals = eq.get_qglobals(e.other);

	if ( e.message:findi("hail") ) then
		if ( qglobals.time or (qglobals.zebuxoruk == "2" and e.other:HasItem(29165)) ) then
			e.other:Message(0, "Maelin tells you, 'The Quintessence! Oh my this is amazing! I have come into contact with Chronographer Muon in the realm of innovation. Go to him, show him you have the power to activate machine. I shall meet you there, this I must see!'");
		elseif ( qglobals.mmarr and qglobals.saryrn ) then
			e.other:Message(0, "Maelin tells you, 'Astounding, this truly is the Cipher of Druzzil!'");
			eq.set_global("cipher", "1", 5, "F");
			e.other:Message(15, "You have received a character flag!");
		else
			e.other:Message(0, "Maelin tells you, 'Welcome to Myrist!  This is truly something for me to be proud of.'");
		end

	elseif ( e.message:findi("lore") ) then
		if ( qglobals.zebuxoruk ) then
			e.other:Message(0, "Maelin tells you, 'The Zeks are especially gifted at things of this nature.'");
		else
			e.other:Message(0, "Maelin tells you, 'Come now, I don't see any new lore about you.  There is no reason to be dishonest with me.'");
		end
	end
end
`;

// poknowledge/Seer_Mal_Nae-Shi.lua, trimmed: a normal branch, one that needs you seated, then the
// GM-only flag wipe.
const SEER = `function event_say(e)
	if ( e.message:findi("hail") ) then
		e.self:Say("Greetings. I can [see] what you have done.");
	elseif ( e.message:findi("unlock") and e.message:findi("memories") ) then
		if ( e.other:IsSitting() ) then
			UnlockMemories(e.other);
		else
			e.other:Message(0, "Seer Mal Nae\`Shi tells you, 'You will never be able to focus unless you are relaxed.  Please, sit down for a moment and allow me to [unlock your memories].'");
		end
	elseif ( e.message:findi("delete") and e.other:GetGM() and e.other:Admin() >= 80 ) then
		eq.delete_global("mavuin");
		eq.delete_global("time");
	end
end
`;

describe('what to say', () => {
  it('reads each findi keyword in order with the NPC\'s words, the player\'s name spliced in', () => {
    const d = q.parseDialog(TARERD);
    expect(d.map((b) => b.keywords)).toEqual([['hail'], ['pool'], ['from me']]);
    expect(d[0].replies[0].text).toBe("I'm sorry <you>, I have neither the time nor the patience to chat right now.");
    expect(d[0].gated).toBe(false);
  });

  it('keywords come from findi, not the [brackets], which can differ', () => {
    const d = q.parseDialog(TARERD);
    expect(d[1].hints).toEqual(['from you']);          // shown as a hint…
    expect(d[2].keywords).toEqual(['from me']);        // …but "from me" is what the NPC listens for
  });

  it('a script that prints its own tell gives the words inside, and flags which replies depend on you', () => {
    const d = q.parseDialog(MAELIN);
    expect(d.map((b) => b.keywords[0])).toEqual(['hail', 'lore']);
    expect(d[0].replies.map((r) => r.text)).toEqual([
      "The Quintessence! Oh my this is amazing! I have come into contact with Chronographer Muon in the realm of innovation. Go to him, show him you have the power to activate machine. I shall meet you there, this I must see!",
      'Astounding, this truly is the Cipher of Druzzil!',
      'Welcome to Myrist! This is truly something for me to be proud of.',
    ]);
    expect(d[0].gated).toBe(true);
    expect(d[0].flag).toBe(true);
    expect(d[1].flag).toBe(false);
  });

  it('never offers a GM-only branch', () => {
    const d = q.parseDialog(SEER);
    expect(d.map((b) => b.keywords[0])).toEqual(['hail', 'unlock']);
  });

  it('marks a branch that only answers while you sit, and keeps both words it needs', () => {
    const d = q.parseDialog(SEER);
    const unlock = d.find((b) => b.keywords[0] === 'unlock');
    expect(unlock.keywords).toEqual(['unlock', 'memories']);
    expect(unlock.say).toBe('unlock memories');     // "and": a bare "unlock" does nothing
    expect(unlock.sit).toBe(true);
    expect(d.find((b) => b.keywords[0] === 'hail').say).toBe('hail');
    expect(d.find((b) => b.keywords[0] === 'hail').sit).toBe(false);
  });

  it('an "or" branch needs one word only', () => {
    const d = q.parseDialog('function event_say(e)\n\tif(e.message:findi("ship") or e.message:findi("boat")) then\n\t\te.self:Say("It sails at dawn.");\n\tend\nend\n');
    expect(d[0].say).toBe('ship');
  });

  it('a script with no event_say has nothing to say', () => {
    expect(q.parseDialog('function event_spawn(e)\n\teq.set_timer("depop", 900000);\nend\n')).toEqual([]);
  });
});

// What a branch does besides talking (the guild lead, 2026-09-29: "put a warning on anything that
// despawns a mob or spawns something else, or causes negative faction. If there are turn-in
// requirements or you get an item as output from a quest we should denote that"). The call forms
// are the ones the mirror actually uses, counted across all 5,719 scripts: eq.depop() (646),
// eq.depop_with_timer() (480), eq.spawn2(id, …), e.other:Faction(e.self, id, n[, 0]),
// e.other:Faction(id, n, 0), QuestReward positional / table / eq.ChooseRandom; and the Perl in
// the turn-in snippets.
describe('what a branch does', () => {
  it('Lua: the NPC leaves, another NPC is removed, a mob is spawned', () => {
    const fx = q.effects('eq.spawn2(55392,0,0,e.self:GetX(),e.self:GetY(),e.self:GetZ(),0);\n eq.depop_with_timer();\n eq.depop(202223);');
    expect(fx.depopSelf).toBe(true);
    expect(fx.depops).toEqual([202223]);
    expect(fx.spawns).toEqual([55392]);
    expect(q.effects('e.self:Depop();').depopSelf).toBe(true);
    expect(q.effects('eq.unique_spawn(npc_id, 0, 0, x, y, z);').spawnOther).toBe(true);   // Computed id: still a spawn.
    expect(q.effects('eq.spawn_condition("hole", 1, 1);').spawnOther).toBe(false);          // Not a spawn call.
  });

  it('Lua and Perl faction, gains and losses, in order', () => {
    expect(q.effects('e.other:Faction(e.self,262,-1,0);\n e.other:Faction(265,50,0);').faction)
      .toEqual([{ id: 262, delta: -1 }, { id: 265, delta: 50 }]);
    expect(q.effects('quest::faction(291,-20); # Merchants of Qeynos').faction).toEqual([{ id: 291, delta: -20 }]);
  });

  it('items you get: SummonItem, QuestReward by position or table, and random picks', () => {
    expect(q.effects('e.other:SummonItem(14107);').gives).toEqual([14107]);
    expect(q.effects('e.other:QuestReward(e.self,{itemid = 15958, exp = 100});').gives).toEqual([15958]);
    expect(q.effects('e.other:QuestReward(e.self,0,0,0,0,0,1000);').gives).toEqual([]);      // Exp only.
    const rnd = q.effects('e.other:QuestReward(e.self,0,0,0,0,eq.ChooseRandom(10028, 10037),300000);');
    expect(rnd.gives).toEqual([10028, 10037]);
    expect(rnd.givesRandom).toBe(true);
    expect(q.effects('quest::summonitem(24073); quest::depop_withtimer();')).toMatchObject({ gives: [24073], depopSelf: true });
  });

  it('an item the NPC checks you carry, unless the check is "not"', () => {
    expect(q.needsItems(' e.message:findi("sword") and e.other:HasItem(1234) ')).toEqual([1234]);
    expect(q.needsItems(' e.message:findi("sword") and not e.other:HasItem(1234) ')).toEqual([]);
  });

  it('each say branch carries what it does', () => {
    const d = q.parseDialog('function event_say(e)\n\tif(e.message:findi("fight") and e.other:HasItem(1234)) then\n\t\te.self:Say("Guards!");\n\t\teq.spawn2(202401,0,0,1,2,3,0);\n\tend\nend\n');
    expect(d[0].fx.spawns).toEqual([202401]);
    expect(d[0].needs).toEqual([1234]);
  });

  it('a hand-in per check_turn_in: its items (a repeat means two), words and effects', () => {
    const t = q.tradeBranches(`function event_trade(e)
	if(item_lib.check_turn_in(e.self, e.trade, {item1 = 22519, item2 = 22519})) then
		e.self:Say("Two of them.");
		e.other:Faction(e.self,1505,-25);
	elseif(item_lib.check_turn_in(e.self, e.trade, {item1 = 15958})) then
		e.other:QuestReward(e.self,{itemid = 15959});
		eq.depop();
	end
	item_lib.return_items(e.self, e.other, e.trade)
end
`);
    expect(t.map((b) => b.items)).toEqual([[22519, 22519], [15958]]);
    expect(t[0].replies).toEqual([{ kind: 'say', text: 'Two of them.' }]);
    expect(t[0].fx.faction).toEqual([{ id: 1505, delta: -25 }]);
    expect(t[0].fx.depopSelf).toBe(false);          // The second branch's depop stays with it.
    expect(t[1].fx).toMatchObject({ gives: [15959], depopSelf: true });
  });

  it('Perl lines in a turn-in snippet read the same way, $name as you', () => {
    expect(q._replies('quest::say("Great work, $name!");\n quest::emote("bows.");')).toEqual([
      { kind: 'say', text: 'Great work, <you>!' }, { kind: 'emote', text: 'bows.' },
    ]);
  });
});

describe('who to talk to next', () => {
  it('the hand-in reply names the next NPC', () => {
    const t = q.tradeReplies(TARERD);
    expect(t).toHaveLength(1);
    expect(q.nameCandidates(t.map((r) => r.text))).toContain('Thiran');
  });

  it('multi-word names survive, and sentence words are not candidates', () => {
    const c = q.nameCandidates([q.parseDialog(MAELIN)[0].replies[0].text]);
    expect(c).toContain('Chronographer Muon');
    expect(c).not.toContain('Go');
    expect(c).not.toContain('I');
  });

  it('a word only capitalised because it starts a sentence is flagged; a mid-sentence name is not', () => {
    const s = q.sentenceStartOnly([
      'Some are not even aware of it. Thiran will give you the book.',
      'Ask Thiran about "Perhaps" later.',
    ]);
    expect(s.has('some')).toBe(true);
    expect(s.has('thiran')).toBe(false);   // also appears mid-sentence
    expect(s.has('ask')).toBe(true);
  });

  it('catalog names read the way players see them, and map to the script file', () => {
    expect(q.displayName('#Chronographer_Muon')).toBe('Chronographer Muon');
    expect(q.scriptPath('poknowledge', 'Seer_Mal_Nae`Shi')).toBe('poknowledge/Seer_Mal_Nae-Shi.lua');
  });
});

// postorms/Askr_the_Lost.lua, trimmed (RESPONSES shortened to their openings, the timer and
// state bookkeeping cut). Every line lives in a table, some read through a variable index, and
// the giant heads are three alternatives in one condition (the guild lead, 2026-10-01: "This is
// missing the actual instructions").
const ASKR = `local stateTable = {};
local RESPONSES = {
	"Askr looks up at you. 'Leave me alone to my ale and my misery.'",
	"Askr the Lost says 'Did you not hear me?'",
	"Askr raises an eyebrow your way.",
	"",
	"The drunken stupor vanishes. 'Was it you who severed the head?'",
	"Askr the Lost says 'Are you paying attention?'",
	"Askr the Lost says 'Mount Grenidor.' [continue]",
	"Askr the Lost says 'The three factions.' [continue]",
	"Askr the Lost says 'Seal them in this bag and return them to me.'",
	"",
	"Askr looks over the remnants of the storm giants in his hands.",
	"Askr the Lost says 'Seal two pieces of the medallion in this bag.'",
	"",
	"Askr the Lost says 'You have retrieved the pieces!'",
	"Askr the Lost says 'A hearty welcome back to you, friend.'",
	"Askr the Lost says 'You have returned to me, but for what purpose?'",
	"Askr points drunkenly towards the exit of the cave.",
	"Askr the Lost says 'You did well defeating one giant.'",
	"Askr the Lost says 'Seek me out that which I require.'",
	"Askr merely glances at you with a questioning look.",
};

function event_say(e)
	local qglobals = eq.get_qglobals(e.other);
	local karana = tonumber(qglobals.karana or 0);
	local state = GetState(name, karana);
	if ( karana == 0 ) then
		if ( e.message:findi("hail") ) then
			if ( headTable[name] ) then
				e.other:Message(0, RESPONSES[18]);
			end
			if ( state <= 3 ) then
				e.other:Message(0, RESPONSES[state]);
			end
		elseif ( e.message:findi("it was me") ) then
			if ( state == 6 ) then
				e.other:Message(0, RESPONSES[state]);
			end
		elseif ( e.message:findi("continue") ) then
			if ( state == 8 or state == 9 ) then
				e.other:Message(0, RESPONSES[state]);
				if ( state == 9 ) then
					e.other:SummonCursorItem(17192); -- Askr's Bag of Verity
				end
			elseif ( state > 9 ) then
				e.other:Message(0, RESPONSES[19]);
			end
		end
	end
end

function event_trade(e)
	local item_lib = require("items");
	if ( item_lib.check_turn_in(e.self, e.trade, { item1 = 28749 }) -- wind giant head
		or item_lib.check_turn_in(e.self, e.trade, { item1 = 28781 }) -- desert giant head
		or item_lib.check_turn_in(e.self, e.trade, { item1 = 28782 }) -- forest giant head
	) then
		e.other:Message(0, RESPONSES[5]);
		e.other:QuestReward(e.self, 0, 0, 0, 0, 0, 1);
		e.other:SummonCursorItem(11486);
	end
	if ( item_lib.check_turn_in(e.self, e.trade, { item1 = 11487 }) ) then -- Askr's Sealed Bag of Verity
		if ( karana == 0 ) then
			e.other:Message(0, RESPONSES[11]);
			e.other:QuestReward(e.self, 0, 0, 0, 0, 0, 1000);
			eq.set_global("karana", "1", 5, "F");
			e.other:Message(15, "You have received a character flag!");
		end
	end
	item_lib.return_items(e.self, e.other, e.trade);
end
`;

describe('Askr the Lost: lines kept in a table', () => {
  const say = q.parseDialog(ASKR);
  const by = (kw) => say.find((b) => b.keywords.includes(kw));

  it('reads the lines out of RESPONSES, by number and through the guard on its index', () => {
    const hail = by('hail').replies.map((r) => r.text);
    expect(hail[0]).toMatch(/You did well defeating one giant/);        // RESPONSES[18]
    expect(hail.slice(1)).toEqual([                                    // state <= 3 → 1, 2, 3
      "Askr looks up at you. 'Leave me alone to my ale and my misery.'",
      "Askr the Lost says 'Did you not hear me?'",
      'Askr raises an eyebrow your way.',
    ]);
    expect(by('it was me').replies.map((r) => r.text)).toEqual(["Askr the Lost says 'Are you paying attention?'"]);
    const cont = by('continue').replies.map((r) => r.text);
    expect(cont).toHaveLength(3);                                       // 8, 9, then 19 for "> 9"
    expect(cont[1]).toMatch(/Seal them in this bag/);
  });

  it('counts an item put on your cursor as one you get', () => {
    expect(by('continue').fx.gives).toEqual([17192]);
  });

  it('gives the three heads one shared answer, and marks the flag hand-in', () => {
    const tr = q.tradeBranches(ASKR);
    const heads = tr.filter((b) => [28749, 28781, 28782].includes(b.items[0]));
    expect(heads).toHaveLength(3);
    expect(new Set(heads.map((b) => b.group)).size).toBe(1);
    for (const b of heads) {
      expect(b.replies[0].text).toMatch(/severed the head/);
      expect(b.fx.gives).toEqual([11486]);
      expect(b.flag).toBe(false);
    }
    const bag = tr.find((b) => b.items[0] === 11487);
    expect(bag.flag).toBe(true);
    expect(bag.fx.exp).toBe(1000);
    expect(bag.replies[0].text).toMatch(/remnants of the storm giants/);
  });

  it('skips a table that holds anything but strings', () => {
    expect(q._stringTables('local T = {\n  { "a", "b" },\n};')).toEqual({});
    expect(q._stringTables('local L = { "one", -- note\n "two" };')).toEqual({ L: ['one', 'two'] });
  });
});
