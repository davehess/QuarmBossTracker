// test/suggested-triggers-more.test.js — more suggested triggers, and the ones
// that could never fire (the guild lead, 2026-10-02: "We need more in suggested triggers,
// like failed feign death and spell resisted <spell name - mob name>").
//
// Every line below is the Quarm server's own text: zone/string_ids.h for the
// server messages (STRING_FEIGNFAILED, TARGET_RESISTED, IMMUNE_ATKSPEED, …) and
// eqemu_spells.cast_on_you for the landings. Each test runs the SHIPPED agent's
// evaluator, so a comment cannot satisfy it. Names are invented.
//
// Run: npx vitest run test/suggested-triggers-more.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Aldenmar';
// NOW, in the log's own format. A fixed date went stale: {mytarget} trusts a "You begin casting"
// line only for 15 s (_myTargetFor), so a constant timestamp passed on the day it was written and
// failed from the next morning on.
const TS = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `[${day} ${mon} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()}] `;
})();
const tpl = (id) => agent.SUGGESTED_TRIGGERS.find(t => t.id === id);
const fromTpl = (id) => agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl(id)));
const fires = (name) => agent._fireLog.filter(f => f.name === name).length;
// A minute apart per fire, so no trigger's own cooldown swallows the next one.
let fireTs = Date.now();
function firesOn(id, msg) {
  const t = fromTpl(id);
  agent._setPersonalTriggersForTest([t]);
  const before = fires(t.name);
  agent.evaluateTriggersAgainstLine(TS + msg, (fireTs += 60_000), ME);
  return fires(t.name) - before;
}
// The alert text a fire would show, through the real capture bag + {mytarget}.
function alertText(id, msg) {
  const t = fromTpl(id);
  const m = t._regex ? t._regex.exec(TS + msg) : agent._catalogTriggerMatch(t.catalog_match, msg);
  const bag = agent._buildCaptureBag(m, TS + msg, {}, t._aliases);
  agent._addMyTarget(t, bag, ME);
  return agent._expandTemplate(t.actions[0].text, bag);
}

const CATALOG = [
  { name: 'Mesmerize', you: 'You are mesmerized.', cc: ['mez'] },
  { name: 'Ensnare', you: 'You are ensnared.', cc: ['snare'] },
  { name: 'Engulfing Roots', you: 'Your feet adhere to the ground.', cc: ['root'] },
  { name: 'Panic the Dead', you: 'You panic.', cc: ['fear'] },
  { name: "Turgur's Insects", you: 'You feel drowsy.', cc: ['slow'] },
  { name: 'Tashanian', you: 'You hear the barking of Tashania.' },
  // A text two spells share, one of them no mez: never a mez landing.
  { name: 'Shared Mez', you: 'Your mind wanders.', cc: ['mez'] },
  { name: 'Shared Plain', you: 'Your mind wanders.' },
];

beforeEach(() => {
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Aldenmar_pq.proj.txt' }]);
  agent._recompilePersonalTriggersForChars();
  agent._setSpellCatalogForTest(CATALOG);
  agent._setZealStateForTest(ME, null);
  agent._setPersonalTriggersForTest([]);
});

describe('Feign Death', () => {
  it('a failed feign — said with your own name — fires; another monk\'s does not', () => {
    expect(firesOn('self_fd_failed', ME + ' has fallen to the ground.')).toBe(1);
    expect(firesOn('self_fd_failed', 'Brackwyn has fallen to the ground.')).toBe(0);
  });
  it('a spell breaking it fires; moving out of it does not', () => {
    expect(firesOn('self_fd_broken', 'You are no longer feigning death, because a spell hit you.')).toBe(1);
    expect(firesOn('self_fd_broken', 'You are no longer feigning death, because you moved.')).toBe(0);
  });
});

describe('a resist names the spell and the mob', () => {
  it('the mob is your target when you began casting it — not the one you switched to', () => {
    agent._setZealStateForTest(ME, { target_name: 'a gnoll warlord', updatedAt: Date.now() });
    agent._meNoteRawLine(TS + 'You begin casting Tashanian.', ME);
    agent._setZealStateForTest(ME, { target_name: 'a gnoll guard', updatedAt: Date.now() });
    expect(alertText('cast_resisted_self', 'Your target resisted the Tashanian spell.'))
      .toBe('RESISTED: Tashanian — a gnoll warlord');
  });
  it('an instant spell has no begin-casting line: your target now', () => {
    agent._setZealStateForTest(ME, { target_name: 'a gnoll guard', updatedAt: Date.now() });
    expect(alertText('cast_resisted_self', 'Your target resisted the Boastful Bellow spell.'))
      .toBe('RESISTED: Boastful Bellow — a gnoll guard');
  });
  it('without Zeal it still reads', () => {
    expect(alertText('cast_resisted_self', 'Your target resisted the Cinder Bolt spell.'))
      .toBe('RESISTED: Cinder Bolt — your target');
  });
  it('a row saved with the old text gets the new one', () => {
    const old = agent._templateToPersonalRow(tpl('cast_resisted_self'));
    old.actions[0].text = 'RESISTED: {1}';
    expect(agent._migrateRetiredSuggestedPattern(old)).toBe(true);
    expect(old.actions[0].text).toBe('RESISTED: {1} — {mytarget}');
  });
});

