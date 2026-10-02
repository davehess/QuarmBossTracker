// test/overlays-tab-option-c.test.js — the agent dashboard's Overlays tab, rebuilt as option C.
//
// The guild lead, 2026-09-29: "Show me a few mockups for a new overlays tab that can build these
// overlays faster, right now it's just a wall of text and toggles, then mismatched keybinds." Then:
// "Go with C" — your layouts on top, a way into the on-screen builder, what is on screen beside an Add
// drawer of cards, one strip of keys in one keycap format, one strip of looks. And: "change the name
// of the Timer Canvas to Canvas".
//
// Runs the REAL render, painter and helpers out of dashboard.html against small fakes, so a comment
// cannot satisfy any of it.
//
// Run: npx vitest run test/overlays-tab-option-c.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

const ROWS    = sliceBlock(html, 'var WP_OVERLAY_ROWS = [', '\n];\n');
const BLURB   = sliceBlock(html, 'var WP_OVERLAY_BLURB = {', '\n};\n');
const MINI    = sliceBlock(html, 'var WP_MINI_KEY_OF = {', '};\n');
const ESC     = sliceBlock(html, 'function esc(s) {', ' }\n');
const KEEP    = 'var _wpOpenDetails = {};\n' + sliceBlock(html, 'function wpKeep(key, defaultOpen) {', '\n}\n');
const MORPH   = sliceBlock(html, 'function morphInto(el, html) {', '\n}\n');
const RENDER  = sliceBlock(html, 'function renderOverlays(s) {', '\n}\n');
const TILES   = sliceBlock(html, 'var _WP_CP_FLASH_MS = 2500;', "'saves which overlays are on now')) + '</span></button>';\n  return h;\n}\n");
const PAINT   = sliceBlock(html, 'function wpRefreshOverlayToggles() {', '\n}\n');
const FLAG_OF = sliceBlock(PAINT, 'var flagOf = {', '};');
const FMT     = sliceBlock(html, 'function _wpFmtAccel(a) {', '}\n');
const USES    = sliceBlock(html, 'var _WP_HOTKEY_USES = {', "return mods.sort().join('+') + '+' + key;\n}\n");
const WIRE    = sliceBlock(html, 'var _wpGlobalKeys = {};', '\n}\n');
const WIRED   = sliceBlock(html, "  _wpWireHotkeyRow('wpHideHotkey'", "'CommandOrControl+Shift+M');");
const KEYS    = sliceBlock(html, 'function _wpHotkeyUsesOf(cfg) {', "keys.join(', ');\n}\n");

const rowKeys = new Function(ROWS + '\nreturn WP_OVERLAY_ROWS;')().map(r => r[0]);

// renderOverlays with the section write captured and every post-render painter stubbed.
function render(s) {
  let out = null;
  const fn = new Function('window', 'setSectionHTML', 'wpRefreshOverlayToggles', 'wpRefreshOverlayHotkeys',
    'wpWireHideHotkey', 'wpWireExtPref', 'wpWireBqPref',
    ROWS + BLURB + MINI + ESC + KEEP + RENDER + '\nreturn renderOverlays;')(
    { mimic: { openDashboard() {} } }, (id, h) => { out = h; }, () => {}, () => {}, () => {}, () => {}, () => {});
  fn(s);
  return out;
}
const count = (s, needle) => s.split(needle).length - 1;

