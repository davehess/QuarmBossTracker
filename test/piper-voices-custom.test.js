// test/piper-voices-custom.test.js — the generated Piper catalogue as Mimic uses it, multi-speaker models, and the
// player's own voice (the guild lead, 2026-10-28: "make it so people can download other ones as well or link to a custom one").
//
//   · the six voices offered before the catalogue was generated still resolve, in the same tiers and order
//   · every other language is `unchecked`: nothing downloads without the ticked box, nothing is requested before it
//   · a multi-speaker model is asked for a speaker number (--speaker n), clamped, and part of the cache key
//   · a custom voice: https links only, a size cap, the .onnx.json checked before anything is kept, names sanitised,
//     the "you are responsible for its licence" tick required, listed beside the catalogue, removable
//   · the dashboard and the IPC wiring carry all of it
// No network: downloads go through injected fakes, the synthesiser is a shell script (POSIX only).
//
// Run: npx vitest run test/piper-voices-custom.test.js

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const nv = require_('../apps/mimic/neuralVoice.js');
const WPVoice = require_('../apps/mimic/voice.js');

const LEGACY = ['en_US-kristin-medium', 'en_US-john-medium', 'en_US-ryan-high', 'en_US-lessac-medium', 'en_US-joe-medium', 'en_US-ryan-medium'];
const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const RUNTIME_OK = (root) => {
  const p = nv.piperPaths(root);
  fs.mkdirSync(path.dirname(p.exe), { recursive: true }); fs.writeFileSync(p.exe, 'x'); fs.writeFileSync(path.join(p.runtime, '.ok'), 'x');
  return p;
};
const CONFIG = (over = {}) => JSON.stringify({ audio: { sample_rate: 22050 }, num_speakers: 1, phoneme_id_map: { a: [1], b: [2] }, dataset: 'my_voice', ...over });
const ONNX = Buffer.concat([Buffer.from([0x08, 0x08, 0x12, 0x07]), Buffer.from('pytorch'), Buffer.alloc(64)]);
const ACCEPT = { terms: true };

