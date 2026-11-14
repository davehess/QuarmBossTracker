// uiRestorePlan.js — "compare first" restore for UI Studio backups.
//
// A backup is a { filename: text } map. Instead of overwriting every file, the person sees per PART
// (layout, hotkeys, socials, ...) what differs from the files on this PC and picks Keep mine / Backup
// for each. classify() says which files and sections belong to a part, compare() counts the
// difference, buildRestore() writes only the chosen parts, merged into the current files.
//
// Pure (no fs, no Electron) so a test can run it directly.
'use strict';

const { applyIniKeyEdits } = require('./iniKeyEdits');
const { restorableName, filterRestorable } = require('./uiRestoreGuard');
const { skinSizeFor } = require('./uiClearRects');
const uiFit = require('./uiFit');

const PARTS = [
  { key: 'layout',    label: 'Window layout',            scope: 'character' },
  { key: 'hotkeys',   label: 'Hotkeys',                  scope: 'character' },
  { key: 'socials',   label: 'Socials',                  scope: 'character' },
  { key: 'spellsets', label: 'Spell sets',               scope: 'character' },
  { key: 'keybinds',  label: 'Keybinds',                 scope: 'all' },   // eqclient.ini is shared by every character on this PC
  // The character's OWN Zeal settings (its [<Char>] sections, chat routing and spell sets that Zeal keeps keyed to
  // it) are a part of their own, always brought in like the layout. Only Zeal's SHARED sections stay in 'zeal',
  // behind the shared-PC tick (a member, 2026-11-11, FB-124 / FB-127: with the one Zeal part off on a shared PC,
  // the character's own Zeal settings stayed behind with the shared ones).
  { key: 'zealchar',  label: 'Zeal settings for this character', scope: 'character' },
  { key: 'zeal',      label: 'Zeal options (shared)',    scope: 'character' },
  { key: 'other',     label: 'Other character settings', scope: 'character' },
];

const SEC_RE = /^\s*\[([^\]]+)\]\s*$/;
const KEY_OK = /^[\w.]+$/;            // what applyIniKeyEdits can write
const RES_KEY = /^xpos(\d+)x(\d+)$/i;
const lc = (s) => String(s).toLowerCase();

// ---- parsing ---------------------------------------------------------------------------------

// Lines keep their own terminator so untouched lines round-trip byte for byte.
function splitLines(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    if (nl < 0) { out.push({ t: text.slice(i), e: '' }); break; }
    const cr = nl > i && text[nl - 1] === '\r';
    out.push({ t: text.slice(i, cr ? nl - 1 : nl), e: cr ? '\r\n' : '\n' });
    i = nl + 1;
  }
  return out;
}

function parseSections(text) {
  const out = [];
  let cur = { name: '', keys: [] };
  out.push(cur);
  for (const raw of String(text == null ? '' : text).replace(/^﻿/, '').split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s[0] === ';' || s[0] === '#') continue;
    const m = SEC_RE.exec(s);
    if (m) { cur = { name: m[1].trim(), keys: [] }; out.push(cur); continue; }
    const eq = s.indexOf('=');
    if (eq > 0) cur.keys.push({ key: s.slice(0, eq).trim(), value: s.slice(eq + 1).trim() });
  }
  return out.filter((s, i) => i > 0 || s.keys.length);
}

// The profile API EQ reads these files with uses the FIRST block of a repeated section.
function firstBlocks(secs) {
  const seen = new Set();
  return secs.filter((s) => { const k = lc(s.name); if (seen.has(k)) return false; seen.add(k); return true; });
}
const keyMap = (sec) => { const m = new Map(); for (const k of sec.keys) m.set(lc(k.key), k.value); return m; };

// The live layout is the resolution block with the most XPos<W>x<H> keys (same rule as the overlay arranger).
function mainRes(secs, prefer) {
  const count = new Map();
  for (const s of secs) for (const k of s.keys) {
    const m = RES_KEY.exec(k.key);
    if (m) { const id = m[1] + 'x' + m[2]; count.set(id, (count.get(id) || 0) + 1); }
  }
  let best = null, n = 0;
  for (const [id, c] of count) if (c > n) { n = c; best = id; }
  // A tie goes to the size asked about (this PC's screen): a block as full as any other is in use, not left over.
  const p = prefer && prefer.w > 0 && prefer.h > 0 ? prefer.w + 'x' + prefer.h : null;
  if (p && n > 0 && count.get(p) === n) best = p;
  return best ? { w: parseInt(best.split('x')[0], 10), h: parseInt(best.split('x')[1], 10) } : null;
}

