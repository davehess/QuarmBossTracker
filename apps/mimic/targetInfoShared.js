// targetInfoShared.js — the pieces of Target Info that the overlay (mobinfo.html) and the Timers canvas
// (parts.js) must draw the SAME way, so there is one copy of each.
//
// The guild lead, 2026-11-06: "there isn't parity with the kill log on the target info and canvas mode".
// The kill log is Target Info's target history (the agent's last 50 targets: killed or left alive, when,
// where). The overlay drew it in its ⟲ Recent tab; the canvas had no piece for it at all. Both now build
// their rows from killLogRows() below, so a change to a field or a wording lands on both.
//
// Also here, for the same reason: the PQDI spell link ("make it so spell names are a link to the PQDI entry
// for them") and the run-speed / ROOTED line, whose decision is the agent's (classifyMovement) and whose
// wording is this file's.
//
// No DOM, no colours: callers map a row's `tone` to their own palette (theme slots), which keeps this file
// free of raw hex. Loaded by mobinfo.html and canvas.html as a plain script, and require()d by the tests.
(function (root) {
  'use strict';

  // ── PQDI ────────────────────────────────────────────────────────────────────
  // pqdi.cc answers only on www. (bare pqdi.cc resets). A link needs a real id; without one, no link.
  function pqdiSpellUrl(id) {
    var n = Number(id);
    return (isFinite(n) && n > 0 && Math.floor(n) === n) ? 'https://www.pqdi.cc/spell/' + n : '';
  }
  // The spell's name as a link to PQDI, or as plain escaped text when the id is not known. `esc` is the page's
  // own escaper. Opened through the page's data-pqdi click handler (window.mimic.openExternal), never by
  // navigating the overlay window.
  function spellLinkHtml(name, id, esc) {
    var label = esc(name == null ? '' : name);
    var url = pqdiSpellUrl(id);
    if (!url) return label;
    return '<a class="splink" data-pqdi="' + esc(url) + '" title="Open this spell on PQDI.cc (opens your browser)">' + label + '</a>';
  }

  // ── Target history: the kill log ────────────────────────────────────────────
  var PG_LABEL = { all: 'All', killed: 'Killed', alive: 'Left alive' };
  var PG_NEXT_FILTER = { all: 'killed', killed: 'alive', alive: 'all' };
  var PG_HOW = { 'corpse-id': 'its corpse took its place in your target window', 'corpse-name': 'a corpse of its name took its place in your target window',
                 hp0: 'its health bar reached 0', slain: 'a "slain" message named it' };
  // "killed 4m ago" · "last seen 1h 5m ago" · "killed just now".
  function pgWhen(verb, ms) {
    var m = Math.floor(Math.max(0, ms) / 60000);
    if (m < 1) return verb + ' just now';
    return verb + ' ' + (m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '')) + ' ago';
  }
  function pgMatches(e, filter) {
    return filter === 'killed' ? !!e.killedMs : (filter === 'alive' ? !e.killedMs : true);
  }
  // One row per target that passes the filter, newest first: { key, name, line2, killed, live, tone }.
  // line2 is "<zone> · killed 4m ago" / "<zone> · left alive, seen 12m ago · lowest HP 54%" / "… · now".
  function killLogRows(list, filter, liveKey, now) {
    var rows = [];
    for (var i = 0; i < (list || []).length; i++) {
      var e = list[i];
      if (!e || !e.key || !pgMatches(e, filter)) continue;
      var live = e.key === liveKey;
      var st = live ? 'now' : (e.killedMs ? pgWhen('killed', now - e.killedMs) : pgWhen('left alive, seen', now - e.lastMs));
      var zone = e.zoneName || (e.zone != null ? 'zone ' + e.zone : '');
      var line2 = (zone ? zone + ' · ' : '') + st + (e.minHp != null && !e.killedMs ? ' · lowest HP ' + e.minHp + '%' : '');
      rows.push({ key: e.key, name: e.name, line2: line2, killed: !!e.killedMs, live: live, tone: e.killedMs ? 'gold' : 'blue' });
    }
    return rows;
  }
  function killLogEmpty(list, filter) {
    return (list && list.length) ? 'nothing matches ' + (PG_LABEL[filter] || 'that') : 'no targets yet — target a mob and it lands here';
  }

  // ── Run speed and ROOTED ────────────────────────────────────────────────────
  // mi = the agent's mobInfo (target_move: classifyMovement's answer), mob = the catalog row. Returns null with
  // nothing to say; else { run, label, tone, rooted }:
  //   run    "Run speed: 1.25" whenever the catalog knows it
  //   label  "ROOTED" (red) · "does not move" · "moving" · "standing still" · "moving, root has broken" · ''
  // Only the agent's decision sets ROOTED, and a catalog runspeed of 0 is "does not move", never ROOTED.
  function moveView(mi, mob) {
    var mv = mi && mi.target_move;
    var rs = mob && mob.runspeed != null && isFinite(Number(mob.runspeed)) ? Number(mob.runspeed)
           : (mv && mv.runspeed != null ? Number(mv.runspeed) : null);
    var label = mv && mv.label ? mv.label : '';
    if (rs == null && !label) return null;
    var rooted = !!(mv && mv.rooted && mv.state === 'rooted');
    var tone = rooted ? 'red' : (mv && mv.state === 'root-broken') ? 'orange' : 'dim';
    return { run: rs == null ? '' : 'Run speed: ' + rs, label: label, tone: tone, rooted: rooted,
             tip: mv && mv.basis ? mv.basis : (mv && mv.observed != null ? 'Seen moving at about ' + mv.observed + ' units/s' : '') };
  }

  var api = { pqdiSpellUrl: pqdiSpellUrl, spellLinkHtml: spellLinkHtml, PG_LABEL: PG_LABEL, PG_NEXT_FILTER: PG_NEXT_FILTER,
              PG_HOW: PG_HOW, pgWhen: pgWhen, pgMatches: pgMatches, killLogRows: killLogRows, killLogEmpty: killLogEmpty, moveView: moveView };
  root.WpTargetInfo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
