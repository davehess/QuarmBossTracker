// test/meter-tank-history.test.js — Tank History: the fight picked in History shows on whichever of the DPS / Tank
// buttons is lit (Decision Desk "Same list, both tabs", 2026-10-19; docs/DESIGN-history-and-quest-nav.md §2).
//
// The guild lead, 2026-10-04: "damage/tanking meter could have more history in it." DPS shows the fight's damage;
// Tank shows damage taken, the biggest single hit and the damage shield. The agent already stored `took` and
// `tookMax` per player ("kept for a Tank History to come"); this adds the shield, keeps a tank who dealt nothing,
// and renders it.
//
// The agent runs for real (a real EncounterBuilder fed log lines, the real _recordFightHistory); the overlay's
// row builder, chip block and tab handlers run as slices, the tabs over a fake DOM. Names are invented.
//
// Run: npx vitest run test/meter-tank-history.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT, AGENT_INDEX } from './_source-slice.js';
import path from 'node:path';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const overlay = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const agentSrc = readSource(AGENT_INDEX);
const js = stripJs(overlay);
const sliceTo = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); if (a < 0 || b < 0) throw new Error('block not found: ' + from); return src.slice(a, b); };

const { _foldPetsIntoOwners, _histRows, _histTankRows } = evalBlock(
  sliceBlock(overlay, '  function _foldPetsIntoOwners(allRows){', '\n  // ── Poll loop '),
  ['_foldPetsIntoOwners', '_histRows', '_histTankRows'],
);
const fmt = new Function(sliceTo(overlay, '  function fmt(n){', '\n') + '\nreturn fmt;')();

const MOB = 'a Shissar acolyte';
let _min = 0;
function feeder(b) {
  const minute = String(10 + (_min++ % 50)).padStart(2, '0');
  let sec = 0;
  return (line) => {
    const full = `[Tue Sep 29 08:${minute}:${String(sec++ % 60).padStart(2, '0')} 2026] ${line}`;
    const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
    if (!ev) throw new Error('unparsed test line: ' + line);
    b.add(ev);
  };
}
const builder = (character) => new agent.EncounterBuilder({ character, onFlush: () => {} });
function record(b, character) {
  agent._resetFightHistoryForTest();
  b._publishLiveThreat();
  const et = agent._liveThreatForTest();
  agent._recordFightHistory({ ...et, flushedAt: Date.now() }, character);
  return { et, entry: agent._fightHistoryForTest()[0] };
}

describe('the agent keeps what Tank History shows', () => {
  it('damage taken, the biggest hit and the shield, per tank, in the stored fight', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`${MOB} hits Corvale for 210 points of damage.`);
    feed(`${MOB} hits Corvale for 340 points of damage.`);
    feed(`${MOB} was hit by non-melee for 9 points of damage.`);
    feed(`${MOB} was pierced by thorns.`);
    const { et, entry } = record(b, 'Brackwyn');
    expect(et.dsBy).toEqual({ corvale: 9 });
    expect(entry.local[0]).toMatchObject({ character: 'Corvale', took: 550, tookMax: 340, ds: 9 });
  });

  it('a tank who dealt nothing but ate the fight still gets a row (it used to be dropped)', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`${MOB} hits YOU for 210 points of damage.`);
    const { entry } = record(b, 'Brackwyn');
    const row = entry.local.find(p => p.character === 'Brackwyn');
    expect(row).toMatchObject({ dmg: 0, took: 210, tookMax: 210 });
    expect(row.ds).toBeUndefined();
  });

  it('no shield landed: no dsBy on the snapshot, no ds on a row', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`${MOB} hits Corvale for 210 points of damage.`);
    const { et, entry } = record(b, 'Brackwyn');
    expect(et.dsBy).toBeUndefined();
    expect(entry.local.find(p => p.character === 'Corvale').ds).toBeUndefined();
  });

  it('a zero-damage tank row is not a fight "dealt" for the Me overlay\'s night tally', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`${MOB} hits YOU for 210 points of damage.`);
    const { entry } = record(b, 'Brackwyn');
    const { _meNoteFight, _meNight } = evalBlock(
      sliceBlock(agentSrc, 'const _meNight = { key: null', '\n}\n') + sliceBlock(agentSrc, 'function _meNoteFight(entry) {', '\n}\n'),
      ['_meNoteFight', '_meNight']);
    _meNoteFight(entry);
    expect(_meNight.byChar.get('corvale')).toMatchObject({ dmg: 500, fights: 1 });
    expect(_meNight.byChar.has('brackwyn')).toBe(false);
  });

  it('the shield rides a sibling of perPlayer, so the threat upload does not grow', () => {
    const snap = stripJs(sliceTo(agentSrc, '    // Damage-shield damage per wearer (lowercase name', '    // Pet aggro rollup'));
    expect(snap).toContain('snap.dsBy = dsBy');
    expect(snap).not.toMatch(/perPlayer\[[^\]]*\]\.ds\b/);
  });
});

