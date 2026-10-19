// test/portable-layout.test.js — a Canvas layout as a file that fits any screen (Keepers of the (Overlay)
// Arts; the guild lead, 2026-10-19: "make it so overlays are exportable into file and importable if people
// want to share privately but also encourage people to share publicly and then they can have their name
// on the overlay").
//
// portableLayout.js and overlaySets.js run for real (require). The wiring in main.js, preload.js,
// Settings, the tray and the dashboard is checked as comment-stripped source.
//
// Run: npx vitest run test/portable-layout.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const pl = require(path.join(ROOT, 'apps', 'mimic', 'portableLayout.js'));
const sets = require(path.join(ROOT, 'apps', 'mimic', 'overlaySets.js'));
const mimic = (f) => readSource(path.join(ROOT, 'apps', 'mimic', f));
const main = mimic('main.js');

// A Canvas layout drawn on a W×H display, from pixel boxes (the Canvas keeps a fraction and a pixel size).
const panel = (W, H, id, box, extra) => Object.assign({ id, kind: 'part', part: 'me.hp', mode: 'bar', name: '',
  x: box[0] / W, y: box[1] / H, w: box[2], h: box[3], scale: 1, back: false, grp: null, off: false }, extra);
// Drawn on 2560×1440: a two-piece column on the left, a timers panel at the right edge near the bottom,
// a cast bar centred low.
function authored(W, H) {
  return { panels: [
    panel(W, H, 'a1', [40, 300, 240, 30], { grp: 'gL' }),
    panel(W, H, 'a2', [40, 340, 240, 30], { part: 'me.mana', grp: 'gL' }),
    { id: 'tm', kind: 'timers', all: true, groups: [], names: [], name: 'Timers', x: (W - 20 - 300) / W, y: (H - 80 - 160) / H, w: 300, h: 160, scale: 1, anchor: 'bottom', grp: null, off: false },
    panel(W, H, 'cb', [(W - 400) / 2, 1100, 400, 40], { part: 'me.cast' }),
  ] };
}
const SCREENS = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  ultrawide: { width: 3440, height: 1440 },
};
const exportFrom = (W, H, eq, meta) => {
  const r = pl.toPortable(authored(W, H), { width: W, height: H }, eq === undefined ? { x: 0, y: 0, width: W, height: H } : eq, meta);
  expect(r.ok, r.error).toBe(true);
  return r.doc;
};
// A panel's box in the importer's pixels.
const boxOf = (layout, id, S) => { const p = layout.panels.find(q => q.part === id || q.kind === id); return { l: p.x * S.width, t: p.y * S.height, w: p.w, h: p.h, p }; };
const near = (a, b, tol = 1.2) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);

