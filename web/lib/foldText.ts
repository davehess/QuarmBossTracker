// Where a paragraph of instruction text folds: the first sentence stays on the page, the rest goes
// behind "Click here for more info" (components/MoreInfo.tsx; the guild lead, DECISIONS §168 / §383).

// A sentence ends at . ! or ? followed by a space and a capital, quote or bracket. That skips
// "3.3.85", "e.g. agent" and "v1.2", which are mid-sentence.
const FIRST_SENTENCE = /^([\s\S]+?[.!?])\s+(?=[A-Z"'“‘(\[])([\s\S]+)$/;

/** Under this many words a paragraph is short enough to read in place. */
export const FOLD_MIN_WORDS = 30;

/** Split a paragraph into its first sentence and the rest; `rest` is null when it is short or one sentence. */
export function splitFirstSentence(text: string): { first: string; rest: string | null } {
  const t = text.trim();
  if (t.split(/\s+/).length < FOLD_MIN_WORDS) return { first: t, rest: null };
  const m = FIRST_SENTENCE.exec(t);
  return m ? { first: m[1], rest: m[2] } : { first: t, rest: null };
}
