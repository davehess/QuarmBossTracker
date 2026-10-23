// test/ch-chain-other-guilds.test.js — the CH chain reads other guilds' call macros, and learns yours.
//
// The guild lead, 2026-10-23, in another guild's raid: "other people have CH chain macros, we need to
// define where those end up in the setup mode or start looking for other patterns." Their raid-say reads
//   "D&D 333 CH - Aldenmar - 61%"  — an optional guild tag, the slot digit repeated three times, CH, the
//   target, the caster's mana % with no "Mana" word.
// The tracker used to know only Wolf Pack's shout shapes. These are ADDITIONAL matchers that run only on a
// line the original parser did not claim (test/ch-chain-wolfpack-regression.test.js pins the other half:
// Wolf Pack's own chain must not move). Names below are invented.
//
// Mutation-checked: breaking the slot collapse, the tag, the CH-or-nothing rule, the go-cue chain guard, the
// original-wins guard, or the template compiler turns a test here red.
//
// Run: npx vitest run test/ch-chain-other-guilds.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const z2 = n => String(n).padStart(2, '0');
function stamp(secondsAgo) {
  const d = new Date(Date.now() - secondsAgo * 1000);
  return `[${DAY[d.getDay()]} ${MON[d.getMonth()]} ${String(d.getDate()).padStart(2, ' ')} `
    + `${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())} ${d.getFullYear()}]`;
}
const raid = (secondsAgo, who, text) => agent.trackChChainLine(`${stamp(secondsAgo)} ${who} tells the raid,  '${text}'`);
const shout = (secondsAgo, who, text) => agent.trackChChainLine(`${stamp(secondsAgo)} ${who} shouts, '${text}'`);
const slotOf = (n) => { const s = agent.chChainSnapshot(); return s && s.slots[n]; };

// The agent writes learned templates to logsync.prefs.json; keep the test off the real file.
let written;
let spy;
beforeEach(() => {
  agent._resetChChainForTest();
  agent._setAgentPrefsForTest({});
  written = [];
  const real = fs.writeFileSync;
  spy = vi.spyOn(fs, 'writeFileSync').mockImplementation((p, d, ...rest) => {
    if (String(p).endsWith('logsync.prefs.json')) { written.push(JSON.parse(d)); return undefined; }
    return real.call(fs, p, d, ...rest);
  });
});
afterEach(() => { spy.mockRestore(); agent._setAgentPrefsForTest({}); agent._resetChChainForTest(); });

describe('the screenshot lines — another guild\'s raid-say', () => {
  it('"D&D 333 CH - Brackwyn - 61%" is slot 3 with mana 61, "D&D 555 CH - Brackwyn - 100%" is slot 5 with mana 100', () => {
    raid(6, 'Aldenmar', 'D&D 333 CH - Brackwyn - 61%');
    raid(2, 'Corvale', 'D&D 555 CH - Brackwyn - 100%');
    const snap = agent.chChainSnapshot();
    expect(snap.target).toBe('Brackwyn');
    expect(snap.slots[3]).toMatchObject({ name: 'Aldenmar', mana: 61 });
    expect(snap.slots[5]).toMatchObject({ name: 'Corvale', mana: 100 });
    expect(snap.last_ch).toMatchObject({ num: 5, name: 'Corvale', mana: 100 });
    expect(snap.next_num).toBe(3);        // wraps to the lowest slot, as every chain does
  });
});

