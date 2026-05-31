// Client-safe TZ constants + pure formatters. No next/headers import — this
// module is importable from both server and client components.
//
// Default zone is America/New_York because most of the guild plays from
// EST/EDT; an explicit picker (see TimezonePicker) lets a member override via
// the wp_tz cookie. The server-only userTz() reader lives in ./timezone.

export const DEFAULT_TZ = 'America/New_York';
export const TZ_COOKIE  = 'wp_tz';

// Common Wolf Pack timezones — most members are East Coast US, with a handful
// elsewhere. 'auto' means use the browser's resolved TZ (set by the picker
// at runtime); when the cookie isn't present we fall back to America/New_York.
export const TZ_CHOICES: { value: string; label: string }[] = [
  { value: 'auto',                       label: 'Auto (from this device)' },
  { value: 'America/New_York',           label: 'Eastern (default — most of the pack)' },
  { value: 'America/Chicago',            label: 'Central' },
  { value: 'America/Denver',             label: 'Mountain' },
  { value: 'America/Los_Angeles',        label: 'Pacific' },
  { value: 'America/Anchorage',          label: 'Alaska' },
  { value: 'America/Halifax',            label: 'Atlantic Canada' },
  { value: 'Europe/London',              label: 'UK' },
  { value: 'Europe/Berlin',              label: 'Central Europe' },
  { value: 'Australia/Sydney',           label: 'Sydney' },
  { value: 'UTC',                        label: 'UTC' },
];

export function fmtAbs(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    timeZone: tz,
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function fmtShort(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    timeZone: tz,
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function fmtDateOnly(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
}

// Relative ("2h ago") — TZ-independent so we don't need to thread tz through.
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `${d}d ago`;
  if (d < 365)  return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

// Display label for a TZ (e.g. "EST" / "EDT" / "PST"). Used in the header
// chip next to the picker so members see at a glance which clock they're on.
export function tzShortLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value || tz;
  } catch { return tz; }
}
