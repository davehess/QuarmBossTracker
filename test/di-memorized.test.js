// test/di-memorized.test.js — the CH chain's Divine Intervention tick (FB-62).
//
// A member, 2026-10-07: "If a cleric doesn't have Divine Intervention, we shouldn't show them at the
// bottom of the ch chain area as having DI available. We should only show this tickbox if they have
// it on spell gems and ready to cast."
//
// What was wrong: availability was "no recent cast stamp", so a cleric nobody saw cast DI — no DI
// scribed, not on the bar, or no agent at all — was ✓ by default (the chips treated the agent's
// assumed-ready `up` as a tick). The tick now needs DI on the cleric's spell bar AND no recast.
// A bar nobody could read is `unknown` — a grey "?" — never a tick.
//
// Runs the agent's REAL diStatusSnapshot / _diMemorized / _diRankCandidates over fake Zeal state, and
// the overlay's REAL chip functions over the snapshot's shape. Names are invented.
//
// Run: npx vitest run test/di-memorized.test.js

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, readSource, AGENT_INDEX, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const {
  diStatusSnapshot, _diMemorized, _noteDiCast, _diStateByChar,
  _setDiStatusCacheForTest, _setZealStateForTest, _diRankCandidates,
  trackChChainLine, trackDiFired, _resetChChainForTest, _resetDiCalloutForTest, _activeOverlays,
} = agent;

const GEM_IDS = [60, 61, 62, 63, 64, 65, 66, 67];
// A Zeal state whose spell bar holds `gems` (gem 1 first). An empty gem sends no label at all.
const bar = (gems, over = {}) => ({
  charInfo: [{ id: 2, value: '60' }, { id: 3, value: 'Cleric' },
    ...gems.map((g, i) => (g ? { id: GEM_IDS[i], value: g } : null)).filter(Boolean)],
  gauges: [],
  updatedAt: Date.now(),
  ...over,
});
const WITH_DI = bar(['Complete Healing', 'Divine Intervention', null, 'Word of Redemption']);
const NO_DI = bar(['Complete Healing', 'Word of Redemption', 'Superior Healing']);

