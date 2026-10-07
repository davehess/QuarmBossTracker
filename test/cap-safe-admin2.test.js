// test/cap-safe-admin2.test.js — the officer pages read COMPLETE data under PostgREST's 1,000-row cap.
//
// The guild lead, 2026-10-04: "review all of the other tables for silent 500 or 100 caps". The
// audit measured these pages returning a fraction of their tables, with no error:
//   /admin/encounters  1,000 of 5,949 encounters in 7 d; children cut at 1,000 rows
//   /admin/agents      1,000 of 1,721 agent_upload_stats rows (the newest 1,000 hold 245 of 435 characters)
//   /admin/links       1,000 of 1,682 uploader rows
//   /admin/anomalies   500 newest of 14,516 rows (97% farm trash) = 14 hours of a 21-day review, 0 of 114 boss kills
//   /admin/signups     16 of 46 events' players and 22 of 46 events' /who rows over 1,000
//   at risk: /admin/console (733 rows / 484 triggers), /admin/spells (555 rows), the links /who lookup
//
// How this tests it. The loaders live in web/lib/adminReads.ts and take the client as an argument,
// so they RUN here against a fake PostgREST that does what the real one does to a read:
//   · caps EVERY response at 1,000 rows, whatever `.limit()` or `.range()` asked for (verified on
//     production: one `.range(0, 49999)` call returns 1,000 rows);
//   · honours filters, `.order()`, `.range()` and column projection (so a loader that orders by a
//     column it does not select still works, as in Postgres);
//   · hands an UNORDERED query back in a different permutation on every call, which is what an
//     offset walk over heap order does — so a missing `.order()` shows as skipped / repeated rows;
//   · refuses an `.in()` list longer than a gateway would accept.
// The "legacy" cases below run the OLD shape of each query against the same fake and assert it
// loses rows — a fake that did not enforce the cap would pass the fixed code and the broken code alike.
//
// The migration is checked as text over stripSql (a comment can quote any of these strings); the
// functions themselves were run against production read-only (numbers in the commit message).
// Fixture names are invented.
//
// Run: npx vitest run test/cap-safe-admin2.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import { chunk, selectInChunks, IN_CHUNK } from '../web/lib/selectInChunks.ts';
import {
  loadAgentUploadStats, loadEnabledTriggerPatterns, loadWhoForNames, WHO_NAME_CHUNK,
  loadAnomalyWindow, loadOffHoursEncounters, loadPlayersForEncounters,
  loadSignupStatuses, loadRaidWindowNames, loadHeldSpellNeeds,
  loadEncounterGap, hasMissingDamage, GAP_HARD_CAP,
} from '../web/lib/adminReads.ts';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const page = (name) => stripJs(read(`web/app/admin/${name}/page.tsx`));

// ── The fake ────────────────────────────────────────────────────────────────

const CAP = 1000;
const MAX_IN = 250;   // a gateway refuses a URL long before this many uuids; 250 is generous