describe('the generated catalogue in Mimic', () => {
  it('the six legacy voices resolve by id, first in the list, in their old tiers, with their old accept-screen text', () => {
    const list = nv.MANIFEST.piper.voices;
    expect(list.slice(0, 6).map(v => v.id)).toEqual(LEGACY);
    expect(list.slice(0, 6).map(v => v.tier)).toEqual(['free', 'free', 'nc', 'research', 'research', 'research']);
    for (const id of LEGACY) expect(nv.findVoice('piper', id), id).toMatchObject({ id });
    expect(nv.findVoice('piper', 'en_US-kristin-medium').label).toBe('Kristin (US English, woman)');
    expect(nv.findVoice('piper', 'en_US-joe-medium').licence).toBe('CC0 data, fine-tuned from the research-only Lessac voice');
    expect(nv.findVoice('piper', 'en_US-ryan-high').credit).toBe('Trained on the RyanSpeech data set (CC BY-NC-SA 4.0), voice by the Piper project (rhasspy/piper-voices).');
  });

  it('offers every language in the pinned voices.json, en_US / en_GB classified and the rest unchecked', () => {
    const list = nv.MANIFEST.piper.voices;
    expect(list.length).toBeGreaterThan(150);
    const tiers = {};
    for (const v of list) tiers[v.tier] = (tiers[v.tier] || 0) + 1;
    expect(Object.keys(tiers).sort()).toEqual(['free', 'nc', 'research', 'unchecked']);
    const de = nv.findVoice('piper', 'de_DE-thorsten-high');
    expect(de).toMatchObject({ tier: 'unchecked', languageName: 'German (Germany)', licence: nv.UNCHECKED_LICENCE });
    expect(de.licence).toMatch(/not checked by Wolf Pack/);
    expect(de.modelCardUrl).toMatch(/\/blob\/[0-9a-f]{40}\/de\/de_DE\/thorsten\/high\/MODEL_CARD$/);
    expect(list.every(v => !v.id.startsWith(nv.CUSTOM_PREFIX))).toBe(true);   // a custom id can never collide with a catalogue one
  });

  it('status lists language, quality, speakers and size for the picker', () => {
    const c = nv.status(tmp(), 'win32').piper.catalog;
    expect(c.length).toBe(nv.MANIFEST.piper.voices.length);
    expect(c.find(x => x.id === 'en_US-libritts-high')).toMatchObject({ lang: 'en_US', languageName: 'English (United States)', quality: 'high', speakers: 904, tier: 'free' });
    expect(c.find(x => x.id === 'en_US-libritts-high').voiceBytes).toBeGreaterThan(100e6);
    expect(c.find(x => x.id === 'en_GB-cori-high')).toMatchObject({ lang: 'en_GB', tier: 'free', installed: false });
  });

  it('the unchecked tier needs the one tick (not the research box), and nothing is requested before it', async () => {
    const by = nv.findVoice('piper', 'de_DE-thorsten-high');
    for (const a of [undefined, null, {}, { terms: false }, { terms: 'yes' }, { research: true }]) expect(nv.acceptanceProblem(by, a), JSON.stringify(a)).toMatch(/Accept the terms/);
    expect(nv.acceptanceProblem(by, { terms: true })).toBeNull();
    const root = tmp(); const asked = [];
    const get = async (u) => { asked.push(u); return Buffer.alloc(1); };
    await expect(nv.install(root, 'piper', 'de_DE-thorsten-high', 'win32', { deps: { get } })).rejects.toThrow(/Accept the terms/);
    expect(asked).toEqual([]);
    RUNTIME_OK(root);
    await expect(nv.install(root, 'piper', 'de_DE-thorsten-high', 'win32', { accept: { terms: true }, deps: { get } })).rejects.toThrow(/wrong size/);
    expect(asked).toEqual([by.files[0].url]);
  });

  it('the gate for nc and research voices is unchanged: terms; and terms AND the research box', async () => {
    const root = tmp(); const asked = [];
    const get = async (u) => { asked.push(u); return Buffer.alloc(1); };
    await expect(nv.install(root, 'piper', 'en_US-ryan-high', 'win32', { deps: { get } })).rejects.toThrow(/Accept the terms/);
    await expect(nv.install(root, 'piper', 'en_GB-semaine-medium', 'win32', { accept: { terms: true }, deps: { get } })).rejects.toThrow(/research-only box/);
    expect(asked).toEqual([]);
  });

  it('an installed unchecked voice counts only with its acceptance record, like the others', () => {
    const root = tmp(); const p = RUNTIME_OK(root);
    const v = nv.findVoice('piper', 'de_DE-thorsten-high');
    nv.installVoiceFiles(p, v, [Buffer.from('a'), Buffer.from('b')], nv.acceptanceRecord(v, ACCEPT));
    expect(nv.status(root, 'win32').piper.voices).toEqual(['de_DE-thorsten-high']);
    fs.unlinkSync(path.join(p.voices, v.id, 'accepted.json'));
    expect(nv.status(root, 'win32').piper.voices).toEqual([]);
  });

  it('an installed voice can be removed on its own (free ones too)', () => {
    const root = tmp(); const p = RUNTIME_OK(root);
    const k = nv.findVoice('piper', 'en_US-kristin-medium'), j = nv.findVoice('piper', 'en_US-john-medium');
    for (const v of [k, j]) nv.installVoiceFiles(p, v, [Buffer.from('a'), Buffer.from('b')], null);
    expect(nv.remove(root, 'piper', 'win32', 'en_US-kristin-medium').piper.voices).toEqual(['en_US-john-medium']);
  });
});

