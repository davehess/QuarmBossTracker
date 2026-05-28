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

// YYYY-MM-DD for grouping. Locale-stable across timezones — uses en-CA which
// renders ISO-style.
export function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA');
}

export function dayLabel(key: string) {
  const today    = new Date();
  const todayKey = today.toLocaleDateString('en-CA');
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toLocaleDateString('en-CA');
  if (key === todayKey)     return 'Tonight';
  if (key === yesterdayKey) return 'Yesterday';
  return new Date(key + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function fmtDkp(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toString();
}
