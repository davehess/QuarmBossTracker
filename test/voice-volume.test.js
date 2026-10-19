// test/voice-volume.test.js — a Voice volume slider for spoken callouts (the guild lead, 2026-10-19, picked A).
//
// cfg.voice.volume is 0-1 and absent = full. It applies to EVERY engine that speaks a callout:
//   · voice.js pick() — the shared rule (Mimic's trigger window, Settings, the walkthrough) — and its sample button
//   · triggers.html — the live speech queue: the Windows voice (utterance volume) and a downloaded voice (<audio> volume)
//   · dashboard.html — the same rule for the 🗣 Voice tab's ▶ buttons, and the slider that writes it
// Trigger SOUNDS keep their own per-trigger volume; nothing here touches them.
//
// Run: npx vitest run test/voice-volume.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const WPVoice = require_('../apps/mimic/voice.js');
const voiceSrc = readSource(path.join(ROOT, 'apps/mimic/voice.js'));
const triggersHtml = readSource(path.join(ROOT, 'apps/mimic/triggers.html'));
const dash = readSource(path.join(ROOT, 'packages/wolfpack-logsync/dashboard.html'));

const PACKS = [{ id: 'default', rate: 1.05, pitch: 1, voices: [] }, { id: 'herald', rate: 0.9, pitch: 0.75, voices: [] }];
const READY = { piper: { ready: true, voices: ['en_US-kristin-medium'] }, kokoro: { ready: false, voices: [] } };

describe('voice.js pick(): the volume rule', () => {
  it('is full when nothing is set (and when the config is missing)', () => {
    expect(WPVoice.pick(PACKS, {}, null, []).volume).toBe(1);
    expect(WPVoice.pick(PACKS, null, null, []).volume).toBe(1);
    expect(WPVoice.pick([], undefined, null, []).volume).toBe(1);
  });

  it('takes the player\'s level, 0-1', () => {
    expect(WPVoice.pick(PACKS, { volume: 0.4 }, null, []).volume).toBe(0.4);
    expect(WPVoice.pick(PACKS, { volume: 1 }, null, []).volume).toBe(1);
    expect(WPVoice.pick(PACKS, { volume: 0 }, null, []).volume).toBe(0);
  });

  it('ignores junk and falls back to full, never to silence', () => {
    for (const bad of [null, undefined, '', '0.5', 'x', 2, -0.5, NaN, Infinity, {}]) {
      expect(WPVoice.pick(PACKS, { volume: bad }, null, []).volume, String(bad)).toBe(1);
    }
  });

  it('a callout\'s own voice pack does not override it (loudness is the player\'s, not the voice\'s)', () => {
    const p = WPVoice.pick(PACKS, { pack: 'default', volume: 0.3, rate: 1.9 }, 'herald', []);
    expect(p).toMatchObject({ volume: 0.3, rate: 0.9, pack: 'herald' });   // rate is the pack's own, volume still the player's
  });
});

