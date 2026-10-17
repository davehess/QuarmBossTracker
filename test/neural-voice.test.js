// test/neural-voice.test.js — free, open-source callout voices beside the Windows voice (the guild lead,
// 2026-10-17: "Piper is the default download, Kokoro the upgrade; the Windows voice stays the fallback").
//
//   · the engine chooser (voice.js, mirrored in the dashboard) and its fallback to the Windows voice
//   · the WAV cache key + LRU, the speed mapping, the time limit that turns a slow synth into null
//   · the download manifest: exact pinned URLs, byte sizes and sha256, plus each voice's licence line
//   · the plan / checksum / zip-path guards that stop a bad download becoming a live install
//   · a real child process: a fake piper.exe that succeeds, fails, or hangs (POSIX only)
//   · source checks (comments stripped) that every failure in the trigger window, the dashboard and the sample
//     button ends in the Windows voice — a callout is never silenced by a download that broke
//
// Run: npx vitest run test/neural-voice.test.js

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const nv = require_('../apps/mimic/neuralVoice.js');
const WPVoice = require_('../apps/mimic/voice.js');

const READY = { piper: { ready: true, voices: ['en_US-kristin-medium', 'en_US-john-medium'] }, kokoro: { ready: false, voices: [] } };
const EMPTY = { piper: { ready: false, voices: [] }, kokoro: { ready: false, voices: [] } };

describe('engine chooser', () => {
  const win = { engine: 'windows', voice: null };
  const table = [
    ['no answer from Mimic yet', {}, null, win],
    ['nothing installed (auto)', { engine: 'auto' }, EMPTY, win],
    ['no cfg at all', null, READY, { engine: 'piper', voice: 'en_US-kristin-medium' }],
    ['auto takes an installed engine, its first voice', { engine: 'auto' }, READY, { engine: 'piper', voice: 'en_US-kristin-medium' }],
    ['engine missing from cfg reads as auto', { pack: 'herald' }, READY, { engine: 'piper', voice: 'en_US-kristin-medium' }],
    ['the picked voice wins when installed', { engine: 'piper', piperVoice: 'en_US-john-medium' }, READY, { engine: 'piper', voice: 'en_US-john-medium' }],
    ['a voice that is not installed falls to the first one', { engine: 'piper', piperVoice: 'en_US-ryan-medium' }, READY, { engine: 'piper', voice: 'en_US-kristin-medium' }],
    ['an explicit Windows pick stays Windows', { engine: 'windows' }, READY, win],
    ['Piper picked but removed → Windows', { engine: 'piper' }, EMPTY, win],
    ['Kokoro picked (a stub, never ready) → Windows', { engine: 'kokoro' }, READY, win],
    ['an unknown engine name → Windows', { engine: 'espeak' }, READY, win],
    ['a status without voices → Windows', { engine: 'piper' }, { piper: { ready: true, voices: [] } }, win],
  ];
  for (const [name, cfg, st, want] of table) {
    it(name, () => expect(WPVoice.chooseEngine(cfg, st)).toEqual(want));
  }

  it('Kokoro outranks Piper under auto once it is ever ready (the upgrade)', () => {
    const both = { piper: READY.piper, kokoro: { ready: true, voices: ['af_heart'] } };
    expect(WPVoice.chooseEngine({ engine: 'auto' }, both)).toEqual({ engine: 'kokoro', voice: 'af_heart' });
  });

  it("the dashboard's copy of the chooser gives the same answers", () => {
    const src = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
    const block = sliceBlock(src, 'function chooseEngine(cfg, status) {', "return { engine: 'windows', voice: null };\n  }");
    const { chooseEngine } = evalBlock(block, ['chooseEngine']);
    for (const [, cfg, st] of table) expect(chooseEngine(cfg, st)).toEqual(WPVoice.chooseEngine(cfg, st));
    const both = { piper: READY.piper, kokoro: { ready: true, voices: ['af_heart'] } };
    expect(chooseEngine({}, both)).toEqual(WPVoice.chooseEngine({}, both));
  });
});