describe('built-in broadened shapes (chParseBuiltinExtra)', () => {
  const call = (t) => { const r = agent.chParseBuiltinExtra(t); return r && [r.num, r.target, r.mana]; };
  it.each([
    ['D&D 333 CH - Brackwyn - 61%',        [3, 'Brackwyn', 61]],
    ['D&D 555 CH - Corvale - 100%',        [5, 'Corvale', 100]],
    ['333 CH Brackwyn 61%',                [3, 'Brackwyn', 61]],     // no tag
    ['WP 55 CH Brackwyn',                  [5, 'Brackwyn', null]],   // two digits repeated
    ['[CH] 007 CH -> Brackwyn - Mana 40',  [7, 'Brackwyn', 40]],     // bracketed tag, leading zeros
    ['#3 CH Brackwyn',                     [3, 'Brackwyn', null]],
    ['3. CH: Brackwyn (61%)',              [3, 'Brackwyn', 61]],
    ['3) CH | Brackwyn | m61',             [3, 'Brackwyn', 61]],
    ['CH3 Brackwyn 72%',                   [3, 'Brackwyn', 72]],
    ['CH 4 - Brackwyn mana 33',            [4, 'Brackwyn', 33]],
    ['WP CH#6 on Brackwyn',                [6, 'Brackwyn', null]],
    ['WP Complete Heal 5 Brackwyn',        [5, 'Brackwyn', null]],
    ['C.H. 4 -> Brackwyn 33%',             [4, 'Brackwyn', 33]],
    ['D&D 333 CHeal Brackwyn 90%',         [3, 'Brackwyn', 90]],
  ])('%s', (text, want) => { expect(call(text)).toEqual(want); });

  it('a slot is 1..30: 100, 0 and 031 are not slots', () => {
    expect(call('100 CH Brackwyn')).toBeNull();
    expect(call('000 CH Brackwyn')).toBeNull();
    expect(call('D&D 031 CH - Brackwyn')).toBeNull();
    expect(agent._chSlotFromToken('333')).toBe(3);
    expect(agent._chSlotFromToken('012')).toBe(12);
    expect(agent._chSlotFromToken('999')).toBe(9);
  });

  it.each([
    ['3 GO', 3], ['333 go', 3], ['GO 3', 3], ['go 333', 3], ['next 3', 3], ['Next: 5', 5],
    ['D&D 555 GO', 5], ['3 - GO!', 3],
  ])('go-cue %s', (text, num) => {
    expect(agent.chParseBuiltinExtra(text)).toMatchObject({ kind: 'go', num });
  });

  it('turns a match into the canonical Wolf Pack text the original parser reads', () => {
    expect(agent.chParseBuiltinExtra('D&D 333 CH - Brackwyn - 61%').text).toBe('003 - CH - Brackwyn - Mana: 61%');
    expect(agent.chParseBuiltinExtra('333 go').text).toBe('003 GO GO GO');
  });
});

describe('false positives are rejected', () => {
  it.each([
    'Bluesage: Circled Toe Bones tradable',
    'Kyulin: Circled Toe Bones ran 333',
    'LOOT CHEST by the door 333',
    'CH chain starting soon, 3 clerics',
    '333 Brackwyn 61%',                     // a slot and a name, but no CH
    'CH Brackwyn 61%',                      // CH and a name, but no slot
    'CH 3',                                 // no target
    'we need 3 more healers',
    'pull in 3, 2, 1',
  ])('"%s" builds no chain', (text) => {
    raid(2, 'Aldenmar', text);
    expect(agent.chChainSnapshot()).toBeNull();
    expect(agent.chParseBuiltinExtra(text)).toBeNull();
  });

  it('lines from channels a chain is not called in are not read', () => {
    agent.trackChChainLine(`${stamp(2)} Aldenmar tells general:1, 'D&D 333 CH - Brackwyn - 61%'`);
    agent.trackChChainLine(`${stamp(2)} Aldenmar tells you,  'D&D 333 CH - Brackwyn - 61%'`);
    expect(agent.chChainSnapshot()).toBeNull();
  });

  it('a custom channel NAMED for chains is read, locally', () => {
    agent.trackChChainLine(`${stamp(2)} Aldenmar tells ch:1, 'D&D 333 CH - Brackwyn - 61%'`);
    expect(slotOf(3)).toMatchObject({ name: 'Aldenmar', mana: 61 });
  });

  it('shout and group say read too', () => {
    shout(3, 'Aldenmar', 'D&D 333 CH - Brackwyn - 61%');
    agent.trackChChainLine(`${stamp(1)} Corvale tells the group, 'D&D 444 CH - Brackwyn - 50%'`);
    expect(slotOf(3)).toBeTruthy();
    expect(slotOf(4)).toMatchObject({ name: 'Corvale', mana: 50 });
  });
});

