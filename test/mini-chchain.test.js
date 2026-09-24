// test/mini-chchain.test.js — the CH chain overlay's mini rendition, variant B
// "Timeline lanes" (the guild vote, 2026-09-17).
//
// The guild lead's ask: "a per-healer timeline scrolling right to left: middle
// is cast start, left edge is the land. Orange getting ready, blue casting, red
// interrupted, green when it lands. Main tank health stays."
// And the report that started the work (the guild lead, 2026-09-24): mini mode
// did nothing, because no overlay had any wp-mini rules of its own.
//
// Behaviour first: the lane geometry, the lane state and the lane model are
// pure functions sliced out of the real chchain.html and run here, and
// renderMini() runs against a small fake DOM so the ticker's start / stop is
// observed, not read off the source. The few text assertions (wiring into
// render(), the CSS) run on comment-stripped source.
//
// Run: npx vitest run test/mini-chchain.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, stripJs, stripCss } from './_source-slice.js';

const SRC = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'chchain.html'), 'utf8');

// The real shared constants + esc(), then the mini block itself. The mini
// block's end anchor is the declaration that FOLLOWS it, never a line of its
// own body — a slice closed on the code under test turns a mutation into
// "suite failed to load", which reads like a kill and proves nothing.
const CONSTS = sliceBlock(SRC, '  var CH_CLAIM_WINDOW_MS = 120000;', 'var CH_DDR_DISPLAY_MS = 1400;');
const ESC    = sliceBlock(SRC, '  function esc(s){', '\n');
const MINI   = sliceBlock(SRC, '  // ── ▭ Mini — variant B "Timeline lanes"', '\n  // v1.1.5 — pivot announcement state');

// ── a small fake DOM: just what renderMini() touches ─────────────────────────
function classList(initial = []) {
  const set = new Set(initial);
  return {
    contains: (c) => set.has(c),
    toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); },
    has: (c) => set.has(c),
  };
}
function fakeEl() { return { style: {}, className: '', innerHTML: '', classList: classList() }; }
// The lanes container parses what it is given just far enough to hand back one
// block + one name element per lane, the way getElementsByClassName would.
function fakeLanesEl() {
  const el = fakeEl();
  let html = '', blks = [], nms = [];
  el.writes = 0;
  Object.defineProperty(el, 'innerHTML', {
    get: () => html,
    set: (v) => {
      html = v; el.writes++;
      nms = [...v.matchAll(/<span class="(lnm[^"]*)">([^<]*)<\/span>/g)].map(m => ({ className: m[1], text: m[2] }));
      blks = nms.map(() => ({ style: { display: 'none' }, className: 'blk' }));
    },
  });
  el.getElementsByClassName = (c) => (c === 'blk' ? blks : c === 'lnm' ? nms : []);
  return el;
}

function load({ mini = false } = {}) {
  const timers = { set: [], cleared: [] };
  let nextId = 1;
  const setI = (fn, ms) => { const id = nextId++; timers.set.push({ id, fn, ms }); return id; };
  const clearI = (id) => { timers.cleared.push(id); };
  const body = { classList: classList(mini ? ['wp-mini'] : []) };
  const els = { chmini: fakeEl(), miniMt: fakeEl(), miniLanes: fakeLanesEl() };
  const document = { body, getElementById: (id) => els[id] || null };
  const names = ['chLaneState', 'chLaneGeom', 'chMiniModel', 'chMiniMt', 'chMiniMtHtml',
    'chMiniLanesHtml', 'renderMini', 'CH_MINI_TICK_MS', '_setRaidPipe'];
  const api = new Function('document', 'setInterval', 'clearInterval',
    CONSTS + '\n' + ESC + '\n' + MINI
    + '\nfunction _setRaidPipe(p){ _raidPipe = p; }'
    + `\nreturn { ${names.join(', ')} };`)(document, setI, clearI);
  return { ...api, timers, els, setMini: (on) => body.classList.toggle('wp-mini', on) };
}

// ── fixture: a four-healer chain on a 4s beat (invented names) ────────────────
// Aldenmar (001) cast 9s ago, Brackwyn (002) 5s ago, Corvale (003) 1s ago; next
// up is Nyssara (004), due in 3s. Slots are given out of order on purpose.
const T0 = 1_760_000_000_000;
function chain(over = {}) {
  return {
    target: 'Rethlan',
    beat_ms: 4000,
    ch_cast_ms: 10000,
    ch_interrupt_linger_ms: 4000,
    next_num: 4,
    last_ch: { num: 3, atMs: T0 - 1000 },
    next_expected_at: T0 + 3000,
    updated_at: T0 - 1000,
    slots: {
      3: { name: 'Corvale',  lastAtMs: T0 - 1000 },
      1: { name: 'Aldenmar', lastAtMs: T0 - 9000 },
      4: { name: 'Nyssara',  lastAtMs: T0 - 13000 },
      2: { name: 'Brackwyn', lastAtMs: T0 - 5000 },
    },
    ...over,
  };
}
const pipe = (members, at = T0) => ({ at, members });

