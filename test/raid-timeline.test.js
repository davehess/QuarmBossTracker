// test/raid-timeline.test.js — web/lib/raidTimeline.ts: the night's boss deaths in order, the gap between each,
// and the Plane of Tactics "kill both within N minutes" windows (the Decorins 6 min, Tallon + Vallon 20 min).
//
// Boss names and ids are the catalog's; there are no people in here. Times are built from one fixed instant, so
// a gap in the test is a number a person can check by eye.
//
// Run: npx vitest run test/raid-timeline.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PAIR_RULES, buildTimeline, fmtClock, shortName } from '../web/lib/raidTimeline.ts';
import { ROOT, stripJs } from './_source-slice.js';

const BERIK = 214056, GRUNHORK = 214057, TALLON = 214026, VALLON = 214316, OVERSEER = 214092;
const T0 = Date.UTC(2026, 9, 21, 1, 0, 0);   // 21:00:00 ET on the 20th
const at = (min, sec = 0) => T0 + (min * 60 + sec) * 1000;
const k = (npcId, name, t) => ({ npcId, name, atMs: t });
const decorin = (id, t) => k(id, id === BERIK ? 'Decorin Berik' : 'Decorin Grunhork', t);
const tz = (id, t) => k(id, id === TALLON ? 'Tallon Zek' : 'Vallon Zek', t);
const pairOf = (tl, label) => tl.pairs.find(p => p.rule.label === label);

describe('deaths and gaps', () => {
  it('orders deaths by time whatever order they arrive in, and writes the gap from the one before', () => {
    const tl = buildTimeline([
      k(BERIK, 'Decorin Berik', at(10, 30)),
      k(OVERSEER, 'The Diaku Overseer', at(0)),
      k(GRUNHORK, 'Decorin Grunhork', at(18, 52)),
    ], at(30));
    expect(tl.deaths.map(d => d.npcId)).toEqual([OVERSEER, BERIK, GRUNHORK]);
    expect(tl.deaths.map(d => d.gapSec)).toEqual([null, 630, 502]);   // 10:30 and 8:22
    expect(fmtClock(502)).toBe('8:22');
  });

  it('measures the clock since the last death, and has none on an empty night', () => {
    const tl = buildTimeline([k(OVERSEER, 'The Diaku Overseer', at(0)), k(BERIK, 'Decorin Berik', at(4, 10))], at(7, 0));
    expect(tl.last.npcId).toBe(BERIK);
    expect(tl.sinceLastSec).toBe(170);
    const empty = buildTimeline([], at(7));
    expect(empty.deaths).toEqual([]);
    expect(empty.last).toBeNull();
    expect(empty.sinceLastSec).toBeNull();
    expect(empty.pairs.every(p => p.status === 'waiting')).toBe(true);
  });

  it('leaves out a death that is after "now", which is how the replay playhead un-kills a boss', () => {
    const kills = [k(OVERSEER, 'The Diaku Overseer', at(0)), decorin(BERIK, at(5))];
    expect(buildTimeline(kills, at(4, 59)).deaths).toHaveLength(1);
    expect(buildTimeline(kills, at(5)).deaths).toHaveLength(2);
  });

  it('drops a kill with no usable time instead of poisoning every gap', () => {
    const tl = buildTimeline([k(OVERSEER, 'x', NaN), k(BERIK, 'Decorin Berik', at(1))], at(2));
    expect(tl.deaths).toHaveLength(1);
    expect(tl.deaths[0].gapSec).toBeNull();
  });
});

