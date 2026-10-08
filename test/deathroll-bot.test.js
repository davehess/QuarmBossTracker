// test/deathroll-bot.test.js — the bot records each deathroll once and posts it once.
//
// The guild lead, 2026-09-23: track deathrolls "for fun", and "post it to
// Wlfpck-general". Runs the REAL _checkDeathrollsNow from index.js against a
// stubbed database and Discord client, so a comment cannot satisfy it.
//
// Run: npx vitest run test/deathroll-bot.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';
import * as deathroll from '../utils/deathroll.js';

const src = readSource(path.join(ROOT, 'index.js'));
const block = sliceBlock(src, 'const _DEATHROLL_SETTLE_MS', '\n// POST /api/agent/rolls');

// The first captured game's shape, names invented. [roller, range top, result, sec]
const GAME = [
  ['Brackwyn', 32000, 11194, 0], ['Aldenmar', 11194, 6897, 8], ['Brackwyn', 6897, 5243, 14],
  ['Aldenmar', 5243, 1617, 18], ['Brackwyn', 1617, 736, 22], ['Aldenmar', 736, 527, 25],
  ['Brackwyn', 527, 93, 27], ['Aldenmar', 93, 12, 31], ['Brackwyn', 12, 6, 32],
  ['Aldenmar', 6, 1, 35], ['Brackwyn', 1, 0, 36],
];
function rowsFor(t0, uploader = 'u1', skewSec = 0) {
  return GAME.map(([name, to, value, sec]) => {
    const at = new Date(t0 + (sec + skewSec) * 1000).toISOString();
    return { uploaded_by_discord_id: uploader, roll_from: 0, roll_to: to, started_at: at, rolls: [{ name, value, at }] };
  });
}

function harness({ rolls, recorded = [], env = { DEATHROLL_CHANNEL_ID: 'chan-1' } }) {
  const upserts = [], sent = [];
  const supabase = {
    isEnabled: () => true,
    selectAllPaged: async (table) => (table === 'roll_sets' ? rolls : []),
    select: async (table) => (table === 'fun_events' ? recorded : []),
    upsert: async (table, rows) => { if (table === 'fun_events') upserts.push(...rows); },
  };
  const client = { channels: { fetch: async (id) => ({ send: async (m) => { sent.push({ id, ...m }); } }) } };
  const req = (m) => (m === './utils/supabase' ? supabase : m === './utils/deathroll' ? deathroll : null);
  // eslint-disable-next-line no-new-func
  const check = new Function('require', 'client', 'process', block + '\nreturn _checkDeathrollsNow;')(req, client, { env });
  return { check, upserts, sent };
}

describe('a finished game', () => {
  it('is recorded once, with who lost, who won, and the starting range', async () => {
    const h = harness({ rolls: rowsFor(Date.now() - 60_000) });
    await h.check();
    expect(h.upserts).toHaveLength(1);
    const e = h.upserts[0];
    expect(e.event_type).toBe('deathroll');
    expect(e.caster).toBe('Brackwyn');
    expect(e.target).toBe('Aldenmar');
    expect(e.reagent_qty).toBe(11);
    expect(e.detail.start).toBe(32000);
  });

  it('is posted once, to the configured channel, pinging nobody', async () => {
    const h = harness({ rolls: rowsFor(Date.now() - 60_000) });
    await h.check();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].id).toBe('chan-1');
    expect(h.sent[0].content).toBe('☠️ **Brackwyn** lost a deathroll to **Aldenmar** — 32,000 → 0 in 11 rolls');
    expect(h.sent[0].allowedMentions).toEqual({ parse: [] });
  });

  it('seen by seven uploaders with skewed clocks, it is still ONE record and ONE post', async () => {
    const t0 = Date.now() - 60_000;
    const rolls = [0, 2, 4, 9, 1, 7, 3].flatMap((skew, i) => rowsFor(t0, 'u' + i, skew));
    const h = harness({ rolls });
    await h.check();
    expect(h.upserts).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
  });
});

describe('never twice', () => {
  it('a game already in fun_events (clock a few seconds off) is skipped', async () => {
    const t0 = Date.now() - 60_000;
    const recorded = [{ caster: 'Brackwyn', event_ts: new Date(t0 + 36_000 + 7_000).toISOString() }];
    const h = harness({ rolls: rowsFor(t0), recorded });
    await h.check();
    expect(h.upserts).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
  });
});

describe('when it records but does not post', () => {
  it('no DEATHROLL_CHANNEL_ID configured', async () => {
    const h = harness({ rolls: rowsFor(Date.now() - 60_000), env: {} });
    await h.check();
    expect(h.upserts).toHaveLength(1);
    expect(h.sent).toHaveLength(0);
  });

  it('a game found more than ten minutes after it ended (e.g. after a restart)', async () => {
    const h = harness({ rolls: rowsFor(Date.now() - 15 * 60_000) });
    await h.check();
    expect(h.upserts).toHaveLength(1);
    expect(h.sent).toHaveLength(0);
  });
});

describe('the ingest wiring', () => {
  const handler = stripJs(sliceBlock(src, 'async function _handleAgentRolls(req, res) {', '\n// POST /api/agent/looted'));
  it('schedules a check only when a 0 arrives on a 0-N roll', () => {
    expect(handler).toMatch(/rows\.some\(r => r\.roll_from === 0 && r\.rolls\.some\(x => x\.value === 0\)\)/);
    expect(handler).toContain('_scheduleDeathrollCheck()');
  });
});
