// overlayBackup.js — Mimic's own overlay layout as a part of a UI Studio cloud backup (the guild lead, 2026-11-11:
// "overlay positions go into the backups too").
//
// The backup holds one extra entry next to the EverQuest files, `mimic-overlays.json`. It is not an .ini, so the
// restore guard (uiRestoreGuard.js) never lets it near the EQ folder: main.js takes it out of the downloaded bundle
// before that filter runs, and applies it as its own part, "Overlay positions".
//
// Pure (no Electron) so a test can run it directly. main.js owns the screens and the windows.
'use strict';

const FILE = 'mimic-overlays.json';
const MAX_RECTS = 80;
const KEY_RE = /^[A-Za-z0-9_:.-]{1,64}$/;            // 'hudBounds', 'panelBounds_<id>', 'canvas:<id>'
const FLAG_RE = /^show[A-Za-z]{1,32}$/;              // 'showHud', 'showTriggerOverlay' ...
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const rectOk = (r) => !!r && num(r.x) && num(r.y) && num(r.width) && num(r.height) && r.width > 0 && r.height > 0 && r.width < 20000 && r.height < 20000;

// -> the JSON text stored in the bundle.
function build({ rects, flags, sig, eq, machine, displays, now } = {}) {
  const outR = {};
  for (const [k, r] of Object.entries(rects || {})) {
    if (KEY_RE.test(k) && rectOk(r) && Object.keys(outR).length < MAX_RECTS) outR[k] = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  }
  const outF = {};
  for (const [k, v] of Object.entries(flags || {})) if (FLAG_RE.test(k) && typeof v === 'boolean') outF[k] = v;
  return JSON.stringify({
    v: 1, savedAt: now || Date.now(), machine: machine ? String(machine).slice(0, 64) : null, sig: sig ? String(sig).slice(0, 400) : '',
    displays: (displays || []).filter(rectOk).slice(0, 8), eq: rectOk(eq) ? eq : null, rects: outR, flags: outF,
  });
}

// A backup comes back from the server: take only what is the right shape. -> object or null.
function parse(text) {
  let o;
  try { o = JSON.parse(String(text)); } catch { return null; }
  if (!o || typeof o !== 'object' || o.v !== 1) return null;
  const rects = {}, flags = {};
  for (const [k, r] of Object.entries(o.rects && typeof o.rects === 'object' ? o.rects : {})) if (KEY_RE.test(k) && rectOk(r) && Object.keys(rects).length < MAX_RECTS) rects[k] = { x: r.x, y: r.y, width: r.width, height: r.height };
  for (const [k, v] of Object.entries(o.flags && typeof o.flags === 'object' ? o.flags : {})) if (FLAG_RE.test(k) && typeof v === 'boolean') flags[k] = v;
  if (!Object.keys(rects).length && !Object.keys(flags).length) return null;
  return {
    v: 1, savedAt: num(o.savedAt) ? o.savedAt : 0, machine: typeof o.machine === 'string' ? o.machine.slice(0, 64) : null,
    sig: typeof o.sig === 'string' ? o.sig.slice(0, 400) : '', displays: (Array.isArray(o.displays) ? o.displays : []).filter(rectOk).slice(0, 8),
    eq: rectOk(o.eq) ? o.eq : null, rects, flags,
  };
}

// Last guard after the screen-change plan has moved what sat on a screen that is gone: an overlay that is still
// not (at least 40 px) on any screen comes to EverQuest's screen, inside its work area. Everything on a screen is
// left exactly where it was. workAreas: [{x,y,width,height}], target: the work area of EverQuest's screen.
function landOnScreens(rects, workAreas, target) {
  const out = {};
  const seen = (r) => (workAreas || []).some(a => Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x) >= 40 &&
    Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y) >= 40);
  for (const [k, r] of Object.entries(rects || {})) {
    if (!rectOk(r)) continue;
    if (seen(r) || !target) { out[k] = { x: r.x, y: r.y, width: r.width, height: r.height }; continue; }
    const w = Math.min(r.width, target.width), h = Math.min(r.height, target.height);
    out[k] = {
      x: Math.max(target.x, Math.min(target.x + target.width - w, Math.round(r.x))),
      y: Math.max(target.y, Math.min(target.y + target.height - h, Math.round(r.y))),
      width: w, height: h,
    };
  }
  return out;
}

module.exports = { FILE, build, parse, landOnScreens };
