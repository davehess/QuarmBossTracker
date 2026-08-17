// FightEventLog — the fight's deaths, raid-wide events, and callout fires as a
// collapsible chronological LIST (Hitya 2026-08-16: "The fight timeline view
// with Raid Events are useless in this format… Open up an arrow down to see
// the names of those events/tts/etc.", and the second round the same night:
// better look, no personal-range callouts, no 0:00 wall).
//
// This replaces the FightTimeline marker chart ON /parses/[id] only — the
// marker view still earns its keep on /raid/review, where the vertical death
// stack is the wipe-spotting read across many fights.
//
// All assembly logic (noise filter, "(copy)" normalization, windowed folding,
// pre-start split) lives in web/lib/fightEvents.ts and is unit-tested — this
// file only renders. Server component on purpose: <details>/<summary> gives
// the arrow-down without client JS.
//
// FUTURE (Hitya): per-type/per-callout toggles to hide the ones personal to
// one character. Needs client state; when it lands this goes 'use client' and
// the folded rows become the toggle rows. docs/DESIGN-fight-timeline.md.

import type { TLEvent } from '@/components/FightTimeline';
import { buildEventLog, offsetLabel, type FightEventIn, type FightEventRow } from '@/lib/fightEvents';

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

const KIND_LABEL: Record<FightEventRow['kind'], string> = {
  death: 'death', raid_event: 'raid event', fire: 'callout',
};

function dotColor(r: FightEventRow): string {
  if (r.kind === 'death') return C.death;
  if (r.kind === 'fire') return C.fire;
  return (r.subtype && EVENT_C[r.subtype]) || C.event;
}

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

  // Labels stay RAW here — the noise filter matches on them ("Too Far"), so
  // any display prefix added this early would defeat it. The ☠/📢 glyphs are
  // render-time decoration in <Row>, keyed off kind.
  const input: FightEventIn[] = [
    ...deaths.map((d): FightEventIn => ({
      atMs: new Date(d.ts).getTime(), kind: 'death',
      label: `${d.name}${d.riposteDeath ? ' (riposte kill)' : ''}`,
      detail: d.class || null,
    })),
    ...events.map((e): FightEventIn => ({
      atMs: new Date(e.at).getTime(), kind: 'raid_event',
      label: e.label, detail: e.actor || null, subtype: e.subtype,
    })),
    ...fires.map((f): FightEventIn => ({
      atMs: new Date(f.at).getTime(), kind: 'fire',
      label: f.label, detail: f.actor || null,
    })),
  ];
  const log = buildEventLog(input, start);
  if (log.main.length === 0 && log.early.length === 0) return null;

  const nDeaths = deaths.length;
  const nEvents = events.length;
  const nFires  = fires.length;
  const dur = durationSec ? offsetLabel(start + durationSec * 1000, start) : null;

  const timeOf = (r: FightEventRow) => {
    const from = offsetLabel(r.t, start);
    const to = offsetLabel(r.tLast, start);
    return (r.count === 1 || from === to) ? from : `${from}–${to}`;
  };

  const Row = ({ r }: { r: FightEventRow }) => (
    <li className="flex items-baseline gap-2">
      <span className="text-dim font-mono whitespace-nowrap w-[92px] shrink-0 text-right text-[11px]">{timeOf(r)}</span>
      <span
        className="inline-block w-2 h-2 rounded-full shrink-0 self-center"
        style={{ backgroundColor: dotColor(r) }}
        title={KIND_LABEL[r.kind]}
        aria-label={KIND_LABEL[r.kind]}
      />
      <span className="text-text min-w-0 leading-5">
        {r.kind === 'death' ? '☠ ' : r.kind === 'fire' ? '📢 ' : ''}{r.label}
        {r.count > 1 && <span className="text-orange font-semibold"> ×{r.count}</span>}
        {/* Rampage/enrage labels already open with the mob's name — repeating
            it as the actor suffix doubled every line on the trash cards. */}
        {r.detail && !r.label.toLowerCase().startsWith(r.detail.toLowerCase()) && (
          <span className="text-dim"> · {r.detail}</span>
        )}
      </span>
    </li>
  );

  return (
    <section className="bg-panel border border-border rounded-lg p-4 md:p-5">
      <details className="group">
        <summary className="cursor-pointer select-none text-sm text-orange flex items-center gap-2 flex-wrap [&::-webkit-details-marker]:hidden list-none">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>▸</span>
          <span>🕒 Fight timeline</span>
          <span className="text-[11px] text-dim font-normal">
            {dur ? `${dur} · ` : ''}
            {nDeaths} death{nDeaths === 1 ? '' : 's'} · {nEvents} raid event{nEvents === 1 ? '' : 's'} · {nFires} callout{nFires === 1 ? '' : 's'}
            {log.noiseHidden > 0 && <> · {log.noiseHidden} range-check callout{log.noiseHidden === 1 ? '' : 's'} hidden</>}
            {' — open for the full list'}
          </span>
        </summary>

        {log.early.length > 0 && (
          <details className="mt-3 ml-1">
            <summary
              className="cursor-pointer select-none text-[11px] text-dim hover:text-text"
              title="This card's window overlaps a neighboring pull (same-name trash merges do this), so some events carry timestamps from before this fight's recorded start. Times below are negative offsets from the pull."
            >
              ▸ {log.early.reduce((a, r) => a + r.count, 0)} events from before this pull (merged trash window)
            </summary>
            <ul className="mt-2 text-xs space-y-0.5 opacity-80">
              {log.early.map((r, i) => <Row key={`e${i}`} r={r} />)}
            </ul>
          </details>
        )}

        <ul className="mt-3 text-xs space-y-0.5">
          {log.main.map((r, i) => <Row key={i} r={r} />)}
        </ul>
      </details>
    </section>
  );
}
