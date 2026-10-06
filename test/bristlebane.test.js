// test/bristlebane.test.js — Bristlebane, the raid-voice bot (apps/bristlebane/lib.js).
//
// What can go wrong without anyone noticing: the bot walking back into the channel the moment an officer
// ends the raid, hanging on in an empty channel all night, dropping out because the bot API blinked, someone
// recorded who never opted in (a consent file that failed to load, a leftover "record everyone" mode), a
// "delete my recordings" that leaves a copy behind, or a recording whose timestamps drift so the offline
// converter cannot line the speakers up. The Discord and voice parts (apps/bristlebane/index.js) are glue
// and are checked by the 30-minute smoke test in that folder's README, not here.
//
// RECORDING IS OPT-IN ONLY (the guild lead, 2026-10-05). There is no opt-out mode to test, and
// "there is none" is itself asserted below.
//
// lib.js uses Node built-ins only, so this runs without apps/bristlebane/node_modules installed.
//
// Run: npx vitest run test/bristlebane.test.js

import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const lib = require('../apps/bristlebane/lib.js');

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 0, 30, 0);
const LIVE = { ok: true, live: true, ended: false, placed: 14 };
const QUIET = { ok: true, live: false, ended: false, placed: 0 };
const ENDED = { ok: true, live: true, ended: true, placed: 14 };
const DOWN = { ok: false, error: 'HTTP 502' };

// Feed a list of [poll, humans] one every 30 s from T0 and return every decision.
function run(steps, start = lib.initialState(), at = T0) {
  let state = start;
  const out = [];
  steps.forEach(([poll, humans], i) => {
    const d = lib.decide(state, poll, humans, at + i * 30_000);
    state = d.state;
    out.push(d);
  });
  return out;
}
const joined = () => ({ ...lib.initialState(), joined: true });
const repeat = (n, step) => Array.from({ length: n }, () => step);

// ── the join rule ────────────────────────────────────────────────────────────

describe('decide: when to join', () => {
  it('joins on the SECOND live poll in a row, with someone in the channel', () => {
    const d = run([[LIVE, 3], [LIVE, 3]]);
    expect(d.map(x => x.action)).toEqual(['none', 'join']);
    expect(d[0].reason).toBe('live 1/2');
    expect(d[1].state.joined).toBe(true);
  });

  it('a single live poll is not enough, and a not-live or unreachable poll in between starts the count over', () => {
    expect(run([[LIVE, 3], [QUIET, 3], [LIVE, 3]]).map(x => x.action)).toEqual(['none', 'none', 'none']);
    expect(run([[LIVE, 3], [DOWN, 3], [LIVE, 3]]).map(x => x.action)).toEqual(['none', 'none', 'none']);
    expect(run([[LIVE, 3], [DOWN, 3], [LIVE, 3], [LIVE, 3]]).map(x => x.action)).toEqual(['none', 'none', 'none', 'join']);
  });

  it('never joins an empty channel, and joins as soon as the first person arrives', () => {
    const d = run([[LIVE, 0], [LIVE, 0], [LIVE, 0], [LIVE, 1]]);
    expect(d.map(x => x.action)).toEqual(['none', 'none', 'none', 'join']);
    expect(d[2].reason).toBe('live, nobody in the channel');
  });

  it('never joins while the API is unreachable', () => {
    expect(run(repeat(10, [DOWN, 5])).every(x => x.action === 'none')).toBe(true);
  });

  it('never joins a night an officer ended, even though the roster still reads live', () => {
    const d = run(repeat(6, [ENDED, 5]));
    expect(d.every(x => x.action === 'none')).toBe(true);
    expect(d[5].reason).toBe('raid ended');
  });

  it('joins again once the raid is reopened', () => {
    const d = run([[ENDED, 5], [ENDED, 5], [LIVE, 5], [LIVE, 5]]);
    expect(d.map(x => x.action)).toEqual(['none', 'none', 'none', 'join']);
  });
});

// ── the leave rule ───────────────────────────────────────────────────────────

