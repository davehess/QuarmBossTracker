// test/timer-name-picker.test.js — the Timers canvas name picker's autocomplete (FB-112).
//
// The guild lead, 2026-10-29: the control that makes a Timers panel claim timers by name should "autocomplete and
// also suggest your most often cast timers and the spells you have on your bars right now. alpha order". What must
// hold:
//   • names are compared through one normalizer, which now also folds curly quotes to the apostrophe;
//   • the list is one row per normalized name, ALPHABETICAL whatever the source, tagged with where it came from,
//     filtered by what was typed, capped, and never offers a name the panel already claims;
//   • the agent counts your own casts per character, decayed and capped, from live casts only, and the picker's GET
//     answers with the gems on the bar (Zeal labels 60-67) and the most-cast names;
//   • the box never takes the keyboard on its own, and Escape closes the list before it closes the menu.
// The pure parts run as real code (evalBlock); the wiring is checked on comment-stripped source.
//
// Run: npx vitest run test/timer-name-picker.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const canvasSrc = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const agentSrc  = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const canvas = stripJs(canvasSrc);
const agent  = stripJs(agentSrc);

function pickerRules() {
  const block = sliceBlock(canvasSrc, '  function normEffect(s) {', 'return by[k]; });\n  }');
  return evalBlock(block, ['normEffect', 'mergeSuggestions']);
}

describe('normEffect: one name form', () => {
  const { normEffect } = pickerRules();
  it('folds curly quotes, the backtick, the unconfirmed ? and the tick mark', () => {
    expect(normEffect('Solon’s Bewitching Bravura')).toBe("solon's bewitching bravura");
    expect(normEffect('Solon‘s Bewitching Bravura')).toBe("solon's bewitching bravura");
    expect(normEffect('Solon`s Bewitching Bravura')).toBe("solon's bewitching bravura");
    expect(normEffect("Solon's Bewitching Bravura")).toBe("solon's bewitching bravura");
    expect(normEffect('Tashania? ⏱')).toBe('tashania');
    expect(normEffect(null)).toBe('');
  });
});

describe('mergeSuggestions: the picker list', () => {
  const { mergeSuggestions } = pickerRules();
  const src = {
    gems: ['Tashania', 'Shield of Words', 'Alaran`s Ward'],
    casts: [{ name: 'tashania', n: 23 }, { name: 'Malo', n: 8.4 }, { name: 'Zarrin’s Grasp', n: 1 }],
    live: ['Malo', 'Death Touch', 'Tashania? ⏱'],
  };

  it('is alphabetical by normalized name, whatever the source', () => {
    const names = mergeSuggestions(src, '', [], 30).map(r => r.name);
    expect(names).toEqual(["alaran's ward", 'death touch', 'malo', 'shield of words', 'tashania', "zarrin's grasp"]);
  });

  it('is case-insensitive: an upper-case source name sorts with the lower-case ones', () => {
    const names = mergeSuggestions({ gems: ['bravura', 'Aegis', 'cleanse'], casts: [], live: ['Banish'] }, '', [], 30).map(r => r.name);
    expect(names).toEqual(['aegis', 'banish', 'bravura', 'cleanse']);
  });

  it('one row per name, with every source it came from as a tag', () => {
    const rows = mergeSuggestions(src, '', [], 30);
    expect(rows.filter(r => r.name === 'tashania')).toHaveLength(1);
    expect(rows.find(r => r.name === 'tashania').tags).toEqual(['on your bar', 'cast 23×', 'live now']);
    expect(rows.find(r => r.name === 'malo').tags).toEqual(['cast 8×', 'live now']);
    expect(rows.find(r => r.name === 'death touch').tags).toEqual(['live now']);
    expect(rows.find(r => r.name === 'shield of words').tags).toEqual(['on your bar']);
    // a count under one still reads as one cast, never "cast 0"
    expect(mergeSuggestions({ casts: [{ name: 'x', n: 0.6 }] }, '', [], 30)[0].tags).toEqual(['cast 1×']);
  });

  it('narrows as you type (anywhere in the name), through the same normalizer', () => {
    expect(mergeSuggestions(src, 'shie', [], 30).map(r => r.name)).toEqual(['shield of words']);
    expect(mergeSuggestions(src, 'ASH', [], 30).map(r => r.name)).toEqual(['tashania']);
    // a typed curly quote finds the straight-quote name
    expect(mergeSuggestions(src, 'zarrin’s', [], 30).map(r => r.name)).toEqual(["zarrin's grasp"]);
    expect(mergeSuggestions(src, 'zzz', [], 30)).toEqual([]);
  });

  it('leaves out what the panel already claims', () => {
    const names = mergeSuggestions(src, '', ['Malo', 'tashania'], 30).map(r => r.name);
    expect(names).not.toContain('malo');
    expect(names).not.toContain('tashania');
    expect(names).toContain('death touch');
  });

  it('caps the list AFTER filtering and sorting (the first N alphabetically)', () => {
    const many = [];
    for (let i = 0; i < 50; i++) many.push('spell ' + String(i).padStart(2, '0'));
    const shuffled = many.slice().reverse();
    const rows = mergeSuggestions({ gems: shuffled }, '', [], 30);
    expect(rows).toHaveLength(30);
    expect(rows[0].name).toBe('spell 00');
    expect(rows[29].name).toBe('spell 29');
    expect(mergeSuggestions({ gems: shuffled }, 'spell 4', [], 30)).toHaveLength(10);
  });

  it('the list asks for at most 30 rows', () => {
    expect(canvas).toMatch(/mergeSuggestions\(_sugg, inp\.value, p\.names, 30\)/);
  });

  it('survives missing or malformed sources', () => {
    expect(mergeSuggestions(null, '', null, 30)).toEqual([]);
    expect(mergeSuggestions({ gems: [null, ''], casts: [null, {}], live: [undefined] }, '', [], 30)).toEqual([]);
  });
});

