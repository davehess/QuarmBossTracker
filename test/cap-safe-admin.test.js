// test/cap-safe-admin.test.js — the admin pages read COMPLETE data, not the first 1,000 rows.
//
// PostgREST returns at most 1,000 rows per response and says nothing. `.limit(20000)` does not raise
// that. The admin queue banner (every admin page), /admin/analytics, /admin/members and
// /admin/triggers counted big windows of rows in JS, so on 2026-10-04 each figure came from the first
// 1,000 rows the planner returned (the guild lead: "review all of the other tables for silent 500 or 100
// caps"). They now read Postgres aggregates that answer with ONE jsonb value (a scalar, which no row cap
// applies to) or page with selectAll.
//
// How this proves it, in order of how much it can be trusted:
//   · The loaders RUN against test/_postgrest-fake.js, a client that enforces the silent cap, refuses
//     paging on a non-unique order and refuses an RPC whose argument names differ from the migration's.
//     The fixtures are bigger than the cap (1,100 roster rows, 1,600 upload rows, 3,900 chat lines,
//     293 encounters with 1,400+ player rows) and put the rows that matter LAST, where the real
//     gateway dropped them. No read may end short (`calls.dropped`).
//   · The pure rules (windows, folds, tallies) are checked against the code they replaced.
//   · The migration is checked on its text (stripSql: its header names every table it avoids): every
//     function returns one jsonb, is invoker-security and service_role-only.
//   · The SQL itself was run against a Postgres with volumes past 1,000 and compared with the old
//     page aggregation (see the commit message); that is not repeatable in CI, which has no Postgres.
//
// Run: npx vitest run test/cap-safe-admin.test.js

import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import { ROOT, readSource, stripJs, stripSql } from './_source-slice.js';
import { makeFake, parseSignatures, PGRST_MAX_ROWS } from './_postgrest-fake.js';
import {
  newestUploadPerName, mergeWindows, chatEvidenceWindows, combatWindows, foldTimesByFamily,
} from '../web/lib/adminQueueData.ts';
import { rpcJson } from '../web/lib/rpcJson.ts';
import { dailyVolume, topViewers, loadPageViewStats } from '../web/lib/pageViewStats.ts';
import { countsByDiscord, charsSeenByUploader, readWhoActivity } from '../web/lib/memberActivity.ts';
import { foldFeedback, loadFeedbackRollup, loadGuildTriggers } from '../web/lib/triggerFeedback.ts';

// admin-queue.ts imports the `@/` alias and next/cache; give it the real eras and a pass-through cache.
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: () => { throw new Error('the test passes its own client'); } }));
vi.mock('@/lib/eras', async () => await import('../web/lib/eras.ts'));
// `next/cache` resolves differently by machine (CI installs only the root dependencies): register both ids.
const nextCache = { unstable_cache: (fn) => fn };
vi.doMock('next/cache', () => nextCache);
try {
  vi.doMock(createRequire(new URL('../web/package.json', import.meta.url)).resolve('next/cache'), () => nextCache);
} catch { /* web/ not installed here */ }
const { loadAdminQueueWith } = await import('../web/lib/admin-queue.ts');

const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261004140400_cap_safe_admin.sql');
const sql = stripSql(readSource(MIGRATION));
const SIGNATURES = { ...parseSignatures(sql), chat_attribution_conflicts: ['p_days'] };

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const lower = (s) => String(s).toLowerCase();

// Letters-only names (the unregistered-upload filter wants /^[A-Za-z]{3,20}$/), sortable by index.
const alpha = (i, w = 4) => { let s = ''; for (let k = 0; k < w; k++) { s = String.fromCharCode(97 + (i % 26)) + s; i = Math.floor(i / 26); } return s; };
const spk = (i) => 'Spk' + alpha(i);
const upl = (i) => 'Upl' + alpha(i);

// ── The SQL, as JS: what each function returns for the fixture tables ──────────────────────────────
// (Verified against real Postgres separately; these are the reference the TypeScript is run against.)
const impls = {
  admin_queue_chat_speakers: ({ p_since }, t) => {
    const m = new Map();
    for (const r of t.chat_messages) {
      if (!['guild', 'raid'].includes(r.channel) || !(r.ts > p_since)) continue;
      const c = m.get(r.speaker) ?? { n: 0, last: r.ts };
      c.n++; if (r.ts > c.last) c.last = r.ts;
      m.set(r.speaker, c);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([speaker, c]) => ({ speaker, n: c.n, last: c.last }));
  },
  admin_queue_who_class_known: ({ p_names, p_since }, t) => {
    const known = new Set();
    for (const r of t.who_observations) if (r.observed_at > p_since && r.anonymous === false && r.class != null) known.add(lower(r.character));
    return [...new Set(p_names.filter(Boolean).map(lower))].filter(n => known.has(n)).sort();
  },
  who_latest_per_character: ({ p_guild, p_names }, t) => {
    const newest = new Map();
    for (const r of t.who_observations) {
      if (r.guild_id !== p_guild) continue;
      const k = lower(r.character), cur = newest.get(k);
      if (!cur || r.observed_at > cur.observed_at || (r.observed_at === cur.observed_at && r.id > cur.id)) newest.set(k, r);
    }
    return [...new Set(p_names.filter(Boolean).map(lower))].sort().filter(n => newest.has(n))
      .map(n => ({ character: n, level: newest.get(n).level, class: newest.get(n).class, observed_at: newest.get(n).observed_at }));
  },
  admin_queue_chat_times: ({ p_speakers, p_since, p_lo, p_hi }, t) => {
    const want = new Set(p_speakers.filter(Boolean).map(lower));
    const out = {};
    for (const r of t.chat_messages) {
      if (!['guild', 'raid'].includes(r.channel) || r.ts < p_since || !want.has(lower(r.speaker))) continue;
      if (!p_lo.some((lo, i) => r.ts >= lo && r.ts <= p_hi[i])) continue;
      (out[lower(r.speaker)] ??= []).push(Date.parse(r.ts));
    }
    return out;
  },
  admin_queue_combat_times: ({ p_guild, p_names, p_lo, p_hi }, t) => {
    const want = new Set(p_names);
    const encs = new Map(t.encounters.filter(e => e.guild_id === p_guild && p_lo.some((lo, i) => e.started_at >= lo && e.started_at <= p_hi[i]))
      .map(e => [e.id, e]));
    const out = {};
    for (const ep of t.encounter_players) {
      const e = encs.get(ep.encounter_id);
      if (e && want.has(ep.character_name)) (out[lower(ep.character_name)] ??= []).push(Date.parse(e.started_at));
    }
    return out;
  },
  chat_attribution_conflicts: () => [],
};

