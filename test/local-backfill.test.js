// test/local-backfill.test.js — "Rebuild from my logs": the agent's local backfill into _localStore.
//
// The guild lead, 2026-10-21: people bring their big log files into the tool; rebuild the fights and the raids they
// were in from the log's own contents, on this PC, without uploading anything. These tests run the REAL agent
// functions against fixture logs in a temp folder:
//   • segmentation: a log becomes fight / raid_session / death / loot / zone_visit records (who, where, what);
//   • resume: a paused run picks up from its byte cursor, at a quiet point, and ends with the same records;
//   • nothing is uploaded or queued, and a tell / officer line / group line / raid-say TEXT is never stored;
//   • DKP nights: the schedule match for a linked member, skipped entirely with no linked account;
//   • the routes: start / stop / status / raids.
// Names are invented. Run: npx vitest run test/local-backfill.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n) => String(n).padStart(2, '0');
// An EverQuest stamp for an instant, in THIS machine's local time (the agent reads stamps as local time).
const stamp = (ms) => { const d = new Date(ms); return `[${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}]`; };
const WED_8_30_ET = Date.UTC(2026, 9, 8, 0, 30, 0);     // Wed Oct 7 2026, 8:30 pm EDT
const TUE_8_30_ET = Date.UTC(2026, 9, 7, 0, 30, 0);     // Tue Oct 6 2026, 8:30 pm EDT: not a raid night
const HOUR = 3600_000;
const RAIDERS = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Dolmar', 'Eviran'];

// One raid night, as lines. Returns { lines, end }.
function raidNight(t0, o = {}) {
  const L = []; let t = t0;
  const add = (text) => { L.push(stamp(t) + ' ' + text); t += 1000; };
  add('Welcome to EverQuest!');
  add('You have entered Plane of Fire.');
  if (o.join !== false) { add('You have joined the raid.'); for (const n of RAIDERS.slice(1)) add(`${n} has joined the raid.`); }
  add("Brackwyn tells the raid, 'RAIDTEXT pulling in thirty'");
  add("Corvale tells you, 'TELLSECRET officer plans'");
  add("Rethlan tells Wolfpackofficer:1, 'OFFICERSECRET sneaky'");
  add("Zarrin tells the group, 'GROUPSECRET stay back'");
  add("Dolmar tells General:2, 'CHANSECRET anyone'");
  add("You told Eviran, 'TOLDSECRET meet me'");
  add("Nyssara tells the guild, 'GUILDSECRET nice'");
  for (let i = 0; i < 40; i++) {
    add(`${RAIDERS[i % RAIDERS.length]} slashes Lord Nagafen for ${300 + i} points of damage.`);
    add(`Lord Nagafen hits ${RAIDERS[(i + 1) % 3]} for 100 points of damage.`);
  }
  if (o.death !== false) add('Corvale has been slain by Lord Nagafen!');
  add('Lord Nagafen has been slain by Aldenmar!');
  add('--You have looted a Cloth Cap.--');
  add('--Brackwyn has looted a Fine Steel Sword.--');
  if (o.leave !== false) { add('Eviran has left the raid.'); add('You have left the raid.'); }
  return { lines: L, end: t };
}