describe('cast counts: decayed, capped, per spell', () => {
  const block = sliceBlock(agentSrc, 'const CAST_COUNT_HALFLIFE_MS', 'return rows.slice(0, limit || CAST_COUNT_MAX);\n}');
  const C = evalBlock(block, ['CAST_COUNT_HALFLIFE_MS', 'CAST_COUNT_DROP_MS', 'CAST_COUNT_MAX', 'castCountScore', 'castCountPrune', 'castCountBump', 'castCountTop']);
  const DAY = 86400_000, T0 = Date.UTC(2026, 9, 29);

  it('counts casts by lower-cased spell name', () => {
    const s = {};
    for (let i = 0; i < 3; i++) C.castCountBump(s, 'Tashania', T0);
    C.castCountBump(s, 'MALO', T0);
    expect(C.castCountTop(s, T0, 10)).toEqual([{ name: 'tashania', n: 3 }, { name: 'malo', n: 1 }]);
  });

  it('halves every 30 days, so what you stopped casting sinks below what you cast lately', () => {
    const s = {};
    for (let i = 0; i < 8; i++) C.castCountBump(s, 'old favourite', T0);
    for (let i = 0; i < 3; i++) C.castCountBump(s, 'new favourite', T0 + 60 * DAY);
    const top = C.castCountTop(s, T0 + 60 * DAY, 10);
    expect(top.map(r => r.name)).toEqual(['new favourite', 'old favourite']);
    expect(top.find(r => r.name === 'old favourite').n).toBe(2);   // 8 casts, two half-lives
  });

  it('forgets a spell not cast for 90 days, whatever its count was', () => {
    const s = {};
    for (let i = 0; i < 4000; i++) C.castCountBump(s, 'ancient', T0);
    C.castCountPrune(s, T0 + 100 * DAY, C.CAST_COUNT_MAX);
    expect(s.ancient).toBeUndefined();
  });

  it('keeps at most the cap, dropping the least-cast', () => {
    const s = {};
    for (let i = 0; i < 400; i++) {
      const name = 'spell ' + String(i).padStart(3, '0');
      for (let k = 0; k <= i % 7; k++) C.castCountBump(s, name, T0);
    }
    C.castCountPrune(s, T0, C.CAST_COUNT_MAX);
    expect(Object.keys(s).length).toBeLessThanOrEqual(C.CAST_COUNT_MAX);
    // the seven-cast spells outlive the single-cast ones
    expect(C.castCountTop(s, T0, 5).every(r => r.n === 7)).toBe(true);
    expect(Object.values(s).every(e => e.n >= 3)).toBe(true);
  });

  it('bump itself keeps a runaway store bounded', () => {
    const s = {};
    for (let i = 0; i < 1000; i++) C.castCountBump(s, 'spell ' + i, T0 + i);
    expect(Object.keys(s).length).toBeLessThanOrEqual(C.CAST_COUNT_MAX * 1.25 + 1);
  });

  it('refuses an empty or absurd name', () => {
    const s = {};
    expect(C.castCountBump(s, '   ', T0)).toBe(false);
    expect(C.castCountBump(s, 'x'.repeat(200), T0)).toBe(false);
    expect(Object.keys(s)).toHaveLength(0);
  });
});

