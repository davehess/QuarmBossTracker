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
const zealLevel = sliceBlock(agent, 'function _zealLevelFor(name) {', '\n}');

// raidPipe = { ageMs, members } is Zeal's type-5 sample; group = { ageMs, members } is the type-6
// sample, whose `data` is a JSON STRING inside the object (double-encoded, as on the real pipe).
function load({ target = null, who = [], whoRun = null, history = {}, raidClass = {}, mob = undefined,
  raidPipe = null, group = null } = {}) {
  const pre = `
    let _lastRaidPipe = ${raidPipe ? `{ at: Date.now() - ${raidPipe.ageMs || 0}, members: ${JSON.stringify(raidPipe.members)} }` : 'null'};
    const _zeal = { lastSamples: ${group ? `{ '6': { at: Date.now() - ${group.ageMs || 0}, obj: { type: 6, character: 'Aldenmar', data: ${JSON.stringify(typeof group.data === 'string' ? group.data : JSON.stringify(group.members))} } } }` : '{}'} };
    const whoData = new Map(${JSON.stringify(who.map(w => [w.name.toLowerCase(), w]))});
    let _whoRun = ${whoRun ? `{ startedAt: Date.now(), names: new Set(${JSON.stringify(whoRun)}), complete: true }` : 'null'};
    const _whoZoneSeen = new Map();
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
  return evalBlock(pre + whoBlock + '\n' + targetInfo + '\n' + zealLevel, ['buildWhoSnapshot', '_zealLevelFor', '_whoLookupCache']);
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

// The guild lead, 2026-10-04: "We shouldn't have a gap in our own players levels." Zeal already holds
// the exact, current level of everyone in the raid (type 5) and, with /pipeverbose, the group (type 6).
describe('a level from Zeal fills our own /anon players (the guild lead, 2026-10-04)', () => {
  const anon = (name) => row(name, { anonymous: true });
  const rowOf = (h, name) => h.buildWhoSnapshot().current.find(r => r.name === name);
  const inRaid = (name, level, extra = {}) => ({ name, class: 'Necromancer', group: '2', level, ...extra });
  const hist = { quillon: { class: 'Necromancer', level: 55, guild: 'Wolf Pack', mimic: true } };

  it('an /anon raid member gets the raid pipe level, with the rest of the lookup kept', () => {
    const h = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      raidPipe: { ageMs: 1000, members: [inRaid('Quillon', '60')] } });
    const r = rowOf(h, 'Quillon');
    expect(r.known).toMatchObject({ level: 60, class: 'Necromancer', guild: 'Wolf Pack', mimic: true });
    expect(r.level).toBeNull();   // The overlay reads p.level || p.known.level, and draws known italic.
  });

  it('the cached lookup is copied, never edited: the history level is still there afterwards', () => {
    const h = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      raidPipe: { ageMs: 0, members: [inRaid('Quillon', '60')] } });
    const cached = h._whoLookupCache.get('quillon').data;
    const before = JSON.stringify(cached);
    const r = rowOf(h, 'Quillon');
    expect(r.known).not.toBe(cached);
    expect(JSON.stringify(cached)).toBe(before);
    expect(cached.level).toBe(55);
  });

  it('byte-stable across polls: the same snapshot twice, nothing volatile added', () => {
    const h = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      raidPipe: { ageMs: 0, members: [inRaid('Quillon', '60')] } });
    const a = JSON.stringify(h.buildWhoSnapshot().current);
    for (const t = Date.now(); Date.now() - t < 3;) { /* let the clock move: a timestamp in the row would differ */ }
    expect(JSON.stringify(h.buildWhoSnapshot().current)).toBe(a);
  });

  it('with no history at all, the row still gets a level', () => {
    const h = load({ who: [anon('Quillon')], whoRun: ['quillon'], raidPipe: { ageMs: 0, members: [inRaid('Quillon', '60')] } });
    expect(rowOf(h, 'Quillon').known).toEqual({ level: 60 });
  });

  it('names match without regard to case', () => {
    const h = load({ who: [anon('Quillon')], whoRun: ['quillon'], raidPipe: { ageMs: 0, members: [inRaid('QUILLON', '60')] } });
    expect(rowOf(h, 'Quillon').known.level).toBe(60);
  });

  it('a raid sample over two minutes old is ignored: the bot\'s history level stands', () => {
    const stale = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      raidPipe: { ageMs: 121_000, members: [inRaid('Quillon', '60')] } });
    expect(rowOf(stale, 'Quillon').known.level).toBe(55);
    const fresh = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      raidPipe: { ageMs: 119_000, members: [inRaid('Quillon', '60')] } });
    expect(rowOf(fresh, 'Quillon').known.level).toBe(60);
  });

  it('someone not in the raid keeps the history level', () => {
    const h = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      raidPipe: { ageMs: 0, members: [inRaid('Corvale', '60')] } });
    expect(rowOf(h, 'Quillon').known.level).toBe(55);
  });

  it('a group mate: the type-6 level when /pipeverbose sent one, nothing when it did not', () => {
    const withLevel = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      group: { ageMs: 5000, members: [{ name: 'Quillon', spawn_id: 7, level: 60, class: 'Necromancer' }] } });
    expect(rowOf(withLevel, 'Quillon').known.level).toBe(60);
    const without = load({ who: [anon('Quillon')], whoRun: ['quillon'], history: hist,
      group: { ageMs: 5000, members: [{ name: 'Quillon', spawn_id: 7, loc: { x: 1, y: 2, z: 3 }, heading: 4 }] } });
    expect(rowOf(without, 'Quillon').known.level).toBe(55);
    const bare = load({ who: [anon('Quillon')], whoRun: ['quillon'],
      group: { ageMs: 5000, members: [{ name: 'Quillon', spawn_id: 7 }] } });
    expect(rowOf(bare, 'Quillon').known).toBeNull();
  });

  it('an /anon row still carrying the level /who showed before they hid it: a current level replaces it', () => {
    const carried = () => row('Quillon', { anonymous: true, level: 52 });
    const zeal = rowOf(load({ who: [carried()], whoRun: ['quillon'], history: hist,
      raidPipe: { ageMs: 0, members: [inRaid('Quillon', '60')] } }), 'Quillon');
    expect(zeal.level).toBeNull();
    expect(zeal.known.level).toBe(60);
    const higher = rowOf(load({ who: [carried()], whoRun: ['quillon'], history: hist }), 'Quillon');   // bot 55 > carried 52
    expect(higher.level).toBeNull();
    expect(higher.known.level).toBe(55);
    const lower = rowOf(load({ who: [row('Quillon', { anonymous: true, level: 58 })], whoRun: ['quillon'], history: hist }), 'Quillon');
    expect(lower.level).toBe(58);   // bot 55 < carried 58: the carried level is the better of the two
  });

  it('a row that is not /anon keeps its own /who level, whatever Zeal says', () => {
    const h = load({ who: [row('Corvale', { class: 'Cleric', level: 60 })], whoRun: ['corvale'],
      raidPipe: { ageMs: 0, members: [inRaid('Corvale', '58')] } });
    const r = rowOf(h, 'Corvale');
    expect(r.level).toBe(60);
    expect(r.known).toBeUndefined();
  });

  describe('_zealLevelFor', () => {
    const lv = (opts, name = 'Quillon') => load(opts)._zealLevelFor(name);
    it('is a positive integer, from the raid string', () => {
      expect(lv({ raidPipe: { ageMs: 0, members: [inRaid('Quillon', '60')] } })).toBe(60);
    });
    it('raid beats group when both know the name', () => {
      expect(lv({ raidPipe: { ageMs: 0, members: [inRaid('Quillon', '60')] },
        group: { ageMs: 0, members: [{ name: 'Quillon', level: 59 }] } })).toBe(60);
    });
    it('a raid row with no level falls through to the group', () => {
      expect(lv({ raidPipe: { ageMs: 0, members: [inRaid('Quillon', null)] },
        group: { ageMs: 0, members: [{ name: 'Quillon', level: 59 }] } })).toBe(59);
    });
    it('a stale raid sample falls through to a fresh group sample, and a stale group sample is ignored', () => {
      expect(lv({ raidPipe: { ageMs: 130_000, members: [inRaid('Quillon', '60')] },
        group: { ageMs: 0, members: [{ name: 'Quillon', level: 59 }] } })).toBe(59);
      expect(lv({ group: { ageMs: 130_000, members: [{ name: 'Quillon', level: 59 }] } })).toBeNull();
    });
    it('no level, a zero, a blank or junk is unknown, never a level', () => {
      for (const bad of [null, undefined, '', '0', 0, -3, 'abc', NaN]) {
        expect(lv({ raidPipe: { ageMs: 0, members: [inRaid('Quillon', bad)] } })).toBeNull();
        expect(lv({ group: { ageMs: 0, members: [{ name: 'Quillon', level: bad }] } })).toBeNull();
      }
    });
    it('never throws on a malformed sample, a non-array group, or a missing name', () => {
      expect(lv({ group: { ageMs: 0, data: '{not json' } })).toBeNull();
      expect(lv({ group: { ageMs: 0, data: JSON.stringify({ name: 'Quillon', level: 60 }) } })).toBeNull();
      expect(lv({ group: { ageMs: 0, members: [null, 5, { level: 60 }] } })).toBeNull();
      expect(lv({ raidPipe: { ageMs: 0, members: [null, { level: '60' }] } })).toBeNull();
      expect(load()._zealLevelFor(undefined)).toBeNull();
      expect(load()._zealLevelFor('')).toBeNull();
    });
  });
});

describe('Zek only mode (the guild lead, 2026-09-26: "a Zek only mode")', () => {
  it('every row carries its Zek flag: the live guild, or history, /anon or not', () => {
    const { buildWhoSnapshot } = load({
      who: [row('Ozzar', { class: 'Rogue', level: 60, guild: 'Zek' }),
            row('Vessk', { class: 'Wizard', level: 60, guild: 'Deathbringers' }),
            row('Quillon', { anonymous: true }),
            row('Corvale', { class: 'Cleric', level: 60, guild: 'Wolf Pack' })],
      whoRun: ['ozzar', 'vessk', 'quillon', 'corvale'],
      history: { vessk: { is_zek: true }, quillon: { class: 'Necromancer', is_zek: true }, corvale: { is_zek: false } },
    });
    const byName = Object.fromEntries(buildWhoSnapshot().current.map(r => [r.name, r]));
    expect(byName.Ozzar.zek).toBe(true);     // <Zek> on the live row.
    expect(byName.Vessk.zek).toBe(true);     // Not /anon, but history says Zek (inferred, or an old guild).
    expect(byName.Quillon.zek).toBe(true);   // /anon, history says Zek.
    expect(byName.Corvale.zek).toBeUndefined();
  });

  it('a target in the Zek guild is flagged on the card', () => {
    const { buildWhoSnapshot } = load({ target: 'Ozzar', who: [row('Ozzar', { class: 'Rogue', level: 60, guild: 'Zek' })], whoRun: ['ozzar'] });
    expect(buildWhoSnapshot().target.zek).toBe(true);
  });

  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'who.html'));
  const { isZek, listsFor } = evalBlock(
    sliceBlock(html, 'function isZek(p){', '}') + '\n' + sliceBlock(html, 'function listsFor(w, zekOnly){', '\n  }'),
    ['isZek', 'listsFor']);
  const snap = {
    current: [{ name: 'Ozzar', zek: true }, { name: 'Corvale' }, { name: 'Quillon', known: { is_zek: true } }],
    recentGone: [{ name: 'Vessk', zek: true }, { name: 'Nyssara' }],
  };

  it('the overlay keeps only Zek rows in both lists, and still knows the full count', () => {
    const on = listsFor(snap, true);
    expect(on.current.map(r => r.name)).toEqual(['Ozzar', 'Quillon']);
    expect(on.gone.map(r => r.name)).toEqual(['Vessk']);
    expect(on.total).toBe(3);   // "Zek 2 of 3".
    const off = listsFor(snap, false);
    expect(off.current).toHaveLength(3);
    expect(off.gone).toHaveLength(2);
  });

  it('copes with no /who yet', () => {
    expect(listsFor(null, true)).toEqual({ current: [], gone: [], total: 0 });
    expect(isZek(null)).toBe(false);
  });
});

describe('the overlay draws the guild under the name', () => {
  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'who.html'));
  const esc = sliceBlock(html, 'function esc(s){', '}); }');
  const card = sliceBlock(html, 'function targetHtml(t){', '\n  }');
  const { targetHtml } = evalBlock('var _zoneCol = false;\n' + esc + '\n' + card, ['targetHtml']);

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

  // Italic means "our data, not the game's": history only. Zeal's level is exact and current.
  it('a level from history is italic; one from /who, Zeal or an even con is not', () => {
    const lvlClass = (src) => targetHtml({ name: 'Quillon', class: 'Necromancer', level: 60, level_src: src }).match(/<span class="lvl([^"]*)">L60/)[1];
    expect(lvlClass('history')).toBe(' deanon');
    for (const src of ['zeal', 'who', 'con']) expect(lvlClass(src)).toBe('');
  });
});