describe('the format: each group pinned to its nearest edge or centre', () => {
  it('names the anchor of each group and writes lengths in reference-height units', () => {
    const doc = exportFrom(2560, 1440);
    expect(doc).toMatchObject({ format: 'mimic-layout', version: 1, kind: 'canvas' });
    const anchors = Object.fromEntries(doc.groups.map(g => [g.panels.map(p => p.part || p.kind).join('+'), g.anchor]));
    expect(anchors['me.hp+me.mana']).toBe('tl');      // the column hugs the top-left
    expect(anchors.timers).toBe('br');                // bottom-right
    expect(anchors['me.cast']).toBe('bc');            // centred, low
    const col = doc.groups.find(g => g.anchor === 'tl');
    expect(col.ox).toBeCloseTo(40 / 1440, 4);         // 40 px from the left, in units of the 1440 px height
    expect(col.oy).toBeCloseTo(300 / 1440, 4);
    expect(col.panels[0].w).toBeCloseTo(240 / 1440, 4);
    expect(doc.needs.parts).toEqual(['me.cast', 'me.hp', 'me.mana']);
  });

  it('round-trips onto its own screen and onto 1080p, 1440p and an ultrawide, edge groups staying on their side', () => {
    const doc = exportFrom(2560, 1440);
    for (const [name, S] of Object.entries(SCREENS)) {
      const r = pl.fromPortable(doc, S, { x: 0, y: 0, width: S.width, height: S.height }, { stamp: 'test' });
      expect(r.ok, name + ' ' + r.error).toBe(true);
      expect(r.count).toBe(4);
      const k = S.height / 1440;                                   // sizes follow the screen height
      const hp = boxOf(r.layout, 'me.hp', S), mana = boxOf(r.layout, 'me.mana', S);
      const tm = boxOf(r.layout, 'timers', S), cb = boxOf(r.layout, 'me.cast', S);
      near(hp.w, 240 * k); near(hp.h, 30 * k);
      near(hp.l, 40 * k); near(hp.t, 300 * k);                     // the column stays LEFT, whatever the width
      near(mana.t - hp.t, 40 * k);                                  // and keeps its inner spacing
      near(S.width - (tm.l + tm.w), 20 * k);                        // the timers stay 20 (scaled) px off the RIGHT edge
      near(S.height - (tm.t + tm.h), 80 * k);                       // and off the bottom
      near(cb.l + cb.w / 2, S.width / 2);                           // the cast bar stays CENTRED
      near(S.height - (cb.t + cb.h), 300 * k);
      expect(hp.p.grp).toBe(mana.p.grp);                            // the column is still one locked group
      expect(hp.p.grp).toBeTruthy();
      expect(tm.p.grp).toBeNull();
    }
  });

  it('a layout made on an ultrawide lands right on 1080p, and the other way round', () => {
    const doc = exportFrom(3440, 1440);
    const r = pl.fromPortable(doc, SCREENS['1080p'], null);
    const k = 1080 / 1440;
    const hp = boxOf(r.layout, 'me.hp', SCREENS['1080p']), tm = boxOf(r.layout, 'timers', SCREENS['1080p']);
    near(hp.l, 40 * k); near(1920 - (tm.l + tm.w), 20 * k);
    const back = pl.fromPortable(exportFrom(1920, 1080), SCREENS.ultrawide, null);
    near(boxOf(back.layout, 'timers', SCREENS.ultrawide).l + boxOf(back.layout, 'timers', SCREENS.ultrawide).w, 3440 - 20 * (1440 / 1080));
  });

  it('is relative to EverQuest\'s window when it is known: a windowed client carries the layout with it', () => {
    const doc = exportFrom(2560, 1440);
    expect(doc.ref.of).toBe('eq');
    const S = SCREENS['1080p'], eq = { x: 100, y: 50, width: 1600, height: 900 };   // EQ windowed, 900 tall
    const r = pl.fromPortable(doc, S, eq);
    const k = 900 / 1440;
    const hp = boxOf(r.layout, 'me.hp', S), tm = boxOf(r.layout, 'timers', S), cb = boxOf(r.layout, 'me.cast', S);
    near(hp.l, 100 + 40 * k); near(hp.t, 50 + 300 * k);
    near(100 + 1600 - (tm.l + tm.w), 20 * k);
    near(cb.l + cb.w / 2, 100 + 800);
    // An EQ rect that is not on this display is ignored and the display is the reference.
    const off = pl.fromPortable(doc, S, { x: 5000, y: 0, width: 1600, height: 900 });
    near(boxOf(off.layout, 'me.hp', S).l, 40 * (1080 / 1440));
    const made = pl.toPortable(authored(2560, 1440), { width: 2560, height: 1440 }, { x: 4000, y: 0, width: 1600, height: 900 });
    expect(made.doc.ref.of).toBe('screen');
  });

  it('text scale follows the screen height too, within the Canvas\'s own limits', () => {
    const src = authored(2560, 1440);
    src.panels[0].scale = 2.5;
    const doc = pl.toPortable(src, SCREENS['1440p'], null).doc;
    expect(doc.groups.flatMap(g => g.panels).find(p => p.part === 'me.hp').scale).toBeCloseTo(2.5 * 1080 / 1440, 3);   // written for a 1080 reference
    const at = (S) => boxOf(pl.fromPortable(doc, S, null).layout, 'me.hp', S).p.scale;
    near(at(SCREENS['1440p']), 2.5, 0.002);                          // its own screen: unchanged
    near(at(SCREENS['1080p']), 2.5 * 1080 / 1440, 0.002);            // smaller screen, smaller text
    near(at({ width: 3840, height: 2160 }), 3, 0.002);               // 3.75 would be off the Canvas's range: clamped
  });

  it('keeps a group on the display: it slides, it is never squashed', () => {
    const doc = exportFrom(3440, 1440);
    const tiny = { width: 800, height: 600 };
    const r = pl.fromPortable(doc, tiny, null);
    for (const p of r.layout.panels) {
      expect(p.x).toBeGreaterThanOrEqual(0); expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x * tiny.width + p.w).toBeLessThanOrEqual(tiny.width + 1);
      expect(p.y * tiny.height + p.h).toBeLessThanOrEqual(tiny.height + 1);
    }
  });

  it('a group hanging off the edge slides whole, keeping the spacing between its pieces', () => {
    const piece = (dx) => ({ kind: 'part', part: 'me.hp', mode: 'bar', dx, dy: 0, w: 0.1, h: 0.05, scale: 1 });
    const doc = { format: 'mimic-layout', version: 1, kind: 'canvas', meta: { title: 't' },
      groups: [{ anchor: 'tl', ox: 1.2, oy: 0.1, panels: [piece(0), piece(0.2)] }] };
    const S = { width: 800, height: 600 };
    const [a, b] = pl.fromPortable(doc, S, null).layout.panels;
    near((b.x - a.x) * S.width, 0.2 * 600);                          // 120 px apart, as drawn (not squeezed against the edge)
    expect(b.x * S.width + b.w).toBeLessThanOrEqual(S.width + 1);
  });

  it('fresh ids on the way in, and what the Canvas reads is all there', () => {
    const doc = exportFrom(2560, 1440);
    const a = pl.fromPortable(doc, SCREENS['1080p'], null, { stamp: 'aaa' }).layout.panels;
    const b = pl.fromPortable(doc, SCREENS['1080p'], null, { stamp: 'bbb' }).layout.panels;
    expect(new Set(a.map(p => p.id)).size).toBe(a.length);
    expect(a.map(p => p.id).some(id => b.map(q => q.id).includes(id))).toBe(false);
    expect(a.every(p => p.id.length <= 24)).toBe(true);
    const t = a.find(p => p.kind === 'timers');
    expect(t).toMatchObject({ all: true, names: [], anchor: 'bottom', groups: [] });
  });
});

