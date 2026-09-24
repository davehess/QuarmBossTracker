// Overlay opacity split, and the dashboard's mini-mode + layout (2026-09-24).
//
// The guild lead: "Currently opacity only works on backgrounds, not on the
// actual content." · "The Opacity slider at the top of the Setup this overlay
// doesn't work at all." · "I don't see any of the Mini-mode overlays in here.
// Those need to go in" · "Make the top section of the overlays dashboard into
// two columns and put the opacity slider with the background button. Put the
// actual overlays in alphabetical order, keeping the dock and TTS up top."
//
// Run: npx vitest run test/overlay-opacity-and-mini-dashboard.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const mainRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preload = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

// main.js's opacity half, run: the split, the migration, what a window is sent.
function loadOpacity(cfg) {
  const saved = [], sent = [];
  const block = sliceBlock(mainRaw, 'function _opacityMaps(cfg) {', '\n}\n')
    + sliceBlock(mainRaw, 'function applyOverlayOpacity(win, key) {', '\n}\n');
  // eslint-disable-next-line no-new-func
  const mod = new Function('loadConfig', 'saveConfig', 'applyOverlayScale',
    block + '\nreturn { _opacityMaps, applyOverlayOpacity };')(() => cfg, (c) => saved.push(JSON.parse(JSON.stringify(c))), () => {});
  const win = { isDestroyed: () => false, setOpacity: () => {}, webContents: { send: (ch, v) => sent.push([ch, v]) } };
  return { mod, saved, sent, win };
}