describe('the Decorin 6-minute window', () => {
  it('has the rule as the raid guide states it', () => {
    expect(PAIR_RULES.map(r => [r.ids, r.windowSec])).toEqual([[[BERIK, GRUNHORK], 360], [[TALLON, VALLON], 1200]]);
  });

  it('waits until either dies', () => {
    expect(pairOf(buildTimeline([k(OVERSEER, 'The Diaku Overseer', at(0))], at(1)), 'Decorins').status).toBe('waiting');
  });

  it('opens on the first death with the second due 6 minutes later', () => {
    const p = pairOf(buildTimeline([decorin(BERIK, at(4, 10))], at(7, 0)), 'Decorins');
    expect(p.status).toBe('open');
    expect(p.first.npcId).toBe(BERIK);
    expect(p.secondId).toBe(GRUNHORK);
    expect(p.secondName).toBe('Decorin Grunhork');
    expect(p.dueAtMs).toBe(at(10, 10));
    expect(p.secondsLeft).toBe(190);
  });

  it('opens either way round: Grunhork first makes Berik the one due', () => {
    const p = pairOf(buildTimeline([decorin(GRUNHORK, at(1))], at(2)), 'Decorins');
    expect([p.status, p.secondId]).toEqual(['open', BERIK]);
  });

  it('is made when the second dies inside the window, and reports how long it took', () => {
    const tl = buildTimeline([decorin(BERIK, at(4, 10)), decorin(GRUNHORK, at(8, 50))], at(9));
    const p = pairOf(tl, 'Decorins');
    expect(p.status).toBe('made');
    expect(p.tookSec).toBe(280);   // 4:40
  });

  it('is made at exactly six minutes and missed at six minutes and one second', () => {
    expect(pairOf(buildTimeline([decorin(BERIK, at(0)), decorin(GRUNHORK, at(6, 0))], at(7)), 'Decorins').status).toBe('made');
    const late = pairOf(buildTimeline([decorin(BERIK, at(0)), decorin(GRUNHORK, at(6, 1))], at(7)), 'Decorins');
    expect(late.status).toBe('missed');
    expect(late.tookSec).toBe(361);
    expect(late.second.npcId).toBe(GRUNHORK);
  });

  it('is missed when the window runs out with the second still up, and is open right up to the last second', () => {
    const kills = [decorin(BERIK, at(0))];
    const open = pairOf(buildTimeline(kills, at(5, 59)), 'Decorins');
    expect([open.status, open.secondsLeft]).toEqual(['open', 1]);
    const gone = pairOf(buildTimeline(kills, at(6, 0)), 'Decorins');
    expect(gone.status).toBe('missed');
    expect(gone.second).toBeNull();
    expect(gone.tookSec).toBeNull();
  });

  it('follows the replay playhead: scrubbed back to before the second death it is open again', () => {
    const kills = [decorin(BERIK, at(0)), decorin(GRUNHORK, at(4))];
    expect(pairOf(buildTimeline(kills, at(5)), 'Decorins').status).toBe('made');
    expect(pairOf(buildTimeline(kills, at(3)), 'Decorins').status).toBe('open');
  });
});

describe('the Tallon + Vallon 20-minute window', () => {
  it('opens with a 20-minute clock', () => {
    const p = pairOf(buildTimeline([tz(TALLON, at(0))], at(5)), 'Tallon + Vallon');
    expect(p.status).toBe('open');
    expect(p.secondId).toBe(VALLON);
    expect(p.secondsLeft).toBe(900);
  });

  it('is made at 19:59 and missed past 20:00, independent of the Decorin rule', () => {
    const base = [decorin(BERIK, at(0)), decorin(GRUNHORK, at(5))];
    const made = buildTimeline([...base, tz(TALLON, at(10)), tz(VALLON, at(29, 59))], at(31));
    expect(pairOf(made, 'Tallon + Vallon').status).toBe('made');
    expect(pairOf(made, 'Tallon + Vallon').tookSec).toBe(1199);
    expect(pairOf(made, 'Decorins').status).toBe('made');
    const missed = buildTimeline([...base, tz(TALLON, at(10)), tz(VALLON, at(30, 1))], at(31));
    expect(pairOf(missed, 'Tallon + Vallon').status).toBe('missed');
    expect(pairOf(missed, 'Decorins').status).toBe('made');
  });

  it('starts a fresh attempt when a boss dies again long after the last pair', () => {
    const tl = buildTimeline([tz(TALLON, at(0)), tz(VALLON, at(2)), tz(TALLON, at(90))], at(91));
    const p = pairOf(tl, 'Tallon + Vallon');
    expect([p.status, p.first.npcId, p.secondId]).toEqual(['open', TALLON, VALLON]);
  });

  it('calls a partner that died well past the window a late kill, not a new attempt', () => {
    const p = pairOf(buildTimeline([tz(TALLON, at(0)), tz(VALLON, at(45))], at(46)), 'Tallon + Vallon');
    expect([p.status, p.tookSec]).toEqual(['missed', 2700]);
  });
});

describe('formatting', () => {
  it('writes clocks the way a raider reads them', () => {
    expect([fmtClock(7), fmtClock(190), fmtClock(3725), fmtClock(-4)]).toEqual(['0:07', '3:10', '1:02:05', '0:00']);
    expect(shortName('Decorin Grunhork')).toBe('Grunhork');
    expect(shortName('Tallon Zek')).toBe('Tallon Zek');
  });
});

describe('the timeline strip sits on both spectator pages (B, picked 2026-10-21)', () => {
  const src = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  it('the live page and the replay page both carry it; the session review embed does not', () => {
    expect(src('web/app/spectator/page.tsx')).toMatch(/<RaidTimeline \/>/);
    expect(src('web/app/spectator/replay/page.tsx')).toMatch(/<ReplayBoard timeline \/>/);
    expect(src('web/app/spectator/replay/ReplayBoard.tsx')).toMatch(/\{timeline && <RaidTimeline kills=\{killList\} nowMs=\{uiT\} \/>\}/);
    expect(src('web/components/RaidTimeline.tsx')).not.toMatch(/function Cards|timelineVariant/);
  });

  it('puts the route behind the members-only gate', () => {
    const route = src('web/app/api/spectator/timeline/route.ts');
    expect(route.indexOf('auth.getUser()')).toBeGreaterThan(-1);
    expect(route.indexOf('auth.getUser()')).toBeLessThan(route.indexOf('supabaseAdmin()'));
    expect(route).toMatch(/fail\(401/);
  });
});