let M;
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(T0); M = load(); });
afterEach(() => { vi.restoreAllMocks(); });

// ── geometry ─────────────────────────────────────────────────────────────────
describe('chLaneGeom — where a block sits on the track (centre line = 50%)', () => {
  it('casting grows LEFTWARD from the centre toward the land edge (0s / 5s / 10s)', () => {
    expect(M.chLaneGeom('casting', 0, 10)).toEqual({ left: 49, width: 1, blk: 'bC', name: 'cC' });
    expect(M.chLaneGeom('casting', 5, 10)).toEqual({ left: 25, width: 25, blk: 'bC', name: 'cC' });
    expect(M.chLaneGeom('casting', 10, 10)).toEqual({ left: 0, width: 50, blk: 'bC', name: 'cC' });
  });

  it('uses the overlay\'s real cast duration, not a hard 10s', () => {
    // 4s into an 8s cast is half-way: the block reaches a quarter of the track.
    expect(M.chLaneGeom('casting', 4, 8)).toMatchObject({ left: 25, width: 25 });
  });

  it('landed flashes GREEN at the left edge', () => {
    expect(M.chLaneGeom('landed', 10.4, 10)).toEqual({ left: 0, width: 6, blk: 'bL', name: 'cL' });
  });

  it('interrupted at 6s freezes RED where it died', () => {
    expect(M.chLaneGeom('interrupted', 6, 10)).toEqual({ left: 20, width: 30, blk: 'bX', name: 'cX' });
  });

  it('queued slides in from the right: 9s at the edge, 4s part-way, 12s off the track', () => {
    expect(M.chLaneGeom('queued', 9, 10)).toEqual({ left: 94, width: 6, blk: 'bQ', name: 'cQ' });
    const four = M.chLaneGeom('queued', 4, 10);
    expect(four.blk).toBe('bQ');
    expect(four.left).toBeCloseTo(50 + (4 / 9) * 44, 6);
    expect(M.chLaneGeom('queued', 0, 10)).toMatchObject({ left: 50, blk: 'bQ' });
    expect(M.chLaneGeom('queued', 12, 10)).toEqual({ left: null, width: null, blk: null, name: 'cI' });
  });

  it('NEXT with no measured beat is orange by name only, and idle has no block', () => {
    expect(M.chLaneGeom('queued', null, 10)).toEqual({ left: null, width: null, blk: null, name: 'cQ' });
    expect(M.chLaneGeom('idle', 0, 10)).toEqual({ left: null, width: null, blk: null, name: 'cI' });
  });
});

// ── state ────────────────────────────────────────────────────────────────────
describe('chLaneState — what a lane is doing at a given moment', () => {
  const at = (sec) => T0 + sec * 1000;
  const lane = (o) => ({ name: 'Zarrin', lastAtMs: T0, interruptedAt: 0, dueAtMs: 0, next: false, go: false, ...o });

  it('casts for the cast window, flashes landed for a second, then idles', () => {
    expect(M.chLaneState(lane({}), at(5), 10000, 4000)).toEqual({ state: 'casting', secs: 5 });
    expect(M.chLaneState(lane({}), at(10.5), 10000, 4000).state).toBe('landed');
    expect(M.chLaneState(lane({}), at(12), 10000, 4000).state).toBe('idle');
  });

  it('an interrupt is red at the point it died, and never turns back into a cast', () => {
    const l = lane({ interruptedAt: at(6) });
    expect(M.chLaneState(l, at(7), 10000, 4000)).toEqual({ state: 'interrupted', secs: 6 });
    // Linger over at 10s+: the cast died, so it neither casts on nor lands.
    expect(M.chLaneState(l, at(8.5), 10000, 2000).state).toBe('idle');
    expect(M.chLaneState(l, at(10.5), 10000, 4000).state).toBe('idle');
  });

  it('ignores an interrupt mark left over from an EARLIER cast', () => {
    const l = lane({ interruptedAt: T0 - 5000 });
    expect(M.chLaneState(l, at(3), 10000, 4000).state).toBe('casting');
  });

  it('queues on the predicted turn; a called GO means now', () => {
    const l = lane({ lastAtMs: T0 - 60000, dueAtMs: at(7) });
    expect(M.chLaneState(l, at(3), 10000, 4000)).toEqual({ state: 'queued', secs: 4 });
    expect(M.chLaneState({ ...l, go: true }, at(3), 10000, 4000)).toEqual({ state: 'queued', secs: 0 });
    // Overdue pins to the centre line rather than running off it.
    expect(M.chLaneState(l, at(9), 10000, 4000)).toEqual({ state: 'queued', secs: 0 });
    expect(M.chLaneState(lane({ lastAtMs: 0, next: true }), at(3), 10000, 4000)).toEqual({ state: 'queued', secs: null });
  });
});

