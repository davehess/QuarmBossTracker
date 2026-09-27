// The instant charm break (the guild lead, 2026-09-27: "charm break needs to be as close to
// instant as possible, like EQLogParser"; a member on 2.7.3-beta.2: "still feels slightly behind.
// like 1 or 2 seconds"). The Charm overlay's call waited for a 500 ms poll behind a 400 ms cache,
// then a 600 ms kill guard. The agent now pushes the break down the /api/fires/wait long-poll the
// moment it reads the line; the Charm overlay speaks it, the trigger overlay skips it.
// Also: the ⇅ option that starts the trigger overlay's timers at the top.
//
// Run: npx vitest run test/charm-break-instant.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, AGENT_INDEX, ROOT, sliceBlock, stripJs, stripCss } from './_source-slice.js';

const agent = readSource(AGENT_INDEX);
const pushBlock = sliceBlock(agent, 'const _charmBreakInstantAt = new Map();', '  return true;\n}');
const fireForWeb = sliceBlock(agent, 'function _fireForWeb(o) {', '\n}\n');
const mimic = (f) => fs.readFileSync(path.join(ROOT, 'apps', 'mimic', f), 'utf8');

function harness({ suggested = null } = {}) {
  const pushed = [];
  // eslint-disable-next-line no-new-func
  const push = new Function('_pushOverlay', '_findSuggestedRow', '_suggestedHasTts',
    pushBlock + '\nreturn _pushCharmBreakInstant;')(
    (o) => pushed.push(o),
    () => suggested,
    (row) => !!(row && row.actions && row.actions[0] && row.actions[0].tts));
  return { push, pushed };
}
const T0 = 1_790_000_000_000;

