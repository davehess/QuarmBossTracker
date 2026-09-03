// test/tag-autojoin-file-write.test.js — the autojoin file-write, unblocked.
//
// Hitya, 2026-09-03, with a real eqclient.ini: "Autojoin is part of the
// eqclient.ini. We can save the channel:pass as an environmental variable for
// officer chat and for tagging. The tagging piece is critical."
//
// The line, verbatim in shape (passwords replaced):
//   [Defaults]
//   ChannelAutoJoin=wolfpackofficer:pw ztwolfpacktag:pw general
//
// ⚠ It corrected two things this repo had believed since August: the key
// lives in eqclient.ini (STATUS said "per-character ini"), and the separator
// is WHITESPACE (the never-wired merge split on commas and would have read that
// whole line as one channel). Every expectation below is against that shape.
//
// Run: npx vitest run test/tag-autojoin-file-write.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
// Real fs + path for the file helpers; everything else the slice needs is stubbed.
// evalBlock runs the slice in a bare Function scope — no `require` there — so
// the real fs/path go in through globals.
globalThis.__wpfs = fs; globalThis.__wppath = path;
const { _iniGetKey, _iniSetKey, _applyAutojoin, _mergeAutojoin } = evalBlock(
  `const fs = globalThis.__wpfs; const path = globalThis.__wppath; const _overlayTuning = {}; const _mimicIdentity = null;\n`
  + sliceBlock(src, 'function _iniSetKey(filePath, section, key, value) {', '\n// "Set up for me" — write the four settings')
  + '\n' + sliceBlock(src, "const TAG_CHANNEL_NAME = 'Ztwolfpacktag';", '\n// ── Set up EQ for me: the writer '),
  ['_iniGetKey', '_iniSetKey', '_applyAutojoin', '_mergeAutojoin'],
);

const RAID = 'Ztwolfpacktag:pw1';      // placeholder passwords, never the real ones
const OFF  = 'wolfpackofficer:pw2';
function tmpEq(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-eq-'));
  if (contents != null) fs.writeFileSync(path.join(dir, 'eqclient.ini'), contents);
  return dir;
}
const ini = (dir) => fs.readFileSync(path.join(dir, 'eqclient.ini'), 'utf8');
const joinLine = (dir) => _iniGetKey(path.join(dir, 'eqclient.ini'), 'Defaults', 'ChannelAutoJoin');

describe('reading the line back (the helper that did not exist)', () => {
  it('reads ChannelAutoJoin from [Defaults] and nowhere else', () => {
    const d = tmpEq('[Zeal]\nChannelAutoJoin=WRONG\n[Defaults]\nLog=TRUE\nChannelAutoJoin=a:b general\n');
    expect(joinLine(d)).toBe('a:b general');
  });
  it('returns null, not empty, when the key is absent', () => {
    // Callers must not mistake "no line yet" for an empty list — both merge to
    // the same output, but the report should say "added", not "already present".
    expect(joinLine(tmpEq('[Defaults]\nLog=TRUE\n'))).toBeNull();
    expect(_iniGetKey('/nonexistent/eqclient.ini', 'Defaults', 'ChannelAutoJoin')).toBeNull();
  });
});

