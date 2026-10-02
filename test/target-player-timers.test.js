// test/target-player-timers.test.js — a targeted player's known timers on Target Info.
//
// The guild lead, 2026-10-02: "When we have a known timer, for someone's disciplines or mend or
// area taunt, we should display those on target info. When we're targeting them". Three sources:
// your own character, the player's own Mimic (their live-state upload), and a discipline you saw
// them start. AAs are exact from the server's refusal line; a /pipe press counts down from a
// reuse learned from a press followed by a refusal.
//
// Run: npx vitest run test/target-player-timers.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const DISCS = sliceBlock(src, 'const _ME_DISCS = new Map([', ']);');
const REUSE = sliceBlock(src, 'function _meDiscReuseSecs(', '\n}');
const BLOCK = sliceBlock(src, "// ── A targeted player's known timers, on Target Info", '  return out.length ? out : null;\n}');

function load() {
  return evalBlock(`
    const whoData = new Map();
    const _raidClassByName = new Map();
    const _meDiscs = new Map();
    const _discReadyAt = new Map();
    const _meSkillCds = new Map();
    const _mtLiveStateByName = new Map();
    const _zeal = new Set();
    function _meZealFor(cl) { return _zeal.has(cl) ? {} : null; }
    function _meTimersLoad() {}
    function _meTimersSave() {}
    // The AAs whose reuse is known (Boastful Bellow) keep their HUD timer —
    // me-hud-timers runs that path; none here.
    const _ME_SKILL_LINES = [];
    function _meStartSkill() {}
    function normalizeClass(c) { return c || null; }
    ${DISCS}
    ${REUSE}
    ${BLOCK}
  `, ['whoData', '_raidClassByName', '_meDiscs', '_discReadyAt', '_meSkillCds', '_mtLiveStateByName', '_zeal',
      '_meNoteOtherDisc', '_meNoteAaRefusal', '_meNoteAaPress', '_meAaTimers', '_liveCooldownsFor', '_targetPlayerTimers', '_meObsDiscs']);
}

const T0 = Date.parse('2026-10-02T06:00:00Z');
let A;
beforeEach(() => { A = load(); });

describe('another player\'s discipline, seen in your log', () => {
  it('the possessive form, with their level from /who', () => {
    A.whoData.set('brackwyn', { class: 'Warrior', level: 60 });
    expect(A._meNoteOtherDisc("Brackwyn's body is consumed in rage.", 'aldenmar', T0)).toBe(true);
    const e = A._meObsDiscs.get('brackwyn');
    expect(e.name).toBe('Furious');
    expect(e.total_ms).toBe((3600 - 4 * 54) * 1000);   // unlocks at 56, four levels above
    expect(e.level_known).toBe(true);
  });
  it('the spaced form, and the catalog text with no closing period', () => {
    expect(A._meNoteOtherDisc('Brackwyn assumes an aggressive fighting style', 'aldenmar', T0)).toBe(true);
    expect(A._meObsDiscs.get('brackwyn').name).toBe('Aggressive');
    expect(A._meObsDiscs.get('brackwyn').level_known).toBe(false);
  });
  it('a level unknown takes the longest the reuse can be', () => {
    A._meNoteOtherDisc('Corvale bounces about nimbly.', 'aldenmar', T0);
    expect(A._meObsDiscs.get('corvale').total_ms).toBe(1800 * 1000);
  });
  it('ignores your own name, mob names and other text', () => {
    expect(A._meNoteOtherDisc('Aldenmar feels unstoppable.', 'aldenmar', T0)).toBe(false);
    expect(A._meNoteOtherDisc('a gnoll feels unstoppable.', 'aldenmar', T0)).toBe(false);
    expect(A._meNoteOtherDisc('Brackwyn feels much better.', 'aldenmar', T0)).toBe(false);
  });
});

describe('AAs: the refusal is exact, a press learns the reuse', () => {
  it('reads both refusal forms', () => {
    expect(A._meNoteAaRefusal('aldenmar', 'You can use the ability Area Taunt again in 9 minute(s) 30 seconds.', T0)).toBe(true);
    const e = A._meAaTimers.get('aldenmar').get('aa:area_taunt');
    expect(e.ready).toBe(T0 + 570_000);
    expect(e.est).toBe(false);
    A._meNoteAaRefusal('aldenmar', 'You can use the ability Lay on Hands again in 1 hour(s) 2 minute(s) 3 seconds.', T0);
    expect(A._meAaTimers.get('aldenmar').get('aa:lay_on_hands').ready).toBe(T0 + 3723_000);
  });
  it('a press, then a refusal, learns the reuse; the next press counts down from it', () => {
    A._meNoteAaPress('aldenmar', 'Area Taunt', T0);
    let e = A._meAaTimers.get('aldenmar').get('aa:area_taunt');
    expect(e.ready).toBe(0);                    // nothing learned yet: no timer
    A._meNoteAaRefusal('aldenmar', 'You can use the ability Area Taunt again in 8 minute(s) 0 seconds.', T0 + 120_000);
    e = A._meAaTimers.get('aldenmar').get('aa:area_taunt');
    expect(e.learned).toBe(600_000);
    A._meNoteAaPress('aldenmar', 'Area Taunt', T0 + 700_000);
    expect(e.ready).toBe(T0 + 1_300_000);
    expect(e.est).toBe(true);
  });
  it('a press while the timer still runs is not a use', () => {
    A._meNoteAaRefusal('aldenmar', 'You can use the ability Area Taunt again in 5 minute(s) 0 seconds.', T0);
    A._meNoteAaPress('aldenmar', 'Area Taunt', T0 + 60_000);
    expect(A._meAaTimers.get('aldenmar').get('aa:area_taunt').press).toBe(0);
  });
});

