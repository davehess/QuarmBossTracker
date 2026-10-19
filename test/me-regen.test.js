// test/me-regen.test.js — FB-90: observed HP and mana regen per server tick, on the HUD and the canvas.
//
// The guild lead, FB-90: "Add per tick hp and mana regen to HUD and highlight the regen on the bars when its
// about to come back up. same with canvas." — and picked the OBSERVED version: the agent measures what one
// server tick gave, over quiet ticks only, and the overlays draw "+N / tick" and a pulse in the last second
// before the next tick.
//
// Runs the agent's REAL functions over fake Zeal frames, and the overlays' REAL render functions. Names are
// invented. Run: npx vitest run test/me-regen.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const agentSrc = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const meHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'me.html'));

// ── the agent ────────────────────────────────────────────────────────────────────────────────────────────
const BASE = Date.parse('2026-10-19T20:00:00Z');
let clock = BASE, n = 0;
const realNow = Date.now;
beforeEach(() => { Date.now = () => clock; n++; });
afterEach(() => { Date.now = realNow; agent._setZealStateForTest('Regen' + n, null); });
const who = () => 'Regen' + n;                 // a fresh character per test, so no history carries over
const lc = () => who().toLowerCase();

// A Zeal frame `phase` ms into tick cycle `k` (6 s a cycle). Gauge 24 is the per-mille of the tick still to go.
function frame(k, phase, o = {}) {
  const now = BASE + k * 6000 + phase, left = 6000 - phase;
  const st = {
    gauges: [{ slot: 24, hp_pct: left / 60, text: String(Math.min(6, Math.floor(left / 1000) + 1)) }],
    updatedAt: now,
    self_hp_cur: o.hp, self_hp_max: o.hpMax ?? 2000,
    self_mana_cur: 'mana' in o ? o.mana : 300, self_mana_max: 'manaMax' in o ? o.manaMax : 1000,
    zone: o.zone ?? 'gfaydark', casting: o.casting || '', autoattack: !!o.autoattack,
  };
  clock = now;
  agent._meRegenFrame(who(), st, now);
  return { st, now };
}
// One cycle: an early frame and the sampling frame (2 s in, past the 1.5 s the agent waits).
function cycle(k, o) { frame(k, 200, o); return frame(k, 2000, o); }
const regen = (now) => agent._meRegenFor(lc(), now, false);
const line = (msg) => '[' + new Date(clock).toString().slice(0, 24) + '] ' + msg;

