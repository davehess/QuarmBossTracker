// test/flag-lab-hail-parity.test.js — web/lib/hailBoardView.ts is a COPY of the pure half of utils/hailBoard.js
// (the website imports nothing from outside web/). This runs both against the same fixtures and fails when
// the port drifts from the bot: the tables, buildViews' output, and ms_left.
//
// BEHAVIOUR tier: the bot's real buildViews, no mock. The names are invented tokens, not members.
//
// Run: npx vitest run test/flag-lab-hail-parity.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';
import * as port from '../web/lib/hailBoardView.ts';
import { buildHailScenario, hailCfgs, LAB_HAIL_STATES, LAB_FAKE_NAMES } from '../web/lib/flagLabModel.ts';

const require = createRequire(import.meta.url);
const bot = require('../utils/hailBoard.js');

const MIN = 60_000;
const KILL = Date.parse('2026-10-05T23:30:00Z');
const at = (min) => new Date(KILL + min * MIN).toISOString();
const plain = (m) => JSON.parse(JSON.stringify([...m.entries()]));

// The bot's withClock lives inside create(); take the real line from the source so ms_left is compared to it.
const { withClock: botWithClock } = evalBlock(
  sliceBlock(readSource(path.join(ROOT, 'utils', 'hailBoard.js')), 'const withClock =', '});'), ['withClock']);

describe('the tables match the bot', () => {
  it('HAIL_BOSSES is identical', () => {
    expect(JSON.parse(JSON.stringify(port.HAIL_BOSSES))).toEqual(JSON.parse(JSON.stringify(bot.HAIL_BOSSES)));
    expect(port.HAIL_BOSSES.length).toBeGreaterThanOrEqual(13);
  });
  it('HAIL_FLAGGERS is identical', () => {
    expect(JSON.parse(JSON.stringify(port.HAIL_FLAGGERS))).toEqual(JSON.parse(JSON.stringify(bot.HAIL_FLAGGERS)));
    expect(port.HAIL_FLAGGERS.length).toBeGreaterThanOrEqual(1);
  });
  it('the window length and slack constants match', () => {
    expect(port.WINDOW_MS).toBe(bot.WINDOW_MS);
    expect(port.FLAG_SLACK_MS).toBe(bot.FLAG_SLACK_MS);
  });
});

