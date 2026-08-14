// Overlay windows are created when enabled and freed when not.
//
// WHY (Hitya, 2026-08-04): "what causes each overlay to take up at least 80
// MB of ram? especially when they're all in the off state". Each Electron
// BrowserWindow is its own Chromium renderer — 80 MB resident before it paints
// anything, which is the floor Uilnayar measured — and Mimic's boot created ten
// of them unconditionally, ignoring every cfg.show* pref. Call it 800 MB of
// renderers for overlays that were switched off.
//
// The failure mode this file is really guarding is the OPPOSITE one: lazy
// creation that hides an overlay the user asked for. An overlay that eats RAM
// is annoying; an overlay that will not appear when you toggle it on is broken.
// So most of what follows is about the paths that show an overlay PAST its own
// pref — setup mode, unlock-to-place, hide-all restore, blind mode — each of
// which must still get a real window.
//
// Source-sliced (test/_source-slice.js): main.js can't be require()d without
// Electron, so we eval the shipped table + the two lifecycle functions against
// fake windows. Rename or delete them and this goes red instead of passing
// against a stale copy.
//
// Run: npx vitest run test/overlay-lifecycle.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const MAIN = path.join(ROOT, 'apps', 'mimic', 'main.js');
const src = readSource(MAIN);

// The shipped lifecycle block: the table, _overlayForcedOn, and both halves.
const block = sliceBlock(src, 'const _OVERLAY_WINDOWS = [', '// Convenience: refresh every overlay');

// main.js's module-level window bindings and the creator that fills each one.
// Order matches _OVERLAY_WINDOWS; a mismatch is caught below.
const PAIRS = [
  // The Dock leads the table: it hosts other overlays as iframe panes, and a
  // docked overlay's own window is REAPED (not hidden), so the dock has to
  // exist before anything can be docked into it.
  ['dockWindow',      'createDockWindow'],
  ['overlayWindow',   'createOverlayWindow'],
  ['triggerWindow',   'createTriggerOverlay'],
  ['charmWindow',     'createCharmOverlay'],
  ['petsWindow',      'createPetsOverlay'],
  ['mobInfoWindow',   'createMobInfoOverlay'],
  ['buffQueueWindow', 'createBuffQueueOverlay'],
  ['whoWindow',       'createWhoOverlay'],
  ['melodyWindow',    'createMelodyOverlay'],
  ['zealWindow',      'createZealHealthOverlay'],
  ['threatWindow',    'createThreatMeterOverlay'],
  ['chChainWindow',   'createChChainOverlay'],
  ['tankWindow',      'createTankOverlay'],
  ['extTargetWindow', 'createExtTargetOverlay'],
  ['commandWindow',   'createCommandOverlay'],
  ['popRaidWindow',   'createPopRaidOverlay'],
];

// Stand up the sliced code over fake windows. `alive` seeds windows that
// already exist (i.e. "before" state); everything else starts null.
function harness({ cfg = {}, setupMode = false, hideAll = false, blind = [], singleSetup = [], alive = [], eqRunning = true } = {}) {
  const decls = PAIRS.map(([v, c]) => `
    let ${v} = null;
    function ${c}() { ${v} = __mkWin('${v}'); __created.push('${v}'); }
  `).join('\n');

  const prelude = `
    const __created = [], __destroyed = [], __log = [];
    const __cfg = ${JSON.stringify(cfg)};
    function loadConfig() { return __cfg; }
    function appendAgentLog(s) { __log.push(s); }
    let setupMode = ${JSON.stringify(setupMode)};
    let _hideAllActive = ${JSON.stringify(hideAll)};
    const __blind = ${JSON.stringify(blind)};
    function _blindForceOpen(k) { return __blind.includes(k); }
    let _eqRunning = ${JSON.stringify(eqRunning)};
    function _eqGateOk(c) { if (c.hideOverlaysWhenEqDown === false) return true; return _eqRunning; }
    const __single = new Set(${JSON.stringify(singleSetup)});
    function _inSingleSetup(w) { return !!w && __single.has(w.name); }
    function __mkWin(name) {
      return { name, gone: false, isDestroyed() { return this.gone; },
               destroy() { this.gone = true; __destroyed.push(name); } };
    }
    ${decls}
    for (const n of ${JSON.stringify(alive)}) {
      switch (n) { ${PAIRS.map(([v]) => `case '${v}': ${v} = __mkWin('${v}'); break;`).join(' ')} }
    }
    function __live() { return [${PAIRS.map(([v]) => v).join(', ')}].filter(Boolean).map(w => w.name); }
  `;

  return evalBlock(prelude + '\n' + block, [
    '_OVERLAY_WINDOWS', '_overlayForcedOn', '_overlayWanted', '_materializeEnabledOverlays',
    '_reapDisabledOverlays', '__created', '__destroyed', '__log', '__live',
  ]);
}

