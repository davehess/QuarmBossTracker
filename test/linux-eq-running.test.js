// Linux "is EverQuest running?" (apps/mimic/main.js _isEqRunning). Through a shell, `pgrep -f
// eqgame.exe` matched its own `sh -c` parent, so EQ always read as running and the Zeal install
// refused (a native-Wine tester, 2026-10-08). The check must run pgrep directly, with no shell.
import { describe, it, expect } from 'vitest';
import path from 'path';
import { readSource, sliceBlock, stripJs } from './_source-slice.js';

const MAIN = path.join(__dirname, '..', 'apps', 'mimic', 'main.js');
const block = sliceBlock(readSource(MAIN), 'async function _isEqRunning() {', '\nfunction _backupAndWriteFile');
const body = block.slice(0, block.lastIndexOf('\nfunction _backupAndWriteFile'));

function load(platform, cp) {
  const fakeRequire = (m) => { if (m === 'child_process') return cp; throw new Error('unexpected require ' + m); };
  // eslint-disable-next-line no-new-func
  return new Function('require', 'process', body + '\nreturn _isEqRunning;')(fakeRequire, { platform });
}

describe('Linux EQ-running check', () => {
  it('runs pgrep itself (execFile), never through a shell', async () => {
    const calls = [];
    const cp = {
      execFile: (file, args, opts, cb) => { calls.push({ file, args }); cb(Object.assign(new Error('no match'), { code: 1 }), ''); },
      exec: () => { throw new Error('exec must not be used on Linux'); },
    };
    expect(await load('linux', cp)()).toBe(false);
    expect(calls).toEqual([{ file: 'pgrep', args: ['-f', 'eqgame\\.exe'] }]);
  });

  // FB-66: the overlay gate's poll (_checkEqRunning) answered "running" unconditionally on Linux,
  // so overlays never hid when the game closed. It must ask the pgrep check.
  it('the overlay gate poll asks the pgrep check on Linux', async () => {
    const poll = sliceBlock(readSource(MAIN), 'function _checkEqRunning() {', '\n}');
    for (const answer of [false, true]) {
      // eslint-disable-next-line no-new-func
      const fn = new Function('process', '_isEqRunning', 'spawn', poll + '\nreturn _checkEqRunning;')(
        { platform: 'linux' }, async () => answer, () => { throw new Error('tasklist must not run on Linux'); });
      expect(await fn()).toBe(answer);
    }
  });

  it('a pid back means EQ is running', async () => {
    const cp = { execFile: (f, a, o, cb) => cb(null, '4242\n'), exec: () => { throw new Error('no'); } };
    expect(await load('linux', cp)()).toBe(true);
  });
});

// FB-66: the poller that feeds the overlay gate bailed on anything but win32, so on Linux the
// pgrep answer above was never asked and overlays stayed up after the game closed. Run the real
// function with a fake platform and count whether it schedules a poll.
describe('EQ presence poller platform guard', () => {
  const src = readSource(MAIN);
  const startFn = sliceBlock(src, 'function _startEqPolling() {', '\n}');

  function scheduled(platform) {
    const timers = [];
    // eslint-disable-next-line no-new-func
    const start = new Function('process', 'setTimeout', 'clearTimeout', '_pollEqPresence',
      'let _eqPollTimer = null, _eqPollStopped = false, _eqRunning = false, _eqAbsentStreak = 0;\n' +
      'const _eqPollDelay = () => 10;\n' + startFn + '\nreturn _startEqPolling;')(
      { platform }, (fn, ms) => { timers.push(ms); return timers.length; }, () => {}, async () => {});
    start();
    return timers.length;
  }

  it('polls on win32 and on linux', () => {
    expect(scheduled('win32')).toBe(1);
    expect(scheduled('linux')).toBe(1);
  });

  it('stays idle on a platform with no presence check', () => {
    expect(scheduled('darwin')).toBe(0);
  });

  it('the tray switch for the option sits behind a guard that admits linux', () => {
    const code = stripJs(src);
    const at = code.indexOf("label: 'Hide overlays when EverQuest isn\\'t running'");
    expect(at).toBeGreaterThan(0);
    const guard = code.slice(code.lastIndexOf('...(', at), at);
    expect(guard).toMatch(/linux/);
  });
});