describe('neuralAudio (the renderer side)', () => {
  // voice.js attaches to `window` when it has no module; run it in a sandbox that has one.
  function load(extra = {}) {
    const win = Object.assign({}, extra);
    // a browser's timers are globals; hand over whatever is installed now (real, or vitest's fake ones)
    vm.runInNewContext(readSource(path.join(ROOT, 'apps', 'mimic', 'voice.js')), { window: win, setTimeout, clearTimeout });
    return win;
  }
  const audioFakes = () => {
    const made = [];
    class Audio { constructor(u) { this.u = u; made.push(this); } addEventListener() {} }
    return { made, Audio, Blob: class { constructor(p, o) { this.p = p; this.o = o; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} } };
  };
  const CH = { engine: 'piper', voice: 'en_US-kristin-medium' };
  const buf = new Uint8Array([82, 73, 70, 70]);

  it('hands the engine the exact words and the speed, and returns an audio element', async () => {
    const f = audioFakes(); const calls = [];
    const win = load({ ...f, mimic: { voiceSynth: (t, s) => { calls.push([t, s]); return Promise.resolve(buf); } } });
    const a = await win.WPVoice.neuralAudio('Enrage soon, Ahl-den-mar.', 1.2, CH);
    expect(a).toBeTruthy();
    expect(calls).toEqual([['Enrage soon, Ahl-den-mar.', { engine: 'piper', voice: 'en_US-kristin-medium', rate: 1.2 }]]);
  });

  const failures = {
    'no Mimic bridge': () => ({}),
    'no voiceSynth in the bridge': () => ({ mimic: {} }),
    'the engine answers null': () => ({ mimic: { voiceSynth: () => Promise.resolve(null) } }),
    'the engine answers with empty audio': () => ({ mimic: { voiceSynth: () => Promise.resolve(new Uint8Array(0)) } }),
    'the call rejects': () => ({ mimic: { voiceSynth: () => Promise.reject(new Error('ipc')) } }),
    'the call throws': () => ({ mimic: { voiceSynth: () => { throw new Error('ipc'); } } }),
    'the browser cannot build the audio': () => ({ mimic: { voiceSynth: () => Promise.resolve(buf) }, Blob: class { constructor() { throw new Error('no'); } }, URL: {}, Audio: class {} }),
  };
  for (const [name, mk] of Object.entries(failures)) {
    it('→ null when ' + name + ' (so the caller speaks with the Windows voice)', async () => {
      const win = load({ ...audioFakes(), ...mk() });
      expect(await win.WPVoice.neuralAudio('hi', 1, CH)).toBeNull();
    });
  }
  it('→ null for the Windows engine without ever asking Mimic', async () => {
    let asked = 0; const win = load({ ...audioFakes(), mimic: { voiceSynth: () => { asked++; return Promise.resolve(buf); } } });
    expect(await win.WPVoice.neuralAudio('hi', 1, { engine: 'windows', voice: null })).toBeNull();
    expect(asked).toBe(0);
  });
  it('→ null when the engine never answers, and a late answer is ignored', async () => {
    vi.useFakeTimers();
    try {
      let release;
      const win = load({ ...audioFakes(), setTimeout, clearTimeout, mimic: { voiceSynth: () => new Promise(r => { release = r; }) } });
      const p = win.WPVoice.neuralAudio('hi', 1, CH);
      await vi.advanceTimersByTimeAsync(WPVoice.NEURAL_WAIT_MS + 10);
      expect(await p).toBeNull();
      release(buf);   // too late: nothing to assert except that it does not throw
      await vi.advanceTimersByTimeAsync(10);
    } finally { vi.useRealTimers(); }
  });
});

describe('speed and cache', () => {
  it('Piper length_scale is 1 / speed, clamped', () => {
    expect(nv.lengthScale(1)).toBe(1);
    expect(nv.lengthScale(1.05)).toBe(0.952);
    expect(nv.lengthScale(2)).toBe(0.5);
    expect(nv.lengthScale(0.5)).toBe(2);
    expect(nv.lengthScale(0.1)).toBe(2.5);
    expect(nv.lengthScale(50)).toBe(0.4);
    for (const bad of [0, -1, NaN, 'fast', null, undefined]) expect(nv.lengthScale(bad)).toBe(1);
  });

  it('the cache key is per (engine, voice, speed, words) and ignores spacing and speed wobble', () => {
    const k = nv.cacheKey('piper', 'a', 1.05, 'Enrage soon');
    expect(nv.cacheKey('piper', 'a', 1.0500001, '  Enrage   soon ')).toBe(k);
    expect(nv.cacheKey('piper', 'b', 1.05, 'Enrage soon')).not.toBe(k);
    expect(nv.cacheKey('piper', 'a', 1.2, 'Enrage soon')).not.toBe(k);
    expect(nv.cacheKey('piper', 'a', 1.05, 'Enrage soon!')).not.toBe(k);
    expect(nv.cacheKey('kokoro', 'a', 1.05, 'Enrage soon')).not.toBe(k);
  });

  it('the LRU drops the least recently used by count, and by bytes', () => {
    const c = nv.createLru(2, 1000);
    c.set('a', Buffer.alloc(10)); c.set('b', Buffer.alloc(10));
    expect(c.get('a')).toBeTruthy();         // a is now the newest
    c.set('c', Buffer.alloc(10));            // evicts b
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeTruthy(); expect(c.get('c')).toBeTruthy();
    const d = nv.createLru(10, 100);
    d.set('x', Buffer.alloc(60)); d.set('y', Buffer.alloc(60));   // 120 > 100: x goes
    expect(d.get('x')).toBeUndefined(); expect(d.get('y')).toBeTruthy(); expect(d.bytes).toBe(60);
    d.set('huge', Buffer.alloc(500));        // bigger than the whole cache: never stored
    expect(d.get('huge')).toBeUndefined();
    d.set('y', Buffer.alloc(20));            // replacing counts bytes once
    expect(d.bytes).toBe(20);
  });
});

