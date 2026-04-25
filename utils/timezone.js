// utils/timezone.js — Configurable timezone with DST-aware parsing

const TZ_ALIASES = {
  EST: 'America/New_York', EDT: 'America/New_York', ET: 'America/New_York',
  CST: 'America/Chicago',  CDT: 'America/Chicago',  CT: 'America/Chicago',
  MST: 'America/Denver',   MDT: 'America/Denver',   MT: 'America/Denver',
  PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles', PT: 'America/Los_Angeles',
  UTC: 'UTC', GMT: 'UTC',
};

const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

function getDefaultTz() {
  return process.env.DEFAULT_TIMEZONE || 'America/New_York';
}

/** ms until midnight in the given IANA timezone */
function msUntilMidnightInTz(tz) {
  const now = new Date();
  const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const midnight = new Date(tzDate);
  midnight.setHours(24, 0, 0, 0);
  return midnight - tzDate;
}

/** Current date/time broken into parts within a timezone */
function nowPartsInTz(tz) {
  const now = new Date();
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
    hour12: false, weekday: 'long',
  }).formatToParts(now).reduce((a, { type, value }) => { a[type] = value; return a; }, {});
  return {
    year: parseInt(p.year), month: parseInt(p.month), day: parseInt(p.day),
    // hour12: false gives "24" for midnight in some locales
    hour: parseInt(p.hour) % 24, minute: parseInt(p.minute),
    dayOfWeek: p.weekday?.toLowerCase() || '',
  };
}

/**
 * Convert local datetime components (in tz) to a UTC Date.
 * Handles DST by doing a two-step offset correction.
 */
function localToUTC(year, month, day, hour, minute, tz) {
  // Initial guess treats the local time as UTC
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));

  // What time does that UTC instant correspond to in the target tz?
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(guess).reduce((a, { type, value }) => { a[type] = value; return a; }, {});

  const tzH = parseInt(p.hour) % 24;
  const tzM = parseInt(p.minute);
  const offsetMs = (hour * 60 + minute - (tzH * 60 + tzM)) * 60000;
  return new Date(guess.getTime() + offsetMs);
}

/**
 * Parse a user-supplied time string into a UTC Date.
 *
 * Supported formats:
 *   "8:30pm"  "8:30 PM"  "830pm"  "8pm"
 *   "8:30 PM EST"  "8:30pm ET"
 *   "Thursday 8:30pm"  "Thursday at 8:30pm"
 *   "tomorrow 8:30pm"
 *
 * Returns null if parsing fails.
 */
function parseUserTime(str) {
  let tz = getDefaultTz();
  let input = str.trim();

  // Extract explicit timezone abbreviation
  for (const [alias, ianaName] of Object.entries(TZ_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, 'i').test(input)) {
      tz = ianaName;
      input = input.replace(new RegExp(`\\b${alias}\\b`, 'i'), '').trim();
      break;
    }
  }

  // Extract AM/PM time: "8:30pm" "8:30 PM" "8pm" "830pm"
  const timeRe = /(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)/i;
  const timeMatch = input.match(timeRe);

  let hour, minute;
  let datePart;

  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = parseInt(timeMatch[2] || '0');
    const ampm = timeMatch[3].toUpperCase();
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    datePart = input.replace(timeMatch[0], '').replace(/\bat\b/i, '').trim();
  } else {
    // Try 24h "20:30"
    const t24 = input.match(/(\d{1,2}):(\d{2})/);
    if (!t24) return null;
    hour = parseInt(t24[1]);
    minute = parseInt(t24[2]);
    datePart = input.replace(t24[0], '').replace(/\bat\b/i, '').trim();
  }

  return _buildDate(datePart, hour, minute, tz);
}

function _buildDate(datePart, hour, minute, tz) {
  const cur = nowPartsInTz(tz);
  let { year, month, day } = cur;
  const lower = (datePart || '').toLowerCase().trim();

  if (!lower || lower === 'today' || lower === 'tonight') {
    // Use today; if time has already passed push to tomorrow
    const candidate = localToUTC(year, month, day, hour, minute, tz);
    if (candidate <= new Date()) {
      const d = new Date(Date.UTC(year, month - 1, day + 1));
      return localToUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
    }
    return candidate;
  }

  if (lower === 'tomorrow') {
    const d = new Date(Date.UTC(year, month - 1, day + 1));
    return localToUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
  }

  // Day-of-week: "thursday", "friday", etc.
  const dow = DAYS.findIndex(d => lower.startsWith(d));
  if (dow !== -1) {
    const curDow = DAYS.indexOf(cur.dayOfWeek);
    let daysUntil = (dow - curDow + 7) % 7;
    if (daysUntil === 0) {
      // Same weekday — use today if time hasn't passed, else next week
      const candidate = localToUTC(year, month, day, hour, minute, tz);
      if (candidate <= new Date()) daysUntil = 7;
    }
    const d = new Date(Date.UTC(year, month - 1, day + daysUntil));
    return localToUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute, tz);
  }

  // M/D or M/D/YYYY
  const dm = lower.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (dm) {
    month = parseInt(dm[1]);
    day   = parseInt(dm[2]);
    if (dm[3]) year = parseInt(dm[3].length === 2 ? '20' + dm[3] : dm[3]);
  }

  return localToUTC(year, month, day, hour, minute, tz);
}

/** Format a Date in the default timezone for display */
function formatInDefaultTz(date) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: getDefaultTz(),
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

/** Short timestamp e.g. "Apr 25, 8:30 PM EDT" */
function shortTimestampInTz(date, tz) {
  return new Date(date).toLocaleString('en-US', {
    timeZone: tz || getDefaultTz(),
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

module.exports = {
  getDefaultTz, msUntilMidnightInTz, parseUserTime,
  formatInDefaultTz, shortTimestampInTz, localToUTC,
};
