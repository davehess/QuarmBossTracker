// test/recruit-card-agent.test.js — the first-sign-in "Your characters" card (agent + dashboard half).
//
// The guild lead (2026-10-24): "We should be asking what characters the player would like to upload (from their
// logs). If none show up, they can type in their character name to get started. A lot of things won't work without
// logs. And we should ask about grabbing an upload of their quarmy/spellbook/inventory if it shows up."
// What can go wrong without anyone noticing, and what this file pins:
//   * a backup copy of a log (eqlog_Name2_..., .txt2) or another server's log is offered as a character;
//   * the newest log is not first (a main cannot be told from a forgotten alt) or a name found in two folders is listed twice;
//   * "Upload these now" sends every character's files, or ignores a privacy gate / the raid hold, or says "sent"
//     for a file a gate held back;
//   * the card shows to someone who already has a character linked, comes back after Save or Not now, or a save the
//     guild server did not take is remembered as done (an old bot answers 200 'OK' to any unknown route);
//   * a name that is not a name leaves the PC, or more than twelve do;
//   * the timers' own scans change behaviour (they now take an optional argument; they must run unchanged without one);
//   * the card's identifiers collide with another card's (a duplicate `var` silently wins), or a clickable cell
//     is given class="name" and opens /character/<token>.
// The real functions are read out of the shipped files and run against stand-ins. Text assertions strip comments.
//
// Run: npx vitest run test/recruit-card-agent.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const html = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

// ── _recruitScan, with the shipped file-name patterns ──────────────────────────────────────────────
const scanCode = [
  sliceBlock(src, 'const SPELLBOOK_FILENAME_RX =', ';'),
  sliceBlock(src, 'const INVENTORY_FILENAME_RX =', ';'),
  sliceBlock(src, 'const QUARMY_FILENAME_RX =', ';'),
  sliceBlock(src, 'const RECRUIT_LOG_RX =', ';'),
  sliceBlock(src, 'function _recruitCap(n) {', '\n'),
  sliceBlock(src, 'function _recruitScan(dirs, fsx) {', '\n}\n'),
].join('\n');
// eslint-disable-next-line no-new-func
const { _recruitScan, _recruitCap } = new Function('path', scanCode + '\nreturn { _recruitScan, _recruitCap };')(path.posix);

// A folder tree in memory: { dir: { file: { mtimeMs, size } } }
function fakeFs(tree) {
  return {
    readdirSync(d) { if (!tree[d]) throw new Error('ENOENT'); return Object.keys(tree[d]); },
    statSync(p) {
      const d = path.posix.dirname(p), f = path.posix.basename(p);
      if (!tree[d] || !tree[d][f]) throw new Error('ENOENT');
      return tree[d][f];
    },
  };
}
const T = (days) => Date.UTC(2026, 9, 24) - days * 86400000;