const findName = (files, name) => {
  if (!files || typeof files !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(files, name)) return name;
  const l = lc(name);
  return Object.keys(files).find((n) => lc(n) === l) || null;
};

// ---- classify --------------------------------------------------------------------------------

// A file belongs to a character when the name sits on a boundary (start, or between underscores), so a
// short name like "Al" never claims "Aldenmar" files.
function belongs(lf, c) {
  return lf.startsWith(c + '_') || lf.startsWith(c + '.') || lf.includes('_' + c + '_') || lf.includes('_' + c + '.');
}
const forChar = (sec, c) => { const s = lc(sec); return s === c || s.endsWith('_' + c); };
const ALL = () => true;

// Does this set of files have Zeal's "per character keybinds" switched on (zeal.ini [Zeal] PerCharKeybinds)?
// true / false, or null when the set holds no zeal.ini to say.
function perCharFlag(files) {
  const name = findName(files, 'zeal.ini');
  if (!name || typeof files[name] !== 'string') return null;
  const z = firstBlocks(parseSections(files[name])).find((s) => /^zeal$/i.test(s.name));
  return !!z && /^(true|1)$/i.test(String(keyMap(z).get('percharkeybinds') || '').trim());
}
const perCharKeys = (files) => perCharFlag(files) === true;
// Never copied between PCs: the chat sign-in keys, and the per-character-keybinds switch itself. That switch says
// which section THIS PC's game reads its keys from; copying it would change where every character's keys come from.
const ZEAL_SHARED_KEY = (k) => !/ChannelAutoJoin|password|^PerCharKeybinds$/i.test(k);
// An entry that brings one section under another name (entry.from -> entry.as): the backup's text for it is that
// one section, renamed, so the rest of the restore treats it like any section.
function entryText(entry, text) {
  if (!entry.from) return text;
  const s = firstBlocks(parseSections(text)).find((x) => lc(x.name) === lc(entry.from));
  if (!s) return '';
  const eol = String(text).includes('\r\n') ? '\r\n' : '\n';
  return '[' + entry.as + ']' + eol + s.keys.map((k) => k.key + '=' + k.value + eol).join('');
}

