// linuxZealBridge.js — get Zeal's Windows named pipe out of Wine/Proton and
// into the native Linux Mimic (#156 Phase 2). Linux-only; every entry point is
// `process.platform === 'linux'`-guarded and this file is never required into a
// code path Windows runs.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A BRIDGE AT ALL — the one fact the next reader needs
// ─────────────────────────────────────────────────────────────────────────────
// Zeal streams game state out `\\.\pipe\zeal_<eqgame-PID>`. A Wine named pipe
// is NOT a filesystem object: it is owned by the **wineserver** of the exact
// Wine instance that created it and is reachable only through that same
// wineserver's socket namespace. A native Linux process cannot open it, and no
// environment variable makes it possible — this is a deployment property, not a
// flag (docs/mimic-steamdeck-zeal-bridge.md §"The one thing that decides
// everything: the wineserver, not a flag").
//
// So the bridge program must RUN INSIDE THE SAME WINE ENVIRONMENT AS
// eqgame.exe: same WINEPREFIX, same wine loader, same sandbox (if any). Then it
// is just another `wine program.exe` sharing that wineserver, and it can hand
// the bytes out to a Unix socket that the host-side Mimic reads. The socket is
// where the Wine world ends and ours begins.
//
// This module's whole job is to reconstruct "the same Wine environment as EQ"
// from the OUTSIDE, at runtime, with no configuration from the user — and it
// does it through /proc, which is same-user readable:
//
//   /proc/<pid>/environ  → WINEPREFIX, WINELOADER, PROTONPATH, XDG_RUNTIME_DIR…
//   /proc/<pid>/exe      → the wine loader actually hosting eqgame.exe, AS SEEN
//                          IN THAT PROCESS'S MOUNT NAMESPACE (a `/app/…` target
//                          that does not exist on the host is the tell that EQ
//                          is running inside a Flatpak — i.e. Bottles)
//   /proc/<pid>/cmdline  → the loader + `…/eqgame.exe patchme` argv, as backup
//
// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER LOAD-BEARING FACT — the pipe name carries the WINDOWS pid
// ─────────────────────────────────────────────────────────────────────────────
// `zeal_<PID>` is Zeal's GetCurrentProcessId(), i.e. the pid the WINESERVER
// assigned — not the Linux pid that pgrep just gave us. The two are unrelated
// numbers. The only way to map across is to ask the same wineserver, which is
// what `wine tasklist` does (the Quarm.Guide launcher script in the doc does
// exactly this). That call is itself a wine program, so it needs the same
// environment reconstruction as the bridge — one more reason it all lives here.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT WE SPAWN
// ─────────────────────────────────────────────────────────────────────────────
// Preferred bridge: FyraLabs/outflow — a Wine program using Wine 10's AF_UNIX
// support, with an outbound-pipe mode (Zeal opens PIPE_ACCESS_OUTBOUND).
// Fallback: openglfreak/winestreamproxy, same idea, older, positional argv.
//
// **Mimic does not ship either binary.** If we cannot find one we do NOT
// silently no-op: `status()` goes to `needs-bridge` with a message naming the
// download and the exact folder to drop it in, and the same line is written to
// the agent log so a raider can paste it as evidence.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW THE SOCKET REACHES THE READER
// ─────────────────────────────────────────────────────────────────────────────
// apps/mimic/zealPipe.js already has the socket end: on non-Windows its poll
// reads `process.env.ZEAL_PIPE_SOCKET` EVERY 25s and connects to it, and the
// JSON framing on the socket is byte-identical to the Windows pipe. So we set
// that variable in-process once the bridge is up and the existing reader picks
// it up on its next poll — no restart, and not one line of zealPipe.js changes.
// (A cfg/state channel would have needed a zealPipe change for no gain; the env
// hook is also what the manual/scripted path in the docs uses, so honoring it
// keeps one contract instead of two.) If the user already exported
// ZEAL_PIPE_SOCKET before launching Mimic — the documented manual path — we
// stand down entirely and never fight them for it.
//
// ─────────────────────────────────────────────────────────────────────────────
// CONFIG (apps/mimic/mimic.config.json — all optional)
// ─────────────────────────────────────────────────────────────────────────────
//   zealBridge:        false disables this module entirely
//   zealBridgeExe:     absolute path to outflow.exe / winestreamproxy.exe
//   zealBridgeSocket:  override the Unix socket path
//   zealBridgeArgs:    array argv template; {pipe} {pipeName} {socket} expand
//   zealBridgeFlatpakMode: 'enter' (default) | 'run'  — see _spawnPlan()
//   zealBridgePipeName: force the pipe name (skips the `wine tasklist` lookup)
'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

