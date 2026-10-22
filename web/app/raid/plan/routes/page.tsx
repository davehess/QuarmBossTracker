// /raid/plan/routes: the route planner (the guild lead, 2026-10-21: "put the route planner into the site as is ... put it
// into the planner where we can see previous and build in the named and ones in the plan"). New page, so it goes live with
// the [beta] tag.
//
// WHY A STATIC ROUTE with ?zone= and ?plan= (not /route/[zone]): the page title and card are one thing for every zone (the
// zone is in the picker and the tab), so the metadata rule (test/page-metadata.test.js) needs no generateMetadata and no
// database read for a card; the zone and the plan are two small pickers on the same page; and storage is per zone and per
// plan either way (bot_kv route_plan:<zone>).
//
// Members view; officers edit. The officer test only decides what is drawn: every write is re-checked in actions.ts.
// Everything the engine needs arrives as props from here, in one pass: the plan, the fight-card bosses of the zone (the
// bosses "on the plan"), the zone's checklist, and the fewest-raiders rows.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import NewPageTag from '@/components/NewPageTag';
import { DEFAULT_ZONE, zoneData, zoneList } from '@/lib/routePlanner/zones';
import { MAIN_PLAN, isPlanId, planSummaries, type PlanStore } from '@/lib/routePlanner/store';
import { cardBosses, readStore, zoneChecklist, type CardBosses } from '@/lib/routePlanner/load';
import { seedFor } from '@/lib/routePlanner/seeds';
import { allPins } from '@/lib/routePlanner/plan';
import { fewestKills } from '@/lib/routePlanner/fewestKills';
import type { FewestKill } from '@/lib/routePlanner/fewest';
import RoutePlanner from './RoutePlanner';

export const metadata: Metadata = {
  title: '[beta] Route planner',
  description: 'Plan the raid’s route through a zone on its map: the named mobs, the checklist, bends around walls, splits, and how it compares to a recorded night.',
};

export const dynamic = 'force-dynamic';

type SP = { zone?: string | string[]; plan?: string | string[]; v?: string | string[] };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function RoutePlannerPage({ searchParams }: { searchParams: SP }) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid/plan/routes');
  const officer = await isOfficer(user.id);

  const zone = zoneData(one(searchParams.zone)) ?? (zoneData(DEFAULT_ZONE) as NonNullable<ReturnType<typeof zoneData>>);

  let store: PlanStore | null = null;
  let readFailed = false;
  try { store = await readStore(zone.zone); } catch { readFailed = true; }
  const plans = planSummaries(store);
  // ?v=b (stacked floors) and ?v=c (true 3D) are two previews of a 3D view, awaiting a pick; no ?v= is the page as it stands
  const v = one(searchParams.v);
  const variant = v === 'b' || v === 'c' ? v : null;
  const want = one(searchParams.plan);
  const planId = want && isPlanId(want) && plans.some(p => p.id === want) ? want : MAIN_PLAN;
  const d = store?.plans[planId] ?? null;

  let cards: CardBosses = { onPlanNpcs: [], extra: [], unplaced: 0 };
  try { cards = await cardBosses(zone); } catch { /* the planner works without the fight cards */ }
  let fewest: FewestKill[] = [];
  try {
    const ids = zone.mobs.filter(m => m.npc !== undefined && (m.kind === 'boss' || m.kind === 'named' || m.kind === 'scripted')).map(m => m.npc as number);
    fewest = await fewestKills(zone.zone, [...new Set([...ids, ...cards.onPlanNpcs])]);
  } catch { /* nothing to show */ }

  const seed = !d && !readFailed ? seedFor(zone.zone) : null;

  return (
    <div className="mx-auto max-w-7xl py-2">
      <NewPageTag note="New page: plan the raid's route on the map." />
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl text-gold">Route planner</h1>
        <Link href="/raid/plan" className="text-xs text-blue hover:underline">&larr; Fight cards</Link>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs" aria-label="Zone">
        {zoneList().map(z => (
          <Link key={z.zone} href={`/raid/plan/routes?zone=${z.zone}${variant ? '&v=' + variant : ''}`}
            className={`rounded-md border px-2 py-1 ${z.zone === zone.zone ? 'border-gold bg-gold/10 text-gold' : 'border-border text-dim hover:text-text'}`}>
            {z.name}{z.stub ? ' (data pending)' : ''}
          </Link>
        ))}
      </div>
      {readFailed && (
        <div className="mb-3 rounded-lg border border-red bg-panel p-3 text-sm text-red">
          The saved plan could not be read just now. Reload to try again; nothing is overwritten until you edit.
        </div>
      )}
      <RoutePlanner
        key={`${zone.zone}:${planId}:${variant ?? ''}`}
        zone={zone}
        planId={planId}
        plans={plans}
        doc={d ? { updated_at: d.updated_at, name: d.name, night_type: d.night_type, target_headcount: d.target_headcount ?? null, current: d.current } : null}
        rowStamp={store?.updated_at ?? null}
        officer={officer && !readFailed}
        extraMobs={cards.extra}
        onPlanNpcs={cards.onPlanNpcs}
        checklist={zoneChecklist(zone)}
        cardNote={cards.unplaced ? `${cards.unplaced} fight-card boss${cards.unplaced === 1 ? '' : 'es'} in this zone ${cards.unplaced === 1 ? 'has' : 'have'} no spawn point on record and ${cards.unplaced === 1 ? 'was' : 'were'} left out.` : ''}
        seed={seed ? { label: seed.label, pins: allPins(seed.plan).length } : null}
        fewest={fewest}
        variant={variant}
      />
      <p className="mt-6 text-xs text-dim">
        Walls are the EQEmu maps; spawn points are the server&apos;s spawn table; recorded nights are the raid&apos;s centre every 3 seconds, with no names.
        Compare the plan to a night on <Link href="/raid/routes" className="underline hover:text-text">raid routes</Link>.{' '}
        <Link href="/privacy" className="underline hover:text-text">Privacy</Link>.
      </p>
    </div>
  );
}
