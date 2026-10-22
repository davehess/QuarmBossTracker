// Other EverQuest servers (the guild lead, 2026-10-19): "support other games, starting with the rest of the
// EverQuest family." Live EQ, Project 1999, Lazarus and the other emulators write the same eqlog_<Name>_<server>.txt
// text log the agent already tails. What they do not share is Project Quarm: the guild bot and the catalog mirrored
// from Quarm's database. The agent names the server from the log's suffix, keeps Quarm exactly as it was, and
// never lets a log from another server feed the Wolf Pack guild bot.
//
// Run: npx vitest run test/eq-family-servers.test.js
//
// The parts that can be run are run: the parsing block, the upload gate, the Mob Info lookup, Mimic's log picker, and
// a real agent process pointed at a fake guild bot. The rest are text checks over comment-stripped source.

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { AGENT_INDEX, ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const agent = stripJs(agentSrc);
const mimicSrc = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

// ── the parsing block, as shipped ───────────────────────────────────────────
const serverBlock = sliceBlock(
  agentSrc,
  'function _splitBackupSuffix(rawName) {',
  '// ── Encounter detection state machine',
);
const EXPORTS = '{ characterFromFilename, isBackupLogFile, eqServerForLog, eqServerKeyFromSuffix, eqServerCaps, eqLogsAllOffGuild, noteLogServer, eqServerForCharacter, _offGuildServerChar, _charServers, EQ_SERVERS }';
function loadServers({ localOnly = false } = {}) {
  // eslint-disable-next-line no-new-func
  return new Function('path', '_localOnly', `${serverBlock}\nreturn ${EXPORTS};`)(path, () => localOnly);
}
const S = loadServers();

describe('log names: the server comes from the suffix', () => {
  const cases = [
    // [file, server key, character]
    ['eqlog_Aldenmar_pq.proj.txt', 'quarm', 'Aldenmar'],
    ['eqlog_Aldenmar_pq.proj.txt2', 'quarm', 'Aldenmar'],
    ['eqlog_Aldenmar_pq.proj.txt.bak', 'quarm', 'Aldenmar'],
    ['eqlog_Aldenmar_pq.proj BACKUP.txt', 'quarm', 'Aldenmar'],
    ['eqlog_Aldenmar3_pq.proj.txt', 'quarm', 'Aldenmar'],
    ['eqlog_Aldenmar_pq.proj_2026-10-18.txt', 'quarm', 'Aldenmar'],   // a dated copy stays Quarm (never stop its uploads)
    ['eqlog_Aldenmar_P1999Green.txt', 'p1999', 'Aldenmar'],
    ['eqlog_Aldenmar_P1999Blue.txt', 'p1999', 'Aldenmar'],
    ['eqlog_Aldenmar_P1999Red.txt', 'p1999', 'Aldenmar'],
    ['eqlog_Aldenmar_p1999pvp.txt', 'p1999', 'Aldenmar'],
    ['eqlog_Aldenmar_P1999Green.txt2', 'p1999', 'Aldenmar'],
    ['eqlog_Brackwyn_erollisi.txt', 'erollisi', 'Brackwyn'],
    ['eqlog_Brackwyn_Lazarus.txt', 'lazarus', 'Brackwyn'],
    ['eqlog_Brackwyn_Legends.txt', 'legends', 'Brackwyn'],
  ];
  for (const [file, server, character] of cases) {
    it(`${file} -> ${server}`, () => {
      expect(S.eqServerForLog(file)).toBe(server);
      expect(S.eqServerForLog(path.join('A:\\EQ', file))).toBe(server);
      expect(S.characterFromFilename(file)).toBe(character);
    });
  }

  it('a backup marker on the name is still a backup, on any server', () => {
    expect(S.isBackupLogFile('eqlog_Aldenmar3_P1999Green.txt')).toBe(true);
    expect(S.isBackupLogFile('eqlog_Aldenmar_P1999Green.txt')).toBe(false);
  });

  it('a path that is not an EverQuest log name stays Quarm, as a custom --log always was', () => {
    expect(S.eqServerForLog('C:\\logs\\mylog.txt')).toBe('quarm');
    expect(S.eqServerForLog('')).toBe('quarm');
    expect(S.eqServerForLog(undefined)).toBe('quarm');
  });
});

describe('the server table', () => {
  it('lets only Project Quarm feed the guild bot or use the Quarm catalog', () => {
    expect(S.eqServerCaps('quarm')).toMatchObject({ guildUpload: true, catalog: true });
    expect(S.eqServerCaps('p1999')).toMatchObject({ guildUpload: false, catalog: false });
  });
  it('gives a suffix it has never heard of log-only behaviour', () => {
    expect(S.eqServerCaps('erollisi')).toMatchObject({ guildUpload: false, catalog: false });
    expect(S.eqServerCaps('toString')).toMatchObject({ guildUpload: false, catalog: false });   // not an inherited key
    expect(S.eqServerCaps(undefined)).toMatchObject({ guildUpload: false, catalog: false });
  });
  it('reads "every log is off-guild" only when there is a log and none is Quarm', () => {
    expect(S.eqLogsAllOffGuild([])).toBe(false);
    expect(S.eqLogsAllOffGuild(['eqlog_A_pq.proj.txt'])).toBe(false);
    expect(S.eqLogsAllOffGuild(['eqlog_A_P1999Green.txt', 'eqlog_B_pq.proj.txt'])).toBe(false);
    expect(S.eqLogsAllOffGuild(['eqlog_A_P1999Green.txt', 'eqlog_B_erollisi.txt'])).toBe(true);
    expect(S.eqLogsAllOffGuild(['C:\\x\\mylog.txt'])).toBe(false);
  });
});

describe('the upload gate, character by character', () => {
  const gateSrc = sliceBlock(agentSrc, 'function shouldUploadForCharacter(character) {', '\n}\n');
  function gate({ localOnly = false, prefs = {} } = {}) {
    const m = loadServers({ localOnly });
    // eslint-disable-next-line no-new-func
    const fn = new Function('_offGuildServerChar', 'stats', `${gateSrc}\nreturn shouldUploadForCharacter;`)(
      m._offGuildServerChar, { characterPrefs: prefs });
    return { m, fn };
  }

  it('Quarm characters upload exactly as before, with and without opt-outs', () => {
    const { m, fn } = gate({ prefs: { zarrin: { exclude_from_stats: true } } });
    m.noteLogServer('eqlog_Aldenmar_pq.proj.txt');
    m.noteLogServer('eqlog_Zarrin_pq.proj.txt');
    expect(fn('Aldenmar')).toBe(true);
    expect(fn('Zarrin')).toBe(false);        // exclude_from_stats still wins
    expect(fn('Nobody')).toBe(true);         // never registered: unchanged
    expect(fn(null)).toBe(true);
  });

  it('a character on another server never uploads while a token is set', () => {
    const { m, fn } = gate();
    m.noteLogServer('eqlog_Corvale_P1999Green.txt');
    expect(fn('Corvale')).toBe(false);
    expect(fn('corvale')).toBe(false);
  });

  it('in local mode the same character is left alone, so every local feature keeps working', () => {
    const { m, fn } = gate({ localOnly: true });
    m.noteLogServer('eqlog_Corvale_P1999Green.txt');
    expect(fn('Corvale')).toBe(true);
  });

  it('one name on a guild server and another keeps the off-guild answer', () => {
    const { m, fn } = gate();
    m.noteLogServer('eqlog_Rethlan_pq.proj.txt');
    m.noteLogServer('eqlog_Rethlan_P1999Green.txt');
    expect(fn('Rethlan')).toBe(false);
    m.noteLogServer('eqlog_Rethlan_pq.proj.txt');      // registered again, in the other order
    expect(fn('Rethlan')).toBe(false);
  });
});

describe('the upload queue and the token', () => {
  it('refuses a payload naming an off-guild character, right after the local-mode check', () => {
    const body = sliceBlock(agent, 'function enqueueUpload(kind, payload) {', '_isUploaderInstance');
    const local = body.indexOf('if (_localOnly()) return null;');
    const gate = body.indexOf('if (payload && _offGuildServerChar(payload.character)) return null;');
    expect(local).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(local);
  });

  it('withholds the token when every log is off-guild, so the agent runs exactly like local mode', () => {
    expect(agent).toMatch(/const _tokenWithheld = !!\(args\.flags\.token \|\| process\.env\.WOLFPACK_TOKEN\) && eqLogsAllOffGuild\(args\.logs\);/);
    expect(agent).toMatch(/const token  = _tokenWithheld \? null : \(args\.flags\.token \|\| process\.env\.WOLFPACK_TOKEN \|\| null\);/);
  });

  it('leaves the Quarm catalogs unloaded when every log is off-guild', () => {
    const at = agent.indexOf('if (!eqLogsAllOffGuild(args.logs)) {');
    expect(at).toBeGreaterThan(0);
    const body = agent.slice(at, at + 200);
    expect(body).toMatch(/_loadSpellCatalogFromDisk\(\);\s*_loadItemClickiesFromDisk\(\);\s*loadItemCatalogFromDisk\(\);/);
  });

  it('registers each live log with its server before the builders are made', () => {
    expect(agent).toMatch(/const fromName  = characterFromFilename\(logPath\);[\s\S]{0,260}noteLogServer\(logPath\);/);
  });

  it('keeps the backfill and import name patterns Quarm-only, so an old off-Quarm log is never read for the guild', () => {
    expect(agent).toContain('const IMPORTED_LOG_NAME_RX = /^eqlog_([^_]+)_pq\\.proj\\.txt(?:[\\d.a-z]+)?$/i;');
    expect(agent).toContain('const stdM = name.match(/^eqlog_([^_]+)_pq\\.proj\\.txt$/i);');
  });
});

describe('Mob Info: the Quarm catalog is only used for a Quarm character', () => {
  const fnSrc = sliceBlock(agentSrc, 'function fetchMobInfo(name, selfChar, zoneId, npcId) {', '\n}\n');
  function run(selfChar, { registered = [] } = {}) {
    const m = loadServers();
    for (const p of registered) m.noteLogServer(p);
    const calls = [];
    const byName = new Map();
    const mod = { request: (o) => { calls.push(o.path); return { on() {}, end() {}, destroy() {} }; } };
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'eqServerCaps', 'eqServerForCharacter', '_primaryCharacter', '_normMobNameAgent', '_mobInfoCacheKey', '_mobInfoInflight',
      '_mobInfoByName', 'MOB_INFO_TTL_MS', '_mobPackLookup', '_uploadOpts', 'https', 'http', 'AGENT_VERSION',
      `${fnSrc}\nreturn fetchMobInfo;`,
    )(
      m.eqServerCaps, m.eqServerForCharacter, () => 'Aldenmar', (n) => String(n).toLowerCase(), (n) => 'k:' + String(n).toLowerCase(),
      new Set(), byName, 60_000, () => null,
      { botUrl: 'https://bot.example/api/agent/encounter', token: 'abc' }, mod, mod, '0.0.0',
    );
    fn('a goblin', selfChar);
    return { calls, byName };
  }

  it('asks the guild bot for a Quarm character', () => {
    const r = run('Aldenmar', { registered: ['eqlog_Aldenmar_pq.proj.txt'] });
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]).toMatch(/\/mob-info\?name=a%20goblin/);
  });
  it('asks nobody, and caches "no row", for a Project 1999 character', () => {
    const r = run('Corvale', { registered: ['eqlog_Corvale_P1999Green.txt'] });
    expect(r.calls.length).toBe(0);
    expect(r.byName.get('k:a goblin')).toMatchObject({ mob: null });
  });
  it('uses the primary character when the caller names none, and Quarm when nobody is registered', () => {
    expect(run(undefined, { registered: ['eqlog_Aldenmar_P1999Green.txt'] }).calls.length).toBe(0);
    expect(run(undefined).calls.length).toBe(1);
  });
});

