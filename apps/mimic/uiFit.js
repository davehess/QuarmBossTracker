// uiFit.js — moving an EverQuest window layout from one screen size to another. ONE rule, used by both places that
// do it: UI Studio's "Load + Rescale" (ui-studio.html, as a <script>) and the compare-first bring-in
// (uiRestorePlan.js fitLayout, by require). Before this file each had its own copy and they disagreed.
//
// What an EverQuest UI ini gives us (see uiClearRects.js for the keys): a window's POSITION is stored per screen
// size (XPos1920x1080), its SIZE is one bare Width/Height shared by every screen size, and most windows have no
// size at all because the skin fixes it.
//
// The old rule moved the top-left corner in proportion and left the size alone. A window docked to the right edge
// of a 2560 screen then landed a quarter of its own width off a 1920 one, and everything overlapped (the guild lead,
// 2026-11-14, FB-132: "Import did not resize correctly onto this 1080 monitor from 1440p"; "its off the page").
//
// The rule here:
//   1. A window keeps its PLACE IN THE FREE SPACE, not its corner. Flush left stays flush left, flush right stays
//      flush right, centred stays centred, and everything between moves in proportion. It is the same as scaling
//      the point of the window that sits the same fraction of the way across it as the window sits across the
//      screen. A window that fits the new screen therefore always ends up wholly on it.
//   2. A CHAT window is resized in proportion (its width by the width ratio, its height by the height ratio). Chat
//      windows are the ones people size by hand, and they are most of a layout's area. For a window whose size
//      scales, rule 1 gives exactly corner-times-ratio, so a layout made of chat windows keeps its shape.
//   3. Every other window keeps its size. The skin fixes most of them, and shrinking a fixed window drove the
//      Merchant, Loot and Trade windows into their minimum-size clamp once already (#146, 2026-07).
//
// Pure: no DOM, no fs, no Electron. test/ui-fit.test.js runs it as it ships.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UiFit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The stand-in for a window whose size is stated nowhere (no Width/Height, no skin size): what UI Studio draws
  // and what uiClearRects assumes.
  var GUESS_W = 200, GUESS_H = 100;
  // A chat window is never shrunk below this (or below its own size, when it is already smaller).
  var MIN_CHAT_W = 120, MIN_CHAT_H = 60;
  // How far past an edge still counts as parked there on purpose, not as lost off the screen.
  var TUCK = 16;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function num(v) { var n = typeof v === 'number' ? v : parseInt(v, 10); return isFinite(n) ? n : null; }

  // The sections that hold a chat window's place: MainChat and "Chat N" (also written ChatN).
  function isChatSection(name) { return /^(mainchat|chat\s*\d+)$/i.test(String(name == null ? '' : name).trim()); }

  // One axis. pos/size on a screen srcLen long -> the position on one tgtLen long, the window now newSize long.
  // A window tucked a few pixels past an edge (people park a chat window at -5 to hide its border) keeps the same
  // tuck on the same edge. Anything further out is brought to the edge.
  function fitAxis(pos, size, srcLen, tgtLen, newSize) {
    var freeT = tgtLen - newSize;
    if (!(freeT > 0)) return 0;                       // as long as the screen, or longer: start at the edge
    var freeS = srcLen - size;
    if (pos < 0 && pos >= -TUCK) return pos;
    if (freeS > 0 && pos > freeS && pos - freeS <= TUCK) return freeT + (pos - freeS);
    var frac = freeS > 0 ? clamp(pos / freeS, 0, 1) : 0;
    return Math.round(frac * freeT);
  }

  // rect { x, y, w, h } on a src { w, h } screen -> { x, y, w, h, resized } on a tgt { w, h } screen.
  // opts.resize: scale the size too (a chat window). With src equal to tgt this only brings the window on screen.
  function fitRect(rect, src, tgt, opts) {
    var w = Math.max(1, num(rect.w) || GUESS_W), h = Math.max(1, num(rect.h) || GUESS_H);
    var x = num(rect.x) || 0, y = num(rect.y) || 0;
    var sw = num(src && src.w), sh = num(src && src.h), tw = num(tgt && tgt.w), th = num(tgt && tgt.h);
    if (!(tw > 0 && th > 0)) return { x: x, y: y, w: w, h: h, resized: false };
    if (!(sw > 0 && sh > 0)) { sw = tw; sh = th; }    // screen size unknown: keep the numbers, only bring it on screen
    var nw = w, nh = h;
    if (opts && opts.resize && (sw !== tw || sh !== th)) {
      nw = clamp(Math.round(w * tw / sw), Math.min(w, MIN_CHAT_W), tw);
      nh = clamp(Math.round(h * th / sh), Math.min(h, MIN_CHAT_H), th);
    }
    return { x: fitAxis(x, w, sw, tw, nw), y: fitAxis(y, h, sh, th, nh), w: nw, h: nh, resized: nw !== w || nh !== h };
  }

  // Does the window hang past an edge of the screen by more than a deliberate tuck?
  function isOffScreen(rect, screen) {
    var x = num(rect.x) || 0, y = num(rect.y) || 0, w = num(rect.w) || 0, h = num(rect.h) || 0;
    return x < -TUCK || y < -TUCK || x + w > screen.w + TUCK || y + h > screen.h + TUCK;
  }

  // "2560x1440" -> { w, h }, or null.
  function parseRes(s) {
    var m = /^(\d+)x(\d+)$/i.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var w = parseInt(m[1], 10), h = parseInt(m[2], 10);
    return w > 0 && h > 0 ? { w: w, h: h } : null;
  }

  return { GUESS_W: GUESS_W, GUESS_H: GUESS_H, MIN_CHAT_W: MIN_CHAT_W, MIN_CHAT_H: MIN_CHAT_H, TUCK: TUCK,
    isChatSection: isChatSection, fitAxis: fitAxis, fitRect: fitRect, isOffScreen: isOffScreen, parseRes: parseRes };
});
