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

// ponightmare/encounters/Maze.lua, trimmed: the constants, a helper with nested blocks and a
// string holding "end" ahead of the handlers, then the three Thelin handlers (the ready branch's
// trial-picking cut down to its shape) and the register block. Thelin Poxbourne has no file of
// his own, so the Quest tab saw "no quest script" (the guild lead, 2026-10-08).
const MAZE = `local GOVERNOR_TYPE = 204458; -- Maze_Checker
local THELIN_OUTSIDE_TYPE = 204070; -- Thelin_Poxbourne
local THELIN_INSIDE_TYPE = 204486; -- Thelin_Poxbourne
local TERRIS_TYPE = 204483; -- Terris_Thule

function GetMazeGroup(client, dist)
	local members = {};
	local function add(member)
		if ( member and member.valid ) then
			table.insert(members, member);
		end
	end
	for i = 0, 5 do
		add(client);
	end
	eq.debug("the end of the group");   -- if ( this ) then
	return members;
end

function ThelinTradeEvent(e)
	local i = GetInstanceFromSpawnID(e.self:GetSpawnPointID());
	local item_lib = require("items");

	if ( instance[i].state == 3 and item_lib.check_turn_in(e.self, e.trade, {item1 = 9258}) ) then -- Dagger Blade Shard
		e.self:Emote("takes the final shard from you and places all of the pieces on the ground.  Thelin picks it up and hands it to you.");
		e.other:QuestReward(e.self, 0, 0, 0, 0, 9259); -- Thelin's Dagger
		local offset = 1000 - (i * 1000);
		instance[i].terris = eq.spawn2(TERRIS_TYPE, 0, 0, -4532, 5950+offset, 8, 0);
	end

	item_lib.return_items(e.self, e.other, e.trade);
end

function ThelinOutsideSayEvent(e)

	local qglobals = eq.get_qglobals(e.other);

	if ( not qglobals.thelin ) then
		if ( e.message:findi("hail") ) then
			e.other:Message(0, "Thelin Poxbourne screams loudly, and then falls asleep once again.");
		end
		return;
	end

	if ( e.message:findi("hail") ) then
		e.other:Message(0, "Thelin Poxbourne tells you, 'Who is it?  Are you.. really there?  She has offered me a pact.  If I can retrieve my [dagger], then I am free to go.'");

	elseif ( e.message:findi("dagger") ) then
		e.other:Message(0, "Thelin Poxbourne tells you, 'She broke it into seven pieces.  I must retrieve it, will you [help] me.'");

	elseif ( e.message:findi("help") ) then
		e.other:Message(0, "Thelin Poxbourne tells you, 'Please when you are prepared have the leader of each of your band of adventurers tell me they are ready.'");

	elseif ( e.message:findi("ready") ) then
		local members = GetMazeGroup(e.other, 150);
		if ( #members == 0 ) then return; end
		local trial = 0;
		for i = 1, 3 do
			if ( instance[i].state == 0 and not ClientInTrial(i) ) then
				trial = i;
				break;
			end
		end
		if ( trial > 0 ) then
			e.self:Emote("closes his eyes and falls asleep immediately.  He looks peaceful for a moment and then screams in agony!");
		else
			e.self:Emote("groans in agony. 'I must.. rest.  Can you please come back after I have rested.'");
		end
	end
end

function ThelinInsideSayEvent(e)
	local i = GetInstanceFromSpawnID(e.self:GetSpawnPointID());

	if ( instance[i].state == 1 ) then

		if ( e.message:findi("hail") ) then
			e.self:Say("Has everyone made it here safely?  When you tell me I will seal off my dream and we can begin.  Are you ready to follow?");

		elseif ( e.message:findi("ready") ) then
			e.self:Say("Please stay close, I know not what horror Terris will unleash upon us, so stay with me to the end.");
			instance[i].state = 2;   -- if you fall, this is the end
		end

	elseif ( instance[i].state == 4 ) then

		if ( e.message:findi("hail") ) then
			e.other:Message(0, "Thelin Poxbourne tells you, 'Please destroy her for all that have had to endure her hideous visions.'");
		end
	end
end

function ThelinTimerEvent(e)
	if ( e.timer == "talk1" ) then
		e.self:Say("Terris hear me now!");
	end
end

function event_encounter_load(e)
	eq.register_npc_event("Maze", Event.timer, GOVERNOR_TYPE, GovernorTimerEvent);
	eq.register_npc_event("Maze", Event.timer, THELIN_INSIDE_TYPE, ThelinTimerEvent);
	eq.register_npc_event("Maze", Event.trade, THELIN_INSIDE_TYPE, ThelinTradeEvent);
	eq.register_npc_event("Maze", Event.say, THELIN_OUTSIDE_TYPE, ThelinOutsideSayEvent);
	eq.register_npc_event("Maze", Event.say, THELIN_INSIDE_TYPE, ThelinInsideSayEvent);
end
`;