describe('decide: when to leave', () => {
  it('an officer ending the raid leaves at once', () => {
    const [d] = run([[ENDED, 9]], joined());
    expect(d.action).toBe('leave');
    expect(d.reason).toBe('ended');
  });

  it('leaves after 10 straight minutes not live — not at 9:30', () => {
    const d = run(repeat(21, [QUIET, 9]), joined());          // polls at 0, 30 s … 10:00
    expect(d.slice(0, 20).every(x => x.action === 'none')).toBe(true);   // through 9:30
    expect(d[20].action).toBe('leave');
    expect(d[20].reason).toBe('not live 10m');
  });

  it('a live poll in between resets the not-live clock', () => {
    const steps = [...repeat(15, [QUIET, 9]), [LIVE, 9], ...repeat(19, [QUIET, 9])];
    expect(run(steps, joined()).every(x => x.action === 'none')).toBe(true);
  });

  it('leaves after 5 straight minutes with nobody in the channel while the raid is still live', () => {
    const d = run(repeat(11, [LIVE, 0]), joined());           // 0 … 5:00
    expect(d.slice(0, 10).every(x => x.action === 'none')).toBe(true);
    expect(d[10].action).toBe('leave');
    expect(d[10].reason).toBe('no humans 5m');
  });

  it('someone returning resets the empty-channel clock', () => {
    const steps = [...repeat(8, [LIVE, 0]), [LIVE, 1], ...repeat(8, [LIVE, 0])];
    expect(run(steps, joined()).every(x => x.action === 'none')).toBe(true);
  });

  it('an unreachable API changes nothing for up to 10 minutes, then leaves', () => {
    const d = run(repeat(21, [DOWN, 9]), joined());
    expect(d.slice(0, 20).every(x => x.action === 'none')).toBe(true);
    expect(d[20].action).toBe('leave');
    expect(d[20].reason).toBe('api unreachable 10m');
  });

  it('an outage does not reset the not-live clock: still gone 10 minutes after it began', () => {
    // not live from poll 0 (t=0), unreachable for polls 8–17, reachable and still not live from poll 18
    const steps = [...repeat(8, [QUIET, 9]), ...repeat(10, [DOWN, 9]), ...repeat(4, [QUIET, 9])];
    const d = run(steps, joined());
    expect(d[19].action).toBe('none');           // 9:30
    expect(d[20].action).toBe('leave');          // 10:00
    expect(d[20].reason).toBe('not live 10m');
  });

  it('recovering from an outage clears the unreachable clock', () => {
    const steps = [...repeat(15, [DOWN, 9]), [LIVE, 9], ...repeat(15, [DOWN, 9])];
    expect(run(steps, joined()).every(x => x.action === 'none')).toBe(true);
  });

  it('a live raid with people in the channel stays forever', () => {
    expect(run(repeat(600, [LIVE, 9]), joined()).every(x => x.action === 'none')).toBe(true);
  });

  it('says which clock is running while it waits, so the log shows it start', () => {
    expect(run([[LIVE, 9]], joined())[0].reason).toBe('stay');
    expect(run([[QUIET, 9]], joined())[0].reason).toBe('not live (leaves at 10m)');
    expect(run([[LIVE, 0]], joined())[0].reason).toBe('channel empty (leaves at 5m)');
    expect(run([[DOWN, 9]], joined())[0].reason).toBe('api unreachable, holding (leaves at 10m)');
  });

  it('after a leave the rule is back to the start: two live polls to come back', () => {
    const [leave] = run([[ENDED, 9]], joined());
    expect(leave.state).toEqual(lib.initialState());
    expect(run([[LIVE, 5], [LIVE, 5]], leave.state).map(x => x.action)).toEqual(['none', 'join']);
  });
});

describe('decide: purity', () => {
  it('never mutates the state it is given', () => {
    const s = Object.freeze({ ...joined(), notLiveSince: T0 });
    expect(() => lib.decide(s, QUIET, 0, T0 + 3 * MIN)).not.toThrow();
    expect(() => lib.decide(Object.freeze(lib.initialState()), LIVE, 3, T0)).not.toThrow();
  });

  it('treats a missing humans count as nobody', () => {
    expect(run([[LIVE, undefined], [LIVE, undefined]]).map(x => x.action)).toEqual(['none', 'none']);
  });
});

// ── the raid-live answer and the config ──────────────────────────────────────

describe('normalizePoll', () => {
  it('reads the endpoint\'s shape', () => {
    expect(lib.normalizePoll({ live: true, placed: 14, lastRowAt: 1, nightKey: '10/04/2026', ended: false, inWindow: true }))
      .toEqual({ ok: true, live: true, ended: false, placed: 14, nightKey: '10/04/2026', inWindow: true });
  });
  it('an absent ended is not ended, and only a literal true counts as live', () => {
    expect(lib.normalizePoll({ live: 'yes', placed: 3 })).toMatchObject({ ok: true, live: false, ended: false });
  });
  it('anything that is not a JSON object is unreachable, never "not live"', () => {
    for (const bad of [null, undefined, 'x', 7, [], [{ live: true }]]) expect(lib.normalizePoll(bad).ok).toBe(false);
  });
});

