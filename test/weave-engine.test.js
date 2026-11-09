// test/weave-engine.test.js — the Weave timer (apps/mimic/weave.js, weaveDraw.js, and where they are wired in).
//
// The guild lead, 2026-11-07: a monk weaves with a social macro (kick, then /bandolier load one 2H, then /bandolier load
// the other) and wants to SEE when to press, locally and as close to real time as possible. The engine runs in Mimic's main
// process off the Zeal pipe, timestamping each line at ARRIVAL; these tests drive it with synthetic arrival times.
//
// The numbers come from the server's own code (SecretsOTheP/EQMacEmu c2cd265, zone/attack.cpp:3160 GetHandToHandDelay, :4686
// SetAttackTimer; common/timer.cpp:156 Timer::SetDuration): a human level-60 monk's fists are delay 26, a 2H of delay 30 at
// haste 1.7 swings every 1.7647 s, so the fists are ready again every 1.529 s.
//
// Wiring assertions strip comments first (test/_source-slice.js: a comment can satisfy a matcher). Names are invented.
// Every assertion here was mutation-checked (see the notes at the bottom).
//
// Run: npx vitest run test/weave-engine.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const W = require(path.join(MIMIC, 'weave.js'));

const TWO = (verb = 'crush') => `You ${verb} a gnoll for 120 points of damage.`;
const FIST = (verb = 'punch') => `You ${verb} a gnoll for 25 points of damage.`;
const LOAD = (n = 'caen') => `Loading bandolier set [${n}]`;
const IV = 3000 / 1.7;                       // 1764.7 ms: a delay-30 2H at haste 1.7
const eng = (cfg) => new W.WeaveEngine(cfg);
// Feed `n` 2H rounds every `iv` ms from t0; returns the time of the last.
function rounds(e, n, iv = IV, t0 = 1000) {
  let t = t0;
  for (let i = 0; i < n; i++) { e.swing(TWO(), t); t += iv; }
  return t - iv;
}

describe('the hand-to-hand delay table (attack.cpp:3160)', () => {
  it('a human monk at 60 is 26, an Iksar 29', () => {
    expect(W.handToHandDelay({ cls: 'monk', level: 60, race: 'human' })).toBe(26);
    expect(W.handToHandDelay({ cls: 'monk', level: 60, race: 'iksar' })).toBe(29);
  });
  it('61 and 62 step down, 63 and up are 20 / 21, the epic is 16 above level 50', () => {
    expect(W.handToHandDelay({ level: 61 })).toBe(24);
    expect(W.handToHandDelay({ level: 62 })).toBe(22);
    expect(W.handToHandDelay({ level: 61, race: 'iksar' })).toBe(25);
    expect(W.handToHandDelay({ level: 62, race: 'iksar' })).toBe(23);
    expect(W.handToHandDelay({ level: 63 })).toBe(20);
    expect(W.handToHandDelay({ level: 65, race: 'iksar' })).toBe(21);
    expect(W.handToHandDelay({ level: 60, epic: true })).toBe(16);
    expect(W.handToHandDelay({ level: 50, epic: true })).toBe(W.handToHandDelay({ level: 50 }));
  });
  it('the low levels use the full tables', () => {
    expect(W.handToHandDelay({ level: 1 })).toBe(35);
    expect(W.handToHandDelay({ level: 28 })).toBe(34);
    expect(W.handToHandDelay({ level: 40 })).toBe(31);
    expect(W.handToHandDelay({ level: 55 })).toBe(28);
    expect(W.handToHandDelay({ level: 56 })).toBe(27);
    expect(W.handToHandDelay({ level: 40, race: 'iksar' })).toBe(33);
    expect(W.handToHandDelay({ level: 60, cls: 'beastlord' })).toBe(28);
    expect(W.handToHandDelay({ level: 64, cls: 'beastlord' })).toBe(27);
  });
});

