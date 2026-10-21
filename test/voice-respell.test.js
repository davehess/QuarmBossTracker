// test/voice-respell.test.js — spoken callouts are respelled for the ear, symbols are never voiced, and a downloaded
// voice gets a short lead-in of silence (the guild lead, 2026-10-21: the Piper voice read "Slowed. Turgur's" as
// "DONT TURRIS").
//
//   · voice.js speakable() + SPOKEN_RESPELL — the one table; triggers.html speak() runs every spoken line through it
//   · the built-in slow-land callout opens "Slow landed." (on-screen text unchanged)
//   · neuralVoice.js leadInWav() — silence before the speech, downloaded voices only (Windows voices never touch it)
//
// Run: npx vitest run test/voice-respell.test.js

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const WPVoice = require_('../apps/mimic/voice.js');
const nv = require_('../apps/mimic/neuralVoice.js');
const triggersHtml = readSource(path.join(ROOT, 'apps/mimic/triggers.html'));

describe('speakable(): the respell table', () => {
  it("Turgur's and Turgurs are spoken 'Ter gurs'", () => {
    expect(WPVoice.speakable("Slow landed. Turgur's")).toBe('Slow landed. Ter gurs');
    expect(WPVoice.speakable('Slow landed. Turgurs')).toBe('Slow landed. Ter gurs');
  });

  it('is case-insensitive', () => {
    expect(WPVoice.speakable("TURGUR'S")).toBe('Ter gurs');
    expect(WPVoice.speakable('turgurs now')).toBe('Ter gurs now');
  });

  it('matches the curly and backtick apostrophes a log line can carry', () => {
    expect(WPVoice.speakable('Turgur’s')).toBe('Ter gurs');
    expect(WPVoice.speakable('Turgur`s')).toBe('Ter gurs');
  });

  it('matches whole words only', () => {
    expect(WPVoice.speakable('Turgursx')).toBe('Turgursx');
    expect(WPVoice.speakable('xTurgurs')).toBe('xTurgurs');
    expect(WPVoice.speakable("Turgur's2")).toBe("Turgur's2");
    expect(WPVoice.speakable('Turgur')).toBe('Turgur');
  });

  it('a new row in the table is all it takes (the guild lead will report more words)', () => {
    // voice.js run with one more row in its table; a regex-special character in a key is matched literally
    const win = {};
    new Function('window', readSource(path.join(ROOT, 'apps/mimic/voice.js')).replace(
      "'Turgurs': 'Ter gurs',", "'Turgurs': 'Ter gurs', 'Zzyzx.Test': 'zizzix',"))(win);
    expect(win.WPVoice.speakable('a Zzyzx.Test b')).toBe('a zizzix b');
    expect(win.WPVoice.speakable('a ZzyzxxTest b')).toBe('a ZzyzxxTest b');
  });
});

describe('speakable(): symbols are never voiced', () => {
  it('drops the leading emoji of the on-screen text, even from an explicit tts', () => {
    expect(WPVoice.speakable('\u{1F40C} Slowed')).toBe('Slowed');
    expect(WPVoice.speakable('⚡ D.I. fired')).toBe('D.I. fired');
    expect(WPVoice.speakable('\u{1F40C}️')).toBe('');
  });

  it('keeps names and numbers, and drops " - " separators', () => {
    expect(WPVoice.speakable('Aldenmar 75% - mez broke')).toBe('Aldenmar 75% mez broke');
    expect(WPVoice.speakable(null)).toBe('');
  });

  it('triggers.html speak() speaks the cleaned text but the flash keeps the emoji', () => {
    const speak = stripJs(sliceBlock(triggersHtml, 'function speak(text, meta){', 'var item = {'));
    expect(speak).toMatch(/WPVoice\.speakable\(text\)/);
    const fire = stripJs(sliceBlock(triggersHtml, 'function fire(t){', 'function fireBlind'));
    expect(fire).toMatch(/flash\(\(t\.rehearsal \? '🧪 ' : ''\) \+ \(t\.text \|\| t\.label \|\| spoken\)\)/);   // on screen: t.text as written
    expect(fire).toMatch(/speak\(spoken, speakMeta\)/);                                                          // speak() is where it is cleaned
  });
});

describe('the built-in slow-land callout', () => {
  const src = readSource(AGENT_INDEX);
  const block = sliceBlock(src, 'function _slowShortName(name) {', '\n}') + '\n' + sliceBlock(src, 'function _announceSlowLand(best, mob) {', '\n}');
  const pushed = [];
  const { _announceSlowLand } = evalBlock(
    "const _slowCalloutName = () => null;\nconst _pushOverlay = (o) => globalThis.__pushed.push(o);\n" + block, ['_announceSlowLand']);
  function land() { globalThis.__pushed = pushed; pushed.length = 0; _announceSlowLand({ name: "Turgur's Insects", magnitude: 75, caster: null }, 'a vann militis'); return pushed[0]; }

  it('opens "Slow landed." and the voice hears the respelled name; the screen text is unchanged', () => {
    const o = land();
    expect(o.tts).toBe("Slow landed. Turgur's");
    expect(WPVoice.speakable(o.tts)).toBe('Slow landed. Ter gurs');
    expect(o.text).toBe("\u{1F40C} Slowed a vann militis — Turgur's Insects 75%");
  });
});