// eastwastes/encounters/ringfour.lua, trimmed: ids written as literals; Tain has a say handler
// and a timer, nobody in it takes a hand-in.
const RINGFOUR = `-- Coldain Ring: Quest 4
local hailtimer = 0;

function TainSay(e)
	if(e.message:findi("hail")) then
		e.self:Say("The bloody Kromrif ambushed me! I escaped, but I am near death. Without [help], I'm as good as dead.");
	elseif(e.message:findi("help") and hailtimer == 0) then
		eq.unique_spawn(116018, 0, 0, -3260, -4819, 190, 65); -- NPC: Ghrek_Squatnot
		hailtimer = 1;
	end
end

function TainTimer(e)
	if(e.timer == "passout") then
		e.self:SetAppearance(3);
	end
end

function FrostTimer(e)
	eq.depop();
end

function event_encounter_load(e)
	eq.register_npc_event("ringfour", Event.say, 116005, TainSay);
	eq.register_npc_event("ringfour", Event.timer, 116005, TainTimer);
	eq.register_npc_event("ringfour", Event.timer, 116019, FrostTimer);
end
`;

describe('NPCs scripted by an encounter file', () => {
  it('finds the handlers through a constant: Thelin inside the maze says and takes a hand-in', () => {
    const lua = q.encounterHandlers(MAZE, 204486);
    expect(lua).toMatch(/^function event_say\(e\)/);
    expect(lua).toMatch(/\nfunction event_trade\(e\)/);
    const say = q.parseDialog(lua);
    expect(say.map((b) => b.keywords[0])).toEqual(['hail', 'ready', 'hail']);   // state 1, state 1, state 4
    expect(say[1].replies[0].text).toMatch(/Please stay close/);
    const br = q.tradeBranches(lua);
    expect(br).toHaveLength(1);
    expect(br[0].items).toEqual([9258]);
    expect(br[0].fx.gives).toEqual([9259]);
    expect(q.tradeReplies(lua)[0].text).toMatch(/Thelin picks it up/);
  });

  it('reads the outside Thelin from the same file, whole handler to its own end', () => {
    const lua = q.encounterHandlers(MAZE, 204070);
    const say = q.parseDialog(lua);
    expect(say.map((b) => b.keywords[0])).toEqual(['hail', 'hail', 'dagger', 'help', 'ready']);
    expect(say[4].replies.map((r) => r.text)).toEqual([
      'closes his eyes and falls asleep immediately. He looks peaceful for a moment and then screams in agony!',
      "groans in agony. 'I must.. rest. Can you please come back after I have rested.'",
    ]);
    expect(lua).not.toMatch(/Please stay close/);      // the inside handler is not this NPC's
    expect(q.tradeBranches(lua)).toEqual([]);          // outside Thelin registers no trade
  });

  it('takes a literal npc id and leaves the handlers of other ids behind', () => {
    const lua = q.encounterHandlers(RINGFOUR, 116005);
    expect(lua).not.toMatch(/event_trade/);
    const say = q.parseDialog(lua);
    // "help" says nothing but spawns Ghrek: it is listed (with the spawn warning), not dropped as silent (FB-72).
    expect(say.map((b) => b.keywords)).toEqual([['hail'], ['help']]);
    expect(say[0].replies[0].text).toMatch(/Kromrif ambushed me/);
    expect(say[1].replies).toEqual([]);
    expect(say[1].fx.spawns).toEqual([116018]);
    expect(lua).not.toMatch(/passout/);                // TainTimer is not a say handler
  });

  it('gives nothing for an id the file never registers say or trade for', () => {
    expect(q.encounterHandlers(MAZE, 204999)).toBeNull();
    expect(q.encounterHandlers(MAZE, 204483)).toBeNull();     // Terris: a constant, but no say/trade
    expect(q.encounterHandlers(RINGFOUR, 116006)).toBeNull();
  });

  it('gives nothing when the id is only registered for a timer', () => {
    expect(q.encounterHandlers(MAZE, 204458)).toBeNull();      // GOVERNOR_TYPE: Event.timer only
    expect(q.encounterHandlers(RINGFOUR, 116019)).toBeNull();
  });

  it('cuts the handler at its own end, not at an end inside a string, comment or loop', () => {
    const body = [
      'local NPC = 100;',
      'function Before(e)',
      '  if x then y() end',
      'end',
      'function SaySide(e)',
      '  for i = 1, 3 do',
      '    if e.message:findi("end") then -- end of the line',
      '      e.self:Say("the end is nigh");',
      '    elseif z then',
      '      --[[ the',
      '      end ]] while a do b() end',
      '    end',
      '  end',
      'end',
      'function Other(e) e.self:Say("not me") end',
      'eq.register_npc_event("T", Event.say, NPC, SaySide);',
      'eq.register_npc_event("T", Event.say, NPC, Other);',
    ].join('\n');
    expect(q.encounterHandlers(body, 100)).toBe([
      'function event_say(e)',
      '  for i = 1, 3 do',
      '    if e.message:findi("end") then -- end of the line',
      '      e.self:Say("the end is nigh");',
      '    elseif z then',
      '      --[[ the',
      '      end ]] while a do b() end',
      '    end',
      '  end',
      'end',
    ].join('\n'));
  });
});