afterEach(() => {
  _setDiStatusCacheForTest([]);
  for (const ch of ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan']) _setZealStateForTest(ch, null);
  _diStateByChar.clear();
});

const byName = (snap, n) => snap.clerics.find(c => c.name === n);

describe('_diMemorized — is DI on the spell bar?', () => {
  const now = Date.now();
  it('true when any of the eight gems holds it, whatever its position or case', () => {
    expect(_diMemorized(WITH_DI, now)).toBe(true);
    expect(_diMemorized(bar([null, null, null, null, null, null, null, 'divine intervention']), now)).toBe(true);
  });
  it('false when the bar is readable and it is not there', () => {
    expect(_diMemorized(NO_DI, now)).toBe(false);
  });
  it('the scroll in the book is not the spell on the bar', () => {
    expect(_diMemorized(bar(['Spell: Divine Intervention', 'Complete Healing']), now)).toBe(false);
  });
  it('null — cannot tell — for a bar with no gem names, no Zeal state, or a snapshot gone stale', () => {
    expect(_diMemorized(bar([]), now)).toBe(null);
    expect(_diMemorized(bar(['Empty', 'None']), now)).toBe(null);
    expect(_diMemorized(null, now)).toBe(null);
    expect(_diMemorized({}, now)).toBe(null);
    expect(_diMemorized(bar(['Divine Intervention'], { updatedAt: now - 10 * 60_000 }), now)).toBe(null);
  });
  it('only labels 60-67 are the spell bar', () => {
    const st = { charInfo: [{ id: 59, value: 'Divine Intervention' }, { id: 68, value: 'Divine Intervention' }, { id: 61, value: 'Mend' }], updatedAt: now };
    expect(_diMemorized(st, now)).toBe(false);
  });
});

describe('diStatusSnapshot — who gets a tick', () => {
  it('THE BUG: a cleric nobody saw cast DI, on no one\'s authority, is not ✓', () => {
    _setDiStatusCacheForTest([{ name: 'Aldenmar', ready_at: null }]);
    const s = diStatusSnapshot();
    expect(byName(s, 'Aldenmar')).toMatchObject({ up: false, unknown: true, seconds: 0, mem: null });
    expect(s.up_count).toBe(0);
  });

  it('a cleric the agent says has it memorized, and no recast, is up', () => {
    _setDiStatusCacheForTest([{ name: 'Aldenmar', ready_at: null, mem: true }]);
    const s = diStatusSnapshot();
    expect(byName(s, 'Aldenmar')).toMatchObject({ up: true, unknown: false, seconds: 0, mem: true });
    expect(s.up_count).toBe(1);
  });

  it('a cleric without it on the bar is not listed at all, and is named in no_di', () => {
    _setDiStatusCacheForTest([{ name: 'Aldenmar', ready_at: null, mem: false }, { name: 'Brackwyn', ready_at: null, mem: true }]);
    const s = diStatusSnapshot();
    expect(s.clerics.map(c => c.name)).toEqual(['Brackwyn']);
    expect(s.no_di).toEqual(['Aldenmar']);
  });

  it('on recast is a countdown, with the bar known or not; a past recast with the bar unknown is "?" again', () => {
    const future = new Date(Date.now() + 45_000).toISOString();
    const past = new Date(Date.now() - 45_000).toISOString();
    _setDiStatusCacheForTest([
      { name: 'Aldenmar', ready_at: future, mem: true },
      { name: 'Brackwyn', ready_at: future },
      { name: 'Corvale', ready_at: past },
    ]);
    const s = diStatusSnapshot();
    expect(byName(s, 'Aldenmar')).toMatchObject({ up: false, unknown: false, mem: true });
    expect(byName(s, 'Aldenmar').seconds).toBeGreaterThan(40);
    expect(byName(s, 'Brackwyn')).toMatchObject({ up: false, unknown: false });
    expect(byName(s, 'Brackwyn').seconds).toBeGreaterThan(40);
    expect(byName(s, 'Corvale')).toMatchObject({ up: false, unknown: true, seconds: 0 });
  });

  it('orders ticks, then countdowns, then the ones we cannot read', () => {
    const future = new Date(Date.now() + 45_000).toISOString();
    _setDiStatusCacheForTest([
      { name: 'Aldenmar', ready_at: null },                 // unknown
      { name: 'Brackwyn', ready_at: future, mem: true },    // countdown
      { name: 'Corvale', ready_at: null, mem: true },       // up
    ]);
    expect(diStatusSnapshot().clerics.map(c => c.name)).toEqual(['Corvale', 'Brackwyn', 'Aldenmar']);
  });

  describe('a cleric on THIS machine — their own bar is first-hand', () => {
    it('DI on the bar and never cast: up, even with the bot silent about them', () => {
      _setZealStateForTest('Aldenmar', WITH_DI);
      expect(byName(diStatusSnapshot(), 'Aldenmar')).toMatchObject({ up: true, mem: true });
    });

    it('their bar overrules a bot that thinks they are ready: no DI on it, no row', () => {
      _setDiStatusCacheForTest([{ name: 'Aldenmar', ready_at: null, mem: true }]);
      _setZealStateForTest('Aldenmar', NO_DI);
      const s = diStatusSnapshot();
      expect(byName(s, 'Aldenmar')).toBeUndefined();
      expect(s.no_di).toEqual(['Aldenmar']);
    });

    it('a character on this machine whose bar lacks DI is never listed, cleric or not — and cannot be nominated', () => {
      _setZealStateForTest('Brackwyn', bar(['Taunt']));
      const s = diStatusSnapshot();
      expect(s.clerics).toEqual([]);
      expect(s.no_di).toEqual(['Brackwyn']);
    });

    it('a cast we watched is a countdown, then up again once the recast is over', () => {
      _setZealStateForTest('Aldenmar', WITH_DI);
      _noteDiCast('aldenmar', Date.now() - 10_000);
      let a = byName(diStatusSnapshot(), 'Aldenmar');
      expect(a).toMatchObject({ up: false, unknown: false });
      expect(a.seconds).toBeGreaterThan(80);
      _noteDiCast('aldenmar', Date.now() - 200_000);
      a = byName(diStatusSnapshot(), 'Aldenmar');
      expect(a).toMatchObject({ up: true, unknown: false, seconds: 0 });
    });

    it('swapping DI off the bar after a cast takes the cleric off the list', () => {
      _setZealStateForTest('Aldenmar', NO_DI);
      _noteDiCast('aldenmar', Date.now() - 200_000);
      const s = diStatusSnapshot();
      expect(byName(s, 'Aldenmar')).toBeUndefined();
      expect(s.no_di).toEqual(['Aldenmar']);
    });

    it('a cast we watched with a bar we cannot read is "?" once the recast ends — not a tick', () => {
      _setZealStateForTest('Aldenmar', bar([]));
      _noteDiCast('aldenmar', Date.now() - 200_000);
      expect(byName(diStatusSnapshot(), 'Aldenmar')).toMatchObject({ up: false, unknown: true });
    });

    it('the display name is the one this machine knows, not the bot\'s casing', () => {
      _setDiStatusCacheForTest([{ name: 'ALDENMAR', ready_at: null }]);
      _setZealStateForTest('Aldenmar', WITH_DI);
      expect(diStatusSnapshot().clerics.map(c => c.name)).toEqual(['Aldenmar']);
    });
  });
});

describe('the two-cleric nomination skips a cleric who cannot cast DI', () => {
  const now = 1_700_000_000_000;
  const slots = {};
  ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan'].forEach((name, i) => {
    slots[i + 1] = { name, mana: 60, lastAtMs: now - (4 - i) * 3000, count: 3, kind: null };
  });
  const chain = { slots, beat_ms: 3000, last_ch: { num: 4, name: 'Rethlan', atMs: now - 3000 }, next_num: 1, next_expected_at: now + 60_000 };
  const base = { now, isDead: () => false, classOf: () => null, diOf: () => null, manaOf: () => null };

  // Nothing known about anyone ranks by recency on the chain, so the two most recent are the pick.
  it('the pick, with nothing known, is the two most recent healers', () => {
    expect(_diRankCandidates(chain, base).names.sort()).toEqual(['Corvale', 'Rethlan']);
  });
  it('a cleric whose own agent reports DI is not memorized is never named, however recent', () => {
    const out = _diRankCandidates(chain, { ...base, noDi: (lc) => lc === 'corvale' || lc === 'rethlan' });
    expect(out.names.sort()).toEqual(['Aldenmar', 'Brackwyn']);
  });
});