describe('loadConfig', () => {
  const base = {
    BRISTLEBANE_TOKEN: 't', DISCORD_GUILD_ID: 'g', RAID_VOICE_CHANNEL_ID: 'v',
    BOT_API_URL: 'https://bot.example/api/agent/', BOT_API_KEY: 'key-123',
  };
  it('applies the defaults (opt-in recording) and trims the API url', () => {
    const c = lib.loadConfig(base);
    expect(c).toMatchObject({ recordMode: 'optin', recordingsDir: '/data/recordings', pollMs: 30_000, apiUrl: 'https://bot.example/api/agent', apiKey: 'key-123', raidChatChannelId: null, appId: null });
  });
  it('names every missing variable at once — the API key is BOT_API_KEY, not the old agent token', () => {
    expect(() => lib.loadConfig({})).toThrow(/BRISTLEBANE_TOKEN.*DISCORD_GUILD_ID.*RAID_VOICE_CHANNEL_ID.*BOT_API_URL.*BOT_API_KEY/s);
    const noKey = { ...base, WOLFPACK_AGENT_TOKEN: 'wpms_x' };
    delete noKey.BOT_API_KEY;
    expect(() => lib.loadConfig(noKey)).toThrow(/BOT_API_KEY is not set/);
  });
  it('RECORD_MODE is off or optin; there is no opt-out mode, and a typo is refused instead of guessed', () => {
    expect(lib.RECORD_MODES).toEqual(['off', 'optin']);
    expect(lib.loadConfig({ ...base, RECORD_MODE: 'off' }).recordMode).toBe('off');
    expect(lib.loadConfig({ ...base, RECORD_MODE: 'OptIn' }).recordMode).toBe('optin');
    expect(() => lib.loadConfig({ ...base, RECORD_MODE: 'optout' })).toThrow(/opt-in only/);
    expect(() => lib.loadConfig({ ...base, RECORD_MODE: 'opt-in' })).toThrow(/RECORD_MODE/);
  });
  it('SCREEN_URL is optional, and when set must be a full https address', () => {
    expect(lib.loadConfig(base).screenUrl).toBeNull();
    expect(lib.loadConfig({ ...base, SCREEN_URL: ' https://wolfpack.quest/screen ' }).screenUrl).toBe('https://wolfpack.quest/screen');
    expect(() => lib.loadConfig({ ...base, SCREEN_URL: 'http://wolfpack.quest/screen' })).toThrow(/SCREEN_URL/);
    expect(() => lib.loadConfig({ ...base, SCREEN_URL: 'wolfpack.quest/screen' })).toThrow(/SCREEN_URL/);
  });
  it('reads the optional application id', () => {
    expect(lib.loadConfig({ ...base, BRISTLEBANE_APP_ID: ' 12345 ' }).appId).toBe('12345');
  });
  it('clamps the poll interval to 5 s – 5 min', () => {
    expect(lib.loadConfig({ ...base, POLL_SECONDS: '1' }).pollMs).toBe(5_000);
    expect(lib.loadConfig({ ...base, POLL_SECONDS: '9999' }).pollMs).toBe(300_000);
    expect(lib.loadConfig({ ...base, POLL_SECONDS: 'x' }).pollMs).toBe(30_000);
  });
});

// ── consent ──────────────────────────────────────────────────────────────────

const tmpDirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bristlebane-')); tmpDirs.push(d); return d; };
afterEach(() => { while (tmpDirs.length) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true }); });

const U1 = '100000000000000001';
const U2 = '100000000000000002';
const U3 = '100000000000000003';

