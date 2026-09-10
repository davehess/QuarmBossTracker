// test/setup-checklist-eq-folder.test.js — the Setup checklist has to name the
// RIGHT problem (Hitya, 2026-09-10: "we should be able to denote both
// situations. ask the user if they're running in compatibility mode if Zeal
// says it's not connected, yet zeal files are in the folder. do a write check
// to see if permissions are there").
//
// THE FIELD CASE. Abrahms/AirborneSapper had Zeal installed and working files
// on disk, and a dead feed — EQ was running elevated while Mimic was not. The
// "Zeal connected" row said "install/enable Zeal" regardless of what was on
// disk, so he clicked Check / install Zeal, and THAT failed with a raw
// "EPERM: operation not permitted, copyfile ..." because his EQ lives in
// C:\Program Files (x86)\TAKP. Two separate walls, and the checklist pointed at
// neither. Running Mimic as admin turned every row green.
//
// So two independent facts now ride on /api/state.eqFolder — is Zeal ON DISK,
// and can we WRITE to the folder — and this file proves both by RUNNING the
// real functions, not by matching their text.
//
// ⚠ The write test must be a PROBE WRITE, never fs.accessSync(W_OK): on Windows
// Node's access() reports the read-only ATTRIBUTE, not the ACL, so a Program
// Files folder answers "writable" and the write fails anyway. Asserted below,
// because getting this wrong reintroduces the exact bug with a green test.
//
// Run: npx vitest run test/setup-checklist-eq-folder.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, AGENT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const DASH = path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html');
const dashSrc  = readSource(DASH);
const agentSrc = readSource(AGENT_INDEX);

// ── the agent's fs check, run for real against a fake filesystem ────────────
// A fake rather than real directories: this container runs as root, where a
// chmod-based "unwritable" test is meaningless (root bypasses the check) and
// would pass here while proving nothing. The fake makes the throw explicit.
function mkAgent() {
  const prelude = `
    const __present = new Set();
    const __noWrite = new Set();
    let   __dirs    = [];
    const path = { join: (...p) => p.join('/') };
    const fs = {
      statSync:      () => ({ isDirectory: () => true }),
      existsSync:    (p) => __present.has(p),
      writeFileSync: (p) => {
        for (const d of __noWrite) {
          if (p.indexOf(d) === 0) { const e = new Error('EPERM: operation not permitted'); e.code = 'EPERM'; throw e; }
        }
      },
      unlinkSync:    () => {},
    };
    function _eqSetupDirs() { return __dirs; }
  `;
  const post = `
    function __setup(dirs, present, noWrite) {
      __dirs = dirs;
      __present.clear(); for (const p of (present || [])) __present.add(p);
      __noWrite.clear(); for (const d of (noWrite || [])) __noWrite.add(d);
      _eqFolderAt = 0;                 // defeat the 60s cache between cases
    }
  `;
  return evalBlock(
    prelude + sliceBlock(agentSrc, 'let _eqFolderAt  = 0;', '\n// EQ install dirs the agent knows about') + post,
    ['_eqFolderState', '__setup'],
  );
}

describe('the agent can see whether Zeal is on disk', () => {
  let a;
  beforeEach(() => { a = mkAgent(); });

  it('finds Zeal by its loader', () => {
    a.__setup(['C:/TAKP'], ['C:/TAKP/Zeal.asi'], []);
    expect(a._eqFolderState().zealInstalled).toBe(true);
  });

  it('finds Zeal by its uifiles tree alone — an install that dropped the UI half still counts', () => {
    a.__setup(['C:/TAKP'], ['C:/TAKP/uifiles/zeal'], []);
    expect(a._eqFolderState().zealInstalled).toBe(true);
  });

  it('says NO when the folder genuinely has neither', () => {
    a.__setup(['C:/TAKP'], ['C:/TAKP/eqgame.exe'], []);
    expect(a._eqFolderState().zealInstalled).toBe(false);
  });

  // null is not false: "we know of no EQ folder" must never render as an answer.
  it('answers null — not false — when it knows of no EQ folder at all', () => {
    a.__setup([], [], []);
    const r = a._eqFolderState();
    expect(r.zealInstalled).toBe(null);
    expect(r.writable).toBe(null);
  });
});

