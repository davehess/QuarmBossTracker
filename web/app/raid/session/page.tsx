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
//
// Under the replay: "Start a new raid here" (lib/raidSplit.ts; two back-to-back raids are one recorded session) and
// the night sliced into segments an officer confirms (lib/nightSlices.ts), with the night's named fights and mass
// deaths. Both were beta previews (?v=split, ?v=segments) until the guild lead picked them, 2026-10-23.
//
// `&group=<id>` (with `gf`/`gt`, the window the raids were counted in) narrows the whole review to ONE raid of the
// window: a window holds everyone any uploader saw, and two raids on the ground at once read as one roster (the guild
// lead, 2026-10-26). lib/sessionGroups.ts finds the raids; RaidGroupsBar and the night strip name them.
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
import { loadNightMarks, loadSlices } from '@/lib/nightSlicesLoad';
import { slicesIn } from '@/lib/nightSlices';
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

export default async function RaidSessionPage({ searchParams }: { searchParams: { from?: string | string[]; to?: string | string[]; group?: string | string[]; gf?: string | string[]; gt?: string | string[] } }) {
  const from = one(searchParams.from);
  const to = one(searchParams.to);
  // `group` narrows the review to one raid of the window (lib/sessionGroups.ts); anything but a plausible id is ignored.
  const wanted = /^[a-z0-9-]{3,40}$/.test(one(searchParams.group)) ? one(searchParams.group) : null;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=' + encodeURIComponent('/raid/session' + (from && to ? `?from=${from}&to=${to}${wanted ? `&group=${wanted}` : ''}` : '')));

  const win = from && to ? makeWindow(Date.parse(from), Date.parse(to)) : null;
  // `gf`/`gt`: the larger window the raids were counted in, when this one is a part of it (lib/sessionGroups.ts groupQuery).
  const parent = wanted && one(searchParams.gf) && one(searchParams.gt) ? makeWindow(Date.parse(one(searchParams.gf)), Date.parse(one(searchParams.gt))) : null;
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
  const [review, officer, slices] = await Promise.all([
    loadSessionReview(admin, win, { breaks: true, groups: true, group: wanted, groupWin: parent }),
    isOfficer(user.id),
    loadSlices(admin),
  ]);
  const raid = review.group && review.groupIndex ? { id: review.group, index: review.groupIndex } : null;
  const marks = await loadNightMarks(admin, win, review.bundle.kills, raid).catch(() => ({ fights: [], deaths: [], mass: [] }));
  const groups = review.groups ?? [];
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
        split={{ change: review.change, live: liveAvailable(win.toMs, Date.now()), canShare: officer }}
        nightPanel={{
          fromMs: win.fromMs, toMs: win.toMs, spans: review.night?.spans ?? [],
          fights: marks.fights, deaths: marks.deaths, mass: marks.mass,
          slices: slicesIn(slices, win), breaks: review.breaks ?? [], canEdit: officer,
          groups, groupsParent: parent ?? win,
        }}
        groups={{ list: groups, active: review.group ?? null, parent: parent ?? win }}
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
