// Mimic tray menu, layout B (the guild lead, 2026-10-14: "the tray menu is overwhelming" — about 30
// top-level lines became 8, then 9 when Updates got its own submenu: "add updates to the submenus for
// the taskbar"). Runs the REAL buildTrayMenu from apps/mimic/main.js under stubs
// (test/_tray-menu-harness.js) and checks three things:
//   1. the top level is exactly layout B, and the groups behind Settings / Updates / Open / Help are in order;
//   2. nothing was lost or changed: every item of the PRE-change template (snapshot in
//      test/fixtures/tray-menu-before.json, taken from origin/beta before the edit) is still present
//      at some depth with the same type / checked / enabled / visible and the same handler (a bare
//      reference like `click: openSettings` is compared by name, an inline handler by its source);
//   3. nothing but the new structure was added (the group headers and the four submenu containers).
//
// Run: npx vitest run test/tray-menu-layout.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTemplate, flatten, describe as describeItem, SCENARIOS } from './_tray-menu-harness.js';

const MAIN = fs.readFileSync(path.join(__dirname, '..', 'apps', 'mimic', 'main.js'), 'utf8');
const BEFORE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tray-menu-before.json'), 'utf8'));

const HEADERS = ['Behaviour', 'Mode', 'Account'];
// The Updates container's label carries the pending version ("Updates — v9.9.9 ready"), so it is matched by prefix.
const UPDATES_LABEL = /^Updates( — v\S+ ready)?$/;
// '🗂 Overlay sets' came over from alpha after layout B (the guild lead, 2026-10-14): a new submenu, not a moved item.
const CONTAINERS = ['Settings', 'Updates', 'Open', 'Help', '🗂 Overlay sets'];
const isContainer = (label) => CONTAINERS.includes(label) || UPDATES_LABEL.test(label);

const shown = (items) => items.filter((i) => i.type !== 'separator' && i.visible !== false);
const labelsOf = (items) => shown(items).map((i) => i.label);
const top = (name) => buildTemplate(MAIN, SCENARIOS[name]());
const sub = (template, label) => template.find((i) => (label === 'Updates' ? UPDATES_LABEL.test(i.label) : i.label === label)).submenu;
// Split a submenu's visible items at its separators; a chunk led by a disabled header item carries that header.
function groups(items) {
  const out = [{ header: null, items: [] }];
  for (const i of items.filter((x) => x.visible !== false)) {
    if (i.type === 'separator') { out.push({ header: null, items: [] }); continue; }
    const cur = out[out.length - 1];
    if (i.enabled === false && HEADERS.includes(i.label)) cur.header = i.label;
    else cur.items.push(i.label);
  }
  return out;
}

describe('top level is layout B', () => {
  it('full Mimic', () => {
    const t = top('win32 full, stable, flags on');
    expect(labelsOf(t)).toEqual([
      '🐺 Wolf Pack Mimic v2.7.7 — Connected · :7777',
      'Show dashboard',
      'Overlays',
      '🗂 Overlay sets',
      '🧲 Rescue overlays to this screen',
      '🔇 Quiet mode — no TTS audio or sounds (overlays still show)',
      'Settings',
      'Updates',
      'Open',
      'Help',
      'Quit Mimic',
    ]);
  });
  it('agent only keeps the spoken-callouts toggle where Overlays would be, and drops Rescue', () => {
    expect(labelsOf(top('win32 agent only'))).toEqual([
      '🐺 Wolf Pack Mimic v2.7.7 — Connected · :7777',
      'Show dashboard',
      'Spoken trigger callouts (TTS)',
      '🔇 Quiet mode — no TTS audio or sounds (overlays still show)',
      'Settings',
      'Updates',
      'Open',
      'Help',
      'Quit Mimic',
    ]);
  });
  it('local mode changes only the status line (and the Updates label while an update is pending)', () => {
    const l = labelsOf(top('win32 beta build, local only, update pending, no uninstaller'));
    expect(l[0]).toBe('🐺 Wolf Pack Mimic v3.0.0-beta.4 — Local only · :7777');
    const rest = labelsOf(top('win32 full, stable, flags on')).slice(1);
    expect(l.slice(1)).toEqual(rest.map((x) => (x === 'Updates' ? 'Updates — v9.9.9 ready' : x)));
  });
  it('the Updates label announces a pending update, and is plain otherwise', () => {
    const lbl = (name) => top(name).map((i) => i.label).filter((x) => UPDATES_LABEL.test(x));
    expect(lbl('win32 beta build, local only, update pending, no uninstaller')).toEqual(['Updates — v9.9.9 ready']);
    for (const name of ['win32 full, stable, flags on', 'win32 full, flags off', 'win32 agent only', 'linux full']) {
      expect(lbl(name)).toEqual(['Updates']);
    }
  });
  it('the header is a disabled status line, Settings / Updates / Open / Help are submenus, Quit is last', () => {
    const t = top('win32 full, stable, flags on');
    expect(t[0].enabled).toBe(false);
    for (const c of CONTAINERS) expect(Array.isArray(sub(t, c))).toBe(true);
    expect(t[t.length - 1].label).toBe('Quit Mimic');
    expect(typeof t[t.length - 1].click).toBe('function');
  });
  it('separators never lead, trail or double up at any level', () => {
    const check = (items) => {
      const v = items.filter((i) => i.visible !== false);
      expect(v[0].type).not.toBe('separator');
      expect(v[v.length - 1].type).not.toBe('separator');
      v.forEach((i, n) => { if (i.type === 'separator') expect(v[n - 1].type).not.toBe('separator'); });
      // (the harness stubs the Overlay sets list as empty; its own items are tested in overlay-sets.test.js)
      v.forEach((i) => { if (Array.isArray(i.submenu) && i.submenu.length && isContainer(i.label)) check(i.submenu); });
    };
    for (const name of Object.keys(SCENARIOS)) check(top(name));
  });
});