describe('the render: every overlay once in the list and once in Add, each with its key', () => {
  const h = render({});

  it('each WP_OVERLAY_ROWS key has exactly one row and one Add card, both hidden until painted', () => {
    expect(rowKeys).toHaveLength(18);
    for (const k of rowKeys) {
      expect(count(h, 'data-ovrow="' + k + '"'), k).toBe(1);
      expect(count(h, 'data-ovadd="' + k + '"'), k).toBe(1);
      expect(h).toContain('<div class="wp-ovli" data-ovrow="' + k + '" hidden>');
      expect(h).toContain('<div class="wp-ovcard" data-ovadd="' + k + '" hidden>');
    }
  });

  it('every row and every card carries its keycap; every row can be turned off, every card turned on', () => {
    for (const k of rowKeys) {
      const at = h.indexOf('data-ovrow="' + k + '"');
      const row = h.slice(at, h.indexOf('</div>', at));
      expect(row, k).toContain('<button type="button" class="wp-ov-hk wp-key" data-ov="' + k + '">…</button>');
      expect(row, k).toContain('<button type="button" class="wp-ov-toggle" data-ov="' + k + '">✕</button>');
      const ca = h.indexOf('data-ovadd="' + k + '"');
      const card = h.slice(ca, h.indexOf('</div>', ca));
      expect(card, k).toContain('class="wp-ov-add" data-ov="' + k + '"');
      expect(card, k).toContain('<button type="button" class="wp-ov-hk wp-key" data-ov="' + k + '">…</button>');
    }
  });

  it('the list keeps the Dock and trigger alerts first', () => {
    const order = [...h.matchAll(/data-ovrow="(\w+)"/g)].map(m => m[1]);
    expect(order.slice(0, 2)).toEqual(['dock', 'trigger']);
    expect([...h.matchAll(/data-ovadd="(\w+)"/g)].map(m => m[1])).toEqual(order);
  });

  it('every overlay has a one-liner, and it is one line', () => {
    const blurb = new Function(BLURB + '\nreturn WP_OVERLAY_BLURB;')();
    expect(Object.keys(blurb).sort()).toEqual(rowKeys.slice().sort());
    for (const k of rowKeys) expect(blurb[k].length, k).toBeLessThanOrEqual(56);
  });

  it('says "Canvas", not "Timers canvas"', () => {
    expect(h).not.toMatch(/Timers canvas/i);
    expect(h).toContain('<b>Canvas</b>');
  });

  it('never reads the agent state: two different states render byte-identical (no repaint per poll)', () => {
    const other = render({ activeCharacter: 'Brackwyn', overlayTheme: 'light', charProfilesEnabled: true,
      charProfiles: [{ name: 'brackwyn', shown: 3 }] });
    expect(other).toBe(h);
  });

  it('keeps every placement and all-overlay action the old tab had (tray parity)', () => {
    for (const a of ['canvasArrange', 'setup', 'lock', 'arrange', 'rescue', 'hideall', 'miniall', 'backdrops']) {
      expect(h, a).toContain('data-act="' + a + '"');
    }
    for (const id of ['wpCharProfEn', 'wpOvLays', 'wpHideAllBanner', 'wpOvHkHint', 'wpOvClash', 'wpDmgAlertBtn',
      'wpAllOpacity', 'wpAllBgAlpha', 'wpAllScale', 'wpScaleGlide', 'wpScaleDock', 'wpOvLockBtn', 'wpOvHideAllBtn', 'wpOvMiniAllBtn']) {
      expect(count(h, 'id="' + id + '"'), id).toBe(1);
    }
    // The four all-overlay keys: a keycap, Change… and Disable each, wired to the same config keys.
    for (const p of ['wpHideHotkey', 'wpBdHotkey', 'wpMiniHotkey', 'wpDmgHotkey']) {
      for (const s of ['Cur', 'Btn', 'En', 'Hint']) expect(count(h, 'id="' + p + s + '"'), p + s).toBe(1);
      expect(h).toContain('<code id="' + p + 'Cur" class="wp-key">');
      expect(WIRED).toContain("_wpWireHotkeyRow('" + p + "'");
    }
    // Every theme, colour-blind ones under More….
    for (const t of ['default', 'light', 'bright', 'soft', 'contrast', 'deutan', 'protan', 'tritan']) {
      expect(h, t).toContain('data-th="' + t + '"');
    }
    expect(h).toMatch(/<details data-keep="ov-look-more" class="wp-more"><summary>More…<\/summary>/);
  });

  it('an Add card and a row\'s ✕ run the same toggle as ever', () => {
    const d = stripJs(html);
    expect(d).toMatch(/closest\('\.wp-ov-toggle'\) : null;\s*if \(b\) \{ var name = b\.getAttribute\('data-ov'\); if \(name\) wpToggleOverlay\(name\); return; \}/);
    expect(d).toMatch(/closest\('\.wp-ov-add'\)[\s\S]{0,250}?if \(an\) wpToggleOverlay\(an\);/);
  });
});