const KEYS = {
  characters: ['guild_id', 'name'],
  agent_upload_stats: ['guild_id', 'character', 'endpoint'],
  opendkp_attendance_recent: ['character_name'],
  guild_triggers: ['id'],
};

// ═══ The review queue, end to end, against data past the cap ═════════════════════════════════════
function buildWorld(NOW) {
  const chars = [], attendance = [], chat = [], who = [], uploads = [];
  let whoId = 0;
  const addWho = (character, level, cls, anonymous, at, guild = 'wolfpack') =>
    who.push({ id: ++whoId, guild_id: guild, character, level, class: cls, anonymous, observed_at: iso(at) });
  const char = (name, extra = {}) => chars.push({ guild_id: 'wolfpack', name, class: null, rank: null, main_name: null, discord_id: null, opendkp_id: null, registered_via_web_at: null, registered_via_web_by_discord_id: null, ...extra });

  // 1,000 speakers who ARE in OpenDKP: half through characters.opendkp_id, half only through the attendance view.
  for (let i = 0; i < 1000; i++) char(spk(i), { class: 'Cleric', opendkp_id: i < 500 ? i + 1 : null });
  // (the ones that matter go LAST, where an unordered read cut at 1,000 rows loses them)
  for (let i = 0; i < 600; i++) attendance.push({ character_name: 'Att' + alpha(i) });
  for (let i = 500; i < 1000; i++) attendance.push({ character_name: spk(i) });
  // 300 speakers who are NOT: 100 on the roster with a class, 80 with a /who class, 20 /anon-only, 100 unknown.
  for (let i = 1000; i < 1100; i++) char(spk(i), { class: 'Monk' });
  for (let i = 1100; i < 1180; i++) { addWho(spk(i), 50, 'Wizard', false, NOW - 5 * DAY); addWho(spk(i), 51, 'Wizard', false, NOW - 4 * DAY); }
  for (let i = 1180; i < 1200; i++) addWho(spk(i), null, null, true, NOW - 2 * DAY);
  // Three characters an officer registered through the web and nobody has claimed yet.
  for (let i = 0; i < 3; i++) char('Reg' + alpha(i), { registered_via_web_at: iso(NOW - (i + 1) * DAY), registered_via_web_by_discord_id: '9', opendkp_id: 7000 + i });

  // 3,900 chat lines in the last 14 days (3 a speaker), the first 1,000 of them by people already settled.
  for (let i = 0; i < 1300; i++) for (let k = 0; k < 3; k++) chat.push({ ts: iso(NOW - DAY - (i * 3 + k) * 30_000), channel: k % 2 ? 'raid' : 'guild', speaker: spk(i) });

  // Characters streaming from a Mimic: 300 unregistered x 5 endpoints = 1,500 rows, plus 100 registered ones and junk.
  const endpoints = ['bosskill', 'buff_casts', 'chat', 'encounter', 'live_state'];
  for (let i = 0; i < 300; i++) endpoints.forEach((e, k) => uploads.push({
    guild_id: 'wolfpack', character: upl(i), endpoint: e, uploaded_by_discord_id: '111',
    // 'encounter' (alphabetically 4th) is the newest, so "first row wins" would report an older time
    last_uploaded_at: iso(NOW - (i * 1000 + (k === 3 ? 0 : (k + 1) * 600)) * 1000),
  }));
  for (let i = 0; i < 100; i++) uploads.push({ guild_id: 'wolfpack', character: spk(i), endpoint: 'encounter', uploaded_by_discord_id: '111', last_uploaded_at: iso(NOW - 1000) });
  uploads.push({ guild_id: 'wolfpack', character: 'op-stream', endpoint: 'chat', uploaded_by_discord_id: '111', last_uploaded_at: iso(NOW) });
  uploads.push({ guild_id: 'wolfpack', character: 'Ab', endpoint: 'chat', uploaded_by_discord_id: '111', last_uploaded_at: iso(NOW) });
  // Their /who history, behind 3,000 rows of noise: newest-first reads of the whole table never reach it.
  for (let i = 0; i < 3000; i++) addWho('Noise' + alpha(i), 40, 'Rogue', false, NOW - 20 * DAY);
  for (let i = 0; i < 40; i++) { addWho(upl(i), 20, 'Cleric', false, NOW - 9 * DAY); addWho(upl(i), 55, 'Bard', false, NOW - 3 * DAY); }
  for (let i = 40; i < 50; i++) { addWho(upl(i), 52, 'Druid', false, NOW - 8 * DAY); addWho(upl(i), null, null, true, NOW - 1 * DAY); }
  for (let i = 50; i < 55; i++) addWho(upl(i), 30, 'Monk', false, NOW - 6 * DAY);

  // ── missed raid ticks ──
  const RAID = NOW - 3 * DAY;
  const raidTs = iso(RAID);
  const fam = ['Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Aldenmar'];
  for (const f of fam) char(f, { class: 'Warrior', opendkp_id: 8000 + fam.indexOf(f) });
  const tick = (id, description, attendees) => ({ raid_id: 1, tick_id: id, description, value: 1, attendees });
  const ticks = [
    tick(1, 'Tick 1 (Raid Start)', ['Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Aldenmar', 'Zfiller']),
    tick(2, 'Tick 2 (1 Hour)',     ['Corvale', 'Rethlan', 'Nyssara', 'Aldenmar', 'Zfiller']),      // Zarrin: the gap
    tick(3, 'Tick 3 (2 Hour)',     ['Zarrin', 'Zfiller']),                                          // the other three left
    tick(4, 'Tick 4 (Raid End)',   ['Zarrin', 'Zfiller']),
  ];
  // 293 encounters inside the raid window, 5 players each (1,465 rows), then the one that matters, LAST.
  const encounters = [], players = [];
  for (let i = 0; i < 293; i++) {
    const id = 'enc-' + alpha(i);
    encounters.push({ id, guild_id: 'wolfpack', started_at: iso(RAID + i * MIN) });
    for (let k = 0; k < 5; k++) players.push({ encounter_id: id, character_name: 'Fill' + alpha(i * 5 + k) });
  }
  players.push({ encounter_id: 'enc-' + alpha(200), character_name: 'Corvale' });     // 3h20m in: after the 2 Hour tick, in the end-of-raid window
  // Chat after the 3,900 lines above. Rethlan was talking at +3h05m (within 20 minutes of the Raid End tick)
  // and +4h; Nyssara only at +8h (after the window) and 20 days before.
  chat.push({ ts: iso(RAID + 3 * HOUR + 5 * MIN), channel: 'guild', speaker: 'Rethlan' });
  chat.push({ ts: iso(RAID + 4 * HOUR), channel: 'guild', speaker: 'Rethlan' });
  // Aldenmar's only sign of life is 5h30m in, inside the six-hour end-of-raid window and past anything shorter.
  chat.push({ ts: iso(RAID + 5 * HOUR + 30 * MIN), channel: 'guild', speaker: 'Aldenmar' });
  chat.push({ ts: iso(RAID + 8 * HOUR), channel: 'guild', speaker: 'Nyssara' });
  chat.push({ ts: iso(RAID - 20 * DAY), channel: 'raid', speaker: 'Nyssara' });

  return {
    chars, attendance, chat, who, uploads, ticks, encounters, players,
    raids: [{ raid_id: 1, ts: raidTs, name: 'Raid One' }],
    expected: { raidTs },
  };
}

