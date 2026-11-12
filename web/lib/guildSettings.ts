// A guild's own settings, the rules half (the guild lead, 2026-11-12, Decision Desk: per-guild settings live in a database
// row edited by officers on their website). Table: supabase/migrations/20261112130000_guild_settings.sql, one row per guild,
// column `settings` jsonb. The reader is guildSettingsLoad.ts; the editor is web/app/guilds/[slug]/settings.
//
// Pure on purpose: no database, no framework, nothing from the `@/` alias and no node-only import, so the settings form (a
// browser component) validates and previews with the SAME functions the server action checks with, and a test runs every
// rule directly. The only runtime dependency is the platform's Intl, used for time zones (no library).
//
// FIRST SLICE. These settings are saved and the next raid is shown; attendance ticks, the sign-in gates and DKP still use
// their built-in values until each is switched over. Nothing here changes what those do.

export const SETTINGS_VERSION = 1;

export const ROLE_TIERS = ['leader', 'officer', 'raider', 'member', 'recruit', 'alt'] as const;
export type RoleTier = (typeof ROLE_TIERS)[number];
export const JOBS = ['loot', 'dkp', 'recruiting', 'schedule', 'triggers'] as const;
export type Job = (typeof JOBS)[number];

export interface GuildSettings {
  v: 1;
  schedule: { tz: string; days: number[]; start: string; end: string; planEnd: string; nightCutoffHour: number };
  /** Each entry is a Discord role id (all digits) or a role name. */
  roles: Record<RoleTier, string[]>;
  /** Roles (same entry format) that hold each job. The leader tier always holds every job. */
  jobs: Record<Job, string[]>;
  dkp: { provider: 'opendkp' | 'none'; client: string; pool: number | null; ticksPerNight: number; bidMin: number; bidMax: number; auctionMinutes: number };
  guests: { allow: boolean; passHours: number };
  links: { discordInvite: string; website: string };
}

const emptyRoles = (): Record<RoleTier, string[]> => ({ leader: [], officer: [], raider: [], member: [], recruit: [], alt: [] });
const emptyJobs = (): Record<Job, string[]> => ({ loot: [], dkp: [], recruiting: [], schedule: [], triggers: [] });

/** What a new guild starts from: no days picked, no roles mapped, no DKP, no guests. Neutral on purpose. */
export const DEFAULT_SETTINGS: GuildSettings = {
  v: 1,
  schedule: { tz: 'UTC', days: [], start: '20:00', end: '23:00', planEnd: '23:00', nightCutoffHour: 6 },
  roles: emptyRoles(),
  jobs: emptyJobs(),
  dkp: { provider: 'none', client: '', pool: null, ticksPerNight: 4, bidMin: 1, bidMax: 50000, auctionMinutes: 3 },
  guests: { allow: false, passHours: 6 },
  links: { discordInvite: '', website: '' },
};

/**
 * Wolf Pack's values today. Must equal the seed row in the migration (test/guild-settings.test.js compares them).
 * Sources: utils/timezone.js RAID_DAYS / RAID_WINDOW_START / RAID_WINDOW_END; utils/raidNight.js DEFAULT_ROLLOVER_HOUR (6);
 * utils/dkpTick.js MAX_REGULAR_TICKS (4) and OPENDKP_POOL_ID (5); utils/opendkp.js OPENDKP_CLIENT_NAME ('wolfpack');
 * utils/wishlistRules.js BID_MIN / BID_MAX; commands/loot.js LOOT_DEFAULT_BID_MINUTES (3).
 */
