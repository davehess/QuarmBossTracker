// test/mobinfo-target-pager.test.js — Target Info's history: the ◀ ▶ pager, the All / Killed / Left alive chip,
// the "killed 4m ago" stamp and the ⟲ Recent tab (Decision Desk "Pager", 2026-10-19;
// docs/DESIGN-history-and-quest-nav.md §1). The agent half is test/target-history-agent.test.js.
//
// The guild lead, 2026-10-04: "scroll back through these mobs and see the drops". Plus, at the pick: "a tab with
// recents as well would be helpful".
//
// The overlay's real functions run as slices over plain data: the neighbour walk, the follow-the-live rule, the
// stamp and the Recent rows; _pgPick and _renderRecent run over a fake DOM. Names are invented. Text assertions
// strip comments first.
//
// Run: npx vitest run test/mobinfo-target-pager.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripCss } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const slice = (from, to) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error('block not found: ' + from);
  return html.slice(a, b);
};
const js = stripJs(html);
const css = stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
const escFn = slice('  function esc(s){', '\n');

const helpers = slice('  var PG_LABEL =', '  // ── end target history helpers');
const H = new Function(escFn + '\n' + helpers
  + '\nreturn { PG_LABEL, PG_NEXT_FILTER, pgWhen, pgMatches, pgNeighbours, pgFollow, pastStampHtml, recentRowsHtml };')();

const NOW = 1_790_000_000_000;
const MIN = 60_000;
// The ring, newest first: a live gnoll (the target now), a wolf killed 4m ago, a spider left alive, a bat killed 2h ago.
const ring = () => [
  { key: 'live', name: 'a gnoll warlord', zoneName: 'The Feerrott', lastMs: NOW, minHp: 90, killedMs: null },
  { key: 'wolf', name: 'a dire wolf', zoneName: 'Lavastorm Mountains', lastMs: NOW - 4 * MIN, minHp: 0, killedMs: NOW - 4 * MIN, killedHow: 'corpse-id' },
  { key: 'spid', name: 'a giant spider', zoneName: 'Lavastorm Mountains', lastMs: NOW - 12 * MIN, minHp: 54, killedMs: null },
  { key: 'bat',  name: 'a vampire bat', zone: 5, lastMs: NOW - 125 * MIN, minHp: 0, killedMs: NOW - 125 * MIN, killedHow: 'hp0' },
];

describe('how long ago', () => {
  it('reads like the rest of the overlay: just now, minutes, hours and minutes', () => {
    expect(H.pgWhen('killed', 20_000)).toBe('killed just now');
    expect(H.pgWhen('killed', 4 * MIN)).toBe('killed 4m ago');
    expect(H.pgWhen('last seen', 60 * MIN)).toBe('last seen 1h ago');
    expect(H.pgWhen('last seen', 65 * MIN)).toBe('last seen 1h 5m ago');
    expect(H.pgWhen('killed', -5000)).toBe('killed just now');   // a clock a little behind the agent's
  });
});

describe('the All / Killed / Left alive chip', () => {
  it('cycles all → killed → alive → all', () => {
    expect(H.PG_NEXT_FILTER).toEqual({ all: 'killed', killed: 'alive', alive: 'all' });
    expect(Object.keys(H.PG_LABEL).map(k => H.PG_LABEL[k])).toEqual(['All', 'Killed', 'Left alive']);
  });
  it('matches on whether the agent saw it die', () => {
    const [, wolf, spid] = ring();
    expect([H.pgMatches(wolf, 'all'), H.pgMatches(wolf, 'killed'), H.pgMatches(wolf, 'alive')]).toEqual([true, true, false]);
    expect([H.pgMatches(spid, 'all'), H.pgMatches(spid, 'killed'), H.pgMatches(spid, 'alive')]).toEqual([true, false, true]);
  });
});

