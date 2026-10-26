// test/pop-rescan-bot.test.js — the bot's half of "Sync from my logs" (the guild lead, 2026-10-26).
//
// A member asks their OWN Mimic to re-read recent logs for PoP flag lines. The website files a pop_rescan_requests
// row; the poll's `rescan` stream hands it to the member's agent (claiming it); POST /api/agent/rescan-done closes
// it. utils/popRescan.js runs for real against a small in-memory PostgREST that applies the filters the module sends,
// so a claim that is not conditional, or a finish with no owner check, fails here. The wiring in index.js is read as
// stripped source (stripJs).
//
// Run: npx vitest run test/pop-rescan-bot.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT } from './_source-slice.js';
import * as webRescan from '../web/lib/popRescan.ts';

const require = createRequire(import.meta.url);
const R = require(path.join(ROOT, 'utils', 'popRescan.js'));
const bot = readSource(path.join(ROOT, 'index.js'));

const NOW = Date.parse('2026-10-26T20:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

// In-memory table. Applies eq./in. filters, order=col.asc, limit, and PATCH; counts updates so a test can see a claim.
function fakeDb(rows) {
  const t = rows.map(r => ({ guild_id: 'wolfpack', character: null, days: 14, taken_at: null, done_at: null, found: null, ...r }));
  const parse = (qs) => {
    const filters = []; let limit = 1000; let order = null;
    for (const part of qs.split('&')) {
      const i = part.indexOf('=');
      const k = part.slice(0, i); const v = decodeURIComponent(part.slice(i + 1));
      if (k === 'select') continue;
      if (k === 'limit') { limit = Number(v); continue; }
      if (k === 'order') { order = v; continue; }
      filters.push([k, v]);
    }
    return { filters, limit, order };
  };
  const match = (row, filters) => filters.every(([k, v]) => {
    if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(row[k]));
    throw new Error('fake: unsupported filter ' + k + '=' + v);
  });
  const db = {
    rows: t, updates: 0, enabled: true, down: false,
    isEnabled: () => db.enabled,
    async select(table, qs) {
      expect(table).toBe('pop_rescan_requests');
      if (db.down) return null;
      const { filters, limit, order } = parse(qs);
      let out = t.filter(r => match(r, filters));
      if (order === 'requested_at.asc') out = out.sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at));
      return out.slice(0, limit).map(r => ({ ...r }));
    },
    async update(table, qs, patch) {
      expect(table).toBe('pop_rescan_requests');
      if (db.down) return null;
      const { filters } = parse(qs);
      const hit = t.filter(r => match(r, filters));
      hit.forEach(r => Object.assign(r, patch));
      db.updates += hit.length;
      return hit.map(r => ({ ...r }));
    },
  };
  return db;
}
const row = (over) => ({ id: 1, discord_id: 'D1', status: 'pending', requested_at: ago(2 * MIN), ...over });

