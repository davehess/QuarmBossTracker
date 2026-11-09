// test/map-mini.test.js — the Map's mini mode.
//
// The guild lead, 2026-11-09: "add a mini mode for the mimic map. keep the quick buttons as dots around, the move icon for
// pan/zoom, the mobs spawns as a single dot and dot with circle in it toggle. config button, compass rose button that shows the
// direction, label button".
//
// What is asserted, all against the shipped files (comments stripped before any text match: this repo's comments quote the
// behaviour they sit over, and a comment must not be able to satisfy a test):
//  - the Mini switch is in the toolbar, in the ✥ right-click menu (preload -> main -> page) and in a right-click on a dot;
//  - the choice persists (wp-map-mini), and Full mode never shows it;
//  - every rim dot is a real <button> (the preload arms the click-through window for buttons) and the moving N is not one;
//  - the ring dot flips the SAME switch as the aggro toolbar button, and the ring draw is gated by it;
//  - the compass dot drives the SAME North up / Heading up switch (setOrient) as the toolbar;
//  - main's window size: in keeps the old size once, out gives it back (run over fake windows).
//
// Mutation-checked by hand (2026-11-09): change the compass dot's `viaBtn('orientBtn')` to another id and "the compass dot
// drives the existing North up switch" fails; drop `if (SH.aggro) {` from the ring pass and "the ring pass is gated" fails;
// make _mapMiniSize overwrite cfg.mapPreMini every time and "keeps the old size only the first time" fails.
//
// Run: npx vitest run test/map-mini.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const SCRIPT = stripJs(HTML.slice(HTML.lastIndexOf('<script>'), HTML.lastIndexOf('</script>')));
const MAIN = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
const PRELOAD = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
const STYLE = HTML.slice(HTML.indexOf('<style>'), HTML.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const BODY = HTML.slice(HTML.indexOf('<body>'), HTML.indexOf('<script src="kiteCoach.js">')).replace(/<!--[\s\S]*?-->/g, '');
const DOT_IDS = ['mdLabels', 'mdRaiders', 'mdTimers', 'mdRing', 'mdZoomIn', 'mdZoomOut', 'mdPan', 'mdFollow', 'mdFit', 'mdCfg', 'mdExit', 'mdNorth'];

describe('Mini switch', () => {
  it('is a button in the Map toolbar', () => {
    const tools = BODY.slice(BODY.indexOf('<div id="tools">'), BODY.indexOf('<button class="tb" id="sideBtn"'));
    expect(tools).toMatch(/<button class="tb" id="miniBtn" type="button"/);
  });

  it('is in the ✥ right-click menu, which reaches the page through main', () => {
    expect(PRELOAD).toMatch(/st\.key === 'map'\) menu\.appendChild\(mkItem\([^\n]*invoke\('map-mini-toggle'\)/);
    expect(MAIN).toMatch(/ipcMain\.handle\('map-mini-toggle'[^\n]*webContents\.send\('map-mini-toggle'\)/);
    expect(PRELOAD).toMatch(/onMapMiniToggle:\s+\(cb\)\s+=> ipcRenderer\.on\('map-mini-toggle'/);
    expect(SCRIPT).toMatch(/onMapMiniToggle\(function \(\) \{ setMini\(!S\.mini\); \}\)/);
  });

  it('is in a right-click on a rim dot (centre, leave, settings)', () => {
    expect(SCRIPT).toMatch(/miniEl\.addEventListener\('contextmenu'/);
    for (const t of ['Centre on you', 'Leave the mini map', 'Map settings']) expect(SCRIPT).toContain("miniMenuItem('" + t + "'");
  });

  it('persists, and Full mode never shows it', () => {
    expect(SCRIPT).toContain("S.mini = lsGet('wp-map-mini') === '1'");
    expect(SCRIPT).toMatch(/lsSet\('wp-map-mini', on \? 1 : 0\)/);
    expect(SCRIPT).toMatch(/function miniWanted\(\) \{ return !!S\.mini && S\.mode !== 'full'/);
    expect(STYLE).toContain('body.full #miniBtn{display:none}');
    expect(STYLE).toMatch(/body\.mini:not\(\.full\) #mapPane[^{]*\{[^}]*border-radius:50%/);   // the circle is a clip, not per-frame work
  });
});

describe('the rim dots', () => {
  it('are all real buttons, each with a place on the rim', () => {
    for (const id of DOT_IDS) {
      expect(BODY, id).toMatch(new RegExp('<button class="rd" id="' + id + '" type="button" style="--a:\\d+deg"'));
    }
    expect((BODY.match(/<button class="rd"/g) || []).length).toBe(DOT_IDS.length);
  });

  it('keep a hit target of 22px with a 14px dot', () => {
    expect(STYLE).toMatch(/#mini \.rd\{width:22px;height:22px/);
    expect(STYLE).toMatch(/#mini \.rd i\{width:14px;height:14px/);
  });

  it('leave the moving N as a plain, click-less marker', () => {
    expect(BODY).toMatch(/<span id="miniN" aria-hidden="true">N<\/span>/);
    expect(STYLE).toMatch(/#mini #miniN\{[^}]*pointer-events:none/);
    expect(STYLE).toMatch(/body\.mini:not\(\.full\) #mini\{[^}]*pointer-events:none/);   // only the buttons take the mouse
  });

  it('the pan dot is Pan / zoom (not the window move), and the ✥ stays', () => {
    expect(BODY).toContain('<button id="move-btn"');
    expect(SCRIPT).toMatch(/mdPanEl\.addEventListener\('click'[\s\S]{0,160}S\.panMode = !S\.panMode; syncInteract\(\)/);
    expect(SCRIPT).toMatch(/mdPanEl\.addEventListener\('wheel'[\s\S]{0,80}zoomBy\(/);
    expect(SCRIPT).toMatch(/mdPanEl\.addEventListener\('mousedown'[\s\S]{0,260}btn: true/);
  });

  it('the config dot opens the existing settings (it leaves mini first: there is no room in the circle)', () => {
    expect(SCRIPT).toMatch(/miniClick\('mdCfg', function \(\) \{ setMini\(false\)\.then\([\s\S]{0,120}setCfgOpen\(true\)/);
  });

  it('the other dots click their toolbar twin, so there is one copy of each state', () => {
    for (const [dot, btn] of [['mdLabels', 'labelsBtn'], ['mdRaiders', 'namesBtn'], ['mdFollow', 'followBtn'], ['mdFit', 'fitBtn']]) {
      expect(SCRIPT).toContain("miniClick('" + dot + "', viaBtn('" + btn + "'))");
    }
  });
});

describe('spawns: a single dot, or a dot with its ring', () => {
  it('the ring dot flips the aggro switch the toolbar button flips', () => {
    expect(SCRIPT).toContain("miniClick('mdRing', viaBtn('aggroBtn'))");
    expect(SCRIPT).toMatch(/aggroBtn\.addEventListener\('click', function \(\) \{\s*S\.cfg\.show\.aggro = !S\.cfg\.show\.aggro;[\s\S]{0,160}cfgCommit\(\);/);
  });

  it('the ring pass is gated by it', () => {
    const at = SCRIPT.indexOf('if (SH.aggro) {');
    expect(at).toBeGreaterThan(0);
    expect(SCRIPT.indexOf('aggroRing(vis[ai].x', at)).toBeGreaterThan(at);
    expect(SCRIPT.indexOf('aggroRing(vis[ai].x', at) - at).toBeLessThan(3500);
  });

  it('shows ◉ with the ring and • without, and persists with the rest of the settings', () => {
    expect(SCRIPT).toContain("S.cfg.show.aggro ? '◉' : '•'");
    expect(SCRIPT).toContain("function saveCfg() { lsSet('wp-map-cfg', JSON.stringify(S.cfg)); }");
  });
});

describe('compass', () => {
  it('the compass dot drives the existing North up / Heading up switch', () => {
    expect(SCRIPT).toContain("miniClick('mdNorth', viaBtn('orientBtn'))");
    expect(SCRIPT).toMatch(/orientBtn\.addEventListener\('click', function \(\) \{ setOrient\(S\.cfg\.orient === 'heading' \? 'north' : 'heading'\); \}\)/);
  });

  it('the N rides to where north is, written only when it moves, and the canvas rose steps aside in mini', () => {
    expect(SCRIPT).toMatch(/function syncMiniNorth\(rot\) \{[\s\S]{0,260}if \(a === miniNorthA \|\| !miniEl\) return;/);
    expect(SCRIPT).toMatch(/if \(S\.miniOn\) syncMiniNorth\(rot\); else drawCompass\(rot\);/);
    expect(STYLE).toMatch(/#mini #miniN\{--a:var\(--n\)/);
  });
});

describe('the window: main gives the round map a square, and takes it back', () => {
  const block = sliceBlock(MAIN, 'const _MAP_MINI_PX = 260;', '  } catch { return false; }\n}');
  function rig({ full = false, pre } = {}) {
    const cfg = pre ? { mapPreMini: pre } : {};
    const win = { b: { x: 100, y: 200, width: 760, height: 480 }, getBounds() { return this.b; }, setBounds(b) { this.b = b; } };
    // eslint-disable-next-line no-new-func
    const fn = new Function('_live', 'mapWindow', '_mapFull', 'loadConfig', 'saveConfig', '_OVERLAY_MIN_W', block + '\nreturn _mapMiniSize;')(
      () => true, win, full, () => cfg, () => {}, 200);
    return { fn, win, cfg };
  }

  it('in: a 260 square from the same corner, the old size remembered', () => {
    const r = rig();
    expect(r.fn(true)).toBe(true);
    expect(r.win.b).toEqual({ x: 100, y: 200, width: 260, height: 260 });
    expect(r.cfg.mapPreMini).toEqual({ width: 760, height: 480 });
  });

  it('keeps the old size only the first time (a restart inside mini must not overwrite it with 260)', () => {
    const r = rig({ pre: { width: 700, height: 450 } });
    r.win.b = { x: 100, y: 200, width: 260, height: 260 };
    r.fn(true);
    expect(r.cfg.mapPreMini).toEqual({ width: 700, height: 450 });
  });

  it('out: the old size back, and forgotten', () => {
    const r = rig({ pre: { width: 700, height: 450 } });
    r.win.b = { x: 100, y: 200, width: 260, height: 260 };
    expect(r.fn(false)).toBe(true);
    expect(r.win.b).toEqual({ x: 100, y: 200, width: 700, height: 450 });
    expect(r.cfg.mapPreMini).toBeUndefined();
  });

  it('does nothing in Full mode, which owns the rectangle', () => {
    const r = rig({ full: true });
    expect(r.fn(true)).toBe(false);
    expect(r.win.b.width).toBe(760);
  });

  it('is on the IPC and the bridge', () => {
    expect(MAIN).toContain("ipcMain.handle('map-mini-size', (_e, on) => _mapMiniSize(!!on));");
    expect(PRELOAD).toMatch(/mapMiniSize:\s+\(on\)\s+=> ipcRenderer\.invoke\('map-mini-size', !!on\)/);
  });
});
