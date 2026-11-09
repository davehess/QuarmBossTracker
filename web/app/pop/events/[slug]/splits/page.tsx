// /pop/events/<slug>/splits: the gold splits of one scripted event (DECISIONS §555; the guild lead, 2026-11-09: "make
// gold splits a site feature for every event, linked for replays and parses").
//
// New page, so it goes live with the [beta] tag. Members only, like the rest of /pop. The first and largest thing on it
// is the stacked timelines (a client component: click an event to line every run up on it); below them the splits table.
// The attempts are found in the encounter rows (web/lib/eventAttempts.ts), the maths is web/lib/goldSplits.ts, and
// each event's key moments are web/lib/eventSplitsDefs.ts. Every moment links to its parse and every run to its replay.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import NewPageTag from '@/components/NewPageTag';
import { pageMetadata } from '@/lib/pageMetaData';
import { parseHref, replayHref } from '@/lib/eventAttempts';
import { loadEventAttempts } from '@/lib/eventAttemptsLoad';
import { computeSplits, fmtClock, momentsShown } from '@/lib/goldSplits';
import SplitsTimeline, { type TLAttempt } from './SplitsTimeline';

export async function generateMetadata({ params }: { params: { slug: string } }) {
  return pageMetadata(`/pop/events/${encodeURIComponent(params.slug)}/splits`);
}

export const dynamic = 'force-dynamic';

const when = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

export default async function EventSplitsPage({ params }: { params: { slug: string } }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/pop/events/${encodeURIComponent(params.slug)}/splits`);

  let loaded;
  try {
    loaded = await loadEventAttempts(params.slug);
  } catch (e) {
    return (
      <div className="mx-auto max-w-6xl py-2">
        <NewPageTag note="New page: every recorded attempt of a scripted event, with gold splits." />
        <p className="rounded border border-red/50 bg-red/10 p-3 text-sm text-red">
          The attempts did not load ({e instanceof Error ? e.message : 'unknown error'}). Reload in a minute.
        </p>
      </div>
    );
  }
  if (!loaded) notFound();
  const { event, def, attempts } = loaded;

  const n = momentsShown(def.generic, def.moments.length, attempts);
  const moments = def.moments.slice(0, n).map((mo, i) => {
    let label = mo.label;
    if (mo.group) {
      const first = def.moments.findIndex(x => x.group === mo.group);
      label = `${def.groupLabels[mo.group] ?? 'Kill'} ${i - first + 1}`;
    }
    return { key: mo.key, label };
  });
  const npcName = new Map(event.npcs.map(x => [x.npcId, x.name]));
  const sp = computeSplits(n, attempts);

  const tl: TLAttempt[] = attempts.map(a => ({
    key: a.key,
    when: when(a.startMs),
    success: a.success,
    wiped: a.wiped,
    rel: moments.map((_, i) => a.moments[i]?.relSec ?? null),
    names: moments.map((_, i) => (a.moments[i] ? npcName.get(a.moments[i]!.npcId) ?? null : null)),
    fromIso: new Date(a.windowFromMs).toISOString(),
    toIso: new Date(a.windowToMs).toISOString(),
  }));

  return (
    <div className="mx-auto max-w-6xl py-2">
      <NewPageTag note="New page: every recorded attempt of a scripted event, with gold splits." />
      <h1 className="text-2xl text-gold">{event.name}</h1>
      <p className="mt-1 text-xs text-dim">
        {event.zoneName} · gold splits
        {' · '}
        <Link href="/pop/events/splits" className="text-blue hover:underline">All events with attempts</Link>
        {' · '}
        <Link href={`/pop/events#${event.slug}`} className="text-blue hover:underline">The event and its loot</Link>
      </p>

      {attempts.length === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-panel p-4 text-sm text-dim">
          No attempt of this event is recorded yet. The first run an uploader sees fills this page.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <SplitsTimeline moments={moments} attempts={tl} replayBase="/spectator/replay" />
          </div>

          <h2 className="mt-8 text-sm font-semibold uppercase tracking-wider text-dim">Splits</h2>
          <p className="mt-1 max-w-3xl text-xs text-dim">
            Each cell is the time since the step before it, with the running time under it. <b className="text-gold">Gold</b> is
            the best that step was ever run. The sum of the golds is the best run these attempts add up to, and an attempt&apos;s
            time save is how much quicker it would have been with every gold.
            {def.generic && ' This event has no hand-written steps yet: the start is the first fight, then its named mobs in the order they died.'}
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="bg-panel text-[11px] uppercase tracking-wider text-dim">
                <tr>
                  <th className="px-2 py-2">Step</th>
                  <th className="px-2 py-2 text-right">Gold</th>
                  {attempts.map(a => (
                    <th key={a.key} className="px-2 py-2 text-right font-normal">
                      <div className="text-text">{when(a.startMs)}</div>
                      <a href={replayHref(a)} className="normal-case text-blue hover:underline">replay</a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {moments.map((mo, i) => (
                  <tr key={mo.key} className="border-t border-border align-top">
                    <td className="px-2 py-1.5 text-text">{mo.label}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-gold">{i === 0 ? '' : fmtClock(sp.gold[i])}</td>
                    {attempts.map((a, ai) => {
                      const mm = a.moments[i];
                      const seg = sp.attempts[ai].segments[i];
                      const isGold = i > 0 && seg != null && seg === sp.gold[i];
                      return (
                        <td key={a.key} className={`px-2 py-1.5 text-right tabular-nums ${isGold ? 'border border-gold bg-gold/10 text-gold' : ''}`}>
                          {mm ? (
                            <>
                              <a href={parseHref(mm.encounterId)} className="hover:underline" title={`${npcName.get(mm.npcId) ?? mo.label}: open the parse`}>
                                {i === 0 ? fmtClock(0) : fmtClock(seg)}
                              </a>
                              <div className="text-[10px] text-dim">{fmtClock(mm.relSec)}</div>
                              {def.moments[i].group && npcName.get(mm.npcId) && <div className="text-[10px] text-dim">{npcName.get(mm.npcId)}</div>}
                            </>
                          ) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-panel">
                  <td className="px-2 py-1.5 text-text">Sum of best</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gold">
                    <span className="border border-gold bg-gold/10 px-1">{fmtClock(sp.sumOfBest)}</span>
                    {!sp.complete && <div className="text-[10px] text-dim">some steps never run</div>}
                  </td>
                  {attempts.map((a, ai) => (
                    <td key={a.key} className="px-2 py-1.5 text-right tabular-nums text-dim">{ai === sp.bestRun ? 'fastest' : ''}</td>
                  ))}
                </tr>
                <tr className="border-t border-border">
                  <td className="px-2 py-1.5 text-text">Total</td>
                  <td />
                  {sp.attempts.map((s, ai) => (
                    <td key={attempts[ai].key} className="px-2 py-1.5 text-right tabular-nums text-text">{fmtClock(s.total)}</td>
                  ))}
                </tr>
                <tr className="border-t border-border">
                  <td className="px-2 py-1.5 text-text">Possible time save</td>
                  <td />
                  {sp.attempts.map((s, ai) => (
                    <td key={attempts[ai].key} className="px-2 py-1.5 text-right tabular-nums text-dim">{s.timeSave == null ? '—' : `-${fmtClock(s.timeSave)}`}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-dim">
            A dash is a step that run never reached or the uploaders did not see. Kills use the fight&apos;s end; a pull uses its start.
          </p>
        </>
      )}
    </div>
  );
}
