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
// A trigger's own `voice_pack` outranks all of that for that one callout: the pack as shipped.
// A named voice that is not installed falls back to the next fragment, then to the default voice —
// the pack's rate and pitch still apply, so "Herald" is slower and lower even on a bare PC.
(function (root) {
  'use strict';
  var DEFAULT_RATE = 1.05, DEFAULT_PITCH = 1;   // what every callout used before voice packs

  function _num(v, lo, hi) { v = Number(v); return (isFinite(v) && v >= lo && v <= hi) ? v : null; }

  // → { voice: SpeechSynthesisVoice|null, rate, pitch, pack: id }
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
    return { voice: voice, rate: rate, pitch: pitch, pack: pack ? pack.id : 'default' };
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

  var NEURAL_WAIT_MS = 2900;   // Mimic gives up on a phrase at 2.5 s (neuralVoice.js); this is the renderer's own backstop
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
    u.rate = v.rate; u.pitch = v.pitch; u.volume = 1;
    try { root.speechSynthesis.cancel(); } catch (e) { void e; }
    root.speechSynthesis.speak(u);
    return true;
  }

  // Speak `text` once with the picked settings (a sample button). Cancels what is being said first. With a
  // downloaded engine picked it plays that voice, and any trouble falls back to the Windows one.
  function sample(text, packs, cfg, packId) {
    var m = root.mimic;
    if (m && m.voiceStatus && m.voiceSynth) {
      if (_sampleAudio) { try { _sampleAudio.pause(); } catch (e) { void e; } _sampleAudio = null; }
      Promise.resolve(m.voiceStatus()).then(function (st) {
        var choice = chooseEngine(cfg, st);
        if (choice.engine === 'windows') return _sampleWindows(text, packs, cfg, packId);
        return neuralAudio(text, pick(packs, cfg, packId, []).rate, choice, undefined, true).then(function (a) {
          if (!a) return _sampleWindows(text, packs, cfg, packId);
          _sampleAudio = a;
          return a.play().catch(function () { _sampleWindows(text, packs, cfg, packId); });
        });
      }, function () { _sampleWindows(text, packs, cfg, packId); });
      return true;
    }
    return _sampleWindows(text, packs, cfg, packId);
  }

  var api = { pick: pick, sample: sample, chooseEngine: chooseEngine, neuralAudio: neuralAudio, DEFAULT_RATE: DEFAULT_RATE, DEFAULT_PITCH: DEFAULT_PITCH, NEURAL_WAIT_MS: NEURAL_WAIT_MS, NEURAL_TEST_WAIT_MS: NEURAL_TEST_WAIT_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WPVoice = api;
})(typeof window !== 'undefined' ? window : this);