let dir, store;
const logs = [];
function writeLog(character, lines, name) {
  const file = path.join(dir, name || `eqlog_${character}_pq.proj.txt`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  logs.push(file);
  return { path: file, character, sizeBytes: fs.statSync(file).size };
}
async function run(files, extra = {}) {
  agent._rebuildStart({ store, files, budgetMs: 1000, restMs: 0, pauseOnFight: false, ...extra });
  await agent._rebuildWait();
  return agent._rebuildStatus();
}
const recs = (kind) => store.scan(kind).map(e => e.rec);
const sessionsOf = () => recs('raid_session').sort((a, b) => a.start - b.start);
const everything = () => {
  let out = '';
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out += fs.readFileSync(p, 'utf8') + '\n'; } };
  walk(store.dir);
  return out;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-rebuild-'));
  store = agent._localStoreOpen(path.join(dir, 'local'));
  agent._localTrackSetStoreForTest(store);
  agent._rebuildResetForTest();
  agent._setUploadOptsForTest(null);
});
afterEach(() => {
  agent._localTrackSetStoreForTest(null);
  agent._rebuildResetForTest();
  agent._setUploadOptsForTest(null);
  delete process.env.WOLFPACK_EXCLUDED_CHARS;
  logs.length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('segmentation: a log becomes fights, a raid, deaths, loot and zone visits', () => {
  it('rebuilds who was there, where, what was fought and what dropped', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    const st = await run([f]);
    expect(st.state).toBe('done');
    expect(st.files[0]).toMatchObject({ state: 'done', pct: 100 });

    const fights = recs('fight');
    expect(fights).toHaveLength(1);
    expect(fights[0]).toMatchObject({ boss: 'Lord Nagafen', killed: true, zone: 'Plane of Fire', character: 'Aldenmar', playerCount: 8 });
    expect(fights[0].players.map(p => p.name).sort()).toEqual([...RAIDERS].sort());
    expect(fights[0].players.every(p => p.dmg > 0 && p.dps > 0)).toBe(true);
    expect(fights[0].deaths.map(d => d.name)).toEqual(['Corvale']);

    const sessions = sessionsOf();
    expect(sessions).toHaveLength(1);
    const s = sessions[0];
    expect(s).toMatchObject({ character: 'Aldenmar', open: false, zone: 'Plane of Fire', memberCount: 8, speakers: 1, lootCount: 2 });
    expect(s.members.map(m => m.name).sort()).toEqual([...RAIDERS].sort());
    const brack = s.members.find(m => m.name === 'Brackwyn');
    expect(brack.ev).toEqual(expect.arrayContaining(['join', 'say', 'fight']));
    expect(s.members.find(m => m.name === 'Eviran').left).toBeGreaterThan(0);
    expect(s.zones.map(z => z.zone)).toEqual(['Plane of Fire']);
    expect(s.bosses).toEqual([expect.objectContaining({ name: 'Lord Nagafen', killed: true, players: 8 })]);
    expect(s.deaths.map(d => d.name)).toEqual(['Corvale']);
    expect(s.loot.map(l => l.item).sort()).toEqual(['Cloth Cap', 'Fine Steel Sword']);

    expect(recs('death').map(d => d.name)).toEqual(['Corvale']);
    expect(recs('loot').map(l => `${l.who}:${l.item}`).sort()).toEqual(['Aldenmar:Cloth Cap', 'Brackwyn:Fine Steel Sword']);
    expect(recs('zone_visit')).toEqual([expect.objectContaining({ zone: 'Plane of Fire', character: 'Aldenmar' })]);
  });

  it('a quiet log (over 30 minutes) ends one raid session and the next night is another', async () => {
    const n1 = raidNight(WED_8_30_ET, { leave: false });
    const n2 = raidNight(n1.end + 3 * HOUR);
    const f = writeLog('Aldenmar', [...n1.lines, ...n2.lines]);
    await run([f]);
    const sessions = sessionsOf();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].open).toBe(false);
    expect(sessions[0].end).toBeLessThan(sessions[1].start);
    expect(recs('fight')).toHaveLength(2);
    expect(recs('zone_visit')).toHaveLength(2);
  });

  it('a log that ends mid-raid leaves the session open, and /api/local/raids says so', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET, { leave: false }).lines);
    await run([f]);
    expect(sessionsOf()[0].open).toBe(true);
    const out = agent._rebuildRaids(store);
    expect(out.raids).toHaveLength(1);
    expect(out.raids[0]).toMatchObject({ open: true, members: 8, fights: 1, zone: 'Plane of Fire', source: 'rebuild' });
  });

  it('a big fight with no join lines is still a raid (seven or more players)', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET, { join: false, leave: false }).lines.filter(l => !/tells the raid/.test(l)));
    await run([f]);
    const s = sessionsOf();
    expect(s).toHaveLength(1);
    expect(s[0].why).toBe('fight');
    expect(s[0].memberCount).toBe(8);
  });

  it('a /who row enriches a member the raid lines named, and adds nobody', async () => {
    const n = raidNight(WED_8_30_ET);
    const at = stamp(n.end - 10_000);
    const lines = [...n.lines.slice(0, -2), `${at} [60 Druid] Brackwyn (Human) <Wolf Pack>`, `${at} [55 Wizard] Stranger (Gnome) <Other Guild>`, ...n.lines.slice(-2)];
    await run([writeLog('Aldenmar', lines)]);
    const s = sessionsOf()[0];
    const b = s.members.find(m => m.name === 'Brackwyn');
    expect(b).toMatchObject({ cls: 'Druid', level: 60, guild: 'Wolf Pack' });
    expect(s.members.find(m => m.name === 'Stranger')).toBeUndefined();
    expect(s.guild).toBe('Wolf Pack');
  });

  it('two characters on one PC in the same raid are ONE raid, with the fight counted once', async () => {
    const n = raidNight(WED_8_30_ET);
    await run([writeLog('Aldenmar', n.lines), writeLog('Brackwyn', n.lines)]);
    expect(sessionsOf()).toHaveLength(2);
    const out = agent._rebuildRaids(store);
    expect(out.raids).toHaveLength(1);
    expect(out.raids[0].characters.sort()).toEqual(['Aldenmar', 'Brackwyn']);
    expect(out.raids[0].fights).toBe(1);
    expect(out.raids[0].bosses).toHaveLength(1);
  });

  it('since: only the lines from that date on are rebuilt (and a big file is bisected to it)', async () => {
    const lines = [];
    const starts = [];
    let t = WED_8_30_ET;
    for (let i = 0; i < 6; i++) {
      starts.push(t);
      const n = raidNight(t);
      lines.push(...n.lines);
      // padding so the file is big enough to take the seek path
      for (let k = 0; k < 1500; k++) lines.push(stamp(n.end + k) + ' Aldenmar begins casting Dark Empathy.');
      t += 7 * 24 * HOUR;
    }
    const f = writeLog('Aldenmar', lines);
    expect(f.sizeBytes).toBeGreaterThan(512 * 1024);
    const st = await run([f], { sinceMs: starts[4] - HOUR });
    expect(sessionsOf()).toHaveLength(2);
    expect(recs('fight')).toHaveLength(2);
    expect(Math.min(...recs('fight').map(x => x.start))).toBeGreaterThanOrEqual(starts[4]);
    expect(st.since).toBe(new Date(starts[4] - HOUR).toISOString());
  });
});

