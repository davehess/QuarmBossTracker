// Shared look and small formatters of the night panel (?v=slices, ?v=segments). Colour is semantic: green is our raid,
// purple an event, orange another guild's raid (and the ring on its fights), grey is time set aside; red is a death.
import { MINUTE_MS } from '@/lib/raidReplay';
import type { SliceKind } from '@/lib/nightSlices';

export const etMin = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
export const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
export const etHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric' });

export const chip = 'rounded border px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue';
export const chipIdle = 'border-border bg-panel text-text hover:bg-[#21262d]';
export const chipOn = 'border-accent bg-accent text-white';
export const field = 'rounded border border-border bg-bg px-2 py-1 text-sm text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue';

/** Full class strings (Tailwind only keeps classes it can read whole). */
export const KIND_BAR: Record<SliceKind, string> = {
  raid: 'border-green bg-green/25 text-green',
  event: 'border-purple bg-purple/25 text-purple',
  other_guild: 'border-orange bg-orange/25 text-orange',
  downtime: 'border-dashed border-dim bg-dim/15 text-dim',
};
export const KIND_DOT: Record<SliceKind, string> = {
  raid: 'bg-green', event: 'bg-purple', other_guild: 'bg-orange', downtime: 'bg-dim',
};

export const fmtSpan = (ms: number) => {
  const m = Math.round(ms / MINUTE_MS);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
export const fmtDur = (sec: number | null) => (sec == null ? '' : sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60 ? ` ${sec % 60}s` : ''}`);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The session page for one window, staying on the same preview variant. */
export const windowHref = (fromMs: number, toMs: number, variant: string) =>
  `/raid/session?from=${encodeURIComponent(new Date(fromMs).toISOString())}&to=${encodeURIComponent(new Date(toMs).toISOString())}&v=${variant}`;

export const newSliceId = () => 'x' + Math.random().toString(36).slice(2, 9).padEnd(6, '0');