describe('the groups behind the submenus', () => {
  it('Settings › Behaviour / Mode / tells / crash reports / Account / Settings… (no Updates group any more)', () => {
    const t = top('win32 full, stable, flags on');
    expect(groups(sub(t, 'Settings'))).toEqual([
      { header: 'Behaviour', items: [
        'Start with Windows',
        "Hide overlays when EverQuest isn't running",
        "Hide overlays + hotkeys when EverQuest/Mimic isn't focused",
        "Other apps can draw over overlays when EverQuest isn't focused",
        'Use the graphics card for overlays (restarts Mimic)',
        '💥 Damage-taken alert (Ctrl+Shift+D)',
      ] },
      { header: 'Mode', items: [
        '🖥 Switch to agent only (no overlays)…',
        '🙈 No overlays — I use another parser (uploads and voice continue)',
      ] },
      { header: null, items: ['My /tells  🔒 PRIVATE'] },
      { header: null, items: ['Share crash reports with the guild (opt-in)'] },
      { header: 'Account', items: [
        'Disconnect (revert to local only)',
        'Uninstall Wolf Pack Mimic…',
      ] },
      { header: null, items: ['Settings…'] },
    ]);
  });
  it('Updates › the update item, a separator, then the pop-up toggle, beta, alpha (Revert to stable only on the beta track)', () => {
    const t = top('win32 full, stable, flags on');
    const u = sub(t, 'Updates').filter((i) => i.visible !== false);
    expect(u.map((i) => (i.type === 'separator' ? '---' : i.label))).toEqual([
      'Check for updates…',
      '---',
      'Pop up when an update is ready',
      'Receive beta updates',
      'Receive alpha updates (Mimic 3.0 builder)',
    ]);
    // none of it is left behind in Settings
    const settings = labelsOf(sub(t, 'Settings'));
    for (const l of ['Check for updates…', 'Pop up when an update is ready', 'Receive beta updates',
      'Receive alpha updates (Mimic 3.0 builder)', '↩ Revert to stable…']) expect(settings).not.toContain(l);
    expect(sub(t, 'Settings').some((i) => i.label === 'Updates')).toBe(false);
  });
  it('Updates › while an update is pending: the restart item leads, and Revert to stable shows on the beta track', () => {
    const t = top('win32 beta build, local only, update pending, no uninstaller');
    const u = sub(t, 'Updates').filter((i) => i.visible !== false);
    expect(u.map((i) => (i.type === 'separator' ? '---' : i.label))).toEqual([
      'Restart to install update v9.9.9',
      '---',
      'Pop up when an update is ready',
      'Receive beta updates',
      'Receive alpha updates (Mimic 3.0 builder)',
      '↩ Revert to stable…',
    ]);
    expect(labelsOf(sub(t, 'Updates'))).not.toContain('Check for updates…');
  });
  it('the group headers are disabled, unclickable text', () => {
    for (const name of Object.keys(SCENARIOS)) {
      for (const i of sub(top(name), 'Settings')) {
        if (HEADERS.includes(i.label)) { expect(i.enabled).toBe(false); expect(i.click).toBeUndefined(); }
      }
    }
  });
  it('Open ›', () => {
    expect(labelsOf(sub(top('win32 full, stable, flags on'), 'Open'))).toEqual([
      '📈 My parses',
      'Open wolfpack.quest ↗',
      'Open dashboard in browser',
      'Open my sounds folder (add your own trigger sounds)',
      'Show agent log…',
      'UI Studio — rescale EQ UI for a new resolution',
      'Resource use — what Mimic costs this machine',
    ]);
  });
  it('Help › — the setup walkthrough only on beta / alpha builds', () => {
    expect(labelsOf(sub(top('win32 full, stable, flags on'), 'Help'))).toEqual([
      'Send feedback — bug or idea', 'Restart agent',
    ]);
    const beta = sub(top('win32 beta build, local only, update pending, no uninstaller'), 'Help');
    expect(labelsOf(beta)).toEqual(['✨ Setup walkthrough', 'Send feedback — bug or idea', 'Restart agent']);
    expect(labelsOf(beta[0].submenu)).toEqual(['A · one step at a time', 'B · essentials, then unlocks']);
  });
  it('the dynamic conditionals still follow their inputs', () => {
    const pend = sub(top('win32 beta build, local only, update pending, no uninstaller'), 'Settings');
    const names = labelsOf(pend);
    expect(names).toContain('Connect to Wolf Pack…');
    expect(names).not.toContain('Uninstall Wolf Pack Mimic…');
    // agent only hides the overlay-only items; Linux drops the Windows-only block
    const agent = labelsOf(sub(top('win32 agent only'), 'Settings'));
    expect(agent).toContain('🪟 Switch to full Mimic (overlays)…');
    expect(agent).not.toContain('🙈 No overlays — I use another parser (uploads and voice continue)');
    expect(agent).not.toContain('Use the graphics card for overlays (restarts Mimic)');
    const linux = labelsOf(sub(top('linux full'), 'Settings'));
    expect(linux).not.toContain('Start with Windows');
    expect(linux).toContain('Use the graphics card for overlays (restarts Mimic)');
  });
});