function worldFake(w, { impl = impls } = {}) {
  return makeFake({
    tables: {
      characters: w.chars, opendkp_attendance_recent: w.attendance, chat_messages: w.chat,
      who_observations: w.who, agent_upload_stats: w.uploads, opendkp_raids: w.raids,
      opendkp_ticks: w.ticks, encounters: w.encounters, encounter_players: w.players,
    },
    keys: KEYS, impls: impl, signatures: SIGNATURES,
  });
}

describe('the review queue reads complete data', () => {
  const NOW = Date.now();
  const world = buildWorld(NOW);
  // The fixtures really are past the cap, or none of this proves anything.
  it('the fixtures exceed the 1,000-row cap on every table the old code read', () => {
    expect(world.chars.length).toBeGreaterThan(PGRST_MAX_ROWS);
    expect(world.attendance.length).toBeGreaterThan(PGRST_MAX_ROWS);
    expect(world.uploads.length).toBeGreaterThan(PGRST_MAX_ROWS);
    expect(world.chat.length).toBeGreaterThan(3 * PGRST_MAX_ROWS);
    expect(world.who.length).toBeGreaterThan(3 * PGRST_MAX_ROWS);
    expect(world.players.length).toBeGreaterThan(PGRST_MAX_ROWS);
  });

  const fake = worldFake(world);
  const result = loadAdminQueueWith(fake);
  const cat = async (id) => (await result).categories.find(c => c.id === id);

  it('chat speakers missing from OpenDKP: all 300, not the ones in the first 1,000 chat lines', async () => {
    const c = await cat('unrostered_chat');
    expect(c.count).toBe(300);
    // each spoke 3 times, and `last` is the newest line, not the first one met
    const one = c.items.find(i => i.key === lower(spk(1250)));
    expect(one.count).toBe(3);
    expect(one.detail).toBe('3 messages');
    const newest = Math.max(...world.chat.filter(m => m.speaker === spk(1250)).map(m => Date.parse(m.ts)));
    expect(Date.parse(one.last)).toBe(newest);
  });

  it('the roster read is paged: attendance rows past 1,000 still count as rostered', async () => {
    const c = await cat('unrostered_chat');
    // Spk0500..0999 are in OpenDKP only through the attendance view, which sorts after the 600 'Att' names:
    // a read cut at 1,000 rows never reaches Spk0900..0999.
    expect(c.items.some(i => i.key === lower(spk(999)))).toBe(false);
    expect(c.items.some(i => i.key === lower(spk(500)))).toBe(false);
  });

  it('speakers with no class signal: the roster read is paged, and /who is asked by name', async () => {
    const c = await cat('unenrichable_chat');
    // 20 /anon-only + 100 nobody knows. The 100 with a roster class sit past row 1,000 of the roster;
    // the 80 with a /who class are known only to the by-name /who question.
    expect(c.count).toBe(120);
    const keys = new Set(c.items.map(i => i.key));
    expect(keys.has(lower(spk(1050)))).toBe(false);   // roster class, row > 1,000
    expect(keys.has(lower(spk(1150)))).toBe(false);   // /who class
    expect(keys.has(lower(spk(1190)))).toBe(true);    // only ever /anon
    expect(keys.has(lower(spk(1250)))).toBe(true);    // never seen
  });

  it('characters not in OpenDKP: every upload row is read, each name once with its NEWEST upload', async () => {
    const c = await cat('unregistered_opendkp');
    expect(c.count).toBe(300);
    const keys = new Set(c.items.map(i => i.key));
    expect(keys.has('op-stream')).toBe(false);
    expect(keys.has('ab')).toBe(false);
    expect(keys.has(lower(spk(5)))).toBe(false);      // registered
    const item = c.items.find(i => i.key === lower(upl(7)));
    expect(item.last).toBe(iso(NOW - 7 * 1000 * 1000));            // the 'encounter' row, not the first endpoint's
  });

  it('their level and class come from each name\'s newest /who row, not the newest 3,000 rows of all', async () => {
    const c = await cat('unregistered_opendkp');
    const by = (i) => c.items.find(x => x.key === lower(upl(i))).detail;
    expect(by(3)).toBe('L55 Bard · Raid Alt');             // the newer of two rows
    expect(by(52)).toBe('L30 Monk · Non-raid Alt');
    expect(by(45)).toBe('L? class? · rank?');              // newest row is /anon: reported as it is
    expect(by(200)).toBe('L? class? · rank?');              // never /who'd
  });

  it('awaiting claim still lists the three registered characters', async () => {
    expect((await cat('awaiting_opendkp_claim')).count).toBe(3);
  });

  it('missed ticks: combat and chat evidence is found through the windows, past every cap', async () => {
    const c = await cat('missing_ticks');
    const by = Object.fromEntries(c.items.map(i => [i.label, i.count]));
    // Corvale: combat 3h20m in (the 293-encounter raid, last of 1,466 player rows) proves the 2 Hour and Raid End ticks.
    // Rethlan: chat at +3h05m and +4h. Aldenmar: chat at +5h30m, the far end of the window. Zarrin: an interior
    // gap, no evidence needed. Nyssara: chat only after the window and long before it, so nothing proves she was there.
    expect(by).toEqual({ Corvale: 2, Rethlan: 2, Aldenmar: 2, Zarrin: 1 });
    const lines = (name) => c.items.find(i => i.label === name).lines;
    expect(lines('Corvale').find(l => l.includes('Raid End'))).toContain('⚔ in combat');
    // the chip needs chat within 20 minutes of the tick: the Raid End tick (+3h) has it, the 2 Hour tick does not
    expect(lines('Rethlan').find(l => l.includes('Raid End'))).toContain('💬 chatting');
    expect(lines('Rethlan').find(l => l.includes('2 Hour'))).not.toContain('💬 chatting');
  });

  it('no read ended short of what it matched, and no big window is read as rows', async () => {
    await result;
    expect(fake.calls.dropped).toEqual([]);
    const direct = new Set(fake.calls.reads.map(r => r.table));
    for (const t of ['chat_messages', 'who_observations', 'encounters', 'encounter_players']) {
      expect(direct.has(t), `${t} must come from an aggregate, not a row read`).toBe(false);
    }
    // the big roster reads are PAGED: more than one request, none asking past the cap
    const paged = fake.calls.reads.filter(r => r.table === 'characters' && r.ranged);
    expect(paged.length).toBeGreaterThan(1);
    for (const r of fake.calls.reads) expect(r.returned).toBeLessThanOrEqual(PGRST_MAX_ROWS);
  });

  it('the evidence comes from ONE chat call and ONE combat call, with only the windows asked for', async () => {
    await result;
    const chat = fake.calls.rpcs.filter(r => r.name === 'admin_queue_chat_times');
    const combat = fake.calls.rpcs.filter(r => r.name === 'admin_queue_combat_times');
    expect(chat).toHaveLength(1);
    expect(combat).toHaveLength(1);
    expect(chat[0].args.p_lo).toHaveLength(1);                       // one raid, one merged window
    expect(Date.parse(chat[0].args.p_hi[0]) - Date.parse(chat[0].args.p_lo[0])).toBe(6 * HOUR + 20 * MIN);
  });

  it('the speaker aggregate is asked once and shared by both chat categories', async () => {
    await result;
    expect(fake.calls.rpcs.filter(r => r.name === 'admin_queue_chat_speakers')).toHaveLength(1);
  });

  it('an RPC the database does not have reads as empty, never as a crash on every admin page', async () => {
    const f = worldFake(buildWorld(NOW), { impl: { ...impls, admin_queue_chat_speakers: undefined } });
    const q = await loadAdminQueueWith(f);
    expect(q.categories.find(c => c.id === 'unrostered_chat').count).toBe(0);
    expect(q.categories.find(c => c.id === 'awaiting_opendkp_claim').count).toBe(3);
  });
});