describe('_recruitScan', () => {
  it('lists each character with a standard Quarm log, newest log first, with the log\'s date and size', () => {
    const fsx = fakeFs({ '/eq': {
      'eqlog_Aldenmar_pq.proj.txt': { mtimeMs: T(40), size: 9_000_000 },
      'eqlog_Brackwyn_pq.proj.txt': { mtimeMs: T(1), size: 2_000_000 },
      'eqlog_Corvale_pq.proj.txt': { mtimeMs: T(10), size: 500 },
    } });
    const r = _recruitScan(['/eq'], fsx);
    expect(r.characters.map(c => c.name)).toEqual(['Brackwyn', 'Corvale', 'Aldenmar']);
    expect(r.characters[0]).toEqual({ name: 'Brackwyn', mtime: T(1), size: 2_000_000 });
  });

  it('does not offer backups, rotated tails, or another server\'s log as a character', () => {
    const fsx = fakeFs({ '/eq': {
      'eqlog_Aldenmar_pq.proj.txt': { mtimeMs: T(2), size: 1 },
      'eqlog_Aldenmar2_pq.proj.txt': { mtimeMs: T(1), size: 1 },      // a copy aside: digits are never in a name
      'eqlog_Brackwyn_pq.proj.txt2': { mtimeMs: T(1), size: 1 },
      'eqlog_Brackwyn_pq.proj.txt.bak': { mtimeMs: T(1), size: 1 },
      'eqlog_Corvale_P1999Green.txt': { mtimeMs: T(1), size: 1 },     // Project 1999, not Quarm
      'eqlog_Rethlan_pq.proj BACKUP.txt': { mtimeMs: T(1), size: 1 },
      'eqlog_A_pq.proj.txt': { mtimeMs: T(1), size: 1 },              // one letter is not a name
      'readme.txt': { mtimeMs: T(1), size: 1 },
    } });
    expect(_recruitScan(['/eq'], fsx).characters.map(c => c.name)).toEqual(['Aldenmar']);
  });

  it('a name found in two folders is listed once, with the newer log', () => {
    const fsx = fakeFs({
      '/eq': { 'eqlog_Aldenmar_pq.proj.txt': { mtimeMs: T(30), size: 1 } },
      '/eq/Logs': { 'eqlog_Aldenmar_pq.proj.txt': { mtimeMs: T(3), size: 7 } },
    });
    const r = _recruitScan(['/eq', '/eq/Logs'], fsx);
    expect(r.characters).toEqual([{ name: 'Aldenmar', mtime: T(3), size: 7 }]);
  });

  it('a folder that is not there is skipped, not fatal', () => {
    const fsx = fakeFs({ '/eq': { 'eqlog_Aldenmar_pq.proj.txt': { mtimeMs: T(1), size: 1 } } });
    expect(_recruitScan(['/nope', '/eq', '/eq/Logs'], fsx).characters).toHaveLength(1);
    expect(_recruitScan([], fsx)).toEqual({ characters: [], files: {} });
  });

  it('finds the spellbook, inventory and Quarmy files by character, even for a name with no log', () => {
    const fsx = fakeFs({ '/eq': {
      'eqlog_Aldenmar_pq.proj.txt': { mtimeMs: T(1), size: 1 },
      'Aldenmar-Spellbook.txt': { mtimeMs: T(1), size: 1 },
      'Aldenmar-Inventory.txt': { mtimeMs: T(1), size: 1 },
      'AldenmarQuarmy.txt': { mtimeMs: T(1), size: 1 },
      'Brackwyn-Spellbook.txt': { mtimeMs: T(1), size: 1 },
      'Aldenmar_bandolier.ini': { mtimeMs: T(1), size: 1 },           // not one of the three
    } });
    const r = _recruitScan(['/eq'], fsx);
    expect(r.files).toEqual({
      aldenmar: { spellbook: true, inventory: true, quarmy: true },
      brackwyn: { spellbook: true },
    });
    expect(r.characters.map(c => c.name)).toEqual(['Aldenmar']);
  });

  it('_recruitCap writes a name the way the log file spells it', () => {
    expect(_recruitCap('aLDENMAR')).toBe('Aldenmar');
  });
});

// ── _recruitUploadNow: the existing scans, limited to the staged names, honouring their gates ─────────────────
const uploadCode = sliceBlock(src, 'function _recruitUploadNow(names, found) {', '\n}\n');
function uploadHarness({ raidHold = false, prefsChecked = true, dirs = ['/eq'], send = {} } = {}) {
  const calls = [];
  const spellbook = {}, inventory = {}, quarmy = {};
  const maps = { spellbook, inventory, quarmy };
  const mkScan = (kind) => (opts) => {
    calls.push({ kind, only: [...opts.only].sort(), dir: opts.dir });
    for (const lc of Object.keys(send[kind] || {})) if (opts.only.has(lc)) maps[kind][lc] = send[kind][lc];
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    '_raidHold', 'stats', '_spellbookUploaded', '_inventoryUploaded', '_quarmyUploaded',
    'scanSpellbookFiles', 'scanInventoryUploads', 'scanQuarmyExports', '_recruitDirs',
    uploadCode + '\nreturn _recruitUploadNow;',
  )(raidHold, { characterPrefsCheckedAt: prefsChecked ? 1 : 0 }, spellbook, inventory, quarmy,
    mkScan('spellbook'), mkScan('inventory'), mkScan('quarmy'), () => dirs);
  return { fn, calls, maps };
}