describe('the rescan stream: the caller\'s own open requests, claimed as they go out', () => {
  it('hands a pending request to its owner and marks it taken in the same breath', async () => {
    const db = fakeDb([row({ id: 7, days: 14 })]);
    const out = await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['Aldenmar'], NOW);
    expect(out).toEqual({ requests: [{ id: 7, character: null, days: 14 }] });
    expect(db.rows[0].status).toBe('taken');
    expect(db.rows[0].taken_at).toBe(new Date(NOW).toISOString());
  });
  it('serves it once: the next poll, from this agent or another of the same member, gets nothing', async () => {
    const db = fakeDb([row({ id: 7 })]);
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['Aldenmar'], NOW)).requests).toHaveLength(1);
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['Aldenmar'], NOW + 20 * MIN)).requests).toEqual([]);
    expect(db.updates).toBe(1);
  });
  it('never serves another member\'s request', async () => {
    const db = fakeDb([row({ id: 7, discord_id: 'D2' })]);
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['Aldenmar'], NOW)).requests).toEqual([]);
    expect(db.rows[0].status).toBe('pending');
    expect(db.updates).toBe(0);
  });
  it('a request for one character goes only to an agent that watches that character (any case); null goes to any', async () => {
    const db = fakeDb([row({ id: 1, character: 'Brackwyn' }), row({ id: 2, character: null })]);
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['Aldenmar'], NOW)).requests.map(r => r.id)).toEqual([2]);
    expect(db.rows.find(r => r.id === 1).status).toBe('pending');
    const next = await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['brackwyn'], NOW);
    expect(next.requests).toEqual([{ id: 1, character: 'Brackwyn', days: 14 }]);
  });
  it('an agent with no watched characters is served only the "all mine" requests', async () => {
    const db = fakeDb([row({ id: 1, character: 'Brackwyn' }), row({ id: 2 })]);
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', [], NOW)).requests.map(r => r.id)).toEqual([2]);
  });
  it('a taken request is handed out again only when its agent has been silent for 30 minutes', async () => {
    const fresh = fakeDb([row({ id: 3, status: 'taken', taken_at: ago(29 * MIN) })]);
    expect((await R.rescanRequestsFor(fresh, 'wolfpack', 'D1', ['A'], NOW)).requests).toEqual([]);
    const stale = fakeDb([row({ id: 3, status: 'taken', taken_at: ago(31 * MIN) })]);
    expect((await R.rescanRequestsFor(stale, 'wolfpack', 'D1', ['A'], NOW)).requests.map(r => r.id)).toEqual([3]);
    expect(stale.rows[0].taken_at).toBe(new Date(NOW).toISOString());
  });
  it('a pending request nobody took in 24 hours is no longer served', async () => {
    const db = fakeDb([row({ id: 4, requested_at: ago(25 * 3600_000) }), row({ id: 5, requested_at: ago(23 * 3600_000) })]);
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['A'], NOW)).requests.map(r => r.id)).toEqual([5]);
  });
  it('done and failed requests are never served', async () => {
    const db = fakeDb([row({ id: 1, status: 'done' }), row({ id: 2, status: 'failed' })]);
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['A'], NOW)).requests).toEqual([]);
  });
  it('the claim is conditional: a row another agent took between our read and our update is not served', async () => {
    const db = fakeDb([row({ id: 8 })]);
    const realSelect = db.select;
    db.select = async (t, q) => { const r = await realSelect(t, q); db.rows[0].status = 'taken'; db.rows[0].taken_at = ago(1 * MIN); return r; };
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['A'], NOW)).requests).toEqual([]);
    expect(db.rows[0].taken_at).toBe(ago(1 * MIN));
  });
  it('days is capped at 60 and floored at 1; a request is never wider than the agent is told', async () => {
    const db = fakeDb([row({ id: 1, days: 400 }), row({ id: 2, days: 0 }), row({ id: 3, days: 'x' })]);
    const out = await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['A'], NOW);
    expect(out.requests.map(r => r.days)).toEqual([60, 14, 14]);
  });
  it('hands out at most three in one poll', async () => {
    const db = fakeDb([1, 2, 3, 4, 5].map(id => row({ id })));
    expect((await R.rescanRequestsFor(db, 'wolfpack', 'D1', ['A'], NOW)).requests).toHaveLength(3);
  });
  it('a database that will not answer, a disabled one and a caller with no id are an empty list, not a throw', async () => {
    const down = fakeDb([row({})]); down.down = true;
    expect(await R.rescanRequestsFor(down, 'wolfpack', 'D1', ['A'], NOW)).toEqual({ requests: [] });
    const off = fakeDb([row({})]); off.enabled = false;
    expect(await R.rescanRequestsFor(off, 'wolfpack', 'D1', ['A'], NOW)).toEqual({ requests: [] });
    expect(await R.rescanRequestsFor(fakeDb([row({})]), 'wolfpack', '', ['A'], NOW)).toEqual({ requests: [] });
  });
});

describe('POST /api/agent/rescan-done: only the owner closes a taken request', () => {
  const taken = (over = {}) => row({ id: 9, status: 'taken', taken_at: ago(5 * MIN), ...over });
  const NOW_ISO = new Date(NOW).toISOString();
  it('ok:true closes it done with the count and the time', async () => {
    const db = fakeDb([taken()]);
    const out = await R.finishRescan(db, 'wolfpack', 'D1', { id: 9, found: 12, ok: true }, NOW_ISO);
    expect(out).toEqual({ status: 200, body: { ok: true, id: 9, status: 'done', found: 12 } });
    expect(db.rows[0]).toMatchObject({ status: 'done', found: 12, done_at: NOW_ISO });
  });
  it('ok:false closes it failed', async () => {
    const db = fakeDb([taken()]);
    const out = await R.finishRescan(db, 'wolfpack', 'D1', { id: 9, found: 0, ok: false }, NOW_ISO);
    expect(out.body.status).toBe('failed');
    expect(db.rows[0].status).toBe('failed');
  });
  it('a stranger cannot close it, and cannot tell it exists', async () => {
    const db = fakeDb([taken()]);
    const out = await R.finishRescan(db, 'wolfpack', 'D2', { id: 9, found: 99, ok: true }, NOW_ISO);
    expect(out.status).toBe(404);
    expect(await R.finishRescan(db, 'wolfpack', 'D2', { id: 12345, found: 1, ok: true }, NOW_ISO)).toEqual(out);
    expect(db.rows[0].status).toBe('taken');
    expect(db.updates).toBe(0);
    expect((await R.finishRescan(db, 'wolfpack', '', { id: 9, found: 1, ok: true }, NOW_ISO)).status).toBe(404);
  });
  it('a pending request was never handed to an agent, so it cannot be finished (409)', async () => {
    const db = fakeDb([row({ id: 9 })]);
    expect((await R.finishRescan(db, 'wolfpack', 'D1', { id: 9, found: 1, ok: true }, NOW_ISO)).status).toBe(409);
    expect(db.rows[0].status).toBe('pending');
  });
  it('finishing twice is fine and changes nothing the second time', async () => {
    const db = fakeDb([taken()]);
    await R.finishRescan(db, 'wolfpack', 'D1', { id: 9, found: 12, ok: true }, NOW_ISO);
    const again = await R.finishRescan(db, 'wolfpack', 'D1', { id: 9, found: 500, ok: true }, NOW_ISO);
    expect(again).toEqual({ status: 200, body: { ok: true, id: 9, already: true } });
    expect(db.rows[0].found).toBe(12);
  });
  it('bad bodies are 400: no id, a fractional or negative id, no ok', async () => {
    const db = fakeDb([taken()]);
    for (const b of [null, {}, { id: 'x', ok: true }, { id: 1.5, ok: true }, { id: -1, ok: true }, { id: 9 }, { id: 9, ok: 'yes' }, 'text']) {
      expect((await R.finishRescan(db, 'wolfpack', 'D1', b, NOW_ISO)).status, JSON.stringify(b)).toBe(400);
    }
    expect(db.rows[0].status).toBe('taken');
  });
  it('found is a whole number between 0 and a million, whatever the agent sends', async () => {
    for (const [sent, want] of [[-5, 0], [3.9, 3], ['7', 7], [undefined, 0], [1e12, 1_000_000], ['abc', 0]]) {
      const db = fakeDb([taken()]);
      await R.finishRescan(db, 'wolfpack', 'D1', { id: 9, found: sent, ok: true }, NOW_ISO);
      expect(db.rows[0].found, String(sent)).toBe(want);
    }
  });
  it('a database that will not answer is a 502, not a silent success', async () => {
    const db = fakeDb([taken()]); db.down = true;
    expect((await R.finishRescan(db, 'wolfpack', 'D1', { id: 9, found: 1, ok: true }, NOW_ISO)).status).toBe(502);
  });
});

