// test/afb-digest.test.js — the weekly anonymous-feedback count line.
//
// The guild lead, 2026-10-08: anonymous feedback (AFB) is never acted on automatically, "but it should be
// consistently reviewed" -> "go ahead with the weekly count post". One line a week, counts only. Runs
// utils/afbDigest.js and the bot's real _afbWeeklyDigest against stubs.
//
// Run: npx vitest run test/afb-digest.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const afb = require('../utils/afbDigest.js');

const at = (iso) => new Date(iso);

describe('the ISO week key', () => {
  it.each([
    ['2026-10-05T13:00:00Z', '2026-W41'],   // Monday
    ['2026-10-11T23:59:00Z', '2026-W41'],   // Sunday, same week
    ['2026-10-12T00:00:00Z', '2026-W42'],
    ['2026-01-01T12:00:00Z', '2026-W01'],   // Thursday: week 1 of 2026
    ['2027-01-01T12:00:00Z', '2026-W53'],   // Friday: still 2026's last week
    ['2024-12-30T12:00:00Z', '2025-W01'],   // Monday: already 2025's week 1
  ])('%s -> %s', (iso, want) => {
    expect(afb.weekKey(at(iso))).toBe(want);
  });
});

describe('when the post is due', () => {
  it('Monday from 13:00 UTC, once per week', () => {
    expect(afb.isDue(at('2026-10-05T12:59:00Z'), null)).toBe(false);   // Monday, too early
    expect(afb.isDue(at('2026-10-05T13:00:00Z'), null)).toBe(true);
    expect(afb.isDue(at('2026-10-05T23:30:00Z'), '2026-W40')).toBe(true);
    expect(afb.isDue(at('2026-10-05T14:00:00Z'), '2026-W41')).toBe(false);   // already latched
  });
  it('never on another day', () => {
    for (const d of ['06', '07', '08', '09', '10', '11']) {
      expect(afb.isDue(at(`2026-10-${d}T15:00:00Z`), null)).toBe(false);
    }
  });
});

describe('the counts', () => {
  const now = at('2026-10-05T14:00:00Z');
  const rows = [
    { status: 'new', created_at: '2026-10-04T10:00:00Z' },    // this week + waiting
    { status: 'new', created_at: '2026-09-01T10:00:00Z' },    // old but still waiting
    { status: 'read', created_at: '2026-10-03T10:00:00Z' },   // this week, read
    { status: 'done', created_at: '2026-08-01T10:00:00Z' },
    { status: 'new', submitted_at: '2026-10-02T10:00:00Z' },  // the other column name
  ];
  it('new this week = filed in the last 7 days; waiting = status new', () => {
    expect(afb.countRows(rows, now)).toEqual({ fresh: 3, waiting: 3 });
  });
  it('a 7-day edge: filed exactly a week ago counts, a second earlier does not', () => {
    expect(afb.countRows([{ status: 'read', created_at: '2026-09-28T14:00:00Z' }], now).fresh).toBe(1);
    expect(afb.countRows([{ status: 'read', created_at: '2026-09-28T13:59:59Z' }], now).fresh).toBe(0);
  });
  it('anything that is not a list is zero', () => {
    expect(afb.countRows(null, now)).toEqual({ fresh: 0, waiting: 0 });
    expect(afb.countRows([null, {}], now)).toEqual({ fresh: 0, waiting: 0 });
  });
});

describe('the line', () => {
  it('is counts and the admin link, and nothing else', () => {
    expect(afb.digestLine({ fresh: 3, waiting: 5 })).toBe('🕵️ Anonymous feedback (AFB): 3 new this week, 5 waiting for review → https://wolfpack.quest/admin/feedback/anonymous');
    expect(afb.digestLine({ fresh: 0, waiting: 2 })).toContain('0 new this week, 2 waiting');
  });
  it('is nothing at all when both counts are zero', () => {
    expect(afb.digestLine({ fresh: 0, waiting: 0 })).toBeNull();
    expect(afb.digestLine({})).toBeNull();
    expect(afb.digestLine()).toBeNull();
  });
});

