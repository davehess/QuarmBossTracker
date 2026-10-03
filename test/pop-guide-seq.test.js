// test/pop-guide-seq.test.js — the PoP guide's `seq`: each step as ONE ordered list (the guild lead,
// 2026-10-03: "some of the steps require you to hail after something else or say a line multiple times.
// the hand in items should be in order with the text we say to them").
//
// Nothing here can reach the database, so two SNAPSHOTS stand in for it, both pulled on 2026-10-03:
//   KW      — every findi("…") keyword of each script a hail or a say cites (one regexp_matches over
//             eqemu_quest_scripts.body), plus SCRIPTS: every path any act cites exists there;
//   ITEMS   — id → name for every item token a give / get / click / note names (eqemu_items).
// A say must be one of its script's own keywords (or a phrase CONTAINING all of an allowed keyword set:
// findi is a substring match, and the guide has long worded "what ward" for "ward"); an item token must
// be a real id with the real name. Re-pull both when an act cites a script or an item that is not here.
// ⚠ Upstream scripts (SecretsOTheP/quests): Quarm may differ.
//
// Behaviour first: seqRows is the real function, run over invented acts; the page's two renderers are
// asserted on their comment-stripped source (stripJs) because they are JSX; the overlay's renderer is
// run in test/pop-overlay-quests.test.js. Mutation-checked: see the notes beside each guard.
//
// Run: npx vitest run test/pop-guide-seq.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { GUIDE_ITEMS, GUIDE_KEYS, guideItemIds, seqRows, splitItems } from '../web/lib/popGuide.ts';
import { STEP_MORE } from '../web/lib/popGuideMore.ts';
import { POP_FLAGS } from '../web/lib/popFlags.ts';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const step = (k) => GUIDE_ITEMS.find(i => i.key === k);
const withSeq = GUIDE_ITEMS.filter(i => i.seq);
const KINDS = ['hail', 'say', 'give', 'get', 'kill', 'click', 'zone', 'wait', 'note'];

// Every findi keyword of every script a hail or a say cites. (Lower-cased when compared.)
const KW = {
  'bothunder/##Askr_the_Lost.lua': ['hail', 'what storm'],
  'bothunder/#Askr_the_Lost.lua': ['hail', 'transport'],
  'bothunder/Karana.lua': ['hail', 'follow the path of the Fallen', 'send me'],
  'codecay/A_Planar_Projection.lua': ['hail'],
  'codecay/Tarkil_Adan.lua': ['hail'],
  'hohonora/encounters/Crazed.lua': ['hail', 'ready'],
  'hohonora/encounters/RyddaDar.lua': ['hail', 'trials', 'ready'],
  'hohonora/encounters/Villagers.lua': ['hail', 'ready'],
  'hohonorb/A_Planar_Projection.lua': ['hail'],
  'nightmareb/A_Planar_Projection.lua': ['hail'],
  'poair/Essence_of_Air.lua': ['hail'],
  'podisease/A_Planar_Projection.lua': ['hail'],
  'poeartha/A_Planar_Projection.lua': ['hail'],
  'poearthb/Essence_of_Earth.lua': ['hail'],
  'pofire/Essence_of_Fire.lua': ['hail'],
  'poinnovation/#Chronographer_Muon.lua': ['hail', 'yes'],
  'poinnovation/#Giwin_Mirakon.lua': ['hail'],
  'poinnovation/Giwin_Mirakon.lua': ['hail', 'great warrior', 'task', 'test the machine'],
  'poinnovation/Loreseeker_Maelin.lua': ['hail', 'researched'],
  'poinnovation/Nitram_Anizok.lua': ['hail', 'advanced tinkering', 'construction', 'instinct for survival', 'combination of batteries', 'collecting materials'],
  'pojustice/#Mavuin.lua': ['hail', 'information'],
  // The Tribunal's trial phrase is built at run time: findi("ready to begin the " .. TRIAL_TEXT[n]).
  'pojustice/The_Tribunal.lua': ['hail', 'mavuin', 'prove', 'prepared', 'knowledge',
    'ready to begin the trial of lashing', 'ready to begin the trial of execution', 'ready to begin the trial of stoning',
    'ready to begin the trial of torture', 'ready to begin the trial of hanging', 'ready to begin the trial of flame'],
  'poknowledge/Aid_Eino.lua': ['hail', 'help'],
  'poknowledge/Councilwoman_Kerasha.lua': ['hail', 'aid', 'essences of power'],
  'poknowledge/Curator_Merri.lua': ['hail', 'artifacts', 'special items', "collector's box", 'collectors box'],
  'poknowledge/Grand_Librarian_Maelin.lua': ['hail', 'lore', 'information'],
  'poknowledge/Sage_Balic.lua': ['hail', 'your research', 'continue', 'their research', 'froglok', 'magical mask'],
  'poknowledge/Seer_Mal_Nae-Shi.lua': ['hail', 'guided meditation', 'unlock', 'memories'],
  'poknowledge/Soulbinder_Jera.lua': ['hail', 'bind my soul'],
  'poknowledge/Tarerd_Gahar.lua': ['hail', 'pool', 'from me'],
  'poknowledge/Trep_Thilcan.lua': ['hail', 'will do you a favor', 'ready to begin'],
  'ponightmare/EinoInvisNight.lua': ['quellious be my guide'],
  'ponightmare/encounters/Maze.lua': ['hail', 'dagger', 'help', 'ready'],
  'postorms/Askr_the_Lost.lua': ['hail', 'massive problem', 'it was me', 'paying attention', 'yes', 'continue', 'bastion of thunder'],
  'potactics/214322.lua': ['hail'],
  'potactics/214323.lua': ['hail'],
  'potactics/214324.lua': ['hail'],
  'potorment/#Tylis_Newleaf.lua': ['hail', 'ready to return'],
  'potorment/A_Planar_Projection.lua': ['hail'],
  'potranquility/Adler_Fuirstel.lua': ['hail', 'plane of disease', 'ward'],
  'potranquility/Adroha_Jezith.lua': ['hail', 'portal', 'coma', 'poverty and ruin', 'jeweled dagger', 'plane of tranquility', 'tortured by nightmares'],
  'potranquility/Elder_Fuirstel.lua': ['hail'],
  'potranquility/Elder_Poxbourne.lua': ['hail'],
  'potranquility/Fahlia_Shadyglade.lua': ['hail', 'condition', 'black cube', 'plane of torment', 'will go'],
  'potranquility/Miak_the_Searedsoul.lua': ['hail', 'plane of fire', 'demise', "portal's destination"],
  'potranquility/Tylis_Newleaf.lua': ['hail'],
  'povalor/A_Planar_Projection.lua': ['hail'],
  'powater/Essence_of_Water.lua': ['hail'],
  'solrotower/A_Planar_Projection.lua': ['hail'],
};