describe('the website and the bot agree on the numbers', () => {
  it('pending lives 24 h, a taken row is stale after 30 min, days tops out at 60', () => {
    expect(R.PENDING_TTL_MS).toBe(webRescan.PENDING_TTL_MS);
    expect(R.STALE_TAKEN_MS).toBe(webRescan.STALE_TAKEN_MS);
    expect(R.MAX_DAYS).toBe(webRescan.MAX_DAYS);
  });
});

describe('the wiring in index.js (stripped source)', () => {
  it('rescan is a poll stream: asked for by name, shed by flag_shed_rescan, and served from the caller\'s own discord id', () => {
    const poll = stripJs(sliceBlock(bot, 'async function _handleAgentPoll(req, res) {', '\n}'));
    expect(poll).toMatch(/if \(_pollStreamDecision\('rescan', want, tune, null, null\) === 'send'\) \{\s*const sb = require\('\.\/utils\/supabase'\);\s*out\.streams\.rescan = await popRescan\.rescanRequestsFor\(/);
    expect(poll).toMatch(/\(sb, sb\.guildId\(\), String\(identity\.discord_id \|\| ''\), chars\)/);
  });
  it('an older agent never asks for the stream, so it never gets it; a shed flag omits it', () => {
    const { _pollStreamDecision } = evalBlock(sliceBlock(bot, 'function _pollStreamDecision(key, want, tune, clientVer, freshVer) {', '\n}'), ['_pollStreamDecision']);
    const oldAgent = new Set(['recent_fires', 'tuning', 'triggers', 'prefs', 'backfill', 'ui_edits', 'pet_owners']);
    expect(_pollStreamDecision('rescan', oldAgent, {}, null, null)).toBe('skip');
    expect(_pollStreamDecision('rescan', new Set(['rescan']), {}, null, null)).toBe('send');
    expect(_pollStreamDecision('rescan', new Set(['rescan']), { flag_shed_rescan: 1 }, null, null)).toBe('omit');
  });
  it('rescan-done is a bearer-auth POST route that reads a small body and passes the session\'s own discord id', () => {
    const handler = stripJs(sliceBlock(bot, 'async function _handleAgentRescanDone(req, res) {', '\n}'));
    expect(handler).toMatch(/await mimicLink\.requireAgentAuth\(req, res\);\s*if \(!identity\) return;/);
    expect(handler).toMatch(/total > 4 \* 1024\) \{ res\.writeHead\(413\)/);
    expect(handler).toMatch(/popRescan\.finishRescan\(/);
    expect(handler).toMatch(/String\(identity\.discord_id \|\| ''\), payload\)/);
    expect(stripJs(bot)).toMatch(/req\.method === 'POST' && req\.url === '\/api\/agent\/rescan-done'\) \{\s*try \{ return await _handleAgentRescanDone\(req, res\); \}/);
  });
  it('it is not an ingest stream: no budget and no shed kind, like the other write routes', () => {
    expect(stripJs(bot)).not.toMatch(/_overBudget\('rescan/);
  });
});