describe('privacy: nothing from this computer or about a person leaves with the file', () => {
  const dirty = () => {
    const src = authored(2560, 1440);
    src.named = { gL: 'saved-id-123' };
    src.chooser = { open: true, x: 0.7, y: 0.1, tab: 'groups' };
    Object.assign(src.panels[0], { name: 'Brackwyn heals', path: 'C:\\Users\\Aldenmar\\Documents\\x.png', src: 'file:///C:/Users/Aldenmar/p.html' });
    src.panels.push({ id: 'ch', kind: 'timers', all: false, groups: ['charm'], names: ["brackwyn`s charm", 'corvale'], name: 'Corvale mez', x: 0.5, y: 0.5, w: 300, h: 100, scale: 1, anchor: 'top', grp: null, off: false });
    return src;
  };
  const json = () => JSON.stringify(pl.toPortable(dirty(), SCREENS['1440p'], null).doc);

  it('a character name in a filter or a panel name is gone, and so is every path, id and saved-group link', () => {
    const j = json();
    for (const s of ['Brackwyn', 'brackwyn', 'Corvale', 'corvale', 'Aldenmar', 'C:', 'file:', 'saved-id-123', 'named', 'chooser', '"names"', '"name"', '"id"', '"grp"']) {
      expect(j, s).not.toContain(s);
    }
    const doc = JSON.parse(j);
    const charm = doc.groups.flatMap(g => g.panels).find(p => p.kind === 'timers' && !p.all);
    expect(charm).toMatchObject({ groups: ['charm'], grow: 'top' });     // what it CLAIMS by group stays; who it names does not
    expect(charm.names).toBeUndefined();
  });

  it('the Canvas names a one-group timers panel after its group when it comes back', () => {
    const doc = pl.toPortable(dirty(), SCREENS['1440p'], null).doc;
    const back = pl.fromPortable(doc, SCREENS['1440p'], null).layout.panels.find(p => p.kind === 'timers' && !p.all);
    expect(back.name).toBe('Charm');
    expect(back.names).toEqual([]);
  });

  it('the byline is blank unless the person typed one; text is cleaned and capped', () => {
    expect(pl.toPortable(authored(2560, 1440), SCREENS['1440p'], null).doc.meta.author).toBe('');
    const m = pl.toPortable(authored(2560, 1440), SCREENS['1440p'], null,
      { title: ' A\u0007  big\u202e title '.repeat(10), author: 'Some Player', description: 'x'.repeat(500) }).doc.meta;
    expect(m.author).toBe('Some Player');
    expect(m.title.length).toBeLessThanOrEqual(60);
    expect(m.title).not.toMatch(/[\u0007\u202e]/);
    expect(m.description).toHaveLength(280);
  });
});

