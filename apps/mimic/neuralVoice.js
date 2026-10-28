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
// Silence put in front of every downloaded-voice phrase (the guild lead, 2026-10-21: "Slowed. Turgur's" was heard as
// "DONT TURRIS"). Piper and Kokoro write the first sample of speech at sample 0 and the player starts the <audio> cold,
// so the first syllable can be clipped while the output device wakes up. Windows voices are untouched. 0 turns it off.
const NEURAL_LEAD_IN_MS = 80;

// → a copy of a 16-bit PCM WAV with `ms` of silence before the speech, or the SAME buffer when it is not one we can
// pad safely (another format, a data chunk that is not last, a damaged header). Never throws.
function leadInWav(buf, ms = NEURAL_LEAD_IN_MS) {
  try {
    if (!Buffer.isBuffer(buf) || !(ms > 0) || buf.length < 44) return buf;
    if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return buf;
    let fmt = null;
    for (let o = 12; o + 8 <= buf.length;) {
      const id = buf.toString('latin1', o, o + 4), size = buf.readUInt32LE(o + 4);
      if (id === 'fmt ' && size >= 16 && o + 8 + size <= buf.length) {
        fmt = { tag: buf.readUInt16LE(o + 8), ch: buf.readUInt16LE(o + 10), rate: buf.readUInt32LE(o + 12), bits: buf.readUInt16LE(o + 22) };
      } else if (id === 'data') {
        const start = o + 8;
        if (!fmt || fmt.tag !== 1 || fmt.bits !== 16 || !fmt.ch || !fmt.rate || start + size !== buf.length) return buf;
        const pad = Buffer.alloc(Math.round(fmt.rate * ms / 1000) * fmt.ch * 2);
        const out = Buffer.concat([buf.subarray(0, start), pad, buf.subarray(start)]);
        out.writeUInt32LE(out.length - 8, 4);
        out.writeUInt32LE(size + pad.length, o + 4);
        return out;
      }
      o += 8 + size + (size & 1);
    }
    return buf;
  } catch { return buf; }
}

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
//
// ⚠ The voice list is GENERATED (the guild lead, 2026-10-28: "lets make it so we can grab more voices"):
// `node scripts/sync-piper-voices.js` pins a commit of rhasspy/piper-voices and writes piper-voices.json — every
// model in the repo with its two files' URLs, byte sizes and sha256, and for en_US / en_GB the licence tier read from
// the voice's MODEL_CARD. Two more tiers sit beside the three above:
//   · unchecked — every other language (and anything the generator could not classify): offered, but Wolf Pack has not
//                 read the licence. The user ticks the accept box; the text says "read the model card".
//   · custom    — a voice the user adds from two https links or two files on this PC (addCustomVoice). Licence
//                 unknown by definition; the user ticks "you are responsible for its licence". Id prefix `custom-`.
// The six voices offered since 2026-10-17 keep their ids and their hand-written label / licence / credit text
// (LEGACY_TEXT), so an installed choice still resolves and the accept screens read as before.
const PIPER_DATA = require('./piper-voices.json');
const PIPER_VOICES_REV = PIPER_DATA.rev;
const CUSTOM_PREFIX = 'custom-';
const CUSTOM_LICENCE = 'Custom voice — you are responsible for its licence';
const UNCHECKED_LICENCE = 'Licence not checked by Wolf Pack — read the model card';
const LEGACY_TEXT = Object.freeze({
  'en_US-kristin-medium': Object.freeze({ label: 'Kristin (US English, woman)', licence: 'Public domain',
    credit: 'Voice trained by Bryce Beattie on LibriVox recordings (public domain).' }),
  'en_US-john-medium': Object.freeze({ label: 'John (US English, man)', licence: 'Public domain',
    credit: 'Voice trained by Bryce Beattie on LibriVox recordings (public domain).' }),
  'en_US-ryan-high': Object.freeze({ label: 'Ryan (US English, man, high quality)', licence: 'CC BY-NC-SA 4.0',
    credit: 'Trained on the RyanSpeech data set (CC BY-NC-SA 4.0), voice by the Piper project (rhasspy/piper-voices).' }),
  'en_US-lessac-medium': Object.freeze({ label: 'Lessac (US English, woman)', licence: 'Blizzard 2013 data, research licence',
    credit: 'Trained on the Lessac Blizzard 2013 data (per-user research licence), voice by the Piper project.' }),
  'en_US-joe-medium': Object.freeze({ label: 'Joe (US English, man)', licence: 'CC0 data, fine-tuned from the research-only Lessac voice',
    credit: 'Trained on the OHF-Voice CC0 data set, fine-tuned from the Lessac voice (research licence), by the Piper project.' }),
  'en_US-ryan-medium': Object.freeze({ label: 'Ryan (US English, man, medium)', licence: 'CC BY-NC-SA 4.0 data, fine-tuned from the research-only Lessac voice',
    credit: 'Trained on RyanSpeech (CC BY-NC-SA 4.0), fine-tuned from the Lessac voice (research licence), by the Piper project.' }),
});
const LEGACY_ORDER = Object.freeze(Object.keys(LEGACY_TEXT));   // first in the list, so "the first voice" is still Kristin