describe('lines', () => {
  it('your hits and misses are swings; the verb sorts them into 2H and fist', () => {
    const cfg = W.cleanCfg({});
    expect(W.parseSwing(TWO())).toEqual({ verb: 'crush', target: 'a gnoll', miss: false });
    expect(W.parseSwing('You try to punch a gnoll, but miss!')).toEqual({ verb: 'punch', target: 'a gnoll', miss: true });
    expect(W.parseSwing('You try to crush a gnoll, but a gnoll dodges!').miss).toBe(true);
    expect(W.classify('crush', cfg)).toBe('2h');
    expect(W.classify('crushes', cfg)).toBe('2h');
    expect(W.classify('punch', cfg)).toBe('fist');
    expect(W.classify('strikes', cfg)).toBe('fist');
  });
  it('a kick, a flying kick and any other special is not a swing', () => {
    const cfg = W.cleanCfg({});
    expect(W.classify('kick', cfg)).toBeNull();
    expect(W.classify('bash', cfg)).toBeNull();
    const e = eng();
    expect(e.swing('You kick a gnoll for 90 points of damage.', 1000)).toBe(false);
    expect(e.swing('You slash a gnoll for 90 points of damage.', 1000)).toBe(false);
    expect(e.last2H).toBeNull();
  });
  it('only lines that start "You " are yours, and non-melee damage is not a swing', () => {
    expect(W.parseSwing('Brackwyn crushes a gnoll for 120 points of damage.')).toBeNull();
    expect(W.parseSwing('a gnoll crushes YOU for 30 points of damage.')).toBeNull();
    expect(W.parseSwing('You hit a gnoll for 50 points of non-melee damage.')).toBeNull();
    expect(W.parseSwing('Your pet crushes a gnoll for 12 points of damage.')).toBeNull();
  });
  it('a log timestamp in front is tolerated', () => {
    expect(W.parseSwing('[Sat Nov 07 20:11:02 2026] ' + TWO()).verb).toBe('crush');
    expect(W.parseLoad('[Sat Nov 07 20:11:02 2026] ' + LOAD('tranquil'))).toBe('tranquil');
  });
  it('the verb lists are configurable, cleaned, and never overlap', () => {
    const c = W.cleanCfg({ twoVerbs: 'slash, slashes', fistVerbs: ['punch', 'slash', 'BASH!!', 'hit'] });
    expect(c.twoVerbs).toEqual(['slash', 'slashes']);
    expect(c.fistVerbs).toEqual(['punch', 'hit']);
    expect(W.cleanCfg({ twoVerbs: '<script>' }).twoVerbs).toEqual(['crush', 'crushes']);
    expect(W.cleanCfg({ twoHDelay: 9999 }).twoHDelay).toBe(30);
    expect(W.cleanCfg({ level: 'x' }).level).toBe(60);
  });
});

describe('the 2H interval and the haste it implies', () => {
  it('is the median of the last six round-to-round intervals once there are three, the configured delay before', () => {
    const e = eng();
    expect(e.interval2H()).toBe(3000);
    e.swing(TWO(), 0); e.swing(TWO(), 1700); e.swing(TWO(), 3500);
    expect(e.measured()).toBe(false);
    expect(e.interval2H()).toBe(3000);
    e.swing(TWO(), 5200);
    expect(e.measured()).toBe(true);
    expect(e.interval2H()).toBe(1700);                 // 1700, 1800, 1700 -> 1700
    e.swing(TWO(), 7000); e.swing(TWO(), 8700); e.swing(TWO(), 10400);
    expect(e.samples.length).toBe(6);
    expect(e.interval2H()).toBe(1700);                 // 1700 1800 1700 1800 1700 1700
  });
  it('a round far longer than the others (twice the median) is not an interval', () => {
    const e = eng();
    rounds(e, 5, 1700, 0);
    const before = e.samples.length;
    e.swing(TWO(), 8000 + 4000 + 1700);                // 4 s gap, the median is 1.7 s
    expect(e.samples.length).toBe(before);
    expect(e.interval2H()).toBe(1700);
  });
  it('haste = delay x100 / interval, and the fist interval follows it (26 at 1.7 is 1.529 s)', () => {
    const e = eng({ level: 60, race: 'human' });
    rounds(e, 6);
    const c = e.core();
    expect(c.interval2H).toBeCloseTo(IV, 0);
    expect(c.haste).toBeCloseTo(1.7, 2);
    expect(c.fistInterval).toBeCloseTo(1529.4, 0);
    expect(eng({ level: 60, race: 'iksar' }).core().fistInterval).toBeCloseTo(2900, 0);   // unhasted: 29 x 100
  });
  it('a double attack prints two lines inside one round, which are ONE round', () => {
    const e = eng();
    let t = 0;
    for (let i = 0; i < 6; i++) { e.swing(TWO(), t); e.swing(TWO(), t + 120); t += 1700; }
    expect(e.samples).toEqual([1700, 1700, 1700, 1700, 1700]);
    expect(e.last2H).toBe(8500);
  });
  it('a miss is a swing too (it times the round the same)', () => {
    const e = eng();
    e.swing(TWO(), 0); e.swing('You try to crush a gnoll, but miss!', 1700);
    expect(e.samples).toEqual([1700]);
  });
});

