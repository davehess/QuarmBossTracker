// Which running eqgame.exe is OURS.
//
// THE BUG (Uilnayar, 2026-08-04): "Right now the Everquest that's running is
// EQLegends not Quarm, which is not the process i'm tracking in my settings" —
// and Mimic's Resource use window said "EverQuest running" anyway.
//
// eqgame.exe is the binary name for EVERY EverQuest client. Matching on the
// process name says "an EverQuest is running", never "the one you play". The
// consequences all point the same way: overlays drawn over the wrong game, the
// Zeal-missing nag primed against a client that has no Zeal, and the EQ-close
// auto-installer armed to restart Mimic when a game we don't track exits.
//
// The fix reads each PID's full ExecutablePath and keeps only the ones under a
// configured EQ folder. The risk it introduces — a real raider's overlays
// vanishing because we misjudged their install — is why every failure path here
// has to claim the process rather than disown it.
//
// Run: npx vitest run test/eq-process-identity.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

// ── The folder set we compare against ───────────────────────────────────────
const ourEqDirs = (cfg, withLogs = null) => evalBlock(
  `const __cfg = ${JSON.stringify(cfg)};
   function loadConfig() { return __cfg; }
   const __withLogs = ${JSON.stringify(withLogs)};
   function _dirHasEqLogs(d) { return __withLogs === null || __withLogs.some(x => x.toLowerCase() === String(d).toLowerCase()); }
  `
  + sliceBlock(src, 'function _ourEqDirs() {', '\n}'),
  ['_ourEqDirs'],
)._ourEqDirs();

describe('_ourEqDirs', () => {
  it('normalises what the user typed', () => {
    expect(ourEqDirs({ eqPaths: ['A:\\EQ\\', 'D:/Quarm'] })).toEqual(['a:\\eq', 'd:\\quarm']);
  });

  it('honours the legacy single-path key', () => {
    expect(ourEqDirs({ eqPath: 'A:\\EQ' })).toEqual(['a:\\eq']);
    // eqPaths wins when both are set — same precedence resolveEqDirsWithLogs uses.
    expect(ourEqDirs({ eqPaths: ['D:\\EQ'], eqPath: 'A:\\EQ' })).toEqual(['d:\\eq']);
  });

  it('drops excluded folders', () => {
    // The picker's unchecked rows must not resurrect as "ours" here.
    expect(ourEqDirs({ eqPaths: ['A:\\EQ', 'D:\\EQ'], eqPathsExcluded: ['d:\\eq'] })).toEqual(['a:\\eq']);
  });

  it('ignores a configured folder that holds no EQ logs', () => {
    // resolveEqDirsWithLogs() already falls back past a stale eqPaths entry. If
    // this did not, a leftover A:\\EQ would disown the client the user actually
    // plays from D:\\Quarm — and their overlays would vanish mid-raid.
    expect(ourEqDirs({ eqPaths: ['A:\\EQ', 'D:\\Quarm'] }, ['D:\\Quarm'])).toEqual(['d:\\quarm']);
    expect(ourEqDirs({ eqPaths: ['A:\\EQ'] }, []), 'no live folder → fail open').toEqual([]);
  });

  it('returns EMPTY when nothing is configured — the fail-open signal', () => {
    // A user who never set a folder must keep the old name-only behavior.
    // Returning something here instead would hide their overlays.
    expect(ourEqDirs({})).toEqual([]);
    expect(ourEqDirs({ eqPaths: [] })).toEqual([]);
    expect(ourEqDirs({ eqPaths: ['   '] })).toEqual([]);
  });
});