// Poll cadences. Deliberately lazy: the expensive calls (pgrep, `wine
// tasklist`) only run while we have no healthy bridge child.
const TICK_EQ_DOWN_MS   = 30_000;
const TICK_EQ_UP_MS     = 10_000;
const TICK_IDLE_MS      = 60_000;   // states only the user can move us out of
const RETRY_BASE_MS     = 15_000;
const RETRY_MAX_MS      = 5 * 60_000;
const HEALTHY_AFTER_MS  = 60_000;   // child alive this long ⇒ reset the backoff
const NEEDS_SETUP_RELOG_MS = 10 * 60_000;

// Unix socket paths are capped at ~108 bytes by the kernel; stay well under.
const SOCK_PATH_MAX = 100;

// Env vars we carry from eqgame.exe to the bridge. An allowlist rather than the
// whole environ on purpose: WINE*/PROTON*/STEAM_COMPAT* + the runtime dir are
// what select the wineserver, while the game's own LD_PRELOAD (Steam overlay,
// gamemode) and its SDL/DXVK display plumbing have no business wrapping a
// headless pipe forwarder and have their own ways to fail.
const ENV_PREFIXES = ['WINE', 'PROTON', 'STEAM_COMPAT', 'DXVK_STATE', 'VKD3D_'];
const ENV_EXACT = [
  'WINEPREFIX', 'WINELOADER', 'WINESERVER', 'WINEDLLPATH', 'WINEARCH',
  'WINEESYNC', 'WINEFSYNC', 'WINEDLLOVERRIDES', 'WINEDEBUG',
  'PROTONPATH', 'STEAM_COMPAT_DATA_PATH', 'STEAM_COMPAT_CLIENT_INSTALL_PATH',
  'XDG_RUNTIME_DIR', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME',
  'HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'DISPLAY',
];

// ── /proc readers ───────────────────────────────────────────────────────────