describe('the window for the next press', () => {
  // last 2H at T; fists ready (none thrown); fist interval 1529.4; margin 150 -> [T, T + 1379.4]
  const T = 20000;
  const fresh = () => { const e = eng({ marginMs: 150 }); rounds(e, 6, IV, T - 5 * IV); return e; };

  it('opens at the 2H swing and closes at last2H + fistInterval - margin; late after that; swing at the next 2H', () => {
    const e = fresh();
    expect(e.last2H).toBeCloseTo(T, 0);
    const at = (dt) => W.derive(e.core(), T + dt);
    expect(at(100).phase).toBe('go');
    expect(at(1000).phase).toBe('go');
    expect(at(1370).phase).toBe('go');
    expect(at(1390).phase).toBe('late');
    expect(at(1700).phase).toBe('late');
    expect(at(1800).phase).toBe('swing');
    const d = at(500);
    expect(d.open).toBeCloseTo(T, 0);
    expect(d.close).toBeCloseTo(T + 1529.4 - 150, 0);
    expect(d.next2H).toBeCloseTo(T + IV, 0);
  });
  it('after a fist round the window waits for lastFist + fistInterval', () => {
    const e = fresh();
    e.swing(FIST(), T + 200);
    const at = (dt) => W.derive(e.core(), T + dt);
    expect(at(300).phase).toBe('wait');
    expect(at(300).open).toBeCloseTo(T + 200 + 1529.4, 0);
    expect(at(300).open).toBeGreaterThan(at(300).close);       // no window at all this cycle
    expect(at(1700).phase).toBe('wait');                       // the fist is not ready until T+1729, 35 ms before the next 2H swing
  });
  it('a wider margin closes the window sooner', () => {
    const e = eng({ marginMs: 400 }); rounds(e, 6, IV, T - 5 * IV);
    expect(W.derive(e.core(), T + 1200).phase).toBe('late');
    expect(W.derive(fresh().core(), T + 1200).phase).toBe('go');
  });
  it('rolls the cycle forward when the 2H line has not arrived yet, and trusts a fist that old to be ready', () => {
    const e = fresh();
    e.swing(FIST(), T + 200);
    const d = W.derive(e.core(), T + IV * 2 + 400);
    expect(d.base).toBeCloseTo(T + IV * 2, 0);
    expect(d.rolled).toBe(2);
    expect(d.phase).toBe('go');
  });
  it('lays out the next cycles: wait/go/late and the predicted swings', () => {
    const e = fresh();
    const z = W.zones(e.core(), T + 100, 2);
    expect(z.zones.map((x) => x.kind + x.k)).toEqual(['go0', 'late0', 'go1', 'late1']);
    expect(z.swings.map((s) => Math.round(s.at))).toEqual([Math.round(T + IV), Math.round(T + 2 * IV)]);
    e.swing(FIST(), T + 200);
    expect(W.zones(e.core(), T + 300, 1).zones.map((x) => x.kind)).toEqual(['wait', 'late']);
  });
  it('is null before any 2H swing has been seen', () => {
    expect(W.derive(eng().core(), 1000)).toBeNull();
    expect(eng().snapshot(1000).active).toBe(false);
  });
});

