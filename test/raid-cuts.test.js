// test/raid-cuts.test.js — a recorded session is cut where the RAID changed, not only at a 20-minute silence
// (web/lib/raidCuts.ts, cutSession / summarizeNights in web/lib/raidReplay.ts), and the replay's timeline strip shows
// the session on screen only (killsInSession).
//
//   1. CUT      cutSession / summarizeNights(rows, cuts): one gap-session becomes two sessions at a cut; the labels read
//               as two raids; a cut outside, at the first minute, or none changes nothing; the default session is the
//               longer raid.
//   2. LOADER   loadRaidCuts against a fake PostgREST: two raids back to back are cut once, finished sessions are
//               stored and never read again, a running session is re-worked at most every 5 minutes and never stored,
//               daytime groups and one steady raid get no cut, at most two sessions are worked out per request, and a
//               failed read is no cut.
//   3. KILLS    killsInSession keeps the kills of the session shown (and the two minutes the last row trails).
//   4. SOURCE   the replay route, the session list and the board use them.
//
// Names are invented tokens. Run: npx vitest run test/raid-cuts.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  MINUTE_MS, cutSession, defaultSessionIndex, killsInSession, sessionLabel, summarizeNights,
} from '../web/lib/raidReplay.ts';
import { LIVE_RECHECK_MS, MAX_COMPUTE, cutsKey, loadRaidCuts, parseStore } from '../web/lib/raidCuts.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

// ── data ─────────────────────────────────────────────────────────────────────

