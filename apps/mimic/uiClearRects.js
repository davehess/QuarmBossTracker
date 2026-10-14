// uiClearRects.js — which EverQuest windows are OPEN, and where, read from a UI ini.
//
// The Map's Full mode keeps its drawing off EverQuest's own windows (the guild lead, 2026-10-14: "give map a toggle full
// vs window mode, and have it avoid drawing over UI elements when see through maps are in position"). This is the
// read half: given the text of UI_<Char>_pq.proj.ini, return the rectangle of every window that is shown, in EverQuest's
// own pixels. Converting them to the Map's window is map.html's uiRectsToMap. Read-only: Mimic never writes these files
// from here (EQ rewrites them on camp / zone / quit, so a window moved since then is where the ini does not say).
//
// What a UI ini section looks like (the keys UI Studio and auto-arrange already read):
//   [PlayerWindow]
//   Show=1
//   XPos1920x1080=24        <- position is stored PER RESOLUTION; a bare XPos is the older form
//   YPos1920x1080=30
//   Width=260               <- size is bare; absent for a window that takes its skin's own size
//   Height=130
//
// Choices a reader should know:
//  - Only Show=1 (or true/yes/on) counts. A section with no Show key is NOT shown: EQ writes Show for the windows it
//    opens and closes, and a closed window is the common case, so leaving it out is the quieter mistake.
//  - The live resolution is the XPos<W>x<H> block with the most keys, as auto-arrange assumes.
//  - A shown window with no Width/Height is given a 200 x 100 stand-in and marked `guess: true`: its real size lives in
//    the skin's XML, which this does not read. The user's own keep-clear boxes cover what a guess misses.
//  - `skip` is an optional RegExp of section names to ignore (login-screen and pop-up windows that never sit on the HUD).
'use strict';

const SEC_RE = /^\s*\[([^\]]+)\]\s*$/;
const KV_RE = /^\s*([\w.]+)\s*=\s*(.*?)\s*$/;
const SHOWN_RE = /^(1|true|yes|on)$/i;

// Sections as { name, props } with lower-cased keys (the Windows profile API EQ writes these with ignores case).
function parseSections(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text == null ? '' : text).split(/\r?\n/)) {
    const m = SEC_RE.exec(raw);
    if (m) { cur = { name: m[1].trim(), props: {} }; out.push(cur); continue; }
    if (!cur) continue;
    const kv = KV_RE.exec(raw);
    if (kv) cur.props[kv[1].toLowerCase()] = kv[2];
  }
  return out;
}

// The resolution block the file was last laid out for: the "<W>x<H>" suffix with the most XPos keys, or null.
function dominantResolution(sections) {
  const counts = new Map();
  for (const s of sections) {
    for (const k of Object.keys(s.props)) {
      const m = /^xpos(\d+)x(\d+)$/.exec(k);
      if (m) counts.set(m[1] + 'x' + m[2], (counts.get(m[1] + 'x' + m[2]) || 0) + 1);
    }
  }
  let best = null, n = 0;
  for (const [k, c] of counts) if (c > n) { n = c; best = k; }
  if (!best) return null;
  const [w, h] = best.split('x').map(Number);
  return { w, h, key: best };
}

// → { res: { w, h } | null, rects: [{ name, x, y, w, h, guess }] }, every rect in EverQuest pixels.
function visibleUiRects(text, opts) {
  const skip = opts && opts.skip instanceof RegExp ? opts.skip : null;
  const sections = parseSections(text);
  const res = dominantResolution(sections);
  const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
  const rects = [];
  for (const s of sections) {
    const p = s.props;
    if (!SHOWN_RE.test(String(p.show == null ? '' : p.show).trim())) continue;
    if (skip && skip.test(s.name)) continue;
    const gx = res && p['xpos' + res.key] != null ? p['xpos' + res.key] : p.xpos;
    const gy = res && p['ypos' + res.key] != null ? p['ypos' + res.key] : p.ypos;
    const x = num(gx), y = num(gy);
    if (x == null || y == null) continue;
    const rw = num(p.width != null ? p.width : p['size.cx']);
    const rh = num(p.height != null ? p.height : p['size.cy']);
    const guess = rw == null || rh == null;
    const w = guess ? 200 : rw, h = guess ? 100 : rh;
    if (w <= 0 || h <= 0 || x < -50 || y < -50) continue;
    rects.push({ name: s.name, x, y, w, h, guess });
  }
  return { res: res ? { w: res.w, h: res.h } : null, rects };
}

module.exports = { visibleUiRects, parseSections, dominantResolution };