describe('what a press did', () => {
  const T = 30000;
  const ready = () => { const e = eng(); rounds(e, 6, IV, T - 5 * IV); return e; };

  it('landed: a fist round right after the press, and the next 2H round on time', () => {
    const e = ready();
    e.load(LOAD('tranquil'), T + 300);
    e.swing(FIST(), T + 340);
    e.swing(TWO(), T + IV + 40);
    expect(e.outcome.kind).toBe('landed');
    expect(e.tally).toEqual({ presses: 1, landed: 1, clips: 0, misses: 0 });
  });
  it('clip: the next 2H round more than 250 ms later than expected (the swap came too late), and that interval is not measured', () => {
    const e = ready();
    e.load(LOAD(), T + 1600);
    e.swing(FIST(), T + 1650);
    const n = e.samples.length;
    e.swing(TWO(), T + IV + 400);
    expect(e.outcome.kind).toBe('clip');
    expect(e.tally.clips).toBe(1);
    expect(e.samples.length).toBe(n);
  });
  it('250 ms late exactly is still on time, 251 is not', () => {
    // whole-millisecond rounds, so the expected time is exact
    const whole = () => { const e = eng(); rounds(e, 6, 1700, T - 8500); return e; };
    const a = whole(); a.load(LOAD(), T + 300); a.swing(FIST(), T + 340); a.swing(TWO(), T + 1700 + 250);
    expect(a.outcome.kind).toBe('landed');
    const b = whole(); b.load(LOAD(), T + 300); b.swing(FIST(), T + 340); b.swing(TWO(), T + 1700 + 251);
    expect(b.outcome.kind).toBe('clip');
  });
  it('miss: no fist line after the press', () => {
    const e = ready();
    e.load(LOAD(), T + 300);
    e.swing(TWO(), T + IV);
    expect(e.outcome.kind).toBe('miss');
    expect(e.tally).toEqual({ presses: 1, landed: 0, clips: 0, misses: 1 });
  });
  it('a fist round more than 700 ms after the load is not that press\'s', () => {
    const e = ready();
    e.load(LOAD(), T + 100);
    e.swing(FIST(), T + 900);
    e.swing(TWO(), T + IV);
    expect(e.outcome.kind).toBe('miss');
  });
  it('the macro\'s two loads back to back are ONE press', () => {
    const e = ready();
    e.load(LOAD('tranquil'), T + 300);
    e.load(LOAD('caen'), T + 700);
    expect(e.tally.presses).toBe(1);
    e.swing(FIST(), T + 740);
    e.swing(TWO(), T + IV);
    expect(e.tally).toEqual({ presses: 1, landed: 1, clips: 0, misses: 0 });
    expect(e.lastPress).toBe(T + 700);
  });
  it('two presses in two cycles are two outcomes', () => {
    const e = ready();
    e.load(LOAD(), T + 200); e.swing(FIST(), T + 240); e.swing(TWO(), T + IV);
    e.load(LOAD(), T + IV + 200); e.swing(FIST(), T + IV + 240); e.swing(TWO(), T + 2 * IV);
    expect(e.tally).toEqual({ presses: 2, landed: 2, clips: 0, misses: 0 });
  });
  it('a press nobody saw a 2H round after settles by time: a fist but no 2H is a clip', () => {
    const e = ready();
    e.load(LOAD(), T + 1600); e.swing(FIST(), T + 1650);
    e.tick(T + 1600 + 4000);
    expect(e.outcome.kind).toBe('clip');
  });
  it('a line that is not a load does nothing', () => {
    const e = ready();
    expect(e.load('Bandolier set [caen] is already equipped', T + 10)).toBe(false);
    expect(e.tally.presses).toBe(0);
  });
});

describe('fights', () => {
  it('twelve seconds with no swing ends the fight: the tally and the samples reset, one final idle state', () => {
    const e = eng();
    rounds(e, 6, IV, 0);
    e.load(LOAD(), 9000);
    expect(e.snapshot(9500).active).toBe(true);
    expect(e.tick(9500)).toBe(false);
    const last = e.lastSwingAt;
    expect(e.snapshot(last + 11900).active).toBe(true);
    expect(e.snapshot(last + 12100).active).toBe(false);
    expect(e.tick(last + 12100)).toBe(true);
    expect(e.tally).toEqual({ presses: 0, landed: 0, clips: 0, misses: 0 });
    expect(e.samples).toEqual([]);
    expect(e.snapshot(last + 12200).phase).toBe('idle');
  });
  it('a swing after a long gap starts a new fight even if no tick ran', () => {
    const e = eng();
    rounds(e, 6, IV, 0);
    e.load(LOAD(), 9000);
    e.swing(TWO(), 40000);
    expect(e.tally.presses).toBe(0);
    expect(e.samples).toEqual([]);
    expect(e.last2H).toBe(40000);
  });
});

