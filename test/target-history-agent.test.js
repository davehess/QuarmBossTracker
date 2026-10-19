// test/target-history-agent.test.js — the agent's list of the last 50 mobs this PC targeted (Target Info's
// pager and Recent tab; Decision Desk 2026-10-19, docs/DESIGN-history-and-quest-nav.md §1).
//
// The guild lead, 2026-10-04: "Target Info would be good to have a history (and filter for if we killed it or
// not) forward/back button based on spawn id on it so we could scroll back through these mobs and see the drops."
//
// The real agent runs (a bare require() touches no disk): frames go through _tgtHistNoteFromState exactly as the
// Zeal-state endpoint feeds them, the file round trip uses a temp path, and the payload is the one the route
// serialises. Names are invented. Where a test reads source text it strips comments first.
//
// Run: npx vitest run test/target-history-agent.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, stripJs, AGENT_INDEX } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const src = stripJs(readSource(AGENT_INDEX));

const T0 = 1_790_000_000_000;
const ZONE = 54;
// A Zeal frame as the endpoint stores it: the target's name, spawn id, bar and type (1 = NPC, 2 = NPC corpse, 3 = player corpse).
const frame = (over = {}) => ({ zone: ZONE, target_name: 'a gnoll warlord', target_id: 101, target_hp_pct: 100, target_type: 1, ...over });
const feed = (frames, ch = 'Aldenmar', t = T0, step = 1000) => {
  let prev = {};
  frames.forEach((f, i) => { agent._tgtHistNoteFromState(ch, prev, f, t + i * step); prev = f; });
};
const list = () => agent._tgtHistForTest();

beforeEach(() => agent._tgtHistResetForTest());

describe('what gets recorded', () => {
  it('a mob: zone, spawn id, name, first and last seen, lowest HP', () => {
    feed([frame(), frame({ target_hp_pct: 62 }), frame({ target_hp_pct: 80 })]);
    expect(list()).toHaveLength(1);
    const e = list()[0];
    expect(e).toMatchObject({ zone: ZONE, id: 101, name: 'a gnoll warlord', firstMs: T0, minHp: 62, hp: 80, killedMs: null });
    expect(e.lastMs).toBeGreaterThanOrEqual(T0);
  });

  it('two mobs of one name are two entries when their spawn ids differ', () => {
    feed([frame({ target_id: 101 }), frame({ target_id: 102 }), frame({ target_id: 101 })]);
    expect(list().map(e => e.id).sort()).toEqual([101, 102]);
  });

  it('players and corpses of players are never recorded', () => {
    feed([frame({ target_name: 'Brackwyn', target_id: 7, target_type: 0 }),
          frame({ target_name: "Brackwyn's corpse", target_id: 7, target_type: 3 }),
          frame({ target_name: 'Corvale', target_type: undefined })]);   // no type, one word: it may be a raider
    expect(list()).toHaveLength(0);
    // ...but an untyped frame whose name has a space is a mob ("a gnoll"), the way an older Zeal sends it.
    feed([frame({ target_type: undefined })]);
    expect(list()).toHaveLength(1);
  });

  it('with no spawn id (an older Zeal) a same-name sighting joins only a recent one', () => {
    feed([frame({ target_id: 0 }), frame({ target_id: 0, target_hp_pct: 70 })]);
    expect(list()).toHaveLength(1);
    expect(list()[0].id).toBe(null);
    feed([frame({ target_id: 0 })], 'Aldenmar', T0 + 10 * 60_000);   // ten minutes on: another gnoll
    expect(list()).toHaveLength(2);
  });

  it('newest first, capped at 50 and nothing kept past 24 hours', () => {
    const frames = [];
    for (let i = 0; i < 60; i++) frames.push(frame({ target_name: 'a rat ' + i, target_id: 1000 + i }));
    feed(frames, 'Aldenmar', T0, 1000);
    expect(list()).toHaveLength(agent.TGT_HIST_MAX);
    expect(agent.TGT_HIST_MAX).toBe(50);
    expect(list()[0].name).toBe('a rat 59');
    expect(list()[49].name).toBe('a rat 10');
    agent._trimTargetHistory(T0 + 60_000 + agent.TGT_HIST_KEEP_MS + 1);
    expect(list()).toHaveLength(0);
  });

  it('stays small: fifty entries are about a dozen kilobytes', () => {
    const frames = [];
    for (let i = 0; i < 50; i++) frames.push(frame({ target_name: 'a decaying skeleton ' + i, target_id: 2000 + i, target_hp_pct: 40 }));
    feed(frames);
    expect(Buffer.byteLength(JSON.stringify(list()))).toBeLessThan(12 * 1024);
  });
});

