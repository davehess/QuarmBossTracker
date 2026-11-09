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
import { readSource, stripJs, sliceBlock, ROOT } from './_source-slice.js';

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
    expect(e.tally).toEqual({ presses: 1, landed: 1, clips: 0, misses: 0, voided: 0 });
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
    expect(e.tally).toEqual({ presses: 1, landed: 0, clips: 0, misses: 1, voided: 0 });
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
    expect(e.tally).toEqual({ presses: 1, landed: 1, clips: 0, misses: 0, voided: 0 });
    expect(e.lastPress).toBe(T + 700);
  });
  it('two presses in two cycles are two outcomes', () => {
    const e = ready();
    e.load(LOAD(), T + 200); e.swing(FIST(), T + 240); e.swing(TWO(), T + IV);
    e.load(LOAD(), T + IV + 200); e.swing(FIST(), T + IV + 240); e.swing(TWO(), T + 2 * IV);
    expect(e.tally).toEqual({ presses: 2, landed: 2, clips: 0, misses: 0, voided: 0 });
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
    expect(e.tally).toEqual({ presses: 0, landed: 0, clips: 0, misses: 0, voided: 0 });
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
    expect(parts).toContain("weave:     [['highway', 'Timing highway'], ['lane', 'Upright lane'], ['warc', 'Arc'], ['wbar', 'Thin bar']]");
    expect(parts).toContain("highway: rWeave('highway'), lane: rWeave('lane'),");
    expect(parts).toContain("warc: rWeave('arc', '165 -125 125 22'), wbar: rWeave('bar') };");
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
    // 2026-11-09: "other formats available for the weaving, arc, thin vertical line, etc."
    expect(g.render(d, 'warc', { char: 'Aldenmar', cls: 'Monk', level: 60 }, 1)).toContain('<canvas data-wp-weave="arc" data-wp-arc="165 -125 125 22" data-wp-char="Aldenmar"');
    expect(g.render(d, 'wbar', { char: 'Aldenmar', cls: 'Monk', level: 60 }, 1)).toContain('<canvas data-wp-weave="bar" data-wp-char="Aldenmar"');
    expect(g.DEFAULT_SIZE.warc).toEqual([150, 150]);
    expect(g.DEFAULT_SIZE.wbar).toEqual([260, 12]);
  });
  it('the Thin bar paints the windows, a white "now" and the swing ticks, and no text', async () => {
    const rects = [], texts = [];
    const ctx = new Proxy({ fillRect: (x, y, w, h) => rects.push({ x, w, fill: ctx._fill }), fillText: (t) => texts.push(t) },
      { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { if (k === 'fillStyle') t._fill = v; return true; } });
    const attrs = { 'data-wp-weave': 'bar', 'data-wp-char': 'Aldenmar' };
    const cv = { clientWidth: 260, clientHeight: 12, width: 0, height: 0, getContext: () => ctx, closest: () => null,
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
    const win = { WpWeave: W, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => '', fontFamily: 'monospace' }),
      document: { querySelectorAll: () => [cv], documentElement: {}, body: {} } };
    // eslint-disable-next-line no-new-func
    new Function('window', readSource(path.join(MIMIC, 'weaveDraw.js')))(win);
    const now = Date.now();
    win.WpWeaveDraw._onState({ character: 'Aldenmar', active: true, source: 'zeal',
      core: { last2H: now - 300, lastFist: null, interval2H: IV, haste: 1.7, fistInterval: 2600 / 1.7, marginMs: 150 } });
    await new Promise(r => setTimeout(r, 80));
    expect(rects.length).toBeGreaterThan(3);
    expect(rects.some(r => Math.abs(r.x - (Math.round(260 * 0.2) - 1.5)) < 0.01 && r.w === 3)).toBe(true);   // the "now" mark
    expect(texts).toEqual([]);
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
    const cv = { clientWidth: 400, clientHeight: 400, width: 0, height: 0, getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; }, getContext: () => ctx };
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
    expect(draw).toContain('if (any) schedule();');
    expect(draw).toMatch(/if \(root\.requestAnimationFrame\) raf = root\.requestAnimationFrame\(frame\);\s*backup = setTimeout\(frame, 50\);/);
    expect(meHtml).toContain('#weavecv{display:none;position:absolute;pointer-events:none;');
  });
});