describe('the agent side of the picker: gems on the bar, live casts only', () => {
  afterEach(() => { vi.useRealTimers(); });

  // The counting + persistence + GET payload block, run with stand-ins for the agent's state and the disk.
  function agentSide(files, zeal) {
    const start = sliceBlock(agentSrc, 'function _meLabel(st, id) {', '\n}');
    const block = sliceBlock(agentSrc, 'const CAST_COUNT_HALFLIFE_MS', "castCountTop(store, now, CAST_COUNT_MAX) : [] };\n}");
    const pre = 'const path = { join: (...a) => a.join("/") }; const __dirname = "/agent";\n'
      + 'const fs = { readFileSync: (f) => { if (!(f in __files)) throw new Error("ENOENT"); return __files[f]; },'
      + ' writeFileSync: (f, d) => { __files[f] = d; }, renameSync: (a, b) => { __files[b] = __files[a]; delete __files[a]; } };\n'
      + 'const _zealState = __zeal;\n';
    const fn = new Function('__files', '__zeal', pre + start + '\n' + block
      + '\nreturn { _noteCastCount, _timerSuggestions, _castCounts, _castCountsLoad };');
    return fn(files, zeal);
  }
  const gem = (id, value) => ({ id, value });

  it('reads the spell bar from Zeal\'s gem labels 60-67, skipping empty gems', () => {
    const now = Date.now();
    const a = agentSide({}, { Aldenmar: { updatedAt: now, charInfo: [gem(60, 'Tashania'), gem(61, 'Empty'), gem(62, 'Shield of Words'), gem(63, ''), gem(67, 'Malo'), gem(68, 'Not A Gem'), gem(59, 'Nor This')] } });
    const out = a._timerSuggestions();
    expect(out.ok).toBe(true);
    expect(out.character).toBe('Aldenmar');
    expect(out.gems).toEqual(['Tashania', 'Shield of Words', 'Malo']);
  });

  it('a Zeal snapshot older than a minute is not the bar right now', () => {
    const a = agentSide({}, { Aldenmar: { updatedAt: Date.now() - 120_000, charInfo: [gem(60, 'Tashania')] } });
    expect(a._timerSuggestions().gems).toEqual([]);
  });

  it('counts live casts, per character, and answers with the active character\'s', () => {
    const now = Date.now();
    const a = agentSide({}, { Aldenmar: { updatedAt: now, charInfo: [] }, Brackwyn: { updatedAt: now - 30_000, charInfo: [] } });
    a._noteCastCount('Aldenmar', 'Tashania', now);
    a._noteCastCount('Aldenmar', 'Tashania', now);
    a._noteCastCount('Brackwyn', 'Cleanse', now);
    expect(a._timerSuggestions().casts).toEqual([{ name: 'tashania', n: 2 }]);
  });

  it('a cast line from an old log (a replay) is not you casting now', () => {
    const now = Date.now();
    const a = agentSide({}, { Aldenmar: { updatedAt: now, charInfo: [] } });
    a._noteCastCount('Aldenmar', 'Tashania', now - 3600_000);
    a._noteCastCount('Aldenmar', 'Tashania', now + 3600_000);
    expect(a._timerSuggestions().casts).toEqual([]);
  });

  it('with no Zeal, it answers for the character that cast last; with nothing, empty', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-29T20:00:00Z'));
    const a = agentSide({}, {});
    expect(a._timerSuggestions()).toEqual({ ok: true, character: null, gems: [], casts: [] });
    a._noteCastCount('Aldenmar', 'Tashania', Date.now());
    vi.advanceTimersByTime(5000);
    a._noteCastCount('Brackwyn', 'Cleanse', Date.now());
    const out = a._timerSuggestions();
    expect(out.character).toBe('brackwyn');
    expect(out.casts).toEqual([{ name: 'cleanse', n: 1 }]);
  });

  it('reads what an earlier run saved, and drops a corrupt file quietly', () => {
    const now = Date.now();
    const file = '/agent/logsync.cast-counts.json';
    const a = agentSide({ [file]: JSON.stringify({ aldenmar: { tashania: [5, now - 1000], malo: [2, now - 2000] } }) }, { Aldenmar: { updatedAt: now, charInfo: [] } });
    expect(a._timerSuggestions().casts).toEqual([{ name: 'tashania', n: 5 }, { name: 'malo', n: 2 }]);
    const b = agentSide({ [file]: '{not json' }, { Aldenmar: { updatedAt: now, charInfo: [] } });
    expect(b._timerSuggestions().casts).toEqual([]);
  });
});