describe('validation: a file from anywhere is untrusted', () => {
  const good = () => JSON.parse(JSON.stringify(exportFrom(2560, 1440)));
  const text = (d) => JSON.stringify(d);
  const refuses = (label, mutate) => {
    const d = good(); mutate(d);
    const r = pl.validate(d);
    expect(r.ok, label).toBe(false);
    expect(typeof r.error, label).toBe('string');
  };

  it('takes what the exporter wrote', () => {
    const r = pl.parse(text(good()));
    expect(r.ok, r.error).toBe(true);
    expect(pl.describe(r.doc)).toMatchObject({ pieces: 4, author: '' });
    expect(r.doc).toEqual(pl.validate(r.doc).doc);                // validating its own output changes nothing
  });

  it('refuses anything that is not JSON, not ours, or too new', () => {
    expect(pl.parse('not json').ok).toBe(false);
    expect(pl.parse('[]').ok).toBe(false);
    expect(pl.parse('null').ok).toBe(false);
    expect(pl.parse(undefined).ok).toBe(false);
    refuses('format', d => { d.format = 'something-else'; });
    refuses('no version', d => { delete d.version; });
    refuses('version 0', d => { d.version = 0; });
    refuses('float version', d => { d.version = 1.5; });
    refuses('kind', d => { d.kind = 'script'; });
    const newer = pl.validate(Object.assign(good(), { version: 99 }));
    expect(newer.error).toMatch(/newer Mimic/);
  });

  it('refuses an oversized file and too many pieces', () => {
    expect(pl.parse(' '.repeat(pl.MAX_BYTES + 1) + text(good())).ok).toBe(false);
    const many = (n) => { const d = good(); d.groups = [{ anchor: 'tl', ox: 0, oy: 0, panels: Array.from({ length: n }, () => d.groups[0].panels[0]) }]; return d; };
    expect(pl.validate(many(pl.MAX_PANELS)).ok).toBe(true);
    expect(pl.validate(many(pl.MAX_PANELS + 1)).ok).toBe(false);
    refuses('no groups', d => { d.groups = []; });
    refuses('too many groups', d => { d.groups = Array.from({ length: 61 }, () => d.groups[0]); });
    refuses('groups not a list', d => { d.groups = { 0: {} }; });
    refuses('empty group', d => { d.groups[0].panels = []; });
  });

  it('refuses malformed pieces: wrong kinds, ids, numbers and enums', () => {
    refuses('unknown kind', d => { d.groups[0].panels[0].kind = 'script'; });
    refuses('part id with a path', d => { d.groups[0].panels[0].part = '../../etc/passwd'; });
    refuses('part id missing', d => { delete d.groups[0].panels[0].part; });
    refuses('bad anchor', d => { d.groups[0].anchor = 'top-left'; });
    refuses('offset out of range', d => { d.groups[0].ox = 99; });
    refuses('number as text', d => { d.groups[0].panels[0].w = '0.2'; });
    refuses('negative size', d => { d.groups[0].panels[0].w = -1; });
    refuses('NaN', d => { d.groups[0].panels[0].dx = NaN; });
    refuses('Infinity', d => { d.groups[0].panels[0].h = Infinity; });
    refuses('scale out of range', d => { d.groups[0].panels[0].scale = 100; });
    refuses('colour', d => { d.groups[0].panels[0].color = 'red'; });
    refuses('colour injection', d => { d.groups[0].panels[0].color = '#fff;background:url(x)'; });
    refuses('flag as text', d => { d.groups[0].panels[0].off = 'yes'; });
    refuses('thick', d => { d.groups[0].panels[0].thick = 'huge'; });
    refuses('piece not an object', d => { d.groups[0].panels[0] = 'me.hp'; });
    refuses('piece is a list', d => { d.groups[0].panels[0] = []; });
    refuses('unknown class', d => { d.groups[0].panels[0].cls = ['Hacker']; });
    refuses('unknown show-when', d => { d.groups[0].panels[0].when = 'always-evil'; });
    refuses('timers group unknown', d => { const t = d.groups.flatMap(g => g.panels).find(p => p.kind === 'timers'); t.groups = ['nope']; });
    refuses('overlay key', d => { d.groups[0].panels[0] = { kind: 'overlay', key: 'a b', dx: 0, dy: 0, w: 0.2, h: 0.2, scale: 1 }; });
    refuses('section id', d => { d.groups[0].panels[0] = { kind: 'sect', key: 'mobinfo', sect: 'Bad Id!', pw: 300, ph: 300, dx: 0, dy: 0, w: 0.2, h: 0.2, scale: 1 }; });
    refuses('arc not an object', d => { d.groups[0].panels[0].arc = 'big'; });
    refuses('details missing', d => { delete d.meta; });
    refuses('title not text', d => { d.meta.title = { toString: 'x' }; });
    refuses('classes unknown', d => { d.meta.classes = ['Warrior', 'Hacker']; });
    refuses('modes unknown', d => { d.meta.modes = ['raid', 'x']; });
    refuses('classes not a list', d => { d.meta.classes = 'Warrior'; });
    refuses('reference block', d => { d.ref = { of: 'moon', aspect: 1 }; });
  });

  it('copies no key it does not know, and cannot be used to reach the prototype', () => {
    const raw = text(good()).replace('"groups"', '"__proto__":{"polluted":"yes"},"exec":"calc.exe","groups"')
      .replace('"anchor"', '"constructor":{"prototype":{"x":1}},"script":"alert(1)","anchor"');
    const r = pl.parse(raw);
    expect(r.ok, r.error).toBe(true);
    const out = JSON.stringify(r.doc);
    for (const s of ['"exec"', 'calc.exe', '"script"', 'alert(1)', 'polluted', 'constructor']) expect(out, s).not.toContain(s);
    expect({}.polluted).toBeUndefined();
    expect(Object.keys(r.doc)).toEqual(['format', 'version', 'kind', 'meta', 'needs', 'ref', 'groups']);
    // The needs list is worked out from the pieces, never read from the file.
    const lie = good(); lie.needs = { parts: ['evil.thing'], overlays: ['x'] };
    expect(pl.validate(lie).doc.needs.parts).not.toContain('evil.thing');
    // And the Canvas layout that comes out holds only the fields the Canvas reads.
    const lay = pl.fromPortable(r.doc, SCREENS['1080p'], null).layout.panels;
    for (const p of lay) expect(Object.keys(p).every(k => ['id', 'kind', 'name', 'x', 'y', 'w', 'h', 'scale', 'grp', 'off', 'when', 'cls', 'part', 'mode', 'back', 'nolabel', 'thick', 'color', 'align', 'arc', 'key', 'sect', 'pw', 'ph', 'style', 'anchor', 'all', 'groups', 'names'].includes(k)), JSON.stringify(Object.keys(p))).toBe(true);
  });

  it('fromPortable validates for itself and refuses a bad screen; toPortable refuses an empty canvas', () => {
    expect(pl.fromPortable({ format: 'mimic-layout' }, SCREENS['1080p'], null).ok).toBe(false);
    expect(pl.fromPortable(good(), { width: 0, height: 0 }, null).ok).toBe(false);
    expect(pl.fromPortable(good(), null, null).ok).toBe(false);
    expect(pl.toPortable({ panels: [] }, SCREENS['1080p'], null).ok).toBe(false);
    expect(pl.toPortable(null, SCREENS['1080p'], null).ok).toBe(false);
    expect(pl.toPortable(authored(1920, 1080), { width: 10, height: 10 }, null).ok).toBe(false);
  });

  it('does not change what it is given', () => {
    const doc = good(), before = JSON.stringify(doc);
    pl.fromPortable(doc, SCREENS['1080p'], null);
    expect(JSON.stringify(doc)).toBe(before);
    const src = authored(2560, 1440), s0 = JSON.stringify(src);
    pl.toPortable(src, SCREENS['1440p'], null);
    expect(JSON.stringify(src)).toBe(s0);
  });
});

