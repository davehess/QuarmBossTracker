// Linux "is EverQuest running?" (apps/mimic/main.js _isEqRunning). Through a shell, `pgrep -f
// eqgame.exe` matched its own `sh -c` parent, so EQ always read as running and the Zeal install
// refused (a native-Wine tester, 2026-10-08). The check must run pgrep directly, with no shell.
import { describe, it, expect } from 'vitest';
import path from 'path';
import { readSource, sliceBlock } from './_source-slice.js';

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

  it('a pid back means EQ is running', async () => {
    const cp = { execFile: (f, a, o, cb) => cb(null, '4242\n'), exec: () => { throw new Error('no'); } };
    expect(await load('linux', cp)()).toBe(true);
  });
});