describe("merging into Hitya's real line shape", () => {
  it('leaves a line that already has both channels untouched', () => {
    const d = tmpEq(`[Defaults]\nChannelAutoJoin=${OFF} ${RAID} general\n`);
    const before = ini(d);
    const r = _applyAutojoin(d, [RAID, OFF]);
    expect(r.map(x => x.result)).toEqual(['already present', 'already present']);
    expect(ini(d)).toBe(before);                 // byte-identical: no rewrite
  });

  it('adds the tag channel to a raider who only has general', () => {
    const d = tmpEq('[Defaults]\nLog=TRUE\nChannelAutoJoin=general\n');
    _applyAutojoin(d, [RAID]);
    expect(joinLine(d)).toBe('general ' + RAID);
  });

  it('creates the line when the raider has no autojoin at all', () => {
    const d = tmpEq('[Defaults]\nLog=TRUE\n');
    const r = _applyAutojoin(d, [RAID]);
    expect(r[0].result).toBe('added');
    expect(joinLine(d)).toBe(RAID);
  });

  it('corrects a wrong password instead of adding a second entry', () => {
    const d = tmpEq('[Defaults]\nChannelAutoJoin=Ztwolfpacktag:stale general\n');
    _applyAutojoin(d, [RAID]);
    expect(joinLine(d)).toBe(RAID + ' general');
    expect(joinLine(d).split(' ').filter(p => /^ztwolfpacktag/i.test(p))).toHaveLength(1);
  });

  it('uses SPACES — the separator EQ actually uses', () => {
    const d = tmpEq('[Defaults]\nChannelAutoJoin=general\n');
    _applyAutojoin(d, [RAID, OFF]);
    expect(joinLine(d)).not.toContain(',');
    expect(joinLine(d).split(' ')).toEqual(['general', RAID, OFF]);
  });

  it('reports rather than writes when there is no eqclient.ini', () => {
    const d = tmpEq(null);
    expect(_applyAutojoin(d, [RAID])[0].result).toBe('no eqclient.ini');
    expect(fs.existsSync(path.join(d, 'eqclient.ini'))).toBe(false);
  });

  it('never echoes the password in its report', () => {
    const d = tmpEq('[Defaults]\nChannelAutoJoin=general\n');
    expect(JSON.stringify(_applyAutojoin(d, [RAID, OFF]))).not.toMatch(/pw1|pw2/);
  });
});

describe('the specs the setup writes', () => {
  function specs(tuning, identity) {
    return evalBlock(
      `const _overlayTuning = ${JSON.stringify(tuning)}; const _mimicIdentity = ${JSON.stringify(identity)};\n`
      + sliceBlock(src, "const TAG_CHANNEL_NAME = 'Ztwolfpacktag';", '\n// Merge `spec` into an existing autojoin list.'),
      ['_tagChannelSpecs'],
    )._tagChannelSpecs();
  }
  it('takes the RESOLVED full specs the bot serves', () => {
    const s = specs({ tag_channel_spec: RAID, officer_channel_spec: OFF }, { is_officer: true });
    expect(s).toEqual({ raid: RAID, officer: OFF });
  });
  it('refuses a raid spec that names some other channel', () => {
    // A misconfigured tuning value must not be written into every raider's ini.
    expect(specs({ tag_channel_spec: 'somethingelse:pw' }, null).raid).toBeNull();
  });
  it('withholds the officer channel from non-officers', () => {
    expect(specs({ tag_channel_spec: RAID, officer_channel_spec: OFF }, { is_officer: false }).officer).toBeNull();
    expect(specs({ tag_channel_spec: RAID, officer_channel_spec: OFF }, null).officer).toBeNull();
  });
  it('is null until the bot has a value', () => {
    expect(specs({}, null)).toEqual({ raid: null, officer: null });
  });
});

describe('secrets', () => {
  it('the agent source holds no name:password literal for either channel', () => {
    const clean = stripJs(src);
    expect(clean).not.toMatch(/ztwolfpacktag:[A-Za-z0-9]/i);
    expect(clean).not.toMatch(/wolfpackofficer:[A-Za-z0-9]/i);
  });
});

// ⚠ Proving the helpers right is not proving Set Up calls them. Stubbing the
// call out of _applyEqSetup left every test above green.
describe('wired into Set Up EQ for me', () => {
  const clean = stripJs(src);
  const setup = clean.slice(clean.indexOf('function _applyEqSetup() {'), clean.indexOf('let _stateJsonCache'));
  it('merges the known specs into every EQ folder it configures', () => {
    expect(setup).toMatch(/const wanted = \[specs\.raid, specs\.officer\]\.filter\(Boolean\);/);
    expect(setup).toMatch(/const autojoin = wanted\.length \? _applyAutojoin\(dir, wanted\) : \[\];/);
    expect(setup).toMatch(/folders\.push\(\{ dir: path\.basename\(dir\), applied, notFound, autojoin \}\);/);
  });
  it('tells the dashboard whether the tag channel is even known yet', () => {
    expect(setup).toMatch(/tagChannelKnown: !!_tagChannelSpecs\(\)\.raid/);
  });
});
