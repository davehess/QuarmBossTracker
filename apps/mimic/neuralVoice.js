// neuralVoice.js — free, open-source voices for the spoken callouts, as OPTIONS beside the Windows voice
// (the guild lead, 2026-10-17: "Piper is the default download, Kokoro the upgrade; the Windows voice stays the
// fallback"). Runs in Mimic's MAIN process; the trigger window asks over IPC (voice:synth) and plays the WAV it
// gets back, so nothing here ever touches the UI thread.
//
//   · PIPER   — the official rhasspy/piper Windows release (a command-line synthesiser) plus voices from
//               rhasspy/piper-voices. Downloaded on demand from Settings / the dashboard, never in the installer.
//               One process per phrase: text on stdin, a WAV file out. Speed = --length_scale (1 / rate).
//               Pitch is NOT applied: Piper has no pitch control.
//   · KOKORO  — the Kokoro-82M model (Apache-2.0) run by the sherpa-onnx project's prebuilt command-line
//               synthesiser (Apache-2.0), both fetched on demand from k2-fsa/sherpa-onnx's GitHub releases. Their
//               archives are .tar.bz2, unpacked in JS (extractTarBz2). One process per
//               phrase, text as an argument, a WAV file out. Speed = --kokoro-length-scale (1 / rate). Slower
//               than Piper, so it gets a longer limit for a ▶ Test and a background warm-up (warmUp).
//
// Everything that decides something is a pure function exported at the bottom (engine pick lives in voice.js,
// which the renderer loads too): the cache key, the speed mapping, the download plan, the archive path guard, the
// CLI argument list, the timeout wrapper. A failure of any kind resolves to null and the caller speaks with the
// Windows voice — a callout is never silenced by a download that went wrong.
//
// Zero npm deps: the download and unzip are ghDownload.js's, the same ones Zeal and the UI packs use; the .tar.bz2
// unpack is vendor/seek-bzip plus a small tar reader below (Windows' tar.exe lacks bzip2 on some PCs).

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { httpsGet, unzip, stamp } = require('./ghDownload');
const Bunzip = require('./vendor/seek-bzip');   // pure-JS bzip2 (MIT), vendored; see its header

// A callout is stale after ~5 s (triggers.html SPEAK_TTL_MS); past this the line is spoken by the Windows voice.
const SYNTH_TIMEOUT_MS = 2500;
// A ▶ Test is a person waiting on purpose, and Kokoro loads a 130 MB model per phrase: give it room.
const TEST_TIMEOUT_MS = 12000;
const MAX_TEXT_CHARS = 300;