describe('wiring (comment-stripped source)', () => {
  it('the agent counts every self cast and serves the picker GET', () => {
    expect(agent).toMatch(/function noteSelfCast[\s\S]*?_noteCastCount\(character, m\[1\]\.trim\(\), atMs\)/);
    expect(agent).toMatch(/req\.url === '\/api\/timer-suggestions' && req\.method === 'GET'[\s\S]*?_timerSuggestions\(\)/);
    // local only: the counts are never handed to an upload
    const block = sliceBlock(agent, 'const CAST_COUNT_HALFLIFE_MS', "castCountTop(store, now, CAST_COUNT_MAX) : [] };\n}");
    expect(block).not.toMatch(/fetch\(|http\.request|https\.request|_enqueue|uploadTo/);
  });

  it('the cast-count file is machine-local and ignored by git', () => {
    expect(readSource(path.join(ROOT, '.gitignore'))).toMatch(/logsync\.cast-counts\.json/);
  });

  it('the name box is a combobox with a list inside the menu, which is on the hover handshake', () => {
    expect(canvas).toMatch(/<input type="text" id="mAdd"[^`]*?role="combobox"/);
    expect(canvas).toMatch(/id="mSugg" role="listbox"/);
    expect(canvas).toMatch(/<div id="menu" data-wp-interact>/);
    // the list is not a floating popup
    expect(canvas).not.toMatch(/<datalist/);
  });

  it('rows claim through the existing chip path (one claimName, a name lives in one panel)', () => {
    expect(canvas).toMatch(/class="chip add sg[^"]*"[^>]*data-add="/);
    expect(canvas).toMatch(/else if \(chip && chip\.hasAttribute\('data-add'\)\) \{ claimName\(p, chip\.getAttribute\('data-add'\)\); \}/);
    expect(canvas).toMatch(/_sugg\.shown\[_sugg\.at\]\.name\); save\(\); render\(\)/);
  });

  it('Escape closes the list first and the menu second; Enter on typed text still adds it', () => {
    const fn = sliceBlock(canvas, 'function suggKey(ev, p) {', '\n  }\n');
    expect(fn).toMatch(/ev\.key === 'Escape' && _sugg\.open[\s\S]*?ev\.stopPropagation\(\)[\s\S]*?_sugg\.open = false/);
    const kd = sliceBlock(canvas, "menuEl.addEventListener('keydown'", '\n  });');
    expect(kd.indexOf('suggKey(ev, sp)')).toBeGreaterThan(-1);
    expect(kd.indexOf('suggKey(ev, sp)')).toBeLessThan(kd.indexOf("ev.key === 'Escape') closeMenu()"));
    expect(kd).toMatch(/ev\.key === 'Enter' && ev\.target\.id === 'mAdd'[\s\S]*?mAddBtn/);
  });

  it('never takes the keyboard on its own: nothing in the picker focuses the box', () => {
    const picker = sliceBlock(canvas, 'var _sugg = {', 'function claimName(p, raw) {');
    expect(picker).not.toMatch(/\.focus\(|autofocus/);
    expect(canvas).not.toMatch(/id="mAdd"[^>]*autofocus/);
  });

  it('the live chips are still there, and still skip what the panel already claims', () => {
    expect(canvas).toMatch(/On screen now/);
    expect(canvas).toMatch(/if \(p\.names\.indexOf\(n\) >= 0\) return;\s*h \+= '<span class="chip add" data-add="'/);
  });
});
