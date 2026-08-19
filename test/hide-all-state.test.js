// Hide-all must stay distinguishable from "I turned this off".
//
// Uilnayar, 2026-08-04: "we should be able to see in the overlays section which
// ones were previously off but are hidden. Currently, when we hide the windows,
// it just sets everything to off."
//
// That is literally what toggleHideAllOverlays does — it writes every show*
// flag false and keeps the old values in a snapshot nobody could see. Once
// overlay windows became lazy, the ambiguity got worse: an overlay you hid and
// an overlay you disabled now look identical AND cost the same (nothing), with
// no way to tell which ones the hotkey is going to bring back.
//
// Two things are pinned here:
//   1. the snapshot rides `currentStatus()` so a UI can render a third state;
//   2. restoring never clobbers a choice made WHILE hidden.
//
// Run: npx vitest run test/hide-all-state.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const main  = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const agent = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'));

describe('the snapshot reaches the UI', () => {
  it('currentStatus ships hideAllActive and the snapshot', () => {
    const fn = sliceBlock(main, 'function currentStatus()', '\n}');
    expect(fn).toMatch(/hideAllActive: !!_hideAllActive,/);
    expect(fn).toMatch(/hideAllPrev: \(_hideAllActive && _hideAllPrev\) \? \{ \.\.\._hideAllPrev \} : null,/);
  });

  it('the snapshot is COPIED, not handed out by reference', () => {
    // currentStatus() is serialized to renderers many times a second. Handing
    // out the live object would let a consumer mutate the restore state.
    const fn = sliceBlock(main, 'function currentStatus()', '\n}');
    expect(fn).not.toMatch(/hideAllPrev: _hideAllPrev,/);
  });

  it('is null when hide-all is off, so a stale snapshot cannot paint HIDDEN', () => {
    const status = (active, prev) => evalBlock(`
      const _hideAllActive = ${JSON.stringify(active)};
      const _hideAllPrev = ${JSON.stringify(prev)};
      const out = {
        hideAllActive: !!_hideAllActive,
        hideAllPrev: (_hideAllActive && _hideAllPrev) ? { ..._hideAllPrev } : null,
      };
    `, ['out']).out;
    expect(status(true,  { showHud: true }).hideAllPrev).toEqual({ showHud: true });
    expect(status(false, { showHud: true }).hideAllPrev, 'released → nothing is hidden').toBeNull();
    expect(status(true,  null).hideAllPrev).toBeNull();
  });
});

describe('restore never overrides a choice made while hidden', () => {
  // The shipped restore branch, run against a config.
  function restore({ cfg, prev, flags }) {
    return evalBlock(`
      const _HIDEALL_FLAGS = ${JSON.stringify(flags)};
      const cfg = ${JSON.stringify(cfg)};
      const _hideAllPrev = ${JSON.stringify(prev)};
      ${sliceBlock(main, '    for (const f of _HIDEALL_FLAGS) if (!cfg[f]) cfg[f] = !!_hideAllPrev[f];', ';')}
    `, ['cfg']).cfg;
  }
  const FLAGS = ['showHud', 'showCharm', 'showWho'];

  it('brings back exactly what was on when you hid', () => {
    const r = restore({
      cfg:  { showHud: false, showCharm: false, showWho: false },
      prev: { showHud: true,  showCharm: false, showWho: true },
      flags: FLAGS,
    });
    expect(r).toMatchObject({ showHud: true, showCharm: false, showWho: true });
  });

  it('keeps an overlay the user switched ON while hidden', () => {
    // The bug a blanket Object.assign would have: turn Charm on while hidden,
    // release the hotkey, and it silently goes off again.
    const r = restore({
      cfg:  { showHud: false, showCharm: true, showWho: false },
      prev: { showHud: true,  showCharm: false, showWho: false },
      flags: FLAGS,
    });
    expect(r.showCharm, 'their later choice wins over the snapshot').toBe(true);
    expect(r.showHud, 'and the snapshot still restores everything else').toBe(true);
  });

  it('leaves flags that were off in BOTH places off', () => {
    const r = restore({
      cfg:  { showHud: false, showCharm: false, showWho: false },
      prev: { showHud: false, showCharm: false, showWho: false },
      flags: FLAGS,
    });
    expect(Object.values(r).every(v => v === false)).toBe(true);
  });

  it('the shipped code does not blanket-assign the snapshot', () => {
    const fn = sliceBlock(main, 'function toggleHideAllOverlays() {', '\n}');
    expect(fn, 'Object.assign is the clobbering version').not.toMatch(/Object\.assign\(cfg, _hideAllPrev\)/);
    expect(fn).toMatch(/for \(const f of _HIDEALL_FLAGS\) if \(!cfg\[f\]\) cfg\[f\] = !!_hideAllPrev\[f\];/);
  });
});