describe('immunities, range, line of sight, mana, invisibility', () => {
  const cases = [
    ['cast_immune_slow',   'Your target is immune to changes in its attack speed.'],
    ['cast_immune_snare',  'Your target is immune to changes in its run speed.'],
    ['cast_cannot_mez',    'Your target cannot be mesmerized.'],
    ['cast_cannot_mez',    'Your target cannot be mesmerized (with this spell).'],
    ['cast_immune_stun',   'Your target is immune to the stun portion of this effect.'],
    ['cast_cannot_charm',  'Your target is too high of a level for your charm spell.'],
    ['cast_cannot_charm',  'This NPC cannot be charmed.'],
    ['cast_no_los',        'You cannot see your target.'],
    ['cast_out_of_range',  'Your target is out of range, get closer!'],
    ['cast_no_mana',       'Insufficient Mana to cast this spell!'],
    ['self_invis_fading',  'You feel yourself starting to appear.'],
    ['cast_interrupted',   'Your spell is interrupted.'],
    ['cast_fear_off',      'Your fear spell has worn off.'],
  ];
  for (const [id, msg] of cases) {
    it(id + ' fires on "' + msg + '"', () => { expect(firesOn(id, msg)).toBe(1); });
  }
  it('the slow immunity names the mob', () => {
    agent._setZealStateForTest(ME, { target_name: 'a gnoll warlord', updatedAt: Date.now() });
    expect(alertText('cast_immune_slow', 'Your target is immune to changes in its attack speed.'))
      .toBe('IMMUNE TO SLOW — a gnoll warlord');
  });
});

describe('debuffs landing on you — matched by the spell, not a text list', () => {
  it('a mez, a snare, a root and a fear each fire their own trigger', () => {
    expect(firesOn('self_mezzed', 'You are mesmerized.')).toBe(1);
    expect(firesOn('self_snared', 'You are ensnared.')).toBe(1);
    expect(firesOn('self_snared', 'Your feet adhere to the ground.')).toBe(1);
    expect(firesOn('self_feared', 'You panic.')).toBe(1);
  });
  it('a debuff of another kind, and a text a non-mez spell also prints, do not', () => {
    expect(firesOn('self_mezzed', 'You are ensnared.')).toBe(0);
    expect(firesOn('self_mezzed', 'You hear the barking of Tashania.')).toBe(0);
    expect(firesOn('self_mezzed', 'Your mind wanders.')).toBe(0);
  });
  it('the old dead patterns move to matching by the spell when the saved row loads', () => {
    for (const [id, dead] of [['self_snared', '^You have been (?:ensnared|rooted|bound)\\.'],
                              ['self_mezzed', '^You feel (?:calm|charmed)\\.'],
                              ['self_feared', '^You are afraid\\.']]) {
      const row = { ...agent._templateToPersonalRow(tpl(id)), pattern: dead, catalog_match: undefined };
      expect(agent._migrateRetiredSuggestedPattern(row)).toBe(true);
      expect(row.pattern).toBe('');
      expect(row.catalog_match).toEqual(tpl(id).catalog_match);
    }
    const intr = { ...agent._templateToPersonalRow(tpl('cast_interrupted')), pattern: '^Your (?:spell|target) (?:was )?interrupted' };
    expect(agent._migrateRetiredSuggestedPattern(intr)).toBe(true);
    expect(intr.pattern).toBe('Your spell is interrupted\\.');
  });
});

describe('your crowd control wearing off', () => {
  it('your mez wearing off fires with the spell name; a buff of yours does not', () => {
    expect(firesOn('cast_mez_off', 'Your Mesmerize spell has worn off.')).toBe(1);
    expect(alertText('cast_mez_off', 'Your Mesmerize spell has worn off.')).toBe('MEZ OFF: Mesmerize');
    expect(firesOn('cast_mez_off', 'Your Tashanian spell has worn off.')).toBe(0);
  });
  it('a slow, root or snare of yours wearing off', () => {
    expect(alertText('cast_slow_off', "Your Turgur's Insects spell has worn off.")).toBe("Turgur's Insects WORE OFF");
    expect(firesOn('cast_slow_off', 'Your Ensnare spell has worn off.')).toBe(1);
    expect(firesOn('cast_slow_off', 'Your Mesmerize spell has worn off.')).toBe(0);
  });
});

describe('the panel shows the alert as it will read', () => {
  it('every {mytarget} template has a preview with no braces left', () => {
    for (const t of agent.SUGGESTED_TRIGGERS) {
      if (!/\{mytarget\}|\{spell\}/.test(t.overlay_text || '')) continue;
      expect(t.overlay_preview, t.id).toBeTruthy();
      expect(t.overlay_preview).not.toMatch(/[{}]/);
    }
  });
});
