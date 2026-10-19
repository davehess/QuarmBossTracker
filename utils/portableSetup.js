// utils/portableSetup.js — the bot's check of a whole-setup bundle before it is held for a share code
// (the guild lead, 2026-10-19, DECISIONS §383: "Share a whole setup = A, file + share code").
//
// The bundle is made and opened by Mimic (apps/mimic/portableSetup.js, on the beta branch). The bot holds it for 24 hours
// and hands it to another signed-in member, so this is a gate and not a parser: it rebuilds the document from a whitelist,
// bounds every list and string, validates each embedded Canvas layout with the SAME validator the gallery uses
// (utils/portableLayout.js), and REFUSES the whole bundle when anything in it looks like a secret or a path on someone's
// machine. Mimic checks all of this again on import, because a code is only as trustworthy as the person who made it.
//
// Format (version 1), every field optional except format and version:
//   format "mimic-setup", version 1
//   meta      { title <=60, byline <=32, note <=280 }                  typed by the sharer, shown in the preview
//   slots     [{ slot "c1".."c12", label <=24 }]                       the sharer's characters, by NUMBER, never by name
//   layouts   [{ name <=40, active bool, doc <mimic-layout> }] <=40    Canvas layouts, each run through portableLayout
//   options   { <overlay key>: { plain values } }                      per-overlay options (DPS HUD, Melody, ...)
//   hud       [{ slot, parts: { plain values } }]                      the HUD builder, per character
//   triggers  [{ for: [slot], trigger: { plain values } }]             personal triggers; for [] = every character
//   rules     { <rule key>: { all: mode, c1: mode } }                  "What you hear" (speak, overlay, off); cells per slot
//
// Never in a bundle (refused, not stripped): the sign-in and any token, EQ and log paths, file paths of any kind, Discord
// webhooks, the OpenDKP login, bids, the updater channel. Names of the sharer's characters travel as slot numbers only.
'use strict';

const portableLayout = require('./portableLayout');

const FORMAT = 'mimic-setup';
const VERSION = 1;
const MAX_BYTES = 512 * 1024;

const MAX_LAYOUTS = 40;
const MAX_SLOTS = 12;
const MAX_OPTION_GROUPS = 40;
const MAX_TRIGGERS = 1000;
const MAX_RULES = 2000;
const MAX_STRING = 2000;
const MAX_KEYS = 200;          // keys in one plain object
const MAX_ITEMS = 500;         // items in one plain array
const MAX_DEPTH = 8;
const MAX_NODES = 60000;       // values in the whole bundle: bounds the work however the bytes are spent

const RX_SLOT = /^c(?:[1-9]|1[0-2])$/;
const RX_OVERLAY_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
// "What you hear" (the agent's trigger_rules.json): TRIGGER_RULE_MODES, and the key shapes the agent's own sync accepts.
const RULE_MODES = ['speak', 'overlay', 'off'];
const RX_RULE_KEY = /^(?:group|guild|personal|builtin):[^\u0000-\u001f]{1,200}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

// A key that names something private. Matched on the key with separators and case removed, so "api_key", "ApiKey" and
// "API-KEY" are one thing. Long stems match anywhere in the key; the short ones (bid, session, dir) only as the WHOLE key
// or a known compound, because "forbid", "sessionTable" and "sortDir" are ordinary settings.
const SECRET_STEMS = ['token', 'secret', 'password', 'passwd', 'apikey', 'cookie', 'credential', 'webhook',
  'authorization', 'bearer', 'discordid', 'oauth'];
const PRIVATE_ENDS = ['path', 'directory', 'folder'];
const PRIVATE_WHOLE = ['session', 'sessionid', 'mimicsession', 'eqdir', 'logdir', 'bid', 'bids', 'bidding', 'bidamount', 'bidamounts'];

// A value that looks like one. Never echoed back: the error names the place, not the text.
const SECRET_VALUES = [
  /\bwpms_[0-9a-f]{16,}/i,                                   // a Mimic session token
  /discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\//i,       // a Discord webhook
  /\b[\w-]{23,28}\.[\w-]{6,7}\.[\w-]{27,}\b/,                // a Discord bot or user token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/,                      // an Authorization header
  /^\s*[A-Za-z]:[\\/]/,                                      // C:\... or C:/...
  /[A-Za-z]:[\\/](?:users|program files|windows|documents|eq|everquest|games)\b/i,   // the same, further into a sentence
  /^\s*\\\\[^\\]/,                                           // \\server\share
  /^\s*file:/i,
  /^\s*(?:\/(?:home|Users|root|mnt)\/)/,                     // a path on a Mac or Linux box
];

const fail = (error) => ({ ok: false, error });
class Refuse extends Error {}

