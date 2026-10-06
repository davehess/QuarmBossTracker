'use client';
// The three non-map modes of /screen, and the pieces the right rail shares with them. The map is the
// spectator board itself (app/spectator/SpectatorBoard.tsx, embedded). Everything here draws from data the
// board already holds: the screen state, the slow feed (/api/screen/feed) and the positions feed.
import {
  TONIGHT_H, agoText, parseSlideBody, summarizeRaid, untilText,
  type Award, type FeedKill, type FeedSpawn, type LootedGroup, type ScreenFeed, type ScreenState,
} from '@/lib/raidScreen';
import { fmtDuration } from '@/lib/format';
import type { Positions } from '@/lib/spectator';

export const label = 'text-[11px] uppercase tracking-wider text-dim';
export const card = 'rounded-md border border-border bg-panel';
const btn = 'rounded border border-border bg-panel px-3 py-1.5 text-sm text-text transition-colors hover:bg-[#21262d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue disabled:opacity-40';

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-dim">{children}</p>;
}

// ── Slides ──────────────────────────────────────────────────────────────────

export function SlidesView({ state, canDrive, busy, editing, onStep, onToggleEdit }: {
  state: ScreenState;
  canDrive: boolean;
  busy: boolean;
  editing: boolean;
  onStep: (delta: -1 | 1) => void;
  onToggleEdit: () => void;
}) {
  const { slide, slideIndex, slideCount } = state;
  return (
    <div className={`${card} flex min-h-[50vh] flex-col`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <span className={label}>Slides</span>
        {slideCount > 0 && <span className="text-xs tabular-nums text-dim">{slideIndex + 1} of {slideCount}</span>}
        {canDrive && (
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" className={btn} disabled={busy || slideIndex <= 0} aria-label="Previous slide" onClick={() => onStep(-1)}>◀</button>
            <button type="button" className={btn} disabled={busy || slideIndex >= slideCount - 1} aria-label="Next slide" onClick={() => onStep(1)}>▶</button>
            <button type="button" className={btn} aria-expanded={editing} onClick={onToggleEdit}>Edit slides</button>
          </div>
        )}
      </div>

      {slideCount === 0 && (
        <Empty>
          No slides yet.{canDrive ? ' Use Edit slides to add the first one.' : ' The raid leader has not added any.'}
        </Empty>
      )}
      {slideCount > 0 && !slide && <Empty>Loading the slide…</Empty>}
      {slide && (
        <div className={`grid gap-6 p-4 sm:p-6 ${slide.imageUrl ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
          <div className="min-w-0">
            <h2 className="text-2xl text-gold sm:text-4xl">{slide.title}</h2>
            <div className="mt-4 space-y-4 text-lg leading-relaxed text-text sm:text-2xl sm:leading-relaxed">
              {parseSlideBody(slide.body).map((b, i) => b.kind === 'p'
                ? <p key={i} className="whitespace-pre-line">{b.text}</p>
                : <ul key={i} className="list-disc space-y-2 pl-7">{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>)}
            </div>
          </div>
          {slide.imageUrl && (
            <div className="min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slide.imageUrl} alt={slide.title} loading="lazy" referrerPolicy="no-referrer"
                className="max-h-[70vh] w-full rounded border border-border object-contain" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Loot ────────────────────────────────────────────────────────────────────

function AwardRow({ a, now }: { a: Award; now: number }) {
  return (
    <li className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-text">{a.item}</span>
      <span className="shrink-0 text-xs text-blue">{a.who ?? 'no bids yet'}</span>
      {a.dkp != null && <span className="w-12 shrink-0 text-right text-xs tabular-nums text-gold">{a.dkp}</span>}
      <span className="w-20 shrink-0 text-right text-xs text-dim">
        {a.open ? `closes in ${untilText(a.at, now)}` : agoText(a.at, now)}
      </span>
    </li>
  );
}

export function LootView({ feed, now }: { feed: ScreenFeed | null; now: number }) {
  if (!feed) return <div className={card}><Empty>Loading loot…</Empty></div>;
  const open = feed.awards.filter(a => a.open);
  const done = feed.awards.filter(a => !a.open);
  return (
    <div className="space-y-4">
      {feed.partial && <p role="status" className="text-xs text-orange">Some of the loot did not load. It will retry.</p>}

      <section className={card} aria-label="Up for bid">
        <h2 className={`${label} border-b border-border px-3 py-2`}>Up for bid</h2>
        {open.length > 0
          ? <ul>{open.map(a => <AwardRow key={a.id} a={a} now={now} />)}</ul>
          : <Empty>Nothing was open at the last OpenDKP sync. Live bidding is in Mimic and Discord; this page follows the sync, about every 30 minutes.</Empty>}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Awarded tonight">
          <h2 className={`${label} border-b border-border px-3 py-2`}>Awarded · last {TONIGHT_H} h <span className="text-text">{done.length}</span></h2>
          {done.length > 0
            ? <ul>{done.map(a => <AwardRow key={a.id} a={a} now={now} />)}</ul>
            : <Empty>No awards yet tonight.</Empty>}
        </section>

        <section className={card} aria-label="Picked up">
          <h2 className={`${label} border-b border-border px-3 py-2`}>Picked up · latest</h2>
          {feed.looted.length > 0
            ? <ul>{feed.looted.map(g => <LootedRow key={g.item} g={g} now={now} />)}</ul>
            : <Empty>Nothing looted in the last {TONIGHT_H} hours.</Empty>}
        </section>
      </div>
    </div>
  );
}

function LootedRow({ g, now }: { g: LootedGroup; now: number }) {
  return (
    <li className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
      <span className="min-w-0 flex-1 truncate text-text">{g.item}{g.count > 1 ? ` ×${g.count}` : ''}</span>
      <span className="min-w-0 max-w-[40%] shrink truncate text-xs text-blue">{g.who.join(', ')}</span>
      <span className="w-20 shrink-0 text-right text-xs text-dim">{agoText(g.at, now)}</span>
    </li>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

export function KillList({ kills, now }: { kills: FeedKill[]; now: number }) {
  if (!kills.length) return <Empty>No boss kills in the last {TONIGHT_H} hours.</Empty>;
  return (
    <ul>
      {kills.map(k => (
        <li key={k.id} className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
          <span className="min-w-0 flex-1 truncate text-text">{k.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-dim">{fmtDuration(k.durationSec)}</span>
          <span className="w-20 shrink-0 text-right text-xs text-dim">{agoText(k.at, now)}</span>
        </li>
      ))}
    </ul>
  );
}

export function SpawnList({ spawns, now, max }: { spawns: FeedSpawn[]; now: number; max?: number }) {
  const shown = max ? spawns.slice(0, max) : spawns;
  if (!shown.length) return <Empty>Nothing opens in the next 24 hours.</Empty>;
  return (
    <ul>
      {shown.map(s => {
        const t = untilText(s.at, now);
        return (
          <li key={s.id} className="flex items-baseline gap-2 border-b border-border/60 px-3 py-2 last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-text">{s.name}</span>
              {s.zone && <span className="block truncate text-xs text-dim">{s.zone}</span>}
            </span>
            <span className={`shrink-0 text-sm tabular-nums ${t === 'now' ? 'text-green' : 'text-text'}`}>{t === 'now' ? 'open now' : `in ${t}`}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function OverviewView({ positions, feed, now }: { positions: Positions | null; feed: ScreenFeed | null; now: number }) {
  const zones = positions ? summarizeRaid(positions.raiders, positions.zones) : [];
  const total = positions?.raiders.length ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat n={total} text={total === 1 ? 'raider mapped' : 'raiders mapped'} />
        <Stat n={zones.length} text={zones.length === 1 ? 'zone' : 'zones'} />
        <Stat n={feed ? feed.kills.length : null} text={`boss kills, last ${TONIGHT_H} h`} />
      </div>
      {feed?.partial && <p role="status" className="text-xs text-orange">Some of this did not load. It will retry.</p>}

      <section className={card} aria-label="The raid now">
        <h2 className={`${label} border-b border-border px-3 py-2`}>The raid now</h2>
        {!positions && <Empty>Loading positions…</Empty>}
        {positions && zones.length === 0 && <Empty>No raid positions in the last 30 seconds.</Empty>}
        <ul>
          {zones.map(z => (
            <li key={z.zone} className="border-b border-border/60 px-3 py-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-text">{z.name}</span>
                <span className="text-sm tabular-nums text-text">{z.count}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
                {z.classes.map(c => (
                  <span key={c.cls} className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.abbr} <span className="tabular-nums text-text">{c.count}</span>
                  </span>
                ))}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
                {z.groups.map(g => (
                  <span key={g.group ?? 'none'}>
                    {g.group == null ? 'No group' : `Group ${g.group}`} <span className="tabular-nums text-text">{g.count}</span>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {positions && positions.unplaced > 0 && (
          <p className="border-t border-border px-3 py-2 text-xs text-dim">{positions.unplaced} more with a position but no known zone yet.</p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Boss kills tonight">
          <h2 className={`${label} border-b border-border px-3 py-2`}>Boss kills · last {TONIGHT_H} h</h2>
          {feed ? <KillList kills={feed.kills} now={now} /> : <Empty>Loading…</Empty>}
        </section>
        <section className={card} aria-label="Next spawns">
          <h2 className={`${label} border-b border-border px-3 py-2`}>Next spawns · 24 h</h2>
          {feed ? <SpawnList spawns={feed.spawns} now={now} /> : <Empty>Loading…</Empty>}
        </section>
      </div>
    </div>
  );
}

function Stat({ n, text }: { n: number | null; text: string }) {
  return (
    <div className={`${card} px-3 py-2`}>
      <div className="text-2xl tabular-nums text-text">{n ?? '–'}</div>
      <div className="text-xs text-dim">{text}</div>
    </div>
  );
}