describe('the hub: pipe objects in, states out', () => {
  const chat = (character, colour, text) => ({ type: 0, character, data: JSON.stringify({ type: colour, text }) });
  function hub() {
    const sent = []; let now = 100000;
    const h = W.createWeaveHub({ send: (s) => sent.push(s), now: () => now });
    return { h, sent, at: (t) => { now = t; }, advance: (d) => { now += d; } };
  }

  it('does nothing until something is listening', () => {
    const { h, sent } = hub();
    expect(h.note(chat('Aldenmar', 265, TWO()))).toBe(false);
    expect(h.engines.size).toBe(0);
    expect(sent.length).toBe(0);
  });
  // The guild lead, 2026-11-08: "WEAVING IS WAITING FOR A FIGHT BUT I'M IN ONE". Your lines count by their words on any
  // colour (a crit prints on its own colour); other people's never do, whatever the colour.
  it('takes your melee lines on any colour and bandolier loads; never other people\'s hits or non-melee', () => {
    const { h, sent, advance } = hub();
    h.setEnabled(true);
    expect(h.note(chat('Aldenmar', 265, TWO()))).toBe(true);
    advance(100);
    expect(h.note(chat('Aldenmar', 267, 'You try to crush a gnoll, but miss!'))).toBe(true);
    advance(400);
    expect(h.note(chat('Aldenmar', 301, TWO()))).toBe(true);                        // a crit's colour
    advance(400);
    expect(h.note(chat('Aldenmar', 266, 'Brackwyn crushes a gnoll for 5 points of damage.'))).toBe(false);
    expect(h.note(chat('Aldenmar', 265, 'Brackwyn crushes a gnoll for 5 points of damage.'))).toBe(false);
    expect(h.note(chat('Aldenmar', 264, 'You hit a gnoll for 900 points of non-melee damage.'))).toBe(false);
    expect(h.note(chat('Aldenmar', 1010, LOAD('caen')))).toBe(true);
    expect(h.note({ type: 2, character: 'Aldenmar', data: '[]' })).toBe(false);     // a gauge is not a chat line
    expect(h.note({ type: 0, character: 'Aldenmar', data: 'not json' })).toBe(false);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[sent.length - 1].character).toBe('Aldenmar');
    expect(sent[sent.length - 1].source).toBe('zeal');
  });
  it('melee seen but no word matched: the state names the word, and the idle canvas line says it', () => {
    const { h, sent, advance } = hub();
    h.setEnabled(true);
    expect(h.note(chat('Aldenmar', 265, 'You bludgeon a gnoll for 40 points of damage.'))).toBe(false);
    advance(2100);
    expect(h.note(chat('Aldenmar', 265, 'You kick a gnoll for 30 points of damage.'))).toBe(false);   // a kick is never offered
    expect(h.note(chat('Aldenmar', 265, 'You bludgeon a gnoll for 41 points of damage.'))).toBe(false);
    const st = sent[sent.length - 1];
    expect(st.active).toBe(false);
    expect(st.diag).toEqual({ seen: 2, matched: 0, lastVerb: 'bludgeon' });
    const draw = src('weaveDraw.js');
    expect(draw).toContain('\'Weaving timer: your swings say "\' + String(dg.lastVerb).slice(0, 16)');
  });
  it('keeps a character\'s engine apart from another\'s', () => {
    const { h, advance } = hub();
    h.setEnabled(true);
    h.note(chat('Aldenmar', 265, TWO())); advance(2000);
    h.note(chat('Corvale', 265, TWO()));
    expect(h.engines.size).toBe(2);
    expect(h.engines.get('aldenmar').eng.last2H).not.toBe(h.engines.get('corvale').eng.last2H);
  });
  it('sends at most one state per 33 ms from events, and the 50 ms tick keeps an active fight flowing', () => {
    const { h, sent, advance } = hub();
    h.setEnabled(true);
    h.note(chat('Aldenmar', 265, TWO()));
    const n = sent.length;
    advance(10); h.note(chat('Aldenmar', 265, TWO()));
    expect(sent.length).toBe(n);                       // inside the throttle
    advance(60); h.tick();
    expect(sent.length).toBe(n + 1);
    expect(sent[sent.length - 1].active).toBe(true);
  });
  it('sends one final idle state when the fight ends, then stays quiet', () => {
    const { h, sent, advance } = hub();
    h.setEnabled(true);
    h.note(chat('Aldenmar', 265, TWO()));
    advance(12500); h.tick();
    const idle = sent[sent.length - 1];
    expect(idle.active).toBe(false);
    expect(idle.phase).toBe('idle');
    const n = sent.length;
    advance(60); h.tick(); advance(60); h.tick();
    expect(sent.length).toBe(n);
  });
  it('a configured character with no pipe for 5 s is told it needs Zeal, once a second', () => {
    const { h, sent, advance } = hub();
    h.setConfig('Aldenmar', { character: 'Aldenmar', cls: 'monk', level: 60 });
    h.tick();
    expect(sent.length).toBe(1);
    expect(sent[0].source).toBe('needs-zeal');
    advance(100); h.tick();
    expect(sent.length).toBe(1);
    advance(1000); h.tick();
    expect(sent.length).toBe(2);
    h.note({ type: 3, character: 'Aldenmar', data: '{}' });                        // any pipe object proves the pipe is talking
    advance(1500); h.tick();
    expect(sent.length).toBe(2);
  });
  it('a config sets the class, level and delay; a piece\'s partial config keeps the rest', () => {
    const { h } = hub();
    h.setConfig('Aldenmar', { character: 'Aldenmar', cls: 'monk', level: 61, twoHDelay: 36, race: 'iksar' });
    expect(h.engines.get('aldenmar').eng.cfg.twoHDelay).toBe(36);
    h.setConfig('Aldenmar', { character: 'Aldenmar', cls: 'monk', level: 62, partial: true });
    const c = h.engines.get('aldenmar').eng.cfg;
    expect([c.level, c.twoHDelay, c.race]).toEqual([62, 36, 'iksar']);
  });
});