// ── What we download, pinned ────────────────────────────────────────────────────────────────────────
// Every URL is immutable (a release tag, or a Hugging Face COMMIT, never `main`); every file has its exact byte
// size and sha256, checked before anything is written. Re-pin by changing the URL AND both numbers together.
//
// ⚠ Licences (read from each voice's MODEL_CARD, 2026-10-17). Three tiers (the guild lead, 2026-10-17):
//   · free      — Kristin and John: training data is public domain (LibriVox). Offered with one click.
//   · nc        — "Non-commercial": the data licence allows personal non-commercial use but not redistribution on
//                 our terms (ryan-high: CC BY-NC-SA 4.0, trained from scratch). The user ticks an accept box first.
//   · research  — "Research only — experimental": built on research-only data. `lessac` is the Blizzard 2013
//                 data under a per-user research licence, and `joe` (CC0 data) and `ryan-medium` (CC BY-NC-SA
//                 data) are fine-tuned FROM lessac, so the stricter terms travel with them. The user ticks the
//                 accept box AND a second research-only box.
// We never host or ship a nc / research voice: Mimic fetches it from its publisher (Hugging Face, a pinned
// commit) on the user's own action, and keeps a local record of the acceptance next to the download.
// Piper itself is MIT, but its zip carries espeak-ng (GPL-3) — fetched from upstream on the user's PC, never
// bundled in Mimic's installer. See docs/DECISIONS for the call.
const PIPER_VOICES_REV = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';   // rhasspy/piper-voices @ 2026-09-17
const _HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/' + PIPER_VOICES_REV + '/en/en_US/';
const _HF_CARD = 'https://huggingface.co/rhasspy/piper-voices/blob/' + PIPER_VOICES_REV + '/en/en_US/';
// A voice that needs the user's acceptance first (everything but the free tier).
function _gated(id, dir, tier, label, licence, credit, onnx, json) {
  const base = _HF + dir + '/' + id;
  return Object.freeze({
    id, label, tier, licence, credit, modelCardUrl: _HF_CARD + dir + '/MODEL_CARD',
    files: Object.freeze([
      Object.freeze({ name: id + '.onnx', url: base + '.onnx', size: onnx[0], sha256: onnx[1] }),
      Object.freeze({ name: id + '.onnx.json', url: base + '.onnx.json', size: json[0], sha256: json[1] }),
    ]),
  });
}

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
        tier: 'free',
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
        tier: 'free',
        licence: 'Public domain',
        credit: 'Voice trained by Bryce Beattie on LibriVox recordings (public domain).',
        files: Object.freeze([
          Object.freeze({ name: 'en_US-john-medium.onnx', url: _HF + 'john/medium/en_US-john-medium.onnx', size: 63531379, sha256: '789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988' }),
          Object.freeze({ name: 'en_US-john-medium.onnx.json', url: _HF + 'john/medium/en_US-john-medium.onnx.json', size: 4965, sha256: 'af60f177b6b550f3d7a302720c0fb89e7f94a82b5dca464775ef63b1c69ba09a' }),
        ]),
      }),
      // Non-commercial tier. ryan-high is trained from scratch on CC BY-NC-SA 4.0 data (RyanSpeech), so only that
      // licence applies. (ryan-MEDIUM is fine-tuned from lessac, so it sits in the research tier below.)
      _gated('en_US-ryan-high', 'ryan/high', 'nc', 'Ryan (US English, man, high quality)', 'CC BY-NC-SA 4.0',
        'Trained on the RyanSpeech data set (CC BY-NC-SA 4.0), voice by the Piper project (rhasspy/piper-voices).',
        [120786792, 'b3990d7606e183ec8dbfba70a4607074f162de1a0c412e0180d1ff60bb154eca'],
        [4166, 'c6d3b98f08315cb4bebf0d49d50fc4ff491b503c64b940cd3d5ca28543b48011']),
      // Research-only tier. Order matters for nothing but the picker.
      _gated('en_US-lessac-medium', 'lessac/medium', 'research', 'Lessac (US English, woman)', 'Blizzard 2013 data, research licence',
        'Trained on the Lessac Blizzard 2013 data (per-user research licence), voice by the Piper project.',
        [63201294, '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f'],
        [4885, 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0']),
      _gated('en_US-joe-medium', 'joe/medium', 'research', 'Joe (US English, man)', 'CC0 data, fine-tuned from the research-only Lessac voice',
        'Trained on the OHF-Voice CC0 data set, fine-tuned from the Lessac voice (research licence), by the Piper project.',
        [63201294, '58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06'],
        [4794, '3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33']),
      _gated('en_US-ryan-medium', 'ryan/medium', 'research', 'Ryan (US English, man, medium)', 'CC BY-NC-SA 4.0 data, fine-tuned from the research-only Lessac voice',
        'Trained on RyanSpeech (CC BY-NC-SA 4.0), fine-tuned from the Lessac voice (research licence), by the Piper project.',
        [63201294, 'abf4c274862564ed647ba0d2c47f8ee7c9b717d27bdad9219100eb310db4047a'],
        [4883, '44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d']),
    ]),
  }),
  // Kokoro-82M (English, int8) run by sherpa-onnx's prebuilt Windows command-line synthesiser. Two archives,
  // both pinned by size and sha256: the engine (a release tag) and the model (the project's rolling `tts-models`
  // release, so the checksum — not the URL — is what pins it). Voices are speaker numbers inside voices.bin; the
  // order was checked against the model's own voice file (11 voices) and by pitch (0–4 and 7–8 women, 5–6 and 9–10
  // men). The "int8" model is the smallest English one the CLI supports (103 MB, against 320 MB for fp32).
  kokoro: Object.freeze({
    id: 'kokoro',
    label: 'Kokoro',
    blurb: 'Sounds better, slower on older PCs.',
    platform: 'win32',
    licence: 'Apache-2.0',
    credit: 'Kokoro-82M by hexgrad (Apache-2.0), packaged by the sherpa-onnx project (Apache-2.0). Its training audio is public domain, permissively licensed or synthetic, plus CC BY recordings (SIWIS, Koniwa).',
    runtime: Object.freeze({
      name: 'sherpa-onnx-v1.13.0-win-x64-shared-MD-Release.tar.bz2',
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.0/sherpa-onnx-v1.13.0-win-x64-shared-MD-Release.tar.bz2',
      size: 19059518,
      sha256: '2d7342d3ed1a19ccb08631f3d82d4d494d699e2730053999b7aa9eb7dd76b740',
      licence: 'Apache-2.0 (sherpa-onnx)',
      top: 'sherpa-onnx-v1.13.0-win-x64-shared-MD-Release',
      // the only files kept from it (the archive carries two dozen other tools and the developer libraries)
      keep: Object.freeze(['bin/sherpa-onnx-offline-tts.exe', 'bin/onnxruntime.dll', 'bin/onnxruntime_providers_shared.dll']),
    }),
    model: Object.freeze({
      name: 'kokoro-int8-en-v0_19.tar.bz2',
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2',
      size: 103248205,
      sha256: 'c9f0dd393615805b0bab050c340834d5e684e732aec91c0e860cd30e982c08bd',
      licence: 'Apache-2.0 (Kokoro-82M)',
      top: 'kokoro-int8-en-v0_19',
      required: Object.freeze(['model.int8.onnx', 'voices.bin', 'tokens.txt', 'espeak-ng-data']),
    }),
    voices: Object.freeze([
      Object.freeze({ id: 'af_bella',  sid: 1, label: 'Bella (US English, woman)' }),
      Object.freeze({ id: 'af_sarah',  sid: 3, label: 'Sarah (US English, woman)' }),
      Object.freeze({ id: 'am_adam',   sid: 5, label: 'Adam (US English, man)' }),
      Object.freeze({ id: 'am_michael', sid: 6, label: 'Michael (US English, man)' }),
    ]),
  }),
});