export const WOLFPACK_SEED: GuildSettings = {
  v: 1,
  schedule: { tz: 'America/New_York', days: [0, 3, 4], start: '20:30', end: '23:30', planEnd: '00:30', nightCutoffHour: 6 },
  roles: { leader: ['Pack Leader'], officer: ['Officer'], raider: ['Raid Pack'], member: ['Pack Member'], recruit: ['Raid Recruit', 'Recruit'], alt: ['Raid Alt'] },
  jobs: emptyJobs(),
  dkp: { provider: 'opendkp', client: 'wolfpack', pool: 5, ticksPerNight: 4, bidMin: 1, bidMax: 50000, auctionMinutes: 3 },
  guests: { allow: true, passHours: 6 },
  links: { discordInvite: '', website: 'https://wolfpack.quest' },
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ── Parsing: one pass serves both "read what is stored" (invalid falls back) and "check what was typed" (invalid is an error) ──
export type SettingsErrors = Record<string, string>;
export type SettingsCheck = { ok: true; values: GuildSettings } | { ok: false; errors: SettingsErrors };

const HM_RX = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const ROLE_ENTRY_MAX = 64;
export const ROLE_LIST_MAX = 20;
const ID_RX = /^[0-9]{17,20}$/;
const DIGITS_RX = /^[0-9]+$/;

export const toMinutes = (hm: string): number | null => {
  const m = HM_RX.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

// A list typed as "a, b" or stored as ["a","b"]. Bad entries are dropped and reported; duplicates (any case) collapse.
function parseEntries(raw: unknown, path: string, errors: SettingsErrors): string[] {
  if (raw === undefined || raw === null) return [];
  const items: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\n]/) : (errors[path] = 'Use a list of role names or ids.', []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (typeof it !== 'string') { errors[path] = 'Each entry is a role name or a role id.'; continue; }
    // eslint-disable-next-line no-control-regex
    const e = it.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!e) continue;
    if (e.length > ROLE_ENTRY_MAX) { errors[path] = `A role name is at most ${ROLE_ENTRY_MAX} characters.`; continue; }
    if (DIGITS_RX.test(e) && !ID_RX.test(e)) { errors[path] = 'A number is read as a Discord role id, which is 17 to 20 digits.'; continue; }
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  if (out.length > ROLE_LIST_MAX) { errors[path] = `At most ${ROLE_LIST_MAX} roles per list.`; return out.slice(0, ROLE_LIST_MAX); }
  return out;
}

const SITE_MAX = 200;
function parseUrl(raw: unknown, path: string, errors: SettingsErrors, hostOk?: (host: string, pathname: string) => boolean, what = 'website'): string {
  if (raw === undefined || raw === null) return '';
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (typeof raw !== 'string') { errors[path] = `The ${what} address must be text.`; return ''; }
  if (!s) return '';
  try {
    const u = new URL(s);
    if (s.length <= SITE_MAX && u.protocol === 'https:' && !u.username && !u.password && (!hostOk || hostOk(u.hostname.toLowerCase(), u.pathname))) return s;
  } catch { /* falls through */ }
  errors[path] = `The ${what} address must be a full https address, up to ${SITE_MAX} characters.`;
  return '';
}
const isDiscordInvite = (host: string, p: string) => host === 'discord.gg' || ((host === 'discord.com' || host === 'www.discord.com') && p.startsWith('/invite/'));

