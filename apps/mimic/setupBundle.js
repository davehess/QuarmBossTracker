// setupBundle.js — a WHOLE Mimic setup as one shareable document (the guild lead, 2026-10-19, DECISIONS §383:
// "Share a whole setup = A, file + share code"; the options were written in §91, the file half of layouts in §376).
//
// portableLayout.js turns the Canvas layout into a document that fits any screen. This file wraps it with everything
// else a person would want a second install to have: the layouts of every saved set, the HUD builder, the options of
// the overlays, personal triggers and "What you hear" rules. It is pure (no Electron, no fs, no network), so the tests
// run it as it ships; main.js does the reading and the writing.
//
// THE FORMAT is checked by portableSetup.js, which is byte-identical to the bot's utils/portableSetup.js (the bot holds
// a bundle for 24 hours under a share code and must refuse what Mimic refuses). Read its header for the shape.
//
// NEVER IN A BUNDLE (§91): the sign-in and any token, EverQuest and log paths, crash-report consent, the updater channel,
// the OpenDKP login, bids, the excluded-characters list, auto-start, anything tied to what is installed in the EQ folder,
// and the NAMES of the sharer's characters (the per-character parts travel as "Character 1", "Character 2"…). That is
// kept three ways: this file only ever reads the places listed below, portableSetup.js refuses a bundle with a private
// field or value in it, and every localStorage key Mimic's pages use must be marked SHARED or PRIVATE here — a test fails
// on a key that is neither, so a new setting is private until somebody decides otherwise.
//
// ON THE WAY IN the person previews the bundle with a tick on every part, and picks which of THEIR characters get the
// per-character parts. plan() turns the ticks into exactly what main.js writes.
'use strict';

const portableSetup = require('./portableSetup');

const { FORMAT, VERSION, MAX_BYTES, MAX_SLOTS, RULE_MODES } = portableSetup;

// ── Which localStorage keys travel ──────────────────────────────────────────
// Mimic's overlay pages are file:// pages and share one localStorage. A key is SHARED (an option someone chose for an
// overlay), PRIVATE (a window's position, what was open, whose class it is, a draft, a mirror of config), or the HUD
// builder's own family (wpHudParts:<character>), which has its section. Anything else is unmarked, and nothing unmarked
// is ever read or written.
const ok = (v) => ({ v });
const FLAG = { parse: (s) => (s === '1' ? ok(true) : s === '0' ? ok(false) : null), format: (v) => (typeof v === 'boolean' ? (v ? '1' : '0') : null) };
const WORD = { parse: (s) => (/^[a-z0-9_-]{1,24}$/i.test(s) ? ok(s) : null), format: (v) => (typeof v === 'string' && /^[a-z0-9_-]{1,24}$/i.test(v) ? v : null) };
const ENUM = (list) => ({ parse: (s) => (list.includes(s) ? ok(s) : null), format: (v) => (list.includes(v) ? v : null) });
const INT = (lo, hi) => ({
  parse: (s) => (/^-?\d{1,6}$/.test(s) && +s >= lo && +s <= hi ? ok(+s) : null),
  format: (v) => (Number.isInteger(v) && v >= lo && v <= hi ? String(v) : null),
});
const ONE_OF = (nums) => ({
  parse: (s) => (/^\d{1,4}$/.test(s) && nums.includes(+s) ? ok(+s) : null),
  format: (v) => (nums.includes(v) ? String(v) : null),
});
const NUM = (lo, hi) => ({
  parse: (s) => { const n = Number(s); return s !== '' && Number.isFinite(n) && n >= lo && n <= hi ? ok(n) : null; },
  format: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? String(v) : null),
});
// "fit" (the window sizes itself) or a pixel height.
const HEIGHT = {
  parse: (s) => (s === 'fit' ? ok('fit') : /^\d{3,4}$/.test(s) && +s >= 100 && +s <= 4000 ? ok(+s) : null),
  format: (v) => (v === 'fit' ? 'fit' : Number.isInteger(v) && v >= 100 && v <= 4000 ? String(v) : null),
};
// The /who overlay's class and guild filters: { classes: [name], guilds: [name], sortBy: word }.
const textList = (a, n, len) => (Array.isArray(a) && a.length <= n && a.every(x => typeof x === 'string' && x.length >= 1 && x.length <= len)) ? a.slice() : null;
function whoFilters(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const classes = textList(o.classes == null ? [] : o.classes, 20, 24), guilds = textList(o.guilds == null ? [] : o.guilds, 40, 40);
  const sortBy = o.sortBy == null ? '' : o.sortBy;
  if (!classes || !guilds || typeof sortBy !== 'string' || (sortBy && !/^[a-z]{1,16}$/i.test(sortBy))) return null;
  return { classes, guilds, sortBy };
}
const FILTERS = {
  parse: (s) => { try { const o = whoFilters(JSON.parse(s)); return o ? ok(o) : null; } catch { return null; } },
  format: (v) => { const o = whoFilters(v); return o ? JSON.stringify(o) : null; },
};

