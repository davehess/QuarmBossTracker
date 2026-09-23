// Quiet mode split (the guild lead, 2026-09-11): "quiet mode should separate between
// muted and not seeing overlays at all. two options and the current mode
// should just mute."
//
// Before this, cfg.quietMode hid every overlay and silenced NOTHING — voice
// fires from the hidden trigger window — so the old label ("hide HUD + TTS")
// was wrong in both directions. Now:
//   cfg.quietMode    = MUTE: no speech, no sounds, overlays unchanged
//   cfg.hideOverlays = hide every overlay, uploads and voice unchanged
// Mute reaches renderers as one boolean (wp-mute) and is checked at the three
// places that make noise. Text assertions are over comment-stripped source.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { stripJs } from './_source-slice.js';

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const main     = stripJs(read('apps/mimic/main.js'));
const preload  = stripJs(read('apps/mimic/preload.js'));
const settings = read('apps/mimic/settings.html');
const RENDERERS = ['apps/mimic/triggers.html', 'apps/mimic/chchain.html', 'apps/mimic/charm.html'];

// Pull one top-level function out of a source string by its header.
function fnSource(src, header) {
  const i = src.indexOf(header);
  expect(i, `${header} present`).toBeGreaterThan(-1);
  const j = src.indexOf('\n}', i);
  return src.slice(i, j + 2);
}

// BEHAVIOUR, not text. The old "and still flashes" check only proved a flash()
// function EXISTED — it passed the whole time fire() returned before calling
// it under Mute, because the trigger window's own gate still read
// `enableTriggerTts && !quietMode` (a member, 2026-09-23: "Mute Mimic" vs
// "Trigger alerts speak out loud — which one works and which doesn't?").
// This runs the real applyTtsStatus / fire / fireBlind with stubbed side effects.
describe('triggers.html: Mute silences, it does not hide (run, not read)', () => {
  const T = read('apps/mimic/triggers.html');
  const cut = (start) => { const i = T.indexOf(start); expect(i, start).toBeGreaterThan(-1);
                           const j = T.indexOf('\n  }', i); return T.slice(i, j + 4); };
  const mk = () => new Function(`
    const calls = []; let muted = false;
    const el = { classList: { toggle(){}, remove(){} } };
    function flash(x){ calls.push('flash'); }
    function _wpMutedNow(){ return muted; }
    function speak(x){ if (_wpMutedNow()) return; calls.push('speak'); }
    function playSound(u){ if (!u || _wpMutedNow()) return; calls.push('sound'); }
    function showFeedback(){} function pinSticky(){} function _speakable(s){ return s; }
    ${cut('  let alertsEnabled = true;')}
    ${cut('  function fire(t){')}
    ${cut('  function fireBlind(e){')}
    return { calls, applyTtsStatus, fire, fireBlind, mute: (m) => { muted = m; } };
  `)();
  const ENRAGE = { text: 'ENRAGE - Guard Sklinus', tts: 'Enrage on.', sound: 'x.wav' };

  it('Mute on: the trigger alert still FLASHES, with no speech and no sound', () => {
    const h = mk();
    h.applyTtsStatus({ enableTriggerTts: true, quietMode: true }); h.mute(true);
    h.fire(ENRAGE);
    expect(h.calls).toEqual(['flash']);
  });
  it('Mute off: flash, speech and sound', () => {
    const h = mk();
    h.applyTtsStatus({ enableTriggerTts: true, quietMode: false });
    h.fire(ENRAGE);
    expect(h.calls).toEqual(['flash', 'speak', 'sound']);
  });
  it('Trigger alerts off: nothing at all — that switch is the whole trigger overlay', () => {
    const h = mk();
    h.applyTtsStatus({ enableTriggerTts: false, quietMode: false });
    h.fire(ENRAGE);
    expect(h.calls).toEqual([]);
  });
  it('blind callouts follow the same rule under Mute: flash, no speech', () => {
    const h = mk();
    h.applyTtsStatus({ enableTriggerTts: false, quietMode: true }); h.mute(true);
    h.fireBlind({ kind: 'blind_selfhit', text: 'Blinded' });
    expect(h.calls).toEqual(['flash']);
  });
});

// Every writer of cfg.quietMode must broadcast it. Renderers learn Mute ONLY from
// the wp-mute broadcast, which used to be sent from the Settings save alone — so
// the tray's Quiet mode and the first-run screen's toggle changed the setting
// without muting a single overlay (the CH-chain and charm voices never heard).
describe('every quietMode write reaches the renderers', () => {
  it('each assignment is followed by _broadcastMute(cfg) in the same handler', () => {
    const writes = [...main.matchAll(/cfg\.quietMode = [^;]+;/g)];
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (const w of writes) {
      const after = main.slice(w.index, w.index + 400);
      expect(after, main.slice(w.index, w.index + 80)).toMatch(/_broadcastMute\(cfg\)/);
    }
  });
});

// Tray ↔ Settings parity (CLAUDE.md rule): "Don't show any overlays" was
// Settings-only (a member, 2026-09-23). The tray drives the SAME flag through
// the SAME apply path, never a parallel one.
describe('tray parity: No overlays', () => {
  it('the tray writes cfg.hideOverlays and applies it with applyAllVisibility', () => {
    expect(main).toMatch(/cfg\.hideOverlays = mi\.checked; saveConfig\(cfg\);\s*applyAllVisibility\(\);/);
  });
});