describe('the clean-tick filter', () => {
  it('measures one tick as the difference between samples a tick apart', () => {
    cycle(0, { hp: 1000, mana: 300 });
    cycle(1, { hp: 1038, mana: 321 });
    cycle(2, { hp: 1076, mana: 342 });
    expect(regen(clock)).toEqual({ hp: 38, mana: 21, n_ticks: 2, quiet: true });
  });

  it('is null until there are two clean ticks', () => {
    cycle(0, { hp: 1000 });
    expect(regen(clock)).toBeNull();
    cycle(1, { hp: 1038 });
    expect(regen(clock)).toBeNull();          // one tick measured, not two
    cycle(2, { hp: 1076 });
    expect(regen(clock)).not.toBeNull();
  });

  it('drops a tick in which damage was taken', () => {
    cycle(0, { hp: 1000 }); cycle(1, { hp: 1038 });
    // (stamped a minute back, so it is the damage that spoils the tick, not "you were in combat")
    agent._meNoteHit(who(), { type: 'damage', attacker: 'a gnoll', defender: 'You', amount: 40, ts: new Date(clock - 60_000).toISOString() });
    cycle(2, { hp: 1076 });                    // the tick with the hit in it: not counted
    expect(regen(clock)).toBeNull();
    cycle(3, { hp: 1114 }); cycle(4, { hp: 1152 });
    expect(regen(clock).n_ticks).toBe(3);      // 1, then the next two clean ones
  });

  it('drops a tick in which a cast began (the mana cost is in it), by the log line or by Zeal\'s casting label', () => {
    cycle(0, { hp: 1000, mana: 300 }); cycle(1, { hp: 1038, mana: 321 });
    agent._meNoteRawLine(line('You begin casting Spirit of Wolf.'), who());
    cycle(2, { hp: 1076, mana: 342 });
    expect(regen(clock)).toBeNull();
    cycle(3, { hp: 1114, mana: 363 });
    cycle(4, { hp: 1152, mana: 384 });
    expect(regen(clock).n_ticks).toBe(3);
    // The label alone (a cast the log line missed):
    frame(5, 300, { hp: 1190, mana: 405, casting: 'Spirit of Wolf' });
    cycle(5, { hp: 1190, mana: 405 });
    expect(regen(clock).n_ticks).toBe(3);      // tick 5 was dropped
    cycle(6, { hp: 1228, mana: 426 });
    expect(regen(clock).n_ticks).toBe(4);      // and the next, clean one counts again
  });

  it('drops a tick in which a heal landed on you', () => {
    cycle(0, { hp: 1000 }); cycle(1, { hp: 1038 });
    agent._meNoteRawLine(line('You have been healed for 700 points of damage.'), who());
    cycle(2, { hp: 1800 });
    expect(regen(clock)).toBeNull();
  });

  it('drops ticks spent in combat (a live fight, auto-attack on)', () => {
    cycle(0, { hp: 1000 }); cycle(1, { hp: 1038 });
    cycle(2, { hp: 1076, autoattack: true });
    expect(regen(clock)).toBeNull();
  });

  it('starts over on a zone change, and drops a tick whose max HP or mana changed', () => {
    cycle(0, { hp: 1000 }); cycle(1, { hp: 1038 }); cycle(2, { hp: 1076 });
    expect(regen(clock).n_ticks).toBe(2);
    cycle(3, { hp: 1114, zone: 'butcher' });
    expect(regen(clock)).toBeNull();           // history gone
    cycle(4, { hp: 1152, zone: 'butcher' }); cycle(5, { hp: 1190, zone: 'butcher' });
    expect(regen(clock).n_ticks).toBe(2);
    cycle(6, { hp: 1228, hpMax: 2100, zone: 'butcher' });   // a buff moved max HP
    expect(regen(clock).n_ticks).toBe(2);      // not counted (stays at what it was)
    cycle(7, { hp: 1266, hpMax: 2100, zone: 'butcher' });
    expect(regen(clock).n_ticks).toBe(3);
  });

  it('drops a tick when HP or mana went DOWN with nothing we saw to explain it', () => {
    cycle(0, { hp: 1000, mana: 300 }); cycle(1, { hp: 1038, mana: 321 });
    cycle(2, { hp: 1076, mana: 200 });
    expect(regen(clock)).toBeNull();
  });

  it('drops a tick when a frame was missed (the samples are not one tick apart)', () => {
    cycle(0, { hp: 1000 }); cycle(1, { hp: 1038 });
    cycle(3, { hp: 1114 });                    // cycle 2 never reported
    expect(regen(clock)).toBeNull();
  });

  it('takes a sample only once the server\'s update could have arrived, and one a tick', () => {
    frame(0, 200, { hp: 1000 }); frame(0, 900, { hp: 1000 });   // too soon after the boundary
    frame(1, 200, { hp: 1038 }); frame(1, 900, { hp: 1038 });
    frame(2, 200, { hp: 1076 }); frame(2, 900, { hp: 1076 });
    expect(regen(clock)).toBeNull();
    cycle(3, { hp: 1114 });
  });

  it('a stat that is full at either end of the tick says nothing about regen', () => {
    cycle(0, { hp: 1990, mana: 300 }); cycle(1, { hp: 2000, mana: 321 }); cycle(2, { hp: 2000, mana: 342 });
    expect(regen(clock)).toEqual({ hp: null, mana: 21, n_ticks: 2, quiet: true });
  });

  it('a class with no mana has HP regen only', () => {
    cycle(0, { hp: 1000, mana: 0, manaMax: 0 }); cycle(1, { hp: 1038, mana: 0, manaMax: 0 }); cycle(2, { hp: 1076, mana: 0, manaMax: 0 });
    expect(regen(clock)).toEqual({ hp: 38, mana: null, n_ticks: 2, quiet: true });
  });

  it('forgets a clean tick after 90 seconds', () => {
    cycle(0, { hp: 1000 }); cycle(1, { hp: 1038 }); cycle(2, { hp: 1076 });
    expect(regen(clock + 80_000)).not.toBeNull();
    expect(regen(clock + 100_000)).toBeNull();
  });
});