function parse(input: unknown): { values: GuildSettings; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  const v = clone(DEFAULT_SETTINGS);
  if (input === undefined || input === null) return { values: v, errors };
  if (!isObj(input)) { errors._ = 'Settings must be an object.'; return { values: v, errors }; }

  // schedule
  const s = input.schedule;
  if (s !== undefined && !isObj(s)) errors.schedule = 'The schedule must be an object.';
  if (isObj(s)) {
    if (s.tz !== undefined) { if (validTimeZone(s.tz)) v.schedule.tz = s.tz; else errors['schedule.tz'] = 'That is not a time zone this site knows. Pick one from the list.'; }
    if (s.days !== undefined) {
      if (Array.isArray(s.days) && s.days.every(d => isInt(d, 0, 6))) v.schedule.days = Array.from(new Set(s.days as number[])).sort((a, b) => a - b);
      else errors['schedule.days'] = 'Days are 0 (Sunday) to 6 (Saturday).';
    }
    for (const k of ['start', 'end', 'planEnd'] as const) {
      if (s[k] === undefined) continue;
      if (typeof s[k] === 'string' && HM_RX.test(s[k] as string)) v.schedule[k] = s[k] as string;
      else errors[`schedule.${k}`] = 'Use a 24-hour time like 20:30.';
    }
    if (s.nightCutoffHour !== undefined) { if (isInt(s.nightCutoffHour, 0, 12)) v.schedule.nightCutoffHour = s.nightCutoffHour; else errors['schedule.nightCutoffHour'] = 'The hour a raid night rolls over is 0 to 12.'; }
  }
  if (v.schedule.start === v.schedule.end) {
    if (!errors['schedule.end'] && !errors['schedule.start']) errors['schedule.end'] = 'A raid cannot start and end at the same time.';
    v.schedule.end = DEFAULT_SETTINGS.schedule.end;
    if (v.schedule.start === v.schedule.end) v.schedule.start = DEFAULT_SETTINGS.schedule.start;
  }

  // roles and jobs
  for (const [key, tiers] of [['roles', ROLE_TIERS], ['jobs', JOBS]] as const) {
    const part = input[key];
    if (part !== undefined && !isObj(part)) { errors[key] = `The ${key} must be an object.`; continue; }
    if (!isObj(part)) continue;
    for (const t of tiers) if (part[t] !== undefined) (v[key] as Record<string, string[]>)[t] = parseEntries(part[t], `${key}.${t}`, errors);
  }

  // dkp
  const d = input.dkp;
  if (d !== undefined && !isObj(d)) errors.dkp = 'The DKP settings must be an object.';
  if (isObj(d)) {
    if (d.provider !== undefined) { if (d.provider === 'opendkp' || d.provider === 'none') v.dkp.provider = d.provider; else errors['dkp.provider'] = 'Pick OpenDKP or none.'; }
    if (v.dkp.provider === 'opendkp') {
      if (d.client !== undefined) { if (typeof d.client === 'string' && /^[a-z0-9][a-z0-9-]{1,38}$/i.test(d.client.trim())) v.dkp.client = d.client.trim().toLowerCase(); else errors['dkp.client'] = 'The OpenDKP name is letters, numbers and dashes (it is the part before .opendkp.com).'; }
      if (d.pool !== undefined && d.pool !== null) { if (isInt(d.pool, 1, 9999)) v.dkp.pool = d.pool; else errors['dkp.pool'] = 'The DKP pool is a whole number from 1 to 9999.'; }
      if (d.ticksPerNight !== undefined) { if (isInt(d.ticksPerNight, 1, 12)) v.dkp.ticksPerNight = d.ticksPerNight; else errors['dkp.ticksPerNight'] = 'Ticks per night is 1 to 12.'; }
      if (d.bidMin !== undefined) { if (isInt(d.bidMin, 0, 1_000_000)) v.dkp.bidMin = d.bidMin; else errors['dkp.bidMin'] = 'The smallest bid is a whole number from 0 to 1,000,000.'; }
      if (d.bidMax !== undefined) { if (isInt(d.bidMax, 1, 1_000_000)) v.dkp.bidMax = d.bidMax; else errors['dkp.bidMax'] = 'The largest bid is a whole number from 1 to 1,000,000.'; }
      if (d.auctionMinutes !== undefined) { if (isInt(d.auctionMinutes, 1, 60)) v.dkp.auctionMinutes = d.auctionMinutes; else errors['dkp.auctionMinutes'] = 'An auction lasts 1 to 60 minutes.'; }
      if (v.dkp.bidMin > v.dkp.bidMax) { errors['dkp.bidMax'] = errors['dkp.bidMax'] ?? 'The largest bid cannot be below the smallest.'; v.dkp.bidMin = DEFAULT_SETTINGS.dkp.bidMin; v.dkp.bidMax = DEFAULT_SETTINGS.dkp.bidMax; }
    }
  }

  // guests
  const g = input.guests;
  if (g !== undefined && !isObj(g)) errors.guests = 'The guest settings must be an object.';
  if (isObj(g)) {
    if (g.allow !== undefined) { if (typeof g.allow === 'boolean') v.guests.allow = g.allow; else errors['guests.allow'] = 'Allow guests is yes or no.'; }
    if (g.passHours !== undefined) { if (isInt(g.passHours, 1, 168)) v.guests.passHours = g.passHours; else errors['guests.passHours'] = 'A guest pass lasts 1 to 168 hours.'; }
  }

  // links
  const l = input.links;
  if (l !== undefined && !isObj(l)) errors.links = 'The links must be an object.';
  if (isObj(l)) {
    v.links.discordInvite = parseUrl(l.discordInvite, 'links.discordInvite', errors, isDiscordInvite, 'Discord invite');
    v.links.website = parseUrl(l.website, 'links.website', errors);
  }
  return { values: v, errors };
}

/** What is stored, made safe: unknown or invalid fields read as the defaults. Never throws. */
export function mergeSettings(saved: unknown): GuildSettings {
  try { return parse(saved).values; } catch { return clone(DEFAULT_SETTINGS); }
}

/** What an officer typed: the clean values, or every field that is wrong (keys like `schedule.tz`). Never throws. */
export function validateSettings(input: unknown): SettingsCheck {
  try {
    const { values, errors } = parse(input);
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
  } catch {
    return { ok: false, errors: { _: 'Those settings could not be read.' } };
  }
}

// ── Roles and jobs ───────────────────────────────────────────────────────────────────────────────────────────
/**
 * Does any configured entry match what a person holds? An all-digit entry is a Discord role id; anything else is a role name,
 * compared without regard to case. `ids` and `names` are the person's role ids and role names; `held` is any mix of the two
 * (a caller that has only one list passes it here).
 */
export function entriesMatch(entries: readonly string[], held: readonly string[], ids: readonly string[], names: readonly string[]): boolean {
  const idSet = new Set([...ids, ...held].map(String));
  const nameSet = new Set([...names, ...held].map(n => String(n).trim().toLowerCase()));
  return entries.some(e => (DIGITS_RX.test(e) ? idSet.has(e) : nameSet.has(e.trim().toLowerCase())));
}