// opts.knownChars: other characters on this PC. opts.localPerCharKeys: this PC has per-character keybinds on.
function classify(files, character, opts = {}) {
  const knownChars = opts.knownChars || [];
  const res = {};
  for (const p of PARTS) res[p.key] = [];
  const c = lc(String(character || '').trim());
  const others = (knownChars || []).map((n) => lc(String(n).trim())).filter(Boolean);
  if (!files || typeof files !== 'object') return res;

  for (const file of Object.keys(files)) {
    if (!restorableName(file) || typeof files[file] !== 'string') continue;
    const lf = lc(file);
    if (lf === 'eqclient.ini') {
      // Key bindings are brought as a whole SECTION, never merged key by key: a merge keeps this PC's binding for
      // every key the other PC left unbound, so one key ends up doing two things (the guild lead, 2026-11-14: "all
      // of the keybinds are messed up").
      res.keybinds.push({ file, mode: 'sections', keepAbsent: true, test: (n) => /^KeyMaps$/i.test(n) });
      // Zeal's "per character keybinds" option ([Zeal] PerCharKeybinds in zeal.ini) keeps a character's bindings
      // in [KeyMaps_<Char>] (Zeal binds.cpp update_ini_section_name). They are the character's own, so they come
      // with the character whatever the shared Key bindings tick says. Two cases, both seen in real files:
      //   - the backup's PC has the option on: its [KeyMaps_<Char>] is brought as it is;
      //   - the backup's PC shares one [KeyMaps] between every character but THIS PC has the option on: the
      //     game here reads [KeyMaps_<Char>], so the backup's [KeyMaps] is written as that section. Left out, the
      //     character came up with the game's default keys (the guild lead, 2026-11-14).
      // Which of the two a backup is comes from the backup's OWN switch, never from which sections happen to be
      // in the file: a PC that shares keys can still carry an old [KeyMaps_<Char>] from a time the option was on
      // (it must not win over the live [KeyMaps]), and a PC with the option on still has a [KeyMaps] that no
      // character reads (it must not be written over a character's own keys). A backup with no zeal.ini cannot
      // say, so there the section being present decides.
      if (c) {
        const own = 'KeyMaps_' + String(character).trim();
        const isOwn = (n) => lc(n) === 'keymaps_' + c;
        const names = parseSections(files[file]).map((s) => lc(s.name));
        const hasOwn = names.includes('keymaps_' + c);
        const flag = perCharFlag(files);
        if (flag == null ? hasOwn : flag) {
          if (hasOwn) res.zealchar.push({ file, mode: 'sections', keepAbsent: true, test: isOwn });
        } else if (opts && opts.localPerCharKeys && names.includes('keymaps')) {
          res.zealchar.push({ file, mode: 'sections', keepAbsent: true, test: isOwn, from: 'KeyMaps', as: own });
        }
      }
      // Zeal also keeps settings in eqclient.ini: a shared [Zeal] section and a [<Char>] section per character
      // (TellWindows), seen in a real file 2026-11-01. Only those two; every other section stays as it is.
      if (c) {
        res.zeal.push({ file, mode: 'keys', test: (n) => /^Zeal$/i.test(n), keyTest: ZEAL_SHARED_KEY });
        res.zealchar.push({ file, mode: 'keys', test: (n) => lc(n) === c, keyTest: (k) => !/ChannelAutoJoin|password/i.test(k) });
      }
    } else if (lf === 'zeal.ini') {
      // A bare section holding only TellWindows keys is a character's own ([<Char>]), even for a character this
      // PC has no files for; it is restored only for this character.
      const tellOnly = new Set(parseSections(files[file])
        .filter((s) => s.name && s.keys.length && s.keys.every((k) => /^TellWindows/i.test(k.key))).map((s) => lc(s.name)));
      // This character's own sections are the 'zealchar' part; every other section that is nobody else's is shared.
      if (c) res.zealchar.push({
        file, mode: 'keys',
        test: (n) => !/ChannelAutoJoin/i.test(n) && forChar(n, c),
        keyTest: (k) => !/ChannelAutoJoin|password/i.test(k),
      });
      res.zeal.push({
        file, mode: 'keys',
        test: (n) => !/ChannelAutoJoin/i.test(n) && !(c && forChar(n, c)) &&
          !tellOnly.has(lc(n)) && !others.some((o) => forChar(n, o)),
        keyTest: ZEAL_SHARED_KEY,
      });
    } else if (!c || !belongs(lf, c)) {
      continue;                                           // another character's file, or nobody's
    } else if (lf.startsWith('ui_')) {
      res.layout.push({ file, mode: 'whole', test: ALL });
    } else if (/^(sock|socials)_/.test(lf)) {
      res.socials.push({ file, mode: 'whole', test: ALL });
    } else if (lf.includes('spellsets')) {
      res.spellsets.push({ file, mode: 'whole', test: ALL });
    } else if (lf === c + '_pq.proj.ini') {
      res.hotkeys.push({ file, mode: 'sections', test: (n) => /^HotButtons/i.test(n) });
      res.socials.push({ file, mode: 'sections', test: (n) => /^Socials$/i.test(n) });
      res.other.push({ file, mode: 'sections', test: (n) => !!n && !/^HotButtons/i.test(n) && !/^Socials$/i.test(n) });
    } else {
      res.other.push({ file, mode: 'whole', test: ALL });
    }
  }
  return res;
}

// ---- fitLayout -------------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const posInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };

