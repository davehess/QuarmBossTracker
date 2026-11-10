// test/gold-splits.test.js — gold splits for scripted PoP events (DECISIONS §555): the splits maths, the attempt grouping
// and the pages' markers. Fixtures use invented ids and no names.
// Run: npx vitest run test/gold-splits.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { computeSplits, fmtClock, momentsShown } from '../web/lib/goldSplits.ts';
import { buildAttempts, ATTEMPT_GAP_MS } from '../web/lib/eventAttempts.ts';
import { splitsDefFor, genericDef, EXPLICIT_SLUGS } from '../web/lib/eventSplitsDefs.ts';
import { EVENTS } from '../web/lib/popEvents.ts';
import { metaForPath } from '../web/lib/pageMeta.ts';
import { stripJs } from './_source-slice.js';

const att = (...rel) => ({ moments: rel.map(r => (r == null ? null : { relSec: r })) });

describe('computeSplits', () => {
  // moments: start, a, b, end.  A: 0,60,150,300  B: 0,50,170,280  C: 0,70,null,null
  const sp = computeSplits(4, [att(0, 60, 150, 300), att(0, 50, 170, 280), att(0, 70, null, null)]);
  it('gold is the best of each segment and who holds it', () => {
    expect(sp.gold).toEqual([null, 50, 90, 110]);
    expect(sp.goldAttempt).toEqual([null, 1, 0, 1]);
  });
  it('sum of best adds the golds', () => {
    expect(sp.sumOfBest).toBe(250);
    expect(sp.complete).toBe(true);
  });
  it('time save is total minus the sum of best, only for a run that ran every segment', () => {
    expect(sp.attempts.map(a => a.total)).toEqual([300, 280, null]);
    expect(sp.attempts.map(a => a.timeSave)).toEqual([50, 30, null]);
    expect(sp.bestRun).toBe(1);
  });
  it('a missing moment leaves its two segments null', () => {
    expect(sp.attempts[2].segments).toEqual([null, 70, null, null]);
  });
  it('is incomplete when a segment was never run', () => {
    const p = computeSplits(3, [att(0, 10, null)]);
    expect(p.complete).toBe(false);
    expect(p.attempts[0].timeSave).toBeNull();
  });
  it('formats clocks', () => {
    expect(fmtClock(83)).toBe('1:23');
    expect(fmtClock(3725)).toBe('1:02:05');
    expect(fmtClock(null)).toBe('—');
  });
  it('the generic def shows only the slots every attempt reached', () => {
    expect(momentsShown(true, 12, [att(0, 5, 9), att(0, 4, null)])).toBe(2);
    expect(momentsShown(false, 5, [att(0, 5)])).toBe(5);
  });
});

// Coirnav ids: guardian 216053, minis 216236 / 216245 / 216247, boss 216048.
const T0 = Date.parse('2026-11-06T22:00:00Z');
let n = 0;
const enc = (npc, startS, endS, o = {}) => ({
  id: `e${++n}`, npc_id: npc, raid_night_id: 'night1',
  started_at: new Date(T0 + startS * 1000).toISOString(),
  ended_at: endS == null ? null : new Date(T0 + endS * 1000).toISOString(),
  classification: null, is_wipe: false, ...o,
});
const coirnav = splitsDefFor('powater-coirnav');