describe('the lifecycle table covers every overlay', () => {
  it('has an entry per window, in the same order main.js declares them', () => {
    const h = harness();
    expect(h._OVERLAY_WINDOWS).toHaveLength(PAIRS.length);
    // Every entry must actually create the window its getter reads — a
    // copy-paste slip here (getter for A, creator for B) would make one
    // overlay permanently uncreatable and another permanently unfreeable.
    for (const e of h._OVERLAY_WINDOWS) {
      expect(e.get(), `${e.key} starts with no window`).toBeFalsy();
      e.create();
      expect(e.get(), `${e.key}: create() must fill the getter's binding`).toBeTruthy();
      e.drop();
      expect(e.get(), `${e.key}: drop() must null the binding, not leave a destroyed window`).toBeFalsy();
    }
  });

  it('covers every flag the hide-all hotkey restores', () => {
    // toggleHideAllOverlays snapshots _HIDEALL_FLAGS and flips them back. A
    // flag it can restore with no lifecycle entry is an overlay the hotkey
    // turns "on" that can never reappear.
    //
    // ONE deliberate exception, and it is the whole point of it existing:
    // 'showTriggerOverlay' is a VISIBILITY-only flag with no window lifecycle.
    // The trigger overlay's window is gated on 'enableTriggerTts', and listing
    // THAT here is what used to make hide-all destroy the window and take
    // speechSynthesis with it - callouts and Rehearse went silent with no error
    // (2026-08-13). Hide-all must reach visibility, never existence.
    const VISIBILITY_ONLY = new Set(['showTriggerOverlay']);
    const hideAll = sliceBlock(src, 'const _HIDEALL_FLAGS = [', '\n];');
    const flags = new Function('return ' + hideAll.slice(hideAll.indexOf('[')))();
    const known = new Set(harness()._OVERLAY_WINDOWS.map(e => e.flag));
    for (const f of flags) {
      if (VISIBILITY_ONLY.has(f)) continue;
      expect(known.has(f), `${f} has no _OVERLAY_WINDOWS entry`).toBe(true);
    }
    // The exception must stay an exception: a visibility-only flag has to be
    // honoured by an apply*Visibility(), or hide-all would do nothing at all.
    for (const f of VISIBILITY_ONLY) {
      expect(flags.includes(f), `${f} missing from _HIDEALL_FLAGS`).toBe(true);
      expect(src.includes(`cfg.${f}`), `${f} is never read`).toBe(true);
    }
    // And the window-lifecycle flag must NOT be in the hide-all list.
    expect(flags.includes('enableTriggerTts'),
      'enableTriggerTts back in _HIDEALL_FLAGS - hide-all would destroy the TTS window').toBe(false);
  });

  it('boot no longer creates overlays unconditionally', () => {
    // The regression this whole change removes. If these come back, so does
    // the ~850 MB.
    const boot = src.slice(src.indexOf('app.whenReady().then(async () => {'));
    const stanza = boot.slice(0, boot.indexOf('startZealCapture();'));
    expect(stanza).toMatch(/_materializeEnabledOverlays\(\)/);
    expect(stanza, 'boot must not hard-create overlay windows').not.toMatch(/^\s*create\w+Overlay\(\);$/m);
    expect(stanza).not.toMatch(/^\s*createOverlayWindow\(\);$/m);
  });

  it('applyAllVisibility materializes BEFORE applying and reaps AFTER', () => {
    // Order is load-bearing: every apply*Visibility() starts `if (!win) return`,
    // so materializing after them would apply to nothing; reaping before them
    // would free a window without ever asking it to hide.
    const fn = sliceBlock(src, 'function applyAllVisibility() {', '\n}');
    expect(fn.indexOf('_materializeEnabledOverlays()')).toBeGreaterThan(-1);
    expect(fn.indexOf('_materializeEnabledOverlays()')).toBeLessThan(fn.indexOf('applyOverlayVisibility()'));
    expect(fn.indexOf('_reapDisabledOverlays()')).toBeGreaterThan(fn.indexOf('applyPopRaidVisibility()'));
  });

  it('unlock-to-place builds the windows it is about to show', () => {
    // applyOverlayInteractivity() force-shows every overlay when unlocked, but
    // it iterates _overlayEntries() — existing windows only. Without this,
    // "unlock to move" silently skips every overlay whose pref is off.
    const fn = sliceBlock(src, 'function applyOverlayInteractivity() {', 'const locked =');
    expect(fn).toMatch(/_materializeEnabledOverlays\(\)/);
  });
});

