// test/who-zone-column.test.js — the /who overlay's Zone column.
//
// The guild lead, 2026-09-29: "lets include zone on /who overlay as toggleable column".
//
// Runs the agent's REAL /who run tracking (recordWhoEvent, applyWhoLine) and buildWhoSnapshot, and
// the overlay's REAL row markup. `/who all` puts a zone on every row; a plain /who puts none there,
// and names the zone in its footer instead. Names are invented.
//
// Run: npx vitest run test/who-zone-column.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const runBlock = sliceBlock(agent, 'function recordWhoEvent(ev) {', '\n// Who-lookup cache')
  .replace(/\n\/\/ Who-lookup cache$/, '');
const whoBlock = sliceBlock(agent, '// PVP threat-priority ordering for the /who overlay.', '\n// Capture a /guildstatus result')
  .replace(/\n\/\/ Capture a \/guildstatus result$/, '');
const noManaRx = agent.match(/const _NO_MANA_CLASSES = [^\n]+/)[0];

function load() {
  const pre = `
    const whoData = new Map();
    function confirmPlayer() {}
    function parseEqTimestamp() { return null; }
    const _whoLookupCache = new Map();
    const WHO_LOOKUP_TTL_MS = 5 * 60 * 1000;
    function fetchWhoLookup() {}
    function _currentTargetState() { return null; }
    const _raidClassByName = new Map();
    function _zealLevelFor() { return null; }
    function conLevelFor() { return null; }
    function normalizeClass(s) { return s; }
    function pvpDrainState() { return null; }
    ${noManaRx}
  `;
  return evalBlock(pre + runBlock + '\n' + whoBlock, ['recordWhoEvent', 'applyWhoLine', 'buildWhoSnapshot', 'whoData']);
}

const T = '[Tue Sep 29 01:00:00 2026] ';
const ev = (name, extra = {}) => ({ name, class: 'Bard', level: 60, guild: 'Wolf Pack', anonymous: false, gm: false,
  zone: null, ts: new Date().toISOString(), ...extra });
function who(h, header, rows, footer) {
  h.applyWhoLine(T + header);
  for (const r of rows) h.recordWhoEvent(r);
  h.applyWhoLine(T + footer);
}
const zones = (s) => Object.fromEntries(s.current.concat(s.recentGone).map((r) => [r.name, r.zone]));