// A backup's window layout, fitted to this PC's game screen (targetW x targetH). The rule is uiFit.js: a window
// keeps its place in the free space (flush right stays flush right), a chat window is resized in proportion, every
// other window keeps its size, and what fits the screen ends up wholly on it.
//
// opts.source  { w, h }: the screen the backup was PLAYED on (its own eqclient.ini). Without it, the resolution
//              block with the most keys. A file keeps a block for every screen size it has ever been used at, so
//              the backup can hold an old block for THIS screen size too: when the backup was played on another
//              size, that old block is replaced, because "bring my setup" means how it looks there now (FB-132).
//              When the backup was played on this size, its block is kept and only brought back on screen.
// opts.skinSizes { windowName: { w, h } }: the skin's sizes on this PC, for a window the ini gives no size.
//
// ALWAYS call this on the backup's own text, never on its own output: a chat window's Width/Height is one value
// shared by every screen size, so fitting twice would shrink it twice.
function fitLayout(text, targetW, targetH, opts) {
  const src = String(text == null ? '' : text);
  const tw = Math.round(Number(targetW)), th = Math.round(Number(targetH));
  const secs = firstBlocks(parseSections(src));
  const asked = opts && opts.source && opts.source.w > 0 && opts.source.h > 0
    ? { w: Math.round(opts.source.w), h: Math.round(opts.source.h) } : null;
  const hasBlock = (r) => !!r && secs.some((s) => keyMap(s).has('xpos' + r.w + 'x' + r.h));
  const main = hasBlock(asked) ? asked : mainRes(secs, { w: tw, h: th });
  const sourceRes = main ? main.w + 'x' + main.h : null;
  if (!(tw > 0 && th > 0)) return { text: src, added: 0, clamped: 0, refit: 0, resized: 0, sourceRes };

  const tgt = { w: tw, h: th };
  const sameScreen = !!main && main.w === tw && main.h === th;
  const tx = 'XPos' + tw + 'x' + th, ty = 'YPos' + tw + 'x' + th;
  const edits = [];
  let added = 0, clamped = 0, refit = 0, resized = 0;
  for (const s of secs) {
    if (!s.name) continue;
    const m = keyMap(s);
    const iw = posInt(m.get('width')), ih = posInt(m.get('height'));
    const skin = (iw && ih) ? null : skinSizeFor(opts && opts.skinSizes, s.name);
    const known = !!((iw && ih) || skin);
    const w = iw || (skin && skin.w) || uiFit.GUESS_W, h = ih || (skin && skin.h) || uiFit.GUESS_H;
    const had = m.has(lc(tx)) && m.has(lc(ty));
    const at = (r) => (r && m.has('xpos' + r.w + 'x' + r.h) && m.has('ypos' + r.w + 'x' + r.h))
      ? { x: parseInt(m.get('xpos' + r.w + 'x' + r.h), 10), y: parseInt(m.get('ypos' + r.w + 'x' + r.h), 10), res: r } : null;

    // Where the window is read from: the block the backup was played at; else, on a backup played on this screen
    // size (or one with no block for this window at its own size), this screen's block; else any block; else the
    // old bare XPos/YPos, whose screen size is not known.
    let from = !sameScreen ? at(main) : null;
    if (!from && had) from = at(tgt);
    if (!from && main) from = at(main);
    if (!from && m.has('xpos') && m.has('ypos')) from = { x: parseInt(m.get('xpos'), 10), y: parseInt(m.get('ypos'), 10), res: null };
    if (!from) {
      for (const k of s.keys) {
        const r = RES_KEY.exec(k.key);
        if (r) { from = at({ w: +r[1], h: +r[2] }); if (from) break; }
      }
    }
    if (!from || !Number.isFinite(from.x) || !Number.isFinite(from.y)) continue;

    const onThisScreen = !from.res || (from.res.w === tw && from.res.h === th);
    let out;
    if (onThisScreen) {
      // Already this screen's numbers (or a screen size nobody recorded): only bring it back on screen. A window
      // whose size is a stand-in is pulled back just far enough to grab (80 px), so a small window near an edge
      // is not moved on a guess.
      out = known ? uiFit.fitRect({ x: from.x, y: from.y, w, h }, tgt, tgt)
        : { x: clamp(from.x, 0, Math.max(0, tw - 80)), y: clamp(from.y, 0, Math.max(0, th - 80)), w, h, resized: false };
    } else {
      out = uiFit.fitRect({ x: from.x, y: from.y, w, h }, from.res, tgt, { resize: uiFit.isChatSection(s.name) && !!(iw && ih) });
    }
    const ox = had ? parseInt(m.get(lc(tx)), 10) : NaN, oy = had ? parseInt(m.get(lc(ty)), 10) : NaN;
    if (out.x !== ox) edits.push({ section: s.name, key: tx, value: String(out.x) });
    if (out.y !== oy) edits.push({ section: s.name, key: ty, value: String(out.y) });
    if (out.resized) {
      if (out.w !== iw) edits.push({ section: s.name, key: 'Width', value: String(out.w) });
      if (out.h !== ih) edits.push({ section: s.name, key: 'Height', value: String(out.h) });
      resized++;
    }
    if (!had) added++;
    else if (out.x !== ox || out.y !== oy) { if (onThisScreen) clamped++; else refit++; }
  }
  if (!edits.length) return { text: src, added: 0, clamped: 0, refit: 0, resized: 0, sourceRes };
  return { text: applyIniKeyEdits(src, edits).text, added, clamped, refit, resized, sourceRes };
}