describe('the median of the last 4 clean ticks', () => {
  it('ignores one stray tick (a potion, a buff) instead of averaging it in', () => {
    let hp = 1000;
    cycle(0, { hp });
    for (const [k, d] of [[1, 12], [2, 11], [3, 40], [4, 12]]) { hp += d; cycle(k, { hp }); }
    expect(regen(clock).hp).toBe(12);          // sorted 11 12 12 40 → 12 (a mean would say 18.75)
    expect(regen(clock).n_ticks).toBe(4);
  });

  it('reads only the last 4 ticks', () => {
    let hp = 100;
    cycle(0, { hp });
    for (const [k, d] of [[1, 90], [2, 90], [3, 10], [4, 10], [5, 10], [6, 10]]) { hp += d; cycle(k, { hp }); }
    expect(regen(clock)).toMatchObject({ hp: 10, n_ticks: 4 });
  });

  it('takes the middle of an even count', () => {
    let hp = 1000;
    cycle(0, { hp });
    for (const [k, d] of [[1, 10], [2, 20], [3, 30], [4, 40]]) { hp += d; cycle(k, { hp }); }
    expect(regen(clock).hp).toBe(25);
  });
});

describe('/api/me carries it, and hides it while in combat', () => {
  function live(o = {}) {
    cycle(0, { hp: 1000, mana: 300 }); cycle(1, { hp: 1038, mana: 321 });
    const { st } = cycle(2, { hp: 1076, mana: 342 });
    // `o` is how the character looks at the moment /api/me is asked (the ticks before it were quiet).
    agent._setZealStateForTest(who(), { ...st, ...o, charInfo: [], buffs: [] });
    return agent._serializeMeState();
  }
  it('regen: { hp, mana, n_ticks, quiet } once there are two clean ticks', () => {
    expect(live().regen).toEqual({ hp: 38, mana: 21, n_ticks: 2, quiet: true });
  });
  it('null in combat', () => {
    expect(live({ autoattack: true }).regen).toBeNull();
  });
  it('null before two ticks', () => {
    cycle(0, { hp: 1000 });
    const { st } = cycle(1, { hp: 1038 });
    agent._setZealStateForTest(who(), { ...st, charInfo: [], buffs: [] });
    expect(agent._serializeMeState().regen).toBeNull();
  });
  it('is fed from every Zeal frame, and damage and casts taint it, in the shipped handler', () => {
    const src = stripJs(agentSrc);
    expect(src).toMatch(/_zealState\[character\] = \{ \.\.\.st, updatedAt: Date\.now\(\) \};\s*try \{ _meRegenFrame\(/);
    expect(src).toMatch(/if \(dir === 'in'\) _meRegenTaint\(cl\)/);
    expect(src).toMatch(/startsWith\('You begin casting '\) \|\| msg\.startsWith\('You have been healed'\)[^\n]*_meRegenTaint\(cl\)/);
    expect(src).toMatch(/regen: _meRegenFor\(cl, now, _meRegenInCombat\(cl, st, now\)\)/);
  });
});

// ── the HUD ──────────────────────────────────────────────────────────────────────────────────────────────
const script = meHtml.slice(meHtml.indexOf('<script>') + 8, meHtml.indexOf('</script>'));
const renderBlock = script.slice(script.indexOf('  // ── helpers'), script.indexOf('  var bodyEl'));
let R;
beforeEach(() => {
  clock = BASE;
  // eslint-disable-next-line no-new-func
  R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + renderBlock
    + '\nreturn { renderA, renderHud, hudParts, HUD_DEFAULTS, HUD_PARTS, regenPulse, regenInfo };')();
  Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {}, clickyPick: [] });
});

const snap = (o = {}) => ({
  ok: true, character: 'Aldenmar', level: 60, class: 'Cleric', no_mana: false,
  hp: { cur: 1500, max: 2000, pct: 75 }, mana: { cur: 500, max: 1000, pct: 50 },
  tick: { ms_left: 3000, period_ms: 6000, source: 'zeal' },
  regen: { hp: 38, mana: 21, n_ticks: 4, quiet: true },
  ...o,
});
const ringLabel = (h, id) => ((h.match(new RegExp('<textPath href="#' + id + '"[^>]*>([\\s\\S]*?)</textPath>')) || [])[1] || '').replace(/<title>[^<]*<\/title>/g, '').replace(/<[^>]+>/g, '');