function _titleCase(s) { return String(s).replace(/_/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase()); }
// One generated record → the manifest shape the rest of this file uses.
function _voiceFromData(d) {
  const t = LEGACY_TEXT[d.id] || {};
  return Object.freeze({
    id: d.id,
    label: t.label || _titleCase(d.name),
    tier: d.tier,
    licence: t.licence || d.licence || UNCHECKED_LICENCE,
    credit: t.credit || d.credit || '',
    modelCardUrl: d.card || '',
    lang: d.lang, languageName: d.languageName, quality: d.quality, speakers: d.speakers > 1 ? d.speakers : 1,
    files: Object.freeze([
      Object.freeze({ name: d.id + '.onnx', url: d.onnx.url, size: d.onnx.size, sha256: d.onnx.sha256 }),
      Object.freeze({ name: d.id + '.onnx.json', url: d.config.url, size: d.config.size, sha256: d.config.sha256 }),
    ]),
  });
}
const PIPER_VOICES = Object.freeze(PIPER_DATA.voices.map(_voiceFromData).sort((a, b) => {
  const ia = LEGACY_ORDER.indexOf(a.id), ib = LEGACY_ORDER.indexOf(b.id);
  if (ia >= 0 || ib >= 0) return ia < 0 ? 1 : ib < 0 ? -1 : ia - ib;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}));

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
    voices: PIPER_VOICES,   // generated: piper-voices.json (scripts/sync-piper-voices.js)
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
// A multi-speaker voice is a different sound per speaker number, so a speaker above 0 is part of the key.
function cacheKey(engine, voice, rate, text, speaker) {
  const r = Number(rate), s = Number(speaker);
  return [engine, voice + ((Number.isInteger(s) && s > 0) ? '#' + s : ''), (Number.isFinite(r) && r > 0) ? r.toFixed(2) : '1.00', _cleanText(text)].join('|');
}

// The speaker number a multi-speaker Piper model is asked for (--speaker): a whole number inside 0..speakers-1, else 0.
// A single-speaker voice has no speaker to pick (normalizeSpeaker → 0, and piperArgs leaves the flag off).
function normalizeSpeaker(v, n) {
  const s = Number(n), count = v && v.speakers > 1 ? v.speakers : 1;
  return (Number.isInteger(s) && s >= 0 && s < count) ? s : 0;
}