// ── The painter, against a fake DOM ─────────────────────────────────────────
function fakeEl(extra) {
  return Object.assign({ hidden: true, textContent: '', className: '', title: '', style: {}, disabled: false,
    innerHTML: '', checked: false, kids: {}, attrs: {},
    querySelector(sel) { return this.kids[sel] || null; },
    getAttribute(n) { return this.attrs[n]; } }, extra);
}
function fakeDom() {
  const rows = {}, cards = {}, byId = {};
  for (const k of rowKeys) {
    rows[k] = fakeEl({ kids: { '.wp-ovdot': fakeEl(), '.wp-ovst': fakeEl(), '.wp-ov-toggle': fakeEl() } });
    cards[k] = fakeEl();
  }
  const docks = rowKeys.filter(k => !['trigger', 'dock', 'me', 'canvas'].includes(k))
    .map(k => fakeEl({ attrs: { 'data-ov': k } }));
  for (const id of ['wpOvNone', 'wpOvAllOn', 'wpOvLockBtn', 'wpOvHideAllBtn', 'wpOvArrangeBtn', 'wpOvMiniAllBtn',
    'wpHideAllBanner', 'wpOvLays', 'wpCharProfEn']) byId[id] = fakeEl();
  const document = {
    getElementById: (id) => byId[id] || null,
    querySelector(sel) {
      let m = sel.match(/^\.wp-ovcard\[data-ovadd="(\w+)"\]$/); if (m) return cards[m[1]] || null;
      m = sel.match(/^\.wp-ovli\[data-ovrow="(\w+)"\]$/); if (m) return rows[m[1]] || null;
      m = sel.match(/^\.wp-ov-toggle\[data-ov="(\w+)"\]$/); if (m) return rows[m[1]] ? rows[m[1]].kids['.wp-ov-toggle'] : null;
      return null;
    },
    querySelectorAll: (sel) => (sel === '.wp-ov-dock' ? docks : []),
  };
  return { rows, cards, byId, docks, document };
}
async function paint(st, cfg) {
  const dom = fakeDom();
  const window = { mimic: { getStatus: () => Promise.resolve(st), getConfig: () => Promise.resolve(cfg || {}) } };
  const fn = new Function('window', 'document', ROWS + ESC + MORPH + TILES + PAINT + '\nreturn wpRefreshOverlayToggles;')(window, dom.document);
  fn();
  await new Promise(r => setTimeout(r, 0));
  return dom;
}
const allOff = () => ({ showDock: false, showHud: false, enableTriggerTts: false, showCharm: false, showPets: false,
  showMobInfo: false, showBuffQueue: false, showWho: false, showMelody: false, showZeal: false, showThreat: false,
  showChChain: false, showTank: false, showExtTarget: false, showCommand: false, showPopRaid: false, showMe: false, showCanvas: false });