describe('consent store', () => {
  const make = () => {
    const clock = { t: T0 };
    const file = path.join(tmp(), 'data', 'consent.json');
    return { file, clock, store: new lib.ConsentStore(file, () => clock.t) };
  };
  const onDisk = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

  it('sits next to the recordings directory, not inside it', () => {
    expect(lib.consentPath('/data/recordings')).toBe(path.resolve('/data/consent.json'));
  });

  it('a missing file is an empty list: nobody is recorded', () => {
    const { store } = make();
    store.load();
    expect(store.error).toBeNull();
    expect(store.optin.size).toBe(0);
    expect(lib.shouldRecord('optin', store, U1)).toBe(false);
  });

  it('optIn writes { optin, updatedAt } atomically, creating the folder, with no temp file left behind', () => {
    const { store, file, clock } = make();
    store.load();
    clock.t = T0 + 5_000;
    expect(store.optIn(U2)).toBe(true);
    expect(store.optIn(U1)).toBe(true);
    expect(onDisk(file)).toEqual({ optin: [U1, U2], updatedAt: '2026-10-05T00:30:05.000Z' });   // sorted: a stable diff
    expect(fs.readdirSync(path.dirname(file))).toEqual(['consent.json']);
    expect(store.has(U1) && store.has(U2) && !store.has(U3)).toBe(true);
    expect(Object.keys(onDisk(file))).not.toContain('optout');   // there is no opt-out list to keep
  });

  it('writes through a temp file and a rename, never straight over consent.json', () => {
    const { store, file } = make();
    store.load();
    const rename = vi.spyOn(fs, 'renameSync');
    const write = vi.spyOn(fs, 'writeFileSync');
    try {
      store.optIn(U1);
      store.optOut(U1);
      expect(rename.mock.calls.map(c => [path.basename(c[0]), path.basename(c[1])])).toEqual([
        ['consent.json.tmp', 'consent.json'], ['consent.json.tmp', 'consent.json'],
      ]);
      expect(write.mock.calls.map(c => path.basename(String(c[0])))).toEqual(['consent.json.tmp', 'consent.json.tmp']);
    } finally { rename.mockRestore(); write.mockRestore(); }
    expect(fs.existsSync(file + '.tmp')).toBe(false);
  });

  it('is idempotent: opting in twice or out of a stranger changes (and rewrites) nothing', () => {
    const { store, file, clock } = make();
    store.load();
    store.optIn(U1);
    const before = fs.readFileSync(file, 'utf8');
    clock.t += 60_000;
    expect(store.optIn(U1)).toBe(false);
    expect(store.optOut(U3)).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('optOut removes the user from memory and from the file', () => {
    const { store, file } = make();
    store.load();
    store.optIn(U1); store.optIn(U2);
    expect(store.optOut(U1)).toBe(true);
    expect(store.has(U1)).toBe(false);
    expect(onDisk(file).optin).toEqual([U2]);
    expect(lib.shouldRecord('optin', store, U1)).toBe(false);
    expect(lib.shouldRecord('optin', store, U2)).toBe(true);
  });

  it('what one process wrote, the next one loads', () => {
    const { store, file, clock } = make();
    store.load(); store.optIn(U1); store.optIn(U3);
    const again = new lib.ConsentStore(file, () => clock.t).load();
    expect([...again.optin].sort()).toEqual([U1, U3]);
    expect(again.updatedAt).toBe(onDisk(file).updatedAt);
  });

  it('refuses anything that is not a user id (it is written into a file the converter trusts)', () => {
    const { store } = make();
    store.load();
    for (const bad of ['', 'abc', '../1', '12', '1'.repeat(40)]) expect(() => store.optIn(bad)).toThrow(/user id/);
    expect(store.optin.size).toBe(0);
  });

  it('shouldRecord: only optin mode, only the opted-in; off, a leftover optout mode and a typo record nobody', () => {
    const { store } = make();
    store.load(); store.optIn(U1);
    expect(lib.shouldRecord('optin', store, U1)).toBe(true);
    expect(lib.shouldRecord('optin', store, U2)).toBe(false);
    for (const mode of ['off', 'optout', 'bogus', undefined]) expect(lib.shouldRecord(mode, store, U1)).toBe(false);
    expect(lib.shouldRecord('optin', null, U1)).toBe(false);
  });

  it('a file that exists but cannot be understood records NOBODY and is never written over', () => {
    const { store, file } = make();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const body of ['{ not json', '[]', '{"optin":"100000000000000001"}', 'null']) {
      fs.writeFileSync(file, body);
      store.load();
      expect(store.error).toBeTruthy();
      expect(lib.shouldRecord('optin', store, U1)).toBe(false);
      expect(store.has(U1)).toBe(false);
      expect(() => store.optIn(U1)).toThrow();
      expect(fs.readFileSync(file, 'utf8')).toBe(body);       // the bad file is left for a person to look at
    }
  });

  it('an unreadable path (a directory) is an error too, not an empty list', () => {
    const store = new lib.ConsentStore(tmp()).load();
    expect(store.error).toBeTruthy();
  });

  it('a stale { optout } key from the old format is ignored, not trusted and not an error', () => {
    const { store, file } = make();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ optout: [U1], optin: [U2] }));
    store.load();
    expect(store.error).toBeNull();
    expect(lib.shouldRecord('optin', store, U1)).toBe(false);
    expect(lib.shouldRecord('optin', store, U2)).toBe(true);
  });

  it('optOut stops recording the person even when the file cannot be saved, and says so', () => {
    const { store, file } = make();
    store.load(); store.optIn(U1);
    fs.rmSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(path.dirname(file), 'a file where the folder should be');   // every write now fails
    expect(() => store.optOut(U1)).toThrow();
    expect(store.has(U1)).toBe(false);                    // …but they are out in memory regardless
    expect(lib.shouldRecord('optin', store, U1)).toBe(false);
  });

  it('optIn that cannot be saved changes nothing: nobody is recorded on a consent that is not on disk', () => {
    const { store, file } = make();
    store.load();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(file);                                    // consent.json is a directory: rename onto it fails
    expect(() => store.optIn(U1)).toThrow();
    expect(store.has(U1)).toBe(false);
  });
});

// ── the recording file format ────────────────────────────────────────────────

describe('opusraw records', () => {
  it('encode/decode round-trips, big-endian, in order', () => {
    const a = Buffer.from([0xf8, 0xff, 0xfe]);
    const b = Buffer.alloc(300, 7);
    const buf = Buffer.concat([lib.encodeRecord(0, a), lib.encodeRecord(20, b), lib.encodeRecord(0x01020304, a)]);
    expect([...buf.subarray(0, 6)]).toEqual([0, 0, 0, 0, 0, 3]);
    const { records, leftover } = lib.decodeRecords(buf);
    expect(leftover).toBe(0);
    expect(records.map(r => r.atMs)).toEqual([0, 20, 0x01020304]);
    expect(records[1].payload.equals(b)).toBe(true);
  });

  it('a torn last record (a crash mid-write) is reported, not misread', () => {
    const whole = lib.encodeRecord(40, Buffer.alloc(50, 1));
    const buf = Buffer.concat([lib.encodeRecord(20, Buffer.alloc(10, 2)), whole.subarray(0, whole.length - 9)]);
    const { records, leftover } = lib.decodeRecords(buf);
    expect(records).toHaveLength(1);
    expect(leftover).toBe(whole.length - 9);
  });

  it('clamps an out-of-range arrival time instead of wrapping it', () => {
    expect(lib.decodeRecords(lib.encodeRecord(-5, Buffer.from([1]))).records[0].atMs).toBe(0);
    expect(lib.decodeRecords(lib.encodeRecord(2 ** 33, Buffer.from([1]))).records[0].atMs).toBe(0xffffffff);
  });
});

