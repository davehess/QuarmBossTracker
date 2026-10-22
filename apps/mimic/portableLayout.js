// portableLayout.js — a Canvas layout as a file that fits any screen (Keepers of the (Overlay) Arts,
// DESIGN-keepers-of-the-arts.md "Portable format"; the guild lead, 2026-10-19: "make it so overlays are
// exportable into file and importable if people want to share privately but also encourage people to
// share publicly and then they can have their name on the overlay").
//
// The Canvas keeps a panel's place as a fraction of the DISPLAY and its size in pixels, so a 1440p
// layout is a third too big at 1080p and a left-hand column drifts on an ultrawide. A portable layout
// instead says, for each group of panels (the pieces that share a `grp`, or one panel on its own):
//   - which edge or centre of EverQuest's window it is pinned to (tl tc tr / ml mc mr / bl bc br),
//   - how far it sits from that point, and each panel's offset inside the group,
// with every length written in units of the reference height (EQ's client height, or the display's when
// EQ's window is not known) and text scale normalised to a 1080-tall reference. Importing multiplies by
// the importer's own reference height and pins to the same edges, so a left column stays left on an
// ultrawide and a centred cast bar stays centred.
//
// Everything private is left behind: character names (a timers panel's name filters and every free-text
// panel name), the saved-group links and hotkeys, panel and group ids, window rects, file paths, and the
// state of the chooser. The author byline is blank unless the person types one.
//
// A file from outside is untrusted. validate() REBUILDS the document from a whitelist: unknown keys are
// never copied, every number is range-checked, every string is capped and cleaned, and anything malformed
// refuses the whole file. Nothing in it is ever evaluated. This file is pure (no Electron, no fs) so
// tests run it as it ships.
'use strict';

const FORMAT = 'mimic-layout';
const VERSION = 1;
const MAX_BYTES = 256 * 1024;   // a real layout is a few KB; this bounds the read, not a layout
const MAX_PANELS = 150;         // canvas.html MAX_PANELS
const MAX_GROUPS = 60;
const BASE_H = 1080;            // the height text scale is normalised to

const MODES = ['raid', 'group', 'pvp', 'charm', 'leveling', 'solo', 'other'];
const CLASSES = ['Warrior', 'Cleric', 'Paladin', 'Ranger', 'Shadow Knight', 'Druid', 'Monk', 'Bard', 'Rogue',
  'Shaman', 'Necromancer', 'Wizard', 'Magician', 'Enchanter', 'Beastlord'];
const WHEN = ['combat', 'nocombat', 'target', 'npc', 'raid', 'charming'];
// A timers panel's claim by group (canvas.html GROUPS), with the label the Canvas calls the panel.
const TIMER_LABELS = { charm: 'Charm', trigger: 'Trigger countdowns', lull: 'Lulls', mez: 'Mezzes',
  spell: 'My spells on mobs', tick: 'Server tick', loot: 'Loot bids' };
const ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];

const RX_PART = /^[a-z]+\.[A-Za-z0-9_]+$/;
const RX_MODE = /^[a-z]{2,10}$/;
const RX_KEY = /^[A-Za-z]{2,16}$/;
const RX_SECT = /^[a-z][a-z0-9-]{0,23}$/;
const RX_COLOR = /^#[0-9a-fA-F]{6}$/;

const fail = (error) => ({ ok: false, error });
const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const r3 = (n) => Math.round(n * 1e3) / 1e3;
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Free text from a person: one line, no control or direction-flipping characters, capped.
const cleanText = (s, max) => String(s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max).trim();