function topLevelColumns(select) {
  if (!select || select.trim() === '*') return null;
  const out = [];
  let depth = 0, cur = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(t => t.trim().split(/[\s(]/)[0]).filter(Boolean);
}

function fakeDb(tables = {}, rpcs = {}) {
  const log = [];
  let seq = 0;
  class Query {
    constructor(table, rows, errorOut, ordered = false) {
      // `ordered`: a function's own ORDER BY. Only a plain table read has "heap order" to lose.
      this.table = table; this.rows = rows; this.errorOut = errorOut ?? null; this.ordered = ordered;
      this.filters = []; this.orders = []; this.rng = null; this.lim = null; this.cols = null; this.inSizes = [];
      this.bad = null;
    }
    select(cols) { this.cols = cols; return this; }
    eq(c, v) { this.filters.push(r => r[c] === v); return this; }
    gt(c, v)  { this.filters.push(r => r[c] > v); return this; }
    gte(c, v) { this.filters.push(r => r[c] >= v); return this; }
    lt(c, v)  { this.filters.push(r => r[c] < v); return this; }
    lte(c, v) { this.filters.push(r => r[c] <= v); return this; }
    in(c, vals) {
      this.inSizes.push(vals.length);
      if (vals.length > MAX_IN) this.bad = { message: `URI too long: .in(${c}) with ${vals.length} values` };
      const s = new Set(vals);
      this.filters.push(r => s.has(r[c]));
      return this;
    }
    not(c, op, v) {
      if (op === 'is' && v === null) this.filters.push(r => r[c] != null);
      else throw new Error(`fake: not(${c}, ${op}) unsupported`);
      return this;
    }
    order(c, o = {}) { this.orders.push({ c, asc: o.ascending !== false }); return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
    run() {
      log.push({
        table: this.table, orders: this.orders.map(o => o.c + (o.asc ? '' : ' desc')),
        range: this.rng, limit: this.lim, inSizes: this.inSizes,
      });
      if (this.bad) return { data: null, error: this.bad };
      if (this.errorOut) return { data: null, error: this.errorOut };
      let out = this.rows.filter(r => this.filters.every(p => p(r)));
      if (this.orders.length) {
        out = [...out].sort((a, b) => {
          for (const { c, asc } of this.orders) {
            if (a[c] === b[c]) continue;
            const less = a[c] < b[c];
            return (less ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
      } else if (out.length > 1 && !this.ordered) {
        const k = (++seq * 7919) % out.length;   // heap order is not stable between requests
        out = out.slice(k).concat(out.slice(0, k));
      }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      else if (this.lim != null) out = out.slice(0, this.lim);
      out = out.slice(0, CAP);                    // PostgREST max-rows: silent
      const cols = topLevelColumns(this.cols);
      const data = cols ? out.map(r => Object.fromEntries(cols.filter(c => c in r).map(c => [c, r[c]]))) : out;
      return { data, error: null };
    }
  }
  return {
    log,
    from(table) { return new Query(table, tables[table] ?? []); },
    rpc(name, args) {
      log.push({ rpc: name, args });
      const res = rpcs[name](args);
      return new Query(`rpc:${name}`, res.data ?? [], res.error, true);
    },
  };
}

// ── Production-sized fixtures ───────────────────────────────────────────────

const pad = (n, w = 3) => String(n).padStart(w, '0');
const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.parse('2026-10-04T12:00:00Z');

// 435 characters, 1,721 (character, endpoint) rows: 416 characters with 4 endpoints, 19 with 3.
function statRows() {
  const eps = ['encounter', 'chat', 'live-state', 'buff_casts'];
  const rows = [];
  for (let c = 0; c < 435; c++) {
    const n = c < 416 ? 4 : 3;
    for (let e = 0; e < n; e++) {
      rows.push({
        guild_id: 'wolfpack', character: `Char${pad(c)}`, endpoint: eps[e],
        agent_version: c % 2 ? '3.7.77' : '3.7.78',
        last_uploaded_at: iso(T0 - ((c * 37 + e * 11) % 5000) * 60_000),
        uploaded_by_discord_id: rows.length % 45 === 0 ? null : `d${c}`,   // 39 rows with no uploader
      });
    }
  }
  return rows;
}

describe('the fake is honest (otherwise nothing below means anything)', () => {
  const rows = statRows();
  it('production-sized fixture: 1,721 rows, 435 characters, 1,682 with an uploader', () => {
    expect(rows.length).toBe(1721);
    expect(new Set(rows.map(r => r.character)).size).toBe(435);
    expect(rows.filter(r => r.uploaded_by_discord_id).length).toBe(1682);
  });
  it('caps every response at 1,000 rows, whatever limit or range asked for', async () => {
    const db = fakeDb({ agent_upload_stats: rows });
    const a = await db.from('agent_upload_stats').select('character').limit(2000);
    const b = await db.from('agent_upload_stats').select('character').range(0, 49999);
    const c = await db.from('agent_upload_stats').select('character').order('character').limit(50000);
    expect([a.data.length, b.data.length, c.data.length]).toEqual([1000, 1000, 1000]);
  });
  it('an unordered offset walk skips or repeats rows', async () => {
    const db = fakeDb({ agent_upload_stats: rows });
    const seen = [];
    for (let from = 0; from < 2000; from += 1000) {
      const { data } = await db.from('agent_upload_stats').select('character, endpoint').range(from, from + 999);
      seen.push(...data.map(r => `${r.character}/${r.endpoint}`));
    }
    expect(new Set(seen).size).toBeLessThan(rows.length);
  });
  it('refuses an .in() list longer than a gateway would take', async () => {
    const db = fakeDb({ agent_upload_stats: rows });
    const { error } = await db.from('agent_upload_stats').select('character').in('character', Array.from({ length: 300 }, (_, i) => `x${i}`));
    expect(error.message).toMatch(/URI too long/);
  });
});

// ── chunk + selectInChunks ──────────────────────────────────────────────────

describe('chunk / selectInChunks', () => {
  it('splits into chunks of the size asked, last one short; size is clamped to at least 1', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 60)).toEqual([]);
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
    expect(chunk(Array.from({ length: 130 }, (_, i) => i)).map(c => c.length)).toEqual([IN_CHUNK, IN_CHUNK, 10]);
  });

  it('drains EVERY chunk across pages — a chunk of 60 encounters is over 1,000 player rows on its own', async () => {
    // 200 boss kills x 40 players = 8,000 rows; each 60-id chunk is 2,400 rows.
    const ids = Array.from({ length: 200 }, (_, i) => `enc${pad(i)}`);
    const players = ids.flatMap(id => Array.from({ length: 40 }, (_, p) => ({ encounter_id: id, character_name: `P${pad(p, 2)}`, total_damage: p })));
    const db = fakeDb({ encounter_players: players });
    const rows = await selectInChunks(ids, (part, from, to) => db.from('encounter_players')
      .select('encounter_id, character_name').in('encounter_id', part)
      .order('encounter_id').order('character_name').range(from, to));
    expect(rows.length).toBe(8000);
    expect(new Set(rows.map(r => `${r.encounter_id}/${r.character_name}`)).size).toBe(8000);
    // Never more keys per request than the chunk size:
    expect(Math.max(...db.log.flatMap(l => l.inSizes ?? []))).toBeLessThanOrEqual(IN_CHUNK);
  });

  it('LEGACY: the same chunk loop without paging reads 1,000 rows per chunk', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => `enc${pad(i)}`);
    const players = ids.flatMap(id => Array.from({ length: 40 }, (_, p) => ({ encounter_id: id, character_name: `P${pad(p, 2)}` })));
    const db = fakeDb({ encounter_players: players });
    let got = 0;
    for (const part of chunk(ids, 60)) {
      const { data } = await db.from('encounter_players').select('encounter_id, character_name').in('encounter_id', part);
      got += data.length;
    }
    expect(got).toBeLessThan(8000);
    expect(got).toBe(1000 * 3 + 800);   // three full chunks cut at 1,000, the last (20 ids) whole
  });

  it('does not overflow the stack when a chunk holds a very large result', async () => {
    const big = Array.from({ length: 150_000 }, (_, i) => ({ k: 'a', n: i }));
    const rows = await selectInChunks(['a'], async (_part, from, to) => ({ data: big.slice(from, to + 1), error: null }), { hardCap: 200_000 });
    expect(rows.length).toBe(150_000);
  });
});

// ── /admin/agents, /admin/links, /admin/console: agent_upload_stats ─────────

describe('loadAgentUploadStats', () => {
  const rows = statRows();

  it('returns all 1,721 rows and all 435 characters, each exactly once', async () => {
    const db = fakeDb({ agent_upload_stats: rows });
    const got = await loadAgentUploadStats(db, 'character, endpoint, last_uploaded_at');
    expect(got.length).toBe(1721);
    expect(new Set(got.map(r => `${r.character}/${r.endpoint}`)).size).toBe(1721);
    expect(new Set(got.map(r => r.character)).size).toBe(435);
  });

  it('LEGACY: the old newest-first .limit(2000) read 1,000 rows and lost characters', async () => {
    const db = fakeDb({ agent_upload_stats: rows });
    const { data } = await db.from('agent_upload_stats').select('character, endpoint')
      .order('last_uploaded_at', { ascending: false }).limit(2000);
    expect(data.length).toBe(1000);
    expect(new Set(data.map(r => r.character)).size).toBeLessThan(435);
  });

  it('pages by the primary key (guild_id, character, endpoint) — the one order that cannot repeat a row', async () => {
    const db = fakeDb({ agent_upload_stats: rows });
    await loadAgentUploadStats(db, 'character');
    const orders = db.log.filter(l => l.table === 'agent_upload_stats').map(l => l.orders.join(','));
    expect(orders.length).toBe(2);   // 1,721 rows = a full page and a short one
    for (const o of orders) expect(o).toBe('guild_id,character,endpoint');
  });

  it('applies the caller filter before paging: uploader rows only is 1,682, not 1,000 (links)', async () => {
    const db = fakeDb({ agent_upload_stats: rows });
    const got = await loadAgentUploadStats(db, 'character, uploaded_by_discord_id, last_uploaded_at',
      q => q.not('uploaded_by_discord_id', 'is', null).not('character', 'is', null));
    expect(got.length).toBe(1682);
    expect(got.every(r => r.uploaded_by_discord_id)).toBe(true);
  });

  it('console: the 7-day version read is complete past 1,000 rows (the at-risk case)', async () => {
    // 30-day shape: every row recent, 1,721 of them.
    const recent = rows.map(r => ({ ...r, last_uploaded_at: iso(T0 - 3600_000) }));
    const db = fakeDb({ agent_upload_stats: recent });
    const weekAgo = iso(T0 - 7 * 86_400_000);
    const got = await loadAgentUploadStats(db, 'character, agent_version', q => q.gte('last_uploaded_at', weekAgo));
    expect(got.length).toBe(1721);
  });
});

describe('loadEnabledTriggerPatterns', () => {
  it('reads every enabled trigger, past 1,000, by id', async () => {
    const triggers = Array.from({ length: 1300 }, (_, i) => ({
      id: `t${pad(i, 4)}`, enabled: i % 5 !== 0, pattern: i % 7 === 0 ? `^[A-Z] ${i}` : `pattern ${i}`,
    }));
    const db = fakeDb({ guild_triggers: triggers });
    const patterns = await loadEnabledTriggerPatterns(db);
    expect(patterns.length).toBe(triggers.filter(t => t.enabled).length);   // 1,040
    expect(patterns.length).toBeGreaterThan(1000);
    expect(db.log.every(l => l.orders.join() === 'id')).toBe(true);
  });
  it('a null pattern is an empty string, not a hole', async () => {
    const db = fakeDb({ guild_triggers: [{ id: 'a', enabled: true, pattern: null }] });
    expect(await loadEnabledTriggerPatterns(db)).toEqual(['']);
  });
});

// ── /admin/links: the targeted /who lookup ──────────────────────────────────

describe('loadWhoForNames', () => {
  // 250 unregistered names, 20 sightings each = 5,000 rows; a 100-name chunk is 2,000 on its own.
  const names = Array.from({ length: 250 }, (_, i) => `Alt${pad(i)}`);
  const who = names.flatMap((n, i) => Array.from({ length: 20 }, (_, k) => ({
    id: i * 100 + k, guild_id: 'wolfpack', character: n, level: 40 + k, class: k === 0 ? 'Cleric' : 'Anon',
    // Alt000 was seen today, Alt249 eight months ago: a newest-first read runs out of room on the old names.
    observed_at: iso(T0 - i * 86_400_000 - k * 3600_000),
  })));

  it('returns every sighting of every name, 100 names per request', async () => {
    const db = fakeDb({ who_observations: who });
    const got = await loadWhoForNames(db, 'wolfpack', names);
    expect(got.length).toBe(5000);
    expect(Math.max(...db.log.flatMap(l => l.inSizes ?? []))).toBeLessThanOrEqual(WHO_NAME_CHUNK);
  });

  it('keeps "the first row for a name is its newest sighting" (the page takes the first non-null class)', async () => {
    const db = fakeDb({ who_observations: who });
    const got = await loadWhoForNames(db, 'wolfpack', names);
    const first = new Map();
    for (const w of got) if (!first.has(w.character)) first.set(w.character, w);
    expect(first.size).toBe(250);
    for (const w of first.values()) expect(w.class).toBe('Cleric');   // k = 0 is the newest
  });

  it('LEGACY: the old single .in(...).limit(5000) lookup read 1,000 rows and lost 200 of the 250 names', async () => {
    const db = fakeDb({ who_observations: who });
    const { data } = await db.from('who_observations').select('character').eq('guild_id', 'wolfpack')
      .in('character', names.slice(0, 200)).order('observed_at', { ascending: false }).limit(5000);
    expect(data.length).toBe(1000);
    expect(new Set(data.map(r => r.character)).size).toBeLessThan(200);
  });

  it('other guilds\' sightings are not mixed in', async () => {
    const db = fakeDb({ who_observations: [...who.slice(0, 40), { id: 9999, guild_id: 'other', character: 'Alt000', level: 60, class: 'X', observed_at: iso(T0) }] });
    const got = await loadWhoForNames(db, 'wolfpack', ['Alt000']);
    expect(got.length).toBe(20);
  });
});

// ── /admin/anomalies ────────────────────────────────────────────────────────

describe('anomalies loaders', () => {
  // 25,000 encounters since April: 1,600 curated kills, the rest farm trash. 21-day window = the newest 15,000.
  const CURATED = Array.from({ length: 132 }, (_, i) => 1000 + i);
  const encounters = [];
  for (let i = 0; i < 25_000; i++) {
    const curated = i % 25 === 0 ? 1 : 0;   // 1,000 of them: every 25th
    encounters.push({
      id: `e${pad(i, 6)}`, started_at: iso(T0 - i * 600_000),
      npc_id: curated ? CURATED[i % 132] : 5000 + (i % 700), total_damage: 1000 + i, classification: null,
      encounter_players: [{ character_name: 'X', total_damage: 1 }], eqemu_npc_types: { name: 'n' },
    });
  }
  const curatedCount = encounters.filter(e => CURATED.includes(e.npc_id)).length;
  const since21 = iso(T0 - 21 * 86_400_000);

  it('returns every curated kill in the 21-day window, nothing else, newest first, no repeats', async () => {
    const db = fakeDb({ encounters });
    const got = await loadAnomalyWindow(db, since21, CURATED);
    const want = encounters.filter(e => CURATED.includes(e.npc_id) && e.started_at >= since21);
    expect(got.length).toBe(want.length);
    expect(want.length).toBeGreaterThan(100);
    expect(new Set(got.map(e => e.id)).size).toBe(got.length);
    expect(got.every(e => CURATED.includes(encounters.find(x => x.id === e.id).npc_id))).toBe(true);
    expect(got.map(e => e.started_at)).toEqual([...got.map(e => e.started_at)].sort().reverse());
    expect(got[0].encounter_players).toBeTruthy();   // the embed survives
  });

  it('LEGACY: the old newest-500 window over every encounter held ~3 days of trash, not 21 days of bosses', async () => {
    const db = fakeDb({ encounters });
    const { data } = await db.from('encounters').select('id, started_at, npc_id').gt('total_damage', 0)
      .gte('started_at', since21).order('started_at', { ascending: false }).limit(500);
    expect(data.length).toBe(500);
    const oldest = data[data.length - 1].started_at;
    expect(Date.parse(oldest)).toBeGreaterThan(T0 - 4 * 86_400_000);   // 500 x 10 min = 3.5 days
    expect(data.filter(e => CURATED.includes(e.npc_id)).length).toBeLessThan(25);
  });

  it('off-hours: all curated kills since April past 1,000 rows (the old .limit(4000) read 1,000 of everything)', async () => {
    const db = fakeDb({ encounters });
    const got = await loadOffHoursEncounters(db, '2026-04-01T00:00:00Z', CURATED);
    expect(got.length).toBe(curatedCount);
    expect(new Set(got.map(e => e.id)).size).toBe(curatedCount);
    // 1,000 curated rows would fit the cap exactly; push past it to prove the paging.
    const more = [...encounters, ...Array.from({ length: 700 }, (_, i) => ({
      id: `x${pad(i, 6)}`, started_at: iso(T0 - (25_000 + i) * 600_000 + 7), npc_id: CURATED[i % 132], total_damage: 5,
    }))];
    const got2 = await loadOffHoursEncounters(fakeDb({ encounters: more }), '2026-04-01T00:00:00Z', CURATED);
    expect(got2.length).toBe(curatedCount + 700);
    expect(got2.length).toBeGreaterThan(CAP);
  });

  it('zero-damage encounters are left out, as before', async () => {
    const db = fakeDb({ encounters: [
      { id: 'a', started_at: iso(T0), npc_id: 1000, total_damage: 0 },
      { id: 'b', started_at: iso(T0 - 1000), npc_id: 1000, total_damage: 9 },
    ] });
    expect((await loadOffHoursEncounters(db, since21, [1000])).map(e => e.id)).toEqual(['b']);
  });

  it('no curated bosses means no query at all (an empty .in() is not "everything")', async () => {
    const db = fakeDb({ encounters });
    expect(await loadAnomalyWindow(db, since21, [])).toEqual([]);
    expect(await loadOffHoursEncounters(db, since21, [])).toEqual([]);
    expect(db.log.length).toBe(0);
  });

  it('loadPlayersForEncounters reads every player of 450 kills (60 ids per request, each request paged)', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `k${pad(i)}`);
    const players = ids.flatMap(id => Array.from({ length: 25 }, (_, p) => ({ encounter_id: id, character_name: `Pl${pad(p, 2)}`, total_damage: p + 1 })));
    const db = fakeDb({ encounter_players: players });
    const got = await loadPlayersForEncounters(db, ids);
    expect(got.length).toBe(450 * 25);
    expect(new Set(got.map(r => `${r.encounter_id}/${r.character_name}`)).size).toBe(450 * 25);
    expect(db.log.some(l => l.range && l.range[0] > 0)).toBe(true);   // a chunk needed a second page
  });
});

