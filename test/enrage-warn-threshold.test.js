// test/enrage-warn-threshold.test.js — the enrage warning is spoken AHEAD of each mob's OWN enrage %.
//
// The guild lead, 2026-11-07: "enrage calls have all been late lately". The non-boss warning sat at 9%, which is the
// server's own enrage point (EQEmu StartEnrageValue), so it spoke after the ENRAGED line. Now a boss is warned 3 points
// ahead of the mob's enrage % and any other mob 2 points ahead. That % is, best first: the median of what this PC has seen
// the mob enrage at (once it has two), the catalog's `enrage_pct` (ability 2 param0), then the default 9.
//
// The REAL agent is driven (require): _tickEnrageWarn over a stubbed Zeal target and mob-info cache, and
// _enrageNoteStart for the learned value. Disk writes are stubbed.
//
// Run: npx vitest run test/enrage-warn-threshold.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
const ZONE = 12;
const MOB = 'a gnoll warlord';

function catalog(name, { boss = false, enragePct } = {}) {
  agent._mobInfoByNameForTest().set(agent._mobInfoCacheKey(name, ZONE), {
    at: Date.now(), mob: { name, specials: ['Enrage'], raid_target: boss, ...(enragePct !== undefined ? { enrage_pct: enragePct } : {}) },
  });
}
function target(name, hp, id = 7) {
  agent._setZealStateForTest(ME, { target_name: name, target_hp_pct: hp, target_id: id, zone: ZONE, updatedAt: Date.now() });
}
const tick = (name, hp, id) => { target(name, hp, id); agent._tickEnrageWarn(Date.now()); };
const fires = () => agent._activeOverlays.filter(o => o.scope === 'enrage');
// Tell the agent the mob enraged while the character had it at `hp`.
function sawEnrage(hp, name = MOB) {
  target(name, hp);
  return agent._enrageNoteStart(ME, name, Date.now());
}

beforeEach(() => {
  vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
  vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
  agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
  agent._mobInfoByNameForTest().clear();
  agent._enrageObserved.clear();
  agent._enrageWarned.clear();
  agent._activeOverlays.length = 0;
  for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k];
  agent._enrageMuteSession.all = false;
  agent._enrageMuteSession.mobs.clear();
});
afterEach(() => {
  agent._setZealStateForTest(ME, null);
  agent._mobInfoByNameForTest().clear();
  agent._enrageObserved.clear();
  vi.restoreAllMocks();
});

describe('the default enrage point (10%, EQMacEmu StartEnrageValue)', () => {
  it('a boss is warned at 13%, not at 14%', () => {
    catalog(MOB, { boss: true });
    tick(MOB, 40); tick(MOB, 14);
    expect(fires()).toHaveLength(0);
    tick(MOB, 13);
    expect(fires()).toHaveLength(1);
    expect(fires()[0].tts).toBe('Enrage soon');
  });
  it('any other mob is warned at 12%, not at 13%', () => {
    catalog(MOB, { boss: false });
    tick(MOB, 40); tick(MOB, 13);
    expect(fires()).toHaveLength(0);
    tick(MOB, 12);
    expect(fires()).toHaveLength(1);
    expect(fires()[0].tts).toBe('a gnoll warlord enraging');
  });
  it('a catalog row from a bot that predates enrage_pct behaves as the default', () => {
    catalog(MOB, { boss: true });   // no enrage_pct key at all
    expect(agent._enrageWarnPct(MOB, ZONE, true)).toBe(13);
    expect(agent._enrageWarnPct(MOB, ZONE, false)).toBe(12);
  });
});

