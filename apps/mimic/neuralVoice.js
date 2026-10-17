// neuralVoice.js — free, open-source voices for the spoken callouts, as OPTIONS beside the Windows voice
// (the guild lead, 2026-10-17: "Piper is the default download, Kokoro the upgrade; the Windows voice stays the
// fallback"). Runs in Mimic's MAIN process; the trigger window asks over IPC (voice:synth) and plays the WAV it
// gets back, so nothing here ever touches the UI thread.
//
//   · PIPER   — the official rhasspy/piper Windows release (a command-line synthesiser) plus voices from
//               rhasspy/piper-voices. Downloaded on demand from Settings / the dashboard, never in the installer.
//               One process per phrase: text on stdin, a WAV file out. Speed = --length_scale (1 / rate).
//               Pitch is NOT applied: Piper has no pitch control.
//   · KOKORO  — NOT BUILT. See KOKORO_REASON. The row exists so the picker is honest about it.
//
// Everything that decides something is a pure function exported at the bottom (engine pick lives in voice.js,
// which the renderer loads too): the cache key, the speed mapping, the download plan, the zip path guard, the
// timeout wrapper. A failure of any kind resolves to null and the caller speaks with the Windows voice — a
// callout is never silenced by a download that went wrong.
//
// Zero npm deps: the download and unzip are ghDownload.js's, the same ones Zeal and the UI packs use.

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { httpsGet, unzip, stamp } = require('./ghDownload');

// A callout is stale after ~5 s (triggers.html SPEAK_TTL_MS); past this the line is spoken by the Windows voice.
const SYNTH_TIMEOUT_MS = 2500;
const MAX_TEXT_CHARS = 300;

// ── What we download, pinned ────────────────────────────────────────────────────────────────────────
// Every URL is immutable (a release tag, or a Hugging Face COMMIT, never `main`); every file has its exact byte
// size and sha256, checked before anything is written. Re-pin by changing the URL AND both numbers together.
//
// ⚠ Licences (read from each voice's MODEL_CARD, 2026-10-17). The two voices below are the ones whose training
// data is public domain (LibriVox). The obvious picks are NOT clean: `lessac` is trained on the Blizzard 2013
// data under a per-user research licence, `ryan` is CC BY-NC-SA 4.0, `joe` (CC0 data) is fine-tuned FROM lessac.
// Piper itself is MIT, but its zip carries espeak-ng (GPL-3) — fetched from upstream on the user's PC, never
// bundled in Mimic's installer. See docs/DECISIONS for the call.
const PIPER_VOICES_REV = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';   // rhasspy/piper-voices @ 2026-09-17
const _HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/' + PIPER_VOICES_REV + '/en/en_US/';

const MANIFEST = Object.freeze({
  piper: Object.freeze({
    id: 'piper',
    label: 'Piper',
    blurb: 'Free and open source. Natural, quick, and light on older PCs.',
    platform: 'win32',
    runtime: Object.freeze({
      name: 'piper_windows_amd64.zip',
      url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
      size: 22477236,
      sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
      licence: 'MIT (Piper); the bundled espeak-ng is GPL-3',
    }),
    voices: Object.freeze([
      Object.freeze({
        id: 'en_US-kristin-medium',
        label: 'Kristin (US English, woman)',
        licence: 'Public domain',
        credit: 'Voice trained by Bryce Beattie on LibriVox recordings (public domain).',
        files: Object.freeze([
          Object.freeze({ name: 'en_US-kristin-medium.onnx', url: _HF + 'kristin/medium/en_US-kristin-medium.onnx', size: 63531379, sha256: '5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4' }),
          Object.freeze({ name: 'en_US-kristin-medium.onnx.json', url: _HF + 'kristin/medium/en_US-kristin-medium.onnx.json', size: 4968, sha256: '5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c' }),
        ]),
      }),
      Object.freeze({
        id: 'en_US-john-medium',
        label: 'John (US English, man)',
        licence: 'Public domain',
        credit: 'Voice trained by Bryce Beattie on LibriVox recordings (public domain).',
        files: Object.freeze([
          Object.freeze({ name: 'en_US-john-medium.onnx', url: _HF + 'john/medium/en_US-john-medium.onnx', size: 63531379, sha256: '789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988' }),
          Object.freeze({ name: 'en_US-john-medium.onnx.json', url: _HF + 'john/medium/en_US-john-medium.onnx.json', size: 4965, sha256: 'af60f177b6b550f3d7a302720c0fb89e7f94a82b5dca464775ef63b1c69ba09a' }),
        ]),
      }),
    ]),
  }),
  kokoro: Object.freeze({
    id: 'kokoro',
    label: 'Kokoro',
    blurb: 'Sounds better, slower on older PCs.',
  }),
});

