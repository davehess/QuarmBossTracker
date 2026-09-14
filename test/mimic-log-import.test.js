// test/mimic-log-import.test.js — the old-log importer is wired end to end:
// Mimic's native pickers and drop-path bridge, the onboarding card, the
// dashboard's Setup-card buttons + Logsync drop zone, and the agent's
// import / unimport actions. The scan itself is tested for real in
// test/optin-imported-logs.test.js; this file pins the plumbing between the
// three processes on comment-stripped source (the comments quote the ask).
//
// Run: npx vitest run test/mimic-log-import.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, AGENT_INDEX } from './_source-slice.js';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
const main    = read('apps', 'mimic', 'main.js');
const preload = read('apps', 'mimic', 'preload.js');
const loading = read('apps', 'mimic', 'loading.html');
const dash    = read('packages', 'wolfpack-logsync', 'dashboard.html');
const agent   = stripJs(fs.readFileSync(AGENT_INDEX, 'utf8'));

describe('Mimic side', () => {
  it('offers a folder picker and a multi-file picker on one IPC', () => {
    expect(main).toMatch(/ipcMain\.handle\('pick-log-backups', async \(e, kind\) =>/);
    expect(main).toMatch(/properties: \['openDirectory'\]/);
    expect(main).toMatch(/properties: \['openFile', 'multiSelections'\]/);
  });
  it('hands onboarding picks to the agent at spawn, from a config default that exists', () => {
    expect(main).toMatch(/importedLogPaths: \[\],/);
    expect(main).toMatch(/env\.WOLFPACK_IMPORTED_LOGS = cfg\.importedLogPaths\.map\(String\)\.join\(path\.delimiter\);/);
  });
  it('exposes the pickers and a real path for a dropped File', () => {
    expect(preload).toMatch(/pickLogBackups: \(kind\) => ipcRenderer\.invoke\('pick-log-backups', kind\),/);
    expect(preload).toMatch(/webUtils\.getPathForFile\(file\)/);
    expect(preload).toMatch(/const \{ contextBridge, ipcRenderer, webUtils \} = require\('electron'\);/);
  });
});

describe('onboarding asks about backups elsewhere', () => {
  it('has the optional card, both pickers, and saves to the config key the spawn reads', () => {
    expect(loading).toMatch(/id="cardBackups"/);
    expect(loading).toMatch(/window\.mimic\.pickLogBackups\(kind\)/);
    expect(loading).toMatch(/saveConfig\(\{ importedLogPaths: _backupPaths\.slice\(\) \}\)/);
    expect(loading).toMatch(/_backupPaths = Array\.isArray\(cfg\.importedLogPaths\)/);
  });
  it('never gates the launch on it', () => {
    // The gate reads three things; the backups card is not one of them.
    expect(loading).toMatch(/const ready = agentReady && connectDone && eqConfigured;/);
  });
});

describe('dashboard', () => {
  it('puts the action row above the Setup checklist, with the two importer buttons in it', () => {
    expect(dash).toMatch(/morphInto\(el, actionsRow \+ h\);/);
    expect(dash).toMatch(/class="wp-import-dir"/);
    expect(dash).toMatch(/class="wp-import-files"/);
    expect(dash).toMatch(/window\.mimic\.pickLogBackups\(sel === '\.wp-import-dir' \? 'dir' : 'files'\)/);
  });
  it('the Logsync tab lists imports, removes them, and takes a drop', () => {
    expect(dash).toMatch(/id="wpImportDrop"/);
    expect(dash).toMatch(/data-import="dir"/);
    expect(dash).toMatch(/data-unimport="/);
    expect(dash).toMatch(/postOptin\('import', \{ paths: paths \}\)/);
    expect(dash).toMatch(/postOptin\('unimport', \{ paths: \[p\] \}\)/);
    expect(dash).toMatch(/window\.mimic\.pathForFile\(f\)/);
    expect(dash).toMatch(/importedBadge/);
  });
  it('the shipped WEB_HTML literal carries the same markup (sync ran)', () => {
    expect(agent).toMatch(/wpImportDrop/);
    expect(agent).toMatch(/wp-import-files/);
  });
});

describe('agent API', () => {
  it('accepts import and unimport, persists the list, and serves it', () => {
    expect(agent).toMatch(/action === 'import'/);
    expect(agent).toMatch(/action === 'unimport'/);
    expect(agent).toMatch(/importedPaths:\s+_optinState\.importedPaths \|\| \[\],/);
    expect(agent).toMatch(/importedPaths: \(_optinState\.importedPaths \|\| \[\]\)\.map\(e => \(\{/);
    expect(agent).toMatch(/imported:\s+!!f\.imported,/);
  });
});
