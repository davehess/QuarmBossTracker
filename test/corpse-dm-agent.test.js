// test/corpse-dm-agent.test.js — the agent side of the corpse DM.
//
// The guild lead, 2026-09-26: "when a character dies we should discord message them to send them their
// corpse coordinates and what zone they were in. we have all of that detail".
//
// Feeds real log-line shapes through the agent's REAL _corpseNoteLine with fake Zeal state, and checks
// what it queues for the bot. Names are invented.
//
// Run: npx vitest run test/corpse-dm-agent.test.js

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock } from './_source-slice.js';

const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));
const block = sliceBlock(agent, '// ── Corpse DM (the guild lead, 2026-09-26', '\n// Deliberately forgets a death')
  .replace(/\n\/\/ Deliberately forgets a death$/, '');
const parseTs = agent.match(/const TS_RX = [^\n]+/)[0] + '\n' + sliceBlock(agent, 'function parseEqTimestamp(line) {', '\n}');

function load(zeal) {
  const queued = [];
  // eslint-disable-next-line no-new-func
  const make = new Function('zeal', 'queued', `
    const _zealState = zeal;
    const AGENT_VERSION = '3.7.21';
    function _zoneName(id) { return ({ 71: 'Plane of Sky', 89: 'Ruins of Sebilis' })[id] || null; }
    function enqueueUpload(kind, payload) { queued.push({ kind, payload }); }
    ${parseTs}
    ${block}
    return { _corpseNoteLine };`);
  return { ...make(zeal, queued), queued };
}

const now = () => Date.now();
const line = (msg) => `[Sat Sep 26 01:42:10 2026] ${msg}`;
const zealAt = (loc, zone = 71, updatedAt = now()) => ({ Aldenmar: { zone, loc, updatedAt } });

describe('your own death, confirmed, is queued with where the corpse lies', () => {
  it('"You died." then the trip home: the zone and the /loc numbers from Zeal', () => {
    const { _corpseNoteLine, queued } = load(zealAt({ x: 1234.4, y: -567.6, z: 89.1 }));
    _corpseNoteLine(line('You died.'), 'Aldenmar');
    expect(queued).toHaveLength(0);                     // Not until it is confirmed.
    _corpseNoteLine(line('Returning to home point, please wait...'), 'Aldenmar');
    expect(queued).toHaveLength(1);
    expect(queued[0].kind).toBe('corpse');
    expect(queued[0].payload).toMatchObject({
      character: 'Aldenmar', zone_id: 71, zone: 'Plane of Sky', loc: { x: 1234.4, y: -567.6, z: 89.1 },
    });
    expect(new Date(queued[0].payload.died_at).getDate()).toBe(26);   // From the log line's own time.
  });

  it('"You are bleeding to death!" confirms it too, and only one is sent', () => {
    const { _corpseNoteLine, queued } = load(zealAt({ x: 1, y: 2, z: 3 }));
    _corpseNoteLine(line('You died.'), 'Aldenmar');
    _corpseNoteLine(line('You are bleeding to death!'), 'Aldenmar');
    _corpseNoteLine(line('Returning to home point, please wait...'), 'Aldenmar');
    expect(queued).toHaveLength(1);
  });

  it('the position is where Zeal had you at "You died.", not where you land afterwards', () => {
    const zeal = zealAt({ x: 1234, y: -567, z: 89 });
    const { _corpseNoteLine, queued } = load(zeal);
    _corpseNoteLine(line('You died.'), 'Aldenmar');
    zeal.Aldenmar.loc = { x: 0, y: 0, z: 0 };           // Already moved to the home point.
    zeal.Aldenmar.zone = 89;
    _corpseNoteLine(line('Returning to home point, please wait...'), 'Aldenmar');
    expect(queued[0].payload).toMatchObject({ zone: 'Plane of Sky', loc: { x: 1234, y: -567, z: 89 } });
  });
});

describe('nothing is sent that should not be', () => {
  it('a death that is never confirmed (a feign, a closed client) sends nothing', () => {
    const { _corpseNoteLine, queued } = load(zealAt({ x: 1, y: 2, z: 3 }));
    _corpseNoteLine(line('You died.'), 'Aldenmar');
    expect(queued).toHaveLength(0);
  });

  it('a confirmation with no death before it sends nothing', () => {
    const { _corpseNoteLine, queued } = load(zealAt({ x: 1, y: 2, z: 3 }));
    _corpseNoteLine(line('Returning to home point, please wait...'), 'Aldenmar');
    expect(queued).toHaveLength(0);
  });

  it('another character\'s log confirming does not send this one\'s death', () => {
    const { _corpseNoteLine, queued } = load(zealAt({ x: 1, y: 2, z: 3 }));
    _corpseNoteLine(line('You died.'), 'Aldenmar');
    _corpseNoteLine(line('Returning to home point, please wait...'), 'Brackwyn');
    expect(queued).toHaveLength(0);
  });

  it('a confirmation more than a minute after "You died." belongs to some other death: nothing', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-26T01:42:10Z'));
      const { _corpseNoteLine, queued } = load(zealAt({ x: 1, y: 2, z: 3 }));
      _corpseNoteLine(line('You died.'), 'Aldenmar');
      vi.setSystemTime(new Date('2026-09-26T01:43:20Z'));
      _corpseNoteLine(line('Returning to home point, please wait...'), 'Aldenmar');
      expect(queued).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('with Zeal silent or stale, it still sends, with no zone and no position rather than old ones', () => {
    const { _corpseNoteLine, queued } = load(zealAt({ x: 1, y: 2, z: 3 }, 71, now() - 5 * 60 * 1000));
    _corpseNoteLine(line('You died.'), 'Aldenmar');
    _corpseNoteLine(line('Returning to home point, please wait...'), 'Aldenmar');
    expect(queued[0].payload).toMatchObject({ zone: null, zone_id: null, loc: null });
  });
});
