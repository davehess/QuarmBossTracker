// test/pop-flags-file.test.js — the agent reads Zeal's own save of the `#popflags` reply (agent 4.0.31, beta).
//
// Zeal's "Export data on /camp" and `/outputfile popflags` (the guild lead's fork, Zeal/outputfile.cpp export_popflags)
// send `#popflags` and `#popflags 1`-`5`, keep the reply OUT of the chat window and write it to
// <EQ dir>/<Name>-PoPFlags.txt, so it never reaches the eqlog and the log reader never sees it. The file:
//   Character<TAB><name> / Timestamp<TAB>YYYY-MM-DD_HH-MM-SS / Command<TAB>#popflags, #popflags 1-5 / --- / the reply lines.
// The agent reads it with the SAME exact-line table as the log (popFlagsOutputEvents), uploads through uploadPopFlags
// as source 'popflags', stamps earned_at with the file's Timestamp, and honours the opt-outs. The code here is the
// SHIPPED agent source, sliced out of index.js and run with the outside world faked; the files are real files on disk,
// and the replies are the two real server captures (test/fixtures/popflags-real-a.txt and -b.txt) wrapped in the header.
// Names are invented (Aldenmar, Brackwyn, Rethlan).
//
// Run: npx vitest run test/pop-flags-file.test.js

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AGENT_INDEX, ROOT, readSource, sliceBlock } from './_source-slice.js';
import { parsePopFlags } from '../web/lib/popFlagsPaste.ts';

const src = readSource(AGENT_INDEX);
const tsBlock = sliceBlock(src, 'const TS_RX = ', '  return isNaN(d.getTime()) ? null : d;\n}');
const gateBlock = sliceBlock(src, 'const _POP_GRANT_RX = ', "    ...(kind === 'trial' ? { npc: trialNpc.slice(0, 64) } : {}),\n  };\n}");
const pfBlock = sliceBlock(src, 'const _PF_STAGES = [', '  return { events, found };\n}');          // the table, popFlagsOutputEvents, the file reader
const fpBlock = sliceBlock(src, 'function _fileFingerprint(st) {', '\n');
const optBlock = sliceBlock(src, 'function _rebuildExcluded(character) {', '  return !!(m && modeStopsLog(m.mode));\n}')
  + '\n' + sliceBlock(src, 'function shouldUploadForCharacter(character) {', '  return !p || !p.exclude_from_stats;\n}');
const scanBlock = sliceBlock(src, 'function _pfFileBlocked(lowerName) {', "    } catch { /* unreadable / malformed — skip, retry next scan */ }\n  }\n}");
const seekBlock = sliceBlock(src, 'async function _rbSeek(fh, size, sinceMs) {', '  return lo;\n}');
const netBlock = sliceBlock(src, 'async function _rescanDrained(maxMs) {', '  return false;     // the bot hands the request out again after 30 minutes; the re-read is idempotent\n}');
const readBodyBlock = sliceBlock(src, 'async function _readBody(req, max = 64 * 1024) {', "  return Buffer.concat(chunks).toString('utf8');\n}");
const rescanBlock = sliceBlock(src, 'const RESCAN_CHUNK_BYTES = ', "    return send(500, { error: 'rescan unavailable' });\n  }\n}");