describe('materialize: an overlay that is on gets a window', () => {
  it('creates exactly the enabled overlays and nothing else', () => {
    const h = harness({ cfg: { showHud: true, showMobInfo: true, overlaysLocked: true } });
    h._materializeEnabledOverlays();
    expect(h.__live().sort()).toEqual(['mobInfoWindow', 'overlayWindow']);
  });

  it('creates nothing when every overlay is off', () => {
    const h = harness({ cfg: { overlaysLocked: true } });
    h._materializeEnabledOverlays();
    expect(h.__live()).toEqual([]);
    expect(h.__created).toEqual([]);
  });

  it('is idempotent — never rebuilds a window that exists', () => {
    const h = harness({ cfg: { showHud: true, overlaysLocked: true }, alive: ['overlayWindow'] });
    h._materializeEnabledOverlays();
    h._materializeEnabledOverlays();
    expect(h.__created, 'an existing window must not be recreated').toEqual([]);
  });

  it('builds ALL of them in setup mode', () => {
    const h = harness({ cfg: { overlaysLocked: true }, setupMode: true });
    h._materializeEnabledOverlays();
    expect(h.__live()).toHaveLength(PAIRS.length);
  });

  it('builds ALL of them while unlocked for placement', () => {
    const h = harness({ cfg: { overlaysLocked: false } });
    h._materializeEnabledOverlays();
    expect(h.__live()).toHaveLength(PAIRS.length);
  });

  it('does NOT keep windows alive just because hide-all is active', () => {
    // My first cut spared hide-all, reasoning that the flags are off only until
    // the hotkey flips back. Wrong: cfg.hideAllActive PERSISTS across restarts,
    // so anyone who used the hotkey once got all fifteen renderers rebuilt at
    // every boot and never freed — the exact opposite of the point.
    const h = harness({ cfg: { overlaysLocked: true }, hideAll: true });
    h._materializeEnabledOverlays();
    expect(h.__live()).toEqual([]);
  });

  it('rebuilds from the RESTORED flags when the hotkey un-hides', () => {
    // What makes the above safe. toggleHideAllOverlays() puts the snapshot back
    // into cfg and saves BEFORE calling applyAllVisibility(), so materialize
    // sees the restored flags — no window has to be kept warm for it.
    const restored = harness({ cfg: { showHud: true, showCharm: true, overlaysLocked: true } });
    restored._materializeEnabledOverlays();
    expect(restored.__live().sort()).toEqual(['charmWindow', 'overlayWindow']);
  });

  it('the hotkey saves the restored flags BEFORE applying visibility', () => {
    // Load-bearing order: reversed, materialize would read the all-false config
    // and the hotkey could never unhide anything.
    const fn = sliceBlock(src, 'function toggleHideAllOverlays() {', '\n}');
    expect(fn.indexOf('saveConfig(cfg);')).toBeLessThan(fn.indexOf('applyAllVisibility();'));
    // …and the restore that runs before that save. (Its own semantics —
    // never clobbering a choice made while hidden — live in
    // test/hide-all-state.test.js.)
    expect(fn).toMatch(/for \(const f of _HIDEALL_FLAGS\) if \(!cfg\[f\]\) cfg\[f\] = !!_hideAllPrev\[f\];/);
  });

  it('builds the blind-mode set even with their prefs off', () => {
    const h = harness({ cfg: { overlaysLocked: true }, blind: ['mobinfo', 'charm', 'pets', 'triggers'] });
    h._materializeEnabledOverlays();
    expect(h.__live().sort()).toEqual(['charmWindow', 'mobInfoWindow', 'petsWindow', 'triggerWindow']);
  });

  it('the trigger entry answers to the blind key main.js actually uses', () => {
    // _BLIND_FORCED_KEYS says 'triggers'; _overlayEntries() calls the same
    // window 'trigger'. The entry carries both or blind mode silently loses
    // its trigger overlay.
    const e = harness()._OVERLAY_WINDOWS.find(x => x.key === 'trigger');
    expect(e.blind).toBe('triggers');
  });

  it('survives a creator that throws instead of taking the whole pass down', () => {
    const h = harness({ cfg: { showHud: true, showWho: true, overlaysLocked: true } });
    const hud = h._OVERLAY_WINDOWS.find(e => e.key === 'hud');
    hud.create = () => { throw new Error('BrowserWindow blew up'); };
    h._materializeEnabledOverlays();
    expect(h.__live(), 'the other overlays still come up').toEqual(['whoWindow']);
    expect(h.__log.join('')).toMatch(/could not create hud/);
  });
});