// Why Kokoro is a stub (evaluated 2026-10-17). kokoro-js (Apache-2.0) runs the 82M ONNX model, but it needs
// @huggingface/transformers, which needs onnxruntime-node (~300 MB unpacked, every platform's binaries),
// onnxruntime-web (~145 MB) and sharp — none of which Mimic ships, and a download-on-demand model does not
// remove the runtime from the INSTALLER. The other route, sherpa-onnx's command-line synthesiser, fits this
// file's Piper pattern exactly (spawn an exe, WAV out) but its releases are .tar.bz2, which ghDownload.js
// cannot unpack, and the release host was not reachable from the build session to pin sizes. The model it
// would use is onnx-community/Kokoro-82M-v1.0-ONNX (Apache-2.0), onnx/model_q8f16.onnx, 86,033,585 bytes.
const KOKORO_REASON = 'Kokoro is not in this build yet: it needs a runtime Mimic does not carry. Piper works today.';

// ── Pure pieces ─────────────────────────────────────────────────────────────────────────────────────
// Piper's --length_scale is the inverse of speed: 1.0 is the voice's own pace, below 1 is faster.
function lengthScale(rate) {
  const r = Number(rate);
  const speed = (Number.isFinite(r) && r > 0) ? r : 1;
  return Math.round(Math.min(2.5, Math.max(0.4, 1 / speed)) * 1000) / 1000;
}

function _cleanText(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

// One cached WAV per (engine, voice, speed, words). Speed is rounded so a slider wobble does not defeat the cache.
function cacheKey(engine, voice, rate, text) {
  const r = Number(rate);
  return [engine, voice, (Number.isFinite(r) && r > 0) ? r.toFixed(2) : '1.00', _cleanText(text)].join('|');
}

// Least-recently-used, bounded by entries AND bytes (a 3-second WAV at 22 kHz is ~130 KB).
function createLru(maxEntries = 48, maxBytes = 20 * 1024 * 1024) {
  const m = new Map();
  let bytes = 0;
  return {
    get(k) {
      if (!m.has(k)) return undefined;
      const v = m.get(k); m.delete(k); m.set(k, v);   // newest last
      return v;
    },
    set(k, v) {
      if (m.has(k)) { bytes -= m.get(k).length; m.delete(k); }
      if (v.length > maxBytes) return;
      m.set(k, v); bytes += v.length;
      while (m.size > maxEntries || bytes > maxBytes) {
        const oldest = m.keys().next().value;
        bytes -= m.get(oldest).length; m.delete(oldest);
      }
    },
    clear() { m.clear(); bytes = 0; },
    get size() { return m.size; },
    get bytes() { return bytes; },
  };
}

// Runs `run(signal)` and resolves its Buffer — or null on ANY failure, an empty result or the time limit.
// Never rejects: the caller's only job on null is to fall back to the Windows voice.
function synthOrNull(run, ms = SYNTH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const timer = setTimeout(() => { ac.abort(); resolve(null); }, ms);
    Promise.resolve().then(() => run(ac.signal)).then(
      (buf) => { clearTimeout(timer); resolve(buf && buf.length ? buf : null); },
      () => { clearTimeout(timer); resolve(null); });
  });
}

function findVoice(engine, voiceId) {
  if (engine !== 'piper') return null;
  return MANIFEST.piper.voices.find(v => v.id === voiceId) || null;
}

// The files to fetch, in order, for one voice given what is already on disk. Runtime first.
function downloadPlan(voiceId, have = {}) {
  const v = findVoice('piper', voiceId);
  if (!v) throw new Error('Unknown voice: ' + voiceId);
  const files = [];
  if (!have.runtimeReady) files.push({ kind: 'runtime', ...MANIFEST.piper.runtime });
  if (!have.voiceReady) for (const f of v.files) files.push({ kind: 'voice', ...f });
  return { files, totalBytes: files.reduce((n, f) => n + f.size, 0) };
}

// Where a zip entry may be written, or null: nothing outside `base`, no absolute or drive-lettered names.
function safeZipTarget(base, entryName) {
  const parts = String(entryName).split(/[\\/]/).filter(Boolean);
  if (!parts.length || parts.some(p => p === '..' || /^[A-Za-z]:$/.test(p))) return null;
  if (/^[\\/]/.test(entryName) || /^[A-Za-z]:/.test(entryName)) return null;
  const target = path.join(base, ...parts);
  const rel = path.relative(base, target);
  return (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) ? target : null;
}