// Piper's command line for one phrase. The model and config are file PATHS handed to the program; nothing in them is
// ever evaluated here. `--speaker <n>` only for a model with more than one speaker.
function piperArgs(p, v, dir, out, rate, speaker) {
  const args = [
    '--model', path.join(dir, v.files[0].name), '--config', path.join(dir, v.files[1].name),
    '--output_file', out, '--length_scale', String(lengthScale(rate)),
    '--espeak_data', p.espeak, '--quiet',
  ];
  if (v.speakers > 1) args.push('--speaker', String(normalizeSpeaker(v, speaker)));
  return args;
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

// ── Custom voices (the user's own, from two https links or two files) ────────────────────────────────
// Each lives in voices/custom-<name>/ beside the catalog ones: <id>.onnx, <id>.onnx.json, custom.json (what Mimic
// needs to list it), accepted.json (the ticked responsibility box) and the .ok marker written last. They are found by
// reading the folder, so there is no second list to keep in step; the prefix cannot collide with a catalog id (those
// start with a language code).
const CUSTOM_META = 'custom.json';
const CUSTOM_ID_RE = /^custom-[a-z0-9][a-z0-9._-]{0,47}$/;
const CUSTOM_MAX_BYTES = 200 * 1024 * 1024;   // the biggest catalog model is ~130 MB
const CUSTOM_MAX_CONFIG_BYTES = 1024 * 1024;  // a model's .onnx.json is a few KB to a few hundred KB

function _customFromMeta(id, m) {
  return Object.freeze({
    id, label: String(m.label || id.slice(CUSTOM_PREFIX.length)).slice(0, 60), tier: 'custom',
    licence: CUSTOM_LICENCE, credit: 'Added by you' + (m.source ? ' from ' + String(m.source).slice(0, 120) : '') + '.',
    modelCardUrl: '', custom: true, speakers: m.speakers > 1 ? Math.floor(m.speakers) : 1,
    files: Object.freeze([Object.freeze({ name: id + '.onnx' }), Object.freeze({ name: id + '.onnx.json' })]),
  });
}
// → the custom voices on disk (finished installs only: the .ok marker and the metadata are both there).
function customVoices(p) {
  let names = [];
  try { names = fs.readdirSync(p.voices); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!CUSTOM_ID_RE.test(n)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(p.voices, n, CUSTOM_META), 'utf8'));
      if (m && m.id === n && fs.existsSync(path.join(p.voices, n, '.ok'))) out.push(_customFromMeta(n, m));
    } catch { /* half-written or foreign folder: not a voice */ }
  }
  return out;
}
// A Piper voice by id: the catalog first, then the user's own.
function _piperVoice(p, id) {
  return findVoice('piper', id) || (CUSTOM_ID_RE.test(String(id || '')) ? customVoices(p).find(v => v.id === id) || null : null);
}

// ── Taking a custom voice in ─────────────────────────────────────────────────────────────────────────
// → the href of an https URL, or throws a plain-words Error. http, file:, ftp:, data: and the rest are refused, and so
// is a link carrying a user name or password.
function customUrl(raw) {
  let u;
  try { u = new URL(String(raw == null ? '' : raw).trim()); } catch { throw _plain('That is not a web address. Paste a full link that starts with https://'); }
  if (u.protocol !== 'https:') throw _plain('Only https:// links are accepted (not ' + u.protocol.replace(':', '') + ':). Nothing was downloaded.');
  if (u.username || u.password) throw _plain('Links with a user name or password in them are not accepted.');
  if (u.href.length > 2048) throw _plain('That link is too long.');
  return u.href;
}

// A file or link name → the id of a custom voice: lower case, letters/digits/dot/dash/underscore only, no path
// separators, never starting with a dot. `taken` (names already used) makes it unique with -2, -3…
function customName(raw, taken = []) {
  let base = String(raw == null ? '' : raw);
  try { base = decodeURIComponent(base); } catch { /* keep as is */ }
  base = base.split(/[\\/]/).pop().replace(/\.onnx(\.json)?$/i, '').replace(/\.json$/i, '');
  let slug = base.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/-{2,}/g, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').slice(0, 40).replace(/[^a-z0-9]+$/, '');
  if (!slug) slug = 'voice';
  let id = CUSTOM_PREFIX + slug, n = 2;
  while (taken.includes(id)) id = CUSTOM_PREFIX + slug.slice(0, 36) + '-' + n++;
  return id;
}