// /proc/<pid>/environ is NUL-separated `KEY=VALUE`. Same-user readable, which
// is the entire reason this approach works without root or ptrace.
function _parseEnviron(buf) {
  const out = {};
  for (const entry of String(buf || '').split('\0')) {
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    out[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return out;
}

function _readEnviron(pid) {
  try { return _parseEnviron(fs.readFileSync(`/proc/${pid}/environ`)); }
  catch { return null; }
}

function _readCmdline(pid) {
  try {
    return String(fs.readFileSync(`/proc/${pid}/cmdline`))
      .split('\0').filter(Boolean);
  } catch { return []; }
}

// readlink /proc/<pid>/exe. NOTE: the string we get back is the path as
// recorded in THAT process's mount namespace. For a Flatpak'd Bottles the
// answer is often `/app/bin/wine` — a path that does not exist on the host.
// That is not a failure; it is the detection signal (see _classifyLoader).
function _readExe(pid) {
  try { return fs.readlinkSync(`/proc/${pid}/exe`); } catch { return null; }
}

// ── Wine environment reconstruction ─────────────────────────────────────────

// Which wine binary is hosting eqgame.exe? Preference order:
//   1. /proc/<pid>/exe — the truth, whatever the launcher claimed.
//   2. WINELOADER from the process env (Lutris/umu both set it).
//   3. argv[0] of the cmdline (`/…/bin/wine /…/eqgame.exe patchme`).
// Wine's preloader can leave exe pointing at `wine-preloader`; map it back to
// the sibling `wine`, which is what you must exec to run another program.
function _resolveLoader(pid, env, cmdline) {
  const cands = [];
  const exe = _readExe(pid);
  if (exe) cands.push(exe);
  if (env && env.WINELOADER) cands.push(env.WINELOADER);
  if (cmdline && cmdline[0]) cands.push(cmdline[0]);
  for (let c of cands) {
    if (!c) continue;
    if (/wine(64)?-preloader$/.test(c)) c = c.replace(/-preloader$/, '');
    if (/(^|\/)(wine|wine64)$/.test(c) || /\/wine(64)?$/.test(c)) return c;
  }
  // Nothing looked like a loader — hand back the best guess so the caller can
  // report it in the error string instead of a bare "not found".
  return cands[0] || null;
}

// Three worlds, and the spawn shape differs in each:
//   'host'      — Lutris / umu / plain wine. The wineserver is an ordinary host
//                 process and the loader path is executable right here.
//   'flatpak'   — Bottles. The loader we read from /proc lives inside the
//                 sandbox (`/app/…`, or a path absent from the host), so it can
//                 only be exec'd by joining that sandbox.
//   'container' — Steam's pressure-vessel (Proton launched from Steam) or an
//                 unknown sandbox: a namespace we have no supported way into.
//                 Reported honestly rather than mis-handled as Flatpak.
function _classifyLoader(loader, env) {
  const e = env || {};
  if (e.FLATPAK_ID) return { kind: 'flatpak', flatpakId: e.FLATPAK_ID };
  if (e.container === 'flatpak') return { kind: 'flatpak', flatpakId: 'com.usebottles.bottles' };
  if (loader && /^\/app\//.test(loader)) return { kind: 'flatpak', flatpakId: 'com.usebottles.bottles' };
  // A loader path we cannot see on the host came from somebody else's mount
  // namespace. pressure-vessel names itself in the environment; anything else
  // unreadable is an unknown container and gets the same honest answer.
  if (loader && !_exists(loader)) {
    const pv = Object.keys(e).some(k => k.startsWith('PRESSURE_VESSEL')) || !!e.STEAM_COMPAT_MOUNTS;
    return { kind: 'container', flatpakId: null, container: pv ? 'pressure-vessel' : 'unknown' };
  }
  return { kind: 'host', flatpakId: null };
}

function _exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }

function _wineEnvFor(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (ENV_EXACT.includes(k) || ENV_PREFIXES.some(p => k.startsWith(p))) out[k] = v;
  }
  return out;
}

// Everything we know about the running client, in one object.
function inspectEqProcess(pid) {
  const env = _readEnviron(pid);
  if (!env) return { pid, ok: false, reason: `cannot read /proc/${pid}/environ` };
  const cmdline = _readCmdline(pid);
  const loader  = _resolveLoader(pid, env, cmdline);
  const cls     = _classifyLoader(loader, env);
  return {
    pid, ok: true,
    prefix: env.WINEPREFIX || null,
    loader,
    kind: cls.kind,
    flatpakId: cls.flatpakId,
    container: cls.container || null,
    env: _wineEnvFor(env),
    cmdline,
  };
}

// ── Process discovery ───────────────────────────────────────────────────────

// Mimic already finds the client this way in main.js `_isEqRunning()` (pgrep -f
// eqgame.exe). We need the pids themselves, so this is the same probe, listed.
function _pgrepEqGame() {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', 'eqgame.exe'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const pids = [];
      for (const line of String(stdout).split('\n')) {
        const n = parseInt(line.trim(), 10);
        if (Number.isInteger(n) && n > 0 && n !== process.pid) pids.push(n);
      }
      resolve(pids);
    });
  });
}

// Of the pids pgrep matched, the ones that are really a Wine-hosted eqgame:
// a WINEPREFIX in the environment and eqgame.exe somewhere in the argv.
// (pgrep -f also matches launcher shells and, on a Deck, the Steam/Lutris
// wrapper whose command line merely mentions the exe.) A process whose
// /proc/<pid>/exe really resolves to a wine loader sorts first — that is the
// game itself rather than the script that started it.
function _pickEqProcess(pids) {
  const infos = [];
  for (const pid of pids) {
    const info = inspectEqProcess(pid);
    if (!info.ok || !info.prefix) continue;
    if (!/eqgame\.exe/i.test(info.cmdline.join(' '))) continue;
    info.wineish = !!(info.loader && /wine(64)?$/.test(info.loader));
    infos.push(info);
  }
  infos.sort((a, b) => (Number(b.wineish) - Number(a.wineish)) || (a.pid - b.pid));
  return infos;
}