// ── The reference rect ──────────────────────────────────────────────────────
// screen: { width, height } of the display the Canvas covers. eqRect: EverQuest's client rect in that
// display's own pixels, or null. An EQ rect that is not mostly on this display (another monitor, a
// minimised window) is ignored and the display is the reference.
function readScreen(s) {
  if (!s || !isNum(s.width) || !isNum(s.height) || s.width < 320 || s.height < 240 || s.width > 20000 || s.height > 20000) return null;
  return { width: s.width, height: s.height };
}
function pickRef(S, eq) {
  if (eq && isNum(eq.x) && isNum(eq.y) && isNum(eq.width) && isNum(eq.height) && eq.width >= 320 && eq.height >= 240) {
    const ix = Math.max(0, Math.min(S.width, eq.x + eq.width) - Math.max(0, eq.x));
    const iy = Math.max(0, Math.min(S.height, eq.y + eq.height) - Math.max(0, eq.y));
    if (ix * iy >= 0.5 * eq.width * eq.height) return { x: eq.x, y: eq.y, w: eq.width, h: eq.height, of: 'eq' };
  }
  return { x: 0, y: 0, w: S.width, h: S.height, of: 'screen' };
}
// The point of the rect an anchor code names, in the rect's own pixels.
function anchorPoint(R, code) {
  const row = code[0], col = code[1];
  return {
    x: col === 'l' ? 0 : col === 'c' ? R.w / 2 : R.w,
    y: row === 't' ? 0 : row === 'm' ? R.h / 2 : R.h,
  };
}
// The nearest edge or centre, per axis, of a box in the rect's pixels (a tie goes to the centre).
function nearestAnchor(R, box) {
  const dl = Math.abs(box.left), dr = Math.abs(R.w - box.right), dc = Math.abs((box.left + box.right) / 2 - R.w / 2);
  const dt = Math.abs(box.top), db = Math.abs(R.h - box.bottom), dm = Math.abs((box.top + box.bottom) / 2 - R.h / 2);
  const col = (dc <= dl && dc <= dr) ? 'c' : (dl <= dr ? 'l' : 'r');
  const row = (dm <= dt && dm <= db) ? 'm' : (dt <= db ? 't' : 'b');
  return row + col;
}

// ── Strict readers (validate) ───────────────────────────────────────────────
function readBool(o, k, where) {
  const v = own(o, k);
  if (v === undefined) return false;
  if (typeof v !== 'boolean') throw new Error(`${where}: "${k}" must be true or false`);
  return v;
}
function readNum(o, k, lo, hi, where) {
  const v = own(o, k);
  if (!isNum(v) || v < lo || v > hi) throw new Error(`${where}: "${k}" must be a number from ${lo} to ${hi}`);
  return v;
}
function readEnum(o, k, list, where) {
  const v = own(o, k);
  if (v === undefined || v === '') return '';
  if (typeof v !== 'string' || !list.includes(v)) throw new Error(`${where}: "${k}" is not one this Mimic knows`);
  return v;
}
function readStr(o, k, rx, max, where, required) {
  const v = own(o, k);
  if (v === undefined || v === '') { if (required) throw new Error(`${where}: "${k}" is missing`); return ''; }
  if (typeof v !== 'string' || v.length > max || !rx.test(v)) throw new Error(`${where}: "${k}" is not valid`);
  return v;
}
function readList(o, k, allowed, max, where) {
  const v = own(o, k);
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw new Error(`${where}: "${k}" must be a short list`);
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string' || !allowed.includes(x)) throw new Error(`${where}: "${k}" has a value this Mimic does not know`);
    if (!out.includes(x)) out.push(x);
  }
  return out;
}
// The HUD ring's arc (parts.js cleanArc), every number clamped.
function readArc(a, where) {
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) throw new Error(`${where}: "arc" is not valid`);
  const num = (k, lo, hi, d) => {
    const v = own(a, k);
    if (v === undefined) return d;
    if (!isNum(v)) throw new Error(`${where}: arc "${k}" is not a number`);
    return clamp(v, lo, hi);
  };
  if (!isNum(own(a, 'r')) || !isNum(own(a, 'a0')) || !isNum(own(a, 'a1'))) throw new Error(`${where}: "arc" needs r, a0 and a1`);
  const r = clamp(a.r, 30, 198), a0 = clamp(a.a0, -360, 360), below = readBool(a, 'below', where);
  return { r: Math.round(r * 10) / 10, a0: Math.round(a0 * 10) / 10, a1: Math.round(clamp(a.a1, a0 + 1, a0 + 360) * 10) / 10,
    w: num('w', 0.5, 24, 3.3), ls: num('ls', 4, 24, 11), lr: num('lr', 20, 199, r + (below ? 15 : 10)),
    rev: readBool(a, 'rev', where), below };
}