describe('reap: an overlay that is off hands its renderer back', () => {
  it('destroys the window and nulls the binding', () => {
    const h = harness({ cfg: { showHud: false, overlaysLocked: true }, alive: ['overlayWindow'] });
    h._reapDisabledOverlays();
    expect(h.__destroyed).toEqual(['overlayWindow']);
    // Nulling matters as much as destroying: a leftover destroyed window reads
    // as "exists" to the materializer, so the overlay could never come back.
    expect(h.__live()).toEqual([]);
  });

  it('keeps every overlay whose pref is on', () => {
    const h = harness({
      cfg: { showHud: true, showWho: false, overlaysLocked: true },
      alive: ['overlayWindow', 'whoWindow'],
    });
    h._reapDisabledOverlays();
    expect(h.__live()).toEqual(['overlayWindow']);
  });

  it('NEVER frees the trigger overlay for a hidden visual (#97)', () => {
    // ✕ on the trigger overlay clears showTriggerOverlay only — TTS keeps
    // firing from the hidden window. Freeing it there would silently kill
    // every spoken callout.
    const h = harness({
      cfg: { enableTriggerTts: true, showTriggerOverlay: false, overlaysLocked: true },
      alive: ['triggerWindow'],
    });
    h._reapDisabledOverlays();
    expect(h.__live()).toEqual(['triggerWindow']);
  });

  it('frees the trigger overlay when TTS itself is switched off', () => {
    const h = harness({ cfg: { enableTriggerTts: false, overlaysLocked: true }, alive: ['triggerWindow'] });
    h._reapDisabledOverlays();
    expect(h.__live()).toEqual([]);
  });

  it('frees nothing in setup mode', () => {
    const h = harness({ cfg: { overlaysLocked: true }, setupMode: true, alive: PAIRS.map(p => p[0]) });
    h._reapDisabledOverlays();
    expect(h.__destroyed).toEqual([]);
  });

  it('frees nothing while unlocked for placement', () => {
    const h = harness({ cfg: { overlaysLocked: false }, alive: PAIRS.map(p => p[0]) });
    h._reapDisabledOverlays();
    expect(h.__destroyed).toEqual([]);
  });

  it('DOES free them under hide-all — that state persists across restarts', () => {
    // The counterpart to the materialize case above: hide-all means "I want
    // these gone", and cfg.hideAllActive survives a restart, so holding the
    // renderers would be holding them indefinitely.
    const h = harness({ cfg: { overlaysLocked: true }, hideAll: true, alive: PAIRS.map(p => p[0]) });
    h._reapDisabledOverlays();
    expect(h.__destroyed).toHaveLength(PAIRS.length);
  });

  it('spares an overlay the user is placing via "Setup THIS"', () => {
    const h = harness({
      cfg: { overlaysLocked: true },
      singleSetup: ['charmWindow'],
      alive: ['charmWindow', 'petsWindow'],
    });
    h._reapDisabledOverlays();
    expect(h.__live()).toEqual(['charmWindow']);
  });

  it('spares the blind-mode set', () => {
    const h = harness({
      cfg: { overlaysLocked: true }, blind: ['mobinfo'],
      alive: ['mobInfoWindow', 'whoWindow'],
    });
    h._reapDisabledOverlays();
    expect(h.__live()).toEqual(['mobInfoWindow']);
  });

  it('bails out entirely if the config cannot be read', () => {
    // Reaping on a config read failure would free every overlay at once — with
    // no config in hand, "the flag is off" is not something we know.
    const oneOverlay = (loadCfg) => evalBlock(`
      const __destroyed = [], __log = [];
      ${loadCfg}
      function appendAgentLog(s) { __log.push(s); }
      let setupMode = false, _hideAllActive = false;
      function _blindForceOpen() { return false; }
      function _inSingleSetup() { return false; }
      function _overlayForcedOn() { return false; }
      function _overlayWanted(c, e) { return !!c[e.flag]; }
      let w = { name: 'x', isDestroyed: () => false, destroy() { __destroyed.push('x'); } };
      const _OVERLAY_WINDOWS = [{ key: 'x', flag: 'showX', get: () => w, create: () => {}, drop: () => { w = null; } }];
      ${sliceBlock(src, 'function _reapDisabledOverlays() {', '\n}')}
    `, ['_reapDisabledOverlays', '__destroyed']);

    const boom = oneOverlay(`function loadConfig() { throw new Error('config gone'); }`);
    boom._reapDisabledOverlays();
    expect(boom.__destroyed, 'an unreadable config must free nothing').toEqual([]);

    // Mutation guard: the identical overlay IS reaped once the config reads,
    // so the assertion above is about the throw and not about the fixture.
    const ok = oneOverlay(`function loadConfig() { return {}; }`);
    ok._reapDisabledOverlays();
    expect(ok.__destroyed).toEqual(['x']);
  });
});

