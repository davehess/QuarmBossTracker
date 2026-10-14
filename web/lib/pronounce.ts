// How a character's name should SOUND, as a respelling the text-to-speech voice can read
// (the guild lead, 2026-10-14: "get player pronunciation right. let each player suggest how their name
// should sound phonetically with some coaching and alternate pronunciation available to choose from").
//
// A respelling is hyphenated syllables with the stressed one in CAPITALS: "AL-den-mar". Pure functions, no
// imports: the character page uses them for the live preview + the one-click alternates, and the bot keeps a
// port of the same rules in utils/pronounce.js (change one, change the other; the tests share fixtures).
//
//   suggestPronunciations(name) up to five distinct respellings: the best guess first, then the other stress
//                               positions, then the letters that can be read two ways (soft/hard C and G,
//                               Y, "ae", "ie", a final E that may be spoken)
//   coachingTips(name)          short plain-English tips for THAT name
//   validSay(s)                 the shape the database accepts
//   speakText(say)              what to hand a TTS voice: capitals and hyphens are notation, not sound

const MAX_SUGGESTIONS = 5;
const SAY_MAX = 60;

/** 1-60 characters of letters, spaces, hyphens and apostrophes, with at least one letter. */
export function validSay(s: unknown): s is string {
  return typeof s === 'string' && s.length >= 1 && s.length <= SAY_MAX
    && /^[\p{L}][\p{L} '\-]*$/u.test(s);
}

/** The text a speech voice should read: lower case (some voices spell capitals out) with the hyphens closed up. */
export function speakText(say: string): string {
  return say.toLowerCase().replace(/-/g, '').replace(/\s+/g, ' ').trim();
}

// ── syllables ────────────────────────────────────────────────────────────────

const DIGRAPHS = ['th', 'ch', 'sh', 'ph', 'gh', 'ck', 'qu'];
// Two-letter starts a syllable can open with, so "Aldebra" splits al-de-bra and not al-deb-ra.
const ONSETS = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tr', 'sl', 'sp', 'st', 'sk', 'sc', 'sw', 'tw', 'th', 'ch', 'sh']);

function letters(name: string): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');
}

function tokenize(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length;) {
    const two = word.slice(i, i + 2);
    if (DIGRAPHS.includes(two)) { out.push(two); i += 2; } else { out.push(word[i]); i += 1; }
  }
  return out;
}

// A vowel letter, with Y counted as a vowel except where it starts a word or sits between vowels (a glide).
function vowelAt(tokens: string[], i: number): boolean {
  const t = tokens[i];
  if (t.length === 2) return false;
  if ('aeiou'.includes(t)) return true;
  if (t !== 'y') return false;
  const next = tokens[i + 1];
  const prev = tokens[i - 1];
  const nextIsVowel = !!next && next.length === 1 && 'aeiou'.includes(next);
  const prevIsVowel = !!prev && prev.length === 1 && 'aeiou'.includes(prev);
  if (i === 0 && nextIsVowel) return false;
  if (prevIsVowel && nextIsVowel) return false;
  return true;
}

type Opts = {
  hardC: boolean;     // c before e/i/y read as k, not s
  hardG: boolean;     // g before e/i/y read as a hard g ("gh"), not j
  altY: boolean;      // the other reading of a vowel Y
  altAe: boolean;     // "ae" as ee, not ay
  altIe: boolean;     // "ie" as eye, not ee
  voiceE: boolean;    // a final E that is normally silent is spoken ("ay")
};
const BASE: Opts = { hardC: false, hardG: false, altY: false, altAe: false, altIe: false, voiceE: false };

type Parsed = {
  tokens: string[];
  syl: number[][];                 // token indexes per syllable
  flags: { softC: boolean; softG: boolean; y: boolean; ae: boolean; ie: boolean; finalE: boolean };
};

function parse(word: string, voiceE: boolean): Parsed {
  const tokens = tokenize(word);
  const isV = tokens.map((_, i) => vowelAt(tokens, i));
  // Nuclei: runs of vowel tokens.
  let nuclei: [number, number][] = [];
  for (let i = 0; i < tokens.length;) {
    if (!isV[i]) { i++; continue; }
    let j = i;
    while (j + 1 < tokens.length && isV[j + 1]) j++;
    nuclei.push([i, j]);
    i = j + 1;
  }
  // A lone final E after a consonant, in a word that has another vowel, is silent ("Corvale").
  const last = nuclei[nuclei.length - 1];
  const finalE = !!last && last[0] === last[1] && tokens[last[0]] === 'e' && last[0] === tokens.length - 1
    && nuclei.length >= 2 && last[0] >= 1 && !isV[last[0] - 1];
  if (finalE && !voiceE) nuclei = nuclei.slice(0, -1);

  const syl: number[][] = [];
  if (nuclei.length === 0) {
    syl.push(tokens.map((_, i) => i));
  } else {
    let start = 0;
    nuclei.forEach(([, hi], k) => {
      let end: number;
      if (k === nuclei.length - 1) end = tokens.length - 1;
      else {
        const nextLo = nuclei[k + 1][0];
        const n = nextLo - hi - 1;                       // consonant tokens between this nucleus and the next
        let keep = n <= 1 ? 0 : Math.floor(n / 2);
        if (n >= 2) {
          const pair = tokens.slice(nextLo - 2, nextLo).join('');
          if (n === 2 && ONSETS.has(pair)) keep = 0;
          else if (n >= 3) keep = ONSETS.has(pair) ? n - 2 : n - 1;
        }
        end = hi + keep;
      }
      const idx: number[] = [];
      for (let i = start; i <= end; i++) idx.push(i);
      syl.push(idx);
      start = end + 1;
    });
  }

  const startsEIY = (i: number) => { const t = tokens[i]; return !!t && 'eiy'.includes(t[0]) && (t.length === 1); };
  const group = (a: number, b: number) => tokens.slice(a, b + 1).join('');
  const flags = {
    softC: tokens.some((t, i) => t === 'c' && startsEIY(i + 1)),
    softG: tokens.some((t, i) => t === 'g' && startsEIY(i + 1)),
    y: tokens.some((_, i) => tokens[i] === 'y' && isV[i] && !(i > 0 && isV[i - 1]) && !(isV[i + 1])),
    ae: nuclei.some(([a, b]) => group(a, b) === 'ae'),
    ie: nuclei.some(([a, b]) => group(a, b) === 'ie'),
    finalE,
  };
  return { tokens, syl, flags };
}

