// Quiet mode split (Hitya 2026-09-11): "quiet mode should separate between
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
