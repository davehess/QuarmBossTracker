// /pop/events/splits: every scripted event with at least one recorded attempt (DECISIONS §555), its best full time, how
// many runs and the last one, each linked to its gold splits. New page, so it goes live with the [beta] tag. Members only.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import NewPageTag from '@/components/NewPageTag';
import { eventBySlug } from '@/lib/popEvents';
import { computeSplits, fmtClock, momentsShown } from '@/lib/goldSplits';
import { loadEventSummaries, type EventSummary } from '@/lib/eventAttemptsLoad';

export const metadata: Metadata = {
  title: '[beta] Gold splits',
  description: 'Every scripted Planes of Power event with a recorded attempt: its best full time, how many runs, and the last one, each linked to its splits.',
};

export const dynamic = 'force-dynamic';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });

export default async function SplitsIndexPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/events/splits');

  let rows: EventSummary[];
  try {
    rows = await loadEventSummaries((def, attempts) => {
      const sp = computeSplits(momentsShown(def.generic, def.moments.length, attempts), attempts);
      return sp.bestRun == null ? null : sp.attempts[sp.bestRun].total;
    });
  } catch (e) {
    return (
      <div className="mx-auto max-w-4xl py-2">
        <NewPageTag note="New page: gold splits for every scripted event." />
        <p className="rounded border border-red/50 bg-red/10 p-3 text-sm text-red">
          The attempts did not load ({e instanceof Error ? e.message : 'unknown error'}). Reload in a minute.
        </p>
      </div>
    );
  }
  rows.sort((a, b) => (b.lastMs ?? 0) - (a.lastMs ?? 0));

  return (
    <div className="mx-auto max-w-4xl py-2">
      <NewPageTag note="New page: gold splits for every scripted event." />
      <h1 className="text-2xl text-gold">Gold splits</h1>
      <p className="mt-1 max-w-2xl text-sm text-dim">
        Every scripted event the raid has run, found in the fight data. Open one to compare its attempts on stacked timelines and see the
        best time of each step. <Link href="/pop/events" className="text-blue hover:underline">All events and their loot</Link>
      </p>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-border bg-panel p-4 text-sm text-dim">No attempt of any scripted event is recorded yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[32rem] text-left text-xs">
            <thead className="bg-panel text-[10px] uppercase tracking-wider text-dim">
              <tr>
                <th className="px-2 py-1.5">Event</th>
                <th className="px-2 py-1.5 text-right">Best full time</th>
                <th className="px-2 py-1.5 text-right">Attempts</th>
                <th className="px-2 py-1.5 text-right">Last attempt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const e = eventBySlug(r.slug);
                if (!e) return null;
                return (
                  <tr key={r.slug} className="border-t border-border">
                    <td className="px-2 py-2">
                      <Link href={`/pop/events/${r.slug}/splits`} className="text-sm text-blue hover:underline">{e.name}</Link>
                      <div className="text-[11px] text-dim">{e.zoneName}</div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gold">{fmtClock(r.bestSec)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.attempts}{r.successes < r.attempts ? <span className="text-dim"> ({r.successes} finished)</span> : null}{r.otherAttempts > 0 ? <div className="text-[10px] text-dim">+{r.otherAttempts} by other guilds</div> : null}</td>
                    <td className="px-2 py-2 text-right text-dim">{r.lastMs ? day(r.lastMs) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
