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
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

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

  it('keep a hit target of 19x22px with a 14px dot (twelve of them fit one arc)', () => {
    expect(STYLE).toMatch(/#mini \.rd\{width:19px;height:22px/);
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
    expect(SCRIPT).toMatch(/if \(S\.miniOn\) \{ syncMiniNorth\(rot\);[^\n]*\} else drawCompass\(rot\);/);
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

// ── Edge arrows (the guild lead, 2026-11-09: "mini map can have the options on one sequence and leave room for arrows around
// the outside edge of their visible viewpoint for group and raid members, and more importantly the target mob and distance,
// and pet"). Mutation-checked by hand (2026-11-09): flip the sign of dx in miniBearing and both bearing tests fail; drop the
// `rot ?` turn and the heading-up test fails; make miniInView use `<=` against R + 99 and "hidden when in view" fails; remove
// the `slice(0, raidCap)` and the cap test fails; drop the merge branch (`hit.n++`) and the merging test fails.
describe('the rim dots are ONE sequence on one arc', () => {
  const angles = [...BODY.matchAll(/<button class="rd" id="(\w+)" type="button" style="--a:(\d+)deg"/g)].map((m) => [m[1], +m[2]]);

  it('all twelve sit inside one bounded arc, with room between neighbours', () => {
    expect(angles.length).toBe(DOT_IDS.length);
    const a = angles.map((x) => x[1]).sort((x, y) => x - y);
    expect(a[a.length - 1] - a[0]).toBeLessThanOrEqual(125);       // one contiguous run, not spread round the rim
    for (let i = 1; i < a.length; i++) expect(a[i] - a[i - 1]).toBeGreaterThanOrEqual(10);   // 19px hit boxes on a 110px radius do not overlap
    expect(a[0]).toBeGreaterThanOrEqual(180);                       // the lower-left of the rim: the top and the right stay free
    expect(a[a.length - 1]).toBeLessThanOrEqual(330);
  });

  it('zoom + and − are neighbours in the sequence', () => {
    const order = angles.slice().sort((x, y) => x[1] - y[1]).map((x) => x[0]);
    expect(Math.abs(order.indexOf('mdZoomIn') - order.indexOf('mdZoomOut'))).toBe(1);
  });
});

describe('edge arrows: bearing, view and merging (the real functions, run as written)', () => {
  const turn = sliceBlock(SCRIPT, 'function turnVec(dx, dy, rot) {', '\n  }');
  const head = sliceBlock(SCRIPT, 'function headingVec(heading, rot) {', '\n  }');
  const hrot = sliceBlock(SCRIPT, 'function headingRot(heading) {', '\n  }');
  const mini = sliceBlock(SCRIPT, 'function miniBearing(', 'var MINI_ARROW_GAP = 9, MINI_RAID_CAP = 8;');
  const F = evalBlock('var HEADING_CCW = true;\n' + turn + head + hrot + mini,
    ['miniBearing', 'miniInView', 'miniAngGap', 'miniArrowPlan', 'headingRot', 'MINI_ARROW_GAP', 'MINI_RAID_CAP', 'MINI_EDGE']);
  const near = (a, b) => expect(Math.abs(F.miniAngGap(a, b))).toBeLessThan(0.01);
  // World frame: north is +y, east is -x (screen = (-x, -y), north up). The player stands at (10, 10).

  it('north up: north is the top, east the right, south the bottom, west the left', () => {
    near(F.miniBearing(10, 10, 10, 210, 0).a, 0);     // 200 north
    near(F.miniBearing(10, 10, -190, 10, 0).a, 90);   // 200 east
    near(F.miniBearing(10, 10, 10, -190, 0).a, 180);
    near(F.miniBearing(10, 10, 210, 10, 0).a, 270);
    near(F.miniBearing(10, 10, -90, 110, 0).a, 45);   // north-east
    expect(F.miniBearing(10, 10, -90, 110, 0).d).toBe(141);   // rounded flat distance
  });

  it('heading up: what is ahead of you is the top, whichever way you face', () => {
    for (const heading of [0, 96, 128, 300]) {
      const rot = F.headingRot(heading);
      // 150 units straight ahead: heading 0 faces north (+y), 128 faces west (+x), so ahead = (sin a, cos a) in the world frame
      const a = (heading % 512) / 512 * Math.PI * 2;
      const tx = 10 + Math.sin(a) * 150, ty = 10 + Math.cos(a) * 150;
      near(F.miniBearing(10, 10, tx, ty, rot).a, 0);
      expect(F.miniBearing(10, 10, tx, ty, rot).d).toBe(150);
    }
    // facing west (heading 128): north (which was the top) is now to the right of you, so it reads 90 degrees
    near(F.miniBearing(10, 10, 10, 210, F.headingRot(128)).a, 90);
  });

  it('a thing in view gets no arrow (the outer band counts as off-view); one past it does', () => {
    expect(F.miniInView(130, 130, 130, 130, 110)).toBe(true);
    expect(F.miniInView(130 + 110 - F.MINI_EDGE - 1, 130, 130, 130, 110)).toBe(true);
    expect(F.miniInView(130 + 110 - F.MINI_EDGE + 1, 130, 130, 130, 110)).toBe(false);
    expect(F.miniInView(130 + 150, 130, 130, 130, 110)).toBe(false);
  });

  const it_ = (kind, a, d, extra) => Object.assign({ kind, a, d, name: kind + a, label: String(d) }, extra);
  it('the target and the pet are always their own arrow, and the target carries its distance', () => {
    const plan = F.miniArrowPlan([it_('raid', 40, 50), it_('pet', 41, 90), it_('target', 42, 142, { label: '142' }), it_('group', 43, 60)], F.MINI_ARROW_GAP, F.MINI_RAID_CAP);
    const tgt = plan.filter((p) => p.kind === 'target');
    expect(tgt).toHaveLength(1);
    expect(tgt[0].label).toBe('142');
    expect(plan.filter((p) => p.kind === 'pet')).toHaveLength(1);
    expect(plan[plan.length - 1].kind).toBe('target');   // drawn last, on top
  });

  it('crowded group and raid arrows fold into one with a count', () => {
    const items = [it_('raid', 100, 80), it_('raid', 103, 90), it_('raid', 106, 95), it_('raid', 200, 70)];
    const plan = F.miniArrowPlan(items, F.MINI_ARROW_GAP, F.MINI_RAID_CAP);
    expect(plan).toHaveLength(2);
    expect(plan.map((p) => p.n).sort()).toEqual([1, 3]);
  });

  it('only the nearest eight raiders are drawn', () => {
    const items = Array.from({ length: 14 }, (_, i) => it_('raid', i * 25, 100 + i));   // 25 degrees apart: none merge
    const plan = F.miniArrowPlan(items, F.MINI_ARROW_GAP, F.MINI_RAID_CAP);
    expect(plan).toHaveLength(8);
    expect(Math.max(...plan.map((p) => p.d))).toBe(107);
  });
});

describe('edge arrows: what draws them, and from what', () => {
  const draw = sliceBlock(SCRIPT, 'function drawMiniArrows(', "miniTip('miniPet', petA ? petA.a : 0");

  it('runs in the canvas pass, in mini only, and the rose steps aside for the N', () => {
    expect(SCRIPT).toMatch(/if \(S\.miniOn\) \{ syncMiniNorth\(rot\); if \(P\) drawMiniArrows\(P, rt, w, h, rot, SH, CO\); \} else drawCompass\(rot\);/);
  });

  it('the target arrow needs the target\'s live position and shows its distance (in view: a label by the ring)', () => {
    expect(draw).toMatch(/P\.target && P\.target\.x != null/);
    expect(draw).toContain('rangeText(targetRange(sd, td))');
    expect(draw).toMatch(/if \(rtxt\) \{ var tq = wpt\(td\.x, td\.y\); halo\(rtxt,/);
  });

  it('the pet uses the pet marker\'s position, group and raid their own, raid only with Raiders names on', () => {
    expect(draw).toMatch(/SH\.group && P\.pet && P\.pet\.x != null\) add\('pet', 'pet'/);
    expect(draw).toMatch(/if \(SH\.group\) \(P\.group \|\| \[\]\)\.forEach/);
    expect(draw).toMatch(/if \(SH\.raid && SH\.raidNames\) \(P\.raid \|\| \[\]\)\.forEach/);
  });

  it('the map does not also draw a raider or the pet where the arrow stands in', () => {
    expect(SCRIPT).toMatch(/if \(S\.miniOn && !miniInView\(q\[0\], q\[1\], w \/ 2, h \/ 2, Math\.min\(w, h\) \/ 2\)\) continue;/);
    expect(SCRIPT).toMatch(/\(!S\.miniOn \|\| miniInView\(pq\[0\], pq\[1\]/);
  });

  it('the hover names ride two buttons, written only when they change', () => {
    expect(BODY).toMatch(/<button class="ra" id="miniTgt"/);
    expect(BODY).toMatch(/<button class="ra" id="miniPet"/);
    expect(SCRIPT).toMatch(/if \(!e \|\| miniTipKey\[id\] === k\) return;/);
  });
});