describe('buildViews gives the bot\'s answer', () => {
  // A hand-built fixture, independent of the lab's own scenario builder: every branch buildViews has.
  function fixture(cfg) {
    const done = cfg.done[0];
    const w = {
      id: `${cfg.id}:1`, boss_id: cfg.id, boss_name: cfg.name, npc_name: cfg.npc, zone: cfg.zone,
      opened_at: at(0), expires_at: at((cfg.minutes || 20)), uploaders: ['u1', 'u2'],
      roster: ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Tavish', 'Merrowyn', 'Ulric'],
      marks: { merrowyn: { name: 'Merrowyn', by: 'Wenlow' }, ulric: { name: 'Ulric', by: null } },
    };
    const rows = [
      { character: 'Aldenmar', flag_key: done, source: 'recital', earned_at: at(-500) },           // held, via the Seer
      { character: 'Brackwyn', flag_key: done, source: 'event', earned_at: at(-200) },             // held before the kill
      { character: 'Corvale', flag_key: done, source: 'event', earned_at: at(2) },                 // granted after
      { character: 'Rethlan', flag_key: 'hail', source: 'hail', npc: cfg.npcKeys[0], zone: null, earned_at: at(1) },
      { character: 'Nyssara', flag_key: 'hail', source: 'hail', npc: 'Some Other NPC', zone: null, earned_at: at(1) },
      { character: 'Zarrin', flag_key: cfg.checklist || 'cl_none', source: 'checklist', earned_at: at(3) },
      { character: 'Tavish', flag_key: 'hail', source: 'hail', npc: cfg.npcKeys[0], zone: cfg.zoneShort, earned_at: at(1) },
      { character: 'Ulric', flag_key: done, source: 'tick', earned_at: at(4) },                    // a tick is held proof
    ];
    const known = new Set(['nyssara', 'zarrin']);
    return { windows: [w], data: { rows, known } };
  }

  for (const cfg of [...bot.HAIL_BOSSES, ...bot.HAIL_FLAGGERS]) {
    it(`${cfg.id}: still / hailed / already / cap / flags left agree`, () => {
      const { windows, data } = fixture(cfg);
      const a = plain(bot.buildViews(windows, data, KILL));
      const b = plain(port.buildViews(windows, data, KILL));
      expect(b).toEqual(a);
      const v = b[0][1];
      // the fixture reaches every list, so this is not a comparison of two empty views
      expect(v.still.length).toBeGreaterThan(0);
      expect(v.hailed.length).toBeGreaterThan(0);
      expect(v.already_flagged.length).toBeGreaterThan(0);
    });

    it(`${cfg.id}: ms_left agrees with the bot's clock`, () => {
      const { windows, data } = fixture(cfg);
      const now = KILL + 4 * MIN;
      const bv = botWithClock(bot.buildViews(windows, data, now).get(windows[0].id), now);
      const pv = port.withClock(port.buildViews(windows, data, now).get(windows[0].id), now);
      expect(pv.ms_left).toBe(bv.ms_left);
      expect(pv).toEqual(bv);
      // and an expired window clamps to zero in both
      const late = KILL + 90 * MIN;
      expect(port.withClock(pv, late).ms_left).toBe(0);
      expect(botWithClock(bv, late).ms_left).toBe(0);
    });
  }

  it('two windows of one NPC: the earliest takes the earliest hail, as in the bot', () => {
    const cfg = bot.HAIL_BOSSES.find(b => b.id === 'tallon_zek');
    const mk = (id, open) => ({
      id, boss_id: cfg.id, boss_name: cfg.name, npc_name: cfg.npc, zone: cfg.zone,
      opened_at: at(open), expires_at: at(open + 20), roster: ['Aldenmar', 'Brackwyn'], marks: {},
    });
    const windows = [mk('late', 25), mk('early', 0)];
    const rows = [
      { character: 'Aldenmar', flag_key: 'hail', source: 'hail', npc: 'planar projection', earned_at: at(5) },
      { character: 'Aldenmar', flag_key: 'hail', source: 'hail', npc: 'planar projection', earned_at: at(30) },
      { character: 'Brackwyn', flag_key: 'hail', source: 'hail', npc: 'projection', earned_at: at(27) },
    ];
    const a = plain(bot.buildViews(windows, { rows }, KILL));
    const b = plain(port.buildViews(windows, { rows }, KILL));
    expect(b).toEqual(a);
    expect(a.find(([id]) => id === 'early')[1].hailed.map(h => h.name)).toEqual(['Aldenmar']);
  });

  it('a window for a boss the board does not carry is skipped by both', () => {
    const w = { id: 'x:1', boss_id: 'nobody', boss_name: 'X', npc_name: 'Y', zone: 'Z', opened_at: at(0), expires_at: at(20), roster: ['Aldenmar'] };
    expect(port.buildViews([w], { rows: [] }, KILL).size).toBe(0);
    expect(bot.buildViews([w], { rows: [] }, KILL).size).toBe(0);
  });
});

describe('the lab\'s own scenario builder agrees with the bot', () => {
  const roster = LAB_FAKE_NAMES.slice(0, LAB_HAIL_STATES.length).map((name, i) => ({ name, state: LAB_HAIL_STATES[i].key }));

  for (const cfg of hailCfgs()) {
    for (const minutes of [0, 3, 12, 45]) {
      it(`${cfg.id} at ${minutes} min`, () => {
        const { window, data, nowMs } = buildHailScenario(cfg, minutes, roster);
        const a = bot.buildViews([window], data, nowMs).get(window.id);
        const b = port.buildViews([window], data, nowMs).get(window.id);
        expect(b).toEqual(a);
        const stayMin = cfg.minutes || 20;
        const left = Math.max(0, (stayMin - minutes) * MIN);
        expect(port.withClock(b, nowMs).ms_left).toBe(left);
        expect(botWithClock(a, nowMs).ms_left).toBe(left);
      });
    }

    it(`${cfg.id}: each lab state lands in its list`, () => {
      const { window, data, nowMs } = buildHailScenario(cfg, 3, roster);
      const v = bot.buildViews([window], data, nowMs).get(window.id);
      const by = Object.fromEntries(roster.map(r => [r.state, r.name]));
      expect(v.already_flagged).toEqual([by.already]);
      expect(v.hailed.map(h => [h.name, h.how])).toEqual(
        [[by.hailed_flag, 'flag'], [by.hailed_seen, 'seen'], [by.hailed_marked, 'marked']]
          .sort((x, y) => (x[0].toLowerCase() < y[0].toLowerCase() ? -1 : 1)));
      expect(v.still.map(s => s.name).sort()).toEqual([by.still, by.still_prior_missing].sort());
      expect(v.still.find(s => s.name === by.still_prior_missing).prior_missing).toBe(cfg.prior.length > 0);
      expect(v.still.find(s => s.name === by.still).prior_missing).toBe(false);
    });
  }
});