describe('the painter: exactly one of row / card shows, by state', () => {
  it('ON, HIDDEN (parked by hide-all) and DOCKED are listed; OFF is an Add card', async () => {
    const st = Object.assign(allOff(), { showHud: true, enableTriggerTts: true,
      hideAllActive: true, hideAllPrev: { showMobInfo: true }, dockedOverlays: ['tank'] });
    const dom = await paint(st);
    const listed = rowKeys.filter(k => !dom.rows[k].hidden);
    expect(listed.sort()).toEqual(['hud', 'mobinfo', 'tank', 'trigger']);
    for (const k of rowKeys) expect(dom.cards[k].hidden, k).toBe(!dom.rows[k].hidden);
    expect(dom.rows.mobinfo.kids['.wp-ovst'].textContent).toBe('HIDDEN by hide-all');
    expect(dom.rows.mobinfo.kids['.wp-ov-toggle'].textContent).toBe('show');   // the toggle brings it back
    expect(dom.rows.hud.kids['.wp-ov-toggle'].textContent).toBe('✕');
    expect(dom.rows.tank.kids['.wp-ovst'].textContent).toBe('in the Dock');
    expect(dom.rows.tank.kids['.wp-ov-toggle'].disabled).toBe(true);            // the Dock owns it
    expect(dom.byId.wpOvNone.hidden).toBe(true);
    expect(dom.byId.wpOvAllOn.hidden).toBe(true);
  });

  it('the hide-all line: one line with a count and Show them, gone once released', async () => {
    const on = await paint(Object.assign(allOff(), { hideAllActive: true, hideAllPrev: { showHud: true, showMe: true } }));
    expect(on.byId.wpHideAllBanner.innerHTML).toMatch(/Hide-all is on<\/b> &middot; 2 overlays parked/);
    expect(on.byId.wpHideAllBanner.innerHTML).toContain('data-act="hideall">Show them</button>');
    const off = await paint(allOff());
    expect(off.byId.wpHideAllBanner.innerHTML).toBe('');
  });

  it('nothing on: the list says so and every card shows', async () => {
    const dom = await paint(allOff());
    expect(dom.byId.wpOvNone.hidden).toBe(false);
    for (const k of rowKeys) expect(dom.cards[k].hidden, k).toBe(false);
  });

  it('paints the saved layouts, the auto-switch, and Arrange ↔ Done from Mimic status', async () => {
    const dom = await paint(Object.assign(allOff(), { canvasArrange: true, charProfilesEnabled: true,
      activeCharacter: 'Aldenmar', charProfiles: [{ name: 'aldenmar', shown: 1 }] }),
    { charProfiles: { aldenmar: { show: { showHud: true } } } });
    expect(dom.byId.wpOvLays.innerHTML).toContain('<b>Aldenmar</b><span class="wp-st on">active</span>');
    expect(dom.byId.wpCharProfEn.checked).toBe(true);
    expect(dom.byId.wpOvArrangeBtn.textContent).toBe('✓ Done arranging');
  });
});

// ── Your layouts ────────────────────────────────────────────────────────────
function tiles(st, cfg, now) {
  return new Function('Date', ROWS + ESC + TILES + FLAG_OF + '\nreturn _wpOvLaysHtml(' + JSON.stringify(st) + ', ' + JSON.stringify(cfg) + ', flagOf);')(
    Object.assign(function (x) { return new globalThis.Date(x); }, { now: () => now || 1e12 }));
}

describe('Your layouts: one tile per saved layout, from real data', () => {
  const st = { activeCharacter: 'Brackwyn', charProfiles: [
    { name: 'aldenmar', shown: 2, savedAt: Date.UTC(2026, 8, 20, 12) }, { name: 'brackwyn', shown: 1, savedAt: Date.UTC(2026, 8, 28, 12) }] };
  const cfg = { charProfiles: { aldenmar: { show: { showMobInfo: true, showHud: true, showCharm: false } }, brackwyn: { show: { showChChain: true } } } };
  const h = tiles(st, cfg);

  it('the active character first and marked; each names the overlays it turns on; each can be forgotten', () => {
    expect(h.indexOf('<b>Brackwyn</b>')).toBeLessThan(h.indexOf('<b>Aldenmar</b>'));
    expect(count(h, 'class="wp-st on">active</span>')).toBe(1);
    expect(h).toContain('<b>Brackwyn</b><span class="wp-st on">active</span>');
    expect(h).toContain('<span class="wp-layovs">DPS/Tank Meter · Target Info</span>');
    expect(h).toContain('<span class="wp-layovs">CH chain</span>');
    expect(h).toContain('class="wp-charprof-del" data-char="aldenmar"');
    expect(h).toContain('class="wp-charprof-del" data-char="brackwyn"');
  });

  it('draws no sketch — a saved layout carries no positions, so none is invented', () => {
    expect(h).not.toMatch(/(left|top|width|height):\s*\d/);
  });

  it('the save tile is the same save, for the active character', () => {
    expect(h).toContain('id="wpCharProfSave" data-char="Brackwyn" style="color:#7ee787"><span class="wp-laysave">💾 Save current layout for Brackwyn</span>');
    expect(h).toContain('class="wp-lay new wp-charprof-save"');
    expect(h).toContain('replaces Brackwyn’s saved one');
    const none = tiles({ charProfiles: [] }, {});
    expect(none).toMatch(/data-char="" disabled/);
    expect(none).toContain('no active character yet');
  });

  it('escapes what it is handed', () => {
    const x = tiles({ charProfiles: [{ name: '<img src=x>', shown: 0 }] }, {});
    expect(x).not.toContain('<img');
  });
});

