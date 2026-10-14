// test/quest-dialog-pop-chain.test.js — FB-72: the Quest tab left out steps of the Planes of Power flag chain.
//
// A member, 2026-10-10 (Mimic 2.8.1-beta.14): the Giwin Mirakon inside the Plane of Innovation's factory
// "does not have the second message of 'I will test the machine'". Two causes, both here:
//   1. WHICH NPC. Three catalog bodies share the name Giwin Mirakon (206038 inside the factory, 206203
//      "#Giwin_Mirakon" that appears after the Behemoth, 214014 in the Plane of Tactics). mob-info prefers
//      a real body anywhere over a body that is immune to melee and magic, and every talking flag NPC is
//      exactly that, so a raider in Innovation got Tactics' Giwin, whose script only answers "hail".
//      The same pick sent every Planar Projection to the Plane of Disease's, Aid Eino in Knowledge to the
//      Nightmare one, and Tylis in Torment to the Tranquility one. `quest_id` names the body in the
//      requester's zone; the Quest tab reads that.
//   2. WHAT THE PARSER DROPPED. A keyword branch that says nothing and sets no flag was thrown away even
//      when it moves you (Askr's "transport"), casts the spell that carries you out (Tylis's "ready to
//      return"), spawns a mob (Trydan's "ready") or hands over an item (an Essence's "hail"); and the
//      Tribunal's findi("ready to begin the " .. TRIAL_TEXT[trialNum]) was not read at all.
// Fixtures are real scripts from the eqemu_quest_scripts mirror (SecretsOTheP/quests, GPL-3), whole unless
// marked trimmed.
//
// Run: npx vitest run test/quest-dialog-pop-chain.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(import.meta.url);
const q = nodeRequire('../utils/questDialog.js');
const ms = nodeRequire('../utils/mobSpecials.js');

// poinnovation/Giwin_Mirakon.lua, event_say only (the event_trade below it just keeps NO DROP items).
const GIWIN_INSIDE = `
function event_say(e)
	local qglobals = eq.get_qglobals(e.other);

	if ( qglobals.zeks ) then
		e.other:Message(0, "Giwin Mirakon tells you, 'Well go on then, what are you cowering around for, let us see what kind of warrior you are!'");
	else
		if ( e.message:findi("hail") ) then
				e.other:Message(0, "Giwin Mirakon tells you, 'How did you get in here?  Hrmm no matter, you will be helping me now for I am a [great warrior] of Rallos Zek and I know you wish not to provoke my fury!'");

		elseif ( e.message:findi("great warrior") ) then
			e.other:Message(0, "Giwin Mirakon tells you, 'Yeah, you heard me!  You know that I must be important if Rallos himself has plucked me from the battlefield to complete this [task].  Even though I serve my lord, I am desperate to return to my place on the eternal battlefield.'");

		elseif ( e.message:findi("task") ) then
			e.other:Message(0, "Giwin Mirakon tells you, 'Ya, you see Rallos sent me here to contract the machines to work on a mana powered piece of machinery that could test all on the eternal battlefield.  This weapon of ultimate destruction is taking quite a long time to be completed.  You know... if you were to go [test the machine] and it were to fail against you I could be on my way back to tell Rallos that it was defeated by mere mortals.  Help me to get back to the battlefield and out of this rusted out junk heap.'");

		elseif ( e.message:findi("test the machine") ) then
			e.other:Message(0, "Giwin Mirakon tells you, 'Haha!  I knew I sensed the warring spirit within you.  Go through over there.  Ignore those steam powered soldiers and their talk of perimeters.  Go into the main construction area, you will know you are there when you see power carriers taking energy to power up the machine.  If you can stop the energy carriers from releasing their energy the machine will activate to see what has happened.  I shall come to check on you and take a full report when you have destroyed it.  Long live Rallos!'");
			eq.set_global("zeks", "1", 5, "F");
			e.other:Message(15, "You have received a character flag!");
		end
	end
end
`;