// ═══ The pure rules, against the code they replaced ═════════════════════════════════════════════
describe('newestUploadPerName', () => {
  const row = (character, at, by = '1') => ({ character, uploaded_by_discord_id: by, last_uploaded_at: at });
  it('keeps one entry per name with the newest upload across endpoints', () => {
    const out = newestUploadPerName([
      row('Aldenmar', '2026-10-01T00:00:00Z'), row('aldenmar', '2026-10-03T00:00:00Z'), row('Aldenmar', '2026-10-02T00:00:00Z'),
    ], () => false);
    expect(out).toEqual([{ name: 'aldenmar', last: '2026-10-03T00:00:00Z' }]);
  });
  it('drops operator streams, short names, rostered names and rows with no uploader', () => {
    const out = newestUploadPerName([
      row('op-stream', null), row('Ab', null), row('Rostered', null), row('Brackwyn', null, null), row('Nyssara', null),
    ], k => k === 'rostered');
    expect(out.map(o => o.name)).toEqual(['Nyssara']);
  });
  it('a name with no timestamp takes the first real one', () => {
    expect(newestUploadPerName([row('Zarrin', null), row('Zarrin', '2026-10-01T00:00:00Z')], () => false))
      .toEqual([{ name: 'Zarrin', last: '2026-10-01T00:00:00Z' }]);
  });
});

