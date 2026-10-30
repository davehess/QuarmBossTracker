// Pure helpers for the officer "approve a guest" form on /admin/links (the guild lead, 2026-10-30). Kept out of the
// 'use server' action file because that file may export only async functions, and so a test can run them directly.

export type GuestExpiryChoice = '1h' | '3h' | 'tonight' | '7d';

export const GUEST_LABEL_MAX = 64;   // the bot clips to the same length (utils/mimicLink.js GUEST_LABEL_MAX)

const GUILD_TZ = 'America/New_York';
// "Tonight" runs until 1 AM Eastern: raids end at midnight and the raid window (the deploy freeze) at 12:30, so half an
// hour past it. It was 6 AM in the first draft; the guild lead asked "why 6am eastern?" (2026-10-30): a guest key
// does not need to stay open half the night after the raid.
const TONIGHT_HOUR_ET = 1;

// The offset (e.g. "-04:00") New York has at 1 AM on that calendar date. Probed at 06:00Z, which is 1 or 2 AM in New
// York: on the spring-forward night that is still 1 AM EST (the switch is at 2 AM), and on the fall-back night 06:00Z is
// the second 1 AM (EST), so the hour it returns is always a real 1 AM.
function offsetOn(date: string): string {
  const probe = new Date(`${date}T06:00:00Z`);
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

// When a guest session minted from this approval stops working. "Tonight" is the next 1 AM Eastern strictly after
// `now`; "1 hour", "3 hours" (the guild lead, 2026-10-30: "needs a shorter timeframe too") and "7 days" are straight
// spans from now. Returns an ISO string, or null for an unknown choice.
const SPAN_HOURS: Record<string, number> = { '1h': 1, '3h': 3, '7d': 7 * 24 };
export function guestExpiry(choice: string, now: Date = new Date()): string | null {
  if (Object.prototype.hasOwnProperty.call(SPAN_HOURS, choice)) return new Date(now.getTime() + SPAN_HOURS[choice] * 3600_000).toISOString();
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
