// test/dispel-watch.test.js — "Your debuff was dispelled off <mob> — recast" and "Buffs dispelled — rebuff".
//
// The guild lead, 2026-10-23, mid-raid in the Tower of Solusek Ro: "We should also start watching for buffs to be
// dispelled off of mobs. When the caster's debuff was dispelled or buff, it tells them that it was dispelled."
// Rizlona sends herself home and casts spell 2830, Annul Self, which strips her debuffs.
//
// EVERY LINE BELOW IS A SERVER LINE, not a guess (SecretsOTheP/EQMacEmu a3b80b2, zone/):
//   "Your <spell> spell has worn off."     SPELL_WORN_OFF, string 437 (string_ids.h:175), sent to the CASTER of a
//                                          detrimental, non-lull spell when it fades (spell_effects.cpp:3712-3743).
//                                          Expiry, a dispel and an overwrite all print it; it names no mob.
//   "<mob> has been dispelled."            Annul Self's cast_on_other (eqemu_spells 2830; quests solrotower/Rizlona.lua:20)
//   "You feel very dispelled." etc.        a dispel spell's cast_on_you (eqemu_spells, SPA 27)
//   "Your aegolism fades." / "The cool breeze fades."   a buff's own spell_fades (Aegolism / Clarity)
//   "LOADING, PLEASE WAIT..." / "You have entered <zone>." / "You died."   the zone and death lines the agent already reads
// A leash reset and a death fade every buff with message = false (spells.cpp:3643), so they print NOTHING; the tests
// for them are tests that nothing happens.
//
// The REAL agent is driven (require): lines in through noteDispelLine, Zeal buff slots in through _dispelNoteZealDiff,
// the clock is handed to flushDispelWatch, and the callout is what _pushOverlay queued.
//
// Run: npx vitest run test/dispel-watch.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Brackwyn';
const OTHER = 'Corvale';
const RIZ = 'Rizlona';
const T0 = new Date('Fri Oct 23 21:10:00 2026').getTime();
const pad = (n) => String(n).padStart(2, '0');
// A log line `sec` seconds after T0 (inside one minute, so the format stays trivial).
const ln = (sec, msg) => `[Fri Oct 23 21:10:${pad(sec)} 2026] ${msg}`;
const at = (sec) => T0 + sec * 1000;
const feed = (sec, msg, who = ME) => agent.noteDispelLine(ln(sec, msg), who, at(sec));
const flush = (sec) => agent.flushDispelWatch(at(sec));
const fires = () => agent._activeOverlays.filter(o => o.scope === 'dispel');

// A debuff of `by`'s on `mob`, with `remSecs` left at T0 (the moment the worn-off line prints).
function land(mob, spell, { by = ME, remSecs = 80, totalSecs = 90 } = {}) {
  const tk = mob.toLowerCase();
  let mp = agent._buffLandingsByTarget.get(tk);
  if (!mp) { mp = new Map(); agent._buffLandingsByTarget.set(tk, mp); }
  mp.set(spell.toLowerCase(), {
    name: spell, dur_ticks: totalSecs / 6, landed_at: T0 + remSecs * 1000 - totalSecs * 1000,
    cast_by: by, target_name: mob, target_id: null,
  });
}
const onMob = (mob) => [...(agent._buffLandingsByTarget.get(mob.toLowerCase()) || new Map()).keys()];
const wornOff = (sec, spell, who) => feed(sec, `Your ${spell} spell has worn off.`, who);

const CATALOG = [
  { id: 174, name: 'Clarity', good: 1, fades: 'The cool breeze fades.' },
  { id: 1447, name: 'Aegolism', good: 1, fades: 'Your aegolism fades.' },
  { id: 3467, name: 'Virtue', good: 1, fades: 'Your virtue fades.' },
  { id: 2830, name: 'Annul Self', good: 1, other: 'has been dispelled.' },
];
const buff = (name, ticks = 40, extra = {}) => ({ name, ticks, ...extra });
const zeal = (buffs, zone = 12) => ({ buffs, zone });