// potactics/Giwin_Mirakon.lua, event_say only.
const GIWIN_TACTICS = `function event_say(e)
	local qglobals = eq.get_qglobals(e.other);
	local zeks = tonumber(qglobals.zeks) or 0;

	if ( e.message:findi("hail") ) then

		if ( zeks > 1 ) then
			e.other:Message(0, "Giwin Mirakon tells you, 'Well then, it took you long enough to get here.  The Zeks have grown tired of waiting for your arrival.  They have retired to their quarters.  I think that you should seek them out, they must have a warm welcome for someone with such a warring spirit!  Do not mind the minions of this realm, it is within their nature to challenge any that come within their reach.  Press on and find the Zeks!'");
		else
			e.other:Message(0, "Giwin Mirakon tells you, 'Who are you to talk to me?  Are you a Warrior of Rallos?  What are you doing here?!  Maybe you should leave before you make me angry.'");
		end
	end
end
`;

// poair/Essence_of_Air.lua, event_say only (the flagger scaffolding above it is trimmed).
const ESSENCE_AIR = `function event_say(e)

	if ( ClientCanFlag(e.other) and e.message:findi("hail") ) then

		if ( not e.other:HasItem(29164) and not e.other:HasItem(29165) ) then -- Amorphous Cloud of Air, Quintessence of Elements
			e.other:SummonCursorItem(29164); -- Item: Amorphous Cloud of Air
			flags = flags + 1;
		end

		if ( flags >= FLAG_LIMIT ) then
			eq.depop();
		end
	end
end
`;

// bothunder/#Askr_the_Lost.lua, whole.
const ASKR_HASH = `function event_say(e)
	if ( e.message:findi("hail") ) then
		e.self:Say("Well done.  I did not believe you could have progressed so far, so quickly.  Evynd was one of Agnarr's greatest lieutenants; your victory could not have been easy.  I fear, however, that your task will only become more difficult from here.  With Evynd dead, I can now help you to ascend to the next level.  When you are ready, simply ask and I will [transport] you to the [next level of Torden], but make haste, I cannot stay here for long.");

	elseif ( e.message:findi("transport") ) then

		e.other:CastToClient():MovePC(209, -880, -1787, 1729, 192*2);
		if ( e.other:GetPet().valid and not e.other:GetPet():Charmed() ) then
			e.other:GetPet():GMMove(-880, -1787, 1729, 0);
		end
	end
end

function event_spawn(e)
	eq.set_timer("depop", 3300000);
end

function event_timer(e)
	if ( e.timer == "depop" ) then
		eq.depop();
	end
end
`;

// potorment/#Tylis_Newleaf.lua, whole.
const TYLIS_TORMENT = `local FLAG_LIMIT = 72;

function event_spawn(e)
	flags = 0;
	eq.set_timer("depop", 600000);
end

function event_timer(e)
	if ( e.timer == "depop" ) then
		eq.depop();
	end
end

function event_say(e)
	local qglobals = eq.get_qglobals(e.other);

	if ( e.message:findi("hail") ) then

		if ( qglobals.tylis ) then

			e.other:Message(0, "Tylis Newleaf tells you, 'I must thank you for your kind efforts friends.  This place has laid claim to me for far too long.  Please take care and offer the dark wench my best.  I am off... and I suggest you not stray to far from that route yourselves.  Please tell me when you are ready to return and may your blades strike true!'");

			if ( qglobals.tylis == "1" and flags <= FLAG_LIMIT ) then
				eq.set_global("tylis", "2", 5, "F");
				e.other:Message(15, "You have received a character flag!");
				flags = flags + 1;
			end

			if ( qglobals.cl_keeper ) then
				eq.delete_global("cl_keeper");
			end

		elseif ( not qglobals.cl_keeper ) then

			if ( flags <= FLAG_LIMIT ) then
				e.other:Message(0, "Tylis Newleaf tells you, 'I don't recognize you, stranger. Thank you so much for your kind efforts.  This place has claimed me for far too long.  I will leave now that I have been freed of my torment. However, before I go, please tell me when you're [ready to return] and I will send you out first.'");
				eq.set_global("cl_keeper", "1", 5, "F");
				e.other:Message(15, "You have received a new checklist flag!");
				flags = flags + 1;
			end
		end

	elseif ( e.message:findi("ready to return") ) then
		e.self:CastSpell(1136, e.other:GetID()); -- Torment's Beckon
	end
end
`;