describe('time windows', () => {
  const W = (lo, hi) => ({ lo, hi });
  it('mergeWindows joins overlapping and touching spans, sorts, and drops garbage', () => {
    expect(mergeWindows([W(10, 20), W(0, 5), W(5, 8), W(15, 30), W(50, 60), W(NaN, 3), W(9, 2)]))
      .toEqual([W(0, 8), W(10, 30), W(50, 60)]);
    expect(mergeWindows([])).toEqual([]);
  });
  it('combatWindows is ten minutes before a raid to six hours after, merged', () => {
    const t = Date.parse('2026-09-27T12:00:00Z');
    expect(combatWindows(['2026-09-27T12:00:00Z'])).toEqual([W(t - 10 * MIN, t + 6 * HOUR)]);
    expect(combatWindows(['2026-09-27T12:00:00Z', '2026-09-27T14:00:00Z'])).toHaveLength(1);
    expect(combatWindows(['2026-09-27T12:00:00Z', '2026-09-30T12:00:00Z'])).toHaveLength(2);
  });

  // The ranges the missed-tick check ASKS about for a candidate (admin-queue.ts, "Resolve candidates").
  const consulted = (c) => {
    const out = [];
    const raidLo = Date.parse(c.raidTs), raidHi = raidLo + 6 * HOUR;
    const tt = c.tickTime ? Date.parse(c.tickTime) : null;
    if (tt != null) out.push([tt - 20 * MIN, tt + 20 * MIN]);
    if (c.kind !== 'interior') {
      const lo = c.kind === 'leading' ? raidLo : (tt != null ? tt - 20 * MIN : raidLo);
      const hi = c.kind === 'leading' ? (tt != null ? tt + 20 * MIN : raidHi) : raidHi;
      out.push([lo, hi]);
    }
    return out;
  };
  let s = 20260;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const base = Date.parse('2026-09-20T12:00:00Z');
  const cands = Array.from({ length: 400 }, () => {
    const raidTs = iso(base + Math.floor(rnd() * 5) * DAY);
    const k = Math.floor(rnd() * 8);                                      // 0..5 hours, or no relative anchor
    return {
      raidTs, kind: ['interior', 'leading', 'trailing'][Math.floor(rnd() * 3)],
      tickTime: k > 5 ? null : iso(Date.parse(raidTs) + k * HOUR),
    };
  });
  it('every range the check asks about lies inside the windows fetched for its candidate', () => {
    let checked = 0;
    for (const c of cands) {
      const windows = chatEvidenceWindows([c]);
      expect(windows).toHaveLength(1);
      for (const [lo, hi] of consulted(c)) {
        expect(windows[0].lo, JSON.stringify({ c, lo })).toBeLessThanOrEqual(lo);
        expect(windows[0].hi, JSON.stringify({ c, hi })).toBeGreaterThanOrEqual(hi);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
  });
  it('and a lone chat line anywhere in a consulted range is still found from the merged windows', () => {
    const windows = chatEvidenceWindows(cands);
    let found = 0;
    for (const c of cands) for (const [lo, hi] of consulted(c)) {
      for (const t of [lo, hi, lo + Math.floor(rnd() * (hi - lo))]) {      // both edges (inclusive) and a random inside point
        expect(windows.some(w => t >= w.lo && t <= w.hi), JSON.stringify({ c, t })).toBe(true);
        found++;
      }
    }
    expect(found).toBeGreaterThan(1200);
    // ...while the read is genuinely narrower than the 30 days it replaced
    const span = windows.reduce((a, w) => a + (w.hi - w.lo), 0);
    expect(span).toBeLessThan(5 * 12 * HOUR);
  });
  it('a late tick (past six hours) widens its window instead of losing its chat', () => {
    const raidTs = '2026-09-27T12:00:00Z';
    const t = Date.parse(raidTs);
    const [w] = chatEvidenceWindows([{ raidTs, tickTime: iso(t + 9 * HOUR) }]);
    expect(w.hi).toBe(t + 9 * HOUR + 20 * MIN);
    expect(w.lo).toBe(t - 20 * MIN);
  });
});

describe('foldTimesByFamily', () => {
  it('appends per-name times to the family list and drops names with no family', () => {
    const into = new Map([['f1', [1]]]);
    foldTimesByFamily({ aldenmar: [2, 3], brackwyn: [4], stranger: [9] }, new Map([['aldenmar', 'f1'], ['brackwyn', 'f1']]), into);
    expect(into).toEqual(new Map([['f1', [1, 2, 3, 4]]]));
  });
});

describe('rpcJson', () => {
  it('returns the fallback and logs when the call fails; a null answer is the fallback too', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = { rpc: async () => ({ data: null, error: { message: 'boom' } }) };
    expect(await rpcJson(bad, 'f', {}, ['x'])).toEqual(['x']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await rpcJson({ rpc: async () => ({ data: null, error: null }) }, 'f', {}, [])).toEqual([]);
    spy.mockRestore();
  });
});

// ═══ /admin/analytics ═══════════════════════════════════════════════════════════════════════════
describe('/admin/analytics', () => {
  const stats = {
    total: 12242, unique_viewers: 38, routes_seen: 822, paths_seen: 2435,
    top_routes: [{ route: '/me', count: 900, uniques: 30 }],
    top_paths: [{ path: '/me', count: 900, uniques: 30 }],
    top_users: [{ user_id: '11111111-aaaa', count: 500, last_seen: '2026-10-04T16:00:00+00:00' }, { user_id: '22222222-bbbb', count: 5, last_seen: '2026-10-03T00:00:00+00:00' }],
    by_day: [{ day: '2026-10-04', count: 1031 }, { day: '2026-09-30', count: 4000 }],
  };
  const fake = makeFake({ impls: { page_view_stats: () => stats }, signatures: SIGNATURES });

  it('the whole range comes back as one answer, with the argument name the migration declares', async () => {
    const s = await loadPageViewStats(fake, '2026-09-27T00:00:00.000Z');
    expect(s.total).toBe(12242);                      // not the 1,000 a plain read returned
    expect(s.routes_seen).toBe(822);
    expect(fake.calls.rpcs).toEqual([{ name: 'page_view_stats', args: { p_since: '2026-09-27T00:00:00.000Z' } }]);
  });

  it('a failed call is an empty range, not a crash and not a partial object', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await loadPageViewStats(makeFake({ signatures: SIGNATURES }), 'x');
    expect(s).toEqual({ total: 0, unique_viewers: 0, routes_seen: 0, paths_seen: 0, top_routes: [], top_paths: [], top_users: [], by_day: [] });
    spy.mockRestore();
  });

  it('topViewers names a viewer from the member table, else the first 8 characters of the id', () => {
    const rows = topViewers(stats.top_users, new Map([['11111111-aaaa', 'Aldenmar']]));
    expect(rows).toEqual([
      { name: 'Aldenmar', count: 500, lastSeen: '2026-10-04T16:00:00+00:00' },
      { name: '22222222', count: 5, lastSeen: '2026-10-03T00:00:00+00:00' },
    ]);
  });

  it('dailyVolume has one bar per day of the range, oldest first, zero where nothing was logged', () => {
    const now = Date.parse('2026-10-04T18:00:00Z');
    const days = dailyVolume(stats.by_day, 7, now);
    expect(days.map(d => d.day)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(days.map(d => d.count)).toEqual([0, 0, 4000, 0, 0, 0, 1031]);
    expect(dailyVolume([], 1, now)).toEqual([{ day: '2026-10-04', count: 0 }]);
  });
});

// ═══ /admin/members ═════════════════════════════════════════════════════════════════════════════
describe('/admin/members', () => {
  // The loop the page ran over 1,000 sampled rows, for the same counts over all of them.
  const old = (chatRows, contribRows, whoRows, charToDiscord) => {
    const chat = new Map(), parse = new Map(), who = new Map();
    for (const m of chatRows) { const d = charToDiscord.get((m.speaker || '').toLowerCase()); if (d) chat.set(d, (chat.get(d) ?? 0) + 1); }
    for (const c of contribRows) { const d = c.contributor_discord_id || charToDiscord.get((c.contributor_character || '').toLowerCase()); if (d) parse.set(d, (parse.get(d) ?? 0) + 1); }
    for (const w of whoRows) { const d = charToDiscord.get((w.character || '').toLowerCase()); if (d) who.set(d, (who.get(d) ?? 0) + 1); }
    return { chat, parse, who };
  };
  const group = (rows, keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); m.set(k, (m.get(k) ?? 0) + 1); } return m; };

  it('counts per member equal the old row-by-row counts over the same rows', () => {
    let s = 7;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const names = ['Aldenmar', 'ALDENMAR', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Stranger'];
    const pick = () => names[Math.floor(rnd() * names.length)];
    const chatRows = Array.from({ length: 3000 }, () => ({ speaker: pick() }));
    const contribRows = Array.from({ length: 2000 }, () => ({
      contributor_discord_id: rnd() < 0.5 ? 'd' + Math.floor(rnd() * 4) : (rnd() < 0.2 ? '' : null),
      contributor_character: rnd() < 0.85 ? pick() : null,
    }));
    const whoRows = Array.from({ length: 4000 }, () => ({ character: pick() }));
    const charToDiscord = new Map([['aldenmar', 'dA'], ['brackwyn', 'dB'], ['corvale', 'dC'], ['zarrin', 'dZ']]);

    const exp = old(chatRows, contribRows, whoRows, charToDiscord);
    // what the three functions return: counts per lower-cased speaker / (id, lower-cased character) / roster character
    const chat = [...group(chatRows, r => r.speaker.toLowerCase())].map(([speaker, n]) => ({ speaker, n }));
    const contrib = [...group(contribRows, r => `${r.contributor_discord_id ?? ''}\u0001${r.contributor_character == null ? '' : r.contributor_character.toLowerCase()}`)]
      .map(([k, n]) => { const [d, c] = k.split('\u0001'); return { discord_id: d === '' ? null : d, character: c === '' ? null : c, n }; });
    const targets = [...group(whoRows, r => r.character.toLowerCase())].map(([character, n]) => ({ character, n }));
    const got = countsByDiscord(chat, contrib, targets, charToDiscord);
    expect(got.chatCount).toEqual(exp.chat);
    expect(got.parseCount).toEqual(exp.parse);
    expect(got.whoCount).toEqual(exp.who);
    expect([...exp.chat.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(PGRST_MAX_ROWS);
  });

  it('a contribution takes its Discord id when it has one, else its roster character', () => {
    const r = countsByDiscord([], [
      { discord_id: 'dX', character: 'aldenmar', n: 2 }, { discord_id: null, character: 'aldenmar', n: 3 }, { discord_id: null, character: null, n: 9 },
    ], [], new Map([['aldenmar', 'dA']]));
    expect(r.parseCount).toEqual(new Map([['dX', 2], ['dA', 3]]));
  });

  it('charsSeenByUploader lower-cases the uploader and de-duplicates its characters', () => {
    expect(charsSeenByUploader({ Bob: ['aldenmar', 'aldenmar', 'brackwyn'] }))
      .toEqual(new Map([['bob', new Set(['aldenmar', 'brackwyn'])]]));
  });

  it('readWhoActivity asks with the migration\'s argument names and tolerates a missing half', async () => {
    const f = makeFake({ impls: { admin_members_who_counts: () => ({ targets: [{ character: 'aldenmar', n: 4 }] }) }, signatures: SIGNATURES });
    expect(await readWhoActivity(f, 'wolfpack', '2026-09-04T00:00:00.000Z', ['bob'])).toEqual({ targets: [{ character: 'aldenmar', n: 4 }], seen: {} });
    expect(f.calls.rpcs[0].args).toEqual({ p_guild: 'wolfpack', p_since: '2026-09-04T00:00:00.000Z', p_uploaders: ['bob'] });
  });
});

// ═══ /admin/triggers ════════════════════════════════════════════════════════════════════════════
describe('/admin/triggers', () => {
  // The loop the page ran, verbatim, over raw rows.
  const oldTally = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = (r.trigger_name || '(unknown)').trim();
      let a = m.get(k);
      if (!a) { a = { name: k, total: 0, earlier: 0, good: 0, tooEarly: 0, lastVote: null, triggerId: r.trigger_id || null }; m.set(k, a); }
      a.total++;
      if (r.direction === 'earlier') a.earlier++;
      else if (r.direction === 'good') a.good++;
      else if (r.direction === 'too_early') a.tooEarly++;
      if (!a.lastVote || r.voted_at > a.lastVote) a.lastVote = r.voted_at;
      if (!a.triggerId && r.trigger_id) a.triggerId = r.trigger_id;
    }
    return m;
  };
  // What trigger_timing_feedback_rollup returns for those rows: one entry per (name, direction).
  const rollup = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const nm = (r.trigger_name || '').trim() === '' ? '(unknown)' : r.trigger_name.trim();
      const k = nm + '\u0001' + r.direction;
      const g = m.get(k) ?? { name: nm, direction: r.direction, n: 0, last_vote: r.voted_at, trigger_id: null };
      g.n++; if (r.voted_at > g.last_vote) g.last_vote = r.voted_at;
      if (r.trigger_id && (g.trigger_id == null || r.trigger_id > g.trigger_id)) g.trigger_id = r.trigger_id;
      m.set(k, g);
    }
    return [...m.values()];
  };

  it('folds the per-direction tallies into exactly what the row-by-row loop produced', () => {
    let s = 99;
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const names = ['Gravel Rain', 'Rampage', ' Word of ', '', 'AE Dance', 'Tashan'];
    const dirs = ['earlier', 'good', 'too_early', 'expired', 'expired', 'expired', 'dismissed'];
    const rows = Array.from({ length: 6000 }, () => ({
      trigger_name: names[Math.floor(rnd() * names.length)], direction: dirs[Math.floor(rnd() * dirs.length)],
      trigger_id: rnd() < 0.2 ? null : 'id' + Math.floor(rnd() * 5),
      voted_at: new Date(Date.UTC(2026, 8, 5) + Math.floor(rnd() * 29 * DAY)).toISOString(),
    }));
    const { aggs, total } = foldFeedback(rollup(rows));
    const exp = oldTally(rows);
    expect(total).toBe(rows.length);
    expect(total).toBeGreaterThan(PGRST_MAX_ROWS);
    expect(aggs).toHaveLength(exp.size);
    for (const a of aggs) {
      const e = exp.get(a.name);
      expect({ ...a, triggerId: a.triggerId !== null }).toEqual({ ...e, triggerId: e.triggerId !== null });
    }
    // most-voted first
    for (let i = 1; i < aggs.length; i++) expect(aggs[i - 1].total).toBeGreaterThanOrEqual(aggs[i].total);
  });

  it('total counts every direction, as the page always has (expired and dismissed are rows too)', () => {
    const { aggs, total } = foldFeedback([
      { name: 'Rampage', direction: 'expired', n: 5000, last_vote: '2026-10-04T00:00:00Z', trigger_id: 't1' },
      { name: 'Rampage', direction: 'dismissed', n: 12, last_vote: '2026-10-03T00:00:00Z', trigger_id: 't1' },
      { name: 'Rampage', direction: 'good', n: 3, last_vote: '2026-10-02T00:00:00Z', trigger_id: null },
    ]);
    expect(total).toBe(5015);
    expect(aggs).toEqual([{ name: 'Rampage', total: 5015, earlier: 0, good: 3, tooEarly: 0, lastVote: '2026-10-04T00:00:00Z', triggerId: 't1' }]);
  });

  describe('the trigger list', () => {
    // 1,300 triggers: one import added 381 to 131 and the table is on its way past 1,000. The ones that
    // sort last are the ones an unpaged read drops.
    const cats = ['callout', 'heal', 'rampage', 'spawn'];
    const rows = Array.from({ length: 1300 }, (_, i) => ({
      id: 'id' + String(i).padStart(5, '0'), name: 'T' + alpha(i % 50), category: cats[i % 4], enabled: true,
    }));
    const fake = () => makeFake({ tables: { guild_triggers: structuredClone(rows) }, keys: KEYS });

    it('returns every trigger in category, name, id order — not the first 1,000', async () => {
      const f = fake();
      const got = await loadGuildTriggers(f, 'id, name, category, enabled');
      expect(got).toHaveLength(1300);
      expect(new Set(got.map(r => r.id)).size).toBe(1300);                      // no page repeated or skipped a row
      const key = (r) => [r.category, r.name, r.id].join('\u0001');
      expect(got.map(key)).toEqual([...got].map(key).sort());
      expect(f.calls.dropped).toEqual([]);
    });

    it('one category: only its rows, still all of them', async () => {
      const got = await loadGuildTriggers(fake(), 'id, name, category', 'heal');
      expect(got).toHaveLength(325);
      expect(new Set(got.map(r => r.category))).toEqual(new Set(['heal']));
    });
  });

  it('loadFeedbackRollup uses the migration\'s argument name and reads a failure as no votes', async () => {
    const f = makeFake({ impls: { trigger_timing_feedback_rollup: () => [{ name: 'Rampage', direction: 'good', n: 1, last_vote: null, trigger_id: null }] }, signatures: SIGNATURES });
    expect(await loadFeedbackRollup(f, '2026-09-04T00:00:00.000Z')).toHaveLength(1);
    expect(f.calls.rpcs[0].args).toEqual({ p_since: '2026-09-04T00:00:00.000Z' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await loadFeedbackRollup(makeFake({ signatures: SIGNATURES }), 'x')).toEqual([]);
    spy.mockRestore();
  });
});