function _keyLooksPrivate(key) {
  const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  return SECRET_STEMS.some(x => k.includes(x)) || PRIVATE_WHOLE.includes(k) || PRIVATE_ENDS.some(e => k.endsWith(e));
}
function _valueLooksPrivate(s) { return SECRET_VALUES.some(rx => rx.test(s)); }

// Free text typed by a person: one line, no control or direction-flipping characters, capped.
const cleanText = (s, max) => String(s).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, max).trim();

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const own = (o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k)) ? o[k] : undefined;

// A plain JSON value, copied: no function, no prototype tricks, bounded depth/width/length, nothing private in a key or a
// string. `budget.n` counts every value in the whole bundle.
function cleanValue(v, where, budget, depth = 0) {
  if (++budget.n > MAX_NODES) throw new Refuse('The setup is too large.');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Refuse(`${where}: a number is not valid`);
    return v;
  }
  if (typeof v === 'string') {
    if (v.length > MAX_STRING) throw new Refuse(`${where}: a text is longer than ${MAX_STRING} characters`);
    if (_valueLooksPrivate(v)) throw new Refuse(`${where}: contains something private (a path, a link or a sign-in)`);
    return v.replace(/\u0000/g, '');
  }
  if (depth >= MAX_DEPTH) throw new Refuse(`${where}: nested too deeply`);
  if (Array.isArray(v)) {
    if (v.length > MAX_ITEMS) throw new Refuse(`${where}: a list is longer than ${MAX_ITEMS}`);
    return v.map((x, i) => cleanValue(x, `${where}[${i}]`, budget, depth + 1));
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (keys.length > MAX_KEYS) throw new Refuse(`${where}: more than ${MAX_KEYS} fields`);
    const out = {};
    for (const k of keys) {
      if (FORBIDDEN_KEYS.has(k) || k.length < 1 || k.length > 120 || /[\u0000-\u001f]/.test(k)) throw new Refuse(`${where}: a field name is not valid`);
      if (_keyLooksPrivate(k)) throw new Refuse(`${where}: has a field that looks private ("${cleanText(k, 24)}")`);
      out[k] = cleanValue(v[k], `${where}.${k}`, budget, depth + 1);
    }
    return out;
  }
  throw new Refuse(`${where}: a value of an unknown kind`);
}

function _object(v, where) {
  if (!isPlainObject(v)) throw new Refuse(`${where}: must be an object`);
  return v;
}
function _list(v, where, max) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) throw new Refuse(`${where}: must be a list of at most ${max}`);
  return v;
}