// ── Windows pid → pipe name ─────────────────────────────────────────────────

// Wine's tasklist prints CSV with /FO CSV /NH, but builds differ and some print
// a column layout. Take the first integer that follows an eqgame.exe mention.
function _parseWineTasklist(stdout) {
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!/eqgame\.exe/i.test(line)) continue;
    const csv = /"eqgame\.exe"\s*,\s*"?(\d+)"?/i.exec(line);
    if (csv) return parseInt(csv[1], 10);
    const loose = /eqgame\.exe["',\s]+(\d+)/i.exec(line);
    if (loose) return parseInt(loose[1], 10);
  }
  return null;
}

// ── Bridge program discovery ────────────────────────────────────────────────

const BRIDGE_NAMES = ['outflow.exe', 'winestreamproxy.exe'];

// Look where a raider would plausibly have dropped it: the configured path
// first, then next to eqgame.exe (which is inside the prefix, so it is visible
// from BOTH the host and a Flatpak sandbox — the reason we recommend that
// folder), then the prefix root.
function _resolveBridgeExe(cfg, info, eqDirs) {
  const cfgPath = cfg && cfg.zealBridgeExe;
  if (cfgPath) {
    return _exists(cfgPath)
      ? { exe: cfgPath, from: 'cfg.zealBridgeExe' }
      : { exe: null, from: 'cfg.zealBridgeExe', missingConfigured: cfgPath, searched: [cfgPath] };
  }
  const dirs = [];
  for (const d of eqDirs || []) if (d) dirs.push(d);
  for (const a of (info && info.cmdline) || []) {
    if (/eqgame\.exe$/i.test(a) && a.includes('/')) dirs.push(path.dirname(a));
  }
  if (info && info.prefix) dirs.push(path.join(info.prefix, 'drive_c'), info.prefix);
  for (const dir of dirs) {
    for (const name of BRIDGE_NAMES) {
      const p = path.join(dir, name);
      if (_exists(p)) return { exe: p, from: dir };
    }
  }
  return { exe: null, from: null, searched: dirs };
}

function _setupMessage(dirs, missingConfigured) {
  if (missingConfigured) {
    return `Zeal bridge not found at the configured path "${missingConfigured}" `
         + '(cfg.zealBridgeExe). Fix the path, or clear it and drop outflow.exe '
         + 'next to eqgame.exe so Mimic finds it on its own.';
  }
  const where = (dirs && dirs.length) ? dirs[0] : 'your EverQuest folder';
  return 'Zeal bridge not installed. Live overlays on Linux need a Wine-side '
       + 'pipe bridge, which Mimic does not ship: download outflow.exe from '
       + 'github.com/FyraLabs/outflow (releases) and put it in ' + where
       + ' — next to eqgame.exe — then relaunch EverQuest. '
       + '(winestreamproxy.exe from github.com/openglfreak/winestreamproxy works too, '
       + 'or set "zealBridgeExe" to its full path in mimic.config.json.) '
       + 'Everything log-driven — parses, chat upload, trigger callouts, UI Studio — '
       + 'keeps working without it.';
}

// ── argv shapes ─────────────────────────────────────────────────────────────

// outflow takes flags and needs --outbound-pipe (Zeal opens the pipe
// PIPE_ACCESS_OUTBOUND); winestreamproxy takes two positional args, the second
// a `unix:` URI. Both shapes are documented in
// docs/mimic-steamdeck-zeal-bridge.md §"The bridge". A cfg template wins over
// both so an unforeseen build can still be driven without a Mimic release.
function _bridgeArgv({ bridgeExe, pipeName, socketPath, cfg }) {
  const pipe = '\\\\.\\pipe\\' + pipeName;
  const tmpl = cfg && Array.isArray(cfg.zealBridgeArgs) ? cfg.zealBridgeArgs : null;
  if (tmpl) {
    return tmpl.map(a => String(a)
      .replace('{pipe}', pipe)
      .replace('{pipeName}', pipeName)
      .replace('{socket}', socketPath));
  }
  if (/outflow/i.test(path.basename(bridgeExe || ''))) {
    return ['--pipe', pipe, '--socket', socketPath, '--outbound-pipe'];
  }
  return [pipeName, 'unix:' + socketPath];
}