describe('opacity: the whole overlay, and its background, as two settings', () => {
  it('a value saved before the split was a BACKGROUND value — it moves across once, and opacity starts at 100%', () => {
    const cfg = { overlayOpacity: { tank: 0.4, me: 0.7 } };
    const { mod, saved } = loadOpacity(cfg);
    const m = mod._opacityMaps(cfg);
    expect(cfg).toMatchObject({ opacitySplit: 1, overlayOpacity: {}, overlayBgAlpha: { tank: 0.4, me: 0.7 } });
    expect([m.content('tank'), m.bg('tank')]).toEqual([1, 0.4]);
    expect(saved).toHaveLength(1);
    mod._opacityMaps(cfg);                               // once only
    expect(saved).toHaveLength(1);
  });

  it('after the split, each window is sent both: its background, and how opaque the whole overlay is', () => {
    const cfg = { opacitySplit: 1, overlayOpacity: { tank: 0.5 }, overlayBgAlpha: { tank: 0.3 } };
    const { mod, sent, win } = loadOpacity(cfg);
    mod.applyOverlayOpacity(win, 'tank');
    expect(sent).toEqual([['bg-alpha', 0.3], ['content-alpha', 0.5]]);
    sent.length = 0;
    mod.applyOverlayOpacity(win, 'who');                 // nothing saved: solid
    expect(sent).toEqual([['bg-alpha', 1], ['content-alpha', 1]]);
  });

  it('the setup bar\'s slider and "Opacity — all overlays" set the whole overlay; the new Background slider sets the card', () => {
    const m = stripJs(mainRaw);
    expect(m).toContain("ipcMain.handle('wp-opacity-all', (_e, v) => _setOpacityAll('overlayOpacity', v));");
    expect(m).toContain("ipcMain.handle('wp-bg-alpha-all', (_e, v) => _setOpacityAll('overlayBgAlpha', v));");
    expect(sliceBlock(m, "ipcMain.handle('set-overlay-opacity'", '\n});')).toContain('cfg.overlayOpacity[key] = value;');
    expect(stripJs(preload)).toContain("setAllBgAlpha:   (v)    => ipcRenderer.invoke('wp-bg-alpha-all', v),");
  });

  it('the fade reaches everything an overlay shows, and never what you set it with', () => {
    const css = preload.match(/const _WP_OPACITY_CSS =\s*([\s\S]*?);\n/)[1];
    expect(css).toContain('{opacity:var(--wp-content-alpha,1)}');
    for (const id of ['#setupbar', '#move-btn', '#hide-btn', '#drag-controls', '#wpResizeMenu']) expect(css).toContain(':not(' + id + ')');
    expect(stripJs(preload)).toMatch(/ipcRenderer\.on\('content-alpha', function \(_e, v\) \{[\s\S]*?setProperty\('--wp-content-alpha'/);
    // an overlay whose backdrop is on <body> itself folds the fade into its alpha
    expect(preload).toContain('calc(var(--bg-alpha,0.92) * var(--wp-content-alpha,1))');
  });
});

describe('dashboard: mini mode on the Overlays page', () => {
  const keys = new Function(dash.match(/var WP_MINI_KEY_OF = (\{[\s\S]*?\});/)[0] + '\nreturn WP_MINI_KEY_OF;')();
  const miniKeys = new Function('return ' + mainRaw.match(/const _MINI_KEYS = (\[[^\]]+\])/)[1])();

  it('every overlay with a mini gets the switch and a 📌 in its row — the nine, no more', () => {
    expect(Object.values(keys).sort()).toEqual(miniKeys.slice().sort());
    const rows = [...dash.slice(dash.indexOf('var WP_OVERLAY_ROWS = ['), dash.indexOf('];', dash.indexOf('var WP_OVERLAY_ROWS = [')))
      .matchAll(/^\s+\['(\w+)',/gm)].map(m => m[1]);
    for (const k of Object.keys(keys)) expect(rows, k).toContain(k);
    expect(dash).toContain('<th>Mini</th>');
    expect(dash).toContain("'<td style=\"white-space:nowrap\"><button type=\"button\" class=\"wp-ov-mini\" data-mini=\"' + miniKey + '\">…</button>'");
  });

  it('the switch, the pin and Minimize ALL drive Mimic\'s own mini internals', () => {
    const d = stripJs(dash);
    expect(d).toMatch(/closest\('\.wp-ov-mini'\)[\s\S]*?window\.mimic\.setOverlayMini\(mn\.getAttribute\('data-mini'\), !mn\.classList\.contains\('on'\)\)/);
    expect(d).toMatch(/closest\('\.wp-ov-pin'\)[\s\S]*?window\.mimic\.setOverlayMiniPin\(pn\.getAttribute\('data-mini'\), !pn\.classList\.contains\('on'\)\)/);
    expect(d).toMatch(/a === 'miniall' && window\.mimic\.toggleMiniAll/);
    expect(d).toContain("_wpWireHotkeyRow('wpMiniHotkey', 'miniHotkey', 'miniHotkeyEnabled', 'CommandOrControl+Shift+M');");
    const m = stripJs(mainRaw);
    expect(m).toMatch(/ipcMain\.handle\('wp-mini-pin-set', \(_e, name, on\) => \{\s*if \(!_MINI_KEYS\.includes\(name\)\) return null;/);
    for (const f of ['miniCapable: _MINI_KEYS.slice(),', 'overlayMini: Object.assign(', 'overlayMiniPinned: Object.assign(', 'miniAllActive: !!_miniAllActive,']) expect(m).toContain(f);
  });
});

// "HUD doesn't make sense to dock, remove that." (the guild lead, 2026-09-24)
describe('the HUD ring is not dockable', () => {
  it('it is out of the dock catalog, and its dashboard row has no DOCK button', () => {
    const catalog = stripJs(sliceBlock(mainRaw, 'const _DOCK_CATALOG = [', '\n];'));
    expect(catalog).not.toMatch(/key: 'me'/);
    expect(catalog).toMatch(/key: 'mobinfo'/);                        // the others stay
    expect(stripJs(dash)).toContain("var dockCell = (key === 'trigger' || key === 'dock' || key === 'me')");
  });
  it('a HUD that was docked gets its own window back — as undocking it would have', () => {
    const load = (raw) => new Function('fs', 'CONFIG_FILE', 'defaultConfig',
      sliceBlock(mainRaw, 'function loadConfig() {', '\n}\n') + '\nreturn loadConfig();')(
      { readFileSync: () => JSON.stringify(raw) }, () => 'x', () => ({}));
    const was = load({ dockedOverlays: ['mobinfo', 'me'], dockedPrev: { me: true, mobinfo: false }, showMe: false });
    expect(was.dockedOverlays).toEqual(['mobinfo']);
    expect(was.showMe).toBe(true);
    expect(was.dockedPrev).toEqual({ mobinfo: false });
    const off = load({ dockedOverlays: ['me.html'], dockedPrev: { me: false }, showMe: false });
    expect([off.dockedOverlays, off.showMe]).toEqual([[], false]);     // it was off before it was docked
    expect(load({ dockedOverlays: ['tank'], showMe: false })).toMatchObject({ dockedOverlays: ['tank'], showMe: false });
  });
});

describe('dashboard: the Overlays page layout', () => {
  it('the table: Dock and trigger alerts first, then alphabetical ("/who" as "who")', () => {
    const rows = new Function(sliceBlock(dash, 'var WP_OVERLAY_ROWS = [', '\n];\n') + '\nreturn WP_OVERLAY_ROWS;')();
    const order = new Function('WP_OVERLAY_ROWS', sliceBlock(dash, '  var ovRows = WP_OVERLAY_ROWS', '));\n') + '\nreturn ovRows;')(rows);
    const labels = order.map(r => r[1]);
    expect(order.slice(0, 2).map(r => r[0])).toEqual(['dock', 'trigger']);
    const rest = labels.slice(2).map(l => l.replace(/^\W+/, '').toLowerCase());
    expect(rest).toEqual(rest.slice().sort());
    expect(labels.indexOf('/who')).toBeGreaterThan(labels.indexOf('Threat meter'));
    expect(order).toHaveLength(rows.length);
  });

  it('two columns that fold to one on a narrow window; the opacity sliders sit with the backgrounds button', () => {
    expect(dash).toMatch(/\.wp-ovtop \{ display:grid; grid-template-columns:repeat\(auto-fit, minmax\(min\(380px, 100%\), 1fr\)\)/);
    const top = dash.slice(dash.indexOf("h += '<div class=\"wp-ovtop\"><div class=\"wp-ovcol\">';"), dash.indexOf("h += '</div></div>';   // end of the two columns"));
    const box = top.slice(top.indexOf('🔅 Opacity'), top.indexOf("+ '</div>';", top.indexOf('🔅 Opacity')));
    for (const bit of ['id="wpAllOpacity"', 'id="wpAllBgAlpha"', 'data-act="backdrops"', 'id="wpBdHotkeyCur"']) expect(box, bit).toContain(bit);
    expect((dash.match(/data-act="backdrops"/g) || []).length).toBe(1);   // moved, not copied
  });
});