// One panel of a group, rebuilt field by field. Throws a plain-language Error on anything off.
function readPanel(p, where) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`${where}: not a piece`);
  const kind = own(p, 'kind');
  const out = { kind };
  if (!['part', 'sect', 'overlay', 'callouts', 'timers'].includes(kind)) throw new Error(`${where}: unknown kind`);
  out.dx = r5(readNum(p, 'dx', -6, 6, where));
  out.dy = r5(readNum(p, 'dy', -6, 6, where));
  out.w = r5(readNum(p, 'w', 0.005, 6, where));
  out.h = r5(readNum(p, 'h', 0.005, 4, where));
  out.scale = r3(readNum(p, 'scale', 0.05, 8, where));
  if (readBool(p, 'off', where)) out.off = true;
  const when = readEnum(p, 'when', WHEN, where);
  if (when) out.when = when;
  const cls = readList(p, 'cls', CLASSES, CLASSES.length, where);
  if (cls.length) out.cls = CLASSES.filter(c => cls.includes(c));
  if (kind === 'part') {
    out.part = readStr(p, 'part', RX_PART, 40, where, true);
    const mode = readStr(p, 'mode', RX_MODE, 10, where, false);
    if (mode) out.mode = mode;
    if (readBool(p, 'back', where)) out.back = true;
    if (readBool(p, 'nolabel', where)) out.nolabel = true;
    const thick = readEnum(p, 'thick', ['thin', 'thick'], where);
    if (thick) out.thick = thick;
    const color = readStr(p, 'color', RX_COLOR, 7, where, false);
    if (color) out.color = color;
    const align = readEnum(p, 'align', ['c', 'r'], where);
    if (align) out.align = align;
    const arc = readArc(own(p, 'arc'), where);
    if (arc) out.arc = arc;
  } else if (kind === 'sect') {
    out.key = readStr(p, 'key', RX_KEY, 16, where, true);
    out.sect = readStr(p, 'sect', RX_SECT, 24, where, true);
    out.pw = Math.round(readNum(p, 'pw', 160, 2400, where));
    out.ph = Math.round(readNum(p, 'ph', 120, 3000, where));
  } else if (kind === 'overlay') {
    out.key = readStr(p, 'key', RX_KEY, 16, where, true);
    const style = readEnum(p, 'style', ['hud', 'a'], where);
    if (style) out.style = style;
  } else {
    // callouts and timers: which way the text grows, and (timers) what the panel claims.
    out.grow = readEnum(p, 'grow', ['top', 'bottom'], where) || 'bottom';
    if (kind === 'timers') {
      if (readBool(p, 'all', where)) out.all = true;
      const groups = readList(p, 'groups', Object.keys(TIMER_LABELS), 8, where);
      if (groups.length) out.groups = groups;
    }
  }
  return out;
}

// What the layout needs from the Mimic that opens it, computed from the pieces — never trusted from the file.
function needsOf(groups) {
  const parts = new Set(), overlays = new Set(), sections = new Set();
  for (const g of groups) for (const p of g.panels) {
    if (p.kind === 'part') parts.add(p.part);
    else if (p.kind === 'overlay') overlays.add(p.key);
    else if (p.kind === 'sect') { overlays.add(p.key); sections.add(p.key + ':' + p.sect); }
  }
  return { parts: [...parts].sort(), overlays: [...overlays].sort(), sections: [...sections].sort() };
}