// ── Socket placement ────────────────────────────────────────────────────────

// The socket is the handoff point, so it must be one path that BOTH worlds can
// see. That is trivial for a host wineserver and a trap for a sandbox:
// a Flatpak's /tmp and its XDG_RUNTIME_DIR are per-instance tmpfs mounts, so a
// socket at /tmp/zeal.sock inside Bottles is invisible to host Mimic. The app's
// own data dir (~/.var/app/<id>/) IS the same directory on both sides, so that
// is where the sandbox case puts it.
function _socketPathFor({ info, cfg, home }) {
  if (cfg && cfg.zealBridgeSocket) return cfg.zealBridgeSocket;
  const h = home || os.homedir();
  if (info && info.kind === 'flatpak') {
    const id = info.flatpakId || 'com.usebottles.bottles';
    return path.join(h, '.var', 'app', id, 'data', 'wolfpack-zeal.sock');
  }
  const run = info && info.env && info.env.XDG_RUNTIME_DIR;
  const base = (run && _exists(run)) ? run : os.tmpdir();
  const p = path.join(base, 'wolfpack-zeal.sock');
  return p.length <= SOCK_PATH_MAX ? p : path.join('/tmp', 'wpzeal.sock');
}

// ── Spawn plan ──────────────────────────────────────────────────────────────

// host: exec the loader directly with EQ's Wine env — same wineserver, done.
//
// flatpak: `flatpak run` is the WRONG answer even though it looks right. It
// starts a NEW sandbox instance with a fresh /tmp and a fresh XDG_RUNTIME_DIR,
// so the wineserver it finds (or starts) is a DIFFERENT one and the pipe is
// invisible — the exact failure the doc describes. `flatpak enter <pid>` joins
// the namespaces of the instance already running EQ, which is the only way in
// from outside. We go through `env` inside the sandbox because flatpak enter
// has no --env of its own. Mode 'run' stays available via cfg for the case
// where a user's flatpak build refuses `enter` (it needs to setns into your own
// sandbox; unprivileged, but not universally permitted).
function _spawnPlan({ info, bridgeExe, argv, cfg }) {
  const envPairs = Object.entries(info.env || {}).map(([k, v]) => `${k}=${v}`);
  if (info.kind === 'flatpak') {
    const mode = (cfg && cfg.zealBridgeFlatpakMode) || 'enter';
    const id = info.flatpakId || 'com.usebottles.bottles';
    if (mode === 'run') {
      const flags = envPairs.map(p => '--env=' + p);
      return { cmd: 'flatpak', args: ['run', '--command=' + info.loader, ...flags, id, bridgeExe, ...argv] };
    }
    return { cmd: 'flatpak', args: ['enter', String(info.pid), 'env', ...envPairs, info.loader, bridgeExe, ...argv] };
  }
  return { cmd: info.loader, args: [bridgeExe, ...argv], env: Object.assign({}, process.env, info.env) };
}

// ── The supervisor ──────────────────────────────────────────────────────────

// A ZEAL_PIPE_SOCKET that was in our environment at startup came from the user
// (the documented manual/launcher-script path). Captured before we ever write
// the variable ourselves so the two can never be confused.
const EXTERNAL_SOCKET = process.env.ZEAL_PIPE_SOCKET || null;