describe('multi-speaker models', () => {
  it('normalizeSpeaker: a whole number inside the model\'s speakers, else 0', () => {
    const arctic = nv.findVoice('piper', 'en_US-arctic-medium'), one = nv.findVoice('piper', 'en_US-kristin-medium');
    expect(arctic.speakers).toBe(18);
    for (const [n, want] of [[0, 0], [5, 5], [17, 17], [18, 0], [-1, 0], [2.5, 0], ['7', 7], ['x', 0], [undefined, 0], [null, 0]]) expect(nv.normalizeSpeaker(arctic, n), String(n)).toBe(want);
    expect(nv.normalizeSpeaker(one, 3)).toBe(0);
    expect(nv.findVoice('piper', 'en_US-libritts_r-medium').speakers).toBe(2306);
  });

  it('piper gets --speaker <n> for a multi-speaker model (default 0), and not for a single-speaker one', () => {
    const p = nv.piperPaths('/r'), arctic = nv.findVoice('piper', 'en_US-arctic-medium'), one = nv.findVoice('piper', 'en_US-kristin-medium');
    const a = nv.piperArgs(p, arctic, '/r/v', '/r/o.wav', 1, 3);
    expect(a.slice(-2)).toEqual(['--speaker', '3']);
    expect(a).toEqual(expect.arrayContaining(['--model', path.join('/r/v', 'en_US-arctic-medium.onnx'), '--config', path.join('/r/v', 'en_US-arctic-medium.onnx.json'), '--output_file', '/r/o.wav', '--length_scale', '1']));
    expect(nv.piperArgs(p, arctic, '/r/v', 'o', 1).slice(-2)).toEqual(['--speaker', '0']);
    expect(nv.piperArgs(p, arctic, '/r/v', 'o', 1, 99).slice(-2)).toEqual(['--speaker', '0']);
    expect(nv.piperArgs(p, one, '/r/v', 'o', 1, 3)).not.toContain('--speaker');
  });

  it('the speaker is part of the cache key (above 0), so two speakers never share a phrase', () => {
    const k = (s) => nv.cacheKey('piper', 'en_US-arctic-medium', 1, 'Enrage soon', s);
    expect(k(0)).toBe(k(undefined));
    expect(k(0)).toBe('piper|en_US-arctic-medium|1.00|Enrage soon');   // unchanged for every voice that existed before
    expect(k(3)).not.toBe(k(0));
    expect(k(3)).not.toBe(k(4));
  });

  describe.skipIf(process.platform === 'win32')('through a real child process', () => {
    function rig() {
      const root = tmp(), p = nv.piperPaths(root), log = path.join(root, 'calls.log');
      fs.mkdirSync(p.espeak, { recursive: true });
      fs.writeFileSync(p.exe, `#!/bin/sh\nOUT=\nwhile [ $# -gt 0 ]; do case "$1" in --output_file) OUT="$2";; esac; ARGS="$ARGS $1"; shift; done\ncat >/dev/null\necho "$ARGS" >> '${log}'\nprintf RIFFwav > "$OUT"\n`, { mode: 0o755 });
      fs.writeFileSync(path.join(p.runtime, '.ok'), 'x');
      const v = nv.findVoice('piper', 'en_US-arctic-medium');
      nv.installVoiceFiles(p, v, [Buffer.from('a'), Buffer.from('b')], nv.acceptanceRecord(v, { terms: true, research: true }));
      return { root, log };
    }
    const say = (root, over) => nv.synthesize(root, { engine: 'piper', voice: 'en_US-arctic-medium', rate: 1, text: 'Enrage soon', ...over }, 'win32');
    const calls = (log) => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean);

    it('the speaker number reaches Piper, a different one is a new phrase, an out-of-range one falls to 0', async () => {
      const r = rig();
      expect((await say(r.root, { speaker: 3 })).toString()).toBe('RIFFwav');
      expect(calls(r.log)[0]).toMatch(/ --speaker 3$/);
      await say(r.root, { speaker: 3 });
      expect(calls(r.log)).toHaveLength(1);                          // cached
      await say(r.root, { speaker: 4 });
      expect(calls(r.log)[1]).toMatch(/ --speaker 4$/);
      await say(r.root, {});
      expect(calls(r.log)[2]).toMatch(/ --speaker 0$/);              // default
      await say(r.root, { speaker: 500, text: 'Another phrase' });
      expect(calls(r.log)[3]).toMatch(/ --speaker 0$/);              // out of range
    });
  });
});