// ---- compare ---------------------------------------------------------------------------------

// The screen size a set of files was played at: its eqclient.ini [VideoMode] Width/Height, or null.
function videoModeOf(files) {
  const name = findName(files, 'eqclient.ini');
  if (!name || typeof files[name] !== 'string') return null;
  const vm = parseSections(files[name]).find((s) => /^videomode$/i.test(s.name));
  if (!vm) return null;
  const m = keyMap(vm), w = posInt(m.get('width')), h = posInt(m.get('height'));
  return w && h ? { w, h } : null;
}
// A backup made on THIS computer is put back as it was (sameMachine): its block for this screen size is kept, even
// when the game ran at another size the day the backup was made. "How it looks on the other PC" has no meaning there.
const fitOpts = (backupFiles, skinSizes, target, sameMachine) =>
  ({ source: sameMachine && target && target.w > 0 && target.h > 0 ? target : videoModeOf(backupFiles), skinSizes });

const prep = (partKey, text, target, fit) =>
  (partKey === 'layout' && target && target.w > 0 && target.h > 0) ? fitLayout(text, target.w, target.h, fit).text : text;

// What an entry covers, as id -> signature. Whole files count per section (a window, a spell set);
// sections/keys modes count per key (a button, a keybind).
function unitsOf(entry, text) {
  const out = new Map();
  const file = lc(entry.file);
  for (const s of firstBlocks(parseSections(text))) {
    if (entry.mode === 'whole') {
      if (!s.keys.length) continue;
      out.set(file + '|' + lc(s.name), { sig: s.keys.map((k) => lc(k.key) + '=' + k.value).sort().join('\n') });
      continue;
    }
    if (!s.name || !entry.test(s.name)) continue;
    for (const k of s.keys) {
      if (entry.keyTest && !entry.keyTest(k.key)) continue;
      if (entry.mode === 'keys' && !KEY_OK.test(k.key)) continue;
      out.set(file + '|' + lc(s.name) + '|' + lc(k.key), { sig: k.value, key: k.key });
    }
  }
  return out;
}

const NOUN = {
  layout: ['window', 'windows'], hotkeys: ['button', 'buttons'], socials: ['social line', 'social lines'],
  spellsets: ['spell set', 'spell sets'], keybinds: ['keybind', 'keybinds'], zeal: ['setting', 'settings'],
  zealchar: ['setting', 'settings'],
  other: ['setting', 'settings'],
};
const plural = (n, [one, many]) => n + ' ' + (n === 1 ? one : many);

function summarize(partKey, r, diffKeys) {
  if (!r.inBackup) return r.removed ? 'not in this backup (restoring would remove ' + r.removed + ')' : 'not in this backup';
  if (!r.added && !r.changed && !r.removed) return 'identical';
  if (partKey === 'layout') {
    const bits = [];
    if (r.changed) bits.push(plural(r.changed, ['window', 'windows']) + ' moved');
    if (r.added) bits.push(r.added + ' new');
    if (r.removed) bits.push(r.removed + ' removed');
    return bits.join(', ');
  }
  if (partKey === 'hotkeys' || partKey === 'socials') {
    const pages = new Set(), buttons = new Set();
    for (const k of diffKeys) {
      const m = /Page(\d+)Button(\d+)/i.exec(k || '');
      if (m) { pages.add(+m[1]); buttons.add(m[1] + ':' + m[2]); }
    }
    if (buttons.size && diffKeys.every((k) => /Page\d+Button\d+/i.test(k || ''))) {
      const p = [...pages].sort((a, b) => a - b);
      return (p.length === 1 ? 'page ' + p[0] + ' differs' : 'pages ' + p.join(', ') + ' differ')
        + ' (' + plural(buttons.size, ['button', 'buttons']) + ')';
    }
  }
  if (!r.added && !r.removed) return plural(r.changed, NOUN[partKey] || ['item', 'items']) + (r.changed === 1 ? ' differs' : ' differ');
  const bits = [];
  if (r.added) bits.push(r.added + ' new');
  if (r.changed) bits.push(r.changed + ' changed');
  if (r.removed) bits.push(r.removed + ' removed');
  return bits.join(', ');
}