// [localStorage key, overlay key (the bundle's `options` group), option name, kind]
const SHARED = [
  ['wp.damageTabMode', 'overlay', 'tab', ENUM(['dps', 'tank', 'history', 'trend'])],
  ['wp.deepsRows', 'overlay', 'rows', INT(3, 50)],
  ['wp.trendRange', 'overlay', 'trendRange', ENUM(['tonight', 'week'])],
  ['wp.trendField', 'overlay', 'trendField', ENUM(['dmg', 'took'])],
  ['wp:melody:dirge', 'melody', 'dirge', FLAG],
  ['wp:bq:view', 'buffqueue', 'view', ENUM(['buff', 'group'])],
  ['wp:who:height', 'who', 'height', HEIGHT],
  ['wp:who:filters', 'who', 'filters', FILTERS],
  ['wp:who:zekOnly', 'who', 'zekOnly', FLAG],
  ['wp:who:zoneCol', 'who', 'zoneCol', FLAG],
  ['wp_ext_show_offtank', 'extarget', 'offTank', FLAG],
  ['wp_ext_show_players', 'extarget', 'players', FLAG],
  ['wp_ext_scope', 'extarget', 'scope', ENUM(['group', 'self', 'raid'])],
  ['wp_ext_self_keep', 'extarget', 'selfKeep', ONE_OF([30, 60, 120, 300])],
  ['chchain_mute', 'chchain', 'mute', FLAG],
  ['chchain_go_tts', 'chchain', 'goTts', FLAG],
  ['chchain_ddr', 'chchain', 'ddr', FLAG],
  ['chchain_lead_auto', 'chchain', 'leadAuto', FLAG],
  ['chchain_lead_sec', 'chchain', 'leadSec', NUM(0, 10)],
  ['wp:tick:layout', 'zeal', 'layout', ENUM(['bars', 'dials'])],
  ['wp:tick:detail', 'zeal', 'detail', FLAG],
  ['wpTargetMana', 'mobinfo', 'mana', ENUM(['on', 'off'])],
  ['wpTargetFqv', 'mobinfo', 'sub', WORD],
  ['wpCharmWarnAt', 'charm', 'warnAt', INT(0, 600)],
  ['wp:pop:framed', 'popraid', 'framed', FLAG],
  ['wp:pop:fs', 'popraid', 'fontSize', INT(6, 40)],
  ['wp:pop:height', 'popraid', 'height', HEIGHT],
  ['wp:pop:mode', 'popraid', 'mode', ENUM(['slides', 'quests'])],
  ['wpMeStyle', 'me', 'style', ENUM(['hud', 'a'])],
];
const SHARED_BY_KEY = new Map(SHARED.map(r => [r[0], r]));