describe('the agent can see whether the EQ folder is writable', () => {
  let a;
  beforeEach(() => { a = mkAgent(); });

  it('reports writable when the probe write succeeds', () => {
    a.__setup(['C:/TAKP'], [], []);
    const r = a._eqFolderState();
    expect(r.writable).toBe(true);
    expect(r.unwritableDir).toBe(null);
  });

  it('reports NOT writable when the probe write is denied, and names the folder', () => {
    a.__setup(['C:/Program Files (x86)/TAKP'], [], ['C:/Program Files (x86)/TAKP']);
    const r = a._eqFolderState();
    expect(r.writable).toBe(false);
    expect(r.unwritableDir).toBe('C:/Program Files (x86)/TAKP');
  });

  it('one unwritable folder out of several is still not writable', () => {
    a.__setup(['C:/TAKP', 'C:/Program Files (x86)/TAKP'], [], ['C:/Program Files (x86)/TAKP']);
    expect(a._eqFolderState().writable).toBe(false);
  });

  it('cleans up after itself — the probe never survives a successful write', () => {
    let unlinked = 0;
    const a2 = evalBlock(
      `let __dirs = ['C:/TAKP']; const __present = new Set(); let __unlinked = 0;
       const path = { join: (...p) => p.join('/') };
       const fs = { statSync: () => ({ isDirectory: () => true }), existsSync: () => false,
                    writeFileSync: () => {}, unlinkSync: () => { __unlinked++; } };
       function _eqSetupDirs(){ return __dirs; }`
      + sliceBlock(agentSrc, 'let _eqFolderAt  = 0;', '\n// EQ install dirs the agent knows about')
      + `\nfunction __count(){ return __unlinked; }`,
      ['_eqFolderState', '__count'],
    );
    a2._eqFolderState();
    unlinked = a2.__count();
    expect(unlinked).toBe(1);
  });

  // ⚠ The one that matters most — see the header.
  it('uses a probe write, NEVER fs.accessSync(W_OK)', () => {
    const fn = stripJs(sliceBlock(agentSrc, 'function _eqFolderState() {', '\n// EQ install dirs the agent knows about'));
    expect(fn).toMatch(/writeFileSync\(probe/);
    expect(fn).not.toMatch(/accessSync/);
    expect(fn).not.toMatch(/W_OK/);
  });
});

// ── the checklist row, run for real ─────────────────────────────────────────
const rowsOf = (s) => evalBlock(
  // ⚠ End on the function's own closing brace, NOT on the next declaration —
  // slicing through 'function renderSetupChecks(s) {' hands eval an unclosed
  // function and every case dies with a bare SyntaxError.
  sliceBlock(dashSrc, 'function _setupCheckRows(s) {', '\n  return rows;\n}'),
  ['_setupCheckRows'],
)._setupCheckRows(s);
const zealRow = (s) => rowsOf(s).find(r => r.label === 'Zeal connected');
const detail  = (r) => String(r.info || (r.ok ? r.good : r.bad));

describe('the "Zeal connected" row names the right problem', () => {
  const base = { watchedLogs: [], zealClients: [] };

  it('ASKS about compatibility mode and admin when Zeal is already on disk', () => {
    const d = detail(zealRow({ ...base, eqFolder: { zealInstalled: true, writable: true } }));
    expect(d).toMatch(/compatibility mode/i);
    expect(d).toMatch(/administrator/i);
    expect(d).toMatch(/eqgame\.exe/i);
  });

  // The actual regression: it told a user with 82 freshly-installed Zeal files
  // to go and install Zeal.
  it('does NOT tell someone who already has Zeal to install Zeal', () => {
    const d = detail(zealRow({ ...base, eqFolder: { zealInstalled: true, writable: true } }));
    expect(d).not.toMatch(/install\/enable Zeal/i);
    expect(d).not.toMatch(/Check \/ install Zeal/i);
  });

  it('DOES point at the install button when Zeal is genuinely absent', () => {
    const d = detail(zealRow({ ...base, eqFolder: { zealInstalled: false, writable: true } }));
    expect(d).toMatch(/Check \/ install Zeal/i);
    expect(d).toMatch(/close EQ first/i);
  });

  it('falls back to the old wording when the agent cannot tell', () => {
    expect(detail(zealRow({ ...base, eqFolder: { zealInstalled: null } }))).toMatch(/install\/enable Zeal/i);
    expect(detail(zealRow(base))).toMatch(/install\/enable Zeal/i);        // older agent: no eqFolder at all
  });

  // `info` REPLACES the detail in the renderer, so a stale snapshot used to
  // swallow whatever the row had to say.
  it('a last-seen snapshot does not swallow the compatibility question', () => {
    const s = { ...base, zealClients: [{ live: false }], eqFolder: { zealInstalled: true } };
    expect(detail(zealRow(s))).toMatch(/compatibility mode/i);
  });

  it('but the snapshot hint still shows when we have nothing better to say', () => {
    const s = { ...base, zealClients: [{ live: false }], eqFolder: { zealInstalled: null } };
    expect(detail(zealRow(s))).toMatch(/last-seen snapshots only/i);
  });

  it('a live feed is still simply green', () => {
    const r = zealRow({ ...base, zealClients: [{ live: true }], eqFolder: { zealInstalled: true } });
    expect(r.ok).toBe(true);
    expect(detail(r)).toMatch(/live buff\/group data/i);
  });
});

describe('the "EQ folder writable" row', () => {
  // Comments stripped FIRST: this file's own source quotes "Program Files" and
  // "Set up for me" in the comments that explain the row.
  const render = stripJs(sliceBlock(dashSrc, 'function renderSetupChecks(s) {', '\n  morphInto(el, h);'));

  it('is tri-state, like Export on /camp above it', () => {
    expect(render).toMatch(/eqf\.writable === true/);
    expect(render).toMatch(/eqf\.writable === false/);
  });

  it('names the offending folder and the fixes when it is read-only', () => {
    expect(render).toMatch(/esc\(eqf\.unwritableDir/);
    expect(render).toMatch(/Program Files/);
    expect(render).toMatch(/write access/);
  });

  it('explains what it blocks, so the failing buttons make sense', () => {
    expect(render).toMatch(/Set up for me/);
    expect(render).toMatch(/UI backups/);
  });

  it('reads eqFolder off the state the agent actually sends', () => {
    expect(stripJs(agentSrc)).toMatch(/eqFolder:\s+_eqFolderState\(\),/);
  });
});

describe('the raw EPERM never reaches a member again', () => {
  const main = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));

  it('the Zeal install translates a permission denial into an instruction', () => {
    expect(main).toMatch(/function _friendlyEqWriteError\(e, eqDir\)/);
    expect(main).toMatch(/return \{ ok: false, error: _friendlyEqWriteError\(e, _zealEqDir\(\)\) \}/);
  });

  it('keeps the original errno for support rather than hiding it', () => {
    const fn = stripJs(sliceBlock(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')),
      'function _friendlyEqWriteError(e, eqDir) {', '\nipcMain.handle('));
    expect(fn).toMatch(/Details: /);
    expect(fn).toMatch(/EPERM\|EACCES/);
    // A non-permission error must pass through untouched.
    expect(fn).toMatch(/if \(!\/\\b\(EPERM\|EACCES\)\\b\/\.test\(msg\)\) return msg;/);
  });
});
