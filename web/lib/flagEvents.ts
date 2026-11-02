// The rules for posting a flag event (web/app/pop/flag-events), as pure functions so the server action and the tests
// run the same code: which target, when (the officer types Eastern time), how long a note may be, and which events the
// page shows. No database and no React.

import { flagTargetByKey } from './flagTargets';
import { RAID_TZ } from './guild';

export const NOTE_MAX = 200;
export const RH_ID_MAX = 64;
/** The board shows events this far ahead, and the ones that began this far back as "recent". */
export const UPCOMING_DAYS = 14;
export const RECENT_DAYS = 3;
/** An event that began a few hours ago is still tonight's, not "recent". */
export const TONIGHT_GRACE_HOURS = 4;
/** A new event may not be dated earlier than a day ago (a typo in the year) or further out than this. */
const MAX_AHEAD_DAYS = 90;
const MAX_BEHIND_MS = 24 * 3600_000;

const DAY_MS = 24 * 3600_000;

/** The offset of `zone` from UTC at an instant, in ms (Eastern is negative). */
function zoneOffsetMs(utcMs: number, zone: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find(x => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}

/**
 * "2026-11-05T20:00" (what a datetime-local input sends, read as Eastern wall-clock time) to a UTC ISO instant, or
 * null when it is not a real date. The offset is found twice so an hour either side of a clock change still lands
 * on the right instant.
 */
export function easternLocalToIso(local: unknown, zone: string = RAID_TZ): string | null {
  if (typeof local !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const probe = new Date(wall);
  // Date.UTC rolls 31 February over into March; a real date comes back unchanged.
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59) return null;
  const first = wall - zoneOffsetMs(wall, zone);
  const utc = wall - zoneOffsetMs(first, zone);
  return new Date(utc).toISOString();
}

export type EventForm = { target_key: unknown; starts_at: unknown; note: unknown; rh_event_id: unknown };
export type ParsedEvent = { target_key: string; starts_at: string; note: string | null; rh_event_id: string | null };
export type ParseResult = { ok: true; value: ParsedEvent } | { ok: false; code: 'target' | 'when' | 'note' | 'rh' };

/**
 * Validate a posted event. Everything comes from the browser, so every field is checked here and not trusted from the
 * form's own limits: the target must be in the catalog, the time a real Eastern date near now, the note short.
 * `rh_event_id` is only checked for shape; the action confirms the event exists in this guild.
 */
export function parseEventForm(form: EventForm, now: Date = new Date()): ParseResult {
  if (typeof form.target_key !== 'string' || !flagTargetByKey(form.target_key)) return { ok: false, code: 'target' };
  const startsAt = easternLocalToIso(form.starts_at);
  if (!startsAt) return { ok: false, code: 'when' };
  const t = Date.parse(startsAt);
  if (t < now.getTime() - MAX_BEHIND_MS || t > now.getTime() + MAX_AHEAD_DAYS * DAY_MS) return { ok: false, code: 'when' };

  let note: string | null = null;
  if (form.note != null && form.note !== '') {
    if (typeof form.note !== 'string') return { ok: false, code: 'note' };
    const trimmed = form.note.trim();
    if (trimmed.length > NOTE_MAX) return { ok: false, code: 'note' };
    // A note is plain text drawn as text; control characters (a pasted newline run, a NUL) have no place in it.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed)) return { ok: false, code: 'note' };
    note = trimmed || null;
  }

  let rh: string | null = null;
  if (form.rh_event_id != null && form.rh_event_id !== '') {
    if (typeof form.rh_event_id !== 'string' || form.rh_event_id.length > RH_ID_MAX || !/^[A-Za-z0-9_-]+$/.test(form.rh_event_id)) {
      return { ok: false, code: 'rh' };
    }
    rh = form.rh_event_id;
  }
  return { ok: true, value: { target_key: form.target_key, starts_at: startsAt, note, rh_event_id: rh } };
}

/** The messages the page may show for `?error=<code>`: a closed list, so the address bar can never put text on the page. */
export const ERROR_TEXT: Record<string, string> = {
  target: 'Pick a target from the list.',
  when: 'That date and time does not work. Use a real Eastern time from yesterday to 90 days ahead.',
  note: `The note can be at most ${NOTE_MAX} characters of plain text.`,
  rh: 'That Raid-Helper event is not one of ours.',
  officer: 'Only officers can post or remove events.',
  member: 'Your Discord account is not linked to a Wolf Pack member, so the event could not be signed.',
  save: 'Could not save. Try again in a minute.',
  id: 'That event was not found.',
};

export type WindowRow = { starts_at: string };

/** The events to show: coming up (from a few hours ago to two weeks out, soonest first) and recent (the last three
 *  days, newest first). Anything outside both is dropped. */
export function splitEventWindow<T extends WindowRow>(events: readonly T[], now: Date = new Date()): { upcoming: T[]; recent: T[] } {
  const n = now.getTime();
  const tonightFrom = n - TONIGHT_GRACE_HOURS * 3600_000;
  const upcoming: T[] = [];
  const recent: T[] = [];
  for (const e of events) {
    const t = Date.parse(e.starts_at);
    if (!Number.isFinite(t)) continue;
    if (t >= tonightFrom && t <= n + UPCOMING_DAYS * DAY_MS) upcoming.push(e);
    else if (t < tonightFrom && t >= n - RECENT_DAYS * DAY_MS) recent.push(e);
  }
  upcoming.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  recent.sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  return { upcoming, recent };
}

/** The read window the page asks the database for, so it fetches no more than it shows. */
export function eventReadWindow(now: Date = new Date()): { from: string; to: string } {
  return {
    from: new Date(now.getTime() - RECENT_DAYS * DAY_MS).toISOString(),
    to: new Date(now.getTime() + UPCOMING_DAYS * DAY_MS).toISOString(),
  };
}
