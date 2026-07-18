// Multiplexed poll bundle (#106) — SOURCE-SLICE fidelity tier.
//
// The per-stream decision `_pollStreamDecision` lives inside the bot monolith
// (index.js) and isn't exported (require()-ing index.js boots the Discord
// client). We read the real source and eval JUST that pure function — coupled to
// the shipped code: edit the decision and this test exercises the new behavior;
// rename/delete it and the slice throws loudly. Same technique as
// test/budgets.test.js / test/shed-exceptions.test.js.
//
// Under test: the assembler's per-stream cursor handling + shed-omission —
//   • a stream not requested → 'skip'
//   • a requested stream with flag_shed_<key>=1 → 'omit' (client fails open)
//   • a requested versioned stream whose client cursor matches the fresh
//     version → 'unchanged'
//   • otherwise → 'send'
// Streams with no version (recent_fires/prefs/backfill/ui_edits) pass null
// cursors and can never resolve 'unchanged'.

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const src = readSource(BOT_INDEX);
// The pure decision fn is a self-contained block (only Number/String/Set).
const block = sliceBlock(
  src,
  'function _pollStreamDecision(key, want, tune, clientVer, freshVer) {',
  '  return \'send\';\n}',
);
// eslint-disable-next-line no-new-func
const { _pollStreamDecision } = new Function(block + '\nreturn { _pollStreamDecision };')();

const WANT = (...keys) => new Set(keys);

describe('_pollStreamDecision (real index.js)', () => {
  it('sliced the real function', () => {
    expect(typeof _pollStreamDecision).toBe('function');
  });

  it('a stream not requested → skip', () => {
    expect(_pollStreamDecision('recent_fires', WANT('tuning'), {}, null, null)).toBe('skip');
  });

  it('a requested no-version stream → send', () => {
    expect(_pollStreamDecision('recent_fires', WANT('recent_fires'), {}, null, null)).toBe('send');
    expect(_pollStreamDecision('prefs', WANT('prefs'), {}, null, null)).toBe('send');
  });

  it('shed-omission: flag_shed_<key>=1 → omit even when requested', () => {
    expect(_pollStreamDecision('recent_fires', WANT('recent_fires'), { flag_shed_recent_fires: 1 }, null, null)).toBe('omit');
    expect(_pollStreamDecision('triggers', WANT('triggers'), { flag_shed_triggers: 1 }, 'v1', 'v2')).toBe('omit');
  });

  it('shed flag is per-stream — a flag on one stream does not omit another', () => {
    expect(_pollStreamDecision('tuning', WANT('tuning'), { flag_shed_recent_fires: 1 }, null, null)).toBe('send');
  });

  it('shed flag string "1" also omits (tuning map values may be strings)', () => {
    expect(_pollStreamDecision('tuning', WANT('tuning'), { flag_shed_tuning: '1' }, null, null)).toBe('omit');
  });

  it('shed flag 0/absent does not omit (fail-open)', () => {
    expect(_pollStreamDecision('tuning', WANT('tuning'), { flag_shed_tuning: 0 }, null, null)).toBe('send');
    expect(_pollStreamDecision('tuning', WANT('tuning'), {}, null, null)).toBe('send');
  });

  it('versioned stream: matching client cursor → unchanged', () => {
    expect(_pollStreamDecision('tuning', WANT('tuning'), {}, 'abc123', 'abc123')).toBe('unchanged');
    expect(_pollStreamDecision('triggers', WANT('triggers'), {}, '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')).toBe('unchanged');
  });

  it('versioned stream: mismatched cursor → send', () => {
    expect(_pollStreamDecision('tuning', WANT('tuning'), {}, 'old', 'new')).toBe('send');
  });

  it('versioned stream: client has no cursor yet → send (first poll)', () => {
    expect(_pollStreamDecision('tuning', WANT('tuning'), {}, null, 'fresh')).toBe('send');
  });

  it('unchanged compares as strings (numeric-looking versions equal)', () => {
    expect(_pollStreamDecision('triggers', WANT('triggers'), {}, 123, '123')).toBe('unchanged');
  });

  it('omit takes precedence over unchanged (shed wins even on a version match)', () => {
    expect(_pollStreamDecision('tuning', WANT('tuning'), { flag_shed_tuning: 1 }, 'v', 'v')).toBe('omit');
  });
});