describe('session paths', () => {
  it('turns the bot\'s MM/DD/YYYY night key into a sortable folder name, and makes anything else safe', () => {
    expect(lib.nightDirName('10/05/2026')).toBe('2026-10-05');
    expect(lib.nightDirName('../../etc')).toBe('etc');
    expect(lib.nightDirName(null)).toBe('unknown-night');
    expect(lib.nightDirName('///')).toBe('unknown-night');
  });
  it('names the session folder with a colon-free UTC time', () => {
    expect(lib.fsSafeIso(Date.UTC(2026, 9, 5, 1, 30, 12, 345))).toBe('2026-10-05T01-30-12Z');
    expect(lib.sessionDir('/data/recordings', '10/04/2026', Date.UTC(2026, 9, 5, 0, 30, 0)))
      .toBe(path.join('/data/recordings', '2026-10-04', '2026-10-05T00-30-00Z'));
  });
});

describe('SessionRecorder', () => {
  const make = (over = {}) => {
    const clock = { t: T0 };
    const dir = path.join(tmp(), 'rec', '2026-10-04', 'session');
    const rec = new lib.SessionRecorder({
      dir, startMs: T0, guildId: 'g1', channelId: 'c1', nightKey: '10/04/2026', recordMode: 'optin', now: () => clock.t, ...over,
    });
    return { rec, clock, dir };
  };
  const read = (dir, f) => fs.readFileSync(path.join(dir, f));

  it('creates the folder and a session.json straight away, so a crash still leaves a session', () => {
    const { dir } = make();
    const meta = JSON.parse(read(dir, 'session.json'));
    expect(meta).toMatchObject({ version: 1, startedAtMs: T0, startedAtIso: '2026-10-05T00:30:00.000Z', guildId: 'g1', channelId: 'c1', nightKey: '10/04/2026', recordMode: 'optin', endedAtMs: null, users: {}, events: [] });
  });

  it('writes each speaker to their own file, stamped with ms since the session started', async () => {
    const { rec, clock, dir } = make();
    const p1 = Buffer.from([1, 2, 3]);
    const p2 = Buffer.from([9, 9]);
    clock.t = T0 + 1_000;  expect(rec.packet(U1, p1)).toBe(true);
    clock.t = T0 + 1_020;  expect(rec.packet(U1, p1)).toBe(true);
    clock.t = T0 + 1_010;  expect(rec.packet(U2, p2)).toBe(true);
    clock.t = T0 + 90_000; expect(rec.packet(U1, p2)).toBe(true);
    await rec.close('test');
    const a = lib.decodeRecords(read(dir, `${U1}.opusraw`));
    expect(a.records.map(r => r.atMs)).toEqual([1000, 1020, 90_000]);
    expect(a.records[0].payload.equals(p1)).toBe(true);
    expect(a.leftover).toBe(0);
    expect(lib.decodeRecords(read(dir, `${U2}.opusraw`)).records.map(r => r.atMs)).toEqual([1010]);
    expect(rec.stats()).toEqual({ [U1]: { packets: 3, bytes: 8, errors: 0 }, [U2]: { packets: 1, bytes: 2, errors: 0 } });
  });

  it('refuses ids that are not snowflakes (they would become file names), empty and oversize payloads', async () => {
    const { rec, dir } = make();
    expect(rec.packet('../../escape', Buffer.from([1]))).toBe(false);
    expect(rec.packet('', Buffer.from([1]))).toBe(false);
    expect(rec.packet(U1, Buffer.alloc(0))).toBe(false);
    expect(rec.packet(U1, Buffer.alloc(70_000))).toBe(false);
    expect(rec.packet(U1, 'text')).toBe(false);
    await rec.close();
    expect(fs.readdirSync(dir)).toEqual(['session.json']);
  });

  it('session.json carries the names and the join / speaking-start / leave events with times', async () => {
    const { rec, clock, dir } = make();
    clock.t = T0 + 2_000;  rec.event('join');
    clock.t = T0 + 5_000;  rec.addUser(U1, 'Aldenmar'); rec.event('speaking-start', { userId: U1 });
    clock.t = T0 + 9_000;  rec.event('speaking-start', { userId: U1 });
    rec.addUser(U1, 'Aldenmar the Bold');                       // latest name wins
    rec.writeMeta();
    expect(JSON.parse(read(dir, 'session.json')).users).toEqual({ [U1]: 'Aldenmar the Bold' });
    clock.t = T0 + 3 * MIN; await rec.close('not live 10m');
    const meta = JSON.parse(read(dir, 'session.json'));
    expect(meta.events).toEqual([
      { t: 2_000, type: 'join' },
      { t: 5_000, type: 'speaking-start', userId: U1 },
      { t: 9_000, type: 'speaking-start', userId: U1 },
      { t: 3 * MIN, type: 'leave', reason: 'not live 10m' },
    ]);
    expect(meta.endedAtMs).toBe(T0 + 3 * MIN);
    expect(fs.existsSync(path.join(dir, 'session.json.tmp'))).toBe(false);
  });

  it('close is idempotent and nothing is kept after it', async () => {
    const { rec, dir } = make();
    rec.packet(U1, Buffer.from([1]));
    await rec.close('a');
    await rec.close('b');
    expect(rec.packet(U1, Buffer.from([2]))).toBe(false);
    rec.event('speaking-start', { userId: U1 });
    expect(lib.decodeRecords(read(dir, `${U1}.opusraw`)).records).toHaveLength(1);
    const meta = JSON.parse(read(dir, 'session.json'));
    expect(meta.events.filter(e => e.type === 'leave')).toEqual([{ t: 0, type: 'leave', reason: 'a' }]);
  });

  it('rollMinute reports each speaker\'s last minute once, then starts a fresh one', async () => {
    const { rec } = make();
    for (let i = 0; i < 5; i++) rec.packet(U1, Buffer.from([1]));
    rec.event('speaking-start', { userId: U1 });
    rec.event('speaking-start', { userId: U2 });                 // spoke, nothing arrived
    expect(rec.rollMinute()).toEqual({ [U1]: { packets: 5, speaks: 1 }, [U2]: { packets: 0, speaks: 1 } });
    expect(rec.rollMinute()).toEqual({});
    await rec.close();
  });

  it('dropUser deletes one speaker from the session in progress and keeps them out of session.json', async () => {
    const { rec, clock, dir } = make();
    rec.addUser(U1, 'Aldenmar'); rec.addUser(U2, 'Brackwyn');
    rec.event('join');
    clock.t = T0 + 1_000; rec.event('speaking-start', { userId: U1 }); rec.packet(U1, Buffer.from([1]));
    clock.t = T0 + 2_000; rec.event('speaking-start', { userId: U2 }); rec.packet(U2, Buffer.from([2]));
    await rec.dropUser(U1);
    expect(fs.existsSync(path.join(dir, `${U1}.opusraw`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${U2}.opusraw`))).toBe(true);
    // on disk straight away, not at the next minute's write
    const now = JSON.parse(read(dir, 'session.json'));
    expect(now.users).toEqual({ [U2]: 'Brackwyn' });
    expect(now.events.map(e => e.type + (e.userId ? ':' + e.userId : ''))).toEqual(['join', `speaking-start:${U2}`]);
    expect(rec.stats()[U1]).toBeUndefined();
    // the recorder's own later writes do not bring them back
    rec.event('speaking-start', { userId: U2 });
    rec.writeMeta();
    await rec.close('end');
    const end = JSON.parse(read(dir, 'session.json'));
    expect(Object.keys(end.users)).toEqual([U2]);
    expect(JSON.stringify(end)).not.toContain(U1);
    expect(fs.readdirSync(dir).sort()).toEqual([`${U2}.opusraw`, 'session.json']);
  });

  it('dropUser on someone with no file is harmless, and a dropped speaker who opts back in starts a fresh file', async () => {
    const { rec, dir } = make();
    await rec.dropUser(U3);
    rec.packet(U1, Buffer.from([1, 1, 1]));
    await rec.dropUser(U1);
    expect(rec.packet(U1, Buffer.from([7]))).toBe(true);
    await rec.close();
    const { records } = lib.decodeRecords(read(dir, `${U1}.opusraw`));
    expect(records.map(r => [...r.payload])).toEqual([[7]]);
  });
});

// ── deleting what was recorded ───────────────────────────────────────────────

describe('forgetUser', () => {
  const U4 = U1 + '0';          // shares U1's digits as a prefix: must never match U1's files
  // 2026-10-04: sessions A (U1, U2) and B (U1 only); 2026-10-05: session C (U1, U2, U4)
  function build() {
    const root = path.join(tmp(), 'recordings');
    const session = (night, name, users, extra = {}) => {
      const dir = path.join(root, night, name);
      fs.mkdirSync(dir, { recursive: true });
      for (const u of users) fs.writeFileSync(path.join(dir, `${u}.opusraw`), lib.encodeRecord(0, Buffer.from([1, 2, 3])));
      const meta = {
        version: 1, nightKey: night,
        users: Object.fromEntries(users.map((u, i) => [u, `Name${i}-${u.slice(-2)}`])),
        events: [{ t: 0, type: 'join' }, ...users.map((u, i) => ({ t: 10 + i, type: 'speaking-start', userId: u })), { t: 99, type: 'leave', reason: 'x' }],
        ...extra,
      };
      fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(meta));
      return dir;
    };
    const A = session('2026-10-04', 'A', [U1, U2]);
    const B = session('2026-10-04', 'B', [U1]);
    const C = session('2026-10-05', 'C', [U1, U2, U4]);
    return { root, A, B, C };
  }
  const meta = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
  const has = (dir, u) => fs.existsSync(path.join(dir, `${u}.opusraw`));

  it('removes the person from every night: their files, their name, their events — and nobody else\'s', () => {
    const { root, A, B, C } = build();
    expect(lib.forgetUser(root, U1)).toEqual({ files: 3, sessions: 3, errors: 0 });
    for (const dir of [A, B, C]) {
      expect(has(dir, U1)).toBe(false);
      expect(JSON.stringify(meta(dir))).not.toContain(`"${U1}"`);   // quoted: U4 has U1 as a prefix
    }
    expect(has(A, U2) && has(C, U2) && has(C, U4)).toBe(true);          // others untouched, incl. the prefix lookalike
    expect(meta(A).users).toEqual({ [U2]: `Name1-${U2.slice(-2)}` });
    expect(meta(C).users[U4]).toBeDefined();
    // the session itself is still described: join and leave stay
    expect(meta(B).events.map(e => e.type)).toEqual(['join', 'leave']);
    expect(meta(A).events.filter(e => e.userId === U2)).toHaveLength(1);
  });

  it('only the nights it is told to (tonight) when asked; an empty list deletes nothing', () => {
    const { root, A, B, C } = build();
    expect(lib.forgetUser(root, U1, { nights: ['2026-10-05'] })).toEqual({ files: 1, sessions: 1, errors: 0 });
    expect(has(C, U1)).toBe(false);
    expect(has(A, U1) && has(B, U1)).toBe(true);
    expect(meta(A).users[U1]).toBeDefined();
    expect(lib.forgetUser(root, U1, { nights: [] })).toEqual({ files: 0, sessions: 0, errors: 0 });
    expect(has(A, U1)).toBe(true);
    expect(lib.forgetUser(root, U1, { nights: ['no-such-night'] })).toEqual({ files: 0, sessions: 0, errors: 0 });
  });

  it('a second run finds nothing and rewrites nothing', () => {
    const { root, A } = build();
    lib.forgetUser(root, U1);
    const stamp = fs.statSync(path.join(A, 'session.json')).mtimeMs;
    expect(lib.forgetUser(root, U1)).toEqual({ files: 0, sessions: 0, errors: 0 });
    expect(fs.statSync(path.join(A, 'session.json')).mtimeMs).toBe(stamp);
  });

  it('a missing recordings folder is nothing to delete, not an error', () => {
    expect(lib.forgetUser(path.join(tmp(), 'nope'), U1)).toEqual({ files: 0, sessions: 0, errors: 0 });
  });

  it('refuses an id that is not a user id: it becomes a file name', () => {
    const { root, A } = build();
    for (const bad of ['', '..', '../x', '1', `${U1}/../${U2}`, '*']) expect(() => lib.forgetUser(root, bad)).toThrow(/user id/);
    expect(has(A, U1) && has(A, U2)).toBe(true);
  });

  it('a session.json it cannot parse is left exactly as it was and counted, but the audio is still removed', () => {
    const { root, A, B } = build();
    fs.writeFileSync(path.join(A, 'session.json'), '{ half a file');
    expect(lib.forgetUser(root, U1)).toEqual({ files: 3, sessions: 2, errors: 1 });
    expect(fs.readFileSync(path.join(A, 'session.json'), 'utf8')).toBe('{ half a file');
    expect(has(A, U1)).toBe(false);
    expect(JSON.stringify(meta(B))).not.toContain(U1);
  });

  it('a session with no session.json still loses the audio; stray files are ignored', () => {
    const { root, A } = build();
    fs.rmSync(path.join(A, 'session.json'));
    fs.writeFileSync(path.join(root, 'README.txt'), 'x');
    fs.writeFileSync(path.join(root, '2026-10-04', 'notes.txt'), 'x');
    expect(lib.forgetUser(root, U1)).toEqual({ files: 3, sessions: 2, errors: 0 });
    expect(has(A, U1)).toBe(false);
    expect(fs.existsSync(path.join(root, 'README.txt'))).toBe(true);
  });

  it('rewrites session.json atomically: no temp file is left in any session', () => {
    const { root, A, B, C } = build();
    lib.forgetUser(root, U1);
    for (const dir of [A, B, C]) expect(fs.readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
});

// ── what it says ─────────────────────────────────────────────────────────────

describe('texts', () => {
  it('the join notice, exactly', () => {
    expect(lib.joinNotice({ channelId: '1186', recording: true, optedIn: 2, total: 9 })).toBe(
      '🎙 Bristlebane is in 🔊 <#1186>. Recording only members who opted in — 2 of 9 here. '
      + 'Want in? /bristlebane optin. Change your mind any time: /bristlebane optout or /bristlebane forget.');
  });
  it('the notice reports zero of zero honestly, and says "not recording" when recording is off (nothing to opt into)', () => {
    expect(lib.joinNotice({ channelId: '1186', recording: true, optedIn: 0, total: 0 })).toContain('0 of 0 here');
    const off = lib.joinNotice({ channelId: '1186', recording: false, optedIn: 3, total: 9 });
    expect(off).toBe('🎙 Bristlebane is in 🔊 <#1186> (not recording).');
    expect(off).not.toMatch(/optin|opted/);
  });
  it('the notice links the raid screen on its own line when SCREEN_URL is set, recording or not', () => {
    const url = 'https://wolfpack.quest/screen';
    const on = lib.joinNotice({ channelId: '1186', recording: true, optedIn: 2, total: 9, screenUrl: url });
    expect(on.endsWith('/bristlebane forget.\n📺 Raid screen: https://wolfpack.quest/screen')).toBe(true);
    expect(lib.joinNotice({ channelId: '1186', recording: false, optedIn: 0, total: 0, screenUrl: url }))
      .toBe('🎙 Bristlebane is in 🔊 <#1186> (not recording).\n📺 Raid screen: https://wolfpack.quest/screen');
    expect(lib.joinNotice({ channelId: '1186', recording: true, optedIn: 2, total: 9, screenUrl: null })).not.toMatch(/Raid screen/);
  });

  it('[REC] only while at least one opted-in member is in the channel', () => {
    expect(lib.desiredNick(true, 1)).toBe('[REC] Bristlebane');
    expect(lib.desiredNick(true, 5)).toBe('[REC] Bristlebane');
    expect(lib.desiredNick(true, 0)).toBe('Bristlebane');
    expect(lib.desiredNick(false, 5)).toBe('Bristlebane');
    expect([lib.BASE_NICK, lib.REC_NICK]).toEqual(['Bristlebane', '[REC] Bristlebane']);
  });

  describe('statusText', () => {
    const base = { optedIn: false, recordMode: 'optin', inChannel: false, channelId: '1186', optedInHere: 0, total: 0 };
    it('says whether you are opted in', () => {
      expect(lib.statusText({ ...base, optedIn: true })).toMatch(/\*\*You:\*\* opted in/);
      expect(lib.statusText(base)).toMatch(/\*\*You:\*\* not opted in, so you are not recorded/);
    });
    it('says whether it is recording right now, and why not', () => {
      expect(lib.statusText({ ...base, recordMode: 'off' })).toMatch(/switched off/);
      expect(lib.statusText(base)).toMatch(/Recording:\*\* no — Bristlebane is not in the raid channel/);
      expect(lib.statusText({ ...base, inChannel: true, optedInHere: 2, total: 9 })).toMatch(/Recording:\*\* yes — Bristlebane is in <#1186> recording opted-in members only/);
      expect(lib.statusText({ ...base, inChannel: true, optedInHere: 0, total: 9 })).toMatch(/Recording:\*\* no — .*nobody there has opted in/);
    });
    it('counts how many in the channel are opted in', () => {
      expect(lib.statusText({ ...base, inChannel: true, optedInHere: 2, total: 9 })).toMatch(/\*\*In the channel:\*\* 2 of 9 opted in\./);
    });
  });
});

describe('the slash command', () => {
  it('is one guild command, /bristlebane, with exactly optin, optout, forget and status', () => {
    expect(lib.COMMANDS).toHaveLength(1);
    const [cmd] = lib.COMMANDS;
    expect(cmd.name).toBe('bristlebane');
    expect(cmd.options.map(o => o.name)).toEqual(['optin', 'optout', 'forget', 'status']);
  });
  it('is valid for Discord: subcommands, lowercase names, descriptions of 1–100 characters, no options to type', () => {
    const [cmd] = lib.COMMANDS;
    expect(cmd.description.length).toBeGreaterThan(0);
    expect(cmd.description.length).toBeLessThanOrEqual(100);
    for (const o of [cmd, ...cmd.options]) {
      expect(o.name).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
      expect(o.description.length).toBeGreaterThan(0);
      expect(o.description.length).toBeLessThanOrEqual(100);
    }
    for (const o of cmd.options) { expect(o.type).toBe(1); expect(o.options).toBeUndefined(); }
  });
  it('the forget buttons carry whose they are, and junk is not one of ours', () => {
    expect(lib.forgetButtonId('yes', U1)).toBe(`bb:forget:yes:${U1}`);
    expect(lib.parseForgetButton(lib.forgetButtonId('yes', U1))).toEqual({ action: 'yes', userId: U1 });
    expect(lib.parseForgetButton(lib.forgetButtonId('no', U2))).toEqual({ action: 'no', userId: U2 });
    for (const bad of ['', null, undefined, 'bb:forget:maybe:' + U1, 'bb:forget:yes:abc', 'x:forget:yes:' + U1, `bb:forget:yes:${U1}:extra`, 'raid_end:10/05/2026']) {
      expect(lib.parseForgetButton(bad)).toBeNull();
    }
  });
});

describe('formatRecSummary', () => {
  it('averages per minute over the window, busiest first, and flags a speaker with no packets', () => {
    const w = [
      { 1001: { packets: 60, speaks: 3 }, 1002: { packets: 0, speaks: 2 } },
      { 1001: { packets: 40, speaks: 1 } },
      {}, {}, {},
    ];
    expect(lib.formatRecSummary(w)).toBe('[rec] 2 users, packets/min 1001=20 1002=0 | WARN spoke but no packets: 1002(2)');
  });
  it('is quiet about an empty window', () => {
    expect(lib.formatRecSummary([{}, {}])).toBe('[rec] 0 users, packets/min -');
  });
});
