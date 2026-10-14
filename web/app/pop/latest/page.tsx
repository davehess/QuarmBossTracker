// /pop/latest — "Latest flags", the page the guild lead asked for after reading both beta layouts of the /pop
// strip (2026-10-14: "Make me a new beta page to try all of this out"). New page, so it carries the [beta] tag.
//
//   1. Stream — A's verbose rows, newest first. Characters that earned the same steps together are one row with
//      their names A-Z; a recital row shows only steps new to that character; a live raid (raid_roster captured in
//      the last 15 minutes) gets "N in the raid still need this" under each row.
//   2. By stage — B's grouping as collapsible cards in dependency order, each step with who earned it (the list
//      opens) and what relies on it. Open by default: it is the part the guild lead asked to see, and the stream
//      above it is already long.
//   3. Filters — window (24 h / 3 d / 7 d), Mains / All characters, names A-Z / latest first.
//
// The rules and the derivations live in web/lib/popLatestView.ts (pure, tested). Reads, all paged and none per
// character: the verified pop_flags rows (HISTORY_DAYS back, so a repeat can be told from news), the live raid, the
// roster (shared loadRoster: traders, hidden, mains), and one me_levels call for the level filter.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { loadRoster } from '@/lib/roster';
import { loadLevels, LIST_MIN_LEVEL } from '@/lib/listableChars';
import { loadLatestFlagRows } from '@/lib/popLatestFlags';
import {
  DEFAULT_WINDOW, HISTORY_DAYS, RAID_FRESH_MS, WINDOWS, buildView, listingOf, loadRaidNames, parseView,
  type Order, type Scope, type WindowKey,
} from '@/lib/popLatestView';
import NewPageTag from '@/components/NewPageTag';
import Stream from './Stream';
import StageBoard from './StageBoard';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '[beta] Latest flags',
  description: 'The newest Planes of Power flags the server or an NPC recital confirmed, as a stream and as cards in step order, with who in the raid still needs them.',
};

type SP = { w?: string; scope?: string; order?: string };

const chip = (active: boolean) => `px-2 py-0.5 rounded border ${active ? 'border-gold text-gold' : 'border-border hover:text-text'}`;
const WINDOW_LABEL: Record<WindowKey, string> = { '24h': '24 hours', '3d': '3 days', '7d': '7 days' };

export default async function LatestFlagsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=${encodeURIComponent('/pop/latest?' + new URLSearchParams(sp as Record<string, string>))}`);
  const view = parseView(sp);

  const sb = supabaseAdmin();
  const now = Date.now();
  const [roster, rows, raid] = await Promise.all([
    loadRoster(),
    loadLatestFlagRows(sb, now, HISTORY_DAYS),
    loadRaidNames(sb, now),
  ]);
  const levels = await loadLevels(sb, [...new Set([...rows.map(r => r.character), ...(raid ?? [])])]);
  const result = buildView(rows, raid, listingOf(roster), levels, view, now);

  const hrefFor = (over: { w?: WindowKey; scope?: Scope; order?: Order }) => {
    const next = { window: view.window, scope: view.scope, order: view.order, ...over };
    const q = new URLSearchParams();
    if (next.window !== DEFAULT_WINDOW) q.set('w', next.window);
    if (next.scope === 'all') q.set('scope', 'all');
    if (next.order === 'time') q.set('order', 'time');
    const s = q.toString();
    return s ? `/pop/latest?${s}` : '/pop/latest';
  };
  const stepCount = result.board.tiers.reduce((n, t) => n + t.cards.reduce((m, c) => m + c.steps.length, 0), 0);

  return (
    <div className="mx-auto max-w-5xl space-y-4 py-2">
      <NewPageTag note="New page: the latest flags as a stream and as cards in step order, with who in the raid still needs them." />

      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-lg text-orange">Latest flags</h2>
          <span className="text-xs text-dim">
            Confirmed by the server or an NPC recital, last {WINDOW_LABEL[view.window]} · {result.moments} {result.moments === 1 ? 'moment' : 'moments'}
          </span>
          <Link href="/pop" className="ml-auto text-xs text-dim hover:text-text">← PoP flags</Link>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs text-dim items-center">
          <span className="flex gap-1 items-center">
            Window
            {(Object.keys(WINDOWS) as WindowKey[]).map(w => (
              <Link key={w} href={hrefFor({ w })} className={chip(view.window === w)}>{w === '24h' ? '24 h' : w === '3d' ? '3 days' : '7 days'}</Link>
            ))}
          </span>
          <span className="flex gap-1 items-center"
                title="Mains are Pack Leader, Officer, Raid Pack and Recruit characters. Traders, hidden characters and known levels under 46 are left out either way.">
            <Link href={hrefFor({ scope: 'mains' })} className={chip(view.scope === 'mains')}>Mains</Link>
            <Link href={hrefFor({ scope: 'all' })} className={chip(view.scope === 'all')}>All characters</Link>
          </span>
          <span className="flex gap-1 items-center">
            Names
            <Link href={hrefFor({ order: 'az' })} className={chip(view.order === 'az')}>A–Z</Link>
            <Link href={hrefFor({ order: 'time' })} className={chip(view.order === 'time')}>Latest first</Link>
          </span>
        </div>
        <p className="text-[11px] text-dim mt-3">
          {result.raidSize === null
            ? `No raid captured in the last ${RAID_FRESH_MS / 60_000} minutes, so “still need this” is off until one is.`
            : `Live raid: ${result.raidSize} ${view.scope === 'mains' ? 'mains' : 'characters'} captured in the last ${RAID_FRESH_MS / 60_000} minutes. “Still need this” counts only what the server and NPC recitals have told us; a raider with no recital on file counts as not having it.`}
          {' '}Traders, hidden characters and characters under level {LIST_MIN_LEVEL} are left out.
          {result.repeats > 0 && ` ${result.repeats} repeated recital${result.repeats === 1 ? '' : 's'} (flags already held) are not shown.`}
        </p>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4" aria-label="Stream">
        <h3 className="text-base text-orange mb-1">Stream</h3>
        <p className="text-xs text-dim mb-2">
          Newest first. Characters who earned the same steps together are one row. A recital row lists only the steps that were new to that character.
        </p>
        {result.clusters.length === 0
          ? <p className="text-sm text-dim">No new verified flags in the last {WINDOW_LABEL[view.window]}.</p>
          : <Stream clusters={result.clusters} needs={result.needs} now={now} />}
      </section>

      <details open className="bg-panel border border-border rounded-lg p-4">
        <summary className="cursor-pointer text-base text-orange">
          By stage <span className="text-xs text-dim">· {stepCount} steps in {result.board.tiers.reduce((n, t) => n + t.cards.length, 0) + (result.board.other ? 1 : 0)} cards, in the order the server needs them</span>
        </summary>
        <p className="text-xs text-dim my-2">
          Each card is one progression line, steps top to bottom as they unlock. “Unlocks →” names what relies on the step. Dimmed steps were not earned in this window.
        </p>
        {result.board.tiers.length === 0 && !result.board.other
          ? <p className="text-sm text-dim">Nothing to group yet.</p>
          : <StageBoard board={result.board} />}
      </details>
    </div>
  );
}