describe('hideOverlays owns visibility; quietMode no longer does', () => {
  it('every overlay gate reads hideOverlays and none read quietMode', () => {
    const gates = main.match(/const shouldShow = unlocked \|\|[^\n]*_eqGateOk\(cfg\)\)/g) || [];
    expect(gates.length).toBeGreaterThanOrEqual(16);
    for (const g of gates) { expect(g).toMatch(/!cfg\.hideOverlays/); expect(g).not.toMatch(/quietMode/); }
    expect(main).not.toMatch(/!cfg\.quietMode &&/);
  });

  it('_overlayWanted: overlays-off frees a window, mute alone does not, the trigger window survives both', () => {
    const src = fnSource(main, 'function _overlayWanted(cfg, e) {');
    const wanted = new Function('_overlayForcedOn', '_eqGateOk', src + '\nreturn _overlayWanted;')(() => false, () => true);
    const hud = { key: 'hud', flag: 'showHud' }, trig = { key: 'trigger', flag: 'enableTriggerTts' };
    expect(wanted({ showHud: true }, hud)).toBe(true);
    expect(wanted({ showHud: true, hideOverlays: true }, hud)).toBe(false);
    expect(wanted({ showHud: true, quietMode: true }, hud)).toBe(true);
    expect(wanted({ enableTriggerTts: true, hideOverlays: true, quietMode: true }, trig)).toBe(true);
  });

  it('the freed-window log names the new switch, the status export carries both, and the tray tooltip says which is on', () => {
    expect(main).toMatch(/cfg\.hideOverlays \? 'overlays are switched off'/);
    expect(main).toMatch(/quietMode: !!cfg\.quietMode,\s*hideOverlays: !!cfg\.hideOverlays,/);
    expect(main).toMatch(/s\.quietMode \? ' · Muted' : ''/);
    expect(main).toMatch(/s\.hideOverlays \? ' · Overlays off' : ''/);
    expect(main).not.toMatch(/enabled: !s\.quietMode/);
  });
});

describe('mute reaches every place that makes noise', () => {
  it('main broadcasts wp-mute on every config save', () => {
    expect(main).toMatch(/function _broadcastMute\(cfg\) \{\s*const muted = !!\(cfg && cfg\.quietMode\);/);
    expect(main).toMatch(/win\.webContents\.send\('wp-mute', muted\)/);
    expect(main).toMatch(/saveConfig\(merged\);\s*_broadcastMute\(merged\);/);
  });

  it('preload caches it, reads it once at load, and exposes isMuted()', () => {
    expect(preload).toMatch(/ipcRenderer\.on\('wp-mute', function \(_e, on\) \{ _wpMuted = !!on; \}\);/);
    expect(preload).toMatch(/invoke\('get-config'\)\.then\(function \(c\) \{ if \(c\) _wpMuted = !!c\.quietMode; \}\)/);
    expect(preload).toMatch(/isMuted:\s*\(\) => _wpMuted,/);
  });

  for (const f of RENDERERS) {
    it(`${path.basename(f)}: _wpMutedNow() is true only when the bridge says so, and gates speech`, () => {
      const src = stripJs(read(f));
      // The helper is one line by design (it is copied verbatim into three files).
      const hi = src.indexOf('function _wpMutedNow(){'); expect(hi, 'helper present').toBeGreaterThan(-1);
      const helper = src.slice(hi, src.indexOf('\n', hi));
      const run = (win) => new Function('window', helper + '\nreturn _wpMutedNow();')(win);
      expect(run({ mimic: { isMuted: () => true } })).toBe(true);
      expect(run({ mimic: { isMuted: () => false } })).toBe(false);
      expect(run({})).toBe(false);
      expect(run({ mimic: { isMuted: () => { throw new Error('bridge gone'); } } })).toBe(false);
      // The check sits at the top of the function that speaks.
      const speaks = src.match(/function speak(?:Gap)?\([^)]*\)\{?\s*\{?[^\n]*\n[^\n]*/);
      expect(speaks, 'a speak function exists').toBeTruthy();
      expect(speaks[0]).toMatch(/_wpMutedNow\(\)\) return;/);
    });
  }

  it('triggers.html also mutes sound files, and still flashes (flash is a separate call)', () => {
    const src = stripJs(read('apps/mimic/triggers.html'));
    expect(src).toMatch(/function playSound\(url\)\{\s*if\(!url \|\| _wpMutedNow\(\)\) return;/);
    expect(src).toMatch(/function flash\(text\)\{/);
  });
});

describe('Settings shows the two switches and round-trips both', () => {
  it('two checkboxes, honest labels', () => {
    expect(settings).toMatch(/<input id="quietMode" type="checkbox" \/>\s*<label for="quietMode">🔇 Mute Mimic/);
    expect(settings).toMatch(/<input id="hideOverlays" type="checkbox" \/>\s*<label for="hideOverlays">🙈 Don't show any overlays/);
    expect(settings).not.toMatch(/hide HUD \+ TTS/);
  });
  it('loads and saves hideOverlays next to quietMode', () => {
    expect(settings).toMatch(/getElementById\('hideOverlays'\)\.checked\s*=\s*!!c\.hideOverlays;/);
    expect(settings).toMatch(/hideOverlays:\s*document\.getElementById\('hideOverlays'\)\.checked,/);
  });
});