describe('◀ ▶ through the ring', () => {
  it('from the live target ◀ goes to the newest past one, and the live target is never in the walk', () => {
    const nb = H.pgNeighbours(ring(), 'all', 'live', null);
    expect(nb.older).toBe('wolf');
    expect(nb.newer).toBeUndefined();          // nothing newer than live: ▶ is disabled
    expect(nb.total).toBe(3);
    expect(nb.found).toBe(false);
  });

  it('steps one way and back, and ▶ from the newest past target returns to live', () => {
    let nb = H.pgNeighbours(ring(), 'all', 'live', 'wolf');
    expect(nb).toMatchObject({ older: 'spid', newer: null, at: 1, n: 3, found: true });
    nb = H.pgNeighbours(ring(), 'all', 'live', 'spid');
    expect(nb).toMatchObject({ older: 'bat', newer: 'wolf', at: 2 });
    nb = H.pgNeighbours(ring(), 'all', 'live', 'bat');
    expect(nb.older).toBeUndefined();          // the oldest: ◀ is disabled
    expect(nb.newer).toBe('spid');
  });

  it('Killed steps over the ones left alive, Left alive over the killed', () => {
    expect(H.pgNeighbours(ring(), 'killed', 'live', 'wolf').older).toBe('bat');
    expect(H.pgNeighbours(ring(), 'killed', 'live', 'bat').newer).toBe('wolf');
    expect(H.pgNeighbours(ring(), 'alive', 'live', null).older).toBe('spid');
    expect(H.pgNeighbours(ring(), 'alive', 'live', 'spid')).toMatchObject({ older: undefined, newer: null, n: 1, at: 1 });
  });

  it('counts only what matches, and an entry the filter hides has no place in the count', () => {
    const nb = H.pgNeighbours(ring(), 'killed', 'live', 'spid');   // pinned on a live-alive one, filter says Killed
    expect(nb.n).toBe(2);
    expect(nb.at).toBe(0);
    expect(nb.older).toBe('bat');              // the next kill further back
    expect(nb.newer).toBe('wolf');
  });

  it('with no live target every entry is a past one', () => {
    expect(H.pgNeighbours(ring(), 'all', null, null)).toMatchObject({ older: 'live', total: 4 });
  });

  it('an empty ring has nothing to step to', () => {
    expect(H.pgNeighbours([], 'all', null, null)).toMatchObject({ older: undefined, n: 0, total: 0 });
  });
});

describe('when paging lets go of the past target', () => {
  const pinned = () => ({ key: 'wolf', liveAtPin: 'live', gap: false });
  it('does nothing while you are on the target you paged away from', () => {
    const pg = pinned();
    expect(H.pgFollow(pg, 'live')).toBe(false);
    expect(pg.key).toBe('wolf');
  });
  it('lets go when you target something new', () => {
    const pg = pinned();
    expect(H.pgFollow(pg, 'spid')).toBe(true);
    expect(pg.key).toBe(null);
  });
  it('clearing your target alone does not move you: you may be reading the list', () => {
    const pg = pinned();
    expect(H.pgFollow(pg, null)).toBe(false);
    expect(pg.key).toBe('wolf');
  });
  it('but targeting anything, even the same mob, after having none does', () => {
    const pg = pinned();
    H.pgFollow(pg, null);
    expect(H.pgFollow(pg, 'live')).toBe(true);
    expect(pg.key).toBe(null);
  });
  it('is idle while following the live target', () => {
    expect(H.pgFollow({ key: null, liveAtPin: null, gap: false }, 'x')).toBe(false);
  });
});