describe('the dashboard renders the third state', () => {
  const fn = sliceBlock(agent, 'function wpRefreshOverlayToggles() {', '\n}');

  it('labels a hidden-but-enabled overlay HIDDEN, not OFF', () => {
    expect(fn).toMatch(/b\.textContent = isOn \? 'ON' : \(wasOn \? 'HIDDEN' : 'OFF'\);/);
  });

  it('derives HIDDEN from the snapshot, not from hideAllActive alone', () => {
    // hideAllActive alone would paint every OFF overlay as HIDDEN — including
    // the ones the user genuinely disabled, which is the same ambiguity in
    // reverse.
    expect(fn).toMatch(/var wasOn = !isOn && !!hidPrev && !!hidPrev\[flagOf\[k\]\];/);
  });

  it('maps every row key to a real status flag', () => {
    // The dashboard's row keys and Mimic's cfg flags are different vocabularies
    // ('pet' vs showPets). A typo here paints a genuinely-hidden row as OFF —
    // the exact ambiguity this change exists to remove.
    const objLiteral = (decl) => {
      const at = fn.indexOf(decl);
      return fn.slice(at, fn.indexOf('};', at) + 1);
    };
    // Read the key→flag pairs textually; the `on` map's values reference `st`,
    // so neither literal can be eval'd here.
    const map = Object.fromEntries(
      [...objLiteral('var flagOf = {').matchAll(/(\w+): '(\w+)'/g)].map(m => [m[1], m[2]]),
    );
    const onKeys = [...objLiteral('var on = {').matchAll(/(\w+): !!st\./g)].map(m => m[1]);

    const rows = sliceBlock(agent, 'var WP_OVERLAY_ROWS = [', '\n];');
    const keys = [...rows.matchAll(/^\s*\['([a-zA-Z]+)',/gm)].map(m => m[1]);
    expect(keys.length).toBe(16);   // 15 overlays + the dock row (2026-08-19)
    expect(onKeys).toHaveLength(keys.length);
    for (const k of keys) {
      expect(map[k], `row '${k}' has no flag mapping`).toBeTruthy();
      expect(onKeys, `row '${k}' missing from the on-state map`).toContain(k);
      // …and the flag it names must be one currentStatus actually publishes,
      // or hidPrev[flag] is forever undefined and HIDDEN never renders.
      expect(main, `${map[k]} is not published by currentStatus`).toContain(`${map[k]}: !!cfg.${map[k]}`);
    }
  });

  it('the banner is a placeholder, not baked into the render string', () => {
    // morphInto is byte-compare innerHTML: a live count in the render string
    // would rewrite the whole Overlays section every poll.
    expect(agent).toMatch(/h \+= '<div id="wpHideAllBanner"><\/div>';/);
    expect(fn).toMatch(/document\.getElementById\('wpHideAllBanner'\)/);
  });

  it('clears the banner when hide-all is released', () => {
    // A banner that only ever gets set would stay on screen claiming overlays
    // are parked after they came back.
    expect(fn).toMatch(/: '';/);
  });
});