describe('a new set never lands on one the person has', () => {
  it('uniqueName counts up, keeps to the name limit, and gives up honestly', () => {
    const s = sets.empty();
    expect(sets.uniqueName(s, 'Raid')).toBe('Raid');
    sets.put(s, 'Raid', {}, null); sets.put(s, 'raid 2', {}, null);
    expect(sets.uniqueName(s, 'RAID')).toBe('RAID 3');
    expect(sets.uniqueName(s, '   ')).toBe('Imported layout');
    const long = 'x'.repeat(40);
    sets.put(s, long, {}, null);
    const next = sets.uniqueName(s, long);
    expect(next.length).toBeLessThanOrEqual(sets.NAME_MAX);
    expect(next).not.toBe(sets.cleanName(long));
    const t = sets.empty();
    sets.put(t, 'A', {}, null);
    for (let i = 2; i < 100; i++) t.sets[sets.keyOf('A ' + i)] = { name: 'A ' + i };
    expect(sets.uniqueName(t, 'A')).toBeNull();
  });
});

describe('wiring: Export / Import where sets are managed, the same on the tray, Settings and the dashboard', () => {
  const body = (src, start, end) => stripJs(sliceBlock(src, start, end));
  const exportFn = body(main, 'async function _exportLayoutFile(opts) {', '\n}\n// Pick a file, show what it holds');
  const importFn = body(main, 'async function _importLayoutFile() {', '\n}\n// The tray has no status line');

  it('export writes through the save dialog, only what portableLayout.toPortable made', () => {
    expect(exportFn).toMatch(/dialog\.showSaveDialog\(/);
    expect(exportFn).toMatch(/portableLayout\.toPortable\(src\.layout, src\.screen, src\.eq,/);
    expect(exportFn).toMatch(/JSON\.stringify\(made\.doc, null, 2\)/);
    expect(exportFn).toMatch(/\.mimic-layout\.json/);
    expect(exportFn).toMatch(/nudge: _LAYOUT_NUDGE/);
    expect(stripJs(main)).toMatch(/const _LAYOUT_NUDGE = 'Share it in the Gallery and your name goes on it\./);
  });

  it('import parses with the module, shows what is in it, saves the current setup first, adds a NEW set, offers Undo', () => {
    const order = ['portableLayout.parse(text)', 'dialog.showMessageBox(win || null, {\n      type: \'question\'', "overlaySets.put(store, beforeName,", 'overlaySets.put(store, newName, snap, who)',
      "_overlaySetCommand({ verb: 'load', name: newName }", "buttons: ['Keep it', 'Undo']", "_overlaySetCommand({ verb: 'load', name: beforeName }"];
    let at = -1;
    for (const s of order) { const i = importFn.indexOf(s); expect(i, s).toBeGreaterThan(at); at = i; }
    expect(importFn).toMatch(/overlaySets\.uniqueName\(store, info\.title\)/);          // never over a set they have
    expect(importFn).toMatch(/overlaySets\.uniqueName\(store, 'Before ' \+ newName\)/);
    expect(importFn).toMatch(/MAX_SETS/);
    expect(importFn).toMatch(/size > portableLayout\.MAX_BYTES/);
    expect(importFn).toMatch(/snap\.show\.showCanvas = true/);
    expect(importFn).toMatch(/info\.author \? `By \$\{info\.author\}` : 'No author name on it'/);
    expect(importFn).toMatch(/info\.pieces/);
  });

  it('is file-only: no token, no network, so the local edition has it exactly as the guild edition', () => {
    for (const fn of [exportFn, importFn]) {
      expect(fn).not.toMatch(/resolveUploadToken|botUrl|cfg\.session|fetch\(|https?\.request|http\.request|localOnly|agentPort/);
    }
  });

  it('the tray, the IPC and the preload bridge are wired', () => {
    const m = stripJs(main);
    expect(m).toMatch(/_layoutFileFromTray\(\(\) => _exportLayoutFile\(\{\}\)\)/);
    expect(m).toMatch(/_layoutFileFromTray\(\(\) => _importLayoutFile\(\)\)/);
    expect(m).toMatch(/ipcMain\.handle\('overlay-layout-export', \(_e, opts\) => _exportLayoutFile\(opts\)\)/);
    expect(m).toMatch(/ipcMain\.handle\('overlay-layout-import', \(\) => _importLayoutFile\(\)\)/);
    const pre = stripJs(mimic('preload.js'));
    expect(pre).toMatch(/overlayLayoutExport: \(opts\) => ipcRenderer\.invoke\('overlay-layout-export', opts\)/);
    expect(pre).toMatch(/overlayLayoutImport: \(\)\s+=> ipcRenderer\.invoke\('overlay-layout-import'\)/);
  });

  it('Settings has Export (per set and for the screen now), Import, and the optional byline', () => {
    const s = mimic('settings.html');
    for (const id of ['layoutExport', 'layoutImport', 'layoutByline', 'layoutTitle', 'layoutNote', 'layoutMode']) expect(s).toContain(`id="${id}"`);
    expect(s).toMatch(/data-set-export=/);
    expect(s).toMatch(/overlayLayoutExport\(_layoutOpts\(b\.dataset\.setExport\)\)/);
    expect(s).toMatch(/overlayLayoutImport\(\)/);
    expect(s).toMatch(/r\.nudge/);
    expect(s).toMatch(/id="layoutByline" type="text" maxlength="32" placeholder="Your name on it \(optional\)"/);   // blank by default
  });

  it('the dashboard\'s Overlays tab has the same two actions, driving the same bridge', () => {
    const d = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
    expect(d).toMatch(/data-act="layoutExport"/);
    expect(d).toMatch(/data-act="layoutImport"/);
    expect(d).toMatch(/window\.mimic\.overlayLayoutExport\(\{ title: sv\('wpShareTitle'\), author: sv\('wpShareBy'\) \}\)/);
    expect(d).toMatch(/window\.mimic\.overlayLayoutImport\(\)/);
    expect(d).toMatch(/id="wpShareBy" type="text" maxlength="32" placeholder="Your name on it \(optional\)"/);
  });
});
