// Midday raid-info post — the member-facing "here's tonight" summary.
//
// Hitya 2026-08-21, with the RaidHelper signup embed: "this is the information
// that we go off of from signups. post the raid info midday to our channel."
//
// The signup post already carries the important header block as free text:
//
//   Raid Set 1 - Vex Thal
//   Muster Point - Umbral Plains
//   Raid Lead - Bardtholemu
//   Raid Window - Elyas
//   Loot - Alukit
//   Ticks - Moash
//
// so we re-surface it at midday rather than inventing our own format — the
// officers already decided what matters and typed it once.
//
// Member-facing on purpose: NO Mimic coverage, NO lockout names. Those are
// officer business and live in the pre-raid checklist. What a raider needs at
// noon is where to be, who's leading, and whether their class is wanted.
//
// Pure: tested in test/raid-info-post.test.js.

// Lines are "<Label> - <Value>". Bullets/emoji prefixes are tolerated, and a
// value containing a dash survives (only the FIRST separator splits).
// Labels carry digits in the real post ("Raid Set 1 - Vex Thal"), so the
// label class must allow them — the first version didn't and silently
// dropped the row that names the zone.
const HEADER_RX = /^\s*[-*•\s]*([A-Za-z][A-Za-z0-9 /']{2,24}?)\s+-\s+(.+?)\s*$/;

// Free-text notes we keep verbatim (the "main only" rule and its kin) — a line
// with no "Label - Value" shape but real prose.
const MIN_NOTE_LEN = 20;

function parseRaidHeader(description) {
  const out = { fields: [], notes: [] };
  for (const raw of String(description || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(HEADER_RX);
    if (m) {
      const label = m[1].trim();
      const value = m[2].trim();
      if (value) { out.fields.push({ label, value }); continue; }
    }
    if (line.length >= MIN_NOTE_LEN) out.notes.push(line);
  }
  return out;
}

/**
 * What the guild still wants more of, phrased for members rather than
 * officers: only real gaps, biggest first, capped so it reads as an ask and
 * not a scolding.
 */
function wantedClasses(shortages, max = 5) {
  return (shortages || [])
    .slice(0, max)
    .map(s => `${s.cls} (${s.have}/${Math.round(s.avg)})`);
}

module.exports = { parseRaidHeader, wantedClasses, HEADER_RX };