describe('buildAttempts', () => {
  it('a full run finds the start, the minis in time order, and the end; success is the end', () => {
    const [a] = buildAttempts(coirnav, [
      enc(216053, 0, 10), enc(216247, 700, 760), enc(216236, 600, 650), enc(216245, 800, 850), enc(216048, 900, 1000),
    ]);
    expect(a.success).toBe(true);
    expect(a.moments.map(m => m.npcId)).toEqual([216053, 216236, 216247, 216245, 216048]);
    expect(a.moments.map(m => m.relSec)).toEqual([0, 640, 750, 840, 990]);
  });
  it('a gap over 30 minutes splits attempts', () => {
    const gap = ATTEMPT_GAP_MS / 1000;
    const rows = [enc(216053, 0, 10), enc(216236, 100, 120), enc(216245, 120 + gap + 60, 120 + gap + 70)];
    expect(buildAttempts(coirnav, rows)).toHaveLength(2);
    const near = [enc(216053, 0, 10), enc(216236, 100, 120), enc(216245, 120 + gap - 60, 120 + gap - 30)];
    expect(buildAttempts(coirnav, near)).toHaveLength(1);
  });
  it('a second start match begins a new attempt, and an unfinished run is not a success', () => {
    const rows = [enc(216053, 0, 10), enc(216236, 100, 120), enc(216053, 600, 610), enc(216236, 700, 720)];
    const out = buildAttempts(coirnav, rows);
    expect(out).toHaveLength(2);
    expect(out.map(a => a.success)).toEqual([false, false]);
  });
  it('runs on different raid nights are different attempts, and a wipe is flagged', () => {
    const rows = [enc(216053, 0, 10), enc(216048, 20, 30, { raid_night_id: 'night2' }), enc(216245, 40, 60, { is_wipe: true, classification: 'wipe' })];
    const out = buildAttempts(coirnav, rows);
    expect(out).toHaveLength(2);
    expect(out[0].wiped).toBe(true);
    expect(out[0].moments[3]).toBeNull();   // a wipe is not a kill
  });
  it('an engage-start run (the Arbitor) uses started_at for the pull and ended_at for the death', () => {
    const def = splitsDefFor('poeartha-mystical-arbitor');
    const [a] = buildAttempts(def, [enc(218375, 0, 120)]);
    expect(a.moments.map(m => m.relSec)).toEqual([0, 120]);
    expect(a.success).toBe(true);
  });
});

describe('the defs', () => {
  it('every explicit def names real events, start first, one end last, npc ids from the event', () => {
    expect(EXPLICIT_SLUGS).toHaveLength(5);
    for (const slug of EXPLICIT_SLUGS) {
      const e = EVENTS.find(x => x.slug === slug);
      const d = splitsDefFor(slug);
      expect(e, slug).toBeTruthy();
      expect(d.moments[0].kind).toBe('start');
      expect(d.moments.filter(m => m.kind === 'end')).toHaveLength(1);
      expect(d.moments[d.moments.length - 1].kind).toBe('end');
      const ids = new Set(e.npcs.map(x => x.npcId));
      for (const m of d.moments) if (m.npcIds !== 'any') for (const id of m.npcIds) expect(ids.has(id), `${slug} ${id}`).toBe(true);
    }
  });
  it('every event has a def; the generic one starts on an engage and groups the named mobs', () => {
    for (const e of EVENTS) expect(splitsDefFor(e.slug), e.slug).toBeTruthy();
    const ev = EVENTS.find(e => !EXPLICIT_SLUGS.includes(e.slug) && e.npcs.length > 1);
    const g = genericDef(ev);
    expect(g.generic).toBe(true);
    expect(g.moments[0]).toMatchObject({ kind: 'start', npcIds: 'any', time: 'engage' });
    expect(g.moments.slice(1).every(m => m.group === 'named')).toBe(true);
  });
});

describe('the pages', () => {
  const read = f => stripJs(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
  const one = read('../web/app/pop/events/[slug]/splits/page.tsx');
  const idx = read('../web/app/pop/events/splits/page.tsx');
  it('both carry the [beta] marker and gate on sign-in', () => {
    for (const s of [one, idx]) { expect(s).toMatch(/<NewPageTag/); expect(s).toMatch(/auth\/signin/); }
    expect(idx).toMatch(/title: '\[beta\]/);
  });
  it('the splits page links the parse and the replay, and keeps the timeline above the table', () => {
    expect(one).toMatch(/parseHref\(/);
    expect(one).toMatch(/replayHref\(/);
    expect(one.indexOf('<SplitsTimeline')).toBeGreaterThan(0);
    expect(one.indexOf('<SplitsTimeline')).toBeLessThan(one.indexOf('<table'));
  });
  it('the timeline offers the play-together link and the coming label', () => {
    const t = read('../web/app/pop/events/[slug]/splits/SplitsTimeline.tsx');
    expect(t).toMatch(/Play these attempts together/);
    expect(t).toMatch(/overlay playback: coming/);
    expect(t).toMatch(/replayBase/);
    expect(t).toMatch(/motion-reduce:transition-none/);
  });
  it('the card names the event and nothing else', () => {
    expect(metaForPath('/pop/events/powater-coirnav/splits').title).toMatch(/Coirnav/);
    expect(metaForPath('/pop/events/splits').title).toBe('[beta] Gold splits');
  });
});