// A phrase LONGER than a keyword is fine when it contains every part of the keyword set the script tests
// (findi is a substring match). Each is listed on purpose: anything not here must be a keyword exactly.
const LONGER = {
  'potranquility/Adler_Fuirstel.lua|what ward': ['ward'],
  'potranquility/Fahlia_Shadyglade.lua|i will go': ['will go'],
  'poinnovation/Giwin_Mirakon.lua|I will test the machine': ['test the machine'],
  'pojustice/The_Tribunal.lua|mavuin sent me': ['mavuin'],
  'poknowledge/Seer_Mal_Nae-Shi.lua|unlock my memories': ['unlock', 'memories'],   // the script tests BOTH words
  'bothunder/Karana.lua|I will follow the path of the Fallen.': ['follow the path of the fallen'],
  'bothunder/Karana.lua|Send me on my path.': ['send me'],
};

// Every script any act cites exists in eqemu_quest_scripts (a missing one would fail the select below).
const SCRIPTS = new Set([
  ...Object.keys(KW),
  'bothunder/Agnarr_the_Storm_Lord.lua', 'bothunder/Emmerik_Skyfury.lua', 'bothunder/Evynd_Firestorm.lua', 'bothunder/player.lua',
  'codecay/#High_Priest_Ultor_Szanvon.lua', 'codecay/encounters/Bertox.lua', 'codecay/player.lua', 'droga/Jeren_Manri.lua',
  'hohonora/player.lua', 'hohonorb/Lord_Mithaniel_Marr.lua', 'nightmareb/Terris_Thule.lua', 'poair/encounters/Xegony.lua',
  'podisease/#Grummus.lua', 'podisease/player.lua', 'poeartha/A_Mystical_Arbitor_of_Earth.lua', 'poeartha/arbitor_guy.lua',
  'poeartha/player.lua', 'poearthb/#Avatar_of_Earth.lua', 'pofire/encounters/Fennin.lua', 'poinnovation/#Xanamech_Nezmirthafen.lua',
  'poinnovation/encounters/Behemoth.lua', 'poinnovation/player.lua', 'pojustice/player.lua', 'poknowledge/Agrakath_Theric.lua',
  'poknowledge/Alexis_Dubbani.lua', 'poknowledge/Arch_Mage_Narik.lua', 'poknowledge/Boiron_Ston.lua', 'poknowledge/Bolcen_Tendag.lua',
  'poknowledge/Caden_Zharik.lua', 'poknowledge/Drelynn_Beaufax.lua', 'poknowledge/Elisha_Dirtyshoes.lua', 'poknowledge/Holly_Longtail.lua',
  'poknowledge/Lohie_Cantare.lua', 'poknowledge/Mirao_Frostpouch.lua', 'poknowledge/Onirelin_Gali.lua', 'poknowledge/Oracle_Cador.lua',
  'poknowledge/Tratlan_Jowyr.lua', 'poknowledge/Vicar_Thiran.lua', 'poknowledge/Willamina.lua', 'ponightmare/Aid_Eino.lua',
  'ponightmare/player.lua', 'postorms/player.lua', 'potactics/214026.lua', 'potactics/214317.lua', 'potactics/encounters/Rallos.lua',
  'potorment/Saryrn.lua', 'potorment/The_Keeper_of_Sorrows.lua', 'potranquility/player.lua', 'povalor/#Aerin-Dar.lua', 'povalor/player.lua',
  'powater/encounters/Coirnav.lua', 'solrotower/#Rizlona.lua', 'solrotower/Arlyxir.lua', 'solrotower/Guardian_of_Dresolik.lua',
  'solrotower/Jiva.lua', 'solrotower/Rizlona.lua', 'solrotower/Solusek_Ro.lua', 'solrotower/The_Protector_of_Dresolik.lua',
  'solrotower/Xuzl.lua', 'solrotower/player.lua',
]);