describe('the agent sends each row\'s zone', () => {
  it('a plain /who: everyone gets the zone its footer names', () => {
    const h = load();
    who(h, 'Players in EverQuest:', [ev('Rethlan'), ev('Corvale')], 'There are 2 players in The Wakening Land.');
    expect(zones(h.buildWhoSnapshot())).toEqual({ Rethlan: 'The Wakening Land', Corvale: 'The Wakening Land' });
  });

  it('one player: "There is 1 player in …"', () => {
    const h = load();
    who(h, 'Players in EverQuest:', [ev('Nyssara')], 'There is 1 player in Plane of Hate.');
    expect(zones(h.buildWhoSnapshot())).toEqual({ Nyssara: 'Plane of Hate' });
  });

  it('/who all: each row\'s own zone; a row with none (anon) is blank, not an old zone', () => {
    const h = load();
    who(h, 'Players in EverQuest:', [ev('Brackwyn')], 'There are 1 players in The Wakening Land.');
    who(h, 'Players on EverQuest:', [
      ev('Rethlan', { zone: 'poknowledge' }),
      ev('Corvale', { zone: 'wakening' }),
      ev('Brackwyn', { anonymous: true, class: null, level: null }),
    ], 'There are 3 players in EverQuest.');
    expect(zones(h.buildWhoSnapshot())).toEqual({ Rethlan: 'poknowledge', Corvale: 'wakening', Brackwyn: null });
  });

  it('recently gone keeps the zone they were last seen in', () => {
    const h = load();
    who(h, 'Players on EverQuest:', [ev('Zarrin', { zone: 'sebilis' }), ev('Corvale', { zone: 'sebilis' })], 'There are 2 players in EverQuest.');
    who(h, 'Players in EverQuest:', [ev('Corvale')], 'There is 1 player in Plane of Knowledge.');
    const s = h.buildWhoSnapshot();
    expect(s.current.map((r) => [r.name, r.zone])).toEqual([['Corvale', 'Plane of Knowledge']]);
    expect(s.recentGone.map((r) => [r.name, r.zone])).toEqual([['Zarrin', 'sebilis']]);
  });

  // Until 2026-10-01 the footer's zone stayed out of the upload (§73). The guild lead: "using /who all
  // doesn't give us who is in my current zone. it gives every zone." A plain /who is the one people
  // type, so its rows now upload the zone the footer names (lower-cased); a later plain /who moves
  // someone a /who all had placed elsewhere.
  it('the uploaded /who rows take a plain /who\'s footer zone, lower-cased', () => {
    const h = load();
    who(h, 'Players on EverQuest:', [ev('Rethlan', { zone: 'poknowledge' })], 'There are 1 players in EverQuest.');
    expect(h.whoData.get('rethlan').zone).toBe('poknowledge');
    who(h, 'Players in EverQuest:', [ev('Rethlan'), ev('Corvale')], 'There are 2 players in Plane of Storms.');
    expect(h.whoData.get('rethlan').zone).toBe('plane of storms');
    expect(h.whoData.get('corvale').zone).toBe('plane of storms');
  });
  it('a /who all row without a zone (an /anon player) gets none from the footer', () => {
    const h = load();
    who(h, 'Players on EverQuest:', [ev('Rethlan', { zone: 'postorms' }), ev('Corvale')], 'There are 2 players in EverQuest.');
    expect(h.whoData.get('rethlan').zone).toBe('postorms');
    expect(h.whoData.get('corvale').zone).toBe(null);
  });
  it('names already known still go up: the next who flush runs when a plain /who placed them', () => {
    expect(agent).toMatch(/if \(w\) \{ w\.zone = zone\.toLowerCase\(\); _whoZoneDirty = true; \}/);
    expect(agent).toMatch(/if \(\(whoData\.size > _whoDataLastSize \|\| _whoZoneDirty\) && \(now - _whoDataLastFlush\) >= 5000\) \{/);
  });
});

describe('the overlay draws the column only when switched on', () => {
  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'who.html'));
  const block = [
    'var _zoneCol = false; var _pendingClass = {}; var CLASS_GRACE_MS = 12000;',
    'function ago(){ return \'5m\'; } function classPickerHtml(){ return \'\'; }',
    'function _setZoneCol(v){ _zoneCol = v; }',
    sliceBlock(html, 'function esc(s){', '}); }'),
    sliceBlock(html, 'function isZek(p){', '}'),
    sliceBlock(html, 'function zoneColHtml(zone){', '\n  }'),
    sliceBlock(html, 'function rowHtml(p, gone){', '\n  }'),
    sliceBlock(html, 'function targetHtml(t){', '\n  }'),
  ].join('\n');
  const { rowHtml, targetHtml, _setZoneCol } = evalBlock(block, ['rowHtml', 'targetHtml', '_setZoneCol']);
  const row = { name: 'Rethlan', class: 'Bard', level: 60, guild: 'Wolf Pack', zone: 'poknowledge' };

  it('off: no column at all', () => {
    _setZoneCol(false);
    expect(rowHtml(row, false)).not.toContain('class="zn"');
    expect(targetHtml({ name: 'Corvale', class: 'Cleric', level: 60 })).not.toContain('class="zn"');
  });

  it('on: the zone after the level, with the full text on hover', () => {
    _setZoneCol(true);
    expect(rowHtml(row, false)).toContain('>L60</span><span class="zn" title="poknowledge">poknowledge</span></div>');
  });

  it('on: an unknown zone still holds the column, and the target card lines up with it', () => {
    _setZoneCol(true);
    expect(rowHtml({ ...row, zone: null }, false)).toContain('<span class="zn"></span>');
    expect(targetHtml({ name: 'Corvale', class: 'Cleric', level: 60 })).toContain('<span class="zn"></span>');
  });

  it('on, recently gone: the zone sits before "· 5m ago"', () => {
    _setZoneCol(true);
    expect(rowHtml(row, true)).toMatch(/<span class="zn"[^>]*>poknowledge<\/span><span class="goneAt">· 5m ago<\/span>/);
  });

  it('escapes the zone', () => {
    _setZoneCol(true);
    expect(rowHtml({ ...row, zone: '<b>x</b>' }, false)).not.toContain('<b>x');
  });
});
