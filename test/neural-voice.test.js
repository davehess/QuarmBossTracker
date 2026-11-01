// test/neural-voice.test.js — free, open-source callout voices beside the Windows voice (the guild lead,
// 2026-10-17: "Piper is the default download, Kokoro the upgrade; the Windows voice stays the fallback").
//
//   · the engine chooser (voice.js, mirrored in the dashboard) and its fallback to the Windows voice
//   · the WAV cache key + LRU, the speed mapping, the time limit that turns a slow synth into null
//   · the download manifest: exact pinned URLs, byte sizes and sha256, plus each voice's licence line
//   · the plan / checksum / zip-path guards that stop a bad download becoming a live install
//   · a real child process: a fake piper.exe / sherpa-onnx CLI that succeeds, fails, or hangs (POSIX only)
//   · Kokoro: the pinned sherpa-onnx + model archives, the pure-JS .tar.bz2 unpack and its path guard, the CLI argument
//     list, the longer limit for a ▶ Test, the background warm-up
//   · the three Piper tiers (free / non-commercial / research only): nothing downloads without the ticked boxes,
//     the acceptance record sits next to the voice and goes with it
//   · source checks (comments stripped) that every failure in the trigger window, the dashboard and the sample
//     button ends in the Windows voice — a callout is never silenced by a download that broke
//
// Run: npx vitest run test/neural-voice.test.js

import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const nv = require_('../apps/mimic/neuralVoice.js');
const WPVoice = require_('../apps/mimic/voice.js');