function compare(partKey, backupFiles, localFiles, character, opts = {}) {
  const entries = classify(backupFiles, character, { ...opts, localPerCharKeys: perCharKeys(localFiles) })[partKey] || [];
  const r = { inBackup: 0, same: false, added: 0, changed: 0, removed: 0, summary: '' };
  let sameN = 0;
  const diffKeys = [];
  for (const entry of entries) {
    const ln = findName(localFiles, entry.file);
    const local = ln && typeof localFiles[ln] === 'string' ? localFiles[ln] : '';
    const b = unitsOf(entry, entryText(entry, prep(partKey, backupFiles[entry.file], opts.target, fitOpts(backupFiles, opts.skinSizes, opts.target, opts.sameMachine))));
    const l = unitsOf(entry, local);
    for (const [id, u] of b) {
      r.inBackup++;
      const lu = l.get(id);
      if (!lu) { r.added++; diffKeys.push(u.key); }
      else if (lu.sig !== u.sig) { r.changed++; diffKeys.push(u.key); }
      else sameN++;
    }
    // keys mode never deletes; neither does a keepAbsent section the backup does not have
    if (entry.mode !== 'keys' && !(entry.keepAbsent && !b.size)) {
      for (const [id, u] of l) if (!b.has(id)) { r.removed++; diffKeys.push(u.key); }
    }
  }
  r.same = r.inBackup > 0 && sameN === r.inBackup && !r.removed;
  r.summary = summarize(partKey, r, diffKeys);
  return r;
}

// ---- buildRestore ----------------------------------------------------------------------------

function blocksOf(text) {
  const blocks = [{ name: '', lines: [] }];
  for (const ln of splitLines(text)) {
    const m = SEC_RE.exec(ln.t);
    if (m) blocks.push({ name: m[1].trim(), lines: [ln] });
    else blocks[blocks.length - 1].lines.push(ln);
  }
  return blocks;
}
const trimTail = (lines) => {
  let n = lines.length;
  while (n > 0 && lines[n - 1].t.trim() === '') n--;
  return [lines.slice(0, n), lines.slice(n)];
};

// Make every selected section exactly the backup's; everything else stays as it was.
// keepAbsent: a selected section the backup does not have is left as it is here instead of removed (key bindings:
// a backup without the section must never wipe this PC's).
function replaceSections(localText, backupText, test, keepAbsent) {
  const eol = localText.includes('\r\n') ? '\r\n'
    : localText.includes('\n') ? '\n' : (backupText.includes('\r\n') ? '\r\n' : '\n');
  const want = new Map();
  for (const b of blocksOf(backupText)) if (b.name && test(b.name) && !want.has(lc(b.name))) want.set(lc(b.name), b);
  const used = new Set();
  const out = [];
  for (const b of blocksOf(localText)) {
    if (!b.name || !test(b.name)) { out.push(...b.lines); continue; }
    const nb = want.get(lc(b.name));
    if (!nb && keepAbsent) { out.push(...b.lines); continue; }
    if (!nb || used.has(lc(b.name))) continue;         // absent from the backup (or a repeat block): remove
    used.add(lc(b.name));
    const [have, tail] = trimTail(b.lines);
    const [next] = trimTail(nb.lines);
    if (have.length === next.length && have.every((l, i) => l.t === next[i].t)) out.push(...b.lines);
    else out.push(...next.map((l) => ({ t: l.t, e: eol, fresh: true })), ...tail);
  }
  for (const [k, nb] of want) {
    if (used.has(k)) continue;
    if (out.length && out[out.length - 1].e === '') out[out.length - 1].e = eol;
    out.push(...trimTail(nb.lines)[0].map((l) => ({ t: l.t, e: eol, fresh: true })));
  }
  const noFinalNl = localText !== '' && !localText.endsWith('\n');
  if (noFinalNl && out.length && out[out.length - 1].fresh) out[out.length - 1].e = '';
  return out.map((l) => l.t + l.e).join('');
}

