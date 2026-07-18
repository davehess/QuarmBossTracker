// LKG version-blacklist decision (#74 Part 3) — HYBRID fidelity tier.
//
// The crash-loop auto-rollback lives in Mimic's `apps/mimic/main.js`, which is an
// Electron main process (require()-ing it pulls in `electron` and boots an app),
// so the blacklist decision itself can't be imported. But it turns on ONE pure
// helper — `_agentVersionNewer` — which already ships in main.js on `main`, so we
// SOURCE-SLICE that real comparator and MIRROR the small decision that wraps it
// (kept in lock-step with checkAgentUpdate's blacklist gate). The behavior under
// test: a version that crash-looped and was reverted is not re-offered until a
// strictly NEWER build appears, which clears the blacklist.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ROOT, sliceBlock } from './_source-slice.js';

const MIMIC_MAIN = path.join(ROOT, 'apps', 'mimic', 'main.js');
const src = fs.readFileSync(MIMIC_MAIN, 'utf8');
// End at the function's closing brace — the standalone `return false;` line is
// unique to its tail (the early guards are `if (!a) return false;`, not standalone).
const block = sliceBlock(src, 'function _agentVersionNewer(a, b) {', '\n  return false;\n}');
// eslint-disable-next-line no-new-func
const { _agentVersionNewer } = new Function(block + '\nreturn { _agentVersionNewer };')();

// MIRROR of checkAgentUpdate's blacklist gate:
//   if a version is blacklisted, skip re-offering it UNLESS `latest` is strictly
//   newer than the blacklisted one (in which case clear the blacklist and proceed).
function blacklistDecision(latest, blacklisted, newerFn = _agentVersionNewer) {
  if (!blacklisted) return { skip: false, clearBlacklist: false };
  if (newerFn(latest, blacklisted)) return { skip: false, clearBlacklist: true };
  return { skip: true, clearBlacklist: false };
}

describe('_agentVersionNewer (real apps/mimic/main.js)', () => {
  it('strict newer comparison', () => {
    expect(_agentVersionNewer('3.3.86', '3.3.85')).toBe(true);
    expect(_agentVersionNewer('3.3.85', '3.3.85')).toBe(false);
    expect(_agentVersionNewer('3.3.84', '3.3.85')).toBe(false);
    expect(_agentVersionNewer('3.4.0', '3.3.99')).toBe(true);
  });
});

describe('LKG blacklist decision', () => {
  it('no blacklist → never skips', () => {
    expect(blacklistDecision('3.3.86', null)).toEqual({ skip: false, clearBlacklist: false });
  });

  it('re-offering the exact blacklisted version is SKIPPED', () => {
    expect(blacklistDecision('3.3.86', '3.3.86')).toEqual({ skip: true, clearBlacklist: false });
  });

  it('an OLDER-or-equal candidate stays skipped while blacklisted', () => {
    expect(blacklistDecision('3.3.85', '3.3.86').skip).toBe(true);
    expect(blacklistDecision('3.3.86', '3.3.86').skip).toBe(true);
  });

  it('a strictly NEWER build clears the blacklist and proceeds', () => {
    expect(blacklistDecision('3.3.87', '3.3.86')).toEqual({ skip: false, clearBlacklist: true });
    expect(blacklistDecision('3.4.0', '3.3.86')).toEqual({ skip: false, clearBlacklist: true });
  });
});