describe('leadInWav(): silence before a downloaded voice', () => {
  // A minimal 16-bit mono PCM WAV: `n` samples of a constant non-zero value.
  function wav(n, { rate = 22050, bits = 16, tag = 1, extraChunk = false } = {}) {
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) data.writeInt16LE(1000, i * 2);
    const fmt = Buffer.alloc(24);
    fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(tag, 8); fmt.writeUInt16LE(1, 10);
    fmt.writeUInt32LE(rate, 12); fmt.writeUInt32LE(rate * 2, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(bits, 22);
    const dh = Buffer.alloc(8); dh.write('data', 0); dh.writeUInt32LE(data.length, 4);
    const head = Buffer.alloc(12); head.write('RIFF', 0); head.write('WAVE', 8);
    const parts = [head, fmt, dh, data];
    if (extraChunk) { const x = Buffer.alloc(8); x.write('LIST', 0); parts.push(x); }
    const out = Buffer.concat(parts); out.writeUInt32LE(out.length - 8, 4);
    return out;
  }

  it('is a constant, 80 ms by default', () => { expect(nv.NEURAL_LEAD_IN_MS).toBe(80); });

  it('puts exactly that much silence first, keeps the speech after it, and fixes both sizes', () => {
    const src = wav(1000);
    const out = nv.leadInWav(src);
    const pad = Math.round(22050 * 0.08);   // 1764 samples
    expect(out.length).toBe(src.length + pad * 2);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out.readUInt32LE(40)).toBe(1000 * 2 + pad * 2);      // data chunk size
    const body = out.subarray(44);
    expect(body.subarray(0, pad * 2).every((b) => b === 0)).toBe(true);
    expect(body.readInt16LE(pad * 2)).toBe(1000);               // the first speech sample, untouched
    expect(Buffer.compare(body.subarray(pad * 2), src.subarray(44))).toBe(0);
  });

  it('leaves what it cannot pad exactly as it came (another format, a trailing chunk, junk, a non-buffer)', () => {
    for (const odd of [wav(10, { bits: 8 }), wav(10, { tag: 3 }), wav(10, { extraChunk: true }), Buffer.from('RIFFwav'), Buffer.alloc(100)]) {
      expect(nv.leadInWav(odd)).toBe(odd);
    }
    expect(nv.leadInWav(null)).toBe(null);
    expect(nv.leadInWav(wav(10), 0).length).toBe(wav(10).length);
  });

  describe.skipIf(process.platform === 'win32')('through synthesize() (a real child process standing in for piper.exe)', () => {
    const made = [];
    afterEach(() => { for (const r of made.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });
    it('a downloaded voice\'s phrase comes back padded, and a repeat is the same padded clip from the cache', async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvl-')); made.push(root);
      const p = nv.piperPaths(root);
      fs.mkdirSync(p.espeak, { recursive: true });
      const clip = path.join(root, 'clip.wav'); fs.writeFileSync(clip, wav(500));
      fs.writeFileSync(p.exe, '#!/bin/sh\nwhile [ $# -gt 0 ]; do case "$1" in --output_file) OUT="$2";; esac; shift; done\ncat > /dev/null\ncp \'' + clip + '\' "$OUT"\n', { mode: 0o755 });
      fs.writeFileSync(path.join(p.runtime, '.ok'), 'x');
      const v = nv.MANIFEST.piper.voices[0], d = path.join(p.voices, v.id);
      fs.mkdirSync(d, { recursive: true });
      for (const f of v.files) fs.writeFileSync(path.join(d, f.name), 'x');
      fs.writeFileSync(path.join(d, '.ok'), 'x');
      const spec = { engine: 'piper', voice: v.id, rate: 1, text: 'Slow landed. Ter gurs' };
      const a = await nv.synthesize(root, spec, 'win32');
      expect(a.length).toBe(wav(500).length + Math.round(22050 * 0.08) * 2);
      expect(a.readUInt32LE(4)).toBe(a.length - 8);
      expect(await nv.synthesize(root, spec, 'win32')).toBe(a);
    });
  });

  it('the Windows voice path never calls it', () => {
    const winPath = stripJs(sliceBlock(triggersHtml, 'function _speakWindows(item){', 'new SpeechSynthesisUtterance(item.text)'));
    expect(winPath).not.toMatch(/leadIn/i);
    expect(stripJs(readSource(path.join(ROOT, 'apps/mimic/voice.js')))).not.toMatch(/leadIn/i);
  });
});