// Whatever came in (a parsed object) → { ok, doc } with a document rebuilt from the whitelist, or { ok:false, error }.
function validate(raw) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || own(raw, 'format') !== FORMAT) {
      return fail('That file is not a Mimic layout.');
    }
    const ver = own(raw, 'version');
    if (!Number.isInteger(ver) || ver < 1) return fail('That layout has no valid version.');
    if (ver > VERSION) return fail('That layout was made by a newer Mimic. Update Mimic to open it.');
    if (own(raw, 'kind') !== 'canvas') return fail('That layout is not a Canvas layout.');

    const m = own(raw, 'meta');
    if (!m || typeof m !== 'object' || Array.isArray(m)) return fail('That layout has no details block.');
    const text = (k, max) => {
      const v = own(m, k);
      if (v === undefined || v === null) return '';
      if (typeof v !== 'string') throw new Error(`"${k}" must be text`);
      return cleanText(v, max);
    };
    const classes = readList(m, 'classes', CLASSES, CLASSES.length, 'details');
    const modes = readList(m, 'modes', MODES, MODES.length, 'details');
    const meta = {
      title: text('title', 60) || 'Untitled layout',
      description: text('description', 280),
      author: text('author', 32),
      classes: CLASSES.filter(c => classes.includes(c)),
      modes: MODES.filter(c => modes.includes(c)),
    };

    const refIn = own(raw, 'ref');
    let ref = { of: 'screen', aspect: r3(16 / 9) };
    if (refIn !== undefined) {
      if (!refIn || typeof refIn !== 'object') return fail('That layout has a bad reference block.');
      const of = own(refIn, 'of');
      const aspect = own(refIn, 'aspect');
      if ((of !== 'eq' && of !== 'screen') || !isNum(aspect) || aspect < 0.5 || aspect > 8) return fail('That layout has a bad reference block.');
      ref = { of, aspect: r3(aspect) };
    }

    const gin = own(raw, 'groups');
    if (!Array.isArray(gin) || !gin.length || gin.length > MAX_GROUPS) return fail('That layout has no pieces, or too many groups.');
    const groups = [];
    let total = 0;
    gin.forEach((g, gi) => {
      const gw = `group ${gi + 1}`;
      if (!g || typeof g !== 'object' || Array.isArray(g)) throw new Error(`${gw}: not a group`);
      const anchor = own(g, 'anchor');
      if (!ANCHORS.includes(anchor)) throw new Error(`${gw}: "anchor" is not one of ${ANCHORS.join(' ')}`);
      const ps = own(g, 'panels');
      if (!Array.isArray(ps) || !ps.length) throw new Error(`${gw}: no pieces`);
      total += ps.length;
      if (total > MAX_PANELS) throw new Error(`more than ${MAX_PANELS} pieces`);
      groups.push({
        anchor, ox: r5(readNum(g, 'ox', -6, 6, gw)), oy: r5(readNum(g, 'oy', -6, 6, gw)),
        panels: ps.map((p, pi) => readPanel(p, `${gw}, piece ${pi + 1}`)),
      });
    });
    return { ok: true, doc: { format: FORMAT, version: VERSION, kind: 'canvas', meta, needs: needsOf(groups), ref, groups } };
  } catch (e) {
    return fail(`That layout is damaged: ${e && e.message ? e.message : 'unreadable'}.`);
  }
}

// The text of a file → validate(), with the size cap and a JSON parse that cannot run anything.
function parse(text) {
  if (typeof text !== 'string') return fail('That file could not be read.');
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return fail('That file is too big to be a Mimic layout.');
  let raw;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch { return fail('That file is not a Mimic layout (it is not valid JSON).'); }
  return validate(raw);
}

