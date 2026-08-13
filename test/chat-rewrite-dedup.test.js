// test/chat-rewrite-dedup.test.js — one in-game line, two different strings.
//
// Two uploaders (measured 2026-08-13: Hawkner and Syko) ship a REWRITTEN copy
// of guild lines they only witnessed — first letter capitalised, and `-` `!`
// `/` `=` turned into spaces or dropped. Everyone else ships the line verbatim.
// The bot's dedup key normalised case and whitespace but not punctuation, so
// the two variants keyed differently and every affected line double-posted to
// Discord.
//
// Two things make this worth a test rather than a one-line fix:
//
//   • The fuzzy slur-variant matcher — which exists precisely to collapse
//     per-receiver mutations of one line — CANNOT catch it. It requires equal
//     token counts, and ".." → " . " inserts a token. Easy to "fix" this by
//     loosening the fuzzy matcher and break drunk-speech dedup instead.
//   • Collapsing the pair is only half the job. The rewritten copy is LOSSY
//     ("5-7 k" → "5 7 k" changes the meaning; "=x" → "x" eats the emoticon).
//     Whichever copy lands first wins the post, so without a text heal the fix
//     would REGRESS the channel half the time — today the good text at least
//     appears alongside the bad one.
//
// Cases below are real lines, verbatim from chat_messages.
//
// Run: npx vitest run test/chat-rewrite-dedup.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);

// Mirror of the shipped key derivation (index.js, _handleAgentChat).
const normOf  = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const dedupOf = (t) => {
  const norm  = normOf(t);
  const punct = norm.replace(/[^a-z0-9]+/g, ' ').trim();
  return /[a-z0-9]/.test(punct) ? punct : norm;
};
const scoreOf = (s) => (String(s || '').match(/[^a-z0-9\s]/gi) || []).length;

// The four pairs observed in one raid afternoon: [verbatim, rewritten]
const PAIRS = [
  ['its usually 5-7 k per full clear',                      'Its usually 5 7 k per full clear'],
  ['ok!/camp',                                              'Ok camp'],
  ["well i'll die tonight lol.. i gotta run.. errand to do", "Well i'll die tonight lol . i gotta run . errand to do"],
  ['thx.. but do have to go =x',                            'Thx . but do have to go x'],
];

describe('the shipped code still derives the key this way', () => {
  const block = sliceBlock(src, 'const normText = String(text).toLowerCase()', 'const myTextScore');

  it('builds a punctuation-insensitive dedup text', () => {
    expect(block).toMatch(/normText\.replace\(\/\[\^a-z0-9\]\+\/g, ' '\)\.trim\(\)/);
    expect(block).toMatch(/\/\[a-z0-9\]\/\.test\(punctText\) \? punctText : normText/);
  });

  it('keys BOTH dedup maps on it, not on normText', () => {
    expect(src).toContain('const key = `${channel}|${effectiveSpeaker.toLowerCase()}|${dedupText}`');
    expect(src).toContain('const relayKey = `${channel}|${dedupText}`');
  });

  it('still keys the witness slot on normText', () => {
    // Deliberately NOT widened with the dedup keys: the witness map drives
    // speaker attribution, which has its own history of subtle bugs. It has
    // the same blind spot and widening it is a separate, considered change.
    expect(src).toContain('_witnessKey(channel, msgTs, normText)');
  });
});

describe('both rewrites of one line collapse to a single key', () => {
  for (const [verbatim, rewritten] of PAIRS) {
    it(`collapses: ${verbatim.slice(0, 34)}…`, () => {
      expect(dedupOf(verbatim)).toBe(dedupOf(rewritten));
    });
  }

  it('is what the OLD key could not do', () => {
    // Characterises the bug: prove the previous derivation kept them apart,
    // so a future edit that reverts to normText fails here loudly.
    for (const [verbatim, rewritten] of PAIRS) {
      expect(normOf(verbatim)).not.toBe(normOf(rewritten));
    }
  });

  it('is what the fuzzy slur matcher could not do either', () => {
    // _isSlurVariant bails unless token counts match. Every pair changes it.
    for (const [verbatim, rewritten] of PAIRS) {
      const a = verbatim.trim().split(/\s+/).length;
      const b = rewritten.trim().split(/\s+/).length;
      expect(a, `token counts matched for "${verbatim}" — fuzzy would have caught it`).not.toBe(b);
    }
  });
});

describe('the verbatim copy always wins the fidelity score', () => {
  for (const [verbatim, rewritten] of PAIRS) {
    it(`prefers the un-rewritten: ${verbatim.slice(0, 30)}…`, () => {
      expect(scoreOf(verbatim)).toBeGreaterThan(scoreOf(rewritten));
    });
  }

  it('heals text and speaker on independent axes', () => {
    const heal = sliceBlock(src, 'if (alreadyRelayed) {', 'if (!distinctRepeat');
    expect(heal).toMatch(/const textHealable = !!relayEntry\.msg && myTextScore > \(relayEntry\.score \|\| 0\)/);
    // Each axis keeps the better value rather than overwriting with this
    // iteration's — a text heal must not undo an earlier speaker heal.
    expect(heal).toMatch(/healable \? safeSpeaker : \(relayEntry\.speaker \|\| safeSpeaker\)/);
    expect(heal).toMatch(/textHealable \? safeText : \(relayEntry\.text \|\| safeText\)/);
  });

  it('records what was posted so there is something to heal against', () => {
    expect(src).toContain('relayEntry.text  = safeText;');
    expect(src).toContain('relayEntry.score = myTextScore;');
  });
});

describe('punctuation-only messages keep the exact key', () => {
  // Stripping punctuation reduces these to "", which would collide with every
  // other punctuation-only message from the same speaker inside the window.
  it('does not collapse distinct punctuation-only lines', () => {
    expect(dedupOf('...')).not.toBe(dedupOf('!!!'));
    expect(dedupOf('?!')).not.toBe(dedupOf('---'));
  });

  it('falls back to the normalised text, not the empty string', () => {
    expect(dedupOf('!!!')).toBe('!!!');
    expect(dedupOf('...')).toBe('...');
  });

  it('still collapses short real messages', () => {
    // "ok" and "ok!" inside the window are the same relayed line, not two.
    expect(dedupOf('ok')).toBe(dedupOf('ok!'));
  });
});

describe('genuinely different lines stay apart', () => {
  it('keeps different words distinct', () => {
    expect(dedupOf('pull now')).not.toBe(dedupOf('pull later'));
  });

  it('keeps raid count-offs distinct', () => {
    // The relay dedup comment calls these out by name — "111" count-offs were
    // silently swallowed once before by a too-aggressive text-only key.
    expect(dedupOf('111')).not.toBe(dedupOf('112'));
  });

  it('does not fold a number into a different number via punctuation', () => {
    // "5-7" and "5 7" SHOULD fold (same line, rewritten). "57" must not.
    expect(dedupOf('5-7 k')).toBe(dedupOf('5 7 k'));
    expect(dedupOf('57 k')).not.toBe(dedupOf('5 7 k'));
  });
});