// A stored fight: a tank with a shield, a second tank, a charmed pet that took hits for its owner, a raider who took none.
const fight = (over = {}) => ({
  boss: 'Lord Vyemm', durationSec: 100, endedMs: 1_790_000_000_000, settled: true,
  local: [
    { character: 'Corvale', dmg: 509, took: 5000, tookMax: 900, ds: 1200 },
    { character: 'Aldenmar', dmg: 9000 },
    { character: 'Brackwyn', dmg: 0, took: 1000, tookMax: 300 },
    { character: 'a fungoid sporeling', dmg: 100, pet_owner: 'Rethlan', took: 400, tookMax: 700, ds: 50 },
  ],
  ...over,
});

describe('the Tank view of a stored fight', () => {
  it('biggest taker first, with the biggest hit and the shield; a raider who took nothing is not on it', () => {
    const rows = _histTankRows(fight());
    expect(rows.map(r => [r[0], r[1], r[2], r[13]])).toEqual([
      ['Corvale', 5000, 900, 1200],
      ['Brackwyn', 1000, 300, 0],
      ['Rethlan', 400, 700, 50],
    ]);
  });

  it('an owned pet is folded into its owner, as the DPS rows do: taken summed, biggest hit the larger, +pet marked', () => {
    const rows = _histTankRows(fight({ local: [
      { character: 'Rethlan', dmg: 10, took: 1000, tookMax: 300, ds: 5 },
      { character: 'a fungoid sporeling', dmg: 100, pet_owner: 'Rethlan', took: 400, tookMax: 700, ds: 50 },
    ] }));
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('Rethlan');
    expect(rows[0][1]).toBe(1400);
    expect(rows[0][2]).toBe(700);
    expect(rows[0][13]).toBe(55);
    expect(rows[0][8]).toBe(true);
  });

  it('an unowned multi-word name is not a raider and stays off it', () => {
    expect(_histTankRows(fight({ local: [{ character: 'a gnoll', dmg: 5, took: 100 }] }))).toEqual([]);
  });

  it('a fight stored before the agent kept damage taken has no rows rather than a wrong board', () => {
    expect(_histTankRows(fight({ local: [{ character: 'Corvale', dmg: 509 }] }))).toEqual([]);
    expect(_histTankRows({ boss: 'x' })).toEqual([]);
  });

  it('and the DPS view of the same fight is untouched: damage, biggest first, the tank with none left out', () => {
    expect(_histRows(fight()).map(r => [r[0], r[1]])).toEqual([['Aldenmar', 9000], ['Corvale', 509], ['Rethlan', 100]]);
  });
});

describe('the row it draws', () => {
  const chipBlock = sliceTo(overlay, '        var maxHitHtml = (isTank && mx > 0)', "        var cls = 'pbrow'");
  const chips = (isTank, mx, row) => new Function('isTank', 'mx', 'row', 'fmt', chipBlock + '\nreturn maxHitHtml;')(isTank, mx, row, fmt);

  it('Tank: the biggest hit, then the damage shield', () => {
    const h = chips(true, 900, ['Corvale', 5000, 900, null, 1, 0, false, undefined, false, null, undefined, null, null, 1200]);
    expect(h).toContain('class="maxhit"');
    expect(h).toContain('·900');
    expect(h).toContain('class="dsret"');
    expect(h).toContain('DS 1.20K');
    expect(h.indexOf('maxhit')).toBeLessThan(h.indexOf('dsret'));
  });
  it('a tank with no shield shows no shield', () => {
    expect(chips(true, 300, ['Brackwyn', 1000, 300, null, 2, 0, false, undefined, false, null, undefined, null, null, 0])).not.toContain('dsret');
  });
  it('DPS never shows either', () => {
    expect(chips(false, 900, ['Corvale', 509, 900, null, 1, 0, false, undefined, false, null, undefined, null, null, 1200])).toBe('');
  });
  it('the live Tank tab (rows with no shield) is unchanged', () => {
    expect(chips(true, 450, ['Corvale', 5000, 450, null, 1, 0, false, undefined, false, null, undefined, 1, 2])).toContain('·450');
  });
});