/** The leader tier holds every job; anyone else holds a job when one of its roles matches. An unknown job is nobody's. */
export function hasJob(settings: GuildSettings, held: readonly string[], ids: readonly string[], names: readonly string[], job: Job): boolean {
  if (entriesMatch(settings.roles.leader, held, ids, names)) return true;
  const entries = (JOBS as readonly string[]).includes(job) ? settings.jobs[job] : null;
  return !!entries && entriesMatch(entries, held, ids, names);
}

// ── The schedule, in the guild's own zone ────────────────────────────────────────────────────────────────────
export type RaidWindow = { startMs: number; endMs: number; planEndMs: number };
type Sched = GuildSettings['schedule'];

const _fmt = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  let f = _fmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    _fmt.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}

// The zone's offset from UTC at an instant, in ms (east is positive).
function offsetAt(ms: number, tz: string): number {
  const sec = Math.floor(ms / 1000) * 1000;
  const p = parts(sec, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - sec;
}

// A wall-clock time in the zone to an instant: `minutes` after local midnight of y-m-d (may run past 1440, which rolls into the next
// days). The offset is taken twice so a time on the far side of a DST change lands right; a time that does not exist (the spring gap)
// lands just after the gap.
function wallToMs(y: number, m: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d) + minutes * 60_000;
  const o1 = offsetAt(guess, tz);
  const t = guess - o1;
  const o2 = offsetAt(t, tz);
  return o2 === o1 ? t : guess - o2;
}

const deltaMin = (from: number, to: number) => ((to - from) % 1440 + 1440) % 1440;

// The window that starts on local calendar day y-m-d, or null when that weekday is not a raid day.
function windowOn(sc: Sched, y: number, m: number, d: number): RaidWindow | null {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (!sc.days.includes(dow)) return null;
  const start = toMinutes(sc.start);
  const end = toMinutes(sc.end);
  const plan = toMinutes(sc.planEnd);
  if (start === null || end === null) return null;
  const endDelta = deltaMin(start, end) || 1440;
  const planDelta = plan === null ? endDelta : Math.max(deltaMin(start, plan) || 1440, endDelta);   // plans never end before the raid
  return {
    startMs: wallToMs(y, m, d, start, sc.tz),
    endMs: wallToMs(y, m, d, start + endDelta, sc.tz),
    planEndMs: wallToMs(y, m, d, start + planDelta, sc.tz),
  };
}

// Raid windows from the local day before `now` through `ahead` days after it, earliest first. [] for a bad zone.
function windowsAround(sc: Sched, now: number, ahead: number): RaidWindow[] {
  if (!validTimeZone(sc.tz) || !Number.isFinite(now)) return [];
  const p = parts(now, sc.tz);
  const out: RaidWindow[] = [];
  for (let i = -1; i <= ahead; i++) {
    const day = new Date(Date.UTC(p.y, p.m - 1, p.d + i));   // calendar arithmetic only; Date.UTC rolls month ends
    const w = windowOn(sc, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    if (w) out.push(w);
  }
  return out;
}

const ms = (t: number | Date) => (t instanceof Date ? t.getTime() : t);

/** True from the start of a raid up to (not including) its end, in the guild's zone, also for a raid that ends after midnight. */
export function inRaidWindow(schedule: Sched, now: number | Date): boolean {
  const t = ms(now);
  return windowsAround(schedule, t, 0).some(w => t >= w.startMs && t < w.endMs);
}

/** The raid that is on now or, failing that, the next one to start; null when no day is chosen (or the zone is unknown). */
export function nextRaid(schedule: Sched, now: number | Date): RaidWindow | null {
  const t = ms(now);
  return windowsAround(schedule, t, 8).find(w => w.endMs > t) ?? null;
}

// ── Words for the schedule ───────────────────────────────────────────────────────────────────────────────────
/** "Wed, 8:30 PM EST" in the given zone. */
export function formatInZone(t: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(t));
  } catch { return new Date(t).toISOString(); }
}

/** "in 3 days", "in 2 hours", "in 15 minutes", "now" (never negative: a start that has passed reads as now). */
export function relativeTime(t: number, now: number | Date): string {
  const diff = Math.max(0, t - ms(now));
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `in ${min} minute${min === 1 ? '' : 's'}`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} days`;
}

/** The line the settings page and the guild page show; null when there is nothing to say. */
export function nextRaidLine(schedule: Sched, now: number | Date): string | null {
  const w = nextRaid(schedule, now);
  if (!w) return null;
  const t = ms(now);
  return w.startMs <= t ? `Raid on now (started ${formatInZone(w.startMs, schedule.tz)})` : `${formatInZone(w.startMs, schedule.tz)} (${relativeTime(w.startMs, t)})`;
}

export const COMMON_ZONES: readonly string[] = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage',
  'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Australia/Sydney', 'UTC',
];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
