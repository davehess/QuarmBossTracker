// Officer settings for Soft Reserve (DECISIONS §448): per raid event, whether it is on, which bosses it covers, the
// caps, who sees names, and when picks lock. Also who has reserved what (officers always see names).
// New page, so it goes live with the [beta] tag. Officer-only: requireOfficer() first, like every admin page.
import Link from 'next/link';
import NewPageTag from '@/components/NewPageTag';
import { requireOfficer } from '@/lib/officer';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { PLAN, eventWhen, pickNextRaidEvent } from '@/lib/raidPlan';
import { loadRules } from '@/lib/softReserveLoad';
import RulesForm from './RulesForm';

export const metadata = {
  title: '[beta] Soft Reserve · Admin',
  description: 'Set Soft Reserve for a raid: the bosses it covers, the caps, who sees names and when picks lock.',
};

export const dynamic = 'force-dynamic';

type Ev = { id: string; title: string; start_time: string };

export default async function AdminSoftReservePage({ searchParams }: { searchParams: Promise<{ event?: string }> | { event?: string } }) {
  await requireOfficer();
  const { event: wanted } = await searchParams;
  const sb = supabaseAdmin();
  const { data } = await sb.from('rh_events').select('id, title, start_time')
    .gte('start_time', new Date(Date.now() - 24 * 3600_000).toISOString())
    .order('start_time', { ascending: true }).limit(12);
  const events = (data ?? []) as Ev[];
  const chosen = events.find(e => e.id === wanted) ?? pickNextRaidEvent(events) ?? null;

  const rules = chosen ? await loadRules(chosen.id) : null;
  const picks = chosen
    ? await selectAll<{ character_name: string; npc_id: number; item_id: number }>((from, to) =>
        sb.from('sr_picks').select('character_name, npc_id, item_id').eq('event_id', chosen.id)
          .order('event_id', { ascending: true }).order('item_id', { ascending: true }).order('character_name', { ascending: true })
          .order('npc_id', { ascending: true }).range(from, to))
    : [];
  const itemNames = new Map<number, string>();
  const ids = [...new Set(picks.map(p => p.item_id))];
  if (ids.length) {
    const rows = await selectAll<{ id: number; name: string }>((from, to) =>
      sb.from('eqemu_items').select('id, name').in('id', ids).order('id', { ascending: true }).range(from, to));
    for (const r of rows) itemNames.set(r.id, r.name);
  }
  const byItem = new Map<number, string[]>();
  for (const p of picks) {
    if (!byItem.has(p.item_id)) byItem.set(p.item_id, []);
    byItem.get(p.item_id)!.push(p.character_name);
  }
  const planBosses = PLAN.flatMap(s => s.bosses.map(b => ({ npc: b.npc, name: b.name, zone: s.zoneName })));

  return (
    <div className="mx-auto max-w-3xl py-2">
      <NewPageTag note="New page: Soft Reserve settings for a raid." />
      <h1 className="text-2xl text-gold">Soft Reserve</h1>
      <p className="mt-1 text-sm text-dim">
        Members pick the drops they want first claim on at{' '}
        <Link href="/raid/sr" className="text-blue hover:underline">the Soft Reserve page</Link>, for the character they bring.
      </p>

      {events.length === 0 ? (
        <p className="mt-4 text-sm text-dim">No upcoming Raid-Helper events.</p>
      ) : (
        <>
          <nav className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Raid events">
            {events.map(e => (
              <Link key={e.id} href={`/admin/soft-reserve?event=${encodeURIComponent(e.id)}`}
                className={`rounded border px-2 py-1 ${e.id === chosen?.id ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`}>
                {eventWhen(e.start_time)} · {e.title}
              </Link>
            ))}
          </nav>

          {chosen && rules && (
            <>
              <section className="mt-4 rounded-lg border border-border bg-panel p-4" aria-label="Rules">
                <RulesForm key={chosen.id} eventId={chosen.id} rules={rules} planBosses={planBosses} />
              </section>

              <section className="mt-4 rounded-lg border border-border bg-panel p-4" aria-label="Reserves">
                <h2 className="text-sm font-semibold text-text">Reserves so far ({picks.length})</h2>
                {picks.length === 0 ? (
                  <p className="mt-1 text-xs text-dim">Nobody has reserved anything yet.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-xs">
                    {[...byItem.entries()].map(([item, names]) => (
                      <li key={item}>
                        <span className="text-text">{itemNames.get(item) ?? `Item ${item}`}</span>
                        <span className="text-dim"> ({names.length}): {names.join(', ')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