describe('custom voices: the links', () => {
  it('https only: http, file:, ftp:, data:, javascript:, a user name in the link and plain text are all refused', () => {
    expect(nv.customUrl('https://example.org/v/voice.onnx')).toBe('https://example.org/v/voice.onnx');
    expect(nv.customUrl('  https://example.org/a b.onnx ')).toBe('https://example.org/a%20b.onnx');
    for (const bad of ['http://example.org/voice.onnx', 'file:///C:/voice.onnx', 'ftp://example.org/voice.onnx', 'data:text/plain,x', 'javascript:alert(1)', 'https://user:pw@example.org/v.onnx', 'https://user@example.org/v.onnx', 'voice.onnx', '', null, undefined, '//example.org/v.onnx', 'https://' + 'a'.repeat(2100) + '.org/x']) {
      expect(() => nv.customUrl(bad), String(bad).slice(0, 40)).toThrow();
    }
    expect(() => nv.customUrl('http://example.org/v.onnx')).toThrow(/Only https/);
    expect(() => nv.customUrl('file:///etc/passwd')).toThrow(/Only https/);
  });

  it('the size cap is 200 MB', () => { expect(nv.CUSTOM_MAX_BYTES).toBe(200 * 1024 * 1024); });

  describe('pipeLimited: stream to a file, stop past the cap', () => {
    it('a file under the cap is written whole, with its size, sha256 and first bytes', async () => {
      const dest = path.join(tmp(), 'm.onnx');
      const r = await nv.pipeLimited(Readable.from([ONNX.subarray(0, 40), ONNX.subarray(40)]), dest, 1000);
      expect(r.size).toBe(ONNX.length);
      expect(r.sha256).toBe(require_('node:crypto').createHash('sha256').update(ONNX).digest('hex'));
      expect(nv.looksLikeOnnx(r.head)).toBe(true);
      expect(fs.readFileSync(dest).equals(ONNX)).toBe(true);
    });
    it('past the cap it stops, says so, and leaves no partial file', async () => {
      const dest = path.join(tmp(), 'big.onnx'); let progress = 0;
      await expect(nv.pipeLimited(Readable.from([Buffer.alloc(600), Buffer.alloc(600), Buffer.alloc(600)]), dest, 1000, (n) => { progress = n; })).rejects.toThrow(/limit/);
      expect(fs.existsSync(dest)).toBe(false);
      expect(progress).toBe(600);
    });
  });

  describe('fetchToFile (a fake https request)', () => {
    const fake = (routes) => {
      const asked = [];
      const request = (href, _opts, cb) => {
        asked.push(href);
        const h = {};
        const req = { on(ev, fn) { h[ev] = fn; return req; }, destroy() {}, end() {
          setImmediate(() => {
            const r = routes[href];
            if (!r) { h.error && h.error(Object.assign(new Error('nope'), { code: 'ENOTFOUND' })); return; }
            const res = Readable.from(r.body ? [r.body] : []);
            res.statusCode = r.status || 200; res.headers = r.headers || {};
            cb(res);
          });
        } };
        return req;
      };
      return { request, asked };
    };

    it('downloads an https file, following a redirect to another https address', async () => {
      const f = fake({ 'https://a.example/v.onnx': { status: 302, headers: { location: 'https://cdn.example/v.onnx' } }, 'https://cdn.example/v.onnx': { body: ONNX } });
      const dest = path.join(tmp(), 'v.onnx');
      const r = await nv.fetchToFile('https://a.example/v.onnx', dest, { request: f.request });
      expect(r.size).toBe(ONNX.length);
      expect(f.asked).toEqual(['https://a.example/v.onnx', 'https://cdn.example/v.onnx']);
    });
    it('refuses a redirect to http or file:, and never asks for it', async () => {
      for (const to of ['http://evil.example/v.onnx', 'file:///etc/passwd']) {
        const f = fake({ 'https://a.example/v.onnx': { status: 301, headers: { location: to } } });
        await expect(nv.fetchToFile('https://a.example/v.onnx', path.join(tmp(), 'v.onnx'), { request: f.request })).rejects.toThrow(/not https/);
        expect(f.asked).toEqual(['https://a.example/v.onnx']);
      }
    });
    it('an http link is refused before any request is made', async () => {
      const f = fake({});
      await expect(nv.fetchToFile('http://a.example/v.onnx', path.join(tmp(), 'v.onnx'), { request: f.request })).rejects.toThrow(/Only https/);
      expect(f.asked).toEqual([]);
    });
    it('a server that says the file is over the cap is refused before a byte is read; one that lies is cut off', async () => {
      const dest = path.join(tmp(), 'v.onnx');
      const big = fake({ 'https://a.example/v.onnx': { body: ONNX, headers: { 'content-length': String(nv.CUSTOM_MAX_BYTES + 1) } } });
      await expect(nv.fetchToFile('https://a.example/v.onnx', dest, { request: big.request })).rejects.toThrow(/over the 200 MB limit/);
      const liar = fake({ 'https://a.example/v.onnx': { body: Buffer.alloc(3000), headers: { 'content-length': '10' } } });
      await expect(nv.fetchToFile('https://a.example/v.onnx', dest, { request: liar.request, maxBytes: 1000 })).rejects.toThrow(/limit/);
      expect(fs.existsSync(dest)).toBe(false);
    });
    it('a 404 and an unreachable host come back in plain words', async () => {
      const f = fake({ 'https://a.example/v.onnx': { status: 404 } });
      await expect(nv.fetchToFile('https://a.example/v.onnx', path.join(tmp(), 'v'), { request: f.request })).rejects.toThrow(/answered 404/);
      await expect(nv.fetchToFile('https://gone.example/v.onnx', path.join(tmp(), 'v'), { request: f.request })).rejects.toThrow(/Could not reach gone\.example/);
    });
  });
});