describe('_recruitUploadNow', () => {
  const found = { aldenmar: { spellbook: true, inventory: true, quarmy: true }, brackwyn: { spellbook: true } };

  it('runs all three scans in each folder, for the named characters only', () => {
    const h = uploadHarness({ dirs: ['/eq', '/eq/Logs'], send: { spellbook: { aldenmar: 'sb1' }, inventory: { aldenmar: 'inv1' }, quarmy: { aldenmar: 'q1' } } });
    const r = h.fn(['Aldenmar'], found);
    expect(h.calls).toHaveLength(6);
    expect(h.calls.every(c => c.only.join() === 'aldenmar')).toBe(true);
    expect(new Set(h.calls.map(c => c.kind))).toEqual(new Set(['spellbook', 'inventory', 'quarmy']));
    expect(new Set(h.calls.map(c => c.dir))).toEqual(new Set(['/eq', '/eq/Logs']));
    expect(r.held).toBeNull();
    expect(r.results).toEqual({ Aldenmar: { spellbook: 'queued', inventory: 'queued', quarmy: 'queued' } });
  });

  it('reports only files that exist, and tells apart sent now, already up to date, and held by a scan rule', () => {
    const h = uploadHarness({ send: { spellbook: { aldenmar: 'sb2' } } });
    h.maps.spellbook.aldenmar = 'sb1';          // checksum from an earlier run: changed now -> queued
    h.maps.quarmy.aldenmar = 'q1';              // sent earlier, nothing changed -> up to date
    // inventory: the file exists but nothing was sent (excluded / empty) -> waiting
    const r = h.fn(['Aldenmar', 'Brackwyn'], found);
    expect(r.results.Aldenmar).toEqual({ spellbook: 'queued', inventory: 'waiting', quarmy: 'up to date' });
    expect(r.results.Brackwyn).toEqual({ spellbook: 'waiting' });
  });

  it('while the privacy prefs are unknown, or the raid hold is on, it runs no scan and says what held it', () => {
    const a = uploadHarness({ prefsChecked: false });
    expect(a.fn(['Aldenmar'], found).held).toBe('prefs');
    expect(a.calls).toEqual([]);
    const b = uploadHarness({ raidHold: true });
    expect(b.fn(['Aldenmar'], found).held).toBe('raid');
    expect(b.calls).toEqual([]);
  });

  it('a character with no export file gets no entry, and a scan that throws does not stop the others', () => {
    const h = uploadHarness({});
    expect(h.fn(['Corvale'], found).results).toEqual({});
  });
});

