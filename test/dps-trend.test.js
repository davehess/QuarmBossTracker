// DPS/Tank Meter → Trend: my damage per fight, as a line (the guild lead, 2026-10-06).
//
// "B as part of alpha canvas" became "a view on the DPS/Tank Meter, on beta": a fourth tab after History
// that draws the player's own damage per fight, tonight or over 7 days, from the same local fight ring
// History lists. Three tiers here:
//   • the pure parts (pick me out of a fight, pet credit, DPS math, the 6am cutoff, the sparkline's SVG)
//     sliced out of overlay.html and run on fixtures;
//   • the page's WHOLE script run against a small fake DOM, so the wiring is exercised: what it fetches
//     and when, who "me" is, what a toggle remembers, what a row does;
//   • the markup and the style rules, with comments stripped before any text is matched.
// Names are invented (they are conventions, not people).
//
// Run: npx vitest run test/dps-trend.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, evalBlock, stripJs, stripCss } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const lineOf = (src, start) => src.slice(src.indexOf(start), src.indexOf('\n', src.indexOf(start)));
const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

const T = evalBlock(
  lineOf(html, '  function fmt(n){') + '\n' + lineOf(html, '  function esc(s){') + '\n'
  + sliceBlock(html, '  // ── Trend: the pure parts (begin) ──', '  // ── Trend: the pure parts (end) ──'),
  ['_trendNightKey', '_trendMine', '_trendHasTook', '_trendSeries', '_trendSvg', '_trendEmpty', '_trendHtml', 'TREND_COL', 'TREND_ROWS'],
);

// Local-time stamps on 2026-10-06 (and its neighbours): the 6am cut is a LOCAL one, so the fixtures are
// built with the local constructor and mean the same whatever zone the suite runs in.
const at = (day, h, m = 0) => new Date(2026, 9, day, h, m, 0).getTime();
const row = (character, dmg, took, owner) => Object.assign({ character, dmg, pet_owner: owner || null }, took ? { took } : {});
const fight = (boss, endedMs, durationSec, local) => ({ boss, startedMs: endedMs - durationSec * 1000, endedMs, durationSec, local, players: [], settled: true });

// The ring as the agent keeps it: newest first. `i` below is the place in it.
const RING = [
  /* 0 */ fight('Lord Vyemm', at(6, 20, 45), 100, [row('Aldenmar', 9000, 300), row('a fungoid sporeling', 1000, 100, 'Aldenmar'), row('a charmed orc', 700), row('Brackwyn', 20000)]),
  /* 1 */ fight('a pulled add', at(6, 20, 30), 0, [row('Aldenmar', 500)]),                      // no duration: no rate
  /* 2 */ fight('a Shissar acolyte', at(6, 20, 10), 20, [row('Aldenmar', 3000), row('Brackwyn', 800)]),
  /* 3 */ fight('Lord Nagafen', at(6, 19, 0), 60, [row('Brackwyn', 5000)]),                     // I did nothing
  /* 4 */ fight('a sleeper', at(6, 6, 0), 50, [row('Aldenmar', 2500, 250)]),                    // 06:00:00 sharp: tonight
  /* 5 */ fight('a gnoll', at(6, 5, 59), 40, [row('Aldenmar', 4000)]),                          // a minute earlier: last night
  /* 6 */ fight('a drake', at(4, 21, 0), 30, [row('Aldenmar', 3000)]),
  /* 7 */ fight('an old wyrm', new Date(2026, 8, 28, 21, 0, 0).getTime(), 30, [row('Aldenmar', 9000)]),   // eight days back
];
const NOW = at(6, 21, 0);
const pts = (sr) => sr.points.map(p => [p.i, p.label, Math.round(p.v * 100) / 100]);

