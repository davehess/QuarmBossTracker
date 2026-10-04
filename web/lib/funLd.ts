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
// 2. "Raids since" counts RAID NIGHTS (public.raid_nights), not calendar days
//    with an encounter. A Saturday group night is not a raid.

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
  /** The LDs that count, oldest first. */
  counted: Ld[];
  /** Distinct /quit events forgiven, for the "N /quit forgiven" line. */
  forgivenEvents: number;
  /** What "It was a /quit" would mark: the most recent LD that still counts. */
  mark: Ld | null;
  /** What "Undo /quit" would restore: the latest forgiven LD, when it is newer than every counted one. */
  undo: Ld | null;
};

export function ldView(lds: Ld[]): LdView {
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

/** The raid nights (from raid_nights.date) that at least one of these encounter starts falls on. */
export function attendedNights(startsMs: number[], raidNights: Iterable<string>): Set<string> {
  const nights = new Set(raidNights);
  const out = new Set<string>();
  for (const t of startsMs) {
    if (!Number.isFinite(t)) continue;
    const n = raidNightOf(t);
    if (nights.has(n)) out.add(n);
  }
  return out;
}

/**
 * `since`: attended raid nights after the last LD's night. `best`: the most
 * attended nights between any two consecutive LDs. Both are strict: the night an
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