// The bot job on the real function.
describe('_afbWeeklyDigest', () => {
  const src = readSource(BOT_INDEX);
  const block = sliceBlock(src, 'async function _afbWeeklyDigest(', '\n}\n');

  function rig({ now, latched = null, anon = [], kvDown = false, noTable = false, upsertFails = false, noThread = false } = {}) {
    const log = { sent: [], upserts: [], warns: [] };
    const supabase = {
      isEnabled: () => true,
      guildId: () => 'wolfpack',
      select: async (table) => {
        if (table === 'bot_kv') return kvDown ? null : (latched ? [{ value: { week: latched } }] : []);
        if (table === 'anon_feedback') return noTable ? null : anon;
        return null;
      },
      upsert: async (table, rows) => { log.upserts.push(rows[0]); return upsertFails ? null : rows; },
    };
    const client = { channels: { fetch: async () => (noThread ? null : { send: async (o) => { log.sent.push(o); } }) } };
    const FakeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } };
    const run = new Function('require', 'process', 'console', 'MessageFlags', 'Date', block + '\nreturn _afbWeeklyDigest;')(
      (m) => ({ './utils/supabase': supabase, './utils/afbDigest': afb })[m],
      { env: { FEEDBACK_THREAD_ID: 't1' } }, { warn: (...a) => log.warns.push(a.join(' ')) }, { SuppressEmbeds: 4 }, FakeDate);
    return { run: () => run(client), log };
  }
  const MON = '2026-10-05T14:00:00Z';
  const rows = [{ status: 'new', created_at: '2026-10-04T10:00:00Z', message: 'SECRET TEXT' }, { status: 'read', created_at: '2026-08-01T10:00:00Z' }];

  it('posts the one line, counts only, and latches the week', async () => {
    const { run, log } = rig({ now: MON, anon: rows });
    expect(await run()).toBe('posted');
    expect(log.sent).toHaveLength(1);
    expect(log.sent[0].content).toBe('🕵️ Anonymous feedback (AFB): 1 new this week, 1 waiting for review → https://wolfpack.quest/admin/feedback/anonymous');
    expect(log.sent[0].content).not.toContain('SECRET');
    expect(log.sent[0].flags).toBe(4);
    expect(log.upserts[0]).toMatchObject({ key: 'afb_weekly_digest', value: { week: '2026-W41' } });
  });

  it('does not post twice in a week, even across a redeploy (the latch is read, not remembered)', async () => {
    const { run, log } = rig({ now: MON, anon: rows, latched: '2026-W41' });
    expect(await run()).toBe('not-due');
    expect(log.sent).toHaveLength(0);
  });

  it('is quiet on any other day, and before 13:00 UTC on Monday', async () => {
    expect(await rig({ now: '2026-10-06T14:00:00Z', anon: rows }).run()).toBe('not-due');
    expect(await rig({ now: '2026-10-05T12:00:00Z', anon: rows }).run()).toBe('not-due');
  });

  it('posts nothing when both counts are zero, but latches the week', async () => {
    const { run, log } = rig({ now: MON, anon: [] });
    expect(await run()).toBe('quiet');
    expect(log.sent).toHaveLength(0);
    expect(log.upserts).toHaveLength(1);
  });

  it('a missing table skips with a short warning and does not latch, so a later hour can still post', async () => {
    const { run, log } = rig({ now: MON, noTable: true });
    expect(await run()).toBe('no-table');
    expect(log.sent).toHaveLength(0);
    expect(log.upserts).toHaveLength(0);
    expect(log.warns).toHaveLength(1);
  });

  it('fails closed: an unreadable latch, a latch that will not write, or no thread posts nothing', async () => {
    const down = rig({ now: MON, anon: rows, kvDown: true });
    expect(await down.run()).toBe('unknown');
    expect(down.log.sent).toHaveLength(0);
    const stuck = rig({ now: MON, anon: rows, upsertFails: true });
    expect(await stuck.run()).toBe('latch-failed');
    expect(stuck.log.sent).toHaveLength(0);
    const lost = rig({ now: MON, anon: rows, noThread: true });
    expect(await lost.run()).toBe('no-thread');
    expect(lost.log.upserts).toHaveLength(0);
  });

  it('the bot schedules it hourly', () => {
    expect(stripJs(src)).toMatch(/setInterval\(\(\) => _afbWeeklyDigest\(readyClient\)[^\n]*60 \* 60_000\)/);
  });
});
