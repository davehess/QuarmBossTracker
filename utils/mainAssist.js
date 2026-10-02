// utils/mainAssist.js — who the main assist is, from raid chat.
//
// The guild lead, 2026-10-02: "when someone is declared as main assist in raid chat, their target
// should be at the top of the extended target list. And it is typically the person that has more
// targets than anyone's." Extended Target already sorts the most-targeted mob first; a declared
// main assist pins THEIR target above that.
//
// Shapes read from a raid-chat line (the speaker is known):
//   "MA is Bob" · "MA: Bob" · "MA = Bob" · "new MA Bob" · "main assist is Bob"
//   "Bob is MA" · "Bob is the MA" · "Bob is main assist"
//   "assist Bob" · "/assist Bob"                       (at the start of the line)
//   "assist me" · "I am MA" · "I'm MA"                 (the speaker)
//   "ASSIST ME ON ~<={ a gnoll pup }=>~"               (the guild's assist macro: the speaker,
//                                                       and the mob they are on)
// A named main assist counts only when the caller confirms the name is a player we know
// (`isPlayer`), so "MA is up" or "assist Ulmarr's pet" never pins anything.

const NAME = '([A-Za-z]{3,15})';
const MA = '(?:MA|main\\s*assist)';
const SHAPES = [
  new RegExp(`^(?:new\\s+)?${MA}\\s*(?:is|=|:|->|→|-)?\\s*${NAME}\\b`, 'i'),
  new RegExp(`^(?:the\\s+)?${MA}\\s+(?:is\\s+)?(?:now\\s+)?${NAME}\\b`, 'i'),
  new RegExp(`\\b${NAME}\\s+(?:is|=)\\s+(?:the\\s+|now\\s+)?${MA}\\b`, 'i'),
  new RegExp(`^/?assist\\s+${NAME}\\s*[.!]?$`, 'i'),
];
const SELF = /^(?:assist\s+me\b|i\s*(?:am|'m|m)\s+(?:the\s+)?(?:MA|main\s*assist)\b)/i;
// The assist macro names the mob: "ASSIST ME ON ~<={ a gnoll pup }=>~", or plainly "assist me on a gnoll pup".
const SELF_TARGET = /assist\s+me\s+on\s+[~<={\s]*([^{}~<=>]+?)[\s}=>~]*$/i;
const NOT_NAMES = new Set(['the', 'him', 'her', 'them', 'you', 'me', 'now', 'next', 'here', 'there', 'tank', 'off', 'and', 'for', 'pet']);

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

// → { name, target } (target only from the macro), or null.
function parseDeclaration(text, speaker, isPlayer) {
  const t = String(text || '').trim();
  if (!t || t.length > 120) return null;
  const sp = String(speaker || '').trim();
  if (SELF.test(t)) {
    if (!sp) return null;
    const m = SELF_TARGET.exec(t);
    return { name: cap(sp), target: m ? m[1].trim().slice(0, 64) : null };
  }
  for (const rx of SHAPES) {
    const m = rx.exec(t);
    if (!m) continue;
    const n = m[1];
    if (NOT_NAMES.has(n.toLowerCase())) continue;   // "MA is now Bob": the next shape reads past "now"
    if (typeof isPlayer === 'function' && !isPlayer(n.toLowerCase())) continue;
    return { name: cap(n), target: null };
  }
  return null;
}

// Per raid (key '_' while one raid runs). A declaration holds for the night; the mob a macro named
// holds for 90 seconds, since the next pull is a different mob.
const DECL_TTL_MS = 6 * 3600_000;
const CALLED_TARGET_TTL_MS = 90_000;
function createStore() {
  const byRaid = new Map();   // raidKey → { name, at, by, target, target_at }
  return {
    note(raidKey, decl, by, atMs) {
      const k = raidKey || '_';
      const prev = byRaid.get(k);
      const same = prev && prev.name === decl.name;
      byRaid.set(k, {
        name: decl.name, at: atMs, by: by || null,
        target: decl.target || (same ? prev.target : null),
        target_at: decl.target ? atMs : (same ? prev.target_at : 0),
      });
      if (byRaid.size > 20) byRaid.delete(byRaid.keys().next().value);
    },
    // The main assist for this raid: its own entry, else the one-raid entry.
    get(raidKey, nowMs) {
      const e = (raidKey && byRaid.get(raidKey)) || byRaid.get('_') || null;
      if (!e || nowMs - e.at > DECL_TTL_MS) return null;
      const calledTarget = e.target && nowMs - e.target_at <= CALLED_TARGET_TTL_MS ? e.target : null;
      return { name: e.name, declared_at: e.at, by: e.by, called_target: calledTarget };
    },
    clear() { byRaid.clear(); },
  };
}

module.exports = { parseDeclaration, createStore, DECL_TTL_MS, CALLED_TARGET_TTL_MS };
