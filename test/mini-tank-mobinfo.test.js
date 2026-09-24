// test/mini-tank-mobinfo.test.js — the per-overlay half of mini mode for the
// Tank overlay and Target Info (the guild lead, 2026-09-24: "Currently mini
// mode doesn't do anything" — preload toggled body.wp-mini and no overlay had
// a single rule for it).
//
// The renditions are the guild vote's winners (closed 2026-09-17, the specs in
// web/lib/miniReview.ts):
//   • Tank A "One strip" — tank HP bar, "tank ← mob", the damage-shield-per-hit
//     spiky box; a rampage row only while rampage has a target.
//   • Target Info B "Two rows, draining timers" — mob HP bar + name, then a
//     SLOW row whose amber bar drains with the time left.
//
// ⚠ Behaviour, not text. Each test boots the overlay's REAL <script> against a
// minimal fake DOM, feeds it an agent payload through its own poll, and reads
// what it painted — in full mode, in mini, and across a flip. A comment can
// satisfy a toContain over the source; it cannot paint a row. Names are the
// invented fixture set (none of them is anybody).
//
// Run: npx vitest run test/mini-tank-mobinfo.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripCss } from './_source-slice.js';

const TANK = readSource(path.join(ROOT, 'apps', 'mimic', 'tank.html'));
const MOB  = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));

const flush = () => new Promise((r) => setTimeout(r, 0));
const count = (s, needle) => s.split(needle).length - 1;

function classSet(set) {
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, on) => { const want = on === undefined ? !set.has(c) : !!on; if (want) set.add(c); else set.delete(c); return want; },
  };
}

// Boot one overlay. `contentId` is the element the overlay paints into (the
// fake #wrap's scrollHeight is derived from it, so a refit after a flip reads
// the NEW content's height — the property the flip has to get right).
async function boot(html, contentId, payload, { mini = false } = {}) {
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const log = [];
  const els = new Map();
  const bodyClasses = new Set(mini ? ['wp-mini'] : []);
  const winListeners = {};
  const intervals = [];
  function el(id) {
    if (!els.has(id)) {
      let inner = '';
      els.set(id, {
        id, style: {}, textContent: '', className: '', classList: classSet(new Set()),
        addEventListener() {}, getAttribute() { return null; },
        get innerHTML() { return inner; },
        set innerHTML(v) { inner = String(v); log.push({ paint: id, html: inner }); },
        get scrollHeight() { return id === 'wrap' ? 20 + (els.has(contentId) ? els.get(contentId).innerHTML.length : 0) : 0; },
      });
    }
    return els.get(id);
  }
  const document = {
    getElementById: el,
    body: { classList: classSet(bodyClasses) },
    documentElement: { style: { setProperty() {} } },
    addEventListener() {},
  };
  const window = {
    mimic: {
      overlayAutoHeight: (h) => log.push({ fit: h }),
      overlayHoverInteractive() {}, attachOverlayMenu() {}, openExternal() {},
    },
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    localStorage: { getItem: () => null, setItem() {} },
  };
  let current = payload;
  const fetch = async () => ({ json: async () => current });
  const setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  new Function('window', 'document', 'fetch', 'setInterval', script)(window, document, fetch, setInterval);
  await flush();
  return {
    log,
    content: () => el(contentId).innerHTML,
    // The overlay's own 500ms poll, run once.
    async poll(next) { if (next !== undefined) current = next; intervals.find((i) => i.ms === 500).fn(); await flush(); },
    // What preload's _wpApplyMini does: toggle the class, fire wp-mini-change.
    flip(on) {
      if (on) bodyClasses.add('wp-mini'); else bodyClasses.delete('wp-mini');
      for (const fn of winListeners['wp-mini-change'] || []) fn();
    },
  };
}

// The last paint of `id` and whether a refit came AFTER it.
function lastPaintThenFit(log, id) {
  let p = -1;
  log.forEach((e, i) => { if (e.paint === id) p = i; });
  const fit = log.slice(p + 1).find((e) => e.fit != null);
  return { html: p < 0 ? null : log[p].html, fit: fit ? fit.fit : null };
}

