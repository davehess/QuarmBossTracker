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
  var keys = null;     // key bindings tick; null = the default for this PC and these backups
  var split = null;    // "give each character its own keys on this PC"; null = ticked
  var keyChar = null;  // the character whose keys become this PC's one shared set (when split is off)
  var plans = {};      // 'character|backup id' -> the restore plan answer, for the key options (read before the run)
  var overlays = true;
  // What the last run did, per character, kept on screen (and across re-renders) until the next run starts
  // (a member, 2026-11-11, FB-123: "show me how many files were updated").
  var lastRun = null;   // { verb, rows: [{ character, kind: 'done'|'queued'|'error', files, parts, text, busy }], copies: [names], overlays }
  // The parts a bring-in always restores for the character itself; used when the account answer carries no list.
  var OWN_PARTS = ['layout', 'hotkeys', 'socials', 'spellsets', 'zealchar', 'other'];

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function res(w, h) { return w && h ? w + '×' + h : 'unknown size'; }
  function when(t) { try { return new Date(t).toLocaleString(); } catch (e) { return ''; } }
  function key(c) { return String(c.character).toLowerCase(); }
  function idFor(c) { return chosen[key(c)] || (c.latestFull && c.latestFull.id) || (c.local && c.local[0] && c.local[0].id); }
  function pickedOf(list) { return list.filter(function (c) { var t = pick[key(c)]; return t == null ? !c.onThisPc : t; }); }
  // The computer name a backup was made on, or null (a cloud backup with no name, or an id this card does not know).
  function machineOf(c, id) {
    if (String(id).indexOf('local-') === 0) return undefined;
    var found = null;
    (c.machines || []).concat(older[key(c)] || []).forEach(function (m) {
      var ids = (m.list || [m.latestFull]).map(function (f) { return f && f.id; });
      if (ids.indexOf(id) >= 0) found = m.machine_name || '';
    });
    return found == null ? '' : found;
  }
  // Was this backup made on another PC? A version kept here is this PC's; a cloud one without this PC's name is not.
  function fromOtherPc(c) {
    var m = machineOf(c, idFor(c));
    if (m === undefined) return false;
    var me = acct && acct.thisPc && acct.thisPc.machine;
    return !me || !m || String(m).toLowerCase() !== String(me).toLowerCase();
  }
  // Keys, decided from what each picked backup says about how its PC kept them (plan.keys) and how this PC keeps them.
  //   infos: [{ character, info: { backupPerChar, hasOwn } | null }]   o: { pcShared, split, keyChar }
  // A per-character backup with keys of its own, on a PC that shares one set, needs a decision: a key set for each
  // character (the shared step, then each character's own section), or ONE character's keys become the shared set.
  // Either way no other character's keys may overwrite the shared set, which is what the old one-restore-per-character
  // loop did (the last character's keys won).
  function keysDecision(infos, o) {
    var own = infos.filter(function (i) { return i.info && i.info.backupPerChar && i.info.hasOwn; }).map(function (i) { return i.character; });
    var need = !!o.pcShared && own.length > 0;
    var useSplit = need && o.split !== false;
    var kc = need && !useSplit ? (own.filter(function (n) { return n === o.keyChar; })[0] || own[0]) : null;
    var keybinds = {};
    infos.forEach(function (i) {
      var perChar = !!(i.info && i.info.backupPerChar);
      keybinds[i.character] = useSplit ? false : (need && perChar ? i.character === kc : true);
    });
    var noKeys = infos.filter(function (i) { return i.info && i.info.backupPerChar && !i.info.hasOwn; }).map(function (i) { return i.character; });
    return { need: need, useSplit: useSplit, own: own, keyChar: kc, keybinds: keybinds, noKeys: noKeys };
  }
  function decideNow(list) {
    return keysDecision(pickedOf(list).map(function (c) {
      var p = plans[key(c) + '|' + idFor(c)];
      return { character: c.character, info: p && p.keys ? p.keys : null };
    }), { pcShared: !acct || acct.pcPerCharKeys !== true, split: split, keyChar: keyChar });
  }
  function planReq(c) {
    var k = key(c), id = idFor(c);
    var src = (c.machines || []).concat(older[k] || []).reduce(function (s, m) { return s || ((m.latestFull && m.latestFull.id === id) ? m.latestFull.machine_name : null); }, null);
    return { character: c.character, eqDir: acct.eqDir, id: id, machine: src };
  }
  function loadPlan(c) {
    var ck = key(c) + '|' + idFor(c);
    return Promise.resolve(M.uiRestorePlan(planReq(c))).catch(function (err) { return { ok: false, error: err && err.message }; }).then(function (p) {
      plans[ck] = p && p.ok ? p : { ok: false };
      return p;
    });
  }
  // The key options under the tick: the warning, the "own keys" choice, or the picker, from the plans read so far.
  function refreshKeys(el, list) {
    var box = el.querySelector('[data-wpbs-keysub]'), cb = el.querySelector('[data-wpbs-keys]');
    if (!box || !cb) return;
    var on = cb.checked;
    var missing = on ? pickedOf(list).filter(function (c) { return !plans[key(c) + '|' + idFor(c)]; }) : [];
    var d = decideNow(list), h = '';
    var shared = !acct || acct.pcPerCharKeys !== true;
    if (on && d.need) {
      h += '<label style="display:flex;gap:8px;align-items:center;margin:4px 0 0"><input type="checkbox" data-wpbs-split' + (d.useSplit ? ' checked' : '') + '>Give each character its own keys on this PC</label>';
      if (d.useSplit) {
        h += '<div style="color:var(--wp-dim);margin:2px 0 4px">' + esc(d.own.join(', ')) + ' bring their own keys. The characters already here keep the keys they use today. Turns on Zeal\'s per-character keys here.</div>';
      } else {
        h += '<div style="margin:4px 0">This PC uses one set of keys for every character. Use the keys of <select data-wpbs-keychar>' + d.own.map(function (n) {
          return '<option value="' + esc(n) + '"' + (n === d.keyChar ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>' +
          '<div style="color:var(--wp-gold);margin:0 0 4px">They replace this PC\'s keys for every character here. A copy is kept first.</div>';
      }
    } else if (on && shared) {
      h += '<div style="color:var(--wp-dim);margin:2px 0 4px">Your key bindings and shared Zeal settings will replace this computer\'s for every character. The character\'s own Zeal settings (chat routing, spell sets) always come over.</div>';
    }
    if (on && d.noKeys.length) h += '<div style="color:var(--wp-dim);margin:2px 0 4px">No key bindings saved for ' + esc(d.noKeys.join(', ')) + ' in this backup.</div>';
    if (box.innerHTML !== h) {
      box.innerHTML = h;
      var sp = box.querySelector('[data-wpbs-split]'), kc = box.querySelector('[data-wpbs-keychar]');
      if (sp) sp.addEventListener('change', function () { split = sp.checked; refreshKeys(el, list); });
      if (kc) kc.addEventListener('change', function () { keyChar = kc.value; });
    }
    missing.forEach(function (c) { loadPlan(c).then(function () { refreshKeys(el, list); }); });
  }

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

  // The last run, file by file: "N files updated" per character with each file's name and the parts that cover it,
  // the dated copy taken first, and where a character was in game, when it applies.
  function resultsHtml() {
    if (!lastRun) return '';
    var h = '<div data-wpbs-result style="margin:8px 0;font-size:12px">';
    lastRun.rows.forEach(function (r) {
      var head, color = 'var(--wp-green)';
      if (r.kind === 'error') { head = '✕ <b>' + esc(r.character) + '</b>: ' + esc(r.text); color = 'var(--wp-red)'; }
      else if (r.kind === 'queued') {
        head = r.busy === 'camp'
          ? '⏳ <b>' + esc(r.character) + '</b> is in game, so ' + esc(r.parts) + ' apply when ' + esc(r.character) + ' camps'
          : '⏳ <b>' + esc(r.character) + '</b>: ' + esc(r.parts) + ' apply when EverQuest closes (those files are shared by every character on this computer)';
        color = 'var(--wp-gold)';
      } else head = '✓ <b>' + esc(r.character) + '</b>: ' + (r.files.length ? r.files.length + ' file' + (r.files.length === 1 ? '' : 's') + ' updated' : 'nothing to change, the files already match');
      h += '<div style="margin:4px 0;color:' + color + '">' + head + '</div>';
      if (r.files && r.files.length) {
        h += '<ul style="margin:0 0 4px 18px;padding:0;color:var(--wp-dim);font-size:11px">' + r.files.map(function (f) {
          return '<li>' + esc(f.name) + (f.parts && f.parts.length ? ' <span>(' + esc(f.parts.join(', ')) + ')</span>' : '') + '</li>';
        }).join('') + '</ul>';
      }
      if (r.fit) h += '<div style="margin:0 0 4px 18px;color:var(--wp-dim);font-size:11px">Windows fitted to ' + esc(r.fit) + '</div>';
      if (r.kind === 'done' && !r.noChat) h += '<button type="button" data-wpbs-chat="' + esc(r.character) + '" style="margin:0 0 4px 18px;padding:2px 8px;font-size:11px">Sort your chat channels</button>';
    });
    if (lastRun.copies.length) h += '<div style="color:var(--wp-dim);font-size:11px">Saved a copy of eqclient.ini first (' + lastRun.copies.map(esc).join(', ') + ').</div>';
    if (lastRun.notes.length) h += '<div style="color:var(--wp-dim);font-size:11px">' + lastRun.notes.map(esc).join('; ') + '</div>';
    return h + '</div>';
  }

  // "Sort your chat channels": opens UI Studio on that character's chat routing (drag chips between windows, add a
  // window). A member, 2026-11-11, FB-125: what was in main chat should be movable to another window or a new one.
  function wireResult(el) {
    el.querySelectorAll('[data-wpbs-chat]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (M && M.openUiStudio) Promise.resolve(M.openUiStudio({ character: b.dataset.wpbsChat, eqDir: acct && acct.eqDir, chat: true })).catch(function () {});
      });
    });
  }

  function render(el, all) {
    var a = acct, list = offered(a, all);
    var line = resultsHtml();
    if (!list.length) {
      el.innerHTML = line + (all ? '<div style="color:var(--wp-dim);font-size:12px;margin:8px 0">No backups in your account yet. Back a character up from UI Studio first.</div>' : '');
      wireResult(el);
      return;
    }
    var shared = !!a.otherAccountsOnPc;
    // Off by default when a backup came from another PC (its keys are that PC's, not this one's), or another account plays here.
    var keysOn = keys == null ? (!shared && !pickedOf(list).some(fromOtherPc)) : keys;
    el.innerHTML = line + '<div data-wpbs style="border:1px solid color-mix(in srgb, var(--wp-blue) 40%, var(--wp-bg));background:var(--wp-bg);border-radius:6px;padding:10px 12px;margin:10px 0;font-size:12px">' +
      '<div style="color:var(--wp-gold);font-size:13px;margin-bottom:4px">' + (all ? 'Bring in / restore a backup' : 'Bring your setup to this computer?') + '</div>' +
      '<div style="color:var(--wp-dim);margin:0 0 6px">' + (all ? 'Pick the characters and the backup for each. ' : 'These characters have a backup in your account but no files on this PC. ') +
        'Windows and chat windows, hotbuttons, socials, spell sets and this character\'s Zeal settings come over, with the layout fitted to the size EverQuest runs at on this PC. Your current files are kept as copies first.</div>' +
      list.map(function (c) {
        var k = key(c), f = c.latestFull;
        var ticked = pick[k] == null ? !c.onThisPc : pick[k];
        return '<div style="margin:6px 0"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-pick="' + esc(k) + '"' + (ticked ? ' checked' : '') + '>' +
          '<b>' + esc(c.character) + '</b>' + (c.onThisPc ? ' <span style="color:var(--wp-dim)">(on this PC)</span>' : '') +
          (f ? ' <span style="color:var(--wp-dim)">backed up ' + esc(new Date(f.created_at).toLocaleDateString()) + ' · ' + esc(res(f.source_width, f.source_height)) + (f.machine_name ? ' · from ' + esc(f.machine_name) : '') + '</span>' : '') + '</label>' +
          '<details style="margin:2px 0 0 26px"><summary style="cursor:pointer;color:var(--wp-dim);font-size:11px">Backups (' + ((c.machines || []).length + (c.local || []).length) + ')</summary><div data-bk="' + esc(k) + '">' + backupsHtml(c) + '</div></details></div>';
      }).join('') +
      '<div style="margin-top:8px"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-wpbs-overlays' + (overlays ? ' checked' : '') + '>Overlay positions <span style="color:var(--wp-dim)">(fitted to this PC\'s screens)</span></label>' +
      '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-wpbs-keys' + (keysOn ? ' checked' : '') + '>Key bindings and shared Zeal settings</label></div>' +
      '<div data-wpbs-keysub></div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:8px"><span data-wpbs-msg style="font-size:11px;margin-right:auto"></span>' +
      '<button type="button" data-wpbs-go' + (a.eqDir ? '' : ' disabled') + '>' + (all ? 'Restore' : 'Bring them in') + '</button></div>' +
      (a.eqDir ? '' : '<div style="color:var(--wp-red);margin-top:4px">No EverQuest folder is set up on this PC yet. Add one first.</div>') + '</div>';

    el.querySelectorAll('[data-pick]').forEach(function (b) { b.addEventListener('change', function () { pick[b.dataset.pick] = b.checked; refreshKeys(el, list); }); });
    el.querySelectorAll('input[type=radio]').forEach(function (r) { r.addEventListener('change', function () { chosen[r.name.slice(5)] = r.value; refreshKeys(el, list); }); });
    el.querySelector('[data-wpbs-overlays]').addEventListener('change', function (e) { overlays = e.target.checked; });
    el.querySelector('[data-wpbs-keys]').addEventListener('change', function (e) { keys = e.target.checked; refreshKeys(el, list); });
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
          el.querySelectorAll('[data-bk="' + k + '"] input[type=radio]').forEach(function (rd) { rd.addEventListener('change', function () { chosen[k] = rd.value; refreshKeys(el, list); }); });
        });
      });
    });
    el.querySelector('[data-wpbs-go]').addEventListener('click', function (e) { go(el, all, list, e.target); });
    wireResult(el);
    refreshKeys(el, list);
  }

  function go(el, all, list, btn) {
    var msg = el.querySelector('[data-wpbs-msg]');
    var picked = list.filter(function (c) { var t = pick[key(c)]; return t == null ? !c.onThisPc : t; });
    if (!picked.length) { msg.style.color = 'var(--wp-dim)'; msg.textContent = 'Tick a character first.'; return; }
    var withKeys = el.querySelector('[data-wpbs-keys]').checked;
    var withOverlays = el.querySelector('[data-wpbs-overlays]').checked;
    // The character's own parts, always (layout, hotbuttons, socials, spell sets, its own Zeal settings, the rest);
    // only key bindings and Zeal's SHARED sections sit behind the tick. The list comes from the main process, with the
    // fixed one as a fallback: a run once went out with NO parts because the list was never sent (FB-124/126/127).
    var base = (acct.parts && acct.parts.length ? acct.parts : OWN_PARTS).filter(function (p) { return p !== 'keybinds' && p !== 'zeal' && p !== 'overlays'; });
    // What the member ticked stays ticked after the run (a member, 2026-11-11, FB-123: the card went back to the
    // previous screen's selections): remember the ticks and the backup of each character before anything re-renders.
    picked.forEach(function (c) { pick[key(c)] = true; chosen[key(c)] = chosen[key(c)] || (c.latestFull && c.latestFull.id) || (c.local[0] && c.local[0].id); });
    keys = withKeys; overlays = withOverlays;
    btn.disabled = true; msg.style.color = 'var(--wp-dim)';
    var notes = [], rows = [], copies = [], ok = 0;
    var PART_WORDS = { keysplit: 'per-character keys on', layout: 'windows', hotkeys: 'hotbuttons', socials: 'socials', spellsets: 'spell sets', zealchar: 'Zeal settings', other: 'other settings', keybinds: 'key bindings', zeal: 'shared Zeal settings', overlays: 'overlay positions' };
    var dec = null;
    // Every plan is read first: how each backup's PC kept its keys decides what the whole run writes (keysDecision).
    function readPlans(i) {
      if (i >= picked.length) return start();
      msg.textContent = 'Reading ' + picked[i].character + '\'s backup…';
      return loadPlan(picked[i]).then(function () { return readPlans(i + 1); });
    }
    function start() {
      dec = keysDecision(picked.map(function (c) { var p = plans[key(c) + '|' + idFor(c)]; return { character: c.character, info: p && p.keys ? p.keys : null }; }),
        { pcShared: acct.pcPerCharKeys !== true, split: split, keyChar: keyChar });
      if (withKeys) dec.noKeys.forEach(function (n) { notes.push('no key bindings saved for ' + n + ' in this backup'); });
      if (!(withKeys && dec.useSplit)) return next(0);
      // The one shared step, before any character's keys: each character already here keeps today's keys in its own
      // section, then Zeal's per-character keys are turned on. It is queued like any shared-file write when EverQuest runs.
      var c0 = picked.filter(function (c) { return dec.own.indexOf(c.character) >= 0; })[0];
      msg.textContent = 'Giving each character its own keys…';
      return Promise.resolve(M.uiRestoreParts({ character: c0.character, eqDir: acct.eqDir, id: idFor(c0), parts: ['keysplit'] })).catch(function (err) { return { ok: false, error: err && err.message }; }).then(function (r) {
        if (r && r.ok) {
          (r.savedCopies || []).forEach(function (n) { if (copies.indexOf(n) < 0) copies.push(n); });
          if (r.files && r.files.length) rows.push({ character: 'This PC', kind: 'done', noChat: true, files: r.files });
          (r.queuedParts || []).forEach(function (q) { rows.push({ character: 'This PC', kind: 'queued', busy: q.busy, parts: q.parts.map(function (x) { return PART_WORDS[x] || x; }).join(', ') }); });
        } else { rows.push({ character: 'This PC', kind: 'error', text: r && r.error ? r.error : 'could not turn on per-character keys' }); return finish(); }
        return next(0);
      });
    }
    function next(i) {
      if (i >= picked.length) return finish();
      var c = picked[i], k = key(c);
      var id = idFor(c);
      msg.textContent = 'Bringing in ' + c.character + '…';
      return Promise.resolve(plans[k + '|' + id]).then(function (p) {
        if (!p || !p.ok) { rows.push({ character: c.character, kind: 'error', text: p && p.error ? p.error : 'could not read the backup' }); return next(i + 1); }
        var inBackup = {};
        p.parts.forEach(function (x) { if (x.inBackup > 0) inBackup[x.key] = 1; });
        var keyParts = withKeys ? (dec.keybinds[c.character] ? ['keybinds'] : []).concat(['zeal']) : [];
        // After the shared step this PC reads per-character keys, so a character's own section is worth writing even
        // when the plan (read before the step) saw no section to bring.
        if (withKeys && dec.useSplit) inBackup.zealchar = 1;
        var parts = base.concat(keyParts, withOverlays ? ['overlays'] : []).filter(function (x) { return inBackup[x]; });
        if (!parts.length) { rows.push({ character: c.character, kind: 'error', text: 'nothing in that backup to bring in' }); return next(i + 1); }
        return Promise.resolve(M.uiRestoreParts({ character: c.character, eqDir: acct.eqDir, id: id, parts: parts })).catch(function (err) { return { ok: false, error: err && err.message }; }).then(function (r) {
          if (r && r.ok) {
            ok++;
            (r.savedCopies || []).forEach(function (n) { if (copies.indexOf(n) < 0) copies.push(n); });
            // A restore can land in two halves: files written now, and parts waiting for a camp or for EverQuest to close.
            var doneFiles = r.files || (r.written || []).map(function (n) { return { name: n, parts: [] }; });
            if (!r.queued || doneFiles.length) rows.push({ character: c.character, kind: 'done', files: doneFiles,
              fit: r.target && r.target.w ? r.target.w + '×' + r.target.h + (r.target.from ? ' (from ' + r.target.from + ')' : '') : '' });
            (r.queuedParts && r.queuedParts.length ? r.queuedParts : (r.queued ? [{ parts: parts, busy: r.busy }] : [])).forEach(function (q) {
              rows.push({ character: c.character, kind: 'queued', busy: q.busy, parts: q.parts.map(function (x) { return PART_WORDS[x] || x; }).join(', ') });
            });
            if (r.overlays && r.overlays.applied && !r.overlays.live) notes.push('overlay positions apply at the next Mimic start');
          } else rows.push({ character: c.character, kind: 'error', text: r && r.error ? r.error : 'restore failed' });
          return next(i + 1);
        });
      });
    }
    function finish() {
      btn.disabled = false;
      plans = {};   // the files changed; the next card paint reads them again
      lastRun = { verb: all ? 'Restored' : 'Brought in', rows: rows, copies: copies, notes: notes };
      // Re-read the account list (a brought-in character is now on this PC) but keep every tick and backup choice.
      // onDone also gets the result rows, so the caller can tell which characters had files written just now.
      load(true).then(function () { render(el, all); if (ok && el.__wpbsDone) el.__wpbsDone(ok, rows); });
    }
    readPlans(0);
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
    _keysDecision: keysDecision,
  };
})();
