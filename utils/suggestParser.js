// utils/suggestParser.js — Parse free-text event suggestions for boss/zone/time/date.

const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const RELATIVE = ['now','tonight','today','tomorrow'];

/**
 * Parse a suggestion title+body string against the boss list.
 * Returns { matchedBosses, matchedZones, time, dateLabel }
 *   matchedBosses  — array of boss objects from bosses.json
 *   matchedZones   — array of zone name strings (may include zones with no individual boss match)
 *   time           — string like "9PM", "9:30PM", "21:00", or null
 *   dateLabel      — string like "now", "tonight", "tomorrow", "Tuesday", or null
 */
function parseSuggestion(text, bosses) {
  const lower = text.toLowerCase();

  // ── Boss name / nickname matching ────────────────────────────────────────
  const seenIds = new Set();
  const matchedBosses = [];
  for (const boss of bosses) {
    const terms = [boss.name.toLowerCase(), ...(boss.nicknames || []).map(n => n.toLowerCase())];
    if (terms.some(t => lower.includes(t))) {
      if (!seenIds.has(boss.id)) {
        seenIds.add(boss.id);
        matchedBosses.push(boss);
      }
    }
  }

  // ── Zone name matching ───────────────────────────────────────────────────
  const seenZones = new Set(matchedBosses.map(b => b.zone));
  const allZones = [...new Set(bosses.map(b => b.zone))];
  for (const zone of allZones) {
    if (lower.includes(zone.toLowerCase()) && !seenZones.has(zone)) {
      seenZones.add(zone);
      for (const boss of bosses.filter(b => b.zone === zone)) {
        if (!seenIds.has(boss.id)) {
          seenIds.add(boss.id);
          matchedBosses.push(boss);
        }
      }
    }
  }
  const matchedZones = [...seenZones];

  // ── Time matching ────────────────────────────────────────────────────────
  let time = null;
  const ampm = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    const h = ampm[1], m = ampm[2] ? `:${ampm[2]}` : '', meridiem = ampm[3].toUpperCase();
    time = `${h}${m}${meridiem}`;
  } else {
    const t24 = lower.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (t24) time = t24[0];
  }

  // ── Date / relative matching ─────────────────────────────────────────────
  let dateLabel = null;
  for (const rel of RELATIVE) {
    if (lower.includes(rel)) { dateLabel = rel; break; }
  }
  if (!dateLabel) {
    for (const day of DAYS) {
      if (lower.includes(day)) { dateLabel = day[0].toUpperCase() + day.slice(1); break; }
    }
  }

  return { matchedBosses, matchedZones, time, dateLabel };
}

module.exports = { parseSuggestion };
