// Pure helpers for the officer "approve a guest" form on /admin/links (the guild lead, 2026-10-30). Kept out of the
// 'use server' action file because that file may export only async functions, and so a test can run them directly.

export type GuestExpiryChoice = 'tonight' | '7d';

export const GUEST_LABEL_MAX = 64;   // the bot clips to the same length (utils/mimicLink.js GUEST_LABEL_MAX)

const GUILD_TZ = 'America/New_York';
const TONIGHT_HOUR_ET = 6;           // "Tonight" runs until 6 AM Eastern: past the end of a late raid, before the next day

// The offset (e.g. "-04:00") New York has on that calendar date. Probed at noon UTC, which is after the 2 AM local
// switch on a daylight-saving change day, so it is the offset in force at 6 AM.
function offsetOn(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat('en-US', { timeZone: GUILD_TZ, timeZoneName: 'longOffset' })
    .formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || '';
  return part.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '-05:00';
}

// Today's calendar date in New York, as YYYY-MM-DD.
function easternDate(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GUILD_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

// When a guest session minted from this approval stops working. "Tonight" is the next 6 AM Eastern strictly after
// `now`; "7 days" is a straight 7 x 24 h. Returns an ISO string, or null for an unknown choice.
export function guestExpiry(choice: string, now: Date = new Date()): string | null {
  if (choice === '7d') return new Date(now.getTime() + 7 * 24 * 3600_000).toISOString();
  if (choice !== 'tonight') return null;
  const today = easternDate(now);
  const sixToday = new Date(`${today}T0${TONIGHT_HOUR_ET}:00:00${offsetOn(today)}`);
  if (sixToday.getTime() > now.getTime()) return sixToday.toISOString();
  const tomorrow = nextDay(today);
  return new Date(`${tomorrow}T0${TONIGHT_HOUR_ET}:00:00${offsetOn(tomorrow)}`).toISOString();
}

// The officer-typed label: control characters out, whitespace collapsed, 1..64 characters. Null when nothing is left.
export function cleanGuestLabel(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GUEST_LABEL_MAX).trim();
  return s || null;
}
