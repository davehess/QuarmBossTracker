// test/buff-fade-triggers.test.js — the "buff dropped" suggested triggers read each spell's OWN fade text
// (the guild lead, 2026-10-19, DECISIONS §129 pick B).
//
// "Your <buff> spell has worn off." is what the server tells a CASTER about a spell on someone else
// (SPELL_WORN_OFF, string 437). A buff ending on YOU prints the spell's spell_fades, so the five triggers that
// watched the generic line never fired. Every line below is eqemu_spells.spell_fades, read live 2026-10-19 (spell
// id beside it). Names are invented. The shipped agent's evaluator runs, so a comment cannot satisfy these.
//
// Run: npx vitest run test/buff-fade-triggers.test.js

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Aldenmar';
const TS = (() => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `[${day} ${mon} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()}] `;
})();
const tpl = (id) => agent.SUGGESTED_TRIGGERS.find(t => t.id === id);
const fromTpl = (id) => agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl(id)));
const fires = (name) => agent._fireLog.filter(f => f.name === name).length;
let fireTs = Date.now();
function firesOn(id, msg, withTs = true) {
  const t = fromTpl(id);
  agent._setPersonalTriggersForTest([t]);
  const before = fires(t.name);
  agent.evaluateTriggersAgainstLine((withTs ? TS : '') + msg, (fireTs += 60_000), ME);
  return fires(t.name) - before;
}
beforeEach(() => {
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Aldenmar_pq.proj.txt' }]);
  agent._recompilePersonalTriggersForChars();
  agent._setPersonalTriggersForTest([]);
});

// [template, spell (id), the line its spell_fades prints]
const FADES = [
  ['buff_clarity_drop', 'Clarity (174)',                    'The cool breeze fades.'],
  ['buff_clarity_drop', 'Clarity II (1693)',                'The soft breeze fades.'],
  ['buff_clarity_drop', 'Voice of Quellious (3360)',        'Your mind returns to normal.'],
  ['buff_clarity_drop', "Koadic's Endless Intellect (2570)", 'Your mind returns to normal.'],
  ['buff_clarity_drop', 'Gift of Insight (1409)',           'Your gift of insight fades.'],
  ['buff_clarity_drop', 'Gift of Brilliance (1410)',        'Your gift of brilliance fades.'],
  ['buff_aego_drop',    'Aegolism (1447)',                  'Your aegolism fades.'],
  ['buff_aego_drop',    'Blessing of Aegolism (2510)',      'Your aegolism fades.'],
  ['buff_aego_drop',    'Virtue (3467)',                    'Your virtue fades.'],
  ['buff_aego_drop',    'Hand of Virtue (3479)',            'Your virtue fades.'],
  ['buff_aego_drop',    'Symbol of Marzin (1535)',          'The mystic symbol fades.'],
  ['buff_aego_drop',    'Symbol of Transal (485)',          'The mystic symbol fades.'],
  ['buff_potg_drop',    'Protection of the Glades (1442)',  'Your skin returns to normal.'],
  ['buff_potg_drop',    'Protection of the Cabbage (2188)', 'Your skin returns to normal.'],
  ['buff_potg_drop',    'Protection of the Nine (3234)',    'Your skin returns to normal.'],
  ['buff_haste_drop',   'Quickness (39)',                   'Your speed returns to normal.'],
  ['buff_haste_drop',   'Celerity (171)',                   'Your speed returns to normal.'],
  ['buff_haste_drop',   'Swift like the Wind (172)',        'Your speed returns to normal.'],
  ["buff_haste_drop",   "Aanya's Quickening (1708)",        'Your speed returns to normal.'],
  ['buff_haste_drop',   'Augmentation (10)',                'The pulsing energy fades.'],
  ['buff_haste_drop',   'Augment (1729)',                   'The pulsing energy fades.'],
  ['buff_dmg_shield_drop', 'Shield of Brambles (129)',      'The brambles fall away.'],
  ['buff_dmg_shield_drop', 'Shield of Thorns (356)',        'The brambles fall away.'],
  ['buff_dmg_shield_drop', 'Shield of Spikes (432)',        'The brambles fall away.'],
  ['buff_dmg_shield_drop', 'Legacy of Spike (1727)',        'The brambles fall away.'],
  ['buff_dmg_shield_drop', 'Thorny Shield (1975)',          'The brambles fall away.'],
  ['buff_dmg_shield_drop', 'Shield of Blades (1560)',       'The blades fall away.'],
  ['buff_dmg_shield_drop', 'Shield of the Eighth (1963)',   'The maelstrom fades away.'],
];

describe('each spell\'s own fade line fires its trigger', () => {
  for (const [id, spell, line] of FADES) {
    it(`${id}: ${spell} — "${line}"`, () => { expect(firesOn(id, line)).toBe(1); });
  }
  it('the alert text is the one the template names', () => {
    expect(tpl('buff_potg_drop').overlay_text).toBe('POTG DROPPED');
    expect(tpl('buff_clarity_drop').overlay_text).toBe('CLARITY DROPPED');
  });
});

