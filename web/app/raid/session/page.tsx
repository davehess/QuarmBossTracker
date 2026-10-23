// /raid/session?from=<iso>&to=<iso>: one recorded raid session reviewed in full. New page, so it goes live with the
// [beta] tag.
//
// The replay of the window, with what happened in it beside the picture: who was there and for how long, the kills,
// the loot, the roll sessions and the top damage per fight. Every line with a time seeks the replay. Without
// `from`/`to` the page lists the recent recorded sessions to pick from.
//
// Members only, like /spectator/replay (a signed-in session, 401-style redirect otherwise). An officer also gets
// "Share…", which makes a public link to this exact window (/share/raid/<token>, lib/raidShare.ts). The same
// loader and the same SessionReview render the public page, so a member sees exactly what a shared link shows,
// plus the Brewall map layer the public route may not serve.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { makeWindow, windowIso } from '@/lib/raidShare';
import { loadSessionReview } from '@/lib/raidSessionLoad';
import { liveAvailable, sessionLabel, summarizeNights, type NightMinute } from '@/lib/raidReplay';
import { loadRaidCuts } from '@/lib/raidCuts';
import NewPageTag from '@/components/NewPageTag';
import SessionReview from './SessionReview';
import ShareControls from './ShareControls';

export const metadata: Metadata = {
  title: '[beta] Raid session review',
  description: 'One recorded raid session: the replay with who was there, the kills, the loot, the rolls and the parses beside it.',
};

export const dynamic = 'force-dynamic';

const DAYS = 14;
const etDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const etStamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function RaidSessionPage({ searchParams }: { searchParams: { from?: string | string[]; to?: string | string[]; v?: string | string[] } }) {
  const from = one(searchParams.from);
  const to = one(searchParams.to);
  // ?v=split is the beta preview of "Start a new raid here" (lib/raidSplit.ts). Without it the page is as it was.
  const split = one(searchParams.v) === 'split';
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=' + encodeURIComponent('/raid/session' + (from && to ? `?from=${from}&to=${to}${split ? '&v=split' : ''}` : '')));

  const win = from && to ? makeWindow(Date.parse(from), Date.parse(to)) : null;
  const header = (
    <>
      <NewPageTag note="New page: a raid session, replayed with its attendance, kills, loot and rolls." />
      <h1 className="text-2xl text-gold">Raid session review</h1>
    </>
  );

  if (!win) {
    const sessions = await recentSessions();
    return (
      <div className="mx-auto max-w-6xl py-2">
        {header}
        <p className="mt-1 mb-4 text-sm text-dim">
          {from || to ? 'That window was not usable (it must be under 24 hours). ' : ''}
          Pick a recorded session. <Link href="/spectator/replay" className="underline hover:text-text">Back to the replay</Link>.
        </p>
        {sessions.length === 0 ? (
          <p className="rounded-md border border-border bg-panel p-4 text-sm text-dim">No sessions were recorded in the last {DAYS} days.</p>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map(s => (
              <li key={s.from}>
                <Link href={s.href} className="block rounded-md border border-border bg-panel px-3 py-2 text-sm hover:bg-[#21262d]">
                  <span className="text-text">{s.day}</span> <span className="text-dim">· {s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const admin = supabaseAdmin();
  const [review, officer] = await Promise.all([loadSessionReview(admin, win), isOfficer(user.id)]);
  const { from: fromIso, to: toIso } = windowIso(win);

  return (
    <div className="mx-auto max-w-6xl py-2">
      {header}
      <p className="mt-1 mb-4 text-sm text-dim">
        {etStamp.format(win.fromMs)} to {etStamp.format(win.toMs)} ET. Tap a time in any list to see that moment on the map.{' '}
        <Link href="/raid/session" className="underline hover:text-text">Other sessions</Link>.
      </p>
      <SessionReview
        bundle={review.bundle}
        night={review.night}
        mode={{ kind: 'member' }}
        extras={officer ? <ShareControls fromIso={fromIso} toIso={toIso} defaultTitle={`Raid session, ${etDay.format(win.fromMs)}`} splitAtMs={review.change?.atMs ?? null} /> : undefined}
        split={split ? { change: review.change, live: liveAvailable(win.toMs, Date.now()), canShare: officer } : undefined}
      />
    </div>
  );
}

/** The last two weeks of recorded sessions, newest first, each a link that opens its review. */
async function recentSessions() {
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const rows = await selectAll<NightMinute>((from, to) => supabaseAdmin().from('raid_track_minutes')
    .select('night_key, minute_at, zones, raiders')
    .eq('guild_id', GUILD_TAG)
    .gte('minute_at', since)
    .order('minute_at')
    .range(from, to));
  const cuts = await loadRaidCuts(supabaseAdmin(), rows).catch(() => []);
  return summarizeNights(rows, cuts)
    .flatMap(n => n.sessions.map(s => ({ n, s })))
    .sort((a, b) => b.s.from - a.s.from)
    .map(({ s }) => ({
      from: s.from,
      day: etDay.format(s.from),
      label: sessionLabel(s),
      href: `/raid/session?from=${encodeURIComponent(new Date(s.from).toISOString())}&to=${encodeURIComponent(new Date(s.to).toISOString())}`,
    }));
}
