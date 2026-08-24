// Steam Deck (#156 Phase 2): the Wine→Unix pipe bridge supervisor.
//
// The load-bearing fact this file protects: a Wine named pipe belongs to the
// WINESERVER that created it, so the bridge program must run inside EQ's own
// Wine environment (docs/mimic-steamdeck-zeal-bridge.md). Everything here tests
// the reconstruction of that environment from /proc plus the two spawn shapes
// it produces — a host wineserver (Lutris/GE-Proton) and a Flatpak'd one
// (Bottles) — because getting either wrong looks identical from the outside:
// a bridge that starts, talks to the wrong wineserver, and finds no pipe.
//
// The helpers are pure, so they are exercised directly; the supervisor loop
// itself needs a live Deck and is not simulated here.
//
// Run: npx vitest run test/linux-zeal-bridge.test.js

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const B = require_(path.join(ROOT, 'apps', 'mimic', 'linuxZealBridge.js'));

describe('/proc environ parsing', () => {
  it('splits NUL-separated KEY=VALUE pairs', () => {
    const buf = Buffer.from('WINEPREFIX=/home/deck/Games/everquest\0WINELOADER=/usr/bin/wine\0');
    expect(B._parseEnviron(buf)).toEqual({
      WINEPREFIX: '/home/deck/Games/everquest',
      WINELOADER: '/usr/bin/wine',
    });
  });

  it('keeps values that themselves contain "="', () => {
    const out = B._parseEnviron('WINEDLLOVERRIDES=d3d9=n,b\0');
    expect(out.WINEDLLOVERRIDES).toBe('d3d9=n,b');
  });

  it('carries only the wine-selecting vars, never the game LD_PRELOAD', () => {
    const env = B._wineEnvFor({
      WINEPREFIX: '/p', PROTONPATH: '/ge', XDG_RUNTIME_DIR: '/run/user/1000',
      LD_PRELOAD: '/steam/overlay.so', SDL_VIDEODRIVER: 'wayland',
    });
    expect(env.WINEPREFIX).toBe('/p');
    expect(env.PROTONPATH).toBe('/ge');
    expect(env.XDG_RUNTIME_DIR).toBe('/run/user/1000');
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.SDL_VIDEODRIVER).toBeUndefined();
  });
});

describe('which world is EQ running in', () => {
  it('a loader that exists on the host is a host wineserver (Lutris/umu)', () => {
    // process.execPath is guaranteed to exist here — stands in for
    // ~/Games/everquest/.wine-runner/bin/wine.
    expect(B._classifyLoader(process.execPath, {}).kind).toBe('host');
  });

  it('a /app/ loader is a Flatpak sandbox (Bottles)', () => {
    const c = B._classifyLoader('/app/bin/wine', {});
    expect(c.kind).toBe('flatpak');
    expect(c.flatpakId).toBe('com.usebottles.bottles');
  });

  it('FLATPAK_ID in the environment names the sandbox', () => {
    expect(B._classifyLoader('/whatever/wine', { FLATPAK_ID: 'net.lutris.Lutris' }))
      .toEqual({ kind: 'flatpak', flatpakId: 'net.lutris.Lutris' });
  });

  it('an unreachable loader under pressure-vessel is a container we cannot join', () => {
    const c = B._classifyLoader('/usr/lib/pressure-vessel/wine', { PRESSURE_VESSEL_RUNTIME: '1' });
    expect(c.kind).toBe('container');
    expect(c.container).toBe('pressure-vessel');
  });

  it('maps wine-preloader back to the loader you can actually exec', () => {
    const loader = B._resolveLoader(0, { WINELOADER: '/opt/ge/bin/wine64-preloader' }, []);
    expect(loader).toBe('/opt/ge/bin/wine64');
  });
});