describe('one drop raises one alert', () => {
  const ids = FADES.map(f => f[0]).filter((v, i, a) => a.indexOf(v) === i);
  it('every fade line belongs to exactly one of the five triggers', () => {
    for (const [id, spell, line] of FADES) {
      const hits = ids.filter(other => firesOn(other, line) === 1);
      expect(hits, `${spell}: ${line}`).toEqual([id]);
    }
  });
  it('the skin line (POTG, and the Spikecoat / Bramblecoat / Thistlecoat damage shields) is POTG\'s alone', () => {
    expect(firesOn('buff_dmg_shield_drop', 'Your skin returns to normal.')).toBe(0);
    expect(firesOn('buff_potg_drop', 'Your skin returns to normal.')).toBe(1);
  });
});

describe('what must NOT fire', () => {
  it('the old generic line — it is only ever told to a caster, about a spell on someone else', () => {
    for (const [id, msg] of [['buff_clarity_drop', 'Your Clarity spell has worn off.'], ['buff_aego_drop', 'Your Aegolism spell has worn off.'],
      ['buff_potg_drop', 'Your Protection of the Glades spell has worn off.'], ['buff_haste_drop', 'Your Celerity spell has worn off.'],
      ['buff_dmg_shield_drop', 'Your Shield of Thorns spell has worn off.']]) {
      expect(firesOn(id, msg), msg).toBe(0);
    }
  });
  it('the words said by someone (quoted chat, or a longer sentence that merely ends with them): the pattern is anchored to the start of the line', () => {
    expect(firesOn('buff_clarity_drop', "Brackwyn says, 'The cool breeze fades.'")).toBe(0);
    expect(firesOn('buff_potg_drop', "Brackwyn tells the guild, 'Your skin returns to normal.'")).toBe(0);
    expect(firesOn('buff_clarity_drop', 'Brackwyn mutters that the cool breeze fades.')).toBe(0);
    expect(firesOn('buff_haste_drop', 'Brackwyn mutters that Your speed returns to normal.')).toBe(0);
  });
  it('a neighbouring spell\'s fade line', () => {
    expect(firesOn('buff_haste_drop', 'The spirit of wolf leaves you.')).toBe(0);   // Spirit of Wolf (278): run speed, not haste
    expect(firesOn('buff_clarity_drop', 'You have stopped regenerating.')).toBe(0);
    expect(firesOn('buff_aego_drop', 'Your shielding fades.')).toBe(0);              // Shield of the Magi: armour, not Aegolism
    expect(firesOn('buff_potg_drop', 'You have stopped regenerating.')).toBe(0);     // Pack Regeneration is not POTG
  });
});

describe('a row saved with the old, dead pattern moves to the working one', () => {
  const OLD = {
    buff_clarity_drop: '^Your (?:Clarity(?: II)?|Voice of Quellious|Gift of (?:Insight|Brilliance)|Koadic\'s Endless Intellect) (?:spell )?has worn off\\.',
    buff_aego_drop: '^Your (?:Aegolism|Virtue|Symbol of (?:Marzin|Ryltan|Naltron|Tnarg|Pinzarn|Transal)|Hand of Virtue|Conviction|Blessing of Aegolism) (?:spell )?has worn off\\.',
    buff_potg_drop: '^Your (?:Protection of the (?:Glades|Cabbage|Nine)|Pack Regen) (?:spell )?has worn off\\.',
    buff_haste_drop: '^Your (?:Augment(?:ation)?(?: of Death)?|Aanya\'s Quickening|Celerity|Quickness|Swift Like the Wind) (?:spell )?has worn off\\.',
    buff_dmg_shield_drop: '^Your (?:Shield of (?:Thorns|Spikes|Blades|Brambles|the Eighth|the Magi|the Pellarus)|Thorny Shield|Thistlecoat|Bramblecoat|Spikecoat|Legacy of Spike) (?:spell )?has worn off\\.',
  };
  for (const [id, old] of Object.entries(OLD)) {
    it(id, () => {
      const row = { ...agent._templateToPersonalRow(tpl(id)), pattern: old };
      expect(agent._migrateRetiredSuggestedPattern(row)).toBe(true);
      expect(row.pattern).toBe(tpl(id).pattern);
    });
  }
  it('a pattern the member edited by hand is left alone', () => {
    const row = { ...agent._templateToPersonalRow(tpl('buff_clarity_drop')), pattern: 'my own words' };
    expect(agent._migrateRetiredSuggestedPattern(row)).toBe(false);
    expect(row.pattern).toBe('my own words');
  });
});

describe('invisibility already has its "about to drop" warning (INVIS_BEGIN_BREAK, string 275)', () => {
  it('fires on the server line', () => {
    expect(firesOn('self_invis_fading', 'You feel yourself starting to appear.')).toBe(1);
  });
});