function startLinuxZealBridge({ log, getConfig, onStatus, eqDirs } = {}) {
  const _log = (s) => { try { if (log) log(s); } catch { /* logging must never throw */ } };
  const _cfg = () => { try { return (getConfig && getConfig()) || {}; } catch { return {}; } };
  const _dirs = () => { try { return (eqDirs && eqDirs()) || []; } catch { return []; } };

  const st = {
    state: 'starting', message: 'Zeal bridge starting…',
    socket: null, pipeName: null, eqPid: null, winePid: null,
    loader: null, prefix: null, kind: null, bridgeExe: null,
    command: null, attempts: 0, nextRetryAt: 0, lastError: null, lastExitAt: 0,
  };

  let child = null;
  let childStartedAt = 0;
  // Monotonic id for the current bridge child. A child we killed on purpose
  // still fires 'exit' a moment later; without this token that late event would
  // be read as a crash and arm a pointless backoff against the NEXT child.
  let childToken = 0;
  let timer = null;
  let stopped = false;
  let ticking = false;
  let lastSetupLogAt = 0;
  let ourSocket = null;          // only ever unlink/unset what WE created

  function _set(state, message, extra) {
    const changed = st.state !== state || st.message !== message;
    st.state = state;
    st.message = message;
    Object.assign(st, extra || {});
    if (changed) {
      _log(`[zeal-bridge] ${state}: ${message}\n`);
      try { if (onStatus) onStatus(status()); } catch { /* renderer gone */ }
    }
  }

  function status() { return Object.assign({ running: !!child }, st); }

  function _exportSocket(sockPath) {
    ourSocket = sockPath;
    // THE HANDOFF: zealPipe.js re-reads process.env.ZEAL_PIPE_SOCKET on every
    // 25s poll, so writing it here is enough — the reader connects on its own,
    // no restart, no change on that side.
    process.env.ZEAL_PIPE_SOCKET = sockPath;
    _log(`[zeal-bridge] ZEAL_PIPE_SOCKET=${sockPath} — the Zeal reader picks this up within 25s\n`);
  }

  function _clearSocket() {
    if (!ourSocket) return;
    if (process.env.ZEAL_PIPE_SOCKET === ourSocket) delete process.env.ZEAL_PIPE_SOCKET;
    try { fs.rmSync(ourSocket, { force: true }); } catch { /* already gone */ }
    ourSocket = null;
  }

  function _killChild(why) {
    if (!child) return;
    const c = child;
    child = null;
    childToken += 1;               // orphan the outgoing child's exit handler
    _log(`[zeal-bridge] stopping bridge (${why})\n`);
    try { c.kill('SIGTERM'); } catch { /* already dead */ }
    setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* fine */ } }, 3000).unref?.();
    _clearSocket();
  }

  function _backoff() {
    st.attempts += 1;
    const delay = Math.min(RETRY_BASE_MS * Math.pow(2, st.attempts - 1), RETRY_MAX_MS);
    st.nextRetryAt = Date.now() + delay;
    return delay;
  }

  async function _tick() {
    if (stopped || ticking) return;
    ticking = true;
    try { await _tickBody(); }
    catch (e) { _set('error', `bridge supervisor error: ${e && e.message}`, { lastError: String(e && e.message) }); }
    finally {
      ticking = false;
      if (!stopped) {
        timer = setTimeout(_tick, _nextDelay());
        timer.unref?.();
      }
    }
  }

  // Cadence by state. Every tick that finds no healthy child spawns pgrep, so
  // the states that cannot change without the user doing something (no bridge
  // installed, unsupported container, disabled) idle right down — the same
  // spawn-pressure discipline as main.js's EQ presence poll.
  function _nextDelay() {
    if (child) return TICK_EQ_UP_MS;
    switch (st.state) {
      case 'waiting-eq':   return TICK_EQ_DOWN_MS;
      case 'needs-bridge':
      case 'unsupported':
      case 'external':
      case 'disabled':     return TICK_IDLE_MS;
      default:             return TICK_EQ_UP_MS;
    }
  }

  async function _tickBody() {
    const cfg = _cfg();
    if (cfg.zealBridge === false) {
      if (child) _killChild('disabled in config');
      return _set('disabled', 'Zeal bridge disabled (cfg.zealBridge=false)');
    }
    if (EXTERNAL_SOCKET) {
      // A launcher script already bridged the pipe. Managing a second one would
      // fight it for the socket path; report and stay out of the way.
      return _set('external', `using the ZEAL_PIPE_SOCKET you set (${EXTERNAL_SOCKET}) — Mimic is not managing a bridge`,
        { socket: EXTERNAL_SOCKET });
    }

    const pids = await _pgrepEqGame();
    const candidates = _pickEqProcess(pids);
    if (!candidates.length) {
      if (child) _killChild('EverQuest exited');
      st.attempts = 0;
      return _set('waiting-eq', 'waiting for EverQuest (no Wine-hosted eqgame.exe)',
        { eqPid: null, winePid: null, pipeName: null, socket: null });
    }

    const info = candidates[0];
    if (candidates.length > 1) {
      _log(`[zeal-bridge] ${candidates.length} eqgame.exe processes; bridging pid ${info.pid} `
         + `(prefix ${info.prefix}) and ignoring ${candidates.slice(1).map(c => c.pid).join(', ')}\n`);
    }

    // Healthy child for this same client → nothing to do.
    if (child && st.eqPid === info.pid) {
      if (st.attempts && (Date.now() - childStartedAt) > HEALTHY_AFTER_MS) {
        st.attempts = 0; st.nextRetryAt = 0;
      }
      return;
    }
    if (child) _killChild(`EverQuest restarted (pid ${st.eqPid} → ${info.pid})`);
    if (st.nextRetryAt && Date.now() < st.nextRetryAt) return;   // backing off

    Object.assign(st, {
      eqPid: info.pid, prefix: info.prefix, loader: info.loader, kind: info.kind,
    });

    if (!info.loader || (info.kind === 'host' && !_exists(info.loader))) {
      _backoff();
      return _set('error',
        `could not find the wine binary hosting eqgame.exe (pid ${info.pid}, loader=${info.loader || 'unknown'})`,
        { lastError: 'loader-not-found' });
    }

    // Proton launched from Steam runs inside pressure-vessel, a container we
    // have no supported way to join — and joining is the whole requirement,
    // because the wineserver lives in there with it
    // (docs/mimic-steamdeck-zeal-bridge.md: "Steam's own Proton has the same
    // problem via its pressure-vessel container"). Say so plainly instead of
    // spawning something that will fail in a confusing way.
    if (info.kind === 'container') {
      _backoff();
      return _set('unsupported',
        `EverQuest is running inside a ${info.container || 'container'} sandbox (loader ${info.loader}), `
        + 'which Mimic cannot join to start the bridge. Run EQ through Lutris + GE-Proton — its wineserver is a '
        + 'plain host process — or start the bridge yourself and launch Mimic with ZEAL_PIPE_SOCKET set. '
        + 'Log-driven features are unaffected.',
        { lastError: 'container-namespace' });
    }

    const found = _resolveBridgeExe(cfg, info, _dirs());
    if (!found.exe) {
      const msg = _setupMessage(found.searched, found.missingConfigured);
      // Repeat into the agent log occasionally, not every poll: this is the one
      // state a user has to act on, and it must be pasteable evidence.
      if (Date.now() - lastSetupLogAt > NEEDS_SETUP_RELOG_MS) {
        lastSetupLogAt = Date.now();
        _log(`[zeal-bridge] ${msg}\n`);
        if (found.searched && found.searched.length) {
          _log(`[zeal-bridge] looked in: ${found.searched.join(', ')}\n`);
        }
      }
      return _set('needs-bridge', msg, { bridgeExe: null });
    }
    st.bridgeExe = found.exe;

    const pipeName = cfg.zealBridgePipeName || await _wineTasklistPipeName(info);
    if (!pipeName) {
      const delay = _backoff();
      return _set('error',
        `EverQuest is running but "wine tasklist" did not report its Windows pid — `
        + `cannot build the pipe name. Retrying in ${Math.round(delay / 1000)}s.`,
        { lastError: 'windows-pid-unknown' });
    }
    st.pipeName = pipeName;
    st.winePid = parseInt(String(pipeName).replace(/^zeal_/, ''), 10) || null;

    const sockPath = _socketPathFor({ info, cfg });
    try { fs.mkdirSync(path.dirname(sockPath), { recursive: true }); } catch { /* best effort */ }
    try { fs.rmSync(sockPath, { force: true }); } catch { /* stale socket, best effort */ }
    st.socket = sockPath;

    const argv = _bridgeArgv({ bridgeExe: found.exe, pipeName, socketPath: sockPath, cfg });
    const plan = _spawnPlan({ info, bridgeExe: found.exe, argv, cfg });
    st.command = [plan.cmd, ...plan.args].join(' ');

    _log(`[zeal-bridge] spawning (${info.kind}) ${st.command}\n`);
    try {
      child = spawn(plan.cmd, plan.args, {
        env: plan.env || Object.assign({}, process.env, info.env),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      child = null;
      const delay = _backoff();
      return _set('error', `could not start the bridge: ${e && e.message} (retry in ${Math.round(delay / 1000)}s)`,
        { lastError: String(e && e.message) });
    }
    childStartedAt = Date.now();
    const myToken = ++childToken;

    // The bridge's own stdout/stderr is the evidence a raider pastes when it
    // does not work ("cannot open pipe", "connection refused"), so it goes into
    // the agent log rather than nowhere.
    const relay = (tag) => (d) => {
      const s = String(d).trim();
      if (s) _log(`[zeal-bridge:${tag}] ${s}\n`);
    };
    try { child.stdout.on('data', relay('out')); child.stderr.on('data', relay('err')); } catch { /* no pipes */ }
    child.on('error', (e) => {
      if (myToken !== childToken) return;
      _set('error', `bridge process error: ${e && e.message}`, { lastError: String(e && e.message) });
    });
    child.on('exit', (code, signal) => {
      if (myToken !== childToken) return;      // we killed it deliberately
      const lived = Date.now() - childStartedAt;
      child = null;
      st.lastExitAt = Date.now();
      _clearSocket();
      if (stopped) return;
      const delay = _backoff();
      _set('error',
        `bridge exited after ${Math.round(lived / 1000)}s (code=${code} signal=${signal || 'none'}); `
        + `retrying in ${Math.round(delay / 1000)}s`,
        { lastError: `exit ${code}` });
    });

    _exportSocket(sockPath);
    _set('running',
      `bridging \\\\.\\pipe\\${pipeName} → ${sockPath} via ${path.basename(found.exe)} (${info.kind} wine)`);

    // A bridge that starts, finds no pipe and sits there is indistinguishable
    // from a working one until you notice the overlays are empty. If the socket
    // never appears, say so — that is the "Zeal's pipe does not exist under
    // Proton/GE-Proton" answer the doc calls the make-or-break unknown.
    const t = setTimeout(() => {
      if (myToken !== childToken || stopped) return;
      if (_exists(sockPath)) { _log(`[zeal-bridge] socket ${sockPath} is up\n`); return; }
      _log(`[zeal-bridge] WARNING: ${path.basename(found.exe)} is running but ${sockPath} never appeared — `
         + `either Zeal did not create \\\\.\\pipe\\${pipeName} under this Wine (its DX hook may not be loading), `
         + `or the bridge cannot see it. Check Zeal in-game → Settings → Pipes.\n`);
    }, 15_000);
    t.unref?.();
  }

  // Ask the SAME wineserver for eqgame's Windows pid. This is itself a wine
  // program, so it goes through the identical spawn plan — anything else would
  // query a different wineserver and hand back a pid from the wrong world.
  function _wineTasklistPipeName(info) {
    return new Promise((resolve) => {
      const plan = _spawnPlan({ info, bridgeExe: 'tasklist', argv: ['/FO', 'CSV', '/NH'], cfg: {} });
      execFile(plan.cmd, plan.args, {
        env: plan.env || Object.assign({}, process.env, info.env),
        timeout: 20_000,
      }, (err, stdout) => {
        const pid = _parseWineTasklist(stdout);
        if (!pid && err) _log(`[zeal-bridge] wine tasklist failed: ${err.message}\n`);
        resolve(pid ? `zeal_${pid}` : null);
      });
    });
  }

  if (process.platform !== 'linux') {
    // Defensive: callers already guard, but a module that can be required
    // anywhere must be inert anywhere.
    _set('disabled', 'not Linux — nothing to bridge');
    return { stop() {}, status, retryNow() {} };
  }

  _log('[zeal-bridge] supervisor started — watching for a Wine-hosted eqgame.exe\n');
  timer = setTimeout(_tick, 3000);
  timer.unref?.();

  return {
    stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      _killChild('Mimic quitting');
      st.state = 'stopped';
    },
    status,
    retryNow() { st.nextRetryAt = 0; st.attempts = 0; _tick(); },
  };
}

module.exports = {
  startLinuxZealBridge,
  inspectEqProcess,
  // Exported for tests — the pure halves of the reasoning above.
  _parseEnviron,
  _classifyLoader,
  _resolveLoader,
  _wineEnvFor,
  _bridgeArgv,
  _socketPathFor,
  _spawnPlan,
  _parseWineTasklist,
  _resolveBridgeExe,
};