// ═══ the fake itself, so a green run above means something ══════════════════════════════════════
describe('the fake enforces what the real gateway enforces', () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i, name: 'n' + i }));
  it('cuts any read at 1,000 whatever .limit() asks, and records the rows it dropped', async () => {
    const f = makeFake({ tables: { t: rows } });
    const { data } = await f.from('t').select('id').limit(20000);
    expect(data).toHaveLength(PGRST_MAX_ROWS);
    expect(f.calls.dropped).toEqual([{ table: 't', matched: 2500, returned: 1000 }]);
    const r = await f.from('t').select('id').range(0, 49999);
    expect(r.data).toHaveLength(PGRST_MAX_ROWS);
  });
  it('refuses ranged paging that is not ordered by the unique key', async () => {
    const f = makeFake({ tables: { t: rows }, keys: { t: ['id'] } });
    await expect(f.from('t').select('id').order('name').range(0, 999)).rejects.toThrow(/unique key/);
    await expect(f.from('t').select('id').order('id').range(0, 999)).resolves.toBeTruthy();
  });
  it('refuses an RPC whose argument names are not the migration\'s', async () => {
    const f = makeFake({ impls: { x: () => 1 }, signatures: { x: ['p_a'] } });
    expect((await f.rpc('x', { p_b: 1 })).error.message).toMatch(/schema cache/);
    expect((await f.rpc('x', { p_a: 1 })).data).toBe(1);
  });
  it('reads the parameter names out of the real migration', () => {
    expect(SIGNATURES.admin_queue_chat_times).toEqual(['p_speakers', 'p_since', 'p_lo', 'p_hi']);
    expect(SIGNATURES.who_latest_per_character).toEqual(['p_guild', 'p_names']);
    expect(Object.keys(SIGNATURES)).toHaveLength(11);              // ten new functions + the one stubbed from an older migration
  });
});