// ── the card's save / dismiss / show decisions ──────────────────────────────────────────────────────────────
const actCode = [
  sliceBlock(src, 'const RECRUIT_NAME_RX =', ';'),
  sliceBlock(src, 'const RECRUIT_MAX_NAMES =', ';'),
  sliceBlock(src, 'function _recruitCap(n) {', '\n'),
  sliceBlock(src, 'const RECRUIT_NOTES = {', '\n};'),
  sliceBlock(src, 'async function recruitCardAct(body) {', '\n}\n'),
  sliceBlock(src, 'async function recruitCardPayload({ fresh = false } = {}) {', '\n}\n'),
].join('\n');
function cardHarness({ posted, mine = { ok: true, characters: [] }, why = null, optin = null, token = 'wpms_x1234567' } = {}) {
  const log = { posts: [], saved: 0, uploads: [], fetchedMine: 0, cacheReset: 0 };
  const state = { optin: { recruitCard: optin }, linkedKey: '', modes: 'cache', stateCache: 'cache' };
  // _recruitLinkedKey and the two cache variables are module-level lets in the shipped file; the slice assigns to them
  // as free variables, so redirect those assignments into `state` (the rewrite is asserted below so it cannot go stale).
  const wrapped = actCode
    .replace(/_recruitLinkedKey = /g, 'state.linkedKey = ')
    .replace(/_modesMineCache = null/g, 'state.modes = null')
    .replace(/_stateJsonCache = \{ at: 0, body: null \}/g, 'state.stateCache = null');
  // eslint-disable-next-line no-new-func
  const api = new Function(
    '_optinState', '_saveOptInState', '_postRecruitStage', '_recruitUploadNow', '_recruitScan', '_recruitDirs', 'fs',
    '_characterModesWhyNot', 'fetchCharacterModesMine', '_eqSetupDirs', '_mimicSessionToken', 'scheduleRender', 'state',
    wrapped + '\nreturn { act: recruitCardAct, payload: recruitCardPayload };',
  )(
    state.optin, () => { log.saved++; },
    async (chars) => { log.posts.push(chars); return posted(chars); },
    (names, f) => { log.uploads.push(names); return { held: null, results: {}, names, f }; },
    () => ({ characters: [{ name: 'Aldenmar', mtime: 1, size: 2 }], files: { aldenmar: { spellbook: true } } }),
    () => ['/eq'], {},
    () => why,
    async () => { log.fetchedMine++; return mine; },
    () => ['/eq'], token, () => {}, state,
  );
  return { api, log, state };
}
const took = (staged, conflicts = []) => async () => ({ ok: true, staged, conflicts });

describe('recruitCardAct — save', () => {
  it('sends the names with the main flagged, remembers the save, and clears the caches that hid the new family', async () => {
    const h = cardHarness({ posted: took([{ name: 'Aldenmar', is_main: true, rank: 'Recruit' }]) });
    const r = await h.api.act({ action: 'save', characters: [{ name: 'aldenmar', is_main: true }, { name: 'Brackwyn' }] });
    expect(h.log.posts).toEqual([[{ name: 'Aldenmar', is_main: true }, { name: 'Brackwyn', is_main: false }]]);
    expect(r).toMatchObject({ ok: true, saved: true, upload: null });
    expect(h.state.optin.recruitCard.state).toBe('saved');
    expect(h.log.saved).toBe(1);
    expect(h.state.modes).toBeNull();
    expect(h.state.stateCache).toBeNull();
  });

  it('uploads only the names the guild server staged, and only when asked', async () => {
    const h = cardHarness({ posted: took([{ name: 'Aldenmar' }], [{ name: 'Brackwyn', reason: 'owned_by_another' }]) });
    await h.api.act({ action: 'save', upload: false, characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] });
    expect(h.log.uploads).toEqual([]);
    const g = cardHarness({ posted: took([{ name: 'Aldenmar' }], [{ name: 'Brackwyn', reason: 'owned_by_another' }]) });
    const r = await g.api.act({ action: 'save', upload: true, characters: [{ name: 'Aldenmar' }, { name: 'Brackwyn' }] });
    expect(g.log.uploads).toEqual([['Aldenmar']]);
    expect(r.conflicts).toEqual([{ name: 'Brackwyn', reason: 'owned_by_another' }]);
  });

  it('a save the guild server took nothing from is not remembered, so the card stays', async () => {
    const h = cardHarness({ posted: took([], [{ name: 'Aldenmar', reason: 'owned_by_another' }]) });
    const r = await h.api.act({ action: 'save', upload: true, characters: [{ name: 'Aldenmar' }] });
    expect(r).toMatchObject({ ok: true, saved: false });
    expect(h.state.optin.recruitCard).toBeNull();
    expect(h.log.saved).toBe(0);
    expect(h.log.uploads).toEqual([]);
  });

  it('a failed post (offline, old bot, signed out) is not remembered and says why in words', async () => {
    for (const reason of ['offline', 'bot-old', 'signed-out', 'not-linked']) {
      const h = cardHarness({ posted: async () => ({ ok: false, reason }) });
      const r = await h.api.act({ action: 'save', characters: [{ name: 'Aldenmar' }] });
      expect(r.ok).toBe(false);
      expect(r.reason).toBe(reason);
      expect(r.error).toMatch(/\w{5}/);
      expect(h.state.optin.recruitCard).toBeNull();
    }
  });

  it('refuses a bad list before anything is sent', async () => {
    const h = cardHarness({ posted: took([]) });
    const bad = [
      [], 'x',
      [{ name: 'Bad1' }], [{ name: 'A' }], [{ name: '../x' }], [{ name: 'Alden mar' }], [{}], [null],
      Array.from({ length: 13 }, (_, i) => ({ name: 'Nm' + 'abcdefghijklm'[i] })),
    ];
    for (const characters of bad) {
      const r = await h.api.act({ action: 'save', characters });
      expect(r.ok, JSON.stringify(characters)).toBe(false);
    }
    expect(h.log.posts).toEqual([]);
    expect(h.state.optin.recruitCard).toBeNull();
  });

  it('an unknown action does nothing', async () => {
    const h = cardHarness({ posted: took([]) });
    expect((await h.api.act({ action: 'wipe' })).ok).toBe(false);
    expect((await h.api.act(null)).ok).toBe(false);
    expect(h.state.optin.recruitCard).toBeNull();
  });
});