// 2026-11-09, the guild lead: "need the weaving to work" — the ring's lane sat grey through a fight whose log shows 20 crush and
// 6 punch rounds (the engine's own words), so the break was between the engine and the paint. Three fixes, each run here.
describe('the lane paints when frames stop, follows the fighting character, and says why it is idle', () => {
  function harness({ raf = true, char = 'Aldenmar' } = {}) {
    const calls = [], texts = [];
    const ctx = new Proxy({ arc: (x, y, r, a, b) => calls.push({ r, a, b }), fillText: (t) => texts.push(String(t)) },
      { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
    const attrs = { 'data-wp-weave': 'arc', 'data-wp-arc': '172 56 124', 'data-wp-char': char };
    const cv = { clientWidth: 400, clientHeight: 400, width: 0, height: 0, getAttribute: (k) => attrs[k] || null, setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; }, getContext: () => ctx };
    const win = { WpWeave: W, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => '', fontFamily: 'monospace' }),
      document: { querySelectorAll: () => [cv], documentElement: {}, body: {} } };
    if (raf) win.requestAnimationFrame = () => 1;   // frames that never come: a hidden / occluded window
    // eslint-disable-next-line no-new-func
    new Function('window', readSource(path.join(MIMIC, 'weaveDraw.js')))(win);
    return { win, calls, texts };
  }
  const live = (character, now) => ({ character, active: true, source: 'zeal',
    core: { last2H: now - 300, lastFist: null, interval2H: IV, haste: 1.7, fistInterval: 2600 / 1.7, marginMs: 150 } });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  it('a timer paints within 50 ms when animation frames never fire', async () => {
    const h = harness({ raf: true });
    h.win.WpWeaveDraw._onState(live('Aldenmar', Date.now()));
    expect(h.calls.length).toBe(0);
    await wait(80);
    expect(h.calls.length).toBeGreaterThan(1);   // the track plus at least one coloured window
  });
  it('a lane named for one character draws another character that IS fighting when its own is not', async () => {
    const h = harness({ char: 'Aldenmar' });
    h.win.WpWeaveDraw._onState({ character: 'Aldenmar', active: false, source: 'zeal', core: {}, diag: { seen: 0, matched: 0 } });
    h.win.WpWeaveDraw._onState(live('Brackwyn', Date.now()));
    await wait(80);
    expect(h.calls.length).toBeGreaterThan(1);
  });
  it('idle on the ring: "needs Zeal", or the swing word it did not know; nothing at plain rest', async () => {
    let h = harness();
    h.win.WpWeaveDraw._onState({ character: 'Aldenmar', active: false, source: 'needs-zeal', core: {} });
    await wait(80);
    expect(h.texts).toContain('weave: needs Zeal');
    h = harness();
    h.win.WpWeaveDraw._onState({ character: 'Aldenmar', active: false, source: 'zeal', core: {}, diag: { seen: 4, matched: 0, lastVerb: 'bludgeon' } });
    await wait(80);
    expect(h.texts.some(t => /swings say "bludgeon"/.test(t))).toBe(true);
    h = harness();
    h.win.WpWeaveDraw._onState({ character: 'Aldenmar', active: false, source: 'zeal', core: {}, diag: { seen: 0, matched: 0 } });
    await wait(80);
    expect(h.texts.filter(t => /^weave:/.test(t))).toEqual([]);
  });
  it('the HUD and the Timers canvas windows are not throttled in the background', () => {
    const main = stripJs(readSource(path.join(MIMIC, 'main.js')));
    expect(main).toContain("webPreferences: _wpPrefs('Me', { backgroundThrottling: false }),");
    expect(main).toContain("_wpPrefs('Timers canvas', { nodeIntegrationInSubFrames: true, backgroundThrottling: false })");
  });
});

