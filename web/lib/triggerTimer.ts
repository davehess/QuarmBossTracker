// Guild-trigger countdown / warning / repeat fields — the save-time rules for /admin/triggers.
//
// A guild trigger can carry a visible countdown (`timer_duration_sec`), a pre-end callout
// (`warning_seconds` + `warning_text`) and, since agent 3.7.99, a repeat (`timer_loop`, with an
// optional `timer_loop_max`). All of them were SQL-only until the form gained these fields. The
// agent honours each of them only in combination — a warning needs a countdown to cross, a repeat
// needs one to restart — and it silently ignores a half-set pair, which is how a "warning" typed
// into SQL with no text read as coverage and never spoke. So the form refuses what the agent would
// ignore, and says why.
//
// Pure and import-free on purpose: the server action in page.tsx and the live check in
// TimerFields.tsx run the SAME function, and the root vitest suite imports it directly.

/** The agent clamps a countdown to an hour (`Math.min(3600, …)`), so more is not representable. */
export const MAX_COUNTDOWN_SEC = 3600;
/** The agent clamps a repeat limit to 1000 (`Math.min(_lm, 1000)`). */
export const MAX_REPEATS = 1000;
/** The agent slices the warning text to 200 characters. */
export const MAX_WARNING_TEXT = 200;

/** What the form hands over: the raw field values, exactly as typed. */
export type TimerInput = {
  countdown: string;
  warnAt:    string;
  warnText:  string;
  loop:      boolean;
  loopMax:   string;
};

/** The columns written to guild_triggers. Unset is NULL (and `timer_loop` false), never 0 or ''. */
export type TimerColumns = {
  timer_duration_sec: number | null;
  warning_seconds:    number | null;
  warning_text:       string | null;
  timer_loop:         boolean;
  timer_loop_max:     number | null;
};

/** Which input a problem belongs to, so the form can mark it. */
export type TimerField = 'countdown' | 'warnAt' | 'warnText' | 'loop' | 'loopMax';

export type TimerResult =
  | { ok: true;  columns: TimerColumns }
  | { ok: false; field: TimerField; error: string };

type Count = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * A non-negative whole number from a text box. Blank is "not set" (null). Signs, decimals,
 * exponents and thousands separators are all rejected rather than rounded: `parseInt('3.9')` is 3
 * and `parseInt('1e3')` is 1, which would save something the officer did not type.
 */
function parseCount(raw: string, label: string, max: number): Count {
  const s = String(raw ?? '').trim();
  if (s === '') return { ok: true, value: null };
  if (!/^\d+$/.test(s)) return { ok: false, error: `${label} must be a whole number, 0 or more.` };
  const n = Number(s);
  if (n > max) return { ok: false, error: `${label} can be at most ${max.toLocaleString('en-US')}.` };
  return { ok: true, value: n };
}

/**
 * Validate and normalise the five fields.
 *
 *  · Countdown 0 or blank = no countdown (NULL).
 *  · A warning is a PAIR — seconds before the end plus the words — and needs a countdown it is
 *    strictly shorter than (a warning at or past the start would fire the instant the timer does).
 *  · Repeat needs a countdown. "Max repeats" blank or 0 = until cancelled (NULL; the agent reads
 *    0 as no limit too), and is dropped when Repeat is off.
 */
export function parseTimerFields(input: TimerInput): TimerResult {
  const fail = (field: TimerField, error: string): TimerResult => ({ ok: false, field, error });

  const countdown = parseCount(input.countdown, 'Countdown', MAX_COUNTDOWN_SEC);
  if (!countdown.ok) return fail('countdown', countdown.error);
  const warnAt = parseCount(input.warnAt, 'Warn at', MAX_COUNTDOWN_SEC);
  if (!warnAt.ok) return fail('warnAt', warnAt.error);
  // Only read when Repeat is on: the box is disabled otherwise, and a stale entry in it is not an error.
  const loopMax: Count = input.loop ? parseCount(input.loopMax, 'Max repeats', MAX_REPEATS) : { ok: true, value: null };
  if (!loopMax.ok) return fail('loopMax', loopMax.error);

  const timer = countdown.value || null;
  const warnSec = warnAt.value || null;
  const warnText = String(input.warnText ?? '').trim().slice(0, MAX_WARNING_TEXT) || null;

  if (warnSec && !warnText) return fail('warnText', 'A warning needs its text: say what to call out.');
  if (warnText && !warnSec) return fail('warnAt', 'The warning text needs a time: how many seconds before the end to say it.');
  if (warnSec && !timer) return fail('warnAt', 'A warning needs a countdown to count down from. Set the countdown, or clear the warning.');
  if (warnSec && timer && warnSec >= timer) {
    return fail('warnAt', `Warn at (${warnSec}s) must be shorter than the countdown (${timer}s): it is seconds before the end.`);
  }
  if (input.loop && !timer) return fail('loop', 'Repeat needs a countdown to restart. Set the countdown, or untick Repeat.');

  return {
    ok: true,
    columns: {
      timer_duration_sec: timer,
      warning_seconds:    warnSec,
      warning_text:       warnText,
      timer_loop:         !!input.loop,
      timer_loop_max:     loopMax.value || null,
    },
  };
}

/** The raw input from FormData-style getters, so the server action and tests build it one way. */
export function timerInputFrom(get: (name: string) => unknown): TimerInput {
  const s = (k: string) => String(get(k) ?? '');
  return {
    countdown: s('timer_duration_sec'),
    warnAt:    s('warning_seconds'),
    warnText:  s('warning_text'),
    loop:      get('timer_loop') === 'on',
    loopMax:   s('timer_loop_max'),
  };
}

/** One short line for the trigger list: "60s countdown · warns at 10s · repeats ×5". '' when none. */
export function describeTimer(t: {
  timer_duration_sec?: number | null;
  warning_seconds?: number | null;
  warning_text?: string | null;
  timer_loop?: boolean | null;
  timer_loop_max?: number | null;
}): string {
  const parts: string[] = [];
  const sec = Number(t.timer_duration_sec) || 0;
  if (sec > 0) parts.push(`${sec}s countdown`);
  if (sec > 0 && Number(t.warning_seconds) > 0 && t.warning_text) parts.push(`warns at ${Number(t.warning_seconds)}s`);
  if (sec > 0 && t.timer_loop === true) {
    const m = Number(t.timer_loop_max) || 0;
    parts.push(m > 0 ? `repeats up to ${m}×` : 'repeats until cancelled');
  }
  return parts.join(' · ');
}