// pojustice/The_Tribunal.lua, trimmed: the first two PREPARED_TEXT lines of six, the trial names, and the
// hail / prove / prepared / ready-to-begin branches of event_say (the Mavuin and knowledge branches left out).
const TRIBUNAL = `local PREPARED_TEXT = {
	"nods slightly.  'Very well.  When you are ready, you may begin the trial of lashing.  You must protect the victims from their tormentors.  We shall judge the mark of your success.'",
	"nods slightly.  'Very well.  When you are ready, you may begin the trial of execution.  The victim will perish should the hooded executioner reach him.  We shall judge the mark of your success.'",
};
local TRIAL_TEXT = {
	"Trial of Lashing",
	"Trial of Execution",
	"Trial of Stoning",
	"Trial of Torture",
	"Trial of Hanging",
	"Trial of Flame",
};

function event_say(e)
	local qglobals = eq.get_qglobals(e.self, e.other);
	local trialNum = SPAWNPOINT_IDS[e.self:GetSpawnPointID()];

	if ( e.message:findi("hail") ) then
		e.self:Emote(" fixes you with a dark, piercing gaze.  'What do you want, mortal?'");
		return;
	end

	if ( e.message:findi("prove") ) then
		e.self:Say("The trials of the Tribunal are no easy affair. They will severely test your might and skill. Are you prepared for such an ordeal?");

	elseif (e.message:findi("prepared")) then
		e.self:Emote(PREPARED_TEXT[trialNum]);

	elseif (e.message:findi("ready to begin the "..TRIAL_TEXT[trialNum])) then

		if ( trialsUnderway[trialNum] or MobInTrial(trialNum) ) then
			e.self:Say("That trial is already underway.  You must wait.");
		else
			trialsUnderway[trialNum] = true;
			e.self:Say("Then begin.");
			eq.spawn2(CONTROLLER_IDS[trialNum], 0, 0, CONTROLLER_COORDS[trialNum][1], CONTROLLER_COORDS[trialNum][2], CONTROLLER_COORDS[trialNum][3], 0);
		end
	end
end
`;

// hohonora/encounters/RyddaDar.lua, trimmed: the ids, Trydan1Say and its registration.
const RYDDA = `local TRYDAN1_TYPE = 211051; -- Trydan_Faye
local CUSTODIAN_TYPE = 211078; -- A_Custodian_of_Marr

function Trydan1Say(e)
	if ( e.message:findi("hail") ) then
		e.self:Say("Hello my friend. I can see that you've journeyed far to come before me. You've passed your first task, but you have many more [Trials] to face before you can enter the Temple of Marr.");

	elseif ( e.message:findi("trials") ) then
		e.self:Say("There are three other Trials you must undergo before you can prove yourself worthy. When you're [ready] we'll begin the first Trial.");

	elseif ( e.message:findi("ready") ) then
		flags = 0;
		local mob = eq.spawn2(CUSTODIAN_TYPE, 0, 0, e.self:GetX(), e.self:GetY(), e.self:GetZ(), e.self:GetHeading());
		custodianId = mob:GetID();
		eq.set_timer("depop", 10000, mob);
		eq.depop_with_timer();
	end
end

function Initialize()
	eq.register_npc_event("RyddaDar", Event.say, TRYDAN1_TYPE, Trydan1Say);
end
`;

