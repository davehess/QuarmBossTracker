// Which EverQuest install a Steam Deck is actually PLAYING.
//
// THE GAP (measured on a live Deck, 2026-08-23). One machine, three copies of
// the client:
//
//   Bottles   ~/.var/app/com.usebottles.bottles/data/bottles/bottles/
//               ProjectQuarm/drive_c/ProjectQuarm/eqgame.exe   — game INSIDE drive_c
//   Lutris    ~/Games/ProjectQuarm/eqgame.exe                  — game IS the prefix root,
//                                                                drive_c beside it
//   Downloads ~/Downloads/EQ/eqgame.exe                        — the pristine archive both
//                                                                installs were made from
//
// Two separate bugs fell out of that. The scan only ever walked
// `<name>/drive_c`, so the Lutris copy was invisible no matter how deep it
// looked — the game is not below drive_c, it is beside it. And once both are
// visible, "first candidate found" resolves the tie by scan order, which is an
// artifact of main.js's base list rather than of which client the raider
// launches. The archive in Downloads makes the third case: a folder with
// eqgame.exe that is not an install at all, and must never be auto-selected —
// handing it to the agent configures the one copy the game never runs from.
//
// Run: npx vitest run test/eq-candidate-ranking.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, ROOT } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

// The ranking is pure, so it slices and evals clean — no electron, no fs.
const { _pickEqCandidate: pick } = evalBlock(
  sliceBlock(src, 'function _pickEqCandidate(entries, hintDir) {', '\n}'),
  ['_pickEqCandidate'],
);

// Shorthands for the three real folders above.
const BOTTLES = '/home/deck/.var/app/com.usebottles.bottles/data/bottles/bottles/ProjectQuarm/drive_c/ProjectQuarm';
const LUTRIS  = '/home/deck/Games/ProjectQuarm';
const ARCHIVE = '/home/deck/Downloads/EQ';

const played = (dir, newestLogMs) => ({ dir, hasLogs: true, newestLogMs, prefixed: true });
const idle   = (dir) => ({ dir, hasLogs: false, newestLogMs: 0, prefixed: true });
const loose  = (dir, extra = {}) => ({ dir, hasLogs: false, newestLogMs: 0, prefixed: false, ...extra });

describe('_pickEqCandidate — the install with the newest log wins', () => {
  it('prefers the copy being played over the copy found first', () => {
    // The whole point: Bottles is scanned first, Lutris is what they play.
    expect(pick([played(BOTTLES, 1_000), played(LUTRIS, 9_000)])).toBe(LUTRIS);
  });

  it('picks the same folder whichever order the scan produced them in', () => {
    expect(pick([played(LUTRIS, 9_000), played(BOTTLES, 1_000)])).toBe(LUTRIS);
  });

  it('prefers a played install over one that only has eqgame.exe', () => {
    // A fresh install with no logs is still a real answer — just a weaker one.
    expect(pick([idle(BOTTLES), played(LUTRIS, 5)])).toBe(LUTRIS);
    expect(pick([played(LUTRIS, 5), idle(BOTTLES)])).toBe(LUTRIS);
  });

  it('still answers when nothing has been played yet', () => {
    expect(pick([idle(BOTTLES), idle(LUTRIS)])).toBe(BOTTLES);
  });

  it('keeps the first-found candidate on a tie', () => {
    // Ranking must not reshuffle a machine that has nothing to rank on — that
    // is what makes this change a no-op everywhere except the multi-copy Deck.
    expect(pick([played(BOTTLES, 7_000), played(LUTRIS, 7_000)])).toBe(BOTTLES);
  });

  it('has no opinion about an empty or absent candidate list', () => {
    expect(pick([])).toBeNull();
    expect(pick(undefined)).toBeNull();
  });

  it('ignores malformed entries rather than throwing on them', () => {
    expect(pick([null, { dir: '' }, played(LUTRIS, 3)])).toBe(LUTRIS);
  });

  it('ranks a candidate whose log timestamps could not be read, not drops it', () => {
    // _newestEqLogMs returns 0 both for "no logs" and "could not stat", so
    // hasLogs is carried separately. An unreadable timestamp costs the tiebreak,
    // never the candidacy.
    const unreadable = { dir: LUTRIS, hasLogs: true, newestLogMs: 0, prefixed: true };
    expect(pick([idle(BOTTLES), unreadable])).toBe(LUTRIS);
  });
});

describe('_pickEqCandidate — an explicitly configured folder wins outright', () => {
  it('returns the hint even when another copy has much newer logs', () => {
    expect(pick([played(BOTTLES, 9_999), idle(LUTRIS)], LUTRIS)).toBe(LUTRIS);
  });

  it('returns the hint wherever it sits in the candidate list', () => {
    expect(pick([idle(LUTRIS), played(BOTTLES, 9_999)], LUTRIS)).toBe(LUTRIS);
  });

  it('matches a hint the user typed with a trailing slash', () => {
    expect(pick([played(BOTTLES, 9_999), idle(LUTRIS)], LUTRIS + '/')).toBe(LUTRIS);
  });

  it('selects even a source archive when that is what the user chose', () => {
    // Rule 1 beats rule 2: we refuse to GUESS an archive, not to obey a choice.
    expect(pick([played(LUTRIS, 9_999), loose(ARCHIVE)], ARCHIVE)).toBe(ARCHIVE);
  });

  it('falls back to ranking when the hint is not among the candidates', () => {
    expect(pick([played(BOTTLES, 1), played(LUTRIS, 2)], '/home/deck/nowhere')).toBe(LUTRIS);
  });
});