describe('the original parser keeps every line it claims', () => {
  it('Wolf Pack shapes still read exactly as before', () => {
    shout(9, 'Aldenmar', '004 - CH - Hawkner - Mana: 52%');
    shout(8, 'Brackwyn', '003 ---> CH on Hawkner - mana -> 66%');
    shout(7, 'Corvale', '005 - CH: Hawkner - Mana: 61%');
    shout(6, 'Rethlan', '002 - DRUID CH - Hawkner');
    const s = agent.chChainSnapshot();
    expect(s.target).toBe('Hawkner');
    expect(s.slots[4]).toMatchObject({ name: 'Aldenmar', mana: 52 });
    expect(s.slots[3]).toMatchObject({ name: 'Brackwyn', mana: 66 });
    expect(s.slots[5]).toMatchObject({ name: 'Corvale', mana: 61 });
    expect(s.slots[2]).toMatchObject({ name: 'Rethlan', mana: null });
  });

  it('a line the original claims is NOT re-read by the broadened shapes ("3 CH …%" has no Mana word: mana stays null)', () => {
    // The broadened mana reader would say 61. The original claims this line, so it stays the original's answer.
    shout(3, 'Aldenmar', '3 CH Brackwyn 61%');
    expect(slotOf(3)).toMatchObject({ name: 'Aldenmar', mana: null });
  });

  it('the original\'s "GO GO GO" still steers, and is not re-read', () => {
    shout(12, 'Aldenmar', '001 - CH - Hawkner - Mana: 52%');
    shout(11, 'Brackwyn', '002 - CH - Hawkner - Mana: 52%');
    shout(2, 'Corvale', '001 GO GO GO');
    const s = agent.chChainSnapshot();
    expect(s.next_num).toBe(1);
    expect(s.last_go).toMatchObject({ num: 1, by: 'Corvale' });
  });

  it('a slot the original drops as out of range ("333 …") is the other guild\'s slot 3; 100 stays dropped', () => {
    shout(4, 'Aldenmar', '333 - CH - Hawkner - Mana: 52%');
    expect(slotOf(3)).toMatchObject({ name: 'Aldenmar', mana: 52 });
    agent._resetChChainForTest();
    shout(4, 'Aldenmar', '100 - CH - Hawkner - Mana: 52%');
    expect(agent.chChainSnapshot()).toBeNull();
  });
});

describe('go-cues in other shapes', () => {
  beforeEach(() => {
    raid(9, 'Aldenmar', 'D&D 333 CH - Brackwyn - 61%');
    raid(8, 'Corvale', 'D&D 555 CH - Brackwyn - 100%');
    raid(7, 'Rethlan', 'D&D 777 CH - Brackwyn - 80%');
  });
  it('"5 GO" points the chain at slot 5 and flashes it', () => {
    raid(2, 'Aldenmar', '5 GO');
    const s = agent.chChainSnapshot();
    expect(s.next_num).toBe(5);
    expect(s.last_go).toMatchObject({ num: 5 });
  });
  it('"next 3" and "GO 555" too', () => {
    raid(3, 'Aldenmar', 'next 3');
    expect(agent.chChainSnapshot().next_num).toBe(3);
    raid(2, 'Aldenmar', 'GO 555');
    expect(agent.chChainSnapshot().next_num).toBe(5);
  });
  it('a go-cue for a slot the chain does not have is ignored', () => {
    const before = agent.chChainSnapshot().next_num;
    raid(2, 'Aldenmar', '9 GO');
    expect(agent.chChainSnapshot().next_num).toBe(before);
    expect(agent.chChainSnapshot().last_go).toBeNull();
  });
  it('with no chain running a stray "3 GO" conjures nothing', () => {
    agent._resetChChainForTest();
    raid(2, 'Aldenmar', '3 GO');
    expect(agent.chChainSnapshot()).toBeNull();
  });
});