function verifyFile(buf, file) {
  if (buf.length !== file.size) {
    throw new Error('The download came through the wrong size (' + buf.length + ' bytes, expected ' + file.size + '). Check your connection and try again.');
  }
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== file.sha256) {
    throw new Error('The download did not match its checksum, so it was thrown away. Try again; if it keeps happening, your network may be altering downloads.');
  }
}

// ── On disk ─────────────────────────────────────────────────────────────────────────────────────────
function piperPaths(root) {
  const base = path.join(root, 'piper');
  const exe = path.join(base, 'runtime', 'piper', 'piper.exe');
  return {
    base, runtime: path.join(base, 'runtime'), exe,
    espeak: path.join(path.dirname(exe), 'espeak-ng-data'),
    voices: path.join(base, 'voices'),
    tmp: path.join(root, 'tmp'),
  };
}
function _runtimeReady(p) { return fs.existsSync(p.exe) && fs.existsSync(path.join(p.runtime, '.ok')); }
function _voiceDir(p, v) { return path.join(p.voices, v.id); }
function _voiceReady(p, v) {
  const d = _voiceDir(p, v);
  return fs.existsSync(path.join(d, '.ok')) && v.files.every(f => fs.existsSync(path.join(d, f.name)));
}

let _progress = null;       // { engine, phase, pct, text } while a download runs; null otherwise
const _cache = createLru();

// What the pickers draw (voice:status). Cheap: a handful of existsSync calls.
function status(root, platform = process.platform) {
  const p = piperPaths(root);
  const available = platform === MANIFEST.piper.platform;
  const runtimeReady = _runtimeReady(p);
  const catalog = MANIFEST.piper.voices.map(v => {
    const installed = runtimeReady && _voiceReady(p, v);
    return {
      id: v.id, label: v.label, licence: v.licence, credit: v.credit, installed,
      // what pressing Download would fetch for this voice (the runtime counts only if it is not there yet)
      downloadBytes: downloadPlan(v.id, { runtimeReady, voiceReady: installed }).totalBytes,
    };
  });
  const voices = available ? catalog.filter(v => v.installed).map(v => v.id) : [];
  return {
    piper: {
      label: MANIFEST.piper.label, blurb: MANIFEST.piper.blurb, available,
      reason: available ? '' : 'The Piper download is for Windows only.',
      ready: voices.length > 0, voices, runtimeInstalled: runtimeReady, runtimeBytes: MANIFEST.piper.runtime.size, catalog,
    },
    kokoro: { label: MANIFEST.kokoro.label, blurb: MANIFEST.kokoro.blurb, available: false, reason: KOKORO_REASON, ready: false, voices: [], catalog: [] },
    progress: _progress,
  };
}

function _rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } }

// Extract the Piper zip into a fresh folder, then swap it in; a half-written runtime is never the live one.
function _installRuntime(p, zipBuf) {
  const entries = unzip(zipBuf);
  const tmp = p.runtime + '.tmp-' + stamp();
  fs.mkdirSync(tmp, { recursive: true });
  try {
    for (const e of entries) {
      const target = safeZipTarget(tmp, e.name);
      if (!target) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, e.data);
    }
    if (!fs.existsSync(path.join(tmp, 'piper', 'piper.exe'))) throw new Error('The Piper download did not contain piper.exe.');
    fs.writeFileSync(path.join(tmp, '.ok'), MANIFEST.piper.runtime.sha256);
    _rmrf(p.runtime);
    fs.renameSync(tmp, p.runtime);
  } catch (e) { _rmrf(tmp); throw e; }
}

function _installVoice(p, v, bufs) {
  const dir = _voiceDir(p, v), tmp = dir + '.tmp-' + stamp();
  fs.mkdirSync(tmp, { recursive: true });
  try {
    v.files.forEach((f, i) => fs.writeFileSync(path.join(tmp, f.name), bufs[i]));
    fs.writeFileSync(path.join(tmp, '.ok'), v.id);
    _rmrf(dir);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(tmp, dir);
  } catch (e) { _rmrf(tmp); throw e; }
}