beforeEach(() => {
  agent._setSpellCatalogForTest(CATALOG);
  agent._setAgentPrefsForTest({});
  agent._buffLandingsByTarget.clear();
  agent._activeOverlays.length = 0;
  for (const m of Object.values(agent._dispelState)) m.clear();
  agent._dispelGone.clear();
  for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k];
});
afterEach(() => {
  agent._setSpellCatalogForTest([]);
  agent._setAgentPrefsForTest({});
  for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k];
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('your debuffs, dispelled off a mob', () => {
  it('Annul Self strips three of your debuffs: each is forgotten and ONE callout lists them', () => {
    land(RIZ, 'Malosini'); land(RIZ, 'Tashanian'); land(RIZ, "Turgur's Insects");
    feed(0, `${RIZ} has been dispelled.`);
    wornOff(0, 'Malosini'); wornOff(0, 'Tashanian'); wornOff(1, "Turgur's Insects");
    flush(2);
    expect(fires()).toHaveLength(0);                  // still inside the settle window
    flush(4);
    const f = fires();
    expect(f).toHaveLength(1);
    expect(f[0].text).toBe("Dispelled off Rizlona: Malosini, Tashanian, Turgur's Insects — recast");
    expect(f[0].tts).toContain('Recast');
    expect(f[0]).toMatchObject({ trigger: 'Debuff dispelled', rule_key: 'builtin:dispel_debuff', rule_char: 'brackwyn', color: 'amber' });
    expect(onMob(RIZ)).toEqual([]);                    // Target Info / Mob Info stop showing them
    expect(agent.targetBuffsFor('rizlona')).toEqual([]);
  });

  it('one debuff and the dispel line: the single-spell wording, names the mob', () => {
    land(RIZ, 'Malosini'); land(RIZ, 'Tashanian', { remSecs: 70 });
    wornOff(0, 'Malosini'); feed(0, `${RIZ} has been dispelled.`);   // either order
    flush(4);
    expect(fires().map(o => o.text)).toEqual(['Your Malosini was dispelled off Rizlona — recast']);
    expect(onMob(RIZ)).toEqual(['tashanian']);        // the one that was not stripped stays
  });

  it('every caster is told about their OWN debuff (each Mimic reads its own log)', () => {
    land(RIZ, 'Malosini', { by: ME }); land(RIZ, 'Tashanian', { by: OTHER });
    feed(0, `${RIZ} has been dispelled.`, ME);   wornOff(0, 'Malosini', ME);
    feed(0, `${RIZ} has been dispelled.`, OTHER); wornOff(1, 'Tashanian', OTHER);
    flush(4);
    const f = fires();
    expect(f.map(o => [o.rule_char, o.text]).sort()).toEqual([
      ['brackwyn', 'Your Malosini was dispelled off Rizlona — recast'],
      ['corvale', 'Your Tashanian was dispelled off Rizlona — recast'],
    ]);
    expect(onMob(RIZ)).toEqual([]);
  });

  it('a multi-word mob is named whole', () => {
    land('a glyph covered serpent', 'Malosini');
    feed(0, 'a glyph covered serpent feels dispelled.'); wornOff(0, 'Malosini');
    flush(4);
    expect(fires()[0].text).toBe('Your Malosini was dispelled off a glyph covered serpent — recast');
  });

  it('a dispel of ANOTHER mob does not take this mob\'s debuff as evidence', () => {
    land(RIZ, 'Malosini');
    feed(0, 'a gnoll warlord has been dispelled.'); wornOff(0, 'Malosini');
    flush(4);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini']);
  });

  it('two mobs dispelled at once (an add and the boss): the callout names the one that carried your debuff', () => {
    land(RIZ, 'Malosini');
    feed(0, 'a gnoll warlord has been dispelled.'); feed(0, `${RIZ} has been dispelled.`);
    wornOff(0, 'Malosini');
    flush(4);
    expect(fires().map(o => o.text)).toEqual(['Your Malosini was dispelled off Rizlona — recast']);
  });

  it('the relayed copy of the dispelled debuff stays hidden; a recast shows again', () => {
    land(RIZ, 'Malosini');
    feed(0, `${RIZ} has been dispelled.`); wornOff(0, 'Malosini'); flush(4);
    expect(agent._dispelGoneCovers('rizlona', 'malosini', at(-30))).toBe(true);    // landed before the dispel
    expect(agent._dispelGoneCovers('rizlona', 'malosini', at(20))).toBe(false);    // landed after: a recast
    expect(agent._dispelGoneCovers('rizlona', 'tashanian', at(-30))).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('what is NOT a dispel', () => {
  it('normal expiry: the debuff had run its course', () => {
    land(RIZ, 'Malosini', { remSecs: 3 });
    wornOff(0, 'Malosini');
    feed(0, `${RIZ} has been dispelled.`);          // even with a dispel line near: it was due to end
    flush(4);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini']);
  });

  it('an older copy that ended on time explains the line, so a newer copy on another mob is left alone', () => {
    land('a gnoll warlord', 'Malosini', { remSecs: -2 });
    land(RIZ, 'Malosini', { remSecs: 80 });
    wornOff(0, 'Malosini'); feed(0, `${RIZ} has been dispelled.`);
    flush(4);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini']);
  });

  it('one early removal and no dispel line (a stronger spell overwrote it): nothing', () => {
    land(RIZ, 'Malosini');
    wornOff(0, 'Malosini');
    flush(6);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini']);
  });

  it('two early removals three seconds apart are two events, not a dispel', () => {
    land(RIZ, 'Malosini'); land(RIZ, 'Tashanian');
    wornOff(0, 'Malosini'); wornOff(3, 'Tashanian');
    flush(8);
    expect(fires()).toHaveLength(0);
  });

  it('two early removals inside a second ARE a dispel even if the dispel line was out of range', () => {
    land(RIZ, 'Malosini'); land(RIZ, 'Tashanian');
    wornOff(0, 'Malosini'); wornOff(1, 'Tashanian');
    flush(4);
    expect(fires().map(o => o.text)).toEqual(['Dispelled off Rizlona: Malosini, Tashanian — recast']);
    expect(onMob(RIZ)).toEqual([]);
  });

  it('zoning: the lines that follow a zone change count for nothing', () => {
    land(RIZ, 'Malosini'); land(RIZ, 'Tashanian');
    feed(0, 'LOADING, PLEASE WAIT...');
    feed(2, 'You have entered Plane of Knowledge.');
    wornOff(3, 'Malosini'); wornOff(3, 'Tashanian'); feed(3, `${RIZ} has been dispelled.`);
    flush(8);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini', 'tashanian']);
  });

  it('zoning drops what was already waiting', () => {
    land(RIZ, 'Malosini'); land(RIZ, 'Tashanian');
    wornOff(0, 'Malosini'); wornOff(0, 'Tashanian');
    feed(1, 'LOADING, PLEASE WAIT...');
    flush(6);
    expect(fires()).toHaveLength(0);
  });

  it('a mob that dies or goes home prints no worn-off line at all (BuffFadeAll is silent): nothing to say', () => {
    land(RIZ, 'Malosini'); land(RIZ, 'Tashanian');
    feed(0, `${RIZ} has been slain by Aldenmar!`);
    flush(8);
    expect(fires()).toHaveLength(0);
  });

  it('a debuff someone ELSE cast is not yours to be told about', () => {
    land(RIZ, 'Malosini', { by: OTHER });
    feed(0, `${RIZ} has been dispelled.`); wornOff(0, 'Malosini');
    flush(4);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini']);
  });

  it('a pet\'s spell wearing off is not yours', () => {
    land(RIZ, 'Malosini');
    feed(0, `${RIZ} has been dispelled.`); feed(0, "Your pet's Malosini spell has worn off.");
    flush(4);
    expect(fires()).toHaveLength(0);
  });

  it('a log being replayed (lines far older than now) changes nothing', () => {
    land(RIZ, 'Malosini');
    agent.noteDispelLine(ln(0, `${RIZ} has been dispelled.`), ME, at(0) + 3_600_000);
    agent.noteDispelLine(ln(0, 'Your Malosini spell has worn off.'), ME, at(0) + 3_600_000);
    agent.flushDispelWatch(at(0) + 3_700_000);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini']);
  });

  it('an unrecognised line, a plain buff fade and noise do nothing', () => {
    for (const m of ['You feel stronger.', 'Your aegolism fades.', 'a gnoll warlord has been mesmerized.', 'Rizlona is immolated by flame.']) feed(0, m);
    flush(6);
    expect(fires()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('your buffs, dispelled by a mob', () => {
  const diff = (sec, prev, next, who = ME) => agent._dispelNoteZealDiff(who, prev, next, at(sec));

  it('a dispel cast on you and the slots lose buffs: ONE callout naming them, then it is rate-limited', () => {
    feed(0, 'You feel very dispelled.');
    diff(1, zeal([buff('Aegolism'), buff('Clarity'), buff('Spirit of Wolf')]), zeal([buff('Spirit of Wolf')]));
    flush(5);
    const f = fires();
    expect(f).toHaveLength(1);
    expect(f[0].text).toBe('Buffs dispelled: Aegolism, Clarity — rebuff');
    expect(f[0]).toMatchObject({ trigger: 'Buffs dispelled', rule_key: 'builtin:dispel_buffs', rule_char: 'brackwyn' });
    // a second dispel inside the cooldown is the same event to the player
    feed(6, 'You feel very dispelled.');
    diff(6, zeal([buff('Spirit of Wolf')]), zeal([buff('Other')]));
    diff(7, zeal([buff('Virtue')]), zeal([buff('Other')]));
    flush(10);
    expect(fires()).toHaveLength(1);
  });

  it('a single buff stripped counts when the dispel line is there', () => {
    feed(0, 'Your enchantments fade.');
    diff(0, zeal([buff('Virtue'), buff('Spirit of Wolf')]), zeal([buff('Spirit of Wolf')]));
    flush(5);
    expect(fires().map(o => o.text)).toEqual(['Buffs dispelled: Virtue — rebuff']);
  });

  it('two buffs gone in the same poll with no dispel line still counts (several early removals at once)', () => {
    diff(0, zeal([buff('Aegolism'), buff('Clarity'), buff('Spirit of Wolf')]), zeal([buff('Spirit of Wolf')]));
    flush(5);
    expect(fires().map(o => o.text)).toEqual(['Buffs dispelled: Aegolism, Clarity — rebuff']);
  });

  it('one buff gone and no dispel line is not a dispel', () => {
    diff(0, zeal([buff('Aegolism'), buff('Spirit of Wolf')]), zeal([buff('Spirit of Wolf')]));
    flush(5);
    expect(fires()).toHaveLength(0);
  });

  it('normal expiry: buffs a tick from the end are not early', () => {
    diff(0, zeal([buff('Aegolism', 1), buff('Clarity', 2), buff('Spirit of Wolf')]), zeal([buff('Spirit of Wolf')]));
    flush(5);
    expect(fires()).toHaveLength(0);
  });

  it('zoning: a different zone in the next poll is not a dispel', () => {
    diff(0, zeal([buff('Aegolism'), buff('Clarity'), buff('Spirit of Wolf')], 12), zeal([buff('Spirit of Wolf')], 202));
    flush(9);
    expect(fires()).toHaveLength(0);
  });
  it('an empty list (a zone gap or a dropped pipe) is not a dispel', () => {
    diff(0, zeal([buff('Aegolism'), buff('Clarity')]), zeal([]));
    flush(9);
    expect(fires()).toHaveLength(0);
  });
  it('dying: the buffs that go with the character, and the ones after the "You died." line, are not dispels', () => {
    feed(0, 'You died.');
    diff(2, zeal([buff('Aegolism'), buff('Clarity'), buff('Virtue')]), zeal([buff('Virtue')]));
    flush(9);
    expect(fires()).toHaveLength(0);
    feed(1, 'You feel very dispelled.');    // inside the quiet window: ignored too
    diff(3, zeal([buff('Aegolism'), buff('Virtue')]), zeal([buff('Virtue')]));
    flush(9);
    expect(fires()).toHaveLength(0);
  });

  it('a stronger buff landing in the same poll that pushed two out is a replacement, not a dispel', () => {
    diff(0, zeal([buff('Aegolism'), buff('Clarity')]), zeal([buff('Virtue')]));
    flush(5);
    expect(fires()).toHaveLength(0);
  });

  it('bard songs rotate and are never counted', () => {
    diff(0, zeal([buff('Selo\'s Accelerando', 40, { song: true }), buff('Chorus of Marr', 40, { song: true }), buff('Aegolism')]), zeal([buff('Aegolism')]));
    flush(5);
    expect(fires()).toHaveLength(0);
  });

  it('with no Zeal: the dispel line and a beneficial spell\'s fade line is a generic callout', () => {
    feed(0, 'You feel a bit dispelled.');
    feed(1, 'Your aegolism fades.');
    flush(5);
    expect(fires().map(o => o.text)).toEqual(['Buffs dispelled — rebuff']);
  });

  it('with no Zeal: a dispel that stripped nothing says nothing, and a fade with no dispel says nothing', () => {
    feed(0, 'You feel dispelled.');
    feed(20, 'Your aegolism fades.');
    flush(30);
    expect(fires()).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the switch, the rules and the wiring', () => {
  it('off in the Triggers-tab switch: nothing is noted, nothing is said', () => {
    agent._setAgentPrefsForTest({ dispel_watch_off: true });
    expect(agent._dispelWatchEnabled()).toBe(false);
    land(RIZ, 'Malosini');
    feed(0, `${RIZ} has been dispelled.`); wornOff(0, 'Malosini');
    feed(0, 'You feel very dispelled.');
    agent._dispelNoteZealDiff(ME, zeal([buff('Aegolism'), buff('Clarity'), buff('Spirit of Wolf')]), zeal([buff('Spirit of Wolf')]), at(1));
    flush(6);
    expect(fires()).toHaveLength(0);
    expect(onMob(RIZ)).toEqual(['malosini']);
  });
  it('on by default', () => { expect(agent._dispelWatchEnabled()).toBe(true); });

  it('"What you hear" governs both callouts: off is not pushed, overlay only is not spoken', () => {
    // Both are rows of the Voice tab's Built-in callouts group, so a person can set them (the rule itself is set
    // in memory here: _setTriggerRule would write trigger_rules.json into the repo).
    const members = agent._computeRuleGroups().find(g => g.id === 'builtin').members.map(m => m.key);
    expect(members).toEqual(expect.arrayContaining(['builtin:dispel_debuff', 'builtin:dispel_buffs']));
    agent._triggerRules['builtin:dispel_debuff'] = { '*': 'off' };
    agent._triggerRules['builtin:dispel_buffs'] = { '*': 'overlay' };
    land(RIZ, 'Malosini');
    feed(0, `${RIZ} has been dispelled.`); wornOff(0, 'Malosini');
    feed(0, 'You feel very dispelled.');
    agent._dispelNoteZealDiff(ME, zeal([buff('Aegolism'), buff('Clarity')]), zeal([buff('Virtue')]), at(1));
    flush(6);
    const f = fires();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ rule_key: 'builtin:dispel_buffs', mute: true });
  });

  it('the dispel texts are the ones ONLY dispels print', () => {
    for (const shared of ['has been mesmerized.', 'is immolated by flame.', "'s skin freezes.", 'begins to scream.', 'feels slowed.']) {
      expect(agent.DISPEL_OTHER_TEXTS).not.toContain(shared);
    }
    for (const shared of ['You are mesmerized.', 'You are immolated by flame.', 'You feel your skin freeze.', 'You feel stronger.']) {
      expect(agent.DISPEL_YOU_TEXTS.has(shared)).toBe(false);
    }
    expect(agent.DISPEL_OTHER_TEXTS).toContain('has been dispelled.');   // Annul Self 2830
    expect(agent.DISPEL_YOU_TEXTS.has('You feel very dispelled.')).toBe(true);
  });

  it('the live log path reads the line BEFORE the mez handler, and the Zeal diff is wired', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    const a = src.indexOf('noteDispelLine(line, b.character)');
    const b = src.indexOf('noteMyMezWornOff(line, b.character)');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(src).toContain('_dispelNoteZealDiff(character, prevState, st, Date.now())');
    expect(src).toContain('_dispelGoneCovers(tnameLower, k, b.observed_at_ms)');
  });
});