describe('resume from the byte cursor', () => {
  it('a paused run resumes at a quiet point and ends with the same records as an uninterrupted one', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    await run([f]);
    const want = { fights: recs('fight'), sessions: sessionsOf(), deaths: recs('death'), loot: recs('loot').sort((a, b) => a.at - b.at) };

    // a second store, interrupted mid-file
    const store2 = agent._localStoreOpen(path.join(dir, 'local2'));
    agent._localTrackSetStoreForTest(store2);
    agent._rebuildResetForTest();
    agent._rebuildStart({ store: store2, files: [f], chunkBytes: 1024, budgetMs: 0, restMs: 25, pauseOnFight: false });
    for (let i = 0; i < 400 && !(agent._rebuildStatus().files[0].bytePos >= 3000); i++) await sleep(5);
    expect(agent._rebuildStop()).toBe(true);
    await agent._rebuildWait();
    let st = agent._rebuildStatus();
    expect(st.state).toBe('paused');
    expect(st.files[0].state).toBe('paused');
    const cursor = JSON.parse(fs.readFileSync(path.join(store2.dir, 'rebuild.json'), 'utf8'));
    const saved = cursor.files[f.path];
    expect(saved.done).toBe(false);
    expect(saved.snapshot.bytePos).toBeGreaterThan(0);
    expect(saved.snapshot.bytePos).toBeLessThan(f.sizeBytes);

    agent._rebuildResetForTest();
    st = await (async () => { agent._rebuildStart({ store: store2, files: [f], budgetMs: 1000, restMs: 0, pauseOnFight: false }); await agent._rebuildWait(); return agent._rebuildStatus(); })();
    expect(st.state).toBe('done');
    expect(st.files[0].resumedFrom).toBe(saved.snapshot.bytePos);
    const scan2 = (k) => store2.scan(k).map(e => e.rec);
    expect(scan2('fight')).toEqual(want.fights);                      // one fight, whole, not two halves
    expect(scan2('raid_session').sort((a, b) => a.start - b.start)).toEqual(want.sessions);
    expect(scan2('death')).toEqual(want.deaths);
    expect(scan2('loot').sort((a, b) => a.at - b.at)).toEqual(want.loot);
  });

  it('a finished file is not re-read, and one that grew is read from where it ended', async () => {
    const n1 = raidNight(WED_8_30_ET, { leave: false });
    const f = writeLog('Aldenmar', n1.lines);
    await run([f]);
    const firstEnd = agent._rebuildStatus().files[0].bytePos;
    expect(firstEnd).toBe(f.sizeBytes);
    agent._rebuildResetForTest();
    let st = await run([f]);
    expect(st.files[0].resumedFrom).toBe(firstEnd);
    expect(st.files[0].lines).toBe(agent._rebuildStatus().files[0].lines);
    // the log grows by a second night
    const n2 = raidNight(n1.end + 3 * HOUR);
    fs.appendFileSync(f.path, n2.lines.join('\n') + '\n');
    agent._rebuildResetForTest();
    st = await run([{ ...f, sizeBytes: fs.statSync(f.path).size }]);
    expect(st.files[0].resumedFrom).toBe(firstEnd);
    expect(sessionsOf()).toHaveLength(2);
    expect(recs('fight')).toHaveLength(2);
  });

  it('a different file under the same name starts over, and fresh ignores the cursor', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    await run([f]);
    agent._rebuildResetForTest();
    let st = await run([f], { fresh: true });
    expect(st.files[0].resumedFrom).toBeUndefined();
    const other = writeLog('Aldenmar', raidNight(WED_8_30_ET + 7 * 24 * HOUR).lines, path.basename(f.path));
    agent._rebuildResetForTest();
    st = await run([other]);
    expect(st.files[0].resumedFrom).toBeUndefined();
  });

  it('waits while a live fight is on, then carries on', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    let live = true;
    agent._rebuildStart({ store, files: [f], budgetMs: 1000, restMs: 0, liveFight: () => live, waitMs: 10 });
    await sleep(80);
    let st = agent._rebuildStatus();
    expect(st.running).toBe(true);
    expect(st.waiting).toBe('a live fight');
    expect(st.files[0].bytePos).toBe(0);
    live = false;
    await agent._rebuildWait();
    st = agent._rebuildStatus();
    expect(st.state).toBe('done');
    expect(st.waiting).toBeNull();
    expect(recs('fight')).toHaveLength(1);
  });
});

