// test/error-log-sweep.test.js — the Railway error-log sweep (the guild lead, 2026-10-25: "let's start watching
// these errors and resolving them cleanly instead"). Railway marks every stderr line (console.error AND
// console.warn) as an error, so an EXPECTED condition has to go to stdout, once; a real failure must stay loud.
// Each block below drives the shipped code (source-sliced out of index.js, or the real utils module):
//   · an upload for a mob with no bosses_local row logs once an hour per name, on stdout;
//   · chat_messages / character_aas batches never carry one conflict key twice (Postgres 21000 / 23505);
//   · the Raid-Helper sync asks only the v4 listing (which carries the signups), never the dead v2 detail route;
//   · unmodeled DS formulas, the quarm-notes partial read and the zeal-tag duplicates stop being errors.
//
// Run: npx vitest run test/error-log-sweep.test.js

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const clean = stripJs(src);
const require = createRequire(import.meta.url);

afterEach(() => { vi.restoreAllMocks(); });

describe('unmatched-mob drop (expected, not an error)', () => {
  const block = sliceBlock(
    src,
    'const _unmatchedMobLogged = new Map();',
    '  return true;\n}',
  );
  const { _logUnmatchedMob } = evalBlock(block, ['_logUnmatchedMob']);

  it('logs a name once an hour, on stdout, and again after the hour', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t0 = 1_000_000;
    expect(_logUnmatchedMob('a gnoll pup', t0)).toBe(true);
    expect(_logUnmatchedMob('a gnoll pup', t0 + 1000)).toBe(false);
    expect(_logUnmatchedMob('a gnoll pup', t0 + 3_599_000)).toBe(false);
    expect(_logUnmatchedMob('a different mob', t0 + 1000)).toBe(true);
    expect(_logUnmatchedMob('a gnoll pup', t0 + 3_600_000)).toBe(true);
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[0][0]).toContain('no bosses_local match for "a gnoll pup"');
    expect(warn).not.toHaveBeenCalled();
  });

  it('the call site uses it instead of console.warn', () => {
    expect(clean).toMatch(/_logUnmatchedMob\(bossInternalId\)/);
    expect(clean).not.toMatch(/console\.warn\(`\[agent\] no bosses_local match/);
  });
});

describe('batches with a repeated conflict key', () => {
  const END = 'async function _handleAgentChat(';
  const block = sliceBlock(src, 'function _dedupeRows(rows, keyOf) {', END).slice(0, -END.length);
  const { _dedupeRows, _chatRowKey } = evalBlock(block, ['_dedupeRows', '_chatRowKey']);
  const ROW = (over = {}) => ({
    guild_id: 'wolfpack', ts: '2026-10-25T01:00:05.000Z', channel: 'guild', speaker: 'Aldenmar', text: 'pull in 2', ...over,
  });

  it('chat_messages: collapses rows sharing (guild_id, ts, channel, speaker, text); the last copy wins', () => {
    const out = _dedupeRows([ROW({ who: 'a' }), ROW({ text: 'other' }), ROW({ who: 'b' })], _chatRowKey);
    expect(out).toHaveLength(2);
    expect(out.find(r => r.text === 'pull in 2').who).toBe('b');
  });

  it('chat_messages: the same instant in two spellings is one key; any differing column is a different row', () => {
    expect(_dedupeRows([ROW(), ROW({ ts: '2026-10-25T01:00:05Z' })], _chatRowKey)).toHaveLength(1);
    for (const over of [{ ts: '2026-10-25T01:00:06.000Z' }, { channel: 'raid' }, { speaker: 'Brackwyn' }, { guild_id: 'g2' }]) {
      expect(_dedupeRows([ROW(), ROW(over)], _chatRowKey)).toHaveLength(2);
    }
  });

  it('chat_messages: an unparseable ts falls back to the raw string rather than colliding every row', () => {
    expect(_dedupeRows([ROW({ ts: 'garbled' }), ROW({ ts: 'other garble' })], _chatRowKey)).toHaveLength(2);
  });

  it('both chat_messages upserts and the AA write go through it', () => {
    expect(clean).toMatch(/supabase\.upsert\('chat_messages', _dedupeRows\(supabaseChatRows, _chatRowKey\), 'guild_id,ts,channel,speaker,text'\)/);
    expect(clean).toMatch(/supabase\.upsert\('chat_messages', _dedupeRows\(rows, _chatRowKey\), 'guild_id,ts,channel,speaker,text'\)/);
    expect(clean).toMatch(/aaRows = _dedupeRows\(aaRows, r => r\.aa_index\)/);
  });

  it('character_aas is upserted on its primary key, not plain-inserted', () => {
    expect(clean).toMatch(/supabase\.upsert\('character_aas', aaRows, 'guild_id,character,aa_index'\)/);
    expect(clean).not.toMatch(/supabase\.insert\('character_aas'/);
  });
});

// Raid-Helper retired the v2 per-event route ("Endpoint GET /api/v2/events/<id> not found" for an event that v4
// serves, checked 2026-10-25). The sync never needed it: the v4 listing carries every event's signups.
describe('Raid-Helper: no requests to the dead v2 detail route', () => {
  const rhPath = path.join(ROOT, 'utils', 'raidhelperApi.js');
  function load(supabase) {
    const mod = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', readSource(rhPath))((p) => (p === './supabase' ? supabase : require(path.join(ROOT, 'utils', p))), mod, mod.exports);
    return mod.exports;
  }
  const fakeSupabase = () => ({ calls: [], isEnabled: () => true, async upsert(table, rows) { this.calls.push({ table, rows }); return rows; } });

  it('a sync asks only the v4 server listing and still stores every event and signup from it', async () => {
    vi.stubEnv('RH_API_KEY', 'k');
    vi.stubEnv('RH_SERVER_ID', 's');
    const urls = [];
    vi.stubGlobal('fetch', async (url) => {
      const u = String(url); urls.push(u);
      if (/\/api\/v4\/servers\//.test(u)) {
        const page = /page=(\d+)/.exec(u)?.[1];
        const postedEvents = page === '1' ? [
          { id: 'ev0', title: 'Raid 0', startTime: 1_760_000_000, signUps: [{ userId: 'u0', name: 'Aldenmar', className: 'Warrior' }] },
          { id: 'ev1', title: 'Raid 1', startTime: 1_760_003_600, signUps: [{ userId: 'u1', name: 'Brackwyn', className: 'Cleric' }] },
        ] : [];
        return { ok: true, status: 200, text: async () => JSON.stringify({ postedEvents, pages: 1 }) };
      }
      return { ok: false, status: 404, text: async () => '{"title":"Endpoint not found"}' };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sb = fakeSupabase();
    const res = await load(sb).syncRecent({ pageLimit: 1 });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every(u => /\/api\/v4\/servers\//.test(u))).toBe(true);   // no per-event request at all
    expect(warn).not.toHaveBeenCalled();
    expect(res).toEqual({ events: 2, signups: 2 });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('getEvent, kept for one-off lookups, asks the v4 event route', async () => {
    const urls = [];
    vi.stubGlobal('fetch', async (url) => { urls.push(String(url)); return { ok: true, status: 200, text: async () => '{"id":"42"}' }; });
    expect(await load(fakeSupabase()).getEvent('42')).toEqual({ id: '42' });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/api\/v4\/events\/42$/);
    vi.unstubAllGlobals();
  });
});

describe('diagnostics that were never errors', () => {
  it('unmodeled DS formulas: logged on stdout, with the once-per-process Set at module level', () => {
    expect(clean).not.toMatch(/console\.warn\(`\[spell-catalog\] DS formula/);
    expect(clean).toMatch(/console\.log\(`\[spell-catalog\] DS formula \$\{formula\} not modeled/);
    // Declared once, flush-left (module level) — inside the catalog handler it was rebuilt every request.
    expect(clean.match(/_dsFormulaWarned = new Set\(\)/g)).toHaveLength(1);
    expect(clean).toMatch(/^const _dsFormulaWarned = new Set\(\)/m);
  });

  it('quarm-notes: a partial read is info; "every message empty" (intent off) stays a warning', () => {
    expect(clean).toMatch(/console\.log\(`\[quarm-notes\] \$\{st\.content_missing\} of \$\{st\.fetched\} message\(s\) read had no content/);
    expect(clean).toMatch(/console\.warn\(`\[quarm-notes\] all \$\{st\.fetched\} message\(s\) read had no content/);
  });

  it('zeal tag duplicates are ignored through the RPC path, not a plain insert', () => {
    expect(clean).toMatch(/supabase\.insertIgnoreDuplicates\('zeal_tag_observations', out\)/);
    expect(clean).not.toMatch(/supabase\.insert\('zeal_tag_observations'/);
  });
});