describe('bridge argv shapes', () => {
  const socket = '/run/user/1000/wolfpack-zeal.sock';

  it('outflow gets flags + --outbound-pipe (Zeal opens PIPE_ACCESS_OUTBOUND)', () => {
    const argv = B._bridgeArgv({ bridgeExe: '/eq/outflow.exe', pipeName: 'zeal_1234', socketPath: socket, cfg: {} });
    expect(argv).toEqual(['--pipe', '\\\\.\\pipe\\zeal_1234', '--socket', socket, '--outbound-pipe']);
  });

  it('winestreamproxy gets the positional pipe name + unix: URI', () => {
    const argv = B._bridgeArgv({ bridgeExe: '/eq/winestreamproxy.exe', pipeName: 'zeal_77', socketPath: socket, cfg: {} });
    expect(argv).toEqual(['zeal_77', 'unix:' + socket]);
  });

  it('a cfg template wins and expands {pipe}/{pipeName}/{socket}', () => {
    const argv = B._bridgeArgv({
      bridgeExe: '/eq/other.exe', pipeName: 'zeal_9', socketPath: socket,
      cfg: { zealBridgeArgs: ['--in={pipe}', '--name={pipeName}', '--out={socket}'] },
    });
    expect(argv).toEqual(['--in=\\\\.\\pipe\\zeal_9', '--name=zeal_9', '--out=' + socket]);
  });
});

describe('socket placement', () => {
  it('a Flatpak puts the socket in the app data dir, NOT /tmp', () => {
    // A sandbox's /tmp and XDG_RUNTIME_DIR are per-instance tmpfs mounts, so a
    // socket there is invisible to host Mimic. ~/.var/app/<id>/ is the same
    // directory on both sides.
    const p = B._socketPathFor({
      info: { kind: 'flatpak', flatpakId: 'com.usebottles.bottles', env: {} },
      cfg: {}, home: '/home/deck',
    });
    expect(p).toBe('/home/deck/.var/app/com.usebottles.bottles/data/wolfpack-zeal.sock');
  });

  it('a host wineserver shares the runtime dir', () => {
    const p = B._socketPathFor({
      info: { kind: 'host', env: { XDG_RUNTIME_DIR: '/nonexistent-runtime-dir' } },
      cfg: {}, home: '/home/deck',
    });
    // The runtime dir does not exist in CI, so it falls back to the temp dir —
    // either way it must be an absolute path ending in our socket name.
    expect(path.isAbsolute(p)).toBe(true);
    expect(path.basename(p)).toBe('wolfpack-zeal.sock');
  });

  it('cfg.zealBridgeSocket overrides everything', () => {
    const p = B._socketPathFor({ info: { kind: 'flatpak', env: {} }, cfg: { zealBridgeSocket: '/tmp/mine.sock' } });
    expect(p).toBe('/tmp/mine.sock');
  });

  it('never exceeds the kernel unix-socket path limit', () => {
    const p = B._socketPathFor({ info: { kind: 'host', env: {} }, cfg: {} });
    expect(p.length).toBeLessThan(108);
  });
});