describe('a hidden overlay holds no renderer', () => {
  // "we have a toggle in taskbar for 'Hide Overlays when Everquest is not
  // running', and we should adhere to that" (Hitya 2026-08-04). Existence
  // tracks VISIBILITY, not just the pref — which is where most of the saving
  // is, since EQ is closed most of the day.
  const RUNNING = { showHud: true, showCharm: true, overlaysLocked: true };

  it('builds the enabled set while EQ is running', () => {
    const h = harness({ cfg: RUNNING, eqRunning: true });
    h._materializeEnabledOverlays();
    expect(h.__live().sort()).toEqual(['charmWindow', 'overlayWindow']);
  });

  it('builds nothing while EQ is closed and the gate is on', () => {
    const h = harness({ cfg: RUNNING, eqRunning: false });
    h._materializeEnabledOverlays();
    expect(h.__live()).toEqual([]);
  });

  it('frees them when EQ goes away', () => {
    const h = harness({ cfg: RUNNING, eqRunning: false, alive: ['overlayWindow', 'charmWindow'] });
    h._reapDisabledOverlays();
    expect(h.__destroyed.sort()).toEqual(['charmWindow', 'overlayWindow']);
    expect(h.__log.join(''), 'the log says WHY, not just that it happened')
      .toMatch(/EverQuest is not running/);
  });

  it('keeps them when the user turned that gate OFF', () => {
    // hideOverlaysWhenEqDown === false means "always show", so always exist.
    const cfg = { ...RUNNING, hideOverlaysWhenEqDown: false };
    const h = harness({ cfg, eqRunning: false, alive: ['overlayWindow', 'charmWindow'] });
    h._reapDisabledOverlays();
    expect(h.__destroyed).toEqual([]);
  });

  it('frees them in quiet mode too — same argument', () => {
    const h = harness({ cfg: { ...RUNNING, quietMode: true }, alive: ['overlayWindow'] });
    h._reapDisabledOverlays();
    expect(h.__destroyed).toEqual(['overlayWindow']);
    expect(h.__log.join('')).toMatch(/quiet mode/);
  });

  it('NEVER frees the trigger overlay for the EQ gate or quiet mode', () => {
    // #97: TTS fires from the hidden window, and triggers.html polls the agent
    // itself — no window, no voice. Reaping it would trade a missed raid
    // callout for 35 MB at exactly the time nobody cares about 35 MB.
    for (const cfg of [
      { enableTriggerTts: true, overlaysLocked: true },                    // EQ down
      { enableTriggerTts: true, overlaysLocked: true, quietMode: true },
    ]) {
      const h = harness({ cfg, eqRunning: false, alive: ['triggerWindow'] });
      h._reapDisabledOverlays();
      expect(h.__live(), JSON.stringify(cfg)).toEqual(['triggerWindow']);
    }
  });

  it('still builds everything for placement while EQ is closed', () => {
    // Unlocking to position overlays before launching EQ is a normal thing to
    // do, and _eqGateOk is bypassed there for exactly that reason.
    const h = harness({ cfg: { overlaysLocked: false }, eqRunning: false });
    h._materializeEnabledOverlays();
    expect(h.__live()).toHaveLength(PAIRS.length);
  });

  it('materialize and reap agree about every case', () => {
    // They are the two halves of one predicate; if they ever disagreed, an
    // overlay would be created and destroyed on every visibility pass.
    const cases = [
      { cfg: RUNNING, eqRunning: true },
      { cfg: RUNNING, eqRunning: false },
      { cfg: { ...RUNNING, quietMode: true }, eqRunning: true },
      { cfg: { ...RUNNING, hideOverlaysWhenEqDown: false }, eqRunning: false },
      { cfg: { overlaysLocked: false }, eqRunning: false },
      { cfg: { enableTriggerTts: true, overlaysLocked: true }, eqRunning: false },
    ];
    for (const c of cases) {
      const h = harness(c);
      h._materializeEnabledOverlays();
      const built = h.__live().slice();
      h._reapDisabledOverlays();
      expect(h.__live(), JSON.stringify(c)).toEqual(built);
      expect(h.__destroyed, JSON.stringify(c)).toEqual([]);
    }
  });
});

