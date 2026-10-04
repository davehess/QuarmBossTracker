// Pure logic behind the /fun linkdead card ("Raids since … crashed"). No imports
// on purpose: test/fun-ld-quit.test.js loads this file as-is.
//
// Two rules live here, both from the guild lead (2026-10-04):
//
// 1. A /quit is not a linkdead. Raiders' agents upload a `peopleslayer_ld`
//    fun_events row whenever THEIR log says "<name> has gone Linkdead." A /quit
//    drops the connection exactly like a crash, so no observer can tell them
//    apart; the player (or an officer) marks it by hand instead, by merging
//    {quit, by, at} into the row's `detail`. Several raiders upload the same LD a
//    few seconds apart, so marking and undoing act on every row within
//    QUIT_WINDOW_MS of the chosen one.
//
// 2. Only an LD DURING A REAL RAID counts, and "raids since" counts real raids.
//    A real raid is one the officers logged in OpenDKP (public.opendkp_raids), and
//    he attended it when his name is in one of its ticks (public.opendkp_ticks).
//    public.raid_nights is NOT that record: the bot opens a row for ANY encounter
//    on a Sun/Wed/Thu evening and has none for an off-schedule raid, so a Saturday
//    group night or an empty Wednesday looked like a raid. An LD at 10:00 on a
//    raid DATE is not during the raid either, so the clock has to fit too.

export const QUIT_WINDOW_MS = 2 * 60_000;

/** The marks `withQuit` writes into `detail` and `withoutQuit` takes back out. */
const QUIT_KEYS = ['quit', 'by', 'at'] as const;

export type Detail = Record<string, unknown> | null;
export type LdRow = { id?: number | string | null; event_ts: string; target: string | null; detail?: Detail };
export type Ld = {
  id: number | string | null;
  ts: number;
  zone: string | null;
  detail: Detail;
  /** Marked /quit, or within the window of a row that is (see parseLds). */
  forgiven: boolean;
};

export function isQuit(detail: unknown): boolean {
  return !!detail && typeof detail === 'object' && (detail as Record<string, unknown>).quit === true;
}

/**
 * Rows -> LDs, oldest first. A row is forgiven when it carries `quit: true`
 * itself OR sits within the window of a row that does: a raider's queued upload
 * of the same LD can land after the override was made, and that late copy must
 * not bring the crash back.
 */
export function parseLds(rows: LdRow[]): Ld[] {
  const all = rows
    .map(r => ({ id: r.id ?? null, ts: new Date(r.event_ts).getTime(), zone: r.target, detail: r.detail ?? null }))
    .filter(r => Number.isFinite(r.ts))
    .sort((a, b) => a.ts - b.ts);
  const quitTs = all.filter(r => isQuit(r.detail)).map(r => r.ts);
  return all.map(r => ({ ...r, forgiven: quitTs.some(q => Math.abs(q - r.ts) <= QUIT_WINDOW_MS) }));
}

/** Distinct LD events: rows chained within the window are one crash seen by several raiders. */
export function countEvents(lds: Ld[]): number {
  let n = 0;
  let prev = -Infinity;
  for (const l of [...lds].sort((a, b) => a.ts - b.ts)) {
    if (l.ts - prev > QUIT_WINDOW_MS) n++;
    prev = l.ts;
  }
  return n;
}

export type LdView = {
  /** The LDs that count (during a real raid, not forgiven), oldest first. */
  counted: Ld[];
  /** Distinct /quit events forgiven during a raid, for the "N /quit forgiven" line. */
  forgivenEvents: number;
  /** What "It was a /quit" would mark: the most recent LD that still counts. */
  mark: Ld | null;
  /** What "Undo /quit" would restore: the latest forgiven LD, when it is newer than every counted one. */
  undo: Ld | null;
};

/**
 * `raidDates` is not optional: the page and the server action must read the same
 * list, or "the LD I would mark" and "the LD on screen" drift apart. An LD outside
 * a raid is dropped here, before anything else, so it is not counted, not "last",
 * not forgiven, and not offered to the button.
 */
export function ldView(allLds: Ld[], raidDates: ReadonlySet<string>): LdView {
  const lds = allLds.filter(l => isDuringRaid(l.ts, raidDates));
  const counted = lds.filter(l => !l.forgiven);
  const forgiven = lds.filter(l => l.forgiven);
  const lastCounted = counted.length ? counted[counted.length - 1] : null;
  const lastForgiven = forgiven.length ? forgiven[forgiven.length - 1] : null;
  return {
    counted,
    forgivenEvents: countEvents(forgiven),
    mark: lastCounted,
    undo: lastForgiven && (!lastCounted || lastForgiven.ts > lastCounted.ts) ? lastForgiven : null,
  };
}

/** Every LD within the window of `ts` — the sibling uploads of one crash. */
export function siblingsOf(lds: Ld[], ts: number): Ld[] {
  return lds.filter(l => Math.abs(l.ts - ts) <= QUIT_WINDOW_MS);
}

export function withQuit(detail: Detail, by: string | null, atIso: string): Record<string, unknown> {
  return { ...(detail ?? {}), quit: true, by, at: atIso };
}

/** Takes the marks back out; a detail that was only the marks goes back to null. */
export function withoutQuit(detail: Detail): Detail {
  if (!detail) return null;
  const rest: Record<string, unknown> = { ...detail };
  for (const k of QUIT_KEYS) delete rest[k];
  return Object.keys(rest).length ? rest : null;
}

