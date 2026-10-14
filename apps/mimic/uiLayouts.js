// uiLayouts.js — named EverQuest UI layouts per character, for UI Studio.
//
// The guild lead, 2026-10-14: "we should allow for multiple layouts for characters screens so
// we can have alternative modes, and be able to back up both. Name them as well." One character,
// several named layouts ("Raid (full chat)", "Minimal chat + Mimic overlay"), switch between them,
// every one backed up.
//
// A layout is a snapshot of the character's UI_<char>*.ini files — the window positions, the chat
// windows and their routing. Deliberately NOT the rest of the UI bundle: Socials, spell sets,
// eqclient.ini and zeal.ini hold things EQ keeps changing that have nothing to do with the screen
// arrangement, so switching layouts must not lay an old copy of them over the current ones.
//
// Stored in Mimic's userData as one JSON file per character (layouts-<char>.json):
//   { v: 1, liveId, layouts: [{ id, name, savedAt, files: { "UI_<Char>_pq.proj.ini": "<text>" } }] }
// The name is the member's text (cleanLayoutName: trimmed, control characters and path characters
// removed, 40 characters). It is a label and nothing else: files are named by the layout's random
// id plus the character, and an ini inside a layout is written only under its own bare file name.
// At most LAYOUT_CAP layouts per character.
//
// EQ rewrites the UI file when the character camps or quits, so a layout applied while the
// character is in game is overwritten. switchTo() therefore queues instead of writing when the
// caller says EQ is running (main.js feeds the queue into the same after-logout watcher the Save
// button uses); with EQ closed it writes at once. Either way the file it replaces is kept by the
// injected backupAndWrite (a .bak / .bak-eq copy beside it).
//
// Pure of Electron: the file system and the two EQ-folder helpers are injected, so the tests run
// the shipped code against a temp folder.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LAYOUT_CAP = 10;
const NAME_MAX = 40;
const FILE_MAX_CHARS = 4 * 1024 * 1024;
const FILES_MAX = 20;
// The cloud backup's label (the bot already stores `label`, 80 chars) carries the name.
const CLOUD_LABEL_PREFIX = 'Layout: ';

const CHAR_RE = /^[A-Za-z]{2,24}$/;
const LAYOUT_FILE_RE = /^UI_[\w.-]+\.ini$/i;

