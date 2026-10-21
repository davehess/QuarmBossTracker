// overlaySizes.js — the width presets of an overlay's right-click menu (XS … XL), in ONE place.
//
// The guild lead, 2026-10-21: "Canvas frames need the resizing, basically all of the options that we have from
// the normal overlays need to be present for these". The presets used to live inside main.js's
// overlay-resize-preset handler, so a Canvas frame had nothing to offer that matched. Now the window's handler
// (main.js) and the Canvas's Width row (canvas.html) read this one table; the labels the window's menu draws
// (preload.js) cannot require a file, so test/canvas-parity.test.js holds them to it.
//
// L is 420, not 400: at 400 the DPS HUD's title row (−/+, DPS, Tank, History) ran under the ✕ (a member,
// 2026-09-24). XS is the overlay minimum (FB-38): twelve overlays were built with a 220–300 minimum, so one
// number now.
(function (root) {
  'use strict';
  var MIN_W = 200;
  var PRESETS = [['xs', 'XS', MIN_W], ['sm', 'S', 260], ['md', 'M', 320], ['lg', 'L', 420], ['xl', 'XL', 500]];
  // The width a preset key gives (any case), or 0 for a key that is not one.
  function widthOf(key) {
    var k = String(key == null ? '' : key).toLowerCase();
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i][0] === k) return PRESETS[i][2];
    return 0;
  }
  var api = { MIN_W: MIN_W, PRESETS: PRESETS, widthOf: widthOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WpSizes = api;
})(typeof window !== 'undefined' ? window : this);
