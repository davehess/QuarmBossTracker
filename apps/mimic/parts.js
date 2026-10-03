// parts.js — the Mimic 3.0 parts library: every data element of today's
// overlays as its own piece, and the ways a piece can be drawn.
//
// The guild lead, 2026-09-29: "I see the individual pieces, not break them up
// and put them into categorization like we did with the HUD. My Info, Group
// info, Raid info, target info, pet info, charm info, etc. Make it a
// persistent chooser that i can pull up and move things around, then select
// the mode for the data. break out every data element. when I'm designing this
// it should feel like i'm putting down individual legos instead of prebuilt
// pieces, then be able to save groups. Start with the groups of our overlays
// today and let me pull pieces out as well."
//
// Loaded by canvas.html. Three things live here, none of them touching the DOM
// beyond building HTML strings:
//   • SOURCES — the agent endpoints pieces read, and how often. The canvas polls
//     a source only while a placed piece (or the open chooser) needs it.
//   • PARTS — one entry per data element: its category, source, KIND, how to
//     pull its value out of the source's JSON (get), and a sample for building
//     with no game running. A kind says what the value is; the MODES a piece
//     can be drawn in follow from it.
//   • PRESETS — today's overlays as groups of pieces, so a raider starts from
//     what they know and pulls pieces out.
//
// Views, by kind (what get() and sample return):
//   gauge     { pct 0–100, text?, label?, sub?, color? }
//   value     { text, sub?, color? }
//   countdown { endAt (epoch ms), total (ms), text?, sub?, color? } — ticks locally
//   list      { items: [{ name, pct?, text?, sub?, color?, hi? }], empty? }
// A get() that returns null means "nothing to show right now".
(function (root) {
  'use strict';

  var C = { text: '#c9d1d9', dim: '#6e7681', blue: '#58a6ff', gold: '#d29922', green: '#56d364',
    red: '#f85149', orange: '#ffa657', purple: '#a371f7', teal: '#39c5cf' };

  var CATS = [
    ['me', 'My info'], ['target', 'Target'], ['group', 'Group'], ['raid', 'Raid'], ['pet', 'Pet'],
    ['charm', 'Charm'], ['fight', 'Fight'], ['tank', 'Main tank'], ['heal', 'Healing'],
    ['timers', 'Timers & ticks'], ['zone', 'Zone'], ['casting', 'Casting'],
  ];

  // More ways to draw each kind, the HUD's among them (the guild lead, 2026-09-29: "We need more
  // element types, sizes, formats like in the hud"): a slim one-line bar, an upright bar, a half
  // ring, a round badge (the HUD's DS circle), and lists as one coloured line (the HUD's
  // resists) or as columns.
  var MODES = {
    gauge:     [['bar', 'Bar'], ['thin', 'Slim bar'], ['vbar', 'Upright bar'], ['ring', 'Ring'], ['arc', 'Half ring'],
                ['readout', 'Readout'], ['big', 'Big number'], ['badge', 'Badge'], ['pips', 'Pips']],
    countdown: [['bar', 'Bar'], ['thin', 'Slim bar'], ['vbar', 'Upright bar'], ['ring', 'Ring'], ['arc', 'Half ring'],
                ['readout', 'Readout'], ['big', 'Big number'], ['badge', 'Badge']],
    value:     [['readout', 'Readout'], ['big', 'Big number'], ['badge', 'Badge']],
    list:      [['rows', 'Rows'], ['chips', 'Chips'], ['inline', 'One line'], ['columns', 'Columns']],
  };
  var DEFAULT_SIZE = {
    bar: [220, 34], thin: [220, 18], vbar: [40, 120], ring: [96, 96], arc: [140, 90], readout: [200, 22],
    big: [120, 52], badge: [60, 60], pips: [180, 30],
    rows: [260, 150], chips: [260, 48], inline: [320, 22], columns: [300, 90],
  };
  // What any piece can also set, whatever its mode: its label shown or not, how thick its bar or
  // ring is, its own colour, and where its text sits. Offered in the piece's menu.
  var THICK = [['thin', 'Thin'], ['', 'Normal'], ['thick', 'Thick']];
  var ALIGN = [['', 'Left'], ['c', 'Centre'], ['r', 'Right']];
  var PALETTE = ['#c9d1d9', '#58a6ff', '#56d364', '#d29922', '#ffa657', '#f85149', '#a371f7', '#39c5cf'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  // A missing value is null, not 0: Number(null) is 0, so "slowed null%" and "0 / 0 HP" drew for
  // values the agent had not sent (the guild lead's screenshot, 2026-10-02).
  function num(v) { if (v == null || v === '') return null; v = Number(v); return isFinite(v) ? v : null; }
  function pct(v) { v = num(v); return v == null ? null : Math.max(0, Math.min(100, v)); }
  // Health reads the way EQ's own bars do: fine, hurt, dying.
  function hpColor(p) { return p == null ? C.dim : p > 60 ? C.green : p > 30 ? C.orange : C.red; }
  function mmss(ms) {
    if (!(ms > 0)) return '0:00';
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtNum(n) {
    n = num(n);
    if (n == null) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'm';
    if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
    return String(Math.round(n));
  }
  function pctOf(cur, max) { cur = num(cur); max = num(max); return (cur == null || !max) ? null : (cur / max) * 100; }
  // a.b.c without throwing
  function at(o, path) {
    var ks = path.split('.');
    for (var i = 0; i < ks.length; i++) { if (o == null) return null; o = o[ks[i]]; }
    return o == null ? null : o;
  }

  // A countdown becomes a gauge at the moment it is drawn, so the canvas can
  // tick it locally between polls.
  // `period` makes it repeat (the server tick, a swing); `doneText` is what an
  // expired one says ("ready").
  function resolve(kind, view, now) {
    if (!view || kind !== 'countdown') return view;
    var left = num(view.endAt) != null ? view.endAt - now : null;
    if (left == null) return null;
    var total = num(view.total) || Math.max(left, 1);
    if (num(view.period)) { total = view.period; left = ((left % total) + total) % total; }
    var done = left <= 0;
    var text = done && view.doneText ? view.doneText : (view.text || (view.period ? String(Math.ceil(left / 1000)) : mmss(left)));
    var color = view.color || (done ? C.green : view.period ? C.blue : left < 5000 ? C.red : left < 15000 ? C.orange : C.blue);
    return { pct: Math.max(0, Math.min(100, (left / total) * 100)), text: text, label: view.label, sub: view.sub, color: color };
  }

  // ── Renderers ──────────────────────────────────────────────────────────────
  // Every renderer takes (part, view, opts). opts carries the piece's own settings: color
  // overrides the data's colour, the rest (label, thickness, alignment) are classes on .pt.
  function lbl(part, v) { return v.label || part.short || part.label; }
  function fillCol(part, v, o) { return (o && o.color) || v.color || part.color || C.blue; }
  function textCol(part, v, o, dflt) { return (o && o.color) || v.color || part.color || dflt; }
  // An item that copies a command or opens a page when clicked (a /say, a /map, PQDI). .ctl keeps
  // the canvas from starting a drag on it; data-wp-interact lets it take the click while locked.
  function act(it, inner) {
    if (it && it.copy) return '<span class="ctl pt-act" data-copy="' + esc(it.copy) + '" data-wp-interact title="Copy, then paste into EQ">' + inner + ' <span class="pt-cp">⧉</span></span>';
    if (it && it.url) return '<span class="ctl pt-act" data-url="' + esc(it.url) + '" data-wp-interact title="Opens in your browser">' + inner + '</span>';
    return inner;
  }
  function valueText(v) { var p = pct(v.pct); return v.text != null ? v.text : (p == null ? '—' : Math.round(p) + '%'); }
  // A gauge's own number is its percent in the round and big modes; its text moves underneath.
  function headline(part, v) { var p = pct(v.pct); return (part.kind === 'gauge' && p != null) ? Math.round(p) + '%' : valueText(v); }
  function rBar(part, v, o) {
    var p = pct(v.pct);
    return '<div class="pt pt-bar"><div class="pt-lr"><span class="pt-l">' + esc(lbl(part, v)) + '</span>'
      + '<span class="pt-v">' + act(v, esc(valueText(v))) + '</span></div>'
      + '<div class="pt-track"><div class="pt-fill" style="width:' + (p == null ? 0 : p.toFixed(1)) + '%;background:' + fillCol(part, v, o) + '"></div></div>'
      + (v.sub ? '<div class="pt-sub">' + esc(v.sub) + '</div>' : '') + '</div>';
  }
  // One line: label, a slim bar, the value.
  function rThin(part, v, o) {
    var p = pct(v.pct);
    return '<div class="pt pt-thin"><span class="pt-l">' + esc(lbl(part, v)) + '</span>'
      + '<div class="pt-track"><div class="pt-fill" style="width:' + (p == null ? 0 : p.toFixed(1)) + '%;background:' + fillCol(part, v, o) + '"></div></div>'
      + '<span class="pt-v">' + esc(valueText(v)) + '</span></div>';
  }
  // Fills from the bottom, like the HUD's hit columns.
  function rVbar(part, v, o) {
    var p = pct(v.pct);
    return '<div class="pt pt-vbar"><span class="pt-v">' + esc(headline(part, v)) + '</span>'
      + '<div class="pt-vt"><div class="pt-vf" style="height:' + (p == null ? 0 : p.toFixed(1)) + '%;background:' + fillCol(part, v, o) + '"></div></div>'
      + '<span class="pt-l">' + esc(lbl(part, v)) + '</span></div>';
  }
  function rRing(part, v, o) {
    var p = pct(v.pct), R = 42, CIRC = 2 * Math.PI * R;
    var dash = p == null ? 0 : CIRC * p / 100;
    return '<div class="pt pt-ring"><svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">'
      + '<circle cx="50" cy="50" r="42" class="pt-rt"/>'
      + '<circle cx="50" cy="50" r="42" class="pt-rf" style="stroke:' + fillCol(part, v, o) + '" stroke-dasharray="' + dash.toFixed(1) + ' ' + CIRC.toFixed(1) + '" transform="rotate(-90 50 50)"/>'
      + '<text x="50" y="52" class="pt-rv">' + esc(headline(part, v)) + '</text>'
      + '<text x="50" y="68" class="pt-rl">' + esc(lbl(part, v)) + '</text></svg></div>';
  }
  // The top half of a ring, filling left to right; the number sits inside it.
  var ARC_LEN = Math.PI * 42;
  function rArc(part, v, o) {
    var p = pct(v.pct), dash = p == null ? 0 : ARC_LEN * p / 100;
    return '<div class="pt pt-arc"><svg viewBox="0 0 100 62" preserveAspectRatio="xMidYMid meet">'
      + '<path d="M 8 54 A 42 42 0 0 1 92 54" class="pt-rt"/>'
      + '<path d="M 8 54 A 42 42 0 0 1 92 54" class="pt-rf" style="stroke:' + fillCol(part, v, o) + '" stroke-dasharray="' + dash.toFixed(1) + ' ' + ARC_LEN.toFixed(1) + '"/>'
      + '<text x="50" y="46" class="pt-rv">' + esc(headline(part, v)) + '</text>'
      + '<text x="50" y="60" class="pt-rl">' + esc(lbl(part, v)) + '</text></svg></div>';
  }
  function rReadout(part, v, o) {
    return '<div class="pt pt-read"><span class="pt-l">' + esc(lbl(part, v)) + '</span> <span class="pt-v" style="color:'
      + textCol(part, v, o, C.text) + '">' + act(v, esc(valueText(v))) + '</span>'
      + (v.sub ? ' <span class="pt-sub">' + esc(v.sub) + '</span>' : '') + '</div>';
  }
  // A gauge as a big number is its percent; its own text (3,512 / 4,180) moves
  // underneath, where a long value cannot wrap the big line.
  function rBig(part, v, o) {
    var p = pct(v.pct), big = valueText(v), sub = v.sub || '';
    if (part.kind === 'gauge' && p != null) { big = Math.round(p) + '%'; if (v.text != null) sub = v.text + (sub ? ' · ' + sub : ''); }
    return '<div class="pt pt-big"><div class="pt-bv" style="color:' + textCol(part, v, o, C.text) + '">'
      + act(v, esc(big)) + '</div><div class="pt-l">' + esc(lbl(part, v)) + (sub ? ' · ' + esc(sub) : '') + '</div></div>';
  }
  // A round badge with the number in it, like the HUD's DS circle.
  function rBadge(part, v, o) {
    var c = textCol(part, v, o, C.gold);
    return '<div class="pt pt-badge"><div class="pt-bc" style="border-color:' + c + '"><span class="pt-l">' + esc(lbl(part, v)) + '</span>'
      + '<b style="color:' + c + '">' + act(v, esc(headline(part, v))) + '</b></div></div>';
  }
  function rPips(part, v, o) {
    var p = pct(v.pct), n = 10, lit = p == null ? 0 : Math.round(p / 10), col = fillCol(part, v, o), h = '';
    for (var i = 0; i < n; i++) h += '<i' + (i < lit ? ' style="background:' + col + '"' : '') + '></i>';
    return '<div class="pt pt-pips"><div class="pt-lr"><span class="pt-l">' + esc(lbl(part, v)) + '</span><span class="pt-v">'
      + esc(valueText(v)) + '</span></div><div class="pt-pp">' + h + '</div></div>';
  }
  function itemText(it) { var p = pct(it.pct); return it.text != null ? it.text : (p == null ? '' : Math.round(p) + '%'); }
  function rRows(part, v, o) {
    var items = (v.items || []), h = '';
    items.forEach(function (it) {
      var p = pct(it.pct);
      h += '<div class="pt-row' + (it.hi ? ' hi' : '') + '"><div class="pt-lr"><span class="pt-n">' + act(it, esc(it.name)) + '</span>'
        + '<span class="pt-v" style="color:' + (it.color && p == null ? it.color : C.text) + '">' + esc(itemText(it)) + '</span></div>'
        + (p != null ? '<div class="pt-track thin"><div class="pt-fill" style="width:' + p.toFixed(1) + '%;background:' + ((o && o.color) || it.color || part.color || C.blue) + '"></div></div>' : '')
        + (it.sub ? '<div class="pt-sub">' + esc(it.sub) + '</div>' : '') + '</div>';
    });
    return '<div class="pt pt-rows"><div class="pt-l pt-head">' + esc(lbl(part, v)) + '</div>'
      + (h || '<div class="pt-sub">' + esc(v.empty || 'nothing right now') + '</div>') + '</div>';
  }
  function rChips(part, v, o) {
    var items = (v.items || []), h = '';
    items.forEach(function (it) {
      h += '<span class="pt-chip" style="border-color:' + ((o && o.color) || it.color || C.dim) + '">' + act(it, esc(it.name))
        + (itemText(it) !== '' ? ' <b>' + esc(itemText(it)) + '</b>' : '') + '</span>';
    });
    return '<div class="pt pt-chips"><span class="pt-l">' + esc(lbl(part, v)) + '</span> '
      + (h || '<span class="pt-sub">' + esc(v.empty || 'none') + '</span>') + '</div>';
  }
  // Every item on one line in its own colour, no pills: the HUD's "MR196 FR212 CR233".
  function rInline(part, v, o) {
    var items = (v.items || []), h = '';
    items.forEach(function (it) {
      h += '<span class="pt-in" style="color:' + ((o && o.color) || it.color || C.text) + '">' + act(it, esc(it.name))
        + (itemText(it) !== '' ? '<b>' + esc(itemText(it)) + '</b>' : '') + '</span>';
    });
    return '<div class="pt pt-inline"><span class="pt-l">' + esc(lbl(part, v)) + '</span> '
      + (h || '<span class="pt-sub">' + esc(v.empty || 'none') + '</span>') + '</div>';
  }
  // A grid: each item a cell with its value, and a slim bar when it has one.
  function rColumns(part, v, o) {
    var items = (v.items || []), h = '';
    items.forEach(function (it) {
      var p = pct(it.pct);
      h += '<div class="pt-cell"><span class="pt-cn">' + act(it, esc(it.name)) + '</span>'
        + '<b style="color:' + ((o && o.color) || it.color || C.text) + '">' + esc(itemText(it)) + '</b>'
        + (p != null ? '<div class="pt-track thin"><div class="pt-fill" style="width:' + p.toFixed(1) + '%;background:' + ((o && o.color) || it.color || part.color || C.blue) + '"></div></div>' : '')
        + '</div>';
    });
    return '<div class="pt pt-columns"><div class="pt-l pt-head">' + esc(lbl(part, v)) + '</div>'
      + (h ? '<div class="pt-cols">' + h + '</div>' : '<div class="pt-sub">' + esc(v.empty || 'nothing right now') + '</div>') + '</div>';
  }
  var RENDER = { bar: rBar, thin: rThin, vbar: rVbar, ring: rRing, arc: rArc, readout: rReadout, big: rBig, badge: rBadge,
    pips: rPips, rows: rRows, chips: rChips, inline: rInline, columns: rColumns };

  // The one entry point: a piece, the mode it is drawn in, its view, and the piece's own
  // options ({ nolabel, thick, color, align }).
  function render(part, mode, view, now, opts) {
    var o = opts || {};
    var v = resolve(part.kind, view, now || Date.now());
    var modes = MODES[part.kind] || MODES.value;
    if (!modes.some(function (m) { return m[0] === mode; })) mode = modes[0][0];
    if (!v) return '<div class="pt pt-none"><span class="pt-l">' + esc(part.short || part.label) + '</span> <span class="pt-sub">—</span></div>';
    var cls = (o.nolabel ? ' nl' : '') + (o.thick === 'thin' || o.thick === 'thick' ? ' tk-' + o.thick : '')
      + (o.align === 'c' || o.align === 'r' ? ' al-' + o.align : '');
    var html = RENDER[mode](part, v, o);
    return cls ? html.replace('<div class="pt ', '<div class="pt' + cls + ' ') : html;
  }

  // The stylesheet the canvas injects once. Pieces fill their panel; --ps is
  // the panel's size setting. Text keeps the overlays' dark edge so it reads
  // over a moving scene.
  var CSS = ''
    + '.pt{box-sizing:border-box;width:100%;height:100%;overflow:hidden;font-size:calc(12px * var(--ps,1));line-height:1.25;'
    + 'color:' + C.text + ';text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 1px 2px #000}'
    + '.pt-lr{display:flex;justify-content:space-between;gap:6px;white-space:nowrap}'
    + '.pt-l{color:' + C.dim + ';overflow:hidden;text-overflow:ellipsis}'
    + '.pt-v{font-weight:700;font-variant-numeric:tabular-nums}'
    + '.pt-sub{color:' + C.dim + ';font-size:0.85em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.pt-track{height:calc(8px * var(--ps,1));margin-top:2px;background:rgba(13,17,23,0.75);border:1px solid #30363d;border-radius:3px;overflow:hidden}'
    + '.pt-track.thin{height:calc(4px * var(--ps,1));margin-top:1px}'
    + '.pt-fill{height:100%;transition:width 0.25s linear}'
    + '.pt-ring svg{width:100%;height:100%;display:block}'
    + '.pt-rt{fill:none;stroke:rgba(13,17,23,0.75);stroke-width:9}'
    + '.pt-rf{fill:none;stroke-width:9;stroke-linecap:round}'
    + '.pt-rv{fill:' + C.text + ';font-size:18px;font-weight:700;text-anchor:middle;paint-order:stroke;stroke:#000;stroke-width:3px}'
    + '.pt-rl{fill:' + C.dim + ';font-size:10px;text-anchor:middle;paint-order:stroke;stroke:#000;stroke-width:2px}'
    + '.pt-read{white-space:nowrap}'
    + '.pt-big{display:flex;flex-direction:column;justify-content:center}'
    + '.pt-bv{font-size:calc(26px * var(--ps,1));font-weight:700;line-height:1.05;font-variant-numeric:tabular-nums}'
    + '.pt-pp{display:flex;gap:2px;margin-top:2px}.pt-pp i{flex:1;height:calc(8px * var(--ps,1));background:rgba(13,17,23,0.75);border:1px solid #30363d;border-radius:2px}'
    + '.pt-head{margin-bottom:2px}'
    + '.pt-row{margin-bottom:2px}.pt-row.hi .pt-n{color:' + C.gold + '}'
    + '.pt-n{overflow:hidden;text-overflow:ellipsis}'
    + '.pt-chips{display:flex;flex-wrap:wrap;gap:3px;align-items:center;align-content:flex-start}'
    + '.pt-chip{padding:0 5px;border:1px solid;border-radius:9px;background:rgba(13,17,23,0.7);white-space:nowrap}'
    + '.pt-none{opacity:0.55}'
    // The newer formats.
    + '.pt-thin{display:flex;align-items:center;gap:6px;white-space:nowrap}'
    + '.pt-thin .pt-track{flex:1;margin-top:0;height:calc(6px * var(--ps,1))}'
    + '.pt-vbar{display:flex;flex-direction:column;align-items:center;gap:2px}'
    + '.pt-vbar .pt-l{max-width:100%;font-size:0.85em}'
    + '.pt-vt{flex:1;width:calc(12px * var(--ps,1));background:rgba(13,17,23,0.75);border:1px solid #30363d;border-radius:3px;display:flex;align-items:flex-end;overflow:hidden}'
    + '.pt-vf{width:100%;transition:height 0.25s linear}'
    + '.pt-arc svg{width:100%;height:100%;display:block}'
    + '.pt-badge{display:flex;align-items:center;justify-content:center}'
    + '.pt-bc{box-sizing:border-box;height:100%;max-width:100%;aspect-ratio:1;border:2px solid;border-radius:50%;background:rgba(13,17,23,0.6);'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1}'
    + '.pt-bc .pt-l{font-size:0.75em}.pt-bc b{font-size:1.25em;font-variant-numeric:tabular-nums}'
    + '.pt-inline{white-space:normal}.pt-in{margin-right:0.6em;font-weight:700;white-space:nowrap}.pt-in b{margin-left:1px}'
    + '.pt-cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(calc(70px * var(--ps,1)),1fr));gap:2px 8px}'
    + '.pt-cell{display:flex;flex-wrap:wrap;justify-content:space-between;gap:0 4px;min-width:0}'
    + '.pt-cell .pt-cn{color:' + C.dim + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}'
    + '.pt-cell .pt-track{flex-basis:100%}'
    + '.pt-act{cursor:pointer;border-bottom:1px dotted currentColor}.pt-act:hover{color:#e6edf3}.pt-cp{font-size:0.8em;opacity:0.7}'
    // The piece's own options.
    + '.pt.nl .pt-l,.pt.nl .pt-rl{display:none}'
    + '.pt.tk-thin .pt-track{height:calc(4px * var(--ps,1))}.pt.tk-thick .pt-track{height:calc(14px * var(--ps,1))}'
    + '.pt.tk-thin .pt-rt,.pt.tk-thin .pt-rf{stroke-width:5}.pt.tk-thick .pt-rt,.pt.tk-thick .pt-rf{stroke-width:15}'
    + '.pt.tk-thin .pt-vt{width:calc(7px * var(--ps,1))}.pt.tk-thick .pt-vt{width:calc(22px * var(--ps,1))}'
    + '.pt.al-c{text-align:center}.pt.al-c .pt-lr{justify-content:center}.pt.al-c.pt-chips,.pt.al-c.pt-thin{justify-content:center}'
    + '.pt.al-r{text-align:right}.pt.al-r .pt-lr{justify-content:flex-end}.pt.al-r.pt-chips{justify-content:flex-end}';

  // ── Sources ────────────────────────────────────────────────────────────────
  // The agent's own endpoints (docs/DESIGN-overlay-catalog.md §4 has the
  // contract). /api/state is the big one; it is polled only while a piece that
  // needs it is on the screen.
  var SOURCES = {
    me:     { path: '/api/me',              every: 500 },
    state:  { path: '/api/state',           every: 1000 },
    tank:   { path: '/api/tank-state',      every: 750 },
    cmd:    { path: '/api/command-center',  every: 1500 },
    ext:    { path: '/api/extended-target', every: 2000 },
    bq:     { path: '/api/buff-queue',      every: 2000 },
    timers: { path: '/api/timers',          every: 700 },
    // What the target NPC says, takes and sells (Target Info's Quest and Vendor tabs). Its path
    // depends on who is targeted, so it is a function of the other sources; null means wait.
    npc:    { path: function (live) { var s = live('state'), m = s && s.mobInfo && s.mobInfo.mob; return m && m.id ? '/api/npc-interact?id=' + m.id : null; },
              needs: ['state'], every: 5000 },
  };

  // ── Helpers for get() ──────────────────────────────────────────────────────
  function fmtInt(n) { n = num(n); return n == null ? '—' : Math.round(n).toLocaleString('en-US'); }
  function gPct(o) { return o ? (num(o.pct) != null ? o.pct : pctOf(o.cur, o.max)) : null; }
  function curMax(o, min) {
    if (!o || num(o.cur) == null || !num(o.max) || o.max < (min || 1)) { var p = gPct(o); return p == null ? null : Math.round(p) + '%'; }
    return fmtInt(o.cur) + ' / ' + fmtInt(o.max);
  }
  function ago(ms) { ms = num(ms); if (ms == null || ms < 0) return ''; var s = Math.round(ms / 1000); return s < 60 ? s + 's ago' : Math.round(s / 60) + 'm ago'; }
  function secsText(s) { s = num(s); return s == null ? '' : mmss(s * 1000); }
  function low(s) { return String(s == null ? '' : s).toLowerCase(); }
  // /api/state carries every watched character; a piece shows the one EQ has in front.
  function mine(list, d, key) {
    var me = low(d && d.activeCharacter);
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) if (low(list[i][key || 'owner']) === me) return list[i];
    return null;
  }
  function buffRows(list, at) {
    return (Array.isArray(list) ? list : []).map(function (b) {
      var left = num(b.remaining_secs);
      if (left != null && num(b.observed_at_ms)) left = Math.max(0, left - (Date.now() - b.observed_at_ms) / 1000);
      var tot = num(b.total_secs);
      return { name: b.name, text: b.fell_off ? 'fell off' : left == null ? '' : secsText(left),
        pct: (left != null && tot) ? (left / tot) * 100 : null,
        color: b.fell_off ? C.purple : b.good === 0 ? C.red : C.green };
    });
  }
  var ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  // Each resist in the HUD's colour for it, so "One line" reads like the HUD's resist row.
  var RES = [['mr', 'MR', C.purple], ['fr', 'FR', C.orange], ['cr', 'CR', C.blue], ['pr', 'PR', C.green], ['dr', 'DR', C.gold]];
  function resistChips(r) {
    if (!r) return null;
    var items = RES.filter(function (k) { return num(r[k[0]]) != null; }).map(function (k) { return { name: k[1], text: r[k[0]], color: k[2] }; });
    return items.length ? { items: items } : null;
  }
  function meT(d) { return d && d.character && d.target ? d.target : null; }
  function cd(d, key) {
    var cs = (d && d.cooldowns) || [];
    for (var i = 0; i < cs.length; i++) if (cs[i].key === key) return cs[i];
    return null;
  }
  function cdView(c, at) {
    if (!c || c.seen === false) return null;
    if (c.failed) return { endAt: at, total: 1, text: '✗ failed', color: C.red, label: c.label };
    var ms = num(c.ms_left);
    if (ms == null || ms <= 0) return { endAt: at, total: 1, doneText: 'ready', label: c.label };
    return { endAt: at + ms, total: num(c.total_ms) || ms, doneText: 'ready', label: c.label };
  }
  function cdSample(label, left, tot) { return function (now) { return { endAt: now + left, total: tot, doneText: 'ready', label: label }; }; }

  var PARTS = [];
  function P(id, cat, label, src, kind, get, sample, extra) {
    var p = { id: id, cat: cat, label: label, src: src, kind: kind, get: get, sample: sample };
    if (extra) for (var k in extra) p[k] = extra[k];
    PARTS.push(p);
  }

  // ── My info (/api/me) ──
  P('me.name', 'me', 'Name, level, class', 'me', 'value',
    function (d) { return d.character ? { text: d.character, sub: [d.level, d['class']].filter(Boolean).join(' ') } : null; },
    { text: 'Aldenmar', sub: '60 Enchanter' }, { short: 'Me' });
  P('me.hp', 'me', 'My health', 'me', 'gauge',
    function (d) { var p = d.character && gPct(d.hp); return p == null ? null : { pct: p, text: curMax(d.hp), color: hpColor(p) }; },
    { pct: 84, text: '3,512 / 4,180', color: C.green }, { short: 'HP' });
  P('me.mana', 'me', 'My mana', 'me', 'gauge',
    function (d) { var p = d.character && !d.no_mana && gPct(d.mana); return p == null || p === false ? null : { pct: p, text: curMax(d.mana) }; },
    { pct: 62, text: '2,410 / 3,890' }, { short: 'Mana', color: C.blue });
  P('me.end', 'me', 'My endurance', 'me', 'gauge',
    function (d) { var p = d.character && gPct(d.end); return p == null ? null : { pct: p }; },
    { pct: 91 }, { short: 'End', color: C.gold });
  P('me.xp', 'me', 'Experience in this level', 'me', 'gauge',
    function (d) { var x = d.character && d.xp; if (!x || num(x.pct) == null) return null; return { pct: x.pct, text: x.pct.toFixed(1) + '%', sub: num(x.per_hr) != null ? '+' + x.per_hr.toFixed(1) + '%/hr' : '' }; },
    { pct: 43.2, text: '43.2%', sub: '+6.4%/hr' }, { short: 'XP', color: C.purple });
  P('me.xphr', 'me', 'Experience per hour', 'me', 'value',
    function (d) { var r = d.character && d.xp && num(d.xp.per_hr); return r == null ? null : { text: r.toFixed(1) + '%/hr', sub: 'of a level' }; },
    { text: '6.4%/hr', sub: 'of a level' }, { short: 'XP/hr', note: 'Measured over the last hour; appears after 5 minutes' });
  P('me.aa', 'me', 'AA experience', 'me', 'gauge',
    function (d) { var a = d.character && d.aa; if (!a || num(a.pct) == null) return null; return { pct: a.pct, text: a.pct.toFixed(1) + '%', sub: num(a.banked) != null ? a.banked + ' banked' : '' }; },
    { pct: 71.5, text: '71.5%', sub: '3 banked' }, { short: 'AA', color: C.purple });
  P('me.aahr', 'me', 'AA per hour', 'me', 'value',
    function (d) { var r = d.character && d.aa && num(d.aa.per_hr); return r == null ? null : { text: r.toFixed(1) + '%/hr' }; },
    { text: '12.0%/hr' }, { short: 'AA/hr' });
  P('me.aabank', 'me', 'AA points banked', 'me', 'value',
    function (d) { var b = d.character && d.aa && num(d.aa.banked); return b == null ? null : { text: String(b) }; },
    { text: '3' }, { short: 'Banked' });
  P('me.weight', 'me', 'Weight', 'me', 'gauge',
    function (d) { var w = d.character && d.weight; if (!w || num(w.cur) == null || !num(w.max)) return null; return { pct: (w.cur / w.max) * 100, text: w.cur + ' / ' + w.max, color: w.cur > w.max ? C.red : C.dim }; },
    { pct: 68, text: '102 / 150', color: C.dim }, { short: 'Weight' });
  P('me.cast', 'me', 'My cast bar', 'me', 'countdown',
    function (d, at) {
      var c = d.character && d.casting; if (!c || num(c.remaining_ms) == null) return null;
      var done = num(c.pct) != null ? c.pct : 0, total = done < 100 ? c.remaining_ms / ((100 - done) / 100) : c.remaining_ms;
      return { endAt: at + c.remaining_ms, total: total, label: (c.est ? '~' : '') + c.spell, color: C.blue };
    },
    function (now) { return { endAt: now + 2400, total: 4000, label: 'Tashanian', color: C.blue }; }, { short: 'Casting' });
  P('me.gems', 'me', 'Spell gems', 'me', 'list',
    function (d) {
      if (!d.character || !Array.isArray(d.gems)) return null;
      return { items: d.gems.map(function (g) { return { name: g.slot + ' ' + (g.name || ''), pct: num(g.recast_pct) > 0 ? g.recast_pct : null,
        text: num(g.casts_left) != null ? '×' + g.casts_left : (g.mana ? g.mana + 'm' : ''), color: g.mez ? C.purple : g.charm ? C.orange : C.blue }; }) };
    },
    { items: [{ name: '1 Tashanian', text: '×24' }, { name: '2 Entrancing Lights', text: '×9', pct: 40, color: C.purple }, { name: '3 Allure', text: '×12', color: C.orange }] },
    { short: 'Gems' });
  P('me.cooldowns', 'me', 'All my cooldowns', 'me', 'list',
    function (d, at) {
      if (!d.character || !Array.isArray(d.cooldowns)) return null;
      return { items: d.cooldowns.filter(function (c) { return c.seen !== false; }).map(function (c) {
        var ms = num(c.ms_left); if (ms != null) ms -= Date.now() - at;
        return { name: c.label, text: c.failed ? '✗' : (ms == null || ms <= 0) ? 'ready' : mmss(ms),
          color: c.failed ? C.red : (ms == null || ms <= 0) ? C.green : C.orange }; }) };
    },
    { items: [{ name: 'Mend', text: 'ready', color: C.green }, { name: 'Feign Death', text: '0:07', color: C.orange }] }, { short: 'Cooldowns' });
  [['ability', 'Combat ability'], ['mend', 'Mend'], ['taunt', 'Taunt'], ['fd', 'Feign Death'], ['loh', 'Lay on Hands'], ['ht', 'Harm Touch'], ['disc', 'Discipline']]
    .forEach(function (k) {
      P('me.cd_' + k[0], 'me', k[1] + ' cooldown', 'me', 'countdown',
        function (d, at) { return cdView(cd(d, k[0]), at); }, cdSample(k[1], 23000, 60000), { short: k[1] });
    });
  P('me.focus', 'me', 'Class numbers (CHs left, mez…)', 'me', 'list',
    function (d) {
      if (!d.character || !Array.isArray(d.focus)) return null;
      return { items: d.focus.filter(function (f) { return f.timer_ms == null; }).map(function (f) { return { name: f.label, text: f.value == null ? '—' : f.value, sub: f.sub || '' }; }) };
    },
    { items: [{ name: 'Mez', text: '3', sub: 'Entrancing Lights' }] }, { short: 'Class' });
  P('me.resists', 'me', 'My resists', 'me', 'list', function (d) { return d.character ? resistChips(d.resists) : null; },
    { items: [{ name: 'MR', text: 172 }, { name: 'FR', text: 95 }, { name: 'CR', text: 88 }, { name: 'PR', text: 60 }, { name: 'DR', text: 72 }] },
    { short: 'Resists', mode: 'chips' });
  P('me.dpsout', 'me', 'My damage out, per second', 'me', 'value',
    function (d) { var v = d.character && d.combat && d.combat.out && num(d.combat.out.dps); return v == null ? null : { text: fmtNum(v), sub: 'dps out', color: C.gold }; },
    { text: '214', sub: 'dps out', color: C.gold }, { short: 'Out' });
  P('me.dpsin', 'me', 'Damage coming in, per second', 'me', 'value',
    function (d) { var v = d.character && d.combat && d.combat['in'] && num(d.combat['in'].dps); return v == null ? null : { text: fmtNum(v), sub: 'dps in', color: C.red }; },
    { text: '88', sub: 'dps in', color: C.red }, { short: 'In' });
  P('me.fightdps', 'me', 'My DPS this fight', 'me', 'value',
    function (d) { var f = d.character && d.dps && d.dps.fight; return f && num(f.dps) != null ? { text: fmtNum(f.dps), sub: f.target || '' } : null; },
    { text: '231', sub: 'a burning guardian' }, { short: 'Fight DPS' });
  P('me.nightdps', 'me', 'My DPS tonight', 'me', 'value',
    function (d) { var n = d.character && d.dps && d.dps.night; return n && num(n.avg_dps) != null ? { text: fmtNum(n.avg_dps), sub: (n.fights || 0) + ' fights' } : null; },
    { text: '198', sub: '14 fights' }, { short: 'Tonight' });
  P('me.ds', 'me', 'My damage shield', 'me', 'value',
    function (d) { var s = d.character && d.combat && d.combat.ds; return s ? { text: fmtNum(s.total), sub: '~' + fmtNum(s.per_hit) + ' a hit' + (s.from_buffs ? '' : ' (est)') } : null; },
    { text: '1,240', sub: '~31 a hit' }, { short: 'DS' });
  P('me.blind', 'me', 'Blinded', 'me', 'value',
    function (d) { return d.character && d.blind ? { text: 'BLINDED', color: C.red } : null; },
    { text: 'BLINDED', color: C.red }, { short: 'Blind' });
  P('me.track', 'me', 'Tracking arrow', 'me', 'value',
    function (d) { var t = d.character && d.track; if (!t || !t.name) return null; var a = num(t.angle); return { text: (a == null ? '•' : ARROWS[Math.round(a / 45) % 8]) + ' ' + t.name, sub: ago(t.age_ms) }; },
    { text: '↗ a griffon', sub: '4s ago' }, { short: 'Track' });

  // ── Timers & ticks ──
  P('tick.server', 'timers', 'Server tick', 'me', 'countdown',
    function (d, at) { var t = d.character && d.tick; return t && num(t.ms_left) != null ? { endAt: at + t.ms_left, period: num(t.period_ms) || 6000, label: 'Tick' } : null; },
    function (now) { return { endAt: now + 3800, period: 6000, label: 'Tick' }; }, { short: 'Tick' });
  P('tick.swing', 'timers', 'Swing timer', 'me', 'countdown',
    function (d, at) { var s = d.character && d.swing; return s && !s.idle && num(s.ms_left) != null && num(s.period_ms) ? { endAt: at + s.ms_left, period: s.period_ms, label: 'Swing', color: C.gold } : null; },
    function (now) { return { endAt: now + 1300, period: 2400, label: 'Swing', color: C.gold }; }, { short: 'Swing' });
  function timerRows(d, at, group) {
    var ts = (d && d.activeTimers) || [];
    return { items: ts.filter(function (t) { return !group || t.group === group; }).slice(0, 12).map(function (t) {
      var left = num(t.remaining_ms); if (left != null) left -= Date.now() - at;
      return { name: (t.target ? t.target + ' – ' : '') + (t.effect || t.name || ''), text: left == null ? '' : mmss(left),
        pct: (left != null && num(t.duration_sec)) ? (left / (t.duration_sec * 1000)) * 100 : null, color: t.bar_color || t.color || C.blue };
    }) };
  }
  var TIMER_SAMPLE = { items: [{ name: 'a burning guardian – Tashanian', text: '1:42', pct: 70 }, { name: 'Recharm tick', text: '0:04', pct: 60, color: C.orange }] };
  P('timers.all', 'timers', 'Every countdown', 'timers', 'list', function (d, at) { return timerRows(d, at, null); }, TIMER_SAMPLE, { short: 'Timers' });
  [['charm', 'Charm countdowns'], ['lull', 'Lull countdowns'], ['spell', 'My spells on mobs'], ['trigger', 'Trigger countdowns'], ['loot', 'Loot bids']].forEach(function (g) {
    P('timers.' + g[0], 'timers', g[1], 'timers', 'list', function (d, at) { return timerRows(d, at, g[0]); }, TIMER_SAMPLE, { short: g[1] });
  });
  P('tick.all', 'timers', 'Server tick, every character', 'state', 'list',
    function (d) {
      var ts = d.serverTicks; if (!Array.isArray(ts)) return null;
      return { items: ts.map(function (t) { var left = ((t.at - Date.now()) % 6000 + 6000) % 6000; return { name: t.character, text: Math.ceil(left / 1000) + 's', pct: left / 60 }; }) };
    },
    { items: [{ name: 'Aldenmar', text: '4s', pct: 66 }, { name: 'Brackwyn', text: '1s', pct: 15 }] }, { short: 'Ticks' });
  P('tick.zeal', 'timers', 'Zeal link', 'state', 'value',
    function (d) { var z = d.zeal; if (!z) return null; var age = num(z.lastEventAt) ? Date.now() - z.lastEventAt : null; return { text: age != null && age < 10000 ? 'Zeal ok' : 'no Zeal data', color: age != null && age < 10000 ? C.green : C.red, sub: age != null ? ago(age) : '' }; },
    { text: 'Zeal ok', color: C.green, sub: '1s ago' }, { short: 'Zeal' });
  P('tick.clock', 'timers', 'This PC\'s clock', 'state', 'value',
    function (d) { var o = num(d.clockOffsetMs); if (o == null) return null; var a = Math.abs(o) / 1000; return { text: a < 0.5 ? 'on time' : a.toFixed(1) + 's ' + (o > 0 ? 'slow' : 'fast'), color: a < 1 ? C.green : a < 5 ? C.orange : C.red }; },
    { text: '0.3s slow', color: C.green }, { short: 'Clock' });

  // ── Target ──
  P('target.name', 'target', 'Target name, level, class', 'me', 'value',
    function (d) { var t = meT(d); if (!t || !t.name) return null; return { text: t.name + (t.corpse ? ' (corpse)' : ''), sub: [t.level != null ? 'L' + t.level + (t.level_max && t.level_max !== t.level ? '–' + t.level_max : '') : '', t['class']].filter(Boolean).join(' ') }; },
    { text: 'a burning guardian', sub: 'L58 Warrior' }, { short: 'Target' });
  P('target.hp', 'target', 'Target health', 'me', 'gauge',
    function (d) { var t = meT(d); return t && num(t.hp_pct) != null ? { pct: t.hp_pct, label: t.name, color: hpColor(t.hp_pct) } : null; },
    { pct: 37, label: 'a burning guardian', color: C.orange }, { short: 'Target HP' });
  P('target.tot', 'target', 'Target\'s target', 'me', 'value',
    function (d) { var t = meT(d), o = t && t.tot; return o && o.name ? { text: '→ ' + o.name, sub: num(o.hp_pct) != null ? Math.round(o.hp_pct) + '%' : '' } : null; },
    { text: '→ Brackwyn', sub: '71%' }, { short: 'Target\'s target' });
  P('target.slow', 'target', 'Slow', 'me', 'value',
    function (d) {
      var t = meT(d); if (!t) return null;
      if (t.slow) return { text: 'slowed' + (num(t.slow.pct) != null ? ' ' + t.slow.pct + '%' : ''), sub: secsText(t.slow.remaining_secs), color: C.green };
      if (t.unslowable) return { text: 'unslowable', color: C.orange };
      return t.enrage != null ? { text: 'not slowed', color: C.red } : null;
    },
    { text: 'slowed 75%', sub: '2:10', color: C.green }, { short: 'Slow' });
  P('target.enrage', 'target', 'Enrage', 'me', 'value',
    function (d) { var t = meT(d); if (!t || t.enrage == null) return null; return t.enraged ? { text: 'ENRAGED', color: C.red } : t.enrage ? { text: 'enrages at 8%', color: C.orange } : { text: 'no enrage', color: C.dim }; },
    { text: 'enrages at 8%', color: C.orange }, { short: 'Enrage' });
  P('target.flags', 'target', 'Summons, flurry, rampage', 'me', 'list',
    function (d) {
      var t = meT(d); if (!t) return null; var it = [];
      if (t.summon) it.push({ name: 'summons', color: C.orange });
      if (t.flurry) it.push({ name: 'flurry', color: t.flurry_lit ? C.red : C.dim });
      if (t.rampage) it.push({ name: 'rampage', color: t.rampage_lit ? C.red : C.dim });
      if (t.unslowable) it.push({ name: 'unslowable', color: C.orange });
      return { items: it, empty: 'nothing special' };
    },
    { items: [{ name: 'summons', color: C.orange }, { name: 'rampage', color: C.dim }] }, { short: 'Abilities', mode: 'chips' });
  P('target.resists', 'target', 'Target resists', 'me', 'list', function (d) { var t = meT(d); return t ? resistChips(t.resists) : null; },
    { items: [{ name: 'MR', text: 150 }, { name: 'FR', text: 250 }, { name: 'CR', text: 90 }] }, { short: 'Target resists', mode: 'chips' });
  // The agent keeps a ledger only once it has seen the mob cast or be drained, so before that
  // there was nothing and the piece stayed blank on every mob with mana (the guild lead, 2026-09-30,
  // FB-40: "Canvas target mana doesn't work for each mob that has mana"). Until then the estimate is
  // the catalog pool, untouched — Target Info's own "max mana" line, drawn as a full bar.
  P('target.mana', 'target', 'Target mana (estimate)', 'state', 'gauge',
    function (d) {
      var m = d.mobInfo && d.mobInfo.target_mana;
      if (m && num(m.pct) != null) return { pct: m.pct, text: '~' + Math.round(m.pct) + '%', sub: m.drained ? 'drained ' + fmtNum(m.drained) : '' };
      var c = mob(d);
      return c && num(c.mana) > 0 ? { pct: 100, text: '~100%', sub: fmtNum(c.mana) + ' · no casts seen' } : null;
    },
    { pct: 58, text: '~58%' }, { short: 'Target mana', color: C.blue });
  P('target.lastcast', 'target', 'Target\'s last cast', 'state', 'value',
    function (d) { var c = d.mobInfo && d.mobInfo.target_lastcast; return c && c.spell ? { text: (c.confidence === 'guess' ? '? ' : '') + c.spell, sub: ago(Date.now() - c.atMs) } : null; },
    { text: 'Lava Breath', sub: '12s ago' }, { short: 'Last cast' });
  P('target.casting', 'target', 'Casting on the target', 'state', 'list',
    function (d) { var cs = d.mobInfo && d.mobInfo.target_casting; if (!Array.isArray(cs)) return null; return { items: cs.map(function (c) { var l = num(c.ends_at_ms) ? c.ends_at_ms - Date.now() : null; return { name: c.caster + ' → ' + c.spell, text: l == null ? '' : (Math.max(0, l) / 1000).toFixed(1) + 's' }; }), empty: 'no casts' }; },
    { items: [{ name: 'Corvale → Tashanian', text: '1.8s' }] }, { short: 'Casting on it' });
  P('target.debuffs', 'target', 'Debuffs on the target', 'state', 'list',
    function (d) { var b = d.mobInfo && d.mobInfo.target_buffs; if (!Array.isArray(b)) return null; return { items: buffRows(b.filter(function (x) { return x.good === 0; })), empty: 'no debuffs' }; },
    { items: [{ name: 'Tashanian', text: '1:31', pct: 60, color: C.red }, { name: 'Turgur\'s Insects', text: '2:02', pct: 80, color: C.red }] }, { short: 'Debuffs' });
  P('target.buffs', 'target', 'Buffs on the target', 'state', 'list',
    function (d) { var b = d.mobInfo && d.mobInfo.target_buffs; if (!Array.isArray(b)) return null; return { items: buffRows(b.filter(function (x) { return x.good !== 0; })), empty: 'no buffs' }; },
    { items: [{ name: 'Shield of Lava', text: '5:10', pct: 90, color: C.green }] }, { short: 'Target buffs' });
  P('target.pacify', 'target', 'Pacified', 'state', 'value',
    function (d) { var b = d.mobInfo && d.mobInfo.target_buffs; if (!Array.isArray(b)) return null; for (var i = 0; i < b.length; i++) if (b[i].pacified) return { text: b[i].name + (b[i].pacify_ae ? ' (AE — still aggros close)' : ''), sub: secsText(b[i].remaining_secs), color: C.purple }; return { text: 'not pacified', color: C.dim }; },
    { text: 'Harmony (AE — still aggros close)', sub: '1:20', color: C.purple }, { short: 'Lull' });
  P('target.ht', 'target', 'Shadow Knight Harm Touch', 'state', 'value',
    function (d) { var h = d.mobInfo && d.mobInfo.target_npc_ht; if (!h) return null; return h.ready ? { text: 'HT up', color: C.red } : { text: 'HT used', sub: num(h.ready_in_ms) ? 'back in ' + mmss(h.ready_in_ms) : '', color: C.green }; },
    { text: 'HT up', color: C.red }, { short: 'HT' });
  P('target.stats', 'target', 'Target stats', 'state', 'value',
    function (d) { var m = d.mobInfo && d.mobInfo.mob; if (!m) return null; return { text: 'AC ' + (m.ac == null ? '?' : m.ac) + ' · HP ' + fmtNum(m.hp), sub: m.mindmg != null ? 'hits ' + m.mindmg + '–' + m.maxdmg : '' }; },
    { text: 'AC 420 · HP 32k', sub: 'hits 60–240' }, { short: 'Stats' });
  // Dangerous ones red, immunities blue — the Target Info overlay's own colouring.
  var WARN_SPECS = { 'Summon': 1, 'Enrage': 1, 'Rampage': 1, 'Area Rampage': 1, 'Flurry': 1, 'Bane': 1 };
  function specColor(s) { return WARN_SPECS[s] ? C.red : (s.indexOf('Immune') === 0 || s.indexOf('Un') === 0) ? C.blue : C.dim; }
  P('target.specials', 'target', 'Special attacks and immunities', 'state', 'list',
    function (d) {
      var m = d.mobInfo && d.mobInfo.mob; if (!m || !Array.isArray(m.specials)) return null;
      return { items: m.specials.map(function (s) { var n = typeof s === 'string' ? s : (s.name || s.label || String(s.code || s)); return { name: n, color: specColor(n) }; }), empty: 'none' };
    },
    { items: [{ name: 'Magical', color: C.dim }, { name: 'Unslowable', color: C.blue }, { name: 'Unmezzable', color: C.blue }, { name: 'Summon', color: C.red }, { name: 'Immune Melee Except Bane', color: C.blue }] },
    { short: 'Specials', mode: 'chips' });
  P('target.player', 'target', 'Player target: guild, class, level', 'state', 'value',
    function (d) { var p = d.mobInfo && d.mobInfo.target_player; if (!p) return null; return { text: p.name + (p.guild ? ' <' + p.guild + '>' : ''), sub: [p.level != null ? 'L' + p.level : '', p['class'], p.anonymous ? 'anon' : ''].filter(Boolean).join(' ') }; },
    { text: 'Zarrin <Wolf Pack>', sub: 'L60 Shaman' }, { short: 'Player' });

  // Everything else the Target Info overlay shows — its Stats, Loot, Spells and F/Q/V tabs —
  // one piece each (the guild lead, 2026-09-29: "The Target Info is missing all sorts of data. no
  // drops no spells no fwv"). All from the catalog row the bot sends for the target (mobInfo.mob),
  // except Quest and Vendor, which read the NPC's script (the npc source).
  function mob(d) { return d && d.mobInfo && d.mobInfo.mob ? d.mobInfo.mob : null; }
  P('target.level', 'target', 'Level and class (catalog)', 'state', 'value',
    function (d) { var m = mob(d); if (!m || m.level == null) return null; return { text: 'L' + m.level + (m.maxlevel != null && m.maxlevel > m.level ? '–' + m.maxlevel : ''), sub: m['class'] || '' }; },
    { text: 'L60', sub: 'Warrior' }, { short: 'Level' });
  P('target.zone', 'target', 'Target zone', 'state', 'value',
    function (d) { var m = mob(d); return m && m.zone ? { text: '@ ' + m.zone } : null; },
    { text: '@ Plane of Mischief' }, { short: 'Zone' });
  P('target.hpmax', 'target', 'Target hit points', 'state', 'value',
    function (d) {
      var mi = d.mobInfo, m = mob(d);
      if (mi && num(mi.target_hp_cur) != null && num(mi.target_hp_max) != null) return { text: fmtNum(mi.target_hp_cur) + ' / ' + fmtNum(mi.target_hp_max) + ' HP' };
      return m && num(m.hp) != null ? { text: fmtNum(m.hp) + ' HP' } : null;
    },
    { text: '24.4k HP' }, { short: 'HP' });
  P('target.dmg', 'target', 'How hard it hits', 'state', 'value',
    function (d) { var m = mob(d); return m && m.mindmg != null && m.maxdmg != null ? { text: m.mindmg + '–' + m.maxdmg, sub: 'dmg' } : null; },
    { text: '104–471', sub: 'dmg' }, { short: 'Hits' });
  P('target.ac', 'target', 'Target armour class', 'state', 'value',
    function (d) { var m = mob(d); return m && m.ac != null ? { text: String(m.ac), color: '#d2a8ff' } : null; },
    { text: '200', color: '#d2a8ff' }, { short: 'AC' });
  // The overlay's grid: AC, then each resist, green / orange / red by how hard it is to land on.
  function resistCol(v) { return v == null ? C.dim : v >= 150 ? C.red : v >= 75 ? C.orange : C.green; }
  P('target.statgrid', 'target', 'AC and resists (catalog)', 'state', 'list',
    function (d) {
      var m = mob(d); if (!m) return null; var r = m.resists || {};
      return { items: [{ name: 'AC', text: m.ac == null ? '?' : m.ac, color: '#d2a8ff' }].concat(RES.map(function (k) { return { name: k[1], text: r[k[0]] == null ? '?' : r[k[0]], color: resistCol(r[k[0]]) }; })) };
    },
    { items: [{ name: 'AC', text: 200, color: '#d2a8ff' }, { name: 'MR', text: 46, color: C.green }, { name: 'FR', text: 46, color: C.green }, { name: 'CR', text: 46, color: C.green }, { name: 'PR', text: 46, color: C.green }, { name: 'DR', text: 46, color: C.green }] },
    { short: 'Stats', mode: 'columns' });
  P('target.sight', 'target', 'Sees through invis or hide', 'state', 'list',
    function (d) {
      var m = mob(d); if (!m) return null; var it = [];
      if (m.undead) { if (m.see_invis_undead) it.push({ name: 'Sees Invis vs Undead', color: C.orange }); }
      else if (m.see_invis) it.push({ name: 'Sees Invis', color: C.orange });
      if (m.see_improved_hide) it.push({ name: 'Sees Improved Hide', color: C.orange });
      else if (m.see_hide) it.push({ name: 'Sees Hide', color: C.orange });
      return { items: it, empty: 'invis and hide work' };
    },
    { items: [{ name: 'Sees Invis', color: C.orange }] }, { short: 'Sight', mode: 'chips' });
  P('target.pqdi', 'target', 'PQDI link', 'state', 'value',
    function (d) { var m = mob(d); return m && m.id ? { text: '🔗 PQDI', url: 'https://www.pqdi.cc/npc/' + m.id, color: '#d2a8ff' } : null; },
    { text: '🔗 PQDI', color: '#d2a8ff' }, { short: 'PQDI' });
  // Drop rate buckets, as the Loot tab colours them: always > common > uncommon > rare.
  function lootCol(p) { return p == null ? C.dim : p >= 95 ? C.gold : p >= 35 ? C.green : p >= 10 ? C.blue : p >= 2 ? C.purple : C.dim; }
  function dropPct(p) { return p == null ? '?' : p >= 99.95 ? '100%' : p.toFixed(p < 10 ? 1 : 0) + '%'; }
  P('target.loot', 'target', 'What it drops', 'state', 'list',
    function (d) {
      var m = mob(d); if (!m) return null;
      return { items: (Array.isArray(m.loot) ? m.loot : []).filter(function (it) { return it && it.name; }).map(function (it) {
        var tags = [it.unique_to_mob ? '⭐ only this mob' : '', it.lore ? 'LORE' : '', +it.seen > 0 ? it.seen + '× won' : ''].filter(Boolean).join(' · ');
        return { name: it.name, text: dropPct(num(it.pct)), color: lootCol(num(it.pct)), sub: tags };
      }), empty: 'no drops on record' };
    },
    { items: [{ name: 'Guardian Helm', text: '12%', color: C.blue, sub: '⭐ only this mob · 3× won' }, { name: 'Words of Dimension', text: '4.5%', color: C.purple, sub: 'LORE' }] },
    { short: 'Drops' });
  var RESIST_NAME = { 1: 'Magic', 2: 'Fire', 3: 'Cold', 4: 'Poison', 5: 'Disease', 6: 'Chromatic', 7: 'Prismatic' };
  function castSecs(ms) { ms = num(ms); return ms == null ? '' : ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'; }
  P('target.spells', 'target', 'The spells it casts', 'state', 'list',
    function (d) {
      var m = mob(d); if (!m) return null;
      var sp = (Array.isArray(m.spells) ? m.spells : []).filter(Boolean).slice().sort(function (a, b) { return (a.good === 1) - (b.good === 1); });
      return { items: sp.map(function (s) {
        var res = s.good === 1 ? 'buff' : (RESIST_NAME[s.resist_type] || 'unresistable') + (num(s.resist_diff) ? ' ' + s.resist_diff : '');
        return { name: s.name || ('Spell #' + s.id), text: s.mana != null ? s.mana + 'm' : '', color: s.good === 1 ? C.green : C.purple,
          sub: [res, castSecs(s.cast_ms) ? 'cast ' + castSecs(s.cast_ms) : '', num(s.recast_ms) ? 'recast ' + Math.round(s.recast_ms / 1000) + 's' : ''].filter(Boolean).join(' · ') };
      }), empty: 'no spell list catalogued' };
    },
    { items: [{ name: 'Lava Breath', text: '150m', color: C.purple, sub: 'Fire · cast 3.0s · recast 30s' }, { name: 'Shield of Lava', text: '60m', color: C.green, sub: 'buff · cast 2.5s' }] },
    { short: 'Spells' });
  P('target.factions', 'target', 'Faction hits on kill', 'state', 'list',
    function (d) {
      var m = mob(d); if (!m) return null;
      return { items: (Array.isArray(m.factions) ? m.factions : []).map(function (f) { var up = Number(f.value) > 0; return { name: f.name, text: (up ? '+' : '') + f.value, color: up ? C.green : C.red }; }),
        empty: 'no faction change' };
    },
    { items: [{ name: 'Guardians of the Mischief', text: '-25', color: C.red }, { name: 'Tricksters', text: '+10', color: C.green }] },
    { short: 'Faction' });
  function names(list, n) { return (list || []).slice(0, n || 3).map(function (x) { return (x.qty > 1 ? x.qty + '× ' : '') + (x.name || x); }).join(', '); }
  P('target.quest', 'target', 'Quest: what to say, hand in, who next', 'npc', 'list',
    function (d) {
      if (d.loading) return { items: [], empty: 'reading the quest script…' };
      var n = d.npc; if (!n) return { items: [], empty: 'nothing on record for this NPC' };
      var it = [];
      (n.say || []).forEach(function (b) {
        var cmd = '/say ' + (b.say || (b.keywords && b.keywords[0]) || '');
        it.push({ name: cmd, copy: cmd, color: C.blue, sub: [b.sit ? 'sit first' : '', b.needs ? 'needs ' + names(b.needs) : '', b.gives ? 'get ' + (b.gives_random ? 'one of ' : '') + names(b.gives) : '', b.flag ? 'flag' : ''].filter(Boolean).join(' · ') });
      });
      (n.turnins || []).forEach(function (t) {
        it.push({ name: 'give ' + names(t.inputs, 4), text: '', color: C.gold,
          sub: 'get ' + ((t.outputs && t.outputs.length) ? (t.random ? 'one of ' : '') + names(t.outputs, 4) : 'nothing listed') + (t.exp ? ' · exp' : '') + (t.unverified ? ' · not in Quarm\'s script' : '') });
      });
      (n.next || []).forEach(function (x) {
        var map = x.y != null && x.x != null ? '/map ' + x.y + ' ' + x.x : null;
        it.push({ name: 'next: ' + x.name, copy: map, sub: x.zone_long || '', color: C.purple });
      });
      return { items: it, empty: n.script ? 'nothing to say to this NPC' : 'no quest script for this NPC' };
    },
    { items: [{ name: '/say unlock memories', copy: '/say unlock memories', color: C.blue, sub: 'sit first · get Memory Shard' }, { name: 'give Essence of Fire', color: C.gold, sub: 'get Symbol of the Planes · exp' }, { name: 'next: Kerasha', copy: '/map 120 -340', sub: 'Plane of Tranquility', color: C.purple }] },
    { short: 'Quest' });
  function coin(cp) {
    if (cp == null) return '';
    var p = Math.floor(cp / 1000), g = Math.floor(cp % 1000 / 100), s = Math.floor(cp % 100 / 10), c = cp % 10, out = [];
    if (p) out.push(p + 'p'); if (g) out.push(g + 'g'); if (s) out.push(s + 's'); if (c) out.push(c + 'c');
    return out.join(' ') || '0c';
  }
  P('target.vendor', 'target', 'What it sells', 'npc', 'list',
    function (d) { var n = d.npc; if (d.loading || !n) return null; return { items: (n.vendor || []).map(function (v) { return { name: v.name, text: coin(v.price) }; }), empty: 'not a vendor' }; },
    { items: [{ name: 'Bone Chips', text: '1s 2c' }, { name: 'Fishing Bait', text: '5c' }] }, { short: 'Sells' });

  // ── Group ──
  P('group.members', 'group', 'My group', 'me', 'list',
    function (d) { if (!d.character || !Array.isArray(d.group)) return null; return { items: d.group.map(function (g) { return { name: g.name + (g['class'] ? ' · ' + g['class'] : ''), pct: g.hp_pct, color: hpColor(g.hp_pct) }; }), empty: 'not grouped' }; },
    { items: [{ name: 'Brackwyn · Warrior', pct: 71, color: C.green }, { name: 'Corvale · Cleric', pct: 100, color: C.green }, { name: 'Rethlan · Rogue', pct: 22, color: C.red }] }, { short: 'Group' });
  [1, 2, 3, 4, 5].forEach(function (n) {
    P('group.m' + n, 'group', 'Group member ' + n, 'me', 'gauge',
      function (d) { var g = d.character && Array.isArray(d.group) && d.group[n - 1]; return g ? { pct: g.hp_pct, label: g.name, color: hpColor(g.hp_pct) } : null; },
      { pct: 100 - n * 13, label: ['Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'][n - 1], color: hpColor(100 - n * 13) }, { short: 'Member ' + n });
  });

  // ── Pet ──
  P('pet.hp', 'pet', 'My pet\'s health', 'me', 'gauge',
    function (d) { var p = d.character && d.pet; return p && num(p.hp_pct) != null ? { pct: p.hp_pct, label: p.name, color: hpColor(p.hp_pct) } : null; },
    { pct: 88, label: 'Gobaner', color: C.green }, { short: 'Pet' });
  P('pet.target', 'pet', 'What my pet is on', 'state', 'value',
    function (d) { var p = mine(d.petHealth, d); return p && p.target ? { text: '→ ' + p.target, sub: num(p.target_at) ? ago(Date.now() - p.target_at) : '' } : null; },
    { text: '→ a burning guardian', sub: '3s ago' }, { short: 'Pet target' });
  P('pet.buffs', 'pet', 'My pet\'s buffs', 'state', 'list',
    function (d) { var p = mine(d.petHealth, d); return p ? { items: buffRows(p.buffs), empty: 'no buffs seen' } : null; },
    { items: [{ name: 'Augmentation', text: '14:10', pct: 70, color: C.green }, { name: 'Tashanian', text: 'fell off', color: C.purple }] }, { short: 'Pet buffs' });
  P('pet.combat', 'pet', 'My pet\'s hits', 'state', 'value',
    function (d) { var p = mine(d.petHealth, d), s = p && p.stats; return s ? { text: 'max ' + fmtNum(s.max_hit) + ' · avg ' + fmtNum(s.avg_hit), sub: fmtNum(s.total_damage) + ' in ' + s.total_hits + ' hits' + (s.dual_wielding ? ' · dual' : '') } : null; },
    { text: 'max 88 · avg 41', sub: '3,210 in 78 hits' }, { short: 'Pet hits' });

  // ── Charm (the pet EQ has in front) ──
  function myCharm(d) { var c = mine(d.charmPets, d); return c; }
  P('charm.pet', 'charm', 'Charmed pet health', 'state', 'gauge',
    function (d) { var c = myCharm(d); return c ? { pct: c.pet_hp_pct, label: c.pet + (c.is_dire_charm ? ' (dire)' : ''), text: c.broke_at ? 'BROKE' : null, color: c.broke_at ? C.red : hpColor(c.pet_hp_pct) } : null; },
    { pct: 93, label: 'a goblin mystic', color: C.green }, { short: 'Charm' });
  P('charm.breaks', 'charm', 'Charm breaks in', 'state', 'countdown',
    function (d) { var c = myCharm(d); if (!c || !c.is_active || !num(c.started_at)) return null; var dur = (num(c.duration_sec) || 60) * 1000; return { endAt: c.started_at + dur, total: dur, label: 'Breaks' + (c.duration_sec ? '' : ' ~'), doneText: 'any moment' }; },
    function (now) { return { endAt: now + 41000, total: 90000, label: 'Breaks' }; }, { short: 'Breaks' });
  P('charm.uptime', 'charm', 'Charm up for', 'state', 'value',
    function (d) { var c = myCharm(d); if (!c || !num(c.started_at)) return null; var up = Date.now() - c.started_at; return { text: 'up ' + mmss(up), sub: 'tick ' + Math.floor(up / 6000) + (c.duration_sec ? '/' + Math.round(c.duration_sec / 6) : ''), color: up > 54000 ? C.red : C.text }; },
    { text: 'up 0:48', sub: 'tick 8/15' }, { short: 'Up' });
  P('charm.servertick', 'charm', 'Server tick (charm)', 'state', 'countdown',
    function (d) { var c = myCharm(d); return c && num(c.server_tick_at) ? { endAt: c.server_tick_at, period: 6000, label: 'Server tick' } : null; },
    function (now) { return { endAt: now + 2100, period: 6000, label: 'Server tick' }; }, { short: 'Server' });
  P('charm.mobtick', 'charm', 'The mob\'s own tick', 'state', 'countdown',
    function (d) { var c = myCharm(d); return c && num(c.mob_tick_at) ? { endAt: c.mob_tick_at, period: 6000, label: 'Mob tick' + (c.mob_tick_half_ms > 350 ? ' ~' : ''), color: C.orange } : null; },
    function (now) { return { endAt: now + 4400, period: 6000, label: 'Mob tick', color: C.orange }; }, { short: 'Mob tick' });
  P('charm.buffs', 'charm', 'Charmed pet buffs', 'state', 'list',
    function (d) { var c = myCharm(d); return c ? { items: buffRows(c.pet_buffs), empty: 'no buffs seen' } : null; },
    { items: [{ name: 'Tashanian', text: '1:10', pct: 40, color: C.red }] }, { short: 'Charm buffs' });
  P('charm.all', 'charm', 'Every charmed pet', 'state', 'list',
    function (d) { var cs = d.charmPets; if (!Array.isArray(cs)) return null; return { items: cs.map(function (c) { return { name: c.pet + ' (' + c.owner + ')', pct: c.pet_hp_pct, text: c.broke_at ? 'broke' : null, color: c.broke_at ? C.red : hpColor(c.pet_hp_pct) }; }), empty: 'no charms' }; },
    { items: [{ name: 'a goblin mystic (Aldenmar)', pct: 93, color: C.green }] }, { short: 'Charms' });

  // ── Fight (/api/state.currentEncounterThreat) ──
  function fightRows(d, field, withPets) {
    var f = d.currentEncounterThreat; if (!f || !f.perPlayer) return null;
    var me = low(d.activeCharacter), rows = [], sum = 0;
    Object.keys(f.perPlayer).forEach(function (k) {
      var r = f.perPlayer[k]; if (!withPets && r.pet_owner) return;
      var v = num(r[field]) || 0; if (v <= 0 && field !== 'total') return;
      rows.push({ name: k, v: v }); sum += Math.max(0, v);
    });
    rows.sort(function (a, b) { return b.v - a.v; });
    var secs = Math.max(1, ((num(f.flushedAt) || Date.now()) - Date.parse(f.startedAt)) / 1000);
    var top = rows.length ? Math.max(rows[0].v, 1) : 1;
    return { items: rows.slice(0, 12).map(function (r, i) { return { name: (i + 1) + '. ' + r.name, text: fmtNum(r.v) + (field === 'dmg' ? ' · ' + fmtNum(r.v / secs) : ''),
      pct: (r.v / top) * 100, hi: low(r.name) === me, color: field === 'took' ? C.red : field === 'total' ? C.orange : C.gold }; }), empty: 'no fight' };
  }
  var FIGHT_SAMPLE = { items: [{ name: '1. Rethlan', text: '14k · 312', pct: 100, color: C.gold }, { name: '2. Aldenmar', text: '9.8k · 214', pct: 70, hi: true, color: C.gold }, { name: '3. Zarrin', text: '6.1k · 133', pct: 44, color: C.gold }] };
  P('fight.name', 'fight', 'Fight: mob and time', 'state', 'value',
    function (d) { var f = d.currentEncounterThreat; if (!f) return null; var secs = ((num(f.flushedAt) || Date.now()) - Date.parse(f.startedAt)) / 1000; return { text: f.bossName || f.targetName || 'fight', sub: mmss(secs * 1000) + (f.flushedAt ? ' · ended' : '') }; },
    { text: 'a burning guardian', sub: '0:46' }, { short: 'Fight' });
  P('fight.dps', 'fight', 'Damage meter', 'state', 'list', function (d) { return fightRows(d, 'dmg'); }, FIGHT_SAMPLE, { short: 'Damage' });
  P('fight.took', 'fight', 'Damage taken', 'state', 'list', function (d) { return fightRows(d, 'took'); },
    { items: [{ name: '1. Brackwyn', text: '8.2k', pct: 100, color: C.red }] }, { short: 'Taken' });
  P('fight.threat', 'fight', 'Threat', 'state', 'list', function (d) { return fightRows(d, 'total'); },
    { items: [{ name: '1. Brackwyn', text: '22k', pct: 100, color: C.orange }, { name: '2. Rethlan', text: '15k', pct: 68, color: C.orange }] }, { short: 'Threat' });
  P('fight.mine', 'fight', 'My place in the damage', 'state', 'value',
    function (d) { var r = fightRows(d, 'dmg'); if (!r) return null; for (var i = 0; i < r.items.length; i++) if (r.items[i].hi) return { text: '#' + (i + 1), sub: r.items[i].text, color: C.gold }; return null; },
    { text: '#2', sub: '9.8k · 214', color: C.gold }, { short: 'My rank' });
  P('fight.history', 'fight', 'Recent fights', 'state', 'list',
    function (d) { var h = d.fightHistory; if (!Array.isArray(h)) return null; return { items: h.map(function (f) { return { name: f.boss || 'fight', text: fmtNum(f.total) + ' · ' + mmss((f.durationSec || 0) * 1000) }; }), empty: 'no fights yet' }; },
    { items: [{ name: 'a burning guardian', text: '41k · 0:46' }, { name: 'a lava elemental', text: '63k · 1:12' }] }, { short: 'History' });

  // ── Main tank (/api/tank-state) ──
  P('tank.mt', 'tank', 'Main tank health', 'tank', 'gauge',
    function (d) { var m = d.mt; if (!m || num(m.hp_pct) == null) return null; return { pct: m.hp_pct, label: 'MT ' + m.name, text: curMax({ pct: m.hp_pct, cur: m.hp_cur, max: m.hp_max }, 500), color: hpColor(m.hp_pct) }; },
    { pct: 64, label: 'MT Brackwyn', text: '5,120 / 8,000', color: C.orange }, { short: 'MT' });
  P('tank.mtbuffs', 'tank', 'Main tank buffs', 'tank', 'list',
    function (d) { var m = d.mt; if (!m || !Array.isArray(m.buffs)) return null; return { items: m.buffs.slice().sort(function (a, b) { return (num(a.seconds) == null ? 1e9 : a.seconds) - (num(b.seconds) == null ? 1e9 : b.seconds); }).slice(0, 8).map(function (b) { return { name: b.name, text: b.fell_off ? 'fell off' : secsText(b.seconds), color: b.fell_off ? C.purple : num(b.seconds) != null && b.seconds <= 12 ? C.red : num(b.seconds) != null && b.seconds <= 60 ? C.orange : C.green }; }), empty: 'no buffs' }; },
    { items: [{ name: 'Aegolism', text: '0:48', color: C.orange }, { name: 'Brell\'s Stalwart Shield', text: '12:30', color: C.green }] }, { short: 'MT buffs' });
  P('tank.heals', 'tank', 'Heals landing on the tank', 'tank', 'list',
    function (d, at) { var h = d.inbound_heals; if (!Array.isArray(h)) return null; return { items: h.map(function (x) { var l = num(x.lands_in_ms); if (l != null) l -= Date.now() - at; return { name: x.caster + ' · ' + x.spell, text: l == null ? '' : l <= 0 ? 'landed' : (l / 1000).toFixed(1) + 's', pct: (l != null && x.cast_secs) ? 100 - (l / (x.cast_secs * 1000)) * 100 : null, color: C.green }; }), empty: 'no heals in flight' }; },
    { items: [{ name: 'Corvale · Remedy', text: '1.2s', pct: 60, color: C.green }] }, { short: 'Heals in' });
  P('tank.da', 'tank', 'Divine Aura', 'tank', 'countdown',
    function (d, at) { var a = d.da; return a && num(a.seconds) != null ? { endAt: at + a.seconds * 1000, total: 18000, label: a.name || 'Divine Aura', sub: a.critical && a.ramp_target ? 'start CH on ' + a.ramp_target : '', color: a.critical ? C.red : C.gold } : null; },
    function (now) { return { endAt: now + 9000, total: 18000, label: 'Divine Aura', color: C.gold }; }, { short: 'DA' });
  P('tank.dt', 'tank', 'Death Touch', 'tank', 'countdown',
    function (d, at) { var t = d.deathtouch; return t && num(t.seconds) != null ? { endAt: at + t.seconds * 1000, total: Math.max(t.seconds * 1000, 45000), label: 'Death Touch' + (t.target ? ' → ' + t.target : ''), color: t.critical ? C.red : C.orange } : null; },
    function (now) { return { endAt: now + 21000, total: 45000, label: 'Death Touch → Brackwyn', color: C.orange }; }, { short: 'DT' });
  P('tank.rampage', 'tank', 'Rampage target', 'tank', 'gauge',
    function (d) { var r = d.rampage; if (!r || !r.target) return null; return { pct: r.hp_pct, label: 'Rampage → ' + r.target, text: r.da && num(r.da.seconds) != null ? 'INV ' + Math.ceil(r.da.seconds) + 's' : null, color: r.da ? (r.da.critical ? C.green : C.gold) : hpColor(r.hp_pct) }; },
    { pct: 55, label: 'Rampage → Rethlan', color: C.orange }, { short: 'Rampage' });
  P('tank.enrage', 'tank', 'Boss enrage', 'tank', 'value',
    function (d) { var e = d.enrage; if (!e || !e.enrages) return null; var hp = num(e.target_hp_pct); return { text: 'enrage at ' + e.threshold_pct + '%', sub: hp != null ? Math.round(hp) + '% now' : '', color: hp != null && hp <= e.threshold_pct + 2 ? C.red : hp != null && hp <= e.warn_pct ? C.orange : C.dim }; },
    { text: 'enrage at 8%', sub: '23% now', color: C.dim }, { short: 'Enrage' });
  P('tank.target', 'tank', 'Raid\'s main target', 'tank', 'gauge',
    function (d) { var t = d.target; return t && t.name ? { pct: t.hp_pct, label: t.name, color: hpColor(t.hp_pct) } : null; },
    { pct: 37, label: 'a burning guardian', color: C.orange }, { short: 'Main target' });
  P('tank.ds', 'tank', 'Damage shield on the tank', 'tank', 'value',
    function (d) { var s = (d.mt && d.mt.ds) || d.ds; return s && num(s.total) ? { text: fmtNum(s.total), sub: '~' + fmtNum(s.avg_per_hit) + ' a hit · ' + s.hits + ' hits' } : null; },
    { text: '2,480', sub: '~34 a hit · 73 hits' }, { short: 'DS' });
  P('tank.offtanks', 'tank', 'Off-tanks taking hits', 'tank', 'list',
    function (d) { var o = d.off_heal_candidates; if (!Array.isArray(o)) return null; return { items: o.map(function (x) { return { name: x.name + ' ← ' + x.mob, pct: x.hp_pct, color: hpColor(x.hp_pct) }; }), empty: 'none' }; },
    { items: [{ name: 'Nyssara ← a lava elemental', pct: 48, color: C.orange }] }, { short: 'Off-tanks' });

  // ── Healing ──
  P('heal.chdue', 'heal', 'Next Complete Heal due', 'tank', 'countdown',
    function (d, at) { var c = d.ch_chain; return c && num(c.due_in_ms) != null ? { endAt: at + c.due_in_ms, total: num(c.beat_ms) || 10000, label: 'CH due on ' + c.target, color: c.urgency === 'red' ? C.red : c.urgency === 'yellow' ? C.orange : C.green } : null; },
    function (now) { return { endAt: now + 3200, total: 6000, label: 'CH due on Brackwyn', color: C.green }; }, { short: 'CH due' });
  P('heal.mana', 'heal', 'Healer mana', 'cmd', 'list',
    function (d) { var h = d.healer_mana; if (!Array.isArray(h)) return null; return { items: h.map(function (x) { return { name: x.name + (x['class'] ? ' · ' + x['class'] : ''), pct: x.pct, color: x.pct < 20 ? C.red : x.pct < 40 ? C.orange : C.blue }; }), empty: 'no healers heard' }; },
    { items: [{ name: 'Corvale · Cleric', pct: 34, color: C.orange }, { name: 'Nyssara · Druid', pct: 71, color: C.blue }] }, { short: 'Healer mana' });
  P('heal.di', 'heal', 'Divine Intervention ready', 'cmd', 'list',
    function (d) { var c = d.di && d.di.clerics; if (!Array.isArray(c)) return null; return { items: c.map(function (x) { return { name: x.name, text: x.unknown ? '?' : x.up ? 'up' : secsText(x.seconds), color: x.unknown ? C.dim : x.up ? C.green : C.orange }; }), empty: 'no clerics' }; },
    { items: [{ name: 'Corvale', text: 'up', color: C.green }, { name: 'Rethlan', text: '4:12', color: C.orange }] }, { short: 'DI', mode: 'chips' });
  P('heal.chain', 'heal', 'CH chain slots', 'state', 'list',
    function (d) { var c = d.chChain; if (!c || !c.slots) return null; return { items: Object.keys(c.slots).sort(function (a, b) { return a - b; }).map(function (k) { var s = c.slots[k]; return { name: k + ' ' + s.name, text: s.mana != null ? s.mana + '%' : '', hi: String(c.next_num) === String(k), color: C.blue }; }), empty: 'no chain' }; },
    { items: [{ name: '1 Corvale', text: '52%' }, { name: '2 Nyssara', text: '80%', hi: true }] }, { short: 'CH chain' });
  P('heal.chnext', 'heal', 'Next in the CH chain', 'state', 'value',
    function (d) { var c = d.chChain; if (!c || !c.slots) return null; var s = c.slots[String(c.next_num)]; return s ? { text: 'NEXT ' + c.next_num + ' ' + s.name, sub: c.order_conflict ? 'ORDER CONFLICT' : '', color: c.order_conflict ? C.red : C.gold } : null; },
    { text: 'NEXT 2 Nyssara', color: C.gold }, { short: 'Next CH' });

  // ── Raid ──
  P('raid.targets', 'raid', 'Extended target list', 'ext', 'list',
    function (d) { var t = d.targets; if (!Array.isArray(t)) return null; return { items: t.slice(0, 12).map(function (x) { return { name: (x.is_named ? '★ ' : '') + x.name + (x.raider_count ? ' (' + x.raider_count + ')' : ''), pct: x.hp_pct, color: hpColor(x.hp_pct), sub: x.mob_victim ? '→ ' + x.mob_victim : '' }; }), empty: 'no targets' }; },
    { items: [{ name: '★ a burning guardian (14)', pct: 37, color: C.orange, sub: '→ Brackwyn' }, { name: 'a lava elemental (2)', pct: 90, color: C.green }] }, { short: 'Targets' });
  P('raid.online', 'raid', 'Raiders online', 'ext', 'value',
    function (d) { return num(d.online) != null ? { text: String(d.online), sub: d.scope === 'group' ? 'in group' : 'online' } : null; },
    { text: '38', sub: 'online' }, { short: 'Online' });
  P('raid.offtanked', 'raid', 'Mobs off-tanked', 'ext', 'value',
    function (d) { return num(d.off_tank_count) != null ? { text: String(d.off_tank_count), sub: 'off-tanked', color: d.off_tank_count ? C.orange : C.dim } : null; },
    { text: '2', sub: 'off-tanked', color: C.orange }, { short: 'Off-tanked' });
  P('raid.debuffq', 'raid', 'Cure queue', 'bq', 'list',
    function (d) { var q = d.debuff_queue; if (!Array.isArray(q)) return null; return { items: q.slice(0, 10).map(function (x) { var c = (x.curses || [])[0]; return { name: x.name + (x.group ? ' · G' + x.group : ''), text: c ? c.name + (c.counters ? ' ' + c.counters : '') : '', color: c && c.being_cured ? C.green : C.red }; }), empty: 'nobody needs a cure' }; },
    { items: [{ name: 'Rethlan · G3', text: 'Gravel Rain 12', color: C.red }] }, { short: 'Cures' });
  P('raid.buffq', 'raid', 'Buff queue', 'bq', 'list',
    function (d) { var q = d.buff_queue; if (!Array.isArray(q)) return null; return { items: q.slice(0, 10).map(function (x) { return { name: x.name + (x.group ? ' · G' + x.group : ''), text: (x.missing || []).join(', '), color: x.tier === 'red' ? C.red : x.tier === 'orange' ? C.orange : C.gold }; }), empty: 'everyone is buffed' }; },
    { items: [{ name: 'Zarrin · G5', text: 'haste', color: C.orange }] }, { short: 'Buffs' });
  P('raid.burst', 'raid', 'Burst queue (Feral Avatar / Savagery)', 'bq', 'list',
    function (d) { var q = d.feral_queue || d.savagery_queue; if (!Array.isArray(q)) return null; return { items: q.slice(0, 8).map(function (x) { return { name: x.name, text: x.carrying ? secsText(x.remaining_secs) : 'needs it', color: x.carrying ? C.green : C.orange }; }), empty: 'none' }; },
    { items: [{ name: 'Rethlan', text: 'needs it', color: C.orange }] }, { short: 'Burst' });
  P('raid.rez', 'raid', 'Needs a rez', 'cmd', 'list',
    function (d) { var r = d.needs_rez; if (!Array.isArray(r)) return null; return { items: r.map(function (x) { return { name: x.name, text: x.state === 'incoming' ? 'rez coming' + (x.rezzer ? ' (' + x.rezzer + ')' : '') : x.state === 'rezzed' ? 'rezzed' : (num(x.dead_ms) ? Math.floor(x.dead_ms / 60000) + 'm' : 'dead'), color: x.state === 'needs' ? C.red : C.green }; }), empty: 'nobody dead' }; },
    { items: [{ name: 'Zarrin', text: '3m', color: C.red }] }, { short: 'Rez' });
  P('raid.defensives', 'raid', 'Defensives (DA, invuln)', 'cmd', 'list',
    function (d) { var a = d.da_broadcasts; if (!Array.isArray(a)) return null; return { items: a.map(function (x) { return { name: x.name + ' ' + x.kind, text: x.state === 'up' ? 'UP ' + secsText(x.seconds) : 'down ' + secsText(x.cooldown_secs), color: x.state === 'up' ? C.green : C.dim }; }), empty: 'none called' }; },
    { items: [{ name: 'Brackwyn DA', text: 'UP 0:12', color: C.green }] }, { short: 'Defensives' });
  P('raid.rolls', 'raid', 'Rolls', 'cmd', 'list',
    function (d) { var r = d.rolls; if (!Array.isArray(r)) return null; return { items: r.slice(0, 6).map(function (x) { var w = (x.winners || [])[0]; return { name: (x.item || ('1–' + x.to)) + ' · ' + x.players + ' rolled', text: w ? w.name + ' ' + w.value : (x.open ? 'open' : ''), color: C.gold }; }), empty: 'no rolls' }; },
    { items: [{ name: 'Cloak of Flames · 6 rolled', text: 'Nyssara 912', color: C.gold }] }, { short: 'Rolls' });
  P('raid.cures', 'raid', 'Curses on raiders', 'cmd', 'list',
    function (d) { var c = d.cures; if (!Array.isArray(c)) return null; return { items: c.map(function (x) { return { name: x.name, text: (x.curses || []).map(function (k) { return k.cure + (k.counters ? ' ' + k.counters : ''); }).join(', '), color: x.all_being_cured ? C.green : C.red }; }), empty: 'no curses' }; },
    { items: [{ name: 'Rethlan', text: 'curse 12', color: C.red }] }, { short: 'Curses' });

  // ── Zone (/who) ──
  function whoRows(list) { return (Array.isArray(list) ? list : []).slice(0, 30).map(function (w) { return { name: w.name + (w.guild ? ' <' + w.guild + '>' : ''), text: w.anonymous ? 'anon' : ((w.level || '') + ' ' + (w['class'] || '')).trim(), color: w.zek ? C.red : C.text }; }); }
  P('zone.who', 'zone', 'Who is in the zone', 'state', 'list',
    function (d) { var w = d.whoSnapshot; return w ? { items: whoRows(w.current), empty: 'type /who' } : null; },
    { items: [{ name: 'Brackwyn <Wolf Pack>', text: '60 Warrior' }, { name: 'Zarrin <Wolf Pack>', text: '60 Shaman' }] }, { short: '/who' });
  P('zone.count', 'zone', 'How many in the zone', 'state', 'value',
    function (d) { var w = d.whoSnapshot; return w && Array.isArray(w.current) ? { text: String(w.current.length), sub: num(w.capturedAt) ? 'as of ' + ago(Date.now() - w.capturedAt) : '' } : null; },
    { text: '42', sub: 'as of 2m ago' }, { short: 'In zone' });
  P('zone.gone', 'zone', 'Recently left the zone', 'state', 'list',
    function (d) { var w = d.whoSnapshot; return w ? { items: whoRows(w.recentGone), empty: 'nobody' } : null; },
    { items: [{ name: 'Corvale <Wolf Pack>', text: '60 Cleric' }] }, { short: 'Gone' });
  P('zone.target', 'zone', 'Targeted player\'s guild', 'state', 'value',
    function (d) { var t = d.whoSnapshot && d.whoSnapshot.target; return t ? { text: t.name + (t.guild ? ' <' + t.guild + '>' : ''), sub: [t.level, t['class']].filter(Boolean).join(' '), color: t.zek ? C.red : C.text } : null; },
    { text: 'Zarrin <Wolf Pack>', sub: '60 Shaman' }, { short: 'Who target' });

  // ── Casting (bard melody + cast counts) ──
  function myMelody(d) { var m = d.bardMelody; return m ? m[low(d.activeCharacter)] || null : null; }
  P('cast.now', 'casting', 'Casting now', 'state', 'value',
    function (d) { var m = myMelody(d); return m && m.nowCasting ? { text: m.nowCasting, sub: m.kind === 'song' ? 'singing' : 'casting', color: C.blue } : null; },
    { text: 'Selo\'s Accelerating Chorus', sub: 'singing', color: C.blue }, { short: 'Now' });
  P('cast.melody', 'casting', 'Melody twist', 'state', 'list',
    function (d) { var m = myMelody(d); if (!m || !Array.isArray(m.order)) return null; return { items: m.order.map(function (s, i) { return { name: (i === m.currentPos ? '▶ ' : '') + s.name, text: s.remaining_secs != null ? secsText(s.remaining_secs) : '', hi: i === m.currentPos }; }), empty: 'no melody' }; },
    { items: [{ name: '▶ Selo\'s Accelerating Chorus', text: '2:10', hi: true }, { name: 'Psalm of Veeshan', text: '0:36' }] }, { short: 'Melody' });
  [['accelerating_chorus', 'Selo\'s'], ['amplification', 'Amplification'], ['nivs', 'Niv\'s'], ['harmonize', 'Harmonize']].forEach(function (b) {
    P('cast.' + b[0], 'casting', b[1] + ' remaining', 'state', 'countdown',
      function (d, at) { var m = myMelody(d), x = m && m.bardBuffs && m.bardBuffs[b[0]]; return x && num(x.remaining_secs) != null ? { endAt: at + x.remaining_secs * 1000, total: Math.max(x.remaining_secs * 1000, 180000), label: b[1] } : null; },
      function (now) { return { endAt: now + 95000, total: 180000, label: b[1] }; }, { short: b[1] });
  });
  P('cast.counts', 'casting', 'How many times I cast each', 'state', 'list',
    function (d) { var c = d.castCounts && d.castCounts[d.activeCharacter]; if (!c) return null; return { items: Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 10).map(function (k) { return { name: k, text: '×' + c[k] }; }), empty: 'no casts' }; },
    { items: [{ name: 'Tashanian', text: '×14' }, { name: 'Entrancing Lights', text: '×9' }] }, { short: 'Casts' });

  var byId = {};
  PARTS.forEach(function (p) { byId[p.id] = p; });

  // ── Today's overlays, as groups of pieces ──────────────────────────────────
  // Each lays its pieces top to bottom: [piece, mode, height?, width?].
  function stack(list, width) {
    var y = 0;
    return list.map(function (e) {
      var sz = DEFAULT_SIZE[e[1]] || [220, 30], w = e[3] || width || sz[0], h = e[2] || sz[1];
      var row = [e[0], e[1], 0, y, w, h];
      y += h + 4;
      return row;
    });
  }
  // A second column: the same rows moved dx to the right.
  function beside(rows, dx) { return rows.map(function (r) { return [r[0], r[1], r[2] + dx, r[3], r[4], r[5]]; }); }
  // `embed` names the overlay (its key in main's canvas catalog) a preset IS: choosing it puts that overlay's own
  // page on the canvas instead of laying out `parts` (the guild lead, 2026-10-03: "when I look at an overlay
  // outside of the canvas or choose it as a preset within the canvas they should be extremely close to being
  // identical" — the stacked pieces never were). `style` is the look of a page that has two (the HUD: 'hud' the
  // ring, 'a' the box). `parts` stays: the chooser's "as pieces" lays it out, and a preset with no `embed`
  // (no overlay of its own) is only ever pieces.
  var PRESETS = [
    // The ring first: it is the HUD (the guild lead, 2026-10-03: "we also should have the default HUD circle
    // view in canvas"); the six dials are what "as pieces" gives.
    { id: 'hud-ring', name: 'HUD (ring)', embed: 'me', style: 'hud', parts: [['me.hp', 'ring', 0, 0, 96, 96], ['me.mana', 'ring', 100, 0, 96, 96], ['target.hp', 'ring', 200, 0, 96, 96],
      ['tick.server', 'ring', 0, 100, 96, 96], ['tick.swing', 'ring', 100, 100, 96, 96], ['me.cast', 'ring', 200, 100, 96, 96],
      ['target.tot', 'readout', 0, 200, 296, 22], ['target.slow', 'readout', 0, 224, 296, 22], ['me.cooldowns', 'chips', 0, 248, 296, 48]] },
    { id: 'hud-box', name: 'HUD (box)', embed: 'me', style: 'a', parts: stack([['me.name', 'readout'], ['me.hp', 'bar'], ['me.mana', 'bar'], ['me.end', 'bar'], ['me.xp', 'bar'], ['me.aa', 'bar'],
      ['me.cast', 'bar'], ['target.name', 'readout'], ['target.hp', 'bar'], ['pet.hp', 'bar'], ['group.members', 'rows', 110], ['me.gems', 'rows', 150]], 240) },
    { id: 'tank', name: 'Tank', embed: 'tank', parts: stack([['tank.mt', 'bar'], ['tank.heals', 'rows', 80], ['tank.da', 'bar'], ['tank.target', 'bar'], ['tank.enrage', 'readout'],
      ['tank.dt', 'bar'], ['tank.rampage', 'bar'], ['heal.chdue', 'bar'], ['tank.ds', 'readout'], ['tank.mtbuffs', 'rows', 130], ['tank.offtanks', 'rows', 70]], 260) },
    { id: 'command', name: 'Command Center', embed: 'command', parts: stack([['tank.target', 'bar'], ['tank.enrage', 'readout'], ['tank.dt', 'bar'], ['tank.mt', 'bar'], ['tank.rampage', 'bar'],
      ['raid.defensives', 'rows', 70], ['me.cd_disc', 'bar'], ['heal.mana', 'rows', 110], ['heal.di', 'chips'], ['raid.rolls', 'rows', 80], ['raid.cures', 'rows', 70], ['raid.rez', 'rows', 70]], 260) },
    // Target Info as the overlay has it: the Stats tab down the left, its Loot, Spells and F/Q/V
    // tabs down the right.
    { id: 'target', name: 'Target Info', embed: 'mobinfo', parts: stack([['target.name', 'readout'], ['target.level', 'readout'], ['target.pqdi', 'readout'], ['target.hpmax', 'readout'],
      ['target.dmg', 'readout'], ['target.hp', 'bar'], ['target.statgrid', 'columns', 58], ['target.specials', 'chips', 92], ['target.sight', 'chips', 24], ['target.flags', 'chips'],
      ['target.ht', 'readout'], ['target.slow', 'readout'], ['target.mana', 'bar'], ['target.lastcast', 'readout'], ['target.tot', 'readout'],
      ['target.casting', 'rows', 60], ['target.debuffs', 'rows', 100], ['target.buffs', 'rows', 70]], 260)
      .concat(beside(stack([['target.loot', 'rows', 170], ['target.spells', 'rows', 170], ['target.factions', 'rows', 90], ['target.quest', 'rows', 170], ['target.vendor', 'rows', 90]], 280), 268)) },
    { id: 'target-tabs', name: 'Target: drops, spells, F/Q/V', parts: stack([['target.loot', 'rows', 170], ['target.spells', 'rows', 170],
      ['target.factions', 'rows', 90], ['target.quest', 'rows', 170], ['target.vendor', 'rows', 90]], 280) },
    { id: 'charm', name: 'Charm', embed: 'charm', parts: stack([['charm.pet', 'bar'], ['charm.uptime', 'readout'], ['charm.breaks', 'bar'], ['charm.servertick', 'bar'], ['charm.mobtick', 'bar'], ['charm.buffs', 'rows', 90]], 240) },
    { id: 'pets', name: 'Pets', embed: 'pets', parts: stack([['pet.hp', 'bar'], ['pet.target', 'readout'], ['pet.combat', 'readout'], ['pet.buffs', 'rows', 100]], 240) },
    { id: 'dps', name: 'DPS HUD', embed: 'hud', parts: stack([['fight.name', 'readout'], ['fight.dps', 'rows', 200], ['fight.mine', 'readout']], 280) },
    { id: 'threat', name: 'Threat meter', embed: 'threat', parts: stack([['fight.name', 'readout'], ['fight.threat', 'rows', 200]], 280) },
    { id: 'group', name: 'Group', parts: stack([['group.m1', 'bar'], ['group.m2', 'bar'], ['group.m3', 'bar'], ['group.m4', 'bar'], ['group.m5', 'bar'], ['pet.hp', 'bar']], 220) },
    { id: 'tick', name: 'Tick', embed: 'zeal', parts: stack([['tick.server', 'bar'], ['charm.mobtick', 'bar'], ['tick.zeal', 'readout'], ['tick.clock', 'readout']], 220) },
    { id: 'exttarget', name: 'Extended Target', embed: 'exttarget', parts: stack([['raid.online', 'readout'], ['raid.offtanked', 'readout'], ['raid.targets', 'rows', 240]], 280) },
    { id: 'buffq', name: 'Buff queue', embed: 'buffQueue', parts: stack([['raid.debuffq', 'rows', 120], ['raid.buffq', 'rows', 140], ['raid.burst', 'rows', 70]], 280) },
    { id: 'who', name: '/who', embed: 'who', parts: stack([['zone.target', 'readout'], ['zone.count', 'readout'], ['zone.who', 'rows', 220], ['zone.gone', 'rows', 90]], 280) },
    { id: 'melody', name: 'Melody', embed: 'melody', parts: stack([['cast.now', 'readout'], ['cast.melody', 'rows', 110], ['cast.accelerating_chorus', 'bar'], ['cast.amplification', 'bar'], ['cast.counts', 'rows', 90]], 260) },
    { id: 'chchain', name: 'CH chain', embed: 'chchain', parts: stack([['heal.chnext', 'readout'], ['heal.chdue', 'bar'], ['heal.chain', 'rows', 130], ['heal.di', 'chips']], 260) },
    { id: 'timers', name: 'Timers', parts: stack([['tick.server', 'bar'], ['timers.all', 'rows', 200]], 280) },
  ];

  root.WpParts = {
    C: C, CATS: CATS, MODES: MODES, DEFAULT_SIZE: DEFAULT_SIZE, CSS: CSS, THICK: THICK, ALIGN: ALIGN, PALETTE: PALETTE,
    render: render, resolve: resolve,
    util: { esc: esc, num: num, pct: pct, hpColor: hpColor, mmss: mmss, fmtNum: fmtNum, pctOf: pctOf, at: at },
    SOURCES: SOURCES, PARTS: PARTS, byId: byId, PRESETS: PRESETS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