// ── One key format ──────────────────────────────────────────────────────────
function keys() {
  return new Function('document', 'window',
    ROWS + FMT + USES + WIRE + WIRED + '\n' + KEYS
    + '\nreturn { _wpHotkeyUsesOf, _wpKeyClashes, _wpKeycap, _wpClashSummary };')(
    { getElementById: () => null }, {});
}

describe('keys: one keycap, dashed when none, red on a clash', () => {
  const K = keys();

  it('the four all-overlay keys are registered by their own wiring, with their defaults', () => {
    expect(K._wpHotkeyUsesOf({}).map(u => u.id + '=' + u.accel)).toEqual([
      'hideAllHotkey=CommandOrControl+Shift+H', 'backdropHotkey=CommandOrControl+Shift+B',
      'damageAlertHotkey=CommandOrControl+Shift+D', 'miniHotkey=CommandOrControl+Shift+M']);
  });

  it('no key is a dashed "+ key"; a key is a keycap', () => {
    expect(K._wpKeycap('', null)).toMatchObject({ text: '+ key', cls: 'wp-key empty' });
    expect(K._wpKeycap('CommandOrControl+Shift+O', null, 'x')).toEqual({ text: 'Ctrl+Shift+O', cls: 'wp-key', title: 'x' });
  });

  it('two controls on one key — however it is written — are both red, and each names the other', () => {
    const cfg = { overlayHotkeys: { me: 'Shift+Control+H', hud: 'CommandOrControl+Shift+O', mobinfo: 'Alt+1', command: 'alt+1' } };
    const c = K._wpKeyClashes(K._wpHotkeyUsesOf(cfg), {});
    expect(Object.keys(c).sort()).toEqual(['hideAllHotkey', 'overlay:command', 'overlay:me', 'overlay:mobinfo']);
    const me = K._wpKeycap(cfg.overlayHotkeys.me, c['overlay:me']);
    expect(me.cls).toBe('wp-key clash');
    expect(me.title).toMatch(/is also the Show \/ hide ALL key — only one of them can work/);
    expect(K._wpKeycap('CommandOrControl+Shift+H', c.hideAllHotkey).title).toMatch(/is also the HUD overlay’s key/);
    expect(K._wpClashSummary(c)).toBe('2 clashes: Ctrl+Shift+H, Alt+1');
    expect(K._wpClashSummary({})).toBe('');
  });

  it('a disabled all-overlay key clashes with nothing', () => {
    const c = K._wpKeyClashes(K._wpHotkeyUsesOf({ backdropHotkeyEnabled: false, overlayHotkeys: { hud: 'CommandOrControl+Shift+B' } }), {});
    expect(c).toEqual({});
  });

  it('a key the OS refused (another program holds it) is red too, and says so', () => {
    const c = K._wpKeyClashes(K._wpHotkeyUsesOf({ overlayHotkeys: { hud: 'CommandOrControl+Alt+T' } }),
      { overlayHotkeysBlocked: { hud: 'CommandOrControl+Alt+T' }, hotkeysBlocked: { miniHotkey: 'CommandOrControl+Shift+M' } });
    expect(c['overlay:hud']).toEqual({ accel: 'CommandOrControl+Alt+T', taken: true });
    expect(c.miniHotkey.taken).toBe(true);
    expect(K._wpKeycap('CommandOrControl+Alt+T', c['overlay:hud']).title).toMatch(/^Another program already uses Ctrl\+Alt\+T/);
    expect(K._wpClashSummary(c)).toBe('2 clashes: Ctrl+Shift+M, Ctrl+Alt+T');
  });
});