// Marked private on purpose. Each is here for a reason a person would give: where a window sits, what was open or
// collapsed, which class or mobs or encounter the person is on, a half-typed draft, or a mirror of a Mimic setting.
const PRIVATE_KEYS = new Set([
  'wp:bufferClass',                       // the class this person buffs as
  'wp:bq:collapsed', 'wp_cmd_collapsed',  // which sections are folded
  'wp_ext_hidden',                        // mobs / names hidden by hand
  'wpCharmPetsOpen',                      // a panel's open state
  'wp:pop:enc', 'wp:pop:quest',           // where the person is in the Planes of Power
  'wp.melodyBardOnly', 'wp.melodyDmgTotals',   // mirrors of Mimic's own config, rewritten from it on every status
  'wpMeCardBounds', 'wpHudPreBuild',      // window positions
  'wp:settings:draft',                    // an unsaved Settings form
  'uiInspectorWidth',                     // a dialog's width
]);
const PRIVATE_PREFIXES = ['wp-map-', 'wpChatMore:', 'wpChatMoreSet:', 'wpChatHistH:', 'wpChatBrkOff:'];

const HUD_KEY = 'wpHudParts';
const isHudKey = (k) => k === HUD_KEY || k.startsWith(HUD_KEY + ':');

/** 'shared' | 'hud' | 'private' | null (unmarked: neither read nor written). */
function classifyKey(key) {
  const k = String(key);
  if (SHARED_BY_KEY.has(k)) return 'shared';
  if (isHudKey(k)) return 'hud';
  if (PRIVATE_KEYS.has(k) || PRIVATE_PREFIXES.some(p => k.startsWith(p))) return 'private';
  return null;
}
/** Every localStorage key a collector may read (and the Undo of an import may write back). */
const readableKey = (k) => { const c = classifyKey(k); return c === 'shared' || c === 'hud'; };

/** { localStorage key: string } → { overlay: { name: typed value } } for the SHARED keys only. */
function optionsFromStorage(dump) {
  const out = {};
  for (const [key, ov, name, kind] of SHARED) {
    const raw = dump && Object.prototype.hasOwnProperty.call(dump, key) ? dump[key] : undefined;
    if (typeof raw !== 'string') continue;
    const r = kind.parse(raw);
    if (r) (out[ov] || (out[ov] = {}))[name] = r.v;
  }
  return out;
}
/** { overlay: { name: value } } → { localStorage key: string }; an unknown name or an invalid value is dropped. */
function storageFromOptions(options, only) {
  const out = {};
  if (!options || typeof options !== 'object') return out;
  for (const [key, ov, name, kind] of SHARED) {
    if (only && !only.includes(ov)) continue;
    const g = options[ov];
    if (!g || typeof g !== 'object' || !Object.prototype.hasOwnProperty.call(g, name)) continue;
    const s = kind.format(g[name]);
    if (s !== null) out[key] = s;
  }
  return out;
}

const HUD_MAX_JSON = 8 * 1024;
/** { localStorage key: string } → { characterLowercase: parts } from the wpHudParts:<character> keys. */
function hudFromStorage(dump) {
  const out = {};
  for (const [k, raw] of Object.entries(dump || {})) {
    const m = /^wpHudParts:([a-z]{1,24})$/.exec(k);
    if (!m || typeof raw !== 'string' || raw.length > HUD_MAX_JSON) continue;
    let o; try { o = JSON.parse(raw); } catch { continue; }
    if (o && typeof o === 'object' && !Array.isArray(o)) out[m[1]] = o;
  }
  return out;
}

// ── Characters travel as slots ──────────────────────────────────────────────
const lc = (s) => String(s || '').toLowerCase();
const cap = (s, n) => String(s == null ? '' : s).slice(0, n);

function _cleanTrigger(t) {
  const o = {};
  for (const [k, v] of Object.entries(t || {})) {
    if (k.startsWith('_') || k === 'valid') continue;     // the agent's compiled bits and its own flag
    o[k] = v;
  }
  // A sound that is a file in the sender's own folder is not on the other PC. Names and links travel.
  const dropCustom = (x) => {
    if (x && typeof x.sound === 'string' && /^custom:/i.test(x.sound.trim())) { delete x.sound; delete x.sound_volume; delete x.sound_mode; }
  };
  dropCustom(o);
  if (Array.isArray(o.actions)) o.actions = o.actions.map(a => { if (a && typeof a === 'object') { const c = Object.assign({}, a); dropCustom(c); return c; } return a; });
  return o;
}
const RX_RULE_KEY = /^(?:group|guild|personal|builtin):/;