describe('Giwin Mirakon inside the factory', () => {
  it('lists the whole chain: hail, great warrior, task, and "test the machine" with its flag', () => {
    const say = q.parseDialog(GIWIN_INSIDE);
    expect(say.map((b) => b.say)).toEqual(['hail', 'great warrior', 'task', 'test the machine']);
    expect(say.map((b) => b.hints)).toEqual([['great warrior'], ['task'], ['test the machine'], []]);
    expect(say[3].flag).toBe(true);
    expect(say[3].replies[0].text).toMatch(/Haha!\s+I knew I sensed the warring spirit/);
    expect(say[0].flag).toBe(false);
  });

  it('the Plane of Tactics\' Giwin only answers "hail": reading his script is what lost the step', () => {
    expect(q.parseDialog(GIWIN_TACTICS).map((b) => b.say)).toEqual(['hail']);
  });
});

describe('which body the Quest tab reads (mobSpecials.questNpcId)', () => {
  // The three catalog rows, verbatim fields from eqemu_npc_types.
  const ROWS = [
    { id: 206038, name: 'Giwin_Mirakon', level: 60, maxlevel: 0, hp: 23000, special_abilities: '1,1^2,1^8,1^10,1^14,1^19,1^20,1^24,1^25,1^35,1' },
    { id: 206203, name: '#Giwin_Mirakon', level: 60, maxlevel: 0, hp: 23000, special_abilities: '1,1^2,1^8,1^10,1^14,1^49,1^19,1^20,1^24,1^25,1^35,1' },
    { id: 214014, name: 'Giwin_Mirakon', level: 46, maxlevel: 0, hp: 7200, special_abilities: '10,1' },
  ];

  it('the stats pick for a raider in Innovation IS the Tactics body (why the tab needs its own answer)', () => {
    const p = ms.pickAndMergeMobRows(ROWS, { zoneId: 206 });
    expect(p.row.id).toBe(214014);
    expect(p.scope).toBe('catalog-real');
  });

  it('Innovation gets the placed body, not the script-spawned #Giwin and not Tactics\'', () => {
    expect(ms.questNpcId(ROWS, 206, 214014)).toBe(206038);
  });

  it('is null when the pick already stands in the requester\'s zone, when the zone is unknown, or has no such body', () => {
    expect(ms.questNpcId(ROWS, 214, 214014)).toBeNull();
    expect(ms.questNpcId(ROWS, null, 214014)).toBeNull();
    expect(ms.questNpcId(ROWS, undefined, 214014)).toBeNull();
    expect(ms.questNpcId(ROWS, 215, 214014)).toBeNull();
    expect(ms.questNpcId([], 206, 214014)).toBeNull();
    expect(ms.questNpcId(null, 206, 214014)).toBeNull();
  });

  it('a zone whose only body is a "#" one still gets it; the plain name wins when both are there', () => {
    expect(ms.questNpcId([ROWS[1], ROWS[2]], 206, 214014)).toBe(206203);
    expect(ms.questNpcId([ROWS[1], ROWS[0], ROWS[2]], 206, 214014)).toBe(206038);
  });

  // The Planar Projections are the widest case: one real body (Disease, 205156) beats the placeholder
  // projection of every other plane, and each plane's script differs (they ARE the flag chain).
  it('every other plane\'s Planar Projection, not Disease\'s', () => {
    const body = (id, sa) => ({ id, name: 'A_Planar_Projection', level: 1, maxlevel: 0, hp: id === 205156 ? 10000 : 25, special_abilities: sa });
    const rows = [body(205156, '8,1^24,1^25,1^35,1'), body(207317, '8,1^19,1^20,1^21,1^23,1^24,1^25,1^35,1^46,1'),
      body(208207, '8,1^19,1^20,1^23,1^24,1^25,1^35,1'), body(221042, '19,1^20,1^24,1^25,1^35,1')];
    for (const z of [207, 208, 221]) {
      const picked = ms.pickAndMergeMobRows(rows, { zoneId: z }).row.id;
      expect(picked).toBe(205156);
      expect(ms.questNpcId(rows, z, picked)).toBe(rows.find((r) => Math.floor(r.id / 1000) === z).id);
    }
    expect(ms.questNpcId(rows, 205, 205156)).toBeNull();
  });
});