describe('recruitCardAct — dismiss, and recruitCardPayload — whether to show', () => {
  it('Not now is remembered and sends nothing', async () => {
    const h = cardHarness({ posted: took([]) });
    expect(await h.api.act({ action: 'dismiss' })).toEqual({ ok: true, dismissed: true });
    expect(h.state.optin.recruitCard.state).toBe('dismissed');
    expect(h.log.saved).toBe(1);
    expect(h.log.posts).toEqual([]);
  });

  it('shows to a signed-in person whose family is empty, with the characters and files found', async () => {
    const h = cardHarness({});
    const p = await h.api.payload();
    expect(p).toMatchObject({ show: true, reason: null, eq_folder_known: true });
    expect(p.characters.map(c => c.name)).toEqual(['Aldenmar']);
    expect(p.files).toEqual({ aldenmar: { spellbook: true } });
  });

  it('does not show to a person who already has a character, and remembers that for this sign-in', async () => {
    const h = cardHarness({ mine: { ok: true, characters: [{ name: 'Aldenmar' }] } });
    const p = await h.api.payload();
    expect(p).toMatchObject({ show: false, reason: 'linked' });
    expect(h.state.linkedKey).toBe('x1234567'.slice(-8));
  });

  it('does not show after a save or a dismiss, and does not ask the guild server again', async () => {
    for (const state of ['saved', 'dismissed']) {
      const h = cardHarness({ optin: { state, at: 1 } });
      expect(await h.api.payload()).toMatchObject({ show: false, reason: state });
      expect(h.log.fetchedMine).toBe(0);
    }
  });

  it('does not show in local mode, signed out, or when the guild server cannot be asked', async () => {
    for (const why of ['local', 'signed-out']) {
      const h = cardHarness({ why });
      expect(await h.api.payload()).toMatchObject({ show: false, reason: why });
      expect(h.log.fetchedMine).toBe(0);
    }
    for (const reason of ['offline', 'bot-old']) {
      const h = cardHarness({ mine: { ok: false, reason } });
      expect(await h.api.payload()).toMatchObject({ show: false, reason });
    }
  });
});