describe('what a character uploads', () => {
  it('discipline, Mend and an AA with absolute ready times; nothing under a minute', () => {
    A._meDiscs.set('aldenmar', { name: 'Hundred Fists', at: T0, total_ms: 1_800_000 });
    A._meSkillCds.set('aldenmar', new Map([
      ['mend', { label: 'Mend', at: T0, secs: 289, est: false }],
      ['fd', { label: 'Feign Death', at: T0, secs: 10, est: true }],
    ]));
    A._meNoteAaRefusal('aldenmar', 'You can use the ability Area Taunt again in 1 minute(s) 0 seconds.', T0);
    const l = A._liveCooldownsFor('aldenmar', T0 + 1000);
    expect(l.map(c => c.key)).toEqual(['disc', 'mend', 'aa:area_taunt']);
    expect(l[0]).toEqual({ key: 'disc', label: 'Hundred Fists', ready_at: new Date(T0 + 1_800_000).toISOString(), total_ms: 1_800_000, est: true });
    expect(l[1].ready_at).toBe(new Date(T0 + 289_000).toISOString());
    // The same answer a second later: the change signature does not churn.
    expect(A._liveCooldownsFor('aldenmar', T0 + 2000)).toEqual(l);
  });
  it('the refusal line beats the activation estimate for the discipline', () => {
    A._meDiscs.set('aldenmar', { name: 'Hundred Fists', at: T0, total_ms: 1_800_000 });
    A._discReadyAt.set('aldenmar', { at: T0 + 900_000, name: 'Aldenmar' });
    const d = A._liveCooldownsFor('aldenmar', T0 + 1000)[0];
    expect(d.ready_at).toBe(new Date(T0 + 900_000).toISOString());
    expect(d.est).toBe(false);
  });
});

describe('what Target Info shows for a player target', () => {
  const st = (name) => ({ target_name: name });
  it('another raider: their Mimic\'s timers, counted down here', () => {
    A._mtLiveStateByName.set('brackwyn', { at: T0, state: { cooldowns: [
      { key: 'mend', label: 'Mend', ready_at: new Date(T0 + 60_000).toISOString(), total_ms: 289_000, est: false },
      { key: 'aa:area_taunt', label: 'Area Taunt', ready_at: new Date(T0 - 5_000).toISOString(), total_ms: null, est: false },
    ] } });
    const t = A._targetPlayerTimers(st('Brackwyn'), null, T0);
    expect(t).toEqual([
      { key: 'mend', label: 'Mend', ms_left: 60_000, total_ms: 289_000, est: false, source: 'mimic' },
      { key: 'aa:area_taunt', label: 'Area Taunt', ms_left: 0, total_ms: null, est: false, source: 'mimic' },
    ]);
  });
  it('a disc you saw fills in when their Mimic has none', () => {
    A._meNoteOtherDisc('Corvale bounces about nimbly.', 'aldenmar', T0);
    const t = A._targetPlayerTimers(st('Corvale'), null, T0 + 60_000);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ key: 'disc', label: 'Nimble', ms_left: 1_740_000, est: true, source: 'seen' });
  });
  it('your own character reads your own timers', () => {
    A._zeal.add('aldenmar');
    A._meSkillCds.set('aldenmar', new Map([['mend', { label: 'Mend', at: T0, secs: 289, est: false }]]));
    expect(A._targetPlayerTimers(st('Aldenmar'), null, T0)[0]).toMatchObject({ key: 'mend', source: 'own' });
  });
  it('nothing for an NPC or an unknown player', () => {
    expect(A._targetPlayerTimers(st('a gnoll pup'), null, T0)).toBeNull();
    expect(A._targetPlayerTimers(st('Froggy'), { mob: { id: 1 } }, T0)).toBeNull();
    expect(A._targetPlayerTimers(st('Nyssara'), null, T0)).toBeNull();
  });
});

describe('the wiring', () => {
  const code = stripJs(src);
  it('live-state carries the timers and a timer starting re-sends', () => {
    expect(code).toMatch(/cooldowns: \(\(\) => \{\n\s+const l = _liveCooldownsFor\(String\(ch\)\.toLowerCase\(\), now\);/);
    expect(code).toMatch(/const cdKeys = \(rec\.cooldowns \|\| \[\]\)\.map\(c => `\$\{c\.key\}@\$\{c\.ready_at\}`\);/);
    expect(code).toMatch(/tankKeys,\n\s+cdKeys,\n\s+\]\);/);
  });
  it('the raw-line hook reads refusals and other players\' discs; /pipe reads AA presses', () => {
    expect(code).toMatch(/if \(msg\.startsWith\('You can use the ability '\)\) \{/);
    expect(code).toMatch(/if \(_meNoteOtherDisc\(msg, cl, now\)\) return;/);
    expect(code).toMatch(/else if \(_ME_AA_PIPE\[w\]\) _meNoteAaPress\(cl, _ME_AA_PIPE\[w\], e\.at\);/);
  });
  it('buildMobInfo hands them to Target Info, which draws them', () => {
    expect(code).toMatch(/target_timers: {2}_targetPlayerTimers\(st, cached, Date\.now\(\)\),/);
    const page = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html')));
    expect(page).toMatch(/\+ timersLine\(mi\.target_timers\)/);
  });
});