describe('voice.js sample(): the ▶ buttons play at the chosen level', () => {
  // voice.js run against a fake window, so its real sample() path executes.
  function rig({ status = null, synth = true } = {}) {
    const spoken = [], audios = [];
    class Utt { constructor(t) { this.text = t; this.volume = 'unset'; } }
    class Aud {
      constructor(u) { this.url = u; this.volume = 1; audios.push(this); }
      addEventListener() {}
      play() { this.playedAt = this.volume; return Promise.resolve(); }
      pause() {}
    }
    const win = {
      speechSynthesis: { speak: (u) => spoken.push(u), cancel() {}, getVoices: () => [] }, SpeechSynthesisUtterance: Utt,
      mimic: { voiceStatus: () => Promise.resolve(status), voiceSynth: () => Promise.resolve(synth ? new ArrayBuffer(8) : null) },
      URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class {}, Audio: Aud,
    };
    new Function('window', voiceSrc)(win);
    return { WP: win.WPVoice, spoken, audios };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('the Windows voice speaks at the level', async () => {
    const r = rig();
    r.WP.sample('Enrage soon.', PACKS, { volume: 0.35 });
    await settle();
    expect(r.spoken).toHaveLength(1);
    expect(r.spoken[0].volume).toBe(0.35);
  });

  it('with no level set the Windows voice is full (what it always was)', async () => {
    const r = rig();
    r.WP.sample('Enrage soon.', PACKS, {});
    await settle();
    expect(r.spoken[0].volume).toBe(1);
  });

  it('a downloaded voice\'s audio has the level on it BEFORE it starts playing', async () => {
    const r = rig({ status: READY });
    r.WP.sample('Enrage soon.', PACKS, { volume: 0.5 });
    await settle(); await settle();
    expect(r.spoken).toHaveLength(0);
    expect(r.audios).toHaveLength(1);
    expect(r.audios[0].playedAt).toBe(0.5);
  });
});

describe('triggers.html: a live callout plays at the level, on every engine', () => {
  const block = sliceBlock(triggersHtml, '  var _speakQ = [];', "  // A trigger's `sound` is a library NAME");
  // The real speech queue with the browser stubbed (same stub shape as the spoken-ring tests).
  function harness({ status = READY, cfg = {}, synth = true } = {}) {
    const uttered = [], audios = [];
    class Utt { constructor(t) { this.text = t; this.voice = null; this.volume = 'unset'; } }
    const win = {
      WPVoice: {
        chooseEngine: WPVoice.chooseEngine, pick: WPVoice.pick,
        neuralAudio: () => {
          if (!synth) return Promise.resolve(null);
          const a = { volume: 1, addEventListener() {}, pause() {}, play() { a.playedAt = a.volume; return Promise.resolve(); } };
          audios.push(a);
          return Promise.resolve(a);
        },
      },
      speechSynthesis: { speak: (u) => uttered.push(u), cancel() {}, getVoices: () => [] },
      mimic: {},
    };
    const ctx = { win, Utt, status, cfg };
    const prelude = `
      var PART = ''; var PORT = 7779;
      var window = ctx.win; var SpeechSynthesisUtterance = ctx.Utt;
      var _voiceCfg = ctx.cfg, _voicePacks = [], _voiceStatus = ctx.status;
      function reportPlayback() {}
      function fetch() { return Promise.resolve({ ok: true }); }
    `;
    const api = new Function('ctx', [prelude, block, 'return { speak: speak };'].join('\n'))(ctx);
    return { ...api, uttered, audios };
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('the Windows voice: the utterance carries the level', async () => {
    const h = harness({ status: null, cfg: { volume: 0.6 } });
    h.speak('Slow landed', { trigger: 'Slow landed', ts: 1 }); await settle();
    expect(h.uttered).toHaveLength(1);
    expect(h.uttered[0].volume).toBe(0.6);
  });

  it('the Windows voice with no level is full', async () => {
    const h = harness({ status: null, cfg: {} });
    h.speak('Slow landed', { trigger: 'Slow landed', ts: 1 }); await settle();
    expect(h.uttered[0].volume).toBe(1);
  });

  it('a downloaded voice: the audio has the level on it before play()', async () => {
    const h = harness({ cfg: { volume: 0.25 } });
    h.speak('Slow landed', { trigger: 'Slow landed', ts: 1 }); await settle();
    expect(h.uttered).toHaveLength(0);
    expect(h.audios).toHaveLength(1);
    expect(h.audios[0].playedAt).toBe(0.25);
  });

  it('a downloaded voice that fails over to the Windows voice still speaks at the level', async () => {
    const h = harness({ synth: false, cfg: { volume: 0.7 } });
    h.speak('Slow landed', { trigger: 'Slow landed', ts: 1 }); await settle();
    expect(h.uttered).toHaveLength(1);
    expect(h.uttered[0].volume).toBe(0.7);
  });

  it('leaves the trigger SOUND volume alone: playSound still has its own 0.9 default', () => {
    const code = stripJs(triggersHtml);
    expect(code).toMatch(/a\.volume = \(volume != null && isFinite\(v\) && v >= 0 && v <= 1\) \? v : 0\.9;/);
  });
});

describe('dashboard.html: the Voice & names card', () => {
  const code = stripJs(dash);
  const voiceFn = (cfgVoice, win = {}) => {
    const block = sliceBlock(code, 'function volumeNow(){', '}\n');
    return new Function('cfgVoice', block + '\nreturn volumeNow;')(cfgVoice);
  };

  it('volumeNow: full by default, the saved level when sane, full again on junk', () => {
    expect(voiceFn({})()).toBe(1);
    expect(voiceFn({ volume: 0.5 })()).toBe(0.5);
    expect(voiceFn({ volume: null })()).toBe(1);
    for (const bad of ['', '0.5', 'x', 3, -1, NaN]) expect(voiceFn({ volume: bad })(), String(bad)).toBe(1);
  });

  it('the Windows speaker hands the level to the utterance, and a missing level leaves it at full', () => {
    const block = sliceBlock(code, 'function speakWin(text, packId, over){', 'window.speechSynthesis.speak(u);\n  }');
    const run = (picked) => {
      const spoken = [];
      class Utt { constructor(t) { this.text = t; this.volume = 1; } }
      const fn = new Function('window', 'SpeechSynthesisUtterance', 'pick', 'voices', block + '\nreturn speakWin;')(
        { speechSynthesis: { speak: (u) => spoken.push(u), cancel() {} } }, Utt, () => picked, () => []);
      fn('Slow landed', null);
      return spoken[0];
    };
    expect(run({ voice: null, rate: 1, pitch: 1, volume: 0.4 }).volume).toBe(0.4);
    expect(run({ voice: null, rate: 1, pitch: 1 }).volume).toBe(1);
  });

  it('a downloaded voice\'s audio is set to the level before it plays', () => {
    const play = sliceBlock(code, 'function playNeural(ch, text, packId, test, rate){', 'a.play()');
    expect(play).toMatch(/a\.volume = volumeNow\(\);\s*a\.play\(\)/);
  });

  it('the slider sits beside Speed and Pitch, from 10 to 100 per cent, disabled outside Mimic', () => {
    const html = sliceBlock(code, "<label>Pitch <input type=\"range\" id=\"wpVoicePitch\"", "id=\"wpVoiceHear\"");
    expect(html).toMatch(/<label>Volume <input type="range" id="wpVoiceVolume" min="10" max="100" step="5" value="' \+ Math\.round\(volumeNow\(\) \* 100\) \+ '"' \+ \(inMimic\(\) \? '' : ' disabled'\)/);
    expect(html.indexOf('wpVoicePitch')).toBeLessThan(html.indexOf('wpVoiceVolume'));
  });

  it('dragging it saves cfg.voice.volume as 0-1, updates the readout and a sample that is playing', () => {
    const onInput = sliceBlock(code, 'function onInput(e){', '\n  }\n');
    const saved = [], cur = { volume: 1 }, readout = { textContent: '' };
    const cfgVoice = {};
    const fn = new Function('cfgVoice', 'document', 'save', 'curAudio', 'pct', 'phrase', 'savePhrase', 'charOf', 'drafts', 'volumeNow',
      onInput + '\nreturn onInput;')(cfgVoice, { getElementById: () => readout }, () => saved.push({ ...cfgVoice }), cur, (n) => n, {}, () => {}, () => '', {},
      () => cfgVoice.volume);
    fn({ target: { id: 'wpVoiceVolume', value: '35' } });
    expect(cfgVoice.volume).toBe(0.35);
    expect(readout.textContent).toBe('35%');
    expect(cur.volume).toBe(0.35);
    expect(saved).toEqual([{ volume: 0.35 }]);
  });

  it('the shipped WEB_HTML carries it (dashboard.html is folded into the agent)', () => {
    const agent = readSource(path.join(ROOT, 'packages/wolfpack-logsync/index.js'));
    expect(agent).toContain('id="wpVoiceVolume"');
    expect(agent).toContain('function volumeNow()');
  });
});
