// test/who-target-card.test.js — the /who overlay's Target card.
//
// The guild lead, 2026-09-26, in a raid shared with other guilds: "add guild under the player's name
// when we know it. When we click on them put them at the top of the /who overlay."
//
// Runs the agent's REAL buildWhoSnapshot, _whoTargetPlayer and _targetPlayerInfo over fake Zeal and
// /who state, and the overlay's REAL card markup. Names are invented.
//
// Run: npx vitest run test/who-target-card.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const whoBlock = sliceBlock(agent, '// PVP threat-priority ordering for the /who overlay.', '\n// Capture a /guildstatus result')
  .replace(/\n\/\/ Capture a \/guildstatus result$/, '');
const targetInfo = sliceBlock(agent, 'function _targetPlayerInfo(st, selfChar, cached) {', '\n}');
const noManaRx = agent.match(/const _NO_MANA_CLASSES = [^\n]+/)[0];

function load({ target = null, who = [], whoRun = null, history = {}, raidClass = {}, mob = undefined } = {}) {
  const pre = `
    const whoData = new Map(${JSON.stringify(who.map(w => [w.name.toLowerCase(), w]))});
    let _whoRun = ${whoRun ? `{ startedAt: Date.now(), names: new Set(${JSON.stringify(whoRun)}), complete: true }` : 'null'};
    const _whoLookupCache = new Map(${JSON.stringify(Object.entries(history).map(([k, v]) => [k, { at: 0, data: v }]))});
    for (const v of _whoLookupCache.values()) v.at = Date.now();
    const WHO_LOOKUP_TTL_MS = 5 * 60 * 1000;
    function fetchWhoLookup() {}
    const _zealState = { Aldenmar: { target_name: ${JSON.stringify(target)}, zone: 81, updatedAt: Date.now() } };
    function _currentTargetState() { return _zealState.Aldenmar.target_name ? _zealState.Aldenmar : null; }
    const _mobInfoByName = new Map();
    function _mobInfoCacheKey(n, z) { return String(n).toLowerCase() + '|' + z; }
    ${mob === undefined ? '' : `_mobInfoByName.set(_mobInfoCacheKey(${JSON.stringify(target)}, 81), { at: Date.now(), mob: ${JSON.stringify(mob)} });`}
    const _raidClassByName = new Map(${JSON.stringify(Object.entries(raidClass))});
    function conLevelFor() { return null; }
    function normalizeClass(s) { return s ? String(s).trim() : s; }
    function pvpDrainState() { return null; }
    ${noManaRx}
  `;
  return evalBlock(pre + whoBlock + '\n' + targetInfo, ['buildWhoSnapshot']);
}

const row = (name, extra = {}) => ({ name, class: null, level: null, guild: null, anonymous: false, gm: false,
  observedAt: new Date().toISOString(), ...extra });

describe('the player you target goes on top, with their guild when we know it', () => {
  it('from this /who: taken out of Current and carded with the live guild', () => {
    const { buildWhoSnapshot } = load({
      target: 'Brackwyn',
      who: [row('Brackwyn', { class: 'Bard', level: 60, guild: 'Dungeons and Dragons' }),
            row('Corvale', { class: 'Cleric', level: 60, guild: 'Wolf Pack' })],
      whoRun: ['brackwyn', 'corvale'],
    });
    const s = buildWhoSnapshot();
    expect(s.target).toMatchObject({ name: 'Brackwyn', guild: 'Dungeons and Dragons', guild_src: 'who', class: 'Bard', level: 60 });
    expect(s.current.map(r => r.name)).toEqual(['Corvale']);   // Not listed twice.
  });

  it('/anon in this /who: the guild comes from history, marked as such', () => {
    const { buildWhoSnapshot } = load({
      target: 'Rethlan',
      who: [row('Rethlan', { anonymous: true })],
      whoRun: ['rethlan'],
      history: { rethlan: { class: 'Enchanter', level: 60, guild: 'Dungeons and Dragons' } },
    });
    const t = buildWhoSnapshot().target;
    expect(t).toMatchObject({ guild: 'Dungeons and Dragons', guild_src: 'history', class: 'Enchanter', anonymous: true });
  });

  it('never /who\'d this session: still carded from history, before any /who at all', () => {
    const { buildWhoSnapshot } = load({
      target: 'Nyssara',
      history: { nyssara: { class: 'Druid', level: 58, guild: 'Erud\'s Crossing Guard', main: 'Zarrin', mimic: true } },
    });
    const s = buildWhoSnapshot();
    expect(s).not.toBeNull();
    expect(s.current).toEqual([]);
    expect(s.target).toMatchObject({ name: 'Nyssara', guild: 'Erud\'s Crossing Guard', guild_src: 'history', main: 'Zarrin', mimic: true });
  });

  it('a raid member with no /who and no history: carded with the raid class, no guild', () => {
    const { buildWhoSnapshot } = load({ target: 'Aldric', raidClass: { aldric: 'Paladin' } });
    const t = buildWhoSnapshot().target;
    expect(t).toMatchObject({ name: 'Aldric', class: 'Paladin', guild: null, guild_src: null });
  });

  it('an NPC or a pet gets no card', () => {
    expect(load({ target: 'a gnoll pup', mob: { level: 3 } }).buildWhoSnapshot()).toBeNull();
    expect(load({ target: 'Xabann', mob: null }).buildWhoSnapshot()).toBeNull();   // A pet: catalog empty, nothing else.
    const withWho = load({ target: 'Xabann', mob: null, who: [row('Corvale', { guild: 'Wolf Pack' })], whoRun: ['corvale'] });
    const s = withWho.buildWhoSnapshot();
    expect(s.target).toBeNull();
    expect(s.current.map(r => r.name)).toEqual(['Corvale']);
  });
});

describe('the overlay draws the guild under the name', () => {
  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'who.html'));
  const esc = sliceBlock(html, 'function esc(s){', '}); }');
  const card = sliceBlock(html, 'function targetHtml(t){', '\n  }');
  const { targetHtml } = evalBlock(esc + '\n' + card, ['targetHtml']);

  it('name line first, then the guild on its own line', () => {
    const h = targetHtml({ name: 'Brackwyn', class: 'Bard', level: 60, guild: 'Dungeons and Dragons', guild_src: 'who' });
    expect(h).toMatch(/<span class="nm">Brackwyn<\/span>.*<\/div><div class="guildline">&lt;Dungeons and Dragons&gt;<\/div>/);
    expect(h).toContain('>Bard<');
    expect(h).toContain('>L60<');
  });

  it('a guild from history is italic and says so; an unknown guild draws no line', () => {
    const fromHistory = targetHtml({ name: 'Rethlan', guild: 'Dungeons and Dragons', guild_src: 'history', anonymous: true });
    expect(fromHistory).toContain('class="guildline deanon"');
    expect(fromHistory).toContain('/who history');
    expect(targetHtml({ name: 'Aldric', class: 'Paladin', guild: null })).not.toContain('guildline');
  });

  it('escapes what it prints', () => {
    expect(targetHtml({ name: '<b>x</b>', guild: '<i>' })).not.toMatch(/<b>x|<i>/);
  });
});
