// zealPipe.js — Zeal named-pipe reader (spike / capture phase).
//
// Zeal (CoastalRedwood/Zeal) streams live game state out a Windows named pipe
// named  \\.\pipe\zeal_<PID>  where <PID> is the eqgame.exe process id. The
// stream is a sequence of nlohmann::json objects (pipe_data). Top-level type
// enum:  log=0, label=1, gauge=2, player=3, custom=4, raid=5, group=6.
//
// THIS MODULE IS THE READER ONLY. It discovers eqgame.exe PIDs, connects to
// each Zeal pipe, frames the JSON stream defensively (brace-depth scan — works
// whether or not Zeal newline-delimits), parses each object, and hands it to
// onEvent. It NEVER writes to the pipe (Zeal opens it PIPE_ACCESS_OUTBOUND
// anyway) and degrades silently when EQ or Zeal isn't running, so non-Zeal
// users see nothing change.
//
// We ship this first to CAPTURE real traffic on a live machine before wiring
// Zeal events into the trigger evaluator — the exact field names per type and
// the gem/recast timer payloads need ground truth, not inference.

'use strict';
const net  = require('net');
const { execFile } = require('child_process');

const PIPE_PREFIX = '\\\\.\\pipe\\zeal_';   // + PID

// Enumerate eqgame.exe PIDs via tasklist (Windows only). Resolves to an array
// of integer PIDs; empty on non-Windows or when EQ isn't running.
function _findEqPids() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('tasklist', ['/FI', 'IMAGENAME eq eqgame.exe', '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const pids = [];
        for (const line of stdout.split(/\r?\n/)) {
          // CSV row: "eqgame.exe","1234","Console","1","123,456 K"
          const m = /^"eqgame\.exe","(\d+)"/i.exec(line.trim());
          if (m) pids.push(parseInt(m[1], 10));
        }
        resolve(pids);
      });
  });
}

// Split a growing buffer into complete top-level JSON objects by brace depth,
// ignoring braces inside strings. Returns { objects, rest } where rest is the
// trailing incomplete fragment to carry into the next chunk. Robust to both
// newline-delimited and bare-concatenated streams.
function _extractJsonObjects(buf) {
  const objects = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  let i = 0;
  for (; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (c === '\\') { esc = true; }
      else if (c === '"') { inStr = false; }
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(buf.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        // Stream desync (shouldn't happen) — reset.
        depth = 0; start = -1;
      }
    }
  }
  // Everything from the last unterminated object start onward is the remainder.
  const rest = start >= 0 ? buf.slice(start) : (depth === 0 ? '' : buf.slice(i));
  return { objects, rest };
}

// Start watching. Returns a handle with stop(). Options:
//   onEvent(pid, obj)  — called per parsed pipe_data object
//   onStatus(summary)  — { connectedPids: [...], lastError }
//   log(line)          — diagnostic sink (agent log)
function startZealWatch({ onEvent, onStatus, log } = {}) {
  const _log = log || (() => {});
  const sockets = new Map();      // pid → { socket, buf }
  let stopped = false;
  let lastError = null;

  function _status() {
    if (onStatus) onStatus({ connectedPids: [...sockets.keys()], lastError });
  }

  function _connect(pid) {
    if (sockets.has(pid)) return;
    const pipePath = PIPE_PREFIX + pid;
    let buf = '';
    const socket = net.connect({ path: pipePath }, () => {
      _log(`[zeal] connected to ${pipePath}\n`);
      _status();
    });
    sockets.set(pid, { socket, buf: '' });
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      // Guard against unbounded growth if the stream ever desyncs (cap 1MB).
      if (buf.length > 1024 * 1024) buf = buf.slice(-256 * 1024);
      const { objects, rest } = _extractJsonObjects(buf);
      buf = rest;
      for (const raw of objects) {
        let obj;
        try { obj = JSON.parse(raw); } catch { continue; }
        try { if (onEvent) onEvent(pid, obj); } catch { /* consumer threw — ignore */ }
      }
    });
    const cleanup = (why) => {
      if (sockets.has(pid)) {
        sockets.delete(pid);
        _log(`[zeal] disconnected from ${pipePath}${why ? ' (' + why + ')' : ''}\n`);
        _status();
      }
    };
    socket.on('error', (e) => {
      // ENOENT = Zeal not running for this PID (no pipe). Quiet — it's the
      // common case for an EQ client without Zeal, or before Zeal's pipe is up.
      if (e && e.code !== 'ENOENT') { lastError = e.message; }
      cleanup(e && e.code);
    });
    socket.on('close', () => cleanup());
    socket.on('end',   () => cleanup());
  }

  async function _poll() {
    if (stopped) return;
    try {
      const pids = await _findEqPids();
      for (const pid of pids) _connect(pid);
    } catch (e) { lastError = e.message; }
  }

  // Initial + every 15s — picks up newly-launched clients / Zeal coming online,
  // and reconnects after a transient drop.
  _poll();
  const timer = setInterval(_poll, 15000);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      for (const { socket } of sockets.values()) { try { socket.destroy(); } catch {} }
      sockets.clear();
    },
    status() { return { connectedPids: [...sockets.keys()], lastError }; },
  };
}

module.exports = { startZealWatch, _extractJsonObjects };