// ── model ────────────────────────────────────────────────────────────────────
describe('chMiniModel — one lane per healer, in rotation order', () => {
  it('orders lanes by slot number and extrapolates the queue a beat per place, wrapping', () => {
    const m = M.chMiniModel(chain(), T0, false);
    expect(m.lanes.map(l => l.name)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara']);
    const due = Object.fromEntries(m.lanes.map(l => [l.name, (l.dueAtMs - T0) / 1000]));
    expect(due).toEqual({ Nyssara: 3, Aldenmar: 7, Brackwyn: 11, Corvale: 15 });
    expect(m.castMs).toBe(10000);
    expect(m.lingerMs).toBe(4000);
  });

  it('gives a contested slot one lane per live claimant, and only the matched caster freezes red', () => {
    const c = chain({ slots: {
      1: { name: 'Aldenmar', lastAtMs: T0 - 2000, interruptedAt: T0 - 1000,
           claimants: [{ name: 'Zarrin', lastAtMs: T0 - 6000 }, { name: 'Aldenmar', lastAtMs: T0 - 2000 }] },
      2: { name: 'Brackwyn', lastAtMs: T0 - 5000 },
    }, next_num: 2 });
    const m = M.chMiniModel(c, T0, false);
    expect(m.lanes.map(l => l.name)).toEqual(['Zarrin', 'Aldenmar', 'Brackwyn']);
    expect(m.lanes[0].interruptedAt).toBe(0);
    expect(m.lanes[1].interruptedAt).toBe(T0 - 1000);
  });

  it('predicts nothing for a stale chain', () => {
    const m = M.chMiniModel(chain(), T0, true);
    expect(m.lanes.every(l => l.dueAtMs === 0 && !l.next && !l.go)).toBe(true);
  });
});

// ── MT row ───────────────────────────────────────────────────────────────────
describe('the MT row', () => {
  it('reads the tank\'s HP from a fresh raid pipe, case-insensitively, and nothing from a stale one', () => {
    expect(M.chMiniMt(chain(), pipe([{ name: 'rethlan', hp_pct: 71.6 }]), T0)).toEqual({ name: 'Rethlan', hp: 72 });
    expect(M.chMiniMt(chain(), pipe([{ name: 'Rethlan', hp_pct: 72 }], T0 - 30000), T0).hp).toBeNull();
    expect(M.chMiniMt(chain(), pipe([{ name: 'Zarrin', hp_pct: 40 }]), T0).hp).toBeNull();
  });

  it('colours on the tank overlay\'s 50 / 25 steps', () => {
    expect(M.chMiniMtHtml({ name: 'Rethlan', hp: 51 })).toContain('mt-pct wp-mini-num hi');
    expect(M.chMiniMtHtml({ name: 'Rethlan', hp: 50 })).toContain('mt-pct wp-mini-num mid');
    expect(M.chMiniMtHtml({ name: 'Rethlan', hp: 25 })).toContain('mt-pct wp-mini-num lo');
    expect(M.chMiniMtHtml({ name: 'Rethlan', hp: null })).toContain('>—<');
  });
});

// ── renderMini against the fake DOM ──────────────────────────────────────────
describe('renderMini — the rendition, and its ticker', () => {
  it('renders one lane per healer in rotation order, with the MT row on top', () => {
    const m = load({ mini: true });
    m._setRaidPipe(pipe([{ name: 'Rethlan', hp_pct: 72 }]));
    m.renderMini(chain(), T0, false);
    expect(m.els.chmini.classList.has('on')).toBe(true);
    expect(m.els.miniMt.innerHTML).toContain('Rethlan');
    expect(m.els.miniMt.innerHTML).toContain('72%');
    const names = m.els.miniLanes.getElementsByClassName('lnm').map(n => n.text);
    expect(names).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara']);
    // The MT row, the axis and the lanes sit in that order inside #chmini.
    const body = SRC.slice(SRC.indexOf('<body>'));
    const box = body.slice(body.indexOf('id="chmini"'));
    const iMt = box.indexOf('id="miniMt"'), iAx = box.indexOf('class="axis"'), iLn = box.indexOf('id="miniLanes"');
    expect(iMt).toBeGreaterThan(-1);
    expect(iMt).toBeLessThan(iAx);
    expect(iAx).toBeLessThan(iLn);
  });

  it('places every block before render() refits — each lane in its own state', () => {
    const m = load({ mini: true });
    m.renderMini(chain(), T0, false);
    const blks = m.els.miniLanes.getElementsByClassName('blk');
    const nms = m.els.miniLanes.getElementsByClassName('lnm');
    // Aldenmar 9s into the cast, Corvale 1s in, Nyssara queued 3s out.
    expect(blks[0]).toMatchObject({ className: 'blk bC', style: { left: '5.00%', width: '45.00%', display: '' } });
    expect(blks[2]).toMatchObject({ className: 'blk bC', style: { left: '45.00%', width: '5.00%' } });
    expect(blks[3].className).toBe('blk bQ');
    expect(parseFloat(blks[3].style.left)).toBeCloseTo(50 + (3 / 9) * 44, 1);
    expect(nms.map(n => n.className.split(' ').pop())).toEqual(['cC', 'cC', 'cC', 'cQ']);
  });

  it('starts the ticker only in mini, only once, and stops it when mini goes off', () => {
    const m = load({ mini: false });
    m.renderMini(chain(), T0, false);
    expect(m.timers.set).toHaveLength(0);
    expect(m.els.chmini.classList.has('on')).toBe(false);

    m.setMini(true);
    m.renderMini(chain(), T0, false);
    m.renderMini(chain(), T0, false);
    expect(m.timers.set).toHaveLength(1);
    expect(m.timers.set[0].ms).toBe(100);
    expect(m.CH_MINI_TICK_MS).toBe(100);

    m.setMini(false);
    m.renderMini(chain(), T0, false);
    expect(m.timers.cleared).toEqual([m.timers.set[0].id]);
    expect(m.els.chmini.classList.has('on')).toBe(false);
  });

  it('stops the ticker when the chain empties, and never runs it for a stale chain', () => {
    const m = load({ mini: true });
    m.renderMini(chain(), T0, false);
    m.renderMini(null, T0, false);
    expect(m.timers.cleared).toEqual([m.timers.set[0].id]);
    const s = load({ mini: true });
    s.renderMini(chain(), T0, true);
    expect(s.timers.set).toHaveLength(0);
    expect(s.els.chmini.classList.has('stale')).toBe(true);
  });

  it('the ticker moves blocks by style alone; the skeleton is not rewritten per render', () => {
    const m = load({ mini: true });
    m.renderMini(chain(), T0, false);
    m.renderMini(chain(), T0, false);
    expect(m.els.miniLanes.writes).toBe(1);
    const corvale = m.els.miniLanes.getElementsByClassName('blk')[2];
    expect(corvale.style.width).toBe('5.00%');
    Date.now.mockReturnValue(T0 + 2000);
    m.timers.set[0].fn();                      // one tick of the real ticker
    expect(corvale.style.width).toBe('15.00%');
    expect(m.els.miniLanes.writes).toBe(1);
  });
});

// ── wiring + CSS (comment-stripped source) ───────────────────────────────────
describe('wiring into the overlay', () => {
  const js = stripJs(SRC.slice(SRC.indexOf('<script>'), SRC.indexOf('</script>')));
  const css = stripCss(SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>')));

  it('render() draws the mini BEFORE its refit, on both of its paths', () => {
    const render = sliceBlock(js, 'function render(){', 'async function tick(){');
    expect(render).toMatch(/renderMini\(null, 0, false\);\s*try \{ window\.mimic && window\.mimic\.autoFitOverlay/);
    expect(render).toMatch(/renderMini\(c, now, stale\);\s*try \{ window\.mimic && window\.mimic\.autoFitOverlay/);
  });

  it('a mini flip re-renders at once, and the tank HP comes from the fetch it already makes', () => {
    expect(js).toMatch(/window\.addEventListener\('wp-mini-change', function\(\)\{ render\(\); \}\);/);
    expect(sliceBlock(js, 'async function tick(){', 'tick(); setInterval(tick, 600);'))
      .toMatch(/_raidPipe = \(s && s\.raidPipe\) \|\| null;/);
  });

  it('shows #chmini only in mini, and hides the full rows but not the safety banners', () => {
    expect(css).toMatch(/\.chmini\{display:none;/);
    expect(css).toMatch(/body\.wp-mini \.chmini\.on\{display:block\}/);
    const hide = css.match(/body\.wp-mini \.head,[^{]*\{display:none !important\}/);
    expect(hide).toBeTruthy();
    for (const sel of ['.head', '#rows', '#nextrow', '#gaprow', '#mute-btn']) expect(hide[0]).toContain(sel);
    for (const sel of ['#integrow', '#conflictbanner', '#pivotrow', '#move-btn', '#hide-btn']) expect(hide[0]).not.toContain(sel);
  });

  it('honours prefers-reduced-motion: the blocks stop transitioning', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\s*\.chmini \.blk[^{]*\{transition:none\}/);
  });
});