describe('Mimic finds the logs of other servers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqfam-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const block = sliceBlock(mimicSrc, 'const EQ_LOG_CANONICAL_RX', 'return v;\n}\n');
  // eslint-disable-next-line no-new-func
  const M = new Function('fs', 'path', 'app', `${block}\nreturn { _isEqLogFile, _characterFromLogName };`)(
    fs, path, { getPath: () => tmp });
  const put = (name, first) => fs.writeFileSync(path.join(tmp, name), first + '\n');
  const welcome = '[Sun Aug 02 21:10:01 2026] Welcome to EverQuest!';

  it('keeps the Quarm names exactly as they were, with no file read for the canonical one', () => {
    expect(M._isEqLogFile(tmp, 'eqlog_Aldenmar_pq.proj.txt')).toBe(true);   // not even on disk: the filename alone
    expect(M._characterFromLogName('eqlog_Aldenmar_pq.proj.txt')).toBe('Aldenmar');
    expect(M._characterFromLogName('eqlog_Aldenmar_pq.proj.txt2')).toBe('Aldenmar');
    expect(M._characterFromLogName('eqlog_Aldenmar_pq.proj BACKUP.txt')).toBe('Aldenmar');
    expect(M._isEqLogFile(tmp, 'notes.txt')).toBe(false);
    expect(M._isEqLogFile(tmp, 'eqlog_Aldenmar_pq.proj.ini')).toBe(false);
  });
  it('takes another server\'s log once its first line is the EverQuest welcome', () => {
    put('eqlog_Corvale_P1999Green.txt', welcome);
    put('eqlog_Corvale_erollisi.txt', welcome);
    expect(M._isEqLogFile(tmp, 'eqlog_Corvale_P1999Green.txt')).toBe(true);
    expect(M._isEqLogFile(tmp, 'eqlog_Corvale_erollisi.txt')).toBe(true);
    expect(M._characterFromLogName('eqlog_Corvale_P1999Green.txt')).toBe('Corvale');
  });
  it('does not tail an eqlog_-looking file that is not an EverQuest log, and not one that is missing', () => {
    put('eqlog_Junk_backup.txt', 'not a log at all');
    expect(M._isEqLogFile(tmp, 'eqlog_Junk_backup.txt')).toBe(false);
    expect(M._isEqLogFile(tmp, 'eqlog_Ghost_P1999Green.txt')).toBe(false);
  });
});

