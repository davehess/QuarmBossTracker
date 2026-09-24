// Mini mode, the per-overlay half, for Extended Target and the Pet tracker.
//
// The guild lead, 2026-09-24: "Currently mini mode doesn't do anything." The
// shared half (preload's body.wp-mini toggle + the wp-mini-change event) was
// built; no overlay had a rendition to switch to. These two are the guild
// vote's picks (closed 2026-09-17, wolfpack.quest/mimic/mini):
//   • Extended Target, option A "CC letters + count" — every targeted mob, one
//     line each: HP bar, name, → its target, SLOW / MEZ as S / M pills and all
//     other debuffs folded into one ·N.
//   • Pet, option B "Haste as a second bar" — HP bar + name → target, then the
//     haste buff draining with its time left (amber under 10s, purple when it
//     fell off). The pet buff carries no haste PERCENT, so the label is the
//     buff's short name.
//
// Each page's WHOLE <script> runs against a small fake DOM, so the wiring (the
// mini swap, the repaint on a flip, the fit after the render) is exercised,
// not just read. Names are invented.
//
// Run: npx vitest run test/mini-extarget-pets.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripCss } from './_source-slice.js';

const extHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'extarget.html'));
const petHtml = readSource(path.join(ROOT, 'apps', 'mimic', 'pets.html'));

const scriptOf = (html) => html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
const cssOf    = (html) => stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
const markupOf = (html) => html.slice(html.indexOf('<body>'), html.indexOf('<script>')).replace(/<!--[\s\S]*?-->/g, '');
const flush    = () => new Promise((r) => setTimeout(r, 0));

