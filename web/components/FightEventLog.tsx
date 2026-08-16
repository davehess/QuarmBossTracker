// FightEventLog — the fight's deaths, raid-wide events, and callout fires as a
// collapsible chronological LIST (Hitya 2026-08-16: "The fight timeline view
// with Raid Events are useless in this format. We should be able to see those
// below. Open up an arrow down to see the names of those events/tts/etc.").
//
// This replaces the FightTimeline marker chart ON /parses/[id] only — the
// marker view still earns its keep on /raid/review, where the vertical death
// stack is the wipe-spotting read across many fights. Here the question is
// "what fired and when", and dots can't answer it; names can.
//
// Server component on purpose: <details>/<summary> gives the arrow-down without
// any client JS. Consecutive repeats of the same event/callout collapse into
// one row with a ×N and a time range, because a personal trigger that fired 40
// times would otherwise bury everything else.
//
// FUTURE (Hitya, same review): per-type/per-callout toggles to hide the ones
// that are personal to one character. That needs client state and probably a
// per-user preference; when it lands, this component goes 'use client' and the
// grouped rows below become the toggle rows. Design note lives in
// docs/DESIGN-fight-timeline.md.

import type { TLEvent } from '@/components/FightTimeline';

type TLDeath = { name: string; ts: string; class?: string | null; riposteDeath?: boolean };

const C = {
  death: '#f85149',
  event: '#ffa657',
  fire:  '#58a6ff',
};
// Same per-subtype hues as the FightTimeline markers (#105) so the two
// surfaces never disagree about what a color means.
const EVENT_C: Record<string, string> = {
  slow_on:  '#d29922',
  slow_off: '#f0883e',
  mob_heal: '#56d364',
  disc:     '#a371f7',
};

function mmss(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Row = {
  t: number;                 // epoch ms of the FIRST occurrence
  tLast: number;             // epoch ms of the last occurrence in the run
  count: number;
  color: string;
  kindLabel: string;         // "death" | "raid event" | "callout"
  label: string;
  detail?: string | null;    // class for deaths, actor for events when present
};

export function FightEventLog({
  startedAt, durationSec, deaths, events = [], fires = [],
}: {
  startedAt: string;
  durationSec: number | null;
  deaths: TLDeath[];
  events?: (TLEvent & { actor?: string | null })[];
  fires?: (TLEvent & { actor?: string | null })[];
}) {
  const start = new Date(startedAt).getTime();

  const raw: Row[] = [
    ...deaths.map(d => ({
      t: new Date(d.ts).getTime(), tLast: new Date(d.ts).getTime(), count: 1,
      color: C.death, kindLabel: 'death',
      label: `☠ ${d.name}${d.riposteDeath ? ' (riposte kill)' : ''}`,
      detail: d.class || null,
    })),
    ...events.map(e => ({
      t: new Date(e.at).getTime(), tLast: new Date(e.at).getTime(), count: 1,
      color: (e.subtype && EVENT_C[e.subtype]) || C.event, kindLabel: 'raid event',
      label: e.label, detail: e.actor || null,
    })),
    ...fires.map(f => ({
      t: new Date(f.at).getTime(), tLast: new Date(f.at).getTime(), count: 1,
      color: C.fire, kindLabel: 'callout',
      label: `📢 ${f.label}`, detail: f.actor || null,
    })),
  ].filter(r => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);

  // Collapse consecutive repeats of the SAME thing into one ×N row. Only
  // adjacent runs fold — the sequence "Rampage, Melee out, Rampage" stays three
  // rows because the interleaving is the story.
  const rows: Row[] = [];
  for (const r of raw) {
    const prev = rows[rows.length - 1];
    if (prev && prev.kindLabel === r.kindLabel && prev.label === r.label && (prev.detail || '') === (r.detail || '')) {
      prev.count += 1;
      prev.tLast = r.t;
    } else {
      rows.push({ ...r });
    }
  }

  const nDeaths = deaths.length;
  const nEvents = events.length;
  const nFires  = fires.length;
  if (rows.length === 0) return null;

  const timeOf = (r: Row) => {
    const from = mmss((r.t - start) / 1000);
    if (r.count === 1) return from;
    return `${from}–${mmss((r.tLast - start) / 1000)}`;
  };

  return (
    <section className="bg-panel border border-border rounded-lg p-4 md:p-5">
      <details className="group">
        <summary className="cursor-pointer select-none text-sm text-orange flex items-center gap-2 flex-wrap [&::-webkit-details-marker]:hidden list-none">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>▸</span>
          <span>🕒 Fight timeline</span>
          <span className="text-[11px] text-dim font-normal">
            {durationSec ? `${mmss(durationSec)} · ` : ''}
            {nDeaths} death{nDeaths === 1 ? '' : 's'} · {nEvents} raid event{nEvents === 1 ? '' : 's'} · {nFires} callout{nFires === 1 ? '' : 's'} — open for the full list
          </span>
        </summary>
        <ul className="mt-3 text-xs space-y-0.5">
          {rows.map((r, i) => (
            <li key={i} className="flex items-baseline gap-2">
              <span className="text-dim font-mono whitespace-nowrap w-[86px] shrink-0 text-right">{timeOf(r)}</span>
              <span className="inline-block w-2 h-2 rounded-full shrink-0 self-center" style={{ backgroundColor: r.color }} aria-hidden />
              <span className="text-[10px] text-dim uppercase tracking-wide w-[64px] shrink-0">{r.kindLabel}</span>
              <span className="text-text min-w-0">
                {r.label}
                {r.count > 1 && <span className="text-dim"> ×{r.count}</span>}
                {r.detail && <span className="text-dim"> · {r.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