// ── Judging PIDs against that set ───────────────────────────────────────────
//
// Stubs execFile so the shipped resolver runs against canned PowerShell output.
function judge({ cfg, pids, stdout = '', err = null, throws = false }) {
  const prelude = `
    const __log = [];
    const __cfg = ${JSON.stringify(cfg)};
    function loadConfig() { return __cfg; }
    function appendAgentLog(s) { __log.push(s); }
    function require(mod) {
      if (mod !== 'child_process') throw new Error('unexpected require: ' + mod);
      if (${JSON.stringify(throws)}) throw new Error('spawn blocked');
      return { execFile: (_exe, _args, _opts, cb) => cb(${JSON.stringify(err)}, ${JSON.stringify(stdout)}) };
    }
    function _dirHasEqLogs() { return true; }
    const _eqPidVerdict = new Map();
    const _eqIgnoredPaths = new Map();
  `;
  const h = evalBlock(
    prelude + sliceBlock(src, 'function _ourEqDirs() {', '\n}') + '\n'
    + sliceBlock(src, 'function _resolveEqPidOwners(pids) {', '\n}'),
    ['_resolveEqPidOwners', '_eqPidVerdict', '_eqIgnoredPaths', '__log'],
  );
  return h._resolveEqPidOwners(pids).then(() => ({
    verdicts: Object.fromEntries(h._eqPidVerdict),
    ignored:  [...h._eqIgnoredPaths.values()],
    log: h.__log.join(''),
  }));
}

const QUARM = { eqPaths: ['A:\\EQ'] };

describe('_resolveEqPidOwners', () => {
  it('disowns an eqgame.exe from another install', async () => {
    const r = await judge({ cfg: QUARM, pids: [4242], stdout: '4242|D:\\EQLegends\\eqgame.exe\r\n' });
    expect(r.verdicts).toEqual({ 4242: false });
    expect(r.log, 'the log must name the path so this is diagnosable').toMatch(/D:\\EQLegends\\eqgame\.exe/);
    // …and the Resource use window gets it too, so "EverQuest closed" next to a
    // visibly running game explains itself on screen.
    expect(r.ignored).toEqual(['D:\\EQLegends\\eqgame.exe']);
  });

  it('claims the eqgame.exe in the configured folder', async () => {
    const r = await judge({ cfg: QUARM, pids: [100], stdout: '100|A:\\EQ\\eqgame.exe\r\n' });
    expect(r.verdicts).toEqual({ 100: true });
    expect(r.log).toBe('');
    expect(r.ignored, 'nothing to report when the client is ours').toEqual([]);
  });

  it('separates two clients running at once', async () => {
    // The exact situation reported: both up, only one of them ours.
    const r = await judge({
      cfg: QUARM, pids: [100, 4242],
      stdout: '100|A:\\EQ\\eqgame.exe\r\n4242|D:\\EQLegends\\eqgame.exe\r\n',
    });
    expect(r.verdicts).toEqual({ 100: true, 4242: false });
    expect(r.ignored, 'only the foreign client is named').toEqual(['D:\\EQLegends\\eqgame.exe']);
  });

  it('is case- and separator-insensitive about the path', async () => {
    const r = await judge({ cfg: { eqPaths: ['a:/eq/'] }, pids: [1], stdout: '1|A:\\EQ\\eqgame.exe\r\n' });
    expect(r.verdicts).toEqual({ 1: true });
  });

  it('does NOT treat a sibling folder as a prefix match', async () => {
    // A:\EQ must not claim A:\EQLegends — the separator in the comparison is
    // the whole reason this is startsWith(dir + '\\') and not startsWith(dir).
    const r = await judge({ cfg: QUARM, pids: [7], stdout: '7|A:\\EQLegends\\eqgame.exe\r\n' });
    expect(r.verdicts).toEqual({ 7: false });
  });

  // ── Fail-open: every way this can go wrong must claim the process ──────────
  it('claims everything when no EQ folder is configured', async () => {
    const r = await judge({ cfg: {}, pids: [1, 2], stdout: 'never read' });
    expect(r.verdicts).toEqual({ 1: true, 2: true });
  });

  it('claims everything when PowerShell errors', async () => {
    const r = await judge({ cfg: QUARM, pids: [1], err: 'timeout', stdout: '' });
    expect(r.verdicts).toEqual({ 1: true });
  });

  it('claims everything when PowerShell returns nothing', async () => {
    const r = await judge({ cfg: QUARM, pids: [1], stdout: '' });
    expect(r.verdicts).toEqual({ 1: true });
  });

  it('claims everything when the lookup cannot even be spawned', async () => {
    const r = await judge({ cfg: QUARM, pids: [1], throws: true });
    expect(r.verdicts).toEqual({ 1: true });
  });

  it('claims a PID the lookup silently skipped', async () => {
    // Access-denied on an elevated process yields a row with no path — or no
    // row at all. Unjudged must never mean disowned.
    const r = await judge({ cfg: QUARM, pids: [1, 2], stdout: '1|A:\\EQ\\eqgame.exe\r\n' });
    expect(r.verdicts).toEqual({ 1: true, 2: true });
  });

  it('claims a PID whose ExecutablePath came back blank', async () => {
    const r = await judge({ cfg: QUARM, pids: [1], stdout: '1|\r\n' });
    expect(r.verdicts).toEqual({ 1: true });
  });
});