describe('and through the real chain tracker, from a spell bar this machine reads', () => {
  const BEAT = 3000;
  const stamp = (d) => '[' + d.toDateString().slice(0, 3) + ' ' + d.toDateString().slice(4, 7) + ' ' +
    String(d.getDate()).padStart(2, ' ') + ' ' + d.toTimeString().slice(0, 8) + ' ' + d.getFullYear() + ']';

  it('a death save firing names the clerics who have DI on their bar, not the recent ones who do not', () => {
    _resetChChainForTest(); _resetDiCalloutForTest(); _activeOverlays.length = 0;
    const base = Date.now() - 12 * BEAT;
    const callers = [['Aldenmar', 1], ['Brackwyn', 2], ['Corvale', 3], ['Aldenmar', 1], ['Brackwyn', 2], ['Corvale', 3]];
    callers.forEach(([name, num], i) => {
      trackChChainLine(stamp(new Date(base + i * BEAT)) + ' ' + name + " shouts, '" + String(num).padStart(3, '0') +
        " - CH - Zarrin - Mana: 70%'", 'Watcher');
    });
    // Brackwyn and Corvale called most recently, and neither has DI on the bar; Aldenmar does.
    _setZealStateForTest('Aldenmar', WITH_DI);
    _setZealStateForTest('Brackwyn', NO_DI);
    _setZealStateForTest('Corvale', NO_DI);
    const fired = trackDiFired(stamp(new Date()) + ' Zarrin has been rescued by divine intervention!');
    expect(fired).toBeTruthy();
    expect(fired.names).toEqual(['Aldenmar']);
    _resetChChainForTest(); _resetDiCalloutForTest(); _activeOverlays.length = 0;
  });
});

describe('what the cleric\'s own agent sends', () => {
  const src = stripJs(readSource(AGENT_INDEX));
  it('di_mem rides the live-state row, read off the same Zeal state that decides the tick', () => {
    expect(src).toMatch(/di_mem: _diMemorized\(st, now\),/);
  });
  // (That it is a term of the change signature is pinned in live-state-signature.test.js.)
});