// Download + verify + place Piper and one voice. One at a time. Throws an Error whose message is for a person.
async function install(root, engine, voiceId, platform = process.platform) {
  if (engine === 'kokoro') throw new Error(KOKORO_REASON);
  if (engine !== 'piper') throw new Error('Unknown voice engine.');
  if (platform !== MANIFEST.piper.platform) throw new Error('The Piper download is for Windows only.');
  const v = findVoice('piper', voiceId || MANIFEST.piper.voices[0].id);
  if (!v) throw new Error('Unknown voice.');
  if (_progress) throw new Error('A voice download is already running.');
  const p = piperPaths(root);
  const plan = downloadPlan(v.id, { runtimeReady: _runtimeReady(p), voiceReady: _voiceReady(p, v) });
  _progress = { engine: 'piper', phase: 'start', pct: 0, text: 'Starting…' };
  try {
    let done = 0;
    const voiceBufs = [];
    for (const f of plan.files) {
      const what = f.kind === 'runtime' ? 'Piper' : v.label;
      const buf = await httpsGet(f.url, {
        onProgress: (got) => {
          const pct = plan.totalBytes ? Math.min(99, Math.floor(((done + got) / plan.totalBytes) * 100)) : 0;
          _progress = { engine: 'piper', phase: f.kind, pct, text: 'Downloading ' + what + '…' };
        },
      });
      verifyFile(buf, f);
      done += f.size;
      if (f.kind === 'runtime') { _progress = { engine: 'piper', phase: 'unpack', pct: 99, text: 'Unpacking Piper…' }; _installRuntime(p, buf); }
      else voiceBufs.push(buf);
    }
    if (voiceBufs.length) _installVoice(p, v, voiceBufs);
    _cache.clear();
    return status(root, platform);
  } finally { _progress = null; }
}

// Delete a download (Piper and all its voices). Refused while one is running.
function remove(root, engine, platform = process.platform) {
  if (_progress) throw new Error('A voice download is running; wait for it to finish.');
  if (engine === 'piper') { _rmrf(piperPaths(root).base); _cache.clear(); }
  return status(root, platform);
}

// ── Speaking ────────────────────────────────────────────────────────────────────────────────────────
let _tmpSwept = false;
function _runPiper(p, v, text, rate, signal) {
  return new Promise((resolve, reject) => {
    if (!_tmpSwept) { _tmpSwept = true; _rmrf(p.tmp); }   // leftovers of a phrase that was cut off last time
    fs.mkdirSync(p.tmp, { recursive: true });
    const out = path.join(p.tmp, 'say-' + stamp() + '.wav');
    const dir = _voiceDir(p, v);
    const args = [
      '--model', path.join(dir, v.files[0].name), '--config', path.join(dir, v.files[1].name),
      '--output_file', out, '--length_scale', String(lengthScale(rate)),
      '--espeak_data', p.espeak, '--quiet',
    ];
    const child = spawn(p.exe, args, { cwd: path.dirname(p.exe), windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const drop = () => { try { fs.unlinkSync(out); } catch { /* not written */ } };
    signal.addEventListener('abort', () => { try { child.kill(); } catch { /* gone */ } drop(); reject(new Error('timed out')); }, { once: true });
    child.on('error', (e) => { drop(); reject(e); });
    child.on('close', (code) => {
      if (code !== 0) { drop(); reject(new Error('piper exited ' + code)); return; }
      try { const b = fs.readFileSync(out); drop(); resolve(b); } catch (e) { reject(e); }
    });
    child.stdin.on('error', () => { /* the process died first; 'close' reports it */ });
    child.stdin.end(text + '\n');
  });
}

// → a WAV Buffer, or null (not installed, wrong engine, failure, or past SYNTH_TIMEOUT_MS). Repeat phrases are
// served from the cache without starting a process.
async function synthesize(root, spec, platform = process.platform) {
  try {
    const engine = spec && spec.engine;
    const v = findVoice(engine, spec && spec.voice);
    const text = _cleanText(spec && spec.text);
    if (!v || !text || platform !== MANIFEST.piper.platform) return null;
    const p = piperPaths(root);
    if (!_runtimeReady(p) || !_voiceReady(p, v)) return null;
    const key = cacheKey(engine, v.id, spec.rate, text);
    const hit = _cache.get(key);
    if (hit) return hit;
    const buf = await synthOrNull((signal) => _runPiper(p, v, text, spec.rate, signal));
    if (buf) _cache.set(key, buf);
    return buf;
  } catch { return null; }
}

module.exports = {
  MANIFEST, KOKORO_REASON, SYNTH_TIMEOUT_MS, PIPER_VOICES_REV,
  status, install, remove, synthesize,
  // pure, for tests
  lengthScale, cacheKey, createLru, synthOrNull, downloadPlan, safeZipTarget, verifyFile, findVoice, piperPaths,
};