/**
 * input: { meta:{title,byline,note}, layouts:[{name,doc,active}], hud:{charLower:parts}, options:{overlay:{...}},
 *          triggers:[agent rows], rules:{key:{'*'|charLower:mode}}, ownChars:[names, the sharer's first] }
 * → { ok, setup, bytes, report } | { ok:false, error }. `report.left` lists what stayed behind and why, for the sharer.
 */
function build(input) {
  const inp = input || {};
  const left = [];
  const triggersIn = Array.isArray(inp.triggers) ? inp.triggers : [];
  const hudIn = (inp.hud && typeof inp.hud === 'object') ? inp.hud : {};
  const rulesIn = (inp.rules && typeof inp.rules === 'object') ? inp.rules : {};

  // 1. Triggers: cleaned, and one that holds anything private stays behind.
  const kept = [];
  for (const row of triggersIn) {
    if (!row || typeof row !== 'object') continue;
    const t = _cleanTrigger(row);
    const chars = Array.isArray(t.characters) ? [...new Set(t.characters.map(lc).filter(Boolean))] : [];
    delete t.characters;
    try { portableSetup.cleanValue(t, 'trigger', { n: 0 }); }
    catch { left.push({ what: `trigger "${cap(row.name || 'untitled', 40)}"`, why: 'it holds a path, a link or a sign-in' }); continue; }
    kept.push({ t, chars });
  }

  // 2. The characters the per-character parts name: the sharer's own order first, then the rest A to Z.
  const named = new Set();
  Object.keys(hudIn).forEach(c => named.add(lc(c)));
  kept.forEach(k => k.chars.forEach(c => named.add(c)));
  for (const per of Object.values(rulesIn)) if (per && typeof per === 'object') Object.keys(per).forEach(c => { if (c !== '*') named.add(lc(c)); });
  const order = [];
  for (const n of (Array.isArray(inp.ownChars) ? inp.ownChars : [])) { const c = lc(n); if (named.has(c) && !order.includes(c)) order.push(c); }
  [...named].sort().forEach(c => { if (!order.includes(c)) order.push(c); });
  const slotOf = new Map();
  order.slice(0, MAX_SLOTS).forEach((c, i) => slotOf.set(c, 'c' + (i + 1)));
  const slots = [...slotOf.values()].map(slot => ({ slot, label: 'Character ' + slot.slice(1) }));
  if (order.length > MAX_SLOTS) left.push({ what: `${order.length - MAX_SLOTS} character${order.length - MAX_SLOTS === 1 ? '' : 's'}' own settings`, why: `a setup holds at most ${MAX_SLOTS} characters` });

  // 3. The pieces.
  const hud = [];
  for (const [c, parts] of Object.entries(hudIn)) {
    const slot = slotOf.get(lc(c));
    if (!slot) continue;
    try { portableSetup.cleanValue(parts, 'hud', { n: 0 }); } catch { left.push({ what: 'a HUD', why: 'it holds something private' }); continue; }
    hud.push({ slot, parts });
  }
  hud.sort((a, b) => +a.slot.slice(1) - +b.slot.slice(1));
  const triggers = [];
  for (const { t, chars } of kept) {
    const mapped = chars.map(c => slotOf.get(c)).filter(Boolean);
    if (chars.length && !mapped.length) { left.push({ what: `trigger "${cap(t.name || 'untitled', 40)}"`, why: 'it is for a character beyond the twelve a setup holds' }); continue; }
    triggers.push({ for: mapped, trigger: t });
  }
  const ids = new Set(triggers.map(x => x.trigger.id).filter(Boolean));
  const rules = {};
  for (const [key, per] of Object.entries(rulesIn)) {
    if (!RX_RULE_KEY.test(key) || !per || typeof per !== 'object') continue;
    if (key.startsWith('personal:') && !ids.has(key.slice(9))) continue;     // a rule about a trigger that is not in the bundle
    const row = {};
    for (const [cell, mode] of Object.entries(per)) {
      if (!RULE_MODES.includes(mode)) continue;
      if (cell === '*') row.all = mode;
      else { const slot = slotOf.get(lc(cell)); if (slot) row[slot] = mode; }
    }
    if (Object.keys(row).length) rules[key] = row;
  }

  const layouts = (Array.isArray(inp.layouts) ? inp.layouts : []).map(l => ({ name: cap(l && l.name, 40), active: !!(l && l.active), doc: l && l.doc }));
  const setup = {
    format: FORMAT, version: VERSION,
    meta: { title: cap(inp.meta && inp.meta.title, 60), byline: cap(inp.meta && inp.meta.byline, 32), note: cap(inp.meta && inp.meta.note, 280) },
    slots, layouts, options: inp.options || {}, hud, triggers, rules,
  };
  const v = portableSetup.validate(setup);
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true, setup: v.setup, bytes: v.bytes, report: { summary: v.summary, left } };
}