/** The shipped code with a fake world. `uploads` collects what reaches uploadPopFlags; `reads` the files read. */
function load(over = {}) {
  const uploads = [];
  const reads = [];
  const w = {
    fs: { ...fs, readFileSync: (p, ...r) => { reads.push(String(p)); return fs.readFileSync(p, ...r); } },
    path, console: { log() {}, warn() {} },
    stats: { characterPrefsCheckedAt: Date.now(), characterPrefs: {}, watchedLogs: [] },
    _raidHold: false, _uploadOpts: {}, _scannedFiles: {}, _saveUploadedStateSoon: () => {},
    uploadPopFlags: (events, opts) => { uploads.push({ events, opts }); return Promise.resolve(); },
    _optinState: { characterModes: {} }, modeStopsLog: () => false, _offGuildServerChar: () => false,
    _zealState: {}, _liveFightActive: () => false, _uploadQueue: [], AGENT_VERSION: '9.9.9',
    _rebuildCandidates: () => [], _getApiBase: () => 'http://bot.test/api/agent', _getAgentToken: () => 'tok',
    fetch: async () => ({ ok: true, status: 200 }), _localOnly: () => false, _controlStandDown: () => ({ down: false }), ...over,
  };
  const names = Object.keys(w);
  const body = [tsBlock, gateBlock, pfBlock, fpBlock, optBlock, scanBlock, netBlock, seekBlock, readBodyBlock, rescanBlock].join('\n')
    + '\nreturn { parsePopFlagsFile, popFlagsFileEvents, popFlagsOutputEvents, POPFLAGS_FILENAME_RX, POPFLAGS_FILE_MAX_BYTES, scanPopFlagsFiles,'
    + ' _latestPopFlagsExport, _rescanPopFlagsExports, _rescanRun, _rescanStatus, _rescan, _pfState };';
  // eslint-disable-next-line no-new-func
  const M = new Function(...names, body)(...names.map(k => w[k]));
  return { M, uploads, reads, world: w };
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const fx = (n) => fs.readFileSync(path.join(ROOT, 'test', 'fixtures', n), 'utf8');
const A = fx('popflags-real-a.txt');       // tiers 1-3 complete, all four tier commands
const B = fx('popflags-real-b.txt');       // partway: never printed the overview or Tier 4
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-pfile-'));
afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const z2 = (n) => String(n).padStart(2, '0');
const zealStamp = (d) => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}_${z2(d.getHours())}-${z2(d.getMinutes())}-${z2(d.getSeconds())}`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const logStamp = (d) => `[${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${z2(d.getDate())} ${z2(d.getHours())}:${z2(d.getMinutes())}:${z2(d.getSeconds())} ${d.getFullYear()}]`;
const HOUR = 3600_000;
/** A moment `agoMs` before now, whole seconds (the file and the log carry no more). */
const ago = (agoMs) => new Date(Math.floor((Date.now() - agoMs) / 1000) * 1000);
const WHEN = ago(HOUR);

/** What Zeal writes: the header, `---`, the reply lines. */
function zealFile(character, when, body, { eol = '\n', command = '#popflags, #popflags 1-5' } = {}) {
  return [`Character\t${character}`, `Timestamp\t${zealStamp(when)}`, `Command\t${command}`, '---', ...body.split('\n').filter(l => l !== '')].join(eol) + eol;
}
let seq = 0;
/** A fresh EQ folder: one log (the folder the scans look in), plus the given files [name, text, mtimeAgoMs?]. */
function eqDir(files = []) {
  const dir = path.join(DIR, 'eq' + (++seq));
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'eqlog_Aldenmar_pq.proj.txt'), `${logStamp(WHEN)} You hit a gnoll pup for 12 points of damage.\n`);
  for (const [name, text, mtimeAgo] of files) put(dir, name, text, mtimeAgo);
  return dir;
}
function put(dir, name, text, mtimeAgo = 60_000) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, text);
  const t = new Date(Date.now() - mtimeAgo);
  fs.utimesSync(f, t, t);
  return f;
}
const worldFor = (dir, extra = {}) => ({
  stats: { characterPrefsCheckedAt: Date.now(), characterPrefs: {}, watchedLogs: [{ logPath: path.join(dir, 'eqlog_Aldenmar_pq.proj.txt') }] }, ...extra,
});
const keysOf = (events) => events.flatMap(e => e.stages);
/** The same reply lines as LOG lines (stamped, fresh state): what the log reader makes of them. */
function viaLog(body, character, when) {
  const { M } = load();
  const out = [];
  for (const l of body.split('\n')) if (l) out.push(...M.popFlagsOutputEvents(`${logStamp(when)} ${l}`, character));
  return out;
}

describe('the file name', () => {
  const { M } = load();
  it('takes <Name>-PoPFlags.txt, with or without the host tag Zeal adds, in any case', () => {
    for (const n of ['Aldenmar-PoPFlags.txt', 'Aldenmar-PoPFlags_Quarm.txt', 'aldenmar-popflags.txt', 'Aldenmar-PoPFlags_p1999.txt']) expect(M.POPFLAGS_FILENAME_RX.test(n), n).toBe(true);
    expect(M.POPFLAGS_FILENAME_RX.exec('Aldenmar-PoPFlags_Quarm.txt')[1]).toBe('Aldenmar');
  });
  it('and nothing near it: another export, a backup, a name with a space, a path', () => {
    for (const n of ['Aldenmar-Inventory.txt', 'Aldenmar-Spellbook.txt', 'AldenmarQuarmy.txt', 'Aldenmar-PoPFlags.txt.bak', 'Aldenmar PoPFlags.txt', 'Aldenmar-PoPFlags_a_b.txt', 'PoPFlags.txt', '../Aldenmar-PoPFlags.txt']) {
      expect(M.POPFLAGS_FILENAME_RX.test(n), n).toBe(false);
    }
  });
});

describe('the header', () => {
  const { M } = load();
  it('reads the character, the Timestamp (local time) and the reply lines of a real capture', () => {
    const p = M.parsePopFlagsFile(zealFile('Aldenmar', WHEN, A));
    expect(p.character).toBe('Aldenmar');
    expect(p.atMs).toBe(WHEN.getTime());
    expect(p.lines).toEqual(A.split('\n').filter(l => l));
    expect(p.lines[0]).toBe('=== Planes of Power Progression ===');
  });
  it('reads Windows line endings (Zeal writes with std::endl) the same', () => {
    const p = M.parsePopFlagsFile(zealFile('Aldenmar', WHEN, B, { eol: '\r\n' }));
    expect(p.lines).toEqual(B.split('\n').filter(l => l));
    expect(p.atMs).toBe(WHEN.getTime());
  });
  it('the reply lines are everything after the first --- (a later --- is a reply line, not a second header)', () => {
    const p = M.parsePopFlagsFile(zealFile('Aldenmar', WHEN, '--- Plane of Valor ---\nTier 1: Complete'));
    expect(p.lines).toEqual(['--- Plane of Valor ---', 'Tier 1: Complete']);
  });
  it('is null for anything that is not an export: no ---, no Timestamp, a Timestamp that does not exist, a bad name, a header with no tab', () => {
    const good = zealFile('Aldenmar', WHEN, A);
    const ts = zealStamp(WHEN);
    const bad = [
      good.replace('---\n', ''),
      good.replace(/Timestamp\t[^\n]*\n/, ''),
      good.replace(ts, '2026-13-01_00-00-00'),
      good.replace(ts, '2026-02-31_10-00-00'),
      good.replace(ts, '2026-10-26 20:15:03'),
      good.replace('Character\tAldenmar', 'Character\tAlden1mar'),
      good.replace('Character\tAldenmar', 'Character\t'),
      good.replace(/Character\tAldenmar\n/, ''),
      good.replace('Command\t', 'Command '),
      good.replace('Character\tAldenmar', 'character\tAldenmar'),    // the exact header strings
      '', '---\n', 'Tier 1: Complete\nTier 2: Complete\n',
    ];
    bad.forEach((t, i) => expect(M.parsePopFlagsFile(t), 'case ' + i).toBeNull());
    expect(M.parsePopFlagsFile(null)).toBeNull();
  });
  it('a header that never closes within a few lines is not an export', () => {
    const t = Array.from({ length: 20 }, (_, i) => `Key${i}\tv`).join('\n') + '\n---\nTier 1: Complete\n';
    expect(M.parsePopFlagsFile(t)).toBeNull();
  });
});

describe('the lines: the log reader\'s own table, and only that', () => {
  const { M } = load();
  it('a real capture makes exactly the events the same lines make in a log, stamped with the file\'s Timestamp', () => {
    for (const [body, name] of [[A, 'Aldenmar'], [B, 'Brackwyn']]) {
      const fresh = load().M;
      const r = fresh.popFlagsFileEvents(fresh.parsePopFlagsFile(zealFile(name, WHEN, body)), name);
      expect(r.events.length).toBeGreaterThan(5);
      expect(r.events).toEqual(viaLog(body, name, WHEN));
      for (const e of r.events) {
        expect(e).toEqual({ character: name, zone: null, boss: null, ts: WHEN.toISOString(), kind: 'recital', source: 'popflags', text: null, stages: e.stages });
      }
    }
  });
  it('A (tiers 1-3 complete) proves the steps the log read proves, B (partway) fewer', () => {
    const a = load().M, b = load().M;
    const ka = new Set(keysOf(a.popFlagsFileEvents(a.parsePopFlagsFile(zealFile('Aldenmar', WHEN, A)), 'Aldenmar').events));
    const kb = new Set(keysOf(b.popFlagsFileEvents(b.parsePopFlagsFile(zealFile('Brackwyn', WHEN, B)), 'Brackwyn').events));
    for (const k of ['mavuin_3', 'fuirstel_2', 'hohtrials_111', 'sol_room_5', 'pofire_2']) expect(ka.has(k), k).toBe(true);
    expect(ka.has('time_1')).toBe(false);
    expect(kb.has('mavuin_3')).toBe(true);
    expect(kb.size).toBeLessThan(ka.size);
  });
  it('only gated lines count: chat, a quoted copy, a near miss and a header-looking line add nothing', () => {
    const junk = [
      "Brackwyn says, 'Mavuin's case: Mavuin's case is complete'",
      "You tell your guild, 'Crypt of Decay access: Unlocked'",
      "Mavuin's case: Mavuin's case is complete!",
      'Xuzl: Incomplete',
      'Rethlan tells you, Grummus flag: Complete',
      'Character\tAldenmar',
      'Timestamp\t2020-01-01_00-00-00',
      'Tier 7: Complete',
      'You gain experience!!',
    ].join('\n');
    const m = load().M;
    const onlyJunk = m.popFlagsFileEvents(m.parsePopFlagsFile(zealFile('Aldenmar', WHEN, junk)), 'Aldenmar');
    expect(onlyJunk).toEqual({ events: [], found: 0 });
    // …and the junk around a real reply changes neither the events nor the count.
    const clean = load().M, noisy = load().M;
    const c = clean.popFlagsFileEvents(clean.parsePopFlagsFile(zealFile('Aldenmar', WHEN, A)), 'Aldenmar');
    const n = noisy.popFlagsFileEvents(noisy.parsePopFlagsFile(zealFile('Aldenmar', WHEN, junk + '\n' + A + '\n' + junk)), 'Aldenmar');
    expect(n).toEqual(c);
  });
  it('found counts flag lines: not a header line, not a Plane of Time "Locked"', () => {
    const m = load().M;
    const r = m.popFlagsFileEvents(m.parsePopFlagsFile(zealFile('Aldenmar', WHEN, '=== Planes of Power Progression ===\nPlane of Time access: Locked\nMavuin\'s case: Mavuin\'s case is complete')), 'Aldenmar');
    expect(r.found).toBe(1);
    expect(keysOf(r.events)).toEqual(['mavuin_3']);
  });
  it('the time is the file\'s Timestamp, never later than now (a clock set ahead, or an edited file)', () => {
    const m = load().M;
    const future = new Date(Date.now() + 2 * 86400_000);
    const r = m.popFlagsFileEvents(m.parsePopFlagsFile(zealFile('Aldenmar', future, "Mavuin's case: Mavuin's case is complete")), 'Aldenmar');
    expect(r.events).toHaveLength(1);
    expect(new Date(r.events[0].ts).getTime()).toBeLessThanOrEqual(Date.now());
    const old = ago(30 * 86400_000);
    const r2 = load().M;
    const o = r2.popFlagsFileEvents(r2.parsePopFlagsFile(zealFile('Aldenmar', old, "Mavuin's case: Mavuin's case is complete")), 'Aldenmar');
    expect(o.events[0].ts).toBe(old.toISOString());
  });
});

describe('the scan: <EQ dir>/<Name>-PoPFlags.txt', () => {
  beforeEach(() => { delete process.env.WOLFPACK_EXCLUDED_CHARS; });

  it('uploads a new file once: source popflags, the step keys, the file\'s time, the header\'s character', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const { M, uploads, world } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    expect(uploads).toHaveLength(1);
    const evs = uploads[0].events;
    expect(evs).toEqual(viaLog(A, 'Aldenmar', WHEN));
    expect(evs.every(e => e.source === 'popflags' && e.kind === 'recital' && e.text === null && e.ts === WHEN.toISOString() && e.character === 'Aldenmar')).toBe(true);
    expect(Object.keys(world._scannedFiles)).toEqual([path.join(dir, 'Aldenmar-PoPFlags.txt') + '#popflags']);
  });
  it('only the step keys leave: none of the file\'s words, header or lines are in what is handed to the upload', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const { M, uploads } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    const sent = JSON.stringify(uploads);
    for (const leak of ['Complete', 'Unlocked', 'Tier', 'progression', 'Timestamp', 'Command', '---', '#popflags', 'Mavuin\'s case', 'eqlog', DIR]) expect(sent, leak).not.toContain(leak);
    expect(uploads[0].events.every(e => Object.keys(e).sort().join() === 'boss,character,kind,source,stages,text,ts,zone')).toBe(true);
  });
  it('the character is the one in the header, not the file name (a renamed copy)', () => {
    const dir = eqDir([['Rethlan-PoPFlags.txt', zealFile('Aldenmar', WHEN, "Mavuin's case: Mavuin's case is complete")]]);
    const { M, uploads } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    expect(uploads[0].events[0].character).toBe('Aldenmar');
  });
  it('an unchanged file is not read again (mtime + size); a changed one is, and only what is new goes', () => {
    const dir = eqDir();
    const f = put(dir, 'Aldenmar-PoPFlags.txt', zealFile('Aldenmar', ago(2 * HOUR), B), 3 * HOUR);
    const { M, uploads, reads } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    M.scanPopFlagsFiles();
    M.scanPopFlagsFiles();
    expect(reads.filter(r => r === f)).toHaveLength(1);
    expect(uploads).toHaveLength(1);
    const first = new Set(keysOf(uploads[0].events));
    // Zeal writes it again after a camp: a longer reply, a later Timestamp, a later mtime.
    put(dir, 'Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A), 1000);
    M.scanPopFlagsFiles();
    expect(reads.filter(r => r === f)).toHaveLength(2);
    expect(uploads).toHaveLength(2);
    const second = keysOf(uploads[1].events);
    expect(second.length).toBeGreaterThan(0);
    expect(second.every(k => !first.has(k))).toBe(true);                        // the 6 h "already sent" memory, shared with the log
    expect(new Set([...first, ...second])).toEqual(new Set([...keysOf(viaLog(B, 'Aldenmar', WHEN)), ...keysOf(viaLog(A, 'Aldenmar', WHEN))]));
    expect(uploads[1].events.every(e => e.ts === WHEN.toISOString())).toBe(true);
  });
  it('the same content with a newer mtime is read again, and sends nothing new', () => {
    const dir = eqDir();
    const f = put(dir, 'Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A), 30 * 60_000);
    const { M, uploads, reads } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    put(dir, 'Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A), 1000);
    M.scanPopFlagsFiles();
    expect(reads.filter(r => r === f)).toHaveLength(2);
    expect(uploads).toHaveLength(1);
  });
  it('a camp more than 6 h later sends the whole set again, under its own earned_at', () => {
    const dir = eqDir();
    put(dir, 'Aldenmar-PoPFlags.txt', zealFile('Aldenmar', ago(8 * HOUR), A), 8 * HOUR);
    const { M, uploads } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    put(dir, 'Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A), 1000);
    M.scanPopFlagsFiles();
    expect(uploads).toHaveLength(2);
    expect(keysOf(uploads[1].events).sort()).toEqual(keysOf(uploads[0].events).sort());
    expect(uploads[0].events[0].ts).not.toBe(uploads[1].events[0].ts);
  });

  it('a character kept out of stats is never read: not the file name, not the header', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)], ['Rethlan-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const prefs = { aldenmar: { exclude_from_stats: true } };
    const { M, uploads, reads, world } = load(worldFor(dir, { stats: { ...worldFor(dir).stats, characterPrefs: prefs } }));
    M.scanPopFlagsFiles();
    expect(uploads).toEqual([]);
    expect(reads.filter(r => /PoPFlags/.test(r))).toHaveLength(1);              // Rethlan's name passed; the header (Aldenmar) stopped it after the read
    expect(Object.keys(world._scannedFiles)).toEqual([]);                       // never fingerprinted: a pref flip must rescan
    delete prefs.aldenmar;                                                       // the member opts back in
    M.scanPopFlagsFiles();
    expect(uploads.length).toBeGreaterThan(0);
  });
  it('the env list of excluded characters is honoured', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    process.env.WOLFPACK_EXCLUDED_CHARS = 'Brackwyn, ALDENMAR';
    try {
      const { M, uploads, reads } = load(worldFor(dir));
      M.scanPopFlagsFiles();
      expect(uploads).toEqual([]);
      expect(reads.filter(r => /PoPFlags/.test(r))).toEqual([]);
    } finally { delete process.env.WOLFPACK_EXCLUDED_CHARS; }
  });
  it('a character whose log reading the member stopped is not read, and a character on another server is not', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const stopped = load({ ...worldFor(dir), _optinState: { characterModes: { aldenmar: { mode: 'off' } } }, modeStopsLog: (m) => m === 'off' });
    stopped.M.scanPopFlagsFiles();
    expect(stopped.uploads).toEqual([]);
    const offGuild = load({ ...worldFor(dir), _offGuildServerChar: () => true });
    offGuild.M.scanPopFlagsFiles();
    expect(offGuild.uploads).toEqual([]);
  });
  it('exclude_inventory alone does not stop it: the flags are not inventory', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const { M, uploads } = load(worldFor(dir, { stats: { ...worldFor(dir).stats, characterPrefs: { aldenmar: { exclude_inventory: true } } } }));
    M.scanPopFlagsFiles();
    expect(uploads).toHaveLength(1);
  });
  it('waits for the prefs poll to have answered once, and for a raid hold to lift', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const noPrefs = load(worldFor(dir, { stats: { characterPrefs: {}, watchedLogs: [{ logPath: path.join(dir, 'eqlog_Aldenmar_pq.proj.txt') }] } }));
    noPrefs.M.scanPopFlagsFiles();
    expect(noPrefs.uploads).toEqual([]);
    expect(noPrefs.reads).toEqual([]);
    const held = load(worldFor(dir, { _raidHold: true }));
    held.M.scanPopFlagsFiles();
    expect(held.uploads).toEqual([]);
  });
  it('a dry run uploads nothing and fingerprints nothing', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const { M, uploads, world } = load(worldFor(dir, { _uploadOpts: { dryRun: true } }));
    M.scanPopFlagsFiles();
    expect(world._scannedFiles).toEqual({});
    expect(uploads.every(u => u.opts.dryRun === true)).toBe(true);              // uploadPopFlags prints it and queues nothing
  });
  it('a file that is not an export, or is far too big, is skipped and not read again', () => {
    const dir = eqDir([
      ['Aldenmar-PoPFlags.txt', 'this is not an export\n'],
      ['Brackwyn-PoPFlags.txt', zealFile('Brackwyn', WHEN, A) + 'x'.repeat(130 * 1024)],
    ]);
    const { M, uploads, reads, world } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    M.scanPopFlagsFiles();
    expect(uploads).toEqual([]);
    expect(Object.keys(world._scannedFiles)).toHaveLength(2);
    expect(reads.filter(r => /PoPFlags/.test(r))).toHaveLength(1);              // the small one once; the big one never
  });
  it('opts.only limits it to the named characters, opts.dir to a folder', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)], ['Brackwyn-PoPFlags.txt', zealFile('Brackwyn', WHEN, B)]]);
    const { M, uploads } = load({ stats: { characterPrefsCheckedAt: 1, characterPrefs: {}, watchedLogs: [] } });
    M.scanPopFlagsFiles({ dir, only: new Set(['brackwyn']) });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].events[0].character).toBe('Brackwyn');
  });
  it('is wired: a boot timer next to the other three export scans', () => {
    const boot = sliceBlock(src, 'setTimeout(scanInventoryUploads, 40_000);', 'setInterval(scanPopFlagsFiles, 10 * 60_000);');
    expect(boot).toContain('setTimeout(scanPopFlagsFiles, 45_000);');
  });
});

// The file the game really wrote (2026-10-27, test/fixtures/Soandso-PoPFlags.txt, byte-identical, CRLF): the first capture
// with the closing "=== Plane of Time ===" section. The Timestamp has NO time zone: it is the PC's own clock (Zeal's
// generateTimestamp uses localtime_s), so it is read as local time, the same PC and clock the agent runs on.
describe('the real Zeal export file', () => {
  const fixturePath = path.join(ROOT, 'test', 'fixtures', 'Soandso-PoPFlags.txt');
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const FILE_AT = new Date(2026, 9, 27, 16, 32, 9);          // 2026-10-27_16-32-09, local
  it('parses: the character, the Timestamp as LOCAL time, and the whole reply', () => {
    const { M } = load();
    const p = M.parsePopFlagsFile(raw);
    expect(p.character).toBe('Soandso');
    expect(p.atMs).toBe(FILE_AT.getTime());
    expect([p.atMs && new Date(p.atMs).getHours(), new Date(p.atMs).getMinutes(), new Date(p.atMs).getSeconds()]).toEqual([16, 32, 9]);
    expect(p.lines).toHaveLength(raw.split('\r\n').length - 1 - 4);
    expect(p.lines[0]).toBe('=== Planes of Power Progression ===');
    expect(p.lines.at(-1)).toBe('Complete the elemental progression, combine the four elemental essences, and return to Grand Librarian Maelin.');
  });
  it('the events carry earned_at = the file\'s local time (capped at now), and prove what the website\'s paste reader proves', () => {
    const { M } = load();
    const p = M.parsePopFlagsFile(raw);
    const r = M.popFlagsFileEvents(p, p.character);
    expect(r.events.length).toBeGreaterThan(5);
    expect(r.events.every(e => e.source === 'popflags' && e.character === 'Soandso')).toBe(true);
    // The file's own time, unless this PC's clock is still before it (a zone far west of the one it was written in): then now.
    const tsMs = new Date(r.events[0].ts).getTime();
    if (FILE_AT.getTime() < Date.now() - 1000) expect(r.events.every(e => e.ts === FILE_AT.toISOString())).toBe(true);
    else expect(Math.abs(tsMs - Date.now())).toBeLessThan(5000);
    const web = parsePopFlags(p.lines.join('\n')).flags.slice().sort();
    expect([...new Set(keysOf(r.events))].sort()).toEqual(web);
    expect(web).not.toContain('time_1');                      // "Plane of Time access: Locked": time is NOT held
    expect(r.found).toBeGreaterThan(30);
  });
  it('the advice line and the section header set nothing; the Locked line says time is not held', () => {
    const { M } = load();
    const advice = 'Complete the elemental progression, combine the four elemental essences, and return to Grand Librarian Maelin.';
    for (const l of [advice, '=== Plane of Time ===', 'If one of these is missing, hail Maelin and ask about new lore and new information.']) {
      expect(M.popFlagsOutputEvents(l, 'Soandso', Date.now()), l).toEqual([]);
    }
    expect(M._pfState.get('soandso')).toBeUndefined();
    M.popFlagsOutputEvents('Plane of Time access: Locked', 'Soandso', Date.now());
    expect(M._pfState.get('soandso').time).toBe('no');
    // …and a file that is only that section proves nothing and counts no flag line (a "Locked" is not a flag held).
    const only = M.parsePopFlagsFile(zealFile('Soandso', WHEN, ['=== Plane of Time ===', 'Plane of Time access: Locked', advice].join('\n')));
    const fresh = load().M;
    expect(fresh.popFlagsFileEvents(only, 'Soandso')).toEqual({ events: [], found: 0 });
  });
  it('the scan picks the file up as written (copied byte for byte into the EQ folder) and sends it once', () => {
    const dir = eqDir();
    fs.copyFileSync(fixturePath, path.join(dir, 'Soandso-PoPFlags.txt'));
    expect(fs.readFileSync(path.join(dir, 'Soandso-PoPFlags.txt'), 'utf8')).toBe(raw);
    const { M, uploads } = load(worldFor(dir));
    M.scanPopFlagsFiles();
    M.scanPopFlagsFiles();
    expect(uploads).toHaveLength(1);
    const p = M.parsePopFlagsFile(raw);
    expect(new Set(keysOf(uploads[0].events))).toEqual(new Set(parsePopFlags(p.lines.join('\n')).flags));
    expect(JSON.stringify(uploads)).not.toContain('Grand Librarian');
  });
});

describe('the dashboard\'s "Capture latest PoP flags" and the website\'s "Sync from my logs" also read the newest file', () => {
  const cand = (dir, character) => ({ path: path.join(dir, `eqlog_${character}_pq.proj.txt`), character });
  const sinkOf = () => ({ events: [], found: 0, sent: 0 });

  it('the newest file per character, host-tagged copies competing by file time; other characters\' files are left alone', () => {
    const dir = eqDir([
      ['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', ago(48 * HOUR), B), 48 * HOUR],
      ['Aldenmar-PoPFlags_Quarm.txt', zealFile('Aldenmar', WHEN, A), 30 * 60_000],
      ['Brackwyn-PoPFlags.txt', zealFile('Brackwyn', WHEN, B), 1000],
    ]);
    const { M } = load(worldFor(dir));
    const got = M._latestPopFlagsExport(dir, 'aldenmar');
    expect(path.basename(got.path)).toBe('Aldenmar-PoPFlags_Quarm.txt');
    expect(got.parsed.atMs).toBe(WHEN.getTime());
    expect(M._latestPopFlagsExport(dir, 'rethlan')).toBeNull();
  });
  it('reads it through the same table, whatever its age (the days window is for log lines)', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', ago(40 * 86400_000), A)]]);
    const { M } = load(worldFor(dir));
    const s = sinkOf();
    const n = M._rescanPopFlagsExports([cand(dir, 'Aldenmar')], s, { upload: true });
    expect(n).toBe(1);
    expect(s.events.map(e => e.ts).every(t => t === ago(40 * 86400_000).toISOString())).toBe(true);
    expect(s.events).toEqual(viaLog(A, 'Aldenmar', ago(40 * 86400_000)));
    expect(s.found).toBeGreaterThan(20);
  });
  it('one read per character and folder, even with several logs; none for a character without a file', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const { M, reads } = load(worldFor(dir));
    const n = M._rescanPopFlagsExports([cand(dir, 'Aldenmar'), { path: path.join(dir, 'eqlog_Aldenmar_other.txt'), character: 'Aldenmar' }, cand(dir, 'Brackwyn')], sinkOf(), { upload: true });
    expect(n).toBe(1);
    expect(reads.filter(r => /PoPFlags/.test(r))).toHaveLength(1);
  });
  it('skips a file whose header names another character, and a character kept out of stats', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Brackwyn', WHEN, A)], ['Rethlan-PoPFlags.txt', zealFile('Rethlan', WHEN, A)]]);
    const { M } = load(worldFor(dir, { stats: { characterPrefsCheckedAt: 1, characterPrefs: { rethlan: { exclude_from_stats: true } }, watchedLogs: [] } }));
    const s = sinkOf();
    expect(M._rescanPopFlagsExports([cand(dir, 'Aldenmar'), cand(dir, 'Rethlan')], s, { upload: true })).toBe(0);
    expect(s.events).toEqual([]);
  });
  it('waits for the prefs when it is going to upload; in local mode (nothing leaves) it reads and counts anyway', () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const w = worldFor(dir, { stats: { characterPrefs: {}, watchedLogs: [] } });
    expect(load(w).M._rescanPopFlagsExports([cand(dir, 'Aldenmar')], sinkOf(), { upload: true })).toBe(0);
    const s = sinkOf();
    expect(load(w).M._rescanPopFlagsExports([cand(dir, 'Aldenmar')], s, { upload: false })).toBe(1);
    expect(s.found).toBeGreaterThan(20);
  });

  it('_rescanRun: the log and the file in one run; the result and the status say how many files', async () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const { M, uploads } = load(worldFor(dir, { _rebuildCandidates: () => [cand(dir, 'Aldenmar')] }));
    const prog = { by: 'local', state: 'running', startedAt: Date.now(), character: 'Aldenmar', current: null, result: null };
    const out = await M._rescanRun({ character: 'Aldenmar', days: 14 }, prog);
    expect(out).toMatchObject({ ok: true, logs: 1, exports: 1, upload: true });
    expect(out.found).toBeGreaterThan(20);
    expect(out.sent).toBeGreaterThan(5);
    expect(uploads.flatMap(u => u.events)).toEqual(viaLog(A, 'Aldenmar', WHEN));
    prog.result = out; prog.state = 'done'; M._rescan.cur = prog;
    expect(M._rescanStatus().run).toMatchObject({ logs: 1, exports: 1, found: out.found });
  });
  it('_rescanRun: a second run sends the same rows (the file\'s time is earned_at), and with no file exports is 0', async () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const a = load(worldFor(dir, { _rebuildCandidates: () => [cand(dir, 'Aldenmar')] }));
    await a.M._rescanRun({ character: 'Aldenmar', days: 14 });
    const b = load(worldFor(dir, { _rebuildCandidates: () => [cand(dir, 'Aldenmar')] }));
    await b.M._rescanRun({ character: 'Aldenmar', days: 14 });
    expect(JSON.stringify(b.uploads.flatMap(u => u.events))).toBe(JSON.stringify(a.uploads.flatMap(u => u.events)));
    const bare = eqDir();
    const c = load(worldFor(bare, { _rebuildCandidates: () => [cand(bare, 'Aldenmar')] }));
    expect(await c.M._rescanRun({ character: 'Aldenmar', days: 14 })).toMatchObject({ ok: true, logs: 1, exports: 0, sent: 0 });
  });
  it('_rescanRun: local mode reads the file and counts it, and uploads nothing', async () => {
    const dir = eqDir([['Aldenmar-PoPFlags.txt', zealFile('Aldenmar', WHEN, A)]]);
    const { M, uploads } = load(worldFor(dir, { _rebuildCandidates: () => [cand(dir, 'Aldenmar')], _localOnly: () => true }));
    const out = await M._rescanRun({ character: 'Aldenmar', days: 14 });
    expect(out).toMatchObject({ ok: true, exports: 1, sent: 0, upload: false, why: 'local mode' });
    expect(out.found).toBeGreaterThan(20);
    expect(uploads).toEqual([]);
  });
});