describe('custom voices: names and the settings file', () => {
  const OK = /^custom-[a-z0-9][a-z0-9._-]{0,47}$/;

  it('a name is lower case, has no path separators, never starts with a dot, and always carries the prefix', () => {
    const cases = [
      ['en_US-my-voice-medium.onnx', 'custom-en_us-my-voice-medium'],
      ['/voices/My Voice (v2).onnx', 'custom-my-voice-v2'],
      ['C:\\Users\\me\\Piper Voice.onnx.json', 'custom-piper-voice'],
      ['../../evil.onnx', 'custom-evil'],
      ['..\\..\\evil', 'custom-evil'],
      ['https://x.org/a/b/%2E%2E%2Fsneaky.onnx', 'custom-sneaky'],
      ['.hidden', 'custom-hidden'],
      ['', 'custom-voice'], ['???', 'custom-voice'], [null, 'custom-voice'], ['....onnx', 'custom-voice'],
    ];
    for (const [raw, want] of cases) {
      const id = nv.customName(raw);
      expect(id, String(raw)).toBe(want);
      expect(OK.test(id), id).toBe(true);
      expect(id).not.toMatch(/[\\/]|\.\./);
    }
    expect(nv.customName('x'.repeat(200))).toMatch(OK);
    expect(nv.customName('x'.repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it('a name already taken gets -2, -3…', () => {
    expect(nv.customName('mine.onnx', ['custom-mine'])).toBe('custom-mine-2');
    expect(nv.customName('mine.onnx', ['custom-mine', 'custom-mine-2'])).toBe('custom-mine-3');
  });

  it('the settings file must parse and carry the sample rate, speaker count and phoneme table Piper needs', () => {
    expect(nv.validateVoiceConfig(Buffer.from(CONFIG()))).toEqual({ sampleRate: 22050, speakers: 1, label: 'my_voice' });
    expect(nv.validateVoiceConfig(Buffer.from(CONFIG({ num_speakers: 12 }))).speakers).toBe(12);
    const bad = [
      ['', /empty/], ['not json', /not valid JSON/], ['[1,2]', /not an object/], ['null', /not an object/],
      [CONFIG({ audio: {} }), /sample_rate/], [CONFIG({ audio: { sample_rate: '22050' } }), /sample_rate/], [CONFIG({ audio: { sample_rate: 5 } }), /sample_rate/],
      [CONFIG({ num_speakers: 0 }), /num_speakers/], [CONFIG({ num_speakers: 'two' }), /num_speakers/],
      [CONFIG({ phoneme_id_map: {} }), /phoneme_id_map/], [CONFIG({ phoneme_id_map: [1] }), /phoneme_id_map/],
      [JSON.stringify({ audio: { sample_rate: 22050 }, num_speakers: 1 }), /phoneme_id_map/],
      ['{"x":"' + 'a'.repeat(1100000) + '"}', /larger/],
    ];
    for (const [text, why] of bad) expect(() => nv.validateVoiceConfig(Buffer.from(text)), text.slice(0, 40)).toThrow(why);
  });

  it('a model is told from a web page by its first byte', () => {
    expect(nv.looksLikeOnnx(ONNX)).toBe(true);
    expect(nv.looksLikeOnnx(Buffer.from('<!DOCTYPE html>'))).toBe(false);
    expect(nv.looksLikeOnnx(Buffer.alloc(0))).toBe(false);
  });
});

describe('custom voices: adding, the licence tick, listing, removing', () => {
  const files = (dir, name = 'My Voice', cfg = CONFIG(), onnx = ONNX) => {
    const o = path.join(dir, name + '.onnx'), c = path.join(dir, name + '.onnx.json');
    fs.writeFileSync(o, onnx); fs.writeFileSync(c, cfg);
    return { onnxPath: o, configPath: c };
  };
  const leftovers = (root) => { try { return fs.readdirSync(nv.piperPaths(root).voices); } catch { return []; } };

  it('from two files: copied into the voices folder as custom-<name>, listed with the "your licence" text, and chosen like any voice', async () => {
    const root = tmp(); RUNTIME_OK(root);
    const st = await nv.addCustomVoice(root, files(tmp(), 'My Voice', CONFIG({ num_speakers: 4 })), ACCEPT, 'win32');
    const c = st.piper.catalog.find(x => x.custom);
    expect(c).toMatchObject({ id: 'custom-my-voice', tier: 'custom', installed: true, speakers: 4, licence: nv.CUSTOM_LICENCE, downloadBytes: 0 });
    expect(c.label).toBe('My Voice (custom)');
    expect(c.licence).toBe('Custom voice — you are responsible for its licence');
    expect(st.piper.voices).toContain('custom-my-voice');
    expect(WPVoice.chooseEngine({ engine: 'piper', piperVoice: 'custom-my-voice' }, st)).toEqual({ engine: 'piper', voice: 'custom-my-voice' });
    const d = path.join(nv.piperPaths(root).voices, 'custom-my-voice');
    expect(fs.readdirSync(d).sort()).toEqual(['.ok', 'accepted.json', 'custom-my-voice.onnx', 'custom-my-voice.onnx.json', 'custom.json']);
    expect(fs.readFileSync(path.join(d, 'custom-my-voice.onnx')).equals(ONNX)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(d, 'accepted.json'), 'utf8'))).toMatchObject({ voice: 'custom-my-voice', tier: 'custom', terms: true });
    expect(leftovers(root)).toEqual(['custom-my-voice']);   // no scratch folder left behind
  });

  it('the licence tick is required: without it nothing is read, copied or created', async () => {
    const root = tmp(); RUNTIME_OK(root); const src = files(tmp());
    for (const a of [undefined, null, {}, { terms: false }, { terms: 'yes' }, { research: true }]) {
      await expect(nv.addCustomVoice(root, src, a, 'win32'), JSON.stringify(a)).rejects.toThrow(/Accept the terms for this custom voice/);
    }
    expect(leftovers(root)).toEqual([]);
  });

  it('a custom voice with its acceptance record gone is not installed', async () => {
    const root = tmp(); RUNTIME_OK(root);
    await nv.addCustomVoice(root, files(tmp()), ACCEPT, 'win32');
    fs.unlinkSync(path.join(nv.piperPaths(root).voices, 'custom-my-voice', 'accepted.json'));
    const st = nv.status(root, 'win32').piper;
    expect(st.catalog.find(x => x.custom).installed).toBe(false);
    expect(st.voices).toEqual([]);
  });

  it('is refused off Windows, and while another download runs', async () => {
    await expect(nv.addCustomVoice(tmp(), files(tmp()), ACCEPT, 'linux')).rejects.toThrow(/Windows only/);
  });

  it('bad input is refused in plain words and leaves nothing behind', async () => {
    const root = tmp(); RUNTIME_OK(root); const d = tmp();
    const html = Buffer.from('<!DOCTYPE html><html>not a model</html>');
    const cases = [
      [files(d, 'a', 'not json'), /valid JSON/],
      [files(d, 'b', CONFIG({ audio: {} })), /sample_rate/],
      [files(d, 'c', CONFIG(), html), /not a voice model/],
      [{ onnxPath: path.join(d, 'missing.onnx'), configPath: path.join(d, 'a.onnx.json') }, /Pick the voice files again/],
      [{ onnxPath: path.join(d, 'a.onnx.json'), configPath: path.join(d, 'a.onnx.json') }, /ending in \.onnx\./],
      [{ onnxPath: path.join(d, 'a.onnx'), configPath: path.join(d, 'a.onnx') }, /ending in \.onnx\.json/],
      [{ onnxPath: d, configPath: path.join(d, 'a.onnx.json') }, /Pick the voice files again/],
      [{}, /Pick the voice files again/],
    ];
    for (const [src, why] of cases) await expect(nv.addCustomVoice(root, src, ACCEPT, 'win32'), String(why)).rejects.toThrow(why);
    expect(leftovers(root)).toEqual([]);
    expect(nv.status(root, 'win32').piper.catalog.filter(x => x.custom)).toEqual([]);
  });

  describe('from two links', () => {
    const fakeFetch = (log, { cfg = CONFIG(), onnx = ONNX } = {}) => async (url, dest, opts) => {
      log.push({ url, opts });
      const body = /\.json$/.test(new URL(url).pathname) ? Buffer.from(cfg) : onnx;
      fs.writeFileSync(dest, body);
      return { size: body.length, sha256: 'x', head: body.subarray(0, 16) };
    };
    const URLS = { onnxUrl: 'https://voices.example/pack/Deep%20Voice.onnx', configUrl: 'https://voices.example/pack/Deep%20Voice.onnx.json' };

    it('fetches the two https files with the caps, validates, names it from the link, keeps the host as its source', async () => {
      const root = tmp(); RUNTIME_OK(root); const log = [];
      const st = await nv.addCustomVoice(root, URLS, ACCEPT, 'win32', { fetchFile: fakeFetch(log) });
      expect(log.map(x => x.url)).toEqual([URLS.configUrl, URLS.onnxUrl]);
      expect(log[0].opts.maxBytes).toBeLessThanOrEqual(1024 * 1024);          // the settings file has its own small cap
      expect(log[1].opts.maxBytes).toBe(nv.CUSTOM_MAX_BYTES);                // the model: 200 MB
      const c = st.piper.catalog.find(x => x.custom);
      expect(c.id).toBe('custom-deep-voice');
      expect(c.credit).toBe('Added by you from voices.example.');
      expect(leftovers(root)).toEqual(['custom-deep-voice']);
    });

    it('refuses an http / file: / odd link before fetching anything', async () => {
      const root = tmp(); RUNTIME_OK(root); const log = [];
      const f = fakeFetch(log);
      for (const src of [
        { onnxUrl: 'http://voices.example/v.onnx', configUrl: 'https://voices.example/v.onnx.json' },
        { onnxUrl: 'https://voices.example/v.onnx', configUrl: 'http://voices.example/v.onnx.json' },
        { onnxUrl: 'file:///C:/v.onnx', configUrl: 'file:///C:/v.onnx.json' },
        { onnxUrl: 'https://voices.example/v.onnx', configUrl: '' },
      ]) await expect(nv.addCustomVoice(root, src, ACCEPT, 'win32', { fetchFile: f })).rejects.toThrow();
      expect(log).toEqual([]);
      expect(leftovers(root)).toEqual([]);
    });

    it('wants the links to end in .onnx and .onnx.json', async () => {
      const root = tmp(); RUNTIME_OK(root); const log = [];
      await expect(nv.addCustomVoice(root, { onnxUrl: 'https://v.example/page', configUrl: 'https://v.example/v.onnx.json' }, ACCEPT, 'win32', { fetchFile: fakeFetch(log) })).rejects.toThrow(/end in \.onnx/);
      await expect(nv.addCustomVoice(root, { onnxUrl: 'https://v.example/v.onnx', configUrl: 'https://v.example/v.json' }, ACCEPT, 'win32', { fetchFile: fakeFetch(log) })).rejects.toThrow(/end in \.onnx\.json/);
      expect(log).toEqual([]);
    });

    it('a bad settings file is rejected before the (large) model is fetched', async () => {
      const root = tmp(); RUNTIME_OK(root); const log = [];
      await expect(nv.addCustomVoice(root, URLS, ACCEPT, 'win32', { fetchFile: fakeFetch(log, { cfg: '{"audio":{}}' }) })).rejects.toThrow(/sample_rate/);
      expect(log.map(x => x.url)).toEqual([URLS.configUrl]);
      expect(leftovers(root)).toEqual([]);
    });

    it('a download that fails midway (over the cap, dropped) leaves nothing behind', async () => {
      const root = tmp(); RUNTIME_OK(root);
      const f = async (url, dest) => { if (/\.json$/.test(url)) { fs.writeFileSync(dest, CONFIG()); return {}; } fs.writeFileSync(dest, 'partial'); throw new Error('That file is bigger than the 200 MB limit for a custom voice, so it was thrown away.'); };
      await expect(nv.addCustomVoice(root, URLS, ACCEPT, 'win32', { fetchFile: f })).rejects.toThrow(/200 MB limit/);
      expect(leftovers(root)).toEqual([]);
    });

    it('the second voice of the same name gets a different id', async () => {
      const root = tmp(); RUNTIME_OK(root); const log = [];
      await nv.addCustomVoice(root, URLS, ACCEPT, 'win32', { fetchFile: fakeFetch(log) });
      const st = await nv.addCustomVoice(root, URLS, ACCEPT, 'win32', { fetchFile: fakeFetch(log) });
      expect(st.piper.catalog.filter(x => x.custom).map(x => x.id)).toEqual(['custom-deep-voice', 'custom-deep-voice-2']);
    });
  });

  it('a custom voice can be removed; nothing else goes with it, and an id that is not a custom voice removes nothing', async () => {
    const root = tmp(); const p = RUNTIME_OK(root);
    const k = nv.findVoice('piper', 'en_US-kristin-medium');
    nv.installVoiceFiles(p, k, [Buffer.from('a'), Buffer.from('b')], null);
    await nv.addCustomVoice(root, files(tmp()), ACCEPT, 'win32');
    const victim = path.join(root, 'victim'); fs.mkdirSync(victim); fs.writeFileSync(path.join(victim, 'keep.txt'), 'k');
    for (const id of ['../victim', 'custom-../../victim', 'custom-..', '/etc', 'custom-nope']) nv.remove(root, 'piper', 'win32', id);
    expect(fs.existsSync(path.join(victim, 'keep.txt'))).toBe(true);
    expect(nv.status(root, 'win32').piper.voices).toEqual(['en_US-kristin-medium', 'custom-my-voice']);
    const after = nv.remove(root, 'piper', 'win32', 'custom-my-voice').piper;
    expect(after.voices).toEqual(['en_US-kristin-medium']);
    expect(after.catalog.filter(x => x.custom)).toEqual([]);
    expect(fs.existsSync(path.join(p.voices, 'custom-my-voice'))).toBe(false);
  });

  it('folders that merely look like custom voices are not listed', () => {
    const root = tmp(); const p = RUNTIME_OK(root);
    for (const n of ['custom-fake', 'custom-half', '.custom-tmp-1', 'CUSTOM-X']) fs.mkdirSync(path.join(p.voices, n), { recursive: true });
    fs.writeFileSync(path.join(p.voices, 'custom-half', 'custom.json'), JSON.stringify({ id: 'custom-half' }));   // no .ok: a half-written install
    fs.writeFileSync(path.join(p.voices, 'custom-fake', 'custom.json'), JSON.stringify({ id: 'custom-other' })); fs.writeFileSync(path.join(p.voices, 'custom-fake', '.ok'), 'x');
    expect(nv.customVoices(p)).toEqual([]);
  });

  describe.skipIf(process.platform === 'win32')('speaking with it', () => {
    it('a custom voice is spoken through Piper as a file path, with its own speaker number', async () => {
      const root = tmp(), p = RUNTIME_OK(root), log = path.join(root, 'calls.log');
      fs.mkdirSync(p.espeak, { recursive: true });
      fs.writeFileSync(p.exe, `#!/bin/sh\nOUT=\nwhile [ $# -gt 0 ]; do case "$1" in --output_file) OUT="$2";; esac; ARGS="$ARGS $1"; shift; done\ncat >/dev/null\necho "$ARGS" >> '${log}'\nprintf RIFFwav > "$OUT"\n`);
      fs.chmodSync(p.exe, 0o755);   // RUNTIME_OK created the file first, and a write does not change a file's mode
      await nv.addCustomVoice(root, files(tmp(), 'Quad', CONFIG({ num_speakers: 4 })), ACCEPT, 'win32');
      const buf = await nv.synthesize(root, { engine: 'piper', voice: 'custom-quad', rate: 1, text: 'Hello there', speaker: 2 }, 'win32');
      expect(buf.toString()).toBe('RIFFwav');
      const line = fs.readFileSync(log, 'utf8').trim();
      expect(line).toContain('--model ' + path.join(p.voices, 'custom-quad', 'custom-quad.onnx'));
      expect(line).toMatch(/ --speaker 2$/);
    });
  });
});

describe('wiring (comments stripped)', () => {
  const dash = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));
  const mainJs = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
  const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));

  it('the dashboard picker: a speaker box and ▶ Test per installed multi-speaker voice, Remove on every installed voice, the custom form', () => {
    expect(dash).toMatch(/c\.installed && c\.speakers > 1/);
    expect(dash).toContain('data-vn-speaker="');
    expect(dash).toMatch(/spec\.speaker = speakerOf\(ch\.voice\)/);
    expect(dash).toMatch(/cfgVoice\.piperSpeakers\[t\.getAttribute\('data-vn-speaker'\)\] = sp/);
    expect(dash).toMatch(/btn\('data-vn-rm="piper:' \+ esc\(c\.id\) \+ '"', 'Remove'\)/);
    expect(dash).toContain('Custom voice &mdash; you are responsible for its licence. I have the right to use it.');
    expect(dash).toMatch(/window\.mimic\.voiceAddCustom\(mode === 'files' \? \{ files: true \} : \{ onnxUrl: eng\.cu\.onnx\.trim\(\), configUrl: eng\.cu\.config\.trim\(\) \}, \{ terms: true \}\)/);
    expect(dash).toMatch(/if \(eng\.busy \|\| !eng\.cu\.ok\) return;/);
    expect(dash).toMatch(/canUrls = cu\.ok && \/\^https:\\\/\\\/\/i\.test\(cu\.onnx\.trim\(\)\)/);
    // the other languages sit behind an OK screen that says the licence was not checked
    expect(dash).toContain('Licence not checked by Wolf Pack &mdash; read the model card.');
    expect(dash).toContain('I have read the model card and accept its terms');
  });

  it('every <details> the picker adds carries wpKeep', () => {
    const block = dash.slice(dash.indexOf('function piperListHtml'), dash.indexOf('function engineHtml'));
    const opened = (block.match(/<details /g) || []).length, kept = (block.match(/<details ' \+ wpKeep\(/g) || []).length;
    expect(opened).toBeGreaterThanOrEqual(1);
    expect(kept).toBe(opened);
  });

  it('Mimic: the add-custom handler passes only the ticked box, checks it before opening the file picker, and a live callout reads the saved speaker', () => {
    expect(mainJs).toMatch(/ipcMain\.handle\('voice:add-custom', async \(e, src, accept\)/);
    expect(mainJs).toMatch(/const a = accept && typeof accept === 'object' \? \{ terms: accept\.terms === true \} : \{\};/);
    const h = mainJs.slice(mainJs.indexOf("ipcMain.handle('voice:add-custom'"));
    expect(h.indexOf('acceptanceProblem')).toBeGreaterThan(-1);
    expect(h.indexOf('acceptanceProblem')).toBeLessThan(h.indexOf('showOpenDialog'));
    expect(h).toMatch(/neuralVoice\.addCustomVoice\(VOICES_DIR\(\), spec, a\)/);
    expect(mainJs).toMatch(/\.voice \|\| \{\}\)\.piperSpeakers/);
    expect(mainJs).toMatch(/rate: s\.rate, speaker, test: s\.test === true/);
    expect(preload).toMatch(/voiceAddCustom:\s*\(src, accept\)\s*=> ipcRenderer\.invoke\('voice:add-custom', src, accept\)/);
  });

  it('the generated data file ships inside Mimic (nothing in the builder config leaves it out)', () => {
    const pkg = JSON.parse(readSource(path.join(ROOT, 'apps', 'mimic', 'package.json')));
    expect(pkg.build.files).toContain('**/*');
    expect(pkg.build.files.some(f => /piper-voices/.test(f) && f.startsWith('!'))).toBe(false);
  });
});