/** The text of a file → validate(), with the size cap and a JSON parse that cannot run anything. */
function parseText(text) {
  if (typeof text !== 'string') return { ok: false, error: 'That file could not be read.' };
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { ok: false, error: 'That file is too big to be a Mimic setup.' };
  let raw;
  try { raw = JSON.parse(text.replace(/^﻿/, '')); } catch { return { ok: false, error: 'That file is not a Mimic setup (it is not valid JSON).' }; }
  const v = portableSetup.validate(raw);
  return v.ok ? v : { ok: false, error: v.error.replace(/^That setup/, 'That file').replace(/^That is not a Mimic setup\./, 'That file is not a Mimic setup.') };
}

// ── Preview and plan (the way in) ───────────────────────────────────────────
const OPTION_LABELS = { overlay: 'DPS and tank meter', melody: 'Melody', buffqueue: 'Buff queue', who: '/who', extarget: 'Extended Target',
  chchain: 'CH chain', zeal: 'Server tick', mobinfo: 'Mob Info', charm: 'Charm tracker', popraid: 'Planes of Power', me: 'HUD style' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
function _pieces(doc) { return doc.groups.reduce((a, g) => a + g.panels.length, 0); }

/**
 * What the preview screen shows, from a VALIDATED setup. `mine` is the importer's character names.
 * Every item is ticked by default; ids are what plan() takes back. Free text (title, byline, names) is plain text for
 * the page to show with textContent, never as markup.
 */
function describe(setup, mine) {
  const myChars = (Array.isArray(mine) ? mine : []).map(s => String(s)).filter(Boolean);
  const per = (slot) => ({
    hud: setup.hud.some(h => h.slot === slot),
    triggers: setup.triggers.filter(t => t.for.includes(slot)).length,
    rules: Object.values(setup.rules).filter(r => slot in r).length,
  });
  const sections = [];
  if (setup.layouts.length) {
    sections.push({ id: 'layouts', label: 'Overlay layouts', note: 'Each is added as a new set. Your setup is saved first, and nothing of yours is overwritten.',
      items: setup.layouts.map((l, i) => ({ id: String(i), label: l.name, detail: plural(_pieces(l.doc), 'piece') + (l.active ? ' · the one on their screen' : '') })) });
  }
  const optionGroups = Object.keys(setup.options);
  if (optionGroups.length) {
    sections.push({ id: 'options', label: 'Overlay options', note: 'How each overlay is set (tabs, rows, filters). Positions are not in here.',
      items: optionGroups.map(k => ({ id: k, label: OPTION_LABELS[k] || k, detail: plural(Object.keys(setup.options[k]).length, 'setting') })) });
  }
  if (setup.hud.length) {
    sections.push({ id: 'hud', label: 'HUD builder', note: 'The ring and its parts, for the characters you pick below.',
      items: setup.hud.map(h => ({ id: h.slot, label: 'HUD for ' + (setup.slots.find(s => s.slot === h.slot) || { label: h.slot }).label, detail: '' })) });
  }
  if (setup.triggers.length) {
    sections.push({ id: 'triggers', label: 'Personal triggers', note: 'A trigger with the same name as one of yours replaces it (your files are backed up first). Discord posts arrive switched off.',
      items: setup.triggers.map((t, i) => ({ id: String(i), label: cap(t.trigger.name || 'untitled', 60),
        detail: t.for.length ? 'for ' + t.for.map(s => (setup.slots.find(x => x.slot === s) || { label: s }).label).join(', ') : 'every character' })) });
  }
  const ruleKeys = Object.keys(setup.rules);
  if (ruleKeys.length) {
    sections.push({ id: 'rules', label: 'What you hear', note: 'Which callouts speak, only show, or stay off.',
      items: [{ id: 'all', label: plural(ruleKeys.length, 'rule'), detail: '' }] });
  }
  const characters = setup.slots.map(s => Object.assign({ slot: s.slot, label: s.label }, per(s.slot)));
  // A starting guess: the sender's first character to your first, and so on. Always shown, always yours to change.
  const assign = {};
  characters.forEach((c, i) => { if (myChars[i]) assign[c.slot] = [myChars[i]]; });
  return { title: setup.meta.title, byline: setup.meta.byline, note: setup.meta.note, sections, characters, mine: myChars, assign };
}

/**
 * selection: { layouts:[id], options:[id], hud:[slot], triggers:[id], rules:bool } (omit a key = none of that part)
 * assign:    { c1: [one of mine, ...] }
 * mine:      the importer's character names (an assignment to a name that is not theirs is refused)
 * → { layouts:[{name,doc,active}], storage:{key:string}, triggers:[agent rows], rules:{key:{'*'|charLower:mode}}, report }
 */
function plan(setup, selection, assign, mine) {
  const sel = selection || {};
  const has = (k, id) => Array.isArray(sel[k]) && sel[k].map(String).includes(String(id));
  const mineLc = new Map((Array.isArray(mine) ? mine : []).map(n => [lc(n), String(n)]));
  const targets = (slot) => {
    const out = [];
    for (const n of ((assign && assign[slot]) || [])) { const c = lc(n); if (mineLc.has(c) && !out.includes(c)) out.push(c); }
    return out;
  };
  const report = { skipped: [] };

  const layouts = setup.layouts.map((l, i) => ({ l, i })).filter(x => has('layouts', x.i)).map(x => ({ name: x.l.name, doc: x.l.doc, active: x.l.active }));

  const wantOptions = setup.options && typeof setup.options === 'object' ? Object.keys(setup.options).filter(k => has('options', k)) : [];
  const storage = storageFromOptions(setup.options, wantOptions);
  let hudCount = 0;
  for (const h of setup.hud) {
    if (!has('hud', h.slot)) continue;
    const chars = targets(h.slot);
    if (!chars.length) { report.skipped.push(`the HUD for ${slotLabel(setup, h.slot)} (no character picked)`); continue; }
    const j = JSON.stringify(h.parts);
    if (j.length > HUD_MAX_JSON) { report.skipped.push(`the HUD for ${slotLabel(setup, h.slot)} (too large)`); continue; }
    for (const c of chars) storage[HUD_KEY + ':' + c] = j;
    hudCount++;
  }

  const triggers = [];
  const appliedIds = new Set();
  setup.triggers.forEach((t, i) => {
    if (!has('triggers', i)) return;
    const row = JSON.parse(JSON.stringify(t.trigger));
    if (t.for.length) {
      const chars = [...new Set(t.for.flatMap(targets))];
      if (!chars.length) { report.skipped.push(`trigger "${cap(row.name || 'untitled', 40)}" (no character picked for it)`); return; }
      row.characters = chars;
    }
    const dropCustom = (x) => { if (x && typeof x.sound === 'string' && /^custom:/i.test(x.sound.trim())) { delete x.sound; delete x.sound_volume; delete x.sound_mode; } };
    dropCustom(row);
    if (Array.isArray(row.actions)) row.actions.forEach(dropCustom);
    if (row.id) appliedIds.add(row.id);
    triggers.push(row);
  });

  const rules = {};
  if (sel.rules) {
    for (const [key, per] of Object.entries(setup.rules)) {
      if (key.startsWith('personal:') && !appliedIds.has(key.slice(9))) continue;
      const row = {};
      for (const [cell, mode] of Object.entries(per)) {
        if (cell === 'all') row['*'] = mode;
        else for (const c of targets(cell)) row[c] = mode;
      }
      if (Object.keys(row).length) rules[key] = row;
    }
  }
  return { layouts, storage, triggers, rules, report: Object.assign(report, { hud: hudCount, options: wantOptions.length }) };
}
function slotLabel(setup, slot) { const s = setup.slots.find(x => x.slot === slot); return s ? s.label : slot; }

// Which overlay window (main.js _overlayEntries() key) reads each options group at load. The Canvas hosts copies of several.
const WINDOW_OF = { overlay: 'hud', melody: 'melody', buffqueue: 'buffQueue', who: 'who', extarget: 'exttarget', chchain: 'chchain',
  zeal: 'zeal', mobinfo: 'mobinfo', charm: 'charm', popraid: 'popraid', me: 'me' };
/** The localStorage keys just written → the overlay windows that must reload to pick them up (never the trigger window). */
function windowsToReload(storageKeys) {
  const out = new Set();
  for (const k of storageKeys || []) {
    const row = SHARED_BY_KEY.get(k);
    if (row && WINDOW_OF[row[1]]) out.add(WINDOW_OF[row[1]]);
    else if (isHudKey(k)) out.add('me');
  }
  if (out.size) out.add('canvas');
  return [...out];
}

/** The bot's answer to a share-code call → one plain sentence for the person. reply: { status, body, retry, signedOut }. */
function botMessage(reply, what) {
  const r = reply || {};
  const b = (r.body && typeof r.body === 'object') ? r.body : {};
  const wait = r.retry > 0 ? Math.max(1, Math.ceil(r.retry / 60)) : 0;
  if (r.signedOut) return 'Sign in to Mimic first. Share codes are for signed-in Wolf Pack members; a file works without signing in.';
  if (r.status === 0) return 'Could not reach the Wolf Pack server. Try again in a minute.';
  if (r.status === 401) return 'Your Mimic sign-in has ended. Sign in again from Settings.';
  if (r.status === 404) return 'That code is not valid, or it has expired.';
  if (r.status === 400 && b.error === 'bad_code') return 'A code is six letters and numbers (no 0, O, 1, I or L).';
  if (r.status === 400 && typeof b.message === 'string') return b.message;
  if (r.status === 413) return 'That setup is too big to share (the limit is 512 KB).';
  if (r.status === 429) return what === 'get' ? `Too many tries just now. Wait ${wait || 'a few'} minute${wait === 1 ? '' : 's'} and try again.`
    : `You have made a lot of codes this hour. Wait ${wait || 'a few'} minute${wait === 1 ? '' : 's'} and try again.`;
  if (r.status >= 500) return 'The Wolf Pack server is busy. Try again in a minute.';
  return 'The Wolf Pack server did not accept that.';
}

/** What a person typed → the code it means, or null. Mirrors the bot (utils/setupShare.js normalizeCode). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function normalizeCode(s) {
  const c = String(s == null ? '' : s).toUpperCase().replace(/[\s-]+/g, '');
  return new RegExp(`^[${CODE_ALPHABET}]{6}$`).test(c) ? c : null;
}
const showCode = (c) => c.slice(0, 3) + '-' + c.slice(3);

module.exports = {
  SHARED, PRIVATE_KEYS, PRIVATE_PREFIXES, HUD_KEY, classifyKey, readableKey, optionsFromStorage, storageFromOptions, hudFromStorage,
  build, parseText, validate: portableSetup.validate, describe, plan, botMessage, windowsToReload, normalizeCode, showCode, CODE_ALPHABET, OPTION_LABELS, MAX_BYTES,
};