const KOKORO_EXE = 'bin/sherpa-onnx-offline-tts.exe';
// Plain words for the one way the synthesiser can refuse to start (the Windows voice keeps working meanwhile).
const NO_VCRT = 'Kokoro could not start because this PC is missing the Microsoft Visual C++ runtime. Installing "Microsoft Visual C++ Redistributable" (free, from Microsoft) fixes it; until then the Windows voice is used.';

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
  if (engine !== 'piper' && engine !== 'kokoro') return null;
  return MANIFEST[engine].voices.find(v => v.id === voiceId) || null;
}

// What a gated (nc / research) voice needs ticked before anything is downloaded; null = fine to go ahead.
// `accept` is what the dashboard sends: { terms: true } and, for research voices, { research: true } too.
function acceptanceProblem(v, accept) {
  if (!v || v.tier === 'free') return null;
  const a = accept && typeof accept === 'object' ? accept : {};
  if (a.terms !== true) return 'Accept the terms for this voice first. Nothing was downloaded.';
  if (v.tier === 'research' && a.research !== true) return 'Tick the research-only box for this voice first. Nothing was downloaded.';
  return null;
}

// The record kept next to a gated voice, on this PC only: which voice, which licence, which tier, when.
function acceptanceRecord(v, accept, now = new Date()) {
  const a = accept || {};
  return { voice: v.id, licence: v.licence, tier: v.tier, modelCardUrl: v.modelCardUrl, terms: a.terms === true, research: v.tier === 'research' ? a.research === true : undefined, acceptedAt: now.toISOString() };
}

// Kokoro's command line (sherpa-onnx-offline-tts). `--flag=value` is the form its option parser documents; the
// words are the last argument. Speed: --kokoro-length-scale is larger-is-slower, so 1 / rate like Piper's.
function kokoroArgs(p, sid, rate, text, out, threads = 2) {
  return [
    '--kokoro-model=' + p.modelFile, '--kokoro-voices=' + p.voicesFile, '--kokoro-tokens=' + p.tokensFile,
    '--kokoro-data-dir=' + p.dataDir, '--kokoro-length-scale=' + lengthScale(rate),
    '--sid=' + sid, '--num-threads=' + threads, '--output-filename=' + out,
    _kokoroText(text),
  ];
}
// The words go in as an argument, and the option parser reads anything starting with "-" as a flag: drop those.
function _kokoroText(text) { return _cleanText(text).replace(/^[-=\s]+/, ''); }
function _kokoroThreads() { return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))); }

function _plain(msg) { const e = new Error(msg); e.plain = true; return e; }

// ── Unpacking a .tar.bz2 in JS ──────────────────────────────────────────────────────────────────────
// Not Windows' tar.exe: on many PCs its bundled bsdtar was built without bzip2 and tries to run an external
// "bzip2 -d" that Windows does not have ("Can't initialize filter", field report). So the bzip2 layer is the vendored
// seek-bzip and the tar layer is the ~60 lines below; nothing here starts a process.
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;   // the real archives unpack to ~130 MB; past this it is not ours
const MAX_TAR_ENTRIES = 20000;
const _tick = () => new Promise(r => setImmediate(r));
const _ZERO_BLOCK = Buffer.alloc(512);