describe('the agent pushes the break the moment the line is read', () => {
  it('own charm, live line: one charm fire, spoken by the Charm overlay', () => {
    const { push, pushed } = harness();
    expect(push('an eternal golem', 'an eternal golem', true, T0 - 800, T0)).toBe(true);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toEqual(expect.objectContaining({ charm: true, charm_key: 'an eternal golem', tts: 'charm break', charm_spoken: false, firedAt: T0 }));
  });

  it('not your charm, or an old line from a backfill: nothing', () => {
    const { push, pushed } = harness();
    expect(push('a golem', 'a golem', false, T0, T0)).toBe(false);
    expect(push('a golem', 'a golem', true, T0 - 60_000, T0)).toBe(false);
    expect(push('a golem', 'a golem', true, NaN, T0)).toBe(false);
    expect(pushed).toHaveLength(0);
  });

  it('once per pet per 4 s (the self line and a bystander line can both arrive), then again', () => {
    const { push, pushed } = harness();
    push('a golem', 'a golem', true, T0, T0);
    expect(push('a golem', 'a golem', true, T0 + 1000, T0 + 1000)).toBe(false);
    expect(push('a golem', 'a golem', true, T0 + 4500, T0 + 4500)).toBe(true);
    expect(pushed).toHaveLength(2);
  });

  it('with the "Your charm broke" suggested trigger on with TTS, the fire is marked already spoken', () => {
    const on = harness({ suggested: { enabled: true, actions: [{ type: 'text_overlay', tts: 'CHARM BREAK' }] } });
    on.push('a golem', 'a golem', true, T0, T0);
    expect(on.pushed[0].charm_spoken).toBe(true);
    const off = harness({ suggested: { enabled: false, actions: [{ type: 'text_overlay', tts: 'CHARM BREAK' }] } });
    off.push('a golem', 'a golem', true, T0, T0);
    expect(off.pushed[0].charm_spoken).toBe(false);
  });

  it('the long-poll carries the charm fields', () => {
    // eslint-disable-next-line no-new-func
    const f = new Function(fireForWeb + '\nreturn _fireForWeb;')();
    const w = f({ firedAt: 5, text: 'CHARM BREAK', charm: true, charm_key: 'a golem', charm_spoken: true });
    expect(w).toEqual(expect.objectContaining({ ts: 5, charm: true, charm_key: 'a golem', charm_spoken: true }));
    expect(f({ firedAt: 6, text: 'x' }).charm).toBe(false);
  });

  it('the charm-break handler calls it for own charms', () => {
    const h = stripJs(sliceBlock(agent, "    if (event.type === 'charm_break') {", "      return;\n    }"));
    expect(h).toContain("const wasSelfLine = String(event.pet || '').toLowerCase() === '__self__';");
    expect(h).toMatch(/const own = wasSelfLine \|\| \(!!ownerWas && String\(ownerWas\)\.toLowerCase\(\) === String\(this\.character \|\| ''\)\.toLowerCase\(\)\);\s*_pushCharmBreakInstant\(petKey,/);
  });
});

describe('the overlays', () => {
  const charm = stripJs(mimic('charm.html'));
  const triggers = stripJs(mimic('triggers.html'));

  it('the Charm overlay speaks a charm fire at once, unless the trigger overlay already did', () => {
    expect(charm).toContain("fetch('http://127.0.0.1:'+PORT+'/api/fires/wait?after=' + encodeURIComponent(after)");
    expect(charm).toMatch(/if \(!f\.charm\) continue;[\s\S]{0,200}if \(!f\.charm_spoken\) speak\('charm break'\);/);
    // An instant answer with nothing new waits before asking again (without this floor
    // test/mini-popraid-charm hangs: its stub fetch answers at once, forever).
    expect(charm).toMatch(/if \(!\(\(f\.ts\|\|0\) > after\)\) continue;\s*after = f\.ts; fresh\+\+;/);
    expect(charm).toContain('if (!fresh && Date.now() - t0 < 250) await new Promise(function(r){ setTimeout(r, 250); });');
  });

  it('its late call is skipped when the instant one came', () => {
    expect(charm).toContain("if (trackedKeysNow().has(key) && !_instantCalled(key)) speak('charm break');");
    expect(charm).toMatch(/function _instantCalled\(key\)\{\s*return Date\.now\(\) - Math\.max\(_instantAt\.get\(key\) \|\| 0, _instantLastAt\) < 8000;/);
  });

  it('the trigger overlay does not voice it a second time', () => {
    expect(triggers).toMatch(/function fire\(t\)\{\s*if \(t && t\.charm\) return;/);
  });

});

// ⇅ Timers start at the top (a member, 2026-09-27: "start the timers at the top, and go down
// with successive triggers to track, instead of always starting at the bottom of window and
// growing up").
describe('⇅ timers start at the top', () => {
  const main = stripJs(mimic('main.js'));
  const preload = stripJs(mimic('preload.js'));
  const triggersRaw = mimic('triggers.html');
  const css = stripCss(triggersRaw);

  function toggleHarness(cfg) {
    let handler = null;
    const sent = [];
    const block = sliceBlock(mimic('main.js'), "ipcMain.handle('wp-timers-order-toggle', () => {", '\n});');
    // eslint-disable-next-line no-new-func
    new Function('ipcMain', 'loadConfig', 'saveConfig', 'triggerWindow', 'currentStatus', 'hideAllStatusForRenderer', block)(
      { handle: (name, fn) => { handler = fn; } },
      () => cfg, (c) => { cfg = c; },
      { isDestroyed: () => false, webContents: { send: (ch, s) => sent.push([ch, s]) } },
      () => ({ triggerTimersTopDown: !!cfg.triggerTimersTopDown }), () => ({}));
    return { flip: () => handler(), cfg: () => cfg, sent };
  }

  it('switching on anchors the window top (grow-upward off); switching off restores the default', () => {
    const h = toggleHarness({ overlayGrowUp: { dps: true } });
    expect(h.flip()).toBe(true);
    expect(h.cfg().overlayGrowUp).toEqual({ dps: true, trigger: false });
    expect(h.sent.at(-1)).toEqual(['status', { triggerTimersTopDown: true }]);
    expect(h.flip()).toBe(false);
    expect(h.cfg().overlayGrowUp).toEqual({ dps: true });
    const fresh = toggleHarness({});
    fresh.flip();
    expect(fresh.cfg().overlayGrowUp).toEqual({ trigger: false });
  });

  it('the stack hangs off the top edge below the ✕ gutter and reads down; the callout column moves below it', () => {
    expect(css).toContain('body.timers-topdown #timers{top:34px;bottom:auto;flex-direction:column}');
    expect(css).toContain('body.setup.timers-topdown #timers{top:58px}');
    expect(css).toContain('body.timers-topdown #alertcol{margin-bottom:0;margin-top:var(--timers-space,0px)}');
  });

  it('the flag reaches the overlay and the right-click menu offers it on the trigger overlay only', () => {
    expect(main).toContain('triggerTimersTopDown: !!cfg.triggerTimersTopDown,');
    expect(main).toContain('timersTopDown: !!cfg.triggerTimersTopDown,');
    expect(preload).toMatch(/if \(st\.key === 'trigger'\) \{\s*menu\.appendChild\(mkItem\('⇅ Timers start at: '/);
    const fn = sliceBlock(triggersRaw, '  function applyTimersOrder(s){', '\n  }');
    const cls = new Set();
    const document = { body: { classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) } } };
    // eslint-disable-next-line no-new-func
    const apply = new Function('document', fn + '\nreturn applyTimersOrder;')(document);
    apply({ triggerTimersTopDown: true });
    expect(cls.has('timers-topdown')).toBe(true);
    apply({});
    expect(cls.has('timers-topdown')).toBe(false);
    expect(stripJs(triggersRaw)).toContain('window.mimic.onStatus(applyTimersOrder);');
  });
});