// ── Canvas layout → portable document ───────────────────────────────────────
// src: a Canvas layout ({ panels }, positions as fractions of the display, sizes in pixels).
// meta: { title, description, author, classes, modes } — all optional; the byline is blank unless given.
// → { ok, doc } | { ok:false, error }.
function toPortable(src, screen, eqRect, meta) {
  if (!src || !Array.isArray(src.panels)) return fail('There is no Canvas layout to export yet.');
  const S = readScreen(screen);
  if (!S) return fail('Mimic could not tell the screen size.');
  const R = pickRef(S, eqRect);
  const u = R.h;

  // A panel as place() draws it: top-left from the fractions, clamped on the display, in the rect's pixels.
  const clusters = new Map();
  let solo = 0;
  for (const p of src.panels.slice(0, MAX_PANELS)) {
    if (!p || typeof p !== 'object' || !isNum(p.x) || !isNum(p.y) || !isNum(p.w) || !isNum(p.h)) continue;
    const w = Math.min(p.w, S.width), h = Math.min(p.h, S.height);
    const left = clamp(Math.round(p.x * S.width), 0, S.width - w) - R.x;
    const top = clamp(Math.round(p.y * S.height), 0, S.height - h) - R.y;
    const key = (typeof p.grp === 'string' && p.grp) ? 'g:' + p.grp : 's:' + (solo++);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push({ p, left, top, w, h });
  }

  const groups = [];
  for (const items of clusters.values()) {
    const box = {
      left: Math.min(...items.map(i => i.left)), top: Math.min(...items.map(i => i.top)),
      right: Math.max(...items.map(i => i.left + i.w)), bottom: Math.max(...items.map(i => i.top + i.h)),
    };
    const anchor = nearestAnchor(R, box);
    const A = anchorPoint(R, anchor);
    // The box's own point that the anchor holds: its left/centre/right and top/middle/bottom.
    const P = {
      x: anchor[1] === 'l' ? box.left : anchor[1] === 'c' ? (box.left + box.right) / 2 : box.right,
      y: anchor[0] === 't' ? box.top : anchor[0] === 'm' ? (box.top + box.bottom) / 2 : box.bottom,
    };
    const panels = [];
    for (const { p, left, top, w, h } of items) {
      const q = {
        kind: p.kind, dx: (left - P.x) / u, dy: (top - P.y) / u, w: w / u, h: h / u,
        scale: (isNum(p.scale) ? p.scale : 1) * BASE_H / u,
      };
      if (p.off) q.off = true;
      if (typeof p.when === 'string') q.when = p.when;
      if (Array.isArray(p.cls)) q.cls = p.cls;
      if (p.kind === 'part') {
        Object.assign(q, { part: p.part, mode: p.mode, back: p.back, nolabel: p.nolabel, thick: p.thick, color: p.color, align: p.align, arc: p.arc });
      } else if (p.kind === 'sect') {
        Object.assign(q, { key: p.key, sect: p.sect, pw: p.pw, ph: p.ph });
      } else if (p.kind === 'overlay') {
        Object.assign(q, { key: p.key, style: p.style });
      } else {
        q.grow = p.anchor === 'top' ? 'top' : 'bottom';
        if (p.kind === 'timers') { q.all = !!p.all; q.groups = Array.isArray(p.groups) ? p.groups : []; }
      }
      // A piece this Mimic cannot describe cleanly is left out rather than failing the whole export.
      try { panels.push(readPanel(q, 'piece')); } catch { /* skip it */ }
    }
    if (panels.length) groups.push({ anchor, ox: (P.x - A.x) / u, oy: (P.y - A.y) / u, panels });
  }
  if (!groups.length) return fail('There is nothing on the Canvas to export yet.');

  const m = meta || {};
  const derived = new Set();
  groups.forEach(g => g.panels.forEach(p => (p.cls || []).forEach(c => derived.add(c))));
  const doc = {
    format: FORMAT, version: VERSION, kind: 'canvas',
    meta: {
      title: typeof m.title === 'string' ? m.title : '',
      description: typeof m.description === 'string' ? m.description : '',
      author: typeof m.author === 'string' ? m.author : '',
      classes: Array.isArray(m.classes) ? m.classes : [...derived],
      modes: Array.isArray(m.modes) ? m.modes : [],
    },
    ref: { of: R.of, aspect: r3(R.w / R.h) },
    groups,
  };
  // The same gate a file coming in passes: only what would be accepted is written.
  return validate(doc);
}