// ═══ the migration ══════════════════════════════════════════════════════════════════════════════
describe('20261004140400_cap_safe_admin.sql', () => {
  const FUNCTIONS = [
    'admin_queue_chat_speakers', 'admin_queue_who_class_known', 'who_latest_per_character',
    'admin_queue_chat_times', 'admin_queue_combat_times', 'page_view_stats',
    'admin_members_chat_counts', 'admin_members_contrib_counts', 'admin_members_who_counts',
    'trigger_timing_feedback_rollup',
  ];
  const chunk = (name) => {
    const at = sql.indexOf(`create or replace function public.${name}(`);
    expect(at, `${name} is defined`).toBeGreaterThan(-1);
    const next = sql.indexOf('create or replace function', at + 10);
    return sql.slice(at, next < 0 ? undefined : next);
  };

  it('defines all ten functions, and only those', () => {
    expect(Object.keys(parseSignatures(sql)).sort()).toEqual([...FUNCTIONS].sort());
  });

  it('every function answers with ONE jsonb value — a set would be cut at 1,000 rows like a table', () => {
    for (const f of FUNCTIONS) {
      const c = chunk(f).split(/\n\$\$;/)[0];
      expect(c, f).toMatch(/\breturns jsonb\b/i);
      expect(c, f).not.toMatch(/\breturns (table|setof)\b/i);
    }
  });

  it('every function is stable, language sql, SECURITY INVOKER with a pinned search_path', () => {
    for (const f of FUNCTIONS) {
      const head = chunk(f).split(/\bas \$\$/i)[0];
      expect(head, f).toMatch(/\blanguage sql\b/i);
      expect(head, f).toMatch(/\bstable\b/i);
      expect(head, f).toMatch(/\bsecurity invoker\b/i);
      expect(head, f).toMatch(/\bset search_path = public\b/i);
    }
    expect(sql).not.toMatch(/security definer/i);
  });

  it('service_role only: revoked from public, anon and authenticated, granted to service_role, nothing else', () => {
    for (const f of FUNCTIONS) {
      for (const who of ['public', 'anon', 'authenticated']) {
        expect(sql, `${f} revoked from ${who}`).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from ${who};`, 'i'));
      }
      expect(sql, `${f} granted to service_role`).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role;`, 'i'));
    }
    const grants = [...sql.matchAll(/grant execute on function [^;]*? to (\w+);/gi)].map(m => m[1].toLowerCase());
    expect(grants).toHaveLength(FUNCTIONS.length);
    expect(new Set(grants)).toEqual(new Set(['service_role']));
  });

  it('is idempotent: CREATE OR REPLACE only, nothing that fails on a second run', () => {
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/\b(create table|create index|alter table|drop )/i);
  });

  it('the pages that call it do so through supabaseAdmin() (service_role), the only role granted', () => {
    const src = (p) => stripJs(readSource(path.join(ROOT, 'web', ...p)));
    expect(src(['lib', 'admin-queue.ts'])).toMatch(/loadAdminQueueWith\(supabaseAdmin\(\)\)/);
    for (const [page, call] of [
      [['app', 'admin', 'analytics', 'page.tsx'], /loadPageViewStats\(admin,/],
      [['app', 'admin', 'members', 'page.tsx'], /readChatCounts\(admin,/],
      [['app', 'admin', 'triggers', 'page.tsx'], /loadFeedbackRollup\(admin,/],
    ]) {
      const s = src(page);
      expect(s).toMatch(/const admin = supabaseAdmin\(\)/);
      expect(s).toMatch(call);
    }
  });
});

// ═══ the call sites no longer read big windows as rows ══════════════════════════════════════════
describe('no plain capped read is left in the four files', () => {
  const src = (p) => stripJs(readSource(path.join(ROOT, 'web', ...p)));
  const files = {
    'lib/admin-queue.ts': src(['lib', 'admin-queue.ts']),
    'app/admin/analytics/page.tsx': src(['app', 'admin', 'analytics', 'page.tsx']),
    'app/admin/members/page.tsx': src(['app', 'admin', 'members', 'page.tsx']),
    'app/admin/triggers/page.tsx': src(['app', 'admin', 'triggers', 'page.tsx']),
  };
  it('none sets a .limit() above the cap', () => {
    for (const [f, s] of Object.entries(files)) {
      const big = [...s.matchAll(/\.limit\(\s*(\d+)\s*\)/g)].map(m => +m[1]).filter(n => n > PGRST_MAX_ROWS);
      expect(big, `${f} still has .limit(${big.join(', ')})`).toEqual([]);
    }
  });
  it('the tables whose windows pass 1,000 rows are not read as rows by these pages', () => {
    const forbidden = {
      'lib/admin-queue.ts': ['chat_messages', 'who_observations', 'encounters', 'encounter_players'],
      'app/admin/analytics/page.tsx': ['page_views'],
      'app/admin/members/page.tsx': ['chat_messages', 'contributions', 'who_observations'],
      'app/admin/triggers/page.tsx': ['trigger_timing_feedback'],
    };
    for (const [f, tables] of Object.entries(forbidden)) {
      for (const t of tables) expect(files[f], `${f} reads ${t} as rows`).not.toMatch(new RegExp(`\\.from\\(\\s*['"]${t}['"]`));
    }
  });
  it('the banner every admin page renders is cached for a short while, not recomputed per navigation', () => {
    expect(files['lib/admin-queue.ts']).toMatch(/export const loadAdminQueue = unstable_cache\(\s*\(\) => loadAdminQueueWith\(supabaseAdmin\(\)\),\s*\['admin-queue'\],\s*\{ revalidate: (\d+) \},?\s*\);/);
    const ttl = +files['lib/admin-queue.ts'].match(/revalidate: (\d+)/)[1];
    expect(ttl).toBeGreaterThanOrEqual(15);
    expect(ttl).toBeLessThanOrEqual(300);
  });
  it('the trigger list comes from the paged loader, and the roster reads page through selectAll', () => {
    expect(files['app/admin/triggers/page.tsx']).toMatch(/loadGuildTriggers<TriggerRow>\(admin,/);
    expect(files['app/admin/triggers/page.tsx']).not.toMatch(/\.from\(\s*['"]guild_triggers['"]\s*\)\s*\.select/);
    expect(files['app/admin/members/page.tsx']).toMatch(/selectAll</);
    expect((files['lib/admin-queue.ts'].match(/selectAll</g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