// ── a real agent against a fake guild bot ───────────────────────────────────
describe('a real agent process', () => {
  const dirs = [];
  async function run(logName, ms = 5000) {
    const hits = [];
    const bot = http.createServer((req, res) => { hits.push(req.method + ' ' + req.url); res.writeHead(401); res.end('{}'); });
    await new Promise(r => bot.listen(0, '127.0.0.1', r));
    const port = bot.address().port;
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-eqfam-'));
    dirs.push(cwd);
    const log = path.join(cwd, logName);
    fs.writeFileSync(log, '[Sun Aug 02 21:10:01 2026] Welcome to EverQuest!\n');
    const child = spawn(process.execPath, [
      path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'),
      // No --web-port: that is what writes the PID file next to index.js, which the boot smoke test shares.
      // --no-service-check: another test's agent may be up, and the single-instance check would send this one away.
      '--watch', '--no-service-check', '--log', log,
      '--bot-url', `http://127.0.0.1:${port}/api/agent/encounter`,
    ], { cwd, env: { ...process.env, WOLFPACK_TOKEN: 'a-real-looking-token' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', b => { out += String(b); });
    child.stderr.on('data', b => { out += String(b); });
    await new Promise(r => setTimeout(r, ms));
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    await new Promise(r => bot.close(r));
    return { hits, out };
  }
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

  it('talks to the guild bot for a Quarm log (so the silence below means something)', async () => {
    const r = await run('eqlog_Aldenmar_pq.proj.txt');
    expect(r.hits.length, r.out).toBeGreaterThan(0);
    expect(r.out).not.toMatch(/not Project Quarm/);
  }, 20_000);

  it('sends the guild bot nothing at all for a Project 1999 log, token or not', async () => {
    const r = await run('eqlog_Aldenmar_P1999Green.txt');
    expect(r.out).toMatch(/\[server\] these logs are not Project Quarm/);
    expect(r.hits, r.out).toEqual([]);
  }, 20_000);

  it('does the same for a server it has never heard of', async () => {
    const r = await run('eqlog_Aldenmar_erollisi.txt');
    expect(r.hits, r.out).toEqual([]);
  }, 20_000);
});