describe('the stamp under a past target\'s name', () => {
  it('a kill: "killed 4m ago", gold, with how it was seen', () => {
    const h = H.pastStampHtml({ killedMs: NOW - 4 * MIN, killedHow: 'corpse-id', lastMs: NOW - 4 * MIN, minHp: 0 }, NOW);
    expect(h).toContain('class="past k"');
    expect(h).toContain('killed 4m ago');
    expect(h).toContain('its corpse took its place');
  });
  it('left alive: when it was last seen and the lowest it got', () => {
    const h = H.pastStampHtml({ killedMs: null, lastMs: NOW - 12 * MIN, minHp: 54 }, NOW);
    expect(h).toContain('class="past a"');
    expect(h).toContain('left alive · last seen 12m ago · lowest HP 54%');
    expect(h).toContain('never saw it die');
  });
  it('one kept from before a restart says so in its tooltip', () => {
    expect(H.pastStampHtml({ killedMs: null, lastMs: NOW, minHp: null, restored: true }, NOW)).toContain('Kept from before Mimic restarted');
  });
  it('a live target has no stamp', () => {
    expect(H.pastStampHtml(undefined, NOW)).toBe('');
  });
  it('is part of the card, after the name and before the zone', () => {
    expect(js).toMatch(/\+ pastStampHtml\(mi\.past, Date\.now\(\)\)\s*\n\s*\+ \(mob && mob\.zone/);
  });
});

describe('the ⟲ Recent tab', () => {
  it('one button per target, newest first, the live one marked "now", the open one highlighted', () => {
    const out = H.recentRowsHtml(ring(), 'all', 'live', 'spid', NOW);
    const keys = [...out.matchAll(/data-rk="([^"]+)"/g)].map(m => m[1]);
    expect(keys).toEqual(['live', 'wolf', 'spid', 'bat']);
    expect(out).toContain('The Feerrott · now');
    expect(out).toContain('Lavastorm Mountains · killed 4m ago');
    expect(out).toContain('Lavastorm Mountains · left alive, seen 12m ago · lowest HP 54%');
    expect(out).toContain('zone 5 · killed 2h 5m ago');
    expect(out).toMatch(/class="rcrow a on" data-rk="spid"/);
    expect(out).toMatch(/class="rcrow k" data-rk="wolf"/);
  });
  it('follows the same chip as the arrows', () => {
    const killed = [...H.recentRowsHtml(ring(), 'killed', 'live', null, NOW).matchAll(/data-rk="([^"]+)"/g)].map(m => m[1]);
    expect(killed).toEqual(['wolf', 'bat']);
    const alive = [...H.recentRowsHtml(ring(), 'alive', 'live', null, NOW).matchAll(/data-rk="([^"]+)"/g)].map(m => m[1]);
    expect(alive).toEqual(['live', 'spid']);
  });
  it('says so when there is nothing, or nothing matches', () => {
    expect(H.recentRowsHtml([], 'all', null, null, NOW)).toContain('no targets yet');
    expect(H.recentRowsHtml(ring().filter(e => !e.killedMs), 'killed', null, null, NOW)).toContain('nothing matches Killed');
  });
  it('a mob name cannot break out of its row', () => {
    const out = H.recentRowsHtml([{ key: 'k"><img>', name: '<img src=x>', lastMs: NOW, killedMs: null }], 'all', null, null, NOW);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('"><img');
  });
});

describe('what the overlay paints each poll (_pgPick)', () => {
  const pick = (state, liveMi, j, lastMi = null) => {
    const _pg = { key: null, liveAtPin: null, gap: false, liveKey: null, mi: null, ...state };
    const fn = new Function('_pg', 'pgFollow', '_lastMi', slice('  function _pgPick(liveMi, j){', '  // #186 — PQDI link') + '\nreturn _pgPick;')(_pg, H.pgFollow, lastMi);
    return { out: fn(liveMi, j), pg: _pg };
  };
  const live = { target_name: 'a gnoll warlord', target_hist_key: 'live' };
  const past = { target_name: 'a dire wolf', target_hist_key: 'wolf', past: { key: 'wolf' } };

  it('following live: the live card', () => {
    const r = pick({}, live, { mi: undefined });
    expect(r.out).toBe(live);
    expect(r.pg.liveKey).toBe('live');
  });
  it('pinned: the past card the agent sent', () => {
    const r = pick({ key: 'wolf', liveAtPin: 'live' }, live, { mi: past });
    expect(r.out).toBe(past);
  });
  it('pinned, the agent missed a poll: the last past card stays rather than flashing the live one', () => {
    const r = pick({ key: 'wolf', liveAtPin: 'live', mi: past }, live, null);
    expect(r.out).toBe(past);
  });
  it('pinned, before its card has come back: what was on screen, not the live card', () => {
    const shown = { target_name: 'the card on screen' };
    expect(pick({ key: 'wolf', liveAtPin: 'live' }, live, null, shown).out).toBe(shown);
  });
  it('pinned on an entry the agent no longer has: lets go and shows the live card', () => {
    const r = pick({ key: 'wolf', liveAtPin: 'live' }, live, { mi: null });
    expect(r.pg.key).toBe(null);
    expect(r.out).toBe(live);
  });
  it('targeting something new while paged away goes back to live', () => {
    const r = pick({ key: 'wolf', liveAtPin: 'live', mi: past }, { target_name: 'a bat', target_hist_key: 'bat2' }, { mi: past });
    expect(r.pg.key).toBe(null);
    expect(r.out.target_name).toBe('a bat');
  });
});

describe('the Recent tab needs no live target', () => {
  it('it is drawn before the "no target" empty state, and not in mini', () => {
    const body = slice('  function _renderBody(mi){', "if (!mi || !mi.target_name) {");
    expect(body).toContain("_tab === 'recent' && !document.body.classList.contains('wp-mini')");
  });
  it('rewrites only when its HTML changed, and keeps its scroll', () => {
    const fn = slice('  function _renderRecent(){', '  function _renderBody(mi){');
    const mk = (pg) => {
      const lists = [];
      const bodyEl = {
        __wpHtml: null, _html: '', writes: 0,
        querySelector() { return lists.length ? lists[lists.length - 1] : null; },
        set innerHTML(v) { this.writes++; this._html = v; lists.push({ scrollTop: 0 }); },
        get innerHTML() { return this._html; },
      };
      const emptyEl = { style: {} };
      const scrolls = [];
      const run = new Function('bodyEl', 'emptyEl', '_pg', 'recentRowsHtml', '_fitHeight', 'document', fn + '\nreturn _renderRecent;')
        (bodyEl, emptyEl, pg, H.recentRowsHtml, () => {}, { getElementById: () => ({ textContent: 'x' }) });
      return { run, bodyEl, emptyEl, lists, scrolls };
    };
    const t = mk({ list: ring(), filter: 'all', liveKey: 'live', key: null });
    t.run();
    expect(t.bodyEl.writes).toBe(1);
    expect(t.emptyEl.style.display).toBe('none');
    t.lists[0].scrollTop = 120;
    t.run();
    expect(t.bodyEl.writes).toBe(1);   // unchanged HTML: not written again
  });
});

describe('wiring', () => {
  it('every poll asks the agent for the ring and paints from _pgPick', () => {
    expect(js).toMatch(/mi = _pgPick\(mi, await _pgFetch\(\)\);\s*\n\s*_lastMi = mi;\s*\n\s*_pgPaint\(\);/);
    expect(js).toMatch(/'\/api\/target-history'/);
    expect(js).toContain("q.push('key=' + encodeURIComponent(_pg.key))");
    expect(js).toContain("q.push('rev=' + encodeURIComponent(_pg.rev))");
  });
  it('the arrows, the chip, Live and the ⟲ tab are armed on a locked overlay', () => {
    expect(js).toMatch(/\[pgPrevBtn, pgNextBtn, pgFilterBtn, pgLiveBtn, tabRecentBtn\]\.forEach/);
    expect(js).toMatch(/btn\.addEventListener\('mouseenter'[^\n]*overlayHoverInteractive\(true\)/);
    expect(js).toMatch(/btn\.addEventListener\('mouseleave'[^\n]*overlayHoverInteractive\(false\)/);
  });
  it('Recent rows are <button>s, which the preload arms on its own (they are rebuilt every minute)', () => {
    expect(H.recentRowsHtml(ring(), 'all', null, null, NOW)).toMatch(/<button type="button" class="rcrow /);
    const preload = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'preload.js'), 'utf8');
    expect(preload).toContain("el.matches('button, a, input, select, textarea, [role=\"button\"], [data-wp-interact]')");
  });
  it('a Recent row opens that target in the pager and goes back to the Stats tab', () => {
    expect(js).toMatch(/t\.closest\('\.rcrow'\)[\s\S]{0,260}_pgPin\(rk\);[\s\S]{0,40}_setTab\('stats'\)/);
  });
  it('the chip\'s pick is remembered as a per-viewer convenience, guarded', () => {
    expect(js).toMatch(/try \{ window\.localStorage\.setItem\('wpTargetPgFilter'/);
    expect(js).toMatch(/try \{ var _pgf = window\.localStorage\.getItem\('wpTargetPgFilter'\)/);
  });
  it('mini and the Timers canvas keep their own look: no strip in mini, none on the canvas, no pin carried into mini', () => {
    expect(html).toMatch(/<div id="pager" class="pager wp-mini-hide">/);
    expect(css).toMatch(/body\.wp-in-canvas \.pager,body\.wp-in-canvas #tabRecent\{display:none !important\}/);
    expect(js).toMatch(/classList\.contains\('wp-mini'\) && _pg\.key\) \{ _pg\.key = null; _pg\.mi = null; \}/);
  });
  it('the strip keeps clear of the ✕ in the corner', () => {
    expect(css).toMatch(/\.pager\{display:none;[^}]*margin:0 28px 5px 0/);
  });
});