const HFV = 'https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/';
// The six voices offered before the catalogue was generated (2026-10-28): their ids, tiers and files must not move.
const LEGACY = ['en_US-kristin-medium', 'en_US-john-medium', 'en_US-ryan-high', 'en_US-lessac-medium', 'en_US-joe-medium', 'en_US-ryan-medium'];
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
    ['Kokoro picked but not installed → Windows', { engine: 'kokoro' }, READY, win],
    ['an unknown engine name → Windows', { engine: 'espeak' }, READY, win],
    ['a status without voices → Windows', { engine: 'piper' }, { piper: { ready: true, voices: [] } }, win],
  ];
  for (const [name, cfg, st, want] of table) {
    it(name, () => expect(WPVoice.chooseEngine(cfg, st)).toEqual(want));
  }

  // Piper is the default and Kokoro the upgrade you pick (the guild lead, 2026-10-17): auto keeps Piper when both are in.
  it('auto prefers Piper when both are installed; Kokoro alone is used under auto', () => {
    const both = { piper: READY.piper, kokoro: { ready: true, voices: ['af_heart'] } };
    expect(WPVoice.chooseEngine({ engine: 'auto' }, both)).toEqual({ engine: 'piper', voice: 'en_US-kristin-medium' });
    expect(WPVoice.chooseEngine({ engine: 'auto' }, { kokoro: { ready: true, voices: ['af_heart'] } })).toEqual({ engine: 'kokoro', voice: 'af_heart' });
  });

  it('an explicit Kokoro pick takes its installed voice, or the first one; not installed → Windows', () => {
    const k = { piper: READY.piper, kokoro: { ready: true, voices: ['af_bella', 'af_sarah', 'am_adam', 'am_michael'] } };
    expect(WPVoice.chooseEngine({ engine: 'kokoro', kokoroVoice: 'am_adam' }, k)).toEqual({ engine: 'kokoro', voice: 'am_adam' });
    expect(WPVoice.chooseEngine({ engine: 'kokoro', kokoroVoice: 'af_heart' }, k)).toEqual({ engine: 'kokoro', voice: 'af_bella' });
    expect(WPVoice.chooseEngine({ engine: 'kokoro' }, READY)).toEqual({ engine: 'windows', voice: null });
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
  it('a ▶ Test asks for the longer limit and waits longer than a callout does (Kokoro is slow)', async () => {
    const f = audioFakes(); const calls = [];
    const win = load({ ...f, mimic: { voiceSynth: (t, s) => { calls.push(s); return Promise.resolve(buf); } } });
    await win.WPVoice.neuralAudio('hi', 1, CH, undefined, true);
    await win.WPVoice.neuralAudio('hi', 1, CH);
    expect(calls).toEqual([{ engine: 'piper', voice: 'en_US-kristin-medium', rate: 1, test: true }, { engine: 'piper', voice: 'en_US-kristin-medium', rate: 1 }]);
    expect(WPVoice.NEURAL_TEST_WAIT_MS).toBeGreaterThan(nv.TEST_TIMEOUT_MS);
    vi.useFakeTimers();
    try {
      const w2 = load({ ...audioFakes(), setTimeout, clearTimeout, mimic: { voiceSynth: () => new Promise(() => {}) } });
      let settled = false;
      const p = w2.WPVoice.neuralAudio('hi', 1, CH, undefined, true); p.then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(WPVoice.NEURAL_WAIT_MS + 10);
      expect(settled).toBe(false);                                   // a callout would have given up by now
      await vi.advanceTimersByTimeAsync(WPVoice.NEURAL_TEST_WAIT_MS);
      expect(await p).toBeNull();
    } finally { vi.useRealTimers(); }
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
  it('the shipped limit is 2.5 s for a callout and 12 s for a ▶ Test', () => {
    expect(nv.SYNTH_TIMEOUT_MS).toBe(2500);
    expect(nv.TEST_TIMEOUT_MS).toBe(12000);
  });
});

describe('download manifest', () => {
  const REV = '5041a7a49ae5b3a0f30e6837769eb03fdbb231bd';
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
    const got = nv.MANIFEST.piper.voices.filter(v => v.tier === 'free' && LEGACY.includes(v.id)).map(v => ({ id: v.id, licence: v.licence, files: v.files.map(f => [f.name, f.url, f.size, f.sha256]) }));
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
    const all = [nv.MANIFEST.piper.runtime, ...nv.MANIFEST.piper.voices.flatMap(v => v.files), nv.MANIFEST.kokoro.runtime, nv.MANIFEST.kokoro.model];
    for (const f of all) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.url).not.toMatch(/\/(main|master)\//);
      expect(Number.isInteger(f.size) && f.size > 0).toBe(true);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const v of nv.MANIFEST.piper.voices) { expect(v.licence).toBeTruthy(); expect(v.credit).toBeTruthy(); expect(v.modelCardUrl).toMatch(/\/blob\/[0-9a-f]{40}\/.+\/MODEL_CARD$/); }
  });

  it('the pinned Piper tiers: free (public domain), non-commercial (ryan-high), research only (lessac and its fine-tunes)', () => {
    const tiers = {};
    for (const v of nv.MANIFEST.piper.voices.filter(x => LEGACY.includes(x.id))) (tiers[v.tier] = tiers[v.tier] || []).push(v.id);
    expect(tiers).toEqual({
      free: ['en_US-kristin-medium', 'en_US-john-medium'],
      nc: ['en_US-ryan-high'],
      research: ['en_US-lessac-medium', 'en_US-joe-medium', 'en_US-ryan-medium'],
    });
    // the legacy six come first, in their old order, so "the first installed voice" (what auto picks) is still Kristin
    expect(nv.MANIFEST.piper.voices.slice(0, 6).map(v => v.id)).toEqual(LEGACY);
    expect(nv.MANIFEST.piper.voices.slice(0, 6).map(v => v.tier)).toEqual(['free', 'free', 'nc', 'research', 'research', 'research']);
    for (const v of nv.MANIFEST.piper.voices.filter(x => x.tier === 'free')) expect(v.id).not.toMatch(/lessac|ryan|joe/);
    expect(nv.MANIFEST.piper.voices.find(v => v.id === 'en_US-ryan-high').licence).toBe('CC BY-NC-SA 4.0');
    // ryan-MEDIUM and joe are fine-tuned from lessac, so they carry its research-only terms, not just their own data's
    for (const id of ['en_US-ryan-medium', 'en_US-joe-medium']) expect(nv.MANIFEST.piper.voices.find(v => v.id === id).licence).toMatch(/Lessac/);
  });

  it('pins each gated voice to the same Hugging Face commit: exact URLs, sizes, sha256, and its model card', () => {
    const got = nv.MANIFEST.piper.voices.filter(v => v.tier !== 'free' && LEGACY.includes(v.id)).map(v => [v.id, v.modelCardUrl, v.files.map(f => [f.name, f.url, f.size, f.sha256])]);
    const card = (d) => `https://huggingface.co/rhasspy/piper-voices/blob/${REV}/en/en_US/${d}/MODEL_CARD`;
    expect(got).toEqual([
      ['en_US-ryan-high', card('ryan/high'), [
        ['en_US-ryan-high.onnx', HF + 'ryan/high/en_US-ryan-high.onnx', 120786792, 'b3990d7606e183ec8dbfba70a4607074f162de1a0c412e0180d1ff60bb154eca'],
        ['en_US-ryan-high.onnx.json', HF + 'ryan/high/en_US-ryan-high.onnx.json', 4166, 'c6d3b98f08315cb4bebf0d49d50fc4ff491b503c64b940cd3d5ca28543b48011']]],
      ['en_US-lessac-medium', card('lessac/medium'), [
        ['en_US-lessac-medium.onnx', HF + 'lessac/medium/en_US-lessac-medium.onnx', 63201294, '5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f'],
        ['en_US-lessac-medium.onnx.json', HF + 'lessac/medium/en_US-lessac-medium.onnx.json', 4885, 'efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0']]],
      ['en_US-joe-medium', card('joe/medium'), [
        ['en_US-joe-medium.onnx', HF + 'joe/medium/en_US-joe-medium.onnx', 63201294, '58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06'],
        ['en_US-joe-medium.onnx.json', HF + 'joe/medium/en_US-joe-medium.onnx.json', 4794, '3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33']]],
      ['en_US-ryan-medium', card('ryan/medium'), [
        ['en_US-ryan-medium.onnx', HF + 'ryan/medium/en_US-ryan-medium.onnx', 63201294, 'abf4c274862564ed647ba0d2c47f8ee7c9b717d27bdad9219100eb310db4047a'],
        ['en_US-ryan-medium.onnx.json', HF + 'ryan/medium/en_US-ryan-medium.onnx.json', 4883, '44034c056cb15681b2ad494307c7f3f2e4499d1253c700c711fa0a4607ffe78d']]],
    ]);
    for (const v of nv.MANIFEST.piper.voices.filter(x => x.tier !== 'free')) expect(v.credit).toBeTruthy();
  });

  it('pins Kokoro: the sherpa-onnx Windows tools and the int8 English model, exact URLs, sizes, sha256, licences', () => {
    const K = nv.MANIFEST.kokoro;
    expect(K.runtime).toMatchObject({
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.0/sherpa-onnx-v1.13.0-win-x64-shared-MD-Release.tar.bz2',
      size: 19059518,
      sha256: '2d7342d3ed1a19ccb08631f3d82d4d494d699e2730053999b7aa9eb7dd76b740',
      licence: 'Apache-2.0 (sherpa-onnx)',
      top: 'sherpa-onnx-v1.13.0-win-x64-shared-MD-Release',
    });
    expect(K.runtime.keep).toEqual(['bin/sherpa-onnx-offline-tts.exe', 'bin/onnxruntime.dll', 'bin/onnxruntime_providers_shared.dll']);
    expect(K.model).toMatchObject({
      url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-en-v0_19.tar.bz2',
      size: 103248205,
      sha256: 'c9f0dd393615805b0bab050c340834d5e684e732aec91c0e860cd30e982c08bd',
      licence: 'Apache-2.0 (Kokoro-82M)',
      top: 'kokoro-int8-en-v0_19',
    });
    expect(K.model.required).toEqual(['model.int8.onnx', 'voices.bin', 'tokens.txt', 'espeak-ng-data']);
    expect(K.licence).toBe('Apache-2.0');
    expect(K.credit).toMatch(/hexgrad/);
    expect(K.voices.map(v => [v.id, v.sid])).toEqual([['af_bella', 1], ['af_sarah', 3], ['am_adam', 5], ['am_michael', 6]]);
  });

  it('Kokoro status: not ready until BOTH archives are placed (pinned checksum in the marker); size and voices once it is', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-'));
    try {
      const K = nv.MANIFEST.kokoro, kp = nv.kokoroPaths(root);
      let st = nv.status(root, 'win32').kokoro;
      expect(st).toMatchObject({ available: true, ready: false, voices: [], downloadBytes: K.runtime.size + K.model.size, problem: '' });
      expect(st.catalog.map(v => v.id)).toEqual(['af_bella', 'af_sarah', 'am_adam', 'am_michael']);
      fs.mkdirSync(path.dirname(kp.exe), { recursive: true }); fs.writeFileSync(kp.exe, 'x');
      fs.writeFileSync(path.join(kp.runtime, '.ok'), K.runtime.sha256);
      expect(nv.status(root, 'win32').kokoro).toMatchObject({ ready: false, downloadBytes: K.model.size });
      fs.mkdirSync(kp.dataDir, { recursive: true });
      for (const f of ['model.int8.onnx', 'voices.bin', 'tokens.txt']) fs.writeFileSync(path.join(kp.model, f), 'x');
      fs.writeFileSync(path.join(kp.model, '.ok'), 'an-older-pin');
      expect(nv.status(root, 'win32').kokoro.ready).toBe(false);          // re-pinned manifest → old download reads as not installed
      fs.writeFileSync(path.join(kp.model, '.ok'), K.model.sha256);
      st = nv.status(root, 'win32').kokoro;
      expect(st).toMatchObject({ ready: true, downloadBytes: 0, voices: ['af_bella', 'af_sarah', 'am_adam', 'am_michael'], licence: 'Apache-2.0' });
      expect(nv.status(root, 'linux').kokoro).toMatchObject({ available: false, ready: false, voices: [] });
      expect(nv.status(root, 'linux').kokoro.reason).toMatch(/Windows only/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
    expect(win.piper.catalog.filter(c => LEGACY.includes(c.id)).map(c => [c.id, c.tier, c.installed, c.downloadBytes])).toEqual([
      ['en_US-kristin-medium', 'free', false, 22477236 + 63531379 + 4968], ['en_US-john-medium', 'free', false, 22477236 + 63531379 + 4965],
      ['en_US-ryan-high', 'nc', false, 22477236 + 120786792 + 4166],
      ['en_US-lessac-medium', 'research', false, 22477236 + 63201294 + 4885], ['en_US-joe-medium', 'research', false, 22477236 + 63201294 + 4794],
      ['en_US-ryan-medium', 'research', false, 22477236 + 63201294 + 4883]]);
    expect(win.piper.catalog.find(c => c.id === 'en_US-ryan-high').modelCardUrl).toMatch(/\/blob\/5041a7a[0-9a-f]+\/en\/en_US\/ryan\/high\/MODEL_CARD$/);
  });

  it('Kokoro installs on Windows only', async () => {
    await expect(nv.install(os.tmpdir(), 'kokoro', '', 'linux')).rejects.toThrow(/Windows only/);
  });
});