// The tab handlers over a fake DOM: the block from the saved mode through the History button's click.
function tabs(saved = {}) {
  const store = { ...saved };
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const els = {};
  const mk = (id) => {
    const cls = new Set(), L = {};
    return {
      id, dataset: {}, listeners: L,
      classList: { toggle(c, on) { if (on === undefined) on = !cls.has(c); if (on) cls.add(c); else cls.delete(c); }, add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
      addEventListener(t, f) { (L[t] = L[t] || []).push(f); },
      click() { (L.click || []).forEach(f => f({ target: null })); },
      get on() { return cls.has('on'); },
    };
  };
  const document = { getElementById: id => els[id] || (els[id] = mk(id)), body: mk('body') };
  els.tabDps = mk('tabDps'); els.tabDps.classList.add('on');   // the markup's default
  let ticks = 0;
  const code = sliceTo(overlay, "  var TAB_MODE_KEY = 'wp.damageTabMode';", "  // A row's index is its place in the ring");
  const api = new Function('document', 'localStorage', 'tick', 'window',
    code + '\nreturn { mode: () => TAB_MODE, view: () => HIST_VIEW, live: () => LIVE_TAB, setTab: _setTab };')(document, localStorage, () => { ticks++; return Promise.resolve(); }, { mimic: {} });
  return { api, store, ticks: () => ticks, dps: els.tabDps, tank: els.tabTank, hist: els.tabHist, body: document.body };
}

describe('DPS / Tank / History buttons', () => {
  it('outside History they are the live tabs, as ever', () => {
    const t = tabs();
    t.tank.click();
    expect(t.api.mode()).toBe('tank');
    expect([t.dps.on, t.tank.on, t.hist.on]).toEqual([false, true, false]);
  });

  it('History opens lit on its DPS view, and its Tank button then shows the fight\'s damage taken without leaving History', () => {
    const t = tabs();
    t.hist.click();
    expect(t.api.mode()).toBe('history');
    expect([t.dps.on, t.tank.on, t.hist.on]).toEqual([true, false, true]);
    expect(t.body.classList.contains('hist')).toBe(true);
    const before = t.ticks();
    t.tank.click();
    expect(t.api.mode()).toBe('history');
    expect(t.api.view()).toBe('tank');
    expect([t.dps.on, t.tank.on, t.hist.on]).toEqual([false, true, true]);
    expect(t.store['wp.damageHistView']).toBe('tank');
    expect(t.store['wp.damageTabMode']).toBe('history');
    expect(t.ticks()).toBeGreaterThan(before);       // repainted at once, not on the next poll
    t.dps.click();
    expect(t.api.view()).toBe('dps');
    expect([t.dps.on, t.tank.on]).toEqual([true, false]);
  });

  it('History clicked again goes back to the live tab it came from', () => {
    const t = tabs();
    t.tank.click();
    t.hist.click();
    t.dps.click();                                    // browsing on the DPS view
    t.hist.click();
    expect(t.api.mode()).toBe('tank');                // not DPS: that is where it came from
    expect(t.body.classList.contains('hist')).toBe(false);
    expect([t.dps.on, t.tank.on, t.hist.on]).toEqual([false, true, false]);
  });

  it('a restart in History brings back the view that was open', () => {
    const t = tabs({ 'wp.damageTabMode': 'history', 'wp.damageHistView': 'tank' });
    expect(t.api.mode()).toBe('history');
    expect([t.dps.on, t.tank.on, t.hist.on]).toEqual([false, true, true]);
    expect(t.body.classList.contains('hist')).toBe(true);
    t.hist.click();
    expect(t.api.mode()).toBe('dps');                 // no live tab to remember: the default
  });

  it('History opened with the Tank view remembered lights Tank, not DPS', () => {
    const t = tabs({ 'wp.damageHistView': 'tank' });
    t.hist.click();
    expect([t.dps.on, t.tank.on, t.hist.on]).toEqual([false, true, true]);
  });

  it('a Trend row still opens History on the fight it drew', () => {
    const t = tabs();
    t.api.setTab('history', 3);
    expect(t.api.mode()).toBe('history');
  });
});

describe('what the board is built from', () => {
  it('the Tank view is the Tank tab or History with its Tank button lit', () => {
    expect(js).toContain("var isTank = TAB_MODE === 'tank' || (TAB_MODE === 'history' && HIST_VIEW === 'tank');");
  });
  it('History picks the Tank rows on that view, and the guild merge only on the DPS view', () => {
    expect(js).toMatch(/allRows = isTank \? _histTankRows\(HIST\) : histDmgRows;/);
    expect(js).toMatch(/if \(!isTank && HIST && Array\.isArray\(HIST\.players\) && HIST\.players\.length\) GUILD = HIST;/);
  });
  it('the copied /rs line is always the damage parse, even from the Tank view', () => {
    expect(js).toMatch(/_histParseLine = _rsLine\(boss, secs, histDmgTotal, histDmgRows\);/);
  });
  it('the columns, per-row timing, total label and mini rows follow the view, not the tab', () => {
    expect(js).toContain('_rowTiming(row, secs, isTank, _fightEndMs(allRows))');
    expect(js).toMatch(/colD\s*\.textContent = isTank \? 'Taken'/);
    expect(js).toMatch(/colDps\s*\.textContent = isTank \? 'DTPS'/);
    expect(js).toContain("(isTank ? 'Raid taken' : 'Mob total')");
    expect(js).toContain('miniRowsHtml(miniWindow(miniRows, me), me, totalDmg, secs, isTank,');
  });
  it('the Tank view names this machine as its source: there is nothing from the guild to wait for', () => {
    expect(js).toMatch(/hdrEl\.textContent = HIST\.boss \+ \(isTank\s*\n?\s*\? ' · this machine'/);
  });
  it('an empty Tank view says damage TAKEN was not recorded', () => {
    expect(js).toContain("(isTank ? 'no damage taken recorded for that fight'");
  });
});
