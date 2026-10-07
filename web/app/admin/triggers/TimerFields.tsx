'use client';

// The countdown, warning and repeat fields of the /admin/triggers form.
//
// The form itself stays a plain server-rendered <form action={createOrUpdate}>, as the rest of the
// page is. This island exists for one reason: the rules between these fields (a warning needs a
// countdown and must be shorter than it; Repeat needs a countdown) can only be checked once more
// than one box has been filled in, and a server-side refusal after the officer has typed a long
// pattern would cost them the form. So the SAME function the server action runs
// (web/lib/triggerTimer.ts) runs here on every keystroke, shows the reason beside the fields, and
// holds the browser's native submit until it is resolved. The server still re-checks on save.

import { useEffect, useRef, useState } from 'react';
import { parseTimerFields, MAX_COUNTDOWN_SEC, MAX_REPEATS, MAX_WARNING_TEXT, type TimerField } from '@/lib/triggerTimer';

export type TimerDefaults = {
  timer_duration_sec: number | null;
  warning_seconds:    number | null;
  warning_text:       string | null;
  timer_loop:         boolean;
  timer_loop_max:     number | null;
};

const box = 'w-full bg-bg border border-border rounded px-2 py-1.5';

export default function TimerFields({ defaults }: { defaults: TimerDefaults }) {
  const [countdown, setCountdown] = useState(defaults.timer_duration_sec ? String(defaults.timer_duration_sec) : '');
  const [warnAt, setWarnAt]       = useState(defaults.warning_seconds ? String(defaults.warning_seconds) : '');
  const [warnText, setWarnText]   = useState(defaults.warning_text ?? '');
  const [loop, setLoop]           = useState(!!defaults.timer_loop);
  const [loopMax, setLoopMax]     = useState(defaults.timer_loop_max ? String(defaults.timer_loop_max) : '');

  const result = parseTimerFields({ countdown, warnAt, warnText, loop, loopMax });
  const refs = useRef<Partial<Record<TimerField, HTMLInputElement | null>>>({});

  // Hand the verdict to the browser: a custom-validity message on the offending input blocks the
  // form's submit and shows the reason in the native bubble, wherever the officer clicks Save.
  useEffect(() => {
    for (const f of ['countdown', 'warnAt', 'warnText', 'loop', 'loopMax'] as TimerField[]) {
      refs.current[f]?.setCustomValidity(!result.ok && result.field === f ? result.error : '');
    }
  });

  const bad = (f: TimerField) => !result.ok && result.field === f;
  const mark = (f: TimerField) => (bad(f) ? 'border-red-400' : '');

  return (
    <fieldset className="sm:col-span-2 border border-border rounded p-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
      <legend className="px-1 text-dim">Countdown, warning and repeat (optional)</legend>

      <label className="space-y-1">
        <span className="text-dim block">Countdown (seconds)</span>
        <input ref={el => { refs.current.countdown = el; }} name="timer_duration_sec" type="number"
          inputMode="numeric" min={0} max={MAX_COUNTDOWN_SEC} step={1}
          value={countdown} onChange={e => setCountdown(e.target.value)}
          placeholder="blank = no countdown" aria-invalid={bad('countdown')}
          className={`${box} ${mark('countdown')}`} />
      </label>
      <label className="space-y-1">
        <span className="text-dim block">Warn at (seconds before the end)</span>
        <input ref={el => { refs.current.warnAt = el; }} name="warning_seconds" type="number"
          inputMode="numeric" min={0} max={MAX_COUNTDOWN_SEC} step={1}
          value={warnAt} onChange={e => setWarnAt(e.target.value)}
          placeholder="blank = no warning" aria-invalid={bad('warnAt')}
          className={`${box} ${mark('warnAt')}`} />
      </label>
      <label className="space-y-1">
        <span className="text-dim block">Warning text (spoken and flashed)</span>
        <input ref={el => { refs.current.warnText = el; }} name="warning_text" maxLength={MAX_WARNING_TEXT}
          value={warnText} onChange={e => setWarnText(e.target.value)}
          placeholder="e.g. Rage in 10" aria-invalid={bad('warnText')}
          className={`${box} ${mark('warnText')}`} />
      </label>

      <label className="flex items-start gap-2 sm:col-span-2 cursor-pointer">
        <input ref={el => { refs.current.loop = el; }} name="timer_loop" type="checkbox"
          checked={loop} onChange={e => setLoop(e.target.checked)} className="mt-0.5" />
        <span className="text-dim leading-5">
          <span className="text-text">↻ Repeat when it ends</span> — the countdown restarts itself each time it
          reaches zero (and warns again), until a raider closes it, the cancel phrase fires or the mob dies.
          Needs agent 3.7.99+; older agents run it once.
        </span>
      </label>
      <label className="space-y-1">
        <span className="text-dim block">Max repeats</span>
        <input ref={el => { refs.current.loopMax = el; }} name="timer_loop_max" type="number"
          inputMode="numeric" min={0} max={MAX_REPEATS} step={1} disabled={!loop}
          value={loop ? loopMax : ''} onChange={e => setLoopMax(e.target.value)}
          placeholder="blank = until cancelled" aria-invalid={bad('loopMax')}
          className={`${box} ${mark('loopMax')} disabled:opacity-40`} />
      </label>

      {!result.ok && (
        <p role="alert" className="sm:col-span-3 text-red-400 leading-5">{result.error}</p>
      )}
    </fieldset>
  );
}