// ── A fake DOM just big enough for these two pages ──────────────────────────
function fakeClassList() {
  const s = new Set();
  return {
    add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c),
    toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; },
  };
}
function fakeEl(id) {
  return {
    id, innerHTML: '', textContent: '', className: '', value: '', style: {}, children: [], scrollHeight: 120,
    classList: fakeClassList(),
    addEventListener() {}, getAttribute() { return null; }, getBoundingClientRect() { return { top: 0 }; },
  };
}
// Runs the page's real <script>. `snapId` names the element whose HTML each
// fit call records — AT the call, so "fit after the render" is checkable.
function runPage(html, { mini = false, state = null, snapId, exportNames }) {
  const els = new Map();
  const el = (id) => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
  const body = fakeEl('body');
  if (mini) body.classList.add('wp-mini');
  const winL = {};
  const fits = [];
  const window = {
    mimic: {
      autoFitOverlay: () => fits.push(el(snapId).innerHTML),
      overlayAutoHeight: () => fits.push(el(snapId).innerHTML),
    },
    addEventListener: (t, f) => { (winL[t] || (winL[t] = [])).push(f); },
  };
  const document = {
    getElementById: el, body,
    documentElement: { style: { setProperty() {} } },
    addEventListener() {},
  };
  const localStorage = { getItem: () => null, setItem() {} };
  const page = { state };
  // Ext's render is driven directly (its fetch never settles); the pet page
  // renders inside tick(), so its fetch answers with page.state.
  const fetch = state === null
    ? () => new Promise(() => {})
    : async () => ({ json: async () => page.state });
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'document', 'localStorage', 'fetch', 'setInterval', 'requestAnimationFrame',
    scriptOf(html) + '\nreturn { ' + exportNames.join(', ') + ' };')(
    window, document, localStorage, fetch, () => 0, () => 0);
  return {
    ...api, el, fits, page,
    flip(on) {
      body.classList.toggle('wp-mini', on);
      (winL['wp-mini-change'] || []).forEach((f) => f());
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Extended Target — option A, "CC letters + count"
// ════════════════════════════════════════════════════════════════════════════
const ELDER1 = {
  name: 'an elder thought horror', kind: 'npc', hp_pct: 88, raider_count: 3,
  raiders: ['Aldenmar', 'Brackwyn', 'Corvale'], mob_victim: 'Aldenmar',
  ambiguous: true, same_name_count: 2, dup_index: 1, tanks: ['Aldenmar'],
  debuffs: [{ name: 'Turgur`s Insects', remaining_secs: 40 }, { name: 'Tashanian', remaining_secs: 30 }, { name: 'Malosini' }],
};
const GUARD = {
  name: 'a horror guard', kind: 'npc', hp_pct: 46, raider_count: 2, raiders: ['Rethlan', 'Nyssara'],
  mob_victim: 'Rethlan', mob_victim_source: 'zeal_assist',
  debuffs: [{ name: 'Glamour of Kintaz', remaining_secs: 20 }],
};
const ELDER2 = {
  ...ELDER1, hp_pct: 30, raider_count: 1, raiders: ['Zarrin'], mob_victim: 'Zarrin', dup_index: 2, tanks: ['Zarrin'],
  debuffs: [{ name: 'Tashanian' }],
};
const EVOKER = { name: 'a thought horror evoker', kind: 'npc', hp_pct: 100, raider_count: 1, raiders: ['Nyssara'], debuffs: [] };
// As the bot sends it: sorted by raiders on it, the two elders apart.
const PAYLOAD = { online: 6, targets: [ELDER1, GUARD, ELDER2, EVOKER] };

const runExt = (opts = {}) => runPage(extHtml, { ...opts, snapId: 'rows', exportNames: ['render', 'miniRowHtml', 'miniTier'] });
const extRows = (html) => html.split(/(?=<div class="row )/).filter((s) => s.startsWith('<div class="row '));
const extKeys = (html) => [...html.matchAll(/<div class="row [^"]*" data-k="([^"]*)"/g)].map((m) => m[1]);

describe('Extended Target mini — one line per mob', () => {
  it('shows HP%, a 4px bar, the name and → its target, and nothing that expands', () => {
    const x = runExt({ mini: true });
    x.render(PAYLOAD);
    const html = x.el('rows').innerHTML;
    const rows = extRows(html);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r).toMatch(/^<div class="row mrow /);
      expect(r).toMatch(/<span class="hp (hi|mid|lo|unk) wp-mini-num">/);
      expect(r).toContain('<div class="bar wp-mini-bar">');
      expect(r).toContain('<span class="nm wp-mini-name">');
    }
    expect(rows[0]).toContain('>88%</span>');
    expect(rows[0]).toMatch(/<span class="vic"[^>]*><span class="arrow">→<\/span>Aldenmar<\/span>/);
    // The server's own /assist answer keeps its green, as in full mode.
    expect(extRows(html).find((r) => r.includes('a horror guard'))).toMatch(/class="vic auth"[^>]*><span class="arrow">→<\/span>Rethlan/);
    // Nobody seen being hit reads as —, not as a blank.
    expect(rows[3]).toMatch(/class="vic none"[^>]*><span class="arrow">→<\/span>—<\/span>/);
    // Everything full mode hangs under a row stays in full mode.
    for (const gone of ['class="debuffs"', 'class="who"', 'class="mobx"', 'rowhide', 'class="ct', 'tank-tag']) {
      expect(html).not.toContain(gone);
    }
  });

  it('turns SLOW and MEZ into S / M pills and folds every other debuff into one ·N listing them', () => {
    const x = runExt({ mini: true });
    x.render(PAYLOAD);
    const rows = extRows(x.el('rows').innerHTML);
    const elder = rows[0];
    const guard = rows.find((r) => r.includes('a horror guard'));
    // Same classifier + tooltip as the full SLOW pill (strongest slow named),
    // only the label is one letter. A backtick possessive still counts.
    expect(elder).toMatch(/<span class="cc-badge slow" title="Slowed — Turgur`s Insects 75% attack speed · 40s left">S<\/span>/);
    expect(elder).not.toContain('>SLOW<');
    const more = elder.match(/<span class="cc-badge more" title="([^"]*)">·(\d+)<\/span>/);
    expect(more).toBeTruthy();
    expect(more[2]).toBe('2');                          // Tashanian + Malosini, not the slow
    expect(more[1]).toBe('Tashanian 30s, Malosini');
    expect(guard).toMatch(/<span class="cc-badge mez"[^>]*>M<\/span>/);
    expect(guard).not.toContain('cc-badge more');       // the mez was its only debuff
    expect(guard).not.toContain('>MEZ<');
    expect(rows[3]).not.toContain('cc-badge');          // nothing on the evoker
  });

  it('keeps the full debuff list on the row tooltip, with who is on it', () => {
    const x = runExt({ mini: true });
    x.render(PAYLOAD);
    const elder = extRows(x.el('rows').innerHTML)[0];
    expect(elder).toMatch(/^<div class="row mrow npc" data-k="[^"]*" title="3 raiders targeting: Aldenmar, Brackwyn, Corvale — debuffs: Turgur`s Insects 40s, Tashanian 30s, Malosini">/);
  });

  it('keeps today’s order and same-name split, and drops the pooled chip block', () => {
    // Attributed split (tanks known): full renders the two elders together at
    // the first one's place. Mini must land them in exactly the same order.
    const full = runExt();
    full.render(PAYLOAD);
    const mini = runExt({ mini: true });
    mini.render(PAYLOAD);
    const fullKeys = extKeys(full.el('rows').innerHTML);
    expect(fullKeys).toHaveLength(4);
    expect(extKeys(mini.el('rows').innerHTML)).toEqual(fullKeys);
    expect(mini.el('rows').innerHTML).toContain('<span class="dup">#1/2</span>');
    expect(mini.el('rows').innerHTML).toContain('<span class="dup">#2/2</span>');

    // Pooled (no tanks): full adds an "on one of these 2:" block; mini keeps
    // the same row order and adds nothing.
    const pooled = { targets: [{ ...ELDER1, tanks: undefined }, GUARD, { ...ELDER2, tanks: undefined }, EVOKER] };
    full.render(pooled);
    mini.render(pooled);
    expect(full.el('rows').innerHTML).toContain('data-k="pool:');
    expect(mini.el('rows').innerHTML).not.toContain('pool');
    expect(extKeys(mini.el('rows').innerHTML)).toEqual(extKeys(full.el('rows').innerHTML));
  });

  it('keeps the * caveat on a non-unique row, never on an id-proven one', () => {
    const x = runExt({ mini: true });
    expect(x.miniRowHtml(ELDER1)).toMatch(/<span class="amb"[^>]*>\*<\/span>/);
    expect(x.miniRowHtml({ ...ELDER1, id_proven: true, spawn_id: 4411 })).not.toContain('class="amb"');
    expect(x.miniRowHtml(GUARD)).not.toContain('class="amb"');
    // …and the footer that explains it still shows in mini.
    x.render(PAYLOAD);
    expect(x.el('foot').style.display).toBe('block');
    expect(x.el('foot').innerHTML).toContain('non-unique name');
  });

  it('steps the bar at 50/25 like the tank overlay', () => {
    const x = runExt({ mini: true });
    expect([51, 50, 26, 25, 0, null].map((h) => x.miniTier(h))).toEqual(['hi', 'mid', 'mid', 'lo', 'lo', 'unk']);
    const row = x.miniRowHtml({ ...EVOKER, hp_pct: 50 });
    expect(row).toContain('<span class="hp mid wp-mini-num">50%</span>');
    expect(row).toContain('<div class="fill mid" style="width:50%">');
    expect(x.miniRowHtml({ ...EVOKER, hp_pct: null })).toContain('<span class="hp unk wp-mini-num">—</span>');
  });

  it('leaves full mode as it was', () => {
    const x = runExt();
    x.render(PAYLOAD);
    const html = x.el('rows').innerHTML;
    expect(html).not.toContain('mrow');
    for (const kept of ['<div class="row npc', '>SLOW</span>', '>MEZ</span>', 'class="debuffs"', 'class="who"', 'class="rowhide"', 'class="mobx"', '<span class="ct">3</span>']) {
      expect(html).toContain(kept);
    }
  });

  it('re-renders and refits when mini flips — the fit sees the new rows', () => {
    const x = runExt();
    x.render(PAYLOAD);
    const before = x.fits.length;
    x.flip(true);
    expect(x.el('rows').innerHTML).toContain('class="row mrow');
    expect(x.fits.length).toBe(before + 1);
    expect(x.fits.at(-1)).toContain('class="row mrow');
    x.flip(false);
    expect(x.el('rows').innerHTML).not.toContain('mrow');
    expect(x.fits.at(-1)).toContain('<div class="row npc');
  });
});

describe('Extended Target mini — markup and CSS', () => {
  it('hides the header (title, toggles, count) in mini', () => {
    expect(markupOf(extHtml)).toContain('<div class="head wp-mini-hide">');
  });
  it('lays the bar inline on the line and keeps the first row’s pills out from under the ✕', () => {
    const css = cssOf(extHtml);
    expect(css).toContain('body.wp-mini .row.mrow .bar{grid-column:auto;margin-top:0}');
    expect(css).toMatch(/body\.wp-mini \.row\.mrow\{grid-template-columns:4ch minmax\(25%,1fr\) minmax\(0,max-content\);/);
    expect(css).toContain('body.wp-mini .rows>.row.mrow:first-child{padding-right:18px}');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Pet — option B, "Haste as a second bar"
// ════════════════════════════════════════════════════════════════════════════
const NOW = Date.now();
const buff = (name, over = {}) => ({ name, remaining_secs: 750, total_secs: 1500, observed_at_ms: NOW, good: 1, fell_off: false, ...over });
const PET = {
  owner: 'aldenmar', pet: 'Zarrin', hp_pct: 72, target: 'a gnoll', target_at: NOW, observed_at: NOW,
  buffs: [buff('Burnout V'), buff('Shield of Lava', { remaining_secs: 300 })],
  stats: { total_hits: 12, total_damage: 900, max_hit: 120, avg_hit: 75, skills: { hit: { count: 12, total: 900, max: 120 } }, dual_wielding: false },
};
const runPets = (opts) => runPage(petHtml, { ...opts, snapId: 'list', exportNames: ['tick', 'petMiniHtml', 'petHasteBuff'] });
const line2 = (html) => html.slice(html.indexOf('<div class="mrow mh'));

describe('Pet mini — line one: HP, name → target', () => {
  it('shows HP%, a 4px bar and name → target, and none of the full card', async () => {
    const x = runPets({ mini: true, state: { petHealth: [PET] } });
    await flush();
    const html = x.el('list').innerHTML;
    expect(html).toMatch(/^<div class="pet pmini" data-owner="aldenmar" title="Zarrin \(aldenmar\)"><div class="mrow hi">/);
    expect(html).toContain('<span class="pct wp-mini-num">72%</span>');
    expect(html).toContain('<div class="mbar wp-mini-bar"><div style="width:72%"></div></div>');
    expect(html).toContain('<span class="nm wp-mini-name">Zarrin</span><span class="arr">→</span><span class="tgt wp-mini-name">a gnoll</span>');
    for (const gone of ['class="dismiss"', 'class="petstats"', 'class="bufrows"', 'class="owner"', 'class="meta"', 'pettarget']) {
      expect(html).not.toContain(gone);
    }
  });

  it('steps HP at 50/25 and shows — for an unknown HP or no target', () => {
    const x = runPets({ state: { petHealth: [] } });
    expect(x.petMiniHtml({ ...PET, hp_pct: 50 })).toContain('<div class="mrow mid">');
    expect(x.petMiniHtml({ ...PET, hp_pct: 25 })).toContain('<div class="mrow lo">');
    expect(x.petMiniHtml({ ...PET, hp_pct: 51 })).toContain('<div class="mrow hi">');
    const unk = x.petMiniHtml({ ...PET, hp_pct: null, target: null });
    expect(unk).toContain('<div class="mrow unk"><span class="pct wp-mini-num">—</span>');
    expect(unk).toContain('<span class="tgt none">—</span>');
  });
});

describe('Pet mini — line two: the haste bar', () => {
  it('names the haste buff (the % is not on the pet row) and drains with its time left', () => {
    const x = runPets({ state: { petHealth: [] } });
    const l2 = line2(x.petMiniHtml(PET));
    expect(l2).toMatch(/^<div class="mrow mh run" title="Burnout V · 12m left">/);
    expect(l2).toContain('<span class="lab wp-mini-name">⚡ Burnout V</span>');
    expect(l2).toContain('<div style="width:50%">');         // 750 of 1500s left
    expect(l2).toContain('<span class="tl wp-mini-num">12m</span>');
    // Not the pet's other buff.
    expect(l2).not.toContain('Shield of Lava');
    // The short name the full view already uses.
    expect(line2(x.petMiniHtml({ ...PET, buffs: [buff('Speed of the Shissar')] }))).toContain('⚡ Shissar</span>');
  });

  it('goes amber at 10s left, purple once it fell off, grey when present but untimed', () => {
    const x = runPets({ state: { petHealth: [] } });
    const at = (over) => line2(x.petMiniHtml({ ...PET, buffs: [buff('Burnout V', over)] }));
    expect(at({ remaining_secs: 11 })).toMatch(/^<div class="mrow mh run"/);
    expect(at({ remaining_secs: 10 })).toMatch(/^<div class="mrow mh low"/);
    expect(at({ remaining_secs: 4 })).toContain('<span class="tl wp-mini-num">4s</span>');
    const off = at({ remaining_secs: 0, fell_off: true });
    expect(off).toMatch(/^<div class="mrow mh off" title="Burnout V · fell off \(rebuff\)">/);
    expect(off).toContain('<div style="width:100%">');
    expect(off).toContain('>rebuff</span>');
    const unk = at({ remaining_secs: null, total_secs: null });
    expect(unk).toMatch(/^<div class="mrow mh unk"/);
    expect(unk).toContain('<span class="tl wp-mini-num">?</span>');
    // The colours are the platform's: green, amber, purple.
    const css = cssOf(petHtml);
    expect(css).toContain('.pmini .mh.run{color:#56d364}');
    expect(css).toContain('.pmini .mh.low{color:#f0b429}');
    expect(css).toContain('.pmini .mh.off{color:#a371f7}');
  });

  it('keeps a dim "no haste" line when no haste buff is on the pet', () => {
    const x = runPets({ state: { petHealth: [] } });
    const l2 = line2(x.petMiniHtml({ ...PET, buffs: [buff('Shield of Lava')] }));
    expect(l2).toMatch(/^<div class="mrow mh none"[^>]*><span class="lab wp-mini-name">⚡ no haste<\/span>/);
    expect(line2(x.petMiniHtml({ ...PET, buffs: [] }))).toContain('⚡ no haste');
  });

  it('reads backtick possessives and prefers a running haste over one that fell off', () => {
    const x = runPets({ state: { petHealth: [] } });
    expect(x.petHasteBuff([buff('Arag`s Celerity')]).name).toBe('Arag`s Celerity');
    const pick = x.petHasteBuff([
      buff('Burnout IV', { remaining_secs: 0, fell_off: true }),
      buff('Burnout V', { remaining_secs: 100 }),
      buff('Augmentation of Death', { remaining_secs: null }),
    ]);
    expect(pick.name).toBe('Burnout V');
    // Running-but-untimed (from /pet health) still beats one that fell off.
    expect(x.petHasteBuff([
      buff('Burnout IV', { remaining_secs: 0, fell_off: true }),
      buff('Augmentation of Death', { remaining_secs: null }),
    ]).name).toBe('Augmentation of Death');
    expect(x.petHasteBuff([buff('Shield of Lava'), buff('Burnout V', { fell_off: true, remaining_secs: 0 })]).name).toBe('Burnout V');
    expect(x.petHasteBuff([buff('Shield of Lava')])).toBe(null);
  });
});

describe('Pet mini — full mode and the flip', () => {
  it('leaves full mode as it was', async () => {
    const x = runPets({ state: { petHealth: [PET] } });
    await flush();
    const html = x.el('list').innerHTML;
    expect(html).not.toContain('pmini');
    for (const kept of ['<div class="pet" data-owner="aldenmar">', 'class="dismiss"', 'class="bufrows"', 'class="petstats"', 'class="pettarget"']) {
      expect(html).toContain(kept);
    }
  });

  it('re-ticks and refits on a flip, the fit after the mini rows land', async () => {
    const x = runPets({ state: { petHealth: [PET] } });
    await flush();
    expect(x.el('list').innerHTML).not.toContain('pmini');
    x.flip(true);
    await flush();
    expect(x.el('list').innerHTML).toContain('class="pet pmini"');
    expect(x.fits.at(-1)).toContain('class="pet pmini"');
    x.flip(false);
    await flush();
    expect(x.fits.at(-1)).toContain('<div class="pet" data-owner="aldenmar">');
  });

  it('refits on a flip even with no pet, when only the hidden title moved the height', async () => {
    const x = runPets({ state: { petHealth: [] } });
    await flush();
    const before = x.fits.length;
    x.flip(true);
    await flush();
    expect(x.fits.length).toBe(before + 1);
  });

  it('hides the title in mini and keeps the first pet’s target out from under the ✕', () => {
    expect(markupOf(petHtml)).toContain('<div class="title wp-mini-hide">');
    expect(cssOf(petHtml)).toContain('body.wp-mini #list>.pmini:first-child .mrow:first-child{padding-right:16px}');
  });
});