// ── Who may press the button ────────────────────────────────────────────────
/** The Discord account behind a Supabase user (the same lookup /pvp/[name] does). */
export function viewerDiscordId(user: { app_metadata?: unknown; user_metadata?: unknown } | null | undefined): string | null {
  if (!user) return null;
  const app = (user.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const id = app.provider_id ?? meta.provider_id ?? meta.sub ?? null;
  return id == null || id === '' ? null : String(id);
}

/**
 * The character's own player, or an officer. Callers pass `officer` from
 * isOfficer() and `ownerDiscordIds` from characters.discord_id; a null on either
 * side never matches a null on the other.
 */
export function mayMarkQuit(a: {
  discordId: string | null;
  ownerDiscordIds: Array<string | null | undefined>;
  officer: boolean;
}): boolean {
  if (a.officer) return true;
  return a.discordId != null && a.discordId !== '' && a.ownerDiscordIds.some(o => o === a.discordId);
}

// ── Raid nights ─────────────────────────────────────────────────────────────
const ET_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

/**
 * The raid night an instant belongs to, as 'YYYY-MM-DD'. Raids run roughly
 * 8pm to midnight Eastern, which is 00:00-04:00 UTC of the NEXT day, so the date
 * is the Eastern one — not the UTC one. And a raid that runs past midnight is
 * still the previous night's, so the date is taken 5 hours back: anything before
 * 05:00 Eastern belongs to the day before.
 */
export function raidNightOf(ms: number): string {
  const p = Object.fromEntries(ET_DATE.formatToParts(new Date(ms - 5 * 3_600_000)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// ── Real raids (OpenDKP) ────────────────────────────────────────────────────
const ET_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23',
});

/**
 * A raid's date, 'YYYY-MM-DD', from opendkp_raids.ts. OpenDKP keeps a raid's date
 * as NOON UTC of that date, so the UTC calendar date IS the raid's date (no
 * Eastern conversion: that is for LD instants, which carry a real time of day).
 */
export function raidDateOf(ts: string | number | Date | null | undefined): string | null {
  if (ts == null) return null;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

/** Every distinct raid date in opendkp_raids. */
export function raidDatesOf(raids: Array<{ ts: string | null }>): Set<string> {
  const out = new Set<string>();
  for (const r of raids) {
    const d = raidDateOf(r.ts);
    if (d) out.add(d);
  }
  return out;
}

/**
 * Was this instant during a real raid? Its raid night (Eastern date, 5 hours
 * back, see raidNightOf) must be a raid date, AND the Eastern clock must be
 * between 19:00 and 05:00: the same 5 hours back puts that window at hour >= 14.
 * Without the clock, a 10:00 LD on a raid date, hours before the pull, would count.
 */
export function isDuringRaid(ms: number, raidDates: ReadonlySet<string>): boolean {
  if (!Number.isFinite(ms) || !raidDates.has(raidNightOf(ms))) return false;
  return Number(ET_HOUR.format(new Date(ms - 5 * 3_600_000))) >= 14;
}

/**
 * The raid dates he attended: any raid on the date with a tick that lists him.
 * `ticks` is what the page pulls, only the ticks that name him, so a row here is
 * a hit; a raid_id with no raid row is ignored.
 */
export function attendedRaidDates(raids: Array<{ raid_id: number | string; ts: string | null }>, ticks: Array<{ raid_id: number | string }>): Set<string> {
  const dateOf = new Map(raids.map(r => [String(r.raid_id), raidDateOf(r.ts)]));
  const out = new Set<string>();
  for (const t of ticks) {
    const d = dateOf.get(String(t.raid_id));
    if (d) out.add(d);
  }
  return out;
}

/**
 * The PostgREST `or` filter that finds the ticks naming a character. PostgREST
 * cannot match an array element case-insensitively, so the likely spellings are
 * listed instead; OpenDKP stores one canonical spelling per name (checked
 * 2026-10-04: all 420 ticks since January used 'Peopleslayer'), and a filter in
 * the query keeps every tick's whole attendee list out of the page's egress.
 */
export function attendeeFilter(name: string): string {
  const lower = name.toLowerCase();
  const spellings = new Set([name, lower, name.toUpperCase(), lower.charAt(0).toUpperCase() + lower.slice(1)]);
  return [...spellings].map(n => `attendees.cs.{${n}}`).join(',');
}

/**
 * `since`: attended raid dates after the last LD's night. `best`: the most
 * attended dates between any two consecutive LDs. Both are strict: the night an
 * LD happened on is not a night he got through, on either side. `countedLdMs`
 * must be the LDs that count, oldest first.
 */
export function raidStreaks(countedLdMs: number[], attended: Set<string>): { since: number; best: number } {
  if (countedLdMs.length === 0) return { since: 0, best: 0 };
  const nights = [...attended];
  const nightsBetween = (lo: string, hi: string) => nights.filter(n => n > lo && n < hi).length;
  const lds = countedLdMs.map(raidNightOf);
  let best = 0;
  for (let i = 0; i < lds.length - 1; i++) best = Math.max(best, nightsBetween(lds[i], lds[i + 1]));
  return { since: nightsBetween(lds[lds.length - 1], '9999-99-99'), best };
}
