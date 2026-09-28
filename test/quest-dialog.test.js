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