// bzip2 → one Buffer, in JS. seek-bzip's block decoder driven by hand so the main process breathes between blocks
// (each is <= 900 KB; the whole 100 MB model takes a few seconds and must not freeze the tray). The input stream
// throws at the end of the data instead of returning -1, so a cut-off file fails loudly rather than decoding junk.
async function _bunzip(buf) {
  const SZ = 1 << 20, chunks = [];
  let cur = Buffer.allocUnsafe(SZ), n = 0, pos = 0;
  const inp = new Bunzip.Stream();
  inp.readByte = () => { if (pos >= buf.length) throw _plain('The Kokoro download was cut short, so it was thrown away.'); return buf[pos++]; };
  const out = new Bunzip.Stream();
  out.writeByte = (b) => {
    if (n === SZ) {
      chunks.push(cur); cur = Buffer.allocUnsafe(SZ); n = 0;
      if (chunks.length * SZ > MAX_UNPACKED_BYTES) throw _plain('The Kokoro download unpacked to far more than expected, so it was thrown away.');
    }
    cur[n++] = b;
  };
  const bz = new Bunzip(inp, out);
  for (;;) {
    if (bz._init_block()) { bz._read_bunzip(); await _tick(); continue; }
    if ((bz.reader.read(32) >>> 0) !== bz.streamCRC) throw new TypeError('Bad stream CRC');
    if (pos >= buf.length) break;
    bz._start_bunzip(inp, out);                       // another bzip2 stream follows (parallel bzip2 writes several)
  }
  chunks.push(cur.subarray(0, n));
  return Buffer.concat(chunks);
}

// A NUL-terminated field of a tar header.
function _tarStr(b, s, len) { let e = s; while (e < s + len && b[e] !== 0) e++; return b.toString('utf8', s, e); }
// pax extended header: "<len> key=value\n" records, len counting the whole record in bytes (so read it as latin1).
function _paxRecords(buf) {
  const s = buf.toString('latin1'), r = {};
  for (let i = 0; i < s.length;) {
    const sp = s.indexOf(' ', i), len = parseInt(s.slice(i, sp), 10), eq = s.indexOf('=', sp);
    if (!(len > 0) || eq < 0 || eq > i + len) break;
    r[s.slice(sp + 1, eq)] = Buffer.from(s.slice(eq + 1, i + len - 1), 'latin1').toString('utf8');
    i += len;
  }
  return r;
}

// Read the tar's headers into a list of {target, dir, off, size}, checking every name against `destDir` and
// refusing anything but plain files and folders, BEFORE a byte is written. Handles ustar (with its prefix field),
// GNU long names ('L') and pax path/size records ('x'); a link, device or fifo is refused, same as the zip reader's posture.
function _tarList(tar, destDir) {
  const unsafe = () => _plain('The Kokoro download had an unsafe file path in it, so it was thrown away.');
  const odd = () => _plain('The Kokoro download contained something other than plain files, so it was thrown away.');
  const bad = () => _plain('The Kokoro download was damaged, so it was thrown away.');
  const list = [];
  let pos = 0, longName = null, pax = {};
  while (pos + 512 <= tar.length) {
    const h = tar.subarray(pos, pos + 512);
    if (h.equals(_ZERO_BLOCK)) return list;           // end-of-archive marker
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
    if (sum !== parseInt(_tarStr(h, 148, 8).trim(), 8)) throw bad();
    if (h[124] & 0x80) throw bad();                    // base-256 size: a file over 8 GB, not ours
    let size = parseInt(_tarStr(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156]);
    const isFile = type === '0' || type === '\0';
    if (type === 'x') { const p = _paxRecords(tar.subarray(pos + 512, pos + 512 + size)); pax = { ...pax, ...p }; }
    if (isFile && pax.size != null) size = Number(pax.size);
    if (!(size >= 0) || size > MAX_UNPACKED_BYTES || pos + 512 + size > tar.length) throw bad();
    const start = pos + 512, next = start + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = _tarStr(tar, start, size); pos = next; continue; }
    if (type === 'x' || type === 'g' || type === 'K') { pos = next; continue; }   // K: a link's long target; the link itself is refused
    if (!isFile && type !== '5') throw odd();
    let name = longName != null ? longName : pax.path != null ? pax.path : _tarStr(h, 0, 100);
    if (longName == null && pax.path == null && h.toString('latin1', 257, 263) === 'ustar\0') {
      const prefix = _tarStr(h, 345, 155);
      if (prefix) name = prefix + '/' + name;
    }
    longName = null; pax = {};
    const dir = type === '5' || /[\\/]$/.test(name);
    name = name.replace(/^(\.[\\/])+/, '');
    if (name && name !== '.') {
      const target = safeZipTarget(destDir, name);
      if (!target) throw unsafe();
      if (list.length >= MAX_TAR_ENTRIES) throw bad();
      list.push({ target, dir, off: start, size });
    }
    pos = next;
  }
  if (pos !== tar.length) throw bad();                  // a header cut in half
  return list;
}