describe('teach it yours — learned templates', () => {
  // A shape no built-in reads: "[Rot 2] Brackwyn is getting CH from me, 61% mana"
  const EX = '[Rot 2] Brackwyn is getting CH from me, 61% mana';
  const ROLES = ['lit', 'SLOT', 'TARGET', 'lit', 'lit', 'lit', 'lit', 'lit', 'MANA', 'lit'];

  it('the example is unreadable until it is taught', () => {
    expect(agent.chParseBuiltinExtra(EX)).toBeNull();
    raid(3, 'Aldenmar', EX);
    expect(agent.chChainSnapshot()).toBeNull();
  });

  it('previews what it will read, then saves it to the prefs file', () => {
    const pv = agent.chLearnPreview(EX, ROLES);
    expect(pv).toMatchObject({ ok: true, kind: 'call', read: { slot: 2, target: 'Brackwyn', mana: 61 } });
    const out = agent.chLearnSave(EX, ROLES);
    expect(out.ok).toBe(true);
    expect(written.length).toBe(1);
    expect(written[0].ch_templates).toHaveLength(1);
    expect(written[0].ch_templates[0]).toMatchObject({ example: EX, roles: ROLES });
    expect(agent.chTemplates()).toHaveLength(1);
  });

  it('a taught template reads its siblings, with the slot, target and mana the example marked', () => {
    agent.chLearnSave(EX, ROLES);
    raid(6, 'Aldenmar', '[Rot 2] Brackwyn is getting CH from me, 61% mana');
    raid(4, 'Corvale', '[Rot 4] Hawkner is getting CH from me, 88% mana');
    raid(2, 'Rethlan', '[Rot 3] Hawkner is getting CH from me, 70% mana');
    const s = agent.chChainSnapshot();
    expect(Object.keys(s.slots).map(Number).sort()).toEqual([2, 3, 4]);
    expect(s.slots[2]).toMatchObject({ name: 'Aldenmar', mana: 61 });
    expect(s.slots[4]).toMatchObject({ name: 'Corvale', mana: 88 });
    expect(s.slots[3]).toMatchObject({ name: 'Rethlan', mana: 70 });
    expect(s.target).toBe('Hawkner');
  });

  it('a taught template does not read lines of a different shape', () => {
    agent.chLearnSave(EX, ROLES);
    raid(2, 'Aldenmar', '[Rot 2] Brackwyn is eating a sandwich from me, 61% mana');
    raid(2, 'Aldenmar', 'Rot 2 Brackwyn is getting CH from me, 61% mana');
    expect(agent.chChainSnapshot()).toBeNull();
  });

  it('a taught template with no target is a go-cue and steers an existing chain', () => {
    agent.chLearnSave(EX, ROLES);
    raid(8, 'Aldenmar', '[Rot 2] Brackwyn is getting CH from me, 61% mana');
    raid(7, 'Corvale', '[Rot 4] Brackwyn is getting CH from me, 61% mana');
    const out = agent.chLearnSave('Rot 4 up now', ['lit', 'SLOT', 'lit', 'lit']);
    expect(out).toMatchObject({ ok: true, kind: 'go' });
    raid(2, 'Aldenmar', 'Rot 2 up now');
    expect(agent.chChainSnapshot().next_num).toBe(2);
  });

  it('an optional guild tag word is skipped when the line has it and when it does not', () => {
    agent.chLearnSave('ZZ rot 3 heals Brackwyn 61%', ['TAG', 'lit', 'SLOT', 'lit', 'TARGET', 'MANA']);
    raid(5, 'Aldenmar', 'QQ rot 3 heals Brackwyn 61%');
    raid(3, 'Corvale', 'rot 4 heals Brackwyn 40%');
    expect(slotOf(3)).toMatchObject({ name: 'Aldenmar', mana: 61 });
    expect(slotOf(4)).toMatchObject({ name: 'Corvale', mana: 40 });
  });

  it('refuses a template that could match ordinary chat or does not read its own example', () => {
    expect(agent.chLearnSave('3 Brackwyn 61%', ['SLOT', 'TARGET', 'MANA']).ok).toBe(false);        // no fixed word
    expect(agent.chLearnSave(EX, ROLES.map(() => 'lit')).ok).toBe(false);                          // no slot
    expect(agent.chLearnSave('CH 100 Brackwyn', ['lit', 'SLOT', 'TARGET']).ok).toBe(false);        // 100 is not a slot
  });

  it('refuses two slots, a roles list of the wrong length, and an unknown role', () => {
    expect(agent.chLearnSave('CH 3 4 Brackwyn', ['lit', 'SLOT', 'SLOT', 'TARGET']).ok).toBe(false);
    expect(agent.chLearnSave('CH 3 Brackwyn', ['lit', 'SLOT']).ok).toBe(false);
    expect(agent.chLearnSave('CH 3 Brackwyn', ['lit', 'SLOT', 'WHO']).ok).toBe(false);
  });

  it('saving the same call twice keeps one; the list is capped', () => {
    agent.chLearnSave(EX, ROLES);
    expect(agent.chLearnSave(EX, ROLES).duplicate).toBe(true);
    expect(agent.chTemplates()).toHaveLength(1);
    for (let i = 0; i < agent.CH_TEMPLATES_MAX + 3; i++) agent.chLearnSave(`W${i}x 3 CH Brackwyn`, ['lit', 'SLOT', 'lit', 'TARGET']);
    expect(agent.chTemplates()).toHaveLength(agent.CH_TEMPLATES_MAX);
  });

  it('removing one stops it being read', () => {
    const { template } = agent.chLearnSave(EX, ROLES);
    expect(agent.chLearnRemove(template.id)).toMatchObject({ removed: true });
    expect(agent.chTemplates()).toHaveLength(0);
    raid(2, 'Aldenmar', EX);
    expect(agent.chChainSnapshot()).toBeNull();
    expect(written[written.length - 1].ch_templates).toEqual([]);
  });

  it('a taught template cannot capture a line the original parser claims', () => {
    // A template whose shape would also fit "001 - CH - Hawkner - Mana: 52%" must not change how that reads.
    agent.chLearnSave('001 - CH - Hawkner - Mana: 52%', ['SLOT', 'lit', 'lit', 'lit', 'TARGET', 'lit', 'lit', 'MANA']);
    shout(2, 'Aldenmar', '001 - CH - Brackwyn - Mana: 88%');
    expect(slotOf(1)).toMatchObject({ name: 'Aldenmar', mana: 88 });
  });

  it('guesses the roles for a typical line, so teaching is mostly a confirm', () => {
    expect(agent.chGuessRoles('D&D 333 CH - Brackwyn - 61%'))
      .toEqual(['TAG', 'SLOT', 'lit', 'lit', 'TARGET', 'lit', 'MANA']);
    // Where the name comes before CH the guess still finds slot, target and mana (the user fixes the rest).
    const g = agent.chGuessRoles(EX);
    expect([g[1], g[2], g[8]]).toEqual(['SLOT', 'TARGET', 'MANA']);
  });
});

