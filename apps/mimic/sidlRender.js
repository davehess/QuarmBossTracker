'use strict';
// sidlRender.js — browser-side renderer for the model sidlSkin.js builds. Loaded as a plain <script> (window.SidlRender)
// and, for tests, as a CommonJS module. The geometry is PURE (layoutScreen returns a list of draw commands, no canvas
// needed), the painting is a thin canvas pass over that list:
//
//   layoutScreen(model, screenName, width, height, opts) -> { width, height, cmds, notes, textures, client }
//   neededTextures(model, screenName, width, height, opts) -> [texture file, ...]  (ask main for just these)
//   renderScreen(model, textures, screenName, width, height, opts) -> HTMLCanvasElement
//   paint(ctx, layout, textures)          draws a layout; textures = { 'file.tga': {width,height,rgba} | canvas }
//   anchorRect(props, parentW, parentH)   the AutoStretch/anchor rule, exported so it can be tested on its own
//
// ASSUMPTIONS (each checked against the Nillipuss skin's own data and its Screenshot.png files; see the hand-off notes):
//  * The window is drawn at the size you pass (the ini Width/Height), NOT the XML design size. Only AutoStretch children
//    move with it; everything else keeps its Location, exactly as the client does.
//  * Window background = the WindowDrawTemplate's Background texture TILED at native size. Border pieces are TILED
//    along their edge at native size, corners drawn once: TopLeft/TopRight/BottomLeft/BottomRight are the horizontal
//    halves of a corner and LeftTop/RightTop/LeftBottom/RightBottom the vertical halves hanging off them.
//  * Style_Border does NOT inset the client area: child Locations start at the window's outer top-left (measured against
//    Nillipuss's player-window screenshot: XML 16,16 lands 16-17 px in). opts.insetClientByBorder flips it.
//    Style_Titlebar: the title bar sits INSIDE the border and pushes the client area down to its bottom edge.
//  * ScreenPieces (StaticAnimation, Button, Gauge fill/background, InvSlot, SpellGem) are STRETCHED to their Size: the
//    Nillipuss skin puts a 72x72 animation on a 100x24 button and a 120x24 one on a 20x20 button.
//  * Gauge: the visible rect is (x+GaugeOffsetX, y+GaugeOffsetY, w-GaugeOffsetX, h-GaugeOffsetY); two pieces of
//    Nillipuss's HP bar (a 240x36 background with offset Y 16, and a 192x20 fill at x+64 with offset X -48) land on the
//    same 240x20 box under that rule, which is the evidence for it.
//  * Anchors: edge = anchoredToStart ? offset : parentSize - offset. Defaults LeftAnchorToLeft=true, TopAnchorToTop=true,
//    RightAnchorToLeft=false, BottomAnchorToTop=false (no SIDL.xml schema was available to confirm the defaults).
//  * A nested Screen CLIPS its children to its own rect (Nillipuss hides colour variants of its HP bar inside 48x20
//    Screens that hold 6000-wide gauges).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SidlRender = api;
})(typeof window !== 'undefined' ? window : null, function () {

  // ---- tolerant property access (SIDL casing is not always consistent) ------------------------------------------
  function get(o, k) {
    if (!o || typeof o !== 'object') return undefined;
    if (k in o) return o[k];
    const lk = k.toLowerCase();
    for (const kk in o) if (kk.toLowerCase() === lk) return o[kk];
    return undefined;
  }
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const bool = (v, d) => (v === true ? true : v === false ? false : d);
  const str = (v) => (typeof v === 'string' ? v : '');
  function xy(o) { return { x: num(get(o, 'X'), 0), y: num(get(o, 'Y'), 0) }; }
  function wh(o) { return { w: num(get(o, 'CX'), num(get(o, 'width'), 0)), h: num(get(o, 'CY'), num(get(o, 'height'), 0)) }; }
  function rgb(o, d) {
    if (!o || typeof o !== 'object') return d || [255, 255, 255];
    return [num(get(o, 'R'), 255), num(get(o, 'G'), 255), num(get(o, 'B'), 255)];
  }
  // A DrawTemplate-ish property is either the NAME of a top-level template item or an inline object.
  function resolveTemplate(model, kind, v) {
    if (!v) return null;
    if (typeof v === 'object') return v;
    const bucket = model.templates && model.templates[kind];
    const hit = bucket && bucket[v];
    return hit ? hit.props : null;
  }

  // ---- anchors --------------------------------------------------------------------------------------------------
  function anchorRect(p, pw, ph) {
    const L = num(get(p, 'LeftAnchorOffset'), 0), T = num(get(p, 'TopAnchorOffset'), 0);
    const R = num(get(p, 'RightAnchorOffset'), 0), B = num(get(p, 'BottomAnchorOffset'), 0);
    const left = bool(get(p, 'LeftAnchorToLeft'), true) ? L : pw - L;
    const right = bool(get(p, 'RightAnchorToLeft'), false) ? R : pw - R;
    const top = bool(get(p, 'TopAnchorToTop'), true) ? T : ph - T;
    const bottom = bool(get(p, 'BottomAnchorToTop'), false) ? B : ph - B;
    return { x: left, y: top, w: right - left, h: bottom - top };
  }

  // ---- animations -----------------------------------------------------------------------------------------------
  function frameOf(model, name, idx) {
    const a = name && model.animations && model.animations[name];
    if (!a || !a.frames || !a.frames.length) return null;
    const f = a.frames[Math.min(idx || 0, a.frames.length - 1)];
    return f && f.texture && f.w > 0 && f.h > 0 ? f : null;
  }

  // ---- layout context -------------------------------------------------------------------------------------------
  const MAX_CMDS = 30000;
  const FONT_PX = { 0: 10, 1: 10, 2: 11, 3: 12, 4: 13, 5: 14, 6: 16, 7: 18, 8: 20, 9: 24, 10: 28 };   // approximation of EQ's font ids

  // Sample text for dynamic Labels (EQType). Inferred from the Nillipuss skin's own item names (EQType 1 sits on
  // Player_NameText, 17 on PW_HPNumbers, 28 on TargetName…); the invented names are not anybody.
  const SAMPLE_LABEL = {
    1: 'Aldenmar', 2: '60', 3: 'Cleric', 4: 'Tunare', 5: '95', 6: '90', 7: '88', 8: '92', 9: '120', 10: '70', 11: '85',
    12: '45', 13: '45', 14: '45', 15: '45', 16: '45', 17: '946', 18: '1382', 19: '68', 20: '83', 21: '100', 22: '1050',
    23: '980', 24: '92', 25: '94', 26: '93', 27: '12', 28: 'Corvale', 29: '68', 35: '71', 36: '84', 37: '55', 38: '90', 39: '40',
    69: '72', 70: '946',
  };

  function newCtx(model, opts) {
    return { model, opts: opts || {}, cmds: [], notes: [], tex: Object.create(null), depth: 0 };
  }
  function note(ctx, s) { if (ctx.notes.length < 200 && ctx.notes.indexOf(s) < 0) ctx.notes.push(s); }
  function useTex(ctx, t) { if (t) ctx.tex[String(t).toLowerCase()] = String(t); }
  function push(ctx, c) { if (ctx.cmds.length < MAX_CMDS) ctx.cmds.push(c); }

  // Emit one animation frame into a rect (stretched, or tiled at native size).
  function emitAnim(ctx, animName, r, o) {
    const f = frameOf(ctx.model, animName, o && o.frame);
    if (!f) return null;
    useTex(ctx, f.texture);
    push(ctx, {
      t: 'img', tex: f.texture, sx: f.x, sy: f.y, sw: f.w, sh: f.h, x: r.x, y: r.y, w: r.w, h: r.h,
      tile: !!(o && o.tile), tint: o && o.tint || null,
    });
    return f;
  }
  function emitText(ctx, text, r, o) {
    if (text == null || text === '') return;
    const font = num(o && o.font, 2);
    push(ctx, {
      t: 'text', text: String(text), x: r.x, y: r.y, w: r.w, h: r.h, color: (o && o.color) || [255, 255, 255],
      px: (ctx.opts.fontPx && ctx.opts.fontPx[font]) || FONT_PX[font] || 12,
      align: (o && o.align) || 'l', vcenter: !o || o.vcenter !== false, bold: !!(o && o.bold),
    });
  }

  // ---- window frame: background, border, title bar ---------------------------------------------------------------
  // Draws a WindowDrawTemplate-ish props object (or a FrameTemplate's props: it has the same piece names flat) into
  // rect r. Returns the insets it consumed: { l, t, r, b } (border) and tb (title bar height).
  function emitFrame(ctx, tpl, r, st) {
    const model = ctx.model;
    const ins = { l: 0, t: 0, r: 0, b: 0, tb: 0 };
    if (!tpl) return ins;
    const bgName = str(get(tpl, 'Background'));
    if (bgName && st.background) {
      useTex(ctx, bgName);
      push(ctx, { t: 'bgtile', tex: bgName, x: r.x, y: r.y, w: r.w, h: r.h });
    }
    const bd = st.border ? (get(tpl, 'Border') || (get(tpl, 'TopLeft') ? tpl : null)) : null;
    if (bd) {
      const F = (n) => frameOf(model, str(get(bd, n)));
      const TL = F('TopLeft'), T = F('Top'), TR = F('TopRight'), RT = F('RightTop'), Rr = F('Right'), RB = F('RightBottom');
      const BR = F('BottomRight'), B = F('Bottom'), BL = F('BottomLeft'), LB = F('LeftBottom'), Ll = F('Left'), LT = F('LeftTop');
      const at = (n, x, y, w, h, tile) => { if (w > 0 && h > 0) emitAnim(ctx, str(get(bd, n)), { x, y, w, h }, { tile }); };
      const X0 = r.x, Y0 = r.y, X1 = r.x + r.w, Y1 = r.y + r.h;
      const tlw = TL ? TL.w : 0, tlh = TL ? TL.h : 0, trw = TR ? TR.w : 0, trh = TR ? TR.h : 0;
      const blw = BL ? BL.w : 0, blh = BL ? BL.h : 0, brw = BR ? BR.w : 0, brh = BR ? BR.h : 0;
      const ltw = LT ? LT.w : 0, lth = LT ? LT.h : 0, lbh = LB ? LB.h : 0, rth = RT ? RT.h : 0, rbh = RB ? RB.h : 0;
      // edges first (tiled), corners over them
      if (T) at('Top', X0 + tlw, Y0, X1 - trw - (X0 + tlw), T.h, true);
      if (B) at('Bottom', X0 + blw, Y1 - B.h, X1 - brw - (X0 + blw), B.h, true);
      if (Ll) at('Left', X0, Y0 + tlh + lth, Ll.w, Y1 - blh - lbh - (Y0 + tlh + lth), true);
      if (Rr) at('Right', X1 - Rr.w, Y0 + trh + rth, Rr.w, Y1 - brh - rbh - (Y0 + trh + rth), true);
      if (TL) at('TopLeft', X0, Y0, TL.w, TL.h);
      if (TR) at('TopRight', X1 - TR.w, Y0, TR.w, TR.h);
      if (BL) at('BottomLeft', X0, Y1 - BL.h, BL.w, BL.h);
      if (BR) at('BottomRight', X1 - BR.w, Y1 - BR.h, BR.w, BR.h);
      if (LT) at('LeftTop', X0, Y0 + tlh, LT.w, LT.h);
      if (LB) at('LeftBottom', X0, Y1 - blh - LB.h, LB.w, LB.h);
      if (RT) at('RightTop', X1 - RT.w, Y0 + trh, RT.w, RT.h);
      if (RB) at('RightBottom', X1 - RB.w, Y1 - brh - RB.h, RB.w, RB.h);
      ins.l = Ll ? Ll.w : ltw; ins.t = T ? T.h : Math.max(tlh, trh);
      ins.r = Rr ? Rr.w : (RT ? RT.w : 0); ins.b = B ? B.h : Math.max(blh, brh);
    }
    return ins;
  }

  function emitTitlebar(ctx, tpl, r, ins, st, title) {
    const model = ctx.model;
    const tb = get(tpl, 'Titlebar');
    const mid = tb && frameOf(model, str(get(tb, 'Middle')));
    const tbH = mid ? mid.h : 16;
    const x = r.x + ins.l, y = r.y + ins.t, w = r.w - ins.l - ins.r;
    if (tb && w > 0) {
      const lf = frameOf(model, str(get(tb, 'Left'))), rf = frameOf(model, str(get(tb, 'Right')));
      const lw = lf ? lf.w : 0, rw = rf ? rf.w : 0;
      if (mid) emitAnim(ctx, str(get(tb, 'Middle')), { x: x + lw, y, w: w - lw - rw, h: tbH }, { tile: true });
      if (lf) emitAnim(ctx, str(get(tb, 'Left')), { x, y, w: lw, h: tbH });
      if (rf) emitAnim(ctx, str(get(tb, 'Right')), { x: x + w - rw, y, w: rw, h: tbH });
    }
    // caption buttons, right to left: close, minimize, (tile), question mark
    let bx = x + w - 2;
    const boxes = [[st.closebox, 'CloseBox'], [st.minimizebox, 'MinimizeBox'], [st.tilebox, 'TileBox'], [st.qmarkbox, 'QmarkBox']];
    for (const [on, key] of boxes) {
      if (!on) continue;
      const bt = get(tpl, key);
      const f = bt && frameOf(model, str(get(bt, 'Normal')));
      if (!f) continue;
      bx -= f.w;
      emitAnim(ctx, str(get(bt, 'Normal')), { x: bx, y: y + Math.max(0, Math.floor((tbH - f.h) / 2)), w: f.w, h: f.h });
      bx -= 1;
    }
    if (title) emitText(ctx, title, { x: x + 4, y, w: Math.max(0, bx - x - 4), h: tbH }, { align: 'c', font: 3, color: [255, 255, 255] });
    return tbH;
  }

  function friendlyTitle(screenName) {
    return String(screenName).replace(/(Window|Wnd)$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim() || String(screenName);
  }

  // ---- scrollbar -------------------------------------------------------------------------------------------------
  function emitScrollbar(ctx, tpl, r) {
    const vs = get(tpl, 'VSBTemplate');
    if (!vs) return;
    const up = get(vs, 'UpButton'), dn = get(vs, 'DownButton'), th = get(vs, 'Thumb');
    const uf = up && frameOf(ctx.model, str(get(up, 'Normal')));
    const df = dn && frameOf(ctx.model, str(get(dn, 'Normal')));
    const sw = uf ? uf.w : df ? df.w : 16;
    const x = r.x + r.w - sw;
    const gut = str(get(vs, 'MiddleTextureInfo'));
    const uh = uf ? uf.h : 0, dh = df ? df.h : 0;
    const trackY = r.y + uh, trackH = r.h - uh - dh;
    if (gut && trackH > 0) {
      useTex(ctx, gut);
      push(ctx, { t: 'img', tex: gut, sx: 0, sy: 0, sw: 0, sh: 0, whole: true, x, y: trackY, w: sw, h: trackH, tile: true });
    }
    if (uf) emitAnim(ctx, str(get(up, 'Normal')), { x, y: r.y, w: sw, h: uh });
    if (df) emitAnim(ctx, str(get(dn, 'Normal')), { x, y: r.y + r.h - dh, w: sw, h: dh });
    const tf = th && frameOf(ctx.model, str(get(th, 'Middle')));
    if (th && trackH > 24) {
      const ty = trackY + Math.floor(trackH * 0.15), tH = Math.max(16, Math.floor(trackH * 0.3));
      const tt = frameOf(ctx.model, str(get(th, 'Top'))), tbm = frameOf(ctx.model, str(get(th, 'Bottom')));
      const tth = tt ? tt.h : 0, tbh = tbm ? tbm.h : 0;
      if (tf) emitAnim(ctx, str(get(th, 'Middle')), { x, y: ty + tth, w: sw, h: Math.max(0, tH - tth - tbh) }, {});
      if (tt) emitAnim(ctx, str(get(th, 'Top')), { x, y: ty, w: sw, h: tth });
      if (tbm) emitAnim(ctx, str(get(th, 'Bottom')), { x, y: ty + tH - tbh, w: sw, h: tbh });
    }
  }

  // ---- pieces ----------------------------------------------------------------------------------------------------
  function pieceRect(p, client) {
    if (bool(get(p, 'AutoStretch'), false)) {
      const a = anchorRect(p, client.w, client.h);
      return { x: client.x + a.x, y: client.y + a.y, w: a.w, h: a.h };
    }
    const l = xy(get(p, 'Location')), s = wh(get(p, 'Size'));
    return { x: client.x + l.x, y: client.y + l.y, w: s.w, h: s.h };
  }

  function emitPiece(ctx, name, client, selfName) {
    const model = ctx.model;
    let it = model.pieces[name];
    if (!it && name !== selfName) it = model.screens[name];
    if (!it) { note(ctx, 'missing piece: ' + name); return; }
    if (ctx.depth > 8) { note(ctx, 'nesting deeper than 8 at ' + name); return; }
    const p = it.props || {};
    const type = it.type;
    // No Location and no AutoStretch: the client places it in code (the buff / pet-buff / short-buff window slots are all
    // like this; fifteen of them at 0,0 would just be a pile). Say so instead of drawing the pile.
    if (type !== 'Screen' && type !== 'Page' && get(p, 'Location') === undefined && !bool(get(p, 'AutoStretch'), false)) {
      note(ctx, 'positioned by the client, not drawn: ' + name);
      return;
    }
    const r = pieceRect(p, client);
    if (r.w <= 1 && r.h <= 1) return;                      // 1x1 / unsized: a hidden placeholder the client repositions
    if (r.w <= 0 || r.h <= 0) return;
    const color = rgb(get(p, 'TextColor'));
    const font = num(get(p, 'Font'), 2);
    const align = bool(get(p, 'AlignCenter'), false) ? 'c' : bool(get(p, 'AlignRight'), false) ? 'r' : 'l';
    const textOf = () => {
      const t = get(p, 'Text');
      if (typeof t === 'string') return t;
      return '';
    };

    if (type === 'StaticAnimation') {
      emitAnim(ctx, str(get(p, 'Animation')), r);
    } else if (type === 'Button') {
      const bt = resolveTemplate(model, 'ButtonDrawTemplate', get(p, 'ButtonDrawTemplate'));
      if (bt) emitAnim(ctx, str(get(bt, 'Normal')), r);
      else push(ctx, { t: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: 'rgba(120,120,140,0.35)' });
      emitText(ctx, textOf(), r, { align: 'c', font, color });
    } else if (type === 'Label' || type === 'StaticText') {
      let t = textOf();
      const eqt = get(p, 'EQType');
      if (!t && type === 'Label' && eqt !== undefined) {
        const s = ctx.opts.sampleText ? ctx.opts.sampleText(eqt, name, p) : null;
        t = s != null ? s : (SAMPLE_LABEL[eqt] != null ? SAMPLE_LABEL[eqt] : '');
      }
      emitText(ctx, t, r, { align, font, color });
    } else if (type === 'Gauge') {
      const gdt = get(p, 'GaugeDrawTemplate');
      const gx = num(get(p, 'GaugeOffsetX'), 0), gy = num(get(p, 'GaugeOffsetY'), 0);
      const v = { x: r.x + gx, y: r.y + gy, w: r.w - gx, h: r.h - gy };
      if (gdt && v.w > 0 && v.h > 0) {
        const bg = str(get(gdt, 'Background'));
        if (bg) emitAnim(ctx, bg, v);
        const fill = str(get(gdt, 'Fill'));
        const pct = Math.max(0, Math.min(1, ctx.opts.fakeFill == null ? 0.7 : ctx.opts.fakeFill));
        if (fill) emitAnim(ctx, fill, { x: v.x, y: v.y, w: Math.round(v.w * pct), h: v.h }, { tint: get(p, 'FillTint') ? rgb(get(p, 'FillTint')) : null });
      }
      emitText(ctx, textOf(), r, { align: 'c', font, color });
    } else if (type === 'InvSlot') {
      if (!emitAnim(ctx, str(get(p, 'Background')), r)) push(ctx, { t: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: 'rgba(20,20,30,0.7)', stroke: 'rgba(120,120,140,0.6)' });
    } else if (type === 'SpellGem') {
      const sg = resolveTemplate(model, 'SpellGemDrawTemplate', get(p, 'SpellGemDrawTemplate'));
      const holder = sg && (str(get(sg, 'Holder')) || str(get(sg, 'Background')));
      if (!(holder && emitAnim(ctx, holder, r))) push(ctx, { t: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, fill: 'rgba(20,20,30,0.7)', stroke: 'rgba(120,120,140,0.6)' });
    } else if (type === 'Slider') {
      push(ctx, { t: 'rect', x: r.x, y: r.y + Math.floor(r.h / 2) - 1, w: r.w, h: 2, fill: 'rgba(140,140,160,0.8)' });
      push(ctx, { t: 'rect', x: r.x + Math.floor(r.w * 0.6), y: r.y, w: 6, h: r.h, fill: 'rgba(200,200,220,0.9)' });
    } else if (type === 'Listbox' || type === 'Editbox' || type === 'STMLbox' || type === 'Combobox') {
      const tpl = resolveTemplate(model, 'WindowDrawTemplate', get(p, 'DrawTemplate'));
      const st = { background: !bool(get(p, 'Style_Transparent'), false), border: bool(get(p, 'Style_Border'), true) };
      emitFrame(ctx, tpl, r, st);
      if (bool(get(p, 'Style_VScroll'), false) && tpl) emitScrollbar(ctx, tpl, r);
      if (type === 'Combobox') {
        const bt = resolveTemplate(model, 'ButtonDrawTemplate', get(p, 'Button'));
        if (bt) emitAnim(ctx, str(get(bt, 'Normal')), { x: r.x + r.w - r.h, y: r.y, w: r.h, h: r.h });
      }
      if (type === 'Listbox') {
        const cols = get(p, 'Columns');
        if (Array.isArray(cols)) {
          let cx = r.x + 4;
          for (const c of cols) {
            const w = num(get(c, 'Width'), 0);
            emitText(ctx, str(get(c, 'Heading')), { x: cx, y: r.y + 2, w, h: 14 }, { font: 2, color: [255, 255, 255] });
            cx += w;
          }
        }
      }
      emitText(ctx, textOf(), { x: r.x + 3, y: r.y, w: r.w - 6, h: r.h }, { align, font, color });
    } else if (type === 'TabBox') {
      emitTabBox(ctx, p, r);
      return;
    } else if (type === 'Screen' || type === 'Page') {
      // nested window: frame (if it asks for one), then its own pieces clipped to it
      const tpl = resolveTemplate(model, 'WindowDrawTemplate', get(p, 'DrawTemplate'));
      const st = { background: !bool(get(p, 'Style_Transparent'), false), border: bool(get(p, 'Style_Border'), false) };
      const ins = tpl ? emitFrame(ctx, tpl, r, st) : { l: 0, t: 0, r: 0, b: 0, tb: 0 };
      emitChildren(ctx, p, clientRect(r, ins, 0, !!ctx.opts.insetClientByBorder), it.name, r);
      return;
    } else if (type === 'HorizontalLayoutBox' || type === 'VerticalLayoutBox') {
      note(ctx, type + ' not laid out: ' + name);
    } else {
      note(ctx, 'unrendered piece type ' + type);
    }
    // a non-window piece with its own Pieces (rare) still gets its children
    const kids = get(p, 'Pieces');
    if (Array.isArray(kids) && kids.length) emitChildren(ctx, p, r, it.name, r);
  }

  function emitChildren(ctx, p, client, selfName, clip) {
    const kids = get(p, 'Pieces');
    if (!Array.isArray(kids)) return;
    ctx.depth++;
    if (clip) push(ctx, { t: 'push', x: clip.x, y: clip.y, w: clip.w, h: clip.h });
    for (const k of kids) if (typeof k === 'string') emitPiece(ctx, k, client, selfName);
    if (clip) push(ctx, { t: 'pop' });
    ctx.depth--;
  }

  // Tabs: the first page only, with a plain tab strip (the skin's tab art is a FrameTemplate we only use for the page border).
  function emitTabBox(ctx, p, r) {
    const model = ctx.model;
    const pages = get(p, 'Pages');
    if (!Array.isArray(pages) || !pages.length) return;
    let tx = r.x;
    const tabH = 20;
    pages.forEach((pn, i) => {
      const pg = model.pieces[pn] || model.screens[pn];
      const label = pg && str(get(pg.props, 'TabText')) || ('Tab ' + (i + 1));
      const w = Math.max(40, label.length * 7 + 14);
      push(ctx, { t: 'rect', x: tx, y: r.y, w, h: tabH, fill: i === 0 ? 'rgba(70,70,110,0.9)' : 'rgba(30,30,45,0.9)', stroke: 'rgba(130,130,170,0.7)' });
      emitText(ctx, label, { x: tx, y: r.y, w, h: tabH }, { align: 'c', font: 2, color: i === 0 ? [255, 255, 0] : [255, 255, 255] });
      tx += w + 1;
    });
    const first = model.pieces[pages[0]] || model.screens[pages[0]];
    if (!first) return;
    const fp = first.props || {};
    const l = xy(get(fp, 'Location')), s = wh(get(fp, 'Size'));
    const pr = { x: r.x + l.x, y: r.y + l.y, w: s.w || r.w, h: s.h || (r.h - tabH) };
    const ft = resolveTemplate(model, 'FrameTemplate', get(p, 'PageBorderTemplate'));
    if (ft) emitFrame(ctx, ft, pr, { background: false, border: true });
    emitChildren(ctx, fp, pr, first.name, pr);
  }

  // Where children's Locations start. MEASURED, not assumed: in Nillipuss's own screenshot of its player window the HP bar
  // (Location 16,16 in the XML) sits 16-17 px in from the window's outer edge, i.e. the 4 px border does NOT push the
  // client area in. A title bar does push it down (children sit under it): title bottom = border top + bar height.
  // opts.insetClientByBorder flips the alternative (inset by the border on all sides) if a skin turns out to need it.
  function clientRect(rect, ins, tbH, insetByBorder) {
    const l = insetByBorder ? ins.l : 0, r = insetByBorder ? ins.r : 0, b = insetByBorder ? ins.b : 0;
    const top = tbH ? ins.t + tbH : (insetByBorder ? ins.t : 0);
    return { x: rect.x + l, y: rect.y + top, w: rect.w - l - r, h: rect.h - top - b };
  }

  // ---- top level ------------------------------------------------------------------------------------------------
  function layoutScreen(model, screenName, width, height, opts) {
    const ctx = newCtx(model, opts);
    const scr = model.screens && model.screens[screenName];
    if (!scr) return { width: width || 0, height: height || 0, cmds: [], notes: ['unknown screen: ' + screenName], textures: [], client: null, missing: true };
    const p = scr.props || {};
    const sz = wh(get(p, 'Size'));
    const W = Math.max(1, Math.round(width > 0 ? width : sz.w || 100));
    const H = Math.max(1, Math.round(height > 0 ? height : sz.h || 100));
    const rect = { x: 0, y: 0, w: W, h: H };
    const st = {
      background: !bool(get(p, 'Style_Transparent'), false),
      border: bool(get(p, 'Style_Border'), false),
      titlebar: bool(get(p, 'Style_Titlebar'), false),
      closebox: bool(get(p, 'Style_Closebox'), false),
      minimizebox: bool(get(p, 'Style_Minimizebox'), false),
      tilebox: bool(get(p, 'Style_Tilebox'), false),
      qmarkbox: bool(get(p, 'Style_Qmarkbox'), false),
    };
    const tpl = resolveTemplate(model, 'WindowDrawTemplate', get(p, 'DrawTemplate'));
    if (!tpl && get(p, 'DrawTemplate')) note(ctx, 'missing WindowDrawTemplate ' + get(p, 'DrawTemplate'));
    const ins = emitFrame(ctx, tpl, rect, st);
    let tbH = 0;
    if (tpl && st.titlebar) {
      const titleRaw = get(p, 'Text');
      const title = (opts && opts.title) || (typeof titleRaw === 'string' && titleRaw) || friendlyTitle(screenName);
      tbH = emitTitlebar(ctx, tpl, rect, ins, st, title);
    }
    const client = clientRect(rect, ins, tbH, !!(opts && opts.insetClientByBorder));
    emitChildren(ctx, p, client, screenName, null);
    return { width: W, height: H, cmds: ctx.cmds, notes: ctx.notes, textures: Object.values(ctx.tex), client, designSize: sz };
  }

  function neededTextures(model, screenName, width, height, opts) {
    return layoutScreen(model, screenName, width, height, opts).textures;
  }

  // ---- painting ---------------------------------------------------------------------------------------------------
  function texIndex(textures) {
    const idx = Object.create(null);
    if (textures) for (const k of Object.keys(textures)) idx[k.toLowerCase()] = textures[k];
    return idx;
  }
  // rgba pixel object -> drawable canvas, cached on the pixel object
  function drawable(t, doc) {
    if (!t) return null;
    if (t._c) return t._c;
    if (t.rgba && t.width && t.height) {
      const d = doc || (typeof document !== 'undefined' ? document : null);
      if (!d) return null;
      const c = d.createElement('canvas');
      c.width = t.width; c.height = t.height;
      const img = c.getContext('2d').createImageData(t.width, t.height);
      img.data.set(t.rgba);
      c.getContext('2d').putImageData(img, 0, 0);
      try { Object.defineProperty(t, '_c', { value: c, enumerable: false }); } catch { /* frozen object: no cache */ }
      return c;
    }
    return t.width ? t : null;   // already a canvas / image
  }
  // drawImage with the SOURCE clamped to the image (a skin's frame can point past its sheet; the dest shrinks to match)
  function drawSub(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
    const ix = Math.max(0, sx), iy = Math.max(0, sy);
    const ex = Math.min(img.width, sx + sw), ey = Math.min(img.height, sy + sh);
    if (ex <= ix || ey <= iy) return;
    const kx = dw / sw, ky = dh / sh;
    ctx.drawImage(img, ix, iy, ex - ix, ey - iy, dx + (ix - sx) * kx, dy + (iy - sy) * ky, (ex - ix) * kx, (ey - iy) * ky);
  }

  function paint(ctx, layout, textures, opts) {
    const idx = texIndex(textures);
    const doc = opts && opts.document;
    const font = (opts && opts.fontFamily) || 'Arial, Helvetica, sans-serif';
    const tmp = {};
    const tintCanvas = (w, h) => {
      const d = doc || document;
      const c = tmp.c || (tmp.c = d.createElement('canvas'));
      c.width = w; c.height = h;
      return c;
    };
    const missing = (c) => {
      ctx.fillStyle = 'rgba(110,110,130,0.30)';
      ctx.fillRect(c.x, c.y, c.w, c.h);
    };
    for (const c of layout.cmds) {
      if (c.t === 'push') { ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip(); continue; }
      if (c.t === 'pop') { ctx.restore(); continue; }
      if (c.t === 'rect') {
        if (c.fill) { ctx.fillStyle = c.fill; ctx.fillRect(c.x, c.y, c.w, c.h); }
        if (c.stroke) { ctx.strokeStyle = c.stroke; ctx.lineWidth = 1; ctx.strokeRect(c.x + 0.5, c.y + 0.5, c.w - 1, c.h - 1); }
        continue;
      }
      if (c.t === 'text') {
        ctx.save();
        ctx.beginPath(); ctx.rect(c.x, c.y - 2, c.w, c.h + 4); ctx.clip();
        ctx.font = (c.bold ? 'bold ' : '') + c.px + 'px ' + font;
        ctx.fillStyle = 'rgb(' + c.color[0] + ',' + c.color[1] + ',' + c.color[2] + ')';
        ctx.textBaseline = 'middle';
        ctx.textAlign = c.align === 'c' ? 'center' : c.align === 'r' ? 'right' : 'left';
        const tx = c.align === 'c' ? c.x + c.w / 2 : c.align === 'r' ? c.x + c.w : c.x;
        const ty = c.vcenter && c.h <= c.px * 2.2 ? c.y + c.h / 2 : c.y + c.px / 2 + 1;
        ctx.fillText(c.text, tx, ty);
        ctx.restore();
        continue;
      }
      const img = drawable(idx[String(c.tex).toLowerCase()], doc);
      if (!img) { if (c.t === 'bgtile') { ctx.fillStyle = '#14141c'; ctx.fillRect(c.x, c.y, c.w, c.h); } else missing(c); continue; }
      if (c.t === 'bgtile') {
        ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
        const nx = Math.ceil(c.w / img.width), ny = Math.ceil(c.h / img.height);
        if (nx * ny <= 20000) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) ctx.drawImage(img, c.x + i * img.width, c.y + j * img.height);
        ctx.restore();
        continue;
      }
      // t === 'img'
      let sx = c.sx, sy = c.sy, sw = c.sw, sh = c.sh;
      if (c.whole) { sx = 0; sy = 0; sw = img.width; sh = img.height; }
      let target = ctx, ox = 0, oy = 0;
      let off = null;
      if (c.tint) {   // multiply-tint: draw into a scratch canvas, multiply, restore alpha, then composite
        off = tintCanvas(Math.max(1, Math.ceil(c.w)), Math.max(1, Math.ceil(c.h)));
        target = off.getContext('2d');
        target.clearRect(0, 0, off.width, off.height);
        ox = c.x; oy = c.y;
      }
      const T = c.tint ? { x: 0, y: 0 } : { x: c.x, y: c.y };
      if (c.tile && sw > 0 && sh > 0) {
        target.save(); target.beginPath(); target.rect(T.x, T.y, c.w, c.h); target.clip();
        const nx = Math.ceil(c.w / sw), ny = Math.ceil(c.h / sh);
        if (nx * ny <= 20000) {
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) drawSub(target, img, sx, sy, sw, sh, T.x + i * sw, T.y + j * sh, sw, sh);
        } else drawSub(target, img, sx, sy, sw, sh, T.x, T.y, c.w, c.h);
        target.restore();
      } else {
        drawSub(target, img, sx, sy, sw, sh, T.x, T.y, c.w, c.h);
      }
      if (off) {
        target.globalCompositeOperation = 'multiply';
        target.fillStyle = 'rgb(' + c.tint[0] + ',' + c.tint[1] + ',' + c.tint[2] + ')';
        target.fillRect(0, 0, off.width, off.height);
        target.globalCompositeOperation = 'destination-in';
        if (c.tile && sw > 0 && sh > 0) {
          const nx = Math.ceil(c.w / sw), ny = Math.ceil(c.h / sh);
          for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) drawSub(target, img, sx, sy, sw, sh, i * sw, j * sh, sw, sh);
        } else drawSub(target, img, sx, sy, sw, sh, 0, 0, c.w, c.h);
        target.globalCompositeOperation = 'source-over';
        ctx.drawImage(off, 0, 0, off.width, off.height, ox, oy, off.width, off.height);
      }
    }
  }

  function renderScreen(model, textures, screenName, width, height, opts) {
    opts = opts || {};
    const layout = layoutScreen(model, screenName, width, height, opts);
    const d = opts.document || (typeof document !== 'undefined' ? document : null);
    const canvas = opts.canvas || (d && d.createElement('canvas'));
    if (!canvas) throw new Error('SidlRender.renderScreen needs a DOM (pass opts.document or opts.canvas)');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    try { paint(ctx, layout, textures, opts); } catch (e) { layout.notes.push('paint error: ' + (e && e.message)); }
    canvas.sidlLayout = layout;
    return canvas;
  }

  return { anchorRect, layoutScreen, neededTextures, renderScreen, paint, frameOf, get, SAMPLE_LABEL };
});