describe('Trend: who is credited with a fight', () => {
  it('my own row, plus the rows of any pet whose owner is me — and nobody else\'s', () => {
    expect(T._trendMine(RING[0], 'aldenmar')).toEqual({ dmg: 10000, took: 400 });   // 9000 + the sporeling's 1000; its 100 taken too
    expect(T._trendMine(RING[0], 'brackwyn')).toEqual({ dmg: 20000, took: 0 });
  });
  it('a charm or summon nobody has named an owner for is credited to no one', () => {
    // Lord Vyemm's rows: Aldenmar 9000, his sporeling 1000, an unowned charmed orc 700, Brackwyn 20000.
    expect(T._trendMine(RING[0], 'aldenmar').dmg).toBe(10000);       // not 10700
    expect(T._trendMine(RING[0], 'brackwyn').dmg).toBe(20000);
  });
  it('no name is no one: rows with neither a character nor an owner are not "me"', () => {
    expect(T._trendMine({ local: [{ dmg: 50 }, { character: '', dmg: 60 }] }, '')).toEqual({ dmg: 0, took: 0 });
    expect(T._trendSeries(RING, null, 'dmg', 'week', NOW).n).toBe(0);
    expect(T._trendSeries(RING, '', 'dmg', 'week', NOW).n).toBe(0);
  });
  it('a fight with no local view is nothing, not an error', () => {
    expect(T._trendMine({}, 'aldenmar')).toEqual({ dmg: 0, took: 0 });
    expect(T._trendMine(null, 'aldenmar')).toEqual({ dmg: 0, took: 0 });
    expect(T._trendSeries([null, {}, { boss: 'x', endedMs: NOW, durationSec: 5 }], 'aldenmar', 'dmg', 'week', NOW).n).toBe(0);
  });
});

