// voice.js — which speech voice, rate and pitch a spoken callout uses (the guild lead, 2026-10-14:
// "different voice packs"). Loaded by every page that speaks or lets you hear a sample (triggers.html,
// settings.html, welcome.html) so they cannot drift apart; the dashboard (served by the agent, not from
// this folder) carries its own few lines of the same rules.
//
// A VOICE PACK is a named preset { id, label, voices:[name fragments], rate, pitch }, served by the agent on
// GET /api/voice-packs. The player's choice lives in Mimic's config as cfg.voice:
//   { pack: 'herald', voiceName: 'Microsoft Zira Desktop', rate: 1.2, pitch: 0.9 }
// where voiceName / rate / pitch are optional hand overrides (null or absent = take the pack's).
// Beside it, engine / piperVoice / kokoroVoice choose WHICH synthesiser speaks (chooseEngine below): a downloaded
// open-source voice made in Mimic's main process (neuralVoice.js), or the Windows voice that all of the above
// describes. Rate applies to every engine; pitch and voiceName to the Windows voice only.
// cfg.volume (0-1, absent = 1; the guild lead, 2026-10-19) is how loud a spoken callout plays, on every engine. It is a
// playback preference, not part of a voice, so a trigger's own pack does not override it.
// A trigger's own `voice_pack` outranks all of that for that one callout: the pack as shipped.
// A named voice that is not installed falls back to the next fragment, then to the default voice —
// the pack's rate and pitch still apply, so "Herald" is slower and lower even on a bare PC.
(function (root) {
  'use strict';
  var DEFAULT_RATE = 1.05, DEFAULT_PITCH = 1;   // what every callout used before voice packs

  function _num(v, lo, hi) { v = Number(v); return (isFinite(v) && v >= lo && v <= hi) ? v : null; }

  // → { voice: SpeechSynthesisVoice|null, rate, pitch, volume, pack: id }
  function pick(packs, cfg, packId, voices) {
    cfg = cfg || {};
    packs = Array.isArray(packs) ? packs : [];
    voices = Array.isArray(voices) ? voices : [];
    var forced = !!packId;
    var id = packId || cfg.pack || 'default';
    var pack = null;
    for (var i = 0; i < packs.length; i++) if (packs[i] && packs[i].id === id) { pack = packs[i]; break; }
    var rate = pack ? _num(pack.rate, 0.1, 10) : null, pitch = pack ? _num(pack.pitch, 0, 2) : null;
    if (rate == null) rate = DEFAULT_RATE;
    if (pitch == null) pitch = DEFAULT_PITCH;
    var voice = null;
    if (!forced) {
      var r = _num(cfg.rate, 0.1, 10), p = _num(cfg.pitch, 0, 2);
      if (r != null) rate = r;
      if (p != null) pitch = p;
      if (cfg.voiceName) {
        for (var a = 0; a < voices.length; a++) if (voices[a].name === cfg.voiceName) { voice = voices[a]; break; }
      }
    }
    if (!voice && pack && Array.isArray(pack.voices)) {
      for (var f = 0; f < pack.voices.length && !voice; f++) {
        var frag = String(pack.voices[f] || '').toLowerCase();
        if (!frag) continue;
        for (var b = 0; b < voices.length; b++) if (String(voices[b].name || '').toLowerCase().indexOf(frag) >= 0) { voice = voices[b]; break; }
      }
    }
    var vol = typeof cfg.volume === 'number' ? _num(cfg.volume, 0, 1) : null;   // null / '' would read as 0 (silence)
    return { voice: voice, rate: rate, pitch: pitch, volume: vol == null ? 1 : vol, pack: pack ? pack.id : 'default' };
  }

  // ENGINE (the guild lead, 2026-10-17): cfg.engine is 'auto' (or absent), 'windows', 'piper' or 'kokoro', and
  // cfg.piperVoice / cfg.kokoroVoice name the voice in each. `status` is Mimic's voice:status answer
  // ({ piper: { ready, voices:[ids installed] }, kokoro: {...} }). Auto takes Piper first, Kokoro only when Piper is
  // not installed: Piper is the default and Kokoro the upgrade you pick (the guild lead, 2026-10-17), because Kokoro
  // often misses the 2.5 s callout limit on a slower PC. An explicit pick takes that engine only, and anything not
  // installed — or no answer from Mimic at all — is the Windows voice. Never throws.
  // → { engine: 'windows'|'piper'|'kokoro', voice: id|null }
  function chooseEngine(cfg, status) {
    cfg = cfg || {};
    var want = cfg.engine || 'auto';
    var order = want === 'windows' ? [] : (want === 'auto' ? ['piper', 'kokoro'] : [want]);
    for (var i = 0; i < order.length; i++) {
      var e = order[i], s = status && status[e];
      if (s && s.ready && Array.isArray(s.voices) && s.voices.length) {
        var asked = cfg[e + 'Voice'];
        return { engine: e, voice: s.voices.indexOf(asked) >= 0 ? asked : s.voices[0] };
      }
    }
    return { engine: 'windows', voice: null };
  }

  // HOW A WORD IS SPELLED FOR THE VOICE (the guild lead, 2026-10-21: the Piper voice read "Slowed. Turgur's" as
  // "DONT TURRIS"). The words on screen are for the eye; this table is for the ear. ⚠ ADD ANY WORD THE VOICES MANGLE
  // HERE — `written: spoken`, one line each, no other change needed. Matching is case-insensitive and on WHOLE words
  // only, so "Turgurs" never rewrites the middle of a longer word. It is applied to EVERY spoken callout (built-in,
  // guild and personal triggers alike) and to the sample buttons, by speakable() below.
  var SPOKEN_RESPELL = {
    "Turgur's": 'Ter gurs',
    'Turgurs': 'Ter gurs',
  };

  function _escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Written with char codes, not literals: U+2028/2029 are line terminators and would end a regex literal.
  var _c = String.fromCharCode;
  var SYMBOLS = new RegExp('[' + _c(0x2190) + '-' + _c(0x2BFF) + _c(0x2600) + '-' + _c(0x27BF) + _c(0xFE0F) + _c(0x2028) + _c(0x2029) + ']', 'g');
  var CURLY_APOSTROPHES = new RegExp('[' + _c(0x2018) + _c(0x2019) + '`]', 'g');
  var SEPARATOR_DASHES = new RegExp('\\s+[-' + _c(0x2013) + _c(0x2014) + ']+\\s+', 'g');   // " - " / " -- " read as words
  var _respellRules = null;   // built on first use from SPOKEN_RESPELL, so an edit to the table needs no other change
  function _rules() {
    if (_respellRules) return _respellRules;
    _respellRules = Object.keys(SPOKEN_RESPELL).map(function (k) {
      return { re: new RegExp('(?<![A-Za-z0-9_])' + _escRe(k.replace(CURLY_APOSTROPHES, "'")) + '(?![A-Za-z0-9_])', 'gi'), to: SPOKEN_RESPELL[k] };
    });
    return _respellRules;
  }

  // The text a voice is actually handed: pictographs and symbols dropped (the on-screen snail must never be voiced; an
  // explicit `tts` used to reach the voice untouched), " - " separators dropped, then the respell table applied.
  // Display text elsewhere is never changed. Pure; never throws.
  function speakable(text) {
    var t = String(text == null ? '' : text)
      .replace(SYMBOLS, ' ')
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')   // surrogate-pair emoji
      .replace(CURLY_APOSTROPHES, "'")
      .replace(SEPARATOR_DASHES, ' ');
    var rules = _rules();
    for (var i = 0; i < rules.length; i++) t = t.replace(rules[i].re, rules[i].to);
    return t.replace(/\s{2,}/g, ' ').trim();
  }

  var NEURAL_WAIT_MS = 2900;  // Mimic gives up on a phrase at 2.5 s (neuralVoice.js); this is the renderer's own backstop
  var NEURAL_TEST_WAIT_MS = 12900;   // a ▶ Test waits on purpose (Mimic's own limit for it is 12 s)

  // Ask Mimic for the phrase in `choice`'s engine and hand back an <audio> element ready to .play(), or null for
  // ANY problem (no bridge, no answer in time, empty audio) — the caller then speaks with the Windows voice.
  // `test` true is a person pressing a sample button: a longer wait, because Kokoro can take several seconds.
  function neuralAudio(text, rate, choice, mimic, test) {
    mimic = mimic || root.mimic;
    if (!choice || choice.engine === 'windows' || !mimic || !mimic.voiceSynth) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var late = false;
      var timer = setTimeout(function () { late = true; resolve(null); }, test ? NEURAL_TEST_WAIT_MS : NEURAL_WAIT_MS);
      var ask, spec = { engine: choice.engine, voice: choice.voice, rate: rate };
      if (test) spec.test = true;
      try { ask = Promise.resolve(mimic.voiceSynth(String(text || ''), spec)); }
      catch (e) { clearTimeout(timer); resolve(null); return; }
      ask.then(function (buf) {
        if (late) return;
        clearTimeout(timer);
        if (!buf || !buf.byteLength) { resolve(null); return; }
        try {
          var url = root.URL.createObjectURL(new root.Blob([buf], { type: 'audio/wav' }));
          var a = new root.Audio(url);
          var free = function () { try { root.URL.revokeObjectURL(url); } catch (e) { void e; } };
          a.addEventListener('ended', free); a.addEventListener('error', free);
          resolve(a);
        } catch (e) { resolve(null); }
      }, function () { if (!late) { clearTimeout(timer); resolve(null); } });
    });
  }

  var _sampleAudio = null;   // what a sample button is playing now, so the next press replaces it

  function _sampleWindows(text, packs, cfg, packId) {
    if (!root.speechSynthesis) return false;
    var v = pick(packs, cfg, packId, root.speechSynthesis.getVoices());
    var u = new root.SpeechSynthesisUtterance(String(text || ''));
    if (v.voice) u.voice = v.voice;
    u.rate = v.rate; u.pitch = v.pitch; u.volume = v.volume;
    try { root.speechSynthesis.cancel(); } catch (e) { void e; }
    root.speechSynthesis.speak(u);
    return true;
  }

  // Speak `text` once with the picked settings (a sample button). Cancels what is being said first. With a
  // downloaded engine picked it plays that voice, and any trouble falls back to the Windows one.
  function sample(text, packs, cfg, packId) {
    text = speakable(text);   // the same words a real callout would be spoken with
    var m = root.mimic;
    if (m && m.voiceStatus && m.voiceSynth) {
      if (_sampleAudio) { try { _sampleAudio.pause(); } catch (e) { void e; } _sampleAudio = null; }
      Promise.resolve(m.voiceStatus()).then(function (st) {
        var choice = chooseEngine(cfg, st);
        if (choice.engine === 'windows') return _sampleWindows(text, packs, cfg, packId);
        return neuralAudio(text, pick(packs, cfg, packId, []).rate, choice, undefined, true).then(function (a) {
          if (!a) return _sampleWindows(text, packs, cfg, packId);
          _sampleAudio = a;
          a.volume = pick(packs, cfg, packId, []).volume;
          return a.play().catch(function () { _sampleWindows(text, packs, cfg, packId); });
        });
      }, function () { _sampleWindows(text, packs, cfg, packId); });
      return true;
    }
    return _sampleWindows(text, packs, cfg, packId);
  }

  var api = { pick: pick, sample: sample, chooseEngine: chooseEngine, neuralAudio: neuralAudio, speakable: speakable, SPOKEN_RESPELL: SPOKEN_RESPELL, DEFAULT_RATE: DEFAULT_RATE, DEFAULT_PITCH: DEFAULT_PITCH, NEURAL_WAIT_MS: NEURAL_WAIT_MS, NEURAL_TEST_WAIT_MS: NEURAL_TEST_WAIT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WPVoice = api;
})(typeof window !== 'undefined' ? window : this);