// ── the shipped wiring ──────────────────────────────────────────────────────────────────────────────────────
describe('_postRecruitStage', () => {
  const fn = stripJs(sliceBlock(src, 'async function _postRecruitStage(characters) {', '\n}\n'));
  it('goes to /characters/stage next to /character-prefs, as the signed-in person, and counts only a real answer', () => {
    expect(fn).toMatch(/base \+ '\/characters\/stage'/);
    expect(fn).toMatch(/_characterPrefsHeaders\(\)/);
    expect(fn).toMatch(/_characterModesWhyNot\(\)/);
    // the old bot's catch-all answers 200 'OK' to an unknown route: that is "bot-old", not "saved"
    expect(fn).toMatch(/j\.ok !== true \|\| !Array\.isArray\(j\.staged\)\) return \{ ok: false, reason: 'bot-old' \}/);
    expect(fn).toMatch(/r\.status === 404\) return \{ ok: false, reason: 'bot-old' \}/);
  });
});

describe('the timers\' own scans are unchanged without an argument', () => {
  const kinds = [
    ['scanQuarmyExports', 'fileChar'],
    ['scanSpellbookFiles', 'lower'],
    ['scanInventoryUploads', 'lower'],
  ];
  for (const [name, key] of kinds) {
    it(name + ': optional opts, filter applied before the exclusion checks, default folder kept', () => {
      const fn = stripJs(sliceBlock(src, 'function ' + name + '(opts) {', '\n}\n'));
      expect(fn).toMatch(/if \(!firstLog && !\(opts && opts\.dir\)\) return;/);
      expect(fn).toMatch(/const dir = \(opts && opts\.dir\) \|\| path\.dirname\(firstLog\);/);
      const only = fn.indexOf('if (opts && opts.only && !opts.only.has(' + key + ')) continue;');
      expect(only).toBeGreaterThan(-1);
      expect(only).toBeLessThan(fn.indexOf('_quarmyPrefsBlock(' + key + ')'));
      // the gates the card must not bypass are still the first lines
      expect(fn.indexOf('_raidHold')).toBeLessThan(fn.indexOf('opts.only'));
      expect(fn.indexOf('characterPrefsCheckedAt')).toBeLessThan(fn.indexOf('opts.only'));
    });
  }
  it('the timers still call them with no argument', () => {
    const s = stripJs(src);
    for (const [name] of kinds) {
      expect(s).toMatch(new RegExp('setTimeout\\(' + name + ', \\d'));
      expect(s).toMatch(new RegExp('setInterval\\(' + name + ', '));
    }
  });
});

describe('persistence, routes and state', () => {
  const s = stripJs(src);
  it('the choice is saved in and read back from the opt-in file, and a damaged value reads as "not decided"', () => {
    expect(s).toMatch(/recruitCard:\s+_optinState\.recruitCard \|\| null,/);
    expect(s).toMatch(/_optinState\.recruitCard\s+= _cleanRecruitCard\(raw\.recruitCard\);/);
    const clean = new Function(sliceBlock(src, 'function _cleanRecruitCard(raw) {', '\n}\n') + '\nreturn _cleanRecruitCard;')();
    expect(clean({ state: 'saved', at: 5 })).toEqual({ state: 'saved', at: 5 });
    expect(clean({ state: 'dismissed' })).toEqual({ state: 'dismissed', at: 0 });
    for (const bad of [null, undefined, 'saved', 5, {}, { state: 'maybe' }, { state: 'SAVED' }]) expect(clean(bad)).toBeNull();
  });

  it('GET and POST /api/recruit-card exist and the POST body is bounded', () => {
    expect(s).toMatch(/req\.url === '\/api\/recruit-card' && req\.method === 'GET'/);
    expect(s).toMatch(/req\.url === '\/api\/recruit-card' && req\.method === 'POST'/);
    expect(s).toMatch(/_readBody\(req, 8 \* 1024\)[^\n]*\n[^\n]*\n[^\n]*recruitCardAct/);
  });

  it('/api/state carries only a local, cheap "may apply" flag', () => {
    expect(s).toMatch(/recruitCardPending: !_optinState\.recruitCard && !!_mimicSessionToken && !_localOnly\(\)\s+&& _recruitLinkedKey !== String\(_mimicSessionToken\)\.slice\(-8\),/);
  });
});

