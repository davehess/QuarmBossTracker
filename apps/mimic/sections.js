// sections.js — the Mimic 3.0 Canvas: each overlay cut into pieces from its OWN page.
//
// The guild lead, 2026-10-02: "every one of the overlays should be exactly reproduced within the canvas
// so the people can disassemble them and use any element of them in the way that they feel fits best
// on their screen … in its current implementation the overlays as they exist outside of the canvas are
// not reproducible inside of the canvas. that needs to be a priority before we can optimize anything
// else." DECISIONS-2026-09-21.md §125 on main.
//
// A section piece is the overlay's real page, loaded once per piece (?wpsect=<id>), with everything
// but that section made invisible and the panel cropped to it (canvas.html, kind 'sect'). Same code,
// same look, same buttons, so it is exact by construction, and a change to an overlay reaches its
// pieces with nothing else to update. parts.js pieces are the other kind: one data value, redrawn
// the Canvas's own way (bar, ring, big number…).
//
// Per overlay, in reading order: the sections a raider can pull out.
//   sel  CSS selector; matches one element or several (the piece is their union).
//   tab  pins the page's tab for this piece (?wptab=), when the section only exists on one tab.
//   note what it is, for the chooser's tooltip.
// A selector that matches nothing right now is a piece with nothing to show (no target, no fight);
// it stays out of the way until there is.
(function (root) {
  'use strict';

  var S = {
    // Target Info (mobinfo.html). The data-wp-sect markers are inert attributes on the page's own
    // render; everything else is a class the page already had.
    mobinfo: [
      { id: 'title',    label: 'Title bar and tabs',  sel: '#wrap > .title',               note: 'The tabs here switch every other Target Info piece that follows tabs' },
      { id: 'name',     label: 'Name and class',      sel: '[data-wp-sect="name"]' },
      { id: 'zone',     label: 'Zone',                sel: '.mob > .zone' },
      { id: 'stats',    label: 'HP, damage, health %', sel: '[data-wp-sect="stats"]' },
      { id: 'slots',    label: 'Buff and song slots', sel: '[data-wp-sect="slots"]' },
      { id: 'hp',       label: 'Health bar',          sel: '.mob > .hpbar' },
      { id: 'timers',   label: 'Their timers (a player)', sel: '[data-wp-sect="timers"]' },
      { id: 'slow',     label: 'Slow',                sel: '.mob > .slowbadge' },
      { id: 'mana',     label: 'Mana',                sel: '.mob > .manabar, .mob > .mana' },
      { id: 'lastcast', label: 'Last spell it cast',  sel: '.mob > .lastcast' },
      { id: 'casting',  label: 'Casting on it',       sel: '[data-wp-sect="casting"]' },
      { id: 'pacify',   label: 'Aggro reduced',       sel: '[data-wp-sect="pacify"]' },
      { id: 'debuffs',  label: 'Debuffs on it',       sel: '[data-wp-sect="debuffs"]' },
      { id: 'buffs',    label: 'Buffs on it',         sel: '[data-wp-sect="buffs"]' },
      { id: 'resists',  label: 'Resists and AC',      sel: '.mob > .res' },
      { id: 'specials', label: 'Special abilities',   sel: '.mob > .spec' },
      { id: 'loot',     label: 'Loot',                sel: '.mob > .loot',                 tab: 'loot' },
      { id: 'spells',   label: 'Spells and abilities', sel: '[data-wp-sect="spells"]',     tab: 'spells' },
      { id: 'fqv',      label: 'Faction · Quest · Vendor', sel: '[data-wp-sect="fqv"]',    tab: 'factions' },
      { id: 'lastfight', label: 'Last fight (top 5)', sel: '[data-wp-sect="lastfight"]' },
      { id: 'empty',    label: '"No target"',         sel: '#empty' },
    ],
  };

  // The HUD's Box (me.html?wpstyle=a; the guild lead, 2026-10-19: "can't break the as-is hud box into
  // pieces"). me.html marks each block of the Box with data-wp-sect (renderA); the ring is one SVG and has
  // no parts here (its "as pieces" are the arcs).
  S.me = [
    { id: 'title',  label: 'Name and class',      sel: '.card > .title' },
    { id: 'hp',     label: 'Health bar',          sel: '[data-wp-sect="hp"]' },
    { id: 'mana',   label: 'Mana bar',            sel: '[data-wp-sect="mana"]' },
    { id: 'end',    label: 'Endurance',           sel: '[data-wp-sect="end"]' },
    { id: 'xp',     label: 'XP per hour',         sel: '[data-wp-sect="xp"]' },
    { id: 'aa',     label: 'AA per hour',         sel: '[data-wp-sect="aa"]' },
    { id: 'meta',   label: 'Level, weight, pet',  sel: '[data-wp-sect="meta"]' },
    { id: 'cast',   label: 'Casting',             sel: '[data-wp-sect="cast"]' },
    { id: 'target', label: 'Target',              sel: '[data-wp-sect="target"]' },
    { id: 'mine',   label: 'Procs, stuns, shield', sel: '[data-wp-sect="mine"]' },
    { id: 'focus',  label: 'Class numbers',       sel: '[data-wp-sect="focus"]' },
    { id: 'damage', label: 'Damage',              sel: '[data-wp-sect="damage"]' },
    { id: 'group',  label: 'Group',               sel: '[data-wp-sect="group"]' },
    { id: 'gems',   label: 'Spell gems',          sel: '[data-wp-sect="gems"]' },
  ];
  // The look a page's parts belong to: the HUD page draws a ring and a box, and only the box has parts.
  var STYLE = { me: 'a' };
  function styleOf(key) { return STYLE[key] || ''; }
  // A page with tabs says where its chosen tab is kept (sessionStorage, shared by the Canvas's frames), and
  // the part every tab keeps in the same place, which the parts that belong to one tab hang from.
  var TABS = { mobinfo: { storage: 'wpTargetTab', first: 'stats', anchor: 'title' } };
  // The tab picked right now, or the page's first.
  function tabNow(key) {
    var t = TABS[key];
    if (!t) return '';
    try { var v = root.sessionStorage && root.sessionStorage.getItem(t.storage); if (v) return v; } catch (e) { /* storage blocked */ }
    return t.first;
  }
  function anchorOf(key) { return TABS[key] ? TABS[key].anchor : ''; }
  // style: the look the panel is drawn in; given, a page with a look of its own has parts only in that one.
  function list(key, style) {
    if (style !== undefined && STYLE[key] && style !== STYLE[key]) return [];
    return S[key] || [];
  }
  function find(key, id) {
    var l = list(key);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }
  // The style a piece's page gets: only its section is visible. Hidden boxes still take their
  // space, so the page lays out exactly as in its window and the panel crops to the section.
  function isolateCss(sel) {
    var parts = String(sel).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var vis = parts.map(function (s) { return s + ',' + s + ' *'; }).join(',');
    return 'html,body{background:transparent!important;overflow:hidden!important}'
      + 'body *{visibility:hidden!important}'
      + vis + '{visibility:visible!important}';
  }
  // The union of the section's boxes in the page, in page pixels, or null when nothing matches or
  // nothing has a size. pad widens it on every side (never past the page's top-left corner).
  function unionRect(doc, sel, pad) {
    var els;
    try { els = doc.querySelectorAll(sel); } catch (e) { return null; }
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (var i = 0; i < els.length; i++) {
      var q = els[i].getBoundingClientRect();
      if (!(q.width > 0 && q.height > 0)) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
    if (!(r > l && b > t)) return null;
    pad = pad > 0 ? pad : 0;
    l = Math.max(0, l - pad); t = Math.max(0, t - pad); r += pad; b += pad;
    return { left: Math.floor(l), top: Math.floor(t), width: Math.ceil(r - l), height: Math.ceil(b - t) };
  }
  // The card a section sits on in its window: the first box around it with a background of its own.
  // Hidden on the Canvas with the rest of the page, so the Canvas paints it behind the piece instead.
  function backdrop(doc, sel) {
    var el;
    try { el = doc.querySelector(sel); } catch (e) { return null; }
    var win = doc.defaultView;
    for (; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
      var cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
      var bg = cs ? cs.backgroundColor : '';
      if (bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg)) {
        return { bg: bg, radius: parseFloat(cs.borderTopLeftRadius) || 0 };
      }
    }
    return null;
  }

  root.WpSections = { byKey: S, list: list, find: find, isolateCss: isolateCss, unionRect: unionRect, backdrop: backdrop,
    styleOf: styleOf, tabNow: tabNow, anchorOf: anchorOf };
})(typeof window !== 'undefined' ? window : globalThis);