describe('local only: nothing is uploaded and nothing private is stored', () => {
  it('queues no upload and fills no upload buffer, even with a linked account', async () => {
    agent._setUploadOptsForTest({ botUrl: 'http://127.0.0.1:9/encounter', token: 'tok-1', dryRun: false });
    const before = agent._uploadQueueLenForTest();
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    const st = await run([f]);
    expect(st.state).toBe('done');
    expect(st.uploads).toBe(0);
    expect(st.mode).toBe('local');
    expect(agent._uploadQueueLenForTest()).toBe(before);
    const b = agent._uploadBuffersForTest();
    expect(b.chatBuffer.length).toBe(0);
    expect(b.tellBuffer.length).toBe(0);
  });

  it('never stores a tell, officer, custom-channel, group, guild or raid-say TEXT', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    await run([f]);
    const all = everything();
    for (const secret of ['TELLSECRET', 'OFFICERSECRET', 'GROUPSECRET', 'CHANSECRET', 'TOLDSECRET', 'GUILDSECRET', 'RAIDTEXT', 'Wolfpackofficer']) {
      expect(all).not.toContain(secret);
    }
    // the raid say contributed WHO spoke, and only that
    expect(sessionsOf()[0].speakers).toBe(1);
  });

  it('a log with only private lines (even ones that say "raid") rebuilds no raid and names nobody', async () => {
    const t = WED_8_30_ET;
    const lines = [
      stamp(t) + " Corvale tells you, 'the raid starts at eight'",
      stamp(t + 1000) + " Zarrin tells the group, 'raid time'",
      stamp(t + 2000) + " Rethlan tells Wolfpackofficer:1, 'raid roster'",
      stamp(t + 3000) + " You told Eviran, 'join the raid'",
      stamp(t + 4000) + " Dolmar tells General:2, 'raid anyone?'",
      stamp(t + 5000) + " Nyssara says, 'raid soon'",
    ];
    await run([writeLog('Aldenmar', lines)]);
    expect(recs('raid_session')).toHaveLength(0);
    const all = everything();
    for (const n of ['Corvale', 'Zarrin', 'Rethlan', 'Eviran', 'Dolmar', 'Nyssara']) expect(all).not.toContain(n);
  });

  it('keeps out a character the owner keeps out of stats', async () => {
    process.env.WOLFPACK_EXCLUDED_CHARS = 'aldenmar';
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    agent._rebuildSetCandidatesForTest(() => [f]);
    const out = agent._rebuildStartRequest({});
    expect(out.status).toBe(400);
    expect(recs('fight')).toHaveLength(0);
  });
});