describe('spawn plans — same wineserver or nothing', () => {
  const info = (over) => Object.assign({
    pid: 4242, kind: 'host', loader: '/opt/ge/bin/wine',
    env: { WINEPREFIX: '/home/deck/Games/everquest' },
  }, over);

  it('host: exec the loader itself with EQ\'s WINEPREFIX', () => {
    const plan = B._spawnPlan({ info: info(), bridgeExe: '/eq/outflow.exe', argv: ['--x'], cfg: {} });
    expect(plan.cmd).toBe('/opt/ge/bin/wine');
    expect(plan.args).toEqual(['/eq/outflow.exe', '--x']);
    expect(plan.env.WINEPREFIX).toBe('/home/deck/Games/everquest');
  });

  it('flatpak: JOIN the running sandbox with `flatpak enter <pid>`', () => {
    // `flatpak run` would start a NEW instance with its own /tmp and its own
    // wineserver — the bridge would then see no pipe at all. Entering the
    // instance EQ is already in is the only way to share the wineserver.
    const plan = B._spawnPlan({
      info: info({ kind: 'flatpak', flatpakId: 'com.usebottles.bottles', loader: '/app/bin/wine' }),
      bridgeExe: '/home/deck/.var/app/com.usebottles.bottles/data/bottles/bottles/Quarm/drive_c/Quarm/outflow.exe',
      argv: ['--outbound-pipe'], cfg: {},
    });
    expect(plan.cmd).toBe('flatpak');
    expect(plan.args.slice(0, 4)).toEqual(['enter', '4242', 'env', 'WINEPREFIX=/home/deck/Games/everquest']);
    expect(plan.args).toContain('/app/bin/wine');
    expect(plan.args[plan.args.length - 1]).toBe('--outbound-pipe');
  });

  it('flatpak mode "run" stays available as the documented escape hatch', () => {
    const plan = B._spawnPlan({
      info: info({ kind: 'flatpak', flatpakId: 'com.usebottles.bottles', loader: '/app/bin/wine' }),
      bridgeExe: '/eq/outflow.exe', argv: [], cfg: { zealBridgeFlatpakMode: 'run' },
    });
    expect(plan.args[0]).toBe('run');
    expect(plan.args).toContain('--command=/app/bin/wine');
    expect(plan.args).toContain('--env=WINEPREFIX=/home/deck/Games/everquest');
  });
});

describe('the WINDOWS pid, which is what the pipe name carries', () => {
  it('reads eqgame.exe out of wine tasklist CSV', () => {
    const out = '"eqgame.exe","31","Console","1","123,456 K"\r\n"explorer.exe","12","Console","1","1 K"';
    expect(B._parseWineTasklist(out)).toBe(31);
  });

  it('tolerates a column-formatted build', () => {
    expect(B._parseWineTasklist('eqgame.exe                   44 Console            1     100 K')).toBe(44);
  });

  it('returns null when EQ is not in the list', () => {
    expect(B._parseWineTasklist('"explorer.exe","12","Console","1","1 K"')).toBeNull();
  });
});

describe('bridge program discovery', () => {
  it('reports the configured path as missing rather than silently searching on', () => {
    const found = B._resolveBridgeExe({ zealBridgeExe: '/does/not/exist/outflow.exe' }, {}, []);
    expect(found.exe).toBeNull();
    expect(found.missingConfigured).toBe('/does/not/exist/outflow.exe');
  });

  it('lists where it looked so the "install this" message can say so', () => {
    const found = B._resolveBridgeExe({}, { prefix: '/home/deck/Games/everquest', cmdline: [] }, ['/eq/dir']);
    expect(found.exe).toBeNull();
    expect(found.searched).toContain('/eq/dir');
    expect(found.searched).toContain('/home/deck/Games/everquest/drive_c');
  });
});

describe('the handoff to the existing reader', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, 'apps', 'mimic', p), 'utf8');

  it('zealPipe.js still connects to ZEAL_PIPE_SOCKET on non-Windows', () => {
    // The bridge publishes its socket by setting process.env.ZEAL_PIPE_SOCKET,
    // which this poll re-reads every 25s. Break that and the bridge runs
    // perfectly while every overlay stays empty.
    const src = read('zealPipe.js');
    expect(src).toContain('process.env.ZEAL_PIPE_SOCKET');
    expect(src).toContain("process.platform !== 'win32'");
  });

  it('main.js starts the bridge only on Linux', () => {
    const src = read('main.js');
    expect(src).toContain("require('./linuxZealBridge')");
    const at = src.indexOf('startLinuxZealBridge({');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, at - 400), at)).toContain("process.platform === 'linux'");
  });

  it('main.js publishes the bridge status to renderers', () => {
    expect(read('main.js')).toContain('zealBridge: zealBridge ? zealBridge.status() : null');
  });
});