// ── /admin/signups ──────────────────────────────────────────────────────────

describe('signups loaders', () => {
  it('loadSignupStatuses reads all 2,046 sign-ups of 46 events (60-day option), not 1,000', async () => {
    const events = Array.from({ length: 46 }, (_, i) => `ev${pad(i)}`);
    const signups = [];
    for (let i = 0; i < 2046; i++) signups.push({ event_id: events[i % 46], signup_id: `s${pad(i, 4)}`, status: i % 3 ? 'Going' : 'Tentative' });
    const db = fakeDb({ rh_signups: signups });
    const got = await loadSignupStatuses(db, events);
    expect(got.length).toBe(2046);
    expect(got.filter(s => s.status === 'Going').length).toBe(signups.filter(s => s.status === 'Going').length);
    expect(Math.max(...db.log.flatMap(l => l.inSizes ?? []))).toBeLessThanOrEqual(IN_CHUNK);
  });

  it('loadRaidWindowNames pages the function: 1,300 distinct names come back whole', async () => {
    const all = Array.from({ length: 1300 }, (_, i) => ({ character_name: `Seen${pad(i, 4)}` }));
    const db = fakeDb({}, { raid_window_names: () => ({ data: all }) });
    const { names, error } = await loadRaidWindowNames(db, '2026-10-02T23:30:00Z', '2026-10-03T05:30:00Z');
    expect(error).toBeNull();
    expect(names.length).toBe(1300);
    expect(new Set(names).size).toBe(1300);
    const call = db.log.find(l => l.rpc === 'raid_window_names');
    expect(call.args).toEqual({ p_lo: '2026-10-02T23:30:00Z', p_hi: '2026-10-03T05:30:00Z' });
  });

  it('a missing or timed-out function is reported, not read as "nobody else was around"', async () => {
    const db = fakeDb({}, { raid_window_names: () => ({ error: { message: 'Could not find the function public.raid_window_names' } }) });
    const { names, error } = await loadRaidWindowNames(db, '2026-10-02T23:30:00Z', '2026-10-03T05:30:00Z');
    expect(names).toEqual([]);
    expect(error.message).toMatch(/Could not find the function/);
  });

  it('LEGACY: the old shapes (.in(ids) over players, .limit(50000) over /who) read 1,000 rows each', async () => {
    const ids = Array.from({ length: 362 }, (_, i) => `e${pad(i)}`);
    const players = ids.flatMap(id => Array.from({ length: 8 }, (_, p) => ({ encounter_id: id, character_name: `P${p}` })));   // 2,896 rows
    const whos = Array.from({ length: 3166 }, (_, i) => ({ id: i, character: `W${i % 538}`, observed_at: iso(T0) }));
    const db = fakeDb({ encounter_players: players, who_observations: whos });
    const eps = await db.from('encounter_players').select('character_name').in('encounter_id', ids.slice(0, 200));
    const w = await db.from('who_observations').select('character').limit(50000);
    expect(eps.data.length).toBe(1000);
    expect(w.data.length).toBe(1000);
  });
});

