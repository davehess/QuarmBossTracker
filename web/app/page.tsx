// Landing page — public, anonymous. Shows the most recent activity to give
// new visitors something to click before the OAuth gate.
import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';
import { fmtDmg, fmtTime, dayKey, dayLabel } from '@/lib/format';

export const dynamic = 'force-dynamic';

type RecentRow = {
  id: string;
  started_at: string;
  total_damage: number;
  eqemu_npc_types: { name: string } | null;
};

async function loadRecent() {
  try {
    const sb = supabaseAdmin();
    const { data } = await sb
      .from('encounters')
      .select('id, started_at, total_damage, eqemu_npc_types ( name )')
      .gt('total_damage', 0)
      .order('started_at', { ascending: false })
      .limit(6);
    return (data as unknown as RecentRow[]) ?? [];
  } catch { return []; }
}

export default async function HomePage() {
  const recent = await loadRecent();

  return (
    <div className="space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-3">Welcome to <span className="text-blue">wolfpack.quest</span></h2>
        <p className="text-sm leading-6">
          The guild-wide companion to the Wolf Pack Discord bot. Shared parses,
          per-character history, raid attendance, loot, leaderboards.
          The local agent dashboard at <code>http://localhost:7777</code> still
          runs your in-raid HUD; this site is where you compare against the rest
          of the pack between fights.
        </p>
      </section>

      {recent.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h3 className="text-sm text-orange mb-2">🔥 Recent kills</h3>
          <ul className="text-xs space-y-0.5">
            {recent.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                <Link href={`/parses/${r.id}`} className="text-text hover:text-blue truncate">
                  <span className="text-gold">{r.eqemu_npc_types?.name || '?'}</span>
                  <span className="text-dim"> · {dayLabel(dayKey(r.started_at))} {fmtTime(r.started_at)}</span>
                </Link>
                <span className="text-dim whitespace-nowrap">{fmtDmg(r.total_damage)}</span>
              </li>
            ))}
          </ul>
          <Link href="/parses" className="text-xs text-blue hover:underline mt-2 inline-block">
            See all parses →
          </Link>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card
          title="📊 Parses"
          body="Every kill grouped by night and zone. Click any to see the full damage breakdown, deaths, loot for the night."
          href="/parses"
        />
        <Card
          title="🏆 Boards"
          body="Top damage parses, raid attendance, and DKP spenders over the last 30 days."
          href="/leaderboards"
        />
        <Card
          title="🗡️ Loadouts"
          body="Every tank's bandolier sets. See who's running what weapons + procs, click through to PQDI."
          href="/loadouts"
        />
        <Card
          title="🧮 Planner"
          body="Build a theoretical loadout from the item database. Estimate hate-per-minute from procs + swings."
          href="/planner"
        />
      </section>

      <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
        <p>
          Public read-only data lives here. Auth via Discord OAuth lands in the
          next iteration to unlock per-user features (your own loadout uploads,
          private bid history).
        </p>
      </section>
    </div>
  );
}

function Card({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <Link href={href} className="block bg-panel border border-border rounded-lg p-4 hover:border-blue transition-colors no-underline">
      <h3 className="text-base text-orange mb-1">{title}</h3>
      <p className="text-xs text-dim leading-5">{body}</p>
    </Link>
  );
}