describe('the non-commercial and research-only tiers (accept first, record next to the download)', () => {
  const RUNTIME_OK = (root) => {   // a Piper runtime already in place, so only the voice would be fetched
    const p = nv.piperPaths(root);
    fs.mkdirSync(path.dirname(p.exe), { recursive: true }); fs.writeFileSync(p.exe, 'x'); fs.writeFileSync(path.join(p.runtime, '.ok'), 'x');
    return p;
  };
  const dirs = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')); dirs.push(d); return d; };
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it('the ticked boxes each tier needs: none for free; the terms for non-commercial; the terms AND research box for research', () => {
    const by = (id) => nv.findVoice('piper', id);
    for (const a of [undefined, null, {}, { terms: false }]) expect(nv.acceptanceProblem(by('en_US-kristin-medium'), a)).toBeNull();
    for (const a of [undefined, null, {}, { terms: 'yes' }, { terms: false }, { research: true }]) expect(nv.acceptanceProblem(by('en_US-ryan-high'), a), JSON.stringify(a)).toMatch(/Accept the terms/);
    expect(nv.acceptanceProblem(by('en_US-ryan-high'), { terms: true })).toBeNull();
    for (const id of ['en_US-lessac-medium', 'en_US-joe-medium', 'en_US-ryan-medium']) {
      expect(nv.acceptanceProblem(by(id), { terms: true })).toMatch(/research-only box/);
      expect(nv.acceptanceProblem(by(id), { terms: true, research: 'true' })).toMatch(/research-only box/);
      expect(nv.acceptanceProblem(by(id), { research: true })).toMatch(/Accept the terms/);
      expect(nv.acceptanceProblem(by(id), { terms: true, research: true })).toBeNull();
    }
  });

  it('install refuses a gated voice without the acceptance, before a single byte is requested', async () => {
    const root = tmp(); const asked = [];
    const get = async (u) => { asked.push(u); return Buffer.alloc(1); };
    await expect(nv.install(root, 'piper', 'en_US-ryan-high', 'win32', { deps: { get } })).rejects.toThrow(/Accept the terms/);
    await expect(nv.install(root, 'piper', 'en_US-lessac-medium', 'win32', { accept: { terms: true }, deps: { get } })).rejects.toThrow(/research-only box/);
    expect(asked).toEqual([]);
    expect(fs.existsSync(nv.piperPaths(root).base)).toBe(false);
  });

  it('with the boxes ticked the download starts, and is checked like any other (a wrong file is thrown away)', async () => {
    const root = tmp(); RUNTIME_OK(root); const asked = [];
    const get = async (u) => { asked.push(u); return Buffer.alloc(3); };
    await expect(nv.install(root, 'piper', 'en_US-lessac-medium', 'win32', { accept: { terms: true, research: true }, deps: { get } })).rejects.toThrow(/wrong size/);
    expect(asked).toEqual([HFV + 'lessac/medium/en_US-lessac-medium.onnx']);
    expect(fs.existsSync(path.join(nv.piperPaths(root).voices, 'en_US-lessac-medium'))).toBe(false);
  });

  it('the acceptance record is written next to the voice (voice, licence, tier, time), counts as installed, and Remove deletes both', () => {
    const root = tmp(); const p = RUNTIME_OK(root);
    const v = nv.findVoice('piper', 'en_US-ryan-high'), k = nv.findVoice('piper', 'en_US-kristin-medium');
    const accept = { terms: true };
    nv.installVoiceFiles(p, v, [Buffer.from('a'), Buffer.from('b')], nv.acceptanceRecord(v, accept, new Date('2026-10-17T12:00:00Z')));
    nv.installVoiceFiles(p, k, [Buffer.from('a'), Buffer.from('b')], null);
    const file = path.join(p.voices, v.id, 'accepted.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ voice: 'en_US-ryan-high', licence: 'CC BY-NC-SA 4.0', tier: 'nc', terms: true, acceptedAt: '2026-10-17T12:00:00.000Z' });
    expect(fs.existsSync(path.join(p.voices, k.id, 'accepted.json'))).toBe(false);          // free voices keep no record
    let st = nv.status(root, 'win32').piper;
    expect(st.voices).toEqual(['en_US-kristin-medium', 'en_US-ryan-high']);
    // a gated voice whose record is gone (or says another voice / tier) is NOT installed, whatever files are there
    fs.writeFileSync(file, JSON.stringify({ voice: 'en_US-ryan-high', tier: 'research', terms: true }));
    expect(nv.status(root, 'win32').piper.voices).toEqual(['en_US-kristin-medium']);
    fs.unlinkSync(file);
    expect(nv.status(root, 'win32').piper.voices).toEqual(['en_US-kristin-medium']);
    nv.installVoiceFiles(p, v, [Buffer.from('a'), Buffer.from('b')], nv.acceptanceRecord(v, accept));
    expect(nv.status(root, 'win32').piper.voices).toContain('en_US-ryan-high');
    // Remove takes the voice AND its record, and nothing else
    st = nv.remove(root, 'piper', 'win32', 'en_US-ryan-high').piper;
    expect(fs.existsSync(path.join(p.voices, v.id))).toBe(false);
    expect(st.voices).toEqual(['en_US-kristin-medium']);
  });

  it('a research voice\'s record keeps both ticks, and holds exactly these fields (nothing about the person)', () => {
    const v = nv.findVoice('piper', 'en_US-joe-medium');
    expect(nv.acceptanceRecord(v, { terms: true, research: true })).toMatchObject({ tier: 'research', terms: true, research: true });
    expect(Object.keys(nv.acceptanceRecord(v, { terms: true, research: true })).sort()).toEqual(['acceptedAt', 'licence', 'modelCardUrl', 'research', 'terms', 'tier', 'voice']);
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

describe('Kokoro: the command line, the unpack command, the start-up problems', () => {
  it('the CLI arguments: model, voices, tokens, espeak data, speed = 1 / rate, speaker, threads, output, then the words', () => {
    const p = nv.kokoroPaths('/r');
    const J = (...a) => path.join('/r', 'kokoro', ...a);
    expect(nv.kokoroArgs(p, 1, 1.25, '  Enrage   soon ', '/r/tmp/o.wav', 2)).toEqual([
      '--kokoro-model=' + J('model', 'model.int8.onnx'), '--kokoro-voices=' + J('model', 'voices.bin'),
      '--kokoro-tokens=' + J('model', 'tokens.txt'), '--kokoro-data-dir=' + J('model', 'espeak-ng-data'),
      '--kokoro-length-scale=0.8', '--sid=1', '--num-threads=2', '--output-filename=/r/tmp/o.wav', 'Enrage soon',
    ]);
    expect(nv.kokoroArgs(p, 5, 0.5, 'x', 'o', 4)).toContain('--kokoro-length-scale=2');       // slower speech = larger scale
    expect(nv.kokoroArgs(p, 5, 'fast', 'x', 'o', 4)).toContain('--kokoro-length-scale=1');
    expect(nv.kokoroPaths('/r').exe).toBe(J('runtime', 'bin', 'sherpa-onnx-offline-tts.exe'));
  });

  it('words that start like a flag cannot become one (the parser would read them as an option)', () => {
    const p = nv.kokoroPaths('/r');
    for (const [said, sent] of [['--help me', 'help me'], ['-sid=9 go', 'sid=9 go'], ['== x', 'x'], ['Heal -up', 'Heal -up']]) {
      const a = nv.kokoroArgs(p, 1, 1, said, 'o', 1);
      expect(a[a.length - 1]).toBe(sent);
    }
  });

  it('a program that will not start becomes a plain sentence: a missing Visual C++ runtime is named, any other code is said', () => {
    for (const code of [3221225781, -1073741515]) expect(nv.kokoroStartProblem(code)).toBe(nv.NO_VCRT);
    expect(nv.NO_VCRT).toMatch(/Visual C\+\+/);
    expect(nv.kokoroStartProblem(3)).toMatch(/exit code 3.*Windows voice/);
  });
});

// The archives are built with the real bzip2 (and, for the format cases, the real tar) on POSIX, with hand-built
// ones where the hostile entries (../, absolute, symlink) must be exact. Unpacking itself is pure JS: Windows' tar.exe
// has no bzip2 on some PCs (field report), so nothing here — or in Mimic — runs a tar program to unpack.
describe.skipIf(process.platform === 'win32')('Kokoro: unpack and install without any tar program', () => {
  const dirs = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')); dirs.push(d); return d; };
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  function entry(name, body = '', type = '0', link = '') {
    const b = Buffer.from(body), h = Buffer.alloc(512);
    h.write(name, 0, 100); h.write('0000755\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(b.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h.write('        ', 148);
    h.write(type, 156); h.write(link, 157, 100); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const x of h) sum += x;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return Buffer.concat([h, b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  }
  function bz2(dir, name, entries) {
    const f = path.join(dir, name), raw = path.join(dir, 'raw-' + path.basename(name, '.bz2'));
    fs.writeFileSync(raw, Buffer.concat([...entries, Buffer.alloc(1024)]));
    execFileSync('bzip2', ['-f', raw]);          // → raw-….tar.bz2 → the name the test asked for
    fs.renameSync(raw + '.bz2', f);
    return f;
  }
  const SHERPA_SH = '#!/bin/sh\nfor a in "$@"; do case "$a" in --output-filename=*) OUT="${a#*=}";; --sid=*) SID="${a#*=}";; --kokoro-length-scale=*) LS="${a#*=}";; --*) ;; *) TEXT="$a";; esac; done\n';

  it('unpacks a good archive into the target', async () => {
    const d = tmp(), dest = path.join(d, 'out');
    const f = bz2(d, 'ok.tar.bz2', [entry('pkg/', '', '5'), entry('pkg/bin/', '', '5'), entry('pkg/bin/a.txt', 'hello'), entry('pkg/b.txt', 'bee')]);
    await nv.extractTarBz2(f, dest);
    expect(fs.readFileSync(path.join(dest, 'pkg', 'bin', 'a.txt'), 'utf8')).toBe('hello');
    expect(fs.readFileSync(path.join(dest, 'pkg', 'b.txt'), 'utf8')).toBe('bee');
  });

  it('refuses a ../ entry, an absolute entry, a drive-letter entry, a symlink, a hard link and a device, and leaves nothing behind', async () => {
    const d = tmp(); const sub = path.join(d, 'sub'); fs.mkdirSync(sub);
    const cases = {
      'a ../ entry': { archive: [entry('pkg/ok.txt', 'x'), entry('../evil.txt', 'bad')], re: /unsafe file path/ },
      'a nested ../ entry': { archive: [entry('pkg/../../evil.txt', 'bad')], re: /unsafe file path/ },
      'an absolute entry': { archive: [entry('/tmp/nv-abs-evil.txt', 'bad')], re: /unsafe file path/ },
      'a drive-letter entry': { archive: [entry('C:/evil.txt', 'bad')], re: /unsafe file path/ },
      'a symlink': { archive: [entry('pkg/', '', '5'), entry('pkg/link', '', '2', '/etc/passwd')], re: /plain files/ },
      'a hard link': { archive: [entry('pkg/ok.txt', 'x'), entry('pkg/hl', '', '1', 'pkg/ok.txt')], re: /plain files/ },
      'a device': { archive: [entry('pkg/dev', '', '3')], re: /plain files/ },
      'nothing at all': { archive: [], re: /was empty/ },
    };
    for (const [name, c] of Object.entries(cases)) {
      const dest = path.join(sub, 'out');
      const f = bz2(d, 'bad.tar.bz2', c.archive);
      await expect(nv.extractTarBz2(f, dest), name).rejects.toThrow(c.re);
      expect(fs.existsSync(dest), name + ' left a folder').toBe(false);
      expect(fs.existsSync(path.join(d, 'evil.txt')), name).toBe(false);
      expect(fs.existsSync('/tmp/nv-abs-evil.txt'), name).toBe(false);
    }
  });

  it('a hostile entry LATE in the archive stops it before any earlier file is written (list first, then write)', async () => {
    const d = tmp(), dest = path.join(d, 'out');
    const f = bz2(d, 'late.tar.bz2', [entry('pkg/first.txt', 'one'), entry('pkg/second.txt', 'two'), entry('../evil.txt', 'bad')]);
    const real = fs.writeFileSync; let writes = 0;
    fs.writeFileSync = (...a) => { writes++; return real(...a); };
    try { await expect(nv.extractTarBz2(f, dest)).rejects.toThrow(/unsafe file path/); } finally { fs.writeFileSync = real; }
    expect(writes).toBe(0);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('a file that is not a bzip2 archive is refused in plain words', async () => {
    const d = tmp(), f = path.join(d, 'junk.tar.bz2'); fs.writeFileSync(f, 'this is not an archive');
    await expect(nv.extractTarBz2(f, path.join(d, 'out'))).rejects.toThrow(/could not unpack the Kokoro download.*Windows voice keeps working/);
    expect(fs.existsSync(path.join(d, 'out'))).toBe(false);
  });

  it('a cut-off archive and a damaged archive are refused, with nothing left behind', async () => {
    const d = tmp(), dest = path.join(d, 'out');
    const f = bz2(d, 'ok.tar.bz2', [entry('pkg/a.txt', 'x'.repeat(5000)), entry('pkg/b.txt', 'y'.repeat(5000))]);
    const whole = fs.readFileSync(f);
    for (const [name, bytes, re] of [
      ['cut off', whole.subarray(0, whole.length - 12), /cut short|could not unpack/],
      ['cut off early', whole.subarray(0, 30), /cut short|could not unpack/],
      ['a flipped byte', Buffer.concat([whole.subarray(0, 40), Buffer.from([whole[40] ^ 0xff]), whole.subarray(41)]), /could not unpack/],
    ]) {
      fs.writeFileSync(f, bytes);
      await expect(nv.extractTarBz2(f, dest), name).rejects.toThrow(re);
      expect(fs.existsSync(dest), name).toBe(false);
    }
  });

  it('a tar that is not a tar (a valid bzip2 of other bytes) and a bad header checksum are refused', async () => {
    const d = tmp(), dest = path.join(d, 'out'), raw = path.join(d, 'text.txt');
    fs.writeFileSync(raw, 'just some text\n'.repeat(100)); execFileSync('bzip2', ['-f', raw]);
    await expect(nv.extractTarBz2(raw + '.bz2', dest)).rejects.toThrow(/damaged/);
    const e = entry('pkg/a.txt', 'x'); e[0] ^= 1;                                  // header no longer matches its checksum
    await expect(nv.extractTarBz2(bz2(d, 'sum.tar.bz2', [e]), dest)).rejects.toThrow(/damaged/);
    expect(fs.existsSync(dest)).toBe(false);
  });

  it('reads what real tar writes: GNU, POSIX ustar (prefix field) and pax, with a path over 100 characters', async () => {
    const d = tmp(), src = path.join(d, 'src'), deep = 'd'.repeat(60) + '/' + 'e'.repeat(60) + '/f.txt';
    fs.mkdirSync(path.join(src, path.dirname(deep)), { recursive: true });
    fs.writeFileSync(path.join(src, deep), 'deep'); fs.writeFileSync(path.join(src, 'top.txt'), 'top');
    fs.writeFileSync(path.join(src, 'unicodé.txt'), 'uni');
    for (const fmt of ['gnu', 'ustar', 'pax']) {
      const t = path.join(d, fmt + '.tar'), dest = path.join(d, 'out-' + fmt);
      execFileSync('tar', ['--format=' + fmt, '-cf', t, '-C', src, '.']);
      execFileSync('bzip2', ['-f', t]);
      await nv.extractTarBz2(t + '.bz2', dest);
      expect(fs.readFileSync(path.join(dest, deep), 'utf8'), fmt).toBe('deep');
      expect(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), fmt).toBe('top');
      expect(fs.readFileSync(path.join(dest, 'unicodé.txt'), 'utf8'), fmt).toBe('uni');
    }
  });

  it('reads a bzip2 made of several streams joined (what a parallel bzip2 writes) and a file bigger than one bzip2 block', async () => {
    const d = tmp(), dest = path.join(d, 'out'), raw = path.join(d, 'm.tar');
    const big = Buffer.alloc(1_300_000); for (let i = 0; i < big.length; i++) big[i] = (i * 2654435761 >>> 24) & 0xff;
    const tar = Buffer.concat([entry('pkg/', '', '5'), entry('pkg/big.bin', big), entry('pkg/tail.txt', 'tail'), Buffer.alloc(1024)]);
    const cut = 512 * 10;                                                          // split the tar on a header boundary
    const parts = [tar.subarray(0, cut), tar.subarray(cut)].map((b, i) => { fs.writeFileSync(raw + i, b); execFileSync('bzip2', ['-f', raw + i]); return fs.readFileSync(raw + i + '.bz2'); });
    fs.writeFileSync(path.join(d, 'm.tar.bz2'), Buffer.concat(parts));
    await nv.extractTarBz2(path.join(d, 'm.tar.bz2'), dest);
    expect(fs.readFileSync(path.join(dest, 'pkg', 'big.bin')).equals(big)).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'pkg', 'tail.txt'), 'utf8')).toBe('tail');
  });

  // The whole install with stand-in archives (and a stand-in manifest, since the real files are 120 MB): download →
  // size + sha256 check → tar unpack → swap into place, keeping only the synthesiser and its two libraries.
  function fixtures(d) {
    const rt = bz2(d, 'rt.tar.bz2', [entry('rt/', '', '5'), entry('rt/bin/', '', '5'), entry('rt/lib/', '', '5'),
      entry('rt/bin/sherpa-onnx-offline-tts.exe', SHERPA_SH), entry('rt/bin/onnxruntime.dll', 'dll'), entry('rt/bin/onnxruntime_providers_shared.dll', 'dll2'),
      entry('rt/bin/sherpa-onnx-vad.exe', 'unwanted'), entry('rt/lib/big.lib', 'unwanted')]);
    const md = bz2(d, 'md.tar.bz2', [entry('mdl/', '', '5'), entry('mdl/espeak-ng-data/', '', '5'), entry('mdl/espeak-ng-data/en_dict', 'd'),
      entry('mdl/model.int8.onnx', 'm'), entry('mdl/voices.bin', 'v'), entry('mdl/tokens.txt', 't'), entry('mdl/LICENSE', 'apache')]);
    const info = (f, url, top, extra) => { const b = fs.readFileSync(f); return { name: path.basename(f), url, size: b.length, sha256: require_('node:crypto').createHash('sha256').update(b).digest('hex'), top, ...extra }; };
    const kokoro = {
      ...nv.MANIFEST.kokoro,
      runtime: info(rt, 'https://example.test/rt.tar.bz2', 'rt', { keep: nv.MANIFEST.kokoro.runtime.keep }),
      model: info(md, 'https://example.test/md.tar.bz2', 'mdl', { required: nv.MANIFEST.kokoro.model.required }),
    };
    const files = { [kokoro.runtime.url]: fs.readFileSync(rt), [kokoro.model.url]: fs.readFileSync(md) };
    return { kokoro, files };
  }

  it('installs: both archives verified and unpacked, only the needed files kept, the marker holds the pinned checksum', async () => {
    const d = tmp(), root = path.join(d, 'voices'), { kokoro, files } = fixtures(d);
    const asked = [], seen = [];
    const get = async (u, o) => { asked.push(u); o.onProgress(10, 20); seen.push(nv.status(root, 'win32').progress); return files[u]; };
    await nv.install(root, 'kokoro', '', 'win32', { deps: { get, kokoro } });
    const kp = nv.kokoroPaths(root);
    expect(asked).toEqual([kokoro.runtime.url, kokoro.model.url]);
    expect(seen.map(s => s && s.engine)).toEqual(['kokoro', 'kokoro']);
    expect(fs.readFileSync(kp.exe, 'utf8')).toMatch(/^#!\/bin\/sh/);
    expect(fs.readdirSync(path.join(kp.runtime, 'bin')).sort()).toEqual(['onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'sherpa-onnx-offline-tts.exe']);
    expect(fs.existsSync(path.join(kp.runtime, 'lib'))).toBe(false);
    expect(fs.readFileSync(path.join(kp.runtime, '.ok'), 'utf8')).toBe(kokoro.runtime.sha256);
    expect(fs.readFileSync(path.join(kp.model, 'voices.bin'), 'utf8')).toBe('v');
    expect(fs.readFileSync(path.join(kp.dataDir, 'en_dict'), 'utf8')).toBe('d');
    expect(fs.readFileSync(path.join(kp.model, '.ok'), 'utf8')).toBe(kokoro.model.sha256);
    expect(fs.readdirSync(kp.base).sort()).toEqual(['model', 'runtime']);               // scratch folder removed
    expect(nv.status(root, 'win32').progress).toBeNull();
  });

  it('a wrong download is thrown away: nothing live, no scratch left, and the next try starts clean', async () => {
    const d = tmp(), root = path.join(d, 'voices'), { kokoro, files } = fixtures(d);
    const bad = Buffer.from(files[kokoro.runtime.url]); bad[bad.length - 1] ^= 1;     // same size, different bytes
    await expect(nv.install(root, 'kokoro', '', 'win32', { deps: { get: async () => bad, kokoro } })).rejects.toThrow(/checksum/);
    await expect(nv.install(root, 'kokoro', '', 'win32', { deps: { get: async () => Buffer.alloc(4), kokoro } })).rejects.toThrow(/wrong size/);
    const kp = nv.kokoroPaths(root);
    expect(fs.existsSync(kp.runtime)).toBe(false);
    expect(fs.readdirSync(kp.base)).toEqual([]);
    await nv.install(root, 'kokoro', '', 'win32', { deps: { get: async (u) => files[u], kokoro } });
    expect(fs.existsSync(kp.exe)).toBe(true);
  });

  it('a download that is not a tar leaves the engine not installed (and the error says the Windows voice keeps working)', async () => {
    const d = tmp(), root = path.join(d, 'voices'), { kokoro } = fixtures(d);
    const junk = Buffer.alloc(kokoro.runtime.size, 7);
    const k2 = { ...kokoro, runtime: { ...kokoro.runtime, sha256: require_('node:crypto').createHash('sha256').update(junk).digest('hex') } };
    await expect(nv.install(root, 'kokoro', '', 'win32', { deps: { get: async () => junk, kokoro: k2 } })).rejects.toThrow(/Windows voice keeps working/);
    expect(nv.status(root, 'win32').kokoro.ready).toBe(false);
  });
});

// A stand-in for sherpa-onnx-offline-tts.exe: a shell script that honours its flags, so the REAL spawn path, argument
// list, temp-file handling, limits and cache are exercised. POSIX only.
describe.skipIf(process.platform === 'win32')('Kokoro: synthesis through a real child process', () => {
  const made = [];
  afterEach(() => { for (const r of made.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
  const K = nv.MANIFEST.kokoro;
  const PARSE = '#!/bin/sh\nfor a in "$@"; do case "$a" in --output-filename=*) OUT="${a#*=}";; --sid=*) SID="${a#*=}";; --kokoro-length-scale=*) LS="${a#*=}";; --*) ;; *) TEXT="$a";; esac; done\n';

  function rig(body) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')); made.push(root);
    const kp = nv.kokoroPaths(root), log = path.join(root, 'calls.log');
    fs.mkdirSync(path.dirname(kp.exe), { recursive: true });
    fs.writeFileSync(kp.exe, PARSE + (typeof body === 'function' ? body(log) : body), { mode: 0o755 });
    fs.writeFileSync(path.join(kp.runtime, '.ok'), K.runtime.sha256);
    fs.mkdirSync(kp.dataDir, { recursive: true });
    for (const f of ['model.int8.onnx', 'voices.bin', 'tokens.txt']) fs.writeFileSync(path.join(kp.model, f), 'x');
    fs.writeFileSync(path.join(kp.model, '.ok'), K.model.sha256);
    return { root, log, kp };
  }
  const spec = (over = {}) => ({ engine: 'kokoro', voice: 'af_bella', rate: 1.25, text: 'Enrage soon', ...over });
  const calls = (log) => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];

  it('passes the speaker, the speed and the words; returns the WAV; a repeat is served from the cache', async () => {
    const r = rig((l) => `echo "sid=$SID ls=$LS text=$TEXT" >> '${l}'\nprintf RIFFwav > "$OUT"\n`);
    expect((await nv.synthesize(r.root, spec(), 'win32')).toString()).toBe('RIFFwav');
    expect(calls(r.log)).toEqual(['sid=1 ls=0.8 text=Enrage soon']);
    expect((await nv.synthesize(r.root, spec(), 'win32')).toString()).toBe('RIFFwav');
    expect(calls(r.log)).toHaveLength(1);                                   // cached: no second process
    expect(fs.readdirSync(r.kp.tmp)).toEqual([]);                          // temp WAV removed
  });

  it('each voice is its own speaker number; an id outside the manifest is refused', async () => {
    const r = rig((l) => `echo "sid=$SID" >> '${l}'\nprintf RIFF > "$OUT"\n`);
    for (const [voice, sid] of [['af_sarah', 3], ['am_adam', 5], ['am_michael', 6]]) {
      await nv.synthesize(r.root, spec({ voice, text: 'who ' + voice }), 'win32');
      expect(calls(r.log).pop()).toBe('sid=' + sid);
    }
    const before = calls(r.log).length;
    expect(await nv.synthesize(r.root, spec({ voice: '../../x' }), 'win32')).toBeNull();
    expect(await nv.synthesize(r.root, spec({ voice: 'af_heart' }), 'win32')).toBeNull();
    expect(await nv.synthesize(r.root, spec({ text: '--- ' }), 'win32')).toBeNull();
    expect(calls(r.log)).toHaveLength(before);
  });

  it('words that look like a flag reach the program as words', async () => {
    const r = rig((l) => `echo "text=$TEXT" >> '${l}'\nprintf RIFF > "$OUT"\n`);
    await nv.synthesize(r.root, spec({ text: '--sid=9 stack up' }), 'win32');
    expect(calls(r.log)).toEqual(['text=sid=9 stack up']);
  });

  it('is null when the program fails, and says so in plain words on the status', async () => {
    const r = rig('exit 3\n');
    expect(await nv.synthesize(r.root, spec({ text: 'fails' }), 'win32')).toBeNull();
    expect(nv.status(r.root, 'win32').kokoro.problem).toMatch(/did not start.*exit code 3.*Windows voice/);
    const ok = rig('printf RIFF > "$OUT"\n');
    await nv.synthesize(ok.root, spec({ text: 'works again' }), 'win32');
    expect(nv.status(ok.root, 'win32').kokoro.problem).toBe('');           // a good run clears it
  });

  it('is null when the program writes nothing', async () => {
    expect(await nv.synthesize(rig('exit 0\n').root, spec({ text: 'writes nothing' }), 'win32')).toBeNull();
  });

  it('is null when it hangs, at the 2.5 s callout limit, and the process is stopped', async () => {
    const r = rig('exec sleep 30\n');
    const t = Date.now();
    expect(await nv.synthesize(r.root, spec({ text: 'hangs' }), 'win32')).toBeNull();
    expect(Date.now() - t).toBeLessThan(nv.SYNTH_TIMEOUT_MS + 1500);
    expect(nv.status(r.root, 'win32').kokoro.problem).toBe('');            // slow is not broken
  }, 8000);

  it('a ▶ Test gets the longer limit: a 3 s synthesis misses the callout limit but is spoken for a Test', async () => {
    const r = rig('sleep 3\nprintf RIFFslow > "$OUT"\n');
    expect(await nv.synthesize(r.root, spec({ text: 'slow callout' }), 'win32')).toBeNull();
    const t = await nv.synthesize(r.root, spec({ text: 'slow test', test: true }), 'win32');
    expect(t && t.toString()).toBe('RIFFslow');
  }, 15000);

  it('is null when nothing is installed or the install is only half there', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')); made.push(root);
    expect(await nv.synthesize(root, spec(), 'win32')).toBeNull();
    const r = rig('printf RIFF > "$OUT"\n');
    fs.rmSync(r.kp.model, { recursive: true });
    expect(await nv.synthesize(r.root, spec({ text: 'half' }), 'win32')).toBeNull();
    expect(await nv.synthesize(r.root, spec({ text: 'wrong os' }), 'linux')).toBeNull();
  });

  it('warm-up: speaks one word in the background only when Kokoro is the voice that would speak (or right after install)', async () => {
    const r = rig((l) => `echo "text=$TEXT" >> '${l}'\nprintf RIFF > "$OUT"\n`);
    expect(await nv.warmUp(r.root, { engine: 'windows' }, 'win32')).toBe(false);
    expect(await nv.warmUp(r.root, { engine: 'piper' }, 'win32')).toBe(false);
    expect(calls(r.log)).toEqual([]);
    expect(await nv.warmUp(r.root, { engine: 'kokoro' }, 'win32')).toBe(true);
    expect(calls(r.log)).toEqual(['text=' + nv.WARM_PHRASE]);
    const auto = rig((l) => `echo "text=$TEXT" >> '${l}'\nprintf RIFF > "$OUT"\n`);
    expect(await nv.warmUp(auto.root, null, 'win32')).toBe(true);           // auto: Kokoro is installed, so it is the best engine
    const forced = rig((l) => `echo "text=$TEXT" >> '${l}'\nprintf RIFF > "$OUT"\n`);
    expect(await nv.warmUp(forced.root, { engine: 'windows' }, 'win32', { force: true })).toBe(true);   // after an install
    expect(await nv.warmUp(fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')), { engine: 'kokoro' }, 'win32')).toBe(false);   // nothing installed
    expect(await nv.warmUp(r.root, { engine: 'kokoro' }, 'linux')).toBe(false);
  });

  it('warm-up never throws or blocks: a broken program just resolves false', async () => {
    nv.remove(fs.mkdtempSync(path.join(os.tmpdir(), 'nv-')), 'kokoro', 'win32');   // empties the phrase cache, so the program really runs
    const r = rig('exit 9\n');
    await expect(nv.warmUp(r.root, { engine: 'kokoro' }, 'win32')).resolves.toBe(false);
    await expect(nv.lastWarmUp()).resolves.toBe(false);
  });

  it('Remove deletes the whole Kokoro download', () => {
    const r = rig('printf RIFF > "$OUT"\n');
    expect(nv.status(r.root, 'win32').kokoro.ready).toBe(true);
    const st = nv.remove(r.root, 'kokoro', 'win32');
    expect(st.kokoro).toMatchObject({ ready: false, voices: [] });
    expect(fs.existsSync(r.kp.base)).toBe(false);
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
    expect(speak).toMatch(/playNeural\(ch, text, packId, true\)\.then\(function\(ok\)\{ if \(!ok\) speakWin\(text, packId\); \}\)/);   // a pressed button is a Test: the longer wait
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
    expect(JSON.stringify(pkg.build)).not.toMatch(/piper|kokoro|onnx|sherpa/i);
  });

  it("the Kokoro unpack starts no program (Windows' tar.exe has no bzip2 on some PCs): vendored seek-bzip + a JS tar reader, names checked before any write, and no new npm dependency", () => {
    const nvSrc = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'neuralVoice.js')));
    expect(nvSrc).not.toMatch(/\bexec\(|execFile|execSync|shell:\s*true|tar\.exe|-xjf|-tjf/);
    expect(nvSrc).toMatch(/require\('\.\/vendor\/seek-bzip'\)/);
    expect(nvSrc.match(/spawn\(/g)).toHaveLength(2);                              // only the two synthesiser launches (Piper, Kokoro)
    const body = sliceBlock(nvSrc, 'async function extractTarBz2(', '_rmrf(destDir);');
    expect(body.indexOf('_tarList(tar, destDir)')).toBeGreaterThan(0);
    expect(body.indexOf('_tarList(tar, destDir)')).toBeLessThan(body.indexOf('writeFileSync'));
    const list = sliceBlock(nvSrc, 'function _tarList(', 'return list;\n}');
    expect(list).toMatch(/safeZipTarget\(destDir, name\)/);
    expect(list).toMatch(/!isFile && type !== '5'\) throw odd\(\)/);                // links, devices, fifos refused
    const vend = path.join(ROOT, 'apps', 'mimic', 'vendor', 'seek-bzip');
    expect(readSource(path.join(vend, 'LICENSE'))).toMatch(/MIT License/);
    expect(readSource(path.join(vend, 'index.js'))).toMatch(/VENDORED: seek-bzip 2\.0\.0.*MIT/);
  });

  it('main: the install handler passes only the two ticks, the warm-up runs in the background after boot, a Test reaches the engine', () => {
    expect(mainJs).toMatch(/ipcMain\.handle\('voice:install', async \(_e, engine, voice, accept\)/);
    expect(mainJs).toMatch(/terms: accept\.terms === true, research: accept\.research === true/);
    expect(mainJs).toMatch(/neuralVoice\.install\(VOICES_DIR\(\), String\(engine \|\| ''\), String\(voice \|\| ''\), process\.platform, \{ accept: a \}\)/);
    expect(mainJs).toMatch(/test: s\.test === true/);
    expect(mainJs).toMatch(/setTimeout\(\(\) => \{ try \{ neuralVoice\.warmUp\(VOICES_DIR\(\), \(loadConfig\(\) \|\| \{\}\)\.voice\)\.catch/);
    expect(preload).toMatch(/voiceInstall:\s*\(engine, voice, accept\) => ipcRenderer\.invoke\('voice:install', engine, voice, accept\)/);
    // an install records the acceptance only for a gated voice, built from the same ticks that were checked
    const nvSrc = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'neuralVoice.js')));
    expect(nvSrc).toMatch(/v\.tier === 'free' \? null : acceptanceRecord\(v, opts\.accept\)/);
    expect(nvSrc.indexOf('acceptanceProblem(v, opts.accept)')).toBeLessThan(nvSrc.indexOf('const plan = downloadPlan(v.id'));
  });

  it('the dashboard: three groups, an accept screen with the licence, the model card link, the credit and the required wording', () => {
    // the picker: US / UK English, Free first and "Needs your OK" after it; the other languages under "More voices"
    for (const g of ["['en_US', 'US English']", "['en_GB', 'UK English']", '<b>Free</b>', '<b>Needs your OK</b>', '<b>More voices</b>', '<b>Your own voice</b>', 'licence not checked']) expect(dash).toContain(g);
    const acc = sliceBlock(dash, 'function acceptHtml(v){', 'return h;');
    expect(acc).toContain('Research only and experimental.</b> This voice is built from data licensed for research use only. Using it for game callouts may fall outside that licence; you take that on yourself by downloading it. It may also sound or behave unexpectedly.');
    expect(acc).toContain("For personal, non-commercial use. Mimic downloads it from its publisher for you; we don\\'t share it.");
    expect(acc).toContain('I accept these terms');
    expect(acc).toContain('I understand this voice is for research use only and is experimental');
    expect(acc).toMatch(/Model card/);
    expect(acc).toMatch(/esc\(v\.modelCardUrl\)/);
    expect(acc).toMatch(/esc\(v\.credit\)/);
    // research needs BOTH boxes; Download is disabled until they are ticked, and the click handler checks again
    expect(acc).toMatch(/ok = a\.terms && \(!research \|\| a\.research\)/);
    expect(acc).toMatch(/\(ok && !eng\.busy \? '' : ' disabled'\)/);
    expect(acc).toMatch(/if \(research\) h \+= '<div style="border:2px solid var\(--red\)/);
    expect(dash).toMatch(/data-vn-dl-gated\]'\)\)\) \{ if \(eng\.acc && eng\.acc\.terms\) download\('piper', b\.getAttribute\('data-vn-dl-gated'\), \{ terms: !!eng\.acc\.terms, research: !!eng\.acc\.research \}\)/);
    // a gated voice is never offered a one-click Download
    expect(dash).toMatch(/gated \? btn\('data-vn-acc-open="'/);
    expect(dash).toMatch(/gated \? btn\('data-vn-acc-open="' \+ esc\(c\.id\) \+ '"', 'Read terms &amp; download'\) : btn\('data-vn-dl="piper:'/);
  });

  it('the dashboard Kokoro row: Download (size), voice pick, ▶ Test, Remove, the licence and credit line, and the honest wording', () => {
    expect(dash).toMatch(/btn\('data-vn-dl="kokoro:all"'[^\n]*?'Download &middot; ' \+ mb\(k\.downloadBytes \|\| k\.totalBytes\), true, !!fit\.block\)/);
    expect(dash).toMatch(/name="wpKokoroVoice"/);
    expect(dash).toMatch(/data-vn-engtest="kokoro:'/);
    expect(dash).toMatch(/btn\('data-vn-rm="kokoro"', 'Remove'\)/);
    expect(dash).toMatch(/esc\(k\.licence \|\| 'Apache-2\.0'\) \+ ' &mdash; ' \+ esc\(k\.credit \|\| ''\)/);
    expect(dash).toContain('Sounds better, slower on older PCs.');
    expect(dash).toMatch(/Slower than Piper: on an older PC a quick callout may be spoken by the Windows voice instead/);
    expect(dash).toMatch(/if \(k\.problem\) h \+= /);
    expect(dash).not.toMatch(/not built yet|Not available yet/);
  });
});