describe("the catalog's own enrage %", () => {
  it('enrage_pct 15: a boss is warned at 18, any other mob at 17', () => {
    catalog(MOB, { boss: true, enragePct: 15 });
    tick(MOB, 40); tick(MOB, 19);
    expect(fires()).toHaveLength(0);
    tick(MOB, 18);
    expect(fires()).toHaveLength(1);

    agent._activeOverlays.length = 0; agent._enrageWarned.clear();
    catalog(MOB, { boss: false, enragePct: 15 });
    tick(MOB, 40); tick(MOB, 18);
    expect(fires()).toHaveLength(0);
    tick(MOB, 17);
    expect(fires()).toHaveLength(1);
  });
  it('a mob whose point is above 20 still arms and re-arms (the re-arm line follows the warning point)', () => {
    catalog(MOB, { boss: true, enragePct: 25 });   // warns at 28, re-arms above 36
    tick(MOB, 30); expect(fires()).toHaveLength(0);
    tick(MOB, 28); expect(fires()).toHaveLength(1);
    tick(MOB, 33, 7);   // still the same mob: below the re-arm line, so no second call
    tick(MOB, 28, 7); expect(fires()).toHaveLength(1);
    tick(MOB, 40, 7); tick(MOB, 28, 7);   // a respawn under the old id
    expect(fires()).toHaveLength(2);
  });
});

describe('what this PC has seen the mob enrage at', () => {
  it('one sighting is not enough; two make the median the enrage point', () => {
    catalog(MOB, { boss: true, enragePct: 15 });
    expect(sawEnrage(10)).toBe(10);
    expect(agent._enrageAtPct(MOB, ZONE)).toBe(15);        // still the catalog
    sawEnrage(10);
    expect(agent._enrageAtPct(MOB, ZONE)).toBe(10);        // observed beats the catalog
    tick(MOB, 40); tick(MOB, 14);
    expect(fires()).toHaveLength(0);
    tick(MOB, 13);                                          // 10 + 3
    expect(fires()).toHaveLength(1);
  });
  it('keeps the last five and uses their median', () => {
    for (const hp of [30, 12, 9, 9, 10, 11]) sawEnrage(hp);   // the 30 falls off the end
    expect(agent._enrageObserved.get(MOB)).toEqual([12, 9, 9, 10, 11]);
    expect(agent._enrageAtPct(MOB, ZONE)).toBe(10);
  });
  it('is learned only from the active character\'s own fresh target of that name', () => {
    target('a different mob', 9);
    expect(agent._enrageNoteStart(ME, MOB, Date.now())).toBe(null);   // another mob
    agent._setZealStateForTest(ME, { target_name: MOB, target_hp_pct: 9, zone: ZONE, updatedAt: Date.now() - 10_000 });
    expect(agent._enrageNoteStart(ME, MOB, Date.now())).toBe(null);   // stale gauge
    target(MOB, 0);
    expect(agent._enrageNoteStart(ME, MOB, Date.now())).toBe(null);   // dead
    expect(agent._enrageObserved.size).toBe(0);
  });
  it('is written to enrage_observed.json beside the other agent files', () => {
    const writes = [];
    fs.writeFileSync.mockImplementation((p, body) => { writes.push({ p: String(p), body: String(body) }); });
    sawEnrage(9);
    expect(writes[0].p).toMatch(/enrage_observed\.json\.tmp$/);
    expect(JSON.parse(writes[0].body).mobs[MOB]).toEqual([9]);
  });
});

describe('the gates stay as they were', () => {
  it('a muted mob says nothing at its new point', () => {
    catalog(MOB, { boss: true });
    agent._enrageMuteSession.mobs.add(MOB);
    tick(MOB, 12); tick(MOB, 9);
    expect(fires()).toHaveLength(0);
  });
  it('a mob that cannot enrage says nothing', () => {
    agent._mobInfoByNameForTest().set(agent._mobInfoCacheKey(MOB, ZONE), { at: Date.now(), mob: { name: MOB, specials: [], raid_target: true, enrage_pct: 15 } });
    tick(MOB, 18); tick(MOB, 9);
    expect(fires()).toHaveLength(0);
  });
  it('once per spawn', () => {
    catalog(MOB, { boss: true });
    tick(MOB, 12); tick(MOB, 11); tick(MOB, 5);
    expect(fires()).toHaveLength(1);
  });
});