// ── Wiring (comments stripped) ───────────────────────────────────────────────────────────────────────────────────
const src = (f) => stripJs(readSource(path.join(MIMIC, f)));
const main = src('main.js'), preload = src('preload.js'), parts = src('parts.js');
const meHtml = readSource(path.join(MIMIC, 'me.html')), canvasHtml = readSource(path.join(MIMIC, 'canvas.html'));
const meScriptRaw = meHtml.slice(meHtml.indexOf('<script>') + 8, meHtml.indexOf('</script>'));
const meScript = stripJs(meScriptRaw);   // for text assertions; the slice below needs its comment anchors, so it reads the raw one

describe('wiring', () => {
  it('main.js feeds every pipe object to the engine, from the same handler that absorbs them, and does not touch the Chat or agent path', () => {
    expect(main).toContain("const { createWeaveHub } = require('./weave');");
    const onEvent = main.slice(main.indexOf('onEvent: (pid, obj) => {'));
    const body = onEvent.slice(0, onEvent.indexOf('setInterval(_flushZealToAgent'));
    expect(body).toContain('_weaveHub.note(obj);');
    expect(body).toContain('_zealAbsorb(obj, pid);');
    expect(body).toContain('_zealChatNote(obj);');
    expect(main).toContain("ipcMain.on('weave-subscribe'");
    expect(main).toContain("ipcMain.on('weave-config'");
    expect(main).toContain("f.send('weave-state', st)");
    expect(main).toContain('_weaveHub.tick()');
  });
  it('the Chat path still drops the melee colours (the engine reads the pipe object, not the Chat overlay\'s copy)', () => {
    const pipe = src('zealPipe.js');
    expect(pipe).toContain('new Set([265, 266, 279, 283, 1000, 1001])');
  });
  it('preload exposes onWeaveState (and subscribes) and setWeaveConfig', () => {
    expect(preload).toMatch(/onWeaveState:\s*\(cb\)\s*=>\s*\{\s*ipcRenderer\.send\('weave-subscribe'\);\s*ipcRenderer\.on\('weave-state'/);
    expect(preload).toContain("setWeaveConfig: (cfg)   => ipcRenderer.send('weave-config', cfg)");
  });
  it('parts.js registers me.weave as its own kind, drawn as a highway or a lane, and the Canvas loads the painter', () => {
    expect(parts).toContain("P('me.weave', 'me', 'Weaving timer', 'me', 'weave',");
    expect(parts).toContain("weave:     [['highway', 'Timing highway'], ['lane', 'Upright lane']]");
    expect(parts).toContain("highway: rWeave('highway'), lane: rWeave('lane')");
    expect(canvasHtml).toMatch(/<script src="weave.js"><\/script>\s*<script src="weaveDraw.js"><\/script>/);
    expect(canvasHtml).toContain('WpWeaveDraw.start()');
  });
  it('the piece\'s HTML does not change between polls (the canvas is never rebuilt)', () => {
    const P = require(path.join(MIMIC, 'parts.js'));    // loads on globalThis in node
    void P;
    const g = globalThis.WpParts;
    const d = g.byId['me.weave'];
    const a = g.render(d, 'highway', { char: 'Aldenmar', cls: 'Monk', level: 60 }, 1), b = g.render(d, 'highway', { char: 'Aldenmar', cls: 'Monk', level: 60 }, 99999);
    expect(a).toBe(b);
    expect(a).toContain('<canvas data-wp-weave="highway" data-wp-char="Aldenmar"');
    expect(g.render(d, 'lane', { char: 'Aldenmar', cls: 'Monk', level: 60 }, 1)).toContain('data-wp-weave="lane"');
  });
  it('me.html: the lane is a canvas, off for other classes, on for a Monk and a Beastlord, placed by layoutWeave, and the settings ride to main', () => {
    expect(meHtml).toContain('<canvas id="weavecv" data-wp-weave="lane"');
    expect(meScript).toContain("weave: 'auto'");
    expect(meScript).toContain("/^(monk|beastlord)$/i.test(String((s && s['class']) || ''))");
    expect(meScript).toContain('window.mimic.setWeaveConfig(JSON.parse(cfg))');
    expect(meScript).toContain('layoutWeave(s);');
    expect(meScript).toContain("['weave', 'Lane on the right (auto = Monk and Beastlord)', ['auto', 'on', 'off']]");
    expect(meHtml).toMatch(/<\/script>\s*<script src="weave.js"><\/script>\s*<script src="weaveDraw.js"><\/script>\s*<\/body>/);
  });
  // The guild lead, 2026-11-07: "please curve the line to match the arc for the circle". The ring's canvas is an "arc":
  // the real painter, on a stand-in canvas, strokes arcs at the ring's radius inside the right arc's 56°-124° span.
  it('on the ring the lane is drawn along the right arc, at the ring\'s radius and angles', () => {
    expect(meScript).toContain("var kind = isHud(style) ? 'arc' : 'lane';");
    expect(meScript).toContain("cv.setAttribute('data-wp-arc', '172 56 124')");
    const calls = [];
    const ctx = new Proxy({ arc: (x, y, r, a, b) => calls.push({ x, y, r, a, b }) }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
    const attrs = { 'data-wp-weave': 'arc', 'data-wp-arc': '172 56 124', 'data-wp-char': 'Aldenmar' };
    const cv = { clientWidth: 400, clientHeight: 400, width: 0, height: 0, getAttribute: (k) => attrs[k] || null, getContext: () => ctx };
    let queued = null;
    const win = { WpWeave: W, devicePixelRatio: 1, requestAnimationFrame: (fn) => { queued = fn; return 1; },
      getComputedStyle: () => ({ getPropertyValue: () => '', fontFamily: 'monospace' }),
      document: { querySelectorAll: () => [cv], documentElement: {}, body: {} } };
    // eslint-disable-next-line no-new-func
    new Function('window', readSource(path.join(MIMIC, 'weaveDraw.js')))(win);
    const now = Date.now();
    win.WpWeaveDraw._onState({ character: 'Aldenmar', active: true, source: 'zeal',
      core: { last2H: now - 300, lastFist: null, interval2H: IV, haste: 1.7, fistInterval: 2600 / 1.7, marginMs: 150 } });
    queued();
    expect(calls.length).toBeGreaterThan(1);                          // the track and at least one window
    const deg = (rad) => rad * 180 / Math.PI + 90;
    for (const c of calls) {
      expect(c.r).toBeCloseTo(172, 5);
      expect([c.x, c.y]).toEqual([200, 200]);
      expect(deg(c.a)).toBeGreaterThanOrEqual(56 - 1e-9);
      expect(deg(c.b)).toBeLessThanOrEqual(124 + 1e-9);
    }
  });
  it('the painter asks for frames only while a fight is live, and the lane never takes clicks', () => {
    const draw = src('weaveDraw.js');
    expect(draw).toContain('if (any) raf = root.requestAnimationFrame(frame);');
    expect(draw.match(/requestAnimationFrame/g).length).toBe(3);   // the guard, the loop, the schedule
    expect(meHtml).toContain('#weavecv{display:none;position:absolute;pointer-events:none;');
  });
});

// The HUD ring itself, run from me.html's own render code (the pattern of me-hud-mana-end.test.js).
describe('the HUD ring: the lane takes the mana / endurance arc', () => {
  const block = meScriptRaw.slice(meScriptRaw.indexOf('  // ── helpers'), meScriptRaw.indexOf('  var bodyEl'));
  // eslint-disable-next-line no-new-func
  const R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + block + '\nreturn { renderHud, hudParts, HUD_DEFAULTS, weaveOn };')();
  const base = { ok: true, character: 'Aldenmar', level: 60, class: 'Cleric', no_mana: false,
    hp: { cur: 5311, max: 6417, pct: 82.8 }, mana: { cur: 1686, max: 3015, pct: 55.9 }, end: { pct: 41 }, cooldowns: [], target: null,
    combat: { live: true, secs: 30, out: { dps: 126, by: {} }, in: { dps: 60, by: {} }, feed: [] } };
  const monk = Object.assign({}, base, { class: 'Monk', no_mana: true, mana: { cur: null, max: null, pct: null } });
  const reset = () => Object.assign(R.hudParts, R.HUD_DEFAULTS, { sizes: {}, clickyPick: [] });
  const arc = (h, colour) => new RegExp('<path d="[^"]*" stroke="var\\(--' + colour + '\\)"').test(h);

  it('auto: on for a Monk and a Beastlord, off for anyone else; on and off override', () => {
    reset();
    expect(R.weaveOn(monk)).toBe(true);
    expect(R.weaveOn(Object.assign({}, base, { class: 'Beastlord' }))).toBe(true);
    expect(R.weaveOn(base)).toBe(false);
    R.hudParts.weave = 'on'; expect(R.weaveOn(base)).toBe(true);
    R.hudParts.weave = 'off'; expect(R.weaveOn(monk)).toBe(false);
    reset();
  });
  it('a monk\'s endurance arc is the lane\'s place; its label stays; off brings the arc back', () => {
    reset();
    const on = R.renderHud(monk);
    expect(arc(on, 'orange')).toBe(false);
    expect(on).toContain('id="hrt"');
    expect(on.replace(/<[^>]+>/g, '')).toContain('END 41%');
    R.hudParts.weave = 'off';
    expect(arc(R.renderHud(monk), 'orange')).toBe(true);
    reset();
  });
  it('a cleric keeps the mana arc by default', () => {
    reset();
    expect(arc(R.renderHud(base), 'blue')).toBe(true);
    R.hudParts.weave = 'on';
    expect(arc(R.renderHud(base), 'blue')).toBe(false);
    reset();
  });
});

// Mutation notes (each was run against weave.js / wiring and made a test above fail):
//  median -> mean, MAX_SAMPLES 6 -> 3, the 2x-median discard removed, ROUND_MS grouping removed (double attack),
//  CLIP_MS 250 -> 400, FIST_AFTER_MS 700 -> 2000, PRESS_GROUP_MS removed, colour 265 -> 266 in the hub, 'You ' guard removed,
//  FIGHT_GAP_MS 12000 -> 30000, the margin dropped from close, lastFist + fistInterval dropped from open, the throttle removed,
//  _weaveHub.note(obj) removed from onEvent, weaveOn's class test removed, the lane gauge not skipped.