// The .onnx.json of a Piper voice → { sampleRate, speakers, label } or throws a plain-words Error. Piper cannot load a
// voice without its sample rate, speaker count and phoneme table, so a file missing them is refused before anything
// is kept. The text is only ever parsed as JSON.
function validateVoiceConfig(buf) {
  const bad = (why) => _plain('That does not look like a Piper voice file (' + why + '). Nothing was added.');
  if (!buf || !buf.length) throw bad('the .onnx.json is empty');
  if (buf.length > CUSTOM_MAX_CONFIG_BYTES) throw bad('the .onnx.json is far larger than a voice file');
  let j;
  try { j = JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)); } catch { throw bad('the .onnx.json is not valid JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw bad('the .onnx.json is not an object');
  const sr = j.audio && j.audio.sample_rate;
  if (!Number.isInteger(sr) || sr < 4000 || sr > 192000) throw bad('no audio.sample_rate');
  const sp = j.num_speakers;
  if (!Number.isInteger(sp) || sp < 1 || sp > 100000) throw bad('no num_speakers');
  if (!j.phoneme_id_map || typeof j.phoneme_id_map !== 'object' || Array.isArray(j.phoneme_id_map) || !Object.keys(j.phoneme_id_map).length) throw bad('no phoneme_id_map');
  const label = typeof j.dataset === 'string' ? j.dataset : '';
  return { sampleRate: sr, speakers: sp, label };
}

// The first bytes of an ONNX model: a protobuf whose first field is ir_version (tag 0x08). Cheap proof that a download
// is not a web page or a text file with the right name.
function looksLikeOnnx(head) { return !!head && head.length >= 2 && head[0] === 0x08; }

// Stream `readable` into `dest`, stopping (and deleting the partial file) once it passes `maxBytes`. Resolves the byte
// count and sha256. Pure enough to test with a Readable.
function pipeLimited(readable, dest, maxBytes, onProgress) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(dest);
    let got = 0, head = null, done = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      try { readable.destroy(); } catch { /* gone */ }
      out.destroy();
      try { fs.unlinkSync(dest); } catch { /* not created */ }
      reject(e);
    };
    readable.on('data', (c) => {
      got += c.length;
      if (got > maxBytes) { fail(_plain('That file is bigger than the ' + Math.round(maxBytes / 1048576) + ' MB limit for a custom voice, so it was thrown away.')); return; }
      if (!head) head = Buffer.from(c.subarray(0, 16));
      hash.update(c);
      if (!out.write(c)) { readable.pause(); out.once('drain', () => readable.resume()); }
      if (onProgress) { try { onProgress(got); } catch { /* a progress bar must not break a download */ } }
    });
    readable.on('error', fail);
    readable.on('aborted', () => fail(_plain('The download was cut short, so it was thrown away.')));
    out.on('error', fail);
    readable.on('end', () => {
      if (done) return;
      out.end(() => { if (done) return; done = true; resolve({ size: got, sha256: hash.digest('hex'), head: head || Buffer.alloc(0) }); });
    });
  });
}

// GET an https URL into `dest` through pipeLimited. Redirects are followed only to other https addresses.
function fetchToFile(url, dest, { maxBytes = CUSTOM_MAX_BYTES, onProgress = null, redirects = 5, request = require('https').request } = {}) {
  return new Promise((resolve, reject) => {
    let href;
    try { href = customUrl(url); } catch (e) { reject(e); return; }
    const req = request(href, { method: 'GET', headers: { 'User-Agent': 'WolfPackMimic', Accept: '*/*' }, timeout: 30000 }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) { reject(_plain('That link redirects too many times.')); return; }
        let next;
        try { next = customUrl(new URL(res.headers.location, href).href); } catch (e) { reject(_plain('That link redirects somewhere that is not https, so it was not followed.')); return; }
        resolve(fetchToFile(next, dest, { maxBytes, onProgress, redirects: redirects - 1, request }));
        return;
      }
      if (code < 200 || code >= 300) { res.resume(); reject(_plain('The server answered ' + code + ' for ' + new URL(href).hostname + '. Nothing was added.')); return; }
      const total = Number(res.headers['content-length']) || 0;
      if (total > maxBytes) { res.resume(); reject(_plain('That file is ' + Math.round(total / 1048576) + ' MB, over the ' + Math.round(maxBytes / 1048576) + ' MB limit for a custom voice. Nothing was downloaded.')); return; }
      pipeLimited(res, dest, maxBytes, onProgress).then(resolve, reject);
    });
    req.on('error', (e) => reject(_plain('Could not reach ' + new URL(href).hostname + (e && e.code ? ' (' + e.code + ')' : '') + '. Nothing was added.')));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// A small file (the .onnx.json) from a link, in memory, with its own tight cap.
async function _fetchSmall(url, fetchFile, dir) {
  const tmp = path.join(dir, 'config-download.json');
  await fetchFile(url, tmp, { maxBytes: CUSTOM_MAX_CONFIG_BYTES });
  const buf = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  return buf;
}