// A member's text -> a short label. Control characters and the characters a path or a file system
// would care about are dropped, runs of spaces collapse. '' means "nothing usable".
function cleanLayoutName(raw) {
  if (raw == null) return '';
  let s = String(raw);
  s = s.replace(/\p{Cc}|\p{Zl}|\p{Zp}/gu, ' ');
  s = s.replace(/[\\/:*?"<>|]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX).trim();
  return s;
}

function cloudLabel(name) { return (CLOUD_LABEL_PREFIX + cleanLayoutName(name)).slice(0, 80); }
// The reverse, for a backup list: the layout's name when the label is one of ours, else null.
function nameFromCloudLabel(label) {
  const s = String(label == null ? '' : label);
  if (s.slice(0, CLOUD_LABEL_PREFIX.length) !== CLOUD_LABEL_PREFIX) return null;
  return cleanLayoutName(s.slice(CLOUD_LABEL_PREFIX.length)) || null;
}

// The part of a bundle (file name -> text) that is the screen layout: this character's UI_*.ini.
function pickLayoutFiles(bundle, character) {
  const out = {};
  const want = String(character || '').toLowerCase();
  for (const [name, text] of Object.entries(bundle || {})) {
    if (typeof text !== 'string' || !text.length || text.length > FILE_MAX_CHARS) continue;
    if (path.basename(name) !== name || !LAYOUT_FILE_RE.test(name)) continue;
    const m = name.match(/^UI_([A-Za-z]+)/i);
    if (!m || m[1].toLowerCase() !== want) continue;
    out[name] = text;
    if (Object.keys(out).length >= FILES_MAX) break;
  }
  return out;
}

function sameFiles(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  const lower = new Map(kb.map(k => [k.toLowerCase(), k]));
  for (const k of ka) {
    const other = lower.get(k.toLowerCase());
    if (other === undefined || a[k] !== b[other]) return false;
  }
  return true;
}

const fail = (code, error) => ({ ok: false, code, error });

// deps: { dir, readBundle(eqDir, character) -> {name:text}, backupAndWrite(target, text, tag) -> bakPath,
//         now?, newId? }
function createLayoutStore(deps) {
  const dir = deps.dir;
  const now = deps.now || Date.now;
  const newId = deps.newId || (() => crypto.randomBytes(5).toString('hex'));

  function fileFor(character) {
    const c = String(character || '').trim();
    if (!CHAR_RE.test(c)) return null;
    return path.join(dir, `layouts-${c.toLowerCase()}.json`);
  }
  function load(character) {
    const fp = fileFor(character);
    let data = null;
    try { data = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { /* none yet / unreadable */ }
    if (!data || !Array.isArray(data.layouts)) data = { v: 1, liveId: null, layouts: [] };
    data.layouts = data.layouts.filter(l => l && typeof l.id === 'string' && /^[0-9a-f]{4,32}$/.test(l.id)
      && typeof l.name === 'string' && l.files && typeof l.files === 'object');
    return data;
  }
  function persist(character, data) {
    const fp = fileFor(character);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, fp);
  }
  const byName = (data, name, exceptId) =>
    data.layouts.find(l => l.id !== exceptId && l.name.toLowerCase() === name.toLowerCase());
  function summary(l, data, current, pendingId) {
    const matches = !!current && sameFiles(current, l.files);
    const live = data.liveId ? data.liveId === l.id : matches;
    return {
      id: l.id, name: l.name, savedAt: l.savedAt,
      fileCount: Object.keys(l.files).length,
      bytes: Object.values(l.files).reduce((n, t) => n + t.length, 0),
      live, modified: live && !matches && !!current,
      pending: !!pendingId && pendingId === l.id,
    };
  }

  // Put `files` under `name` (new layout, or overwrite `id` / the same-named one). Marks it live.
  function put(character, files, name, opts) {
    if (!fileFor(character)) return fail('character', 'a character name is required');
    if (!Object.keys(files).length) return fail('nofiles', 'no UI file found for this character in the EQ folder');
    const data = load(character);
    let target = null;
    if (opts && opts.id) {
      target = data.layouts.find(l => l.id === opts.id);
      if (!target) return fail('notfound', 'that layout no longer exists');
    }
    let finalName = name == null || name === '' ? (target ? target.name : '') : cleanLayoutName(name);
    if (!finalName) return fail('name', 'give the layout a name');
    const clash = byName(data, finalName, target && target.id);
    if (clash) {
      if (!(opts && opts.replace) || target) return fail('exists', `a layout named "${clash.name}" already exists`);
      target = clash;
    }
    if (!target) {
      if (data.layouts.length >= LAYOUT_CAP) return fail('cap', `${LAYOUT_CAP} layouts is the most per character — delete one first`);
      target = { id: newId(), name: finalName, savedAt: 0, files: {} };
      data.layouts.push(target);
    }
    target.name = finalName;
    target.savedAt = now();
    target.files = files;
    // A snapshot of the disk IS the live layout; one imported from a backup is only stored.
    if (!opts || opts.live !== false) data.liveId = target.id;
    persist(character, data);
    return { ok: true, layout: { id: target.id, name: target.name, savedAt: target.savedAt, fileCount: Object.keys(files).length } };
  }

  return {
    LAYOUT_CAP,

    list(character, eqDir, opts) {
      if (!fileFor(character)) return fail('character', 'a character name is required');
      const data = load(character);
      let current = null;
      try { const f = pickLayoutFiles(deps.readBundle(eqDir, character), character); current = Object.keys(f).length ? f : null; } catch { /* folder gone */ }
      const pendingId = opts && opts.pendingId;
      const layouts = data.layouts.map(l => summary(l, data, current, pendingId))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      return { ok: true, layouts, cap: LAYOUT_CAP, hasCurrent: !!current };
    },

    get(character, id) {
      if (!fileFor(character)) return null;
      return load(character).layouts.find(l => l.id === id) || null;
    },

    // Snapshot the character's UI files as they are on disk now. id => update that layout in place.
    save(character, eqDir, name, opts) {
      let bundle;
      try { bundle = deps.readBundle(eqDir, character); } catch (e) { return fail('read', 'could not read the EQ folder'); }
      return put(character, pickLayoutFiles(bundle, character), name, opts);
    },

    // A layout made from files that did not come off this disk (a cloud backup being restored).
    importFiles(character, name, files, opts) {
      return put(character, pickLayoutFiles(files, character), name, { ...opts, live: false });
    },

    rename(character, id, newName) {
      if (!fileFor(character)) return fail('character', 'a character name is required');
      const data = load(character);
      const l = data.layouts.find(x => x.id === id);
      if (!l) return fail('notfound', 'that layout no longer exists');
      const name = cleanLayoutName(newName);
      if (!name) return fail('name', 'give the layout a name');
      const clash = byName(data, name, id);
      if (clash) return fail('exists', `a layout named "${clash.name}" already exists`);
      l.name = name;
      persist(character, data);
      return { ok: true, layout: { id: l.id, name: l.name, savedAt: l.savedAt, fileCount: Object.keys(l.files).length } };
    },

    remove(character, id) {
      if (!fileFor(character)) return fail('character', 'a character name is required');
      const data = load(character);
      const before = data.layouts.length;
      data.layouts = data.layouts.filter(l => l.id !== id);
      if (data.layouts.length === before) return fail('notfound', 'that layout no longer exists');
      if (data.liveId === id) data.liveId = null;
      persist(character, data);
      return { ok: true };
    },

    // Write a layout's files into the EQ folder, each replaced file backed up first (backupTag 'eq'
    // for the after-logout path, so the user can tell it replaced EQ's own last copy).
    apply(character, eqDir, id, opts) {
      const l = this.get(character, id);
      if (!l) return fail('notfound', 'that layout no longer exists');
      if (!eqDir || !fs.existsSync(eqDir) || !fs.statSync(eqDir).isDirectory()) return fail('eqdir', 'the EQ folder is not there');
      const tag = opts && opts.backupTag ? opts.backupTag : null;
      const written = [];
      for (const [name, text] of Object.entries(l.files)) {
        // Only a bare UI_*.ini name, only inside the EQ folder.
        if (typeof text !== 'string' || path.basename(name) !== name || !LAYOUT_FILE_RE.test(name)) continue;
        deps.backupAndWrite(path.join(eqDir, name), text, tag);
        written.push(name);
      }
      const data = load(character);
      data.liveId = l.id;
      persist(character, data);
      return { ok: true, written, name: l.name };
    },

    // The Switch button. eqRunning=true (EQ is up, or this character is in game) => nothing is
    // written; the caller's queue() gets the entry to apply after logout. Otherwise it writes now.
    switchTo(character, eqDir, id, ctx) {
      const l = this.get(character, id);
      if (!l) return fail('notfound', 'that layout no longer exists');
      if (ctx && ctx.eqRunning) {
        if (typeof ctx.queue !== 'function') return fail('noqueue', 'cannot queue the switch');
        ctx.queue({ kind: 'layout', character, eqDir, layoutId: l.id, layoutName: l.name });
        return { ok: true, queued: true, name: l.name };
      }
      const r = this.apply(character, eqDir, id, null);
      return r.ok ? { ok: true, applied: true, written: r.written, name: r.name } : r;
    },
  };
}

module.exports = {
  LAYOUT_CAP, NAME_MAX, CLOUD_LABEL_PREFIX,
  cleanLayoutName, cloudLabel, nameFromCloudLabel, pickLayoutFiles, sameFiles, createLayoutStore,
};