describe('nothing lost, nothing changed, nothing sneaked in', () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(name, () => {
      const now = flatten(top(name));
      const before = BEFORE[name].items;
      // every old item (same type / checked / enabled / visible / handler) is still there ...
      const missing = before.filter((x) => !now.includes(x));
      expect(missing).toEqual([]);
      // ... and the only additions are the new structure
      const extra = now.filter((x) => !before.includes(x)).map((x) => JSON.parse(x));
      for (const e of extra) {
        // Deck line only (FB-66): Linux polls for EverQuest too, so its tray shows the EQ-down switch the
        // beta snapshot hides off Windows. Nothing else may differ.
        if (name === 'linux full' && e.label === "Hide overlays when EverQuest isn't running") continue;
        expect(HEADERS.includes(e.label) || isContainer(e.label)).toBe(true);
        if (HEADERS.includes(e.label)) expect(e).toEqual({ label: e.label, enabled: false });
        else expect(e).toEqual({ label: e.label, submenu: true });
      }
      expect(now.length - before.length).toBe(extra.length);
    });
  }
  it('the snapshot itself is the old top level (sanity: ~30 lines)', () => {
    expect(BEFORE['win32 full, stable, flags on'].topLevel.length).toBeGreaterThanOrEqual(30);
  });
  it('checkboxes are bound to live status: flipping the setting flips the box', () => {
    const on = shown(sub(top('win32 full, stable, flags on'), 'Settings')).filter((i) => i.type === 'checkbox');
    const off = shown(sub(top('win32 full, flags off'), 'Settings')).filter((i) => i.type === 'checkbox');
    expect(on.length).toBeGreaterThanOrEqual(8);
    expect(off.length).toBe(on.length);
    const flips = on.filter((i, n) => describeItem(i).checked !== describeItem(off[n]).checked).map((i) => i.label);
    // every checkbox in Settings reads a setting (none is a constant)
    expect(flips.length).toBe(on.length);
    // and the three that moved to Updates › still do
    const uOn = shown(sub(top('win32 full, stable, flags on'), 'Updates')).filter((i) => i.type === 'checkbox');
    const uOff = shown(sub(top('win32 full, flags off'), 'Updates')).filter((i) => i.type === 'checkbox');
    expect(uOn.map((i) => i.label)).toEqual([
      'Pop up when an update is ready', 'Receive beta updates', 'Receive alpha updates (Mimic 3.0 builder)',
    ]);
    expect(uOn.filter((i, n) => describeItem(i).checked !== describeItem(uOff[n]).checked).length).toBe(uOn.length);
  });
});