describe('Trend: DPS, and which fights are points', () => {
  it('a point is my damage over the fight\'s own seconds — pet damage included — oldest first', () => {
    const sr = T._trendSeries(RING, 'Aldenmar', 'dmg', 'tonight', NOW);
    expect(pts(sr)).toEqual([[4, 'a sleeper', 50], [2, 'a Shissar acolyte', 150], [0, 'Lord Vyemm', 100]]);
  });
  it('the name matches without regard to case', () => {
    expect(pts(T._trendSeries(RING, 'ALDENMAR', 'dmg', 'tonight', NOW))).toEqual(pts(T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', NOW)));
  });
  it('a fight I did no damage in, or one with no duration, is not a point', () => {
    const idx = T._trendSeries(RING, 'aldenmar', 'dmg', 'week', NOW).points.map(p => p.i);
    expect(idx).not.toContain(3);   // Brackwyn only
    expect(idx).not.toContain(1);   // no seconds to divide by
  });
  it('the big number is damage over seconds across the shown fights — the HUD\'s tonight average — not the mean of the dots', () => {
    const sr = T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', NOW);
    expect(sr.avg).toBeCloseTo(15500 / 170, 6);           // 2500 + 3000 + 10000 over 50 + 20 + 100 s
    expect(sr.avg).not.toBeCloseTo((50 + 150 + 100) / 3, 1);
    expect(sr.n).toBe(3);
  });
  it('the best fight is the fastest one, and the newest of equals', () => {
    expect(T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', NOW).best).toMatchObject({ label: 'a Shissar acolyte', i: 2 });
    const tie = [fight('Newer', at(6, 20, 0), 10, [row('Aldenmar', 1000)]), fight('Older', at(6, 19, 0), 10, [row('Aldenmar', 1000)])];
    expect(T._trendSeries(tie, 'aldenmar', 'dmg', 'tonight', NOW).best.label).toBe('Newer');
  });
  it('Taken is the same sum over the same seconds, from the took figures (a pet\'s credited to its owner)', () => {
    const sr = T._trendSeries(RING, 'aldenmar', 'took', 'tonight', NOW);
    expect(pts(sr)).toEqual([[4, 'a sleeper', 5], [0, 'Lord Vyemm', 4]]);   // 250 / 50 s, then (300 + 100) / 100 s
    expect(sr.avg).toBeCloseTo(650 / 150, 6);
  });
  it('the Dealt / Taken switch is offered only when the ring carries damage taken for me', () => {
    expect(T._trendHasTook(RING, 'Aldenmar')).toBe(true);
    expect(T._trendHasTook(RING, 'Brackwyn')).toBe(false);
    expect(T._trendHasTook(RING.map(h => ({ ...h, local: h.local.map(({ took, ...r }) => r) })), 'Aldenmar')).toBe(false);   // an agent from before `took`
    expect(T._trendHasTook([], 'Aldenmar')).toBe(false);
    expect(T._trendHasTook(RING, null)).toBe(false);
  });
});

describe('Trend: "tonight" is since 6am local, as the HUD\'s tonight average counts it', () => {
  const key = T._trendNightKey;
  it('a night runs from 06:00 to 05:59 the next morning', () => {
    expect(key(at(6, 5, 59))).toBe(key(at(5, 12)));
    expect(key(at(6, 6, 0))).toBe(key(at(6, 23, 59)));
    expect(key(at(7, 5, 59))).toBe(key(at(6, 23, 59)));
    expect(key(at(7, 6, 0))).not.toBe(key(at(6, 23, 59)));
  });
  it('a fight at 06:00 sharp is tonight; one a minute before is last night\'s', () => {
    const idx = T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', NOW).points.map(p => p.i);
    expect(idx).toContain(4);
    expect(idx).not.toContain(5);
  });
  it('past midnight it is still the same night, and at 06:00 it is a new one', () => {
    expect(T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', at(7, 2, 0)).n).toBe(3);
    expect(T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', at(7, 6, 0)).n).toBe(0);
  });
  it('7 d is every fight in the last seven days, and no older', () => {
    const sr = T._trendSeries(RING, 'aldenmar', 'dmg', 'week', NOW);
    expect(sr.points.map(p => p.i)).toEqual([6, 5, 4, 2, 0]);   // oldest first; the 8-day-old wyrm is out
    expect(sr.n).toBe(5);
  });
});

describe('Trend: the sparkline', () => {
  const two = [{ v: 100, label: 'Alpha' }, { v: 200, label: 'Beta <b>' }];
  const svg = T._trendSvg(two, 100, 50, 'dps');
  it('a 2px line over an area at 0.16, in the meter\'s purple, with zero as the floor', () => {
    expect(T.TREND_COL).toBe('#a371f7');
    expect(svg).toContain('viewBox="0 0 100 50"');
    expect(svg).toContain('<polyline points="6.0,26.0 94.0,5.0" fill="none" stroke="#a371f7" stroke-width="2"');
    expect(svg).toContain('<path d="M6.0,50 L6.0,26.0 L94.0,5.0 L94.0,50 Z" fill="#a371f7" fill-opacity="0.16"');
  });
  it('every point is a dot with its own tooltip; the last is the big one', () => {
    expect(svg).toContain('<title>Alpha · 100 dps</title>');
    expect(svg).toContain('<title>Beta &lt;b&gt; · 200 dps</title>');       // a mob name cannot break out
    expect(svg).not.toContain('<b>');
    expect(svg.match(/<g class="tpt">/g)).toHaveLength(2);
    expect(svg.match(/class="tdot last"/g)).toHaveLength(1);
    expect(svg).toMatch(/<circle class="tdot last" cx="94\.0" cy="5\.0" r="3\.5"/);
    expect(svg).toMatch(/<circle class="tdot" cx="6\.0" cy="26\.0" r="2"/);
  });
  it('one fight is a dot in the middle with no line; none is nothing', () => {
    const one = T._trendSvg([{ v: 80, label: 'Solo' }], 100, 50, 'dps');
    expect(one).not.toContain('<polyline');
    expect(one).not.toContain('<path');
    expect(one).toMatch(/<circle class="tdot last" cx="50\.0" cy="5\.0"/);
    expect(T._trendSvg([], 100, 50, 'dps')).toBe('');
  });
  it('never a warning red, never a NaN', () => {
    expect(svg).not.toMatch(/f85149/i);
    expect(svg).not.toContain('NaN');
    expect(T._trendSvg([{ v: 0, label: 'z' }, { v: 0, label: 'y' }], 100, 50, 'dps')).not.toContain('NaN');
  });
  it('is built at the width it is given, and a bigger window draws a bigger one', () => {
    expect(T._trendSvg(two, 400, 80, 'dps')).toContain('viewBox="0 0 400 80"');
    expect(T._trendSvg(two, 400, 80, 'dps')).toContain('<polyline points="6.0,');
    expect(T._trendSvg(two, 400, 80, 'dps')).toContain(' 394.0,');
  });
});

describe('Trend: the panel body', () => {
  const sr = T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', NOW);
  const body = T._trendHtml(sr, { field: 'dmg', w: 300, empty: 'x' });
  it('the average, then "N fights · best X (Boss)", then the line', () => {
    expect(body).toMatch(/^<div class="tbig"><b>91<\/b><span class="tu">avg dps<\/span><\/div>/);
    expect(body).toContain('<div class="tsub">3 fights · best 150 (a Shissar acolyte)</div>');
    expect(body.indexOf('class="tsub"')).toBeLessThan(body.indexOf('<svg'));
    expect(body).toContain('viewBox="0 0 300 60"');
  });
  it('the line is as tall as the window is wide, within bounds', () => {
    expect(T._trendHtml(sr, { field: 'dmg', w: 100, empty: '' })).toContain('viewBox="0 0 100 44"');
    expect(T._trendHtml(sr, { field: 'dmg', w: 1000, empty: '' })).toContain('viewBox="0 0 1000 96"');
  });
  it('the fights under it are rows, newest first, each carrying its place in the ring, with a bar against the best', () => {
    const rows = body.match(/<button type="button" class="trow[^"]*" data-i="\d+"/g);
    expect(rows).toEqual(['<button type="button" class="trow new" data-i="0"', '<button type="button" class="trow" data-i="2"', '<button type="button" class="trow" data-i="4"']);
    expect(body).toMatch(/data-i="2"[^>]*><span class="tn">a Shissar acolyte<\/span><span class="tv">150<\/span><span class="tb"><i style="width:100\.0%">/);
    expect(body).toMatch(/data-i="0"[^>]*><span class="tn">Lord Vyemm<\/span><span class="tv">100<\/span><span class="tb"><i style="width:66\.7%">/);
    expect(body).toMatch(/data-i="4"[^>]*><span class="tn">a sleeper<\/span><span class="tv">50<\/span><span class="tb"><i style="width:33\.3%">/);
  });
  it('only the newest eight are listed', () => {
    const many = { n: 12, avg: 100, best: { v: 100, label: 'b' }, points: Array.from({ length: 12 }, (_, k) => ({ i: k, v: 100, label: 'f' + k, t: k })) };
    const rows = T._trendHtml(many, { field: 'dmg', w: 300, empty: '' }).match(/<button type="button" class="trow/g);
    expect(rows).toHaveLength(T.TREND_ROWS);
    expect(T.TREND_ROWS).toBe(8);
    expect(T._trendHtml(many, { field: 'dmg', w: 300, empty: '' })).toContain('data-i="11"');
    expect(T._trendHtml(many, { field: 'dmg', w: 300, empty: '' })).not.toContain('data-i="3"');
  });
  it('Taken says dtps and calls its top fight the peak, not the best', () => {
    const tk = T._trendHtml(T._trendSeries(RING, 'aldenmar', 'took', 'tonight', NOW), { field: 'took', w: 300, empty: '' });
    expect(tk).toContain('avg dtps');
    expect(tk).toContain('2 fights · peak 5 (a sleeper)');
    expect(tk).toContain('<title>a sleeper · 5 dtps</title>');
    expect(tk).not.toContain('best');
  });
  it('one fight is "1 fight"', () => {
    const one = T._trendSeries([RING[2]], 'aldenmar', 'dmg', 'tonight', NOW);
    expect(T._trendHtml(one, { field: 'dmg', w: 300, empty: '' })).toContain('1 fight · best 150');
  });
  it('nothing to show says so, in words for the range and the side', () => {
    const none = T._trendSeries([], 'aldenmar', 'dmg', 'tonight', NOW);
    expect(T._trendHtml(none, { field: 'dmg', w: 300, empty: T._trendEmpty('dmg', 'tonight', true) })).toBe('<div class="tnone">No fights yet tonight.</div>');
    expect(T._trendEmpty('dmg', 'week', true)).toBe('No fights in the last 7 days.');
    expect(T._trendEmpty('took', 'tonight', true)).toBe('No damage taken yet tonight.');
    expect(T._trendEmpty('took', 'week', true)).toBe('No damage taken in the last 7 days.');
    expect(T._trendEmpty('dmg', 'tonight', false)).toBe('Waiting for your character…');
  });
  it('a mob name cannot break out of a row', () => {
    const evil = T._trendSeries([fight('<img src=x>', at(6, 20, 0), 10, [row('Aldenmar', 100)])], 'aldenmar', 'dmg', 'tonight', NOW);
    expect(T._trendHtml(evil, { field: 'dmg', w: 300, empty: '' })).not.toContain('<img');
  });
  it('is byte-stable: the same fights give the same HTML, so the page rewrites only when one lands', () => {
    expect(T._trendHtml(T._trendSeries(RING, 'aldenmar', 'dmg', 'tonight', NOW), { field: 'dmg', w: 300, empty: '' })).toBe(body);
  });
});

// ── The page, run for real against a small fake DOM ─────────────────────────
function fakeEl(id) {
  const L = {}, on = new Set();
  return {
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, clientWidth: 300,
    classList: { add: (c) => on.add(c), remove: (c) => on.delete(c), contains: (c) => on.has(c), toggle: (c, v) => { const x = v === undefined ? !on.has(c) : !!v; if (x) on.add(c); else on.delete(c); return x; } },
    addEventListener(t, f) { (L[t] || (L[t] = [])).push(f); },
    fire(t, e) { (L[t] || []).forEach((f) => f(e || {})); },
  };
}
function runPage({ state, ring, stored = {}, mini = false }) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
  const body = fakeEl('body-tag');
  if (mini) body.classList.add('wp-mini');
  const urls = [], writes = [];
  const cur = { state, ring };
  const document = { body, getElementById: el, querySelector: (s) => el('q:' + s), addEventListener() {}, createElement: () => fakeEl('x') };
  const window = { addEventListener() {}, mimic: { autoFitOverlay() {}, overlayHoverInteractive() {} } };
  const localStorage = { getItem: (k) => (k in stored ? stored[k] : null), setItem: (k, v) => { stored[k] = v; writes.push([k, v]); } };
  const fetch = async (u) => { urls.push(u); return { ok: true, json: async () => (/\/api\/fight-history/.test(u) ? { rev: 'r.1', fights: cur.ring } : cur.state) }; };
  const api = new Function('window', 'document', 'localStorage', 'fetch', 'setInterval', 'navigator',
    script + '\n;return { tick: tick };')(window, document, localStorage, fetch, () => 0, {});
  return { api, el, body, urls, writes, cur, stored, ringUrls: () => urls.filter((u) => /fight-history/.test(u)) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const live = (extra) => ({ activeCharacter: 'Aldenmar', currentEncounterThreat: null, ...extra });
const withFakeNow = (t = NOW) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(t); };
afterEach(() => { vi.useRealTimers(); });

describe('Trend: the page', () => {
  it('on the Trend tab it draws my fights from the ring, and says whose in its title', async () => {
    withFakeNow();
    const p = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    const b = p.el('trendBody').innerHTML;
    expect(b).toContain('3 fights · best 150 (a Shissar acolyte)');
    expect(b).toContain('<b>91</b>');
    expect(p.el('boss-name').textContent).toBe('My DPS');
    expect(p.body.classList.contains('trendmode')).toBe(true);
    expect(p.el('tabTrend').classList.contains('on')).toBe(true);
    expect(p.el('tabDps').classList.contains('on')).toBe(false);
    expect(p.el('trTonight').classList.contains('on')).toBe(true);     // the toggles say what is shown
    expect(p.el('trWeek').classList.contains('on')).toBe(false);
    expect(p.el('trDealt').classList.contains('on')).toBe(true);
    expect(p.el('trTaken').classList.contains('on')).toBe(false);
  });
  it('the Trend tab opens it from any other tab, and remembers it', async () => {
    withFakeNow();
    const p = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'dps' } });
    await flush();
    expect(p.ringUrls()).toEqual([]);
    expect(p.body.classList.contains('trendmode')).toBe(false);
    p.el('tabTrend').fire('click');
    await flush();
    expect(p.writes).toContainEqual(['wp.damageTabMode', 'trend']);
    expect(p.body.classList.contains('trendmode')).toBe(true);
    expect(p.el('tabTrend').classList.contains('on')).toBe(true);
    expect(p.ringUrls()).toHaveLength(1);
    expect(p.el('trendBody').innerHTML).toContain('3 fights · best 150');
  });
  it('rewrites its body only when a fight lands, so a poll that changed nothing touches nothing', async () => {
    withFakeNow();
    const p = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    const el = p.el('trendBody');
    let writes = 0, held = el.innerHTML;
    Object.defineProperty(el, 'innerHTML', { get: () => held, set: (v) => { writes++; held = v; } });
    await p.api.tick();
    await p.api.tick();
    expect(writes).toBe(0);
    p.cur.ring = [fight('Newcomer', at(6, 20, 55), 30, [row('Aldenmar', 3000)]), ...RING];
    await p.api.tick();
    expect(writes).toBe(1);
    expect(held).toContain('4 fights');
  });
  it('asks for the ring once a tick, with the revision it last saw — and not at all on DPS, Tank or a mini', async () => {
    withFakeNow();
    const t = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    await t.api.tick();
    expect(t.ringUrls()).toEqual(['http://127.0.0.1:7779/api/fight-history', 'http://127.0.0.1:7779/api/fight-history?rev=r.1']);
    for (const mode of ['dps', 'tank']) {
      const d = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': mode } });
      await flush();
      expect(d.ringUrls()).toEqual([]);
    }
    const m = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend' }, mini: true });
    await flush();
    expect(m.ringUrls()).toEqual([]);                         // a mini keeps the scoreboard, so nothing to read
    expect(m.el('trendBody').innerHTML).toBe('');
  });
  it('"me" is the name the scoreboard highlights, and is kept when it goes quiet', async () => {
    withFakeNow();
    const p = runPage({ state: live({ activeCharacter: 'Brackwyn' }), ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    expect(p.el('trendBody').innerHTML).toContain('3 fights · best 200 (Lord Vyemm)');   // Brackwyn's, not Aldenmar's
    p.cur.state = live({ activeCharacter: null });                              // EQ not in front for a minute
    await p.api.tick();
    expect(p.el('trendBody').innerHTML).toContain('3 fights · best 200 (Lord Vyemm)');   // still Brackwyn, not blank
    const up = runPage({ state: { currentEncounterThreat: { uploader: 'Aldenmar' } }, ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    expect(up.el('trendBody').innerHTML).toContain('3 fights · best 150');       // the live fight's uploader, as the board falls back
  });
  it('nobody known yet, or no fights: the empty line, not a blank panel', async () => {
    withFakeNow();
    const a = runPage({ state: {}, ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    expect(a.el('trendBody').innerHTML).toBe('<div class="tnone">Waiting for your character…</div>');
    const b = runPage({ state: live(), ring: [], stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    expect(b.el('trendBody').innerHTML).toBe('<div class="tnone">No fights yet tonight.</div>');
  });
  it('7 d and Taken are remembered the way the tab is, and applied on the next open', async () => {
    withFakeNow();
    const p = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    p.el('trWeek').fire('click');
    await flush();
    expect(p.writes).toContainEqual(['wp.trendRange', 'week']);
    expect(p.el('trendBody').innerHTML).toContain('5 fights · best 150');
    expect(p.el('trWeek').classList.contains('on')).toBe(true);
    expect(p.el('trTonight').classList.contains('on')).toBe(false);
    p.el('trTaken').fire('click');
    await flush();
    expect(p.writes).toContainEqual(['wp.trendField', 'took']);
    expect(p.el('trTaken').classList.contains('on')).toBe(true);
    expect(p.el('trDealt').classList.contains('on')).toBe(false);
    expect(p.el('boss-name').textContent).toBe('My damage taken');
    expect(p.el('trendBody').innerHTML).toContain('avg dtps');
    const wk = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend', 'wp.trendRange': 'week' } });
    await flush();
    expect(wk.el('trendBody').innerHTML).toContain('5 fights · best 150');      // 7 d, and Dealt, as saved
    expect(wk.el('trWeek').classList.contains('on')).toBe(true);
    const again = runPage({ state: live(), ring: RING, stored: { ...p.stored } });
    await flush();
    expect(again.el('trendBody').innerHTML).toContain('avg dtps');
    expect(again.el('trendBody').innerHTML).toContain('2 fights · peak 5 (a sleeper)');   // 7 d of damage taken: only two fights had any
  });
  it('the Dealt / Taken switch shows only when the ring has damage taken for me, and Taken falls back to Dealt without it', async () => {
    withFakeNow();
    const none = RING.map(h => ({ ...h, local: h.local.map(({ took, ...r }) => r) }));
    const a = runPage({ state: live(), ring: none, stored: { 'wp.damageTabMode': 'trend', 'wp.trendField': 'took' } });
    await flush();
    expect(a.el('trField').style.display).toBe('none');
    expect(a.el('trendBody').innerHTML).toContain('avg dps');                    // a saved "Taken" cannot draw what is not there
    const b = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    expect(b.el('trField').style.display).toBe('');
  });
  it('a row opens its fight in History, by its place in the ring', async () => {
    withFakeNow();
    const p = runPage({ state: live(), ring: RING, stored: { 'wp.damageTabMode': 'trend' } });
    await flush();
    const rowEl = { getAttribute: (k) => (k === 'data-i' ? '2' : null) };
    p.el('trendBody').fire('click', { target: { closest: (s) => (s === '.trow' ? rowEl : null) } });
    await flush();
    expect(p.writes).toContainEqual(['wp.damageTabMode', 'history']);
    expect(p.body.classList.contains('trendmode')).toBe(false);
    expect(p.body.classList.contains('hist')).toBe(true);
    expect(p.el('boss-name').textContent).toMatch(/^a Shissar acolyte · /);       // ring[2], not the latest kill
    p.el('trendBody').fire('click', { target: { closest: () => null } });          // a click that is not on a row does nothing
  });
});

describe('Trend: the markup and the rules', () => {
  const title = html.slice(html.indexOf('<div class="title">'), html.indexOf('<!-- History: the scoreboard')).replace(/<!--[\s\S]*?-->/g, '');
  const css = stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
  const trendCss = css.slice(css.indexOf('.trend{display:none}'));
  const trendJs = stripJs(sliceBlock(html, '  // ── Trend: the pure parts (begin) ──', '  function _trendPaint(ring, me) {'));
  it('Trend is the tab after History, in the same row under the stepper — and both still hide in a mini', () => {
    expect(title).toMatch(/<span class="ctlstack wp-mini-hide">[\s\S]*class="rowcfg"[\s\S]*<span class="tabrow">\s*<button id="tabHist"[\s\S]*<\/button>\s*<button id="tabTrend"[^>]*>Trend<\/button>\s*<\/span>/);
    expect(title).not.toMatch(/<span class="tabs wp-mini-hide">[\s\S]*tabTrend/);
  });
  it('the toggles are buttons below the title row, so none sits under the ✕ in the top-right', () => {
    expect(title).not.toMatch(/trTonight|trWeek|trDealt|trTaken/);
    const panel = html.slice(html.indexOf('<div id="trend" class="trend">'), html.indexOf('<script>'));
    for (const id of ['trTonight', 'trWeek', 'trDealt', 'trTaken']) expect(panel).toMatch(new RegExp('<button id="' + id + '" class="tab[^"]*" type="button"'));
    expect(panel).not.toMatch(/<(div|span)[^>]*(onclick|data-i=)/);                // nothing clickable that is not a button
    expect(html.indexOf('<div id="trend" class="trend">')).toBeGreaterThan(html.indexOf('<ul id="histList" class="histlist"></ul>'));
  });
  it('the panel stands in for the board on the Trend tab, except in a mini', () => {
    expect(trendCss).toContain('.trend{display:none}');
    expect(trendCss).toContain('body.trendmode:not(.wp-mini) .trend{display:block}');
    expect(trendCss).toContain('body.trendmode:not(.wp-mini) .histwrap{display:none}');
  });
  it('purple for the line, the bars and the number; never a warning red', () => {
    expect(trendCss).not.toMatch(/f85149/i);
    expect(trendJs).not.toMatch(/f85149/i);
    expect(trendCss).toContain('.trow .tb i{display:block;height:100%;background:rgba(163,113,247,0.6)');
    expect(trendCss).toContain('.trow.new .tb i{background:#a371f7}');
  });
  it('the sparkline scales with its window; nothing in it is a fixed pixel width', () => {
    expect(trendCss).toContain('.tsvg{display:block;width:100%;height:auto');
    expect(stripJs(html)).toMatch(/w: \(trendBodyEl && trendBodyEl\.clientWidth\) \|\| 280/);
  });
});