// Unpack a .tar.bz2 into `destDir`, refusing anything that could land outside it. The archive was already pinned
// by sha256, so this is a second lock, not the only one: every name must stay inside destDir (the same guard as
// the zip reader) and only plain files and folders are written. Any failure removes what was written and throws a
// message for a person.
async function extractTarBz2(archive, destDir) {
  try {
    const tar = await _bunzip(fs.readFileSync(archive));
    const list = _tarList(tar, destDir);
    if (!list.length) throw _plain('The Kokoro download was empty, so it was thrown away.');
    fs.mkdirSync(destDir, { recursive: true });
    for (const e of list) {
      if (e.dir) { fs.mkdirSync(e.target, { recursive: true }); continue; }
      fs.mkdirSync(path.dirname(e.target), { recursive: true });
      fs.writeFileSync(e.target, tar.subarray(e.off, e.off + e.size));
    }
  } catch (e) {
    _rmrf(destDir);
    if (e && e.plain) throw e;
    throw _plain('Mimic could not unpack the Kokoro download' + (e && e.message ? ' (' + String(e.message).split('\n')[0].slice(0, 120) + ')' : '') + '. Nothing was changed; the Windows voice keeps working.');
  }
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
const ACCEPT_FILE = 'accepted.json';
// A gated voice only counts as installed while its acceptance record is there (Remove deletes both together).
function _accepted(p, v) {
  if (v.tier === 'free') return true;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(_voiceDir(p, v), ACCEPT_FILE), 'utf8'));
    return r.voice === v.id && r.tier === v.tier && r.terms === true && (v.tier !== 'research' || r.research === true);
  } catch { return false; }
}
function _voiceReady(p, v) {
  const d = _voiceDir(p, v);
  return fs.existsSync(path.join(d, '.ok')) && v.files.every(f => fs.existsSync(path.join(d, f.name))) && _accepted(p, v);
}

function kokoroPaths(root) {
  const base = path.join(root, 'kokoro');
  const runtime = path.join(base, 'runtime'), model = path.join(base, 'model');
  return {
    base, runtime, model, exe: path.join(runtime, ...KOKORO_EXE.split('/')),
    modelFile: path.join(model, 'model.int8.onnx'), voicesFile: path.join(model, 'voices.bin'),
    tokensFile: path.join(model, 'tokens.txt'), dataDir: path.join(model, 'espeak-ng-data'),
    tmp: path.join(root, 'tmp'),
  };
}
// A folder counts as installed only when its marker holds the pinned checksum: re-pinning the manifest makes
// the old download read as "not installed" and Download fetches the new one.
function _marked(dir, sha) { try { return fs.readFileSync(path.join(dir, '.ok'), 'utf8') === sha; } catch { return false; } }
function _kokoroRuntimeReady(p) { return fs.existsSync(p.exe) && _marked(p.runtime, MANIFEST.kokoro.runtime.sha256); }
function _kokoroModelReady(p) { return MANIFEST.kokoro.model.required.every(n => fs.existsSync(path.join(p.model, n))) && _marked(p.model, MANIFEST.kokoro.model.sha256); }
function _kokoroInstalled(p) { return _kokoroRuntimeReady(p) && _kokoroModelReady(p); }

let _progress = null;       // { engine, phase, pct, text } while a download runs; null otherwise
let _kokoroProblem = '';    // why Kokoro last failed to START (not merely to be quick), in plain words; '' = fine
const _cache = createLru();