// id → name for every item token in a seq (eqemu_items, 2026-10-03). The database drops some apostrophes
// ("Boirons Standard") and the guide keeps them, so names are compared without apostrophes.
const ITEMS = {
  2569: 'Forlorn Totem of Rolfron Zek', 3392: 'Stretched Skin Drum', 4680: 'Book of Inspiration', 4696: 'Hope Diamond',
  4748: 'Petrified Totem', 7154: 'Tiny Rockhopper Eye', 9258: 'Dagger Blade Shard', 9259: "Thelin's Dagger", 9295: 'Copper Node',
  9321: 'Fine Cut, Diamond Inlaid Mask', 9426: 'Bundle of Super Conductive Wires', 9433: 'Symbol of Torden', 9434: 'Intact Power Cell',
  11486: 'Storm Giant Head', 11487: "Askr's Sealed Bag of Verity", 11488: 'Esoteric Meld', 11935: 'Cockatrice Beak',
  13077: 'Minotaur Horn', 13238: 'Blackened Sapphire', 13400: 'Black Tome with Silver Runes', 14719: 'Tome of the Eternal',
  15946: 'Word of Combine', 15947: 'Word of Sorcery', 15948: 'Word of Helix', 15949: 'Word of Inverse', 15950: 'Word of Impetus',
  15958: 'Note from Tarerd', 15959: 'Goblins and Their Religions', 15960: 'The Reflecting Pools of Tanaan',
  15978: 'Merchants Crate of Supplies', 16260: 'Tiny Gold Fist', 16261: 'Strand of Nightmare', 16262: 'Essence of Fire',
  16263: 'Essence of Wind', 16265: 'Essence of Water', 16266: 'Power of the Planes', 16532: 'Undead Froglok Tongue',
  17176: "Sage's Box of Research", 17177: 'Empty Supplies Crate', 17183: 'Sacred Bowl', 17192: "Askr's Bag of Verity",
  17209: 'Frizzniks Endless Coin Purse', 17769: "Collector's Box", 22519: 'Sarnak Blood', 25596: 'A Crystalline Globe',
  27999: 'Shimmering Velium Ruby', 28025: 'Orcish Lute of Singing', 28071: 'Codex of the Warrior', 28072: 'Coldain Fetish',
  28073: 'Greenscale Emerald', 28074: 'Tambourine of Rituals', 28075: 'Idol of Woven Grass', 28076: 'Collection of Taxidermy',
  28077: 'Collection of Gems', 28080: 'Collection of Instruments', 28081: 'Collection of Books', 28082: 'Collection of Idols',
  28084: 'Note to Caden', 28085: 'Boirons Standard', 28086: 'Letter to Elisha', 28087: 'Nariks Ring', 28088: 'Onirelins Jewel',
  28089: 'Cadors Artifact', 28090: 'Black Lava Powder', 28091: 'Curative Potion', 28092: 'New Sewing Needles',
  28188: 'History of Evils: The Age of Scale', 28237: 'Fine Antique Ring', 28239: 'Fine Antique Amice', 28240: 'Fine Antique Locket',
  28241: 'Fine Antique Velvet Rose', 28242: 'Fine Antique Veil', 28745: "Planar Traveler's Manual", 28749: 'Storm Giant Head',
  28750: 'Storm Volaas Beard', 28751: 'Storm Taarid Bone', 28764: 'Storm Satuur Sash', 28765: 'Esoteric Medallion',
  29146: 'Mound of Living Stone', 29147: 'Globe of Dancing Flame', 29163: 'Sphere of Coalesced Water', 29164: 'Amorphous Cloud of Air',
  29165: 'Quintessence of Elements', 30030: 'High Quality Cougarskin', 31599: 'The Mark of Justice', 31796: 'Mark of Flame',
  31842: 'Mark of Execution', 31844: 'Mark of Torture', 31845: 'Mark of Stone', 31846: 'Mark of Suffocation', 31960: 'Mark of Lashing',
  32019: "Sage's Apprentice Cap", 32020: 'Twisted Talisman', 32021: 'Three Ringed Hoop', 32022: 'Joined Signet',
  32023: "Apprentice's Notebook", 32106: 'Jade Hoop of Speed', 32107: 'Cord of Invigoration', 32108: 'Mace of the Ancients',
  32109: 'Ring of Farsight', 32111: 'Essence of Earth',
};
const noApos = (s) => s.replace(/[’']/g, '');
const TOKEN = /^\[\[([^\]#]+)#(\d+)\]\]$/;

const sayOk = (act) => {
  const kws = (KW[act.src] ?? []).map(k => k.toLowerCase());
  const lc = act.text.toLowerCase();
  if (kws.includes(lc)) return true;
  const parts = LONGER[`${act.src}|${act.text}`];
  return !!parts && parts.every(p => kws.includes(p) && lc.includes(p));
};

// Steps that have a say, a hand-in, a chain or a hail-after-something but NO seq, and why. One today.
const NO_SEQ = {
  start_charm: 'Gram Dunnar has no row in eqemu_quest_scripts, so "craft" / "I have stories" cannot be cited to a script',
  start_hails: 'general advice about hailing, not a step with an order of its own',
};

describe('the coverage: every step with words, a hand-in or a hail has an ordered seq (or says why not)', () => {
  const needs = (i) => !!(i.says?.length || i.chain || STEP_MORE[i.key]?.turnIn?.length || /\bhail\b/i.test(i.detail ?? ''));
  it('no step that needs a seq is without one, bar the documented exceptions', () => {
    const missing = GUIDE_ITEMS.filter(i => needs(i) && !i.seq && !NO_SEQ[i.key]).map(i => i.key);
    expect(missing).toEqual([]);
    for (const k of Object.keys(NO_SEQ)) { expect(GUIDE_KEYS.has(k), k).toBe(true); expect(step(k).seq, k).toBeUndefined(); }
  });

  it('every seq sits on a real step (a typo in the table would silently attach to nothing)', () => {
    expect(withSeq.length).toBe(65);
    for (const i of withSeq) expect(i.seq.length, i.key).toBeGreaterThan(0);
  });

  it('the old fields are all still there: seq adds, nothing was deleted', () => {
    for (const i of withSeq) {
      // A step that had phrases keeps them, and the chain keeps its story and hand-ins.
      if (step(i.key).says) expect(step(i.key).says.length, i.key).toBeGreaterThan(0);
    }
    expect(step('flag_askr').says.map(s => s.text)).toEqual(['it was me', 'paying attention', 'continue', 'bastion of thunder']);
    expect(step('start_traveler_manual').chain.handins.length).toBe(10);
    expect(STEP_MORE.flag_askr.turnIn.length).toBe(3);
  });

  it('no phrase the guide already had was dropped from its seq (renames are listed)', () => {
    // The guide worded these for a person; the seq uses the script's own keyword.
    const RENAMED = { 'what lore': 'lore', 'what information': 'information' };
    for (const i of withSeq) {
      const said = new Set(i.seq.filter(a => a.kind === 'say').map(a => a.text.toLowerCase()));
      const hailed = i.seq.some(a => a.kind === 'hail');
      for (const s of i.says ?? []) {
        const lc = s.text.toLowerCase();
        const ok = said.has(lc) || said.has(RENAMED[lc]) || (lc === 'hail' && hailed);
        expect(ok, `${i.key}: “${s.text}” is in says[] but not in seq`).toBe(true);
      }
    }
  });
});

describe('every act: a kind, a script it was read from, and the words the script listens for', () => {
  const acts = withSeq.flatMap(i => i.seq.map((a, n) => ({ key: i.key, n, a })));

  it('has a known kind, a src that is a real script, and the fields its kind needs', () => {
    expect(acts.length).toBe(313);
    for (const { key, n, a } of acts) {
      const at = `${key}[${n}] ${a.kind}`;
      expect(KINDS, at).toContain(a.kind);
      expect(a.src, `${at} has no src`).toBeTruthy();
      expect(SCRIPTS.has(a.src), `${at}: ${a.src} is not a script the snapshot has`).toBe(true);
      if (a.kind === 'hail' || a.kind === 'kill' || a.kind === 'click' || a.kind === 'zone' || a.kind === 'say' || a.kind === 'give') expect(a.to, `${at} has no to`).toBeTruthy();
      if (a.kind === 'say' || a.kind === 'zone' || a.kind === 'wait' || a.kind === 'note') expect(a.text?.trim(), `${at} has no text`).toBeTruthy();
      if (a.kind === 'give') expect(a.items?.length, `${at} gives nothing`).toBeGreaterThan(0);
      if (a.kind === 'get') expect(!!(a.items?.length || a.text), `${at} gets nothing`).toBe(true);
      if (a.sit !== undefined || a.times !== undefined || a.until !== undefined) expect(a.kind, `${at}: sit/times/until belong to say`).toBe('say');
      if (a.times !== undefined) expect(Number.isInteger(a.times) && a.times >= 2, `${at}: times`).toBe(true);
      if (a.items) expect(['give', 'get', 'click', 'note'], `${at}: items`).toContain(a.kind);
    }
  });

  it('a say is one of its script’s own keywords (or a phrase that contains them, listed on purpose)', () => {
    const says = acts.filter(x => x.a.kind === 'say');
    expect(says.length).toBeGreaterThan(55);
    for (const { key, n, a } of says) {
      expect(a.text.startsWith('/'), `${key}[${n}]`).toBe(false);
      expect(/\bdelete\b/i.test(a.text), `${key}[${n}]`).toBe(false);
      expect(KW[a.src], `${key}[${n}]: ${a.src} has no keyword snapshot`).toBeTruthy();
      expect(sayOk(a), `${key}[${n}]: “${a.text}” is not a keyword of ${a.src}`).toBe(true);
    }
  });

  it('a hail is cited to a script that answers "hail"', () => {
    const hails = acts.filter(x => x.a.kind === 'hail');
    expect(hails.length).toBeGreaterThan(40);
    for (const { key, n, a } of hails) {
      expect(KW[a.src]?.map(k => k.toLowerCase()), `${key}[${n}]: ${a.src}`).toContain('hail');
    }
  });

  it('a get never follows a note directly (the page draws a get on the row before the note)', () => {
    for (const i of withSeq) {
      i.seq.forEach((a, n) => { if (a.kind === 'get' && n > 0) expect(i.seq[n - 1].kind, `${i.key}[${n}]`).not.toBe('note'); });
    }
  });

  it('every item token names a real item id and its real name', () => {
    let seen = 0;
    for (const { key, n, a } of acts) {
      for (const t of a.items ?? []) {
        const m = TOKEN.exec(t);
        expect(m, `${key}[${n}] ${t} is not a [[Name#id]] token`).toBeTruthy();
        const id = Number(m[2]);
        expect(ITEMS[id], `${key}[${n}]: item ${id} (${m[1]}) is not in the snapshot`).toBeTruthy();
        expect(noApos(m[1]), `${key}[${n}] item ${id}`).toBe(noApos(ITEMS[id]));
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(120);
    // The snapshot holds no id the data does not use (so a removed item shrinks it too).
    const used = new Set(acts.flatMap(x => (x.a.items ?? []).map(t => Number(TOKEN.exec(t)[2]))));
    expect([...used].sort((a, b) => a - b)).toEqual(Object.keys(ITEMS).map(Number).sort((a, b) => a - b));
  });

  it('the item cards load for every seq item, including ones no title or detail names', () => {
    const ids = guideItemIds();
    for (const id of Object.keys(ITEMS).map(Number)) expect(ids, String(id)).toContain(id);
    expect(ids).toContain(13400);    // Black Tome with Silver Runes: only the books hand-in names it
    expect(ids).toContain(11486);    // the head Askr hands back
  });
});

describe('the model case: Askr the Lost (postorms/Askr_the_Lost.lua is a state machine)', () => {
  const s = step('flag_askr').seq;
  const brief = (a) => [a.kind, a.text ?? a.to ?? '', a.times ?? 1];

  it('head, "it was me", "paying attention", "continue" TWICE for the bag, the three parts, the sealed bag, "bastion of thunder", the medallions, the meld; the shrine is the next step', () => {
    const rows = seqRows(s).rows.map(r => [r.act.kind, r.act.kind === 'say' ? r.act.text : r.act.to, r.act.times ?? 1]);
    expect(rows).toEqual([
      ['give', 'Askr the Lost', 1],
      ['say', 'it was me', 1],
      ['say', 'paying attention', 1],
      ['say', 'continue', 2],
      ['click', 'Combine', 1],
      ['give', 'Askr the Lost', 1],
      ['say', 'bastion of thunder', 1],
      ['click', 'Combine', 1],
      ['give', 'Askr the Lost', 1],
    ]);
    expect(brief(s.find(a => a.text === 'continue'))).toEqual(['say', 'continue', 2]);
  });

  it('the second "continue" is what gives the bag, and the conversation-reset caveat hangs under that row', () => {
    const r = seqRows(s).rows;
    const cont = r.find(x => x.act.text === 'continue');
    expect(cont.gets.map(g => g.items)).toEqual([['[[Askr’s Bag of Verity#17192]]']]);
    expect(cont.notes[0].text).toMatch(/leave the zone.*resets.*hail him once.*“continue” twice/);
  });

  it('the first hand-in is any camp’s head (28749) and he hands a head back that will not work again (11486)', () => {
    expect(s[0].items).toEqual(['[[Storm Giant Head#28749]]']);
    expect(seqRows(s).rows[0].gets[0].items).toEqual(['[[Storm Giant Head#11486]]']);
  });

  // The guild lead, 2026-10-03: "the flagging for bastion of thunder REQUIRES you to enter the zone from plane
  // of storms after doing the turnin". The meld is karana 2; the shrine click (storms_zone_bot) is karana 3.
  it('it ENDS by saying the meld is not the Bastion flag: the shrine click is, and the flag sits on that step', () => {
    const last = s[s.length - 1];
    expect(last.kind).toBe('note');
    expect(last.src).toBe('postorms/player.lua');
    expect(last.text).toMatch(/not your Bastion of Thunder flag yet: the shrine click in the next step is/);
    expect(last.text).toMatch(/AND your Justice flag/);
    expect(step('flag_askr').flag).toBeUndefined();
    expect(step('storms_zone_bot').flag).toBe('askr_quest');
  });

  it('each hand-in comes before the flag it earns and the medallion/meld hand-ins come last', () => {
    const kinds = seqRows(s).rows.map(r => r.act.kind);
    expect(kinds.filter(k => k === 'give').length).toBe(3);
    expect(kinds.lastIndexOf('give')).toBe(kinds.length - 1);
    expect(kinds).not.toContain('zone');
  });
});

describe('other steps where the order, a repeat or a loop is the point', () => {
  it('Sage Balic: "your research", then "continue" twice for the box', () => {
    const rows = seqRows(step('pok_sage_research').seq).rows;
    expect(rows.slice(0, 2).map(r => [r.act.text, r.act.times ?? 1])).toEqual([['your research', 1], ['continue', 2]]);
    expect(rows[1].gets[0].items).toEqual(['[[Sage’s Box of Research#17176]]']);
  });

  it('the Seer: sit, then "unlock my memories" until nothing new; Maelin: Hail, lore, information; then back to the Seer', () => {
    const s = step('start_flag_fixers').seq;
    const unlock = s.find(a => a.text === 'unlock my memories');
    expect(unlock).toMatchObject({ kind: 'say', sit: true, until: 'she has nothing new to unlock' });
    expect(s.filter(a => a.sit).map(a => a.text)).toEqual(['guided meditation', 'unlock my memories']);
    const maelin = s.filter(a => a.to === 'Grand Librarian Maelin').map(a => a.kind === 'hail' ? 'Hail' : a.text);
    expect(maelin).toEqual(['Hail', 'lore', 'information']);
    expect(seqRows(s).rows.at(-1).notes[0].text).toMatch(/back to the Seer.*back and forth/);
    // The same repeat after the Zeks.
    expect(step('tactics_maelin_after').seq.find(a => a.sit)).toMatchObject({ until: 'she has nothing new to unlock' });
  });

  it('the hedge maze: ready outside, ready inside, the boss, the shard in, the dagger out, the wait, the hail, then the portal click', () => {
    const rows = seqRows(step('flag_hedge').seq).rows.map(r => `${r.act.kind}:${r.act.kind === 'say' || r.act.kind === 'wait' ? r.act.text : r.act.to}`);
    expect(rows).toEqual([
      'hail:Thelin Poxbourne (outside the maze)', 'say:dagger', 'say:help', 'say:ready',
      'hail:Thelin (inside the dream)', 'say:ready',
      'kill:the boss at the end of the maze',
      'give:Thelin (inside the dream)',
      'wait:Thelin and Terris Thule to finish talking',
      'hail:Thelin (after he and Terris have talked)',
      'zone:the portal to the Lair of Terris Thule',
    ]);
    const give = seqRows(step('flag_hedge').seq).rows.find(r => r.act.kind === 'give');
    expect(give.act.items).toEqual(['[[Dagger Blade Shard#9258]]']);
    expect(give.gets[0].items).toEqual(['[[Thelin’s Dagger#9259]]']);
  });

  it('the Halls of Honor trials: hail/ready to start, the trial, then the hail after the win', () => {
    for (const k of ['hoh_trial_dragon', 'hoh_trial_villagers', 'hoh_trial_villager']) {
      const a = step(k).seq;
      expect(a[0].to, k).toMatch(/to start the trial/);
      const lastHail = a.filter(x => x.kind === 'hail').at(-1);
      expect(lastHail.to, k).toMatch(/after the win/);
      expect(a.findIndex(x => x.text === 'ready'), k).toBeLessThan(a.indexOf(lastHail));
    }
  });

  it('Willamina’s Needles: the seq’s hand-ins are the chain’s hand-ins, in the same order', () => {
    const s = step('start_traveler_manual');
    const gives = s.seq.filter(a => a.kind === 'give');
    expect(gives.map(a => a.items[0])).toEqual(s.chain.handins.map(h => h.give));
    const gets = seqRows(s.seq).rows.filter(r => r.act.kind === 'give').map(r => r.gets[0].items[0]);
    expect(gets).toEqual(s.chain.handins.map(h => h.get));
    expect(gives.map(a => a.to)).toEqual(s.chain.handins.map(h => h.at.npc));
  });

  it('Nitram’s trade is all three parts in ONE give, then the kill, then the hail for the flag, then the door', () => {
    const rows = seqRows(step('innovation_door_key').seq).rows;
    const give = rows.find(r => r.act.kind === 'give');
    expect(give.act.items).toEqual(['[[Copper Node#9295]]', '[[Bundle of Super Conductive Wires#9426]]', '[[Intact Power Cell#9434]]']);
    const order = rows.map(r => r.act.kind);
    expect(order.indexOf('give')).toBeLessThan(order.indexOf('kill'));
    expect(order.indexOf('kill')).toBeLessThan(order.lastIndexOf('hail'));
    expect(order.lastIndexOf('hail')).toBeLessThan(order.indexOf('click'));
  });

  it('the Justice arc is in the order each NPC needs, and the flag is the Mavuin hail’s', () => {
    expect(step('justice_mavuin_info').seq[0]).toMatchObject({ kind: 'say', text: 'information', src: 'pojustice/#Mavuin.lua' });
    expect(step('justice_tribunal').seq.find(a => a.kind === 'say')).toMatchObject({ text: 'mavuin sent me', src: 'pojustice/The_Tribunal.lua' });
    expect(step('justice_mavuin_hail').seq[0]).toMatchObject({ kind: 'hail', to: 'Mavuin' });
    expect(step('justice_mavuin_hail').flag).toBe('trial_justice');
    expect(step('flag_trial_justice').flag).toBeUndefined();
    expect(POP_FLAGS.trial_justice).toBeTruthy();
    const flags = GUIDE_ITEMS.map(i => i.flag).filter(Boolean);
    expect(new Set(flags).size).toBe(flags.length);
  });

  it('boss steps are kill, then the hail that flags you; the four elemental gods name Essence of …, not A Planar Projection', () => {
    for (const [k, ess] of [['flag_fennin', 'Essence of Fire'], ['flag_xegony', 'Essence of Air'], ['flag_coirnav', 'Essence of Water'], ['flag_rathe', 'Essence of Earth']]) {
      const s = step(k).seq;
      expect(s.map(a => a.kind), k).toEqual(['kill', 'hail', 'get']);
      expect(s[1].to, k).toBe(ess);
      expect(step(k).detail, k).toContain(`Hail ${ess}`);
      expect(step(k).detail, k).not.toContain('A Planar Projection');
    }
    for (const k of ['flag_grummus', 'flag_tthule', 'flag_bert', 'flag_saryrn', 'flag_marr', 'flag_vallon', 'flag_tallon', 'flag_rallos', 'flag_aerindar', 'flag_solro', 'flag_arbitor']) {
      const s = step(k).seq;
      const kill = s.findIndex(a => a.kind === 'kill');
      const hail = s.findIndex(a => a.kind === 'hail');
      expect(kill, k).toBeGreaterThanOrEqual(0);
      expect(hail, k).toBeGreaterThan(kill);
      expect(s[hail].to, k).toBe('A Planar Projection');
    }
  });
});

describe('flags finished by a click or a zone-in, not by an NPC', () => {
  // step → the script whose door or zone event sets the flag. Each is the LAST act of its step.
  const ZONE = {
    storms_zone_bot: 'postorms/player.lua', valor_zone_hoh: 'povalor/player.lua',
    hoh_trial_villager: 'hohonora/player.lua', flag_hedge: 'ponightmare/player.lua', flag_grummus: 'podisease/player.lua',
    flag_arbitor: 'poeartha/player.lua', time_muon: 'poinnovation/player.lua', flag_solro: 'solrotower/player.lua',
    justice_mavuin_hail: 'potranquility/player.lua', nightmare_poxbourne: 'potranquility/player.lua',
    cod_fuirstel_after: 'potranquility/player.lua', flag_behemoth: 'potranquility/player.lua',
    zeks_maelin: 'potranquility/player.lua', zebuxoruk_maelin: 'potranquility/player.lua',
  };

  it('each step ends on exactly one zone act, cited to the player script that sets the flag', () => {
    for (const [k, src] of Object.entries(ZONE)) {
      const zs = step(k).seq.filter(a => a.kind === 'zone');
      expect(zs.length, k).toBe(1);
      expect(zs[0].src, k).toBe(src);
      expect(step(k).seq.at(-1).kind, k).toBe('zone');
      expect(zs[0].text.trim().length, k).toBeGreaterThan(20);   // it says what the click needs
    }
  });

  it('no other step has a zone act (a new one has to be added above, with its script)', () => {
    const have = withSeq.filter(i => i.seq.some(a => a.kind === 'zone')).map(i => i.key).sort();
    expect(have).toEqual(Object.keys(ZONE).sort());
  });
});

describe('seqRows: the numbered rows a page draws', () => {
  const A = (kind, extra = {}) => ({ kind, src: 'x/y.lua', ...extra });
  it('numbers every act except a get (it rides on the row before) and a note (it hangs under it)', () => {
    const { lead, rows } = seqRows([
      A('note', { text: 'before anything' }),
      A('hail', { to: 'Aldenmar' }),
      A('say', { to: 'Aldenmar', text: 'lore' }),
      A('get', { text: 'a flag' }),
      A('get', { text: 'and a coin' }),
      A('note', { text: 'a caveat' }),
      A('give', { to: 'Brackwyn', items: ['[[Thing#1]]'] }),
      A('get', { items: ['[[Other#2]]'] }),
    ]);
    expect(lead.map(a => a.text)).toEqual(['before anything']);
    expect(rows.map(r => [r.n, r.act.kind, r.gets.length, r.notes.length])).toEqual([[1, 'hail', 0, 0], [2, 'say', 2, 1], [3, 'give', 1, 0]]);
  });

  it('a get with nothing before it is a row of its own, and an empty seq is empty', () => {
    expect(seqRows([A('get', { text: 'from the floor' }), A('give', { to: 'Corvale' })]).rows.map(r => [r.n, r.act.kind])).toEqual([[1, 'get'], [2, 'give']]);
    expect(seqRows([])).toEqual({ lead: [], rows: [] });
  });

  it('the real data: the first act of the traveler chain is the pick-up, and notes never get a number', () => {
    const rows = seqRows(step('start_traveler_manual').seq);
    expect(rows.rows[0].act.kind).toBe('get');
    expect(rows.rows[0].notes.length).toBe(1);
    expect(rows.rows.length).toBe(11);   // pick-up + ten give rows
    for (const i of withSeq) for (const r of seqRows(i.seq).rows) expect(r.act.kind, i.key).not.toBe('note');
  });
});

describe('the page draws a seq where it has one, and falls back to the pieces where it does not', () => {
  const checklist = stripJs(readSource(path.join(ROOT, 'web', 'app', 'pop', 'guide', 'GuideChecklist.tsx')));
  const route = stripJs(readSource(path.join(ROOT, 'web', 'app', 'pop', 'guide', 'GuideRoute.tsx')));

  it('the default view draws SeqView for a step with a seq and keeps the old says chips as the fallback', () => {
    expect(checklist).toMatch(/item\.seq && item\.seq\.length > 0 \? <SeqView seq=\{item\.seq\} cards=\{cards\} \/> : item\.says/);
    expect(checklist).toContain('{item.says.map((s, n) => (');                      // the fallback is still there
    expect(checklist).toMatch(/<ChainView chain=\{item\.chain\} cards=\{cards\} skipHandins=\{!!item\.seq\} \/>/);
    expect(checklist).toContain('{!skipHandins && (');                              // a chain's hand-ins are not drawn twice
  });

  it('SeqView takes its rows from seqRows and draws copy chips, item cards, ×N and "repeat until"', () => {
    expect(checklist).toContain('const { lead, rows } = seqRows(seq);');
    expect(checklist).toContain('<CopyChip text={sayCommand({ text: act.text ?? \'\' })} />');
    expect(checklist).toContain('<CopyChip text="/sit" />');
    expect(checklist).toContain('×{act.times}');
    expect(checklist).toContain('repeat until {act.until}');
    expect(checklist).toMatch(/<WithItems text=\{ITEM_NAMES\(act\.items\)\} cards=\{cards\} \/>/);   // item names go through the item cards
    expect(checklist).toContain('→ </span><span className="text-dim">get</span>');                       // "Give … → get …"
    expect(checklist).toContain('Zone in:');
  });

  it('the beta layouts draw it in "What to do, in order" in place of What to say and Who takes what', () => {
    expect(route).toContain('const hasSeq = !!item.seq && item.seq.length > 0;');
    expect(route).toContain('<SeqView seq={item.seq!} cards={cards} />');
    expect(route).toContain('What to do, in order');
    expect(route).toContain('{!hasSeq && item.says && item.says.length > 0 && (');
    expect(route).toContain('{!hasSeq && more?.turnIn && more.turnIn.length > 0 && (');
    expect(route).toContain('<ChainView chain={item.chain} cards={cards} skipHandins={hasSeq} />');
    expect(route).toMatch(/import \{[^}]*SeqView[^}]*\} from '\.\/GuideChecklist'/);
  });
});