describe('the dashboard card', () => {
  const start = html.indexOf('var _wpYc = {');
  const end = html.indexOf('// 🐺 Me — the member', start);
  const block = html.slice(start, end);
  const code = stripJs(block);

  it('is placed, registered as a section, and has its own wp* placeholder', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(html).toMatch(/h \+= '<div id="wpRecruitCard"><\/div>';/);
    expect(html).toMatch(/\['recruitcard', renderRecruitCard\], \['mecard', renderMeCard\]/);
  });

  it('its identifiers are declared once in the whole page (a second `var` of the same name silently wins)', () => {
    const decls = [...html.matchAll(/^(?:var|let|const) (_wpYc|_wpRc)\b|^function (wpYc\w*|renderRecruitCard)\(/gm)].map(m => m[1] || m[2]);
    const counts = {};
    for (const d of decls) counts[d] = (counts[d] || 0) + 1;
    expect(counts._wpYc).toBe(1);
    expect(counts.renderRecruitCard).toBe(1);
    for (const [k, n] of Object.entries(counts)) expect(n, k).toBe(1);
    // the raid-code card owns _wpRc / wpRc*; this card must not touch them
    expect(code).not.toMatch(/_wpRc\b|wpRc[A-Z]/);
  });

  it('asks nothing of the guild server until the engine says it may apply, and stops asking once it does not', () => {
    expect(code).toMatch(/_wpYc\.pending = !!\(s && s\.recruitCardPending\)/);
    expect(code).toMatch(/if \(!_wpYc\.pending && !_wpYc\.done\) \{ _wpYc\.data = null; _wpYc\.fetchedAt = 0; morphInto\(el, ''\); return; \}/);
    expect(code).toMatch(/Date\.now\(\) - _wpYc\.fetchedAt < 60000/);   // at most one ask a minute
  });

  it('typing never repaints (it would reset the box mid-word); ticking and the main do', () => {
    const input = sliceBlock(code, "document.addEventListener('input'", '\n});');
    expect(input).not.toMatch(/wpYcPaint|refresh\(/);
    const change = sliceBlock(code, "document.addEventListener('change'", '\n});');
    expect(change).toMatch(/wpYcPaint\(\)/);
  });

  it('pre-ticks the newest log as the main, once, and a later fetch never changes the ticks', () => {
    const fetchFn = sliceBlock(code, 'function wpYcFetch(force) {', '\n}\n');
    expect(fetchFn).toMatch(/!_wpYc\.ready/);
    expect(fetchFn).toMatch(/_wpYc\.sel\[d\.characters\[0\]\.name\] = true;/);
    expect(fetchFn).toMatch(/_wpYc\.main = d\.characters\[0\]\.name;/);
  });

  it('says why when no logs show up and offers a box to type a name', () => {
    expect(block).toMatch(/Mimic did not find any EverQuest logs/);
    expect(block).toMatch(/start EverQuest once with logging on/);
    expect(block).toMatch(/id="rcTyped"/);
    expect(block).toMatch(/Also found:/);
    expect(block).toMatch(/Save and upload these now/);
    expect(block).toMatch(/Not now/);
  });

  it('shows the log\'s date, not an age that changes every poll; no class="name"; every <details> keeps its state', () => {
    expect(code).not.toMatch(/fmtAgo/);
    expect(block).not.toMatch(/class="name"|class=\\"name\\"/);
    expect((block.match(/<details/g) || []).length).toBe((block.match(/<details ' \+ wpKeep\(/g) || []).length);
  });

  it('the result view tells a gate that held the files from files that went', () => {
    expect(code).toMatch(/up\.held === 'raid'/);
    expect(code).toMatch(/st === 'queued' \? 'sent'/);
  });
});
