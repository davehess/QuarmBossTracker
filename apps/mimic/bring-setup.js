// bring-setup.js — the "Bring your setup to this computer" card, shared by the setup walkthrough (welcome.html),
// Settings and UI Studio (the guild lead, 2026-11-11: "front and center AND clear to use in UI studio").
//
// One script, three pages: each page calls wpBringSetup.mount(el, opts) and gets the same card and the same IPCs
// (ui-account-characters, then ui-restore-plan and ui-restore-parts, the compare-first restore). Plain browser
// code, no build step; it only needs window.mimic and theme.css variables.
//
//   mount(el, { all })   all=false: only the account's characters this PC has no files for (the "bring in" card).
//                        all=true:  every character with backups, including ones on this PC, so a mess-up can be
//                        undone from here (UI Studio's "Bring in / restore a backup").
//   wpBringSetup.pending(cb)  cb(count): how many characters the card would offer (the walkthrough's step state).
(function () {
  'use strict';
  var M = window.mimic;
  var acct = null, loadedAt = 0;
  var pick = {};       // character (lowercase) -> ticked
  var chosen = {};     // character (lowercase) -> backup id (cloud id or 'local-<stamp>')
  var older = {};      // character (lowercase) -> all full backups, once "older backups" was opened
  var keys = null;     // key bindings tick; null = the default for this PC
  var overlays = true;
  var doneLine = '';

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function res(w, h) { return w && h ? w + '×' + h : 'unknown size'; }
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } }
  function key(c) { return String(c.character).toLowerCase(); }

  function load(force) {
    if (!M || !M.uiAccountCharacters) return Promise.resolve(null);
    if (!force && acct && Date.now() - loadedAt < 15000) return Promise.resolve(acct);
    return Promise.resolve(M.uiAccountCharacters()).then(function (r) { acct = r && r.ok ? r : null; loadedAt = Date.now(); return acct; }, function () { acct = null; return null; });
  }
  function offered(a, all) {
    return a ? a.characters.filter(function (c) { return (all || !c.onThisPc) && (c.latestFull || (c.local && c.local.length)); }) : [];
  }

  // One backup option: a radio carrying the id, labelled with when, and the screen size it was made for.
  function opt(c, id, label, checked) {
    return '<label style="display:flex;gap:6px;align-items:center;margin:2px 0;font-size:11px"><input type="radio" name="wpbs-' + esc(key(c)) + '" value="' + esc(id) + '"' + (checked ? ' checked' : '') + '>' + label + '</label>';
  }
  function backupsHtml(c) {
    var k = key(c), h = '';
    var def = chosen[k] || (c.latestFull && c.latestFull.id) || '';
    var machines = older[k] || c.machines || [];
    machines.forEach(function (m) {
      h += '<div style="margin:6px 0 2px;color:var(--wp-gold);font-size:11px">' + esc(m.machine_name || 'unknown computer') + '</div>';
      (m.list || [m.latestFull]).forEach(function (f) {
        h += opt(c, f.id, esc(when(f.created_at)) + ' <span style="color:var(--wp-dim)">' + esc(res(f.source_width, f.source_height)) + ' · ' + (f.file_count || '?') + ' files</span>', f.id === def);
      });
    });
    if (c.local && c.local.length) {
      h += '<div style="margin:8px 0 2px;color:var(--wp-gold);font-size:11px">On this computer</div>';
      c.local.forEach(function (v) { h += opt(c, v.id, esc(when(v.at)) + ' <span style="color:var(--wp-dim)">' + v.file_count + ' files kept here</span>', v.id === def); });
    }
    if (!older[k] && machines.length) h += '<button type="button" data-older="' + esc(k) + '" style="margin:6px 0 0;padding:2px 8px;font-size:10px">Show older backups</button>';
    return h;
  }

  function render(el, all) {
    var a = acct, list = offered(a, all);
    var line = doneLine ? '<div style="margin:8px 0;color:var(--wp-green);font-size:12px">' + esc(doneLine) + '</div>' : '';
    doneLine = '';
    if (!list.length) {
      el.innerHTML = line + (all ? '<div style="color:var(--wp-dim);font-size:12px;margin:8px 0">No backups in your account yet. Back a character up from UI Studio first.</div>' : '');
      return;
    }
    var shared = !!a.otherAccountsOnPc;
    var keysOn = keys == null ? !shared : keys;
    el.innerHTML = line + '<div data-wpbs style="border:1px solid color-mix(in srgb, var(--wp-blue) 40%, var(--wp-bg));background:var(--wp-bg);border-radius:6px;padding:10px 12px;margin:10px 0;font-size:12px">' +
      '<div style="color:var(--wp-gold);font-size:13px;margin-bottom:4px">' + (all ? 'Bring in / restore a backup' : 'Bring your setup to this computer?') + '</div>' +
      '<div style="color:var(--wp-dim);margin:0 0 6px">' + (all ? 'Pick the characters and the backup for each. ' : 'These characters have a backup in your account but no files on this PC. ') +
        'Windows, hotbuttons, socials, spell sets and Zeal options come over, with the layout fitted to this screen. Your current files are kept as copies first.</div>' +
      list.map(function (c) {
        var k = key(c), f = c.latestFull;
        var ticked = pick[k] == null ? !c.onThisPc : pick[k];
        return '<div style="margin:6px 0"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-pick="' + esc(k) + '"' + (ticked ? ' checked' : '') + '>' +
          '<b>' + esc(c.character) + '</b>' + (c.onThisPc ? ' <span style="color:var(--wp-dim)">(on this PC)</span>' : '') +
          (f ? ' <span style="color:var(--wp-dim)">backed up ' + esc(new Date(f.created_at).toLocaleDateString()) + ' · ' + esc(res(f.source_width, f.source_height)) + (f.machine_name ? ' · from ' + esc(f.machine_name) : '') + '</span>' : '') + '</label>' +
          '<details style="margin:2px 0 0 26px"><summary style="cursor:pointer;color:var(--wp-dim);font-size:11px">Backups (' + ((c.machines || []).length + (c.local || []).length) + ')</summary><div data-bk="' + esc(k) + '">' + backupsHtml(c) + '</div></details></div>';
      }).join('') +
      '<div style="margin-top:8px"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-wpbs-overlays' + (overlays ? ' checked' : '') + '>Overlay positions <span style="color:var(--wp-dim)">(fitted to this PC\'s screens)</span></label>' +
      '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-wpbs-keys' + (keysOn ? ' checked' : '') + '>Key bindings and Zeal settings</label></div>' +
      (shared ? '<div style="color:var(--wp-dim);margin:2px 0 4px">Your key bindings and Zeal settings would replace this computer\'s for every character; tick to bring them anyway.</div>' : '') +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:8px"><span data-wpbs-msg style="font-size:11px;margin-right:auto"></span>' +
      '<button type="button" data-wpbs-go' + (a.eqDir ? '' : ' disabled') + '>' + (all ? 'Restore' : 'Bring them in') + '</button></div>' +
      (a.eqDir ? '' : '<div style="color:var(--wp-red);margin-top:4px">No EverQuest folder is set up on this PC yet. Add one first.</div>') + '</div>';

    el.querySelectorAll('[data-pick]').forEach(function (b) { b.addEventListener('change', function () { pick[b.dataset.pick] = b.checked; }); });
    el.querySelectorAll('input[type=radio]').forEach(function (r) { r.addEventListener('change', function () { chosen[r.name.slice(5)] = r.value; }); });
    el.querySelector('[data-wpbs-overlays]').addEventListener('change', function (e) { overlays = e.target.checked; });
    el.querySelector('[data-wpbs-keys]').addEventListener('change', function (e) { keys = e.target.checked; });
    el.querySelectorAll('[data-older]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.older, c = list.filter(function (x) { return key(x) === k; })[0];
        b.disabled = true; b.textContent = 'Loading…';
        Promise.resolve(M.uiStudioListSnapshots(c.character)).then(function (r) {
          var by = {}, order = [];
          ((r && r.snapshots) || []).filter(function (s) { return !s.label || s.label === 'Auto: after camp'; }).forEach(function (s) {
            var m = s.machine_name || '';
            if (!by[m]) { by[m] = { machine_name: s.machine_name || null, list: [] }; order.push(m); }
            by[m].list.push({ id: s.id, created_at: s.created_at, source_width: s.source_width, source_height: s.source_height, file_count: s.file_count });
          });
          if (order.length) older[k] = order.map(function (m) { return by[m]; });   // snapshots come newest first, so machines do too
          el.querySelector('[data-bk="' + k + '"]').innerHTML = backupsHtml(c);
          el.querySelectorAll('[data-bk="' + k + '"] input[type=radio]').forEach(function (rd) { rd.addEventListener('change', function () { chosen[k] = rd.value; }); });
        });
      });
    });
    el.querySelector('[data-wpbs-go]').addEventListener('click', function (e) { go(el, all, list, e.target); });
  }

  function go(el, all, list, btn) {
    var msg = el.querySelector('[data-wpbs-msg]');
    var picked = list.filter(function (c) { var t = pick[key(c)]; return t == null ? !c.onThisPc : t; });
    if (!picked.length) { msg.style.color = 'var(--wp-dim)'; msg.textContent = 'Tick a character first.'; return; }
    var withKeys = el.querySelector('[data-wpbs-keys]').checked;
    var withOverlays = el.querySelector('[data-wpbs-overlays]').checked;
    var base = (acct.parts || []).filter(function (p) { return p !== 'keybinds' && p !== 'zeal' && p !== 'overlays'; });
    btn.disabled = true; msg.style.color = 'var(--wp-dim)';
    var notes = [], ok = 0, copies = false;
    function next(i) {
      if (i >= picked.length) return finish();
      var c = picked[i], k = key(c);
      var id = chosen[k] || (c.latestFull && c.latestFull.id) || (c.local[0] && c.local[0].id);
      var src = (c.machines || []).concat(older[k] || []).reduce(function (s, m) { return s || ((m.latestFull && m.latestFull.id === id) ? m.latestFull.machine_name : null); }, null);
      var t = { character: c.character, eqDir: acct.eqDir, id: id, machine: src };
      msg.textContent = 'Bringing in ' + c.character + '…';
      return Promise.resolve(M.uiRestorePlan(t)).catch(function (err) { return { ok: false, error: err && err.message }; }).then(function (p) {
        if (!p || !p.ok) { notes.push(c.character + ': ' + (p && p.error ? p.error : 'could not read the backup')); return next(i + 1); }
        var inBackup = {};
        p.parts.forEach(function (x) { if (x.inBackup > 0) inBackup[x.key] = 1; });
        var parts = base.concat(withKeys ? ['keybinds', 'zeal'] : [], withOverlays ? ['overlays'] : []).filter(function (x) { return inBackup[x]; });
        return Promise.resolve(M.uiRestoreParts({ character: c.character, eqDir: acct.eqDir, id: id, parts: parts })).catch(function (err) { return { ok: false, error: err && err.message }; }).then(function (r) {
          if (r && r.ok) {
            ok++;
            if (r.savedCopies && r.savedCopies.length) copies = true;
            if (r.queued) notes.push(c.character + ' applies ' + (r.busy === 'camp' ? 'when they camp' : 'when EverQuest closes'));
            if (r.overlays && r.overlays.applied && !r.overlays.live) notes.push('overlay positions apply at the next Mimic start');
          } else notes.push(c.character + ': ' + (r && r.error ? r.error : 'restore failed'));
          return next(i + 1);
        });
      });
    }
    function finish() {
      btn.disabled = false;
      if (ok) {
        doneLine = '✓ ' + (all ? 'Restored ' : 'Brought in ') + ok + ' character' + (ok === 1 ? '' : 's') + '.' + (copies ? ' Saved a copy of eqclient.ini first.' : '') + (notes.length ? ' ' + notes.join('; ') : '');
        pick = {}; chosen = {};
        load(true).then(function () { render(el, all); if (el.__wpbsDone) el.__wpbsDone(ok); });
      } else { msg.style.color = 'var(--wp-red)'; msg.textContent = '✕ ' + notes.join('; '); }
    }
    next(0);
  }

  window.wpBringSetup = {
    mount: function (el, opts) {
      var all = !!(opts && opts.all);
      el.__wpbsDone = opts && opts.onDone;
      if (acct) render(el, all);
      return load(!!(opts && opts.fresh)).then(function () { render(el, all); });
    },
    // How many characters the card would offer right now (0 when signed out or nothing is backed up).
    pending: function (cb) { load(false).then(function (a) { cb(offered(a, false).length); }); },
    _offered: offered,
  };
})();