describe('killed or not', () => {
  it('its corpse took its place with the SAME spawn id', () => {
    feed([frame(), frame({ target_hp_pct: 5 }), frame({ target_name: "a gnoll warlord's corpse", target_type: 2, target_hp_pct: 0 })]);
    expect(list()).toHaveLength(1);
    expect(list()[0]).toMatchObject({ killedHow: 'corpse-id' });
    expect(list()[0].killedMs).toBeGreaterThan(0);
  });

  it('a same-name corpse under another id still counts, and says which reading it was', () => {
    feed([frame(), frame({ target_name: "a gnoll warlord's corpse", target_id: 555, target_type: 2 })]);
    expect(list()[0].killedHow).toBe('corpse-name');
  });

  it('a corpse with a backtick or curly apostrophe is read the same', () => {
    feed([frame(), frame({ target_name: 'a gnoll warlord`s corpse', target_type: 2 })]);
    expect(list()[0].killedMs).toBeGreaterThan(0);
    agent._tgtHistResetForTest();
    feed([frame(), frame({ target_name: 'a gnoll warlord’s corpse2', target_type: 2 })]);
    expect(list()[0].killedMs).toBeGreaterThan(0);
  });

  it('its bar went from above zero to 0 under the same name', () => {
    feed([frame({ target_hp_pct: 3 }), frame({ target_hp_pct: 0 })]);
    expect(list()[0].killedHow).toBe('hp0');
  });

  it('first sighted already at 0% is not a kill the agent saw, however many frames it stays there', () => {
    feed([frame({ target_hp_pct: 0 })]);
    expect(list()[0].killedMs).toBe(null);
    feed([frame({ target_hp_pct: 0 }), frame({ target_hp_pct: 0 })], 'Aldenmar', T0 + 1000);
    expect(list()[0].killedMs).toBe(null);
  });

  it('with no spawn ids at all, the bar reading 0 still has to be the same name', () => {
    feed([frame({ target_name: 'a wolf', target_id: 0, target_hp_pct: 50 }), frame({ target_id: 0, target_hp_pct: 0 })]);
    expect(list().every(e => e.killedMs === null)).toBe(true);
  });

  it('a different mob at 0% right after another one is not the first one dying', () => {
    feed([frame({ target_name: 'a wolf', target_id: 9, target_hp_pct: 50 }), frame({ target_hp_pct: 0 })]);
    expect(list().find(e => e.id === 101).killedMs).toBe(null);
    expect(list().find(e => e.id === 9).killedMs).toBe(null);
  });

  it('a "slain" line settles one the target window never showed', () => {
    feed([frame({ target_hp_pct: 40 }), frame({ target_name: 'Hitya', target_type: 0 })]);   // looked away at 40%
    expect(list()[0].killedMs).toBe(null);
    agent._tgtHistNoteSlain('a gnoll warlord', T0 + 10_000);
    expect(list()[0].killedHow).toBe('slain');
    // a name it never saw changes nothing, nor does one seen too long ago
    agent._tgtHistResetForTest();
    feed([frame()]);
    agent._tgtHistNoteSlain('a different gnoll', T0 + 5000);
    agent._tgtHistNoteSlain('a gnoll warlord', T0 + 10 * 60_000);
    expect(list()[0].killedMs).toBe(null);
  });

  it('a mob left alive stays "not killed" and keeps its lowest bar', () => {
    feed([frame(), frame({ target_hp_pct: 30 }), frame({ target_name: 'a wolf', target_id: 9 })]);
    const gnoll = list().find(e => e.id === 101);
    expect(gnoll.killedMs).toBe(null);
    expect(gnoll.minHp).toBe(30);
  });

  it('a killed spawn is not revived by the bar still reading 0, and a full bar on that id is a new mob', () => {
    feed([frame({ target_hp_pct: 4 }), frame({ target_hp_pct: 0 }), frame({ target_hp_pct: 0 })]);
    expect(list()).toHaveLength(1);
    feed([frame({ target_hp_pct: 100 })], 'Aldenmar', T0 + 60_000);
    expect(list()).toHaveLength(2);
  });
});