// ── /admin/spells ───────────────────────────────────────────────────────────

describe('loadHeldSpellNeeds', () => {
  it('reads a set-returning function past 1,000 rows', async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ spell_name: `Spell ${pad(i, 4)}`, needers: [], holders: [] }));
    const db = fakeDb({}, { guild_held_spell_needs: () => ({ data: all }) });
    const { rows, error } = await loadHeldSpellNeeds(db, 'wolfpack');
    expect(error).toBeNull();
    expect(rows.length).toBe(1500);
    expect(db.log.find(l => l.rpc).args).toEqual({ p_guild_id: 'wolfpack' });
  });
  it('surfaces the error instead of letting an empty list read as "no scrolls observed"', async () => {
    const db = fakeDb({}, { guild_held_spell_needs: () => ({ error: { message: 'canceling statement due to statement timeout' } }) });
    const { rows, error } = await loadHeldSpellNeeds(db, 'wolfpack');
    expect(rows).toEqual([]);
    expect(error.message).toMatch(/statement timeout/);
  });
});

// ── /admin/encounters ───────────────────────────────────────────────────────

describe('loadEncounterGap', () => {
  // The function pages itself (p_limit / p_offset) and is clamped to 1,000, newest first.
  function gapHandler(total, onCall) {
    const all = Array.from({ length: total }, (_, i) => ({
      id: `enc${pad(i, 6)}`, npc_id: 1, npc_name: 'a_mob', expected_hp: 100, zone_short: 'z',
      started_at: iso(T0 - i * 60_000), duration_sec: 5, total_damage: 100, total_dps: 20,
      data_incomplete: false, data_incomplete_reason: null, contribs: 1, players: 2, candidates: [],
    }));
    const calls = [];
    return {
      all, calls,
      rpc: (args) => {
        calls.push(args);
        const data = all.slice(args.p_offset, args.p_offset + Math.min(args.p_limit, 1000));
        onCall?.(all, calls.length);   // what happens AFTER this page was served
        return { data };
      },
    };
  }

  it('reads all 5,949 encounters of a 7-day window, 1,000 per call, offsets 0..5000', async () => {
    const h = gapHandler(5949);
    const db = fakeDb({}, { encounter_gap_audit: h.rpc });
    const { rows, truncated, error } = await loadEncounterGap(db, '2026-09-27T12:00:00Z', ['Aldenmar', 'Brackwyn']);
    expect(rows.length).toBe(5949);
    expect(truncated).toBe(false);
    expect(error).toBeNull();
    expect(h.calls.map(c => c.p_offset)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(h.calls.every(c => c.p_limit === 1000)).toBe(true);
    expect(h.calls[0].p_since).toBe('2026-09-27T12:00:00Z');
    expect(h.calls[0].p_names).toEqual(['Aldenmar', 'Brackwyn']);
    expect(rows.map(r => r.id)).toEqual(h.all.map(r => r.id));   // newest first, as the function ordered them
  });

  it('LEGACY: the old .range(0, 4999) read 1,000 of those 5,949', async () => {
    const h = gapHandler(5949);
    const db = fakeDb({ encounters: h.all });
    const { data } = await db.from('encounters').select('id').order('started_at', { ascending: false }).range(0, 4999);
    expect(data.length).toBe(1000);
  });

  it('a kill landing mid-read shifts every offset by one; the repeated row is dropped, none is lost', async () => {
    let inserted = false;
    const h = gapHandler(2500, (all, n) => {
      if (n === 1 && !inserted) {   // after page 1 was served, a newer kill arrives
        inserted = true;
        all.unshift({ ...all[0], id: 'enc-new', started_at: iso(T0 + 60_000) });
      }
    });
    const db = fakeDb({}, { encounter_gap_audit: h.rpc });
    const { rows } = await loadEncounterGap(db, '2026-09-27T12:00:00Z', []);
    const ids = rows.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(2500);          // the 2,500 that existed when the read began
    expect(ids).toContain('enc000000');
    expect(ids).toContain('enc002499');
  });

  it('stops at the hard cap and says so (the page labels it); under it, never truncated', async () => {
    const h = gapHandler(GAP_HARD_CAP + 2500);
    const db = fakeDb({}, { encounter_gap_audit: h.rpc });
    const big = await loadEncounterGap(db, '2026-07-01T00:00:00Z', []);
    expect(big.rows.length).toBe(GAP_HARD_CAP);
    expect(big.truncated).toBe(true);
    expect(big.rows[0].id).toBe('enc000000');   // the NEWEST are kept
    const small = await loadEncounterGap(fakeDb({}, { encounter_gap_audit: gapHandler(GAP_HARD_CAP - 1).rpc }), '2026-07-01T00:00:00Z', []);
    expect(small.truncated).toBe(false);
  });

  it('an error is reported, not read as "no encounters"', async () => {
    const db = fakeDb({}, { encounter_gap_audit: () => ({ error: { message: 'canceling statement due to statement timeout' } }) });
    const { rows, error } = await loadEncounterGap(db, '2026-09-27T12:00:00Z', []);
    expect(rows).toEqual([]);
    expect(error.message).toMatch(/statement timeout/);
  });
});

describe('hasMissingDamage — the rows that get backfill candidates', () => {
  it('data_incomplete, no damage, or under 75% of the catalog HP', () => {
    expect(hasMissingDamage({ data_incomplete: true, total_damage: 100, expected_hp: 100 })).toBe(true);
    expect(hasMissingDamage({ total_damage: 0, expected_hp: 100 })).toBe(true);
    expect(hasMissingDamage({ total_damage: null, expected_hp: 100 })).toBe(true);
    expect(hasMissingDamage({ total_damage: null, expected_hp: null })).toBe(true);
    expect(hasMissingDamage({ total_damage: 74, expected_hp: 100 })).toBe(true);
  });
  it('75% and up is complete; over-cap is a different problem; no catalog HP cannot say', () => {
    expect(hasMissingDamage({ total_damage: 75, expected_hp: 100 })).toBe(false);
    expect(hasMissingDamage({ total_damage: 100, expected_hp: 100 })).toBe(false);
    expect(hasMissingDamage({ total_damage: 400, expected_hp: 100 })).toBe(false);
    expect(hasMissingDamage({ total_damage: 50, expected_hp: null })).toBe(false);
    expect(hasMissingDamage({ total_damage: 50, expected_hp: 0 })).toBe(false);
  });
});

// ── The migration ───────────────────────────────────────────────────────────

describe('20261004140500_cap_safe_admin2.sql', () => {
  const FILE = 'supabase/migrations/20261004140500_cap_safe_admin2.sql';
  const raw = read(FILE);
  const sql = stripSql(raw);

  it('defines both functions, idempotently, as security invoker with a pinned search_path', () => {
    for (const fn of ['encounter_gap_audit', 'raid_window_names']) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    }
    expect((sql.match(/security invoker/g) ?? []).length).toBe(2);
    expect((sql.match(/set search_path = public/g) ?? []).length).toBe(2);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).not.toMatch(/\bdrop\b/i);
  });

  it('is callable only by service_role (the pages use supabaseAdmin)', () => {
    for (const sig of ['encounter_gap_audit\\(timestamptz, text\\[\\], int, int\\)', 'raid_window_names\\(timestamptz, timestamptz\\)']) {
      for (const who of ['public', 'anon', 'authenticated']) {
        expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig} from ${who};`));
      }
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${sig} to service_role;`));
    }
    expect(sql).not.toMatch(/grant [^;]* to (anon|authenticated|public)/);
  });

  it('pages on a UNIQUE order and clamps the page to the cap', () => {
    expect(sql).toMatch(/order by e\.started_at desc, e\.id\s+limit least\(greatest\(coalesce\(p_limit, 1000\), 1\), 1000\)\s+offset greatest\(coalesce\(p_offset, 0\), 0\)/);
    expect(sql).toMatch(/order by p\.started_at desc, p\.id\s*\n\$\$/);
  });

  it('raid_window_names is distinct (UNION) and ordered by name, so it pages stably', () => {
    const body = sql.slice(sql.indexOf('function public.raid_window_names'));
    expect(body).toMatch(/\bunion\b(?!\s+all)/);
    expect(body).toMatch(/order by 1\s*\n\$\$/);
    expect(body).toMatch(/e\.started_at >= p_lo and e\.started_at < p_hi/);
    expect(body).toMatch(/w\.observed_at >= p_lo and w\.observed_at < p_hi/);
  });

  it('the missing-damage rule and the 15-minute window match the page and the old JS', () => {
    // hasMissingDamage in web/lib/adminReads.ts is the same rule; its 75% line is pinned in the cases above.
    expect(sql).toMatch(/p\.data_incomplete\s+or coalesce\(p\.total_damage, 0\) = 0\s+or \(p\.expected_hp > 0 and p\.total_damage < 0\.75 \* p\.expected_hp\)/);
    expect((sql.match(/interval '15 minutes'/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // Only candidates NOT already in the fight, only the passed names:
    expect(sql).toMatch(/not exists \(\s*select 1 from present pr where pr\.encounter_id = g\.id and pr\.character_name = s\.nm\s*\)/);
    expect(sql).toMatch(/join names n on n\.nm = s\.nm/);
  });

  it('reads who_observations by TIME first (the planner chose the trigram index for = any(names): 1.5 s)', () => {
    expect(sql).toMatch(/from who_observations w, bounds b\s+where w\.observed_at between b\.lo and b\.hi/);
    expect(sql).not.toMatch(/= any\(p_names\)/);
  });

  it('keeps the raid_roster read on its guild_id index', () => {
    expect(sql).toMatch(/from raid_roster r, bounds b\s+where r\.guild_id = 'wolfpack'/);
  });
});

// ── The pages ───────────────────────────────────────────────────────────────

describe('the seven pages no longer carry the cap-blind reads', () => {
  const pages = ['encounters', 'agents', 'links', 'anomalies', 'signups', 'console', 'spells'];

  it('no `.range(0, N)` for N >= 1000 anywhere in them (one range call is still cut at 1,000)', () => {
    for (const p of pages) {
      expect(page(p), `/admin/${p}`).not.toMatch(/\.range\(\s*0\s*,\s*\d{4,}\s*\)/);
    }
  });

  it('the only over-cap `.limit(N)` left is the links /who recency window, which the targeted lookup completes', () => {
    const left = [];
    for (const p of pages) {
      for (const m of page(p).matchAll(/\.limit\(\s*(\d+)\s*\)/g)) if (Number(m[1]) > 1000) left.push(`${p}:${m[1]}`);
    }
    expect(left).toEqual(['links:3000']);
    // ...and that read is the who_observations window, not agent_upload_stats:
    const links = page('links');
    const at = links.indexOf('.limit(3000)');
    expect(links.slice(Math.max(0, at - 220), at)).toContain("from('who_observations')");
  });

  it('/admin/agents reads its four tables through selectAll over a unique order', () => {
    const s = page('agents');
    expect(s).toMatch(/selectAll<StatRow>\(\(from, to\) => admin\s+\.from\('agent_upload_stats'\)/);
    expect(s).toContain(".order('guild_id').order('character').order('endpoint')");
    expect(s).toMatch(/selectAll<RosterRow>\(\(from, to\) => admin\s+\.from\('characters'\)/);
    expect(s).toMatch(/selectAll<MemberRow>\(\(from, to\) => admin\s+\.from\('wolfpack_members'\)/);
    expect(s).not.toMatch(/\.limit\(2000\)|\.limit\(5000\)/);
  });

  it('/admin/links reads uploaders and the targeted /who lookup through the paged loaders', () => {
    const s = page('links');
    expect(s).toContain('loadAgentUploadStats<');
    expect(s).toContain('loadWhoForNames(admin');
    expect(s).not.toMatch(/\.from\('agent_upload_stats'\)/);
    expect(s).not.toMatch(/\.limit\(5000\)/);
  });

  it('/admin/anomalies filters to curated bosses and keeps its copy true', () => {
    const s = page('anomalies');
    expect(s).toContain('curatedNpcIds(supabaseAdmin())');
    expect(s).toContain('loadAnomalyWindow<Enc>(sb, sinceIso, curated)');
    expect(s).toContain('loadOffHoursEncounters<OffEnc>(sb, OFFHOURS_SINCE, curated)');
    expect(s).toContain('loadPlayersForEncounters(sb, ids)');
    expect(s).not.toMatch(/ROW_LIMIT|\.limit\(4000\)|\.limit\(500\)/);
    // The queue is no longer "every kill": the copy says boss kills, and still says since April / last N days.
    expect(s).toMatch(/\{OFFHOURS_MIN_PLAYERS\}\+ player boss kill since April/);
    expect(s).toMatch(/curated kill-card list/);
    expect(s).toMatch(/in the last \{LOOKBACK_DAYS\} days/);
    expect(s).not.toMatch(/\+ player kill since April/);
  });

  it('/admin/signups reads sign-ups and the window\'s names through the paged loaders', () => {
    const s = page('signups');
    expect(s).toContain('loadSignupStatuses(admin');
    expect(s).toContain('loadRaidWindowNames(admin, lo, hi)');
    expect(s).toMatch(/\{windowError && \(/);   // and a failed read is shown, not read as "no one came"
    expect(s).not.toMatch(/\.limit\(50000\)/);
    expect(s).not.toMatch(/from\('encounter_players'\)/);
    expect(s).not.toMatch(/from\('who_observations'\)/);
    expect(s).not.toMatch(/from\('rh_signups'\)\s*\.select\('event_id, status'\)/);
  });

  it('/admin/console pages the 7-day versions and the enabled triggers', () => {
    const s = page('console');
    expect(s).toContain('loadAgentUploadStats<');
    expect(s).toContain('loadEnabledTriggerPatterns(sb)');
    expect(s).not.toMatch(/\.limit\(2000\)/);
    expect(s).not.toMatch(/from\('guild_triggers'\)/);
  });

  it('/admin/spells reads the function through the paged loader and still shows its error', () => {
    const s = page('spells');
    expect(s).toContain('loadHeldSpellNeeds<HeldSpell>(sb, GUILD_TAG)');
    expect(s).not.toMatch(/sb\.rpc\('guild_held_spell_needs'/);
    expect(s).toMatch(/error && <p[^>]*>⚠ \{error\.message\}/);
  });

  it('/admin/encounters reads one paged function, with an honest label when the hard cap is hit', () => {
    const s = page('encounters');
    // The server actions below the loader still update/delete encounters; it is the LOADER that must not read them.
    const loader = s.slice(s.indexOf('async function loadEncounters'), s.indexOf('const DUP_WINDOW_MS'));
    expect(loader.length).toBeGreaterThan(500);
    expect(loader).toContain('loadEncounterGap(admin, sinceIso, names)');
    expect(loader).not.toMatch(/\.from\('encounters'\)/);
    expect(loader).not.toMatch(/\.from\('contributions'\)|\.from\('encounter_players'\)|\.from\('who_observations'\)|\.from\('raid_roster'\)/);
    expect(loader).not.toMatch(/\.range\(\s*0\b/);
    expect(s).toContain('truncated ?');
    expect(s).not.toContain('stats.total >= 5000');
    expect(s).toContain('hasMissingDamage(r)');
  });

  it('every page that was edited still gates itself first (the officer-gate test covers the rest)', () => {
    for (const p of pages) expect(read(`web/app/admin/${p}/page.tsx`)).toContain('await requireOfficer()');
  });
});