describe('_pickEqCandidate — a source archive is not an install', () => {
  it('never auto-selects an unpacked copy that has no logs', () => {
    expect(pick([loose(ARCHIVE), played(LUTRIS, 1)])).toBe(LUTRIS);
    expect(pick([loose(ARCHIVE), idle(LUTRIS)])).toBe(LUTRIS);
  });

  it('answers null rather than naming the archive when it is the only copy', () => {
    // "No EQ folder found — pick one" is true here. Pointing Mimic at an
    // archive would not be, and "Set up EQ for me" would write eqclient.ini
    // into a folder the game never launches from.
    expect(pick([loose(ARCHIVE)])).toBeNull();
  });

  it('accepts an unprefixed folder that IS being played', () => {
    // A system-wide WINEPREFIX pointed at a plain directory is a real setup.
    // Logs are the proof, and they outrank the missing prefix.
    expect(pick([loose(ARCHIVE, { hasLogs: true, newestLogMs: 500 })])).toBe(ARCHIVE);
  });

  it('keeps an unclassified candidate in the running', () => {
    // Only an explicit `prefixed: false` disqualifies. Failing open costs a bad
    // rank; failing closed costs someone their real install.
    expect(pick([{ dir: LUTRIS, hasLogs: false, newestLogMs: 0 }])).toBe(LUTRIS);
  });
});

// ── The scan that feeds the ranking ─────────────────────────────────────────
// Source-level, in the style of test/eq-folder-known.test.js: these walk real
// directory trees on the machine running them, so what is checkable here is
// that the layouts stay wired up.
describe('the prefix-root scan that made the Lutris copy visible', () => {
  it('scans the prefix ROOT, not only its drive_c', () => {
    expect(src).toMatch(/function _linuxPrefixRoots\(\)/);
    expect(src).toMatch(/for \(const pr of _linuxPrefixRoots\(\)\) for \(const d of _findEqUnderRoot\(pr, 1\)\) add\(d\);/);
  });

  it('keeps the deep drive_c walk it already had', () => {
    expect(src).toMatch(/for \(const dc of _linuxDriveCRoots\(\)\) for \(const d of _findEqUnderRoot\(dc, 3\)\) add\(d\);/);
  });

  it('drives both root kinds off one base list so they cannot drift', () => {
    const bases = sliceBlock(src, 'function _linuxPrefixBases() {', '\n}');
    expect(bases).toMatch(/path\.join\(home, 'Games'\)/);
    expect(bases).toMatch(/com\.usebottles\.bottles/);
    expect(src).toMatch(/for \(const base of _linuxPrefixBases\(\)\) addPrefixChildren\(base, 'drive_c'\);/);
  });

  it('does not descend into drive_c or dosdevices from a prefix root', () => {
    // drive_c is already its own root with a deeper budget — descending would
    // walk the same tree twice and shallower. dosdevices is drive-letter
    // symlinks, one of which (z:) points at /.
    const walk = sliceBlock(src, 'function _findEqUnderRoot(root, maxDepth) {', '\n}');
    expect(walk).toMatch(/'drive_c', 'dosdevices'/);
  });

  it('budgets the loose-copy scan at depth 1', () => {
    // ~/Downloads is the one directory guaranteed to be full of unrelated bulk,
    // and this scan is sync fs on the main process.
    expect(src).toMatch(/for \(const lr of _linuxLooseCopyRoots\(\)\) for \(const d of _findEqUnderRoot\(lr, 1\)\) add\(d\);/);
  });
});

describe('the discovery helpers stay off the Windows path', () => {
  it('every Linux root builder returns empty on other platforms', () => {
    for (const fn of ['_linuxPrefixBases', '_linuxPrefixRoots', '_linuxLooseCopyRoots', '_linuxDriveCRoots']) {
      const block = sliceBlock(src, `function ${fn}() {`, '\n}');
      expect(block, fn).toMatch(/if \(process\.platform !== 'linux'\) return \[\];/);
    }
  });

  it('detectEqDir only reaches the ranking on Linux', () => {
    const step4 = src.slice(src.indexOf('  // 4. Linux / Steam Deck'),
                            src.indexOf('function detectCharacterFromLogs'));
    expect(step4).toMatch(/if \(process\.platform === 'linux'\) \{/);
    expect(step4).toMatch(/_pickEqCandidate\(/);
    // The hint has to reach the ranking, or a folder configured before /log on
    // loses to whichever other copy happens to have logs.
    expect(step4).toMatch(/\n\s*hint,\n/);
  });

  it('the newest-log probe is invalidated with the rest of the EQ scan caches', () => {
    expect(src).toMatch(/function _invalidateEqScan\(\) \{ _eqDirLogCache\.clear\(\); _eqDirNewestLogCache\.clear\(\);/);
  });
});
