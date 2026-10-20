// /about: the Tour (Tour.tsx). Pictures first, one line per stop, the long text folded under each.
//
// The guild lead picked this layout on 2026-10-19 (DECISIONS §383, from the §47 previews). The earlier
// one-column story page and the Illustrated variant were deleted in the same change.
//
// Stats are live from Supabase, cached for an hour: this page gets shared, and hammering the DB for a
// marketing page would be silly. `force-dynamic` is deliberately NOT used.

import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { AboutTour, type AboutStats } from './Tour';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'About',
  description:
    'How a Discord bot that answered one question grew into a four-part raid platform for Project Quarm — and what it does now.',
};

const ZERO: AboutStats = {
  characters: 0, who: 0, snapshots: 0, buffs: 0, uploads: 0, members: 0,
  raid_avg: 0, raid_biggest: 0, raids: 0, max_parsers: 0,
  pvp: 0, fights_apr: 0, damage_apr: 0, bosses_apr: 0,
};

// One RPC, ~200ms. Doing this from PostgREST instead took 32 SECONDS — see the
// migration for why (full scans on million-row tables, plus three
// count(distinct) over the snapshot stream). Never re-expand this into
// per-table counts.
async function getStats(): Promise<AboutStats> {
  try {
    const { data, error } = await supabaseAdmin().rpc('about_stats');
    if (error || !data) return ZERO;
    return { ...ZERO, ...(data as Partial<AboutStats>) };
  } catch {
    // A stats outage must not 500 the page — the story is the point, the
    // numbers are the flourish. Zeros render as zeros.
    return ZERO;
  }
}

export default async function AboutPage() {
  return <AboutTour s={await getStats()} />;
}