/** Whatever was posted → { ok, setup, summary, bytes } with a document rebuilt from the whitelist, or { ok:false, error }. */
function validate(raw) {
  try {
    if (!isPlainObject(raw) || own(raw, 'format') !== FORMAT) return fail('That is not a Mimic setup.');
    const ver = own(raw, 'version');
    if (!Number.isInteger(ver) || ver < 1) return fail('That setup has no valid version.');
    if (ver > VERSION) return fail('That setup was made by a newer Mimic. Update Mimic to share it.');
    const budget = { n: 0 };

    const mIn = own(raw, 'meta');
    const mObj = mIn === undefined ? {} : _object(mIn, 'details');
    const text = (k, max) => {
      const v = own(mObj, k);
      if (v === undefined || v === null) return '';
      if (typeof v !== 'string') throw new Refuse(`details: "${k}" must be text`);
      const c = cleanText(v, max);
      if (_valueLooksPrivate(c)) throw new Refuse(`details: "${k}" contains something private`);
      return c;
    };
    const meta = { title: text('title', 60) || 'A Mimic setup', byline: text('byline', 32), note: text('note', 280) };

    const slots = [];
    for (const [i, s] of _list(own(raw, 'slots'), 'characters', MAX_SLOTS).entries()) {
      const o = _object(s, `characters[${i}]`);
      const slot = own(o, 'slot');
      if (typeof slot !== 'string' || !RX_SLOT.test(slot)) throw new Refuse(`characters[${i}]: "slot" must be c1 to c12`);
      if (slots.some(x => x.slot === slot)) throw new Refuse(`characters[${i}]: "${slot}" is listed twice`);
      const label = cleanText(own(o, 'label') == null ? '' : String(own(o, 'label')), 24) || `Character ${slot.slice(1)}`;
      if (_valueLooksPrivate(label)) throw new Refuse(`characters[${i}]: the label contains something private`);
      slots.push({ slot, label });
    }
    const slotSet = new Set(slots.map(s => s.slot));
    const inSlots = (slot, where) => {
      if (typeof slot !== 'string' || !slotSet.has(slot)) throw new Refuse(`${where}: names a character slot the setup does not list`);
      return slot;
    };

    const layouts = [];
    let activeSeen = false;
    for (const [i, l] of _list(own(raw, 'layouts'), 'layouts', MAX_LAYOUTS).entries()) {
      const o = _object(l, `layouts[${i}]`);
      const name = cleanText(own(o, 'name') == null ? '' : String(own(o, 'name')), 40);
      if (!name) throw new Refuse(`layouts[${i}]: has no name`);
      const checked = portableLayout.validate(own(o, 'doc'));
      if (!checked.ok) throw new Refuse(`layouts[${i}]: ${checked.error}`);
      let active = own(o, 'active') === true;
      if (active && activeSeen) active = false;
      activeSeen = activeSeen || active;
      layouts.push({ name, active, doc: checked.doc });
    }

    const options = {};
    const oIn = own(raw, 'options');
    if (oIn !== undefined) {
      const oo = _object(oIn, 'options');
      const keys = Object.keys(oo);
      if (keys.length > MAX_OPTION_GROUPS) throw new Refuse('options: too many overlays');
      for (const k of keys) {
        if (!RX_OVERLAY_KEY.test(k) || FORBIDDEN_KEYS.has(k)) throw new Refuse('options: an overlay name is not valid');
        options[k] = cleanValue(_object(oo[k], `options.${k}`), `options.${k}`, budget);
      }
    }

    const hud = [];
    for (const [i, h] of _list(own(raw, 'hud'), 'hud', MAX_SLOTS).entries()) {
      const o = _object(h, `hud[${i}]`);
      const slot = inSlots(own(o, 'slot'), `hud[${i}]`);
      if (hud.some(x => x.slot === slot)) throw new Refuse(`hud[${i}]: "${slot}" has two builders`);
      hud.push({ slot, parts: cleanValue(_object(own(o, 'parts'), `hud[${i}].parts`), `hud[${i}].parts`, budget) });
    }

    const triggers = [];
    for (const [i, t] of _list(own(raw, 'triggers'), 'triggers', MAX_TRIGGERS).entries()) {
      const o = _object(t, `triggers[${i}]`);
      const forIn = _list(own(o, 'for'), `triggers[${i}].for`, MAX_SLOTS);
      const forSlots = [...new Set(forIn.map(s => inSlots(s, `triggers[${i}]`)))];
      triggers.push({ for: forSlots, trigger: cleanValue(_object(own(o, 'trigger'), `triggers[${i}].trigger`), `triggers[${i}].trigger`, budget) });
    }

    const rules = {};
    const rIn = own(raw, 'rules');
    if (rIn !== undefined) {
      const ro = _object(rIn, 'rules');
      const keys = Object.keys(ro);
      if (keys.length > MAX_RULES) throw new Refuse('rules: too many');
      for (const k of keys) {
        if (FORBIDDEN_KEYS.has(k) || !RX_RULE_KEY.test(k)) throw new Refuse('rules: a rule name is not valid');
        if (_valueLooksPrivate(k.slice(k.indexOf(':') + 1))) throw new Refuse('rules: a rule name contains something private');
        const modes = _object(ro[k], `rules.${cleanText(k, 40)}`);
        const row = {};
        for (const mk of Object.keys(modes)) {
          if (mk !== 'all') inSlots(mk, `rules.${cleanText(k, 40)}`);
          const mv = modes[mk];
          if (typeof mv !== 'string' || !RULE_MODES.includes(mv)) throw new Refuse(`rules.${cleanText(k, 40)}: "${cleanText(mk, 8)}" is not a mode this Mimic knows`);
          row[mk] = mv;
        }
        if (Object.keys(row).length) rules[k] = row;
      }
    }

    const setup = { format: FORMAT, version: VERSION, meta, slots, layouts, options, hud, triggers, rules };
    const bytes = Buffer.byteLength(JSON.stringify(setup), 'utf8');
    if (bytes > MAX_BYTES) return fail(`That setup is larger than ${Math.round(MAX_BYTES / 1024)} KB.`);
    const summary = { layouts: layouts.length, options: Object.keys(options).length, hud: hud.length,
      triggers: triggers.length, rules: Object.keys(rules).length, characters: slots.length };
    if (!summary.layouts && !summary.options && !summary.hud && !summary.triggers && !summary.rules) return fail('That setup has nothing in it to share.');
    return { ok: true, setup, summary, bytes };
  } catch (e) {
    if (e instanceof Refuse) return fail(e.message);
    return fail('That setup could not be read.');
  }
}

module.exports = { FORMAT, VERSION, MAX_BYTES, MAX_LAYOUTS, MAX_SLOTS, MAX_TRIGGERS, MAX_RULES, RULE_MODES, validate, cleanValue };