describe('synthOrNull (the 2.5 s limit)', () => {
  it('resolves the audio when it arrives in time', async () => {
    expect((await nv.synthOrNull(async () => Buffer.from('RIFF'))).toString()).toBe('RIFF');
  });
  it('is null on a rejection, a sync throw, and an empty buffer — and never rejects', async () => {
    expect(await nv.synthOrNull(async () => { throw new Error('boom'); })).toBeNull();
    expect(await nv.synthOrNull(() => { throw new Error('boom'); })).toBeNull();
    expect(await nv.synthOrNull(async () => Buffer.alloc(0))).toBeNull();
    expect(await nv.synthOrNull(async () => null)).toBeNull();
  });
  it('is null at the limit and tells the work to stop', async () => {
    let aborted = false;
    const r = await nv.synthOrNull((signal) => new Promise((_, rej) => signal.addEventListener('abort', () => { aborted = true; rej(new Error('stop')); })), 40);
    expect(r).toBeNull(); expect(aborted).toBe(true);
  });
  it('the shipped limit is 2.5 s', () => expect(nv.SYNTH_TIMEOUT_MS).toBe(2500));
});

describe('download manifest', () => {
  const REV = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';
  const HF = `https://huggingface.co/rhasspy/piper-voices/resolve/${REV}/en/en_US/`;

  it('pins the official Piper Windows release: exact URL, size, sha256', () => {
    expect(nv.MANIFEST.piper.runtime).toMatchObject({
      url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
      size: 22477236,
      sha256: 'f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea',
    });
  });

  it('pins each voice to a Hugging Face COMMIT: exact URLs, sizes, sha256, licence', () => {
    expect(nv.PIPER_VOICES_REV).toBe(REV);
    const got = nv.MANIFEST.piper.voices.map(v => ({ id: v.id, licence: v.licence, files: v.files.map(f => [f.name, f.url, f.size, f.sha256]) }));
    expect(got).toEqual([
      { id: 'en_US-kristin-medium', licence: 'Public domain', files: [
        ['en_US-kristin-medium.onnx', HF + 'kristin/medium/en_US-kristin-medium.onnx', 63531379, '5849957f929cbf720c258f8458692d6103fff2f0e3d3b19c8259474bb06a18d4'],
        ['en_US-kristin-medium.onnx.json', HF + 'kristin/medium/en_US-kristin-medium.onnx.json', 4968, '5681426d4aead22195de70531eeeeddb46493cfaffc5764b2ea3db73428b651c'],
      ] },
      { id: 'en_US-john-medium', licence: 'Public domain', files: [
        ['en_US-john-medium.onnx', HF + 'john/medium/en_US-john-medium.onnx', 63531379, '789c6c875726e627ddee93d51d8727859abe9c091c3d141591f4b83c2072e988'],
        ['en_US-john-medium.onnx.json', HF + 'john/medium/en_US-john-medium.onnx.json', 4965, 'af60f177b6b550f3d7a302720c0fb89e7f94a82b5dca464775ef63b1c69ba09a'],
      ] },
    ]);
  });

  it('every file is https, immutable (a tag or a commit, never a branch), sized and checksummed; every voice credits its source', () => {
    const all = [nv.MANIFEST.piper.runtime, ...nv.MANIFEST.piper.voices.flatMap(v => v.files)];
    for (const f of all) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.url).not.toMatch(/\/(main|master)\//);
      expect(Number.isInteger(f.size) && f.size > 0).toBe(true);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const v of nv.MANIFEST.piper.voices) { expect(v.licence).toBeTruthy(); expect(v.credit).toBeTruthy(); }
  });

  it('does not offer a voice whose licence forbids redistribution (lessac research licence, ryan non-commercial)', () => {
    const ids = nv.MANIFEST.piper.voices.map(v => v.id).join(' ');
    expect(ids).not.toMatch(/lessac|ryan/);
  });

  it('Kokoro is an honest stub: listed, never ready, install refuses with the reason', async () => {
    const st = nv.status(fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')), 'win32');
    expect(st.kokoro).toMatchObject({ available: false, ready: false, voices: [] });
    expect(st.kokoro.reason).toBe(nv.KOKORO_REASON);
    await expect(nv.install(os.tmpdir(), 'kokoro', 'af_heart', 'win32')).rejects.toThrow(/not in this build/);
    expect(await nv.synthesize(os.tmpdir(), { engine: 'kokoro', voice: 'af_heart', rate: 1, text: 'hi' }, 'win32')).toBeNull();
  });
});