const rnd = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const crew = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}${i}`);
const pick = (members, salt) => members.filter((m, j) => rnd(salt, j + m.length) < 0.9);

/** One session's minute rows: `parts` = [[minutes, members], ...] starting at `startMs`, night_key from the start's Eastern date. */
function session(startMs, parts, night) {
  const rows = [];
  let t = startMs;
  for (const [count, members] of parts) {
    for (let i = 0; i < count; i++, t += MINUTE_MS) {
      const who = pick(members, t / MINUTE_MS);
      rows.push({
        guild_id: 'wolfpack', night_key: night, minute_at: new Date(t).toISOString(), zones: ['zonea'], raiders: who.length,
        data: JSON.stringify({ v: 1, who: who.map(n => [n]), zones: ['zonea'], f: [] }),
      });
    }
  }
  return rows;
}
const DAY = 86_400_000;
const NIGHT_A = Date.parse('2026-10-22T23:02:00Z');           // 7:02 PM ET
const twoRaids = (start, night) => session(start, [[260, crew('alder', 40)], [95, crew('birch', 18)]], night);
const oneRaid = (start, night) => session(start, [[330, crew('alder', 40)]], night);

// ── a fake PostgREST: select/eq/gte/lt/order/range/limit/maybeSingle/upsert, counting what is read ─────────────

function fake(initial) {
  const tables = { raid_track_minutes: initial.slice(), bot_kv: [] };
  const log = { dataReads: 0, upserts: 0, failData: false };
  const from = (table) => {
    const q = { cols: '', f: [], lo: 0, hi: Infinity, one: false };
    const run = () => {
      if (table === 'raid_track_minutes' && q.cols.includes('data')) {
        if (log.failData) return { data: null, error: { message: 'boom' } };
        log.dataReads++;
      }
      let rows = tables[table].filter(r => q.f.every(fn => fn(r)));
      rows = rows.sort((a, b) => String(a.minute_at ?? '').localeCompare(String(b.minute_at ?? '')));
      rows = rows.slice(q.lo, q.hi === Infinity ? undefined : q.hi + 1);
      const cols = q.cols.split(',').map(s => s.trim()).filter(Boolean);
      const proj = rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
      return { data: q.one ? (proj[0] ?? null) : proj, error: null };
    };
    const b = {
      select(c) { q.cols = c; return b; },
      eq(c, v) { q.f.push(r => r[c] === v); return b; },
      gte(c, v) { q.f.push(r => r[c] >= v); return b; },
      lt(c, v) { q.f.push(r => r[c] < v); return b; },
      order() { return b; },
      limit() { return b; },
      range(lo, hi) { q.lo = lo; q.hi = hi; return b; },
      maybeSingle() { q.one = true; return b; },
      upsert(row) {
        log.upserts++;
        const i = tables[table].findIndex(r => r.guild_id === row.guild_id && r.key === row.key);
        if (i >= 0) tables[table][i] = row; else tables[table].push(row);
        return Promise.resolve({ error: null });
      },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return b;
  };
  return { sb: { from }, tables, log };
}
const light = (rows) => rows.map(({ night_key, minute_at, zones, raiders }) => ({ night_key, minute_at, zones, raiders }));

// ── 1. the cut ───────────────────────────────────────────────────────────────

describe('cutSession / summarizeNights with cuts', () => {
  const rows = light(twoRaids(NIGHT_A, '10/22/2026'));
  const cutAt = NIGHT_A + 260 * MINUTE_MS;

  it('one gap-session is two sessions at the cut, together exactly the gap-session', () => {
    const [n0] = summarizeNights(rows.slice());
    expect(n0.sessions).toHaveLength(1);
    const [n] = summarizeNights(rows.slice(), [cutAt]);
    expect(n.sessions.map(s => [s.from, s.to, s.minutes])).toEqual([
      [NIGHT_A, cutAt, 260], [cutAt, n0.sessions[0].to, 95],
    ]);
    expect(n.sessions.every(s => s.raid)).toBe(true);
    expect(n.minutes).toBe(355);
  });

  it('reads as two raids in the picker, and the longer raid opens first', () => {
    const [n] = summarizeNights(rows.slice(), [cutAt]);
    const labels = n.sessions.map(sessionLabel);
    expect(labels[0]).toMatch(/^Raid · 7:02–11:22 PM/);
    expect(labels[1]).toMatch(/^Raid · 11:22 PM–12:57 AM/);
    expect(defaultSessionIndex(n.sessions)).toBe(0);
  });

  it('a cut outside the session, at its first minute, or a duplicate changes nothing more', () => {
    const [n0] = summarizeNights(rows.slice());
    for (const cuts of [[], [NIGHT_A - 5 * MINUTE_MS], [NIGHT_A], [n0.sessions[0].to + 60 * MINUTE_MS]]) {
      expect(summarizeNights(rows.slice(), cuts)[0].sessions).toHaveLength(1);
    }
    expect(summarizeNights(rows.slice(), [cutAt, cutAt])[0].sessions).toHaveLength(2);
  });

  it('several cuts make several sessions, every minute in exactly one', () => {
    const g = Array.from({ length: 100 }, (_, i) => ({ t: i * MINUTE_MS }));
    const parts = cutSession(g, [70 * MINUTE_MS, 30 * MINUTE_MS]);
    expect(parts.map(p => p.length)).toEqual([30, 40, 30]);
    expect(parts.flat()).toEqual(g);
  });
});

// ── 3. the kills of the session shown ────────────────────────────────────────

describe('killsInSession', () => {
  const kills = [100, 500, 1000, 1200].map(m => ({ atMs: m * MINUTE_MS, name: `k${m}` }));
  it('keeps what died inside the session, and the two minutes the last row trails', () => {
    expect(killsInSession(kills, 400 * MINUTE_MS, 1000 * MINUTE_MS).map(k => k.name)).toEqual(['k500', 'k1000']);
    expect(killsInSession(kills, 0, 99 * MINUTE_MS).map(k => k.name)).toEqual(['k100']);
    expect(killsInSession(kills, 0, 98 * MINUTE_MS).map(k => k.name)).toEqual([]);
    expect(killsInSession(kills, 1001 * MINUTE_MS, 2000 * MINUTE_MS).map(k => k.name)).toEqual(['k1200']);
  });
});

// ── 2. the loader ────────────────────────────────────────────────────────────

describe('loadRaidCuts', () => {
  it('cuts two raids back to back on the hand-over, stores it, and never reads a finished session again', async () => {
    const all = twoRaids(NIGHT_A + 30 * DAY, '11/21/2026');
    const now = NIGHT_A + 30 * DAY + 355 * MINUTE_MS + 3 * 60 * MINUTE_MS;   // three hours after it ended
    const f = fake(all);
    const cuts = await loadRaidCuts(f.sb, light(all), now);
    expect(cuts).toHaveLength(1);
    expect(Math.abs(cuts[0] - (NIGHT_A + 30 * DAY + 260 * MINUTE_MS))).toBeLessThanOrEqual(2 * MINUTE_MS);
    expect(f.log.upserts).toBe(1);
    const stored = f.tables.bot_kv[0];
    expect(stored.key).toBe(cutsKey('wolfpack'));
    expect(Object.keys(parseStore(stored.value).s)).toHaveLength(1);

    const reads = f.log.dataReads;
    expect(await loadRaidCuts(f.sb, light(all), now + 60_000)).toEqual(cuts);
    expect(f.log.dataReads).toBe(reads);
    expect(f.log.upserts).toBe(1);
  });

  it('one steady raid, a daytime group and a short session get no cut and no roster read', async () => {
    const day = session(Date.parse('2026-11-22T15:11:00Z'), [[150, crew('cedar', 12)], [60, crew('dune', 12)]], '11/22/2026');
    const steady = oneRaid(NIGHT_A + 31 * DAY, '11/22/2026');
    const short = session(NIGHT_A + 29 * DAY, [[30, crew('elm', 10)]], '11/20/2026');
    const f = fake([...day, ...steady, ...short]);
    const cuts = await loadRaidCuts(f.sb, light([...day, ...steady, ...short]), NIGHT_A + 31 * DAY + 8 * 60 * MINUTE_MS);
    expect(cuts).toEqual([]);
    expect(f.log.dataReads).toBeGreaterThan(0);   // the steady raid was examined ...
    const [n] = summarizeNights(light(steady), cuts);
    expect(n.sessions).toHaveLength(1);           // ... and left whole
  });

  it('a running session is worked out again at most every 5 minutes and is never stored', async () => {
    const start = NIGHT_A + 50 * DAY;
    const all = twoRaids(start, '12/11/2026');
    const now = start + 355 * MINUTE_MS + 5 * MINUTE_MS;   // last minute 5 minutes ago
    const f = fake(all);
    const first = await loadRaidCuts(f.sb, light(all), now);
    expect(first).toHaveLength(1);
    expect(f.log.upserts).toBe(0);
    // a minute is recorded after the first look: inside the 5 minutes it is not even asked for ...
    const grown = [...all, ...session(start + 355 * MINUTE_MS, [[1, crew('birch', 18)]], '12/11/2026')];
    f.tables.raid_track_minutes.push(grown[grown.length - 1]);
    const reads = f.log.dataReads;
    expect(await loadRaidCuts(f.sb, light(grown), now + LIVE_RECHECK_MS - 1000)).toEqual(first);
    expect(f.log.dataReads).toBe(reads);
    // ... and after them it is (only the unseen minute, through the roster cache), and the answer is the same
    expect(await loadRaidCuts(f.sb, light(grown), now + LIVE_RECHECK_MS + 1000)).toEqual(first);
    expect(f.log.dataReads).toBe(reads + 1);
    expect(f.log.upserts).toBe(0);
  });

  it(`works out at most ${MAX_COMPUTE} sessions a request, newest first, and the rest the next time`, async () => {
    const starts = [60, 61, 62].map(d => NIGHT_A + d * DAY);
    const all = starts.flatMap((s, i) => twoRaids(s, `12/${20 + i}/2026`));
    const now = starts[2] + 10 * 60 * MINUTE_MS;
    const f = fake(all);
    const first = await loadRaidCuts(f.sb, light(all), now);
    expect(first).toHaveLength(MAX_COMPUTE);
    expect(Math.min(...first)).toBeGreaterThan(starts[0] + DAY);   // the oldest is the one left for later
    const second = await loadRaidCuts(f.sb, light(all), now + 1000);
    expect(second).toHaveLength(3);
  });

  it('sessions older than 14 days are not worked out, and a failed read is no cut', async () => {
    const start = NIGHT_A + 80 * DAY;
    const all = twoRaids(start, '01/10/2027');
    const f = fake(all);
    expect(await loadRaidCuts(f.sb, light(all), start + 20 * DAY)).toEqual([]);
    expect(f.log.dataReads).toBe(0);
    const g = fake(twoRaids(NIGHT_A + 90 * DAY, '01/20/2027'));
    g.log.failData = true;
    expect(await loadRaidCuts(g.sb, light(twoRaids(NIGHT_A + 90 * DAY, '01/20/2027')), NIGHT_A + 90 * DAY + DAY)).toEqual([]);
    expect(g.log.upserts).toBe(0);
  });

  it('a malformed stored value is an empty store', () => {
    for (const bad of [null, undefined, {}, { s: 5 }, { s: { x: { to: 1, cuts: [] } } }, { s: { 1: { to: 'a', cuts: [] } } }, { s: { 1: { to: 1, cuts: ['a'] } } }]) {
      expect(parseStore(bad).s).toEqual({});
    }
    expect(parseStore({ s: { 7: { to: 9, cuts: [3] } } }).s).toEqual({ 7: { to: 9, cuts: [3] } });
  });
});

// ── 4. source ────────────────────────────────────────────────────────────────

describe('source', () => {
  it('the replay route and the session list split on raid changes', () => {
    const route = read('web/app/api/spectator/replay/route.ts');
    expect(route).toMatch(/loadRaidCuts\(admin, rows\)/);
    expect(route).toMatch(/summarizeNights\(rows, cuts\)/);
    const page = read('web/app/raid/session/page.tsx');
    expect(page).toMatch(/loadRaidCuts\(supabaseAdmin\(\), rows\)/);
    expect(page).toMatch(/summarizeNights\(rows, cuts\)/);
  });

  it('the board hands the timeline the session\'s kills, and only the newest session is grown by the live tail', () => {
    const board = read('web/app/spectator/replay/ReplayBoard.tsx');
    expect(board).toMatch(/<RaidTimeline kills=\{sessionKills\} nowMs=\{uiT\}/);
    expect(board).not.toMatch(/<RaidTimeline kills=\{killList\}/);
    expect(board).toMatch(/killsInSession\(killList, Date\.parse\(night\.first\)/);
    expect(board).toMatch(/picked === n\.sessions\[n\.sessions\.length - 1\] \? growSession\(picked, tailLast\) : picked/);
  });

  it('the roster is read only through the shared, paged, windowed reader', () => {
    const who = read('web/lib/raidWho.ts');
    expect(who).toMatch(/\.gte\('minute_at', lo\)\.lt\('minute_at', hi\)/);
    expect(who).toMatch(/\.range\(from, to\)/);
    const cuts = read('web/lib/raidCuts.ts');
    expect(cuts).not.toMatch(/from\('raid_track_minutes'\)/);
  });
});