describe('the pulse timing (pure)', () => {
  it('is on in the last second before the tick, and only then', () => {
    expect(R.regenPulse(1000)).toBe(true);
    expect(R.regenPulse(500)).toBe(true);
    expect(R.regenPulse(1)).toBe(true);
    expect(R.regenPulse(1001)).toBe(false);
    expect(R.regenPulse(3000)).toBe(false);
    expect(R.regenPulse(0)).toBe(false);       // the tick just landed
    expect(R.regenPulse(null)).toBe(false);
    expect(R.regenPulse(undefined)).toBe(false);
  });
  it('reads the tick the agent sent, aged to now', () => {
    expect(R.regenInfo(snap({ tick: { ms_left: 800 } })).pulse).toBe(true);
    expect(R.regenInfo(snap({ tick: { ms_left: 4000 } })).pulse).toBe(false);
    expect(R.regenInfo(snap({ tick: null })).pulse).toBe(false);
    clock = BASE + 3000;                       // three seconds later the same snapshot's tick is 3 s older…
    Date.now = () => clock;                    // …but _lastAt was taken at load, so age is real
    expect(R.regenInfo(snap({ tick: { ms_left: 4000 } })).pulse).toBe(true);   // 4000 − 3000 = 1000 left
  });
});

describe('the ring HUD', () => {
  it('draws a green "+N / tick" after the HP and mana labels, with "observed over N quiet ticks" as its tooltip', () => {
    const h = R.renderHud(snap());
    expect(ringLabel(h, 'hhp')).toContain('HP 75% +38 / tick');
    expect(ringLabel(h, 'hrt')).toContain('MANA 50% +21 / tick');
    expect(h).toContain('fill="var(--green)" font-weight="700"> +38 / tick<title>observed over 4 quiet ticks</title>');
  });
  it('draws nothing when the agent sends no regen (null, quiet false, nothing above zero)', () => {
    for (const regen of [null, undefined, { hp: 38, mana: 21, n_ticks: 4, quiet: false }, { hp: 0, mana: null, n_ticks: 2, quiet: true }]) {
      const h = R.renderHud(snap({ regen }));
      expect(h, JSON.stringify(regen)).not.toContain('/ tick');
      expect(h).not.toContain('rgp-edge');
    }
  });
  it('leaves out the stat it has no number for, and mana for a class with none', () => {
    expect(ringLabel(R.renderHud(snap({ regen: { hp: 38, mana: null, n_ticks: 2, quiet: true } })), 'hrt')).not.toContain('tick');
    const h = R.renderHud(snap({ no_mana: true, mana: { cur: 0, max: 0, pct: null }, end: { pct: 80 } }));
    expect(h).not.toContain('+21');
  });
  it('the part can be switched off in the builder', () => {
    expect(R.HUD_PARTS.find(g => g[0] === 'You')[1].map(it => it[0])).toContain('regen');
    expect(R.HUD_DEFAULTS.regen).toBe(1);
    R.hudParts.regen = 0;
    expect(R.renderHud(snap())).not.toContain('/ tick');
  });
  it('the glow is a class: "on" only in the last second, the same markup otherwise', () => {
    const quiet = R.renderHud(snap({ tick: { ms_left: 3000 } }));
    const later = R.renderHud(snap({ tick: { ms_left: 2900 } }));
    const pulsing = R.renderHud(snap({ tick: { ms_left: 900 } }));
    expect((quiet.match(/class="rgp-edge"/g) || []).length).toBe(2);       // HP and mana, unlit
    expect(quiet).not.toContain('rgp-edge on');
    expect((pulsing.match(/class="rgp-edge on"/g) || []).length).toBe(2);
    // The only difference between a quiet second and the pulse is that class (plus the tick bar's own digits).
    const strip = (s) => s.replace(/ on"/g, '"').replace(/TICK \d/g, 'TICK').replace(/stroke-dasharray[^ ]*/g, '');
    expect(strip(pulsing).replace(/<path d="[^"]*" stroke="#8b949e"[^>]*>/g, '')).toBe(strip(quiet).replace(/<path d="[^"]*" stroke="#8b949e"[^>]*>/g, ''));
    expect(later.replace(/TICK \d/, '')).not.toBe('');
  });
  it('the glow sits at the fill\'s edge: HP grows clockwise from 236°, mana from 124° back', () => {
    const edge = (h, i) => (h.match(/<path class="rgp-edge[^"]*" d="M([\d.]+) ([\d.]+)/g) || [])[i];
    const full = R.renderHud(snap({ hp: { cur: 2000, max: 2000, pct: 100 } }));
    const half = R.renderHud(snap({ hp: { cur: 1000, max: 2000, pct: 50 } }));
    expect(edge(full, 0)).not.toBe(edge(half, 0));
    const lowMana = R.renderHud(snap({ mana: { cur: 100, max: 1000, pct: 10 } }));
    expect(edge(lowMana, 1)).not.toBe(edge(R.renderHud(snap()), 1));
  });
});

describe('the classic panel', () => {
  it('writes "+N / tick" at the right of the HP and mana bars, and is byte-stable between polls', () => {
    const a = R.renderA(snap({ tick: { ms_left: 4000 } }));
    expect(a).toContain('<em class="rg" title="observed over 4 quiet ticks">+38 / tick</em>');
    expect(a).toContain('<em class="rg" title="observed over 4 quiet ticks">+21 / tick</em>');
    expect(R.renderA(snap({ tick: { ms_left: 3500 } }))).toBe(a);        // the tick moved, nothing visible did
    expect(a).not.toContain('bar rgp');
  });
  it('lights the bars in the last second', () => {
    expect(R.renderA(snap({ tick: { ms_left: 700 } }))).toContain('class="bar rgp"');
  });
  it('is the old markup when there is no regen', () => {
    expect(R.renderA(snap({ regen: null }))).not.toContain('tick</em>');
  });
});

// ── the canvas ───────────────────────────────────────────────────────────────────────────────────────────
describe('the canvas pieces', () => {
  globalThis.window = globalThis;
  require('../apps/mimic/parts.js');
  const WpParts = globalThis.WpParts;
  const hp = WpParts.byId['me.hp'], mana = WpParts.byId['me.mana'];
  const d = (o = {}) => snap(o);
  it('me.hp and me.mana carry the regen in their view, with the pulse from the tick aged to now', () => {
    const at = Date.now();
    expect(hp.get(d(), at).regen).toEqual({ text: '+38 / tick', pulse: false, tip: 'observed over 4 quiet ticks' });
    expect(mana.get(d(), at).regen.text).toBe('+21 / tick');
    expect(hp.get(d({ tick: { ms_left: 600 } }), at).regen.pulse).toBe(true);
    expect(hp.get(d({ regen: null }), at).regen).toBeUndefined();
    expect(mana.get(d({ no_mana: true }), at)).toBeNull();
    expect(WpParts.regenPulse(1000)).toBe(true);
    expect(WpParts.regenPulse(1001)).toBe(false);
    expect(WpParts.regenPulse(0)).toBe(false);
  });
  it('asks the canvas to redraw them between polls so the pulse flips on time', () => {
    expect(hp.repaint).toBe(true);
    expect(mana.repaint).toBe(true);
    const canvas = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html')));
    expect(canvas).toMatch(/d\.kind !== 'countdown' && !d\.repaint\) return/);
  });
  it('Bar and Slim bar write it beside the label and light the track in the last second', () => {
    const at = Date.now();
    const v = (ms) => hp.get(d({ tick: { ms_left: ms } }), at);
    for (const mode of ['bar', 'thin']) {
      const quiet = WpParts.render(hp, mode, v(3000), Date.now());
      const pulse = WpParts.render(hp, mode, v(500), Date.now());
      expect(quiet, mode).toContain('<span class="pt-rg" title="observed over 4 quiet ticks">+38 / tick</span>');
      expect(quiet).not.toContain('rgp');
      expect(pulse).toContain('class="pt-track rgp"');
    }
    expect(WpParts.render(hp, 'bar', hp.get(d({ regen: null }), at), Date.now())).not.toContain('pt-rg');
  });
  it('Ring arc writes it in the arc\'s label and draws the glow at the fill edge, lit in the last second', () => {
    const at = Date.now();
    const quiet = WpParts.render(hp, 'seg', hp.get(d({ tick: { ms_left: 3000 } }), at), Date.now(), { arc: { r: 172, a0: 236, a1: 304, w: 3.3, lr: 182, ls: 11 }, uid: 'a' });
    const pulse = WpParts.render(hp, 'seg', hp.get(d({ tick: { ms_left: 500 } }), at), Date.now(), { arc: { r: 172, a0: 236, a1: 304, w: 3.3, lr: 182, ls: 11 }, uid: 'a' });
    expect(quiet).toContain('+38 / tick');
    expect(quiet).toContain('class="pt-edge"');
    expect(pulse).toContain('class="pt-edge on"');
    expect(WpParts.render(hp, 'seg', hp.get(d({ regen: null }), at), Date.now(), { uid: 'a' })).not.toContain('pt-edge');
  });
});