// Add a voice of the user's own. `src` is { onnxUrl, configUrl } (two https links) or { onnxPath, configPath } (two files
// on this PC); `accept` must carry { terms: true } (the "I am responsible for its licence" box). Piper itself is fetched
// first if it is not installed yet. The model is copied or streamed into a scratch folder, checked, and renamed into
// place whole. Never executes or evaluates the model: it is only ever a path on Piper's command line.
// `deps` (tests): fetchFile, get (for the Piper runtime).
async function addCustomVoice(root, src, accept, platform = process.platform, deps = {}) {
  if (platform !== MANIFEST.piper.platform) throw new Error('The Piper download is for Windows only.');
  const probe = { id: CUSTOM_PREFIX + 'x', tier: 'custom' };
  const unaccepted = acceptanceProblem(probe, accept);
  if (unaccepted) throw new Error(unaccepted.replace('this voice', 'this custom voice').replace('Nothing was downloaded', 'Nothing was added'));
  if (_progress) throw new Error('A voice download is already running.');
  src = src && typeof src === 'object' ? src : {};
  const fromUrl = !!(src.onnxUrl || src.configUrl);
  let onnxHref = '', cfgHref = '';
  if (fromUrl) {
    onnxHref = customUrl(src.onnxUrl); cfgHref = customUrl(src.configUrl);
    if (!/\.onnx$/i.test(new URL(onnxHref).pathname)) throw _plain('The first link should end in .onnx (the voice model).');
    if (!/\.onnx\.json$/i.test(new URL(cfgHref).pathname)) throw _plain('The second link should end in .onnx.json (the voice settings).');
  } else {
    for (const [k, ext] of [['onnxPath', /\.onnx$/i], ['configPath', /\.onnx\.json$/i]]) {
      const f = String(src[k] || '');
      let st = null;
      try { st = f && fs.statSync(f); } catch { /* missing */ }
      if (!st || !st.isFile()) throw _plain('Pick the voice files again: ' + (k === 'onnxPath' ? 'the .onnx model' : 'the .onnx.json settings') + ' was not found.');
      if (!ext.test(f)) throw _plain('Pick a file ending in ' + (k === 'onnxPath' ? '.onnx' : '.onnx.json') + '.');
      if (st.size > (k === 'onnxPath' ? CUSTOM_MAX_BYTES : CUSTOM_MAX_CONFIG_BYTES)) throw _plain('That file is too large for a voice, so nothing was added.');
    }
  }
  const p = piperPaths(root), fetchFile = deps.fetchFile || fetchToFile;
  _progress = { engine: 'piper', phase: 'start', pct: 0, text: 'Starting…' };
  const scratch = path.join(p.voices, '.custom-tmp-' + stamp());
  try {
    if (!_runtimeReady(p)) {
      _progress = { engine: 'piper', phase: 'runtime', pct: 1, text: 'Downloading Piper…' };
      const rt = MANIFEST.piper.runtime;
      const buf = await (deps.get || httpsGet)(rt.url, { onProgress: (got) => { _progress = { engine: 'piper', phase: 'runtime', pct: Math.min(40, Math.floor(got / rt.size * 40)), text: 'Downloading Piper…' }; } });
      verifyFile(buf, rt);
      _progress = { engine: 'piper', phase: 'unpack', pct: 45, text: 'Unpacking Piper…' };
      _installRuntime(p, buf);
    }
    fs.mkdirSync(scratch, { recursive: true });
    const cfgBuf = fromUrl ? await _fetchSmall(cfgHref, fetchFile, scratch) : fs.readFileSync(src.configPath);
    const info = validateVoiceConfig(cfgBuf);
    const taken = []; try { taken.push(...fs.readdirSync(p.voices)); } catch { /* none yet */ }
    const id = customName(fromUrl ? new URL(onnxHref).pathname : src.onnxPath, taken);
    const modelTmp = path.join(scratch, id + '.onnx');
    let head;
    if (fromUrl) {
      const r = await fetchFile(onnxHref, modelTmp, { maxBytes: CUSTOM_MAX_BYTES, onProgress: (got) => { _progress = { engine: 'piper', phase: 'voice', pct: Math.min(98, 50 + Math.floor(got / CUSTOM_MAX_BYTES * 48)), text: 'Downloading your voice…' }; } });
      head = r.head;
    } else {
      fs.copyFileSync(src.onnxPath, modelTmp);
      const fd = fs.openSync(modelTmp, 'r'); head = Buffer.alloc(16); try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
    }
    if (!looksLikeOnnx(head)) throw _plain('That file is not a voice model (it does not start like an .onnx file), so nothing was added.');
    fs.writeFileSync(path.join(scratch, id + '.onnx.json'), cfgBuf);
    const label = (info.label ? _titleCase(info.label) : _titleCase(id.slice(CUSTOM_PREFIX.length))) + ' (custom)';
    const source = fromUrl ? new URL(onnxHref).hostname : 'a file on this PC';
    fs.writeFileSync(path.join(scratch, CUSTOM_META), JSON.stringify({ id, label, speakers: info.speakers, sampleRate: info.sampleRate, source, addedAt: new Date().toISOString() }, null, 2));
    fs.writeFileSync(path.join(scratch, ACCEPT_FILE), JSON.stringify(acceptanceRecord(_customFromMeta(id, { speakers: info.speakers }), accept), null, 2));   // stays on this PC
    fs.writeFileSync(path.join(scratch, '.ok'), id);
    fs.renameSync(scratch, _voiceDir(p, { id }));
    _cache.clear();
    return status(root, platform);
  } finally { _progress = null; _rmrf(scratch); }
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
      lang: v.lang, languageName: v.languageName, quality: v.quality, speakers: v.speakers,
      // what pressing Download would fetch for this voice (the runtime counts only if it is not there yet)
      downloadBytes: downloadPlan(v.id, { runtimeReady, voiceReady: installed }).totalBytes,
      voiceBytes: v.files.reduce((n, f) => n + f.size, 0),
    };
  });
  for (const v of customVoices(p)) {
    catalog.push({ id: v.id, label: v.label, tier: v.tier, licence: v.licence, credit: v.credit, modelCardUrl: '', installed: runtimeReady && _voiceReady(p, v),
      custom: true, speakers: v.speakers, downloadBytes: 0, voiceBytes: 0 });
  }
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
    if (voiceId) { const p = piperPaths(root), v = _piperVoice(p, voiceId); if (v) _rmrf(_voiceDir(p, v)); }
    else _rmrf(piperPaths(root).base);
    _cache.clear();
  }
  if (engine === 'kokoro') { _rmrf(kokoroPaths(root).base); _kokoroProblem = ''; _cache.clear(); }
  return status(root, platform);
}