// ── Tank ────────────────────────────────────────────────────────────────────
const tankState = (over = {}) => ({
  character: 'Aldenmar', hp_pct: 90, hp_cur: null, hp_max: null,
  target: { name: 'a gnoll warlord', hp_pct: 64 },
  buffs: [],
  mt: {
    name: 'Brackwyn', is_self: false, hp_pct: 71.6, buff_source: 'mimic',
    buffs: [{ name: 'Shield of Blades', seconds: 300 }, { name: 'Barrier of Combustion', seconds: 200 }],
    // Observed reflects this fight: 4,420 over 130 hits (~34/hit) — the numbers
    // the box must NOT show. The per-hit is the catalog sum of what is up.
    ds: {
      total: 4420, hits: 130, avg_per_hit: 34,
      abilities: [{ name: 'hit', total: 4420, count: 130, avg: 34 }],
      sources: [{ name: 'Shield of Blades', per_hit: 65 }, { name: 'Barrier of Combustion', per_hit: 20 }],
    },
  },
  inbound_heals: [],
  da: null,
  ds: { total: 0, hits: 0, avg_per_hit: 0, abilities: [], sources: [] },
  rampage: null,
  enrage: { enrages: true, warn_pct: 70, threshold_pct: 15 },
  deathtouch: null, ch_chain: null,
  off_heal_candidates: [{ name: 'Nyssara', hp_pct: 40, mob: 'a gnoll guard' }],
  ...over,
});
const ramp = (over = {}) => ({ target: 'Corvale', hp_pct: 41.6, hp_cur: null, hp_max: null, da: null, inbound_heals: [], ...over });