describe('across a restart', () => {
  let file;
  beforeEach(() => { file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tgthist-')), 'logsync.targets.json'); });
  afterEach(() => { try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch { /* temp */ } });

  it('written with .tmp + rename and read back within 24 hours, marked restored', () => {
    feed([frame({ target_hp_pct: 12 })]);
    agent._saveTargetHistory(file);
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    agent._tgtHistResetForTest();
    agent._loadTargetHistory(file, T0 + 3600_000);
    expect(list()).toHaveLength(1);
    expect(list()[0]).toMatchObject({ name: 'a gnoll warlord', minHp: 12, restored: true });
  });

  it('entries older than 24 hours do not come back', () => {
    feed([frame()]);
    agent._saveTargetHistory(file);
    agent._tgtHistResetForTest();
    agent._loadTargetHistory(file, T0 + agent.TGT_HIST_KEEP_MS + 60_000);
    expect(list()).toHaveLength(0);
  });

  it('a restored entry is never joined to a live frame: spawn ids reset with every zone visit', () => {
    feed([frame()]);
    agent._saveTargetHistory(file);
    agent._tgtHistResetForTest();
    agent._loadTargetHistory(file, T0 + 60_000);
    feed([frame()], 'Aldenmar', T0 + 120_000);
    expect(list()).toHaveLength(2);
    expect(list().filter(e => e.restored)).toHaveLength(1);
  });

  it('a missing or unreadable file starts empty rather than throwing', () => {
    expect(() => agent._loadTargetHistory(file)).not.toThrow();
    fs.writeFileSync(file, '{not json');
    expect(() => agent._loadTargetHistory(file)).not.toThrow();
    expect(list()).toHaveLength(0);
  });
});

describe('the route the overlay reads', () => {
  it('answers the list, then only "unchanged" for the revision it already has', () => {
    feed([frame()]);
    const first = agent._targetHistoryPayload('');
    expect(first.targets).toHaveLength(1);
    expect(first.targets[0].ch).toBeUndefined();            // the character stays on this machine
    const again = agent._targetHistoryPayload(first.rev);
    expect(again.unchanged).toBe(true);
    expect(again.targets).toBeUndefined();
    feed([frame({ target_name: 'a wolf', target_id: 9 })], 'Aldenmar', T0 + 5000);
    expect(agent._targetHistoryPayload(first.rev).targets).toHaveLength(2);
  });

  it('asked for an entry it also carries that mob in the live card\'s shape: HP at its lowest, 0 once killed', () => {
    feed([frame({ target_hp_pct: 44 }), frame({ target_name: 'a wolf', target_id: 9 })]);
    const key = list().find(e => e.id === 101).key;
    const mi = agent._targetHistoryPayload('', key).mi;
    expect(mi).toMatchObject({ target_name: 'a gnoll warlord', target_hp_pct: 44, target_hist_key: key, target_buffs: [], target_casting: [] });
    expect(mi.past).toMatchObject({ key, minHp: 44, killedMs: null });
    agent._tgtHistNoteSlain('a gnoll warlord', T0 + 4000);
    const dead = agent._targetHistoryPayload('', key).mi;
    expect(dead.target_hp_pct).toBe(0);
    expect(dead.past.killedHow).toBe('slain');
  });

  it('carries the catalog row for that mob in its zone, so the Loot tab has its drops', () => {
    feed([frame()]);
    const e = list()[0];
    const row = { id: 54001, name: 'a gnoll warlord', loot: [{ name: 'Rusty Axe', pct: 12 }] };
    agent._mobInfoByNameForTest().set(agent._mobInfoCacheKey(e.name, e.zone), { at: Date.now(), mob: row });
    const mi = agent._targetHistoryPayload('', e.key).mi;
    expect(mi.mob).toBe(row);
    expect(mi.loading).toBe(false);
  });

  it('an unknown key answers mi: null (it aged out), not a stale card', () => {
    feed([frame()]);
    expect(agent._targetHistoryPayload('', 'no-such-key').mi).toBe(null);
  });

  it('is wired: the Zeal-state frame feeds it, the slain line settles it, the route serves it, a restart restores it', () => {
    expect(src).toMatch(/_tgtHistNoteFromState\(character, prevState, _zealState\[character\]/);
    expect(src).toMatch(/_tgtHistNoteSlain\(_mapDead/);
    expect(src).toMatch(/req\.url === '\/api\/target-history'/);
    expect(src).toMatch(/_startTargetHistoryPersistence\(\);/);
    expect(src).toMatch(/target_hist_key: _tgtLiveKey\(st\)/);
  });
});