// ── The tasklist parse that feeds it ────────────────────────────────────────
describe('_checkEqRunning', () => {
  // Pull the shipped regex out of main.js rather than restating it.
  const rxSrc = src.match(/for \(const m of String\(out\)\.matchAll\((\/.+?\/[gi]*)\)\)/);
  const pidsFrom = (out) => {
    const rx = new Function('return ' + rxSrc[1])();
    return [...String(out).matchAll(rx)].map(m => Number(m[1]));
  };

  it('reads PIDs out of real tasklist CSV', () => {
    expect(pidsFrom('"eqgame.exe","12345","Console","1","350,000 K"\r\n')).toEqual([12345]);
    expect(pidsFrom(
      '"eqgame.exe","100","Console","1","350,000 K"\r\n"eqgame.exe","4242","Console","1","512,000 K"\r\n',
    )).toEqual([100, 4242]);
  });

  it('finds nothing in the no-match banner', () => {
    // tasklist prints this to STDOUT, which is why the old substring test
    // needed replacing with a row parse rather than just being tightened.
    expect(pidsFrom('INFO: No tasks are running which match the specified criteria.\r\n')).toEqual([]);
  });

  it('no longer decides on the process name alone', () => {
    const fn = sliceBlock(src, 'function _checkEqRunning() {', '\n}');
    expect(fn, 'name-only matching is the bug').not.toMatch(/resolve\(\/eqgame\\\.exe\/i\.test\(out\)\)/);
    expect(fn).toMatch(/_resolveEqPidOwners\(unknown\)/);
  });

  it('treats an unjudged PID as ours', () => {
    // `!== false` is the fail-open default in the shipped reducer. If this ever
    // becomes `=== true`, a lookup that has not finished hides the overlays.
    const fn = sliceBlock(src, 'function _checkEqRunning() {', '\n}');
    expect(fn).toMatch(/pids\.some\(p => _eqPidVerdict\.get\(p\) !== false\)/);
  });

  it('caches per PID so the expensive lookup runs once per launch', () => {
    // This poll fires every 5s. Without the cache it would spawn PowerShell
    // 720 times an hour.
    const fn = sliceBlock(src, 'function _checkEqRunning() {', '\n}');
    expect(fn).toMatch(/const unknown = pids\.filter\(p => !_eqPidVerdict\.has\(p\)\);/);
    expect(fn, 'a hit must skip the lookup entirely').toMatch(/if \(!unknown\.length\) return done\(\);/);
    // …and must not leak PIDs for games that have since exited.
    expect(fn).toMatch(/if \(!pids\.includes\(known\)\) \{ _eqPidVerdict\.delete\(known\); _eqIgnoredPaths\.delete\(known\); \}/);
    expect(fn).toMatch(/if \(!pids\.length\) \{ _eqPidVerdict\.clear\(\); _eqIgnoredPaths\.clear\(\);/);
  });
});