describe('the round trip a user actually performs', () => {
  it('off → on → off leaves no stranded window and no stranded binding', () => {
    // Toggle everything off, confirm the renderers are gone, toggle two back
    // on, confirm they come back. This is the sequence that would expose a
    // one-way lifecycle (freed and never rebuildable).
    const on = harness({ cfg: { showHud: true, showCharm: true, showWho: true, overlaysLocked: true } });
    on._materializeEnabledOverlays();
    expect(on.__live().sort()).toEqual(['charmWindow', 'overlayWindow', 'whoWindow']);

    const off = harness({ cfg: { overlaysLocked: true }, alive: ['overlayWindow', 'charmWindow', 'whoWindow'] });
    off._reapDisabledOverlays();
    expect(off.__destroyed.sort()).toEqual(['charmWindow', 'overlayWindow', 'whoWindow']);
    expect(off.__live()).toEqual([]);
    // …and materializing on the SAME instance rebuilds only what is on again.
    off._materializeEnabledOverlays();
    expect(off.__live(), 'nothing comes back while the flags are still off').toEqual([]);

    const back = harness({ cfg: { showHud: true, overlaysLocked: true } });
    back._materializeEnabledOverlays();
    expect(back.__live()).toEqual(['overlayWindow']);
  });

  it('materialize then reap in one pass is stable — no create/destroy churn', () => {
    // applyAllVisibility() runs both on every EQ presence flip. If the two
    // disagreed about any overlay it would thrash a renderer per poll.
    const h = harness({ cfg: { showHud: true, enableTriggerTts: true, overlaysLocked: true } });
    h._materializeEnabledOverlays();
    h._reapDisabledOverlays();
    h._materializeEnabledOverlays();
    h._reapDisabledOverlays();
    expect(h.__created).toEqual(['overlayWindow', 'triggerWindow']);
    expect(h.__destroyed).toEqual([]);
  });
});