function mergeKeys(localText, backupText, entry) {
  const edits = [];
  for (const s of firstBlocks(parseSections(backupText))) {
    if (!s.name || !entry.test(s.name)) continue;
    for (const k of s.keys) {
      if (!KEY_OK.test(k.key) || (entry.keyTest && !entry.keyTest(k.key))) continue;
      edits.push({ section: s.name, key: k.key, value: k.value });
    }
  }
  let text = applyIniKeyEdits(localText, edits).text;
  // A brand-new file takes the backup's line endings (the editor defaults to CRLF).
  if (localText === '' && text && !backupText.includes('\r\n')) text = text.replace(/\r\n/g, '\n');
  return text;
}

function buildRestore({ backupFiles, localFiles, character, parts, knownChars, target, skinSizes, sameMachine } = {}) {
  const { files: backup, skipped } = filterRestorable(backupFiles);
  const classes = classify(backup, character, { knownChars, localPerCharKeys: perCharKeys(localFiles) });
  const chosen = new Set(parts || []);
  const work = new Map();                              // lowercase name -> { name, orig, text, parts }
  for (const part of PARTS) {
    if (!chosen.has(part.key)) continue;
    for (const entry of classes[part.key]) {
      const ln = findName(localFiles, entry.file);
      const name = ln || entry.file;
      if (!work.has(lc(name))) {
        const orig = ln && typeof localFiles[ln] === 'string' ? localFiles[ln] : null;
        work.set(lc(name), { name, orig, text: orig == null ? '' : orig, parts: new Set() });
      }
      const w = work.get(lc(name));
      w.parts.add(part.key);
      const bText = entryText(entry, prep(part.key, backup[entry.file], target, fitOpts(backupFiles, skinSizes, target, sameMachine)));
      if (entry.mode === 'whole') w.text = bText;
      else if (entry.mode === 'sections') w.text = replaceSections(w.text, bText, entry.test, entry.keepAbsent);
      else w.text = mergeKeys(w.text, bText, entry);
    }
  }
  const writes = {}, fileParts = {};
  for (const w of work.values()) {
    if (w.text !== (w.orig == null ? '' : w.orig)) {                            // unchanged files are not rewritten
      writes[w.name] = w.text;
      fileParts[w.name] = PARTS.filter((p) => w.parts.has(p.key)).map((p) => p.key);   // which parts changed it, for the result list
    }
  }
  return { writes, skipped, fileParts };
}

// ---- windowRects -----------------------------------------------------------------------------

// Window boxes as 0..1 fractions of the screen, for a preview thumbnail: the w×h block when the file has one
// (a fitted backup shows where it will land on this PC), else the main resolution block.
function windowRects(text, w, h) {
  const secs = firstBlocks(parseSections(text));
  const asked = Number(w) > 0 && Number(h) > 0 && secs.some((s) => keyMap(s).has('xpos' + Math.round(w) + 'x' + Math.round(h)));
  const main = asked ? { w: Math.round(w), h: Math.round(h) } : mainRes(secs);
  const sw = main ? main.w : Number(w), sh = main ? main.h : Number(h);
  if (!(sw > 0 && sh > 0)) return [];
  const suffix = main ? main.w + 'x' + main.h : '';
  const out = [];
  for (const s of secs) {
    if (!s.name) continue;
    const m = keyMap(s);
    const px = m.get('xpos' + suffix), py = m.get('ypos' + suffix);
    if (px == null || py == null) continue;
    const x = parseInt(px, 10), y = parseInt(py, 10);
    const bw = parseInt(m.has('width') ? m.get('width') : 200, 10);
    const bh = parseInt(m.has('height') ? m.get('height') : 100, 10);
    if (![x, y, bw, bh].every(Number.isFinite) || bw <= 0 || bh <= 0 || bw > sw * 2 || bh > sh * 2) continue;
    const fx = clamp(x / sw, 0, 1), fy = clamp(y / sh, 0, 1);
    out.push({ name: s.name, x: fx, y: fy, w: Math.min(bw / sw, 1 - fx), h: Math.min(bh / sh, 1 - fy) });
    if (out.length >= 80) break;
  }
  return out;
}

module.exports = { PARTS, parseSections, classify, fitLayout, fitOpts, videoModeOf, compare, buildRestore, windowRects };