// What the pickers draw (voice:status). Cheap: a handful of existsSync calls.
function status(root, platform = process.platform) {
  const p = piperPaths(root);
  const available = platform === MANIFEST.piper.platform;
  const runtimeReady = _runtimeReady(p);
  const catalog = MANIFEST.piper.voices.map(v => {
    const installed = runtimeReady && _voiceReady(p, v);
    return {
      id: v.id, label: v.label, tier: v.tier, licence: v.licence, credit: v.credit, modelCardUrl: v.modelCardUrl || '', installed,
      // what pressing Download would fetch for this voice (the runtime counts only if it is not there yet)
      downloadBytes: downloadPlan(v.id, { runtimeReady, voiceReady: installed }).totalBytes,
    };
  });
  const voices = available ? catalog.filter(v => v.installed).map(v => v.id) : [];
  const K = MANIFEST.kokoro, kp = kokoroPaths(root);
  const kRuntime = _kokoroRuntimeReady(kp), kModel = _kokoroModelReady(kp);
  const kInstalled = available && kRuntime && kModel;
  const kBytes = (kRuntime ? 0 : K.runtime.size) + (kModel ? 0 : K.model.size);
  return {
    piper: {
      label: MANIFEST.piper.label, blurb: MANIFEST.piper.blurb, available,
      reason: available ? '' : 'The Piper download is for Windows only.',
      ready: voices.length > 0, voices, runtimeInstalled: runtimeReady, runtimeBytes: MANIFEST.piper.runtime.size, catalog,
    },
    kokoro: {
      label: K.label, blurb: K.blurb, available: platform === K.platform,
      reason: platform === K.platform ? '' : 'The Kokoro download is for Windows only.',
      // ready = installed and usable; the voices are all in one package, so they come and go together
      ready: kInstalled, voices: kInstalled ? K.voices.map(v => v.id) : [],
      downloadBytes: kBytes, totalBytes: K.runtime.size + K.model.size,
      licence: K.licence, credit: K.credit, problem: _kokoroProblem,
      catalog: K.voices.map(v => ({ id: v.id, label: v.label, licence: K.licence, credit: K.credit, installed: kInstalled })),
    },
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

function _installVoice(p, v, bufs, record) {
  const dir = _voiceDir(p, v), tmp = dir + '.tmp-' + stamp();
  fs.mkdirSync(tmp, { recursive: true });
  try {
    v.files.forEach((f, i) => fs.writeFileSync(path.join(tmp, f.name), bufs[i]));
    if (record) fs.writeFileSync(path.join(tmp, ACCEPT_FILE), JSON.stringify(record, null, 2));   // stays on this PC
    fs.writeFileSync(path.join(tmp, '.ok'), v.id);
    _rmrf(dir);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(tmp, dir);
  } catch (e) { _rmrf(tmp); throw e; }
}

// Download + verify + place Kokoro (the engine, then the model). Each archive is checked against its pinned size
// and sha256, unpacked (in JS, see extractTarBz2) into a scratch folder inside kokoro/, and swapped in whole, so a
// failed or cut-off install never leaves a half-written folder looking live. `deps` (tests only): get, kokoro.
async function _installKokoro(root, platform, deps) {
  const K = deps.kokoro || MANIFEST.kokoro;
  const get = deps.get || httpsGet;
  const p = kokoroPaths(root);
  const plan = [];
  if (!_kokoroRuntimeReady(p)) plan.push({ kind: 'runtime', ...K.runtime });
  if (!_kokoroModelReady(p)) plan.push({ kind: 'model', ...K.model });
  const total = plan.reduce((n, f) => n + f.size, 0);
  _progress = { engine: 'kokoro', phase: 'start', pct: 0, text: 'Starting…' };
  const scratch = path.join(p.base, '.dl-' + stamp());
  try {
    fs.mkdirSync(p.base, { recursive: true });
    for (const e of fs.readdirSync(p.base)) if (e.startsWith('.dl-')) _rmrf(path.join(p.base, e));   // a cut-off install
    fs.mkdirSync(scratch, { recursive: true });
    let done = 0;
    for (const f of plan) {
      const what = f.kind === 'runtime' ? 'the Kokoro engine' : 'the Kokoro voices';
      let buf = await get(f.url, {
        onProgress: (got) => {
          const pct = total ? Math.min(98, Math.floor(((done + got) / total) * 100)) : 0;
          _progress = { engine: 'kokoro', phase: f.kind, pct, text: 'Downloading ' + what + '…' };
        },
      });
      verifyFile(buf, f);
      done += f.size;
      const archive = path.join(scratch, f.name);
      fs.writeFileSync(archive, buf);
      buf = null;
      _progress = { engine: 'kokoro', phase: 'unpack', pct: 99, text: 'Unpacking ' + what + '…' };
      const out = path.join(scratch, 'x-' + f.kind);
      await extractTarBz2(archive, out);
      fs.unlinkSync(archive);
      if (f.kind === 'runtime') _placeKokoroRuntime(p, K, out, scratch);
      else _placeKokoroModel(p, K, out);
    }
    _cache.clear();
    _kokoroProblem = '';
    const st = status(root, platform);
    warmUp(root, null, platform, { force: true }).catch(() => {});   // load the model into the OS cache; never awaited
    return st;
  } finally { _progress = null; _rmrf(scratch); }
}

// Keep only the synthesiser and its two libraries; the rest of the archive is other tools and developer files.
function _placeKokoroRuntime(p, K, out, scratch) {
  const src = path.join(out, K.runtime.top), fin = path.join(scratch, 'runtime-final');
  for (const rel of K.runtime.keep) {
    const from = path.join(src, ...rel.split('/'));
    if (!fs.existsSync(from)) throw new Error('The Kokoro engine download did not contain ' + rel.split('/').pop() + '.');
    fs.mkdirSync(path.dirname(path.join(fin, ...rel.split('/'))), { recursive: true });
    fs.copyFileSync(from, path.join(fin, ...rel.split('/')));
  }
  fs.writeFileSync(path.join(fin, '.ok'), K.runtime.sha256);
  _rmrf(p.runtime);
  fs.renameSync(fin, p.runtime);
}
function _placeKokoroModel(p, K, out) {
  const src = path.join(out, K.model.top);
  for (const rel of K.model.required) {
    if (!fs.existsSync(path.join(src, rel))) throw new Error('The Kokoro voices download did not contain ' + rel + '.');
  }
  fs.writeFileSync(path.join(src, '.ok'), K.model.sha256);
  _rmrf(p.model);
  fs.renameSync(src, p.model);
}

// Download + verify + place Piper and one voice (or Kokoro as a whole). One at a time. Throws an Error whose message
// is for a person. `opts.accept` is the user's ticked boxes for a non-free voice; without them nothing is fetched.
async function install(root, engine, voiceId, platform = process.platform, opts = {}) {
  if (engine === 'kokoro') {
    if (platform !== MANIFEST.kokoro.platform) throw new Error('The Kokoro download is for Windows only.');
    if (_progress) throw new Error('A voice download is already running.');
    return _installKokoro(root, platform, opts.deps || {});
  }
  if (engine !== 'piper') throw new Error('Unknown voice engine.');
  if (platform !== MANIFEST.piper.platform) throw new Error('The Piper download is for Windows only.');
  const v = findVoice('piper', voiceId || MANIFEST.piper.voices[0].id);
  if (!v) throw new Error('Unknown voice.');
  const unaccepted = acceptanceProblem(v, opts.accept);
  if (unaccepted) throw new Error(unaccepted);
  if (_progress) throw new Error('A voice download is already running.');
  const p = piperPaths(root);
  const plan = downloadPlan(v.id, { runtimeReady: _runtimeReady(p), voiceReady: _voiceReady(p, v) });
  _progress = { engine: 'piper', phase: 'start', pct: 0, text: 'Starting…' };
  try {
    let done = 0;
    const voiceBufs = [];
    for (const f of plan.files) {
      const what = f.kind === 'runtime' ? 'Piper' : v.label;
      const buf = await ((opts.deps && opts.deps.get) || httpsGet)(f.url, {
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
    if (voiceBufs.length) _installVoice(p, v, voiceBufs, v.tier === 'free' ? null : acceptanceRecord(v, opts.accept));
    _cache.clear();
    return status(root, platform);
  } finally { _progress = null; }
}

// Delete a download: Piper and all its voices, one Piper voice (with its acceptance record) when `voiceId` is
// given, or Kokoro. Refused while a download is running.
function remove(root, engine, platform = process.platform, voiceId = '') {
  if (_progress) throw new Error('A voice download is running; wait for it to finish.');
  if (engine === 'piper') {
    if (voiceId) { const v = findVoice('piper', voiceId); if (v) _rmrf(_voiceDir(piperPaths(root), v)); }
    else _rmrf(piperPaths(root).base);
    _cache.clear();
  }
  if (engine === 'kokoro') { _rmrf(kokoroPaths(root).base); _kokoroProblem = ''; _cache.clear(); }
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

// Windows' "a DLL this program needs is not on this PC" exit code (STATUS_DLL_NOT_FOUND, 0xC0000135).
const EXIT_DLL_NOT_FOUND = 0xC0000135;
function _kokoroStartProblem(code) {
  if ((Number(code) >>> 0) === EXIT_DLL_NOT_FOUND) return NO_VCRT;
  return 'Kokoro did not start on this PC (exit code ' + code + '), so the Windows voice is being used instead.';
}

function _runKokoro(p, v, text, rate, signal) {
  return new Promise((resolve, reject) => {
    if (!_tmpSwept) { _tmpSwept = true; _rmrf(p.tmp); }
    fs.mkdirSync(p.tmp, { recursive: true });
    const out = path.join(p.tmp, 'say-' + stamp() + '.wav');
    const args = kokoroArgs(p, v.sid, rate, text, out, _kokoroThreads());
    const child = spawn(p.exe, args, { cwd: path.dirname(p.exe), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const drop = () => { try { fs.unlinkSync(out); } catch { /* not written */ } };
    signal.addEventListener('abort', () => { try { child.kill(); } catch { /* gone */ } drop(); reject(new Error('timed out')); }, { once: true });
    child.on('error', (e) => { drop(); reject(e); });
    child.on('close', (code) => {
      if (code !== 0) { drop(); _kokoroProblem = _kokoroStartProblem(code); reject(new Error('kokoro exited ' + code)); return; }
      try { const b = fs.readFileSync(out); drop(); _kokoroProblem = ''; resolve(b); } catch (e) { reject(e); }
    });
  });
}

// → a WAV Buffer, or null (not installed, wrong engine, failure, or past the time limit). Repeat phrases are
// served from the cache without starting a process. A callout gets SYNTH_TIMEOUT_MS; `spec.test` (a person
// pressing ▶ Test and waiting on purpose) gets TEST_TIMEOUT_MS.
async function synthesize(root, spec, platform = process.platform) {
  try {
    const engine = spec && spec.engine;
    const v = findVoice(engine, spec && spec.voice);
    const text = _cleanText(spec && spec.text);
    if (!v || !text || platform !== MANIFEST[engine].platform) return null;
    let run;
    if (engine === 'kokoro') {
      const p = kokoroPaths(root);
      if (!_kokoroInstalled(p)) return null;
      if (!_kokoroText(text)) return null;
      run = (signal) => _runKokoro(p, v, text, spec.rate, signal);
    } else {
      const p = piperPaths(root);
      if (!_runtimeReady(p) || !_voiceReady(p, v)) return null;
      run = (signal) => _runPiper(p, v, text, spec.rate, signal);
    }
    const key = cacheKey(engine, v.id, spec.rate, text);
    const hit = _cache.get(key);
    if (hit) return hit;
    const buf = await synthOrNull(run, spec.test === true ? TEST_TIMEOUT_MS : SYNTH_TIMEOUT_MS);
    if (buf) _cache.set(key, buf);
    return buf;
  } catch { return null; }
}

// Kokoro loads a 130 MB model for every phrase, so its first run after a boot or an install is the slow one
// (disk, not CPU). Say one short word in the background to pull the files into the system cache and to find out
// early if the engine cannot start at all (status().kokoro.problem). Runs after an install, and at Mimic start
// when Kokoro is the voice that would speak. Never throws and never blocks anything: resolves true if it spoke.
const WARM_PHRASE = 'Ready.';
let _lastWarm = Promise.resolve(false);
function warmUp(root, cfgVoice, platform = process.platform, { force = false } = {}) {
  _lastWarm = (async () => {
    try {
      if (platform !== MANIFEST.kokoro.platform || !_kokoroInstalled(kokoroPaths(root))) return false;
      let voice = MANIFEST.kokoro.voices[0].id;
      if (!force) {
        const c = require('./voice').chooseEngine(cfgVoice, status(root, platform));
        if (c.engine !== 'kokoro') return false;
        voice = c.voice;
      }
      return !!(await synthesize(root, { engine: 'kokoro', voice, rate: 1, text: WARM_PHRASE, test: true }, platform));
    } catch { return false; }
  })();
  return _lastWarm;
}

module.exports = {
  MANIFEST, SYNTH_TIMEOUT_MS, TEST_TIMEOUT_MS, PIPER_VOICES_REV, NO_VCRT, WARM_PHRASE,
  status, install, remove, synthesize, warmUp,
  // pure, for tests
  lengthScale, cacheKey, createLru, synthOrNull, downloadPlan, safeZipTarget, verifyFile, findVoice, piperPaths,
  kokoroPaths, kokoroArgs, extractTarBz2, acceptanceProblem, acceptanceRecord, kokoroStartProblem: _kokoroStartProblem,
  installVoiceFiles: _installVoice,
  lastWarmUp: () => _lastWarm,
};
