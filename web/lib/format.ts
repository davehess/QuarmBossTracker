// Shared display formatters for the web app.

export function fmtDmg(n: number | null | undefined) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function fmtDuration(sec: number | null | undefined) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// Raid nights run in Eastern time (matches the bot's DEFAULT_TIMEZONE), so
// bucket every timestamp by US Eastern day instead of UTC. Otherwise a 9 PM
// ET kill lands at 01:00 UTC the next day and gets pushed into "tomorrow"
// when rendered on Vercel's UTC server.
const RAID_TZ = 'America/New_York';

// YYYY-MM-DD for grouping. Forces RAID_TZ so the day boundary is midnight
// Eastern, not midnight UTC.
export function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: RAID_TZ });
}

export function dayLabel(key: string) {
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: RAID_TZ });
  // Yesterday's key — subtract 24h in Eastern via a string-based parse so we
  // don't have to wrestle with DST math on the server.
  const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = yesterday.toLocaleDateString('en-CA', { timeZone: RAID_TZ });
  if (key === todayKey)     return 'Tonight';
  if (key === yesterdayKey) return 'Yesterday';
  // Parse the key as a noon-Eastern timestamp to avoid the DST seam on
  // midnight boundaries flipping the displayed weekday.
  return new Date(key + 'T12:00:00-05:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    timeZone: RAID_TZ,
  });
}

export function fmtDkp(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toString();
}