// The HUD ring itself, run from me.html's own render code (the pattern of me-hud-mana-end.test.js).
describe('the HUD ring: the lane takes the mana / endurance arc', () => {
  const block = meScriptRaw.slice(meScriptRaw.indexOf('  // ── helpers'), meScriptRaw.indexOf('  var bodyEl'));
  // eslint-disable-next-line no-new-func
  // setIdle stands in for layoutWeave reading the lane canvas's data-wp-idle (2026-11-09: off while not fighting).
  const R = new Function('var window = { innerWidth: 1114, innerHeight: 713 };\n' + block
    + '\nreturn { renderHud, hudParts, HUD_DEFAULTS, weaveOn, setIdle: function (v) { _weaveIdle = v; } };')();
  const lane = { set idle(v) { R.setIdle(v); } };
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
  it('not fighting (the lane canvas marked idle), the monk gets the endurance arc back; fighting, the lane has it', () => {
    reset();
    lane.idle = true;
    expect(arc(R.renderHud(monk), 'orange')).toBe(true);
    lane.idle = false;
    expect(arc(R.renderHud(monk), 'orange')).toBe(false);
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

// 2026-11-09, the guild lead's own chat window: "[11:53:53] crush a potameid wildling for 256" — Zeal's timestamp in front and the
// SHORT form of a melee line (no "You", no "points of damage"), and the lane stayed "waiting for a fight". Both forms, stamped or
// not, must drive the lane.
describe('timestamped and short-form melee lines', () => {
  const pipeObj = (text) => ({ type: 0, character: 'Aldenmar', data: JSON.stringify({ type: 265, text }) });
  function fight(lines) {
    let t = 1_000_000; const sent = [];
    const hub = W.createWeaveHub({ send: (s) => sent.push(s), now: () => t });
    hub.setEnabled(true);
    hub.setConfig('Aldenmar', { character: 'Aldenmar', cls: 'monk', level: 60, twoHDelay: 30 });
    for (const [dt, text] of lines) { t += dt; hub.note(pipeObj(text)); hub.tick(); }
    return sent[sent.length - 1];
  }
  it('parses each form', () => {
    for (const line of ['[11:53:53] crush a potameid wildling for 256', 'crush a potameid wildling for 256',
      '[11:53:53] You crush a potameid wildling for 256 points of damage.', '[11:53 AM] You crush a potameid wildling for 256 points of damage.']) {
      expect(W.maybeSwing(line), line).toBe(true);
      expect(W.parseSwing(line), line).toMatchObject({ verb: 'crush', target: 'a potameid wildling' });
    }
    expect(W.parseSwing('[11:53:56] miss')).toBeNull();                       // names no weapon
    expect(W.maybeSwing('Brackwyn crushes a potameid wildling for 99 points of damage.')).toBe(false);   // another player's line
  });
  it('a stamped short-form fight lights the lane and counts a weave', () => {
    const last = fight([
      [0, '[11:53:52] crush a potameid wildling for 256'],
      [2600, '[11:53:55] crush a potameid wildling for 186'],
      [900, '[11:53:56] Loading bandolier set [fists]'],
      [150, '[11:53:56] punch a potameid wildling for 40'],
      [250, '[11:53:56] Loading bandolier set [2h]'],
    ]);
    expect(last.active).toBe(true);
    expect(last.diag.matched).toBeGreaterThanOrEqual(3);
    expect(last.tally.presses).toBe(1);
  });
  it('a short-form line with a word the lists do not know is not a swing and is not offered as one', () => {
    const last = fight([[0, '[11:53:52] heal a potameid wildling for 256'], [100, 'crush a potameid wildling for 10']]);
    expect(last.diag.lastVerb).toBeNull();
  });
});

// 2026-11-09, the guild lead: "when i'm not attacking can we turn off the weaving timer?" Idle with nothing to report paints
// nothing; the canvas is marked so the ring gets its endurance arc back and the Timers canvas drops the piece's plate.
describe('the weave timer is off when you are not fighting', () => {
  function harness() {
    const calls = [];
    const ctx = new Proxy({ arc: () => calls.push('arc'), fillRect: () => calls.push('rect'), fillText: (t) => calls.push('text:' + t) },
      { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
    const attrs = { 'data-wp-weave': 'highway', 'data-wp-char': 'Aldenmar' };
    const panelClasses = new Set();
    const panel = { classList: { toggle: (k, on) => (on ? panelClasses.add(k) : panelClasses.delete(k)) } };
    const cv = { clientWidth: 300, clientHeight: 60, width: 0, height: 0, getContext: () => ctx, closest: () => panel,
      getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; } };
    const win = { WpWeave: W, devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => '', fontFamily: 'monospace' }),
      document: { querySelectorAll: () => [cv], documentElement: {}, body: {} } };
    // eslint-disable-next-line no-new-func
    new Function('window', readSource(path.join(MIMIC, 'weaveDraw.js')))(win);
    return { win, calls, attrs, panelClasses };
  }
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  it('idle at rest: nothing painted, the canvas marked idle, the panel marked wvidle; a fight clears both', async () => {
    const h = harness();
    h.win.WpWeaveDraw._onState({ character: 'Aldenmar', active: false, source: 'zeal', core: {}, diag: { seen: 3, matched: 3 } });
    await wait(80);
    expect(h.calls).toEqual([]);
    expect(h.attrs['data-wp-idle']).toBe('1');
    expect(h.panelClasses.has('wvidle')).toBe(true);
    const now = Date.now();
    h.win.WpWeaveDraw._onState({ character: 'Aldenmar', active: true, source: 'zeal',
      core: { last2H: now - 300, lastFist: null, interval2H: IV, haste: 1.7, fistInterval: 2600 / 1.7, marginMs: 150 } });
    await wait(80);
    expect(h.calls.length).toBeGreaterThan(0);
    expect(h.attrs['data-wp-idle']).toBeUndefined();
    expect(h.panelClasses.has('wvidle')).toBe(false);
  });
  it('idle WITH a reason still shows it', async () => {
    const h = harness();
    h.win.WpWeaveDraw._onState({ character: 'Aldenmar', active: false, source: 'needs-zeal', core: {} });
    await wait(80);
    expect(h.calls.some(c => /needs Zeal/.test(c))).toBe(true);
    expect(h.attrs['data-wp-idle']).toBeUndefined();
  });
  it('the ring hands the arc back while idle, and the Timers canvas treats an idle piece like an empty one', () => {
    const me = stripJs(readSource(path.join(MIMIC, 'me.html')));
    expect(me).toContain('var lane = weaveOn(s) && !_weaveIdle;');
    expect(me).toContain("_weaveIdle = cv.getAttribute('data-wp-idle') === '1';");
    const cvs = readSource(path.join(MIMIC, 'canvas.html'));
    expect(cvs).toContain('.panel.part.back.wvidle > .pbody{background:transparent;box-shadow:none}');
    expect(cvs).toContain("!(c.contains('fitempty') || c.contains('wvidle'))");
    expect(cvs).toContain("empty: e.root.classList.contains('fitempty') || e.root.classList.contains('wvidle')");
  });
});

// 2026-11-09, the guild lead: "capture the successful weave attempts as well. i can add a /pipe weave into the mix as well after
// the attempts happen. Don't count ones when inventory is full of the user has something in their hand where the weave doesn't
// happen". Zeal's own texts (Zeal/bandolier.cpp): failures print on CHANNEL_BANDOLIER_FAILURE (1012).
describe('weave attempts: captured, marked by /pipe weave, voided by a failed swap', () => {
  function rig() {
    let t = 1_000_000; const recs = [], sent = [];
    const hub = W.createWeaveHub({ send: (s) => sent.push(s), now: () => t, onAttempt: (r) => recs.push(r) });
    hub.setEnabled(true);
    hub.setConfig('Aldenmar', { character: 'Aldenmar', cls: 'monk', level: 60, twoHDelay: 30 });
    const chat = (text, colour = 265) => hub.note({ type: 0, character: 'Aldenmar', data: JSON.stringify({ type: colour, text }) });
    const pipe = (text) => hub.note({ type: 4, character: 'Aldenmar', data: JSON.stringify({ text }) });
    const step = (ms) => { t += ms; hub.tick(); };
    const last = () => sent[sent.length - 1];
    return { chat, pipe, step, recs, last, now: () => t };
  }
  const TWO = 'You crush a gnoll for 200 points of damage.', FIST = 'You punch a gnoll for 40 points of damage.';
  // Three 2H rounds to be in a fight, then one weave pressed early in the window.
  function warm(r) { r.chat(TWO); r.step(1760); r.chat(TWO); r.step(1760); r.chat(TWO); r.step(100); }

  it('a landed weave is captured with its timing: the press, the window it fell in, the fist and the 2H', () => {
    const r = rig(); warm(r);
    r.chat('Loading bandolier set [fists]', 1011); r.step(150);
    r.chat(FIST); r.step(250);
    r.chat('Loading bandolier set [2h]', 1011); r.pipe('weave'); r.step(1200);
    r.chat(TWO); r.step(50);
    expect(r.recs).toHaveLength(1);
    const a = r.recs[0];
    expect(a).toMatchObject({ outcome: 'landed', character: 'Aldenmar', loads: 2, marked: true, reason: null });
    expect(a.phase).toBe('go');
    expect(a.fist - a.press).toBe(150);
    expect(a.actual2H).toBe(a.at);
    expect(a.open).toBeLessThanOrEqual(a.press);
    expect(a.close).toBeGreaterThan(a.press);
    expect(r.last().tally).toMatchObject({ presses: 1, landed: 1, voided: 0 });
  });
  it('/pipe weave alone is a press (the macro\'s marker, even with bandolier lines filtered out)', () => {
    const r = rig(); warm(r);
    r.pipe('weave'); r.step(150); r.chat(FIST); r.step(1400); r.chat(TWO);
    expect(r.recs.map(x => [x.outcome, x.marked, x.loads])).toEqual([['landed', true, 0]]);
    expect(r.pipe('something else')).toBe(false);
  });
  it('a full inventory or a busy cursor voids the press: not in the tally, recorded as void with the reason', () => {
    for (const [text, colour] of [
      ['No empty inventory slot to unequip [Ton Po\'s Mystical Pouch], canceling set load.', 1012],
      ['You cannot swap items when holding something in the cursor!', 1012],
      ['[11:53:53] You cannot swap items when holding something in the cursor!', 0],   // the words alone, timestamped, another colour
      ['You are too busy to equip bandolier set!', 1012],
    ]) {
      const r = rig(); warm(r);
      r.chat('Loading bandolier set [fists]', 1011); r.step(60);
      r.chat(text, colour); r.step(2000); r.chat(TWO); r.step(50);
      expect(r.last().tally, text).toMatchObject({ presses: 0, landed: 0, clips: 0, misses: 0, voided: 1 });
      expect(r.recs.map(x => x.outcome), text).toEqual(['void']);
      expect(r.recs[0].reason, text).toMatch(/inventory|cursor|busy/);
    }
  });
  it('"Already swapping" and "already equipped" are not failures of a weave', () => {
    for (const text of ['Already swapping bandolier sets, please wait', 'Bandolier set [2h] is already equipped']) {
      expect(W.isBandolierFailure(1011, text), text).toBe(false);
      const r = rig(); warm(r);
      r.chat('Loading bandolier set [fists]', 1011); r.step(100); r.chat(FIST); r.step(100);
      r.chat(text, 1011); r.step(1300); r.chat(TWO);
      expect(r.recs.map(x => x.outcome), text).toEqual(['landed']);
    }
  });
  it('Mimic appends each attempt to weave-attempts.ndjson, rotated, never throwing into the pipe', () => {
    const m = stripJs(readSource(path.join(MIMIC, 'main.js')));
    expect(m).toContain("const WEAVE_ATTEMPTS_LOG = () => path.join(app.getPath('userData'), 'weave-attempts.ndjson');");
    expect(m).toContain('const _weaveHub = createWeaveHub({ send: _weaveSend, onAttempt: _writeWeaveAttempt });');
  });
});

// 2026-11-09, the guild lead: "auto-detect epic fists instead of the checkbox - and most of us don't wear them anymore since we have
// access to Dark handwraps", then "Our weaving timer is being unreliable while the timer from the basketweaver is very reliable".
// The server (EQMacEmu Client::GetHandToHandDelay) gives bare fists delay 16 only for Celestial Fists (10652) in the Hands slot;
// Dark Hand Wraps (28949) are armour. The swap's round trip is 400 ms (Basketweaver's measured "Weave Off Delay"), not 150.
describe('the weave reads the character: epic from the Hands slot, race from /who; the swap time is 400 ms', () => {
  const agentSrc = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
  const block = sliceBlock(agentSrc, 'function _meGear(character, who) {', '\n  };\n}');
  const gearOf = (invs, who) => new Function('stats', block + '\nreturn _meGear;')({ characterInventories: invs })('aldenmar', who);
  it('_meGear: the Hands item, the weapons and /who race, from the inventory the agent already parsed', () => {
    const invs = { Aldenmar: { worn: { Hands: { id: 28949, name: 'Dark Hand Wraps' } },
      weapons: { primary: { id: 26599, name: 'Caen\'s Bo Staff of Fury' } }, _updatedAt: '2026-11-09T17:48:11Z' } };
    expect(gearOf(invs, { race: 'Iksar' })).toEqual({ hands_id: 28949, primary: { id: 26599, name: 'Caen\'s Bo Staff of Fury' },
      secondary: null, race: 'Iksar', inventory_at: '2026-11-09T17:48:11Z' });
    expect(gearOf({}, null)).toEqual({ hands_id: null, primary: null, secondary: null, race: null, inventory_at: null });
    expect(agentSrc).toContain('    gear: _meGear(active, who),');
  });
  it('the HUD sends epic only for Celestial Fists in Hands, race from /who, and the new swap-time key', () => {
    const me = stripJs(readSource(path.join(MIMIC, 'me.html')));
    expect(me).toContain("race: g.race ? (/iksar/i.test(g.race) ? 'iksar' : 'human') : p.weaveRace, epic: g.hands_id === 10652,");
    expect(me).toContain('marginMs: p.weaveSwapMs,');
    expect(me).toContain("weaveSwapMs: 400,");
    expect(me).not.toMatch(/weaveEpic|weaveMargin/);
  });
  it('the engine: 400 ms by default; Dark Hand Wraps leave a level 65 human at bare fists (2.0 s), the epic gives 1.6 s', () => {
    expect(W.DEFAULT_CFG.marginMs).toBe(400);
    expect(W.cleanCfg({ marginMs: 900 }).marginMs).toBe(900);
    expect(W.handToHandDelay({ cls: 'monk', level: 65, race: 'human', epic: false })).toBe(20);
    expect(W.handToHandDelay({ cls: 'monk', level: 65, race: 'iksar', epic: false })).toBe(21);
    expect(W.handToHandDelay({ cls: 'monk', level: 65, race: 'human', epic: true })).toBe(16);
  });
});