describe('download plan and guards', () => {
  it('fetches the runtime first, then the voice; skips what is already on disk', () => {
    const fresh = nv.downloadPlan('en_US-kristin-medium', {});
    expect(fresh.files.map(f => f.kind)).toEqual(['runtime', 'voice', 'voice']);
    expect(fresh.totalBytes).toBe(22477236 + 63531379 + 4968);
    const second = nv.downloadPlan('en_US-john-medium', { runtimeReady: true });
    expect(second.files.map(f => f.name)).toEqual(['en_US-john-medium.onnx', 'en_US-john-medium.onnx.json']);
    expect(nv.downloadPlan('en_US-john-medium', { runtimeReady: true, voiceReady: true }).files).toEqual([]);
    expect(() => nv.downloadPlan('../../etc/passwd', {})).toThrow(/Unknown voice/);
  });

  it('a download of the wrong size or the wrong bytes is refused in plain words', () => {
    const body = Buffer.from('hello');
    const sha = require_('node:crypto').createHash('sha256').update(body).digest('hex');
    expect(() => nv.verifyFile(body, { size: 5, sha256: sha })).not.toThrow();
    expect(() => nv.verifyFile(body, { size: 6, sha256: sha })).toThrow(/wrong size/);
    expect(() => nv.verifyFile(body, { size: 5, sha256: '0'.repeat(64) })).toThrow(/checksum/);
  });

  it('a zip entry can only land inside the folder', () => {
    const base = path.join(os.tmpdir(), 'base');
    expect(nv.safeZipTarget(base, 'piper/piper.exe')).toBe(path.join(base, 'piper', 'piper.exe'));
    expect(nv.safeZipTarget(base, 'piper\\espeak-ng-data\\en_dict')).toBe(path.join(base, 'piper', 'espeak-ng-data', 'en_dict'));
    for (const bad of ['../evil.dll', 'piper/../../evil.dll', '/etc/passwd', 'C:\\Windows\\evil.dll', 'C:/x', '', '..']) expect(nv.safeZipTarget(base, bad), bad).toBeNull();
  });

  it('install refuses off Windows, an unknown voice, and status says why', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-'));
    await expect(nv.install(root, 'piper', 'en_US-kristin-medium', 'linux')).rejects.toThrow(/Windows only/);
    await expect(nv.install(root, 'piper', 'nope', 'win32')).rejects.toThrow(/Unknown voice/);
    const st = nv.status(root, 'linux');
    expect(st.piper).toMatchObject({ available: false, ready: false, voices: [] });
    expect(st.piper.reason).toMatch(/Windows only/);
    const win = nv.status(root, 'win32');
    expect(win.piper).toMatchObject({ available: true, ready: false, runtimeInstalled: false });
    expect(win.piper.catalog.map(c => [c.id, c.installed, c.downloadBytes])).toEqual([
      ['en_US-kristin-medium', false, 22477236 + 63531379 + 4968], ['en_US-john-medium', false, 22477236 + 63531379 + 4965]]);
  });
});

