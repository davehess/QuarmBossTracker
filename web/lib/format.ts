// Shared display formatters for the web app.

// Strip EQEmu naming artifacts from a boss/NPC name for display.
// eqemu_npc_types.name uses internal naming (leading "#" for instanced
// versions, "_" for spaces) which leaks through to /parses, /boss/[id],
// and anywhere else we surface raw names. Convert both to a human-
// readable form.
export function cleanBossName(raw: string | null | undefined): string {
  if (!raw) return 'Unknown boss';
  return raw.replace(/^#/, '').replace(/_/g, ' ').trim() || 'Unknown boss';
}

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

// Raid nights run in Eastern time (matches the bot's DEFAULT_TIMEZONE), so
// bucket every timestamp by US Eastern day instead of UTC. Otherwise a 9 PM
// ET kill lands at 01:00 UTC the next day and gets pushed into "tomorrow"
// when rendered on Vercel's UTC server. Also used by fmtTime to keep the
// server-rendered string identical to the client-rendered string — without
// it React saw a hydration mismatch (UTC → local TZ) and re-rendered every
// recent-kill timestamp on mount. That re-render IS the "blink" users saw.
export const RAID_TZ = 'America/New_York';

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: RAID_TZ,
  });
}

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
  if (key === todayKey)     return 'Today';
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