describe('DKP nights', () => {
  it('schedule match: Sun / Wed / Thu, 8 pm to midnight Eastern, at least 15 minutes inside it', () => {
    const m = agent._rebuildScheduleMatch(WED_8_30_ET, WED_8_30_ET + 2 * HOUR);
    expect(m).toMatchObject({ night: '2026-10-07' });
    expect(m.overlapMin).toBe(120);
    expect(agent._rebuildScheduleMatch(TUE_8_30_ET, TUE_8_30_ET + 2 * HOUR)).toBeNull();                      // Tuesday
    expect(agent._rebuildScheduleMatch(WED_8_30_ET - 3 * HOUR, WED_8_30_ET - 1.2 * HOUR)).toBeNull();       // Wed 5:30-7:18 pm: before 8
    expect(agent._rebuildScheduleMatch(WED_8_30_ET - HOUR, WED_8_30_ET - 0.5 * HOUR + 5 * 60_000)).toBeNull(); // 5 minutes inside is not enough
    // a short session wholly inside the window counts (its whole length is the overlap); one that only brushes it does not
    expect(agent._rebuildScheduleMatch(WED_8_30_ET, WED_8_30_ET + 100_000)).toMatchObject({ night: '2026-10-07' });
    expect(agent._rebuildScheduleMatch(WED_8_30_ET - 35 * 60_000, WED_8_30_ET - 25 * 60_000)).toBeNull();     // 7:55-8:05 pm
    // past midnight keeps the night it started in
    const late = Date.UTC(2026, 9, 8, 3, 30, 0);      // Wed 11:30 pm EDT
    expect(agent._rebuildScheduleMatch(late, late + HOUR)).toMatchObject({ night: '2026-10-07', overlapMin: 30 });
    // Thursday and Sunday
    expect(agent._rebuildScheduleMatch(Date.UTC(2026, 9, 9, 1, 0, 0), Date.UTC(2026, 9, 9, 3, 0, 0))).toMatchObject({ night: '2026-10-08' });
    expect(agent._rebuildScheduleMatch(Date.UTC(2026, 9, 5, 1, 0, 0), Date.UTC(2026, 9, 5, 3, 0, 0))).toMatchObject({ night: '2026-10-04' });
    // after daylight time ends the same wall clock is an hour later in UTC
    const est = Date.UTC(2026, 10, 5, 1, 30, 0);       // Wed Nov 4 2026, 8:30 pm EST
    expect(agent._rebuildScheduleMatch(est, est + HOUR)).toMatchObject({ night: '2026-11-04', overlapMin: 60 });
    expect(agent._rebuildScheduleMatch(est - 2 * HOUR, est - HOUR)).toBeNull();                           // 7:30-8:30 pm EST is out
  });

  it('a linked member: sessions in the window are marked dkpMatch schedule, the others are not', async () => {
    agent._setUploadOptsForTest({ botUrl: 'http://127.0.0.1:9/encounter', token: 'tok-1', dryRun: false });
    const wed = raidNight(WED_8_30_ET);
    const tue = raidNight(TUE_8_30_ET);
    // the Tuesday night comes first in the log, the Wednesday night after it (log order is time order)
    const f = writeLog('Aldenmar', [...tue.lines, ...wed.lines]);
    const st = await run([f]);
    expect(st.dkp).toMatchObject({ mode: 'schedule', checked: 2, matched: 1 });
    const s = sessionsOf();
    expect(s).toHaveLength(2);
    const tueS = s.find(x => x.start < WED_8_30_ET - HOUR);
    const wedS = s.find(x => x.start >= WED_8_30_ET - HOUR);
    expect(tueS.dkpMatch).toBeNull();
    expect(wedS).toMatchObject({ dkpMatch: 'schedule', dkpNight: '2026-10-07' });
    const raids = agent._rebuildRaids(store).raids;
    expect(raids.find(r => r.start >= WED_8_30_ET - HOUR)).toMatchObject({ dkpMatch: 'schedule', dkpNight: '2026-10-07' });
    expect(raids.find(r => r.start < WED_8_30_ET - HOUR).dkpMatch).toBeNull();
  });

  it('local-only (no linked account): the matching step is skipped entirely', async () => {
    for (const opts of [null, { botUrl: 'http://127.0.0.1:9/encounter', token: null, dryRun: false }]) {
      agent._setUploadOptsForTest(opts);
      agent._rebuildResetForTest();
      const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
      const st = await run([f], { fresh: true });
      expect(st.dkp).toMatchObject({ mode: 'skipped', checked: 0, matched: 0 });
      expect(sessionsOf()[0].dkpMatch).toBeNull();
      expect(agent._rebuildDkpMode().mode).toBe('skipped');
      expect(agent._rebuildDkpPass(store, agent._rebuildDkpMode())).toMatchObject({ skipped: true });
    }
  });
});

