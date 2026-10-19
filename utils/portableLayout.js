// utils/portableLayout.js — the bot's copy of the portable Canvas layout VALIDATOR (Keepers of the Arts).
//
// The format is defined by Mimic (apps/mimic/portableLayout.js, on the beta branch, introduced in commit 11e427ed).
// Its validate() is the source of truth; the bot cannot require a beta-only Mimic file, so the READ half is copied
// here byte for byte: the constants, the whitelist readers, needsOf(), validate() and parse(). The export half
// (toPortable / fromPortable, the reference-rect maths) lives only in Mimic.
//
// Do not edit the copied lines by hand. test/gallery-portable.test.js runs this validate() against Mimic's own on
// a corpus (and against a fixture produced by Mimic's toPortable) and fails on any difference, so a change to the
// format on beta shows up as a red test here. To update: re-copy the same line ranges from the new beta file.
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
const WHEN = ['combat', 'nocombat', 'target', 'npc', 'raid'];
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


module.exports = { FORMAT, VERSION, MAX_BYTES, MAX_PANELS, MAX_GROUPS, BASE_H, MODES, CLASSES, ANCHORS, WHEN, TIMER_LABELS,
  validate, parse, needsOf };
