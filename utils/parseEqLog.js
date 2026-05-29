// utils/parseEqLog.js — EQLogParser "Send to EQ" paste parser.
//
// Format reference (single-mob and combined-multi-mob):
//   "High Priest of Ssraeshza in 42s, 53.12K Damage @1.26K, 1. Statlander +Pets = 4.59K@148 in 31s | ..."
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

// Boss matching: exact > nickname > partial (closest name length, tie: longer wins).
// Final tiebreaker for direction-specific Vex Thal mobs (Kaas Thox Xi Aten Ha Ra,
// Thall Va Xakra): when EQ logs the unqualified name, both (North) and (South)
// variants are equally-good partial matches. Prefer (South) so the bot's auto-
// kill / parse routing is deterministic — south goes first this raid era.
function findBossFromName(parsedName, bosses) {
  const nl = parsedName.toLowerCase().trim();
  const exact = bosses.find(b => b.name.toLowerCase() === nl);
  if (exact) return exact;
  const nick = bosses.find(b => (b.nicknames || []).some(n => n.toLowerCase() === nl));
  if (nick) return nick;
  const partials = bosses
    .filter(b => { const bn = b.name.toLowerCase(); return bn.includes(nl) || nl.includes(bn); })
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