// ── Speaking ────────────────────────────────────────────────────────────────────────────────────────
let _tmpSwept = false;
function _runPiper(p, v, text, rate, signal, speaker) {
  return new Promise((resolve, reject) => {
    if (!_tmpSwept) { _tmpSwept = true; _rmrf(p.tmp); }   // leftovers of a phrase that was cut off last time
    fs.mkdirSync(p.tmp, { recursive: true });
    const out = path.join(p.tmp, 'say-' + stamp() + '.wav');
    const dir = _voiceDir(p, v);
    const args = piperArgs(p, v, dir, out, rate, speaker);
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
    const v = engine === 'piper' ? _piperVoice(piperPaths(root), spec && spec.voice) : findVoice(engine, spec && spec.voice);
    const text = _cleanText(spec && spec.text);
    if (!v || !text || platform !== MANIFEST[engine].platform) return null;
    const speaker = engine === 'piper' ? normalizeSpeaker(v, spec.speaker) : 0;
    let run;
    if (engine === 'kokoro') {
      const p = kokoroPaths(root);
      if (!_kokoroInstalled(p)) return null;
      if (!_kokoroText(text)) return null;
      run = (signal) => _runKokoro(p, v, text, spec.rate, signal);
    } else {
      const p = piperPaths(root);
      if (!_runtimeReady(p) || !_voiceReady(p, v)) return null;
      run = (signal) => _runPiper(p, v, text, spec.rate, signal, speaker);
    }
    const key = cacheKey(engine, v.id, spec.rate, text, speaker);
    const hit = _cache.get(key);
    if (hit) return hit;
    const raw = await synthOrNull(run, spec.test === true ? TEST_TIMEOUT_MS : SYNTH_TIMEOUT_MS);
    const buf = raw && leadInWav(raw);   // padded once, then cached padded
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
  MANIFEST, SYNTH_TIMEOUT_MS, TEST_TIMEOUT_MS, NEURAL_LEAD_IN_MS, leadInWav, PIPER_VOICES_REV, NO_VCRT, WARM_PHRASE,
  status, install, remove, synthesize, warmUp,
  // pure, for tests
  addCustomVoice, customUrl, customName, validateVoiceConfig, customVoices, pipeLimited, fetchToFile, looksLikeOnnx,
  normalizeSpeaker, piperArgs, CUSTOM_MAX_BYTES, CUSTOM_PREFIX, CUSTOM_LICENCE, UNCHECKED_LICENCE,
  lengthScale, cacheKey, createLru, synthOrNull, downloadPlan, safeZipTarget, verifyFile, findVoice, piperPaths,
  kokoroPaths, kokoroArgs, extractTarBz2, acceptanceProblem, acceptanceRecord, kokoroStartProblem: _kokoroStartProblem,
  installVoiceFiles: _installVoice,
  lastWarmUp: () => _lastWarm,
};
