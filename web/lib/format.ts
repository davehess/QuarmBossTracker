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

// Raid nights run in Eastern time (matches the bot's DEFAULT_TIMEZONE), so by
// default we bucket every timestamp by US Eastern day instead of UTC. Otherwise
// a 9 PM ET kill lands at 01:00 UTC the next day and gets pushed into "tomorrow"
// when rendered on Vercel's UTC server.
//
// These formatters take an OPTIONAL `tz` so a page can render in the viewer's
// chosen zone (the wp_tz cookie via userTz()) — that's what makes the header's
// Timezone picker actually shift the displayed offset. It defaults to RAID_TZ
// so any caller that doesn't thread a zone keeps the old Eastern behavior.
//
// Hydration note: the reason this was a hard constant is that a UTC server
// render → local client render produced a mismatch + a re-render "blink". That
// stays solved as long as server and client format with the SAME tz value —
// pages resolve the cookie ONCE on the server (userTz()) and pass that string
// to both the server markup and any client child, so both agree.
export const RAID_TZ = 'America/New_York';

export function fmtTime(iso: string, tz: string = RAID_TZ) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: tz,
  });
}

// YYYY-MM-DD for grouping. Forces the day boundary to midnight in `tz`
// (Eastern by default), not midnight UTC.
export function dayKey(iso: string, tz: string = RAID_TZ) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
}

export function dayLabel(key: string, tz: string = RAID_TZ) {
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  // Yesterday's key — subtract 24h then re-bucket in `tz` so we don't have to
  // wrestle with DST math by hand.
  const yesterday = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = yesterday.toLocaleDateString('en-CA', { timeZone: tz });
  if (key === todayKey)     return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  // Parse the key as a noon-UTC timestamp to avoid a midnight DST seam flipping
  // the displayed weekday, then render the weekday in `tz`.
  return new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
    timeZone: tz,
  });
}

export function fmtDkp(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toString();
}