// A stand-in for piper.exe: a shell script that honours --output_file, so the REAL spawn path, argument list,
// temp-file handling and cache are exercised. POSIX only (the shipped one is a Windows exe).
describe.skipIf(process.platform === 'win32')('synthesis through a real child process', () => {
  const made = [];
  afterEach(() => { for (const r of made.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

  // `script` is the body of the fake piper.exe, or a function of the call-log path returning it.
  function rig(script) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-'));
    made.push(root);
    const p = nv.piperPaths(root);
    fs.mkdirSync(p.espeak, { recursive: true });
    fs.writeFileSync(p.exe, '#!/bin/sh\n' + (typeof script === 'function' ? script(path.join(root, 'calls.log')) : script), { mode: 0o755 });
    fs.writeFileSync(path.join(p.runtime, '.ok'), 'x');
    const v = nv.MANIFEST.piper.voices[0], d = path.join(p.voices, v.id);
    fs.mkdirSync(d, { recursive: true });
    for (const f of v.files) fs.writeFileSync(path.join(d, f.name), 'x');
    fs.writeFileSync(path.join(d, '.ok'), 'x');
    return { root, log: path.join(root, 'calls.log'), p };
  }
  const OUTPUT_FILE = 'while [ $# -gt 0 ]; do case "$1" in --output_file) OUT="$2";; --length_scale) LS="$2";; esac; shift; done\n';
  const spec = (over = {}) => ({ engine: 'piper', voice: 'en_US-kristin-medium', rate: 1.25, text: 'Enrage soon', ...over });

  it('passes the model, the output file, the speed and the words; returns the WAV; a repeat is served from the cache', async () => {
    const r = rig((l) => OUTPUT_FILE + `echo "ls=$LS in=$(cat)" >> '${l}'\nprintf RIFFwav > "$OUT"\n`);
    const log = r.log;
    const a = await nv.synthesize(r.root, spec(), 'win32');
    expect(a.toString()).toBe('RIFFwav');
    expect(fs.readFileSync(log, 'utf8')).toBe('ls=0.8 in=Enrage soon\n');   // 1 / 1.25
    const b = await nv.synthesize(r.root, spec(), 'win32');
    expect(b.toString()).toBe('RIFFwav');
    expect(fs.readFileSync(log, 'utf8').split('\n').filter(Boolean)).toHaveLength(1);   // cached: no second process
    expect(fs.readdirSync(r.p.tmp)).toEqual([]);                                          // temp file removed
  });

  it('is null when the process fails', async () => {
    const r = rig('exit 3\n');
    expect(await nv.synthesize(r.root, spec({ text: 'fails' }), 'win32')).toBeNull();
  });

  it('is null when the process writes nothing', async () => {
    const r = rig('exit 0\n');
    expect(await nv.synthesize(r.root, spec({ text: 'writes nothing' }), 'win32')).toBeNull();
  });

  it('is null when the process hangs, at the limit, and the process is stopped', async () => {
    const r = rig('exec sleep 30\n');
    const t = Date.now();
    expect(await nv.synthesize(r.root, spec({ text: 'hangs' }), 'win32')).toBeNull();
    expect(Date.now() - t).toBeLessThan(nv.SYNTH_TIMEOUT_MS + 1500);
  }, 8000);

  it('is null when nothing is installed or the voice id is not in the manifest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')); made.push(root);
    expect(await nv.synthesize(root, spec(), 'win32')).toBeNull();
    const r = rig('printf RIFF > "$OUT"\n');
    expect(await nv.synthesize(r.root, spec({ voice: '../../x' }), 'win32')).toBeNull();
    expect(await nv.synthesize(r.root, spec({ text: '   ' }), 'win32')).toBeNull();
  });
});