// ── Portable document → Canvas layout for this screen ───────────────────────
// doc: a parsed document (it is validated again here). opts.stamp makes the new ids repeatable in tests.
// → { ok, layout: { panels }, count } | { ok:false, error }. Panels carry fresh ids and fresh group ids.
function fromPortable(docIn, screen, eqRect, opts) {
  const v = validate(docIn);
  if (!v.ok) return v;
  const S = readScreen(screen);
  if (!S) return fail('Mimic could not tell the screen size.');
  const R = pickRef(S, eqRect);
  const k = R.h;
  const stamp = String((opts && opts.stamp) || Date.now().toString(36)).slice(0, 8);
  let n = 0;
  const panels = [];
  v.doc.groups.forEach((g, gi) => {
    const A = anchorPoint(R, g.anchor);
    const px = R.x + A.x + g.ox * k, py = R.y + A.y + g.oy * k;
    const rects = g.panels.map(q => ({ q, left: px + q.dx * k, top: py + q.dy * k, w: q.w * k, h: q.h * k }));
    // Keep the whole group on the display: slide it, never squash it.
    const bx = Math.min(...rects.map(r => r.left)), by = Math.min(...rects.map(r => r.top));
    const bx2 = Math.max(...rects.map(r => r.left + r.w)), by2 = Math.max(...rects.map(r => r.top + r.h));
    let sx = 0, sy = 0;
    if (bx2 > S.width) sx = S.width - bx2;
    if (bx + sx < 0) sx = -bx;
    if (by2 > S.height) sy = S.height - by2;
    if (by + sy < 0) sy = -by;
    const grp = g.panels.length > 1 ? ('g' + stamp + gi.toString(36)).slice(0, 24) : null;
    for (const { q, left, top, w, h } of rects) {
      const W = Math.round(w), H = Math.round(h);
      const x = clamp(left + sx, 0, Math.max(0, S.width - W)) / S.width;
      const y = clamp(top + sy, 0, Math.max(0, S.height - H)) / S.height;
      const scale = r3(clamp(q.scale * k / BASE_H, 0.5, 3));
      const base = { id: ('i' + stamp + (n++).toString(36)).slice(0, 24), kind: q.kind, name: '',
        x: r5(x), y: r5(y), w: W, h: H, scale, grp, off: !!q.off };
      if (q.when) base.when = q.when;
      if (q.cls) base.cls = q.cls.slice();
      if (q.kind === 'part') {
        Object.assign(base, { part: q.part, mode: q.mode || '', back: !!q.back, nolabel: !!q.nolabel,
          thick: q.thick || '', color: q.color || '', align: q.align || '', arc: q.arc ? Object.assign({}, q.arc) : null });
      } else if (q.kind === 'sect') {
        Object.assign(base, { key: q.key, sect: q.sect, pw: q.pw, ph: q.ph });
      } else if (q.kind === 'overlay') {
        Object.assign(base, { key: q.key, style: q.style || '' });
      } else {
        base.anchor = q.grow;
        if (q.kind === 'timers') {
          base.all = !!q.all; base.groups = (q.groups || []).slice(); base.names = [];
          if (!base.all && base.groups.length === 1) base.name = TIMER_LABELS[base.groups[0]];
        }
      }
      panels.push(base);
    }
  });
  return { ok: true, layout: { panels }, count: panels.length };
}

// A short, safe summary of a validated document for a preview.
function describe(doc) {
  const n = doc.groups.reduce((a, g) => a + g.panels.length, 0);
  return { title: doc.meta.title, author: doc.meta.author, description: doc.meta.description,
    pieces: n, classes: doc.meta.classes, modes: doc.meta.modes, needs: doc.needs };
}

// A file name from a title: letters, digits, dashes.
function fileStem(title) {
  return cleanText(title || '', 40).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'layout';
}

module.exports = { FORMAT, VERSION, MAX_BYTES, MAX_PANELS, BASE_H, MODES, CLASSES, ANCHORS,
  toPortable, fromPortable, validate, parse, describe, fileStem };
