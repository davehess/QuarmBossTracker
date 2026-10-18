// /share/raid/<token>: a raid session shared by an officer, readable WITHOUT signing in. New page, so it goes live
// with the [beta] marker (a plain one: the members' NewPageTag links into member pages, and this page has none).
//
// WHAT MAKES IT SAFE (lib/raidShare.ts has the model; docs/PRIVACY.md says it in words):
//   * the token is the whole credential. The page hashes it and looks the hash up; unknown, expired and revoked
//     are the same 404;
//   * the window comes from the share ROW. This file reads no search parameter at all, and the replay's routes
//     (/api/share/raid/<token>/*) take the token, not a time (test/raid-share.test.js holds both);
//   * the review is loaded by the same loader the members' page uses, so what is shown is what a member would see
//     for that window, minus anything about a character who opted out;
//   * noindex everywhere, no link into a member page (the middleware gives /share/* a bare shell, see
//     app/layout.tsx), and no cookie is read or set for the visitor.
//   * abuse (the guild lead, 2026-10-17; lib/shareGuard.ts): a per-IP limit runs BEFORE the token is looked up and a
//     per-share hourly ceiling right after; over either, the visitor gets a short "busy" notice and no database
//     work. The review is the loader's own five-minute per-window cache; the view count writes at most once per
//     visitor per 30 minutes (noteView).
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveShare, noteView } from '@/lib/raidShareLookup';
import { BUSY_MESSAGE, ceilingPage, clientIp, guardPage } from '@/lib/shareGuard';
import { loadSessionReview } from '@/lib/raidSessionLoad';
import SessionReview from '@/app/raid/session/SessionReview';

export const dynamic = 'force-dynamic';

// A static name: the title of a shared page is not read from the database before the token is checked.
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: '[beta] Shared raid session',
    description: 'A raid session shared by Wolf Pack: the replay with who was there, the kills, the loot and the rolls.',
    robots: { index: false, follow: false, nocache: true },
  };
}

const etStamp = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const etDate = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });

const Busy = () => (
  <div role="note" className="mx-auto max-w-xl py-16 text-center">
    <p className="text-lg text-gold">{BUSY_MESSAGE}</p>
  </div>
);

export default async function SharedRaidSession({ params }: { params: { token: string } }) {
  const h = headers();
  if (!guardPage(h, params.token).ok) return <Busy />;
  const sb = supabaseAdmin();
  const share = await resolveShare(sb, params.token);
  if (!share) notFound();
  if (!ceilingPage(share.row.id).ok) return <Busy />;

  const [review] = await Promise.all([loadSessionReview(sb, share.win), noteView(sb, share.row, clientIp(h))]);

  return (
    <div className="mx-auto max-w-6xl py-2">
      <div role="note" className="mb-4 flex flex-wrap items-center gap-x-2 rounded-md border border-orange/50 bg-orange/10 px-3 py-1.5 font-mono text-xs text-orange">
        <b className="tracking-wider">[beta]</b>
        <span>New page, still being shaped.</span>
      </div>
      <p className="text-xs text-dim">
        Shared by Wolf Pack · expires {etDate.format(Date.parse(share.row.expires_at))} · you do not need an account to read this page
      </p>
      <h1 className="mt-1 text-2xl text-gold">{share.row.title || 'Raid session'}</h1>
      <p className="mt-1 mb-4 text-sm text-dim">
        {etStamp.format(share.win.fromMs)} to {etStamp.format(share.win.toMs)} ET. Tap a time in any list to see that moment on the map.
        Characters who opted out of stats are left out.
      </p>
      <SessionReview bundle={review.bundle} night={review.night} mode={{ kind: 'share', token: params.token }} />
    </div>
  );
}