function respell(p: Parsed, o: Opts, nucleusOf: (i: number) => boolean): string[] {
  const { tokens, syl } = p;
  const isV = (i: number) => nucleusOf(i);
  return syl.map((idx, si) => {
    const lastSyl = si === syl.length - 1;
    let out = '';
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const t = tokens[i];
      const next = tokens[i + 1];
      if (t === 'c' && next && next.length === 1 && 'eiy'.includes(next)) out += o.hardC ? 'k' : 's';
      else if (t === 'g' && next && next.length === 1 && 'eiy'.includes(next)) out += o.hardG ? 'gh' : 'j';
      else if (t === 'ph') out += 'f';
      else if (t === 'qu') out += 'kw';
      else if (t === 'y' && isV(i) && !isV(i - 1) && !isV(i + 1)) {
        // A vowel Y standing alone as its syllable's vowel.
        const open = i === idx[idx.length - 1];
        const finalOfWord = lastSyl && open;
        if (finalOfWord) out += o.altY ? 'eye' : 'ee';
        else if (open) out += o.altY ? 'ee' : 'eye';
        else out += o.altY ? 'eye' : 'i';
      } else if (isV(i) && isV(i + 1) && !isV(i - 1)) {
        // The start of a vowel pair.
        let j = i;
        while (isV(j + 1)) j++;
        const pair = tokens.slice(i, j + 1).join('');
        let rep = pair;
        if (pair === 'ae') rep = o.altAe ? 'ee' : 'ay';
        else if (pair === 'ie') rep = o.altIe ? 'eye' : 'ee';
        out += rep;
        k += j - i;                                       // the pair's remaining letters are consumed
      } else if (t === 'e' && o.voiceE && p.flags.finalE && i === tokens.length - 1) out += 'ay';
      else out += t;
    }
    return out;
  });
}

function render(word: string, o: Opts, stress: number): { text: string; count: number } {
  const p = parse(word, o.voiceE);
  const nuc = new Set<number>();
  // Recompute vowel flags the same way parse() did, so respell() agrees on what is a vowel.
  const isV = p.tokens.map((_, i) => vowelAt(p.tokens, i));
  if (p.flags.finalE && !o.voiceE) isV[p.tokens.length - 1] = false;
  isV.forEach((v, i) => { if (v) nuc.add(i); });
  const parts = respell(p, o, (i) => nuc.has(i));
  const at = Math.min(stress, parts.length - 1);
  const text = parts.length === 1
    ? parts[0].toUpperCase()
    : parts.map((s, i) => (i === at ? s.toUpperCase() : s)).join('-');
  return { text, count: parts.length };
}

/** Up to five distinct respellings of a name, best guess first. */
export function suggestPronunciations(name: string): string[] {
  const word = letters(name);
  if (!word) return [];
  const base = render(word, BASE, 0);
  const out: string[] = [base.text];
  const add = (s: string) => { if (s && !out.includes(s)) out.push(s); };

  // Other stress positions: the second syllable, then the last.
  const stresses = [1, base.count - 1].filter((n, i, a) => n > 0 && n < base.count && a.indexOf(n) === i);
  for (const s of stresses) add(render(word, BASE, s).text);

  // Letters that can be read two ways, each flipped on its own at the best-guess stress.
  const f = parse(word, false).flags;
  const flips: Partial<Opts>[] = [];
  if (f.softC) flips.push({ hardC: true });
  if (f.softG) flips.push({ hardG: true });
  if (f.y) flips.push({ altY: true });
  if (f.ae) flips.push({ altAe: true });
  if (f.ie) flips.push({ altIe: true });
  if (f.finalE) flips.push({ voiceE: true });
  for (const flip of flips) add(render(word, { ...BASE, ...flip }, 0).text);

  return out.slice(0, MAX_SUGGESTIONS);
}

/** Short tips that apply to this particular name; the first one always does. */
export function coachingTips(name: string): string[] {
  const word = letters(name);
  const tips = ['Hyphens split syllables; CAPITALS mark the stressed one. Say it out loud, then spell what you hear.'];
  if (!word) return tips;
  const f = parse(word, false).flags;
  const t = tokenize(word);
  if (f.softC || t.includes('c')) tips.push("Write 's' for a soft C and 'k' for a hard one.");
  if (f.softG) tips.push("Write 'j' for a soft G and 'gh' for a hard one.");
  if (f.y || f.ie || /[ai]/.test(word)) tips.push("Spell a long I as 'eye' and a long E as 'ee'.");
  if (f.ae) tips.push("A pair like 'ae' is usually 'ay' or 'ee': pick the one you say.");
  if (f.finalE) tips.push("A final E is often silent. If you say it, add 'ay' or 'ee' at the end.");
  if (t.includes('ph')) tips.push("'ph' sounds like 'f'.");
  if (/([^aeiouy])\1/.test(word)) tips.push('Doubled letters make one sound; keep the split or drop one, whichever reads better.');
  return tips.slice(0, 5);
}