describe('routes', () => {
  function call(method, url, body) {
    return new Promise((resolve) => {
      const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
      req.method = method; req.url = url; req.headers = {};
      const res = { writeHead(s, h) { this.status = s; this.headers = h; }, end(b) { resolve({ status: this.status, headers: this.headers, body: b ? JSON.parse(b) : null }); } };
      agent._localBackfillRoute(req, res).then((handled) => { if (!handled) resolve({ handled: false }); });
    });
  }

  it('answers its own paths only', async () => {
    expect((await call('GET', '/api/local/track/nights')).handled).toBe(false);
    expect((await call('GET', '/api/local/backfill/nope')).handled).toBe(false);
    expect((await call('GET', '/api/local/inventory')).handled).toBe(false);
  });

  it('wrong method is 405', async () => {
    expect((await call('GET', '/api/local/backfill/start')).status).toBe(405);
    expect((await call('POST', '/api/local/backfill/status', {})).status).toBe(405);
    expect((await call('POST', '/api/local/raids', {})).status).toBe(405);
  });

  it('start validates the file and the date, then runs; status and raids read what it found', async () => {
    const f = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    agent._rebuildSetCandidatesForTest(() => [f]);
    expect((await call('POST', '/api/local/backfill/start', { file: '/etc/passwd' })).status).toBe(404);
    expect((await call('POST', '/api/local/backfill/start', { since: 'not a date' })).status).toBe(400);
    expect((await call('POST', '/api/local/backfill/start', 'not json')).status).toBe(400);
    const idle = await call('GET', '/api/local/backfill/status');
    expect(idle.status).toBe(200);
    expect(idle.body).toMatchObject({ ok: true, state: 'idle', running: false, mode: 'local', uploads: 0 });

    const started = await call('POST', '/api/local/backfill/start', { file: f.path, since: '2026-10-01' });
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ ok: true, started: true, files: 1 });
    await agent._rebuildWait();
    const done = await call('GET', '/api/local/backfill/status');
    expect(done.body).toMatchObject({ state: 'done', totals: { fights: 1, sessions: 1, deaths: 1, loot: 2 } });
    expect(done.body.stored).toMatchObject({ fight: 1, raid_session: 1, death: 1, loot: 2, zone_visit: 1 });
    expect(done.headers['Cache-Control']).toBe('no-store');

    const raids = await call('GET', '/api/local/raids?limit=10');
    expect(raids.status).toBe(200);
    expect(raids.body.raids).toHaveLength(1);
    expect(raids.body.raids[0]).toMatchObject({ members: 8, zone: 'Plane of Fire', fights: 1, deaths: 1, lootCount: 2 });
    const none = await call('GET', '/api/local/raids?since=2027-01-01');
    expect(none.body.raids).toHaveLength(0);
  });

  it('with no file given it rebuilds every log; a second start while one runs is 409; stop pauses it', async () => {
    const a = writeLog('Aldenmar', raidNight(WED_8_30_ET).lines);
    const b = writeLog('Brackwyn', raidNight(WED_8_30_ET + 7 * 24 * HOUR).lines);
    agent._rebuildSetCandidatesForTest(() => [a, b, { ...a, path: path.join(dir, 'eqlog_Hidden_pq.proj.txt'), character: 'Hidden', ignored: true }]);
    agent._rebuildStart({ store, files: [a, b], chunkBytes: 512, budgetMs: 0, restMs: 30, pauseOnFight: false });
    expect((await call('POST', '/api/local/backfill/start', {})).status).toBe(409);
    expect((await call('POST', '/api/local/backfill/stop', {})).body).toMatchObject({ ok: true, stopping: true });
    await agent._rebuildWait();
    expect(agent._rebuildStatus().state).toBe('paused');
    expect(agent._rebuildStatus().files.map(f => f.state)).toEqual(expect.arrayContaining(['paused', 'queued']));
    agent._rebuildResetForTest();
    agent._rebuildSetCandidatesForTest(() => [a, b, { ...a, path: path.join(dir, 'eqlog_Hidden_pq.proj.txt'), character: 'Hidden', ignored: true }]);
    const all = await call('POST', '/api/local/backfill/start', {});
    expect(all.body.files).toBe(2);                          // the ignored file is left out
    await agent._rebuildWait();
    expect(agent._rebuildStatus().files.map(f => f.state)).toEqual(['done', 'done']);
    expect(recs('fight')).toHaveLength(2);
  });
});