describe('every failure ends in the Windows voice (source, comments stripped)', () => {
  const trig = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html')));
  const dash = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));
  const voiceJs = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'voice.js')));
  const mainJs = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
  const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));

  it('the trigger window: no audio, an audio error and a refused play() each fall back to speechSynthesis', () => {
    const neural = sliceBlock(trig, 'function _speakNeural(item, choice){', 'function _fallbackToWindows(item){');
    expect((neural.match(/_fallbackToWindows\(item\)/g) || []).length).toBeGreaterThanOrEqual(4);   // !a, 'error', play() rejected, call rejected
    expect(neural).toMatch(/if \(!a\)\{ _fallbackToWindows\(item\); return; \}/);
    expect(neural).toMatch(/addEventListener\('error'[\s\S]*_fallbackToWindows\(item\)/);
    const fb = sliceBlock(trig, 'function _fallbackToWindows(item){', '_speakWindows(item);\n  }');
    expect(fb).toMatch(/_speakingUtt = null/);   // it frees the queue slot first, so the Windows path can take it
    const windows = sliceBlock(trig, 'function _speakWindows(item){', 'window.speechSynthesis.speak(u);');
    expect(windows).toMatch(/new SpeechSynthesisUtterance\(item\.text\)/);
  });

  it('the dispatcher uses a downloaded voice only when the chooser says so, else the Windows path', () => {
    const now = sliceBlock(trig, 'function _speakNow(item){', '_speakWindows(item);\n  }');
    expect(now).toMatch(/var choice = _neuralChoice\(\);\s*if \(choice\)\{ _speakNeural\(item, choice\); return; \}\s*_speakWindows\(item\);/);
    const choose = sliceBlock(trig, 'function _neuralChoice(){', 'catch (e) { return null; }');
    expect(choose).toMatch(/chooseEngine\(_voiceCfg, _voiceStatus\)/);
    expect(choose).toMatch(/c\.engine === 'windows' \? null : c/);
  });

  it('a downloaded voice keeps the queue honest: preempt stops its audio, the watchdog drains a stuck one', () => {
    expect(trig).toMatch(/function _stopSpeech\(\)\{[\s\S]*speechSynthesis\.cancel\(\)[\s\S]*_speakingAudio\.pause\(\)/);
    expect(sliceBlock(trig, 'if (item.prio > _speakingPrio){', '_speakNow(item);')).toMatch(/_stopSpeech\(\)/);
    const neural = sliceBlock(trig, 'function _speakNeural(item, choice){', 'function _fallbackToWindows(item){');
    expect(neural).toMatch(/_speakWatchdog = setTimeout/);
    expect(neural).toMatch(/_speakingUtt !== tok\) return/);   // a preempted line never plays late
  });

  it('the words reach every engine as the agent rewrote them: neuralAudio forwards the string untouched', () => {
    const neural = sliceBlock(trig, 'function _speakNeural(item, choice){', 'function _fallbackToWindows(item){');
    expect(neural).toMatch(/neuralAudio\(item\.text, rate, choice\)/);
    expect(trig).not.toMatch(/_applySpokenPronunciations|pronunciation/i);       // the rewrite is the agent's, once, before speech
    const agent = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js')));
    const push = sliceBlock(agent, 'function _pushOverlay(o) {', '_activeOverlays.unshift(o);');
    expect(push).toMatch(/_applySpokenPronunciations\(o\.tts \|\| o\.text \|\| ''\)/);
  });

  it('the sample button and the dashboard fall back to the Windows voice too', () => {
    const sample = sliceBlock(voiceJs, 'function sample(text, packs, cfg, packId) {', 'return _sampleWindows(text, packs, cfg, packId);\n  }');
    expect((sample.match(/_sampleWindows\(text, packs, cfg, packId\)/g) || []).length).toBeGreaterThanOrEqual(5);
    const speak = sliceBlock(dash, 'function speak(text, packId){', 'speakWin(text, packId);\n  }');
    expect(speak).toMatch(/playNeural\(ch, text, packId\)\.then\(function\(ok\)\{ if \(!ok\) speakWin\(text, packId\); \}\)/);
    expect(dash).toMatch(/else \{ setNote\('That voice did not answer in time, so the Windows voice spoke instead[^']*'\); speakWin\(line, null\); \}/);
  });

  it('main answers voice:synth with the engine and nothing else; preload exposes the four calls', () => {
    expect(mainJs).toMatch(/ipcMain\.handle\('voice:synth'[\s\S]*neuralVoice\.synthesize\(VOICES_DIR\(\)/);
    expect(mainJs).toMatch(/VOICES_DIR\s*=\s*\(\) => path\.join\(app\.getPath\('userData'\), 'voices'\)/);
    for (const c of ['voice:status', 'voice:install', 'voice:remove', 'voice:synth']) {
      expect(mainJs).toContain(`ipcMain.handle('${c}'`);
      expect(preload).toContain(`ipcRenderer.invoke('${c}'`);
    }
  });

  it('the voices come down through the shared downloader and never sit in the installer', () => {
    const nvSrc = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'neuralVoice.js')));
    expect(nvSrc).toMatch(/require\('\.\/ghDownload'\)/);
    const pkg = JSON.parse(readSource(path.join(ROOT, 'apps', 'mimic', 'package.json')));
    expect(Object.keys(pkg.dependencies)).toEqual(['electron-updater']);   // no onnxruntime, no kokoro-js
    expect(JSON.stringify(pkg.build)).not.toMatch(/piper|kokoro|onnx/i);
  });
});