describe('the overlay\'s chips (apps/mimic/chchain.html)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'chchain.html'), 'utf8');
  const start = html.indexOf('  function diChipState(c){');
  const end = html.indexOf('  function renderDi(){', start);
  if (start < 0 || end < 0) throw new Error('DI chip functions not found in chchain.html');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const { diChipState, diChipHtml, diSoloUp } =
    new Function('esc', html.slice(start, end) + '\nreturn { diChipState, diChipHtml, diSoloUp };')(esc);

  const up = { name: 'Aldenmar', up: true, unknown: false, mem: true, seconds: 0 };
  const unk = { name: 'Brackwyn', up: false, unknown: true, mem: null, seconds: 0 };
  const cd = { name: 'Corvale', up: false, unknown: false, mem: true, seconds: 37 };

  it('✓ only for a cleric confirmed on the bar and ready', () => {
    expect(diChipHtml(up)).toContain('✓ Aldenmar');
    expect(diChipHtml(unk)).not.toContain('✓');
    expect(diChipHtml(cd)).not.toContain('✓');
  });
  it('a cleric nobody could read is a grey "?" with no tick', () => {
    const h = diChipHtml(unk);
    expect(h).toContain('di-chip unk');
    expect(h).toContain('Brackwyn ?');
  });
  it('a recast is a countdown in seconds', () => {
    expect(diChipHtml(cd)).toMatch(/di-chip cd">Corvale <span class="di-sec">37s</);
  });
  it('an older agent\'s assumed-ready `up` (no mem field) is never a tick', () => {
    expect(diChipState({ name: 'Rethlan', up: true, unknown: false, seconds: 0 })).toBe('unk');
    expect(diChipHtml({ name: 'Rethlan', up: true, seconds: 0 })).not.toContain('✓');
  });
  it('names are escaped', () => {
    expect(diChipHtml({ ...up, name: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  describe('"only <X> has D I up" is spoken, so it has to be true', () => {
    it('one tick among countdowns: it fires, for that cleric', () => {
      expect(diSoloUp({ clerics: [up, cd] })).toBe(up);
    });
    it('not while a "?" cleric might also have it', () => {
      expect(diSoloUp({ clerics: [up, cd, unk] })).toBe(null);
      expect(diSoloUp({ clerics: [up, unk] })).toBe(null);
    });
    it('not for two ticks, not for one lone cleric, not for nothing', () => {
      expect(diSoloUp({ clerics: [up, { ...up, name: 'Zarrin' }] })).toBe(null);
      expect(diSoloUp({ clerics: [up] })).toBe(null);
      expect(diSoloUp({ clerics: [] })).toBe(null);
      expect(diSoloUp(null)).toBe(null);
    });
  });

  // renderDi itself, over a stub page: it has to DRAW with those functions, not beside them.
  describe('renderDi puts them on the page', () => {
    const rs = html.indexOf('  var _lastDi = null;');
    const re = html.indexOf('  // DI nomination (#204)', rs);
    if (rs < 0 || re < 0) throw new Error('renderDi block not found in chchain.html');
    function page() {
      const els = {
        diready: { style: {}, classList: { toggle(c, on) { this[c] = !!on; } } },
        direadyRows: { innerHTML: '' },
      };
      const spoken = [];
      const api = new Function('esc', 'document', 'speakGap',
        html.slice(rs, re) + '\nreturn { renderDi: renderDi, set: function(d){ _lastDi = d; } };')(
        esc, { getElementById: (id) => els[id] }, (t) => spoken.push(t));
      return { els, spoken, show: (d) => { api.set(d); api.renderDi(); } };
    }
    it('an unread cleric is drawn "?", a confirmed one ticked, and nothing is spoken over the "?"', () => {
      const p = page();
      p.show({ clerics: [up, unk], up_count: 1 });
      expect(p.els.direadyRows.innerHTML).toContain('✓ Aldenmar');
      expect(p.els.direadyRows.innerHTML).toContain('Brackwyn ?');
      expect(p.els.direadyRows.innerHTML).not.toContain('✓ Brackwyn');
      expect(p.spoken).toEqual([]);
      expect(p.els.diready.classList['di-last']).toBe(false);
    });
    it('one tick among countdowns is spoken once, and rings the section', () => {
      const p = page();
      p.show({ clerics: [up, cd], up_count: 1 });
      p.show({ clerics: [up, cd], up_count: 1 });
      expect(p.spoken).toEqual(['only Aldenmar has D I up — save it for the tank']);
      expect(p.els.diready.classList['di-last']).toBe(true);
    });
    it('no clerics hides the section', () => {
      const p = page();
      p.show({ clerics: [], up_count: 0 });
      expect(p.els.diready.style.display).toBe('none');
    });
  });
});
