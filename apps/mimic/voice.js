// voice.js — which speech voice, rate and pitch a spoken callout uses (the guild lead, 2026-10-14:
// "different voice packs"). Loaded by every page that speaks or lets you hear a sample (triggers.html,
// settings.html, welcome.html) so they cannot drift apart; the dashboard (served by the agent, not from
// this folder) carries its own few lines of the same rules.
//
// A VOICE PACK is a named preset { id, label, voices:[name fragments], rate, pitch }, served by the agent on
// GET /api/voice-packs. The player's choice lives in Mimic's config as cfg.voice:
//   { pack: 'herald', voiceName: 'Microsoft Zira Desktop', rate: 1.2, pitch: 0.9 }
// where voiceName / rate / pitch are optional hand overrides (null or absent = take the pack's).
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

  // Speak `text` once with the picked settings (a sample button). Cancels what is being said first.
  function sample(text, packs, cfg, packId) {
    if (!root.speechSynthesis) return false;
    var v = pick(packs, cfg, packId, root.speechSynthesis.getVoices());
    var u = new root.SpeechSynthesisUtterance(String(text || ''));
    if (v.voice) u.voice = v.voice;
    u.rate = v.rate; u.pitch = v.pitch; u.volume = 1;
    try { root.speechSynthesis.cancel(); } catch (e) { void e; }
    root.speechSynthesis.speak(u);
    return true;
  }

  var api = { pick: pick, sample: sample, DEFAULT_RATE: DEFAULT_RATE, DEFAULT_PITCH: DEFAULT_PITCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WPVoice = api;
})(typeof window !== 'undefined' ? window : this);