describe('the mob-info answer carries quest_id (the real _buildMobInfo)', () => {
  const SRC = readSource(BOT_INDEX);
  const slice = sliceBlock(SRC, 'async function _buildMobInfo(supabase, {', '\n  return mob;\n}');
  const helpers = [
    sliceBlock(SRC, 'function _mobCaseKey(n) {', '\n}'),
    sliceBlock(SRC, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
  ].join('\n');
  const GENDER = "const _GENDER_NAMES = { 0: 'male', 1: 'female', 2: 'neuter' };";
  const CLASSES = "const _MOB_CLASS_NAMES = { 1:'Warrior', 12:'Wizard' };";
  const body = (id, name, level, hp, sa) => ({
    id, name, class: 1, level, maxlevel: 0, hp, mana: 0, ac: 10, mr: 0, fr: 0, cr: 0, pr: 0, dr: 0,
    mindmg: 1, maxdmg: 2, runspeed: 1.25, npcspecialattks: '', special_abilities: sa, raid_target: 0,
    bodytype: 1, npc_spells_id: 0, see_invis: 0, see_invis_undead: 0, see_hide: 0, see_improved_hide: 0, race: 12, gender: 0,
  });
  const bodies = [
    body(206038, 'Giwin_Mirakon', 60, 23000, '1,1^2,1^8,1^10,1^14,1^19,1^20,1^24,1^25,1^35,1'),
    body(206203, '#Giwin_Mirakon', 60, 23000, '1,1^2,1^8,1^10,1^14,1^49,1^19,1^20,1^24,1^25,1^35,1'),
    body(214014, 'Giwin_Mirakon', 46, 7200, '10,1'),
  ];
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  const sb = {
    select: async (table, qs) => {
      if (table !== 'eqemu_npc_types') return [];
      const want = decodeURIComponent(qs.slice('or=(name.ilike.'.length, qs.indexOf(',name.ilike'))).toLowerCase();
      return bodies.filter((b) => b.name.replace(/^#/, '').toLowerCase() === want);
    },
  };
  const build = () => new Function('mobSpecials', 'factionAssist', '_factionRowsFor', 'npcProcs', 'process', 'console',
    `${helpers}\n${GENDER}\n${CLASSES}\n${slice}\nreturn _buildMobInfo;`)(
    ms, { getIndex: async () => null, assistFor: () => null }, async () => null, nodeRequire('../utils/npcProcs.js'), process, console);
  const ask = (reqZoneId) => build()(sb, { name: 'Giwin Mirakon', norm: 'giwin_mirakon', caseKey: 'giwin_Mirakon', reqZoneId, reqGender: null });

  it('in Innovation: the stats are Tactics\' (unchanged), quest_id is the inside Giwin', async () => {
    const mob = await ask(206);
    expect(mob.id).toBe(214014);
    expect(mob.quest_id).toBe(206038);
  });
  it('in Tactics, or with no zone known, there is no quest_id and the overlay uses id', async () => {
    expect('quest_id' in (await ask(214))).toBe(false);
    expect('quest_id' in (await ask(null))).toBe(false);
  });
});

describe('keyword branches that act without speaking', () => {
  it('an Essence\'s "hail" hands over the item: listed, with what you get', () => {
    const say = q.parseDialog(ESSENCE_AIR);
    expect(say).toHaveLength(1);
    expect(say[0].say).toBe('hail');
    expect(say[0].replies).toEqual([]);
    expect(say[0].fx.gives).toEqual([29164]);
    expect(say[0].gated).toBe(true);   // it checks you do not already hold the Cloud or the Quintessence
  });

  it('Askr\'s "transport" moves you; Tylis\'s "ready to return" casts the spell that carries you out', () => {
    expect(q.parseDialog(ASKR_HASH).map((b) => b.say)).toEqual(['hail', 'transport']);
    const tylis = q.parseDialog(TYLIS_TORMENT);
    expect(tylis.map((b) => b.say)).toEqual(['hail', 'ready to return']);
    expect(tylis[1].replies).toEqual([]);
    expect(tylis[0].flag).toBe(true);
  });

  it('Trydan\'s "ready" (an encounter file) spawns the custodian and leaves: listed, with both warnings', () => {
    const lua = q.encounterHandlers(RYDDA, 211051);
    const say = q.parseDialog(lua);
    expect(say.map((b) => b.say)).toEqual(['hail', 'trials', 'ready']);
    expect(say[2].replies).toEqual([]);
    expect(say[2].fx.spawnOther).toBe(true);
    expect(say[2].fx.depopSelf).toBe(true);
  });

  it('a branch with nothing to say and nothing to do is still dropped', () => {
    const lua = 'function event_say(e)\n if e.message:findi("hail") then\n  e.self:Say("Hi.");\n elseif e.message:findi("nothing") then\n  flags = flags + 1;\n end\nend\n';
    expect(q.parseDialog(lua).map((b) => b.say)).toEqual(['hail']);
  });

  it('a GM-only branch that acts is still never offered', () => {
    const lua = 'function event_say(e)\n if e.message:findi("hail") then\n  e.self:Say("Hi.");\n elseif e.message:findi("port") and e.other:GetGM() then\n  e.other:MovePC(1, 0, 0, 0, 0);\n end\nend\n';
    expect(q.parseDialog(lua).map((b) => b.say)).toEqual(['hail']);
  });
});

describe('the Tribunal: findi("ready to begin the " .. TRIAL_TEXT[trialNum])', () => {
  const say = q.parseDialog(TRIBUNAL);

  it('is one phrase per trial, each with the Tribunal\'s answer', () => {
    const phrases = say.filter((b) => /^ready to begin/.test(b.say));
    expect(phrases.map((b) => b.say)).toEqual([
      'ready to begin the Trial of Lashing', 'ready to begin the Trial of Execution', 'ready to begin the Trial of Stoning',
      'ready to begin the Trial of Torture', 'ready to begin the Trial of Hanging', 'ready to begin the Trial of Flame']);
    for (const b of phrases) {
      expect(b.replies.map((r) => r.text)).toEqual(['That trial is already underway. You must wait.', 'Then begin.']);
      expect(b.fx.spawnOther).toBe(true);
    }
  });

  it('"prepared" keeps its own emote lines (one per Tribunal) and no longer borrows the next branch\'s words', () => {
    const prepared = say.find((b) => b.say === 'prepared');
    expect(prepared.replies).toHaveLength(2);
    expect(prepared.replies[0].text).toMatch(/begin the trial of lashing/);
    expect(prepared.replies.map((r) => r.text).join(' ')).not.toMatch(/Then begin/);
  });

  it('hail and prove are read as before', () => {
    expect(say.slice(0, 2).map((b) => b.say)).toEqual(['hail', 'prove']);
  });
});

describe('an unguarded table', () => {
  it('a long one is a conversation state machine (Bittrik\'s 30 lines): nothing is guessed from it', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `"line ${i + 1}"`).join(', ');
    const lua = `local RESPONSES = { ${lines} }\nfunction event_say(e)\n if e.message:findi("kingdom") then\n  e.other:Message(0, RESPONSES[state]);\n end\nend\n`;
    expect(q.parseDialog(lua)).toEqual([]);
  });
});

describe('a guard that names the index still limits the lines (Askr is unchanged)', () => {
  it('RESPONSES[state] under state == 6 gives that one line, not the whole list', () => {
    const lua = 'local RESPONSES = { "one", "two", "three", "four", "five", "six" }\nfunction event_say(e)\n if e.message:findi("hail") then\n  if state == 6 then\n   e.other:Message(0, RESPONSES[state]);\n  end\n end\nend\n';
    expect(q.parseDialog(lua)[0].replies.map((r) => r.text)).toEqual(['six']);
  });
});
