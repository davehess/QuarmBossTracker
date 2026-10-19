// petsheet.js — the #petstats sheet, folded out of a Pet or Charm row.
//
// The guild lead, 2026-10-19, picked B for DECISIONS §63 ("a fold-out sheet"): click a pet row on the Pet
// overlay (pets.html) or the Charm overlay (charm.html) and the whole sheet the agent parsed from the server's
// #petstats block opens under it: HP, AC, ATK, damage, delay with the observed haste, melee DPS, the five
// resists (signed: a Tashed charm pet reads a negative MR) and the 21 equipment slots. Click again to fold it.
//
// Shared by both overlays so the sheet reads the same in each. Three things live here, none of them touching
// the DOM except the one <style> tag:
//   • the open/closed store, keyed by pet (owner|pet) — both overlays repaint their list with innerHTML every
//     poll, so open state kept in the markup would be lost on the next tick (the dashboard's wpKeep does the
//     same job for <details>);
//   • rowAttrs() — what the clickable row needs. data-wp-interact is NOT optional: a locked overlay is
//     click-through, and the preload's hover handshake only arms buttons, links and [data-wp-interact], so a
//     bare <div> click lands on EverQuest instead ("the button does nothing");
//   • sheetHtml() — the sheet itself, as a string.
// The agent's shape (applyPetSheetLine): { pet, read_at, hp, hp_max, ac, atk, dmg_min, dmg_max, dmg_avg,
// delay_ms, base_delay_ms, haste_pct, dps, resists:{magic,fire,cold,poison,disease}, equipment:{slot:item|null},
// complete }. Any field can be null (a block cut short is published from its first stat line on).
(function (root) {
  var SLOTS = ['Ear 1', 'Head', 'Face', 'Ear 2', 'Neck', 'Shoulders', 'Arms', 'Back',
    'Wrist 1', 'Wrist 2', 'Range', 'Hands', 'Primary', 'Secondary', 'Finger 1', 'Finger 2',
    'Chest', 'Legs', 'Feet', 'Waist', 'Ammo'];
  var RESISTS = [['magic', 'MR', 'Magic'], ['fire', 'FR', 'Fire'], ['cold', 'CR', 'Cold'],
    ['poison', 'PR', 'Poison'], ['disease', 'DR', 'Disease']];

  var CSS = '.ps{margin-top:5px;padding:4px 5px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);'
    + 'border-radius:4px;font-size:10px;line-height:1.35;color:#c9d1d9;font-variant-numeric:tabular-nums;text-shadow:0 1px 2px #000;cursor:default}'
    + '.ps .ps-h{display:flex;justify-content:space-between;gap:6px;color:#8b949e;font-size:9px;margin-bottom:2px}'
    + '.ps .ps-l{display:flex;flex-wrap:wrap;gap:1px 9px}'
    + '.ps b{color:#7ee787;font-weight:700}'
    + '.ps .neg b{color:#f85149}'
    + '.ps .ps-hs b{color:#f0b429}'
    + '.ps .ps-eq{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 8px;margin-top:3px;'
    + 'padding-top:3px;border-top:1px solid rgba(255,255,255,0.08)}'
    + '.ps .ps-s{display:flex;gap:4px;min-width:0;white-space:nowrap}'
    + '.ps .ps-sn{color:#6e7681;flex-shrink:0}'
    + '.ps .ps-it{overflow:hidden;text-overflow:ellipsis;min-width:0}'
    + '.ps .ps-s.none .ps-it{color:#484f58}'
    + '[data-sheet]{cursor:pointer}'
    + '[data-sheet] .ps-chev{display:inline-block;width:10px;color:#8b949e;font-size:9px}';

  // Open state, by pet. Memory only: it survives the repaints, which is the ask.
  var open = {};
  function key(owner, pet) { return String(owner == null ? '' : owner).toLowerCase() + '|' + String(pet == null ? '' : pet).toLowerCase(); }
  function isOpen(k) { return open[k] === true; }
  function toggle(k) { if (open[k]) delete open[k]; else open[k] = true; return open[k] === true; }
  function reset() { open = {}; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  // One decimal at most, none when it is whole; "?" when the sheet did not carry it.
  function num(v) {
    if (v == null || v === '' || !isFinite(Number(v))) return '?';
    return String(Math.round(Number(v) * 10) / 10);
  }
  function whole(v) { return (v == null || v === '' || !isFinite(Number(v))) ? '?' : String(Math.round(Number(v))); }
  function ago(ms) {
    if (!(ms > 0)) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 90 ? 'read just now' : (s < 5400 ? 'read ' + Math.round(s / 60) + 'm ago' : 'read ' + Math.round(s / 3600) + 'h ago');
  }

  // Attributes for the row that opens the sheet. Empty when there is no sheet to open, so a pet with no
  // #petstats read looks and behaves exactly as before.
  function rowAttrs(sheet, k) {
    if (!sheet) return '';
    return ' data-wp-interact data-sheet="' + esc(k) + '" role="button" aria-expanded="' + (isOpen(k) ? 'true' : 'false')
      + '" title="' + (isOpen(k) ? 'Click to fold the #petstats sheet away' : 'Click to unfold the #petstats sheet: resists, haste, stats, gear') + '"';
  }
  function chevron(sheet, k) { return sheet ? '<span class="ps-chev">' + (isOpen(k) ? '▾' : '▸') + '</span>' : ''; }

  function sheetHtml(sheet, k) {
    if (!sheet || !isOpen(k)) return '';
    var s = sheet;
    var l1 = '<span>HP <b>' + whole(s.hp) + ' / ' + whole(s.hp_max) + '</b></span>'
      + '<span>AC <b>' + whole(s.ac) + '</b></span>'
      + '<span>ATK <b>' + whole(s.atk) + '</b></span>';
    var dmg = (s.dmg_min == null && s.dmg_max == null) ? '?' : whole(s.dmg_min) + '–' + whole(s.dmg_max);
    var hasteTxt = s.haste_pct > 0 ? ' · <span class="ps-hs" title="Measured against the slowest delay seen for this pet, so it is observed, not exact"><b>+' + whole(s.haste_pct) + '%</b> haste</span>' : '';
    var l2 = '<span>dmg <b>' + dmg + '</b>' + (s.dmg_avg != null ? ' (avg ' + num(s.dmg_avg) + ')' : '') + '</span>'
      + '<span>delay <b>' + (s.delay_ms != null ? whole(s.delay_ms) + 'ms' : '?') + '</b>' + hasteTxt + '</span>'
      + '<span>DPS <b>' + num(s.dps) + '</b></span>';
    var l3 = '';
    var rs = s.resists || null;
    for (var i = 0; i < RESISTS.length; i++) {
      var v = rs ? rs[RESISTS[i][0]] : null;
      l3 += '<span class="' + (v != null && Number(v) < 0 ? 'neg' : '') + '" title="' + RESISTS[i][2] + ' resist, as the pet has it now (a Tashed pet reads lower)">'
        + RESISTS[i][1] + ' <b>' + whole(v) + '</b></span>';
    }
    var eq = '';
    var gear = s.equipment || null;
    if (gear) {
      for (var j = 0; j < SLOTS.length; j++) {
        var item = gear[SLOTS[j]];
        eq += '<div class="ps-s' + (item ? '' : ' none') + '"' + (item ? ' title="' + esc(SLOTS[j] + ': ' + item) + '"' : '') + '>'
          + '<span class="ps-sn">' + esc(SLOTS[j]) + '</span><span class="ps-it">' + (item ? esc(item) : '—') + '</span></div>';
      }
    }
    return '<div class="ps" data-sheet-body="' + esc(k) + '">'
      + '<div class="ps-h"><span>#petstats</span><span>' + esc(ago(s.read_at)) + (s.complete ? '' : ' · partial read: run #petstats again') + '</span></div>'
      + '<div class="ps-l">' + l1 + '</div>'
      + '<div class="ps-l">' + l2 + '</div>'
      + '<div class="ps-l">' + l3 + '</div>'
      + (gear ? '<div class="ps-eq">' + eq + '</div>' : '<div class="ps-h" style="margin-top:3px"><span>equipment not read</span></div>')
      + '</div>';
  }

  // The one <style>: both overlays load this file, so the sheet's look lives here once.
  try {
    if (root.document && root.document.head && !root.document.getElementById('wp-petsheet-css')) {
      var st = root.document.createElement('style');
      st.id = 'wp-petsheet-css';
      st.textContent = CSS;
      root.document.head.appendChild(st);
    }
  } catch (e) { /* styling is extra */ }

  var api = { SLOTS: SLOTS, RESISTS: RESISTS, CSS: CSS, key: key, isOpen: isOpen, toggle: toggle, reset: reset,
    rowAttrs: rowAttrs, chevron: chevron, sheetHtml: sheetHtml };
  root.WpPetSheet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