describe('unrecognised CH calls', () => {
  it('a chain-looking line nothing reads is offered for teaching, then drops off once taught', () => {
    raid(5, 'Aldenmar', 'Heal CH Brackwyn in 2 clerics');
    let st = agent.chLearnState();
    expect(st.unrecognised && st.unrecognised.text).toBe('Heal CH Brackwyn in 2 clerics');
    expect(st.recent.map(r => r.text)).toContain('Heal CH Brackwyn in 2 clerics');
    agent.chLearnSave('Heal CH Brackwyn in 2 clerics', ['lit', 'lit', 'TARGET', 'lit', 'SLOT', 'lit']);
    st = agent.chLearnState();
    expect(st.unrecognised).toBeNull();
    expect(st.templates).toHaveLength(1);
  });

  it('chat that merely mentions a chest, or has no number or name, is not offered', () => {
    raid(5, 'Aldenmar', 'LOOT CHEST by the door 333');
    raid(5, 'Aldenmar', 'CH is starting');
    raid(5, 'Aldenmar', 'CH 3');
    expect(agent.chLearnState().unrecognised).toBeNull();
  });

  it('lines the built-ins read never appear in the list', () => {
    raid(5, 'Aldenmar', 'D&D 333 CH - Brackwyn - 61%');
    expect(agent.chLearnState().recent).toEqual([]);
  });
});
