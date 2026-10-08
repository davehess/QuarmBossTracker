// utils/parseEqLog.js — EQLogParser "Send to EQ" paste parser.
//
// Format reference (single-mob and combined-multi-mob):
//   "High Priest of Ssraeshza in 42s, 53.12K Damage @1.26K, 1. Kaldrim +Pets = 4.59K@148 in 31s | ..."
//   "Combined (3): Lord Nagafen in 397s, 1.54M Damage @3.87K, 1. Player = 78.22K@216 in 362s | ..."
//
// Returned shape (matches what utils/supabase.recordParse expects as `parsed`):
//   { bossName, duration, totalDamage, totalDps, players: [{ rank, name, hasPets, damage, dps, duration }, ...] }

function kmToInt(num, suffix) {
  const n = parseFloat(num);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'K') return Math.round(n * 1_000);
  return Math.round(n);
}

function parseEQLog(str) {
  const cleaned = str.replace(/^Combined\s*\(\d+\):\s*/, '');

  const headerMatch = cleaned.match(/^(.+?)\s+in\s+(\d+)s,\s*([\d.]+)([KM])\s+Damage\s+@([\d.]+)([KM])?/);
  if (!headerMatch) return null;

  const bossName    = headerMatch[1].trim();
  const duration    = parseInt(headerMatch[2]);
  const totalDamage = kmToInt(headerMatch[3], headerMatch[4]);
  const totalDps    = kmToInt(headerMatch[5], headerMatch[6]);

  const playerRx = /(\d+)\.\s+(.+?)\s+=\s+([\d.]+)([KM])?@([\d.]+)([KM])?\s+in\s+(\d+)s/g;
  const players  = [];
  let m;
  while ((m = playerRx.exec(cleaned)) !== null) {
    const raw     = m[2].trim();
    const hasPets = raw.includes('+Pets');
    const name    = raw.replace(/\s*\+Pets/g, '').trim();
    // EQLogParser occasionally rolls an unnamed charm/summoned pet's damage
    // into its own row rather than folding it under the owner's "+Pets" —
    // that row's name is whatever fragment EQLogParser grabbed (e.g. a bare
    // "a" from "a wolf"), not a real character. Real player names are always
    // a single capitalized token, so anything else isn't a player.
    if (!/^[A-Z][a-zA-Z'-]*$/.test(name)) continue;
    players.push({
      rank: parseInt(m[1]), name, hasPets,
      damage:   kmToInt(m[3], m[4]),
      dps:      kmToInt(m[5], m[6]),
      duration: parseInt(m[7]),
    });
  }

  if (players.length === 0) return null;
  return { bossName, duration, totalDamage, totalDps, players };
}

// True when `needle` sits inside `hay` as whole words — the characters on both
// sides (if any) are not letters or digits. Bare substring matching let "a
// tortured soul" and "a mature wurm" become Ture kills ("ture" is inside
// "tortured" and "mature"); the guild lead, 2026-10-05: 8 false Ture encounters
// since Oct 2.
function containsWholeWords(hay, needle) {
  if (!needle) return false;
  const isWordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (let from = 0; ;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return false;
    if (!isWordChar(hay[i - 1]) && !isWordChar(hay[i + needle.length])) return true;
    from = i + 1;
  }
}

// Boss matching: exact > nickname > partial (closest name length, tie: longer wins).
// Partial = the shorter name appears inside the longer one as WHOLE WORDS.
// Final tiebreaker for direction-specific Vex Thal mobs (Kaas Thox Xi Aten Ha Ra,
// Thall Va Xakra): when EQ logs the unqualified name, both (North) and (South)
// variants are equally-good partial matches. Prefer (South) so the bot's auto-
// kill / parse routing is deterministic — south goes first this raid era.
function findBossFromName(parsedName, bosses) {
  // Normalize EQEmu scripted-mob names: a leading '#' and underscores
  // ("#Vulak`Aerr", "#Grieg_Veneficus", "Lord_Inquisitor_Seru") otherwise
  // block the match against the clean bosses.json name. Strip them so the
  // scripted raid target resolves to its boss entry.
  const nl = parsedName.toLowerCase().replace(/^#/, '').replace(/_/g, ' ').trim();
  const exact = bosses.find(b => b.name.toLowerCase() === nl);
  if (exact) return exact;
  const nick = bosses.find(b => (b.nicknames || []).some(n => n.toLowerCase() === nl));
  if (nick) return nick;
  const partials = bosses
    .filter(b => {
      const bn = b.name.toLowerCase();
      if (containsWholeWords(bn, nl)) return true;
      // The boss name inside a LONGER mob name: trash, when the mob is "a/an …" (EQ's own naming for
      // common mobs) or the boss is what it is "of" — "a cleric of vallon zek", "the herald of
      // vulak`aerr", "a chokidai terror" were Vallon Zek / Vulak / Terror kills otherwise.
      if (!containsWholeWords(nl, bn)) return false;
      if (/^an? /.test(nl)) return false;
      if (containsWholeWords(nl, 'of ' + bn)) return false;
      return true;
    })
    .sort((a, b) => {
      const da = Math.abs(a.name.length - nl.length);
      const db = Math.abs(b.name.length - nl.length);
      if (da !== db) return da - db;
      // Length-distance tie: prefer South over North for the Vex Thal pair.
      const aSouth = /\(south\)/i.test(a.name);
      const bSouth = /\(south\)/i.test(b.name);
      if (aSouth !== bSouth) return aSouth ? -1 : 1;
      const aNorth = /\(north\)/i.test(a.name);
      const bNorth = /\(north\)/i.test(b.name);
      if (aNorth !== bNorth) return aNorth ? 1 : -1;
      // Otherwise longer name wins (same as before).
      return b.name.length - a.name.length;
    });
  return partials[0] || null;
}

module.exports = { parseEQLog, findBossFromName, kmToInt };
