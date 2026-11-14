// The pure parts of the redesigned top bar (design lab draft: site-header).
//   raidPill()    the "tonight" text, from a date and the fixed raid schedule
//   jumpFilter()  the jump box's page filter
//   HINTS         one short line per page, shown under each link in a door's panel
// No React, no database, no clock of its own: "now" is always passed in, so a test can pin it.

export type NavItem = { href: string; label: string };
export type NavGroup = { id: string; label: string; items: NavItem[] };

// ── The raid schedule ──────────────────────────────────────────────────────────────────────────
// Sun, Wed, Thu, 8:30 PM to 11:30 PM Eastern (CLAUDE.md, "Raid schedule"; utils/timezone.js carries the same two
// bounds on the bot side). Worked out in America/New_York with Intl, so a daylight-saving change cannot move it.
export const RAID_WEEKDAYS = ['Sun', 'Wed', 'Thu'];
export const RAID_START_MIN = 20 * 60 + 30;
export const RAID_END_MIN = 23 * 60 + 30;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});
function etParts(t: number) {
  const o: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(t))) o[p.type] = p.value;
  return { wd: o.weekday, y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
}
// The instant at which New York's wall clock reads y-m-d h:mi. Two passes settle it across a clock change.
function etInstant(y: number, m: number, d: number, h: number, mi: number) {
  const want = Date.UTC(y, m - 1, d, h, mi);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = etParts(t);
    t += want - Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  }
  return t;
}

export type RaidPill = {
  state: 'before' | 'live' | 'next';
  long: string;   // beside the brand on a wide bar
  short: string;  // narrow bars
  tone: 'gold' | 'green' | 'text';
  href: '/raid';
};

const countdown = (ms: number) => {
  const mins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};

export function raidPill(now: Date | string | number): RaidPill {
  const t = new Date(now).getTime();
  const n = etParts(t);
  for (let k = 0; k <= 7; k++) {
    const day = new Date(Date.UTC(n.y, n.m - 1, n.d + k));
    const wd = WD[(WD.indexOf(n.wd) + k) % 7];
    if (!RAID_WEEKDAYS.includes(wd)) continue;
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const start = etInstant(y, m, d, 20, 30);
    const end = etInstant(y, m, d, 23, 30);
    if (k === 0 && t >= end) continue;
    if (k === 0 && t >= start) return { state: 'live', long: 'Raid on now', short: 'Raid on now', tone: 'green', href: '/raid' };
    if (k === 0) {
      const cd = countdown(start - t);
      return { state: 'before', long: `Raid tonight 8:30 PM ET, in ${cd}`, short: `Raid in ${cd}`, tone: 'gold', href: '/raid' };
    }
    return { state: 'next', long: `Next raid ${wd} 8:30 PM ET`, short: `Next ${wd} 8:30 PM`, tone: 'text', href: '/raid' };
  }
  /* unreachable: a raid day always lies within 7 days */
  return { state: 'next', long: 'Next raid Sun 8:30 PM ET', short: 'Next Sun 8:30 PM', tone: 'text', href: '/raid' };
}

// ── Jump box ───────────────────────────────────────────────────────────────────────────────────
export type JumpPage = { href: string; label: string; group: string; hint?: string };

const norm = (s: string) => s.toLowerCase().replace(/^\//, '').trim();

/** Empty query: the recent pages, newest first. Otherwise pages whose name starts with, contains, or (weaker) whose
 *  hint or group contains the text. Ties keep the order the pages were given in. */
export function jumpFilter(query: string, pages: JumpPage[], recent: string[] = [], limit = 8): JumpPage[] {
  const q = norm(query);
  if (!q) {
    const out: JumpPage[] = [];
    for (const h of recent) {
      const p = pages.find((x) => x.href === h);
      if (p && !out.includes(p)) out.push(p);
    }
    return out.slice(0, 4);
  }
  const scored: { p: JumpPage; s: number; i: number }[] = [];
  pages.forEach((p, i) => {
    const name = norm(p.label);
    let s = 0;
    if (name === q) s = 100;
    else if (name.startsWith(q)) s = 80;
    else if (name.split(/[\s/]+/).some((w) => w.startsWith(q))) s = 60;
    else if (name.includes(q)) s = 40;
    else if (norm(p.hint ?? '').includes(q)) s = 20;
    else if (norm(p.group).startsWith(q)) s = 10;
    if (s) scored.push({ p, s: s + (recent.includes(p.href) ? 5 : 0), i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.p);
}

// ── Hints ──────────────────────────────────────────────────────────────────────────────────────
export const HINTS: Record<string, string> = {
  '/raid': 'Tonight\'s plan, roster and loot',
  '/boards': 'Boss respawn timers by zone',
  '/buffs': 'Who needs which buff right now',
  '/spectator': 'Follow a raid without joining',
  '/screen': 'The big-screen view for the raid',
  '/rolls': 'Loot rolls as they happen',
  '/parses': 'Damage and healing from each fight',
  '/leaderboards': 'Top damage, healing and attendance',
  '/pvp': 'Kills and deaths on the PvP server',
  '/roster': 'Who is in the guild, by class',
  '/raidhistory': 'Every past raid night',
  '/fun': 'Odd moments from the logs',
  '/film': 'Replay a fight',
  '/start': 'Install miMIC and get set up',
  '/guide': 'Fight notes for each raid boss',
  '/db': 'Look up items, spells and mobs',
  '/quartermaster': 'Gear checks and what you are missing',
  '/who': 'Who was seen where',
  '/pop': 'Planes of Power flag progress',
  '/roadmap': 'What shipped and what is next',
  '/me': 'Your characters, buffs and stats',
  '/admin': 'Officer tools',
};