describe('wiring, as text with comments stripped', () => {
  const src = readSource(AGENT_INDEX);
  const block = stripJs(sliceBlock(src, '// ── Rebuild from my logs (local-first, 2026-10-21)', 'function _rebuildResetForTest()'));
  const code = stripJs(src);

  it('nothing in the rebuild can reach the network, the upload queue or the opt-in upload backfill', () => {
    for (const bad of [/enqueueUpload/, /https?\.request/, /\bfetch\s*\(/, /_postLiveState/, /\bhttps?\b\s*[.(]/, /XMLHttpRequest/, /net\.connect/, /\.send\(/,
      /uploadEncounter/, /uploadHistoricalChat/, /runOptinBackfill/, /uploadFunEvents/, /uploadBuffCasts/, /pvpAssistBuffer/, /_uploadQueue\b/]) {
      expect(block).not.toMatch(bad);
    }
  });
  it('every line read for a raid, zone, loot or death goes through the live tail\'s privacy gate, and fights through shouldKeep', () => {
    const line = sliceBlock(block, 'function _rbLine(job, line) {', '\n}\n');
    expect(line).toMatch(/triggerVisibleLine\(line\)\) _rbLoot/);
    expect(line).toMatch(/triggerVisibleLine\(line\)\) _rbZoneEnter/);
    expect(line).toMatch(/triggerVisibleLine\(line\) && _rbRaidLine/);
    expect(line).toMatch(/triggerVisibleLine\(line\)\) _rbDeathLine/);
    expect(line).toMatch(/if \(!shouldKeep\(line\)\) return;/);
    // a raid-say line is read for its speaker only
    expect(sliceBlock(block, 'function _rbRaidLine(', '\n}\n')).not.toMatch(/\.text\b|m\[2\]/);
  });
  it('the router answers the rebuild routes after the local guard', () => {
    expect(code.indexOf('await _localBackfillRoute(req, res)')).toBeGreaterThan(code.indexOf('if (_localGuardBlock(req, res)) return;'));
  });
  it('the DKP step is skipped with no linked account', () => {
    expect(block).toMatch(/!_uploadOpts \|\| !_uploadOpts\.token \|\| _localOnly\(\)/);
    expect(block).toMatch(/mode\.mode !== 'schedule'/);
  });
  it('skips a character kept out of stats, and a read-only instance', () => {
    expect(block).toMatch(/exclude_from_stats/);
    expect(block).toMatch(/if \(!_isUploaderInstance\)/);
  });
});