describe('Tank mini — "One strip"', () => {
  it('full mode is still today\'s overlay: the cards, and no strip', async () => {
    const o = await boot(TANK, 'content', tankState());
    const h = o.content();
    expect(h).toContain('Main Tank — Brackwyn');
    expect(h).toContain('Damage shield');
    expect(h).toContain('Enrage near');
    expect(h).toContain('Off-heal');
    expect(h).not.toContain('mini-row');
  });

  it('mini is one row: HP% first, the tank\'s bar, "tank ← mob", then the DS box', async () => {
    const h = (await boot(TANK, 'content', tankState(), { mini: true })).content();
    expect(count(h, 'class="mini-row')).toBe(1);
    expect(count(h, 'class="mini-bar')).toBe(1);   // the mob is named, not barred
    expect(h).toMatch(/^<div class="mini"><div class="mini-row [^"]*"><span class="mini-pct[^"]*">72%<\/span><span class="mini-bar[^"]*"><i style="width:72%">/);
    const at = (s) => h.indexOf(s);
    expect(at('>Brackwyn<')).toBeGreaterThan(at('mini-bar'));
    expect(at('←')).toBeGreaterThan(at('>Brackwyn<'));
    expect(at('>a gnoll warlord<')).toBeGreaterThan(at('←'));
    expect(at('85/hit')).toBeGreaterThan(at('>a gnoll warlord<'));
  });

  it('mini drops everything the vote left out', async () => {
    const h = (await boot(TANK, 'content', tankState(), { mini: true })).content();
    for (const gone of ['Enrage', 'Damage shield', 'ds-total', 'Buffs', 'Off-heal', 'Nyssara', 'Main Tank', 'inbound-heals']) {
      expect(h).not.toContain(gone);
    }
  });

  it('the box is what ONE hit returns — the sum of the DS buffs, not the running total or the average', async () => {
    const h = (await boot(TANK, 'content', tankState(), { mini: true })).content();
    expect(h).toContain('>85/hit<');
    expect(h).not.toContain('34/hit');
    expect(h).not.toContain('4.4k');
    expect(h).not.toMatch(/mini-ds[^"]*\boff\b/);
  });

  it('the box dims when no damage shield is up', async () => {
    const s = tankState();
    s.mt.ds.sources = [];
    const h = (await boot(TANK, 'content', s, { mini: true })).content();
    expect(h).toMatch(/<span class="mini-ds wp-mini-num off"[^>]*>no DS<\/span>/);
  });

  it('with no MT resolved it is the local character, with their own DS', async () => {
    const s = tankState({ mt: null, hp_pct: 33.2, ds: { total: 0, hits: 0, avg_per_hit: 0, abilities: [], sources: [{ name: 'Shield of Blades', per_hit: 65 }] } });
    const h = (await boot(TANK, 'content', s, { mini: true })).content();
    expect(h).toContain('>Aldenmar<');
    expect(h).toContain('>33%<');
    expect(h).toContain('mini-row low');
    expect(h).toContain('>65/hit<');
  });

  it('the rampage row appears only while rampage has a target', async () => {
    const none = (await boot(TANK, 'content', tankState(), { mini: true })).content();
    expect(none).not.toContain('mini-ramp');
    const h = (await boot(TANK, 'content', tankState({ rampage: ramp() }), { mini: true })).content();
    expect(count(h, 'class="mini-row')).toBe(2);
    expect(h).toMatch(/<div class="mini-ramp"><div class="mini-row low"><span class="mini-pct[^"]*">42%<\/span>/);
    expect(h).toContain('💀 Corvale');
    expect(h).not.toContain('DA');
    expect(h).not.toContain('CH!');
  });

  it('the rampage row counts down Divine Aura, and calls CH! on the overlay\'s own start-CH cue', async () => {
    const up = (await boot(TANK, 'content', tankState({ rampage: ramp({ da: { name: 'Divine Aura', seconds: 14, critical: false } }) }), { mini: true })).content();
    expect(up).toContain('>DA 14s<');
    expect(up).not.toContain('CH!');
    // ≤5s: the full overlay turns the ramp bar green, "get ready to heal".
    const soon = (await boot(TANK, 'content', tankState({ rampage: ramp({ da: { name: 'Divine Aura', seconds: 4, critical: true } }) }), { mini: true })).content();
    expect(soon).toContain('>DA 4s<');
    expect(soon).toContain('>CH!<');
  });

  it('the DA card\'s "start CH on <name>" lights CH! only on that person\'s row', async () => {
    const mine = { name: 'Divine Aura', seconds: 9, critical: true, ramp_target: 'Corvale' };
    const on = (await boot(TANK, 'content', tankState({ da: mine, rampage: ramp() }), { mini: true })).content();
    expect(on).toContain('>CH!<');
    const other = (await boot(TANK, 'content', tankState({ da: { ...mine, ramp_target: 'Zarrin' }, rampage: ramp() }), { mini: true })).content();
    expect(other).not.toContain('CH!');
  });

  it('a flip re-renders at once and refits AFTER the new rendition, both ways', async () => {
    const o = await boot(TANK, 'content', tankState());
    const full = lastPaintThenFit(o.log, 'content');
    expect(full.fit).not.toBeNull();
    o.flip(true);
    const mini = lastPaintThenFit(o.log, 'content');
    expect(mini.html).toContain('mini-row');
    expect(mini.fit).not.toBeNull();
    expect(mini.fit).toBeLessThan(full.fit);
    o.flip(false);
    const back = lastPaintThenFit(o.log, 'content');
    expect(back.html).toContain('Main Tank — Brackwyn');
    expect(back.fit).toBe(full.fit);
  });

  it('a flip refits even when nothing repaints (no character yet — only the title bar changed)', async () => {
    const o = await boot(TANK, 'content', { character: null });
    const before = o.log.length;
    o.flip(true);
    expect(o.log.slice(before).some((e) => e.fit != null)).toBe(true);
  });

  it('mini keeps the byte-stability guard: an unchanged poll paints nothing', async () => {
    const o = await boot(TANK, 'content', tankState(), { mini: true });
    const paints = o.log.filter((e) => e.paint === 'content').length;
    await o.poll();
    expect(o.log.filter((e) => e.paint === 'content').length).toBe(paints);
  });

  it('a character that drops and comes back unchanged is repainted, not left on "No focused character"', async () => {
    const o = await boot(TANK, 'content', tankState(), { mini: true });
    await o.poll({ character: null });
    expect(o.content()).toContain('No focused character');
    await o.poll(tankState());
    expect(o.content()).toContain('mini-row');
  });

  it('the title bar hides in mini', () => {
    expect(stripCss(TANK)).toMatch(/<div class="title wp-mini-hide">/);
  });
});

// ── Target Info ─────────────────────────────────────────────────────────────
const mobInfo = (over = {}) => ({
  target_name: 'a gnoll warlord', target_hp_pct: 64.2, loading: false,
  mob: {
    id: 4051, name: 'a gnoll warlord', level: 30, class: 'Shadow Knight', hp: 9000, ac: 120,
    resists: { mr: 30, fr: 30, cr: 30, pr: 30, dr: 30 }, specials: ['Enrage'], loot: [],
  },
  target_buffs: [{ name: 'Tashania', remaining_secs: 100, total_secs: 200, good: 0 }],
  target_casting: [],
  target_slow: { name: "Turgur's Insects", ambiguous: false, magnitude: 75, caster: 'Nyssara', cls: 'SHM', remaining_secs: 161, total_secs: 180 },
  target_mana: null, target_lastcast: null, target_player: null, target_npc_ht: null,
  ...over,
});
const mobState = (over) => ({ mobInfo: mobInfo(over) });

describe('Target Info mini — "Two rows, draining timers"', () => {
  it('full mode is still today\'s overlay: header, slow badge, resists, debuffs', async () => {
    const h = (await boot(MOB, 'body', mobState())).content();
    expect(h).toContain('class="slowbadge');
    expect(h).toContain('class="res"');
    expect(h).toContain('debuffs (observed)');
    expect(h).not.toContain('mini-row');
  });

  it('row one is the mob\'s HP bar with its name', async () => {
    const h = (await boot(MOB, 'body', mobState(), { mini: true })).content();
    expect(h).toMatch(/^<div class="mini"><div class="mini-row hi"><span class="mini-pct[^"]*">64%<\/span><span class="mini-bar[^"]*"><i style="width:64%"><\/i><\/span><span class="mini-nm wp-mini-name">a gnoll warlord<\/span>/);
  });

  it('then a SLOW row whose amber bar drains with the time left, digits as m:ss', async () => {
    const h = (await boot(MOB, 'body', mobState(), { mini: true })).content();
    expect(count(h, 'class="mini-row')).toBe(2);
    // 161 of 180 seconds left → 89% of the bar.
    expect(h).toMatch(/<div class="mini-row slow"[^>]*><span class="mini-lab[^"]*">SLOW<\/span><span class="mini-bar[^"]*"><i style="width:89%"><\/i><\/span><span class="mini-t[^"]*">2:41<\/span>/);
    const later = (await boot(MOB, 'body', mobState({ target_slow: { ...mobInfo().target_slow, remaining_secs: 45 } }), { mini: true })).content();
    expect(later).toMatch(/<i style="width:25%"><\/i><\/span><span class="mini-t[^"]*">0:45</);
  });

  it('the SLOW row is absent, not empty, while no slow is landed', async () => {
    const h = (await boot(MOB, 'body', mobState({ target_slow: null }), { mini: true })).content();
    expect(count(h, 'class="mini-row')).toBe(1);
    expect(h).not.toContain('SLOW');
  });

  it('mini drops the header, resists, mana, casting and the buff lists', async () => {
    const h = (await boot(MOB, 'body', mobState({ target_mana: { cur: 500, max: 1000, pct: 50, spent: 500, drained: 0 } }), { mini: true })).content();
    for (const gone of ['slowbadge', 'class="res"', 'debuffs', 'Tashania', 'manabar', 'PQDI', 'Shadow Knight', 'Enrage']) {
      expect(h).not.toContain(gone);
    }
  });

  it('a Shadow Knight mob keeps its HT chip beside the name', async () => {
    const h = (await boot(MOB, 'body', mobState({ target_npc_ht: { ready: false, ready_in_ms: 38 * 60_000 + 5000 } }), { mini: true })).content();
    expect(h).toMatch(/a gnoll warlord<\/span> <span class="ht used"[^>]*>HT ✗ 38:05<\/span><\/div>/);
  });

  it('escapes the mob name', async () => {
    const h = (await boot(MOB, 'body', mobState({ target_name: '<img src=x>', mob: null }), { mini: true })).content();
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img src=x&gt;');
  });

  it('a flip re-renders at once and refits AFTER the new rendition, both ways', async () => {
    const o = await boot(MOB, 'body', mobState());
    const full = lastPaintThenFit(o.log, 'body');
    expect(full.fit).not.toBeNull();
    o.flip(true);
    const mini = lastPaintThenFit(o.log, 'body');
    expect(mini.html).toContain('mini-row slow');
    expect(mini.fit).not.toBeNull();
    expect(mini.fit).toBeLessThan(full.fit);
    o.flip(false);
    const back = lastPaintThenFit(o.log, 'body');
    expect(back.html).toContain('class="res"');
    expect(back.fit).toBe(full.fit);
  });

  it('a poll in mini refits when a timer row comes or goes', async () => {
    const o = await boot(MOB, 'body', mobState({ target_slow: null }), { mini: true });
    const one = lastPaintThenFit(o.log, 'body');
    await o.poll(mobState());
    const two = lastPaintThenFit(o.log, 'body');
    expect(two.html).toContain('mini-row slow');
    expect(two.fit).toBeGreaterThan(one.fit);
  });

  it('a flip with no target still refits (that path returns before the render\'s own fit)', async () => {
    const o = await boot(MOB, 'body', { mobInfo: null });
    const before = o.log.length;
    o.flip(true);
    expect(o.log.slice(before).some((e) => e.fit != null)).toBe(true);
  });

  it('the title bar — and with it the tabs — hides in mini', () => {
    expect(MOB).toMatch(/<div class="title wp-mini-hide">\s*<span id="conn"/);
    expect(MOB).toMatch(/<div class="title wp-mini-hide">[\s\S]*?<span class="tabs">[\s\S]*?<\/div>/);
  });
});
